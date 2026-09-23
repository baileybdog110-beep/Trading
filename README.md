# PropPath

A progress tracker, trade analyzer and coach for **Apex Trader Funding** and other **Tradovate** prop accounts. It works for both **evaluations** and **PA (funded)** accounts.

- **Progress breakdown.** For an eval: profit left to target, drawdown left, trailing threshold, trading days and a pass/fail checklist. For a PA: a payout checklist (trading days, $50+ qualifying days, 30% consistency rule, safety net, min payout), how much you can withdraw and exactly what's missing.
- **Your plan.** A daily goal, a daily max loss, risk per trade and a suggested contract size, all based on the drawdown you have left and your own average loss per contract.
- **Pass / payout odds.** A Monte Carlo simulation that replays your own trading days 4,000 times to estimate your chance of hitting the goal before the threshold.
- **Trade analysis.** Win rate, profit factor, expectancy, payoff ratio, streaks, hold times, and P&L by hour, weekday, instrument, trade # of the day, hold time, side and size.
- **Coach.** Ranked, specific advice: revenge trading, sizing up after losses, overtrading, giving back profits, holding losers, losing hours and instruments, consistency-rule fixes, contract-limit and 30% negative-P&L rule breaches, and more.

## Run it

Requires Node 18+. There are no dependencies to install.

```bash
npm start          # http://localhost:3000
npm test           # engine tests
```

## Getting your trades in

| Method | Works for | How |
|---|---|---|
| **Import CSV** (recommended) | Every Apex / Tradovate account | Tradovate → **Account Reports** → pick the account → **Performance** tab → set the date range → **Download**. Drop the file into PropPath. NinjaTrader trade exports and most journal CSVs also work. |
| **Connect Tradovate** | Accounts where you have Tradovate API access | Username, password, and your API **cid** + **secret** (Tradovate → Application Settings → API Access). Most Apex accounts use the **Demo** environment. |
| **Demo** | Trying it out | Loads a sample eval and a sample PA account. |

Notes:
- The Tradovate API only returns recent fills. Use the Performance CSV for your full history, and sync with the API to stay current (trades are merged and deduplicated).
- Tradovate's Performance P&L excludes commissions. Enter your round-turn commission per contract when you import, or enter your current balance.
- The API connection is **read-only**. It never places or changes orders. Passwords and tokens stay in memory and are never saved. Accounts and trades are stored only in your browser's localStorage.

## Accuracy notes

- Apex trails the threshold on your highest **unrealized** balance. Closed-trade data can't show that, so the computed threshold may be slightly low. For an exact number, enter the liquidation threshold from your Apex dashboard in **Settings**.
- Rule defaults (targets, drawdowns, contract limits, payout caps, consistency %, safety net, etc.) follow Apex's published rules as of this writing. Firms change their rules, so check them against Apex's help center. Every rule can be edited per account in **Settings**, and other firms can be modeled the same way (including end-of-day or static drawdown).
- The 30% negative-P&L check uses realized losses as a stand-in for open losses.

## Layout

```
server.js              static server + Tradovate API relay (/tv/{live|demo}/...)
public/index.html      app shell and dialogs
public/styles.css      light/dark theme
public/js/
  rules.js             Apex presets, trailing threshold, eval & PA progress
  analytics.js         stats, breakdowns, behavior detection, Monte Carlo, daily plan
  coach.js             ranked advice
  csv.js               Tradovate / NinjaTrader / generic CSV import
  tradovate.js         Tradovate REST client
  charts.js            SVG charts with tooltips
  views.js, app.js     UI
test/engine.test.js    node:test suite
```
