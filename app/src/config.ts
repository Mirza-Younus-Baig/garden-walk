// Tunables. Units are metres. The world is endless; every radius below is measured
// from the girl or the camera, never from a fixed origin.
export const CONFIG = {
  walkSpeed: 1.4,          // m/s
  runSpeed: 2.7,           // hold shift
  accel: 4.0,
  runAccel: 6.5,           // she gets up to a run faster than she eases into a walk
  decel: 6.0,
  turnSpeed: 8.0,          // 1/s: how quickly she closes on the movement direction
  turnMax: 7.5,            // rad/s cap on that, so a reversal takes ~0.4 s instead of snapping
  turnSlow: 0.75,          // fraction of her speed given up at a full reversal (a pivot, not an arc)
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
    // Ground cover. Grass clumps are cheap and dense: the floor under the flowers is
    // grass, not texture, out to where the flower haze takes over. Scrub is sparse low
    // foliage from the scans, so the cover is not all one thing.
    grass:     { cell: 0.160, k: 8,  maxTiles: 200, range: 15 },
    scrub:     { cell: 0.750, k: 4,  maxTiles: 64,  range: 10 },
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
    grass:      [0.14, 0.30],   // a clump, to the ankle or a little over
    scrub:      [0.14, 0.24],   // a tuft of strap leaves
    scrubBush:  [0.18, 0.30],   // a low leafy mound
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
  grassDensity: 0.96,
  scrubDensity: 0.7,
  lilyDensity: 0.85,
  roseDensity: 0.8,
  tulipDensity: 0.85,

  wind: { strength: 1.0, dir: [0.8, 0.45] as [number, number] },

  // How far behind the camera a plant may stand and still cast a shadow that can reach the
  // screen: roughly its height over the tangent of a low sun. Casters further back than
  // this are skipped in the shadow pass, which otherwise draws the whole disc around her.
  shadowBehind: {
    daisy: 0.8, daisyFar: 0, lily: 2.0, tulip: 1.1, rose: 2.2, grass: 0, scrub: 0.7,
  } as Record<'daisy' | 'daisyFar' | 'lily' | 'tulip' | 'rose' | 'grass' | 'scrub', number>,

  /**
   * Contact per type. `radius` is the reach of the largest contact shape in metres (the
   * shapes themselves are in flowers/field.ts: feet for daisies, knees for tulips, hips
   * for lilies and roses); `freq` and `damp` are the spring-back after she has passed,
   * in rad/s and 1/s. A daisy whips back and settles fast; a rose cane barely moves.
   */
  push: {
    daisy: { radius: 0.55, strength: 1.0, freq: 11.0, damp: 3.0 },
    daisyFar: { radius: 0, strength: 0, freq: 11.0, damp: 3.0 },      // always far away; never touched
    lily: { radius: 0.6, strength: 0.9, freq: 7.5, damp: 2.4 },
    tulip: { radius: 0.55, strength: 0.95, freq: 9.0, damp: 2.6 },
    rose: { radius: 0.6, strength: 0.5, freq: 6.0, damp: 3.6 },      // woody: barely gives
    grass: { radius: 0.5, strength: 1.0, freq: 13.0, damp: 3.6 },    // soft: flattens under a foot and is up again at once
    scrub: { radius: 0.55, strength: 0.7, freq: 9.0, damp: 3.2 },
  },

  /**
   * How much running adds to the contact, as a fraction at full run speed. She sweeps a
   * wider swathe and knocks them further, and the push leans harder along her direction of
   * travel rather than straight outward, so a run leaves a visible wake.
   */
  pushSpeed: { radius: 0.5, strength: 0.9, lean: 0.55 },

  camera: {
    back: 3.4, up: 1.9, lookUp: 1.05, minZoom: 0.55, maxZoom: 2.2,
    startZoom: 0.72,       // closer than the old default: less ground on screen to fill
    fov: 42, runFov: 4,    // degrees; the lens widens a touch at a run
    // Every camera motion is a critically damped spring; these are its settling times in
    // seconds (roughly how long a change takes to mostly arrive).
    posSmooth: 0.28,
    lookSmooth: 0.18,
    yawSmooth: 0.55,       // how long the orbit takes to swing in behind her
    zoomSmooth: 0.22,
    lookAhead: 0.28,       // seconds of her velocity the frame leads by
    settle: 1.4,           // seconds it keeps swinging after she stops
  },

  // Distance (m) at which each type drops a level of detail; daisies fall to billboards
  // past the last entry, and billboards fade out into the fog.
  // The middle level of each scan is still a full mesh (a lily is 1400 triangles at
  // level 1 against 190 at level 2), so the second distance is where the budget goes.
  lod: {
    daisy: [3.4, 8.0],
    daisyFar: [8.0],
    lily: [5.0, 10.0],
    tulip: [4.0, 9.0],
    rose: [6.0, 13.0],
    grass: [3.2, 7.0],
    scrub: [3.0, 7.0],
  } as Record<'daisy' | 'daisyFar' | 'lily' | 'tulip' | 'rose' | 'grass' | 'scrub', number[]>,

  fog: { near: 20, far: 74 },
};

// The day/night cycle lives in world/daynight.ts; DAY_CYCLE_DURATION_MS there sets how long
// one simulated 24 hours takes, and everything else in that module scales off it.
export { DAY_CYCLE_DURATION_MS } from './world/daynight';

export type LayerName = keyof typeof CONFIG.layers;
