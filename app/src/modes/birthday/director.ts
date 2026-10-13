import * as THREE from 'three';
import type { Girl } from '../../girl/girl';
import { Tasks, AbortedError, isAborted, smoother, smooth, easeOutBack, lerp } from './core/tasks';
import { chooseFocus, type FocusCandidate } from './core/focus';
import type { NavWorld } from './core/nav';
import { PoseRig, KNEEL, sitPreset, type ArmGoal } from './girl/pose';
import type { RoomCamera } from './camera';
import type { Audio } from './audio/audio';
import type { Hud, PromptAction } from './ui/hud';
import type { Flames } from './cake/flames';
import type { Balloons, Gift } from './room/decor';
import type { Confetti, Sparkles } from './fx/fx';
import type { NightSky } from './room/shell';
import { LAYOUT, ROOM } from './config';

/**
 * Who does what. Each object she can use is declared here with where she stands for it
 * and what she can do there; each action is a short script (an async function on game
 * time, see core/tasks.ts):
 *
 *   walk over (path round the furniture) -> line up on the spot -> the action -> hand back
 *
 * One action runs at a time. Moving the stick or a walk key cancels one that allows it, and
 * every script unwinds its pose and camera in `finally`, so nothing is ever left half-done.
 */

export interface World {
  girl: Girl;
  pose: PoseRig;
  nav: NavWorld;
  tasks: Tasks;
  cam: RoomCamera;
  audio: Audio;
  hud: Hud;
  flames: Flames;
  balloons: Balloons;
  gift: Gift;
  confetti: Confetti;
  sparkles: Sparkles;
  sky: NightSky;
  tv: { on: boolean; set(on: boolean): void };
  lamp: { on: boolean; set(on: boolean): void };
  /** a small remote that appears in her hand while she uses the TV */
  remote: THREE.Object3D;
  fairyBoost(v: number): void;
  /** the party has been had: candles out once */
  state: { candlesOut: boolean; giftOpen: boolean; seated: boolean; micOn: boolean; celebrated: number };
}

