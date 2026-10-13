import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
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
// `import … from 'x'`, `export … from 'x'`, `import 'x'` and `import('x')`
const imports = (file: string) => [...readFileSync(file, 'utf8').matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)]
  .map((m) => m[1] ?? m[2] ?? m[3]).filter((s) => s.startsWith('.')).map((s) => resolve(dirname(file), s));

const GARDEN_ONLY = ['world', 'flowers', 'camera', 'ui', 'config', 'modes/garden', 'viewer'].map((d) => join(SRC, d));
const isGarden = (p: string) => GARDEN_ONLY.some((g) => p === g || p.startsWith(g + '/') || p.startsWith(g + '.'));

/** an import specifier (no extension) to the file it names */
const fileOf = (p: string) => [p, p + '.ts', p + '.tsx', join(p, 'index.ts')].find((c) => existsSync(c) && statSync(c).isFile());

describe('module boundaries', () => {
  it('the birthday room reaches nothing of the garden, directly or through shared code', () => {
    // follow every import from the room's files, through the shared modules they use
    const bad: string[] = [];
    const seen = new Set<string>();
    const visit = (file: string, via: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const imp of imports(file)) {
        const chain = [...via, file.slice(SRC.length)];
        if (isGarden(imp)) { bad.push(`${chain.join(' -> ')} -> ${imp.slice(SRC.length)}`); continue; }
        const next = fileOf(imp);
        if (next) visit(next, chain);
      }
    };
    for (const f of files(join(SRC, 'modes/birthday'))) visit(f, []);
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
    const allowed = [join(SRC, 'girl'), join(SRC, 'params')];
    for (const f of files(join(SRC, 'girl'))) for (const imp of imports(f)) expect(allowed.some((a) => imp.startsWith(a))).toBe(true);
  });
});
