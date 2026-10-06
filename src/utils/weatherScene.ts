import type { WeatherSceneState } from '../types/weatherScene.js';

export const clamp = (value: number, min = 0, max = 1): number =>
  Math.max(min, Math.min(max, value));

export function interpolateScene(
  from: WeatherSceneState,
  to: WeatherSceneState,
  fraction: number
): WeatherSceneState {
  const result = { ...from };
  const t = clamp(fraction);
  for (const key of Object.keys(result) as Array<keyof WeatherSceneState>) {
    result[key] = from[key] + (to[key] - from[key]) * t;
  }
  return result;
}
