// node tools/shot_app.mjs out.png [steps as JSON]  e.g. '[{"click":[0.5,0.7]},{"wait":2500},{"shot":"a.png"}]'
import { chromium } from 'playwright';
const [,, out, stepsJson] = process.argv;
const steps = stepsJson ? JSON.parse(stepsJson) : [];
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +(process.env.VW||1280), height: +(process.env.VH||800) } });
p.on('console', m => { if (m.text().startsWith('field:')) console.log('[' + m.text() + ']'); else if (m.type() === 'error' || m.type() === 'warning') console.log('[browser:' + m.type() + ']', m.text().slice(0, 500)); });
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 500)));
await p.goto('http://localhost:5188/?' + (process.env.QS ?? ''), { waitUntil: 'load' });
await p.waitForFunction(() => window.__ready, null, { timeout: 180000 });
await p.waitForTimeout(1500);
for (const s of steps) {
  if (s.click) { const [fx, fy] = s.click; await p.mouse.click((+(process.env.VW||1280)) * fx, (+(process.env.VH||800)) * fy); }
  if (s.hold) { const [fx, fy, ms] = s.hold; await p.mouse.move((+(process.env.VW||1280)) * fx, (+(process.env.VH||800)) * fy); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up(); }
  if (s.move) { const [fx, fy] = s.move; await p.mouse.move((+(process.env.VW||1280)) * fx, (+(process.env.VH||800)) * fy); }
  if (s.wheel) { await p.mouse.wheel(0, s.wheel); }
  if (s.hour !== undefined) await p.evaluate((h) => { window.__sky.dayNight.clock.setPaused(true); window.__sky.dayNight.clock.setHour(h); }, s.hour);
  if (s.play) await p.evaluate(() => { window.__sky.dayNight.clock.setPaused(false); });
  if (s.cam) await p.evaluate((c) => { window.__debugCam = c; }, s.cam);
  if (s.nocam) await p.evaluate(() => { window.__debugCam = null; });
  if (s.wait) await p.waitForTimeout(s.wait);
  if (s.reset) await p.evaluate(() => { window.__ft = null; window.__p = null; });
  if (s.info) console.log('INFO', JSON.stringify(await p.evaluate(() => ({ fps: window.__fps, worstFrameMs: +window.__ft.max.toFixed(1), pct: (() => { const h = window.__ft.hist; let t = 0; for (const v of h) t += v; const q = (f) => { let c = 0; for (let i = 0; i < h.length; i++) { c += h[i]; if (c >= t * f) return i; } return 199; }; return { n: t, p50: q(0.5), p95: q(0.95), p99: q(0.99) }; })(), slowFrames: window.__ft.over, tris: window.__renderer.info.render.triangles, cam: window.__camera.position.toArray().map(v=>+v.toFixed(2)), camYaw: +window.__follow.yaw.toFixed(2), girl: window.__girl.pos.toArray().map(v => +v.toFixed(2)), yaw: +window.__girl.yaw.toFixed(2), speed: +window.__girl.speed.toFixed(2), plants: window.__field.stats(), sky: { time: window.__sky.dayNight.formatTime(), hour: +window.__sky.dayNight.hour.toFixed(3), sunEl: +window.__sky.dayNight.sunDir.y.toFixed(3), daylight: +window.__sky.dayNight.daylight.toFixed(3), stars: +window.__sky.dayNight.starAlpha.toFixed(3), sunI: +window.__sky.dayNight.sunIntensity.toFixed(2), moonI: +window.__sky.dayNight.moonIntensity.toFixed(2), exposure: +window.__sky.dayNight.exposure.toFixed(2) }, prof: window.__p, pr: window.__pr && +window.__pr.toFixed(2), vsync: window.__vsync && +window.__vsync.toFixed(1), target: window.__girl.target && window.__girl.target.toArray().map(v => +v.toFixed(2)) }))));
  if (s.shot) await p.screenshot({ path: s.shot });
}
const info = await p.evaluate(() => ({ fps: window.__fps, girl: window.__girl.pos.toArray().map(v => +v.toFixed(2)), speed: +window.__girl.speed.toFixed(2), calls: window.__renderer?.info?.render }));
console.log(JSON.stringify(info));
await p.screenshot({ path: out });
await b.close();
