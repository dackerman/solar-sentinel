const CACHE_NAME = 'solar-sentinel-v3';
const STATIC_CACHE = 'solar-sentinel-static-v3';
const RUNTIME_CACHE = 'solar-sentinel-runtime-v3';

// Files to cache immediately
const STATIC_FILES = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// External resources to cache
const EXTERNAL_RESOURCES = [
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Install event - cache static files
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  
  event.waitUntil(
    Promise.all([
      // Cache static files
      caches.open(STATIC_CACHE).then((cache) => {
        console.log('[SW] Caching static files');
        return cache.addAll(STATIC_FILES);
      }),
      // Cache external resources
      caches.open(RUNTIME_CACHE).then((cache) => {
        console.log('[SW] Caching external resources');
        return cache.addAll(EXTERNAL_RESOURCES);
      })
    ]).then(() => {
      console.log('[SW] Installation complete');
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => {
            return cacheName !== STATIC_CACHE && 
                   cacheName !== RUNTIME_CACHE;
          })
          .map((cacheName) => {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    }).then(() => {
      console.log('[SW] Activation complete');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle API requests with network-first strategy
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone response to cache it
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(request);
        })
    );
    return;
  }

  // Handle static files with cache-first strategy
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      // Not in cache, fetch from network
      return fetch(request).then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Clone response to cache it
        const responseClone = response.clone();
        
        // Cache external resources and static files
        if (url.origin !== location.origin || STATIC_FILES.includes(url.pathname)) {
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseClone);
          });
        }

        return response;
      });
    })
  );
});