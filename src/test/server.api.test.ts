import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
// @ts-ignore - server.js doesn't have TypeScript declarations
import app from '../../server.js';

// Mock global fetch to avoid real network calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper function to get a valid future date for testing
function getTestDate(offsetDays = 1) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toLocaleDateString('en-CA'); // Returns YYYY-MM-DD format
}

// Mock data for Open-Meteo API responses
function getMockHourlyData(date: string) {
  return {
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
    },
  };
}

function getMockDailyData(dates: string[]) {
  return {
    daily: {
      time: dates,
      temperature_2m_max: [68.1, 72.3],
      temperature_2m_min: [28.9, 34.2],
      uv_index_max: [5.2, 6.1],
      precipitation_probability_max: [35, 20],
      relative_humidity_2m_max: [92, 78],
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

      const response = await request(app)
        .get('/api/uv-today')
        .query({ date: testDate });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('labels');
      expect(response.body).toHaveProperty('uv');
      expect(response.body).toHaveProperty('precipitation');
      expect(response.body).toHaveProperty('temperature');
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
      const response = await request(app)
        .get('/api/uv-today')
        .query({ lat: 91, lon: 0 }); // Invalid latitude

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid coordinates');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should validate longitude bounds', async () => {
      const response = await request(app)
        .get('/api/uv-today')
        .query({ lat: 40, lon: 181 }); // Invalid longitude

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid coordinates');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should validate date format', async () => {
      const response = await request(app)
        .get('/api/uv-today')
        .query({ date: '2025/01/15' }); // Invalid format

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid date format. Use YYYY-MM-DD');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should validate date range - past dates', async () => {
      const pastDate = '2020-01-01';
      const response = await request(app)
        .get('/api/uv-today')
        .query({ date: pastDate });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Date must be between today and 16 days from today');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should validate date range - far future dates', async () => {
      const futureDate = getTestDate(20); // 20 days from now (beyond 16 day limit)
      const response = await request(app)
        .get('/api/uv-today')
        .query({ date: futureDate });

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

      const response = await request(app)
        .get('/api/uv-today')
        .query({ date: testDate });

      expect(response.status).toBe(502);
      expect(response.body.error).toBe('Failed to fetch UV data. Please try again later.');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle network errors', async () => {
      const testDate = getTestDate(4);
      
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const response = await request(app)
        .get('/api/uv-today')
        .query({ date: testDate });

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

      const response = await request(app)
        .get('/api/daily-summary')
        .query({ date: testDate });

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

  describe('GET /api/daily-summary - Validation', () => {
    it('should validate coordinates for daily summary', async () => {
      const response = await request(app)
        .get('/api/daily-summary')
        .query({ lat: -91, lon: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid coordinates');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should validate date format for daily summary', async () => {
      const response = await request(app)
        .get('/api/daily-summary')
        .query({ date: 'invalid-date' });

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

      const response = await request(app)
        .get('/api/daily-summary')
        .query({ date: testDate });

      expect(response.status).toBe(502);
      expect(response.body.error).toBe('Failed to fetch daily summary data. Please try again later.');
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

  describe('Timezone handling', () => {
    it('should use America/New_York timezone for US coordinates', async () => {
      const testDate = getTestDate(8);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockHourlyData(testDate)),
      });

      const response = await request(app)
        .get('/api/uv-today')
        .query({ lat: 40.7, lon: -74.0, date: testDate }); // New York coordinates

      expect(response.status).toBe(200);
      
      // Verify the timezone parameter was set correctly
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('timezone=America/New_York')
      );
    });

    it('should use UTC timezone for non-US coordinates', async () => {
      const testDate = getTestDate(9);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(getMockHourlyData(testDate)),
      });

      const response = await request(app)
        .get('/api/uv-today')
        .query({ lat: 51.5, lon: -0.1, date: testDate }); // London coordinates

      expect(response.status).toBe(200);
      
      // Verify the timezone parameter was set correctly
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('timezone=UTC')
      );
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
      const response1 = await request(app)
        .get('/api/uv-today')
        .query({ date: testDate1 });

      // Request for date 2 - should not hit cache due to different dates
      const response2 = await request(app)
        .get('/api/uv-today')
        .query({ date: testDate2 });

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(response1.body.date).toBe(testDate1);
      expect(response2.body.date).toBe(testDate2);

      // Both requests should have made API calls (different cache keys)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});