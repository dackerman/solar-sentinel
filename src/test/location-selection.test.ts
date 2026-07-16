import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SolarSentinelApp } from '../app.js';
import { SavedLocationsService } from '../services/savedLocations.js';
import type { Location, WeatherData } from '../types/weather.js';

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

const denver: Location = {
  lat: 39.7392,
  lon: -104.9903,
  name: 'Denver, CO',
  isUserLocation: false,
};

const mkData = (): WeatherData => {
  const date = new Date().toLocaleDateString('en-CA');
  return {
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
  };
};

const mkResponse = (data: WeatherData) => {
  const response = {
    ok: true,
    headers: { get: vi.fn().mockReturnValue('hit') },
    json: vi.fn().mockResolvedValue(data),
    clone: vi.fn(),
  };
  response.clone.mockReturnValue(response);
  return response;
};

describe('location selection', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('boots into a stored manual selection and skips geolocation', async () => {
    new SavedLocationsService().setSelectedLocation(denver, 'manual');
    const geoSpy = vi.spyOn(navigator.geolocation, 'getCurrentPosition');
    vi.mocked(global.fetch).mockResolvedValueOnce(mkResponse(mkData()) as any);

    const app = new SolarSentinelApp();
    await app.initialize();

    expect(document.getElementById('location-display')?.textContent).toContain('Denver, CO');
    expect(geoSpy).not.toHaveBeenCalled();

    const weatherCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map(call => String(call[0]))
      .find(url => url.includes('/api/weather'));
    expect(weatherCall).toContain('lat=39.7392');
  });

  it('selectLocation persists the manual selection and reloads', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mkResponse(mkData()) as any);
    const app = new SolarSentinelApp();
    const init = app.initialize();
    const errCb = vi.mocked(navigator.geolocation.getCurrentPosition).mock.calls[0][1]!;
    errCb({ code: 1, message: 'Permission denied' } as GeolocationPositionError);
    await init;

    app.selectLocation(denver);

    const stored = new SavedLocationsService().getSelectedLocation();
    expect(stored?.source).toBe('manual');
    expect(stored?.location.name).toBe('Denver, CO');
    expect(document.getElementById('location-display')?.textContent).toContain('Denver, CO');
  });

  it('useCurrentLocation clears the manual selection and restores the auto flow', async () => {
    new SavedLocationsService().setSelectedLocation(denver, 'manual');
    vi.mocked(global.fetch).mockResolvedValue(mkResponse(mkData()) as any);
    const app = new SolarSentinelApp();
    await app.initialize();

    const geoSpy = vi.spyOn(navigator.geolocation, 'getCurrentPosition');
    app.useCurrentLocation();

    expect(new SavedLocationsService().getSelectedLocation()).toBeNull();
    expect(geoSpy).toHaveBeenCalled(); // home-first flow geolocates in the background
    expect(document.getElementById('location-display')?.textContent).toContain('Windham, NH');
  });

  it('toggleFavorite adds then removes the location', async () => {
    vi.mocked(global.fetch).mockResolvedValue(mkResponse(mkData()) as any);
    const app = new SolarSentinelApp();
    const init = app.initialize();
    const errCb = vi.mocked(navigator.geolocation.getCurrentPosition).mock.calls[0][1]!;
    errCb({ code: 1, message: 'Permission denied' } as GeolocationPositionError);
    await init;

    app.toggleFavorite(denver);
    expect(new SavedLocationsService().isSaved(denver)).toBe(true);
    app.toggleFavorite(denver);
    expect(new SavedLocationsService().isSaved(denver)).toBe(false);
  });
});
