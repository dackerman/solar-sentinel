import type { WeatherSceneView } from '../types/weatherScene.js';

interface CameraPreset {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

// User supplied views are preserved exactly; orientation is derived from target.
export const cameraPresets: Record<WeatherSceneView, CameraPreset> = {
  original: {
    position: [-1.597796, 0.666399, 9.001909],
    target: [0, 2.45, -3],
    fov: 38,
  },
  layout: {
    position: [5.217332, 8.383457, 16.776811],
    target: [0, 2.45, -3],
    fov: 38,
  },
  reference: {
    position: [-1.4, 7.8, 9.8],
    target: [2.4, 1.5, -13],
    fov: 44,
  },
};
