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

## Recurrence (2026-09-05 morning, reported 2026-09-06)

- Screenshot 7:54 AM Sept 5: "Friday, September 4", non-today layout, "Last updated: 10:12 PM".
  Phone was on build 5a3e5a951151 (SW fix present), so the worker cannot have served day-old data.
- Server logs (local): phone's last full load Sept 4 22:21:51 (data lastUpdated 22:12:33 ✓).
  Sept 5 07:54:20: `/api/daily-calendar` only, home coords. No weather request off the healthcheck
  cadence between 07:40 and 07:54:41. 07:54:41: full weather+calendar (the pull-to-refresh).
  Same calendar-only blip at Sept 4 22:21:23, 28 s before a full load.
- Ruled out: Cloudflare edge cache (`cf-cache-status: DYNAMIC`, no Cache-Control on the API);
  browser heuristic cache (no Last-Modified, so any hit would revalidate against origin and be logged).
- Remaining candidates are on the phone and need the client log: first request after wake hung
  on a dead connection (expect "Load error … timed out after 20s" + retry), the resume event never
  fired (expect no entries at all until the reload), or a locally answered response (expect a
  "Weather API response" with an old `date`). Commit after 89cf16c adds the fields to tell these
  apart; the panel search + Copy is the way to collect them.

## Root cause found (2026-09-08 02:38, from the shipped client log)

Cold start of the Android PWA (`Perf: load-start reason user-initiated`, local cache miss):
```
Date resolved by server: 2026-09-08 → 2026-09-07
Weather API response: hit (19ms) | cacheAge 381757, lastUpdated 2026-09-07T20:19:22Z, date 2026-09-07
Perf: forecast-calendar-api-complete | responseMs 119   ← this one reached the server (docker log 06:38:39Z)
```
The weather body is a byte-identical replay of the response received at 4:25:43 PM the previous
day (same server `cacheAge` to the millisecond), delivered in 19 ms; the server saw no weather
request. Not the SW (no `sw-fallback`, and its fallback refuses entries >5 min). Not Cloudflare
(`cf-cache-status: DYNAMIC`, no cache rules).

**Chrome's HTTP cache on a restored tab.** When the WebAPK process has been killed and the app is
relaunched, Chrome restores the tab as a history navigation. For history/back-forward loads, Blink
gives subresource requests issued *before the document's load event* force-cache semantics: any
HTTP-cached response is returned without validation regardless of age
(`FrameFetchContext::ResourceRequestCachePolicy` → `DetermineFrameCacheMode`, which stops applying
the frame policy once `LoadEventFinished()`). The weather fetch runs from the DOMContentLoaded
handler → before `load` → replayed from disk. The calendar fetch runs after the weather response
→ after `load` → normal → hits origin. Pull-to-refresh is a reload (validate) → always fixed it.
A plain resume of a live process is not a navigation → most mornings fine. API responses carried
an ETag and no Cache-Control, so Chrome kept them on disk indefinitely.

Every earlier occurrence matches: Sept 4 06:55:40, Sept 4 22:21:23, Sept 5 07:54:20 — calendar
hit at origin, no weather hit, then a full load on pull-to-refresh.

## Fix (commit after 76416bd)

- `fetchOnce` sends `cache: 'no-store'`; an explicit request cache mode overrides the frame policy.
- Server sets `Cache-Control: no-store` on all `/api/*` so nothing is stored to replay.
