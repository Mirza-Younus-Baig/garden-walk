# Build plan — 3D interactive garden

Companion files: `PROMPT.md` (the spec), `ASSETS.md` (chosen models and preprocessing).
Stack: Vite + vanilla three.js (r17x), TypeScript, no framework. Control scheme: click to walk.

## Phase 0 — Tooling (½ day)

- `npm create vite@latest garden -- --template vanilla-ts`; add `three`, `@types/three`, `vite-plugin-glsl`.
- Install Blender 4.x and `gltfpack` (`brew install --cask blender; npm i -g gltfpack`).
- Create free Sketchfab and Adobe (Mixamo) accounts; download the six models in `ASSETS.md`.
- Repo layout:
  ```
  public/models/    girl.glb sunflower.glb daisy_{0..8}.glb lily_trumpet.glb lily_recurved.glb grass.glb
  public/textures/  ground_*.ktx2  sky.hdr
  src/
    main.ts         bootstrap, resize, loop
    world/          Ground, Sky, Lighting, Wind
    flowers/        FlowerField (placement), FlowerLayer (one InstancedMesh per variant), shaders/
    girl/           Girl (loader, mixer, state machine), Locomotion (click-to-walk)
    camera/         FollowCamera
    interaction/    Disturbance (spatial hash + spring), Picking (ground raycast)
    config.ts       every tunable constant
  ```
- Definition of done: empty scene renders at 60 fps with a placeholder cube, resize works.

## Phase 1 — Asset pipeline (1–2 days, mostly Blender)

1. **Girl.** Import College Girl FBX → check T-pose, fix scale to 1.55 m, merge materials to ≤4 (skin, hair, cloth, eyes). Export FBX → Mixamo auto-rig → download Idle, Female Walk, Stop Walking (without skin, 30 fps). Back in Blender: import clips onto the Mixamo-rigged mesh, push each to an NLA track named `idle`, `walk`, `stop`, make `walk` loop cleanly (root motion off, in-place). Export `girl.glb` (skins + animations). Verify in https://gltf-viewer.donmccurdy.com that all three clips play.
2. **Sunflower scan.** Decimate 2.0M → 26k, bake 2k albedo/normal/rough, split into `head` and `stem` objects, both sharing origin at ground. Paint a vertex-colour bend weight (G channel: 0 at base → 1 at head).
3. **Lilies.** Same decimation + bake for both scans (~15k each). Extra bake: greyscale petal mask + vein map (see ASSETS.md). Bend weight in vertex colour G.
4. **Daisies.** Already have vertex colour weights and LODs. Just export each of the 9 variants as its own GLB with LOD0 and LOD1 meshes named `lod0`/`lod1`.
5. **Grass clumps.** Cut 3 small clumps out of Poly Haven grass, ~300 tris each.
6. Run everything through `gltfpack -tc -cc`. Budget: girl ≤ 12 MB, all flowers together ≤ 15 MB.
- Definition of done: each GLB opens in the glTF viewer with correct scale, origin at stem base, textures present.

## Phase 2 — World (1 day)

- Ground: 80×80 `PlaneGeometry(80,80,160,160)` displaced on the CPU with 2-octave simplex (amplitude 0.35 units). Keep the height function in `world/Ground.ts` and expose `heightAt(x,z)` for the girl and flower placement.
- Sky: `RGBELoader` HDRI as `scene.environment` + `scene.background`; `ACESFilmicToneMapping`, exposure ~0.9. `Fog(0xc9d6c1, 30, 75)`.
- Light: `DirectionalLight` sun matching HDRI direction, `PCFSoftShadowMap`, 2048 shadow map, `CameraHelper`-tuned frustum ~30 units following the girl. `HemisphereLight` fill.
- Wind: one shared `uniforms` object `{uTime, uWindDir, uWindStrength}` and a GLSL `wind.glsl` chunk: `bend = (sin(t*1.3 + p.x*0.4 + p.z*0.3) * 0.5 + noise3(p*0.15 + t*0.1)) * weight`.
- Definition of done: lit terrain with shadows, fog and sky; camera orbit works; still 60 fps.

## Phase 3 — Flower field (2 days) — the core rendering work

1. **Placement** (`FlowerField.ts`): Poisson-disc sample the 80×80 field at r≈0.35, then assign each point a type by sampling three low-frequency noise fields (daisy everywhere baseline; sunflower where noise A > 0.55 in ~4 stands; lily groups where noise B > 0.6, alternating blue/red by cell parity). Reject points within 2 units of the start position except daisies. Store per instance: position, yaw, scale, hue jitter, type, variant index, phase offset.
2. **FlowerLayer** (`FlowerLayer.ts`): one `InstancedMesh` per (type, variant, LOD). Per-instance attributes via `InstancedBufferAttribute`: `aRand` (vec4: phase, scale jitter, hue, unused), `aDisturb` (vec4: dirX, dirZ, amount, tLast). Set `instanceMatrix`, `instanceColor` for lilies.
3. **Shader** (via `onBeforeCompile` on `MeshPhysicalMaterial`, or `three-custom-shader-material`):
   - Vertex: bend weight `w = color.g` (vertex colour). Wind bend and disturbance bend are applied as a rotation about the stem base, not a translation: `pos = rotateAround(base, axis, angle*w)`. Sunflower head gets an extra nod.
   - Fragment: double-sided, `sheen` 0.4 with white sheen colour for petals, wrap-lighting term `NdotL = NdotL*0.7+0.3` injected into `lights_fragment_begin` for cheap translucency. Lilies: `diffuse = mask * instanceColor * veins`.
   - Alpha-tested (`alphaTest 0.5`) for daisy cards; `alphaToCoverage` on with MSAA.
