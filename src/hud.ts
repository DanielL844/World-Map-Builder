import type { Camera } from './camera';

function niceNum(x: number): number {
  if (x <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  const n = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return n * p;
}
function fmtKm(km: number): string {
  if (km >= 100) return Math.round(km) + ' km';
  if (km >= 10) return km.toFixed(1) + ' km';
  if (km >= 1) return km.toFixed(2) + ' km';
  return Math.round(km * 1000) + ' m';
}

// On-screen overlay: live coordinate / scale readout plus sea-level and relief controls.
export class Hud {
  sea = 0.42;
  relief = 1.0;
  private widthKm: number;
  private coordEl: HTMLElement;
  private zoomEl: HTMLElement;
  private barEl: HTMLElement;
  private barLblEl: HTMLElement;
  private seaIn!: HTMLInputElement;
  private relIn!: HTMLInputElement;

  constructor(widthKm: number, onChange: () => void) {
    this.widthKm = widthKm;
    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="readout">
        <div id="hud-coord">—</div>
        <div id="hud-zoom" class="muted">—</div>
        <div class="scalebar"><span id="hud-bar-lbl">—</span><div id="hud-bar"></div></div>
      </div>
      <div class="panel">
        <label>Sea level <input id="hud-sea" type="range" min="0" max="1" step="0.005" value="0.42"></label>
        <label>Relief <input id="hud-relief" type="range" min="0.2" max="3" step="0.1" value="1"></label>
      </div>`;
    document.body.appendChild(root);
    this.coordEl = root.querySelector('#hud-coord') as HTMLElement;
    this.zoomEl = root.querySelector('#hud-zoom') as HTMLElement;
    this.barEl = root.querySelector('#hud-bar') as HTMLElement;
    this.barLblEl = root.querySelector('#hud-bar-lbl') as HTMLElement;
    this.seaIn = root.querySelector('#hud-sea') as HTMLInputElement;
    this.relIn = root.querySelector('#hud-relief') as HTMLInputElement;
    this.seaIn.addEventListener('input', () => { this.sea = parseFloat(this.seaIn.value); onChange(); });
    this.relIn.addEventListener('input', () => { this.relief = parseFloat(this.relIn.value); onChange(); });
  }

  update(cam: Camera, hoverU: number, hoverV: number): void {
    const kmPerPx = this.widthKm / cam.scale;
    this.coordEl.textContent = `${Math.round(hoverU * this.widthKm)} km, ${Math.round(hoverV * this.widthKm)} km`;
    const mpp = (this.widthKm * 1000) / cam.scale;
    this.zoomEl.textContent = mpp >= 1000 ? (mpp / 1000).toFixed(1) + ' km/px' : Math.round(mpp) + ' m/px';
    let km = niceNum(90 * kmPerPx);
    let px = km / kmPerPx;
    if (px > 140) { km = niceNum(km / 2); px = km / kmPerPx; }
    this.barEl.style.width = px + 'px';
    this.barLblEl.textContent = fmtKm(km);
  }

  setWidthKm(km: number): void { this.widthKm = km; }
  setSeaRelief(sea: number, relief: number): void {
    this.sea = sea; this.relief = relief;
    this.seaIn.value = String(sea); this.relIn.value = String(relief);
  }
}
