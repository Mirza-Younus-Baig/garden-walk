import * as THREE from 'three';
import { canvas, fbm } from './textures';
import { Batcher, std, phys } from './build';

/**
 * Original paintings for the walls, drawn in code: a composition in flat shapes, then a
 * "paint" pass that lays thousands of short strokes over it in the colours underneath,
 * following a flow field, so it reads as brushwork rather than vector art. Finished with a
 * canvas weave and a little varnish sheen from the material.
 */

type Ctx = CanvasRenderingContext2D;
let rs = 1;
const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
const seed = (n: number) => { rs = n; };

// ---------------------------------------------------------------- painting helpers
function grad(ctx: Ctx, y0: number, y1: number, stops: Array<[number, string]>) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function blob(ctx: Ctx, x: number, y: number, r: number, wobble = 0.15, n = 24) {
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, k = 1 + wobble * Math.sin(a * 3 + x) * Math.cos(a * 2 + y);
    const px = x + Math.cos(a) * r * k, py = y + Math.sin(a) * r * k;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
function hills(ctx: Ctx, w: number, base: number, amp: number, freq: number, phase: number, fill: string | CanvasGradient, h: number) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) ctx.lineTo(x, base - amp * Math.sin(x / w * Math.PI * freq + phase) - amp * 0.3 * Math.sin(x / w * 13 + phase * 2));
  ctx.lineTo(w, h); ctx.fill();
}
function cloud(ctx: Ctx, x: number, y: number, s: number, col: string) {
  ctx.fillStyle = col;
  for (const [dx, dy, r] of [[0, 0, 1], [0.9, 0.1, 0.8], [-0.9, 0.15, 0.75], [0.4, -0.45, 0.7], [-0.4, -0.35, 0.65]]) {
    ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); ctx.fill();
  }
}

