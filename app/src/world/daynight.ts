import * as THREE from 'three';

/** One simulated 24-hour day, in real milliseconds. Everything else scales off this. */
export const DAY_CYCLE_DURATION_MS = 3 * 60 * 1000;

const HOURS_PER_DAY = 24;
const SUNRISE_HOUR = 6;
const HOURS_OF_DAYLIGHT = 12;
/** how far the noon sun leans from the zenith, in radians: the arc is a tilted great circle */
const SOLAR_ARC_TILT = 0.42;

const MAX_SUN_INTENSITY = 3.4;
const MAX_MOON_INTENSITY = 0.55;
const HEMI_DAY = 0.55;
const HEMI_NIGHT = 0.13;
const ENV_DAY = 0.9;
const ENV_NIGHT = 0.025;
const EXPOSURE_DAY = 0.95;
const EXPOSURE_NIGHT = 1.35;

type Stop = readonly [elevation: number, hex: number];

/**
 * Piecewise-linear colour ramp keyed on the sine of the sun's altitude, so every visual
 * property is a continuous function of one number and nothing switches at a clock time.
 */
class Ramp {
  private readonly at: number[];
  private readonly colors: THREE.Color[];

  constructor(stops: readonly Stop[]) {
    this.at = stops.map((s) => s[0]);
    this.colors = stops.map((s) => new THREE.Color().setHex(s[1], THREE.SRGBColorSpace));
  }

  sample(x: number, out: THREE.Color) {
    const { at, colors } = this;
    if (x <= at[0]) return out.copy(colors[0]);
    if (x >= at[at.length - 1]) return out.copy(colors[colors.length - 1]);
    let i = 1;
    while (at[i] < x) i++;
    const t = (x - at[i - 1]) / (at[i] - at[i - 1]);
    return out.copy(colors[i - 1]).lerp(colors[i], t);
  }
}

// night -> pre-dawn -> dawn -> morning -> noon, and the same in reverse after noon
const ZENITH = new Ramp([
  [-1.00, 0x04060e], [-0.28, 0x090f2a], [-0.12, 0x1a1c46],
  [-0.02, 0x323058], [0.06, 0x4a5f96], [0.28, 0x2f74c4], [0.75, 0x1a62cd],
]);
const HORIZON = new Ramp([
  [-1.00, 0x070a16], [-0.28, 0x121a3c], [-0.12, 0x3b2352],
  [-0.05, 0x8d4a5c], [0.02, 0xe07a44], [0.10, 0xf0b487], [0.32, 0xbcd4ec], [0.75, 0xafcde8],
]);
/** the flare immediately around the sun where it meets the horizon */
const SUN_GLOW = new Ramp([
  [-0.12, 0x40204a], [-0.04, 0xa33b3a], [0.02, 0xff6a2a],
  [0.09, 0xffa860], [0.30, 0xffe6c0], [0.75, 0xfff4e2],
]);
const SUN_LIGHT = new Ramp([
  [0.00, 0xff6a2a], [0.06, 0xff9a52], [0.15, 0xffc48a], [0.35, 0xfff0d8], [0.75, 0xfffaf0],
]);
const HEMI_SKY = new Ramp([
  [-1.00, 0x141c34], [-0.12, 0x2a2a52], [0.02, 0x9a7a86], [0.20, 0xbcd6f6], [0.75, 0xcfe3ff],
]);
const HEMI_GROUND = new Ramp([
  [-1.00, 0x0b0f14], [-0.12, 0x171a20], [0.02, 0x4a4030], [0.20, 0x466030], [0.75, 0x4d6b35],
]);

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Simulated time of day, derived from real elapsed time rather than accumulated per frame,
 * so it cannot drift with frame rate and survives throttling. Pausing, seeking and changing
 * speed all re-anchor rather than resetting.
 */
export class SimClock {
  cycleMs = DAY_CYCLE_DURATION_MS;
  speed = 1;
  paused = false;
  private anchorReal = performance.now();
  private anchorSim = (SUNRISE_HOUR / HOURS_PER_DAY) * DAY_CYCLE_DURATION_MS;
  private hiddenAt: number | null = null;

  constructor() { document.addEventListener('visibilitychange', this.onVisibility); }

  /**
   * Nothing is rendered while the tab is hidden, so letting wall-clock time run on would
   * only produce a jump in the sky the moment it comes back. Resume where it left off.
   */
  private onVisibility = () => {
    if (document.hidden) this.hiddenAt = this.elapsedMs;
    else if (this.hiddenAt !== null) { this.reanchor(this.hiddenAt); this.hiddenAt = null; }
  };

  dispose() { document.removeEventListener('visibilitychange', this.onVisibility); }

