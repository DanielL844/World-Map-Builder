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

export class Toolbar {
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private brushPanel: HTMLElement;
  private borderPanel: HTMLElement;
  private biomePanel: HTMLElement;
  private buttons = new Map<ToolId, HTMLButtonElement>();
  private swatches: HTMLElement[] = [];
  private biomeChips: HTMLElement[] = [];

  constructor(opts: ToolbarOptions) {
    const top = document.createElement('div'); top.className = 'topbar';
    const menuBtn = button('☰', 'Menu', opts.onMenu);
    this.undoBtn = button('↶', 'Undo', opts.onUndo);
    this.redoBtn = button('↷', 'Redo', opts.onRedo);
    top.append(menuBtn, this.undoBtn, this.redoBtn);
    document.body.appendChild(top);

    const dock = document.createElement('div'); dock.className = 'dock';
    GROUPS.forEach((group, gi) => {
      if (gi > 0) { const sep = document.createElement('div'); sep.className = 'sep'; dock.appendChild(sep); }
      for (const def of group) {
        const b = button(def.label, def.label, () => { tools.tool = def.id; this.refresh(); opts.onToolChange(); });
        b.classList.add('tool'); this.buttons.set(def.id, b); dock.appendChild(b);
      }
    });
    document.body.appendChild(dock);

    this.brushPanel = document.createElement('div'); this.brushPanel.className = 'optpanel';
    this.brushPanel.innerHTML = `
      <label>Size <input id="b-size" type="range" min="6" max="160" step="1" value="${tools.brushPx}"></label>
      <label>Strength <input id="b-str" type="range" min="0.05" max="1" step="0.01" value="${tools.strength}"></label>`;
    document.body.appendChild(this.brushPanel);
    (this.brushPanel.querySelector('#b-size') as HTMLInputElement).addEventListener('input', (e) => { tools.brushPx = parseFloat((e.target as HTMLInputElement).value); });
    (this.brushPanel.querySelector('#b-str') as HTMLInputElement).addEventListener('input', (e) => { tools.strength = parseFloat((e.target as HTMLInputElement).value); });

    this.borderPanel = document.createElement('div'); this.borderPanel.className = 'optpanel';
    const blbl = document.createElement('span'); blbl.textContent = 'Color'; blbl.className = 'optlbl'; this.borderPanel.appendChild(blbl);
    for (const c of BORDER_COLORS) {
      const s = document.createElement('div'); s.className = 'swatch'; s.style.background = c;
      s.addEventListener('click', () => { tools.borderColor = c; this.refresh(); });
      this.swatches.push(s); this.borderPanel.appendChild(s);
    }
    document.body.appendChild(this.borderPanel);

    this.biomePanel = document.createElement('div'); this.biomePanel.className = 'optpanel biomepanel';
    const erase = document.createElement('div'); erase.className = 'swatch erase'; erase.title = 'Erase biome';
    erase.addEventListener('click', () => { tools.biome = -1; this.refresh(); });
    this.biomeChips.push(erase); this.biomePanel.appendChild(erase);
    BIOMES.forEach((bi, i) => {
      const s = document.createElement('div'); s.className = 'swatch'; s.title = bi.name;
      s.style.background = `rgb(${bi.color[0]},${bi.color[1]},${bi.color[2]})`;
      s.addEventListener('click', () => { tools.biome = i; this.refresh(); });
      this.biomeChips.push(s); this.biomePanel.appendChild(s);
    });
    document.body.appendChild(this.biomePanel);

    this.refresh();
    this.setUndoState(false, false);
  }

  refresh(): void {
    this.buttons.forEach((b, id) => b.classList.toggle('on', id === tools.tool));
    const isBiome = tools.tool === 'biome';
    this.brushPanel.style.display = (isBrush(tools.tool) || isBiome) ? 'flex' : 'none';
    this.borderPanel.style.display = tools.tool === 'border' ? 'flex' : 'none';
    this.biomePanel.style.display = isBiome ? 'flex' : 'none';
    this.swatches.forEach((s, i) => s.classList.toggle('on', BORDER_COLORS[i] === tools.borderColor));
    this.biomeChips.forEach((s, i) => s.classList.toggle('on', (i - 1) === tools.biome)); // index 0 = erase (-1)
  }

  setUndoState(canUndo: boolean, canRedo: boolean): void { this.undoBtn.disabled = !canUndo; this.redoBtn.disabled = !canRedo; }
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text; b.title = title; b.className = 'btn';
  b.addEventListener('click', onClick);
  return b;
}
