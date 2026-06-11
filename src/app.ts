import { WeatherAPI } from './services/api.js';
import { LocationService } from './services/location.js';
import { DebugPanel } from './components/debug.js';
import {
  createUVChart,
  createWeatherChart,
  getForecastTempBackgroundColor,
  getUVColor,
  getTempLineColor,
  type ChartInstance,
} from './utils/charts.js';
import {
  getWeatherArt,
  type WeatherArtDaypart,
  type WeatherArtResult,
} from './utils/weatherArt.js';
import type {
  WeatherData,
  DailyCalendarData,
  DailyCalendarDay,
  DailyCalendarHistoryEntry,
  Location,
  WeatherHistoryEntry,
} from './types/weather.js';

export class SolarSentinelApp {
  private static activeFocusRefreshHandler: (() => void) | null = null;

  private api = new WeatherAPI();
  private locationService = new LocationService();
  private debugPanel!: DebugPanel;

  private currentLocation: Location = this.locationService.getDefaultLocation();
  private currentDate = new Date().toLocaleDateString('en-CA');
  private uvChart: ChartInstance | null = null;
  private weatherChart: ChartInstance | null = null;
  private refreshTimer: number | null = null;
  private chartNowLineTimer: number | null = null;
  private refreshInFlight = false;
  private historyMode = false;
  private weatherHistory: WeatherHistoryEntry[] = [];
  private calendarHistory: DailyCalendarHistoryEntry[] = [];
  private weatherHistoryCache = new Map<
    string,
    { entries: WeatherHistoryEntry[]; loadedAllOlder: boolean }
  >();
  private calendarHistoryCache = new Map<
    string,
    { entries: DailyCalendarHistoryEntry[]; loadedAllOlder: boolean }
  >();
  private latestWeatherData: WeatherData | null = null;
  private latestCalendarData: DailyCalendarData | null = null;
  private historyRefreshPromise: Promise<void> | null = null;
  private pendingHistoryRenderIndex: number | null = null;
  private historyTimeline: string[] = [];
  private forecastArtMode = false;
  private chartRenderToken = 0;
  private readonly appStartTime = performance.now();
  private lastPerformanceMark = this.appStartTime;
  private readonly handleWindowFocus = () => {
    void this.runAutoRefresh('window focus');
  };

  private readonly REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly NOW_LINE_INTERVAL_MS = 60 * 1000; // 1 minute

  async initialize(): Promise<void> {
    this.debugPanel = new DebugPanel();
    this.markPerformance('app-created');
    this.setupEventListeners();
    this.markPerformance('event-listeners-ready');
    await this.loadData();
    this.scheduleAutoRefresh();
    this.markPerformance('initialize-complete');
  }

  private setupEventListeners(): void {
    // App menu
    const menu = document.getElementById('app-menu');
    const menuToggle = document.getElementById('app-menu-toggle');
    menuToggle?.addEventListener('click', () => {
      const isOpen = !menu?.classList.contains('hidden');
      menu?.classList.toggle('hidden', isOpen);
      menuToggle.setAttribute('aria-expanded', String(!isOpen));
    });

    const debugBtn = document.getElementById('debug-btn');
    debugBtn?.addEventListener('click', () => {
      menu?.classList.add('hidden');
      menuToggle?.setAttribute('aria-expanded', 'false');
      this.debugPanel.toggle();
    });

    document.getElementById('environment-toggle')?.addEventListener('click', () => {
      this.switchEnvironment();
    });
    this.updateEnvironmentToggleLabel();

    // Date navigation
    document.getElementById('prev-day')?.addEventListener('click', () => this.navigateDate(-1));
    document.getElementById('next-day')?.addEventListener('click', () => this.navigateDate(1));

    document
      .getElementById('history-toggle')
      ?.addEventListener('click', () => this.toggleHistoryMode());
    document
      .getElementById('history-close')
      ?.addEventListener('click', () => this.exitHistoryMode());
    document.getElementById('history-scrubber')?.addEventListener('input', event => {
      this.scheduleHistoryRender(Number((event.target as HTMLInputElement).value));
    });

    document.getElementById('forecast-calendar')?.addEventListener('click', event => {
      const dayCell = (event.target as HTMLElement).closest<HTMLElement>('[data-forecast-date]');
      if (dayCell?.dataset.forecastDate) {
        this.selectForecastDate(dayCell.dataset.forecastDate);
      }
    });

    document.getElementById('forecast-art-toggle')?.addEventListener('click', () => {
      this.forecastArtMode = !this.forecastArtMode;
      this.updateForecastArtToggle();
      if (this.latestCalendarData) {
        this.renderForecastCalendar(this.latestCalendarData);
      }
    });
  }

