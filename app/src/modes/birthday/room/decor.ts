import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { ROOM, LAYOUT } from '../config';
import { Batcher, std, phys } from './build';
import { canvas, fbm, normalFromHeight, toTexture, glowSprite } from './textures';
import { PAINTINGS } from './paintings';
import { box, circle, type Collider } from '../core/nav';
import fontJson from '../assets/fredoka_600.typeface.json';

/**
 * The party: balloons that bob and can be bopped, foil letters spelling her name, a
 * "HAPPY BIRTHDAY" bunting, paper garlands, paper lanterns, twinkling fairy lights, a
 * string of little pictures, and the presents (one of them hides a teddy).
 */

const PASTELS = ['#f6a6bf', '#c7b3f2', '#a8dcc9', '#ffd59e', '#9fcdf2', '#ffffff'];

// ---------------------------------------------------------------- balloons
interface Balloon {
  anchor: THREE.Vector3;       // where the string is tied
  rest: THREE.Vector3;         // where it floats when still
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  scale: number;
  phase: number;
  foil: boolean;
  color: THREE.Color;
  slot: number;                // instance index within its kind
}

const SEGS = 15;               // string segments per balloon

/**
 * Every balloon in the room, drawn as two instanced meshes (latex and foil) and one line
 * buffer for all the strings: three draws however many balloons there are. Each balloon is
 * a damped spring round its rest point and can be bopped.
 */
export class Balloons {
  group = new THREE.Group();
  private items: Balloon[] = [];
  private latex: THREE.InstancedMesh | null = null;
  private foil: THREE.InstancedMesh | null = null;
  private strings: THREE.LineSegments | null = null;
  private _v = new THREE.Vector3();
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _e = new THREE.Euler();
  private _s = new THREE.Vector3();

  constructor() { this.group.name = 'balloons'; }

