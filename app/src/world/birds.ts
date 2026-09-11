import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { heightAt } from './terrain';

/**
 * Birds in the sky. One instanced mesh of the Blender-built bird (models/bird.glb), flapped in
 * the vertex shader, driven by a few flocks that either cross the view or soar in circles.
 *
 * Sizing and placement are worked out from the camera rather than the world: the follow camera
 * looks a little downward, so the sky is only the top quarter of the frame, from the horizon up
 * to roughly 11 degrees above level at the default zoom. Flocks are spawned by bearing relative
 * to the camera and by elevation angle above it, so they land in that band rather than
 * overhead, and they are crow-sized (0.8-1.0 m wingspan) at 25-55 m, which puts them at
 * 20-60 px on a 1280-wide frame: readable as birds, but far away.
 */

const MAX_BIRDS = 40;
const DEG = Math.PI / 180;
/** seconds between one flock leaving and the next arriving */
const GAP = [4, 14] as const;
/** at most this many flocks in the air at once */
const MAX_FLOCKS = 3;
/** no birds take to the air once it is this dark (daylight 0..1) */
const MIN_DAYLIGHT = 0.18;

export const birdUniforms = { uTime: { value: 0 } };

interface Bird {
  /** position within the flock's frame: right, up, back */
  off: THREE.Vector3;
  scale: number;
  phase: number;
  freq: number;
  wobble: number;
  /** 1 flapping .. 0 gliding; eases toward `flapTarget` */
  flap: number;
  flapTarget: number;
  flapTimer: number;
}

type Kind = 'cross' | 'soar';

interface Flock {
  kind: Kind;
  birds: Bird[];
  pos: THREE.Vector3;
  heading: number;
  turnRate: number;
  speed: number;
  alt: number;
  age: number;
  life: number;
  bobPhase: number;
}

/** mulberry32: seedable, so `?birdseed=N` gives a repeatable sky for screenshots */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
const _p = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _camDir = new THREE.Vector3();

export class Birds {
  group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private flapAttr!: THREE.InstancedBufferAttribute;
  private flocks: Flock[] = [];
  private nextSpawn: number;
  private rand: () => number;
  private seeded: boolean;
  private enabled = !location.search.includes('nobirds');

  constructor(private loader: GLTFLoader) {
    this.group.name = 'birds';
    const seed = parseInt(new URLSearchParams(location.search).get('birdseed') ?? '', 10);
    this.seeded = !isNaN(seed);
    this.rand = this.seeded ? rng(seed) : Math.random;
    // the first flock is already in the air on a seeded run, so a screenshot can find it
    this.nextSpawn = this.seeded ? 0 : this.range(2, 6);
  }

  private range(a: number, b: number) { return a + (b - a) * this.rand(); }

