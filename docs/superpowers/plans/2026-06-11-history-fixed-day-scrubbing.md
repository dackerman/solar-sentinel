# Fixed-Day History Scrubbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The history slider keeps the selected day fixed and shows what that day's forecast looked like at each past moment, with an explicit "not available yet" state.

**Architecture:** The server records built per-date responses for the *entire 16-day horizon* into the existing `api_call_history` table on every upstream Open-Meteo fetch (replacing per-request recording, which moves history work off the cache-hit hot path). A new `/api/history/timeline` endpoint exposes the distinct snapshot times per location. The frontend scrubs that global timeline and resolves the selected day's entry as-of the scrub time.

**Tech Stack:** Express + `node:sqlite`, TypeScript frontend, Vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-06-11-history-fixed-day-scrubbing-design.md`

**Conventions:** pnpm only (`pnpm exec vitest run` for single-run tests — bare `pnpm test` is watch mode). Prettier via `pnpm run format` before each commit. Server tests share one in-memory SQLite DB per file: every new test must use coordinates unique within the file. ISO `fetched_at` strings compare correctly as strings.

---

### Task 1: Record all-horizon snapshots at fetch time; retire request-path recording

**Files:**
- Modify: `server.js` (`fetchAndCacheForecast` ~line 707; new `recordForecastSnapshots` next to `recordApiCall` ~line 466; delete `recordApiCall` and its call sites in `sendForecastResponse` ~797 and `handleForecastRequest` ~833/~900)
- Test: `src/test/server.api.test.ts`

- [x] **Step 1: Write the failing test**

Add to the `describe('GET /api/history - Persisted Snapshots')` block (coordinates `40.77, -73.97` are unique in this file):

```ts
it('records snapshots for every date in the forecast horizon on upstream fetch', async () => {
  const dateA = getTestDate(7);
  const dateB = getTestDate(8);
  const lat = 40.77;
  const lon = -73.97;

  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(getMockTwoDayData(dateA, dateB)),
  });

  await request(app).get('/api/weather').query({ lat, lon, date: dateA }).expect(200);

  const responseB = await request(app)
    .get('/api/history')
    .query({ route: '/api/weather', lat, lon, date: dateB })
    .expect(200);

  expect(responseB.body.entries).toHaveLength(1);
  expect(responseB.body.entries[0].data.daily.tempMax).toBe(57.4);
  expect(responseB.body.entries[0].cacheStatus).toBe('snapshot');

  const calendar = await request(app)
    .get('/api/history')
    .query({ route: '/api/daily-calendar', lat, lon })
    .expect(200);

  expect(calendar.body.entries).toHaveLength(1);
  expect(calendar.body.entries[0].data.days).toHaveLength(2);
});
```

`dateB` is never requested, yet must have history — that's the heart of the feature.
The calendar snapshot must also appear without any `/api/daily-calendar` request.

Replace the existing test `'skips recording history snapshots when the payload is unchanged'`
(request-path dedup no longer exists; dedup now guards repeat upstream fetches) with:

```ts
it('does not duplicate snapshots when an upstream refetch returns identical data', async () => {
  const dateA = getTestDate(5);
  const dateB = getTestDate(6);
  const dateC = getTestDate(9);
  const lat = 41.42;
  const lon = -72.42;

  const payload = getMockTwoDayData(dateA, dateB);
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(payload),
  });

  await request(app).get('/api/weather').query({ lat, lon, date: dateA }).expect(200);
  // dateC is outside the cached payload, forcing a second upstream fetch of identical
  // data. Snapshots are recorded in fetchAndCacheForecast before buildData runs;
  // the request itself then 502s because extractDailyData can't find dateC.
  await request(app).get('/api/weather').query({ lat, lon, date: dateC }).expect(502);
  expect(mockFetch).toHaveBeenCalledTimes(2);

  const response = await request(app)
    .get('/api/history')
    .query({ route: '/api/weather', lat, lon })
    .expect(200);

  expect(response.body.entries).toHaveLength(2);
  const dates = response.body.entries.map((entry: { date: string }) => entry.date);
  expect(dates).toContain(dateA);
  expect(dates).toContain(dateB);
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/test/server.api.test.ts -t "snapshots"`
Expected: FAIL — horizon test gets 0 entries for `dateB`; refetch test gets 3+ entries (request-path recording still active)

- [x] **Step 3: Implement `recordForecastSnapshots` and call it from `fetchAndCacheForecast`**

Add after `getSafeNumber` (where `recordApiCall` currently lives). Guard on both field
groups: `/api/uv-today` can populate the forecast cache with hourly-only payloads.
`buildWeatherData` and `buildDailyCalendarData` are existing functions (declarations
hoist, definition order doesn't matter):

```js
function recordForecastSnapshots(lat, lon, cacheKey, forecastData) {
  try {
    if (!forecastData?.hourly?.time || !forecastData?.daily?.time) return;

    const fetchedAt = new Date().toISOString();
    const startDate = forecastData.daily.time[0];
    const snapshots = forecastData.daily.time.map(date => ({
      route: '/api/weather',
      date,
      body: buildWeatherData(forecastData, date),
    }));
    snapshots.push({
      route: '/api/daily-calendar',
      date: startDate,
      body: buildDailyCalendarData(forecastData.daily, forecastData.hourly, startDate),
    });

    for (const snapshot of snapshots) {
      const responseJson = JSON.stringify(snapshot.body);
      const latest = selectApiHistoryIsDuplicateStatement.get(
        responseJson,
        snapshot.route,
        cacheKey,
        snapshot.date
      );
      if (latest?.isDuplicate) continue;
      insertApiHistoryStatement.run(
        fetchedAt,
        snapshot.route,
        '{}',
        lat,
        lon,
        cacheKey,
        snapshot.date,
        cacheKey,
        'snapshot',
        200,
        responseJson
      );
    }
  } catch (error) {
    console.error('Forecast snapshot record error:', error.message);
  }
}
```

Snapshot bodies have no `metadata` key, so the existing `json_remove($.metadata)`
comparison is a no-op on them while still normalizing legacy rows — legacy and new
entries dedupe against each other correctly.

Wire it into `fetchAndCacheForecast` (synchronous in the `.then` — deterministic for
tests, off the cache-hit path, a few ms on an already-slow upstream fetch):

```js
  const refresh = fetchForecastFromOpenMeteo(lat, lon, timezone)
    .then(data => {
      const entry = {
        data,
        timestamp: Date.now(),
      };
      forecastCache.set(cacheKey, entry);
      recordForecastSnapshots(lat, lon, cacheKey, data);
      return entry;
    })
