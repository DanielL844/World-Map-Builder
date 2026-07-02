import { describe, it, expect } from 'vitest';
import { generatePreset } from './presets';

describe('presets', () => {
  it('flat is all zeros (a flat plain at base land)', () => {
    const f = generatePreset(32, 20, 0.625, 'flat', 1, 0.5);
    expect(f.every((x) => x === 0)).toBe(true);
  });
  it('continents produces both land (>0) and sea (<0) relative to base land, and varies', () => {
    const f = generatePreset(64, 40, 0.625, 'continents', 42, 0.5);
    let min = Infinity, max = -Infinity;
    for (const x of f) { if (x < min) min = x; if (x > max) max = x; }
    expect(max).toBeGreaterThan(0);   // some land above base
    expect(min).toBeLessThan(0);      // some sea below base
    expect(max - min).toBeGreaterThan(0.1);
  });
});
