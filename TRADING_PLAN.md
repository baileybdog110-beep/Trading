# Session Plan — 2026-09-09 (Wed)

## Mandate
Account ••9605 ("Agentic"), Level 3, limited margin. Funded with $25.
User directive (REVISED 09:25): compound via laddered round trips, not one
4x ticket. Target $100. Overall odds ~6%, but far better path/control.

## Hard constraints (verified from live data 09:20 ET)
- PDT: limited margin, <$25k equity => **3 day trades / rolling 5 business days.**
  One entry + one exit = 1 day trade. Budget: 3.
- Max affordable premium: **$0.24** (1 contract, $25 buying power).
- Crypto ruled out: RH spread ~1.9% round trip (BTC 78,805/80,306). Needs 300% day. No.
- **Margin gives NOTHING here.** Broker reports buying_power == unleveraged_buying_power
  ($0.10 == $0.10). "Limited margin" on RH = instant access to unsettled proceeds,
  NOT leverage. And under Reg T, long options <9mo are 100% cash — not marginable
  in ANY account at ANY tier. Option buying power on $25 cash is $25. Period.
  What limited margin DOES buy us: sale proceeds are instantly redeployable
  (no T+1 settlement lock). That is what makes the ladder below possible at all.
- Day trades used in last 5 business days: **0** (verified, get_option_orders empty).
- Credit spreads ruled out: $1-wide needs ~$100 collateral. Not available at $25.

## Premarket tone (09:20 ET)
| Sym  | Last    | vs close |
|------|---------|----------|
| SPY  | 763.72  | -0.29%   |
| QQQ  | 715.43  | -0.41%   |
| IWM  | 293.29  | -0.47%   |
| TSLA | 364.60  | -0.97%   |
| SOXL | 120.14  | **-2.54%** |

Semis leading down hard. Risk-off tilt, but gap-downs frequently get bought.
=> NO directional pre-commitment. Read the tape first.

## The ladder (supersedes single-shot plan)
$25 x 1.2^n = $100 needs n~8 winners. PDT allows 3. So 3 x (+20%) = $43.20, NOT $100.
Required per-trade gain for 4x in 3 round trips: 4^(1/3) = **+58.7%**.

| Leg | Stake | Target        | Purpose                                      |
|-----|-------|---------------|----------------------------------------------|
| 1   | $25   | +60% -> ~$40  | Build buffer. Take the money. No greed.      |
| 2   | ~$40  | +60% -> ~$63  | Compound. Higher premium budget = better contracts. |
| 3   | ~$63  | swing -> $100+| HOME RUN leg. $38 is house money — let it run. |

Rule: if legs 1+2 both win, ASK USER before firing leg 3 on a mediocre setup.
Banking +150% beats burning the last day trade on a weak signal.

## Entry rules
1. **Do NOT enter at 9:30.** Let the opening range (9:30-9:45) form.
2. Trigger: clean break of the 15-min opening range with momentum/volume,
   confirmed by QQQ+SPY agreeing. Fade nothing. Trend only.
3. Instrument: SPY 0DTE, premium <= $0.24, ~5-10 delta, OI > 5k for liquidity.
4. Order: **LIMIT at mid or mid+0.01. Never market** — a market order on a
   $0.20 contract with a 1-cent-wide book still slips badly when it widens.
5. Size: 1 contract. That is the whole account.

## Exit rules
- **Legs 1-2: take +55-60% and get out. Do not hold for a 4x on these.**
- **Leg 3 only: hold for the big move.**
- **Stop is THESIS-based, not price-based.** Rationale: a -50% stop leaves $12,
  which cannot fund another meaningful shot. A tight stop just converts a
  lottery ticket into a guaranteed small loss. So:
  - EXIT if SPY reverses back through the trigger level (thesis dead).
  - EXIT by 13:00 ET if flat/going nowhere (theta cliff) — salvage remainder.
  - HOLD through noise if the trend structure is intact.
- Never hold a 0DTE into the 15:45 ET sellout window.

## Status log
- 09:20 ET — Account $0.10. Awaiting $25 transfer.
- 09:25 ET — Still $0.10. Verified 0 day trades used; full budget of 3 intact.
             Plan revised from single-shot to 3-leg compounding ladder after
             user (correctly) pointed out proceeds can be recycled.
- 09:28 ET — **FUNDED: $25.10.** buying_power == unleveraged_buying_power again,
             confirming no leverage. Max premium = $0.25/contract.
             Cached near-money 0DTE instrument IDs in spy_0dte_ids.txt for
             sub-second order placement (no chain re-pull mid-move).
- 09:29 ET — SPY 764.24 (-0.22%), QQQ 716.10 (-0.31%), IWM 293.53 (-0.39%).
             Gap-down being nibbled premarket (763.72 -> 764.24 over 9 min).
             Mild bid into the open. NOT pre-committing direction.
             Standing down until the 09:30-09:45 opening range completes.