  async load() {
    if (!this.enabled) return;
    const gltf = await this.loader.loadAsync('/models/bird.glb');
    let found: THREE.BufferGeometry | undefined;
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && !found) found = (o as THREE.Mesh).geometry; });
    if (!found) throw new Error('bird.glb has no mesh');
    const geometry: THREE.BufferGeometry = found;

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    });
    // Seen from below against a bright sky a bird is close to a silhouette; the HDRI would
    // otherwise light the underside up to a mid grey.
    material.envMapIntensity = 0.25;
    material.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = birdUniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          // per bird: phase, flap amplitude, angular frequency, dihedral (the resting V of a glide)
          attribute vec4 aFlap;`)
        // uv.x is the flap weight (0 body .. 1 wing tip), uv.y the side (0 left, 1 right, 0.5 body).
        // The wing is rotated about the body axis by an angle that grows toward the tip, which
        // bends it rather than swinging it as a plate, and the tip lags the stroke a little.
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          float fw = uv.x;
          float fs = uv.y * 2.0 - 1.0;
          float fang = 0.0;
          if (abs(fs) > 0.5) {
            float stroke = sin(uTime * aFlap.z + aFlap.x - 1.4 * fw);
            // the upstroke lifts the wing well above the shoulder, the downstroke goes less far
            fang = aFlap.y * (stroke * 0.55 + 0.22) + aFlap.w;
            fang *= (0.35 + 0.65 * fw) * fs;
          }
          float fc = cos(fang), fsn = sin(fang);
          mat2 flapRot = mat2(fc, fsn, -fsn, fc);
          objectNormal.xy = flapRot * objectNormal.xy;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          transformed.xy = flapRot * transformed.xy;`);
      // The sky dome is drawn without fog, so a bird fogged as heavily as the ground would
      // fade to a pale smudge against a clear sky. Half strength keeps a silhouette.
      sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `
        #ifdef USE_FOG
          float birdFog = smoothstep(fogNear, fogFar, vFogDepth) * 0.5;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, birdFog);
        #endif`);
    };

    const mesh = new THREE.InstancedMesh(geometry, material, MAX_BIRDS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.name = 'birds';
    this.flapAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 4), 4);
    this.flapAttr.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('aFlap', this.flapAttr);
    this.mesh = mesh;
    this.group.add(mesh);
  }

  get count() { return this.flocks.reduce((n, f) => n + f.birds.length, 0); }

  /**
   * Where a new flock goes, worked out from where the camera is looking. `bearing` is the
   * direction from the girl, `el` the elevation above the camera's horizontal at the
   * flock's nearest approach: both are chosen so the flock crosses the visible sky band.
   */
  private spawn(camera: THREE.Camera, girl: THREE.Vector3) {
    camera.getWorldDirection(_camDir);
    const camBearing = Math.atan2(_camDir.x, _camDir.z);
    const eye = camera.position.y;
    // elevation of the top of the frame above level: the camera's pitch plus half its
    // vertical field of view. The zoom tilts the camera, so this is what shrinks the band.
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 42;
    const top = Math.asin(_camDir.y) + fov * 0.5 * DEG;
    const elevation = (lo: number, hi: number) =>
      THREE.MathUtils.clamp(top * this.range(lo, hi), 1.8 * DEG, 7 * DEG);
    const kind: Kind = this.rand() < 0.3 ? 'soar' : 'cross';
    const flock: Flock = {
      kind, birds: [], pos: new THREE.Vector3(), heading: 0, turnRate: 0, speed: 0, alt: 0,
      age: 0, life: 0, bobPhase: this.range(0, Math.PI * 2),
    };

    if (kind === 'cross') {
      // enter from one side of the view, leave by the other, passing 22-42 m out
      const side = this.rand() < 0.5 ? -1 : 1;
      const b0 = camBearing + side * this.range(50, 80) * DEG;
      const b1 = camBearing - side * this.range(30, 70) * DEG;
      const r0 = this.range(28, 44), r1 = this.range(22, 40);
      const x0 = girl.x + Math.sin(b0) * r0, z0 = girl.z + Math.cos(b0) * r0;
      const x1 = girl.x + Math.sin(b1) * r1, z1 = girl.z + Math.cos(b1) * r1;
      flock.pos.set(x0, 0, z0);
      flock.heading = Math.atan2(x1 - x0, z1 - z0);
      flock.turnRate = this.range(-0.03, 0.03);
      flock.speed = this.range(7.5, 10);
      const near = Math.min(r0, r1) * 0.8;
      flock.alt = eye + near * Math.tan(elevation(0.22, 0.55));
      flock.life = 60;
      const n = this.rand() < 0.45 ? Math.round(this.range(2, 4)) : Math.round(this.range(5, 9));
      const vee = n >= 5 && this.rand() < 0.7;
      for (let i = 0; i < n; i++) {
        let off: THREE.Vector3;
        if (vee) {
          // a V: the k-th follower sits k ranks back on alternating arms, a little ragged
          const k = (i + 1) >> 1, arm = i === 0 ? 0 : (i % 2 ? -1 : 1);
          off = new THREE.Vector3(arm * k * this.range(1.3, 1.9), this.range(-0.5, 0.5) * 0.6, k * this.range(1.4, 2.0));
        } else {
          off = new THREE.Vector3(this.range(-4, 4), this.range(-1, 1), this.range(-4, 4));
        }
        flock.birds.push(this.makeBird(off, this.range(0.86, 1.04), 1));
      }
    } else {
      // circle ahead of the camera, 16-26 m across, gliding, a little higher than the crossers
      const centreBearing = camBearing + this.range(-35, 35) * DEG;
      const r = this.range(28, 40);
      const radius = this.range(8, 13);
      const cx = girl.x + Math.sin(centreBearing) * r, cz = girl.z + Math.cos(centreBearing) * r;
      const a0 = this.range(0, Math.PI * 2);
      const dir = this.rand() < 0.5 ? -1 : 1;
      flock.pos.set(cx + Math.sin(a0) * radius, 0, cz + Math.cos(a0) * radius);
      flock.speed = this.range(5.5, 7);
      flock.turnRate = dir * flock.speed / radius;
      flock.heading = a0 + dir * Math.PI / 2;
      flock.alt = eye + (r - radius) * Math.tan(elevation(0.35, 0.65));
      flock.life = this.range(35, 70);
      const n = Math.round(this.range(1, 3));
      for (let i = 0; i < n; i++) {
        const off = new THREE.Vector3(this.range(-3, 3), this.range(-1.5, 1.5), this.range(-3, 3));
        flock.birds.push(this.makeBird(off, this.range(0.85, 1.05), 0));
      }
    }
    flock.alt = Math.max(flock.alt, heightAt(flock.pos.x, flock.pos.z) + 3);
    this.flocks.push(flock);
  }

  private makeBird(off: THREE.Vector3, scale: number, flapTarget: number): Bird {
    return {
      off, scale, phase: this.range(0, Math.PI * 2), freq: this.range(3.0, 4.0) * Math.PI * 2,
      wobble: this.range(0, Math.PI * 2), flap: flapTarget, flapTarget, flapTimer: this.range(1, 5),
    };
  }

  update(dt: number, t: number, camera: THREE.Camera, girl: THREE.Vector3, daylight: number) {
    const mesh = this.mesh;
    if (!mesh) return;
    birdUniforms.uTime.value = t;

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0 && this.flocks.length < MAX_FLOCKS && this.count < MAX_BIRDS - 9 && daylight > MIN_DAYLIGHT) {
      this.spawn(camera, girl);
      this.nextSpawn = this.range(GAP[0], GAP[1]);
    }

    const flap = this.flapAttr.array as Float32Array;
    let n = 0;
    for (let fi = this.flocks.length - 1; fi >= 0; fi--) {
      const f = this.flocks[fi];
      f.age += dt;
      if (f.kind === 'soar' && f.age > f.life) {
        // done circling: straighten out and fly off, which the distance check then ends
        f.kind = 'cross'; f.turnRate = 0; f.speed = 8.5; f.life = f.age + 40;
        for (const b of f.birds) { b.flapTarget = 1; b.flapTimer = this.range(2, 5); }
      }
      f.heading += f.turnRate * dt;
      f.pos.x += Math.sin(f.heading) * f.speed * dt;
      f.pos.z += Math.cos(f.heading) * f.speed * dt;
      const bob = Math.sin(t * 0.35 + f.bobPhase) * 0.6;
      f.pos.y += (f.alt + bob - f.pos.y) * Math.min(1, dt * 0.6);
      if (f.age < dt * 2) f.pos.y = f.alt;
      const dist = Math.hypot(f.pos.x - girl.x, f.pos.z - girl.z);
      if (dist > 80 || f.age > f.life) { this.flocks.splice(fi, 1); continue; }

      _fwd.set(Math.sin(f.heading), 0, Math.cos(f.heading));
      _right.set(_fwd.z, 0, -_fwd.x);
      // banked into the turn, as a glider is
      const bank = Math.atan(f.speed * f.turnRate / 9.81) * 1.4;
      _up.set(0, 1, 0);
      if (bank !== 0) {
        _q.setFromAxisAngle(_fwd, -bank);
        _right.applyQuaternion(_q); _up.applyQuaternion(_q);
      }

      for (const b of f.birds) {
        if (n >= MAX_BIRDS) break;
        // flap in bouts, glide in between
        b.flapTimer -= dt;
        if (b.flapTimer <= 0) {
          const soaring = f.kind === 'soar';
          b.flapTarget = b.flapTarget > 0.5 ? 0 : 1;
          b.flapTimer = b.flapTarget > 0.5
            ? (soaring ? this.range(0.6, 1.6) : this.range(2, 6))
            : (soaring ? this.range(4, 11) : this.range(0.8, 2.5));
        }
        b.flap += (b.flapTarget - b.flap) * Math.min(1, dt * 3.5);

        _p.copy(f.pos)
          .addScaledVector(_right, b.off.x)
          .addScaledVector(_up, b.off.y + 0.3 * Math.sin(t * 1.1 + b.wobble))
          .addScaledVector(_fwd, -b.off.z + 0.15 * Math.sin(t * 0.7 + b.wobble * 2));
        // the model flies along its local -Z, so the basis is (right, up, back)
        _m.makeBasis(_right, _up, _s.copy(_fwd).negate());
        _m.scale(_s.set(b.scale, b.scale, b.scale));
        _m.setPosition(_p);
        mesh.setMatrixAt(n, _m);
        const o = n * 4;
        flap[o] = b.phase;
        flap[o + 1] = 1.25 * b.flap;
        flap[o + 2] = b.freq;
        flap[o + 3] = 0.05 + 0.20 * (1 - b.flap);
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this.flapAttr.needsUpdate = true;
  }
}
