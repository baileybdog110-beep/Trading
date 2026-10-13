#!/usr/bin/env python3
"""
Blind-print fit model (v2) for the A1465 alligator case: no fit tests, one
lid shell and one base shell, so every dimension has to be right first time.

What it models (all in mm):
  * Laptop: priors from the camera-model re-measurement of the side photo
    (deck heights at the two base-clip positions, correlated), a rounded
    front taper, the lid/deck gap opening towards the front, lid thickness
    checked against Apple's published 0.68 in back thickness, corner radius,
    edge radius at the clip contact.
  * Printer: TPU shrink, Z error, layer quantisation of sloped lips, the
    glued seam closing up.
  * Clips (FE-informed thresholds, see README): every clip is classed by
      - preload p < 0   (laptop thicker: the hook rotates out)
      - wedge flex      d = (Rv - p)/tan(a) - c_eff - edge_r*(sin a + cos a - 1)/sin a
      - free play       when d < 0.2
      - snap-over       reach - c_eff (installation)
    at every clip END (the base lips and the laptop deck are both sloped).
  * Closing: each lip sits in the lid/deck gap together with the other
    shell's wall, weighted by its lever about the hinge (front-equivalent).
  * Feet in their holes.
"""
import math

import numpy as np

D = 192.0
W_NOM = 299.5
HINGE_Y = 187.5

PRIORS = {
    # name: (mean, sd, evidence)
    "W": (299.5, 0.20, "Apple 29.95 cm"),
    "R_front": (10.0, 0.60, "rectified bottom-case photo"),
    "lid_t": (4.90, 0.35, "not published; checked against the 17.3 mm back thickness"),
    "h44": (3.65, 0.40, "camera-model fit of the side photo, deck at y=44"),
    "h104": (5.81, 0.35, "camera-model fit of the side photo, deck at y=104"),
    "gap_back": (0.86, 0.10, "side photo; opens ~0.11 mm per 83 mm towards the front"),
    "foot_p": (2.0, 0.30, "A1465 replacement-foot design"),
    "taper_onset": (43.0, 16.0, "front taper starts this far from the front edge"),
    "edge_r": (0.30, 0.10, "laptop edge radius where it meets the clip ramp"),
    "shrink": (0.003, 0.0015, "TPU in-plane shrink"),
    "z_err": (0.0, 0.06, "printer Z error"),
    "foot_dx": (0.0, 1.0, "foot position error"),
    "foot_dy": (0.0, 1.0, "foot position error"),
}
H_CORR = 0.9            # deck heights at y=44 and y=104 share the photo-scale error
FRONT_DROP = 1.2        # rounded front: deck at y=0 sits ~1.2 below the straight line
OBS_BACK = (17.4, 0.6)  # lid + deck(back) + gap + feet; Apple 17.3, caliper 17.8

# FE-informed thresholds (TPU 95A, 1.6 mm walls; see README "Fit model")
PRELOAD = (-0.45, -0.70)          # GOOD / OK lower bounds for p
MIN_FLEX = 0.2                    # wedge flex needed for a snug, non-rattling grip
FREE_PLAY_OK = 0.30               # vertical free play still usable
FLEX = {"base": ((1.2, 1.6), (1.6, 2.0)), "lid": ((1.4, 1.8), (1.8, 2.2)),
        "corner": ((1.2, 1.6), (1.2, 1.6))}      # (unslotted, slotted) x (GOOD, OK)
SNAP = {"base": ((2.2, 2.6), (2.6, 3.0)), "lid": ((3.0, 3.4), (3.2, 3.6)),
        "corner": ((2.6, 3.0), (2.6, 3.0))}
CLOSE_FRONT_EQ = (0.30, 0.60)     # lid held open at the front edge, GOOD / OK


