// Checks the hosted build (npm run build:hosted) under a strict Content-Security-Policy like a
// sandboxed viewer's: no eval, no requests to other sites, page wrapped in the viewer's skeleton.
// Runs the demo, copies the export, and analyses a video with faces on.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = 'dist-hosted';
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join('; ');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain' };
// Serve only what gets published (scripts/hosted/make_page.mjs), like the viewer does.
const published = JSON.parse(readFileSync(join(ROOT, 'files.json'), 'utf8'));
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style></head><body>${readFileSync(join(ROOT, 'page.html'), 'utf8')}</body></html>`;
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': CSP });
    return res.end(page);
  }
  const file = published[normalize(path).replace(/^([/\\])+/, '')];
  if (!file || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const exe = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const problems = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  // Disposing the hidden sampling <video> aborts its blob: request; Chromium logs that as a failed load.
  // The stand-in skeleton has no icon, so the browser also asks for /favicon.ico.
  const benign = (url) => url.startsWith('blob:') || url.endsWith('/favicon.ico');
  p.on('console', (m) => m.type() === 'error' && !benign(m.location().url ?? '') && problems.push(`console: ${m.text()} @ ${m.location().url}`));
  p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  p.on('requestfailed', (r) => !benign(r.url()) && problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  p.on('response', (r) => r.status() >= 400 && problems.push(`http ${r.status()}: ${r.url()}`));
  p.on('request', (r) => !r.url().startsWith(origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:') && problems.push(`external request: ${r.url()}`));
  await p.goto(origin);
  await p.getByRole('button', { name: /Explore demo data/ }).click();
  await p.waitForSelector('.seg-block', { timeout: 30000 });
  await p.waitForSelector('canvas', { timeout: 30000 });
  // Atlas meshes arrive as base64 text in the hosted build; wait until they are parsed.
  await p.waitForFunction(() => !document.querySelector('.brain-msg'), null, { timeout: 30000 });
  await p.getByRole('button', { name: /Copy analysis \(JSON\)/ }).click();
  await p.getByRole('button', { name: 'Copied' }).waitFor({ timeout: 5000 });
  const copied = JSON.parse(await p.evaluate(() => navigator.clipboard.readText()));
  if (!copied.mappings?.length) problems.push('copied export has no mappings');
  console.log('ok demo (atlas loaded) + copy export');

  await p.click('text=Close demo');
  await p.setInputFiles('input[type=file]', 'tests/fixtures/clip.webm');
  const faces = p.getByLabel(/Detect whether faces are visible/);
  if (!(await faces.isChecked())) await faces.check();
  await p.click('text=Analyse locally');
  await p.waitForSelector('.seg-block', { timeout: 180000 });
  const hostedNote = await p.getByText(/not available in this hosted copy/).count();
  if (!hostedNote) problems.push('hosted note missing after analysis');
  console.log(`ok analyse clip.webm with faces (${await p.locator('.seg-block').count()} segments)`);
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('no CSP violations, external requests or console errors');