  private async loadData(silent = false): Promise<void> {
    const reason = silent ? 'auto-refresh' : 'user-initiated';
    this.markPerformance('load-start', { reason, date: this.currentDate });
    this.debugPanel.log(`Loading UV data for ${this.currentDate}`, { reason });
    let renderedLocalCache = false;
    let requestedCalendar = false;

    try {
      const locationStart = performance.now();
      this.prepareHomeFirstLocation();
      this.refreshLocationInBackground();
      this.updateLocationDisplay();
      this.markPerformance('location-fast-path-ready', {
        durationMs: Math.round(performance.now() - locationStart),
        location: this.currentLocation.name,
      });

      const localCacheStart = performance.now();
      const localData = this.api.getCachedWeatherData(this.currentLocation, this.currentDate);
      this.markPerformance('local-weather-cache-lookup', {
        durationMs: Math.round(performance.now() - localCacheStart),
        hit: Boolean(localData),
      });

      if (localData && !silent) {
        const localRenderStart = performance.now();
        renderedLocalCache = true;
        this.debugPanel.log('Local weather cache hit (0ms)', {
          cacheAge: localData.metadata?.cacheAge,
          lastUpdated: localData.metadata?.lastUpdated,
        });
        this.latestWeatherData = localData;
        this.renderWeatherData(localData, false);
        this.markPerformance('local-weather-cache-rendered', {
          durationMs: Math.round(performance.now() - localRenderStart),
        });
        requestedCalendar = this.requestForecastCalendar(false);
      }

      const apiStart = performance.now();
      const data = await this.api.fetchWeatherData(this.currentLocation, this.currentDate);
      this.latestWeatherData = data;
      this.markPerformance('weather-api-complete', {
        durationMs: Math.round(performance.now() - apiStart),
        responseMs: data.timing?.responseDuration,
        parseMs: data.timing?.parseDuration,
        localCacheWriteMs: data.timing?.cacheWriteDuration,
        cacheStatus: data.timing?.cacheStatus,
        serverTiming: data.timing?.serverTiming,
        serverPerformance: data.metadata?.performance,
      });

      const cacheStatus = data.timing?.cacheStatus || (data.metadata?.cached ? 'hit' : 'miss');
      this.debugPanel.log(`Weather API response: ${cacheStatus} (${data.timing?.duration}ms)`, {
        cached: data.metadata?.cached,
        cacheAge: data.metadata?.cacheAge,
        lastUpdated: data.metadata?.lastUpdated,
        duration: data.timing?.duration,
      });

      const apiRenderStart = performance.now();
      if (!this.historyMode) {
        this.renderWeatherData(data, silent && !renderedLocalCache);
      }
      this.markPerformance('weather-api-rendered', {
        durationMs: Math.round(performance.now() - apiRenderStart),
        silent: silent && !renderedLocalCache,
        skippedForHistory: this.historyMode,
      });
      if (!requestedCalendar) {
        this.requestForecastCalendar(silent && !renderedLocalCache);
      }
    } catch (error) {
      this.markPerformance('load-error', { error: (error as Error).message });
      this.debugPanel.log('Load error', { error: (error as Error).message });

      if (!silent && !renderedLocalCache) {
        document.getElementById('loading')?.style.setProperty('display', 'none');
        document.getElementById('error')?.classList.remove('hidden');
        const errorMessage = document.getElementById('error-message');
        if (errorMessage) {
          errorMessage.textContent = (error as Error).message;
        }
      }
    }
  }

  private prepareHomeFirstLocation(): void {
    if (
      this.currentLocation.isUserLocation &&
      !this.locationService.isHomeLocation(this.currentLocation)
    ) {
      this.debugPanel.log('Location: using active away location', {
        name: this.currentLocation.name,
        coords: `${this.currentLocation.lat.toFixed(4)}, ${this.currentLocation.lon.toFixed(4)}`,
      });
      return;
    }

    const cachedLocation = this.locationService.getCachedLocation();
    this.currentLocation = this.locationService.getDefaultLocation();

    if (cachedLocation && !this.locationService.isHomeLocation(cachedLocation)) {
      this.debugPanel.log('Location: away cache ignored for home-first load', {
        name: cachedLocation.name,
        coords: `${cachedLocation.lat.toFixed(4)}, ${cachedLocation.lon.toFixed(4)}`,
        fallback: this.currentLocation.name,
      });
    } else {
      this.debugPanel.log('Location: home-first default', {
        name: this.currentLocation.name,
        coords: `${this.currentLocation.lat.toFixed(4)}, ${this.currentLocation.lon.toFixed(4)}`,
      });
    }
  }

  private refreshLocationInBackground(): void {
    const locationStartTime = performance.now();
    this.locationService.getCurrentLocation().then(userLocation => {
      const locationEndTime = performance.now();
      const locationDuration = Math.round(locationEndTime - locationStartTime);

      if (userLocation) {
        const latDiff = Math.abs(userLocation.lat - this.currentLocation.lat);
        const lonDiff = Math.abs(userLocation.lon - this.currentLocation.lon);
        const isUserAtHome = this.locationService.isHomeLocation(userLocation);
        const isCurrentAtHome = this.locationService.isHomeLocation(this.currentLocation);
        const hasLocationChanged = isUserAtHome
          ? !isCurrentAtHome
          : latDiff > 0.001 || lonDiff > 0.001;

        if (hasLocationChanged) {
          const nextLocation = isUserAtHome
            ? this.locationService.getDefaultLocation()
            : userLocation;
          this.debugPanel.log(`Location updated (${locationDuration}ms)`, {
            name: nextLocation.name,
            coords: `${nextLocation.lat.toFixed(4)}, ${nextLocation.lon.toFixed(4)}`,
            duration: locationDuration,
            changed: true,
          });

          this.currentLocation = nextLocation;
          this.historyMode = false;
          this.latestWeatherData = null;
          this.latestCalendarData = null;
          this.weatherHistory = [];
          this.calendarHistory = [];
          this.historyTimeline = [];
          this.updateHistoryControls();
          this.updateLocationDisplay();
          this.loadData(true);
        } else {
          this.debugPanel.log(`Location confirmed (${locationDuration}ms)`, {
            name: isUserAtHome ? this.locationService.getDefaultLocation().name : userLocation.name,
            coords: `${userLocation.lat.toFixed(4)}, ${userLocation.lon.toFixed(4)}`,
            duration: locationDuration,
            changed: false,
          });
        }
      } else {
        this.debugPanel.log(`Location failed (${locationDuration}ms)`, {
          fallback: this.currentLocation.name,
          duration: locationDuration,
        });
      }
    });
  }

  private updateLocationDisplay(): void {
    const locationIcon = this.currentLocation.isUserLocation ? '📍 ' : '';
    const locationDisplay = document.getElementById('location-display');
    if (locationDisplay) {
      locationDisplay.textContent = `${locationIcon}${this.currentLocation.name}`;
    }
  }

  private renderWeatherData(data: WeatherData, silent: boolean): void {
    const renderStart = performance.now();

    if (!silent) {
      document.getElementById('loading')?.style.setProperty('display', 'none');
      document.getElementById('current-conditions')?.classList.remove('hidden');
      document.getElementById('chart-container')?.classList.remove('hidden');
      document.getElementById('weather-chart-container')?.classList.remove('hidden');
    }

    const dateObj = new Date(data.date + 'T00:00:00');
    const dateDisplay = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const dateElement = document.getElementById('date-display');
    if (dateElement) {
      dateElement.textContent = dateDisplay;
    }
    this.updateDateNavigationControls();

    if (data.metadata?.lastUpdated) {
      const lastUpdated = new Date(data.metadata.lastUpdated);
      const timeString = lastUpdated.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      this.updateElement('current-time', `Last updated: ${timeString}`);
    }

    this.updateCurrentConditions(data);
    this.updateHistoryControls();
    this.markPerformance('weather-dom-updated', {
      durationMs: Math.round(performance.now() - renderStart),
      date: data.date,
      cacheStatus: data.timing?.cacheStatus,
    });

    void this.renderCharts(data).catch(error => {
      this.markPerformance('charts-error', { error: (error as Error).message });
      this.debugPanel.log('Chart render error', { error: (error as Error).message });
    });
  }

