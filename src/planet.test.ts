import { describe, it, expect } from 'vitest';
import { vnoise3, fbm3, ridged3, latOf, latEquirect, classifyBiome } from './planet';

describe('planet noise', () => {
  it('vnoise3 is deterministic and in [0,1]', () => {
    expect(vnoise3(1.5, 2.5, 3.5, 42)).toBe(vnoise3(1.5, 2.5, 3.5, 42));
    for (let i = 0; i < 60; i++) {
      const n = vnoise3(i * 0.3, i * 0.7, i * 1.1, 7);
      expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1);
    }
  });
  it('ridged3 stays in [0,1]', () => {
    for (let i = 0; i < 60; i++) {
      const r = ridged3(i * 0.4, i * 0.2, i * 0.9, 3, 5);
      expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(1);
    }
  });
  it('different seeds give different fields', () => {
    expect(fbm3(2, 2, 2, 1, 4)).not.toBe(fbm3(2, 2, 2, 999, 4));
  });
});

describe('latOf (web mercator)', () => {
  it('maps v=0.5 to the equator, is symmetric, and reaches the poles', () => {
    expect(latOf(0.5)).toBeCloseTo(0);
    expect(latOf(0.25)).toBeCloseTo(-latOf(0.75));
    expect(latOf(0)).toBeGreaterThan(1.4);   // ~85 deg N
    expect(latOf(1)).toBeLessThan(-1.4);      // ~85 deg S
  });
});

describe('latEquirect (sphere 2:1)', () => {
  it('is linear: poles at the edges, equator at the middle', () => {
    expect(latEquirect(0, 0.5)).toBeCloseTo(Math.PI / 2);     // north pole at top
    expect(latEquirect(0.25, 0.5)).toBeCloseTo(0);            // equator at mid
    expect(latEquirect(0.5, 0.5)).toBeCloseTo(-Math.PI / 2);  // south pole at bottom
  });
});

describe('classifyBiome', () => {
  it('high peaks return no biome', () => {
    expect(classifyBiome(0.5, 0.5, 0.95)).toBe(-1);
  });
  it('classifies by temperature and moisture', () => {
    expect(classifyBiome(0.05, 0.5, 0.3)).toBe(7);  // very cold -> Snow
    expect(classifyBiome(0.85, 0.8, 0.3)).toBe(1);  // hot + wet -> Jungle
    expect(classifyBiome(0.85, 0.1, 0.2)).toBe(4);  // hot + dry -> Desert
    expect(classifyBiome(0.50, 0.7, 0.3)).toBe(0);  // temperate + wet -> Forest
    expect(classifyBiome(0.05, 0.9, 0.05)).toBe(7); // cold wins over wet lowland -> Snow (not Swamp)
  });
  it('warm wet lowland is swamp', () => {
    expect(classifyBiome(0.6, 0.8, 0.05)).toBe(8);  // SWAMP
  });
});
