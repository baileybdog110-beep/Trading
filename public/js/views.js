// HTML builders for each tab. Pure functions of the computed model.

import { fmtDuration } from './time.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n, signed = false) => {
  if (!Number.isFinite(n)) return '—';
  const v = Math.round(n);
  const s = Math.abs(v).toLocaleString('en-US');
  return v < 0 ? `-$${s}` : `${signed && v > 0 ? '+' : ''}$${s}`;
};
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—');
const cls = (n) => (n > 0 ? 'pos-text' : n < 0 ? 'neg-text' : '');

const STATUS = {
  active: { label: 'In progress', icon: '●', cls: 'st-info' },
  passed: { label: 'Passed', icon: '✓', cls: 'st-good' },
  'payout-ready': { label: 'Payout ready', icon: '✓', cls: 'st-good' },
  failed: { label: 'Threshold hit', icon: '✕', cls: 'st-bad' },
};

function tile(label, value, sub = '', valueCls = '') {
  return `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value ${valueCls}">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
}

function bar(label, frac, left, right, tone = 'accent') {
  const w = Math.max(0, Math.min(100, frac * 100));
  return `<div class="pbar">
    <div class="pbar-head"><span>${label}</span><span class="muted">${right}</span></div>
    <div class="pbar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(w)}" aria-label="${esc(label)}"><div class="pbar-fill ${tone}" style="width:${w}%"></div></div>
    <div class="pbar-foot muted small">${left}</div>
  </div>`;
}

function check(ok, label, gap) {
  return `<li class="${ok ? 'ok' : 'no'}"><span class="ck" aria-hidden="true">${ok ? '✓' : '○'}</span><span><b>${label}</b>${ok ? '' : `<br><span class="muted small">Need: ${esc(gap)}</span>`}</span></li>`;
}

export function hero(account, m) {
  const r = account.rules;
  const st = STATUS[m.p.status];
  const phase = r.phase === 'eval' ? 'Evaluation' : 'PA / Funded';
  const src = { tradovate: 'Tradovate API', csv: 'CSV import', demo: 'Demo data' }[account.source] || '';
  return `<section class="hero">
    <div>
      <div class="hero-meta"><span class="badge">${phase}</span><span class="badge">${money(r.size)}</span><span class="muted small">${src}${account.syncedAt ? ` · updated ${new Date(account.syncedAt).toLocaleString()}` : ''}</span></div>
      <h1>${esc(account.name)}</h1>
    </div>
    <div class="status ${st.cls}"><span aria-hidden="true">${st.icon}</span> ${st.label}</div>
  </section>
  ${m.p.historyIncomplete ? `<div class="note">Your trade history doesn't start at the account's starting balance (the gap is ${money(m.p.base - r.startBalance)}). The drawdown threshold is estimated. For an exact value, enter the threshold shown on your Apex dashboard in <b>Settings</b>.</div>` : ''}`;
}

export function progressEval(account, m) {
  const { p, plan, sim } = m;
  const r = account.rules;
  return `
  <div class="tiles">
    ${tile('Balance', money(p.balance), `Started at ${money(r.startBalance)}`)}
    ${tile('Profit', money(p.profit, true), `Target ${money(r.profitTarget)}`, cls(p.profit))}
    ${tile('Left to target', money(p.profitRemaining), p.profitRemaining ? `${pct(1 - p.targetPct)} to go` : 'Target reached')}
    ${tile('Drawdown left', money(p.ddRemaining), `Threshold ${money(p.threshold)}${p.thresholdLocked ? ' (locked)' : ''}`, p.ddRemaining < r.maxDrawdown * 0.35 ? 'neg-text' : '')}
  </div>
  <div class="grid2">
    <section class="card">
      <h3>Progress to pass</h3>
      ${bar('Profit target', p.targetPct, `${money(Math.max(0, p.profit))} of ${money(r.profitTarget)}`, pct(p.targetPct))}
      ${bar('Drawdown used', p.ddUsedPct, `${money(p.ddRemaining)} left before the account fails`, pct(p.ddUsedPct), p.ddUsedPct > 0.65 ? 'bad' : p.ddUsedPct > 0.4 ? 'warn' : 'ok')}
      ${bar('Trading days', r.minTradingDays ? Math.min(1, p.tradingDays / r.minTradingDays) : 1, `${p.tradingDays} traded, ${r.minTradingDays} required`, `${p.tradingDays}/${r.minTradingDays}`)}
      <ul class="checks">
        ${check(p.profitRemaining === 0, `Reach ${money(p.targetBalance)}`, `${money(p.profitRemaining)} more profit`)}
        ${check(p.daysShort === 0, `Trade at least ${r.minTradingDays} day(s)`, `${p.daysShort} more day(s)`)}
        ${check(!p.busted, `Stay above the trailing threshold`, 'the account hit its threshold')}
        ${check(!p.violations.length, `Max ${r.maxContracts} contracts`, `${p.violations.length} trade(s) over the limit`)}
      </ul>
    </section>
    ${planCard(account, m, `to pass`)}
  </div>
  <section class="card">
    <h3>Balance vs trailing threshold</h3>
    <div id="chartEquity" class="chart"></div>
    <p class="muted small">Apex trails the threshold on your highest <i>unrealized</i> balance. Closed trades can't show that, so the real threshold may be a little higher than drawn here.</p>
  </section>`;
}

export function progressPA(account, m) {
  const { p } = m;
  const r = account.rules;
  const snFrac = Math.max(0, Math.min(1, (p.balance - r.startBalance) / (p.safetyNet - r.startBalance)));
  return `
  <div class="tiles">
    ${tile('Balance', money(p.balance), `Profit ${money(p.profit, true)}`, '')}
    ${tile('Withdrawable now', money(p.status === 'payout-ready' ? p.withdrawable : 0), `Payout #${p.payoutNo}${Number.isFinite(p.payoutCap) ? `, cap ${money(p.payoutCap)}` : ''}`, p.status === 'payout-ready' ? 'pos-text' : '')}
    ${tile('Safety net', p.safetyNetReached ? 'Reached' : money(p.safetyNetRemaining) + ' to go', `${money(p.safetyNet)} · max ${p.contractLimit} contracts now`)}
    ${tile('Drawdown left', money(p.ddRemaining), `Threshold ${money(p.threshold)}${p.thresholdLocked ? ' (locked)' : ''}`, p.ddRemaining < r.maxDrawdown * 0.35 ? 'neg-text' : '')}
  </div>
  <div class="grid2">
    <section class="card">
      <h3>Payout checklist</h3>
      <p class="muted small">Payout cycle: ${r.lastPayoutDate ? `days after ${esc(r.lastPayoutDate)}` : 'all days (no payout yet)'} · ${p.cycleDays.length} trading days · ${money(p.cycleProfit, true)}</p>
      <ul class="checks">
        ${p.payoutChecks.map((c) => check(c.ok, c.label, c.gap)).join('')}
        ${check(!p.busted, 'Stay above the trailing threshold', 'the account hit its threshold')}
      </ul>
      ${bar('Safety net', snFrac, `${money(p.balance - r.startBalance)} of ${money(p.safetyNet - r.startBalance)} profit cushion`, pct(snFrac), 'accent')}
      ${bar('Consistency', p.consistencyRatio == null ? 0 : Math.min(1, p.consistencyRatio / (r.consistencyPct / 100)), `Best day ${money(p.bestDay)} is ${pct(p.consistencyRatio)} of cycle profit (must be < ${r.consistencyPct}%)`, pct(p.consistencyRatio), p.payoutChecks.find((c) => c.id === 'consistency').ok ? 'ok' : 'warn')}
    </section>
    ${planCard(account, m, 'to a payout')}
  </div>
  <section class="card">
    <h3>Balance vs trailing threshold</h3>
    <div id="chartEquity" class="chart"></div>
  </section>`;
}

function planCard(account, m, goal) {
  const { plan, sim, s } = m;
  const r = account.rules;
  return `<section class="card plan">
    <h3>Your plan ${goal}</h3>
    <label class="inline">Days I want to take
      <input type="number" min="1" max="60" id="planDays" value="${plan.days}" />
    </label>
    <div class="plan-grid">
      <div><div class="tile-label">Daily goal</div><div class="plan-num">${money(plan.dailyTarget)}</div><div class="muted small">then stop for the day</div></div>
      <div><div class="tile-label">Daily max loss</div><div class="plan-num neg-text">${money(-plan.dailyStop)}</div><div class="muted small">25% of the drawdown you have left</div></div>
      <div><div class="tile-label">Risk per trade</div><div class="plan-num">${money(plan.perTradeRisk)}</div><div class="muted small">3 losses = done for the day</div></div>
      <div><div class="tile-label">Suggested size</div><div class="plan-num">${plan.contracts == null ? '—' : `${plan.contracts} ct`}</div><div class="muted small">${plan.contracts == null ? 'needs losing trades to size from' : `from your avg loss of ${money(s.avgLossPerContract)}/contract`}</div></div>
    </div>
    ${plan.contracts === 0 ? '<p class="note">Your average loss per contract is bigger than the per-trade risk. Switch to micros (MES/MNQ) or tighten your stops.</p>' : ''}
    ${sim ? `<div class="sim">
      <div class="sim-bar" aria-label="Simulated outcomes">
        <span class="sim-pass" style="width:${sim.passPct * 100}%"></span><span class="sim-open" style="width:${sim.undecidedPct * 100}%"></span><span class="sim-bust" style="width:${sim.bustPct * 100}%"></span>
      </div>
      <div class="sim-legend small">
        <span><i class="sw sw-pass"></i>Reach goal ${pct(sim.passPct)}</span>
        <span><i class="sw sw-open"></i>Undecided after ${sim.maxDays}d ${pct(sim.undecidedPct)}</span>
        <span><i class="sw sw-bust"></i>Hit threshold ${pct(sim.bustPct)}</span>
      </div>
      <p class="muted small">Replays your own trading days ${sim.runs.toLocaleString()} times, in random order${sim.medianDays ? `. Median: ${sim.medianDays} more trading days` : ''}.</p>
    </div>` : '<p class="muted small">Trade at least 3 days to see your estimated odds.</p>'}
    <p class="muted small">Max contracts allowed: ${m.p.contractLimit ?? r.maxContracts}.</p>
  </section>`;
}

export function analysis(m) {
  const { s, ds } = m;
  return `
  <div class="tiles tiles6">
    ${tile('Net P&L', money(s.netPnl, true), `${s.trades} trades`, cls(s.netPnl))}
    ${tile('Win rate', pct(s.winRate), `breakeven ${pct(s.breakevenWinRate)}`)}
    ${tile('Profit factor', Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞', `${money(s.grossWin)} / ${money(-s.grossLoss)}`)}
    ${tile('Avg win / loss', `${money(s.avgWin)} / ${money(-s.avgLoss)}`, `payoff ${Number.isFinite(s.payoff) ? s.payoff.toFixed(2) : '∞'} : 1`)}
    ${tile('Expectancy', money(s.expectancy), 'per trade', cls(s.expectancy))}
    ${tile('Green days', `${ds.greenDays}/${ds.days}`, `avg green ${money(ds.avgGreenDay)} · avg red ${money(ds.avgRedDay)}`)}
    ${tile('Best / worst day', `${money(ds.bestDay?.pnl ?? 0)} / ${money(ds.worstDay?.pnl ?? 0)}`, '')}
    ${tile('Largest win / loss', `${money(s.largestWin)} / ${money(s.largestLoss)}`, '')}
    ${tile('Hold time', fmtDuration(s.avgHoldWin), `winners · losers ${fmtDuration(s.avgHoldLoss)}`)}
    ${tile('Streaks', `${s.maxWinStreak}W / ${s.maxLossStreak}L`, 'longest')}
    ${tile('Max drawdown', money(-s.maxDrawdown), 'realized, peak to trough')}
    ${tile('Trades / day', ds.avgTradesPerDay.toFixed(1), `avg size ${s.avgQty.toFixed(1)} ct`)}
  </div>
  <section class="card">
    <h3>Daily P&amp;L</h3>
    <div id="chartDaily" class="chart"></div>
  </section>
  <div class="grid3">
    <section class="card" id="bdHour"></section>
    <section class="card" id="bdTradeNo"></section>
    <section class="card" id="bdSymbol"></section>
    <section class="card" id="bdWeekday"></section>
    <section class="card" id="bdHold"></section>
    <section class="card" id="bdSide"></section>
  </div>`;
}

const SEV = {
  critical: { icon: '!', label: 'Fix now' },
  warning: { icon: '▲', label: 'Improve' },
  info: { icon: 'i', label: 'Note' },
  good: { icon: '✓', label: 'Keep doing' },
};

export function coachView(tips) {
  return `<section class="card">
    <h3>Coach</h3>
    <p class="muted small">Ranked advice based on your trades and your account's rules. Fix the top item first.</p>
    <ol class="tips">
      ${tips.map((t) => `<li class="tip sev-${t.severity}">
        <div class="tip-sev"><span class="sev-icon" aria-hidden="true">${SEV[t.severity].icon}</span>${SEV[t.severity].label}</div>
        <div class="tip-body">
          <h4>${esc(t.title)}</h4>
          <p>${esc(t.detail)}</p>
          ${t.action ? `<p class="tip-action"><b>Do this:</b> ${esc(t.action)}</p>` : ''}
        </div>
      </li>`).join('')}
    </ol>
  </section>`;
}

export function tradesView(trades) {
  const rows = [...trades].reverse().slice(0, 1000);
  return `<section class="card">
    <h3>Trades <span class="muted small">(${trades.length})</span></h3>
    <div class="table-wrap">
      <table class="trades">
        <thead><tr><th>Day</th><th>Time</th><th>Symbol</th><th>Side</th><th class="num">Qty</th><th class="num">Entry</th><th class="num">Exit</th><th class="num">Hold</th><th class="num">P&amp;L</th></tr></thead>
        <tbody>
          ${rows.map((t) => `<tr>
            <td>${t.day}</td>
            <td>${new Date(t.entryTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
            <td>${esc(t.symbol)}</td>
            <td>${t.side === 'short' ? 'Short' : 'Long'}</td>
            <td class="num">${t.qty}</td>
            <td class="num">${t.entryPrice ?? '—'}</td>
            <td class="num">${t.exitPrice ?? '—'}</td>
            <td class="num">${fmtDuration(t.exitTime - t.entryTime)}</td>
            <td class="num ${cls(t.pnl)}">${money(t.pnl, true)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </section>`;
}

const FIELDS = {
  common: [
    ['startBalance', 'Starting balance ($)'],
    ['maxDrawdown', 'Max drawdown ($)'],
    ['trailStopOffset', 'Trailing stops at start + ($)'],
    ['maxContracts', 'Max contracts'],
    ['dailyLossLimit', 'Daily loss limit ($, 0 = none)'],
  ],
  eval: [
    ['profitTarget', 'Profit target ($)'],
    ['minTradingDays', 'Min trading days'],
  ],
  pa: [
    ['payoutsTaken', 'Payouts already taken'],
    ['minDaysPerPayout', 'Trading days per payout'],
    ['qualifyingDaysRequired', 'Qualifying days needed'],
    ['qualifyingDayProfit', 'Qualifying day min profit ($)'],
    ['consistencyPct', 'Consistency rule (%)'],
    ['minPayout', 'Min payout ($)'],
    ['payoutCap', 'Payout cap ($)'],
    ['cappedPayouts', 'Payouts that are capped'],
    ['safetyNetPayouts', 'Payouts that need the safety net'],
    ['negativePnlPct', 'Negative P&L rule (%)'],
  ],
};

export function settingsView(account, sizes) {
  const r = account.rules;
  const num = ([k, label]) => `<label>${label}<input type="number" step="any" name="${k}" value="${r[k] ?? ''}" /></label>`;
  return `<section class="card">
    <h3>Account settings</h3>
    <form id="formSettings" class="settings">
      <div class="row3">
        <label>Name <input name="name" value="${esc(account.name)}" /></label>
        <label>Phase
          <select name="phase"><option value="eval" ${r.phase === 'eval' ? 'selected' : ''}>Evaluation</option><option value="pa" ${r.phase === 'pa' ? 'selected' : ''}>PA (funded)</option></select>
        </label>
        <label>Size (resets the rules to Apex defaults)
          <select name="size">${sizes.map((s) => `<option value="${s}" ${+s === r.size ? 'selected' : ''}>${money(+s)}</option>`).join('')}</select>
        </label>
      </div>
      <h4>Balance &amp; threshold</h4>
      <div class="row3">
        <label>Current balance (optional)<input type="number" step="any" name="currentBalance" value="${account.currentBalance ?? ''}" placeholder="From Tradovate" /></label>
        <label>Liquidation threshold from Apex (optional)<input type="number" step="any" name="thresholdOverride" value="${account.thresholdOverride ?? ''}" placeholder="Most accurate" /></label>
        <label>Drawdown type
          <select name="drawdownMode">
            ${[['trailing-intraday', 'Trailing, intraday (Apex)'], ['trailing-eod', 'Trailing, end of day'], ['static', 'Static']].map(([v, l]) => `<option value="${v}" ${r.drawdownMode === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </div>
      <h4>Rules</h4>
      <div class="row3">
        ${FIELDS.common.map(num).join('')}
        ${FIELDS[r.phase].map(num).join('')}
        ${r.phase === 'pa' ? `<label>Last payout date<input type="date" name="lastPayoutDate" value="${esc(r.lastPayoutDate || '')}" /></label>
        <label class="check-label"><input type="checkbox" name="halfContractsUntilSafetyNet" ${r.halfContractsUntilSafetyNet ? 'checked' : ''} /> Half contracts until safety net</label>` : ''}
      </div>
      <p class="muted small">These defaults follow Apex's published rules as we know them. Firms update their rules, so check them against Apex's help center and edit anything that has changed.</p>
      <div class="dlg-actions">
        <button type="button" class="btn danger ghost" id="btnDelete">Delete account</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>
  </section>`;
}

export function emptyState() {
  return `<section class="empty">
    <h1>Pass your eval. Get your payout.</h1>
    <p class="lead">PropPath connects to your Tradovate or Apex account, shows exactly what you still need to pass or get paid, and coaches you on the habits that cost you money.</p>
    <div class="grid3">
      <button class="card choice" data-action="connect" type="button"><span class="choice-icon" aria-hidden="true">⇄</span><b>Connect Tradovate</b><span class="muted small">Pull every account and trade with the Tradovate API</span></button>
      <button class="card choice" data-action="import" type="button"><span class="choice-icon" aria-hidden="true">⇪</span><b>Import CSV</b><span class="muted small">Upload Tradovate's Performance report. Works for every Apex account</span></button>
      <button class="card choice" data-action="demo" type="button"><span class="choice-icon" aria-hidden="true">▶</span><b>Try the demo</b><span class="muted small">Explore the app with sample evaluation and PA accounts</span></button>
    </div>
  </section>`;
}
