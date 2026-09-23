// Prop-firm rule presets and the progress engine.
//
// Apex rules change from time to time. Every number here is only a default and
// can be edited per account in the UI. Always check the values against Apex's
// current help center before you rely on them.

import { tradingDay } from './time.js';

export const APEX_SIZES = {
  25000: { profitTarget: 1500, maxDrawdown: 1500, maxContracts: 4, payoutCap: 1500 },
  50000: { profitTarget: 3000, maxDrawdown: 2500, maxContracts: 10, payoutCap: 2000 },
  75000: { profitTarget: 4250, maxDrawdown: 2750, maxContracts: 12, payoutCap: 2250 },
  100000: { profitTarget: 6000, maxDrawdown: 3000, maxContracts: 14, payoutCap: 2500 },
  150000: { profitTarget: 9000, maxDrawdown: 5000, maxContracts: 17, payoutCap: 2750 },
  250000: { profitTarget: 15000, maxDrawdown: 6500, maxContracts: 27, payoutCap: 3000 },
  300000: { profitTarget: 20000, maxDrawdown: 7500, maxContracts: 35, payoutCap: 3500 },
};

/** Build a full rule set for an Apex account of a given size and phase. */
export function apexRules(size, phase) {
  const s = APEX_SIZES[size] || APEX_SIZES[50000];
  const base = {
    firm: 'apex',
    phase,
    size: +size,
    startBalance: +size,
    maxDrawdown: s.maxDrawdown,
    drawdownMode: 'trailing-intraday', // 'trailing-intraday' | 'trailing-eod' | 'static'
    // Apex stops trailing once the threshold reaches start balance + $100.
    trailStopOffset: 100,
    maxContracts: s.maxContracts,
    dailyLossLimit: 0, // 0 = none
  };
  if (phase === 'eval') {
    return { ...base, profitTarget: s.profitTarget, minTradingDays: 1 };
  }
  return {
    ...base,
    // Payout rules (PA / funded)
    minDaysPerPayout: 8,
    qualifyingDayProfit: 50,
    qualifyingDaysRequired: 5,
    consistencyPct: 30, // best day must be under 30% of profit for the cycle
    minPayout: 500,
    payoutCap: s.payoutCap,
    cappedPayouts: 5, // payouts 1-5 are capped
    safetyNetPayouts: 3, // payouts 1-3 must leave the balance above the safety net
    halfContractsUntilSafetyNet: true,
    negativePnlPct: 30, // max open loss as % of start-of-day profit (or drawdown if larger)
    payoutsTaken: 0,
    lastPayoutDate: '',
  };
}

export function customRules(phase, size = 50000) {
  return { ...apexRules(size, phase), firm: 'custom' };
}

/** Guess phase from a Tradovate account name. Apex PA accounts start with "PA". */
export function guessPhase(name = '') {
  return /^PA/i.test(name.trim()) ? 'pa' : 'eval';
}

/** Guess the account size from a balance (the nearest preset). */
export function guessSize(balance) {
  const sizes = Object.keys(APEX_SIZES).map(Number);
  if (!Number.isFinite(balance)) return 50000;
  return sizes.reduce((best, s) => (Math.abs(s - balance) < Math.abs(best - balance) ? s : best), sizes[0]);
}

/**
 * Replay the trades against the rules. Returns the equity path, daily summary,
 * drawdown threshold and phase-specific progress.
 *
 * account.currentBalance (optional) lets a live balance, or one the user types in,
 * anchor the path, so that fees, payouts and older trades are accounted for.
 */
