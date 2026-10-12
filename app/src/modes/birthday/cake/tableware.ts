import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { canvas } from '../room/textures';
import { lathe, phys, std } from '../room/build';

/**
 * Beside the cake: a glass vase of lilies, tulips and daisies (the garden's own scanned
 * flowers, see tools/build_bouquet.mjs), and a folded card with her name on it.
 */

export async function buildBouquet(loader: GLTFLoader): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'bouquet';
  // ---- vase: clear glass with water in it
  const glass = phys('#ffffff', 0.03, { transmission: 1, thickness: 0.006, ior: 1.5, transparent: true, envMapIntensity: 1.2, specularIntensity: 1 });
  const profile: Array<[number, number]> = [[0, 0], [0.05, 0], [0.068, 0.03], [0.074, 0.08], [0.06, 0.14], [0.042, 0.19], [0.046, 0.215], [0.05, 0.22]];
  const vase = new THREE.Mesh(lathe(profile, 64), glass);
  vase.material.side = THREE.DoubleSide;
  vase.castShadow = true;
  group.add(vase);
  const water = new THREE.Mesh(lathe([[0, 0.006], [0.046, 0.006], [0.064, 0.03], [0.069, 0.08], [0.058, 0.12], [0, 0.12]], 48),
    phys('#d8f0ec', 0.02, { transmission: 0.95, thickness: 0.05, ior: 1.33, transparent: true, attenuationColor: new THREE.Color('#bfe8dc'), attenuationDistance: 0.4 }));
  group.add(water);

  // ---- flowers
  const gltf = await loader.loadAsync('/models/bouquet.glb');
  const byName = (n: string) => {
    const o = gltf.scene.getObjectByName(n) as THREE.Mesh | undefined;
    if (!o) throw new Error(`bouquet: missing ${n}`);
    return o;
  };
  const stem = (src: THREE.Mesh, height: number, ang: number, tilt: number, spin: number) => {
    const m = new THREE.Mesh(src.geometry, src.material);
    // normalise: the scans are each their own size; stand the base at the origin
    src.geometry.computeBoundingBox();
    const bb = src.geometry.boundingBox!;
    const s = height / (bb.max.y - bb.min.y);
    const holder = new THREE.Group();
    m.scale.setScalar(s);
    m.position.set(0, -bb.min.y * s, 0);
    m.rotation.y = spin;
    holder.add(m);
    // stems start low in the vase and fan out
    holder.position.set(Math.cos(ang) * 0.012, 0.012, Math.sin(ang) * 0.012);
    holder.rotation.set(Math.sin(ang) * tilt, 0, -Math.cos(ang) * tilt);
    m.castShadow = true; m.receiveShadow = true;
    group.add(holder);
  };
  for (const mat of new Set([...['tulipa_lod0', 'daisy_1_lod0', 'daisy_2_lod0'].map((n) => byName(n).material as THREE.Material)])) {
    const ms = mat as THREE.MeshStandardMaterial;
    ms.side = THREE.DoubleSide;
    if (ms.map && ms.transparent) { ms.alphaTest = 0.5; ms.transparent = false; }
    ms.envMapIntensity = 0.7;
  }
  // three stargazer lilies standing tallest at the back, each with a bud
  const lily = lilyParts();
  group.add(lilyStem(lily, 0.56, -2.0, 0.16, 0.4, true));
  group.add(lilyStem(lily, 0.52, -0.95, 0.24, 2.4, false));
  group.add(lilyStem(lily, 0.49, -3.05, 0.27, 4.4, true));
  // tulips in the middle
  const tulip = byName('tulipa_lod0');
  stem(tulip, 0.46, 0.4, 0.2, 0.0);
  stem(tulip, 0.44, 1.5, 0.24, 1.9);
  stem(tulip, 0.42, 2.6, 0.18, 3.7);
  // daisies low and spilling out at the front
  stem(byName('daisy_1_lod0'), 0.34, 0.9, 0.38, 0.6);
  stem(byName('daisy_2_lod0'), 0.32, 2.1, 0.42, 2.4);
  stem(byName('daisy_1_lod0'), 0.3, -0.2, 0.44, 4.4);
  stem(byName('daisy_2_lod0'), 0.31, 3.3, 0.4, 5.3);
  return group;
}

// ---------------------------------------------------------------- lilies
interface LilyParts { petal: THREE.BufferGeometry; sepal: THREE.BufferGeometry; petalMat: THREE.Material; leaf: THREE.BufferGeometry; leafMat: THREE.Material; stemMat: THREE.Material; filament: THREE.Material; anther: THREE.Material; bud: THREE.BufferGeometry; budMat: THREE.Material }

