import * as THREE from 'three';
import { heightAt } from './world/terrain';
import { CONFIG } from './config';

/** Ray-march the camera ray against the analytic terrain height (cheap, no mesh raycast). */
export function groundPoint(camera: THREE.Camera, ndc: THREE.Vector2, out = new THREE.Vector3()): THREE.Vector3 | null {
  const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  if (d.y >= -1e-4) return null;   // pointing at the sky
  // March the ray against the height field, then bisect. A Newton-style refine diverges
  // for near-horizontal rays and used to place the target behind the camera.
  const maxT = CONFIG.clickRange;
  const step = 0.4;
  let prevT = 0, prevGap = o.y - heightAt(o.x, o.z);
  let hitT = -1;
  for (let t = step; t <= maxT; t += step) {
    const gap = (o.y + d.y * t) - heightAt(o.x + d.x * t, o.z + d.z * t);
    if (gap <= 0) { hitT = t; break; }
    prevT = t; prevGap = gap;
  }
  if (hitT < 0) { hitT = maxT; prevT = maxT - step; }
  void prevGap;
  let lo = prevT, hi = hitT;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) * 0.5;
    const gap = (o.y + d.y * mid) - heightAt(o.x + d.x * mid, o.z + d.z * mid);
    if (gap > 0) lo = mid; else hi = mid;
  }
  const t = (lo + hi) * 0.5;
  out.set(o.x + d.x * t, 0, o.z + d.z * t); out.y = heightAt(out.x, out.z);
  return out;
}

export interface InputState {
  pointerDown: boolean;
  ndc: THREE.Vector2;
  hasPointer: boolean;
  clickNdc: THREE.Vector2 | null;
  keys: Set<string>;
  /** shift held: run instead of walk */
  run: boolean;
  /** Local walk axes: x = strafe (+right), y = forward (+away from camera). |move| <= 1. */
  move: THREE.Vector2;
}

/**
 * Walk keys. Both WASD and the arrow cluster, so the hand can sit anywhere. Listeners go
 * on `window` rather than the canvas: the canvas is not focusable, so key events would
 * never reach it.
 */
const KEY_AXES: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export function bindInput(el: HTMLElement, onWheel: (dy: number) => void): InputState {
  const st: InputState = {
    pointerDown: false, ndc: new THREE.Vector2(), hasPointer: false, clickNdc: null,
    keys: new Set<string>(), move: new THREE.Vector2(), run: false,
  };

  // Pointer is kept only for the hover flutter and for wheel zoom; it no longer steers her.
  const upd = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    st.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    st.hasPointer = true;
  };
  el.addEventListener('pointermove', upd);
  el.addEventListener('pointerleave', () => { st.hasPointer = false; });
  el.addEventListener('wheel', (e) => { e.preventDefault(); onWheel(e.deltaY); }, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  // Diagonals are normalised so holding two keys is not faster than one.
  const recompute = () => {
    let x = 0, y = 0;
    for (const code of st.keys) {
      const a = KEY_AXES[code];
      if (a) { x += a[0]; y += a[1]; }
    }
    st.move.set(x, y);
    if (st.move.lengthSq() > 1) st.move.normalize();
  };

  const isShift = (c: string) => c === 'ShiftLeft' || c === 'ShiftRight';

  addEventListener('keydown', (e) => {
    if (isShift(e.code)) { st.run = true; return; }
    if (!(e.code in KEY_AXES)) return;
    if (e.repeat) return;
    e.preventDefault();            // arrows would otherwise scroll the page
    st.keys.add(e.code); recompute();
  });
  addEventListener('keyup', (e) => {
    if (isShift(e.code)) { st.run = false; return; }
    if (!(e.code in KEY_AXES)) return;
    st.keys.delete(e.code); recompute();
  });
  // Losing focus mid-stride would otherwise leave a key latched and walk her forever.
  addEventListener('blur', () => { st.keys.clear(); st.run = false; recompute(); });

  return st;
}
