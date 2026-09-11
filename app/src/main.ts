// Keyboard-walk garden. WASD or the arrow keys walk her, relative to the camera. Scroll: zoom.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { Ground } from './world/ground';
import { makeSky, type Sky } from './world/sky';
import { Birds } from './world/birds';
import { createTimeUI } from './ui/timeui';
import { createCompass } from './ui/compass';
import { FlowerField } from './flowers/field';
import { flowerUniforms } from './flowers/shader';
import { Girl } from './girl/girl';
import { FollowCamera } from './camera/follow';
import { bindInput, groundPoint } from './input';
import { isTouch, layoutStage, bindTouch } from './mobile';
import { CONFIG } from './config';

const overlay = document.getElementById('loading')!;
const bar = document.getElementById('bar')!;
// The key hint sits at the bottom until she first walks, then leaves for good.
const hint = document.getElementById('hint');
let hintGone = false;
const dismissHint = () => {
  if (!hint || hintGone) return;
  hintGone = true;
  hint.classList.add('fade'); setTimeout(() => hint.remove(), 1000);
};
addEventListener('keydown', function dismiss(e) {
  if (!/^(Key[WASD]|Arrow)/.test(e.code)) return;
  dismissHint();
  removeEventListener('keydown', dismiss);
});

// Phones: a lighter tier. Their GPUs are a fraction of a desktop's and triangles are what
// this scene is bound by, so detail levels step down sooner; the screen is small enough
// that the nearer switch does not read.
if (isTouch) for (const k in CONFIG.lod) CONFIG.lod[k as keyof typeof CONFIG.lod] = CONFIG.lod[k as keyof typeof CONFIG.lod].map((d) => d * 0.8);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
/**
 * Adaptive resolution. A meadow this dense is fill-rate bound, and how much of it a
 * machine can afford depends on the GPU and the window size, so the renderer trades
 * resolution for frame rate rather than letting the frame rate sag. Steps are coarse and
 * rate-limited, because resizing the drawing buffer is itself not free.
 */
const basePixelRatio = Math.min(devicePixelRatio, isTouch ? 1.5 : 1.75);
// Phones get a lower floor and start part-way down, climbing only if the frame allows.
const PR_STEPS = (isTouch ? [0.5, 0.6, 0.72, 0.85, 1.0] : [0.60, 0.72, 0.85, 1.0]).map((f) => basePixelRatio * f);
// `?pr=0.72` pins the ratio, so two measurements can be compared at the same resolution
const lockPr = parseFloat(new URLSearchParams(location.search).get('pr') ?? '');
if (!isNaN(lockPr)) PR_STEPS.length = 0, PR_STEPS.push(lockPr * basePixelRatio);
let prIdx = isTouch ? Math.min(2, PR_STEPS.length - 1) : PR_STEPS.length - 1;
// The stage is the window, except on a phone held upright, where it is the window turned
// sideways (see mobile.ts).
let stage = layoutStage();
const applySize = () => {
  renderer.setPixelRatio(PR_STEPS[prIdx]);
  renderer.setSize(stage.w, stage.h);
};
applySize();
renderer.shadowMap.enabled = !location.search.includes('noshadow'); renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const follow = new FollowCamera(stage.w / stage.h);
const camera = follow.camera;

const manager = new THREE.LoadingManager();
manager.onProgress = (_u, loaded, total) => { bar.style.width = `${Math.round((loaded / total) * 100)}%`; };
const gltfLoader = new GLTFLoader(manager);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const ktx2 = new KTX2Loader(manager).setTranscoderPath('/basis/').detectSupport(renderer);
gltfLoader.setKTX2Loader(ktx2);
const texLoader = new THREE.TextureLoader(manager);

const ground = new Ground();
const field = new FlowerField(gltfLoader);
const girl = new Girl(gltfLoader);
const birds = new Birds(gltfLoader);
const input = bindInput(renderer.domElement, (dy) => follow.onWheel(dy));
if (isTouch) bindTouch(renderer.domElement, input, (dy) => follow.onWheel(dy), dismissHint);

let sky: Sky | null = null;
let updateClockUI: (() => void) | null = null;
let updateCompass: ((camera: THREE.Camera) => void) | null = null;

