// Freshket Sense — Service Worker v224
// Strategy: Cache-first for app shell (instant resume) + background network update.
//
// v224: CACHE_NAME updated to freshket-sense-v224 to clear v223b cache and serve
// new index.html (v224 PWA resume fix). Behavior unchanged from v223b.
//
// Cache update strategy: stale-while-revalidate
// - Serve from cache immediately (fast)
// - Fetch network version in background
// - Update cache for next open
// - User sees latest version on the NEXT open (1 version behind max)
//
// skipWaiting() intentionally omitted — new SW waits for all tabs to close before
// activating. Prevents auth interruption mid-session.

const CACHE_NAME = 'freshket-sense-v224';
const OFFLINE_URL = '/index.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.add(OFFLINE_URL))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW v224] clearing old cache:', key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(OFFLINE_URL);

      // Background network fetch — update cache for next open
      const networkFetch = fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            cache.put(OFFLINE_URL, response.clone());
          }
          return response;
        })
        .catch(() => null);

      // Cache-first: serve cached immediately, fall back to network if no cache
      if (cached) {
        return cached; // instant — no network wait
      }
      // First install: no cache yet — wait for network
      return networkFetch || cache.match(OFFLINE_URL);
    })
  );
});
