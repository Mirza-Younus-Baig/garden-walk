"""Build girl.glb: clean College Girl FBX, PBR materials, retarget Xbot idle/walk, export.
usage: blender -b --python tools/build_girl.py -- <out.glb> <render_dir>
"""
import bpy, sys, os, math
from mathutils import Vector, Matrix, Quaternion

ROOT = "/Users/myb/IdeaProjects/Garden"
args = sys.argv[sys.argv.index("--") + 1:]
OUT = args[0] if args else f"{ROOT}/app/public/models/girl.glb"
RDIR = args[1] if len(args) > 1 else None
TARGET_HEIGHT = 1.55

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=f"{ROOT}/raw/girl_src/source/All.fbx", automatic_bone_orientation=False, use_anim=False)
tgt = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
tgt.name = "Girl"

# ---- 1. clean up meshes and bones -------------------------------------------------
keep = []
for o in list(bpy.data.objects):
    if o.type == 'MESH':
        if o.name.startswith("model:") and any(m.type == 'ARMATURE' for m in o.modifiers):
            keep.append(o)
        else:
            bpy.data.objects.remove(o, do_unlink=True)
for o in keep:
    if o.data.shape_keys:
        o.shape_key_clear()
    o.name = o.name.replace("model:", "")
bpy.context.view_layer.objects.active = tgt
bpy.ops.object.mode_set(mode='EDIT')
for eb in list(tgt.data.edit_bones):
    if eb.name.startswith("CGirl_DancePose") or eb.name.startswith("ik_"):
        tgt.data.edit_bones.remove(eb)
bpy.ops.object.mode_set(mode='OBJECT')
for pb in tgt.pose.bones:
    pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
bpy.context.view_layer.update()
print("KEPT", [o.name for o in keep], "bones", len(tgt.data.bones))

# ---- 2. apply scale, normalise height ----------------------------------------------
def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
select_only(keep)
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
def bake_transforms(objs):
    for o in objs:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    bpy.context.view_layer.update()
bake_transforms([tgt] + keep)
pts = [o.matrix_world @ Vector(c) for o in keep for c in o.bound_box]
zmin, zmax = min(p.z for p in pts), max(p.z for p in pts)
s = TARGET_HEIGHT / (zmax - zmin)
print("RAW HEIGHT", round(zmax - zmin, 3), "scale", round(s, 4))
for o in [tgt] + keep:
    o.matrix_world = Matrix.Translation((0, 0, -zmin * s)) @ Matrix.Scale(s, 4)
bake_transforms([tgt] + keep)
for o in keep:
    o.parent = tgt; o.matrix_parent_inverse = Matrix.Identity(4)
pts = [o.matrix_world @ Vector(c) for o in keep for c in o.bound_box]
print("HEIGHT", round(max(p.z for p in pts) - min(p.z for p in pts), 3), "zmin", round(min(p.z for p in pts), 3), "hip z", round(tgt.data.bones["Root_M"].head_local.z, 3))

