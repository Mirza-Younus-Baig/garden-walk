// Builds public/models/bouquet.glb for the birthday room: the tulip and daisy scans the garden
// already ships, cut down to the stems the vase uses, so it does not download whole meadows.
// (The lilies in the vase are modelled in code: the lily scans are whole curving plants.)
//   node tools/build_bouquet.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, unpartition, metalRough, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const KEEP = {
  tulip: ['tulipa_lod0'],
  daisy: ['daisy_1_lod0', 'daisy_2_lod0'],
};
const out = await io.read('public/models/tulip.glb');
for (const name of ['daisy']) mergeDocuments(out, await io.read(`public/models/${name}.glb`));
const keep = new Set(Object.values(KEEP).flat());
const root = out.getRoot();
for (const node of root.listNodes()) if (node.getMesh() && !keep.has(node.getName())) node.dispose();
// one scene holding every kept stem
const [scene, ...rest] = root.listScenes();
for (const s of rest) { for (const n of s.listChildren()) scene.addChild(n); s.dispose(); }
// metalRough: the tulip scan is spec/gloss, which three.js no longer reads. Textures go to
// 1k WebP: a stem in a vase is never more than a hand-span on screen.
await out.transform(metalRough(), prune(), dedup(), unpartition(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 88 }));
out.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write('public/models/bouquet.glb', out);
console.log('nodes', root.listNodes().map((n) => n.getName()).join(' '));
console.log('textures', root.listTextures().map((t) => `${t.getName()}:${t.getMimeType()}:${t.getImage()?.byteLength}`).join(' '));
