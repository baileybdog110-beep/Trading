// End-to-end smoke test: serves the built app, loads demo data and a synthetic video,
// takes screenshots, and fails on console errors.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR ?? 'e2e/shots';
mkdirSync(OUT, { recursive: true });
const port = 4100 + Math.floor(Math.random() * 800);
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
const stopServer = () => { try { process.kill(-server.pid); } catch {} };
process.on('exit', stopServer);
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));
// Use CHROMIUM_PATH if set, else a preinstalled Chromium if present, else Playwright's own browser.
const exe = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/blob:|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const step = async (name, fn) => { const t = Date.now(); await fn(); console.log(`ok ${name} (${Date.now() - t} ms)`); };
try {
  await step('landing', async () => {
    await page.goto(`http://localhost:${port}/`);
    await page.waitForSelector('text=Drop a video, song or podcast here');
    await page.waitForFunction(() => !document.querySelector('.brain-msg'), null, { timeout: 30000 });
    await page.screenshot({ path: `${OUT}/01-landing.png` });
  });
  await step('demo', async () => {
    await page.click('text=Explore demo data');
    await page.waitForSelector('text=DEMO DATA');
    await page.screenshot({ path: `${OUT}/02-demo-seg1.png` });
    await page.click('.seg-block >> nth=1');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/03-demo-seg2.png` });
    await page.click('.region-table .linklike >> nth=0');
    await page.waitForSelector('.region-panel');
    await page.screenshot({ path: `${OUT}/04-demo-region.png` });
    await page.click('.seg-block >> nth=5');
    await page.click('text=Reasoning');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/05-demo-seg6.png`, fullPage: true });
    await page.click('text=Distributed networks');
    await page.click('.seg-block >> nth=4');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/06-demo-networks.png` });
    await page.click('text=Anatomical regions');
    await page.selectOption('select[aria-label="Show internal structures"]', 'cutaway');
    await page.click('.seg-block >> nth=5');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/07-demo-cutaway.png` });
    await page.selectOption('select[aria-label="Cut orientation"]', 'x');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/07b-demo-cutaway-sagittal.png` });
    await page.selectOption('select[aria-label="Show internal structures"]', 'glass');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/07c-demo-glass.png` });
    await page.selectOption('select[aria-label="Show internal structures"]', 'none');
    await page.click('text=Features');
    await page.screenshot({ path: `${OUT}/08-demo-features.png` });
    await page.click('text=Evidence database');
    await page.waitForSelector('.evidence-table');
    await page.screenshot({ path: `${OUT}/09-evidence.png` });
    await page.click('.modal-head .icon-btn');
    await page.click('text=How to read this map');
    await page.screenshot({ path: `${OUT}/09b-about.png` });
    await page.click('.modal-head .icon-btn');
    for (const [w, h, name] of [[820, 1180, 'tablet'], [390, 844, 'phone']]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/13-${name}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`  ${name}: horizontal overflow ${overflow}px`);
    }
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.click('text=Close demo');
  });
  const analyse = async (files, shot, expectSegments = true) => {
    await page.setInputFiles('input[type=file]', files);
    await page.click('text=Analyse locally');
    if (expectSegments) {
      await page.waitForSelector('.seg-block', { timeout: 180000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${shot}`, fullPage: true });
      const segs = await page.evaluate(() => [...document.querySelectorAll('.seg-block')].map((b) => b.getAttribute('title')));
      const mods = await page.evaluate(() => [...document.querySelectorAll('.mod')].map((m) => m.textContent));
      console.log(`  segments:\n    ${segs.join('\n    ')}\n  modalities: ${mods.join(' | ')}`);
      await page.click('text=Delete media & results');
      await page.waitForSelector('text=Drop a video, song or podcast here');
    } else {
      await page.waitForSelector('.upload .error', { timeout: 60000 });
      console.log('  error shown:', (await page.textContent('.upload .error')).slice(0, 160));
    }
  };
  if (existsSync('tests/fixtures/clip.webm')) {
    await step('analyse clip.webm + srt (video)', () => analyse(['tests/fixtures/clip.webm', 'tests/fixtures/program.srt'], '10-webm.png'));
    await step('analyse program.mp3 (audio only, chunked MP3)', () => analyse(['tests/fixtures/program.mp3'], '11-mp3.png'));
    await step('analyse program.wav (streamed WAV)', () => analyse(['tests/fixtures/program.wav'], '12-wav.png'));
    await step('clip.mp4 in a browser without H.264/AAC shows a clear error', () => analyse(['tests/fixtures/clip.mp4'], '', false));
  }
} finally {
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
  stopServer();
}
if (errors.length) process.exit(1);
