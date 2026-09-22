// Deterministic demo data so the app can be explored without an account.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ~3 weeks of MNQ/NQ/MES trades with a few bad habits mixed in. */
export function sampleTrades({ seed = 7, days = 14, endDate = new Date() } = {}) {
  const rand = rng(seed);
  const trades = [];
  const sessions = [];
  const d = new Date(endDate);
  d.setHours(0, 0, 0, 0);
  while (sessions.length < days) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) sessions.unshift(new Date(d));
  }
  let id = 1;
  for (const day of sessions) {
    // Entries between 9:30 and 11:30 ET, plus some afternoon trades (converted from local time).
    const n = 2 + Math.floor(rand() * 6);
    let t = etTime(day, 9, 31 + Math.floor(rand() * 20));
    let lastLoss = false;
    for (let i = 0; i < n; i++) {
      const sym = rand() < 0.7 ? 'MNQZ6' : rand() < 0.5 ? 'NQZ6' : 'MESZ6';
      const pv = sym.startsWith('NQ') ? 20 : sym.startsWith('MNQ') ? 2 : 5;
      let qty = sym.startsWith('NQ') ? 1 : 2 + Math.floor(rand() * 3);
      if (lastLoss && rand() < 0.4) qty += 2; // sizing up after a loss
      const afternoon = etHour(t) >= 13;
      const late = i >= 3;
      const edge = (afternoon ? -0.12 : 0.08) + (late ? -0.1 : 0) + (lastLoss ? -0.08 : 0);
      const win = rand() < 0.5 + edge;
      const pts = win ? 6 + rand() * 18 : -(5 + rand() * 22);
      const hold = (win ? 60 + rand() * 400 : 90 + rand() * 900) * 1000;
      const short = rand() < 0.45;
      const entry = 21000 + rand() * 400;
      const exit = entry + (short ? -pts : pts);
      trades.push({
        id: `demo-${id++}`,
        symbol: sym,
        side: short ? 'short' : 'long',
        qty,
        entryTime: t,
        exitTime: t + hold,
        entryPrice: +entry.toFixed(2),
        exitPrice: +exit.toFixed(2),
        pnl: +(pts * pv * qty - 1.1 * qty).toFixed(2),
        fees: +(1.1 * qty).toFixed(2),
      });
      lastLoss = !win;
      const gap = lastLoss ? 1 + rand() * 6 : 8 + rand() * 45;
      t = t + hold + gap * 60000;
      if (i === 2 && rand() < 0.3) t = etTime(day, 13, 5 + Math.floor(rand() * 40));
    }
  }
  return trades;
}

// Build an epoch ms for a wall-clock time in New York on the given date.
function etTime(date, h, m) {
  const guess = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), h + 4, m);
  const etHourAtGuess = etHour(guess);
  return guess + (h - etHourAtGuess) * 3600000;
}

function etHour(ms) {
  return +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}
