// Vector features in normalized world coords (u in [0,1], v in [0,vMax]).
export interface Vec2 { u: number; v: number; }
export type LineKind = 'river' | 'road' | 'border';
export interface Line { id: number; kind: LineKind; color: string; pts: Vec2[]; }
export interface Label { id: number; at: Vec2; text: string; size: number; }
export interface Town { id: number; at: Vec2; name: string; size: number; }

export interface VectorData { lines: Line[]; labels: Label[]; towns: Town[]; }

// Distance from point p to segment a-b (same units as inputs).
export function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.u - a.u, dy = b.v - a.v;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.u - a.u) * dx + (p.v - a.v) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.u - (a.u + t * dx), p.v - (a.v + t * dy));
}
export function distToPolyline(p: Vec2, pts: Vec2[]): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.u - pts[0].u, p.v - pts[0].v);
  let m = Infinity;
  for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, segDist(p, pts[i], pts[i + 1]));
  return m;
}

type Action =
  | { t: 'addLine'; item: Line }
  | { t: 'addLabel'; item: Label }
  | { t: 'addTown'; item: Town }
  | { t: 'remove'; what: 'line' | 'label' | 'town'; index: number; item: Line | Label | Town };

export class VectorStore {
  lines: Line[] = [];
  labels: Label[] = [];
  towns: Town[] = [];
  temp: Line | null = null;
  private id = 1;
  private undoStack: Action[] = [];
  private redoStack: Action[] = [];

  beginLine(kind: LineKind, color: string, p: Vec2): void {
    this.temp = { id: this.id++, kind, color, pts: [{ u: p.u, v: p.v }] };
  }
  appendPoint(p: Vec2, minDist: number): void {
    if (!this.temp) return;
    const last = this.temp.pts[this.temp.pts.length - 1];
    if (Math.hypot(p.u - last.u, p.v - last.v) >= minDist) this.temp.pts.push({ u: p.u, v: p.v });
  }
  endLine(): boolean {
    const l = this.temp; this.temp = null;
    if (!l || l.pts.length < 2) return false;
    this.lines.push(l);
    this.record({ t: 'addLine', item: l });
    return true;
  }
  cancelLine(): void { this.temp = null; }

  addLabel(at: Vec2, text: string, size: number): void {
    const item: Label = { id: this.id++, at: { ...at }, text, size };
    this.labels.push(item); this.record({ t: 'addLabel', item });
  }
  addTown(at: Vec2, name: string, size: number): void {
    const item: Town = { id: this.id++, at: { ...at }, name, size };
    this.towns.push(item); this.record({ t: 'addTown', item });
  }

  // Remove the nearest feature within threshold; returns true if something was removed.
  removeAt(p: Vec2, thr: number): boolean {
    let best: { d: number; what: 'line' | 'label' | 'town'; index: number } | null = null;
    const consider = (d: number, what: 'line' | 'label' | 'town', index: number) => {
      if (d < thr && (!best || d < best.d)) best = { d, what, index };
    };
    this.labels.forEach((l, i) => consider(Math.hypot(p.u - l.at.u, p.v - l.at.v), 'label', i));
    this.towns.forEach((l, i) => consider(Math.hypot(p.u - l.at.u, p.v - l.at.v), 'town', i));
    this.lines.forEach((l, i) => consider(distToPolyline(p, l.pts), 'line', i));
    if (!best) return false;
    const b = best as { d: number; what: 'line' | 'label' | 'town'; index: number };
    const arr = this.arr(b.what);
    const item = arr.splice(b.index, 1)[0];
    this.record({ t: 'remove', what: b.what, index: b.index, item });
    return true;
  }

  private arr(what: 'line' | 'label' | 'town'): (Line | Label | Town)[] {
    return what === 'line' ? this.lines : what === 'label' ? this.labels : this.towns;
  }
  private record(a: Action): void {
    this.undoStack.push(a);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  private removeById(arr: { id: number }[], id: number): void {
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) arr.splice(i, 1);
  }

  undo(): boolean {
    const a = this.undoStack.pop();
    if (!a) return false;
    if (a.t === 'addLine') this.removeById(this.lines, a.item.id);
    else if (a.t === 'addLabel') this.removeById(this.labels, a.item.id);
    else if (a.t === 'addTown') this.removeById(this.towns, a.item.id);
    else this.arr(a.what).splice(a.index, 0, a.item);
    this.redoStack.push(a);
    return true;
  }
  redo(): boolean {
    const a = this.redoStack.pop();
    if (!a) return false;
    if (a.t === 'addLine') this.lines.push(a.item);
    else if (a.t === 'addLabel') this.labels.push(a.item);
    else if (a.t === 'addTown') this.towns.push(a.item);
    else this.removeById(this.arr(a.what) as { id: number }[], (a.item as { id: number }).id);
    this.undoStack.push(a);
    return true;
  }

  // Return a stable snapshot. Encoding can be asynchronous (gzip/IndexedDB), so exposing the
  // live arrays here could let edits made during a save leak into an older project snapshot.
  toJSON(): VectorData {
    return {
      lines: this.lines.map((line) => ({ ...line, pts: line.pts.map((p) => ({ ...p })) })),
      labels: this.labels.map((label) => ({ ...label, at: { ...label.at } })),
      towns: this.towns.map((town) => ({ ...town, at: { ...town.at } })),
    };
  }
  load(d: VectorData): void {
    this.lines = d.lines || []; this.labels = d.labels || []; this.towns = d.towns || [];
    this.undoStack = []; this.redoStack = []; this.temp = null;
    this.id = 1 + Math.max(0, ...this.lines.map((x) => x.id), ...this.labels.map((x) => x.id), ...this.towns.map((x) => x.id));
  }
}
