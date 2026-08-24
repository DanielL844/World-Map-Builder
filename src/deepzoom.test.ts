import { describe, expect, it } from 'vitest';
import { TileLayer, diffRect } from './tilelayer';
import { TILE, TileRegistry, MAX_TILE_LEVEL } from './tilestore';

function makeGl(): { gl: WebGL2RenderingContext; live: () => number } {
  let id = 0;
  let live = 0;
  const gl = {
    MAX_TEXTURE_SIZE: 0x0d33,
    TEXTURE_2D: 0x0de1, R16F: 0x822d, RED: 0x1903, FLOAT: 0x1406,
    CLAMP_TO_EDGE: 0x812f, LINEAR: 0x2601,
    TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4,
    createTexture: () => { live++; return { id: ++id }; },
    deleteTexture: () => { live--; },
    bindTexture: () => undefined, texImage2D: () => undefined, texParameteri: () => undefined,
    texSubImage2D: () => undefined, pixelStorei: () => undefined, generateMipmap: () => undefined,
    getParameter: () => 4096, getExtension: () => ({}),
    createShader: () => ({ id: ++id }), shaderSource: () => undefined, compileShader: () => undefined,
    getShaderParameter: () => true, getShaderInfoLog: () => '', deleteShader: () => undefined,
    createProgram: () => ({ id: ++id }), attachShader: () => undefined, linkProgram: () => undefined,
    getProgramParameter: () => true, getProgramInfoLog: () => '', deleteProgram: () => undefined,
    createVertexArray: () => ({ id: ++id }), bindVertexArray: () => undefined,
    createBuffer: () => ({ id: ++id }), bindBuffer: () => undefined, bufferData: () => undefined,
    enableVertexAttribArray: () => undefined, vertexAttribPointer: () => undefined,
    getUniformLocation: () => ({ id: ++id }),
  } as unknown as WebGL2RenderingContext;
  return { gl, live: () => live };
}

function tileFrom(layer: TileLayer, level: number, tx: number, ty: number): Int16Array | null {
  const saved = layer.serialize();
  for (let i = 0; i < saved.coords.length / 4; i++) {
    if (saved.coords[i * 4] === level && saved.coords[i * 4 + 1] === tx && saved.coords[i * 4 + 2] === ty) {
      return saved.data.slice(i * TILE * TILE, (i + 1) * TILE * TILE);
    }
  }
  return null;
}

function shrinkResidency(layer: TileLayer, cap: number): void {
  (layer as unknown as { hot: TileRegistry<{ tex: unknown }> }).hot.setCapacity(cap);
}

describe('diffRect', () => {
  it('returns null for identical tiles', () => {
    const a = new Float32Array(TILE * TILE).fill(0.25);
    expect(diffRect(a, a.slice())).toBeNull();
  });

  it('bounds exactly the changed texels', () => {
    const a = new Float32Array(TILE * TILE);
    const b = a.slice();
    b[10 * TILE + 5] = 1; b[20 * TILE + 40] = 1;
    expect(diffRect(a, b)).toEqual({ x0: 5, y0: 10, x1: 40, y1: 20 });
  });
});

