import './style.css';
import { createGL } from './gl';
import { Terrain } from './terrain';
import { type Camera, screenToWorld, clamp } from './camera';
import { attachInteraction } from './interaction';
import { Hud } from './hud';
import { Toolbar } from './toolbar';
import { EditLayer } from './editlayer';
import { BiomeLayer } from './biomelayer';
import { BIOMES } from './biome';
import { TileLayer } from './tilelayer';
import { levelForScale, TILE } from './tilestore';
import { generatePreset, type PresetKind } from './presets';
import { generatePlanet } from './planet';
import { Overlay } from './overlay';
import { VectorStore, type LineKind } from './vectors';
import { showTextModal } from './modal';
import { Menu } from './menu';
import { encodeProject, decodeProject, idb, type ProjectData } from './storage';
import { tools, isBrush, isLineTool, isDrawTool } from './tools';
import { registerPwaUpdates } from './pwa';
import { LatestTaskQueue } from './latestTaskQueue';

const WORLD = { widthKm: 4000, heightKm: 2500 };
let vMax = WORLD.heightKm / WORLD.widthKm;
const EDIT_TEXELS = 4096;
const BIOME_TEXELS = 2048;
const BASE_LAND = 0.5; // default flat-plain height (blank canvas)
const EXPORT_MAX = 4096;

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const IDLE_DPR = Math.min(window.devicePixelRatio || 1, 1.75);
const MOTION_DPR = Math.min(window.devicePixelRatio || 1, 1.0);
let dynDPR = IDLE_DPR; // adaptive: low while interacting (smooth), high when idle (crisp)
let motionTimer = 0;
function markMoving(): void {
  dynDPR = MOTION_DPR;
  clearTimeout(motionTimer);
  motionTimer = window.setTimeout(() => { dynDPR = IDLE_DPR; requestRender(); }, 150);
}

let gl: WebGL2RenderingContext;
let terrain: Terrain;
let edit: EditLayer;
let biome: BiomeLayer;
let overlay: Overlay;
let tileLayer: TileLayer;
try {
  gl = createGL(canvas);
  terrain = new Terrain(gl);
  edit = new EditLayer(gl, EDIT_TEXELS, vMax);
  biome = new BiomeLayer(gl, BIOME_TEXELS, vMax);
  overlay = new Overlay();
  tileLayer = new TileLayer(gl);
} catch (err) { showError((err as Error).message); throw err; }
const vectors = new VectorStore();

const cam: Camera = { x: 0, y: 0, scale: 1 };
let hoverU = 0.5, hoverV = vMax / 2, hoverSX = -1, hoverSY = -1;
const maxScale = 256 * Math.pow(2, 12);
function minimumScale(): number { return Math.min(window.innerWidth, window.innerHeight / vMax) * 0.4; }
function fit(): void {
  const s = Math.min(window.innerWidth, window.innerHeight / vMax) * 0.9;
  cam.scale = s; cam.x = (window.innerWidth - s) / 2; cam.y = (window.innerHeight - s * vMax) / 2;
}

const hud = new Hud(WORLD.widthKm, () => { requestRender(); autosave(); });
const menu = new Menu({
  getWorld: () => ({ widthKm: WORLD.widthKm, heightKm: WORLD.heightKm }),
  onApplyWorld: applyWorld,
  onSave: () => { void saveFile(); },
  onLoad: (f) => { void loadFile(f); },
  onExport: exportPNG,
  onExportWorld: exportWorldPNG,
  onPreset: applyPreset,
  onPlanet: applyPlanet,
  onNew: newWorld,
});
const toolbar = new Toolbar({
  onMenu: () => menu.open(),
  onToolChange: () => { updateCursor(); requestRender(); },
  onUndo: doUndo, onRedo: doRedo,
});

