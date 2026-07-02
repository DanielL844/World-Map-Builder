// Whole-planet generator: continents, mountain ranges, fractal coastlines and climate biomes,
// projected Web Mercator into the (square) edit + biome fields. Baked once on the CPU — no
// per-frame cost. Terrain is sampled on the SPHERE (seamless: no east-west seam, no pole pinch),
// then placed into the Mercator grid by latitude.
import { BIOMES } from './biome';

// ---- seamless 3D value noise ----
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (y | 0), 0x85ebca6b);
  h = Math.imul(h ^ (z | 0), 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
function smooth(t: number): number { return t * t * (3 - 2 * t); }

export function vnoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * xf;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * xf;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * xf;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * xf;
  const y0 = x00 + (x10 - x00) * yf, y1 = x01 + (x11 - x01) * yf;
  return y0 + (y1 - y0) * zf; // [0,1]
}

export function fbm3(x: number, y: number, z: number, seed: number, oct: number): number {
  let s = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise3(x * f, y * f, z * f, seed + i * 1013);
    norm += amp; f *= 2.0; amp *= 0.5;
  }
  return norm > 0 ? s / norm : 0.5; // [0,1]
}

// Ridged multifractal -> long linear ridges (mountain ranges) rather than round blobs.
export function ridged3(x: number, y: number, z: number, seed: number, oct: number): number {
  let s = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    let n = vnoise3(x * f, y * f, z * f, seed + i * 2017);
    n = 1 - Math.abs(2 * n - 1); n *= n; // sharp ridge
    s += amp * n; norm += amp; f *= 2.0; amp *= 0.5;
  }
  return norm > 0 ? s / norm : 0; // [0,1]
}

// Web-Mercator latitude (radians) for a normalized vertical coord v in [0,1] (0 = north).
export function latOf(v: number): number { return Math.atan(Math.sinh(Math.PI * (1 - 2 * v))); }
// Equirectangular ("scaled to a sphere", 2:1) latitude: linear, reaching the true poles at the
// top/bottom edge so the cold/ice bands stay proportional instead of being stretched huge.
export function latEquirect(v: number, vMax: number): number { return (Math.PI / 2) * (1 - 2 * (v / vMax)); }
const HALF_PI = Math.PI / 2;

// Biome palette indices (order matches BIOMES in biome.ts).
const FOREST = 0, JUNGLE = 1, GRASS = 2, SAVANNA = 3, DESERT = 4, BADLANDS = 5, TUNDRA = 6, SNOW = 7, SWAMP = 8;

// Whittaker-style climate classification. t,m,landElev in [0,1]. Returns a BIOMES index, or
// -1 for "no biome" (ocean, or high peaks where the terrain's own rock/snow should show).
export function classifyBiome(t: number, m: number, landElev: number): number {
  if (landElev > 0.88) return -1;                       // bare peaks -> rock/snow from terrain
  if (landElev < 0.10 && m > 0.72 && t > 0.42) return SWAMP;
  if (t < 0.12) return SNOW;
  if (t < 0.28) return m > 0.4 ? TUNDRA : TUNDRA;       // cold belt
  if (t > 0.70) {                                       // hot
    if (m > 0.60) return JUNGLE;
    if (m > 0.33) return SAVANNA;
    return landElev > 0.45 ? BADLANDS : DESERT;
  }
  if (t > 0.45) {                                       // warm / temperate
    if (m > 0.58) return FOREST;
    if (m > 0.30) return GRASS;
    return SAVANNA;
  }
  if (m > 0.50) return FOREST;                          // cool
  if (m > 0.28) return GRASS;
  return TUNDRA;
}

export interface PlanetResult { height: Float32Array; biome: Uint8Array; }

interface PlanetOpts { seaLevel: number; landFrac: number; mountains: number; warp: number; }