  /** one balloon: an egg-shaped body with its knot, as a single geometry */
  static geometry = (() => {
    const g = new THREE.SphereGeometry(0.15, 40, 28);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 0.15;
      // a balloon is egg-shaped: fuller at the top, drawn in toward the knot
      const k = y < 0 ? 1 - 0.18 * y * y : 1 + 0.03 * y;
      p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); p.setY(i, p.getY(i) * 1.12);
    }
    g.computeVertexNormals();
    const knot = new THREE.ConeGeometry(0.014, 0.022, 12);
    knot.rotateX(Math.PI); knot.translate(0, -0.172, 0);
    const merged = mergeGeometries([g.toNonIndexed(), knot.toNonIndexed()], false)!;
    merged.computeBoundingSphere();
    return merged;
  })();

  /** a balloon tied at `anchor`, floating at `rest` */
  add(anchor: THREE.Vector3, rest: THREE.Vector3, color: string, scale = 1, foil = false) {
    if (this.latex) throw new Error('balloons: add() after finish()');
    this.items.push({ anchor: anchor.clone(), rest: rest.clone(), pos: rest.clone(), vel: new THREE.Vector3(), scale,
      phase: Math.random() * 10, foil, color: new THREE.Color(color), slot: 0 });
  }

  /** a bunch of `n` round a tie point */
  bunch(anchor: THREE.Vector3, n: number, height: number, spread: number, colors = PASTELS, seed = 1) {
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + seed, r = spread * (0.4 + 0.6 * ((i * 37 + seed * 11) % 10) / 10);
      const rest = new THREE.Vector3(anchor.x + Math.cos(a) * r, anchor.y + height + ((i * 13) % 7) * 0.06, anchor.z + Math.sin(a) * r);
      this.add(anchor, rest, colors[(i + seed) % colors.length], 0.9 + ((i * 7) % 5) * 0.05, i % 5 === 4);
    }
  }

  /** build the instanced meshes once every balloon has been added */
  finish() {
    const make = (foil: boolean) => {
      const list = this.items.filter((b) => b.foil === foil);
      if (!list.length) return null;
      const mat = foil
        ? phys('#ffffff', 0.18, { metalness: 1, clearcoat: 1, clearcoatRoughness: 0.08 })
        : phys('#ffffff', 0.32, { clearcoat: 0.9, clearcoatRoughness: 0.18, sheen: 0.5, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.3 });
      const im = new THREE.InstancedMesh(Balloons.geometry, mat, list.length);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      list.forEach((b, i) => { b.slot = i; im.setColorAt(i, b.color); });
      im.castShadow = true;
      im.frustumCulled = false;          // they float all over the room
      this.group.add(im);
      return im;
    };
    this.latex = make(false);
    this.foil = make(true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.items.length * SEGS * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.strings = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#f4f0ea', transparent: true, opacity: 0.85 }));
    this.strings.frustumCulled = false;
    this.group.add(this.strings);
    this.update(0, 0);
  }

  /** a soft push to every balloon near p (she bopped them) */
  bop(p: THREE.Vector3, strength = 1.6) {
    for (const b of this.items) {
      const d = this._v.subVectors(b.pos, p);
      const dist = d.length();
      if (dist > 1.4) continue;
      d.y = Math.abs(d.y) + 0.4;
      b.vel.addScaledVector(d.normalize(), strength * (1.2 - dist * 0.6) * (0.8 + Math.random() * 0.4));
    }
  }

  update(dt: number, t: number) {
    if (!this.strings) return;
    const arr = this.strings.geometry.getAttribute('position') as THREE.BufferAttribute;
    let v = 0;
    for (const b of this.items) {
      // a damped spring back to rest, plus a little air drift
      const k = 6, c = 1.6;
      const drift = this._v.set(Math.sin(t * 0.7 + b.phase) * 0.03, Math.sin(t * 1.1 + b.phase * 1.3) * 0.02, Math.cos(t * 0.6 + b.phase) * 0.03);
      const ax = (b.rest.x + drift.x - b.pos.x) * k - b.vel.x * c;
      const ay = (b.rest.y + drift.y - b.pos.y) * k - b.vel.y * c;
      const az = (b.rest.z + drift.z - b.pos.z) * k - b.vel.z * c;
      b.vel.x += ax * dt; b.vel.y += ay * dt; b.vel.z += az * dt;
      b.pos.addScaledVector(b.vel, dt);
      // the string is taut: never further from the tie than it was at rest
      const maxLen = b.rest.distanceTo(b.anchor) * 1.02;
      const d = this._v.subVectors(b.pos, b.anchor);
      if (d.length() > maxLen) { d.setLength(maxLen); b.pos.copy(b.anchor).add(d); }
      b.pos.y = Math.min(b.pos.y, ROOM.height - 0.2);
      // tilt with the swing, as the string pulls the knot
      this._e.set(THREE.MathUtils.clamp((b.pos.z - b.anchor.z) * 0.25, -0.4, 0.4), 0, THREE.MathUtils.clamp(-(b.pos.x - b.anchor.x) * 0.25, -0.4, 0.4));
      this._m.compose(b.pos, this._q.setFromEuler(this._e), this._s.setScalar(b.scale));
      (b.foil ? this.foil : this.latex)!.setMatrixAt(b.slot, this._m);
      // string: a gentle curve from the tie up to the knot, as line segments
      const knotY = b.pos.y - 0.18 * b.scale;
      const sw = 0.04 * Math.sin(t * 1.3 + b.phase);
      let px = 0, py = 0, pz = 0;
      for (let i = 0; i <= SEGS; i++) {
        const s = i / SEGS, sway = Math.sin(s * Math.PI) * sw;
        const x = b.anchor.x + (b.pos.x - b.anchor.x) * s + sway, y = b.anchor.y + (knotY - b.anchor.y) * s, z = b.anchor.z + (b.pos.z - b.anchor.z) * s + sway * 0.5;
        if (i > 0) { arr.setXYZ(v++, px, py, pz); arr.setXYZ(v++, x, y, z); }
        px = x; py = y; pz = z;
      }
    }
    arr.needsUpdate = true;
    if (this.latex) this.latex.instanceMatrix.needsUpdate = true;
    if (this.foil) this.foil.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- foil letters
/** upper-case, accents folded, keeping only characters the font subset can draw */
export function foldForFont(text: string, glyphs: Record<string, unknown>): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim()
    .split('').filter((c) => c === ' ' || c in glyphs).join('').replace(/\s+/g, ' ').trim();
}

export function foilLetters(text: string, centre: THREE.Vector3, size = 0.34): THREE.Group {
  const g = new THREE.Group();
  g.name = 'letters';
  const font = new FontLoader().parse(fontJson as any);
  // crinkled foil: a fine random normal
  const crinkle = (() => {
    const w = 256, h = new Float32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) h[y * w + x] = fbm(x / w, y / w, 10, 4, 81);
    return toTexture(normalFromHeight(h, w, w, 3), false);
  })();
  const gold = phys('#efc874', 0.2, { metalness: 1, clearcoat: 1, clearcoatRoughness: 0.12, normalMap: crinkle, normalScale: new THREE.Vector2(0.25, 0.25) });
  // Only what the font has: accents are folded away (Zoë -> ZOE) and anything else the
  // subset lacks is dropped, so no name can stop the room from loading. Spaces stay as gaps.
  const glyphs = (font.data as any).glyphs as Record<string, unknown>;
  const letters = [...foldForFont(text, glyphs)];
  const SPACE = -1;
  const geos = letters.map((ch) => {
    if (ch === ' ') return null;
    const geo = new TextGeometry(ch, { font, size, depth: 0.03, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.022, bevelSegments: 6 });
    geo.computeBoundingBox();
    return geo.boundingBox!.isEmpty() ? null : geo;
  });
  const widths = geos.map((gg) => (gg ? gg.boundingBox!.max.x - gg.boundingBox!.min.x : SPACE));
  const gap = size * 0.12;
  const total = widths.reduce((a, b) => a + (b === SPACE ? size * 0.35 : b), 0) + gap * Math.max(0, letters.length - 1);
  // long names shrink to fit the wall between the corner and the curtain
  const fit = Math.min(1, 1.6 / Math.max(total, 1e-3));
  g.scale.setScalar(fit);
  let x = -total / 2;
  geos.forEach((geo, i) => {
    if (!geo) { x += size * 0.35 + gap; return; }
    const bb = geo.boundingBox!;
    geo.translate(-bb.min.x - widths[i] / 2, -(bb.min.y + bb.max.y) / 2, 0);
    const m = new THREE.Mesh(geo, gold);
    // hung slightly askew, bobbing at different heights, as taped-up balloons are
    m.position.set(x + widths[i] / 2, Math.sin(i * 1.7) * 0.05, 0.06);
    m.rotation.set(0.04 * Math.sin(i * 2.3), 0.12 * Math.sin(i * 1.3), 0.08 * Math.sin(i * 3.1));
    m.castShadow = true;
    g.add(m);
    x += widths[i] + gap;
  });
  g.position.copy(centre);
  return g;
}

