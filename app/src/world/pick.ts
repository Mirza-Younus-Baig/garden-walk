import * as THREE from 'three';
import { heightAt } from './terrain';
import { CONFIG } from '../config';

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
