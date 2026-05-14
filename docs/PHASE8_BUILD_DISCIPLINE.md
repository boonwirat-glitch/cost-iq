# Phase 8 — Build Discipline / Source-of-Truth Cleanup

## Decision

Phase 8 keeps **Phase 6.2 Chat Grounding** as the working baseline.

This phase does not change product behavior. It makes the repo safer to work in by defining a single app-shell source of truth.

## What changed

### 1. Active app source moved to `src/app/`

Source of truth:

- `src/app/index.html`
- `src/app/sw.js`

Generated outputs:

- `index.html`
- `sw.js`
- `dist/index.html`
- `dist/sw.js`

`npm run build` now copies from `src/app/*` into root and `dist/`.

### 2. Root/dist files are generated outputs

Root files still exist because the current GitHub/Cloudflare workflow expects:

- `/index.html`
- `/sw.js`

But they should no longer be edited directly during normal refactor work.

### 3. Older active baseline copies were moved out of the active path

Older Phase 6.1 active copies were moved under:

- `src/archive/legacy-baselines/`

Phase 7 legacy files remain in `src/legacy/` as historical reference, but Phase 8 active source is `src/app/`.

### 4. Service worker cache bumped

Cache name is now:

```js
freshket-sense-v155-phase8
```

The strategy remains network-first navigation + offline fallback.

### 5. Source scaffold cleanup

`src/runtime/debugRuntime.js` was trimmed back to the debug runtime utility only. It had accidentally carried unrelated legacy JS tail content from an earlier extraction.

This cleanup does not affect the live app shell because the deployable runtime remains generated from `src/app/index.html`.

## What did not change

- No UI redesign
- No React rewrite
- No loader strategy change
- No Olive chat redesign
- No AI proxy behavior change
- No KAM / Restaurant / Team / Portfolio view changes

## Why this phase matters

Before Phase 8, the repo had multiple plausible app-shell files:

- root `index.html`
- `dist/index.html`
- `src/legacy/index.v155.phase7.html`

That was dangerous because future edits could happen in the wrong file.

After Phase 8, the rule is simple:

```text
Edit src/app/*
Run npm run build
Deploy root index.html + sw.js, or dist/index.html + dist/sw.js
```
