import * as THREE from 'three';
import { ROOM, LAYOUT } from '../config';
import { Batcher, std, phys } from './build';
import { woodFloor, plaster, canvas, fbm } from './textures';

/**
 * Floor, walls, ceiling, the window with the night outside it, curtains and the door.
 *
 * Walls are blush plaster above a cream panelled wainscot, with a skirting board and a
 * crown moulding: the details that make a box read as a room.
 */

export interface Shell {
  group: THREE.Group;
  /** the night sky outside, animated (stars twinkle, a shooting star on cue) */
  sky: NightSky;
}

const WALL = '#e8c6bd';
const TRIM = '#f4ece1';
const WAINSCOT_H = 0.95;

export function buildShell(): Shell {
  const group = new THREE.Group();
  group.name = 'shell';
  const { minX, maxX, minZ, maxZ, height: H } = ROOM;
  const W = maxX - minX, D = maxZ - minZ;

  // ---- floor
  const wood = woodFloor(1024);
  // one tile is 1.5 m square: 8 planks of ~19 cm, each 1.5 m long
  for (const t of [wood.map, wood.normal, wood.rough]) t.repeat.set(W / 1.5, D / 1.5);
  const floorMat = std('#ffffff', 1, 0, { map: wood.map, normalMap: wood.normal, roughnessMap: wood.rough, normalScale: new THREE.Vector2(0.8, 0.8) });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  floor.receiveShadow = true;
  floor.name = 'floor';
  group.add(floor);

  // ---- walls (planes facing in; the back wall leaves a hole for the window)
  const pl = plaster(512);
  const wallMat = std(WALL, 1, 0, { map: pl.map, normalMap: pl.normal, roughnessMap: pl.rough, normalScale: new THREE.Vector2(0.5, 0.5) });
  pl.map.repeat.set(3, 1.5); pl.normal.repeat.set(3, 1.5); pl.rough.repeat.set(3, 1.5);
  const ceilMat = std('#f6efe6', 0.95);
  const trimMat = std(TRIM, 0.55);
  const b = new Batcher();

  const wallPlane = (w: number, h: number, x: number, y: number, z: number, rotY: number) =>
    b.add(new THREE.PlaneGeometry(w, h), wallMat, { x, y, z }, rotY);
  // left (TV) and right walls
  wallPlane(D, H, minX, H / 2, 0, Math.PI / 2);
  wallPlane(D, H, maxX, H / 2, 0, -Math.PI / 2);
  // front wall, with a hole for the door
  const door = LAYOUT.door;
  const dl = door.x - door.w / 2 - 0.06, dr = door.x + door.w / 2 + 0.06;
  wallPlane(dl - minX, H, (minX + dl) / 2, H / 2, maxZ, Math.PI);
  wallPlane(maxX - dr, H, (dr + maxX) / 2, H / 2, maxZ, Math.PI);
  wallPlane(dr - dl, H - door.h - 0.06, door.x, (H + door.h + 0.06) / 2, maxZ, Math.PI);
  // back wall around the window
  const win = LAYOUT.window;
  const wl = win.x - win.w / 2, wr = win.x + win.w / 2, wb = win.sill, wt = win.sill + win.h;
  wallPlane(wl - minX, H, (minX + wl) / 2, H / 2, minZ, 0);
  wallPlane(maxX - wr, H, (wr + maxX) / 2, H / 2, minZ, 0);
  wallPlane(win.w, wb, win.x, wb / 2, minZ, 0);
  wallPlane(win.w, H - wt, win.x, (wt + H) / 2, minZ, 0);
  // ceiling
  b.add(new THREE.PlaneGeometry(W, D), ceilMat, { x: 0, y: H, z: 0 }, 0, undefined, new THREE.Euler(Math.PI / 2, 0, 0));

  // ---- wainscot panels, skirting, chair rail, crown: along each wall, skipping openings
  type Run = { a: number; b: number };
  const walls: Array<{ axis: 'x' | 'z'; fixed: number; inward: number; runs: Run[] }> = [
    { axis: 'z', fixed: minX, inward: 1, runs: [{ a: minZ, b: maxZ }] },
    { axis: 'z', fixed: maxX, inward: -1, runs: [{ a: minZ, b: maxZ }] },
    { axis: 'x', fixed: minZ, inward: 1, runs: [{ a: minX, b: maxX }] },
    { axis: 'x', fixed: maxZ, inward: -1, runs: [{ a: minX, b: dl }, { a: dr, b: maxX }] },
  ];
  const wainMat = std(TRIM, 0.6);
  for (const wall of walls) {
    for (const run of wall.runs) {
      const len = run.b - run.a, mid = (run.a + run.b) / 2;
      const place = (along: number, y: number, depth: number, w: number, h: number, mat = trimMat) => {
        const off = wall.fixed + wall.inward * depth / 2;
        if (wall.axis === 'z') b.box(depth, h, w, mat, off, y, along);
        else b.box(w, h, depth, mat, along, y, off);
      };
      // wainscot backing, a hair proud of the wall
      place(mid, WAINSCOT_H / 2, 0.012, len, WAINSCOT_H, wainMat);
      // skirting board and chair rail
      place(mid, 0.07, 0.022, len, 0.14);
      place(mid, 0.155, 0.028, len, 0.018);
      place(mid, WAINSCOT_H, 0.034, len, 0.04);
      place(mid, WAINSCOT_H - 0.035, 0.024, len, 0.02);
      // crown moulding in two steps
      place(mid, H - 0.04, 0.05, len, 0.08);
      place(mid, H - 0.1, 0.028, len, 0.04);
      // raised panels between the rails
      const n = Math.max(1, Math.round(len / 0.9));
      const pw = len / n;
      for (let k = 0; k < n; k++) {
        const c = run.a + pw * (k + 0.5);
        const ph = WAINSCOT_H - 0.42;
        const py = 0.2 + ph / 2 + 0.03;
        // frame of the panel: four slim mouldings
        place(c, py + ph / 2, 0.026, pw - 0.16, 0.022);
        place(c, py - ph / 2, 0.026, pw - 0.16, 0.022);
        place(c - (pw - 0.16) / 2, py, 0.026, 0.022, ph);
        place(c + (pw - 0.16) / 2, py, 0.026, 0.022, ph);
      }
    }
  }

  // ---- window: casing, sill, sash bars
  const frameMat = std('#fbf7f1', 0.45);
  const depth = 0.16;
  const wz = minZ - depth / 2 + 0.02;
  b.box(win.w + 0.18, 0.09, 0.05, frameMat, win.x, wt + 0.045, minZ + 0.025);                 // head casing
  b.box(0.09, win.h + 0.09, 0.05, frameMat, wl - 0.045, wb + win.h / 2, minZ + 0.025);
  b.box(0.09, win.h + 0.09, 0.05, frameMat, wr + 0.045, wb + win.h / 2, minZ + 0.025);
  b.box(win.w + 0.26, 0.04, 0.2, frameMat, win.x, wb - 0.02, minZ + 0.06);                    // sill
  b.box(win.w + 0.12, 0.06, 0.03, frameMat, win.x, wb - 0.07, minZ + 0.02);                   // apron
  // reveals (the wall's thickness)
  b.box(win.w, 0.01, depth, frameMat, win.x, wt, wz); b.box(win.w, 0.01, depth, frameMat, win.x, wb, wz);
  b.box(0.01, win.h, depth, frameMat, wl, wb + win.h / 2, wz); b.box(0.01, win.h, depth, frameMat, wr, wb + win.h / 2, wz);
  // sashes: a centre post and two glazing bars per side
  const gz = minZ - depth + 0.03;
  b.box(0.05, win.h, 0.05, frameMat, win.x, wb + win.h / 2, gz);
  b.box(win.w, 0.05, 0.05, frameMat, win.x, wb + win.h * 0.58, gz);
  for (const s of [-1, 1]) b.box(0.03, win.h, 0.03, frameMat, win.x + s * win.w / 4, wb + win.h / 2, gz);
  b.box(win.w, 0.06, 0.05, frameMat, win.x, wt - 0.03, gz); b.box(win.w, 0.06, 0.05, frameMat, win.x, wb + 0.03, gz);

  // ---- door, with casing, raised panels and a brass knob
  const doorMat = std('#f7f1e8', 0.5);
  const brass = std('#c99b4a', 0.28, 1);
  const dz = maxZ - 0.02;
  b.box(door.w + 0.2, 0.1, 0.05, trimMat, door.x, door.h + 0.05, maxZ - 0.025);
  b.box(0.1, door.h, 0.05, trimMat, door.x - door.w / 2 - 0.05, door.h / 2, maxZ - 0.025);
  b.box(0.1, door.h, 0.05, trimMat, door.x + door.w / 2 + 0.05, door.h / 2, maxZ - 0.025);
  b.box(door.w, door.h, 0.04, doorMat, door.x, door.h / 2, dz + 0.01);
  for (const [py, ph] of [[0.48, 0.62], [1.45, 0.92]] as const) for (const s of [-1, 1]) {
    b.rbox(door.w * 0.36, ph, 0.025, 0.01, doorMat, door.x + s * door.w * 0.22, py, dz - 0.02);
  }
  b.add(new THREE.SphereGeometry(0.03, 20, 14), brass, { x: door.x - door.w / 2 + 0.09, y: 1.0, z: dz - 0.06 });
  b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 24), brass, { x: door.x - door.w / 2 + 0.09, y: 1.0, z: dz - 0.025 }, 0, undefined, new THREE.Euler(Math.PI / 2, 0, 0));
  // light switch by the door
  b.rbox(0.08, 0.12, 0.012, 0.004, frameMat, door.x + door.w / 2 + 0.25, 1.15, dz - 0.005);

  group.add(b.build('shell-static'));

  // ---- glass: a faint reflection, mostly see-through
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(win.w, win.h),
    phys('#ffffff', 0.04, { transparent: true, opacity: 0.08, metalness: 0, envMapIntensity: 1.2, depthWrite: false }));
  glass.position.set(win.x, wb + win.h / 2, gz - 0.005);
  glass.renderOrder = 2;
  group.add(glass);

  // ---- curtains
  group.add(curtains(win.x, wl, wr, wt, minZ));

  // ---- the night outside
  const sky = new NightSky(win.x, wb + win.h / 2, minZ - 2.6);
  group.add(sky.group);
  return { group, sky };
}

