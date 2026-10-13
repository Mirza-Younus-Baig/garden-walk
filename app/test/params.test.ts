import { describe, it, expect, afterEach } from 'vitest';
import { flag, param, nameParam, DEFAULT_NAME, MAX_NAME } from '../src/params';
import { happyBirthday } from '../src/modes/birthday/core/song';

const at = (search: string) => { (globalThis as any).location = { pathname: '/', search }; };
afterEach(() => { delete (globalThis as any).location; });

describe('query flags', () => {
  it('match whole parameter names, not parts of other values', () => {
    at('?mode=garden&name=devika&notouchy=1');
    expect(flag('dev')).toBe(false);
    expect(flag('touch')).toBe(false);
    at('?mode=garden&dev&noao=');
    expect(flag('dev')).toBe(true);
    expect(flag('noao')).toBe(true);
    expect(param('mode')).toBe('garden');
    expect(param('pr')).toBeNull();
  });
  it('read as off with no page at all (tests, tools)', () => {
    expect(flag('dev')).toBe(false);
    expect(nameParam()).toBe(DEFAULT_NAME);
  });
});

describe('the name', () => {
  it('falls back when missing or blank', () => {
    expect(nameParam('')).toBe(DEFAULT_NAME);
    expect(nameParam('?name=')).toBe(DEFAULT_NAME);
    expect(nameParam('?name=%20%20')).toBe(DEFAULT_NAME);
  });
  it('is trimmed and capped', () => {
    expect(nameParam('?name=%20Ada%20')).toBe('Ada');
    expect(nameParam('?name=' + 'x'.repeat(40))).toHaveLength(MAX_NAME);
  });
  it('goes into the song literally, special characters and all', () => {
    const name = "Ana$&$'$$";
    const line = happyBirthday(name).lyrics.find((l) => l.name)!;
    expect(line.text).toContain(name);
    expect(line.text).not.toContain('{name}');
  });
});
