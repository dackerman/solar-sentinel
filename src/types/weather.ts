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

export interface DebugEntry {
  timestamp: string;
  message: string;
  data?: unknown;
}

export interface RequestTiming {
  duration: number;
  responseDuration?: number;
  parseDuration?: number;
  cacheWriteDuration?: number;
  cacheStatus?: 'hit' | 'miss' | 'local' | 'unknown';
  serverTiming?: string | null;
}

export interface ServerPerformanceMetadata {
  totalMs: number;
  phases: Record<string, number>;
}