// Generate height deltas (W x H, value = renderHeight - baseLand) and a biome RGBA field
// (biomeW x biomeH). vMax should be 1 (a square Mercator world) for a full planet.
export function generatePlanet(
  W: number, H: number, biomeW: number, biomeH: number, vMax: number,
  seed: number, baseLand: number, opts: Partial<PlanetOpts> = {},
): PlanetResult {
  const seaLevel = opts.seaLevel ?? 0.42;
  const landFrac = opts.landFrac ?? 0.35;        // fraction of the planet above sea
  const mtnAmt = opts.mountains ?? 1.0;
  const warp = opts.warp ?? 0.18;

  // Coarse grid (continents are large-scale); upsampled to the output fields for speed.
  const CW = 768, CH = Math.max(2, Math.round(768 * vMax));
  const N = CW * CH;
  const cont = new Float32Array(N);                // continent value per coarse cell
  const PX = new Float32Array(N), PY = new Float32Array(N), PZ = new Float32Array(N); // warped sphere pos

  // Pass 1: warped sphere position + continent value.
  for (let y = 0; y < CH; y++) {
    const v = ((y + 0.5) / CH) * vMax;
    const lat = latEquirect(v, vMax), cosLat = Math.cos(lat), sinLat = Math.sin(lat);
    for (let x = 0; x < CW; x++) {
      const lon = ((x + 0.5) / CW) * 2 * Math.PI;
      let px = cosLat * Math.cos(lon), py = cosLat * Math.sin(lon), pz = sinLat;
      const wx = fbm3(px * 2.1 + 11.3, py * 2.1 + 4.7, pz * 2.1 + 19.1, seed, 4) - 0.5;
      const wy = fbm3(px * 2.1 + 5.2, py * 2.1 + 23.9, pz * 2.1 + 8.4, seed, 4) - 0.5;
      const wz = fbm3(px * 2.1 + 31.7, py * 2.1 + 2.8, pz * 2.1 + 14.6, seed, 4) - 0.5;
      px += warp * wx; py += warp * wy; pz += warp * wz;
      let c = fbm3(px * 1.6, py * 1.6, pz * 1.6, seed + 77, 6);
      c += (fbm3(px * 4.0, py * 4.0, pz * 4.0, seed + 91, 5) - 0.5) * 0.18; // coastal detail
      const idx = y * CW + x;
      cont[idx] = c; PX[idx] = px; PY[idx] = py; PZ[idx] = pz;
    }
  }

  // Pick the coastline (cT) and high-ground (cHi) thresholds from the actual value distribution,
  // so the land fraction and the elevation range are stable whatever the noise's spread is.
  const sorted = cont.slice().sort();              // TypedArray.sort is numeric, ascending
  const cT = sorted[Math.min(N - 1, Math.floor((1 - landFrac) * N))];
  const cHi = sorted[Math.min(N - 1, Math.floor(0.997 * N))];
  const cLo = sorted[Math.floor(0.02 * N)];
  const span = Math.max(1e-4, cHi - cT);

  // Pass 2: ocean depth / land + mountain ranges, then climate biome.
  const cHr = new Float32Array(N);
  const cBio = new Int8Array(N);
  for (let y = 0; y < CH; y++) {
    const v = ((y + 0.5) / CH) * vMax;
    const lat = latEquirect(v, vMax), absLatN = Math.min(1, Math.abs(lat) / HALF_PI);
    for (let x = 0; x < CW; x++) {
      const idx = y * CW + x;
      const c = cont[idx], px = PX[idx], py = PY[idx], pz = PZ[idx];
      let hr: number, landElev = 0;
      if (c < cT) {
        const t = Math.max(0, Math.min(1, (c - cLo) / Math.max(1e-4, cT - cLo))); // 0 deep .. 1 coast
        hr = 0.06 + (seaLevel - 0.06) * smooth(t);
      } else {
        landElev = smooth(Math.min(1, (c - cT) / span));         // [0,1] across the land range
        let hr0 = seaLevel + landElev * (0.74 - seaLevel);
        // mountain ranges: ridged noise, concentrated inland and where the crust is "active"
        const ridge = ridged3(px * 3.6, py * 3.6, pz * 3.6, seed + 41, 5);
        const belt = smooth(Math.min(1, Math.max(0, (fbm3(px * 0.9, py * 0.9, pz * 0.9, seed + 5, 3) - 0.45) / 0.4)));
        const mtn = ridge * belt * smooth(Math.min(1, landElev * 1.2)) * mtnAmt;
        hr0 += mtn * (0.99 - hr0);
        hr = Math.min(0.999, hr0);
      }
      cHr[idx] = hr;
      if (hr >= seaLevel) {
        const temp = Math.max(0, Math.min(1, 1.10 - absLatN * 1.0 - landElev * 0.5));
        const mNoise = fbm3(px * 2.4 + 50, py * 2.4 + 50, pz * 2.4 + 50, seed + 123, 4);
        const moist = Math.max(0, Math.min(1, 0.55 * mNoise + 0.30 * (1 - absLatN) + 0.25 * (1 - landElev) - 0.10));
        cBio[idx] = classifyBiome(temp, moist, landElev);
      } else if (absLatN > 0.86) {
        cBio[idx] = SNOW;   // frozen polar ocean (sea ice) -> rendered white
      } else {
        cBio[idx] = -1;
      }
    }
  }

  // Upsample render height -> delta field (bilinear).
  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = H > 1 ? (y / (H - 1)) * (CH - 1) : 0;
    const y0 = Math.floor(fy), y1 = Math.min(CH - 1, y0 + 1), ay = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = W > 1 ? (x / (W - 1)) * (CW - 1) : 0;
      const x0 = Math.floor(fx), x1 = Math.min(CW - 1, x0 + 1), ax = fx - x0;
      const a = cHr[y0 * CW + x0], b = cHr[y0 * CW + x1], c = cHr[y1 * CW + x0], d = cHr[y1 * CW + x1];
      height[y * W + x] = (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay - baseLand;
    }
  }

  // Upsample biome -> RGBA (nearest, so colors stay crisp; alpha 255 on land-with-biome).
  const biome = new Uint8Array(biomeW * biomeH * 4);
  for (let y = 0; y < biomeH; y++) {
    const sy = Math.min(CH - 1, Math.floor(((y + 0.5) / biomeH) * CH));
    for (let x = 0; x < biomeW; x++) {
      const sx = Math.min(CW - 1, Math.floor(((x + 0.5) / biomeW) * CW));
      const bi = cBio[sy * CW + sx];
      const o = (y * biomeW + x) * 4;
      if (bi >= 0) {
        const col = BIOMES[bi].color;
        biome[o] = col[0]; biome[o + 1] = col[1]; biome[o + 2] = col[2]; biome[o + 3] = 255;
      }
    }
  }

  return { height, biome };
}
