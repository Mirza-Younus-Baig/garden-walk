import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { solveTwoBone } from '../src/modes/birthday/girl/ik';

/** a straight-down leg: hip at y=1, knee at 0.5, ankle at 0, under a rotated parent */
function leg(parentRot = new THREE.Euler(0.3, 1.1, -0.2)) {
  const root = new THREE.Group(); root.rotation.copy(parentRot);
  const hip = new THREE.Object3D(); hip.position.set(0, 1, 0); root.add(hip);
  const knee = new THREE.Object3D(); knee.position.set(0, -0.5, 0); hip.add(knee);
  const ankle = new THREE.Object3D(); ankle.position.set(0, -0.5, 0); knee.add(ankle);
  // a slight bend, as a walk clip would leave it
  knee.rotation.x = 0.1;
  root.updateMatrixWorld(true);
  return { root, chain: { root: hip, mid: knee, end: ankle } };
}

describe('solveTwoBone', () => {
  it('puts the end on a reachable target and keeps bone lengths', () => {
    for (let i = 0; i < 30; i++) {
      const { chain } = leg();
      const hipW = chain.root.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(Math.random() - 0.5, -1, Math.random() - 0.5).normalize();
      const target = hipW.clone().addScaledVector(dir, 0.3 + Math.random() * 0.6);
      const pole = hipW.clone().add(new THREE.Vector3(0, -0.3, 1));
      solveTwoBone(chain, target, pole, 1);
      const end = chain.end.getWorldPosition(new THREE.Vector3());
      expect(end.distanceTo(target)).toBeLessThan(1e-3);
      const knee = chain.mid.getWorldPosition(new THREE.Vector3());
      expect(knee.distanceTo(hipW)).toBeCloseTo(0.5, 5);
      expect(end.distanceTo(knee)).toBeCloseTo(0.5, 5);
    }
  });
  it('bends the knee toward the pole', () => {
    const { chain } = leg(new THREE.Euler());
    const target = new THREE.Vector3(0, 0.4, 0.1);
    solveTwoBone(chain, target, new THREE.Vector3(0, 0.6, 2), 1);
    expect(chain.mid.getWorldPosition(new THREE.Vector3()).z).toBeGreaterThan(0.2);
    const again = leg(new THREE.Euler()).chain;
    solveTwoBone(again, target, new THREE.Vector3(0, 0.6, -2), 1);
    expect(again.mid.getWorldPosition(new THREE.Vector3()).z).toBeLessThan(-0.2);
  });
  it('reaches as far as it can toward an unreachable target, straight', () => {
    const { chain } = leg(new THREE.Euler());
    const target = new THREE.Vector3(3, 1, 0);
    solveTwoBone(chain, target, new THREE.Vector3(0, 0, 1), 1);
    const end = chain.end.getWorldPosition(new THREE.Vector3());
    expect(end.distanceTo(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(0.99);
    expect(end.y).toBeCloseTo(1, 2);
  });
  it('weight 0 leaves the pose alone', () => {
    const { chain } = leg();
    const q = chain.root.quaternion.clone(), q2 = chain.mid.quaternion.clone();
    solveTwoBone(chain, new THREE.Vector3(1, 1, 1), new THREE.Vector3(0, 0, 1), 0);
    expect(chain.root.quaternion.equals(q)).toBe(true);
    expect(chain.mid.quaternion.equals(q2)).toBe(true);
  });
});
