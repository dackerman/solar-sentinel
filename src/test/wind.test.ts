import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  degreesToCardinal,
  formatGustSuffix,
  formatWind,
  formatWindSpeed,
  hasNotableGust,
  hasWindData,
} from '../utils/wind.js';
import { createWindChart, getWindArrowAngles } from '../utils/charts.js';
import { SolarSentinelApp } from '../app.js';
import { DebugPanel } from '../components/debug.js';
import type { DailyCalendarDay, WeatherData } from '../types/weather.js';

describe('wind utils', () => {
  it('maps degrees to 8-point cardinals', () => {
    expect(degreesToCardinal(0)).toBe('N');
    expect(degreesToCardinal(360)).toBe('N');
    expect(degreesToCardinal(22)).toBe('N');
    expect(degreesToCardinal(23)).toBe('NE');
    expect(degreesToCardinal(90)).toBe('E');
    expect(degreesToCardinal(180)).toBe('S');
    expect(degreesToCardinal(315)).toBe('NW');
    expect(degreesToCardinal(350)).toBe('N');
    expect(degreesToCardinal(-45)).toBe('NW');
  });

  it('returns null for missing directions', () => {
    expect(degreesToCardinal(null)).toBeNull();
    expect(degreesToCardinal(undefined)).toBeNull();
    expect(degreesToCardinal(NaN)).toBeNull();
  });

  it('formats speed and direction', () => {
    expect(formatWind(8.4, 315)).toBe('8 mph NW');
    expect(formatWind(8.4, null)).toBe('8 mph');
    expect(formatWind(null, 315)).toBe('--');
    expect(formatWind(undefined, undefined)).toBe('--');
  });

  it('only reports gusts at least 5 mph above sustained wind', () => {
    expect(hasNotableGust(8, 12)).toBe(false);
    expect(hasNotableGust(8, 13)).toBe(true);
    expect(formatGustSuffix(8, 18.4)).toBe('gust 18');
    expect(formatGustSuffix(8, 10)).toBeNull();
    expect(formatGustSuffix(null, 30)).toBeNull();
    expect(formatGustSuffix(8, undefined)).toBeNull();
    expect(formatWindSpeed(8.4)).toBe('8 mph');
    expect(formatWindSpeed(null)).toBe('--');
  });

  it('detects wind data presence', () => {
    expect(hasWindData(undefined)).toBe(false);
    expect(hasWindData([null, null])).toBe(false);
    expect(hasWindData([null, 3])).toBe(true);
  });
});

