import { describe, it, expect } from 'vitest';
import { encodeProject, decodeProject, resampleField, type ProjectData } from './storage';

function sample(): ProjectData {
  const h = new Int16Array(4 * 3);
  for (let i = 0; i < h.length; i++) h[i] = (i * 137) % 1000 - 500;
  return {
    version: 1, world: { widthKm: 4000, heightKm: 2500 }, sea: 0.42, relief: 1.3,
    view: { x: 10, y: -5, scale: 800 },
    vectors: { lines: [{ id: 1, kind: 'river', color: '#00f', pts: [{ u: 0.1, v: 0.1 }, { u: 0.2, v: 0.3 }] }], labels: [], towns: [{ id: 2, at: { u: 0.5, v: 0.5 }, name: 'Keep', size: 14 }] },
    edit: { w: 4, h: 3, height: h },
    biome: { w: 2, h: 2, data: new Uint8Array([1,2,3,255, 4,5,6,128, 7,8,9,0, 10,11,12,64]) },
    tiles: (() => {
      const N = 256 * 256;
      const data = new Int16Array(2 * N);
      data[0] = 100; data[N] = 200; data[N + 5] = -50; // some values in each of 2 tiles
      return { coords: new Int32Array([6, 1, 2, 1, 7, 3, 4, 0]), data }; // 4/tile: level,tx,ty,direct
    })(),
  };
}

describe('storage', () => {
  it('encode -> decode preserves the project', async () => {
    const p = sample();
    const round = await decodeProject(await encodeProject(p));
    expect(round.world).toEqual(p.world);
    expect(round.sea).toBeCloseTo(p.sea);
    expect(round.relief).toBeCloseTo(p.relief);
    expect(round.vectors).toEqual(p.vectors);
    expect(round.edit.w).toBe(4); expect(round.edit.h).toBe(3);
    expect(Array.from(round.edit.height)).toEqual(Array.from(p.edit.height));
    expect(Array.from(round.biome.data)).toEqual(Array.from(p.biome.data));
    expect(round.tiles).toBeTruthy();
    expect(Array.from(round.tiles!.coords)).toEqual([6, 1, 2, 1, 7, 3, 4, 0]);
    expect(round.tiles!.data.length).toBe(2 * 256 * 256);
    expect(round.tiles!.data[0]).toBe(100);
    expect(round.tiles!.data[256 * 256]).toBe(200);
    expect(round.tiles!.data[256 * 256 + 5]).toBe(-50);
  });

  it('resampleField is identity for same dims and interpolates otherwise', () => {
    const src = new Int16Array([0, 100, 0, 100]); // 2x2
    expect(Array.from(resampleField(src, 2, 2, 2, 2))).toEqual([0, 100, 0, 100]);
    const up = resampleField(src, 2, 2, 3, 2);
    expect(up[0]).toBe(0); expect(up[2]).toBe(100); expect(up[1]).toBe(50); // midpoint interpolation
  });

  it('rejects invalid world and view values before they reach the renderer', async () => {
    const raw = JSON.parse(await encodeProject(sample()));
    raw.world.widthKm = 0;
    await expect(decodeProject(JSON.stringify(raw))).rejects.toThrow('Invalid world width');

    raw.world.widthKm = 4000;
    raw.view.scale = Number.NaN;
    await expect(decodeProject(JSON.stringify(raw))).rejects.toThrow('Invalid view scale');
  });

  it('rejects truncated field and tile payloads', async () => {
    const field = JSON.parse(await encodeProject(sample()));
    field.edit.comp = false;
    field.edit.gz = btoa(String.fromCharCode(0, 0));
    await expect(decodeProject(JSON.stringify(field))).rejects.toThrow('Invalid edit payload length');

    const tiles = JSON.parse(await encodeProject(sample()));
    tiles.tiles.n += 1;
    await expect(decodeProject(JSON.stringify(tiles))).rejects.toThrow('Invalid tile coordinates payload length');
  });

  it('rejects tile coordinates the renderer cannot address', async () => {
    const badLevel = sample(); badLevel.tiles!.coords[0] = 19;
    await expect(encodeProject(badLevel)).rejects.toThrow('Invalid tile level');

    const badX = sample(); badX.tiles!.coords[1] = 2 ** badX.tiles!.coords[0];
    await expect(encodeProject(badX)).rejects.toThrow('Invalid tile coordinates');

    const badY = sample(); badY.tiles!.coords[2] = Math.ceil((badY.world.heightKm / badY.world.widthKm) * (2 ** badY.tiles!.coords[0]));
    await expect(encodeProject(badY)).rejects.toThrow('Invalid tile coordinates');

    const badFlag = sample(); badFlag.tiles!.coords[3] = 2;
    await expect(encodeProject(badFlag)).rejects.toThrow('Invalid tile direct flag');
  });
});
