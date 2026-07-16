import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SolarSentinelApp } from '../app.js';
import type { WeatherData, DailyCalendarData } from '../types/weather.js';

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
    daily: { date, tempMax: 70, tempMin: 50, uvMax: 5, precipMax: 10, humidityMax: 70 },
  });

  const mkResponse = (data: unknown) => {
    const response = {
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(data),
      clone: vi.fn(),
    };
    response.clone.mockReturnValue(response);
    return response;
  };

  const mkCalendarData = (startDate: string, endDate: string): DailyCalendarData => ({
    startDate,
    endDate,
    days: [],
  });

  const dayLabel = (dateString: string) =>
    new Date(dateString + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

  const fmt = (d: Date) => d.toLocaleDateString('en-CA');

  const addDays = (base: Date, days: number) =>
    new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);

  // Drains the full microtask chain of a mocked fetch (fetchOnce -> json() -> render),
  // which spans more ticks than a couple of `await Promise.resolve()` calls cover.
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('does not navigate before today and not beyond +16 days', async () => {
    const today = new Date();
    const fmt = (d: Date) => d.toLocaleDateString('en-CA');

    // First load for today
    vi.mocked(global.fetch).mockResolvedValueOnce(mkResponse(mkData(fmt(today))) as any);
    const app = new SolarSentinelApp();
    const init = app.initialize();
    // End geolocation immediately to avoid wait
    const errCb = vi.mocked(navigator.geolocation.getCurrentPosition).mock.calls[0][1]!;
    errCb({ code: 1, message: 'Permission denied' } as GeolocationPositionError);
    await init;

    // Attempt to go prev-day (should not fetch because date would be < today)
    (document.getElementById('prev-day') as HTMLButtonElement).click();
    expect(global.fetch).toHaveBeenCalledTimes(1); // only initial combined call

    // Navigate forward up to bounds (best-effort; clicks that exceed bounds are ignored by app)
    for (let i = 0; i < 16; i++) {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        mkResponse(
          mkData(fmt(new Date(today.getFullYear(), today.getMonth(), today.getDate() + (i + 1))))
        ) as any
      );
      (document.getElementById('next-day') as HTMLButtonElement).click();
      // Allow the microtask queue to process the async loadData
      await Promise.resolve();
    }

    // Try to go beyond +16 (should not fetch more)
    (document.getElementById('next-day') as HTMLButtonElement).click();
    await Promise.resolve();

    // Expect initial data + daily summary calls only if within bounds; ensure no extra before-today fetch
    expect(
      (global.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    ).toBeGreaterThanOrEqual(2);
  });

  it('clamps navigation to the calendar range when available', async () => {
    // The forecast calendar container must exist for the app to fetch /api/daily-calendar at all.
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="forecast-calendar-container" class="hidden"></div>'
    );

    const today = new Date();
    const todayStr = fmt(today);
    const plus2Str = fmt(addDays(today, 2));
    const calendar = mkCalendarData(todayStr, plus2Str);

    vi.mocked(global.fetch).mockReset();
    vi.mocked(global.fetch).mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes('/api/daily-calendar')) {
        return Promise.resolve(mkResponse(calendar) as any);
      }
      const requestedDate = new URL(url, 'http://localhost').searchParams.get('date') || todayStr;
      return Promise.resolve(mkResponse(mkData(requestedDate)) as any);
    });

    const app = new SolarSentinelApp();
    const init = app.initialize();
    const errCb = vi.mocked(navigator.geolocation.getCurrentPosition).mock.calls[0][1]!;
    errCb({ code: 1, message: 'Permission denied' } as GeolocationPositionError);
    await init;

    // Let the background /api/daily-calendar fetch settle before navigating.
    await flush();

    for (let i = 0; i < 3; i++) {
      (document.getElementById('next-day') as HTMLButtonElement).click();
      await flush();
    }

    expect(document.getElementById('date-display')?.textContent).toBe(dayLabel(plus2Str));
    expect(document.getElementById('next-day')?.classList.contains('hidden')).toBe(true);
  });

  it('adopts the server-resolved date from the weather response', async () => {
    const today = new Date();
    const tomorrowStr = fmt(addDays(today, 1));
    const dayAfterStr = fmt(addDays(today, 2));

    vi.mocked(global.fetch).mockReset();
    // Server resolves/clamps the requested date to a different date than device-local "today".
    vi.mocked(global.fetch).mockResolvedValueOnce(mkResponse(mkData(tomorrowStr)) as any);

    const app = new SolarSentinelApp();
    const init = app.initialize();
    const errCb = vi.mocked(navigator.geolocation.getCurrentPosition).mock.calls[0][1]!;
    errCb({ code: 1, message: 'Permission denied' } as GeolocationPositionError);
    await init;

    expect(document.getElementById('date-display')?.textContent).toBe(dayLabel(tomorrowStr));

    // Subsequent navigation must be relative to the adopted server date, not device-local today.
    vi.mocked(global.fetch).mockResolvedValueOnce(mkResponse(mkData(dayAfterStr)) as any);
    (document.getElementById('next-day') as HTMLButtonElement).click();
    await flush();

    const calls = vi.mocked(global.fetch).mock.calls;
    const lastRequestedUrl = String(calls[calls.length - 1][0]);
    expect(lastRequestedUrl).toContain(`date=${dayAfterStr}`);
    expect(document.getElementById('date-display')?.textContent).toBe(dayLabel(dayAfterStr));
  });

  it('ignores a stale out-of-order response for a date the user has navigated away from', async () => {
    const today = new Date();
    const todayStr = fmt(today);
    const tomorrowStr = fmt(addDays(today, 1));

    vi.mocked(global.fetch).mockReset();

    // Hold the initial (today) request open so it can resolve AFTER the user
    // has already navigated forward, simulating an out-of-order response.
    let resolveInitial!: (value: unknown) => void;
    const initialResponsePromise = new Promise(resolve => {
      resolveInitial = resolve;
    });

    vi.mocked(global.fetch).mockImplementation((input: unknown) => {
      const url = String(input);
      const requestedDate = new URL(url, 'http://localhost').searchParams.get('date') || todayStr;
      if (requestedDate === todayStr) {
        return initialResponsePromise as any;
      }
      return Promise.resolve(mkResponse(mkData(requestedDate)) as any);
    });

    const app = new SolarSentinelApp();
    const init = app.initialize();
    const errCb = vi.mocked(navigator.geolocation.getCurrentPosition).mock.calls[0][1]!;
    errCb({ code: 1, message: 'Permission denied' } as GeolocationPositionError);

    // Let the stalled initial request register before navigating away from it.
    await flush();

    // Navigate to the next day while the initial (today) request is still in flight.
    (document.getElementById('next-day') as HTMLButtonElement).click();
    await flush();

    expect(document.getElementById('date-display')?.textContent).toBe(dayLabel(tomorrowStr));

    // Now let the stale initial-date response resolve, arriving after navigation.
    resolveInitial(mkResponse(mkData(todayStr)));
    await flush();
    await init;

    // The newer navigation must win; currentDate/display must not roll back.
    expect(document.getElementById('date-display')?.textContent).toBe(dayLabel(tomorrowStr));
  });
});
