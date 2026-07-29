import { describe, it, expect } from 'vitest';
import {
  classifyAxis,
  directionForOffset,
  applyResistance,
  shouldCommit,
} from '../utils/swipeNavigation.js';

describe('classifyAxis', () => {
  it('is undecided while total movement is under 10px', () => {
    expect(classifyAxis(3, 3)).toBeNull(); // hypot ~ 4.24
    expect(classifyAxis(9, 0)).toBeNull();
    expect(classifyAxis(0, 9)).toBeNull();
    expect(classifyAxis(0, 0)).toBeNull();
  });

  it('decides horizontal once movement clears the threshold and dx dominates', () => {
    expect(classifyAxis(10, 0)).toBe('horizontal'); // hypot exactly 10, not "under"
    expect(classifyAxis(12, 9)).toBe('horizontal'); // ratio 1.333 > 1.2
    expect(classifyAxis(100, 20)).toBe('horizontal');
  });

  it('decides vertical when dy dominates or the ratio ties', () => {
    expect(classifyAxis(9, 12)).toBe('vertical');
    expect(classifyAxis(10, 10)).toBe('vertical'); // ratio exactly 1.0, not > 1.2
    expect(classifyAxis(12, 10)).toBe('vertical'); // ratio 1.2, not strictly greater
    expect(classifyAxis(0, 20)).toBe('vertical');
  });
});

describe('directionForOffset', () => {
  it('maps negative dx (finger moved left) to next day (1)', () => {
    expect(directionForOffset(-5)).toBe(1);
    expect(directionForOffset(-100)).toBe(1);
  });

  it('maps positive dx to previous day (-1)', () => {
    expect(directionForOffset(5)).toBe(-1);
    expect(directionForOffset(100)).toBe(-1);
  });
});

describe('applyResistance', () => {
  it('returns dx unchanged when the direction is allowed', () => {
    expect(applyResistance(30, true)).toBe(30);
    expect(applyResistance(-45, true)).toBe(-45);
    expect(applyResistance(0, true)).toBe(0);
  });

  it('rubber-bands dx to a third when the direction is blocked', () => {
    expect(applyResistance(30, false)).toBe(10);
    expect(applyResistance(-30, false)).toBe(-10);
    expect(applyResistance(9, false)).toBeCloseTo(3);
  });
});

describe('shouldCommit', () => {
  const surfaceWidth = 300; // 35% => 105px

  it('commits at or over the 35% distance threshold regardless of velocity', () => {
    expect(shouldCommit(105, 0, surfaceWidth)).toBe(true);
    expect(shouldCommit(-105, 0, surfaceWidth)).toBe(true);
    expect(shouldCommit(200, 0, surfaceWidth)).toBe(true);
  });

  it('does not commit just under the distance threshold without a qualifying flick', () => {
    expect(shouldCommit(104, 0, surfaceWidth)).toBe(false);
    expect(shouldCommit(104, 0.1, surfaceWidth)).toBe(false);
  });

  it('commits on a decisive flick with small distance but high same-sign velocity', () => {
    expect(shouldCommit(40, 0.6, 1000)).toBe(true);
    expect(shouldCommit(-40, -0.6, 1000)).toBe(true);
    expect(shouldCommit(30, 0.5, 1000)).toBe(true); // exactly at both floors
  });

  it('does not commit when velocity opposes dx (dragged then flicked back)', () => {
    expect(shouldCommit(40, -0.6, 1000)).toBe(false);
    expect(shouldCommit(-40, 0.6, 1000)).toBe(false);
  });

  it('never commits when |dx| is under the 30px flick floor, regardless of velocity', () => {
    expect(shouldCommit(20, 5, 1000)).toBe(false);
    expect(shouldCommit(-29, 10, 1000)).toBe(false);
    expect(shouldCommit(29, 100, surfaceWidth)).toBe(false);
  });

  it('handles a drag that returns to the origin (return-to-origin cancel)', () => {
    expect(shouldCommit(2, 3, surfaceWidth)).toBe(false);
  });

  it('never commits at zero dx', () => {
    expect(shouldCommit(0, 0, surfaceWidth)).toBe(false);
    expect(shouldCommit(0, 5, surfaceWidth)).toBe(false);
  });
});
