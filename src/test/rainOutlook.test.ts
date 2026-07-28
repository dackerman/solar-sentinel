import { describe, it, expect } from 'vitest';
import { buildRainOutlook, formatHourLabel } from '../utils/rainOutlook.js';

const DATE = '2026-07-28';
const hours = (...hs: number[]) => hs.map(h => `${DATE}T${String(h).padStart(2, '0')}:00`);

describe('formatHourLabel', () => {
  it('formats hours in compact 12-hour style', () => {
    expect(formatHourLabel(0)).toBe('12 AM');
    expect(formatHourLabel(9)).toBe('9 AM');
    expect(formatHourLabel(12)).toBe('12 PM');
    expect(formatHourLabel(14)).toBe('2 PM');
    expect(formatHourLabel(23)).toBe('11 PM');
  });
});

describe('buildRainOutlook', () => {
  it('reports the first upcoming hour at or above 50%', () => {
    const result = buildRainOutlook(hours(10, 11, 14, 15), [10, 20, 72, 80], DATE, 10);
    expect(result).toEqual({ label: 'Rain likely ~2 PM', startsAt: '14:00', probability: 72 });
  });

  it('reports rain now when the current hour qualifies', () => {
    const result = buildRainOutlook(hours(10, 11), [65, 40], DATE, 10);
    expect(result).toEqual({ label: 'Rain now', startsAt: '10:00', probability: 65 });
  });

  it('ignores hours before the current hour', () => {
    const result = buildRainOutlook(hours(8, 9, 10), [90, 95, 20], DATE, 10);
    expect(result).toEqual({ label: 'No rain expected', probability: 20 });
  });

  it('ignores other dates entirely', () => {
    const times = ['2026-07-27T14:00', `${DATE}T14:00`, '2026-07-29T14:00'];
    const result = buildRainOutlook(times, [99, 30, 99], DATE, 0);
    expect(result).toEqual({ label: 'No rain expected', probability: 30 });
  });

  it('reports the remaining max probability when no hour qualifies', () => {
    const result = buildRainOutlook(hours(10, 12, 16), [5, 35, 15], DATE, 10);
    expect(result).toEqual({ label: 'No rain expected', probability: 35 });
  });

  it('handles empty and missing data', () => {
    expect(buildRainOutlook([], [], DATE, 10)).toEqual({
      label: 'No rain expected',
      probability: 0,
    });
    const result = buildRainOutlook(hours(10, 11), [Number.NaN, 20], DATE, 10);
    expect(result).toEqual({ label: 'No rain expected', probability: 20 });
  });
});
