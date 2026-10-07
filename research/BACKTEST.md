# Backtest notes — FSP-Style NQ Reversal Scalper

The Pine logic was re-implemented in Python ([`tools/backtest_fsp.py`](tools/backtest_fsp.py)) and run on NQ front-month bars, so every design choice could be tested before writing it into the indicator.

## Data

| Set | Bars | Period | Use |
|---|---|---|---|
| NQ 1-minute | 9.3k | Sep 30 – Oct 7 2026 (6 sessions) | The chart FSP trades; small sample |
| NQ 2-minute | 22k | Sep 1 – Oct 7 2026 (26 sessions) | Main tuning set, split into two halves around Sep 21 (H1, H2) |
| NQ 5-minute | 17k | Jul 29 – Aug 31 2026 | Out-of-sample check. Not used in the first round of tuning, but the later comparisons below did look at it, so it is only partly untouched. |
| NQ 60-minute | 13.7k | 2024 – 2026 | Hourly boxes and the Fibonacci swing |
| ES 1/2-minute | — | same | ES/NQ (SMT) divergence |

Bar-count settings were scaled to keep the same clock time on 2-minute and 5-minute bars (e.g. dip lookback 10 bars on 1-minute = 5 on 2-minute).

## Simulation rules (deliberately conservative)

- **Limit entries** fill only if price trades **one tick through** the level. The level must be approached from the right side: the bar opens above a support, or below a resistance.
- The fill decision, grade and stop use **only information known before the touch**: the previous bar's ATR/RSI, the previous bars' high/low and this bar's open.
- If the stop lies inside the fill bar's range, the trade is counted as **stopped in that bar**.
- On every later bar the **stop is checked before targets**, so a bar that touches both counts as a loss.
- Exits: ⅓ at TP1, TP2 and TP3 (max(10/20/30 pts, 0.7/1.4/2.1 × ATR)); the stop moves to breakeven after TP1; time stop at 45 one-minute bars; everything is flat at the end of RTH.
- **0.5 point per trade** of costs (≈ $10 per NQ contract for commission and slippage).

## A bug worth knowing about

The first version of the limit simulation used the fill bar's close to decide whether a touch "counted", and the fill bar's low to place the stop. That is look-ahead: it silently dropped the worst fills (bars that blew through the level). It made the strategy look like +10 pts/trade. With the look-ahead removed (rules above) the real number is about **+2 pts/trade**. Everything below is the corrected version.

## What the tests said

Each change was tested against the final defaults (below). Cells show avg points per trade after costs, with the number of trades in brackets.

| Change from the defaults | 2-min H1 | 2-min H2 | 1-min | 5-min OOS | Pooled |
|---|---|---|---|---|---|
| **Final defaults** | +0.9 (67) | +3.4 (61) | +2.2 (41) | +1.0 (83) | **+1.72 (252)** |
| Confirmation-candle entries instead of limits | −3.3 (57) | +2.3 (63) | +0.1 (45) | −2.8 (70) | −0.99 (235) |
| Hourly boxes also trigger entries | −0.0 (80) | +1.6 (66) | −1.4 (49) | −3.5 (94) | −1.01 (289) |
| RTH open + today's pre-market H/L also trigger | +0.7 (77) | +2.9 (69) | −1.8 (54) | +1.4 (89) | +1.00 (289) |
| Drop the Fibonacci levels | −1.2 (42) | +0.4 (47) | −1.1 (28) | −0.2 (66) | −0.40 (183) |
| Fixed 10/20/30 targets (no ATR scaling) | −0.1 (74) | +0.2 (69) | −0.7 (45) | −6.6 (85) | −2.15 (273) |
| No breakeven after TP1 | −0.2 (60) | +4.2 (58) | +4.0 (40) | −0.5 (83) | +1.43 (241) |
| Need a ≥ 2.5 ATR flush | −3.4 (28) | +1.2 (33) | +5.1 (27) | −7.1 (37) | −1.43 (125) |
| Need ≥ 2 stacked levels | −0.4 (16) | +7.8 (25) | +4.4 (15) | −3.8 (26) | +1.91 (82) |
| Daily-trend regime filter (with the 20-day trend only) | −9.6 (40) | +5.8 (36) | +1.6 (24) | −7.5 (50) | −3.43 (150) |
| Add a "today's RTH swing" Fibonacci (FSP re-anchors intraday) | −3.6 (81) | +2.7 (75) | −0.9 (56) | −3.0 (89) | −1.36 (301) |
| Long trades only | +7.1 (32) | +7.1 (34) | +2.0 (20) | −0.1 (51) | +3.68 (137) |
| Short trades only | −4.8 (35) | −1.2 (27) | +2.3 (21) | +2.6 (32) | −0.61 (115) |

