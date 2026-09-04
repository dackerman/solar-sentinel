# Stale "Last updated" After Cloudflare Access Session Expiry

## Observed Behavior

- App showed "Last updated: 10:47am" at 1:42pm; page refreshes did not update it and no error was shown.

## Investigation (2026-08-19)

- Backend healthy: container up 2 weeks, home prewarm completing every 10 min, `/api/weather` on localhost returned `lastUpdated` ~6 min old. Open-Meteo fetches succeeding all afternoon. Nothing was down.
- Public URL check: unauthenticated `GET https://solar-sentinel.ackermansoftware.com/api/weather` returns **302 → ackermansoftware.cloudflareaccess.com login**, not JSON.
- Access app "Solar Sentinel" (id `67bab8b2-c522-467a-b074-a6fa5835b528`) has `session_duration: 730h` (~30 days), `auto_redirect_to_identity: true`.

## Root Cause

The device's Cloudflare Access session expired (~10:47am, end of the 30-day session). After that:

1. Page `fetch('/api/weather')` gets a cross-origin redirect to the Access login → fetch rejects.
2. Service worker's `networkFirstApi` falls back to its API cache, which auto-expires after 5 min → nothing → fetch fails at the app layer.
3. `loadData()` in `src/app.ts` had already painted the localStorage weather cache (`renderedLocalCache = true`), so the catch block **silently swallows the error** (`if (!silent && !renderedLocalCache)` guard, src/app.ts:295-306). The stamp stays at the localStorage entry's `metadata.lastUpdated` — the last successful fetch, 10:47am.
4. Page refresh never surfaces the login: the SW serves the app shell **stale-while-revalidate for all navigations** (`public/sw.js:156`), so the user never reaches Cloudflare's redirect. The background shell revalidation gets a redirect (not `response.ok`) so the cached shell is never replaced — the app just keeps loading and keeps showing stale data.

Net effect: auth expiry is indistinguishable from "working fine" except the frozen timestamp.

## Graph Markers Detail

Reported alongside: the chart's dashed "Updated" marker also sits at ~10:47 and no solid "Now" line is visible.

- The "Updated" marker comes from the same stale `metadata.lastUpdated` (`src/utils/charts.ts:190`), so it freezing at 10:47 is the same root cause.
- The "Now" marker is recomputed from `new Date()` on every chart draw (`getTimeMarkers`, charts.ts:178) and a 1-minute `chartNowLineTimer` calls `chart.update('none')` to keep it moving (`src/app.ts:797`). A page that had truly re-executed its JS at 1:42pm would draw "Now" at 1:42pm even with stale data.
- Its absence means the visible canvas was last painted around 10:47 — "Now" and "Updated" are drawn at nearly the same x and read as one line. That happens when the PWA/tab is *resumed* from memory rather than reloaded: on resume, `window focus` → `runAutoRefresh` fires, the fetch fails on the Access redirect, the error is swallowed, and no re-render or chart update occurs (the 1-min timer had been throttled/frozen in the background).
- On-device confirmation: app menu → Debug panel should show repeating `Load error` entries since ~10:47.


## Immediate Remedy

Re-authenticate on the affected device: open `https://ackermansoftware.cloudflareaccess.com` (App Launcher — different origin, so the SW can't intercept it), sign in, then reopen the app. Navigating to the app URL itself won't show the login because the SW serves the cached shell.

## Candidate Fixes (not yet applied)

1. **Detect auth expiry in the frontend**: fetch `/api/*` with `redirect: 'manual'` (or catch the TypeError and probe with a no-cors request); on auth redirect, show a "Session expired — tap to sign in" banner that links through to the Access login with a `redirect_url` back to the app.
2. **Visible staleness**: when rendering only localStorage data (network refresh failed), style the "Last updated" stamp as stale (e.g., amber after 30 min) instead of showing it as if fresh.
3. Optionally lengthen `session_duration` on the Access app or add a narrowly-scoped bypass — only if the API gains its own auth; do not bypass Access for `/api/*` as-is.
