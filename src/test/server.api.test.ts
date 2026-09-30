import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
// @ts-ignore - server.js doesn't have TypeScript declarations
import app, { apiHistoryDb, dedupeApiHistory } from '../../server.js';

// Mock global fetch to avoid real network calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper function to get a valid future date for testing
function getTestDate(offsetDays = 1) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toLocaleDateString('en-CA'); // Returns YYYY-MM-DD format
}

// Date-only UTC arithmetic, mirroring server.js's addDays, for computing
// dates relative to a location's "today" independent of test-runner host tz.
function addDaysForTest(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Mock data for Open-Meteo API responses
function getMockHourlyData(date: string, timezone = 'America/New_York') {
  return {
    timezone,
    hourly: {
      time: [
        `${date}T00:00:00`,
        `${date}T01:00:00`,
        `${date}T02:00:00`,
        `${date}T12:00:00`,
        `${date}T13:00:00`,
        `${date}T14:00:00`,
      ],
      uv_index: [0, 0, 0, 4.5, 5.2, 3.8],
      uv_index_clear_sky: [0, 0, 0, 6.1, 7.3, 5.9],
      precipitation_probability: [10, 5, 0, 20, 35, 15],
      temperature_2m: [32.1, 30.5, 28.9, 65.2, 68.1, 66.4],
      apparent_temperature: [28.3, 26.1, 24.7, 67.1, 69.8, 68.2],
      cloud_cover: [75, 60, 40, 30, 55, 45],
      relative_humidity_2m: [85, 88, 92, 45, 38, 42],
      weather_code: [3, 3, 45, 1, 2, 2],
      wind_speed_10m: [5, 6, 7, 12, 14, 10],
      wind_gusts_10m: [10, 11, 12, 22, 25, 18],
      wind_direction_10m: [270, 280, 290, 300, 310, 320],
    },
  };
}

function getMockDailyData(dates: string[], timezone = 'America/New_York') {
  return {
    timezone,
    daily: {
      time: dates,
      temperature_2m_max: [68.1, 72.3],
      temperature_2m_min: [28.9, 34.2],
      uv_index_max: [5.2, 6.1],
      precipitation_probability_max: [35, 20],
      relative_humidity_2m_max: [92, 78],
      weather_code: [61, 2],
      wind_speed_10m_max: [14, 9],
      wind_gusts_10m_max: [25, 16],
      wind_direction_10m_dominant: [300, 180],
    },
  };
}

function getMockCombinedData(date: string, timezone = 'America/New_York') {
  return {
    ...getMockHourlyData(date, timezone),
    ...getMockDailyData([date, getTestDate(15)], timezone),
  };
}

function getMockTwoDayData(dateA: string, dateB: string, timezone = 'America/New_York') {
  return {
    timezone,
    hourly: {
      time: [`${dateA}T10:00:00`, `${dateA}T11:00:00`, `${dateB}T10:00:00`, `${dateB}T11:00:00`],
      uv_index: [3.1, 4.2, 2.5, 3.3],
      uv_index_clear_sky: [5.0, 6.0, 4.0, 5.0],
      precipitation_probability: [10, 20, 30, 40],
      temperature_2m: [60.1, 62.2, 55.3, 57.4],
      apparent_temperature: [59.0, 61.0, 54.0, 56.0],
      cloud_cover: [20, 30, 40, 50],
      relative_humidity_2m: [50, 55, 60, 65],
      weather_code: [1, 2, 2, 3],
      wind_speed_10m: [3, 4, 5, 6],
      wind_gusts_10m: [8, 9, 10, 11],
      wind_direction_10m: [90, 100, 110, 120],
    },
    daily: {
      time: [dateA, dateB],
      temperature_2m_max: [62.2, 57.4],
      temperature_2m_min: [40.0, 38.0],
      uv_index_max: [4.2, 3.3],
      precipitation_probability_max: [20, 40],
      relative_humidity_2m_max: [55, 65],
      weather_code: [2, 3],
      wind_speed_10m_max: [4, 6],
      wind_gusts_10m_max: [9, 11],
      wind_direction_10m_dominant: [95, 115],
    },
  };
}

describe('Server API Endpoints', () => {
  beforeEach(() => {
    // Reset the mock fetch
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/uv-today - Core Functionality', () => {
    it('should return UV data for successful API response', async () => {
      const testDate = getTestDate();

      // Mock successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockHourlyData(testDate)),
      });

      const response = await request(app).get('/api/uv-today').query({ date: testDate });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('labels');
      expect(response.body).toHaveProperty('uv');
      expect(response.body).toHaveProperty('precipitation');
      expect(response.body).toHaveProperty('temperature');
      expect(response.body).toHaveProperty('weatherCode');
      expect(response.body).toHaveProperty('metadata');
      expect(response.body.metadata.cached).toBe(false);
      expect(response.body.date).toBe(testDate);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should accept custom coordinates', async () => {
      const testDate = getTestDate(2);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockHourlyData(testDate)),
      });

      const response = await request(app)
        .get('/api/uv-today')
        .query({ lat: 41.5, lon: -74.2, date: testDate });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('uv');

      // Verify the mock was called with the correct coordinates
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('latitude=41.5&longitude=-74.2')
      );
    });
  });

  describe('GET /api/uv-today - Validation', () => {
    it('should validate coordinate bounds', async () => {
      const response = await request(app).get('/api/uv-today').query({ lat: 91, lon: 0 }); // Invalid latitude

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid coordinates');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should validate longitude bounds', async () => {
      const response = await request(app).get('/api/uv-today').query({ lat: 40, lon: 181 }); // Invalid longitude

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid coordinates');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should validate date format', async () => {
      const response = await request(app).get('/api/uv-today').query({ date: '2025/01/15' }); // Invalid format

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid date format. Use YYYY-MM-DD');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('clamps past dates to the location today instead of erroring', async () => {
      const pastDate = '2020-01-01';
      const todayNY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockHourlyData(todayNY)),
      });

      // Fresh coordinates so this test's cache lookup is deterministic (a miss)
      // regardless of what other tests have already cached.
      const response = await request(app)
        .get('/api/uv-today')
        .query({ lat: 33.44, lon: -84.39, date: pastDate });

      expect(response.status).toBe(200);
      expect(response.body.date).toBe(todayNY);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should validate date range - far future dates', async () => {
      const testDate = getTestDate();

      // Prime the default-coordinates forecast cache explicitly so this test
      // doesn't depend on an earlier test having already warmed it (tests can
      // be run in isolation or reordered).
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockHourlyData(testDate)),
      });
      await request(app).get('/api/uv-today').query({ date: testDate });
      mockFetch.mockClear();

      const futureDate = getTestDate(20); // 20 days from now (beyond 16 day limit)
      const response = await request(app).get('/api/uv-today').query({ date: futureDate });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Date must be between today and 16 days from today');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/uv-today - Error Handling', () => {
    it('should handle API server errors', async () => {
      const testDate = getTestDate(3);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const response = await request(app).get('/api/uv-today').query({ date: testDate });

      expect(response.status).toBe(502);
      expect(response.body.error).toBe('Failed to fetch UV data. Please try again later.');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle network errors', async () => {
      const testDate = getTestDate(4);

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const response = await request(app).get('/api/uv-today').query({ date: testDate });

      expect(response.status).toBe(502);
      expect(response.body.error).toBe('Failed to fetch UV data. Please try again later.');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/daily-summary - Core Functionality', () => {
    it('should return daily summary data', async () => {
      const testDate = getTestDate(5);
      const testDates = [testDate, getTestDate(6)];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockDailyData(testDates)),
      });

      const response = await request(app).get('/api/daily-summary').query({ date: testDate });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('date');
      expect(response.body).toHaveProperty('tempMax');
      expect(response.body).toHaveProperty('tempMin');
      expect(response.body).toHaveProperty('uvMax');
      expect(response.body).toHaveProperty('precipMax');
      expect(response.body).toHaveProperty('metadata');
      expect(response.body.date).toBe(testDate);
      expect(response.body.tempMax).toBe(68.1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/weather - Combined Fast Path', () => {
    it('should return hourly and daily data from one upstream response', async () => {
      const testDate = getTestDate(6);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockCombinedData(testDate)),
      });

      const response = await request(app).get('/api/weather').query({ date: testDate });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('uv');
      expect(response.body).toHaveProperty('daily');
      expect(response.body.daily).toHaveProperty('tempMax');
      expect(response.body.metadata).toHaveProperty('performance');
      expect(response.body.metadata.performance.phases).toHaveProperty('buildData');
      expect(response.body.date).toBe(testDate);
      expect(response.body.daily.date).toBe(testDate);
      expect(response.headers['x-cache-status']).toBe('miss');
      expect(response.headers['server-timing']).toContain('total;dur=');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('includes wind in hourly and daily data and requests it in mph', async () => {
      const testDate = getTestDate(7);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockCombinedData(testDate)),
      });

      const response = await request(app).get('/api/weather').query({ date: testDate });

      expect(response.status).toBe(200);
      expect(response.body.windSpeed).toEqual([5, 6, 7, 12, 14, 10]);
      expect(response.body.windGusts).toEqual([10, 11, 12, 22, 25, 18]);
      expect(response.body.windDirection).toEqual([270, 280, 290, 300, 310, 320]);
      expect(response.body.daily).toMatchObject({ windMax: 14, gustMax: 25, windDirection: 300 });
      const url = String(mockFetch.mock.calls[0][0]);
      expect(url).toContain('wind_speed_unit=mph');
      expect(url).toContain('wind_speed_10m,wind_gusts_10m,wind_direction_10m');
      expect(url).toContain('wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant');
    });

    it('returns null wind values for a forecast without wind fields', async () => {
      const testDate = getTestDate(8);
      const data = getMockCombinedData(testDate) as any;
      delete data.hourly.wind_speed_10m;
      delete data.hourly.wind_gusts_10m;
      delete data.hourly.wind_direction_10m;
      delete data.daily.wind_speed_10m_max;
      delete data.daily.wind_gusts_10m_max;
      delete data.daily.wind_direction_10m_dominant;

      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(data) });

      const response = await request(app).get('/api/weather').query({ date: testDate });

      expect(response.status).toBe(200);
      expect(response.body.windSpeed).toEqual([null, null, null, null, null, null]);
      expect(response.body.windGusts).toHaveLength(6);
      expect(response.body.windDirection.every((v: unknown) => v === null)).toBe(true);
      expect(response.body.daily).toMatchObject({
        windMax: null,
        gustMax: null,
        windDirection: null,
      });

      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(data) });
      const cal = await request(app).get('/api/daily-calendar').query({ date: testDate });
      expect(cal.status).toBe(200);
      expect(cal.body.days[0]).toMatchObject({ windMax: null, gustMax: null, windDirection: null });
    });
  });

  describe('GET /api/history - Persisted Snapshots', () => {
    it('returns stored weather snapshots for a location and date', async () => {
      const testDate = getTestDate(14);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockCombinedData(testDate)),
      });

      await request(app).get('/api/weather').query({ date: testDate }).expect(200);

      const response = await request(app)
        .get('/api/history')
        .query({ route: '/api/weather', date: testDate, lat: 42.8006, lon: -71.3048 })
        .expect(200);

      expect(response.body.entries.length).toBeGreaterThan(0);
      const latestEntry = response.body.entries[response.body.entries.length - 1];
      expect(latestEntry.data.date).toBe(testDate);
      expect(latestEntry.data.daily.tempMax).toBe(68.1);
    });

    it('returns stored weather snapshots without a date filter', async () => {
      const testDate = getTestDate(14);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockCombinedData(testDate)),
      });

      await request(app).get('/api/weather').query({ date: testDate }).expect(200);

      const response = await request(app)
        .get('/api/history')
        .query({ route: '/api/weather', lat: 42.8006, lon: -71.3048 })
        .expect(200);

      expect(response.body.entries.length).toBeGreaterThan(0);
      expect(
        response.body.entries.some(
          (entry: { data: { date: string } }) => entry.data.date === testDate
        )
      ).toBe(true);
    });

    it('records snapshots for every date in the forecast horizon on upstream fetch', async () => {
      const dateA = getTestDate(7);
      const dateB = getTestDate(8);
      const lat = 40.77;
      const lon = -73.97;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockTwoDayData(dateA, dateB)),
      });

      await request(app).get('/api/weather').query({ lat, lon, date: dateA }).expect(200);

      const responseB = await request(app)
        .get('/api/history')
        .query({ route: '/api/weather', lat, lon, date: dateB })
        .expect(200);

      expect(responseB.body.entries).toHaveLength(1);
      expect(responseB.body.entries[0].data.daily.tempMax).toBe(57.4);
      expect(responseB.body.entries[0].cacheStatus).toBe('snapshot');

      const calendar = await request(app)
        .get('/api/history')
        .query({ route: '/api/daily-calendar', lat, lon })
        .expect(200);

      expect(calendar.body.entries).toHaveLength(1);
      expect(calendar.body.entries[0].data.days).toHaveLength(2);
    });

    it('does not duplicate snapshots when an upstream refetch returns identical data', async () => {
      const dateA = getTestDate(5);
      const dateB = getTestDate(6);
      const dateC = getTestDate(9);
      const lat = 41.42;
      const lon = -72.42;

      const payload = getMockTwoDayData(dateA, dateB);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(payload),
      });

      await request(app).get('/api/weather').query({ lat, lon, date: dateA }).expect(200);
      // dateC is outside the cached payload, forcing a second upstream fetch of identical
      // data. Snapshots are recorded in fetchAndCacheForecast before buildData runs;
      // the request itself then 502s because extractDailyData can't find dateC.
      await request(app).get('/api/weather').query({ lat, lon, date: dateC }).expect(502);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const response = await request(app)
        .get('/api/history')
        .query({ route: '/api/weather', lat, lon })
        .expect(200);

      expect(response.body.entries).toHaveLength(2);
      const dates = response.body.entries.map((entry: { date: string }) => entry.date);
      expect(dates).toContain(dateA);
      expect(dates).toContain(dateB);
    });

    it('returns the distinct snapshot timeline for a location', async () => {
      const dateA = getTestDate(10);
      const dateB = getTestDate(11);
      const lat = 39.95;
      const lon = -75.17;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockTwoDayData(dateA, dateB)),
      });

      await request(app).get('/api/weather').query({ lat, lon, date: dateA }).expect(200);

      const response = await request(app)
        .get('/api/history/timeline')
        .query({ lat, lon })
        .expect(200);

      // One upstream fetch writes many partitions, all sharing one fetched_at
      expect(response.body.times).toHaveLength(1);
      expect(typeof response.body.times[0]).toBe('string');

      await request(app).get('/api/history/timeline').query({ lat: 999, lon }).expect(400);
    });
  });

  describe('Weather art static serving', () => {
    it('serves weather art with immutable cache headers', async () => {
      const response = await request(app).get('/weather-art/v2/day-cool-storm.webp').expect(200);

      expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    });
  });

  describe('History duplicate cleanup', () => {
    it('removes consecutive duplicate snapshots, keeping the first occurrence', () => {
      const insert = apiHistoryDb.prepare(`
        INSERT INTO api_call_history (
          fetched_at, route, request_query_json, lat, lon, location_key,
          date, cache_key, cache_status, status_code, response_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const locationKey = '40.10,-70.10';
      const date = '2026-06-10';
      const payloadA = (cacheAge: number) =>
        JSON.stringify({ uv: [1, 2], metadata: { cached: true, cacheAge } });
      const payloadB = JSON.stringify({ uv: [9, 9], metadata: { cached: true, cacheAge: 3 } });

      insert.run(
        '2026-06-10T10:00:00.000Z',
        '/api/weather',
        '{}',
        40.1,
        -70.1,
        locationKey,
        date,
        null,
        'hit',
        200,
        payloadA(1)
      );
      insert.run(
        '2026-06-10T10:10:00.000Z',
        '/api/weather',
        '{}',
        40.1,
        -70.1,
        locationKey,
        date,
        null,
        'hit',
        200,
        payloadA(2)
      );
      insert.run(
        '2026-06-10T10:20:00.000Z',
        '/api/weather',
        '{}',
        40.1,
        -70.1,
        locationKey,
        date,
        null,
        'hit',
        200,
        payloadB
      );

      dedupeApiHistory();

      const rows = apiHistoryDb
        .prepare(
          'SELECT fetched_at FROM api_call_history WHERE location_key = ? ORDER BY fetched_at'
        )
        .all(locationKey);

      expect(rows.map((row: { fetched_at: string }) => row.fetched_at)).toEqual([
        '2026-06-10T10:00:00.000Z',
        '2026-06-10T10:20:00.000Z',
      ]);
    });
  });

  describe('GET /api/daily-calendar - Calendar Forecast', () => {
    it('should return available daily forecast days with weather codes', async () => {
      const testDate = getTestDate(13);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockCombinedData(testDate)),
      });

      const response = await request(app).get('/api/daily-calendar').query({ date: testDate });

      expect(response.status).toBe(200);
      expect(response.body.startDate).toBe(testDate);
      expect(response.body.days).toHaveLength(2);
      expect(response.body.days[0]).toMatchObject({
        date: testDate,
        tempMax: 68.1,
        tempMin: 28.9,
        precipitation: [10, 5, 0, 20, 35, 15],
        cloudCover: [75, 60, 40, 30, 55, 45],
        weatherCode: 61,
        windMax: 14,
        gustMax: 25,
        windDirection: 300,
      });
      expect(response.headers['x-cache-status']).toBe('miss');
      expect(response.headers['server-timing']).toContain('total;dur=');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/daily-summary - Validation', () => {
    it('should validate coordinates for daily summary', async () => {
      const response = await request(app).get('/api/daily-summary').query({ lat: -91, lon: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid coordinates');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should validate date format for daily summary', async () => {
      const response = await request(app).get('/api/daily-summary').query({ date: 'invalid-date' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid date format. Use YYYY-MM-DD');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/daily-summary - Error Handling', () => {
    it('should handle API errors for daily summary', async () => {
      const testDate = getTestDate(7);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const response = await request(app).get('/api/daily-summary').query({ date: testDate });

      expect(response.status).toBe(502);
      expect(response.body.error).toBe(
        'Failed to fetch daily summary data. Please try again later.'
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/uv-today/poll', () => {
    it('should handle poll requests gracefully', async () => {
      const response = await request(app)
        .get('/api/uv-today/poll')
        .query({ timestamp: Date.now() });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('hasUpdate');
      expect(typeof response.body.hasUpdate).toBe('boolean');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('per-location timezone handling', () => {
    it('requests timezone=auto upstream', async () => {
      const testDate = getTestDate();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockHourlyData(testDate)),
      });

      // Fresh coordinates so this test's cache lookup is deterministic (a miss).
      await request(app).get('/api/weather').query({ lat: 12.34, lon: 56.78 });

      const upstreamUrl = mockFetch.mock.calls[0][0];
      expect(upstreamUrl).toContain('timezone=auto');
      expect(upstreamUrl).not.toContain('timezone=America');
    });

    it('defaults to today in the forecast timezone when no date is given', async () => {
      const honoluluToday = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Pacific/Honolulu',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockCombinedData(honoluluToday, 'Pacific/Honolulu')),
      });

      const response = await request(app).get('/api/weather?lat=21.31&lon=-157.86');
      expect(response.status).toBe(200);
      expect(response.body.date).toBe(honoluluToday);
    });

    it('clamps dates before the location today to today instead of erroring', async () => {
      const honoluluToday = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Pacific/Honolulu',
      });
      const yesterday = addDaysForTest(honoluluToday, -1);

      // Prime the Honolulu forecast cache explicitly (same coords as the
      // previous test, but not dependent on it/its ordering) so this test
      // deterministically exercises the clamp on the cache-hit path.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockCombinedData(honoluluToday, 'Pacific/Honolulu')),
      });
      await request(app).get('/api/weather?lat=21.31&lon=-157.86');

      // /api/weather serves past days from history; endpoints without a
      // look-back window still clamp.
      const response = await request(app).get(
        `/api/uv-today?lat=21.31&lon=-157.86&date=${yesterday}`
      );
      expect(response.status).toBe(200);
      expect(response.body.date).toBe(honoluluToday);
    });

    it('rejects dates beyond the 16-day window', async () => {
      const honoluluToday = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Pacific/Honolulu',
      });
      const tooFar = addDaysForTest(honoluluToday, 17);

      // Prime the Honolulu forecast cache explicitly so this test doesn't
      // depend on test order / a preceding test having already warmed it.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockCombinedData(honoluluToday, 'Pacific/Honolulu')),
      });
      await request(app).get('/api/weather?lat=21.31&lon=-157.86');

      const response = await request(app).get(`/api/weather?lat=21.31&lon=-157.86&date=${tooFar}`);
      expect(response.status).toBe(400);
    });
  });

  describe('look back a week (historical snapshots)', () => {
    const lat = 35.68;
    const lon = 139.69;
    const tz = 'Asia/Tokyo';
    const locationKey = '35.68,139.69';
    const tokyoToday = new Date().toLocaleDateString('en-CA', { timeZone: tz });

    function storeSnapshot(route: string, date: string, fetchedAt: string, tempMax: number) {
      const body =
        route === '/api/weather'
          ? { date, hourly: [], daily: { tempMax } }
          : { days: [{ date, tempMax }] };
      apiHistoryDb
        .prepare(
          `INSERT INTO api_call_history (fetched_at, route, request_query_json, lat, lon,
            location_key, date, cache_key, cache_status, status_code, response_json)
           VALUES (?, ?, '{}', ?, ?, ?, ?, ?, 'snapshot', 200, ?)`
        )
        .run(fetchedAt, route, lat, lon, locationKey, date, locationKey, JSON.stringify(body));
    }

    function primeForecast() {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockCombinedData(tokyoToday, tz)),
      });
      return request(app).get('/api/weather').query({ lat, lon }).expect(200);
    }

    it('serves the latest stored snapshot for a past day within 7 days', async () => {
      const day = addDaysForTest(tokyoToday, -3);
      storeSnapshot('/api/weather', day, '2020-01-01T00:00:00.000Z', 50);
      storeSnapshot('/api/weather', day, '2020-01-01T06:00:00.000Z', 55);
      storeSnapshot('/api/weather', day, '2020-01-01T03:00:00.000Z', 52);
      await primeForecast();

      const response = await request(app).get('/api/weather').query({ lat, lon, date: day });
      expect(response.status).toBe(200);
      expect(response.body.date).toBe(day);
      expect(response.body.daily.tempMax).toBe(55);
      expect(response.body.metadata.historical).toBe(true);
      expect(response.body.metadata.snapshotAt).toBe('2020-01-01T06:00:00.000Z');
      expect(response.headers['cache-control']).toBe('private, max-age=300');
    });

    it('serves day -7 but clamps older dates to today', async () => {
      const edge = addDaysForTest(tokyoToday, -7);
      storeSnapshot('/api/weather', edge, '2020-01-02T00:00:00.000Z', 41);
      await primeForecast();

      const ok = await request(app).get('/api/weather').query({ lat, lon, date: edge });
      expect(ok.status).toBe(200);
      expect(ok.body.metadata.historical).toBe(true);

      const tooOld = await request(app)
        .get('/api/weather')
        .query({ lat, lon, date: addDaysForTest(tokyoToday, -8) });
      expect(tooOld.status).toBe(200);
      expect(tooOld.body.date).toBe(tokyoToday);
      expect(tooOld.body.metadata.historical).toBeUndefined();
    });

    it('returns 404 when no snapshot is stored for a past day', async () => {
      const day = addDaysForTest(tokyoToday, -5);
      await primeForecast();

      const response = await request(app).get('/api/weather').query({ lat, lon, date: day });
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'No stored forecast for this day',
        historical: true,
        date: day,
      });
    });

    it('serves past daily-calendar snapshots too', async () => {
      const day = addDaysForTest(tokyoToday, -2);
      storeSnapshot('/api/daily-calendar', day, '2020-01-03T00:00:00.000Z', 60);
      await primeForecast();

      const response = await request(app).get('/api/daily-calendar').query({ lat, lon, date: day });
      expect(response.status).toBe(200);
      expect(response.body.days[0].date).toBe(day);
      expect(response.body.metadata.historical).toBe(true);
      expect(response.body.metadata.snapshotAt).toBe('2020-01-03T00:00:00.000Z');
    });

    it('still clamps past dates on other endpoints and serves today normally', async () => {
      const day = addDaysForTest(tokyoToday, -2);
      storeSnapshot('/api/weather', day, '2020-01-04T00:00:00.000Z', 70);
      await primeForecast();

      const widget = await request(app).get('/api/widget').query({ lat, lon, date: day });
      expect(widget.status).toBe(200);
      expect(widget.body.date).toBe(tokyoToday);

      const today = await request(app).get('/api/weather').query({ lat, lon });
      expect(today.status).toBe(200);
      expect(today.body.date).toBe(tokyoToday);
      expect(today.body.metadata.historical).toBeUndefined();
      expect(today.headers['cache-control']).toBe('no-store');
    });
  });

  describe('Static file serving', () => {
    it('should handle static file requests', async () => {
      const response = await request(app).get('/manifest.json');

      // Should either serve the file (200) or return 404 if not found
      expect([200, 404]).toContain(response.status);
    });

    it('should handle root path', async () => {
      const response = await request(app).get('/');

      // Should either serve index.html (200) or return 404 if not found
      expect([200, 404]).toContain(response.status);
    });
  });

  describe('API responses are never HTTP-cacheable', () => {
    // A restored Android tab replays HTTP-cached API responses without
    // validation for requests made before the load event; no-store means
    // there is nothing on disk to replay.
    it.each(['/api/weather', '/api/daily-calendar', '/api/uv-today', '/api/daily-summary'])(
      'sends Cache-Control: no-store on %s',
      async path => {
        const testDate = getTestDate(6);
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve(getMockCombinedData(testDate)),
        });
        const response = await request(app)
          .get(path)
          .query({ lat: 42.8006, lon: -71.3048, date: testDate });
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
      }
    );
  });

  describe('GET /auth/refresh', () => {
    it('redirects to / with no-store caching so Cloudflare Access sees the raw request', async () => {
      const response = await request(app).get('/auth/refresh');

      expect(response.status).toBe(302);
      expect(response.headers['location']).toBe('/');
      expect(response.headers['cache-control']).toBe('no-store');
    });
  });

  describe('Cache Key Isolation', () => {
    it('should use different cache keys for different coordinates', async () => {
      const testDate = getTestDate(10);

      // Setup mocks for two different locations
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(getMockHourlyData(testDate)),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(getMockHourlyData(testDate)),
        });

      // Request for location 1
      const response1 = await request(app)
        .get('/api/uv-today')
        .query({ lat: 40.72, lon: -74.36, date: testDate });

      // Request for location 2 - should not hit cache due to different coordinates
      const response2 = await request(app)
        .get('/api/uv-today')
        .query({ lat: 41.72, lon: -74.36, date: testDate });

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // Both requests should have made API calls (different cache keys)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should use different cache keys for different dates', async () => {
      const testDate1 = getTestDate(11);
      const testDate2 = getTestDate(12);

      // Setup mocks for two different dates
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(getMockHourlyData(testDate1)),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(getMockHourlyData(testDate2)),
        });

      // Request for date 1
      const response1 = await request(app).get('/api/uv-today').query({ date: testDate1 });

      // Request for date 2 - should not hit cache due to different dates
      const response2 = await request(app).get('/api/uv-today').query({ date: testDate2 });

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(response1.body.date).toBe(testDate1);
      expect(response2.body.date).toBe(testDate2);

      // Both requests should have made API calls (different cache keys)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
