# ☀️ Solar Sentinel

**Real-time UV Index and Weather Monitoring with Location Detection**

Solar Sentinel is a Progressive Web App (PWA) that displays real-time weather data including UV index, temperature, and precipitation probability. Features automatic location detection with fallback to Summit, NJ, and supports up to 16 days of forecast data navigation.

<img width="928" height="1381" alt="image" src="https://github.com/user-attachments/assets/7a3a0162-892d-4cdb-8903-d6e05b44d6b9" />

## ✨ Features

- **📊 Dual Interactive Charts** - UV index bar chart and temperature/precipitation line chart using Chart.js
- **🌡️ Smart Temperature Display** - Color-coded temperature line with thermal comfort bands (blue=cold, green=mild, orange=warm, red=hot)
- **📋 Current Conditions Card** - Prominent display of current/forecast conditions with contextual data
- **📱 Mobile-Optimized** - Responsive design with mobile-specific chart optimizations
- **📍 Location Detection** - Automatic geolocation with reverse geocoding for location names
- **📅 Date Navigation** - Browse up to 16 days of forecast data with arrow controls
- **⚡ Real-time Data** - Fetches weather data from Open-Meteo API with dual endpoints (hourly + daily)
- **💾 Smart Caching** - 10-minute location-based cache to reduce API calls
- **🏥 Health Monitoring** - Built-in health checks and error handling
- **🐳 Docker Ready** - Complete containerization with auto-restart
- **🎨 Modern UI** - Clean interface with Tailwind CSS and custom logo
- **📲 PWA Features** - Installable app with offline support

## 🚀 Quick Start

### Using Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/dackerman/solar-sentinel.git
cd solar-sentinel

# Build and run with Docker Compose
docker compose up -d

# Access the app
open http://localhost:9890
```

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Or start production server
npm start
```

## 🏗️ Architecture

### Backend (`server.js`)
- **Express.js** server with ES modules (`type: "module"`)
- **Dual API endpoints** - Hourly data (`/api/uv-today`) and daily summaries (`/api/daily-summary`)
- **Open-Meteo API** integration for UV index, precipitation probability, and apparent temperature
- **Location-based caching** - Map keyed by coordinates with 10-minute TTL (separate caches for hourly/daily)
- **Date-aware filtering** - Extracts specific day's hourly data in America/New_York timezone
- **Extended forecast** - Supports up to 16 days of forecast data
- **Coordinate validation** - Validates lat/lon bounds and date ranges
- **Error handling** with comprehensive validation and 502 responses

### Frontend (`public/index.html`)
- **Self-contained HTML** with inline JavaScript and Tailwind CSS via CDN
- **Geolocation API** - Auto-detects user location, falls back to Summit, NJ (40.7162, -74.3625)
- **Current Conditions Display** - Smart card showing current hour (today) or daily forecast (future days)
- **Two Chart.js visualizations**:
  1. Weather chart (color-coded temperature line + precipitation area, dual Y-axis)
  2. UV index bar chart (color-coded by danger level)
- **Temperature Color Coding** - Line segments colored by thermal comfort (blue/green/orange/red)
- **Date navigation** - Arrow controls for browsing forecast days
- **PWA features** - Installable app with offline support
- **Mobile optimizations** - Reduced margins, smaller fonts, rotated labels

### Infrastructure
- **Docker** containerization with Node 20 Alpine
- **Health checks** for container monitoring
- **Non-root user** (`uvapp:1001`) for security
- **Auto-restart** policy for reliability
- **PWA manifest** and service worker for offline capability

## 📍 Location Handling

**Default Location (Summit, NJ):**
- Latitude: `40.7162`
- Longitude: `-74.3625`
- Timezone: `America/New_York`

**Geolocation Features:**
- Browser geolocation API with 5-minute cache
- Reverse geocoding for location names
- Timezone detection heuristic (US longitudes use America/New_York, others use UTC)
- Coordinate validation with lat/lon bounds checking

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Internal server port |
| `NODE_ENV` | `production` | Runtime environment |

### Docker Ports

| Internal | External | Description |
|----------|----------|-------------|
| `3000` | `9890` | Web application |

## 📊 UV Index Scale

The app displays UV values with the following standard scale:

| Range | Level | Color | Protection Needed |
|-------|-------|-------|-------------------|
| 0-2 | Low | 🟢 Green | Minimal |
| 3-5 | Moderate | 🟡 Yellow | Some protection |
| 6-7 | High | 🟠 Orange | Protection required |
| 8-10 | Very High | 🔴 Red | Extra protection |
| 11+ | Extreme | 🟣 Purple | Avoid sun exposure |

