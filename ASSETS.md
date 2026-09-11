# Asset selection

All models below were checked on 2026-09-09 for licence, downloadability and triangle count. Sketchfab downloads need a free account. Keep a `CREDITS.md` in the project with the CC-BY attributions.

## Girl — "College Girl" by Rotmill

- https://sketchfab.com/3d-models/college-girl-5395dfd1871c41f29aa02e05c4e58eb7
- CC-BY, 47k triangles, 15 PBR textures (metal/rough), stylised-realistic. Distinct face, layered hair strands, cloth folds, plaid skirt. Not a base mesh.
- Rigged. Sketchfab download ships one animation; the full rig zip is free on the author's Patreon (linked in the description).
- Outfit is a school uniform (white shirt, tie, plaid skirt). If you want a dress instead, the runner-up is "Kim" by patromes (white dress, 44k tris, 32 textures, rigged, CC-BY): https://sketchfab.com/3d-models/kim-169a8e9088954026961e987d8bcbaffb — the face is plainer, which is why it is second.
- Target in engine: ~1.55 units tall, 2k textures max, KTX2-compressed.

Animations come from Mixamo (free, Adobe account): `Idle`, `Female Walk` (or `Walking`), `Walk Strafe` not needed, `Walking Turn 180` optional, `Stop Walking`. Upload the College Girl FBX in T-pose to Mixamo's auto-rigger, download each clip "without skin" at 30 fps, merge in Blender onto the rigged character, export one GLB.

## Sunflower — CC0 photogrammetry scan

- https://sketchfab.com/3d-models/cc0-sunflower-helianthus-annuus-2ee915257e4042debfc7992d39af1417 (ffishAsia-and-floraZia)
- CC0, 2.0M triangles, 5 textures. Real seed-head spiral, ray petals with veining, stem and leaves included.
- Must be decimated in Blender to ~20k tris (head) + ~6k (stem/leaves), textures baked to 2k. Split into two meshes: `stem_leaves` and `head` so the head can nod independently in the shader.
- Fallback (already game-ready, 9.9k tris, CC-BY): "Sunflower" by Cosmic_dust https://sketchfab.com/3d-models/sunflower-d9925ea428a441deb34de06434b4bf1d

## Daisies — "Daisy models pack (realistic, optimized)" by lolipop_1707

- https://sketchfab.com/3d-models/daisy-models-pack-realistic-optimized-0748471f99f2416a8b66b522c293720f
- CC-BY, 17.8k tris total for 9 unique daisy plants, each with 3 LODs. Base colour / normal / alpha / roughness. Vertex colour already carries baked AO (R) and a base-to-tip gradient (G) — use G directly as the bend weight in the wind/push shader.
- Ready to instance without further work. Use all 9 variants, LOD0 within ~12 units of the camera, LOD1 beyond.
- Hero alternative for the patch she stands in at start (denser, 59k tris, CC-BY): "Chamomile" by Cosmic_dust https://sketchfab.com/3d-models/chamomile-31df46bbac484e3aa549032d8f321b6d

## Lilies — CC0 photogrammetry scans (recoloured to blue and red)

Real Lilium scans with trumpet shape, throat veining and stamens. Both are white/orange in the scan; the colour comes from a hue-shift in the material so the same mesh serves both blue and red instances (saves memory and lets petal veining survive the recolour).

- Primary silhouette, white trumpet: "Taiwan Lily, Lilium formosanum" https://sketchfab.com/3d-models/cc0-taiwan-lily-lilium-formosanum-7bd37dfa1f0246e5a60749a007082a82 — CC0, 680k tris, 4 textures. Decimate to ~15k.
- Second silhouette, recurved petals with speckling: "Tiger Lily" https://sketchfab.com/3d-models/cc0-tiger-lily-b11d9f411194426bb16883aed176e4e6 — CC0, 455k tris. Decimate to ~15k. Use for the red lilies (speckles read as the "dark speckling near the throat").
- Fallback with clean PBR set, no decimation needed beyond 240k→30k: "Purple lilies" by TemurG, CC-BY https://sketchfab.com/3d-models/purple-lilies-a73ee85609bf48ef98eb08b29590e40f

Recolour plan: in Blender, desaturate the petal albedo into a greyscale "petal mask" texture and bake a separate "vein/speckle" darkness map. In three.js the petal material tints `mask * instanceColor` (blue `#2F55D4` or crimson `#B3122E`, each with per-instance ±8% hue and ±10% value jitter) and multiplies in the vein map.

## Roses — a whole bush, and a single long-stemmed bloom

Two silhouettes, both complete plants rather than cut flowers.

