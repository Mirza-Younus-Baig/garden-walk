import { describe, it, expect } from 'vitest';
import { BlowDetector, spectrumStats } from '../src/modes/birthday/core/blow';

const SR = 48000, N = 1024, BINS = N / 2, DT = N / SR;

/** naive DFT power spectrum, fine for a test */
function power(x: Float32Array) {
  const p = new Float32Array(BINS);
  for (let k = 0; k < BINS; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < x.length; n++) { const a = (2 * Math.PI * k * n) / x.length; re += x[n] * Math.cos(a); im -= x[n] * Math.sin(a); }
    p[k] = (re * re + im * im) / x.length;
  }
  return p;
}
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
/** breath on a mic: broadband noise, weighted low (a one-pole low-pass) */
function breath(amp: number) { const x = new Float32Array(N); let y = 0; for (let i = 0; i < N; i++) { y += (rnd() - y) * 0.15; x[i] = y * amp * 3; } return x; }
function room(amp: number) { const x = new Float32Array(N); for (let i = 0; i < N; i++) x[i] = rnd() * amp; return x; }
/** a voice-like tone: a fundamental and harmonics */
function voice(amp: number, f = 220) { const x = new Float32Array(N); for (let i = 0; i < N; i++) { const t = i / SR; x[i] = amp * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.3 * Math.sin(6 * Math.PI * f * t)); } return x; }

function feedFor(d: BlowDetector, seconds: number, gen: () => Float32Array) {
  let r = d.feed(new Float32Array(N), new Float32Array(BINS), SR, DT);
  for (let t = 0; t < seconds; t += DT) { const x = gen(); r = d.feed(x, power(x), SR, DT); }
  return r;
}

describe('spectrumStats', () => {
  it('white noise is flat, a tone is not', () => {
    const w = spectrumStats(power(room(0.3)), SR, 1000), v = spectrumStats(power(voice(0.3)), SR, 1000);
    expect(w.flatness).toBeGreaterThan(0.3);
    expect(v.flatness).toBeLessThan(0.05);
  });
  it('breath carries most of its energy low', () => {
    expect(spectrumStats(power(breath(0.5)), SR, 1000).lowShare).toBeGreaterThan(0.45);
  });
});

describe('BlowDetector', () => {
  it('calibrates first and reports nothing meanwhile', () => {
    const d = new BlowDetector();
    const r = d.feed(breath(0.5), power(breath(0.5)), SR, DT);
    expect(r.calibrating).toBe(true); expect(r.blowing).toBe(false);
  });
  it('hears a blow after a quiet room', () => {
    const d = new BlowDetector();
    feedFor(d, 0.7, () => room(0.003));
    const r = feedFor(d, 0.4, () => breath(0.5));
    expect(r.blowing).toBe(true);
    expect(r.strength).toBeGreaterThan(0.3);
  });
  it('does not take talking for a blow', () => {
    const d = new BlowDetector();
    feedFor(d, 0.7, () => room(0.003));
    expect(feedFor(d, 0.6, () => voice(0.3)).blowing).toBe(false);
  });
  it('ignores a blip shorter than the hold time', () => {
    const d = new BlowDetector();
    feedFor(d, 0.7, () => room(0.003));
    const r = feedFor(d, 0.05, () => breath(0.5));
    expect(r.blowing).toBe(false);
  });
  it('lets go once the breath stops', () => {
    const d = new BlowDetector();
    feedFor(d, 0.7, () => room(0.003));
    feedFor(d, 0.4, () => breath(0.5));
    expect(feedFor(d, 0.4, () => room(0.003)).blowing).toBe(false);
  });
});
