import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
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

describe('Chart canvas context loss', () => {
  const today = new Date().toLocaleDateString('en-CA');
  const data: WeatherData = {
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

  let frameQueue: FrameRequestCallback[];
  let logSpy: MockInstance<Parameters<DebugPanel['log']>, void>;
  let contextLost: boolean;

  const chartConstructor = () => vi.mocked((global as any).Chart);
  const renderCompleteCalls = () =>
    logSpy.mock.calls.filter(call => call[0] === 'Perf: charts-render-complete');
  const loggedMessages = () => logSpy.mock.calls.map(call => call[0]);

  const flushFrames = async () => {
    const pending = frameQueue.splice(0);
    pending.forEach(callback => callback(performance.now()));
    // Let the redraw's awaited chart creation settle.
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  };

  const mockWeatherResponse = () => {
    const response = {
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(data),
      clone: vi.fn(),
    };
    response.clone.mockReturnValue(response);
    vi.mocked(global.fetch).mockImplementation((async (input: any) =>
      input.toString().includes('/api/client-log')
        ? { ok: true, json: async () => ({ accepted: 0, received: 0 }) }
        : response) as any);
  };

  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    contextLost = false;
    frameQueue = [];
    logSpy = vi.spyOn(DebugPanel.prototype, 'log');
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frameQueue.push(callback);
      return frameQueue.length;
    });
    Object.defineProperty(navigator, 'sendBeacon', {
      value: vi.fn(() => true),
      configurable: true,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({ isContextLost: () => contextLost })),
    });
    chartConstructor().mockImplementation(() => ({ destroy: vi.fn(), update: vi.fn() }));
    vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation((_success, error) => {
      error?.({ code: 1, message: 'Permission denied' } as GeolocationPositionError);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as any).sendBeacon;
  });

  const startRenderedApp = async () => {
    mockWeatherResponse();
    const app = new SolarSentinelApp();
    await app.initialize();
    await vi.waitFor(() => expect(renderCompleteCalls()).toHaveLength(1));
    return app;
  };

  it('redraws the charts exactly once when both canvases restore back-to-back', async () => {
    await startRenderedApp();
    const chartsBefore = chartConstructor().mock.calls.length;
    expect(chartsBefore).toBe(2);

    document.getElementById('uvChart')!.dispatchEvent(new Event('contextrestored'));
    document.getElementById('weatherChart')!.dispatchEvent(new Event('contextrestored'));
    await flushFrames();

    await vi.waitFor(() => expect(renderCompleteCalls()).toHaveLength(2));
    expect(chartConstructor().mock.calls.length).toBe(chartsBefore + 2);
    expect(loggedMessages().filter(m => m === 'Chart canvas context restored')).toHaveLength(2);
    expect(logSpy).toHaveBeenCalledWith('Chart canvas context restored', { canvas: 'uvChart' });
    expect(logSpy).toHaveBeenCalledWith('Chart canvas context restored', {
      canvas: 'weatherChart',
    });
  });

  it('does nothing when a context is restored before any chart has rendered', async () => {
    // A fetch that never settles keeps the app from rendering anything.
    vi.mocked(global.fetch).mockImplementation((() => new Promise(() => {})) as any);
    const app = new SolarSentinelApp();
    void app.initialize();

    expect(() => {
      document.getElementById('uvChart')!.dispatchEvent(new Event('contextrestored'));
      document.getElementById('weatherChart')!.dispatchEvent(new Event('contextrestored'));
    }).not.toThrow();
    await flushFrames();

    expect(chartConstructor()).not.toHaveBeenCalled();
    expect(renderCompleteCalls()).toHaveLength(0);
  });

  it('logs when a canvas context is lost and does not cancel the browser restore', async () => {
    await startRenderedApp();
    const event = new Event('contextlost', { cancelable: true });

    document.getElementById('weatherChart')!.dispatchEvent(event);

    expect(logSpy).toHaveBeenCalledWith('Chart canvas context lost', { canvas: 'weatherChart' });
    expect(event.defaultPrevented).toBe(false);
  });

  it('reports contextLost: false on the render-complete mark when contexts are healthy', async () => {
    await startRenderedApp();

    expect(renderCompleteCalls()[0][1]).toMatchObject({ contextLost: false });
  });

  it('reports contextLost: true when a chart canvas context is lost during render', async () => {
    contextLost = true;
    await startRenderedApp();

    expect(renderCompleteCalls()[0][1]).toMatchObject({ contextLost: true });
  });

  it('reports contextLost: false when isContextLost is unavailable', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation((() => ({})) as any);
    await startRenderedApp();

    expect(renderCompleteCalls()[0][1]).toMatchObject({ contextLost: false });
  });
});