/** lay brush strokes over the composition in its own colours */
function paintify(c: HTMLCanvasElement, strokes: number, len: number, width: number, flow = 3) {
  const ctx = c.getContext('2d', { willReadFrequently: true })!, w = c.width, h = c.height;
  const src = ctx.getImageData(0, 0, w, h).data;
  ctx.lineCap = 'round';
  for (let i = 0; i < strokes; i++) {
    const x = rnd() * w, y = rnd() * h;
    const idx = ((y | 0) * w + (x | 0)) * 4;
    const r = src[idx], g = src[idx + 1], b = src[idx + 2];
    const a = fbm(x / w, y / h, flow, 2, 9) * Math.PI * 2;
    const l = len * (0.5 + rnd());
    const j = (rnd() - 0.5) * 14;
    ctx.strokeStyle = `rgba(${r + j},${g + j},${b + j},0.55)`;
    ctx.lineWidth = width * (0.6 + rnd() * 0.8);
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(a) * l / 2, y - Math.sin(a) * l / 2);
    ctx.quadraticCurveTo(x + Math.sin(a) * l * 0.15, y - Math.cos(a) * l * 0.15, x + Math.cos(a) * l / 2, y + Math.sin(a) * l / 2);
    ctx.stroke();
  }
  // canvas weave
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = 1 + 0.035 * Math.sin(x * 1.9) * Math.sin(y * 1.9) + 0.02 * (rnd() - 0.5);
    const i = (y * w + x) * 4;
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- the paintings
/** a cat on a rooftop, looking up at a big moon */
function catAndMoon(): HTMLCanvasElement {
  seed(11);
  const w = 640, h = 800, c = canvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = grad(ctx, 0, h, [[0, '#101a46'], [0.55, '#2a3a7a'], [1, '#5a5aa0']]); ctx.fillRect(0, 0, w, h);
  const mx = w * 0.6, my = h * 0.3;
  const halo = ctx.createRadialGradient(mx, my, 60, mx, my, 260);
  halo.addColorStop(0, 'rgba(255,236,190,0.5)'); halo.addColorStop(1, 'rgba(255,236,190,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fbeec8'; ctx.beginPath(); ctx.arc(mx, my, 130, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(220,200,150,0.35)';
  for (const [dx, dy, r] of [[-40, -30, 22], [30, 40, 30], [50, -50, 14], [-20, 60, 12]]) { ctx.beginPath(); ctx.arc(mx + dx, my + dy, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#fff6da';
  for (let i = 0; i < 60; i++) { ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h * 0.6, rnd() * 2.4 + 0.6, 0, Math.PI * 2); ctx.fill(); }
  // roofs
  ctx.fillStyle = '#1c1a33';
  ctx.beginPath(); ctx.moveTo(0, h * 0.78); ctx.lineTo(w * 0.42, h * 0.66); ctx.lineTo(w * 0.85, h * 0.76); ctx.lineTo(w, h * 0.74); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
  ctx.fillRect(w * 0.66, h * 0.6, 44, 90);
  ctx.fillStyle = '#ffcf73'; ctx.fillRect(w * 0.18, h * 0.84, 40, 50); ctx.fillRect(w * 0.7, h * 0.86, 36, 46);
  ctx.fillStyle = '#1c1a33'; ctx.fillRect(w * 0.18 + 18, h * 0.84, 4, 50); ctx.fillRect(w * 0.18, h * 0.84 + 23, 40, 4);
  // the cat, sitting on the ridge, looking up at the moon
  const cx = w * 0.4, cy = h * 0.66;
  ctx.fillStyle = '#0d0c1c';
  ctx.beginPath(); ctx.ellipse(cx, cy - 46, 34, 48, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 10, cy - 104, 26, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx - 8, cy - 118); ctx.lineTo(cx - 2, cy - 146); ctx.lineTo(cx + 10, cy - 124); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx + 16, cy - 124); ctx.lineTo(cx + 30, cy - 148); ctx.lineTo(cx + 34, cy - 116); ctx.fill();
  ctx.lineWidth = 12; ctx.strokeStyle = '#0d0c1c'; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 28, cy - 8); ctx.bezierCurveTo(cx - 90, cy - 4, cx - 80, cy - 70, cx - 52, cy - 64); ctx.stroke();
  paintify(c, 9000, 16, 4, 2);
  return c;
}

/** hot-air balloons drifting over spring hills at sunrise */
function balloonsOverHills(): HTMLCanvasElement {
  seed(23);
  const w = 900, h = 630, c = canvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = grad(ctx, 0, h, [[0, '#9fc9e8'], [0.45, '#f6d6c5'], [0.7, '#fbe4b8'], [1, '#fff1d6']]); ctx.fillRect(0, 0, w, h);
  cloud(ctx, w * 0.2, h * 0.2, 36, 'rgba(255,255,255,0.8)'); cloud(ctx, w * 0.78, h * 0.14, 30, 'rgba(255,255,255,0.75)');
  hills(ctx, w, h * 0.72, 30, 2, 0.3, '#a9c98f', h);
  hills(ctx, w, h * 0.8, 26, 3, 1.4, '#88b277', h);
  hills(ctx, w, h * 0.9, 20, 2.4, 2.4, '#6c9a62', h);
  // trees
  for (let i = 0; i < 9; i++) { const x = 40 + i * 100 + rnd() * 30, y = h * 0.84 + rnd() * 20; ctx.fillStyle = '#4f7d4b'; blob(ctx, x, y, 14 + rnd() * 6); ctx.fill(); }
  const balloon = (x: number, y: number, s: number, cols: string[]) => {
    for (let k = 0; k < cols.length; k++) {
      ctx.fillStyle = cols[k];
      ctx.beginPath();
      const a0 = -Math.PI / 2 - Math.PI / 2 + (k / cols.length) * Math.PI, a1 = a0 + Math.PI / cols.length;
      ctx.moveTo(x, y + s * 1.2);
      ctx.ellipse(x, y, s, s * 1.08, 0, a0 + Math.PI, a1 + Math.PI);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.ellipse(x - s * 0.35, y - s * 0.4, s * 0.18, s * 0.35, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6b4a35'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - s * 0.45, y + s * 0.9); ctx.lineTo(x - s * 0.18, y + s * 1.45); ctx.moveTo(x + s * 0.45, y + s * 0.9); ctx.lineTo(x + s * 0.18, y + s * 1.45); ctx.stroke();
    ctx.fillStyle = '#8a5a3c'; ctx.fillRect(x - s * 0.2, y + s * 1.45, s * 0.4, s * 0.28);
  };
  balloon(w * 0.3, h * 0.36, 62, ['#ef7f74', '#fbd36b', '#ef7f74', '#fbd36b', '#ef7f74', '#fbd36b']);
  balloon(w * 0.62, h * 0.24, 44, ['#7fb3e0', '#ffffff', '#7fb3e0', '#ffffff', '#7fb3e0']);
  balloon(w * 0.82, h * 0.44, 30, ['#c79ae0', '#ffb3c7', '#c79ae0', '#ffb3c7']);
  ctx.strokeStyle = '#5b5b6b'; ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) { const x = w * 0.48 + i * 22, y = h * 0.14 + (i % 2) * 8; ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.quadraticCurveTo(x - 3, y - 5, x, y); ctx.quadraticCurveTo(x + 3, y - 5, x + 7, y); ctx.stroke(); }
  paintify(c, 12000, 18, 4.5, 3);
  return c;
}

/** a red-and-white lighthouse on a cliff, beam sweeping over a calm evening sea */
function lighthouse(): HTMLCanvasElement {
  seed(31);
  const w = 640, h = 640, c = canvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = grad(ctx, 0, h, [[0, '#28426e'], [0.5, '#e69a7b'], [0.62, '#f6c58f'], [1, '#2f5f7c']]); ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = grad(ctx, h * 0.62, h, [[0, '#4f86a3'], [1, '#1f4058']]); ctx.fillRect(0, h * 0.62, w, h);
  ctx.strokeStyle = 'rgba(255,220,180,0.55)'; ctx.lineWidth = 2;
  for (let i = 0; i < 40; i++) { const y = h * 0.64 + rnd() * h * 0.34, x = rnd() * w; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 20 + rnd() * 40, y); ctx.stroke(); }
  // cliff
  ctx.fillStyle = '#3e3a36'; ctx.beginPath(); ctx.moveTo(w * 0.45, h); ctx.lineTo(w * 0.5, h * 0.7); ctx.lineTo(w * 0.62, h * 0.62); ctx.lineTo(w, h * 0.6); ctx.lineTo(w, h); ctx.fill();
  ctx.fillStyle = '#5f8a4e'; ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.7); ctx.lineTo(w * 0.62, h * 0.62); ctx.lineTo(w, h * 0.6); ctx.lineTo(w, h * 0.64); ctx.lineTo(w * 0.6, h * 0.67); ctx.fill();
  // beam
  const lx = w * 0.76, ly = h * 0.24;
  const beam = ctx.createLinearGradient(lx, ly, 0, ly + 60);
  beam.addColorStop(0, 'rgba(255,240,200,0.7)'); beam.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(lx, ly - 6); ctx.lineTo(0, ly - 80); ctx.lineTo(0, ly + 70); ctx.lineTo(lx, ly + 8); ctx.fill();
  // tower: stripes
  const base = h * 0.62, top = h * 0.27;
  for (let k = 0; k < 5; k++) {
    const y0 = base - (base - top) * (k / 5), y1 = base - (base - top) * ((k + 1) / 5);
    const wb = 34 - (k / 5) * 12, wt = 34 - ((k + 1) / 5) * 12;
    ctx.fillStyle = k % 2 ? '#f4efe6' : '#d6463e';
    ctx.beginPath(); ctx.moveTo(lx - wb, y0); ctx.lineTo(lx + wb, y0); ctx.lineTo(lx + wt, y1); ctx.lineTo(lx - wt, y1); ctx.fill();
  }
  ctx.fillStyle = '#2b2b33'; ctx.fillRect(lx - 26, top - 4, 52, 6);
  ctx.fillStyle = '#ffe9a8'; ctx.fillRect(lx - 16, top - 34, 32, 30);
  ctx.fillStyle = '#d6463e'; ctx.beginPath(); ctx.moveTo(lx - 22, top - 34); ctx.lineTo(lx, top - 58); ctx.lineTo(lx + 22, top - 34); ctx.fill();
  // gulls
  ctx.strokeStyle = '#f7efe6'; ctx.lineWidth = 2.5;
  for (const [x, y] of [[180, 140], [230, 170], [140, 190]]) { ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.quadraticCurveTo(x - 5, y - 7, x, y); ctx.quadraticCurveTo(x + 5, y - 7, x + 10, y); ctx.stroke(); }
  paintify(c, 9000, 15, 4, 3);
  return c;
}