def sample(n, seed=1):
    rng = np.random.default_rng(seed)
    S = {k: rng.normal(m, s, n) for k, (m, s, _) in PRIORS.items()}
    z1, z2 = rng.standard_normal(n), rng.standard_normal(n)
    m1, s1, _ = PRIORS["h44"]
    m2, s2, _ = PRIORS["h104"]
    S["h44"] = m1 + s1 * z1
    S["h104"] = m2 + s2 * (H_CORR * z1 + math.sqrt(1 - H_CORR ** 2) * z2)
    S["taper_onset"] = np.clip(S["taper_onset"], 5, None)
    S["edge_r"] = np.clip(S["edge_r"], 0.05, 0.6)
    S["shrink"] = np.clip(S["shrink"], 0.0, None)
    S["q"] = rng.uniform(-0.5, 0.5, (8, n))      # layer-quantisation fractions
    deck_back = deck(S, D)
    S["w"] = np.exp(-0.5 * ((S["lid_t"] + deck_back + S["gap_back"] + S["foot_p"] - OBS_BACK[0])
                            / OBS_BACK[1]) ** 2)
    S["w"] /= S["w"].sum()
    return S


def deck(S, y):
    """True deck (palm-rest edge) height above the laptop bottom at y."""
    lin = S["h44"] + (S["h104"] - S["h44"]) * (y - 44.0) / 60.0
    drop = FRONT_DROP * np.clip(1 - y / S["taper_onset"], 0, None) ** 2
    return lin - drop


def gap(S, y):
    return S["gap_back"] + 0.11 * (HINGE_Y - y) / 83.0


def lever(y):
    return HINGE_Y / (HINGE_Y - y)


CURRENT = dict(  # what the files on the branch were built with (0c21bc7)
    lid_lip=4.90, b44=3.048, b104=5.704, ramp_v=0.9, ramp_deg=45.0, reach=2.0, clear=0.30,
    lip_t=0.48, wall_drop=0.10, slots=False, corner_dR=0.0, layer=0.16, front_cap=None,
    lid_side=((68, 90), (140, 165)), base_side=((30, 58), (94, 113)), kerf=0.2)


def base_line(d, y):
    return d["b44"] + (d["b104"] - d["b44"]) * (y - 44.0) / 60.0


def classify_clip(kind, p, c, d, S):
    a = math.radians(d["ramp_deg"])
    ta = math.tan(a)
    edge = S["edge_r"] * (math.sin(a) + math.cos(a) - 1) / math.sin(a)
    flex = (d["ramp_v"] - p) / ta - c - edge
    slot = 1 if d["slots"] else 0
    fg, fo = FLEX[kind][slot]
    sg, so = SNAP[kind][slot]
    snap = d["reach"] - c
    q = np.full(p.shape, 2)
    # preload (thicker laptop)
    q = np.minimum(q, np.where(p >= PRELOAD[0], 2, np.where(p >= PRELOAD[1], 1, 0)))
    # wedge flex too large
    q = np.minimum(q, np.where(flex <= fg, 2, np.where(flex <= fo, 1, 0)))
    # loose (thinner laptop)
    q = np.minimum(q, np.where(flex >= MIN_FLEX, 2, np.where(flex >= -FREE_PLAY_OK / ta, 1, 0)))
    # installation
    q = np.minimum(q, np.where(snap <= sg, 2, np.where(snap <= so, 1, 0)))
    return q


