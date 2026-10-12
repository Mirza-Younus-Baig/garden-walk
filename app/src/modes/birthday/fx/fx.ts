import * as THREE from 'three';
import { sparkleSprite } from '../room/textures';

/**
 * Confetti and sparkles.
 *
 * Confetti is one instanced mesh of paper rectangles with a little physics: gravity, air
 * drag that is stronger face-on (so each piece flutters and drifts rather than drops),
 * tumbling, and landing flat on the floor, the table or the sofa, where it stays.
 */

export interface Surface { minX: number; maxX: number; minZ: number; maxZ: number; y: number }

const COLORS = ['#f6a6bf', '#ffd59e', '#a8dcc9', '#c7b3f2', '#9fcdf2', '#ffffff', '#f2c14e', '#ef8fa0'];

export class Confetti {
  mesh: THREE.InstancedMesh;
  private N: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private rot: Float32Array;     // euler x, y, z
  private spin: Float32Array;
  private state: Uint8Array;     // 0 idle, 1 flying, 2 landed, 3 being swept away
  private fade: Float32Array;    // scale while being swept away
  private head = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3(1, 1, 1);
  private p = new THREE.Vector3();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(private surfaces: Surface[], n = 2000) {
    this.N = n;
    const geo = new THREE.PlaneGeometry(0.02, 0.03);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.mesh.setMatrixAt(i, this.hidden);
      c.set(COLORS[i % COLORS.length]);
      this.mesh.setColorAt(i, c);
    }
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3); this.spin = new Float32Array(n * 3);
    this.state = new Uint8Array(n);
    this.fade = new Float32Array(n);
  }

  /** a burst from `origin` along `dir` (a cone), `count` pieces at `speed` m/s */
  burst(origin: THREE.Vector3, dir: THREE.Vector3, count: number, speed: number, cone = 0.6) {
    const d = dir.clone().normalize();
    const t1 = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const t2 = new THREE.Vector3().crossVectors(d, t1);
    for (let k = 0; k < count; k++) {
      const i = this.head; this.head = (this.head + 1) % this.N;
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * cone;
      const v = d.clone().addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize().multiplyScalar(speed * (0.55 + Math.random() * 0.6));
      this.pos.set([origin.x, origin.y, origin.z], i * 3);
      this.vel.set([v.x, v.y, v.z], i * 3);
      this.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
      this.spin.set([(Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 16], i * 3);
      this.state[i] = 1;
    }
  }

  /** a gentle rain over an area, from just under the ceiling */
  rain(cx: number, cz: number, radius: number, y: number, count: number) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      this.burst(new THREE.Vector3(cx + Math.cos(a) * r, y - Math.random() * 0.4, cz + Math.sin(a) * r), new THREE.Vector3(0, -1, 0), 1, 0.3, 1.2);
    }
  }

  /** sweep it all away (fades by shrinking) */
  clear() { for (let i = 0; i < this.N; i++) if (this.state[i]) { this.state[i] = 3; this.fade[i] = 1; } }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < this.N; i++) {
      const st = this.state[i];
      if (st === 0) continue;
      any = true;
      const o = i * 3;
      if (st === 3) {
        // being cleared: shrink away
        this.rot[o + 1] += dt * 4;
        this.fade[i] -= dt * 1.5;
        if (this.fade[i] <= 0) { this.state[i] = 0; this.mesh.setMatrixAt(i, this.hidden); continue; }
        this.s.setScalar(this.fade[i]);
      } else if (st === 1) {
        // flutter: face-on drag depends on how the piece is tilted, and lift sends it sideways
        const tilt = Math.abs(Math.cos(this.rot[o]) * Math.cos(this.rot[o + 2]));
        const drag = 1.2 + 6 * tilt;
        this.vel[o + 1] -= 9.8 * dt;
        for (let k = 0; k < 3; k++) this.vel[o + k] *= Math.exp(-drag * dt * (k === 1 ? 1 : 0.6));
        const terminal = -0.45 - 0.5 * (1 - tilt);
        if (this.vel[o + 1] < terminal) this.vel[o + 1] = terminal;
        this.vel[o] += Math.sin(this.rot[o] * 2) * 0.6 * dt;
        this.vel[o + 2] += Math.cos(this.rot[o + 2] * 2) * 0.6 * dt;
        for (let k = 0; k < 3; k++) { this.pos[o + k] += this.vel[o + k] * dt; this.rot[o + k] += this.spin[o + k] * dt; }
        // land on whatever is under it
        const x = this.pos[o], z = this.pos[o + 2];
        let floor = 0.003;
        for (const s of this.surfaces) if (x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ && this.pos[o + 1] > s.y - 0.05) floor = Math.max(floor, s.y + 0.003);
        if (this.pos[o + 1] <= floor) {
          this.pos[o + 1] = floor + Math.random() * 0.001;
          this.rot[o] = -Math.PI / 2 + (Math.random() - 0.5) * 0.2; this.rot[o + 2] = (Math.random() - 0.5) * 0.2;
          this.state[i] = 2;
        }
        this.s.setScalar(1);
      } else {
        this.s.setScalar(1);
      }
      this.e.set(this.rot[o], this.rot[o + 1], this.rot[o + 2]);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** twinkling star sparkles that pop out of a point and fade */
export class Sparkles {
  points: THREE.Points;
  private N = 260;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private head = 0;

  constructor() {
    const N = this.N;
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.life = new Float32Array(N).fill(-1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('life', new THREE.BufferAttribute(new Float32Array(N).fill(-1), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: sparkleSprite(64) }, uScale: { value: 1 } },
      vertexShader: /* glsl */`
        attribute float life; uniform float uScale; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = life < 0.0 ? 0.0 : sin(clamp(life, 0.0, 1.0) * 3.14159);
          gl_PointSize = life < 0.0 ? 0.0 : uScale * 60.0 * (0.6 + 0.4 * sin(life * 20.0)) / -mv.z;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying float vA;
        void main() { vec4 c = texture2D(map, gl_PointCoord); gl_FragColor = vec4(c.rgb * vec3(1.8, 1.6, 1.3), c.a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
  }

  setScale(px: number) { (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = px; }

  emit(p: THREE.Vector3, count: number, speed = 0.5, spread = 0.05) {
    for (let k = 0; k < count; k++) {
      const i = this.head; this.head = (this.head + 1) % this.N;
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      this.pos.set([p.x + (Math.random() - 0.5) * spread, p.y + (Math.random() - 0.5) * spread, p.z + (Math.random() - 0.5) * spread], i * 3);
      this.vel.set([v.x, v.y, v.z], i * 3);
      this.life[i] = -Math.random() * 0.3;        // a short stagger before each appears
    }
  }

  update(dt: number) {
    const lifeA = this.points.geometry.getAttribute('life') as THREE.BufferAttribute;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] === -1) continue;
      this.life[i] += dt / 1.4;
      if (this.life[i] >= 1) { this.life[i] = -1; lifeA.setX(i, -1); continue; }
      const o = i * 3;
      this.vel[o + 1] -= 0.25 * dt;
      for (let k = 0; k < 3; k++) { this.vel[o + k] *= 1 - 1.8 * dt; this.pos[o + k] += this.vel[o + k] * dt; }
      lifeA.setX(i, this.life[i]);            // negative while staggered: drawn at size 0
    }
    lifeA.needsUpdate = true;
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
