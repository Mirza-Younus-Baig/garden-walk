// node mobile_test.mjs <outdir>  — emulated phone (portrait + landscape) and desktop regression
import { chromium } from 'playwright';
const out = process.argv[2];
const URL = 'http://localhost:5188/?noclock&birdseed=3';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

async function phone(name, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('[pageerror]', String(e)));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready, null, { timeout: 180000 });
  await p.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const state = () => p.evaluate(() => ({
    cls: document.documentElement.className, canvas: [window.__renderer.domElement.clientWidth, window.__renderer.domElement.clientHeight],
    aspect: +window.__camera.aspect.toFixed(3), speed: +window.__girl.speed.toFixed(2), pos: window.__girl.pos.toArray().map(v => +v.toFixed(2)),
    zoom: +window.__follow.zoomTarget.toFixed(3), joy: (() => { const r = document.getElementById('joy')?.getBoundingClientRect(); return r && [r.x, r.y, r.width, r.height].map(Math.round); })(),
    hint: getComputedStyle(document.querySelector('#hint .touch-only') ?? document.body).display,
  }));
  console.log(name, 'initial', JSON.stringify(await state()));
  await p.screenshot({ path: `${out}/${name}-0.png` });

  const rotated = h > w;
  // stage coords -> screen coords (inverse of mobile.ts toStage)
  const S = (sx, sy) => rotated ? [w - sy, sx] : [sx, sy];
  const stageH = rotated ? w : h;
  const j0 = [110, stageH - 100];
  // walk: 60% forward
  await touch('touchStart', [S(...j0)]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [S(j0[0], j0[1] - 5 * i)]); await p.waitForTimeout(16); }
  await p.waitForTimeout(1800);
  console.log(name, 'walk', JSON.stringify(await state()));
  await p.screenshot({ path: `${out}/${name}-walk.png` });
  // run: push to the rim
  await touch('touchMove', [S(j0[0] + 10, j0[1] - 90)]);
  await p.waitForTimeout(1800);
  console.log(name, 'run', JSON.stringify(await state()));
  await p.screenshot({ path: `${out}/${name}-run.png` });
  await touch('touchEnd', []);
  await p.waitForTimeout(1500);
  console.log(name, 'released', JSON.stringify(await state()));
  // pinch on the right half: fingers apart -> zoom in (zoomTarget falls)
  const sw = rotated ? h : w;
  const c = [sw * 0.72, stageH * 0.5];
  await touch('touchStart', [S(c[0] - 30, c[1]), S(c[0] + 30, c[1])]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [S(c[0] - 30 - 10 * i, c[1]), S(c[0] + 30 + 10 * i, c[1])]); await p.waitForTimeout(16); }
  await touch('touchEnd', []);
  await p.waitForTimeout(800);
  console.log(name, 'pinch-in', JSON.stringify(await state()));
  await p.screenshot({ path: `${out}/${name}-pinch.png` });
  await ctx.close();
}

async function desktop() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('[pageerror]', String(e)));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__ready, null, { timeout: 180000 });
  await p.waitForTimeout(2500);
  const st = () => p.evaluate(() => ({ cls: document.documentElement.className, joy: !!document.getElementById('joy'),
    canvas: [window.__renderer.domElement.clientWidth, window.__renderer.domElement.clientHeight], pr: window.__pr,
    lod: window.__cfg.lod.daisy, speed: +window.__girl.speed.toFixed(2),
    // the hint is removed once she walks
    keyHint: document.querySelector('#hint .key-only') && getComputedStyle(document.querySelector('#hint .key-only')).display,
    touchHint: document.querySelector('#hint .touch-only') && getComputedStyle(document.querySelector('#hint .touch-only')).display }));
  console.log('desktop initial', JSON.stringify(await st()));
  await p.screenshot({ path: `${out}/desktop-0.png` });
  await p.keyboard.down('KeyW'); await p.waitForTimeout(1500);
  console.log('desktop walk', JSON.stringify(await st()));
  await p.keyboard.up('KeyW');
  await ctx.close();
}

const which = process.argv[3] ?? 'all';
if (which === 'all' || which === 'portrait') await phone('portrait', 390, 844);
if (which === 'all' || which === 'landscape') await phone('landscape', 844, 390);
if (which === 'all' || which === 'desktop') await desktop();
await b.close();
