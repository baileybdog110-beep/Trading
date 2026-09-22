// Rule-based coach: turns the numbers into ranked, specific advice.

import { fmtDuration } from './time.js';

const $ = (n) => {
  const v = Math.round(n);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
};
const pct = (x) => `${Math.round(x * 100)}%`;

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2, good: 3 };

/**
 * @param ctx {account, progress, s (stats), ds (dailyStats), bd (breakdowns), bh (behaviors), plan, sim}
 * @returns [{severity, title, detail, action}]
 */
export function coach(ctx) {
  const { account, progress: p, s, ds, bd, bh, plan, sim } = ctx;
  const r = account.rules;
  const tips = [];
  const add = (severity, title, detail, action) => tips.push({ severity, title, detail, action });

  if (!s.trades) {
    add('info', 'No trades yet', 'Import trades or connect Tradovate to get your analysis.', 'Import a Tradovate Performance CSV, or connect with the API.');
    return tips;
  }

  // ---- Account survival -------------------------------------------------
  if (p.busted) {
    add('critical', 'Drawdown threshold was hit',
      `Balance reached ${$(p.busted.balance)} against a threshold of ${$(p.busted.threshold)} on ${p.busted.day}.`,
      'Review the trades from that day in the Trades tab. On the next account, set a hard daily stop well inside your drawdown.');
  }

  const bufferShare = p.ddRemaining / r.maxDrawdown;
  if (!p.busted && bufferShare < 0.35) {
    add('critical', `Only ${$(p.ddRemaining)} of drawdown left`,
      `You have ${pct(bufferShare)} of your ${$(r.maxDrawdown)} buffer. One bad day like your worst (${$(ds.worstDay?.pnl ?? 0)}) ${ds.worstDay && -ds.worstDay.pnl >= p.ddRemaining ? 'would end the account' : 'would leave very little room'}.`,
      `Trade minimum size (1 micro, if you can) until you rebuild the buffer. Stop for the day at ${$(plan.dailyStop)}.`);
  }

  if (ds.worstDay && ds.worstDay.pnl < 0 && -ds.worstDay.pnl >= r.maxDrawdown * 0.5) {
    add('critical', 'Your worst day was half your drawdown or more',
      `${ds.worstDay.date}: ${$(ds.worstDay.pnl)}, which is ${pct(-ds.worstDay.pnl / r.maxDrawdown)} of the ${$(r.maxDrawdown)} max drawdown. Two days like that fail the account.`,
      `Set a hard daily loss limit of about ${$(r.maxDrawdown * 0.2)}–${$(r.maxDrawdown * 0.25)} (20–25% of drawdown) and walk away when you hit it.`);
  }

  // ---- Edge ---------------------------------------------------------------
  if (s.trades >= 10) {
    if (s.expectancy < 0) {
      const needWR = s.breakevenWinRate;
      add('critical', 'Negative expectancy',
        `You lose ${$(-s.expectancy)} per trade on average. Win rate ${pct(s.winRate)} against a breakeven of ${pct(needWR)} (your average win is ${$(s.avgWin)} and your average loss is ${$(-s.avgLoss)}).`,
        s.payoff < 1
          ? `Your losers are bigger than your winners. Put a fixed stop on every trade so the average loss is under ${$(s.avgWin)}, or aim for targets of at least ${$(s.avgLoss * 1.5)}.`
          : 'Your reward-to-risk is fine but the win rate is low. Take fewer, higher-quality setups: cut the hours and instruments that lose money (see below).');
    } else {
      add('good', 'Positive expectancy',
        `${$(s.expectancy)} per trade, profit factor ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}, win rate ${pct(s.winRate)}.`,
        'Your edge is there. The job now is to protect it: consistent size, the same setups, no forcing trades.');
    }

    if (s.avgLoss > s.avgWin * 1.3 && s.winRate < 0.7) {
      add('warning', 'Losers are much bigger than winners',
        `Average loss ${$(-s.avgLoss)} vs average win ${$(s.avgWin)} (${s.payoff.toFixed(2)} : 1).`,
        'Decide your stop before you enter and don’t move it. Aim for at least 1 : 1.5 reward-to-risk.');
    }

    if (Number.isFinite(s.avgHoldLoss) && Number.isFinite(s.avgHoldWin) && s.avgHoldLoss > s.avgHoldWin * 1.5 && s.losses >= 5) {
      add('warning', 'You hold losers longer than winners',
        `Losing trades last ${fmtDuration(s.avgHoldLoss)} on average; winners last ${fmtDuration(s.avgHoldWin)}. That usually means hoping a loser comes back and grabbing small wins too early.`,
        'Use a bracket order (stop + target) on entry so the exit decision is made before emotions kick in.');
    }
  }

  // ---- Behavior -------------------------------------------------------------
  const rv = bh.revenge;
  if (rv.count >= 3 && rv.stats.netPnl < 0) {
    add('warning', 'Revenge trading after losses',
      `${rv.count} trades were entered within ${rv.windowMin} min of a loss. Together they made ${$(rv.stats.netPnl)} with a ${pct(rv.stats.winRate)} win rate.`,
      `After any loss, wait ${rv.windowMin}+ minutes before you enter again. After 2 losses in a row, stop for the session.`);
  }

  if (bh.sizeUpAfterLoss.count >= 2 && bh.sizeUpAfterLoss.stats.netPnl < 0) {
    add('critical', 'Adding size after a loss',
      `${bh.sizeUpAfterLoss.count} times you traded more contracts right after a loss. Those trades made ${$(bh.sizeUpAfterLoss.stats.netPnl)}.`,
      'Keep the same size all day. Only size up at the start of a day, and only after a green week.');
  }

  if (bh.late.trades >= 8 && bh.late.expectancy < 0 && bh.early.expectancy > bh.late.expectancy) {
    add('warning', 'Your later trades give it back',
      `Your first 3 trades each day average ${$(bh.early.expectancy)} per trade. Trades 4 and later average ${$(bh.late.expectancy)} (${$(bh.late.netPnl)} total).`,
      'Cap yourself at 3 trades a day. If those are done, you are done.');
  }

  if (bh.givebacks.days.length >= 2) {
    add('warning', 'Giving back profits',
      `On ${bh.givebacks.days.length} days you were up at least $150 and gave back more than half. That cost ${$(bh.givebacks.amount)} in total.`,
      'Use a profit lock: once you’re up your daily goal, stop, or stop if you give back 30% of the day’s peak.');
  }

  if (bh.tiltDays.length >= 2) {
    add('warning', 'Trading through red days',
      `${bh.tiltDays.length} days had 6+ trades and closed near the day’s low.`,
      `Set a daily stop of ${$(plan.dailyStop)} and a max of 3 losing trades per day.`);
  }

  if (s.maxLossStreak >= 5) {
    add('info', `Longest losing streak: ${s.maxLossStreak} trades`,
      `At your average loss that is about ${$(-s.avgLoss * s.maxLossStreak)}. Expect streaks like this to happen again.`,
      `Size so that ${s.maxLossStreak} losses in a row cost less than 25% of your drawdown.`);
  }

  // ---- When / what to trade -------------------------------------------------
  const worstHour = bd.byHour.filter((h) => h.trades >= 5 && h.pnl < 0).sort((a, b) => a.pnl - b.pnl)[0];
  const bestHour = bd.byHour.filter((h) => h.trades >= 5 && h.pnl > 0).sort((a, b) => b.pnl - a.pnl)[0];
  if (worstHour) {
    add('warning', `Losing hour: ${worstHour.label}`,
      `${worstHour.trades} trades opened in that hour made ${$(worstHour.pnl)} (${pct(worstHour.winRate)} win rate).${bestHour ? ` Your best hour is ${bestHour.label}: ${$(bestHour.pnl)}.` : ''}`,
      `Don’t trade the ${worstHour.label} hour for the next 2 weeks and see if your results improve.`);
  } else if (bestHour) {
    add('good', `Best hour: ${bestHour.label}`, `${bestHour.trades} trades, ${$(bestHour.pnl)}, ${pct(bestHour.winRate)} win rate.`, 'Focus your session around this window.');
  }

  const badSym = bd.bySymbol.filter((g) => g.trades >= 5 && g.pnl < 0).sort((a, b) => a.pnl - b.pnl)[0];
  const goodSym = bd.bySymbol.filter((g) => g.pnl > 0).sort((a, b) => b.pnl - a.pnl)[0];
  if (badSym && bd.bySymbol.length > 1) {
    add('warning', `${badSym.key} is costing you money`,
      `${badSym.trades} trades, ${$(badSym.pnl)} total.${goodSym ? ` ${goodSym.key} made ${$(goodSym.pnl)}.` : ''}`,
      goodSym ? `Stick to ${goodSym.key} until the account is passed or paid.` : `Stop trading ${badSym.key} for now.`);
  }

  const badDay = bd.byWeekday.filter((g) => g.trades >= 5 && g.pnl < 0).sort((a, b) => a.pnl - b.pnl)[0];
  if (badDay && ds.days >= 8) {
    add('info', `${badDay.key} is your weakest day`, `${badDay.trades} trades, ${$(badDay.pnl)}.`, `Trade smaller on ${badDay.key} or skip it.`);
  }

  const [longs, shorts] = [bd.bySide.find((g) => g.key === 'Long'), bd.bySide.find((g) => g.key === 'Short')];
  if (longs && shorts && longs.trades >= 5 && shorts.trades >= 5 && Math.sign(longs.pnl) !== Math.sign(shorts.pnl)) {
    const [good, bad] = longs.pnl > shorts.pnl ? [longs, shorts] : [shorts, longs];
    add('info', `You do better going ${good.key.toLowerCase()}`,
      `${good.key}s: ${$(good.pnl)} over ${good.trades} trades. ${bad.key}s: ${$(bad.pnl)} over ${bad.trades} trades.`,
      `Only take ${bad.key.toLowerCase()}s when the trend clearly agrees.`);
  }

  const scalps = bd.byHold.find((g) => g.key === '<30s');
  if (scalps && scalps.trades >= 8 && scalps.pnl < 0) {
    add('info', 'Very short trades lose money',
      `${scalps.trades} trades lasted under 30 seconds and made ${$(scalps.pnl)}. That’s often impulse entries or getting stopped out by noise.`,
      'Wait for a candle close in your direction before you enter, and give the stop room beyond normal noise.');
  }

  // ---- Rules --------------------------------------------------------------
  if (p.violations.length) {
    add('critical', 'Contract limit exceeded',
      `${p.violations.length} trade(s) used more than the ${r.maxContracts}-contract max.`,
      'Set the max position size in your Tradovate risk settings so the platform blocks it.');
  }
  if (p.dailyLossBreaches?.length) {
    add('critical', 'Daily loss limit breached', `On ${p.dailyLossBreaches.join(', ')}.`, `Use Tradovate’s daily loss auto-liquidation at ${$(r.dailyLossLimit)}.`);
  }

  // ---- Phase-specific -------------------------------------------------------
  if (r.phase === 'eval') evalTips(add, ctx);
  else paTips(add, ctx);

  tips.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return tips;
}

