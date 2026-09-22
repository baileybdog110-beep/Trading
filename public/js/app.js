import { APEX_SIZES, apexRules, evaluate, guessPhase, guessSize } from './rules.js';
import { withDays, stats, dailyStats, breakdowns, behaviors, simulate, dailyPlan } from './analytics.js';
import { coach } from './coach.js';
import { importTrades, applyCommission } from './csv.js';
import { Tradovate } from './tradovate.js';
import { sampleTrades } from './sample.js';
import { load, save, uid, mergeTrades } from './store.js';
import { equityChart, dailyBars, breakdownBars } from './charts.js';
import * as V from './views.js';

const state = { ...load(), tab: 'progress' };
const sizes = Object.keys(APEX_SIZES);
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
let tv = null; // live Tradovate session (memory only)

// ---------- theme ----------
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem('proppath:theme'); } catch { /* storage unavailable */ }
  if (t) document.documentElement.dataset.theme = t;
  $('#btnTheme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('proppath:theme', next); } catch { /* ignore */ }
    render();
  });
})();

// ---------- model ----------
function activeAccount() {
  return state.accounts.find((a) => a.id === state.activeId) || state.accounts[0] || null;
}

function compute(account) {
  const trades = withDays(account.trades || []);
  const p = evaluate(account, trades);
  const s = stats(trades);
  const ds = dailyStats(p.days);
  const bd = breakdowns(trades);
  const bh = behaviors(trades, p.days);
  const r = account.rules;

  let remaining;
  let goalBalance;
  let minDays = 0;
  if (r.phase === 'eval') {
    remaining = p.profitRemaining;
    goalBalance = p.targetBalance;
    minDays = p.daysShort;
  } else {
    const bal = p.payoutChecks.find((c) => c.id === 'balance');
    const cons = p.profitNeededForConsistency;
    remaining = Math.max(bal.need - p.balance, cons, 0);
    goalBalance = p.balance + remaining;
    minDays = Math.max(0, r.minDaysPerPayout - p.cycleDays.length);
  }
  const defaultDays = Math.max(minDays, remaining > 0 && ds.avgGreenDay > 0 ? Math.ceil(remaining / (ds.avgGreenDay * 0.6)) : 5, 1);
  const plan = dailyPlan({
    remaining,
    ddRemaining: p.ddRemaining,
    daysLeft: Math.min(60, account.planDays || defaultDays),
    maxContracts: p.contractLimit ?? r.maxContracts,
    avgLossPerContract: s.avgLossPerContract,
  });
  const sim = !p.busted && remaining > 0
    ? simulate({ dailyPnls: p.days.map((d) => d.pnl), balance: p.balance, peak: p.peak, rules: r, goalBalance, minDays })
    : null;
  const m = { trades, p, s, ds, bd, bh, plan, sim };
  m.tips = coach({ account, progress: p, s, ds, bd, bh, plan, sim });
  return m;
}

