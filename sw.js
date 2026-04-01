// HardwarePro Service Worker v8 — CLEAN REBUILD

const SW_VERSION = 'hardwarepro-v8';
const BASE_PATH  = self.location.pathname.replace('/sw.js', '');
const INDEX_URL  = BASE_PATH + '/index.html';
const CACHE_NAME = SW_VERSION;

// ─── INSTALL ────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW v8] Installing, base:', BASE_PATH);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.add(INDEX_URL).catch(() => {}))
      .then(() => self.skipWaiting())   // activate immediately, no waiting
  );
});

// ─── ACTIVATE ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW v8] Activating — deleting old caches');
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => {
          console.log('[SW v8] Deleting old cache:', n);
          return caches.delete(n);
        })
      ))
      .then(() => self.clients.claim())   // take control immediately
  );
});

// ─── FETCH ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Only handle http/https — skip chrome-extension://, data:, etc.
  if (!url.protocol.startsWith('http')) return;

  // 2. Never touch Supabase API calls
  if (url.hostname.includes('supabase.co')) return;

  // 3. Only cache GET requests
  if (req.method !== 'GET') return;

  // 4. HTML index — network-first with cache fallback
  const isIndex =
    url.pathname === BASE_PATH + '/' ||
    url.pathname === BASE_PATH + '/index.html' ||
    url.pathname === BASE_PATH;

  if (isIndex) {
    event.respondWith(networkFirstHTML(req));
    return;
  }

  // 5. Everything else — network-first, cache on success
  event.respondWith(networkFirstStatic(req));
});

async function networkFirstHTML(req) {
  try {
    const networkRes = await fetch(req, { cache: 'no-cache' });
    if (!networkRes || networkRes.status !== 200) return networkRes;

    // Clone BEFORE reading body — order matters
    const toCache   = networkRes.clone();
    const toBuildId = networkRes.clone();
    // networkRes itself goes back to the browser untouched

    // Cache silently
    caches.open(CACHE_NAME).then(cache => {
      cache.put(INDEX_URL, toCache).catch(() => {});
    });

    // Extract build-id for auto-update detection
    toBuildId.text().then(html => {
      const m = html.match(/name="build-id" content="([^"]+)"/);
      if (!m) return;
      self.clients.matchAll({ type: 'window' }).then(clients =>
        clients.forEach(c => c.postMessage({ type: 'BUILD_CHECK', buildId: m[1] }))
      );
    }).catch(() => {});

    return networkRes;
  } catch (_) {
    // Offline — serve from cache
    const cached = await caches.match(INDEX_URL);
    return cached || new Response('Offline — open the app while connected first.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function networkFirstStatic(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type === 'basic') {
      // Cache a clone, return the original
      caches.open(CACHE_NAME).then(cache =>
        cache.put(req, res.clone()).catch(() => {})
      );
    }
    return res;
  } catch (_) {
    const cached = await caches.match(req);
    return cached || caches.match(INDEX_URL);
  }
}

// ─── MESSAGES ───────────────────────────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() =>
      event.source?.postMessage({ type: 'CACHE_CLEARED' })
    );
  }
});
