// Solar Sentinel Service Worker
// Smart caching strategy: Network-first for app shell, cache-first for static assets

const VERSION = '1.0.0';
const CURRENT_CACHES = {
  static: `solar-sentinel-static-v${VERSION}`,
  api: `solar-sentinel-api-v${VERSION}`
};

// Content categorization for different caching strategies
const cacheStrategies = {
  // App shell - Network first (always get updates)
  appShell: ['/', '/index.html'],
  
  // Static assets - Cache first (icons, logos, manifest)
  static: ['/icon-192.png', '/icon-512.png', '/logo.png', '/manifest.json', '/favicon.ico'],
  
  // API endpoints - Network first with short cache
  api: ['/api/uv-today', '/api/daily-summary']
};

// Install event - cache essential static assets only
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  
  event.waitUntil(
    caches.open(CURRENT_CACHES.static)
      .then(cache => {
        console.log('Caching static assets');
        return cache.addAll(cacheStrategies.static);
      })
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

// Fetch event - smart caching strategies
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  // App shell - Network first, cache fallback (ensures updates)
  if (cacheStrategies.appShell.includes(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Update cache with fresh content
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CURRENT_CACHES.static).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache when offline
          console.log('Network failed, serving from cache:', url.pathname);
          return caches.match(event.request);
        })
    );
  }
  
  // Static assets - Cache first (icons, logos, etc.)
  else if (cacheStrategies.static.some(path => url.pathname.includes(path))) {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          if (response) {
            return response;
          }
          // If not in cache, fetch and cache
          return fetch(event.request).then(response => {
            if (response.ok) {
              const responseClone = response.clone();
              caches.open(CURRENT_CACHES.static).then(cache => {
                cache.put(event.request, responseClone);
              });
            }
            return response;
          });
        })
    );
  }
  
  // API calls - Network first with short-term cache
  else if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
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
          console.log('API network failed, serving from cache:', url.pathname);
          return caches.match(event.request);
        })
    );
  }
  
  // Everything else - Network only (no caching)
  else {
    event.respondWith(fetch(event.request));
  }
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