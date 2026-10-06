import type { Location, WeatherData } from '../types/weather.js';
import type { WeatherSceneRenderer, WeatherSceneState } from '../types/weatherScene.js';
import {
  defaultForecastIndex,
  forecastHour,
  forecastScene,
  locationClock,
  sceneCondition,
} from '../utils/forecastScene.js';
import { degreesToCardinal, formatGustSuffix, formatWindSpeed } from '../utils/wind.js';
import { SceneParallax } from './sceneParallax.js';

const MINIMIZED_KEY = 'solar_sentinel_weather_scene_minimized';
const text = (id: string, value: string): void => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};
const numberText = (value: number | null | undefined, suffix = '', decimals = 0): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(decimals)}${suffix}` : '—';

export class WeatherHero {
  private renderer: WeatherSceneRenderer | null = null;
  private parallax: SceneParallax | null = null;
  private data: WeatherData | null = null;
  private location: Location | null = null;
  private state: WeatherSceneState | null = null;
  private index = 0;
  private dayOverview = false;
  private followingNow = true;
  private minimized = false;
  private motionPaused = false;
  private visible = true;
  private loading = false;
  private unavailable = false;
  private readonly root: HTMLElement;
  private readonly scrubber: HTMLInputElement;
  private readonly observer: IntersectionObserver;

  constructor(
    private readonly host: HTMLElement,
    private readonly log: (message: string, data?: unknown) => void
  ) {
    this.root = host.closest<HTMLElement>('#current-conditions')!;
    this.scrubber = document.getElementById('scene-hour') as HTMLInputElement;
    try {
      this.minimized = localStorage.getItem(MINIMIZED_KEY) === 'true';
    } catch {
      /* Storage is optional. */
    }
    this.applySize();
    document.getElementById('scene-toggle')?.addEventListener('click', () => {
      this.minimized = !this.minimized;
      try {
        localStorage.setItem(MINIMIZED_KEY, String(this.minimized));
      } catch {
        /* Keep the control usable. */
      }
      this.applySize();
      this.syncActivity();
      if (!this.minimized) void this.loadRenderer();
    });
    this.scrubber.addEventListener('input', () => {
      this.index = Number(this.scrubber.value);
      this.followingNow = false;
      this.dayOverview = false;
      this.render();
    });
    document.getElementById('scene-now')?.addEventListener('click', () => {
      if (!this.data || !this.location) return;
      this.index = defaultForecastIndex(this.data, this.location);
      this.followingNow = true;
      this.dayOverview = false;
      this.render();
    });
    document.getElementById('scene-overview')?.addEventListener('click', () => {
      this.dayOverview = !this.dayOverview;
      this.followingNow = !this.dayOverview;
      if (!this.dayOverview && this.data && this.location)
        this.index = defaultForecastIndex(this.data, this.location);
      this.render();
    });
    document.getElementById('scene-motion')?.addEventListener('click', () => {
      this.motionPaused = !this.motionPaused;
      const button = document.getElementById('scene-motion')!;
      button.setAttribute('aria-pressed', String(this.motionPaused));
      button.setAttribute(
        'aria-label',
        this.motionPaused ? 'Resume scene animation' : 'Pause scene animation'
      );
      button.title = this.motionPaused ? 'Resume animation' : 'Pause animation';
      button.textContent = this.motionPaused ? '▷' : 'Ⅱ';
      this.renderer?.setMotionPaused(this.motionPaused);
      this.syncActivity();
    });
    this.observer = new IntersectionObserver(entries => {
      this.visible = entries[0].isIntersecting;
      this.syncActivity();
      if (this.visible) void this.loadRenderer();
    });
    this.observer.observe(this.root);
    document.addEventListener('visibilitychange', this.syncActivity);
    // Current-hour mode follows the location's clock even between API refreshes.
    window.setInterval(() => {
      if (!document.hidden && this.followingNow && this.data && this.location) {
        const index = defaultForecastIndex(this.data, this.location);
        if (index !== this.index) {
          this.index = index;
          this.render();
        }
      }
    }, 60000);
  }

  update(data: WeatherData, location: Location): void {
    const changed =
      this.data?.date !== data.date ||
      this.location?.lat !== location.lat ||
      this.location?.lon !== location.lon;
    this.data = data;
    this.location = location;
    if (changed) {
      this.followingNow = true;
      this.dayOverview = false;
    }
    if (this.followingNow) this.index = defaultForecastIndex(data, location);
    this.index = Math.max(0, Math.min(this.index, data.labels.length - 1));
    if (!data.labels.length) this.dayOverview = true;
    this.scrubber.max = String(Math.max(0, data.labels.length - 1));
    this.scrubber.disabled = data.labels.length < 2;
    this.render();
    // A full paint gets to finish before any Three.js parsing or model work.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void this.loadRenderer();
      })
    );
  }

  setUnavailable(unavailable: boolean): void {
    this.root.classList.toggle('history-empty', unavailable);
    this.syncActivity();
  }

  private applySize(): void {
    this.root.classList.toggle('is-minimized', this.minimized);
    const button = document.getElementById('scene-toggle');
    button?.setAttribute('aria-expanded', String(!this.minimized));
    if (button)
      button.innerHTML = this.minimized
        ? 'Expand scene <span aria-hidden="true">↙</span>'
        : 'Minimize <span aria-hidden="true">↗</span>';
    this.host.setAttribute('aria-hidden', String(this.minimized));
  }

  private readonly syncActivity = (): void => {
    const active =
      !document.hidden &&
      this.visible &&
      !this.minimized &&
      !this.root.classList.contains('hidden') &&
      !this.root.classList.contains('history-empty');
    this.renderer?.setPaused(!active);
    this.parallax?.setActive(active && !this.motionPaused);
  };

  private async loadRenderer(): Promise<void> {
    if (
      this.renderer ||
      this.loading ||
      this.unavailable ||
      !this.state ||
      this.minimized ||
      !this.visible ||
      document.hidden
    )
      return;
    this.loading = true;
    const start = performance.now();
    try {
      const { createWeatherScene } = await import('../scene/weatherScene.js');
      // A location/date/scrub change during the import uses the latest state.
      if (this.minimized || !this.visible || document.hidden) return;
      this.renderer = createWeatherScene(
        this.host,
        this.state,
        message => this.showStatus(message),
        undefined,
        false
      );
      this.renderer.setMotionPaused(this.motionPaused);
      this.parallax = new SceneParallax(
        this.root,
        document.getElementById('scene-tilt') as HTMLButtonElement,
        (x, y) => this.renderer?.setParallax(x, y),
        this.log
      );
      this.syncActivity();
      this.root.classList.add('scene-ready');
      this.log('Perf: weather scene ready', { durationMs: Math.round(performance.now() - start) });
    } catch (error) {
      this.unavailable = true;
      this.showStatus('The animated view is unavailable. Your forecast is still here.');
      this.log('Weather scene unavailable', { error: (error as Error).message });
    } finally {
      this.loading = false;
    }
  }

  private showStatus(message: string): void {
    const status = document.getElementById('scene-status');
    if (status) {
      status.textContent = message;
      status.hidden = !message;
    }
  }

  private render(): void {
    if (!this.data || !this.location) return;
    const data = this.data;
    const daily = this.dayOverview;
    const state = forecastScene(data, this.location, this.index, daily);
    this.state = state;
    this.renderer?.setWeather(state);
    this.scrubber.value = String(this.index);
    const clock = locationClock(data, this.location);
    const isToday = data.date === clock.date;
    const hour = forecastHour(data, this.index);
    const hourLabel = `${Math.floor(hour) % 12 || 12}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
    const atNow = !daily && this.followingNow && isToday;
    const period = daily
      ? 'Day overview'
      : atNow
        ? `Right now · ${hourLabel}`
        : `Hourly forecast · ${hourLabel}`;
    text('scene-period', period);
    text('scene-location', this.location.name.replace(/^📍\s*/, ''));
    text(
      'scene-temperature',
      numberText(daily ? data.daily?.tempMax : data.temperature[this.index])
    );
    text('scene-feels', numberText(daily ? undefined : data.apparentTemperature[this.index], '°'));
    this.root.classList.toggle('is-daily', daily);
    const code = daily ? data.daily?.weatherCode : data.weatherCode?.[this.index];
    const condition = sceneCondition(code, state.cloud * 100, state.daylight);
    text('scene-condition', condition);
    text(
      'scene-range',
      data.daily
        ? `H ${numberText(data.daily.tempMax, '°')}  ·  L ${numberText(data.daily.tempMin, '°')}`
        : ''
    );
    const wind = daily ? data.daily?.windMax : data.windSpeed?.[this.index];
    const gust = daily ? data.daily?.gustMax : data.windGusts?.[this.index];
    const direction = degreesToCardinal(
      daily ? data.daily?.windDirection : data.windDirection?.[this.index]
    );
    text('scene-wind', `${formatWindSpeed(wind)}${direction ? ` ${direction}` : ''}`);
    text('scene-gust', formatGustSuffix(wind, gust) ?? '');
    text(
      'scene-precip',
      numberText(daily ? data.daily?.precipMax : data.precipitation[this.index], '%')
    );
    text(
      'scene-cloud',
      `${numberText(daily ? state.cloud * 100 : data.cloudCover[this.index], '%')} cloud cover`
    );
    text(
      'scene-humidity',
      numberText(daily ? data.daily?.humidityMax : data.humidity[this.index], '%')
    );
    text(
      'scene-humidity-feel',
      daily
        ? 'Daily maximum'
        : state.humidity > 0.7
          ? 'Humid air'
          : state.humidity < 0.3
            ? 'Dry air'
            : ''
    );
    const uv = daily ? data.daily?.uvMax : data.uv[this.index];
    text('scene-uv', numberText(uv, '', 1));
    text(
      'scene-uv-label',
      uv === undefined
        ? ''
        : uv < 3
          ? 'Low'
          : uv < 6
            ? 'Moderate'
            : uv < 8
              ? 'High'
              : uv < 11
                ? 'Very high'
                : 'Extreme'
    );
    text(
      'scene-hour-label',
      daily
        ? 'Daily summary'
        : `${hourLabel}${data.timezone ? ` · ${data.timezone.split('/').pop()!.replace(/_/g, ' ')}` : ''}`
    );
    this.scrubber.setAttribute(
      'aria-valuetext',
      `${hourLabel}, ${condition}, ${numberText(data.temperature[this.index], ' degrees Fahrenheit')}`
    );
    this.scrubber.style.setProperty(
      '--progress',
      `${(this.index / Math.max(1, data.labels.length - 1)) * 100}%`
    );
    const nowButton = document.getElementById('scene-now');
    if (nowButton) {
      nowButton.textContent = isToday ? 'Back to now' : 'Midday';
      (nowButton as HTMLButtonElement).disabled = atNow;
    }
    document.getElementById('scene-overview')?.setAttribute('aria-pressed', String(daily));
    this.root.style.setProperty(
      '--hero-sky',
      state.daylight < 0.2 ? '#172b4e' : state.cloud > 0.75 ? '#788d9f' : '#9cbed4'
    );
    this.host.setAttribute(
      'aria-label',
      `A weather village depicting ${condition.toLowerCase()}, ${period.toLowerCase()}, ${this.location.name}. ${numberText(daily ? data.daily?.tempMax : data.temperature[this.index], ' degrees Fahrenheit')}.`
    );
  }
}
