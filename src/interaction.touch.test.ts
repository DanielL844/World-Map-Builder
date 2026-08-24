import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Camera } from './camera';
import { attachInteraction, type InteractionOptions } from './interaction';

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

function touch(pointerId: number, clientX: number, clientY: number): PointerEvent {
  return {
    pointerId, pointerType: 'touch', clientX, clientY, button: 0, pressure: 0.5,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
}

function options(overrides: Partial<InteractionOptions> = {}): InteractionOptions {
  return {
    minScale: () => 1,
    maxScale: () => 1000,
    captures: () => true,
    fingerDraw: () => true,
    onPaintStart: vi.fn(),
    onPaintMove: vi.fn(),
    onPaintEnd: vi.fn(),
    onChange: vi.fn(),
    onHover: vi.fn(),
    ...overrides,
  };
}

function setup(overrides: Partial<InteractionOptions> = {}) {
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  const { canvas, emit } = fakeCanvas();
  const opts = options(overrides);
  const cam: Camera = { x: 0, y: 0, scale: 100 };
  attachInteraction(canvas, cam, opts);
  return { emit, opts, cam };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('touch painting vs pinch', () => {
  it('never paints when a second finger starts a pinch', () => {
    const { emit, opts, cam } = setup();

    emit('pointerdown', touch(1, 100, 100));
    emit('pointerdown', touch(2, 200, 100)); // pinch begins ~immediately
    emit('pointermove', touch(1, 80, 100));
    emit('pointermove', touch(2, 220, 100));
    vi.advanceTimersByTime(1000);
    emit('pointerup', touch(1, 80, 100));
    emit('pointerup', touch(2, 220, 100));

    expect(opts.onPaintStart).not.toHaveBeenCalled();
    expect(opts.onPaintMove).not.toHaveBeenCalled();
    expect(cam.scale).not.toBe(100); // the pinch still zoomed
  });

  it('does not paint mid-pinch even when the second finger is slow to land', () => {
    const { emit, opts } = setup();

    emit('pointerdown', touch(1, 100, 100));
    vi.advanceTimersByTime(60);           // still inside the hold window
    emit('pointerdown', touch(2, 200, 100));
    vi.advanceTimersByTime(1000);

    expect(opts.onPaintStart).not.toHaveBeenCalled();
  });

  it('starts a stroke once a finger holds still past the delay', () => {
    const { emit, opts } = setup();

    emit('pointerdown', touch(1, 100, 100));
    expect(opts.onPaintStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(opts.onPaintStart).toHaveBeenCalledOnce();

    emit('pointermove', touch(1, 120, 100));
    expect(opts.onPaintMove).toHaveBeenCalledOnce();
    emit('pointerup', touch(1, 120, 100));
    expect(opts.onPaintEnd).toHaveBeenCalledOnce();
  });

  it('starts immediately once the finger travels, without waiting out the delay', () => {
    const { emit, opts } = setup();

    emit('pointerdown', touch(1, 100, 100));
    emit('pointermove', touch(1, 130, 100)); // past the slop threshold
    expect(opts.onPaintStart).toHaveBeenCalledOnce();
    expect(opts.onPaintMove).toHaveBeenCalledOnce();

    // The stroke is anchored where the finger landed, not where it was noticed.
    const start = (opts.onPaintStart as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(start.u).toBeCloseTo(1);
  });

  it('still registers a quick tap as one dab', () => {
    const { emit, opts } = setup();

    emit('pointerdown', touch(1, 100, 100));
    emit('pointerup', touch(1, 100, 100)); // lifts well before the hold expires

    expect(opts.onPaintStart).toHaveBeenCalledOnce();
    expect(opts.onPaintEnd).toHaveBeenCalledOnce();
  });

  it('drops the stroke when the OS cancels the touch', () => {
    const { emit, opts } = setup();

    emit('pointerdown', touch(1, 100, 100));
    emit('pointercancel', touch(1, 100, 100));
    vi.advanceTimersByTime(1000);

    expect(opts.onPaintStart).not.toHaveBeenCalled();
  });

  it('leaves the finger free to pan when finger-draw is off', () => {
    const { emit, opts, cam } = setup({ fingerDraw: () => false });

    emit('pointerdown', touch(1, 100, 100));
    emit('pointermove', touch(1, 140, 100));
    vi.advanceTimersByTime(1000);

    expect(opts.onPaintStart).not.toHaveBeenCalled();
    expect(cam.x).toBe(40);
  });
});
