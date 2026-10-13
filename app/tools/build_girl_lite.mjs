// Builds the birthday room's lighter copies of the girl from public/models/girl.glb:
//   girl_2k.glb   the same 2048 px maps as WebP: the same look, a fraction of the download
//   girl_1k.glb   1024 px WebP maps, for phones and tablets (a quarter of the GPU memory)
// Geometry, skin and animations are copied untouched. The garden keeps loading girl.glb.
//   node tools/build_girl_lite.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { statSync } from 'node:fs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const SRC = 'public/models/girl.glb';

for (const [out, size] of [['public/models/girl_2k.glb', 2048], ['public/models/girl_1k.glb', 1024]]) {
  const doc = await io.read(SRC);
  // colour and occlusion/roughness maps take lossy WebP well; normal maps band under it, so
  // they keep near-lossless quality
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], slots: /^(?!normalTexture).*$/, quality: 90 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], slots: /^normalTexture$/, nearLossless: true, quality: 80 }),
  );
  await io.write(out, doc);
  const tex = doc.getRoot().listTextures().map((t) => `${t.getName()}:${t.getSize()?.join('x')}:${(t.getImage().byteLength / 1024).toFixed(0)}K`);
  console.log(out, (statSync(out).size / 1048576).toFixed(2) + ' MB', tex.join(' '));
}