/** velvet drapes either side of the window on a brass rod, softly pleated */
function curtains(cx: number, wl: number, wr: number, wt: number, wallZ: number) {
  const g = new THREE.Group();
  const mat = phys('#a8798d', 0.85, { sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color('#f2c6d6'), side: THREE.DoubleSide });
  const top = wt + 0.22, h = top - 0.04;
  for (const s of [-1, 1]) {
    const w = 0.62, segW = 48, segH = 24;
    const geo = new THREE.PlaneGeometry(w, h, segW, segH);
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const v = (y + h / 2) / h;             // 0 bottom .. 1 top
      // pleats, a touch deeper toward the hem where the fabric hangs free
      const pleat = Math.sin((x / w + 0.5) * Math.PI * 9) * (0.022 + 0.012 * (1 - v));
      // gathered a little toward the window side near the bottom, as drapes fall
      const gather = (1 - v) ** 2 * 0.06 * s;
      p.setX(i, x * (1 - (1 - v) * 0.08) + gather);
      p.setZ(i, pleat + 0.02 * fbm((x / w + 0.5) % 1, v, 3, 2, 61));
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    const edge = s < 0 ? wl : wr;
    m.position.set(edge + s * (w / 2 - 0.12), top - h / 2, wallZ + 0.11);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  // rod with finials
  const brass = std('#c99b4a', 0.3, 1);
  const rodLen = wr - wl + 1.2;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, rodLen, 16), brass);
  rod.rotation.z = Math.PI / 2; rod.position.set(cx, top + 0.02, wallZ + 0.12);
  g.add(rod);
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.028, 18, 12), brass);
    f.position.set(cx + s * rodLen / 2, top + 0.02, wallZ + 0.12);
    g.add(f);
  }
  return g;
}

