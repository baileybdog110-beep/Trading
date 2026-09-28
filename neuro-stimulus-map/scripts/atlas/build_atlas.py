#!/usr/bin/env python3
"""Build the anatomical meshes used by the brain viewer.

This script is the only place where atlas geometry is produced. It is
deterministic and auditable: every mesh is derived from a published,
licensed atlas volume, and the manifest records where each region came from.

Inputs (TemplateFlow, https://www.templateflow.org):
  * CerebrA atlas (Manera et al. 2020, Sci Data 7:237; CC BY 4.0) resampled to
    the ICBM 2009c *symmetric* nonlinear MNI template, 1 mm:
      tpl-MNI152NLin2009cSym_res-1_atlas-CerebrA_dseg.nii.gz
      tpl-MNI152NLin2009cSym_atlas-CerebA_dseg.tsv   (sic, TemplateFlow file name)
  * Schaefer et al. 2018 400-parcel / 7-network parcellation (MIT licence,
    ThomasYeoLab/CBIG) in the ICBM 2009c *asymmetric* template, 1 mm:
      tpl-MNI152NLin2009cAsym_res-01_atlas-Schaefer2018_desc-400Parcels7Networks_dseg.nii.gz
      tpl-MNI152NLin2009cAsym_atlas-Schaefer2018_desc-400Parcels7Networks_dseg.tsv

Outputs (written to public/atlas/):
  * cerebra.glb        one mesh per region, vertices in MNI millimetres (RAS)
  * yeo7.glb           one mesh per network x hemisphere, MNI millimetres (RAS)
  * atlas_manifest.json  provenance, label mapping, centroids, volumes

Usage:
  python build_atlas.py --inputs <dir with the files above> --out ../../public/atlas

Nothing here is a statistical map. The meshes are anatomical/parcellation
boundaries only; colour is applied in the app from the evidence database.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import re
from pathlib import Path

import fast_simplification
import nibabel as nib
import numpy as np
import trimesh
from scipy import ndimage
from skimage import measure

CEREBRA_NII = "tpl-MNI152NLin2009cSym_res-1_atlas-CerebrA_dseg.nii.gz"
CEREBRA_TSV = "tpl-MNI152NLin2009cSym_atlas-CerebA_dseg.tsv"
SCHAEFER_NII = "tpl-MNI152NLin2009cAsym_res-01_atlas-Schaefer2018_desc-400Parcels7Networks_dseg.nii.gz"
SCHAEFER_TSV = "tpl-MNI152NLin2009cAsym_atlas-Schaefer2018_desc-400Parcels7Networks_dseg.tsv"

# CerebrA labels we do not render (fluid spaces and a label the CerebrA authors
# describe as almost non-existent in the source atlas).
EXCLUDE = {"Third Ventricle", "Fourth Ventricle", "Lateral Ventricle",
           "Inferior Lateral Ventricle", "Optic Chiasm"}

# Labels merged into one displayed structure. Key = output id suffix.
MERGE_PER_HEMI = {
    "cerebellum": ("Cerebellar hemisphere", {"Cerebellum Gray Matter", "Cerebellum White Matter"}),
}
MERGE_BILATERAL = {
    "brainstem": ("Brainstem", {"Brainstem"}),
    "vermis": ("Cerebellar vermis", {"Vermal lobules I-V", "Vermal lobules VI-VII", "Vermal lobules VIII-X"}),
}

SUBCORTICAL = {"Thalamus", "Caudate", "Putamen", "Pallidum", "Hippocampus", "Amygdala",
               "Accumbens Area", "Ventral Diencephalon", "Basal Forebrain"}

YEO7 = {
    "Vis": "Visual",
    "SomMot": "Somatomotor",
    "DorsAttn": "Dorsal attention",
    "SalVentAttn": "Salience / ventral attention",
    "Limbic": "Limbic",
    "Cont": "Frontoparietal control",
    "Default": "Default",
}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def mask_to_mesh(mask: np.ndarray, affine: np.ndarray, target_faces: int) -> trimesh.Trimesh:
    """Smooth a binary mask, extract an isosurface, decimate, and map to world mm."""
    # Crop to the bounding box (+ margin) for speed.
    idx = np.argwhere(mask)
    lo = np.maximum(idx.min(0) - 3, 0)
    hi = np.minimum(idx.max(0) + 4, mask.shape)
    sub = mask[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]].astype(np.float32)
    sub = ndimage.gaussian_filter(sub, sigma=0.9)
    verts, faces, _, _ = measure.marching_cubes(sub, level=0.5)
    verts = verts + lo  # back to voxel indices of the full volume
    verts = nib.affines.apply_affine(affine, verts)
    mesh = trimesh.Trimesh(verts, faces, process=True)
    if len(mesh.faces) > target_faces:
        reduction = 1.0 - target_faces / len(mesh.faces)
        v, f = fast_simplification.simplify(mesh.vertices.astype(np.float32),
                                            mesh.faces.astype(np.int32), reduction)
        mesh = trimesh.Trimesh(v, f, process=True)
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=8)
    # skimage marching cubes on (i, j, k) with a positive-determinant affine gives
    # outward normals; keep winding consistent for back-face culling.
    mesh.fix_normals()
    return mesh


def target_for(voxels: int) -> int:
    return int(np.clip(voxels * 0.12, 350, 3600))


def build_cerebra(inp: Path):
    img = nib.load(inp / CEREBRA_NII)
    data = np.asarray(img.dataobj).astype(np.int32)
    affine = img.affine
    assert nib.aff2axcodes(affine) == ("R", "A", "S"), "expected RAS+ volume"
    rows = list(csv.DictReader(open(inp / CEREBRA_TSV), delimiter="\t"))

    groups: dict[str, dict] = {}
    for r in rows:
        name, hemi, label = r["name"].strip(), r["hemi"].strip(), int(r["label"])
        if name in EXCLUDE:
            continue
        gid, gname, bilateral = None, None, False
        for key, (disp, members) in MERGE_PER_HEMI.items():
            if name in members:
                gid, gname = f"{hemi}_{key}", disp
        for key, (disp, members) in MERGE_BILATERAL.items():
            if name in members:
                gid, gname, bilateral = key, disp, True
        if gid is None:
            gid, gname = f"{hemi}_{slug(name)}", name
        g = groups.setdefault(gid, {
            "id": gid,
            "name": gname,
            "hemi": "bilateral" if bilateral else hemi,
            "atlasLabels": [],
            "atlasNames": [],
        })
        g["atlasLabels"].append(label)
        g["atlasNames"].append(f"{name} ({hemi})")

    scene = trimesh.Scene()
    out = []
    for gid, g in sorted(groups.items()):
        mask = np.isin(data, g["atlasLabels"])
        vox = int(mask.sum())
        centroid = nib.affines.apply_affine(affine, np.argwhere(mask).mean(0))
        # Hemisphere sanity check against the atlas table (RAS: x<0 is left).
        if g["hemi"] in ("L", "R"):
            observed = "L" if centroid[0] < 0 else "R"
            if observed != g["hemi"]:
                raise SystemExit(f"hemisphere mismatch for {gid}: table={g['hemi']} centroid x={centroid[0]:.1f}")
        mesh = mask_to_mesh(mask, affine, target_for(vox))
        scene.add_geometry(mesh, node_name=gid, geom_name=gid)
        base = g["name"]
        kind = ("subcortical" if base in SUBCORTICAL else
                "cerebellar" if gid.endswith("cerebellum") or gid == "vermis" else
                "brainstem" if gid == "brainstem" else "cortical")
        out.append({
            **g,
            "kind": kind,
            "volumeMm3": vox,  # 1 mm isotropic voxels
            "centroidMNI": [round(float(c), 1) for c in centroid],
            "faces": int(len(mesh.faces)),
        })
    return scene, out


def build_yeo7(inp: Path):
    img = nib.load(inp / SCHAEFER_NII)
    data = np.asarray(img.dataobj).astype(np.int32)
    affine = img.affine
    rows = list(csv.DictReader(open(inp / SCHAEFER_TSV), delimiter="\t"))
    by_net: dict[tuple[str, str], list[int]] = {}
    for r in rows:
        m = re.match(r"7Networks_(LH|RH)_([A-Za-z]+)_", r["name"])
        if not m:
            raise SystemExit(f"unexpected Schaefer label {r['name']}")
        by_net.setdefault((m.group(1)[0], m.group(2)), []).append(int(r["index"]))
    scene = trimesh.Scene()
    out = []
    for (hemi, net), labels in sorted(by_net.items()):
        mask = np.isin(data, labels)
        centroid = nib.affines.apply_affine(affine, np.argwhere(mask).mean(0))
        observed = "L" if centroid[0] < 0 else "R"
        # Networks are distributed, so the centroid test is only a coarse check.
        if observed != hemi:
            raise SystemExit(f"hemisphere mismatch for network {net} {hemi}")
        gid = f"{hemi}_yeo7_{slug(net)}"
        mesh = mask_to_mesh(mask, affine, 9000)
        scene.add_geometry(mesh, node_name=gid, geom_name=gid)
        out.append({
            "id": gid,
            "network": f"yeo7_{slug(net)}",
            "schaeferName": net,
            "name": YEO7[net],
            "hemi": hemi,
            "parcels": len(labels),
            "volumeMm3": int(mask.sum()),
            "faces": int(len(mesh.faces)),
        })
    return scene, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    cer_scene, regions = build_cerebra(args.inputs)
    cer_scene.export(args.out / "cerebra.glb")
    yeo_scene, networks = build_yeo7(args.inputs)
    yeo_scene.export(args.out / "yeo7.glb")

    manifest = {
        "generated": dt.date.today().isoformat(),
        "coordinateSystem": "MNI millimetres, RAS+ (x: left->right, y: posterior->anterior, z: inferior->superior)",
        "note": ("Meshes are anatomical/parcellation boundaries derived from the atlas volumes below. "
                 "They are not statistical maps and carry no activation values."),
        "anatomy": {
            "atlas": "CerebrA (Mindboggle-101 DKT labels registered and manually corrected for MNI-ICBM152 2009c)",
            "citation": "Manera AL, Dadar M, Fonov V, Collins DL. CerebrA, registration and manual label correction of Mindboggle-101 atlas for MNI-ICBM152 template. Sci Data. 2020;7:237. doi:10.1038/s41597-020-0557-9",
            "license": "CC BY 4.0 (article and data); template: MNI ICBM 2009c licence (permissive, attribution required)",
            "template": "MNI152NLin2009cSym (ICBM 2009c nonlinear symmetric), 1 mm",
            "source": "TemplateFlow: https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cSym/",
            "files": {CEREBRA_NII: sha256(args.inputs / CEREBRA_NII), CEREBRA_TSV: sha256(args.inputs / CEREBRA_TSV)},
            "known_gaps": ("DKT-protocol labels omit the temporal pole, frontal pole and banks of the superior temporal sulcus; "
                           "functional areas such as FFA, PPA, MT+/V5, SMA and TPJ have no dedicated label and are "
                           "represented by the gyral region(s) that contain them (flagged as approximate)."),
        },
        "networks": {
            "atlas": "Schaefer 2018 400-parcel parcellation, 7-network assignment (Yeo et al. 2011 networks)",
            "citation": ("Schaefer A, Kong R, Gordon EM, et al. Local-Global Parcellation of the Human Cerebral Cortex from "
                         "Intrinsic Functional Connectivity MRI. Cereb Cortex. 2018:3095-3114 "
                         "(https://github.com/ThomasYeoLab/CBIG/tree/master/stable_projects/brain_parcellation/Schaefer2018_LocalGlobal); "
                         "Yeo BTT, Krienen FM, Sepulcre J, et al. J Neurophysiol. 2011;106(3):1125-1165. doi:10.1152/jn.00338.2011"),
            "license": "MIT (ThomasYeoLab/CBIG)",
            "template": "MNI152NLin2009cAsym (ICBM 2009c nonlinear asymmetric), 1 mm",
            "source": "TemplateFlow: https://templateflow.s3.amazonaws.com/tpl-MNI152NLin2009cAsym/",
            "files": {SCHAEFER_NII: sha256(args.inputs / SCHAEFER_NII), SCHAEFER_TSV: sha256(args.inputs / SCHAEFER_TSV)},
            "caveat": ("Networks come from resting-state functional connectivity in a different (asymmetric) version of the "
                       "same template family; overlay alignment with the anatomical meshes is approximate (millimetre scale)."),
        },
        "build": {"smoothingSigmaVoxels": 0.9, "isoLevel": 0.5, "taubinIterations": 8,
                  "decimation": "fast-simplification (quadric)", "script": "scripts/atlas/build_atlas.py"},
        "regions": regions,
        "networks_meshes": networks,
    }
    (args.out / "atlas_manifest.json").write_text(json.dumps(manifest, indent=1))
    total = sum(r["faces"] for r in regions)
    print(f"regions={len(regions)} faces={total}  networks={len(networks)} faces={sum(n['faces'] for n in networks)}")


if __name__ == "__main__":
    main()
