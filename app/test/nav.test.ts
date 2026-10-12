import { describe, it, expect } from 'vitest';
import { NavWorld, box, circle, separation } from '../src/modes/birthday/core/nav';

const bounds = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 };

describe('separation', () => {
  it('is null when clear of a box', () => {
    expect(separation(box(0, 0, 1, 1), 2, 0, 0.2)).toBeNull();
  });
  it('pushes out of a box face by exactly the overlap', () => {
    const s = separation(box(0, 0, 1, 1), 0.6, 0, 0.2)!;
    expect(s.x).toBeCloseTo(0.1, 6);
    expect(s.z).toBeCloseTo(0, 6);
  });
  it('leaves by the nearest face when the centre is inside', () => {
    const s = separation(box(0, 0, 2, 1), 0.1, 0.4, 0.2)!;
    // nearest face is +z (0.1 away), so it moves +z by 0.1 + r
    expect(s.x).toBeCloseTo(0, 6);
    expect(s.z).toBeCloseTo(0.3, 6);
  });
  it('respects box rotation (three.js rotation.y convention)', () => {
    // a 2 x 0.2 box turned a quarter: it now runs along z
    const b = box(0, 0, 2, 0.2, Math.PI / 2);
    expect(separation(b, 0, 0.9, 0.05)).not.toBeNull();
    expect(separation(b, 0.9, 0, 0.05)).toBeNull();
  });
  it('pushes out of a circle radially', () => {
    const s = separation(circle(0, 0, 1), 0.5, 0, 0.2)!;
    expect(s.x).toBeCloseTo(0.7, 6);
  });
});

describe('NavWorld.resolve', () => {
  const nav = new NavWorld(bounds, [box(0, 0, 1, 1), circle(2, 2, 0.3)], 0.2);
  it('keeps a free point where it is', () => {
    const p = { x: -2, z: -2 }; nav.resolve(p);
    expect(p).toEqual({ x: -2, z: -2 });
  });
  it('slides along a face: only the blocked axis changes', () => {
    const p = { x: 0.65, z: 0.1 }; nav.resolve(p);
    expect(p.x).toBeCloseTo(0.7, 6);
    expect(p.z).toBeCloseTo(0.1, 6);
  });
  it('keeps her inside the walls', () => {
    const p = { x: 5, z: -9 }; nav.resolve(p);
    expect(p.x).toBeCloseTo(2.8, 6); expect(p.z).toBeCloseTo(-2.8, 6);
  });
  it('never leaves a point inside anything after resolving', () => {
    for (let i = 0; i < 400; i++) {
      const p = { x: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 };
      nav.resolve(p);
      expect(nav.blocked(p.x, p.z, -1e-6)).toBe(false);
    }
  });
});

describe('NavWorld.findPath', () => {
  // a wall across the middle with a gap at +x
  const nav = new NavWorld(bounds, [box(-0.6, 0, 4.8, 0.3)], 0.2, 0.1);
  it('goes straight when the line is clear', () => {
    expect(nav.findPath({ x: -2, z: -2 }, { x: 2, z: -2 })).toEqual([{ x: 2, z: -2 }]);
  });
  it('goes round an obstacle, every leg clear', () => {
    const from = { x: -2, z: -1.5 }, to = { x: -2, z: 1.5 };
    const path = nav.findPath(from, to)!;
    expect(path.length).toBeGreaterThan(1);
    let a = from;
    for (const b of path) { expect(nav.lineClear(a, b)).toBe(true); a = b; }
    expect(path[path.length - 1]).toEqual(to);
  });
  it('ends at the nearest free spot when the goal is blocked', () => {
    const path = nav.findPath({ x: -2, z: -1.5 }, { x: -1, z: 0 })!;
    const end = path[path.length - 1];
    expect(nav.blocked(end.x, end.z, -1e-3)).toBe(false);
    expect(Math.hypot(end.x + 1, end.z)).toBeLessThan(0.45);
  });
  it('returns null when the goal is sealed off', () => {
    const sealed = new NavWorld(bounds, [box(0, 0, 6, 0.4)], 0.2, 0.1);
    expect(sealed.findPath({ x: 0, z: -2 }, { x: 0, z: 2 })).toBeNull();
  });
});