# ---- 3. materials ------------------------------------------------------------------
def make_mat(name, key):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    def img(fn, noncolor=False):
        n = nt.nodes.new("ShaderNodeTexImage"); n.image = bpy.data.images.load(f"{ROOT}/raw/girl_tex/{fn}")
        if noncolor: n.image.colorspace_settings.name = 'Non-Color'
        return n
    nt.links.new(img(f"{key}_base.png").outputs[0], bsdf.inputs["Base Color"])
    nm = nt.nodes.new("ShaderNodeNormalMap"); nt.links.new(img(f"{key}_normal.png", True).outputs[0], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(img(f"{key}_orm.png", True).outputs[0], sep.inputs[0])
    nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"]); nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])
    bsdf.inputs["Specular IOR Level"].default_value = 0.35
    return m
mats = {"Head": make_mat("GirlHead", "head"), "Body1": make_mat("GirlBody", "body"), "lambert2": make_mat("GirlHair", "hair")}
for o in keep:
    for i, slot in enumerate(o.material_slots):
        old = slot.material.name if slot.material else ""
        key = next((k for k in mats if old.endswith(k)), "Body1")
        slot.material = mats[key]
    bpy.context.view_layer.objects.active = o
    with bpy.context.temp_override(object=o, selected_editable_objects=[o]):
        bpy.ops.object.shade_smooth()

# ---- 4. import source (Xbot) --------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=f"{ROOT}/raw/xbot.glb")
src_objs = [o for o in bpy.data.objects if o not in before]
src = [o for o in src_objs if o.type == 'ARMATURE'][0]
for o in src_objs:
    if o.type == 'MESH': o.hide_viewport = True; o.hide_render = True
src_actions = {a.name: a for a in bpy.data.actions if a.name in ("idle", "walk")}
print("SRC ACTIONS", list(src_actions))

# ---- 5. retarget ---------------------------------------------------------------------
S = "mixamorig:"
# (src bone, tgt bone, src dir-target bone, tgt dir-target bone)
CHAIN = [
    (S+"Spine",        "Spine1_M",  S+"Spine2",          "Chest_M"),
    (S+"Neck",         "Neck_M",    S+"Head",            "Head_M"),
    (S+"Head",         "Head_M",    S+"HeadTop_End",     "HeadEnd_M"),
]
for side, s2 in (("Left", "L"), ("Right", "R")):
    CHAIN += [
        (S+f"{side}Shoulder", f"Scapula_{s2}",  S+f"{side}Arm",        f"Shoulder_{s2}"),
        (S+f"{side}Arm",      f"Shoulder_{s2}", S+f"{side}ForeArm",    f"Elbow_{s2}"),
        (S+f"{side}ForeArm",  f"Elbow_{s2}",    S+f"{side}Hand",       f"Wrist_{s2}"),
        (S+f"{side}Hand",     f"Wrist_{s2}",    S+f"{side}HandMiddle1", f"MiddleFinger1_{s2}"),
        (S+f"{side}UpLeg",    f"Hip_{s2}",      S+f"{side}Leg",        f"Knee_{s2}"),
        (S+f"{side}Leg",      f"Knee_{s2}",     S+f"{side}Foot",       f"Ankle_{s2}"),
        (S+f"{side}Foot",     f"Ankle_{s2}",    S+f"{side}ToeBase",    f"Toes_{s2}"),
        (S+f"{side}ToeBase",  f"Toes_{s2}",     S+f"{side}Toe_End",    f"ToesEnd_{s2}"),
    ]
FRAMES = {  # two-vector matches: (src, tgt, src_up_target, tgt_up_target, (src_sideA, src_sideB), (tgt_sideA, tgt_sideB))
    "Root_M":  (S+"Hips",   S+"Spine", "Spine1_M", (S+"LeftUpLeg", S+"RightUpLeg"), ("Hip_L", "Hip_R")),
    "Chest_M": (S+"Spine2", S+"Neck",  "Neck_M",   (S+"LeftShoulder", S+"RightShoulder"), ("Scapula_L", "Scapula_R")),
}
SKIRT = {  # skirt bone -> (hip bone, factor)
    "deformSkirtF_L": ("Hip_L", 0.75), "deformSkirtF_R": ("Hip_R", 0.75),
    "deformSkirtM_L": ("Hip_L", 0.55), "deformSkirtM_R": ("Hip_R", 0.55),
    "deformSkirtB_L": ("Hip_L", 0.45), "deformSkirtB_R": ("Hip_R", 0.45),
}
ORDER = ["Root_M", "Spine1_M", "Chest_M", "Neck_M", "Head_M",
         "Scapula_L", "Shoulder_L", "Elbow_L", "Wrist_L", "Scapula_R", "Shoulder_R", "Elbow_R", "Wrist_R",
         "Hip_L", "Knee_L", "Ankle_L", "Toes_L", "Hip_R", "Knee_R", "Ankle_R", "Toes_R"]
chain_by_tgt = {c[1]: c for c in CHAIN}

for o in keep:
    for m in o.modifiers:
        if m.type == 'ARMATURE': m.show_viewport = False

tM = tgt.matrix_world; tMi = tM.inverted(); sM = src.matrix_world
def src_head_world(n): return sM @ src.pose.bones[n].head
def src_rest_world(n): return sM @ src.data.bones[n].head_local
def tgt_rest(n): return tgt.data.bones[n].head_local  # armature space (== world, transforms applied)
hip_ratio = (tgt_rest("Root_M").z) / (src_rest_world(S+"Hips").z)
print("HIP RATIO", round(hip_ratio, 3))

def parent_delta(bname):
    """matrix mapping rest armature-space to current for things rigid with the parent"""
    b = tgt.data.bones[bname]
    if b.parent is None: return Matrix.Identity(4)
    return tgt.pose.bones[b.parent.name].matrix @ b.parent.matrix_local.inverted()

def frame_from(up, side):
    u = up.normalized(); sd = side - side.dot(u) * u; sd.normalize(); f = u.cross(sd)
    return Matrix((u, sd, f)).transposed()  # columns u, sd, f

def set_bone(bname, R, translation=None):
    b = tgt.data.bones[bname]; pb = tgt.pose.bones[bname]
    base = parent_delta(bname) @ b.matrix_local
    head = base.translation.copy()
    M = Matrix.Translation(head) @ R.to_matrix().to_4x4() @ Matrix.Translation(-head) @ base
    if translation is not None: M.translation = translation
    pb.matrix = M

hipR = {}
def retarget(act_name, out_name):
    act = src_actions[act_name]
    src.animation_data_create(); src.animation_data.action = act
    try: src.animation_data.action_slot = act.slots[0]
    except Exception as e: print("slot warn", e)
    nact = bpy.data.actions.new(out_name)
    tgt.animation_data_create(); tgt.animation_data.action = nact
    slot = nact.slots.new(id_type='OBJECT', name=tgt.name); tgt.animation_data.action_slot = slot
    for pb in tgt.pose.bones: pb.rotation_mode = 'QUATERNION'
    f0, f1 = act.frame_range; n = int(math.floor(f1 - f0 + 1e-4))
    frames = list(range(0, n + 1))
    for f in frames:
        bpy.context.scene.frame_set(f); bpy.context.view_layer.update()
        for bname in ORDER:
            if bname in FRAMES:
                sb, s_up, t_up, (sA, sB), (tA, tB) = FRAMES[bname]
                d1u = tMi.to_3x3() @ (src_head_world(s_up) - src_head_world(sb))
                d1s = tMi.to_3x3() @ (src_head_world(sA) - src_head_world(sB))
                A = parent_delta(bname).to_3x3()
                d0u = A @ (tgt_rest(t_up) - tgt_rest(bname)); d0s = A @ (tgt_rest(tA) - tgt_rest(tB))
                R = (frame_from(d1u, d1s) @ frame_from(d0u, d0s).transposed()).to_quaternion()
                trans = None
                if bname == "Root_M":
                    delta = (src_head_world(sb) - src_rest_world(sb)) * hip_ratio
                    trans = tMi @ (tM @ tgt_rest(bname) + delta)
                set_bone(bname, R, trans)
            else:
                sb, tb, sd, td = chain_by_tgt[bname]
                d1 = tMi.to_3x3() @ (src_head_world(sd) - src_head_world(sb))
                d0 = parent_delta(bname).to_3x3() @ (tgt_rest(td) - tgt_rest(bname))
                R = d0.normalized().rotation_difference(d1.normalized())
                set_bone(bname, R)
                if bname.startswith("Hip_"): hipR[bname] = R
            pb = tgt.pose.bones[bname]
            pb.keyframe_insert("rotation_quaternion", frame=f)
            if bname == "Root_M": pb.keyframe_insert("location", frame=f)
            bpy.context.view_layer.update()
        for sk, (hb, fac) in SKIRT.items():
            R = Quaternion((1, 0, 0, 0)).slerp(hipR[hb], fac)
            set_bone(sk, R); tgt.pose.bones[sk].keyframe_insert("rotation_quaternion", frame=f)
        bpy.context.view_layer.update()
    print("RETARGETED", out_name, "frames", len(frames))
    return nact, slot

clips = [retarget("idle", "idle"), retarget("walk", "walk")]
tgt.animation_data.action = None
for act, slot in clips:
    tr = tgt.animation_data.nla_tracks.new(); tr.name = act.name
    st = tr.strips.new(act.name, 0, act)
    try: st.action_slot = slot
    except Exception as e: print("strip slot warn", e)
for o in src_objs: bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions):
    if a not in [c[0] for c in clips]: bpy.data.actions.remove(a)
