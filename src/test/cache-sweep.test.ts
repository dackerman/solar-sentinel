import { describe, it, expect, beforeEach } from 'vitest';
import { WeatherAPI } from '../services/api.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function entry(ageMs: number): string {
  return JSON.stringify({ data: { date: '2026-07-16' }, timestamp: Date.now() - ageMs });
}

describe('WeatherAPI.sweepExpiredCache', () => {
  let api: WeatherAPI;

  beforeEach(() => {
    localStorage.clear();
    api = new WeatherAPI();
  });

  it('removes expired weather and calendar entries, keeps fresh ones', () => {
    localStorage.setItem(
      'solar_sentinel_weather_42.80,-71.30,2026-07-15',
      entry(SIX_HOURS_MS + 1000)
    );
    localStorage.setItem(
      'solar_sentinel_calendar_39.74,-104.99,2026-07-10',
      entry(SIX_HOURS_MS + 1000)
    );
    localStorage.setItem('solar_sentinel_weather_42.80,-71.30,2026-07-16', entry(1000));

    const removed = api.sweepExpiredCache();

    expect(removed).toBe(2);
    expect(localStorage.getItem('solar_sentinel_weather_42.80,-71.30,2026-07-15')).toBeNull();
    expect(localStorage.getItem('solar_sentinel_calendar_39.74,-104.99,2026-07-10')).toBeNull();
    expect(localStorage.getItem('solar_sentinel_weather_42.80,-71.30,2026-07-16')).not.toBeNull();
  });

  it('removes malformed cache entries', () => {
    localStorage.setItem('solar_sentinel_weather_42.80,-71.30,2026-07-16', '{corrupt');
    expect(api.sweepExpiredCache()).toBe(1);
    expect(localStorage.getItem('solar_sentinel_weather_42.80,-71.30,2026-07-16')).toBeNull();
  });

  it('never touches non-cache keys', () => {
    localStorage.setItem('solar_sentinel_location', '{"lat":1}');
    localStorage.setItem('solar_sentinel_saved_locations', '[]');
    localStorage.setItem('solar_sentinel_selected_location', '{}');
    localStorage.setItem('unrelated', 'x');

    expect(api.sweepExpiredCache()).toBe(0);
    expect(localStorage.getItem('solar_sentinel_location')).toBe('{"lat":1}');
    expect(localStorage.getItem('solar_sentinel_saved_locations')).toBe('[]');
    expect(localStorage.getItem('solar_sentinel_selected_location')).toBe('{}');
    expect(localStorage.getItem('unrelated')).toBe('x');
  });
});
