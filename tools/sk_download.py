"""Download a Sketchfab model's glTF archive into raw/.  usage: python3 tools/sk_download.py <uid> <outname>"""
import json, sys, os, urllib.request, zipfile, io
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN = [l.strip().split("=",1)[1] for l in open(f"{ROOT}/.env") if l.startswith("SKETCHFAB_TOKEN=")][0]

def api(u):
    return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"Authorization": f"Token {TOKEN}"})))

uid, name = sys.argv[1], sys.argv[2]
d = api(f"https://api.sketchfab.com/v3/models/{uid}/download")
if "gltf" not in d:
    print("no gltf flavour:", list(d)); sys.exit(1)
url, size = d["gltf"]["url"], d["gltf"]["size"]
print(f"{name}: downloading {size/1e6:.1f} MB")
out = f"{ROOT}/raw/{name}"
os.makedirs(out, exist_ok=True)
data = urllib.request.urlopen(url).read()
with zipfile.ZipFile(io.BytesIO(data)) as z:
    z.extractall(out)
    print("  ", len(z.namelist()), "files")
for root, _, files in os.walk(out):
    for f in files:
        if f.endswith((".gltf", ".glb", ".bin")):
            p = os.path.join(root, f)
            print("   ", os.path.relpath(p, out), os.path.getsize(p)//1024, "KB")
