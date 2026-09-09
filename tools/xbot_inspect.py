import bpy
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/Users/myb/IdeaProjects/Garden/raw/xbot.glb")
arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
print("ARM", arm.name, len(arm.data.bones), "scale", arm.matrix_world.to_scale()[:])
for b in arm.data.bones:
    if any(k in b.name for k in ("Hips","Spine","Neck","Head","Shoulder","Arm","Hand","UpLeg","Leg","Foot","Toe")) and "Hand" not in b.name[len("mixamorigLeftHand"):] and not any(k in b.name for k in ("Thumb","Index","Middle","Ring","Pinky")):
        h=arm.matrix_world@b.head_local; t=arm.matrix_world@b.tail_local
        print(f"BONE {b.name:28s} parent={(b.parent.name if b.parent else '-'):24s} head=({h.x:.3f},{h.y:.3f},{h.z:.3f}) tail=({t.x:.3f},{t.y:.3f},{t.z:.3f})")
def fcurves_of(act):
    if hasattr(act,'fcurves'): return list(act.fcurves)
    return [fc for layer in act.layers for strip in layer.strips for cb in strip.channelbags for fc in cb.fcurves]
for act in bpy.data.actions:
    print("ACTION", act.name, act.frame_range[:], "fcurves", len(fcurves_of(act)), "slots", [s.name_display for s in act.slots] if hasattr(act,'slots') else None)
print("FPS", bpy.context.scene.render.fps)
