import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory cache for UV data (keyed by location)
const uvCache = new Map();

// Cache cleanup function - removes past dates
function cleanupCache() {
  const today = getTodayInNewYork();
  const todayDate = new Date(today);
  
  for (const [key, value] of uvCache.entries()) {
    const keyDate = new Date(value.data.date);
    if (keyDate < todayDate) {
      uvCache.delete(key);
    }
  }
}

// Run cleanup on startup and daily at midnight
cleanupCache();
setInterval(cleanupCache, 24 * 60 * 60 * 1000); // Daily

// Default location (Summit, NJ)
const DEFAULT_LAT = 40.7162;
const DEFAULT_LON = -74.3625;

// Serve static files from public directory
app.use(express.static(join(__dirname, 'public')));

// Get today's date in America/New_York timezone
function getTodayInNewYork() {
  return new Date().toLocaleDateString('en-CA', { 
    timeZone: 'America/New_York' 
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
  const tempValues = todayIndices.map(i => hourlyData.apparent_temperature[i]);
  const cloudValues = todayIndices.map(i => hourlyData.cloud_cover[i]);
  const humidityValues = todayIndices.map(i => hourlyData.relative_humidity_2m[i]);
  
  return { 
    labels, 
    uv: uvValues,
    uvClearSky: uvClearSkyValues,
    precipitation: precipValues,
    temperature: tempValues,
    cloudCover: cloudValues,
    humidity: humidityValues,
    date: targetDate
  };
}

// Background cache update function
async function updateCacheInBackground(lat, lon, requestedDate, timezone, cacheKey) {
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=uv_index,uv_index_clear_sky,precipitation_probability,apparent_temperature,cloud_cover,relative_humidity_2m&timezone=${timezone}&temperature_unit=fahrenheit&forecast_days=16`
    );

    if (!response.ok) {
      console.error(`Background update failed: ${response.status}`);
      return;
    }

    const data = await response.json();
    const dateData = filterDateData(data.hourly, requestedDate);

    // Update cache with fresh data
    uvCache.set(cacheKey, {
      data: dateData,
      timestamp: Date.now()
    });

    console.log(`Background cache update completed for ${cacheKey}`);
  } catch (error) {
    console.error('Background update error:', error.message);
  }
}

// UV API endpoint
app.get('/api/uv-today', async (req, res) => {
  try {
    // Get coordinates and date from query params or use defaults
    const lat = parseFloat(req.query.lat) || DEFAULT_LAT;
    const lon = parseFloat(req.query.lon) || DEFAULT_LON;
    const requestedDate = req.query.date || getTodayInNewYork();
    
    // Validate coordinates
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(requestedDate)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Validate date range (today to 16 days from today)
    const today = new Date(getTodayInNewYork());
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 16);
    const reqDate = new Date(requestedDate);
    
    if (reqDate < today || reqDate > maxDate) {
      return res.status(400).json({ error: 'Date must be between today and 16 days from today' });
    }

    // Determine timezone (simple heuristic)
    const timezone = lon >= -130 && lon <= -60 ? 'America/New_York' : 'UTC';

    // Create cache key including date (2 decimal places = ~1.1 km resolution)
    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)},${requestedDate}`;
    
    // Check cache - return immediately if available
    const cached = uvCache.get(cacheKey);
    if (cached) {
      // Return cached data with metadata
      res.set('X-Cache-Status', 'hit');
      res.json({
        ...cached.data,
        metadata: {
          cached: true,
          cacheAge: Date.now() - cached.timestamp,
          lastUpdated: new Date(cached.timestamp).toISOString()
        }
      });
      
      // For future dates, trigger background update
      if (reqDate >= today) {
        updateCacheInBackground(lat, lon, requestedDate, timezone, cacheKey);
      }
      return;
    }

    // Fetch fresh data with extended forecast range
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=uv_index,uv_index_clear_sky,precipitation_probability,apparent_temperature,cloud_cover,relative_humidity_2m&timezone=${timezone}&temperature_unit=fahrenheit&forecast_days=16`
    );

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();
    const dateData = filterDateData(data.hourly, requestedDate);

    // Update cache
    uvCache.set(cacheKey, {
      data: dateData,
      timestamp: Date.now()
    });

    res.set('X-Cache-Status', 'miss');
    res.json({
      ...dateData,
      metadata: {
        cached: false,
        cacheAge: 0,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('UV API error:', error.message);
    res.status(502).json({ 
      error: 'Failed to fetch UV data. Please try again later.' 
    });
  }
});

// Polling endpoint to check if newer data is available
app.get('/api/uv-today/poll', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || DEFAULT_LAT;
    const lon = parseFloat(req.query.lon) || DEFAULT_LON;
    const requestedDate = req.query.date || getTodayInNewYork();
    const clientTimestamp = parseInt(req.query.timestamp) || 0;
    
    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)},${requestedDate}`;
    const cached = uvCache.get(cacheKey);
    
    if (cached && cached.timestamp > clientTimestamp) {
      res.json({ 
        hasUpdate: true, 
        timestamp: cached.timestamp,
        lastUpdated: new Date(cached.timestamp).toISOString()
      });
    } else {
      res.json({ 
        hasUpdate: false,
        timestamp: cached ? cached.timestamp : null
      });
    }
  } catch (error) {
    console.error('Poll error:', error.message);
    res.status(500).json({ error: 'Poll failed' });
  }
});

app.listen(PORT, () => {
  console.log(`UV Index app running on http://localhost:${PORT}`);
});