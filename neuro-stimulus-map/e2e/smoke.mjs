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
// estimated heat per brain system, as shown in the "Right now" panel
const heatNow = (page) =>
  page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.now-bars li')].map((li) => [li.dataset.system, +li.dataset.heat])));
const step = async (name, fn) => { const t = Date.now(); await fn(); console.log(`ok ${name} (${Date.now() - t} ms)`); };
try {
  await step('landing', async () => {
    await page.goto(`http://localhost:${port}/`);
    await page.waitForSelector('text=Drop a video, song or podcast here');
    await page.waitForFunction(() => !document.querySelector('.brain-msg'), null, { timeout: 30000 });
    await page.screenshot({ path: `${OUT}/01-landing.png` });
  });
  await step('demo', async () => {
    await page.click('text=Evidence demo');
    await page.waitForSelector('text=DEMO DATA');
    // heat map (default view): play the demo and check that the estimate moves with it
    await page.waitForSelector('.now-card');
    await page.click('.vplayer button');
    await page.waitForTimeout(1500);
    const a = await heatNow(page);
    // wait (up to 5 s) for the estimate to move on with playback
    await page
      .waitForFunction((prev) => JSON.stringify(Object.fromEntries([...document.querySelectorAll('.now-bars li')].map((li) => [li.dataset.system, +li.dataset.heat]))) !== prev, JSON.stringify(a), { timeout: 5000 })
      .catch(() => undefined);
    const b = await heatNow(page);
    await page.click('.vplayer button');
    if (!(a.hearing > 0.1 && a.music > 0.1)) throw new Error(`demo music section should heat hearing and music: ${JSON.stringify(a)}`);
    if (JSON.stringify(a) === JSON.stringify(b)) throw new Error('heat did not change during playback');
    if (!(await page.locator('canvas.waves').count())) throw new Error('waves missing');
    console.log(`  heat at play: ${JSON.stringify(a)}`);
    await page.screenshot({ path: `${OUT}/02-demo-heat.png` });
    await page.getByRole('radio', { name: 'Evidence' }).click();
    await page.waitForSelector('.seg-block');
    await page.screenshot({ path: `${OUT}/02b-demo-evidence.png` });
    await page.click('.seg-block >> nth=1');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/03-demo-seg2.png` });
    // "Highlighted" lists each coloured area with a plain-language summary and the reason
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll('.hl-card')].map((c) => ({
        name: c.querySelector('.hl-title')?.textContent,
        summary: c.querySelector('.hl-summary')?.textContent?.trim(),
        reasons: c.querySelectorAll('.reasons li').length,
      })),
    );
    if (!cards.length || cards.some((c) => !c.summary || !c.reasons)) throw new Error(`highlighted list incomplete: ${JSON.stringify(cards)}`);
    console.log(`  ${cards.length} highlighted areas shown, first: ${cards[0].name}`);
    await page.click('.hl-card .hl-title >> nth=0');
    await page.waitForSelector('.region-panel');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/04-demo-region.png` });
    await page.click('text=All highlighted areas');
    await page.waitForSelector('.hl-card');
    // segment stepper
    const before = await page.textContent('.stepper-text strong');
    await page.click('button[aria-label="Next segment"]');
    const after = await page.textContent('.stepper-text strong');
    if (before === after) throw new Error('segment stepper did not move');
    await page.click('.seg-block >> nth=5');
    await page.getByRole('tab', { name: 'Reasoning' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/05-demo-seg6.png`, fullPage: true });
    await page.getByRole('radio', { name: 'Networks' }).click();
    await page.click('.seg-block >> nth=4');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/06-demo-networks.png` });
    await page.getByRole('radio', { name: 'Regions' }).click();
    await page.click('.seg-block >> nth=5');
    await page.click('.view-menu summary');
    await page.selectOption('select[aria-label="Show internal structures"]', 'cutaway');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/07-demo-cutaway.png` });
    await page.selectOption('select[aria-label="Cut orientation"]', 'x');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/07b-demo-cutaway-sagittal.png` });
    await page.selectOption('select[aria-label="Show internal structures"]', 'glass');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/07c-demo-glass.png` });
    await page.selectOption('select[aria-label="Show internal structures"]', 'none');
    await page.click('.view-menu summary');
    await page.getByRole('tab', { name: 'Features' }).click();
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
      // the Emotion view opens first; this test checks the heat map
      await page.waitForSelector('.emo-now', { timeout: 240000 });
      await page.getByRole('radio', { name: 'Heat map' }).click();
      await page.waitForSelector('.now-card');
      // seeking only takes effect once the player has loaded the file's metadata
      await page.waitForFunction(() => (document.querySelector('video, audio')?.readyState ?? 0) >= 1, null, { timeout: 30000 });
      // heat follows the file: seek into the speech (10 s) and music (30 s) parts of the fixtures
      const at = async (t) => {
        await page.evaluate((tt) => (document.querySelector('video, audio').currentTime = tt), t);
        // wait until the panel shows the new moment, then let the heat settle
        await page.waitForFunction((tt) => document.querySelector('.now-time')?.textContent === `0:${String(tt).padStart(2, '0')}`, t, { timeout: 10000 });
        await page.waitForTimeout(300);
        return heatNow(page);
      };
      const speech = await at(10);
      const music = await at(30);
      console.log(`  heat at 0:10 ${JSON.stringify(speech)}\n  heat at 0:30 ${JSON.stringify(music)}`);
      if (!(speech.voice > 0.1 && speech.voice > music.voice)) throw new Error('voices should be warmer in the speech part');
      if (!(music.music > 0.1 && music.music > speech.music)) throw new Error('music should be warmer in the music part');
      await page.screenshot({ path: `${OUT}/${shot}`, fullPage: true });
      await page.getByRole('radio', { name: 'Evidence' }).click();
      await page.waitForSelector('.seg-block');
      const segs = await page.evaluate(() => [...document.querySelectorAll('.seg-block')].map((b) => b.getAttribute('title')));
      const mods = [await page.textContent('.hl-basis')];
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