What this means:

- **Limit entries beat confirmation entries.** Waiting for a rejection candle enters later and gives up the bounce. FSP rests his orders at the level for the same reason.
- **The auto hourly boxes are better as context than as triggers.** FSP's own boxes are hand-drawn; the auto version is a rough stand-in, so in the indicator a box only raises the grade.
- **The Fibonacci levels carry a lot of the edge.** FSP frames whole days around them (Sep 28: "hold this 600 level [61.8 %]… you don't want to see 76.4 again"). The multi-session swing works. An automatic re-anchor to today's swing does not: FSP picks those anchors by eye.
- **ATR-scaled targets matter.** On high-volatility days 10/20/30 is too small for the noise.
- **Longs did better in this (rising) market**, but shorts were positive on the 1-minute and out-of-sample sets, so no direction filter is applied. Use the *Direction* input if you want one.
- Stacked levels and big flushes look good in some samples and bad in others: too little data to make them rules.

## Final configuration (the indicator defaults)

Limit entries; trigger levels = yesterday's close, prior-day high/low, overnight high/low, yesterday's pre-market high/low, prior-close box and the Fibonacci levels; boxes add confluence only; dip/rip ≥ 1.5 ATR; tolerance 0.35 ATR; stop 1 ATR clamped 8–30 pts; breakeven after TP1; window 09:30–11:30 ET with a ±2 min pause at 10:00.

| Data | Trades | Long/short | TP1 hit | Stopped | Avg / trade | Total |
|---|---|---|---|---|---|---|
| 1-min Sep 30 – Oct 7 | 41 | 20 / 21 | 54% | 46% | **+2.2 pts** | +88 pts |
| 2-min Sep 1 – Oct 7 | 128 | 66 / 62 | 57% | 43% | **+2.1 pts** | +266 pts |
| 5-min Jul 29 – Aug 31 (out of sample) | 83 | 51 / 32 | 46% | 54% | **+1.0 pts** | +80 pts |

By level (2-min): Fibonacci was the workhorse (61 trades, +3.1). Yesterday's pre-market high/low, the prior-close box and yesterday's close were mildly positive. **Shorting the overnight high lost in all three sets** (32 trades, about −7 pts each). Buying the overnight low won in all three. That fits a rising market, where the overnight high is a breakout level, and it matches FSP getting squeezed shorting the Asia high on Oct 5. It stays a trigger because that is FSP's approach, but it is the first level to switch off (set *Direction* to *Long only*, or untick *Overnight high/low*) if you want fewer fades of strength.

## How to read this

- The edge is **small and thin**: +1 to +2 points per trade on roughly 250 trades over about 2½ months of mostly rising NQ. A few bad fills or a regime change can erase it. FSP's own results also lean on discretion this code cannot copy: hand-drawn boxes, reading the tape, rotating 10–20 prop accounts, and averaging into losers.
- The long/short and grade splits flip sign between samples. Don't over-read them.
- Nothing here includes the scale-in add. FSP adds to losers, which raises the win rate but makes the losing tail much worse. He blows accounts on 100–150 point moves.
- Re-run the numbers on fresh data before trusting any of them: `research/tools/fetch_data.sh work && python3 research/tools/final_eval.py work && python3 research/tools/compare_variants.py work`. Yahoo only keeps about 7 days of 1-minute and 60 days of 2-minute history, so each run sees a new window.