// ---------------------------------------------------------------- bunting and garlands
/** all the flags' faces side by side in one texture: a column per flag */
function flagAtlas(text: string, colors: string[]) {
  const W = 128, H = 160, n = text.length;
  const c = canvas(W * n, H), ctx = c.getContext('2d')!;
  for (let i = 0; i < n; i++) {
    ctx.save(); ctx.translate(i * W, 0);
    ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(0, 0, W, H);   // the geometry is the triangle
    // tiny white dots
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let y = 12; y < 100; y += 16) for (let x = 10 + (y % 32 ? 8 : 0); x < W; x += 16) { if (Math.abs(x - 64) < (1 - y / H) * 64 - 6) { ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill(); } }
    if (text[i].trim()) {
      ctx.fillStyle = '#ffffff'; ctx.font = '600 66px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.15)'; ctx.shadowBlur = 4;
      ctx.fillText(text[i], 64, 52);
    }
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** flags on a sagging cord from a to b, as one mesh: triangles cut from one texture */
export function bunting(a: THREE.Vector3, b: THREE.Vector3, sag: number, text: string, colors: string[]) {
  const g = new THREE.Group();
  g.name = 'bunting';
  const n = text.length;
  const curve = (s: number) => new THREE.Vector3().lerpVectors(a, b, s).add(new THREE.Vector3(0, -sag * 4 * s * (1 - s), 0));
  const pts = Array.from({ length: 40 }, (_, i) => curve(i / 39));
  const cord = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#efe6d8' }));
  g.add(cord);
  const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
  const yaw = Math.atan2(dir.x, dir.z) - Math.PI / 2;
  const fw = Math.min(0.3, a.distanceTo(b) / (n + 1) * 0.86), fh = fw * 1.25;
  const mat = phys('#ffffff', 0.8, { map: flagAtlas(text, colors), side: THREE.DoubleSide, sheen: 0.3, sheenColor: new THREE.Color('#ffffff') });
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const s = (i + 1) / (n + 1);
    // a pennant: point down, its uv the matching column of the atlas
    const tri = new THREE.BufferGeometry();
    // counter-clockwise seen from +z, so the front face agrees with the normal (double-sided
    // shading flips the normal on back faces)
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-fw / 2, 0, 0, 0, -fh, 0, fw / 2, 0, 0], 3));
    tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([i / n, 1, (i + 0.5) / n, 0, (i + 1) / n, 1], 2));
    // flags hang plumb but twist a touch on the cord
    q.setFromEuler(new THREE.Euler(0, yaw + Math.sin(i * 2.1) * 0.12, 0));
    tri.applyMatrix4(m.compose(curve(s), q, new THREE.Vector3(1, 1, 1)));
    parts.push(tri);
  }
  const flags = new THREE.Mesh(mergeGeometries(parts, false)!, mat);
  flags.castShadow = true;
  g.add(flags);
  return g;
}

/** a paper fan garland: little discs of tissue strung across the ceiling */
export function garland(a: THREE.Vector3, b: THREE.Vector3, sag: number, colors: string[]) {
  const b2 = new Batcher();
  const mats = colors.map((c) => phys(c, 0.8, { side: THREE.DoubleSide, sheen: 0.4, sheenColor: new THREE.Color('#ffffff') }));
  const len = a.distanceTo(b), n = Math.floor(len / 0.11);
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const p = new THREE.Vector3().lerpVectors(a, b, s).add(new THREE.Vector3(0, -sag * 4 * s * (1 - s), 0));
    const disc = new THREE.CircleGeometry(0.045, 14);
    b2.add(disc, mats[i % mats.length], p, 0, undefined, new THREE.Euler(0, Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2 + Math.sin(i) * 0.6, 0));
  }
  return b2.build('garland', { cast: false, receive: true });
}

