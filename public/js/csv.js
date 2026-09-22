// CSV import for Tradovate "Performance" exports, NinjaTrader trade exports and
// generic trade logs. Every format is turned into the same trade shape:
// { id, symbol, side, qty, entryTime, exitTime, entryPrice, exitPrice, pnl, fees }

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** "$1,250.00", "$(25.00)", "-25", "(25)" -> number */
export function parseMoney(v) {
  if (v == null) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s) || /\(.*\)/.test(s)) neg = true;
  if (s.startsWith('-') || s.startsWith('$-') || s.startsWith('-$')) neg = true;
  s = s.replace(/[^0-9.]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

/** Parses "MM/DD/YYYY HH:mm:ss" (local time), ISO strings, and epoch ms. */
export function parseTime(v) {
  if (v == null || v === '') return NaN;
  const s = String(v).trim();
  if (/^\d{12,}$/.test(s)) return +s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM)?$/i);
  if (m) {
    let [, mo, d, y, h, mi, se, ap] = m;
    y = +y < 100 ? 2000 + +y : +y;
    h = +h;
    if (ap) {
      if (/pm/i.test(ap) && h < 12) h += 12;
      if (/am/i.test(ap) && h === 12) h = 0;
    }
    return new Date(y, +mo - 1, +d, h, +mi, +(se || 0)).getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

function finder(headers) {
  const n = headers.map(norm);
  return (...aliases) => {
    for (const a of aliases) {
      const i = n.indexOf(norm(a));
      if (i >= 0) return i;
    }
    return -1;
  };
}

export function detectFormat(headers) {
  const f = finder(headers);
  if (f('buyFillId') >= 0 && f('boughtTimestamp') >= 0) return 'tradovate-performance';
  if (f('Market pos.') >= 0 && f('Entry time') >= 0) return 'ninjatrader';
  return 'generic';
}

export function importTrades(text) {
  const rows = parseCSV(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new Error('The file has no data rows.');
  const headers = rows[0].map((h) => h.trim());
  const format = detectFormat(headers);
  const f = finder(headers);
  const data = rows.slice(1);
  const trades = [];
  const skipped = [];

  const get = (r, i) => (i >= 0 ? r[i] : undefined);

  if (format === 'tradovate-performance') {
    const c = {
      sym: f('symbol'), qty: f('qty'), bp: f('buyPrice'), sp: f('sellPrice'), pnl: f('pnl'),
      bt: f('boughtTimestamp'), st: f('soldTimestamp'), bid: f('buyFillId'), sid: f('sellFillId'),
    };
    data.forEach((r, i) => {
      const bt = parseTime(get(r, c.bt));
      const st = parseTime(get(r, c.st));
      const pnl = parseMoney(get(r, c.pnl));
      if (!Number.isFinite(bt) || !Number.isFinite(st) || !Number.isFinite(pnl)) return skipped.push(i + 2);
      const short = st < bt;
      trades.push({
        id: `${get(r, c.bid)}-${get(r, c.sid)}`,
        symbol: get(r, c.sym),
        side: short ? 'short' : 'long',
        qty: +get(r, c.qty) || 1,
        entryTime: Math.min(bt, st),
        exitTime: Math.max(bt, st),
        entryPrice: +(short ? get(r, c.sp) : get(r, c.bp)),
        exitPrice: +(short ? get(r, c.bp) : get(r, c.sp)),
        pnl,
        fees: 0,
      });
    });
    return { format, trades, skipped };
  }

  const c = format === 'ninjatrader'
    ? {
      sym: f('Instrument'), side: f('Market pos.'), qty: f('Qty'), ep: f('Entry price'), xp: f('Exit price'),
      et: f('Entry time'), xt: f('Exit time'), pnl: f('Profit'), fee: f('Commission'), id: f('Trade number'),
    }
    : {
      sym: f('symbol', 'instrument', 'contract', 'ticker', 'market'),
      side: f('side', 'direction', 'position', 'type', 'marketpos', 'buysell'),
      qty: f('qty', 'quantity', 'size', 'contracts', 'volume'),
      ep: f('entryprice', 'entry', 'openprice', 'avgentryprice', 'buyprice'),
      xp: f('exitprice', 'exit', 'closeprice', 'avgexitprice', 'sellprice'),
      et: f('entrytime', 'opentime', 'entrydate', 'opendate', 'timeopened', 'boughttimestamp', 'entrydatetime'),
      xt: f('exittime', 'closetime', 'exitdate', 'closedate', 'timeclosed', 'soldtimestamp', 'exitdatetime', 'date', 'time'),
      pnl: f('netpnl', 'netprofit', 'pnl', 'profit', 'realizedpnl', 'pl', 'profitloss', 'grosspnl', 'netpl'),
      fee: f('commission', 'commissions', 'fees', 'fee'),
      id: f('id', 'tradeid', 'tradenumber'),
    };
  if (c.pnl < 0 || c.xt < 0) {
    throw new Error('Could not find P&L and exit-time columns. Export the Performance report from Tradovate (Reports → Performance → Download).');
  }
  const pnlIsNet = /net/i.test(headers[c.pnl]);
  data.forEach((r, i) => {
    const xt = parseTime(get(r, c.xt));
    let et = parseTime(get(r, c.et));
    let pnl = parseMoney(get(r, c.pnl));
    if (!Number.isFinite(xt) || !Number.isFinite(pnl)) return skipped.push(i + 2);
    if (!Number.isFinite(et)) et = xt;
    const fee = Math.abs(parseMoney(get(r, c.fee))) || 0;
    // NinjaTrader's "Profit" is gross; subtract commission so P&L is net.
    if (fee && !pnlIsNet) pnl -= fee;
    const sideRaw = String(get(r, c.side) ?? '').toLowerCase();
    trades.push({
      id: get(r, c.id) || `row${i + 2}`,
      symbol: get(r, c.sym) || '—',
      side: /short|sell|^s$/.test(sideRaw) ? 'short' : 'long',
      qty: Math.abs(+get(r, c.qty)) || 1,
      entryTime: et,
      exitTime: xt,
      entryPrice: +get(r, c.ep) || null,
      exitPrice: +get(r, c.xp) || null,
      pnl,
      fees: fee,
    });
  });
  return { format, trades, skipped };
}

/** Apply a flat round-turn commission per contract (for gross-P&L imports). */
export function applyCommission(trades, perContractRT) {
  if (!perContractRT) return trades;
  return trades.map((t) => {
    const fee = perContractRT * (t.qty || 1);
    return { ...t, pnl: t.pnl - fee, fees: (t.fees || 0) + fee };
  });
}
