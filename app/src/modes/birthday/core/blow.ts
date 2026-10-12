/**
 * Tells a breath blown at the microphone from talking, music and room noise.
 *
 * Blowing on a mic is wind on the capsule: loud, broadband and noise-like (a flat
 * spectrum), with most of its energy low down. A voice is loud too, but tonal: a few
 * strong harmonics, so its spectrum is anything but flat. Three tests, all of which must
 * hold for a sustained moment:
 *
 *   level     RMS well above the room's own floor, which is measured first
 *   flatness  geometric / arithmetic mean of the power spectrum (1 = white noise)
 *   low band  share of the energy under `lowHz`
 *
 * Pure: feed it analyser frames, it returns what it hears. Unit-tested with synthetic
 * noise, tones and silence.
 */

export interface BlowParams {
  calibrate: number;     // seconds spent learning the room's noise floor
  minRms: number;        // absolute floor, so a silent room does not make every rustle a blow
  floorGain: number;     // must be this many times the room's floor
  flatness: number;      // spectral flatness needed
  lowShare: number;      // share of energy under lowHz needed
  lowHz: number;
  hold: number;          // seconds the three tests must hold before it counts
  release: number;       // seconds of quiet that end a blow
}

export const BLOW_DEFAULTS: BlowParams = {
  calibrate: 0.6, minRms: 0.03, floorGain: 3.5, flatness: 0.1, lowShare: 0.3, lowHz: 1000, hold: 0.16, release: 0.25,
};

export interface BlowReading {
  calibrating: boolean;
  /** a blow is under way */
  blowing: boolean;
  /** 0..1, how hard (from level above the threshold) */
  strength: number;
  rms: number; flatness: number; lowShare: number;
}

export class BlowDetector {
  private t = 0;
  private floorSum = 0;
  private floorN = 0;
  private floor = 0;
  private on = 0;
  private off = 0;
  private active = false;
  readonly p: BlowParams;

  constructor(params: Partial<BlowParams> = {}) { this.p = { ...BLOW_DEFAULTS, ...params }; }

  reset() { this.t = 0; this.floorSum = 0; this.floorN = 0; this.floor = 0; this.on = 0; this.off = 0; this.active = false; }

  /**
   * @param time  time-domain samples in [-1, 1]
   * @param power linear power per FFT bin (not dB), bin i covers i * sampleRate / (2 * power.length)
   */
  feed(time: Float32Array, power: Float32Array, sampleRate: number, dt: number): BlowReading {
    let sq = 0;
    for (let i = 0; i < time.length; i++) sq += time[i] * time[i];
    const rms = Math.sqrt(sq / Math.max(1, time.length));
    const { flatness, lowShare } = spectrumStats(power, sampleRate, this.p.lowHz);
    this.t += dt;
    if (this.t <= this.p.calibrate) {
      this.floorSum += rms; this.floorN++;
      this.floor = this.floorSum / this.floorN;
      return { calibrating: true, blowing: false, strength: 0, rms, flatness, lowShare };
    }
    const threshold = Math.max(this.p.minRms, this.floor * this.p.floorGain);
    const hit = rms > threshold && flatness > this.p.flatness && lowShare > this.p.lowShare;
    // Leaky: a single frame that misses (breath is noisy frame to frame) slows the count
    // down rather than throwing it away.
    if (hit) { this.on += dt; this.off = Math.max(0, this.off - dt); }
    else { this.off += dt; this.on = Math.max(0, this.on - dt * 0.5); }
    if (!this.active && this.on >= this.p.hold) this.active = true;
    if (this.active && this.off >= this.p.release) this.active = false;
    const strength = this.active ? Math.min(1, Math.max(0, (rms - threshold) / (threshold * 3)) + 0.35) : 0;
    return { calibrating: false, blowing: this.active, strength, rms, flatness, lowShare };
  }
}

/** spectral flatness over the band that carries speech and breath, and the low-band share */
export function spectrumStats(power: Float32Array, sampleRate: number, lowHz: number) {
  const hzPerBin = sampleRate / (2 * power.length);
  const lo = Math.max(1, Math.floor(80 / hzPerBin));            // skip DC and rumble
  const hi = Math.min(power.length, Math.ceil(6000 / hzPerBin));
  const lowEnd = Math.min(hi, Math.ceil(lowHz / hzPerBin));
  let logSum = 0, sum = 0, low = 0, n = 0;
  for (let i = lo; i < hi; i++) {
    const p = power[i] + 1e-12;
    logSum += Math.log(p); sum += p; n++;
    if (i < lowEnd) low += p;
  }
  if (n === 0 || sum <= 0) return { flatness: 0, lowShare: 0 };
  const flatness = Math.exp(logSum / n) / (sum / n);
  return { flatness, lowShare: low / sum };
}

/** dB from an AnalyserNode's getFloatFrequencyData to linear power, in place */
export function dbToPower(db: Float32Array, out: Float32Array) {
  for (let i = 0; i < db.length; i++) out[i] = Number.isFinite(db[i]) ? Math.pow(10, db[i] / 10) : 0;
  return out;
}
