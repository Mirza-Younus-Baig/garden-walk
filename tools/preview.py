# usage: blender -b --python tools/preview.py -- in.glb outdir [group_by: mat|obj|none]
import bpy, sys, os, math
from mathutils import Vector
args=sys.argv[sys.argv.index("--")+1:]
path, outdir = args[0], args[1]; mode = args[2] if len(args)>2 else "none"
os.makedirs(outdir, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
sc=bpy.context.scene
sc.render.engine='BLENDER_WORKBENCH'
sc.display.shading.light='STUDIO'; sc.display.shading.color_type='TEXTURE'
sc.render.resolution_x=900; sc.render.resolution_y=700; sc.render.film_transparent=False
sc.world = bpy.data.worlds.new("W"); sc.world.color=(0.35,0.35,0.35)
meshes=[o for o in bpy.data.objects if o.type=='MESH']
def wbbox(objs):
    pts=[o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    mn=Vector((min(p.x for p in pts),min(p.y for p in pts),min(p.z for p in pts)))
    mx=Vector((max(p.x for p in pts),max(p.y for p in pts),max(p.z for p in pts)))
    return mn,mx
mn,mx=wbbox(meshes); print("WORLD BBOX", tuple(round(v,3) for v in mn), tuple(round(v,3) for v in mx))
for o in meshes:
    a,b=wbbox([o]); print(f"OBJ {o.name!r} polys={len(o.data.polygons)} mat={[m.name for m in o.data.materials]} wmin={tuple(round(v,3) for v in a)} wmax={tuple(round(v,3) for v in b)}")
cam=bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); sc.collection.objects.link(cam); sc.camera=cam
cam.data.type='ORTHO'
def shoot(objs, name):
    for o in meshes: o.hide_render = o not in objs
    a,b=wbbox(objs); c=(a+b)/2; size=max((b-a).x,(b-a).y,(b-a).z)*1.15
    for view,(loc,rot) in {"front":((0,-10,0),(math.pi/2,0,0)),"side":((10,0,0),(math.pi/2,0,math.pi/2)),"top":((0,0,10),(0,0,0))}.items():
        cam.location=c+Vector(loc)*size; cam.rotation_euler=rot; cam.data.ortho_scale=size
        sc.render.filepath=os.path.join(outdir,f"{name}_{view}.png"); bpy.ops.render.render(write_still=True)
shoot(meshes,"all")
if mode=="mat":
    groups={}
    for o in meshes:
        k=o.data.materials[0].name if o.data.materials else "none"; groups.setdefault(k,[]).append(o)
    for k,v in groups.items():
        # pick highest poly object in group
        best=max(v,key=lambda o:len(o.data.polygons)); shoot([best], f"mat_{k}_{best.name}")
elif mode=="obj":
    for o in meshes: shoot([o], f"obj_{o.name}")
