# Android Home-Screen Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android home-screen widget showing today's Solar Sentinel summary (high temp, UV now/max, rain timing, daily weather art), fed by a new `/api/widget` endpoint.

**Architecture:** Thin widget + smart server. The server gains `GET /api/widget` returning render-ready fields (rain label computed from hourly precipitation probability, art URL chosen by the existing weather-art logic, shared via a plain-JS module). A small Kotlin app in `android/` renders a Jetpack Glance widget, refreshed every 30 minutes by WorkManager using coarse device location (fallback: Windham), authenticating through Cloudflare Access with a service token.

**Tech Stack:** Node/Express (server.js, plain JS ESM), Vitest + supertest, Kotlin 2.0 / Jetpack Glance 1.1 / WorkManager / OkHttp / kotlinx-serialization, Gradle 8.9 + AGP 8.5.2.

**Spec:** `docs/superpowers/specs/2026-07-28-android-widget-design.md`. One approved deviation: the response's freshness timestamp is the existing `metadata.lastUpdated` field (added automatically by `sendForecastResponse`) instead of a top-level `updatedAt`.

## Global Constraints

- **pnpm only** — npm/yarn are blocked by a preinstall script.
- Local TS/JS imports use `.js` extensions (ESM requirement); `server.js` is plain JS and cannot import `.ts` files.
- Prettier: 2 spaces, single quotes, 100 char width. Run `pnpm run format` on changed JS/TS before committing.
- The `/api/weather` cache-hit path must not get slower; `/api/widget` reuses the same cached forecast via `handleForecastRequest`.
- Never commit secrets: Cloudflare Access token values live only in `android/local.properties` (gitignored).
- Docker code changes need a full rebuild: `docker compose down && docker compose up -d --build` (external port 49877, internal 43187).
- Home/fallback location: Windham, NH `42.8006, -71.3048`.
- Bash scripts start with `#!/usr/bin/env bash` (NixOS).
- Server tests must be order-independent: use unique lat/lon per test so the module-level forecast cache never leaks between tests.

---

### Task 1: Share weatherArt as plain JS

Convert `src/utils/weatherArt.ts` into a JSDoc-typed plain-JS module + hand-written declaration file so `server.js` can import it. **No behavior change.** Existing importers already use the `'../utils/weatherArt.js'` specifier, so they keep working untouched.

**Files:**
- Create: `src/utils/weatherArt.js` (port of the current `.ts`)
- Create: `src/utils/weatherArt.d.ts`
- Delete: `src/utils/weatherArt.ts`

**Interfaces:**
- Produces: `getWeatherArt(input) -> { key, path, label, alt, bins }` and `getWeatherArtTempBand(tempF)` — identical signatures/behavior to today. `path` is like `/weather-art/v2/day-hot-partly-high-uv.webp`.

- [ ] **Step 1: Verify green baseline**

Run: `pnpm test src/test/weatherArt.test.ts src/test/weatherArtImage.test.ts -- --run` and `pnpm run typecheck`
Expected: all pass. (Vitest is watch-mode by default; `--run` runs once.)

- [ ] **Step 2: Create `src/utils/weatherArt.js`**

Copy the entire body of `src/utils/weatherArt.ts` and strip every TypeScript annotation (type exports, interfaces, parameter/return types, `Record<...>`/`Set<WeatherArtTempBand>` generics, `as` casts). Keep logic, constants, and function order **identical**. Add this JSDoc header at the top and JSDoc on the two exported functions:

```js
/**
 * Weather art selection. Shared by the frontend (src/app.ts) and server.js —
 * plain JS with JSDoc types so both can import it. Type declarations live in
 * weatherArt.d.ts; keep the two in sync.
 *
 * @typedef {'day' | 'night'} WeatherArtDaypart
 * @typedef {'freezing' | 'cold' | 'cool' | 'mild' | 'warm' | 'hot'} WeatherArtTempBand
 * @typedef {'dry' | 'comfortable' | 'humid'} WeatherArtHumidityFeel
 * @typedef {{ tempF: number, uv?: number, precipChance?: number, humidity?: number,
 *   cloudCover?: number, weatherCode?: number, daypart?: WeatherArtDaypart }} WeatherArtInput
 * @typedef {{ key: string, path: string, label: string, alt: string,
 *   bins: { daypart: WeatherArtDaypart, tempBand: WeatherArtTempBand,
 *     humidityFeel?: WeatherArtHumidityFeel, condition: string } }} WeatherArtResult
 */
```

```js
/**
 * @param {WeatherArtInput} input
 * @returns {WeatherArtResult}
 */
export function getWeatherArt(input) {
```

```js
/**
 * @param {number} tempF
 * @returns {WeatherArtTempBand}
 */
export function getWeatherArtTempBand(tempF) {
```

Interior `interface WeatherArtClassification` disappears (it was type-only). `const parts: string[] = [...]` becomes `const parts = [...]`. `new Set<WeatherArtTempBand>([...])` becomes `new Set([...])`.

- [ ] **Step 3: Create `src/utils/weatherArt.d.ts`**

```ts
export type WeatherArtDaypart = 'day' | 'night';
export type WeatherArtTempBand = 'freezing' | 'cold' | 'cool' | 'mild' | 'warm' | 'hot';
export type WeatherArtHumidityFeel = 'dry' | 'comfortable' | 'humid';

export interface WeatherArtInput {
  tempF: number;
  uv?: number;
  precipChance?: number;
  humidity?: number;
  cloudCover?: number;
  weatherCode?: number;
  daypart?: WeatherArtDaypart;
}

export interface WeatherArtResult {
  key: string;
  path: string;
  label: string;
  alt: string;
  bins: {
    daypart: WeatherArtDaypart;
    tempBand: WeatherArtTempBand;
    humidityFeel?: WeatherArtHumidityFeel;
    condition: string;
  };
}

export declare function getWeatherArt(input: WeatherArtInput): WeatherArtResult;
export declare function getWeatherArtTempBand(tempF: number): WeatherArtTempBand;
```

