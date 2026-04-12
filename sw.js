/* ══════════════════════════════════════════════════
   Pay Agent Service Worker  v3.0
   Cache Strategy: Cache-first for assets, Network-first for API
══════════════════════════════════════════════════ */

const CACHE_NAME    = 'mmf-v3';
const RUNTIME_CACHE = 'mmf-runtime-v3';

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable.png',
  // CDN assets – cached on first fetch
];

// Origins that should use network-first (API / Supabase)
const NETWORK_FIRST_ORIGINS = [
  'supabase.co',
  'googleapis.com',
];

// ── INSTALL: Pre-cache shell ──────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_ASSETS).catch(err => {
        console.warn('[SW] Pre-cache partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: Clean old caches ────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: Route strategy ─────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip chrome-extension etc
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // Network-first for Supabase / Google APIs
  if (NETWORK_FIRST_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cache-first for everything else (app shell, fonts, CDN libs)
  event.respondWith(cacheFirst(request));
});

// ── STRATEGIES ────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline fallback: serve index.html for navigation
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html') || await caches.match('/');
      if (fallback) return fallback;
    }
    return new Response('Offline — Pay Agent', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── PUSH NOTIFICATIONS (future-ready) ────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json().catch(() => ({ title: 'Pay Agent', body: event.data.text() }));
  event.waitUntil(
    data.then(d =>
      self.registration.showNotification(d.title || 'Pay Agent', {
        body: d.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'mmf-notification',
      })
    )
  );
});

// ── BACKGROUND SYNC (future-ready) ───────────────
self.addEventListener('sync', event => {
  if (event.tag === 'mmf-sync') {
    // The app handles sync on reconnect; SW signals all clients
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SYNC_REQUESTED' }))
      )
    );
  }
});