for act, slot in clips:
    act.name = act.name.split(".")[0]
for tr in tgt.animation_data.nla_tracks: tr.name = tr.name.split(".")[0]
for o in keep:
    for m in o.modifiers:
        if m.type == 'ARMATURE': m.show_viewport = True

# ---- 6. export -----------------------------------------------------------------------
select_only([tgt] + keep)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
    export_skins=True, export_morph=False, export_apply=True, export_yup=True,
    export_image_format='AUTO', export_optimize_animation_size=True, export_anim_slide_to_zero=True)
print("EXPORTED", OUT, os.path.getsize(OUT) // 1024, "KB")

# ---- 7. renders ----------------------------------------------------------------------
if RDIR:
    os.makedirs(RDIR, exist_ok=True)
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x = 500; sc.render.resolution_y = 800
    sc.world = bpy.data.worlds.new("W"); sc.world.color = (0.45, 0.45, 0.45)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.0
    for tr in tgt.animation_data.nla_tracks:
        for f in (0, 6, 12, 18):
            tr.mute = False
            for o in tgt.animation_data.nla_tracks:
                o.mute = o != tr
            sc.frame_set(f)
            for view, (loc, rot) in {"front": ((0, -6, 0.8), (math.pi/2, 0, 0)), "side": ((6, 0, 0.8), (math.pi/2, 0, math.pi/2))}.items():
                cam.location = loc; cam.rotation_euler = rot
                sc.render.filepath = os.path.join(RDIR, f"{tr.name}_{f:02d}_{view}.png"); bpy.ops.render.render(write_still=True)
    print("RENDERED", RDIR)
