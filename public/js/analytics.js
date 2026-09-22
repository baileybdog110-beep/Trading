// Trade statistics, breakdowns, behavior detection and pass/payout simulation.

import { toET, tradingDay, weekdayOf } from './time.js';

export function withDays(trades) {
  return trades
    .map((t) => ({ ...t, day: t.day || tradingDay(t.exitTime) }))
    .sort((a, b) => a.exitTime - b.exitTime);
}

export function stats(trades) {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const gross = (arr) => arr.reduce((s, t) => s + t.pnl, 0);
  const grossWin = gross(wins);
  const grossLoss = -gross(losses);
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const hold = (arr) => (arr.length ? arr.reduce((s, t) => s + (t.exitTime - t.entryTime), 0) / arr.length : NaN);

  let streak = 0;
  let maxLossStreak = 0;
  let maxWinStreak = 0;
  let wstreak = 0;
  let peak = 0;
  let cum = 0;
  let maxDD = 0;
  for (const t of trades) {
    if (t.pnl < 0) { streak++; wstreak = 0; } else if (t.pnl > 0) { wstreak++; streak = 0; }
    maxLossStreak = Math.max(maxLossStreak, streak);
    maxWinStreak = Math.max(maxWinStreak, wstreak);
    cum += t.pnl;
    peak = Math.max(peak, cum);
    maxDD = Math.max(maxDD, peak - cum);
  }

  const contracts = trades.reduce((s, t) => s + (t.qty || 1), 0);
  const lossContracts = losses.reduce((s, t) => s + (t.qty || 1), 0);

  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? wins.length / n : 0,
    netPnl: gross(trades),
    grossWin,
    grossLoss,
    avgWin,
    avgLoss,
    payoff: avgLoss ? avgWin / avgLoss : Infinity,
    breakevenWinRate: avgWin + avgLoss ? avgLoss / (avgWin + avgLoss) : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0,
    expectancy: n ? gross(trades) / n : 0,
    largestWin: wins.reduce((m, t) => Math.max(m, t.pnl), 0),
    largestLoss: losses.reduce((m, t) => Math.min(m, t.pnl), 0),
    avgHoldWin: hold(wins),
    avgHoldLoss: hold(losses),
    maxLossStreak,
    maxWinStreak,
    maxDrawdown: maxDD,
    avgQty: n ? contracts / n : 0,
    avgLossPerContract: lossContracts ? grossLoss / lossContracts : 0,
    fees: trades.reduce((s, t) => s + (t.fees || 0), 0),
  };
}

export function dailyStats(days) {
  const green = days.filter((d) => d.pnl > 0);
  const red = days.filter((d) => d.pnl < 0);
  const avg = (arr) => (arr.length ? arr.reduce((s, d) => s + d.pnl, 0) / arr.length : 0);
  const best = days.reduce((m, d) => (!m || d.pnl > m.pnl ? d : m), null);
  const worst = days.reduce((m, d) => (!m || d.pnl < m.pnl ? d : m), null);
  return {
    days: days.length,
    greenDays: green.length,
    redDays: red.length,
    dayWinRate: days.length ? green.length / days.length : 0,
    avgDay: avg(days),
    avgGreenDay: avg(green),
    avgRedDay: avg(red),
    bestDay: best,
    worstDay: worst,
    avgTradesPerDay: days.length ? days.reduce((s, d) => s + d.trades, 0) / days.length : 0,
  };
}

function group(trades, keyFn, order) {
  const m = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (!m.has(k)) m.set(k, { key: k, trades: 0, wins: 0, pnl: 0 });
    const g = m.get(k);
    g.trades++;
    g.pnl += t.pnl;
    if (t.pnl > 0) g.wins++;
  }
  let rows = [...m.values()].map((g) => ({ ...g, winRate: g.wins / g.trades, avg: g.pnl / g.trades }));
  if (order) rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return rows;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export function rootSymbol(sym = '') {
  // ESZ6 / MNQH26 / "NQ 12-26" -> ES / MNQ / NQ
  const s = sym.trim().toUpperCase().split(/\s+/)[0];
  const m = s.match(/^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{1,2})$/);
  return m ? m[1] : s;
}

export function breakdowns(trades) {
  const hourLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;
  const byHourRaw = group(trades, (t) => toET(t.entryTime).hour);
  byHourRaw.sort((a, b) => a.key - b.key);
  const idxInDay = new Map();
  const counts = new Map();
  for (const t of trades) {
    const c = (counts.get(t.day) || 0) + 1;
    counts.set(t.day, c);
    idxInDay.set(t, c);
  }
  const bucketIdx = (i) => (i >= 6 ? '6+' : String(i));
  const holdBucket = (t) => {
    const s = (t.exitTime - t.entryTime) / 1000;
    if (s < 30) return '<30s';
    if (s < 120) return '30s–2m';
    if (s < 600) return '2–10m';
    if (s < 1800) return '10–30m';
    return '30m+';
  };
  return {
    byHour: byHourRaw.map((g) => ({ ...g, label: hourLabel(g.key) + ' ET' })),
    byWeekday: group(trades, (t) => weekdayOf(t.day), WEEKDAYS),
    bySymbol: group(trades, (t) => rootSymbol(t.symbol)).sort((a, b) => b.trades - a.trades),
    bySide: group(trades, (t) => (t.side === 'short' ? 'Short' : 'Long'), ['Long', 'Short']),
    byTradeOfDay: group(trades, (t) => bucketIdx(idxInDay.get(t)), ['1', '2', '3', '4', '5', '6+']),
    byHold: group(trades, holdBucket, ['<30s', '30s–2m', '2–10m', '10–30m', '30m+']),
    bySize: group(trades, (t) => `${t.qty || 1} ct`).sort((a, b) => parseFloat(a.key) - parseFloat(b.key)),
  };
}

