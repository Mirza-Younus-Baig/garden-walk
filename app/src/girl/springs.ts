import * as THREE from 'three';

/**
 * Secondary motion for the bones the clips leave alone: hair, skirt panels and tie.
 *
 * Each bone's tail is a point mass in world space, pulled back toward where the animated
 * pose puts it by a damped spring. Damping acts on motion relative to her body, not
 * relative to the air, so at a steady walk the hair hangs where it was modelled and only
 * swings when she starts, stops, turns or bounces; a small separate air term lets it
 * trail a little at speed. Tails are kept at bone length and pushed out of a few body
 * colliders, so the skirt is swept by her thighs and the hair falls over her shoulders
 * instead of through them.
 */
export interface SpringParams {
  /** natural frequency toward the animated pose, rad/s: higher is stiffer */
  omega: number;
  /** damping ratio of motion relative to her body (1 = no overshoot) */
  zeta: number;
  /** drag against still air, 1/s: how much it trails behind her at a steady pace */
  air: number;
  /** downward pull in m/s^2, on top of the droop the rest pose already has */
  gravity: number;
  /** radius of the tail itself for collisions, metres */
  radius: number;
  /** each joint further down a chain is this much looser than the one above it */
  falloff?: number;
  /** how far the tail may swing from the animated pose, in radians */
  maxAngle: number;
}

interface ColliderDef {
  bone: string; off: [number, number, number]; r: number;
  /** a second bone makes it a capsule */
  bone2?: string; off2?: [number, number, number];
}

interface Collider {
  a: THREE.Object3D; offA: THREE.Vector3; b: THREE.Object3D | null; offB: THREE.Vector3; r: number;
  wa: THREE.Vector3; wb: THREE.Vector3;
}

export class Joint {
  tail = new THREE.Vector3();
  vel = new THREE.Vector3();
  /** the pose the clip (or the bind pose) gives this bone this frame */
  rest = new THREE.Quaternion();
  head = new THREE.Vector3();
  /** per collider: its radius for this joint, shrunk where the rest pose already overlaps it */
  radii: number[] = [];
  readonly cosMax: number;
  readonly sinMax: number;
  constructor(
    readonly bone: THREE.Object3D,
    readonly bind: THREE.Quaternion,
    readonly axis: THREE.Vector3,
    readonly len: number,
    readonly omega: number,
    readonly p: SpringParams,
    readonly cols: Collider[],
  ) { this.cosMax = Math.cos(p.maxAngle); this.sinMax = Math.sin(p.maxAngle); }
}

export interface ChainDef { bones: string[]; params: SpringParams; colliders: ColliderDef[]; tipLength?: number }

/**
 * Chains that hang side by side round a skirt are one piece of cloth. Their tails may bunch
 * together, as pleats do, but not pull apart. Left to swing on its own, each panel drags the
 * cloth joining it to its neighbour out to twice its length, and those stretched faces cut
 * through her thighs. Joints at the same depth in neighbouring chains are linked, and the
 * ring closes. `chains` names each chain by its first bone, in order round the ring.
 */
export interface RingDef {
  chains: string[];
  /** longest a link may get, as a multiple of its standing length */
  stretch: number;
  /** shortest, likewise: well under 1, since pleats fold together freely */
  compress: number;
}

interface Link { a: Joint; b: Joint; rest: number; stretch: number; compress: number }

const STEP = 1 / 120;
const _m = new THREE.Matrix4();
const _pq = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _a = new THREE.Vector3();
const _rootQ = new THREE.Quaternion();

export class SpringRig {
  readonly joints: Joint[] = [];
  private colliders: Collider[] = [];
  private rootPrev = new THREE.Vector3();
  private rootVel = new THREE.Vector3();
  private primed = false;
  private gravityDir = new THREE.Vector3(0, -1, 0);
  private links: Link[] = [];
  /** every joint some link touches, parents before children, for re-aiming after a solve */
  private linked: Joint[] = [];