  private updateCurrentConditions(data: WeatherData): void {
    const today = new Date().toLocaleDateString('en-CA');
    const isToday = this.currentDate === today;

    if (isToday) {
      // Show current conditions for today
      document.getElementById('dual-display')?.classList.remove('hidden');
      document.getElementById('single-display')?.classList.add('hidden');

      // Find current hour
      const now = new Date();
      const currentHour = now.getHours();
      let currentIndex = 0;

      for (let i = 0; i < data.labels.length; i++) {
        const hour24 = this.getWeatherHour(data, i) ?? 0;

        if (hour24 === currentHour) {
          currentIndex = i;
          break;
        } else if (hour24 > currentHour) {
          currentIndex = Math.max(0, i - 1);
          break;
        }
      }

      // Update current values
      const temp = Math.round(data.temperature[currentIndex] ?? 0);
      const uvValue = data.uv[currentIndex] ?? 0;
      const uv = uvValue.toFixed(1);
      const precip = Math.round(data.precipitation[currentIndex] ?? 0);
      const humidity = Math.round(data.humidity[currentIndex] ?? 0);
      const currentHourForArt = this.getWeatherHour(data, currentIndex) ?? currentHour;

      this.updateElement('current-temp-dual', `${temp}°F`);
      this.updateElement('current-uv-dual', uv);
      this.updateElement('current-precip-dual', `${precip}%`);
      this.updateElement('current-humidity-dual', `${humidity}%`);

      // Color code values
      this.setElementColor('current-uv-dual', getUVColor(parseFloat(uv)));
      this.setElementColor('current-temp-dual', getTempLineColor(temp));

      this.updateWeatherArtImage(
        'current-weather-art',
        getWeatherArt({
          tempF: temp,
          uv: uvValue,
          precipChance: precip,
          humidity,
          cloudCover: data.cloudCover[currentIndex],
          weatherCode: data.weatherCode?.[currentIndex],
          daypart: this.getWeatherArtDaypart(currentHourForArt),
        })
      );

      // Update today's forecast
      this.updateTodaysForecast(data);
    } else {
      // Show daily summary for future days
      document.getElementById('dual-display')?.classList.add('hidden');
      document.getElementById('single-display')?.classList.remove('hidden');
      this.updateDailySummary(data);
    }
  }

  private updateTodaysForecast(data: WeatherData): void {
    const dailyData = data.daily;

    if (!dailyData) {
      this.debugPanel.log('Today forecast missing from weather response');
      this.hideWeatherArtImage('today-weather-art');
      return;
    }

    const tempHigh = Math.round(dailyData.tempMax || 0);
    const tempLow = Math.round(dailyData.tempMin || 0);
    const uvMax = (dailyData.uvMax || 0).toFixed(1);
    const precipMax = Math.round(dailyData.precipMax || 0);

    this.updateElement('today-temp-dual', `${tempHigh}°/${tempLow}°F`);
    this.updateElement('today-uv-dual', uvMax);
    this.updateElement('today-precip-dual', `${precipMax}%`);

    this.setElementColor('today-uv-dual', getUVColor(parseFloat(uvMax)));
    this.setElementColor('today-temp-dual', getTempLineColor(tempHigh));

    this.updateWeatherArtImage(
      'today-weather-art',
      getWeatherArt({
        tempF: tempHigh,
        uv: dailyData.uvMax,
        precipChance: precipMax,
        humidity: dailyData.humidityMax,
        cloudCover: this.getDaytimeAverage(data.cloudCover, data),
        weatherCode: dailyData.weatherCode,
        daypart: 'day',
      })
    );
  }

  private updateDailySummary(data: WeatherData): void {
    const dailyData = data.daily;

    if (!dailyData) {
      this.debugPanel.log('Daily summary missing from weather response');
      this.hideWeatherArtImage('daily-weather-art');
      return;
    }

    const tempHigh = Math.round(dailyData.tempMax || 0);
    const tempLow = Math.round(dailyData.tempMin || 0);
    const uvMax = (dailyData.uvMax || 0).toFixed(1);
    const precipMax = Math.round(dailyData.precipMax || 0);
    const humidityMax = Math.round(dailyData.humidityMax || 0);

    this.updateElement('current-temp', `${tempHigh}°/${tempLow}°F`);
    this.updateElement('current-uv', uvMax);
    this.updateElement('current-precip', `${precipMax}%`);
    this.updateElement('current-humidity', `${humidityMax}%`);

    this.setElementColor('current-uv', getUVColor(parseFloat(uvMax)));
    this.setElementColor('current-temp', getTempLineColor(tempHigh));

    this.updateWeatherArtImage(
      'daily-weather-art',
      getWeatherArt({
        tempF: tempHigh,
        uv: dailyData.uvMax,
        precipChance: precipMax,
        humidity: dailyData.humidityMax,
        cloudCover: this.getDaytimeAverage(data.cloudCover, data),
        weatherCode: dailyData.weatherCode,
        daypart: 'day',
      })
    );
  }

  private updateWeatherArtImage(elementId: string, art: WeatherArtResult): void {
    const image = document.getElementById(elementId) as HTMLImageElement | null;
    if (!image) return;

    image.classList.add('hidden');
    image.alt = art.alt;
    image.title = art.label;
    image.dataset.weatherArtKey = art.key;
    image.onload = () => {
      image.classList.remove('hidden');
    };
    image.onerror = () => {
      image.classList.add('hidden');
      image.removeAttribute('src');
    };
    image.src = art.path;
  }

  private hideWeatherArtImage(elementId: string): void {
    const image = document.getElementById(elementId) as HTMLImageElement | null;
    if (!image) return;

    image.classList.add('hidden');
    image.removeAttribute('src');
    image.removeAttribute('title');
    delete image.dataset.weatherArtKey;
  }

