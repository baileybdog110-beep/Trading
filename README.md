# Trading

Private research on how **Futures Scalper (FSP, [@fspfutures](https://www.youtube.com/@fspfutures))** scalps NQ futures, and a TradingView indicator that turns those habits into chart levels, entries, exits and a long/short bias.

> Not affiliated with or endorsed by FSP. Educational use only — not financial advice. Futures are high risk; FSP himself blows prop accounts on 100–150 point moves.

| File | What it is |
|---|---|
| [`indicators/FSP_Reversal_Scalper.pine`](indicators/FSP_Reversal_Scalper.pine) | The TradingView indicator (Pine Script v6). Compiles with 0 errors / 0 warnings. |
| [`research/FSP_STRATEGY_LOG.md`](research/FSP_STRATEGY_LOG.md) | The analysis log: setup, levels, entry/exit patterns, risk habits, with timestamped quotes and a trade log. |
| [`research/fsp_trade_log.csv`](research/fsp_trade_log.csv) | Every position FSP held on 8 live streams (Sep 23 – Oct 5 2026), read off his NinjaTrader position box every 10 s. |
| [`research/BACKTEST.md`](research/BACKTEST.md) | How the indicator logic was tested on NQ data, what helped, what didn't, and the honest results. |
| [`research/tools/`](research/tools) | Python used for the transcription, OCR trade log and backtest (for reproducibility). |

## The style in one paragraph

FSP is a **counter-move level trader**, not a trend, ICT, order-flow or volume-profile trader. Before the open he marks yesterday's close (his yellow line), prior-day high/low, overnight and pre-market highs/lows, hourly support/resistance boxes and a Fibonacci retracement of the latest big swing (NinjaTrader levels including 76.4%). From 9:30 to about 11:00 ET on a 1-minute NQ chart he rests **limit orders at those levels** — buying flushes into support, shorting pops into resistance — often scaling in with a second order deeper. He takes **10–20–30 points**, moves the stop to breakeven after the first target, and holds a runner toward the next box. RSI(14) and ATR(14) are his only indicators, and he uses them for context: is the move stretched, and how big are candles today? In his words: *"Buy dips, sell rips, short pops, cover drops… lock 10, 15, 20 points, don't try to be hero."*

## Install (private)

1. On TradingView open a chart → **Pine Editor** (bottom panel) → **Open → New blank indicator**.
2. Delete the template, paste the whole of `indicators/FSP_Reversal_Scalper.pine`, click **Save** (name it anything), then **Add to chart**.
3. Keep it private: just don't click *Publish script*. Saved scripts live only in your account.

**Chart settings that match FSP:** `NQ1!` or `MNQ1!` (CME), **1-minute**, extended hours **on** (the overnight and pre-market levels need ETH data). The script times everything in New York time, whatever your chart timezone is.

## Reading the chart

- **Lines:** yellow = yesterday's close; orange = prior-day high/low; silver = overnight high/low; pink = pre-market highs/lows; aqua = Fibonacci of the latest swing; yellow dotted box = the prior-close consolidation box.
- **Blue/purple boxes:** auto hourly support/resistance zones. Dashed borders mean a broken box that flipped role (support became resistance).
- **`LONG B` / `SHORT A` labels:** a resting limit at that level was filled after a big enough dip or rip. Hover the label for entry, add level, stop, TP1/TP2/TP3, RSI and ATR. A white dotted line marks entry, red the stop, greens the targets, blue dashed the add level. **✓ / ✗** marks the exit and points.
- **Grade (A/B/C):** confluence, not certainty. It counts stacked levels, sitting inside a box, an RSI extreme, a ≥2.5 ATR flush, ES/NQ divergence, the 9:30–10:30 window, and subtracts for a runaway trend day. In testing it was *not* consistently predictive, so all grades are shown by default.
- **Ladder (right edge):** the next `BUY LMT` / `SELL LMT` level price would hit, already armed by a big enough move, with its stop and TP1. This is the actionable part: like FSP, you place the order before price arrives.
- **Dashboard:** bias (`LOOK LONG — buy limit …`, `LOOK SHORT — sell limit …`, `WAIT`, or a trend-day warning), nearest support/resistance, both ladders with grade/add/stop/targets, RSI, ATR with suggested targets, gap and daily-candle context, hourly structure, signal window or news pause, VIX, last trade, and running stats on your chart (net of costs).

## Alerts

Create an alert on the indicator and choose **Any alert() function call** to receive the full message (`FSP LONG B NQ1! @ … | SL … | TP …/…/… | Fib 61.8%`) plus **approaching level** heads-ups. The fixed `alertcondition` entries (LONG / SHORT / any / approaching) work too.

## Defaults worth knowing

| Setting | Default | Why |
|---|---|---|
| Entry style | Limit at level | How FSP trades, and the only style that tested positive. *Confirmation close* waits for a rejection candle, enters later and tested negative. |
| Signal window | 09:30–11:30 ET, paused ±2 min around 10:00 | FSP trades the open, avoids midday, and covers into 10:00 data. |
| Levels that trigger | Y-close, PDH/PDL, ON high/low, yesterday's PM high/low, prior-close box, Fib | RTH open, today's PM levels, Asia levels and boxes are drawn but only add confluence; as triggers they diluted the edge. |
| Dip/rip needed | ≥ 1.5 × ATR into the level | He buys flushes, not drifts. |
| Targets | max(10/20/30 pts, 0.7/1.4/2.1 × ATR), ⅓ off at each | His 10-20-30, scaled up on high-ATR days. |
| Stop | 1 × ATR, clamped 8–30 pts; breakeven after TP1 | FSP often trades without a hard stop. This indicator always shows one. |

## How good is it?

Honest summary (details in [`research/BACKTEST.md`](research/BACKTEST.md)). These are NQ results after 0.5 pt per trade of costs, with entries filled only when price trades one tick through the level and the stop assumed hit first whenever a bar touches both:

| Data | Trades | TP1 hit | Avg / trade |
|---|---|---|---|
| 1-min, Sep 30 – Oct 7 2026 | 41 | 54% | +2.2 pts |
| 2-min, Sep 1 – Oct 7 2026 | 128 | 57% | +2.1 pts |
| 5-min, Jul 29 – Aug 31 2026 (held out) | 83 | 46% | +1.0 pts |

That is a **small edge, positive in every sample but not by much**. It comes from about three months of a rising market, and with this little data the per-side and per-grade splits are noise. Treat the indicator as a map of where FSP would act and a disciplined exit plan, not as a signal service. Paper-trade it first.
