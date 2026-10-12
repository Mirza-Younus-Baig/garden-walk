/**
 * The birthday room. Composition root: builds the room, loads her, wires input, camera,
 * sound and the director, and runs the frame loop.
 *
 * Nothing here imports the garden (enforced by a test): the shared pieces are the girl
 * herself (girl/), the input and touch helpers, and the menu.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { Girl } from '../../girl/girl';
import { bindInput } from '../../input';
import { isTouch, layoutStage, bindTouch } from '../../mobile';
import { ROOM, LAYOUT, TUNING, GIRL_RADIUS } from './config';
import { NavWorld } from './core/nav';
import { Tasks } from './core/tasks';
import { PoseRig } from './girl/pose';
import { RoomCamera } from './camera';
import { createPost } from './post';
import { Audio } from './audio/audio';
import { Hud } from './ui/hud';
import { Director, type World } from './director';
import { buildShell } from './room/shell';
import { buildFurniture } from './room/furniture';
import { hangPaintings, PAINTINGS } from './room/paintings';
import { buildDecor, partyHat } from './room/decor';
import { setAnisotropy, sparkleSprite } from './room/textures';
import { TvShow } from './room/tv';
import { buildCake } from './cake/cake';
import { Flames } from './cake/flames';
import { buildBouquet, buildCard } from './cake/tableware';
import { Confetti, Sparkles } from './fx/fx';

const NAME = (new URLSearchParams(location.search).get('name') ?? 'Mithra').slice(0, 24);
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

// the garden's own overlays are not used here
document.getElementById('loading')?.remove();
document.getElementById('hint')?.remove();

const hud = new Hud(NAME, isTouch);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;           // tone mapping happens in the post chain
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
// Sharp first: a room is far cheaper than a meadow, so it renders at (or near) the
// screen's own resolution; the adaptive step only ever trims a little.
const maxPr = Math.min(devicePixelRatio, 2);
const PR = [1, 1.25, 1.5, 1.75, 2].filter((p) => p <= maxPr + 1e-3);
if (PR.length === 0) PR.push(maxPr);
const prFloor = isTouch ? Math.min(PR.length - 1, 1) : 0;
let prIdx = PR.length - 1;
let stage = layoutStage();
renderer.setPixelRatio(PR[prIdx]);
renderer.setSize(stage.w, stage.h);
document.body.appendChild(renderer.domElement);
RectAreaLightUniformsLib.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color('#120c10');
const cam = new RoomCamera(stage.w / stage.h);
const camera = cam.camera;

const manager = new THREE.LoadingManager();
const progress = { assets: 0, build: 0 };
const showProgress = () => hud.setProgress(progress.assets * 0.6 + progress.build * 0.4);
manager.onProgress = (_u, loaded, total) => { progress.assets = loaded / total; showProgress(); };
const gltfLoader = new GLTFLoader(manager);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
gltfLoader.setKTX2Loader(new KTX2Loader(manager).setTranscoderPath('/basis/').detectSupport(renderer));

const audio = new Audio(NAME);
const tasks = new Tasks();
const shadows = !isTouch;
let director: Director | null = null;
let world: World | null = null;
const girl = new Girl(gltfLoader, {
  tuning: TUNING,
  groundHeight: () => 0,
  collide: (p) => { if (nav) { const q = { x: p.x, z: p.z }; nav.resolve(q); p.x = q.x; p.z = q.z; } },
  postAnimate: () => pose?.update(),
});
let nav: NavWorld | null = null;
let pose: PoseRig | null = null;

// ---------------------------------------------------------------- build
async function build() {
  const girlLoad = girl.load();
  const bouquetLoad = buildBouquet(gltfLoader);
  await Promise.all([document.fonts.load('700 64px "Dancing Script"'), document.fonts.load('600 40px Fredoka')]).catch(() => {});
  const step = async (k: number) => { progress.build = k; showProgress(); await nextFrame(); };
  await step(0.05);
  const shell = buildShell();
  scene.add(shell.group);
  await step(0.25);
  const furn = buildFurniture();
  scene.add(furn.group);
  await step(0.45);
  const W = ROOM;
  scene.add(hangPaintings([
    { art: PAINTINGS.whaleInClouds, height: 0.66, frame: 'gold', pos: [2.35, 1.72, W.minZ + 0.012], rotY: 0 },
    { art: PAINTINGS.catAndMoon, height: 0.6, frame: 'walnut', mat: true, pos: [W.maxX - 0.012, 1.62, -0.75], rotY: -Math.PI / 2 },
    { art: PAINTINGS.lighthouse, height: 0.46, frame: 'white', mat: true, pos: [W.maxX - 0.012, 1.68, 0.05], rotY: -Math.PI / 2 },
    { art: PAINTINGS.sleepingFox, height: 0.44, frame: 'black', mat: true, pos: [W.maxX - 0.012, 1.6, 0.85], rotY: -Math.PI / 2 },
    { art: PAINTINGS.balloonsOverHills, height: 0.6, frame: 'gold', pos: [0.15, 1.6, W.maxZ - 0.012], rotY: Math.PI },
    { art: PAINTINGS.cutouts, height: 0.7, frame: 'white', pos: [-1.05, 1.55, W.maxZ - 0.012], rotY: Math.PI },
  ], renderer.capabilities.getMaxAnisotropy()));
  await step(0.6);
  const decor = buildDecor(NAME, shadows);
  scene.add(decor.group);
  await step(0.75);

  // ---- the table: cake, flowers, card
  const table = LAYOUT.table;
  const cake = buildCake(NAME);
  cake.group.position.set(LAYOUT.cake.x, table.h, LAYOUT.cake.z);
  cake.group.rotation.y = Math.PI / 2;
  scene.add(cake.group);
  cake.group.updateMatrixWorld(true);
  const flames = new Flames(cake.wickTops.map((p) => cake.group.localToWorld(p.clone())), { shadows });
  scene.add(flames.group);
  flames.onOut = () => audio.puff();
  const card = buildCard(NAME);
  card.position.set(LAYOUT.card.x, table.h, LAYOUT.card.z);
  card.rotation.y = Math.PI / 2 + 0.25;
  scene.add(card);
  const bouquet = await bouquetLoad;
  bouquet.position.set(LAYOUT.vase.x, table.h, LAYOUT.vase.z);
  scene.add(bouquet);

  // ---- light: the room is lit by its lamps; this is the bounce off warm walls
  scene.add(new THREE.HemisphereLight('#ffdcc2', '#2a1a20', 0.55));
  const win = LAYOUT.window;
  const moon = new THREE.RectAreaLight('#9db0ff', 2.2, win.w, win.h);
  moon.position.set(win.x, win.sill + win.h / 2, W.minZ + 0.06);
  moon.lookAt(win.x, win.sill + win.h / 2, 0);
  scene.add(moon);
  const tvShow = new TvShow(NAME);
  const tvLight = new THREE.RectAreaLight('#ffd6e4', 0, LAYOUT.tv.w, LAYOUT.tv.h);
  tvLight.position.set(W.minX + 0.08, LAYOUT.tv.y, LAYOUT.tv.z);
  tvLight.lookAt(0, LAYOUT.tv.y, LAYOUT.tv.z);
  scene.add(tvLight);
  const screenMat = furn.tvScreen.material as THREE.MeshPhysicalMaterial;
  screenMat.emissiveMap = tvShow.texture;
  const tv = {
    on: false,
    set(on: boolean) { this.on = on; screenMat.emissiveIntensity = on ? 1.6 : 0; tvLight.intensity = on ? 5 : 0; },
  };
  const lampState = {
    on: true,
    set(on: boolean) {
      this.on = on;
      for (const l of furn.lamp.bulbs) l.visible = on;
      (furn.lamp.shade.material as THREE.MeshPhysicalMaterial).emissiveIntensity = on ? 0.9 : 0.05;
    },
  };

  const confetti = new Confetti([
    { minX: table.x - table.depth / 2, maxX: table.x + table.depth / 2, minZ: table.z - table.len / 2, maxZ: table.z + table.len / 2, y: table.h },
    { minX: LAYOUT.sofa.x - LAYOUT.sofa.depth / 2, maxX: LAYOUT.sofa.x + LAYOUT.sofa.depth / 2, minZ: LAYOUT.sofa.z - LAYOUT.sofa.len / 2, maxZ: LAYOUT.sofa.z + LAYOUT.sofa.len / 2, y: LAYOUT.sofa.seatY },
    { minX: ROOM.minX, maxX: ROOM.minX + LAYOUT.stand.depth + 0.02, minZ: LAYOUT.stand.z - LAYOUT.stand.len / 2, maxZ: LAYOUT.stand.z + LAYOUT.stand.len / 2, y: LAYOUT.stand.h },
  ]);
  scene.add(confetti.mesh);
  const sparkles = new Sparkles();
  scene.add(sparkles.points);

  // ---- reflections: the room itself, seen from its middle, as the environment
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(scene, 0.035, 0.1, 20, { position: new THREE.Vector3(-0.5, 1.2, 0) });
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  await step(0.9);

  // ---- her
  await girlLoad;
  scene.add(girl.root);
  girl.pos.set(0.15, 0, 1.15);
  girl.yaw = Math.PI * 0.92;
  girl.root.position.copy(girl.pos); girl.root.rotation.y = girl.yaw;
  girl.root.updateMatrixWorld(true);
  pose = new PoseRig(girl.root, girl.model3d);
  // a party hat, set on her head at a jaunty angle
  const head = girl.model3d.getObjectByName('Head_M')!;
  const hat = partyHat(0.055, 0.15, '#f6a6bf', '#ffd59e');
  const hp = new THREE.Vector3(); head.getWorldPosition(hp);
  hat.position.set(hp.x + 0.015, hp.y + 0.15, hp.z - 0.01);
  hat.rotation.set(-0.12, 0, 0.18);
  scene.add(hat); head.attach(hat);
  hat.traverse((o) => { o.castShadow = true; });
  // the remote for the TV
  const remote = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 0.13), new THREE.MeshStandardMaterial({ color: '#1c1c20', roughness: 0.4 }));
  remote.visible = false;
  scene.add(remote);

  const colliders = [...furn.colliders, ...decor.colliders];
  nav = new NavWorld({ minX: ROOM.minX, maxX: ROOM.maxX, minZ: ROOM.minZ, maxZ: ROOM.maxZ }, colliders, GIRL_RADIUS, 0.08);

  // focus marker: a soft sparkle over whatever she can use
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkleSprite(128), color: new THREE.Color(1.6, 1.4, 1.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  marker.scale.setScalar(0.16);
  marker.visible = false;
  scene.add(marker);

  world = {
    girl, pose, nav, tasks, cam, audio, hud, flames, balloons: decor.balloons, gift: decor.gift, confetti, sparkles, sky: shell.sky,
    tv, lamp: lampState, remote,
    fairyBoost: (v) => { for (const f of decor.fairy) f.boost = v; },
    state: { candlesOut: false, giftOpen: false, seated: false, micOn: false, celebrated: 0 },
  };
  director = new Director(world, marker);
  const loop = makeLoop({ flames, decor, shell, tvShow, tv, record: furn.record, remote, confetti, sparkles });
  cam.setYaw(Math.PI * 0.08);
  progress.build = 1; showProgress();
  // first frames compile every shader; do it behind the loading screen
  renderer.compile(scene, camera);
  renderer.setAnimationLoop(loop);
  hud.hideLoading();
  hud.caption(`Welcome, ${NAME}! Walk to the cake when you're ready ✨`, 5);
  (window as any).__bday = {
    world, director, scene, renderer, camera, flames, audio, girl, pose, nav,
    act: (id: string, i = 0) => { const it = director!.items.find((x) => x.id === id)!; director!.perform(it, it.actions(world!)[i]); },
  };
  (window as any).__ready = true;
}

// ---------------------------------------------------------------- input
const input = bindInput(renderer.domElement, (dy) => cam.zoom(dy));
let moved = false;
if (isTouch) bindTouch(renderer.domElement, input, (dy) => cam.zoom(dy), () => { moved = true; });
addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.repeat || hud.cardOpen) return;
  if (e.code === 'KeyT') director?.gesture('twirl');
  if (e.code === 'KeyG') director?.gesture('wave');
});
addEventListener('pointerdown', () => audio.unlock(), { capture: true });

// stage coordinates (the page may be turned a quarter on a phone held upright)
const toStage = (x: number, y: number): [number, number] =>
  document.documentElement.classList.contains('rotated') ? [y, innerWidth - x] : [x, y];

// drag to look round, click or tap to go and use something
{
  const el = renderer.domElement;
  let id = -1, sx = 0, sy = 0, lx = 0, ly = 0, dragged = false;
  const raycaster = new THREE.Raycaster();
  el.addEventListener('pointerdown', (e) => {
    const [x, y] = toStage(e.clientX, e.clientY);
    // on a phone the left half belongs to the joystick
    if (e.pointerType !== 'mouse' && x < stage.w * 0.5) return;
    if (id !== -1) { id = -2; return; }          // a second finger: that is a pinch
    id = e.pointerId; sx = lx = x; sy = ly = y; dragged = false;
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const [x, y] = toStage(e.clientX, e.clientY);
    if (Math.hypot(x - sx, y - sy) > 6) dragged = true;
    if (dragged) cam.drag(x - lx, y - ly);
    lx = x; ly = y;
  });
  const up = (e: PointerEvent) => {
    if (id === -2) { id = -1; return; }
    if (e.pointerId !== id) return;
    id = -1;
    if (dragged || !director || hud.cardOpen) return;
    const [x, y] = toStage(e.clientX, e.clientY);
    raycaster.setFromCamera(new THREE.Vector2((x / stage.w) * 2 - 1, -(y / stage.h) * 2 + 1), camera);
    director.pick(raycaster.ray);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', () => { id = -1; });
}

hud.onSound = () => { audio.unlock(); audio.setMuted(!audio.muted); hud.setSound(!audio.muted); };
hud.onMic = async () => {
  if (!world) return;
  if (world.state.micOn) { audio.disableMic(); world.state.micOn = false; hud.setMic('off'); director?.setMic(null); return; }
  const ok = await audio.enableMic();
  world.state.micOn = ok;
  hud.setMic(ok ? 'on' : 'denied');
  hud.caption(ok ? 'Microphone on — blow at the cake to put the candles out 🎤' : 'No microphone — the E key works just as well', 4);
};

// ---------------------------------------------------------------- resize
const onResize = () => {
  stage = layoutStage();
  camera.aspect = stage.w / stage.h; camera.updateProjectionMatrix();
  renderer.setPixelRatio(PR[prIdx]);
  renderer.setSize(stage.w, stage.h);
  post?.setSize(stage.w, stage.h);
  sparklesScale();
};
addEventListener('resize', onResize);
if (isTouch) addEventListener('orientationchange', () => setTimeout(onResize, 250));

let post: ReturnType<typeof createPost> | null = null;
let sparklesScale = () => {};

// ---------------------------------------------------------------- frame loop
function makeLoop(o: {
  flames: Flames; decor: ReturnType<typeof buildDecor>; shell: ReturnType<typeof buildShell>; tvShow: TvShow;
  tv: { on: boolean }; record: THREE.Object3D; remote: THREE.Object3D; confetti: Confetti; sparkles: Sparkles;
}) {
  post = createPost(renderer, scene, camera, { mobile: isTouch, ao: !location.search.includes('noao') });
  post.setSize(stage.w, stage.h);
  sparklesScale = () => o.sparkles.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y / 900);
  sparklesScale();
  const clock = new THREE.Clock();
  const camFwd = new THREE.Vector3(), camRight = new THREE.Vector3(), move = new THREE.Vector3();
  const wrist = new THREE.Vector3();
  let ema = 16.7, warm = 0, cool = 0;
  return () => {
    const raw = clock.getDelta();
    // test hook: `__pause` freezes game time (screenshots take seconds in software GL)
    const dt = (window as any).__pause ? 0 : Math.min(raw, 1 / 20);
    const t = clock.elapsedTime;
    const w = world!, d = director!;
    // ---- walking, camera-relative, unless an action has her
    const wantsMove = input.move.lengthSq() > 1e-4;
    if (wantsMove) d.onMoveInput();
    if (!d.busy && !w.state.seated && wantsMove) {
      camera.getWorldDirection(camFwd); camFwd.y = 0; camFwd.normalize();
      camRight.set(-camFwd.z, 0, camFwd.x);
      move.set(0, 0, 0).addScaledVector(camFwd, input.move.y).addScaledVector(camRight, input.move.x);
      girl.setMoveDir(move.x, move.z, input.run);
    } else if (!d.busy) girl.setMoveDir(0, 0);
    tasks.update(dt);
    girl.update(dt);
    if (o.remote.visible) { pose!.wrist(false, wrist); o.remote.position.copy(wrist); o.remote.rotation.y = girl.yaw; }
    d.update(t);
    // ---- mic
    if (w.state.micOn) {
      const r = audio.listen(dt);
      if (r) { hud.setMic('on', r.calibrating ? 0 : Math.min(1, r.rms * 8)); d.setMic(r); }
    }
    // ---- room
    o.flames.update(dt, t, camera);
    o.decor.balloons.update(dt, t);
    for (const f of o.decor.fairy) f.update(t);
    o.shell.sky.update(dt, t);
    if (o.tv.on) o.tvShow.update(dt);
    if (audio.songPlaying) o.record.rotation.y -= dt * 3.5;
    o.confetti.update(dt);
    o.sparkles.update(dt);
    // the lanterns breathe very slightly, as paper does in warm air
    for (const l of o.decor.lanterns) l.group.rotation.y = Math.sin(t * 0.3 + l.group.position.x) * 0.15;
    // ---- lyrics in step with the song
    const st = audio.songTime;
    const line = st >= 0 ? audio.score.lyrics.find((l) => st >= l.t && st < l.end) : null;
    hud.lyric(line ? line.text : null, !!line?.name);
    if (!audio.songPlaying && w.state.celebrated) w.fairyBoost(0);
    cam.update(dt, girl.pos, girl.yaw, girl.speed > 0.15);
    const dbg = (window as any).__debugCam;   // test hook: { pos: [x,y,z], look: [x,y,z], fov? }
    if (dbg) { camera.position.fromArray(dbg.pos); camera.lookAt(dbg.look[0], dbg.look[1], dbg.look[2]); if (dbg.fov) { camera.fov = dbg.fov; camera.updateProjectionMatrix(); } }
    post!.render(dt);
    // ---- adaptive resolution: only ever a small trim, never below the floor
    warm += raw;
    if (warm > 3) {
      ema += (raw * 1000 - ema) * 0.05;
      cool -= raw;
      if (cool <= 0 && ema > 24 && prIdx > prFloor) { prIdx--; onResize(); cool = 2; ema = 16.7; }
      else if (cool <= 0 && ema < 14 && prIdx < PR.length - 1) { prIdx++; onResize(); cool = 4; ema = 16.7; }
    }
    void moved;
    const ww = window as any;
    ww.__fps = ww.__fps ? ww.__fps * 0.95 + (1 / Math.max(raw, 1e-3)) * 0.05 : 60;
    ww.__pr = PR[prIdx];
  };
}

build().catch((e) => {
  console.error(e);
  hud.caption('Something went wrong loading the room: ' + (e?.message ?? e), 0);
});
