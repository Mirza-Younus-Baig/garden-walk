import { describe, it, expect } from 'vitest';
import { chooseFocus, focusScore, KEEP } from '../src/modes/birthday/core/focus';

const cake = { id: 'cake', x: 0, z: 1, radius: 1.2 };
const sofa = { id: 'sofa', x: 1, z: 0, radius: 1.2 };

describe('chooseFocus', () => {
  it('is null when nothing is in reach', () => {
    expect(chooseFocus([cake, sofa], 5, 5, 0, null)).toBeNull();
  });
  it('prefers what she faces over what is behind her', () => {
    // yaw 0 faces +z: the cake is ahead, the sofa to the side
    expect(chooseFocus([cake, sofa], 0, 0, 0, null)).toBe('cake');
    expect(chooseFocus([cake, sofa], 0, 0, Math.PI / 2, null)).toBe('sofa');
  });
  it('keeps the current focus a little beyond its reach (no flicker at the edge)', () => {
    const d = cake.radius * (1 + (KEEP - 1) / 2);
    expect(chooseFocus([cake], 0, 1 - d, 0, null)).toBeNull();
    expect(chooseFocus([cake], 0, 1 - d, 0, 'cake')).toBe('cake');
  });
  it('holds through a near tie', () => {
    const a = { id: 'a', x: -0.5, z: 1, radius: 2 }, b = { id: 'b', x: 0.5, z: 1, radius: 2 };
    const sa = focusScore(a, 0.01, 0, 0), sb = focusScore(b, 0.01, 0, 0);
    expect(Math.abs(sa - sb)).toBeLessThan(0.1);
    expect(chooseFocus([a, b], 0.01, 0, 0, 'a')).toBe('a');
    expect(chooseFocus([a, b], 0.01, 0, 0, 'b')).toBe('b');
  });
});
