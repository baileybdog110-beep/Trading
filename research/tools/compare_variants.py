"""Compare one-change-at-a-time variants of the indicator defaults across data splits.

usage: python3 compare_variants.py <workdir>
"""
import sys, os, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
from nqdata import load
import backtest_fsp as bt

os.chdir(sys.argv[1])
htf = load("data/nq_60m.json")
nq1, nq2, nq5 = load("data/nq_1m.json"), load("data/nq_2m.json"), load("data/nq_5m.json")
es1, es2 = load("data/es_1m.json"), load("data/es_2m.json")
div1 = {r[0]: (r[2], r[3]) for r in es1}
div2 = {r[0]: (r[2], r[3]) for r in es2}
mid = nq2[len(nq2) // 2][0]            # split the 2-minute data in two halves
first2 = nq2[0][0]
daily_closes = sorted({r[0].date(): r[4] for r in htf if r[0].hour == 15}.items())


def stat(tr):
    if not tr:
        return "  n=0          "
    return f"{sum(x.pts for x in tr) / len(tr):+5.1f} ({len(tr):3d})"


def evaluate(over):
    t2, _ = bt.run(nq2, htf, dict(over, dipBars=5, divLen=10, maxHold=23, cooldown=2), div2)
    t1, _ = bt.run(nq1, htf, over, div1)
    t5, _ = bt.run(nq5, htf, dict(over, dipBars=2, divLen=4, maxHold=9, cooldown=1, useDiv=False), None)
    t5 = [x for x in t5 if x.t0 < first2]
    h1 = [x for x in t2 if x.t0 < mid]
    h2 = [x for x in t2 if x.t0 >= mid]
    pooled = t2 + t1 + t5
    return f"2m H1 {stat(h1)} | 2m H2 {stat(h2)} | 1m {stat(t1)} | 5m OOS {stat(t5)} || pooled {sum(x.pts for x in pooled) / len(pooled):+.2f} ({len(pooled)})"


VARIANTS = [
    ("indicator defaults", {}),
    ("confirmation-candle entries", dict(entry="confirm")),
    ("hourly boxes also trigger", dict(boxMode="trigger")),
    ("RTH open + today's PM trigger", dict(useOpen=True, usePM=True)),
    ("no Fibonacci levels", dict(fibSignal=False)),
    ("fixed 10/20/30 targets", dict(tpMode="fixed")),
    ("no breakeven after TP1", dict(beAfter1=False)),
    ("need >= 2.5 ATR flush", dict(dipATR=2.5)),
    ("need >= 2 stacked levels", dict(minConf=2)),
    ("daily 20-session trend filter", dict(trendFilter="daily20", _dailyCloses=daily_closes)),
    ("+ today's RTH-swing Fibonacci", dict(fibRTH=True)),
]
for name, over in VARIANTS:
    print(f"{name:32s} {evaluate(over)}", flush=True)