interface ActionDef { label: string; key: string; run: (w: World, s: AbortSignal) => Promise<void>; cancellable?: boolean }
interface Interactable extends FocusCandidate {
  title: string;
  anchor: { x: number; z: number; yaw: number };
  marker: THREE.Vector3;
  actions: (w: World) => ActionDef[];
  /** proxy for click/tap picking */
  hit: THREE.Box3;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const HALF = Math.PI / 2;
/** hands together under her chin, as when making a wish (her chest frame) */
const CLASP = V(0.02, 0.07, 0.25), CLASP_POLE = V(0.5, -0.45, -0.1), PRAYER = V(-0.15, 1, 0.35);

// ---------------------------------------------------------------- shared moves
/** walk to a spot along a path round the furniture, then turn to face `yaw` */
/** the most the final settle slides her: anything further is walked, never glided */
const SETTLE_MAX = 0.3;

async function goTo(w: World, s: AbortSignal, x: number, z: number, yaw: number) {
  const g = w.girl;
  const away = () => Math.hypot(x - g.pos.x, z - g.pos.z);
  // walk the path; if something blocked her short of the spot, plan again from where she
  // stands and walk once more
  for (let attempt = 0; attempt < 2 && away() > (attempt ? SETTLE_MAX : 0.04); attempt++) {
    const path = w.nav.findPath({ x: g.pos.x, z: g.pos.z }, { x, z }) ?? [{ x, z }];
    let stuck = 0, lastD = Infinity;
    for (let i = 0; i < path.length; i++) {
      const wp = path[i], last = i === path.length - 1;
      await w.tasks.each((dt) => {
        const dx = wp.x - g.pos.x, dz = wp.z - g.pos.z, d = Math.hypot(dx, dz);
        if (d < (last ? 0.04 : 0.22)) return true;
        // give up on a waypoint she cannot reach (something in the way) rather than push forever
        stuck = d < lastD - 0.002 ? 0 : stuck + dt; lastD = d;
        if (stuck > 1.2) return true;
        const pace = last ? THREE.MathUtils.clamp(d / 0.6, 0.22, 1) : 1;
        g.setMoveDir((dx / d) * pace, (dz / d) * pace);
        return false;
      }, s);
      lastD = Infinity; stuck = 0;
    }
    g.setMoveDir(0, 0);
  }
  // settle: let her come to rest, then turn on the spot and close the last centimetres.
  // The slide is capped, so a spot she could not reach is never reached through furniture.
  await w.tasks.until(() => g.speed < 0.05, 0.8, s);
  const y0 = g.yaw, p0 = g.pos.clone();
  const gap = Math.hypot(x - p0.x, z - p0.z), part = gap > SETTLE_MAX ? SETTLE_MAX / gap : 1;
  const tx = p0.x + (x - p0.x) * part, tz = p0.z + (z - p0.z) * part;
  let dy = yaw - y0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const dur = 0.25 + Math.abs(dy) * 0.22;
  await w.tasks.during(dur, (k) => {
    const e = smooth(k);
    g.yaw = y0 + dy * e;
    g.pos.x = lerp(p0.x, tx, e); g.pos.z = lerp(p0.z, tz, e);
  }, s);
}

const ease = (w: World, s: AbortSignal, sec: number, fn: (e: number) => void, curve = smoother) =>
  w.tasks.during(sec, (k) => fn(curve(k)), s);

/** blend an arm goal in from wherever it is */
function armTo(goal: ArmGoal, space: ArmGoal['space'], pos: THREE.Vector3, pole?: THREE.Vector3, fingers?: THREE.Vector3) {
  goal.space = space; goal.pos.copy(pos);
  if (pole) goal.pole.copy(pole);
  goal.fingers = fingers;
}

/** everything the pose layer does, eased back to nothing */
async function relax(w: World, s: AbortSignal | null, sec = 0.6) {
  const p = w.pose;
  const from = { body: p.bodyW, lean: p.lean, inh: p.inhale, blow: p.blow, L: p.arms.L.weight, R: p.arms.R.weight, look: p.lookW, bounce: p.bounce };
  await w.tasks.during(sec, (k) => {
    const e = 1 - smoother(k);
    p.bodyW = from.body * e; p.lean = from.lean * e; p.inhale = from.inh * e; p.blow = from.blow * e;
    p.arms.L.weight = from.L * e; p.arms.R.weight = from.R * e; p.lookW = from.look * e; p.bounce = from.bounce * e;
  }, s ?? undefined);
}

/** reach the right hand to a world point and back; `at` runs at full reach */
async function reach(w: World, s: AbortSignal, point: THREE.Vector3, at: () => void, hold = 0.25, lean = 0) {
  const R = w.pose.arms.R;
  armTo(R, 'world', point, V(0.45, -0.35, -0.2));
  w.pose.look.copy(point);
  await ease(w, s, 0.55, (e) => { R.weight = e; w.pose.lookW = e; w.pose.lean = lean * e; });
  at();
  await w.tasks.wait(hold, s);
  await ease(w, s, 0.5, (e) => { R.weight = 1 - e; w.pose.lean = lean * (1 - e); });
}

// ---------------------------------------------------------------- the actions
async function blowCandles(w: World, s: AbortSignal) {
  const { cake } = LAYOUT;
  const P = w.pose, F = w.flames;
  const cakeTop = V(cake.x, LAYOUT.table.h + 0.29, cake.z);
  await goTo(w, s, cake.x + 0.68, cake.z, -HALF);
  // a low, close shot across the candles to her face
  // across the candles to her face: high enough that her face is above the flames
  w.cam.setShot({ pos: V(cake.x - 0.95, 1.18, cake.z + 0.42), look: V(cake.x + 0.5, 0.82, cake.z - 0.02), fov: 42 }, 1.6);
  P.body = KNEEL;
  P.look.copy(cakeTop);
  await ease(w, s, 1.1, (e) => { P.bodyW = e; P.lookW = e * 0.8; P.lean = Math.sin(e * Math.PI) * 0.18; });

  // a wish: hands together under her chin, eyes on the flames
  const L = P.arms.L, R = P.arms.R;
  armTo(L, 'chest', CLASP, CLASP_POLE, PRAYER);
  armTo(R, 'chest', CLASP, CLASP_POLE, PRAYER);
  w.hud.caption('Make a wish… ✨', 2.6);
  w.audio.chime(84, [0, 7, 12, 16, 19, 24]);
  await ease(w, s, 0.8, (e) => { L.weight = R.weight = e * 0.95; P.lookW = 0.8 + 0.2 * e; });
  const head = new THREE.Vector3();
  for (let i = 0; i < 3; i++) { P.mouth(head); w.sparkles.emit(head.add(V(0, 0.18, 0)), 6, 0.35, 0.2); await w.tasks.wait(0.6, s); }

  // with the mic on, the breath is hers: wait for it
  let fromMic = false;
  if (w.state.micOn) {
    w.hud.caption('Now blow into your microphone! 💨', 0);
    fromMic = await w.tasks.until(() => !w.state.micOn || !!micBlow.reading?.blowing, 15, s) && w.state.micOn;
    w.hud.hideCaption();
  }

  // breathe in: hands glide down from her chin to her thighs, shoulders rise
  const lap = V(0.12, 0.06, 0.17);
  const fromL = P.wrist(true, V(0, 0, 0)), fromR = P.wrist(false, V(0, 0, 0));
  const toL = P.goalWorld('hips', lap, true, V(0, 0, 0)), toR = P.goalWorld('hips', lap, false, V(0, 0, 0));
  armTo(L, 'world', fromL, V(0.4, 0, -0.3)); armTo(R, 'world', fromR, V(0.4, 0, -0.3));
  if (!fromMic) w.audio.inhale(0.75);
  await ease(w, s, fromMic ? 0.4 : 0.75, (e) => {
    P.inhale = e; P.lean = -0.05 * e;
    L.pos.lerpVectors(fromL, toL, e); R.pos.lerpVectors(fromR, toR, e);
    L.weight = R.weight = 0.95 * (1 - e * 0.25);
  });
  // arrived: from here the hands rest on her lap wherever her hips go (she stands up later)
  armTo(L, 'hips', lap, V(0.4, 0, -0.3)); armTo(R, 'hips', lap, V(0.4, 0, -0.3));

  // and blow: lean in, the breath sweeps the candles
  const origin = new THREE.Vector3(), dir = new THREE.Vector3();
  const aim = () => { P.mouth(origin); dir.subVectors(F.centrePoint, origin).normalize(); F.breath.origin.copy(origin); F.breath.dir.copy(dir); };
  let tries = 0;
  for (;;) {
    if (!fromMic || tries === 0) w.audio.blow(1.25);
    await ease(w, s, 0.3, (e) => { P.inhale = 1 - e; P.blow = e; P.lean = lerp(-0.05, 0.13, e); P.lookW = lerp(1, 0.6, e); aim(); F.breath.strength = fromMic ? micStrength() : e; });
    await w.tasks.during(1.0, () => { aim(); F.breath.strength = fromMic ? micStrength() : 1; }, s);
    if (!fromMic) {
      // a determined blow gets them all: any that survived go out in a quick ripple
      const left = F.flames.map((f, i) => (f.lit ? i : -1)).filter((i) => i >= 0);
      for (const i of left) { F.extinguish(i); await w.tasks.wait(0.06, s); }   // (extinguish puffs)
    }
    await ease(w, s, 0.35, (e) => { F.breath.strength = (fromMic ? micStrength() : 1) * (1 - e); P.blow = 1 - e; P.lean = lerp(0.13, 0.06, e); P.lookW = lerp(0.6, 0.9, e); });
    F.breath.strength = 0;
    if (F.litCount === 0) break;
    // mic: a few candles may be left; she gets another go
    tries++;
    w.hud.caption(F.litCount === 1 ? 'One left! Blow again 💨' : `${F.litCount} left — blow again! 💨`, 0);
    const again = await w.tasks.until(() => !w.state.micOn || !!micBlow.reading?.blowing, 12, s) && w.state.micOn;
    w.hud.hideCaption();
    if (!again) fromMic = false;
  }
  w.state.candlesOut = true;
  await w.tasks.wait(0.45, s);
  await celebrate(w, s);
}

/** after the candles: poppers, confetti, the song, her name, and a happy clap */
async function celebrate(w: World, s: AbortSignal) {
  const P = w.pose, { table } = LAYOUT;
  w.state.celebrated++;
  w.audio.pop();
  w.confetti.burst(V(table.x - 0.2, 1.0, table.z + 0.9), V(0.2, 1, -0.6), 260, 4.2, 0.5);
  setTimeout(() => { w.audio.pop(); w.confetti.burst(V(table.x - 0.1, 1.0, table.z - 0.9), V(0.2, 1, 0.6), 260, 4.2, 0.5); }, 220);
  w.confetti.rain(table.x + 0.4, table.z, 1.8, ROOM.height - 0.1, 700);
  w.sparkles.emit(V(LAYOUT.cake.x, 0.9, LAYOUT.cake.z), 30, 0.9, 0.3);
  w.hud.banner('big');
  w.audio.playSong();
  // pull back to a wide view of the room
  w.cam.setShot({ pos: V(table.x + 2.3, 1.75, table.z + 2.5), look: V(table.x + 0.5, 0.75, table.z - 0.2), fov: 48 }, 1.8);
  // up on her feet, then clap along (everything eases from wherever it is)
  const b0 = P.bodyW, l0 = P.lean, wl0 = P.arms.L.weight, wr0 = P.arms.R.weight;
  await ease(w, s, 1.0, (e) => { P.bodyW = b0 * (1 - e); P.lean = l0 * (1 - e); P.inhale = 0; P.arms.L.weight = wl0 * (1 - e); P.arms.R.weight = wr0 * (1 - e); });
  await clapping(w, s, 7);
  w.cam.clearShot(1.6);
  // the banner settles to a small title after a while (cancelled if the candles are relit first)
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => w.hud.banner('small'), 6000);
}
let bannerTimer = 0;

