// Freshket Sense — Service Worker v223
// Strategy: Network-first for app shell + offline fallback.
//
// v223: Bump CACHE_NAME to match HTML version on every deployment.
// Rule: whenever index.html version changes, update CACHE_NAME here too.
// This ensures activate() clears old caches and offline fallback stays current.
//
// skipWaiting() intentionally omitted — see v195 comment.
// iOS PWA: kill app → SW activates on next open → one reload via controllerchange.
// This is expected and happens once per SW update, not on every open.

const CACHE_NAME = 'freshket-sense-v223';
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
            console.log('[SW v223] clearing old cache:', key);
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
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(OFFLINE_URL, copy));
        return response;
      })
      .catch(() => caches.match(OFFLINE_URL))
  );
});
