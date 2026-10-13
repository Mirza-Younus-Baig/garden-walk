import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { LAYOUT, ROOM } from '../config';
import { Batcher, std, phys, own, cushion, leg, lathe } from './build';
import { velvet, knit, rug as rugTex, walnut, canvas } from './textures';
import { box, circle, type Collider } from '../core/nav';

/**
 * The furniture: sofa, coffee table, wall TV on a fluted credenza, record player, floor
 * lamp, bookshelf, side table, plants and the rug. Each piece is modelled facing +z at the
 * origin and then placed, so its dimensions read straight off the code.
 */

export interface Furniture {
  group: THREE.Group;
  colliders: Collider[];
  tvScreen: THREE.Mesh;
  record: THREE.Object3D;
  lamp: { shade: THREE.Mesh; bulbs: Array<THREE.SpotLight | THREE.PointLight> };
}

const HALF_PI = Math.PI / 2;

/** `lampShadow`: the floor lamp casts shadows too (desktop; phones keep only the key light's) */
export function buildFurniture(opts: { lampShadow: boolean } = { lampShadow: true }): Furniture {
  const group = new THREE.Group();
  group.name = 'furniture';
  const colliders: Collider[] = [];
  const wood = walnut(512);
  const walnutMat = std('#ffffff', 0.5, 0, { map: wood.map, normalMap: wood.normal, roughnessMap: wood.rough });
  const brass = std('#c99b4a', 0.3, 1);

  // ---------------------------------------------------------------- sofa
  {
    const { x, z, len: L, depth: D, seatY } = LAYOUT.sofa;
    const vel = velvet(512);
    for (const t of [vel.map, vel.normal, vel.rough]) t.repeat.set(2, 2);
    const fabric = phys('#4c7d78', 0.9, {
      map: vel.map, normalMap: vel.normal, roughnessMap: vel.rough, normalScale: new THREE.Vector2(0.35, 0.35),
      sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color('#a8e0d6'),
    });
    const b = new Batcher();
    const legH = 0.12, baseTop = 0.3;
    // frame: base, arms, back
    b.rbox(L, baseTop - legH, D - 0.08, 0.04, fabric, 0, legH + (baseTop - legH) / 2, 0.02);
    for (const s of [-1, 1]) {
      b.add(cushion(0.2, 0.62 - legH, D, 0.07, 0.012), fabric, { x: s * (L / 2 - 0.1), y: legH + (0.62 - legH) / 2, z: 0 });
      // the rounded arm top
      b.add(new THREE.CylinderGeometry(0.1, 0.1, D, 24), fabric, { x: s * (L / 2 - 0.1), y: 0.62, z: 0 }, 0, undefined, new THREE.Euler(HALF_PI, 0, 0));
    }
    b.add(cushion(L - 0.36, 0.56, 0.2, 0.06, 0.01), fabric, { x: 0, y: baseTop + 0.25, z: -D / 2 + 0.11 });
    // seat cushions
    const cw = (L - 0.4) / 2;
    for (const s of [-1, 1]) {
      b.add(cushion(cw - 0.01, seatY - baseTop, D - 0.27, 0.05, 0.016), fabric, { x: s * cw / 2, y: baseTop + (seatY - baseTop) / 2, z: 0.1 });
      // back cushions, leaning back
      b.add(cushion(cw - 0.02, 0.44, 0.2, 0.07, 0.035), fabric, { x: s * cw / 2, y: seatY + 0.2, z: -D / 2 + 0.3 }, 0, undefined, new THREE.Euler(-0.2, 0, 0));
    }
    // legs
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(leg(0.022, 0.014, legH), walnutMat, { x: sx * (L / 2 - 0.08), y: 0, z: sz * (D / 2 - 0.1) });
    const sofa = b.build('sofa');
    // throw pillows, each its own colour
    const pillow = (col: string, sheen: string, px: number, rot: number) => {
      const m = new THREE.Mesh(cushion(0.42, 0.42, 0.13, 0.06, 0.05), phys(col, 0.85, { sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color(sheen), map: vel.map, normalMap: vel.normal, normalScale: new THREE.Vector2(0.3, 0.3) }));
      m.position.set(px, seatY + 0.2, -D / 2 + 0.43); m.rotation.set(-0.25, rot, rot * 0.4);
      m.castShadow = m.receiveShadow = true;
      sofa.add(m);
    };
    pillow('#e2a33e', '#ffe0a0', -L / 2 + 0.42, 0.35);
    pillow('#e8a4a0', '#ffd8d4', L / 2 - 0.42, -0.3);
    pillow('#f2e8dc', '#ffffff', L / 2 - 0.72, -0.12);
    // a knitted throw over the left arm
    const kn = knit(512);
    const throwMat = std('#efe5d4', 0.95, 0, { map: kn.map, normalMap: kn.normal, normalScale: new THREE.Vector2(0.9, 0.9), side: THREE.DoubleSide });
    for (const t of [kn.map, kn.normal]) t.repeat.set(2, 3);
    const drape = new THREE.Mesh(drapeOverArm(-L / 2 + 0.1, 0.62, 0.115, 0.58), throwMat);
    drape.position.z = 0.12;
    drape.castShadow = drape.receiveShadow = true;
    sofa.add(drape);
    sofa.position.set(x, 0, z);
    sofa.rotation.y = -HALF_PI;          // facing -x, toward the TV
    group.add(sofa);
    colliders.push(box(x, z, D, L, 0));
  }

  // ---------------------------------------------------------------- rug
  {
    const { x, z, w, d } = LAYOUT.rug;
    const t = rugTex(1024, 776);
    const mat = std('#ffffff', 0.95, 0, { map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(0.6, 0.6) });
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, 0.012, d, 2, 0.006), mat);
    // the box's top face carries the uv we want; scale uv so the whole design fits the top
    m.position.set(x, 0.006, z);
    m.receiveShadow = true;
    m.name = 'rug';
    group.add(m);
  }

  // ---------------------------------------------------------------- coffee table
  {
    const { x, z, len: L, depth: D, h } = LAYOUT.table;
    const b = new Batcher();
    const shape = new THREE.Shape();
    const r = 0.12, hw = D / 2, hl = L / 2;
    shape.moveTo(-hw + r, -hl); shape.lineTo(hw - r, -hl); shape.quadraticCurveTo(hw, -hl, hw, -hl + r);
    shape.lineTo(hw, hl - r); shape.quadraticCurveTo(hw, hl, hw - r, hl); shape.lineTo(-hw + r, hl);
    shape.quadraticCurveTo(-hw, hl, -hw, hl - r); shape.lineTo(-hw, -hl + r); shape.quadraticCurveTo(-hw, -hl, -hw + r, -hl);
    const top = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 10 });
    top.rotateX(-HALF_PI);
    // planar uv for the grain across the top
    const p = top.getAttribute('position') as THREE.BufferAttribute, uv = top.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 2.4 + 0.5, p.getZ(i) * 1.1 + 0.5);
    b.add(top, walnutMat, { x: 0, y: h - 0.043, z: 0 });
    // shelf below, and splayed legs
    b.rbox(D - 0.12, 0.022, L - 0.16, 0.008, walnutMat, 0, 0.12, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.add(leg(0.02, 0.014, h - 0.04), walnutMat, { x: sx * (hw - 0.07), y: 0, z: sz * (hl - 0.09) }, 0, undefined, new THREE.Euler(sz * 0.05, 0, -sx * 0.05));
    }
    // a couple of books and a small tray on the shelf
    const bookCols = ['#c56a5b', '#d9b45a', '#6f8fb0'];
    bookCols.forEach((c, i) => b.rbox(0.2 - i * 0.015, 0.03, 0.27 - i * 0.02, 0.003, std(c, 0.7), 0.05, 0.146 + i * 0.031, 0.25, 0.1 * i));
    const tbl = b.build('table');
    tbl.position.set(x, 0, z);
    group.add(tbl);
    colliders.push(box(x, z, D + 0.04, L + 0.04, 0));
  }

  // ---------------------------------------------------------------- TV stand (credenza)
  {
    const { z, len: L, depth: D, h } = LAYOUT.stand;
    const b = new Batcher();
    const legH = 0.12;
    b.rbox(L, h - legH, D, 0.012, walnutMat, 0, legH + (h - legH) / 2, 0);
    // fluted doors: half-round reeds across the front
    const reed = new THREE.CylinderGeometry(0.012, 0.012, h - legH - 0.06, 10, 1, false, 0, Math.PI);
    const n = Math.floor((L - 0.06) / 0.026);
    for (let k = 0; k < n; k++) b.add(reed, walnutMat, { x: -L / 2 + 0.04 + k * 0.026, y: legH + (h - legH) / 2, z: D / 2 }, -HALF_PI);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(leg(0.013, 0.01, legH), brass, { x: sx * (L / 2 - 0.08), y: 0, z: sz * (D / 2 - 0.07) });
    // a brass rail at the top edge
    b.add(new THREE.CylinderGeometry(0.006, 0.006, L - 0.04, 10), brass, { x: 0, y: h - 0.02, z: D / 2 + 0.004 }, 0, undefined, new THREE.Euler(0, 0, HALF_PI));
    const stand = b.build('stand');
    // decor on top: books stacked, a candle jar, a little vase of pampas
    const top = h;
    const deco = new Batcher();
    const bc = ['#f0d9c8', '#a6b9a0', '#d79b8f'];
    // (the stand is turned a quarter: its local +x runs toward -z in the room)
    bc.forEach((c, i) => deco.rbox(0.24 - i * 0.02, 0.035, 0.17, 0.004, std(c, 0.75), 0.35, top + 0.018 + i * 0.036, -0.02, 0.15 * i - 0.1));
    deco.add(lathe([[0, 0], [0.045, 0], [0.05, 0.02], [0.05, 0.09], [0.046, 0.095], [0, 0.095]]), phys('#f3e6d6', 0.3, { clearcoat: 0.6 }), { x: 0.35, y: top + 0.125, z: -0.02 });
    deco.add(lathe([[0, 0], [0.05, 0.005], [0.07, 0.07], [0.05, 0.16], [0.03, 0.2], [0.032, 0.22], [0, 0.22]]), phys('#d4b59a', 0.6), { x: 0.8, y: top, z: -0.04 });
    stand.add(deco.build('stand-deco'));
    // pampas plumes: soft, feathery cones
    const pampasMat = std('#ead7bd', 1, 0, { transparent: true, opacity: 0.92 });
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.003, 0.5, 5), std('#c9b18c', 0.8));
      const tilt = 0.18 + (k % 2) * 0.12;
      stem.position.set(0.8 + Math.cos(a) * 0.05, top + 0.42, -0.04 + Math.sin(a) * 0.05);
      stem.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.24, 10, 4), pampasMat);
      plume.position.y = 0.3;
      stem.add(plume);
      stand.add(stem);
    }
    // record player
    const rp = recordPlayer(walnutMat, brass);
    rp.group.position.set(-(LAYOUT.record.z - z), top, 0.0);
    stand.add(rp.group);
    stand.position.set(ROOM.minX + D / 2 + 0.02, 0, z);
    stand.rotation.y = HALF_PI;
    group.add(stand);
    colliders.push(box(ROOM.minX + D / 2 + 0.02, z, D + 0.04, L + 0.04, 0));
    recordRef = rp.disc;
  }

  // ---------------------------------------------------------------- wall TV
  const tvScreen = (() => {
    const { z, y, w, h } = LAYOUT.tv;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(w + 0.03, h + 0.03, 0.035, 2, 0.006), phys('#141416', 0.35, { metalness: 0.4, clearcoat: 0.6 }));
    body.castShadow = true;
    g.add(body);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), own(phys('#050506', 0.12, {
      clearcoat: 1, clearcoatRoughness: 0.05, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0,
    })));
    screen.position.z = 0.0181;
    screen.name = 'tvScreen';
    g.add(screen);
    g.position.set(ROOM.minX + 0.04, y, z);
    g.rotation.y = HALF_PI;
    group.add(g);
    return screen;
  })();

  // ---------------------------------------------------------------- floor lamp
  const lamp = (() => {
    const { x, z } = LAYOUT.lamp;
    const g = new THREE.Group();
    const b = new Batcher();
    // tripod of wooden legs meeting under the stem
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      b.add(leg(0.012, 0.016, 0.62), walnutMat, { x: Math.cos(a) * 0.17, y: 0, z: Math.sin(a) * 0.17 }, 0, undefined,
        new THREE.Euler(Math.sin(a) * 0.27, 0, -Math.cos(a) * 0.27, 'XYZ'));
    }
    b.add(leg(0.011, 0.011, 1.05), brass, { x: 0, y: 0.58, z: 0 });
    b.add(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 16), brass, { x: 0, y: 0.6, z: 0 });
    g.add(b.build('lamp-frame'));
    // linen drum shade: lit from inside, so it glows
    const shadeMat = own(phys('#f6e7cf', 0.9, { side: THREE.DoubleSide, emissive: new THREE.Color('#ffb661'), emissiveIntensity: 0.9, sheen: 0.4, sheenColor: new THREE.Color('#fff2dc') }));
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.3, 40, 1, true), shadeMat);
    shade.position.y = 1.62;
    shade.castShadow = false;
    g.add(shade);
    // light: a soft spot down onto the floor (casts the shadows) and a glow up the wall
    const down = new THREE.SpotLight('#ffbf7a', 9, 6, 1.15, 0.85, 2);
    down.position.set(0, 1.55, 0);
    down.target.position.set(0.3, 0, 0.2);
    down.castShadow = opts.lampShadow;
    down.shadow.mapSize.set(1024, 1024);
    down.shadow.radius = 6;
    down.shadow.bias = -0.0004;
    down.shadow.normalBias = 0.02;
    down.shadow.camera.near = 0.1; down.shadow.camera.far = 6;
    g.add(down, down.target);
    const up = new THREE.PointLight('#ffb766', 2.2, 5, 2);
    up.position.set(0, 1.72, 0);
    g.add(up);
    g.position.set(x, 0, z);
    group.add(g);
    colliders.push(circle(x, z, 0.24));
    return { shade, bulbs: [down, up] };
  })();

  // ---------------------------------------------------------------- bookshelf
  {
    const { x, z, w, d, h } = LAYOUT.shelf;
    const b = new Batcher();
    const white = std('#f3ede4', 0.55);
    b.box(w, 0.03, d, white, 0, h - 0.015, 0); b.box(w, 0.06, d, white, 0, 0.03, 0);
    for (const s of [-1, 1]) b.box(0.03, h, d, white, s * (w / 2 - 0.015), h / 2, 0);
    b.box(w, h, 0.01, std('#e9dfd3', 0.8), 0, h / 2, -d / 2 + 0.005);
    const shelves = [0.06, 0.45, 0.85, 1.25, 1.65];
    for (const y of shelves.slice(1)) b.box(w - 0.06, 0.025, d - 0.01, white, 0, y, 0.005);
    const bookColors = ['#c56a5b', '#d9b45a', '#6f8fb0', '#89a88a', '#e3c1b6', '#5d5b7a', '#efe5d6', '#a0705a'];
    const bookMats = bookColors.map((c) => std(c, 0.7));
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    shelves.forEach((y0, si) => {
      let cx = -w / 2 + 0.05;
      const end = si % 2 === 0 ? w / 2 - 0.35 : w / 2 - 0.05;
      while (cx < end) {
        const bw = 0.022 + rnd() * 0.03, bh = 0.2 + rnd() * 0.11, bd = 0.17 + rnd() * 0.06;
        if (cx + bw > end) break;
        const lean = rnd() < 0.08 ? 0.15 : 0;
        b.rbox(bw, bh, bd, 0.003, bookMats[(rnd() * bookMats.length) | 0], cx + bw / 2, y0 + 0.0125 + bh / 2, 0.02, 0);
        cx += bw + 0.002 + lean * 0.1;
      }
      if (si % 2 === 0) {
        // the open end of the shelf holds an object
        const ox = w / 2 - 0.18;
        if (si === 0) b.add(lathe([[0, 0], [0.08, 0], [0.1, 0.1], [0.07, 0.2], [0.04, 0.24], [0, 0.24]]), phys('#d98f7a', 0.5), { x: ox, y: y0 + 0.012, z: 0 });
        if (si === 2) b.add(new THREE.SphereGeometry(0.075, 28, 20), phys('#7ba3c7', 0.4, { clearcoat: 0.5 }), { x: ox, y: y0 + 0.1, z: 0 });
        if (si === 4) for (let k = 0; k < 4; k++) b.rbox(0.18, 0.025, 0.13, 0.003, bookMats[k], ox, y0 + 0.025 + k * 0.026, 0, k * 0.2);
      }
    });
    const shelf = b.build('shelf');
    shelf.position.set(x, 0, z);
    shelf.rotation.y = -HALF_PI;
    group.add(shelf);
    colliders.push(box(x, z, d + 0.04, w + 0.04, 0));
    // a trailing plant on the top
    const pothos = trailingPlant();
    pothos.position.set(x - 0.02, h, z + 0.3);
    group.add(pothos);
  }

  // ---------------------------------------------------------------- side table by the sofa
  {
    const { x, z } = LAYOUT.sideTable;
    const b = new Batcher();
    const marble = phys('#f1ece6', 0.25, { clearcoat: 0.6, clearcoatRoughness: 0.2 });
    b.add(new THREE.CylinderGeometry(0.24, 0.24, 0.025, 48), marble, { x: 0, y: 0.56, z: 0 });
    b.add(leg(0.02, 0.02, 0.54), brass, { x: 0, y: 0.02, z: 0 });
    b.add(new THREE.CylinderGeometry(0.15, 0.17, 0.02, 40), brass, { x: 0, y: 0.01, z: 0 });
    // a jar of sweets with a cork lid
    const jarGlass = phys('#f4fbff', 0.05, { transparent: true, opacity: 0.18, depthWrite: false, envMapIntensity: 1.5, clearcoat: 1 });
    b.add(lathe([[0, 0], [0.055, 0], [0.06, 0.02], [0.06, 0.13], [0.05, 0.145], [0, 0.145]], 32), jarGlass, { x: 0.06, y: 0.575, z: 0.04 });
    b.add(new THREE.CylinderGeometry(0.046, 0.044, 0.03, 24), std('#b98d5c', 0.9), { x: 0.06, y: 0.735, z: 0.04 });
    const sweets = ['#ff8fab', '#ffd166', '#8ecae6', '#b9e769', '#cdb4db'].map((c) => phys(c, 0.3, { clearcoat: 1 }));
    for (let k = 0; k < 26; k++) {
      const a = k * 2.4, rr = 0.012 + (k % 4) * 0.011;
      b.add(new THREE.SphereGeometry(0.011, 10, 8), sweets[k % sweets.length], { x: 0.06 + Math.cos(a) * rr, y: 0.59 + (k / 26) * 0.08, z: 0.04 + Math.sin(a) * rr });
    }
    const st = b.build('side-table');
    st.position.set(x, 0, z);
    group.add(st);
    colliders.push(circle(x, z, 0.27));
  }

  // ---------------------------------------------------------------- plants
  const fig = figPlant(1.55, 3);
  fig.position.set(ROOM.minX + 0.45, 0, ROOM.maxZ - 0.45);
  group.add(fig);
  colliders.push(circle(ROOM.minX + 0.45, ROOM.maxZ - 0.45, 0.3));
  const snake = snakePlant(0.75);
  snake.position.set(ROOM.minX + 0.32, 0, -1.55);
  group.add(snake);
  colliders.push(circle(ROOM.minX + 0.32, -1.55, 0.2));
  const fig2 = figPlant(1.25, 11);
  fig2.position.set(ROOM.maxX - 0.42, 0, ROOM.maxZ - 1.6);
  group.add(fig2);
  colliders.push(circle(ROOM.maxX - 0.42, ROOM.maxZ - 1.6, 0.28));

  return { group, colliders, tvScreen, record: recordRef!, lamp };
}

