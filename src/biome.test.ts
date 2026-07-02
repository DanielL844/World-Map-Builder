import { describe, it, expect } from 'vitest';
import { paintBiomeDab, BIOMES } from './biome';

describe('paintBiomeDab', () => {
  it('paints color and builds coverage at the center', () => {
    const W = 16, H = 16, d = new Uint8Array(W * H * 4);
    paintBiomeDab(d, W, H, BIOMES[4].color, 8, 8, 4, 1); // Desert
    const i = (8 * W + 8) * 4;
    expect([d[i], d[i + 1], d[i + 2]]).toEqual(BIOMES[4].color);
    expect(d[i + 3]).toBeGreaterThan(200);
    expect(d[(0 * W + 0) * 4 + 3]).toBe(0);
  });
  it('erase lowers coverage', () => {
    const W = 8, H = 8, d = new Uint8Array(W * H * 4);
    paintBiomeDab(d, W, H, BIOMES[0].color, 4, 4, 3, 1);
    const before = d[(4 * 8 + 4) * 4 + 3];
    paintBiomeDab(d, W, H, null, 4, 4, 3, 1);
    expect(d[(4 * 8 + 4) * 4 + 3]).toBeLessThan(before);
  });
});
