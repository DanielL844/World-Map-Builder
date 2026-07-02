import type { Camera } from './camera';
import type { VectorStore, Line } from './vectors';

// Crisp Canvas2D overlay drawn on top of the WebGL terrain. Vectors stay sharp at any zoom.
export class Overlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cw = 0; private ch = 0; private dpr = 1;

  constructor() {
    const c = document.createElement('canvas');
    c.className = 'overlay';
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    this.canvas = c; this.ctx = ctx;
  }

  el(): HTMLCanvasElement { return this.canvas; }

  resize(cssW: number, cssH: number, dpr: number): void {
    if (this.cw === cssW && this.ch === cssH && this.dpr === dpr) return;
    this.cw = cssW; this.ch = cssH; this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
  }

  draw(store: VectorStore, cam: Camera, vMax: number, widthKm: number, brush: { x: number; y: number; r: number } | null): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    const X = (u: number) => cam.x + u * cam.scale;
    const Y = (v: number) => cam.y + v * cam.scale;
    const wx0 = X(0), wy0 = Y(0), wx1 = X(1), wy1 = Y(vMax);
    if (wx0 > 0 || wy0 > 0 || wx1 < this.cw || wy1 < this.ch) {
      ctx.fillStyle = 'rgba(8,11,15,.32)';
      ctx.fillRect(0, 0, this.cw, this.ch);
      ctx.clearRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    const pxPerKm = cam.scale / widthKm;
    for (const l of store.lines) this.line(l, X, Y, pxPerKm);
    if (store.temp) this.line(store.temp, X, Y, pxPerKm);

    for (const t of store.towns) {
      const x = X(t.at.u), y = Y(t.at.v);
      if (x < -40 || y < -40 || x > this.cw + 40 || y > this.ch + 40) continue;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 7);
      ctx.fillStyle = '#f4ead0'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#2a2118'; ctx.stroke();
      this.text(t.name, x + 9, y, t.size, 'left');
    }
    for (const lb of store.labels) {
      const x = X(lb.at.u), y = Y(lb.at.v);
      if (x < -80 || y < -40 || x > this.cw + 80 || y > this.ch + 40) continue;
      this.text(lb.text, x, y, lb.size, 'center');
    }
    // world boundary: draw only the on-screen edges, clamped to the viewport, so a huge
    // off-screen rectangle doesn't make Canvas2D compute a million dash segments.
    ctx.setLineDash([8, 6]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.6)';
    const cl = (a: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, a));
    const yA = cl(wy0, 0, this.ch), yB = cl(wy1, 0, this.ch);
    const xA = cl(wx0, 0, this.cw), xB = cl(wx1, 0, this.cw);
    ctx.beginPath();
    if (wx0 >= -2 && wx0 <= this.cw + 2) { ctx.moveTo(wx0, yA); ctx.lineTo(wx0, yB); }
    if (wx1 >= -2 && wx1 <= this.cw + 2) { ctx.moveTo(wx1, yA); ctx.lineTo(wx1, yB); }
    if (wy0 >= -2 && wy0 <= this.ch + 2) { ctx.moveTo(xA, wy0); ctx.lineTo(xB, wy0); }
    if (wy1 >= -2 && wy1 <= this.ch + 2) { ctx.moveTo(xA, wy1); ctx.lineTo(xB, wy1); }
    ctx.stroke(); ctx.setLineDash([]);
    if (brush) {
      ctx.beginPath(); ctx.arc(brush.x, brush.y, brush.r, 0, 7);
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
      ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
    }
  }

  private line(l: Line, X: (u: number) => number, Y: (v: number) => number, pxPerKm: number): void {
    const ctx = this.ctx;
    const p = l.pts;
    if (p.length < 1) return;
    // cull
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const q of p) { const x = X(q.u), y = Y(q.v); if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
    if (maxX < -8 || minX > this.cw + 8 || maxY < -8 || minY > this.ch + 8) return;

    const path = () => { ctx.beginPath(); ctx.moveTo(X(p[0].u), Y(p[0].v)); for (let i = 1; i < p.length; i++) ctx.lineTo(X(p[i].u), Y(p[i].v)); };

    const lw = (km: number, mn: number, mx: number) => Math.max(mn, Math.min(mx, km * pxPerKm));
    if (l.kind === 'road') {
      const w = lw(1.0, 1.2, 11);
      path(); ctx.strokeStyle = 'rgba(40,28,12,.55)'; ctx.lineWidth = w * 1.8; ctx.stroke();
      path(); ctx.strokeStyle = '#caa46a'; ctx.lineWidth = w; ctx.stroke();
    } else if (l.kind === 'border') {
      const w = lw(0.8, 1.3, 7);
      ctx.setLineDash([Math.max(5, w * 3), Math.max(4, w * 2)]); path(); ctx.strokeStyle = l.color; ctx.lineWidth = w; ctx.stroke(); ctx.setLineDash([]);
    } else { // river
      const w = lw(2.2, 1.0, 9);
      path(); ctx.strokeStyle = '#2f74b0'; ctx.lineWidth = w; ctx.stroke();
    }
  }

  private text(s: string, x: number, y: number, size: number, align: CanvasTextAlign): void {
    const ctx = this.ctx;
    ctx.font = `600 ${size}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(s, x, y);
    ctx.fillStyle = '#1a232e'; ctx.fillText(s, x, y);
  }
}
