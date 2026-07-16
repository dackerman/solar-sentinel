import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocationPicker, type LocationPickerOptions } from '../components/locationPicker.js';
import type { Location, SavedLocation } from '../types/weather.js';

const home: Location = { lat: 42.8006, lon: -71.3048, name: 'Windham, NH', isUserLocation: false };
const denver: Location = {
  lat: 39.7392,
  lon: -104.9903,
  name: 'Denver, CO',
  isUserLocation: false,
};
const denverSaved: SavedLocation = {
  id: '39.74,-104.99',
  lat: 39.7392,
  lon: -104.9903,
  name: 'Denver, CO',
};

function makeOptions(overrides: Partial<LocationPickerOptions> = {}): LocationPickerOptions {
  return {
    getHomeLocation: () => ({ ...home }),
    getCurrentLocation: () => ({ ...home }),
    getSavedLocations: () => [],
    isSaved: () => false,
    isHomeLocation: location => location.lat === home.lat && location.lon === home.lon,
    onSelectLocation: vi.fn(),
    onUseCurrentLocation: vi.fn(),
    onToggleFavorite: vi.fn(),
    searchLocations: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('LocationPicker', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="relative">
        <button id="location-display" aria-expanded="false"></button>
        <div id="location-picker" class="hidden"></div>
      </div>`;
    vi.useRealTimers();
  });

  it('opens with use-current, home, and favorites rows', () => {
    const options = makeOptions({ getSavedLocations: () => [denverSaved] });
    const picker = new LocationPicker(options);
    picker.open();

    const container = document.getElementById('location-picker')!;
    expect(container.classList.contains('hidden')).toBe(false);
    expect(container.textContent).toContain('Use my current location');
    expect(container.textContent).toContain('Windham, NH');
    expect(container.textContent).toContain('Denver, CO');
  });

  it('selecting a favorite invokes onSelectLocation with its coords', () => {
    const options = makeOptions({ getSavedLocations: () => [denverSaved] });
    const picker = new LocationPicker(options);
    picker.open();

    const row = document.querySelector<HTMLElement>(
      '[data-picker-action="select"][data-location-name="Denver, CO"]'
    );
    row?.click();

    expect(options.onSelectLocation).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 39.7392, lon: -104.9903, name: 'Denver, CO' })
    );
  });

  it('use-current row invokes onUseCurrentLocation', () => {
    const options = makeOptions();
    const picker = new LocationPicker(options);
    picker.open();
    document.querySelector<HTMLElement>('[data-picker-action="use-current"]')?.click();
    expect(options.onUseCurrentLocation).toHaveBeenCalled();
  });

  it('star toggles a favorite and re-renders', () => {
    const options = makeOptions({ getCurrentLocation: () => ({ ...denver }) });
    const picker = new LocationPicker(options);
    picker.open();
    document.querySelector<HTMLElement>('[data-picker-action="toggle-favorite"]')?.click();
    expect(options.onToggleFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Denver, CO' })
    );
  });

  it('debounces search input and renders results', async () => {
    vi.useFakeTimers();
    const searchLocations = vi
      .fn()
      .mockResolvedValue([{ lat: 51.5085, lon: -0.1257, name: 'London, England, United Kingdom' }]);
    const picker = new LocationPicker(makeOptions({ searchLocations }));
    picker.open();

    const input = document.getElementById('location-search-input') as HTMLInputElement;
    input.value = 'lon';
    input.dispatchEvent(new Event('input'));
    input.value = 'london';
    input.dispatchEvent(new Event('input'));

    await vi.advanceTimersByTimeAsync(300);
    expect(searchLocations).toHaveBeenCalledTimes(1);
    expect(searchLocations).toHaveBeenCalledWith('london');
    await vi.runAllTimersAsync();
    expect(document.getElementById('location-search-results')?.textContent).toContain('London');
  });

  it('shows search-unavailable message when geocoding fails', async () => {
    vi.useFakeTimers();
    const searchLocations = vi.fn().mockRejectedValue(new Error('down'));
    const picker = new LocationPicker(makeOptions({ searchLocations }));
    picker.open();

    const input = document.getElementById('location-search-input') as HTMLInputElement;
    input.value = 'boston';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(300);
    await vi.runAllTimersAsync();

    expect(document.getElementById('location-search-status')?.textContent).toContain(
      'Search unavailable'
    );
  });

  it('closes on outside click', () => {
    const picker = new LocationPicker(makeOptions());
    picker.open();
    document.body.click();
    expect(document.getElementById('location-picker')?.classList.contains('hidden')).toBe(true);
  });
});
