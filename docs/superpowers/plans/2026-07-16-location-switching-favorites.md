# Location Switching + Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user switch the viewed location from the UI (name search + "use my current location"), star/save favorite locations, keep switching instant via the existing per-location caches, and fix server timezone handling so any world location shows correct day boundaries.

**Architecture:** Frontend-owned feature per `docs/superpowers/specs/2026-07-16-location-switching-favorites-design.md`. Favorites and the explicit selection live in new localStorage keys keyed by the 2-decimal coord string every cache layer already uses. Geocoding search calls Open-Meteo's geocoding API directly from the browser. The only server change: `timezone=auto` + per-location "today"/date-window resolution.

**Tech Stack:** TypeScript ES modules (`.js` import extensions), Express (`server.js`, plain JS), Vitest + jsdom-style DOM tests, Tailwind CSS classes, pnpm.

## Global Constraints

- **pnpm only** — npm/yarn are blocked by a preinstall script.
- Local TS imports use `.js` extensions (ES-module requirement).
- Prettier: 2 spaces, single quotes, 100 char width. Run `pnpm run format` before each commit.
- Explicit typing with interfaces in `src/types/`, `type` imports, `private readonly` for class constants.
- Error handling: try/catch with `(error as Error).message`; localStorage access always in try/catch.
- **Nothing may slow the cache-hit instant-load path** — no new synchronous work before first paint.
- Test commands: `pnpm test` (all), `pnpm test src/test/<file>.test.ts` (single file), `pnpm run typecheck`.
- Commit only the files your task created/modified (`git add <paths>`, never `git add -A`). An untracked `bugs/` directory exists — never add it.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01FwGQdyDtFL5qXRHsYKsiss`
- Home location is Windham, NH `42.8006, -71.3048`; coord identity everywhere is `lat.toFixed(2),lon.toFixed(2)`.

---

### Task 1: Location types + SavedLocationsService

**Files:**
- Modify: `src/types/weather.ts` (append after the `Location` interface, ~line 70)
- Create: `src/services/savedLocations.ts`
- Test: `src/test/saved-locations.test.ts`

**Interfaces:**
- Consumes: `Location` from `src/types/weather.ts`.
- Produces (later tasks rely on these exact names):
  - Types `LocationSource = 'manual' | 'auto'`, `SavedLocation { id: string; lat: number; lon: number; name: string }`, `SelectedLocation { location: Location; source: LocationSource; timestamp: number }`.
  - Class `SavedLocationsService` with static `getLocationId(lat: number, lon: number): string` and methods `getSavedLocations(): SavedLocation[]`, `isSaved(location: Pick<Location, 'lat' | 'lon'>): boolean`, `addSavedLocation(location: Pick<Location, 'lat' | 'lon' | 'name'>): SavedLocation[]`, `removeSavedLocation(id: string): SavedLocation[]`, `getSelectedLocation(): SelectedLocation | null`, `setSelectedLocation(location: Location, source: LocationSource): void`, `clearSelectedLocation(): void`.

- [ ] **Step 1: Write the failing tests**

Read `src/test/location-cache.test.ts` first and reuse its localStorage mock/setup conventions (see `src/test/setup.ts`). Then create `src/test/saved-locations.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SavedLocationsService } from '../services/savedLocations.js';
import type { Location } from '../types/weather.js';

const boston: Location = { lat: 42.3601, lon: -71.0589, name: 'Boston, MA', isUserLocation: false };
const denver: Location = { lat: 39.7392, lon: -104.9903, name: 'Denver, CO', isUserLocation: false };

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/saved-locations.test.ts`
Expected: FAIL — cannot resolve `../services/savedLocations.js`.

- [ ] **Step 3: Add types and implement the service**

Append to `src/types/weather.ts` (directly after the `Location` interface):

```ts
export type LocationSource = 'manual' | 'auto';

export interface SavedLocation {
  id: string; // 2-decimal coord key, e.g. "42.80,-71.30" — matches all cache keying
  lat: number;
  lon: number;
  name: string;
}

export interface SelectedLocation {
  location: Location;
  source: LocationSource;
  timestamp: number;
}
```

Create `src/services/savedLocations.ts`:

```ts
import type { Location, LocationSource, SavedLocation, SelectedLocation } from '../types/weather.js';

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
```

- [ ] **Step 4: Run tests + typecheck to verify pass**

Run: `pnpm test src/test/saved-locations.test.ts && pnpm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Format and commit**

