"""Python port of indicators/FSP_Reversal_Scalper.pine, used to validate the logic on NQ intraday data.

Mirrors the Pine logic: session levels, hourly pivot boxes (confirmed, [1]+lookahead_on semantics),
fib of the latest swing, dip/rip into level, defence confirmation (or limit-at-level mode), scoring,
virtual trade management (TP1/TP2/TP3 thirds, stop to breakeven after TP1, time stop).
"""
import bisect, datetime as dt, json, math, sys, os
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(__file__))
from nqdata import load

ET = ZoneInfo("America/New_York")

# Defaults = the indicator's defaults (indicators/FSP_Reversal_Scalper.pine). Other keys are experiment switches.
DEFAULTS = dict(
    rsiLen=14, rsiOS=30, rsiOB=70, atrLen=14, tolATR=0.35, tolMin=2.0, dipBars=10, dipATR=1.5,
    minGrade="C", cooldown=3, trendGuard=True, trendATR=6.0, useDiv=True, divLen=20,
    tpMode="auto", tp=(10, 20, 30), tpAtr=(0.7, 1.4, 2.1), snapTP=False, slBufATR=0.35, slMin=8, slMax=30, slATR=1.0,
    beAfter1=True, maxHold=45, pivLen=3, zMinATR=0.20, zMaxATR=0.55, maxZones=14, flip=True,
    fibLen=69, fibSignal=True, win=(570, 690), newsPause=True, newsMins=2,
    entry="limit", boxMode="confluence", grading="v2", cost=0.5, tick=0.25,
    useYPM=True, usePM=False, useON=True, usePDHL=True, usePDC=True, useOpen=False, useCB=True,
    # experiment switches (off = indicator behaviour)
    trendFilter="none", wFlush=1, wConf=1, wDiv=1, wTrend=0, minScoreC=2, minConf=1, fibRTH=False, fibRTHmin=4.0, fibOnlyRTH=False,
)


def wilder_rsi(closes, n):
    out = [None] * len(closes)
    up = dn = None
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i - 1]
        u, d = max(ch, 0.0), max(-ch, 0.0)
        if i < n:
            continue
        if i == n:
            up = sum(max(closes[k] - closes[k - 1], 0) for k in range(1, n + 1)) / n
            dn = sum(max(closes[k - 1] - closes[k], 0) for k in range(1, n + 1)) / n
        else:
            up = (up * (n - 1) + u) / n
            dn = (dn * (n - 1) + d) / n
        out[i] = 100.0 if dn == 0 else 100 - 100 / (1 + up / dn)
    return out


def wilder_atr(bars, n):
    out = [None] * len(bars)
    a = None
    trs = []
    for i in range(len(bars)):
        h, l = bars[i][2], bars[i][3]
        tr = h - l if i == 0 else max(h - l, abs(h - bars[i - 1][4]), abs(l - bars[i - 1][4]))
        trs.append(tr)
        if i + 1 < n:
            continue
        if i + 1 == n:
            a = sum(trs) / n
        else:
            a = (a * (n - 1) + tr) / n
        out[i] = a
    return out


def pivots(bars, n):
    ph = [None] * len(bars)
    pl = [None] * len(bars)
    for i in range(2 * n, len(bars)):
        c = i - n
        hs = [bars[k][2] for k in range(c - n, c + n + 1)]
        ls = [bars[k][3] for k in range(c - n, c + n + 1)]
        if bars[c][2] == max(hs) and all(bars[k][2] < bars[c][2] for k in range(c + 1, c + n + 1)):
            ph[i] = c
        if bars[c][3] == min(ls) and all(bars[k][3] > bars[c][3] for k in range(c + 1, c + n + 1)):
            pl[i] = c
    return ph, pl


def mins(t):
    return t.hour * 60 + t.minute


def in_sess(t, a, b):
    m = mins(t)
    return a <= m < b if a < b else (m >= a or m < b)


@dataclass
class Zone:
    top: float
    bot: float
    dir: int
    t: object
    flipped: bool = False


@dataclass
class Trade:
    dir: int
    entry: float
    sl: float
    tp1: float
    tp2: float
    tp3: float
    i0: int
    grade: str
    why: str
    t0: object
    hit1: bool = False
    hit2: bool = False
    pts: float = 0.0
    rem: float = 1.0
    exit_t: object = None
    exit_tag: str = ""


