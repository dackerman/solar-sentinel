import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WeatherAPI } from '../services/api.js';
import { LocationService } from '../services/location.js';
import type { WeatherData, Location } from '../types/weather.js';

describe('WeatherAPI', () => {
  let api: WeatherAPI;
  const mockLocation: Location = {
    lat: 40.7162,
    lon: -74.3625,
    name: 'Summit, NJ',
    isUserLocation: false
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
      date: '2025-08-31'
    };

    const mockResponse = {
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(mockData)
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

    const result = await api.fetchWeatherData(mockLocation, '2025-08-31');

    expect(fetch).toHaveBeenCalledWith(
      '/api/uv-today?lat=40.7162&lon=-74.3625&date=2025-08-31'
    );
    expect(result.timing).toBeDefined();
    expect(result.timing?.cacheStatus).toBe('hit');
    expect(typeof result.timing?.duration).toBe('number');
    expect(result.timing?.duration).toBeGreaterThanOrEqual(0);
  });

  it('should throw error when API fails', async () => {
    const mockResponse = {
      ok: false,
      status: 500
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

    await expect(api.fetchWeatherData(mockLocation, '2025-08-31'))
      .rejects.toThrow('Weather API failed: 500');
  });
});

describe('LocationService', () => {
  let service: LocationService;

  beforeEach(() => {
    service = new LocationService();
    vi.clearAllMocks();
  });

  it('should return default location', () => {
    const location = service.getDefaultLocation();
    expect(location).toEqual({
      lat: 40.7162,
      lon: -74.3625,
      name: 'Summit, NJ',
      isUserLocation: false
    });
  });

  it('should get user location successfully', async () => {
    const mockPosition = {
      coords: {
        latitude: 40.7589,
        longitude: -73.9851
      }
    };

    vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(
      (success) => {
        success(mockPosition as GeolocationPosition);
      }
    );

    // Mock the fetch for geocoding
    const mockGeoResponse = {
      city: 'New York',
      principalSubdivision: 'NY'
    };
    vi.mocked(global.fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue(mockGeoResponse)
    } as any);

    const location = await service.getCurrentLocation();

    expect(location).toEqual({
      lat: 40.7589,
      lon: -73.9851,
      name: 'New York, NY',
      isUserLocation: true
    });
  });

  it('should return null when geolocation fails', async () => {
    vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation(
      (_success, error) => {
        error!({
          code: 1,
          message: 'Permission denied'
        } as GeolocationPositionError);
      }
    );

    const location = await service.getCurrentLocation();
    expect(location).toBeNull();
  });
});