// Test setup file
import { vi } from 'vitest';

// Mock Chart.js
(global as any).Chart = vi.fn().mockImplementation(() => ({
  destroy: vi.fn(),
  update: vi.fn(),
}));

// Mock fetch
global.fetch = vi.fn();

// Mock geolocation
Object.defineProperty(global.navigator, 'geolocation', {
  value: {
    getCurrentPosition: vi.fn(),
  },
});
