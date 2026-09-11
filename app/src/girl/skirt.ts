import * as THREE from 'three';

/**
 * Keeps her body inside the skirt.
 *
 * The skirt panels hang from bones that the spring rig swings, while the legs under them
 * swing through a wide arc every stride. The source rig tied the two together with helper
 * bones, but those are not animated, so nothing does now. Two things then show through:
 * the top of a swinging thigh pushes out through the panel beside it, and when a leg goes
 * back, the panel in front of it swings inward past the hip and groin skin, which does not
 * follow the leg. From the front or side that shows the underwear.
 *
 * Three corrections, all measured from the meshes at load rather than tuned by eye:
 *
 *  - Pelvis as a surface. The skin carried by the pelvis and by the static helper bones is
 *    rigid with the pelvis. It is sampled into a map of radius by height and angle about the
 *    pelvis's vertical axis. The skirt's vertex shader pushes free-hanging vertices back out
 *    of it. Where there is no body, such as between the legs, the map is empty and the
 *    panels are free.
 *  - Thighs as volumes. Each thigh is a volume of revolution about its hip-to-knee axis, with
 *    the radius profile measured from the body mesh. Skirt vertices are pushed out of it too.
 *  - Tucked skin. The pelvis and upper-thigh skin under the skirt is drawn in slightly,
 *    fading to nothing above the hem, so there is clearance before skin meets cloth.
 *
 * Every push allows a vertex exactly the room it has in her standing pose. That leaves the
 * modelled pose untouched, and motion can never bring skin further through the cloth than
 * it is while she stands still.
 */

/** cloth thickness kept between the skirt and the body, metres */
const MARGIN = 0.008;
/** how far the skin under the skirt is drawn in, metres */
const TUCK = 0.014;
/** samples along each thigh's radius profile, hip to knee */
const N = 8;
/** pelvis map: rows from hem to waistband, and sectors around her */
const PH = 8, PA = 16;
/** bones whose skin lies under the skirt: the pelvis and the top of each leg */
const COVERED = /^(Root_M|RootPart\d_M|Hip.*_[LR])$/;
/** bones the clips never move relative to the pelvis, so their skin is one rigid surface */
const PELVIS = /^(Root_M|RootPart\d_M|Hip_[LR]_Slide50|Hip_[LR]_middleSlider\d)$/;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4();

interface Leg {
  hip: THREE.Bone; knee: THREE.Bone;
  /** thigh radius plus margin at N evenly spaced points from hip to knee */
  prof: number[];
  /** this frame, in the skirt's local space: hip joint, unit axis toward the knee, length */
  a: THREE.Vector3; d: THREE.Vector3; len: number;
}

function dominantBone(mesh: THREE.SkinnedMesh, i: number) {
  const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  let best = -1, bi = 0;
  for (let k = 0; k < 4; k++) {
    const w = sw.getComponent(i, k);
    if (w > best) { best = w; bi = si.getComponent(i, k); }
  }
  return mesh.skeleton.bones[bi];
}

/** total skin weight a vertex puts on bones matching `re` */
function weightOn(mesh: THREE.SkinnedMesh, i: number, re: RegExp) {
  const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  let w = 0;
  for (let k = 0; k < 4; k++) if (re.test(mesh.skeleton.bones[si.getComponent(i, k)].name)) w += sw.getComponent(i, k);
  return w;
}

/** a bone's position in the bind pose, in the mesh's bind space */
function bindPos(mesh: THREE.SkinnedMesh, bone: THREE.Bone, out: THREE.Vector3) {
  const i = mesh.skeleton.bones.indexOf(bone);
  return out.setFromMatrixPosition(_m.copy(mesh.skeleton.boneInverses[i]).invert());
}

/** interpolated profile radius at distance `s` down the thigh */
function radiusAt(leg: Leg, s: number) {
  const x = THREE.MathUtils.clamp(s / leg.len, 0, 1) * (N - 1);
  const i = Math.floor(x), j = Math.min(i + 1, N - 1);
  return THREE.MathUtils.lerp(leg.prof[i], leg.prof[j], x - i);
}

