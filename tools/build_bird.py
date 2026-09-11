"""Build bird.glb: a low-poly flying bird, modelled here from profiles, for the sky flocks.
usage: blender -b --python tools/build_bird.py -- <out.glb> [preview.png]

The bird is a static mesh; the wing flap is done in the vertex shader. To drive that, the
mesh carries one UV map whose U is the flap weight (0 at the body, 1 at the wing tip) and
whose V is the side (0 left wing, 1 right wing, 0.5 body and tail). Vertex colour is the
plumage: dark back and wings, paler underside, a horn-coloured beak.

Axes: the bird is built flying along Blender +Y (nose at +Y), which the exporter turns into
-Z in the GLB. Wingspan is 1.0 m; instances scale that to the species they stand in for.
"""
import bpy, bmesh, sys, os, math
from mathutils import Vector

ROOT = "/Users/myb/IdeaProjects/Garden"
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = args[0] if args else f"{ROOT}/app/public/models/bird.glb"
PREVIEW = args[1] if len(args) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)

BACK = (0.055, 0.045, 0.040)
BELLY = (0.17, 0.15, 0.13)
WING = (0.07, 0.058, 0.052)
WING_TIP = (0.03, 0.025, 0.022)
BEAK = (0.55, 0.42, 0.22)

bm = bmesh.new()
uv_lay = bm.loops.layers.uv.new("Flap")
col_lay = bm.loops.layers.color.new("Col")
# per-vertex data kept aside until faces exist: (flap weight, side, colour)
vdata = {}

def add_vert(x, y, z, w=0.0, side=0.5, col=BACK):
    v = bm.verts.new((x, y, z))
    vdata[v] = (w, side, col)
    return v

# ---- body: a lathe of a profile, nose at +Y, with the head lifted a little ------------
# (y, radius, z-offset of the ring centre)
PROFILE = [
    (-0.235, 0.012, 0.006), (-0.19, 0.028, 0.004), (-0.13, 0.044, 0.0), (-0.06, 0.055, 0.0),
    (0.02, 0.055, 0.0), (0.09, 0.046, 0.004), (0.135, 0.034, 0.012),   # neck
    (0.165, 0.041, 0.024), (0.205, 0.036, 0.026),                       # head
    (0.232, 0.016, 0.020),                                              # beak root
]
BEAK_TIP = (0.0, 0.275, 0.012)
SEG = 12
rings = []
for (y, r, zc) in PROFILE:
    ring = []
    for i in range(SEG):
        a = 2 * math.pi * i / SEG
        # belly is flatter and paler: squash the lower half of the ring a touch
        cz = math.cos(a)
        rz = r * (0.9 if cz < 0 else 1.0)
        z = zc + rz * cz
        x = r * math.sin(a)
        t = 0.5 - 0.5 * cz          # 0 top .. 1 bottom
        col = tuple(BACK[k] * (1 - t) + BELLY[k] * t for k in range(3)) if y < 0.232 else BEAK
        ring.append(add_vert(x, y, z, 0.0, 0.5, col))
    rings.append(ring)
tail_tip = add_vert(0.0, -0.245, 0.006, 0.0, 0.5, BACK)
beak_tip = add_vert(*BEAK_TIP, 0.0, 0.5, BEAK)
for ra, rb in zip(rings, rings[1:]):
    for i in range(SEG):
        j = (i + 1) % SEG
        bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
for i in range(SEG):
    j = (i + 1) % SEG
    bm.faces.new((rings[0][j], rings[0][i], tail_tip))
    bm.faces.new((rings[-1][i], rings[-1][j], beak_tip))

# ---- wings: a plate between a leading and a trailing edge, fingered at the tip ---------
ROOT_X = 0.045
TIP_X = 0.50
SPAN_N = 13      # span segments: the shader bends the wing along these
CHORD_N = 2

def leading(s):     # s: 0 root .. 1 tip; y of the leading edge
    return 0.075 - 0.02 * s - 0.11 * s ** 3      # swept back toward the tip

def trailing(s):
    base = -0.105 + 0.035 * s - 0.03 * s ** 2
    # primaries: the outer third of the trailing edge is cut into fingers
    if s > 0.58:
        f = (s - 0.58) / 0.42
        base -= 0.05 * math.sin(f * math.pi) + 0.04 * (0.5 - 0.5 * math.cos(f * math.pi * 4.0)) * (1 - f * 0.6)
    return base

