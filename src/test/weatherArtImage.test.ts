import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SolarSentinelApp } from '../app.js';
import type { WeatherArtResult } from '../utils/weatherArt.js';

class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  constructor() {
    FakeImage.instances.push(this);
  }
}

const mkArt = (key: string): WeatherArtResult => ({
  key,
  path: `/weather-art/v2/${key}.webp`,
  label: key,
  alt: `Weather art: ${key}`,
  bins: { daypart: 'day', tempBand: 'mild', condition: 'clear-low-uv' },
});

type ArtApp = { updateWeatherArtImage(elementId: string, art: WeatherArtResult): void };

describe('updateWeatherArtImage', () => {
  beforeEach(() => {
    document.body.innerHTML = `<img id="art" class="hidden" />`;
    FakeImage.instances = [];
    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing when the art key is unchanged', () => {
    const app = new SolarSentinelApp() as unknown as ArtApp;
    const image = document.getElementById('art') as HTMLImageElement;
    image.dataset.weatherArtKey = 'day-mild-clear-low-uv';
    image.src = '/weather-art/v2/day-mild-clear-low-uv.webp';
    image.classList.remove('hidden');

    app.updateWeatherArtImage('art', mkArt('day-mild-clear-low-uv'));

    expect(FakeImage.instances).toHaveLength(0);
    expect(image.classList.contains('hidden')).toBe(false);
    expect(image.src).toContain('day-mild-clear-low-uv.webp');
  });

  it('keeps the old art visible until the replacement has loaded', () => {
    const app = new SolarSentinelApp() as unknown as ArtApp;
    const image = document.getElementById('art') as HTMLImageElement;
    image.dataset.weatherArtKey = 'day-mild-clear-low-uv';
    image.src = '/weather-art/v2/day-mild-clear-low-uv.webp';
    image.classList.remove('hidden');

    app.updateWeatherArtImage('art', mkArt('day-hot-storm'));

    // Old art still showing, loader fetching in the background
    expect(image.src).toContain('day-mild-clear-low-uv.webp');
    expect(image.classList.contains('hidden')).toBe(false);
    expect(FakeImage.instances).toHaveLength(1);
    expect(FakeImage.instances[0].src).toContain('day-hot-storm.webp');

    FakeImage.instances[0].onload?.();

    expect(image.src).toContain('day-hot-storm.webp');
    expect(image.classList.contains('hidden')).toBe(false);
  });

  it('ignores a stale load when a newer art was requested', () => {
    const app = new SolarSentinelApp() as unknown as ArtApp;
    const image = document.getElementById('art') as HTMLImageElement;

    app.updateWeatherArtImage('art', mkArt('day-hot-storm'));
    app.updateWeatherArtImage('art', mkArt('night-mild-clear'));

    FakeImage.instances[0].onload?.(); // stale
    expect(image.src).not.toContain('day-hot-storm.webp');

    FakeImage.instances[1].onload?.();
    expect(image.src).toContain('night-mild-clear.webp');
  });

  it('hides the element when the replacement fails to load', () => {
    const app = new SolarSentinelApp() as unknown as ArtApp;
    const image = document.getElementById('art') as HTMLImageElement;

    app.updateWeatherArtImage('art', mkArt('day-hot-storm'));
    FakeImage.instances[0].onerror?.();

    expect(image.classList.contains('hidden')).toBe(true);
    expect(image.getAttribute('src')).toBeNull();
  });
});
