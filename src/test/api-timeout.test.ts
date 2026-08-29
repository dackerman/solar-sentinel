import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeatherAPI } from '../services/api.js';
import type { WeatherData, Location } from '../types/weather.js';

describe('WeatherAPI request timeout', () => {
  let api: WeatherAPI;
  const mockLocation: Location = {
    lat: 42.8006,
    lon: -71.3048,
    name: 'Windham, NH',
    isUserLocation: false,
  };

  const mockData: WeatherData = {
    labels: ['12:00 AM'],
    uv: [0],
    uvClearSky: [0],
    precipitation: [0],
    temperature: [60],
    apparentTemperature: [58],
    cloudCover: [0],
    humidity: [70],
    date: '2025-08-31',
    daily: {
      date: '2025-08-31',
      tempMax: 70,
      tempMin: 50,
      uvMax: 5,
      precipMax: 10,
      humidityMax: 70,
    },
  };

  beforeEach(() => {
    api = new WeatherAPI();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Real fetch rejects with an AbortError as soon as the passed-in signal
  // aborts; a bare vi.fn() mock doesn't do that automatically, so the mock
  // has to wire it up itself to stand in for that behavior.
  const mockAbortableFetch = (onSignal?: (signal: AbortSignal | undefined) => void) => {
    vi.mocked(global.fetch).mockImplementation((_input, init) => {
      const signal = (init as RequestInit | undefined)?.signal ?? undefined;
      onSignal?.(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
  };

  it('rejects a hung request after 20s instead of waiting forever', async () => {
    vi.useFakeTimers();
    mockAbortableFetch();

    const result = api.fetchWeatherData(mockLocation, '2025-08-31');
    // Attach a rejection handler immediately so vitest doesn't flag the
    // still-pending promise as an unhandled rejection while we advance timers.
    const rejection = expect(result).rejects.toThrow(
      /^Request timed out after 20s: .*\/api\/weather/
    );

    await vi.advanceTimersByTimeAsync(20_000);

    await rejection;
  });

  it('aborts the signal passed to fetch when the timeout fires', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    mockAbortableFetch(signal => {
      capturedSignal = signal;
    });

    const result = api.fetchWeatherData(mockLocation, '2025-08-31');
    const rejection = expect(result).rejects.toThrow('Request timed out after 20s');

    expect(capturedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(20_000);

    expect(capturedSignal?.aborted).toBe(true);
    await rejection;
  });

  it('still resolves a normal fast response and leaves no pending timer', async () => {
    vi.useFakeTimers();
    const mockResponse = {
      ok: true,
      headers: { get: vi.fn().mockReturnValue('hit') },
      json: vi.fn().mockResolvedValue(mockData),
      clone: vi.fn(),
    };
    mockResponse.clone.mockReturnValue(mockResponse);
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

    const result = await api.fetchWeatherData(mockLocation, '2025-08-31');

    expect(result.date).toBe('2025-08-31');
    expect(vi.getTimerCount()).toBe(0);
  });
});
