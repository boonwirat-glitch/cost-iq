// Freshket Sense — Service Worker v155-phase22.2
// Strategy: Network-first for app shell navigation + offline fallback.
//
// Fix v22.2: Removed skipWaiting() from install.
// Problem: skipWaiting() caused the new SW to activate immediately and
// clients.claim() interrupted in-flight Supabase auth on iOS PWA,
// corrupting session state mid-checkSession() and causing login loops.
// Solution: New SW waits for all tabs to close before activating.
// Cache bump ensures stale index.html is cleared on next natural reload.

const CACHE_NAME = 'freshket-sense-v155-phase22-2';
const OFFLINE_URL = '/index.html';

// Install: cache shell only — do NOT skipWaiting
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.add(OFFLINE_URL))
  );
  // No skipWaiting — let active sessions finish before SW takeover
});

// Activate: clear old caches, then claim
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
  // clients.claim() is safe here — SW only activates after all tabs close
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
