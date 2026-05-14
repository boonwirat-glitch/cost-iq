# Freshket Sense v155 — Phase 6 Loader Orchestration Extraction

## What changed

Phase 6 moves the Cloudflare/R2 loader orchestration into a runtime-owned layer while preserving the legacy global function names used by the monolith.

New files:

- `src/runtime/loaderOrchestrationRuntime.js`
- `src/runtime/legacyLoaderAdapter.js`
- `scripts/audit-phase6.js`

## Runtime-owned functions

The following legacy functions are now adapted to runtime-owned implementations:

- `_fetchCloudflareFile()`
- `ensureCloudflareFiles()`
- `_startCloudBackgroundLoad()`
- `loadFromCloudflareR2()`
- `reloadFromCloudflareR2()`
- `loadFromGoogleSheets()`
- `reloadFromGoogleSheets()`
- `ensureAccountDetailData()`
- `ensureSenseData()`
- `loadFromSupabaseStorage()`

## Safety design

Phase 6 still keeps the Phase 5.1 original implementations as fallback through `FreshketSenseLegacyData`.

This means if a runtime-owned loader path throws unexpectedly, the adapter logs the issue and falls back to the previous implementation rather than hard-failing the app.

## What did not change

- No UI rewrite
- No React migration
- No view renderer extraction
- No change to foreground/background loading strategy
- No change to service worker strategy beyond cache-version bump
- AI remains production proxy-only

## Debug tools

Use browser console:

```js
FreshketSenseDebug.snapshot()
FreshketSenseDebug.printStaticSmokeChecklist()
getFreshketDataRuntimeSnapshot()
FreshketSenseRuntime.data.getOrchestrationSnapshot()
```

Expected runtime data version:

```text
v155-phase6-loader-orchestration
```

## Deployment note

Use only on staging/branch until the browser checklist passes.
