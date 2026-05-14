# Phase 6 Plan — Loader Orchestration Extraction

## Objective
Start moving real Cloudflare/R2 orchestration out of the monolith while preserving the legacy global API.

## Safe order
1. Extract `_fetchCloudflareFile` into runtime, passing legacy dependencies through an adapter object.
2. Extract `ensureCloudflareFiles`.
3. Extract background load orchestration only after foreground load is stable.
4. Keep `loadFromCloudflareR2` as a legacy global adapter until all call sites are audited.

## Regression checklist focus
- Login/relogin does not hang.
- Foreground 5 files load first.
- SKU + alternatives continue in background.
- Data pill appears, updates, and hides smoothly.
- KAM/Team/Portfolio views render after data load.
- Sense gate can wait for heavy files when needed.