(async () => {
  const [groundMesh, builtSky] = await Promise.all([
    ground.build(texLoader), makeSky(scene, renderer, manager), field.load(), girl.load(), birds.load(),
  ]);
  sky = builtSky;
  updateClockUI = createTimeUI(sky.dayNight, location.search.includes('dev'), !location.search.includes('noclock'));
  if (!location.search.includes('nocompass')) updateCompass = createCompass(sky.dayNight);
  (window as any).__sky = sky;
  scene.add(groundMesh); scene.add(field.group); scene.add(girl.root); scene.add(birds.group);
  (window as any).__cfg = CONFIG;
  (window as any).__follow = follow; (window as any).__renderer = renderer; (window as any).__scene = scene; (window as any).__girl = girl; (window as any).__field = field; (window as any).__camera = camera; (window as any).__birds = birds;
  overlay.classList.add('hide');
  setTimeout(() => overlay.remove(), 900);
  if (hint) { hint.hidden = false; setTimeout(() => hint.classList.add('show'), 700); }
  (window as any).__ready = true;
})().catch((e) => { overlay.textContent = 'Failed to load: ' + e; console.error(e); });

const onResize = () => {
  stage = layoutStage();
  camera.aspect = stage.w / stage.h; camera.updateProjectionMatrix();
  applySize();
};
addEventListener('resize', onResize);
// iOS can report the old size in the resize that accompanies a rotation, so look again
// once the rotation has settled.
if (isTouch) addEventListener('orientationchange', () => setTimeout(onResize, 250));

// `?stats` shows what the view-allocated field is actually drawing; off by default so
// the garden stays uncluttered.
const statsEl = location.search.includes('stats') ? (() => {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9;font:12px ui-monospace,monospace;' +
    'color:#fff;background:rgba(0,0,0,.45);padding:4px 8px;border-radius:5px;pointer-events:none';
  document.body.appendChild(el); return el;
})() : null;
let lastStats = 0;
const prof = location.search.includes('prof');

let ema = 16.7, prCooldown = 0, warm = 0, upDwell = 0, demoted = 0, sinceUp = 1e3, demoteBlock = 20;

