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
  // Midnight and north are adjacent, even though their numeric values wrap.
  const hourDelta = ((to.hour - from.hour + 36) % 24) - 12;
  result.hour = (from.hour + hourDelta * t + 24) % 24;
  const fromAngle = Math.atan2(from.windZ, from.windX);
  const toAngle = Math.atan2(to.windZ, to.windX);
  const angleDelta = Math.atan2(Math.sin(toAngle - fromAngle), Math.cos(toAngle - fromAngle));
  result.windX = Math.cos(fromAngle + angleDelta * t);
  result.windZ = Math.sin(fromAngle + angleDelta * t);
  return result;
}
