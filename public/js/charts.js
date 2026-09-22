// Small dependency-free SVG charts with hover tooltips.

const NS = 'http://www.w3.org/2000/svg';
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('role', 'status');
    document.body.appendChild(tip);
  }
  return tip;
}
function showTip(html, x, y) {
  const t = tooltip();
  t.innerHTML = html;
  t.style.display = 'block';
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 14));
  const top = y - h - 12 < 8 ? y + 16 : y - h - 12;
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}
function hideTip() {
  if (tip) tip.style.display = 'none';
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

/**
 * Balance line vs trailing threshold, with an optional target line.
 * points: [{balance, threshold, time}]
 */
export function equityChart(container, { points, target, safetyNet }) {
  container.innerHTML = '';
  const W = container.clientWidth || 640;
  const H = 280;
  const m = { t: 16, r: 88, b: 28, l: 64 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': 'Account balance over time against the drawdown threshold' }, container);
  if (points.length < 2) {
    const t = el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'axis-label' }, svg);
    t.textContent = 'No trades yet';
    return;
  }
  const vals = points.flatMap((p) => [p.balance, p.threshold]);
  if (target) vals.push(target);
  if (safetyNet) vals.push(safetyNet);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 100;
  lo -= pad; hi += pad;
  const x = (i) => m.l + (i / (points.length - 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);

  for (const v of niceTicks(lo, hi)) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }, svg);
    const t = el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis-label' }, svg);
    t.textContent = money(v);
  }
  const xl = el('text', { x: m.l, y: H - 8, class: 'axis-label' }, svg);
  xl.textContent = 'Trade 1';
  const xr = el('text', { x: W - m.r, y: H - 8, 'text-anchor': 'end', class: 'axis-label' }, svg);
  xr.textContent = `Trade ${points.length - 1}`;

  const refLine = (v, cls, label) => {
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: cls }, svg);
    const t = el('text', { x: W - m.r + 6, y: y(v) + 4, class: 'ref-label' }, svg);
    t.textContent = label;
  };
  if (target) refLine(target, 'ref-target', 'Target');
  if (safetyNet) refLine(safetyNet, 'ref-safety', 'Safety net');

  const path = (key) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  el('path', { d: path('threshold'), class: 'line-threshold' }, svg);
  el('path', { d: path('balance'), class: 'line-balance' }, svg);

  const last = points[points.length - 1];
  const lb = el('text', { x: W - m.r + 6, y: y(last.balance) + 4, class: 'direct-label' }, svg);
  lb.textContent = 'Balance';
  const lt = el('text', { x: W - m.r + 6, y: y(last.threshold) + 4, class: 'direct-label muted' }, svg);
  lt.textContent = 'Threshold';

  const cross = el('line', { y1: m.t, y2: H - m.b, class: 'crosshair', visibility: 'hidden' }, svg);
  const dotB = el('circle', { r: 4.5, class: 'dot-balance', visibility: 'hidden' }, svg);
  const dotT = el('circle', { r: 4, class: 'dot-threshold', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' }, svg);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (points.length - 1))));
    const p = points[i];
    for (const [e, v] of [[dotB, p.balance], [dotT, p.threshold]]) {
      e.setAttribute('cx', x(i)); e.setAttribute('cy', y(v)); e.setAttribute('visibility', 'visible');
    }
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    const when = i === 0 ? 'Start' : `Trade ${i} · ${new Date(p.time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    showTip(`<div class="tip-h">${when}</div>
      <div><span class="sw sw-balance"></span>Balance <b>${money(p.balance)}</b></div>
      <div><span class="sw sw-threshold"></span>Threshold <b>${money(p.threshold)}</b></div>
      <div class="tip-muted">Buffer ${money(p.balance - p.threshold)}</div>`, ev.clientX, ev.clientY);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', () => {
    hideTip();
    for (const e of [cross, dotB, dotT]) e.setAttribute('visibility', 'hidden');
  });
}

/** Vertical P&L bars, one per trading day. */
export function dailyBars(container, days, { limitLine } = {}) {
  container.innerHTML = '';
  const W = container.clientWidth || 640;
  const H = 220;
  const m = { t: 12, r: 12, b: 28, l: 64 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': 'Daily profit and loss' }, container);
  if (!days.length) return;
  const vals = days.map((d) => d.pnl).concat([0]);
  if (limitLine) vals.push(-limitLine);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 50;
  lo -= pad; hi += pad;
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const band = (W - m.l - m.r) / days.length;
  const bw = Math.max(2, Math.min(28, band - 2));

  for (const v of niceTicks(lo, hi)) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'baseline' : 'grid' }, svg);
    const t = el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis-label' }, svg);
    t.textContent = money(v);
  }
  el('line', { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), class: 'baseline' }, svg);
  if (limitLine) {
    el('line', { x1: m.l, x2: W - m.r, y1: y(-limitLine), y2: y(-limitLine), class: 'ref-threshold' }, svg);
    const t = el('text', { x: W - m.r - 4, y: y(-limitLine) - 6, 'text-anchor': 'end', class: 'ref-label' }, svg);
    t.textContent = `Suggested daily stop ${money(-limitLine)}`;
  }

  days.forEach((d, i) => {
    const cx = m.l + band * i + band / 2;
    const y0 = y(0);
    const y1 = y(d.pnl);
    const h = Math.max(1, Math.abs(y1 - y0));
    const top = Math.min(y0, y1);
    const rr = Math.min(4, bw / 2, h);
    // Rounded at the data end only; square at the baseline.
    const x0 = cx - bw / 2;
    const dPath = d.pnl >= 0
      ? `M${x0},${y0}V${top + rr}Q${x0},${top} ${x0 + rr},${top}H${x0 + bw - rr}Q${x0 + bw},${top} ${x0 + bw},${top + rr}V${y0}Z`
      : `M${x0},${y0}V${top + h - rr}Q${x0},${top + h} ${x0 + rr},${top + h}H${x0 + bw - rr}Q${x0 + bw},${top + h} ${x0 + bw},${top + h - rr}V${y0}Z`;
    el('path', { d: dPath, class: d.pnl >= 0 ? 'bar-pos' : 'bar-neg' }, svg);
    const hit = el('rect', { x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (ev) => showTip(`<div class="tip-h">${d.date}</div>
      <div>P&amp;L <b>${money(d.pnl)}</b></div>
      <div class="tip-muted">${d.trades} trades · ${d.wins} wins · peak ${money(d.peakPnl)}</div>`, ev.clientX, ev.clientY));
    hit.addEventListener('pointerleave', hideTip);
  });
  if (days.length <= 16) {
    days.forEach((d, i) => {
      if (days.length > 8 && i % 2) return;
      const t = el('text', { x: m.l + band * i + band / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis-label' }, svg);
      t.textContent = d.date.slice(5);
    });
  } else {
    const a = el('text', { x: m.l, y: H - 8, class: 'axis-label' }, svg);
    a.textContent = days[0].date.slice(5);
    const b = el('text', { x: W - m.r, y: H - 8, 'text-anchor': 'end', class: 'axis-label' }, svg);
    b.textContent = days[days.length - 1].date.slice(5);
  }
}

/** Horizontal diverging bars for a breakdown table (P&L per group). */
export function breakdownBars(container, rows, { title } = {}) {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'hbars';
  if (title) {
    const h = document.createElement('h4');
    h.textContent = title;
    wrap.appendChild(h);
  }
  if (!rows.length) {
    wrap.insertAdjacentHTML('beforeend', '<p class="muted small">No data</p>');
    container.appendChild(wrap);
    return;
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'hbar-row';
    row.tabIndex = 0;
    const w = (Math.abs(r.pnl) / max) * 50;
    row.innerHTML = `<span class="hbar-label">${r.label ?? r.key}</span>
      <span class="hbar-track"><span class="hbar-zero"></span><span class="hbar ${r.pnl >= 0 ? 'pos' : 'neg'}" style="${r.pnl >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`}"></span></span>
      <span class="hbar-val ${r.pnl >= 0 ? 'pos-text' : 'neg-text'}">${money(r.pnl)}</span>`;
    const html = `<div class="tip-h">${r.label ?? r.key}</div><div>P&amp;L <b>${money(r.pnl)}</b></div>
      <div class="tip-muted">${r.trades} trades · ${Math.round(r.winRate * 100)}% win · ${money(r.avg)}/trade</div>`;
    row.addEventListener('pointermove', (ev) => showTip(html, ev.clientX, ev.clientY));
    row.addEventListener('pointerleave', hideTip);
    row.addEventListener('focus', () => {
      const b = row.getBoundingClientRect();
      showTip(html, b.left + b.width / 2, b.top);
    });
    row.addEventListener('blur', hideTip);
    wrap.appendChild(row);
  }
  container.appendChild(wrap);
}
