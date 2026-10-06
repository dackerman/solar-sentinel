import { createWeatherScene } from './weatherScene.js';
import { clamp } from '../utils/weatherScene.js';
import type {
  WeatherSceneRenderer,
  WeatherSceneState,
  WeatherSceneView,
} from '../types/weatherScene.js';

interface DemoPreset {
  label: string;
  description: string;
  temp: number;
  wind: number;
  precip: number;
  cloud: number;
  humidity: number;
  hour: number;
  snowCover: number;
}
const presets: Record<string, DemoPreset> = {
  autumn: {
    label: 'Autumn breeze',
    description: 'Sunny & windy',
    temp: 52,
    wind: 18,
    precip: 0,
    cloud: 18,
    humidity: 39,
    hour: 14,
    snowCover: 0,
  },
  lightSnow: {
    label: 'Light snow',
    description: 'A few flurries, a little dusting',
    temp: 30,
    wind: 5,
    precip: 18,
    cloud: 72,
    humidity: 73,
    hour: 13,
    snowCover: 0.025,
  },
  blizzard: {
    label: 'Blizzard',
    description: 'A foot of snow, blowing white',
    temp: 21,
    wind: 40,
    precip: 100,
    cloud: 100,
    humidity: 95,
    hour: 13,
    snowCover: 1,
  },
  snow: {
    label: 'Snow day',
    description: 'Cold & snowy',
    temp: 28,
    wind: 12,
    precip: 75,
    cloud: 62,
    humidity: 76,
    hour: 13,
    snowCover: 0.42,
  },
  summer: {
    label: 'Summer heat',
    description: 'Hot & humid',
    temp: 88,
    wind: 8,
    precip: 0,
    cloud: 12,
    humidity: 78,
    hour: 14,
    snowCover: 0,
  },
  rain: {
    label: 'Rainy evening',
    description: 'A little shelter from the rain',
    temp: 58,
    wind: 14,
    precip: 85,
    cloud: 95,
    humidity: 88,
    hour: 18.5,
    snowCover: 0,
  },
  night: {
    label: 'Clear night',
    description: 'Under the village lights',
    temp: 48,
    wind: 4,
    precip: 0,
    cloud: 8,
    humidity: 55,
    hour: 23,
    snowCover: 0,
  },
};
const controls = ['temp', 'wind', 'precip', 'cloud', 'humidity', 'hour', 'snowCover'] as const;
let selected = 'autumn';
let userPaused = false;
let inView = true;
let renderer: WeatherSceneRenderer | null = null;
const host = document.getElementById('scene')!;
const status = document.getElementById('scene-status')!;
const retry = document.getElementById('retry')!;
const cameraSettings = document.getElementById('camera-settings') as HTMLTextAreaElement;
function showCamera(settings: ReturnType<WeatherSceneRenderer['getCamera']>): void {
  const precise = (values: number[]) => values.map(value => Number(value.toFixed(6)));
  cameraSettings.value = JSON.stringify(
    {
      position: precise(settings.position),
      target: precise(settings.target),
      rotation: precise(settings.rotation),
      fov: settings.fov,
      aspect: Number(settings.aspect.toFixed(6)),
    },
    null,
    2
  );
}
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const text = (id: string, value: string) => {
  document.getElementById(id)!.textContent = value;
};