```bash
pnpm run format
git add src/types/weather.ts src/services/savedLocations.ts src/test/saved-locations.test.ts
git commit -m "Add saved-locations and selected-location stores"
```

---

### Task 2: GeocodingService (Open-Meteo name search)

**Files:**
- Create: `src/services/geocoding.ts`
- Test: `src/test/geocoding.test.ts`

**Interfaces:**
- Produces: `GeocodingResult { lat: number; lon: number; name: string }` and `GeocodingService` with `searchLocations(query: string): Promise<GeocodingResult[]>` (returns `[]` for queries shorter than 2 trimmed chars; throws `Error` on non-ok response or network failure).

- [ ] **Step 1: Write the failing tests**

Look at how `src/test/services.test.ts` mocks `global.fetch`, then create `src/test/geocoding.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/geocoding.test.ts`
Expected: FAIL — cannot resolve `../services/geocoding.js`.

- [ ] **Step 3: Implement the service**

Create `src/services/geocoding.ts`:

```ts
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
```

- [ ] **Step 4: Run tests + typecheck to verify pass**

Run: `pnpm test src/test/geocoding.test.ts && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm run format
git add src/services/geocoding.ts src/test/geocoding.test.ts
git commit -m "Add Open-Meteo geocoding search service"
```

---

### Task 3: Expired-cache sweep in WeatherAPI + idle wiring

**Files:**
- Modify: `src/services/api.ts` (add one public method to `WeatherAPI`)
- Modify: `src/app.ts` (`initialize()`, currently ~line 69)
- Test: `src/test/cache-sweep.test.ts`

**Interfaces:**
- Consumes: existing private constants `WEATHER_CACHE_PREFIX` (`'solar_sentinel_weather'`), `CALENDAR_CACHE_PREFIX` (`'solar_sentinel_calendar'`), `WEATHER_CACHE_DURATION_MS` (6 h) in `WeatherAPI`.
- Produces: `WeatherAPI.sweepExpiredCache(): number` (count of entries removed).

- [ ] **Step 1: Write the failing tests**

Create `src/test/cache-sweep.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { WeatherAPI } from '../services/api.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function entry(ageMs: number): string {
  return JSON.stringify({ data: { date: '2026-07-16' }, timestamp: Date.now() - ageMs });
}

describe('WeatherAPI.sweepExpiredCache', () => {
  let api: WeatherAPI;

  beforeEach(() => {
    localStorage.clear();
    api = new WeatherAPI();
  });

  it('removes expired weather and calendar entries, keeps fresh ones', () => {
    localStorage.setItem('solar_sentinel_weather_42.80,-71.30,2026-07-15', entry(SIX_HOURS_MS + 1000));
    localStorage.setItem('solar_sentinel_calendar_39.74,-104.99,2026-07-10', entry(SIX_HOURS_MS + 1000));
    localStorage.setItem('solar_sentinel_weather_42.80,-71.30,2026-07-16', entry(1000));

    const removed = api.sweepExpiredCache();

    expect(removed).toBe(2);
    expect(localStorage.getItem('solar_sentinel_weather_42.80,-71.30,2026-07-15')).toBeNull();
    expect(localStorage.getItem('solar_sentinel_calendar_39.74,-104.99,2026-07-10')).toBeNull();
    expect(localStorage.getItem('solar_sentinel_weather_42.80,-71.30,2026-07-16')).not.toBeNull();
  });

  it('removes malformed cache entries', () => {
    localStorage.setItem('solar_sentinel_weather_42.80,-71.30,2026-07-16', '{corrupt');
    expect(api.sweepExpiredCache()).toBe(1);
    expect(localStorage.getItem('solar_sentinel_weather_42.80,-71.30,2026-07-16')).toBeNull();
  });

  it('never touches non-cache keys', () => {
    localStorage.setItem('solar_sentinel_location', '{"lat":1}');
    localStorage.setItem('solar_sentinel_saved_locations', '[]');
    localStorage.setItem('solar_sentinel_selected_location', '{}');
    localStorage.setItem('unrelated', 'x');

    expect(api.sweepExpiredCache()).toBe(0);
    expect(localStorage.getItem('solar_sentinel_location')).toBe('{"lat":1}');
    expect(localStorage.getItem('solar_sentinel_saved_locations')).toBe('[]');
    expect(localStorage.getItem('solar_sentinel_selected_location')).toBe('{}');
    expect(localStorage.getItem('unrelated')).toBe('x');
  });
});
```

