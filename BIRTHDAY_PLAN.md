# Build plan — Birthday Room mode

Companion to `PLAN.md` (garden). Status: **proposal, not started**.

## 1. Requirements

| # | Requirement | Interpretation / acceptance criterion |
|---|---|---|
| R1 | User selects a mode | Start screen with *Garden* and *Birthday Room*; deep-linkable (`?mode=birthday`); a way back to the menu from inside each mode. |
| R2 | Separate module, garden unaffected | Birthday code lives under `src/modes/birthday/`, is loaded with a dynamic `import()`, and is never in the garden's bundle. Garden behaviour, visuals and frame times are unchanged (verified by the existing shot/mobile tools before and after). |
| R3 | Girl in a furnished room, free movement | Same character and controls (WASD/arrows, Shift, joystick on touch). She collides with walls and furniture and slides along them, so she never clips through. |
| R4 | Room contents | Sofa, centre table, wall-mounted TV, TV stand, plus lamp, rug, plants, shelf, window and curtains, balloons, gift boxes, bunting. |
| R5 | Interact with objects → predefined actions | Walk near an object, see a prompt, press E (or tap) to pick one action. She walks to the right spot, lines up and plays the action, then hands control back. |
| R6 | Cake with candles; blow them out; song plays | The cake sits on the centre table with lit, flickering candles that light the room. *Blow* = she leans in, breathes in and blows; the flames bend away and go out with smoke. "Happy Birthday" then plays, and the candles can be relit to replay. |
| R7 | Clean, non-pixelated, ultra-smooth, realistic | High-DPI rendering with antialiasing and no resolution drops below a set floor. Physically based lighting, soft shadows and smooth crossfades between animations; no snapping or foot sliding. Target 60 fps on desktop and at least 45 on mid-range phones. |

**Non-functional:** web only (Vite + three.js + TS, same stack). Assets CC0/CC-BY with credits. Touch and desktop parity. No regressions in garden.

## 2. Findings that shape the design

1. **`main.ts` is the garden.** Renderer, adaptive resolution, loaders and the render loop are all hard-wired to garden objects (field, sky, birds), so a second mode needs a thin shell around the loop.
2. **`Girl` is coupled to the garden** through `heightAt()` from `world/ground` and `CONFIG.walkSpeed/...`. Everything else in her (locomotion, lean, springs, skirt fix) is reusable as is.
3. **`girl.glb` has only `idle` and `walk`**, retargeted in Blender from Xbot, which uses Mixamo bone names (`mixamorig:`). So **any Mixamo clip retargets with the existing code**. The raw College Girl sources live only on the author's Mac (`build_girl.py` hard-codes `/Users/myb/...`), so the plan does *not* rebuild `girl.glb`. New clips ship as a separate animation-only `girl_actions.glb` built against the armature inside `girl.glb`. The garden's model file stays byte-identical.
4. **No facial shape keys** (`build_girl.py` clears them; no jaw bone). A blow is read from body language: chest swell, shoulders rising, head forward and the flame reacting. An optional "pucker" shape key on the `mouth` mesh is a stretch item (§8).
5. **Garden adaptive resolution goes down to 0.5–0.6× DPR**, which is what reads as "pixelated" on phones. A room is far cheaper than a meadow, so this mode can stay at or near native resolution.
6. **Bundle is 832 kB in one chunk.** Splitting by mode fixes the Vite warning for free.
7. **Licensing:** the *composition* "Happy Birthday to You" is public domain in the US/EU (2016 settlement), but individual **recordings** are not automatically. We render our own arrangement, so the audio is ours outright.
8. **glTF cannot carry lightmaps**, so baked lighting is loaded as separate textures on `uv1`/`lightMap` (three.js convention).

## 3. Architecture

```
app/src/
  main.ts                 → shell: renderer, adaptive DPR, loop, mode router (thin)
  core/                   NEW — shared, mode-agnostic
    mode.ts               interface Mode { load(ctx, progress); start(); update(dt,t); resize(w,h); dispose() }
    context.ts            { renderer, loaders (gltf/ktx2/tex), input, audio, quality tier }
    quality.ts            tier detection + per-mode DPR policy (garden policy = today's, unchanged)
    audio.ts              WebAudio bus: unlock on first gesture, music/sfx/ambience gains, ducking
    dispose.ts            deep dispose of geometry/material/texture
  girl/girl.ts            + optional ctor opts { groundHeight, collide, tuning } — defaults = today's behaviour
  modes/
    garden/index.ts       GardenMode: today's main.ts body moved verbatim; world/, flowers/, ui/ stay put
    birthday/
      index.ts            BirthdayMode (composition root)
      config.ts           every tunable (room size, speeds, flame, audio, camera)
      room/               shell (walls/floor/ceiling), furniture placement, lightmaps, cutaway walls
      nav/                colliders (OBB/circle in XZ), slide resolver, grid A* for approach paths
      interact/           Interactable registry, proximity/focus scoring, prompt UI, action runner (FSM)
      actions/            sit, blow, tvToggle, lampToggle, openGift, popBalloon, relight …
      cake/               cake, candles (flame shader, wick ember), smoke particles, breath field
      fx/                 confetti, bloom/AO post chain
      ui/                 mode HUD, action chips, celebration banner
  menu/                   start screen (mode cards), back-to-menu button
```

