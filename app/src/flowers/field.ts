import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CONFIG, type LayerName } from '../config';
import { heightAt } from '../world/terrain';
import { ViewGrid, cellHash, clumpNoise, type ViewParams } from './grid';
import { applyFlowerShader, makeFlowerDepthMaterial, makeBatchData, flowerUniforms, type BatchData, type FlowerShaderOpts } from './shader';

/** One BatchedMesh (one material) holding several geometries: variants x detail levels. */
class Batch {
  mesh: THREE.BatchedMesh;
  data: BatchData;
  geo = new Map<string, number>();
  readonly tint: boolean;
  private dirty = false;

  constructor(name: string, mat: THREE.Material, slots: number,
              geos: { name: string; geo: THREE.BufferGeometry }[],
              parent: THREE.Object3D, opts: { shadow?: boolean; cull?: boolean; tint?: boolean } = {}) {
    let v = 0, i = 0;
    for (const g of geos) {
      v += g.geo.attributes.position.count;
      i += g.geo.index ? g.geo.index.count : g.geo.attributes.position.count;
    }
    this.tint = !!opts.tint;
    this.mesh = new THREE.BatchedMesh(slots, v, i, mat);
    this.data = makeBatchData(slots);
    for (const g of geos) this.geo.set(g.name, this.mesh.addGeometry(g.geo));
    this.mesh.perObjectFrustumCulled = location.search.includes('nocull') ? false : (opts.cull ?? true);
    this.mesh.sortObjects = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!opts.shadow;
    this.mesh.receiveShadow = true;
    this.mesh.name = name;
    parent.add(this.mesh);
    const first = this.geo.values().next().value as number;
    for (let s = 0; s < slots; s++) { this.mesh.addInstance(first); this.mesh.setVisibleAt(s, false); }
  }

  setRand(slot: number, a: number, b: number, c: number) {
    (this.data.rand.image.data as Float32Array).set([a, b, c, 0], slot * 4);
    this.data.rand.needsUpdate = true;
  }
  setDisturb(slot: number, dx: number, dz: number, amp: number, t: number) {
    (this.data.disturb.image.data as Float32Array).set([dx, dz, amp, t], slot * 4);
    this.dirty = true;
  }
  disturb() { return this.data.disturb.image.data as Float32Array; }
  flush() { if (this.dirty) { this.data.disturb.needsUpdate = true; this.dirty = false; } }
}

interface Plant {
  x: number; z: number; yaw: number; variant: number; color?: THREE.Color;
  /** how tall this plant stands in the world, in metres (see CONFIG.size) */
  height: number;
}

/**
 * A layer of one flower type. Its instances live in a ViewGrid, so they are spent on the
 * part of the meadow the camera is looking at rather than spread over a disc that is
 * mostly behind the player.
 */
class Layer {
  grid: ViewGrid;
  px: Float32Array; pz: Float32Array;
  vis: Uint8Array; variant: Uint8Array; level: Uint8Array;
  readonly cell: number;
  private cursor = 0;
  private h = new Float32Array(4);
  private mat = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private static UP = new THREE.Vector3(0, 1, 0);

  constructor(
    readonly type: LayerName,
    readonly batches: Batch[],
    readonly geoName: (variant: number, level: number) => string | null,
    readonly grow: (wx: number, wz: number, h: Float32Array) => Plant | null,
    /** model height each variant is measured against, so `Plant.height` is metres */
    readonly modelH: Float32Array,
  ) {
    const c = CONFIG.layers[type];
    this.cell = c.cell;
    this.grid = new ViewGrid(c.k, c.cell, c.maxTiles,
      (wx, wz, slot) => this.place(wx, wz, slot),
      (slot) => this.hide(slot));
    const n = this.grid.count;
    this.px = new Float32Array(n); this.pz = new Float32Array(n);
    this.vis = new Uint8Array(n); this.variant = new Uint8Array(n); this.level = new Uint8Array(n);
  }

  private hide(slot: number) {
    this.vis[slot] = 0;
    this.level[slot] = 255;
    for (const b of this.batches) b.mesh.setVisibleAt(slot, false);
  }

  private place(wx: number, wz: number, slot: number) {
    const h = cellHash(wx, wz, this.h);
    const p = this.grow(wx, wz, h);
    if (!p) { this.hide(slot); return; }
    this.px[slot] = p.x; this.pz[slot] = p.z; this.vis[slot] = 1; this.variant[slot] = p.variant;
    this.v.set(p.x, heightAt(p.x, p.z) - 0.02, p.z);
    this.q.setFromAxisAngle(Layer.UP, p.yaw);
    this.s.setScalar(p.height / this.modelH[p.variant]);
    this.mat.compose(this.v, this.q, this.s);
    for (const b of this.batches) {
      b.mesh.setMatrixAt(slot, this.mat);
      // Only tinted batches may carry an instance colour: on an untinted material three.js
      // would multiply it into the albedo and turn stems and leaves pink.
      if (p.color && b.tint) b.mesh.setColorAt(slot, p.color);
      b.setRand(slot, h[0] * 10, h[1], h[2]);
      b.setDisturb(slot, 0, 0, 0, -10);
    }
    this.level[slot] = 255;   // force the next detail pass to set it
  }

