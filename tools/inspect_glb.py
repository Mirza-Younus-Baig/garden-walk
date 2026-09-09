import bpy, sys, os
path = sys.argv[sys.argv.index("--")+1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
print("=== ", os.path.basename(path))
tot=0
for o in bpy.data.objects:
    if o.type=='MESH':
        n=len(o.data.polygons); tot+=n
        d=o.dimensions
        mats=[m.name if m else None for m in o.data.materials]
        vc=[c.name for c in getattr(o.data,'color_attributes',[])]
        uv=len(o.data.uv_layers)
        arm=[m.object.name for m in o.modifiers if m.type=='ARMATURE' and m.object]
        print(f"MESH {o.name!r} polys={n} dims=({d.x:.2f},{d.y:.2f},{d.z:.2f}) loc=({o.location.x:.2f},{o.location.y:.2f},{o.location.z:.2f}) mats={mats} vcol={vc} uv={uv} arm={arm} parent={o.parent.name if o.parent else None}")
    elif o.type=='ARMATURE':
        bones=[b.name for b in o.data.bones]
        print(f"ARMATURE {o.name!r} bones={len(bones)} first={bones[:60]}")
    elif o.type=='EMPTY':
        pass
print("TOTAL polys", tot)
for img in bpy.data.images:
    print("IMG", img.name, img.size[:], img.filepath[:60])
for a in bpy.data.actions:
    print("ACTION", a.name, a.frame_range[:])
for m in bpy.data.materials:
    print("MAT", m.name, "blend=", m.blend_method if hasattr(m,'blend_method') else None)
