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
- External port is `9890`; internal app port is `3000`
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
- Async forecast calendar endpoint is `GET /api/daily-calendar`; it returns the available daily range starting at the requested date
- Server caches the full 16-day Open-Meteo forecast by rounded coordinates, not individual dates
- Express uses `compression()` and immutable one-year cache headers for Vite `/assets/*` files
- Windham, NH is the optimized home path: `42.8006, -71.3048`
- Home forecast is prewarmed and refreshed every 10 minutes while the server is running
- Frontend stores weather and daily calendar responses in localStorage by rounded location/date for fast perceived startup, paints from cache when available, then refreshes from the backend
- Geolocation is background-only for startup; Windham loads first unless the device is away from home
- Chart.js is lazily imported from `chart.js/auto`; do not re-add a blocking CDN script
- Performance instrumentation is intentional: frontend logs `Perf:` entries to the debug panel/console, and API responses include `Server-Timing` plus `metadata.performance`

## Weather Data
- Open-Meteo hourly fields: `uv_index`, `uv_index_clear_sky`, `precipitation_probability`, `temperature_2m`, `apparent_temperature`, `cloud_cover`, `relative_humidity_2m`
- Open-Meteo daily fields: `temperature_2m_max`, `temperature_2m_min`, `uv_index_max`, `precipitation_probability_max`, `relative_humidity_2m_max`, `weather_code`
- Use `America/New_York` for Windham/home data and existing US-longitude timezone behavior
- Date navigation supports today through 16 days ahead
