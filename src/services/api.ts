import type {
  WeatherData,
  DailyData,
  DailyCalendarData,
  DailyCalendarHistoryEntry,
  Location,
  RequestTiming,
  ApiHistoryResponse,
  WeatherHistoryEntry,
} from '../types/weather.js';

export class WeatherAPI {
  private baseURL = '';
  private readonly WEATHER_CACHE_PREFIX = 'solar_sentinel_weather';
  private readonly CALENDAR_CACHE_PREFIX = 'solar_sentinel_calendar';
  private readonly WEATHER_CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours
  private readonly inFlightRequests = new Map<string, Promise<unknown>>();

  private readonly HISTORY_PAGE_SIZE = 500;

  async fetchWeatherData(
    location: Location,
    date: string
  ): Promise<WeatherData & { timing?: RequestTiming }> {
    const startTime = performance.now();
    const url = `${this.baseURL}/api/weather?lat=${location.lat}&lon=${location.lon}&date=${date}`;

    const response = await this.fetchOnce(url);
    const responseTime = performance.now();
    const responseDuration = Math.round(responseTime - startTime);

    if (!response.ok) {
      throw new Error(`Weather API failed: ${response.status}`);
    }

    const cacheStatus = response.headers.get('X-Cache-Status') as 'hit' | 'miss' | null;
    const serverTiming = response.headers.get('Server-Timing');
    const parseStart = performance.now();
    const data = await response.json();
    const parseDuration = Math.round(performance.now() - parseStart);

    const cacheWriteStart = performance.now();
    this.setCachedWeatherData(location, date, data);
    const cacheWriteDuration = Math.round(performance.now() - cacheWriteStart);
    const duration = Math.round(performance.now() - startTime);

    return {
      ...data,
      timing: {
        duration,
        responseDuration,
        parseDuration,
        cacheWriteDuration,
        cacheStatus: cacheStatus || 'unknown',
        serverTiming,
      },
    } as WeatherData & { timing: RequestTiming };
  }

  getCachedWeatherData(
    location: Location,
    date: string
  ): (WeatherData & { timing?: RequestTiming }) | null {
    try {
      const cached = localStorage.getItem(this.getWeatherCacheKey(location, date));
      if (!cached) return null;

      const parsed = JSON.parse(cached);
      const age = Date.now() - parsed.timestamp;
      if (age > this.WEATHER_CACHE_DURATION_MS) {
        localStorage.removeItem(this.getWeatherCacheKey(location, date));
        return null;
      }

      return {
        ...parsed.data,
        metadata: parsed.data.metadata
          ? {
              ...parsed.data.metadata,
              cached: true,
              cacheAge: parsed.data.metadata.cacheAge + age,
            }
          : parsed.data.metadata,
        timing: {
          duration: 0,
          cacheStatus: 'local',
        },
      } as WeatherData & { timing: RequestTiming };
    } catch (error) {
      console.log('Weather cache error:', error);
      return null;
    }
  }

