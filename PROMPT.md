# Build a 3D Interactive Flower Garden with a Walking Girl Character

## What I want

A single-scene, browser-based 3D garden. There are exactly three things in it: flowers, a girl, and the ability to walk her around with the mouse. No menus, no HUD, no score, no other objects, no sound required. The entire experience is: open the page, a girl is standing in a field of flowers, move the mouse and she walks through them, and the flowers react to her as she passes.

The bar is "this feels like a real meadow I can step into", not "a demo with some flower sprites". Spend your effort on the flowers, the character's motion, and the interaction between the two.

## Tech constraints

- Three.js (vanilla or React Three Fiber, your choice, but pick one and stay consistent). WebGL2. No backend.
- Deliver as a Vite project (`npm install && npm run dev` must work) OR a single self-contained `index.html` loading Three.js from a CDN. State which one you chose.
- Must hold 60 fps on a mid-range laptop GPU with a few thousand flowers visible. Use `InstancedMesh` for every flower type. Do not create one Mesh per flower.
- Use the specific models listed in ASSETS.md (photogrammetry sunflower, lily, rose and tulip plants, a realistic daisy pack, and the "College Girl" rigged character with Mixamo animations). Preprocess them in Blender into web-ready GLB files as described there. Do not substitute generic primitives or low-poly stand-ins.
- The girl is a loaded GLB with skeletal animations (idle, walk, walk-stop). She must have real walking animation with leg movement, not a sliding capsule.

## The environment

- A gently rolling ground plane roughly 80×80 world units, subtly displaced with low-frequency noise so it is not perfectly flat. Grass-green ground material with a soft texture or procedural variation so it does not read as a flat color.
- Sky: a warm late-afternoon look. Gradient sky or a simple HDRI-like environment for reflections. Directional sun light with shadows (PCF soft shadows), plus hemisphere/ambient fill so shadowed sides of petals are not black.
- A global wind system: a time-varying noise field that every flower samples by its world position. Neighbouring flowers sway together in gusts; distant flowers are out of phase. Wind must be implemented in the vertex shader (or via `onBeforeCompile` on a standard material) so it costs nothing per flower on the CPU.
- Soft fog toward the horizon to sell depth. Subtle bloom or tone mapping (ACES) is welcome but keep it tasteful.

## The flowers

Six flower types, distributed naturally across the field in loose drifts/clusters (Poisson-disc or jittered-grid placement with per-cluster density variation, never a uniform grid):

1. **Daisies** — short (ankle height, ~0.25–0.35 units). Thin green stem, a small yellow disc centre with slight dome, 18–24 thin white petals with a hint of translucency and a faint pink/grey tint at the tips. Tiny leaves near the base. Most numerous flower.
2. **Sunflowers** — tall (1.6–2.2 units, taller than the girl). Thick fibrous green stem, large broad leaves down the stem, big dark brown seed head with a visible spiral pattern (procedural Fermat spiral or texture), a ring of long golden-yellow petals. Heads should tilt slightly and face roughly the sun direction with some random variation. Sparser than daisies, in a few loose stands.
3. **Blue lilies** — mid height (knee to waist, ~0.6–0.9 units). Elegant arched stem, long strap-like leaves, 6 recurved trumpet petals in a saturated blue with darker veining toward the throat and pale/white edges, visible stamens with dark anthers. Planted in small groups of 3–7.
4. **Red lilies** — same structure as the blue lilies but deep crimson-red petals with dark speckling near the throat and orange stamens. Interleave red and blue groups so both colours read clearly from the camera.
5. **Roses** — knee to waist height. A whole shrub, not a cut flower: woody canes, compound leaves, and several open blooms and tight buds on the same plant, plus an occasional single long-stemmed bloom among them. Crimson, pink, cream and deep crimson, in beds of one colour rather than mixed at random. Stiff: they should barely bend when she pushes past.
6. **Tulips** — shin to knee height (~0.35–0.5 units). Bloom, smooth stem and two broad strap leaves. Two shapes, one open cup and one still closed. Red, yellow, pink, purple and cream, again in beds. Fleshy stems, so they bend easily and spring back.

