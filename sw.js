// Freshket Sense — Service Worker v224d
// Strategy: Cache-first for app shell (instant resume) + background network update.
//
// v223b: Changed from network-first to cache-first for navigation.
// Reason: On iOS PWA, every resume = full page reload. Network-first added
// 200-500ms of network round-trip before any JS could start. Cache-first
// serves the cached HTML instantly (~0ms), then updates the cache in background.
// Result: JS starts ~300ms faster on every resume.
//
// Cache update strategy: stale-while-revalidate
// - Serve from cache immediately (fast)
// - Fetch network version in background
// - Update cache for next open
// - User sees latest version on the NEXT open (1 version behind max)
//
// skipWaiting() intentionally omitted — see v195 comment.
// New SW waits for all tabs to close before activating (prevents auth interruption).

const CACHE_NAME = 'freshket-sense-v224d';
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
            console.log('[SW v223b] clearing old cache:', key);
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

      // Background network fetch — update cache for next open.
      // v224e: fetch OFFLINE_URL directly (not event.request) to avoid Safari iOS
      // "Response served by service worker has redirections" error.
      // Cloudflare redirects '/' → '/index.html'; fetching event.request would
      // cache an opaqueredirect response which Safari PWA rejects on navigation.
      const networkFetch = fetch(OFFLINE_URL, {redirect: 'follow'})
        .then(response => {
          if (response && response.ok && response.type !== 'opaqueredirect') {
            cache.put(OFFLINE_URL, response.clone());
          }
          return (response && response.type !== 'opaqueredirect') ? response : null;
        })
        .catch(() => null);

      // Cache-first: serve cached immediately, fall back to network if no cache
      if (cached) {
        return cached; // instant — no network wait
      }

      // v224e fix: no cache yet — await network properly.
      // Original code had `return networkFetch || cache.match(...)` which is a bug:
      // networkFetch is a Promise (always truthy), so || branch never ran.
      // When network fails, Promise resolved to null → browser got null → ERR_FAILED.
      const netResponse = await networkFetch;
      if (netResponse && netResponse.ok) return netResponse;

      // Network failed AND no cache — show a graceful page instead of ERR_FAILED.
      // User sees a retry button; pressing it reloads once SW is ready.
      return new Response(
        `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Freshket Sense</title>
<style>
  body{margin:0;background:#061410;color:#fff;font-family:'IBM Plex Sans Thai',sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
  .icon{font-size:48px;margin-bottom:20px}
  h2{font-size:18px;font-weight:600;margin:0 0 8px}
  p{font-size:13px;color:rgba(255,255,255,.5);margin:0 0 28px;line-height:1.6}
  button{background:rgba(0,208,112,.15);border:1px solid rgba(0,208,112,.35);color:#00d070;
         border-radius:12px;padding:12px 28px;font-size:14px;cursor:pointer;
         font-family:inherit;transition:background .15s}
  button:active{background:rgba(0,208,112,.25)}
</style></head>
<body><div>
  <div class="icon">⟳</div>
  <h2>กำลังเชื่อมต่อ</h2>
  <p>โปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ต<br>แล้วลองเปิดใหม่อีกครั้ง</p>
  <button onclick="location.reload()">ลองอีกครั้ง</button>
</div></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    })
  );
});
