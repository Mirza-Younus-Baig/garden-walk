import { describe, it, expect } from 'vitest';
import { happyBirthday, midiHz } from '../src/modes/birthday/core/song';

describe('happyBirthday score', () => {
  const s = happyBirthday('Mithra');
  it('has four lyric lines per verse, in order, the third with her name', () => {
    expect(s.lyrics).toHaveLength(8);
    expect(s.lyrics[2].text).toBe('Happy birthday dear Mithra');
    expect(s.lyrics[2].name).toBe(true);
    expect(s.lyrics.filter((l) => l.name)).toHaveLength(2);
    for (let i = 1; i < s.lyrics.length; i++) expect(s.lyrics[i].t).toBeGreaterThan(s.lyrics[i - 1].t);
  });
  it('lyric windows do not overlap, so only one line shows at a time', () => {
    for (let i = 1; i < s.lyrics.length; i++) expect(s.lyrics[i].t).toBeGreaterThanOrEqual(s.lyrics[i - 1].end - 0.2);
  });
  it('every note sits inside the song and has a sane pitch and level', () => {
    for (const n of s.notes) {
      expect(n.t).toBeGreaterThanOrEqual(0);
      expect(n.t + n.dur).toBeLessThanOrEqual(s.duration + 0.5);
      expect(n.midi).toBeGreaterThan(20); expect(n.midi).toBeLessThan(110);
      expect(n.vel).toBeGreaterThan(0); expect(n.vel).toBeLessThanOrEqual(1);
    }
  });
  it('the melody of verse one is the tune (F major, starting C C D C F E)', () => {
    const box = s.notes.filter((n) => n.voice === 'box' && n.t > 3.5).slice(0, 6).map((n) => n.midi - 12);
    expect(box).toEqual([60, 60, 62, 60, 65, 64]);
  });
  it('lasts about forty seconds', () => {
    expect(s.duration).toBeGreaterThan(30); expect(s.duration).toBeLessThan(55);
  });
  it('uses the given name', () => {
    expect(happyBirthday('Ada').lyrics[2].text).toBe('Happy birthday dear Ada');
  });
  it('tunes A4 to 440 Hz', () => { expect(midiHz(69)).toBe(440); expect(midiHz(81)).toBeCloseTo(880, 9); });
});