export function evaluate(account, trades) {
  const r = account.rules;
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const totalPnl = sorted.reduce((s, t) => s + t.pnl, 0);
  const hasLive = Number.isFinite(account.currentBalance);
  const base = hasLive ? account.currentBalance - totalPnl : r.startBalance;

  const lockLevel = r.startBalance + (r.trailStopOffset ?? 0);
  const trailLimit = (peak) => {
    if (r.drawdownMode === 'static') return r.startBalance - r.maxDrawdown;
    const t = peak - r.maxDrawdown;
    return r.trailStopOffset == null ? t : Math.min(t, lockLevel);
  };

  let balance = base;
  let peak = Math.max(base, r.startBalance);
  let threshold = trailLimit(peak);
  let busted = null;
  const path = [{ time: sorted[0]?.entryTime ?? Date.now(), balance, threshold }];
  const dayMap = new Map();

  for (const t of sorted) {
    const day = t.day || tradingDay(t.exitTime);
    if (!dayMap.has(day)) {
      // End-of-day trailing updates the threshold only when a new session starts.
      if (r.drawdownMode === 'trailing-eod') {
        peak = Math.max(peak, balance);
        threshold = Math.max(threshold, trailLimit(peak));
      }
      dayMap.set(day, { date: day, pnl: 0, trades: 0, wins: 0, startBalance: balance, high: balance, low: balance, peakPnl: 0, lowPnl: 0 });
    }
    const d = dayMap.get(day);
    balance += t.pnl;
    d.pnl += t.pnl;
    d.trades += 1;
    if (t.pnl > 0) d.wins += 1;
    d.high = Math.max(d.high, balance);
    d.low = Math.min(d.low, balance);
    d.peakPnl = Math.max(d.peakPnl, d.pnl);
    d.lowPnl = Math.min(d.lowPnl, d.pnl);
    if (r.drawdownMode === 'trailing-intraday') {
      peak = Math.max(peak, balance);
      threshold = Math.max(threshold, trailLimit(peak));
    }
    if (!busted && balance <= threshold) busted = { time: t.exitTime, day, balance, threshold };
    d.endBalance = balance;
    path.push({ time: t.exitTime, balance, threshold, tradeId: t.id });
  }
  if (r.drawdownMode === 'trailing-eod' && sorted.length) {
    peak = Math.max(peak, balance);
  }

  // A threshold the user copied from the Apex dashboard is always more accurate:
  // Apex trails on unrealized (open-trade) highs, which closed trades can't show.
  const thresholdComputed = threshold;
  if (Number.isFinite(account.thresholdOverride)) threshold = account.thresholdOverride;

  const days = [...dayMap.values()];
  const out = {
    balance,
    base,
    startBalance: r.startBalance,
    profit: balance - r.startBalance,
    peak,
    threshold,
    thresholdComputed,
    thresholdLocked: r.drawdownMode !== 'static' && r.trailStopOffset != null && threshold >= lockLevel,
    ddRemaining: balance - threshold,
    ddUsedPct: clamp01(1 - (balance - threshold) / r.maxDrawdown),
    busted,
    path,
    days,
    tradingDays: days.length,
    historyIncomplete: hasLive && Math.abs(base - r.startBalance) > 1,
    violations: contractViolations(r, sorted),
  };

  if (r.dailyLossLimit > 0) {
    out.dailyLossBreaches = days.filter((d) => d.lowPnl <= -r.dailyLossLimit).map((d) => d.date);
  }

  return r.phase === 'eval' ? { ...out, ...evalProgress(r, out) } : { ...out, ...paProgress(account, out, sorted) };
}

function evalProgress(r, s) {
  const targetBalance = r.startBalance + r.profitTarget;
  const remaining = Math.max(0, targetBalance - s.balance);
  const daysShort = Math.max(0, (r.minTradingDays || 0) - s.tradingDays);
  const passed = !s.busted && remaining === 0 && daysShort === 0;
  return {
    targetBalance,
    profitRemaining: remaining,
    targetPct: clamp01(s.profit / r.profitTarget),
    daysShort,
    status: s.busted ? 'failed' : passed ? 'passed' : 'active',
  };
}

