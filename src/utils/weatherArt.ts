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

const WEATHER_ART_BASE_PATH = '/weather-art/v2';
const HUMIDITY_TEMP_BANDS = new Set<WeatherArtTempBand>(['mild', 'warm', 'hot']);

const CONDITION_LABELS: Record<string, string> = {
  'clear-low-uv': 'clear, low UV',
  'clear-moderate-uv': 'clear, moderate UV',
  'clear-high-uv': 'clear, high UV',
  'partly-low-uv': 'partly cloudy, low UV',
  'partly-moderate-uv': 'partly cloudy, moderate UV',
  'partly-high-uv': 'partly cloudy, high UV',
  'mostly-cloudy-low-uv': 'mostly cloudy, low UV',
  'mostly-cloudy-bright': 'mostly cloudy but bright',
  'overcast-low-uv': 'overcast, low UV',
  'overcast-bright': 'overcast but bright',
  'chance-sunshowers': 'chance of sunshowers',
  'chance-gloomy': 'chance of gloomy rain',
  rain: 'rain',
  storm: 'thunderstorm',
  snow: 'snow',
  'wintry-mix': 'wintry mix',
  'fog-haze': 'fog or haze',
  clear: 'clear night',
  'partly-cloudy': 'partly cloudy night',
  cloudy: 'cloudy night',
};

export function getWeatherArt(input: WeatherArtInput): WeatherArtResult {
  const daypart = input.daypart ?? 'day';
  const tempBand = getWeatherArtTempBand(input.tempF);
  const classification =
    daypart === 'night'
      ? classifyNightWeather(input, tempBand)
      : classifyDayWeather(input, tempBand);
  const key = buildWeatherArtKey(daypart, tempBand, classification);
  const label = getWeatherArtLabel(daypart, tempBand, classification);

  return {
    key,
    path: `${WEATHER_ART_BASE_PATH}/${key}.webp`,
    label,
    alt: `Weather art: ${label}`,
    bins: {
      daypart,
      tempBand,
      humidityFeel: classification.humidityFeel,
      condition: classification.condition,
    },
  };
}

export function getWeatherArtTempBand(tempF: number): WeatherArtTempBand {
  if (tempF <= 32) return 'freezing';
  if (tempF <= 44) return 'cold';
  if (tempF <= 59) return 'cool';
  if (tempF <= 72) return 'mild';
  if (tempF <= 84) return 'warm';
  return 'hot';
}

interface WeatherArtClassification {
  condition: string;
  humidityFeel?: WeatherArtHumidityFeel;
}

function classifyDayWeather(
  input: WeatherArtInput,
  tempBand: WeatherArtTempBand
): WeatherArtClassification {
  if (isFogWeather(input)) return { condition: 'fog-haze' };

  const precipKind = getActivePrecipKind(input, tempBand);
  if (precipKind !== 'none') {
    return { condition: getDayActivePrecipCondition(precipKind, tempBand) };
  }

  if (getValue(input.precipChance) >= 25) {
    const condition = getValue(input.cloudCover) <= 60 ? 'chance-sunshowers' : 'chance-gloomy';
    const humidityFeel = HUMIDITY_TEMP_BANDS.has(tempBand)
      ? getChancePrecipHumidityFeel(input.humidity)
      : undefined;

    return { condition, humidityFeel };
  }

  return {
    condition: getDryDaySkyUvCondition(input.cloudCover, input.uv),
    humidityFeel: HUMIDITY_TEMP_BANDS.has(tempBand) ? getHumidityFeel(input.humidity) : undefined,
  };
}

function classifyNightWeather(
  input: WeatherArtInput,
  tempBand: WeatherArtTempBand
): WeatherArtClassification {
  if (isFogWeather(input)) return { condition: 'fog-haze' };

  const precipKind = getActivePrecipKind(input, tempBand);
  if (precipKind !== 'none') {
    return { condition: getNightActivePrecipCondition(precipKind, tempBand) };
  }

  return { condition: getNightSkyCondition(input.cloudCover) };
}

