import {
  TILE, TileRegistry, tileKey, parseKey, tileRect, visibleTiles, type TileCoord,
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

// `direct` = painted by the user (real content, shown at its level and all deeper zooms).
// !direct = a propagated downsample (a footprint), shown ONLY at the zoomed-out level it serves.
interface Tile { tex: WebGLTexture; data: Float32Array; direct: boolean; }

export class TileLayer {
  readonly ok: boolean;
  readonly maxLevel: number;
  private gl: WebGL2RenderingContext;
  private tiles: TileRegistry<Tile>;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private loc: Record<string, WebGLUniformLocation | null>;
  private accumTex: WebGLTexture | null = null;
  private fbo: WebGLFramebuffer | null = null;
  private aw = 0; private ah = 0;
  // deep painting (M7.3)
  private stroke: Map<string, Float32Array> | null = null;     // key -> before-image for the active stroke
  private dirty = new Map<string, Rect>();                      // key -> texel rect awaiting GPU upload
  private undoStack: { key: string; before: Float32Array; after: Float32Array }[][] = [];
  private redoStack: { key: string; before: Float32Array; after: Float32Array }[][] = [];
  private maxPaintedLevel = 0;   // deepest level any stroke painted; caps the composite LOD window

  constructor(gl: WebGL2RenderingContext, maxLevel = 18) {
    this.gl = gl; this.maxLevel = maxLevel;
    this.ok = !!gl.getExtension('EXT_color_buffer_float');
    this.tiles = new TileRegistry<Tile>(400, (_k, t) => gl.deleteTexture(t.tex));
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
    this.tiles.clear();
    this.stroke = null; this.dirty.clear();
    this.undoStack.length = 0; this.redoStack.length = 0;
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

  private makeTile(): Tile {
    const gl = this.gl; const tex = gl.createTexture(); if (!tex) throw new Error('tex');
    const data = new Float32Array(TILE * TILE);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, TILE, TILE, 0, gl.RED, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return { tex, data, direct: false };
  }
  private getOrCreate(key: string): Tile {
    let t = this.tiles.get(key);
    if (!t) {
      t = this.makeTile(); this.tiles.set(key, t); this.tiles.pin(key);
      // Seed the new tile with the coarse edit beneath it, so detail built here adds on top of
      // that edit instead of resetting its whole tile footprint back to flat base (= "erasing").
      if (this.seedFromAncestor(parseKey(key), t.data)) {
        this.dirty.set(key, { x0: 0, y0: 0, x1: TILE - 1, y1: TILE - 1 });
      }
    }
    return t;
  }
  private seedFromAncestor(c: TileCoord, out: Float32Array): boolean {
    for (let la = c.level - 1; la >= 0; la--) {
      const a = this.tiles.get(tileKey(ancestorAt(c, la)));
      if (a) { upsampleFromAncestor(c, la, a.data, out); return true; }
    }
    return false;
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
        const t = this.tiles.get(tileKey(c));
        if (!t) continue;
        if (!t.direct && L !== Dv) continue;   // footprints only at the view level -> no rectangle halos
        const r = tileRect(c);
        const x0 = camX + r.u0 * scale, x1 = camX + r.u1 * scale;
        const yt0 = camY + r.v0 * scale, yt1 = camY + r.v1 * scale;
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.uniform4f(this.loc.rect, x0, h - yt1, x1, h - yt0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); drawn++;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    if (!this.logged) { this.logged = true; console.log('TileLayer first composite: ok=' + this.ok + ' level=' + top + ' tilesDrawn=' + drawn + ' accum=' + this.aw + 'x' + this.ah + ' totalTiles=' + this.tiles.size); }
  }

  // ---- deep painting (M7.3) ----
  beginStroke(): void { this.stroke = new Map(); }

  // Route one brush dab into the tile pyramid at `level`. world (u,v); rU brush radius in u-units.
  // amount/rate match EditLayer.dab. Tiles are the delta added on top of the region base, so an
  // untouched tile starts flat at 0.
  paintHeightDab(tool: ToolId, u: number, v: number, rU: number, amount: number, rate: number, level: number, vMax: number): void {
    if (!this.ok) return;
    const L = level < 0 ? 0 : level > this.maxLevel ? this.maxLevel : level;
    if (L > this.maxPaintedLevel) this.maxPaintedLevel = L;
    const rLocal = tileLocalRadius(L, rU);
    if (rLocal <= 0) return;
    // 'flatten' pulls toward a single shared target sampled at the dab centre, so it has no seam
    // where the dab spans multiple tiles.
    let flatTarget: number | undefined;
    if (tool === 'flatten') {
      const n = 1 << L;
      const cc = { level: L, tx: Math.floor(u * n), ty: Math.floor(v * n) };
      const ct = this.tiles.get(tileKey(cc));
      if (ct) {
        const p = tileLocalXY(cc, u, v);
        const xi = Math.min(TILE - 1, Math.max(0, Math.round(p.x)));
        const yi = Math.min(TILE - 1, Math.max(0, Math.round(p.y)));
        flatTarget = ct.data[yi * TILE + xi];
      } else {
        flatTarget = 0;
      }
    }
    for (const c of tilesForDab(L, u, v, rU, vMax)) {
      const key = tileKey(c);
      const t = this.getOrCreate(key);
      t.direct = true;                           // user-painted -> real content, not a footprint
      if (this.stroke && !this.stroke.has(key)) this.stroke.set(key, t.data.slice());
      const p = tileLocalXY(c, u, v);
      const rect = paintDab(t.data, TILE, TILE, tool, p.x, p.y, rLocal, amount, rate, flatTarget);
      if (rect) this.dirty.set(key, growRect(this.dirty.get(key) ?? null, rect.x0, rect.y0, rect.x1, rect.y1));
    }
  }

  // Close the stroke and push it onto the undo stack. Returns false if nothing changed.
  endStroke(): boolean {
    const s = this.stroke; this.stroke = null;
    if (!s) return false;
    this.propagateDown(s); // keep existing FINER tiles under the stroke in sync (before-images into s)
    this.propagateUp(s);   // build coarse ancestor footprints (records their before-images into s)
    const entry: { key: string; before: Float32Array; after: Float32Array }[] = [];
    for (const [key, before] of s) {
      const t = this.tiles.get(key); if (!t) continue;
      entry.push({ key, before, after: t.data.slice() });
    }
    if (entry.length === 0) return false;
    this.undoStack.push(entry);
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack.length = 0;
    return true;
  }

  // Propagate the finest-level edits up to coarse ancestor tiles (downsampled into the right
  // quadrant) so deep edits stay visible as a coarse footprint when zoomed back out — the
  // compositor is finest-level-wins, so a filled ancestor shows whenever its level is the
  // finest one on screen. Records each ancestor's pre-stroke image into `rec` so undo/redo
  // cover them too, and marks them dirty for upload. (M7.4)
  private propagateUp(rec: Map<string, Float32Array>): void {
    let current = new Set<string>(rec.keys());   // the painted, finest-level tiles
    while (current.size) {
      const parents = new Set<string>();
      for (const key of current) {
        const c = parseKey(key);
        if (c.level === 0) continue;
        const child = this.tiles.get(key); if (!child) continue;
        const pkey = tileKey(ancestorAt(c, c.level - 1));
        const parent = this.getOrCreate(pkey);
        if (!rec.has(pkey)) rec.set(pkey, parent.data.slice());
        downsampleIntoQuadrant(parent.data, child.data, c.tx & 1, c.ty & 1);
        this.dirty.set(pkey, { x0: 0, y0: 0, x1: TILE - 1, y1: TILE - 1 });
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
  private propagateDown(rec: Map<string, Float32Array>): void {
    // The increment this stroke added, per painted tile.
    const inc = new Map<string, { level: number; d: Float32Array }>();
    for (const [key, before] of rec) {
      const t = this.tiles.get(key); if (!t) continue;
      const d = new Float32Array(TILE * TILE);
      let any = false;
      for (let i = 0; i < d.length; i++) { const x = t.data[i] - before[i]; d[i] = x; if (x !== 0) any = true; }
      if (any) inc.set(key, { level: parseKey(key).level, d });
    }
    if (inc.size === 0) return;
    const up = new Float32Array(TILE * TILE);
    for (const key of this.tiles.keys()) {
      const c = parseKey(key);
      for (const [pkey, e] of inc) {
        if (c.level <= e.level) continue;                       // only strictly finer tiles
        if (tileKey(ancestorAt(c, e.level)) !== pkey) continue; // only under this painted tile
        const t = this.tiles.get(key); if (!t) continue;
        if (!rec.has(key)) rec.set(key, t.data.slice());
        upsampleFromAncestor(c, e.level, e.d, up);
        for (let i = 0; i < up.length; i++) t.data[i] += up[i];
        this.dirty.set(key, { x0: 0, y0: 0, x1: TILE - 1, y1: TILE - 1 });
        break; // a tile has exactly one ancestor at the stroke level
      }
    }
  }

  undo(): boolean {
    const e = this.undoStack.pop(); if (!e) return false;
    for (const en of e) this.restoreTile(en.key, en.before);
    this.redoStack.push(e); return true;
  }
  redo(): boolean {
    const e = this.redoStack.pop(); if (!e) return false;
    for (const en of e) this.restoreTile(en.key, en.after);
    this.undoStack.push(e); return true;
  }
  private restoreTile(key: string, img: Float32Array): void {
    const t = this.getOrCreate(key);
    t.data.set(img);
    this.dirty.set(key, { x0: 0, y0: 0, x1: TILE - 1, y1: TILE - 1 });
  }

  // Upload painted/restored tile rects to the GPU. Call once per frame before composite().
  flush(): void {
    if (this.dirty.size === 0) return;
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, TILE);
    for (const [key, r] of this.dirty) {
      const t = this.tiles.get(key); if (!t) continue;
      const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x0, r.y0, w, h, gl.RED, gl.FLOAT, t.data);
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    this.dirty.clear();
  }

  // ---- persistence (M7.5) ----
  // Flatten every non-empty resident tile to quantized Int16 (matching EditLayer's *16000 scale).
  // coords holds (level, tx, ty) per tile; data holds TILE*TILE values per tile, in the same order.
  serialize(): { coords: Int32Array; data: Int16Array } {
    const sel: { c: TileCoord; data: Float32Array; direct: boolean }[] = [];
    for (const key of this.tiles.keys()) {
      const t = this.tiles.get(key); if (!t) continue;
      let nonEmpty = false;
      for (let i = 0; i < t.data.length; i++) { if (t.data[i] !== 0) { nonEmpty = true; break; } }
      if (nonEmpty) sel.push({ c: parseKey(key), data: t.data, direct: t.direct });
    }
    const n = sel.length;
    const coords = new Int32Array(n * 4);   // level, tx, ty, direct
    const data = new Int16Array(n * TILE * TILE);
    for (let i = 0; i < n; i++) {
      coords[i * 4] = sel[i].c.level; coords[i * 4 + 1] = sel[i].c.tx; coords[i * 4 + 2] = sel[i].c.ty;
      coords[i * 4 + 3] = sel[i].direct ? 1 : 0;
      const src = sel[i].data, off = i * TILE * TILE;
      for (let j = 0; j < src.length; j++) {
        const q = Math.round(src[j] * 16000);
        data[off + j] = q < -32768 ? -32768 : q > 32767 ? 32767 : q;
      }
    }
    return { coords, data };
  }

  // Recreate saved tiles exactly (no ancestor-seeding — the saved data is already complete).
  // Caller clears the layer first.
  loadTiles(coords: Int32Array, data: Int16Array): void {
    if (!this.ok) return;
    const per = TILE * TILE, n = Math.floor(coords.length / 4);
    for (let i = 0; i < n; i++) {
      const level = coords[i * 4], tx = coords[i * 4 + 1], ty = coords[i * 4 + 2];
      const t = this.makeTile();
      t.direct = coords[i * 4 + 3] !== 0;
      const off = i * per;
      for (let j = 0; j < per; j++) t.data[j] = data[off + j] / 16000;
      const key = tileKey({ level, tx, ty });
      this.tiles.set(key, t); this.tiles.pin(key);
      this.dirty.set(key, { x0: 0, y0: 0, x1: TILE - 1, y1: TILE - 1 });
      if (level > this.maxPaintedLevel) this.maxPaintedLevel = level;
    }
  }
}
