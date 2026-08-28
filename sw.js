// Freshket Sense — Service Worker v827
// Strategy: Cache-first, background revalidate (stale-while-revalidate)
//
// v753 rewrite: fixed all redirect-related ERR_FAILED bugs.
//
// Root cause of previous failures:
//   - cache.add() stores opaqueredirect responses when Cloudflare redirects
//   - fetch(url, {redirect:'follow'}) returns response.redirected=true
//   - Chrome rejects SW responses where response.redirected=true for navigation requests
//   - request.redirect mode for navigation is 'manual', not 'follow'
//
// Fix: always strip redirect flag by creating fresh Response from body.
// Background update: fire-and-forget, never returned directly to browser.

const CACHE_NAME = 'sense-v289';
const APP_URL = '/index.html';

// v_egress (2026-08-14): รูปที่แอปใช้ทุกครั้งที่เปิด — เก็บไว้ตั้งแต่ install
// เดิมรูปพวกนี้อยู่บน Supabase ที่ส่ง `cache-control: no-cache` มาด้วย แปลว่า
// เบราว์เซอร์ถูกสั่งไม่ให้เก็บ → โหลดใหม่ทุกครั้ง ~226 ครั้ง/วัน = 288MB/วัน
// ตอนนี้ย้ายมาอยู่กับตัวแอปแล้ว + ให้ SW เก็บอีกชั้น = เปิดครั้งที่ 2 เป็นต้นไป
// ไม่มีคำขอออกเน็ตเลยแม้แต่ครั้งเดียว
const STATIC_ASSETS = [
  '/assets/sense-icon.png',
  '/assets/sense-icon-512.png',
  '/assets/olive-avatar.png',
];

// ── Fetch app HTML cleanly (no redirect leakage) ─────────────────────────────
async function fetchClean(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      cache: 'no-cache',
    });
    if (!response.ok) return null;

    // Strip redirect flag — Chrome rejects SW navigation responses where
    // response.redirected===true. Create a fresh non-redirected Response.
    const body = await response.arrayBuffer();
    const ct = response.headers.get('content-type') || 'text/html; charset=utf-8';
    return new Response(body, {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': ct },
    });
  } catch (e) {
    return null;
  }
}

// ── Install: pre-cache app shell ─────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    fetchClean(APP_URL).then(async response => {
      const cache = await caches.open(CACHE_NAME).catch(()=>null);
      if (!cache) return;
      // รูป: ล้มก็ไม่เป็นไร (offline ตอน install) SW ยัง activate ได้ปกติ
      await Promise.allSettled(STATIC_ASSETS.map(u => cache.add(u)));
      if (!response) return; // offline during install — SW still activates
      return cache.put(APP_URL, response.clone()).catch(()=>{});
    })
  );
  // v556: skipWaiting() REMOVED from install. New SW stays `waiting` until the
  // page explicitly requests activation (update pill tap) or all clients close.
  // Eliminates mid-use forced reload on deploy.
});

// ── v556: page-controlled activation ─────────────────────────────────────────
self.addEventListener('message', event => {
  if (event && event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ── Activate: clear old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW v248] clearing old cache:', key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: handle navigation requests only ───────────────────────────────────
// v851: intercept ONLY the Sense app shell ('/' and '/index.html'). Before
// this, EVERY navigation (including /nrr and /dashboard) was answered with
// the cached index.html — so any browser that had ever opened Sense would
// get the Sense shell when navigating to sibling pages. Whitelisting the
// shell frees /nrr, /dashboard, and any future sibling page to load from
// the network on their own release cadence, untouched by this cache.
self.addEventListener('fetch', event => {
  const path = new URL(event.request.url).pathname;

  // v_egress: รูปในโฟลเดอร์ assets — เอาจาก cache ก่อนเสมอ (ไฟล์ไม่เคยเปลี่ยน
  // ระหว่าง build เดียวกัน และ activate ล้าง cache เก่าทิ้งอยู่แล้วตอนขึ้นเวอร์ชันใหม่)
  if (path.startsWith('/assets/')) {
    event.respondWith(handleAsset(event.request));
    return;
  }

  if (event.request.mode !== 'navigate') return;
  if (path !== '/' && path !== '/index.html') return; // sibling pages → network

  event.respondWith(handleNavigate());
});

async function handleAsset(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(request);
    if (hit) return hit;
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone()).catch(()=>{});
    return res;
  } catch (e) {
    return fetch(request);   // cache พัง → ปล่อยผ่านไปเน็ตตามปกติ
  }
}

async function handleNavigate() {
  const cache = await caches.open(CACHE_NAME);

  // 1. Try cache
  try {
    const cached = await cache.match(APP_URL);
    if (cached && cached.ok && cached.status === 200) {
      // Background revalidate — updates cache for next visit
      fetchClean(APP_URL)
        .then(fresh => { if (fresh) cache.put(APP_URL, fresh.clone()).catch(()=>{}); })
        .catch(() => {});
      return cached;
    }
  } catch (e) { /* cache read failed — fall through to network */ }

  // 2. No clean cache — fetch from network
  const fresh = await fetchClean(APP_URL);
  if (fresh) {
    cache.put(APP_URL, fresh.clone()).catch(() => {});
    return fresh;
  }

  // 3. Offline with no cache — show retry page
  return new Response(
    `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Freshket Sense</title>
<style>
  body{margin:0;background:#061410;color:#fff;
       font-family:'IBM Plex Sans Thai',system-ui,sans-serif;
       display:flex;align-items:center;justify-content:center;
       min-height:100vh;text-align:center;padding:20px}
  h2{font-size:18px;font-weight:600;margin:0 0 8px}
  p{font-size:13px;color:rgba(255,255,255,.5);margin:0 0 28px;line-height:1.6}
  button{background:rgba(0,208,112,.15);border:1px solid rgba(0,208,112,.35);
         color:#00d070;border-radius:12px;padding:12px 28px;font-size:14px;
         cursor:pointer;font-family:inherit}
</style></head>
<body><div>
  <div style="font-size:40px;margin-bottom:16px">⟳</div>
  <h2>กำลังเชื่อมต่อ</h2>
  <p>โปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ต<br>แล้วลองเปิดใหม่อีกครั้ง</p>
  <button onclick="location.reload()">ลองอีกครั้ง</button>
</div></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

