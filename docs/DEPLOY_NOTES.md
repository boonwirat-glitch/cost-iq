# Deploy notes

## Files to deploy

For the current GitHub/Cloudflare workflow, deploy:

- `dist/index.html`
- `dist/sw.js`

Do not deploy source modules alone unless a build step is added.

## Before production

1. Deploy the AI proxy Worker first.
2. Set the app proxy URL in the browser or hardcode it via environment injection.
3. Test login/relogin/splash.
4. Test Freshket Sense data load.
5. Test Olive chat.
6. Verify old app shell is not stuck by checking service worker cache name.

## Cache warning

Because the service worker caches `/index.html`, changing `CACHE_NAME` is required when deploying a materially changed app shell. Phase 2 uses `freshket-sense-v155-phase2`.