def run(bars, htf, P=None, div=None):
    P = dict(DEFAULTS, **(P or {}))
    n = len(bars)
    closes = [b[4] for b in bars]
    atr = wilder_atr(bars, P["atrLen"])
    rsi = wilder_rsi(closes, P["rsiLen"])
    # HTF series
    htimes = [b[0] for b in htf]
    hatr = wilder_atr(htf, 14)
    hph, hpl = pivots(htf, P["pivLen"])
    zones, trades, signals = [], [], []
    seen_ph, seen_pl = set(), set()
    # session state
    rthOpen = rthHi = rthLo = rthCl = pdh = pdl = pdc = None
    onHi = onLo = None
    onActive = False
    pmHi = pmLo = ypmHi = ypmLo = None
    cbHi = cbLo = cbTop = cbBot = None
    dOpen = None
    rthHiI = rthLoI = None
    tr = None
    lastExit = -1000
    prev = None
    for i in range(n):
        t, o, h, l, c, v = bars[i]
        m = mins(t)
        inRTH = 570 <= m < 960
        prevRTH = prev is not None and 570 <= mins(prev) < 960
        rthStart = inRTH and not prevRTH
        rthEnd = (not inRTH) and prevRTH
        newDay = prev is not None and m >= 1080 and mins(prev) < 1080
        inPM = in_sess(t, 240, 570)
        prevPM = prev is not None and in_sess(prev, 240, 570)
        inCB = 930 <= m < 960
        prevCB = prev is not None and 930 <= mins(prev) < 960
        # levels
        prevRthHi, prevRthLo, prevRthHiI, prevRthLoI = rthHi, rthLo, rthHiI, rthLoI
        if rthStart:
            rthOpen, rthHi, rthLo = o, h, l
            rthHiI = rthLoI = i
            prevRthHi = prevRthLo = None
        elif inRTH and rthHi is not None:
            if h > rthHi: rthHiI = i
            if l < rthLo: rthLoI = i
            rthHi, rthLo = max(rthHi, h), min(rthLo, l)
        if inRTH:
            rthCl = c
        if rthEnd and rthHi is not None:
            pdh, pdl, pdc = rthHi, rthLo, rthCl
        if newDay:
            onActive, onHi, onLo, dOpen = True, h, l, o
        elif onActive and not inRTH:
            onHi, onLo = max(onHi, h), min(onLo, l)
        if rthStart:
            onActive = False
        if inPM and not prevPM:
            ypmHi, ypmLo, pmHi, pmLo = pmHi, pmLo, h, l
        elif inPM and pmHi is not None:
            pmHi, pmLo = max(pmHi, h), min(pmLo, l)
        if inCB and not prevCB:
            cbHi, cbLo = h, l
        elif inCB and cbHi is not None:
            cbHi, cbLo = max(cbHi, h), min(cbLo, l)
        if (not inCB) and prevCB and cbHi is not None:
            cbTop, cbBot = cbHi, cbLo
        prev = t
        # HTF mapping: k = HTF bar containing t; use bar k-1 (confirmed)
        k = bisect.bisect_right(htimes, t) - 1
        hk = k - 1
        hClose = htf[hk][4] if hk >= 0 else None
        if hk >= 0:
            a = hatr[hk]
            if hph[hk] is not None and a is not None and hph[hk] not in seen_ph:
                seen_ph.add(hph[hk])
                pb = htf[hph[hk]]
                top = pb[2]
                hgt = max(P["zMinATR"] * a, min(P["zMaxATR"] * a, top - max(pb[1], pb[4])))
                _add_zone(zones, top, top - hgt, -1, pb[0], P)
            if hpl[hk] is not None and a is not None and hpl[hk] not in seen_pl:
                seen_pl.add(hpl[hk])
                pb = htf[hpl[hk]]
                bot = pb[3]
                hgt = max(P["zMinATR"] * a, min(P["zMaxATR"] * a, min(pb[1], pb[4]) - bot))
                _add_zone(zones, bot + hgt, bot, 1, pb[0], P)
        if hClose is not None:
            for zi in range(len(zones) - 1, -1, -1):
                z = zones[zi]
                if (z.dir == 1 and hClose < z.bot) or (z.dir == -1 and hClose > z.top):
                    if P["flip"] and not z.flipped:
                        z.dir, z.flipped = -z.dir, True
                    else:
                        zones.pop(zi)
        # fib
        fib = []
        if hk >= P["fibLen"]:
            seg = htf[hk - P["fibLen"] + 1:hk + 1]
            hh = max(b[2] for b in seg)
            ll = min(b[3] for b in seg)
            ho = max(j for j, b in enumerate(seg) if b[2] == hh)
            lo = max(j for j, b in enumerate(seg) if b[3] == ll)
            up = ho > lo
            for r in (0.236, 0.382, 0.5, 0.618, 0.764):
                fib.append(hh - r * (hh - ll) if up else ll + r * (hh - ll))
        # RTH-swing fib (as of the previous bar: known at this bar's open)
        if P.get("fibRTH") and inRTH and prevRthHi is not None and atr[i - 1] is not None and prevRthHi - prevRthLo >= P.get("fibRTHmin", 4.0) * atr[i - 1]:
            upR = prevRthHiI > prevRthLoI
            for r in (0.382, 0.5, 0.618, 0.764):
                fib.append(prevRthHi - r * (prevRthHi - prevRthLo) if upR else prevRthLo + r * (prevRthHi - prevRthLo))
        if P.get("fibOnlyRTH"):
            fib = fib[5:] if len(fib) > 5 else ([] if not P.get("fibRTH") else fib)
        if atr[i] is None or rsi[i] is None or i < P["dipBars"] + 3:
            continue
        A = atr[i]
        tol = max(P["tolMin"], A * P["tolATR"])
        lv = []
        if P["usePDC"] and pdc is not None: lv.append(("Y-Close", pdc))
        if P["usePDHL"] and pdh is not None: lv += [("PDH", pdh), ("PDL", pdl)]
        if P["useON"] and onHi is not None and not onActive: lv += [("ON High", onHi), ("ON Low", onLo)]
        if P["usePM"] and pmHi is not None and not inPM: lv += [("PM High", pmHi), ("PM Low", pmLo)]
        if P["useYPM"] and ypmHi is not None: lv += [("Y-PM High", ypmHi), ("Y-PM Low", ypmLo)]
        if P["useOpen"] and inRTH and rthOpen is not None: lv.append(("RTH Open", rthOpen))
        if P["fibSignal"]: lv += [("Fib", p) for p in fib]
        hiDip = max(b[2] for b in bars[i - P["dipBars"] + 1:i + 1])
        loRip = min(b[3] for b in bars[i - P["dipBars"] + 1:i + 1])
        rng = h - l
        bullRej = rng > 0 and min(o, c) - l >= 0.4 * rng and c >= l + 0.5 * rng
        bearRej = rng > 0 and h - max(o, c) >= 0.4 * rng and c <= h - 0.5 * rng
        bullEng = c > o and c > bars[i - 1][2]
        bearEng = c < o and c < bars[i - 1][3]
        isDip = hiDip - l >= P["dipATR"] * A
        isRip = h - loRip >= P["dipATR"] * A
        # support touches
        sup = []  # (kind, name, top, bot, trap)
        supBoxHit = False
        for z in zones:
            if z.dir == 1 and l <= z.top + tol and c >= z.bot - tol and hiDip > z.top:
                supBoxHit = True
                if P["boxMode"] == "trigger":
                    sup.append(("box", "flipped box" if z.flipped else "hourly box", z.top, z.bot, l < z.bot and c > z.bot))
        if P["useCB"] and cbTop is not None and l <= cbTop + tol and c >= cbBot - tol and hiDip > cbTop:
            sup.append(("box", "prior-close box", cbTop, cbBot, l < cbBot and c > cbBot))
        for nm, p in lv:
            if l <= p + tol and c >= p - tol and hiDip > p + tol:
                sup.append(("line", nm, p, p, l < p - tol and c > p))
        res = []
        resBoxHit = False
        for z in zones:
            if z.dir == -1 and h >= z.bot - tol and c <= z.top + tol and loRip < z.bot:
                resBoxHit = True
                if P["boxMode"] == "trigger":
                    res.append(("box", "flipped box" if z.flipped else "hourly box", z.top, z.bot, h > z.top and c < z.top))
        if P["useCB"] and cbTop is not None and h >= cbBot - tol and c <= cbTop + tol and loRip < cbBot:
            res.append(("box", "prior-close box", cbTop, cbBot, h > cbTop and c < cbTop))
        for nm, p in lv:
            if h >= p - tol and c <= p + tol and loRip < p - tol:
                res.append(("line", nm, p, p, h > p + tol and c < p))
        # divergence
        bullDiv = bearDiv = False
        if P["useDiv"] and div is not None and i >= P["divLen"] + 1:
            dl = div.get(t)
            prevLo = min(b[3] for b in bars[i - P["divLen"]:i])
            prevHi = max(b[2] for b in bars[i - P["divLen"]:i])
            dprev = [div.get(bars[j][0]) for j in range(i - P["divLen"], i)]
            if dl is not None and all(x is not None for x in dprev):
                bullDiv = l < prevLo and dl[1] > min(x[1] for x in dprev)
                bearDiv = h > prevHi and dl[0] < max(x[0] for x in dprev)
        rsiLo3 = min(x for x in rsi[i - 2:i + 1] if x is not None)
        rsiHi3 = max(x for x in rsi[i - 2:i + 1] if x is not None)
        prime = 570 <= m < 630
        moveATR = (c - rthOpen) / A if inRTH and rthOpen is not None and A > 0 else 0.0
        runUp = P["trendGuard"] and inRTH and moveATR >= P["trendATR"] and rthHi is not None and h >= rthHi - 0.5 * A
        runDn = P["trendGuard"] and inRTH and moveATR <= -P["trendATR"] and rthLo is not None and l <= rthLo + 0.5 * A

        def score(touch, rsi_pts, conf, flush, dv, pen, boxhit=False):
            if not touch:
                return 0
            loc = (2 if any(x[0] == "box" for x in touch) or (boxhit and P["boxMode"] == "confluence") else 1) + (1 if len(touch) >= 2 else 0)
            trap = 1 if any(x[4] for x in touch) else 0
            return loc + rsi_pts + trap + (1 if conf else 0) + (1 if prime else 0) + flush + (1 if dv else 0) - (2 if pen else 0)

        rsiL = 2 if rsiLo3 <= P["rsiOS"] - 10 else 1 if rsiLo3 <= P["rsiOS"] else 0
        rsiS = 2 if rsiHi3 >= P["rsiOB"] + 10 else 1 if rsiHi3 >= P["rsiOB"] else 0
        sL = score(sup, rsiL, bullRej or bullEng, 1 if hiDip - l >= 2.5 * A else 0, bullDiv, runDn, supBoxHit)
        sS = score(res, rsiS, bearRej or bearEng, 1 if h - loRip >= 2.5 * A else 0, bearDiv, runUp, resBoxHit)
        grade = lambda s: "A" if s >= 7 else "B" if s >= 5 else "C" if s >= 3 else ""
        ok = lambda g: g == "A" or (g == "B" and P["minGrade"] != "A") or (g == "C" and P["minGrade"] == "C")

        # manage trade
        closedNow = False
        if tr is not None and i > tr.i0:
            d = tr.dir
            exitPx = None
            if (l <= tr.sl) if d == 1 else (h >= tr.sl):
                exitPx, tr.exit_tag = tr.sl, ("BE" if tr.hit1 else "SL")
            else:
                if not tr.hit1 and ((h >= tr.tp1) if d == 1 else (l <= tr.tp1)):
                    tr.hit1 = True
                    tr.pts += (tr.tp1 - tr.entry) * d / 3
                    tr.rem -= 1 / 3
                    if P["beAfter1"]:
                        tr.sl = tr.entry
                if tr.hit1 and not tr.hit2 and ((h >= tr.tp2) if d == 1 else (l <= tr.tp2)):
                    tr.hit2 = True
                    tr.pts += (tr.tp2 - tr.entry) * d / 3
                    tr.rem -= 1 / 3
                if tr.hit2 and ((h >= tr.tp3) if d == 1 else (l <= tr.tp3)):
                    exitPx, tr.exit_tag = tr.tp3, "TP3"
                elif i - tr.i0 >= P["maxHold"] or not inRTH:
                    exitPx, tr.exit_tag = c, "TIME"
            if exitPx is not None:
                tr.pts += (exitPx - tr.entry) * d * tr.rem - P["cost"]
                tr.rem = 0
                tr.exit_t = t
                trades.append(tr)
                tr = None
                closedNow = True
                lastExit = i
        win = P["win"][0] <= m < P["win"][1]
        news = P["newsPause"] and abs(m - 600) <= P["newsMins"]
        can = win and not news and tr is None and not closedNow and i - lastExit > P["cooldown"]
        if P["entry"] == "confirm":
            longSig = can and sup and isDip and (bullRej or bullEng or any(x[4] for x in sup)) and grade(sL) and ok(grade(sL))
            shortSig = can and res and isRip and (bearRej or bearEng or any(x[4] for x in res)) and grade(sS) and ok(grade(sS))
        else:
            longSig = shortSig = False
            if can:
                trend = 0
                if hk >= 50:
                    closes60 = [b[4] for b in htf[hk - 49:hk + 1]]
                    ema = closes60[0]
                    for x in closes60[1:]:
                        ema = ema + (2 / 21) * (x - ema)
                    if P["trendFilter"] == "ema20_60m":
                        trend = 1 if o > ema else -1
                    elif P["trendFilter"] == "pdc":
                        trend = 0 if pdc is None else (1 if o > pdc else -1)
                    elif P["trendFilter"] == "dopen":
                        trend = 0 if dOpen is None else (1 if o > dOpen else -1)
                    elif P["trendFilter"] == "daily20":
                        # daily regime: last completed session close vs 20-session average of session closes
                        dcl = P.get("_dailyCloses")
                        if dcl:
                            dd = t.date()
                            past = [v for k, v in dcl if k < dd][-20:]
                            if len(past) >= 20:
                                trend = 1 if past[-1] > sum(past) / len(past) else -1
                    elif P["trendFilter"] == "ema_slope":
                        ema_prev = closes60[0]
                        for x in closes60[1:-5]:
                            ema_prev = ema_prev + (2 / 21) * (x - ema_prev)
                        trend = 1 if ema > ema_prev else -1
                lim = _limit_fill(i, bars, atr, rsi, lv, zones, cbTop, cbBot, P, prime, div, rthOpen, rthHi, rthLo, inRTH, trend)
                if lim is not None:
                    d, e, g, why, comp = lim
                    if ok(g):
                        t1, t2, t3 = _targets(P, atr[i - 1])
                        slDist = max(P["slMin"], min(P["slMax"], P["slATR"] * atr[i - 1]))
                        sl = e - d * slDist
                        tp1, tp2, tp3 = e + d * t1, e + d * t2, e + d * t3
                        tr = Trade(d, e, sl, tp1, tp2, tp3, i, g, why, t)
                        tr.comp = comp
                        signals.append((t, d, e, g, why, None, None))
                        if (l <= sl) if d == 1 else (h >= sl):   # stop inside the fill bar (conservative)
                            tr.pts, tr.rem, tr.exit_t, tr.exit_tag = (sl - e) * d - P["cost"], 0, t, "SL"
                            trades.append(tr)
                            tr = None
                            lastExit = i
                        continue
        if longSig and shortSig:
            longSig = sL >= sS
            shortSig = not longSig
        if longSig or shortSig:
            d = 1 if longSig else -1
            touch = sup if d == 1 else res
            if P["entry"] != "confirm":
                touch = supF if d == 1 else resF
            if P["entry"] == "confirm":
                e = c
            else:
                e = max(x[2] for x in touch) if d == 1 else min(x[3] for x in touch)
                e = min(e, o) if d == 1 else max(e, o)
            if P["tpMode"] == "fixed":
                t1, t2, t3 = P["tp"]
            elif P["tpMode"] == "atr":
                t1, t2, t3 = (k * A for k in P["tpAtr"])
            else:
                t1, t2, t3 = (max(a, b * A) for a, b in zip(P["tp"], P["tpAtr"]))
            defl = min(b[3] for b in bars[i - 2:i + 1]) if d == 1 else max(b[2] for b in bars[i - 2:i + 1])
            slDist = max(P["slMin"], min(P["slMax"], abs(e - defl) + P["slBufATR"] * A))
            sl = e - d * slDist
            tp1, tp2, tp3 = e + d * t1, e + d * t2, e + d * t3
            if P["snapTP"]:
                cands = []
                for z in zones:
                    if d == 1 and z.dir == -1 and z.bot > e + tol: cands.append(z.bot)
                    if d == -1 and z.dir == 1 and z.top < e - tol: cands.append(z.top)
                for _, p in lv:
                    if d == 1 and p > e + tol: cands.append(p)
                    if d == -1 and p < e - tol: cands.append(p)
                if cands:
                    nxt = min(cands) if d == 1 else max(cands)
                    if (d == 1 and tp1 < nxt < tp3) or (d == -1 and tp3 < nxt < tp1):
                        tp3 = nxt
                        tp2 = min(tp2, tp3) if d == 1 else max(tp2, tp3)
            g = grade(sL if d == 1 else sS)
            tr = Trade(d, e, sl, tp1, tp2, tp3, i, g, touch[0][1], t)
            tr.comp = dict(rsi=(rsiL if d == 1 else rsiS), trap=any(x[4] for x in touch), rej=(bullRej or bullEng) if d == 1 else (bearRej or bearEng), prime=prime, flush=(hiDip - l >= 2.5 * A) if d == 1 else (h - loRip >= 2.5 * A), div=bullDiv if d == 1 else bearDiv, conf=len(touch), box=supBoxHit if d == 1 else resBoxHit, pen=runDn if d == 1 else runUp, score=(sL if d == 1 else sS), atr=A, slDist=abs(e - sl), mins=m)
            signals.append((t, d, e, g, touch[0][1], round(rsi[i], 1), round(A, 1)))
            if P["entry"] != "confirm" and ((l <= sl) if d == 1 else (h >= sl)):
                tr.pts, tr.rem, tr.exit_t, tr.exit_tag = (sl - e) * d - P["cost"], 0, t, "SL"
                trades.append(tr)
                tr = None
                lastExit = i
    return trades, signals


