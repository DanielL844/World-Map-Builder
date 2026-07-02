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
  tiles?: { coords: Int32Array; data: Int16Array };   // deep-zoom tile edits (M7): 3 ints + TILE^2 Int16 per tile
}

const HAS_CS = typeof CompressionStream !== 'undefined';

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
  if (!HAS_CS) return b;
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter(); void w.write(b as unknown as BufferSource); void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function gunzip(b: Uint8Array): Promise<Uint8Array> {
  if (!HAS_CS) return b;
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter(); void w.write(b as unknown as BufferSource); void w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

export async function encodeProject(p: ProjectData): Promise<string> {
  const hb = new Uint8Array(p.edit.height.buffer, p.edit.height.byteOffset, p.edit.height.byteLength);
  const gz = await gzip(hb);
  const gzB = await gzip(p.biome.data);
  let tiles: unknown = undefined;
  if (p.tiles && p.tiles.coords.length > 0) {
    const cb = new Uint8Array(p.tiles.coords.buffer, p.tiles.coords.byteOffset, p.tiles.coords.byteLength);
    const db = new Uint8Array(p.tiles.data.buffer, p.tiles.data.byteOffset, p.tiles.data.byteLength);
    tiles = { n: p.tiles.coords.length / 4, comp: HAS_CS, coords: bytesToB64(await gzip(cb)), data: bytesToB64(await gzip(db)) };
  }
  return JSON.stringify({
    version: p.version, world: p.world, sea: p.sea, relief: p.relief, view: p.view, vectors: p.vectors,
    edit: { w: p.edit.w, h: p.edit.h, comp: HAS_CS, gz: bytesToB64(gz) },
    biome: { w: p.biome.w, h: p.biome.h, comp: HAS_CS, gz: bytesToB64(gzB) },
    tiles,
  });
}
export async function decodeProject(str: string): Promise<ProjectData> {
  const o = JSON.parse(str);
  let bytes = b64ToBytes(o.edit.gz);
  if (o.edit.comp) bytes = await gunzip(bytes);
  const copy = bytes.slice(); // tightly packed, offset 0
  const height = new Int16Array(copy.buffer, 0, Math.floor(copy.byteLength / 2));
  let bdata = new Uint8Array(0);
  if (o.biome && o.biome.gz) { let bb = b64ToBytes(o.biome.gz); if (o.biome.comp) bb = await gunzip(bb); bdata = new Uint8Array(bb); }
  let tiles: ProjectData['tiles'] = undefined;
  if (o.tiles && o.tiles.n > 0) {
    let cb = b64ToBytes(o.tiles.coords); if (o.tiles.comp) cb = await gunzip(cb);
    let db = b64ToBytes(o.tiles.data); if (o.tiles.comp) db = await gunzip(db);
    const cc = cb.slice(), dd = db.slice(); // tightly packed at offset 0
    tiles = {
      coords: new Int32Array(cc.buffer, 0, o.tiles.n * 4),
      data: new Int16Array(dd.buffer, 0, Math.floor(dd.byteLength / 2)),
    };
  }
  return {
    version: o.version, world: o.world, sea: o.sea, relief: o.relief, view: o.view,
    vectors: o.vectors ?? { lines: [], labels: [], towns: [] },
    edit: { w: o.edit.w, h: o.edit.h, height: new Int16Array(height) },
    biome: { w: o.biome?.w ?? 0, h: o.biome?.h ?? 0, data: bdata },
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
