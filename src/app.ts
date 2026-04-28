import { WeatherAPI } from './services/api.js';
import { LocationService } from './services/location.js';
import { DebugPanel } from './components/debug.js';
import { createUVChart, createWeatherChart, getUVColor, getTempLineColor } from './utils/charts.js';
import type {
  WeatherData,
  DailyData,
  DailyCalendarData,
  DailyCalendarDay,
  Location,
} from './types/weather.js';

export class SolarSentinelApp {
  private api = new WeatherAPI();
  private locationService = new LocationService();
  private debugPanel!: DebugPanel;

  private currentLocation: Location = this.locationService.getDefaultLocation();
  private currentDate = new Date().toLocaleDateString('en-CA');
  private uvChart: any = null;
  private weatherChart: any = null;
  private refreshTimer: number | null = null;
  private refreshInFlight = false;
  private chartRenderToken = 0;
  private readonly appStartTime = performance.now();
  private lastPerformanceMark = this.appStartTime;

  private readonly REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

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
    // Debug button
    const debugBtn = document.getElementById('debug-btn');
    debugBtn?.addEventListener('click', () => this.debugPanel.toggle());

    // Date navigation
    document.getElementById('prev-day')?.addEventListener('click', () => this.navigateDate(-1));
    document.getElementById('next-day')?.addEventListener('click', () => this.navigateDate(1));
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
        this.renderWeatherData(localData, false);
        this.markPerformance('local-weather-cache-rendered', {
          durationMs: Math.round(performance.now() - localRenderStart),
        });
        requestedCalendar = this.requestForecastCalendar(false);
      }

      const apiStart = performance.now();
      const data = await this.api.fetchWeatherData(this.currentLocation, this.currentDate);
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
      this.renderWeatherData(data, silent && !renderedLocalCache);
      this.markPerformance('weather-api-rendered', {
        durationMs: Math.round(performance.now() - apiRenderStart),
        silent: silent && !renderedLocalCache,
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
      document.getElementById('legend')?.classList.remove('hidden');
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
        const label = data.labels[i];
        const hour = parseInt(label.split(':')[0]);
        const isPM = label.includes('PM');
        const hour24 = isPM && hour !== 12 ? hour + 12 : !isPM && hour === 12 ? 0 : hour;

        if (hour24 === currentHour) {
          currentIndex = i;
          break;
        } else if (hour24 > currentHour) {
          currentIndex = Math.max(0, i - 1);
          break;
        }
      }

      // Update current values
      const temp = Math.round(data.temperature[currentIndex] || 0);
      const uv = (data.uv[currentIndex] || 0).toFixed(1);
      const precip = Math.round(data.precipitation[currentIndex] || 0);
      const humidity = Math.round(data.humidity[currentIndex] || 0);

      this.updateElement('current-temp-dual', `${temp}°F`);
      this.updateElement('current-uv-dual', uv);
      this.updateElement('current-precip-dual', `${precip}%`);
      this.updateElement('current-humidity-dual', `${humidity}%`);

      // Color code values
      this.setElementColor('current-uv-dual', getUVColor(parseFloat(uv)));
      this.setElementColor('current-temp-dual', getTempLineColor(temp));

      // Update today's forecast
      this.updateTodaysForecast(data.daily);
    } else {
      // Show daily summary for future days
      document.getElementById('dual-display')?.classList.add('hidden');
      document.getElementById('single-display')?.classList.remove('hidden');
      this.updateDailySummary(data.daily);
    }
  }

  private updateTodaysForecast(dailyData?: DailyData): void {
    if (!dailyData) {
      this.debugPanel.log('Today forecast missing from weather response');
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
  }

  private updateDailySummary(dailyData?: DailyData): void {
    if (!dailyData) {
      this.debugPanel.log('Daily summary missing from weather response');
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
  }

  private async renderCharts(data: WeatherData): Promise<void> {
    const chartStart = performance.now();
    const renderToken = ++this.chartRenderToken;
    this.markPerformance('charts-render-start', { date: data.date, renderToken });

    const destroyStart = performance.now();
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
      this.renderForecastCalendar(cachedCalendar);
      this.markPerformance('forecast-calendar-cache-rendered', {
        durationMs: Math.round(performance.now() - renderStart),
        days: cachedCalendar.days.length,
      });
    }

    const apiStart = performance.now();
    const calendar = await this.api.fetchDailyCalendar(this.currentLocation, startDate);
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
    this.renderForecastCalendar(calendar);
    this.markPerformance('forecast-calendar-api-rendered', {
      durationMs: Math.round(performance.now() - renderStart),
      days: calendar.days.length,
      silent,
    });
  }

  private renderForecastCalendar(calendar: DailyCalendarData): void {
    const container = document.getElementById('forecast-calendar-container');
    const calendarElement = document.getElementById('forecast-calendar');
    if (!container || !calendarElement || calendar.days.length === 0) {
      return;
    }

    const headers = this.getCalendarWeekdayHeaders(calendar.startDate);
    const totalCells = Math.ceil(calendar.days.length / 7) * 7;
    const emptyCellCount = totalCells - calendar.days.length;

    calendarElement.innerHTML = `
      <div class="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
        ${headers
          .map(
            header => `
              <div class="bg-gray-100 text-center text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-600 py-2">
                ${header}
              </div>
            `
          )
          .join('')}
        ${calendar.days.map(day => this.renderForecastCalendarDay(day)).join('')}
        ${Array.from({ length: emptyCellCount })
          .map(() => '<div class="bg-gray-50 min-h-24 sm:min-h-32"></div>')
          .join('')}
      </div>
    `;

    this.updateForecastCalendarMetadata(calendar);
    container.classList.remove('hidden');
  }

  private renderForecastCalendarDay(day: DailyCalendarDay): string {
    const date = new Date(day.date + 'T00:00:00');
    const today = new Date().toLocaleDateString('en-CA');
    const isToday = day.date === today;
    const { icon, label } = this.getWeatherIcon(day);
    const high = Math.round(day.tempMax);
    const low = Math.round(day.tempMin);
    const precip = Math.round(day.precipMax || 0);
    const uv = Math.round(day.uvMax || 0);

    return `
      <article class="bg-white min-h-24 sm:min-h-32 p-1.5 sm:p-3 ${isToday ? 'ring-2 ring-blue-500 ring-inset' : ''}">
        <div class="flex items-start justify-between gap-1">
          <div>
            <div class="text-[10px] sm:text-xs font-semibold text-gray-500">${date.toLocaleDateString('en-US', { month: 'short' })}</div>
            <div class="text-sm sm:text-lg font-bold text-gray-900">${date.getDate()}</div>
          </div>
          ${isToday ? '<span class="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-semibold text-blue-700">Today</span>' : ''}
        </div>
        <div class="mt-1 sm:mt-2 flex flex-col items-center text-center">
          <div class="text-2xl sm:text-3xl leading-none" title="${label}" aria-label="${label}">${icon}</div>
          <div class="mt-1 text-sm sm:text-base font-bold text-gray-900">${high}°</div>
          <div class="text-[10px] sm:text-xs font-medium text-gray-500">Low ${low}°</div>
        </div>
        <div class="mt-1 sm:mt-2 flex justify-between text-[10px] sm:text-xs text-gray-500">
          <span>🌧 ${precip}%</span>
          <span>UV ${uv}</span>
        </div>
      </article>
    `;
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

  private getCalendarWeekdayHeaders(startDate: string): string[] {
    const start = new Date(startDate + 'T00:00:00');
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    });
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

    this.debugPanel.log('Scheduled 30-min auto-refresh timer');

    this.refreshTimer = window.setInterval(async () => {
      const todayStr = new Date().toLocaleDateString('en-CA');
      if (this.currentDate === todayStr) {
        this.currentDate = todayStr;
      }

      if (this.refreshInFlight) {
        this.debugPanel.log('Auto-refresh skipped: request in flight');
        return;
      }

      this.refreshInFlight = true;
      try {
        this.debugPanel.log('30-min auto-refresh triggered');
        await this.loadData(true);
      } finally {
        this.refreshInFlight = false;
      }
    }, this.REFRESH_INTERVAL_MS);
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
      this.loadData();
    }
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
