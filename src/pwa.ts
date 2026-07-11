export function registerPwaUpdates(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void registerServiceWorker();
  });
}

async function registerServiceWorker(): Promise<void> {
  let hasController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first controllerchange is the initial installation. Remember it so a later update in
    // the same long-lived tab still prompts, even if this page started out uncontrolled.
    if (hasController) showUpdatePrompt();
    hasController = true;
  });

  try {
    const registration = await navigator.serviceWorker.register('./sw.js');

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate(registration);
    });

    window.setInterval(() => {
      checkForUpdate(registration);
    }, 60 * 60 * 1000);
  } catch {
    // The app still works online if service-worker registration is unavailable.
  }
}

function checkForUpdate(registration: ServiceWorkerRegistration): void {
  // Going offline or shutting down can reject update(); routine checks should stay silent.
  void registration.update().catch(() => {});
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
