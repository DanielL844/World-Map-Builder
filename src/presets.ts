// CPU terrain presets, baked once into the editable height field (no live per-frame cost).
function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(seed: number): (x: number, y: number, oct: number) => number {
  const G = 256;
  const rnd = mulberry32(seed);
  const grid = new Float32Array((G + 1) * (G + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const val = (x: number, y: number): number => {
    const xf = Math.floor(x), yf = Math.floor(y);
    const xi = xf & (G - 1), yi = yf & (G - 1);
    const fx = x - xf, fy = y - yf;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = grid[yi * (G + 1) + xi], b = grid[yi * (G + 1) + xi + 1];
    const c = grid[(yi + 1) * (G + 1) + xi], d = grid[(yi + 1) * (G + 1) + xi + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  return (x, y, oct) => {
    let s = 0, amp = 0.5, n = 0, f = 1;
    for (let i = 0; i < oct; i++) { s += amp * val(x * f, y * f); n += amp; f *= 2; amp *= 0.5; }
    return n > 0 ? s / n : 0.5;
  };
}
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

export type PresetKind = 'flat' | 'continents' | 'islands';

function field(noise: (x: number, y: number, o: number) => number, u: number, v: number, kind: PresetKind): number {
  const warp = 0.35;
  const wu = u + warp * (noise(u * 2 + 1.3, v * 2 + 4.2, 4) - 0.5);
  const wv = v + warp * (noise(u * 2 + 6.7, v * 2 + 2.1, 4) - 0.5);
  let h = noise(wu * 3.0, wv * 3.0, 6);
  if (kind === 'islands') h = h * 1.35 - 0.32; // higher relative sea -> scattered islands
  return clamp01(h);
}
function bilinear(a: Float32Array, W: number, H: number, fx: number, fy: number): number {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const ax = fx - x0, ay = fy - y0;
  const a00 = a[y0 * W + x0], a10 = a[y0 * W + x1], a01 = a[y1 * W + x0], a11 = a[y1 * W + x1];
  return (a00 * (1 - ax) + a10 * ax) * (1 - ay) + (a01 * (1 - ax) + a11 * ax) * ay;
}

// Returns the edit-field deltas (height - baseLand) for the whole edit texture (W x H).
export function generatePreset(W: number, H: number, vMax: number, kind: PresetKind, seed: number, baseLand: number): Float32Array {
  const out = new Float32Array(W * H);
  if (kind === 'flat') return out; // ed=0 everywhere -> flat plain at baseLand
  // generate coarse (continents are large-scale), then upsample for speed
  const CW = 1024, CH = Math.max(2, Math.round(1024 * vMax));
  const coarse = new Float32Array(CW * CH);
  const noise = makeNoise(seed);
  for (let y = 0; y < CH; y++) {
    const v = ((y + 0.5) / CH) * vMax;
    for (let x = 0; x < CW; x++) {
      const u = (x + 0.5) / CW;
      coarse[y * CW + x] = field(noise, u, v, kind);
    }
  }
  for (let y = 0; y < H; y++) {
    const fy = H > 1 ? (y / (H - 1)) * (CH - 1) : 0;
    for (let x = 0; x < W; x++) {
      const fx = W > 1 ? (x / (W - 1)) * (CW - 1) : 0;
      out[y * W + x] = bilinear(coarse, CW, CH, fx, fy) - baseLand;
    }
  }
  return out;
}
