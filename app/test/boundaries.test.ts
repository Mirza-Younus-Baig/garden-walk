import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

/**
 * The birthday room is its own module: it may use the shared pieces (the girl, input,
 * touch helpers, the menu) but never the garden's world, flowers, camera, UI or config,
 * and the garden never reaches into the room.
 */
const SRC = resolve(__dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
});
const imports = (file: string) => [...readFileSync(file, 'utf8').matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)]
  .map((m) => m[1] ?? m[2]).filter((s) => s.startsWith('.')).map((s) => resolve(dirname(file), s));

const GARDEN_ONLY = ['world', 'flowers', 'camera', 'ui', 'config', 'modes/garden', 'viewer'].map((d) => join(SRC, d));

describe('module boundaries', () => {
  it('the birthday room imports nothing from the garden', () => {
    const bad: string[] = [];
    for (const f of files(join(SRC, 'modes/birthday'))) for (const imp of imports(f)) {
      if (GARDEN_ONLY.some((g) => imp === g || imp.startsWith(g + '/') || imp.startsWith(g + '.'))) bad.push(`${f.slice(SRC.length)} -> ${imp.slice(SRC.length)}`);
    }
    expect(bad).toEqual([]);
  });
  it('nothing outside the room imports the room, except the entry point', () => {
    const room = join(SRC, 'modes/birthday');
    const bad: string[] = [];
    for (const f of files(SRC)) {
      if (f.startsWith(room) || f === join(SRC, 'main.ts')) continue;
      for (const imp of imports(f)) if (imp.startsWith(room)) bad.push(f.slice(SRC.length));
    }
    expect(bad).toEqual([]);
  });
  it('the shared girl depends on nothing mode-specific', () => {
    for (const f of files(join(SRC, 'girl'))) for (const imp of imports(f)) expect(imp.startsWith(join(SRC, 'girl'))).toBe(true);
  });
});
