import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CONFIG } from '../config';
import { heightAt } from '../world/ground';

export class Girl {
  root = new THREE.Group();
  pos = new THREE.Vector3(0, 0, 0);
  vel = new THREE.Vector3();
  yaw = Math.PI;            // facing +z at start (towards the camera side... camera sits behind her at +z looking -z)
  target: THREE.Vector3 | null = null;
  /** Camera-relative walk direction in world space, refreshed each frame from the keyboard. */
  moveDir = new THREE.Vector3();
  running = false;
  /**
   * The night halo. Sits just above her head so it rims her shoulders and hair as well as
   * pooling on the flowers she is standing in. Intensity is driven from the render loop off
   * the day/night cycle, and is zero while it is light.
   */
  halo = new THREE.PointLight(0xcfe0ff, 0, 6.5, 2.0);
  speed = 0;
  moveFactor = 0;           // 0 idle .. 1 walking, ramps over ~0.2s
  private mixer!: THREE.AnimationMixer;
  private idle!: THREE.AnimationAction;
  private walk!: THREE.AnimationAction;
  private model!: THREE.Object3D;

  constructor(private loader: GLTFLoader) { this.root.name = 'girl'; }

  async load() {
    const gltf = await this.loader.loadAsync('/models/girl.glb');
    this.model = gltf.scene;
    this.model.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        const m = o.material as THREE.MeshStandardMaterial;
        m.envMapIntensity = 0.6;
        if (m.name === 'GirlHair') { m.side = THREE.DoubleSide; }
      }
    });
    // the rig already faces +z, which is what yaw=0 means here, so no correction
    this.halo.position.set(0, 1.72, 0);
    this.root.add(this.halo);
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    const idleClip = gltf.animations.find(a => a.name === 'idle')!;
    const walkClip = gltf.animations.find(a => a.name === 'walk')!;
    this.idle = this.mixer.clipAction(idleClip); this.walk = this.mixer.clipAction(walkClip);
    this.idle.play(); this.walk.play(); this.walk.setEffectiveWeight(0);
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
  }

  setTarget(p: THREE.Vector3) { this.target = p.clone(); }

  /** Keyboard steering. Passing a zero vector lets her decelerate to a stop. */
  setMoveDir(x: number, z: number, run = false) {
    this.moveDir.set(x, 0, z);
    this.running = run;
    if (this.moveDir.lengthSq() > 1e-6) this.target = null;
  }

  update(dt: number) {
    // ---- locomotion
    let desired = 0; let dir = new THREE.Vector3();
    if (this.moveDir.lengthSq() > 1e-6) {
      // Held key: full speed along the requested direction. The accel/decel ramp below
      // still applies, so starts and stops keep their weight.
      dir.copy(this.moveDir).normalize();
      const top = this.running ? CONFIG.runSpeed : CONFIG.walkSpeed;
      desired = top * Math.min(1, this.moveDir.length());
    } else if (this.target) {
      dir.subVectors(this.target, this.pos); dir.y = 0;
      const dist = dir.length();
      if (dist < CONFIG.arriveRadius) { this.target = null; }
      else {
        dir.divideScalar(dist);
        // slow down on approach so she stops without sliding
        desired = Math.min(CONFIG.walkSpeed, Math.sqrt(2 * CONFIG.decel * Math.max(dist - CONFIG.arriveRadius * 0.5, 0)));
      }
    }
    const rate = desired > this.speed ? (this.running ? CONFIG.runAccel : CONFIG.accel) : CONFIG.decel;
    this.speed = THREE.MathUtils.damp(this.speed, desired, rate, dt);
    if (this.speed < 0.02 && desired === 0) this.speed = 0;
    if (desired > 0) {
      // face the movement direction smoothly
      const wantYaw = Math.atan2(dir.x, dir.z);
      let d = wantYaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, CONFIG.turnSpeed * dt);
    }
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.vel.copy(fwd).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;

    // ---- animation blend
    const walking = this.speed > 0.12;
    this.moveFactor = THREE.MathUtils.damp(this.moveFactor, walking ? 1 : 0, 9, dt);
    const w = THREE.MathUtils.clamp(this.speed / CONFIG.walkSpeed, 0, 1);
    const blend = THREE.MathUtils.smoothstep(w, 0.0, 0.5);
    this.walk.setEffectiveWeight(blend); this.idle.setEffectiveWeight(1 - blend);
    // stride length of the source clip is ~1.35 m per 0.958 s cycle -> scale playback so feet don't slide
    // The clip's own stride is ~1.4 m/s, so the ceiling has to clear a run or her feet
    // skate across the ground at speed.
    this.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(this.speed / 1.4, 0.5, 2.0));
    this.mixer.update(dt);
  }
}
