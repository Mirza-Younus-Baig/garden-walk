# Garden

An endless 3D meadow in the browser. You walk a girl through daisies, lilies, roses, tulips and
grass. Flowers bend out of her way, birds cross the sky, and a full 24-hour day passes every
three minutes. It is built with [three.js](https://threejs.org), TypeScript and Vite. There is
no game engine and no backend: the app is a static page.

## What's in it

| Feature | Description | Main code |
|---|---|---|
| **The girl** | A rigged, animated character you control. She blends between idle, walk and run, pivots into sharp turns, leans into curves and looks where she is heading. Her hair, skirt and tie swing on spring bones. | `src/girl/` |
| **Flowers** | Four kinds of real scanned plants: daisies, lilies (blue and red), roses (whole bushes and single stems) and tulips (open and closed). Each is recoloured per plant, lit so light shows through the petals, swayed by wind and pushed aside by her legs as she walks. | `src/flowers/field.ts`, `shader.ts` |
| **Grass and ground cover** | Grass clumps generated in code, plus a thin scatter of low scrub, between the flowers. | `src/flowers/grass.ts` |
| **Endless world** | The meadow never ends. Terrain, plant placement and plant colour are all computed from world position, so any spot looks the same every time you come back to it. Only the plants the camera can see are spawned. | `src/world/terrain.ts`, `src/flowers/grid.ts` |
| **24-hour cycle** | A simulated clock drives the sun and moon across the sky, along with sky colour, light, fog, exposure, stars and shadows. The default day lasts three minutes and changes smoothly, including across midnight. | `src/world/daynight.ts`, `sky.ts` |
| **Birds** | Small flocks of crows either fly across the view or circle overhead. They are placed in the band of sky the camera can actually see. They stay grounded after dark. | `src/world/birds.ts` |
| **Follow camera** | A third-person camera that eases every movement with a spring, runs slightly ahead of her direction of travel and widens its lens a little when she runs. | `src/camera/follow.ts` |
| **Clock and compass** | An on-screen clock (top right) and a sun/moon compass (bottom right) that tells you which way to turn to see the sun or the moon. | `src/ui/` |
| **Adaptive resolution** | Watches frame time and lowers or raises rendering resolution to keep the frame rate steady. | `src/main.ts` |

## Getting started

### Requirements

- **Node.js 20.19+ or 22.12+** (Vite 8 needs one of these; developed on Node 22.16) and npm.
- A browser with **WebGL 2** (current Chrome, Edge, Firefox or Safari). The meadow is dense,
  so a discrete or recent integrated GPU is recommended.
- **Blender 4.x**, but only if you want to rebuild the 3D models. The finished GLBs are
  already in `public/models`, so you don't need Blender to run the app. The build scripts
  (`tools/build_*.py`) set `ROOT` to an absolute path at the top. Point it at your own
  checkout first. The raw scans they read from (`raw/`) are not in the repo: download them
  from the links in `ASSETS.md`.

### Install and run

```bash
git clone <this repo>
cd Garden/app
npm install
npm run dev          # opens on http://localhost:5188 (the next free port if that one is taken)
```

Open the URL in your browser. A loading bar shows while the models and textures stream in.
When it finishes, a hint shows the controls.

### Build for production

```bash
npm run build        # type-checks with tsc, then writes the static site to app/dist/
npm run preview      # serves dist/ locally to check the build
```

`dist/` is a plain static site, so any static host can serve it. The repo is set up for
**Vercel**: set the project root to `app`, the build command to `npm run build` and the
output directory to `dist`. `vercel.json` adds long cache headers for `/models`,
`/textures` and the Basis transcoder, and `.vercelignore` keeps the dev tools out of the upload.

## Controls

| Input | Action |
|---|---|
| **W A S D** or **arrow keys** | walk, relative to the camera (diagonals are no faster than straight lines) |
| **Shift** (held) | run |
| **Mouse wheel** | zoom the camera in and out |

## URL flags

Add these to the page URL (e.g. `http://localhost:5188/?dev&stats`). You can combine several.

| Flag | Effect |
|---|---|
| `?dev` | time controls: pause, reset, speed ×1/×2/×5, jump to sunrise, noon, sunset or midnight |
| `?stats` | live readout of plant counts and frame time |
| `?prof` | frame time split into girl / streaming / LOD / contact / render |
| `?noclock`, `?nocompass` | hide the clock or the compass |
| `?nobirds`, `?birdseed=N` | turn birds off, or seed them so the sky repeats exactly (for screenshots) |
| `?nodaisy` `?nolily` `?norose` `?notulip` `?nograss` `?noscrub` | remove one plant layer |
| `?noshadow`, `?nocull`, `?nosprings`, `?plain`, `?nodetail` | turn off one rendering or animation feature to measure what it costs |
| `?pr=0.85` | fix the pixel ratio (turns off adaptive resolution) |

## Project layout

```
Garden/
├── app/                 the web app (everything you need to run it)
│   ├── index.html       page shell: canvas, loading bar, controls hint
│   ├── viewer.html      standalone model inspector (viewer.html?model=/models/rose.glb)
│   ├── public/
│   │   ├── models/      girl, flower and bird GLBs (meshopt + KTX2 compressed)
│   │   ├── textures/    ground textures and the sky HDRI
│   │   └── basis/       KTX2 texture transcoder
│   ├── src/             TypeScript source (table below)
│   └── tools/           Playwright scripts for screenshots, perf and clock tests
├── tools/               Blender (Python) scripts that built the GLBs from the raw scans
├── ASSETS.md            where every model came from and how it was processed
└── CREDITS.md           CC-BY attributions for the models
```

| File | What it does |
|---|---|
| `src/main.ts` | entry point: renderer, scene set-up, loading, the frame loop and adaptive resolution |
| `src/input.ts` | keyboard and mouse input |
| `src/config.ts` | every tunable: plant heights in metres, layer spacing and range, walk speed, push radii, wind, camera |
| `src/flowers/field.ts` | placement, batched meshes, LOD, petal recolouring, girl-contact push |
| `src/flowers/grid.ts` | the view-driven slot allocator that decides which plants exist |
| `src/flowers/shader.ts` | wind sway + spring-back bend, and the petal finish (translucency, sheen, micro-relief, occlusion fade) injected into three's physical shader |
| `src/flowers/grass.ts` | procedural grass clumps (blade fans with three detail levels) and their blade gradient |
| `src/girl/girl.ts` | locomotion with pivot turns, idle/walk blending, the procedural lean and head-look layer, contact points for the flowers |
| `src/girl/springs.ts` | spring-bone rig for hair, skirt and tie: damped springs with colliders and swing limits |
| `src/camera/follow.ts` | third-person camera: every motion a critically damped spring, with velocity look-ahead |
| `src/world/daynight.ts` | the simulated clock, solar geometry and every colour/lighting ramp |
| `src/world/sky.ts` | procedural sky dome, sun and moon lights, fog and exposure |
| `src/ui/timeui.ts` | clock readout and the `?dev` transport controls |
| `src/ui/compass.ts` | the sun/moon compass: a top-down sky map in camera-relative terms |
| `src/girl/skirt.ts` | keeps her legs inside the skirt: thigh volumes measured at load push swinging panels back out |
| `src/world/terrain.ts` | the terrain height function, written once in TypeScript and mirrored in GLSL so feet, plants and ground agree |
| `src/world/ground.ts` | the endless ground plane that follows her, its textures and the far-field flower haze |
| `src/world/birds.ts` | bird flocks: spawning in the visible sky band, flight paths, shader wing flap |
| `src/viewer.ts` | the model inspector behind `viewer.html` (bounds, triangles, clips, textures) |
| `../tools/*.py` | Blender scripts that built the GLBs in `public/models` from the raw scans, e.g. `blender -b --python tools/build_bird.py -- app/public/models/bird.glb` |

## How the endless world works

There is no world boundary and no fixed field. Everything is generated from world position,
so walking in one direction forever keeps producing new meadow.

- **Ground.** One plane follows the girl, snapped to its own vertex spacing so vertices
  always land on the same world positions and the surface never swims. Height, normals and
  texture coordinates are all computed from world position in the shader. The height
  function lives once in `src/world/terrain.ts` and is mirrored in GLSL there, so the CPU
  (her feet, every plant base) and the GPU agree exactly.
- **Flowers.** Instances are spent on what the camera can see, not on a disc around the
  girl (`src/flowers/grid.ts`). The world is cut into tiles; a tile entering the view
  claims a block of slots and a tile leaving gives it back. A 35-degree half-angle covers
  about a fifth of a circle, so the same budget buys several times the density in front of
  her. Tiles are claimed nearest-first under a per-frame budget, and tiles that have left
  the view are not dropped on the spot but recycled one at a time as new ones need slots:
  turning quickly would otherwise release hundreds in a single frame and cost a visible
  hitch, and this way turning straight back finds them still populated.
- **What grows where** is a pure function of the world cell: a hash decides jitter, scale
  and variant, and smooth noise fields decide clumping, so roses form stands and lilies
  form single-colour beds. Nothing is stored, so the world is identical every time
  you walk back over it.
- **The far field** is carried by the ground shader rather than geometry. Past the last
  billboards a procedural flower haze blends into the grass, so the meadow reaches the fog
  without a wall of shimmering cutouts.
- **Resolution adapts.** A meadow this dense is fill-rate bound, so the renderer follows a
  smoothed frame time and trades resolution for frame rate in a few coarse, rate-limited
  steps rather than letting the frame rate sag.

## The day/night cycle

One simulated 24 hours takes `DAY_CYCLE_DURATION_MS` (three minutes) in `src/world/daynight.ts`.
Change that one constant and the rest follows; at three minutes, one real second is eight
simulated minutes.

- **Time** comes from an anchor pair — a real timestamp and the simulated time at that
  moment — so the clock is read as `anchorSim + (now - anchorReal) * speed` rather than
  accumulated per frame. It cannot drift with frame rate, and pausing, seeking or changing
  speed simply re-anchors. Nothing is rendered while the tab is hidden, so the clock resumes
  where it left off instead of jumping.
- **Sun and moon** ride the same great circle, tilted `SOLAR_ARC_TILT` from vertical, half a
  day apart. The hour maps to an angle with sunrise at 06:00, noon at 12:00 and sunset at
  18:00, so the sun climbs an arc and the moon rises as the sun sets without either being a
  special case.
- **Everything else is a function of the sun's elevation**, the sine of its altitude. Sky
  zenith, horizon and glow colours, the sun's own colour, and the two hemisphere-light
  colours are piecewise-linear ramps keyed on it; intensities, ambient, exposure, star
  opacity and shadow softness are smooth curves on it. Nothing switches at a clock time, so
  there is no step anywhere in the cycle, including across midnight.
- **Direct sunlight** falls off as `elevation^0.75` and is extinguished near the horizon,
  which is what makes golden hour dim and warm rather than merely orange. The daylight curve
  driving ambient is deliberately asymmetric: a sun sitting on the horizon barely lights the
  ground, and full daylight only arrives once it has climbed.
- **The sky** is a unit sphere pinned to the camera, drawn first with depth testing off, so
  it costs one full-screen pass. Sun disc, moon disc, horizon glow and the star field all
  live in that one shader.
- **Only one light casts shadows at a time**; the sun hands over to the moon while both are
  grazing the horizon and nearly dark, so the shadow pass never doubles.

The clock reads out top-right (`?noclock` hides it). `?dev` adds pause, reset, ×1/×2/×5 and
jumps to sunrise, noon, sunset and midnight.

## The birds

`src/world/birds.ts` flies up to forty crows as one `InstancedMesh` of `models/bird.glb`.
The Blender script `tools/build_bird.py` models that bird from profiles, with no download:
about 360 triangles and a 1 m wingspan.

- **The flap is done in the vertex shader.** The mesh is static, and its UV map says how far
  each vertex is along the wing and which side it is on, so each bird flaps (or glides) with
  its own phase at no CPU cost.
- **Flocks are placed relative to the camera, not the world.** The follow camera looks
  slightly down, so the sky is only the top quarter of the frame. Flocks are spawned at a
  bearing and elevation that land them in that band, at 25–55 m, so they read as distant
  birds rather than passing overhead out of shot.
- **Two behaviours.** Most flocks cross the view in a loose line. About a third circle
  ahead of the camera and then leave. Up to three flocks fly at once, a few seconds apart,
  and none take off once the light falls below dusk.
- `?nobirds` turns them off. `?birdseed=N` seeds the random generator so a screenshot run
  sees the same sky every time.

## The compass

Bottom-right (`?nocompass` hides it). It answers one question: which way do I turn to watch
the sun or the moon? The dial is a top-down map of the sky drawn camera-relative — straight
up is wherever the camera is looking, the shaded wedge is what the lens covers, the rim is
the horizon and the centre is overhead. A body inside the wedge is on screen; one off to the
right is found by turning right; one near the centre is high overhead. Below the horizon it
is pinned to the rim and drawn hollow, so the bearing stays readable while saying plainly
that there is nothing to see there yet. The caption underneath names the turn — "Sun 97°
left", "Moon ahead" — for whichever of the two is higher, and the world's sun rises towards
+X, so +X is east and -Z is north. Other query flags used while tuning: `?stats`
(plant and frame readout), `?noshadow`, `?plain` (the flower finish switched off, to measure
its cost), `?nodaisy` / `?nolily` / `?norose` / `?notulip`.

## Rendering notes

- Every flower type is a `BatchedMesh` with per-instance frustum culling. LOD is a geometry swap per instance; far daisies drop to a single billboard card.
- Per-instance wind phase and disturbance state live in two float textures indexed by batch id; the bend is done in the vertex shader (rotation about the stem base), and the same bend runs in the shadow depth pass.
- When the girl walks, flowers near her get a push direction and a timestamp. The contact
  is shaped per type from her bones (`Girl.contacts`): daisies and grass are parted by each
  foot, so they open ahead of a step and close behind it; tulips by her knees; lilies by her
  hips with the knees sweeping through below; a rose bush only by her body. The shader
  springs them back with a damped cosine whose frequency and damping are per type
  (`CONFIG.push`), and a brushed plant shivers at the top while it settles, so the wake
  closes behind her without any CPU work.
- The shadow pass casts every plant from the next detail level down (a swap of geometry id
  inside `onBeforeShadow`, restored after), which is a quarter of the triangles for the
  same silhouette; plants too far behind the camera to throw a shadow on screen are
  skipped for that pass.
- Streaming a tile uploads only the texture rows of the slots it filled (`Batch.touched`),
  not the whole matrix/colour/wind textures: with seventy thousand slots the full upload was
  several megabytes a frame and was the hitch you felt on a fast turn.
- Ground cover is two more layers: grass clumps built in code (`grass.ts`, no shadows) and
  a thin scatter of low scrub made from the scans' own foliage LODs, scaled to ankle height.
- Lilies, roses and tulips are recoloured per instance. A mask built at load time marks which
  pixels of the atlas are petals (everything that is not foliage), and the shader replaces
  only those with the instance colour scaled by the texture's own luminance, so veining and
  shading survive. The gain is normalised on a high percentile of petal luminance, because
  normalising on the mean drives a dark texture's own highlights past white and shows up as
  pale gashes across the petals.
- A plant made of several materials is several batches over one layer. Geometry is registered
  as `v<variant>_lod<n>` in every batch, so one name addresses variants built from different
  parts: a batch that does not have the name hides that slot. That is how a rose bush (canes,
  leaves, blooms) and a single long-stemmed rose share one layer.
- Daisies are two layers, not one. The detailed plants only need to exist within a few metres,
  and spending 50k instances on billboards that three.js has to frustum-cull one by one every
  frame is what actually costs the frame, not their triangles. Splitting them took the flower
  render time from 54 ms to 3 ms.

## How big things are

Plant sizes are real metres, in `CONFIG.size`, not multipliers. Each model is measured at
load and normalised to the height asked for there, so the numbers in that table are what
you actually get in the world. The girl is 1.55 m, which puts her ankle at 0.14, knee at
0.43 and hip at 0.85.

This has to be explicit because the scans do not agree on scale, and two of them are not
even self-consistent: the single-stem rose carries a bloom 0.33 m across on a 0.78 m plant,
and the closed tulip a 0.12 m bloom on a 0.21 m stem, both roughly twice life size. Scaling
those plants down until the flower looked right would have left a rose the height of a
daisy, so `field.ts` shrinks the bloom alone about the neck of the stem and then sizes the
plant normally.

`CONFIG.sizeBlend` says how much of a variant's own height survives normalisation. At 0
every variant of a type stands exactly as tall as asked, which is what a daisy patch wants:
its tallest flower should reach the same height as a single daisy beside it. The lilies use
0.35, so the naturally short stems in that scan stay shorter without being stretched.

The sunflower scan was dropped. Its leaves are enormous next to its own head, so at any
height that made the plant read as a sunflower the leaves swamped everything around it.

## The surface finish

Everything below lives in `src/flowers/shader.ts` and is set per plant part through
`FlowerShaderOpts` in `src/flowers/field.ts` (`petalTrans`, `leafTrans`, `sheenPetal`,
`sheenLeaf`, `baseAO`, `petalRough`, `detail`).

- **Petals are told apart from foliage per pixel.** For recoloured plants the petal mask
  already says so; for the rest, anything that is not green is a petal. Every term below is
  blended between its petal and foliage value on that.
- **Light comes through.** A petal or leaf between the eye and the sun is lit from behind,
  strongest when looking almost into the sun; petals transmit their own colour more
  saturated, leaves the yellow-green of chlorophyll. The term is added after each direct
  light inside three's own lighting loop, so it is shadowed like everything else and a
  bloom's inner petals stay dark.
- **Velvet sheen.** The materials are `MeshPhysicalMaterial` with sheen, scaled up on petals
  and down on leaves, which is the soft rim a petal shows at grazing angles. Petals are also
  a little smoother than the leaves they grow from.
- **Micro-relief.** The scans are too coarse to carry petal fibres or leaf grain, so a
  height field of a few sinusoids with an analytic gradient perturbs the normal within a
  few metres of the camera and fades out beyond, so it never shimmers.
- **No two neighbours share a shade.** Each plant's own random numbers shift its foliage
  between yellow-green and blue-green and nudge its brightness; petals move much less.
- **The soil line is dark.** Albedo falls toward the base of every plant, where the
  neighbours' leaves crowd out the sky.
- **Cutout edges are clean.** Under a cutout texture's transparent pixels the scans carry
  whatever they were cut out from, and mipmaps blend that into a grey outline around every
  petal. At load, those pixels (and the semi-transparent edge band) are refilled from the
  opaque interior.
- **Every plant casts shadows**, with the same bend and the same cutout in the depth pass.
  The shadow pass sees the whole disc around her, including everything behind the camera,
  so each layer hides casters further behind the camera than their shadow could reach
  (`CONFIG.shadowBehind`) for that pass only.
- **She is never hidden.** Anything tall on the line from the camera to her chest, and well
  short of her, dithers away with a fine grain (interleaved gradient noise, not a Bayer grid,
  so a half-faded plant reads as translucent rather than as a screen door). Plants at her own
  depth are left alone, so lilies still cross in front of her legs.

## How she moves

- **Turns are pivots.** The further she has to turn, the more speed she gives up to do it
  (`CONFIG.turnSlow`), the turn rate is capped (`CONFIG.turnMax`), and her upper body leans
  into the turn and forward on acceleration while her head looks where she is about to go.
  All of that is a procedural layer applied to the spine and head bones after the clips.
- **Hair, skirt and tie move** (`src/girl/springs.ts`). Each loose bone's tail is a point mass
  on a damped spring toward the animated pose, damped relative to her body (so a steady walk
  does not blow the hair back, but starting, stopping and turning swing it), kept out of a few
  body colliders, and limited to a cone so a strand can never fold over the crown however hard
  the run cycle bobs her head. `?nosprings` switches it off.
- **The camera** never lerps: yaw, position, look target, zoom and field of view are all
  critically damped springs (`CONFIG.camera.*Smooth`), so a change of target eases in as
  well as out and a run of small corrections never becomes a run of small jolts. The frame
  leads her by a fraction of her velocity and the lens widens a touch at a run.

## Test tooling

These scripts live in `app/tools/` and run from the `app/` directory. They drive a headless
Chromium through Playwright, so install that browser once with `npx playwright install
chromium`, and keep `npm run dev` running on port 5188 in another terminal while you use them.

`tools/shot.mjs` and `tools/shot_app.mjs` drive headless Chrome via Playwright for screenshots
and metrics (used during development; needs the dev server on port 5188). `shot_app.mjs`
reports a real frame-time distribution (p50/p95/p99/max), triangles, draw calls, the live
plant and tile counts per layer, and whether any layer ran out of tiles.

`tools/clock_test.mjs` asserts the time mapping, the transport controls and that every driven
quantity is continuous across the midnight wrap. `tools/cycle_test.mjs` runs one full
three-minute day and reports the frame-time distribution over it.

`tools/loop.mjs <outdir> [tag]` is the learning loop for feel: it scripts idle, walk, a
walking turn, stop, run, halt and a close-up, and for each phase reports the frame-time
distribution, frames over 33 ms, triangle count, the CPU profile (`QS="prof"`), the largest
camera and body-yaw acceleration seen (a jolt shows up here before it shows up in a
screenshot), and saves a screenshot per phase. Pin the resolution with `QS="pr=1.0"` so two
runs compare like for like; the headless browser is vsync-locked at 60 Hz, so anything
under ~16 ms reads as 16, and a second WebGL tab on the same GPU (including your own
browser showing the site) will halve the numbers.

For the query flags, see [URL flags](#url-flags) near the top. Dropping every plant layer but
one is also how the plant sizes were checked: put the camera level with her chest and she is
a 1.55 m ruler standing in the field.
