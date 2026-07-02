export function registerPwaUpdates(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void registerServiceWorker();
  });
}

async function registerServiceWorker(): Promise<void> {
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) showUpdatePrompt();
  });

  try {
    const registration = await navigator.serviceWorker.register('./sw.js');

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration.update();
    });

    window.setInterval(() => {
      void registration.update();
    }, 60 * 60 * 1000);
  } catch {
    // The app still works online if service-worker registration is unavailable.
  }
}

let updateVisible = false;
function showUpdatePrompt(): void {
  if (updateVisible) return;
  updateVisible = true;

  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.setAttribute('role', 'status');

  const label = document.createElement('span');
  label.textContent = 'Update ready';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn update-button';
  button.textContent = 'Reload';
  button.addEventListener('click', () => window.location.reload());

  banner.append(label, button);
  document.body.appendChild(banner);
}
