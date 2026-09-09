import * as THREE from 'three';
import { CONFIG } from '../config';
import { TERRAIN_GLSL, heightAt } from './terrain';
import { lightingUniforms } from './sky';

export { heightAt };

/**
 * An endless ground: one plane that follows the girl, snapped to its own vertex spacing
 * so vertices always land on the same world positions and the surface never swims.
 * Height, normals and texture coordinates all come from world position in the shader.
 */
export class Ground {
  mesh!: THREE.Mesh;
  private step = 1;

  async build(loader: THREE.TextureLoader) {
    const size = CONFIG.groundSize, seg = CONFIG.groundSegments;
    this.step = size / seg;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), size);

    const [diff, nor, rough] = await Promise.all([
      loader.loadAsync('/textures/leafy_grass_Diffuse_1k.jpg'),
      loader.loadAsync('/textures/leafy_grass_nor_gl_1k.jpg'),
      loader.loadAsync('/textures/leafy_grass_Rough_1k.jpg'),
    ]);
    for (const t of [diff, nor, rough]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; }
    diff.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshStandardMaterial({ map: diff, normalMap: nor, roughnessMap: rough, roughness: 1.0, color: 0x9dbd7f });
    mat.normalScale.set(0.55, 0.55);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uFlowerFade = { value: CONFIG.groundSpeckleStart };
      sh.uniforms.uDaylight = lightingUniforms.uDaylight;
      sh.uniforms.uHorizon = lightingUniforms.uHorizon;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n varying vec3 vWPos;\n${TERRAIN_GLSL}`)
        .replace('#include <beginnormal_vertex>', `
          vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 objectNormal = gNormal(wp0.xz);`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = vec3(position);
          transformed.y = gHeight(wp0.xz);
          vWPos = vec3(wp0.x, transformed.y, wp0.z);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos;
          uniform float uFlowerFade;
          uniform float uDaylight;
          uniform vec3 uHorizon;
          float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(gh(i), gh(i + vec2(1,0)), f.x), mix(gh(i + vec2(0,1)), gh(i + vec2(1,1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `
          // world-space UVs: the plane slides under the player, so attribute UVs would swim
          vec2 tuv = vWPos.xz * 0.25;
          vec4 sampledDiffuseColor = texture2D(map, tuv);
          diffuseColor *= sampledDiffuseColor;
          float big = gn(vWPos.xz * 0.045) * 0.6 + gn(vWPos.xz * 0.19) * 0.4;
          diffuseColor.rgb *= mix(vec3(0.90, 1.0, 0.76), vec3(0.62, 0.80, 0.50), big);
          diffuseColor.rgb *= 0.88 + 0.24 * gn(vWPos.xz * 1.6);
          // Far flower haze. Past the last billboards the meadow is carried by the ground
          // itself, so the field reaches the fog without a wall of shimmering cutouts.
          float dist = length(vWPos - cameraPosition);
          float far = smoothstep(uFlowerFade, uFlowerFade + 26.0, dist);
          float speck = gn(vWPos.xz * 5.5) * 0.55 + gn(vWPos.xz * 13.0) * 0.45;
          float bloom = smoothstep(0.60, 0.86, speck) * (0.35 + 0.65 * gn(vWPos.xz * 0.07));
          // pale flowers by day, the sky's own horizon colour by night, so the far field
          // never sits as a grey band under a coloured sky
          vec3 haze = mix(uHorizon * 1.25, vec3(0.93, 0.94, 0.88), uDaylight);
          diffuseColor.rgb = mix(diffuseColor.rgb, haze, far * bloom * 0.75);`)
        .replace('#include <roughnessmap_fragment>', `
          float roughnessFactor = roughness;
          #ifdef USE_ROUGHNESSMAP
            roughnessFactor *= texture2D(roughnessMap, tuv).g;
          #endif`)
        .replace('#include <normal_fragment_maps>', `
          #ifdef USE_NORMALMAP
            vec3 mapN = texture2D(normalMap, tuv).xyz * 2.0 - 1.0;
            mapN.xy *= normalScale;
            normal = normalize(tbn * mapN);
          #endif`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'ground';
    return this.mesh;
  }

  /** keep the plane centred on the girl, snapped so vertices stay world-aligned */
  follow(x: number, z: number) {
    this.mesh.position.set(Math.round(x / this.step) * this.step, 0, Math.round(z / this.step) * this.step);
  }
}
