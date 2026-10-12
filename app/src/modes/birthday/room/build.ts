import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Static scenery is built from many small pieces (panel mouldings, legs, book spines) but
 * drawn as one mesh per material: pieces are collected here with their transforms and
 * merged at the end. That keeps the room at a few dozen draw calls.
 */
export class Batcher {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly m = new THREE.Matrix4();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3Like = { x: 0, y: 0, z: 0 },
      rotY = 0, scale?: THREE.Vector3Like, rot?: THREE.Euler) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    // every merged part needs the same attributes
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    const q = new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler(0, rotY, 0));
    this.m.compose(new THREE.Vector3(pos.x, pos.y, pos.z), q, scale ? new THREE.Vector3(scale.x, scale.y, scale.z) : new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this.m);
    const list = this.parts.get(mat) ?? [];
    list.push(g);
    this.parts.set(mat, list);
    return this;
  }

  /** an axis-aligned (then turned) box from its size and its centre */
  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rotY = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), mat, { x, y, z }, rotY);
  }

  rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, x: number, y: number, z: number, rotY = 0) {
    return this.add(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), mat, { x, y, z }, rotY);
  }

  build(name: string, opts: { cast?: boolean; receive?: boolean } = {}) {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = opts.cast ?? true;
      mesh.receiveShadow = opts.receive ?? true;
      group.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.parts.clear();
    return group;
  }
}

/** a standard material, briefly */
export function std(color: THREE.ColorRepresentation, roughness = 0.7, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

/** a physical material, briefly */
export function phys(color: THREE.ColorRepresentation, roughness = 0.5, extra: THREE.MeshPhysicalMaterialParameters = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness, ...extra });
}

/**
 * A cushion: a rounded box whose faces bulge, most at the middle, as stuffing does.
 * `puff` is the bulge at the centre of the top face in metres.
 */
export function cushion(w: number, h: number, d: number, r: number, puff: number, seg = 6) {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2), z = p.getZ(i) / (d / 2);
    const fx = 1 - x * x, fz = 1 - z * z, fy = 1 - y * y;
    // top and bottom swell most; the sides a little
    p.setY(i, p.getY(i) + Math.sign(y) * puff * fx * fz);
    p.setX(i, p.getX(i) + Math.sign(x) * puff * 0.35 * fy * fz);
    p.setZ(i, p.getZ(i) + Math.sign(z) * puff * 0.35 * fy * fx);
  }
  g.computeVertexNormals();
  return g;
}

/** a tapered cylinder leg */
export const leg = (rTop: number, rBot: number, h: number, seg = 14) => {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(0, h / 2, 0);
  return g;
};

/** a lathe from (radius, height) pairs */
export function lathe(points: Array<[number, number]>, seg = 48) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}
