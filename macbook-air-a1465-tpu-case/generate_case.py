#!/usr/bin/env python3
"""
Alligator-skin TPU snap-on case for the MacBook Air 11" (model A1465, 2012-2015).
The A1370 (2010-2011) uses the same chassis dimensions.

Two shells:
  * TOP shell    - clips onto the lid (display back).
  * BOTTOM shell - clips onto the base, with port windows, rubber-foot holes
                   and a finger notch at the front.

Outputs (3mf/ always, stl/ for the nominal "B" size):
  1_fit_tests/               small corner / strip pieces in sizes A, B, C
  2_lid_shell/, 3_base_shell/  LEFT + RIGHT halves (fit a 256 x 256 mm bed,
                             e.g. Bambu P1S / X1C / P2S / A1) in sizes A, B, C.
                             The split runs along the alligator-scale grooves
                             and interlocks with dovetail-shaped scales.
  4_one_piece_for_big_beds/  one-piece shells (>= 310 x 200 mm bed, H2D/H2S)

Coordinates (laptop frame): x = left->right across the width, y = front->back,
z = up from the outer (textured) face, which is also the print bed side.

Run:  python3 generate_case.py                (everything, ~1 min)
      python3 generate_case.py --lid-t 5.1    (tune the fit, see README)
"""
import argparse
import json
import math
import os
import time

import numpy as np
import manifold3d as m3d
import trimesh
from scipy.ndimage import binary_dilation
from scipy.spatial import Delaunay, cKDTree

# --------------------------------------------------------------------------
# MacBook Air 11" A1465 reference dimensions (mm)
#   W, D           : Apple tech specs (29.95 cm x 19.2 cm)
#   R_front        : front corner radius, measured from a rectified photo
#   feet           : rubber-foot centres, measured from a rectified photo of
#                    the bottom case (Apple part 923-0436), foot dia ~18 mm
#   base_h_*       : bottom plane -> keyboard-deck edge, measured from a
#                    side-on photo (scaled by the USB-A / 3.5 mm jack openings)
#   lid_t          : lid thickness (outer aluminium -> display face); Apple
#                    does not publish it, derived from the 17 mm closed height
#   ports          : distances measured from the BACK edge along the side
# --------------------------------------------------------------------------
LAPTOP = dict(
    W=299.5,
    D=192.0,
    R_front=10.0,
    R_back=4.0,
    lid_t=4.9,
    base_h_front=1.35,
    base_h_back=9.6,
    feet=[(24.4, 26.0), (275.1, 26.0), (24.4, 171.8), (275.1, 171.8)],
    # left side : MagSafe 2 (~7-25), USB 3 (~29-43), headphone (~57), mics (~71)
    # (windows run out through the back edge so no thin wall stub is left
    #  behind the MagSafe port)
    port_window_left=(-5.0, 77.0),
    # right side: Thunderbolt (~9-19), USB 3 (~27-42)
    port_window_right=(-5.0, 51.0),
)

CASE = dict(
    clear=0.25,        # laptop outline -> pocket wall, per side
    wall=1.6,          # side wall thickness (4 x 0.4 mm lines)
    plate=2.0,         # outer face (scale tops) -> inner floor
    chamfer=0.8,       # 45 deg chamfer on the bed-side outer edge (no elephant foot)
    inner_fillet=0.8,  # 45 deg fill where floor meets wall (laptop edges are rolled)
    lip_reach=2.0,     # clip lip reach, measured inward from the pocket wall
    lip_t=0.6,         # clip lip thickness (sits in the ~0.9 mm lid/base gap)
    lip_gap=0.0,       # display-face / deck -> lip underside (0 = nominal surface)
    lip_ramp=1.0,      # 45 deg wedge ramp under the lip: the edge of the lid / palm
                       # rest wedges onto it anywhere over ~0.9 mm of height while
                       # the TPU wall flexes out, so the clip grips across the
                       # whole tolerance range (and it prints without supports)
    wall_drop=0.1,     # plain walls stop this far below the display face / deck
    top_back_trim=10.0,    # lid shell stops short of the hinge (hinge-sweep backtest)
    top_back_chamfer=1.4,  # bed-side 45 deg chamfer on the lid shell back edge
    top_wall_end=12.0,     # lid shell side walls end this far from the back edge
    bottom_back_trim=1.5,  # base shell floor stops short of the back edge
    port_cut_in=0.6,     # port windows reach this far under the laptop edge
    port_floor_cut=1.0,  # ... and dip this far into the floor for plug overmolds
    foot_hole_d=25.0,  # holes for the 18 mm rubber feet (+/-3.5 mm position tolerance)
    kerf=0.2,          # gap between the two halves
    # texture
    grid=0.3,          # heightfield resolution
    tex_depth=0.75,    # groove depth
    groove_g0=0.28,    # half-width of the flat groove bottom
    groove_g1=1.30,    # half-width where the groove shoulder meets the scale top
    border=7.0,        # smooth "binding" band around the alligator panel
    stitch_inset=3.6,
    stitch_pitch=4.0,
    stitch_len=2.4,
    stitch_w=0.9,
    stitch_depth=0.5,
)

