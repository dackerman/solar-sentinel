# App shows yesterday after resuming across midnight

## Observed

- Tab open overnight / Android PWA resumed in the morning still shows the previous day; looks like it's
  "trying to refresh yesterday but can't". Pull-to-refresh (full reload) fixes it.

## Investigation (2026-08-29)

- Rollover *during* a refresh already works: while `followingToday`, requests omit `date=`, the server
  resolves the location's today, and `loadData` adopts `data.date` (covered by
  `src/test/refresh.test.ts` "rolls over to the new day before an auto-refresh after midnight").
- So the failure is that **no refresh runs after resume**:
  1. The only resume trigger was `window` `focus` (`scheduleAutoRefresh`). Android Chrome / PWA resume and
     tab restores reliably fire `document` `visibilitychange` (and `pageshow` for bfcache), not `focus`.
     The 5-min `setInterval` is frozen while hidden. The 1-min now-line timer resumes and draws "Now" on
     yesterday's chart; the "Last updated" stamp turns amber — hence "trying but failing".
  2. `WeatherAPI.fetchOnce` had no timeout. A refresh that fires as the page is backgrounded can hang
     forever, leaving `refreshInFlight` stuck `true`; every later refresh logs
     "Auto-refresh skipped: request in flight". Only a reload clears it.
  3. Minor: a silent refresh adopting a new date left history state keyed to the old day, and an
     explicitly navigated date that became today never returned to `followingToday`.

## Fix

- Refresh on `visibilitychange` (visible) and `pageshow` (persisted), in addition to `focus`.
- 20s AbortController timeout on API fetches so `refreshInFlight` can't wedge.
- Reset history state when adoption changes the date; resume following-today when the explicit date is
  no longer in the future.
