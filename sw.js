// HardwarePro Service Worker v9 — FINAL FIX

const SW_VERSION = 'hardwarepro-v9';
const BASE_PATH  = self.location.pathname.replace('/sw.js', '');
const INDEX_URL  = BASE_PATH + '/index.html';
const CACHE_NAME = SW_VERSION;

// ── INSTALL: skip waiting immediately, cache index ──────────
self.addEventListener('install', event => {
  console.log('[SW v9] Installing');
  // Skip waiting = activate immediately without waiting for tabs to close
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.add(INDEX_URL).catch(() => {}))
  );
});

// ── ACTIVATE: claim all clients, delete ALL old caches ──────
self.addEventListener('activate', event => {
  console.log('[SW v9] Activating — nuking old caches');
  event.waitUntil(
    Promise.all([
      // Delete every cache that isn't ours
      caches.keys().then(names =>
        Promise.all(names.filter(n => n !== CACHE_NAME).map(n => {
          console.log('[SW v9] Deleting cache:', n);
          return caches.delete(n);
        }))
      ),
      // Take control of all open pages immediately
      self.clients.claim()
    ])
  );
});

// ── FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  let url;
  try { url = new URL(req.url); } catch(_) { return; }

  // Skip non-HTTP (chrome-extension://, data:, blob:, etc.)
  if (!url.protocol.startsWith('http')) return;

  // NEVER intercept Supabase API
  if (url.hostname.includes('supabase.co')) return;

  // Only cache GET requests
  if (req.method !== 'GET') return;

  // HTML index → network-first
  const isIndex =
    url.pathname === BASE_PATH + '/' ||
    url.pathname === BASE_PATH + '/index.html' ||
    url.pathname === BASE_PATH;

  if (isIndex) {
    event.respondWith(handleIndex(req));
    return;
  }

  // Everything else → network-first, cache on success
  event.respondWith(handleStatic(req));
});

async function handleIndex(req) {
  try {
    const net = await fetch(req, { cache: 'no-cache' });
    if (!net || net.status !== 200) {
      return net || fallback();
    }
    // Clone BEFORE any body read — critical order
    const c1 = net.clone();   // for cache
    const c2 = net.clone();   // for build-id check
    // net → browser (body untouched)

    caches.open(CACHE_NAME).then(cache => cache.put(INDEX_URL, c1).catch(() => {}));

    c2.text().then(html => {
      const m = html.match(/name="build-id" content="([^"]+)"/);
      if (!m) return;
      self.clients.matchAll({ type: 'window' }).then(cs =>
        cs.forEach(c => c.postMessage({ type: 'BUILD_CHECK', buildId: m[1] }))
      );
    }).catch(() => {});

    return net;
  } catch(_) {
    return caches.match(INDEX_URL).then(c => c || fallback());
  }
}

async function handleStatic(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type === 'basic') {
      const resClone = res.clone(); // clone BEFORE any async operation
      caches.open(CACHE_NAME).then(cache => cache.put(req, resClone).catch(() => {}));
    }
    return res; // original response returned untouched
  } catch(_) {
    const cached = await caches.match(req);
    return cached || caches.match(INDEX_URL);
  }
}

function fallback() {
  return new Response('Offline — open while connected first.', {
    status: 503, headers: { 'Content-Type': 'text/plain' }
  });
}

// ── MESSAGES ────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() =>
      event.source?.postMessage({ type: 'CACHE_CLEARED' })
    );
  }
});
