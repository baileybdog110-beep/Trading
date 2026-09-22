// Time helpers. Futures prop firms (Apex included) count a "trading day" as the
// CME session that opens at 6:00 PM ET and closes at 5:00 PM ET the next day,
// so a trade closed at 7 PM ET on Monday belongs to Tuesday's session.

const etParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

export function toET(ms) {
  const out = {};
  for (const p of etParts.formatToParts(new Date(ms))) out[p.type] = p.value;
  return {
    year: +out.year,
    month: +out.month,
    day: +out.day,
    hour: +out.hour,
    minute: +out.minute,
    weekday: out.weekday,
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** Session date (YYYY-MM-DD) that a timestamp belongs to. */
export function tradingDay(ms) {
  const et = toET(ms);
  let d = new Date(Date.UTC(et.year, et.month - 1, et.day));
  if (et.hour >= 18) d = new Date(d.getTime() + 86400000);
  // Weekend sessions roll forward to Monday (Sunday 6 PM open counts as Monday).
  const dow = d.getUTCDay();
  if (dow === 6) d = new Date(d.getTime() + 2 * 86400000);
  if (dow === 0) d = new Date(d.getTime() + 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function weekdayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}
