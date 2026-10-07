"""Evaluate the indicator defaults on the downloaded NQ data.

usage: python3 final_eval.py <workdir>     (workdir must contain data/*.json from fetch_data.sh)
"""
import sys, os, datetime as dt, collections, json
sys.path.insert(0, os.path.dirname(__file__))
from nqdata import load
import backtest_fsp as bt

os.chdir(sys.argv[1])
htf = load("data/nq_60m.json")
nq1, nq2, nq5 = load("data/nq_1m.json"), load("data/nq_2m.json"), load("data/nq_5m.json")
es1, es2 = load("data/es_1m.json"), load("data/es_2m.json")
div1 = {r[0]: (r[2], r[3]) for r in es1}
div2 = {r[0]: (r[2], r[3]) for r in es2}
first2 = nq2[0][0]
sets = {
    "1-minute": (nq1, div1, {}),
    # bar-count settings scaled so they cover the same clock time
    "2-minute": (nq2, div2, dict(dipBars=5, divLen=10, maxHold=23, cooldown=2)),
    "5-minute (before the 2-minute data)": (nq5, None, dict(dipBars=2, divLen=4, maxHold=9, cooldown=1, useDiv=False)),
}
for name, (bars, div, over) in sets.items():
    trades, _ = bt.run(bars, htf, over, div)
    if name.startswith("5-minute"):
        trades = [x for x in trades if x.t0 < first2]
    print(bt.summarize(trades, f"{name:36s}"))
    for key, fn in [("side", lambda x: "long" if x.dir == 1 else "short"), ("grade", lambda x: x.grade), ("level", lambda x: x.comp["why"])]:
        g = collections.defaultdict(list)
        for x in trades:
            g[fn(x)].append(x)
        print("   by", key, "|", " | ".join(f"{k}: n={len(v)} avg={sum(t.pts for t in v) / len(v):+.1f}" for k, v in sorted(g.items())))
