export interface WeatherData {
  labels: string[];
  timestamps?: string[];
  uv: number[];
  uvClearSky: number[];
  precipitation: number[];
  temperature: number[];
  apparentTemperature: number[];
  cloudCover: number[];
  humidity: number[];
  weatherCode?: Array<number | undefined>;
  // Wind (mph; direction is degrees the wind blows FROM). Absent in older cached responses.
  windSpeed?: Array<number | null>;
  windGusts?: Array<number | null>;
  windDirection?: Array<number | null>;
  date: string;
  daily?: DailyData;
  metadata?: {
    cached: boolean;
    cacheAge: number;
    lastUpdated: string;
    performance?: ServerPerformanceMetadata;
  };
  timing?: RequestTiming;
}

export interface DailyData {
  date: string;
  tempMax: number;
  tempMin: number;
  uvMax: number;
  precipMax: number;
  humidityMax: number;
  weatherCode?: number;
  windMax?: number | null;
  gustMax?: number | null;
  windDirection?: number | null;
  metadata?: {
    cached: boolean;
    cacheAge: number;
    lastUpdated: string;
    performance?: ServerPerformanceMetadata;
  };
  timing?: RequestTiming;
}

export interface DailyCalendarDay {
  date: string;
  tempMax: number;
  tempMin: number;
  uvMax: number;
  precipMax: number;
  precipitation: number[];
  cloudCover: number[];
  humidityMax: number;
  weatherCode?: number;
  windMax?: number | null;
  gustMax?: number | null;
  windDirection?: number | null;
}

export interface DailyCalendarData {
  startDate: string;
  endDate: string;
  days: DailyCalendarDay[];
  metadata?: {
    cached: boolean;
    cacheAge: number;
    lastUpdated: string;
    performance?: ServerPerformanceMetadata;
  };
  timing?: RequestTiming;
}

export interface Location {
  lat: number;
  lon: number;
  name: string;
  isUserLocation: boolean;
}

export type LocationSource = 'manual' | 'auto';

export interface SavedLocation {
  id: string; // 2-decimal coord key, e.g. "42.80,-71.30" — matches all cache keying
  lat: number;
  lon: number;
  name: string;
}

export interface SelectedLocation {
  location: Location;
  source: LocationSource;
  timestamp: number;
}

export interface DebugEntry {
  timestamp: string;
  message: string;
  data?: unknown;
  seq: number;
  at: number;
  loadId: string;
  shipped?: boolean;
}

export interface RequestTiming {
  duration: number;
  responseDuration?: number;
  parseDuration?: number;
  cacheWriteDuration?: number;
  cacheStatus?: 'hit' | 'miss' | 'local' | 'unknown' | 'sw-fallback';
  serverTiming?: string | null;
}

export interface ServerPerformanceMetadata {
  totalMs: number;
  phases: Record<string, number>;
}

export interface WeatherHistoryEntry {
  id?: number;
  fetchedAt: string;
  location: Location;
  date: string;
  data: WeatherData;
  statusCode?: number;
  cacheStatus?: string | null;
}

export interface DailyCalendarHistoryEntry {
  id?: number;
  fetchedAt: string;
  location: Location;
  startDate: string;
  data: DailyCalendarData;
  statusCode?: number;
  cacheStatus?: string | null;
}

export interface ApiHistoryResponse<T> {
  entries: Array<{
    id: number;
    fetchedAt: string;
    location: Location;
    date: string;
    data: T;
    statusCode: number;
    cacheStatus?: string | null;
  }>;
}