- [ ] **Step 4: Delete `src/utils/weatherArt.ts`**

- [ ] **Step 5: Verify everything still passes**

Run: `pnpm test src/test/weatherArt.test.ts src/test/weatherArtImage.test.ts -- --run && pnpm run typecheck && pnpm run build`
Expected: all pass; Vite build succeeds (it bundles the `.js` module).

- [ ] **Step 6: Format and commit**

```bash
pnpm run format
git add -A src/utils
git commit -m "Share weather art selection as plain JS for server use"
```

---

### Task 2: Rain outlook module

Pure, unit-tested rain heuristic shared the same way as weatherArt.

**Files:**
- Create: `src/utils/rainOutlook.js`
- Create: `src/utils/rainOutlook.d.ts`
- Test: `src/test/rainOutlook.test.ts`

**Interfaces:**
- Produces: `buildRainOutlook(times: string[], probabilities: number[], date: string, currentHour: number) -> { label: string, startsAt?: string, probability: number }` and `formatHourLabel(hour: number) -> string`.

- [ ] **Step 1: Write the failing test `src/test/rainOutlook.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildRainOutlook, formatHourLabel } from '../utils/rainOutlook.js';

const DATE = '2026-07-28';
const hours = (...hs: number[]) => hs.map(h => `${DATE}T${String(h).padStart(2, '0')}:00`);

describe('formatHourLabel', () => {
  it('formats hours in compact 12-hour style', () => {
    expect(formatHourLabel(0)).toBe('12 AM');
    expect(formatHourLabel(9)).toBe('9 AM');
    expect(formatHourLabel(12)).toBe('12 PM');
    expect(formatHourLabel(14)).toBe('2 PM');
    expect(formatHourLabel(23)).toBe('11 PM');
  });
});

describe('buildRainOutlook', () => {
  it('reports the first upcoming hour at or above 50%', () => {
    const result = buildRainOutlook(hours(10, 11, 14, 15), [10, 20, 72, 80], DATE, 10);
    expect(result).toEqual({ label: 'Rain likely ~2 PM', startsAt: '14:00', probability: 72 });
  });

  it('reports rain now when the current hour qualifies', () => {
    const result = buildRainOutlook(hours(10, 11), [65, 40], DATE, 10);
    expect(result).toEqual({ label: 'Rain now', startsAt: '10:00', probability: 65 });
  });

  it('ignores hours before the current hour', () => {
    const result = buildRainOutlook(hours(8, 9, 10), [90, 95, 20], DATE, 10);
    expect(result).toEqual({ label: 'No rain expected', probability: 20 });
  });

  it('ignores other dates entirely', () => {
    const times = ['2026-07-27T14:00', `${DATE}T14:00`, '2026-07-29T14:00'];
    const result = buildRainOutlook(times, [99, 30, 99], DATE, 0);
    expect(result).toEqual({ label: 'No rain expected', probability: 30 });
  });

  it('reports the remaining max probability when no hour qualifies', () => {
    const result = buildRainOutlook(hours(10, 12, 16), [5, 35, 15], DATE, 10);
    expect(result).toEqual({ label: 'No rain expected', probability: 35 });
  });

  it('handles empty and missing data', () => {
    expect(buildRainOutlook([], [], DATE, 10)).toEqual({ label: 'No rain expected', probability: 0 });
    const result = buildRainOutlook(hours(10, 11), [Number.NaN, 20], DATE, 10);
    expect(result).toEqual({ label: 'No rain expected', probability: 20 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/test/rainOutlook.test.ts -- --run`
Expected: FAIL — cannot resolve `../utils/rainOutlook.js`.

- [ ] **Step 3: Implement `src/utils/rainOutlook.js`**

```js
/**
 * Rain outlook heuristic for the widget: when is rain (>= threshold) first
 * expected in the remainder of the day? Shared plain-JS module (see
 * weatherArt.js for the pattern); declarations in rainOutlook.d.ts.
 */

const RAIN_PROBABILITY_THRESHOLD = 50;

/**
 * Compact 12-hour label, e.g. 14 -> "2 PM".
 * @param {number} hour
 * @returns {string}
 */
export function formatHourLabel(hour) {
  const period = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${period}`;
}

/**
 * @param {string[]} times hourly local ISO timestamps ("2026-07-28T14:00")
 * @param {number[]} probabilities precipitation_probability values aligned with times
 * @param {string} date YYYY-MM-DD day to scan
 * @param {number} currentHour 0-23 in the location's timezone; earlier hours are ignored
 * @returns {{ label: string, startsAt?: string, probability: number }}
 */
