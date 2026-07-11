import { describe, it, expect } from 'vitest';
import {
  levelForScale, tileKey, parseKey, tileRect, ancestorAt, ancestorChain,
  visibleTiles, tilesForDab, tileLocalXY, tileLocalRadius, downsampleIntoQuadrant, upsampleFromAncestor,
  TileRegistry, TILE,
} from './tilestore';
import { paintDab } from './brush';

describe('tile addressing', () => {
  it('levelForScale grows with zoom and clamps', () => {
    expect(levelForScale(TILE, 12)).toBe(0);          // one tile == screen tile
    expect(levelForScale(TILE * 4, 12)).toBe(2);      // 4x => 2 levels deeper
    expect(levelForScale(TILE * 1e9, 12)).toBe(12);   // clamp to max
    expect(levelForScale(1, 12)).toBe(0);             // clamp to 0
  });
  it('key round-trips and rect halves per level', () => {
    const c = { level: 3, tx: 5, ty: 2 };
    expect(parseKey(tileKey(c))).toEqual(c);
    const r = tileRect(c);
    expect(r.u1 - r.u0).toBeCloseTo(1 / 8);
    expect(r.u0).toBeCloseTo(5 / 8);
  });
  it('ancestorAt and ancestorChain walk up correctly', () => {
    const c = { level: 4, tx: 9, ty: 6 };
    expect(ancestorAt(c, 2)).toEqual({ level: 2, tx: 2, ty: 1 });
    const chain = ancestorChain(c);
    expect(chain.map((t) => t.level)).toEqual([3, 2, 1, 0]);
    expect(chain[chain.length - 1]).toEqual({ level: 0, tx: 0, ty: 0 });
  });
  it('visibleTiles covers the rect and clamps to the world', () => {
    const v = visibleTiles(2, 0.1, 0.1, 0.6, 0.6, 1); // level 2 => 4x4 grid
    expect(v.length).toBe(9); // tx 0..2, ty 0..2
    const edge = visibleTiles(2, -1, -1, 2, 2, 0.5); // clamp: tx 0..3, ty 0..(ceil(2)-1=1)
    expect(Math.max(...edge.map((t) => t.tx))).toBe(3);
    expect(Math.max(...edge.map((t) => t.ty))).toBe(1);
  });
  it('tilesForDab returns the touched tiles', () => {
    expect(tilesForDab(3, 0.5625, 0.5625, 0.0001, 1).length).toBe(1); // interior of one tile
    expect(tilesForDab(3, 0.5625, 0.5625, 0.3, 1).length).toBeGreaterThan(1);
  });
});

