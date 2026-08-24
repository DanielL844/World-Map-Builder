import {
  TILE, MAX_TILE_LEVEL, TileRegistry, tileKey, parseKey, tileRect, visibleTiles, type TileCoord,
  tilesForDab, tileLocalXY, tileLocalRadius, ancestorAt, downsampleIntoQuadrant, upsampleFromAncestor,
} from './tilestore';
import { paintDab, growRect, type Rect } from './brush';
import type { ToolId } from './tools';
import { program } from './gl';

// Compositing pass: draw each visible tile's quad (world rect -> screen rect) into a
// viewport-sized accumulation texture that the terrain shader samples by screen uv.
const COMP_VS = `#version 300 es
layout(location = 0) in vec2 aQuad;     // unit quad [0,1]^2
uniform vec4 uRect;                      // (x0,y0,x1,y1) device px, bottom-left origin
uniform vec2 uRes;
out vec2 vUv;
void main() {
  vec2 px = mix(uRect.xy, uRect.zw, aQuad);
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
  vUv = aQuad;
}`;
const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTile;
out vec4 o;
void main() { o = vec4(texture(uTile, vec2(vUv.x, 1.0 - vUv.y)).r, 0.0, 0.0, 1.0); }`;

// Quantisation scale for stored heights. Matches EditLayer.serialize and the saved project format,
// so demoting a tile to its compact form loses nothing that would have survived a save anyway.
const QUANT = 16000;
const TEXELS = TILE * TILE;

// How many tiles keep a live Float32 field and a GPU texture at once. Everything beyond this is
// held as quantised Int16 (half the CPU bytes, no GPU cost) and rehydrated on demand. The budget
// grows automatically if a single frame genuinely needs more tiles than this on screen.
const HOT_TILES = 192;
const HOT_TILES_MAX = 1024;

// Undo history is bounded by bytes, not by a stroke count: one stroke at deep zoom can touch a
// tile at every level from the painted one down to 0, so a fixed count says nothing about cost.
const UNDO_BUDGET_BYTES = 48 * 1024 * 1024;
const UNDO_MAX_ENTRIES = 60;

// `direct` = painted by the user (real content, shown at its level and all deeper zooms).
// !direct = a propagated downsample (a footprint), shown ONLY at the zoomed-out level it serves.
// `cold` holds the tile's data while it has no live field; exactly one of (hot entry, cold) is set.
interface Tile { direct: boolean; cold: Int16Array | null; }
interface HotTile { data: Float32Array; tex: WebGLTexture; }
interface TileState { data: Float32Array; direct: boolean; }

// One tile's contribution to an undoable action, stored as the quantised before/after of only the
// rectangle that actually changed. Full-tile Float32 snapshots cost 256 KB per tile per side; a
// typical dab rect is a few tens of KB.
interface TileEdit { key: string; r: Rect; before: Int16Array; after: Int16Array; d0: boolean; d1: boolean; }
interface UndoEntry { edits: TileEdit[]; bytes: number }

// Sample a CPU tile the same way WebGL samples its LINEAR texture. World-to-tile coordinates
// land on texture edges, while texel centers are at n + 0.5, hence the half-texel shift.
function sampleTile(data: Float32Array, x: number, y: number): number {
  const sx = x - 0.5, sy = y - 0.5;
  const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
  const x0 = Math.max(0, Math.min(TILE - 1, ix));
  const x1 = Math.max(0, Math.min(TILE - 1, ix + 1));
  const y0 = Math.max(0, Math.min(TILE - 1, iy));
  const y1 = Math.max(0, Math.min(TILE - 1, iy + 1));
  const a = data[y0 * TILE + x0], b = data[y0 * TILE + x1];
  const c = data[y1 * TILE + x0], d = data[y1 * TILE + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

function quantize(v: number): number {
  const q = Math.round(v * QUANT);
  return q < -32768 ? -32768 : q > 32767 ? 32767 : q;
}

/** Bounding box of the texels that differ between two full tiles, or null if they match. */
export function diffRect(a: Float32Array, b: Float32Array): Rect | null {
  let x0 = TILE, y0 = TILE, x1 = -1, y1 = -1;
  for (let y = 0; y < TILE; y++) {
    const row = y * TILE;
    for (let x = 0; x < TILE; x++) {
      if (a[row + x] !== b[row + x]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function copyRect(src: Float32Array, r: Rect): Int16Array {
  const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
  const out = new Int16Array(w * h);
  for (let y = 0; y < h; y++) {
    const s = (r.y0 + y) * TILE + r.x0, d = y * w;
    for (let x = 0; x < w; x++) out[d + x] = quantize(src[s + x]);
  }
  return out;
}

export class TileLayer {
  readonly ok: boolean;
  readonly maxLevel: number;
  private gl: WebGL2RenderingContext;
  /** Every tile that exists, hot or cold. Never evicted — this is the document. */
  private tiles = new Map<string, Tile>();
  /** Residency: which tiles currently have a live field + texture. Evicting demotes, never drops. */
  private hot: TileRegistry<HotTile>;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private loc: Record<string, WebGLUniformLocation | null>;
  private accumTex: WebGLTexture | null = null;
  private fbo: WebGLFramebuffer | null = null;
  private aw = 0; private ah = 0;
  // deep painting (M7.3)
  private stroke: Map<string, TileState> | null = null;        // key -> before-state for the active stroke
  private dirty = new Map<string, Rect>();                      // key -> texel rect awaiting GPU upload
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private undoBytes = 0;
  private maxPaintedLevel = 0;   // deepest level any stroke painted; caps the composite LOD window

  constructor(gl: WebGL2RenderingContext, maxLevel = MAX_TILE_LEVEL) {
    this.gl = gl; this.maxLevel = maxLevel;
    this.ok = !!gl.getExtension('EXT_color_buffer_float');
    this.hot = new TileRegistry<HotTile>(HOT_TILES, (k, h) => this.demote(k, h));
    this.prog = program(gl, COMP_VS, COMP_FS);
    const vao = gl.createVertexArray(); if (!vao) throw new Error('vao'); this.vao = vao;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.loc = { rect: gl.getUniformLocation(this.prog, 'uRect'), res: gl.getUniformLocation(this.prog, 'uRes'), tile: gl.getUniformLocation(this.prog, 'uTile') };
  }

  texture(): WebGLTexture | null { return this.accumTex; }
  clear(): void {
    this.hot.clear();
    this.tiles.clear();
    this.stroke = null; this.dirty.clear();
    this.undoStack.length = 0; this.redoStack.length = 0; this.undoBytes = 0;
    this.maxPaintedLevel = 0;
    // Drop the accumulation target too: composite() early-returns while the layer is empty, so
    // a leftover accum would keep showing GHOSTS of the old world's deep edits after New/Planet/Load.
    const gl = this.gl;
    if (this.accumTex) { gl.deleteTexture(this.accumTex); this.accumTex = null; }
    if (this.fbo) { gl.deleteFramebuffer(this.fbo); this.fbo = null; }
    this.aw = 0; this.ah = 0;
  }
  hasEdits(): boolean { return this.tiles.size > 0; }
  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  /** Rough resident cost, for the on-screen perf readout. */
  stats(): { tiles: number; hot: number; bytes: number; historyBytes: number } {
    let cold = 0;
    for (const t of this.tiles.values()) if (t.cold) cold++;
    const hot = this.hot.size;
    // hot = Float32 field + R16F texture; cold = Int16 only.
    return {
      tiles: this.tiles.size, hot, historyBytes: this.undoBytes,
      bytes: hot * TEXELS * 6 + cold * TEXELS * 2 + this.undoBytes,
    };
  }

  // ---- residency ----

  private meta(key: string): Tile {
    let m = this.tiles.get(key);
    if (!m) { m = { direct: false, cold: null }; this.tiles.set(key, m); }
    return m;
  }
  private makeTexture(data: Float32Array): WebGLTexture {
    const gl = this.gl; const tex = gl.createTexture(); if (!tex) throw new Error('tex');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, TILE, TILE, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }
  /** Give up a tile's live field and texture, keeping its data in compact form. */
  private demote(key: string, h: HotTile): void {
    const m = this.tiles.get(key);
    if (m) {
      const c = new Int16Array(TEXELS);
      for (let i = 0; i < TEXELS; i++) c[i] = quantize(h.data[i]);
      m.cold = c;
    }
    this.gl.deleteTexture(h.tex);
    // Its texture is gone; a later promotion uploads the whole tile, so any pending rect is moot.
    this.dirty.delete(key);
  }
  /**
   * The tile's live field, promoting it (and creating the tile) if needed. Callers that hold the
   * returned array across another field() call must pin the key first, or their tile can be
   * demoted underneath them and the array silently orphaned.
   */
  private field(key: string): Float32Array {
    const h = this.hot.get(key);
    if (h) return h.data;
    const m = this.meta(key);
    const data = new Float32Array(TEXELS);
    if (m.cold) {
      const c = m.cold;
      for (let i = 0; i < TEXELS; i++) data[i] = c[i] / QUANT;
      m.cold = null;
    }
    this.hot.set(key, { data, tex: this.makeTexture(data) });
    return data;
  }
  /** The tile's data in compact form, without promoting it. Null if the tile does not exist. */
  private compact(key: string): Int16Array | null {
    const h = this.hot.peek(key);
    if (h) {
      const c = new Int16Array(TEXELS);
      for (let i = 0; i < TEXELS; i++) c[i] = quantize(h.data[i]);
      return c;
    }
    return this.tiles.get(key)?.cold ?? null;
  }

  private ensure(key: string): Float32Array {
    const existed = this.tiles.has(key);
    this.hot.pin(key);
    const data = this.field(key);
    if (!existed && this.seedFromAncestor(parseKey(key), data)) {
      this.dirty.set(key, { x0: 0, y0: 0, x1: TILE - 1, y1: TILE - 1 });
    }
    return data;
  }
  private seedFromAncestor(c: TileCoord, out: Float32Array): boolean {
    for (let la = c.level - 1; la >= 0; la--) {
      const ak = tileKey(ancestorAt(c, la));
      if (this.tiles.has(ak)) { upsampleFromAncestor(c, la, this.field(ak), out); return true; }
    }
    return false;
  }

  // Height at a world point from the requested tile level, falling back to the closest resident
  // ancestor. This mirrors ensure() seeding and keeps flatten's shared target from snapping
  // to zero merely because its centre tile has not been instantiated yet.
  private heightAt(level: number, u: number, v: number, vMax: number): number {
    const n = 1 << level;
    const tyMax = Math.max(0, Math.ceil(vMax * n) - 1);
    const c: TileCoord = {
      level,
      tx: Math.max(0, Math.min(n - 1, Math.floor(u * n))),
      ty: Math.max(0, Math.min(tyMax, Math.floor(v * n))),
    };
    for (let l = level; l >= 0; l--) {
      const a = ancestorAt(c, l);
      const key = tileKey(a);
      if (this.tiles.has(key)) {
        const p = tileLocalXY(a, u, v);
        return sampleTile(this.field(key), p.x, p.y);
      }
    }
    return 0;
  }
  private ensureAccum(w: number, h: number): void {
    const gl = this.gl;
    if (this.accumTex && this.aw === w && this.ah === h) return;
    this.aw = w; this.ah = h;
    if (this.accumTex) gl.deleteTexture(this.accumTex);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    const tex = gl.createTexture(); if (!tex) throw new Error('accum'); this.accumTex = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.FLOAT, null);
    // LINEAR so the terrain shader's screen-space blur of this accum interpolates between texels.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer(); if (!fbo) throw new Error('fbo'); this.fbo = fbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) console.warn('TileLayer: accum framebuffer incomplete 0x' + st.toString(16));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // camX, camY, scale in DEVICE px (screenX_topleft = camX + u*scale). w,h device px.
  // topLevel is the finest tile level to composite (caller picks it from a stable scale so it
  // matches the level strokes are painted at, regardless of the adaptive render DPR).
  private logged = false;
  composite(camX: number, camY: number, scale: number, w: number, h: number, vMax: number, topLevel: number): void {
    if (!this.ok) { if (!this.logged) { this.logged = true; console.warn('TileLayer: EXT_color_buffer_float unavailable; tile layer disabled'); } return; }
    if (this.tiles.size === 0) return; // nothing painted: accum stays zero, no per-frame work
    const gl = this.gl;
    let drawn = 0;
    this.ensureAccum(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    gl.uniform2f(this.loc.res, w, h); gl.uniform1i(this.loc.tile, 0); gl.activeTexture(gl.TEXTURE0);
    const Dv = topLevel < 0 ? 0 : topLevel > this.maxLevel ? this.maxLevel : topLevel;
    const top = Math.min(Dv, this.maxPaintedLevel);   // nothing painted finer than this; just a perf cap
    const uMin = (0 - camX) / scale, uMax = (w - camX) / scale;
    const vMin = (0 - camY) / scale, vMaxView = (h - camY) / scale;
    // Draw coarse -> fine, finest wins. Drawing EVERY level up to the view (not just the nearest
    // ones) is what keeps an edit made at any scale visible when you zoom in to add detail on it.
    for (let L = 0; L <= top; L++) {
      const cands = visibleTiles(L, Math.max(0, uMin), Math.max(0, vMin), Math.min(1, uMax), Math.min(vMax, vMaxView), vMax);
      for (const c of cands) {
        const key = tileKey(c);
        const m = this.tiles.get(key);
        if (!m) continue;
        if (!m.direct && L !== Dv) continue;   // footprints only at the view level -> no rectangle halos
        const r = tileRect(c);
        const x0 = camX + r.u0 * scale, x1 = camX + r.u1 * scale;
        const yt0 = camY + r.v0 * scale, yt1 = camY + r.v1 * scale;
        // Promoting here can evict an earlier tile, which is fine: that one has already been drawn.
        this.uploadIfDirty(key);
        const hotTile = this.hot.peek(key) ?? (this.field(key), this.hot.peek(key));
        if (!hotTile) continue;
        gl.bindTexture(gl.TEXTURE_2D, hotTile.tex);
        gl.uniform4f(this.loc.rect, x0, h - yt1, x1, h - yt0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); drawn++;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    // A frame that genuinely needs more tiles than the budget would otherwise demote and rehydrate
    // every one of them, every frame. Let the budget follow the real working set instead.
    if (drawn > this.hot.capacity * 0.8) {
      this.hot.setCapacity(Math.min(HOT_TILES_MAX, Math.max(HOT_TILES, Math.ceil(drawn * 1.5))));
    }
    if (!this.logged) { this.logged = true; console.log('TileLayer first composite: ok=' + this.ok + ' level=' + top + ' tilesDrawn=' + drawn + ' accum=' + this.aw + 'x' + this.ah + ' totalTiles=' + this.tiles.size); }
  }

  // amount/rate match EditLayer.dab. Tiles are the delta added on top of the region base, so an
  // untouched tile starts flat at 0.
  paintHeightDab(tool: ToolId, u: number, v: number, rU: number, amount: number, rate: number, level: number, vMax: number): void {
    if (!this.ok) return;
    const L = level < 0 ? 0 : level > this.maxLevel ? this.maxLevel : level;
    const rLocal = tileLocalRadius(L, rU);
    if (rLocal <= 0) return;
    // 'flatten' pulls toward a single shared target sampled at the dab centre, so it has no seam
    // where the dab spans multiple tiles.
    let flatTarget: number | undefined;
    if (tool === 'flatten') {
      flatTarget = this.heightAt(L, u, v, vMax);
    }
    for (const c of tilesForDab(L, u, v, rU, vMax)) {
      const key = tileKey(c);
      const data = this.ensure(key);
      const m = this.meta(key);
      const before = this.stroke && !this.stroke.has(key) ? { data: data.slice(), direct: m.direct } : null;
      const p = tileLocalXY(c, u, v);
      // Convert normalized texture-edge coordinates to the texel-center frame paintDab uses.
      // At a shared tile edge this puts both adjacent edge texels 0.5 texel from the brush centre,
      // removing the old one-pixel strength discontinuity.
      const rect = paintDab(data, TILE, TILE, tool, p.x - 0.5, p.y - 0.5, rLocal, amount, rate, flatTarget);
      if (rect) {
        m.direct = true;                         // user-painted -> real content, not a footprint
        if (before && this.stroke) this.stroke.set(key, before);
        if (L > this.maxPaintedLevel) this.maxPaintedLevel = L;
        this.dirty.set(key, growRect(this.dirty.get(key) ?? null, rect.x0, rect.y0, rect.x1, rect.y1));
      }
    }
  }

  beginStroke(): void { this.stroke = new Map(); this.hot.unpinAll(); }

  // Close the stroke and push it onto the undo stack. Returns false if nothing changed.
  endStroke(): boolean {
    const s = this.stroke; this.stroke = null;
    if (!s) { this.hot.unpinAll(); return false; }
    this.propagateDown(s); // keep existing FINER tiles under the stroke in sync (before-images into s)
    this.propagateUp(s);   // build coarse ancestor footprints (records their before-images into s)
    const edits: TileEdit[] = [];
    let bytes = 0;
    for (const [key, before] of s) {
      const m = this.tiles.get(key); if (!m) continue;
      this.hot.pin(key);
      const cur = this.field(key);
      const r = diffRect(before.data, cur);
      if (!r && before.direct === m.direct) continue;
      // A direct-flag-only change still has to be undoable; one texel is enough to carry it.
      const rect = r ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
      const edit: TileEdit = {
        key, r: rect,
        before: copyRect(before.data, rect), after: copyRect(cur, rect),
        d0: before.direct, d1: m.direct,
      };
      bytes += edit.before.byteLength + edit.after.byteLength + 96;
      edits.push(edit);
    }
    this.hot.unpinAll();
    if (edits.length === 0) return false;
    this.undoStack.push({ edits, bytes });
    this.undoBytes += bytes;
    this.trimHistory();
    this.redoStack.length = 0;
    return true;
  }

  private trimHistory(): void {
    while (this.undoStack.length > 1 && (this.undoBytes > UNDO_BUDGET_BYTES || this.undoStack.length > UNDO_MAX_ENTRIES)) {
      const dropped = this.undoStack.shift();
      if (dropped) this.undoBytes -= dropped.bytes;
    }
    if (this.undoBytes < 0) this.undoBytes = 0;
  }

  // Propagate the finest-level edits up to coarse ancestor tiles (downsampled into the right
  // quadrant) so deep edits stay visible as a coarse footprint when zoomed back out — the
  // compositor is finest-level-wins, so a filled ancestor shows whenever its level is the
  // finest one on screen. Records each ancestor's pre-stroke image into `rec` so undo/redo
  // cover them too, and marks them dirty for upload. (M7.4)
  private propagateUp(rec: Map<string, TileState>): void {
    let current = new Set<string>(rec.keys());   // the painted, finest-level tiles
    while (current.size) {
      const parents = new Set<string>();
      for (const key of current) {
        const c = parseKey(key);
        if (c.level === 0) continue;
        if (!this.tiles.has(key)) continue;
        this.hot.pin(key);
        const child = this.field(key);
        const pkey = tileKey(ancestorAt(c, c.level - 1));
        const parent = this.ensure(pkey);
        if (!rec.has(pkey)) rec.set(pkey, { data: parent.slice(), direct: this.meta(pkey).direct });
        downsampleIntoQuadrant(parent, child, c.tx & 1, c.ty & 1);
        // Only one quadrant changed, so only that quadrant needs re-uploading.
        const half = TILE >> 1, ox = (c.tx & 1) * half, oy = (c.ty & 1) * half;
        this.dirty.set(pkey, growRect(this.dirty.get(pkey) ?? null, ox, oy, ox + half - 1, oy + half - 1));
        parents.add(pkey);
      }
      current = parents;
    }
  }

  // The inverse of propagateUp: add this stroke's height increment into every EXISTING finer
  // tile under the painted area (upsampled to that tile's res). Every tile holds the TOTAL
  // delta at its res; painting only updated the stroke level and its ancestors, so finer tiles
  // (earlier deep detail, or footprints of it) went STALE — and the finest-wins compositor then
  // drew those stale squares of old/base height OVER the new coarser edit, or "hid" it entirely,
  // depending on zoom. Must run BEFORE propagateUp, while `rec` holds only the painted tiles
  // (their rec entries are pre-stroke images, so data - before = the stroke's increment).
  // Records before-images of every finer tile it touches into `rec` so undo/redo cover them.
  private propagateDown(rec: Map<string, TileState>): void {
    // The increment this stroke added, per painted tile.
    const inc = new Map<string, { level: number; d: Float32Array }>();
    for (const [key, before] of rec) {
      if (!this.tiles.has(key)) continue;
      this.hot.pin(key);
      const cur = this.field(key);
      const d = new Float32Array(TEXELS);
      let any = false;
      for (let i = 0; i < d.length; i++) { const x = cur[i] - before.data[i]; d[i] = x; if (x !== 0) any = true; }
      if (any) inc.set(key, { level: parseKey(key).level, d });
    }
    if (inc.size === 0) return;
    const up = new Float32Array(TEXELS);
    for (const key of [...this.tiles.keys()]) {
      const c = parseKey(key);
      for (const [pkey, e] of inc) {
        if (c.level <= e.level) continue;                       // only strictly finer tiles
        if (tileKey(ancestorAt(c, e.level)) !== pkey) continue; // only under this painted tile
        this.hot.pin(key);
        const t = this.field(key);
        if (!rec.has(key)) rec.set(key, { data: t.slice(), direct: this.meta(key).direct });
        upsampleFromAncestor(c, e.level, e.d, up);
        for (let i = 0; i < up.length; i++) t[i] += up[i];
        this.dirty.set(key, { x0: 0, y0: 0, x1: TILE - 1, y1: TILE - 1 });
        break; // a tile has exactly one ancestor at the stroke level
      }
    }
  }

  undo(): boolean {
    const e = this.undoStack.pop(); if (!e) return false;
    for (const en of e.edits) this.restore(en, true);
    this.undoBytes -= e.bytes;
    this.redoStack.push(e); this.recomputeMaxPaintedLevel(); return true;
  }
  redo(): boolean {
    const e = this.redoStack.pop(); if (!e) return false;
    for (const en of e.edits) this.restore(en, false);
    this.undoStack.push(e); this.undoBytes += e.bytes; this.trimHistory();
    this.recomputeMaxPaintedLevel(); return true;
  }
  private restore(e: TileEdit, toBefore: boolean): void {
    const data = this.field(e.key);
    const q = toBefore ? e.before : e.after;
    const r = e.r, w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
    for (let y = 0; y < h; y++) {
      const d = (r.y0 + y) * TILE + r.x0, sOff = y * w;
      for (let x = 0; x < w; x++) data[d + x] = q[sOff + x] / QUANT;
    }
    this.meta(e.key).direct = toBefore ? e.d0 : e.d1;
    this.dirty.set(e.key, growRect(this.dirty.get(e.key) ?? null, r.x0, r.y0, r.x1, r.y1));
  }
  private recomputeMaxPaintedLevel(): void {
    let max = 0;
    for (const [key, m] of this.tiles) if (m.direct) max = Math.max(max, parseKey(key).level);
    this.maxPaintedLevel = max;
  }

  // Upload painted/restored tile rects to the GPU. Call once per frame before composite().
  flush(): void {
    if (this.dirty.size === 0) return;
    for (const key of [...this.dirty.keys()]) this.uploadIfDirty(key);
    this.dirty.clear();
  }
  private uploadIfDirty(key: string): void {
    const r = this.dirty.get(key);
    if (!r) return;
    const h = this.hot.peek(key);
    // Not resident: its data lives in compact form and a later promotion uploads all of it.
    if (!h) { this.dirty.delete(key); return; }
    const gl = this.gl;
    const w = r.x1 - r.x0 + 1, hgt = r.y1 - r.y0 + 1;
    gl.bindTexture(gl.TEXTURE_2D, h.tex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, TILE);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x0, r.y0, w, hgt, gl.RED, gl.FLOAT, h.data);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    this.dirty.delete(key);
  }

  // ---- persistence (M7.5) ----
  // Flatten every non-empty tile to quantized Int16 (matching EditLayer's *16000 scale).
  // coords holds (level, tx, ty) per tile; data holds TILE*TILE values per tile, in the same order.
  // Reads compact copies directly, so saving does not drag every cold tile back into memory.
  serialize(): { coords: Int32Array; data: Int16Array } {
    const sel: { c: TileCoord; data: Int16Array; direct: boolean }[] = [];
    for (const [key, m] of this.tiles) {
      const q = this.compact(key);
      if (!q) continue;
      let nonEmpty = false;
      for (let i = 0; i < q.length; i++) { if (q[i] !== 0) { nonEmpty = true; break; } }
      if (nonEmpty) sel.push({ c: parseKey(key), data: q, direct: m.direct });
    }
    const n = sel.length;
    const coords = new Int32Array(n * 4);   // level, tx, ty, direct
    const data = new Int16Array(n * TEXELS);
    for (let i = 0; i < n; i++) {
      coords[i * 4] = sel[i].c.level; coords[i * 4 + 1] = sel[i].c.tx; coords[i * 4 + 2] = sel[i].c.ty;
      coords[i * 4 + 3] = sel[i].direct ? 1 : 0;
      data.set(sel[i].data, i * TEXELS);
    }
    return { coords, data };
  }

  // Recreate saved tiles exactly (no ancestor-seeding — the saved data is already complete).
  // Caller clears the layer first. Tiles land straight in compact form: a project with hundreds of
  // painted tiles used to allocate a field and a texture for every one of them up front.
  loadTiles(coords: Int32Array, data: Int16Array): void {
    if (!this.ok) return;
    const n = Math.floor(coords.length / 4);
    for (let i = 0; i < n; i++) {
      const level = coords[i * 4], tx = coords[i * 4 + 1], ty = coords[i * 4 + 2];
      const off = i * TEXELS;
      const key = tileKey({ level, tx, ty });
      const direct = coords[i * 4 + 3] !== 0;
      this.hot.delete(key);
      this.tiles.set(key, { direct, cold: data.slice(off, off + TEXELS) });
      if (direct && level > this.maxPaintedLevel) this.maxPaintedLevel = level;
    }
  }
}
