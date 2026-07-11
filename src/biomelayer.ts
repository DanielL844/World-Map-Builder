import { paintBiomeDab, growRect, type Rect } from './biome';
import { resampleRGBA } from './storage';

// Editable biome-color layer: CPU RGBA8 field synced to a mip-mapped GPU texture.
export class BiomeLayer {
  readonly W: number;
  readonly H: number;
  readonly vMax: number;
  private gl: WebGL2RenderingContext;
  private data: Uint8Array;
  private tex: WebGLTexture;
  private dirty: Rect | null = null;
  private needMip = false;
  private before: Uint8Array;
  private strokeRect: Rect | null = null;
  private undoStack: { r: Rect; before: Uint8Array; after: Uint8Array }[] = [];
  private redoStack: { r: Rect; before: Uint8Array; after: Uint8Array }[] = [];

  constructor(gl: WebGL2RenderingContext, widthTexels: number, vMax: number) {
    if (!Number.isFinite(widthTexels) || widthTexels <= 0 || !Number.isFinite(vMax) || vMax <= 0) {
      throw new Error('BiomeLayer dimensions must be positive and finite');
    }
    this.gl = gl; this.vMax = vMax;
    const requested = Math.max(1, Math.floor(widthTexels));
    const reportedMax = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const maxSide = Math.max(1, Math.min(requested, Number.isFinite(reportedMax) && reportedMax > 0 ? Math.floor(reportedMax) : requested));
    this.W = vMax > 1 ? Math.max(1, Math.floor(maxSide / vMax)) : maxSide;
    this.H = Math.max(1, Math.min(maxSide, Math.round(this.W * vMax)));
    this.data = new Uint8Array(this.W * this.H * 4);
    this.before = new Uint8Array(this.W * this.H * 4);
    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture failed');
    this.tex = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.W, this.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  texture(): WebGLTexture { return this.tex; }
  dispose(): void { this.gl.deleteTexture(this.tex); }

  private txOf(u: number): number { return u * this.W - 0.5; }
  private tyOf(v: number): number { return (v / this.vMax) * this.H - 0.5; }

  beginStroke(): void { this.before.set(this.data); this.strokeRect = null; }
  dab(color: [number, number, number] | null, u: number, v: number, rU: number, strength: number): void {
    const rect = paintBiomeDab(this.data, this.W, this.H, color, this.txOf(u), this.tyOf(v), rU * this.W, strength);
    if (rect) {
      this.dirty = growRect(this.dirty, rect.x0, rect.y0, rect.x1, rect.y1);
      this.strokeRect = growRect(this.strokeRect, rect.x0, rect.y0, rect.x1, rect.y1);
      // The texture is sampled through mipmaps while zoomed out. Rebuild them on the next frame
      // during a drag so the stroke appears live rather than only after pointer-up.
      this.needMip = true;
    }
  }
  endStroke(): boolean {
    const r = this.strokeRect; this.strokeRect = null;
    if (!r) return false;
    const before = this.copyRegion(this.before, r);
    const after = this.copyRegion(this.data, r);
    let changed = false;
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== after[i]) { changed = true; break; }
    }
    if (!changed) return false;
    this.undoStack.push({ r, before, after });
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack.length = 0;
    return true;
  }

  private copyRegion(src: Uint8Array, r: Rect): Uint8Array {
    const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1, out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) { const s = ((r.y0 + y) * this.W + r.x0) * 4; out.set(src.subarray(s, s + w * 4), y * w * 4); }
    return out;
  }
  private pasteRegion(dst: Uint8Array, r: Rect, src: Uint8Array): void {
    const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
    for (let y = 0; y < h; y++) dst.set(src.subarray(y * w * 4, (y + 1) * w * 4), ((r.y0 + y) * this.W + r.x0) * 4);
  }
  undo(): boolean { const e = this.undoStack.pop(); if (!e) return false; this.pasteRegion(this.data, e.r, e.before); this.redoStack.push(e); this.dirty = growRect(this.dirty, e.r.x0, e.r.y0, e.r.x1, e.r.y1); this.needMip = true; return true; }
  redo(): boolean { const e = this.redoStack.pop(); if (!e) return false; this.pasteRegion(this.data, e.r, e.after); this.undoStack.push(e); this.dirty = growRect(this.dirty, e.r.x0, e.r.y0, e.r.x1, e.r.y1); this.needMip = true; return true; }

  serialize(): { w: number; h: number; data: Uint8Array } { return { w: this.W, h: this.H, data: this.data.slice() }; }
  loadBytes(src: Uint8Array, srcW: number, srcH: number): void {
    const r = resampleRGBA(src, srcW, srcH, this.W, this.H);
    this.data.set(r);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.dirty = null; this.needMip = false; this.strokeRect = null;
    this.undoStack = []; this.redoStack = [];
  }

  flush(): void {
    const gl = this.gl;
    const r = this.dirty;
    if (r) {
      const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, this.W);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x0, r.y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      this.dirty = null;
    }
    if (this.needMip) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.needMip = false;
    }
  }
}
