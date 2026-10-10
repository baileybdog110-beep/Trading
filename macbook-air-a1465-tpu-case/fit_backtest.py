#!/usr/bin/env python3
"""
Virtual fit backtest for the alligator TPU case (MacBook Air 11", A1465).

1. Builds a 3D stand-in of the laptop from the reference dimensions: a wedge
   base with a rolled bottom edge and rubber feet, a lid whose back curves
   down to a thin edge, the lid/deck gap, the hinge axis and the port plugs.
2. Puts the generated case shells on it and checks them with exact mesh
   booleans:
     * nothing pushes into the laptop except the intended snap lips
     * how far each lip reaches over the bezel / palm rest
     * the laptop still closes with both shells on (no stacked lips)
     * the lid opens 0-135 degrees without the shells colliding
     * the rubber feet sit inside their holes; plugs clear the port windows
3. Monte-Carlo tolerance analysis over the uncertain laptop dimensions and
   printer error -> chance of a good fit for each printed size, and for
   "print the fit tests first, then the matching size".

Run:  python3 fit_backtest.py            (writes fit_report.md + images)
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

# --------------------------------------------------------------------------
# Laptop stand-in. Nominal values = what the case is designed around.
# Each entry in PRIORS is (nominal, standard deviation, note) and drives the
# Monte-Carlo; the evidence behind each number is listed in fit_report.md.
# --------------------------------------------------------------------------
PRIORS = {
    "W":            (299.5, 0.20, "Apple: 29.95 cm"),
    "R_front":      (10.0, 0.6, "rectified bottom photo"),
    "lid_t":        (4.9, 0.30, "derived; not published"),
    "lid_edge_t":   (1.6, 0.3, "side photo"),
    "lid_roll_w":   (6.0, 1.5, "side photo (curved lid back)"),
    "base_h_front": (1.35, 0.35, "side-photo extrapolation"),
    "base_h_back":  (9.6, 0.45, "side photo"),
    "base_roll_r":  (2.0, 0.6, "side photo (rolled bottom case)"),
    "gap":          (0.90, 0.15, "side photo"),
    "foot_dx":      (0.0, 1.0, "photo rectification error"),
    "foot_dy":      (0.0, 1.0, "photo rectification error"),
    "foot_p":       (2.0, 0.3, "A1465 replacement-foot design: 18 mm dia, 2.0 mm proud"),
    "port_ds":      (0.0, 2.0, "port position error along the side"),
    # printer / material
    "shrink":       (0.003, 0.0015, "TPU in-plane shrink after cooling (fraction)"),
    "z_err":        (0.0, 0.06, "Z dimension error (mm)"),
}


_POST = {}


def nominal():
    """Best-estimate laptop: prior means, updated by the published thicknesses."""
    s = {k: v[0] for k, v in PRIORS.items()}
    if not _POST:
        S = sample(200000, np.random.default_rng(7))
        w = obs_weights(S)
        for k in ("lid_t", "lid_edge_t", "base_h_front", "base_h_back", "gap", "foot_p"):
            _POST[k] = float((w * S[k]).sum())
    s.update(_POST)
    return s


# port plugs: (side, centre distance from back edge, plug body width along
# the side, plug body height, centre height above the bottom plane)
PLUGS = [
    ("L", 16.0, 20.0, 7.0, 4.2, "MagSafe 2"),
    ("L", 36.0, 16.5, 8.5, 3.9, "USB-A plug"),
    ("L", 57.0, 9.0, 9.0, 3.8, "3.5 mm plug"),
    ("R", 14.0, 11.5, 8.0, 3.9, "Thunderbolt plug"),
    ("R", 34.5, 16.5, 8.5, 3.9, "USB-A plug"),
]


def laptop_dims(s):
    L = dict(G.LAPTOP)
    L.update(W=s["W"], R_front=s["R_front"], lid_t=s["lid_t"],
             base_h_front=s["base_h_front"], base_h_back=s["base_h_back"])
    return L


# --------------------------------------------------------------------------
# Laptop solids
# --------------------------------------------------------------------------
def base_solid(s, T):
    W, D = s["W"], G.LAPTOP["D"]
    hf, hb = s["base_h_front"], s["base_h_back"]
    k = (hb - hf) / D
    out = G.RRect(0, 0, W, D, s["R_front"], G.LAPTOP["R_back"])
    r = s["base_roll_r"]
    n = 8
    steps = []
    for i in range(n + 1):
        zb = r * i / n
        ins = r - math.sqrt(max(r * r - (r - zb) ** 2, 0))
        steps.append(G.prism(out.inset(ins).cs(), T + zb, T + 30))
    body = m3d.Manifold.batch_boolean(steps, m3d.OpType.Add)
    deck = G._zwarp(out.cs(), lambda y, top: (T + hf + k * y) if top else np.full_like(y, T - 1))
    return body ^ deck


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
    """Lid frame -> world (base-shell) frame with the laptop closed."""
    D = G.LAPTOP["D"]
    k = (s["base_h_back"] - s["base_h_front"]) / D
    th = math.degrees(math.atan(k))
    return m_lidframe.rotate((th, 0, 0)).translate((0, 0, T + s["base_h_front"] + s["gap"]))


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
    zh = T + s["base_h_back"] + s["gap"] / 2 + dz
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
# Geometric backtest for one case size against one laptop sample
# --------------------------------------------------------------------------
def geometric_backtest(s, L_case, P, log=print, lid_shell=None, base_shell=None):
    T = P["plate"]
    W, D = s["W"], G.LAPTOP["D"]
    res = {}
    t0 = time.time()
    if lid_shell is None:
        lid_shell, *_ = G.build_shell("top", L_case, P, 11, with_texture=False, log=lambda *a: None)
    if base_shell is None:
        base_shell, *_ = G.build_shell("bottom", L_case, P, 23, with_texture=False, log=lambda *a: None)
    base = base_solid(s, T)
    feet = feet_solid(s, T)
    lid_lf = lid_solid_lidframe(s)
    ls_lf = lidshell_to_lidframe(lid_shell, s, T)

    # --- 1. lid in lid shell (lid frame) ------------------------------------
    inter = lid_lf ^ ls_lf
    res["lid_vs_lidshell"] = pieces(inter)
    # lip underside vs display face (z1 = 0): lip underside sits at z1 = -(gap)
    # sample the shell along a side clip and the corner
    res["lid_lip_vertical_play"] = round((L_case["lid_t"] + P["lip_gap"]) - s["lid_t"], 3)
    res["lid_lip_overlap_side"] = round(P["lip_reach"] - P["clear"] - (s["W"] - L_case["W"]) / 2, 3)

    # --- 2. base in base shell (world) --------------------------------------
    res["base_vs_baseshell"] = pieces(base ^ base_shell)
    res["feet_vs_baseshell"] = pieces(feet ^ base_shell)
    k_true = (s["base_h_back"] - s["base_h_front"]) / D
    k_case = (L_case["base_h_back"] - L_case["base_h_front"]) / D
    plays = {}
    for name, y in (("side clip y=44", 44.0), ("side clip y=104", 104.0),
                    ("side clip y=111 (right)", 111.0)):
        hc = L_case["base_h_front"] + k_case * y + P["lip_gap"]
        ht = s["base_h_front"] + k_true * y
        plays[name] = round(hc - ht, 3)
    res["base_lip_vertical_play"] = plays

    # --- 3. ports ------------------------------------------------------------
    res["plugs_vs_baseshell"] = pieces(plugs_solid(s, T) ^ base_shell)

    # --- 4. closed laptop: both shells on -------------------------------------
    lid_w = lid_to_world(lid_lf, s, T)
    ls_w = lid_to_world(ls_lf, s, T)
    res["closed_lidshell_vs_base"] = pieces(ls_w ^ base)
    res["closed_lidshell_vs_baseshell"] = pieces(ls_w ^ base_shell)
    res["closed_lid_vs_baseshell"] = pieces(lid_w ^ base_shell)

    # --- 5. hinge sweep -------------------------------------------------------
    sweep = []
    for dy, dz in ((0, 0), (-1.5, 0), (1.5, 0), (0, -1.5), (0, 1.5)):
        worst = 0.0
        for phi in range(0, 136, 5):
            moved = hinge_rotate(ls_w, s, T, phi, dy, dz)
            v = vol(moved ^ base_shell) + vol(moved ^ base)
            worst = max(worst, v)
        sweep.append(dict(axis_offset_mm=(dy, dz), worst_overlap_mm3=round(worst, 3)))
    res["hinge_sweep_lidshell"] = sweep
    res["seconds"] = round(time.time() - t0, 1)
    return res, dict(lid_shell=lid_shell, base_shell=base_shell, base=base, feet=feet,
                     lid_lf=lid_lf, ls_lf=ls_lf, lid_w=lid_w, ls_w=ls_w)


# --------------------------------------------------------------------------
# Monte-Carlo tolerance analysis
# --------------------------------------------------------------------------
# Fit classes. "play" = lip height minus the laptop surface it hooks over.
# Positive = free play (rattle); negative = preload the TPU lip/wall absorbs.
# With the 45 deg wedge ramp (1.0 mm) the edge wedges onto the ramp for any
# play between 0 and ramp - clearance - 0.1 mm of minimum wall flex; above
# that it is free play. Negative play bends the lip up / stretches the wall.
LIP_GOOD = (-0.45, 0.45)    # wedged snug (<= 0.45 mm lip bend, or wedge with flex)
LIP_OK = (-0.70, 0.60)      # still holds, but tight or with a little free play
LIP_TARGET = 0.0            # what you pick from the fit tests: "snug, clicks on"
# Width: a narrower pocket just stretches the TPU (2.5 mm over 300 mm is 0.8 %
# strain; TPU 95A takes > 300 %) and is equivalent to zero side clearance for
# the clips; a pocket > 0.8 mm too wide weakens the clip wedges.
WIDTH_GOOD = (-2.50, 0.80)
BASE_CLIP_YS = (44.0, 104.0, 111.0)


def classify(play, good=LIP_GOOD, ok=LIP_OK):
    play = np.asarray(play)
    q = np.zeros(play.shape, dtype=int)
    q[(play >= ok[0]) & (play <= ok[1])] = 1
    q[(play >= good[0]) & (play <= good[1])] = 2
    return q


def sample(n, rng, scale=1.0):
    return {k: rng.normal(v[0], v[1] * scale, n) for k, v in PRIORS.items()}


# Published whole-laptop thicknesses used to check (and weight) every
# simulated laptop: (name, model, observed, sigma incl. model error, source)
OBSERVATIONS = [
    ("closed thickness at the front edge",
     lambda S: S["base_h_front"] + S["gap"] + S["lid_edge_t"], 2.9, 0.5,
     "Apple: 0.11 in (2.8 mm) / 0.3 cm; edge rounding adds model error"),
    ("closed thickness at the back incl. feet",
     lambda S: S["base_h_back"] + S["gap"] + S["lid_t"] + S["foot_p"], 17.4, 0.45,
     "Apple: 0.68 in (17.3 mm); stand designer's caliper reading 17.8 mm"),
]


def obs_weights(S):
    w = np.ones_like(S["W"])
    for _, f, mu, sd, _ in OBSERVATIONS:
        w *= np.exp(-0.5 * ((f(S) - mu) / sd) ** 2)
    return w / w.sum()


def posterior_summary(n=200000, seed=7):
    """Prior vs. posterior (after the published-thickness check) of the key dims."""
    S = sample(n, np.random.default_rng(seed))
    w = obs_weights(S)
    out = {}
    for k in ("lid_t", "lid_edge_t", "base_h_front", "base_h_back", "gap", "foot_p"):
        m = float((w * S[k]).sum())
        sd = float(np.sqrt((w * (S[k] - m) ** 2).sum()))
        out[k] = dict(prior=[PRIORS[k][0], PRIORS[k][1]], posterior=[round(m, 3), round(sd, 3)])
    D = G.LAPTOP["D"]
    for y in (G.Y_FRONT_CLIP, G.Y_REAR_CLIP):
        h = S["base_h_front"] + (S["base_h_back"] - S["base_h_front"]) / D * y
        m = float((w * h).sum())
        out[f"deck height at y={y:g}"] = dict(
            prior=[round(PRIORS["base_h_front"][0] + (PRIORS["base_h_back"][0] - PRIORS["base_h_front"][0]) / D * y, 3)],
            posterior=[round(m, 3), round(float(np.sqrt((w * (h - m) ** 2).sum())), 3)])
    out["effective_samples"] = int(1.0 / (w ** 2).sum())
    return out


def monte_carlo(P, n=200000, seed=1, priors_scale=1.0, use_observations=True):
    rng = np.random.default_rng(seed)
    S = sample(n, rng, priors_scale)
    wts = obs_weights(S) if use_observations else np.full(n, 1.0 / n)
    L = dict(G.LAPTOP)
    D = L["D"]
    g = P["lip_gap"]

    def h_true(y):
        return S["base_h_front"] + (S["base_h_back"] - S["base_h_front"]) / D * y

    # ---- lid: one play value per printed size
    lid_play = np.stack([(L["lid_t"] + d + g) + S["z_err"] - S["lid_t"] for d in G.LID_SIZES])
    lid_q = classify(lid_play)
    pick = np.argmin(np.abs(lid_play - LIP_TARGET), axis=0)
    lid_tested = lid_q[pick, np.arange(n)]
    lid_blind = lid_q[len(G.LID_SIZES) // 2]

    # ---- base: every (front, rear) shell, plays at all clip positions
    combos, combo_plays = {}, {}
    for i, dF in enumerate(G.BASE_FRONT):
        for j, dR in enumerate(G.BASE_REAR):
            hf, hb = G.base_heights(L, dF, dR)
            plays = np.stack([(hf + (hb - hf) / D * y + g) + S["z_err"] - h_true(y) for y in BASE_CLIP_YS])
            combos[(i, j)] = classify(plays).min(axis=0)
            combo_plays[(i, j)] = plays
    # fit-test strips: front strip (rear nominal) and rear strip (front nominal)
    fplay = np.stack([(G.base_heights(L, dF, 0)[0] + (G.base_heights(L, dF, 0)[1] - G.base_heights(L, dF, 0)[0])
                       / D * G.Y_FRONT_CLIP + g) + S["z_err"] - h_true(G.Y_FRONT_CLIP) for dF in G.BASE_FRONT])
    rplay = np.stack([(G.base_heights(L, 0, dR)[0] + (G.base_heights(L, 0, dR)[1] - G.base_heights(L, 0, dR)[0])
                       / D * G.Y_REAR_CLIP + g) + S["z_err"] - h_true(G.Y_REAR_CLIP) for dR in G.BASE_REAR])
    fi = np.argmin(np.abs(fplay - LIP_TARGET), axis=0)
    rj = np.argmin(np.abs(rplay - LIP_TARGET), axis=0)
    allq = np.stack([combos[(i, j)] for i in range(len(G.BASE_FRONT)) for j in range(len(G.BASE_REAR))])
    allp = np.stack([combo_plays[(i, j)] for i in range(len(G.BASE_FRONT)) for j in range(len(G.BASE_REAR))])
    sel = fi * len(G.BASE_REAR) + rj
    base_tested = allq[sel, np.arange(n)]
    base_tested_plays = allp[sel, :, np.arange(n)].T
    mid = (len(G.BASE_FRONT) // 2) * len(G.BASE_REAR) + len(G.BASE_REAR) // 2
    base_blind = allq[mid]
    base_blind_plays = allp[mid]

    # ---- shared checks
    pocket = (L["W"] + 2 * P["clear"]) * (1 - S["shrink"]) - P["kerf"]
    wplay = pocket - S["W"]
    wq = np.where((wplay >= WIDTH_GOOD[0]) & (wplay <= WIDTH_GOOD[1]), 2, 0)
    # closing: a lip occupies [play, play + lip_t] above its surface (play < 0:
    # it is pressed flat onto the surface), and must fit in the lid/deck gap
    def closing(lid_sel_play, base_sel_plays):
        lift = np.maximum(np.maximum(lid_sel_play, 0), np.maximum(base_sel_plays, 0).max(axis=0))
        prop = lift + P["lip_t"] - S["gap"]
        return np.where(prop <= 0.15, 2, np.where(prop <= 0.35, 1, 0))
    cq_blind = closing(lid_play[len(G.LID_SIZES) // 2], base_blind_plays)
    cq_tested = closing(lid_play[pick, np.arange(n)], base_tested_plays)
    hole_tol = (P["foot_hole_d"] - 18.0) / 2
    fq = np.where(np.hypot(S["foot_dx"], S["foot_dy"]) <= hole_tol, 2, 0)

    def pct(q):
        return dict(good=round(float(wts[q == 2].sum()) * 100, 1),
                    usable=round(float(wts[q >= 1].sum()) * 100, 1))

    out = dict(
        n=n,
        lid_each_size={G.lid_tag(L, d): pct(np.minimum(lid_q[k], wq)) for k, d in enumerate(G.LID_SIZES)},
        lid_blind_nominal=pct(np.minimum(lid_blind, wq)),
        lid_with_fit_tests=pct(np.minimum(lid_tested, wq)),
        base_blind_nominal=pct(np.minimum.reduce([base_blind, wq, fq])),
        base_with_fit_tests=pct(np.minimum.reduce([base_tested, wq, fq])),
        width=pct(wq), feet_in_holes=pct(fq),
        closing_blind=pct(cq_blind), closing_with_fit_tests=pct(cq_tested),
        whole_case_blind_nominal=pct(np.minimum.reduce([lid_blind, base_blind, wq, cq_blind, fq])),
        whole_case_with_fit_tests=pct(np.minimum.reduce([lid_tested, base_tested, wq, cq_tested, fq])),
        lid_pick_histogram={G.lid_tag(L, d): round(float(wts[pick == k].sum()) * 100, 1)
                            for k, d in enumerate(G.LID_SIZES)},
        base_pick_histogram={G.base_tag(i, j): round(float(wts[sel == i * len(G.BASE_REAR) + j].sum()) * 100, 1)
                             for i in range(len(G.BASE_FRONT)) for j in range(len(G.BASE_REAR))},
        effective_samples=int(1.0 / (wts ** 2).sum()),
    )
    return out


def stress_cases():
    return {
        "nominal laptop": {},
        "tightly rolled edges (base r 0.8 mm, lid roll 3 mm)": dict(base_roll_r=0.8, lid_roll_w=3.0),
        "thin lid edge (1.0 mm)": dict(lid_edge_t=1.0),
        "thick lid edge (2.2 mm)": dict(lid_edge_t=2.2),
        "laptop 0.5 mm wider": dict(W=300.0),
        "rubber feet 3 mm off": dict(foot_dx=2.1, foot_dy=2.1),
        "ports 5 mm further forward": dict(port_ds=5.0),
        "ports 5 mm further back": dict(port_ds=-5.0),
        "lid/deck gap only 0.6 mm": dict(gap=0.6),
    }


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
    for kind, seed, sub, name in (("top", 11, "2_lid_shell", "lid_shell_" + G.lid_tag(L, 0)),
                                  ("bottom", 23, "3_base_shell", "base_shell_" + G.base_tag(1, 1))):
        ref, croc, outer, _ = G.build_shell(kind, L, P, seed, with_texture=False, log=lambda *a: None)
        halves = G.split_halves(ref, croc, outer, P)
        parts = []
        for half, refp in zip(("LEFT", "RIGHT"), halves):
            b = refp.bounding_box()
            m = _load_mesh(os.path.join(folder, sub, f"{name}_{half}.3mf"))
            mb = m.bounding_box()
            parts.append(m.translate(((b[0] + b[3]) / 2 - (mb[0] + mb[3]) / 2,
                                      (b[1] + b[4]) / 2 - (mb[1] + mb[4]) / 2, 0)))
        b = ref.bounding_box()
        one = _load_mesh(os.path.join(folder, "4_one_piece_for_big_beds", f"{name}_ONE-PIECE_big-bed.3mf"))
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
        s.update(ov)
        res, parts = geometric_backtest(s, L, P)
        if name == "nominal laptop":
            nominal_res, nominal_parts = res, parts

        def n(key):
            return len(res[key])
        unintended = n("feet_vs_baseshell") + n("plugs_vs_baseshell") + n("closed_lidshell_vs_base") \
            + n("closed_lidshell_vs_baseshell") + n("closed_lid_vs_baseshell")
        hinge = max(d["worst_overlap_mm3"] for d in res["hinge_sweep_lidshell"])
        rows.append(dict(case=name, feet=n("feet_vs_baseshell"), plugs=n("plugs_vs_baseshell"),
                         closed=n("closed_lidshell_vs_base") + n("closed_lidshell_vs_baseshell")
                         + n("closed_lid_vs_baseshell"),
                         hinge_mm3=hinge, passed=(unintended == 0 and hinge < 0.01)))
        print(f"  {name:52s} {'PASS' if rows[-1]['passed'] else 'FAIL'}")
    s = nominal()
    render_pictures(s, L, P, nominal_parts, os.path.join(HERE, "backtest_"))
    exported = []
    mf = os.path.join(HERE, "3mf")
    if os.path.isdir(mf):
        ex = exported_shells(L, P, mf)
        for label, key in (("exported LEFT+RIGHT halves (assembled, seam gap included)", "halves"),
                           ("exported one-piece files", "one_piece")):
            r, _ = geometric_backtest(s, L, P, lid_shell=ex["top"][key], base_shell=ex["bottom"][key])
            unintended = sum(len(r[k]) for k in ("feet_vs_baseshell", "plugs_vs_baseshell", "closed_lidshell_vs_base",
                                                  "closed_lidshell_vs_baseshell", "closed_lid_vs_baseshell"))
            hinge = max(d["worst_overlap_mm3"] for d in r["hinge_sweep_lidshell"])
            lidc = sum(p["vol"] for p in r["lid_vs_lidshell"])
            basec = sum(p["vol"] for p in r["base_vs_baseshell"])
            exported.append(dict(case=label, unintended_contacts=unintended, hinge_mm3=hinge,
                                 lid_wedge_mm3=round(lidc, 1), base_wedge_mm3=round(basec, 1),
                                 passed=unintended == 0 and hinge < 0.01))
            print(f"  {label:52s} {'PASS' if exported[-1]['passed'] else 'FAIL'}  "
                  f"(clip wedge contact: lid {lidc:.0f} mm3, base {basec:.0f} mm3)")
    mc = monte_carlo(P)
    print(json.dumps(mc, indent=1))
    with open(os.path.join(HERE, "fit_backtest_results.json"), "w") as f:
        json.dump(dict(geometry=nominal_res, stress=rows, exported_files=exported, monte_carlo=mc,
                       posterior=posterior_summary(),
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
    fig, axs = plt.subplots(2, 2, figsize=(14, 9))
    ax = axs[0, 0]
    draw(ax, _section_y(parts["ls_lf"], 80.0), C_LS)
    draw(ax, _section_y(parts["lid_lf"], 80.0), C_LAP, E_LAP, 1.2, 0.8, 4)
    ax.set_title("Lid shell side clip (y = 80): lid edge wedged onto the ramp", fontsize=10)
    ax.set_xlim(-3, 7); ax.set_ylim(-2.2, 2.6); ax.invert_yaxis()
    ax.set_ylabel("mm (lid frame, display face = 0)")
    for ax, y, ttl in ((axs[0, 1], 44.0, "Base shell side clip (y = 44)"),
                       (axs[1, 0], 104.0, "Base shell side clip (y = 104)")):
        draw(ax, _section_y(parts["base_shell"], y), C_BS)
        draw(ax, _section_y(parts["base"], y), C_LAP, E_LAP, 1.2, 0.8, 4)
        h = T + s["base_h_front"] + (s["base_h_back"] - s["base_h_front"]) / G.LAPTOP["D"] * y
        ax.set_xlim(-3, 7); ax.set_ylim(h - 4.5, h + 1.6)
        ax.set_title(ttl + ": palm-rest edge wedged onto the ramp", fontsize=10)
        ax.set_ylabel("mm above print bed")
    ax = axs[1, 1]
    y = 80.0
    draw(ax, _section_y(parts["base_shell"], y), C_BS)
    draw(ax, _section_y(parts["base"], y), C_LAP, E_LAP, 1.2, 0.8, 4)
    draw(ax, _section_y(parts["lid_w"], y), "#c9c6bf", E_LAP, 1.2, 0.8, 4)
    draw(ax, _section_y(parts["ls_w"], y), C_LS)
    ax.set_xlim(-3, 7); ax.set_ylim(0, 16)
    ax.set_title("Closed laptop with both shells (y = 80): lid clip sits in the gap", fontsize=10)
    for a in axs.flat:
        a.set_aspect("equal"); a.grid(True, lw=0.3); a.set_xlabel("mm from laptop side (negative = outside)")
    plt.tight_layout()
    plt.savefig(path_prefix + "sections.png", dpi=110)
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
    yh, zh = D - 4.5, T + s["base_h_back"] + s["gap"] / 2
    ax.plot([yh], [zh], "k+", ms=12, mew=2, label="hinge axis (estimated)")
    ax.set_xlim(D - 45, D + 15); ax.set_ylim(-2, 40)
    ax.set_aspect("equal"); ax.grid(True, lw=0.3); ax.legend(fontsize=8, loc="upper left")
    ax.set_title("Opening the lid 0-135 deg: the lid shell's back edge never reaches the base or base shell",
                 fontsize=10)
    ax.set_xlabel("mm from the front edge"); ax.set_ylabel("mm above print bed")
    plt.tight_layout()
    plt.savefig(path_prefix + "hinge.png", dpi=110)
    plt.close()

    # ---------------- ports (side elevations)
    fig, axs = plt.subplots(2, 1, figsize=(13, 6.5))
    for ax, side, xcut in ((axs[0], "L", -1.0), (axs[1], "R", s["W"] + 1.0)):
        draw(ax, _section_x(parts["base_shell"], xcut), C_BS)
        for sd, sc, w, h, zc, name in PLUGS:
            if sd != side:
                continue
            yc = D - sc
            ax.add_patch(plt.Rectangle((yc - w / 2, T + zc - h / 2), w, h, fill=False, ec="#2e6db0", lw=1.6,
                                       zorder=7))
            ax.text(yc, T + zc + h / 2 + 0.6, name, ha="center", fontsize=8, color="#2e6db0")
        hf, hb = s["base_h_front"], s["base_h_back"]
        ax.plot([0, D], [T + hf, T + hb], color=E_LAP, lw=1.0, ls="--", label="palm-rest edge")
        ax.plot([0, D], [T, T], color=E_LAP, lw=1.0, ls=":", label="laptop bottom")
        ax.set_xlim(D - 95, D + 5); ax.set_ylim(-1, 16); ax.set_aspect("equal"); ax.grid(True, lw=0.3)
        ax.set_title(("Left" if side == "L" else "Right") + " side wall seen from outside: plug bodies vs. window",
                     fontsize=10)
        ax.legend(fontsize=8, loc="upper left")
    axs[1].set_xlabel("mm from the front edge")
    plt.tight_layout()
    plt.savefig(path_prefix + "ports.png", dpi=110)
    plt.close()


if __name__ == "__main__":
    main()
