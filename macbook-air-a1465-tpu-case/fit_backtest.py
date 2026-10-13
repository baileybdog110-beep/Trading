#!/usr/bin/env python3
"""
Virtual fit backtest for the alligator TPU case (MacBook Air 11", A1465).

1. Builds a 3D stand-in of the laptop from the reference dimensions: a base
   with a rolled bottom edge, a deck (palm-rest edge) that rises towards the
   hinge and rounds down at the front, rubber feet, a lid whose back curves
   down to a thin edge, the lid/deck gap (opening towards the front), the
   hinge axis and the port plugs.
2. Puts the generated case shells on it and checks them with exact mesh
   booleans:
     * nothing pushes into the laptop except the intended wedge clips
     * the laptop still closes with both shells on (no stacked lips)
     * the lid opens 0-135 degrees without the lid shell hitting the base,
       the base shell or plugged-in cables
     * the rubber feet sit inside their holes; plugs clear both shells
   ... for the nominal laptop, a set of stress cases, and the exported
   3MF files themselves (re-assembled LEFT+RIGHT halves and one-piece).
3. Monte-Carlo fit odds for this single print (no fit tests): see
   blind_fit.py for the model.

Run:  python3 fit_backtest.py   (writes fit_backtest_results.json + backtest_*.png)
"""
import json
import math
import os
import sys
import time

import numpy as np
import manifold3d as m3d

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate_case as G  # noqa: E402
import blind_fit as B  # noqa: E402

# --------------------------------------------------------------------------
# Laptop stand-in. Clip-relevant dimensions come from blind_fit.PRIORS; the
# ones below only shape the 3D stand-in (edges, ports).
# --------------------------------------------------------------------------
PRIORS = dict(B.PRIORS)
PRIORS.update({
    "lid_edge_t":   (1.6, 0.3, "side photo"),
    "lid_roll_w":   (6.0, 1.5, "side photo (curved lid back)"),
    "base_roll_r":  (2.0, 0.6, "side photo (rolled bottom case)"),
    "port_ds":      (0.0, 2.0, "port position error along the side"),
})

_POST = {}


def nominal():
    """Best-estimate laptop: prior means, updated by Apple's back thickness."""
    s = {k: v[0] for k, v in PRIORS.items()}
    if not _POST:
        S = B.sample(200000, 7)
        for k in ("lid_t", "h44", "h104", "gap_back", "foot_p", "taper_onset"):
            _POST[k] = float((S["w"] * S[k]).sum())
    s.update(_POST)
    return s


def deck(s, y):
    return float(B.deck(s, y))


def deck_line(s, y):
    """Deck height without the front rounding (the flat lid follows this)."""
    return s["h44"] + (s["h104"] - s["h44"]) * (y - 44.0) / 60.0


def gap(s, y):
    return float(B.gap(s, y))


# port plugs: (side, centre distance from back edge, plug body width along
# the side, plug body height, centre height above the bottom plane)
PLUGS = [
    ("L", 16.0, 20.0, 7.0, 4.2, "MagSafe 2"),
    ("L", 36.0, 16.5, 8.5, 3.9, "USB-A plug"),
    ("L", 57.0, 9.0, 9.0, 3.8, "3.5 mm plug"),
    ("R", 14.0, 11.5, 8.0, 3.9, "Thunderbolt plug"),
    ("R", 34.5, 16.5, 8.5, 3.9, "USB-A plug"),
]


# --------------------------------------------------------------------------
# Laptop solids
# --------------------------------------------------------------------------
def base_solid(s, T):
    W, D = s["W"], G.LAPTOP["D"]
    out = G.RRect(0, 0, W, D, s["R_front"], G.LAPTOP["R_back"])
    r = s["base_roll_r"]
    n = 8
    steps = []
    for i in range(n + 1):
        zb = r * i / n
        ins = r - math.sqrt(max(r * r - (r - zb) ** 2, 0))
        steps.append(G.prism(out.inset(ins).cs(), T + zb, T + 30))
    body = m3d.Manifold.batch_boolean(steps, m3d.OpType.Add)
    # the deck is curved (front rounding), so subdivide the extrusion before
    # setting z: G._zwarp alone would interpolate between the corner arcs
    m = m3d.Manifold.extrude(out.cs(), 1.0).refine_to_length(1.5)

    def f(v):
        v = np.array(v, dtype=np.float64)
        top = v[:, 2] > 0.5
        v[:, 2] = np.where(top, T + B.deck(s, np.clip(v[:, 1], 0, D)), T - 1)
        return v
    return body ^ m.warp_batch(f)