/** a whale swimming through pink clouds; a little figure flies a kite on a hill below */
function whaleInClouds(): HTMLCanvasElement {
  seed(47);
  const w = 1000, h = 640, c = canvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = grad(ctx, 0, h, [[0, '#f7c6d0'], [0.5, '#fbe3d6'], [1, '#fff4e6']]); ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 7; i++) cloud(ctx, rnd() * w, h * 0.2 + rnd() * h * 0.5, 30 + rnd() * 30, 'rgba(255,255,255,0.75)');
  // whale
  const wx = w * 0.46, wy = h * 0.4;
  ctx.fillStyle = '#6f87c4';
  ctx.beginPath();
  ctx.moveTo(wx - 230, wy + 10);
  ctx.bezierCurveTo(wx - 210, wy - 110, wx + 120, wy - 120, wx + 200, wy - 20);
  ctx.bezierCurveTo(wx + 260, wy - 50, wx + 300, wy - 110, wx + 330, wy - 100);
  ctx.bezierCurveTo(wx + 310, wy - 50, wx + 300, wy - 10, wx + 330, wy + 40);
  ctx.bezierCurveTo(wx + 290, wy + 30, wx + 250, wy + 10, wx + 200, wy + 30);
  ctx.bezierCurveTo(wx + 100, wy + 110, wx - 180, wy + 110, wx - 230, wy + 10);
  ctx.fill();
  ctx.fillStyle = '#eef0ff';
  ctx.beginPath(); ctx.moveTo(wx - 220, wy + 25); ctx.bezierCurveTo(wx - 140, wy + 100, wx + 100, wy + 95, wx + 190, wy + 35); ctx.bezierCurveTo(wx + 60, wy + 60, wx - 120, wy + 60, wx - 220, wy + 25); ctx.fill();
  ctx.strokeStyle = 'rgba(160,170,210,0.8)'; ctx.lineWidth = 3;
  for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(wx - 170 + k * 50, wy + 52 + Math.sin(k) * 4); ctx.lineTo(wx - 150 + k * 50, wy + 78); ctx.stroke(); }
  ctx.fillStyle = '#5a6fae'; ctx.beginPath(); ctx.ellipse(wx - 20, wy + 50, 60, 20, 0.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1d2240'; ctx.beginPath(); ctx.arc(wx - 150, wy - 6, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(wx - 152, wy - 9, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,150,170,0.6)'; ctx.beginPath(); ctx.ellipse(wx - 130, wy + 18, 14, 8, 0, 0, Math.PI * 2); ctx.fill();
  // the spout: a little fountain of sparkles
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (let k = 0; k < 14; k++) { const a = -Math.PI / 2 + (rnd() - 0.5) * 1.2, r = 30 + rnd() * 50; ctx.beginPath(); ctx.arc(wx - 60 + Math.cos(a) * r, wy - 100 + Math.sin(a) * r * 0.8, 3 + rnd() * 3, 0, Math.PI * 2); ctx.fill(); }
  // hill, figure and kite
  hills(ctx, w, h * 0.9, 40, 1.2, 0.6, '#a9cf9a', h);
  const fx = w * 0.78, fy = h * 0.83;
  ctx.fillStyle = '#f2a3b4'; ctx.beginPath(); ctx.moveTo(fx - 10, fy); ctx.lineTo(fx + 10, fy); ctx.lineTo(fx + 5, fy - 24); ctx.lineTo(fx - 5, fy - 24); ctx.fill();
  ctx.fillStyle = '#5b3a2c'; ctx.beginPath(); ctx.arc(fx, fy - 30, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4a4a5a'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(fx + 4, fy - 20); ctx.quadraticCurveTo(fx + 60, fy - 120, fx + 120, fy - 240); ctx.stroke();
  ctx.fillStyle = '#ffcf5a'; ctx.beginPath(); ctx.moveTo(fx + 120, fy - 262); ctx.lineTo(fx + 138, fy - 240); ctx.lineTo(fx + 120, fy - 214); ctx.lineTo(fx + 102, fy - 240); ctx.fill();
  paintify(c, 13000, 18, 4.5, 2.5);
  return c;
}

/** paper cut-outs in the manner of a modern collage: leaves, suns and stars */
function cutouts(): HTMLCanvasElement {
  seed(53);
  const w = 600, h = 780, c = canvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#f4ece0'; ctx.fillRect(0, 0, w, h);
  const cols = ['#e46f4e', '#f2b544', '#7fa37a', '#3f6ea6', '#f2a7b8', '#2f3a55'];
  const leafShape = (x: number, y: number, s: number, rot: number, col: string) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(0, -s);
    for (let k = 0; k < 5; k++) { const yy = -s + (k + 0.5) * (2 * s / 5); ctx.quadraticCurveTo(s * 0.9, yy - s * 0.1, s * 0.15, yy + s * 0.2); }
    ctx.lineTo(0, s);
    for (let k = 4; k >= 0; k--) { const yy = -s + (k + 0.5) * (2 * s / 5); ctx.lineTo(-s * 0.15, yy + s * 0.2); ctx.quadraticCurveTo(-s * 0.9, yy - s * 0.1, 0, yy - s * 0.2); }
    ctx.fill(); ctx.restore();
  };
  ctx.fillStyle = '#f2b544'; ctx.beginPath(); ctx.arc(w * 0.68, h * 0.2, 80, 0, Math.PI * 2); ctx.fill();
  leafShape(w * 0.3, h * 0.35, 150, -0.2, cols[2]);
  leafShape(w * 0.62, h * 0.62, 170, 0.35, cols[3]);
  leafShape(w * 0.25, h * 0.78, 110, 0.6, cols[0]);
  for (let i = 0; i < 9; i++) {
    const x = rnd() * w, y = rnd() * h, s = 14 + rnd() * 18;
    ctx.fillStyle = cols[(i + 1) % cols.length];
    ctx.beginPath();
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? s * 0.45 : s; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.fill();
  }
  for (let i = 0; i < 6; i++) { ctx.fillStyle = cols[4]; blob(ctx, rnd() * w, rnd() * h, 12 + rnd() * 10, 0.3); ctx.fill(); }
  paintify(c, 4000, 10, 3, 4);
  return c;
}

