import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
const q = new URLSearchParams(location.search);
const model = q.get('model') ?? '/models/girl.glb';
const clip = q.get('clip'); const t = parseFloat(q.get('t') ?? '0');
const az = parseFloat(q.get('az') ?? '30') * Math.PI / 180; const el = parseFloat(q.get('el') ?? '10') * Math.PI / 180;
const zoom = parseFloat(q.get('zoom') ?? '1');
const W = 900, H = 900;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x667788);
const cam = new THREE.PerspectiveCamera(35, W / H, 0.01, 100);
const sun = new THREE.DirectionalLight(0xfff2e0, 3); sun.position.set(3, 6, 4); sun.castShadow = true; scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x556633, 1.2));
const grid = new THREE.GridHelper(4, 8, 0x888888, 0x666666); scene.add(grid);
const info: any = (window as any).__info = {};
(async () => {
  try { const hdr = await new RGBELoader().loadAsync('/textures/sky_1k.hdr'); hdr.mapping = THREE.EquirectangularReflectionMapping; scene.environment = hdr; } catch { }
  const gltf = await new GLTFLoader().loadAsync(model);
  const root = gltf.scene; scene.add(root);
  root.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
  info.size = size.toArray().map(v => +v.toFixed(3)); info.min = box.min.toArray().map(v => +v.toFixed(3)); info.max = box.max.toArray().map(v => +v.toFixed(3));
  info.clips = gltf.animations.map(a => ({ name: a.name, duration: +a.duration.toFixed(3), tracks: a.tracks.length }));
  let tris = 0, meshes = 0, mats = new Set<string>(); const texs = new Set<string>();
  root.traverse((o: any) => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; const m = o.material; mats.add(m.name); for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) texs.add(k + ':' + m[k].image?.width + 'x' + m[k].image?.height); if (o.isSkinnedMesh) info.skinned = (info.skinned ?? 0) + 1; } });
  info.tris = tris; info.meshes = meshes; info.materials = [...mats]; info.textures = [...texs];
  if (clip) {
    const mixer = new THREE.AnimationMixer(root); const a = gltf.animations.find(x => x.name === clip);
    if (a) { mixer.clipAction(a).play(); mixer.update(t); root.updateMatrixWorld(true); const b2 = new THREE.Box3().setFromObject(root); info.animBox = { min: b2.min.toArray().map(v => +v.toFixed(2)), max: b2.max.toArray().map(v => +v.toFixed(2)) }; const hips = root.getObjectByName('Root_M'); if (hips) info.hips = hips.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(3)); info.posTracks = a.tracks.filter(t => t.name.endsWith('.position')).map(t => t.name + ' ' + Array.from(t.values.slice(0, 6)).map(v => +v.toFixed(3))); } else info.clipError = 'no clip ' + clip;
  }
  const r = Math.max(size.x, size.y, size.z) * 1.6 / zoom;
  cam.position.set(c.x + r * Math.sin(az) * Math.cos(el), c.y + r * Math.sin(el), c.z + r * Math.cos(az) * Math.cos(el)); cam.lookAt(c);
  renderer.render(scene, cam); (window as any).__ready = true;
})().catch(e => { info.error = String(e); (window as any).__ready = true; });
