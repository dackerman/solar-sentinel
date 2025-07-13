# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Application Overview

Solar Sentinel is a Progressive Web App (PWA) that displays real-time weather data for Summit, NJ including UV index, temperature, and precipitation probability. The app uses the Open-Meteo API and presents data in interactive Chart.js visualizations.

## Development Commands

```bash
# Install dependencies
npm install

# Development server with auto-restart
npm run dev

# Production server
npm start

# Docker development (recommended)
docker compose up -d

# IMPORTANT: Always rebuild to see changes
# Simple restart does NOT apply code changes
docker compose restart  # ❌ Does not work for code changes

# Rebuild Docker container (required for all code changes)
docker compose down && docker compose up -d --build  # ✅ Required

# View logs
docker compose logs -f

# Health check
curl http://localhost:9890/api/uv-today
```

## Architecture

### Backend (server.js)
- **Express.js server** with ES modules (`type: "module"`)
- **Single API endpoint**: `/api/uv-today` with optional `?lat=X&lon=Y` parameters
- **Location-based caching**: Map keyed by coordinates, 10-minute TTL
- **Data filtering**: Extracts today's hourly data in America/New_York timezone
- **Open-Meteo integration**: Fetches UV index, precipitation probability, and apparent temperature

### Frontend (public/index.html)
- **Self-contained HTML** with inline JavaScript and Tailwind CSS via CDN
- **Geolocation API**: Auto-detects user location, falls back to Summit, NJ (40.7162, -74.3625)
- **Two Chart.js visualizations**:
  1. Weather chart (temperature line + precipitation area, dual Y-axis)
  2. UV index bar chart (color-coded by danger level)
- **PWA features**: Service worker caching, installable, offline support

### Key Design Decisions
- **No animations**: `animation: false` in Chart.js to prevent vertical expansion
- **Fixed chart sizing**: 384px height containers with `!important` styles to prevent resizing issues
- **Non-responsive charts**: `responsive: false` to maintain stable dimensions
- **Location caching**: Browser geolocation cached for 5 minutes to avoid repeated prompts

## Data Structure

API response format:
```json
{
  "labels": ["12:00 AM", "1:00 AM", ...],
  "uv": [0, 0.1, 4.5, ...],
  "precipitation": [0, 5, 20, ...], 
  "temperature": [25.3, 26.1, ...]
}
```

UV color mapping:
- 0-2: Green (Low)
- 3-5: Yellow (Moderate) 
- 6-7: Orange (High)
- 8-10: Red (Very High)
- 11+: Purple (Extreme)

## Docker Configuration

- **Port mapping**: 9890 (external) → 3000 (internal)
- **Base image**: Node 20 Alpine
- **Security**: Non-root user (`uvapp:1001`)
- **Health checks**: Built-in container and API endpoint monitoring
- **Auto-restart**: `unless-stopped` policy

### Critical Docker Development Note
**ALWAYS use full rebuild for code changes**. The Docker setup copies files during build, so `docker compose restart` will NOT apply code changes. Always use:
```bash
docker compose down && docker compose up -d --build
```

## Location Handling

- **Default coordinates**: Summit, NJ (40.7162, -74.3625)
- **Geolocation flow**: Browser API → user coordinates or default fallback
- **Timezone detection**: Simple heuristic (US longitudes use America/New_York, others use UTC)
- **Coordinate validation**: Lat/lon bounds checking in API

## Chart Configuration Notes

When working with Chart.js in this app:
- Always disable animations and responsive mode to prevent sizing issues
- Use fixed height containers (384px) with explicit canvas styling
- Weather chart uses dual Y-axes (precipitation left, temperature right)
- UV chart uses per-bar color mapping based on values