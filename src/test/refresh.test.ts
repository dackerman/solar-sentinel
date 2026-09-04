import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SolarSentinelApp } from '../app.js';
import type { WeatherData } from '../types/weather.js';

// happy-dom aliases PageTransitionEvent to plain Event, so its constructor
// silently drops the `persisted` init option — force it onto the resulting
// event instead of relying on the constructor to honor it.
const makePageShowEvent = (persisted: boolean): Event => {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: persisted, configurable: true });
  return event;
};

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

  const mkResponse = (data = mkData()) => {
    const response = {
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(data),
      clone: vi.fn(),
    };
    response.clone.mockReturnValue(response);
    return response;
  };

  const mockWeatherFetch = () => {
    vi.mocked(global.fetch).mockImplementation(async input => {
      const url = new URL(input.toString(), 'http://localhost');
      const date = url.searchParams.get('date') || new Date().toLocaleDateString('en-CA');

      return mkResponse(mkData(date)) as any;
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
    // A couple of tests below replace the shared Chart.js mock's
    // implementation (e.g. to hand out specific chart instances); restore the
    // default here so that doesn't leak into later tests that create charts.
    vi.mocked((global as any).Chart).mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
    }));
  });

  it('skips refresh when a request is already in flight', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mkResponse() as any);

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

    // Once the hung request settles, the skipped refresh runs exactly once as
    // a queued follow-up — so a resume during a stuck request isn't lost.
    resolveRefresh(mkResponse());
    await vi.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(3);
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

  it('refreshes from the backend when the document becomes visible again', async () => {
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not refresh when visibilitychange fires while the document is hidden', async () => {
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes from the backend on a bfcache pageshow restore', async () => {
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();

    window.dispatchEvent(makePageShowEvent(true));

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not refresh on pageshow when not restored from bfcache', async () => {
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();

    window.dispatchEvent(makePageShowEvent(false));

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes across a midnight rollover when resumed via visibilitychange without timers firing', async () => {
    vi.setSystemTime(new Date(2026, 4, 1, 23, 59, 0));
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();

    // Jump the perceived clock past midnight without any scheduled timer
    // (the 5-minute refresh interval) ever firing.
    vi.setSystemTime(new Date(2026, 4, 2, 7, 0, 0));

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    const refreshUrl = new URL(
      vi.mocked(global.fetch).mock.calls[1][0].toString(),
      'http://localhost'
    );
    expect(refreshUrl.searchParams.get('date')).toBeNull();

    const expectedLabel = new Date(2026, 4, 2).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    expect(document.getElementById('date-display')?.textContent).toBe(expectedLabel);
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

    // Following today (the default, no explicit navigation happened), the
    // refresh omits date= entirely and lets the server resolve "today" —
    // rollover is still reflected in the rendered date via the response.
    expect(refreshUrl.searchParams.get('date')).toBeNull();
    const expectedLabel = new Date(2026, 4, 2).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    expect(document.getElementById('date-display')?.textContent).toBe(expectedLabel);
  });

  it('updates the chart now line every minute without fetching', async () => {
    const chartInstances = [
      { destroy: vi.fn(), update: vi.fn() },
      { destroy: vi.fn(), update: vi.fn() },
    ];
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn().mockReturnValue({}),
    });
    vi.mocked((global as any).Chart).mockImplementation(() => chartInstances.shift());
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    expect(global.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(chartInstances).toHaveLength(0);
    expect(vi.mocked((global as any).Chart).mock.results[0].value.update).toHaveBeenCalledWith(
      'none'
    );
    expect(vi.mocked((global as any).Chart).mock.results[1].value.update).toHaveBeenCalledWith(
      'none'
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes from the backend when the browser reports coming back online', async () => {
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();

    window.dispatchEvent(new Event('online'));

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries once ~5s after a resume refresh fails, then renders the retry data', async () => {
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Retry data resolves to a later "last updated" time than the initial load.
    vi.setSystemTime(new Date(Date.now() + 60 * 1000));
    mockWeatherFetch();

    await vi.advanceTimersByTimeAsync(5000);

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(document.getElementById('current-time')?.textContent).toMatch(/Last updated:/);
  });

  it('does not chain retries when the retry itself fails', async () => {
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    // No further retry scheduled after the retry itself failed.
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry a failed timer-triggered refresh', async () => {
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // No retry ~5s later, and no additional attempt before the next timer tick.
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('marks the last-updated stamp stale after 30 minutes with no successful refresh', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn().mockReturnValue({}),
    });
    vi.mocked((global as any).Chart).mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
    }));
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    const stamp = document.getElementById('current-time') as HTMLElement;
    expect(stamp.classList.contains('text-amber-600')).toBe(false);

    // Jump the perceived clock forward without firing any scheduled timers,
    // then advance by exactly one now-line tick (not the 5-minute refresh
    // interval) so staleness is detected without a new fetch succeeding.
    vi.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(stamp.classList.contains('text-amber-600')).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Session expiry', () => {
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

  const mkResponse = (data = mkData()) => {
    const response = {
      ok: true,
      type: 'basic',
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(data),
      clone: vi.fn(),
    };
    response.clone.mockReturnValue(response);
    return response;
  };

  const opaqueRedirectResponse = () => ({
    type: 'opaqueredirect',
    clone: vi.fn(),
  });

  const mockWeatherFetch = () => {
    vi.mocked(global.fetch).mockImplementation(async input => {
      const url = new URL(input.toString(), 'http://localhost');
      const date = url.searchParams.get('date') || new Date().toLocaleDateString('en-CA');

      return mkResponse(mkData(date)) as any;
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

  it('shows the auth banner when a load hits an expired session after local cache already painted', async () => {
    // Prime localStorage with a real cached weather entry the same way a
    // prior successful load would, so the next load renders from cache
    // before its own network request fails.
    mockWeatherFetch();
    const primer = new SolarSentinelApp();
    await primer.initialize();

    setupDOM();
    vi.mocked(global.fetch).mockResolvedValueOnce(opaqueRedirectResponse() as any);

    const app = new SolarSentinelApp();
    await app.initialize();

    expect(document.getElementById('auth-banner')?.classList.contains('hidden')).toBe(false);
  });

  it('hides the auth banner again after a subsequent successful refresh', async () => {
    mockWeatherFetch();

    const app = new SolarSentinelApp();
    await app.initialize();

    vi.mocked(global.fetch).mockResolvedValueOnce(opaqueRedirectResponse() as any);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(document.getElementById('auth-banner')?.classList.contains('hidden')).toBe(false);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(document.getElementById('auth-banner')?.classList.contains('hidden')).toBe(true);
  });
});
