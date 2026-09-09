// Runs one full 6-minute simulated day at speed 1 and checks that simulated time tracks
// real elapsed time, that nothing jumps at the midnight wrap, and that frames stay even.
import { chromium } from 'playwright';
const fmtLive = (h) => `${String(Math.floor(h)).padStart(2,'0')}:${String(Math.floor((h%1)*60)).padStart(2,'0')}`;
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto('http://localhost:5188/', { waitUntil: 'load' });
await p.waitForFunction(() => window.__ready, null, { timeout: 180000 });
await p.evaluate(() => { window.__sky.dayNight.clock.setHour(23.4); window.__ft = null; });
const t0 = Date.now();
const samples = [];
let prev = null, maxJump = 0, jumpAt = '';
for (let i = 0; i < 76; i++) {
  await p.waitForTimeout(5000);
  const s = await p.evaluate(() => {
    const d = window.__sky.dayNight;
    return { hour: d.hour, el: d.sunDir.y, dl: d.daylight, sunI: d.sunIntensity, moonI: d.moonIntensity,
             star: d.starAlpha, exp: d.exposure, fps: window.__fps };
  });
  s.real = (Date.now() - t0) / 1000;
  if (prev) {
    // elevation is the master signal: a discontinuity there means a visual jump
    const dtHour = ((s.hour - prev.hour) + 24) % 24;
    const expected = (s.real - prev.real) / 360 * 24;
    const drift = Math.abs(dtHour - expected);
    if (drift > maxJump) { maxJump = drift; jumpAt = `${prev.hour.toFixed(2)}->${s.hour.toFixed(2)}`; }
  }
  prev = s;
  samples.push(s);
  if (i % 12 === 0) process.stdout.write(`  ..${s.real.toFixed(0)}s ${fmtLive(s.hour)}\n`);
}
const fmt = (h) => `${String(Math.floor(h)).padStart(2,'0')}:${String(Math.floor((h%1)*60)).padStart(2,'0')}`;
console.log('sample  real(s)   time   sunEl  daylight  sunI  moonI  stars  exp   fps');
for (let i = 0; i < samples.length; i += 3) {
  const s = samples[i];
  console.log(`${String(i).padStart(4)}  ${s.real.toFixed(1).padStart(7)}  ${fmt(s.hour)}  ${s.el.toFixed(3).padStart(6)}  ${s.dl.toFixed(3).padStart(8)}  ${s.sunI.toFixed(2).padStart(4)}  ${s.moonI.toFixed(2).padStart(5)}  ${s.star.toFixed(2).padStart(5)}  ${s.exp.toFixed(2)}  ${(s.fps||0).toFixed(0).padStart(4)}`);
}
const ft = await p.evaluate(() => { const h = window.__ft.hist; let t = 0; for (const v of h) t += v; const q = f => { let c = 0; for (let i = 0; i < h.length; i++) { c += h[i]; if (c >= t*f) return i; } return 199; }; return { n: t, p50: q(.5), p95: q(.95), p99: q(.99), max: +window.__ft.max.toFixed(1), over: window.__ft.over }; });
console.log('\nelapsed real seconds:', ((Date.now()-t0)/1000).toFixed(1), ' simulated hours covered:', (samples.length*5/360*24).toFixed(2));
console.log('max clock drift between samples (sim hours):', maxJump.toFixed(4), jumpAt);
console.log('frame times:', JSON.stringify(ft));
console.log('errors:', errors.length ? errors.slice(0,5) : 'none');
await b.close();