def evaluate(d, S):
    """Return per-sample class (2 GOOD, 1 usable, 0 fail) and component breakdown."""
    n = S["W"].shape[0]
    L = d["layer"]
    pocket = (W_NOM + 2 * d["clear"]) * (1 - S["shrink"]) - d["kerf"]
    c = (pocket - S["W"]) / 2
    p_lid = d["lid_lip"] + S["z_err"] - S["lid_t"]          # lid lip snapped to the layer grid
    comps = {}
    lid_q = []
    lid_q.append(classify_clip("lid", p_lid, c, d, S))
    if d.get("corner_arc_lip", True):   # lip on the 90 deg arc: sensitive to the corner radius
        c_corner = c + 0.4142 * (S["R_front"] - 10.0 + d["corner_dR"])
        lid_q.append(classify_clip("corner", p_lid, c_corner, d, S))
    comps["lid clips"] = np.minimum.reduce(lid_q)
    base_q, base_p = [], {}
    k = 0
    for (y0, y1) in d["base_side"]:
        for y in (y0, (y0 + y1) / 2, y1):
            pb = base_line(d, y) + S["z_err"] + L * S["q"][k % 8] - deck(S, y)
            k += 1
            base_p[y] = pb
            base_q.append(classify_clip("base", pb, c, d, S))
    comps["base clips"] = np.minimum.reduce(base_q)

    # closing, front-equivalent, at every clip position + plain walls
    wd, lt = d["wall_drop"], d["lip_t"]

    def base_wall_intrusion(y):
        top = base_line(d, y) - wd
        if d.get("front_cap") is not None and y < 30:
            top = min(top, d["front_cap"] + (y / 30.0) * (base_line(d, 30) - wd - d["front_cap"]))
        return np.maximum(top + S["z_err"] - deck(S, y), 0)

    props = []
    lid_clip_ys = [0.0] + [max(z) for z in d["lid_side"]]
    for y in lid_clip_ys:
        pr = np.maximum(p_lid, 0) + lt + base_wall_intrusion(y) - gap(S, y)
        props.append(pr * lever(y))
    for y, pb in base_p.items():
        pr = np.maximum(pb, 0) + lt + np.maximum(p_lid - wd, 0) - gap(S, y)
        props.append(pr * lever(y))
    for y in (10.0, 100.0, 170.0):   # plain walls only
        pb = base_line(d, y) - wd + S["z_err"] - deck(S, y)
        pr = np.maximum(p_lid - wd, 0) + np.maximum(pb, 0) - gap(S, y)
        props.append(pr * lever(y))
    worst = np.max(np.stack(props), axis=0)
    comps["closing"] = np.where(worst <= CLOSE_FRONT_EQ[0], 2, np.where(worst <= CLOSE_FRONT_EQ[1], 1, 0))
    tol = (d.get("foot_hole_d", 25.0) - 18.0) / 2
    comps["feet"] = np.where(np.hypot(S["foot_dx"], S["foot_dy"]) <= tol, 2, 0)
    whole = np.minimum.reduce(list(comps.values()))
    return whole, comps


def score(d, S):
    whole, comps = evaluate(d, S)
    w = S["w"]
    res = dict(good=float(w[whole == 2].sum()) * 100, usable=float(w[whole >= 1].sum()) * 100)
    res["components"] = {k: (round(float(w[v == 2].sum()) * 100, 1), round(float(w[v >= 1].sum()) * 100, 1))
                         for k, v in comps.items()}
    return res


def objective(r):
    # snug first, but never trade more than ~1 point of "usable" for it
    return r["good"] + 1.5 * r["usable"]


def optimize(start, S, grid, rounds=4, log=print):
    best = dict(start)
    best_r = score(best, S)
    for rnd in range(rounds):
        improved = False
        for key, values in grid.items():
            for v in values:
                cand = dict(best, **{key: v})
                if not feasible(cand):
                    continue
                r = score(cand, S)
                if objective(r) > objective(best_r) + 1e-9:
                    best, best_r, improved = cand, r, True
        log(f"  round {rnd + 1}: good {best_r['good']:.1f} %, usable {best_r['usable']:.1f} %")
        if not improved:
            break
    return best, best_r


def feasible(d):
    a = math.radians(d["ramp_deg"])
    ramp_h = d["ramp_v"] / math.tan(a)
    overhang = d["reach"] - ramp_h
    return 45.0 <= d["ramp_deg"] <= 57.0 and 0.5 <= overhang <= 0.8 and d["lip_t"] >= 0.3


PROPOSED_START = dict(
    lid_lip=4.95, b44=3.65, b104=5.81, ramp_v=1.43, ramp_deg=55.0, reach=1.8, clear=0.45,
    lip_t=0.36, wall_drop=0.6, slots=True, corner_dR=0.6, layer=0.12, front_cap=0.8, corner_arc_lip=False,
    lid_side=((62, 82), (110, 124)), base_side=((38, 56), (88, 104)), kerf=0.2)


