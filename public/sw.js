// Solar Sentinel Service Worker
//
// Caching strategy:
// - App shell (/, /index.html): stale-while-revalidate — serve cached HTML
//   instantly, refresh it in the background for the next launch. Safe because
//   the JS/CSS it references are content-hashed and precached below.
// - Hashed /assets/* files: precached at install, cache-first at fetch.
// - Static assets (icons, logo, manifest, weather art): cache-first.
// - API endpoints: network-first; the cached copy is served on failure only
//   if it is under 5 minutes old, checked via a stored `sw-cached-at` header
//   timestamp (not a setTimeout — the worker can be terminated and restarted
//   between requests, so in-worker timers can't be relied on to expire it).

// VERSION and PRECACHE_ASSETS are replaced at build time by the
// sw-precache-manifest plugin in vite.config.ts. In dev they stay as-is
// (no precache, 'dev' cache names).
let VERSION = 'dev';
let PRECACHE_ASSETS = [];
/* __SW_PRECACHE__ */

const CURRENT_CACHES = {
  static: `solar-sentinel-static-v${VERSION}`,
  api: `solar-sentinel-api-v${VERSION}`
};

// App shell - stale-while-revalidate
const APP_SHELL = ['/', '/index.html'];

// Static assets - cache first (icons, logos, manifest)
const STATIC_ASSETS = ['/icon-192.png', '/icon-512.png', '/logo.webp', '/manifest.json', '/favicon.ico'];

// Install event - precache the app shell, hashed assets, and static assets
self.addEventListener('install', event => {
  console.log('Service Worker installing...');

  event.waitUntil(
    caches.open(CURRENT_CACHES.static)
      .then(cache => cache.addAll(['/', ...PRECACHE_ASSETS, ...STATIC_ASSETS]))
      .then(() => {
        // Skip waiting to activate immediately
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');

  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Delete old cache versions
          if (!Object.values(CURRENT_CACHES).includes(cacheName)) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

// App shell - serve cached HTML immediately, refresh it in the background
function staleWhileRevalidateShell(event) {
  const refresh = fetch(event.request)
    .then(response => {
      if (response.ok) {
        const responseClone = response.clone();
        caches.open(CURRENT_CACHES.static).then(cache => {
          cache.put(event.request, responseClone);
        });
      }
      return response;
    });

  return caches.match(event.request).then(cached => {
    if (cached) {
      // Keep the worker alive until the background refresh settles
      event.waitUntil(refresh.catch(() => undefined));
      return cached;
    }
    return refresh.catch(() => {
      console.log('Network failed and no cached shell:', event.request.url);
      return caches.match('/');
    });
  });
}

// Static assets - cache first, populate on miss
function cacheFirst(event) {
  return caches.match(event.request).then(cached => {
    if (cached) {
      return cached;
    }
    return fetch(event.request).then(response => {
      if (response.ok) {
        const responseClone = response.clone();
        caches.open(CURRENT_CACHES.static).then(cache => {
          cache.put(event.request, responseClone);
        });
      }
      return response;
    });
  });
}

// API cache entries older than this are treated as stale and never served.
const API_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const CACHED_AT_HEADER = 'sw-cached-at';

// API calls - network first with short-term cache fallback
function networkFirstApi(event) {
  return fetch(event.request)
    .then(response => {
      if (response.ok) {
        const responseClone = response.clone();
        // Keep the worker alive until the (now two-step) cache write lands.
        event.waitUntil(
          caches
            .open(CURRENT_CACHES.api)
            .then(cache => {
              // Stamp the cached copy with a wall-clock timestamp so freshness
              // can be checked later regardless of whether the worker that
              // wrote it is still alive - service workers are terminated
              // seconds after going idle, so a setTimeout scheduled here would
              // never fire in practice.
              const headers = new Headers(responseClone.headers);
              headers.set(CACHED_AT_HEADER, String(Date.now()));
              return responseClone.blob().then(body => {
                const stamped = new Response(body, {
                  status: responseClone.status,
                  statusText: responseClone.statusText,
                  headers
                });
                return cache.put(event.request, stamped);
              });
            })
            .catch(() => undefined)
        );
      }
      return response;
    })
    .catch(error => {
      // Fallback to cached API data when offline, but only if it's still fresh.
      return caches.open(CURRENT_CACHES.api).then(cache => {
        return cache.match(event.request).then(cached => {
          const cachedAt = cached ? Number(cached.headers.get(CACHED_AT_HEADER)) : NaN;
          const isFresh = cached && !Number.isNaN(cachedAt) && Date.now() - cachedAt < API_CACHE_MAX_AGE_MS;

          if (isFresh) {
            console.log('API network failed, serving from cache:', event.request.url);
            return cached;
          }

          if (cached) {
            console.log('API network failed, cached copy is stale, discarding:', event.request.url);
            cache.delete(event.request);
          }

          throw error;
        });
      });
    });
}

// Fetch event - smart caching strategies
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Let the browser handle third-party scripts/beacons directly. If they are
  // blocked by an extension or privacy setting, the service worker should not
  // turn that into an uncaught FetchEvent error.
  if (url.origin !== self.location.origin) {
    return;
  }

  // The widget distribution page must always be live (server serves it no-cache);
  // never hold it back with the app shell's stale-while-revalidate.
  if (url.pathname.startsWith('/widget')) {
    return;
  }

  // Re-auth navigation must reach Cloudflare Access directly, not the cached
  // app shell, so an expired session's login redirect is never hidden.
  if (url.pathname.startsWith('/auth/')) {
    return;
  }

  if (APP_SHELL.includes(url.pathname) || event.request.mode === 'navigate') {
    event.respondWith(staleWhileRevalidateShell(event));
  }

  // Hashed bundles and static assets - cache first (immutable or rarely changing)
  else if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/weather-art/') ||
    STATIC_ASSETS.includes(url.pathname)
  ) {
    event.respondWith(cacheFirst(event));
  }

  // API calls - network first with short-term cache
  else if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(event));
  }

  // Everything else - let the browser handle it normally.
});

// Handle messages from main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Background sync for offline actions (future enhancement)
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    console.log('Background sync triggered');
    // Could sync offline actions when connection restored
  }
});