/** a fox asleep in a clearing, fireflies drifting over the ferns */
function sleepingFox(): HTMLCanvasElement {
  seed(71);
  const w = 760, h = 560, c = canvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = grad(ctx, 0, h, [[0, '#14243a'], [0.6, '#21404a'], [1, '#2c4f3e']]); ctx.fillRect(0, 0, w, h);
  // tree trunks behind
  for (let i = 0; i < 7; i++) { ctx.fillStyle = `rgba(10,22,30,${0.5 + rnd() * 0.4})`; ctx.fillRect(rnd() * w, 0, 18 + rnd() * 30, h * 0.8); }
  hills(ctx, w, h * 0.78, 14, 2, 0.4, '#2f5a40', h);
  // ferns
  ctx.strokeStyle = '#4f8a5a'; ctx.lineWidth = 3;
  for (let i = 0; i < 14; i++) {
    const x = rnd() * w, y = h * 0.8 + rnd() * h * 0.2, s = 40 + rnd() * 40, side = rnd() < 0.5 ? -1 : 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + side * s * 0.4, y - s, x + side * s, y - s * 0.9); ctx.stroke();
    for (let k = 1; k < 7; k++) { const t = k / 7, px = x + side * s * t * 0.8, py = y - s * Math.sin(t * 1.4) * 0.95; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 10, py - 12); ctx.moveTo(px, py); ctx.lineTo(px - 10, py - 10); ctx.stroke(); }
  }
  // the fox, curled up, tail over its nose
  const fx = w * 0.5, fy = h * 0.8;
  ctx.fillStyle = '#e27a3f'; ctx.beginPath(); ctx.ellipse(fx, fy - 30, 95, 48, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d0682f'; ctx.beginPath(); ctx.ellipse(fx + 70, fy - 46, 42, 34, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(fx + 66, fy - 74); ctx.lineTo(fx + 76, fy - 104); ctx.lineTo(fx + 90, fy - 72); ctx.fill();
  ctx.beginPath(); ctx.moveTo(fx + 92, fy - 70); ctx.lineTo(fx + 108, fy - 96); ctx.lineTo(fx + 112, fy - 62); ctx.fill();
  ctx.strokeStyle = '#3a2216'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(fx + 80, fy - 48, 6, 0.2, Math.PI - 0.2); ctx.stroke();
  ctx.fillStyle = '#e88a4e'; ctx.beginPath(); ctx.ellipse(fx - 10, fy - 10, 110, 30, -0.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fbf1e4'; ctx.beginPath(); ctx.ellipse(fx + 92, fy - 18, 26, 16, -0.2, 0, Math.PI * 2); ctx.fill();
  // fireflies
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w, y = h * 0.25 + rnd() * h * 0.55;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
    g.addColorStop(0, 'rgba(255,240,150,0.95)'); g.addColorStop(1, 'rgba(255,240,150,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 16, y - 16, 32, 32);
  }
  ctx.fillStyle = '#fbf6d0';
  for (let i = 0; i < 30; i++) { ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h * 0.3, rnd() * 1.6 + 0.4, 0, Math.PI * 2); ctx.fill(); }
  paintify(c, 9000, 14, 3.5, 3);
  return c;
}