export function buildRainOutlook(times, probabilities, date, currentHour) {
  let maxProbability = 0;

  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(`${date}T`)) continue;
    const hour = parseInt(times[i].slice(11, 13), 10);
    if (!Number.isFinite(hour) || hour < currentHour) continue;

    const probability = Number.isFinite(probabilities[i]) ? probabilities[i] : 0;
    if (probability >= RAIN_PROBABILITY_THRESHOLD) {
      return {
        label: hour === currentHour ? 'Rain now' : `Rain likely ~${formatHourLabel(hour)}`,
        startsAt: `${String(hour).padStart(2, '0')}:00`,
        probability,
      };
    }
    if (probability > maxProbability) maxProbability = probability;
  }

  return { label: 'No rain expected', probability: maxProbability };
}
```

And `src/utils/rainOutlook.d.ts`:

```ts
export declare function formatHourLabel(hour: number): string;
export declare function buildRainOutlook(
  times: string[],
  probabilities: number[],
  date: string,
  currentHour: number
): { label: string; startsAt?: string; probability: number };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/test/rainOutlook.test.ts -- --run && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm run format
git add src/utils/rainOutlook.js src/utils/rainOutlook.d.ts src/test/rainOutlook.test.ts
git commit -m "Add rain outlook heuristic for the widget endpoint"
```

---

### Task 3: `GET /api/widget` endpoint

**Files:**
- Modify: `server.js` (imports at top; helpers near `getTodayInTimezone` ~line 585 and `buildWeatherData` ~line 908; route after `/api/weather` ~line 954)
- Test: `src/test/widget.api.test.ts`

**Interfaces:**
- Consumes: `getWeatherArt` (Task 1), `buildRainOutlook` (Task 2), existing `handleForecastRequest`, `extractDailyData`, `getTodayInTimezone`.
- Produces: `GET /api/widget?lat=&lon=` →

```json
{
  "date": "2026-07-28",
  "tempNow": 84.1, "feelsLike": 88.0, "tempHigh": 91.2, "tempLow": 68.0,
  "uvNow": 6.2, "uvMax": 9.1,
  "rain": { "label": "Rain likely ~2 PM", "startsAt": "14:00", "probability": 72 },
  "weatherCode": 3,
  "artUrl": "https://host/weather-art/v2/day-hot-partly-high-uv.webp",
  "artLabel": "day hot partly cloudy, high UV",
  "metadata": { "cached": true, "cacheAge": 1234, "lastUpdated": "...", "performance": {} }
}
```

Numbers are raw (un-rounded) upstream values; the Android app formats them. Errors match the house style: `400 {"error": ...}` for bad coords, `502` on upstream failure.

- [ ] **Step 1: Write the failing test `src/test/widget.api.test.ts`**

Follow the conventions of `src/test/server.api.test.ts` (supertest against the exported `app`, mocked global fetch). Fake **only** `Date` so "now" is deterministic without breaking supertest's real I/O timers. Use timezone `UTC` in mock data so the current hour equals the faked UTC hour. Use a unique `lat`/`lon` per test (the server caches forecasts by rounded coords across tests).

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
// @ts-ignore - server.js doesn't have TypeScript declarations
import app from '../../server.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Freeze "now" at 14:30 UTC so the current hour in UTC-timezone mock data is 14.
const FAKE_NOW = '2026-07-28T14:30:00Z';
const TODAY = '2026-07-28';

function getMockForecast({ precip = [10, 20, 72, 80] } = {}) {
  return {
    timezone: 'UTC',
    hourly: {
      time: [`${TODAY}T10:00`, `${TODAY}T13:00`, `${TODAY}T14:00`, `${TODAY}T16:00`],
      uv_index: [3.0, 5.5, 6.2, 4.1],
      uv_index_clear_sky: [4.0, 7.0, 8.0, 6.0],
      precipitation_probability: precip,
      temperature_2m: [75.0, 82.3, 84.1, 83.0],
      apparent_temperature: [76.0, 85.2, 88.0, 86.1],
      cloud_cover: [10, 30, 40, 50],
      relative_humidity_2m: [50, 55, 60, 58],
      weather_code: [1, 2, 3, 3],
    },
    daily: {
      time: [TODAY],
      temperature_2m_max: [91.2],
      temperature_2m_min: [68.0],
      uv_index_max: [9.1],
      precipitation_probability_max: [80],
      relative_humidity_2m_max: [70],
      weather_code: [3],
    },
  };
}

function mockForecastResponse(data: unknown) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => data });
}

describe('GET /api/widget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FAKE_NOW));
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the render-ready day summary', async () => {
    mockForecastResponse(getMockForecast());
    const response = await request(app).get('/api/widget?lat=10.001&lon=10.001');

    expect(response.status).toBe(200);
    expect(response.body.date).toBe(TODAY);
    expect(response.body.tempNow).toBe(84.1);
    expect(response.body.feelsLike).toBe(88.0);
    expect(response.body.tempHigh).toBe(91.2);
    expect(response.body.tempLow).toBe(68.0);
    expect(response.body.uvNow).toBe(6.2);
    expect(response.body.uvMax).toBe(9.1);
    expect(response.body.weatherCode).toBe(3);
    expect(response.body.rain).toEqual({ label: 'Rain now', startsAt: '14:00', probability: 72 });
    expect(response.body.artUrl).toMatch(/\/weather-art\/v2\/day-.*\.webp$/);
    expect(typeof response.body.artLabel).toBe('string');
    expect(response.body.metadata.lastUpdated).toBeDefined();
  });

  it('reports upcoming rain with a time label', async () => {
    mockForecastResponse(getMockForecast({ precip: [10, 20, 30, 65] }));
    const response = await request(app).get('/api/widget?lat=11.002&lon=11.002');

    expect(response.status).toBe(200);
    expect(response.body.rain).toEqual({
      label: 'Rain likely ~4 PM',
      startsAt: '16:00',
      probability: 65,
    });
  });

  it('reports no rain with the remaining max probability', async () => {
    mockForecastResponse(getMockForecast({ precip: [90, 20, 15, 35] }));
    const response = await request(app).get('/api/widget?lat=12.003&lon=12.003');

    expect(response.status).toBe(200);
    expect(response.body.rain).toEqual({ label: 'No rain expected', probability: 35 });
  });

  it('builds an absolute artUrl from forwarded headers', async () => {
    mockForecastResponse(getMockForecast());
    const response = await request(app)
      .get('/api/widget?lat=13.004&lon=13.004')
      .set('X-Forwarded-Proto', 'https')
      .set('X-Forwarded-Host', 'solar.example.com');

    expect(response.status).toBe(200);
    expect(response.body.artUrl).toMatch(/^https:\/\/solar\.example\.com\/weather-art\/v2\//);
  });

  it('rejects invalid coordinates', async () => {
    const response = await request(app).get('/api/widget?lat=999&lon=0');
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/test/widget.api.test.ts -- --run`
Expected: FAIL — `/api/widget` returns 404 (route missing).

- [ ] **Step 3: Implement in `server.js`**

Add imports at the top with the other imports:

```js
import { getWeatherArt } from './src/utils/weatherArt.js';
import { buildRainOutlook } from './src/utils/rainOutlook.js';
```

Add next to `getTodayInTimezone` (~line 585):

```js
// Current hour (0-23) in the given IANA timezone; UTC on bad input.
function getCurrentHourInTimezone(timeZone) {
  const options = { hour: 'numeric', hourCycle: 'h23' };
  try {
    return parseInt(new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(new Date()), 10);
  } catch {
    return parseInt(
      new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date()),
      10
    );
  }
}
```