// ---- unified undo ----
type Layer = 'height' | 'tiles' | 'biome' | 'vector';
const actionLog: Layer[] = [];
const redoLog: Layer[] = [];
function record(layer: Layer): void { actionLog.push(layer); redoLog.length = 0; syncUndo(); autosave(); }
function syncUndo(): void { toolbar.setUndoState(actionLog.length > 0, redoLog.length > 0); }
function undoLayer(l: Layer): boolean { return l === 'height' ? edit.undo() : l === 'tiles' ? tileLayer.undo() : l === 'biome' ? biome.undo() : vectors.undo(); }
function redoLayer(l: Layer): boolean { return l === 'height' ? edit.redo() : l === 'tiles' ? tileLayer.redo() : l === 'biome' ? biome.redo() : vectors.redo(); }
function doUndo(): void { const a = actionLog.pop(); if (!a) return; if (undoLayer(a)) redoLog.push(a); syncUndo(); requestRender(); autosave(); }
function doRedo(): void { const a = redoLog.pop(); if (!a) return; if (redoLayer(a)) actionLog.push(a); syncUndo(); requestRender(); autosave(); }

// ---- drawing ----
let drawMode: 'none' | 'height' | 'biome' | 'line' = 'none';
let lastU = 0, lastV = 0;
let heightTarget: 'edit' | 'tiles' = 'edit';   // where the current sculpt stroke writes
let strokeLevel = 0;                            // tile level for a deep stroke
// Detail level from a STABLE scale (not the adaptive render DPR) so the level a stroke paints
// into always matches the level the compositor draws, with no DPR-jitter mismatch.
function detailLevel(): number { return levelForScale(cam.scale * DPR, tileLayer.maxLevel); }
// Smallest non-negative level L whose TILE*2^L grid is finer than the live region field.
// edit.W can shrink on tall worlds or GPUs with a lower MAX_TEXTURE_SIZE.
function deepMinLevel(): number { return Math.max(0, Math.floor(Math.log2(edit.W / TILE)) + 1); }
function stampHeight(u: number, v: number, pressure: number): void {
  const rU = tools.brushPx / cam.scale;
  const amount = (0.0035 + tools.strength * 0.02) * pressure, rate = 0.12 + tools.strength * 0.5;
  if (heightTarget === 'tiles') tileLayer.paintHeightDab(tools.tool, u, v, rU, amount, rate, strokeLevel, vMax);
  else edit.dab(tools.tool, u, v, rU, amount, rate);
}
function stampBiome(u: number, v: number, pressure: number): void {
  const rU = tools.brushPx / cam.scale;
  const color = tools.biome < 0 ? null : BIOMES[tools.biome].color;
  biome.dab(color, u, v, rU, (0.15 + tools.strength * 0.5) * pressure);
}
function interp(p: { u: number; v: number; pressure: number }, fn: (u: number, v: number, pr: number) => void): void {
  const rU = tools.brushPx / cam.scale, step = Math.max(rU * 0.3, 1e-5);
  const d = Math.hypot(p.u - lastU, p.v - lastV), n = Math.min(256, Math.floor(d / step));
  for (let i = 1; i <= n; i++) { const t = i / n; fn(lastU + (p.u - lastU) * t, lastV + (p.v - lastV) * t, p.pressure); }
  fn(p.u, p.v, p.pressure); lastU = p.u; lastV = p.v;
}

