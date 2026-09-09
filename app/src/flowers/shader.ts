import * as THREE from 'three';
import { CONFIG } from '../config';

// Shared wind + disturbance uniforms; every flower material references the same objects.
export const flowerUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(CONFIG.wind.dir[0], CONFIG.wind.dir[1]).normalize() },
  uWindStrength: { value: CONFIG.wind.strength },
  uHover: { value: new THREE.Vector3(0, -100, 0) },
  /** her chest: plants on the line from the camera to here dither out so she is never hidden */
  uGirlPos: { value: new THREE.Vector3(0, 1, 0) },
  /**
   * The night halo. A point light on her does the real shading; this is the soft lift on
   * the petals nearest her, so the pool of light reads as a glow rather than as a lamp.
   * Strength is driven off the day/night cycle and is exactly zero in daylight.
   */
  uHaloPos: { value: new THREE.Vector3(0, 1, 0) },
  uHaloColor: { value: new THREE.Color(0xbcd2ff) },
  uHaloStrength: { value: 0 },
  uHaloRadius: { value: 3.0 },
};

export interface FlowerShaderOpts {
  height: number;       // model height (bend weight normalisation)
  stiffness: number;    // lower = bends more
  /**
   * Recolour petals with the per-instance batch colour.
   *  'mask' - the map's alpha marks which pixels are petals (built by makePetalMask)
   *  'all'  - the whole material is petals, so the map's alpha is left for its cutout
   */
  tint?: 'mask' | 'all';
  tintGain?: number;    // scales texture luminance so an average petal tints at full strength
  headNod?: number;     // extra sway for the top part (sunflower head)

  // ---- surface finish
  /** light passing through a petal seen against the sun (0 = opaque, ~1 = a thin petal) */
  petalTrans?: number;
  /** the same for foliage; leaves glow yellow-green when backlit */
  leafTrans?: number;
  /** velvet sheen on petals and leaves: the soft rim a petal shows at grazing angles */
  sheenPetal?: number;
  sheenLeaf?: number;
  /** how dark the plant is at the soil line, where neighbours crowd out the sky */
  baseAO?: number;
  /** petal roughness relative to the material's own: petals are satin, leaves waxy */
  petalRough?: number;
  /** strength of the procedural micro-relief (petal fibres, leaf grain) seen close up */
  detail?: number;
}

/** Per-instance data for a BatchedMesh lives in two float textures indexed by the batch instance id. */
export interface BatchData {
  rand: THREE.DataTexture;     // phase, scale jitter, hue jitter, unused
  disturb: THREE.DataTexture;  // dirX, dirZ, amount, tLast
  size: number;
}

