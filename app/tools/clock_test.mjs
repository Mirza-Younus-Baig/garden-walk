import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const p = await b.newPage({ viewport: { width: 1024, height: 640 } });
await p.goto('http://localhost:5188/?dev', { waitUntil: 'load' });
await p.waitForFunction(() => window.__ready, null, { timeout: 180000 });
// clock.hour is the live value; dayNight.hour is only refreshed on the next frame
const state = () => p.evaluate(() => ({ hour: +window.__sky.dayNight.clock.hour.toFixed(4), paused: window.__sky.dayNight.clock.paused, speed: window.__sky.dayNight.clock.speed }));
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);

// 1. one real second must equal four simulated minutes (24h / 6min)
await p.evaluate(() => window.__sky.dayNight.clock.setHour(10));
const a = await state(); await p.waitForTimeout(3000); const c = await state();
const simMin = (c.hour - a.hour) * 60;
ok('1 real s = 4 sim min', Math.abs(simMin / 3 - 4) < 0.15, `measured ${(simMin / 3).toFixed(3)} min/s`);

// 2. pause freezes the clock, resume continues from where it stopped
await p.click('button[data-action="toggle"]');
const pa = await state(); await p.waitForTimeout(1500); const pb = await state();
ok('pause freezes time', pa.paused && pb.hour === pa.hour, `${pa.hour} -> ${pb.hour}`);
await p.click('button[data-action="toggle"]');
await p.waitForTimeout(600); const pc = await state();
ok('resume continues', !pc.paused && pc.hour > pb.hour, `${pb.hour} -> ${pc.hour}`);

// 3. speed multiplies the rate without moving the clock
await p.click('button[data-action="speed"][data-value="5"]');
const s0 = await state(); await p.waitForTimeout(2000); const s1 = await state();
const rate = (s1.hour - s0.hour) / 2;
ok('speed x5 rate', s1.speed === 5 && Math.abs(rate / (24 / 360) - 5) < 0.4, `${(rate / (24 / 360)).toFixed(2)}x`);
await p.click('button[data-action="speed"][data-value="1"]');

// 4. seek buttons
for (const [label, hour] of [['Sunrise', 6], ['Noon', 12], ['Sunset', 18], ['Midnight', 0]]) {
  await p.click(`button[data-action="hour"][data-value="${hour}"]`);
  const st = await state();
  ok(`seek ${label}`, Math.abs(((st.hour - hour) + 24) % 24) < 0.05, `${st.hour}`);
}

// 5. midnight wrap must be continuous in every driven quantity
const probe = (h) => p.evaluate((hh) => {
  const d = window.__sky.dayNight;
  d.clock.setPaused(true); d.clock.setHour(hh); d.update();
  return { el: d.sunDir.y, x: d.sunDir.x, z: d.sunDir.z, dl: d.daylight, star: d.starAlpha,
           exp: d.exposure, sunI: d.sunIntensity, moonI: d.moonIntensity,
           zen: d.zenith.getHex(), hor: d.horizon.getHex() };
}, h);
const before = await probe(23.9999), after = await probe(0.0001);
const dv = Math.max(Math.abs(before.el - after.el), Math.abs(before.x - after.x), Math.abs(before.z - after.z),
                    Math.abs(before.dl - after.dl), Math.abs(before.star - after.star),
                    Math.abs(before.exp - after.exp), Math.abs(before.sunI - after.sunI), Math.abs(before.moonI - after.moonI));
ok('midnight wrap continuous', dv < 1e-3 && before.zen === after.zen && before.hor === after.hor, `max delta ${dv.toExponential(2)}`);

// 6. reset restores speed 1, running, at sunrise
await p.click('button[data-action="reset"]');
const r = await state();
ok('reset', !r.paused && r.speed === 1 && Math.abs(r.hour - 6) < 0.05, `hour ${r.hour}`);

// 7. no listener or element accumulation from the UI
const counts = await p.evaluate(() => ({ buttons: document.querySelectorAll('button').length, divs: document.querySelectorAll('body > div').length }));
ok('no DOM growth', counts.buttons === 9, JSON.stringify(counts));
await b.close();
