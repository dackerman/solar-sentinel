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

export function createUVChart(canvas: HTMLCanvasElement, data: WeatherData): any {
  // @ts-ignore - Chart.js will be loaded globally
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
            label: function (context: any) {
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
            callback: function (value: any, index: number) {
              if (window.innerWidth < 640) {
                return index % 2 === 0 ? (this as any).getLabelForValue(value) : '';
              }
              return (this as any).getLabelForValue(value);
            },
          },
        },
      },
    },
  });
}

export function createWeatherChart(canvas: HTMLCanvasElement, data: WeatherData): any {
  // @ts-ignore - Chart.js will be loaded globally
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
            borderColor: (ctx: any) => {
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
            borderColor: (ctx: any) => {
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
            callback: function (value: any, index: number) {
              if (window.innerWidth < 640) {
                return index % 2 === 0 ? (this as any).getLabelForValue(value) : '';
              }
              return (this as any).getLabelForValue(value);
            },
          },
        },
      },
    },
  });
}
