// n8ao ships no type declarations; this is the slice of its API the room uses.
declare module 'n8ao' {
  import type { Scene, Camera, Color } from 'three';
  import { Pass } from 'postprocessing';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number; distanceFalloff: number; intensity: number; color: Color;
      halfRes: boolean; gammaCorrection: boolean; aoSamples: number; denoiseSamples: number; denoiseRadius: number;
      screenSpaceRadius: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
  }
}
