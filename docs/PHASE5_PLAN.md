# Phase 5 Plan — Extract Loader Implementation

Recommended next step after Phase 4:

1. Move `_csvOpen`, `_csvCacheGet`, `_csvCacheSet`, `_csvCacheClear` into a real storage service.
2. Move `_fetchTextWithTimeout` and R2 config into a real data service.
3. Move data pill DOM updates into `src/ui/dataPill.js` and have legacy helpers delegate to it.
4. Keep old function names as adapters until all internal call sites use the runtime service.
5. Only after loader extraction is stable, start moving view renderers.

Do not start React conversion yet.