export class SkirtFit {
  private legs: Leg[];
  private root: THREE.Bone;
  /** bind space to the pelvis bone's frame: fixed, so the map moves rigidly with her hips */
  private rootBind: THREE.Matrix4;
  private box: THREE.Vector4;
  private map: Float32Array;
  private uniforms = {
    uThighA: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uThighD: { value: [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0)] },
    uThighLen: { value: [0.4, 0.4] },
    uThighProf: { value: new Float32Array(2 * N) },
    uLocalToPelvis: { value: new THREE.Matrix4() },
    uPelvisToLocal: { value: new THREE.Matrix4() },
    uPelvisBox: { value: new THREE.Vector4() },
    uPelvisMap: { value: new Float32Array(PH * PA) },
  };
  private primed = false;

  constructor(private skirt: THREE.SkinnedMesh, body: THREE.SkinnedMesh) {
    const bone = (n: string) => {
      const b = body.skeleton.bones.find((x) => x.name === n);
      if (!b) throw new Error(`skirt: missing bone ${n}`);
      return b;
    };
    this.legs = (['L', 'R'] as const).map((side) => ({
      hip: bone(`Hip_${side}`), knee: bone(`Knee_${side}`), prof: [] as number[],
      a: new THREE.Vector3(), d: new THREE.Vector3(), len: 0.4,
    }));
    this.root = bone('Root_M');
    this.rootBind = body.skeleton.boneInverses[body.skeleton.bones.indexOf(this.root)].clone();

    const bpos = body.geometry.attributes.position as THREE.BufferAttribute;
    const toBind = (mesh: THREE.SkinnedMesh, i: number, out: THREE.Vector3) =>
      out.fromBufferAttribute(mesh.geometry.attributes.position as THREE.BufferAttribute, i).applyMatrix4(mesh.bindMatrix);

    // ---- the skirt: which vertices hang free, and how far it reaches
    const sg = skirt.geometry;
    const count = sg.attributes.position.count;
    const fit = new Float32Array(count * 4);
    let hem = Infinity, top = -Infinity, cx = 0, cz = 0, nFree = 0;
    for (let i = 0; i < count; i++) {
      const free = weightOn(skirt, i, /^dynSkirt/);
      fit[i * 4 + 2] = free;
      toBind(skirt, i, _v);
      hem = Math.min(hem, _v.y); top = Math.max(top, _v.y);
      if (free > 0.5) { cx += _v.x; cz += _v.z; nFree++; }
    }
    cx /= Math.max(1, nFree); cz /= Math.max(1, nFree);
    sg.setAttribute('aSkirtFit', new THREE.BufferAttribute(fit, 4));
    this.box = new THREE.Vector4(hem, top, cx, cz);
    this.uniforms.uPelvisBox.value.copy(this.box);

    // ---- thigh profiles, from the body vertices each hip carries, in the bind pose
    this.legs.forEach((leg, k) => {
      const suffix = k === 0 ? '_L' : '_R';
      const a = bindPos(body, leg.hip, new THREE.Vector3()), b = bindPos(body, leg.knee, new THREE.Vector3());
      const len = a.distanceTo(b), d = b.clone().sub(a).normalize();
      const prof = new Array<number>(N).fill(0);
      for (let i = 0; i < bpos.count; i++) {
        const name = dominantBone(body, i).name;
        if (!name.includes('Hip') || !name.endsWith(suffix)) continue;
        toBind(body, i, _v).sub(a);
        const s = _v.dot(d);
        if (s < 0 || s > len) continue;
        const r = _v.addScaledVector(d, -s).length();
        const bin = Math.round((s / len) * (N - 1));
        prof[bin] = Math.max(prof[bin], r);
      }
      // the body is low-poly here, so some samples see no vertex: fill them from neighbours
      for (let i = 0; i < N; i++) {
        if (prof[i] > 0) continue;
        let lo = i - 1, hi = i + 1;
        while (lo >= 0 && prof[lo] === 0) lo--;
        while (hi < N && prof[hi] === 0) hi++;
        prof[i] = lo >= 0 && hi < N ? THREE.MathUtils.lerp(prof[lo], prof[hi], (i - lo) / (hi - lo))
          : lo >= 0 ? prof[lo] : hi < N ? prof[hi] : 0.07;
      }
      leg.prof = prof.map((r) => r + MARGIN);
      leg.len = len;
      this.uniforms.uThighProf.value.set(leg.prof, k * N);
    });

    // ---- the pelvis map: outermost radius of the rigid skin, per height row and sector.
    // Sampled across triangles, not vertices: the body is low-poly around the hips, and its
    // vertices alone leave most cells empty.
    const map = this.uniforms.uPelvisMap.value;
    const index = body.geometry.index!;
    const rigid = new Float32Array(bpos.count);
    for (let i = 0; i < bpos.count; i++) rigid[i] = weightOn(body, i, PELVIS);
    for (let t = 0; t < index.count; t += 3) {
      const ia = index.getX(t), ib = index.getX(t + 1), ic = index.getX(t + 2);
      if (Math.min(rigid[ia], rigid[ib], rigid[ic]) <= 0.5) continue;
      toBind(body, ia, _a); toBind(body, ib, _b); toBind(body, ic, _c);
      for (let u = 0; u <= 10; u++) for (let w = 0; w <= 10 - u; w++) {
        _v.copy(_a).addScaledVector(_d.subVectors(_b, _a), u / 10).addScaledVector(_d.subVectors(_c, _a), w / 10);
        if (_v.y < hem || _v.y >= top) continue;
        const hb = Math.min(PH - 1, Math.floor(((_v.y - hem) / (top - hem)) * PH));
        const ab = Math.floor(((Math.atan2(_v.x - cx, _v.z - cz) + Math.PI) / (2 * Math.PI)) * PA) % PA;
        map[hb * PA + ab] = Math.max(map[hb * PA + ab], Math.hypot(_v.x - cx, _v.z - cz));
      }
    }
    for (let i = 0; i < map.length; i++) if (map[i] > 0) map[i] += MARGIN;
    this.map = map;

    // ---- tuck the covered skin in, toward its own thigh's axis or the pelvis's
    const inv = body.bindMatrixInverse;
    const axes = this.legs.map((leg) => {
      const a = bindPos(body, leg.hip, new THREE.Vector3());
      return { a, d: bindPos(body, leg.knee, new THREE.Vector3()).sub(a).normalize() };
    });
    for (let i = 0; i < bpos.count; i++) {
      const name = dominantBone(body, i).name;
      if (!COVERED.test(name)) continue;
      toBind(body, i, _v);
      const fade = THREE.MathUtils.smoothstep(_v.y, hem + 0.02, hem + 0.09) * (1 - THREE.MathUtils.smoothstep(_v.y, top - 0.07, top - 0.02));
      if (fade <= 0) continue;
      if (name.includes('Hip')) {
        const ax = axes[name.endsWith('_L') ? 0 : 1];
        _a.copy(_v).sub(ax.a);
        _d.copy(_a).addScaledVector(ax.d, -_a.dot(ax.d));     // out from the thigh axis
      } else {
        _d.set(_v.x - cx, 0, _v.z - cz);                     // out from the pelvis centre
      }
      const r = _d.length();
      if (r < 1e-4) continue;
      _v.addScaledVector(_d, -Math.min(TUCK * fade, r * 0.4) / r).applyMatrix4(inv);
      bpos.setXYZ(i, _v.x, _v.y, _v.z);
    }
    bpos.needsUpdate = true;

    // ---- the skirt's own material, so the push-out does not reach the shirt or body
    const mat = (skirt.material as THREE.MeshStandardMaterial).clone();
    const u = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uThighA[2];
          uniform vec3 uThighD[2];
          uniform float uThighLen[2];
          uniform float uThighProf[${2 * N}];
          uniform mat4 uLocalToPelvis;
          uniform mat4 uPelvisToLocal;
          uniform vec4 uPelvisBox;     // hem height, waistband height, axis x, axis z
          uniform float uPelvisMap[${PH * PA}];
          // x, y: room each thigh leaves in the standing pose; z: how freely it hangs;
          // w: room the pelvis leaves
          attribute vec4 aSkirtFit;
          float thighRadius(int leg, float s) {
            float x = clamp(s / uThighLen[leg], 0.0, 1.0) * ${(N - 1).toFixed(1)};
            int i = int(floor(x));
            int j = min(i + 1, ${N - 1});
            return mix(uThighProf[leg * ${N} + i], uThighProf[leg * ${N} + j], x - float(i));
          }
          float pelvisCell(float row, float sector) {
            return uPelvisMap[int(row) * ${PA} + int(mod(sector, ${PA.toFixed(1)}))];
          }
          float pelvisRadius(float h, float ang) {
            float y = (h - uPelvisBox.x) / (uPelvisBox.y - uPelvisBox.x) * ${PH.toFixed(1)} - 0.5;
            if (y < -0.5 || y > ${(PH - 0.5).toFixed(1)}) return 0.0;
            y = clamp(y, 0.0, ${(PH - 1).toFixed(1)});
            float x = (ang + PI) / (2.0 * PI) * ${PA.toFixed(1)} - 0.5;
            float y0 = floor(y), y1 = min(y0 + 1.0, ${(PH - 1).toFixed(1)}), x0 = floor(x);
            float r0 = mix(pelvisCell(y0, x0), pelvisCell(y0, x0 + 1.0), x - x0);
            float r1 = mix(pelvisCell(y1, x0), pelvisCell(y1, x0 + 1.0), x - x0);
            return mix(r0, r1, y - y0);
          }`)
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>
          {
            vec3 q = (uLocalToPelvis * vec4(transformed, 1.0)).xyz;
            vec2 d = q.xz - uPelvisBox.zw;
            float r = length(d);
            float R = pelvisRadius(q.y, atan(d.x, d.y));
            float pen = R - r - aSkirtFit.w;
            if (R > 0.0 && pen > 0.0 && r > 1e-4) {
              q.xz += d / r * pen * aSkirtFit.z;
              transformed = (uPelvisToLocal * vec4(q, 1.0)).xyz;
            }
          }
          for (int leg = 0; leg < 2; leg++) {
            vec3 rel = transformed - uThighA[leg];
            float s = dot(rel, uThighD[leg]);
            if (s <= 0.0 || s >= uThighLen[leg]) continue;
            vec3 radial = rel - uThighD[leg] * s;
            float r = length(radial);
            float room = leg == 0 ? aSkirtFit.x : aSkirtFit.y;
            float pen = thighRadius(leg, s) - r - room;
            if (pen > 0.0 && r > 1e-4) {
              // eased in over the first few centimetres, so the hip joint does not crease the cloth
              transformed += radial / r * pen * aSkirtFit.z * smoothstep(0.0, 0.04, s);
            }
          }`);
    };
    mat.customProgramCacheKey = () => 'skirt-fit';
    skirt.material = mat;
  }

  /** the pelvis map's radius at a bind-space height and angle; the shader does the same */
  pelvisRadius(h: number, ang: number) {
    const b = this.box;
    let y = ((h - b.x) / (b.y - b.x)) * PH - 0.5;
    if (y < -0.5 || y > PH - 0.5) return 0;
    y = THREE.MathUtils.clamp(y, 0, PH - 1);
    const x = ((ang + Math.PI) / (2 * Math.PI)) * PA - 0.5;
    const y0 = Math.floor(y), y1 = Math.min(y0 + 1, PH - 1), x0 = Math.floor(x);
    const cell = (row: number, sector: number) => this.map[row * PA + (((sector % PA) + PA) % PA)];
    const r0 = THREE.MathUtils.lerp(cell(y0, x0), cell(y0, x0 + 1), x - x0);
    const r1 = THREE.MathUtils.lerp(cell(y1, x0), cell(y1, x0 + 1), x - x0);
    return THREE.MathUtils.lerp(r0, r1, y - y0);
  }

  /** where the thighs and the pelvis are this frame, relative to the skirt */
  private place() {
    this.legs.forEach((leg, k) => {
      this.skirt.worldToLocal(leg.hip.getWorldPosition(_a));
      this.skirt.worldToLocal(leg.knee.getWorldPosition(_b));
      leg.a.copy(_a); leg.len = _a.distanceTo(_b); leg.d.subVectors(_b, _a).normalize();
      this.uniforms.uThighA.value[k].copy(leg.a);
      this.uniforms.uThighD.value[k].copy(leg.d);
      this.uniforms.uThighLen.value[k] = leg.len;
    });
    // a point rigid with the pelvis skins to local = bindMatrixInverse * root * rootInverse * bind
    this.uniforms.uPelvisToLocal.value.copy(this.skirt.bindMatrixInverse).multiply(this.root.matrixWorld).multiply(this.rootBind);
    this.uniforms.uLocalToPelvis.value.copy(this.uniforms.uPelvisToLocal.value).invert();
  }

  /**
   * The first call records how much room each skirt vertex has in her standing pose, so it
   * must come after the clips and springs have posed her. Every later call just moves the
   * thighs and pelvis.
   */
  update() {
    this.place();
    if (this.primed) return;
    this.primed = true;
    const fit = this.skirt.geometry.attributes.aSkirtFit as THREE.BufferAttribute;
    const toPelvis = this.uniforms.uLocalToPelvis.value, b = this.box;
    for (let i = 0; i < fit.count; i++) {
      this.skirt.getVertexPosition(i, _v);
      this.legs.forEach((leg, k) => {
        _a.copy(_v).sub(leg.a);
        const s = _a.dot(leg.d);
        let room = 0;
        if (s > 0 && s < leg.len) room = Math.max(0, radiusAt(leg, s) - _a.addScaledVector(leg.d, -s).length());
        fit.setComponent(i, k, room);
      });
      _c.copy(_v).applyMatrix4(toPelvis);
      const dx = _c.x - b.z, dz = _c.z - b.w;
      fit.setW(i, Math.max(0, this.pelvisRadius(_c.y, Math.atan2(dx, dz)) - Math.hypot(dx, dz)));
    }
    fit.needsUpdate = true;
  }
}

/** null when the model has no separate skirt and body, so there is nothing to fit */
export function fitSkirt(model: THREE.Object3D) {
  let skirt: THREE.SkinnedMesh | undefined, body: THREE.SkinnedMesh | undefined;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    if (m.name === 'Skirt') skirt = m;
    if (m.name === 'Body') body = m;
  });
  return skirt && body ? new SkirtFit(skirt, body) : null;
}
