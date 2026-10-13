import { describe, it, expect } from 'vitest';
import { Tasks, AbortedError, isAborted, smoother, easeOutBack } from '../src/modes/birthday/core/tasks';

const flush = () => new Promise((r) => setTimeout(r, 0));
async function run(t: Tasks, seconds: number, dt = 1 / 60) {
  for (let s = 0; s < seconds; s += dt) { t.update(dt); await flush(); }
}

describe('Tasks', () => {
  it('wait resolves after its game time, not before', async () => {
    const t = new Tasks(); let done = false;
    t.wait(0.5).then(() => { done = true; });
    await run(t, 0.45); expect(done).toBe(false);
    await run(t, 0.1); expect(done).toBe(true);
  });
  it('during ends exactly on k = 1, with k rising', async () => {
    const t = new Tasks(); const ks: number[] = [];
    const p = t.during(0.3, (k) => ks.push(k));
    await run(t, 0.5); await p;
    expect(ks[ks.length - 1]).toBe(1);
    for (let i = 1; i < ks.length; i++) expect(ks[i]).toBeGreaterThanOrEqual(ks[i - 1]);
  });
  it('until reports success or timeout', async () => {
    const t = new Tasks(); let flag = false;
    const a = t.until(() => flag, 1); const b = t.until(() => false, 0.2);
    await run(t, 0.3); flag = true; await run(t, 0.05);
    expect(await a).toBe(true); expect(await b).toBe(false);
  });
  it('abort rejects a pending wait with AbortedError and drops the job', async () => {
    const t = new Tasks(); const c = new AbortController();
    const p = t.wait(5, c.signal);
    c.abort();
    await expect(p).rejects.toBeInstanceOf(AbortedError);
    expect(t.pending).toBe(0);
  });
  it('an already aborted signal rejects at once', async () => {
    const c = new AbortController(); c.abort();
    const e = await new Tasks().wait(1, c.signal).catch((x) => x);
    expect(isAborted(e)).toBe(true);
  });
  it('a sequence of steps runs in order on game time', async () => {
    const t = new Tasks(); const log: string[] = [];
    (async () => { await t.wait(0.1); log.push('a'); await t.during(0.1, () => {}); log.push('b'); })();
    await run(t, 0.5);
    expect(log).toEqual(['a', 'b']);
  });
});

describe('easing', () => {
  it('smoother pins its ends and is monotonic', () => {
    expect(smoother(0)).toBe(0); expect(smoother(1)).toBe(1);
    let prev = 0; for (let k = 0; k <= 1; k += 0.01) { const v = smoother(k); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
  });
  it('easeOutBack overshoots and lands on 1', () => {
    expect(easeOutBack(1)).toBeCloseTo(1, 9);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => easeOutBack(i / 49)))).toBeGreaterThan(1);
  });
});