Add next to `buildWeatherData` (~line 908):

```js
// Public origin for absolute URLs; honors the Cloudflare tunnel's forwarded headers.
function getRequestBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const proto = String(forwardedProto || req.protocol || 'http').split(',')[0].trim();
  const host = String(forwardedHost || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

// Mirrors the frontend's daypart rule (src/app.ts getWeatherArtDaypart).
function getWidgetDaypart(hour) {
  return hour >= 6 && hour < 20 ? 'day' : 'night';
}

function buildWidgetData(forecastData, requestedDate, baseUrl) {
  const timeZone = forecastData.timezone || 'UTC';
  const isToday = requestedDate === getTodayInTimezone(timeZone);
  const currentHour = isToday ? getCurrentHourInTimezone(timeZone) : 12;
  const hourly = forecastData.hourly;
  const daily = extractDailyData(forecastData.daily, requestedDate);

  // The hour row shown as "now": latest hour at or before currentHour, else the day's first.
  let nowIndex;
  hourly.time.forEach((timestamp, index) => {
    if (!timestamp.startsWith(`${requestedDate}T`)) return;
    const hour = parseInt(timestamp.slice(11, 13), 10);
    if (nowIndex === undefined || hour <= currentHour) nowIndex = index;
  });

  const rain = buildRainOutlook(
    hourly.time,
    hourly.precipitation_probability,
    requestedDate,
    currentHour
  );
  const art = getWeatherArt({
    tempF: hourly.temperature_2m[nowIndex],
    uv: hourly.uv_index[nowIndex],
    precipChance: hourly.precipitation_probability[nowIndex],
    humidity: hourly.relative_humidity_2m[nowIndex],
    cloudCover: hourly.cloud_cover[nowIndex],
    weatherCode: hourly.weather_code?.[nowIndex],
    daypart: getWidgetDaypart(currentHour),
  });

  return {
    date: requestedDate,
    tempNow: hourly.temperature_2m[nowIndex],
    feelsLike: hourly.apparent_temperature[nowIndex],
    tempHigh: daily.tempMax,
    tempLow: daily.tempMin,
    uvNow: hourly.uv_index[nowIndex],
    uvMax: daily.uvMax,
    rain,
    weatherCode: daily.weatherCode,
    artUrl: `${baseUrl}${art.path}`,
    artLabel: art.label,
  };
}
```

Add the route after `/api/weather` (~line 954):

```js
// Widget endpoint: render-ready day summary for the Android home-screen widget
app.get('/api/widget', async (req, res) => {
  const baseUrl = getRequestBaseUrl(req);
  await handleForecastRequest(
    req,
    res,
    ['hourly', 'daily'],
    (forecastData, requestedDate) => buildWidgetData(forecastData, requestedDate, baseUrl),
    'Widget API',
    'Failed to fetch widget data. Please try again later.'
  );
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/test/widget.api.test.ts -- --run`
Expected: PASS (all 5).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `pnpm test -- --run && pnpm run typecheck`
Expected: everything green — proves the shared modules and server change broke nothing.

- [ ] **Step 6: Format and commit**

```bash
pnpm run format
git add server.js src/test/widget.api.test.ts
git commit -m "Add /api/widget render-ready summary endpoint"
```

---

### Task 4: Deploy + Cloudflare Access service token

**Main-session task (needs Docker + Cloudflare API credentials) — do not dispatch to a subagent.**

**Files:** none in-repo (Cloudflare config + local smoke test).

- [ ] **Step 1: Rebuild and verify locally**

```bash
docker compose down && docker compose up -d --build
curl -s "http://localhost:49877/api/widget" | head -c 400
```

Expected: JSON with `date`, `tempHigh`, `rain`, `artUrl` for Windham.

- [ ] **Step 2: Create a Cloudflare Access service token** (cloudflare skill) named `solar-sentinel-widget`; record its Client ID/Secret for Task 8's `local.properties`.

- [ ] **Step 3: Add a service-auth policy** to the existing Solar Sentinel Access application permitting that token (decision: `non_identity`/Service Auth). Leave existing human policies untouched.

- [ ] **Step 4: Verify through the tunnel**

```bash
curl -s -H "CF-Access-Client-Id: <id>" -H "CF-Access-Client-Secret: <secret>" \
  "https://<solar-sentinel-host>/api/widget" | head -c 400
```

Expected: same JSON shape; without headers, an Access denial. Also verify the returned `artUrl` downloads through the tunnel with the same headers (`curl -o /dev/null -w '%{http_code}'` → 200).

---

### Task 5: Android project scaffold

A Gradle project in `android/` that assembles an installable (still widget-less) debug APK, with BuildConfig wired to `local.properties`.

**Files:**
- Create: `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, `android/.gitignore`, `android/local.properties.example`, `android/app/build.gradle.kts`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/kotlin/com/solarsentinel/widget/MainActivity.kt`, `android/app/src/main/res/values/strings.xml`
- Create (generated): Gradle wrapper via `gradle wrapper`

**Interfaces:**
- Produces: package `com.solarsentinel.widget`; `BuildConfig.BASE_URL`, `BuildConfig.CF_ACCESS_CLIENT_ID`, `BuildConfig.CF_ACCESS_CLIENT_SECRET`, `BuildConfig.WEB_APP_URL` (all `String`), read from `local.properties`.

- [ ] **Step 1: `android/settings.gradle.kts`**

```kotlin
pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "solar-sentinel-widget"
include(":app")
```

- [ ] **Step 2: `android/build.gradle.kts`**

```kotlin
plugins {
  id("com.android.application") version "8.5.2" apply false
  id("org.jetbrains.kotlin.android") version "2.0.20" apply false
  id("org.jetbrains.kotlin.plugin.compose") version "2.0.20" apply false
  id("org.jetbrains.kotlin.plugin.serialization") version "2.0.20" apply false
}
```

- [ ] **Step 3: `android/gradle.properties`**

