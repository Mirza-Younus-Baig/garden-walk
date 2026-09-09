/**
 * The terrain height field.
 *
 * The world is endless, so the ground plane follows the girl and its vertices are
 * displaced in the vertex shader from world position. That means the CPU (for her feet
 * and every plant base) and the GPU must agree exactly, so the function is written once
 * here as a sum of sines and mirrored verbatim in GLSL below.
 */
export const TERRAIN_GLSL = /* glsl */`
  float gHeight(vec2 p){
    return 0.55 * sin(p.x * 0.041) * cos(p.y * 0.037)
         + 0.30 * sin(p.y * 0.093 + 1.3) * cos(p.x * 0.081)
         + 0.13 * sin(p.x * 0.190 + 0.7) * sin(p.y * 0.170);
  }
  vec3 gNormal(vec2 p){
    const float e = 0.6;
    float hL = gHeight(p - vec2(e, 0.0)), hR = gHeight(p + vec2(e, 0.0));
    float hD = gHeight(p - vec2(0.0, e)), hU = gHeight(p + vec2(0.0, e));
    return normalize(vec3(hL - hR, 2.0 * e, hD - hU));
  }
`;

export function heightAt(x: number, z: number) {
  return 0.55 * Math.sin(x * 0.041) * Math.cos(z * 0.037)
       + 0.30 * Math.sin(z * 0.093 + 1.3) * Math.cos(x * 0.081)
       + 0.13 * Math.sin(x * 0.190 + 0.7) * Math.sin(z * 0.170);
}