async function clapping(w: World, s: AbortSignal, claps: number) {
  const P = w.pose, L = P.arms.L, R = P.arms.R;
  armTo(L, 'chest', V(0.1, 0.02, 0.26), V(0.5, -0.4, -0.1));
  armTo(R, 'chest', V(0.1, 0.02, 0.26), V(0.5, -0.4, -0.1));
  await ease(w, s, 0.35, (e) => { L.weight = R.weight = e; });
  const period = 0.36;
  for (let c = 0; c < claps; c++) {
    let clapped = false;
    await w.tasks.during(period, (k) => {
      // hands apart then together; the clap lands at the end of each beat
      const sep = 0.03 + 0.11 * Math.sin(k * Math.PI);
      L.pos.x = sep; R.pos.x = sep;
      P.bounce = 0.025 * Math.sin(k * Math.PI);
      if (!clapped && k > 0.92) { clapped = true; w.audio.clap(); }
    }, s);
  }
  await ease(w, s, 0.4, (e) => { L.weight = R.weight = 1 - e; P.bounce = 0; });
}

async function relight(w: World, s: AbortSignal) {
  const { cake } = LAYOUT, F = w.flames;
  await goTo(w, s, cake.x + 0.68, cake.z, -HALF);
  clearTimeout(bannerTimer);
  w.hud.banner('hidden');
  w.audio.stopSong(1.2);
  w.confetti.clear();
  const R = w.pose.arms.R;
  armTo(R, 'world', V(cake.x + 0.12, LAYOUT.table.h + 0.32, cake.z), V(0.45, -0.35, -0.2));
  w.pose.look.set(cake.x, LAYOUT.table.h + 0.25, cake.z);
  await ease(w, s, 0.6, (e) => { R.weight = e * 0.9; w.pose.lookW = e; w.pose.lean = 0.25 * e; });
  for (let i = 0; i < F.flames.length; i++) {
    // one by one round the ring, the hand following along
    const p = F.flames[i].pos;
    R.pos.set(p.x + 0.05, p.y + 0.06, p.z);
    F.light1(i); w.audio.strike();
    w.sparkles.emit(p, 3, 0.2, 0.01);
    await w.tasks.wait(0.2, s);
  }
  await ease(w, s, 0.5, (e) => { R.weight = 0.9 * (1 - e); w.pose.lean = 0.25 * (1 - e); });
  w.state.candlesOut = false;
  w.hud.caption('All lit again — ready for another wish 🕯️', 3);
}

