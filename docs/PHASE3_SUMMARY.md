# Freshket Sense v155 — Phase 3 Runtime Wiring Summary

## Goal
Start using the extracted runtime boundary without rewriting the app or changing UX behavior.

## What changed
- Added `src/runtime/freshketRuntime.js` as a classic-script runtime module.
- Replaced the old inline Olive prompt / tone guard / AI client implementations with legacy adapters.
- Kept the same global names used by the monolith:
  - `OLIVE_BASE`
  - `oliveToneClean()`
  - `getAiProxyUrl()`
  - `setAiProxyUrl()`
  - `directAiKeyModeAllowed()`
  - `callAI()`
  - `setAiProvider()`
- `callAI()` now delegates to `window.FreshketSenseRuntime.aiClient.callAI(...)`.
- `setAiProvider()` now delegates to `window.FreshketSenseRuntime.aiClient.setAiProvider(...)`.
- Bumped service worker cache to `freshket-sense-v155-phase3`.

## What did not change
- No React rewrite.
- No UI/CSS redesign.
- No data loader rewrite.
- No removal of inline `onclick` handlers.
- No change to splash/relogin/KAM/Portfolio/Team view behavior.
- No production AI secrets in browser.

## Deployment files
Use:
- `dist/index.html`
- `dist/sw.js`

For GitHub/Cloudflare Pages, copy those two files to the deployment root as `index.html` and `sw.js`.

## AI proxy reminder
Olive AI remains proxy-first. Set:

```js
localStorage.setItem('freshket_ai_proxy_url', 'https://YOUR-WORKER-DOMAIN.workers.dev')
```

Direct browser key mode stays disabled unless explicitly enabled for local testing.
