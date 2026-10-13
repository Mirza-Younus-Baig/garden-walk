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

/**
 * Materials are shared: asking twice for the same look returns the same material. That
 * keeps the material and shader count down, and lets the Batcher merge every piece that
 * looks alike (all the cream books, all the brass legs) into one draw. Treat what these
 * return as read-only; a material that changes at run time needs `own()`.
 */
const cache = new Map<string, THREE.Material>();
const keyOf = (kind: string, params: object) => kind + JSON.stringify(params, (_k, v) =>
  v && (v as THREE.Texture).isTexture ? 'tex:' + (v as THREE.Texture).uuid
    : v && (v as THREE.Color).isColor ? 'col:' + (v as THREE.Color).getHexString()
    : v);
function shared<M extends THREE.Material>(kind: string, params: object, make: () => M): M {
  const k = keyOf(kind, params);
  let m = cache.get(k) as M | undefined;
  if (!m) { m = make(); cache.set(k, m); }
  return m;
}

/** a standard material, briefly (shared, read-only) */
export function std(color: THREE.ColorRepresentation, roughness = 0.7, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) {
  const p = { color, roughness, metalness, ...extra };
  return shared('std', p, () => new THREE.MeshStandardMaterial(p));
}

/** a physical material, briefly (shared, read-only) */
export function phys(color: THREE.ColorRepresentation, roughness = 0.5, extra: THREE.MeshPhysicalMaterialParameters = {}) {
  const p = { color, roughness, ...extra };
  return shared('phys', p, () => new THREE.MeshPhysicalMaterial(p));
}

/** a material of its own, for one that is changed while the room runs (a lamp shade, the TV) */
export const own = <M extends THREE.Material>(m: M): M => m.clone() as M;

/** number of distinct shared materials made (for tests and profiling) */
export const sharedMaterialCount = () => cache.size;

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

/**
 * Collapse a finished, motionless part of the scene into as few meshes as possible: every
 * mesh under `root` that shares a material (and shadow settings) with others is merged
 * into one, in root's own space. Parts that move on their own are listed in `keep` and
 * left exactly as they are, with their whole subtree. Instanced, skinned and multi-material
 * meshes are left alone too.
 */
export function mergeStatic(root: THREE.Object3D, keep: Iterable<THREE.Object3D> = []) {
  const skip = new Set(keep);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; order: number; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  const visit = (o: THREE.Object3D) => {
    if (skip.has(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh
        && !Array.isArray(m.material) && m.visible && m.children.length === 0) {
      const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}`;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { mat: m.material, cast: m.castShadow, receive: m.receiveShadow, order: m.renderOrder, geos: [], meshes: [] });
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      geo.clearGroups();
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      g.geos.push(geo); g.meshes.push(m);
    }
    for (const c of o.children.slice()) visit(c);
  };
  for (const c of root.children.slice()) visit(c);
  let before = 0, after = 0;
  for (const g of groups.values()) {
    before += g.meshes.length;
    if (g.meshes.length < 2) { for (const geo of g.geos) geo.dispose(); after += g.meshes.length; continue; }
    const merged = mergeGeometries(g.geos, false);
    for (const geo of g.geos) geo.dispose();
    if (!merged) { after += g.meshes.length; continue; }
    merged.computeBoundingSphere();
    for (const m of g.meshes) m.removeFromParent();
    const mesh = new THREE.Mesh(merged, g.mat);
    mesh.castShadow = g.cast; mesh.receiveShadow = g.receive; mesh.renderOrder = g.order;
    root.add(mesh);
    after++;
  }
  // drop groups the merge has emptied
  const prune = (o: THREE.Object3D) => { for (const c of o.children.slice()) { prune(c); if (c.type === 'Group' && c.children.length === 0 && !skip.has(c)) c.removeFromParent(); } };
  prune(root);
  return { before, after };
}
