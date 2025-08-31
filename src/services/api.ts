import type { WeatherData, DailyData, Location } from '../types/weather.js';

export class WeatherAPI {
  private baseURL = '';

  async fetchWeatherData(location: Location, date: string): Promise<WeatherData> {
    const url = `${this.baseURL}/api/uv-today?lat=${location.lat}&lon=${location.lon}&date=${date}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Weather API failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data as WeatherData;
  }

  async fetchDailyData(location: Location, date: string): Promise<DailyData> {
    const url = `${this.baseURL}/api/daily-summary?lat=${location.lat}&lon=${location.lon}&date=${date}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Daily API failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data as DailyData;
  }

  async checkForUpdates(location: Location, date: string, timestamp: number): Promise<{ hasUpdate: boolean }> {
    const url = `${this.baseURL}/api/uv-today/poll?lat=${location.lat}&lon=${location.lon}&date=${date}&timestamp=${timestamp}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Poll API failed: ${response.status}`);
    }
    
    return response.json();
  }
}