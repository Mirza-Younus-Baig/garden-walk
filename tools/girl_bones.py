import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath="/Users/myb/IdeaProjects/Garden/raw/girl_src/source/All.fbx", automatic_bone_orientation=False, use_anim=False)
arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
names=[b.name for b in arm.data.bones if not b.name.startswith("CGirl_DancePose")]
print("MAIN BONES", len(names))
print("NAMES", names)
for m in [o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith("model:")]:
    vg=[g.name for g in m.vertex_groups]
    print("MESH", m.name, "groups", len(vg), "skirt-ish", [g for g in vg if 'Skirt' in g or 'Hip' in g or 'Knee' in g][:12], "shapekeys", len(m.data.shape_keys.key_blocks) if m.data.shape_keys else 0, "mats", [x.name for x in m.data.materials])
for b in arm.data.bones:
    if 'Skirt' in b.name and not b.name.startswith('CGirl'): print("SKIRTBONE", b.name, "parent", b.parent.name if b.parent else None)