describe('tile residency', () => {
  it('survives demotion: data still round-trips when only one tile can stay resident', () => {
    const { gl } = makeGl();
    const layer = new TileLayer(gl, 6);
    layer.beginStroke();
    layer.paintHeightDab('raise', 0.2, 0.2, 0.02, 0.4, 0, 3, 1);
    layer.paintHeightDab('raise', 0.8, 0.6, 0.02, 0.4, 0, 3, 1);
    expect(layer.endStroke()).toBe(true);

    const before = layer.serialize();
    shrinkResidency(layer, 1); // force nearly everything into compact form
    const after = layer.serialize();

    expect(after.coords).toEqual(before.coords);
    expect(after.data).toEqual(before.data);
  });

  it('frees GPU textures when tiles are demoted', () => {
    const f = makeGl();
    const layer = new TileLayer(f.gl, 6);
    layer.beginStroke();
    for (let i = 0; i < 8; i++) layer.paintHeightDab('raise', 0.1 + i * 0.1, 0.3, 0.01, 0.3, 0, 4, 1);
    layer.endStroke();
    const peak = f.live();
    shrinkResidency(layer, 2);
    expect(f.live()).toBeLessThan(peak);
    expect(layer.stats().hot).toBeLessThanOrEqual(2);
  });

  it('loads a saved project without allocating a texture per tile', () => {
    const f = makeGl();
    const layer = new TileLayer(f.gl, 6);
    const n = 40;
    const coords = new Int32Array(n * 4);
    const data = new Int16Array(n * TILE * TILE).fill(500);
    for (let i = 0; i < n; i++) { coords[i * 4] = 3; coords[i * 4 + 1] = i; coords[i * 4 + 2] = 0; coords[i * 4 + 3] = 1; }
    const baseline = f.live();
    layer.loadTiles(coords, data);
    expect(f.live()).toBe(baseline);          // nothing resident until something needs it
    expect(layer.serialize().coords.length / 4).toBe(n);
  });

  it('reports a resident cost far below a full-fat tile set', () => {
    const { gl } = makeGl();
    const layer = new TileLayer(gl, 6);
    const n = 60;
    const coords = new Int32Array(n * 4);
    const data = new Int16Array(n * TILE * TILE).fill(500);
    for (let i = 0; i < n; i++) { coords[i * 4] = 3; coords[i * 4 + 1] = i % 8; coords[i * 4 + 2] = (i / 8) | 0; coords[i * 4 + 3] = 1; }
    layer.loadTiles(coords, data);
    const s = layer.stats();
    // Old layout was 256 KB CPU + a texture for every tile, resident forever.
    expect(s.bytes).toBeLessThan(s.tiles * TILE * TILE * 4);
  });
});

describe('undo across residency changes', () => {
  it('undoes a stroke correctly after the tiles have been demoted', () => {
    const { gl } = makeGl();
    const layer = new TileLayer(gl, 6);
    layer.beginStroke();
    layer.paintHeightDab('raise', 0.3, 0.3, 0.02, 0.5, 0, 3, 1);
    expect(layer.endStroke()).toBe(true);
    const painted = tileFrom(layer, 3, 2, 2);

    layer.beginStroke();
    layer.paintHeightDab('raise', 0.3, 0.3, 0.02, 0.5, 0, 3, 1);
    expect(layer.endStroke()).toBe(true);
    expect(tileFrom(layer, 3, 2, 2)).not.toEqual(painted);

    shrinkResidency(layer, 1);  // everything the undo touches is now compact
    expect(layer.undo()).toBe(true);
    expect(tileFrom(layer, 3, 2, 2)).toEqual(painted);
  });

  it('redoes back to the later state', () => {
    const { gl } = makeGl();
    const layer = new TileLayer(gl, 6);
    layer.beginStroke();
    layer.paintHeightDab('raise', 0.3, 0.3, 0.02, 0.5, 0, 3, 1);
    layer.endStroke();
    layer.beginStroke();
    layer.paintHeightDab('raise', 0.3, 0.3, 0.02, 0.5, 0, 3, 1);
    layer.endStroke();
    const twice = tileFrom(layer, 3, 2, 2);

    expect(layer.undo()).toBe(true);
    expect(layer.redo()).toBe(true);
    expect(tileFrom(layer, 3, 2, 2)).toEqual(twice);
  });

  it('keeps deep-zoom history bounded instead of one stroke costing megabytes', () => {
    const { gl } = makeGl();
    const layer = new TileLayer(gl, MAX_TILE_LEVEL);
    // A stroke at level 14 also rewrites an ancestor at every level down to 0.
    layer.beginStroke();
    layer.paintHeightDab('raise', 0.5, 0.25, 0.00002, 0.5, 0, 14, 1);
    expect(layer.endStroke()).toBe(true);
    // Full-tile Float32 before+after for every tile a level-14 stroke touches was megabytes of
    // history for one dab; storing only the changed rect, quantised, keeps it in the KBs.
    expect(layer.stats().historyBytes).toBeLessThan(1024 * 1024);
  });

  it('drops the oldest history rather than growing without bound', () => {
    const { gl } = makeGl();
    const layer = new TileLayer(gl, 6);
    for (let i = 0; i < 120; i++) {
      layer.beginStroke();
      layer.paintHeightDab('raise', 0.3, 0.3, 0.02, 0.2, 0, 3, 1);
      layer.endStroke();
    }
    expect(layer.canUndo()).toBe(true);
    // 120 strokes retained in full would be enormous; the budget caps the entry count too.
    expect(layer.stats().historyBytes).toBeLessThan(48 * 1024 * 1024);
  });
});