```properties
org.gradle.jvmargs=-Xmx2g
android.useAndroidX=true
kotlin.code.style=official
```

- [ ] **Step 4: `android/.gitignore`**

```
.gradle/
build/
local.properties
.kotlin/
```

- [ ] **Step 5: `android/local.properties.example`**

```properties
# Copy to local.properties and fill in. local.properties is gitignored — never commit it.
sdk.dir=/path/to/android-sdk
widget.baseUrl=https://solar.example.com
widget.webAppUrl=https://solar.example.com
widget.cfAccessClientId=xxx.access
widget.cfAccessClientSecret=xxx
```

- [ ] **Step 6: `android/app/build.gradle.kts`**

```kotlin
import java.util.Properties

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
  id("org.jetbrains.kotlin.plugin.serialization")
}

val localProperties =
  Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
  }

fun localProperty(name: String) = localProperties.getProperty(name, "")

android {
  namespace = "com.solarsentinel.widget"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.solarsentinel.widget"
    minSdk = 26
    targetSdk = 34
    versionCode = 1
    versionName = "1.0"

    buildConfigField("String", "BASE_URL", "\"${localProperty("widget.baseUrl")}\"")
    buildConfigField("String", "WEB_APP_URL", "\"${localProperty("widget.webAppUrl")}\"")
    buildConfigField("String", "CF_ACCESS_CLIENT_ID", "\"${localProperty("widget.cfAccessClientId")}\"")
    buildConfigField(
      "String",
      "CF_ACCESS_CLIENT_SECRET",
      "\"${localProperty("widget.cfAccessClientSecret")}\"",
    )
  }

  buildFeatures {
    buildConfig = true
    compose = true
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions { jvmTarget = "17" }

  sourceSets["main"].java.srcDirs("src/main/kotlin")
}

dependencies {
  implementation("androidx.glance:glance-appwidget:1.1.0")
  implementation("androidx.work:work-runtime-ktx:2.9.1")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.1")
  implementation("com.google.android.gms:play-services-location:21.3.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")
  implementation("androidx.activity:activity-ktx:1.9.1")

  testImplementation("junit:junit:4.13.2")
  testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.0.20")
}
```

- [ ] **Step 7: `android/app/src/main/AndroidManifest.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
  <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />

  <application
    android:label="@string/app_name"
    android:icon="@android:drawable/ic_menu_compass"
    android:allowBackup="false">

    <activity
      android:name=".MainActivity"
      android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
```

- [ ] **Step 8: `android/app/src/main/res/values/strings.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">Solar Sentinel</string>
  <string name="widget_description">Today\'s UV, temperature, and rain at a glance</string>
</resources>
```

- [ ] **Step 9: `MainActivity.kt`** (`android/app/src/main/kotlin/com/solarsentinel/widget/MainActivity.kt`)

Requests coarse location on launch (background access is granted manually via app settings) and explains setup:

```kotlin
package com.solarsentinel.widget

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.TextView

class MainActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val message = TextView(this)
    message.setPadding(48, 96, 48, 48)
    message.text =
      "Solar Sentinel widget\n\n" +
        "1. Grant location (While using the app)\n" +
        "2. In app settings, change location to 'Allow all the time' so the widget can " +
        "refresh in the background\n" +
        "3. Add the widget to your home screen\n\n" +
        "Without location, the widget shows Windham, NH."
    setContentView(message)

    val granted =
      checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
    if (!granted) {
      requestPermissions(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION), 1)
    }
  }
}
```

- [ ] **Step 10: Generate the Gradle wrapper and `local.properties`**

```bash
cd android
# NixOS: gradle may not be on PATH; use nix-shell if needed.
gradle wrapper --gradle-version 8.9 || nix-shell -p gradle --run 'gradle wrapper --gradle-version 8.9'
cp local.properties.example local.properties
```

Then set `sdk.dir` in `android/local.properties` to the real SDK path — check `~/code/android-remote-control/local.properties` or `$ANDROID_HOME` for it. Leave the widget.* placeholders for now (Task 8 fills them).

- [ ] **Step 11: Verify it assembles**

Run: `cd android && ./gradlew :app:assembleDebug`
Expected: BUILD SUCCESSFUL; APK at `android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 12: Commit**

```bash
git add android
git commit -m "Scaffold Android widget app"
```

(Verify `git status` shows no `local.properties` staged.)

---

### Task 6: Android data layer

Models + parsing, display formatting, disk store, HTTP client. JVM unit tests for the pure parts.

**Files:**
- Create: `android/app/src/main/kotlin/com/solarsentinel/widget/data/WidgetData.kt`
- Create: `android/app/src/main/kotlin/com/solarsentinel/widget/data/WidgetFormat.kt`
- Create: `android/app/src/main/kotlin/com/solarsentinel/widget/data/WidgetStore.kt`
- Create: `android/app/src/main/kotlin/com/solarsentinel/widget/data/WidgetApi.kt`
- Test: `android/app/src/test/kotlin/com/solarsentinel/widget/data/WidgetDataTest.kt`
- Test: `android/app/src/test/kotlin/com/solarsentinel/widget/data/WidgetFormatTest.kt`

**Interfaces:**
- Consumes: `BuildConfig` fields (Task 5); `/api/widget` JSON (Task 3).
- Produces: `WidgetData.fromJson(String): WidgetData`; `WidgetStore.save/load/artFile`; `WidgetApi.fetchWidgetJson(lat, lon): String`, `WidgetApi.downloadArtIfMissing(url, file)`; formatters `formatTemp`, `formatUv`, `formatUpdatedTime`.

- [ ] **Step 1: Write the failing tests**

`WidgetDataTest.kt`:

```kotlin
package com.solarsentinel.widget.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class WidgetDataTest {
  private val sample =
    """
    {
      "date": "2026-07-28",
      "tempNow": 84.1, "feelsLike": 88.0, "tempHigh": 91.2, "tempLow": 68.0,
      "uvNow": 6.2, "uvMax": 9.1,
      "rain": { "label": "Rain likely ~2 PM", "startsAt": "14:00", "probability": 72 },
      "weatherCode": 3,
      "artUrl": "https://example.com/weather-art/v2/day-hot-partly-high-uv.webp",
      "artLabel": "day hot partly cloudy, high UV",
      "metadata": { "cached": true, "cacheAge": 1234, "lastUpdated": "2026-07-28T15:40:12.000Z" }
    }
    """.trimIndent()

  @Test
  fun `parses the widget payload`() {
    val data = WidgetData.fromJson(sample)
    assertEquals("2026-07-28", data.date)
    assertEquals(91.2, data.tempHigh, 0.0001)
    assertEquals(6.2, data.uvNow, 0.0001)
    assertEquals("Rain likely ~2 PM", data.rain.label)
    assertEquals("14:00", data.rain.startsAt)
    assertEquals(3, data.weatherCode)
    assertEquals("2026-07-28T15:40:12.000Z", data.metadata?.lastUpdated)
  }

  @Test
  fun `tolerates missing optional fields and unknown keys`() {
    val minimal =
      """
      {
        "date": "2026-07-28", "tempNow": 80.0, "feelsLike": 80.0,
        "tempHigh": 90.0, "tempLow": 60.0, "uvNow": 1.0, "uvMax": 5.0,
        "rain": { "label": "No rain expected", "probability": 10 },
        "artUrl": "https://example.com/a.webp", "someFutureField": 42
      }
      """.trimIndent()
    val data = WidgetData.fromJson(minimal)
    assertNull(data.rain.startsAt)
    assertNull(data.weatherCode)
    assertNull(data.metadata)
  }
}
```

`WidgetFormatTest.kt`:

```kotlin
package com.solarsentinel.widget.data