// ---------------------------------------------------------------- lanterns
export interface Lantern { group: THREE.Group; light: THREE.Light; shell: THREE.Mesh }

/** a ribbed paper globe lantern on a cord, glowing from inside */
export function paperLantern(pos: THREE.Vector3, r: number, color: string, glow: string, light: THREE.Light): Lantern {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(r, 48, 32);
  // ribs: shallow horizontal ridges
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / r;
    const k = 1 + 0.018 * Math.cos(y * 26);
    p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const shell = new THREE.Mesh(geo, phys(color, 0.85, { emissive: new THREE.Color(glow), emissiveIntensity: 0.55, side: THREE.DoubleSide, sheen: 0.3 }));
  g.add(shell);
  // rings top and bottom, and the cord to the ceiling
  for (const s of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.32, 0.004, 8, 32), std('#e8e2d8', 0.5));
    ring.rotation.x = Math.PI / 2; ring.position.y = s * r * 0.95;
    g.add(ring);
  }
  const cordLen = ROOM.height - pos.y - r;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, cordLen, 6), std('#f1ebe2', 0.6));
  cord.position.y = r + cordLen / 2;
  g.add(cord);
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 24), std('#f1ebe2', 0.5));
  rose.position.y = ROOM.height - pos.y - 0.01;
  g.add(rose);
  light.position.set(0, 0, 0);
  g.add(light);
  g.position.copy(pos);
  return { group: g, light, shell };
}

// ---------------------------------------------------------------- fairy lights
export class FairyLights {
  mesh: THREE.InstancedMesh;
  private phases: Float32Array;
  private base = new THREE.Color('#ffd28a');
  private c = new THREE.Color();
  boost = 0;      // 0..1, extra twinkle while the song plays
  private b = 0;          // boost, eased
  private ph = 0;         // accumulated twinkle phase
  private last = -1;

  constructor(paths: THREE.Vector3[][], spacing = 0.12) {
    const pts: THREE.Vector3[] = [];
    const wires = new THREE.Group();
    for (const path of paths) {
      const curve = new THREE.CatmullRomCurve3(path);
      const len = curve.getLength(), n = Math.max(2, Math.floor(len / spacing));
      for (let i = 0; i <= n; i++) pts.push(curve.getPointAt(i / n));
      wires.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(120)), new THREE.LineBasicMaterial({ color: '#4a5a3a' })));
    }
    const geo = new THREE.SphereGeometry(0.009, 10, 8);
    geo.scale(1, 1.4, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), pts.length);
    this.phases = new Float32Array(pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => { m.makeTranslation(p.x, p.y - 0.012, p.z); this.mesh.setMatrixAt(i, m); this.phases[i] = Math.random() * 100; });
    this.mesh.add(wires);
    this.mesh.frustumCulled = false;
    this.update(0);
  }

  update(t: number) {
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.last));
    this.last = t;
    // speed is integrated into a phase, so changing it never makes every bulb jump at once
    this.b += (this.boost - this.b) * Math.min(1, dt * 1.5);
    this.ph += dt * (1.5 + this.b * 3);
    for (let i = 0; i < this.phases.length; i++) {
      const tw = 0.75 + 0.25 * Math.sin(this.ph + this.phases[i]) * (0.6 + 0.4 * Math.sin(t * 0.37 + this.phases[i] * 2));
      this.c.copy(this.base).multiplyScalar(2.4 * tw);
      this.mesh.setColorAt(i, this.c);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- photo string
export function photoString(a: THREE.Vector3, b: THREE.Vector3, sag: number, normalYaw: number) {
  const g = new THREE.Group();
  g.name = 'photos';
  const curve = (s: number) => new THREE.Vector3().lerpVectors(a, b, s).add(new THREE.Vector3(0, -sag * 4 * s * (1 - s), 0));
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 30 }, (_, i) => curve(i / 29))), new THREE.LineBasicMaterial({ color: '#c8b8a0' })));
  const frameMat = std('#fbfaf6', 0.7);
  const pegMat = std('#c9a073', 0.7);
  // the six doodles in one 3 x 2 texture, so the photos share a material
  const atlas = canvas(660, 440), actx = atlas.getContext('2d')!;
  for (let i = 0; i < 6; i++) actx.drawImage(PAINTINGS.doodle(i), (i % 3) * 220, Math.floor(i / 3) * 220);
  const atlasTex = new THREE.CanvasTexture(atlas); atlasTex.colorSpace = THREE.SRGBColorSpace;
  const picMat = std('#ffffff', 0.6, 0, { map: atlasTex });
  for (let i = 0; i < 6; i++) {
    const s = (i + 0.7) / 6.4;
    const p = curve(s);
    // this photo's cell of the shared atlas
    const picGeo = new THREE.PlaneGeometry(0.1, 0.1);
    const uv = picGeo.getAttribute('uv') as THREE.BufferAttribute;
    // (canvas row 0 is the top half of the texture: v 0.5..1)
    const col = i % 3, row = Math.floor(i / 3);
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (col + uv.getX(k)) / 3, (uv.getY(k) + 1 - row) / 2);
    const card = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.145, 0.002), frameMat);
    back.position.y = -0.0725;
    const pic = new THREE.Mesh(picGeo, picMat);
    pic.position.set(0, -0.06, 0.0012);
    const peg = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.035, 0.012), pegMat);
    peg.position.set(0, -0.008, 0.004);
    card.add(back, pic, peg);
    card.position.copy(p);
    card.rotation.set(0, normalYaw, Math.sin(i * 2.7) * 0.12);
    card.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    g.add(card);
  }
  return g;
}

