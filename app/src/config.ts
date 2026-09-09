// Tunables. Units are metres. The world is endless; every radius below is measured
// from the girl or the camera, never from a fixed origin.
export const CONFIG = {
  walkSpeed: 1.4,          // m/s
  runSpeed: 2.7,           // hold shift
  accel: 4.0,
  runAccel: 6.5,           // she gets up to a run faster than she eases into a walk
  decel: 6.0,
  turnSpeed: 8.0,          // rad/s toward movement direction
  arriveRadius: 0.3,
  clickRange: 46,          // furthest a click can send her, in metres

  // Ground: one plane that follows her, displaced in the vertex shader.
  groundSize: 320,
  groundSegments: 200,
  groundSpeckleStart: 21,  // distance where the ground starts carrying the far flower haze

  // Instances are allocated to what the camera can see, not to a disc around the girl,
  // so the whole budget lands on screen. Each layer is a pool of `maxTiles` tiles of
  // k x k cells, `cell` metres apart; a tile entering the view claims a block of slots
  // and a tile leaving gives it back.
  //   slots = maxTiles * k * k        tile side = k * cell        density = 1 / cell^2
  // `range` is how far ahead of the camera that layer is populated.
  view: {
    fovSlack: 0.10,        // radians of extra half-angle, so nothing pops in at the edge
    nearRadius: 6.0,       // always populated around the girl, whichever way the camera looks
    budget: 6,             // tiles filled per layer per frame once primed
  },

  layers: {
    // Daisies are split in two: the detailed plants only need to exist within a few
    // metres, and spending 50k instances on billboards that three.js has to cull one by
    // one every frame is what actually costs the frame, not their triangles.
    // Budget spent near the camera rather than far from it: each cell is smaller (density
    // is 1/cell^2) and each range is shorter, so the same slot count buys a fuller
    // foreground instead of a thin scatter reaching to the fog. The ground's far-flower
    // haze picks up at groundSpeckleStart, which moved in to meet the new ranges.
    // Slot counts are unchanged; the ranges came in and the cells shrank, so the same
    // budget buys a denser meadow over a smaller area. With the camera starting closer
    // there is less ground on screen to fill, and the ground's far-flower haze covers
    // everything past groundSpeckleStart.
    daisy:     { cell: 0.125, k: 12, maxTiles: 110, range: 9 },
    daisyFar:  { cell: 0.170, k: 8,  maxTiles: 400, range: 22 },
    tulip:     { cell: 0.470, k: 8,  maxTiles: 125, range: 24 },
    lily:      { cell: 0.450, k: 7,  maxTiles: 230, range: 26 },
    rose:      { cell: 0.950, k: 5,  maxTiles: 125, range: 26 },
  },

  /**
   * How tall each plant actually stands, in metres, as [shortest, tallest].
   *
   * These are the real numbers, not multipliers: every model is normalised to its own
   * measured height at load, so what is written here is what you get in the world. The
   * girl is 1.55 m, which puts her ankle at 0.14, calf 0.25, knee 0.43, hip 0.85 and
   * shoulder 1.27, so read the ranges against those.
   *
   * They have to be set here rather than taken from the scans because the scans do not
   * agree on scale: they are individual plants photographed at whatever size, and a
   * couple of them have flower heads well out of proportion to their own stems.
   */
  size: {
    daisy:      [0.22, 0.32],   // ankle to mid-calf
    daisyFar:   [0.22, 0.32],
    tulip:      [0.30, 0.46],   // mid-calf to knee
    lily:       [0.60, 0.95],   // knee to hip
    rose:       [0.55, 0.85],   // a whole bush: knee to hip
    roseSingle: [0.40, 0.56],   // one long stem, a smaller plant than the bush
  } as Record<string, [number, number]>,

  /**
   * How much of a variant's own height is kept when it is normalised (0..1). At 0 every
   * variant of a type stands exactly as tall as the target, which is what a daisy patch
   * wants: its tallest flower should reach the same height as a single daisy beside it.
   * At 1 the model's own proportions are kept untouched. The lilies sit in between, so
   * the naturally short stems in that scan stay shorter than the tall ones without being
   * stretched to match them.
   */
  sizeBlend: { daisy: 0, daisyFar: 0, tulip: 0, lily: 0.35, rose: 0 } as Record<string, number>,

  // How much of each grid actually grows a plant (0..1), before noise clumping.
  daisyDensity: 0.9,
  lilyDensity: 0.85,
  roseDensity: 0.8,
  tulipDensity: 0.85,

  wind: { strength: 1.0, dir: [0.8, 0.45] as [number, number] },

  // How far behind the camera a plant may stand and still cast a shadow that can reach the
  // screen: roughly its height over the tangent of a low sun. Casters further back than
  // this are skipped in the shadow pass, which otherwise draws the whole disc around her.
  shadowBehind: {
    daisy: 0.8, daisyFar: 0, lily: 2.0, tulip: 1.1, rose: 2.2,
  } as Record<'daisy' | 'daisyFar' | 'lily' | 'tulip' | 'rose', number>,

  push: {
    daisy: { radius: 0.55, strength: 1.0 },
    daisyFar: { radius: 0, strength: 0 },      // always far away; never touched
    lily: { radius: 0.6, strength: 0.9 },
    tulip: { radius: 0.55, strength: 0.95 },
    rose: { radius: 0.6, strength: 0.5 },      // woody: barely gives
  },

  /**
   * How much running adds to the contact, as a fraction at full run speed. She sweeps a
   * wider swathe and knocks them further, and the push leans harder along her direction of
   * travel rather than straight outward, so a run leaves a visible wake.
   */
  pushSpeed: { radius: 0.5, strength: 0.9, lean: 0.55 },

  camera: {
    back: 3.4, up: 1.9, lookUp: 1.05, minZoom: 0.55, maxZoom: 2.2, damp: 4.0,
    startZoom: 0.72,       // closer than the old default: less ground on screen to fill
    yawRate: 2.6,          // rad/s the camera swings to get behind her
    settle: 1.4,           // seconds it keeps swinging after she stops
  },

  // Distance (m) at which each type drops a level of detail; daisies fall to billboards
  // past the last entry, and billboards fade out into the fog.
  lod: {
    daisy: [3.6, 8.5],
    daisyFar: [8.5],
    lily: [6, 14],
    tulip: [4.5, 11],
    rose: [7, 16],
  } as Record<'daisy' | 'daisyFar' | 'lily' | 'tulip' | 'rose', number[]>,

  fog: { near: 20, far: 74 },
};

// The day/night cycle lives in world/daynight.ts; DAY_CYCLE_DURATION_MS there sets how long
// one simulated 24 hours takes, and everything else in that module scales off it.
export { DAY_CYCLE_DURATION_MS } from './world/daynight';

export type LayerName = keyof typeof CONFIG.layers;
