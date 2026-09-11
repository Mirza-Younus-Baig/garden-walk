import * as THREE from 'three';

/**
 * Ground cover built in code: clumps of grass blades. The scans give the meadow its
 * flowers; this gives it a floor, so the flowers stand in something rather than on a
 * texture. A clump is a fan of tapered blades, each a strip of a few quads so it bends
 * along its length in the wind shader like everything else; the coarse levels drop the
 * blade count and finally fall back to two crossed cards.
 */

/** small deterministic generator so every variant is the same on every machine */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = Math.imul(s ^ (s >>> 15), 2246822519); s ^= s >>> 13; s = Math.imul(s, 3266489917); s ^= s >>> 16; return (s >>> 0) / 4294967296; };
}

/**
 * One blade: `segs` quads from the ground to a point. It leans out from the clump centre
 * and curves over as it rises, the way a blade droops under its own weight. UV.y runs up
 * the blade so the map can darken the base and lighten the tip.
 */
function blade(out: number[], idx: number[], nrm: number[], uv: number[], base: THREE.Vector3, dir: THREE.Vector2,
               lean: number, curl: number, height: number, width: number, segs: number, twist: number) {
  const start = out.length / 3;
  const side = new THREE.Vector2(-dir.y, dir.x);
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    // parabolic droop: straight near the root, curving over toward the tip
    const y = height * t * (1 - curl * t * t * 0.5);
    const outward = height * (lean * t + curl * t * t * 0.6);
    const w = s === segs ? 0 : width * (1 - t * t * 0.85) * 0.5;
    const tw = twist * t;
    const sx = side.x * Math.cos(tw) + dir.x * Math.sin(tw), sz = side.y * Math.cos(tw) + dir.y * Math.sin(tw);
    const cx = base.x + dir.x * outward, cz = base.z + dir.y * outward;
    if (s === segs) {
      out.push(cx, base.y + y, cz); uv.push(0.5, t);
      nrm.push(-dir.x * 0.4, 0.9, -dir.y * 0.4);
    } else {
      out.push(cx - sx * w, base.y + y, cz - sz * w, cx + sx * w, base.y + y, cz + sz * w);
      uv.push(0, t, 1, t);
      // normals lean toward the sky so a blade lit from above reads bright at the top
      nrm.push(-dir.x * 0.4, 0.9, -dir.y * 0.4, -dir.x * 0.4, 0.9, -dir.y * 0.4);
    }
  }
  // strip indices: pairs up to the last ring, then the tip triangle
  for (let s = 0; s < segs - 1; s++) {
    const a = start + s * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = start + (segs - 1) * 2, tip = start + segs * 2;
  idx.push(last, last + 1, tip);
}

export function buildGrassClump(variant: number, lod: number): THREE.BufferGeometry {
  const r = rng(1234 + variant * 977);
  const pos: number[] = [], idx: number[] = [], nrm: number[] = [], uv: number[] = [];
  const geo = new THREE.BufferGeometry();
  if (lod >= 2) {
    // two crossed cards, each a single tapered strip
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI * 0.5 + 0.3;
      const d = new THREE.Vector2(Math.cos(a), Math.sin(a));
      const b = new THREE.Vector3(-d.x * 0.05, 0, -d.y * 0.05);
      blade(pos, idx, nrm, uv, b, d, 0.0, 0.0, 1.0, 0.16, 2, 0);
    }
  } else {
    const n = lod === 0 ? 15 + Math.floor(r() * 5) : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.8;
      const d = new THREE.Vector2(Math.cos(a), Math.sin(a));
      const off = 0.01 + r() * 0.035;
      const b = new THREE.Vector3(d.x * off, 0, d.y * off);
      const h = 0.55 + r() * 0.5;
      blade(pos, idx, nrm, uv, b, d, 0.15 + r() * 0.35, 0.3 + r() * 0.6, h, 0.022 + r() * 0.02, lod === 0 ? 4 : 3, (r() - 0.5) * 1.2);
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.normalizeNormals();
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

/**
 * The blade's colour along its length: dark at the root where the clump shades itself,
 * a fresh green through the middle, and a paler, slightly straw tip. A 4x64 gradient is
 * all the map needs; the shader's per-plant hue drift does the rest.
 */
export function makeBladeTexture() {
  const w = 4, h = 64;
  const d = new Uint8Array(w * h * 4);
  const root = new THREE.Color(0x3d5c1e), mid = new THREE.Color(0x6f9c36), tip = new THREE.Color(0xb3c76a);
  const c = new THREE.Color();
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    if (t < 0.55) c.copy(root).lerp(mid, t / 0.55); else c.copy(mid).lerp(tip, (t - 0.55) / 0.45);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = c.r * 255; d[i + 1] = c.g * 255; d[i + 2] = c.b * 255; d[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
