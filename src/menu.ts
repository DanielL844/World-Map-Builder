import { tools, setFingerDraw } from './tools';

interface MenuOptions {
  getWorld: () => { widthKm: number; heightKm: number };
  onApplyWorld: (widthKm: number, heightKm: number) => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  onExport: () => void;
  onExportWorld: () => void;
  onPreset: (kind: 'flat' | 'continents' | 'islands') => void;
  onPlanet: () => void;
  onNew: () => void;
}

// Settings / project menu modal.
export class Menu {
  private back: HTMLElement;
  private wIn: HTMLInputElement;
  private hIn: HTMLInputElement;
  private opts: MenuOptions;
  private previousFocus: HTMLElement | null = null;

  constructor(opts: MenuOptions) {
    this.opts = opts;
    const back = document.createElement('div');
    back.className = 'modal-back'; back.style.display = 'none';
    back.innerHTML = `<div class="modal-card menu-card" role="dialog" aria-modal="true" aria-labelledby="m-title">
      <h3 id="m-title">World size</h3>
      <div class="menu-row"><label for="m-w">Width (km)</label><input id="m-w" type="number" min="1" step="any" required></div>
      <div class="menu-row"><label for="m-h">Height (km)</label><input id="m-h" type="number" min="1" step="any" required></div>
      <div class="menu-actions"><button class="btn apply">Apply size</button></div>
      <h3>Input</h3>
      <div class="menu-row"><label for="m-finger">Draw with one finger (two fingers pan/zoom)</label><input id="m-finger" type="checkbox"></div>
      <h3>Generate</h3>
      <div class="menu-actions">
        <button class="btn primary preset-planet">Planet (realistic)</button>
        <button class="btn preset-continents">Continents</button>
        <button class="btn preset-islands">Islands</button>
        <button class="btn preset-flat">Flat plain</button>
      </div>
      <h3>Project</h3>
      <div class="menu-actions">
        <button class="btn primary save">Save to file</button>
        <button class="btn load">Open file…</button>
        <input id="m-file" type="file" accept=".json,application/json" style="display:none">
        <button class="btn export">Export PNG (current view)</button>
        <button class="btn exportworld">Export PNG (whole world)</button>
        <button class="btn danger newworld">New / clear</button>
      </div>
      <div class="menu-actions" style="margin-top:12px"><button class="btn close">Close</button></div>
    </div>`;
    document.body.appendChild(back);
    this.back = back;
    this.wIn = back.querySelector('#m-w') as HTMLInputElement;
    this.hIn = back.querySelector('#m-h') as HTMLInputElement;
    const file = back.querySelector('#m-file') as HTMLInputElement;
    const finger = back.querySelector('#m-finger') as HTMLInputElement;
    finger.addEventListener('change', () => setFingerDraw(finger.checked));
    const on = (sel: string, fn: () => void) => (back.querySelector(sel) as HTMLButtonElement).addEventListener('click', fn);

    back.addEventListener('pointerdown', (e) => { if (e.target === back) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.back.style.display !== 'none') { e.preventDefault(); this.close(); }
    });
    on('.close', () => this.close());
    on('.apply', () => {
      if (!this.wIn.checkValidity()) { this.wIn.reportValidity(); return; }
      if (!this.hIn.checkValidity()) { this.hIn.reportValidity(); return; }
      const w = this.wIn.valueAsNumber, h = this.hIn.valueAsNumber;
      if (!Number.isFinite(w) || !Number.isFinite(h)) return;
      opts.onApplyWorld(w, h); this.close();
    });
    on('.save', () => opts.onSave());
    on('.export', () => opts.onExport());
    on('.preset-planet', () => { opts.onPlanet(); this.close(); });
    on('.preset-continents', () => { opts.onPreset('continents'); this.close(); });
    on('.preset-islands', () => { opts.onPreset('islands'); this.close(); });
    on('.preset-flat', () => { opts.onPreset('flat'); this.close(); });
    on('.exportworld', () => opts.onExportWorld());
    on('.newworld', () => {
      if (window.confirm('Clear this world? This cannot be undone.')) { opts.onNew(); this.close(); }
    });
    on('.load', () => file.click());
    file.addEventListener('change', () => { if (file.files && file.files[0]) { opts.onLoad(file.files[0]); file.value = ''; this.close(); } });
  }

  open(): void {
    const w = this.opts.getWorld();
    this.wIn.value = String(w.widthKm); this.hIn.value = String(w.heightKm);
    (this.back.querySelector('#m-finger') as HTMLInputElement).checked = tools.fingerDraw;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.back.style.display = 'flex';
    requestAnimationFrame(() => {
      if (this.back.style.display !== 'none') { this.wIn.focus(); this.wIn.select(); }
    });
  }
  close(): void {
    if (this.back.style.display === 'none') return;
    this.back.style.display = 'none';
    this.previousFocus?.focus({ preventScroll: true });
    this.previousFocus = null;
  }
}
