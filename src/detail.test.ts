import { describe, expect, it } from 'vitest';
import { paintBiomeDab, BIOMES, type LandMask } from './biome';
import { sliderToSize, sizeToSlider } from './toolbar';

const W = 64, H = 64;
const BASE_LAND = 0.5;

function field(): Uint8Array { return new Uint8Array(W * H * 4); }
const alphaAt = (d: Uint8Array, x: number, y: number) => d[(y * W + x) * 4 + 3];

// Height mask matching the biome field's aspect: left half ocean, right half land.
function halfLandMask(sea = 0.42): LandMask {
  const w = 32, h = 32;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[y * w + x] = x < w / 2 ? -0.2 : 0.2; // 0.3 vs 0.7 after BASE_LAND
  }
  return { data, w, h, base: BASE_LAND, sea };
}

describe('biome paint respects the waterline', () => {
  it('paints on land and leaves the ocean side untouched', () => {
    const d = field();
    // Brush straddles the coast at x = 32.
    paintBiomeDab(d, W, H, BIOMES[0].color, 32, 32, 14, 1, halfLandMask());
    expect(alphaAt(d, 40, 32), 'land side').toBeGreaterThan(0);
    expect(alphaAt(d, 24, 32), 'ocean side').toBe(0);
  });

  it('paints everywhere when no mask is supplied', () => {
    const d = field();
    paintBiomeDab(d, W, H, BIOMES[0].color, 32, 32, 14, 1);
    expect(alphaAt(d, 24, 32)).toBeGreaterThan(0);
  });

  it('still erases over water, so generated ice stays removable', () => {
    const d = field();
    for (let i = 0; i < W * H; i++) d[i * 4 + 3] = 255;
    for (let pass = 0; pass < 40; pass++) paintBiomeDab(d, W, H, null, 32, 32, 14, 0.4, halfLandMask());
    expect(alphaAt(d, 24, 32), 'ocean side erased').toBe(0);
    expect(alphaAt(d, 40, 32), 'land side erased').toBe(0);
  });

  it('follows sea level: raising it puts more of the map off limits', () => {
    const d = field();
    // Sea above every height in the mask -> nothing is land.
    paintBiomeDab(d, W, H, BIOMES[0].color, 32, 32, 14, 1, halfLandMask(0.9));
    expect(alphaAt(d, 40, 32)).toBe(0);
    expect(alphaAt(d, 24, 32)).toBe(0);
  });

  it('ignores a malformed mask rather than refusing to paint', () => {
    const d = field();
    paintBiomeDab(d, W, H, BIOMES[0].color, 32, 32, 14, 1, { data: new Float32Array(0), w: 0, h: 0, base: 0.5, sea: 0.42 });
    expect(alphaAt(d, 32, 32)).toBeGreaterThan(0);
  });
});

describe('brush size slider', () => {
  it('spans 2..400 px across its travel', () => {
    expect(sliderToSize(0)).toBe(2);
    expect(sliderToSize(1000)).toBe(400);
  });

  it('gives fine resolution at the small end', () => {
    // The old linear 6..160 slider could not express anything under 6 px.
    expect(sliderToSize(50)).toBeLessThan(3);
    expect(sliderToSize(0)).toBeLessThan(sliderToSize(10));
  });

  it('round-trips a size back to its slider position', () => {
    for (const px of [2, 5, 12, 40, 120, 400]) {
      expect(sliderToSize(sizeToSlider(px))).toBeCloseTo(px, 0);
    }
  });

  it('clamps out-of-range sizes instead of producing junk positions', () => {
    expect(sizeToSlider(0.1)).toBe(0);
    expect(sizeToSlider(99999)).toBe(1000);
  });
});
