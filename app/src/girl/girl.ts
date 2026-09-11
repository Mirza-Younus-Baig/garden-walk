import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CONFIG } from '../config';
import { heightAt } from '../world/ground';
import { SpringRig, type ChainDef, type RingDef, type SpringParams } from './springs';
import { fitSkirt, type SkirtFit } from './skirt';

/** where she touches the flowers: fed to the field every frame, in world space */
export interface Contacts {
  ankleL: THREE.Vector3; ankleR: THREE.Vector3;
  kneeL: THREE.Vector3; kneeR: THREE.Vector3;
  hips: THREE.Vector3;
}

// Long hair swings; the short strands over the crown and the fringe only stir.
const HAIR: SpringParams = { omega: 19, zeta: 0.45, air: 1.1, gravity: 2.5, radius: 0.018, falloff: 0.85, maxAngle: 0.8 };
const CROWN: SpringParams = { omega: 30, zeta: 0.55, air: 0.6, gravity: 1.0, radius: 0.012, falloff: 0.85, maxAngle: 0.35 };
const FRINGE: SpringParams = { omega: 40, zeta: 0.6, air: 0.5, gravity: 0.6, radius: 0.01, maxAngle: 0.2 };
const SKIRT: SpringParams = { omega: 26, zeta: 0.5, air: 2.2, gravity: 4.0, radius: 0.015, falloff: 0.9, maxAngle: 0.75 };
const TIE: SpringParams = { omega: 18, zeta: 0.4, air: 1.6, gravity: 3.5, radius: 0.012, falloff: 0.85, maxAngle: 0.5 };

/** body volumes the loose parts are kept out of; offsets are in her own frame */
const HEAD = { bone: 'Head_M', off: [0, 0.075, 0.005] as [number, number, number], r: 0.105 };
const SHOULDERS = { bone: 'Shoulder_L', off: [0, -0.02, 0] as [number, number, number], r: 0.085, bone2: 'Shoulder_R', off2: [0, -0.02, 0] as [number, number, number] };
const CHEST = { bone: 'Chest_M', off: [0, 0.04, 0.035] as [number, number, number], r: 0.105 };
const THIGH_L = { bone: 'Hip_L', off: [0, 0, 0] as [number, number, number], r: 0.078, bone2: 'Knee_L', off2: [0, 0, 0] as [number, number, number] };
const THIGH_R = { bone: 'Hip_R', off: [0, 0, 0] as [number, number, number], r: 0.078, bone2: 'Knee_R', off2: [0, 0, 0] as [number, number, number] };

const CHAINS: ChainDef[] = [
  { bones: ['HairBK_M', 'HairBK1_M', 'HairBK2_M'], params: HAIR, colliders: [HEAD, SHOULDERS], tipLength: 0.1 },
  { bones: ['HairBL_L', 'HairBL1_L', 'HairBL2_L'], params: HAIR, colliders: [HEAD, SHOULDERS], tipLength: 0.1 },
  { bones: ['HairBR_R', 'HairBR1_R', 'HairBR2_R'], params: HAIR, colliders: [HEAD, SHOULDERS], tipLength: 0.1 },
  { bones: ['HairML_L', 'HairML1_L', 'HairML2_L'], params: CROWN, colliders: [HEAD, SHOULDERS], tipLength: 0.07 },
  { bones: ['HairMR_R', 'HairMR1_R', 'HairMR2_R'], params: CROWN, colliders: [HEAD, SHOULDERS], tipLength: 0.07 },
  { bones: ['HairSL_L', 'HairSL1_L', 'HairSL2_L'], params: CROWN, colliders: [HEAD], tipLength: 0.07 },
  { bones: ['HairSR_R', 'HairSR1_R', 'HairSR2_R'], params: CROWN, colliders: [HEAD], tipLength: 0.07 },
  { bones: ['HairFL_L'], params: FRINGE, colliders: [HEAD], tipLength: 0.06 },
  { bones: ['HairFM_R'], params: FRINGE, colliders: [HEAD], tipLength: 0.06 },
  { bones: ['HairFR_R'], params: FRINGE, colliders: [HEAD], tipLength: 0.06 },
  { bones: ['dynSkirtF_L', 'dynSkirtF1_L'], params: SKIRT, colliders: [THIGH_L, THIGH_R], tipLength: 0.09 },
  { bones: ['dynSkirtF_R', 'dynSkirtF1_R'], params: SKIRT, colliders: [THIGH_L, THIGH_R], tipLength: 0.09 },
  { bones: ['dynSkirtM_L', 'dynSkirtM1_L'], params: SKIRT, colliders: [THIGH_L], tipLength: 0.09 },
  { bones: ['dynSkirtM_R', 'dynSkirtM1_R'], params: SKIRT, colliders: [THIGH_R], tipLength: 0.09 },
  { bones: ['dynSkirtB_L', 'dynSkirtB1_L'], params: SKIRT, colliders: [THIGH_L], tipLength: 0.09 },
  { bones: ['dynSkirtB_R', 'dynSkirtB1_R'], params: SKIRT, colliders: [THIGH_R], tipLength: 0.09 },
  { bones: ['dynSkirtBK_M', 'dynSkirtBK1_R'], params: SKIRT, colliders: [THIGH_L, THIGH_R], tipLength: 0.09 },
  { bones: ['dynTie1_M', 'dynTie2_M', 'dynTie3_L'], params: TIE, colliders: [CHEST], tipLength: 0.08 },
];

