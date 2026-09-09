"""Process flower scans into web GLBs.
usage: blender -b --python tools/build_flowers.py -- <which>
(which: sunflower | lily | daisy | rose | tulip | taiwan | tiger | all)
"""
import bpy, sys, os, math
from mathutils import Vector, Matrix

ROOT = "/Users/myb/IdeaProjects/Garden"
OUTDIR = f"{ROOT}/app/public/models"
TEXDIR = f"{ROOT}/app/public/textures"
os.makedirs(OUTDIR, exist_ok=True); os.makedirs(TEXDIR, exist_ok=True)
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["all"]
which = args[0]

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def meshes(): return [o for o in bpy.data.objects if o.type == 'MESH']

def world_pts(objs):
    return [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]

def bake_world(objs):
    for o in objs:
        o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    bpy.context.view_layer.update()

def drop_chart():
    for o in list(meshes()):
        if any(m and m.name.startswith("Material.001") for m in o.data.materials) or len(o.data.polygons) <= 12:
            bpy.data.objects.remove(o, do_unlink=True)

def pick_lowest_lod_per_material(objs):
    """Sketchfab splits big scans into many interleaved chunks per material: join them all"""
    groups = {}
    for o in objs:
        key = o.data.materials[0].name if o.data.materials else "none"
        groups.setdefault(key, []).append(o)
    keep = []
    for k, v in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in v: o.select_set(True)
        bpy.context.view_layer.objects.active = v[0]
        if len(v) > 1:
            with bpy.context.temp_override(active_object=v[0], selected_editable_objects=v, selected_objects=v):
                bpy.ops.object.join()
        v[0].parent = None
        weld(v[0])
        print("  joined", k, "->", len(v[0].data.polygons), "tris")
        keep.append(v[0])
    return keep

def weld(o):
    import bmesh
    bm = bmesh.new(); bm.from_mesh(o.data)
    nv = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(o.data); bm.free(); o.data.update()
    print("  welded", o.name, nv, "->", len(o.data.vertices), "verts")

def decimate(o, target_tris):
    n = len(o.data.polygons)
    if n <= target_tris: return
    m = o.modifiers.new("dec", 'DECIMATE'); m.ratio = target_tris / n; m.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    with bpy.context.temp_override(object=o):
        bpy.ops.object.modifier_apply(modifier=m.name)
    print("  decimated", o.name, n, "->", len(o.data.polygons))

def lod_copy(o, target_tris, suffix):
    c = o.copy(); c.data = o.data.copy(); bpy.context.scene.collection.objects.link(c)
    c.name = o.name + suffix; c.data.name = c.name
    decimate(c, target_tris)
    return c

