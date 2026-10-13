/**
 * Which object the prompt is about. The nearest object she is facing wins, and the one
 * already chosen keeps the prompt a little longer than a newcomer needs to take it, so
 * standing between two things never makes the prompt flicker.
 */

export interface FocusCandidate {
  id: string;
  x: number; z: number;
  /** how near she has to be, in metres */
  radius: number;
}

/** reach a focused object keeps, as a multiple of its radius */
export const KEEP = 1.25;

/**
 * Lower is better. Distance relative to reach, plus a penalty for having to turn: an
 * object straight behind her costs as much as one at the edge of reach.
 */
export function focusScore(c: FocusCandidate, px: number, pz: number, yaw: number): number {
  const dx = c.x - px, dz = c.z - pz;
  const d = Math.hypot(dx, dz);
  const facing = d < 1e-6 ? 1 : (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d;   // cos of the angle off her nose
  return d / c.radius + 0.5 * (1 - facing);
}

export function chooseFocus(
  cands: readonly FocusCandidate[], px: number, pz: number, yaw: number, current: string | null,
): string | null {
  let best: string | null = null, bestS = Infinity;
  for (const c of cands) {
    const d = Math.hypot(c.x - px, c.z - pz);
    const reach = c.id === current ? c.radius * KEEP : c.radius;
    if (d > reach) continue;
    // the current one gets a head start, so a near tie stays put
    const s = focusScore(c, px, pz, yaw) - (c.id === current ? 0.15 : 0);
    if (s < bestS) { bestS = s; best = c.id; }
  }
  return best;
}