async function readCard(w: World, s: AbortSignal) {
  const { card } = LAYOUT;
  await goTo(w, s, card.x + 0.62, card.z + 0.05, -HALF);
  await reach(w, s, V(card.x + 0.05, LAYOUT.table.h + 0.08, card.z), () => { w.audio.chime(76, [0, 4, 7]); }, 0.2, 0.3);
  w.pose.look.set(card.x, LAYOUT.table.h, card.z);
  await w.hud.showCard();
}

async function sit(w: World, s: AbortSignal) {
  const { sofa } = LAYOUT, P = w.pose;
  await goTo(w, s, sofa.x - 0.71, sofa.z, -HALF);
  P.body = sitPreset(sofa.seatY);
  const L = P.arms.L, R = P.arms.R;
  armTo(L, 'hips', V(0.12, 0.08, 0.26), V(0.25, -0.3, -0.35), V(0, -0.3, 1));
  armTo(R, 'hips', V(0.12, 0.08, 0.26), V(0.25, -0.3, -0.35), V(0, -0.3, 1));
  // sitting down: lean forward as the hips go back, then settle back into the cushions
  await ease(w, s, 1.25, (e) => { P.bodyW = e; P.lean = Math.sin(e * Math.PI) * 0.45; L.weight = R.weight = e * 0.85; });
  w.state.seated = true;
  P.look.set(-3.4, 1.4, LAYOUT.tv.z);
  await ease(w, s, 0.6, (e) => { P.lookW = e * 0.5; });
}

async function standUp(w: World, s: AbortSignal | null) {
  const P = w.pose;
  await w.tasks.during(1.1, (k) => {
    const e = smoother(k);
    P.bodyW = 1 - e; P.lean = Math.sin(e * Math.PI) * 0.5;
    P.arms.L.weight = P.arms.R.weight = 0.85 * (1 - e); P.lookW = 0.5 * (1 - e);
  }, s ?? undefined);
  w.state.seated = false;
}