# Clip (lip) zones. Top-shell and bottom-shell clips never overlap, so the
# laptop still closes: only one 0.6 mm lip sits in the lid/base gap anywhere.
def clip_zones(kind, L):
    W, D = L["W"], L["D"]
    zones = []
    def mirror_x(x0, x1):
        return (W - x1, W - x0)
    if kind == "top":
        # front corner pockets
        zones += [(-6, 26, -6, 26), (W - 26, W + 6, -6, 26)]
        # front edge
        for x0, x1 in [(80, 108)]:
            zones += [(x0, x1, -6, 5), (*mirror_x(x0, x1), -6, 5)]
        # sides
        for y0, y1 in [(68, 90), (140, 165)]:
            zones += [(-6, 5, y0, y1), (W - 5, W + 6, y0, y1)]
    else:
        # (no clips on the base's front edge: it is only ~1.4 mm tall there)
        zones += [(-6, 5, 30, 58), (W - 5, W + 6, 30, 58)]
        zones += [(-6, 5, 94, 113), (W - 5, W + 6, 94, 128)]
    return zones


# --------------------------------------------------------------------------
# 2D helpers
# --------------------------------------------------------------------------
def rrect_pts(x0, y0, x1, y1, rf, rb, seg=0.35):
    """CCW rounded rectangle; front (y0) corners radius rf, back (y1) corners rb."""
    rf = max(rf, 0.05)
    rb = max(rb, 0.05)
    pts = []

    def arc(cx, cy, r, a0, a1):
        n = max(6, int(math.ceil(abs(a1 - a0) * r / seg)))
        for t in np.linspace(a0, a1, n + 1):
            pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))

    arc(x1 - rf, y0 + rf, rf, -math.pi / 2, 0)
    arc(x1 - rb, y1 - rb, rb, 0, math.pi / 2)
    arc(x0 + rb, y1 - rb, rb, math.pi / 2, math.pi)
    arc(x0 + rf, y0 + rf, rf, math.pi, 1.5 * math.pi)
    return np.array(pts)


class RRect:
    """Rounded rectangle with separate front/back corner radii + exact SDF."""

    def __init__(self, x0, y0, x1, y1, rf, rb):
        self.x0, self.y0, self.x1, self.y1, self.rf, self.rb = x0, y0, x1, y1, rf, rb

    def inset(self, u):
        return RRect(self.x0 + u, self.y0 + u, self.x1 - u, self.y1 - u,
                     max(self.rf - u, 0.05), max(self.rb - u, 0.05))

    def pts(self):
        return rrect_pts(self.x0, self.y0, self.x1, self.y1, self.rf, self.rb)

    def cs(self):
        return m3d.CrossSection([self.pts()])

    def sdf(self, X, Y):
        cx, cy = (self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2
        hx, hy = (self.x1 - self.x0) / 2, (self.y1 - self.y0) / 2
        r = np.where(Y < cy, self.rf, self.rb)
        qx = np.abs(X - cx) - (hx - r)
        qy = np.abs(Y - cy) - (hy - r)
        out = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0))
        return out + np.minimum(np.maximum(qx, qy), 0) - r


def _zwarp(cs, zfun):
    """Extrude cs, then set every bottom/top vertex z exactly via zfun(y, is_top).

    Computing z per vertex (instead of extrude+translate) gives bit-identical
    heights wherever two parts share a level, so booleans never see faces that
    are off by one rounding step."""
    m = m3d.Manifold.extrude(cs, 1.0)

    def f(v):
        v = np.array(v, dtype=np.float64)
        top = v[:, 2] > 0.5
        v[:, 2] = np.where(top, zfun(v[:, 1], True), zfun(v[:, 1], False))
        return v
    return m.warp_batch(f)


def prism(cs, z0, z1):
    return _zwarp(cs, lambda y, top: np.full_like(y, z1 if top else z0))


def box(x0, x1, y0, y1, z0, z1):
    return m3d.Manifold.cube((x1 - x0, y1 - y0, z1 - z0)).translate((x0, y0, z0))


def slab_rel(cs, v0, v1, base, slope):
    """Extrude cs between the planes z = base + slope*y + v0 and ... + v1."""
    return _zwarp(cs, lambda y, top: base + slope * y + (v1 if top else v0))


def u_notch_x(xc, half_w, z_bot, r, y0, y1, ztop=60):
    """Notch through a front/back wall: U shape in the XZ plane, spans y0..y1."""
    pts = rrect_pts(xc - half_w, z_bot, xc + half_w, ztop, r, 0.05)
    cs = m3d.CrossSection([pts])
    m = m3d.Manifold.extrude(cs, y1 - y0).rotate((90, 0, 0))   # extrude goes to -y
    return m.translate((0, y1, 0))


def u_notch_y(yc0, yc1, z_bot, r, x0, x1, ztop=60):
    """Window through a side wall: U shape in the YZ plane, spans x0..x1."""
    pts = rrect_pts(yc0, z_bot, yc1, ztop, r, 0.05)
    cs = m3d.CrossSection([pts])
    m = m3d.Manifold.extrude(cs, x1 - x0).rotate((90, 0, 90))  # (a,b,e)->(e,a,b)
    return m.translate((x0, 0, 0))