attachInteraction(canvas, cam, {
  minScale: minimumScale, maxScale,
  captures: () => isDrawTool(tools.tool),
  fingerDraw: () => tools.fingerDraw,
  onPaintStart: (p) => {
    const t = tools.tool;
    if (isBrush(t)) {
      drawMode = 'height';
      const L = detailLevel();
      if (L >= deepMinLevel() && tileLayer.ok) { heightTarget = 'tiles'; strokeLevel = L; tileLayer.beginStroke(); }
      else { heightTarget = 'edit'; edit.beginStroke(); }
      lastU = p.u; lastV = p.v; stampHeight(p.u, p.v, p.pressure);
    }
    else if (t === 'biome') { drawMode = 'biome'; biome.beginStroke(); lastU = p.u; lastV = p.v; stampBiome(p.u, p.v, p.pressure); }
    else if (isLineTool(t)) { drawMode = 'line'; vectors.beginLine(t as LineKind, tools.borderColor, p); }
    else if (t === 'label') { void placeText('label', p); }
    else if (t === 'town') { void placeText('town', p); }
    else if (t === 'erase') { if (vectors.removeAt(p, 14 / cam.scale)) record('vector'); }
    requestRender();
  },
  onPaintMove: (p) => {
    if (drawMode === 'height') interp(p, stampHeight);
    else if (drawMode === 'biome') interp(p, stampBiome);
    else if (drawMode === 'line') vectors.appendPoint(p, 2.5 / cam.scale);
    if (drawMode !== 'none') { markMoving(); requestRender(); }
  },
  onPaintEnd: () => {
    if (drawMode === 'height') {
      if (heightTarget === 'tiles') { if (tileLayer.endStroke()) record('tiles'); }
      else if (edit.endStroke()) record('height');
    }
    else if (drawMode === 'biome') { if (biome.endStroke()) record('biome'); }
    else if (drawMode === 'line') { if (vectors.endLine()) record('vector'); }
    drawMode = 'none'; requestRender();
  },
  onChange: () => { markMoving(); requestRender(); },
  onHover: (sx, sy) => { hoverSX = sx; hoverSY = sy; const w = screenToWorld(cam, sx, sy); hoverU = w.u; hoverV = w.v; requestOverlay(); },
});
canvas.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') { hoverSX = -1; requestRender(); } });

async function placeText(kind: 'label' | 'town', p: { u: number; v: number }): Promise<void> {
  const text = await showTextModal(kind === 'town' ? 'Town name' : 'Label');
  if (!text) return;
  if (kind === 'town') vectors.addTown(p, text, 14); else vectors.addLabel(p, text, 16);
  record('vector'); requestRender();
}

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && t.matches && t.matches('input,textarea,select')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
  else if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); doRedo(); }
});

// ---- project / persistence ----
function currentProject(): ProjectData {
  return {
    version: 1, world: { widthKm: WORLD.widthKm, heightKm: WORLD.heightKm }, sea: hud.sea, relief: hud.relief,
    view: { x: cam.x, y: cam.y, scale: cam.scale }, vectors: vectors.toJSON(),
    edit: edit.serialize(), biome: biome.serialize(), tiles: tileLayer.serialize(),
  };
}
let saveTimer = 0;
let persistenceReady = false;
function autosave(): void {
  if (!persistenceReady) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => { void doAutosave(); }, { timeout: 4000 });
    else void doAutosave();
  }, 2000);
}
let saveWorker: Worker | null = null;
const fallbackSaves = new LatestTaskQueue<ProjectData>(
  async (project) => { await idb.set('autosave', await encodeProject(project)); },
  (error) => { console.warn('autosave failed', error); },
);
try { saveWorker = new Worker(new URL('./autosaveWorker.ts', import.meta.url), { type: 'module' }); } catch { saveWorker = null; }
saveWorker?.addEventListener('error', (event) => {
  console.warn('autosave worker failed; using the main thread', event);
  const failedWorker = saveWorker; saveWorker = null; failedWorker?.terminate();
  flushAutosave();
});
async function doAutosave(): Promise<void> {
  if (!persistenceReady) return;
  try {
    if (saveWorker) {
      const e = edit.floatCopy();
      const b = biome.serialize();
      const t = tileLayer.serialize();
      saveWorker.postMessage(
        { world: { widthKm: WORLD.widthKm, heightKm: WORLD.heightKm }, sea: hud.sea, relief: hud.relief,
          view: { x: cam.x, y: cam.y, scale: cam.scale }, vectors: vectors.toJSON(), edit: e, biome: b, tiles: t },
        [e.data.buffer, b.data.buffer, t.coords.buffer, t.data.buffer]);
    } else fallbackSaves.enqueue(currentProject());
  } catch (e) { console.warn('autosave failed', e); }
}
function flushAutosave(): void {
  if (!persistenceReady) return;
  clearTimeout(saveTimer); saveTimer = 0;
  void doAutosave();
}

