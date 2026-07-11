import { afterEach, describe, expect, it, vi } from 'vitest';
import { screenToWorld, type Camera } from './camera';
import { attachInteraction, wheelDeltaPixels, type InteractionOptions } from './interaction';

type Handler = (event: unknown) => void;

function fakeCanvas(): { canvas: HTMLCanvasElement; emit: (type: string, event: unknown) => void } {
  const handlers = new Map<string, Handler[]>();
  const el = {
    clientHeight: 600,
    addEventListener(type: string, handler: Handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler); handlers.set(type, list);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };
  return {
    canvas: el as unknown as HTMLCanvasElement,
    emit: (type, event) => { for (const handler of handlers.get(type) ?? []) handler(event); },
  };
}

function pointer(pointerId: number, pointerType: string, clientX: number, clientY: number): PointerEvent {
  return {
    pointerId, pointerType, clientX, clientY, button: 0, pressure: 0.5,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
}

function options(overrides: Partial<InteractionOptions> = {}): InteractionOptions {
  return {
    minScale: () => 1,
    maxScale: 1000,
    captures: () => false,
    fingerDraw: () => false,
    onPaintStart: vi.fn(),
    onPaintMove: vi.fn(),
    onPaintEnd: vi.fn(),
    onChange: vi.fn(),
    onHover: vi.fn(),
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('interaction', () => {
  it('does not let a palm-rejected touch end or derail an active pen stroke', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn() });
    const { canvas, emit } = fakeCanvas();
    const opts = options({ captures: () => true });
    const cam: Camera = { x: 0, y: 0, scale: 100 };
    attachInteraction(canvas, cam, opts);

    emit('pointerdown', pointer(1, 'pen', 10, 10));
    emit('pointerdown', pointer(2, 'touch', 12, 12));
    emit('pointerup', pointer(2, 'touch', 12, 12));
    emit('pointermove', pointer(1, 'pen', 20, 20));

    expect(opts.onPaintMove).toHaveBeenCalledOnce();
    expect(opts.onPaintEnd).not.toHaveBeenCalled();

    emit('pointerup', pointer(1, 'pen', 20, 20));
    expect(opts.onPaintEnd).toHaveBeenCalledOnce();
  });

  it('reports hover coordinates after applying a pan', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn() });
    const { canvas, emit } = fakeCanvas();
    const cam: Camera = { x: 0, y: 0, scale: 100 };
    let hoverU = NaN;
    const opts = options({ onHover: (sx, sy) => { hoverU = screenToWorld(cam, sx, sy).u; } });
    attachInteraction(canvas, cam, opts);

    emit('pointerdown', pointer(1, 'mouse', 10, 10));
    emit('pointermove', pointer(1, 'mouse', 20, 20));

    expect(cam.x).toBe(10);
    expect(hoverU).toBeCloseTo(0.1);
  });

  it('normalizes wheel line and page deltas to pixels', () => {
    expect(wheelDeltaPixels(3, 0, 800)).toBe(3);
    expect(wheelDeltaPixels(3, 1, 800)).toBe(48);
    expect(wheelDeltaPixels(1, 2, 800)).toBe(800);
  });
});