export function makeBatchData(maxInstances: number): BatchData {
  const size = Math.max(4, Math.ceil(Math.sqrt(maxInstances)));
  const mk = () => {
    const t = new THREE.DataTexture(new Float32Array(size * size * 4), size, size, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  };
  return { rand: mk(), disturb: mk(), size };
}

const vertexHead = /* glsl */`
  uniform float uTime; uniform vec2 uWindDir; uniform float uWindStrength; uniform vec3 uHover;
  uniform float uHeight; uniform float uStiffness; uniform float uHeadNod;
  uniform highp sampler2D uRandTex; uniform highp sampler2D uDisturbTex;
  vec4 fetchData(sampler2D tex, int id){
    int size = textureSize(tex, 0).x;
    return texelFetch(tex, ivec2(id % size, id / size), 0);
  }
  mat3 rotAxis(vec3 a, float ang){
    float s = sin(ang), c = cos(ang), oc = 1.0 - c;
    return mat3(oc*a.x*a.x + c, oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
                oc*a.x*a.y - a.z*s, oc*a.y*a.y + c, oc*a.y*a.z + a.x*s,
                oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
  }
  mat3 flowerBend(vec3 p, mat4 im, vec4 aRand, vec4 aDisturb){
    vec3 base = im[3].xyz;
    float t = uTime;
    float w = clamp(p.y / uHeight, 0.0, 1.0); w = pow(w, 1.35);
    // ---- wind: gusts travel along uWindDir; neighbours share phase
    float along = dot(base.xz, uWindDir);
    float gust = sin(t * 1.15 + along * 0.35 + aRand.x * 0.7) * 0.55
               + sin(t * 2.3 + along * 0.9 + aRand.x * 2.1) * 0.25
               + sin(t * 0.37 + along * 0.12) * 0.4 + 0.45;
    float flutter = sin(t * 6.0 + aRand.x * 6.283 + p.y * 3.0) * 0.03;
    float windAng = (gust * 0.10 + flutter) * uWindStrength / uStiffness;
    float hd = length(base.xz - uHover.xz);
    windAng += smoothstep(1.1, 0.0, hd) * sin(t * 9.0 + aRand.x * 9.0) * 0.06;
    // ---- disturbance (girl walking through): damped spring after last contact
    float e = max(t - aDisturb.w, 0.0);
    float amp = aDisturb.z * exp(-e * 2.6) * cos(e * 7.5);
    vec2 lean = uWindDir * windAng + aDisturb.xy * amp * (0.9 / uStiffness);
    float ang = length(lean);
    if (ang < 1e-5) return mat3(1.0);
    vec2 d = lean / ang;
    vec3 dl = normalize(transpose(mat3(im)) * vec3(d.x, 0.0, d.y));
    vec3 axis = normalize(cross(vec3(0.0, 1.0, 0.0), dl));
    float a = ang * w;
    a += uHeadNod * smoothstep(0.75, 1.0, w) * sin(t * 1.3 + aRand.x * 3.0) * 0.08;
    return rotAxis(axis, a);
  }
`;

// The lit pass also hands the fragment stage what it needs for the finish: the plant's own
// random numbers (so no two neighbours share a shade) and how far up the plant we are.
const litVaryings = /* glsl */`
  varying vec4 vFlowerRand;
  varying float vPlantY;
  varying vec3 vFlowerWorld;
`;

// inserted in place of batching_vertex so batchingMatrix + instance id are known before normals/positions
const bendPrelude = (lit: boolean) => /* glsl */`
  #include <batching_vertex>
  int flowerId = int(getIndirectIndex(gl_DrawID));
  vec4 flowerRand = fetchData(uRandTex, flowerId);
  mat3 bendM = flowerBend(position, batchingMatrix, flowerRand, fetchData(uDisturbTex, flowerId));
  ${lit ? `
  // three decorrelated jitters from one phase value: the phase itself for hue direction,
  // and two folded copies for hue amount and brightness
  vFlowerRand = vec4(flowerRand.x, fract(flowerRand.x * 0.731), fract(flowerRand.x * 0.377 + 0.5), flowerRand.y);
  vPlantY = clamp(position.y / uHeight, 0.0, 1.0);` : ''}
`;

function patchVertex(src: string, lit: boolean) {
  src = src
    .replace('#include <batching_pars_vertex>', '#include <batching_pars_vertex>\n' + vertexHead + (lit ? litVaryings : ''))
    .replace('#include <batching_vertex>', bendPrelude(lit))
    .replace('#include <begin_vertex>', 'vec3 transformed = bendM * vec3(position);' +
      (lit ? '\n vFlowerWorld = (modelMatrix * batchingMatrix * vec4(transformed, 1.0)).xyz;' : ''));
  if (lit) src = src.replace('#include <beginnormal_vertex>', `
        vec3 objectNormal = bendM * vec3(normal);
        #ifdef USE_TANGENT
          vec3 objectTangent = bendM * vec3(tangent.xyz);
        #endif`);
  return src;
}

const fragHead = /* glsl */`
  uniform float uTintGain, uPetalTrans, uLeafTrans, uSheenPetal, uSheenLeaf, uBaseAO, uPetalRough, uDetail;
  uniform vec3 uGirlPos;
  uniform vec3 uHaloPos, uHaloColor;
  uniform float uHaloStrength, uHaloRadius;
  varying vec4 vFlowerRand;
  varying float vPlantY;
  varying vec3 vFlowerWorld;
  // 1 on petals, 0 on foliage; set while the albedo is sampled, read by every term below
  float flowerPetal = 1.0;

  // Normal mapping without precomputed tangents (http://www.thetenthplanet.de/archives/1180),
  // the same frame three.js builds for its own normal maps.
  mat3 flowerTangentFrame(vec3 eye_pos, vec3 surf_norm, vec2 uv) {
    vec3 q0 = dFdx(eye_pos), q1 = dFdy(eye_pos);
    vec2 st0 = dFdx(uv), st1 = dFdy(uv);
    vec3 q1perp = cross(q1, surf_norm), q0perp = cross(surf_norm, q0);
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float det = max(dot(T, T), dot(B, B));
    float scale = (det == 0.0) ? 0.0 : inversesqrt(det);
    return mat3(T * scale, B * scale, surf_norm);
  }

  /**
   * Micro-relief the scans are too coarse to carry: the fibres that run the length of a
   * petal and the grain of a leaf, as a height field of a few sinusoids whose gradient is
   * analytic. It fades out with distance so it never shimmers.
   */
  void flowerDetail(inout vec3 n, const in vec2 uv) {
    float amount = uDetail * smoothstep(9.0, 1.5, length(vViewPosition));
    if (amount < 0.002) return;
    float f = mix(170.0, 420.0, flowerPetal);
    float wob = sin(uv.y * 23.0) * 1.5;
    vec2 g = vec2(f, 23.0 * cos(uv.y * 23.0) * 1.5) * cos(uv.x * f + wob) * 0.5;
    vec2 d2 = vec2(f * 0.53, f * 0.31);  g += d2 * cos(dot(uv, d2)) * 0.3;
    vec2 d3 = vec2(f * 0.17, -f * 0.61); g += d3 * cos(dot(uv, d3)) * 0.2;
    vec3 mapN = normalize(vec3(-g * (amount / f), 1.0));
    n = normalize(flowerTangentFrame(-vViewPosition, n, uv) * mapN);
  }

  float flowerBayer(vec2 p) {
    ivec2 i = ivec2(mod(p, 4.0));
    int idx = i.x + i.y * 4;
    const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    return (m[idx] + 0.5) / 16.0;
  }

  /**
   * The camera must never lose her behind a sunflower: anything tall on the line from the
   * camera to her chest, and well short of her, dithers away. Plants at her own depth and
   * anything below waist height are left alone, so lilies still cross in front of her legs
   * and a sunflower at her shoulder stays whole.
   */
  void flowerOcclusion() {
    if (vFlowerWorld.y < uGirlPos.y - 0.35) return;
    vec3 ab = uGirlPos - cameraPosition;
    float t = clamp(dot(vFlowerWorld - cameraPosition, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    float dline = length(vFlowerWorld - (cameraPosition + ab * t));
    float fade = smoothstep(0.5, 0.15, dline) * smoothstep(0.72, 0.5, t);
    if (fade > flowerBayer(gl_FragCoord.xy)) discard;
  }

  /**
   * The halo she carries after dark. Added as emission, so it costs nothing per light and
   * cannot cast: petals take more of it than foliage, and the top of a plant more than its
   * base, so the pool falls off both outward and downward and stays soft at its edge.
   */
  vec3 flowerHalo(const in vec3 albedo) {
    if (uHaloStrength < 0.001) return vec3(0.0);
    float f = smoothstep(uHaloRadius, 0.0, distance(vFlowerWorld, uHaloPos));
    f *= f;
    // Scaled by the plant's own albedo rather than added flat: a flat term is white light
    // on top of the colour, which washes every petal out to grey as it brightens. This
    // lifts the colour that is already there, so a red lily glows red.
    return albedo * uHaloColor * (uHaloStrength * f * mix(0.35, 1.0, flowerPetal) * (0.25 + 0.75 * vPlantY));
  }

  /**
   * Light through a thin surface. A petal or leaf between the eye and the sun is not dark:
   * the light that reaches its back comes through, strongest when looking almost straight
   * into the sun. Petals transmit their own colour more saturated, leaves the yellow-green
   * of chlorophyll. \`light.color\` is already shadowed, so a bloom's inner petals stay dark.
   */
  void flowerThin(const in IncidentLight light, const in vec3 N, const in vec3 V, const in vec3 albedo, inout ReflectedLight rl) {
    vec3 L = light.direction;
    float back = saturate(dot(-N, L));
    float fwd = pow(saturate(-dot(V, L)), 5.0);
    float amount = back * (0.45 + 0.55 * fwd) * mix(uLeafTrans, uPetalTrans, flowerPetal);
    vec3 petalT = albedo * albedo * 2.0 + albedo * 0.25;
    vec3 leafT = albedo * vec3(1.15, 1.25, 0.55);
    rl.directDiffuse += light.color * mix(leafT, petalT, flowerPetal) * (amount * RECIPROCAL_PI);
  }
`;

/** the standard lighting loop with the translucency term added after every direct light */
const litLoop = THREE.ShaderChunk.lights_fragment_begin.replace(
  /RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);/g,
  '$&\n\t\tflowerThin( directLight, geometryNormal, geometryViewDir, material.diffuseColor, reflectedLight );',
);
if (litLoop === THREE.ShaderChunk.lights_fragment_begin) throw new Error('flower shader: RE_Direct hook not found in this three.js build');

