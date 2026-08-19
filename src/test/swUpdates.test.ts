import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initServiceWorkerUpdates } from '../services/swUpdates.js';

type Listener = () => void;

interface FakeEventTarget {
  addEventListener: (type: string, handler: Listener) => void;
  dispatch: (type: string) => void;
}

function createFakeEventTarget(): FakeEventTarget {
  const listeners: Record<string, Listener[]> = {};
  return {
    addEventListener(type: string, handler: Listener) {
      (listeners[type] ??= []).push(handler);
    },
    dispatch(type: string) {
      (listeners[type] ?? []).forEach(handler => handler());
    },
  };
}

function createFakeContainer(hasController: boolean) {
  const target = createFakeEventTarget();
  return {
    ...target,
    controller: hasController ? ({} as ServiceWorker) : null,
  };
}

function createFakeRegistration() {
  const target = createFakeEventTarget();
  return {
    ...target,
    update: vi.fn().mockResolvedValue(undefined),
  };
}

describe('initServiceWorkerUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reloads once on the first controllerchange when a controller already existed', () => {
    const container = createFakeContainer(true);
    const registration = createFakeRegistration();
    const reload = vi.fn();

    initServiceWorkerUpdates({
      registration: registration as unknown as ServiceWorkerRegistration,
      container: container as unknown as ServiceWorkerContainer,
      reload,
    });

    container.dispatch('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);

    container.dispatch('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on the first controllerchange after a fresh install, but does on the next', () => {
    const container = createFakeContainer(false);
    const registration = createFakeRegistration();
    const reload = vi.fn();

    initServiceWorkerUpdates({
      registration: registration as unknown as ServiceWorkerRegistration,
      container: container as unknown as ServiceWorkerContainer,
      reload,
    });

    container.dispatch('controllerchange');
    expect(reload).not.toHaveBeenCalled();

    container.dispatch('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);

    container.dispatch('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('checks for updates on visibilitychange-to-visible and focus, throttled together', async () => {
    const container = createFakeContainer(true);
    const registration = createFakeRegistration();
    const reload = vi.fn();
    const minCheckGapMs = 5 * 60 * 1000;
    const checkIntervalMs = 60 * 60 * 1000;

    initServiceWorkerUpdates({
      registration: registration as unknown as ServiceWorkerRegistration,
      container: container as unknown as ServiceWorkerContainer,
      reload,
      minCheckGapMs,
      checkIntervalMs,
    });

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).toHaveBeenCalledTimes(1);

    // focus immediately after: within the throttle gap, should not check again
    window.dispatchEvent(new Event('focus'));
    expect(registration.update).toHaveBeenCalledTimes(1);

    // still within gap
    await vi.advanceTimersByTimeAsync(minCheckGapMs - 1);
    window.dispatchEvent(new Event('focus'));
    expect(registration.update).toHaveBeenCalledTimes(1);

    // gap has now passed
    await vi.advanceTimersByTimeAsync(1);
    window.dispatchEvent(new Event('focus'));
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('checks for updates on the interval timer', async () => {
    const container = createFakeContainer(true);
    const registration = createFakeRegistration();
    const reload = vi.fn();
    const minCheckGapMs = 5 * 60 * 1000;
    const checkIntervalMs = 60 * 60 * 1000;

    initServiceWorkerUpdates({
      registration: registration as unknown as ServiceWorkerRegistration,
      container: container as unknown as ServiceWorkerContainer,
      reload,
      minCheckGapMs,
      checkIntervalMs,
    });

    expect(registration.update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(checkIntervalMs);
    expect(registration.update).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(checkIntervalMs);
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('logs an updatefound event from the registration', () => {
    const container = createFakeContainer(true);
    const registration = createFakeRegistration();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    initServiceWorkerUpdates({
      registration: registration as unknown as ServiceWorkerRegistration,
      container: container as unknown as ServiceWorkerContainer,
      reload: vi.fn(),
    });

    registration.dispatch('updatefound');

    expect(debugSpy).toHaveBeenCalledWith(
      'Solar Sentinel perf',
      expect.objectContaining({ event: 'service-worker-update-found' })
    );

    debugSpy.mockRestore();
  });

  it('swallows a rejected registration.update() without throwing or unhandled rejection', async () => {
    const container = createFakeContainer(true);
    const registration = createFakeRegistration();
    registration.update.mockRejectedValue(new Error('offline'));

    initServiceWorkerUpdates({
      registration: registration as unknown as ServiceWorkerRegistration,
      container: container as unknown as ServiceWorkerContainer,
      reload: vi.fn(),
      minCheckGapMs: 1000,
      checkIntervalMs: 60 * 60 * 1000,
    });

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });

    expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });
});