NOTE: the mocked localStorage in `src/test/setup.ts` may not implement `length`/`key(i)`. If so, extend the mock there to support them (backed by its internal store) rather than changing the implementation approach.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/cache-sweep.test.ts`
Expected: FAIL — `sweepExpiredCache is not a function`.

- [ ] **Step 3: Implement sweep + wire into initialize**

Add to `WeatherAPI` in `src/services/api.ts` (after `getCalendarCacheKey`):

```ts
// Expired entries are normally only evicted when read; this sweep clears
// entries for locations the user stopped viewing so they don't linger forever.
sweepExpiredCache(): number {
  let removed = 0;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const isCacheKey =
        key.startsWith(`${this.WEATHER_CACHE_PREFIX}_`) ||
        key.startsWith(`${this.CALENDAR_CACHE_PREFIX}_`);
      if (!isCacheKey) continue;

      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? '');
        const expired =
          !parsed ||
          typeof parsed.timestamp !== 'number' ||
          Date.now() - parsed.timestamp > this.WEATHER_CACHE_DURATION_MS;
        if (expired) keysToRemove.push(key);
      } catch {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
      removed++;
    }
  } catch (error) {
    console.log('Cache sweep error:', (error as Error).message);
  }
  return removed;
}
```

Wire into `SolarSentinelApp.initialize()` in `src/app.ts`, after `this.scheduleAutoRefresh();` and before the final `markPerformance` (idle so it cannot slow first paint):

```ts
this.scheduleCacheSweep();
```

And add the private method next to `scheduleAutoRefresh`:

```ts
private scheduleCacheSweep(): void {
  const runSweep = () => {
    const removed = this.api.sweepExpiredCache();
    this.debugPanel.log(`Cache sweep removed ${removed} expired entries`);
  };
  const idleCallback = (
    window as Window & { requestIdleCallback?: (callback: () => void) => number }
  ).requestIdleCallback;
  if (idleCallback) {
    idleCallback(runSweep);
  } else {
    window.setTimeout(runSweep, 3000);
  }
}
```

- [ ] **Step 4: Run tests + typecheck to verify pass**

Run: `pnpm test src/test/cache-sweep.test.ts && pnpm run typecheck && pnpm test`
Expected: all PASS (full run guards against setup.ts mock changes breaking other suites).

- [ ] **Step 5: Format and commit**

```bash
pnpm run format
git add src/services/api.ts src/app.ts src/test/cache-sweep.test.ts src/test/setup.ts
git commit -m "Sweep expired weather caches at idle after startup"
```

(Only add `src/test/setup.ts` if you actually modified it.)

---

### Task 4: Server timezone fix (`timezone=auto`, per-location today)

**Files:**
- Modify: `server.js`
- Test: `src/test/server.api.test.ts` (extend; adjust any tests asserting the old past-date 400)

**Interfaces:**
- Consumes: existing `forecastCache`, `getForecastCacheKey`, `hasUsableForecast`, `handleForecastRequest` in `server.js`.
- Produces (internal to server.js, used by tests via HTTP):
  - `getTodayInTimezone(timeZone: string): string` (YYYY-MM-DD; falls back to UTC on bad tz)
  - `addDays(dateString: string, days: number): string`
  - `resolveRequestedDate(forecastData, requestedDate) → { date } | { error: { status, message } }` — missing or past dates clamp to the location's today; dates beyond today+16 → 400.
  - `getForecast(lat, lon, requestedDate, requiredFields)` now also returns `date` (the resolved date) and may return `{ error }`.
  - Behavior change: requests for dates before the location's today are **clamped to today** (previously 400). The response `date` field tells the client what was served.

Read `src/test/server.api.test.ts` fully before changing anything — reuse its Open-Meteo fetch-mocking pattern and app-import setup exactly.

- [ ] **Step 1: Write the failing tests**

Add to `src/test/server.api.test.ts` (adapting to its existing mock harness; the upstream mock's response body must now include a `timezone` field, e.g. `'America/Denver'`, and hourly/daily arrays that span dates around Denver's today):

```js
describe('per-location timezone handling', () => {
  it('requests timezone=auto upstream', async () => {
    // trigger any forecast request with fresh coords, then:
    const upstreamUrl = fetchMock.mock.calls[0][0];
    expect(upstreamUrl).toContain('timezone=auto');
    expect(upstreamUrl).not.toContain('timezone=America');
  });

  it('defaults to today in the forecast timezone when no date is given', async () => {
    // upstream mock returns timezone 'Pacific/Honolulu' with daily.time starting at
    // Honolulu's today (compute via new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Honolulu' }))
    const response = await request(app).get('/api/weather?lat=21.31&lon=-157.86');
    expect(response.status).toBe(200);
    expect(response.body.date).toBe(
      new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Honolulu' })
    );
  });

  it('clamps dates before the location today to today instead of erroring', async () => {
    const honoluluToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Honolulu' });
    const yesterday = addDaysForTest(honoluluToday, -1); // helper: date-only UTC arithmetic
    const response = await request(app).get(`/api/weather?lat=21.31&lon=-157.86&date=${yesterday}`);
    expect(response.status).toBe(200);
    expect(response.body.date).toBe(honoluluToday);
  });

  it('rejects dates beyond the 16-day window', async () => {
    const honoluluToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Honolulu' });
    const tooFar = addDaysForTest(honoluluToday, 17);
    const response = await request(app).get(`/api/weather?lat=21.31&lon=-157.86&date=${tooFar}`);
    expect(response.status).toBe(400);
  });
});
```

Also update any existing tests that assert a 400 for past dates — they should now expect a 200 with `date` clamped to today (keep a 400 expectation only for the beyond-window case and malformed date format).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm test src/test/server.api.test.ts`
Expected: new tests FAIL (upstream URL contains `timezone=America/New_York`; past date returns 400).