**Design rules**
- **Dependency direction:** `modes/* → core, girl`; never `core → modes` and never `birthday → garden`. This is enforced with an ESLint `no-restricted-imports` rule, so R2 is mechanical rather than a matter of discipline.
- **Mode lifecycle:** the router `await import('./modes/birthday')`, then `load` (progress bar), `start`, and the loop calls `update`. Switching modes runs `dispose()` (GPU resources freed) and returns to the menu. The girl's GLB is cached in `core` so a switch does not re-download 18 MB.
- **Girl refactor is additive:** `new Girl(loader)` keeps working as today. Birthday passes `{ groundHeight: () => 0, collide: nav.resolve, tuning: { walkSpeed: 1.1, runSpeed: 1.8 } }`, since running indoors at 2.7 m/s looks wrong. The test for R2 is a frame-by-frame diff of garden shots before and after.
- **Data-driven interactions:** an object is declared, not coded:
  ```ts
  { id: 'cake', mesh, focusRadius: 1.4,
    anchor: { pos: [0, 0, 0.62], yaw: Math.PI },        // where she stands, which way she faces
    actions: [
      { id: 'blow',   label: 'Blow the candles', when: s => s.candlesLit > 0, run: blowCandles },
      { id: 'relight',label: 'Light them again', when: s => s.candlesLit === 0, run: relight },
    ] }
  ```
- **Action runner FSM** (one action at a time, input-locked except Cancel):
  `Idle → Approach (A* path, normal locomotion) → Align (≤0.35 s ease of position + yaw onto anchor) → Enter clip → Loop/Body → Exit clip → Idle`.
  *Align* is what makes it look real: she arrives on the exact spot and facing before the clip starts, so sitting lands on the cushion and the blow is aimed at the cake. Each step has a timeout and a cancel path back to Idle, so input can never stay locked.

## 4. Rendering — "clean, not pixelated, realistic"

| Concern | Approach |
|---|---|
| Sharpness | DPR = `min(devicePixelRatio, 2)` desktop, `min(dpr, 2)` with a floor of **0.85×** on phones; adaptive steps only between 0.85–1.0. MSAA via `antialias` + **SMAA** in post for shader/alpha edges. Anisotropic filtering 8× on floor/rug. |
| Lighting | **Baked** global illumination + AO for the static room (Blender Cycles → 2k lightmaps, KTX2), as `lightMap` on `uv1`. Dynamic: one soft shadow-casting key light (window sun or ceiling) for the girl and cake, PCF-soft 2048 map with a tight frustum. Image-based light from a small PMREM of the room for reflections (env maps of outdoor HDRIs look wrong indoors). |
| Candle light | One `PointLight` at the candle cluster (not one per candle), intensity = Σ lit flames × shared flicker noise, warm 1900 K. Lights the cake, her face and the table; fades as candles go out, so the room visibly darkens when she blows. |
| Post | `postprocessing` (pmndrs): **N8AO** (contact AO for the girl), **selective Bloom** (flames, TV screen, fairy lights only), SMAA, `AgX` tone mapping. Phones: AO at half resolution, bloom on, everything else the same. |
| Materials | PBR with fabric sheen on the sofa (`MeshPhysicalMaterial.sheen`), clearcoat on the TV, transmission off (cost). |
| Budgets | ≤ 350k tris on screen incl. girl, ≤ 80 draw calls, textures ≤ 2k KTX2, birthday download ≤ 12 MB on top of the shared girl. |

## 5. Interaction feel — "ultra smooth"

