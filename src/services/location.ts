import type { Location } from '../types/weather.js';

export class LocationService {
  private readonly DEFAULT_LOCATION: Location = {
    lat: 40.7162,
    lon: -74.3625,
    name: 'Summit, NJ',
    isUserLocation: false,
  };

  private readonly LOCATION_CACHE_KEY = 'solar_sentinel_location';
  private readonly CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

  getCachedLocation(): Location | null {
    try {
      const cached = localStorage.getItem(this.LOCATION_CACHE_KEY);
      if (!cached) return null;

      const data = JSON.parse(cached);
      const now = Date.now();
      const age = now - data.timestamp;

      if (age > this.CACHE_DURATION_MS) {
        console.log(`Location cache expired (${Math.round(age / 1000 / 60 / 60)}h old)`);
        localStorage.removeItem(this.LOCATION_CACHE_KEY);
        return null;
      }

      console.log(`Location cache hit (${Math.round(age / 1000 / 60)}min old)`);
      return {
        lat: data.lat,
        lon: data.lon,
        name: data.name,
        isUserLocation: true,
      };
    } catch (error) {
      console.log('Location cache error:', error);
      return null;
    }
  }

  private setCachedLocation(location: Location): void {
    try {
      const data = {
        lat: location.lat,
        lon: location.lon,
        name: location.name,
        timestamp: Date.now(),
      };
      localStorage.setItem(this.LOCATION_CACHE_KEY, JSON.stringify(data));
      console.log(`Location cached: ${location.name}`);
    } catch (error) {
      console.log('Location cache error:', error);
    }
  }

  async getCurrentLocation(): Promise<Location | null> {
    if (!navigator.geolocation) {
      console.log('Geolocation not supported');
      return null;
    }

    const startTime = performance.now();
    return new Promise(resolve => {
      const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000, // 5 minutes
      };

      navigator.geolocation.getCurrentPosition(
        async position => {
          const locationName = await this.getLocationName(
            position.coords.latitude,
            position.coords.longitude
          );
          const endTime = performance.now();
          const duration = Math.round(endTime - startTime);

          console.log(`Geolocation obtained in ${duration}ms`);

          const location: Location = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            name: locationName,
            isUserLocation: true,
          };

          // Cache the location
          this.setCachedLocation(location);

          resolve(location);
        },
        error => {
          const endTime = performance.now();
          const duration = Math.round(endTime - startTime);
          console.log(`Geolocation error after ${duration}ms:`, error.message);
          resolve(null);
        },
        options
      );
    });
  }

  getDefaultLocation(): Location {
    return { ...this.DEFAULT_LOCATION };
  }

  private async getLocationName(lat: number, lon: number): Promise<string> {
    const startTime = performance.now();
    try {
      const response = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
      );
      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);

      const data = await response.json();
      console.log(`Geocoding completed in ${duration}ms`);

      if (data.city && data.principalSubdivision) {
        return `${data.city}, ${data.principalSubdivision}`;
      } else if (data.locality && data.principalSubdivision) {
        return `${data.locality}, ${data.principalSubdivision}`;
      } else if (data.countryName) {
        return data.countryName;
      }
      return 'Your Location';
    } catch (error) {
      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);
      console.log(`Geocoding error after ${duration}ms:`, error);
      return 'Your Location';
    }
  }
}
