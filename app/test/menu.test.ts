import { describe, it, expect } from 'vitest';

// the menu module touches the DOM only inside its functions; these two are pure
(globalThis as any).location = { pathname: '/', search: '' };
const { modeFromUrl, urlForMode } = await import('../src/menu/menu.ts?pure');

describe('mode routing', () => {
  it('reads known modes and nothing else', () => {
    expect(modeFromUrl('?mode=garden')).toBe('garden');
    expect(modeFromUrl('?mode=birthday&name=Ada')).toBe('birthday');
    expect(modeFromUrl('?mode=nope')).toBeNull();
    expect(modeFromUrl('')).toBeNull();
  });
  it('keeps other parameters when switching mode', () => {
    expect(urlForMode('birthday', '?name=Ada&touch')).toBe('?name=Ada&touch=&mode=birthday');
    expect(urlForMode(null, '?mode=garden&name=Ada')).toBe('?name=Ada');
    expect(urlForMode(null, '?mode=garden')).toBe('/');
  });
});