import kotlin.test.Test
import kotlin.test.assertEquals

class WidgetFormatTest {
  @Test
  fun `rounds temperatures to whole degrees`() {
    assertEquals("91°", formatTemp(91.2))
    assertEquals("68°", formatTemp(67.5))
    assertEquals("-4°", formatTemp(-3.6))
  }

  @Test
  fun `formats uv with one decimal below 10`() {
    assertEquals("6.2", formatUv(6.24))
    assertEquals("0.0", formatUv(0.0))
    assertEquals("11", formatUv(10.6))
  }

  @Test
  fun `formats the updated timestamp as local time`() {
    // Rendered in the device zone; test pins a zone for determinism.
    assertEquals("11:40 AM", formatUpdatedTime("2026-07-28T15:40:12.000Z", zoneId = "America/New_York"))
    assertEquals("?", formatUpdatedTime(null, zoneId = "America/New_York"))
    assertEquals("?", formatUpdatedTime("garbage", zoneId = "America/New_York"))
  }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd android && ./gradlew :app:testDebugUnitTest`
Expected: compilation FAILS (classes missing).

- [ ] **Step 3: Implement**

`WidgetData.kt`:

```kotlin
package com.solarsentinel.widget.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class RainOutlook(
  val label: String,
  val startsAt: String? = null,
  val probability: Double = 0.0,
)

@Serializable
data class WidgetMetadata(val lastUpdated: String? = null)

@Serializable
data class WidgetData(
  val date: String,
  val tempNow: Double,
  val feelsLike: Double,
  val tempHigh: Double,
  val tempLow: Double,
  val uvNow: Double,
  val uvMax: Double,
  val rain: RainOutlook,
  val weatherCode: Int? = null,
  val artUrl: String,
  val artLabel: String? = null,
  val metadata: WidgetMetadata? = null,
) {
  companion object {
    private val json = Json { ignoreUnknownKeys = true }

    fun fromJson(body: String): WidgetData = json.decodeFromString(serializer(), body)
  }
}
```

`WidgetFormat.kt`:

```kotlin
package com.solarsentinel.widget.data

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

fun formatTemp(value: Double): String = "${value.roundToInt()}°"

fun formatUv(value: Double): String =
  if (value >= 10) value.roundToInt().toString() else String.format(Locale.US, "%.1f", value)

fun formatUpdatedTime(iso: String?, zoneId: String = ZoneId.systemDefault().id): String {
  if (iso == null) return "?"
  return try {
    val formatter = DateTimeFormatter.ofPattern("h:mm a", Locale.US).withZone(ZoneId.of(zoneId))
    formatter.format(Instant.parse(iso))
  } catch (_: Exception) {
    "?"
  }
}
```

`WidgetStore.kt` (device-only, no unit tests — exercised on device in Task 8):

```kotlin
package com.solarsentinel.widget.data

import android.content.Context
import java.io.File
import java.security.MessageDigest

object WidgetStore {
  private const val DATA_FILE = "widget-data.json"
  private const val ART_DIR = "art-cache"

  fun save(context: Context, body: String) {
    File(context.filesDir, DATA_FILE).writeText(body)
  }

  fun load(context: Context): WidgetData? {
    val file = File(context.filesDir, DATA_FILE)
    if (!file.exists()) return null
    return try {
      WidgetData.fromJson(file.readText())
    } catch (_: Exception) {
      null
    }
  }

  // Art URLs are path-versioned and immutable, so cached files never expire.
  fun artFile(context: Context, url: String): File {
    val dir = File(context.filesDir, ART_DIR).apply { mkdirs() }
    val digest = MessageDigest.getInstance("SHA-1").digest(url.toByteArray())
    val name = digest.joinToString("") { "%02x".format(it) }
    return File(dir, "$name.webp")
  }
}
```

`WidgetApi.kt`:

```kotlin
package com.solarsentinel.widget.data

import com.solarsentinel.widget.BuildConfig
import java.io.File
import java.io.IOException
import java.util.Locale
import okhttp3.OkHttpClient
import okhttp3.Request

object WidgetApi {
  private val client = OkHttpClient()

  private fun request(url: String): Request =
    Request.Builder()
      .url(url)
      .header("CF-Access-Client-Id", BuildConfig.CF_ACCESS_CLIENT_ID)
      .header("CF-Access-Client-Secret", BuildConfig.CF_ACCESS_CLIENT_SECRET)
      .build()

