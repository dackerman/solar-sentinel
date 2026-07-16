# AGENTS.md - Solar Sentinel Development Guide

**CRITICAL: Use pnpm only** - npm/yarn are blocked by preinstall script

## Commands
- `pnpm test` - Run all tests (Vitest)  
- `pnpm test src/test/api.test.ts` - Run single test file
- `pnpm run build` - Build TypeScript with Vite
- `pnpm run typecheck` - Type checking only  
- `pnpm run format` - Format code with Prettier
- `pnpm run format:check` - Check Prettier formatting
- `pnpm run dev` - Development with auto-restart
- `docker compose down && docker compose up -d --build` - Rebuild Docker image after code changes

## Docker
- External port is `49877`; internal app port is `43187`
- Docker copies files at build time, so `docker compose restart` does **not** apply code changes
- Use a full rebuild for code changes: `docker compose down && docker compose up -d --build`

## Code Style
- **Imports**: Use `.js` extensions for local imports (TS/ES module requirement)
- **Types**: Explicit typing with interfaces in `src/types/`, use `type` imports
- **Formatting**: Prettier config - 2 spaces, single quotes, 100 char width
- **Classes**: Private fields with `private readonly` for constants
- **Error Handling**: Try/catch with typed errors `(error as Error).message`
- **Async**: Use `async/await`, performance timing with `performance.now()`

## Architecture
- ES modules (`"type": "module"`) - use `.js` imports in TS files
- Express backend (server.js), TypeScript frontend (src/)
- Tailwind CSS is built through Vite (`@tailwindcss/vite`) from `src/styles.css`; do not re-add `@tailwindcss/browser` or any blocking CSS CDN
- Chart.js with fixed dimensions, no animations/responsive mode
- Main app endpoint is `GET /api/weather`, returning hourly data plus `daily` summary in one request
- Compatibility endpoints remain: `GET /api/uv-today`, `GET /api/daily-summary`, `GET /api/uv-today/poll`
- Async forecast endpoint is `GET /api/daily-calendar`; it returns the available daily range starting at the requested date
- Server caches the full 16-day Open-Meteo forecast by rounded coordinates, not individual dates
- Every upstream fetch records deduped per-date history snapshots (all 16 days + a daily-calendar snapshot) into SQLite; the request path never writes history
- `GET /api/history?route=&lat=&lon=&date=` serves stored snapshots; `GET /api/history/timeline?lat=&lon=` serves the distinct snapshot times the scrubber slides over
- History scrubbing keeps the selected day fixed and resolves entries as-of the scrub time; instant load of current conditions is the top product priority — nothing may slow the cache-hit path
- Express uses `compression()` and immutable one-year cache headers for Vite `/assets/*` files
- Windham, NH is the optimized home path: `42.8006, -71.3048`
- Home forecast is prewarmed and refreshed every 10 minutes while the server is running
- Frontend stores weather and daily calendar responses in localStorage by rounded location/date for fast perceived startup, paints from cache when available, then refreshes from the backend
- Geolocation is background-only for startup; Windham loads first unless the device is away from home
- Users can switch locations from the header location button: a picker with pinned Home, starred favorites, "use my current location", and Open-Meteo geocoding name search (`src/components/locationPicker.ts`, `src/services/geocoding.ts`)
- Favorites live in localStorage `solar_sentinel_saved_locations`; the explicit selection in `solar_sentinel_selected_location` (`src/services/savedLocations.ts`). A manual pick persists across reloads and disables background geolocation until "use my current location" is chosen
- Expired weather/calendar localStorage entries are swept at idle after startup (`WeatherAPI.sweepExpiredCache`)
- Chart.js is lazily imported from `chart.js/auto`; do not re-add a blocking CDN script
- Weather art lives as 512px lossless originals in `art-src/weather-art/`; `./scripts/compress-weather-art` (ImageMagick) emits the served 384px lossy copies into `public/weather-art/v2/` (committed). Art URLs are path-versioned and cached immutable — any art change goes to a new `/v3/` directory
- Service worker serves the app shell stale-while-revalidate and precaches hashed `/assets/*` bundles at install; the precache manifest and cache version are injected into `dist/sw.js` at build time by the `sw-precache-manifest` plugin in `vite.config.ts` — do not hand-edit `VERSION` in `public/sw.js`
- Performance instrumentation is intentional: frontend logs `Perf:` entries to the debug panel/console, and API responses include `Server-Timing` plus `metadata.performance`

## Weather Data
- Open-Meteo hourly fields: `uv_index`, `uv_index_clear_sky`, `precipitation_probability`, `temperature_2m`, `apparent_temperature`, `cloud_cover`, `relative_humidity_2m`
- Open-Meteo daily fields: `temperature_2m_max`, `temperature_2m_min`, `uv_index_max`, `precipitation_probability_max`, `relative_humidity_2m_max`, `weather_code`
- Forecasts are fetched with `timezone=auto`; "today" and the today→+16 date window are resolved in each location's own timezone after cache lookup (`resolveRequestedDate` in server.js). Past dates clamp to the location's today; the response `date` field is authoritative and the frontend adopts it
- Date navigation supports today through 16 days ahead
