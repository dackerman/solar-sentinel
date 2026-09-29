const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** 8-point compass label for a meteorological "from" direction in degrees. */
export function degreesToCardinal(deg: number | null | undefined): string | null {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return null;
  const normalized = ((deg % 360) + 360) % 360;
  return CARDINALS[Math.round(normalized / 45) % 8];
}

function isNum(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True when gusts exceed sustained wind by at least 5 mph (rounded values). */
export function hasNotableGust(
  speed: number | null | undefined,
  gust: number | null | undefined
): boolean {
  return isNum(speed) && isNum(gust) && Math.round(gust) >= Math.round(speed) + 5;
}

/** "8 mph NW", or "--" when the speed is missing. Direction omitted if unknown. */
export function formatWind(
  speed: number | null | undefined,
  direction: number | null | undefined
): string {
  if (!isNum(speed)) return '--';
  const cardinal = degreesToCardinal(direction);
  return `${Math.round(speed)} mph${cardinal ? ` ${cardinal}` : ''}`;
}

/** Rounded gust value when it is notably above sustained wind, else null. */
export function formatGustSuffix(
  speed: number | null | undefined,
  gust: number | null | undefined
): string | null {
  return hasNotableGust(speed, gust) ? `gust ${Math.round(gust as number)}` : null;
}

/** True if any value in the array is a finite number. */
export function hasWindData(values: Array<number | null | undefined> | undefined): boolean {
  return Array.isArray(values) && values.some(isNum);
}

/** "8 mph", or "--" when the speed is missing. */
export function formatWindSpeed(speed: number | null | undefined): string {
  return isNum(speed) ? `${Math.round(speed)} mph` : '--';
}
