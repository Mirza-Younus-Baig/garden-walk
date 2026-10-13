# Birthday room

A cosy evening party in a living room: a chocolate cake with eight candles, a vase of
lilies, tulips and daisies, presents, balloons, paintings, and a girl who can walk around
and use things. Open it at `/?mode=birthday`. `&name=…` changes the name everywhere.

## How it fits together

```
main.ts ──(?mode=birthday)──▶ modes/birthday/index.ts     composition root + frame loop
                                 │
   room/ shell, furniture,       │   built once at load, mostly merged into a few meshes
         paintings, decor, tv    │   per material (room/build.ts Batcher)
   cake/ cake, flames,           │
         tableware               │
   girl/ pose (IK layer)  ◀──────┤   runs inside Girl.update via the postAnimate hook
   director.ts            ◀──────┤   what she can use, and the scripted actions
   camera.ts, post.ts            │
   audio/ audio.ts               │   all sound synthesised; the song rendered offline once
   ui/ hud.ts                    │   DOM overlay
   core/ nav, focus, tasks,      │   pure logic, unit-tested in app/test
         blow, song
```

- **Separate from the garden.** The room never imports the garden's world, flowers,
  camera, UI or config, and nothing but `main.ts` imports the room
  (`test/boundaries.test.ts`). Shared: the girl (`src/girl`), keyboard and touch input,
  the menu. Each mode is its own chunk, so neither downloads the other.
- **Actions** are short async scripts on game time (`core/tasks.ts`): walk over along a
  path round the furniture (`core/nav.ts`), line up on the spot, act, hand back. Each one
  unwinds its pose and camera in `finally`, and walking away cancels the ones that allow it.
- **Poses** (sit, kneel, reach, clap, wave, wish) are a layer of two-bone IK and spine
  bends over her idle and walk clips (`girl/pose.ts`, `girl/ik.ts`). Every weight at zero
  means the layer does nothing.
- **Candles** are shader flames that bend with the breath, go out one by one, and smoke.
  One light stands for all of them, so the room dims candle by candle.
- **Sound** is all made here: the song is rendered once with an `OfflineAudioContext`
  (piano, music box, strings, celesta), and the effects are tiny synthesised sounds. The
  lyrics show in time with it, with her name highlighted.
- **Microphone** (optional, the mic button): `core/blow.ts` tells a breath from talking by
  how loud, how noise-like and how low it is. The keyboard always works too.

## Keeping it light

The room is built to run smoothly on a laptop's integrated GPU and on phones. When you add
to it, keep to these:

- **Draw calls.** Static scenery is merged per material at the end of the build
  (`mergeStatic` in `room/build.ts`); anything that moves on its own is listed as a `keep`.
  Materials come from `std()` / `phys()`, which share one material per look so alike
  pieces merge. Use `own()` for a material that changes at run time (the TV screen,
  the lamp shade). Repeated things (balloons, confetti) are instanced, and textures
  that differ per piece (bunting flags, candles, photos) are atlases.
- **Shadows.** Only the key lantern (every device) and the floor lamp (desktop) cast
  shadows, both spot lights. Point-light shadows cost six renders each per frame, so there
  are none. `pruneShadowCasters` in `index.ts` drops shadows from small things.
- **No transmission.** Physical `transmission` re-renders the room every frame; glass is
  done with reflections and opacity instead.
- **Shaders.** Everything is compiled behind the loading screen, against an off-screen
  target like the one the post chain draws into, and asynchronously where the driver
  allows. The environment capture uses a stand-in environment so it compiles the same
  programs the room uses (about 70 in all).
- **Downloads.** The girl loads as WebP copies of the garden's model
  (`node tools/build_girl_lite.mjs`): `girl_2k.glb` on desktop, `girl_1k.glb` on touch
  devices.
- **Per frame.** No allocations in update loops, no work for things at rest (landed
  confetti, out flames), and the HUD writes to the DOM only when something changes. No
  `backdrop-filter` over the canvas, because it re-blurs on every frame.
- **Resolution** adapts: the pixel ratio steps down if frames run slow, and back up.

Build stages carry `performance.mark('bday:<stage>')`, so the browser's performance panel
shows where loading time goes.

## Things to do there

| Where | Actions |
|---|---|
| Cake | Make a wish and blow out the candles (then the song, confetti, her name) · light them again · read the card |
| Sofa | Sit down · stand up |
| TV | Turn on (a little birthday slideshow) / off |
| Record player | Play / stop the birthday song |
| Floor lamp | Switch on / off |
| Present | Open it (a teddy pops out) · say hi to Teddy |
| Balloons | Bop them |
| Window | Look at the stars (and catch a shooting star) |
| Anywhere | `T` twirl · `G` wave |

Keys: `WASD` / arrows walk, `Shift` skip, `E`/`R` the actions shown, drag to look, wheel
to zoom. On a phone: left thumb walks, tap glowing things, drag the right side to look.

## Testing

- `npm test`: unit tests for the pure logic (navigation, focus, the task scheduler, blow
  detection, the song, IK) and the module boundaries.
- `node tools/birthday_shot.mjs <outdir> "<steps>"` with `npm run dev` running: loads the
  room in headless Chromium and runs a script of steps (`act:cake`, `until:<js>`,
  `shot:<name>`, `eval:<js>`, separated by `|`). Game time pauses while each screenshot
  is taken. Test hooks: `window.__bday` (`act(id, i)`, `world`, `flames`, `audio`, …),
  `window.__debugCam = { pos, look, fov }`, `window.__pause`.
- `?noao` turns off ambient occlusion.
