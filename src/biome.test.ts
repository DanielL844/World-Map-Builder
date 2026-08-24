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

  it('softly blends a new color over an existing opaque biome', () => {
    const W = 8, H = 8, d = new Uint8Array(W * H * 4);
    paintBiomeDab(d, W, H, [100, 0, 0], 4, 4, 3, 1);
    paintBiomeDab(d, W, H, [0, 100, 0], 4, 4, 3, 0.25);
    const i = (4 * W + 4) * 4;
    expect(Array.from(d.slice(i, i + 4))).toEqual([75, 25, 0, 255]);
  });

  it('does not dirty or alter the field at zero strength', () => {
    const d = new Uint8Array(8 * 8 * 4);
    expect(paintBiomeDab(d, 8, 8, BIOMES[0].color, 4, 4, 3, 0)).toBeNull();
    expect(d.every((x) => x === 0)).toBe(true);
  });
});

describe('biome eraser', () => {
  const W = 64, H = 64;
  function opaqueField(): Uint8Array {
    const d = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) { d[i * 4] = 44; d[i * 4 + 1] = 96; d[i * 4 + 2] = 52; d[i * 4 + 3] = 255; }
    return d;
  }
  const alphaAt = (d: Uint8Array, x: number, y: number) => d[(y * W + x) * 4 + 3];

  it('clears coverage completely across the whole brush, not just the centre', () => {
    const d = opaqueField();
    const r = 10;
    // strength as main.ts passes it at the default 0.5 slider
    for (let pass = 0; pass < 40; pass++) paintBiomeDab(d, W, H, null, 32, 32, r, 0.15 + 0.5 * 0.5);
    for (let dx = 0; dx <= 8; dx++) {
      expect(alphaAt(d, 32 + dx, 32), `alpha ${dx} texels from centre`).toBe(0);
    }
  });

  it('leaves texels outside the brush untouched', () => {
    const d = opaqueField();
    for (let pass = 0; pass < 40; pass++) paintBiomeDab(d, W, H, null, 32, 32, 10, 0.4);
    expect(alphaAt(d, 32 + 12, 32)).toBe(255);
  });

  it('reports no dirty rect once there is nothing left to erase', () => {
    const d = new Uint8Array(W * H * 4); // fully transparent
    expect(paintBiomeDab(d, W, H, null, 32, 32, 10, 0.5)).toBeNull();
  });
});