def feet_solid(s, T):
    parts = []
    for fx, fy in G.LAPTOP["feet"]:
        parts.append(m3d.Manifold.cylinder(s["foot_p"] + 0.5, 9.0, circular_segments=72)
                     .translate((fx + s["foot_dx"], fy + s["foot_dy"], T - s["foot_p"])))
    return m3d.Manifold.batch_boolean(parts, m3d.OpType.Add)


def lid_solid_lidframe(s):
    """Lid in its own frame: z1 = 0 at the display face, + towards the back."""
    W, D = s["W"], G.LAPTOP["D"]
    out = G.RRect(0, 0, W, D - 1.0, s["R_front"], G.LAPTOP["R_back"])
    te, tc, w = s["lid_edge_t"], s["lid_t"], s["lid_roll_w"]
    n = 10
    parts = []
    for i in range(n + 1):
        d = w * i / n
        t = te + (tc - te) * math.sqrt(1 - (1 - i / n) ** 2)
        parts.append(G.prism(out.inset(d).cs(), 0.0, t))
    return m3d.Manifold.batch_boolean(parts, m3d.OpType.Add)


def lid_to_world(m_lidframe, s, T):
    """Lid frame -> world (base-shell) frame with the laptop closed: the flat
    display face sits one lid/deck gap above the (unrounded) deck line."""
    def face(y):
        return deck_line(s, y) + gap(s, y)
    k = (face(100.0) - face(0.0)) / 100.0
    th = math.degrees(math.atan(k))
    return m_lidframe.rotate((th, 0, 0)).translate((0, 0, T + face(0.0)))


def lidshell_to_lidframe(shell, s, T):
    """Lid-shell coordinates (z from its outer face) -> lid frame."""
    # the real lid's back rests on the shell floor (z = T), so its display
    # face is at z = T + true lid thickness
    return shell.mirror((0, 0, 1)).translate((0, 0, T + s["lid_t"]))


def plugs_solid(s, T):
    W, D = s["W"], G.LAPTOP["D"]
    parts = []
    for side, sc, w, h, zc, _ in PLUGS:
        yc = D - (sc + s["port_ds"])
        if side == "L":
            x0, x1 = -40.0, -0.3
        else:
            x0, x1 = W + 0.3, W + 40.0
        parts.append(G.box(x0, x1, yc - w / 2, yc + w / 2, T + zc - h / 2, T + zc + h / 2))
    return m3d.Manifold.batch_boolean(parts, m3d.OpType.Add)


def hinge_rotate(m, s, T, phi_deg, dy=0.0, dz=0.0):
    """Open the lid by phi about the hinge axis (parallel to x)."""
    D = G.LAPTOP["D"]
    yh = D - 4.5 + dy
    zh = T + deck(s, D) + gap(s, D) / 2 + dz
    return m.translate((0, -yh, -zh)).rotate((-phi_deg, 0, 0)).translate((0, yh, zh))


def vol(m):
    return 0.0 if m.is_empty() else m.volume()


def pieces(m, min_vol=1e-4):
    if m.is_empty():
        return []
    out = []
    for p in m.decompose():
        v = p.volume()
        if v > min_vol:
            b = p.bounding_box()
            out.append(dict(vol=round(v, 4), bbox=[round(x, 2) for x in b],
                            depth=round(min(b[3] - b[0], b[4] - b[1], b[5] - b[2]), 3)))
    return out


# --------------------------------------------------------------------------
# Geometric backtest of the case shells against one laptop sample
# --------------------------------------------------------------------------
CLOSED_KEYS = ("closed_lidshell_vs_base", "closed_lidshell_vs_baseshell", "closed_lid_vs_baseshell")
CONTACT_KEYS = ("feet_vs_baseshell", "plugs_vs_baseshell", "plugs_vs_closed_lidshell") + CLOSED_KEYS


