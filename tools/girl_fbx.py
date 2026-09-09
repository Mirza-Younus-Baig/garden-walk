import bpy, sys, os, math
from mathutils import Vector
S="/private/tmp/claude-501/-Users-myb-IdeaProjects-Garden/ae249880-6902-4b23-8565-1898c7898281/scratchpad/prev_fbx"
os.makedirs(S,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath="/Users/myb/IdeaProjects/Garden/raw/girl_src/source/All.fbx", automatic_bone_orientation=False, use_anim=True)
arms=[o for o in bpy.data.objects if o.type=='ARMATURE']
print("ARMATURES", [(a.name, len(a.data.bones), tuple(round(s,3) for s in a.matrix_world.to_scale())) for a in arms])
meshes=[o for o in bpy.data.objects if o.type=='MESH']
for o in [m for m in meshes if any(md.type=='ARMATURE' for md in m.modifiers)]:
    pts=[o.matrix_world@Vector(c) for c in o.bound_box]
    arm=[m.object.name for m in o.modifiers if m.type=='ARMATURE' and m.object]
    print(f"MESH {o.name!r} polys={len(o.data.polygons)} arm={arm} zmin={min(p.z for p in pts):.2f} zmax={max(p.z for p in pts):.2f} mats={[m.name for m in o.data.materials]} parent={o.parent.name if o.parent else '-'}")
for a in arms:
    keys=("Root_M","Hip_","Knee_","Ankle_","Toes_","Spine1_M","Chest_M","Neck_M","Head_M","Scapula_","Shoulder_","Elbow_","Wrist_")
    for b in a.data.bones:
        if any(b.name.split(':')[-1].startswith(k) for k in keys) and "Part" not in b.name and "Slide" not in b.name:
            h=a.matrix_world@b.head_local; t=a.matrix_world@b.tail_local
            print(f"BONE {a.name}:{b.name:14s} parent={(b.parent.name if b.parent else '-'):18s} head=({h.x:.3f},{h.y:.3f},{h.z:.3f}) tail=({t.x:.3f},{t.y:.3f},{t.z:.3f})")
def fcurves_of(act):
    if hasattr(act,'fcurves'): return list(act.fcurves)
    out=[]
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags: out.extend(cb.fcurves)
    return out
for act in bpy.data.actions:
    groups=sorted(set(fc.data_path.split('"')[1] for fc in fcurves_of(act) if '"' in fc.data_path))
    print("ACTION", act.name, act.frame_range[:], "nbones", len(groups), groups[:12])
print("SCENE frames", bpy.context.scene.frame_start, bpy.context.scene.frame_end, "fps", bpy.context.scene.render.fps)
sc=bpy.context.scene; sc.render.engine='BLENDER_WORKBENCH'; sc.display.shading.light='STUDIO'; sc.display.shading.color_type='TEXTURE'
sc.render.resolution_x=600; sc.render.resolution_y=800
sc.world=bpy.data.worlds.new("W"); sc.world.color=(0.4,0.4,0.4)
cam=bpy.data.objects.new("Cam",bpy.data.cameras.new("Cam")); sc.collection.objects.link(cam); sc.camera=cam; cam.data.type='ORTHO'
pts=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
c=Vector(((max(p.x for p in pts)+min(p.x for p in pts))/2,(max(p.y for p in pts)+min(p.y for p in pts))/2,(max(p.z for p in pts)+min(p.z for p in pts))/2))
size=max((max(p.z for p in pts)-min(p.z for p in pts)),(max(p.x for p in pts)-min(p.x for p in pts)))*1.2
cam.location=c+Vector((0,-10,0))*size; cam.rotation_euler=(math.pi/2,0,0); cam.data.ortho_scale=size
for f in [0,30,60,90,120,150,180,210]:
    sc.frame_set(f); sc.render.filepath=os.path.join(S,f"f{f:03d}.png"); bpy.ops.render.render(write_still=True)
