import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

/**
 * The look: soft contact shadows (N8AO ambient occlusion), a gentle bloom that only the
 * brightest things reach (flames, bulbs, the lanterns, the lit TV), AgX tone mapping and a
 * whisper of vignette. Desktop renders with 4x MSAA in the composer; phones use SMAA and
 * half-resolution AO instead, which costs far less fill.
 */

export interface Post {
  composer: EffectComposer;
  ao: N8AOPostPass | null;
  bloom: BloomEffect;
  setSize(w: number, h: number): void;
  render(dt: number): void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: { mobile: boolean; ao: boolean }): Post {
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: opts.mobile ? 0 : Math.min(4, renderer.capabilities.maxSamples),
  });
  composer.addPass(new RenderPass(scene, camera));
  let ao: N8AOPostPass | null = null;
  if (opts.ao) {
    ao = new N8AOPostPass(scene, camera, 1, 1);
    ao.configuration.aoRadius = 0.55;
    ao.configuration.distanceFalloff = 0.4;
    ao.configuration.intensity = 2.2;
    ao.configuration.color = new THREE.Color('#2a1810');
    ao.configuration.halfRes = opts.mobile;
    ao.configuration.gammaCorrection = false;
    ao.setQualityMode(opts.mobile ? 'Low' : 'Medium');
    composer.addPass(ao);
  }
  const bloom = new BloomEffect({ intensity: 0.85, luminanceThreshold: 0.82, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
  const effects = opts.mobile ? [bloom, tone, vignette, new SMAAEffect()] : [bloom, tone, vignette];
  composer.addPass(new EffectPass(camera, ...effects));
  return {
    composer, ao, bloom,
    setSize: (w, h) => composer.setSize(w, h),
    render: (dt) => composer.render(dt),
  };
}
