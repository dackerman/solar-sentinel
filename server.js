import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const HOME_LOCATION = {
  lat: 42.8006,
  lon: -71.3048,
  name: 'Windham, NH',
};

// In-memory forecast cache keyed by rounded location. Each entry stores the full
// 16-day Open-Meteo response so date navigation can reuse one upstream fetch.
const forecastCache = new Map();
const forecastRefreshes = new Map();
const FORECAST_REFRESH_MS = 10 * 60 * 1000;
const CACHE_RETENTION_MS = 24 * 60 * 60 * 1000;

// Cache cleanup function - removes old location forecasts
function cleanupCache() {
  const now = Date.now();

  for (const [key, value] of forecastCache.entries()) {
    if (now - value.timestamp > CACHE_RETENTION_MS) {
      forecastCache.delete(key);
    }
  }
}

// Run cleanup on startup and daily at midnight
cleanupCache();
setInterval(cleanupCache, 24 * 60 * 60 * 1000); // Daily

// Default location (Windham, NH)
const DEFAULT_LAT = HOME_LOCATION.lat;
const DEFAULT_LON = HOME_LOCATION.lon;

// Serve static files with appropriate cache headers
// In production, serve built files; in development, serve public files
const staticDir = process.env.NODE_ENV === 'production' ? 'dist' : 'public';
app.use(
  express.static(join(__dirname, staticDir), {
    setHeaders: (res, path) => {
      // No cache for HTML files (always get updates)
      if (path.endsWith('.html') || path.endsWith('/')) {
        res.set({
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        });
      }
      // Short cache for service worker
      else if (path.endsWith('sw.js')) {
        res.set({
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        });
      }
      // Longer cache for static assets (icons, images)
      else if (path.match(/\.(png|jpg|jpeg|gif|ico|svg)$/)) {
        res.set({
          'Cache-Control': 'public, max-age=86400', // 1 day
        });
      }
      // Medium cache for manifest and other assets
      else {
        res.set({
          'Cache-Control': 'public, max-age=3600', // 1 hour
        });
      }
    },
  })
);

// Get today's date in America/New_York timezone
function getTodayInNewYork() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  }); // Returns YYYY-MM-DD format
}

