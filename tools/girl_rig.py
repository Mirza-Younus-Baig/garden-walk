import bpy, sys
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="raw/college_girl.glb")
arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
print("ARM scale", arm.matrix_world.to_scale()[:], "loc", arm.matrix_world.translation[:])
main=[b for b in arm.data.bones if not any(k in b.name for k in ("Hair","Skirt","Slide","Slider","Part","Finger","Thumb","Index","Middle","Ring","Pinky","Cup","Eye","Jaw","Lip","Brow","Cheek","Tongue","Teeth","Nose","Tie","Bag","Ribbon"))]
for b in main:
    h=arm.matrix_world@b.head_local; t=arm.matrix_world@b.tail_local
    print(f"BONE {b.name:28s} parent={(b.parent.name if b.parent else "-"):26s} head=({h.x:.3f},{h.y:.3f},{h.z:.3f}) tail=({t.x:.3f},{t.y:.3f},{t.z:.3f}) len={(t-h).length:.3f}")
print("NBONES", len(arm.data.bones))
for a in bpy.data.actions:
    groups=set(fc.data_path.split('"')[1] for fc in a.fcurves if '"' in fc.data_path)
    print("ACTION", a.name, a.frame_range[:], "bones animated:", len(groups), sorted(groups)[:30])
# rigged meshes world bbox
skinned=[o for o in bpy.data.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
pts=[o.matrix_world@Vector(c) for o in skinned for c in o.bound_box]
print("SKINNED BBOX", tuple(round(min(p[i] for p in pts),3) for i in range(3)), tuple(round(max(p[i] for p in pts),3) for i in range(3)), "polys", sum(len(o.data.polygons) for o in skinned))