  private getWeatherArtDaypart(hour: number): WeatherArtDaypart {
    return hour >= 6 && hour < 20 ? 'day' : 'night';
  }

  private getDaytimeAverage(values: number[], data: WeatherData): number | undefined {
    const daytimeValues = values.filter((value, index) => {
      const hour = this.getWeatherHour(data, index);
      return Number.isFinite(value) && hour !== null && hour >= 10 && hour <= 16;
    });
    const relevantValues = daytimeValues.length > 0 ? daytimeValues : values;
    const validValues = relevantValues.filter(value => Number.isFinite(value));

    if (validValues.length === 0) return undefined;
    return validValues.reduce((total, value) => total + value, 0) / validValues.length;
  }

  private getWeatherHour(data: WeatherData, index: number): number | null {
    const timestampHour = data.timestamps?.[index]?.match(/T(\d{2}):/)?.[1];
    if (timestampHour) return parseInt(timestampHour, 10);

    const label = data.labels[index];
    if (!label) return null;

    const hour = parseInt(label.split(':')[0], 10);
    if (!Number.isFinite(hour)) return null;

    const isPM = label.includes('PM');
    if (isPM && hour !== 12) return hour + 12;
    if (!isPM && hour === 12) return 0;
    return hour;
  }

  private async renderCharts(data: WeatherData): Promise<void> {
    const chartStart = performance.now();
    const renderToken = ++this.chartRenderToken;
    this.markPerformance('charts-render-start', { date: data.date, renderToken });

    const destroyStart = performance.now();
    this.clearChartNowLineTimer();
    if (this.uvChart) {
      this.uvChart.destroy();
      this.uvChart = null;
    }
    if (this.weatherChart) {
      this.weatherChart.destroy();
      this.weatherChart = null;
    }
    this.markPerformance('charts-destroyed', {
      durationMs: Math.round(performance.now() - destroyStart),
      renderToken,
    });

    const uvCanvas = document.getElementById('uvChart') as HTMLCanvasElement;
    const weatherCanvas = document.getElementById('weatherChart') as HTMLCanvasElement;

    if (uvCanvas && weatherCanvas) {
      const canvasStart = performance.now();
      uvCanvas.style.width = '100%';
      uvCanvas.style.height = '384px';
      uvCanvas.width = uvCanvas.offsetWidth;
      uvCanvas.height = 384;

      weatherCanvas.style.width = '100%';
      weatherCanvas.style.height = '384px';
      weatherCanvas.width = weatherCanvas.offsetWidth;
      weatherCanvas.height = 384;
      this.markPerformance('chart-canvases-sized', {
        durationMs: Math.round(performance.now() - canvasStart),
        uvWidth: uvCanvas.width,
        weatherWidth: weatherCanvas.width,
        renderToken,
      });

      const chartCreateStart = performance.now();
      const [uvChart, weatherChart] = await Promise.all([
        createUVChart(uvCanvas, data),
        createWeatherChart(weatherCanvas, data),
      ]);
      this.markPerformance('chart-instances-created', {
        durationMs: Math.round(performance.now() - chartCreateStart),
        renderToken,
      });

      if (renderToken !== this.chartRenderToken) {
        uvChart.destroy();
        weatherChart.destroy();
        this.markPerformance('stale-charts-discarded', { renderToken });
        return;
      }

      this.uvChart = uvChart;
      this.weatherChart = weatherChart;
      this.scheduleChartNowLineUpdates(data.date);
      this.markPerformance('charts-render-complete', {
        durationMs: Math.round(performance.now() - chartStart),
        renderToken,
      });
    } else {
      this.markPerformance('charts-render-skipped', {
        reason: 'missing-canvas',
        renderToken,
      });
    }
  }

  private scheduleChartNowLineUpdates(chartDate: string): void {
    this.clearChartNowLineTimer();

    if (chartDate !== new Date().toLocaleDateString('en-CA')) {
      return;
    }

    this.chartNowLineTimer = window.setInterval(() => {
      this.updateChartsNowLine();
    }, this.NOW_LINE_INTERVAL_MS);
  }

  private clearChartNowLineTimer(): void {
    if (this.chartNowLineTimer) {
      clearInterval(this.chartNowLineTimer);
      this.chartNowLineTimer = null;
    }
  }

  private updateChartsNowLine(): void {
    this.uvChart?.update('none');
    this.weatherChart?.update('none');
  }

  private requestForecastCalendar(silent: boolean): boolean {
    if (!document.getElementById('forecast-calendar-container')) {
      return false;
    }

    void this.loadForecastCalendar(silent).catch(error => {
      this.markPerformance('forecast-calendar-error', { error: (error as Error).message });
      this.debugPanel.log('Forecast calendar error', { error: (error as Error).message });
    });
    return true;
  }

  private async loadForecastCalendar(silent: boolean): Promise<void> {
    const startDate = new Date().toLocaleDateString('en-CA');
    const cacheStart = performance.now();
    const cachedCalendar = this.api.getCachedDailyCalendar(this.currentLocation, startDate);
    this.markPerformance('forecast-calendar-cache-lookup', {
      durationMs: Math.round(performance.now() - cacheStart),
      hit: Boolean(cachedCalendar),
      location: this.currentLocation.name,
    });

    if (cachedCalendar && !silent) {
      const renderStart = performance.now();
      this.latestCalendarData = cachedCalendar;
      this.renderForecastCalendar(cachedCalendar);
      this.markPerformance('forecast-calendar-cache-rendered', {
        durationMs: Math.round(performance.now() - renderStart),
        days: cachedCalendar.days.length,
      });
    }

    const apiStart = performance.now();
    const calendar = await this.api.fetchDailyCalendar(this.currentLocation, startDate);
    this.latestCalendarData = calendar;
    this.markPerformance('forecast-calendar-api-complete', {
      durationMs: Math.round(performance.now() - apiStart),
      responseMs: calendar.timing?.responseDuration,
      parseMs: calendar.timing?.parseDuration,
      localCacheWriteMs: calendar.timing?.cacheWriteDuration,
      cacheStatus: calendar.timing?.cacheStatus,
      serverTiming: calendar.timing?.serverTiming,
      days: calendar.days.length,
    });

    const renderStart = performance.now();
    if (!this.historyMode) {
      this.renderForecastCalendar(calendar);
    }
    this.markPerformance('forecast-calendar-api-rendered', {
      durationMs: Math.round(performance.now() - renderStart),
      days: calendar.days.length,
      silent,
      skippedForHistory: this.historyMode,
    });
  }

