// Asserts the day/night clock: cycle length, the hour mapping, and that the simulated day
// really advances at 24 h per DAY_CYCLE_DURATION_MS of wall time.
//
//   node tools/clock_test.mjs          (needs `npm run dev` on port 5188)
import { openApp, check, report, close } from './harness.mjs';

const EXPECTED_CYCLE_MS = 3 * 60 * 1000;

const page = await openApp();

const cycleMs = await page.evaluate(() => window.__sky.dayNight.clock.cycleMs);
check('cycle length is 3 minutes', cycleMs === EXPECTED_CYCLE_MS, `${cycleMs} ms (${cycleMs / 60000} min)`);

// The mapping from simulated time to clock face: sunrise at 06:00 is the anchor the whole
// solar arc is built on, so a wrong cycle length would show up here first.
const mapping = await page.evaluate(() => {
  const d = window.__sky.dayNight;
  const out = [];
  for (const h of [0, 6, 12, 18, 23.5]) {
    d.clock.setHour(h);
    d.clock.setPaused(true);
    d.update();
    out.push({ set: h, hour: d.hour, text: d.formatTime(), sunY: d.sunDir.y, moonY: d.moonDir.y });
  }
  d.clock.setPaused(false);
  return out;
});
for (const m of mapping) {
  check(`hour ${m.set} maps to ${m.text}`, Math.abs(m.hour - m.set) < 0.02, `hour=${m.hour.toFixed(3)}`);
}
const noon = mapping.find((m) => m.set === 12), midnight = mapping.find((m) => m.set === 0);
check('sun is highest at noon', noon.sunY > 0.9, `sunDir.y=${noon.sunY.toFixed(3)}`);
check('sun is below the horizon at midnight', midnight.sunY < -0.9, `sunDir.y=${midnight.sunY.toFixed(3)}`);
check('moon is opposite the sun', Math.abs(noon.sunY + noon.moonY) < 1e-9, `moonDir.y=${noon.moonY.toFixed(3)}`);

// The rate itself, measured against real elapsed time rather than trusted from the constant.
const rate = await page.evaluate(async (cycle) => {
  const d = window.__sky.dayNight;
  d.clock.reset();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = performance.now(), h0 = d.clock.hour;
  await wait(6000);
  const t1 = performance.now(), h1 = d.clock.hour;
  const dh = ((h1 - h0) % 24 + 24) % 24;
  return { realMs: t1 - t0, simHours: dh, impliedCycleMs: ((t1 - t0) / dh) * 24, cycle };
});
const err = Math.abs(rate.impliedCycleMs - EXPECTED_CYCLE_MS) / EXPECTED_CYCLE_MS;
check(
  'a measured 6 s of wall time advances the day at 24 h / 3 min',
  err < 0.02,
  `${(rate.realMs / 1000).toFixed(2)} s of wall time advanced ${rate.simHours.toFixed(3)} simulated hours ` +
  `-> implied full day = ${(rate.impliedCycleMs / 1000).toFixed(1)} s (want 180.0 s, off by ${(err * 100).toFixed(2)}%)`,
);
check(
  'one real second is eight simulated minutes',
  Math.abs(rate.simHours / (rate.realMs / 1000) * 60 - 8) < 0.2,
  `${(rate.simHours / (rate.realMs / 1000) * 60).toFixed(2)} simulated minutes per real second`,
);

await close();
report('clock');
