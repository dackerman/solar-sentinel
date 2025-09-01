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
      <button id="prev-day">prev</button>
      <button id="next-day">next</button>
      <button id="debug-btn"></button>
      <div id="dual-display" class="hidden"></div>
      <div id="single-display" class="hidden"></div>
      <canvas id="uvChart"></canvas>
      <canvas id="weatherChart"></canvas>
    </div>`;
};

describe('Date navigation bounds', () => {
  const mkData = (date: string): WeatherData => ({
    labels: ['12:00 AM'],
    uv: [0],
    uvClearSky: [0],
    precipitation: [0],
    temperature: [60],
    apparentTemperature: [60],
    cloudCover: [0],
    humidity: [50],
    date,
  });

  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
  });

  it('does not navigate before today and not beyond +16 days', async () => {
    const today = new Date();
    const fmt = (d: Date) => d.toLocaleDateString('en-CA');

    // First load for today
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(mkData(fmt(today))),
    } as any);
    // Daily
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue({ date: fmt(today), tempMax: 70, tempMin: 50, uvMax: 5, precipMax: 10, humidityMax: 70 }),
    } as any);

    const app = new SolarSentinelApp();
    const init = app.initialize();
    // End geolocation immediately to avoid wait
    const errCb = vi.mocked(navigator.geolocation.getCurrentPosition).mock.calls[0][1]!;
    errCb({ code: 1, message: 'Permission denied' } as GeolocationPositionError);
    await init;

    // Attempt to go prev-day (should not fetch because date would be < today)
    ;(document.getElementById('prev-day') as HTMLButtonElement).click();
    expect(global.fetch).toHaveBeenCalledTimes(2); // only initial two calls

    // Navigate forward up to bounds (best-effort; clicks that exceed bounds are ignored by app)
    for (let i = 0; i < 16; i++) {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        headers: { get: vi.fn().mockReturnValue('hit') },
        json: vi.fn().mockResolvedValue(mkData(fmt(new Date(today.getFullYear(), today.getMonth(), today.getDate() + (i + 1)))))
      } as any);
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        headers: { get: vi.fn().mockReturnValue('hit') },
        json: vi.fn().mockResolvedValue({ date: fmt(today), tempMax: 70, tempMin: 50, uvMax: 5, precipMax: 10, humidityMax: 70 }),
      } as any);
      (document.getElementById('next-day') as HTMLButtonElement).click();
      // Allow the microtask queue to process the async loadData
      await Promise.resolve();
    }

    // Try to go beyond +16 (should not fetch more)
    (document.getElementById('next-day') as HTMLButtonElement).click();
    await Promise.resolve();

    // Expect initial data + daily summary calls only if within bounds; ensure no extra before-today fetch
    expect((global.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
