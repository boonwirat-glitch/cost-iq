// Cost IQ — Service Worker v107
// Strategy: Network-first (app ต้องการ data สด) + offline fallback

const CACHE_NAME = 'costiq-v107';
const OFFLINE_URL = '/index.html';

// Install: cache shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

// Activate: clear old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first for navigation, passthrough for others
self.addEventListener('fetch', event => {
  // Only intercept same-origin navigation requests (page loads)
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache fresh copy for offline
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(OFFLINE_URL, copy));
        return response;
      })
      .catch(() =>
        // Offline fallback
        caches.match(OFFLINE_URL)
      )
  );
});