let recordRef: THREE.Object3D | null = null;

/**
 * A knitted throw hung over the sofa arm: its cross-section runs down the seat side, over
 * the round top of the arm and down the outside, and its hem ripples where it hangs free.
 * x across the arm, y up, z along the arm (width).
 */
function drapeOverArm(armX: number, armY: number, r: number, width: number) {
  // the profile, as points in (x, y)
  const prof: Array<[number, number]> = [];
  const inner = armX + r + 0.012, outer = armX - r - 0.012;
  for (let k = 0; k <= 6; k++) prof.push([inner + 0.004 * k, 0.5 + (armY - 0.5) * (k / 6)]);
  for (let k = 1; k < 16; k++) { const a = (k / 16) * Math.PI; prof.push([armX + Math.cos(a) * (r + 0.012), armY + Math.sin(a) * (r + 0.012)]); }
  for (let k = 0; k <= 10; k++) prof.push([outer - 0.01 * (k / 10) ** 2, armY - (armY - 0.22) * (k / 10)]);
  // arclength along the profile
  const acc = [0];
  for (let k = 1; k < prof.length; k++) acc.push(acc[k - 1] + Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]));
  const total = acc[acc.length - 1];
  const nu = prof.length - 1, nv = 16;
  const g = new THREE.PlaneGeometry(1, 1, nu, nv);
  const p = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const iu = Math.round((p.getX(i) + 0.5) * nu), v = p.getY(i) + 0.5;
    const [x, y] = prof[iu];
    // where it hangs free (the two ends of the profile) the cloth ripples along its width
    const free = Math.max(0, 1 - acc[iu] / (total * 0.25), (acc[iu] - total * 0.7) / (total * 0.3));
    const ripple = Math.sin(v * Math.PI * 4) * 0.012 * free;
    p.setXYZ(i, x + (x > armX ? ripple : -ripple), y, (v - 0.5) * width * (1 + 0.04 * free));
    uv.setXY(i, acc[iu] / 0.25, v * width / 0.25);
  }
  g.computeVertexNormals();
  return g;
}

