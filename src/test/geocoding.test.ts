import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeocodingService } from '../services/geocoding.js';

describe('GeocodingService', () => {
  let service: GeocodingService;

  beforeEach(() => {
    service = new GeocodingService();
    vi.restoreAllMocks();
  });

  it('returns [] without fetching for short queries', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    expect(await service.searchLocations(' a ')).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps Open-Meteo results, hiding the country for US results', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            latitude: 39.7392,
            longitude: -104.9847,
            name: 'Denver',
            admin1: 'Colorado',
            country: 'United States',
            country_code: 'US',
          },
          {
            latitude: 51.5085,
            longitude: -0.1257,
            name: 'London',
            admin1: 'England',
            country: 'United Kingdom',
            country_code: 'GB',
          },
        ],
      }),
    } as unknown as Response);

    const results = await service.searchLocations('den');
    expect(results).toEqual([
      { lat: 39.7392, lon: -104.9847, name: 'Denver, Colorado' },
      { lat: 51.5085, lon: -0.1257, name: 'London, England, United Kingdom' },
    ]);
  });

  it('encodes the query and requests 5 english results', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    } as unknown as Response);

    await service.searchLocations('new york');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://geocoding-api.open-meteo.com/v1/search?name=new%20york&count=5&language=en&format=json'
    );
  });

  it('returns [] when the API has no results field', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ generationtime_ms: 0.5 }),
    } as unknown as Response);
    expect(await service.searchLocations('zzzzz')).toEqual([]);
  });

  it('skips results without finite coordinates', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ name: 'Nowhere', latitude: null, longitude: -1 }] }),
    } as unknown as Response);
    expect(await service.searchLocations('nowhere')).toEqual([]);
  });

  it('throws on a non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 429 } as unknown as Response);
    await expect(service.searchLocations('boston')).rejects.toThrow('Geocoding failed: 429');
  });
});