// ---------- render ----------
function render() {
  const acct = activeAccount();
  const sel = $('#accountSelect');
  sel.hidden = !state.accounts.length;
  sel.innerHTML = state.accounts.map((a) => `<option value="${a.id}" ${acct && a.id === acct.id ? 'selected' : ''}>${V.esc(a.name)} · ${a.rules.phase === 'eval' ? 'Eval' : 'PA'}</option>`).join('');

  if (!acct) {
    app.innerHTML = V.emptyState();
    return;
  }
  const m = compute(acct);
  const tabs = [['progress', 'Progress'], ['analysis', 'Analysis'], ['coach', `Coach (${m.tips.filter((t) => t.severity === 'critical' || t.severity === 'warning').length})`], ['trades', 'Trades'], ['settings', 'Settings']];
  let body = '';
  if (state.tab === 'progress') body = acct.rules.phase === 'eval' ? V.progressEval(acct, m) : V.progressPA(acct, m);
  else if (state.tab === 'analysis') body = V.analysis(m);
  else if (state.tab === 'coach') body = V.coachView(m.tips);
  else if (state.tab === 'trades') body = V.tradesView(m.trades);
  else body = V.settingsView(acct, sizes);

  const top = m.tips.find((t) => t.severity === 'critical') || m.tips.find((t) => t.severity === 'warning');
  app.innerHTML = `${V.hero(acct, m)}
    ${top && state.tab === 'progress' ? `<button type="button" class="callout sev-${top.severity}" data-tab="coach"><b>Top priority:</b> ${V.esc(top.title)}. ${V.esc(top.action || '')} <span class="muted">See all advice →</span></button>` : ''}
    <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" type="button" aria-selected="${state.tab === k}" data-tab="${k}">${l}</button>`).join('')}</nav>
    <div class="tab-body">${body}</div>`;

  if (state.tab === 'progress') {
    const r = acct.rules;
    equityChart($('#chartEquity'), {
      points: m.p.path,
      target: r.phase === 'eval' ? m.p.targetBalance : null,
      safetyNet: r.phase === 'pa' ? m.p.safetyNet : null,
    });
  }
  if (state.tab === 'analysis') {
    dailyBars($('#chartDaily'), m.p.days, { limitLine: m.plan.dailyStop });
    breakdownBars($('#bdHour'), m.bd.byHour, { title: 'By hour of entry (ET)' });
    breakdownBars($('#bdTradeNo'), m.bd.byTradeOfDay.map((g) => ({ ...g, label: `Trade #${g.key}` })), { title: 'By trade # of the day' });
    breakdownBars($('#bdSymbol'), m.bd.bySymbol, { title: 'By instrument' });
    breakdownBars($('#bdWeekday'), m.bd.byWeekday, { title: 'By weekday' });
    breakdownBars($('#bdHold'), m.bd.byHold, { title: 'By hold time' });
    breakdownBars($('#bdSide'), [...m.bd.bySide, ...m.bd.bySize.map((g) => ({ ...g, label: `Size ${g.key}` }))], { title: 'By side & size' });
  }
}

function persist() {
  if (!save(state)) toast('Could not save to browser storage. Your data will be lost when you close the tab.');
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// ---------- events ----------
app.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; render(); return; }
  const act = e.target.closest('[data-action]');
  if (act?.dataset.action === 'connect') openConnect();
  if (act?.dataset.action === 'import') openImport();
  if (act?.dataset.action === 'demo') loadDemo();
  if (e.target.id === 'btnDelete') {
    const acct = activeAccount();
    if (acct && confirm(`Delete "${acct.name}" and its trades from this browser?`)) {
      state.accounts = state.accounts.filter((a) => a.id !== acct.id);
      state.activeId = state.accounts[0]?.id || null;
      state.tab = 'progress';
      persist();
      render();
    }
  }
});

app.addEventListener('change', (e) => {
  if (e.target.id === 'planDays') {
    const acct = activeAccount();
    acct.planDays = Math.max(1, Math.min(60, +e.target.value || 1));
    persist();
    render();
  }
});

app.addEventListener('submit', (e) => {
  if (e.target.id !== 'formSettings') return;
  e.preventDefault();
  const acct = activeAccount();
  const f = new FormData(e.target);
  const phase = f.get('phase');
  const size = +f.get('size');
  // Changing size or phase resets to that preset. Otherwise apply the edited numbers.
  if (phase !== acct.rules.phase || size !== acct.rules.size) {
    acct.rules = apexRules(size, phase);
  } else {
    for (const [k, v] of f.entries()) {
      if (k in acct.rules && !['phase', 'size', 'drawdownMode', 'lastPayoutDate'].includes(k)) {
        acct.rules[k] = v === '' ? null : +v;
      }
    }
    acct.rules.drawdownMode = f.get('drawdownMode');
    if (phase === 'pa') {
      acct.rules.lastPayoutDate = f.get('lastPayoutDate') || '';
      acct.rules.halfContractsUntilSafetyNet = f.get('halfContractsUntilSafetyNet') === 'on';
    }
  }
  acct.name = f.get('name') || acct.name;
  const num = (k) => (f.get(k) === '' || f.get(k) == null ? null : +f.get(k));
  acct.currentBalance = num('currentBalance');
  acct.thresholdOverride = num('thresholdOverride');
  persist();
  toast('Settings saved');
  render();
});

