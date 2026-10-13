import * as THREE from 'three';
import { rotateWorld } from '../../../girl/bones';

/**
 * Two-bone IK (hip-knee-ankle, shoulder-elbow-wrist), solved in world space so it does not
 * care how the rig's bones are oriented:
 *
 *   1. open or close the middle joint until root-to-end is as long as root-to-target
 *      (law of cosines)
 *   2. swing the root so the end lands on the target
 *   3. twist about root-to-target so the knee or elbow points at the pole
 *
 * The result is blended with whatever the animation had by `weight`.
 */

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _ba = new THREE.Vector3(), _bc = new THREE.Vector3(), _ac = new THREE.Vector3(), _at = new THREE.Vector3();
const _n = new THREE.Vector3(), _bOff = new THREE.Vector3(), _pOff = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _v = new THREE.Vector3();

const clampDot = (x: number) => Math.min(1, Math.max(-1, x));

export interface Chain { root: THREE.Object3D; mid: THREE.Object3D; end: THREE.Object3D }

/**
 * Solve the chain so `end` reaches `target`, bending towards `pole` (a world point the
 * middle joint should lean toward). The chain's world matrices must be current on entry,
 * and are current again on exit.
 */
export function solveTwoBone(ch: Chain, target: THREE.Vector3, pole: THREE.Vector3, weight = 1) {
  if (weight <= 1e-4) return;
  _qa.copy(ch.root.quaternion); _qb.copy(ch.mid.quaternion);
  ch.root.getWorldPosition(_a); ch.mid.getWorldPosition(_b); ch.end.getWorldPosition(_c);
  _ba.subVectors(_a, _b); _bc.subVectors(_c, _b);
  const lab = _ba.length(), lcb = _bc.length();
  const eps = 1e-3;
  const lat = THREE.MathUtils.clamp(_at.subVectors(target, _a).length(), Math.abs(lab - lcb) + eps, lab + lcb - eps);

  // 1. the middle joint: interior angle now, and the one that gives the reach we need
  const now = Math.acos(clampDot(_ba.dot(_bc) / (lab * lcb)));
  const want = Math.acos(clampDot((lab * lab + lcb * lcb - lat * lat) / (2 * lab * lcb)));
  _n.crossVectors(_ba, _bc);
  if (_n.lengthSq() < 1e-12) {
    // straight limb: open it toward the pole
    _n.crossVectors(_ba, _v.subVectors(pole, _b));
    if (_n.lengthSq() < 1e-12) _n.set(1, 0, 0);
  }
  _n.normalize();
  // rotating b->c about (ba x bc) by a positive angle swings it away from b->a: opens the joint
  rotateWorld(ch.mid, _q0.setFromAxisAngle(_n, want - now));
  ch.mid.updateMatrixWorld(true);

  // 2. swing the root so the end lands on the target
  ch.end.getWorldPosition(_c);
  _ac.subVectors(_c, _a).normalize();
  _at.subVectors(target, _a).normalize();
  rotateWorld(ch.root, _q0.setFromUnitVectors(_ac, _at));
  ch.root.updateMatrixWorld(true);

  // 3. twist about root->target until the middle joint faces the pole
  ch.mid.getWorldPosition(_b);
  _bOff.subVectors(_b, _a); _bOff.addScaledVector(_at, -_bOff.dot(_at));
  _pOff.subVectors(pole, _a); _pOff.addScaledVector(_at, -_pOff.dot(_at));
  if (_bOff.lengthSq() > 1e-10 && _pOff.lengthSq() > 1e-10) {
    _bOff.normalize(); _pOff.normalize();
    const ang = Math.atan2(_v.crossVectors(_bOff, _pOff).dot(_at), clampDot(_bOff.dot(_pOff)));
    rotateWorld(ch.root, _q1.setFromAxisAngle(_at, ang));
  }
  if (weight < 1) {
    // blend from the animated pose toward the solution. (slerpQuaternions must not be given
    // its own target as an argument: it copies the first argument in before reading the second)
    _q0.copy(ch.root.quaternion); ch.root.quaternion.copy(_qa).slerp(_q0, weight);
    _q1.copy(ch.mid.quaternion); ch.mid.quaternion.copy(_qb).slerp(_q1, weight);
  }
  ch.root.updateMatrixWorld(true);
}

/**
 * Turn `bone` so its world direction `from` (a unit vector in world space at the current
 * pose) points along `to`, by `weight`.
 */
export function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight = 1) {
  if (weight <= 1e-4) return;
  _q0.setFromUnitVectors(from, to);
  if (weight < 1) _q0.slerp(_q1.identity(), 1 - weight);
  rotateWorld(bone, _q0);
  bone.updateMatrixWorld(true);
}
