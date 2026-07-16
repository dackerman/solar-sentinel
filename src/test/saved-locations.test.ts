import { describe, it, expect, beforeEach } from 'vitest';
import { SavedLocationsService } from '../services/savedLocations.js';
import type { Location } from '../types/weather.js';

const boston: Location = {
  lat: 42.3601,
  lon: -71.0589,
  name: 'Boston, MA',
  isUserLocation: false,
};
const denver: Location = {
  lat: 39.7392,
  lon: -104.9903,
  name: 'Denver, CO',
  isUserLocation: false,
};

describe('SavedLocationsService', () => {
  let service: SavedLocationsService;

  beforeEach(() => {
    localStorage.clear();
    service = new SavedLocationsService();
  });

  it('builds 2-decimal location ids', () => {
    expect(SavedLocationsService.getLocationId(42.3601, -71.0589)).toBe('42.36,-71.06');
  });

  it('returns empty list when nothing is saved', () => {
    expect(service.getSavedLocations()).toEqual([]);
  });

  it('adds and persists a favorite', () => {
    const list = service.addSavedLocation(boston);
    expect(list).toEqual([{ id: '42.36,-71.06', lat: 42.3601, lon: -71.0589, name: 'Boston, MA' }]);
    expect(new SavedLocationsService().getSavedLocations()).toEqual(list);
  });

  it('dedupes by id and keeps insertion order', () => {
    service.addSavedLocation(boston);
    service.addSavedLocation(denver);
    const list = service.addSavedLocation({ lat: 42.3617, lon: -71.0577, name: 'Boston again' });
    expect(list.map(entry => entry.id)).toEqual(['42.36,-71.06', '39.74,-104.99']);
    expect(list[0].name).toBe('Boston, MA');
  });

  it('removes a favorite by id', () => {
    service.addSavedLocation(boston);
    service.addSavedLocation(denver);
    const list = service.removeSavedLocation('42.36,-71.06');
    expect(list.map(entry => entry.id)).toEqual(['39.74,-104.99']);
    expect(service.isSaved(boston)).toBe(false);
  });

  it('reports isSaved by rounded coords', () => {
    service.addSavedLocation(boston);
    expect(service.isSaved({ lat: 42.3599, lon: -71.0601 })).toBe(true);
    expect(service.isSaved(denver)).toBe(false);
  });

  it('returns empty list for malformed JSON', () => {
    localStorage.setItem('solar_sentinel_saved_locations', '{not json');
    expect(service.getSavedLocations()).toEqual([]);
  });

  it('filters malformed entries from stored arrays', () => {
    localStorage.setItem(
      'solar_sentinel_saved_locations',
      JSON.stringify([{ id: '1.00,1.00', lat: 1, lon: 1, name: 'ok' }, { junk: true }, null])
    );
    expect(service.getSavedLocations()).toEqual([{ id: '1.00,1.00', lat: 1, lon: 1, name: 'ok' }]);
  });

  it('round-trips the selected location', () => {
    service.setSelectedLocation(boston, 'manual');
    const selected = service.getSelectedLocation();
    expect(selected?.location).toEqual(boston);
    expect(selected?.source).toBe('manual');
    expect(typeof selected?.timestamp).toBe('number');
  });

  it('clears the selected location', () => {
    service.setSelectedLocation(boston, 'manual');
    service.clearSelectedLocation();
    expect(service.getSelectedLocation()).toBeNull();
  });

  it('returns null for malformed selected location', () => {
    localStorage.setItem('solar_sentinel_selected_location', '{bad');
    expect(service.getSelectedLocation()).toBeNull();
    localStorage.setItem('solar_sentinel_selected_location', JSON.stringify({ source: 'manual' }));
    expect(service.getSelectedLocation()).toBeNull();
  });
});
