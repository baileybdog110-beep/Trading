"""Turn OCR'd position samples into trades and attach market context."""
import csv, sys, os, glob, datetime as dt, statistics as st
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(__file__))
from nqdata import load
ET = ZoneInfo("America/New_York")
BASE = sys.argv[1]
os.chdir(BASE)

b1 = load("data/nq_1m.json")
b2 = load("data/nq_2m.json")
first_1m = b1[0][0]

def bars_for(day):
    """1m bars if available for the whole morning of `day`, else 2m bars."""
    start = dt.datetime.combine(day - dt.timedelta(days=4), dt.time(0), ET)
    if first_1m <= dt.datetime.combine(day - dt.timedelta(days=1), dt.time(18), ET):
        src, step = b1, 1
    else:
        src, step = b2, 2
    return [r for r in src if r[0] >= start], step

def rsi_series(closes, n=14):
    out = [None] * len(closes)
    up = dn = None
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i - 1]
        u, d = max(ch, 0), max(-ch, 0)
        if i < n:
            continue
        if i == n:
            ups = [max(closes[k] - closes[k - 1], 0) for k in range(1, n + 1)]
            dns = [max(closes[k - 1] - closes[k], 0) for k in range(1, n + 1)]
            up, dn = sum(ups) / n, sum(dns) / n
        else:
            up = (up * (n - 1) + u) / n
            dn = (dn * (n - 1) + d) / n
        out[i] = 100.0 if dn == 0 else 100 - 100 / (1 + up / dn)
    return out

def atr_series(bars, n=14):
    out, a = [None] * len(bars), None
    for i in range(1, len(bars)):
        h, l, pc = bars[i][2], bars[i][3], bars[i - 1][4]
        tr = max(h - l, abs(h - pc), abs(l - pc))
        a = tr if a is None else (a * (n - 1) + tr) / n
        out[i] = a
    return out

H60 = load("data/nq_60m.json")
H60T = [r[0] for r in H60]

def fib_levels(t, n=69):
    import bisect
    k = bisect.bisect_right(H60T, t) - 1
    hk = k - 1
    if hk < n:
        return {}
    seg = H60[hk - n + 1:hk + 1]
    hh = max(b[2] for b in seg); ll = min(b[3] for b in seg)
    ho = max(j for j, b in enumerate(seg) if b[2] == hh); lo = max(j for j, b in enumerate(seg) if b[3] == ll)
    up = ho > lo
    out = {}
    for r in (0.236, 0.382, 0.5, 0.618, 0.764):
        out[f"Fib{r*100:.1f}"] = hh - r * (hh - ll) if up else ll + r * (hh - ll)
    return out

def levels(day):
    """Key levels for the RTH session of `day` (computed from 2m bars, which cover the full window)."""
    def rng(t0, t1):
        xs = [r for r in b2 if t0 <= r[0] < t1]
        return (max(r[2] for r in xs), min(r[3] for r in xs), xs) if xs else (None, None, [])
    prev = day - dt.timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= dt.timedelta(days=1)
    d = lambda dd, hh, mm=0: dt.datetime.combine(dd, dt.time(hh, mm), ET)
    pdh, pdl, xs = rng(d(prev, 9, 30), d(prev, 16))
    pdc = xs[-1][4] if xs else None
    onh, onl, _ = rng(d(prev, 18), d(day, 9, 30))
    pmh, pml, _ = rng(d(day, 7), d(day, 9, 30))
    ppmh, ppml, _ = rng(d(prev, 7), d(prev, 9, 30))
    cbh, cbl, _ = rng(d(prev, 15, 30), d(prev, 16))
    return dict(PDH=pdh, PDL=pdl, PDC=pdc, ONH=onh, ONL=onl, PMH=pmh, PML=pml, prevPMH=ppmh, prevPML=ppml, CBtop=cbh, CBbot=cbl)

CONFUSE = {"3": "86", "8": "36", "6": "85", "5": "6", "4": "39", "9": "3", "0": "68"}

def fix_price(p, ref, tol=60):
    """Correct OCR digit confusions by picking the variant closest to the market price ."""
    if p is None or ref is None:
        return None
    if abs(p - ref) <= tol:
        return p
    s = f"{p:.2f}"
    best, bd = None, tol
    for i, ch in enumerate(s):
        for alt in CONFUSE.get(ch, ""):
            try:
                v = float(s[:i] + alt + s[i + 1:])
            except ValueError:
                continue
            if abs(v - ref) < bd:
                best, bd = v, abs(v - ref)
    return best

