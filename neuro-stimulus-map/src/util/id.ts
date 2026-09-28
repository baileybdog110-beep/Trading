/**
 * crypto.randomUUID only exists in secure contexts (HTTPS/localhost) and newer browsers;
 * opening the dev server from a phone over the local network uses plain http.
 */
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
