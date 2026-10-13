import * as THREE from 'three';
import { CAMERA, ROOM } from './config';

/**
 * Third-person camera for a room: it follows her on critically damped springs, swings in
 * behind her as she walks, can be dragged round, never leaves the room, and can hand over
 * smoothly to a framed "shot" for a moment (the candles, the sofa, the window).
 */

/** critically damped spring toward a target (SmoothDamp) */
class Damped {
  v = 0;
  constructor(public x = 0) {}
  to(target: number, smoothTime: number, dt: number) {
    const omega = 2 / Math.max(1e-4, smoothTime), e = omega * dt;
    const decay = 1 / (1 + e + 0.48 * e * e + 0.235 * e * e * e);
    const change = this.x - target, temp = (this.v + omega * change) * dt;
    this.v = (this.v - omega * temp) * decay;
    this.x = target + (change + temp) * decay;
    return this.x;
  }
  snap(x: number) { this.x = x; this.v = 0; }
}
class DampedAngle extends Damped {
  to(target: number, smoothTime: number, dt: number) {
    const d = Math.atan2(Math.sin(target - this.x), Math.cos(target - this.x));
    return super.to(this.x + d, smoothTime, dt);
  }
}
class DampedV3 {
  x = new Damped(); y = new Damped(); z = new Damped();
  to(t: THREE.Vector3, s: number, dt: number, out: THREE.Vector3) { return out.set(this.x.to(t.x, s, dt), this.y.to(t.y, s, dt), this.z.to(t.z, s, dt)); }
  snap(t: THREE.Vector3) { this.x.snap(t.x); this.y.snap(t.y); this.z.snap(t.z); }
}

export interface Shot { pos: THREE.Vector3; look: THREE.Vector3; fov?: number }

const smoother = (k: number) => k * k * k * (k * (k * 6 - 15) + 10);

export class RoomCamera {
  camera: THREE.PerspectiveCamera;
  /** where the camera sits round her: 0 = on her +z side looking toward -z */
  private yaw = new DampedAngle(0);
  private yawTarget = 0;
  private dist = new Damped(CAMERA.dist);
  distTarget: number = CAMERA.dist;
  private height = new Damped(CAMERA.height);
  heightOffset = 0;
  private pos = new DampedV3();
  private look = new DampedV3();
  private fov = new Damped(CAMERA.fov);
  private lastDrag = -10;
  private first = true;
  private shot: Shot | null = null;
  private shotW = 0;
  private shotDir = 0;          // +1 blending in, -1 out
  private shotDur = 1.2;
  private _p = new THREE.Vector3();
  private _l = new THREE.Vector3();
  private _sp = new THREE.Vector3();
  private _sl = new THREE.Vector3();
  time = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.05, 30);
  }

  /** start looking from a given side */
  setYaw(y: number) { this.yawTarget = y; this.yaw.snap(y); }

  /** drag: dx, dy in pixels */
  drag(dx: number, dy: number) {
    this.yawTarget -= dx * 0.006;
    this.heightOffset = THREE.MathUtils.clamp(this.heightOffset + dy * 0.004, -0.6, 0.9);
    this.lastDrag = this.time;
  }

  zoom(dy: number) {
    this.distTarget = THREE.MathUtils.clamp(this.distTarget * Math.exp(dy * 0.0011), CAMERA.minDist, CAMERA.maxDist);
  }

  /** hand over to a framed view, blending over `dur` seconds */
  setShot(s: Shot, dur = 1.3) { this.shot = s; this.shotDir = 1; this.shotDur = dur; }
  clearShot(dur = 1.2) { if (this.shot) { this.shotDir = -1; this.shotDur = dur; } }
  get inShot() { return this.shot !== null && this.shotW > 0.5; }

  update(dt: number, target: THREE.Vector3, herYaw: number, moving: boolean) {
    this.time += dt;
    // swing in behind her as she walks, unless the camera was just dragged
    if (moving && this.time - this.lastDrag > 2.5) {
      const behind = herYaw + Math.PI;
      // only steer part of the way, and only while she heads away from the lens: walking
      // toward the camera should show her face, not spin the view round
      const d = Math.atan2(Math.sin(behind - this.yawTarget), Math.cos(behind - this.yawTarget));
      if (Math.abs(d) < 2.2) this.yawTarget += d * Math.min(1, dt * 0.9);
    }
    const yaw = this.yaw.to(this.yawTarget, CAMERA.yawSmooth, dt);
    const dist = this.dist.to(this.distTarget, 0.25, dt);
    const h = this.height.to(CAMERA.height + this.heightOffset + (dist - CAMERA.dist) * 0.25, 0.3, dt);
    // desired follow position
    this._p.set(target.x + Math.sin(yaw) * dist, target.y + h, target.z + Math.cos(yaw) * dist);
    this.clampToRoom(this._p);
    this._l.set(target.x, target.y + CAMERA.lookUp, target.z);
    if (this.first) { this.pos.snap(this._p); this.look.snap(this._l); this.first = false; }
    const p = this.pos.to(this._p, CAMERA.posSmooth, dt, this._p);
    const l = this.look.to(this._l, CAMERA.lookSmooth, dt, this._l);
    // blend toward the shot
    if (this.shot) {
      this.shotW = THREE.MathUtils.clamp(this.shotW + this.shotDir * dt / this.shotDur, 0, 1);
      const k = smoother(this.shotW);
      this._sp.copy(this.shot.pos); this._sl.copy(this.shot.look);
      p.lerp(this._sp, k); l.lerp(this._sl, k);
      this.fov.to(THREE.MathUtils.lerp(CAMERA.fov, this.shot.fov ?? CAMERA.fov, k), 0.3, dt);
      if (this.shotDir < 0 && this.shotW === 0) this.shot = null;
    } else this.fov.to(CAMERA.fov, 0.4, dt);
    this.camera.position.copy(p);
    this.camera.lookAt(l);
    if (Math.abs(this.camera.fov - this.fov.x) > 1e-3) { this.camera.fov = this.fov.x; this.camera.updateProjectionMatrix(); }
  }

  private clampToRoom(p: THREE.Vector3) {
    const pad = CAMERA.wallPad;
    p.x = THREE.MathUtils.clamp(p.x, ROOM.minX + pad, ROOM.maxX - pad);
    p.z = THREE.MathUtils.clamp(p.z, ROOM.minZ + pad, ROOM.maxZ - pad);
    p.y = THREE.MathUtils.clamp(p.y, 0.5, ROOM.height - 0.25);
  }
}
