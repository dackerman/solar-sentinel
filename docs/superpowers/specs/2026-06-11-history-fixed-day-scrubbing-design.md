# Fixed-Day History Scrubbing — Design

**Date:** 2026-06-11
**Status:** Approved
**Builds on:** `2026-06-11-history-snapshot-dedup-design.md`

## Goal

Scrubbing the history slider keeps the **selected day fixed** and shows what that
day's forecast looked like at each point in the past. If no data for that day had
been recorded at that point, show an explicit "not available yet" state. Date
navigation (prev/next, calendar clicks) stays live in history mode: switching days
re-renders the new day as of the same moment.

Current behavior (the bug): the slider walks the raw all-dates snapshot list, so
scrubbing changes which day is displayed.

## Key insight: record the whole horizon, keep the format

Each upstream Open-Meteo fetch contains hourly+daily data for the full 16-day
horizon, but we currently persist only the built response for the *requested* date —
data for every other day is discarded. Fix at the source:

**On every successful upstream fetch, record built per-date responses for all 16
days** into the existing `api_call_history` table (one row per date partition,
deduped on change exactly as today), plus one daily-calendar snapshot. The history
endpoint, storage format, dedup, prune, and frontend entry shape are unchanged.

Consequences:

- **Main path gets faster, not slower.** Recording moves from the request path to
  the upstream-fetch path (`fetchAndCacheForecast.then`). Cache hits — the
  instant-load hot path — no longer touch the history DB at all. The cold path adds
  ~16 cheap builds + dedup checks (a few ms on an already ~300 ms upstream fetch).
- **Continuous history.** The 10-minute home prewarm records snapshots even when
  nobody is using the app.
- **Legacy data works natively.** Existing rows are the same format in the same
  table; they simply have sparse date coverage (only dates that were actually
  viewed — mostly "today"). They merge into the timeline as-is and age out through
  the existing 7-day prune. Nothing to migrate, nothing to delete manually.

Rejected alternative: store raw 16-day payloads and build views at history-query
time. Rebuilding hundreds of ~100 KB payloads per history request is slow, it's a
second storage format, and legacy data would need a compatibility shim.

## Server changes

### 1. Record snapshots at fetch time (`fetchAndCacheForecast`)

```js
const refresh = fetchForecastFromOpenMeteo(lat, lon, timezone)
  .then(data => {
    const entry = { data, timestamp: Date.now() };
    forecastCache.set(cacheKey, entry);
    recordForecastSnapshots(lat, lon, cacheKey, data);
    return entry;
  })
```

`recordForecastSnapshots` (try/catch, console.error, never throws):

- For each `date` in `data.daily.time`: insert
  `{ route: '/api/weather', date, response_json: buildWeatherData(data, date) }`
  with `cache_status: 'snapshot'`, skipping when the latest row in the
  `(route, location_key, date)` partition has identical content (existing
  `selectApiHistoryIsDuplicateStatement`; snapshot bodies have no `metadata` key,
  so `json_remove($.metadata)` is a no-op on them while still normalizing legacy
  rows).
- One calendar row: `{ route: '/api/daily-calendar', date: data.daily.time[0],
  response_json: buildDailyCalendarData(data.daily, data.hourly, data.daily.time[0]) }`,
  same dedup. `daily.time[0]` is "today" in the location's timezone.

Recording is synchronous inside the `.then` — deterministic for tests, off the
cache-hit path, negligible on the cold path.

### 2. Retire request-path recording

Delete `recordApiCall` and all its call sites (success, error, and validation
paths in `sendForecastResponse` / `handleForecastRequest`). History is now fed
solely by `recordForecastSnapshots`. Error responses keep their console logging.

### 3. Timeline endpoint

`GET /api/history/timeline?lat&lon` →
`{ times: string[] }` — sorted distinct `fetched_at` across both routes for the
location (`SELECT DISTINCT fetched_at FROM api_call_history WHERE location_key = ?
AND status_code = 200 ORDER BY fetched_at`). Post-dedup the table holds a few
thousand rows per week; a scan is fine. Coordinates parse/validate like
`/api/history`.

`/api/history` itself is unchanged (per-date filtering already supported).

## Frontend changes (`src/app.ts`, `src/services/api.ts`)

State: `historyTimeline: string[]` (slider domain), per-date weather entry cache
(re-keyed by `route:location:date` — restoring the date component removed in the
last iteration), calendar history loaded for all dates as today.

- **Enter history mode:** load timeline + current day's weather history + calendar
  history in parallel. Slider max = `timeline.length - 1`, starting at the end.
- **`renderHistoryAt(i)`:** `t = timeline[i]`. Weather: latest entry for the
  *selected day* with `fetchedAt <= t` → render it; none → unavailable state.
  Calendar: latest calendar entry with `fetchedAt <= t` (replaces the current
  closest-in-either-direction lookup, which leaks future data).
- **Date navigation in history mode:** allowed; loads that day's history (cached
  per date, newest-page merge as today), then re-renders at the same slider
  position. The timeline is global per location, so the slider doesn't re-scale.
- **Unavailable state:** hide/clear is wrong — show an explicit overlay message on
  the charts area: "No saved forecast for <day> as of <time>". The history detail
  line mirrors it. When data is shown, the detail line reads "as of <t> · forecast
  recorded <entry.fetchedAt>".
- **Exit history mode:** unchanged (re-renders latest live data).

Scrub rendering stays rAF-throttled.

## What "unavailable" means

No snapshot for the selected day existed at or before the scrub time. Causes: the
day was beyond the 16-day horizon then, the server wasn't recording then (legacy
sparse coverage), or retention pruned it. All render the same message; no need to
distinguish.

## Testing

- Server: one `/api/weather` request for date A records history rows for *all*
  dates in the upstream payload (request B's partition exists without ever being
  requested); repeat fetches with identical payloads add no rows; per-date dedup
  still keyed per partition.
- Server: calendar snapshot recorded once per upstream fetch, deduped.
- Server: timeline endpoint returns sorted distinct times across routes.
- Existing `/api/history` tests updated: recording now happens on upstream fetch,
  not per request (assertion counts change, semantics don't).
- Frontend behavior (as-of lookup, unavailable state) verified by typecheck + dev
  smoke test; the scrubber DOM has no existing unit-test harness.

## Performance budget

- Cache-hit `/api/weather`: zero history-DB work (improvement over today).
- Upstream fetch: +16 builds (<1 ms each) + 17 dedup queries + inserts only on
  change. Runs at most every 10 minutes per location.
- Storage: ~16× more partitions than the single-date recording, each deduped;
  estimated ~10–15 MB/week, well under the pre-dedup 50 MB.
- History mode transfer: timeline ~25 KB; one day's entries ~100–700 KB raw
  (gzip-compressed on the wire), fetched once per viewed day per session.
