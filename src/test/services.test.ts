import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WeatherAPI, AuthExpiredError } from '../services/api.js';
import { LocationService } from '../services/location.js';
import type { WeatherData, Location } from '../types/weather.js';

describe('WeatherAPI', () => {
  let api: WeatherAPI;
  const mockLocation: Location = {
    lat: 42.8006,
    lon: -71.3048,
    name: 'Windham, NH',
    isUserLocation: false,
  };

  beforeEach(() => {
    api = new WeatherAPI();
    vi.clearAllMocks();
  });

  it('should fetch weather data successfully with timing', async () => {
    const mockData: WeatherData = {
      labels: ['12:00 AM', '1:00 AM'],
      uv: [0, 0.1],
      uvClearSky: [0, 0.1],
      precipitation: [0, 0],
      temperature: [60, 59],
      apparentTemperature: [58, 57],
      cloudCover: [0, 5],
      humidity: [70, 72],
      date: '2025-08-31',
      daily: {
        date: '2025-08-31',
        tempMax: 70,
        tempMin: 50,
        uvMax: 5,
        precipMax: 10,
        humidityMax: 70,
      },
    };

    const mockResponse = {
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(mockData),
      clone: vi.fn(),
    };
    mockResponse.clone.mockReturnValue(mockResponse);
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);
    mockResponse.headers.get.mockImplementation((header: string) => {
      if (header === 'Server-Timing') return 'parseRequest;dur=1, total;dur=2';
      if (header === 'X-Cache-Status') return 'hit';
      return null;
    });

    const result = await api.fetchWeatherData(mockLocation, '2025-08-31');

    expect(fetch).toHaveBeenCalledWith('/api/weather?lat=42.8006&lon=-71.3048&date=2025-08-31', {
      redirect: 'manual',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    expect(result.timing).toBeDefined();
    expect(result.timing?.cacheStatus).toBe('hit');
    expect(result.timing?.serverTiming).toBe('parseRequest;dur=1, total;dur=2');
    expect(typeof result.timing?.responseDuration).toBe('number');
    expect(typeof result.timing?.parseDuration).toBe('number');
    expect(typeof result.timing?.cacheWriteDuration).toBe('number');
    expect(typeof result.timing?.duration).toBe('number');
    expect(result.timing?.duration).toBeGreaterThanOrEqual(0);
  });

  it('should throw error when API fails', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      clone: vi.fn(),
    };
    mockResponse.clone.mockReturnValue(mockResponse);
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

    await expect(api.fetchWeatherData(mockLocation, '2025-08-31')).rejects.toThrow(
      'Weather API failed: 500'
    );
  });

  it('should request with redirect: manual so Cloudflare Access redirects surface as opaque', async () => {
    const mockData: WeatherData = {
      labels: ['12:00 AM'],
      uv: [0],
      uvClearSky: [0],
      precipitation: [0],
      temperature: [60],
      apparentTemperature: [60],
      cloudCover: [0],
      humidity: [50],
      date: '2025-08-31',
      daily: {
        date: '2025-08-31',
        tempMax: 70,
        tempMin: 50,
        uvMax: 5,
        precipMax: 10,
        humidityMax: 70,
      },
    };
    const mockResponse = {
      ok: true,
      type: 'basic',
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(mockData),
      clone: vi.fn(),
    };
    mockResponse.clone.mockReturnValue(mockResponse);
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

    await api.fetchWeatherData(mockLocation, '2025-08-31');

    expect(fetch).toHaveBeenCalledWith('/api/weather?lat=42.8006&lon=-71.3048&date=2025-08-31', {
      redirect: 'manual',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
  });

  it('bypasses the HTTP cache explicitly so a restored tab cannot replay a stale response', async () => {
    // Chrome loads a restored/back-forward tab with force-cache semantics for
    // requests issued before the load event; only an explicit cache mode on
    // the request overrides that.
    const mockResponse = {
      ok: true,
      type: 'basic',
      headers: { get: vi.fn().mockReturnValue(null) },
      json: vi.fn().mockResolvedValue({ startDate: '2025-08-31', days: [] }),
      clone: vi.fn(),
    };
    mockResponse.clone.mockReturnValue(mockResponse);
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

    await api.fetchDailyCalendar(mockLocation, null);

    expect(fetch).toHaveBeenCalledWith(
      '/api/daily-calendar?lat=42.8006&lon=-71.3048',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('should throw AuthExpiredError when the response is an opaque redirect (Cloudflare Access login)', async () => {
    const opaqueRedirectResponse = {
      type: 'opaqueredirect',
      clone: vi.fn(),
    };
    vi.mocked(global.fetch).mockResolvedValue(opaqueRedirectResponse as any);

    await expect(api.fetchWeatherData(mockLocation, '2025-08-31')).rejects.toBeInstanceOf(
      AuthExpiredError
    );
    expect(opaqueRedirectResponse.clone).not.toHaveBeenCalled();
  });

  it('propagates AuthExpiredError to concurrent callers sharing an in-flight opaque-redirect request', async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.mocked(global.fetch).mockReturnValue(
      new Promise(resolve => {
        resolveFetch = resolve;
      }) as any
    );

    const first = api.fetchWeatherData(mockLocation, '2025-08-31');
    const second = api.fetchWeatherData(mockLocation, '2025-08-31');

    resolveFetch({ type: 'opaqueredirect', clone: vi.fn() });

    await expect(first).rejects.toBeInstanceOf(AuthExpiredError);
    await expect(second).rejects.toBeInstanceOf(AuthExpiredError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('LocationService', () => {
  let service: LocationService;

  beforeEach(() => {
    service = new LocationService();
    vi.clearAllMocks();
    // Clear localStorage before each test
    localStorage.clear();
  });

  it('should return default location', () => {
    const location = service.getDefaultLocation();
    expect(location).toEqual({
      lat: 42.8006,
      lon: -71.3048,
      name: 'Windham, NH',
      isUserLocation: false,
    });
  });

  it('should get user location successfully', async () => {
    const mockPosition = {
      coords: {
        latitude: 40.7589,
        longitude: -73.9851,
      },
    };

    vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(success => {
      success(mockPosition as GeolocationPosition);
    });

    // Mock the fetch for geocoding
    const mockGeoResponse = {
      city: 'New York',
      principalSubdivision: 'NY',
    };
    vi.mocked(global.fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue(mockGeoResponse),
    } as any);

    const location = await service.getCurrentLocation();

    expect(location).toEqual({
      lat: 40.7589,
      lon: -73.9851,
      name: 'New York, NY',
      isUserLocation: true,
    });
  });

  it('should return null when geolocation fails', async () => {
    vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation((_success, error) => {
      error!({
        code: 1,
        message: 'Permission denied',
      } as GeolocationPositionError);
    });

    const location = await service.getCurrentLocation();
    expect(location).toBeNull();
  });

  describe('location caching', () => {
    it('should return null when no cached location exists', () => {
      const cachedLocation = service.getCachedLocation();
      expect(cachedLocation).toBeNull();
    });

    it('should cache and retrieve location data', async () => {
      const mockPosition = {
        coords: {
          latitude: 40.7589,
          longitude: -73.9851,
        },
      };

      vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(success => {
        success(mockPosition as GeolocationPosition);
      });

      const mockGeoResponse = {
        city: 'New York',
        principalSubdivision: 'NY',
      };
      vi.mocked(global.fetch).mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockGeoResponse),
      } as any);

      // First call should fetch and cache the location
      const location = await service.getCurrentLocation();
      expect(location?.name).toBe('New York, NY');

      // Second call to getCachedLocation should return the cached data
      const cachedLocation = service.getCachedLocation();
      expect(cachedLocation).toEqual({
        lat: 40.7589,
        lon: -73.9851,
        name: 'New York, NY',
        isUserLocation: true,
      });
    });

    it('should return null for expired cached location', () => {
      // Manually set an expired cache entry
      const expiredData = {
        lat: 40.7589,
        lon: -73.9851,
        name: 'New York, NY',
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago (expired)
      };
      localStorage.setItem('solar_sentinel_location', JSON.stringify(expiredData));

      const cachedLocation = service.getCachedLocation();
      expect(cachedLocation).toBeNull();

      // Should also remove the expired entry
      expect(localStorage.getItem('solar_sentinel_location')).toBeNull();
    });

    it('should handle corrupted cache data gracefully', () => {
      // Set invalid JSON in localStorage
      localStorage.setItem('solar_sentinel_location', 'invalid json');

      const cachedLocation = service.getCachedLocation();
      expect(cachedLocation).toBeNull();
    });

    it('should use valid cached location within 24 hours', () => {
      const validData = {
        lat: 40.7589,
        lon: -73.9851,
        name: 'New York, NY',
        timestamp: Date.now() - 12 * 60 * 60 * 1000, // 12 hours ago (valid)
      };
      localStorage.setItem('solar_sentinel_location', JSON.stringify(validData));

      const cachedLocation = service.getCachedLocation();
      expect(cachedLocation).toEqual({
        lat: 40.7589,
        lon: -73.9851,
        name: 'New York, NY',
        isUserLocation: true,
      });
    });

    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw an error
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = vi.fn().mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      const cachedLocation = service.getCachedLocation();
      expect(cachedLocation).toBeNull();

      // Restore original localStorage
      localStorage.getItem = originalGetItem;
    });
  });
});