  private renderForecastCalendar(calendar: DailyCalendarData): void {
    const container = document.getElementById('forecast-calendar-container');
    const calendarElement = document.getElementById('forecast-calendar');
    if (!container || !calendarElement || calendar.days.length === 0) {
      return;
    }

    const previousDayState = this.getForecastCalendarVisualState(calendarElement);

    const leadingCellCount = new Date(calendar.startDate + 'T00:00:00').getDay();
    const totalCells = Math.ceil((leadingCellCount + calendar.days.length) / 7) * 7;
    const trailingCellCount = totalCells - leadingCellCount - calendar.days.length;

    calendarElement.innerHTML = `
      <div class="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
        ${this.getCalendarWeekdayHeaders()
          .map(
            header => `
              <div class="bg-gray-100 text-center text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-600 py-2">
                ${header}
              </div>
            `
          )
          .join('')}
        ${Array.from({ length: leadingCellCount })
          .map(() => '<div class="bg-gray-50 min-h-24 sm:min-h-32"></div>')
          .join('')}
        ${calendar.days.map(day => this.renderForecastCalendarDay(day)).join('')}
        ${Array.from({ length: trailingCellCount })
          .map(() => '<div class="bg-gray-50 min-h-24 sm:min-h-32"></div>')
          .join('')}
      </div>
    `;

    this.updateForecastCalendarMetadata(calendar);
    this.updateForecastArtToggle();
    this.animateForecastCalendarVisualState(calendarElement, previousDayState);
    container.classList.remove('hidden');
  }

  private getForecastCalendarVisualState(
    calendarElement: HTMLElement
  ): Map<string, { tempColor: string }> {
    const state = new Map<string, { tempColor: string }>();

    calendarElement.querySelectorAll<HTMLElement>('[data-forecast-date]').forEach(dayCell => {
      const date = dayCell.dataset.forecastDate;
      if (!date) return;

      state.set(date, {
        tempColor: dayCell.style.getPropertyValue('--forecast-temp-color'),
      });
    });

    return state;
  }

  private animateForecastCalendarVisualState(
    calendarElement: HTMLElement,
    previousDayState: Map<string, { tempColor: string }>
  ): void {
    if (previousDayState.size === 0) return;

    const dayCells = Array.from(
      calendarElement.querySelectorAll<HTMLElement>('[data-forecast-date]')
    );
    const transitions: Array<{
      dayCell: HTMLElement;
      nextTempColor: string;
    }> = [];

    dayCells.forEach(dayCell => {
      const date = dayCell.dataset.forecastDate;
      const previous = date ? previousDayState.get(date) : null;
      if (!previous) return;

      const nextTempColor = dayCell.style.getPropertyValue('--forecast-temp-color');

      dayCell.style.setProperty('--forecast-temp-color', previous.tempColor);
      transitions.push({ dayCell, nextTempColor });
    });

    if (transitions.length === 0) return;

    requestAnimationFrame(() => {
      transitions.forEach(({ dayCell, nextTempColor }) => {
        dayCell.style.setProperty('--forecast-temp-color', nextTempColor);
      });
    });
  }

  private async refreshHistoryState(): Promise<void> {
    const [weatherHistory, calendarHistory, timeline] = await Promise.all([
      this.loadWeatherHistory(this.currentDate),
      this.loadCalendarHistory(),
      this.api.fetchHistoryTimeline(this.currentLocation),
    ]);
    this.weatherHistory = weatherHistory;
    this.calendarHistory = calendarHistory;
    this.historyTimeline = timeline;
    this.updateHistoryControls();
  }

  private async refreshHistoryForDateChange(): Promise<void> {
    try {
      this.weatherHistory = await this.loadWeatherHistory(this.currentDate);
      this.updateHistoryControls();
      const scrubber = document.getElementById('history-scrubber') as HTMLInputElement | null;
      const index = scrubber ? Number(scrubber.value) : this.historyTimeline.length - 1;
      this.renderHistoryAt(index);
    } catch (error) {
      this.debugPanel.log('History date change error', { error: (error as Error).message });
    }
  }

  private async loadWeatherHistory(date: string): Promise<WeatherHistoryEntry[]> {
    const cacheKey = this.getHistoryCacheKey('/api/weather', date);
    const cache = this.weatherHistoryCache.get(cacheKey) || { entries: [], loadedAllOlder: false };

    if (cache.entries.length > 0) {
      const newest = cache.entries[cache.entries.length - 1];
      cache.entries = this.mergeHistoryEntries(
        cache.entries,
        await this.api.fetchWeatherHistory(this.currentLocation, date, {
          after: newest.fetchedAt,
        })
      );
    } else {
      cache.entries = await this.api.fetchWeatherHistory(this.currentLocation, date);
    }

    while (!cache.loadedAllOlder && cache.entries.length > 0) {
      const oldest = cache.entries[0];
      const older = await this.api.fetchWeatherHistory(this.currentLocation, date, {
        before: oldest.fetchedAt,
      });
      cache.entries = this.mergeHistoryEntries(older, cache.entries);
      cache.loadedAllOlder = older.length < 500;
    }

    this.weatherHistoryCache.set(cacheKey, cache);
    return cache.entries;
  }

  private async loadCalendarHistory(): Promise<DailyCalendarHistoryEntry[]> {
    const cacheKey = this.getHistoryCacheKey('/api/daily-calendar');
    const cache = this.calendarHistoryCache.get(cacheKey) || { entries: [], loadedAllOlder: false };

    if (cache.entries.length > 0) {
      const newest = cache.entries[cache.entries.length - 1];
      cache.entries = this.mergeHistoryEntries(
        cache.entries,
        await this.api.fetchDailyCalendarHistory(this.currentLocation, undefined, {
          after: newest.fetchedAt,
        })
      );
    } else {
      cache.entries = await this.api.fetchDailyCalendarHistory(this.currentLocation);
    }

    while (!cache.loadedAllOlder && cache.entries.length > 0) {
      const oldest = cache.entries[0];
      const older = await this.api.fetchDailyCalendarHistory(this.currentLocation, undefined, {
        before: oldest.fetchedAt,
      });
      cache.entries = this.mergeHistoryEntries(older, cache.entries);
      cache.loadedAllOlder = older.length < 500;
    }

    this.calendarHistoryCache.set(cacheKey, cache);
    return cache.entries;
  }

