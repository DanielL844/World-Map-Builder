import { MAX_TILE_LEVEL, TILE } from './tilestore';
import type { VectorData } from './vectors';

export interface ProjectData {
  version: number;
  world: { widthKm: number; heightKm: number };
  sea: number;
  relief: number;
  view?: { x: number; y: number; scale: number };
  vectors: VectorData;
  edit: { w: number; h: number; height: Int16Array }; // quantized height deltas
  biome: { w: number; h: number; data: Uint8Array };  // RGBA biome paint
  tiles?: { coords: Int32Array; data: Int16Array };   // deep-zoom edits: 4 coord ints + TILE^2 Int16 per tile
}

const CAN_COMPRESS = typeof CompressionStream !== 'undefined';
const CAN_DECOMPRESS = typeof DecompressionStream !== 'undefined';
const TILE_SAMPLES = TILE * TILE;

function bytesToB64(b: Uint8Array): string {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode(...b.subarray(i, i + CH));
  return btoa(s);
}
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s); const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
async function gzip(b: Uint8Array): Promise<Uint8Array> {
  if (!CAN_COMPRESS) return b;
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter(); void w.write(b as unknown as BufferSource); void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function gunzip(b: Uint8Array): Promise<Uint8Array> {
  if (!CAN_DECOMPRESS) throw new Error('This browser cannot decompress this project');
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter(); void w.write(b as unknown as BufferSource); void w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

function positiveInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function nonnegativeInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function finiteNumber(value: unknown, label: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function exactLength(label: string, actual: number, factors: number[]): void {
  let expected = 1;
  for (const factor of factors) {
    expected *= factor;
    if (!Number.isSafeInteger(expected)) throw new Error(`Invalid ${label} dimensions`);
  }
  if (actual !== expected) throw new Error(`Invalid ${label} payload length`);
}

function validateTileCoordinates(coords: Int32Array, worldVMax: number): void {
  for (let i = 0; i < coords.length; i += 4) {
    const level = coords[i], tx = coords[i + 1], ty = coords[i + 2], direct = coords[i + 3];
    if (level < 0 || level > MAX_TILE_LEVEL) throw new Error('Invalid tile level');
    const columns = 2 ** level;
    const rows = Math.ceil(worldVMax * columns);
    if (!Number.isSafeInteger(rows) || rows < 1) throw new Error('Invalid world aspect');
    if (tx < 0 || tx >= columns || ty < 0 || ty >= rows) throw new Error('Invalid tile coordinates');
    if (direct !== 0 && direct !== 1) throw new Error('Invalid tile direct flag');
  }
}

export async function encodeProject(p: ProjectData): Promise<string> {
  if (p.version !== 1) throw new Error('Unsupported project version');
  const worldWidth = finiteNumber(p.world.widthKm, 'world width', true);
  const worldHeight = finiteNumber(p.world.heightKm, 'world height', true);
  const worldVMax = worldHeight / worldWidth;
  if (!Number.isFinite(worldVMax) || worldVMax <= 0) throw new Error('Invalid world aspect');
  const editW = positiveInt(p.edit.w, 'edit width'), editH = positiveInt(p.edit.h, 'edit height');
  const biomeW = positiveInt(p.biome.w, 'biome width'), biomeH = positiveInt(p.biome.h, 'biome height');
  exactLength('edit', p.edit.height.byteLength, [editW, editH, Int16Array.BYTES_PER_ELEMENT]);
  exactLength('biome', p.biome.data.byteLength, [biomeW, biomeH, 4]);
  const hb = new Uint8Array(p.edit.height.buffer, p.edit.height.byteOffset, p.edit.height.byteLength);
  const gz = await gzip(hb);
  const gzB = await gzip(p.biome.data);
  let tiles: unknown = undefined;
  if (p.tiles) {
    if (p.tiles.coords.length % 4 !== 0) throw new Error('Invalid tile coordinate count');
    const n = p.tiles.coords.length / 4;
    exactLength('tile data', p.tiles.data.byteLength, [n, TILE_SAMPLES, Int16Array.BYTES_PER_ELEMENT]);
    validateTileCoordinates(p.tiles.coords, worldVMax);
    if (n > 0) {
      const cb = new Uint8Array(p.tiles.coords.buffer, p.tiles.coords.byteOffset, p.tiles.coords.byteLength);
      const db = new Uint8Array(p.tiles.data.buffer, p.tiles.data.byteOffset, p.tiles.data.byteLength);
      tiles = { n, comp: CAN_COMPRESS, coords: bytesToB64(await gzip(cb)), data: bytesToB64(await gzip(db)) };
    }
  }
  return JSON.stringify({
    version: p.version, world: p.world, sea: p.sea, relief: p.relief, view: p.view, vectors: p.vectors,
    edit: { w: p.edit.w, h: p.edit.h, comp: CAN_COMPRESS, gz: bytesToB64(gz) },
    biome: { w: p.biome.w, h: p.biome.h, comp: CAN_COMPRESS, gz: bytesToB64(gzB) },
    tiles,
  });
}
export async function decodeProject(str: string): Promise<ProjectData> {
  const o = JSON.parse(str);
  if (o.version !== 1) throw new Error('Unsupported project version');
  const world = {
    widthKm: finiteNumber(o.world?.widthKm, 'world width', true),
    heightKm: finiteNumber(o.world?.heightKm, 'world height', true),
  };
  const worldVMax = world.heightKm / world.widthKm;
  if (!Number.isFinite(worldVMax) || worldVMax <= 0) throw new Error('Invalid world aspect');
  const sea = finiteNumber(o.sea, 'sea level');
  const relief = finiteNumber(o.relief, 'relief');
  const view = o.view === undefined ? undefined : {
    x: finiteNumber(o.view?.x, 'view x'),
    y: finiteNumber(o.view?.y, 'view y'),
    scale: finiteNumber(o.view?.scale, 'view scale', true),
  };
  const editW = positiveInt(o.edit?.w, 'edit width');
  const editH = positiveInt(o.edit?.h, 'edit height');
  let bytes = b64ToBytes(o.edit.gz);
  if (o.edit.comp) bytes = await gunzip(bytes);
  exactLength('edit', bytes.byteLength, [editW, editH, Int16Array.BYTES_PER_ELEMENT]);
  const copy = bytes.slice(); // tightly packed, offset 0
  const height = new Int16Array(copy.buffer, 0, Math.floor(copy.byteLength / 2));
  let bdata = new Uint8Array(0);
  let biomeW = 0, biomeH = 0;
  if (o.biome !== undefined && o.biome !== null) {
    biomeW = positiveInt(o.biome.w, 'biome width');
    biomeH = positiveInt(o.biome.h, 'biome height');
    let bb = b64ToBytes(o.biome.gz); if (o.biome.comp) bb = await gunzip(bb);
    exactLength('biome', bb.byteLength, [biomeW, biomeH, 4]);
    bdata = new Uint8Array(bb);
  }
  let tiles: ProjectData['tiles'] = undefined;
  if (o.tiles !== undefined && o.tiles !== null) {
    const n = nonnegativeInt(o.tiles.n, 'tile count');
    if (n > 0) {
      let cb = b64ToBytes(o.tiles.coords); if (o.tiles.comp) cb = await gunzip(cb);
      let db = b64ToBytes(o.tiles.data); if (o.tiles.comp) db = await gunzip(db);
      exactLength('tile coordinates', cb.byteLength, [n, 4, Int32Array.BYTES_PER_ELEMENT]);
      exactLength('tile data', db.byteLength, [n, TILE_SAMPLES, Int16Array.BYTES_PER_ELEMENT]);
      const cc = cb.slice(), dd = db.slice(); // tightly packed at offset 0
      const coords = new Int32Array(cc.buffer, 0, n * 4);
      validateTileCoordinates(coords, worldVMax);
      tiles = {
        coords,
        data: new Int16Array(dd.buffer, 0, Math.floor(dd.byteLength / 2)),
      };
    }
  }
  return {
    version: o.version, world, sea, relief, view,
    vectors: o.vectors ?? { lines: [], labels: [], towns: [] },
    edit: { w: editW, h: editH, height: new Int16Array(height) },
    biome: { w: biomeW, h: biomeH, data: bdata },
    tiles,
  };
}

// Bilinear resample of a quantized field (used when world aspect / resolution changes).
export function resampleField(src: Int16Array, w: number, h: number, nw: number, nh: number): Int16Array {
  if (w === nw && h === nh) return src.slice();
  const out = new Int16Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const sy = nh > 1 ? (y / (nh - 1)) * (h - 1) : 0;
    const y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < nw; x++) {
      const sx = nw > 1 ? (x / (nw - 1)) * (w - 1) : 0;
      const x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      const a = src[y0 * w + x0], b = src[y0 * w + x1], c = src[y1 * w + x0], d = src[y1 * w + x1];
      out[y * nw + x] = Math.round((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy);
    }
  }
  return out;
}

// Bilinear resample of an RGBA8 field.
export function resampleRGBA(src: Uint8Array, w: number, h: number, nw: number, nh: number): Uint8Array {
  if (w === nw && h === nh) return src.slice();
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const sy = nh > 1 ? (y / (nh - 1)) * (h - 1) : 0;
    const y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < nw; x++) {
      const sx = nw > 1 ? (x / (nw - 1)) * (w - 1) : 0;
      const x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      const o = (y * nw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = src[(y0 * w + x0) * 4 + c], b = src[(y0 * w + x1) * 4 + c], cc = src[(y1 * w + x0) * 4 + c], d = src[(y1 * w + x1) * 4 + c];
        out[o + c] = Math.round((a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy);
      }
    }
  }
  return out;
}

// Minimal IndexedDB key/value (strings). Degrades to no-op if unavailable.
export const idb = {
  db: null as IDBDatabase | null,
  open(): Promise<IDBDatabase | null> {
    return new Promise((res) => {
      if (typeof indexedDB === 'undefined') { res(null); return; }
      let r: IDBOpenDBRequest;
      try { r = indexedDB.open('worldforge', 1); } catch { res(null); return; }
      r.onupgradeneeded = () => { try { r.result.createObjectStore('kv'); } catch { /* exists */ } };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => res(null);
    });
  },
  async set(k: string, v: string): Promise<void> {
    const db = this.db ?? (await this.open()); if (!db) return;
    await new Promise<void>((res) => {
      const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k);
      t.oncomplete = () => res(); t.onerror = () => res();
    });
  },
  async get(k: string): Promise<string | null> {
    const db = this.db ?? (await this.open()); if (!db) return null;
    return new Promise((res) => {
      const t = db.transaction('kv', 'readonly'); const rq = t.objectStore('kv').get(k);
      rq.onsuccess = () => res((rq.result as string) ?? null); rq.onerror = () => res(null);
    });
  },
};
