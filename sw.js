// HardwarePro Service Worker v5
// AUTO-UPDATE: detects new deployments and refreshes app automatically
// Handles /hardwarepro/ subpath on GitHub Pages

const SW_VERSION = 'hardwarepro-v5';

// Base path = /hardwarepro (derived from sw.js location)
const BASE_PATH = self.location.pathname.replace('/sw.js', '');
const INDEX_URL = BASE_PATH + '/index.html';
const MANIFEST_URL = BASE_PATH + '/manifest.json';
const CACHE_NAME = SW_VERSION;

// ============================================================
// INSTALL — cache app shell immediately
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW v5] Installing, base:', BASE_PATH);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled([
        cache.add(INDEX_URL),
        cache.add(MANIFEST_URL),
        cache.add(BASE_PATH + '/'),
      ].map(p => p.catch(e => console.warn('[SW] Cache miss:', e))));
    }).then(() => {
      console.log('[SW v5] Install complete');
      return self.skipWaiting(); // activate immediately
    })
  );
});

// ============================================================
// ACTIVATE — delete ALL old caches, take control
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW v5] Activating');
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => {
          console.log('[SW] Purging old cache:', n);
          return caches.delete(n);
        })
      ))
      .then(() => self.clients.claim())
      .then(() => {
        // Tell all open tabs to reload so they get the fresh version
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => {
            client.postMessage({ type: 'SW_UPDATED', version: SW_VERSION });
          });
        });
      })
  );
});

// ============================================================
// FETCH — smart strategy per resource type
// ============================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ── Supabase API ── never cache, return offline stub on failure
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request, { credentials: 'omit' })
        .catch(() => new Response(
          JSON.stringify({ data: null, error: { message: 'offline' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // ── App HTML (index.html) ── NETWORK FIRST with cache fallback
  // This ensures updates are always picked up when online
  const isHTML = url.pathname === BASE_PATH + '/' ||
                 url.pathname === BASE_PATH + '/index.html' ||
                 url.pathname === BASE_PATH;

  if (isHTML) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })  // bypass HTTP cache
        .then(networkRes => {
          if (networkRes && networkRes.status === 200) {
            // Store fresh version in SW cache
            caches.open(CACHE_NAME).then(cache => {
              cache.put(INDEX_URL, networkRes.clone());
              cache.put(BASE_PATH + '/', networkRes.clone());
            });
            // Check if build ID changed — notify app
            networkRes.clone().text().then(html => {
              const match = html.match(/name="build-id" content="([^"]+)"/);
              if (match) {
                self.clients.matchAll({ type: 'window' }).then(clients => {
                  clients.forEach(c => c.postMessage({
                    type: 'BUILD_CHECK',
                    buildId: match[1]
                  }));
                });
              }
            });
          }
          return networkRes;
        })
        .catch(() => {
          // Offline: serve cached version
          return caches.match(INDEX_URL)
            .then(cached => cached || caches.match(BASE_PATH + '/'));
        })
    );
    return;
  }

  // ── manifest.json ── network first, cache fallback
  if (url.pathname.includes('manifest.json')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(res => {
          if (res && res.status === 200) {
            caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ── Everything else ── network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(event.request)
        .then(c => c || caches.match(INDEX_URL))
      )
  );
});

// ============================================================
// MESSAGE — control from app
// ============================================================
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.source.postMessage({ type: 'CACHE_CLEARED' });
    });
  }
});
