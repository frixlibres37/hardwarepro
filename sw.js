// HardwarePro Service Worker v6 (FIXED & SAFE)

const SW_VERSION = 'hardwarepro-v6';

// Base path
const BASE_PATH = self.location.pathname.replace('/sw.js', '');
const INDEX_URL = BASE_PATH + '/index.html';
const MANIFEST_URL = BASE_PATH + '/manifest.json';
const CACHE_NAME = SW_VERSION;

// ============================================================
// INSTALL
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW v6] Installing');

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled([
        cache.add(INDEX_URL),
        cache.add(MANIFEST_URL),
        cache.add(BASE_PATH + '/'),
      ]);
    }).then(() => self.skipWaiting())
  );
});

// ============================================================
// ACTIVATE
// ============================================================
self.addEventListener('activate', event => {
  console.log('[SW v6] Activating');

  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names
          .filter(n => n !== CACHE_NAME)
          .map(n => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH
// ============================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ==========================================================
  // ❌ DO NOT TOUCH SUPABASE (CRITICAL FIX)
  // ==========================================================
  if (url.hostname.includes('supabase.co')) {
    return; // let browser handle it normally
  }

  // ==========================================================
  // HTML (index) — NETWORK FIRST
  // ==========================================================
  const isHTML =
    url.pathname === BASE_PATH + '/' ||
    url.pathname === BASE_PATH + '/index.html' ||
    url.pathname === BASE_PATH;

  if (isHTML) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(networkRes => {
          if (!networkRes || networkRes.status !== 200) return networkRes;

          // ✅ SAFE CLONES
          const cacheCopy1 = networkRes.clone();
          const cacheCopy2 = networkRes.clone();
          const textCopy   = networkRes.clone();

          // Cache
          caches.open(CACHE_NAME).then(cache => {
            cache.put(INDEX_URL, cacheCopy1);
            cache.put(BASE_PATH + '/', cacheCopy2);
          });

          // Check build ID (safe)
          textCopy.text().then(html => {
            const match = html.match(/name="build-id" content="([^"]+)"/);
            if (match) {
              self.clients.matchAll({ type: 'window' }).then(clients => {
                clients.forEach(c => {
                  c.postMessage({
                    type: 'BUILD_CHECK',
                    buildId: match[1]
                  });
                });
              });
            }
          });

          return networkRes;
        })
        .catch(() =>
          caches.match(INDEX_URL).then(cached =>
            cached || caches.match(BASE_PATH + '/')
          )
        )
    );
    return;
  }

  // ==========================================================
  // manifest.json — NETWORK FIRST
  // ==========================================================
  if (url.pathname.includes('manifest.json')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(res => {
          if (res && res.status === 200) {
            caches.open(CACHE_NAME).then(c =>
              c.put(event.request, res.clone())
            );
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ==========================================================
  // STATIC FILES — NETWORK FIRST + CACHE FALLBACK
  // ==========================================================
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (
          res &&
          res.status === 200 &&
          res.type === 'basic' &&
          event.request.method === 'GET'
        ) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, resClone);
          });
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then(cached =>
          cached || caches.match(INDEX_URL)
        )
      )
  );
});

// ============================================================
// MESSAGE
// ============================================================
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.source?.postMessage({ type: 'CACHE_CLEARED' });
    });
  }
});