/**
 * Seen through the window: a deep blue evening over soft hills, a crescent moon, a town's
 * lit windows in the distance, stars that twinkle, and a shooting star on cue.
 */
export class NightSky {
  group = new THREE.Group();
  private stars: THREE.Points;
  private shoot: THREE.Mesh;
  private shootT = -1;
  private starMat: THREE.ShaderMaterial;

  constructor(cx: number, cy: number, z: number) {
    const w = 6.5, h = 3.6;
    const c = canvas(1536, 850), ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#0b1033'); g.addColorStop(0.45, '#232a63'); g.addColorStop(0.72, '#5b4a86'); g.addColorStop(0.86, '#b77897'); g.addColorStop(1, '#e7a690');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    // moon: a crescent with a soft halo
    const mx = c.width * 0.66, my = c.height * 0.24;
    const halo = ctx.createRadialGradient(mx, my, 10, mx, my, 160);
    halo.addColorStop(0, 'rgba(255,240,210,0.55)'); halo.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = halo; ctx.fillRect(mx - 170, my - 170, 340, 340);
    const moon = canvas(128), mctx = moon.getContext('2d')!;
    mctx.fillStyle = '#fff4dc'; mctx.beginPath(); mctx.arc(64, 64, 46, 0, Math.PI * 2); mctx.fill();
    mctx.globalCompositeOperation = 'destination-out';
    mctx.beginPath(); mctx.arc(86, 52, 42, 0, Math.PI * 2); mctx.fill();
    ctx.drawImage(moon, mx - 64, my - 64);
    // hills, three layers
    const hill = (base: number, amp: number, col: string, seed: number) => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, c.height);
      for (let x = 0; x <= c.width; x += 8) {
        const u = x / c.width;
        ctx.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin(u * 5 + seed) * 0.6 + 0.4 * fbm(u, 0.5, 3, 3, seed)));
      }
      ctx.lineTo(c.width, c.height); ctx.fill();
    };
    hill(c.height * 0.80, 90, '#3c3462', 1);
    hill(c.height * 0.86, 70, '#2b2549', 2);
    // a little town: houses with warm windows
    for (let k = 0; k < 26; k++) {
      const x = 80 + k * 55 + Math.sin(k * 7.3) * 18, bw = 26 + (k % 3) * 8, bh = 22 + (k * 13 % 20);
      const y = c.height * 0.9 - bh;
      ctx.fillStyle = '#211c3a'; ctx.fillRect(x, y, bw, bh + 40);
      ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + bw / 2, y - 12); ctx.lineTo(x + bw + 3, y); ctx.fill();
      if (k % 2 === 0 || k % 5 === 1) { ctx.fillStyle = '#ffcf7a'; ctx.fillRect(x + 6, y + 8, 5, 6); }
      if (k % 3 === 0) { ctx.fillStyle = '#ffd99a'; ctx.fillRect(x + bw - 11, y + 9, 5, 6); }
    }
    hill(c.height * 0.97, 50, '#1a1630', 3);
    // trees on the nearest hill
    ctx.fillStyle = '#141126';
    for (let k = 0; k < 18; k++) {
      const x = (k * 97 + 40) % c.width, y = c.height * 0.93 + (k % 3) * 10, r = 14 + (k % 4) * 5;
      ctx.beginPath(); ctx.arc(x, y - r, r, 0, Math.PI * 2); ctx.arc(x + r * 0.7, y - r * 0.6, r * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: true, fog: false }));
    plane.position.set(cx, cy + 0.3, z);
    this.group.add(plane);

    // stars: points in front of the backdrop, twinkling in the shader, only in the sky part
    const N = 220, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = Math.pow(Math.random(), 0.7);
      pos[i * 3] = cx + (u - 0.5) * w * 0.95; pos[i * 3 + 1] = cy + 0.3 + (0.5 - v * 0.62) * h; pos[i * 3 + 2] = z + 0.01;
      seed[i] = Math.random();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float seed; uniform float uTime; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float tw = 0.55 + 0.45 * sin(uTime * (1.2 + seed * 2.3) + seed * 40.0);
          vA = tw * (0.4 + 0.6 * seed);
          gl_PointSize = (1.4 + 2.2 * seed) * (300.0 / -mv.z) * 0.06;
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5; float r = length(d);
          float a = smoothstep(0.5, 0.0, r);
          gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * 1.6, a * vA);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.group.add(this.stars);

    // the shooting star: a streak that is scaled along its path
    const sc = canvas(256, 16), sctx = sc.getContext('2d')!;
    const sgr = sctx.createLinearGradient(0, 0, 256, 0);
    sgr.addColorStop(0, 'rgba(255,255,255,0)'); sgr.addColorStop(0.85, 'rgba(255,245,220,0.8)'); sgr.addColorStop(1, 'rgba(255,255,255,1)');
    sctx.fillStyle = sgr; sctx.fillRect(0, 5, 256, 6);
    const stex = new THREE.CanvasTexture(sc); stex.colorSpace = THREE.SRGBColorSpace;
    this.shoot = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.03),
      new THREE.MeshBasicMaterial({ map: stex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2.2, 2.1, 1.9) }));
    this.shoot.visible = false;
    this.shoot.position.z = z + 0.05;
    this.group.add(this.shoot);
    this.origin.set(cx, cy, z);
  }
  private origin = new THREE.Vector3();

  /** a shooting star across the window, ~1.3 s */
  shootingStar() { this.shootT = 0; this.shoot.visible = true; }

  update(dt: number, t: number) {
    this.starMat.uniforms.uTime.value = t;
    if (this.shootT >= 0) {
      this.shootT += dt;
      const k = this.shootT / 1.3;
      const o = this.origin;
      // from upper left to lower right, fading in and out
      this.shoot.position.set(o.x - 1.0 + k * 2.0, o.y + 0.95 - k * 0.6, this.shoot.position.z);
      this.shoot.rotation.z = -Math.atan2(0.6, 2.0);
      (this.shoot.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.min(1, k) * Math.PI);
      if (k >= 1) { this.shootT = -1; this.shoot.visible = false; }
    }
  }
}