def wing(side_sign):
    side = 1.0 if side_sign > 0 else 0.0
    grid = []
    for i in range(SPAN_N + 1):
        s = i / SPAN_N
        x = side_sign * (ROOT_X + (TIP_X - ROOT_X) * s)
        le, te = leading(s), trailing(s)
        if i == SPAN_N:
            le = te = (le + te) * 0.5 - 0.01    # pointed tip
        # slight camber and a droop-free rest pose; the root sits at the shoulder height
        zc = 0.035 - 0.02 * s
        row = []
        for j in range(CHORD_N + 1):
            c = j / CHORD_N
            y = le + (te - le) * c
            z = zc + 0.012 * math.sin(c * math.pi) * (1 - s)
            tipmix = max(0.0, (s - 0.5) * 2)
            col = tuple(WING[k] * (1 - tipmix) + WING_TIP[k] * tipmix for k in range(3))
            row.append(add_vert(x, y, z, s, side, col))
        grid.append(row)
    for i in range(SPAN_N):
        for j in range(CHORD_N):
            a, b = grid[i][j], grid[i][j + 1]
            c, d = grid[i + 1][j + 1], grid[i + 1][j]
            quad = (a, b, c, d) if side_sign > 0 else (a, d, c, b)
            try:
                bm.faces.new(quad)
            except ValueError:
                pass

wing(+1)
wing(-1)

# ---- tail: a fan behind the body ---------------------------------------------------------
TAIL = [(-0.16, 0.022), (-0.23, 0.048), (-0.29, 0.062), (-0.325, 0.056)]
tail_rows = []
for k, (y, hw) in enumerate(TAIL):
    z = 0.004 + 0.012 * k / (len(TAIL) - 1)
    row = [add_vert(x, y, z, 0.0, 0.5, BACK) for x in (-hw, -hw * 0.34, hw * 0.34, hw)]
    tail_rows.append(row)
for ra, rb in zip(tail_rows, tail_rows[1:]):
    for i in range(3):
        bm.faces.new((ra[i], rb[i], rb[i + 1], ra[i + 1]))

# ---- attributes ----------------------------------------------------------------------------
for f in bm.faces:
    for loop in f.loops:
        w, side, col = vdata[loop.vert]
        loop[uv_lay].uv = (w, side)
        loop[col_lay] = (col[0], col[1], col[2], 1.0)
bm.normal_update()

mesh = bpy.data.meshes.new("Bird")
bm.to_mesh(mesh)
bm.free()
mesh.color_attributes.render_color_index = 0
mesh.color_attributes.active_color_index = 0
mesh.shade_smooth() if hasattr(mesh, "shade_smooth") else None
for p in mesh.polygons:
    p.use_smooth = True
obj = bpy.data.objects.new("Bird", mesh)
bpy.context.scene.collection.objects.link(obj)

mat = bpy.data.materials.new("Plumage")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
bsdf.inputs["Roughness"].default_value = 0.85
mat.use_backface_culling = False
mesh.materials.append(mat)

pts = [Vector(c) for c in obj.bound_box]
print("BIRD tris", sum(len(p.vertices) - 2 for p in mesh.polygons),
      "span", round(max(p.x for p in pts) - min(p.x for p in pts), 3),
      "length", round(max(p.y for p in pts) - min(p.y for p in pts), 3))

# ---- export --------------------------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
    export_animations=False, export_skins=False, export_morph=False, export_apply=True,
    export_yup=True, export_texcoords=True, export_normals=True,
    export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True,
    export_materials='EXPORT')
print("EXPORTED", OUT, os.path.getsize(OUT) // 1024, "KB")

# ---- preview: three views on one sheet, so the silhouette can be checked ------------------
if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'VERTEX'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 600
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("W"); scene.world = world
    world.color = (0.55, 0.7, 0.9)
    cam_data = bpy.data.cameras.new("Cam"); cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new("Cam", cam_data); scene.collection.objects.link(cam)
    scene.camera = cam
    base, ext = os.path.splitext(PREVIEW)
    for name, loc, rot, ortho in (
        ("top", (0, 0, 5), (0, 0, 0), 1.25),
        ("front", (0, 5, 0), (math.pi / 2, 0, math.pi), 1.25),
        ("side", (5, 0, 0), (math.pi / 2, 0, math.pi / 2), 0.9),
        ("below", (2.5, -3.5, -3), (0, 0, 0), 1.3),
    ):
        cam.location = loc
        if name == "below":
            direction = Vector((0, 0, 0)) - Vector(loc)
            cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        else:
            cam.rotation_euler = rot
        cam_data.ortho_scale = ortho
        scene.render.filepath = f"{base}_{name}{ext}"
        bpy.ops.render.render(write_still=True)
        print("PREVIEW", scene.render.filepath)