/** a walnut turntable with a spinning record and a silver tonearm */
function recordPlayer(walnutMat: THREE.Material, brass: THREE.Material) {
  const g = new THREE.Group();
  const b = new Batcher();
  b.rbox(0.44, 0.09, 0.34, 0.012, walnutMat, 0, 0.045, 0);
  b.box(0.42, 0.004, 0.32, std('#2a2a2c', 0.6), 0, 0.092, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(new THREE.CylinderGeometry(0.015, 0.017, 0.012, 16), brass, { x: sx * 0.19, y: -0.006, z: sz * 0.14 });
  // tonearm
  const silver = std('#d9d9de', 0.25, 1);
  b.add(new THREE.CylinderGeometry(0.02, 0.022, 0.03, 20), silver, { x: 0.16, y: 0.108, z: -0.1 });
  b.add(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 10), silver, { x: 0.1, y: 0.125, z: -0.01 }, 0, undefined, new THREE.Euler(HALF_PI, 0, 0.55));
  b.rbox(0.02, 0.01, 0.035, 0.003, std('#1a1a1a', 0.5), 0.045, 0.118, 0.07, 0.5);
  // knobs
  b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16), brass, { x: 0.17, y: 0.095, z: 0.13 });
  b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16), brass, { x: 0.13, y: 0.095, z: 0.13 });
  g.add(b.build('record-player'));
  // the platter and record spin together
  const disc = new THREE.Group();
  disc.position.set(-0.04, 0.098, 0);
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.008, 64), std('#3a3a3e', 0.4, 0.6));
  disc.add(platter);
  const lc = canvas(256), lctx = lc.getContext('2d')!;
  lctx.fillStyle = '#111'; lctx.fillRect(0, 0, 256, 256);
  for (let r = 40; r < 128; r += 2) { lctx.strokeStyle = `rgba(255,255,255,${0.03 + (r % 6 === 0 ? 0.03 : 0)})`; lctx.beginPath(); lctx.arc(128, 128, r, 0, Math.PI * 2); lctx.stroke(); }
  lctx.fillStyle = '#f2a7b8'; lctx.beginPath(); lctx.arc(128, 128, 38, 0, Math.PI * 2); lctx.fill();
  lctx.fillStyle = '#7a2e47'; lctx.font = '600 13px Fredoka, sans-serif'; lctx.textAlign = 'center';
  lctx.fillText('Birthday', 128, 122); lctx.fillText('Songs', 128, 138);
  lctx.fillStyle = '#ddd'; lctx.beginPath(); lctx.arc(128, 128, 3, 0, Math.PI * 2); lctx.fill();
  const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
  const vinyl = new THREE.Mesh(new THREE.CylinderGeometry(0.148, 0.148, 0.003, 64), [
    std('#111', 0.35), std('#ffffff', 0.3, 0, { map: lt }), std('#111', 0.35),
  ]);
  vinyl.position.y = 0.0055;
  disc.add(vinyl);
  g.add(disc);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, disc };
}

