"""Are FSP's entries closer to the indicator's levels than random moments in the same session windows?"""
import sys, os, csv, datetime as dt, random
sys.path.insert(0, os.path.dirname(__file__))
os.chdir(sys.argv[1])
import analyze_trades as at   # reuses levels(), fib_levels(), bars_for(), atr_series()
from zoneinfo import ZoneInfo
ET = ZoneInfo("America/New_York")
rows = list(csv.DictReader(open("trades_log.csv")))
random.seed(7)
def nearest_atr(day_date, t, px, bars, atr, idx):
    lv = at.levels(day_date)
    allv = dict(lv); allv.update(at.fib_levels(t))
    d = min(abs(px - v) for v in allv.values() if v is not None)
    return d / atr[idx] if atr[idx] else None
fsp, rnd = [], []
for path in sorted(os.listdir("positions")):
    if not path.endswith(".csv"):
        continue
    first = next(csv.DictReader(open("positions/" + path)), None)
    if not first:
        continue
    day = dt.datetime.strptime(first["et"], "%Y-%m-%d %H:%M:%S").date()
    bars, step = at.bars_for(day)
    atr = at.atr_series(bars)
    label = path[:-4]
    ents = [r for r in rows if r["day"] == label]
    for r in ents:
        t = dt.datetime.combine(day, dt.time.fromisoformat(r["entry"]), ET)
        idx = max(i for i, b in enumerate(bars) if b[0] <= t)
        v = nearest_atr(day, t, float(r["px"]), bars, atr, idx)
        if v is not None: fsp.append(v)
    win = [i for i, b in enumerate(bars) if b[0].date() == day and 570 <= b[0].hour * 60 + b[0].minute < 690]
    for i in random.sample(win, min(len(win), 200)):
        v = nearest_atr(day, bars[i][0], bars[i][4], bars, atr, i)
        if v is not None: rnd.append(v)
def frac(xs, k): return 100 * sum(1 for x in xs if x <= k) / len(xs)
for k in (0.25, 0.35, 0.5, 1.0):
    print(f"within {k:.2f} ATR: FSP entries {frac(fsp, k):5.1f}%  vs random moments {frac(rnd, k):5.1f}%")
print("n:", len(fsp), len(rnd))