function restore(p: ProjectData): void {
  WORLD.widthKm = p.world.widthKm; WORLD.heightKm = p.world.heightKm; vMax = WORLD.heightKm / WORLD.widthKm;
  edit.dispose(); edit = new EditLayer(gl, EDIT_TEXELS, vMax); edit.loadInt16(p.edit.height, p.edit.w, p.edit.h);
  biome.dispose(); biome = new BiomeLayer(gl, BIOME_TEXELS, vMax);
  if (p.biome && p.biome.data.length > 0) biome.loadBytes(p.biome.data, p.biome.w, p.biome.h);
  tileLayer.clear();
  if (p.tiles && p.tiles.coords.length) tileLayer.loadTiles(p.tiles.coords, p.tiles.data);
  vectors.load(p.vectors);
  hud.setWidthKm(WORLD.widthKm); hud.setSeaRelief(p.sea, p.relief);
  if (p.view) { cam.x = p.view.x; cam.y = p.view.y; cam.scale = p.view.scale; } else fit();
  actionLog.length = 0; redoLog.length = 0; syncUndo(); requestRender();
}
function applyWorld(wKm: number, hKm: number): void {
  const oldE = edit.serialize(), oldB = biome.serialize();
  const oldVMax = vMax, hadDeepEdits = tileLayer.hasEdits();
  WORLD.widthKm = Math.max(1, wKm); WORLD.heightKm = Math.max(1, hKm); vMax = WORLD.heightKm / WORLD.widthKm;
  edit.dispose(); edit = new EditLayer(gl, EDIT_TEXELS, vMax); edit.loadInt16(oldE.height, oldE.w, oldE.h);
  biome.dispose(); biome = new BiomeLayer(gl, BIOME_TEXELS, vMax); biome.loadBytes(oldB.data, oldB.w, oldB.h);
  const sameAspect = Math.abs(vMax - oldVMax) <= Number.EPSILON * Math.max(1, Math.abs(vMax), Math.abs(oldVMax));
  if (!sameAspect) tileLayer.clear();
  actionLog.length = 0; redoLog.length = 0; syncUndo();
  hud.setWidthKm(WORLD.widthKm); fit(); requestRender(); autosave();
  toast(!sameAspect && hadDeepEdits ? 'World resized; deep sculpt detail reset' : 'World resized');
}
function newWorld(): void {
  edit.dispose(); edit = new EditLayer(gl, EDIT_TEXELS, vMax);
  biome.dispose(); biome = new BiomeLayer(gl, BIOME_TEXELS, vMax);
  vectors.load({ lines: [], labels: [], towns: [] });
  tileLayer.clear();
  actionLog.length = 0; redoLog.length = 0; syncUndo(); fit(); requestRender(); autosave(); toast('New world');
}
function applyPreset(kind: PresetKind): void {
  const fld = generatePreset(edit.W, edit.H, vMax, kind, (Math.random() * 1e9) | 0, BASE_LAND);
  edit.setData(fld);
  tileLayer.clear();
  actionLog.length = 0; redoLog.length = 0; syncUndo(); requestRender(); autosave();
  toast(kind === 'flat' ? 'Flat plain' : kind === 'islands' ? 'Islands' : 'Continents');
}
const PLANET_KM = 40000; // ~Earth circumference; a whole planet, equirectangular (sphere 2:1)
function applyPlanet(): Promise<void> {
  toast('Generating planet…');
  return new Promise((resolve) => window.setTimeout(() => {
    WORLD.widthKm = PLANET_KM; WORLD.heightKm = PLANET_KM / 2; vMax = 0.5; // poles at top/bottom edges
    edit.dispose(); edit = new EditLayer(gl, EDIT_TEXELS, vMax);
    biome.dispose(); biome = new BiomeLayer(gl, BIOME_TEXELS, vMax);
    const bw = biome.W, bh = biome.H;
    const p = generatePlanet(edit.W, edit.H, bw, bh, vMax, (Math.random() * 1e9) | 0, BASE_LAND, { seaLevel: hud.sea });
    edit.setData(p.height);
    biome.loadBytes(p.biome, bw, bh);
    tileLayer.clear();
    vectors.load({ lines: [], labels: [], towns: [] });
    hud.setWidthKm(WORLD.widthKm);
    actionLog.length = 0; redoLog.length = 0; syncUndo(); fit(); requestRender(); autosave();
    toast('Generated planet');
    resolve();
  }, 30));
}
async function saveFile(): Promise<void> { download(new Blob([await encodeProject(currentProject())], { type: 'application/json' }), 'worldmap.wfmap.json'); toast('Saved'); }
async function loadFile(file: File): Promise<void> { try { restore(await decodeProject(await file.text())); autosave(); toast('Loaded'); } catch (e) { console.warn(e); toast('Could not read file'); } }

