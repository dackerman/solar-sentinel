import type {
  Location,
  LocationSource,
  SavedLocation,
  SelectedLocation,
} from '../types/weather.js';

export class SavedLocationsService {
  private readonly SAVED_LOCATIONS_KEY = 'solar_sentinel_saved_locations';
  private readonly SELECTED_LOCATION_KEY = 'solar_sentinel_selected_location';

  static getLocationId(lat: number, lon: number): string {
    return `${lat.toFixed(2)},${lon.toFixed(2)}`;
  }

  getSavedLocations(): SavedLocation[] {
    try {
      const raw = localStorage.getItem(this.SAVED_LOCATIONS_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (entry): entry is SavedLocation =>
          Boolean(entry) &&
          typeof (entry as SavedLocation).id === 'string' &&
          Number.isFinite((entry as SavedLocation).lat) &&
          Number.isFinite((entry as SavedLocation).lon) &&
          typeof (entry as SavedLocation).name === 'string'
      );
    } catch (error) {
      console.log('Saved locations read error:', (error as Error).message);
      return [];
    }
  }

  isSaved(location: Pick<Location, 'lat' | 'lon'>): boolean {
    const id = SavedLocationsService.getLocationId(location.lat, location.lon);
    return this.getSavedLocations().some(entry => entry.id === id);
  }

  addSavedLocation(location: Pick<Location, 'lat' | 'lon' | 'name'>): SavedLocation[] {
    const id = SavedLocationsService.getLocationId(location.lat, location.lon);
    const existing = this.getSavedLocations();
    if (existing.some(entry => entry.id === id)) return existing;

    const next = [...existing, { id, lat: location.lat, lon: location.lon, name: location.name }];
    this.writeSavedLocations(next);
    return next;
  }

  removeSavedLocation(id: string): SavedLocation[] {
    const next = this.getSavedLocations().filter(entry => entry.id !== id);
    this.writeSavedLocations(next);
    return next;
  }

  getSelectedLocation(): SelectedLocation | null {
    try {
      const raw = localStorage.getItem(this.SELECTED_LOCATION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SelectedLocation;
      if (
        !parsed?.location ||
        !Number.isFinite(parsed.location.lat) ||
        !Number.isFinite(parsed.location.lon) ||
        typeof parsed.location.name !== 'string' ||
        (parsed.source !== 'manual' && parsed.source !== 'auto')
      ) {
        return null;
      }
      return parsed;
    } catch (error) {
      console.log('Selected location read error:', (error as Error).message);
      return null;
    }
  }

  setSelectedLocation(location: Location, source: LocationSource): void {
    try {
      const value: SelectedLocation = { location, source, timestamp: Date.now() };
      localStorage.setItem(this.SELECTED_LOCATION_KEY, JSON.stringify(value));
    } catch (error) {
      console.log('Selected location write error:', (error as Error).message);
    }
  }

  clearSelectedLocation(): void {
    try {
      localStorage.removeItem(this.SELECTED_LOCATION_KEY);
    } catch (error) {
      console.log('Selected location clear error:', (error as Error).message);
    }
  }

  private writeSavedLocations(locations: SavedLocation[]): void {
    try {
      localStorage.setItem(this.SAVED_LOCATIONS_KEY, JSON.stringify(locations));
    } catch (error) {
      console.log('Saved locations write error:', (error as Error).message);
    }
  }
}
