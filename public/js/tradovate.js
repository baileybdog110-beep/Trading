// Tradovate REST client (via the local /tv proxy). Read-only: it never places,
// changes or cancels orders.
//
// Apex accounts on Tradovate: evaluation and PA accounts both show up under the
// Tradovate login Apex gave you. API access needs Tradovate API credentials
// (cid + secret). If you don't have them, use CSV import instead.

import { rootSymbol } from './analytics.js';

// Dollar value of a 1.0 price move, used only if the product lookup fails.
export const POINT_VALUES = {
  ES: 50, MES: 5, NQ: 20, MNQ: 2, YM: 5, MYM: 0.5, RTY: 50, M2K: 5,
  CL: 1000, MCL: 100, QM: 500, NG: 10000, QG: 2500, GC: 100, MGC: 10, SI: 5000, SIL: 1000, HG: 25000, MHG: 2500,
  ZB: 1000, ZN: 1000, ZF: 1000, ZT: 2000, UB: 1000, '6E': 125000, M6E: 12500, '6J': 12500000, '6B': 62500, '6A': 100000, '6C': 100000,
  ZC: 50, ZS: 50, ZW: 50, HE: 400, LE: 400, BTC: 5, MBT: 0.1, ETH: 50, MET: 0.1,
};

export class Tradovate {
  constructor(env = 'demo', base = '/tv') {
    this.env = env;
    this.base = base;
    this.token = null;
  }

  async req(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${this.base}/${this.env}${path}`, {
      method,
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { errorText: text }; }
    if (!res.ok) throw new Error(data?.errorText || `${res.status} ${res.statusText} on ${path}`);
    if (data && data.errorText) throw new Error(data.errorText);
    return data;
  }

  async login({ name, password, cid, sec, appId = 'PropPath', appVersion = '1.0' }) {
    const deviceId = getDeviceId();
    const data = await this.req('/auth/accesstokenrequest', {
      method: 'POST',
      body: { name, password, appId, appVersion, deviceId, cid: cid ? +cid : undefined, sec: sec || undefined },
    });
    if (data['p-ticket']) {
      const wait = data['p-time'] ? ` Try again in ${data['p-time']} seconds.` : '';
      throw new Error(data['p-captcha']
        ? 'Tradovate wants a captcha for this login. Log in once at trader.tradovate.com, then try again.'
        : `Tradovate is rate limiting logins.${wait}`);
    }
    if (!data.accessToken) throw new Error('Login failed. Check your username, password and API key.');
    this.token = data.accessToken;
    return data;
  }

  useToken(token) {
    this.token = token.replace(/^Bearer\s+/i, '').trim();
  }

  accounts() {
    return this.req('/account/list');
  }

  async balance(accountId) {
    try {
      const snap = await this.req('/cashBalance/getcashbalancesnapshot', { method: 'POST', body: { accountId } });
      return snap?.totalCashValue;
    } catch {
      const list = await this.req('/cashBalance/list');
      const cb = list.find((c) => c.accountId === accountId);
      return cb?.amount;
    }
  }

  /** Closed trades for every account, keyed by account id. */
  async tradesByAccount() {
    const [pairs, fills, positions] = await Promise.all([
      this.req('/fillPair/list'),
      this.req('/fill/list'),
      this.req('/position/list'),
    ]);
    const fillById = new Map(fills.map((f) => [f.id, f]));
    const posById = new Map(positions.map((p) => [p.id, p]));

    // Positions referenced by pairs but not returned by the list.
    const missing = [...new Set(pairs.map((p) => p.positionId).filter((id) => !posById.has(id)))];
    if (missing.length) {
      for (const p of await this.items('position', missing)) posById.set(p.id, p);
    }

    const contractIds = [...new Set(fills.map((f) => f.contractId))];
    const contracts = await this.items('contract', contractIds);
    const pointValues = await this.pointValues(contracts);
    const contractById = new Map(contracts.map((c) => [c.id, c]));

    const out = new Map();
    for (const p of pairs) {
      const buy = fillById.get(p.buyFillId);
      const sell = fillById.get(p.sellFillId);
      if (!buy || !sell) continue;
      const accountId = posById.get(p.positionId)?.accountId;
      if (accountId == null) continue;
      const contract = contractById.get(buy.contractId);
      const symbol = contract?.name || String(buy.contractId);
      const pv = pointValues.get(buy.contractId) ?? POINT_VALUES[rootSymbol(symbol)] ?? 1;
      const bt = Date.parse(buy.timestamp);
      const st = Date.parse(sell.timestamp);
      const short = st < bt;
      const trade = {
        id: `tv-${p.id}`,
        symbol,
        side: short ? 'short' : 'long',
        qty: p.qty,
        entryTime: Math.min(bt, st),
        exitTime: Math.max(bt, st),
        entryPrice: short ? p.sellPrice : p.buyPrice,
        exitPrice: short ? p.buyPrice : p.sellPrice,
        pnl: (p.sellPrice - p.buyPrice) * p.qty * pv,
        fees: 0,
      };
      if (!out.has(accountId)) out.set(accountId, []);
      out.get(accountId).push(trade);
    }
    return out;
  }

  async items(entity, ids) {
    if (!ids.length) return [];
    const res = [];
    for (let i = 0; i < ids.length; i += 50) {
      res.push(...(await this.req(`/${entity}/items?ids=${ids.slice(i, i + 50).join(',')}`)));
    }
    return res;
  }

  async pointValues(contracts) {
    const out = new Map();
    try {
      const maturities = await this.items('contractMaturity', [...new Set(contracts.map((c) => c.contractMaturityId))]);
      const products = await this.items('product', [...new Set(maturities.map((m) => m.productId))]);
      const matById = new Map(maturities.map((m) => [m.id, m]));
      const prodById = new Map(products.map((p) => [p.id, p]));
      for (const c of contracts) {
        const vpp = prodById.get(matById.get(c.contractMaturityId)?.productId)?.valuePerPoint;
        if (vpp) out.set(c.id, vpp);
      }
    } catch {
      // Fall back to the static table.
    }
    return out;
  }
}

function getDeviceId() {
  try {
    let id = localStorage.getItem('pp-device');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('pp-device', id);
    }
    return id;
  } catch {
    return 'proppath-web';
  }
}
