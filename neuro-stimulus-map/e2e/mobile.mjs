// Mobile/tablet end-to-end test: emulates iPhone and iPad (viewport, touch, mobile UA) in
// Chromium, served over a NON-secure LAN origin (like opening the dev server from a phone on
// the local network), taps the brain and timeline, and analyses a video.
// Note: this is Chromium emulation, not real iOS Safari/WebKit.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

const OUT = process.env.SHOT_DIR ?? 'e2e/shots';
mkdirSync(OUT, { recursive: true });
const port = 4100 + Math.floor(Math.random() * 800);
// A LAN address, like a phone opening the dev server over Wi-Fi: plain http, not a secure context.
const lan = Object.values(networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal)?.address;
if (!lan) throw new Error('no non-loopback IPv4 address available for this test');
const server = spawn('npx', ['vite', 'preview', '--host', lan, '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
const stop = () => {
  try {
    process.kill(-server.pid);
  } catch {}
};
process.on('exit', stop);
await new Promise((r) => server.stdout.on('data', (d) => /Local|Network/.test(String(d)) && r()));
const exe = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const origin = `http://${lan}:${port}`; // not localhost -> not a secure context
const errors = [];
const step = async (name, fn) => {
  const t = Date.now();
  await fn();
  console.log(`ok ${name} (${Date.now() - t} ms)`);
};

try {
  for (const [label, device] of [
    ['iphone', devices['iPhone 13']],
    ['ipad', devices['iPad Pro 11']],
    ['ipad-landscape', devices['iPad Pro 11 landscape']],
  ]) {
    const ctx = await browser.newContext({ ...device });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/blob:|Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
    await step(`${label}: demo, tap brain, details, timeline, modal`, async () => {
      await page.goto(`${origin}/`);
      const secure = await page.evaluate(() => window.isSecureContext);
      if (secure) throw new Error('expected a non-secure context for this test');
      await page.waitForFunction(() => !document.querySelector('.brain-msg'), null, { timeout: 30000 });
      await page.tap('text=Explore demo data');
      await page.waitForSelector('text=DEMO DATA');
      // tap near the temporal lobe of the default left lateral view
      await page.locator('.brain-canvas').scrollIntoViewIfNeeded();
      const b = await page.locator('.brain-canvas').boundingBox();
      await page.touchscreen.tap(b.x + b.width * 0.45, b.y + b.height * 0.6);
      await page.waitForSelector('.tap-card', { timeout: 5000 }).catch(async (e) => {
        await page.screenshot({ path: `${OUT}/20-${label}-tap-failed.png` });
        throw e;
      });
      await page.screenshot({ path: `${OUT}/20-${label}-tap.png` });
      await page.tap('.tap-card >> text=Details');
      await page.waitForSelector('.region-panel');
      await page.tap('text=All highlighted areas');
      await page.tap('.hl-card .hl-title >> nth=0');
      await page.waitForSelector('.region-panel');
      if (label === 'iphone') {
        await page.tap('text=Show on the brain');
        await page.waitForTimeout(600);
        const top = await page.locator('.col-center').evaluate((el) => el.getBoundingClientRect().top);
        if (Math.abs(top) > 40) throw new Error(`"Show on the brain" did not bring the brain into view (top ${top})`);
      }
      await page.tap('.seg-block >> nth=3');
      await page.waitForTimeout(200);
      await page.tap('text=Evidence database');
      await page.waitForSelector('.evidence-table');
      await page.screenshot({ path: `${OUT}/20-${label}-modal.png` });
      const r = await page.evaluate(() => { const m = document.querySelector('.modal').getBoundingClientRect(); const b = document.querySelector('.modal-head .icon-btn').getBoundingClientRect(); return { modal: [m.top, m.bottom, m.height], btn: [b.top, b.left, b.width], vh: innerHeight, vw: innerWidth }; });
      console.log('  modal geometry', JSON.stringify(r));
      await page.tap('.modal-head .icon-btn');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) throw new Error(`horizontal overflow ${overflow}px`);
      const smallControls = await page.evaluate(() =>
        [...document.querySelectorAll('select, input[type=password]')].filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length,
      );
      if (smallControls) throw new Error(`${smallControls} form controls below 16px (iOS would zoom on focus)`);
      await page.screenshot({ path: `${OUT}/21-${label}-demo.png` });
      await page.tap('text=Close demo');
    });
    if (label === 'iphone' && existsSync('tests/fixtures/clip.webm')) {
      await step('iphone: analyse clip.webm (non-secure origin, touch)', async () => {
        await page.setInputFiles('input[type=file]', ['tests/fixtures/clip.webm', 'tests/fixtures/program.srt']);
        await page.tap('text=Analyse locally');
        await page.waitForSelector('.seg-block', { timeout: 180000 });
        const n = await page.locator('.seg-block').count();
        console.log(`  ${n} segments`);
        await page.screenshot({ path: `${OUT}/22-iphone-analysis.png` });
        await page.tap('text=Delete media & results');
      });
    }
    await ctx.close();
  }
} finally {
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
  stop();
}
if (errors.length) process.exit(1);
