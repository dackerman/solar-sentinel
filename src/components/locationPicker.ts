import type { Location, SavedLocation } from '../types/weather.js';
import type { GeocodingResult } from '../services/geocoding.js';

export interface LocationPickerOptions {
  getHomeLocation(): Location;
  getCurrentLocation(): Location;
  getSavedLocations(): SavedLocation[];
  isSaved(location: Pick<Location, 'lat' | 'lon'>): boolean;
  isHomeLocation(location: Location): boolean;
  onSelectLocation(location: Location): void;
  onUseCurrentLocation(): void;
  onToggleFavorite(location: Location): void;
  searchLocations(query: string): Promise<GeocodingResult[]>;
}

const SEARCH_DEBOUNCE_MS = 300;

export class LocationPicker {
  private readonly container: HTMLElement | null;
  private readonly toggleButton: HTMLElement | null;
  private searchTimer: number | null = null;
  private searchToken = 0;
  private isOpen = false;

  constructor(private readonly options: LocationPickerOptions) {
    this.container = document.getElementById('location-picker');
    this.toggleButton = document.getElementById('location-display');

    document.addEventListener('click', event => {
      if (!this.isOpen) return;
      const target = event.target as Node;
      if (this.container?.contains(target) || this.toggleButton?.contains(target)) return;
      this.close();
    });
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open(): void {
    if (!this.container) return;
    this.renderShell();
    this.refresh();
    this.container.classList.remove('hidden');
    this.toggleButton?.setAttribute('aria-expanded', 'true');
    this.isOpen = true;
  }

  close(): void {
    if (!this.container) return;
    this.container.classList.add('hidden');
    this.toggleButton?.setAttribute('aria-expanded', 'false');
    this.isOpen = false;
    if (this.searchTimer) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }

  // Rebuilds the location rows; leaves the search box (and its focus) intact.
  refresh(): void {
    const lists = document.getElementById('location-picker-lists');
    if (!lists) return;

    const current = this.options.getCurrentLocation();
    const favorites = this.options.getSavedLocations();
    const rows: string[] = [];

    rows.push(this.renderRow(this.options.getHomeLocation(), { pinnedLabel: 'Home' }));

    const currentIsHome = this.options.isHomeLocation(current);
    const currentIsFavorite = this.options.isSaved(current);
    if (!currentIsHome && !currentIsFavorite) {
      rows.push(this.renderRow(current, { currentLabel: 'Current' }));
    }

    for (const favorite of favorites) {
      rows.push(
        this.renderRow(
          { lat: favorite.lat, lon: favorite.lon, name: favorite.name, isUserLocation: false },
          {}
        )
      );
    }

    lists.innerHTML = rows.join('');
  }

  private renderShell(): void {
    if (!this.container || this.container.childElementCount > 0) return;

    this.container.innerHTML = `
      <div class="border-b border-gray-100 p-2">
        <button
          data-picker-action="use-current"
          class="block w-full cursor-pointer rounded-lg px-3 py-2 text-left font-medium text-blue-700 hover:bg-blue-50"
          type="button"
        >
          📍 Use my current location
        </button>
      </div>
      <div id="location-picker-lists" class="max-h-64 overflow-y-auto p-2"></div>
      <div class="border-t border-gray-100 p-2">
        <input
          id="location-search-input"
          type="search"
          placeholder="Search city or town..."
          autocomplete="off"
          class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none"
        />
        <div id="location-search-status" class="hidden px-1 pt-1 text-xs text-gray-500"></div>
        <div id="location-search-results"></div>
      </div>
    `;

    this.container.addEventListener('click', event => this.handleClick(event));
    document
      .getElementById('location-search-input')
      ?.addEventListener('input', event =>
        this.scheduleSearch((event.target as HTMLInputElement).value)
      );
  }

  private renderRow(
    location: Location,
    labels: { pinnedLabel?: string; currentLabel?: string }
  ): string {
    const isHome = this.options.isHomeLocation(location);
    const saved = this.options.isSaved(location);
    const badge = labels.pinnedLabel || labels.currentLabel;
    const badgeHtml = badge
      ? `<span class="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">${badge}</span>`
      : '';
    // Home is pinned and cannot be unfavorited; everything else gets a star.
    const starHtml = isHome
      ? ''
      : `<button
          data-picker-action="toggle-favorite"
          ${this.locationDataAttributes(location)}
          class="cursor-pointer rounded px-2 py-1 text-base ${saved ? 'text-yellow-500' : 'text-gray-300'} hover:text-yellow-500"
          type="button"
          aria-label="${saved ? 'Remove from favorites' : 'Save to favorites'}"
        >${saved ? '★' : '☆'}</button>`;

    return `
      <div class="flex items-center justify-between gap-1">
        <button
          data-picker-action="select"
          ${this.locationDataAttributes(location)}
          class="min-w-0 flex-1 cursor-pointer truncate rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
          type="button"
        >${this.escapeHtml(location.name)}${badgeHtml}</button>
        ${starHtml}
      </div>
    `;
  }

  private locationDataAttributes(location: Pick<Location, 'lat' | 'lon' | 'name'>): string {
    return `data-lat="${location.lat}" data-lon="${location.lon}" data-location-name="${this.escapeHtml(location.name)}"`;
  }

  private handleClick(event: Event): void {
    const actionElement = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-picker-action]'
    );
    if (!actionElement) return;