  fun fetchWidgetJson(lat: Double, lon: Double): String {
    val url =
      String.format(Locale.US, "%s/api/widget?lat=%.4f&lon=%.4f", BuildConfig.BASE_URL, lat, lon)
    client.newCall(request(url)).execute().use { response ->
      if (!response.isSuccessful) throw IOException("Widget API returned ${response.code}")
      return response.body?.string() ?: throw IOException("Widget API returned an empty body")
    }
  }

  fun downloadArtIfMissing(url: String, destination: File) {
    if (destination.exists()) return
    client.newCall(request(url)).execute().use { response ->
      if (!response.isSuccessful) throw IOException("Art download returned ${response.code}")
      val body = response.body ?: throw IOException("Art download returned an empty body")
      destination.outputStream().use { body.byteStream().copyTo(it) }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd android && ./gradlew :app:testDebugUnitTest`
Expected: BUILD SUCCESSFUL, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add android/app/src
git commit -m "Add widget data layer: models, formatting, store, API client"
```

---

### Task 7: Refresh worker + location

**Files:**
- Create: `android/app/src/main/kotlin/com/solarsentinel/widget/refresh/LocationSource.kt`
- Create: `android/app/src/main/kotlin/com/solarsentinel/widget/refresh/RefreshWorker.kt`
- Modify: `android/app/src/main/kotlin/com/solarsentinel/widget/MainActivity.kt` (schedule on launch)

**Interfaces:**
- Consumes: `WidgetApi`, `WidgetStore` (Task 6).
- Produces: `RefreshWorker` (a `CoroutineWorker`), `RefreshWorker.schedule(context)` (unique periodic work, 30 min, KEEP), `RefreshWorker.refreshNow(context)` (one-time work), `LocationSource.getLatLon(context): Pair<Double, Double>`. Task 8's widget/receiver calls `schedule` + `refreshNow`; `RefreshWorker` calls `SolarWidget().updateAll(context)` (Task 8) — reference it now; the project compiles again once Task 8 lands (worker and widget land in adjacent tasks; only run full builds at Task 8 if Task 8's stub isn't present yet. If executing tasks strictly in order, add a temporary `suspend fun updateAllWidgets(context: Context) {}` placeholder — Task 8 Step 6 replaces it).

- [ ] **Step 1: `LocationSource.kt`**

```kotlin
package com.solarsentinel.widget.refresh

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

object LocationSource {
  // Windham, NH — the server's prewarmed home path.
  const val HOME_LAT = 42.8006
  const val HOME_LON = -71.3048

  @SuppressLint("MissingPermission")
  suspend fun getLatLon(context: Context): Pair<Double, Double> {
    val granted =
      context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
    if (!granted) return HOME_LAT to HOME_LON

    val client = LocationServices.getFusedLocationProviderClient(context)
    val location =
      withTimeoutOrNull(10_000) {
        client.lastLocation.await()
          ?: client
            .getCurrentLocation(
              Priority.PRIORITY_BALANCED_POWER_ACCURACY,
              CancellationTokenSource().token,
            )
            .await()
      }
    return if (location != null) location.latitude to location.longitude else HOME_LAT to HOME_LON
  }
}
```

- [ ] **Step 2: `RefreshWorker.kt`**

```kotlin
package com.solarsentinel.widget.refresh

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.solarsentinel.widget.SolarWidget
import com.solarsentinel.widget.data.WidgetApi
import com.solarsentinel.widget.data.WidgetData
import com.solarsentinel.widget.data.WidgetStore
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class RefreshWorker(context: Context, params: WorkerParameters) :
  CoroutineWorker(context, params) {

  override suspend fun doWork(): Result =
    withContext(Dispatchers.IO) {
      try {
        val (lat, lon) = LocationSource.getLatLon(applicationContext)
        val body = WidgetApi.fetchWidgetJson(lat, lon)
        val data = WidgetData.fromJson(body) // validate before persisting
        WidgetStore.save(applicationContext, body)
        WidgetApi.downloadArtIfMissing(data.artUrl, WidgetStore.artFile(applicationContext, data.artUrl))
        SolarWidget.updateAll(applicationContext)
        Result.success()
      } catch (error: Exception) {
        // Keep the last good render; WorkManager retries with backoff.
        Log.w("RefreshWorker", "widget refresh failed", error)
        Result.retry()
      }
    }

  companion object {
    private const val PERIODIC_WORK = "widget-refresh"
    private const val ONE_TIME_WORK = "widget-refresh-now"

    private val constraints =
      Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun schedule(context: Context) {
      val request =
        PeriodicWorkRequestBuilder<RefreshWorker>(30, TimeUnit.MINUTES)
          .setConstraints(constraints)
          .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
          .build()
      WorkManager.getInstance(context)
        .enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun refreshNow(context: Context) {
      val request =
        OneTimeWorkRequestBuilder<RefreshWorker>().setConstraints(constraints).build()
      WorkManager.getInstance(context)
        .enqueueUniqueWork(ONE_TIME_WORK, ExistingWorkPolicy.REPLACE, request)
    }
  }
}
```

- [ ] **Step 3: Schedule from `MainActivity`**

Add to the end of `MainActivity.onCreate`:

```kotlin
com.solarsentinel.widget.refresh.RefreshWorker.schedule(this)
com.solarsentinel.widget.refresh.RefreshWorker.refreshNow(this)
```

- [ ] **Step 4: Compile check**

Run: `cd android && ./gradlew :app:compileDebugKotlin`
Expected: succeeds once `SolarWidget.updateAll` exists (Task 8 Step 1 creates it). If building this task standalone, use the temporary placeholder noted in Interfaces, then verify BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
git add android/app/src
git commit -m "Add widget refresh worker with coarse location and Windham fallback"
```

---

### Task 8: Glance widget UI + on-device verification

**Files:**
- Create: `android/app/src/main/kotlin/com/solarsentinel/widget/SolarWidget.kt`
- Create: `android/app/src/main/kotlin/com/solarsentinel/widget/SolarWidgetReceiver.kt`
- Create: `android/app/src/main/res/xml/solar_widget_info.xml`
- Modify: `android/app/src/main/AndroidManifest.xml` (register receiver)
- Modify: `android/local.properties` (fill widget.* values — never committed)

**Interfaces:**
- Consumes: `WidgetStore.load/artFile` (Task 6), `RefreshWorker.schedule/refreshNow` (Task 7), Task 4's service token values, `BuildConfig.WEB_APP_URL`.
- Produces: `SolarWidget.updateAll(context)` used by `RefreshWorker`.

- [ ] **Step 1: `SolarWidget.kt`**

```kotlin
package com.solarsentinel.widget

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.solarsentinel.widget.data.WidgetData
import com.solarsentinel.widget.data.WidgetStore
import com.solarsentinel.widget.data.formatTemp
import com.solarsentinel.widget.data.formatUpdatedTime
import com.solarsentinel.widget.data.formatUv

class SolarWidget : GlanceAppWidget() {
  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val data = WidgetStore.load(context)
    val artPath = data?.let { WidgetStore.artFile(context, it.artUrl) }
    provideContent { WidgetContent(data, artPath?.takeIf { it.exists() }?.absolutePath) }
  }

  companion object {
    suspend fun updateAll(context: Context) = SolarWidget().updateAll(context)
  }
}

private val textColor = ColorProvider(Color.White)
private val dimColor = ColorProvider(Color(0xB3FFFFFF))

@Composable
private fun WidgetContent(data: WidgetData?, artPath: String?) {
  val openApp =
    actionStartActivity(
      Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.WEB_APP_URL))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )

