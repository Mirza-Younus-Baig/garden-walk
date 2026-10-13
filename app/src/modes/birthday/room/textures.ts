import * as THREE from 'three';

/**
 * Surface textures, painted in code at load: wood, plaster, velvet, knit, rug.
 *
 * Every pattern tiles seamlessly (the noise is periodic over the tile), and each comes as
 * a set: colour (sRGB), roughness and a normal map derived from the same height field, so
 * the light catches the plank seams and the weave where the colour says they are.
 */

let ANISO = 8;
export function setAnisotropy(n: number) { ANISO = n; }

// ---------------------------------------------------------------- noise
const hash = (x: number, y: number, s: number) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fade = (t: number) => t * t * (3 - 2 * t);

/** value noise, periodic with period (px, py) lattice cells */
export function vnoise(x: number, y: number, px: number, py: number, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = fade(x - xi), fy = fade(y - yi);
  const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** fractal value noise on the unit tile [0,1)^2, seamless; result roughly in [0,1] */
export function fbm(u: number, v: number, freq: number, octaves = 4, seed = 0, fx = freq, fy = freq) {
  let amp = 0.5, sum = 0, norm = 0, ax = fx, ay = fy;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(u * ax, v * ay, ax, ay, seed + o * 17);
    norm += amp; amp *= 0.5; ax *= 2; ay *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- canvas plumbing
export function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat: [number, number] = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = ANISO;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** height field (row-major, w*h) to a tangent-space normal map; wraps at the edges */
export function normalFromHeight(hgt: Float32Array, w: number, h: number, strength: number) {
  const c = canvas(w, h), ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = hgt[y * w + ((x - 1 + w) % w)], r = hgt[y * w + ((x + 1) % w)];
    const u = hgt[((y - 1 + h) % h) * w + x], dn = hgt[((y + 1) % h) * w + x];
    // canvas rows run down the texture; three's +v runs up it
    let nx = (l - r) * strength, ny = (dn - u) * strength, nz = 1;
    const k = 1 / Math.sqrt(nx * nx + ny * ny + 1);   // (Math.hypot is several times slower)
    nx *= k; ny *= k; nz *= k;
    const i = (y * w + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function fillRGB(w: number, h: number, fn: (x: number, y: number, out: number[]) => void) {
  const c = canvas(w, h), ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h), d = img.data;
  const px = [0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    fn(x, y, px);
    const i = (y * w + x) * 4;
    d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const grey = (fn: (x: number, y: number) => number, w: number, h = w) =>
  fillRGB(w, h, (x, y, o) => { const g = Math.max(0, Math.min(255, fn(x, y) * 255)); o[0] = o[1] = o[2] = g; });

export interface TexSet { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture }

// ---------------------------------------------------------------- wood floor
/**
 * Oak planks, warm and slightly honeyed. One tile holds 6 plank rows by 2 lengths, with
 * the butt joints staggered; each plank has its own tone, and its grain runs along it.
 */
export function woodFloor(size = 1024): TexSet {
  const rows = 8, w = size, h = size;
  const hgt = new Float32Array(w * h);
  const col = new Float32Array(w * h * 3);
  const rough = new Float32Array(w * h);
  const plankTone: number[][] = [];
  for (let r = 0; r < rows * 4; r++) {
    // planks differ in brightness and a little in warmth, never in hue
    const b = 0.82 + 0.2 * hash(r, 7, 3), warm = 0.97 + 0.06 * hash(r, 9, 1);
    plankTone.push([b * warm, b, b * (2 - warm)]);
  }
  for (let y = 0; y < h; y++) {
    const v = y / h;
    const row = Math.floor(v * rows), inRow = v * rows - row;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const offset = (row * 0.37) % 1;
      const uu = (u + offset) % 1;
      const seg = Math.floor(uu * 1), inSeg = uu - seg;
      const id = row * 4 + seg;
      // grain: long stretched noise plus ring lines
      const n1 = fbm((u + id * 0.37) % 1, v, 2, 4, 11, 2, 24);
      const ring = Math.sin((inRow * 7 + n1 * 9 + hash(id, 2, 2) * 6) * Math.PI * 2);
      const fleck = fbm(u, v, 64, 2, 5, 64, 16);
      const grain = 0.55 + 0.25 * n1 + 0.1 * ring + 0.1 * fleck;
      // seams: a soft groove at the plank edges
      const eRow = Math.min(inRow, 1 - inRow) * h / rows, eSeg = Math.min(inSeg, 1 - inSeg) * w;
      const seam = Math.min(1, Math.min(eRow, eSeg) / 1.6);
      const i = y * w + x;
      hgt[i] = seam * 0.8 + grain * 0.12;
      const tone = plankTone[id];
      const k = (0.7 + 0.3 * grain) * (0.45 + 0.55 * seam);
      col[i * 3] = 190 * tone[0] * k; col[i * 3 + 1] = 132 * tone[1] * k; col[i * 3 + 2] = 86 * tone[2] * k;
      rough[i] = 0.42 + 0.18 * (1 - grain) + (1 - seam) * 0.3;
    }
  }
  const map = fillRGB(w, h, (x, y, o) => { const i = (y * w + x) * 3; o[0] = col[i]; o[1] = col[i + 1]; o[2] = col[i + 2]; });
  return {
    map: toTexture(map, true),
    normal: toTexture(normalFromHeight(hgt, w, h, 2.2), false),
    rough: toTexture(grey((x, y) => rough[y * w + x], w, h), false),
  };
}

// ---------------------------------------------------------------- plaster
/** a smooth painted wall: barely-there mottling, so a raking light shows it is a wall */
export function plaster(size = 512): TexSet {
  const w = size, hgt = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) hgt[y * w + x] = fbm(x / w, y / w, 6, 5, 21);
  return {
    map: toTexture(grey((x, y) => 0.93 + 0.07 * hgt[y * w + x], w), true),
    normal: toTexture(normalFromHeight(hgt, w, w, 1.2), false),
    rough: toTexture(grey((x, y) => 0.82 + 0.1 * hgt[y * w + x], w), false),
  };
}

// ---------------------------------------------------------------- fabrics
/** velvet: a fine weave and soft crushed patches, near-white so the material colour tints it */
export function velvet(size = 512): TexSet {
  const w = size, hgt = new Float32Array(w * w), crush = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const weave = (Math.sin(x / w * Math.PI * 2 * 160) * Math.sin(y / w * Math.PI * 2 * 160)) * 0.5 + 0.5;
    const c = fbm(x / w, y / w, 5, 4, 31);
    crush[y * w + x] = c;
    hgt[y * w + x] = weave * 0.25 + c * 0.6;
  }
  return {
    map: toTexture(grey((x, y) => 0.86 + 0.14 * crush[y * w + x], w), true),
    normal: toTexture(normalFromHeight(hgt, w, w, 1.6), false),
    rough: toTexture(grey((x, y) => 0.75 + 0.2 * crush[y * w + x], w), false),
  };
}

/** chunky knit: columns of V stitches */
export function knit(size = 512): TexSet {
  const w = size, cols = 16, rowsN = 24, hgt = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const cu = (x / w) * cols, cv = (y / w) * rowsN;
    const fu = cu - Math.floor(cu), fv = cv - Math.floor(cv);
    // each stitch is two slanted lobes meeting in a V
    const side = fu < 0.5 ? fu * 2 : (1 - fu) * 2;
    const lobe = Math.sin(Math.PI * Math.min(1, Math.max(0, fv + side * 0.6 - 0.15)));
    hgt[y * w + x] = Math.max(0, lobe) * Math.sin(Math.PI * fu) ** 0.4;
  }
  return {
    map: toTexture(grey((x, y) => 0.72 + 0.28 * hgt[y * w + x], w), true),
    normal: toTexture(normalFromHeight(hgt, w, w, 3.5), false),
    rough: toTexture(grey(() => 0.92, 8), false),
  };
}

// ---------------------------------------------------------------- rug
/**
 * A soft wool rug: cream field, a terracotta and sage border with a dotted inner band, and
 * a rounded medallion. Drawn with canvas shapes, then given a wool pile.
 */
export function rug(wPx = 1024, hPx = 768): TexSet {
  const c = canvas(wPx, hPx), ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#efe3d0'; ctx.fillRect(0, 0, wPx, hPx);
  const band = (inset: number, width: number, color: string) => {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.strokeRect(inset + width / 2, inset + width / 2, wPx - 2 * inset - width, hPx - 2 * inset - width);
  };
  band(10, 46, '#b86b4b');
  band(64, 10, '#7f9a7b');
  // a row of diamonds between the bands
  ctx.fillStyle = '#d99a7c';
  const diamonds = (y: number) => { for (let x = 90; x < wPx - 80; x += 34) { ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.fill(); } };
  diamonds(96); diamonds(hPx - 96);
  for (let y = 130; y < hPx - 120; y += 34) for (const x of [96, wPx - 96]) { ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.fill(); }
  band(118, 6, '#b86b4b');
  // medallion
  const cx = wPx / 2, cy = hPx / 2;
  for (const [r, col] of [[190, '#e2c7ae'], [150, '#efe3d0'], [120, '#c98e6f'], [86, '#efe3d0'], [56, '#7f9a7b'], [24, '#efe3d0']] as const) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.25, r, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#b86b4b';
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * 170 * 1.25, cy + Math.sin(a) * 170, 10, 10, 0, 0, Math.PI * 2); ctx.fill();
  }
  // corner sprigs
  ctx.strokeStyle = '#7f9a7b'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (const [x, y, sx, sy] of [[170, 170, 1, 1], [wPx - 170, 170, -1, 1], [170, hPx - 170, 1, -1], [wPx - 170, hPx - 170, -1, -1]]) {
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + sx * (30 + k * 18), y + sy * 10, x + sx * (40 + k * 22), y + sy * (40 - k * 12)); ctx.stroke(); }
  }
  // wool: per-pixel pile noise over the design, and a little colour wander
  const img = ctx.getImageData(0, 0, wPx, hPx), d = img.data;
  const hgt = new Float32Array(wPx * hPx);
  for (let y = 0; y < hPx; y++) for (let x = 0; x < wPx; x++) {
    const n = fbm(x / wPx, y / hPx, 96, 3, 41, 96, 72), m = fbm(x / wPx, y / hPx, 6, 3, 43, 6, 5);
    const i = (y * wPx + x) * 4, k = 0.86 + 0.16 * n + 0.06 * (m - 0.5);
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    hgt[y * wPx + x] = n;
  }
  ctx.putImageData(img, 0, 0);
  const rough = grey(() => 0.95, 8);
  return { map: toTexture(c, true), normal: toTexture(normalFromHeight(hgt, wPx, hPx, 2.5), false), rough: toTexture(rough, false) };
}