def geometric_backtest(s, L_case, P, log=print, lid_shell=None, base_shell=None, sweep_offsets=None):
    T = P["plate"]
    res = {}
    t0 = time.time()
    if lid_shell is None:
        lid_shell, *_ = G.build_shell("top", L_case, P, G.SEED_TOP, with_texture=False, log=lambda *a: None)
    if base_shell is None:
        base_shell, *_ = G.build_shell("bottom", L_case, P, G.SEED_BOTTOM, with_texture=False, log=lambda *a: None)
    base = base_solid(s, T)
    feet = feet_solid(s, T)
    plugs = plugs_solid(s, T)
    lid_lf = lid_solid_lidframe(s)
    ls_lf = lidshell_to_lidframe(lid_shell, s, T)

    # --- 1. lid in lid shell (lid frame): only the wedge clips may touch -----
    res["lid_vs_lidshell"] = pieces(lid_lf ^ ls_lf)
    res["lid_lip_vertical_play"] = round((L_case["lid_t"] + P["lip_gap"]) - s["lid_t"], 3)
    res["lip_overhang_side"] = round(P["lip_reach"] - P["clear"] - (s["W"] - L_case["W"]) / 2, 3)

    # --- 2. base in base shell (world) --------------------------------------
    res["base_vs_baseshell"] = pieces(base ^ base_shell)
    res["feet_vs_baseshell"] = pieces(feet ^ base_shell)
    k_case = (L_case["base_h_back"] - L_case["base_h_front"]) / L_case["D"]
    plays = {}
    for y in (38.0, 56.0, 88.0, 104.0):
        hc = L_case["base_h_front"] + k_case * y + P["lip_gap"]
        plays[f"y={y:g}"] = round(hc - deck(s, y), 3)
    res["base_lip_vertical_play"] = plays

    # --- 3. ports ------------------------------------------------------------
    res["plugs_vs_baseshell"] = pieces(plugs ^ base_shell)

    # --- 4. closed laptop: both shells on -------------------------------------
    lid_w = lid_to_world(lid_lf, s, T)
    ls_w = lid_to_world(ls_lf, s, T)
    res["closed_lidshell_vs_base"] = pieces(ls_w ^ base)
    res["closed_lidshell_vs_baseshell"] = pieces(ls_w ^ base_shell)
    res["closed_lid_vs_baseshell"] = pieces(lid_w ^ base_shell)
    res["plugs_vs_closed_lidshell"] = pieces(plugs ^ ls_w)

    # --- 5. hinge sweep (with cables plugged in) -------------------------------
    sweep = []
    for dy, dz in (sweep_offsets or ((0, 0), (-1.5, 0), (1.5, 0), (0, -1.5), (0, 1.5))):
        worst = 0.0
        for phi in range(0, 136, 5):
            moved = hinge_rotate(ls_w, s, T, phi, dy, dz)
            v = vol(moved ^ base_shell) + vol(moved ^ base) + vol(moved ^ plugs)
            worst = max(worst, v)
        sweep.append(dict(axis_offset_mm=(dy, dz), worst_overlap_mm3=round(worst, 3)))
    res["hinge_sweep_lidshell"] = sweep
    res["seconds"] = round(time.time() - t0, 1)
    return res, dict(lid_shell=lid_shell, base_shell=base_shell, base=base, feet=feet, plugs=plugs,
                     lid_lf=lid_lf, ls_lf=ls_lf, lid_w=lid_w, ls_w=ls_w)


def verdict(res):
    contacts = {k: len(res[k]) for k in CONTACT_KEYS if res[k]}
    hinge = max(d["worst_overlap_mm3"] for d in res["hinge_sweep_lidshell"])
    return dict(contacts=contacts, hinge_mm3=hinge, passed=not contacts and hinge < 0.01)