# --------------------------------------------------------------------------
# Alligator (crocodile belly) scale pattern
# --------------------------------------------------------------------------
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def smin(a, b, k):
    """Polynomial smooth minimum -> rounded scale corners."""
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.minimum(a, b) - h * h * k * 0.25


class CrocPattern:
    """Belly-cut alligator hide.

    Belly: the centre line runs left->right through the middle of the panel.
    Scales sit in columns 10.5-14 mm wide; inside a column they are tallest at
    the belly centre (~19 mm) and get shorter towards the belly edge, with
    rounded corners.
    Flanks: beyond a gently wavy line near the front and back edges, the belly
    gives way to smaller, irregular polygonal flank scales (Voronoi cells) that
    shrink towards the edge, as on a real belly-cut hide.
    Seam: one column boundary is forced onto x_seam so the two printable halves
    split inside a groove; four belly scales next to the seam are cut as
    dovetails so the halves interlock.
    """

    def __init__(self, xmin, xmax, ymin, ymax, x_seam, seed):
        rng = np.random.default_rng(seed)
        self.x_seam = x_seam
        self.ymin, self.ymax = ymin, ymax
        self.y_mid = 0.5 * (ymin + ymax)
        half = 0.5 * (ymax - ymin)

        # ---- belly columns
        right = [x_seam]
        x = x_seam
        while x < xmax + 15:
            x += rng.uniform(10.5, 14.0)
            right.append(x)
        left = []
        x = x_seam
        while x > xmin - 15:
            x -= rng.uniform(10.5, 14.0)
            left.append(x)
        self.xb = np.array(sorted(left) + right)
        nb = len(self.xb)
        self.i_seam = int(np.argmin(np.abs(self.xb - x_seam)))
        self.amp = rng.uniform(0.2, 0.55, nb)
        self.lam = rng.uniform(55, 110, nb)
        self.ph = rng.uniform(0, 2 * math.pi, nb)
        for i in (self.i_seam - 1, self.i_seam, self.i_seam + 1):
            self.amp[i] = 0.0  # straight boundaries around the seam

        # ---- belly / flank boundary lines (front and back)
        self.bh = 0.66 * half
        self.fb = []
        for sgn in (-1, +1):
            self.fb.append(dict(sgn=sgn, a=rng.uniform(0.8, 1.6), lam=rng.uniform(70, 120),
                                ph=rng.uniform(0, 2 * math.pi),
                                a2=rng.uniform(0.3, 0.7), lam2=rng.uniform(25, 40),
                                ph2=rng.uniform(0, 2 * math.pi)))

        self.rows = []
        for i in range(nb - 1):
            xm = 0.5 * (self.xb[i] + self.xb[i + 1])
            ys, ss = [], []
            y = self.y_mid - rng.uniform(0, 19)
            while y > ymin - 30:
                y -= 19.0 * (1 - 0.42 * min(1.0, abs(y - self.y_mid) / self.bh) ** 1.5) * rng.uniform(0.85, 1.15)
            while y < ymax + 30:
                ys.append(y)
                ss.append(rng.uniform(-0.07, 0.07))
                t = min(1.0, abs(y - self.y_mid) / self.bh)
                y += 19.0 * (1 - 0.42 * t ** 1.5) * rng.uniform(0.85, 1.15)
            self.rows.append(dict(xm=xm, ys=np.array(ys), ss=np.array(ss)))

        # ---- flank scales: jittered seeds, smaller towards the edge
        seeds = []
        for f in self.fb:
            y_in = self.y_mid + f["sgn"] * (self.bh - 3)
            y_out = (ymax + 12) if f["sgn"] > 0 else (ymin - 12)
            width = abs(y_out - y_in)
            y = y_in
            while (y - y_out) * f["sgn"] < 0:
                t = min(1.0, abs(y - y_in) / max(width - 12, 1))
                s = 7.8 - 2.6 * t
                x = xmin - 15 + rng.uniform(0, s)
                while x < xmax + 15:
                    seeds.append((x + rng.uniform(-0.3, 0.3) * s, y + rng.uniform(-0.3, 0.3) * s))
                    x += s * rng.uniform(0.9, 1.15)
                y += f["sgn"] * s * 0.87
        self.seeds = np.array(seeds)
        self.tree = cKDTree(self.seeds)

        # ---- dovetail scales next to the seam (fully inside the belly)
        # Pick up to two scales on each side of the seam; their spans at x_seam
        # must not overlap so the split line stays a simple path.
        from itertools import combinations
        cands = []
        for row_i, sign in ((self.i_seam, +1), (self.i_seam - 1, -1)):
            row = self.rows[row_i]
            xo = self.xb[row_i + 1] if sign > 0 else self.xb[row_i]
            for k in range(len(row["ys"]) - 1):
                ya, yb = row["ys"][k], row["ys"][k + 1]
                if yb - ya < 12.5:
                    continue
                s_lo, s_hi = -0.16 * sign, 0.16 * sign
                ends = np.array([x_seam, xo])
                lo = ya + s_lo * (ends - row["xm"])
                hi = yb + s_hi * (ends - row["xm"])
                if (lo < self.fb_y(0, ends) + 2.5).any() or (hi > self.fb_y(1, ends) - 2.5).any():
                    continue
                cands.append((row_i, k, sign, lo[0], hi[0]))
        best, best_score = [], -1
        for n in (4, 3, 2):
            for combo in combinations(cands, n):
                if len({c[2] for c in combo}) < 2:
                    continue
                if max(sum(c[2] > 0 for c in combo), sum(c[2] < 0 for c in combo)) > 2:
                    continue
                iv = sorted((c[3], c[4]) for c in combo)
                gaps = [iv[j + 1][0] - iv[j][1] for j in range(len(iv) - 1)]
                if min(gaps) < 1.5:
                    continue
                if len({(c[0], c[1] + d) for c in combo for d in (-1, 0, 1)}) < 3 * len(combo):
                    continue  # adjacent scales in one column would share a line
                score = n * 1000 + min(gaps) + (iv[-1][1] - iv[0][0]) * 0.1
                if score > best_score:
                    best, best_score = combo, score
            if best:
                break
        self.dovetails = []
        for row_i, k, sign, _, _ in best:
            row = self.rows[row_i]
            # +1 (right of seam, goes to the LEFT half): widen to the right
            # -1 (left of seam, goes to the RIGHT half): widen to the left
            row["ss"][k] = -0.16 * sign
            row["ss"][k + 1] = 0.16 * sign
            self.dovetails.append((row_i, k))

    def fb_y(self, j, X):
        f = self.fb[j]
        return (self.y_mid + f["sgn"] * self.bh
                + f["a"] * np.sin(2 * math.pi * X / f["lam"] + f["ph"])
                + f["a2"] * np.sin(2 * math.pi * X / f["lam2"] + f["ph2"]))

    def xbound(self, i, Y):
        return self.xb[i] + self.amp[i] * np.sin(2 * math.pi * Y / self.lam[i] + self.ph[i])

    def distance(self, X, Y):
        """Distance from each point to the nearest scale boundary (groove centre)."""
        d = np.full(X.shape, np.inf)
        y_lo, y_hi = self.fb_y(0, X), self.fb_y(1, X)
        d_fb = np.minimum(np.abs(Y - y_lo), np.abs(Y - y_hi))
        belly = (Y > y_lo) & (Y < y_hi)

        # belly
        Xb, Yb = X[belly], Y[belly]
        db = np.full(Xb.shape, np.inf)
        ri = np.clip(np.searchsorted(self.xb, Xb) - 1, 0, len(self.rows) - 1)
        for _ in range(2):  # correct for the wavy column boundaries
            xl = self.xbound(ri, Yb)
            xr = self.xbound(np.minimum(ri + 1, len(self.xb) - 1), Yb)
            ri = np.where(Xb < xl, ri - 1, np.where(Xb >= xr, ri + 1, ri))
            ri = np.clip(ri, 0, len(self.rows) - 1)
        for i, row in enumerate(self.rows):
            m = ri == i
            if not m.any():
                continue
            x, y = Xb[m], Yb[m]
            dl = np.minimum(x - self.xbound(i, y), self.xbound(i + 1, y) - x)
            yl = row["ys"][:, None] + row["ss"][:, None] * (x[None, :] - row["xm"])
            dv = (np.abs(y[None, :] - yl) / np.sqrt(1 + row["ss"][:, None] ** 2)).min(axis=0)
            db[m] = smin(dl, dv, 1.6)
        d[belly] = smin(db, d_fb[belly], 1.6)

        # flanks
        fl = ~belly
        if fl.any():
            P = np.column_stack([X[fl], Y[fl]])
            dist, idx = self.tree.query(P, k=2)
            s1, s2 = self.seeds[idx[:, 0]], self.seeds[idx[:, 1]]
            sep = np.linalg.norm(s2 - s1, axis=1)
            dvor = (dist[:, 1] ** 2 - dist[:, 0] ** 2) / (2 * np.maximum(sep, 1e-6))
            dvor = np.minimum(dvor, np.abs(X[fl] - self.x_seam))
            d[fl] = smin(dvor, d_fb[fl], 1.2)
        return d

    def seam_polygon(self, y_lo, y_hi, x_far):
        """CCW polygon of the LEFT half's region, following groove centre lines."""
        xs = self.x_seam
        events = []
        for row_i, k in self.dovetails:
            row = self.rows[row_i]
            xo = self.xb[row_i + 1] if row_i == self.i_seam else self.xb[row_i]
            la = lambda x, k=k, row=row: row["ys"][k] + row["ss"][k] * (x - row["xm"])
            lb = lambda x, k=k, row=row: row["ys"][k + 1] + row["ss"][k + 1] * (x - row["xm"])
            events.append((la(xs), [(xs, la(xs)), (xo, la(xo)), (xo, lb(xo)), (xs, lb(xs))]))
        events.sort(key=lambda e: e[0])
        pts = [(x_far, y_lo), (xs, y_lo)]
        for _, p in events:
            pts += p
        pts += [(xs, y_hi), (x_far, y_hi)]
        return np.array(pts)