// ---------------------------------------------------------------- plants
/** one leaf as a curved, folded blade: length along +y, width along x */
function leafGeometry(len: number, width: number, fold = 0.35, curl = 0.25) {
  const g = new THREE.PlaneGeometry(1, 1, 4, 8);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2, v = p.getY(i) + 0.5;      // u -1..1 across, v 0..1 along
    const outline = Math.sin(Math.PI * Math.min(1, v * 1.05)) ** 0.8 * (1 - 0.25 * v);
    const x = u * outline * width / 2, y = v * len;
    const z = -Math.abs(u) * fold * width * 0.3 + curl * len * v * v;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function figPlant(height: number, seed: number) {
  const g = new THREE.Group();
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const b = new Batcher();
  const pot = phys('#efe7dc', 0.55, { clearcoat: 0.3 });
  b.add(lathe([[0, 0], [0.16, 0], [0.19, 0.04], [0.21, 0.34], [0.2, 0.36], [0, 0.36]], 40), pot);
  b.add(new THREE.CylinderGeometry(0.19, 0.19, 0.01, 32), std('#3a2b20', 1), { x: 0, y: 0.345, z: 0 });
  const stemMat = std('#6a5240', 0.9);
  const leafMat = phys('#3f6e3a', 0.55, { side: THREE.DoubleSide, sheen: 0.3, sheenColor: new THREE.Color('#9fd48f'), clearcoat: 0.25 });
  const leafG = leafGeometry(0.26, 0.17, 0.4, 0.15);
  for (let stem = 0; stem < 3; stem++) {
    const ang = stem * 2.1 + rnd();
    const tilt = 0.08 + rnd() * 0.12;
    const hgt = height * (0.75 + rnd() * 0.25) - 0.36;
    const dir = new THREE.Vector3(Math.cos(ang) * tilt, 1, Math.sin(ang) * tilt).normalize();
    b.add(new THREE.CylinderGeometry(0.008, 0.012, hgt, 8), stemMat, dir.clone().multiplyScalar(hgt / 2).add(new THREE.Vector3(0, 0.36, 0)), 0, undefined,
      new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)));
    const leaves = 9 + Math.floor(rnd() * 4);
    for (let k = 0; k < leaves; k++) {
      const t = 0.35 + 0.65 * (k / leaves);
      const p = dir.clone().multiplyScalar(hgt * t).add(new THREE.Vector3(0, 0.36, 0));
      const yaw = k * 2.4 + ang;
      const pitch = 0.5 + rnd() * 0.5 - t * 0.2;
      const sc = 0.75 + 0.35 * t + rnd() * 0.15;
      b.add(leafG, leafMat, p, 0, { x: sc, y: sc, z: sc }, new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    }
  }
  g.add(b.build('fig'));
  return g;
}

