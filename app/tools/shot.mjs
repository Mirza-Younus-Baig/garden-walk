// node tools/shot.mjs out.png "query string"   (expects vite dev on :5173)
import { chromium } from 'playwright';
const [,, out, query] = process.argv;
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 900, height: 900 } });
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[browser]', m.text().slice(0, 300)); });
await p.goto('http://localhost:5188/viewer.html?' + (query ?? ''), { waitUntil: 'load' });
await p.waitForFunction(() => window.__ready, null, { timeout: 120000 });
console.log(JSON.stringify(await p.evaluate(() => window.__info)));
await p.screenshot({ path: out });
await b.close();