  private applyLevel(slot: number, level: number) {
    this.level[slot] = level;
    const name = this.geoName(this.variant[slot], level);
    if (name === null) { for (const b of this.batches) b.mesh.setVisibleAt(slot, false); return; }
    for (const b of this.batches) {
      const id = b.geo.get(name);
      // a batch without this geometry is a part the variant does not have: hide its slot
      if (id === undefined) { b.mesh.setVisibleAt(slot, false); continue; }
      b.mesh.setGeometryIdAt(slot, id);
      b.mesh.setVisibleAt(slot, true);
    }
  }

  /** re-band a slice of the layer each frame, so detail follows the camera without a spike */
  refreshLod(camX: number, camZ: number, slice: number) {
    const th = CONFIG.lod[this.type];
    const total = this.px.length;
    const end = Math.min(total, this.cursor + slice);
    for (let slot = this.cursor; slot < end; slot++) {
      if (!this.vis[slot]) continue;
      const dx = this.px[slot] - camX, dz = this.pz[slot] - camZ;
      const d2 = dx * dx + dz * dz;
      let level = 0;
      while (level < th.length && d2 > th[level] * th[level]) level++;
      if (level !== this.level[slot]) this.applyLevel(slot, level);
    }
    this.cursor = end >= total ? 0 : end;
  }

  /** slot holding a given world cell, or -1 if that cell is not currently populated */
  slotOf(wx: number, wz: number) { return this.grid.slotOf(wx, wz); }

  // ---- shadow-pass culling: plants well behind the camera cannot shadow anything on screen
  private culled: Int32Array[] = [];
  private nCulled: number[] = [];
  private static fwd = new THREE.Vector3();

  /**
   * Hide, for the shadow pass only, every plant more than `margin` metres outside the
   * camera's view wedge. A shadow can only land on screen if its caster stands within a
   * shadow's length of something that is on screen, so the margin is the longest shadow
   * that type can throw. The light's own box is a 22 m strip across the field, and without
   * this the shadow pass drew half again as much geometry as the view itself.
   */
  shadowCull(camera: THREE.Camera, margin: number, focusX: number, focusZ: number, reach: number) {
    if (this.culled.length === 0) {
      for (let i = 0; i < this.batches.length; i++) { this.culled.push(new Int32Array(this.px.length)); this.nCulled.push(0); }
    }
    const f = camera.getWorldDirection(Layer.fwd);
    const len = Math.hypot(f.x, f.z) || 1;
    const dx = f.x / len, dz = f.z / len;
    const cx = camera.position.x, cz = camera.position.z;
    const pc = camera as THREE.PerspectiveCamera;
    const tanHalf = pc.isPerspectiveCamera
      ? Math.tan(pc.fov * 0.5 * THREE.MathUtils.DEG2RAD) * pc.aspect + 0.15
      : 1e6;
    for (let b = 0; b < this.batches.length; b++) {
      const mesh = this.batches[b].mesh, list = this.culled[b];
      let n = 0;
      for (let slot = 0; slot < this.px.length; slot++) {
        if (!this.vis[slot]) continue;
        const rx = this.px[slot] - cx, rz = this.pz[slot] - cz;
        const ahead = rx * dx + rz * dz;
        const side = Math.abs(rx * dz - rz * dx);
        const gx = this.px[slot] - focusX, gz = this.pz[slot] - focusZ;
        if (ahead > -margin && side <= ahead * tanHalf + margin && gx * gx + gz * gz < reach * reach) continue;
        // only slots this batch is actually showing: a hidden part must stay hidden
        if (!mesh.getVisibleAt(slot)) continue;
        mesh.setVisibleAt(slot, false); list[n++] = slot;
      }
      this.nCulled[b] = n;
    }
  }

  shadowRestore() {
    for (let b = 0; b < this.batches.length; b++) {
      const mesh = this.batches[b].mesh, list = this.culled[b];
      for (let i = 0; i < this.nCulled[b]; i++) mesh.setVisibleAt(list[i], true);
      this.nCulled[b] = 0;
    }
  }

  stream(p: ViewParams) {
    p.range = CONFIG.layers[this.type].range;
    return this.grid.update(p);
  }
}

// Colour beds. Each layer picks from its palette with a coarse noise field, so you walk
// through a bed of one colour and into the next instead of a confetti of every colour.
// `pick` indexes uniformly into a palette, so repeating an entry weights it. Four of a
// colour out of ten beds makes it 40%: red and pink dominate, with cream and blue as the
// occasional bed you come across.
const LILY_COLORS = [
  0xb3122e, 0xb3122e, 0xb3122e, 0xb3122e, 0xb3122e,   // crimson   ~33%
  0xe06d95, 0xe06d95, 0xe06d95, 0xe06d95,             // pink      ~27%
  0x3a5bd0, 0x3a5bd0,                                 // blue      ~13%
  0x6d1024, 0x6d1024,                                 // maroon    ~13%
  0xf2ece6, 0xf2ece6,                                 // white     ~13%
];
const ROSE_COLORS = [0xc4213f, 0xdd7f9c, 0xf0e6de, 0x8d1030];
const TULIP_COLORS = [0xcc2a2f, 0xe8bb2a, 0xdd6e97, 0x8d55b5, 0xf0e9db];

export class FlowerField {
  group = new THREE.Group();
  private layers: Layer[] = [];
  private batches: Batch[] = [];
  private tmp = new THREE.Color();
  private vp: ViewParams = {
    camX: 0, camZ: 0, dirX: 0, dirZ: 1, halfFov: 0.7, range: 40,
    nearX: 0, nearZ: 0, nearR: CONFIG.view.nearRadius, budget: CONFIG.view.budget,
  };
  private fwd = new THREE.Vector3();

