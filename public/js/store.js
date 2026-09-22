// Accounts and trades persist in this browser's localStorage only.
// Tradovate passwords and tokens are never saved.

const KEY = 'proppath:v1';

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { accounts: [], activeId: null };
    const data = JSON.parse(raw);
    return { accounts: data.accounts || [], activeId: data.activeId || null };
  } catch {
    return { accounts: [], activeId: null };
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ accounts: state.accounts, activeId: state.activeId }));
    return true;
  } catch {
    return false;
  }
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Merge new trades into existing ones, deduplicating by id. */
export function mergeTrades(existing, incoming) {
  const byId = new Map(existing.map((t) => [t.id, t]));
  for (const t of incoming) byId.set(t.id, t);
  return [...byId.values()].sort((a, b) => a.exitTime - b.exitTime);
}
