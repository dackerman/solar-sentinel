import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory cache for UV data
let uvCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Serve static files from public directory
app.use(express.static(join(__dirname, 'public')));

// Get today's date in America/New_York timezone
function getTodayInNewYork() {
  return new Date().toLocaleDateString('en-CA', { 
    timeZone: 'America/New_York' 
  }); // Returns YYYY-MM-DD format
}

// Filter UV data for today only
function filterTodayData(hourlyData) {
  const today = getTodayInNewYork();
  const todayIndices = [];
  
  hourlyData.time.forEach((timestamp, index) => {
    const date = timestamp.split('T')[0];
    if (date === today) {
      todayIndices.push(index);
    }
  });

  const labels = todayIndices.map(i => {
    const hour = new Date(hourlyData.time[i]).getHours();
    return `${hour}:00`;
  });
  
  const values = todayIndices.map(i => hourlyData.uv_index[i]);
  
  return { labels, values };
}

// UV API endpoint
app.get('/api/uv-today', async (req, res) => {
  try {
    // Check cache
    if (uvCache && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_DURATION)) {
      return res.json(uvCache);
    }

    // Fetch fresh data
    const response = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=40.7206&longitude=-74.3637&hourly=uv_index&timezone=America/New_York'
    );

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();
    const todayData = filterTodayData(data.hourly);

    // Update cache
    uvCache = todayData;
    cacheTimestamp = Date.now();

    res.json(todayData);
  } catch (error) {
    console.error('UV API error:', error.message);
    res.status(502).json({ 
      error: 'Failed to fetch UV data. Please try again later.' 
    });
  }
});

app.listen(PORT, () => {
  console.log(`UV Index app running on http://localhost:${PORT}`);
});