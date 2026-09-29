// Design-review screenshots (desktop, tablet, phone; light and dark) of the built app.
// Run after `npx vite build`: node e2e/viewports.mjs  -> e2e/shots/review-*.png
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR ?? 'e2e/shots';
mkdirSync(OUT, { recursive: true });
const port = 4900 + Math.floor(Math.random() * 90);
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
const stop = () => {
  try {
    process.kill(-server.pid);
  } catch {}
};
process.on('exit', stop);
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));
const exe = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const ready = (page) => page.waitForFunction(() => document.querySelector('.brain-canvas canvas') && !document.querySelector('.brain-msg'), null, { timeout: 30000 });

try {
  for (const [w, h, name, dark, touch] of [
    [1440, 960, 'desktop', false, false],
    [1440, 960, 'desktop-dark', true, false],
    [820, 1180, 'tablet', false, true],
    [390, 844, 'phone', false, true],
    [390, 844, 'phone-dark', true, true],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light', hasTouch: touch, isMobile: touch && w < 800, deviceScaleFactor: touch ? 2 : 1 });
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    await page.goto(`http://localhost:${port}/`);
    await ready(page);
    // viewport-sized shots, plus the explanation panel scrolled into view on stacked layouts
    const shoot = async (tag) => {
      await page.screenshot({ path: `${OUT}/review-${name}-${tag}.png` });
      if (w < 1180) {
        await page.locator('.now-card, .explain-card, .intro').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${OUT}/review-${name}-${tag}-panel.png` });
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    };
    await shoot('1-landing');
    await page.click('text=Evidence demo');
    await page.waitForSelector('.now-card');
    // play the demo for a few seconds so the heat map and traces are moving
    await page.click('.vplayer button');
    await page.waitForTimeout(4200);
    await shoot('2-heat');
    await page.click('.vplayer button'); // pause
    await page.locator('.now-hot button').first().click();
    await page.waitForSelector('.region-panel');
    await page.waitForTimeout(300);
    await shoot('3-why');
    if (name === 'desktop' || name === 'phone') {
      await page.click('text=All highlighted areas');
      await page.waitForSelector('.hl-card');
      await shoot('4-evidence');
      await page.getByRole('radio', { name: 'Heat map' }).click();
      await page.locator('.brain-canvas').scrollIntoViewIfNeeded();
      await page.click('.view-menu summary');
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/review-${name}-5-view-menu.png` });
      await page.click('.view-menu summary');
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${name}: horizontal overflow ${overflow}px`);
    if (overflow > 0) errors.push(`${name}: horizontal overflow ${overflow}px`);
    await ctx.close();
  }
} finally {
  await browser.close();
  stop();
}
console.log('console errors:', errors.length ? errors : 'none');
if (errors.length) process.exit(1);
