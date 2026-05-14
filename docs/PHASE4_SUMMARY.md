# Phase 4 Summary — Data Runtime Boundary

## What changed

- Added `src/runtime/dataRuntime.js` as a safe data facade.
- Added `src/runtime/legacyDataAdapter.js` to keep old global function names alive.
- Wrapped key data functions without changing their behavior:
  - `loadFromCloudflareR2`
  - `reloadFromCloudflareR2`
  - `ensureCloudflareFiles`
  - `ensureAccountDetailData`
  - `ensureSenseData`
  - data pill helpers
  - data panel helpers
- Added debug snapshot helper: `getFreshketDataRuntimeSnapshot()`.
- Bumped service worker cache to `freshket-sense-v155-phase4`.

## What did not change

- No UI rewrite.
- No React migration.
- No change to Cloudflare/R2 file names or loading order.
- No change to foreground/background strategy.
- No removal of inline `onclick`.

## Why this phase is intentionally conservative

The loader is connected to auth, splash/relogin, data pill, IndexedDB cache, heavy-file memory rules, KAM/Team rendering, matcher status, and Sense gates. Moving the implementation out of the monolith in one step would create unnecessary regression risk. Phase 4 creates the seam first.

## Manual regression checklist

1. Fresh login shows splash and enters app.
2. Relogin does not loop or hang.
3. Data pill appears during initial load and hides after readiness.
4. Foreground files load first.
5. `skus` + `alternatives` continue in background.
6. `Refresh data` clears cache and reloads.
7. Restaurant mode still swipes correctly.
8. KAM mode still renders selected account.
9. Team view is not affected by portfolio collapse behavior.
10. Olive still requires AI proxy for production AI calls.
