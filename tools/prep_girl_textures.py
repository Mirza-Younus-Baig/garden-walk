from PIL import Image, ImageChops
import numpy as np, os
src="raw/girl_src/textures"; out="raw/girl_tex"; os.makedirs(out,exist_ok=True)
sets={"head":("Head","Ambient_Occlusion_Map_from_Mesh_Head.1001.png",2048),
      "body":("Body1","Ambient_Occlusion_Map_from_Mesh_Body1.1001.png",2048),
      "hair":("lambert1","Ambient_Occlusion_Map_from_Mesh_lambert1.1.png",1024)}
for key,(tag,aof,size) in sets.items():
    base=Image.open(f"{src}/Girl_Combined3_{tag}_BaseColor.1001.png").convert("RGB")
    ao=np.array(Image.open(f"{src}/{aof}"),dtype=np.float32); ao=ao/ao.max()
    ao=Image.fromarray((ao*255).astype(np.uint8)).resize(base.size)
    aoarr=np.array(ao,dtype=np.float32)/255.0; aoarr=0.45+0.55*aoarr   # soften AO
    b=np.array(base,dtype=np.float32)*aoarr[...,None]
    Image.fromarray(np.clip(b,0,255).astype(np.uint8)).resize((size,size),Image.LANCZOS).save(f"{out}/{key}_base.png")
    Image.open(f"{src}/Girl_Combined3_{tag}_Normal.1001.png").convert("RGB").resize((size,size),Image.LANCZOS).save(f"{out}/{key}_normal.png")
    rough=Image.open(f"{src}/Girl_Combined3_{tag}_Roughness.1001.png").convert("L").resize((size,size),Image.LANCZOS)
    metal=Image.open(f"{src}/Girl_Combined3_{tag}_Metallic.1001.png").convert("L").resize((size,size),Image.LANCZOS)
    white=Image.new("L",(size,size),255)
    Image.merge("RGB",(white,rough,metal)).save(f"{out}/{key}_orm.png")
    print(key, "rough mean", np.array(rough).mean().round(1), "metal mean", np.array(metal).mean().round(1))