function state(): WeatherSceneState {
  const temp = Number(input('temp').value);
  const wind = Number(input('wind').value);
  const precip = Number(input('precip').value) / 100;
  const cloud = Number(input('cloud').value) / 100;
  const humidity = Number(input('humidity').value) / 100;
  const hour = Number(input('hour').value);
  const feelsLike = temp + (temp > 80 ? humidity * 8 : -wind * 0.18);
  const daylight = clamp((hour - 5.5) / 1.3) * (1 - clamp((hour - 18) / 1.5));
  return {
    temperature: temp,
    feelsLike,
    humidity,
    cloud,
    chance: precip,
    rain: temp > 32 ? precip : 0,
    snow: temp <= 32 ? precip : 0,
    snowCover: Number(input('snowCover').value) / 12,
    wind,
    gust: wind * 1.4,
    windX: 0.95,
    windZ: 0.15,
    daylight,
    hour,
    heat: clamp((Math.max(temp, feelsLike) - 80) / 20) * (0.4 + humidity * 0.6),
    fog: temp <= 32 ? Math.pow(precip, 3) * 0.65 : 0,
  };
}
function update(): void {
  const s = state();
  renderer?.setWeather(s);
  text('temperature', `${Math.round(s.temperature)}°`);
  text('wind-value', `${Math.round(s.wind)} mph wind`);
  text('humidity-value', `${Math.round(s.humidity * 100)}% humidity`);
  text('temp-output', `${Math.round(s.temperature)}°F`);
  text('wind-output', `${Math.round(s.wind)} mph`);
  text(
    'precip-output',
    s.rain + s.snow ? `${Math.round((s.rain + s.snow) * 100)}% ${s.snow ? 'snow' : 'rain'}` : 'None'
  );
  text('snowCover-output', `${Number(input('snowCover').value).toFixed(1)} in`);
  text('cloud-output', `${Math.round(s.cloud * 100)}%`);
  text('humidity-output', `${Math.round(s.humidity * 100)}%`);
  const minutes = Math.round(s.hour * 60);
  text(
    'hour-output',
    `${Math.floor(minutes / 60) % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${s.hour >= 12 ? 'PM' : 'AM'}`
  );
  host.setAttribute(
    'aria-label',
    `${presets[selected].label}, ${Math.round(s.temperature)} degrees Fahrenheit, wind ${Math.round(s.wind)} miles per hour. A village street.`
  );
}
function applyPreset(key: string): void {
  selected = key;
  const preset = presets[key];
  for (const id of controls)
    input(id).value = String(id === 'snowCover' ? preset.snowCover * 12 : preset[id]);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]'))
    button.setAttribute('aria-pressed', String(button.dataset.preset === key));
  text('forecast-label', preset.label);
  text('description', preset.description);
  update();
}
function syncPause(): void {
  renderer?.setPaused(document.hidden || !inView);
  renderer?.setMotionPaused(userPaused);
}
function boot(): void {
  renderer?.dispose();
  renderer = null;
  try {
    renderer = createWeatherScene(
      host,
      state(),
      message => {
        status.textContent = message;
        retry.hidden = !message;
      },
      showCamera
    );
    renderer.setCameraView(
      (document.getElementById('camera-view') as HTMLSelectElement).value as WeatherSceneView
    );
    status.textContent = '';
    retry.hidden = true;
    syncPause();
  } catch (error) {
    status.textContent =
      '3D graphics are unavailable. Try another browser or enable hardware acceleration.';
    retry.hidden = false;
    console.error(error);
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]'))
  button.addEventListener('click', () => applyPreset(button.dataset.preset!));
for (const id of controls)
  input(id).addEventListener('input', () => {
    text('forecast-label', 'Your weather mix');
    text('description', 'Same world, a different kind of day');
    for (const button of document.querySelectorAll('[data-preset]'))
      button.setAttribute('aria-pressed', 'false');
    update();
  });
document.getElementById('motion-toggle')!.addEventListener('click', event => {
  userPaused = !userPaused;
  const button = event.currentTarget as HTMLButtonElement;
  button.textContent = userPaused ? 'Resume motion' : 'Pause motion';
  button.setAttribute('aria-pressed', String(userPaused));
  syncPause();
});
retry.addEventListener('click', boot);
document.getElementById('camera-view')!.addEventListener('change', event => {
  renderer?.setCameraView((event.target as HTMLSelectElement).value as WeatherSceneView);
});
document.getElementById('camera-reset')!.addEventListener('click', () => renderer?.resetCamera());
document.getElementById('camera-copy')!.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(cameraSettings.value);
    text('camera-copy-status', 'Copied—paste these settings into the chat.');
  } catch {
    cameraSettings.focus();
    cameraSettings.select();
    text('camera-copy-status', 'Settings selected. Press Ctrl+C or ⌘C, then paste into the chat.');
  }
});
document.addEventListener('visibilitychange', syncPause);
const observer = new IntersectionObserver(entries => {
  inView = entries[0]?.isIntersecting ?? false;
  syncPause();
});
observer.observe(host);
window.addEventListener('pagehide', event => {
  if (!event.persisted) {
    observer.disconnect();
    renderer?.dispose();
  }
});
applyPreset('autumn');
requestAnimationFrame(boot);
