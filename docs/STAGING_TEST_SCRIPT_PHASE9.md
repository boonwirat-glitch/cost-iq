# Phase 9 Staging Test Script

Phase 9 should be behavior-neutral. It only centralizes config/constants.

## Deploy to staging

Use generated files:

```text
index.html
sw.js
```

or if using dist output:

```text
dist/index.html -> index.html
dist/sw.js -> sw.js
```

## Hard refresh

In Chrome on Mac:

```text
Cmd + Shift + R
```

If stale service worker/cache is suspected, open DevTools and use:

```text
Empty Cache and Hard Reload
```

## Smoke checklist

1. App opens
2. Login / relogin does not hang
3. Splash shows/hides normally
4. Data pill appears and disappears
5. Account data loads
6. Restaurant mode swipe works
7. KAM mode opens
8. Portfolio / Team view does not break
9. Olive chat panel opens
10. AI response still works through Cloudflare Worker proxy

## Console checks

```js
window.FreshketSenseConfig
window.FreshketSenseConfig.app.version
window.FreshketSenseConfig.data.r2Base
window.FreshketSenseRuntime.data.r2Base
FreshketSenseDebug.snapshot()
```

Expected:

```text
window.FreshketSenseConfig.app.version = v155-phase9-config-extraction
window.FreshketSenseRuntime.data.r2Base matches FreshketSenseConfig.data.r2Base
AI proxy remains configured through freshket_ai_proxy_url
```

## If AI does not work

Check:

```js
localStorage.getItem('freshket_ai_proxy_url')
```

It must include `https://` and point to the Cloudflare Worker proxy.

## If data load breaks

Use the existing Phase 6.1 loader kill switch:

```js
FreshketSenseLoaderControl.disableRuntime('phase9 staging issue')
location.reload()
```

If the app works after disabling runtime loader, the issue is in loader runtime/config wiring. If not, the issue is elsewhere.