async function toggleTv(w: World, s: AbortSignal) {
  await goTo(w, s, -2.72, LAYOUT.tv.z - 0.2, -HALF);
  w.remote.visible = true;
  await reach(w, s, V(-3.3, 1.25, LAYOUT.tv.z - 0.1), () => { w.audio.click(); w.tv.set(!w.tv.on); }, 0.35);
  w.remote.visible = false;
  if (w.tv.on) { w.pose.look.set(-3.5, LAYOUT.tv.y, LAYOUT.tv.z); await ease(w, s, 0.4, (e) => { w.pose.lookW = 0.6 * e; }); }
}

async function toggleLamp(w: World, s: AbortSignal) {
  const { lamp } = LAYOUT;
  await goTo(w, s, lamp.x - 0.48, lamp.z - 0.12, HALF);
  await reach(w, s, V(lamp.x - 0.04, 1.02, lamp.z), () => { w.audio.click(); w.lamp.set(!w.lamp.on); }, 0.2);
}

async function music(w: World, s: AbortSignal) {
  await goTo(w, s, -2.74, LAYOUT.record.z, -HALF);
  await reach(w, s, V(-3.24, 0.66, LAYOUT.record.z - 0.05), () => {
    w.audio.click();
    if (w.audio.songPlaying) w.audio.stopSong(); else w.audio.playSong();
  }, 0.25, 0.3);
}

async function openGift(w: World, s: AbortSignal) {
  const { gift } = LAYOUT, P = w.pose, G = w.gift;
  await goTo(w, s, gift.x, gift.z - 0.62, 0);
  // from the side, so both her face and the box are in view
  w.cam.setShot({ pos: V(gift.x - 1.25, 1.15, gift.z - 0.05), look: V(gift.x, 0.5, gift.z - 0.3), fov: 44 }, 1.4);
  P.body = KNEEL;
  P.look.set(gift.x, 0.4, gift.z);
  await ease(w, s, 1.0, (e) => { P.bodyW = e; P.lookW = e; P.lean = 0.25 * e; });
  // both hands on the lid
  const L = P.arms.L, R = P.arms.R;
  const lidW = new THREE.Vector3(); G.lid.getWorldPosition(lidW);
  armTo(L, 'world', lidW.clone().add(V(0.17, 0.02, -0.12)), V(0.5, -0.3, -0.2));
  armTo(R, 'world', lidW.clone().add(V(-0.17, 0.02, -0.12)), V(0.5, -0.3, -0.2));
  await ease(w, s, 0.6, (e) => { L.weight = R.weight = e; P.lean = 0.25 + 0.2 * e; });
  // the lid lifts, flips and lands beside the box
  const lid = G.lid, p0 = lid.position.clone(), r0 = lid.rotation.clone();
  w.audio.chime(79, [0, 4, 7, 11, 14, 19]);
  const sp = new THREE.Vector3();
  const lidUp = w.tasks.during(1.1, (k) => {
    const e = smooth(k);
    lid.position.set(p0.x + 0.42 * e, p0.y + Math.sin(e * Math.PI) * 0.35 - 0.33 * e, p0.z - 0.1 * e);
    lid.rotation.set(r0.x - 0.9 * Math.sin(e * Math.PI) * 0.6, r0.y + 0.6 * e, r0.z - 0.25 * e);
  }, s);
  const yL = L.pos.y, yR = R.pos.y;
  await ease(w, s, 0.4, (e) => { L.pos.y = yL + 0.06 * e; R.pos.y = yR + 0.06 * e; L.weight = R.weight = 1 - e * 0.6; });
  await lidUp;
  // and up pops the teddy, with sparkles
  const T = G.teddy;
  T.visible = true;
  sp.set(LAYOUT.gift.x, 0.55, LAYOUT.gift.z);
  w.sparkles.emit(sp, 40, 0.9, 0.15);
  w.audio.pop();
  await ease(w, s, 0.9, (e) => { T.scale.setScalar(Math.max(0.001, e)); T.position.y = 0.06 + 0.26 * e; }, (k) => easeOutBack(k, 2.2));
  w.state.giftOpen = true;
  w.hud.caption('A little friend for you! 🧸', 3.2);
  await ease(w, s, 0.4, (e) => { L.weight = R.weight = 0.4 * (1 - e); P.lean = 0.45 * (1 - e) + 0.1 * e; });
  await clapping(w, s, 3);
  await ease(w, s, 0.9, (e) => { P.bodyW = 1 - e; P.lean = 0.1 * (1 - e); P.lookW = 1 - e; });
  w.cam.clearShot();
}

