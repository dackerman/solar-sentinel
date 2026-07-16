# Location Switching + Favorites — Design

**Date:** 2026-07-16
**Status:** Approved

## Goal

Let the user switch the viewed location from the UI (name search + "use my current location"),
save/favorite locations for one-tap switching, and keep switching fast via the existing
per-location caches — without slowing the instant-load home path.

## Decisions (from brainstorming)

- Location entry: name search (Open-Meteo geocoding) + "use my current location" button.
- Favorites UX: star toggle + quick-switch picker list; Home (Windham) pinned at top.
- Manual pick wins: an explicit selection persists across reloads; background geolocation
  never overrides it.
- Geographic scope: anywhere — fix the server's timezone handling.
- Caching: client-side only (existing 6-hour localStorage cache) plus an expired-entry sweep.
  No server-side prewarming of favorites.
- Architecture: frontend-owned. Browser calls Open-Meteo geocoding directly; favorites live
  in localStorage. Only server change is the timezone fix. (Trade-off accepted: favorites do
  not sync across devices.)

## 1. Data model & storage

New localStorage keys (frontend only):

- `solar_sentinel_saved_locations` — ordered array of
  `SavedLocation { id: string; lat: number; lon: number; name: string }`.
  `id` is the 2-decimal coord string (e.g. `"42.80,-71.30"`) — the same rounding every cache
  layer already uses, making dedupe and cache-matching free.
- `solar_sentinel_selected_location` —
  `{ location: Location; source: 'manual' | 'auto'; timestamp: number }`.
  Records the user's explicit choice.

The existing `solar_sentinel_location` key is unchanged — it remains the geolocation result
cache (24 h TTL) and its tests stay valid.

New types in `src/types/weather.ts`: `SavedLocation`, `SelectedLocation` (or equivalent).

## 2. Startup & "manual pick wins"

- If `solar_sentinel_selected_location` exists with `source: 'manual'`: boot directly into
  that location. Skip the home-first reset and do **not** run background geolocation.
- Otherwise: current behavior unchanged — paint Home fast
  (`prepareHomeFirstLocation`), geolocate in the background
  (`refreshLocationInBackground`), swap if away.
- "Use my current location" in the picker clears manual mode (source `'auto'`) and re-runs
  the geolocation flow.
- Explicitly picking Home from the picker **is** a manual pick — it sticks.

## 3. Picker UI

The header `#location-display` line becomes a button. Tapping opens a popover (same visual
language as the existing gear `#app-menu`):

1. 📍 **Use my current location**
2. **Home — Windham, NH** (pinned)
3. Favorites list — tap name to switch; ★ to unfavorite
4. Search box — debounced (~300 ms) requests to
   `https://geocoding-api.open-meteo.com/v1/search?name=<q>&count=5&language=en&format=json`;
   suggestions render "City, Region, Country"; tap to switch; ☆ on a result saves it
   without switching.
5. The currently viewed location gets a ★ toggle so any spot (including a geolocated one)
   can be favorited.

Implementation: new `src/components/location-picker.ts` + markup in `src/index.html`,
wired in `setupEventListeners()` (`src/app.ts`). Tailwind styling consistent with the
existing menu. Geocoding fires only on user input — nothing touches the instant-load path.

## 4. Switching & caching

One new path `selectLocation(location, source)` in the app class:

1. Persist the selection (`solar_sentinel_selected_location`).
2. Set `currentLocation`, clear in-memory history/data state (same clearing as the existing
   location-change code in `refreshLocationInBackground`).
3. Update the location display; `loadData(true)`.

Weather/calendar localStorage caches are already keyed per rounded-coord + date, so
switching back to a recently viewed location paints instantly from cache, then refreshes.

**Cleanup:** a startup idle-time sweep (e.g. `requestIdleCallback` after first paint)
iterates `solar_sentinel_weather_*` / `solar_sentinel_calendar_*` keys and removes entries
past the existing 6-hour TTL. (Today expired entries are only evicted when read, so
locations you stop viewing linger forever.) No further eviction policy needed.

## 5. Timezone fix (server)

Problem: `getTimezone(lon)` treats every US longitude as `America/New_York`, and
`getTodayInNewYork()` hardcodes "today" — wrong day boundaries for e.g. Denver or London.

- Fetch Open-Meteo with `timezone=auto`; the response's actual timezone is stored with the
  cached forecast.
- Compute "today" and the today→today+16 window in the **location's** timezone via
  `Intl.DateTimeFormat('en-CA', { timeZone })`, replacing `getTodayInNewYork()` on the
  forecast path. Since the timezone is only known once a forecast (cached or fresh) is in
  hand, requested dates are validated/clamped after cache lookup rather than at parse time.
- Hourly day-bucketing (`filterDateData`) already buckets by the timezone Open-Meteo
  returns — correct once `auto` is passed.
- Frontend date-nav clamps to the date range returned by `/api/daily-calendar` when
  available (fallback: current device-local math), so a far-away timezone can't navigate to
  a day the server won't serve.

Unchanged: home prewarm (`auto` resolves to `America/New_York`), history snapshot keying,
forecast cache keys, the poll endpoint.

## 6. Error handling

- Geocoding search failure → inline "search unavailable" message in the picker; favorites,
  Home, and current-location switching still work.
- Weather fetch failure for a picked location → existing error path (cached paint retained,
  error surfaced as today).
- Malformed/missing localStorage values → treated as absent (parse in try/catch), matching
  the existing `LocationService` behavior.

## 7. Testing (Vitest, mirroring existing suites)

- Saved-locations store: add / remove / dedupe by id / ordering / malformed JSON /
  localStorage exceptions.
- Selection persistence + startup resolution: manual pick wins, `auto` restores geolocation
  flow, picking Home sticks.
- Cache sweep: removes expired weather/calendar entries, leaves fresh ones and foreign keys.
- Geocoding service: mocked fetch, result mapping, failure path.
- Server: today/date-window computation per timezone, `timezone=auto` request param,
  non-Eastern location day boundaries.
- Existing suites (`location-cache.test.ts`, `services.test.ts`, `navigation.test.ts`,
  `server.api.test.ts`) stay green; navigation test DOM gains the picker markup.

## Out of scope

- Cross-device favorites sync (would require backend storage — revisit if wanted).
- Server-side prewarming of favorite locations.
- Reordering favorites in the UI.
