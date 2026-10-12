import { describe, it, expect } from 'vitest';
import { foldForFont } from '../src/modes/birthday/room/decor';
import font from '../src/modes/birthday/assets/fredoka_600.typeface.json';

const glyphs = (font as any).glyphs as Record<string, unknown>;

describe('foldForFont (the gold letter balloons)', () => {
  it('upper-cases a plain name', () => { expect(foldForFont('Mithra', glyphs)).toBe('MITHRA'); });
  it('folds accents rather than failing on them', () => {
    expect(foldForFont('Zoë', glyphs)).toBe('ZOE');
    expect(foldForFont('José', glyphs)).toBe('JOSE');
    expect(foldForFont('Chloé', glyphs)).toBe('CHLOE');
  });
  it('keeps single spaces between words and trims the ends', () => {
    expect(foldForFont('  mary   ann ', glyphs)).toBe('MARY ANN');
  });
  it('drops characters the font cannot draw', () => {
    expect(foldForFont('Anne-Marie', glyphs)).toBe('ANNEMARIE');
    expect(foldForFont('李', glyphs)).toBe('');
  });
  it('only ever returns characters that exist in the font', () => {
    for (const n of ['Ægir', 'Øyvind', 'Søren 2', 'Mithra!', '😀Ana']) {
      for (const c of foldForFont(n, glyphs)) expect(c === ' ' || c in glyphs).toBe(true);
    }
  });
});
