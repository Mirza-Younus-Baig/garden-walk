import * as THREE from 'three';
import { CANDLES } from '../config';
import { canvas, fbm, normalFromHeight, toTexture } from '../room/textures';
import { lathe, phys, std } from '../room/build';

/**
 * The chocolate cake on its porcelain stand: dark ganache sides, a glossy ganache top
 * with drips running over the edge, a ring of piped milk-chocolate rosettes, raspberries,
 * gold sprinkles, shards of chocolate, and a white-chocolate plaque with her name.
 *
 * Built at the origin with y up from the table top; candle tops are exposed so the flames
 * can sit on them.
 */

export interface CakeModel {
  group: THREE.Group;
  /** world-space-at-origin tops of the wicks, before the group is placed */
  wickTops: THREE.Vector3[];
  /** where the cake's top surface is, above the table */
  topY: number;
}

const R = 0.125, H = 0.12;

export function buildCake(name: string): CakeModel {
  const group = new THREE.Group();
  group.name = 'cake';

  // ---- porcelain stand
  const porcelain = phys('#fbf8f3', 0.18, { clearcoat: 1, clearcoatRoughness: 0.08 });
  const stand = new THREE.Mesh(lathe([
    [0, 0], [0.085, 0], [0.09, 0.006], [0.07, 0.012], [0.03, 0.025], [0.024, 0.06], [0.03, 0.07],
    [0.16, 0.076], [0.172, 0.084], [0.168, 0.088], [0, 0.088],
  ], 64), porcelain);
  stand.castShadow = stand.receiveShadow = true;
  group.add(stand);
  const base = 0.088;

  // ---- sides: milk-chocolate buttercream with palette-knife sweeps (matte, so the glossy
  // dark drips stand out against it)
  const sideTex = (() => {
    const w = 512, h = 128, hgt = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      hgt[y * w + x] = 0.5 * fbm(u, v, 6, 3, 71, 6, 2) + 0.5 * Math.sin((v * 3 + fbm(u, v, 3, 2, 73) * 1.5) * Math.PI * 2) * 0.3;
    }
    return toTexture(normalFromHeight(hgt, w, h, 2.0), false);
  })();
  const darkGanache = phys('#6a3d27', 0.55, { clearcoat: 0.15, clearcoatRoughness: 0.5, normalMap: sideTex, normalScale: new THREE.Vector2(0.6, 0.6), sheen: 0.3, sheenColor: new THREE.Color('#7a4a33') });
  const side = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 96, 1, true), darkGanache);
  side.position.y = base + H / 2;
  side.castShadow = side.receiveShadow = true;
  group.add(side);
  // a thin base border of piped dots where the cake meets the plate
  const dotGeo = new THREE.SphereGeometry(0.008, 12, 10);
  const milk = phys('#6b3f27', 0.42, { clearcoat: 0.4, sheen: 0.4, sheenColor: new THREE.Color('#a87556') });
  const dots = new THREE.InstancedMesh(dotGeo, milk, 56);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2;
    m.makeTranslation(Math.cos(a) * (R + 0.003), base + 0.006, Math.sin(a) * (R + 0.003));
    dots.setMatrixAt(i, m);
  }
  dots.castShadow = true;
  group.add(dots);

  // ---- glossy top and drips
  const gloss = phys('#22100a', 0.1, { clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.2, sheenColor: new THREE.Color('#6b3a22') });
  const top = base + H;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.004, R + 0.004, 0.006, 96), gloss);
  cap.position.y = top + 0.001;
  cap.receiveShadow = true;
  group.add(cap);
  // drip lengths round the rim: a base lip plus random runs
  const SEG = 192, ROWS = 10;
  const runs = Array.from({ length: 20 }, (_, i) => ({ a: (i / 20) * Math.PI * 2 + Math.sin(i * 12.9) * 0.1, len: 0.016 + ((i * 37) % 11) / 11 * 0.042, w: 0.075 + ((i * 7) % 5) * 0.014 }));
  const dripLen = (a: number) => {
    let L = 0.009;
    for (const r of runs) {
      let d = Math.abs(a - r.a); d = Math.min(d, Math.PI * 2 - d);
      L = Math.max(L, r.len * Math.exp(-(d * d) / (r.w * r.w * 0.5)));
    }
    return L;
  };
  const pos: number[] = [], idx: number[] = [];
  for (let j = 0; j <= ROWS; j++) for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2, t = j / ROWS;
    const L = dripLen(a);
    // the drip bulges a little as it runs down, and rounds under at the end
    const r = R + 0.0045 + 0.0016 * t;
    pos.push(Math.cos(a) * r, top - L * t, Math.sin(a) * r);
  }
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < SEG; i++) {
    const a = j * (SEG + 1) + i, b = a + SEG + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  dg.setIndex(idx);
  dg.computeVertexNormals();
  const drips = new THREE.Mesh(dg, gloss);
  drips.castShadow = true;
  group.add(drips);
  // the bead at the end of each long drip
  for (const r of runs) if (r.len > 0.026) {
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 16, 12), gloss);
    bead.position.set(Math.cos(r.a) * (R + 0.0035), top - r.len + 0.0035, Math.sin(r.a) * (R + 0.0035));
    bead.scale.set(1, 1.15, 0.7);
    bead.lookAt(0, bead.position.y, 0);
    group.add(bead);
  }

  // ---- rosettes: star-piped swirls round the top edge
  const rosette = (() => {
    const g = lathe([[0, 0], [0.016, 0], [0.018, 0.006], [0.014, 0.014], [0.008, 0.021], [0.003, 0.027], [0, 0.03]], 48);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x), r = Math.hypot(x, z);
      const k = 1 + 0.2 * Math.cos(8 * a + y * 260);   // eight ridges, twisting as it rises
      p.setXYZ(i, Math.cos(a) * r * k, y, Math.sin(a) * r * k);
    }
    g.computeVertexNormals();
    return g;
  })();
  const ROS = 12;
  const ros = new THREE.InstancedMesh(rosette, milk, ROS);
  const q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  for (let i = 0; i < ROS; i++) {
    const a = (i / ROS) * Math.PI * 2 + 0.13;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a * 3.7);
    m.compose(v.set(Math.cos(a) * (R - 0.02), top + 0.002, Math.sin(a) * (R - 0.02)), q, s);
    ros.setMatrixAt(i, m);
  }
  ros.castShadow = true;
  group.add(ros);

  // ---- raspberries on every other rosette
  const berryGeo = (() => {
    const g = new THREE.IcosahedronGeometry(0.0095, 3);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      // drupelets: bumps on a lattice
      const bump = Math.pow(Math.abs(Math.sin(n.x * 14) * Math.sin(n.y * 14) * Math.sin(n.z * 14)), 0.5) * 0.0012;
      v.copy(n).multiplyScalar(0.0095 + bump);
      v.y *= 1.15;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  })();
  const berryMat = phys('#b3123a', 0.35, { clearcoat: 0.5, sheen: 0.6, sheenColor: new THREE.Color('#ff7090') });
  const berries = new THREE.InstancedMesh(berryGeo, berryMat, ROS / 2);
  for (let i = 0; i < ROS / 2; i++) {
    const a = ((i * 2) / ROS) * Math.PI * 2 + 0.13;
    m.compose(v.set(Math.cos(a) * (R - 0.02), top + 0.036, Math.sin(a) * (R - 0.02)), q.setFromEuler(new THREE.Euler(0.3, a, 0.2)), s);
    berries.setMatrixAt(i, m);
  }
  berries.castShadow = true;
  group.add(berries);

  // ---- gold sprinkles over the top
  const sprinkle = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.0012, 0.004, 3, 6), phys('#e8c06a', 0.25, { metalness: 1 }), 90);
  for (let i = 0; i < 90; i++) {
    const a = i * 2.39996, r = 0.03 + Math.sqrt(i / 90) * (R - 0.05);
    m.compose(v.set(Math.cos(a) * r, top + 0.0045, Math.sin(a) * r), q.setFromEuler(new THREE.Euler(Math.PI / 2, a * 1.7, 0)), s);
    sprinkle.setMatrixAt(i, m);
  }
  group.add(sprinkle);

  // ---- the plaque: white chocolate, piped with her name
  const plaqueTex = (() => {
    const c = canvas(512), ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f6ecd9'; ctx.fillRect(0, 0, 512, 512);
    const g = ctx.createRadialGradient(256, 230, 40, 256, 256, 256);
    g.addColorStop(0, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(200,170,130,0.25)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#4a2617'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 64px "Dancing Script", cursive';
    ctx.fillText('Happy Birthday', 256, 196);
    ctx.font = '700 132px "Dancing Script", cursive';
    ctx.fillText(name, 256, 316, 440);
    // piped dots round the edge
    for (let k = 0; k < 36; k++) { const a = (k / 36) * Math.PI * 2; ctx.beginPath(); ctx.arc(256 + Math.cos(a) * 226, 256 + Math.sin(a) * 226, 9, 0, Math.PI * 2); ctx.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  })();
  const plaque = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.005, 64), [
    std('#d9c8aa', 0.6), phys('#e2d6c4', 0.62, { map: plaqueTex, clearcoat: 0.15 }), std('#d9c8aa', 0.6),
  ]);
  plaque.position.y = top + 0.006;
  plaque.rotation.y = Math.PI / 2;      // the writing faces the +x side... turned to the guest below
  plaque.castShadow = true;
  group.add(plaque);

  // ---- candles: thin, spiral-striped, pastel
  const wickTops: THREE.Vector3[] = [];
  const palette = ['#f7a8c0', '#9fd3f2', '#fbe18a', '#a9e5c4', '#cdb4f5', '#ffc0a0', '#f7a8c0', '#9fd3f2'];
  const candleGeo = new THREE.CylinderGeometry(0.0042, 0.0045, CANDLES.height, 16, 1);
  candleGeo.translate(0, CANDLES.height / 2, 0);
  const wickGeo = new THREE.CylinderGeometry(0.0007, 0.0008, 0.008, 6);
  wickGeo.translate(0, 0.004, 0);
  const wickMat = std('#1b1612', 0.9);
  for (let i = 0; i < CANDLES.count; i++) {
    const a = (i / CANDLES.count) * Math.PI * 2 + Math.PI / CANDLES.count;
    const c = canvas(32, 128), ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fffaf2'; ctx.fillRect(0, 0, 32, 128);
    ctx.fillStyle = palette[i];
    for (let y = -40; y < 160; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(32, y + 26); ctx.lineTo(32, y + 37); ctx.lineTo(0, y + 11); ctx.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const candle = new THREE.Mesh(candleGeo, phys('#ffffff', 0.45, { map: tex, sheen: 0.4, sheenColor: new THREE.Color('#ffffff'), clearcoat: 0.2 }));
    const cx = Math.cos(a) * CANDLES.ringR, cz = Math.sin(a) * CANDLES.ringR;
    candle.position.set(cx, top + 0.002, cz);
    candle.castShadow = true;
    group.add(candle);
    const wick = new THREE.Mesh(wickGeo, wickMat);
    wick.position.set(cx, top + 0.002 + CANDLES.height, cz);
    group.add(wick);
    wickTops.push(new THREE.Vector3(cx, top + 0.002 + CANDLES.height + 0.007, cz));
  }
  return { group, wickTops, topY: top };
}