- **Locomotion:** reuses the girl's damped acceleration, pivot-on-reversal and lean. Collision is circle (r = 0.22 m) vs. oriented boxes, with a *slide* response (project velocity onto the contact tangent) so she glides along the sofa instead of stopping dead.
- **Focus selection:** score = distance × facing angle × camera-view angle. Hysteresis (enter at 1.4 m, leave at 1.7 m) means the prompt never flickers between two nearby objects. The focused object gets a soft fresnel rim (shader uniform, no OutlinePass cost).
- **Clip blending:** 0.25–0.4 s crossfades with `AnimationAction.crossFadeTo` and warp. Sit/stand clips use root-motion extraction in the build script so the hips land where the clip says, not where locomotion left them.
- **Cinematic camera moments:** the follow camera eases (critically damped, as in `follow.ts`) to a predefined *shot* per action: a low three-quarter close-up for blowing and a wider framing for the sofa. Control returns on exit. Indoors the camera is collided against walls, and the wall between the camera and her fades out (dollhouse cutaway).
- **Blow sequence (≈3.2 s):**
  1. Align at the table (0.3 s) → lean-in clip + procedural spine pitch.
  2. **Inhale** 0.8 s: chest/shoulder bones scale/raise, flames stand tall and still.
  3. **Blow** 0.9 s: a *breath field* (cone from her mouth bone toward the cake) pushes each flame by distance. Flames bend, stretch, flutter and go out in a ripple, nearest first.
  4. Each extinguish → wick ember glow decays 1.5 s + a curl-noise smoke wisp (GPU points, ~60 particles per candle).
  5. Light drop → 0.4 s beat → confetti + "Happy Birthday" fades in (music bus), banner animates in, she does a happy clap or bounce clip.
  - Relight: candles light one by one from left to right with a small flare.
  - **Optional: real blowing into the mic.** This is opt-in behind a mic button. Web Audio `AnalyserNode` measures low-band (<1 kHz) RMS and spectral flatness over a sustained 250 ms window, after a short calibration of room noise. Strength scales the breath field, so a weak puff only blows out the nearest candles. The keyboard/tap path always works without permissions.
- **Flame shader:** a teardrop on a camera-facing (Y-locked) quad. Domain-warped noise drives the edge, with a colour ramp from blue base to white core to yellow and orange tip. Additive with soft depth fade, plus a separate inner core and a glow sprite. Uniforms are `bend` (vec2), `stretch`, `intensity` and `seed`. Each candle is an instance, so there is one draw call for all flames.

## 6. Objects and predefined actions (v1)

| Object | Actions | Animation source |
|---|---|---|
| Cake (centre table) | Blow candles · Relight | Mixamo lean/bend + procedural inhale/blow layer |
| Sofa | Sit · (while seated) Stand up | Mixamo *Sitting*, *Sitting Idle*, *Stand Up* |
| Wall TV + remote | Turn on/off. The screen plays a looping birthday slideshow video texture, with its light spilling onto the room | Mixamo *Pressing button* / point (short) |
| Floor lamp | Toggle (real light on/off, changes the mood) | reach/press |
| Gift boxes | Open (lid springs off, confetti, sparkle) | Mixamo *Picking Up* / kneel |
| Balloons | Bump/bat (spring-damped bob) · Pop (one-shot) | Mixamo *Waving* / jump-tap |
| Speaker | Play/pause song | press |
| Any time | Dance (on the rug, during the song) · Clap · Wave | Mixamo *Dancing*, *Clapping*, *Waving* |

Mixamo clips are free for use in projects; the raw clip files are not redistributed, since they are baked into `girl_actions.glb`.

## 7. Assets

| Item | Source (candidate) | Licence |
|---|---|---|
| Sofa, armchair, coffee table, side table, shelves, cabinet, floor lamp, potted plants | Poly Haven models (e.g. `sofa_03`, `modern_arm_chair_01`, coffee tables, storage, floor lamps, potted plants) | CC0 |
| Floor (wood), walls (plaster), rug fabric | Poly Haven textures | CC0 |
| Wall TV, TV stand, room shell, window, curtains, bunting, balloons, gift boxes, candles | **Built in Blender by script** (`tools/build_room.py`), the same approach as `build_bird.py`: exact dimensions, clean UV1 for lightmaps, tiny files | ours |
| Cake | Sketchfab CC-BY candidates (e.g. "Cake" by Akshat at 434k tris needs decimation, "Chantilly Cake" by Keith Ito), **or** script-built: a layered cylinder with an iced drip normal map and piped rosettes. **Recommended: script-built**, because the candles have to be separate, positioned instances for the blow logic anyway. | CC-BY / ours |
| "Happy Birthday" music | **Own arrangement.** The PD melody is written as MIDI (piano + soft strings, about 30 s, plus a short music-box version) and rendered with FluidSynth + FluidR3_GM (MIT) to `.ogg` + `.m4a` (Safari). No third-party recording rights involved. | ours |
| SFX (blow, puff, click, pop, confetti, room tone) | Freesound CC0-filtered, or synthesised in WebAudio | CC0 |
| Girl actions | Mixamo → `tools/build_actions.py` (imports `girl.glb` armature + Mixamo FBX, reuses `retarget()` from `build_girl.py`, exports animations only) | Mixamo terms |

