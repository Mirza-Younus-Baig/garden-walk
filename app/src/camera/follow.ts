import * as THREE from 'three';
import { CONFIG } from '../config';
import { heightAt } from '../world/ground';

export class FollowCamera {
  camera: THREE.PerspectiveCamera;
  zoom = CONFIG.camera.startZoom;
  yaw = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private first = true;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 160);
  }

  onWheel(deltaY: number) {
    this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(deltaY * 0.0012), CONFIG.camera.minZoom, CONFIG.camera.maxZoom);
  }

  private settle = 0;

  update(dt: number, girlPos: THREE.Vector3, girlYaw: number, moving: boolean) {
    const c = CONFIG.camera;
    if (this.first) this.yaw = girlYaw;
    // Swing the orbit yaw to sit behind her. Keep converging for a moment after she
    // stops, so a walk toward the viewer doesn't leave her facing the camera.
    if (moving) this.settle = c.settle;
    else this.settle = Math.max(0, this.settle - dt);
    if (moving || this.settle > 0) {
      let d = girlYaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      // turn faster the further behind the camera is, so 180-degree reversals resolve quickly
      const rate = c.yawRate * (1 + 1.6 * Math.abs(d) / Math.PI);
      this.yaw += d * Math.min(1, rate * dt);
    }
    const back = c.back * this.zoom, up = c.up * Math.pow(this.zoom, 0.8);
    const desired = new THREE.Vector3(girlPos.x - Math.sin(this.yaw) * back, girlPos.y + up, girlPos.z - Math.cos(this.yaw) * back);
    const minY = heightAt(desired.x, desired.z) + 0.55;
    if (desired.y < minY) desired.y = minY;
    const lookT = new THREE.Vector3(girlPos.x, girlPos.y + c.lookUp * Math.pow(this.zoom, 0.3), girlPos.z);
    if (this.first) { this.pos.copy(desired); this.look.copy(lookT); this.first = false; }
    const k = 1 - Math.exp(-c.damp * dt);
    this.pos.lerp(desired, k);
    this.look.lerp(lookT, 1 - Math.exp(-c.damp * 1.6 * dt));
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