def normalise(objs, height, name):
    """scale so total height == height, stem base (lowest vertex) at origin, +Z up (Blender)"""
    bake_world(objs)
    pts = [v.co for o in objs for v in o.data.vertices]
    zmin = min(p.z for p in pts); zmax = max(p.z for p in pts)
    s = height / (zmax - zmin)
    lows = sorted(pts, key=lambda p: p.z)[:max(8, len(pts) // 400)]
    low = Vector((sum(p.x for p in lows) / len(lows), sum(p.y for p in lows) / len(lows), zmin))
    M = Matrix.Scale(s, 4) @ Matrix.Translation((-low.x, -low.y, -zmin))
    for o in objs: o.data.transform(M)
    bpy.context.view_layer.update()
    pts = [v.co for o in objs for v in o.data.vertices]
    print(f"  {name}: height {max(p.z for p in pts)-min(p.z for p in pts):.2f} x[{min(p.x for p in pts):.2f},{max(p.x for p in pts):.2f}] y[{min(p.y for p in pts):.2f},{max(p.y for p in pts):.2f}] tris {sum(len(o.data.polygons) for o in objs)}")

def upright(objs):
    """rotate so the plant's principal axis (stem) points +Z with the flower end (wider spread) on top"""
    import numpy as np
    pts = np.array([v.co[:] for o in objs for v in o.data.vertices], dtype=np.float64)
    c = pts.mean(0); X = pts - c
    idx = np.random.default_rng(1).choice(len(X), min(len(X), 60000), replace=False)
    _, _, vt = np.linalg.svd(X[idx], full_matrices=False)
    axis = vt[0]; proj = X @ axis
    perp = np.linalg.norm(X - np.outer(proj, axis), axis=1)
    hi, lo = np.percentile(proj, 85), np.percentile(proj, 15)
    if perp[proj < lo].mean() > perp[proj > hi].mean(): axis = -axis
    R = Vector(axis.tolist()).rotation_difference(Vector((0, 0, 1))).to_matrix().to_4x4()
    M = R @ Matrix.Translation(-Vector(c.tolist()))
    for o in objs: o.data.transform(M)
    bpy.context.view_layer.update()
    print("  upright axis", [round(a, 3) for a in axis])

def fix_materials(objs, double_sided=True, opaque=True):
    for o in objs:
        for m in o.data.materials:
            if not m: continue
            m.use_backface_culling = not double_sided
            if hasattr(m, "surface_render_method"): m.surface_render_method = 'DITHERED'
            # roughness: scans are diffuse; force a plausible roughness & no metal
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    if opaque:
                        for l in list(n.inputs["Alpha"].links): m.node_tree.links.remove(l)
                        n.inputs["Alpha"].default_value = 1.0
                    n.inputs["Metallic"].default_value = 0.0
                    if not n.inputs["Roughness"].is_linked: n.inputs["Roughness"].default_value = 0.65
                    if not n.inputs["Specular IOR Level"].is_linked: n.inputs["Specular IOR Level"].default_value = 0.3

def save_images(prefix):
    for img in bpy.data.images:
        if img.size[0] == 0: continue
        path = f"{TEXDIR}/{prefix}_{img.name}.png"
        img.filepath_raw = path; img.file_format = 'PNG'; img.save()
        print("  saved", path, img.size[:])

def export(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    out = f"{OUTDIR}/{name}.glb"
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animations=False,
                              export_apply=True, export_yup=True, export_image_format='AUTO', export_skins=False, export_morph=False)
    print("EXPORTED", out, os.path.getsize(out) // 1024, "KB")

def rename_by_material(objs, mapping):
    for o in objs:
        key = o.data.materials[0].name if o.data.materials else ""
        for k, v in mapping.items():
            if key == k: o.name = v; o.data.name = v

def flatten(objs):
    """clear parents keeping world transform, then bake it into the mesh data"""
    seen = set()
    mw = {o: o.matrix_world.copy() for o in objs}
    for o in objs:
        o.parent = None; o.matrix_world = mw[o]
    bpy.context.view_layer.update()
    for o in objs:
        if o.data.name in seen:      # shared mesh data would otherwise be transformed twice
            o.data = o.data.copy()
        seen.add(o.data.name)
        o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    bpy.context.view_layer.update()

def import_scoped(path):
    """import a glTF and return only the meshes it added, flattened to world space"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    flatten(new)
    print(f"  imported {os.path.basename(path)}: {len(new)} meshes, {sum(len(o.data.polygons) for o in new)} tris")
    return new

def join_by_material(objs):
    """one object per material (glTF splits a mesh per material and per 64k chunk)"""
    groups = {}
    for o in objs:
        groups.setdefault(o.data.materials[0].name if o.data.materials else "none", []).append(o)
    keep = []
    for k, v in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in v: o.select_set(True)
        bpy.context.view_layer.objects.active = v[0]
        if len(v) > 1:
            with bpy.context.temp_override(active_object=v[0], selected_editable_objects=v, selected_objects=v):
                bpy.ops.object.join()
        weld(v[0])
        print(f"  material {k}: {len(v)} chunks -> {len(v[0].data.polygons)} tris")
        keep.append(v[0])
    return keep

def images_of(objs):
    imgs = set()
    for o in objs:
        for m in o.data.materials:
            if not m or not m.node_tree: continue
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image: imgs.add(n.image)
    return imgs

def shrink_images(objs, maxsize):
    for img in images_of(objs):
        w, h = img.size
        if max(w, h) > maxsize:
            s = maxsize / max(w, h)
            img.scale(max(1, int(w * s)), max(1, int(h * s)))
            print("  scaled", img.name, (w, h), "->", tuple(img.size))

def merge_materials_sharing_image(objs):
    """two materials pointing at the same texture would cost two draw calls for nothing"""
    by_img = {}
    for o in objs:
        for i, m in enumerate(o.data.materials):
            if not m or not m.node_tree: continue
            key = tuple(sorted(n.image.name for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image))
            if not key: continue
            canon = by_img.setdefault(key, m)
            if canon is not m:
                o.data.materials[i] = canon
                print(f"  merged material {m.name} -> {canon.name} (same texture)")

def build_lods(objs, budgets, height, group, islands=None):
    """Decimate to lod0/1/2 and return every object, named <base>_lod<n>.

    Every level is decimated from the original mesh, never from the level above it:
    collapse decimation bottoms out on a mesh of many small open islands (each rose
    bloom is one), so decimating twice in a row leaves the lower level stuck.
    """
    out = []
    for o in objs:
        base = o.name
        b = budgets[base]
        lods = []
        cap = (islands or {}).get(base, {})
        for i, target in enumerate(b[1:], start=1):
            c = o.copy(); c.data = o.data.copy(); bpy.context.scene.collection.objects.link(c)
            c.name = f"{base}_lod{i}"; c.data.name = c.name
            # Spreading a small budget over every bloom collapses them all into slivers, so
            # far levels keep a few whole blooms instead of many broken ones, or, past the
            # point where a bloom is a dot, become one blob per bloom.
            if i in cap:
                if cap[i] == "blobs": blobify(c, cluster_radius=cap.get("radius", 0.06))
                else: thin_islands(c, cap[i])
            decimate(c, target)
            lods.append(c)
        decimate(o, b[0])
        o.name = f"{base}_lod0"; o.data.name = o.name
        out += [o] + lods
        print(f"  {base}: {' / '.join(str(len(x.data.polygons)) for x in [o] + lods)} tris")
    normalise(out, height, group)
    return out

def islands_of(bm):
    """loose parts of a bmesh, as lists of verts"""
    bm.verts.ensure_lookup_table()
    seen = set(); parts = []
    for v in bm.verts:
        if v.index in seen: continue
        stack, part = [v], []
        seen.add(v.index)
        while stack:
            w = stack.pop(); part.append(w)
            for e in w.link_edges:
                u = e.other_vert(w)
                if u.index not in seen: seen.add(u.index); stack.append(u)
        parts.append(part)
    return parts

def blobify(o, cluster_radius):
    """Replace a mesh of many petal islands with one icosphere blob per bloom.

    Petals are grouped into blooms by centroid distance; each bloom becomes a sphere
    scaled to its bounding box, with a spherical UV so the material still samples its
    texture. At the distance this level is drawn a bloom is a few pixels across, and a
    blob is what it looks like; the alternative was a floor of thousands of triangles.
    """
    import bmesh
    bm = bmesh.new(); bm.from_mesh(o.data)
    parts = islands_of(bm)
    clusters = []   # [centroid, weight, min, max]
    for part in sorted(parts, key=lambda p: -len(p)):
        c = sum((v.co for v in part), Vector()) / len(part)
        best = None
        for cl in clusters:
            if (cl[0] - c).length < cluster_radius: best = cl; break
        if best is None:
            clusters.append([c.copy(), len(part), c.copy(), c.copy()]); best = clusters[-1]
        else:
            w = best[1]; best[0] = (best[0] * w + c * len(part)) / (w + len(part)); best[1] = w + len(part)
        for v in part:
            best[2] = Vector((min(best[2][k], v.co[k]) for k in range(3)))
            best[3] = Vector((max(best[3][k], v.co[k]) for k in range(3)))
    bm.free()
    out = bmesh.new()
    uv_layer = out.loops.layers.uv.new("UVMap")
    n = 0
    for c, w, lo, hi in clusters:
        ext = (hi - lo) * 0.5
        if max(ext) < cluster_radius * 0.25 or w < 40: continue   # a stray petal, not a bloom
        centre = (lo + hi) * 0.5
        M = Matrix.Translation(centre) @ Matrix.Diagonal((max(ext.x, 0.01), max(ext.y, 0.01), max(ext.z, 0.01), 1.0))
        res = bmesh.ops.create_icosphere(out, subdivisions=0, radius=1.0, matrix=M)
        for v in res["verts"]:
            d = (v.co - centre); d = Vector((d.x / max(ext.x, 0.01), d.y / max(ext.y, 0.01), d.z / max(ext.z, 0.01))).normalized()
            for l in v.link_loops:
                l[uv_layer].uv = (0.5 + math.atan2(d.y, d.x) / (2 * math.pi), 0.5 + math.asin(max(-1, min(1, d.z))) / math.pi)
        n += 1
    out.to_mesh(o.data); out.free(); o.data.update()
    # smooth shading, or the blobs read as faceted gems
    for pg in o.data.polygons: pg.use_smooth = True
    print(f"    blobified {o.name}: {len(parts)} islands -> {len(clusters)} clusters -> {n} blobs, {len(o.data.polygons)} tris")

def thin_islands(o, keep_frac):
    """Keep `keep_frac` of the loose parts, and always the largest ones.

    Collapse decimation bottoms out at a few triangles per loose part, so a scan that has
    cracked into hundreds of shards cannot be reduced past that floor. Dropping whole
    shards gets under it. The biggest parts are kept unconditionally, so a stem is never
    thinned away and the plant does not end up as a flower head floating in the air.
    """
    import bmesh
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    seen = set(); parts = []
    for v in bm.verts:
        if v.index in seen: continue
        stack, part = [v], []
        seen.add(v.index)
        while stack:
            w = stack.pop(); part.append(w)
            for e in w.link_edges:
                u = e.other_vert(w)
                if u.index not in seen: seen.add(u.index); stack.append(u)
        parts.append(part)
    quota = max(1, round(len(parts) * keep_frac))
    if len(parts) <= quota: bm.free(); return
    zs = [v.co.z for v in bm.verts]
    lowline = min(zs) + (max(zs) - min(zs)) * 0.45
    keepset = set(sorted(range(len(parts)), key=lambda i: -len(parts[i]))[:max(1, round(quota * 0.3))])
    # anything reaching the lower half is stem or base: dropping it leaves a flower head
    # hanging in the air
    keepset |= {i for i, part in enumerate(parts) if min(v.co.z for v in part) < lowline}
    rest = [i for i in range(len(parts)) if i not in keepset]
    step = len(rest) / max(1, quota - len(keepset))
    for j in range(quota - len(keepset)):
        keepset.add(rest[min(len(rest) - 1, int(j * step))])
    doomed = [v for i, part in enumerate(parts) if i not in keepset for v in part]
    bmesh.ops.delete(bm, geom=doomed, context='VERTS')
    bm.to_mesh(o.data); bm.free(); o.data.update()
    print(f"    thinned {o.name}: {len(parts)} islands -> {len(keepset)}, {len(o.data.polygons)} tris")


# --------------------------------------------------------------------------------------
if which in ("sunflower", "all"):
    reset(); bpy.ops.import_scene.gltf(filepath=f"{ROOT}/raw/sunflower_scan.glb"); drop_chart()
    keep = pick_lowest_lod_per_material(meshes())
    rename_by_material(keep, {"material_2": "head_stem", "material_3": "leaf_a", "material_4": "leaf_b", "material": "leaf_c"})
    for o in keep: o.data.name = o.name
    # The model is normalised to 0.72 m and scaled to 1.6-2.1 m in the garden, so the head
    # is a good thirty centimetres across and the budgets are sized for that.
    allobjs = build_lods(keep, {"head_stem": (12000, 5000, 1700), "leaf_a": (1400, 400, 60),
                                "leaf_b": (1400, 400, 60), "leaf_c": (1400, 400, 60)}, 0.72, "sunflower",
                         islands={"head_stem": {2: 0.10}})
    fix_materials(allobjs)
    export(allobjs, "sunflower")

if which in ("lily", "all"):
    reset(); bpy.ops.import_scene.gltf(filepath=f"{ROOT}/raw/purple_lilies.glb")
    objs = meshes()
    for o in objs: o.parent = None
    bake_world(objs)
    objs.sort(key=lambda o: o.name)
    # global scale: tallest stem -> 0.95 m; each stem's own base at origin
    pts = [v.co for o in objs for v in o.data.vertices]
    zmin, zmax = min(p.z for p in pts), max(p.z for p in pts); sc = 0.95 / (zmax - zmin)
    out = []
    for i, o in enumerate(objs):
        weld(o); decimate(o, 6500)
        l1 = lod_copy(o, 1400, "_lod1"); l2 = lod_copy(o, 190, "_lod2")
        o.name = f"lily_{i+1}_lod0"; o.data.name = o.name
        l1.name = f"lily_{i+1}_lod1"; l1.data.name = l1.name
        l2.name = f"lily_{i+1}_lod2"; l2.data.name = l2.name
        for ob in (o, l1, l2):
            vs = [v.co for v in ob.data.vertices]
            lows = sorted(vs, key=lambda p: p.z)[:max(6, len(vs) // 300)]
            base = Vector((sum(p.x for p in lows) / len(lows), sum(p.y for p in lows) / len(lows), min(p.z for p in vs)))
            ob.data.transform(Matrix.Scale(sc, 4) @ Matrix.Translation(-base))
        h = max(v.co.z for v in o.data.vertices)
        print(f"  lily_{i+1}: height {h:.2f} tris {len(o.data.polygons)} / {len(l1.data.polygons)} / {len(l2.data.polygons)}")
        out += [o, l1, l2]
    fix_materials(out, opaque=True)
    export(out, "lily")

if which in ("taiwan", "all"):
    reset(); bpy.ops.import_scene.gltf(filepath=f"{ROOT}/raw/taiwan_lily.glb"); drop_chart()
    keep = pick_lowest_lod_per_material(meshes())
    # two plants: flower2-1 (tex0+tex1, long stem) and flower1-4 (short)
    a = [o for o in keep if o.data.materials[0].name.startswith("flower2-1")]
    b = [o for o in keep if o.data.materials[0].name.startswith("flower1-4")]
    for o in a: decimate(o, 6000)
    for o in b: decimate(o, 9000)
    save_images("lily_trumpet")
    upright(a); normalise(a, 1.0, "lily_trumpet_a"); fix_materials(a); export(a, "lily_trumpet_a")
    upright(b); normalise(b, 0.62, "lily_trumpet_b"); fix_materials(b); export(b, "lily_trumpet_b")

if which in ("tiger", "all"):
    reset(); bpy.ops.import_scene.gltf(filepath=f"{ROOT}/raw/tiger_lily.glb"); drop_chart()
    keep = pick_lowest_lod_per_material(meshes())
    for o in keep: decimate(o, 13000)
    save_images("lily_recurved")
    normalise(keep, 0.9, "lily_recurved"); fix_materials(keep); export(keep, "lily_recurved")

if which in ("daisy", "all"):
    reset(); bpy.ops.import_scene.gltf(filepath=f"{ROOT}/raw/daisy_pack.glb")
    objs = meshes()
    # keep LOD0 + LOD1 of every variant; drop billboards (LOD2)
    keep = objs
    bake_world(keep)
    # each variant: place its own base at origin; name cleanly: daisy_<variant>_lod<n>
    import re
    for o in keep:
        m = re.match(r"(Daisy(?:_patch_(?:big|small))?_(\d))_LOD(\d)", o.name)
        variant, lod = m.group(1).lower(), m.group(3)
        pts = [v.co for v in o.data.vertices]
        zmin = min(p.z for p in pts)
        # stems are vertical; base = centroid xy of lowest 2% vertices
        low = sorted(pts, key=lambda p: p.z)[:max(3, len(pts)//50)]
        cx = sum(p.x for p in low)/len(low); cy = sum(p.y for p in low)/len(low)
        o.data.transform(Matrix.Translation((-cx, -cy, -zmin)))
        o.name = f"{variant}_lod{lod}"; o.data.name = o.name
        print("  ", o.name, "tris", len(o.data.polygons), "h", round(max(p.z for p in pts)-zmin, 2))
    fix_materials(keep, opaque=False)
    for o in keep:
        for m in o.data.materials:
            if m and hasattr(m, "surface_render_method"): m.surface_render_method = 'DITHERED'
    export(keep, "daisy")

if which in ("rose", "all"):
    reset()
    # --- variant 0: a whole hybrid tea rose bush (stems, leaves, blooms)
    bush = import_scoped(f"{ROOT}/raw/rose_bush_detailed/scene.gltf")
    # Material.024 is ~79k triangles of individual thorns: invisible at meadow scale.
    thorns = [o for o in bush if o.data.materials and o.data.materials[0].name == "Material.024"]
    for o in thorns: bpy.data.objects.remove(o, do_unlink=True)
    bush = [o for o in bush if o not in thorns]
    bush = join_by_material(bush)
    rename_by_material(bush, {"Material.005": "rosebush_stem", "Material.006": "rosebush_leaf", "Material.010": "rosebush_bloom"})
    for o in bush: o.data.name = o.name
    leaves = [o for o in bush if o.name == "rosebush_leaf"]          # alpha-cut leaf cards
    solid = [o for o in bush if o.name != "rosebush_leaf"]
    # The far levels keep enough leaf cards that a bush at fifteen metres still reads as a
    # bush. Anything less and it is blooms on bare sticks, which is what a rose bed looked
    # like across the middle distance. The blooms go the other way:
    # each petal is its own island and the floor sat near 2,700 triangles, which times
    # five hundred bushes in view was a third of the whole frame.
    bush = build_lods(bush, {"rosebush_stem": (3200, 1100, 380), "rosebush_leaf": (5200, 2600, 1100),
                             "rosebush_bloom": (6800, 2000, 1200)}, 0.72, "rosebush",
                      islands={"rosebush_bloom": {1: 0.45, 2: "blobs", "radius": 0.14}})
    fix_materials([o for o in bush if o.name.startswith("rosebush_leaf")], opaque=False)
    fix_materials([o for o in bush if not o.name.startswith("rosebush_leaf")], opaque=True)

    # --- variant 1: a single long-stemmed rose, one material for petals, leaves and stem
    hero = import_scoped(f"{ROOT}/raw/rose_hero/scene.gltf")
    shrink_images(hero, 1024)   # the plant is 0.78 m tall in the garden
    hero = join_by_material(hero)
    for o in hero: o.name = "rosehero"; o.data.name = o.name
    hero = build_lods(hero, {"rosehero": (9000, 1600, 260)}, 0.78, "rosehero")
    fix_materials(hero, opaque=True)
    export(bush + hero, "rose")

if which in ("tulip", "all"):
    reset()
    # --- variant 0: an open tulip, bloom + stem + strap leaves in one mesh
    a = import_scoped(f"{ROOT}/raw/tulip_pink/scene.gltf")
    shrink_images(a, 768)
    a = join_by_material(a)
    for o in a: o.name = "tulipa"; o.data.name = o.name
    a = build_lods(a, {"tulipa": (4500, 900, 150)}, 0.42, "tulipa")
    fix_materials(a, opaque=True)

    # --- variant 1: a closed tulip; its stem and leaves already share one texture
    b = import_scoped(f"{ROOT}/raw/tulip_tis/scene.gltf")
    merge_materials_sharing_image(b)
    b = join_by_material(b)
    rename_by_material(b, {"Material.level": "tulipb_leaf", "Material.vsz2": "tulipb_petal"})
    for o in b: o.data.name = o.name
    b = build_lods(b, {"tulipb_leaf": (2600, 560, 95), "tulipb_petal": (3600, 750, 130)}, 0.44, "tulipb")
    fix_materials([o for o in b if o.name.startswith("tulipb_petal")], opaque=False)
    fix_materials([o for o in b if o.name.startswith("tulipb_leaf")], opaque=True)
    export(a + b, "tulip")

print("DONE", which)
