// HardwarePro Service Worker
// Version — update this string when you deploy a new version
const CACHE_VERSION = 'hardwarepro-v1';
const CACHE_NAME = CACHE_VERSION;

// Files to cache for offline use
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// ============================================================
// INSTALL — cache core files
// ============================================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('SW: Some files failed to cache:', err);
      });
    }).then(() => {
      // Skip waiting — apply update immediately on next open
      return self.skipWaiting();
    })
  );
});

// ============================================================
// ACTIVATE — delete old caches, take control
// ============================================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('SW: Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Take control of all open pages immediately
      return self.clients.claim();
    })
  );
});

// ============================================================
// FETCH — network first, fallback to cache
// For API calls (Supabase): always network, no caching
// ============================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache Supabase API calls
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For the app itself: network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // If we got a valid response, cache it and return it
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed — return cached version
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // If nothing cached, return the main app
          return caches.match('/index.html');
        });
      })
  );
});

// ============================================================
// MESSAGE — allow app to trigger updates
// ============================================================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