  Row(
    modifier =
      GlanceModifier.fillMaxSize()
        .background(Color(0xFF1E293B))
        .cornerRadius(24.dp)
        .padding(12.dp)
        .clickable(openApp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (data == null) {
      Text("Solar Sentinel: waiting for first refresh…", style = TextStyle(color = dimColor, fontSize = 13.sp))
      return@Row
    }

    if (artPath != null) {
      val bitmap = BitmapFactory.decodeFile(artPath)
      if (bitmap != null) {
        Image(
          provider = ImageProvider(bitmap),
          contentDescription = data.artLabel ?: "Weather art",
          modifier = GlanceModifier.size(96.dp).cornerRadius(16.dp),
          contentScale = ContentScale.Crop,
        )
        Spacer(modifier = GlanceModifier.size(12.dp))
      }
    }

    Column(verticalAlignment = Alignment.CenterVertically) {
      Text(
        "${formatTemp(data.tempHigh)} / ${formatTemp(data.tempLow)}  now ${formatTemp(data.tempNow)}",
        style = TextStyle(color = textColor, fontSize = 16.sp, fontWeight = FontWeight.Bold),
      )
      Spacer(modifier = GlanceModifier.height(4.dp))
      Text(
        "UV ${formatUv(data.uvNow)} now · max ${formatUv(data.uvMax)}",
        style = TextStyle(color = textColor, fontSize = 14.sp),
      )
      Spacer(modifier = GlanceModifier.height(4.dp))
      Text(data.rain.label, style = TextStyle(color = textColor, fontSize = 14.sp))
      Spacer(modifier = GlanceModifier.height(4.dp))
      Text(
        "updated ${formatUpdatedTime(data.metadata?.lastUpdated)}",
        style = TextStyle(color = dimColor, fontSize = 11.sp),
      )
    }
  }
}
```

(If Task 7 used the temporary `updateAllWidgets` placeholder, delete it now and point `RefreshWorker` at `SolarWidget.updateAll`.)

- [ ] **Step 2: `SolarWidgetReceiver.kt`**

```kotlin
package com.solarsentinel.widget

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import com.solarsentinel.widget.refresh.RefreshWorker

class SolarWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = SolarWidget()

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    RefreshWorker.schedule(context)
    RefreshWorker.refreshNow(context)
  }
}
```

- [ ] **Step 3: `res/xml/solar_widget_info.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:description="@string/widget_description"
  android:minWidth="250dp"
  android:minHeight="110dp"
  android:targetCellWidth="4"
  android:targetCellHeight="2"
  android:resizeMode="horizontal|vertical"
  android:updatePeriodMillis="0"
  android:widgetCategory="home_screen" />
```

(`updatePeriodMillis=0` — WorkManager owns the refresh cadence.)

- [ ] **Step 4: Register the receiver in `AndroidManifest.xml`** (inside `<application>`)

```xml
<receiver
  android:name=".SolarWidgetReceiver"
  android:exported="true"
  android:label="@string/app_name">
  <intent-filter>
    <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
  </intent-filter>
  <meta-data
    android:name="android.appwidget.provider"
    android:resource="@xml/solar_widget_info" />
</receiver>
```

- [ ] **Step 5: Fill `android/local.properties`** with the real base URL, web app URL, and the Task 4 service-token ID/secret. **Do not commit.**

- [ ] **Step 6: Build + unit tests**

Run: `cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 7: Commit**

```bash
git add android/app/src
git commit -m "Add Glance home-screen widget with tap-to-open and art rendering"
```

- [ ] **Step 8: On-device verification (main session — device attached)**

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.solarsentinel.widget/.MainActivity
```

Then on the device: grant location → app settings → location → "Allow all the time"; add the widget to the home screen. Verify: real data appears within a minute (check `adb logcat -s RefreshWorker WM-WorkerWrapper`), art renders, tap opens the web app. Airplane-mode a refresh cycle to confirm the last good render persists.

---

## Final verification

- [ ] `pnpm test -- --run && pnpm run typecheck && pnpm run format:check` — all green
- [ ] `cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug` — green
- [ ] `curl` through the tunnel with service-token headers returns the widget payload; without headers it's denied
- [ ] Widget on the home screen shows high/low + now temp, UV now/max, rain line, art, updated time; tap opens the web app
- [ ] `git log` shows no secrets committed (`git grep -i cf-access -- android` finds only header names in code)
