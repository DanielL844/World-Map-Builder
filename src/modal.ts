// Tiny text-input modal. Resolves to the trimmed string, or null if cancelled.
export function showTextModal(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="text-modal-title">
      <h3 id="text-modal-title"></h3>
      <input type="text" autocomplete="off" />
      <div class="modal-row"><button class="btn ok">OK</button><button class="btn cancel">Cancel</button></div>
    </div>`;
    (back.querySelector('h3') as HTMLElement).textContent = title;
    const input = back.querySelector('input') as HTMLInputElement;
    input.value = initial;
    let closed = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    };
    const close = (val: string | null) => {
      if (closed) return;
      closed = true;
      window.removeEventListener('keydown', onKeyDown);
      back.remove(); previousFocus?.focus({ preventScroll: true }); resolve(val);
    };
    const ok = () => close(input.value.trim() || null);
    const okBtn = back.querySelector('.ok') as HTMLButtonElement;
    const cancelBtn = back.querySelector('.cancel') as HTMLButtonElement;
    okBtn.type = 'button'; cancelBtn.type = 'button';
    okBtn.addEventListener('click', ok);
    cancelBtn.addEventListener('click', () => close(null));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ok(); }
    });
    window.addEventListener('keydown', onKeyDown);
    document.body.appendChild(back);
    requestAnimationFrame(() => { if (!closed) { input.focus(); input.select(); } });
  });
}