async function greetTeddy(w: World, s: AbortSignal) {
  const { gift } = LAYOUT;
  await goTo(w, s, gift.x, gift.z - 0.68, 0);
  w.pose.look.set(gift.x, 0.62, gift.z);
  await ease(w, s, 0.4, (e) => { w.pose.lookW = e; });
  const T = w.gift.teddy;
  const wiggle = w.tasks.during(1.6, (k) => { T.rotation.z = Math.sin(k * Math.PI * 6) * 0.18 * (1 - k); T.rotation.y = Math.sin(k * Math.PI * 2) * 0.3; }, s);
  wiggle.catch(() => {});            // an abort is handled below, through waving()
  w.audio.boing();
  try { await waving(w, s, 1.6); await wiggle; } finally { T.rotation.set(0, 0, 0); }
}

async function bopBalloons(w: World, s: AbortSignal) {
  const { balloons } = LAYOUT;
  const ax = balloons.x + 0.62, az = balloons.z + 0.6;
  await goTo(w, s, ax, az, Math.atan2(balloons.x - ax, balloons.z - az));
  await reach(w, s, V(balloons.x + 0.3, 1.75, balloons.z + 0.3), () => {
    w.balloons.bop(V(balloons.x + 0.2, 1.6, balloons.z + 0.2), 1.8);
    w.audio.boing();
  }, 0.15);
}

async function stargaze(w: World, s: AbortSignal) {
  const win = LAYOUT.window;
  await goTo(w, s, win.x, ROOM.minZ + 0.62, Math.PI);
  w.cam.setShot({ pos: V(win.x + 0.55, 1.62, ROOM.minZ + 1.75), look: V(win.x - 0.1, 1.72, ROOM.minZ - 1.5), fov: 44 }, 1.5);
  const P = w.pose;
  P.look.set(win.x - 0.4, 2.3, ROOM.minZ - 2);
  await ease(w, s, 0.8, (e) => { P.lookW = e; });
  await w.tasks.wait(0.8, s);
  w.sky.shootingStar();
  await w.tasks.wait(0.6, s);
  w.hud.caption('A shooting star! Quick — make a wish 🌠', 3.4);
  w.audio.chime(86, [0, 4, 7, 12, 16, 19, 24]);
  armTo(P.arms.L, 'chest', CLASP, CLASP_POLE, PRAYER);
  armTo(P.arms.R, 'chest', CLASP, CLASP_POLE, PRAYER);
  await ease(w, s, 0.6, (e) => { P.arms.L.weight = P.arms.R.weight = 0.95 * e; });
  await w.tasks.wait(2.4, s);
  await ease(w, s, 0.6, (e) => { P.arms.L.weight = P.arms.R.weight = 0.95 * (1 - e); P.lookW = 1 - e; });
  w.cam.clearShot();
}

async function waving(w: World, s: AbortSignal, sec = 1.8) {
  const R = w.pose.arms.R;
  armTo(R, 'chest', V(0.28, 0.36, 0.12), V(0.6, -0.5, -0.1));
  await ease(w, s, 0.35, (e) => { R.weight = e; });
  await w.tasks.during(sec, (k) => { R.pos.x = 0.28 + 0.07 * Math.sin(k * Math.PI * 2 * sec * 1.6); }, s);
  await ease(w, s, 0.35, (e) => { R.weight = 1 - e; });
}

async function twirl(w: World, s: AbortSignal) {
  const P = w.pose, g = w.girl, L = P.arms.L, R = P.arms.R;
  armTo(L, 'chest', V(0.42, -0.1, 0.12), V(0.3, -0.6, -0.3));
  armTo(R, 'chest', V(0.42, -0.1, 0.12), V(0.3, -0.6, -0.3));
  w.audio.whoosh();
  const y0 = g.yaw;
  const feet = g.pos.clone().add(V(0, 0.05, 0));
  await w.tasks.during(1.25, (k) => {
    const e = smoother(k);
    g.yaw = y0 + e * Math.PI * 2;
    L.weight = R.weight = Math.sin(k * Math.PI) * 0.9;
    P.bounce = -0.03 * Math.sin(k * Math.PI);
    if (Math.random() < 0.4) w.sparkles.emit(feet, 1, 0.5, 0.3);
  }, s);
  g.yaw = y0;
  P.bounce = 0;
}

// ---------------------------------------------------------------- the director
const micBlow: { reading: { blowing: boolean; strength: number } | null } = { reading: null };
const micStrength = () => (micBlow.reading?.blowing ? Math.max(0.55, micBlow.reading.strength) : 0);

