import * as THREE from 'three';
import { CONFIG } from '../config';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { DayNight } from './daynight';

/**
 * Read by the ground shader. Its far-flower haze is unlit colour, so it has to be told the
 * time of day by hand, and tinted toward the sky or the horizon shows a grey band against a
 * coloured sky at dusk.
 */
export const lightingUniforms = {
  uDaylight: { value: 1 },
  uHorizon: { value: new THREE.Color(0xb0cde6) },
};

const SHADOW_EXTENT = 11;
const LIGHT_DISTANCE = 40;
const HORIZON_FADE = 0.02;

const skyVert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFrag = /* glsl */`
  varying vec3 vDir;
  uniform vec3 uZenith, uHorizon, uGlow, uSunDir, uMoonDir;
  uniform float uGlowStrength, uStarAlpha, uSunUp, uMoonUp, uTime;
  uniform float uDaylight, uCloudCover, uCloudAmount;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  /**
   * Cloud coverage for a view direction. The dome is projected onto a plane, so bands
   * compress toward the horizon on their own and no geometry is needed. One layer only:
   * the point is weather, not overcast.
   */
  float cloudCover(vec3 d) {
    if (d.y < 0.015) return 0.0;
    vec2 uv = d.xz / (d.y + 0.15) * 0.60 + uTime * vec2(0.0045, 0.0018);
    float c = smoothstep(uCloudCover, uCloudCover + 0.26, fbm(uv));
    return c * smoothstep(0.015, 0.20, d.y);
  }

  float starField(vec3 d) {
    vec3 p = d * 240.0;
    vec3 cell = floor(p);
    float h = hash13(cell);
    if (h < 0.9930) return 0.0;
    vec3 jitter = vec3(hash13(cell + 11.3), hash13(cell + 27.7), hash13(cell + 41.1));
    float twinkle = 0.62 + 0.38 * sin(uTime * 2.1 + h * 260.0);
    return smoothstep(0.34, 0.0, length(fract(p) - jitter)) * twinkle * (0.3 + 0.7 * fract(h * 137.0));
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 col = mix(uHorizon, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.40));
    col *= mix(0.45, 1.0, smoothstep(-0.35, 0.02, d.y));

    float sunDot = max(dot(d, uSunDir), 0.0);
    float horizonBand = pow(max(1.0 - abs(d.y), 0.0), 5.0);
    col = mix(col, uGlow, clamp(uGlowStrength * horizonBand * (0.25 + 1.4 * pow(sunDot, 2.5)), 0.0, 1.0));
    col = mix(col, uGlow, 0.30 * pow(sunDot, 26.0) * uSunUp);

    float sunDisc = smoothstep(0.99972, 0.99986, sunDot) * uSunUp;
    col += vec3(1.0, 0.96, 0.88) * sunDisc * 6.0;
    col += uGlow * pow(sunDot, 260.0) * 0.9 * uSunUp;

    float moonDot = max(dot(d, uMoonDir), 0.0);
    float moonDisc = smoothstep(0.99970, 0.99984, moonDot) * uMoonUp;
    float maria = 0.82 + 0.18 * hash13(floor(d * 900.0));
    col += vec3(0.93, 0.95, 1.0) * moonDisc * maria * 1.6;
    col += vec3(0.50, 0.58, 0.82) * pow(moonDot, 400.0) * 0.55 * uMoonUp;

    // Drawn over the discs, so a bank crossing the sun dims it, and it hides the stars
    // behind it rather than letting them shine through.
    float cov = cloudCover(d);
    vec3 cLight = mix(vec3(0.97, 0.97, 1.0), uGlow, 0.55 * uGlowStrength);
    vec3 cDark = mix(uHorizon, uZenith, 0.40) * 0.72;
    vec3 cloudCol = mix(cDark, cLight, 0.30 + 0.70 * pow(sunDot, 1.4) * uSunUp);
    cloudCol *= mix(0.16, 1.0, uDaylight);
    float cloud = cov * uCloudAmount;
    col = mix(col, cloudCol, cloud);

    col += vec3(0.88, 0.92, 1.0) * starField(d) * uStarAlpha * smoothstep(-0.02, 0.16, d.y) * (1.0 - cloud);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The visible sky and the scene lighting, both driven entirely by DayNight. The dome is a
 * unit sphere pinned to the camera and drawn first with depth testing off, so it costs one
 * full-screen pass and needs no geometry out at the far plane.
 */
export class Sky {
  private mesh: THREE.Mesh;
  private uniforms;

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    readonly sun: THREE.DirectionalLight,
    readonly moon: THREE.DirectionalLight,
    readonly hemi: THREE.HemisphereLight,
    readonly dayNight: DayNight,
  ) {
    this.uniforms = {
      uZenith: { value: dayNight.zenith }, uHorizon: { value: dayNight.horizon },
      uGlow: { value: dayNight.sunGlow }, uSunDir: { value: dayNight.sunDir },
      uMoonDir: { value: dayNight.moonDir }, uGlowStrength: { value: 0 },
      uStarAlpha: { value: 0 }, uSunUp: { value: 1 }, uMoonUp: { value: 0 }, uTime: { value: 0 },
      uDaylight: { value: 1 },
      // Coverage is a threshold on the fbm: raise it for a clearer sky, lower it for more
      // cloud. Amount is how opaque a covered patch gets.
      uCloudCover: { value: 0.52 }, uCloudAmount: { value: 0.55 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.uniforms,
      side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
    scene.add(this.mesh);
  }

  update(elapsed: number, camera: THREE.Camera, focus: THREE.Vector3) {
    const d = this.dayNight;
    d.update();

    this.mesh.position.copy(camera.position);
    this.uniforms.uGlowStrength.value = d.glowStrength;
    this.uniforms.uStarAlpha.value = d.starAlpha;
    this.uniforms.uSunUp.value = smoothstep(-0.06, HORIZON_FADE, d.sunDir.y);
    this.uniforms.uMoonUp.value = smoothstep(-0.06, HORIZON_FADE, d.moonDir.y);
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uDaylight.value = d.daylight;
    lightingUniforms.uDaylight.value = d.daylight;
    lightingUniforms.uHorizon.value.copy(d.horizon);

    this.sun.intensity = d.sunIntensity;
    this.sun.color.copy(d.sunColor);
    this.sun.position.copy(focus).addScaledVector(d.sunDir, LIGHT_DISTANCE);
    this.sun.target.position.set(focus.x, 0, focus.z);

    this.moon.intensity = d.moonIntensity;
    this.moon.position.copy(focus).addScaledVector(d.moonDir, LIGHT_DISTANCE);
    this.moon.target.position.set(focus.x, 0, focus.z);

    // Only one light casts at a time: two shadow passes would cost double for no gain, and
    // the handover happens while both lights are grazing the horizon and nearly dark.
    const sunCasts = d.sunDir.y > -0.02;
    if (this.sun.castShadow !== sunCasts) {
      this.sun.castShadow = sunCasts;
      this.moon.castShadow = !sunCasts;
    }
    (sunCasts ? this.sun : this.moon).shadow.intensity = d.shadowIntensity;

    this.hemi.color.copy(d.hemiSky);
    this.hemi.groundColor.copy(d.hemiGround);
    this.hemi.intensity = d.hemiIntensity;
    this.scene.environmentIntensity = d.envIntensity;

    (this.scene.fog as THREE.Fog).color.copy(d.horizon);
    this.renderer.toneMappingExposure = d.exposure;
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export async function makeSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer, manager: THREE.LoadingManager) {
  // The HDRI stays only as an image-based ambient term; the visible sky is procedural so it
  // can change. Its contribution is scaled to almost nothing at night.
  const hdr = await new HDRLoader(manager).loadAsync('/textures/sky_2k.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.background = null;
  hdr.dispose();
  pmrem.dispose();

  scene.fog = new THREE.Fog(0xb0cde6, CONFIG.fog.near, CONFIG.fog.far);

  const sun = new THREE.DirectionalLight(0xfff0d6, 0);
  const moon = new THREE.DirectionalLight(0x9fb4e8, 0);
  for (const light of [sun, moon]) {
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.015;
    light.shadow.radius = 2;
    const cam = light.shadow.camera as THREE.OrthographicCamera;
    cam.left = -SHADOW_EXTENT; cam.right = SHADOW_EXTENT;
    cam.top = SHADOW_EXTENT; cam.bottom = -SHADOW_EXTENT;
    cam.near = 1; cam.far = 90;
    scene.add(light, light.target);
  }
  sun.castShadow = true;

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4d6b35, 0.55);
  scene.add(hemi);

  return new Sky(scene, renderer, sun, moon, hemi, new DayNight());
}
