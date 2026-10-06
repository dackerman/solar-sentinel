import { describe, expect, it } from 'vitest';
import type { Location, WeatherData } from '../types/weather.js';
import {
  defaultForecastIndex,
  forecastHour,
  forecastScene,
  locationClock,
} from '../utils/forecastScene.js';
import { interpolateScene } from '../utils/weatherScene.js';

const home: Location = { lat: 42.8006, lon: -71.3048, name: 'Windham, NH', isUserLocation: false };
const forecast = (overrides: Partial<WeatherData> = {}): WeatherData => ({
  date: '2026-10-06',
  timezone: 'America/New_York',
  utcOffsetSeconds: -14400,
  labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
  timestamps: Array.from({ length: 24 }, (_, i) => `2026-10-06T${String(i).padStart(2, '0')}:00`),
  temperature: Array(24).fill(58),
  apparentTemperature: Array(24).fill(54),
  precipitation: Array(24).fill(90),
  cloudCover: Array(24).fill(50),
  humidity: Array(24).fill(80),
  uv: Array(24).fill(3),
  uvClearSky: Array(24).fill(4),
  weatherCode: Array(24).fill(2),
  windSpeed: Array(24).fill(12),
  windGusts: Array(24).fill(23),
  windDirection: Array(24).fill(0),
  daily: {
    date: '2026-10-06',
    tempMax: 63,
    tempMin: 40,
    uvMax: 4.5,
    precipMax: 95,
    humidityMax: 90,
    weatherCode: 63,
    windMax: 18,
    gustMax: 30,
    windDirection: 90,
  },
  ...overrides,
});

describe('forecast scene adaptation', () => {
  it('starts at the selected location current hour, including a different date from the device', () => {
    const data = forecast({ date: '2026-10-07', timezone: 'Asia/Tokyo' });
    const now = new Date('2026-10-06T18:30:00Z');
    expect(locationClock(data, home, now)).toMatchObject({
      date: '2026-10-07',
      hour: 3.5,
      offset: 9,
    });
    expect(defaultForecastIndex(data, home, now)).toBe(3);
    expect(defaultForecastIndex(forecast({ date: '2026-10-09' }), home, now)).toBe(12);
  });

  it('preserves hour semantics in old 12-hour labels', () => {
    const data = forecast({ timestamps: undefined, labels: ['12:00 AM', '1:00 PM', '11:30 PM'] });
    expect(data.labels.map((_, i) => forecastHour(data, i))).toEqual([0, 13, 23.5]);
  });

  it('uses weather code intensity rather than mistaking probability for amount', () => {
    const data = forecast();
    expect(forecastScene(data, home, 12)).toMatchObject({
      chance: 0.9,
      rain: 0,
      snow: 0,
      snowCover: 0,
      fog: 0,
    });
    data.weatherCode![12] = 65;
    expect(forecastScene(data, home, 12).rain).toBe(1);
    data.temperature[12] = 20;
    data.weatherCode![12] = 0;
    expect(forecastScene(data, home, 12)).toMatchObject({ snow: 0, snowCover: 0 });
    data.weatherCode![12] = 73;
    expect(forecastScene(data, home, 12)).toMatchObject({ snow: 0.5, rain: 0, snowCover: 0 });
  });

  it('samples every weather quantity at the scrubbed hour and revisits it deterministically', () => {
    const data = forecast();
    data.temperature[23] = 39;
    data.apparentTemperature[23] = 30;
    data.windSpeed![23] = 20;
    data.windGusts![23] = 34;
    data.windDirection![23] = 90;
    data.cloudCover[23] = 100;
    data.humidity[23] = 92;
    data.weatherCode![23] = 45;
    const morning = forecastScene(data, home, 9);
    expect(forecastScene(data, home, 23)).toMatchObject({
      temperature: 39,
      feelsLike: 30,
      wind: 20,
      gust: 34,
      cloud: 1,
      humidity: 0.92,
      fog: 0.65,
      daylight: 0,
    });
    expect(forecastScene(data, home, 23).windX).toBeCloseTo(-1);
    expect(forecastScene(data, home, 9)).toEqual(morning);
    expect(morning.daylight).toBe(1);
  });

  it('distinguishes daily summaries and handles old data without wind or weather codes', () => {
    const data = forecast();
    expect(forecastScene(data, home, 0, true)).toMatchObject({
      temperature: 63,
      wind: 18,
      gust: 30,
      chance: 0.95,
      humidity: 0.9,
      rain: 0.6,
      hour: 12,
    });
    const old = forecast({
      timezone: undefined,
      utcOffsetSeconds: undefined,
      weatherCode: undefined,
      windSpeed: undefined,
      windGusts: undefined,
      windDirection: undefined,
    });
    expect(Object.values(forecastScene(old, home, 0)).every(Number.isFinite)).toBe(true);
    expect(forecastScene(old, home, 0)).toMatchObject({ wind: 0, gust: 0, rain: 0, snow: 0 });
  });

  it('resolves polar night and daylight saving time at the selected date', () => {
    const polar: Location = { ...home, lat: 78.22, lon: 15.65 };
    const winter = forecast({ date: '2026-12-21', timezone: 'Arctic/Longyearbyen' });
    expect(forecastScene(winter, polar, 12).daylight).toBe(0);
    const spring = forecast({ date: '2026-03-08' });
    expect(locationClock(spring, home, new Date('2026-03-08T06:30:00Z')).hour).toBe(1.5);
    expect(locationClock(spring, home, new Date('2026-03-08T07:30:00Z')).hour).toBe(3.5);
  });

  it('takes the short path through midnight and changing wind directions', () => {
    const from = {
      ...forecastScene(forecast(), home, 23),
      windX: Math.cos(-0.1),
      windZ: Math.sin(-0.1),
    };
    const to = { ...from, hour: 0, windX: Math.cos(0.1), windZ: Math.sin(0.1) };
    const midpoint = interpolateScene(from, to, 0.5);
    expect(midpoint.hour).toBe(23.5);
    expect(midpoint.windX).toBeCloseTo(1);
    expect(midpoint.windZ).toBeCloseTo(0);
    const retarget = { ...to, temperature: 20 };
    expect(interpolateScene(midpoint, retarget, 0)).toEqual(midpoint);
  });
});