def stress_cases():
    return {
        "nominal laptop": {},
        "tightly rolled edges (base r 0.8 mm, lid roll 3 mm)": dict(base_roll_r=0.8, lid_roll_w=3.0),
        "thin lid edge (1.0 mm)": dict(lid_edge_t=1.0),
        "thick lid edge (2.2 mm)": dict(lid_edge_t=2.2),
        "laptop 0.4 mm wider": dict(W=299.9),
        "laptop 0.4 mm narrower": dict(W=299.1),
        "front corner radius 8.8 mm": dict(R_front=8.8),
        "front corner radius 11.2 mm": dict(R_front=11.2),
        "rubber feet 3 mm off": dict(foot_dx=2.1, foot_dy=2.1),
        "ports 5 mm further forward": dict(port_ds=5.0),
        "ports 5 mm further back": dict(port_ds=-5.0),
        "lid 0.3 mm thinner": dict(lid_t=-0.3),
        "deck 0.4 mm lower": dict(h44=-0.4, h104=-0.36),
        "lid/deck gap 0.2 mm smaller": dict(gap_back=-0.2),
        "front taper starts 75 mm back": dict(taper_onset=75.0),
    }


RELATIVE = ("lid_t", "h44", "h104", "gap_back")   # stress offsets added to the nominal value


def _load_mesh(path):
    import trimesh
    m = trimesh.load(path)
    m = m.to_geometry() if hasattr(m, "to_geometry") else m
    m.merge_vertices()
    return m3d.Manifold(m3d.Mesh(vert_properties=np.asarray(m.vertices, np.float32),
                                 tri_verts=np.asarray(m.faces, np.uint32)))


def exported_shells(L, P, folder):
    """Re-assemble the exported LEFT/RIGHT halves (and one-piece files) in the
    laptop frame, using the in-memory pieces only to undo the bed centring."""
    out = {}
    for kind, seed, name in (("top", G.SEED_TOP, "lid_shell"), ("bottom", G.SEED_BOTTOM, "base_shell")):
        ref, croc, outer, _ = G.build_shell(kind, L, P, seed, with_texture=False, log=lambda *a: None)
        halves = G.split_halves(ref, croc, outer, P)
        parts = []
        for half, refp in zip(("LEFT", "RIGHT"), halves):
            b = refp.bounding_box()
            m = _load_mesh(os.path.join(folder, f"{name}_{half}.3mf"))
            mb = m.bounding_box()
            parts.append(m.translate(((b[0] + b[3]) / 2 - (mb[0] + mb[3]) / 2,
                                      (b[1] + b[4]) / 2 - (mb[1] + mb[4]) / 2, 0)))
        b = ref.bounding_box()
        one = _load_mesh(os.path.join(folder, "one_piece_for_big_beds", f"{name}_ONE-PIECE_big-bed.3mf"))
        ob = one.bounding_box()
        one = one.translate(((b[0] + b[3]) / 2 - (ob[0] + ob[3]) / 2, (b[1] + b[4]) / 2 - (ob[1] + ob[4]) / 2, 0))
        out[kind] = dict(halves=parts[0] + parts[1], one_piece=one)
    return out


def main():
    L = dict(G.LAPTOP)
    P = dict(G.CASE)
    t0 = time.time()
    rows = []
    for name, ov in stress_cases().items():
        s = nominal()
        for k, v in ov.items():
            s[k] = s[k] + v if k in RELATIVE else v
        res, parts = geometric_backtest(s, L, P)
        if name == "nominal laptop":
            nominal_res, nominal_parts = res, parts
        rows.append(dict(case=name, **verdict(res), lid_play=res["lid_lip_vertical_play"],
                         base_play=res["base_lip_vertical_play"]))
        print(f"  {name:52s} {'PASS' if rows[-1]['passed'] else 'FAIL'}  {rows[-1]['contacts'] or ''}"
              f"  hinge {rows[-1]['hinge_mm3']} mm3")
    s = nominal()
    render_pictures(s, L, P, nominal_parts, os.path.join(HERE, "backtest_"))
    exported = []
    mf = os.path.join(HERE, "3mf")
    if os.path.isfile(os.path.join(mf, "lid_shell_LEFT.3mf")):
        ex = exported_shells(L, P, mf)
        for label, key in (("exported LEFT+RIGHT halves (assembled, seam gap included)", "halves"),
                           ("exported one-piece files", "one_piece")):
            r, _ = geometric_backtest(s, L, P, lid_shell=ex["top"][key], base_shell=ex["bottom"][key])
            v = verdict(r)
            lidc = sum(p["vol"] for p in r["lid_vs_lidshell"])
            basec = sum(p["vol"] for p in r["base_vs_baseshell"])
            exported.append(dict(case=label, **v, lid_wedge_mm3=round(lidc, 1), base_wedge_mm3=round(basec, 1)))
            print(f"  {label:52s} {'PASS' if v['passed'] else 'FAIL'}  {v['contacts'] or ''}"
                  f"  (clip wedge contact: lid {lidc:.0f} mm3, base {basec:.0f} mm3)")
    d = B.design_from_case(L, P)
    S = B.sample(200000, 1)
    mc = B.score(d, S)
    print(f"  fit odds (Monte Carlo): snug {mc['good']:.1f} %, usable {mc['usable']:.1f} %  {mc['components']}")
    sens = B.sensitivity(d)
    with open(os.path.join(HERE, "fit_backtest_results.json"), "w") as f:
        json.dump(dict(design=d, geometry_nominal=nominal_res, stress=rows, exported_files=exported,
                       monte_carlo=dict(n=200000, snug_pct=round(mc["good"], 1), usable_pct=round(mc["usable"], 1),
                                        components_snug_usable_pct=mc["components"]),
                       sensitivity_prior_mean_shift=sens, posterior=B.posterior(S),
                       priors={k: list(v) for k, v in PRIORS.items()}), f, indent=1)
    print(f"done in {time.time() - t0:.0f}s")


