import * as THREE from 'three';
import { solveTwoBone, rotateBoneWorld, aimBone, type Chain } from './ik';

/**
 * A procedural layer over her idle and walk clips: sitting, kneeling, leaning in to blow,
 * arms reaching, clapping, waving, the head turning to look at things.
 *
 * Everything is a target in her own frame (x to her right, y up, z ahead), blended in by a
 * weight that actions ease between 0 and 1. With every weight at 0 the layer does nothing,
 * so walking about looks exactly like the clips.
 *
 * Runs from the girl's `postAnimate` hook: after the clips, before the hair and skirt
 * springs, so the cloth follows the pose.
 */

export type Space = 'root' | 'hips' | 'chest' | 'world';

export interface ArmGoal {
  weight: number;
  space: Space;
  /** wrist target in `space` (world for 'world') */
  pos: THREE.Vector3;
  /** where the elbow points, in her root frame */
  pole: THREE.Vector3;
  /** optional: which way the fingers point, in her root frame (prayer hands point up) */
  fingers?: THREE.Vector3;
}

export interface BodyPreset {
  /** hips (pelvis) position in her root frame */
  hips: THREE.Vector3;
  /** pelvis pitch, radians, + tips the pelvis forward */
  hipsPitch: number;
  /** spine and chest pitch, radians, + leans forward */
  spine: number; chest: number;
  /** ankle targets in her root frame, mirrored for the left */
  foot: THREE.Vector3;
  /** knee pole in her root frame, mirrored */
  knee: THREE.Vector3;
  /** how far the toes turn to point back (kneeling), radians */
  toePoint: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** sitting on a seat whose top is `seatY` high, her root standing `back` metres in front of it */
export function sitPreset(seatY: number): BodyPreset {
  return { hips: V(0, seatY + 0.1, -0.5), hipsPitch: -0.06, spine: 0.04, chest: 0.02,
    foot: V(0.1, 0.075, -0.06), knee: V(0.14, 0.5, 1.0), toePoint: 0 };
}

/** kneeling upright, as at a low table */
export const KNEEL: BodyPreset = {
  hips: V(0, 0.5, -0.06), hipsPitch: 0.08, spine: 0.12, chest: 0.08,
  foot: V(0.12, 0.07, -0.43), knee: V(0.12, -0.6, 0.8), toePoint: 1.1,
};

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _pole = new THREE.Vector3(), _d = new THREE.Vector3();
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _q = new THREE.Quaternion();
const _ankL = new THREE.Vector3(), _ankR = new THREE.Vector3(), _hips = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _w = new THREE.Vector3();

export class PoseRig {
  // ---- what actions drive
  /** body preset and its weight */
  body: BodyPreset = KNEEL;
  bodyW = 0;
  /** extra forward lean of spine and chest, radians (leaning in to blow) */
  lean = 0;
  /** extra hips drop, metres (a little bounce when she claps) */
  bounce = 0;
  /** 0..1, a breath in: chest lifts, shoulders rise */
  inhale = 0;
  /** 0..1, cheeks out and head pushed forward as she blows */
  blow = 0;
  arms: { L: ArmGoal; R: ArmGoal } = {
    L: { weight: 0, space: 'chest', pos: V(0, 0, 0.2), pole: V(0.4, -0.3, -0.3) },
    R: { weight: 0, space: 'chest', pos: V(0, 0, 0.2), pole: V(0.4, -0.3, -0.3) },
  };
  /** world point she looks at, and how much */
  look = new THREE.Vector3();
  lookW = 0;

  private hips!: THREE.Object3D;
  private spine!: THREE.Object3D;
  private chest!: THREE.Object3D;
  private neck!: THREE.Object3D;
  private head!: THREE.Object3D;
  private scapL!: THREE.Object3D;
  private scapR!: THREE.Object3D;
  private legL!: Chain;
  private legR!: Chain;
  private armL!: Chain;
  private armR!: Chain;
  private toeL!: THREE.Object3D;
  private toeR!: THREE.Object3D;
  private fingerL!: THREE.Object3D;
  private fingerR!: THREE.Object3D;
  /** +1 if the rig's _L bones are on her left (negative x in her frame) as expected */
  private lSide = 1;
  /** the head's forward, in the head bone's own frame */
  private headFwd = new THREE.Vector3(0, 0, 1);
  private ready = false;