- [ ] **Step 3: Implement in server.js**

1. Replace `getTodayInNewYork()` (lines ~383-387) and `getTimezone()` (lines ~589-591) with:

```js
const FORECAST_WINDOW_DAYS = 16;

// Today's date (YYYY-MM-DD) in the given IANA timezone; UTC on bad input.
function getTodayInTimezone(timeZone) {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone });
  } catch {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'UTC' });
  }
}

// Date-only arithmetic, timezone-free.
function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The served date can only be resolved once a forecast (and its real timezone)
// is in hand: missing/past dates clamp to the location's today; dates beyond
// the forecast window are rejected.
function resolveRequestedDate(forecastData, requestedDate) {
  const timeZone = forecastData?.timezone || 'UTC';
  const today = getTodayInTimezone(timeZone);
  if (!requestedDate || requestedDate < today) {
    return { date: today };
  }
  if (requestedDate > addDays(today, FORECAST_WINDOW_DAYS)) {
    return {
      error: { status: 400, message: 'Date must be between today and 16 days from today' },
    };
  }
  return { date: requestedDate };
}
```

2. Simplify `parseForecastRequest` — no default date, no window validation, no timezone:

```js
function parseForecastRequest(req) {
  const latParam = parseFloat(getStringQueryParam(req.query.lat));
  const lonParam = parseFloat(getStringQueryParam(req.query.lon));
  const lat = Number.isFinite(latParam) ? latParam : DEFAULT_LAT;
  const lon = Number.isFinite(lonParam) ? lonParam : DEFAULT_LON;
  const requestedDate = getStringQueryParam(req.query.date);

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { error: { status: 400, message: 'Invalid coordinates' } };
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (requestedDate && !dateRegex.test(requestedDate)) {
    return { error: { status: 400, message: 'Invalid date format. Use YYYY-MM-DD' } };
  }

  return { lat, lon, requestedDate };
}
```

3. `fetchForecastFromOpenMeteo(lat, lon)` — drop the `timezone` parameter; in the URL use `timezone=auto`. Drop the parameter through the whole chain: `fetchAndCacheForecast(lat, lon, cacheKey)`, `refreshForecastInBackground(lat, lon, cacheKey)`, `refreshIfStale(lat, lon, cacheKey, entry)`, `prewarmHomeForecast()` (which becomes just cacheKey + refresh call), and the two call sites inside `handleForecastRequest`.

4. Rework `getForecast` to resolve the date:

```js
async function getForecast(lat, lon, requestedDate, requiredFields) {
  const lookupStart = performance.now();
  const cacheKey = getForecastCacheKey(lat, lon);
  const cached = forecastCache.get(cacheKey);
  const cacheLookupMs = performance.now() - lookupStart;

  const validationStart = performance.now();
  if (cached) {
    const resolved = resolveRequestedDate(cached.data, requestedDate);
    if (resolved.error) return { error: resolved.error };
    if (hasUsableForecast(cached.data, resolved.date, requiredFields)) {
      return {
        cacheKey,
        cacheStatus: 'hit',
        entry: cached,
        date: resolved.date,
        performance: {
          cacheLookupMs,
          cacheValidationMs: performance.now() - validationStart,
        },
      };
    }
  }
  const cacheValidationMs = performance.now() - validationStart;

  const forecastWaitStart = performance.now();
  const entry = await fetchAndCacheForecast(lat, lon, cacheKey);
  const resolved = resolveRequestedDate(entry.data, requestedDate);
  if (resolved.error) return { error: resolved.error };
  return {
    cacheKey,
    cacheStatus: 'miss',
    entry,
    date: resolved.date,
    performance: {
      cacheLookupMs,
      cacheValidationMs,
      forecastWaitMs: performance.now() - forecastWaitStart,
    },
  };
}
```

5. In `handleForecastRequest`: destructure `const { lat, lon, requestedDate } = request;`; after `getForecast(...)` returns, handle the error case and use the resolved date:

```js
const forecastResult = await getForecast(lat, lon, requestedDate, requiredFields);
timer.measure('getForecast', forecastStart);
if (forecastResult.error) {
  responseContext = { ...responseContext, error: forecastResult.error.message };
  return res.status(forecastResult.error.status).json({ error: forecastResult.error.message });
}
const { cacheKey, cacheStatus, entry, date, performance: forecastPerformance } = forecastResult;
```

…then `buildData(entry.data, date)`, `refreshIfStale(lat, lon, cacheKey, entry)`, and include `date` in `responseContext`.

- [ ] **Step 4: Run the full server suite + all tests**

Run: `pnpm test src/test/server.api.test.ts && pnpm test`
Expected: all PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm run format
git add server.js src/test/server.api.test.ts
git commit -m "Resolve forecast dates in each location's own timezone"
```

---

### Task 5: App location-selection logic (manual pick wins)

**Files:**
- Modify: `src/app.ts`
- Test: `src/test/location-selection.test.ts`

**Interfaces:**
- Consumes: `SavedLocationsService`, types from Task 1; existing `LocationService`, `loadData`, `prepareHomeFirstLocation`, `refreshLocationInBackground`, `updateHistoryControls`, `updateLocationDisplay` in `src/app.ts`.
- Produces (Task 6 relies on these exact names on `SolarSentinelApp`):
  - `selectLocation(location: Location, source?: LocationSource): void` (default `'manual'`)
  - `useCurrentLocation(): void`
  - `toggleFavorite(location: Location): void`
  - `private readonly savedLocationsService = new SavedLocationsService();` field
  - Startup rule: when a stored selection has `source: 'manual'`, `loadData` uses it and skips `prepareHomeFirstLocation()`/`refreshLocationInBackground()` entirely.

- [ ] **Step 1: Write the failing tests**

Read `src/test/navigation.test.ts` first and copy its harness (DOM scaffold, geolocation failure mock, fetch mocking, app construction — including the `#location-display` element). Create `src/test/location-selection.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SolarSentinelApp } from '../app.js';
import { SavedLocationsService } from '../services/savedLocations.js';
import type { Location } from '../types/weather.js';

// Reuse the DOM scaffold + fetch/geolocation mocks from navigation.test.ts verbatim.

const denver: Location = { lat: 39.7392, lon: -104.9903, name: 'Denver, CO', isUserLocation: false };