## 📅 Date Navigation & Current Conditions

The app supports browsing forecast data for up to 16 days with smart condition display:

- **← Previous Day** - Navigate to earlier forecast data (disabled for past dates)
- **→ Next Day** - Navigate to future forecast data (up to 16 days ahead)
- **Current Date Display** - Shows the selected date (e.g., "Sunday, July 16")
- **Smart Conditions Card**:
  - **Today**: Shows "Current Conditions" with live time and current hour data (feels-like temp, current UV/precip/humidity)
  - **Future Days**: Shows "Daily Forecast" with daily highs/lows (high/low temps, peak UV, max precip/humidity)
- **Timezone Handling** - Properly handles local timezone date boundaries
- **Staleness Indicators** - Shows when current data is from a different hour (e.g., "3:45 PM (showing 3:00 PM)")

## 🛠️ Development

### File Structure

```
solar-sentinel/
├── server.js              # Express backend
├── public/
│   ├── index.html         # Frontend application
│   ├── logo.png          # Application logo
│   ├── manifest.json     # PWA manifest
│   ├── sw.js            # Service worker
│   ├── icon-192.png     # PWA icon (192x192)
│   └── icon-512.png     # PWA icon (512x512)
├── package.json           # Node.js dependencies
├── Dockerfile             # Container definition
├── docker-compose.yml     # Service orchestration
├── CLAUDE.md             # Development instructions
└── README.md             # This file
```

### API Endpoints

- `GET /` - Serves the frontend application
- `GET /api/uv-today` - Returns hourly weather data with optional parameters:
  - `lat` - Latitude (defaults to Summit, NJ)
  - `lon` - Longitude (defaults to Summit, NJ)
  - `date` - Date in YYYY-MM-DD format (defaults to today)
- `GET /api/daily-summary` - Returns daily highs/lows with same parameters
- `GET /api/uv-today/poll` - Polling endpoint for real-time updates

### Response Formats

**Hourly Data (`/api/uv-today`):**
```json
{
  "labels": ["12:00 AM", "1:00 AM", "2:00 AM", ...],
  "uv": [0, 0.1, 4.5, ...],
  "uvClearSky": [0, 0.2, 5.1, ...],
  "precipitation": [0, 5, 20, ...],
  "temperature": [25.3, 26.1, ...],
  "cloudCover": [10, 25, 60, ...],
  "humidity": [65, 70, 80, ...],
  "date": "2025-08-12"
}
```

**Daily Summary (`/api/daily-summary`):**
```json
{
  "date": "2025-08-12",
  "tempMax": 90.5,
  "tempMin": 64.6,
  "uvMax": 7.3,
  "precipMax": 0,
  "humidityMax": 95
}
```

## 🔒 Security Features

- Non-root container user (`uvapp:1001`)
- Read-only filesystem where possible
- Minimal Alpine Linux base image
- No sensitive data exposure
- CORS protection via same-origin policy

## 🌡️ Temperature Color Coding

The temperature line uses thermal comfort bands for quick visual reference:

| Temperature Range | Color | Comfort Level |
|-------------------|-------|---------------|
| ≤32°F | 🔵 Blue | Freezing |
| 32-50°F | 🔵 Light Blue | Cold |
| 50-74°F | 🟢 Green | Mild |
| 74-85°F | 🟠 Orange | Warm |
| 85-95°F | 🔴 Red | Hot |
| ≥95°F | 🔴 Deep Red | Very Hot |

## 📈 Performance

- **Cold start**: ~2-3 seconds
- **API response**: ~100-200ms (cached)
- **Bundle size**: ~460KB (including optimized logo)
- **Memory usage**: ~25MB container footprint
- **Chart rendering**: Optimized for mobile with fixed dimensions and disabled animations
- **Dual caching**: Separate caches for hourly and daily data to optimize performance

## 🧪 Health Monitoring

The application includes comprehensive health checks:

```bash
# Docker health check
docker compose ps

# Manual health check
curl http://localhost:9890/api/uv-today
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

ISC License - see the repository for details.

## 🌐 Data Source

UV data provided by [Open-Meteo](https://open-meteo.com/) - a free, open-source weather API that doesn't require authentication.

---

**Built with ❤️ for weather-conscious users who want to stay sun-safe and informed!**
