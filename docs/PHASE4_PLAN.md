# Phase 4 Plan — Data Runtime Boundary

Recommended next step after Phase 3:

1. Move Cloudflare/R2 foreground + background loading behind a runtime adapter.
2. Keep existing global functions alive while delegating to the runtime layer.
3. Split data status UI (`data pill`, `data panel status`) after the loader adapter is stable.
4. Only after that, start removing inline handlers.

Do not refactor Restaurant/KAM/Portfolio views yet. Data load stability is more important.
