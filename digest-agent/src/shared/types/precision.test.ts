import { describe, it, expect } from 'vitest';
import {
  applyContradict,
  applySupport,
  clampPrecision,
  PRECISION_MAX,
  PRECISION_MIN,
} from './precision.js';

describe('precision arithmetic', () => {
  it('support raises precision by (1-p)·0.10', () => {
    expect(applySupport(0.5)).toBeCloseTo(0.55, 6);
    expect(applySupport(0.78)).toBeCloseTo(0.802, 6);
    expect(applySupport(0.1)).toBeCloseTo(0.19, 6);
  });

  it('contradict lowers precision by p·0.30 (asymmetric: hits high-precision claims harder)', () => {
    expect(applyContradict(0.9)).toBeCloseTo(0.63, 6);
    expect(applyContradict(0.5)).toBeCloseTo(0.35, 6);
    expect(applyContradict(0.3)).toBeCloseTo(0.21, 6);
  });

  it('clamps to [0.05, 0.95]', () => {
    expect(clampPrecision(0.99)).toBe(PRECISION_MAX);
    expect(clampPrecision(0.01)).toBe(PRECISION_MIN);
    expect(clampPrecision(0.5)).toBe(0.5);
  });

  it('support saturates at 0.95', () => {
    let p = 0.9;
    for (let i = 0; i < 100; i++) p = applySupport(p);
    expect(p).toBe(PRECISION_MAX);
  });

  it('contradict floors at 0.05', () => {
    let p = 0.5;
    for (let i = 0; i < 100; i++) p = applyContradict(p);
    expect(p).toBe(PRECISION_MIN);
  });

  it('the asymmetry is by design: a 0.9 claim drops further per contradiction than a 0.3 claim', () => {
    const dropHigh = 0.9 - applyContradict(0.9); // 0.27
    const dropLow = 0.3 - applyContradict(0.3); // 0.09
    expect(dropHigh).toBeGreaterThan(dropLow);
  });
});