def _add_zone(zones, top, bot, d, t, P):
    mid = (top + bot) / 2
    for z in zones:
        if z.dir == d and z.bot <= mid <= z.top:
            return
    zones.append(Zone(top, bot, d, t))
    if len(zones) > P["maxZones"]:
        zones.pop(0)


def summarize(trades, label=""):
    if not trades:
        return f"{label}: no trades"
    n = len(trades)
    tp1 = sum(1 for x in trades if x.hit1)
    sl = sum(1 for x in trades if x.exit_tag == "SL")
    pts = sum(x.pts for x in trades)
    wins = sum(1 for x in trades if x.pts > 0)
    longs = sum(1 for x in trades if x.dir == 1)
    return (f"{label}: {n} trades ({longs} long/{n - longs} short) | TP1 hit {100 * tp1 / n:.0f}% | stopped {100 * sl / n:.0f}% | "
            f"win {100 * wins / n:.0f}% | total {pts:+.1f} pts | avg {pts / n:+.2f} pts/trade")


def _targets(P, A):
    if P["tpMode"] == "fixed":
        return P["tp"]
    if P["tpMode"] == "atr":
        return tuple(k * A for k in P["tpAtr"])
    return tuple(max(a, b * A) for a, b in zip(P["tp"], P["tpAtr"]))


