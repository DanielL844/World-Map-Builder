import type { ToolId } from './tools';

export interface Rect { x0: number; y0: number; x1: number; y1: number; }

export function growRect(r: Rect | null, x0: number, y0: number, x1: number, y1: number): Rect {
  if (!r) return { x0, y0, x1, y1 };
  return { x0: Math.min(r.x0, x0), y0: Math.min(r.y0, y0), x1: Math.max(r.x1, x1), y1: Math.max(r.y1, y1) };
}

// Apply one brush dab to a height-delta field (row-major, W x H). Pure + unit-testable.
// cx, cy, r are in texel units. Returns the dirty texel rect (or null if nothing touched).
// flatTargetArg: optional explicit flatten target. When painting one dab across several
// tiles, pass the same value to every tile so 'flatten' has no seam; omit for single-field use.
export function paintDab(
  data: Float32Array, W: number, H: number,
  tool: ToolId, cx: number, cy: number, r: number, amount: number, rate: number,
  flatTargetArg?: number,
): Rect | null {
  if (r <= 0) return null;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  if (x1 < x0 || y1 < y0) return null;
  const r2 = r * r;
  let flatTarget = 0;
  if (tool === 'flatten') {
    if (flatTargetArg !== undefined) {
      flatTarget = flatTargetArg;
    } else {
      const cxi = Math.min(W - 1, Math.max(0, Math.round(cx)));
      const cyi = Math.min(H - 1, Math.max(0, Math.round(cy)));
      flatTarget = data[cyi * W + cxi];
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy, dd = dx * dx + dy * dy;
      if (dd > r2) continue;
      const fall = 1 - Math.sqrt(dd) / r;
      const w = fall * fall * (3 - 2 * fall); // smoothstep falloff
      const i = y * W + x;
      if (tool === 'raise') {
        data[i] += amount * w;
      } else if (tool === 'lower') {
        data[i] -= amount * w;
      } else if (tool === 'flatten') {
        data[i] += (flatTarget - data[i]) * Math.min(1, rate * w);
      } else { // smooth toward 4-neighbor average
        const xl = x > 0 ? x - 1 : x, xr = x < W - 1 ? x + 1 : x;
        const yu = y > 0 ? y - 1 : y, yd = y < H - 1 ? y + 1 : y;
        const avg = (data[y * W + xl] + data[y * W + xr] + data[yu * W + x] + data[yd * W + x]) * 0.25;
        data[i] += (avg - data[i]) * Math.min(1, rate * w);
      }
    }
  }
  return { x0, y0, x1, y1 };
}