  constructor(private loader: GLTFLoader) { this.group.name = 'flowers'; }

  async load() {
    const [lily, daisy, rose, tulip] = await Promise.all([
      this.loader.loadAsync('/models/lily.glb'),
      this.loader.loadAsync('/models/daisy.glb'),
      this.loader.loadAsync('/models/rose.glb'),
      this.loader.loadAsync('/models/tulip.glb'),
    ]);
    const q = location.search;

    type MeshInfo = { name: string; geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial };
    const meshesOf = (root: THREE.Object3D) => {
      const out: MeshInfo[] = [];
      root.updateMatrixWorld(true);
      root.traverse((o: any) => {
        if (!o.isMesh) return;
        const geo = (o.geometry as THREE.BufferGeometry).clone();
        geo.applyMatrix4(o.matrixWorld);
        for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
        out.push({ name: o.name, geo, mat: o.material });
      });
      return out;
    };

    const topY = (geo: THREE.BufferGeometry) => { geo.computeBoundingBox(); return geo.boundingBox!.max.y; };

    /**
     * Divisor per variant that turns a requested world height into an instance scale.
     * `tops` is each variant's own model height and `blend` how much of that natural
     * variation survives; see CONFIG.sizeBlend.
     */
    const divisors = (tops: number[], blend: number) => {
      const groupTop = Math.max(...tops);
      return Float32Array.from(tops, (t) => Math.pow(t, 1 - blend) * Math.pow(groupTop, blend));
    };

    /** a height in metres for this plant, drawn from the type's range in CONFIG.size */
    const pickHeight = (key: string, r: number) => {
      const [lo, hi] = CONFIG.size[key];
      return lo + r * (hi - lo);
    };

    /**
     * The plant material: a physical material built from whatever maps the scan carries,
     * with the velvet sheen that petals and leaves show at grazing angles. Optionally masked
     * for tinting. Cutout maps get the colour under their transparent pixels filled in,
     * because the fringe that mipmaps blend in from there is what draws a grey outline
     * around every petal.
     */
    const pbr = (src: THREE.MeshStandardMaterial, mask: 'lily' | 'nongreen' | null) => {
      const mat = new THREE.MeshPhysicalMaterial({
        name: src.name, map: src.map ?? null, color: src.color ?? new THREE.Color(1, 1, 1),
        normalMap: src.normalMap ?? null, roughnessMap: src.roughnessMap ?? null,
        metalnessMap: src.metalnessMap ?? null, aoMap: src.aoMap ?? null,
      });
      if (src.normalMap) mat.normalScale.copy(src.normalScale ?? new THREE.Vector2(1, 1));
      const cutout = src.transparent === true || (src.alphaTest ?? 0) > 0;
      mat.side = THREE.DoubleSide; mat.metalness = 0; mat.envMapIntensity = 0.55; mat.vertexColors = false;
      mat.transparent = false; mat.depthWrite = true;
      mat.roughness = 0.75;
      mat.specularIntensity = 0.6;
      mat.sheen = q.includes('plain') ? 0 : 0.5; mat.sheenRoughness = 0.6; mat.sheenColor.set(0xffffff);
      if (cutout) {
        mat.alphaTest = 0.4; mat.alphaToCoverage = true;
        if (mat.map) mat.map = solidify(mat.map);
      } else mat.alphaTest = 0;
      let gain = 1;
      if (mask && mat.map && !q.includes('notint')) {
        // A mask hides the tint in the texture's own alpha, so it can only be built for a
        // material that does not already need alpha for its cutout.
        const m = makePetalMask(mat.map, mask);
        mat.map = m.tex; gain = m.gain; mat.alphaTest = 0;
      }
      if (mat.map) mat.map.anisotropy = 16;
      return { mat, gain };
    };

    // `?plain` switches the finish off (no sheen, translucency or relief) to measure its cost
    const plain = (o: FlowerShaderOpts): FlowerShaderOpts => q.includes('plain')
      ? { ...o, petalTrans: 0, leafTrans: 0, sheenPetal: 0, sheenLeaf: 0, detail: 0 } : o;
    const mkBatch = (name: string, mat: THREE.Material, slots: number,
                     geos: { name: string; geo: THREE.BufferGeometry }[],
                     o?: { shadow?: boolean; cull?: boolean; tint?: boolean }) => {
      const b = new Batch(name, mat, slots, geos, this.group, o);
      this.batches.push(b); return b;
    };

    /**
     * Build one batch per part of a plant. Geometry is registered under `v<variant>_lod<n>`
     * in every batch, so a layer can address several variants made of different parts with
     * a single name: a batch that lacks the name simply hides that slot.
     */
    interface Part {
      prefix: string; variant: number; opts: FlowerShaderOpts;
      tint?: 'mask' | 'all'; mask?: 'lily' | 'nongreen'; shadow?: boolean; levels?: number;
    }
    const buildParts = (layer: LayerName, meshes: MeshInfo[], parts: Part[]) => {
      const c = CONFIG.layers[layer];
      const slots = c.maxTiles * c.k * c.k;
      return parts.map((p) => {
        const levels = p.levels ?? 3;
        const geos = [];
        for (let l = 0; l < levels; l++) {
          const m = meshes.find((x) => x.name === `${p.prefix}_lod${l}`);
          if (!m) throw new Error(`flowers: missing geometry ${p.prefix}_lod${l}`);
          geos.push({ name: `v${p.variant}_lod${l}`, geo: m.geo });
        }
        const src = meshes.find((x) => x.name === `${p.prefix}_lod0`)!.mat;
        const { mat, gain } = pbr(src, p.tint === 'mask' ? (p.mask ?? 'nongreen') : null);
        const opts: FlowerShaderOpts = { ...plain(p.opts), tint: p.tint, tintGain: p.opts.tintGain ?? gain };
        const shadow = p.shadow ?? true;
        const b = mkBatch(`${layer}_${p.prefix}`, mat, slots, geos, { shadow, tint: !!p.tint });
        applyFlowerShader(mat, opts, b.data);
        if (shadow) b.mesh.customDepthMaterial = makeFlowerDepthMaterial(opts, b.data, mat.map, mat.alphaTest);
        return b;
      });
    };
    const lodName = (v: number, l: number) => `v${v}_lod${Math.min(l, 2)}`;

    // ---------------- lilies (7 stem variants, blue and red beds) ----------------
    const lilyMeshes = meshesOf(lily.scene);
    const lilyOpts: FlowerShaderOpts = { height: 0.9, stiffness: 0.9, tintGain: 1, petalTrans: 0.9, leafTrans: 0.5, sheenPetal: 1.0, petalRough: 0.7 };
    const lilyG = CONFIG.layers.lily;
    const lilySlots = lilyG.maxTiles * lilyG.k * lilyG.k;
    const lilyGeos = lilyMeshes.map((m) => {
      const mm = /^lily_(\d)_lod(\d)$/.exec(m.name)!;
      return { name: `v${+mm[1] - 1}_lod${mm[2]}`, geo: m.geo };
    });
    const lilyMat = pbr(lilyMeshes[0].mat, 'lily');
    const lilyBatch = mkBatch('lily', lilyMat.mat, lilySlots, lilyGeos, { tint: true, shadow: true });
    applyFlowerShader(lilyMat.mat, { ...plain(lilyOpts), tint: 'mask' }, lilyBatch.data);
    lilyBatch.mesh.customDepthMaterial = makeFlowerDepthMaterial(lilyOpts, lilyBatch.data);
    // The seven stems in this scan are genuinely different sizes, so they keep half of
    // that difference rather than all being stretched to the same height.
    const lilyTops = Array.from({ length: 7 }, (_, v) => topY(lilyGeos.find((g) => g.name === `v${v}_lod0`)!.geo));
    this.layers.push(new Layer('lily', [lilyBatch], lodName,
      (wx, wz, h) => {
        const x = (wx + 0.1 + h[0] * 0.8) * lilyG.cell, z = (wz + 0.1 + h[1] * 0.8) * lilyG.cell;
        // Baseline plus clumping, not a hard threshold: a threshold form leaves the type
        // absent from most of the field, which is what made each area a single species.
        // The frequency is up too, so the clumps are metres across and interleave.
        const clump = clumpNoise(x * 0.26, z * 0.26);
        if (h[2] > CONFIG.lilyDensity * (0.20 + clump * 0.72)) return null;
        const bed = clumpNoise(x * 0.125 + 40, z * 0.125 - 17);
        const c = this.pick(LILY_COLORS, bed, h, 0.07, 0.20, 0.18);
        return { x, z, yaw: h[3] * Math.PI * 2, height: pickHeight('lily', h[0]),
                 variant: Math.floor(h[1] * 7) % 7, color: c };
      }, divisors(lilyTops, CONFIG.sizeBlend.lily)));

    // ---------------- roses (a whole bush, and a single long-stemmed bloom) ----------------
    const roseMeshes = meshesOf(rose.scene);
    /**
     * The single-stem rose scan carries a bloom 0.33 m across on a 0.78 m plant, about
     * three times life size, and scaling the whole plant down to fix it would leave a
     * rose the height of a daisy. Instead the bloom alone is shrunk about the neck of
     * the stem. The scan has a clear neck: leaves fan out below 0.47, the stem is bare
     * and a couple of centimetres wide from there to 0.54, and the bloom sits above it.
     */
    const ROSE_NECK = 0.54, ROSE_BLOOM = 0.50;
    for (const m of roseMeshes) {
      if (!m.name.startsWith('rosehero')) continue;
      const pos = m.geo.attributes.position as THREE.BufferAttribute;
      // the stem's own axis at the neck, so the bloom shrinks onto the stem, not sideways
      let sx = 0, sz = 0, n = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > ROSE_NECK - 0.04 && y < ROSE_NECK + 0.02) { sx += pos.getX(i); sz += pos.getZ(i); n++; }
      }
      if (n > 0) { sx /= n; sz /= n; }
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y <= ROSE_NECK) continue;
        pos.setXYZ(i, sx + (pos.getX(i) - sx) * ROSE_BLOOM, ROSE_NECK + (y - ROSE_NECK) * ROSE_BLOOM,
                   sz + (pos.getZ(i) - sz) * ROSE_BLOOM);
      }
      pos.needsUpdate = true; m.geo.computeBoundingBox();
    }
    // woody: barely bends. Rose petals are velvet, many layers deep, so less light comes
    // through than a tulip; the leaves are glossy.
    const bushOpts: FlowerShaderOpts = { height: 0.72, stiffness: 2.1, petalTrans: 0.65, leafTrans: 0.4, sheenPetal: 1.3, sheenLeaf: 0.3, petalRough: 0.7, baseAO: 0.5 };
    const heroOpts: FlowerShaderOpts = { ...bushOpts, height: 0.78, stiffness: 1.3 };
    const roseG = CONFIG.layers.rose;
    this.layers.push(new Layer('rose', buildParts('rose', roseMeshes, [
      { prefix: 'rosebush_stem', variant: 0, opts: bushOpts },
      { prefix: 'rosebush_leaf', variant: 0, opts: bushOpts },
      { prefix: 'rosebush_bloom', variant: 0, opts: bushOpts, tint: 'mask' },
      { prefix: 'rosehero', variant: 1, opts: heroOpts, tint: 'mask' },
    ]), lodName,
      (wx, wz, h) => {
        const x = (wx + 0.15 + h[0] * 0.7) * roseG.cell, z = (wz + 0.15 + h[1] * 0.7) * roseG.cell;
        // Bushes stay the most clustered of the four -- a rose bed should read as a bed --
        // but they no longer own whole regions to themselves.
        const stand = clumpNoise(x * 0.16 - 21, z * 0.16 + 11);
        if (h[2] > CONFIG.roseDensity * (0.12 + stand * 0.85)) return null;
        const bed = clumpNoise(x * 0.085 - 63, z * 0.085 + 29);
        const c = this.pick(ROSE_COLORS, bed, h, 0.06, 0.16, 0.16);
        // single stems are the exception in a stand of bushes, and a smaller plant
        const variant = h[3] < 0.32 ? 1 : 0;
        return { x, z, yaw: h[3] * Math.PI * 2, variant, color: c,
                 height: pickHeight(variant ? 'roseSingle' : 'rose', h[0]) };
      },
      divisors([
        Math.max(...['rosebush_stem', 'rosebush_leaf', 'rosebush_bloom']
          .map((n) => topY(roseMeshes.find((m) => m.name === `${n}_lod0`)!.geo))),
        topY(roseMeshes.find((m) => m.name === 'rosehero_lod0')!.geo),
      ], CONFIG.sizeBlend.rose)));

    // ---------------- tulips (open and closed blooms, in colour beds) ----------------
    const tulipMeshes = meshesOf(tulip.scene);
    // The closed tulip was scanned as a 12 x 23 cm bloom on a 21 cm stem, about twice life
    // size, so it is shrunk about the top of its stem where the two meet.
    for (const m of tulipMeshes) {
      if (!m.name.startsWith('tulipb_petal')) continue;
      m.geo.translate(0, -0.208, 0); m.geo.scale(0.48, 0.48, 0.48); m.geo.translate(0, 0.208, 0);
      m.geo.computeBoundingBox();
    }
    // a tulip is a lantern: sun through its petals is most of what you see of it
    const tulipOpts: FlowerShaderOpts = { height: 0.43, stiffness: 1.15, petalTrans: 1.0, leafTrans: 0.45, sheenPetal: 0.6, petalRough: 0.85, baseAO: 0.55 };
    const tulipG = CONFIG.layers.tulip;
    this.layers.push(new Layer('tulip', buildParts('tulip', tulipMeshes, [
      { prefix: 'tulipa', variant: 0, opts: tulipOpts, tint: 'mask' },
      { prefix: 'tulipb_leaf', variant: 1, opts: tulipOpts },
      { prefix: 'tulipb_petal', variant: 1, opts: tulipOpts, tint: 'all' },
    ]), lodName,
      (wx, wz, h) => {
        const x = (wx + 0.15 + h[0] * 0.7) * tulipG.cell, z = (wz + 0.15 + h[1] * 0.7) * tulipG.cell;
        const clump = clumpNoise(x * 0.23 + 77, z * 0.23 - 41);
        if (h[2] > CONFIG.tulipDensity * (0.20 + clump * 0.72)) return null;
        const bed = clumpNoise(x * 0.105 + 13, z * 0.105 + 51);
        const c = this.pick(TULIP_COLORS, bed, h, 0.05, 0.17, 0.15);
        return { x, z, yaw: h[3] * Math.PI * 2, height: pickHeight('tulip', h[0]),
                 variant: h[3] < 0.45 ? 1 : 0, color: c };
      },
      divisors([
        topY(tulipMeshes.find((m) => m.name === 'tulipa_lod0')!.geo),
        Math.max(topY(tulipMeshes.find((m) => m.name === 'tulipb_leaf_lod0')!.geo),
                 topY(tulipMeshes.find((m) => m.name === 'tulipb_petal_lod0')!.geo)),
      ], CONFIG.sizeBlend.tulip)));

    // ---------------- daisies (mesh close up, billboards beyond) ----------------
    const daisyOpts: FlowerShaderOpts = { height: 0.65, stiffness: 0.65, petalTrans: 0.8, leafTrans: 0.5, sheenPetal: 0.7, baseAO: 0.5 };
    const dMeshes = meshesOf(daisy.scene);
    const variants = ['daisy_1', 'daisy_2', 'daisy_3', 'daisy_patch_big_1', 'daisy_patch_big_2', 'daisy_patch_big_3',
                      'daisy_patch_small_1', 'daisy_patch_small_2', 'daisy_patch_small_3'];
    const slotsOf = (n: LayerName) => CONFIG.layers[n].maxTiles * CONFIG.layers[n].k * CONFIG.layers[n].k;

    /** the same daisy field sampled at whatever spacing a layer uses */
    const daisyGrow = (cell: number, key: string) => (wx: number, wz: number, h: Float32Array): Plant | null => {
      const x = (wx + 0.5 + (h[0] - 0.5) * 0.9) * cell, z = (wz + 0.5 + (h[1] - 0.5) * 0.9) * cell;
      const drift = clumpNoise(x * 0.14 + 3, z * 0.14 + 9);
      if (h[2] > CONFIG.daisyDensity * (0.45 + drift * 0.75)) return null;
      const patch = h[3] < 0.10;   // patches cost 4-8x the triangles of a single stem
      const variant = patch ? 3 + Math.floor(h[0] * 6) % 6 : Math.floor(h[1] * 3) % 3;
      return { x, z, yaw: h[3] * Math.PI * 2, height: pickHeight(key, h[0]), variant };
    };

    const meshGeos = variants.flatMap((name, v) => [0, 1].map((l) => ({
      name: `v${v}_lod${l}`, geo: dMeshes.find((m) => m.name === `${name}_lod${l}`)!.geo,
    })));
    const mainMat = pbr(dMeshes.find((m) => m.name === 'daisy_1_lod0')!.mat, null);
    // the scan's petals are pure white; real ones are a touch off, and pure white clips to
    // a flat disc in full sun
    mainMat.mat.color.multiplyScalar(0.84);
    const meshBatch = mkBatch('daisy_mesh', mainMat.mat, slotsOf('daisy'), meshGeos, { shadow: true });
    applyFlowerShader(mainMat.mat, plain(daisyOpts), meshBatch.data);
    meshBatch.mesh.customDepthMaterial = makeFlowerDepthMaterial(daisyOpts, meshBatch.data, mainMat.mat.map, mainMat.mat.alphaTest);
    // Normalised per variant, so a patch's tallest flower reaches the same height as a
    // single daisy beside it and the patch reads as several plants rather than one big one.
    const daisyTops = variants.map((name) => topY(dMeshes.find((m) => m.name === `${name}_lod0`)!.geo));
    this.layers.push(new Layer('daisy', [meshBatch],
      (v, l) => (l >= 2 ? null : `v${v}_lod${l}`), daisyGrow(CONFIG.layers.daisy.cell, 'daisy'),
      divisors(daisyTops, CONFIG.sizeBlend.daisy)));

    // One card serves every variant: the patch cards are large enough that a field of them
    // merges into a white wall at the horizon. Frustum culling is off because the view grid
    // has already placed these inside the view, and culling 25k instances in JS every frame
    // costs far more than drawing two triangles each.
    const billSrc = dMeshes.find((m) => m.name === 'daisy_1_lod2')!;
    const billMat = pbr(billSrc.mat, null); billMat.mat.alphaTest = 0.45;
    // a flat card facing the sun comes out brighter than the plant it stands in for
    billMat.mat.color.multiplyScalar(0.78);
    const billBatch = mkBatch('daisy_bill', billMat.mat, slotsOf('daisyFar'),
      [{ name: 'bill', geo: billSrc.geo }], { cull: false });
    applyFlowerShader(billMat.mat, plain(daisyOpts), billBatch.data);
    // Level 0 is the band the detailed layer already covers, so it draws nothing there.
    // every variant draws the same card, so they all measure against the card's height
    this.layers.push(new Layer('daisyFar', [billBatch],
      (_v, l) => (l === 0 ? null : 'bill'), daisyGrow(CONFIG.layers.daisyFar.cell, 'daisyFar'),
      divisors(new Array(variants.length).fill(topY(billSrc.geo)), 0)));

    for (const name of ['daisy', 'lily', 'rose', 'tulip']) {
      if (q.includes(`no${name}`)) this.layers = this.layers.filter((l) => !l.type.startsWith(name));
    }
    // The shadow pass sees the whole disc around her, including everything behind the
    // camera that the main pass never draws. Only the first caster batch of a layer runs
    // the cull; the hooks fire per mesh, and the restore comes after the last one. With
    // the casters chosen here, three's own per-instance frustum test is switched off for
    // that pass: testing thirty thousand instances a second time each frame cost more CPU
    // than the pass itself.
    for (const l of this.layers) {
      const margin = CONFIG.shadowBehind[l.type];
      const casters = l.batches.filter((b) => b.mesh.castShadow);
      if (margin <= 0 || casters.length === 0) continue;
      const first = casters[0].mesh, last = casters[casters.length - 1].mesh;
      const before = THREE.BatchedMesh.prototype.onBeforeShadow;
      for (const b of casters) {
        const mesh = b.mesh;
        mesh.onBeforeShadow = function (this: THREE.BatchedMesh, renderer, object, camera, shadowCamera, geometry, depthMaterial, group) {
          if (mesh === first) {
            const ortho = shadowCamera as THREE.OrthographicCamera;
            const reach = (ortho.isOrthographicCamera ? ortho.right : 12) + margin;
            const focus = flowerUniforms.uGirlPos.value;
            l.shadowCull(camera, margin, focus.x, focus.z, reach);
          }
          const cull = this.perObjectFrustumCulled;
          this.perObjectFrustumCulled = false;
          before.call(this, renderer, object, camera, shadowCamera, geometry, depthMaterial, group);
          this.perObjectFrustumCulled = cull;
        };
        if (mesh === last) mesh.onAfterShadow = () => l.shadowRestore();
      }
    }
    console.log(`field: ${this.layers.length} layers, ${this.batches.length} batches, ` +
      `${this.layers.reduce((a, l) => a + l.px.length, 0)} slots`);
  }

  /**
   * A colour from a palette chosen by a coarse bed field, with per-plant jitter.
   *
   * The bed field is bilinear value noise, so it is bell-shaped around 0.5 rather than
   * uniform: bucketing it directly gave the first and last entries about 2.3% of beds
   * each against 15.9% for the middle, which is why a palette's end colours were almost
   * never seen. Its CDF is very close to smoothstep, so pushing the value through
   * smoothstep first flattens the distribution and makes repetition in the palette mean
   * what it looks like it means.
   */
  private pick(palette: number[], bed: number, h: Float32Array, dh: number, ds: number, dv: number, stray = 0.14) {
    let u = bed * bed * (3 - 2 * bed);
    // A bed of one colour with nothing else in it reads as printed rather than grown, so a
    // fraction of plants jump to another entry. Drawn from a mix of the hash components
    // that only drive height and yaw, so which plants stray is uncorrelated with whether
    // the plant exists at all.
    const r = (h[0] * 7.13 + h[1] * 3.77 + h[3] * 11.31) % 1;
    if (r < stray) u = (u + 0.29 + r * 2.4) % 1;
    const c = this.tmp.setHex(palette[Math.min(palette.length - 1, Math.floor(u * palette.length))]).clone();
    c.offsetHSL((h[3] - 0.5) * dh, (h[0] - 0.5) * ds, (h[1] - 0.5) * dv);
    return c;
  }

  /** per-phase timings, filled only when ?prof is on */
  prof = { stream: 0, lod: 0, contact: 0 };

  update(_dt: number, time: number, girlPos: THREE.Vector3, girlVel: THREE.Vector3, moveFactor: number,
         camera: THREE.PerspectiveCamera, prof = false) {
    flowerUniforms.uTime.value = time;
    flowerUniforms.uGirlPos.value.set(girlPos.x, girlPos.y + 1.0, girlPos.z);
    const now = prof ? () => performance.now() : () => 0;
    let t0 = now();

    // ---- stream: hand every layer the wedge the camera can actually see
    camera.getWorldDirection(this.fwd);
    const len = Math.hypot(this.fwd.x, this.fwd.z) || 1;
    const p = this.vp;
    p.camX = camera.position.x; p.camZ = camera.position.z;
    p.dirX = this.fwd.x / len; p.dirZ = this.fwd.z / len;
    // vertical fov is the camera's; the horizontal half-angle is what matters on the ground
    p.halfFov = Math.atan(Math.tan(camera.fov * 0.5 * THREE.MathUtils.DEG2RAD) * camera.aspect) + CONFIG.view.fovSlack;
    p.nearX = girlPos.x; p.nearZ = girlPos.z;
    p.nearR = CONFIG.view.nearRadius; p.budget = CONFIG.view.budget;
    for (const l of this.layers) l.stream(p);
    if (prof) { this.prof.stream = now() - t0; t0 = now(); }

    // detail bands follow the camera, a slice at a time to keep frames even
    for (const l of this.layers) l.refreshLod(camera.position.x, camera.position.z, Math.ceil(l.px.length / 5));
    if (prof) { this.prof.lod = now() - t0; t0 = now(); }

    // ---- contact: only the cells she can actually reach are touched
    const speedDir = girlVel.lengthSq() > 1e-4 ? girlVel.clone().normalize() : null;
    const idle = 0.55;
    // 0 standing, 1 at a full run. Everything about the contact scales off this, so
    // walking through a bed and sprinting through it do not look the same.
    const sp = CONFIG.pushSpeed;
    const speedN = Math.min(1, girlVel.length() / CONFIG.runSpeed);
    const radiusGain = 1 + sp.radius * speedN;
    const strengthGain = 1 + sp.strength * speedN;
    const lean = 0.35 + sp.lean * speedN;
    const gx = girlPos.x, gz = girlPos.z;
    for (const l of this.layers) {
      const cfg = CONFIG.push[l.type];
      if (cfg.radius <= 0) continue;
      const radius = cfg.radius * radiusGain;
      const reach = radius * 1.25;
      const c0x = Math.floor((gx - reach) / l.cell), c1x = Math.floor((gx + reach) / l.cell);
      const c0z = Math.floor((gz - reach) / l.cell), c1z = Math.floor((gz + reach) / l.cell);
      for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
        const slot = l.slotOf(cx, cz);
        if (slot < 0 || !l.vis[slot]) continue;
        const dx = l.px[slot] - gx, dz = l.pz[slot] - gz;
        const d = Math.hypot(dx, dz);
        if (d > radius) continue;
        let s = 1 - d / radius; s = s * s * (3 - 2 * s);
        s *= cfg.strength * (idle + (1 - idle) * moveFactor) * strengthGain;
        let nx: number, nz: number;
        if (d > 0.08) { nx = dx / d; nz = dz / d; }
        else if (speedDir) { nx = speedDir.x; nz = speedDir.z; }
        else { nx = 1; nz = 0; }
        if (speedDir) { nx += speedDir.x * lean; nz += speedDir.z * lean; const m = Math.hypot(nx, nz); nx /= m; nz /= m; }
        for (const b of l.batches) {
          const arr = b.disturb();
          const prev = arr[slot * 4 + 2] * Math.exp(-(time - arr[slot * 4 + 3]) * 2.6) * 0.9;
          b.setDisturb(slot, nx, nz, Math.max(s, prev), time);
        }
      }
    }
    for (const b of this.batches) b.flush();
    if (prof) this.prof.contact = now() - t0;
  }

  /** live counts, for the on-screen readout and for tests */
  stats() {
    let visible = 0;
    for (const l of this.layers) for (let i = 0; i < l.vis.length; i++) visible += l.vis[i];
    return {
      visible,
      slots: this.layers.reduce((a, l) => a + l.px.length, 0),
      tiles: this.layers.reduce((a, l) => a + l.grid.live, 0),
      byType: Object.fromEntries(this.layers.map((l) => {
        let n = 0; for (let i = 0; i < l.vis.length; i++) n += l.vis[i];
        return [l.type, n];
      })),
      // plants currently pushed aside by her, per type: proves contact reaches every layer
      touched: Object.fromEntries(this.layers.map((l) => {
        let n = 0;
        for (const b of l.batches) {
          const a = b.disturb();
          for (let i = 0; i < l.vis.length; i++) if (l.vis[i] && a[i * 4 + 2] > 0.01) n++;
          break;
        }
        return [l.type, n];
      })),
      // tiles held vs the pool: at the cap the far field starts thinning instead of filling
      tilesByType: Object.fromEntries(this.layers.map((l) =>
        [l.type, `${l.grid.live}/${CONFIG.layers[l.type].maxTiles} starved:${l.grid.starved}`])),
    };
  }
}

