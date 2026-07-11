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
  if (W <= 0 || H <= 0 || data.length < W * H * 4 || r <= 0 ||
      !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) ||
      !Number.isFinite(strength)) return null;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  if (x1 < x0 || y1 < y0) return null;
  const r2 = r * r;
  const opacity = Math.max(0, Math.min(1, strength));
  let dx0 = W, dy0 = H, dx1 = -1, dy1 = -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy, dd = dx * dx + dy * dy;
      if (dd > r2) continue;
      const fall = 1 - Math.sqrt(dd) / r;
      const cov = opacity * fall * fall * (3 - 2 * fall);
      if (cov <= 0) continue;
      const i = (y * W + x) * 4;
      const oldR = data[i], oldG = data[i + 1], oldB = data[i + 2], oldA8 = data[i + 3];
      const oldA = oldA8 / 255;
      if (color) {
        // Straight-alpha source-over. This lets a low-strength pass gently blend a new biome
        // over an already opaque one instead of replacing its RGB on the first faint dab.
        const outA = cov + oldA * (1 - cov);
        data[i] = Math.round((color[0] * cov + oldR * oldA * (1 - cov)) / outA);
        data[i + 1] = Math.round((color[1] * cov + oldG * oldA * (1 - cov)) / outA);
        data[i + 2] = Math.round((color[2] * cov + oldB * oldA * (1 - cov)) / outA);
        data[i + 3] = Math.round(outA * 255);
      } else {
        data[i + 3] = Math.round(oldA * (1 - cov) * 255);
      }
      if (data[i] !== oldR || data[i + 1] !== oldG || data[i + 2] !== oldB || data[i + 3] !== oldA8) {
        if (x < dx0) dx0 = x; if (x > dx1) dx1 = x;
        if (y < dy0) dy0 = y; if (y > dy1) dy1 = y;
      }
    }
  }
  return dx1 < 0 ? null : { x0: dx0, y0: dy0, x1: dx1, y1: dy1 };
}

export { growRect };
export type { Rect };