/**
 * The skirt panels, in order round her from front left to front right. Linked, they move as
 * one piece of cloth: neighbours may fold together into the pleats but may only drift a
 * little further apart than they hang when she stands. Off with ?noskirtring.
 */
const SKIRT_RING: RingDef = {
  chains: ['dynSkirtF_L', 'dynSkirtM_L', 'dynSkirtB_L', 'dynSkirtBK_M', 'dynSkirtB_R', 'dynSkirtM_R', 'dynSkirtF_R'],
  stretch: 1.12, compress: 0.5,
};

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _pInv = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** turn a bone by a world-space rotation, leaving its children to follow */
function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  _m.copy(bone.parent!.matrixWorld).decompose(_v, _pq, _s);
  _pInv.copy(_pq).invert();
  bone.quaternion.premultiply(_pq).premultiply(q).premultiply(_pInv);
}

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
  /** rad/s she is turning at, smoothed: drives the lean */
  yawRate = 0;
  contacts: Contacts = {
    ankleL: new THREE.Vector3(), ankleR: new THREE.Vector3(),
    kneeL: new THREE.Vector3(), kneeR: new THREE.Vector3(), hips: new THREE.Vector3(),
  };
  private mixer!: THREE.AnimationMixer;
  private idle!: THREE.AnimationAction;
  private walk!: THREE.AnimationAction;
  private model!: THREE.Object3D;
  springs: SpringRig | null = null;
  /** keeps her thighs and hips from showing through the skirt; off with ?noskirtfix */
  skirtFit: SkirtFit | null = null;
  private bones!: { spine: THREE.Object3D; chest: THREE.Object3D; head: THREE.Object3D;
                    ankleL: THREE.Object3D; ankleR: THREE.Object3D; kneeL: THREE.Object3D; kneeR: THREE.Object3D; hips: THREE.Object3D };
  private accel = 0;
  private lean = { roll: 0, pitch: 0, headYaw: 0 };
  private prevSpeed = 0;
  private wantYaw = Math.PI;

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
    const bone = (n: string) => {
      const b = this.model.getObjectByName(n);
      if (!b) throw new Error(`girl: missing bone ${n}`);
      return b;
    };
    this.bones = {
      spine: bone('Spine1_M'), chest: bone('Chest_M'), head: bone('Head_M'),
      ankleL: bone('Ankle_L'), ankleR: bone('Ankle_R'), kneeL: bone('Knee_L'), kneeR: bone('Knee_R'), hips: bone('Root_M'),
    };
    if (!location.search.includes('nosprings')) {
      this.springs = new SpringRig(this.root, this.model, CHAINS, location.search.includes('noskirtring') ? [] : [SKIRT_RING]);
    }
    if (!location.search.includes('noskirtfix')) this.skirtFit = fitSkirt(this.model);
    this.root.updateMatrixWorld(true);
    this.readContacts();
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
    let desired = 0; const dir = _v.set(0, 0, 0);
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
    let d = 0;
    if (desired > 0) {
      this.wantYaw = Math.atan2(dir.x, dir.z);
      d = this.wantYaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      // A reversal is a pivot, not an arc: the further she has to turn, the more she
      // slows to do it, and picks the pace back up once she is facing the way she is
      // going. A gentle steer barely slows her at all.
      desired *= 1 - CONFIG.turnSlow * THREE.MathUtils.smoothstep(Math.abs(d), 0.35, 2.4);
    }
    const rate = desired > this.speed ? (this.running ? CONFIG.runAccel : CONFIG.accel) : CONFIG.decel;
    this.speed = THREE.MathUtils.damp(this.speed, desired, rate, dt);
    if (this.speed < 0.02 && desired === 0) this.speed = 0;
    let turned = 0;
    if (desired > 0) {
      // face the movement direction: exponential close in, capped so a reversal takes a
      // believable fraction of a second rather than snapping round
      const cap = CONFIG.turnMax * dt;
      turned = THREE.MathUtils.clamp(d * Math.min(1, CONFIG.turnSpeed * dt), -cap, cap);
      this.yaw += turned;
    }
    this.yawRate = THREE.MathUtils.damp(this.yawRate, dt > 0 ? turned / dt : 0, 12, dt);
    this.accel = THREE.MathUtils.damp(this.accel, dt > 0 ? (this.speed - this.prevSpeed) / dt : 0, 8, dt);
    this.prevSpeed = this.speed;
    const fwd = _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
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
    this.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(this.speed / 1.4, 0.6, 2.0));
    this.springs?.preAnimate();
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);

    // ---- procedural layer on top of the clips
    // Lean: into a turn, and forward when she pushes off or brakes. The legs stay
    // planted and the upper body does the leaning, which is what a pivot looks like.
    const lean = this.lean;
    const speedF = Math.min(1, this.speed / CONFIG.walkSpeed);
    lean.roll = THREE.MathUtils.damp(lean.roll, THREE.MathUtils.clamp(-this.yawRate * speedF * 0.045, -0.16, 0.16), 10, dt);
    lean.pitch = THREE.MathUtils.damp(lean.pitch, THREE.MathUtils.clamp(this.accel * 0.03 + speedF * speedF * 0.03, -0.12, 0.14), 8, dt);
    // the head leads the turn: it looks where she is about to go
    const headWant = desired > 0 ? THREE.MathUtils.clamp(d * 0.6, -0.7, 0.7) : 0;
    lean.headYaw = THREE.MathUtils.damp(lean.headYaw, headWant, 9, dt);
    if (Math.abs(lean.roll) + Math.abs(lean.pitch) > 1e-4) {
      // roll about her forward axis, pitch about her sideways axis, both in world space
      _q.setFromAxisAngle(fwd, lean.roll);
      rotateWorld(this.bones.spine, _q);
      _q.setFromAxisAngle(_side.set(fwd.z, 0, -fwd.x), lean.pitch);
      rotateWorld(this.bones.spine, _q);
      this.bones.spine.updateMatrixWorld(true);
    }
    if (Math.abs(lean.headYaw) > 1e-4) {
      _q.setFromAxisAngle(UP, lean.headYaw);
      rotateWorld(this.bones.head, _q);
      this.bones.head.updateMatrixWorld(true);
    }
    this.springs?.update(dt);
    // after the springs, which place the panels it corrects
    this.skirtFit?.update();
    this.readContacts();
  }

  private readContacts() {
    const c = this.contacts, b = this.bones;
    b.ankleL.getWorldPosition(c.ankleL); b.ankleR.getWorldPosition(c.ankleR);
    b.kneeL.getWorldPosition(c.kneeL); b.kneeR.getWorldPosition(c.kneeR);
    b.hips.getWorldPosition(c.hips);
  }
}
