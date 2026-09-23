import test from 'node:test';
import assert from 'node:assert/strict';
import { apexRules, evaluate } from '../public/js/rules.js';
import { withDays, stats, breakdowns, behaviors, simulate } from '../public/js/analytics.js';
import { importTrades, parseMoney } from '../public/js/csv.js';
import { coach } from '../public/js/coach.js';
import { sampleTrades } from '../public/js/sample.js';
import { tradingDay } from '../public/js/time.js';

const T = (h, pnl, day = '2026-09-14') => {
  const t = Date.parse(`${day}T${String(h).padStart(2, '0')}:00:00-04:00`);
  return { id: `${day}-${h}-${pnl}`, symbol: 'MNQZ6', side: 'long', qty: 1, entryTime: t, exitTime: t + 60000, pnl };
};

test('trading day rolls at 6 PM ET and over weekends', () => {
  assert.equal(tradingDay(Date.parse('2026-09-14T17:30:00-04:00')), '2026-09-14');
  assert.equal(tradingDay(Date.parse('2026-09-14T18:30:00-04:00')), '2026-09-15');
  assert.equal(tradingDay(Date.parse('2026-09-13T19:00:00-04:00')), '2026-09-14'); // Sunday evening -> Monday
});

test('money parsing handles Tradovate formats', () => {
  assert.equal(parseMoney('$(25.50)'), -25.5);
  assert.equal(parseMoney('$1,250.00'), 1250);
  assert.equal(parseMoney('-$40'), -40);
});

test('trailing threshold follows peak and locks at start + 100', () => {
  const acct = { rules: apexRules(50000, 'eval') };
  let p = evaluate(acct, withDays([T(10, 1000)]));
  assert.equal(p.threshold, 51000 - 2500);
  p = evaluate(acct, withDays([T(10, 3000), T(11, -500)]));
  assert.equal(p.threshold, 50100);
  assert.equal(p.thresholdLocked, true);
  assert.equal(p.status, 'active');
  assert.equal(evaluate(acct, withDays([T(10, 3100)])).status, 'passed');
});

test('eval fails when threshold is hit', () => {
  const p = evaluate({ rules: apexRules(50000, 'eval') }, withDays([T(10, 500), T(11, -3100)]));
  assert.equal(p.status, 'failed');
});

test('PA consistency and payout checks', () => {
  const rules = apexRules(50000, 'pa');
  const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'];
  let trades = days.map((d, i) => T(10, i === 0 ? 1500 : 300, d));
  let p = evaluate({ rules }, withDays(trades));
  // cycle profit 1500 + 7*300 = 3600, best day 1500 = 41.7% -> fails consistency
  assert.equal(p.payoutChecks.find((c) => c.id === 'consistency').ok, false);
  assert.equal(Math.round(p.profitNeededForConsistency), 1400);
  trades = days.map((d) => T(10, 450, d));
  p = evaluate({ rules }, withDays(trades));
  assert.equal(p.status, 'payout-ready');
  assert.equal(p.withdrawable, Math.min(2000, 53600 - 52600));
});

test('Tradovate performance CSV import', () => {
  const csv = `symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration
MNQZ6,-2,0,0.25,1,2,2,21000.25,21010.25,$40.00,09/14/2026 09:31:05,09/14/2026 09:35:10,4min 5sec
MNQZ6,-2,0,0.25,3,4,1,21020.00,21010.00,$(20.00),09/14/2026 09:50:00,09/14/2026 09:45:00,5min`;
  const { format, trades } = importTrades(csv);
  assert.equal(format, 'tradovate-performance');
  assert.equal(trades.length, 2);
  assert.equal(trades[1].side, 'short');
  assert.equal(trades[1].pnl, -20);
});

test('full pipeline on sample data produces tips', () => {
  const trades = withDays(sampleTrades({ seed: 11, days: 12, endDate: new Date('2026-09-20') }));
  for (const phase of ['eval', 'pa']) {
    const account = { rules: apexRules(50000, phase) };
    const p = evaluate(account, trades);
    const s = stats(trades);
    const bd = breakdowns(trades);
    const bh = behaviors(trades, p.days);
    const sim = simulate({ dailyPnls: p.days.map((d) => d.pnl), balance: p.balance, peak: p.peak, rules: account.rules, goalBalance: p.balance + 1000 });
    assert.ok(sim.passPct + sim.bustPct + sim.undecidedPct > 0.999);
    const tips = coach({ account, progress: p, s, ds: { worstDay: p.days[0], days: p.days.length, avgGreenDay: 200 }, bd, bh, plan: { dailyStop: 500, dailyTarget: 300, days: 5 }, sim });
    assert.ok(tips.length > 0);
  }
});

test('safety net reflects current balance, not past peak', () => {
  const rules = apexRules(50000, 'pa');
  const p = evaluate({ rules }, withDays([T(10, 2700, '2026-09-01'), T(10, -800, '2026-09-02')]));
  assert.equal(p.thresholdLocked, true);
  assert.equal(p.safetyNetReached, false);
  assert.equal(p.contractLimit, rules.maxContracts);
});
