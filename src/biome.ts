import { growRect, type Rect } from './brush';

export interface Biome { name: string; color: [number, number, number]; }

// Painted as colors (blended in the shader), so regions are smooth and mip down cleanly.
export const BIOMES: Biome[] = [
  { name: 'Forest',   color: [44, 96, 52] },
  { name: 'Jungle',   color: [28, 82, 40] },
  { name: 'Grass',    color: [110, 150, 70] },
  { name: 'Savanna',  color: [176, 160, 86] },
  { name: 'Desert',   color: [224, 200, 130] },
  { name: 'Badlands', color: [170, 110, 70] },
  { name: 'Tundra',   color: [150, 165, 150] },
  { name: 'Snow',     color: [238, 243, 246] },
  { name: 'Swamp',    color: [86, 100, 58] },
];

// Soft paint into an RGBA8 field. color=null erases (lowers coverage). Pure + testable.
export function paintBiomeDab(
  data: Uint8Array, W: number, H: number,
  color: [number, number, number] | null, cx: number, cy: number, r: number, strength: number,
): Rect | null {
  if (r <= 0) return null;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  if (x1 < x0 || y1 < y0) return null;
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy, dd = dx * dx + dy * dy;
      if (dd > r2) continue;
      const fall = 1 - Math.sqrt(dd) / r;
      const cov = strength * fall * fall * (3 - 2 * fall);
      const i = (y * W + x) * 4;
      if (color) {
        data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2];
        data[i + 3] = Math.min(255, data[i + 3] + Math.round(cov * 255));
      } else {
        data[i + 3] = Math.max(0, data[i + 3] - Math.round(cov * 255));
      }
    }
  }
  return { x0, y0, x1, y1 };
}

export { growRect };
export type { Rect };
