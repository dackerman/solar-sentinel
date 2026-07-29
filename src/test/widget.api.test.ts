import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
// @ts-ignore - server.js doesn't have TypeScript declarations
import app from '../../server.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Freeze "now" at 14:30 UTC so the current hour in UTC-timezone mock data is 14.
const FAKE_NOW = '2026-07-28T14:30:00Z';
const TODAY = '2026-07-28';

function getMockForecast({ precip = [10, 20, 72, 80] } = {}) {
  return {
    timezone: 'UTC',
    hourly: {
      time: [`${TODAY}T10:00`, `${TODAY}T13:00`, `${TODAY}T14:00`, `${TODAY}T16:00`],
      uv_index: [3.0, 5.5, 6.2, 4.1],
      uv_index_clear_sky: [4.0, 7.0, 8.0, 6.0],
      precipitation_probability: precip,
      temperature_2m: [75.0, 82.3, 84.1, 83.0],
      apparent_temperature: [76.0, 85.2, 88.0, 86.1],
      cloud_cover: [10, 30, 40, 50],
      relative_humidity_2m: [50, 55, 60, 58],
      weather_code: [1, 2, 3, 3],
    },
    daily: {
      time: [TODAY],
      temperature_2m_max: [91.2],
      temperature_2m_min: [68.0],
      uv_index_max: [9.1],
      precipitation_probability_max: [80],
      relative_humidity_2m_max: [70],
      weather_code: [3],
    },
  };
}

function mockForecastResponse(data: unknown) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => data });
}

describe('GET /api/widget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FAKE_NOW));
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the render-ready day summary', async () => {
    mockForecastResponse(getMockForecast());
    const response = await request(app).get('/api/widget?lat=10.001&lon=10.001');

    expect(response.status).toBe(200);
    expect(response.body.date).toBe(TODAY);
    expect(response.body.tempNow).toBe(84.1);
    expect(response.body.feelsLike).toBe(88.0);
    expect(response.body.tempHigh).toBe(91.2);
    expect(response.body.tempLow).toBe(68.0);
    expect(response.body.uvNow).toBe(6.2);
    expect(response.body.uvMax).toBe(9.1);
    expect(response.body.weatherCode).toBe(3);
    expect(response.body.rain).toEqual({ label: 'Rain now', startsAt: '14:00', probability: 72 });
    expect(response.body.artUrl).toMatch(/\/weather-art\/v2\/day-.*\.webp$/);
    expect(typeof response.body.artLabel).toBe('string');
    expect(response.body.metadata.lastUpdated).toBeDefined();
    expect(response.body.hourly).toEqual({
      hours: [10, 13, 14, 16],
      temp: [75.0, 82.3, 84.1, 83.0],
      precipProb: [10, 20, 72, 80],
      cloudCover: [10, 30, 40, 50],
      uv: [3.0, 5.5, 6.2, 4.1],
    });
  });

  it('keeps hourly series aligned and excludes other dates', async () => {
    const forecast = getMockForecast();
    forecast.hourly.time = [...forecast.hourly.time, '2026-07-29T09:00'];
    forecast.hourly.uv_index = [...forecast.hourly.uv_index, 1.1];
    forecast.hourly.uv_index_clear_sky = [...forecast.hourly.uv_index_clear_sky, 2.0];
    forecast.hourly.precipitation_probability = [...forecast.hourly.precipitation_probability, 99];
    forecast.hourly.temperature_2m = [...forecast.hourly.temperature_2m, 60.0];
    forecast.hourly.apparent_temperature = [...forecast.hourly.apparent_temperature, 60.0];
    forecast.hourly.cloud_cover = [...forecast.hourly.cloud_cover, 90];
    forecast.hourly.relative_humidity_2m = [...forecast.hourly.relative_humidity_2m, 80];
    forecast.hourly.weather_code = [...forecast.hourly.weather_code, 61];
    mockForecastResponse(forecast);
    const response = await request(app).get('/api/widget?lat=14.005&lon=14.005');

    expect(response.status).toBe(200);
    expect(response.body.hourly.hours).toEqual([10, 13, 14, 16]);
    expect(response.body.hourly.precipProb).toEqual([10, 20, 72, 80]);
  });

  it('reports upcoming rain with a time label', async () => {
    mockForecastResponse(getMockForecast({ precip: [10, 20, 30, 65] }));
    const response = await request(app).get('/api/widget?lat=11.002&lon=11.002');

    expect(response.status).toBe(200);
    expect(response.body.rain).toEqual({
      label: 'Rain likely ~4 PM',
      startsAt: '16:00',
      probability: 65,
    });
  });

  it('reports no rain with the remaining max probability', async () => {
    mockForecastResponse(getMockForecast({ precip: [90, 20, 15, 35] }));
    const response = await request(app).get('/api/widget?lat=12.003&lon=12.003');

    expect(response.status).toBe(200);
    expect(response.body.rain).toEqual({ label: 'No rain expected', probability: 35 });
  });

  it('builds an absolute artUrl from forwarded headers', async () => {
    mockForecastResponse(getMockForecast());
    const response = await request(app)
      .get('/api/widget?lat=13.004&lon=13.004')
      .set('X-Forwarded-Proto', 'https')
      .set('X-Forwarded-Host', 'solar.example.com');

    expect(response.status).toBe(200);
    expect(response.body.artUrl).toMatch(/^https:\/\/solar\.example\.com\/weather-art\/v2\//);
  });

  it('rejects invalid coordinates', async () => {
    const response = await request(app).get('/api/widget?lat=999&lon=0');
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });
});
