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

  constructor(opts: MenuOptions) {
    this.opts = opts;
    const back = document.createElement('div');
    back.className = 'modal-back'; back.style.display = 'none';
    back.innerHTML = `<div class="modal-card menu-card">
      <h3>World size</h3>
      <div class="menu-row"><label>Width (km)</label><input id="m-w" type="number" min="1" step="any"></div>
      <div class="menu-row"><label>Height (km)</label><input id="m-h" type="number" min="1" step="any"></div>
      <div class="menu-actions"><button class="btn apply">Apply size</button></div>
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
    const on = (sel: string, fn: () => void) => (back.querySelector(sel) as HTMLButtonElement).addEventListener('click', fn);

    back.addEventListener('pointerdown', (e) => { if (e.target === back) this.close(); });
    on('.close', () => this.close());
    on('.apply', () => { const w = parseFloat(this.wIn.value), h = parseFloat(this.hIn.value); if (w > 0 && h > 0) opts.onApplyWorld(w, h); this.close(); });
    on('.save', () => opts.onSave());
    on('.export', () => opts.onExport());
    on('.preset-planet', () => { opts.onPlanet(); this.close(); });
    on('.preset-continents', () => { opts.onPreset('continents'); this.close(); });
    on('.preset-islands', () => { opts.onPreset('islands'); this.close(); });
    on('.preset-flat', () => { opts.onPreset('flat'); this.close(); });
    on('.exportworld', () => opts.onExportWorld());
    on('.newworld', () => { opts.onNew(); this.close(); });
    on('.load', () => file.click());
    file.addEventListener('change', () => { if (file.files && file.files[0]) { opts.onLoad(file.files[0]); file.value = ''; this.close(); } });
  }

  open(): void {
    const w = this.opts.getWorld();
    this.wIn.value = String(w.widthKm); this.hIn.value = String(w.heightKm);
    this.back.style.display = 'flex';
  }
  close(): void { this.back.style.display = 'none'; }
}