/** small doodles for the photo string: a cupcake, a star, a balloon, a rainbow, a sun, a note */
function doodle(kind: number): HTMLCanvasElement {
  seed(90 + kind);
  const w = 220, h = 220, c = canvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true })!;
  const bgs = ['#fde2e4', '#e2ece9', '#fff1e6', '#dfe7fd', '#fef9c3', '#f0e6ff'];
  ctx.fillStyle = bgs[kind % bgs.length]; ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const m = w / 2;
  switch (kind) {
    case 0: // cupcake
      ctx.fillStyle = '#f7a8b8'; blob(ctx, m, 90, 48, 0.12); ctx.fill();
      ctx.fillStyle = '#c98b5c'; ctx.beginPath(); ctx.moveTo(62, 110); ctx.lineTo(158, 110); ctx.lineTo(144, 172); ctx.lineTo(76, 172); ctx.fill();
      ctx.fillStyle = '#e64b5d'; ctx.beginPath(); ctx.arc(m, 46, 12, 0, Math.PI * 2); ctx.fill();
      break;
    case 1: // star with a face
      ctx.fillStyle = '#ffcf4a'; ctx.beginPath();
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 34 : 78; ctx.lineTo(m + Math.cos(a) * r, 118 + Math.sin(a) * r); }
      ctx.fill();
      ctx.fillStyle = '#5a3b1c'; ctx.beginPath(); ctx.arc(m - 14, 112, 5, 0, Math.PI * 2); ctx.arc(m + 14, 112, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5a3b1c'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(m, 122, 10, 0.2, Math.PI - 0.2); ctx.stroke();
      break;
    case 2: // balloon
      ctx.fillStyle = '#8ecae6'; ctx.beginPath(); ctx.ellipse(m, 88, 46, 56, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#555'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(m, 146); ctx.bezierCurveTo(m - 20, 170, m + 20, 180, m, 205); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.ellipse(m - 18, 66, 9, 16, -0.4, 0, Math.PI * 2); ctx.fill();
      break;
    case 3: // rainbow
      ['#ef767a', '#f6bd60', '#a7c957', '#6fb1d6', '#b39ddb'].forEach((col, i) => { ctx.strokeStyle = col; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(m, 160, 82 - i * 13, Math.PI, 0); ctx.stroke(); });
      cloud(ctx, 46, 160, 16, '#fff'); cloud(ctx, 174, 160, 16, '#fff');
      break;
    case 4: // sun
      ctx.strokeStyle = '#f4a259'; ctx.lineWidth = 7;
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(m + Math.cos(a) * 56, m + Math.sin(a) * 56); ctx.lineTo(m + Math.cos(a) * 82, m + Math.sin(a) * 82); ctx.stroke(); }
      ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(m, m, 46, 0, Math.PI * 2); ctx.fill();
      break;
    default: // music notes
      ctx.fillStyle = '#6d597a'; ctx.strokeStyle = '#6d597a';
      ctx.beginPath(); ctx.ellipse(76, 160, 20, 15, -0.4, 0, Math.PI * 2); ctx.ellipse(152, 140, 20, 15, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(94, 156); ctx.lineTo(94, 52); ctx.lineTo(170, 34); ctx.lineTo(170, 136); ctx.stroke();
      ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(94, 64); ctx.lineTo(170, 46); ctx.stroke();
  }
  paintify(c, 900, 8, 2.5, 4);
  return c;
}