function exportPNG(): void {
  frame();
  const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
  const c = out.getContext('2d'); if (!c) return;
  // The GL canvas renders at adaptive dynDPR while the overlay stays at fixed DPR; scale both
  // to the output size or the vector overlay lands shrunken/misaligned in the export.
  c.drawImage(canvas, 0, 0, out.width, out.height);
  c.drawImage(overlay.el(), 0, 0, out.width, out.height);
  out.toBlob((b) => { if (b) { download(b, 'worldmap.png'); toast('Exported view'); } }, 'image/png');
}
// Render the whole world (not just the current view) at high resolution.
function exportWorldPNG(): void {
  let ew: number, eh: number;
  if (vMax <= 1) { ew = EXPORT_MAX; eh = Math.max(1, Math.round(EXPORT_MAX * vMax)); }
  else { eh = EXPORT_MAX; ew = Math.max(1, Math.round(EXPORT_MAX / vMax)); }
  const savW = canvas.width, savH = canvas.height;
  canvas.width = ew; canvas.height = eh;
  edit.flush(); biome.flush(); tileLayer.flush();
  // Bake deep-tile edits into the whole-world export too (scale = ew maps u:[0,1] -> [0,ew] px);
  // composite redirects the viewport to its accum FBO, so point it back at the canvas after.
  tileLayer.composite(0, 0, ew, ew, eh, vMax, levelForScale(ew, tileLayer.maxLevel));
  gl.viewport(0, 0, ew, eh);
  terrain.draw([0, 0], ew, [ew, eh], hud.sea, hud.relief, edit.texture(), biome.texture(), vMax, tileLayer.texture(), tileLayer.ok && tileLayer.texture() !== null, BASE_LAND);
  const out = document.createElement('canvas'); out.width = ew; out.height = eh;
  const c = out.getContext('2d');
  if (c) {
    c.drawImage(canvas, 0, 0);
    overlay.resize(ew, eh, 1);
    overlay.draw(vectors, { x: 0, y: 0, scale: ew }, vMax, WORLD.widthKm, null);
    c.drawImage(overlay.el(), 0, 0);
  }
  canvas.width = savW; canvas.height = savH;
  overlay.resize(window.innerWidth, window.innerHeight, DPR);
  frame();
  if (c) out.toBlob((b) => { if (b) { download(b, 'worldmap-full.png'); toast('Exported full world'); } }, 'image/png');
}
function download(blob: Blob, name: string): void {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}

