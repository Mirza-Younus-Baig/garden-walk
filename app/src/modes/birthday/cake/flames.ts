import * as THREE from 'three';
import { glowSprite } from '../room/textures';

/**
 * Candle flames, their light, the breath that blows them out, and the smoke after.
 *
 * Each flame is a camera-facing quad (turning about the vertical only, as a real flame
 * does) drawn by a shader: a teardrop whose edge is stirred by scrolling noise, white-hot
 * at the core, yellow then orange to the tip, with the faint blue skirt at the base. It
 * bends and stretches with the air around it (`bend`), so a breath visibly pushes it over
 * before it goes out. Values above 1 feed the bloom.
 *
 * One point light stands for all of them, its brightness the sum of the lit flames with a
 * shared flicker, so the room dims candle by candle as she blows.
 */

const VERT = /* glsl */`
  uniform vec2 uBend;        // sideways push (in the flame's screen plane) and stretch
  uniform float uSize;       // 0 (out) .. 1 (full)
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // cylindrical billboard: the quad's x follows the camera's right, its y stays up
    vec3 centre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCam = cameraPosition - centre; toCam.y = 0.0;
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam + vec3(1e-5, 0.0, 0.0))));
    float h = uv.y;
    float flick = 1.0 + 0.06 * sin(uTime * 23.0 + uSeed * 17.0) + 0.04 * sin(uTime * 37.0 + uSeed * 5.0);
    float stretch = (1.0 + uBend.y) * flick;
    vec3 p = centre
      + right * (position.x * uSize * (1.0 - 0.3 * abs(uBend.x)) + uBend.x * h * h * 0.03)
      + vec3(0.0, 1.0, 0.0) * (position.y * uSize * stretch);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const FRAG = /* glsl */`
  uniform float uTime;
  uniform float uSeed;
  uniform float uSize;
  uniform float uFlutter;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec2 uv = vUv;
    float y = uv.y;                       // 0 at the wick, 1 at the tip
    float t = uTime * (1.6 + uFlutter * 4.0) + uSeed * 10.0;
    // wobble the outline: more toward the tip, much more when the air is moving
    float n = noise(vec2(uv.x * 3.0, y * 4.0 - t)) - 0.5;
    float x = (uv.x - 0.5) * 2.0 + n * (0.15 + 0.6 * uFlutter) * y * y;
    // teardrop: round at the bottom, pointed at the top
    float width = pow(clamp(y * 1.25, 0.0, 1.0), 0.5) * pow(1.0 - y, 0.85) * 1.45;
    float d = abs(x) / max(width, 1e-3);
    float body = smoothstep(1.0, 0.55, d) * smoothstep(0.0, 0.08, y);
    float core = smoothstep(0.6, 0.0, d) * smoothstep(0.65, 0.12, y) * smoothstep(0.02, 0.18, y);
    vec3 col = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.72, 0.22), smoothstep(0.85, 0.3, y));
    col = mix(col, vec3(1.0, 0.95, 0.82), core);
    // blue skirt just above the wick
    float blue = smoothstep(0.24, 0.05, y) * smoothstep(0.2, 0.7, d) * body;
    col = mix(col, vec3(0.25, 0.45, 1.0), blue * 0.8);
    float a = body * (0.85 + 0.15 * noise(vec2(t * 0.7, y * 2.0)));
    gl_FragColor = vec4(col * (1.6 + core * 1.8), a * clamp(uSize * 1.4, 0.0, 1.0));
  }`;

export interface Breath {
  /** mouth position */
  origin: THREE.Vector3;
  /** unit direction of the breath */
  dir: THREE.Vector3;
  /** 0..1 */
  strength: number;
}

interface Flame {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  glow: THREE.Sprite;
  ember: THREE.Mesh;
  pos: THREE.Vector3;          // wick top, world
  lit: boolean;
  size: number;                // animated 0..1
  bend: THREE.Vector2;         // current bend (x) and stretch (y)
  push: number;                // accumulated blow
  emberT: number;              // seconds since it went out (ember glow fades)
}

export class Flames {
  group = new THREE.Group();
  light: THREE.PointLight;
  flames: Flame[] = [];
  breath: Breath = { origin: new THREE.Vector3(), dir: new THREE.Vector3(1, 0, 0), strength: 0 };
  /** called when a flame goes out */
  onOut?: (i: number) => void;
  private smoke: Smoke;
  private lightBase: number;
  private centre = new THREE.Vector3();

  constructor(wicks: THREE.Vector3[]) {
    this.group.name = 'flames';
    const geo = new THREE.PlaneGeometry(0.016, 0.046);
    geo.translate(0, 0.023, 0);
    const glowTex = glowSprite(128, 'rgba(255,214,150,1)', 'rgba(255,150,60,0)');
    const emberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.9, 0.2), transparent: true, opacity: 0 });
    wicks.forEach((p, i) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: { uTime: { value: 0 }, uSeed: { value: i * 0.37 + 0.11 }, uSize: { value: 1 }, uBend: { value: new THREE.Vector2() }, uFlutter: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(p);
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(1.6, 1.2, 0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
      glow.scale.set(0.06, 0.06, 1);
      glow.position.copy(p).add(new THREE.Vector3(0, 0.018, 0));
      glow.renderOrder = 4;
      const ember = new THREE.Mesh(new THREE.SphereGeometry(0.0013, 8, 6), emberMat.clone());
      ember.position.copy(p).add(new THREE.Vector3(0, -0.002, 0));
      this.group.add(mesh, glow, ember);
      this.flames.push({ mesh, glow, ember, pos: p.clone(), lit: true, size: 1, bend: new THREE.Vector2(), push: 0, emberT: 99 });
      this.centre.add(p);
    });
    this.centre.divideScalar(Math.max(1, wicks.length));
    this.lightBase = 0.3;
    this.light = new THREE.PointLight('#ffa64d', this.lightBase * wicks.length, 7, 2);
    // above the flames, so the cake top is lit like the room around it rather than scorched
    this.light.position.copy(this.centre).add(new THREE.Vector3(0, 0.32, 0));
    // No shadow from the candle light: a point light's shadow is a cube map, six extra
    // renders of the room every frame, for shadows the key light already provides.
    this.group.add(this.light);
    this.smoke = new Smoke();
    this.group.add(this.smoke.points);
  }

  get litCount() { let n = 0; for (const f of this.flames) if (f.lit) n++; return n; }
  get centrePoint() { return this.centre; }

  /** put one out now (with smoke) */
  extinguish(i: number) {
    const f = this.flames[i];
    if (!f.lit) return;
    f.lit = false; f.emberT = 0; f.push = 0;
    this.smoke.emit(f.pos, 2.6);
    this.onOut?.(i);
  }

  /** light one (the size eases up in update) */
  light1(i: number) {
    const f = this.flames[i];
    f.lit = true; f.push = 0; f.emberT = 99; f.size = 0.05;
  }

  private _d = new THREE.Vector3();
  private _r = new THREE.Vector3();
  private _toCam = new THREE.Vector3();

  update(dt: number, t: number, camera: THREE.Camera) {
    const b = this.breath;
    let litSum = 0;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const u = f.mesh.material.uniforms;
      u.uTime.value = t;
      // the air at this flame: breath falls off with distance and with angle off the breath's axis
      let push = 0, side = 0;
      if (b.strength > 0.001 && f.lit) {
        const d = this._d.subVectors(f.pos, b.origin);
        const dist = d.length();
        d.divideScalar(Math.max(dist, 1e-4));
        const align = Math.max(0, d.dot(b.dir));
        push = b.strength * Math.pow(align, 3) * Math.min(1, 0.22 / Math.max(0.05, dist)) ** 1.4;
        // which way it bends on screen: the breath's horizontal direction against the view's right
        this._toCam.subVectors(camera.position, f.pos).setY(0).normalize();
        this._r.set(0, 1, 0).cross(this._toCam).normalize();
        side = this._d.set(b.dir.x, 0, b.dir.z).normalize().dot(this._r);
      }
      // the bend follows the push with a little lag (air has inertia), then springs back
      const wantX = side * push * 2.4, wantY = -push * 0.35;
      f.bend.x += (wantX - f.bend.x) * Math.min(1, dt * 12);
      f.bend.y += (wantY - f.bend.y) * Math.min(1, dt * 10);
      u.uBend.value.copy(f.bend);
      u.uFlutter.value = Math.min(1, push * 2.5);
      // a strong enough breath held for a moment puts it out
      if (f.lit) {
        f.push = push > 0.32 ? f.push + dt * push : Math.max(0, f.push - dt * 0.5);
        if (f.push > 0.12) this.extinguish(i);
      }
      // size: grows when lit, shrinks fast when out
      const want = f.lit ? 1 : 0;
      f.size += (want - f.size) * Math.min(1, dt * (f.lit ? 3.5 : 18));
      u.uSize.value = f.size;
      f.mesh.visible = f.size > 0.01;
      const flick = 0.85 + 0.15 * Math.sin(t * 19 + i) * Math.sin(t * 7.3 + i * 2.1);
      f.glow.material.opacity = 0.32 * f.size * flick;
      f.glow.visible = f.size > 0.01;
      // the wick glows orange for a moment after
      f.emberT += dt;
      (f.ember.material as THREE.MeshBasicMaterial).opacity = f.lit ? 0 : Math.max(0, 1 - f.emberT / 1.6);
      litSum += f.size * flick;
    }
    // one light for all; a shared, slower flicker on top so the room breathes
    const roomFlick = 0.9 + 0.06 * Math.sin(t * 9.1) + 0.04 * Math.sin(t * 15.7 + 1.3);
    this.light.intensity = this.lightBase * litSum * roomFlick;
    this.smoke.update(dt);
  }
}

/** grey wisps rising and spreading from a snuffed wick */
class Smoke {
  points: THREE.Points;
  private N = 600;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private head = 0;
  private emitters: Array<{ p: THREE.Vector3; left: number; acc: number }> = [];

  constructor() {
    const N = this.N;
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N).fill(-1); this.max = new Float32Array(N).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('age', new THREE.BufferAttribute(new Float32Array(N), 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */`
        attribute float age; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = age < 0.0 ? 0.0 : (1.0 - age) * smoothstep(0.0, 0.08, age);
          gl_PointSize = (age < 0.0 ? 0.0 : (8.0 + age * 46.0)) * (1.0 / -mv.z);
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, r) * vA * 0.32;
          gl_FragColor = vec4(vec3(0.82, 0.8, 0.78), a);
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  emit(p: THREE.Vector3, seconds: number) { this.emitters.push({ p: p.clone(), left: seconds, acc: 0 }); }

  update(dt: number) {
    for (const e of this.emitters) {
      e.left -= dt;
      // dense at first, thinning out
      const rate = 60 * Math.max(0, e.left / 2.6);
      e.acc += rate * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        const i = this.head; this.head = (this.head + 1) % this.N;
        this.pos[i * 3] = e.p.x; this.pos[i * 3 + 1] = e.p.y + 0.004; this.pos[i * 3 + 2] = e.p.z;
        this.vel[i * 3] = (Math.random() - 0.5) * 0.01; this.vel[i * 3 + 1] = 0.05 + Math.random() * 0.03; this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
        this.life[i] = 0; this.max[i] = 2.2 + Math.random() * 1.2;
      }
    }
    // drop finished emitters in place (no new array each frame)
    let n = 0;
    for (const e of this.emitters) if (e.left > 0) this.emitters[n++] = e;
    this.emitters.length = n;
    if (!this.alive && n === 0) return;
    let any = false;
    const age = this.points.geometry.getAttribute('age') as THREE.BufferAttribute;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] < 0) { age.setX(i, -1); continue; }
      any = true;
      this.life[i] += dt;
      const k = this.life[i] / this.max[i];
      if (k >= 1) { this.life[i] = -1; age.setX(i, -1); continue; }
      // a lazy curl: each wisp drifts sideways on a slow wave as it rises
      const ph = i * 1.7 + this.life[i] * 2.2;
      this.vel[i * 3] += Math.sin(ph) * 0.012 * dt;
      this.vel[i * 3 + 2] += Math.cos(ph * 1.3) * 0.012 * dt;
      this.vel[i * 3 + 1] *= 1 - 0.25 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      age.setX(i, k);
    }
    age.needsUpdate = true;
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.alive = any || n > 0;
  }
  private alive = false;
}