  constructor(private root: THREE.Object3D, model: THREE.Object3D, chains: ChainDef[], rings: RingDef[] = []) {
    const colliderCache = new Map<string, Collider>();
    const getCollider = (c: ColliderDef) => {
      const key = JSON.stringify(c);
      let col = colliderCache.get(key);
      if (!col) {
        const a = model.getObjectByName(c.bone), b = c.bone2 ? model.getObjectByName(c.bone2) : null;
        if (!a) throw new Error(`springs: missing collider bone ${c.bone}`);
        col = { a, offA: new THREE.Vector3(...c.off), b: b ?? null, offB: new THREE.Vector3(...(c.off2 ?? [0, 0, 0])),
                r: c.r, wa: new THREE.Vector3(), wb: new THREE.Vector3() };
        colliderCache.set(key, col); this.colliders.push(col);
      }
      return col;
    };
    model.updateMatrixWorld(true);
    const byChain = new Map<string, Joint[]>();
    for (const ch of chains) {
      const cols = ch.colliders.map(getCollider);
      let prevAxis: THREE.Vector3 | null = null, prevLen = 0.08;
      ch.bones.forEach((name, depth) => {
        const bone = model.getObjectByName(name);
        if (!bone) throw new Error(`springs: missing bone ${name}`);
        const child = ch.bones[depth + 1] ? model.getObjectByName(ch.bones[depth + 1]) : null;
        let axis: THREE.Vector3, len: number;
        if (child) {
          axis = child.position.clone(); len = axis.length(); axis.normalize();
          // the bone's own scale shrinks or stretches the child offset in world space
          bone.getWorldScale(_s); len *= _s.x;
        } else {
          axis = (prevAxis ?? new THREE.Vector3(1, 0, 0)).clone(); len = ch.tipLength ?? prevLen;
        }
        prevAxis = axis; prevLen = len;
        const omega = ch.params.omega * Math.pow(ch.params.falloff ?? 0.85, depth);
        const joint = new Joint(bone, bone.quaternion.clone(), axis, len, omega, ch.params, cols);
        this.joints.push(joint);
        if (depth === 0) byChain.set(name, []);
        byChain.get(ch.bones[0])!.push(joint);
      });
    }
    for (const ring of rings) {
      const members = ring.chains.map((n) => {
        const js = byChain.get(n);
        if (!js) throw new Error(`springs: ring names ${n}, which starts no chain`);
        return js;
      });
      members.forEach((a, k) => {
        const b = members[(k + 1) % members.length];
        for (let d = 0; d < Math.min(a.length, b.length); d++) {
          this.links.push({ a: a[d], b: b[d], rest: 0, stretch: ring.stretch, compress: ring.compress });
        }
      });
    }
    const touched = new Set(this.links.flatMap((l) => [l.a, l.b]));
    this.linked = this.joints.filter((j) => touched.has(j));
  }

  /** put every simulated bone back to its bind pose, so the mixer (or nothing) sets its rest */
  preAnimate() { for (const j of this.joints) j.bone.quaternion.copy(j.bind); }

