# Android Home-Screen Widget — Design

**Date:** 2026-07-28
**Status:** Approved

## Goal

An Android home-screen widget showing the Solar Sentinel day summary at a glance:
today's high (plus current temp), current and max UV, when rain is expected, and the
weather-art image representing the day. Backed by the existing Solar Sentinel server,
reachable from anywhere via its Cloudflare-tunneled URL (behind Cloudflare Access).

## Decisions (from brainstorming)

- **Reachability:** public HTTPS URL via existing Cloudflare tunnel, gated by Cloudflare
  Access. The widget authenticates with an Access **service token**
  (`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers). Creating the token and a
  service-auth Access policy is in scope.
- **Content:** today's summary — high temp, UV current/max, rain timing, daily art image.
- **Vehicle:** a small dedicated native Kotlin app using **Jetpack Glance**; lives in
  `android/` in this repo.
- **Location:** phone's current (coarse) location, falling back to last-known, then
  Windham (42.8006, -71.3048).
- **Architecture:** thin widget + smart server — new `GET /api/widget` endpoint returns
  render-ready fields so product logic stays in TypeScript/JS on the server.

## Server: `GET /api/widget`

Query: optional `lat`, `lon` (default Windham). Reads from the existing cached 16-day
forecast exactly like `/api/weather`; **must not slow the cache-hit path**. Resolves
"today" in the location's timezone via the existing `resolveRequestedDate` machinery.

Response:

```json
{
  "date": "2026-07-28",
  "tempNow": 84,
  "feelsLike": 88,
  "tempHigh": 91,
  "tempLow": 68,
  "uvNow": 6.2,
  "uvMax": 9.1,
  "rain": { "label": "Rain likely ~2 PM", "startsAt": "14:00", "probability": 72 },
  "weatherCode": 3,
  "artUrl": "https://<host>/weather-art/v2/day-hot-partly-high-uv.webp",
  "updatedAt": "2026-07-28T15:40:12Z"
}
```

- `tempNow`/`feelsLike`/`uvNow` come from the hourly row for the current hour in the
  location's timezone; daily fields from the existing daily extraction.
- **Rain heuristic** (pure function, unit-tested): scan today's remaining hourly
  `precipitation_probability`. First hour ≥ 50% → `"Rain likely ~2 PM"` with
  `probability` = that hour's value; if that hour is the current hour → `"Rain now"`; if
  no hour qualifies → `"No rain expected"`, `startsAt` omitted, `probability` = the
  remaining hours' max.
- `artUrl` is absolute, using the request host, pointing at the served art in
  `/weather-art/v2/` (path-versioned, immutable).
- Include `Server-Timing` header and `metadata.performance` consistent with other routes.

### Weather-art module refactor

`src/utils/weatherArt.ts` holds the pure art-selection logic but `server.js` is plain JS
and cannot import TS. Move the selection logic to a shared plain-JS module with JSDoc
types at `src/utils/weatherArt.js`, imported by both the frontend and `server.js` (a thin
`weatherArt.ts` may remain to re-export types). No behavior change; existing art tests
must keep passing.

### Testing

Vitest coverage for the endpoint (shape, defaults, timezone/day resolution, stale-cache
behavior) and for the rain-heuristic function.

## Android app (`android/`)

Minimal Kotlin app; its only job is the widget.

- **Widget layout (~4×2):** art image left; right column: high temp with current temp,
  `UV 6.2 now / 9.1 max`, rain line; small "updated 3:40 PM" footer. Tap opens the web
  app URL in the browser.
- **Refresh:** WorkManager periodic job every 30 minutes with backoff retry, plus refresh
  on widget placement. Each run: coarse fused location (fallbacks: last known → Windham)
  → `GET /api/widget` with the two Access headers → persist JSON + art image to disk →
  update Glance state and re-render. Art images are cached forever keyed by URL
  (immutable, path-versioned).
- **Location:** `ACCESS_COARSE_LOCATION`; background access granted manually once in
  system settings (sideloaded personal app). Widget functions without location, pinned to
  Windham.
- **Config/secrets:** base URL, `CF-Access-Client-Id`, `CF-Access-Client-Secret` in
  `local.properties` → `BuildConfig`. Never committed.
- **Failure behavior:** on any fetch/auth error keep the last good data rendered; the
  "updated" timestamp simply ages. Never render a blank/error-only widget once data has
  loaded at least once.
- **Testing:** JVM unit tests for JSON parsing and display formatting; manual
  verification by installing on-device via adb.

## Cloudflare (in scope)

Create a Cloudflare Access service token and add a service-auth policy to the existing
Solar Sentinel Access application permitting it. Existing human login flow unchanged.

## Out of scope

- Multi-day forecast strip, UV sparkline, multiple widget sizes/configurations.
- Play Store distribution; the app is sideloaded.
- iOS.
