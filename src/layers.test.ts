import { describe, expect, it } from 'vitest';
import { EditLayer } from './editlayer';
import { BiomeLayer } from './biomelayer';
import { TileLayer } from './tilelayer';
import { TILE, TileRegistry } from './tilestore';

function makeGl(maxTextureSize = 4096): {
  gl: WebGL2RenderingContext;
  mipCount: () => number;
} {
  let mips = 0;
  let id = 0;
  const gl = {
    MAX_TEXTURE_SIZE: 0x0d33,
    TEXTURE_2D: 0x0de1, R16F: 0x822d, RGBA8: 0x8058, RED: 0x1903, RGBA: 0x1908,
    FLOAT: 0x1406, UNSIGNED_BYTE: 0x1401, CLAMP_TO_EDGE: 0x812f, LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4,
    createTexture: () => ({ id: ++id }), deleteTexture: () => undefined,
    bindTexture: () => undefined, texImage2D: () => undefined, texParameteri: () => undefined,
    texSubImage2D: () => undefined, pixelStorei: () => undefined,
    generateMipmap: () => { mips++; },
    getParameter: () => maxTextureSize,
    getExtension: () => ({}),
    createShader: () => ({ id: ++id }), shaderSource: () => undefined, compileShader: () => undefined,
    getShaderParameter: () => true, getShaderInfoLog: () => '', deleteShader: () => undefined,
    createProgram: () => ({ id: ++id }), attachShader: () => undefined, linkProgram: () => undefined,
    getProgramParameter: () => true, getProgramInfoLog: () => '', deleteProgram: () => undefined,
    createVertexArray: () => ({ id: ++id }), bindVertexArray: () => undefined,
    createBuffer: () => ({ id: ++id }), bindBuffer: () => undefined, bufferData: () => undefined,
    enableVertexAttribArray: () => undefined, vertexAttribPointer: () => undefined,
    getUniformLocation: () => ({ id: ++id }),
  } as unknown as WebGL2RenderingContext;
  return { gl, mipCount: () => mips };
}

describe('region layers', () => {
  it('caps the longest side and preserves square texel density on tall worlds', () => {
    const { gl } = makeGl(64);
    const edit = new EditLayer(gl, 128, 2);
    const biome = new BiomeLayer(gl, 128, 2);
    expect([edit.W, edit.H]).toEqual([32, 64]);
    expect([biome.W, biome.H]).toEqual([32, 64]);

    const wide = new EditLayer(gl, 128, 0.5);
    expect([wide.W, wide.H]).toEqual([64, 32]);

    const extreme = new EditLayer(gl, 128, 1e9);
    expect([extreme.W, extreme.H]).toEqual([1, 64]);
  });

  it('updates edit mipmaps during a stroke and rejects a no-op stroke', () => {
    const f = makeGl();
    const edit = new EditLayer(f.gl, 16, 1);
    const initialMips = f.mipCount();
    edit.beginStroke();
    edit.dab('raise', 0.5, 0.5, 0.15, 0.2, 1);
    edit.flush();
    expect(f.mipCount()).toBe(initialMips + 1);
    expect(edit.endStroke()).toBe(true);

    const flat = new EditLayer(f.gl, 16, 1);
    flat.beginStroke();
    flat.dab('smooth', 0.5, 0.5, 0.15, 0, 1);
    expect(flat.endStroke()).toBe(false);
    expect(flat.canUndo()).toBe(false);
  });

  it('updates biome mipmaps during a stroke and reports whether it changed', () => {
    const f = makeGl();
    const biome = new BiomeLayer(f.gl, 16, 1);
    const initialMips = f.mipCount();
    biome.beginStroke();
    biome.dab([10, 20, 30], 0.5, 0.5, 0.15, 0.5);
    biome.flush();
    expect(f.mipCount()).toBe(initialMips + 1);
    expect(biome.endStroke()).toBe(true);

    biome.beginStroke();
    biome.dab([30, 20, 10], 0.5, 0.5, 0.15, 0);
    expect(biome.endStroke()).toBe(false);
  });
});

function serializedTile(layer: TileLayer, level: number, tx: number, ty: number) {
  const saved = layer.serialize();
  for (let i = 0; i < saved.coords.length / 4; i++) {
    if (saved.coords[i * 4] === level && saved.coords[i * 4 + 1] === tx && saved.coords[i * 4 + 2] === ty) {
      return { direct: saved.coords[i * 4 + 3], data: saved.data.subarray(i * TILE * TILE, (i + 1) * TILE * TILE) };
    }
  }
  return null;
}

describe('TileLayer editing', () => {
  it('keeps a flatten target on the seeded ancestor height', () => {
    const { gl } = makeGl();
    const layer = new TileLayer(gl, 4);
    layer.loadTiles(new Int32Array([0, 0, 0, 1]), new Int16Array(TILE * TILE).fill(8000));
    layer.beginStroke();
    layer.paintHeightDab('flatten', 0.25, 0.25, 0.03, 0, 1, 1, 1);
    expect(layer.endStroke()).toBe(false);
  });

  it('restores propagated/direct status exactly on undo', () => {
    const { gl } = makeGl();
    const layer = new TileLayer(gl, 4);
    layer.beginStroke();
    layer.paintHeightDab('raise', 0.25, 0.25, 0.02, 0.3, 0, 1, 1);
    expect(layer.endStroke()).toBe(true);
    expect(serializedTile(layer, 0, 0, 0)?.direct).toBe(0);

    layer.beginStroke();
    layer.paintHeightDab('raise', 0.25, 0.25, 0.02, 0.1, 0, 0, 1);
    expect(layer.endStroke()).toBe(true);
    expect(serializedTile(layer, 0, 0, 0)?.direct).toBe(1);
    expect(layer.undo()).toBe(true);
    expect(serializedTile(layer, 0, 0, 0)?.direct).toBe(0);
  });

  it('paints equal strength on both sides of a tile seam', () => {
    const { gl } = makeGl();
    const layer = new TileLayer(gl, 4);
    layer.beginStroke();
    layer.paintHeightDab('raise', 0.5, 0.25, 0.02, 0.3, 0, 1, 1);
    expect(layer.endStroke()).toBe(true);
    const left = serializedTile(layer, 1, 0, 0);
    const right = serializedTile(layer, 1, 1, 0);
    expect(left).not.toBeNull(); expect(right).not.toBeNull();
    expect(left!.data[127 * TILE + TILE - 1]).toBe(right!.data[127 * TILE]);
  });

  it('pins a tile before a capacity-constrained registry can evict it', () => {
    const { gl } = makeGl();
    const layer = new TileLayer(gl, 4);
    (layer as unknown as { tiles: TileRegistry<unknown> }).tiles = new TileRegistry<unknown>(1);
    const coords = new Int32Array([1, 0, 0, 1, 1, 1, 0, 1]);
    const data = new Int16Array(2 * TILE * TILE).fill(100);
    layer.loadTiles(coords, data);
    expect(layer.serialize().coords.length / 4).toBe(2);
  });
});
