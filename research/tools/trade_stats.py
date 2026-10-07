import csv, sys, os, statistics as st, collections
os.chdir(sys.argv[1])
rows = list(csv.DictReader(open("trades_log.csv")))
f = lambda r, k: float(r[k]) if r[k] not in ("", "None") else None
print("trades:", len(rows), "days:", len({r["day"] for r in rows}))
per = collections.Counter(r["day"] for r in rows)
print("per day:", dict(sorted(per.items())))
L = [r for r in rows if r["side"] == "long"]; S = [r for r in rows if r["side"] == "short"]
print(f"long {len(L)} ({100*len(L)/len(rows):.0f}%)  short {len(S)}")
def q(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs: return "n/a"
    return f"median {st.median(xs):.1f} | IQR {xs[len(xs)//4]:.1f}..{xs[3*len(xs)//4]:.1f} | n={len(xs)}"
print("hold minutes:", q([f(r, "hold_min") for r in rows]))
print("scale-in (avg price changed or qty>1):", sum(1 for r in rows if int(r["adds"]) > 0 or int(r["max_q"]) > 1), "of", len(rows))
print("max contracts:", collections.Counter(r["max_q"] for r in rows).most_common())
# counter-move: long after a decline over 15 min, short after a rise
cm = [r for r in rows if (r["side"] == "long" and f(r, "chg15") < 0) or (r["side"] == "short" and f(r, "chg15") > 0)]
print(f"entered against the last 15-min move: {len(cm)}/{len(rows)} = {100*len(cm)/len(rows):.0f}%")
print("15-min move into LONG entries (pts):", q([f(r, "chg15") for r in L]))
print("15-min move into SHORT entries (pts):", q([f(r, "chg15") for r in S]))
print("position in prior-60-min range, longs:", q([f(r, "pos60") for r in L]), "| shorts:", q([f(r, "pos60") for r in S]))
print("RSI(14) at long entries:", q([f(r, "rsi") for r in L]), "| <=30:", sum(1 for r in L if f(r, "rsi") is not None and f(r, "rsi") <= 30))
print("RSI(14) at short entries:", q([f(r, "rsi") for r in S]), "| >=70:", sum(1 for r in S if f(r, "rsi") is not None and f(r, "rsi") >= 70))
print("ATR(14) at entries:", q([f(r, "atr") for r in rows]))
print("distance to nearest indicator level (pts):", q([f(r, "near_dist") for r in rows]))
print("distance to nearest level (x ATR):", q([f(r, "near_dist_atr") for r in rows]))
within = lambda k: sum(1 for r in rows if f(r, "near_dist_atr") is not None and f(r, "near_dist_atr") <= k)
print(f"within 0.35 ATR of a level: {within(0.35)}/{len(rows)}  within 0.5 ATR: {within(0.5)}  within 1 ATR: {within(1.0)}")
print("nearest level type:", collections.Counter(r["near1"].split(":")[0].rstrip("0123456789.") for r in rows).most_common())
hrs = collections.Counter(r["entry"][:2] + (":00" if r["entry"][3:5] < "30" else ":30") for r in rows)
print("entry time buckets:", dict(sorted(hrs.items())))
pts = [f(r, "est_pts") for r in rows]
w = [p for p in pts if p > 0]; l = [p for p in pts if p <= 0]
print(f"est. result per trade (exit ~ bar close at flat time): win {100*len(w)/len(pts):.0f}% | avg win {st.mean(w):.1f} | avg loss {st.mean(l):.1f} | median {st.median(pts):.1f}")
