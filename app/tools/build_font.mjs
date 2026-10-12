// Converts a Fredoka subset to the typeface JSON that three.js FontLoader reads, for the
// gold foil letter balloons in the birthday room.
//   node tools/build_font.mjs
import fs from 'node:fs';
import opentype from 'opentype.js';

const SRC = 'node_modules/@fontsource/fredoka/files/fredoka-latin-600-normal.woff';
const OUT = 'src/modes/birthday/assets/fredoka_600.typeface.json';
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!&\' ';

const buf = fs.readFileSync(SRC);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const scale = 1000 / font.unitsPerEm;
const r = (v) => Math.round(v * scale);
const glyphs = {};
for (const ch of CHARS) {
  const g = font.charToGlyph(ch);
  const cmds = g.getPath(0, 0, font.unitsPerEm).commands;
  // three's Font flips nothing: it expects font units with y up, and for curves the end
  // point first, then the control points.
  const o = [];
  for (const c of cmds) {
    if (c.type === 'M') o.push('m', r(c.x), r(-c.y));
    else if (c.type === 'L') o.push('l', r(c.x), r(-c.y));
    else if (c.type === 'Q') o.push('q', r(c.x), r(-c.y), r(c.x1), r(-c.y1));
    else if (c.type === 'C') o.push('b', r(c.x), r(-c.y), r(c.x1), r(-c.y1), r(c.x2), r(-c.y2));
  }
  glyphs[ch] = { ha: r(g.advanceWidth), x_min: r(g.xMin ?? 0), x_max: r(g.xMax ?? 0), o: o.join(' ') };
}
const bb = font.tables.head;
fs.writeFileSync(OUT, JSON.stringify({
  glyphs, familyName: 'Fredoka', ascender: r(font.ascender), descender: r(font.descender),
  underlinePosition: 0, underlineThickness: 0, resolution: 1000,
  boundingBox: { xMin: r(bb.xMin), yMin: r(bb.yMin), xMax: r(bb.xMax), yMax: r(bb.yMax) },
  original_font_information: { format: 0, copyright: 'Fredoka — SIL Open Font License 1.1' },
}));
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
