// Sparse tile addressing for the "infinite" edit layer (M7).
// World is normalized: u in [0,1] across the width, v in [0, vMax]. Tiles are square in u-units;
// a tile at `level` spans 1/2^level in both u and v. This module is pure geometry/bookkeeping
// (no GPU) so it can be unit-tested; the GPU layer (textures, compositing) builds on top.

export const TILE = 256; // texels per tile side

export interface TileCoord { level: number; tx: number; ty: number; }

// Choose the tile level whose tiles render at ~TILE screen px, given px-per-u-unit (= camera scale).
export function levelForScale(pxPerU: number, maxLevel: number): number {
  const l = Math.round(Math.log2(Math.max(1e-6, pxPerU) / TILE));
  return l < 0 ? 0 : l > maxLevel ? maxLevel : l;
}

export function tileKey(c: TileCoord): string { return c.level + '/' + c.tx + '/' + c.ty; }
export function parseKey(k: string): TileCoord {
  const p = k.split('/'); return { level: +p[0], tx: +p[1], ty: +p[2] };
}

// World rectangle (normalized u,v) covered by a tile.
export function tileRect(c: TileCoord): { u0: number; v0: number; u1: number; v1: number } {
  const n = 1 << c.level;
  return { u0: c.tx / n, v0: c.ty / n, u1: (c.tx + 1) / n, v1: (c.ty + 1) / n };
}

// The ancestor tile at a coarser level that contains `c`.
export function ancestorAt(c: TileCoord, level: number): TileCoord {
  if (level >= c.level) return { ...c };
  const d = c.level - level;
  return { level, tx: c.tx >> d, ty: c.ty >> d };
}

// Chain of ancestors from level-1 down to 0 (coarsest last).
export function ancestorChain(c: TileCoord): TileCoord[] {
  const out: TileCoord[] = [];
  for (let l = c.level - 1; l >= 0; l--) out.push(ancestorAt(c, l));
  return out;
}

// Tiles at `level` intersecting the normalized rect [uMin,uMax] x [vMin,vMax], clamped to the world.
export function visibleTiles(
  level: number, uMin: number, vMin: number, uMax: number, vMax: number, worldVMax: number,
): TileCoord[] {
  const n = 1 << level;
  const txa = Math.max(0, Math.floor(uMin * n));
  const txb = Math.min(n - 1, Math.floor(uMax * n - 1e-9));
  const tyMax = Math.max(0, Math.ceil(worldVMax * n) - 1);
  const tya = Math.max(0, Math.floor(vMin * n));
  const tyb = Math.min(tyMax, Math.floor(vMax * n - 1e-9));
  const out: TileCoord[] = [];
  for (let ty = tya; ty <= tyb; ty++) for (let tx = txa; tx <= txb; tx++) out.push({ level, tx, ty });
  return out;
}

// Tiles at `level` touched by a brush dab centered at (u,v) with radius rU (u-units).
export function tilesForDab(level: number, u: number, v: number, rU: number, worldVMax: number): TileCoord[] {
  return visibleTiles(level, u - rU, v - rU, u + rU, v + rU, worldVMax);
}

// Texel coordinate of world point (u,v) inside tile `c`'s TILE x TILE grid.
// May fall outside [0,TILE] when the point is outside the tile (paintDab clamps to the tile).
export function tileLocalXY(c: TileCoord, u: number, v: number): { x: number; y: number } {
  const n = 1 << c.level;
  return { x: (u * n - c.tx) * TILE, y: (v * n - c.ty) * TILE };
}

// Brush radius rU (world u-units) expressed in tile texels at `level`.
export function tileLocalRadius(level: number, rU: number): number {
  return rU * TILE * (1 << level);
}

// Box-average a full TILE x TILE child tile into one (TILE/2)^2 quadrant of its parent tile,
// overwriting that quadrant. (qx,qy) in {0,1} select the quadrant = the child's (tx&1, ty&1)
// position within the parent. Pure data op (used to build coarse zoom-out footprints).
export function downsampleIntoQuadrant(parent: Float32Array, child: Float32Array, qx: number, qy: number): void {
  const half = TILE >> 1;
  const ox = qx * half, oy = qy * half;
  for (let y = 0; y < half; y++) {
    const sy = y << 1;
    for (let x = 0; x < half; x++) {
      const sx = x << 1;
      const a = child[sy * TILE + sx] + child[sy * TILE + sx + 1]
              + child[(sy + 1) * TILE + sx] + child[(sy + 1) * TILE + sx + 1];
      parent[(oy + y) * TILE + (ox + x)] = a * 0.25;
    }
  }
}

