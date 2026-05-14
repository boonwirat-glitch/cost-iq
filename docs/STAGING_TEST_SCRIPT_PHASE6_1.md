# Phase 6.1 Staging Test Script

## 0) Deploy to staging

Copy:

```text
dist/index.html -> index.html
dist/sw.js -> sw.js
```

Hard refresh once.

## 1) Static checks

Console:

```js
FreshketSenseDebug.printStaticSmokeChecklist()
FreshketSenseDebug.printLoaderDiagnostics()
```

Expected:

- loader control exists
- loader adapter status exists
- mode is `runtime`
- service worker supported
- direct browser key mode disabled

AI proxy can be unset during local/staging unless testing Olive.

## 2) Core flow checks

1. Open app.
2. Splash/login renders normally.
3. Login/relogin does not hang.
4. Data pill appears and disappears.
5. Account data appears.
6. Restaurant mode swipe works.
7. KAM mode opens.
8. Portfolio/Team view renders.
9. Sense gate does not hang.
10. Olive chat opens.

## 3) Rollback comparison

If any loader/data issue appears, run:

```js
FreshketSenseLoaderControl.disableRuntime('staging comparison')
location.reload()
```

Retest only the failing flow.

If the issue disappears, Phase 6 loader orchestration needs debugging.

Re-enable runtime:

```js
FreshketSenseLoaderControl.enableRuntimeNextReload()
location.reload()
```
