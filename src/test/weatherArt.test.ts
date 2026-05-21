import { describe, expect, it } from 'vitest';
import { getWeatherArt, getWeatherArtTempBand } from '../utils/weatherArt.js';

describe('weather art classification', () => {
  it('bins temperatures into broad feeling ranges', () => {
    expect(getWeatherArtTempBand(32)).toBe('freezing');
    expect(getWeatherArtTempBand(44)).toBe('cold');
    expect(getWeatherArtTempBand(59)).toBe('cool');
    expect(getWeatherArtTempBand(72)).toBe('mild');
    expect(getWeatherArtTempBand(84)).toBe('warm');
    expect(getWeatherArtTempBand(85)).toBe('hot');
  });

  it('keeps hot humid high-UV sun distinct from comfortable warm sun', () => {
    expect(
      getWeatherArt({
        tempF: 88,
        uv: 8,
        precipChance: 5,
        humidity: 78,
        cloudCover: 10,
        daypart: 'day',
      }).key
    ).toBe('day-hot-humid-clear-high-uv');

    expect(
      getWeatherArt({
        tempF: 78,
        uv: 4,
        precipChance: 5,
        humidity: 50,
        cloudCover: 10,
        daypart: 'day',
      }).key
    ).toBe('day-warm-comfortable-clear-moderate-uv');
  });

  it('uses active weather codes ahead of precipitation probability vibes', () => {
    expect(
      getWeatherArt({
        tempF: 82,
        uv: 3,
        precipChance: 30,
        humidity: 84,
        cloudCover: 90,
        weatherCode: 95,
        daypart: 'day',
      }).key
    ).toBe('day-warm-storm');

    expect(
      getWeatherArt({
        tempF: 38,
        uv: 0,
        precipChance: 70,
        humidity: 90,
        cloudCover: 95,
        weatherCode: 73,
        daypart: 'night',
      }).key
    ).toBe('night-cold-wintry-mix');
  });
});
