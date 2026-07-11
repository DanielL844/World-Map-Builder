import { paintDab, growRect, type Rect } from './brush';
import { resampleField } from './storage';
import type { ToolId } from './tools';

// Editable height layer: a CPU float field synced to a mip-mapped GPU texture.
// The terrain shader samples this and adds it to the procedural base, so edits
// move land/sea and (via mipmaps) show as a coarse footprint when zoomed out.
export class EditLayer {
  readonly W: number;
  readonly H: number;
  readonly vMax: number;
  readonly mipmaps: boolean;
  private gl: WebGL2RenderingContext;
  private data: Float32Array;
  private tex: WebGLTexture;
  private dirty: Rect | null = null;
  private needMip = false;
  private before: Float32Array;
  private strokeRect: Rect | null = null;
  private undoStack: { r: Rect; before: Float32Array; after: Float32Array }[] = [];
  private redoStack: { r: Rect; before: Float32Array; after: Float32Array }[] = [];

  constructor(gl: WebGL2RenderingContext, widthTexels: number, vMax: number) {
    if (!Number.isFinite(widthTexels) || widthTexels <= 0 || !Number.isFinite(vMax) || vMax <= 0) {
      throw new Error('EditLayer dimensions must be positive and finite');
    }
    this.gl = gl;
    // Keep the longest field side within both the requested quality budget and the GPU limit.
    // On tall worlds, reducing W preserves approximately square world-space texels instead of
    // allocating widthTexels * (widthTexels*vMax), which can exceed memory/MAX_TEXTURE_SIZE.
    const requested = Math.max(1, Math.floor(widthTexels));
    const reportedMax = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const maxSide = Math.max(1, Math.min(requested, Number.isFinite(reportedMax) && reportedMax > 0 ? Math.floor(reportedMax) : requested));
    this.W = vMax > 1 ? Math.max(1, Math.floor(maxSide / vMax)) : maxSide;
    this.vMax = vMax;
    this.H = Math.max(1, Math.min(maxSide, Math.round(this.W * vMax)));
    this.data = new Float32Array(this.W * this.H);
    this.before = new Float32Array(this.W * this.H);
    // R16F needs EXT_color_buffer_float to be mip-mappable; degrade gracefully without it.
    this.mipmaps = !!gl.getExtension('EXT_color_buffer_float');

    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture failed');
    this.tex = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, this.W, this.H, 0, gl.RED, gl.FLOAT, this.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (this.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
  }

  texture(): WebGLTexture { return this.tex; }
  dispose(): void { this.gl.deleteTexture(this.tex); }

  setData(src: Float32Array): void {
    this.data.set(src);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RED, gl.FLOAT, this.data);
    if (this.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    this.dirty = null; this.needMip = false; this.strokeRect = null;
    this.undoStack = []; this.redoStack = [];
  }

  serialize(): { w: number; h: number; height: Int16Array } {
    const q = new Int16Array(this.W * this.H);
    for (let i = 0; i < q.length; i++) { const x = Math.round(this.data[i] * 16000); q[i] = x < -32768 ? -32768 : x > 32767 ? 32767 : x; }
    return { w: this.W, h: this.H, height: q };
  }

  floatCopy(): { w: number; h: number; data: Float32Array } { return { w: this.W, h: this.H, data: this.data.slice() }; }

  loadInt16(src: Int16Array, srcW: number, srcH: number): void {
    const r = resampleField(src, srcW, srcH, this.W, this.H);
    for (let i = 0; i < this.data.length; i++) this.data[i] = r[i] / 16000;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RED, gl.FLOAT, this.data);
    if (this.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    this.dirty = null; this.needMip = false; this.strokeRect = null;
    this.undoStack = []; this.redoStack = [];
  }

  private txOf(u: number): number { return u * this.W - 0.5; }
  private tyOf(v: number): number { return (v / this.vMax) * this.H - 0.5; }

  beginStroke(): void {
    this.before.set(this.data);
    this.strokeRect = null;
  }

  // u in [0,1], v in [0,vMax], rU brush radius in world u-units.
  dab(tool: ToolId, u: number, v: number, rU: number, amount: number, rate: number): void {
    const r = rU * this.W;
    const rect = paintDab(this.data, this.W, this.H, tool, this.txOf(u), this.tyOf(v), r, amount, rate);
    if (rect) {
      this.dirty = growRect(this.dirty, rect.x0, rect.y0, rect.x1, rect.y1);
      this.strokeRect = growRect(this.strokeRect, rect.x0, rect.y0, rect.x1, rect.y1);
      // flush() runs during an active drag, so keep the sampled mip chain live instead of
      // showing stale zoomed-out terrain until pointer-up.
      this.needMip = true;
    }
  }

  endStroke(): boolean {
    const r = this.strokeRect;
    this.strokeRect = null;
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

  private copyRegion(src: Float32Array, r: Rect): Float32Array {
    const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const s = (r.y0 + y) * this.W + r.x0;
      out.set(src.subarray(s, s + w), y * w);
    }
    return out;
  }
  private pasteRegion(dst: Float32Array, r: Rect, src: Float32Array): void {
    const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
    for (let y = 0; y < h; y++) {
      dst.set(src.subarray(y * w, y * w + w), (r.y0 + y) * this.W + r.x0);
    }
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.pasteRegion(this.data, e.r, e.before);
    this.redoStack.push(e);
    this.dirty = growRect(this.dirty, e.r.x0, e.r.y0, e.r.x1, e.r.y1);
    this.needMip = true;
    return true;
  }
  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.pasteRegion(this.data, e.r, e.after);
    this.undoStack.push(e);
    this.dirty = growRect(this.dirty, e.r.x0, e.r.y0, e.r.x1, e.r.y1);
    this.needMip = true;
    return true;
  }
  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  // Upload any dirty region to the GPU + rebuild mips. Call once per frame before drawing.
  flush(): void {
    const gl = this.gl;
    const r = this.dirty;
    if (r) {
      const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, this.W);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x0, r.y0, w, h, gl.RED, gl.FLOAT, this.data);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      this.dirty = null;
    }
    if (this.needMip) {
      if (this.mipmaps) {
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.generateMipmap(gl.TEXTURE_2D);
      }
      this.needMip = false;
    }
  }
}
