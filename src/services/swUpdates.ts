const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_MIN_CHECK_GAP_MS = 5 * 60 * 1000;

export interface ServiceWorkerUpdateOptions {
  registration: ServiceWorkerRegistration;
  container: ServiceWorkerContainer;
  reload: () => void;
  checkIntervalMs?: number;
  minCheckGapMs?: number;
}

/**
 * Wires up the "autoUpdate" flow for the app's service worker:
 * - proactively checks for a new worker on visibility/focus/interval, throttled together
 * - reloads the page exactly once, the first time a *new* worker takes control
 *   (a controllerchange on first install, with no prior controller, does not reload)
 */
export function initServiceWorkerUpdates(options: ServiceWorkerUpdateOptions): void {
  const {
    registration,
    container,
    reload,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    minCheckGapMs = DEFAULT_MIN_CHECK_GAP_MS,
  } = options;

  let hadController = Boolean(container.controller);
  let hasReloaded = false;
  let lastCheckAt = 0;

  container.addEventListener('controllerchange', () => {
    if (hadController) {
      if (hasReloaded) {
        return;
      }
      hasReloaded = true;
      console.debug('Solar Sentinel perf', { event: 'service-worker-reloading-for-update' });
      reload();
      return;
    }
    hadController = true;
  });

  registration.addEventListener('updatefound', () => {
    console.debug('Solar Sentinel perf', { event: 'service-worker-update-found' });
  });

  const checkForUpdate = (): void => {
    const now = Date.now();
    if (now - lastCheckAt < minCheckGapMs) {
      return;
    }
    lastCheckAt = now;
    console.debug('Solar Sentinel perf', { event: 'service-worker-update-check' });
    registration.update().catch(() => {});
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForUpdate();
    }
  });

  window.addEventListener('focus', () => {
    checkForUpdate();
  });

  setInterval(checkForUpdate, checkIntervalMs);
}
