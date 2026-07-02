// Tiny text-input modal. Resolves to the trimmed string, or null if cancelled.
export function showTextModal(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal-card">
      <h3></h3>
      <input type="text" autocomplete="off" />
      <div class="modal-row"><button class="btn ok">OK</button><button class="btn cancel">Cancel</button></div>
    </div>`;
    (back.querySelector('h3') as HTMLElement).textContent = title;
    const input = back.querySelector('input') as HTMLInputElement;
    input.value = initial;
    const close = (val: string | null) => { back.remove(); resolve(val); };
    const ok = () => close(input.value.trim() || null);
    (back.querySelector('.ok') as HTMLButtonElement).addEventListener('click', ok);
    (back.querySelector('.cancel') as HTMLButtonElement).addEventListener('click', () => close(null));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ok();
      else if (e.key === 'Escape') close(null);
    });
    document.body.appendChild(back);
    setTimeout(() => input.focus(), 30);
  });
}