function paProgress(account, s, trades) {
  const r = account.rules;
  const safetyNet = r.startBalance + r.maxDrawdown + (r.trailStopOffset ?? 0);
  const cycleDays = s.days.filter((d) => !r.lastPayoutDate || d.date > r.lastPayoutDate);
  const cycleProfit = cycleDays.reduce((a, d) => a + d.pnl, 0);
  const bestDay = cycleDays.reduce((m, d) => Math.max(m, d.pnl), 0);
  const qualifying = cycleDays.filter((d) => d.pnl >= r.qualifyingDayProfit).length;
  const pct = r.consistencyPct / 100;
  const consistencyOk = cycleProfit > 0 && bestDay <= pct * cycleProfit;
  const profitNeededForConsistency = pct > 0 ? Math.max(0, bestDay / pct - cycleProfit) : 0;

  const payoutNo = (r.payoutsTaken || 0) + 1;
  const floor = payoutNo <= r.safetyNetPayouts ? safetyNet : s.threshold;
  const cap = payoutNo <= r.cappedPayouts ? r.payoutCap : Infinity;
  const withdrawable = Math.max(0, Math.min(cap, s.balance - floor));

  const checks = [
    {
      id: 'days',
      label: `${r.minDaysPerPayout} trading days since last payout`,
      ok: cycleDays.length >= r.minDaysPerPayout,
      have: cycleDays.length,
      need: r.minDaysPerPayout,
      gap: `${Math.max(0, r.minDaysPerPayout - cycleDays.length)} more day(s)`,
    },
    {
      id: 'qualifying',
      label: `${r.qualifyingDaysRequired} days with ≥ $${r.qualifyingDayProfit} profit`,
      ok: qualifying >= r.qualifyingDaysRequired,
      have: qualifying,
      need: r.qualifyingDaysRequired,
      gap: `${Math.max(0, r.qualifyingDaysRequired - qualifying)} more green day(s) of $${r.qualifyingDayProfit}+`,
    },
    {
      id: 'consistency',
      label: `Best day < ${r.consistencyPct}% of cycle profit`,
      ok: consistencyOk,
      have: cycleProfit > 0 ? bestDay / cycleProfit : null,
      need: pct,
      gap: cycleProfit <= 0 ? 'cycle profit must be positive' : `$${Math.ceil(profitNeededForConsistency)} more profit without beating your best day ($${Math.round(bestDay)})`,
    },
    {
      id: 'balance',
      label: payoutNo <= r.safetyNetPayouts
        ? `Balance ≥ safety net $${fmt(safetyNet)} + min payout $${r.minPayout}`
        : `Balance ≥ threshold + min payout $${r.minPayout}`,
      ok: s.balance - floor >= r.minPayout,
      have: s.balance,
      need: floor + r.minPayout,
      gap: `$${Math.ceil(Math.max(0, floor + r.minPayout - s.balance))} more balance`,
    },
  ];

  const safetyNetReached = s.balance >= safetyNet;
  // Full size unlocks once the threshold stops trailing (the peak cleared the safety net).
  const contractLimit = r.halfContractsUntilSafetyNet && !safetyNetReached && !s.thresholdLocked ? Math.floor(r.maxContracts / 2) : r.maxContracts;
  const eligible = !s.busted && checks.every((c) => c.ok);

  return {
    safetyNet,
    safetyNetReached,
    safetyNetRemaining: Math.max(0, safetyNet - s.balance),
    contractLimit,
    cycleDays,
    cycleProfit,
    bestDay,
    qualifyingDays: qualifying,
    consistencyRatio: cycleProfit > 0 ? bestDay / cycleProfit : null,
    profitNeededForConsistency,
    payoutNo,
    payoutCap: cap,
    withdrawable,
    payoutChecks: checks,
    negativePnlBreaches: negativePnlBreaches(r, s.days, trades),
    status: s.busted ? 'failed' : eligible ? 'payout-ready' : 'active',
  };
}

// Apex's 30% negative P&L rule compares open losses with the profit at the start of
// the day. We only see closed trades, so realized loss is a stand-in for open loss.
function negativePnlBreaches(r, days, trades) {
  if (!r.negativePnlPct) return [];
  const dayStart = new Map(days.map((d) => [d.date, d.startBalance]));
  const out = [];
  for (const t of trades) {
    const start = dayStart.get(t.day || tradingDay(t.exitTime));
    const profitBal = Math.max(0, start - r.startBalance);
    const allowed = (r.negativePnlPct / 100) * Math.max(profitBal, r.maxDrawdown);
    if (t.pnl < 0 && -t.pnl > allowed) out.push({ trade: t, allowed });
  }
  return out;
}

function contractViolations(r, trades) {
  const out = [];
  for (const t of trades) if (t.qty > r.maxContracts) out.push({ trade: t, limit: r.maxContracts });
  return out;
}

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const fmt = (n) => Math.round(n).toLocaleString('en-US');