/**
 * RGBA copy of a flower atlas whose alpha marks the petal pixels, so an instance colour
 * recolours petals only and the veining, shading and green parts survive. A canvas would
 * premultiply alpha and blacken the masked-out pixels, so the result is uploaded as raw
 * RGBA. Also returns the tint gain that makes an average petal come out at full strength,
 * so a pale palette does not read as muddy on a dark texture.
 */
function makePetalMask(map: THREE.Texture, mode: 'lily' | 'nongreen') {
  const img = map.image as HTMLImageElement | ImageBitmap;
  const w = (img as any).width, h = (img as any).height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img as any, 0, 0);
  const id = ctx.getImageData(0, 0, w, h); const d = id.data;
  const hist = new Uint32Array(256); let lumN = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0, val = mx;
    let hue = 0;
    if (mx !== mn) {
      if (mx === r) hue = ((g - b) / (mx - mn)) % 6;
      else if (mx === g) hue = (b - r) / (mx - mn) + 2;
      else hue = (r - g) / (mx - mn) + 4;
      hue *= 60; if (hue < 0) hue += 360;
    }
    const green = hue > 55 && hue < 175 && sat > 0.18;
    let petal: boolean;
    if (mode === 'lily') {
      const purple = hue > 235 && hue < 350 && sat > 0.1;
      const pale = sat < 0.3 && val > 0.45;
      petal = !green && (purple || pale);
    } else {
      petal = !green && val > 0.10;     // everything that is not foliage and not shadow
    }
    d[i + 3] = petal ? 255 : 0;
    if (petal) { hist[Math.min(255, (0.3 * r + 0.59 * g + 0.11 * b) * 255) | 0]++; lumN++; }
  }
  const src = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let a = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) a += src[((y + oy) * w + x + ox) * 4 + 3];
    d[(y * w + x) * 4 + 3] = a / 9;
  }
  const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = map.colorSpace; t.flipY = false; t.wrapS = map.wrapS; t.wrapT = map.wrapT;
  t.channel = map.channel; t.anisotropy = 16; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  // Normalise on a high percentile, not the mean: a dark texture has a high mean-based
  // gain that drives its own highlights well past white, which shows up as pale gashes
  // across the petals.
  let seen = 0, p90 = 0.78;
  for (let i = 0; i < 256; i++) { seen += hist[i]; if (seen >= lumN * 0.9) { p90 = i / 255; break; } }
  return { tex: t, gain: THREE.MathUtils.clamp(0.86 / Math.max(0.1, p90), 0.5, 3.0) };
}