4. **LOD**: per frame, for each daisy cell (grid 4×4 units) pick lod0 vs lod1 by camera distance; sunflowers/lilies have one LOD but are frustum-culled per cell (set `count` on the InstancedMesh after sorting cells by distance — cheap).
5. **Shadows**: flowers `castShadow` on; custom depth material must run the same vertex bend (`customDepthMaterial` with the same `onBeforeCompile`).
- Definition of done: ~6k daisies, ~120 sunflowers, ~300 lilies visible, swaying, casting shadows, 60 fps on an M1 MacBook Air. Colour check: white/yellow/blue/red all readable.

## Phase 4 — Girl + locomotion + camera (1½ days)

1. `Girl.ts`: load `girl.glb`, `AnimationMixer`, clips `idle/walk/stop`. State machine: Idle → Walk (crossfade 0.2 s) → Stop (play `stop` once when within 0.6 units of target, then Idle). Walk clip `timeScale` scaled to actual speed so feet don't slide.
2. `Locomotion.ts`: `pointerdown` on ground → raycast plane at `heightAt` → target. While `pointerdown` held, update target on `pointermove` (throttle to every frame). Velocity ramp: accel 4 u/s², decel 6 u/s², max 1.4 u/s. Facing: `quaternion.slerp` toward velocity direction at 8 rad/s. Feet: `y = heightAt(x,z)`. Soft bounds: slow to zero within 3 units of the field edge.
3. `FollowCamera.ts`: target offset behind facing (3.2 units back, 1.7 up, look-at chest). `damp()` position (λ=4) and look-at (λ=6). Scroll zoom 2.2–5 units. Ground clamp: camera y ≥ heightAt + 0.5. Sunflower occlusion: raycast camera→girl against a coarse sunflower proxy (spatial hash); any hit instance gets `aDisturb.z` fade uniform → shader lowers alpha on that instance for 0.3 s.
- Definition of done: click anywhere, she walks there with weighty start/stop, camera follows smoothly, no ground clipping.

## Phase 5 — Girl ↔ flower interaction (2 days) — the heart of it

1. **Spatial hash** (`Disturbance.ts`): all flowers bucketed into 1×1 unit cells at build time. Each frame query the 3×3 cells around the girl (≈ 50–150 instances) — never iterate all.
2. **Per-type contact volumes**: daisies use a sphere at each ankle (r 0.35); lilies a capsule from hips to knees (r 0.45); sunflowers only a leaf capsule (r 0.6) with 25% strength.
3. **Push**: for each nearby instance compute radial direction from the nearest contact volume, strength `s = smoothstep(r, 0, d) * speedFactor` (speedFactor ramps 0→1 over 0.15 s once she starts moving). Write `aDisturb = (dirX, dirZ, s, time)` for those instances only and mark the attribute range dirty (`addUpdateRange`).
4. **Spring-back in shader**: `elapsed = uTime - tLast; amp = s * exp(-elapsed*3.0) * cos(elapsed*9.0)` → bend angle; after ~1.5 s it is ~0 so no CPU cleanup needed. Trail emerges automatically from `tLast` ordering.
5. **Depth correctness**: girl uses opaque materials (hair card alpha via `alphaTest`, not `transparent`), flowers alpha-tested; no `depthWrite=false` anywhere. Check by walking into lilies: they must cross in front of her legs.
6. **Hover flutter** (optional): raycast mouse to ground each frame; instances within 0.8 units get a tiny extra wind phase (`+0.15` amplitude) via a second uniform `uHover`.
- Definition of done: walking through daisies parts them at the ankles and they spring back with one visible overshoot; lilies bend at the hips; from a zoomed-out view her path closes up behind her over ~1.5 s.

## Phase 6 — Polish and hand-off (1 day)

- Start pose: girl at origin in a Chamomile/daisy patch, sunflower stand at z −6, blue lilies at x −4, red at x +4.
- "Loading garden…" overlay with progress from `LoadingManager`; fade out.
- `config.ts` exposes counts, garden size, walk speed, push radii, wind strength.
- Remove stats/GUI; confirm `npm run build` output < 40 MB and runs from `vite preview`.
- README: run instructions, click-to-walk, tuning constants, CREDITS.md with CC-BY lines for Rotmill, lolipop_1707, Cosmic_dust (if used), TemurG (if used).
- "Next improvements" note (≤5 bullets).

## Risks

- **Mixamo auto-rig on a skirted character**: the skirt may weight to the legs badly. Mitigation: rig the body only, then in Blender transfer weights to the skirt and add a small `Cloth`-free bone jiggle; or accept slight clipping.
- **Decimating photogrammetry scans** can leave holes in thin petals. Mitigation: decimate with "Planar" first, then "Collapse", and bake normals from the original so surface detail survives.
- **Shadow cost with thousands of alpha-tested instances**: if it drops below 60 fps, render daisy shadows only from LOD1 and cap the shadow camera at 20 units.
- **Sketchfab downloads** require login and the College Girl full rig is on Patreon (free tier). Budget an hour for account setup.

## Order of work and rough timeline

| Day | Work |
|---|---|
| 1 | Phase 0, start Phase 1 (downloads, Blender install, girl through Mixamo) |
| 2 | Phase 1 flowers (decimate, bake, export) |
| 3 | Phase 2 world, Phase 3 placement + first InstancedMesh |
| 4 | Phase 3 shaders, LOD, shadows |
| 5 | Phase 4 girl, locomotion, camera |
| 6–7 | Phase 5 interaction |
| 8 | Phase 6 polish |
