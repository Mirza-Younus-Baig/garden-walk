import * as THREE from 'three';

const _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _pq = new THREE.Quaternion(), _pInv = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/**
 * Turn a bone by a world-space rotation, leaving its children to follow. The bone's
 * parent's world matrix must be current.
 */
export function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  _m.copy(bone.parent!.matrixWorld).decompose(_v, _pq, _s);
  _pInv.copy(_pq).invert();
  bone.quaternion.premultiply(_pq).premultiply(q).premultiply(_pInv);
}