// ---------------------------------------------------------------- furniture wood
/** walnut: dark, straight-grained, for the table, the TV stand and the frames */
export function walnut(size = 512, tone: [number, number, number] = [112, 72, 46]): TexSet {
  const w = size, hgt = new Float32Array(w * w);
  const map = fillRGB(w, w, (x, y, o) => {
    const u = x / w, v = y / w;
    const n = fbm(u, v, 3, 4, 51, 3, 20);
    const ring = Math.sin((u * 9 + n * 6) * Math.PI * 2) * 0.5 + 0.5;
    const pore = fbm(u, v, 128, 1, 53, 128, 32);
    const g = 0.6 + 0.25 * n + 0.15 * ring * ring - 0.08 * pore;
    hgt[y * w + x] = g * 0.3 + pore * 0.2;
    o[0] = tone[0] * g * 1.2; o[1] = tone[1] * g * 1.2; o[2] = tone[2] * g * 1.2;
  });
  return {
    map: toTexture(map, true),
    normal: toTexture(normalFromHeight(hgt, w, w, 1.2), false),
    rough: toTexture(grey((x, y) => 0.45 + 0.2 * hgt[y * w + x], w), false),
  };
}

/** a soft radial glow, for flames, bulbs and sparkles */
export function glowSprite(size = 128, inner = 'rgba(255,240,200,1)', outer = 'rgba(255,170,80,0)') {
  const c = canvas(size), ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)')); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a four-point star sparkle */
export function sparkleSprite(size = 128) {
  const c = canvas(size), ctx = c.getContext('2d')!, m = size / 2;
  const g = ctx.createRadialGradient(m, m, 0, m, m, m * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,230,180,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,250,235,0.95)';
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, r = k % 2 === 0 ? m * 0.95 : m * 0.09;
    ctx.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r);
  }
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