def load_positions(path, bars=None):
    rows = []
    for r in csv.DictReader(open(path)):
        t = dt.datetime.strptime(r["et"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=ET)
        q = int(r["qty"]) if r["qty"] else None
        p = float(r["avg_price"]) if r["avg_price"] else None
        if bars is not None and p is not None:
            b = nearest(bars, t)
            p = fix_price(p, b[4] if b else None)
        rows.append([t, r["side"], q, p])
    # smooth single-sample blips of side
    for i in range(1, len(rows) - 1):
        # a lone long<->short flicker between identical neighbours is OCR noise; lone flats are real exits
        if rows[i][1] != "flat" and rows[i][1] != rows[i - 1][1] and rows[i - 1][1] == rows[i + 1][1]:
            rows[i][1:] = rows[i - 1][1:]
    return rows

def trades_from(rows):
    trades, cur = [], None
    for t, side, q, p in rows:
        if side == "flat":
            if cur:
                cur["exit_t"] = t
                trades.append(cur)
                cur = None
            continue
        if cur and side != cur["side"]:
            cur["exit_t"] = t
            trades.append(cur)
            cur = None
        if cur is None:
            cur = dict(side=side, entry_t=t, fills=[], max_q=0, avgs=[])
        if p is not None:
            if not cur["avgs"] or cur["avgs"][-1] != p:
                cur["avgs"].append(p)
        if q:
            cur["max_q"] = max(cur["max_q"], q)
    return trades

def nearest(bars, t):
    best = None
    for r in bars:
        if r[0] <= t:
            best = r
        else:
            break
    return best

def main():
    out = []
    for path in sorted(glob.glob("positions/*.csv")):
        label = os.path.basename(path)[:-4]
        first = next(csv.DictReader(open(path)), None)
        if not first:
            continue
        day = dt.datetime.strptime(first["et"], "%Y-%m-%d %H:%M:%S").date()
        bars, step = bars_for(day)
        rows = load_positions(path, bars)
        closes = [r[4] for r in bars]
        rsi = rsi_series(closes)
        atr = atr_series(bars)
        lv = levels(day)
        for tr in trades_from(rows):
            if not tr["avgs"]:
                continue
            e = tr["avgs"][0]
            et = tr["entry_t"]
            idx = max(i for i, r in enumerate(bars) if r[0] <= et)
            # bar containing exit
            xi = max(i for i, r in enumerate(bars) if r[0] <= tr["exit_t"])
            exit_px = bars[xi][4]
            sgn = 1 if tr["side"] == "long" else -1
            final_avg = tr["avgs"][-1]
            def chg(mins):
                j = max(0, idx - mins // step)
                return closes[idx] - closes[j]
            hi60 = max(r[2] for r in bars[max(0, idx - 60 // step):idx + 1])
            lo60 = min(r[3] for r in bars[max(0, idx - 60 // step):idx + 1])
            pos60 = (e - lo60) / (hi60 - lo60) if hi60 > lo60 else 0.5
            allv = dict(lv)
            allv.update(fib_levels(et))
            near = sorted(((abs(e - v), k, v) for k, v in allv.items() if v is not None))[:2]
            rnd = min(abs(e - round(e / 50) * 50), abs(e - round(e / 100) * 100))
            out.append(dict(day=label, side=tr["side"], entry=et.strftime("%H:%M:%S"), px=e,
                            adds=len(tr["avgs"]) - 1, max_q=tr["max_q"], final_avg=final_avg,
                            exit=tr["exit_t"].strftime("%H:%M:%S"), hold_min=round((tr["exit_t"] - et).total_seconds() / 60, 1),
                            est_pts=round(sgn * (exit_px - final_avg), 2),
                            rsi=round(rsi[idx], 1) if rsi[idx] else None, atr=round(atr[idx], 1) if atr[idx] else None,
                            chg5=round(chg(5), 1), chg15=round(chg(15), 1), chg30=round(chg(30), 1),
                            pos60=round(pos60, 2),
                            near1=f"{near[0][1]}:{near[0][0]:.0f}" if near else "", near2=f"{near[1][1]}:{near[1][0]:.0f}" if len(near) > 1 else "",
                            near_dist=round(near[0][0], 2) if near else None, near_dist_atr=round(near[0][0] / atr[idx], 2) if near and atr[idx] else None,
                            rnd=round(rnd, 1), bar_step=step))
    keys = list(out[0].keys()) if out else []
    with open("trades_log.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(out)
    for r in out:
        print(r)

if __name__ == "__main__":
    main()
