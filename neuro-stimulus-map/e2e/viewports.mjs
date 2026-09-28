import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const port = 4900 + Math.floor(Math.random() * 90);
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
const stop = () => { try { process.kill(-server.pid); } catch {} };
process.on('exit', stop);
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('Local') && r()));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [w, h, name, dark] of [[390, 844, 'phone', false], [820, 1180, 'tablet', false], [1500, 1000, 'desktop-dark', true]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light' });
  await page.goto(`http://localhost:${port}/`);
  await page.click('text=Explore demo data');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `e2e/shots/14-${name}.png` });
  await page.close();
}
await browser.close(); stop();