  /**
   * Run after the clips and any procedural layers have posed the skeleton and the world
   * matrices are current. `dt` is the frame time; the simulation substeps at 120 Hz.
   */
  update(dt: number) {
    for (const j of this.joints) j.rest.copy(j.bone.quaternion);
    this.root.getWorldPosition(_p);
    if (!this.primed) {
      this.rootPrev.copy(_p);
      this.updateColliders();
      for (const j of this.joints) {
        this.restTail(j, _r);
        j.tail.copy(_r); j.vel.set(0, 0, 0);
        // a collider the modelled rest pose already sits inside would shove the hair about
        // while she stands still, so each joint gets the room its rest pose needs
        j.radii = j.cols.map((c) => {
          const dist = this.colliderDistance(c, j.tail);
          return Math.max(0, Math.min(c.r, dist - j.p.radius - 0.004));
        });
      }
      // links keep the spacing the panels have while she stands
      for (const l of this.links) l.rest = l.a.tail.distanceTo(l.b.tail);
      this.primed = true;
      return;
    }
    if (dt <= 0) return;
    // her body's own velocity: the frame the hair is damped against
    this.rootVel.subVectors(_p, this.rootPrev).divideScalar(dt);
    this.rootPrev.copy(_p);
    // a teleport or a stalled tab: re-seat everything rather than fling it
    if (this.rootVel.lengthSq() > 100) { this.primed = false; this.update(0); return; }
    this.updateColliders();
    const n = Math.min(6, Math.max(1, Math.ceil(dt / STEP)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      for (const j of this.joints) this.stepJoint(j, h);
      if (this.links.length) this.solveLinks();
    }
  }

  /**
   * Pull linked tails back into range: a link longer than its stretch limit is shortened,
   * one shorter than its compress limit is lengthened, each end taking half. Velocity that
   * would carry a link further out of range is dropped, so the correction does not bounce.
   */
  private solveLinks() {
    for (let it = 0; it < 2; it++) {
      for (const l of this.links) {
        _d.subVectors(l.b.tail, l.a.tail);
        const len = _d.length();
        if (len < 1e-6) continue;
        const hi = l.rest * l.stretch, lo = l.rest * l.compress;
        if (len <= hi && len >= lo) continue;
        _d.divideScalar(len);
        const corr = (len - (len > hi ? hi : lo)) * 0.5;
        l.a.tail.addScaledVector(_d, corr);
        l.b.tail.addScaledVector(_d, -corr);
        const apart = _a.subVectors(l.b.vel, l.a.vel).dot(_d);
        if ((len > hi && apart > 0) || (len < lo && apart < 0)) {
          l.a.vel.addScaledVector(_d, apart * 0.5);
          l.b.vel.addScaledVector(_d, -apart * 0.5);
        }
      }
    }
    for (const j of this.linked) this.aim(j);
  }

  /** point a bone at its tail again after the tail was moved, keeping the bone's length */
  private aim(j: Joint) {
    this.restTail(j, _r);
    _d.subVectors(j.tail, j.head);
    const len = _d.length();
    if (len < 1e-6) { j.tail.copy(_r); return; }
    _d.divideScalar(len);
    j.tail.copy(j.head).addScaledVector(_d, j.len);
    _r.sub(j.head).normalize();
    _q.setFromUnitVectors(_r, _d);
    _wq.copy(_pq).multiply(j.rest).premultiply(_q);
    j.bone.quaternion.copy(_pq.invert().multiply(_wq));
    j.bone.updateMatrixWorld(true);
  }

  private updateColliders() {
    this.root.getWorldQuaternion(_rootQ);
    for (const c of this.colliders) {
      c.a.getWorldPosition(c.wa).add(_a.copy(c.offA).applyQuaternion(_rootQ));
      if (c.b) c.b.getWorldPosition(c.wb).add(_a.copy(c.offB).applyQuaternion(_rootQ));
    }
  }

  private closest(c: Collider, x: THREE.Vector3, out: THREE.Vector3) {
    if (!c.b) return out.copy(c.wa);
    _a.subVectors(c.wb, c.wa);
    const t = THREE.MathUtils.clamp(_d.subVectors(x, c.wa).dot(_a) / Math.max(_a.lengthSq(), 1e-8), 0, 1);
    return out.copy(c.wa).addScaledVector(_a, t);
  }

  private colliderDistance(c: Collider, x: THREE.Vector3) {
    const q = this.closest(c, x, new THREE.Vector3());
    return q.distanceTo(x);
  }

  /** where the animated pose puts this joint's tail, and its parent's world rotation into _pq */
  restTail(j: Joint, out: THREE.Vector3) {
    const parent = j.bone.parent!;
    _m.copy(parent.matrixWorld).decompose(_p, _pq, _s);
    j.head.setFromMatrixPosition(j.bone.matrixWorld);
    _wq.copy(_pq).multiply(j.rest);
    return out.copy(j.axis).applyQuaternion(_wq).multiplyScalar(j.len).add(j.head);
  }

  private stepJoint(j: Joint, h: number) {
    const p = j.p;
    this.restTail(j, _r);
    // spring toward the animated pose, damped relative to her body, plus a little air drag
    const w = j.omega;
    _a.subVectors(_r, j.tail).multiplyScalar(w * w);
    _d.subVectors(j.vel, this.rootVel).multiplyScalar(-2 * p.zeta * w);
    _a.add(_d).addScaledVector(j.vel, -p.air).addScaledVector(this.gravityDir, p.gravity);
    j.vel.addScaledVector(_a, h);
    j.tail.addScaledVector(j.vel, h);

    // out of the body
    for (let i = 0; i < j.cols.length; i++) {
      const r = j.radii[i] + p.radius;
      if (r <= p.radius) continue;
      const c = this.closest(j.cols[i], j.tail, _p);
      _d.subVectors(j.tail, c);
      const dist = _d.length();
      if (dist < r && dist > 1e-6) {
        _d.divideScalar(dist);
        j.tail.copy(c).addScaledVector(_d, r);
        const into = j.vel.dot(_d);
        if (into < 0) j.vel.addScaledVector(_d, -into);
      }
    }

    // keep bone length; whatever velocity pointed along the bone is spent
    _d.subVectors(j.tail, j.head);
    const len = _d.length();
    if (len < 1e-6) { j.tail.copy(_r); return; }
    _d.divideScalar(len);
    j.vel.addScaledVector(_d, -j.vel.dot(_d));

    // Swing limit. A strand of hair cannot fold back over the crown however hard the
    // head bobs, and the tie cannot wrap into the chest: past the cone the tail is
    // brought back onto it and the velocity that carried it there is dropped.
    _r.sub(j.head).normalize();                      // rest direction
    const cosA = _d.dot(_r);
    if (cosA < j.cosMax) {
      _a.copy(_d).addScaledVector(_r, -cosA);        // component of the tail off the rest axis
      const side = _a.length();
      if (side > 1e-6) {
        _a.divideScalar(side);
        _d.copy(_r).multiplyScalar(j.cosMax).addScaledVector(_a, j.sinMax);
        j.vel.addScaledVector(_a, -Math.max(0, j.vel.dot(_a)));
      } else _d.copy(_r);
    }
    j.tail.copy(j.head).addScaledVector(_d, j.len);

    // rotate the bone so its axis points at the tail
    _q.setFromUnitVectors(_r, _d);                   // world-space swing
    _wq.copy(_pq).multiply(j.rest).premultiply(_q);  // new world rotation
    j.bone.quaternion.copy(_pq.invert().multiply(_wq));
    j.bone.updateMatrixWorld(true);
  }
}
