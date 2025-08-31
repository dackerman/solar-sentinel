import { WeatherAPI } from './services/api.js';
import { LocationService } from './services/location.js';
import { DebugPanel } from './components/debug.js';
import { createUVChart, createWeatherChart, getUVColor, getTempLineColor } from './utils/charts.js';
import type { WeatherData, Location } from './types/weather.js';

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
  
  private readonly REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

  async initialize(): Promise<void> {
    this.debugPanel = new DebugPanel(document.body);
    this.setupEventListeners();
    await this.loadData();
    this.scheduleAutoRefresh();
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
    this.debugPanel.log(`Loading UV data for ${this.currentDate}`, { reason });

    try {
      // Get user location if available
      const locationStartTime = performance.now();
      const userLocation = await this.locationService.getCurrentLocation();
      const locationEndTime = performance.now();
      const locationDuration = Math.round(locationEndTime - locationStartTime);
      
      if (userLocation) {
        this.currentLocation = userLocation;
        this.debugPanel.log(`Location obtained (${locationDuration}ms)`, { 
          name: userLocation.name,
          coords: `${userLocation.lat.toFixed(4)}, ${userLocation.lon.toFixed(4)}`,
          duration: locationDuration
        });
      } else {
        this.debugPanel.log(`Location failed (${locationDuration}ms)`, { 
          fallback: this.currentLocation.name,
          duration: locationDuration
        });
      }

      // Update location display
      const locationIcon = this.currentLocation.isUserLocation ? '📍 ' : '';
      const locationDisplay = document.getElementById('location-display');
      if (locationDisplay) {
        locationDisplay.textContent = `${locationIcon}${this.currentLocation.name}`;
      }

      // Fetch weather data
      const data = await this.api.fetchWeatherData(this.currentLocation, this.currentDate);
      
      // Log cache status with timing
      const cacheStatus = data.timing?.cacheStatus || (data.metadata?.cached ? 'hit' : 'miss');
      this.debugPanel.log(`UV API response: ${cacheStatus} (${data.timing?.duration}ms)`, {
        cached: data.metadata?.cached,
        cacheAge: data.metadata?.cacheAge,
        lastUpdated: data.metadata?.lastUpdated,
        duration: data.timing?.duration
      });

      // Show UI elements
      if (!silent) {
        document.getElementById('loading')?.style.setProperty('display', 'none');
        document.getElementById('current-conditions')?.classList.remove('hidden');
        document.getElementById('chart-container')?.classList.remove('hidden');
        document.getElementById('weather-chart-container')?.classList.remove('hidden');
        document.getElementById('legend')?.classList.remove('hidden');
      }

      // Update date display
      const dateObj = new Date(data.date + 'T00:00:00');
      const dateDisplay = dateObj.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      });
      const dateElement = document.getElementById('date-display');
      if (dateElement) {
        dateElement.textContent = dateDisplay;
      }

      // Update current conditions
      this.updateCurrentConditions(data);

      // Render charts
      this.renderCharts(data);

    } catch (error) {
      this.debugPanel.log('Load error', { error: (error as Error).message });
      
      if (!silent) {
        document.getElementById('loading')?.style.setProperty('display', 'none');
        document.getElementById('error')?.classList.remove('hidden');
        const errorMessage = document.getElementById('error-message');
        if (errorMessage) {
          errorMessage.textContent = (error as Error).message;
        }
      }
    }
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
        const hour24 = isPM && hour !== 12 ? hour + 12 : (!isPM && hour === 12 ? 0 : hour);

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
      this.updateTodaysForecast();
    } else {
      // Show daily summary for future days
      document.getElementById('dual-display')?.classList.add('hidden');
      document.getElementById('single-display')?.classList.remove('hidden');
      this.updateDailySummary();
    }
  }

  private async updateTodaysForecast(): Promise<void> {
    try {
      const dailyData = await this.api.fetchDailyData(this.currentLocation, this.currentDate);
      
      const cacheStatus = dailyData.timing?.cacheStatus || (dailyData.metadata?.cached ? 'hit' : 'miss');
      this.debugPanel.log(`Daily API response: ${cacheStatus} (${dailyData.timing?.duration}ms)`, {
        cached: dailyData.metadata?.cached,
        cacheAge: dailyData.metadata?.cacheAge,
        duration: dailyData.timing?.duration
      });

      const tempHigh = Math.round(dailyData.tempMax || 0);
      const tempLow = Math.round(dailyData.tempMin || 0);
      const uvMax = (dailyData.uvMax || 0).toFixed(1);
      const precipMax = Math.round(dailyData.precipMax || 0);

      this.updateElement('today-temp-dual', `${tempHigh}°/${tempLow}°F`);
      this.updateElement('today-uv-dual', uvMax);
      this.updateElement('today-precip-dual', `${precipMax}%`);

      this.setElementColor('today-uv-dual', getUVColor(parseFloat(uvMax)));
      this.setElementColor('today-temp-dual', getTempLineColor(tempHigh));
    } catch (error) {
      this.debugPanel.log('Today forecast error', { error: (error as Error).message });
    }
  }

  private async updateDailySummary(): Promise<void> {
    try {
      const dailyData = await this.api.fetchDailyData(this.currentLocation, this.currentDate);
      
      const cacheStatus = dailyData.timing?.cacheStatus || (dailyData.metadata?.cached ? 'hit' : 'miss');
      this.debugPanel.log(`Daily summary API: ${cacheStatus} (${dailyData.timing?.duration}ms)`, {
        cached: dailyData.metadata?.cached,
        cacheAge: dailyData.metadata?.cacheAge,
        duration: dailyData.timing?.duration
      });

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
    } catch (error) {
      this.debugPanel.log('Daily summary error', { error: (error as Error).message });
    }
  }

  private renderCharts(data: WeatherData): void {
    // Destroy existing charts
    if (this.uvChart) {
      this.uvChart.destroy();
    }
    if (this.weatherChart) {
      this.weatherChart.destroy();
    }

    // Get canvas elements
    const uvCanvas = document.getElementById('uvChart') as HTMLCanvasElement;
    const weatherCanvas = document.getElementById('weatherChart') as HTMLCanvasElement;

    if (uvCanvas && weatherCanvas) {
      // Reset canvas dimensions
      uvCanvas.style.width = '100%';
      uvCanvas.style.height = '384px';
      uvCanvas.width = uvCanvas.offsetWidth;
      uvCanvas.height = 384;

      weatherCanvas.style.width = '100%';
      weatherCanvas.style.height = '384px';
      weatherCanvas.width = weatherCanvas.offsetWidth;
      weatherCanvas.height = 384;

      // Create new charts
      this.uvChart = createUVChart(uvCanvas, data);
      this.weatherChart = createWeatherChart(weatherCanvas, data);
    }
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
}