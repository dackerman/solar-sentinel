import express from 'express';
import compression from 'compression';
import { mkdirSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 43187;
const DB_PATH =
  process.env.SQLITE_DB_PATH ||
  (process.env.NODE_ENV === 'test' ? ':memory:' : join(__dirname, 'data', 'solar-sentinel.sqlite'));

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
const API_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

if (DB_PATH !== ':memory:') {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

const apiHistoryDb = new DatabaseSync(DB_PATH);
apiHistoryDb.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS api_call_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fetched_at TEXT NOT NULL,
    route TEXT NOT NULL,
    request_query_json TEXT NOT NULL,
    lat REAL,
    lon REAL,
    location_key TEXT,
    date TEXT,
    cache_key TEXT,
    cache_status TEXT,
    status_code INTEGER NOT NULL,
    response_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_api_call_history_lookup
    ON api_call_history (route, location_key, date, status_code, fetched_at);
`);

const insertApiHistoryStatement = apiHistoryDb.prepare(`
  INSERT INTO api_call_history (
    fetched_at,
    route,
    request_query_json,
    lat,
    lon,
    location_key,
    date,
    cache_key,
    cache_status,
    status_code,
    response_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectApiHistoryStatement = apiHistoryDb.prepare(`
  SELECT * FROM (
    SELECT
      id,
      fetched_at,
      route,
      lat,
      lon,
      date,
      cache_status,
      status_code,
      response_json
    FROM api_call_history
    WHERE route = ?
      AND location_key = ?
      AND date = ?
      AND status_code = 200
    ORDER BY fetched_at DESC, id DESC
    LIMIT ?
  )
  ORDER BY fetched_at ASC, id ASC
`);

const selectApiHistoryBeforeStatement = apiHistoryDb.prepare(`
  SELECT * FROM (
    SELECT
      id,
      fetched_at,
      route,
      lat,
      lon,
      date,
      cache_status,
      status_code,
      response_json
    FROM api_call_history
    WHERE route = ?
      AND location_key = ?
      AND date = ?
      AND status_code = 200
      AND fetched_at < ?
    ORDER BY fetched_at DESC, id DESC
    LIMIT ?
  )
  ORDER BY fetched_at ASC, id ASC
`);

const selectApiHistoryAfterStatement = apiHistoryDb.prepare(`
  SELECT
    id,
    fetched_at,
    route,
    lat,
    lon,
    date,
    cache_status,
    status_code,
    response_json
  FROM api_call_history
  WHERE route = ?
    AND location_key = ?
    AND date = ?
    AND status_code = 200
    AND fetched_at > ?
  ORDER BY fetched_at ASC, id ASC
  LIMIT ?
`);

const pruneApiHistoryStatement = apiHistoryDb.prepare(`
  DELETE FROM api_call_history
  WHERE fetched_at < ?
`);

function pruneApiHistory() {
  try {
    const cutoff = new Date(Date.now() - API_HISTORY_RETENTION_MS).toISOString();
    pruneApiHistoryStatement.run(cutoff);
  } catch (error) {
    console.error('API history prune error:', error.message);
  }
}

pruneApiHistory();
setInterval(pruneApiHistory, 24 * 60 * 60 * 1000);

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

function roundTiming(duration) {
  return Math.round(duration * 10) / 10;
}

function createRequestTimer() {
  const start = performance.now();
  const phases = [];

  return {
    measure(name, phaseStart) {
      phases.push({
        name,
        duration: roundTiming(performance.now() - phaseStart),
      });
    },
    add(name, duration) {
      phases.push({
        name,
        duration: roundTiming(duration),
      });
    },
    total() {
      return roundTiming(performance.now() - start);
    },
    metadata() {
      return {
        totalMs: this.total(),
        phases: Object.fromEntries(phases.map(phase => [phase.name, phase.duration])),
      };
    },
    serverTiming() {
      return [
        ...phases.map(phase => `${phase.name};dur=${phase.duration}`),
        `total;dur=${this.total()}`,
      ].join(', ');
    },
  };
}

app.use(compression());

// Serve static files with appropriate cache headers
// In production, serve built files; in development, serve public files
const staticDir = process.env.NODE_ENV === 'production' ? 'dist' : 'public';
app.use(
  express.static(join(__dirname, staticDir), {
    setHeaders: (res, path) => {
      // Vite emits fingerprinted files under /assets; cache those indefinitely.
      if (path.match(/[\\/]assets[\\/]/)) {
        res.set({
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
      }
      // No cache for HTML files (always get updates)
      else if (path.endsWith('.html') || path.endsWith('/')) {
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
      else if (path.match(/\.(png|jpg|jpeg|gif|ico|svg|webp)$/)) {
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
  const weatherCodeValues = hourlyData.weather_code
    ? todayIndices.map(i => hourlyData.weather_code[i])
    : todayIndices.map(() => undefined);

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
    weatherCode: weatherCodeValues,
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
    weatherCode: dailyData.weather_code?.[dateIndex],
  };
}

function getHourlyValuesByDate(hourlyData, field) {
  const valuesByDate = new Map();

  hourlyData.time.forEach((timestamp, index) => {
    const date = timestamp.split('T')[0];
    const values = valuesByDate.get(date) || [];
    values.push(hourlyData[field][index]);
    valuesByDate.set(date, values);
  });

  return valuesByDate;
}

function buildDailyCalendarData(dailyData, hourlyData, startDate) {
  const hourlyPrecipitationByDate = getHourlyValuesByDate(hourlyData, 'precipitation_probability');
  const hourlyCloudCoverByDate = getHourlyValuesByDate(hourlyData, 'cloud_cover');
  const days = dailyData.time
    .map((date, index) => ({
      date,
      tempMax: dailyData.temperature_2m_max[index],
      tempMin: dailyData.temperature_2m_min[index],
      uvMax: dailyData.uv_index_max[index],
      precipMax: dailyData.precipitation_probability_max[index],
      precipitation: hourlyPrecipitationByDate.get(date) || [],
      cloudCover: hourlyCloudCoverByDate.get(date) || [],
      humidityMax: dailyData.relative_humidity_2m_max[index],
      weatherCode: dailyData.weather_code?.[index],
    }))
    .filter(day => day.date >= startDate);

  return {
    startDate,
    endDate: days.length > 0 ? days[days.length - 1].date : startDate,
    days,
  };
}

function getForecastCacheKey(lat, lon) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function getHistoryLocationName(lat, lon) {
  const isHome =
    Math.abs(lat - HOME_LOCATION.lat) < 0.001 && Math.abs(lon - HOME_LOCATION.lon) < 0.001;
  return isHome ? HOME_LOCATION.name : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function getSafeNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function recordApiCall({ req, lat, lon, date, cacheKey, cacheStatus, statusCode, responseBody }) {
  try {
    const safeLat = getSafeNumber(lat);
    const safeLon = getSafeNumber(lon);
    const locationKey =
      safeLat !== null && safeLon !== null ? getForecastCacheKey(safeLat, safeLon) : null;

    insertApiHistoryStatement.run(
      new Date().toISOString(),
      req.path,
      JSON.stringify(req.query || {}),
      safeLat,
      safeLon,
      locationKey,
      date || null,
      cacheKey || null,
      cacheStatus || null,
      statusCode,
      JSON.stringify(responseBody)
    );
  } catch (error) {
    console.error('API history write error:', error.message);
  }
}

function getApiHistoryEntries({ route, lat, lon, date, limit, before, after }) {
  const locationKey = getForecastCacheKey(lat, lon);
  const rows = before
    ? selectApiHistoryBeforeStatement.all(route, locationKey, date, before, limit)
    : after
      ? selectApiHistoryAfterStatement.all(route, locationKey, date, after, limit)
      : selectApiHistoryStatement.all(route, locationKey, date, limit);

  return rows
    .map(row => {
      try {
        return {
          id: row.id,
          fetchedAt: row.fetched_at,
          route: row.route,
          location: {
            lat: row.lat,
            lon: row.lon,
            name: getHistoryLocationName(row.lat, row.lon),
            isUserLocation: getHistoryLocationName(row.lat, row.lon) !== HOME_LOCATION.name,
          },
          date: row.date,
          cacheStatus: row.cache_status,
          statusCode: row.status_code,
          data: JSON.parse(row.response_json),
        };
      } catch (error) {
        console.error('API history read error:', error.message);
        return null;
      }
    })
    .filter(Boolean);
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

function parseHistoryRequest(req) {
  const route = getStringQueryParam(req.query.route) || '/api/weather';
  const allowedRoutes = new Set(['/api/weather', '/api/daily-calendar']);
  if (!allowedRoutes.has(route)) {
    return { error: { status: 400, message: 'Invalid history route' } };
  }

  const latParam = parseFloat(getStringQueryParam(req.query.lat));
  const lonParam = parseFloat(getStringQueryParam(req.query.lon));
  const lat = Number.isFinite(latParam) ? latParam : DEFAULT_LAT;
  const lon = Number.isFinite(lonParam) ? lonParam : DEFAULT_LON;
  const requestedDate = getStringQueryParam(req.query.date) || getTodayInNewYork();
  const limitParam = parseInt(getStringQueryParam(req.query.limit), 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 200;
  const before = getStringQueryParam(req.query.before);
  const after = getStringQueryParam(req.query.after);

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { error: { status: 400, message: 'Invalid coordinates' } };
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(requestedDate)) {
    return { error: { status: 400, message: 'Invalid date format. Use YYYY-MM-DD' } };
  }

  return {
    route,
    lat,
    lon,
    requestedDate,
    limit,
    before,
    after,
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
  const upstreamStart = performance.now();
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=uv_index,uv_index_clear_sky,precipitation_probability,temperature_2m,apparent_temperature,cloud_cover,relative_humidity_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max,relative_humidity_2m_max,weather_code&timezone=${timezone}&temperature_unit=fahrenheit&forecast_days=16`
  );
  const responseMs = roundTiming(performance.now() - upstreamStart);

  if (!response.ok) {
    throw new Error(`API responded with status: ${response.status}`);
  }

  const parseStart = performance.now();
  const data = await response.json();
  const parseMs = roundTiming(performance.now() - parseStart);

  console.log('Open-Meteo fetch completed', {
    lat,
    lon,
    timezone,
    responseMs,
    parseMs,
    totalMs: roundTiming(performance.now() - upstreamStart),
  });

  return data;
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
  const lookupStart = performance.now();
  const cacheKey = getForecastCacheKey(lat, lon);
  const cached = forecastCache.get(cacheKey);
  const cacheLookupMs = performance.now() - lookupStart;

  const validationStart = performance.now();
  if (cached && hasUsableForecast(cached.data, requestedDate, requiredFields)) {
    return {
      cacheKey,
      cacheStatus: 'hit',
      entry: cached,
      performance: {
        cacheLookupMs,
        cacheValidationMs: performance.now() - validationStart,
      },
    };
  }
  const cacheValidationMs = performance.now() - validationStart;

  const forecastWaitStart = performance.now();
  const entry = await fetchAndCacheForecast(lat, lon, timezone, cacheKey);
  return {
    cacheKey,
    cacheStatus: 'miss',
    entry,
    performance: {
      cacheLookupMs,
      cacheValidationMs,
      forecastWaitMs: performance.now() - forecastWaitStart,
    },
  };
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

function addMetadata(data, entry, cacheStatus, performanceMetadata) {
  const now = Date.now();
  return {
    ...data,
    metadata: {
      cached: cacheStatus === 'hit',
      cacheAge: now - entry.timestamp,
      lastUpdated: new Date(entry.timestamp).toISOString(),
      performance: performanceMetadata,
    },
  };
}

function sendForecastResponse(req, res, data, entry, cacheStatus, timer, historyContext) {
  const responseBody = addMetadata(data, entry, cacheStatus, timer.metadata());
  res.set('X-Cache-Status', cacheStatus);
  res.set('Server-Timing', timer.serverTiming());
  recordApiCall({
    req,
    ...historyContext,
    cacheStatus,
    statusCode: 200,
    responseBody,
  });
  res.json(responseBody);
}

async function handleForecastRequest(req, res, requiredFields, buildData, logLabel, errorMessage) {
  const timer = createRequestTimer();
  let responseContext = {
    route: req.path,
    cacheStatus: 'error',
  };

  res.on('finish', () => {
    console.log(`${logLabel} request completed`, {
      ...responseContext,
      statusCode: res.statusCode,
      totalMs: timer.total(),
    });
  });

  try {
    const parseStart = performance.now();
    const request = parseForecastRequest(req);
    timer.measure('parseRequest', parseStart);

    if (request.error) {
      const responseBody = { error: request.error.message };
      responseContext = {
        ...responseContext,
        error: request.error.message,
      };
      recordApiCall({
        req,
        lat: parseFloat(getStringQueryParam(req.query.lat)),
        lon: parseFloat(getStringQueryParam(req.query.lon)),
        date: getStringQueryParam(req.query.date),
        cacheStatus: 'error',
        statusCode: request.error.status,
        responseBody,
      });
      return res.status(request.error.status).json(responseBody);
    }

    const { lat, lon, requestedDate, timezone } = request;
    responseContext = {
      ...responseContext,
      lat,
      lon,
      date: requestedDate,
    };

    const forecastStart = performance.now();
    const {
      cacheKey,
      cacheStatus,
      entry,
      performance: forecastPerformance,
    } = await getForecast(lat, lon, requestedDate, timezone, requiredFields);
    timer.measure('getForecast', forecastStart);
    Object.entries(forecastPerformance).forEach(([name, duration]) => {
      timer.add(name, duration);
    });
    responseContext = {
      ...responseContext,
      cacheKey,
      cacheStatus,
      cacheAgeMs: Date.now() - entry.timestamp,
    };

    const buildStart = performance.now();
    const data = buildData(entry.data, requestedDate);
    timer.measure('buildData', buildStart);

    if (cacheStatus === 'hit') {
      const refreshStart = performance.now();
      refreshIfStale(lat, lon, timezone, cacheKey, entry);
      timer.measure('refreshCheck', refreshStart);
    }

    sendForecastResponse(req, res, data, entry, cacheStatus, timer, {
      lat,
      lon,
      date: requestedDate,
      cacheKey,
    });
  } catch (error) {
    console.error(`${logLabel} error:`, error.message);
    const responseBody = {
      error: errorMessage,
    };
    responseContext = {
      ...responseContext,
      error: error.message,
    };
    recordApiCall({
      req,
      lat: responseContext.lat,
      lon: responseContext.lon,
      date: responseContext.date,
      cacheKey: responseContext.cacheKey,
      cacheStatus: 'error',
      statusCode: 502,
      responseBody,
    });
    res.status(502).json(responseBody);
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

// Daily calendar endpoint used by the async forecast calendar UI
app.get('/api/daily-calendar', async (req, res) => {
  await handleForecastRequest(
    req,
    res,
    ['hourly', 'daily'],
    (forecastData, requestedDate) =>
      buildDailyCalendarData(forecastData.daily, forecastData.hourly, requestedDate),
    'Daily calendar API',
    'Failed to fetch daily calendar data. Please try again later.'
  );
});

// Persisted response snapshots for the frontend history scrubber.
app.get('/api/history', (req, res) => {
  const request = parseHistoryRequest(req);
  if (request.error) {
    return res.status(request.error.status).json({ error: request.error.message });
  }

  const { route, lat, lon, requestedDate, limit, before, after } = request;
  const entries = getApiHistoryEntries({
    route,
    lat,
    lon,
    date: requestedDate,
    limit,
    before,
    after,
  });

  res.json({
    route,
    date: requestedDate,
    location: {
      lat,
      lon,
      name: getHistoryLocationName(lat, lon),
      isUserLocation: getHistoryLocationName(lat, lon) !== HOME_LOCATION.name,
    },
    entries,
  });
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
      const responseBody = {
        hasUpdate: true,
        timestamp: cached.timestamp,
        lastUpdated: new Date(cached.timestamp).toISOString(),
      };
      recordApiCall({
        req,
        lat,
        lon,
        date: getStringQueryParam(req.query.date),
        cacheKey,
        cacheStatus: 'hit',
        statusCode: 200,
        responseBody,
      });
      res.json(responseBody);
    } else {
      const responseBody = {
        hasUpdate: false,
        timestamp: cached ? cached.timestamp : null,
      };
      recordApiCall({
        req,
        lat,
        lon,
        date: getStringQueryParam(req.query.date),
        cacheKey,
        cacheStatus: cached ? 'hit' : 'miss',
        statusCode: 200,
        responseBody,
      });
      res.json(responseBody);
    }
  } catch (error) {
    console.error('Poll error:', error.message);
    const responseBody = { error: 'Poll failed' };
    recordApiCall({
      req,
      lat: parseFloat(getStringQueryParam(req.query.lat)),
      lon: parseFloat(getStringQueryParam(req.query.lon)),
      date: getStringQueryParam(req.query.date),
      cacheStatus: 'error',
      statusCode: 500,
      responseBody,
    });
    res.status(500).json(responseBody);
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
