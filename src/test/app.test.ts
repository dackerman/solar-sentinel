import { describe, it, expect } from 'vitest';
import { getUVColor, getTempLineColor } from '../utils/charts.js';

describe('Chart utilities', () => {
  describe('getUVColor', () => {
    it('should return correct color for low UV', () => {
      expect(getUVColor(0)).toBe('#22c55e');
      expect(getUVColor(2)).toBe('#22c55e');
    });

    it('should return correct color for moderate UV', () => {
      expect(getUVColor(3)).toBe('#eab308');
      expect(getUVColor(5)).toBe('#eab308');
    });

    it('should return correct color for high UV', () => {
      expect(getUVColor(6)).toBe('#f97316');
      expect(getUVColor(7)).toBe('#f97316');
    });

    it('should return correct color for very high UV', () => {
      expect(getUVColor(8)).toBe('#ef4444');
      expect(getUVColor(10)).toBe('#ef4444');
    });

    it('should return correct color for extreme UV', () => {
      expect(getUVColor(11)).toBe('#8b5cf6');
      expect(getUVColor(15)).toBe('#8b5cf6');
    });
  });

  describe('getTempLineColor', () => {
    it('should return blue for freezing temperatures', () => {
      expect(getTempLineColor(20)).toBe('#3b82f6');
      expect(getTempLineColor(32)).toBe('#3b82f6');
    });

    it('should return light blue for cold temperatures', () => {
      expect(getTempLineColor(40)).toBe('#60a5fa');
      expect(getTempLineColor(50)).toBe('#60a5fa');
    });

    it('should return green for mild temperatures', () => {
      expect(getTempLineColor(60)).toBe('#10b981');
      expect(getTempLineColor(73)).toBe('#10b981');
    });

    it('should return orange for warm temperatures', () => {
      expect(getTempLineColor(75)).toBe('#f97316');
      expect(getTempLineColor(84)).toBe('#f97316');
    });

    it('should return red for hot temperatures', () => {
      expect(getTempLineColor(85)).toBe('#ef4444');
      expect(getTempLineColor(94)).toBe('#ef4444');
    });

    it('should return deep red for very hot temperatures', () => {
      expect(getTempLineColor(100)).toBe('#dc2626');
    });
  });
});