```

- [x] **Step 4: Delete `recordApiCall` and its call sites**

Remove the whole `recordApiCall` function. Remove its three call sites:

1. In `sendForecastResponse` — delete the `recordApiCall({...})` call; keep the rest.
2. In `handleForecastRequest`'s validation-error branch — delete the `recordApiCall({...})` call before `return res.status(...)`.
3. In `handleForecastRequest`'s catch block — delete the `recordApiCall({...})` call before `res.status(502)`.

`sendForecastResponse`'s `historyContext` argument becomes unused — remove the
parameter and the object passed at its call site in `handleForecastRequest`.

- [x] **Step 5: Run the full suite**

Run: `pnpm exec vitest run`
Expected: PASS. Existing history tests still pass because a request's upstream fetch
now records the requested date's partition (among others) at the same moment.

- [x] **Step 6: Format and commit**

```bash
pnpm run format
git add server.js src/test/server.api.test.ts
git commit -m "Record full-horizon history snapshots at fetch time"
```

---

### Task 2: Timeline endpoint

**Files:**
- Modify: `server.js` (statement near the other history statements; route before `app.get('/api/history', ...)`)
- Test: `src/test/server.api.test.ts`

- [x] **Step 1: Write the failing test**

Add inside the `/api/history` describe block (coordinates `39.95, -75.17` unique):

```ts
it('returns the distinct snapshot timeline for a location', async () => {
  const dateA = getTestDate(10);
  const dateB = getTestDate(11);
  const lat = 39.95;
  const lon = -75.17;

  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(getMockTwoDayData(dateA, dateB)),
  });

  await request(app).get('/api/weather').query({ lat, lon, date: dateA }).expect(200);

  const response = await request(app)
    .get('/api/history/timeline')
    .query({ lat, lon })
    .expect(200);

  // One upstream fetch wrote many partitions, all sharing one fetched_at
  expect(response.body.times).toHaveLength(1);
  expect(typeof response.body.times[0]).toBe('string');

  await request(app).get('/api/history/timeline').query({ lat: 999, lon }).expect(400);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/test/server.api.test.ts -t "distinct snapshot timeline"`
Expected: FAIL — 404 (route does not exist; Express serves the static fallback or 404)

- [x] **Step 3: Implement**

Statement (next to `selectApiHistoryAllDatesAfterStatement`):

```js
const selectApiHistoryTimelineStatement = apiHistoryDb.prepare(`
  SELECT DISTINCT fetched_at
  FROM api_call_history
  WHERE location_key = ?
    AND status_code = 200
  ORDER BY fetched_at ASC
`);
```

Route (place directly above the existing `app.get('/api/history', ...)`):

```js
// Distinct snapshot times per location — the scrubber's slider domain.
app.get('/api/history/timeline', (req, res) => {
  const latParam = parseFloat(getStringQueryParam(req.query.lat));
  const lonParam = parseFloat(getStringQueryParam(req.query.lon));
  const lat = Number.isFinite(latParam) ? latParam : DEFAULT_LAT;
  const lon = Number.isFinite(lonParam) ? lonParam : DEFAULT_LON;

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  try {
    const rows = selectApiHistoryTimelineStatement.all(getForecastCacheKey(lat, lon));
    res.json({ times: rows.map(row => row.fetched_at) });
  } catch (error) {
    console.error('History timeline error:', error.message);
    res.status(500).json({ error: 'Failed to load history timeline' });
  }
});
```

- [x] **Step 4: Run the full suite**

Run: `pnpm exec vitest run`
Expected: PASS

- [x] **Step 5: Format and commit**

```bash
pnpm run format
git add server.js src/test/server.api.test.ts
git commit -m "Add history timeline endpoint"
```

---

### Task 3: API service — timeline fetch, per-date weather history

**Files:**
- Modify: `src/services/api.ts` (history methods, ~line 209)

- [x] **Step 1: Add `fetchHistoryTimeline`**

Next to the other history methods:

```ts
async fetchHistoryTimeline(location: Location): Promise<string[]> {
  const params = new URLSearchParams({
    lat: String(location.lat),
    lon: String(location.lon),
  });
  const response = await this.fetchOnce(`${this.baseURL}/api/history/timeline?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`History timeline failed: ${response.status}`);
  }
  const body = (await response.json()) as { times: string[] };
  return body.times;
}
```

`fetchWeatherHistory` / `fetchDailyCalendarHistory` / `fetchHistory` keep their
optional-`date` signatures unchanged — weather callers will now always pass a date,
calendar callers won't.

- [x] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [x] **Step 3: Commit**

```bash
pnpm run format
git add src/services/api.ts
git commit -m "Add history timeline API client method"
```

---

### Task 4: Frontend fixed-day scrubbing

**Files:**
- Modify: `src/app.ts`
- Modify: `src/index.html` (unavailable notice, after the `#history-panel` div ~line 113)

- [x] **Step 1: Add the unavailable notice to `src/index.html`**

Directly after the closing `</div>` of `#history-panel` (before the
`<!-- Dual Display ... -->` comment):

```html
<div
  id="history-unavailable"
  class="hidden rounded-lg border border-dashed border-blue-300 bg-blue-50/60 p-6 text-center text-sm text-blue-800"
></div>
```

- [x] **Step 2: State + history loading changes in `src/app.ts`**

Add field next to the other history fields:

```ts
private historyTimeline: string[] = [];
```

Re-key the weather history cache per date — change `getHistoryCacheKey` to:

```ts
private getHistoryCacheKey(route: '/api/weather' | '/api/daily-calendar', date?: string): string {
  return `${route}:${this.currentLocation.lat.toFixed(2)},${this.currentLocation.lon.toFixed(2)}:${date ?? 'all'}`;
}
```

`loadWeatherHistory` takes the date again and threads it through (calendar loader
stays date-less):

```ts
private async loadWeatherHistory(date: string): Promise<WeatherHistoryEntry[]> {
  const cacheKey = this.getHistoryCacheKey('/api/weather', date);
  const cache = this.weatherHistoryCache.get(cacheKey) || { entries: [], loadedAllOlder: false };

  if (cache.entries.length > 0) {
    const newest = cache.entries[cache.entries.length - 1];
    cache.entries = this.mergeHistoryEntries(
      cache.entries,
      await this.api.fetchWeatherHistory(this.currentLocation, date, { after: newest.fetchedAt })
    );
  } else {
    cache.entries = await this.api.fetchWeatherHistory(this.currentLocation, date);
  }

  while (!cache.loadedAllOlder && cache.entries.length > 0) {
    const oldest = cache.entries[0];
    const older = await this.api.fetchWeatherHistory(this.currentLocation, date, {
      before: oldest.fetchedAt,
    });
    cache.entries = this.mergeHistoryEntries(older, cache.entries);
    cache.loadedAllOlder = older.length < 500;
  }

  this.weatherHistoryCache.set(cacheKey, cache);
  return cache.entries;
}
```

`refreshHistoryState` loads the timeline too:

```ts
private async refreshHistoryState(): Promise<void> {
  const [weatherHistory, calendarHistory, timeline] = await Promise.all([
    this.loadWeatherHistory(this.currentDate),
    this.loadCalendarHistory(),
    this.api.fetchHistoryTimeline(this.currentLocation),
  ]);
  this.weatherHistory = weatherHistory;
  this.calendarHistory = calendarHistory;
  this.historyTimeline = timeline;
  this.updateHistoryControls();
}
```

In `refreshLocationInBackground`'s location-change branch (where `weatherHistory`
and `calendarHistory` are reset), also add `this.historyTimeline = [];` and
`this.weatherHistoryCache.clear();` is NOT needed (cache is keyed by location).

- [x] **Step 3: Scrub over the timeline with as-of resolution**

`updateHistoryControls`: replace the `weatherHistory`-based slider sizing with the
timeline —

```ts
const hasHistory = this.historyTimeline.length > 0;
...
controls.classList.toggle('hidden', !this.historyMode || this.historyTimeline.length < 2);
scrubber.max = String(Math.max(0, this.historyTimeline.length - 1));

if (!this.historyMode) {
  scrubber.value = String(Math.max(0, this.historyTimeline.length - 1));
  ...
```

`enterHistoryMode`: gate and initial render on the timeline —

```ts
await this.historyRefreshPromise;
if (this.historyTimeline.length === 0) return;

this.historyMode = true;
this.updateHistoryControls();
this.renderHistoryAt(this.historyTimeline.length - 1);
```

Replace `renderHistoryAt` and `getClosestCalendarHistoryEntry` with as-of lookup
(entries are sorted ascending by `mergeHistoryEntries`; ISO strings compare as
strings):

```ts
private renderHistoryAt(index: number): void {
  const asOf = this.historyTimeline[index];
  if (!asOf) return;

  const weatherEntry = this.getLatestEntryAt(this.weatherHistory, asOf);
  if (weatherEntry) {
    this.setHistoryUnavailable(false);
    this.renderWeatherData(weatherEntry.data, false);
  } else {
    this.setHistoryUnavailable(true);
  }

  const calendarEntry = this.getLatestEntryAt(this.calendarHistory, asOf);
  if (calendarEntry) {
    this.renderForecastCalendar(calendarEntry.data);
  }
  this.updateHistoryLabel(index, weatherEntry);
}

private getLatestEntryAt<T extends { fetchedAt: string }>(entries: T[], asOf: string): T | null {
  let latest: T | null = null;
  for (const entry of entries) {
    if (entry.fetchedAt > asOf) break;
    latest = entry;
  }
  return latest;
}
```

The unavailable state hides the data sections and shows the notice; re-rendering an
entry restores them (`renderWeatherData` un-hides the chart sections and
`updateCurrentConditions` manages `dual-display`/`single-display` on every render):

```ts
private setHistoryUnavailable(unavailable: boolean): void {
  const notice = document.getElementById('history-unavailable');
  if (!notice) return;
  notice.classList.toggle('hidden', !unavailable);
  if (!unavailable) return;

  const dayLabel = this.parseLocalDate(this.currentDate).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  notice.textContent = `No saved forecast for ${dayLabel} at this point in time.`;
  ['dual-display', 'single-display', 'current-conditions', 'chart-container', 'weather-chart-container'].forEach(
    id => document.getElementById(id)?.classList.add('hidden')
  );
  this.updateElement('date-display', dayLabel);
  this.updateDateNavigationControls();
}
```

(Verify `parseLocalDate` and `updateElement` exist — both are used elsewhere in
`app.ts`. If `parseLocalDate` is private with a different name, use
`new Date(this.currentDate + 'T00:00:00')` like `renderWeatherData` does.)

`updateHistoryLabel` gains the entry parameter and as-of semantics:

```ts
private updateHistoryLabel(index: number, entry?: WeatherHistoryEntry | null): void {
  const asOf = this.historyTimeline[index];
  const status = document.getElementById('history-status');
  const detail = document.getElementById('history-detail');
  const scrubber = document.getElementById('history-scrubber') as HTMLInputElement | null;

  if (!asOf || !status || !detail) return;

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

  status.textContent = `As of ${formatTime(asOf)} (${index + 1}/${this.historyTimeline.length})`;
  detail.textContent = entry
    ? `Forecast recorded ${formatTime(entry.fetchedAt)}`
    : 'Forecast not yet available';
  if (scrubber) {
    scrubber.value = String(index);
  }
}
```

Fix the one other `updateHistoryLabel(...)` call site in `updateHistoryControls`:
look up the entry first —

```ts
const index = Number(scrubber.value);
this.updateHistoryLabel(index, this.getLatestEntryAt(this.weatherHistory, this.historyTimeline[index] ?? ''));
```

`exitHistoryMode`: add `this.setHistoryUnavailable(false);` as the first line.

- [x] **Step 4: Keep date navigation live in history mode**

In both `navigateDate` and `selectForecastDate`, the current code does:

```ts
this.currentDate = newDate;          // (or dateString)
this.historyMode = false;
this.latestWeatherData = null;
this.weatherHistory = [];
this.updateHistoryControls();
this.loadData();
```

Replace with:

```ts
this.currentDate = newDate;          // (or dateString)
this.latestWeatherData = null;
if (this.historyMode) {
  void this.refreshHistoryForDateChange();
  void this.loadData(true);
} else {
  this.weatherHistory = [];
  this.updateHistoryControls();
  this.loadData();
}
```

(`loadData(true)` fetches fresh data silently for exit-history; its render is
already guarded by `if (!this.historyMode)`.)

New method next to `refreshHistoryState`:

```ts
private async refreshHistoryForDateChange(): Promise<void> {
  try {
    this.weatherHistory = await this.loadWeatherHistory(this.currentDate);
    this.updateHistoryControls();
    const scrubber = document.getElementById('history-scrubber') as HTMLInputElement | null;
    const index = scrubber ? Number(scrubber.value) : this.historyTimeline.length - 1;
    this.renderHistoryAt(index);
  } catch (error) {
    this.debugPanel.log('History date change error', { error: (error as Error).message });
  }
}
```

- [x] **Step 5: Typecheck and run the full suite**

Run: `pnpm run typecheck && pnpm exec vitest run`
Expected: PASS. If `src/test/app.test.ts` or `navigation.test.ts` assert the old
"exit history on date change" behavior, update those assertions to the new
stay-in-history behavior (check failures individually — do not weaken unrelated
assertions).

- [x] **Step 6: Format and commit**

```bash
pnpm run format
git add src/app.ts src/index.html
git commit -m "Scrub history by time with the selected day fixed"
```

---

### Task 5: Docs, final verification, deploy note

**Files:**
- Modify: `CLAUDE.md` (Architecture section)

- [x] **Step 1: Update `CLAUDE.md` architecture notes**

In the `## Architecture` section, replace the line
`- Server caches the full 16-day Open-Meteo forecast by rounded coordinates, not individual dates`
with:

```markdown
- Server caches the full 16-day Open-Meteo forecast by rounded coordinates, not individual dates
- Every upstream fetch records deduped per-date history snapshots (all 16 days + a daily-calendar snapshot) into SQLite; the request path never writes history
- `GET /api/history?route=&lat=&lon=&date=` serves stored snapshots; `GET /api/history/timeline?lat=&lon=` serves the distinct snapshot times the scrubber slides over
- History scrubbing keeps the selected day fixed and resolves entries as-of the scrub time; instant load of current conditions is the top product priority — nothing may slow the cache-hit path
```

- [x] **Step 2: Full check**

Run: `pnpm exec vitest run && pnpm run typecheck && pnpm run format:check && pnpm run build`
Expected: all PASS

- [x] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document history snapshot architecture"
```

- [x] **Step 4: Report**

Summarize for David. Deployment (`git push`, then
`docker compose down && docker compose up -d --build`) was explicitly requested for
the previous change — confirm before deploying this one, or push and deploy if he
has already said to. After deploy, sanity-check
`curl http://localhost:49877/api/history/timeline` returns times and the scrubber
behaves (today has rich legacy history immediately; other days fill in as the
prewarm records full-horizon snapshots).