/** Patterns that tend to blow up evaluations. */
export function behaviors(trades, days, { revengeWindowMin = 10 } = {}) {
  const afterLoss = [];
  const sizeUpAfterLoss = [];
  for (let i = 1; i < trades.length; i++) {
    const prev = trades[i - 1];
    const t = trades[i];
    if (t.day !== prev.day || prev.pnl >= 0) continue;
    const gapMin = (t.entryTime - prev.exitTime) / 60000;
    if (gapMin <= revengeWindowMin) afterLoss.push(t);
    if ((t.qty || 1) > (prev.qty || 1)) sizeUpAfterLoss.push(t);
  }
  const quick = stats(afterLoss);

  // Days where the realized intraday high was meaningful but most of it was given back.
  const givebacks = days.filter((d) => d.peakPnl >= 150 && d.pnl < d.peakPnl * 0.5);
  const givebackAmount = givebacks.reduce((s, d) => s + (d.peakPnl - d.pnl), 0);

  // Busy red days that closed at (or near) their low: kept trading while losing.
  const tiltDays = days.filter((d) => d.pnl < 0 && d.trades >= 6 && d.pnl <= d.lowPnl * 0.8);

  // Performance by how many trades had already been taken that day.
  const early = [];
  const late = [];
  const counts = new Map();
  for (const t of trades) {
    const c = (counts.get(t.day) || 0) + 1;
    counts.set(t.day, c);
    (c <= 3 ? early : late).push(t);
  }

  return {
    revenge: { count: afterLoss.length, stats: quick, windowMin: revengeWindowMin },
    sizeUpAfterLoss: { count: sizeUpAfterLoss.length, stats: stats(sizeUpAfterLoss) },
    givebacks: { days: givebacks, amount: givebackAmount },
    tiltDays,
    early: stats(early),
    late: stats(late),
  };
}

// Small seeded PRNG so simulations are repeatable between renders.
function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Monte Carlo: resample your own trading days to estimate the odds of reaching
 * `goalBalance` before the trailing threshold is hit.
 */
export function simulate({ dailyPnls, balance, peak, rules, goalBalance, maxDays = 60, runs = 4000, minDays = 0 }) {
  if (dailyPnls.length < 3) return null;
  const rand = rng(1234);
  const lock = rules.startBalance + (rules.trailStopOffset ?? 0);
  const thresholdFor = (p) => {
    if (rules.drawdownMode === 'static') return rules.startBalance - rules.maxDrawdown;
    const t = p - rules.maxDrawdown;
    return rules.trailStopOffset == null ? t : Math.min(t, lock);
  };
  let pass = 0;
  let bust = 0;
  const daysToPass = [];
  for (let r = 0; r < runs; r++) {
    let b = balance;
    let p = peak;
    let th = thresholdFor(p);
    for (let d = 1; d <= maxDays; d++) {
      const pnl = dailyPnls[Math.floor(rand() * dailyPnls.length)];
      b += pnl;
      if (b <= th) { bust++; break; }
      p = Math.max(p, b);
      th = Math.max(th, thresholdFor(p));
      if (b >= goalBalance && d >= minDays) { pass++; daysToPass.push(d); break; }
    }
  }
  daysToPass.sort((a, b) => a - b);
  return {
    passPct: pass / runs,
    bustPct: bust / runs,
    undecidedPct: (runs - pass - bust) / runs,
    medianDays: daysToPass.length ? daysToPass[Math.floor(daysToPass.length / 2)] : null,
    runs,
    maxDays,
  };
}

/** A concrete daily plan: how much to aim for, where to stop, how big to trade. */
export function dailyPlan({ remaining, ddRemaining, daysLeft, maxContracts, avgLossPerContract, riskShare = 0.25 }) {
  const days = Math.max(1, daysLeft);
  const dailyTarget = remaining > 0 ? remaining / days : 0;
  // Never risk more than a quarter of the remaining buffer on a single day.
  const dailyStop = Math.max(0, ddRemaining * riskShare);
  const perTradeRisk = dailyStop / 3;
  let contracts = null;
  if (avgLossPerContract > 0) {
    contracts = Math.max(0, Math.min(maxContracts, Math.floor(perTradeRisk / avgLossPerContract)));
  }
  return { dailyTarget, dailyStop, perTradeRisk, contracts, days };
}
