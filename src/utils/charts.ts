import type { WeatherData } from '../types/weather.js';

export function getUVColor(uvValue: number): string {
  if (uvValue <= 2) return '#22c55e'; // Green - Low
  if (uvValue <= 5) return '#eab308'; // Yellow - Moderate
  if (uvValue <= 7) return '#f97316'; // Orange - High
  if (uvValue <= 10) return '#ef4444'; // Red - Very High
  return '#8b5cf6'; // Purple - Extreme
}

export function getTempLineColor(temperature: number): string {
  if (temperature <= 32) return '#3b82f6'; // blue
  if (temperature <= 50) return '#60a5fa'; // light blue
  if (temperature < 74) return '#10b981'; // green
  if (temperature < 85) return '#f97316'; // orange
  if (temperature < 95) return '#ef4444'; // red
  return '#dc2626'; // deep red
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface OklabColor {
  l: number;
  a: number;
  b: number;
}

const TEMP_BACKGROUND_STOPS = [
  { temperature: 32, color: '#3b82f6' },
  { temperature: 55, color: '#60a5fa' },
  { temperature: 70, color: '#eab308' },
  { temperature: 80, color: '#f97316' },
  { temperature: 90, color: '#ef4444' },
  { temperature: 95, color: '#dc2626' },
] as const;

export function getForecastTempBackgroundColor(temperature: number): string {
  const safeTemperature = Number.isFinite(temperature)
    ? temperature
    : TEMP_BACKGROUND_STOPS[0].temperature;
  const firstStop = TEMP_BACKGROUND_STOPS[0];
  const lastStop = TEMP_BACKGROUND_STOPS[TEMP_BACKGROUND_STOPS.length - 1];

  if (safeTemperature <= firstStop.temperature) return firstStop.color;
  if (safeTemperature >= lastStop.temperature) return lastStop.color;

  for (let i = 1; i < TEMP_BACKGROUND_STOPS.length; i++) {
    const lowerStop = TEMP_BACKGROUND_STOPS[i - 1];
    const upperStop = TEMP_BACKGROUND_STOPS[i];

    if (safeTemperature === upperStop.temperature) return upperStop.color;

    if (safeTemperature < upperStop.temperature) {
      const ratio =
        (safeTemperature - lowerStop.temperature) / (upperStop.temperature - lowerStop.temperature);
      const easedRatio = ratio * ratio * (3 - 2 * ratio);
      const lowerColor = rgbToOklab(hexToRgb(lowerStop.color));
      const upperColor = rgbToOklab(hexToRgb(upperStop.color));

      return rgbToHex(oklabToRgb(interpolateOklab(lowerColor, upperColor, easedRatio)));
    }
  }

  return lastStop.color;
}

function hexToRgb(hex: string): RgbColor {
  const normalizedHex = hex.replace('#', '');
  const value = Number.parseInt(normalizedHex, 16);

  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}

function rgbToHex(color: RgbColor): string {
  const toHex = (channel: number): string =>
    Math.round(clamp(channel, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function rgbToOklab(color: RgbColor): OklabColor {
  const red = srgbToLinear(color.r);
  const green = srgbToLinear(color.g);
  const blue = srgbToLinear(color.b);

  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function oklabToRgb(color: OklabColor): RgbColor {
  const lRoot = color.l + 0.3963377774 * color.a + 0.2158037573 * color.b;
  const mRoot = color.l - 0.1055613458 * color.a - 0.0638541728 * color.b;
  const sRoot = color.l - 0.0894841775 * color.a - 1.291485548 * color.b;

  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;

  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

function interpolateOklab(start: OklabColor, end: OklabColor, ratio: number): OklabColor {
  return {
    l: start.l + (end.l - start.l) * ratio,
    a: start.a + (end.a - start.a) * ratio,
    b: start.b + (end.b - start.b) * ratio,
  };
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type ChartInstance = { destroy: () => void; update: (mode?: string) => void };
let chartConstructor: any | null = null;

interface TimeMarker {
  label: string;
  time: Date;
  color: string;
  lineDash: number[];
  labelRow: number;
}

async function getChartConstructor(): Promise<any> {
  const globalChart = (globalThis as any).Chart;
  if (globalChart) {
    return globalChart;
  }

  if (!chartConstructor) {
    const chartModule = await import('chart.js/auto');
    chartConstructor = chartModule.default;
  }

  return chartConstructor;
}

function getDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

function getTimeMarkers(data: WeatherData): TimeMarker[] {
  const markers: TimeMarker[] = [];
  const now = new Date();

  if (getDateKey(now) === data.date) {
    markers.push({
      label: 'Now',
      time: now,
      color: '#111827',
      lineDash: [],
      labelRow: 0,
    });
  }

  if (data.metadata?.lastUpdated) {
    const lastUpdated = new Date(data.metadata.lastUpdated);
    if (!Number.isNaN(lastUpdated.getTime()) && getDateKey(lastUpdated) === data.date) {
      markers.push({
        label: 'Updated',
        time: lastUpdated,
        color: '#64748b',
        lineDash: [3, 4],
        labelRow: 1,
      });
    }
  }

  return markers;
}

function getMarkerPosition(chart: any, data: WeatherData, markerTime: Date): number | null {
  const xScale = chart.scales?.x;
  const timestamps = data.timestamps;

  if (!xScale || !timestamps || timestamps.length === 0) {
    return null;
  }

  const times = timestamps.map(timestamp => new Date(timestamp).getTime());
  const markerMs = markerTime.getTime();
  const firstMs = times[0];
  const lastMs = times[times.length - 1];
  const intervalMs = times.length > 1 ? times[1] - times[0] : 60 * 60 * 1000;

  if (Number.isNaN(markerMs) || markerMs < firstMs || markerMs > lastMs + intervalMs) {
    return null;
  }

  for (let i = 0; i < times.length - 1; i++) {
    if (markerMs >= times[i] && markerMs <= times[i + 1]) {
      const progress = (markerMs - times[i]) / (times[i + 1] - times[i]);
      const startX = xScale.getPixelForValue(i);
      const endX = xScale.getPixelForValue(i + 1);
      return startX + (endX - startX) * progress;
    }
  }

  const previousX = xScale.getPixelForValue(Math.max(0, times.length - 2));
  const lastX = xScale.getPixelForValue(times.length - 1);
  const step = times.length > 1 ? lastX - previousX : 0;
  return lastX + step * ((markerMs - lastMs) / intervalMs);
}

function createTimeMarkersPlugin(data: WeatherData): any {
  return {
    id: `time-markers-${data.date}`,
    afterDraw(chart: any) {
      const markers = getTimeMarkers(data);
      if (markers.length === 0) return;

      const { ctx, chartArea } = chart;
      if (!ctx || !chartArea) return;

      markers.forEach(marker => {
        const x = getMarkerPosition(chart, data, marker.time);
        if (x === null || x < chartArea.left || x > chartArea.right) {
          return;
        }

        ctx.save();
        ctx.strokeStyle = marker.color;
        ctx.lineWidth = marker.lineDash.length > 0 ? 1.5 : 2;
        ctx.setLineDash(marker.lineDash);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.restore();

        drawMarkerLabel(ctx, chartArea, x, marker);
      });
    },
  };
}

function drawMarkerLabel(
  ctx: CanvasRenderingContext2D,
  chartArea: any,
  x: number,
  marker: TimeMarker
): void {
  const textPaddingX = 5;
  const textHeight = 16;
  const textTop = chartArea.top + 4 + marker.labelRow * (textHeight + 2);

  ctx.save();
  ctx.font = '11px sans-serif';
  const textWidth = ctx.measureText(marker.label).width;
  const labelWidth = textWidth + textPaddingX * 2;
  const labelLeft = Math.min(Math.max(x + 5, chartArea.left), chartArea.right - labelWidth);

  ctx.fillStyle = marker.color;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(labelLeft, textTop, labelWidth, textHeight);

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(marker.label, labelLeft + textPaddingX, textTop + textHeight / 2);
  ctx.restore();
}

export async function createUVChart(
  canvas: HTMLCanvasElement,
  data: WeatherData
): Promise<ChartInstance> {
  const Chart = await getChartConstructor();
  return new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: 'UV Index',
          data: data.uv,
          backgroundColor: data.uv.map(value => getUVColor(value)),
          borderColor: data.uv.map(value => getUVColor(value)),
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        },
        {
          label: 'UV Index Clear Sky',
          data: data.uvClearSky,
          type: 'line',
          borderColor: '#ef4444',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 5],
          fill: false,
          pointRadius: 0,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 10,
            font: {
              size: window.innerWidth < 640 ? 10 : 12,
            },
          },
        },
        tooltip: {
          callbacks: {
            label: function (context: { parsed: { y: number }; dataset: { label: string } }) {
              const value = context.parsed.y;
              let level = 'Low';
              if (value > 10) level = 'Extreme';
              else if (value > 7) level = 'Very High';
              else if (value > 5) level = 'High';
              else if (value > 2) level = 'Moderate';
              const suffix = context.dataset.label.includes('Clear Sky') ? ' (Clear Sky)' : '';
              return `${context.dataset.label}: ${value} (${level})${suffix}`;
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: Math.max(12, Math.max(...data.uv) + 1),
          title: {
            display: window.innerWidth >= 640,
            text: 'UV Index',
          },
        },
        x: {
          title: {
            display: false,
          },
          ticks: {
            maxRotation: window.innerWidth < 640 ? 45 : 0,
            callback: function (value: number, index: number) {
              if (window.innerWidth < 640) {
                return index % 2 === 0 ? (this as any).getLabelForValue(value) : '';
              }
              return (this as any).getLabelForValue(value);
            },
          },
        },
      },
    },
    plugins: [createTimeMarkersPlugin(data)],
  });
}

export async function createWeatherChart(
  canvas: HTMLCanvasElement,
  data: WeatherData
): Promise<ChartInstance> {
  const Chart = await getChartConstructor();
  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: 'Precipitation Probability (%)',
          data: data.precipitation,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.2)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          yAxisID: 'y',
        },
        {
          label: 'Cloud Cover (%)',
          data: data.cloudCover,
          type: 'bar',
          borderColor: '#d1d5db',
          backgroundColor: 'rgba(209, 213, 219, 0.6)',
          borderWidth: 1,
          yAxisID: 'y',
        },
        {
          label: 'Temperature (°F)',
          data: data.temperature,
          borderColor: '#9ca3af',
          backgroundColor: 'transparent',
          borderWidth: 3,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          segment: {
            borderColor: (ctx: {
              p0?: { parsed?: { y?: number } };
              p1?: { parsed?: { y?: number } };
            }) => {
              const y0 = ctx.p0?.parsed?.y;
              const y1 = ctx.p1?.parsed?.y;
              if (typeof y0 !== 'number' || typeof y1 !== 'number') return undefined;
              const t = (y0 + y1) / 2;
              return getTempLineColor(t);
            },
          },
          yAxisID: 'y1',
        },
        {
          label: 'Apparent Temperature (°F)',
          data: data.apparentTemperature,
          borderColor: '#6b7280',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 5],
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          segment: {
            borderColor: (ctx: {
              p0?: { parsed?: { y?: number } };
              p1?: { parsed?: { y?: number } };
            }) => {
              const y0 = ctx.p0?.parsed?.y;
              const y1 = ctx.p1?.parsed?.y;
              if (typeof y0 !== 'number' || typeof y1 !== 'number') return undefined;
              const t = (y0 + y1) / 2;
              return getTempLineColor(t);
            },
          },
          yAxisID: 'y1',
        },
        {
          label: 'Humidity (%)',
          data: data.humidity,
          borderColor: '#10b981',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [2, 2],
          fill: false,
          tension: 0.3,
          yAxisID: 'y',
        },
      ],
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
        },
        tooltip: {
          mode: 'index',
          intersect: false,
        },
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          beginAtZero: true,
          max: 100,
          title: {
            display: window.innerWidth >= 640,
            text: 'Percentage',
          },
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: window.innerWidth >= 640,
            text: 'Temperature (°F)',
          },
          grid: {
            drawOnChartArea: false,
          },
        },
        x: {
          title: {
            display: false,
          },
          ticks: {
            maxRotation: window.innerWidth < 640 ? 45 : 0,
            callback: function (value: number, index: number) {
              if (window.innerWidth < 640) {
                return index % 2 === 0 ? (this as any).getLabelForValue(value) : '';
              }
              return (this as any).getLabelForValue(value);
            },
          },
        },
      },
    },
    plugins: [createTimeMarkersPlugin(data)],
  });
}