  private mergeHistoryEntries<T extends { id?: number; fetchedAt: string }>(
    existing: T[],
    incoming: T[]
  ): T[] {
    const entriesByKey = new Map<string, T>();
    [...existing, ...incoming].forEach(entry => {
      entriesByKey.set(String(entry.id ?? entry.fetchedAt), entry);
    });
    return [...entriesByKey.values()].sort(
      (a, b) => new Date(a.fetchedAt).getTime() - new Date(b.fetchedAt).getTime()
    );
  }

  private getHistoryCacheKey(route: '/api/weather' | '/api/daily-calendar', date?: string): string {
    return `${route}:${this.currentLocation.lat.toFixed(2)},${this.currentLocation.lon.toFixed(2)}:${date ?? 'all'}`;
  }

  private updateHistoryControls(): void {
    const panel = document.getElementById('history-panel');
    const controls = document.getElementById('history-controls');
    const scrubber = document.getElementById('history-scrubber') as HTMLInputElement | null;
    const status = document.getElementById('history-status');
    const detail = document.getElementById('history-detail');
    const toggle = document.getElementById('history-toggle');

    if (!panel || !controls || !scrubber || !status || !detail || !toggle) return;

    const canLoadHistory = Boolean(this.latestWeatherData);
    const hasHistory = this.historyTimeline.length > 0;
    toggle.classList.toggle('hidden', !canLoadHistory);
    toggle.setAttribute('aria-pressed', String(this.historyMode));
    const historyToggleLabel = this.historyMode
      ? 'Return to current conditions'
      : 'Show condition history';
    toggle.setAttribute('title', historyToggleLabel);
    toggle.setAttribute('aria-label', historyToggleLabel);
    panel.classList.toggle('hidden', !hasHistory || !this.historyMode);
    controls.classList.toggle('hidden', !this.historyMode || this.historyTimeline.length < 2);
    scrubber.max = String(Math.max(0, this.historyTimeline.length - 1));

    if (!this.historyMode) {
      scrubber.value = String(Math.max(0, this.historyTimeline.length - 1));
      status.textContent = '';
      detail.textContent = '';
      return;
    }

    const index = Number(scrubber.value);
    this.updateHistoryLabel(
      index,
      this.getLatestEntryAt(this.weatherHistory, this.historyTimeline[index] ?? '')
    );
  }

  private toggleHistoryMode(): void {
    if (this.historyMode) {
      this.exitHistoryMode();
      return;
    }

    void this.enterHistoryMode().catch(error => {
      this.debugPanel.log('History mode error', { error: (error as Error).message });
    });
  }

  private async enterHistoryMode(): Promise<void> {
    if (!this.historyRefreshPromise) {
      this.historyRefreshPromise = this.refreshHistoryState().finally(() => {
        this.historyRefreshPromise = null;
      });
    }

    await this.historyRefreshPromise;
    if (this.historyTimeline.length === 0) return;

    this.historyMode = true;
    this.updateHistoryControls();
    this.renderHistoryAt(this.historyTimeline.length - 1);
  }

  private exitHistoryMode(): void {
    this.setHistoryUnavailable(false);
    this.historyMode = false;
    this.updateHistoryControls();

    if (this.latestWeatherData) {
      this.renderWeatherData(this.latestWeatherData, false);
    } else {
      void this.loadData(true);
    }

    if (this.latestCalendarData) {
      this.renderForecastCalendar(this.latestCalendarData);
    } else {
      this.requestForecastCalendar(false);
    }
  }

  private scheduleHistoryRender(index: number): void {
    const alreadyScheduled = this.pendingHistoryRenderIndex !== null;
    this.pendingHistoryRenderIndex = index;
    if (alreadyScheduled) return;

    requestAnimationFrame(() => {
      const pending = this.pendingHistoryRenderIndex;
      this.pendingHistoryRenderIndex = null;
      if (pending !== null) {
        this.renderHistoryAt(pending);
      }
    });
  }

  private renderHistoryAt(index: number): void {
    const asOf = this.historyTimeline[index];
    if (!asOf) return;

    const weatherEntry = this.getLatestEntryAt(this.weatherHistory, asOf);
    if (weatherEntry) {
      this.setHistoryUnavailable(false);
      this.renderWeatherData(weatherEntry.data, false);
    } else {
      this.setHistoryUnavailable(true);
    }

    const calendarEntry = this.getLatestEntryAt(this.calendarHistory, asOf);
    if (calendarEntry) {
      this.renderForecastCalendar(calendarEntry.data);
    }
    this.updateHistoryLabel(index, weatherEntry);
  }

  private getLatestEntryAt<T extends { fetchedAt: string }>(entries: T[], asOf: string): T | null {
    let latest: T | null = null;
    for (const entry of entries) {
      if (entry.fetchedAt > asOf) break;
      latest = entry;
    }
    return latest;
  }

  private setHistoryUnavailable(unavailable: boolean): void {
    const notice = document.getElementById('history-unavailable');
    if (!notice) return;
    notice.classList.toggle('hidden', !unavailable);
    if (!unavailable) return;

    const dayLabel = this.parseLocalDate(this.currentDate).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    notice.textContent = `No saved forecast for ${dayLabel} at this point in time.`;
    // Never hide #current-conditions here: it contains the history scrubber,
    // close button, and this notice — hiding it locks the user out of history mode.
    ['dual-display', 'single-display', 'chart-container', 'weather-chart-container'].forEach(id =>
      document.getElementById(id)?.classList.add('hidden')
    );
    this.updateElement('date-display', dayLabel);
    this.updateDateNavigationControls();
  }

  private updateHistoryLabel(index: number, entry?: WeatherHistoryEntry | null): void {
    const asOf = this.historyTimeline[index];
    const status = document.getElementById('history-status');
    const detail = document.getElementById('history-detail');
    const scrubber = document.getElementById('history-scrubber') as HTMLInputElement | null;

    if (!asOf || !status || !detail) return;

    const formatTime = (iso: string) =>
      new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

    status.textContent = `As of ${formatTime(asOf)} (${index + 1}/${this.historyTimeline.length})`;
    detail.textContent = entry
      ? `Forecast recorded ${formatTime(entry.fetchedAt)}`
      : 'Forecast not yet available';
    if (scrubber) {
      scrubber.value = String(index);
    }
  }

