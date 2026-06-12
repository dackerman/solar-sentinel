# Weather Art Optimization — Design

**Date:** 2026-06-12
**Status:** Approved

## Goal

Stop weather-art flicker, cut art payload ~10×, and make art effectively free on
repeat visits. Keep the site lightweight and fast; instant load remains the top
product priority.

## Findings (measured)

- 195 weather-art images in `public/weather-art/v1/`: **lossless** WebP 512×512,
  ~233 KB each, **45 MB total** — displayed at ≤160 CSS px (≈320 px retina).
  Lossless at 2× display resolution is waste; it also bloats the Docker image.
- Flicker is render churn, not network: `updateWeatherArtImage` hides the `<img>`,
  sets `src`, and un-hides on `onload` — on *every* render, even when the art is
  unchanged. The forecast calendar rebuilds via `innerHTML`, recreating all `<img>`
  elements each render. History scrubbing re-renders even when the as-of snapshot
  resolution is unchanged between slider positions.
- Art is served with `max-age=86400` (1 day) despite the path being versioned
  (`/v1/`); the service worker caches only icons.
- `public/weather-art/v1/grok-batches/` and sample prompt files are publicly served
  generation artifacts — they don't belong in `public/`.

## Rejected: texture atlas

A session displays ≤ ~18 distinct images (current + today + 16 calendar cells),
scattered unpredictably across 195 temp/condition/daypart bins. A full atlas ships
everything (~4 MB post-compression) to avoid ≤18 parallel ~20 KB requests that are
free after first visit once caching is fixed; chunked atlases don't align with
usage (needed images don't cluster). Atlases pay off for many tiny images fetched
together — not few medium images fetched individually. The motivating flicker is
render churn regardless.

Also out of scope: `<link rel="preload" as="fetch">` for the weather API (the URL
contains a computed date param, so a static preload never matches).

## Changes

### 1. Image pipeline

- Move originals from `public/weather-art/v1/` to `art-src/weather-art/`
  (including `grok-batches/` and sample files — nothing generation-related stays
  in `public/`).
- New `scripts/compress-weather-art` (Node, `sharp` as devDependency): reads
  `art-src/weather-art/*.webp`, writes `public/weather-art/v2/*.webp` at 384×384,
  lossy quality 82. Idempotent; skips up-to-date outputs.
- Compressed output is committed — no build-time dependency on the script.
- `WEATHER_ART_BASE_PATH` in `src/utils/weatherArt.ts` bumps to
  `/weather-art/v2`.
- Expected: ~233 KB → ~20 KB per image; total ~45 MB → ~4 MB.

### 2. Render churn fixes (the flicker)

- `updateWeatherArtImage(elementId, art)`:
  - If `image.dataset.weatherArtKey === art.key` and the image has a `src`:
    update nothing (no hide, no `src` reassignment). Early return.
  - On a real change: load the new URL via an off-DOM `Image`, and only after it
    loads/decodes, swap `src`/alt/title/dataset and reveal. The previous art stays
    visible until the replacement is ready — no blank frame.
  - On load error: hide the element (current behavior).
- History scrubbing: `renderHistoryAt` tracks the ids of the last rendered weather
  and calendar entries (`lastHistoryWeatherId` / `lastHistoryCalendarId`); when the
  as-of resolution yields the same entry, skip `renderWeatherData` /
  `renderForecastCalendar` for it. The unavailable state and label still update.
  Tracking resets on history enter/exit and on date change (entry ids are unique
  per partition, so a date switch always re-renders).

### 3. Caching

- Server static headers: paths under `/weather-art/` get
  `Cache-Control: public, max-age=31536000, immutable` (safe: path-versioned;
  future art changes go to `/v3/`). Order the check before the generic image rule.
- Service worker (`public/sw.js`): add `/weather-art/` to the cache-first runtime
  strategy; bump `VERSION` so clients pick up the new worker.

## Testing

- Unit (history.test.ts harness): `updateWeatherArtImage` leaves the element
  untouched when the key is unchanged; swaps without an intermediate hidden state
  when the key changes (happy-dom fires no real loads — assert via the off-DOM
  loader behavior with a manually dispatched `load`).
- Unit: `renderHistoryAt` skips re-render when the resolved entry id is unchanged
  (spy on render methods through scrubs across positions resolving to the same
  entry).
- Script: run twice; second run reports all outputs up-to-date. Spot-check a few
  compressed images' dimensions and sizes.
- Server test: `/weather-art/` response carries the immutable cache header.
- Deploy smoke test: art loads from `/weather-art/v2/`, sizes ~20 KB.

## Performance audit conclusion (for the record)

Beyond this work, the site already does the right things: lazy Chart.js, localStorage
paint-before-network, prewarmed home forecast, gzip compression, immutable hashed
JS/CSS assets, history recording off the hot path. No further structural changes
recommended at current scale.