// ---------------------------------------------------------------- frames and hanging
export type FrameStyle = 'gold' | 'walnut' | 'white' | 'black';

export interface Hang {
  art: () => HTMLCanvasElement;
  /** picture size in metres (the canvas aspect is kept by fitting the height) */
  height: number;
  frame: FrameStyle;
  mat?: boolean;
  pos: [number, number, number];
  rotY: number;
}

export const PAINTINGS = { catAndMoon, balloonsOverHills, lighthouse, whaleInClouds, cutouts, sleepingFox, doodle };

const FRAME_MATS = () => ({
  gold: phys('#c9a04f', 0.32, { metalness: 1, clearcoat: 0.3 }),
  walnut: std('#5a3a26', 0.45),
  white: std('#f5f1ea', 0.5),
  black: std('#1d1c1f', 0.4),
});

export function hangPaintings(list: Hang[], anisotropy: number) {
  const group = new THREE.Group();
  group.name = 'paintings';
  const fm = FRAME_MATS();
  const passe = std('#f7f2ea', 0.9);
  const b = new Batcher();
  for (const p of list) {
    const c = p.art();
    const aspect = c.width / c.height;
    const ph = p.height, pw = ph * aspect;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = anisotropy;
    const artMat = phys('#ffffff', 0.62, { map: tex, clearcoat: 0.25, clearcoatRoughness: 0.4 });
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rotY, 0));
    const at = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(new THREE.Vector3(...p.pos));
    const matW = p.mat ? 0.07 : 0;
    const art = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), artMat);
    art.position.copy(at(0, 0, 0.022)); art.quaternion.copy(q);
    art.receiveShadow = true;
    group.add(art);
    if (p.mat) b.add(new THREE.PlaneGeometry(pw + matW * 2, ph + matW * 2), passe, at(0, 0, 0.018), p.rotY);
    // frame: four bevelled bars around the picture
    const fw = p.frame === 'gold' ? 0.055 : 0.035, fd = 0.04;
    const ow = pw + matW * 2, oh = ph + matW * 2;
    const fmat = fm[p.frame];
    const bar = (len: number, lx: number, ly: number, vertical: boolean) =>
      b.add(new THREE.BoxGeometry(vertical ? fw : len + fw * 2, vertical ? len : fw, fd), fmat, at(lx, ly, fd / 2), p.rotY);
    bar(ow, 0, oh / 2 + fw / 2, false); bar(ow, 0, -oh / 2 - fw / 2, false);
    bar(oh, -ow / 2 - fw / 2, 0, true); bar(oh, ow / 2 + fw / 2, 0, true);
    if (p.frame === 'gold') {
      // an inner lip, so the gold frame has a profile
      const lip = 0.012;
      b.add(new THREE.BoxGeometry(ow + lip * 2, lip, 0.03), fmat, at(0, oh / 2 + lip / 2, 0.025), p.rotY);
      b.add(new THREE.BoxGeometry(ow + lip * 2, lip, 0.03), fmat, at(0, -oh / 2 - lip / 2, 0.025), p.rotY);
      b.add(new THREE.BoxGeometry(lip, oh, 0.03), fmat, at(-ow / 2 - lip / 2, 0, 0.025), p.rotY);
      b.add(new THREE.BoxGeometry(lip, oh, 0.03), fmat, at(ow / 2 + lip / 2, 0, 0.025), p.rotY);
    }
  }
  const frames = b.build('frames');
  group.add(frames);
  return group;
}
