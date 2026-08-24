import { tools, isBrush, type ToolId } from './tools';
import { BIOMES } from './biome';

interface ToolbarOptions {
  onMenu: () => void;
  onToolChange: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const GROUPS: { id: ToolId; label: string }[][] = [
  [{ id: 'raise', label: 'Raise' }, { id: 'lower', label: 'Lower' }, { id: 'smooth', label: 'Smooth' }, { id: 'flatten', label: 'Flatten' }, { id: 'biome', label: 'Biome' }],
  [{ id: 'river', label: 'River' }, { id: 'road', label: 'Road' }, { id: 'border', label: 'Border' }],
  [{ id: 'label', label: 'Label' }, { id: 'town', label: 'Town' }, { id: 'erase', label: 'Erase' }],
  [{ id: 'pan', label: 'Pan' }],
];
const BORDER_COLORS = ['#ffcf5a', '#ff6b6b', '#6bd1ff', '#9b8cff', '#ffffff', '#1a1a1a'];

// Brush size runs 2..400 screen px on a log scale. A linear slider spends almost all of its travel
// in sizes you rarely want and makes single-digit brushes impossible to hit on a phone; on a log
// scale each millimetre of travel is the same *proportional* change, so fine detail is reachable.
const SIZE_MIN = 2, SIZE_MAX = 400, SIZE_STEPS = 1000;
export function sliderToSize(v: number): number {
  const t = Math.max(0, Math.min(1, v / SIZE_STEPS));
  const px = SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, t);
  return px < 10 ? Math.round(px * 10) / 10 : Math.round(px);
}
export function sizeToSlider(px: number): number {
  const clamped = Math.max(SIZE_MIN, Math.min(SIZE_MAX, px));
  return Math.round(SIZE_STEPS * Math.log(clamped / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN));
}
// The response curve in main.ts is quadratic, so the slider floor can go much lower than the old
// 0.05 without the bottom of the travel becoming dead.
const STRENGTH_MIN = 0.02;

export class Toolbar {
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private brushPanel: HTMLElement;
  private borderPanel: HTMLElement;
  private biomePanel: HTMLElement;
  private buttons = new Map<ToolId, HTMLButtonElement>();
  private swatches: HTMLButtonElement[] = [];
  private biomeChips: HTMLButtonElement[] = [];