/**
 * Fill the colour under a cutout map's transparent pixels with the nearest opaque colour.
 * Mipmaps and bilinear filtering average across the cutout edge, and when what lies beyond
 * it is black or grey, every petal wears a dark outline. A few passes reach far enough for
 * the mip levels that are still visible at meadow distances.
 */
function solidify(map: THREE.Texture, passes = 6) {
  const img = map.image as HTMLImageElement | ImageBitmap;
  const w = (img as any).width, h = (img as any).height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img as any, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;
  // the alpha channel is kept as is; a scratch copy tracks which pixels have a colour yet
  let filled = new Uint8Array(w * h);
  // the edge band itself is refilled too: it carries the colour of whatever the scan was cut out from
  for (let i = 0; i < w * h; i++) filled[i] = d[i * 4 + 3] > 215 ? 1 : 0;
  const next = new Uint8Array(w * h);
  for (let pass = 0; pass < passes; pass++) {
    next.set(filled);
    let any = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const yy = y + oy; if (yy < 0 || yy >= h) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const xx = x + ox; if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (!filled[j]) continue;
          r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++;
        }
      }
      if (n === 0) continue;
      d[i * 4] = r / n; d[i * 4 + 1] = g / n; d[i * 4 + 2] = b / n;
      next[i] = 1; any = true;
    }
    filled = next.slice();
    if (!any) break;
  }
  const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = map.colorSpace; t.flipY = false; t.wrapS = map.wrapS; t.wrapT = map.wrapT;
  t.channel = map.channel; t.anisotropy = 16; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