function snakePlant(height: number) {
  const g = new THREE.Group();
  const b = new Batcher();
  b.add(lathe([[0, 0], [0.11, 0], [0.13, 0.22], [0.125, 0.23], [0, 0.23]], 32), phys('#c9775a', 0.75));
  b.add(new THREE.CylinderGeometry(0.12, 0.12, 0.01, 24), std('#3a2b20', 1), { x: 0, y: 0.22, z: 0 });
  // banded blades, drawn so the bands run across them
  const c = canvas(64, 256), ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2f5a35'; ctx.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 9) { ctx.fillStyle = `rgba(160,190,120,${0.25 + 0.2 * Math.sin(y)})`; ctx.fillRect(0, y, 64, 3 + (y % 3)); }
  ctx.fillStyle = '#d6c76a'; ctx.fillRect(0, 0, 4, 256); ctx.fillRect(60, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const bladeMat = std('#ffffff', 0.5, 0, { map: tex, side: THREE.DoubleSide });
  for (let k = 0; k < 9; k++) {
    const a = k * 2.4, r = 0.03 + (k % 3) * 0.02;
    const len = height * (0.6 + ((k * 37) % 10) / 25);
    const blade = leafGeometry(len, 0.07, 0.6, 0.02);
    b.add(blade, bladeMat, { x: Math.cos(a) * r, y: 0.21, z: Math.sin(a) * r }, 0, undefined, new THREE.Euler(Math.sin(a) * 0.12, a, Math.cos(a) * 0.1, 'YXZ'));
  }
  g.add(b.build('snake'));
  return g;
}

/** pothos tumbling over the shelf edge: strings of heart-shaped leaves */
function trailingPlant() {
  const g = new THREE.Group();
  const b = new Batcher();
  b.add(lathe([[0, 0], [0.07, 0], [0.09, 0.12], [0, 0.12]], 28), phys('#efe7dc', 0.5), { x: 0, y: 0, z: 0 });
  const leafMat = phys('#4f8a3f', 0.5, { side: THREE.DoubleSide, clearcoat: 0.2 });
  const leafG = leafGeometry(0.07, 0.06, 0.3, 0.05);
  for (let v = 0; v < 5; v++) {
    const a = v * 1.3 - 1.5;
    for (let k = 0; k < 9; k++) {
      const t = k / 9;
      const x = Math.cos(a) * (0.06 + t * 0.2), z = Math.sin(a) * (0.06 + t * 0.1);
      const y = 0.11 - t * t * 0.9 * (v % 2 ? 0.8 : 1);
      b.add(leafG, leafMat, { x, y, z }, 0, undefined, new THREE.Euler(1.2 - t, a + k, 0.3, 'YXZ'));
    }
  }
  g.add(b.build('pothos'));
  return g;
}
