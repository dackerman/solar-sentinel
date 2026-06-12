import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SolarSentinelApp } from '../app.js';

// Mirrors the real nesting in src/index.html: the history controls and the
// unavailable notice live INSIDE #current-conditions, so the unavailable state
// must never hide that container or the user loses the scrubber and close button.
const setupDOM = () => {
  document.body.innerHTML = `
    <div>
      <div id="loading"></div>
      <div id="current-conditions">
        <button id="history-toggle"></button>
        <div id="history-panel">
          <button id="history-close"></button>
          <div id="history-status"></div>
          <div id="history-detail"></div>
          <div id="history-controls">
            <input id="history-scrubber" type="range" min="0" max="0" value="0" />
          </div>
        </div>
        <div id="history-unavailable" class="hidden"></div>
        <div id="dual-display"></div>
        <div id="single-display"></div>
      </div>
      <div id="weather-chart-container"></div>
      <div id="chart-container"></div>
      <div id="date-display"></div>
      <button id="prev-day"></button>
      <button id="next-day"></button>
      <button id="debug-btn"></button>
    </div>`;
};

const isHidden = (id: string) => document.getElementById(id)?.classList.contains('hidden');

describe('History unavailable state', () => {
  beforeEach(() => {
    setupDOM();
    localStorage.clear();
  });

  it('hides only the data sections, keeping the history controls usable', () => {
    const app = new SolarSentinelApp() as unknown as {
      setHistoryUnavailable(unavailable: boolean): void;
    };

    app.setHistoryUnavailable(true);

    expect(isHidden('history-unavailable')).toBe(false);
    expect(isHidden('current-conditions')).toBe(false);
    expect(isHidden('history-panel')).toBe(false);
    expect(isHidden('dual-display')).toBe(true);
    expect(isHidden('single-display')).toBe(true);
    expect(isHidden('chart-container')).toBe(true);
    expect(isHidden('weather-chart-container')).toBe(true);

    app.setHistoryUnavailable(false);
    expect(isHidden('history-unavailable')).toBe(true);
  });

  it('re-renders only when scrubbing resolves to a different snapshot', () => {
    const app = new SolarSentinelApp() as unknown as {
      historyTimeline: string[];
      weatherHistory: Array<{ id: number; fetchedAt: string; data: unknown }>;
      calendarHistory: unknown[];
      renderHistoryAt(index: number): void;
      renderWeatherData(data: unknown, silent: boolean): void;
    };

    const renderSpy = vi
      .spyOn(
        app as unknown as Record<'renderWeatherData', (...args: unknown[]) => void>,
        'renderWeatherData'
      )
      .mockImplementation(() => {});

    app.historyTimeline = [
      '2026-06-10T10:00:00.000Z',
      '2026-06-10T11:00:00.000Z',
      '2026-06-10T12:00:00.000Z',
    ];
    app.weatherHistory = [
      { id: 1, fetchedAt: '2026-06-10T09:30:00.000Z', data: {} },
      { id: 2, fetchedAt: '2026-06-10T11:30:00.000Z', data: {} },
    ];
    app.calendarHistory = [];

    app.renderHistoryAt(0); // resolves to id 1
    app.renderHistoryAt(1); // still id 1 — must not re-render
    app.renderHistoryAt(2); // resolves to id 2

    expect(renderSpy).toHaveBeenCalledTimes(2);
  });
});
