import { describe, it, expect } from 'vitest';
import { getUVColor, getTempLineColor } from '../utils/charts.js';

describe('Chart Utils', () => {
  describe('getUVColor', () => {
    it('should return green for low UV (0-2)', () => {
      expect(getUVColor(0)).toBe('#22c55e');
      expect(getUVColor(2)).toBe('#22c55e');
    });

    it('should return yellow for moderate UV (3-5)', () => {
      expect(getUVColor(3)).toBe('#eab308');
      expect(getUVColor(5)).toBe('#eab308');
    });

    it('should return orange for high UV (6-7)', () => {
      expect(getUVColor(6)).toBe('#f97316');
      expect(getUVColor(7)).toBe('#f97316');
    });

    it('should return red for very high UV (8-10)', () => {
      expect(getUVColor(8)).toBe('#ef4444');
      expect(getUVColor(10)).toBe('#ef4444');
    });

    it('should return purple for extreme UV (11+)', () => {
      expect(getUVColor(11)).toBe('#8b5cf6');
      expect(getUVColor(15)).toBe('#8b5cf6');
    });
  });

  describe('getTempLineColor', () => {
    it('should return blue for freezing temps (≤32°F)', () => {
      expect(getTempLineColor(0)).toBe('#3b82f6');
      expect(getTempLineColor(32)).toBe('#3b82f6');
    });

    it('should return light blue for cold temps (33-50°F)', () => {
      expect(getTempLineColor(40)).toBe('#60a5fa');
      expect(getTempLineColor(50)).toBe('#60a5fa');
    });

    it('should return green for comfortable temps (51-73°F)', () => {
      expect(getTempLineColor(65)).toBe('#10b981');
      expect(getTempLineColor(73)).toBe('#10b981');
    });

    it('should return orange for warm temps (74-84°F)', () => {
      expect(getTempLineColor(75)).toBe('#f97316');
      expect(getTempLineColor(84)).toBe('#f97316');
    });

    it('should return red for hot temps (85-94°F)', () => {
      expect(getTempLineColor(85)).toBe('#ef4444');
      expect(getTempLineColor(94)).toBe('#ef4444');
    });

    it('should return deep red for extreme temps (95°F+)', () => {
      expect(getTempLineColor(95)).toBe('#dc2626');
      expect(getTempLineColor(105)).toBe('#dc2626');
    });
  });
});