def texture_relief(kind, outer, croc, X, Y, P):
    """Recess depth r(x,y) of the outer face (0 = scale top, touches the bed)."""
    sd = outer.sdf(X, Y)
    inset = -sd
    r = np.zeros_like(X)

    # alligator panel + crease around it
    dpanel = inset - P["border"]
    inside = dpanel > 0
    dc = np.full(X.shape, np.inf)
    if inside.any():
        dc[inside] = croc.distance(X[inside], Y[inside])
    dtot = np.minimum(dc, np.abs(dpanel))
    # the centre seam groove continues through the border band
    band = (inset > 0.9) & ~inside
    dtot[band] = np.minimum(dtot[band], np.abs(X[band] - croc.x_seam))
    r = P["tex_depth"] * (1 - smoothstep(P["groove_g0"], P["groove_g1"], dtot))

    # stitching along the border band
    m = (np.abs(inset - P["stitch_inset"]) < 1.5)
    if m.any():
        path = outer.inset(P["stitch_inset"]).pts()
        # densify the path and parametrise by arc length
        seg = np.diff(np.vstack([path, path[:1]]), axis=0)
        L = np.hypot(seg[:, 0], seg[:, 1])
        dense, s_acc = [], []
        s0 = 0.0
        for p, v, l in zip(path, seg, L):
            n = max(1, int(l / 0.05))
            t = np.arange(n) / n
            dense.append(p[None, :] + t[:, None] * v[None, :])
            s_acc.append(s0 + t * l)
            s0 += l
        dense = np.vstack(dense)
        s_acc = np.concatenate(s_acc)
        n_st = max(1, int(round(s0 / P["stitch_pitch"])))
        pitch = s0 / n_st
        _, idx = cKDTree(dense).query(np.column_stack([X[m], Y[m]]))
        a = (s_acc[idx] % pitch) - pitch / 2
        across = inset[m] - P["stitch_inset"]
        q = np.maximum(np.abs(a) - (P["stitch_len"] - P["stitch_w"]) / 2, 0)
        dist = np.hypot(q, across) - P["stitch_w"] / 2
        rs = P["stitch_depth"] * (1 - smoothstep(-0.12, 0.12, dist))
        # no stitches across the centre seam groove
        rs[np.abs(X[m] - croc.x_seam) < 1.6] = 0
        r[m] = np.maximum(r[m], rs)

    r[inset < 0.9] = 0.0  # keep the chamfer region clean
    return r


