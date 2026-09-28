/**
 * True in the copy built for a sandboxed web viewer (`npm run build:hosted`). That viewer blocks
 * file downloads and requests to other sites, so exports become copy-to-clipboard and the two
 * optional network features (speech recognition, interpretation suggestions) are switched off.
 */
export const HOSTED = import.meta.env.VITE_HOSTED === '1';

export const HOSTED_NETWORK_NOTE =
  'Speech recognition and interpretation suggestions are not available in this hosted copy, because its viewer blocks requests to other sites. Run the app yourself to use them (see the README).';

/**
 * Fetches a binary file. The hosted viewer does not serve binary file types, so the hosted build
 * publishes each one as base64 text next to the page (`<name>.b64.txt`, see scripts/hosted).
 */
export async function fetchBinary(url: string): Promise<ArrayBuffer> {
  const res = await fetch(HOSTED ? `${url}.b64.txt` : url);
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
  if (!HOSTED) return res.arrayBuffer();
  const bin = atob((await res.text()).trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
