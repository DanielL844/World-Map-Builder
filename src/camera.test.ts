import { describe, it, expect } from 'vitest';
import { screenToWorld, worldToScreen, zoomAt, type Camera } from './camera';

describe('camera', () => {
  it('worldToScreen inverts screenToWorld', () => {
    const cam: Camera = { x: 120, y: -40, scale: 3.5 };
    const w = screenToWorld(cam, 200, 150);
    const s = worldToScreen(cam, w.u, w.v);
    expect(s.x).toBeCloseTo(200);
    expect(s.y).toBeCloseTo(150);
  });

  it('zoomAt keeps the cursor world point fixed', () => {
    const cam: Camera = { x: 0, y: 0, scale: 10 };
    const before = screenToWorld(cam, 300, 220);
    zoomAt(cam, 300, 220, 2.0, 0.1, 1e6);
    const after = screenToWorld(cam, 300, 220);
    expect(after.u).toBeCloseTo(before.u);
    expect(after.v).toBeCloseTo(before.v);
    expect(cam.scale).toBeCloseTo(20);
  });

  it('respects scale clamps', () => {
    const cam: Camera = { x: 0, y: 0, scale: 10 };
    zoomAt(cam, 0, 0, 100, 0.1, 50);
    expect(cam.scale).toBe(50);
  });
});