def texture_cutter(kind, outer, croc, P, bbox):
    """Watertight heightfield solid {z < r(x,y)} over bbox, adaptive mesh."""
    x0, x1, y0, y1 = bbox
    g = P["grid"]
    xs = np.arange(x0, x1 + g / 2, g)
    ys = np.arange(y0, y1 + g / 2, g)
    X, Y = np.meshgrid(xs, ys)
    r = texture_relief(kind, outer, croc, X.ravel(), Y.ravel(), P).reshape(X.shape)
    r[:2, :] = r[-2:, :] = 0
    r[:, :2] = r[:, -2:] = 0
    keep = binary_dilation(r > 1e-4, iterations=2)
    keep[0, :] = keep[-1, :] = keep[:, 0] = keep[:, -1] = False
    pts = np.column_stack([X[keep], Y[keep]])
    zs = r[keep]
    corners = np.array([[xs[0], ys[0]], [xs[-1], ys[0]], [xs[-1], ys[-1]], [xs[0], ys[-1]]])
    pts = np.vstack([pts, corners])
    zs = np.concatenate([zs, np.zeros(4)])
    tri = Delaunay(pts).simplices
    # orient CCW (normal +z)
    a, b, c = pts[tri[:, 0]], pts[tri[:, 1]], pts[tri[:, 2]]
    cross = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    tri[cross < 0] = tri[cross < 0][:, [0, 2, 1]]
    tri = tri[np.abs(cross) > 1e-12]
    n = len(pts)
    ci = np.arange(n - 4, n)            # top corners
    bi = np.arange(n, n + 4)            # bottom corners
    zb = -1.0
    verts = np.vstack([np.column_stack([pts, zs]),
                       np.column_stack([corners, np.full(4, zb)])])
    faces = [tri,
             np.array([[bi[0], bi[2], bi[1]], [bi[0], bi[3], bi[2]]])]
    for j in range(4):
        a_, b_ = ci[j], ci[(j + 1) % 4]
        a2, b2 = bi[j], bi[(j + 1) % 4]
        faces.append(np.array([[a_, a2, b2], [a_, b2, b_]]))
    faces = np.vstack(faces).astype(np.uint32)
    mesh = m3d.Mesh(vert_properties=verts.astype(np.float32), tri_verts=faces)
    man = m3d.Manifold(mesh)
    if man.status() != m3d.Error.NoError:
        raise RuntimeError(f"texture cutter not manifold: {man.status()}")
    return man, (X, Y, r)