  constructor(private root: THREE.Object3D, model: THREE.Object3D) {
    const b = (n: string) => {
      const o = model.getObjectByName(n);
      if (!o) throw new Error(`pose: missing bone ${n}`);
      return o;
    };
    this.hips = b('Root_M'); this.spine = b('Spine1_M'); this.chest = b('Chest_M');
    this.neck = b('Neck_M'); this.head = b('Head_M');
    this.scapL = b('Scapula_L'); this.scapR = b('Scapula_R');
    this.legL = { root: b('Hip_L'), mid: b('Knee_L'), end: b('Ankle_L') };
    this.legR = { root: b('Hip_R'), mid: b('Knee_R'), end: b('Ankle_R') };
    this.armL = { root: b('Shoulder_L'), mid: b('Elbow_L'), end: b('Wrist_L') };
    this.armR = { root: b('Shoulder_R'), mid: b('Elbow_R'), end: b('Wrist_R') };
    this.toeL = b('Toes_L'); this.toeR = b('Toes_R');
    this.fingerL = b('MiddleFinger1_L'); this.fingerR = b('MiddleFinger1_R');
  }

  /** her frame: forward, right */
  private frame() {
    const yaw = this.root.rotation.y;
    _f.set(Math.sin(yaw), 0, Math.cos(yaw));
    _r.set(-Math.cos(yaw), 0, Math.sin(yaw));
  }

  /** a point in her root frame to world */
  toWorld(local: THREE.Vector3, out: THREE.Vector3, origin = this.root.position) {
    this.frame();
    return out.copy(origin).addScaledVector(_r, local.x).addScaledVector(UP, local.y).addScaledVector(_f, local.z);
  }

  /** measure what depends on the rig's rest orientation; call once she is standing */
  private calibrate() {
    this.frame();
    this.hips.getWorldPosition(_hips);
    this.legL.root.getWorldPosition(_p);
    // _L bones should sit on her left, which is -right
    this.lSide = _p.sub(_hips).dot(_r) < 0 ? 1 : -1;
    this.head.getWorldQuaternion(_q);
    this.headFwd.copy(_f).applyQuaternion(_q.invert());
    this.ready = true;
  }

  /** side sign for a mirrored local x: the left limb sits at -x */
  private sx(isLeft: boolean, x: number) { return (isLeft ? -x : x) * this.lSide; }