  constructor(opts: ToolbarOptions) {
    const top = document.createElement('div'); top.className = 'topbar';
    top.setAttribute('role', 'toolbar'); top.setAttribute('aria-label', 'Project controls');
    const menuBtn = button('☰', 'Menu', opts.onMenu);
    this.undoBtn = button('↶', 'Undo', opts.onUndo);
    this.redoBtn = button('↷', 'Redo', opts.onRedo);
    top.append(menuBtn, this.undoBtn, this.redoBtn);
    document.body.appendChild(top);

    const dock = document.createElement('div'); dock.className = 'dock';
    dock.setAttribute('role', 'toolbar'); dock.setAttribute('aria-label', 'Editing tools');
    GROUPS.forEach((group, gi) => {
      if (gi > 0) { const sep = document.createElement('div'); sep.className = 'sep'; dock.appendChild(sep); }
      for (const def of group) {
        const b = button(def.label, def.label, () => { tools.tool = def.id; this.refresh(); opts.onToolChange(); });
        b.classList.add('tool'); this.buttons.set(def.id, b); dock.appendChild(b);
      }
    });
    document.body.appendChild(dock);

    // Panels share one positioned stack. In particular, the biome tool needs
    // both its brush controls and palette visible without those panels overlapping.
    const optionStack = document.createElement('div'); optionStack.className = 'option-stack';
    this.brushPanel = document.createElement('div'); this.brushPanel.className = 'optpanel brushopts';
    this.brushPanel.setAttribute('role', 'group'); this.brushPanel.setAttribute('aria-label', 'Brush settings');
    // Rows rather than inline labels: on a phone the inline form wrapped and turned two sliders
    // into a panel taller than the biome palette and tool dock combined.
    this.brushPanel.innerHTML = `
      <div class="brushrow"><span class="optlbl">Size</span><input id="b-size" aria-label="Brush size" type="range" min="0" max="1000" step="1" value="${sizeToSlider(tools.brushPx)}"><span id="b-size-v" class="optval"></span></div>
      <div class="brushrow"><span class="optlbl">Strength</span><input id="b-str" aria-label="Brush strength" type="range" min="${STRENGTH_MIN}" max="1" step="0.005" value="${tools.strength}"><span id="b-str-v" class="optval"></span></div>`;
    optionStack.appendChild(this.brushPanel);
    const sizeIn = this.brushPanel.querySelector('#b-size') as HTMLInputElement;
    const strIn = this.brushPanel.querySelector('#b-str') as HTMLInputElement;
    const sizeOut = this.brushPanel.querySelector('#b-size-v') as HTMLElement;
    const strOut = this.brushPanel.querySelector('#b-str-v') as HTMLElement;
    const showSize = () => { sizeOut.textContent = tools.brushPx < 10 ? tools.brushPx.toFixed(1) : String(Math.round(tools.brushPx)); };
    const showStr = () => { strOut.textContent = Math.round(tools.strength * 100) + '%'; };
    sizeIn.addEventListener('input', (e) => { tools.brushPx = sliderToSize(parseFloat((e.target as HTMLInputElement).value)); showSize(); });
    strIn.addEventListener('input', (e) => { tools.strength = parseFloat((e.target as HTMLInputElement).value); showStr(); });
    showSize(); showStr();

    this.borderPanel = document.createElement('div'); this.borderPanel.className = 'optpanel';
    this.borderPanel.setAttribute('role', 'group'); this.borderPanel.setAttribute('aria-label', 'Border color');
    const blbl = document.createElement('span'); blbl.textContent = 'Color'; blbl.className = 'optlbl'; this.borderPanel.appendChild(blbl);
    for (const c of BORDER_COLORS) {
      const s = document.createElement('button'); s.type = 'button'; s.className = 'swatch'; s.style.background = c;
      s.title = c; s.setAttribute('aria-label', `Border color ${c}`);
      s.addEventListener('click', () => { tools.borderColor = c; this.refresh(); });
      this.swatches.push(s); this.borderPanel.appendChild(s);
    }
    optionStack.appendChild(this.borderPanel);

    this.biomePanel = document.createElement('div'); this.biomePanel.className = 'optpanel biomepanel';
    this.biomePanel.setAttribute('role', 'group'); this.biomePanel.setAttribute('aria-label', 'Biome palette');
    // The eraser used to be the first chip inside the scrolling swatch strip, where it slid off
    // the left edge on a phone and read as just another colour. It now sits outside the scroller,
    // always visible, and says what it is.
    const erase = document.createElement('button'); erase.type = 'button'; erase.className = 'erasechip'; erase.title = 'Erase biome';
    erase.setAttribute('aria-label', 'Erase biome');
    erase.innerHTML = '<span class="erasesq" aria-hidden="true"></span>Erase';
    erase.addEventListener('click', () => { tools.biome = -1; this.refresh(); });
    this.biomeChips.push(erase); this.biomePanel.appendChild(erase);
    const strip = document.createElement('div'); strip.className = 'swatchstrip';
    BIOMES.forEach((bi, i) => {
      const s = document.createElement('button'); s.type = 'button'; s.className = 'swatch'; s.title = bi.name;
      s.setAttribute('aria-label', bi.name);
      s.style.background = `rgb(${bi.color[0]},${bi.color[1]},${bi.color[2]})`;
      s.addEventListener('click', () => { tools.biome = i; this.refresh(); });
      this.biomeChips.push(s); strip.appendChild(s);
    });
    this.biomePanel.appendChild(strip);
    optionStack.appendChild(this.biomePanel);
    document.body.appendChild(optionStack);

    this.refresh();
    this.setUndoState(false, false);
  }

  refresh(): void {
    this.buttons.forEach((b, id) => {
      const selected = id === tools.tool;
      b.classList.toggle('on', selected); b.setAttribute('aria-pressed', String(selected));
    });
    const isBiome = tools.tool === 'biome';
    this.brushPanel.style.display = (isBrush(tools.tool) || isBiome) ? 'flex' : 'none';
    this.borderPanel.style.display = tools.tool === 'border' ? 'flex' : 'none';
    this.biomePanel.style.display = isBiome ? 'flex' : 'none';
    this.swatches.forEach((s, i) => {
      const selected = BORDER_COLORS[i] === tools.borderColor;
      s.classList.toggle('on', selected); s.setAttribute('aria-pressed', String(selected));
    });
    this.biomeChips.forEach((s, i) => {
      const selected = (i - 1) === tools.biome; // index 0 = erase (-1)
      s.classList.toggle('on', selected); s.setAttribute('aria-pressed', String(selected));
    });
  }

  setUndoState(canUndo: boolean, canRedo: boolean): void { this.undoBtn.disabled = !canUndo; this.redoBtn.disabled = !canRedo; }
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.className = 'btn';
  b.addEventListener('click', onClick);
  return b;
}