# --------------------------------------------------------------------------
# Shells
# --------------------------------------------------------------------------
def geometry(kind, L, P):
    W, D = L["W"], L["D"]
    c, w = P["clear"], P["wall"]
    if kind == "top":
        outer = RRect(-c - w, -c - w, W + c + w, D - P["top_back_trim"],
                      L["R_front"] + c + w, 3.0)
    else:
        outer = RRect(-c - w, -c - w, W + c + w, D - P["bottom_back_trim"],
                      L["R_front"] + c + w, L["R_back"] + c + w)
    pocket = RRect(-c, -c, W + c, D + 25, L["R_front"] + c, 1.0)
    return outer, pocket


def build_shell(kind, L, P, seed, crop=None, with_texture=True, log=print):
    W, D = L["W"], L["D"]
    T = P["plate"]
    outer, pocket = geometry(kind, L, P)
    if kind == "top":
        base, slope = T + L["lid_t"], 0.0
        H = base + P["lip_gap"] + P["lip_t"] + 1
    else:
        base = T + L["base_h_front"]
        slope = (L["base_h_back"] - L["base_h_front"]) / D
        H = base + slope * D + P["lip_gap"] + P["lip_t"] + 1

    o_cs = outer.cs()
    ch = P["chamfer"]
    body = m3d.Manifold.batch_hull([prism(outer.inset(ch).cs(), -0.3, 0.0),
                                    prism(o_cs, ch, H)])
    tray = body - prism(pocket.cs(), T, H + 5)
    # inner 45 deg fillet (stair-stepped, 0.2 mm steps)
    # (add-ons are built from mid-wall inward so no face coincides with the
    #  outer skin, which keeps the boolean result free of slivers)
    mid_cs = pocket.inset(-P["wall"] / 2).cs()
    nf = 6
    for j in range(1, nf):
        u = P["inner_fillet"] * j / nf
        ring = mid_cs - pocket.inset(u).cs()
        tray = tray + prism(ring, T - 0.5, T + P["inner_fillet"] - u)
    # plain wall height
    tray = tray ^ slab_rel(o_cs, -50, -P["wall_drop"], base, slope)

    # clip lips
    zones = clip_zones(kind, L)
    zone_cs = m3d.CrossSection.batch_boolean(
        [m3d.CrossSection.square((x1 - x0, y1 - y0)).translate((x0, y0)) for x0, x1, y0, y1 in zones],
        m3d.OpType.Add)
    g, t, rr = P["lip_gap"], P["lip_t"], P["lip_ramp"]
    # wall riser (overlaps the trimmed wall) + lip + 45 deg ramp. The lip top
    # sits 0.02 mm under the riser top so no two top faces coincide.
    parts = [slab_rel(o_cs - pocket.cs(), -P["wall_drop"] - 0.3, g + t, base, slope),
             slab_rel(mid_cs - pocket.inset(P["lip_reach"]).cs(), g, g + t - 0.02, base, slope)]
    nr = max(5, int(round(rr / 0.1)))
    for k in range(1, nr):
        u = rr * k / nr
        parts.append(slab_rel(mid_cs - pocket.inset(u).cs(), g - rr + u, g + t / 2 + 0.01 * k, base, slope))
    lips = m3d.Manifold.batch_boolean(parts, m3d.OpType.Add) ^ prism(zone_cs, -20, 80)
    shell = tray + lips

    # cut-outs
    cuts = []
    if kind == "top":
        # side walls stop before the hinge
        cuts.append(box(-20, W + 20, D - P["top_wall_end"], D + 20, T + 0.4, 80))
        # big 45 deg chamfer on the bed side of the back edge: keeps the edge
        # inside the hinge's swing when the lid opens (prints like any chamfer)
        y0 = D - P["top_back_trim"] - P["top_back_chamfer"]
        tri = [(y0, -1.0), (D + 5, -1.0), (D + 5, D + 5 - y0), (y0, 0.0)]
        cuts.append(m3d.Manifold.extrude(m3d.CrossSection([np.array(tri)]), W + 40)
                    .rotate((90, 0, 90)).translate((-20, 0, 0)))
        # finger notch, front centre
        cuts.append(u_notch_x(W / 2, 15, T + 1.5, 3.0, -10, -P["clear"] + 0.3))
    else:
        cuts.append(u_notch_x(W / 2, 20, T + 0.3, 3.0, -10, -P["clear"] + 0.3))
        yl0, yl1 = L["port_window_left"]
        pin, pdn = P["port_cut_in"], P["port_floor_cut"]
        cuts.append(u_notch_y(D - yl1, D - yl0, T - pdn, 2.5, -10, pin))
        yr0, yr1 = L["port_window_right"]
        cuts.append(u_notch_y(D - yr1, D - yr0, T - pdn, 2.5, W - pin, W + 10))
        for fx, fy in L["feet"]:
            cuts.append(m3d.Manifold.cylinder(T + 10, P["foot_hole_d"] / 2,
                                              circular_segments=96).translate((fx, fy, -2)))
    shell = shell - m3d.Manifold.batch_boolean(cuts, m3d.OpType.Add)

    bb = outer
    tex_box = (bb.x0 - 2, bb.x1 + 2, bb.y0 - 2, bb.y1 + 2)
    if crop is not None:
        cx0, cx1, cy0, cy1 = crop
        shell = shell ^ box(cx0, cx1, cy0, cy1, -5, 80)
        tex_box = (max(cx0 - 2, tex_box[0]), min(cx1 + 2, tex_box[1]),
                   max(cy0 - 2, tex_box[2]), min(cy1 + 2, tex_box[3]))

    croc = CrocPattern(bb.x0, bb.x1, bb.y0 + P["border"], bb.y1 - P["border"], W / 2, seed)
    hf = None
    if with_texture:
        t0 = time.time()
        cutter, hf = texture_cutter(kind, outer, croc, P, tex_box)
        log(f"    texture heightfield: {cutter.num_tri():,} tris ({time.time() - t0:.1f}s)")
        shell = shell - cutter
    else:
        shell = shell ^ box(-50, W + 50, -50, D + 50, 0, 80)
    return shell, croc, outer, hf


