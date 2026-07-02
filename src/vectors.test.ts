import { describe, it, expect } from 'vitest';
import { VectorStore, segDist, distToPolyline } from './vectors';

describe('vector geometry', () => {
  it('segDist measures perpendicular distance', () => {
    expect(segDist({ u: 0, v: 1 }, { u: -1, v: 0 }, { u: 1, v: 0 })).toBeCloseTo(1);
    expect(segDist({ u: 2, v: 0 }, { u: -1, v: 0 }, { u: 1, v: 0 })).toBeCloseTo(1); // beyond endpoint
  });
  it('distToPolyline finds nearest segment', () => {
    const pts = [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }];
    expect(distToPolyline({ u: 0.5, v: 0.2 }, pts)).toBeCloseTo(0.2);
  });
});

describe('VectorStore', () => {
  it('commits a line only with >= 2 points', () => {
    const s = new VectorStore();
    s.beginLine('river', '#00f', { u: 0, v: 0 });
    expect(s.endLine()).toBe(false); // single point
    s.beginLine('river', '#00f', { u: 0, v: 0 });
    s.appendPoint({ u: 0.5, v: 0.5 }, 0.01);
    expect(s.endLine()).toBe(true);
    expect(s.lines.length).toBe(1);
  });
  it('erases the nearest feature and undo restores it', () => {
    const s = new VectorStore();
    s.addTown({ u: 0.2, v: 0.2 }, 'Town', 14);
    s.addLabel({ u: 0.8, v: 0.8 }, 'Far', 14);
    expect(s.removeAt({ u: 0.21, v: 0.205 }, 0.05)).toBe(true);
    expect(s.towns.length).toBe(0);
    expect(s.labels.length).toBe(1);
    s.undo();
    expect(s.towns.length).toBe(1);
  });
  it('undo/redo of an added line', () => {
    const s = new VectorStore();
    s.beginLine('road', '#caa', { u: 0, v: 0 }); s.appendPoint({ u: 1, v: 1 }, 0.01); s.endLine();
    expect(s.lines.length).toBe(1);
    expect(s.undo()).toBe(true); expect(s.lines.length).toBe(0);
    expect(s.redo()).toBe(true); expect(s.lines.length).toBe(1);
  });
});