Every model goes through the existing pipeline (`gltfpack -tc -cc`, meshopt + KTX2), and `CREDITS.md` is updated.

## 8. Phased delivery

Each phase ends in a working, pushed build and a PR.

| Phase | Scope | Definition of done |
|---|---|---|
| **0. Shell + router** (1 d) | `core/` extraction, `GardenMode` wrapping today's code, menu, `?mode=`, code-splitting, ESLint boundary rule, Vitest + Playwright set-up, CI workflow (`build`, `lint`, `test`) | Garden screenshots/frame-time identical before vs after; bundle split; CI green |
| **1. Greybox room** (1–2 d) | Room shell + placeholder boxes, girl walks with collision and slide, indoor follow cam + cutaway, quality tier | Walk the whole room on desktop and phone without clipping; 60 fps |
| **2. Interaction framework** (2 d) | Registry, focus scoring + hysteresis, prompt/chip UI (keyboard + touch), action-runner FSM with Approach/Align/cancel, A* | Unit tests for FSM, nav and focus; e2e: walk to sofa → Sit → Stand |
| **3. Cake + candles** (2–3 d) | Cake model, instanced flame shader, candle light, breath field, smoke, relight, cinematic shot | e2e: Blow → all flames out within 3.5 s → `songPlaying` true; Relight resets |
| **4. Audio** (1 d) | Audio bus, own song render, SFX, ducking, mute toggle, autoplay unlock | Song starts at most 0.6 s after the last flame; no autoplay errors on iOS/Android |
| **5. Real assets + look** (3 d) | Poly Haven furniture, built props, lightmap bake, post chain, TV video, remaining actions | Visual review shots at 1×/2× DPR; draw/tri budgets met |
| **6. Polish + perf** (2 d) | Mic blowing (opt-in), confetti, personalised banner (`?name=`), phone tier tuning, accessibility (reduced motion, captions for song) | ≥45 fps on mid phone; all tests green |

Stretch: pucker shape key for the mouth, a cake-cutting action, photo-mode screenshot button.

## 9. Testing strategy

- **Unit (Vitest, pure TS):** collision slide resolver (corners, sliding along walls, never tunnelling at max dt), grid A* (blocked/unreachable goals), focus scorer and hysteresis, action FSM (every transition, cancel and timeout), blow detector (synthetic noise/voice/breath buffers), mode router (load→dispose order, double-switch race).
- **E2E (Playwright, existing `__ready`/`__girl` hook style):** for each mode, load → no `pageerror` → scripted walk → interaction → assert state hooks (`__birthday.candlesLit`, `__audio.songPlaying`) → screenshot. Runs on desktop and emulated phones (portrait and landscape). The existing garden tools act as the regression gate for R2.
- **Perf guard:** read `__ft` frame-time histogram in e2e; fail if p95 > 22 ms on the CI runner's software GL baseline (relative, not absolute).
- **CI:** GitHub Actions `npm ci && npm run lint && npm run build && npm test`, plus Playwright on PRs. Needs headless-friendly launch flags: the current tools pin `channel: 'chrome'` with Metal, so they become configurable.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Mixamo clips on a non-Mixamo rig (proportions differ) cause hand/hip offsets on sit and table reach | Root-motion extraction + Align step; per-clip offsets in config; optional two-bone IK for hands on the table edge |
| Blow reads as fake without a face | Strong body cues (inhale, lean), flame physics as the payoff, a cinematic angle that favours the flames; pucker shape key as stretch |
| iOS audio/mic restrictions | Audio unlock on the first gesture; mic strictly opt-in with the keyboard/tap fallback always present |
| Post-processing cost on phones | Tiered chain (half-res AO, no SMAA at DPR ≥ 2); measured in Phase 6 |
| Refactor regresses the garden | Phase 0 is behaviour-preserving only, gated on shot diffs and frame times |
| Rebuilding `girl.glb` impossible in CI/cloud (raw sources local) | New clips ship in a separate `girl_actions.glb`; `girl.glb` is untouched |

## 11. Decisions needed from the owner

1. **Interaction trigger:** keyboard/tap only, or also the optional real mic blowing? *Recommended: both, with the mic opt-in.*
2. **Personalisation:** name and age on the banner/candles via URL (`?name=Aisha&age=7`)? *Recommended: yes, it costs almost nothing.*
3. **Room style/time of day:** cosy evening (warm lamps, candles dominate) or bright afternoon? *Recommended: evening, because the candle moment lands much harder.*
4. **Outfit:** keep the school uniform, or a party dress (needs the outfit swapped in Blender on the author's machine)? *Recommended: keep the uniform for v1 and add a party hat prop.*
5. **Cake:** script-built (recommended) or a Sketchfab CC-BY model?