  update() {
    if (!this.ready) { this.root.updateMatrixWorld(true); this.calibrate(); }
    const w = this.bodyW;
    const anyArm = this.arms.L.weight > 1e-3 || this.arms.R.weight > 1e-3;
    if (w < 1e-3 && Math.abs(this.lean) < 1e-4 && this.inhale < 1e-3 && this.blow < 1e-3 && !anyArm && this.lookW < 1e-3 && Math.abs(this.bounce) < 1e-4) return;
    this.frame();
    const P = this.body;

    // where the clip had her feet, before the hips move them
    this.legL.end.getWorldPosition(_ankL);
    this.legR.end.getWorldPosition(_ankR);

    // ---- hips
    if (w > 1e-3 || Math.abs(this.bounce) > 1e-4) {
      this.hips.getWorldPosition(_hips);
      this.toWorld(P.hips, _t);
      _hips.lerp(_t, w);
      _hips.y -= this.bounce;
      const parent = this.hips.parent!;
      parent.updateMatrixWorld(true);
      this.hips.position.copy(parent.worldToLocal(_w.copy(_hips)));
      if (w > 1e-3) rotateBoneWorld(this.hips, _q.setFromAxisAngle(_r, -P.hipsPitch * w));
      this.hips.updateMatrixWorld(true);
    }

    // (a positive turn about her right axis tips things back, hence the minus signs)
    // ---- spine: the preset's bend, the lean, and a breath that lifts the chest
    const spine = P.spine * w + this.lean * 0.55 - this.inhale * 0.05 + this.blow * 0.05;
    const chest = P.chest * w + this.lean * 0.45 - this.inhale * 0.07 + this.blow * 0.06;
    if (Math.abs(spine) > 1e-4) rotateBoneWorld(this.spine, _q.setFromAxisAngle(_r, -spine));
    this.spine.updateMatrixWorld(true);
    if (Math.abs(chest) > 1e-4) rotateBoneWorld(this.chest, _q.setFromAxisAngle(_r, -chest));
    // shoulders rise on the breath in
    if (this.inhale > 1e-3) {
      const s = this.inhale * 0.1;
      // a turn about forward lifts her left side when positive (forward x left = up)
      rotateBoneWorld(this.scapL, _q.setFromAxisAngle(_f, s * this.lSide));
      rotateBoneWorld(this.scapR, _q.setFromAxisAngle(_f, -s * this.lSide));
    }
    this.chest.updateMatrixWorld(true);

    // ---- legs: from where the clip planted them to the preset
    if (w > 1e-3) {
      for (const [leg, ank, isL] of [[this.legL, _ankL, true], [this.legR, _ankR, false]] as const) {
        this.toWorld(_p.set(this.sx(isL, P.foot.x), P.foot.y, P.foot.z), _t);
        _t.lerpVectors(ank, _t, w);
        this.toWorld(_p.set(this.sx(isL, P.knee.x), P.knee.y, P.knee.z), _pole);
        solveTwoBone(leg, _t, _pole, 1);
        if (P.toePoint) {
          // point the toes back along the floor
          const ankle = leg.end, toe = isL ? this.toeL : this.toeR;
          ankle.getWorldPosition(_p); toe.getWorldPosition(_d);
          _d.sub(_p).normalize();
          _t.copy(_f).multiplyScalar(-1).addScaledVector(UP, -0.25).normalize();
          aimBone(ankle, _d, _t, w * Math.min(1, P.toePoint));
        }
      }
    }

    // ---- arms
    for (const [goal, ch, isL] of [[this.arms.L, this.armL, true], [this.arms.R, this.armR, false]] as const) {
      if (goal.weight < 1e-3) continue;
      if (goal.space === 'world') _t.copy(goal.pos);
      else {
        const origin = goal.space === 'chest' ? this.chest.getWorldPosition(_d)
          : goal.space === 'hips' ? this.hips.getWorldPosition(_d) : this.root.position;
        this.toWorld(_p.set(this.sx(isL, goal.pos.x), goal.pos.y, goal.pos.z), _t, origin);
      }
      this.chest.getWorldPosition(_d);
      this.toWorld(_p.set(this.sx(isL, goal.pole.x), goal.pole.y, goal.pole.z), _pole, _d);
      solveTwoBone(ch, _t, _pole, goal.weight);
      if (goal.fingers) {
        // turn the hand at the wrist so the fingers point the asked way
        ch.end.getWorldPosition(_p); (isL ? this.fingerL : this.fingerR).getWorldPosition(_d);
        _d.sub(_p).normalize();
        // (input and output must be different vectors: toWorld writes its output first)
        this.toWorld(_p.set(this.sx(isL, goal.fingers.x), goal.fingers.y, goal.fingers.z), _t, _w.set(0, 0, 0)).normalize();
        aimBone(ch.end, _d, _t, goal.weight * 0.85);
      }
    }

    // ---- head: turn toward what she is looking at, neck taking a share, within limits;
    // and pushed forward a touch as she blows
    if (this.lookW > 1e-3 || this.blow > 1e-3) {
      this.head.getWorldPosition(_p);
      this.head.getWorldQuaternion(_q);
      const fwdNow = _d.copy(this.headFwd).applyQuaternion(_q).normalize();
      if (this.lookW > 1e-3) {
        _t.subVectors(this.look, _p).normalize();
        // limit: no more than ~70 degrees off her body's forward, and not past straight up/down
        const yawOff = Math.atan2(_t.dot(_r), _t.dot(_f));
        const lim = 1.2;
        // a turn about +y moves her nose toward her left, so trimming a look to the right
        // back to the limit is a positive turn
        if (Math.abs(yawOff) > lim) _t.applyAxisAngle(UP, yawOff - Math.sign(yawOff) * lim);
        _t.y = THREE.MathUtils.clamp(_t.y, -0.75, 0.6); _t.normalize();
        aimBone(this.neck, fwdNow, _t, this.lookW * 0.4);
        this.head.getWorldQuaternion(_q);
        fwdNow.copy(this.headFwd).applyQuaternion(_q).normalize();
        aimBone(this.head, fwdNow, _t, this.lookW * 0.6);
      }
      if (this.blow > 1e-3) rotateBoneWorld(this.head, _q.setFromAxisAngle(_r, -this.blow * 0.05));
      this.head.updateMatrixWorld(true);
    }
  }

  /** the point just in front of her lips, for the breath */
  mouth(out: THREE.Vector3) {
    this.head.getWorldPosition(out);
    this.head.getWorldQuaternion(_q);
    _d.copy(this.headFwd).applyQuaternion(_q).normalize();
    return out.addScaledVector(_d, 0.1).addScaledVector(UP, 0.02);
  }

  /** where an arm goal in `space` lands in the world right now (for gliding between goals) */
  goalWorld(space: Space, pos: THREE.Vector3, isLeft: boolean, out: THREE.Vector3) {
    if (space === 'world') return out.copy(pos);
    const origin = space === 'chest' ? this.chest.getWorldPosition(_w) : space === 'hips' ? this.hips.getWorldPosition(_w) : this.root.position;
    return this.toWorld(_d.set(this.sx(isLeft, pos.x), pos.y, pos.z), out, origin);
  }

  /** the hand, for placing things in it */
  wrist(isLeft: boolean, out: THREE.Vector3) { return (isLeft ? this.armL : this.armR).end.getWorldPosition(out); }

  /** everything back to the clips at once (used on a reset) */
  clear() {
    this.bodyW = 0; this.lean = 0; this.bounce = 0; this.inhale = 0; this.blow = 0; this.lookW = 0;
    this.arms.L.weight = 0; this.arms.R.weight = 0;
  }
}