    const action = actionElement.dataset.pickerAction;
    if (action === 'use-current') {
      this.close();
      this.options.onUseCurrentLocation();
      return;
    }

    const location = this.readLocation(actionElement);
    if (!location) return;

    if (action === 'select') {
      this.close();
      this.options.onSelectLocation(location);
    } else if (action === 'toggle-favorite') {
      this.options.onToggleFavorite(location);
      this.refresh();
      this.rerenderSearchStars();
    }
  }

  private readLocation(element: HTMLElement): Location | null {
    const lat = parseFloat(element.dataset.lat ?? '');
    const lon = parseFloat(element.dataset.lon ?? '');
    const name = element.dataset.locationName;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return null;
    return { lat, lon, name, isUserLocation: false };
  }

  private scheduleSearch(query: string): void {
    if (this.searchTimer) {
      window.clearTimeout(this.searchTimer);
    }
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null;
      void this.runSearch(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  private async runSearch(query: string): Promise<void> {
    const token = ++this.searchToken;
    const status = document.getElementById('location-search-status');
    const results = document.getElementById('location-search-results');
    if (!results || !status) return;

    if (query.trim().length < 2) {
      results.innerHTML = '';
      status.classList.add('hidden');
      return;
    }

    status.textContent = 'Searching...';
    status.classList.remove('hidden');

    try {
      const found = await this.options.searchLocations(query);
      if (token !== this.searchToken) return; // stale response

      status.classList.add('hidden');
      if (found.length === 0) {
        status.textContent = 'No matches found';
        status.classList.remove('hidden');
        results.innerHTML = '';
        return;
      }

      results.innerHTML = found
        .map(result =>
          this.renderRow(
            { lat: result.lat, lon: result.lon, name: result.name, isUserLocation: false },
            {}
          )
        )
        .join('');
    } catch (error) {
      if (token !== this.searchToken) return;
      console.log('Location search error:', (error as Error).message);
      results.innerHTML = '';
      status.textContent = 'Search unavailable — check your connection';
      status.classList.remove('hidden');
    }
  }

  // Stars inside search results reflect saved state; refresh them after toggles.
  private rerenderSearchStars(): void {
    const results = document.getElementById('location-search-results');
    if (!results) return;
    results
      .querySelectorAll<HTMLElement>('[data-picker-action="toggle-favorite"]')
      .forEach(star => {
        const location = this.readLocation(star);
        if (!location) return;
        const saved = this.options.isSaved(location);
        star.textContent = saved ? '★' : '☆';
        star.classList.toggle('text-yellow-500', saved);
        star.classList.toggle('text-gray-300', !saved);
        star.setAttribute('aria-label', saved ? 'Remove from favorites' : 'Save to favorites');
      });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
