import type { WeatherData, DailyData, Location, RequestTiming } from '../types/weather.js';

export class WeatherAPI {
  private baseURL = '';

  async fetchWeatherData(location: Location, date: string): Promise<WeatherData & { timing?: RequestTiming }> {
    const startTime = performance.now();
    const url = `${this.baseURL}/api/uv-today?lat=${location.lat}&lon=${location.lon}&date=${date}`;
    
    const response = await fetch(url);
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);
    
    if (!response.ok) {
      throw new Error(`Weather API failed: ${response.status}`);
    }
    
    const cacheStatus = response.headers.get('X-Cache-Status') as 'hit' | 'miss' | null;
    const data = await response.json();
    
    return {
      ...data,
      timing: {
        duration,
        cacheStatus: cacheStatus || 'unknown'
      }
    } as WeatherData & { timing: RequestTiming };
  }

  async fetchDailyData(location: Location, date: string): Promise<DailyData & { timing?: RequestTiming }> {
    const startTime = performance.now();
    const url = `${this.baseURL}/api/daily-summary?lat=${location.lat}&lon=${location.lon}&date=${date}`;
    
    const response = await fetch(url);
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);
    
    if (!response.ok) {
      throw new Error(`Daily API failed: ${response.status}`);
    }
    
    const cacheStatus = response.headers.get('X-Cache-Status') as 'hit' | 'miss' | null;
    const data = await response.json();
    
    return {
      ...data,
      timing: {
        duration,
        cacheStatus: cacheStatus || 'unknown'
      }
    } as DailyData & { timing: RequestTiming };
  }

  async checkForUpdates(location: Location, date: string, timestamp: number): Promise<{ hasUpdate: boolean; timing?: RequestTiming }> {
    const startTime = performance.now();
    const url = `${this.baseURL}/api/uv-today/poll?lat=${location.lat}&lon=${location.lon}&date=${date}&timestamp=${timestamp}`;
    
    const response = await fetch(url);
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);
    
    if (!response.ok) {
      throw new Error(`Poll API failed: ${response.status}`);
    }
    
    const data = await response.json();
    return {
      ...data,
      timing: {
        duration,
        cacheStatus: 'unknown' // Poll endpoint doesn't have cache headers
      }
    };
  }
}