Realism requirements for all flowers:
- Petals are actual geometry (curved, slightly cupped, tapered), not flat quads with a texture. Double-sided with a thin-material look: use a material with roughness, slight sheen/subsurface approximation (e.g. a wrap-lighting term or `MeshPhysicalMaterial` with `sheen`/`transmission` if performance allows).
- Every instance has small random variation in scale, petal count/spread, stem lean, head tilt, colour saturation and hue. No two neighbouring flowers should look identical.
- Sway: the vertex shader bends each flower along its stem with bend strength increasing with height (base stays planted, head moves most). Add a secondary higher-frequency petal flutter.
- Flowers cast and receive shadows. Sunflower shadows should fall across the daisies and the girl.
- Optional but valued: a very light scatter of ground-level grass blades (instanced) so the flowers are not standing on bare ground. Keep it cheap.

## The girl

- A young woman/girl character, stylised-realistic, roughly 1.5–1.6 units tall so sunflowers tower over her and lilies reach her waist. A simple summer dress or casual outfit, hair that has a little secondary motion if you can afford it.
- Animations: idle (weight shift, breathing), walk, and ideally a short "start" and "stop" blend so she does not snap between idle and walk. Use animation crossfades (~0.2s).
- Her feet must stay on the displaced ground: sample ground height at her position every frame.
- She turns smoothly toward her movement direction (slerp the facing, do not snap). Turning in place should look like a pivot, not a rotation on a turntable.

## Mouse-driven movement (the only control)

**Click to walk.** Left-click on the ground sets a destination; holding the button down continuously updates it so she follows the cursor while held. She walks at a fixed speed (~1.4 units/sec) with acceleration/deceleration ramps so starts and stops feel weighted, and stops with a small dead-zone (~0.3 units) at the target. Clicking a new point mid-walk retargets smoothly (no snap in facing). Clicking on a flower still raycasts to the ground beneath it.

Also:
- Third-person camera behind and above her, following her position with smoothing (lerp/damping, not rigid attachment), and softly rotating so it stays generally behind her walking direction. The camera must never clip into the ground and should not be fully occluded by sunflowers for long (either nudge the camera or fade flowers that sit between camera and girl).
- Scroll wheel zooms the camera in/out within limits. That is the only other input.
- Keep her inside the garden bounds with a soft edge (she slows and stops rather than hitting an invisible wall).

## The interaction between the girl and the flowers (this is the heart of it)

She is walking *through* the field, not on a path beside it. Design for that explicitly:

1. **Displacement / parting:** Every flower within ~0.5–0.7 units of her body bends away from her, radially, with strength falling off with distance. The bend happens in the vertex shader by passing her world position (and velocity) as uniforms; the shader computes the push per instance. Stems bend from the base so the flower head swings away, not the whole flower sliding sideways.
2. **Spring-back:** When she moves on, flowers spring back to upright with a damped oscillation (overshoot once or twice, then settle) over ~1–1.5s. Do this either with a per-instance "disturbance" attribute you update on the CPU for nearby instances only (spatial hash / grid lookup so you never iterate all flowers), or entirely in-shader using a time-of-last-disturbance attribute.
3. **Wake / trail:** Her motion leaves a short-lived trail behind her: flowers she just passed are still recovering, so from above you can see the path she took slowly closing up.
4. **Height-aware contact:** Daisies react to her feet/ankles; lilies react to her legs and hips; sunflowers barely move at the stem but their big leaves brush aside when she passes close. Use different push radii and strengths per flower type.
5. **Occlusion and depth:** She must be correctly drawn in between flowers, with lilies in front of her partly hiding her legs and daisies visible around her feet. No sorting hacks that make her always render on top.
6. **Idle interaction:** When she stands still, nearby flowers just sway with the wind; nothing pushes them. When she starts walking, the push ramps up over a few frames rather than popping.
7. **Optional hover detail:** If the mouse hovers directly over a flower cluster, those flowers get a tiny extra flutter, as if a breeze passed. Keep it subtle; it must not compete with the walking interaction.

## Quality bar and finishing

- Colour grading should make the four flower colours (white, yellow, blue, red) all read clearly against the green without any looking neon.
- Start the scene with the girl standing in the middle of a daisy patch with a stand of sunflowers behind her and lily groups to either side so the first frame already shows every type.
- Include a short loading state (plain text "Loading garden…" is fine) if assets load asynchronously.
- Handle window resize.
- Provide a small set of constants at the top of the code (flower counts per type, garden size, walk speed, push radius, wind strength) so I can tune it.
- No debugging UI, no stats panel, no lil-gui in the final build.

## What to give me

1. The full project (or single file) with all code.
2. A short README: how to run it, which control scheme you used, and where the tuning constants are.
3. A brief note on what you would improve next if given more time (max 5 bullets).

Do not add anything beyond flowers, the girl, ground, sky, and the mouse-driven movement. If a feature is not on this list, leave it out.