// ---------------------------------------------------------------- gifts and the teddy
export interface Gift {
  group: THREE.Group;
  lid: THREE.Group;
  teddy: THREE.Group;
  /** the teddy's resting place, risen out of the box */
  inside: THREE.Vector3;
  colliders: Collider[];
}

function polkaTexture(bg: string, dot: string) {
  const c = canvas(256), ctx = c.getContext('2d')!;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = dot;
  for (let y = 0; y < 256; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < 272; x += 32) { ctx.beginPath(); ctx.arc(x, y + 16, 5, 0, Math.PI * 2); ctx.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
  return t;
}

/**
 * A ribbon: a flat band of `width` following `curve`, its face turned to `up` (twisting
 * smoothly where the curve does). Double-sided, so a loop shows its inside.
 */
function ribbonStrip(curve: THREE.Curve<THREE.Vector3>, width: number, up: THREE.Vector3, segs = 48, vCut = false) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const t = new THREE.Vector3(), side = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    curve.getPointAt(s, p); curve.getTangentAt(s, t);
    side.crossVectors(t, up).normalize().multiplyScalar(width / 2);
    // a V notch cut into the free end of a tail
    const notch = vCut && i === segs ? width * 0.45 : 0;
    pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
    if (notch) { pos[pos.length - 6 + 1] += notch; pos[pos.length - 3 + 1] += notch; }
    uv.push(0, s, 1, s);
    if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  if (vCut) {
    // pull the middle of the end back to make the V
    const n = pos.length / 3;
    pos.push((pos[(n - 2) * 3] + pos[(n - 1) * 3]) / 2, (pos[(n - 2) * 3 + 1] + pos[(n - 1) * 3 + 1]) / 2 - width * 0.45, (pos[(n - 2) * 3 + 2] + pos[(n - 1) * 3 + 2]) / 2);
    uv.push(0.5, 1);
    idx.push(n - 2, n, n - 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** a tied bow: two plump ribbon loops, a knot, and two tails with V-cut ends */
function bow(mat: THREE.Material, size: number) {
  const g = new THREE.Group();
  const m = (mat as THREE.MeshPhysicalMaterial).clone();
  m.side = THREE.DoubleSide;
  const w = size * 0.32;
  for (const s of [-1, 1]) {
    // a teardrop loop leaving the knot, swelling out and coming back
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const r = size * 0.55 * Math.sin(a / 2) ** 1.4;
      pts.push(new THREE.Vector3(s * Math.sin(a / 2) * r * 1.6, Math.sin(a) * size * 0.2 + r * 0.55, Math.sin(a) * size * 0.05));
    }
    const loop = new THREE.Mesh(ribbonStrip(new THREE.CatmullRomCurve3(pts, true), w, new THREE.Vector3(0, 0, 1), 64), m);
    loop.rotation.z = s * -0.12;
    g.add(loop);
    const tail = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0.01), new THREE.Vector3(s * size * 0.2, -size * 0.12, size * 0.12), new THREE.Vector3(s * size * 0.42, -size * 0.18, size * 0.36),
    ]);
    g.add(new THREE.Mesh(ribbonStrip(tail, w * 0.9, new THREE.Vector3(0, 1, 0.3).normalize(), 24, true), m));
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(w * 0.55, 18, 12), m);
  knot.scale.set(1, 0.85, 0.75);
  knot.position.y = size * 0.02;
  g.add(knot);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

