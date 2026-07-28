export type WeatherArtDaypart = 'day' | 'night';
export type WeatherArtTempBand = 'freezing' | 'cold' | 'cool' | 'mild' | 'warm' | 'hot';
export type WeatherArtHumidityFeel = 'dry' | 'comfortable' | 'humid';

export interface WeatherArtInput {
  tempF: number;
  uv?: number;
  precipChance?: number;
  humidity?: number;
  cloudCover?: number;
  weatherCode?: number;
  daypart?: WeatherArtDaypart;
}

export interface WeatherArtResult {
  key: string;
  path: string;
  label: string;
  alt: string;
  bins: {
    daypart: WeatherArtDaypart;
    tempBand: WeatherArtTempBand;
    humidityFeel?: WeatherArtHumidityFeel;
    condition: string;
  };
}

export declare function getWeatherArt(input: WeatherArtInput): WeatherArtResult;
export declare function getWeatherArtTempBand(tempF: number): WeatherArtTempBand;
