// Proves the compass. The claim under test is the one the compass makes to the user:
// "turn this far in this direction and you will be looking at the sun (or the moon)".
//
// It is checked end-to-end and independently of the compass's own arithmetic: the hint text
// is read out of the DOM, the camera is then turned by exactly the amount it names, and the
// body's position is recomputed from the camera's world matrix. If the hint is right, the
// body ends up on the camera's centre line; if the sign were inverted, turning the other way
// would centre it instead, so that is checked too.
//
//   node tools/compass_test.mjs        (needs `npm run dev` on port 5188)
import { mkdirSync } from 'node:fs';
import { openApp, frame, check, report, close, LIGHT } from './harness.mjs';

const SHOTS = new URL('../shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

/** half the horizontal field of view at 16:9, from the camera's 42-degree vertical fov */
const WEDGE_DEG = (Math.atan(Math.tan((42 / 2) * (Math.PI / 180)) * (16 / 9)) * 180) / Math.PI;

const page = await openApp(`?dev&${LIGHT}`, { width: 640, height: 360 });

/**
 * Point the camera along a known compass bearing (clockwise from north) and wait until the
 * render loop has actually put it there. Software rendering runs at a few frames a second,
 * so waiting a fixed number of milliseconds reads stale state; this waits for the camera's
 * own world matrix to agree, which also means the compass has been redrawn for that frame.
 */
async function face(bearingDeg, hour) {
  await page.evaluate(([b, h]) => {
    const d = window.__sky.dayNight;
    if (h !== null) { d.clock.setHour(h); d.clock.setPaused(true); }
    const g = window.__girl.pos;
    const r = (b * Math.PI) / 180;
    const fx = Math.sin(r), fz = -Math.cos(r), dist = 6;
    window.__debugCam = { pos: [g.x - fx * dist, g.y + 2.2, g.z - fz * dist], look: [g.x, g.y + 1.2, g.z] };
  }, [bearingDeg, hour ?? null]);
  // The clock and the solar geometry only take effect when the loop next runs update(), and
  // that is not tied to the camera moving: changing only the hour would otherwise be read
  // back a frame too early. Wait for real frames first, then confirm the camera arrived.
  await frame(page, 3);
  await page.waitForFunction((b) => {
    const m = window.__camera.matrixWorld.elements;
    const bear = (Math.atan2(-m[8], m[10]) * 180) / Math.PI;
    return Math.abs(((bear - b + 540) % 360) - 180) < 0.05;
  }, bearingDeg, { timeout: 60000 });
}

/**
 * Where the sun and moon really are relative to the camera, derived from the camera's world
 * matrix rather than from anything the compass computed.
 */
const truth = () =>
  page.evaluate(() => {
    const cam = window.__camera, d = window.__sky.dayNight;
    const m = cam.matrixWorld.elements;
    const right = [m[0], m[1], m[2]];          // camera +X; lookAt adds no roll, so it is horizontal
    const fwd = [-m[8], -m[9], -m[10]];        // camera -Z
    const fwdH = Math.hypot(fwd[0], fwd[2]);
    const of = (dir) => {
      const acrossView = dir.x * right[0] + dir.y * right[1] + dir.z * right[2];
      const alongViewH = (dir.x * fwd[0] + dir.z * fwd[2]) / fwdH;
      return {
        acrossView,                            // 0 == dead centre of the frame
        alongViewH,                            // > 0 == in front of the camera
        bearingOff: (Math.atan2(acrossView, alongViewH) * 180) / Math.PI,
        altitude: (Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180) / Math.PI,
      };
    };
    return { sun: of(d.sunDir), moon: of(d.moonDir) };
  });

/** What the compass is displaying, read straight out of the DOM. */
const readCompass = () =>
  page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const box = g('compass').getBoundingClientRect();
    const svgBox = g('compass').querySelector('svg').getBoundingClientRect();
    const at = (el) => ({ cx: +el.getAttribute('cx'), cy: +el.getAttribute('cy'), fill: el.getAttribute('fill-opacity') });
    const cardinals = [...document.querySelectorAll('#compass-rose text')].map((t) => {
      const r = t.getBoundingClientRect();
      return { label: t.dataset.cardinal, x: r.x + r.width / 2 - svgBox.x, y: r.y + r.height / 2 - svgBox.y };
    });
    return {
      hint: g('compass-hint').textContent, sun: at(g('compass-sun')), moon: at(g('compass-moon')),
      cardinals, box: { w: box.width, h: box.height },
    };
  });

// ------------------------------------------------------------------ it is actually on screen
{
  const c = await readCompass();
  check('a compass is rendered', c.box.w > 60 && c.box.h > 60,
    `${Math.round(c.box.w)}x${Math.round(c.box.h)} px, hint "${c.hint}"`);
}

