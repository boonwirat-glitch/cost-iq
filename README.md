# Freshket Sense v155 — Phase 21 Final Audit / Regression Package

This package is the current post-refactor baseline for Freshket Sense v155.

## Current baseline

- Working product baseline: **Phase 6.2 Chat Grounding**
- Current refactor package: **Phase 21 — Final Audit / Regression Package**
- AI mode: **Cloudflare Worker proxy-only** in production
- Browser-held Claude/Gemini keys: **not allowed**
- Olive Chat quality issues: **known and parked** until core refactor is complete

## Source of truth

Edit source files, then run `npm run build` or `npm run verify`.

Primary source files:

```text
src/app/index.html
src/app/sw.js
src/config/appConfig.js
src/runtime/*
src/views/*
src/styles/uiTokenRegistry.js
workers/ai-proxy-cloudflare-worker.js
```

Generated deploy files:

```text
index.html
sw.js
dist/index.html
dist/sw.js
```

Do not manually edit root `index.html`, root `sw.js`, or `dist/*` except for an emergency hotfix. They are generated from source.

## Deploy workflow

For the current Cloudflare Pages/GitHub workflow, deploy the root files:

```text
index.html
sw.js
```

The repo also includes `dist/index.html` and `dist/sw.js` for future build-driven deployment.

## Verify

```bash
npm run verify
```

This runs:

```text
build
secret check
Phase 21 final audit
```

## Final browser smoke test

Before treating this as production-ready, run the checklist in:

```text
docs/FINAL_REGRESSION_MATRIX.md
docs/RELEASE_CHECKLIST_PHASE21.md
```

## Important notes

- Core refactor is now scaffolded with runtime boundaries, read model, renderer boundaries, navigation boundary, and diagnostics.
- CSS remains inline by design to avoid mobile/PWA/cache regressions.
- Olive Chat is not considered final product quality. Do not keep prompt-patching during this core refactor branch; redesign it separately as Olive Chat v2.