function giftBox(w: number, h: number, d: number, paper: THREE.Material, ribbon: THREE.Material) {
  const g = new THREE.Group();
  const lidH = Math.min(0.08, h * 0.22);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h - lidH * 0.6, d), paper);
  body.position.y = (h - lidH * 0.6) / 2;
  g.add(body);
  for (const [rw, rd] of [[0.05, d + 0.004], [w + 0.004, 0.05]]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(rw, h - lidH * 0.6 + 0.002, rd), ribbon);
    band.position.y = body.position.y;
    g.add(band);
  }
  const lid = new THREE.Group();
  const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, lidH, d + 0.02), paper);
  lid.add(lidMesh);
  for (const [rw, rd] of [[0.05, d + 0.024], [w + 0.024, 0.05]]) lid.add(new THREE.Mesh(new THREE.BoxGeometry(rw, lidH + 0.003, rd), ribbon));
  const bw = bow(ribbon, Math.min(w, d) * 0.42);
  bw.position.y = lidH / 2 + Math.min(w, d) * 0.06;
  lid.add(bw);
  lid.position.y = h - lidH / 2;
  g.add(lid);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, lid, lidH };
}

/** a soft teddy in a tiny party hat */
export function teddyBear(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'teddy';
  const fur = (() => {
    const w = 256, h = new Float32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) h[y * w + x] = fbm(x / w, y / w, 48, 3, 91);
    return toTexture(normalFromHeight(h, w, w, 4), false);
  })();
  const furMat = phys('#c48a5c', 0.95, { sheen: 1, sheenColor: new THREE.Color('#f3cfa8'), sheenRoughness: 0.5, normalMap: fur, normalScale: new THREE.Vector2(0.8, 0.8) });
  const light = phys('#efd6b8', 0.95, { sheen: 1, sheenColor: new THREE.Color('#fff2e0'), normalMap: fur });
  const eye = phys('#121010', 0.15, { clearcoat: 1 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; g.add(m); return m;
  };
  const S = (r: number) => new THREE.SphereGeometry(r, 28, 20);
  add(S(0.1), furMat, 0, 0.1, 0, 1, 1.15, 0.9);                    // body
  add(S(0.065), light, 0, 0.09, 0.06, 1, 1.1, 0.5);                 // tummy
  add(S(0.085), furMat, 0, 0.27, 0.01);                            // head
  add(S(0.04), light, 0, 0.255, 0.075, 1, 0.8, 0.7);                // muzzle
  add(S(0.013), eye, 0, 0.27, 0.105, 1.2, 0.9, 0.8);                // nose
  for (const s of [-1, 1]) {
    add(S(0.034), furMat, s * 0.065, 0.34, -0.005, 1, 1, 0.6);      // ears
    add(S(0.019), light, s * 0.065, 0.34, 0.012, 1, 1, 0.4);
    add(S(0.011), eye, s * 0.032, 0.295, 0.075);                     // eyes
    add(S(0.004), phys('#ffffff', 0.1), s * 0.028, 0.3, 0.084);      // eye glints
    add(S(0.015), phys('#f2a3b4', 0.9), s * 0.055, 0.255, 0.06, 1, 0.7, 0.5);   // rosy cheeks
    const arm = add(S(0.035), furMat, s * 0.1, 0.15, 0.03, 0.8, 1.5, 0.8); arm.rotation.z = s * 0.7;
    add(S(0.042), furMat, s * 0.06, 0.03, 0.06, 0.9, 0.75, 1.2);    // feet
    add(S(0.025), light, s * 0.06, 0.03, 0.105, 0.9, 0.9, 0.3);     // foot pads
  }
  // little smile
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0022, 6, 16, Math.PI), eye);
  smile.position.set(0, 0.243, 0.1); smile.rotation.z = Math.PI;
  g.add(smile);
  // bow tie
  const tie = phys('#e46f8a', 0.6, { sheen: 0.6 });
  for (const s of [-1, 1]) { const c = add(new THREE.ConeGeometry(0.022, 0.04, 12), tie, s * 0.02, 0.2, 0.07); c.rotation.z = s * Math.PI / 2; }
  add(S(0.01), tie, 0, 0.2, 0.075);
  // party hat
  g.add(partyHat(0.032, 0.085, '#8ecae6', '#ffd166').translateX(0.012).translateY(0.345).rotateZ(-0.2));
  return g;
}

