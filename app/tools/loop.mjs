// Learning-loop harness: scripted idle / walk / turn / stop / run, with per-phase frame
// stats, per-batch triangle counts, camera smoothness, and screenshots.
// usage: node tools/loop.mjs <outdir> [tag]    env: QS (query flags, e.g. "pr=1.0&prof"), VW, VH, PORT
import { chromium } from 'playwright';
import fs from 'fs';
const [,, outDir, tag = 'run'] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const VW = +(process.env.VW || 1600), VH = +(process.env.VH || 1000);
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: VW, height: VH } });
p.on('response', (r) => { if (r.status() >= 400) console.log('[http ' + r.status() + ']', r.url()); });
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
p.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 600)); });
await p.goto(`http://localhost:${process.env.PORT || 5188}/?` + (process.env.QS ?? ''), { waitUntil: 'load' });
await p.waitForFunction(() => window.__ready, null, { timeout: 180000 });
await p.evaluate(() => { const c = window.__sky.dayNight.clock; c.setPaused(true); c.setHour(+(new URLSearchParams(location.search).get('hour') ?? 16)); });

// per-frame trace of the things that read as "smooth" or not (reinstalled after a reload)
const installTrace = () => p.evaluate(() => {
  const w = window; if (w.__trace) return; w.__trace = [];
  const tick = (ts) => {
    const c = w.__camera.position, g = w.__girl;
    w.__trace.push([ts, c.x, c.y, c.z, g.pos.x, g.pos.z, g.yaw, g.speed]);
    if (w.__trace.length > 20000) w.__trace.length = 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await installTrace();
await p.waitForTimeout(2500);

const tris = () => p.evaluate(() => {
  const out = {};
  window.__scene.traverse((o) => {
    if (!o.isBatchedMesh) return;
    let t = 0, n = 0;
    const ii = o._instanceInfo, gi = o._geometryInfo;
    for (const inst of ii) {
      if (!inst.active || !inst.visible) continue;
      const g = gi[inst.geometryIndex]; t += (g.indexCount > 0 ? g.indexCount : g.vertexCount) / 3; n++;
    }
    out[o.name] = [n, Math.round(t / 1000) + 'k'];
  });
  return out;
});

const phase = async (name, fn, ms) => {
  await p.waitForFunction(() => window.__ready, null, { timeout: 180000 });
  await installTrace();
  await p.evaluate(() => { window.__ft = null; window.__p = null; window.__trace.length = 0; });
  await fn();
  await p.waitForTimeout(ms);
  const r = await p.evaluate(() => {
    const h = window.__ft.hist; let t = 0; for (const v of h) t += v;
    const q = (f) => { let c = 0; for (let i = 0; i < h.length; i++) { c += h[i]; if (c >= t * f) return i; } return 199; };
    // camera jerk: second difference of position per frame, normalised by dt^2 (m/s^2 swings)
    const tr = window.__trace; let jerk = 0, jn = 0, yawJ = 0;
    for (let i = 2; i < tr.length; i++) {
      const dt = (tr[i][0] - tr[i - 2][0]) / 2000; if (dt <= 0) continue;
      const ax = (tr[i][1] - 2 * tr[i - 1][1] + tr[i - 2][1]) / (dt * dt);
      const ay = (tr[i][2] - 2 * tr[i - 1][2] + tr[i - 2][2]) / (dt * dt);
      const az = (tr[i][3] - 2 * tr[i - 1][3] + tr[i - 2][3]) / (dt * dt);
      jerk = Math.max(jerk, Math.hypot(ax, ay, az)); jn++;
      let d1 = tr[i][6] - tr[i - 1][6], d0 = tr[i - 1][6] - tr[i - 2][6];
      d1 = Math.atan2(Math.sin(d1), Math.cos(d1)); d0 = Math.atan2(Math.sin(d0), Math.cos(d0));
      yawJ = Math.max(yawJ, Math.abs(d1 - d0) / (dt * dt));
    }
    return { n: t, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +window.__ft.max.toFixed(1), over33: window.__ft.over,
      pr: +(window.__pr ?? 0).toFixed(2), camAccMax: +jerk.toFixed(1), yawAccMax: +yawJ.toFixed(1),
      tris: (window.__renderer.info.render.triangles / 1e6).toFixed(2) + 'M', calls: window.__renderer.info.render.calls,
      girl: window.__girl.pos.toArray().map((v) => +v.toFixed(2)), speed: +window.__girl.speed.toFixed(2), prof: window.__p && Object.fromEntries(Object.entries(window.__p).map(([k, v]) => [k, +(+v).toFixed(1)])) };
  });
  console.log(name.padEnd(8), JSON.stringify(r));
  await p.screenshot({ path: `${outDir}/${tag}_${name}.png` });
  return r;
};
const key = (k, down) => (down ? p.keyboard.down(k) : p.keyboard.up(k));

await phase('idle', async () => {}, 3500);
console.log('batches ', JSON.stringify(await tris()));
await phase('walk', async () => key('KeyW', true), 3000);
await phase('turn', async () => key('KeyD', true), 1400);
await phase('stop', async () => { await key('KeyD', false); await key('KeyW', false); }, 1600);
await phase('run', async () => { await key('ShiftLeft', true); await key('KeyW', true); }, 2500);
await phase('halt', async () => { await key('KeyW', false); await key('ShiftLeft', false); }, 1800);
// close-up: the girl among the flowers
await p.evaluate(() => { const f = window.__follow; f.zoom = 0.55; });
await phase('close', async () => {}, 1800);
await b.close();