# --------------------------------------------------------------------------
# Pictures of the virtual fit
# --------------------------------------------------------------------------
def _section_y(m, y):
    """Polygons of the cut at plane y = const, as (x, z)."""
    if m.is_empty():
        return []
    return [np.asarray(p)[:, [0, 1]] * [1, -1] for p in m.rotate((90, 0, 0)).slice(y).to_polygons()]


def _section_x(m, x):
    """Polygons of the cut at plane x = const, as (y, z)."""
    if m.is_empty():
        return []
    out = []
    for p in m.rotate((0, -90, 0)).slice(x).to_polygons():
        p = np.asarray(p)
        out.append(np.column_stack([p[:, 1], -p[:, 0]]))
    return out


def render_pictures(s, L, P, parts, path_prefix):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    T = P["plate"]
    C_LAP, E_LAP = "#d9d6cf", "#b03a2e"
    C_LS, C_BS = "#6b7340", "#4e5530"

    def draw(ax, polys, fc, ec="k", lw=0.6, alpha=0.9, z=2):
        for p in polys:
            q = np.vstack([p, p[:1]])
            ax.fill(q[:, 0], q[:, 1], color=fc, alpha=alpha, zorder=z)
            ax.plot(q[:, 0], q[:, 1], color=ec, lw=lw, zorder=z + 1)

    # ---------------- sections at the clips
    fig, axs = plt.subplots(2, 3, figsize=(17, 9.5))
    ax = axs[0, 0]
    draw(ax, _section_y(parts["ls_lf"], 72.0), C_LS)
    draw(ax, _section_y(parts["lid_lf"], 72.0), C_LAP, E_LAP, 1.2, 0.8, 4)
    ax.set_title("Lid shell side clip (y = 72): lid edge on the wedge ramp", fontsize=10)
    ax.set_xlim(-3, 5); ax.set_ylim(-2.2, 2.4); ax.invert_yaxis()
    ax.set_ylabel("mm (lid frame, display face = 0)")
    for ax, y, ttl in ((axs[0, 1], 47.0, "Base shell side clip (y = 47)"),
                       (axs[0, 2], 96.0, "Base shell side clip (y = 96)")):
        draw(ax, _section_y(parts["base_shell"], y), C_BS)
        draw(ax, _section_y(parts["base"], y), C_LAP, E_LAP, 1.2, 0.8, 4)
        h = T + deck(s, y)
        ax.set_xlim(-3, 5); ax.set_ylim(h - 4.0, h + 1.4)
        ax.set_title(ttl + ": palm-rest edge on the wedge ramp", fontsize=10)
        ax.set_ylabel("mm above print bed")
    for ax, y, ttl in ((axs[1, 0], 72.0, "Closed (y = 72): lid clip in the lid/deck gap"),
                       (axs[1, 1], 47.0, "Closed (y = 47): base clip in the lid/deck gap"),
                       (axs[1, 2], 18.0, "Closed (y = 18): front corner clip, lowered base wall")):
        draw(ax, _section_y(parts["base_shell"], y), C_BS)
        draw(ax, _section_y(parts["base"], y), C_LAP, E_LAP, 1.2, 0.8, 4)
        draw(ax, _section_y(parts["lid_w"], y), "#c9c6bf", E_LAP, 1.2, 0.8, 4)
        draw(ax, _section_y(parts["ls_w"], y), C_LS)
        h = T + deck_line(s, y) + gap(s, y)
        ax.set_xlim(-3, 5); ax.set_ylim(h - 3.5, h + 2.5)
        ax.set_title(ttl, fontsize=10)
        ax.set_ylabel("mm above print bed")
    for a in axs.flat:
        a.set_aspect("equal"); a.grid(True, lw=0.3); a.set_xlabel("mm from laptop side (negative = outside)")
    plt.tight_layout()
    plt.savefig(path_prefix + "sections.png", dpi=105)
    plt.close()

    # ---------------- hinge sweep (cut at x = 20 mm)
    fig, ax = plt.subplots(figsize=(10, 6.5))
    x = 20.0
    draw(ax, _section_x(parts["base_shell"], x), C_BS)
    draw(ax, _section_x(parts["base"], x), C_LAP, E_LAP, 1.0, 0.8, 4)
    cmap = plt.cm.viridis
    for i, phi in enumerate((0, 30, 60, 90, 110, 135)):
        moved = hinge_rotate(parts["ls_w"], s, T, phi)
        for p in _section_x(moved, x):
            q = np.vstack([p, p[:1]])
            ax.plot(q[:, 0], q[:, 1], color=cmap(i / 5), lw=1.4, zorder=6)
        ax.plot([], [], color=cmap(i / 5), lw=1.4, label=f"lid shell at {phi} deg")
    D = G.LAPTOP["D"]
    yh, zh = D - 4.5, T + deck(s, D) + gap(s, D) / 2
    ax.plot([yh], [zh], "k+", ms=12, mew=2, label="hinge axis (estimated)")
    ax.set_xlim(D - 45, D + 15); ax.set_ylim(-2, 40)
    ax.set_aspect("equal"); ax.grid(True, lw=0.3); ax.legend(fontsize=8, loc="upper left")
    ax.set_title("Opening the lid 0-135 deg: the lid shell's back edge clears the base and base shell",
                 fontsize=10)
    ax.set_xlabel("mm from the front edge"); ax.set_ylabel("mm above print bed")
    plt.tight_layout()
    plt.savefig(path_prefix + "hinge.png", dpi=110)
    plt.close()

    # ---------------- ports (side elevations)
    fig, axs = plt.subplots(2, 1, figsize=(13, 6.5))
    for ax, side, xcut in ((axs[0], "L", -1.0), (axs[1], "R", s["W"] + 1.0)):
        draw(ax, _section_x(parts["base_shell"], xcut), C_BS)
        draw(ax, _section_x(parts["ls_w"], xcut), C_LS)
        for sd, sc, w, h, zc, name in PLUGS:
            if sd != side:
                continue
            yc = D - sc
            ax.add_patch(plt.Rectangle((yc - w / 2, T + zc - h / 2), w, h, fill=False, ec="#2e6db0", lw=1.6,
                                       zorder=7))
            ax.text(yc, T + zc + h / 2 + 0.6, name, ha="center", fontsize=8, color="#2e6db0")
        ys = np.linspace(0, D, 200)
        ax.plot(ys, [T + deck(s, y) for y in ys], color=E_LAP, lw=1.0, ls="--", label="palm-rest edge")
        ax.plot([0, D], [T, T], color=E_LAP, lw=1.0, ls=":", label="laptop bottom")
        ax.set_xlim(D - 95, D + 5); ax.set_ylim(-1, 16); ax.set_aspect("equal"); ax.grid(True, lw=0.3)
        ax.set_title(("Left" if side == "L" else "Right") + " side, closed, seen from outside: plug bodies vs. base-shell window and lid shell",
                     fontsize=10)
        ax.legend(fontsize=8, loc="upper left")
    axs[1].set_xlabel("mm from the front edge")
    plt.tight_layout()
    plt.savefig(path_prefix + "ports.png", dpi=110)
    plt.close()


if __name__ == "__main__":
    main()