// Filter weather data for specified date
function filterDateData(hourlyData, targetDate) {
  const todayIndices = [];

  hourlyData.time.forEach((timestamp, index) => {
    const date = timestamp.split('T')[0];
    if (date === targetDate) {
      todayIndices.push(index);
    }
  });

  const labels = todayIndices.map(i => {
    const date = new Date(hourlyData.time[i]);
    const hour = date.getHours();
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:00 ${period}`;
  });

  const uvValues = todayIndices.map(i => hourlyData.uv_index[i]);
  const uvClearSkyValues = todayIndices.map(i => hourlyData.uv_index_clear_sky[i]);
  const precipValues = todayIndices.map(i => hourlyData.precipitation_probability[i]);
  const actualTempValues = todayIndices.map(i => hourlyData.temperature_2m[i]);
  const apparentTempValues = todayIndices.map(i => hourlyData.apparent_temperature[i]);
  const cloudValues = todayIndices.map(i => hourlyData.cloud_cover[i]);
  const humidityValues = todayIndices.map(i => hourlyData.relative_humidity_2m[i]);

  return {
    labels,
    timestamps: todayIndices.map(i => hourlyData.time[i]),
    uv: uvValues,
    uvClearSky: uvClearSkyValues,
    precipitation: precipValues,
    temperature: actualTempValues,
    apparentTemperature: apparentTempValues,
    cloudCover: cloudValues,
    humidity: humidityValues,
    date: targetDate,
  };
}

// Extract daily data for a specific date
function extractDailyData(dailyData, targetDate) {
  const dateIndex = dailyData.time.findIndex(date => date === targetDate);

  if (dateIndex === -1) {
    throw new Error(`Date ${targetDate} not found in daily data`);
  }

  return {
    date: targetDate,
    tempMax: dailyData.temperature_2m_max[dateIndex],
    tempMin: dailyData.temperature_2m_min[dateIndex],
    uvMax: dailyData.uv_index_max[dateIndex],
    precipMax: dailyData.precipitation_probability_max[dateIndex],
    humidityMax: dailyData.relative_humidity_2m_max[dateIndex],
  };
}

function getForecastCacheKey(lat, lon) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function getTimezone(lon) {
  return lon >= -130 && lon <= -60 ? 'America/New_York' : 'UTC';
}

function getStringQueryParam(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === 'string' ? value : undefined;
}

function parseForecastRequest(req) {
  const latParam = parseFloat(getStringQueryParam(req.query.lat));
  const lonParam = parseFloat(getStringQueryParam(req.query.lon));
  const lat = Number.isFinite(latParam) ? latParam : DEFAULT_LAT;
  const lon = Number.isFinite(lonParam) ? lonParam : DEFAULT_LON;
  const requestedDate = getStringQueryParam(req.query.date) || getTodayInNewYork();

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { error: { status: 400, message: 'Invalid coordinates' } };
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(requestedDate)) {
    return { error: { status: 400, message: 'Invalid date format. Use YYYY-MM-DD' } };
  }

  const today = new Date(getTodayInNewYork());
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 16);
  const reqDate = new Date(requestedDate);

  if (reqDate < today || reqDate > maxDate) {
    return {
      error: { status: 400, message: 'Date must be between today and 16 days from today' },
    };
  }

  return {
    lat,
    lon,
    requestedDate,
    timezone: getTimezone(lon),
  };
}

function hasUsableForecast(data, requestedDate, requiredFields) {
  if (requiredFields.includes('hourly')) {
    const hasHourlyDate = data.hourly?.time?.some(timestamp =>
      timestamp.startsWith(`${requestedDate}T`)
    );
    if (!hasHourlyDate) return false;
  }

  if (requiredFields.includes('daily')) {
    const hasDailyDate = data.daily?.time?.includes(requestedDate);
    if (!hasDailyDate) return false;
  }

  return true;
}

async function fetchForecastFromOpenMeteo(lat, lon, timezone) {
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=uv_index,uv_index_clear_sky,precipitation_probability,temperature_2m,apparent_temperature,cloud_cover,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max,relative_humidity_2m_max&timezone=${timezone}&temperature_unit=fahrenheit&forecast_days=16`
  );

  if (!response.ok) {
    throw new Error(`API responded with status: ${response.status}`);
  }

  return response.json();
}

async function fetchAndCacheForecast(lat, lon, timezone, cacheKey) {
  const currentRefresh = forecastRefreshes.get(cacheKey);
  if (currentRefresh) {
    return currentRefresh;
  }

  const refresh = fetchForecastFromOpenMeteo(lat, lon, timezone)
    .then(data => {
      const entry = {
        data,
        timestamp: Date.now(),
      };
      forecastCache.set(cacheKey, entry);
      return entry;
    })
    .finally(() => {
      forecastRefreshes.delete(cacheKey);
    });

  forecastRefreshes.set(cacheKey, refresh);
  return refresh;
}

async function getForecast(lat, lon, requestedDate, timezone, requiredFields) {
  const cacheKey = getForecastCacheKey(lat, lon);
  const cached = forecastCache.get(cacheKey);

  if (cached && hasUsableForecast(cached.data, requestedDate, requiredFields)) {
    return { cacheKey, cacheStatus: 'hit', entry: cached };
  }

  const entry = await fetchAndCacheForecast(lat, lon, timezone, cacheKey);
  return { cacheKey, cacheStatus: 'miss', entry };
}

function refreshForecastInBackground(lat, lon, timezone, cacheKey) {
  if (forecastRefreshes.has(cacheKey)) {
    return;
  }

  fetchAndCacheForecast(lat, lon, timezone, cacheKey)
    .then(() => {
      console.log(`Forecast cache refresh completed for ${cacheKey}`);
    })
    .catch(error => {
      console.error('Forecast cache refresh error:', error.message);
    });
}

function refreshIfStale(lat, lon, timezone, cacheKey, entry) {
  if (Date.now() - entry.timestamp > FORECAST_REFRESH_MS) {
    refreshForecastInBackground(lat, lon, timezone, cacheKey);
  }
}

function addMetadata(data, entry, cacheStatus) {
  const now = Date.now();
  return {
    ...data,
    metadata: {
      cached: cacheStatus === 'hit',
      cacheAge: now - entry.timestamp,
      lastUpdated: new Date(entry.timestamp).toISOString(),
    },
  };
}

function sendForecastResponse(res, data, entry, cacheStatus) {
  res.set('X-Cache-Status', cacheStatus);
  res.json(addMetadata(data, entry, cacheStatus));
}

async function handleForecastRequest(req, res, requiredFields, buildData, logLabel, errorMessage) {
  try {
    const request = parseForecastRequest(req);
    if (request.error) {
      return res.status(request.error.status).json({ error: request.error.message });
    }

    const { lat, lon, requestedDate, timezone } = request;
    const { cacheKey, cacheStatus, entry } = await getForecast(
      lat,
      lon,
      requestedDate,
      timezone,
      requiredFields
    );

    const data = buildData(entry.data, requestedDate);
    sendForecastResponse(res, data, entry, cacheStatus);

    if (cacheStatus === 'hit') {
      refreshIfStale(lat, lon, timezone, cacheKey, entry);
    }
  } catch (error) {
    console.error(`${logLabel} error:`, error.message);
    res.status(502).json({
      error: errorMessage,
    });
  }
}

function buildWeatherData(forecastData, requestedDate) {
  return {
    ...filterDateData(forecastData.hourly, requestedDate),
    daily: extractDailyData(forecastData.daily, requestedDate),
  };
}

function prewarmHomeForecast() {
  const cacheKey = getForecastCacheKey(HOME_LOCATION.lat, HOME_LOCATION.lon);
  refreshForecastInBackground(HOME_LOCATION.lat, HOME_LOCATION.lon, 'America/New_York', cacheKey);
}

// UV API endpoint
app.get('/api/uv-today', async (req, res) => {
  await handleForecastRequest(
    req,
    res,
    ['hourly'],
    (forecastData, requestedDate) => filterDateData(forecastData.hourly, requestedDate),
    'UV API',
    'Failed to fetch UV data. Please try again later.'
  );
});

// Daily summary endpoint for highs/lows
app.get('/api/daily-summary', async (req, res) => {
  await handleForecastRequest(
    req,
    res,
    ['daily'],
    (forecastData, requestedDate) => extractDailyData(forecastData.daily, requestedDate),
    'Daily summary API',
    'Failed to fetch daily summary data. Please try again later.'
  );
});

// Combined weather endpoint used by the app fast path
app.get('/api/weather', async (req, res) => {
  await handleForecastRequest(
    req,
    res,
    ['hourly', 'daily'],
    buildWeatherData,
    'Weather API',
    'Failed to fetch weather data. Please try again later.'
  );
});

// Polling endpoint to check if newer data is available
app.get('/api/uv-today/poll', async (req, res) => {
  try {
    const latParam = parseFloat(getStringQueryParam(req.query.lat));
    const lonParam = parseFloat(getStringQueryParam(req.query.lon));
    const lat = Number.isFinite(latParam) ? latParam : DEFAULT_LAT;
    const lon = Number.isFinite(lonParam) ? lonParam : DEFAULT_LON;
    const clientTimestamp = parseInt(req.query.timestamp) || 0;

    const cacheKey = getForecastCacheKey(lat, lon);
    const cached = forecastCache.get(cacheKey);

    if (cached && cached.timestamp > clientTimestamp) {
      res.json({
        hasUpdate: true,
        timestamp: cached.timestamp,
        lastUpdated: new Date(cached.timestamp).toISOString(),
      });
    } else {
      res.json({
        hasUpdate: false,
        timestamp: cached ? cached.timestamp : null,
      });
    }
  } catch (error) {
    console.error('Poll error:', error.message);
    res.status(500).json({ error: 'Poll failed' });
  }
});

// Export the app for testing
export default app;

// Only start server if this file is run directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  prewarmHomeForecast();
  setInterval(prewarmHomeForecast, FORECAST_REFRESH_MS);

  app.listen(PORT, () => {
    console.log(`UV Index app running on http://localhost:${PORT}`);
  });
}
