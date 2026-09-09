# Garden

A 3D meadow you can walk through. One girl, four kinds of flowers (daisies, blue and red lilies,
roses and tulips), a mouse, and a 24-hour day that passes every three minutes.

## Run

```
cd app
npm install
npm run dev        # http://localhost:5188
npm run build      # production bundle in dist/
```

## Controls

- **WASD** or **arrow keys**: walk her, relative to the camera. Diagonals are normalised.
- **Scroll**: zoom the follow camera.

## Where things are

| File | What it does |
|---|---|
| `src/config.ts` | every tunable: plant heights in metres, layer spacing and range, walk speed, push radii, wind, camera |
| `src/flowers/field.ts` | placement, batched meshes, LOD, petal recolouring, girl-contact push |
| `src/flowers/grid.ts` | the view-driven slot allocator that decides which plants exist |
| `src/flowers/shader.ts` | wind sway + spring-back bend, and the petal finish (translucency, sheen, micro-relief, occlusion fade) injected into three's physical shader |
| `src/girl/girl.ts` | click-to-walk locomotion, idle/walk blending |
| `src/camera/follow.ts` | damped third-person camera |
| `src/world/daynight.ts` | the simulated clock, solar geometry and every colour/lighting ramp |
| `src/world/sky.ts` | procedural sky dome, sun and moon lights, fog and exposure |
| `src/ui/timeui.ts` | clock readout and the `?dev` transport controls |
| `src/ui/compass.ts` | the sun/moon compass: a top-down sky map in camera-relative terms |
| `src/world/ground.ts` | terrain height field |
| `../tools/*.py` | Blender scripts that built the GLBs in `public/models` from the raw scans |

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
- When the girl walks, flowers within a per-type radius get a push direction and a timestamp. The shader springs them back with a damped cosine, so the wake closes behind her without any CPU work.
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
  short of her, dithers away with an ordered pattern. Plants at her own depth are left alone,
  so lilies still cross in front of her legs.

## Test tooling

`tools/shot.mjs` and `tools/shot_app.mjs` drive headless Chrome via Playwright for screenshots
and metrics (used during development; needs the dev server on port 5188). `shot_app.mjs`
reports a real frame-time distribution (p50/p95/p99/max), triangles, draw calls, the live
plant and tile counts per layer, and whether any layer ran out of tiles.

`tools/clock_test.mjs` asserts the time mapping, the transport controls and that every driven
quantity is continuous across the midnight wrap. `tools/cycle_test.mjs` runs one full
three-minute day and reports the frame-time distribution over it.

Query flags: `?stats` shows a live readout of what is on screen, `?prof` breaks the frame into
streaming / LOD / contact / render, `?dev` adds the time controls, `?noclock` hides the clock,
`?noshadow`, `?nocull`, and `?nodaisy` `?nolily` `?norose` `?notulip` drop a layer to
measure what it costs. Dropping all but one is also how the plant sizes were checked: put
the camera level with her chest and she is a 1.55 m ruler standing in the field.