function getDryDaySkyUvCondition(cloudCover?: number, uv?: number): string {
  const cloud = getValue(cloudCover);
  const uvValue = getValue(uv);
  const uvBand = uvValue <= 2 ? 'low-uv' : uvValue <= 5 ? 'moderate-uv' : 'high-uv';

  if (cloud <= 20) return `clear-${uvBand}`;
  if (cloud <= 50) return `partly-${uvBand}`;
  if (cloud <= 80) return uvValue <= 2 ? 'mostly-cloudy-low-uv' : 'mostly-cloudy-bright';
  return uvValue <= 2 ? 'overcast-low-uv' : 'overcast-bright';
}

function getNightSkyCondition(cloudCover?: number): string {
  const cloud = getValue(cloudCover);
  if (cloud <= 25) return 'clear';
  if (cloud <= 70) return 'partly-cloudy';
  return 'cloudy';
}

function getHumidityFeel(humidity?: number): WeatherArtHumidityFeel {
  const humidityValue = getValue(humidity, 50);
  if (humidityValue < 35) return 'dry';
  if (humidityValue >= 70) return 'humid';
  return 'comfortable';
}

function getChancePrecipHumidityFeel(humidity?: number): WeatherArtHumidityFeel {
  return getValue(humidity, 50) >= 70 ? 'humid' : 'comfortable';
}

function getActivePrecipKind(
  input: WeatherArtInput,
  tempBand: WeatherArtTempBand
): 'none' | 'rain' | 'snow' | 'storm' {
  const code = input.weatherCode;

  if (isThunderstormCode(code)) return 'storm';
  if (isSnowCode(code)) return 'snow';
  if (isRainCode(code)) return 'rain';

  if (getValue(input.precipChance) >= 55) {
    return tempBand === 'freezing' ? 'snow' : 'rain';
  }

  return 'none';
}

function getDayActivePrecipCondition(
  precipKind: 'rain' | 'snow' | 'storm',
  tempBand: WeatherArtTempBand
): string {
  if (tempBand === 'freezing') return precipKind === 'snow' ? 'snow' : 'wintry-mix';
  if (tempBand === 'cold') return precipKind === 'rain' ? 'rain' : 'wintry-mix';
  if (precipKind === 'storm') return 'storm';
  return 'rain';
}

function getNightActivePrecipCondition(
  precipKind: 'rain' | 'snow' | 'storm',
  tempBand: WeatherArtTempBand
): string {
  if (tempBand === 'freezing') return 'snow';
  if (tempBand === 'cold')
    return precipKind === 'snow' || precipKind === 'storm' ? 'wintry-mix' : 'rain';
  if (precipKind === 'storm') return 'storm';
  return 'rain';
}

function isFogWeather(input: WeatherArtInput): boolean {
  return input.weatherCode === 45 || input.weatherCode === 48;
}

function isRainCode(code?: number): boolean {
  if (code === undefined) return false;
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
}

function isSnowCode(code?: number): boolean {
  if (code === undefined) return false;
  return (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
}

function isThunderstormCode(code?: number): boolean {
  return code !== undefined && code >= 95;
}

function buildWeatherArtKey(
  daypart: WeatherArtDaypart,
  tempBand: WeatherArtTempBand,
  classification: WeatherArtClassification
): string {
  const parts: string[] = [daypart, tempBand];
  if (classification.humidityFeel) parts.push(classification.humidityFeel);
  parts.push(classification.condition);
  return parts.join('-');
}

function getWeatherArtLabel(
  daypart: WeatherArtDaypart,
  tempBand: WeatherArtTempBand,
  classification: WeatherArtClassification
): string {
  const humidity = classification.humidityFeel ? `${classification.humidityFeel} ` : '';
  const condition = CONDITION_LABELS[classification.condition] ?? classification.condition;
  return `${daypart} ${tempBand} ${humidity}${condition}`;
}

function getValue(value: number | undefined, fallback = 0): number {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}
