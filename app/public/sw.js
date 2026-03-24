// LetsJustDrive service worker
// Caches the app shell on install; serves it offline.
// API calls (/api/*) always go to the network — never served from cache.

const CACHE = 'letsjustdrive-v1';

const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Remove old caches
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache API calls
  if (url.hostname === 'api.letsjustdrive.app' || url.pathname.startsWith('/api/')) {
    return; // fall through to network
  }

  // For navigation requests serve the cached shell (enables offline app shell)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/'))
    );
    return;
  }

  // For static assets: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