describe('tile-local dab mapping', () => {
  it('maps tile origin to (0,0) and tile center to the texel middle', () => {
    const c = { level: 3, tx: 5, ty: 2 };
    const n = 1 << c.level;
    const o = tileLocalXY(c, c.tx / n, c.ty / n);
    expect(o.x).toBeCloseTo(0); expect(o.y).toBeCloseTo(0);
    const m = tileLocalXY(c, (c.tx + 0.5) / n, (c.ty + 0.5) / n);
    expect(m.x).toBeCloseTo(TILE / 2); expect(m.y).toBeCloseTo(TILE / 2);
  });

  it('is continuous across a shared tile border (left x == right x + TILE)', () => {
    const L = 4, ty = 3, n = 1 << L;
    const left = { level: L, tx: 6, ty }, right = { level: L, tx: 7, ty };
    const u = 7 / n, v = (ty + 0.5) / n;          // exactly on the left|right border
    const xl = tileLocalXY(left, u, v).x, xr = tileLocalXY(right, u, v).x;
    expect(xl).toBeCloseTo(TILE);                 // one past the left tile's last column
    expect(xr).toBeCloseTo(0);                    // at the right tile's first column
    expect(tileLocalXY(left, u, v).y).toBeCloseTo(tileLocalXY(right, u, v).y);
  });

  it('radius scales a u-unit span into texels at the level', () => {
    expect(tileLocalRadius(0, 1 / 1)).toBeCloseTo(TILE);      // one whole tile wide at L0
    expect(tileLocalRadius(2, 1 / 4)).toBeCloseTo(TILE);      // one tile (1/4 of width) at L2
    expect(tileLocalRadius(5, 0.001)).toBeCloseTo(0.001 * TILE * 32);
  });

  it('a raise dab across two tiles leaves no seam (mirrored texels match)', () => {
    const L = 1;                                   // 2x2 grid -> tx 0 and 1 share the u=0.5 border
    const left = new Float32Array(TILE * TILE), right = new Float32Array(TILE * TILE);
    const u = 0.5, v = 0.25;                        // on the border, mid-height of the top row
    const rU = 0.1, rLocal = tileLocalRadius(L, rU);
    const cl = tileLocalXY({ level: L, tx: 0, ty: 0 }, u, v);
    const cr = tileLocalXY({ level: L, tx: 1, ty: 0 }, u, v);
    expect(cl.x - TILE).toBeCloseTo(cr.x);         // same physical center in both frames
    paintDab(left, TILE, TILE, 'raise', cl.x, cl.y, rLocal, 1, 0);
    paintDab(right, TILE, TILE, 'raise', cr.x, cr.y, rLocal, 1, 0);
    const yrow = Math.round(cl.y);
    // texels equidistant from the centered dab (left col 255 and right col 1) must match.
    expect(left[yrow * TILE + 255]).toBeGreaterThan(0);
    expect(right[yrow * TILE + 1]).toBeGreaterThan(0);
    expect(left[yrow * TILE + 255]).toBeCloseTo(right[yrow * TILE + 1]);
  });
});

describe('downsampleIntoQuadrant', () => {
  it('box-averages a constant child into the chosen quadrant only', () => {
    const child = new Float32Array(TILE * TILE).fill(2);
    const parent = new Float32Array(TILE * TILE);
    downsampleIntoQuadrant(parent, child, 1, 0);   // top-right quadrant (qx=1, qy=0)
    const half = TILE >> 1;
    const at = (x: number, y: number) => parent[y * TILE + x];
    expect(at(half, 0)).toBeCloseTo(2);            // inside the quadrant
    expect(at(TILE - 1, half - 1)).toBeCloseTo(2); // its far corner
    expect(at(0, 0)).toBe(0);                       // a different quadrant: untouched
    expect(at(0, half)).toBe(0);                    // bottom-left: untouched
    let nz = 0; for (let i = 0; i < parent.length; i++) if (parent[i] !== 0) nz++;
    expect(nz).toBe(half * half);                   // exactly one quadrant written
  });

  it('averages each 2x2 source block', () => {
    const child = new Float32Array(TILE * TILE);
    child[0] = 0; child[1] = 4; child[TILE] = 8; child[TILE + 1] = 12; // top-left block -> avg 6
    const parent = new Float32Array(TILE * TILE);
    downsampleIntoQuadrant(parent, child, 0, 0);
    expect(parent[0]).toBeCloseTo(6);
  });

  it('places the quadrant per (qx,qy)', () => {
    const child = new Float32Array(TILE * TILE).fill(1);
    const half = TILE >> 1;
    for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const p = new Float32Array(TILE * TILE);
      downsampleIntoQuadrant(p, child, qx, qy);
      expect(p[(qy * half) * TILE + (qx * half)]).toBeCloseTo(1); // first texel of that quadrant
    }
  });
});