def split_halves(shell, croc, outer, P):
    poly = croc.seam_polygon(outer.y0 - 5, outer.y1 + 5, outer.x0 - 5)
    cs = m3d.CrossSection([poly])
    k = P["kerf"] / 2
    left_cs = cs.offset(-k, m3d.JoinType.Miter)
    right_cs = cs.offset(+k, m3d.JoinType.Miter)
    left = shell ^ prism(left_cs, -5, 80)
    right = shell - prism(right_cs, -5, 80)
    return left, right


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------
def to_trimesh(man):
    """Weld at the largest tolerance that leaves a slicer-clean mesh."""
    tm = None
    for tol in (2e-4, 5e-5, 1e-5, 0.0):
        tm = _welded(man, tol)
        if _slicer_watertight(tm):
            return tm
    return tm


def _welded(man, weld):
    """Export mesh; weld vertices closer than `weld` mm.

    Exact booleans can leave two distinct vertices a few nanometres apart
    where cuts cross the dense texture. Once written as float32 STL a slicer
    merges them and reports errors, so weld them here, drop the triangles
    that collapse, and cancel any face pairs that became duplicates.
    """
    m = man.to_mesh64()
    v = np.asarray(m.vert_properties)[:, :3].astype(np.float64)
    f = np.asarray(m.tri_verts).astype(np.int64)
    parent = np.arange(len(v))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, j in (cKDTree(v).query_pairs(weld) if weld > 0 else ()):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[max(ri, rj)] = min(ri, rj)
    root = np.array([find(i) for i in range(len(v))])
    f = root[f]
    f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
    key = np.sort(f, axis=1)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    f = f[cnt[inv.ravel()] == 1]
    tm = trimesh.Trimesh(vertices=v, faces=f, process=False)
    tm.remove_unreferenced_vertices()
    return tm


def _slicer_watertight(tm):
    """Watertight after merging coincident float32 vertices, like a slicer does."""
    t = trimesh.Trimesh(np.asarray(tm.vertices, dtype=np.float32), tm.faces, process=False)
    t.merge_vertices()
    return bool(t.is_watertight and t.is_winding_consistent and t.volume > 0)


def save(man, name, mf_dir, stl_dir=None, log=print, center=True):
    """Write <name>.3mf (always) and <name>.stl (if stl_dir) centred on the bed."""
    # collapse sub-micron slivers left by the booleans (3 um tolerance is far
    # below print resolution) so the file is clean after a slicer merges vertices
    man = man.simplify(0.003)
    tm = to_trimesh(man)
    if center:
        b = tm.bounds
        tm.apply_translation([-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2, -b[0][2]])
    os.makedirs(mf_dir, exist_ok=True)
    tm.metadata["name"] = name
    p3 = os.path.join(mf_dir, name + ".3mf")
    trimesh.Scene({name: tm}).export(p3)
    info = dict(file=name, tris=int(len(tm.faces)),
                size_mm=[round(float(e), 1) for e in tm.extents],
                volume_cm3=round(float(man.volume()) / 1000, 1),
                weight_g_tpu=round(float(man.volume()) / 1000 * 1.22),
                clean=bool(_slicer_watertight(tm)),
                mb_3mf=round(os.path.getsize(p3) / 1e6, 1))
    if stl_dir:
        os.makedirs(stl_dir, exist_ok=True)
        ps = os.path.join(stl_dir, name + ".stl")
        tm.export(ps)
        info["mb_stl"] = round(os.path.getsize(ps) / 1e6, 1)
    log(f"    -> {info}")
    return info


# Fit sizes. The lid has one thickness; the base is a wedge, so its clip
# height is set independently at the front clips (y = 44 mm) and the rear
# clips (y = 104 mm), each picked with its own fit-test strip.
LID_SIZES = (-0.50, -0.25, 0.0, +0.25, +0.50)     # offsets from LAPTOP["lid_t"]
BASE_FRONT = (-0.40, 0.0, +0.40)                  # deck-height offsets at y = 44
BASE_REAR = (-0.50, 0.0, +0.50)                   # deck-height offsets at y = 104
Y_FRONT_CLIP, Y_REAR_CLIP = 44.0, 104.0


def lid_tag(L, d):
    return f"lid-{L['lid_t'] + d:.2f}mm"


