export interface WeatherData {
  labels: string[];
  uv: number[];
  uvClearSky: number[];
  precipitation: number[];
  temperature: number[];
  apparentTemperature: number[];
  cloudCover: number[];
  humidity: number[];
  date: string;
  metadata?: {
    cached: boolean;
    cacheAge: number;
    lastUpdated: string;
  };
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
  };
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
  data?: any;
}

export interface RequestTiming {
  duration: number;
  cacheStatus?: 'hit' | 'miss' | 'unknown';
}

export interface RequestTiming {
  duration: number;
  cacheStatus?: 'hit' | 'miss' | 'unknown';
}