describe('upsampleFromAncestor', () => {
  it('interpolates bilinearly between ancestor texels (2x, texel-center aligned)', () => {
    const a = new Float32Array(TILE * TILE);
    a[0] = 5; a[1] = 9;                                  // ancestor texels (0,0)=5, (1,0)=9
    const child = new Float32Array(TILE * TILE);
    upsampleFromAncestor({ level: 1, tx: 0, ty: 0 }, 0, a, child);
    // child texel x maps to ancestor coordinate (x+0.5)/2-0.5: -0.25, 0.25, 0.75, 1.25...
    expect(child[0]).toBeCloseTo(5);                     // clamped at the tile edge
    expect(child[1]).toBeCloseTo(6);                     // 5 + 0.25*(9-5)
    expect(child[2]).toBeCloseTo(8);                     // 5 + 0.75*(9-5)
    // no nearest-style block replication: values step smoothly, not in 2x2 constant blocks
    expect(child[1]).not.toBeCloseTo(child[2]);
  });

  it('is smooth across the seeded gradient (no repeated blocks)', () => {
    const a = new Float32Array(TILE * TILE);
    for (let x = 0; x < TILE; x++) a[x] = x;             // linear ramp along row 0
    const child = new Float32Array(TILE * TILE);
    upsampleFromAncestor({ level: 2, tx: 1, ty: 0 }, 0, a, child); // 4x upsample, interior region
    // a linear ramp must upsample to a linear ramp: constant per-texel step of 1/4
    for (let x = 1; x < TILE - 1; x++) {
      expect(child[x + 1] - child[x]).toBeCloseTo(0.25, 3);
    }
  });

  it('picks the ancestor sub-region for the child position', () => {
    const a = new Float32Array(TILE * TILE);
    a[TILE >> 1] = 7;                                    // ancestor texel (128,0), in the right half
    const child = new Float32Array(TILE * TILE);
    upsampleFromAncestor({ level: 1, tx: 1, ty: 0 }, 0, a, child);  // child tx=1 covers ancestor x 128..255
    // child texel 0 samples ancestor x=127.75 -> weight 0.75 on texel 128 (=7), 0.25 on 127 (=0)
    expect(child[0]).toBeCloseTo(0.75 * 7);
    // child texel 1 samples ancestor x=128.25 -> weight 0.75 on texel 128, 0.25 on 129 (=0)
    expect(child[1]).toBeCloseTo(0.75 * 7);
  });

  it('fills a constant ancestor across 4x upsample', () => {
    const a = new Float32Array(TILE * TILE).fill(3);
    const child = new Float32Array(TILE * TILE);
    upsampleFromAncestor({ level: 2, tx: 3, ty: 1 }, 0, a, child);
    expect(child[0]).toBeCloseTo(3);
    expect(child[TILE * TILE - 1]).toBeCloseTo(3);
  });

  it('handles a large depth gap (child smaller than one ancestor texel)', () => {
    const a = new Float32Array(TILE * TILE);
    a[0] = 42; a[1] = 42; a[2] = 42;                    // constant neighborhood around texel (1,0)
    const child = new Float32Array(TILE * TILE);
    upsampleFromAncestor({ level: 10, tx: 4, ty: 0 }, 0, a, child); // child maps inside texel (1,0)
    expect(child[0]).toBeCloseTo(42);
    expect(child[TILE * TILE - 1]).toBeCloseTo(42);
  });
});

describe('TileRegistry LRU', () => {
  it('evicts least-recently-used but keeps pinned', () => {
    const evicted: string[] = [];
    const r = new TileRegistry<number>(2, (k) => evicted.push(k));
    r.set('a', 1); r.pin('a');
    r.set('b', 2);
    r.get('a');           // touch a
    r.set('c', 3);        // over cap -> evict LRU non-pinned (b)
    expect(r.has('a')).toBe(true);  // pinned
    expect(r.has('b')).toBe(false); // evicted
    expect(r.has('c')).toBe(true);
    expect(evicted).toEqual(['b']);
  });

  it('returns to its capacity as soon as an over-capacity entry is unpinned', () => {
    const evicted: string[] = [];
    const r = new TileRegistry<number>(1, (k) => evicted.push(k));
    r.pin('a'); r.pin('b');
    r.set('a', 1); r.set('b', 2); // both are protected, so the registry is temporarily over cap
    expect(r.size).toBe(2);

    r.unpin('a');
    expect(r.size).toBe(1);
    expect(r.has('a')).toBe(false);
    expect(r.has('b')).toBe(true);
    expect(evicted).toEqual(['a']);
  });
});