def base_heights(L, dF, dR):
    """Deck line through the nominal heights +dF at the front clip, +dR at the rear clip."""
    D = L["D"]
    k = (L["base_h_back"] - L["base_h_front"]) / D
    k2 = k + (dR - dF) / (Y_REAR_CLIP - Y_FRONT_CLIP)
    hf2 = L["base_h_front"] + dF - (k2 - k) * Y_FRONT_CLIP
    return hf2, hf2 + k2 * D


def base_tag(i, j):
    return f"front-{'ABC'[i]}_rear-{'ABC'[j]}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--lid-t", type=float, default=LAPTOP["lid_t"], help="nominal lid thickness (mm)")
    ap.add_argument("--base-offset", type=float, default=0.0,
                    help="raise (+) / lower (-) the nominal base-shell clip height (mm)")
    ap.add_argument("--clear", type=float, default=CASE["clear"], help="side clearance per side (mm)")
    ap.add_argument("--seed-top", type=int, default=11)
    ap.add_argument("--seed-bottom", type=int, default=23)
    ap.add_argument("--nominal-only", action="store_true", help="skip the A/C fit variants")
    args = ap.parse_args()

    L = dict(LAPTOP)
    P = dict(CASE)
    L["lid_t"] = args.lid_t
    L["base_h_front"] += args.base_offset
    L["base_h_back"] += args.base_offset
    P["clear"] = args.clear
    out = args.out
    mf, st = os.path.join(out, "3mf"), os.path.join(out, "stl")
    report = dict(laptop=L, case=P, files=[])
    W, D = L["W"], L["D"]

    nl = len(LID_SIZES) // 2
    fit_mf, fit_st = os.path.join(mf, "1_fit_tests"), os.path.join(st, "1_fit_tests")

    # 1) fit tests
    for d in LID_SIZES:
        tag = lid_tag(L, d)
        print(f"[fit] lid front corner {tag}")
        s, *_ = build_shell("top", dict(L, lid_t=L["lid_t"] + d), P, args.seed_top, crop=(-3, 42, -3, 42))
        report["files"].append(save(s, f"fit_lid_front-corner_{tag}", fit_mf, fit_st))
    print("[fit] lid rear corner (hinge clearance)")
    s, *_ = build_shell("top", L, P, args.seed_top, crop=(-3, 40, D - 60, D))
    report["files"].append(save(s, f"fit_lid_rear-corner_hinge-check_{lid_tag(L, 0)}", fit_mf, fit_st))
    for i, dF in enumerate(BASE_FRONT):
        hf, hb = base_heights(L, dF, 0.0)
        print(f"[fit] base front strip {'ABC'[i]}")
        s, *_ = build_shell("bottom", dict(L, base_h_front=hf, base_h_back=hb), P, args.seed_bottom,
                            crop=(-3, 72, -3, 64))
        report["files"].append(save(s, f"fit_base_front-strip_{'ABC'[i]}", fit_mf, fit_st))
    for j, dR in enumerate(BASE_REAR):
        hf, hb = base_heights(L, 0.0, dR)
        print(f"[fit] base rear strip {'ABC'[j]}")
        s, *_ = build_shell("bottom", dict(L, base_h_front=hf, base_h_back=hb), P, args.seed_bottom,
                            crop=(-3, 40, 84, D))
        report["files"].append(save(s, f"fit_base_rear-strip_{'ABC'[j]}", fit_mf, fit_st))

    # 2) shells: LEFT/RIGHT halves (256 mm bed) for every size, one-piece for nominal
    jobs = []
    for d in LID_SIZES:
        if args.nominal_only and d != 0.0:
            continue
        jobs.append(("top", dict(L, lid_t=L["lid_t"] + d), args.seed_top, "2_lid_shell",
                     f"lid_shell_{lid_tag(L, d)}", d == 0.0))
    for i, dF in enumerate(BASE_FRONT):
        for j, dR in enumerate(BASE_REAR):
            nominal = dF == 0.0 and dR == 0.0
            if args.nominal_only and not nominal:
                continue
            hf, hb = base_heights(L, dF, dR)
            jobs.append(("bottom", dict(L, base_h_front=hf, base_h_back=hb), args.seed_bottom,
                         "3_base_shell", f"base_shell_{base_tag(i, j)}", nominal))
    for kind, L2, seed, folder, name, nominal in jobs:
        t0 = time.time()
        print(f"[{name}] building ...")
        shell, croc, outer, hf = build_shell(kind, L2, P, seed)
        left, right = split_halves(shell, croc, outer, P)
        sdir = os.path.join(st, folder) if nominal else None
        for half, man in (("LEFT", left), ("RIGHT", right)):
            report["files"].append(save(man, f"{name}_{half}", os.path.join(mf, folder), sdir))
        if nominal:
            report["files"].append(save(shell, f"{name}_ONE-PIECE_big-bed",
                                        os.path.join(mf, "4_one_piece_for_big_beds"),
                                        os.path.join(st, "4_one_piece_for_big_beds")))
        print(f"[{name}] done in {time.time() - t0:.1f}s")

    with open(os.path.join(out, "build_report.json"), "w") as f:
        json.dump(report, f, indent=2)


if __name__ == "__main__":
    main()
