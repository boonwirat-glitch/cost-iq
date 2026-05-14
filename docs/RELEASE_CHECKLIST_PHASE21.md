# Phase 21 Release Checklist

## Before deploy

- [ ] Confirm package is Phase 21.
- [ ] Run `npm run verify`.
- [ ] Confirm no Claude/Gemini API key exists in repo.
- [ ] Confirm Cloudflare Worker AI proxy is deployed.
- [ ] Confirm app has `freshket_ai_proxy_url` configured in browser/staging where needed.

## Deploy files

Current workflow can deploy root files:

```text
index.html
sw.js
```

Future build-driven workflow can deploy:

```text
dist/index.html
dist/sw.js
```

## After deploy

- [ ] Hard refresh.
- [ ] Confirm service worker cache is updated.
- [ ] Run browser smoke checklist from `FINAL_REGRESSION_MATRIX.md`.
- [ ] Confirm AI proxy calls work.
- [ ] Confirm core views still render.

## Rollback plan

If deployment breaks core app behavior:

1. Revert to the previous known-good package.
2. Hard refresh / clear service worker cache.
3. Use runtime diagnostics to isolate issue:

```js
FreshketSenseDebug.snapshot()
FreshketSenseDebug.printStaticSmokeChecklist()
FreshketSenseDebug.printBoundaryDiagnostics()
FreshketSenseDebug.printNavigationDiagnostics()
```

Known runtime kill switches retained:

```js
FreshketSenseLoaderControl.disableRuntime('issue')
FreshketSenseAuthControl.disableRuntime('issue')
```

Renderer and navigation boundaries retain legacy fallback paths.