/** a striped cone with a pompom; used for her and for the teddy */
export function partyHat(r: number, h: number, a: string, b: string): THREE.Group {
  const g = new THREE.Group();
  const c = canvas(128, 128), ctx = c.getContext('2d')!;
  ctx.fillStyle = a; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = b;
  for (let k = -128; k < 256; k += 32) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + 14, 0); ctx.lineTo(k + 14 + 60, 128); ctx.lineTo(k + 60, 128); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (let k = 0; k < 18; k++) { ctx.beginPath(); ctx.arc((k * 47) % 128, (k * 29) % 128, 3, 0, Math.PI * 2); ctx.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 32, 1, true), phys('#ffffff', 0.5, { map: tex, side: THREE.DoubleSide, sheen: 0.3 }));
  cone.position.y = h / 2;
  cone.castShadow = true;
  g.add(cone);
  const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.38, 2), phys('#ffffff', 0.9, { sheen: 1, sheenColor: new THREE.Color('#fff8e8') }));
  pom.position.y = h + r * 0.2;
  g.add(pom);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, r * 0.12, 8, 32), phys(b, 0.6, { sheen: 0.6 }));
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  return g;
}

export function buildGifts(): Gift {
  const group = new THREE.Group();
  group.name = 'gifts';
  const { x, z } = LAYOUT.gift;
  const ribbonLilac = phys('#b9a3e3', 0.35, { sheen: 1, sheenColor: new THREE.Color('#ffffff'), clearcoat: 0.6 });
  const ribbonGold = phys('#e3bf6a', 0.25, { metalness: 0.8, clearcoat: 0.6 });
  const ribbonWhite = phys('#ffffff', 0.35, { sheen: 1, clearcoat: 0.5 });
  // the big one: pink with white dots, lilac ribbon. This is the one that opens.
  const main = giftBox(0.42, 0.38, 0.42, phys('#ffffff', 0.55, { map: polkaTexture('#f6a6bf', '#ffffff'), sheen: 0.3 }), ribbonLilac);
  main.group.position.set(x, 0, z);
  main.group.rotation.y = 0.25;
  group.add(main.group);
  const teddy = teddyBear();
  teddy.position.set(0, 0.06, 0);
  teddy.scale.setScalar(0.001);
  teddy.visible = false;
  main.group.add(teddy);
  // two smaller ones beside it
  const mint = giftBox(0.3, 0.24, 0.26, phys('#ffffff', 0.55, { map: polkaTexture('#a8dcc9', '#f7fff9') }), ribbonGold);
  mint.group.position.set(x + 0.42, 0, z + 0.12); mint.group.rotation.y = -0.4;
  group.add(mint.group);
  const tall = giftBox(0.2, 0.34, 0.2, phys('#ffd59e', 0.5, { sheen: 0.3 }), ribbonWhite);
  tall.group.position.set(x - 0.34, 0, z + 0.2); tall.group.rotation.y = 0.6;
  group.add(tall.group);
  return {
    group, lid: main.lid, teddy, inside: new THREE.Vector3(0, 0.3, 0),
    colliders: [box(x, z, 0.5, 0.5, 0.25), box(x + 0.42, z + 0.12, 0.36, 0.34, -0.4), circle(x - 0.34, z + 0.2, 0.16)],
  };
}

// ---------------------------------------------------------------- assembling the party
export interface Decor {
  group: THREE.Group;
  balloons: Balloons;
  fairy: FairyLights[];
  lanterns: Lantern[];
  gift: Gift;
  colliders: Collider[];
}

