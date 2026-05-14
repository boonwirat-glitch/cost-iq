# Phase 13 Staging Test Script

Phase 13 is diagnostic-only. Browser smoke test is optional unless you want to verify deploy output manually.

## Optional quick test

1. Replace staging files with:
   - `dist/index.html` → `index.html`
   - `dist/sw.js` → `sw.js`
2. Hard refresh.
3. Confirm app opens and previously passing core flows still work.

## Console diagnostics

```js
FreshketSenseDebug.printViewDiagnostics()
FreshketSenseDebug.viewDiagnostics()
getFreshketViewRuntimeSnapshot()
FreshketSenseViewRuntime.extractionPlan()
FreshketSenseViewRuntime.renderers()
FreshketSenseViewRuntime.domInventory()
```

Expected:

- `FreshketSenseViewRegistry.version` = `phase13-view-registry-inventory`
- `FreshketSenseViewRuntime.version` = `phase13-view-registry-inventory`
- `behaviorChanged` = `false`

## No need to deep test

This phase does not alter renderers, state mutation, loader, auth, service worker strategy, AI proxy, or chat behavior.