/**
 * One lily petal along +y: narrow at the base, widest about a third of the way, pointed;
 * folded along the midrib and recurved, so the tip rolls back as a stargazer's does.
 */
function petalGeometry(len: number, width: number, recurve: number) {
  const g = new THREE.PlaneGeometry(1, 1, 6, 14);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2, v = p.getY(i) + 0.5;
    const outline = Math.pow(Math.sin(Math.PI * Math.min(1, v * 0.95 + 0.02)), 0.75) * (1 - 0.35 * v) * (0.35 + 0.65 * Math.min(1, v * 3));
    const x = u * outline * width / 2;
    // the blade bends back along its length (in z) and cups along the midrib
    const a = recurve * v * v;
    const y = Math.sin(a) / Math.max(recurve, 1e-3) * len * (recurve > 1e-3 ? 1 : v);
    const z0 = recurve > 1e-3 ? (1 - Math.cos(a)) / recurve * len : 0;
    const cup = (u * u) * width * 0.18 * (1 - v);
    // a soft ruffle at the edges
    const ruffle = Math.sin(v * 22 + u * 3) * 0.0015 * Math.abs(u) * v;
    // the curl goes back (-z), away from the flower's centre; the cup comes in (+z)
    p.setXYZ(i, x, recurve > 1e-3 ? y : v * len, -z0 + cup + ruffle);
  }
  g.computeVertexNormals();
  return g;
}

function lilyParts(): LilyParts {
  // petal colour: deep pink down the middle, white at the edges, speckled near the throat
  const c = canvas(128, 256), ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, '#fff6f8'); g.addColorStop(0.3, '#f7a7c2'); g.addColorStop(0.5, '#d92f6a'); g.addColorStop(0.7, '#f7a7c2'); g.addColorStop(1, '#fff6f8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 256);
  // the throat is pale green-yellow
  const th = ctx.createLinearGradient(0, 256, 0, 170);
  th.addColorStop(0, 'rgba(214,232,150,0.95)'); th.addColorStop(1, 'rgba(214,232,150,0)');
  ctx.fillStyle = th; ctx.fillRect(0, 170, 128, 86);
  ctx.fillStyle = '#8a1240';
  for (let k = 0; k < 70; k++) {
    const y = 120 + Math.random() * 120, x = 64 + (Math.random() - 0.5) * 70 * (1 - (y - 120) / 200);
    ctx.beginPath(); ctx.ellipse(x, y, 1.4 + Math.random() * 1.6, 2 + Math.random() * 2, 0, 0, Math.PI * 2); ctx.fill();
  }
  // the midrib groove
  ctx.strokeStyle = 'rgba(160,20,70,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(64, 256); ctx.lineTo(64, 20); ctx.stroke();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  // the texture runs base (bottom of the canvas) to tip (top): uv v = 0 at the base
  const petalMat = phys('#ffffff', 0.55, { map: tex, side: THREE.DoubleSide, sheen: 0.8, sheenColor: new THREE.Color('#ffe2ec'), sheenRoughness: 0.4 });
  const leaf = petalGeometry(0.16, 0.026, 0.4);
  const leafMat = phys('#4f7d3a', 0.5, { side: THREE.DoubleSide, clearcoat: 0.3 });
  const bud = lathe([[0, 0], [0.006, 0.004], [0.011, 0.02], [0.012, 0.04], [0.008, 0.06], [0, 0.072]], 24);
  return {
    petal: petalGeometry(0.075, 0.034, 1.25), sepal: petalGeometry(0.072, 0.024, 1.4), petalMat, leaf, leafMat,
    stemMat: std('#4d7a37', 0.6), filament: std('#d8e6b0', 0.6), anther: phys('#a3441c', 0.7, { sheen: 0.5 }),
    bud, budMat: phys('#c7d79a', 0.5, { sheen: 0.4, sheenColor: new THREE.Color('#ffc2d4') }),
  };
}

