// Screenshots of the compass in the finished garden, at a few points in the day.
// Slow on purpose: this one renders the full meadow, which headless software rendering
// takes about three seconds a frame to do.
//
//   node tools/shots.mjs               (needs `npm run dev` on port 5188)
import { mkdirSync } from 'node:fs';
import { openApp, frame, close } from './harness.mjs';

const SHOTS = new URL('../shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const page = await openApp('?dev', { width: 1280, height: 720 });

const SCENES = [
  ['sunrise', 6.2, 90],    // looking east, straight at the rising sun
  ['morning', 8, 200],     // facing away from it: the hint names the turn
  ['noon', 12, 90],        // too high for a bearing to mean much
  ['sunset', 17.8, 270],   // looking west at the setting sun
  ['night', 22, 90],       // moon off to one side, sun hollow on the rim
];

for (const [name, hour, bearing] of SCENES) {
  await page.evaluate(([h, b]) => {
    const d = window.__sky.dayNight;
    d.clock.setHour(h); d.clock.setPaused(true);
    const g = window.__girl.pos, r = (b * Math.PI) / 180;
    const fx = Math.sin(r), fz = -Math.cos(r), dist = 6;
    window.__debugCam = { pos: [g.x - fx * dist, g.y + 2.2, g.z - fz * dist], look: [g.x, g.y + 1.2, g.z] };
  }, [hour, bearing]);
  await frame(page, 4);
  const { hint, box } = await page.evaluate(() => {
    const r = document.getElementById('compass').getBoundingClientRect();
    return {
      hint: document.getElementById('compass-hint').textContent,
      box: { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 },
    };
  });
  await page.screenshot({ path: `${SHOTS}${name}.png` });
  // cropped from the same pass rather than taken through a locator: an element screenshot
  // waits for the box to hold still across consecutive frames, which a five-second frame
  // never satisfies inside the timeout
  await page.screenshot({ path: `${SHOTS}compass-${name}.png`, clip: box });
  console.log(`  ${name.padEnd(9)} ${String(hour).padStart(4)}h  facing ${String(bearing).padStart(3)}°  ->  "${hint}"`);
}

await close();
console.log(`\nwritten to ${SHOTS}`);