  private renderForecastCalendarDay(day: DailyCalendarDay): string {
    const date = new Date(day.date + 'T00:00:00');
    const today = new Date().toLocaleDateString('en-CA');
    const isToday = day.date === today;
    const isSelected = day.date === this.currentDate;
    const { icon, label } = this.getWeatherIcon(day);
    const high = Math.round(day.tempMax);
    const low = Math.round(day.tempMin);
    const precip = Math.max(0, Math.min(100, Math.round(day.precipMax || 0)));
    const cloudCover = this.getForecastDaytimeAverage(day.cloudCover);
    const highColor = getTempLineColor(high);
    const lowColor = getTempLineColor(low);
    const backgroundColor = getForecastTempBackgroundColor(high);
    const art = getWeatherArt({
      tempF: high,
      uv: day.uvMax,
      precipChance: precip,
      humidity: day.humidityMax,
      cloudCover,
      weatherCode: day.weatherCode,
      daypart: 'day',
    });
    const artModeClass = this.forecastArtMode ? 'forecast-day-cell-art text-white' : '';
    const artStyle = this.forecastArtMode ? `background-image: url('${art.path}')` : '';
    const highlightClass = isToday
      ? 'ring-2 ring-blue-500 ring-inset'
      : isSelected
        ? 'ring-2 ring-emerald-500 ring-inset'
        : '';

    return `
      <article class="forecast-day-cell min-h-24 cursor-pointer sm:min-h-32 p-1.5 sm:p-3 ${artModeClass} ${highlightClass}" data-forecast-date="${day.date}" style="--forecast-temp-color: ${backgroundColor}; ${artStyle}">
        ${!this.forecastArtMode ? this.renderForecastCloudCoverGraph(day.cloudCover, cloudCover) : ''}
        ${!this.forecastArtMode ? this.renderForecastPrecipitationGraph(day.precipitation, precip) : ''}
        <div class="forecast-day-content">
          <div class="flex items-start justify-between gap-1">
            <div>
              <div class="text-[10px] sm:text-xs font-semibold text-gray-500">${date.toLocaleDateString('en-US', { month: 'short' })}</div>
              <div class="text-sm sm:text-lg font-bold text-gray-900">${date.getDate()}</div>
            </div>
            ${isToday ? '<span class="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-semibold text-blue-700">Today</span>' : ''}
          </div>
          ${
            this.forecastArtMode
              ? ''
              : `<div class="mt-1 sm:mt-2 flex flex-col items-center text-center">
                  <div class="text-2xl sm:text-3xl leading-none" title="${label}" aria-label="${label}">${icon}</div>
                  <div class="mt-1 text-sm sm:text-base font-bold" style="color: ${highColor}">${high}°</div>
                  <div class="text-[10px] sm:text-xs font-semibold" style="color: ${lowColor}">Low ${low}°</div>
                </div>
                <div class="mt-1 sm:mt-2 flex justify-center text-[10px] sm:text-xs text-gray-600">
                  <span>🌧 ${precip}%</span>
                </div>`
          }
        </div>
      </article>
    `;
  }

  private renderForecastPrecipitationGraph(
    values: number[] | undefined,
    fallbackValue: number
  ): string {
    const precipitation = values && values.length > 0 ? values : [fallbackValue, fallbackValue];
    const width = 100;
    const height = 36;
    const points = precipitation.map((value, index) => {
      const x = precipitation.length === 1 ? width : (index / (precipitation.length - 1)) * width;
      const y = height - (Math.max(0, Math.min(100, value)) / 100) * height;
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    });
    const linePath = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
      .join(' ');
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    const areaPath = `M${firstPoint.x},${height} L${firstPoint.x},${firstPoint.y} ${points
      .slice(1)
      .map(point => `L${point.x},${point.y}`)
      .join(' ')} L${lastPoint.x},${height} Z`;

    return `
      <svg class="forecast-day-precip-graph" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${areaPath}" class="forecast-day-precip-area"></path>
        <path d="${linePath}" class="forecast-day-precip-line"></path>
      </svg>
    `;
  }

  private renderForecastCloudCoverGraph(
    values: number[] | undefined,
    fallbackValue: number
  ): string {
    const cloudCover = values && values.length > 0 ? values : [fallbackValue, fallbackValue];
    const width = 100;
    const height = 36;
    const barWidth = width / cloudCover.length;
    const bars = cloudCover
      .map((value, index) => {
        const boundedValue = Math.max(0, Math.min(100, value));
        const barHeight = (boundedValue / 100) * height;
        return `<rect x="${Math.round(index * barWidth * 10) / 10}" y="${Math.round((height - barHeight) * 10) / 10}" width="${Math.ceil(barWidth * 10) / 10}" height="${Math.round(barHeight * 10) / 10}"></rect>`;
      })
      .join('');

    return `
      <svg class="forecast-day-cloud-graph" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        ${bars}
      </svg>
    `;
  }

  private getForecastDaytimeAverage(values: number[] | undefined): number {
    const candidates = values && values.length >= 17 ? values.slice(10, 17) : values || [];
    const validValues = candidates.filter(value => Number.isFinite(value));

    if (validValues.length === 0) return 0;
    return validValues.reduce((total, value) => total + value, 0) / validValues.length;
  }

  private updateForecastArtToggle(): void {
    const toggle = document.getElementById('forecast-art-toggle');
    if (!toggle) return;

    toggle.setAttribute('aria-pressed', String(this.forecastArtMode));
    toggle.textContent = this.forecastArtMode ? 'Show color backgrounds' : 'Show day images';
    toggle.classList.toggle('border-blue-300', this.forecastArtMode);
    toggle.classList.toggle('bg-blue-50', this.forecastArtMode);
    toggle.classList.toggle('text-blue-700', this.forecastArtMode);
  }