describe('createWindChart', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as any;
  });

  const data: WeatherData = {
    labels: ['12 AM', '1 AM', '2 AM'],
    uv: [0, 0, 0],
    uvClearSky: [0, 0, 0],
    precipitation: [0, 0, 0],
    temperature: [60, 60, 60],
    apparentTemperature: [60, 60, 60],
    cloudCover: [0, 0, 0],
    humidity: [50, 50, 50],
    date: '2026-01-01',
    windSpeed: [5, null, 10],
    windGusts: [9, null, 20],
    windDirection: [90, null, 270],
  };

  it('draws sustained + dashed gust lines with per-point downwind arrows', async () => {
    const ctor = vi.mocked((global as any).Chart);
    ctor.mockClear();
    await createWindChart(document.createElement('canvas'), data);
    const config = ctor.mock.calls[0][1];
    const [speed, gust] = config.data.datasets;
    expect(speed.data).toEqual([5, null, 10]);
    expect(gust.borderDash).toBeTruthy();
    expect(gust.pointRadius).toBe(0);
    expect(speed.pointRadius).toBe(0);
    expect(config.plugins.map((plugin: { id: string }) => plugin.id)).toContain('wind-arrows');
    expect(config.options.scales.y.beginAtZero).toBe(true);
    expect(config.options.responsive).toBe(false);
    expect(config.options.animation).toBe(false);
  });

  it('points arrows downwind and skips hours without data', () => {
    const angles = getWindArrowAngles(data, 1);
    expect(angles[0]).toBeCloseTo((270 * Math.PI) / 180); // from E, blows W
    expect(angles[1]).toBeNull();
    expect(angles[2]).toBeCloseTo((90 * Math.PI) / 180);
    expect(getWindArrowAngles(data, 2)[2]).not.toBeNull();
    expect(getWindArrowAngles({ ...data, windDirection: undefined }, 1)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('does not throw when wind arrays are absent', async () => {
    const { windSpeed, windGusts, windDirection, ...noWind } = data;
    void windSpeed;
    void windGusts;
    void windDirection;
    await expect(createWindChart(document.createElement('canvas'), noWind)).resolves.toBeDefined();
  });
});

describe('wind in the UI', () => {
  const today = new Date().toLocaleDateString('en-CA');
  const labels = Array.from({ length: 24 }, (_, h) => {
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:00 ${h < 12 ? 'AM' : 'PM'}`;
  });
  const fill = <T>(value: T) => labels.map(() => value);
  const base: WeatherData = {
    labels,
    uv: fill(1),
    uvClearSky: fill(1),
    precipitation: fill(10),
    temperature: fill(60),
    apparentTemperature: fill(60),
    cloudCover: fill(0),
    humidity: fill(50),
    date: today,
    daily: { date: today, tempMax: 70, tempMin: 50, uvMax: 5, precipMax: 10, humidityMax: 70 },
    metadata: { cached: true, cacheAge: 0, lastUpdated: new Date().toISOString() },
  };
  const text = (id: string) => document.getElementById(id)?.textContent;

  const setupDOM = () => {
    document.body.innerHTML = `
      <div id="loading"></div><div id="current-conditions" class="hidden"></div>
      <div id="chart-container" class="hidden"></div>
      <div id="weather-chart-container" class="hidden"></div>
      <div id="wind-chart-container" class="hidden"></div>
      <div id="legend"></div><div id="error" class="hidden"></div>
      <div id="date-display"></div><div id="location-display"></div>
      <span id="current-time"></span>
      <button id="prev-day"></button><button id="next-day"></button><button id="debug-btn"></button>
      <div id="dual-display" class="hidden">
        <span id="current-wind-dual">--</span><span id="current-wind-dir-dual"></span><span id="current-wind-gust-dual"></span>
        <span id="today-wind-dual">--</span><span id="today-wind-dir-dual"></span><span id="today-wind-gust-dual"></span>
      </div>
      <div id="single-display" class="hidden">
        <span id="current-wind">--</span><span id="wind-label">Wind</span>
      </div>
      <canvas id="uvChart"></canvas><canvas id="weatherChart"></canvas>
      <details id="wind-chart-details"><summary>Wind</summary><canvas id="windChart"></canvas></details>`;
  };

  let app: any;
  beforeEach(() => {
    setupDOM();
    localStorage.clear();
    vi.spyOn(DebugPanel.prototype, 'log').mockImplementation(() => {});
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as any;
    vi.mocked((global as any).Chart).mockImplementation(() => ({
      destroy: vi.fn(),
      update: vi.fn(),
    }));
    app = new SolarSentinelApp();
    app.debugPanel = { log: vi.fn() };
    app.currentDate = today;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fills Now and Today wind cells, with gust suffix only when notable', () => {
    const data: WeatherData = {
      ...base,
      windSpeed: fill(8),
      windGusts: fill(18),
      windDirection: fill(315),
      daily: { ...base.daily!, windMax: 14, gustMax: 30, windDirection: 270 },
    };
    app.updateCurrentConditions(data);
    expect(text('current-wind-dual')).toBe('8 mph');
    expect(text('current-wind-dir-dual')).toBe('NW');
    expect(text('current-wind-gust-dual')).toBe('gust 18');
    expect(text('today-wind-dual')).toBe('14 mph');
    expect(text('today-wind-dir-dual')).toBe('W');
    expect(text('today-wind-gust-dual')).toBe('gust 30');

    app.updateCurrentConditions({
      ...data,
      windGusts: fill(10),
      daily: { ...data.daily!, gustMax: 16 },
    });
    expect(text('current-wind-gust-dual')).toBe('');
    expect(text('today-wind-gust-dual')).toBe('');
  });

  it('fills the single-display wind tile with gusts in the label', () => {
    app.updateDailySummary({
      ...base,
      daily: { ...base.daily!, windMax: 17.6, gustMax: 25, windDirection: 0 },
    });
    expect(text('current-wind')).toBe('18 mph N');
    expect(text('wind-label')).toBe('Wind · gusts 25');
  });

  it('shows -- and hides the wind chart for responses without wind fields', async () => {
    app.updateCurrentConditions(base);
    expect(text('current-wind-dual')).toBe('--');
    expect(text('today-wind-dual')).toBe('--');
    app.updateDailySummary(base);
    expect(text('current-wind')).toBe('--');
    expect(text('wind-label')).toBe('Wind');

    (document.getElementById('wind-chart-details') as HTMLDetailsElement).open = true;
    document.getElementById('wind-chart-container')!.classList.remove('hidden');
    await app.renderCharts(base);
    expect(document.getElementById('wind-chart-container')!.classList.contains('hidden')).toBe(
      true
    );
    expect(vi.mocked((global as any).Chart)).toHaveBeenCalledTimes(2);

    await app.renderCharts({
      ...base,
      windSpeed: fill(6),
      windGusts: fill(9),
      windDirection: fill(0),
    });
    expect(document.getElementById('wind-chart-container')!.classList.contains('hidden')).toBe(
      false
    );
    expect(vi.mocked((global as any).Chart)).toHaveBeenCalledTimes(5);
  });

  it('keeps the wind panel collapsed by default and skips drawing its chart', async () => {
    app.setupWindChartToggle();
    const details = document.getElementById('wind-chart-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await app.renderCharts({ ...base, windSpeed: fill(6), windDirection: fill(0) });
    expect(document.getElementById('wind-chart-container')!.classList.contains('hidden')).toBe(
      false
    );
    expect(vi.mocked((global as any).Chart)).toHaveBeenCalledTimes(2);
  });

  it('remembers an opened wind panel and draws the chart when opened', async () => {
    app.setupWindChartToggle();
    const details = document.getElementById('wind-chart-details') as HTMLDetailsElement;
    await app.renderCharts({ ...base, windSpeed: fill(6), windDirection: fill(0) });
    vi.mocked((global as any).Chart).mockClear();

    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(localStorage.getItem('solar_sentinel_wind_chart_open')).toBe('1');
    await vi.waitFor(() => expect(vi.mocked((global as any).Chart)).toHaveBeenCalledTimes(3));

    setupDOM();
    const next = new SolarSentinelApp() as any;
    next.setupWindChartToggle();
    expect((document.getElementById('wind-chart-details') as HTMLDetailsElement).open).toBe(true);

    const reopened = document.getElementById('wind-chart-details') as HTMLDetailsElement;
    reopened.open = false;
    reopened.dispatchEvent(new Event('toggle'));
    expect(localStorage.getItem('solar_sentinel_wind_chart_open')).toBe('0');
  });

  it('adds wind to non-art forecast calendar cells only when present', () => {
    app.forecastArtMode = false;
    const day: DailyCalendarDay = {
      date: today,
      tempMax: 70,
      tempMin: 50,
      uvMax: 5,
      precipMax: 40,
      precipitation: [],
      cloudCover: [],
      humidityMax: 60,
      windMax: 11.6,
    };
    expect(app.renderForecastCalendarDay(day)).toContain('🌧 40% · 💨 12');
    const without = app.renderForecastCalendarDay({ ...day, windMax: undefined });
    expect(without).toContain('🌧 40%</span>');
    expect(without).not.toContain('💨');
  });
});