const clock = new THREE.Clock();
const gp = new THREE.Vector3();
const camFwd = new THREE.Vector3(), camRight = new THREE.Vector3(), moveWorld = new THREE.Vector3();
let frames = 0, fpsT = 0;
renderer.setAnimationLoop(() => {
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.05);   // clamped for physics; `raw` is what the frame really took
  const t = clock.elapsedTime;
  if (!(window as any).__ready) return;
  // Walk keys are camera-relative: 'forward' is always away from the viewer, whichever
  // way the follow camera has swung. Right is forward x up = (-fz, 0, fx).
  if (input.move.lengthSq() > 1e-6) {
    camera.getWorldDirection(camFwd); camFwd.y = 0;
    if (camFwd.lengthSq() < 1e-6) camFwd.set(0, 0, -1); else camFwd.normalize();
    camRight.set(-camFwd.z, 0, camFwd.x);
    moveWorld.set(0, 0, 0)
      .addScaledVector(camFwd, input.move.y)
      .addScaledVector(camRight, input.move.x);
    girl.setMoveDir(moveWorld.x, moveWorld.z, input.run);
  } else {
    girl.setMoveDir(0, 0);
  }
  if (input.hasPointer && groundPoint(camera, input.ndc, gp)) flowerUniforms.uHover.value.copy(gp);
  const g0 = prof ? performance.now() : 0;
  girl.update(dt);
  const girlMs = prof ? performance.now() - g0 : 0;
  ground.follow(girl.pos.x, girl.pos.z);
  follow.update(dt, girl.pos, girl.yaw, girl.vel, girl.speed > 0.1);
  const dbg = (window as any).__debugCam; // test hook: { pos:[x,y,z], look:[x,y,z] }
  if (dbg) { camera.position.set(dbg.pos[0], dbg.pos[1], dbg.pos[2]); camera.lookAt(dbg.look[0], dbg.look[1], dbg.look[2]); }
  const p0 = prof ? performance.now() : 0;
  field.update(dt, t, girl, camera, prof);
  const p1 = prof ? performance.now() : 0;
  sky!.update(t, camera, girl.pos);
  birds.update(dt, t, camera, girl.pos, sky!.dayNight.daylight);
  // Halo. Squared so it stays out of the way through dusk and only arrives once it is
  // properly dark, rather than fading up the moment the sun touches the horizon.
  const night = 1 - sky!.dayNight.daylight;
  const haloAmt = night * night;
  girl.halo.intensity = 1.1 * haloAmt;
  flowerUniforms.uHaloPos.value.set(girl.pos.x, girl.pos.y + 0.55, girl.pos.z);
  // The halo now multiplies each plant's own albedo, so it needs more gain than a flat
  // additive term did to read at the same brightness.
  flowerUniforms.uHaloStrength.value = 0.95 * haloAmt;
  updateClockUI!();
  updateCompass?.(camera);
  renderer.render(scene, camera);
  if (prof) {
    const w2 = window as any;
    if (!w2.__p) w2.__p = { field: 0, render: 0, girl: 0, n: 0, stream: 0, lod: 0, contact: 0 };
    const p2 = performance.now();
    if (w2.__p.n++ > 3) {
      w2.__p.field = Math.max(w2.__p.field, p1 - p0);
      w2.__p.render = Math.max(w2.__p.render, p2 - p1);
      w2.__p.girl = Math.max(w2.__p.girl, girlMs);
      w2.__p.stream = Math.max(w2.__p.stream, field.prof.stream);
      w2.__p.lod = Math.max(w2.__p.lod, field.prof.lod);
      w2.__p.contact = Math.max(w2.__p.contact, field.prof.contact);
    }
  }
  frames++; fpsT += dt; if (fpsT > 2) { (window as any).__fps = frames / fpsT; frames = 0; fpsT = 0; }

  // ---- adaptive resolution
  // Thresholds are absolute rather than measured against the display's refresh: an
  // estimated refresh period is easy to get wrong (a few frames arriving early after a
  // stall drag it down, and then every vsync-paced frame looks "too slow"), and these two
  // work on 60 Hz and 120 Hz alike. The aim is simply to hold at least ~45 fps. Stepping
  // down blocks climbing back for a while, so a level that has just failed is not retried
  // immediately and the resolution settles instead of oscillating.
  warm += dt;
  if (warm > 2.5) {
    ema += (raw * 1000 - ema) * 0.05;
    prCooldown -= dt;
    upDwell = ema < 18 ? upDwell + dt : 0;
    demoted = Math.max(0, demoted - dt);
    sinceUp += dt;
    if (prCooldown <= 0) {
      if (ema > 22 && prIdx > 0) {
        // A step down straight after a step up means that level is simply unaffordable, so
        // back off from probing it: otherwise the loop keeps retrying and each retry costs
        // a visible dip.
        if (sinceUp < 8) demoteBlock = Math.min(240, demoteBlock * 2);
        prIdx--; applySize(); prCooldown = 1.5; ema = 16.7; upDwell = 0; demoted = demoteBlock;
      } else if (upDwell > 3 && demoted === 0 && prIdx < PR_STEPS.length - 1) {
        prIdx++; applySize(); prCooldown = 3.0; ema = 16.7; upDwell = 0; sinceUp = 0;
      }
    }
    (window as any).__pr = PR_STEPS[prIdx];
  }
  if (statsEl && t - lastStats > 0.4) {
    lastStats = t;
    const s = field.stats();
    statsEl.textContent = `${s.visible.toLocaleString()} plants in view  |  ` +
      Object.entries(s.byType).map(([k, v]) => `${k} ${v}`).join('  ') +
      `  |  ${Math.round((window as any).__fps ?? 0)} fps  ${(renderer.info.render.triangles / 1e6).toFixed(2)}M tris`;
  }
  // Frame-time spikes matter more than average fps: a hitch while streaming a new strip
  // of meadow is exactly what reads as "not smooth". `dt` is clamped for the simulation,
  // so the real frame time has to be measured from the unclamped delta.
  const w = window as any;
  if (!w.__ft) w.__ft = { max: 0, over: 0, n: 0, hist: new Uint32Array(200) };
  if (w.__ft.n > 20) {
    const ms = raw * 1000;
    w.__ft.max = Math.max(w.__ft.max, ms);
    if (ms > 33) w.__ft.over++;
    w.__ft.hist[Math.min(199, ms | 0)]++;
  }
  w.__ft.n++;
});
