/**
 * Frame-driven coroutines. An action is written as a plain async function:
 *
 *   await tasks.during(0.8, (k) => pose.kneel = ease(k));
 *   await tasks.wait(0.3);
 *
 * and advances only when the render loop calls `update(dt)`, so it runs on game time:
 * it pauses with the loop, and a test can drive it with a fake clock. Every wait takes an
 * AbortSignal, so walking away mid-action unwinds it cleanly.
 */

export class AbortedError extends Error {
  constructor() { super('aborted'); this.name = 'AbortedError'; }
}
export const isAborted = (e: unknown) => e instanceof AbortedError;

interface Job {
  /** called every frame with the frame's dt; returns true once finished */
  step(dt: number): boolean;
  resolve(): void;
  reject(e: unknown): void;
  signal?: AbortSignal;
}

export class Tasks {
  time = 0;
  private jobs: Job[] = [];

  /** advance every pending job by dt seconds */
  update(dt: number) {
    this.time += dt;
    const jobs = this.jobs;
    this.jobs = [];
    const keep: Job[] = [];
    for (const j of jobs) {
      if (j.signal?.aborted) { j.reject(new AbortedError()); continue; }
      let done: boolean;
      try { done = j.step(dt); } catch (e) { j.reject(e); continue; }
      if (done) j.resolve(); else keep.push(j);
    }
    // jobs added while stepping (by a resolved continuation) start next frame
    this.jobs = keep.concat(this.jobs);
  }

  get pending() { return this.jobs.length; }

  private add(step: (dt: number) => boolean, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new AbortedError());
    return new Promise<void>((resolve, reject) => {
      const job: Job = { step, resolve, reject, signal };
      this.jobs.push(job);
      signal?.addEventListener('abort', () => {
        const i = this.jobs.indexOf(job);
        if (i >= 0) { this.jobs.splice(i, 1); reject(new AbortedError()); }
      }, { once: true });
    });
  }

  /** resolves after `sec` seconds of game time */
  wait(sec: number, signal?: AbortSignal): Promise<void> {
    let t = 0;
    return this.add((dt) => (t += dt) >= sec, signal);
  }

  /**
   * Calls fn every frame for `sec` seconds with progress k in (0, 1], ending exactly on
   * k = 1 so whatever it drives lands on its final value.
   */
  during(sec: number, fn: (k: number, dt: number) => void, signal?: AbortSignal): Promise<void> {
    let t = 0;
    return this.add((dt) => {
      t += dt;
      const k = sec <= 0 ? 1 : Math.min(1, t / sec);
      fn(k, dt);
      return k >= 1;
    }, signal);
  }

  /**
   * Resolves true once pred() holds, or false after `timeout` seconds. Checked once per
   * frame.
   */
  until(pred: () => boolean, timeout = Infinity, signal?: AbortSignal): Promise<boolean> {
    let t = 0, ok = false;
    return this.add((dt) => {
      t += dt;
      if (pred()) { ok = true; return true; }
      return t >= timeout;
    }, signal).then(() => ok);
  }

  /** calls fn every frame until it returns true */
  each(fn: (dt: number) => boolean, signal?: AbortSignal): Promise<void> {
    return this.add(fn, signal);
  }
}

// ---- easing
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (k: number) => { k = clamp01(k); return k * k * (3 - 2 * k); };
export const smoother = (k: number) => { k = clamp01(k); return k * k * k * (k * (k * 6 - 15) + 10); };
export const easeOutBack = (k: number, s = 1.5) => { k = clamp01(k) - 1; return 1 + k * k * ((s + 1) * k + s); };
export const easeOutCubic = (k: number) => 1 - (1 - clamp01(k)) ** 3;
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
