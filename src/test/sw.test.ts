// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SW_SOURCE = fs.readFileSync(path.join(__dirname, '../../public/sw.js'), 'utf-8');

const ORIGIN = 'https://example.test';

interface FakeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
  addAll(requests: Array<string | Request>): Promise<void>;
  keys(): Promise<Request[]>;
}

function createFakeCacheStorage() {
  const caches = new Map<string, Map<string, Response>>();

  function keyFor(request: Request | string): string {
    return typeof request === 'string' ? new URL(request, ORIGIN).toString() : request.url;
  }

  function makeCache(name: string): FakeCache {
    if (!caches.has(name)) {
      caches.set(name, new Map());
    }
    const store = caches.get(name)!;
    return {
      async match(request) {
        const entry = store.get(keyFor(request));
        return entry ? entry.clone() : undefined;
      },
      async put(request, response) {
        store.set(keyFor(request), response);
      },
      async delete(request) {
        return store.delete(keyFor(request));
      },
      async addAll(requests) {
        for (const req of requests) {
          store.set(keyFor(req), new Response('', { status: 200 }));
        }
      },
      async keys() {
        return [...store.keys()].map(url => new Request(url));
      },
    };
  }

  const cachesApi = {
    async open(name: string) {
      return makeCache(name);
    },
    async match(request: Request | string) {
      const key = keyFor(request);
      for (const store of caches.values()) {
        if (store.has(key)) {
          return store.get(key)!.clone();
        }
      }
      return undefined;
    },
    async keys() {
      return [...caches.keys()];
    },
    async delete(name: string) {
      return caches.delete(name);
    },
    // test helper, not part of the real CacheStorage API
    __raw: caches,
  };

  return cachesApi;
}

interface SwHandlers {
  fetch?: (event: unknown) => void;
  install?: (event: unknown) => void;
  activate?: (event: unknown) => void;
  message?: (event: unknown) => void;
  sync?: (event: unknown) => void;
}

type FakeSetTimeout = (callback: (...args: unknown[]) => void, delay?: number) => unknown;

function loadServiceWorker(
  fetchImpl: (req: Request) => Promise<Response>,
  cachesApi: ReturnType<typeof createFakeCacheStorage>,
  setTimeoutSpy: FakeSetTimeout
) {
  const handlers: SwHandlers = {};
  const selfObj = {
    location: { origin: ORIGIN },
    addEventListener(type: string, fn: (event: unknown) => void) {
      (handlers as Record<string, (event: unknown) => void>)[type] = fn;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };

  const context = {
    self: selfObj,
    caches: cachesApi,
    fetch: fetchImpl,
    console,
    Response,
    Request,
    Headers,
    URL,
    Date,
    setTimeout: setTimeoutSpy,
  };

  vm.createContext(context);
  vm.runInContext(SW_SOURCE, context);

  return { handlers, self: selfObj };
}

function dispatchFetch(handlers: SwHandlers, url: string) {
  let responded: Promise<Response> | undefined;
  const event = {
    request: new Request(url),
    respondWith(p: Promise<Response>) {
      responded = p;
    },
    waitUntil: vi.fn(),
  };
  handlers.fetch!(event);
  return responded!;
}

describe('sw.js networkFirstApi', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves the cached body when the fallback is fresh (under 5 minutes old)', async () => {
    const cachesApi = createFakeCacheStorage();
    const setTimeoutSpy = vi.fn(setTimeout);
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ hello: 'world' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new TypeError('Failed to fetch');
    });

    const { handlers } = loadServiceWorker(fetchImpl, cachesApi, setTimeoutSpy);

    const url = `${ORIGIN}/api/weather?lat=42.8&lon=-71.3`;

    // First request succeeds and populates the cache
    const first = await dispatchFetch(handlers, url);
    expect(await first.json()).toEqual({ hello: 'world' });

    // Advance 1 minute, then network fails
    await vi.advanceTimersByTimeAsync(60 * 1000);

    const second = await dispatchFetch(handlers, url);
    expect(await second.json()).toEqual({ hello: 'world' });
  });

  it('rejects when the fallback is stale (30 minutes old) and deletes the stale entry', async () => {
    const cachesApi = createFakeCacheStorage();
    const setTimeoutSpy = vi.fn(setTimeout);
    let callCount = 0;
    const networkError = new TypeError('Failed to fetch');
    const fetchImpl = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ hello: 'world' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw networkError;
    });

    const { handlers } = loadServiceWorker(fetchImpl, cachesApi, setTimeoutSpy);

    const url = `${ORIGIN}/api/weather?lat=42.8&lon=-71.3`;

    await dispatchFetch(handlers, url);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    await expect(dispatchFetch(handlers, url)).rejects.toThrow();

    // The stale entry must have been deleted from the cache.
    const apiCache = cachesApi.__raw.get('solar-sentinel-api-vdev');
    expect(apiCache?.has(url)).toBe(false);
  });

  it('expiry survives a simulated worker restart (re-evaluating sw.js against the same cache)', async () => {
    const cachesApi = createFakeCacheStorage();
    const setTimeoutSpy = vi.fn(setTimeout);

    const successFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ hello: 'world' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const firstWorker = loadServiceWorker(successFetch, cachesApi, setTimeoutSpy);
    const url = `${ORIGIN}/api/weather?lat=42.8&lon=-71.3`;

    await dispatchFetch(firstWorker.handlers, url);

    // No setTimeout scheduled by the SW for cache deletion during the API fetch path.
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    // Simulate the worker being terminated and restarted: re-evaluate sw.js
    // fresh against the SAME underlying cache storage.
    const failFetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const secondWorker = loadServiceWorker(failFetch, cachesApi, setTimeoutSpy);

    await expect(dispatchFetch(secondWorker.handlers, url)).rejects.toThrow();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('does not intercept cross-origin requests', () => {
    const cachesApi = createFakeCacheStorage();
    const setTimeoutSpy = vi.fn(setTimeout);
    const fetchImpl = vi.fn();
    const { handlers } = loadServiceWorker(fetchImpl, cachesApi, setTimeoutSpy);

    let responded = false;
    const event = {
      request: new Request('https://other-origin.test/api/weather'),
      respondWith() {
        responded = true;
      },
      waitUntil: vi.fn(),
    };
    handlers.fetch!(event);
    expect(responded).toBe(false);
  });

  it('lets /widget requests pass through untouched', () => {
    const cachesApi = createFakeCacheStorage();
    const setTimeoutSpy = vi.fn(setTimeout);
    const fetchImpl = vi.fn();
    const { handlers } = loadServiceWorker(fetchImpl, cachesApi, setTimeoutSpy);

    let responded = false;
    const event = {
      request: new Request(`${ORIGIN}/widget/settings`),
      respondWith() {
        responded = true;
      },
      waitUntil: vi.fn(),
    };
    handlers.fetch!(event);
    expect(responded).toBe(false);
  });

  it('lets /auth/ requests pass through untouched', () => {
    const cachesApi = createFakeCacheStorage();
    const setTimeoutSpy = vi.fn(setTimeout);
    const fetchImpl = vi.fn();
    const { handlers } = loadServiceWorker(fetchImpl, cachesApi, setTimeoutSpy);

    let responded = false;
    const event = {
      request: new Request(`${ORIGIN}/auth/callback`),
      respondWith() {
        responded = true;
      },
      waitUntil: vi.fn(),
    };
    handlers.fetch!(event);
    expect(responded).toBe(false);
  });
});