def search(n=200000, seed=1, log=print):
    S = sample(n, seed)
    cur = score(CURRENT, S)
    log(f"current files under this model: good {cur['good']:.1f} %, usable {cur['usable']:.1f} %  {cur['components']}")
    grid = {
        "lid_lip": [round(4.6 + 0.02 * i, 2) for i in range(41)],
        "b44": [round(3.1 + 0.03 * i, 2) for i in range(37)],
        "b104": [round(5.3 + 0.03 * i, 2) for i in range(34)],
        "ramp_deg": [45.0, 50.0, 55.0, 57.0],
        "ramp_v": [round(1.0 + 0.05 * i, 2) for i in range(17)],
        "reach": [round(1.4 + 0.05 * i, 2) for i in range(17)],
        "clear": [round(0.25 + 0.025 * i, 3) for i in range(15)],
        "wall_drop": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
        "corner_dR": [0.0, 0.3, 0.6, 0.9, 1.2],
        "lip_t": [0.36, 0.48],
    }
    best, r = optimize(PROPOSED_START, S, grid, log=log)
    return best, r, cur


def design_from_case(L, P, zones=None):
    """The design as the generator builds it (generate_case.LAPTOP / CASE)."""
    k = (L["base_h_back"] - L["base_h_front"]) / L["D"]
    if zones is None:
        import generate_case as G
        zones = {kind: G.clip_zones(kind, L) for kind in ("top", "bottom")}

    def side_spans(kind):
        return tuple(sorted({(z[2], z[3]) for z in zones[kind] if z[4] == "side" and z[0] < 0 and z[2] > 30}))
    return dict(
        lid_lip=L["lid_t"] + P["lip_gap"],
        b44=L["base_h_front"] + k * 44.0 + P["lip_gap"],
        b104=L["base_h_front"] + k * 104.0 + P["lip_gap"],
        ramp_v=P["lip_ramp"], ramp_deg=P["ramp_deg"], reach=P["lip_reach"], clear=P["clear"],
        lip_t=P["lip_t"], wall_drop=P["wall_drop"], slots=P["slot_w"] > 0, corner_dR=0.0,
        layer=0.12, front_cap=P["base_front_cap"], corner_arc_lip=False,
        lid_side=side_spans("top"), base_side=side_spans("bottom"), kerf=P["kerf"],
        foot_hole_d=P["foot_hole_d"])


def posterior(S, keys=("lid_t", "h44", "h104", "gap_back", "foot_p", "taper_onset")):
    w = S["w"]
    out = {}
    for k in keys:
        m = float((w * S[k]).sum())
        out[k] = dict(prior=[PRIORS[k][0], PRIORS[k][1]],
                      posterior=[round(m, 3), round(float(np.sqrt((w * (S[k] - m) ** 2).sum())), 3)])
    out["effective_samples"] = int(1.0 / (w ** 2).sum())
    return out


def sensitivity(d, n=200000, seed=1):
    """Fit odds if one prior mean is off by +/- one standard deviation."""
    out = {}
    for k in ("lid_t", "h44", "h104", "gap_back", "R_front", "edge_r", "taper_onset"):
        m, sd, note = PRIORS[k]
        row = {}
        for sgn in (-1, 1):
            PRIORS[k] = (m + sgn * sd, sd, note)
            try:
                r = score(d, sample(n, seed))
            finally:
                PRIORS[k] = (m, sd, note)
            row["-1sd" if sgn < 0 else "+1sd"] = (round(r["good"], 1), round(r["usable"], 1))
        out[k] = row
    return out


if __name__ == "__main__":
    import sys
    if "--search" in sys.argv:
        best, r, cur = search()
        print(best)
        print(r)
    else:
        import generate_case as G
        d = design_from_case(G.LAPTOP, G.CASE)
        S = sample(200000, 1)
        print("design:", d)
        print("as built:", score(d, S))
        print("old files:", score(CURRENT, S))
        print("posterior:", posterior(S))