$('#accountSelect').addEventListener('change', (e) => {
  state.activeId = e.target.value;
  persist();
  render();
});
$('#btnConnect').addEventListener('click', openConnect);
$('#btnImport').addEventListener('click', openImport);

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});

// ---------- demo ----------
function loadDemo() {
  const now = new Date();
  const evalAcct = {
    id: uid(), name: 'APEX-DEMO-01', source: 'demo',
    rules: apexRules(50000, 'eval'),
    trades: sampleTrades({ seed: 11, days: 12, endDate: now }),
  };
  const paAcct = {
    id: uid(), name: 'PAAPEX-DEMO-02', source: 'demo',
    rules: apexRules(50000, 'pa'),
    trades: sampleTrades({ seed: 5, days: 18, endDate: now }),
  };
  state.accounts.push(evalAcct, paAcct);
  state.activeId = evalAcct.id;
  state.tab = 'progress';
  persist();
  render();
}

// ---------- CSV import ----------
const dlgImport = $('#dlgImport');
function openImport() {
  const target = $('#importTarget');
  target.innerHTML = `<option value="new">+ New account</option>` + state.accounts.map((a) => `<option value="${a.id}" ${a.id === state.activeId ? 'selected' : ''}>${V.esc(a.name)}</option>`).join('');
  dlgImport.querySelectorAll('.size-select').forEach((s) => {
    s.innerHTML = sizes.map((v) => `<option value="${v}" ${v === '50000' ? 'selected' : ''}>${V.money(+v)}</option>`).join('');
  });
  $('#importError').textContent = '';
  $('#dropText').textContent = 'Drop a CSV here or browse';
  $('#formImport').reset();
  target.value = state.activeId && state.accounts.length ? state.activeId : 'new';
  $('#newAcctFields').hidden = target.value !== 'new';
  dlgImport.showModal();
}
$('#importTarget').addEventListener('change', (e) => { $('#newAcctFields').hidden = e.target.value !== 'new'; });
const fileInput = $('#formImport input[type=file]');
fileInput.addEventListener('change', () => { $('#dropText').textContent = fileInput.files[0]?.name || 'Drop a CSV here or browse'; });
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    $('#dropText').textContent = e.dataTransfer.files[0].name;
  }
});

$('#formImport').addEventListener('submit', async (e) => {
  if (e.submitter?.value === 'cancel') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const file = fileInput.files[0];
  const err = $('#importError');
  if (!file) { err.textContent = 'Choose a CSV file first.'; return; }
  try {
    const { trades, skipped, format } = importTrades(await file.text());
    if (!trades.length) throw new Error('No trades were found in that file.');
    const withFees = applyCommission(trades, +f.get('commission') || 0);
    let acct;
    if (f.get('target') === 'new') {
      const name = f.get('name') || file.name.replace(/\.csv$/i, '');
      const phase = f.get('phase') || guessPhase(name);
      acct = { id: uid(), name, source: 'csv', rules: apexRules(+f.get('size'), phase), trades: [] };
      state.accounts.push(acct);
    } else {
      acct = state.accounts.find((a) => a.id === f.get('target'));
    }
    acct.trades = mergeTrades(acct.trades || [], withFees);
    if (f.get('balance')) acct.currentBalance = +f.get('balance');
    acct.syncedAt = Date.now();
    state.activeId = acct.id;
    state.tab = 'progress';
    persist();
    dlgImport.close();
    render();
    toast(`Imported ${trades.length} trades (${format})${skipped.length ? `, skipped ${skipped.length} rows` : ''}.`);
  } catch (ex) {
    err.textContent = ex.message;
  }
});

