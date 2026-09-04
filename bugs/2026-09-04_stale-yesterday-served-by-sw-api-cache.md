# App still shows yesterday on first morning open (after the 2026-08-29 resume fix)

## Observed (2026-09-04)

- Phone PWA opened ~6:55 AM: "Thursday, September 3", single-day layout (i.e. rendered as a
  non-today date), "Last updated: 8:01 AM" in amber. Pull-to-refresh at 6:56 → correct Sept 4 view,
  "Last updated: 6:51 AM". Reproduced even after uninstall/reinstall of the Android PWA.
- Deployed image (built 2026-08-29 13:31) already contains the resume-refresh fix from 9fe8bd3, so
  that fix did not cover this path.

## Evidence (server logs, local time)

- Sept 3 08:01:27: server refreshed home forecast from Open-Meteo. Sept 3 08:02:37: phone fetched
  weather + daily calendar (home coords). That response's `metadata.lastUpdated` = 8:01 AM is
  exactly what the screenshot shows 23 h later.
- Sept 4 06:55:40: phone hit the server for `/api/daily-calendar` only. No `/api/weather` request
  outside the 30 s healthcheck cadence. In `loadData`, the calendar is only requested after a
  *successful* weather response — so the weather fetch resolved OK without reaching the server.
- `/api/weather` responses carry no `Cache-Control` and no `Last-Modified`, so browser/Cloudflare
  HTTP caching is ruled out. That leaves the service worker.

## Root cause

`public/sw.js` `networkFirstApi`: any network failure (the first request after Android wakes often
fails while Wi-Fi reconnects / `ERR_NETWORK_CHANGED`) falls back to `caches.match(request)` and
returns it as a normal 200. Its "5-minute expiry" was a `setTimeout` inside the worker, which is
terminated seconds after idle, so API cache entries lived forever. Following-today requests omit
`date=`, so yesterday's `/api/weather?lat=&lon=` response is under the same URL and is served as
today's. The app then correctly "adopts" the response date — yesterday. The calendar request a
moment later succeeded on the recovered network, which is why the day picker knew about Sept 4.

Uninstall/reinstall of the PWA does not clear Chrome's Cache Storage for the origin, hence no help.

## Fix

- SW: stamp API cache entries with `sw-cached-at`; on fallback, serve only if < 5 min old, else
  delete and rethrow so the page sees a real network error. No in-worker timers for expiry.
- App: refresh on `online`; a failed resume-triggered refresh retries once after 5 s instead of
  waiting for the 5-minute interval.
