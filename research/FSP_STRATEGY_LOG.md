# How FSP (Futures Scalper) trades NQ — strategy log

*Research date: Oct 7 2026. Subject: [youtube.com/@fspfutures](https://www.youtube.com/@fspfutures) (63.4K subscribers, ~460 videos). Daily live NQ scalping from 9:30 ET, simulcast to Twitch and Kick.*

> Not affiliated with FSP. Everything below comes from his public streams and videos. Quotes are auto-transcribed (Whisper) and may contain small transcription errors; times are New York time.

## TL;DR

| | |
|---|---|
| **Style** | Short-term **reversal / mean-reversion scalper** at pre-marked levels. Not a trend trader, not ICT/FVG, not order-flow, volume-profile, Bookmap, GEX or DOM. |
| **Chart** | NinjaTrader 8, **NQ minis**, **1-minute** chart (Rithmic + Tradovate feeds); 5-min, hourly, 4-hour and daily for context |
| **Indicators** | **RSI(14, 3)** and **ATR(14)** on the 1-minute chart, **Fibonacci retracement** (NinjaTrader levels: 23.6 / 38.2 / 50 / 61.8 / **76.4**), and he watches the **VIX** |
| **Levels** | Hand-drawn blue **S&R boxes** (hourly zones, prior consolidations, swing lows/highs), **yesterday's close** (yellow line), prior-day high/low, **overnight / Asia / London** highs and lows, **yesterday's pre-market low/high**, previous breakout/breakdown zones |
| **Entry** | **Resting limit orders at the level**, buying flushes into support and shorting pops into resistance, usually **against the last 15–30 min move**. **Scales in** with a second order deeper in the box. Variants: double bottom/top at the box, "bear trap / inversion" (sweep below the level, then reclaim), retest of a broken level. |
| **Exit** | **10–15–20 points** typical (up to 30, or ~100 on a big flush); covers part, then **stop to breakeven**, holds a runner toward the next box; flattens or covers into **10:00 data** |
| **Time** | 9:30 to ~11:00 ET is the core; "generally I don't like to enter midday" |
| **Risk** | Mostly **no hard stop** ("I don't do the 10 point stop loss anymore"), adds to losers, rotates many prop accounts. Accepts blown accounts: "when it goes straight down like 150 points, there's no way to adjust." |
| **Mantra** | *"Buy dips, sell rips, short pops, cover drops. Not trying to be hero."* |

## 1. Sources and method

YouTube blocks caption and audio downloads from cloud servers, so the analysis used the **same daily streams from FSP's Twitch and Kick archives**, plus YouTube metadata and preview frames:

| Source | What was used |
|---|---|
| 8 full live sessions: Sep 23, 24, 25, 28, 29, 30, Oct 1, Oct 5 2026 (≈ 21 hours) | Audio transcribed with Whisper (the trading hours of 7 sessions; Sep 23 is covered by the trade log and screenshots). The NinjaTrader **position box** (side, size, average price) was read by OCR **every 10 seconds**, giving an exact log of 100+ trades. 720p/1080p chart screenshots were taken at entries. |
| Channel page and video list (68 uploads + 132 past streams) | Titles, descriptions and links: course site fspfutures.com, fspnow.com, Discord. |
| *2 Best Indicators for Day Trading Futures (NinjaTrader)* | Preview frames show **RSI (14, 3)** and **ATR** ("I don't change anything"), plus captions on ATR regimes and "reversal zones". |
| *How to Scalp NQ FAST: Long and Short* | Preview frames: clips of limit fills at boxes, "cover some", "stop breakeven", "holding last one", "points right, don't be hero". |
| Moderator notes pinned in chat | "FSP looks for 10-20-30 or as price action points give to him. He usually does not set SL – manually trades them." · "FSP does not trend trade, use ICT, FVG, Bookmap, Vol prof., GEX, DOM… FSP is a price action trader looking for short-term reversal – may be counter trend. His S&R boxes." · "The bubbles and boxes are manually drawn – not an indicator. FSP uses ATR and Fib retracement as indicators only. He also references the VIX." · "FSP trades NinjaTrader8 \| Futures NQ Mini's \| 1 minute chart … NY Session Only." |
| NQ/ES 1-, 2-, 5- and 60-minute bars | Lined up with every OCR'd trade, and used for the backtest. |

## 2. Chart setup

- **Platform:** NinjaTrader 8 with Chart Trader buttons. Live P&L, position, and resting LMT/STP orders are visible on the chart.
- **Main chart:** NQ (front month) **1-minute**, often zoomed out over 1–3 days so the overnight session and prior days' structure are visible. A small second chart sits top-right.
- **Bottom panel:** **ATR(14)**. It read ~15–29 points in the first hour on the sampled days; he uses it to size targets and stops. The **RSI(14,3)** panel appears in older setups and in his indicator video, and he points viewers to it live ("It's an indicator you have to add on your [chart], it's called RSI", Sep 24, 10:00).
- **Drawings:**
  - Light-blue **rectangles**, his "S&R boxes". These are hourly zones, the prior day's closing consolidation, overnight swing lows/highs, and earlier days' swing lows/highs.
  - A **yellow line**: yesterday's close (sometimes the prior-day or overnight low).
  - A **Fibonacci retracement** across the latest big swing.
  - **Trendlines/channels** drawn on the opening move, with circles ("bubbles") marking touch points.

> "This yellow line is yesterday's close right here. And then we have the pre-market low and in this box, this box will be stronger." — Oct 1, 09:48

> "Right now I want to see this box defend it, okay? because this box here is kind of like the consolidation zone of the close yesterday. If we lose this box here, we can probably do an M-shape and come down here for this box." — Sep 29, 09:44

## 3. The levels

| Level | Evidence |
|---|---|
| **Hourly S&R boxes** | "Right now they went to the hourly previous support zone here… I expect this hourly zone here to be held." (Oct 1, 10:12) · "On the hourly chart, they have to hold this box here. If they don't hold this hourly box, we're gonna be at 350 and 400s." (Oct 1, 10:56) |
| **Yesterday's close / prior-close consolidation** | Yellow line; "consolidation zone of the close yesterday" (Sep 29); "we're just back down to yesterday's consolidation zone here… 620 is gonna be key" (Sep 25, 10:17) |
| **Prior-day high/low** | "Come to this previous day high zone here. If we don't hold this here, it's gonna be pretty bad." (Sep 25, 10:05) · "They didn't go for the Friday's highs here." (Oct 5) |
| **Overnight / Asia / London** | "This is like overnight London Asia low here… if they break it through then it's gonna be pretty bad" (Sep 28, 09:51) · "the bulls have to buy straight into this Asia high here" (Oct 5, 09:43) |
| **Yesterday's pre-market low** | "If it goes straight down, panic and retest yesterday's pre-market low in this zone here, I'll take that trade." (Oct 1, 09:49) |
| **Fibonacci (61.8 / 76.4 especially)** | "You don't want to see 76.4 again… whether they hold this ideally 600 level [61.8 %] … if you retest this 76.4 … 500 level, it'll be much, much weaker." (Sep 28, 09:31) · "I drew a fib from yesterday's pre-market low to this overnight high… like 650 points." (Oct 1, 09:40) · "I'm going to do the new fib for today… to the RTH high here." (Sep 28, 10:51) |
| **Prior swing lows/highs (multi-day)** | "Last Thursday's lows is this box down here, 380." (Sep 28, 09:52) |
| **Broken levels** | "Previous support on the box pumped and then rejected, retested, rejected" (Oct 1, 10:57) · "Be careful when we get to this previous breakdown candle here." (Sep 25) |

The screenshots match this. On Sep 28 his Fibonacci ran from the Sep 24 London low (30,370.68) to 31,000.00, with levels 30,851 / 30,759 / 30,685 / 30,611 / 30,519. The boxes sat at 30,525–30,580 (the overnight low) and 30,770–30,820.

## 4. Entries

**Core pattern: fade the move into the level, with resting limits.**

- *Sep 28, 09:34:38:* **long 1 @ 30,689.50**. That is the **50 % Fibonacci (30,685.24)**, bought after a 70-point drop from the opening spike. His average price shows adds at ~30,652 and ~30,626 (3+ contracts).
- *Sep 28, 10:11:42:* **long 2 @ 30,534.50**, inside the overnight-low box, at the yellow line, just above the 76.4 % Fibonacci (30,519). Price had fallen 128 points in 15 minutes.
- *Sep 28, 10:46:02:* **long 1 @ 30,408.50** at the top of the multi-day box (Sep 24 low), with a second **BUY LMT at 30,371.50**, the box bottom (= the 100 % Fibonacci).
- *Sep 29, 09:43:00:* **long 1 @ 30,556.50**, the top of the "close of yesterday" box, with **BUY LMTs at 30,529.50 and 30,513.00** deeper in the box. Out 3 minutes later for **+31 points ($620)**.
- *Sep 29, 09:57:03:* **short 1 @ 30,645.25**. "I'm still trying to short into the 645. There it is… filled on the short." That level is the pre-open consolidation that had just broken, retested from below.

A typical opening game plan, said one minute before the open:

> "Game plan's very simple: morning pop, fade for short scout. Comes down here, look for a base to attack this box… 680, because that was the low of yesterday." — Sep 24, 09:29

Variants he names:

- **Box defence / double bottom–top:** "If they don't hold here, they may go back to the box and do a double bottom test." (Sep 25)
- **Bear trap / bull trap, his "inversion":** "I'm looking for like a bear trap inversion long here." (Oct 1, 09:46) · "…contention zone here above 640, looking for them to sweep the high… we break this, we go back down here to balance" (Sep 29, 10:58)
- **Gap fade** (mainly in his options swings): "When you get a gap up, you gotta sell." · "selling the morning gap up here… totally normal" (Sep 25)
- **Joining momentum only occasionally:** "if something has momentum I may join that." The usual stance, though: "Normally I'm a reversal trader… Most of these gurus on YouTube, they do the break and retest… I don't do that." (Oct 5)

## 5. Exits and trade management

- **Targets:** "buy some dips, sell some rips, lock 10, 15, 20 points, don't try to be hero" (Sep 30). The moderator says 10–20–30. On a big flush he holds for more: "This is a hundred point bounce" (Oct 1).
- **Partial then breakeven:** captions "NICE COVER SOME GUYS" → "STOP BREAKEVEN BEAUTIFUL" → "ONE HOLDING LAST ONE". Also "Could be a double top. I took one holding one left." (Sep 30)
- **Why not hold for 100:** "Why would you hold for 100? I see the gurus do that with one micro… because I don't trade micros." (Sep 30)
- **News:** he tries to cover before 10:00 releases: "I couldn't cover on the consumer sentiment news" (Sep 29).
- **ATR sets expectations:** from his indicator video, "typically speaking at New York open [ATR is] somewhere between 10 to 15", and when it rises "you can expect the candles within 10 to 30 point range". In April 2025 tariff volatility ATR ran 35–60, against a "normal 10 point" regime.

## 6. Risk habits (copy with care)

- **No hard stop, usually:** "There's some caveat to it, like I don't do the 10 point stop loss anymore; other than that pretty much everything's the same [as two years ago]." (Oct 1, 11:20)
- **Averages into losers across accounts ("first entry / second entry" rotation):** "The first entry that was down got back green. Now you go to the second entry and hold this entry. If it comes all the way back down, you do another entry." (Oct 5, 10:01)
- **Blown accounts are a cost of business:** "Blown accounts happen, right? When it goes straight down like 150 points, there's no way to adjust. But what you don't wanna do is you don't wanna blow like 10 accounts on the way down." (Oct 1, 10:04)
- **Fading strong trends hurts:** Oct 5 opened with a straight 200+ point grind up. "After 150 point pump and to keep on going, that's how squeezes happen. Some people keep shorting like me…" (09:42), then "what a stubborn grind up, huh, not one meaningful pullback, crazy" (10:28).

The indicator keeps the entry and exit logic but **always shows a stop** (1 × ATR, 8–30 pts). It also includes a **trend-day guard** for exactly the Oct 5 situation.

## 7. What his actual trades look like (OCR trade log)

Every position change on his Chart Trader across the 8 streams, matched to NQ bars: [`fsp_trade_log.csv`](fsp_trade_log.csv). Results are estimated from the bar close at the moment he went flat, so treat them as approximate.

How to read the CSV:

- `first_fill_px` / `final_avg_px`: the average price shown on his position box at entry and after any adds.
- `move_15m_into_entry`: NQ change over the 15 minutes before entry.
- `pos_in_prior_60m_range`: 0 means the entry was at the low of the last hour, 1 at the high.
- `nearest_level`: the indicator's nearest auto level. `prevPML`/`prevPMH` are yesterday's pre-market low/high, `PDC` yesterday's close, `ON*` overnight, `PM*` today's pre-market, `CB*` the prior-close box, `Fib*` the Fibonacci levels.
- `bars_used`: 1-minute bars where available (Sep 30 onward), otherwise 2-minute.

**117 trades over 8 sessions** (Sep 23 – Oct 5 2026):

| Session | Trades | Long / short | Day in short |
|---|---|---|---|
| Sep 23 | 23 | 3 / 20 | Sold off ~370 pts from the open, then chopped. He shorted the pops. |
| Sep 24 | 20 | 14 / 6 | Gap down, then a rally of ~300 pts |
| Sep 25 | 6 | 2 / 4 | Short stream |
| Sep 28 | 15 | 12 / 3 | Fell ~400 pts. He kept buying dips at Fibonacci / box levels. |
| Sep 29 | 14 | 10 / 4 | Opening flush into the prior-close box, then a range |
| Sep 30 | 12 | 6 / 6 | Rallied ~400 pts off the pre-market low, then stalled |
| Oct 1 | 18 | 17 / 1 | Fell ~600 pts from the overnight high. Dip-buying all morning. |
| Oct 5 | 9 | 5 / 4 | Stubborn grind up. Early shorts got squeezed. |

- **Direction:** 59% long, 41% short. Direction follows the day's location more than the trend (see Sep 23 vs Oct 1).
- **Against the move:** **68%** of entries faded the previous 15 minutes. Longs came after a median **−36 pt** drop, shorts after a median **+12 pt** pop. Longs sat at a median 0.4 of the prior hour's range, shorts at 0.6.
- **Holding time:** median **4.3 min** (middle half 1.7–8.7 min).
- **Size:** 1 contract on 35% of trades, 2 on 23%, 3–7 on 34%. **74%** of trades show a scale-in (average price moved or size > 1).
- **RSI is not the trigger:** median RSI(14) at entry was 44 on longs (only 11 of 69 at ≤ 30) and 52 on shorts (3 of 48 at ≥ 70).
- **Levels:** 45% of entries were within 0.35 ATR of one of the indicator's auto levels, against 34% of random moments in the same windows (58% vs 45% within 0.5 ATR). The nearest level was most often a **Fibonacci** level (56), **yesterday's pre-market low/high** (24) or **yesterday's close** (7). The rest were mostly at his hand-drawn boxes and trendlines, which an auto-indicator only approximates.
- **Time of day:** 9:30–10:00: 29 · 10:00–10:30: 24 · 10:30–11:00: 23 · 11:00–11:30: 13 · after 11:30: 28 (mostly the two long sessions, Sep 23–24).
- **Estimated outcome:** about **68% winners**, average winner **+30 pts**, average loser **−19 pts**, median **+16 pts** per trade. This is approximate, and only for the account visible on screen; he mirrors trades across many prop accounts, and the blown-account days don't show up as single trades.

Two more observations from the screenshots:

- He **re-anchors the Fibonacci intraday** (Sep 23: to that morning's 31,014 → 30,642 sell-off, then shorted the 50–61.8% pop at 30,807). An automatic "today's swing" Fibonacci made the backtest worse, so the indicator keeps the multi-session swing and leaves intraday re-anchoring to you.
- **Opening minutes are fast:** several trades last under a minute (for example Sep 28 09:32:48: short into the opening spike, flat 40 s later).

## 8. What the indicator encodes, and what it can't

| FSP habit | In `FSP_Reversal_Scalper.pine` |
|---|---|
| Yesterday's close, PDH/PDL, overnight, pre-market, Asia levels | Drawn automatically; the main ones trigger entries |
| Prior-close consolidation box | Auto box from the last 30 min of yesterday's RTH |
| Hourly S&R boxes | Auto boxes from confirmed hourly swing highs/lows; flip once when broken; used as confluence |
| Fibonacci of the latest big swing, 76.4 % | Auto fib over the last ~3 sessions of hourly bars (NinjaTrader ratios) |
| Fade into the level with resting limits | Default entry style "Limit at level", requiring a ≥ 1.5 ATR dip/rip into it |
| Scale in deeper | "Add" level shown (0.8 ATR beyond entry) |
| RSI(14,3), ATR(14) | Context and grading; ATR scales targets and stops |
| 10-20-30, stop to BE, runner | TP1/TP2/TP3 = max(10/20/30, 0.7/1.4/2.1 × ATR); ⅓ off each; BE after TP1 |
| NY open, avoid midday, cover into 10:00 data | 09:30–11:30 window, pause ±2 min around 10:00 |
| VIX, ES/NQ divergence | VIX in the dashboard; ES divergence adds to the grade |
| Trendlines, "bubbles", reading the tape, multi-account rotation, no-stop averaging | **Not encoded.** Discretionary, or deliberately left out for safety |

Backtest of these rules: [`BACKTEST.md`](BACKTEST.md).
