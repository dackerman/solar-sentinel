import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SolarSentinelApp } from '../app.js';
import type { WeatherData } from '../types/weather.js';

const setupDOM = () => {
  document.body.innerHTML = `
    <div>
      <div id="loading"></div>
      <div id="current-conditions" class="hidden"></div>
      <div id="chart-container" class="hidden"></div>
      <div id="weather-chart-container" class="hidden"></div>
      <div id="legend" class="hidden"></div>
      <div id="error" class="hidden"></div>
      <div id="date-display"></div>
      <div id="location-display"></div>
      <span id="current-time">--:-- --</span>
      <button id="prev-day"></button>
      <button id="next-day"></button>
      <button id="debug-btn"></button>
      <div id="dual-display" class="hidden"></div>
      <div id="single-display" class="hidden"></div>
      <canvas id="uvChart"></canvas>
      <canvas id="weatherChart"></canvas>
    </div>`;
};

describe('Last updated display', () => {
  const today = new Date().toLocaleDateString('en-CA');
  const baseData: WeatherData = {
    labels: ['12:00 AM'],
    uv: [0],
    uvClearSky: [0],
    precipitation: [0],
    temperature: [60],
    apparentTemperature: [60],
    cloudCover: [0],
    humidity: [50],
    date: today,
  };

  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
  });

  it('renders formatted lastUpdated time when provided by API', async () => {
    const lastUpdatedIso = '2025-08-31T20:30:00.000Z';

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue({
        ...baseData,
        metadata: { cached: true, cacheAge: 0, lastUpdated: lastUpdatedIso },
      }),
    } as any);

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue({
        date: today,
        tempMax: 70,
        tempMin: 50,
        uvMax: 5,
        precipMax: 10,
        humidityMax: 70,
      }),
    } as any);

    const app = new SolarSentinelApp();

    const init = app.initialize();
    // Immediately resolve geolocation with error to skip waiting
    const geolib = vi.mocked(navigator.geolocation.getCurrentPosition);
    const errCb = geolib.mock.calls[0][1]!;
    errCb({ code: 1, message: 'Permission denied' } as GeolocationPositionError);
    await init;

    const text = (document.getElementById('current-time') as HTMLElement).textContent || '';
    expect(text).toMatch(/^Last updated: /);
  });
});
