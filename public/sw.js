// Solar Sentinel Service Worker
//
// Caching strategy:
// - App shell (/, /index.html): stale-while-revalidate — serve cached HTML
//   instantly, refresh it in the background for the next launch. Safe because
//   the JS/CSS it references are content-hashed and precached below.
// - Hashed /assets/* files: precached at install, cache-first at fetch.
// - Static assets (icons, logo, manifest, weather art): cache-first.
// - API endpoints: network-first with short cache fallback for offline.

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

// API calls - network first with short-term cache fallback
function networkFirstApi(event) {
  return fetch(event.request)
    .then(response => {
      if (response.ok) {
        const responseClone = response.clone();
        caches.open(CURRENT_CACHES.api).then(cache => {
          // Cache API responses temporarily
          cache.put(event.request, responseClone);

          // Auto-expire API cache after 5 minutes
          setTimeout(() => {
            cache.delete(event.request);
          }, 5 * 60 * 1000);
        });
      }
      return response;
    })
    .catch(() => {
      // Fallback to cached API data when offline
      console.log('API network failed, serving from cache:', event.request.url);
      return caches.match(event.request);
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
