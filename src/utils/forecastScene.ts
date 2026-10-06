import type { Location, WeatherData } from '../types/weather.js';
import type { WeatherSceneState } from '../types/weatherScene.js';
import { clamp } from './weatherScene.js';

const finite = (value: number | null | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function forecastHour(data: WeatherData, index: number): number {
  const stamp = data.timestamps?.[index];
  if (stamp) return Number(stamp.slice(11, 13)) + Number(stamp.slice(14, 16)) / 60;
  const match = data.labels[index]?.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return index % 24;
  const hour = Number(match[1]);
  return (
    (match[3] ? (hour % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0) : hour) +
    Number(match[2] ?? 0) / 60
  );
}

// Older stored snapshots have no timezone; their longitude supplies a stable
// standard-time fallback. New responses always carry Open-Meteo's IANA timezone.
export function locationClock(
  data: WeatherData,
  location: Location,
  now = new Date()
): {
  date: string;
  hour: number;
  offset: number;
} {
  if (data.timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: data.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now);
      const part = (type: string) => parts.find(p => p.type === type)!.value;
      const date = `${part('year')}-${part('month')}-${part('day')}`;
      const hour = Number(part('hour')) + Number(part('minute')) / 60;
      const localMs = Date.parse(`${date}T${part('hour')}:${part('minute')}:00Z`);
      return {
        date,
        hour,
        offset: (localMs - Math.floor(now.getTime() / 60000) * 60000) / 3600000,
      };
    } catch {
      /* Handle obsolete timezone identifiers in stored snapshots. */
    }
  }
  const offset = finite(data.utcOffsetSeconds, Math.round(location.lon / 15) * 3600) / 3600;
  const local = new Date(now.getTime() + offset * 3600000);
  return {
    date: local.toISOString().slice(0, 10),
    hour: local.getUTCHours() + local.getUTCMinutes() / 60,
    offset,
  };
}

export function defaultForecastIndex(
  data: WeatherData,
  location: Location,
  now = new Date()
): number {
  const clock = locationClock(data, location, now);
  const hour = clock.date === data.date ? Math.floor(clock.hour) : 12;
  let best = 0;
  for (let i = 1; i < data.labels.length; i++) {
    if (Math.abs(forecastHour(data, i) - hour) < Math.abs(forecastHour(data, best) - hour))
      best = i;
  }
  return best;
}

// A date/latitude-aware solar elevation gives sunrise, sunset, and polar night.
// Offset is taken at the forecast date so daylight saving changes are respected.
function daylightAt(data: WeatherData, location: Location, hour: number): number {
  const date = new Date(`${data.date}T12:00:00Z`);
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 86400000;
  const radians = Math.PI / 180;
  const declination = 23.44 * Math.sin((360 / 365) * (day - 81) * radians) * radians;
  const b = (360 / 365) * (day - 81) * radians;
  const equation = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const offset = locationClock(data, location, date).offset;
  const solarHour = hour + (4 * (location.lon - 15 * offset) + equation) / 60;
  const angle = (solarHour - 12) * 15 * radians;
  const latitude = location.lat * radians;
  const elevation =
    Math.asin(
      Math.sin(latitude) * Math.sin(declination) +
        Math.cos(latitude) * Math.cos(declination) * Math.cos(angle)
    ) / radians;
  return clamp((elevation + 6) / 12);
}

export function sceneCondition(code: number | undefined, cloud: number, daylight: number): string {
  if (code === 95 || code === 96 || code === 99) return 'Thunderstorms';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'Freezing rain';
  if (code !== undefined && [71, 73, 75, 77, 85, 86].includes(code)) return 'Snowfall';
  if (code !== undefined && code >= 51 && code <= 55) return 'Drizzle';
  if (code !== undefined && [61, 63, 65, 80, 81, 82].includes(code)) return 'Rain';
  if (code === 45 || code === 48) return 'Foggy';
  if (code === 3 || cloud >= 85) return 'Overcast';
  if (code === 2 || cloud >= 25) return 'Partly cloudy';
  return daylight < 0.2 ? 'Clear night' : 'Clear skies';
}

export function forecastScene(
  data: WeatherData,
  location: Location,
  index: number,
  daily = false
): WeatherSceneState {
  const temperature = finite(daily ? data.daily?.tempMax : data.temperature[index], 55);
  const feelsLike = finite(daily ? undefined : data.apparentTemperature[index], temperature);
  const wind = finite(daily ? data.daily?.windMax : data.windSpeed?.[index], 0);
  const gust = finite(daily ? data.daily?.gustMax : data.windGusts?.[index], wind);
  const humidity = clamp(finite(daily ? data.daily?.humidityMax : data.humidity[index], 50) / 100);
  const cloudValues = data.cloudCover.filter(Number.isFinite);
  const cloud = clamp(
    (daily
      ? cloudValues.length
        ? cloudValues.reduce((a, b) => a + b, 0) / cloudValues.length
        : 30
      : finite(data.cloudCover[index], 30)) / 100
  );
  const chance = clamp(finite(daily ? data.daily?.precipMax : data.precipitation[index], 0) / 100);
  const code = daily ? data.daily?.weatherCode : data.weatherCode?.[index];
  // Probability is kept separate from intensity. WMO codes describe the
  // expected precipitation; cold temperature alone never creates snow cover.
  const intensities: Record<number, number> = {
    51: 0.15,
    53: 0.3,
    55: 0.5,
    56: 0.2,
    57: 0.5,
    61: 0.25,
    63: 0.6,
    65: 1,
    66: 0.3,
    67: 0.7,
    71: 0.2,
    73: 0.5,
    75: 1,
    77: 0.15,
    80: 0.3,
    81: 0.65,
    82: 1,
    85: 0.3,
    86: 0.8,
    95: 0.65,
    96: 0.8,
    99: 1,
  };
  const intensity = code === undefined ? 0 : (intensities[code] ?? 0);
  const isSnow = code !== undefined && [71, 73, 75, 77, 85, 86].includes(code);
  const direction =
    (finite(daily ? data.daily?.windDirection : data.windDirection?.[index], 270) * Math.PI) / 180;
  const hour = daily ? 12 : forecastHour(data, index);
  return {
    temperature,
    feelsLike,
    humidity,
    cloud,
    chance,
    rain: isSnow ? 0 : intensity,
    snow: isSnow ? intensity : 0,
    snowCover: 0, // No ground-depth measurements in the existing forecast contract.
    wind,
    gust,
    windX: -Math.sin(direction),
    windZ: Math.cos(direction),
    daylight: daylightAt(data, location, hour),
    hour,
    heat: clamp((Math.max(temperature, feelsLike) - 80) / 20) * (0.4 + humidity * 0.6),
    fog: code === 45 || code === 48 ? 0.65 : 0,
  };
}