// Bilinear-upsample the region of a coarser ancestor (at `aLevel`) that covers child tile `c`
// into `out` (TILE x TILE). Used to seed a freshly-created finer tile with the coarse height
// beneath it, so detail painted into it builds ON the coarse edit instead of resetting to base.
// Samples at texel centers with clamp-to-edge, matching the GPU's LINEAR magnification of the
// ancestor tile — so a seeded child is indistinguishable from the coarse tile it covers.
// (Nearest replication here rendered as blocky 2^d-texel squares with hard seams at tile edges.)
export function upsampleFromAncestor(c: TileCoord, aLevel: number, aData: Float32Array, out: Float32Array): void {
  const d = c.level - aLevel;
  if (d <= 0) { out.set(aData); return; }
  // Map child texel centers onto the ancestor's texel grid via the global texel grids of the two
  // levels, so it works for any depth gap (including d > 8, where the whole child is sub-texel
  // in the ancestor and bilinear degenerates to interpolating one texel neighborhood).
  const inv = 1 / (1 << d);
  const gx0 = c.tx * TILE, gy0 = c.ty * TILE;           // child's global texel origin (child level)
  const baseX = (c.tx >> d) * TILE, baseY = (c.ty >> d) * TILE; // ancestor tile's global origin
  // Precompute per-column sample indices and weights (shared by every row).
  const cx0 = new Int32Array(TILE), cx1 = new Int32Array(TILE), cfx = new Float32Array(TILE);
  for (let x = 0; x < TILE; x++) {
    const ax = (gx0 + x + 0.5) * inv - baseX - 0.5;     // ancestor-local texel-center coordinate
    const i0 = Math.floor(ax);
    cfx[x] = ax - i0;
    cx0[x] = i0 < 0 ? 0 : i0;                            // clamp-to-edge (matches CLAMP_TO_EDGE)
    cx1[x] = i0 + 1 > TILE - 1 ? TILE - 1 : i0 + 1;
  }
  for (let y = 0; y < TILE; y++) {
    const ay = (gy0 + y + 0.5) * inv - baseY - 0.5;
    const j0 = Math.floor(ay);
    const fy = ay - j0;
    const r0 = (j0 < 0 ? 0 : j0) * TILE;
    const r1 = (j0 + 1 > TILE - 1 ? TILE - 1 : j0 + 1) * TILE;
    const row = y * TILE;
    for (let x = 0; x < TILE; x++) {
      const fx = cfx[x], x0 = cx0[x], x1 = cx1[x];
      const top = aData[r0 + x0] + (aData[r0 + x1] - aData[r0 + x0]) * fx;
      const bot = aData[r1 + x0] + (aData[r1 + x1] - aData[r1 + x0]) * fx;
      out[row + x] = top + (bot - top) * fy;
    }
  }
}

// A least-recently-used registry of tiles. Edited tiles can be pinned so they're never evicted.
export class TileRegistry<T> {
  private map = new Map<string, T>();
  private order: string[] = []; // most-recent at the end
  private pinned = new Set<string>();
  constructor(private cap: number, private onEvict?: (key: string, val: T) => void) {}

  has(key: string): boolean { return this.map.has(key); }
  get(key: string): T | undefined { const v = this.map.get(key); if (v !== undefined) this.touch(key); return v; }
  get size(): number { return this.map.size; }
  keys(): string[] { return [...this.map.keys()]; }

  set(key: string, val: T): void { this.map.set(key, val); this.touch(key); this.evictExcess(); }
  clear(): void {
    if (this.onEvict) for (const [k, v] of this.map) this.onEvict(k, v);
    this.map.clear(); this.order.length = 0; this.pinned.clear();
  }
  pin(key: string): void { this.pinned.add(key); }
  unpin(key: string): void { this.pinned.delete(key); }
  isPinned(key: string): boolean { return this.pinned.has(key); }

  private touch(key: string): void {
    const i = this.order.indexOf(key);
    if (i >= 0) this.order.splice(i, 1);
    this.order.push(key);
  }
  private evictExcess(): void {
    let i = 0;
    while (this.map.size > this.cap && i < this.order.length) {
      const key = this.order[i];
      if (this.pinned.has(key)) { i++; continue; }
      const val = this.map.get(key);
      this.map.delete(key); this.order.splice(i, 1);
      if (val !== undefined && this.onEvict) this.onEvict(key, val);
    }
  }
}
