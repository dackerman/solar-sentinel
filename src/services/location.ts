import type { Location } from '../types/weather.js';

export class LocationService {
  private readonly DEFAULT_LOCATION: Location = {
    lat: 40.7162,
    lon: -74.3625,
    name: 'Summit, NJ',
    isUserLocation: false
  };

  async getCurrentLocation(): Promise<Location | null> {
    if (!navigator.geolocation) {
      console.log('Geolocation not supported');
      return null;
    }

    const startTime = performance.now();
    return new Promise((resolve) => {
      const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000 // 5 minutes
      };

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const locationName = await this.getLocationName(
            position.coords.latitude,
            position.coords.longitude
          );
          const endTime = performance.now();
          const duration = Math.round(endTime - startTime);
          
          console.log(`Geolocation obtained in ${duration}ms`);
          resolve({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            name: locationName,
            isUserLocation: true
          });
        },
        (error) => {
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