// Screenshots of the birthday room for review.
//   node tools/birthday_shot.mjs <outdir> [script]
// script is a |-separated list of steps run after load:
//   wait:<s>  shot:<name>  act:<id>[:<i>]  key:<code>:<seconds>  eval:<js>  evalf:<file.js>  until:<js>
// Env: URL (default http://localhost:5188/?mode=birthday), W, H, MOBILE=1 for a phone, STEPS.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const out = process.argv[2] ?? '.';
const script = (process.argv[3] ?? 'wait:2|shot:start').split('|').filter(Boolean);
const URL = process.env.URL ?? 'http://localhost:5188/?mode=birthday';
const W = +(process.env.W ?? 1280), H = +(process.env.H ?? 720);
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext(process.env.MOBILE ? { viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => { errors.push(String(e)); console.log('[pageerror]', String(e)); });
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
const t0 = Date.now();
await p.goto(URL, { waitUntil: 'load' });
await p.waitForFunction(() => window.__ready, null, { timeout: 600000, polling: 1000 });
console.log('ready in', ((Date.now() - t0) / 1000).toFixed(1), 's');
// STEPS=n: n simulation steps per drawn frame (software GL draws slowly)
if (process.env.STEPS) await p.evaluate((n) => { window.__steps = n; }, +process.env.STEPS);
for (const step of script) {
  const [kind, ...rest] = step.split(':');
  const arg = rest.join(':');
  if (kind === 'wait') await p.waitForTimeout(+arg * 1000);
  else if (kind === 'shot') {
    // freeze game time while the (slow, software-rendered) capture runs
    await p.evaluate(() => { window.__pause = true; });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${arg}.png`, timeout: 300000 });
    await p.evaluate(() => { window.__pause = false; });
    console.log('shot', arg);
  }
  else if (kind === 'act') { const [id, i] = arg.split(':'); await p.evaluate(([id, i]) => window.__bday.act(id, +(i ?? 0)), [id, i ?? '0']); }
  else if (kind === 'key') { const [code, s] = arg.split(':'); await p.keyboard.down(code); await p.waitForTimeout(+s * 1000); await p.keyboard.up(code); }
  else if (kind === 'eval') console.log('eval:', JSON.stringify(await p.evaluate(arg)));
  else if (kind === 'evalf') console.log('eval:', JSON.stringify(await p.evaluate(readFileSync(arg, 'utf8'))));
  else if (kind === 'until') await p.waitForFunction(arg, null, { timeout: 600000, polling: 500 });
}
console.log('errors', errors.length);
await b.close();
