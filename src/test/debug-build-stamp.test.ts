import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SolarSentinelApp } from '../app.js';
import { DebugPanel } from '../components/debug.js';
import type { WeatherData } from '../types/weather.js';

const setupDOM = () => {
  document.body.innerHTML = `
    <div>
      <div id="auth-banner" class="hidden"></div>
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

// Flush the fire-and-forget logServiceWorkerBuild() promise chain (two
// microtask-only awaits: navigator.serviceWorker.ready, then caches.keys()).
// A macrotask tick reliably drains any pending microtasks queued before it.
const flushMicrotasks = async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
};

describe('Service worker build stamp logging', () => {
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
    daily: { date: today, tempMax: 70, tempMin: 50, uvMax: 5, precipMax: 10, humidityMax: 70 },
    metadata: { cached: true, cacheAge: 0, lastUpdated: new Date().toISOString() },
  };

  const mkResponse = () => {
    const response = {
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(baseData),
      clone: vi.fn(),
    };
    response.clone.mockReturnValue(response);
    return response;
  };

  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation((_success, error) => {
      error?.({ code: 1, message: 'Permission denied' } as GeolocationPositionError);
    });
    vi.mocked(global.fetch).mockResolvedValue(mkResponse() as any);
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    Reflect.deleteProperty(window, 'caches');
    vi.restoreAllMocks();
  });

  it('logs the parsed build hash from the static cache name when installed', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({}), controller: {} },
      configurable: true,
    });
    Object.defineProperty(window, 'caches', {
      value: {
        keys: async () => [
          'solar-sentinel-api-v5f20a03150fa',
          'solar-sentinel-static-v5f20a03150fa',
        ],
      },
      configurable: true,
    });

    const logSpy = vi.spyOn(DebugPanel.prototype, 'log');

    const app = new SolarSentinelApp();
    await app.initialize();
    await flushMicrotasks();

    expect(logSpy).toHaveBeenCalledWith('Service worker build 5f20a03150fa', {
      controlled: true,
    });
  });

  it('logs unavailable when there is no serviceWorker on navigator', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');

    const logSpy = vi.spyOn(DebugPanel.prototype, 'log');

    const app = new SolarSentinelApp();
    await app.initialize();
    await flushMicrotasks();

    expect(logSpy).toHaveBeenCalledWith('Service worker: unavailable');
  });
});
