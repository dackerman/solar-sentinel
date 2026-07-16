export interface GeocodingResult {
  lat: number;
  lon: number;
  name: string;
}

interface OpenMeteoGeocodingResult {
  latitude?: number;
  longitude?: number;
  name?: string;
  admin1?: string;
  country?: string;
  country_code?: string;
}

export class GeocodingService {
  private readonly BASE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  private readonly RESULT_COUNT = 5;
  private readonly MIN_QUERY_LENGTH = 2;

  async searchLocations(query: string): Promise<GeocodingResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < this.MIN_QUERY_LENGTH) return [];

    const url = `${this.BASE_URL}?name=${encodeURIComponent(trimmed)}&count=${this.RESULT_COUNT}&language=en&format=json`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Geocoding failed: ${response.status}`);
    }

    const data = (await response.json()) as { results?: OpenMeteoGeocodingResult[] };
    const results = Array.isArray(data.results) ? data.results : [];
    return results
      .filter(result => Number.isFinite(result.latitude) && Number.isFinite(result.longitude))
      .map(result => ({
        lat: result.latitude as number,
        lon: result.longitude as number,
        name: this.formatResultName(result),
      }));
  }

  private formatResultName(result: OpenMeteoGeocodingResult): string {
    const parts = [result.name, result.admin1];
    if (result.country_code !== 'US' && result.country) {
      parts.push(result.country);
    }
    return parts.filter(Boolean).join(', ') || 'Unknown location';
  }
}
