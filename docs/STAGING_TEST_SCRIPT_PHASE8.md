# Phase 8 Staging Test Script

Phase 8 should behave the same as Phase 6.2 / Phase 7. It only changes repo/build discipline.

## Deploy to staging

Use root files after build:

- `index.html`
- `sw.js`

Or use `dist/index.html` and `dist/sw.js` if your staging workflow prefers dist output.

## Hard refresh

In Chrome on Mac:

```text
Cmd + Shift + R
```

If cache still looks stale, use DevTools → right-click refresh → Empty Cache and Hard Reload.

## Core smoke checklist

1. App opens
2. Login / relogin does not hang
3. Splash appears and disappears normally
4. Data pill appears and hides normally
5. Account data loads
6. Restaurant mode swipe works
7. KAM mode opens
8. Portfolio view works
9. Team view works
10. Olive chat panel opens
11. AI proxy still works
12. Existing AI flows still respond

## Console checks

```js
FreshketSenseDebug.snapshot()
FreshketSenseDebug.printStaticSmokeChecklist()
FreshketSenseDebug.printLoaderDiagnostics()
```

## Rollback / loader isolation

If data loading behaves strangely:

```js
FreshketSenseLoaderControl.disableRuntime('phase8 staging issue')
location.reload()
```

Re-enable:

```js
FreshketSenseLoaderControl.enableRuntimeNextReload()
location.reload()
```

## Expected result

Phase 8 should not create product-level changes. If product behavior changes, treat it as a regression and compare `src/app/index.html` against the previous Phase 7/6.2 deployable HTML.