/** `hq`: desktop quality (a sharper key-light shadow) */
export function buildDecor(name: string, hq: boolean): Decor {
  const group = new THREE.Group();
  group.name = 'decor';
  const { minX, maxX, minZ, maxZ, height: H } = ROOM;

  // her name in gold foil on the back wall, left of the window
  group.add(foilLetters(name.toUpperCase(), new THREE.Vector3(-1.9, 1.74, minZ + 0.02), 0.3));

  // HAPPY BIRTHDAY bunting above the TV, on the left wall
  // (strung from the front wall end, so it reads left to right from inside the room)
  group.add(bunting(new THREE.Vector3(minX + 0.06, 2.58, 2.35), new THREE.Vector3(minX + 0.06, 2.58, -2.55), 0.24, 'HAPPY BIRTHDAY',
    ['#f28fad', '#f6c56b', '#8fcfb7', '#9fbfef', '#c6a7ee']));

  // tissue garlands across the ceiling, corner to corner
  group.add(garland(new THREE.Vector3(minX + 0.3, H - 0.06, minZ + 0.3), new THREE.Vector3(maxX - 0.3, H - 0.06, maxZ - 0.3), 0.42, ['#f6a6bf', '#ffd59e', '#a8dcc9', '#c7b3f2']));
  group.add(garland(new THREE.Vector3(maxX - 0.3, H - 0.06, minZ + 0.3), new THREE.Vector3(minX + 0.3, H - 0.06, maxZ - 0.3), 0.36, ['#9fcdf2', '#ffffff', '#f6a6bf', '#ffd59e']));

  // balloons: a bunch in the back corner (the one she can bop), one tied to the sofa arm,
  // one by the presents, and a handful floating up against the ceiling with ribbons
  const balloons = new Balloons();
  const bx = LAYOUT.balloons.x, bz = LAYOUT.balloons.z;
  // the weight: a little foil-wrapped box
  const weight = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), phys('#efc874', 0.25, { metalness: 1 }));
  weight.position.set(bx, 0.035, bz); weight.castShadow = true;
  group.add(weight);
  balloons.bunch(new THREE.Vector3(bx, 0.07, bz), 6, 1.5, 0.26, PASTELS, 1);
  balloons.bunch(new THREE.Vector3(LAYOUT.sofa.x, 0.64, 0.9), 3, 0.9, 0.18, ['#f6a6bf', '#ffd59e', '#c7b3f2'], 3);
  balloons.bunch(new THREE.Vector3(LAYOUT.gift.x - 0.34, 0.36, LAYOUT.gift.z + 0.2), 3, 1.05, 0.2, ['#9fcdf2', '#ffffff', '#a8dcc9'], 5);
  for (let i = 0; i < 7; i++) {
    const p = new THREE.Vector3(-2.6 + i * 0.85 + Math.sin(i * 3.3) * 0.3, H - 0.2, -1.8 + ((i * 53) % 7) * 0.55);
    if (Math.abs(p.x - LAYOUT.table.x) < 0.5 && Math.abs(p.z - LAYOUT.table.z) < 0.5) p.x += 0.8;
    balloons.add(new THREE.Vector3(p.x, p.y - 1.1, p.z), p, PASTELS[i % PASTELS.length], 0.85, i === 3);
  }
  balloons.finish();
  group.add(balloons.group);

  // paper lanterns: the big one over the table is the room's key light
  const lanterns: Lantern[] = [];
  const key = new THREE.SpotLight('#ffcf94', 14, 7, 1.05, 0.9, 2);
  key.position.set(0, 0, 0);
  // the one shadow every device gets: it grounds her, the table and the cake
  key.castShadow = true;
  key.shadow.mapSize.setScalar(hq ? 2048 : 1024);
  key.shadow.radius = hq ? 6 : 4;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 0.2; key.shadow.camera.far = 4;
  const big = paperLantern(new THREE.Vector3(LAYOUT.table.x + 0.2, 2.15, LAYOUT.table.z), 0.24, '#fbf5ea', '#ffd9a0', key);
  key.target.position.set(0.25, -2.15, 0.2);
  big.group.add(key.target);
  lanterns.push(big);
  const pinkLight = new THREE.PointLight('#ffb3c1', 1.6, 4, 2);
  lanterns.push(paperLantern(new THREE.Vector3(1.9, 2.3, -1.9), 0.17, '#f8c6d2', '#ff9fb8', pinkLight));
  const blueLight = new THREE.PointLight('#cfe3ff', 1.2, 4, 2);
  lanterns.push(paperLantern(new THREE.Vector3(-2.4, 2.32, 1.7), 0.16, '#d8e6fb', '#bcd6ff', blueLight));
  for (const l of lanterns) group.add(l.group);

  // fairy lights: scalloped along the curtain rod, and across the front wall over the photos
  const win = LAYOUT.window;
  const rodY = win.sill + win.h + 0.24;
  const scallop = (x0: number, x1: number, y: number, z: number, n: number, depth: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n * 8; i++) {
      const s = i / (n * 8);
      pts.push(new THREE.Vector3(x0 + (x1 - x0) * s, y - depth * Math.abs(Math.sin(s * n * Math.PI)), z));
    }
    return pts;
  };
  const fairy = [
    new FairyLights([scallop(win.x - win.w / 2 - 0.55, win.x + win.w / 2 + 0.55, rodY, minZ + 0.14, 4, 0.16)], 0.09),
    new FairyLights([scallop(minX + 0.3, 1.6, 2.32, maxZ - 0.05, 5, 0.2)], 0.11),
  ];
  for (const f of fairy) group.add(f.mesh);
  const fairyGlow = new THREE.PointLight('#ffcf8a', 0.9, 3.5, 2);
  fairyGlow.position.set(win.x, rodY - 0.2, minZ + 0.4);
  group.add(fairyGlow);

  // a string of little pictures on the front wall, under the fairy lights
  group.add(photoString(new THREE.Vector3(-3.25, 1.95, maxZ - 0.02), new THREE.Vector3(-1.65, 1.95, maxZ - 0.02), 0.12, Math.PI));

  // presents
  const gift = buildGifts();
  group.add(gift.group);

  // glow sprites on the lanterns so they bloom softly
  const halo = glowSprite(128, 'rgba(255,225,180,0.9)', 'rgba(255,190,120,0)');
  for (const l of lanterns) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.2 }));
    s.scale.setScalar(0.7);
    l.group.add(s);
  }

  const colliders: Collider[] = [circle(bx, bz, 0.18), ...gift.colliders];
  return { group, balloons, fairy, lanterns, gift, colliders };
}

