// Two-finger rules on a phone: which finger walks, which pinch zooms (src/mobile.ts).
//   node tools/touch_test.mjs        with `npm run dev` (or URL=… for a preview build)
// Exits non-zero if any case fails.
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:5188/?mode=birthday&touch';
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 960, height: 540 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'load' });
await p.waitForFunction(() => window.__ready, null, { timeout: 600000, polling: 1000 });
// stop drawing so event timing is real time, not software-GL frame time
await p.evaluate(() => { window.__bday.renderer.setAnimationLoop(null); });
const cdp = await ctx.newCDPSession(p);
const fingers = new Map();
const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers.entries()].map(([id, [x, y]]) => ({ x, y, id })) });
const down = async (id, x, y) => { fingers.set(id, [x, y]); await send('touchStart'); };
const move = async (id, x, y) => { fingers.set(id, [x, y]); await send('touchMove'); };
const up = async (id) => { const pts = [...fingers.entries()].filter(([k]) => k === id).map(([k, [x, y]]) => ({ x, y, id: k })); fingers.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [...fingers.entries()].map(([k, [x, y]]) => ({ x, y, id: k })) }); void pts; };
const wait = (ms) => p.waitForTimeout(ms);
const reset = () => p.evaluate(() => { const c = window.__bday.world.cam; c.distTarget = 2.6; });
const state = () => p.evaluate(() => ({ dist: +window.__bday.world.cam.distTarget.toFixed(3), joy: document.getElementById('joy')?.classList.contains('live') ?? null }));
const spreadApart = async (a, b, ax, bx, y) => { for (let k = 1; k <= 6; k++) { await move(a, ax + k * 15, y); await move(b, bx - k * 15, y); } };

const results = {};
// a first tap: the one-time fullscreen / orientation request on first touch is not part of any gesture
await down(9, 700, 100); await up(9); await wait(500);
// A: right finger first, the left one 80 ms later, then spread: a pinch
{ await reset(); const s0 = await state(); await down(1, 640, 270); await wait(80); await down(2, 380, 270); const mid = await state();
  await spreadApart(1, 2, 640, 380, 270); const s1 = await state(); await up(1); await up(2); await wait(100);
  results.A_rightThenLeftQuick = { from: s0.dist, to: s1.dist, zoomed: s1.dist !== s0.dist, joystick: mid.joy }; }
// B: right finger held (looking), then the left thumb: it walks
{ await down(1, 700, 270); await wait(600); await down(2, 200, 420); await move(2, 200, 360); const s = await state();
  await up(2); await up(1); await wait(100);
  results.B_rightHeldThenLeft = { joystick: s.joy }; }
// C: left finger first, the right one 80 ms later, then spread: still a pinch (the handover)
{ await reset(); const s0 = await state(); await down(1, 380, 270); await wait(80); await down(2, 640, 270); const mid = await state();
  await spreadApart(2, 1, 640, 380, 270); const s1 = await state(); await up(1); await up(2); await wait(100);
  results.C_leftThenRightQuick = { from: s0.dist, to: s1.dist, zoomed: s1.dist !== s0.dist, joystick: mid.joy }; }
// D: one thumb alone on the left walks
{ await down(1, 200, 420); await move(1, 200, 360); const s = await state(); await up(1);
  results.D_leftAlone = { joystick: s.joy }; }
// E: both fingers on the left, the second 80 ms after the first: a pinch, not a walk
{ await wait(300); await reset(); const s0 = await state(); await down(1, 300, 270); await wait(80); await down(2, 160, 270); const mid = await state();
  await spreadApart(1, 2, 300, 160, 270); const s1 = await state(); await up(1); await up(2);
  results.E_bothLeftQuick = { from: s0.dist, to: s1.dist, zoomed: s1.dist !== s0.dist, joystick: mid.joy }; }
const expect = { A_rightThenLeftQuick: { zoomed: true, joystick: false }, B_rightHeldThenLeft: { joystick: true },
  C_leftThenRightQuick: { zoomed: true, joystick: false }, D_leftAlone: { joystick: true }, E_bothLeftQuick: { zoomed: true, joystick: false } };
let failed = 0;
for (const [k, want] of Object.entries(expect)) {
  const ok = Object.entries(want).every(([f, v]) => results[k][f] === v);
  if (!ok) failed++;
  console.log(ok ? 'ok  ' : 'FAIL', k, JSON.stringify(results[k]));
}
await b.close();
process.exit(failed ? 1 : 0);
