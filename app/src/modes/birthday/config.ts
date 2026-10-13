import type { GirlTuning } from '../../girl/girl';

/**
 * Everything about the birthday room that is a number. Metres, seconds, radians.
 *
 * The room runs x -3.6..3.6 (left wall has the TV, right wall is behind the sofa) and
 * z -3..3 (back wall has the window, front wall the door). The camera usually looks in
 * from the front, toward -z.
 */
export const ROOM = { minX: -3.6, maxX: 3.6, minZ: -3.0, maxZ: 3.0, height: 2.8 };

/** indoors she ambles: slower than in the meadow, and a run is a skip, not a sprint */
export const TUNING: GirlTuning = {
  walkSpeed: 1.1, runSpeed: 1.9, accel: 3.6, runAccel: 5.5, decel: 6.5,
  turnSpeed: 8.0, turnMax: 7.0, turnSlow: 0.75, arriveRadius: 0.3,
};

export const GIRL_RADIUS = 0.2;

/** where things stand */
export const LAYOUT = {
  sofa: { x: 1.55, z: -0.1, len: 2.2, depth: 0.95, seatY: 0.46 },
  table: { x: -0.7, z: -0.1, len: 1.15, depth: 0.66, h: 0.44 },
  tv: { z: -0.1, y: 1.45, w: 1.45, h: 0.83 },
  stand: { z: -0.1, len: 1.95, depth: 0.42, h: 0.52 },
  window: { x: 0.3, w: 1.7, h: 1.42, sill: 1.0 },
  lamp: { x: 1.62, z: -1.62 },
  sideTable: { x: 1.55, z: 1.5 },
  shelf: { x: 3.42, z: -2.05, w: 1.0, d: 0.34, h: 2.05 },
  door: { x: 2.35, w: 0.92, h: 2.1 },
  rug: { x: -0.55, z: -0.1, w: 3.3, d: 2.5 },
  gift: { x: -1.75, z: 1.55 },
  balloons: { x: -3.2, z: -2.25 },
  record: { z: 0.62 },
  cake: { x: -0.66, z: -0.08 },
  vase: { x: -0.72, z: -0.48 },
  card: { x: -0.58, z: 0.33 },
} as const;

export const CAMERA = {
  fov: 46,
  /** distance behind her and the height of the eye above her root */
  dist: 2.55, minDist: 1.5, maxDist: 4.2,
  height: 1.55, lookUp: 0.95,
  /** keep the lens this far inside the walls and under the ceiling */
  wallPad: 0.22,
  posSmooth: 0.32, lookSmooth: 0.2, yawSmooth: 0.9,
};

export const CANDLES = { count: 8, ringR: 0.086, height: 0.058 };
