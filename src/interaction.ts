import { type Camera, screenToWorld, zoomAt, clamp } from './camera';

export interface PaintInfo { u: number; v: number; pressure: number; }

export interface InteractionOptions {
  minScale: () => number;
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

  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isInteractive(e.target)) { space = true; e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') space = false; });
  window.addEventListener('blur', () => { space = false; });

  const rel = (e: MouseEvent): P => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 1);
  const toUV = (p: P) => screenToWorld(cam, p.x, p.y);
  const beginPinch = () => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) { pinch = null; return; }
    const m = mid(a, b);
    // Coincident contacts can occur briefly when a second touch lands. A small
    // non-zero baseline prevents that frame from jumping straight to max zoom.
    pinch = { d: Math.max(dist(a, b), 0.5), w: screenToWorld(cam, m.x, m.y), s: cam.scale };
    mode = 'pinch';
  };

  canvas.addEventListener('pointerdown', (e) => {
    const p = rel(e);
    // palm rejection: ignore touches while a pen is painting
    if (mode === 'paint' && drawType === 'pen' && e.pointerType !== 'pen') return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, p);

    if (pointers.size >= 2) {
      if (mode === 'paint') {
        opts.onPaintEnd();
        drawId = -1; drawType = '';
      }
      beginPinch();
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

    if (mode === 'pinch' && pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const m = mid(a, b);
      cam.scale = clamp(pinch.s * (dist(a, b) / pinch.d), opts.minScale(), opts.maxScale);
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
    // Camera movement above must happen first or the coordinate readout lags a
    // pan by one event (and remains wrong after the pointer is released).
    opts.onHover(p.x, p.y);
  });

  const end = (e: PointerEvent) => {
    // Palm-rejected touches were never tracked. Letting their pointerup enter
    // the state machine would turn an active pen stroke into a pan mid-stroke.
    if (!pointers.has(e.pointerId)) return;
    const wasPaint = mode === 'paint' && e.pointerId === drawId;
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (wasPaint) { opts.onPaintEnd(); drawId = -1; drawType = ''; }
    if (pointers.size >= 2) beginPinch();
    else if (pointers.size === 1) { mode = 'pan'; panLast = [...pointers.values()][0]; pinch = null; }
    else if (pointers.size === 0) { mode = 'none'; pinch = null; }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = rel(e);
    const deltaPx = wheelDeltaPixels(e.deltaY, e.deltaMode, canvas.clientHeight);
    zoomAt(cam, p.x, p.y, Math.exp(-deltaPx * 0.0015), opts.minScale(), opts.maxScale);
    opts.onChange();
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function wheelDeltaPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, pageHeight) : 1;
  return deltaY * unit;
}

function isInteractive(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el?.closest?.('input,textarea,select,button,a[href],[contenteditable="true"]');
}