  private selectForecastDate(dateString: string): void {
    if (dateString === this.currentDate) {
      return;
    }

    const date = this.parseLocalDate(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 16);

    if (date < today || date > maxDate) {
      return;
    }

    this.debugPanel.log(`Forecast day selected: ${this.currentDate} → ${dateString}`);
    this.currentDate = dateString;
    this.latestWeatherData = null;
    if (this.historyMode) {
      void this.refreshHistoryForDateChange();
      void this.loadData(true);
    } else {
      this.weatherHistory = [];
      this.updateHistoryControls();
      this.loadData();
    }
  }

  private updateForecastCalendarMetadata(calendar: DailyCalendarData): void {
    const start = new Date(calendar.startDate + 'T00:00:00');
    const end = new Date(calendar.endDate + 'T00:00:00');
    const rangeElement = document.getElementById('forecast-calendar-range');
    const updatedElement = document.getElementById('forecast-calendar-updated');

    if (rangeElement) {
      rangeElement.textContent = `${calendar.days.length}-day outlook, ${start.toLocaleDateString(
        'en-US',
        {
          month: 'short',
          day: 'numeric',
        }
      )}–${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }

    if (updatedElement && calendar.metadata?.lastUpdated) {
      const updated = new Date(calendar.metadata.lastUpdated);
      updatedElement.textContent = `Updated ${updated.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })}`;
    }
  }

  private getCalendarWeekdayHeaders(): string[] {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  }

  private getWeatherIcon(day: DailyCalendarDay): { icon: string; label: string } {
    const code = day.weatherCode;

    if (code === 0) return { icon: '☀️', label: 'Sunny' };
    if (code === 1) return { icon: '🌤️', label: 'Mostly sunny' };
    if (code === 2) return { icon: '⛅', label: 'Partly cloudy' };
    if (code === 3) return { icon: '☁️', label: 'Cloudy' };
    if (code === 45 || code === 48) return { icon: '🌫️', label: 'Fog' };
    if (code && code >= 51 && code <= 57) return { icon: '🌦️', label: 'Drizzle' };
    if (code && code >= 61 && code <= 67) return { icon: '🌧️', label: 'Rain' };
    if (code && code >= 71 && code <= 77) return { icon: '🌨️', label: 'Snow' };
    if (code && code >= 80 && code <= 82) return { icon: '🌦️', label: 'Rain showers' };
    if (code && code >= 85 && code <= 86) return { icon: '🌨️', label: 'Snow showers' };
    if (code && code >= 95) return { icon: '⛈️', label: 'Thunderstorms' };
    if (day.precipMax >= 50) return { icon: '🌧️', label: 'Likely rain' };

    return { icon: '☀️', label: 'Clear' };
  }

  private scheduleAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    this.debugPanel.log('Scheduled 5-min auto-refresh timer');
    if (SolarSentinelApp.activeFocusRefreshHandler) {
      window.removeEventListener('focus', SolarSentinelApp.activeFocusRefreshHandler);
    }

    SolarSentinelApp.activeFocusRefreshHandler = this.handleWindowFocus;
    window.addEventListener('focus', this.handleWindowFocus);

    this.refreshTimer = window.setInterval(async () => {
      await this.runAutoRefresh('timer');
    }, this.REFRESH_INTERVAL_MS);
  }

  private async runAutoRefresh(trigger: string): Promise<void> {
    this.normalizeCurrentDateForRefresh();

    if (this.refreshInFlight) {
      this.debugPanel.log(`Auto-refresh skipped (${trigger}): request in flight`);
      return;
    }

    this.refreshInFlight = true;
    try {
      this.debugPanel.log(`Auto-refresh triggered (${trigger})`);
      await this.loadData(true);
    } finally {
      this.refreshInFlight = false;
    }
  }

  private normalizeCurrentDateForRefresh(): void {
    const todayStr = new Date().toLocaleDateString('en-CA');

    if (this.currentDate < todayStr) {
      this.debugPanel.log(`Date rollover: ${this.currentDate} → ${todayStr}`);
      this.currentDate = todayStr;
      this.historyMode = false;
      this.latestWeatherData = null;
      this.weatherHistory = [];
      this.updateHistoryControls();
    }
  }

  private navigateDate(direction: number): void {
    const [year, month, day] = this.currentDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + direction);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 16);

    if (date >= today && date <= maxDate) {
      const newDate = date.toLocaleDateString('en-CA');
      this.debugPanel.log(`Date navigation: ${this.currentDate} → ${newDate}`, { direction });
      this.currentDate = newDate;
      this.latestWeatherData = null;
      if (this.historyMode) {
        void this.refreshHistoryForDateChange();
        void this.loadData(true);
      } else {
        this.weatherHistory = [];
        this.updateHistoryControls();
        this.loadData();
      }
    }
  }

  private updateDateNavigationControls(): void {
    const selectedDate = this.parseLocalDate(this.currentDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 16);

    document.getElementById('prev-day')?.classList.toggle('hidden', selectedDate <= today);
    document.getElementById('next-day')?.classList.toggle('hidden', selectedDate >= maxDate);
  }

  private switchEnvironment(): void {
    const { hostname, port, pathname, search, hash } = window.location;
    const isDev = port === '45273';
    const targetOrigin = isDev
      ? 'https://solar-sentinel.ackermansoftware.com'
      : `http://${hostname === 'localhost' ? 'localhost' : 'homoiconicity'}:45273`;

    window.location.href = `${targetOrigin}${pathname}${search}${hash}`;
  }

  private updateEnvironmentToggleLabel(): void {
    const button = document.getElementById('environment-toggle');
    if (!button) return;

    button.textContent = window.location.port === '45273' ? 'Switch to prod' : 'Switch to dev';
  }

  private parseLocalDate(dateString: string): Date {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private updateElement(id: string, text: string): void {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = text;
    }
  }

  private setElementColor(id: string, color: string): void {
    const element = document.getElementById(id);
    if (element) {
      element.style.color = color;
    }
  }

  private markPerformance(message: string, data: Record<string, unknown> = {}): void {
    const now = performance.now();
    const payload = {
      totalMs: Math.round(now - this.appStartTime),
      deltaMs: Math.round(now - this.lastPerformanceMark),
      ...data,
    };

    this.lastPerformanceMark = now;
    performance.mark(`solar-sentinel:${message}`);
    this.debugPanel.log(`Perf: ${message}`, payload);
  }
}
