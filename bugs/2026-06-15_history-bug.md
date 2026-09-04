# History Scrubber First-Open Bug

## Observed Behavior

- On a fresh page refresh in prod, clicking history can show the full timeline, observed around 660 scrubber points.
- If the page is loaded, the user changes forecast days, then changes back to today, then clicks history, the scrubber may show only a couple points.
- Since a fresh refresh can immediately show the full timeline, the historical data exists on the server. This is not primarily a missing-data or retention problem.

## Relevant History Loading Model

- The server records snapshots only when it fetches/refetches the upstream 16-day forecast.
- One upstream forecast fetch usually writes up to 17 rows for a location: 16 `/api/weather` date snapshots and 1 `/api/daily-calendar` snapshot.
- All rows from one upstream fetch share one `fetched_at` timestamp.
- The frontend scrubber timeline comes from `/api/history/timeline`, which returns distinct `fetched_at` values for a rounded location key.
- Therefore the scrubber point count is the number of distinct snapshot times for the queried location, not the number of forecast days.

## Current Fix Applied

Changed `src/app.ts` so a history refresh snapshots `currentLocation` and `currentDate` at the start of the async load.

The history load now:

- Passes the captured location/date into weather history, calendar history, and timeline requests.
- Uses that captured location for history cache keys.
- Discards results if the app's current rounded location or date changed before the requests finished.

This protects against a mid-history-load race where geolocation/date changes could mix requests or commit stale history state.

Verification:

- `pnpm run typecheck` passed.
- `pnpm exec vitest run src/test/server.api.test.ts` currently fails before collecting tests with `server.js:8 fileURLToPath is not a function`; that appears unrelated to this frontend change.

## Current Theory

The reproducible path points to a location mismatch caused before history mode is opened, not necessarily during history loading.

Likely sequence:

1. Fresh refresh starts with the home-first location, Windham, NH (`42.80,-71.30`).
2. Clicking history immediately queries Windham's history timeline and shows the full set of points.
3. Changing forecast days calls `loadData()` again.
4. `loadData()` starts background geolocation via `refreshLocationInBackground()`.
5. If geolocation resolves to a non-home/away location, `currentLocation` changes.
6. Clicking history after that queries the away location's rounded history key instead of Windham's.
7. That away location may only have a couple snapshots, so the scrubber shows only a couple points even though Windham has hundreds.

## Clarification Needed

Check the location label after reproducing the bug but before clicking history.

- If it shows a pin or a non-Windham location, the leading theory is confirmed: history is correctly loading a small timeline, but for the wrong location relative to the user's expectation.
- If it still shows `Windham, NH`, then the issue is probably a different frontend state bug, not the geolocation location-key switch.

## Possible Next Fix

Make history load for the location used by the currently rendered weather data, not whatever `currentLocation` most recently became due to background geolocation.

That likely means storing the location for the latest successful weather render and using that rendered location/date pair for history requests.
