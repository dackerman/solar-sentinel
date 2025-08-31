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
          resolve({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            name: locationName,
            isUserLocation: true
          });
        },
        (error) => {
          console.log('Geolocation error:', error.message);
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
    try {
      const response = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
      );
      const data = await response.json();
      
      if (data.city && data.principalSubdivision) {
        return `${data.city}, ${data.principalSubdivision}`;
      } else if (data.locality && data.principalSubdivision) {
        return `${data.locality}, ${data.principalSubdivision}`;
      } else if (data.countryName) {
        return data.countryName;
      }
      return 'Your Location';
    } catch (error) {
      console.log('Geocoding error:', error);
      return 'Your Location';
    }
  }
}