// ---------- Tradovate connect ----------
const dlgConnect = $('#dlgConnect');
function openConnect() {
  $('#connectError').textContent = '';
  dlgConnect.showModal();
}
$('#formConnect').addEventListener('change', (e) => {
  if (e.target.name !== 'method') return;
  for (const el of dlgConnect.querySelectorAll('[data-method]')) el.hidden = el.dataset.method !== e.target.value;
});
$('#formConnect').addEventListener('submit', async (e) => {
  if (e.submitter?.value === 'cancel') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $('#btnDoConnect');
  const err = $('#connectError');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    tv = new Tradovate(f.get('env'));
    if (f.get('method') === 'token') tv.useToken(f.get('token'));
    else await tv.login({ name: f.get('name'), password: f.get('password'), cid: f.get('cid'), sec: f.get('sec') });
    const accounts = await tv.accounts();
    if (!accounts?.length) throw new Error('No accounts on this login. Try the other environment (Demo/Live).');
    const balances = await Promise.all(accounts.map((a) => tv.balance(a.id).catch(() => null)));
    e.target.querySelector('[name=password]').value = '';
    dlgConnect.close();
    openPicker(accounts.map((a, i) => ({ ...a, balance: balances[i] })));
  } catch (ex) {
    err.textContent = ex.message.includes('Failed to fetch')
      ? 'Could not reach the PropPath server. Start it with "npm start" and open http://localhost:3000.'
      : ex.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect';
  }
});

function openPicker(accounts) {
  const list = $('#pickList');
  list.innerHTML = accounts.map((a, i) => {
    const phase = guessPhase(a.name);
    const size = guessSize(a.balance);
    return `<div class="pick-row">
      <label class="check-label"><input type="checkbox" name="use${i}" checked /> <b>${V.esc(a.name)}</b> <span class="muted small">${a.balance != null ? V.money(a.balance) : ''}</span></label>
      <select name="phase${i}" aria-label="Phase"><option value="eval" ${phase === 'eval' ? 'selected' : ''}>Eval</option><option value="pa" ${phase === 'pa' ? 'selected' : ''}>PA</option></select>
      <select name="size${i}" aria-label="Size">${sizes.map((s) => `<option value="${s}" ${+s === size ? 'selected' : ''}>${V.money(+s)}</option>`).join('')}</select>
    </div>`;
  }).join('');
  $('#pickError').textContent = '';
  const dlg = $('#dlgPick');
  const form = $('#formPick');
  form.onsubmit = async (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const f = new FormData(form);
    try {
      const byAccount = await tv.tradesByAccount();
      let count = 0;
      accounts.forEach((a, i) => {
        if (!f.get(`use${i}`)) return;
        let acct = state.accounts.find((x) => x.source === 'tradovate' && x.tradovateId === a.id);
        const rules = apexRules(+f.get(`size${i}`), f.get(`phase${i}`));
        if (!acct) {
          acct = { id: uid(), name: a.name, source: 'tradovate', tradovateId: a.id, rules, trades: [] };
          state.accounts.push(acct);
        } else if (acct.rules.phase !== rules.phase || acct.rules.size !== rules.size) {
          acct.rules = rules;
        }
        acct.trades = mergeTrades(acct.trades, byAccount.get(a.id) || []);
        if (Number.isFinite(a.balance)) acct.currentBalance = a.balance;
        acct.syncedAt = Date.now();
        state.activeId = acct.id;
        count++;
      });
      state.tab = 'progress';
      persist();
      dlg.close();
      render();
      toast(`Synced ${count} account(s). Tradovate's API only returns recent fills, so import a Performance CSV to add older trades.`);
    } catch (ex) {
      $('#pickError').textContent = ex.message;
    }
  };
  dlg.showModal();
}

render();