export class Director {
  busy = false;
  private ctrl: AbortController | null = null;
  private cancellable = false;
  private focus: string | null = null;
  readonly items: Interactable[];
  private marker: THREE.Sprite;
  private cardHit = new THREE.Box3(
    V(LAYOUT.card.x - 0.1, LAYOUT.table.h - 0.01, LAYOUT.card.z - 0.1), V(LAYOUT.card.x + 0.1, LAYOUT.table.h + 0.12, LAYOUT.card.z + 0.1));

  constructor(private w: World, marker: THREE.Sprite) {
    this.marker = marker;
    const { cake, sofa, tv, lamp, gift, balloons, record, window: win, table } = LAYOUT;
    const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) => new THREE.Box3(V(cx - sx / 2, cy - sy / 2, cz - sz / 2), V(cx + sx / 2, cy + sy / 2, cz + sz / 2));
    this.items = [
      {
        id: 'cake', title: 'The birthday cake', x: cake.x, z: cake.z, radius: 1.35,
        anchor: { x: cake.x + 0.68, z: cake.z, yaw: -HALF }, marker: V(cake.x, table.h + 0.62, cake.z),
        hit: box(table.x, table.h / 2 + 0.1, table.z, table.depth, table.h + 0.4, table.len),
        actions: (w) => [
          w.state.candlesOut || w.flames.litCount === 0
            ? { label: 'Light the candles again', key: 'e', run: relight }
            : { label: 'Make a wish & blow', key: 'e', run: blowCandles },
          { label: 'Read the card', key: 'r', run: readCard, cancellable: true },
        ],
      },
      {
        id: 'sofa', title: 'The comfy sofa', x: sofa.x - 0.3, z: sofa.z, radius: 1.25,
        anchor: { x: sofa.x - 0.71, z: sofa.z, yaw: -HALF }, marker: V(sofa.x, 1.15, sofa.z),
        hit: box(sofa.x, 0.4, sofa.z, sofa.depth, 0.8, sofa.len),
        actions: (w) => [w.state.seated ? { label: 'Stand up', key: 'e', run: (ww, ss) => standUp(ww, ss) } : { label: 'Sit down', key: 'e', run: sit }],
      },
      {
        id: 'tv', title: 'The TV', x: -2.9, z: tv.z, radius: 1.3,
        anchor: { x: -2.72, z: tv.z - 0.2, yaw: -HALF }, marker: V(ROOM.minX + 0.3, tv.y + tv.h / 2 + 0.18, tv.z),
        hit: box(ROOM.minX + 0.1, tv.y, tv.z, 0.2, tv.h, tv.w),
        actions: (w) => [{ label: w.tv.on ? 'Turn the TV off' : 'Turn the TV on', key: 'e', run: toggleTv, cancellable: true }],
      },
      {
        id: 'music', title: 'The record player', x: -2.95, z: record.z, radius: 0.95,
        anchor: { x: -2.74, z: record.z, yaw: -HALF }, marker: V(ROOM.minX + 0.25, 0.85, record.z),
        hit: box(ROOM.minX + 0.25, 0.6, record.z, 0.45, 0.25, 0.5),
        actions: (w) => [{ label: w.audio.songPlaying ? 'Stop the music' : 'Play the birthday song', key: 'e', run: music, cancellable: true }],
      },
      {
        id: 'lamp', title: 'The floor lamp', x: lamp.x, z: lamp.z, radius: 1.1,
        anchor: { x: lamp.x - 0.48, z: lamp.z - 0.12, yaw: HALF }, marker: V(lamp.x, 2.0, lamp.z),
        hit: box(lamp.x, 0.9, lamp.z, 0.5, 1.8, 0.5),
        actions: (w) => [{ label: w.lamp.on ? 'Switch the lamp off' : 'Switch the lamp on', key: 'e', run: toggleLamp, cancellable: true }],
      },
      {
        id: 'gift', title: 'A present', x: gift.x, z: gift.z, radius: 1.2,
        anchor: { x: gift.x, z: gift.z - 0.62, yaw: 0 }, marker: V(gift.x, 0.85, gift.z),
        hit: box(gift.x, 0.25, gift.z + 0.05, 0.9, 0.6, 0.7),
        actions: (w) => [w.state.giftOpen ? { label: 'Say hi to Teddy', key: 'e', run: greetTeddy, cancellable: true } : { label: 'Open the present', key: 'e', run: openGift }],
      },
      {
        id: 'balloons', title: 'Balloons', x: balloons.x + 0.3, z: balloons.z + 0.3, radius: 1.2,
        anchor: { x: balloons.x + 0.62, z: balloons.z + 0.6, yaw: 0 }, marker: V(balloons.x + 0.2, 2.45, balloons.z + 0.2),
        hit: box(balloons.x + 0.15, 1.5, balloons.z + 0.15, 0.9, 1.2, 0.9),
        actions: () => [{ label: 'Bop the balloons', key: 'e', run: bopBalloons, cancellable: true }],
      },
      {
        id: 'window', title: 'The window', x: win.x, z: ROOM.minZ + 0.5, radius: 1.15,
        anchor: { x: win.x, z: ROOM.minZ + 0.62, yaw: Math.PI }, marker: V(win.x, win.sill + win.h + 0.05, ROOM.minZ + 0.25),
        hit: box(win.x, win.sill + win.h / 2, ROOM.minZ, win.w, win.h, 0.3),
        actions: () => [{ label: 'Look at the stars', key: 'e', run: stargaze, cancellable: true }],
      },
    ];
  }

  /** run an action of an object; ignored while another runs */
  perform(item: Interactable, a: ActionDef) {
    if (this.busy) return;
    // from the sofa, getting up comes first
    const needsStand = this.w.state.seated && item.id !== 'sofa';
    this.busy = true;
    // getting up off the sofa always finishes; the action after it may be cancellable
    this.cancellable = !needsStand && !!a.cancellable;
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.w.hud.setPrompt(null, []);
    this.marker.visible = false;
    let aborted = false;
    (async () => {
      try {
        if (needsStand) { await standUp(this.w, ctrl.signal); this.cancellable = !!a.cancellable; }
        await a.run(this.w, ctrl.signal);
      } catch (e) {
        aborted = true;
        if (!isAborted(e)) console.error(e);
      } finally {
        this.w.girl.setMoveDir(0, 0);
        this.w.flames.breath.strength = 0;
        this.w.remote.visible = false;
        if (!this.w.state.seated) await relax(this.w, null, 0.5).catch(() => {});
        this.w.cam.clearShot();
        // a finished action's closing caption runs its own course
        if (aborted) this.w.hud.hideCaption();
        this.busy = false; this.ctrl = null;
      }
    })();
  }

  /** a global move (twirl, wave), not tied to an object */
  gesture(kind: 'twirl' | 'wave') {
    if (this.busy || this.w.state.seated) return;
    const run = kind === 'twirl' ? twirl : (w: World, s: AbortSignal) => waving(w, s);
    this.perform({ id: kind } as Interactable, { label: kind, key: '', run, cancellable: true });
  }

  /** the player pushed the stick or a walk key */
  onMoveInput() {
    if (this.busy && this.cancellable) this.ctrl?.abort(new AbortedError());
    if (!this.busy && this.w.state.seated) {
      this.perform({ id: 'sofa' } as Interactable, { label: 'stand', key: '', run: (w, s) => standUp(w, s) });
    }
  }

  /** a click or tap in the room: if it lands on something, go and use it */
  pick(ray: THREE.Ray) {
    const p = new THREE.Vector3();
    // the card lies on the cake's table: a tap on it reads it rather than blowing the candles
    if (ray.intersectBox(this.cardHit, p)) {
      const cake = this.items[0];
      const read = cake.actions(this.w).find((a) => a.run === readCard);
      if (read) { this.perform(cake, read); return true; }
    }
    let best: Interactable | null = null, bestD = Infinity;
    for (const it of this.items) {
      if (ray.intersectBox(it.hit, p)) { const d = p.distanceTo(ray.origin); if (d < bestD) { bestD = d; best = it; } }
    }
    if (!best) return false;
    const a = best.actions(this.w)[0];
    if (a) this.perform(best, a);
    return true;
  }

  /** feed the mic reading in (null when the mic is off) */
  setMic(r: { blowing: boolean; strength: number } | null) {
    micBlow.reading = r;
    // with the mic on, blowing near the cake starts the whole thing
    if (r?.blowing && !this.busy && this.focus === 'cake' && this.w.flames.litCount > 0) {
      const cake = this.items[0];
      this.perform(cake, cake.actions(this.w)[0]);
    }
  }

  /** every frame: what is she next to, and what can she do there */
  update(t: number) {
    const g = this.w.girl;
    if (this.busy) return;
    const id = chooseFocus(this.items, g.pos.x, g.pos.z, g.yaw, this.focus);
    this.focus = id;
    const item = id ? this.items.find((i) => i.id === id)! : null;
    if (!item) { this.w.hud.setPrompt(null, []); this.marker.visible = false; return; }
    const acts: PromptAction[] = item.actions(this.w).map((a) => ({ label: a.label, key: a.key, run: () => this.perform(item, a) }));
    this.w.hud.setPrompt(item.title, acts);
    this.marker.visible = true;
    this.marker.position.copy(item.marker).add(V(0, 0.04 * Math.sin(t * 2.4), 0));
    this.marker.material.rotation = t * 0.6;
  }

  get focused() { return this.focus; }
}