function evalTips(add, { account, progress: p, ds, plan, sim, s }) {
  const r = account.rules;
  if (p.status === 'passed') {
    add('good', 'Evaluation passed 🎉', `You hit the ${$(r.profitTarget)} target.`, 'Stop trading this account. Extra trades only add risk. Watch for the PA activation email.');
    return;
  }
  if (p.status === 'failed') return;

  if (p.daysShort > 0) {
    add('info', `${p.daysShort} more trading day(s) required`, `The rules need at least ${r.minTradingDays} trading days.`, 'If you’re already at the target, trade 1 micro for a tiny gain to log the day, then stop.');
  }

  if (ds.days >= 3 && ds.avgGreenDay > 0 && plan.dailyTarget > ds.avgGreenDay * 1.5) {
    add('warning', 'Your plan needs bigger days than you usually have',
      `To finish in ${plan.days} days you need ${$(plan.dailyTarget)} a day. Your average green day is ${$(ds.avgGreenDay)}.`,
      'Give yourself more days rather than more size. Apex evaluations don’t reward rushing; most accounts are lost chasing the target.');
  }

  if (sim) {
    const sev = sim.passPct >= 0.6 ? 'good' : sim.passPct >= 0.35 ? 'info' : 'warning';
    add(sev, `Estimated pass chance: ${pct(sim.passPct)}`,
      `From ${sim.runs.toLocaleString()} simulations that replay your own trading days: ${pct(sim.passPct)} reach the target, ${pct(sim.bustPct)} hit the threshold${sim.medianDays ? `, median ${sim.medianDays} more trading days to pass` : ''}.`,
      sim.passPct < 0.5
        ? 'Improve the odds by cutting the size of your red days, not by making green days bigger.'
        : 'Keep doing what you’re doing. Don’t change size near the finish line.');
  }

  const profitLeft = p.profitRemaining;
  if (profitLeft > 0 && profitLeft <= r.maxDrawdown * 0.3 && s.avgQty > 1) {
    add('info', 'Close to the target', `Only ${$(profitLeft)} to go.`, 'Drop size for the final push. One normal-size loss here costs more than the target is worth.');
  }
}