// ------------------------------------------------------------------ the rose tracks the camera
for (const [bearing, want] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
  await face(bearing, 12);
  const { cardinals } = await readCompass();
  const top = cardinals.reduce((a, b) => (b.y < a.y ? b : a));
  check(`facing bearing ${bearing}° puts ${want} at the top of the dial`, top.label === want,
    `topmost letter is ${top.label}`);
}

// ------------------------------------------------------------------ the sun rises east, sets west
{
  await face(90, 6);
  const dawn = await readCompass();
  await face(90, 18);
  const dusk = await readCompass();
  check('at 06:00, facing east, the sun is ahead', dawn.hint === 'Sun ahead', `hint "${dawn.hint}"`);
  check('at 18:00, facing east, the sun is behind you', dusk.hint === 'Sun behind you', `hint "${dusk.hint}"`);
}

// ------------------------------------------------------------------ altitude reads as radius
{
  const rad = (m) => Math.hypot(m.cx - 50, m.cy - 50);
  await face(90, 6);
  const dawn = await readCompass();
  await face(90, 12);
  const noon = await readCompass();
  await face(90, 0);
  const night = await readCompass();
  check('a sun on the horizon sits on the rim', Math.abs(rad(dawn.sun) - 30) < 0.6, `r=${rad(dawn.sun).toFixed(2)} (rim = 30)`);
  check('the noon sun sits far inside the rim', rad(noon.sun) < 12, `r=${rad(noon.sun).toFixed(2)}`);
  check('a sun below the horizon is pinned to the rim and drawn hollow',
    Math.abs(rad(night.sun) - 30) < 0.6 && night.sun.fill === '0',
    `r=${rad(night.sun).toFixed(2)}, fill-opacity=${night.sun.fill}`);
  check('the moon is drawn solid while the sun is down', night.moon.fill === '1', `moon fill-opacity=${night.moon.fill}`);
}

// ------------------------------------------------- THE CLAIM: turn as told, and it centres
const HINT = /^(Sun|Moon) (?:(\d+)° (left|right)|(ahead|behind you|overhead))$/;
let turned = 0, centred = 0, inverted = 0, invertedWorse = 0;

for (const hour of [1, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]) {
  for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
    await face(bearing, hour);
    const { hint } = await readCompass();
    const m = HINT.exec(hint);
    if (!m) { check(`hint is well formed at ${hour}:00 facing ${bearing}°`, false, `got "${hint}"`); continue; }
    const body = m[1].toLowerCase();
    const at = `${String(hour).padStart(2, '0')}:00 facing ${bearing}°`;
    const before = (await truth())[body];

    if (m[4] === 'behind you') {
      check(`${at}: "${hint}" — and it is behind`, before.alongViewH < 0, `along-view = ${before.alongViewH.toFixed(3)}`);
      continue;
    }
    if (m[4] === 'ahead') {
      check(`${at}: "${hint}" — and it is inside the view wedge`,
        before.alongViewH > 0 && Math.abs(before.bearingOff) <= WEDGE_DEG + 0.3,
        `off-centre by ${before.bearingOff.toFixed(1)}° (wedge is ±${WEDGE_DEG.toFixed(1)}°)`);
      continue;
    }
    if (m[4] === 'overhead') {
      check(`${at}: "${hint}" — and it is near the zenith`, before.altitude > 55, `altitude = ${before.altitude.toFixed(1)}°`);
      continue;
    }

    // "Sun 42° right": turn exactly that far, that way, and it must land on the centre line.
    const deg = Number(m[2]), dir = m[3] === 'right' ? 1 : -1;
    await face(bearing + dir * deg, hour);
    const after = (await truth())[body];
    turned++;
    const ok = Math.abs(after.bearingOff) < 0.8 && after.alongViewH > 0;
    if (ok) centred++;
    check(`${at}: "${hint}" -> turned ${deg}° ${m[3]}, ${body} lands dead centre`, ok,
      `off-centre ${before.bearingOff.toFixed(1)}° before, ${after.bearingOff.toFixed(2)}° after`);

    // ...and turning the other way must make it worse, so a hint that always said "left"
    // could not pass the check above by accident.
    // Only meaningful below 90°: turning twice as far as 90° wraps back around the circle,
    // so "the wrong way is worse" stops being true for a reason that has nothing to do with
    // the compass. Below that, the wrong way must leave it at twice the offset.
    if (deg > 4 && deg < 85) {
      await face(bearing - dir * deg, hour);
      const wrong = (await truth())[body];
      inverted++;
      if (Math.abs(Math.abs(wrong.bearingOff) - 2 * deg) < 1.5) invertedWorse++;
    }
  }
}
check(`every hint that named an angle centred its body when followed (${centred}/${turned})`,
  turned > 20 && centred === turned);
check(`turning the opposite way instead left it at twice the offset (${invertedWorse}/${inverted})`,
  inverted > 10 && invertedWorse === inverted);

await close();
report('compass');
