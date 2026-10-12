import type { InputState } from './input';

/**
 * Phones and tablets. Everything here is gated on `isTouch`, so a desktop browser takes
 * none of these paths: no rotation, no joystick, no extra listeners.
 *
 * `?touch` forces the touch layout on a desktop browser, for testing.
 */
const qs = location.search;
export const isTouch = qs.includes('touch') ||
  (matchMedia('(hover: none) and (pointer: coarse)').matches && navigator.maxTouchPoints > 0);

/**
 * The garden is played in landscape. A web page cannot rotate the screen on iOS at all,
 * and on Android only from fullscreen, so when the viewport is portrait the whole page is
 * turned a quarter clockwise instead: body is laid out at the landscape size and rotated,
 * and turning the phone sideways brings it upright. Held that way with rotation unlocked,
 * the viewport becomes landscape itself and the rotation drops away.
 *
 * Body is the stage: it is the containing block for every fixed-position overlay (loading
 * screen, clock, compass, joystick), so they all turn with it.
 */
let rotated = false;
const stage = { w: innerWidth, h: innerHeight };
export function layoutStage(): { w: number; h: number } {
  const vw = innerWidth, vh = innerHeight;
  rotated = isTouch && vh > vw;
  const root = document.documentElement;
  root.classList.toggle('rotated', rotated);
  if (rotated) {
    root.style.setProperty('--sw', `${vh}px`);
    root.style.setProperty('--sh', `${vw}px`);
  }
  stage.w = rotated ? vh : vw; stage.h = rotated ? vw : vh;
  return { ...stage };
}

/** screen (client) coordinates to stage coordinates; the inverse of the CSS rotation */
function toStage(x: number, y: number): [number, number] {
  return rotated ? [y, innerWidth - x] : [x, y];
}

/**
 * Android: go fullscreen on the first touch and lock to landscape, which actually turns
 * the screen. Both need a user gesture and both simply fail on iOS, where the CSS rotation
 * above covers it. Asked once: if she leaves fullscreen, that choice is respected.
 */
function lockLandscape() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => (screen.orientation as any)?.lock?.('landscape'))
    .catch(() => {});
}

const JOY_R = 56;          // px the knob travels from centre to rim
const DEAD = 0.12;         // fraction of the travel ignored, so a resting thumb does not creep
const WALK_FULL = 0.72;    // travel at which she reaches full walking pace
const RUN_AT = 0.92;       // past this she runs

/**
 * Left thumb: a floating joystick. It rests in the lower-left corner so it is obvious, but
 * a touch anywhere on the left half of the screen picks it up under the thumb. Travel maps
 * onto walking pace, and pushing it to the rim breaks into a run.
 * Two fingers elsewhere: pinch to zoom.
 */
export function bindTouch(el: HTMLElement, st: InputState, onZoom: (dy: number) => void, onFirstMove: () => void) {
  const root = document.documentElement;
  root.classList.add('touch');
  document.addEventListener('gesturestart', (e) => e.preventDefault());   // iOS page pinch
  document.addEventListener('dblclick', (e) => e.preventDefault());

  const base = document.createElement('div');
  base.id = 'joy';
  const knob = document.createElement('div');
  knob.id = 'joy-knob';
  base.append(knob);
  document.body.append(base);

  let joyId = -1, joyT = 0, cx = 0, cy = 0, moved = false, locked = false;
  const pinch = new Map<number, [number, number]>();
  let pinchDist = 0;

  const release = () => {
    joyId = -1;
    st.move.set(0, 0); st.run = false;
    base.classList.remove('live', 'run');
    base.style.left = base.style.top = base.style.bottom = '';
    knob.style.transform = '';
  };

  const steer = (x: number, y: number) => {
    let dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(d / JOY_R, 1);
    if (m < DEAD) { st.move.set(0, 0); st.run = false; base.classList.remove('run'); return; }
    const pace = Math.min(1, (m - DEAD) / (WALK_FULL - DEAD));
    st.move.set(dx, -dy).normalize().multiplyScalar(pace);
    st.run = m >= RUN_AT;
    base.classList.toggle('run', st.run);
    if (!moved) { moved = true; onFirstMove(); }
  };

  const spread = () => {
    const [a, b] = [...pinch.values()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    if (!locked) { locked = true; lockLandscape(); }
    const [x, y] = toStage(e.clientX, e.clientY);
    el.setPointerCapture(e.pointerId);
    const { w, h } = stage;
    // A second finger landing just after the first, before the stick has gone anywhere, is
    // the start of a pinch rather than a walk: hand the first finger over to the pinch.
    if (joyId >= 0 && performance.now() - joyT < 250 && st.move.lengthSq() === 0) {
      pinch.set(joyId, [cx, cy]);
      release();
    }
    if (joyId < 0 && pinch.size === 0 && x < w * 0.5) {
      joyId = e.pointerId; joyT = performance.now();
      // the base follows the thumb, but stays whole on screen
      const r = base.offsetWidth / 2 || 64;
      cx = Math.min(Math.max(x, r + 8), w - r - 8);
      cy = Math.min(Math.max(y, r + 8), h - r - 8);
      base.style.left = `${cx - r}px`; base.style.top = `${cy - r}px`; base.style.bottom = 'auto';
      base.classList.add('live');
      steer(x, y);
      return;
    }
    if (e.pointerId === joyId) return;
    pinch.set(e.pointerId, [x, y]);
    if (pinch.size === 2) pinchDist = spread();
  });

  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') return;
    const [x, y] = toStage(e.clientX, e.clientY);
    if (e.pointerId === joyId) { steer(x, y); return; }
    if (!pinch.has(e.pointerId)) return;
    pinch.set(e.pointerId, [x, y]);
    if (pinch.size !== 2) return;
    const d = spread();
    // fingers apart = closer, as on a photo; expressed as the wheel delta the camera takes
    if (pinchDist > 0 && d > 0) onZoom(Math.log(pinchDist / d) / 0.0012);
    pinchDist = d;
  });

  const up = (e: PointerEvent) => {
    if (e.pointerId === joyId) release();
    if (pinch.delete(e.pointerId) && pinch.size === 2) pinchDist = spread();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  addEventListener('blur', () => { release(); pinch.clear(); });
}