def _limit_fill(i, bars, atr, rsi, lv, zones, cbTop, cbBot, P, prime, div, rthOpen, rthHi, rthLo, inRTH, trend=0):
    """Resting-limit entry using only information known before the touch (previous bars + this bar's open)."""
    t, o, h, l, c, v = bars[i]
    A = atr[i - 1]
    R = rsi[i - 1]
    if A is None or R is None:
        return None
    tol = max(P["tolMin"], A * P["tolATR"])
    tick = P["tick"]
    prevHi = max(max(b[2] for b in bars[i - P["dipBars"]:i]), o)
    prevLo = min(min(b[3] for b in bars[i - P["dipBars"]:i]), o)
    cands = []  # (dir, price, name)
    for nm, p in lv:
        cands.append((1, p, nm))
        cands.append((-1, p, nm))
    if P["useCB"] and cbTop is not None:
        cands.append((1, cbTop, "prior-close box"))
        cands.append((-1, cbBot, "prior-close box"))
    if P["boxMode"] == "trigger":
        for z in zones:
            if z.dir == 1:
                cands.append((1, z.top, "flipped box" if z.flipped else "hourly box"))
            else:
                cands.append((-1, z.bot, "flipped box" if z.flipped else "hourly box"))
    best = None
    for d, p, nm in cands:
        if d == 1:
            if not (o > p and l <= p - tick and prevHi - p >= P["dipATR"] * A):
                continue
            key = p            # first level hit on the way down = highest
        else:
            if not (o < p and h >= p + tick and p - prevLo >= P["dipATR"] * A):
                continue
            key = -p           # first level hit on the way up = lowest
        if best is None or key > best[0]:
            best = (key, d, p, nm)
    if best is None:
        return None
    _, d, e, why = best
    conf = max(1, len({round(p, 2) for dd, p, _ in cands if dd == d and abs(p - e) <= tol}))
    boxhit = any((z.dir == d) and (z.bot - tol <= e <= z.top + tol) for z in zones)
    rsiPts = (2 if R <= P["rsiOS"] - 10 else 1 if R <= P["rsiOS"] else 0) if d == 1 else (2 if R >= P["rsiOB"] + 10 else 1 if R >= P["rsiOB"] else 0)
    flush = (prevHi - e >= 2.5 * A) if d == 1 else (e - prevLo >= 2.5 * A)
    dv = False
    if P["useDiv"] and div is not None and i >= P["divLen"] + 2:
        dprev = [div.get(bars[j][0]) for j in range(i - P["divLen"] - 1, i)]
        if all(x is not None for x in dprev):
            if d == 1:
                nqNew = bars[i - 1][3] < min(b[3] for b in bars[i - P["divLen"] - 1:i - 1])
                dv = nqNew and dprev[-1][1] > min(x[1] for x in dprev[:-1])
            else:
                nqNew = bars[i - 1][2] > max(b[2] for b in bars[i - P["divLen"] - 1:i - 1])
                dv = nqNew and dprev[-1][0] < max(x[0] for x in dprev[:-1])
    moveATR = (o - rthOpen) / A if inRTH and rthOpen is not None and A > 0 else 0.0
    pen = False
    if P["trendGuard"] and inRTH and rthHi is not None:
        pen = (moveATR <= -P["trendATR"] and e <= rthLo + 0.5 * A) if d == 1 else (moveATR >= P["trendATR"] and e >= rthHi - 0.5 * A)
    if P["trendFilter"] != "none" and P["wTrend"] == 0 and trend != 0 and trend != d:
        return None
    if conf < P.get("minConf", 1):
        return None
    if P.get("grading") == "v2":
        score = (2 if conf >= 2 else 0) + (1 if conf >= 3 else 0) + (1 if boxhit else 0) + (1 if rsiPts > 0 else 0) + (1 if flush else 0) + (1 if dv else 0) + (1 if prime else 0) - (2 if pen else 0)
        g = "A" if score >= 4 else "B" if score >= 2 else "C"
    else:
        loc = (2 if (boxhit and P["boxMode"] != "off") or "box" in why else 1) + (P["wConf"] if conf >= 2 else 0)
        score = loc + rsiPts + (1 if prime else 0) + (P["wFlush"] if flush else 0) + (P["wDiv"] if dv else 0) - (2 if pen else 0) + (P["wTrend"] * (1 if trend == d else -1 if trend != 0 else 0))
        g = "A" if score >= P["minScoreC"] + 4 else "B" if score >= P["minScoreC"] + 2 else "C" if score >= P["minScoreC"] else ""
    if not g:
        return None
    comp = dict(rsi=rsiPts, prime=prime, flush=flush, div=dv, conf=conf, box=boxhit, pen=pen, score=score, trap=False, rej=False, trend=trend, why=(why if not why.startswith('Fib') else 'Fib'))
    return d, e, g, why, comp