describe('location selection', () => {
  beforeEach(() => {
    localStorage.clear();
    // ...same DOM + mock setup as navigation.test.ts...
  });

  it('boots into a stored manual selection and skips geolocation', async () => {
    new SavedLocationsService().setSelectedLocation(denver, 'manual');
    const geoSpy = vi.spyOn(navigator.geolocation, 'getCurrentPosition');

    const app = new SolarSentinelApp();
    await app.initialize();

    expect(document.getElementById('location-display')?.textContent).toContain('Denver, CO');
    expect(geoSpy).not.toHaveBeenCalled();
    // fetch was called with Denver coords
    const weatherCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map(call => String(call[0]))
      .find(url => url.includes('/api/weather'));
    expect(weatherCall).toContain('lat=39.7392');
  });

  it('selectLocation persists the manual selection and reloads', async () => {
    const app = new SolarSentinelApp();
    await app.initialize();

    app.selectLocation(denver);

    const stored = new SavedLocationsService().getSelectedLocation();
    expect(stored?.source).toBe('manual');
    expect(stored?.location.name).toBe('Denver, CO');
    expect(document.getElementById('location-display')?.textContent).toContain('Denver, CO');
  });

  it('useCurrentLocation clears the manual selection and restores the auto flow', async () => {
    new SavedLocationsService().setSelectedLocation(denver, 'manual');
    const app = new SolarSentinelApp();
    await app.initialize();

    const geoSpy = vi.spyOn(navigator.geolocation, 'getCurrentPosition');
    app.useCurrentLocation();

    expect(new SavedLocationsService().getSelectedLocation()).toBeNull();
    expect(geoSpy).toHaveBeenCalled(); // home-first flow geolocates in the background
    expect(document.getElementById('location-display')?.textContent).toContain('Windham, NH');
  });

  it('toggleFavorite adds then removes the location', async () => {
    const app = new SolarSentinelApp();
    await app.initialize();

    app.toggleFavorite(denver);
    expect(new SavedLocationsService().isSaved(denver)).toBe(true);
    app.toggleFavorite(denver);
    expect(new SavedLocationsService().isSaved(denver)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/location-selection.test.ts`
Expected: FAIL — `selectLocation is not a function` (first test may also fail on geolocation being called).

- [ ] **Step 3: Implement in src/app.ts**

1. Imports:

```ts
import { SavedLocationsService } from './services/savedLocations.js';
```
and add `LocationSource`, `SelectedLocation` to the `type` import from `./types/weather.js`.

2. Field (next to `locationService`, ~line 30):

```ts
private readonly savedLocationsService = new SavedLocationsService();
```

3. In `loadData` (~line 139), replace the two-line location block:

```ts
this.prepareHomeFirstLocation();
this.refreshLocationInBackground();
```

with:

```ts
const manualSelection = this.getManualSelection();
if (manualSelection) {
  this.currentLocation = manualSelection.location;
} else {
  this.prepareHomeFirstLocation();
  this.refreshLocationInBackground();
}
```

4. New methods (place after `updateLocationDisplay`, ~line 306):

```ts
private getManualSelection(): SelectedLocation | null {
  const selected = this.savedLocationsService.getSelectedLocation();
  return selected?.source === 'manual' ? selected : null;
}

selectLocation(location: Location, source: LocationSource = 'manual'): void {
  this.debugPanel.log(`Location selected: ${location.name}`, {
    coords: `${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`,
    source,
  });
  this.savedLocationsService.setSelectedLocation(location, source);
  this.applyLocationChange(location);
}

useCurrentLocation(): void {
  this.debugPanel.log('Location: use current location requested');
  this.savedLocationsService.clearSelectedLocation();
  // Home-first + background geolocation resumes inside loadData now that no
  // manual selection is stored.
  this.applyLocationChange(this.locationService.getDefaultLocation());
}

toggleFavorite(location: Location): void {
  if (this.savedLocationsService.isSaved(location)) {
    this.savedLocationsService.removeSavedLocation(
      SavedLocationsService.getLocationId(location.lat, location.lon)
    );
  } else {
    this.savedLocationsService.addSavedLocation(location);
  }
}

private applyLocationChange(location: Location): void {
  this.currentLocation = location;
  this.historyMode = false;
  this.latestWeatherData = null;
  this.latestCalendarData = null;
  this.weatherHistory = [];
  this.calendarHistory = [];
  this.historyTimeline = [];
  this.updateHistoryControls();
  this.updateLocationDisplay();
  void this.loadData();
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test src/test/location-selection.test.ts && pnpm run typecheck && pnpm test`
Expected: all PASS (full run confirms navigation tests still green).

- [ ] **Step 5: Format and commit**

```bash
pnpm run format
git add src/app.ts src/test/location-selection.test.ts
git commit -m "Make manual location picks win over background geolocation"
```

---

### Task 6: Location picker UI

**Files:**
- Modify: `src/index.html` (header, ~line 48)
- Create: `src/components/locationPicker.ts`
- Modify: `src/app.ts` (`setupEventListeners`, `updateLocationDisplay`)
- Test: `src/test/location-picker.test.ts`

**Interfaces:**
- Consumes: `SavedLocation`, `Location` types; `GeocodingResult`/`GeocodingService` (Task 2); app methods `selectLocation`, `useCurrentLocation`, `toggleFavorite` (Task 5); `LocationService.getDefaultLocation()`, `isHomeLocation()`; `SavedLocationsService.getSavedLocations()`, `isSaved()`.
- Produces: `LocationPicker` class with `constructor(options: LocationPickerOptions)`, `toggle(): void`, `open(): void`, `close(): void`, `refresh(): void` and:

```ts
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
```

- [ ] **Step 1: Update the HTML shell**

In `src/index.html`, replace line 48:

```html
<p id="location-display" class="text-gray-600 text-sm">📍 Getting location...</p>
```

with:

```html
<div class="relative inline-block">
  <button
    id="location-display"
    class="cursor-pointer text-gray-600 text-sm hover:text-gray-900"
    type="button"
    aria-haspopup="true"
    aria-expanded="false"
  >
    📍 Getting location...
  </button>
  <div
    id="location-picker"
    class="hidden absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-gray-200 bg-white text-left text-sm shadow-xl"
  ></div>
</div>
```

- [ ] **Step 2: Write the failing tests**

Create `src/test/location-picker.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocationPicker, type LocationPickerOptions } from '../components/locationPicker.js';
import type { Location, SavedLocation } from '../types/weather.js';

const home: Location = { lat: 42.8006, lon: -71.3048, name: 'Windham, NH', isUserLocation: false };
const denver: Location = { lat: 39.7392, lon: -104.9903, name: 'Denver, CO', isUserLocation: false };
const denverSaved: SavedLocation = { id: '39.74,-104.99', lat: 39.7392, lon: -104.9903, name: 'Denver, CO' };

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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test src/test/location-picker.test.ts`
Expected: FAIL — cannot resolve `../components/locationPicker.js`.

- [ ] **Step 4: Implement the component**

Create `src/components/locationPicker.ts`:

```ts
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
    results.querySelectorAll<HTMLElement>('[data-picker-action="toggle-favorite"]').forEach(star => {
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
```

- [ ] **Step 5: Wire into the app**

In `src/app.ts`:

1. Import:

```ts
import { LocationPicker } from './components/locationPicker.js';
import { GeocodingService } from './services/geocoding.js';
```

2. Fields:

```ts
private readonly geocodingService = new GeocodingService();
private locationPicker: LocationPicker | null = null;
```

3. In `setupEventListeners()` (end of the method):

```ts
this.locationPicker = new LocationPicker({
  getHomeLocation: () => this.locationService.getDefaultLocation(),
  getCurrentLocation: () => this.currentLocation,
  getSavedLocations: () => this.savedLocationsService.getSavedLocations(),
  isSaved: location => this.savedLocationsService.isSaved(location),
  isHomeLocation: location => this.locationService.isHomeLocation(location),
  onSelectLocation: location => this.selectLocation(location),
  onUseCurrentLocation: () => this.useCurrentLocation(),
  onToggleFavorite: location => this.toggleFavorite(location),
  searchLocations: query => this.geocodingService.searchLocations(query),
});
document
  .getElementById('location-display')
  ?.addEventListener('click', () => this.locationPicker?.toggle());
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm test src/test/location-picker.test.ts && pnpm run typecheck && pnpm test`
Expected: all PASS. If `navigation.test.ts` or others scaffold `#location-display` as a `<p>`, update those scaffolds to the new button+container markup.

- [ ] **Step 7: Format and commit**

```bash
pnpm run format
git add src/index.html src/components/locationPicker.ts src/app.ts src/test/location-picker.test.ts
git commit -m "Add location picker with favorites and name search"
```

(Include any test scaffolds you updated.)

---

### Task 7: Date navigation bounds from calendar data

**Files:**
- Modify: `src/app.ts` (`navigateDate` ~line 1377, `selectForecastDate` ~line 1252, `updateDateNavigationControls` ~line 1403, `loadData` after the weather fetch ~line 172)
- Test: `src/test/navigation.test.ts` (extend)

**Interfaces:**
- Consumes: `latestCalendarData: DailyCalendarData | null` (already on the app class; has `startDate`/`endDate` strings).
- Produces: `private getDateBounds(): { min: string; max: string }`; `loadData` adopts the server-resolved `data.date` as `currentDate` when it differs.

- [ ] **Step 1: Write the failing tests**

Add to `src/test/navigation.test.ts` (reusing its harness; make the mocked `/api/daily-calendar` response return a narrow range, and the mocked `/api/weather` response return a shifted `date`):

```ts
it('clamps navigation to the calendar range when available', async () => {
  // mock /api/daily-calendar to return { startDate: <today>, endDate: <today+2>, days: [...] }
  // initialize app, wait for load
  // navigate forward 3 times; date-display should stop at today+2
});

it('adopts the server-resolved date from the weather response', async () => {
  // mock /api/weather to return date: <today+1> (server clamped/resolved)
  // after loadData completes, expect the app to render today+1 and request
  //   subsequent data for today+1
});
```

Write these as real tests against the existing harness (the current suite drives `#next-day` clicks and asserts `#date-display`); follow its exact async/mock patterns.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/navigation.test.ts`
Expected: new tests FAIL (navigation currently allows today+16 regardless; `currentDate` never adopts the response date).

- [ ] **Step 3: Implement in src/app.ts**

1. Add helper (near `parseLocalDate`):

```ts
// Prefer the server-provided calendar range (correct for the location's
// timezone); fall back to device-local today..+16 before the calendar loads.
private getDateBounds(): { min: string; max: string } {
  if (this.latestCalendarData?.startDate && this.latestCalendarData?.endDate) {
    return { min: this.latestCalendarData.startDate, max: this.latestCalendarData.endDate };
  }
  const today = new Date();
  const max = new Date(today);
  max.setDate(max.getDate() + 16);
  return {
    min: today.toLocaleDateString('en-CA'),
    max: max.toLocaleDateString('en-CA'),
  };
}
```

2. Rewrite `navigateDate` with string comparisons:

```ts
private navigateDate(direction: number): void {
  const [year, month, day] = this.currentDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + direction);
  const newDate = date.toISOString().slice(0, 10);

  const bounds = this.getDateBounds();
  if (newDate < bounds.min || newDate > bounds.max) return;

  this.debugPanel.log(`Date navigation: ${this.currentDate} → ${newDate}`, { direction });
  this.currentDate = newDate;
  this.latestWeatherData = null;
  if (this.historyMode) {
    void this.refreshHistoryForDateChange();
    void this.loadData(true);
  } else {
    this.weatherHistory = [];
    this.updateHistoryControls();
    this.loadData();
  }
}
```

3. In `selectForecastDate`, replace the `Date`-based range check (lines ~1257-1265) with:

```ts
const bounds = this.getDateBounds();
if (dateString < bounds.min || dateString > bounds.max) {
  return;
}
```

(remove the now-unused `date`/`today`/`maxDate` locals).

4. Rewrite `updateDateNavigationControls`:

```ts
private updateDateNavigationControls(): void {
  const bounds = this.getDateBounds();
  document.getElementById('prev-day')?.classList.toggle('hidden', this.currentDate <= bounds.min);
  document.getElementById('next-day')?.classList.toggle('hidden', this.currentDate >= bounds.max);
}
```

5. In `loadData`, right after `this.latestWeatherData = data;` (the fetch result, ~line 172), adopt the server-resolved date:

```ts
if (data.date && data.date !== this.currentDate) {
  this.debugPanel.log(`Date resolved by server: ${this.currentDate} → ${data.date}`);
  this.currentDate = data.date;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test src/test/navigation.test.ts && pnpm run typecheck && pnpm test`
Expected: all PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm run format
git add src/app.ts src/test/navigation.test.ts
git commit -m "Clamp date navigation to the server calendar range"
```

---

### Task 8: Docs + final verification

**Files:**
- Modify: `AGENTS.md` (Architecture + Weather Data sections)
- No code changes expected.

- [ ] **Step 1: Update AGENTS.md**

In the Architecture section, add after the geolocation bullet:

```markdown
- Users can switch locations from the header location button: a picker with pinned Home, starred favorites, "use my current location", and Open-Meteo geocoding name search (`src/components/locationPicker.ts`, `src/services/geocoding.ts`)
- Favorites live in localStorage `solar_sentinel_saved_locations`; the explicit selection in `solar_sentinel_selected_location` (`src/services/savedLocations.ts`). A manual pick persists across reloads and disables background geolocation until "use my current location" is chosen
- Expired weather/calendar localStorage entries are swept at idle after startup (`WeatherAPI.sweepExpiredCache`)
```

In the Weather Data section, replace:

```markdown
- Use `America/New_York` for Windham/home data and existing US-longitude timezone behavior
```

with:

```markdown
- Forecasts are fetched with `timezone=auto`; "today" and the today→+16 date window are resolved in each location's own timezone after cache lookup (`resolveRequestedDate` in server.js). Past dates clamp to the location's today; the response `date` field is authoritative and the frontend adopts it
```

- [ ] **Step 2: Full verification**

Run: `pnpm test && pnpm run typecheck && pnpm run format:check && pnpm run build`
Expected: all pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "Document location switching, favorites, and per-timezone dates"
```
