import * as THREE from 'three';
import { CONFIG } from '../config';
import { heightAt } from '../world/ground';

/**
 * Critically damped spring toward a target (Unity's SmoothDamp). Unlike an exponential
 * lerp it carries velocity, so a change of target eases in as well as out, and a series
 * of small target changes never turns into a series of small jolts.
 */
class Damped {
  v = 0;
  constructor(public x = 0) {}
  to(target: number, smoothTime: number, dt: number) {
    const omega = 2 / Math.max(1e-4, smoothTime);
    const e = omega * dt;
    const decay = 1 / (1 + e + 0.48 * e * e + 0.235 * e * e * e);
    const change = this.x - target;
    const temp = (this.v + omega * change) * dt;
    this.v = (this.v - omega * temp) * decay;
    this.x = target + (change + temp) * decay;
    return this.x;
  }
  set(x: number) { this.x = x; this.v = 0; }
}

/** the same, for an angle: the target is taken the short way round */
class DampedAngle extends Damped {
  to(target: number, smoothTime: number, dt: number) {
    let d = target - this.x; d = Math.atan2(Math.sin(d), Math.cos(d));
    return super.to(this.x + d, smoothTime, dt);
  }
}

class DampedVec3 {
  x = new Damped(); y = new Damped(); z = new Damped();
  to(t: THREE.Vector3, smoothTime: number, dt: number, out: THREE.Vector3) {
    return out.set(this.x.to(t.x, smoothTime, dt), this.y.to(t.y, smoothTime, dt), this.z.to(t.z, smoothTime, dt));
  }
  set(t: THREE.Vector3) { this.x.set(t.x); this.y.set(t.y); this.z.set(t.z); }
}

export class FollowCamera {
  camera: THREE.PerspectiveCamera;
  /** where the wheel has asked the zoom to go; the zoom itself eases toward it */
  zoomTarget = CONFIG.camera.startZoom;
  private zoomD = new Damped(CONFIG.camera.startZoom);
  private yawD = new DampedAngle();
  private posD = new DampedVec3();
  private lookD = new DampedVec3();
  private fovD = new Damped(CONFIG.camera.fov);
  private first = true;
  private settle = 0;
  private desired = new THREE.Vector3();
  private lookT = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, aspect, 0.1, 160);
  }

  get zoom() { return this.zoomD.x; }
  set zoom(z: number) { this.zoomTarget = z; this.zoomD.set(z); }
  get yaw() { return this.yawD.x; }

  onWheel(deltaY: number) {
    this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * Math.exp(deltaY * 0.0012), CONFIG.camera.minZoom, CONFIG.camera.maxZoom);
  }

  update(dt: number, girlPos: THREE.Vector3, girlYaw: number, girlVel: THREE.Vector3, moving: boolean) {
    const c = CONFIG.camera;
    if (this.first) this.yawD.set(girlYaw);
    // Swing the orbit to sit behind her. Keep converging for a moment after she stops, so
    // a walk toward the viewer does not leave her facing the camera; the swing is a
    // spring, so it gathers and sheds speed instead of switching on and off.
    if (moving) this.settle = c.settle;
    else this.settle = Math.max(0, this.settle - dt);
    const chasing = moving || this.settle > 0;
    if (chasing) {
      let d = girlYaw - this.yawD.x; d = Math.atan2(Math.sin(d), Math.cos(d));
      // quicker the further behind it is, so a reversal resolves without dragging on
      const smooth = c.yawSmooth / (1 + 1.4 * Math.abs(d) / Math.PI);
      this.yawD.to(girlYaw, smooth, dt);
    } else {
      this.yawD.v *= Math.exp(-6 * dt);
      this.yawD.x += this.yawD.v * dt;
    }
    const yaw = this.yawD.x;
    const zoom = this.zoomD.to(this.zoomTarget, c.zoomSmooth, dt);

    const speed = Math.hypot(girlVel.x, girlVel.z);
    const runF = THREE.MathUtils.smoothstep(speed, CONFIG.walkSpeed * 1.1, CONFIG.runSpeed);
    const back = c.back * zoom * (1 + 0.12 * runF), up = c.up * Math.pow(zoom, 0.8);
    this.desired.set(girlPos.x - Math.sin(yaw) * back, girlPos.y + up, girlPos.z - Math.cos(yaw) * back);
    const minY = heightAt(this.desired.x, this.desired.z) + 0.55;
    if (this.desired.y < minY) this.desired.y = minY;
    // The frame leads her a little in the direction she is going, so she walks into
    // space rather than sitting dead centre with the meadow scrolling past.
    this.lookT.set(girlPos.x + girlVel.x * c.lookAhead, girlPos.y + c.lookUp * Math.pow(zoom, 0.3), girlPos.z + girlVel.z * c.lookAhead);

    if (this.first) { this.posD.set(this.desired); this.lookD.set(this.lookT); this.first = false; }
    this.posD.to(this.desired, c.posSmooth, dt, this.pos);
    this.lookD.to(this.lookT, c.lookSmooth, dt, this.look);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    const fov = this.fovD.to(c.fov + c.runFov * runF, 0.5, dt);
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
}
