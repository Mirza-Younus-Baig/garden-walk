// Shared Playwright harness for the test scripts: launch, wait for the garden to finish
// loading, and collect pass/fail lines.
import { createRequire } from 'node:module';

// playwright is a devDependency of the app, and these scripts sit outside it
const { chromium } = createRequire(new URL('../app/package.json', import.meta.url))('playwright');

const APP_URL = process.env.GARDEN_URL ?? 'http://localhost:5188/';
const results = [];
const open = [];

/**
 * Headless Chrome has no GPU here, so the meadow renders in software at about three
 * seconds a frame. Tests that only care about the UI pass `?nodaisy&...` to drop the
 * flower layers, which is the difference between 0.3 fps and something usable; anything
 * that needs a picture of the garden pays the full cost.
 */
export const LIGHT = 'nodaisy&nolily&norose&notulip&nosun&noshadow';

export async function openApp(query = '?dev', viewport = { width: 1280, height: 720 }) {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  open.push(browser);
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => console.error('  page error:', e.message));
  // Drop vite's HMR client. A run takes minutes at software-rendering speed, and any save
  // in the editor meanwhile reloads the page out from under it: the test would die with
  // "execution context was destroyed" through no fault of the code under test. Nothing in
  // the app uses import.meta.hot, so the client is dead weight here anyway.
  await page.route('**/@vite/client', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.goto(APP_URL + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await frame(page);
  return page;
}

/** Wait until the render loop has actually produced a frame. */
export const frame = (page, n = 2) =>
  page.evaluate((count) => new Promise((res) => {
    const tick = () => (--count > 0 ? requestAnimationFrame(tick) : res(null));
    requestAnimationFrame(tick);
  }), n);

export function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`);
}

export async function close() { for (const b of open) await b.close(); }

export function report(label) {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${label}: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILURES:'); for (const f of failed) console.log(`  - ${f.name}`); process.exit(1); }
}