/** a lily on a curving stem from the bottom of the vase, bloom open to the room */
function lilyStem(L: LilyParts, height: number, ang: number, tilt: number, spin: number, withBud: boolean) {
  const g = new THREE.Group();
  const dir = new THREE.Vector3(Math.cos(ang) * Math.sin(tilt), Math.cos(tilt), Math.sin(ang) * Math.sin(tilt));
  const top = dir.clone().multiplyScalar(height).add(new THREE.Vector3(0, 0.01, 0));
  // a slight S: the stem leans out of the vase neck and lifts its head
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.01, 0), dir.clone().multiplyScalar(height * 0.35).add(new THREE.Vector3(0, 0.01, 0)),
    top.clone().add(new THREE.Vector3(dir.x * 0.03, -0.01, dir.z * 0.03)), top,
  ]);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.0032, 8), L.stemMat);
  stem.castShadow = true;
  g.add(stem);
  // leaves along the upper stem
  for (let k = 0; k < 3; k++) {
    const t = 0.45 + k * 0.15, p = curve.getPointAt(t);
    const leaf = new THREE.Mesh(L.leaf, L.leafMat);
    leaf.position.copy(p);
    leaf.rotation.set(0.9 - k * 0.1, spin + k * 2.2, 0, 'YXZ');
    leaf.castShadow = true;
    g.add(leaf);
  }
  // the bloom: three broad petals and three narrower sepals, opening outward
  const bloom = new THREE.Group();
  bloom.position.copy(top);
  const face = dir.clone().setY(dir.y + 0.5).normalize();
  bloom.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), face);
  bloom.rotateY(spin);
  for (let k = 0; k < 6; k++) {
    const isPetal = k % 2 === 0;
    const pm = new THREE.Mesh(isPetal ? L.petal : L.sepal, L.petalMat);
    const holder = new THREE.Group();
    holder.rotation.y = (k / 6) * Math.PI * 2;
    pm.rotation.x = -(isPetal ? 0.62 : 0.72);       // opened out from the axis
    pm.position.y = 0.004;
    pm.castShadow = true;
    holder.add(pm);
    bloom.add(holder);
  }
  // stamens and the pistil
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.5;
    const fil = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0008, 0.05, 5), L.filament);
    const h = new THREE.Group(); h.rotation.set(0.32, a, 0, 'YXZ');
    fil.position.y = 0.025; h.add(fil);
    const an = new THREE.Mesh(new THREE.CapsuleGeometry(0.0018, 0.007, 3, 6), L.anther);
    an.position.y = 0.051; an.rotation.z = Math.PI / 2; h.add(an);
    bloom.add(h);
  }
  const pistil = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0011, 0.058, 6), L.stemMat);
  pistil.position.y = 0.029; pistil.rotation.x = 0.1;
  bloom.add(pistil);
  g.add(bloom);
  if (withBud) {
    const b = new THREE.Mesh(L.bud, L.budMat);
    const p = curve.getPointAt(0.8);
    b.position.copy(p);
    b.rotation.set(0.7, spin + 1.3, 0.3, 'YXZ');
    b.castShadow = true;
    g.add(b);
  }
  return g;
}

/** A folded tent card: cream, gold edge, her name in script on the front. */
export function buildCard(name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = 'card';
  const c = canvas(512, 360), ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fbf3e6'; ctx.fillRect(0, 0, 512, 360);
  ctx.strokeStyle = '#d1a54f'; ctx.lineWidth = 8; ctx.strokeRect(18, 18, 476, 324);
  ctx.lineWidth = 2; ctx.strokeRect(32, 32, 448, 296);
  ctx.fillStyle = '#7a3e57'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 40px Fredoka, sans-serif';
  ctx.fillText('for', 256, 120);
  ctx.font = '700 104px "Dancing Script", cursive';
  ctx.fillText(name, 256, 205, 420);
  // a little star doodle
  ctx.fillStyle = '#e8b64c'; ctx.beginPath();
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 9 : 20; ctx.lineTo(256 + Math.cos(a) * r, 290 + Math.sin(a) * r); }
  ctx.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const w = 0.15, h = 0.105, open = 0.42;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), phys('#ffffff', 0.7, { map: tex, side: THREE.FrontSide }));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std('#f6ecdc', 0.8, 0, { side: THREE.DoubleSide }));
  const frontBack = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std('#f6ecdc', 0.8, 0, { side: THREE.BackSide }));
  // tent: both halves lean on the fold at the top
  for (const [m, s] of [[front, 1], [frontBack, 1], [back, -1]] as const) {
    const pivot = new THREE.Group();
    pivot.position.y = h * Math.cos(open);
    pivot.rotation.x = -s * open;          // front half: hem toward +z, back half toward -z
    m.position.y = -h / 2;
    m.rotation.y = s > 0 ? 0 : Math.PI;
    pivot.add(m);
    m.castShadow = true; m.receiveShadow = true;
    g.add(pivot);
  }
  return g;
}