/**
 * Sampling the albedo. Tinting, petal detection, per-plant variation and the soil-line
 * darkening all happen here, so that translucency and sheen further down see the finished
 * colour.
 */
function mapBody(tint: 'mask' | 'all' | undefined) {
  const tintCol = `
    #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_BATCHING_COLOR ) || defined( USE_INSTANCING_COLOR )
      vec3 tintCol = vec3(vColor).rgb;
    #else
      vec3 tintCol = vec3(1.0);
    #endif`;
  const sample = tint === 'mask' ? `
      ${tintCol}
      flowerPetal = sampledDiffuseColor.a;
      float shade = min(0.22 + uTintGain * lum, 1.25);
      vec3 tinted = tintCol * mix(shade, shade * shade, 0.45);
      vec3 albedo = mix(sampledDiffuseColor.rgb, tinted, flowerPetal);`
    : tint === 'all' ? `
      ${tintCol}
      flowerPetal = 1.0;
      float shade = min(0.22 + uTintGain * lum, 1.25);
      vec3 albedo = tintCol * mix(shade, shade * shade, 0.45);
      diffuseColor.a *= sampledDiffuseColor.a;`
    : `
      vec3 albedo = sampledDiffuseColor.rgb;
      flowerPetal = 1.0 - saturate((albedo.g - max(albedo.r, albedo.b)) * 6.0);
      diffuseColor.a *= sampledDiffuseColor.a;`;
  return /* glsl */`
    vec4 sampledDiffuseColor = texture2D(map, vMapUv);
    float lum = dot(sampledDiffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    ${sample}
    // No two neighbours share a shade: foliage drifts between yellow-green and blue-green,
    // petals only a little, and every plant is a touch lighter or darker than the next.
    float hueDir = vFlowerRand.y * 2.0 - 1.0;
    vec3 shifted = hueDir > 0.0 ? vec3(1.10, 1.02, 0.80) : vec3(0.88, 1.0, 1.10);
    albedo *= mix(vec3(1.0), shifted, abs(hueDir) * mix(0.45, 0.15, flowerPetal));
    albedo *= 0.90 + 0.20 * vFlowerRand.z;
    // the soil line sits under every neighbour's leaves and sees little sky
    albedo *= mix(uBaseAO, 1.0, smoothstep(0.0, 0.55, vPlantY));
    diffuseColor.rgb *= albedo;
    flowerOcclusion();`;
}

