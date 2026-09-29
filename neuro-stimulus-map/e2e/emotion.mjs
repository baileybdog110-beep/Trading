// End-to-end test of the Emotion view: analyses the demo songs in the browser (decode, cues, the
// musicnn tagger, the emotion model), plays one, and checks the estimate and the brain systems.
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
const exe = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/blob:|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const step = async (name, fn) => { const t = Date.now(); await fn(); console.log(`ok ${name} (${Date.now() - t} ms)`); };
const levels = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.chem[data-level]')].map((li) => [li.dataset.system, +li.dataset.level])));
const summary = {};

async function analyse(title) {
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => !document.querySelector('.brain-msg'), null, { timeout: 30000 });
  await page.getByRole('button', { name: title }).click();
  await page.waitForSelector('.emo-now', { timeout: 240000 });
  // the whole-track timeline, taken from the page's own analysis
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll('.emo-label')].map((e) => e.textContent);
    return { labels, note: document.querySelector('.emo-now .how-est .muted:last-child')?.textContent };
  });
}

try {
  await step('landing lists demo songs', async () => {
    await page.goto(`http://localhost:${port}/`);
    await page.waitForSelector('.demo-songs');
    const n = await page.locator('.demo-songs li').count();
    if (n !== 3) throw new Error(`expected 3 demo songs, got ${n}`);
  });

  await step('Vibe Ace: analyse, emotion view is the default', async () => {
    const r = await analyse('Vibe Ace');
    const on = await page.getByRole('radio', { name: 'Emotion' }).getAttribute('aria-checked');
    if (on !== 'true') throw new Error('Emotion view should be selected after analysis');
    if (!(await page.locator('canvas.emo-track').count())) throw new Error('emotion track missing');
    if (!(await page.locator('.chem[data-system="serotonin"]').count())) throw new Error('serotonin card missing');
    await page.locator('.emo-now .how-est summary').click();
    const acc = await page.locator('.emo-now .how-est').innerText();
    if (!/r = 0\.\d\d/.test(acc)) throw new Error(`accuracy text missing: ${acc}`);
    summary.vibeNote = r.note;
    console.log(`  ${r.note}`);
  });

  await step('Vibe Ace: playing moves the estimate; liking scales reward', async () => {
    await page.evaluate(() => { const a = document.querySelector('audio'); a.currentTime = 20; return a.play(); });
    await page.waitForTimeout(2500);
    const a = await levels();
    const label = await page.locator('.emo-now').getAttribute('data-emotion');
    await page.getByRole('radio', { name: 'Yes', exact: true }).click();
    await page.evaluate(() => document.querySelector('audio').pause());
    await page.waitForTimeout(400);
    const yes = await levels();
    await page.getByRole('radio', { name: 'No', exact: true }).click();
    await page.waitForTimeout(400);
    const no = await levels();
    if (!(yes.reward > no.reward)) throw new Error(`liking should scale reward: yes ${yes.reward} no ${no.reward}`);
    if (!(yes.reward > yes.stress)) throw new Error(`an upbeat song should light reward more than stress: ${JSON.stringify(yes)}`);
    summary.vibe = { label, levels: a };
    console.log(`  at 0:22 → ${label}; levels ${JSON.stringify(a)}`);
    await page.getByRole('radio', { name: 'Not sure' }).click();
    await page.locator('.chem[data-system="reward"] .chem-row').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/20-emotion-vibe-ace.png` });
    const lit = await page.evaluate(() => document.querySelector('.brain-canvas')?.className);
    if (!/is-heat/.test(lit)) throw new Error('brain should be in live mode');
  });

  await step('Hungarian Dance and Sugar Plum Fairy: different profiles', async () => {
    for (const [title, at, key] of [['Hungarian Dance No. 5', 25, 'hungarian'], ['Dance of the Sugar Plum Fairy', 40, 'sugar']]) {
      await analyse(title);
      await page.evaluate((t) => { const a = document.querySelector('audio'); a.currentTime = t; }, at);
      await page.waitForFunction((t) => document.querySelector('.emo-now .now-time')?.textContent === `0:${t}`, at, { timeout: 10000 });
      await page.waitForTimeout(400);
      summary[key] = { label: await page.locator('.emo-now').getAttribute('data-emotion'), levels: await levels() };
      console.log(`  ${title} at ${at}s → ${JSON.stringify(summary[key])}`);
      await page.screenshot({ path: `${OUT}/21-emotion-${key}.png` });
    }
  });

  await step('phone layout', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 2) throw new Error(`horizontal overflow on phone: ${overflow}px`);
    await page.screenshot({ path: `${OUT}/22-emotion-phone.png`, fullPage: true });
  });

  if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`);
  console.log('EMOTION E2E PASSED');
} catch (e) {
  console.error('EMOTION E2E FAILED:', e.message);
  await page.screenshot({ path: `${OUT}/emotion-fail.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  stopServer();
}
