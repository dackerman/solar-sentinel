import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('Auto-refresh behavior', () => {
  const mkData = (date = new Date().toLocaleDateString('en-CA')): WeatherData => ({
    labels: ['12:00 AM'],
    uv: [0],
    uvClearSky: [0],
    precipitation: [0],
    temperature: [60],
    apparentTemperature: [60],
    cloudCover: [0],
    humidity: [50],
    date,
    daily: { date, tempMax: 70, tempMin: 50, uvMax: 5, precipMax: 10, humidityMax: 70 },
    metadata: { cached: true, cacheAge: 0, lastUpdated: new Date().toISOString() },
  });

  const mockWeatherFetch = () => {
    vi.mocked(global.fetch).mockImplementation(async input => {
      const url = new URL(input.toString(), 'http://localhost');
      const date = url.searchParams.get('date') || new Date().toLocaleDateString('en-CA');

      return {
        ok: true,
        headers: { get: vi.fn().mockReturnValue('hit') },
        json: vi.fn().mockResolvedValue(mkData(date)),
      } as any;
    });
  };

  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation((_success, error) => {
      error?.({ code: 1, message: 'Permission denied' } as GeolocationPositionError);
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips refresh when a request is already in flight', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(mkData()),
    } as any);

    let resolveRefresh!: (value: any) => void;
    vi.mocked(global.fetch).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRefresh = resolve;
        })
    );

    const app = new SolarSentinelApp();
    await app.initialize();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(global.fetch).toHaveBeenCalledTimes(2);

    resolveRefresh({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(mkData()),
    });
    await Promise.resolve();
  });

  it('refreshes every five minutes while the page stays open', async () => {
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();

    expect(global.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes from the backend when the window regains focus', async () => {
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();

    window.dispatchEvent(new Event('focus'));

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('rolls over to the new day before an auto-refresh after midnight', async () => {
    vi.setSystemTime(new Date(2026, 4, 1, 23, 59, 0));
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const refreshUrl = new URL(
      vi.mocked(global.fetch).mock.calls[1][0].toString(),
      'http://localhost'
    );

    expect(refreshUrl.searchParams.get('date')).toBe('2026-05-02');
  });
});