function paTips(add, { account, progress: p, ds }) {
  const r = account.rules;
  if (p.status === 'failed') return;

  if (!p.safetyNetReached) {
    add('info', `${$(p.safetyNetRemaining)} to the safety net`,
      `The threshold stops trailing once your balance reaches ${$(p.safetyNet)}. Until then you are limited to ${p.contractLimit} contracts${r.halfContractsUntilSafetyNet ? ' (half size)' : ''}.`,
      'Build the cushion slowly. This stage is where most PA accounts are lost.');
  }

  if (p.status === 'payout-ready') {
    add('good', `Payout ready: up to ${$(p.withdrawable)}`, `Payout #${p.payoutNo} meets every check.`, 'Request it now. Then reset your cycle date in Account settings.');
  }

  const cons = p.payoutChecks.find((c) => c.id === 'consistency');
  if (!cons.ok && p.cycleProfit > 0) {
    add('warning', 'Consistency rule not met yet',
      `Your best day (${$(p.bestDay)}) is ${pct(p.consistencyRatio)} of this cycle’s profit. It has to be under ${r.consistencyPct}%.`,
      `Make ${$(p.profitNeededForConsistency)} more with no day bigger than ${$(p.bestDay)}. Try ${ds.avgGreenDay > 0 ? $(Math.min(p.bestDay * 0.8, Math.max(ds.avgGreenDay, r.qualifyingDayProfit))) : 'small, steady'} days, then stop.`);
  }

  const qual = p.payoutChecks.find((c) => c.id === 'qualifying');
  if (!qual.ok) {
    add('info', `${qual.need - qual.have} more $${r.qualifyingDayProfit}+ day(s) needed`,
      'These days count toward payout eligibility.', `Once you’re up $${r.qualifyingDayProfit}–$${r.qualifyingDayProfit * 3} with good trades, it’s okay to call it a day.`);
  }

  if (p.negativePnlBreaches.length) {
    add('critical', `${r.negativePnlPct}% negative P&L rule`,
      `${p.negativePnlBreaches.length} trade(s) lost more than ${r.negativePnlPct}% of the start-of-day profit (or drawdown). Apex checks open losses, so the real exposure was probably larger.`,
      'Use a hard stop on every PA trade, sized so a loss stays well under this limit.');
  }
}