  /** milliseconds into the simulated day, always in [0, cycleMs) */
  get elapsedMs() {
    const raw = this.paused
      ? this.anchorSim
      : this.anchorSim + (performance.now() - this.anchorReal) * this.speed;
    return ((raw % this.cycleMs) + this.cycleMs) % this.cycleMs;
  }

  get hour() { return (this.elapsedMs / this.cycleMs) * HOURS_PER_DAY; }

  private reanchor(simMs = this.elapsedMs) {
    this.anchorSim = simMs;
    this.anchorReal = performance.now();
  }

  setHour(h: number) { this.reanchor(((h % HOURS_PER_DAY) / HOURS_PER_DAY) * this.cycleMs); }
  setSpeed(s: number) { this.reanchor(); this.speed = s; }
  setCycleMs(ms: number) { const h = this.hour; this.cycleMs = ms; this.setHour(h); }
  setPaused(p: boolean) { if (p !== this.paused) { this.reanchor(); this.paused = p; } }
  reset() { this.speed = 1; this.paused = false; this.setHour(SUNRISE_HOUR); }
}

/**
 * The state of the sky at the current simulated time. Sun and moon ride the same tilted
 * great circle half a day apart, so the moon rises as the sun sets without any special
 * casing, and every lighting term below is a continuous function of the sun's elevation.
 */
export class DayNight {
  readonly clock = new SimClock();
  hour = SUNRISE_HOUR;
  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  daylight = 0;
  starAlpha = 0;
  glowStrength = 0;

  readonly zenith = new THREE.Color();
  readonly horizon = new THREE.Color();
  readonly sunGlow = new THREE.Color();
  readonly sunColor = new THREE.Color();
  readonly hemiSky = new THREE.Color();
  readonly hemiGround = new THREE.Color();

  sunIntensity = 0;
  moonIntensity = 0;
  hemiIntensity = 0;
  envIntensity = 0;
  exposure = EXPOSURE_DAY;
  shadowIntensity = 1;

  update() {
    this.hour = this.clock.hour;

    // theta runs 0 at sunrise, pi/2 at noon, pi at sunset, 3pi/2 at midnight
    const theta = ((this.hour - SUNRISE_HOUR) / HOURS_OF_DAYLIGHT) * Math.PI;
    const cosT = Math.cos(SOLAR_ARC_TILT), sinT = Math.sin(SOLAR_ARC_TILT);
    this.sunDir.set(Math.cos(theta), Math.sin(theta) * cosT, Math.sin(theta) * sinT);
    this.moonDir.copy(this.sunDir).negate();

    const e = this.sunDir.y;
    // Deliberately asymmetric: a sun sitting on the horizon lights the ground barely at
    // all, and full daylight only arrives once it has climbed. A symmetric curve puts the
    // scene at half brightness the instant the sun touches the horizon, which reads as
    // midday under a sunrise sky.
    this.daylight = smoothstep(-0.16, 0.38, e);
    this.starAlpha = smoothstep(0.02, -0.24, e);

    ZENITH.sample(e, this.zenith);
    HORIZON.sample(e, this.horizon);
    SUN_GLOW.sample(e, this.sunGlow);
    SUN_LIGHT.sample(e, this.sunColor);
    HEMI_SKY.sample(e, this.hemiSky);
    HEMI_GROUND.sample(e, this.hemiGround);

    // the flare is strongest while the sun sits on the horizon and gone once it is high
    this.glowStrength = (1 - smoothstep(0.02, 0.34, Math.abs(e))) * smoothstep(-0.30, -0.12, e);

    // Direct sunlight falls off with altitude and is extinguished near the horizon, which
    // is what makes golden hour warm and dim rather than merely orange.
    const above = Math.max(0, e);
    this.sunIntensity = MAX_SUN_INTENSITY * Math.pow(above, 0.75) * smoothstep(-0.05, 0.09, e);
    this.moonIntensity = MAX_MOON_INTENSITY * Math.pow(Math.max(0, -e), 0.6) * smoothstep(-0.09, 0.05, -e);

    this.hemiIntensity = HEMI_NIGHT + (HEMI_DAY - HEMI_NIGHT) * this.daylight;
    this.envIntensity = ENV_NIGHT + (ENV_DAY - ENV_NIGHT) * this.daylight;
    this.exposure = EXPOSURE_DAY + (EXPOSURE_NIGHT - EXPOSURE_DAY) * (1 - this.daylight);

    // shadows wash out as the key light grazes the horizon
    this.shadowIntensity = 0.35 + 0.65 * smoothstep(0.0, 0.30, Math.abs(e));
  }

  /** "06:42", for the clock readout */
  formatTime() {
    const h = Math.floor(this.hour) % HOURS_PER_DAY;
    const m = Math.floor((this.hour - Math.floor(this.hour)) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