- Bush: "Rose Bush - Detailed" by ramakarl — https://sketchfab.com/3d-models/rose-bush-detailed-f4d81ec952d04452a2f8421985875e56 — CC BY, 417k triangles, a *Rosa* x Perfume Delight hybrid tea with separate mesh groups for canes, leaves, thorns and blooms. The thorn group is ~79k triangles of individual spines that are invisible at meadow scale, so the build drops it. Normalised to 0.72 m.
- Single stem: "Rose flower, realistic (high-poly)" by lolipop_1707 — https://sketchfab.com/3d-models/rose-flower-realistic-high-poly-98edd35f37fc4010a469425699110ceb — CC BY, 446k triangles, one material covering petals, leaves, stem and thorns, 4k textures reduced to 1k. Normalised to 0.78 m.

Colour comes from a petal mask, not from separate models: crimson, pink, cream and deep crimson, chosen by a coarse noise field so beds read as one colour.

## Tulips — open and closed blooms

- Open: "a pink tulip" by kapeluskin — https://sketchfab.com/3d-models/a-pink-tulip-81b1e9be6b3543e99f6706182189da4d — CC BY, 20k triangles, one mesh holding bloom, stem and both strap leaves.
- Closed: "Tulip" by TIS — https://sketchfab.com/3d-models/tulip-172fa50b49754408b5030ee9b23b2523 — CC BY, 31k triangles. Its stem and leaves already share one texture, so the build merges those two materials into one batch.

Both normalised to ~0.43 m and recoloured per instance: red, yellow, pink, purple and cream.

Rejected: the tulip photogrammetry scans are cut blooms with no stem, and the bouquet models are splayed in a vase with the stems joined into a single mesh. Neither is a plant.

## Ground and sky

- Ground: Poly Haven "Grass Medium 02" texture set (CC0) or any Poly Haven grass albedo/normal/rough at 2k, tiled with a low-frequency noise mask to break repetition.
- Grass blades between flowers: Poly Haven "grass_medium_02" model (CC0, 1M tris) cut down to 2–3 small clumps at ~300 tris each, instanced.
- Sky: Poly Haven HDRI "kloofendal_48d_partly_cloudy_puresky" (1k for lighting, 2k background) or any late-afternoon puresky HDRI.

## LOD notes learned the hard way

- Decimate every level from the **original** mesh, never from the level above it. Collapse
  decimation bottoms out on a mesh of many small open islands (each rose petal is one), so
  decimating twice in a row leaves the lower level stuck well above its budget.
- Welding a cracked photogrammetry scan to help it collapse further does the opposite: it
  creates non-manifold junctions and *raises* the floor. Measured on the sunflower head,
  the floor went from 2483 triangles to 50117 after a 0.1% weld.
- The floor is set by the number of loose parts, so getting under it means dropping whole
  parts. `thin_islands` keeps the largest ones and anything reaching the lower half of the
  plant, otherwise the stem disappears and the far LOD is a flower head hanging in the air.
- Past the point where a bloom is a dot, stop keeping petals at all. The rose bush's far
  level (`blobify`) groups petals into blooms by centroid distance and replaces each bloom
  with a 20-triangle sphere scaled to its bounding box, with a spherical UV so the material
  still samples its texture. Thinning petals instead left 2,700 triangles per bush, and at
  five hundred bushes in view that was a third of the frame.
- The closed tulip was scanned as a 14 x 23 cm bloom on a 21 cm stem; the app shrinks the
  bloom about the top of the stem at load (`field.ts`) rather than in the build.
- Sunflowers are normalised to 0.72 m in the GLB and scaled to 1.6-2.1 m per instance, so
  their LOD budgets are sized for a head thirty centimetres across.

## Blender preprocessing (one-time)

Install Blender 4.x (`brew install --cask blender`). For each scan:
1. Import, set scale to metres (sunflower ~1.9 m, lilies ~0.8 m, daisies as shipped).
2. Decimate (collapse) to the target above; then Shrinkwrap a clean re-mesh onto it only if the silhouette breaks.
3. Bake albedo, normal and roughness from the original high-poly onto the low-poly at 2k.
4. Origin at the base of the stem, +Y up, facing +Z. Apply all transforms.
5. Export GLB with "Apply Modifiers", vertex colours on, no animation, Draco off (Draco breaks per-vertex attribute reuse; use gltfpack/meshopt instead).
6. Run `gltfpack -i in.glb -o out.glb -tc -cc` (meshopt + KTX2 basis textures).

## Birds — built in Blender, no download

- `tools/build_bird.py` models a crow from profiles (body lathe, fingered wings, wedge tail; ~360 triangles, 1 m wingspan) and exports `app/public/models/bird.glb`. Rerun with `blender -b --python tools/build_bird.py -- app/public/models/bird.glb [preview.png]`.
- The mesh is static; the flap is a vertex-shader rotation driven by a UV map (U = span weight, V = side). Vertex colour is the plumage. Flocks live in `app/src/world/birds.ts`.