// ---- render ----
function clampView(): void {
  const cw = window.innerWidth, ch = window.innerHeight;
  const scale = clamp(cam.scale, minimumScale(), maxScale);
  if (scale !== cam.scale) {
    const center = screenToWorld(cam, cw / 2, ch / 2);
    cam.scale = scale;
    cam.x = cw / 2 - center.u * scale; cam.y = ch / 2 - center.v * scale;
  }
  const sw = cam.scale, sh = cam.scale * vMax, fx = 0.35;
  const minX = cw * (1 - fx) - sw, maxX = cw * fx; cam.x = minX > maxX ? (cw - sw) / 2 : clamp(cam.x, minX, maxX);
  const minY = ch * (1 - fx) - sh, maxY = ch * fx; cam.y = minY > maxY ? (ch - sh) / 2 : clamp(cam.y, minY, maxY);
}
let pending = false;
let lastFrameT = 0;
const perfEl = document.createElement('div');
perfEl.id = 'perf';
perfEl.style.cssText ='position:fixed;left:10px;bottom:10px;z-index:7;background:rgba(11,15,20,.6);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:3px 8px;font:11px ui-monospace,monospace;color:#9fe6b0;pointer-events:none';
document.body.appendChild(perfEl);
function requestRender(): void { pendingOverlay = false; if (!pending) { pending = true; requestAnimationFrame(frame); } }
let pendingOverlay = false;
function requestOverlay(): void { if (pending || pendingOverlay) return; pendingOverlay = true; requestAnimationFrame(overlayFrame); }
function overlayFrame(): void {
  if (!pendingOverlay) return;
  pendingOverlay = false;
  overlay.resize(window.innerWidth, window.innerHeight, DPR);
  const showRing = (isBrush(tools.tool) || tools.tool === 'biome') && hoverSX >= 0;
  overlay.draw(vectors, cam, vMax, WORLD.widthKm, showRing ? { x: hoverSX, y: hoverSY, r: tools.brushPx } : null);
  hud.update(cam, hoverU, hoverV);
}
function frame(): void {
  const _t0 = performance.now();
  pending = false; clampView();
  if (hoverSX >= 0) {
    const hover = screenToWorld(cam, hoverSX, hoverSY);
    hoverU = hover.u; hoverV = hover.v;
  }
  const cw = window.innerWidth, ch = window.innerHeight, w = Math.round(cw * dynDPR), h = Math.round(ch * dynDPR);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px'; }
  overlay.resize(cw, ch, DPR);
  edit.flush(); biome.flush(); tileLayer.flush();
  tileLayer.composite(cam.x * dynDPR, cam.y * dynDPR, cam.scale * dynDPR, w, h, vMax, detailLevel());
  gl.viewport(0, 0, w, h);
  terrain.draw([cam.x * dynDPR, cam.y * dynDPR], cam.scale * dynDPR, [w, h], hud.sea, hud.relief, edit.texture(), biome.texture(), vMax, tileLayer.texture(), tileLayer.ok && tileLayer.texture() !== null, BASE_LAND);
  const showRing = (isBrush(tools.tool) || tools.tool === 'biome') && hoverSX >= 0;
  overlay.draw(vectors, cam, vMax, WORLD.widthKm, showRing ? { x: hoverSX, y: hoverSY, r: tools.brushPx } : null);
  hud.update(cam, hoverU, hoverV);
  const _t1 = performance.now();
  const _iv = lastFrameT ? _t0 - lastFrameT : 16.7; lastFrameT = _t0;
  perfEl.textContent = (_t1 - _t0).toFixed(1) + ' ms js \u00b7 ~' + Math.round(1000 / Math.max(_iv, 1)) + ' fps';
}
function updateCursor(): void { canvas.style.cursor = isDrawTool(tools.tool) ? 'crosshair' : 'grab'; }

let toastT = 0;
function toast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = window.setTimeout(() => el?.classList.remove('show'), 1600);
}

window.addEventListener('resize', requestRender);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAutosave();
});
window.addEventListener('pagehide', flushAutosave);
fit(); updateCursor();
if (!edit.mipmaps) console.warn('EXT_color_buffer_float unavailable: sculpt footprint will be coarser when zoomed out.');
requestRender();
void initializeProject();

async function initializeProject(): Promise<void> {
  let restored = false;
  try {
    const saved = await idb.get('autosave');
    if (saved) {
      try { restore(await decodeProject(saved)); restored = true; }
      catch (e) { console.warn('restore failed', e); }
    }
  } catch (e) {
    console.warn('autosave lookup failed', e);
  }
  try {
    if (!restored) await applyPlanet();
  } finally {
    // Do not let a lifecycle flush overwrite an existing save with the blank startup fields
    // while IndexedDB/decompression is still restoring them.
    persistenceReady = true;
    autosave();
  }
}

registerPwaUpdates();

function showError(msg: string): void { const d = document.createElement('div'); d.className = 'fatal'; d.textContent = 'Could not start WorldForge: ' + msg; document.body.appendChild(d); }