const finishBody = /* glsl */`
  #include <lights_physical_fragment>
  #ifdef USE_SHEEN
    material.sheenColor *= mix(uSheenLeaf, uSheenPetal, flowerPetal);
  #endif
  material.roughness = clamp(material.roughness * mix(1.0, uPetalRough, flowerPetal), 0.2, 1.0);
`;

function finishUniforms(opts: FlowerShaderOpts) {
  return {
    uTintGain: { value: opts.tintGain ?? 1 },
    uPetalTrans: { value: opts.petalTrans ?? 0.85 },
    uLeafTrans: { value: opts.leafTrans ?? 0.5 },
    uSheenPetal: { value: opts.sheenPetal ?? 1.0 },
    uSheenLeaf: { value: opts.sheenLeaf ?? 0.2 },
    uBaseAO: { value: opts.baseAO ?? 0.55 },
    uPetalRough: { value: opts.petalRough ?? 0.75 },
    uDetail: { value: opts.detail ?? 0.6 },
  };
}

export function applyFlowerShader(mat: THREE.Material, opts: FlowerShaderOpts, data: BatchData) {
  const m = mat as THREE.MeshPhysicalMaterial;
  const uniforms = {
    uHeight: { value: opts.height }, uStiffness: { value: opts.stiffness }, uHeadNod: { value: opts.headNod ?? 0 },
    uRandTex: { value: data.rand }, uDisturbTex: { value: data.disturb },
    ...finishUniforms(opts),
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, flowerUniforms, uniforms);
    sh.vertexShader = patchVertex(sh.vertexShader, true);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', '')   // the batch colour is mixed in by hand
      .replace('#include <common>', '#include <common>\n' + fragHead)
      .replace('#include <map_fragment>', mapBody(opts.tint))
      .replace('#include <lights_physical_fragment>', finishBody)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n flowerDetail(normal, vMapUv);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += flowerHalo(diffuseColor.rgb);')
      .replace('#include <lights_fragment_begin>', litLoop);
  };
  m.customProgramCacheKey = () => `flower-${opts.height}-${opts.stiffness}-${opts.tint ?? 'n'}-${opts.headNod ?? 0}`;
  return uniforms;
}

/** Depth material for shadows that applies the same bend, and the same cutout. */
export function makeFlowerDepthMaterial(opts: FlowerShaderOpts, data: BatchData, alphaMap?: THREE.Texture | null, alphaTest = 0) {
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  if (alphaMap && alphaTest > 0) { d.map = alphaMap; d.alphaTest = alphaTest; }
  const uniforms = {
    uHeight: { value: opts.height }, uStiffness: { value: opts.stiffness }, uHeadNod: { value: opts.headNod ?? 0 },
    uRandTex: { value: data.rand }, uDisturbTex: { value: data.disturb },
  };
  d.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, flowerUniforms, uniforms);
    sh.vertexShader = patchVertex(sh.vertexShader, false);
  };
  d.customProgramCacheKey = () => `flowerdepth-${opts.height}-${opts.stiffness}-${alphaMap && alphaTest > 0 ? alphaTest : 0}`;
  return d;
}
