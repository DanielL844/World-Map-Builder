import { type Camera, screenToWorld, zoomAt, clamp } from './camera';

export interface PaintInfo { u: number; v: number; pressure: number; }

export interface InteractionOptions {
  minScale: number;
  maxScale: number;
  captures: () => boolean;   // true when a brush tool (not pan) is selected
  fingerDraw: () => boolean;    // allow single-finger touch to paint
  onPaintStart: (p: PaintInfo) => void;
  onPaintMove: (p: PaintInfo) => void;
  onPaintEnd: () => void;
  onChange: () => void;         // camera changed
  onHover: (sx: number, sy: number) => void;
}

interface P { x: number; y: number; }

// Unified input: paint with stylus/mouse when a brush tool is active; navigate otherwise.
// Two pointers = pinch-zoom. Right/middle mouse or held Space = pan even while a brush is active.
export function attachInteraction(canvas: HTMLCanvasElement, cam: Camera, opts: InteractionOptions): void {
  const pointers = new Map<number, P>();
  let mode: 'none' | 'pan' | 'pinch' | 'paint' = 'none';
  let drawId = -1;
  let drawType = '';
  let panLast: P = { x: 0, y: 0 };
  let pinch: { d: number; w: { u: number; v: number }; s: number } | null = null;
  let space = false;

  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isField(e.target)) { space = true; e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') space = false; });

  const rel = (e: MouseEvent): P => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 1);
  const toUV = (p: P) => screenToWorld(cam, p.x, p.y);

  canvas.addEventListener('pointerdown', (e) => {
    const p = rel(e);
    // palm rejection: ignore touches while a pen is painting
    if (mode === 'paint' && drawType === 'pen' && e.pointerType !== 'pen') return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, p);

    if (pointers.size >= 2) {
      if (mode === 'paint') opts.onPaintEnd();
      const [a, b] = [...pointers.values()];
      const m = mid(a, b);
      pinch = { d: dist(a, b), w: screenToWorld(cam, m.x, m.y), s: cam.scale };
      mode = 'pinch';
      return;
    }

    const panBtn = e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || space);
    const canPaint = opts.captures() && !panBtn &&
      (e.pointerType === 'pen' || e.pointerType === 'mouse' || (e.pointerType === 'touch' && opts.fingerDraw()));

    if (canPaint) {
      mode = 'paint'; drawId = e.pointerId; drawType = e.pointerType;
      const uv = toUV(p);
      opts.onPaintStart({ u: uv.u, v: uv.v, pressure: pressureOf(e) });
    } else {
      mode = 'pan'; panLast = p;
      if (panBtn) e.preventDefault();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const has = pointers.has(e.pointerId);
    const p = rel(e);
    if (has) pointers.set(e.pointerId, p);
    opts.onHover(p.x, p.y);

    if (mode === 'pinch' && pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const m = mid(a, b);
      cam.scale = clamp(pinch.s * (dist(a, b) / pinch.d), opts.minScale, opts.maxScale);
      cam.x = m.x - pinch.w.u * cam.scale;
      cam.y = m.y - pinch.w.v * cam.scale;
      opts.onChange();
    } else if (mode === 'paint' && e.pointerId === drawId) {
      const uv = toUV(p);
      opts.onPaintMove({ u: uv.u, v: uv.v, pressure: pressureOf(e) });
    } else if (mode === 'pan' && has) {
      cam.x += p.x - panLast.x; cam.y += p.y - panLast.y; panLast = p;
      opts.onChange();
    }
  });

  const end = (e: PointerEvent) => {
    const wasPaint = mode === 'paint' && e.pointerId === drawId;
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (wasPaint) { opts.onPaintEnd(); drawId = -1; drawType = ''; }
    if (pointers.size === 1) { mode = 'pan'; panLast = [...pointers.values()][0]; }
    else if (pointers.size === 0) { mode = 'none'; }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = rel(e);
    zoomAt(cam, p.x, p.y, Math.exp(-e.deltaY * 0.0015), opts.minScale, opts.maxScale);
    opts.onChange();
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function isField(t: EventTarget | null): boolean {
  return !!(t && (t as HTMLElement).matches && (t as HTMLElement).matches('input,textarea,select'));
}
