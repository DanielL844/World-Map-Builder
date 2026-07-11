import { describe, it, expect } from 'vitest';
import { paintDab, growRect } from './brush';

describe('paintDab', () => {
  it('raises the center most, edges least, outside not at all', () => {
    const W = 16, H = 16;
    const d = new Float32Array(W * H);
    const r = paintDab(d, W, H, 'raise', 8, 8, 4, 1, 0);
    expect(r).not.toBeNull();
    const at = (x: number, y: number) => d[y * W + x];
    expect(at(8, 8)).toBeGreaterThan(0.9);          // center ~ full amount
    expect(at(8, 8)).toBeGreaterThan(at(10, 8));     // falloff outward
    expect(at(10, 8)).toBeGreaterThan(0);
    expect(at(0, 0)).toBe(0);                        // outside radius untouched
  });

  it('lower is the negative of raise', () => {
    const W = 8, H = 8;
    const up = new Float32Array(W * H); paintDab(up, W, H, 'raise', 4, 4, 3, 0.5, 0);
    const dn = new Float32Array(W * H); paintDab(dn, W, H, 'lower', 4, 4, 3, 0.5, 0);
    for (let i = 0; i < up.length; i++) expect(dn[i]).toBeCloseTo(-up[i]);
  });

  it('smooth uses a stable source and stays symmetric around a spike', () => {
    const W = 8, H = 8;
    const d = new Float32Array(W * H);
    d[4 * W + 4] = 1.0; // lone spike
    paintDab(d, W, H, 'smooth', 4, 4, 2, 0, 1);
    expect(d[4 * W + 4]).toBe(0);
    const neighbors = [d[4 * W + 3], d[4 * W + 5], d[3 * W + 4], d[5 * W + 4]];
    expect(neighbors[0]).toBeGreaterThan(0);
    for (const n of neighbors.slice(1)) expect(n).toBeCloseTo(neighbors[0]);
  });

  it('returns null when a dab does not change the field', () => {
    const d = new Float32Array(8 * 8);
    expect(paintDab(d, 8, 8, 'raise', 4, 4, 2, 0, 0)).toBeNull();
    expect(paintDab(d, 8, 8, 'smooth', 4, 4, 2, 0, 1)).toBeNull();
  });

  it('growRect unions rectangles', () => {
    const a = growRect(null, 2, 3, 5, 6);
    const b = growRect(a, 1, 4, 7, 5);
    expect(b).toEqual({ x0: 1, y0: 3, x1: 7, y1: 6 });
  });
});
