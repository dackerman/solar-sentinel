import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocationService } from '../services/location.js';
import type { Location } from '../types/weather.js';

describe('LocationService - Caching', () => {
  let service: LocationService;
  const mockValidLocation: Location = {
    lat: 40.7589,
    lon: -73.9851,
    name: 'New York, NY',
    isUserLocation: true,
  };

  beforeEach(() => {
    service = new LocationService();
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('getCachedLocation', () => {
    it('should return null when localStorage is empty', () => {
      expect(service.getCachedLocation()).toBeNull();
    });

    it('should return cached location when valid', () => {
      const cacheData = {
        lat: mockValidLocation.lat,
        lon: mockValidLocation.lon,
        name: mockValidLocation.name,
        timestamp: Date.now() - 1 * 60 * 60 * 1000, // 1 hour ago
      };
      localStorage.setItem('solar_sentinel_location', JSON.stringify(cacheData));

      const result = service.getCachedLocation();
      expect(result).toEqual(mockValidLocation);
    });

    it('should return null and clear expired cache', () => {
      const expiredData = {
        lat: mockValidLocation.lat,
        lon: mockValidLocation.lon,
        name: mockValidLocation.name,
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      };
      localStorage.setItem('solar_sentinel_location', JSON.stringify(expiredData));

      const result = service.getCachedLocation();
      expect(result).toBeNull();
      expect(localStorage.getItem('solar_sentinel_location')).toBeNull();
    });

    it('should handle malformed JSON gracefully', () => {
      localStorage.setItem('solar_sentinel_location', 'invalid-json');
      expect(service.getCachedLocation()).toBeNull();
    });

    it('should handle localStorage exceptions', () => {
      const originalGetItem = localStorage.getItem;
      localStorage.getItem = vi.fn(() => {
        throw new Error('localStorage error');
      });

      expect(service.getCachedLocation()).toBeNull();

      localStorage.getItem = originalGetItem;
    });
  });

  describe('cache expiration boundary', () => {
    it('should return location at 23h 59m 59s (just before expiry)', () => {
      const almostExpiredData = {
        lat: mockValidLocation.lat,
        lon: mockValidLocation.lon,
        name: mockValidLocation.name,
        timestamp: Date.now() - (24 * 60 * 60 * 1000 - 1000), // 1 second before 24h
      };
      localStorage.setItem('solar_sentinel_location', JSON.stringify(almostExpiredData));

      const result = service.getCachedLocation();
      expect(result).toEqual(mockValidLocation);
    });

    it('should return null at exactly 24h (expired)', () => {
      const expiredData = {
        lat: mockValidLocation.lat,
        lon: mockValidLocation.lon,
        name: mockValidLocation.name,
        timestamp: Date.now() - (24 * 60 * 60 * 1000 + 1000), // 24h + 1 second ago (definitely expired)
      };
      localStorage.setItem('solar_sentinel_location', JSON.stringify(expiredData));

      const result = service.getCachedLocation();
      expect(result).toBeNull();
    });
  });

  describe('getCurrentLocation with caching', () => {
    it('should cache location after successful geolocation', async () => {
      const mockPosition = {
        coords: {
          latitude: mockValidLocation.lat,
          longitude: mockValidLocation.lon,
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

      // Should have no cache initially
      expect(service.getCachedLocation()).toBeNull();

      // Get current location (this should cache it)
      const location = await service.getCurrentLocation();
      expect(location).toEqual(mockValidLocation);

      // Should now be cached
      const cachedLocation = service.getCachedLocation();
      expect(cachedLocation).toEqual(mockValidLocation);
    });

    it('should not cache when geolocation fails', async () => {
      vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation((_success, error) => {
        error!({
          code: 1,
          message: 'Permission denied',
        } as GeolocationPositionError);
      });

      // Should have no cache initially
      expect(service.getCachedLocation()).toBeNull();

      // Try to get location (should fail)
      const location = await service.getCurrentLocation();
      expect(location).toBeNull();

      // Should still have no cache
      expect(service.getCachedLocation()).toBeNull();
    });

    it('should handle caching errors gracefully', async () => {
      const mockPosition = {
        coords: {
          latitude: mockValidLocation.lat,
          longitude: mockValidLocation.lon,
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

      // Mock localStorage.setItem to throw error
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn(() => {
        throw new Error('Storage quota exceeded');
      });

      // Should still return location even if caching fails
      const location = await service.getCurrentLocation();
      expect(location).toEqual(mockValidLocation);

      localStorage.setItem = originalSetItem;
    });
  });
});
