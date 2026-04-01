// HardwarePro Service Worker v7 (FIXED)

const SW_VERSION = 'hardwarepro-v7';

const BASE_PATH = self.location.pathname.replace('/sw.js', '');
const INDEX_URL = BASE_PATH + '/index.html';
const MANIFEST_URL = BASE_PATH + '/manifest.json';
const CACHE_NAME = SW_VERSION;

// ============================================================
// INSTALL
// ============================================================
self.addEventListener('install', event => {
  console.log('[SW v7] Installing');
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
  console.log('[SW v7] Activating');
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

  // ── Skip non-http/https (e.g. chrome-extension://) ────────
  if (!url.protocol.startsWith('http')) return;

  // ── Skip Supabase — never intercept API calls ─────────────
  if (url.hostname.includes('supabase.co')) return;

  // ── HTML (index) — NETWORK FIRST ──────────────────────────
  const isHTML =
    url.pathname === BASE_PATH + '/' ||
    url.pathname === BASE_PATH + '/index.html' ||
    url.pathname === BASE_PATH;

  if (isHTML) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(networkRes => {
          if (!networkRes || networkRes.status !== 200) return networkRes;

          // ✅ Clone FIRST before any body consumption
          const forCache1  = networkRes.clone();
          const forCache2  = networkRes.clone();
          const forBuildId = networkRes.clone(); // clone for .text()
          // networkRes itself is returned to the browser — body untouched

          // Cache both URL forms
          caches.open(CACHE_NAME).then(cache => {
            cache.put(INDEX_URL,           forCache1);
            cache.put(BASE_PATH + '/',     forCache2);
          });

          // Read build-id from the clone — safe, networkRes body is intact
          forBuildId.text().then(html => {
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

          return networkRes; // ✅ body not yet read — safe to return
        })
        .catch(() =>
          caches.match(INDEX_URL).then(cached =>
            cached || caches.match(BASE_PATH + '/')
          )
        )
    );
    return;
  }

  // ── manifest.json — NETWORK FIRST ─────────────────────────
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

  // ── Static files — NETWORK FIRST + cache fallback ─────────
  // Skip non-GET and non-basic (cross-origin) requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, res.clone()));
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
