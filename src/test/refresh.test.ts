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
  const today = new Date().toLocaleDateString('en-CA');
  const mkData = (): WeatherData => ({
    labels: ['12:00 AM'],
    uv: [0],
    uvClearSky: [0],
    precipitation: [0],
    temperature: [60],
    apparentTemperature: [60],
    cloudCover: [0],
    humidity: [50],
    date: today,
    metadata: { cached: true, cacheAge: 0, lastUpdated: new Date().toISOString() },
  });

  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips refresh when a request is already in flight', async () => {
    // Initial load
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(mkData()),
    } as any);
    // Daily
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue({ date: today, tempMax: 70, tempMin: 50, uvMax: 5, precipMax: 10, humidityMax: 70 }),
    } as any);

    const app = new SolarSentinelApp();
    const initPromise = app.initialize();
    // End geolocation immediately so initialize can proceed
    const errCb = vi.mocked(navigator.geolocation.getCurrentPosition).mock.calls[0][1]!;
    errCb({ code: 1, message: 'Permission denied' } as GeolocationPositionError);

    // Trigger the interval while load is in-flight
    vi.advanceTimersByTime(30 * 60 * 1000);

    await initPromise;

    // No extra fetch during in-flight; still only 2 calls
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
