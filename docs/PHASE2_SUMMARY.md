# Freshket Sense v155 — Phase 2 Safe Modularization

## What changed

Phase 2 keeps `dist/index.html` deployable while starting real module boundaries in `src/`:

- `src/ai/olivePrompt.js` — Olive base prompt and tone guard.
- `src/services/aiClient.js` — AI proxy boundary and provider router.
- `src/data/cloudflareDataLoader.js` — R2 CSV loader, foreground/background load behavior.
- `src/ui/dataPill.js` — data loading pill behavior.
- `src/ui/chatFab.js` — Olive FAB open/close/drag behavior.
- `src/config/appConfig.js` — central config constants.
- `dist/sw.js` — service worker copied from uploaded `sw.js`, cache bumped to `freshket-sense-v155-phase2`.

## Important safety decision

`dist/index.html` remains monolith-compatible in this phase. The extracted modules are source targets for review and the next wiring phase, not yet separate runtime imports. This avoids breaking inline handlers and global state while giving future edits a clear file boundary.

## AI / security

No production Claude/Gemini key is embedded in the HTML. AI calls should go through a Cloudflare Worker or backend proxy set via:

```js
localStorage.setItem('freshket_ai_proxy_url', 'https://YOUR-WORKER-DOMAIN.workers.dev')
```

Direct browser-key mode remains disabled by default.

## Service worker

The uploaded service worker was network-first for navigation and cached `/index.html` as offline fallback. Phase 2 keeps that strategy but bumps the cache name so users do not stay on an old shell after deployment.

## What is intentionally not changed

- No React rewrite.
- No CSS redesign.
- No data loading strategy change.
- No Olive personality rewrite.
- No removal of inline `onclick` yet.
- No changes to KAM / Portfolio / Team view behavior.

## Recommended next phase

Phase 3 should wire selected extracted modules into runtime behind global adapters, starting with AI client and Olive prompt, then data loader, then UI handlers.