  private setCachedWeatherData(location: Location, date: string, data: WeatherData): void {
    try {
      localStorage.setItem(
        this.getWeatherCacheKey(location, date),
        JSON.stringify({
          data,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      console.log('Weather cache error:', error);
    }
  }

  private getWeatherCacheKey(location: Location, date: string): string {
    return `${this.WEATHER_CACHE_PREFIX}_${location.lat.toFixed(2)},${location.lon.toFixed(2)},${date}`;
  }

  async fetchDailyCalendar(
    location: Location,
    startDate: string
  ): Promise<DailyCalendarData & { timing?: RequestTiming }> {
    const startTime = performance.now();
    const url = `${this.baseURL}/api/daily-calendar?lat=${location.lat}&lon=${location.lon}&date=${startDate}`;

    const response = await this.fetchOnce(url);
    const responseTime = performance.now();
    const responseDuration = Math.round(responseTime - startTime);

    if (!response.ok) {
      throw new Error(`Daily calendar API failed: ${response.status}`);
    }

    const cacheStatus = response.headers.get('X-Cache-Status') as 'hit' | 'miss' | null;
    const serverTiming = response.headers.get('Server-Timing');
    const parseStart = performance.now();
    const data = await response.json();
    const parseDuration = Math.round(performance.now() - parseStart);

    const cacheWriteStart = performance.now();
    this.setCachedDailyCalendar(location, startDate, data);
    const cacheWriteDuration = Math.round(performance.now() - cacheWriteStart);
    const duration = Math.round(performance.now() - startTime);

    return {
      ...data,
      timing: {
        duration,
        responseDuration,
        parseDuration,
        cacheWriteDuration,
        cacheStatus: cacheStatus || 'unknown',
        serverTiming,
      },
    } as DailyCalendarData & { timing: RequestTiming };
  }

  getCachedDailyCalendar(
    location: Location,
    startDate: string
  ): (DailyCalendarData & { timing?: RequestTiming }) | null {
    try {
      const cacheKey = this.getCalendarCacheKey(location, startDate);
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return null;

      const parsed = JSON.parse(cached);
      const age = Date.now() - parsed.timestamp;
      if (age > this.WEATHER_CACHE_DURATION_MS) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      return {
        ...parsed.data,
        metadata: parsed.data.metadata
          ? {
              ...parsed.data.metadata,
              cached: true,
              cacheAge: parsed.data.metadata.cacheAge + age,
            }
          : parsed.data.metadata,
        timing: {
          duration: 0,
          cacheStatus: 'local',
        },
      } as DailyCalendarData & { timing: RequestTiming };
    } catch (error) {
      console.log('Daily calendar cache error:', error);
      return null;
    }
  }

  private setCachedDailyCalendar(
    location: Location,
    startDate: string,
    data: DailyCalendarData
  ): void {
    try {
      localStorage.setItem(
        this.getCalendarCacheKey(location, startDate),
        JSON.stringify({
          data,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      console.log('Daily calendar cache error:', error);
    }
  }

  private getCalendarCacheKey(location: Location, startDate: string): string {
    return `${this.CALENDAR_CACHE_PREFIX}_${location.lat.toFixed(2)},${location.lon.toFixed(2)},${startDate}`;
  }

  async fetchWeatherHistory(
    location: Location,
    date?: string,
    options: { before?: string; after?: string } = {}
  ): Promise<WeatherHistoryEntry[]> {
    const history = await this.fetchHistory<WeatherData>('/api/weather', location, date, options);
    return history.entries.map(entry => ({
      id: entry.id,
      fetchedAt: entry.fetchedAt,
      location: entry.location,
      date: entry.date,
      data: entry.data,
      statusCode: entry.statusCode,
      cacheStatus: entry.cacheStatus,
    }));
  }

  async fetchDailyCalendarHistory(
    location: Location,
    startDate?: string,
    options: { before?: string; after?: string } = {}
  ): Promise<DailyCalendarHistoryEntry[]> {
    const history = await this.fetchHistory<DailyCalendarData>(
      '/api/daily-calendar',
      location,
      startDate,
      options
    );
    return history.entries.map(entry => ({
      id: entry.id,
      fetchedAt: entry.fetchedAt,
      location: entry.location,
      startDate: entry.date,
      data: entry.data,
      statusCode: entry.statusCode,
      cacheStatus: entry.cacheStatus,
    }));
  }

  private async fetchHistory<T>(
    route: '/api/weather' | '/api/daily-calendar',
    location: Location,
    date?: string,
    options: { before?: string; after?: string } = {}
  ): Promise<ApiHistoryResponse<T>> {
    const params = new URLSearchParams({
      route,
      lat: String(location.lat),
      lon: String(location.lon),
      limit: String(this.HISTORY_PAGE_SIZE),
    });
    if (date) params.set('date', date);
    if (options.before) params.set('before', options.before);
    if (options.after) params.set('after', options.after);
    const response = await this.fetchOnce(`${this.baseURL}/api/history?${params.toString()}`);

    if (!response.ok) {
      throw new Error(`History API failed: ${response.status}`);
    }

    return (await response.json()) as ApiHistoryResponse<T>;
  }

  async fetchDailyData(
    location: Location,
    date: string
  ): Promise<DailyData & { timing?: RequestTiming }> {
    const startTime = performance.now();
    const url = `${this.baseURL}/api/daily-summary?lat=${location.lat}&lon=${location.lon}&date=${date}`;

    const response = await this.fetchOnce(url);
    const responseTime = performance.now();
    const responseDuration = Math.round(responseTime - startTime);

    if (!response.ok) {
      throw new Error(`Daily API failed: ${response.status}`);
    }

    const cacheStatus = response.headers.get('X-Cache-Status') as 'hit' | 'miss' | null;
    const serverTiming = response.headers.get('Server-Timing');
    const parseStart = performance.now();
    const data = await response.json();
    const parseDuration = Math.round(performance.now() - parseStart);
    const duration = Math.round(performance.now() - startTime);

    return {
      ...data,
      timing: {
        duration,
        responseDuration,
        parseDuration,
        cacheStatus: cacheStatus || 'unknown',
        serverTiming,
      },
    } as DailyData & { timing: RequestTiming };
  }

  async checkForUpdates(
    location: Location,
    date: string,
    timestamp: number
  ): Promise<{ hasUpdate: boolean; timing?: RequestTiming }> {
    const startTime = performance.now();
    const url = `${this.baseURL}/api/uv-today/poll?lat=${location.lat}&lon=${location.lon}&date=${date}&timestamp=${timestamp}`;

    const response = await this.fetchOnce(url);
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
        cacheStatus: 'unknown', // Poll endpoint doesn't have cache headers
      },
    };
  }

  private async fetchOnce(url: string): Promise<Response> {
    const inFlight = this.inFlightRequests.get(url) as Promise<Response> | undefined;
    if (inFlight) {
      return inFlight.then(response => response.clone());
    }

    const request = fetch(url).finally(() => {
      this.inFlightRequests.delete(url);
    });
    this.inFlightRequests.set(url, request);

    const response = await request;
    return response.clone();
  }
}
