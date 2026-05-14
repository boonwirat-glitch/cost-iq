# Phase 9 — App Config / Constants Extraction

Working baseline: **Phase 6.2 Chat Grounding**.

Phase 9 does not redesign Olive chat, change the loader strategy, or rewrite views. It extracts app-level constants into a single config boundary so future refactor phases do not keep chasing duplicated URLs, storage keys, and data-source maps inside the monolith.

## What changed

### New config source of truth

Primary config now lives in:

```text
src/config/appConfig.js
```

The build script inlines this config into `index.html` through:

```html
<script id="freshket-sense-config">
  ...generated from src/config/appConfig.js...
</script>
```

Do not hand-edit the generated config block in root `index.html` or `dist/index.html`.

### Build input set

Phase 8 source of truth was:

```text
src/app/index.html
src/app/sw.js
```

Phase 9 source of truth is:

```text
src/app/index.html
src/app/sw.js
src/config/appConfig.js
```

Generated outputs remain:

```text
index.html
sw.js
dist/index.html
dist/sw.js
```

### Constants moved behind config boundary

Config now covers:

- app name / version / theme
- icon URL and Olive avatar URL
- Supabase public URL and publishable key
- AI proxy storage key and provider storage key
- chat FAB position storage key
- CSV IndexedDB name and TTL
- Cloudflare R2 base URL
- R2 file names and file specs
- legacy Google Sheets IDs kept for backward compatibility

## What did not change

- UI behavior
- Restaurant mode
- KAM mode
- Team / Portfolio view
- loader strategy
- AI proxy architecture
- Olive chat design
- Phase 6.2 chat grounding baseline

## Why this phase matters

Before Phase 9, constants were duplicated in multiple places:

- head manifest/icon logic
- auth setup
- AI proxy storage key
- R2 data loader
- data runtime
- loader orchestration runtime
- chat FAB drag position

This made future extraction risky because changing one URL/key could leave hidden copies behind.

Phase 9 is still not a full component refactor. It is a safer foundation for the next phases.

## How to build

```bash
npm run build
```

## How to verify

```bash
npm run verify
```

This checks that:

- config source exists
- generated root/dist index files include the config injection
- Supabase/R2/runtime constants read from the config boundary
- Phase 6.2 chat grounding is still retained
- proxy-only production remains intact
- no hardcoded Claude/Gemini secrets exist
- service worker cache is bumped to Phase 9
