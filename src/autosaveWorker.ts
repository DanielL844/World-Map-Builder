// Runs project serialization (quantize + gzip + base64) and the IndexedDB write off the
// main thread, so auto-save never causes a frame hitch. Buffers are transferred in.
import { encodeProject, idb, type ProjectData } from './storage';
import type { VectorData } from './vectors';

interface SaveMsg {
  world: { widthKm: number; heightKm: number };
  sea: number;
  relief: number;
  view: { x: number; y: number; scale: number };
  vectors: VectorData;
  edit: { w: number; h: number; data: Float32Array };
  biome: { w: number; h: number; data: Uint8Array };
  tiles?: { coords: Int32Array; data: Int16Array };
}

globalThis.addEventListener('message', (ev: Event) => {
  const m = (ev as MessageEvent).data as SaveMsg;
  const n = m.edit.data.length;
  const q = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = Math.round(m.edit.data[i] * 16000);
    q[i] = x < -32768 ? -32768 : x > 32767 ? 32767 : x;
  }
  const project: ProjectData = {
    version: 1, world: m.world, sea: m.sea, relief: m.relief, view: m.view, vectors: m.vectors,
    edit: { w: m.edit.w, h: m.edit.h, height: q },
    biome: { w: m.biome.w, h: m.biome.h, data: m.biome.data },
    tiles: m.tiles,
  };
  void (async () => {
    try { await idb.set('autosave', await encodeProject(project)); } catch { /* ignore */ }
  })();
});
