import { describe, it, expect, beforeEach } from 'vitest';
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
});
