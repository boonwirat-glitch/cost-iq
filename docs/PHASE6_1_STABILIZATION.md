# Freshket Sense v155 — Phase 6.1 Stabilization

Phase 6.1 does not add new refactor surface. It stabilizes Phase 6 loader orchestration before any further extraction.

## What changed

1. Added loader runtime kill switch / rollback controls.
2. Added loader diagnostics to `FreshketSenseDebug`.
3. Added explicit adapter status and fallback counters.
4. Bumped the service worker cache to avoid stale app shell.
5. Kept production AI proxy-only.

## Runtime controls

Open browser console:

```js
FreshketSenseLoaderControl.status()
FreshketSenseDebug.loaderDiagnostics()
FreshketSenseDebug.printLoaderDiagnostics()
```

To disable the Phase 6 loader runtime and restore legacy loader functions immediately:

```js
FreshketSenseLoaderControl.disableRuntime('staging issue')
```

Refresh is recommended after disabling.

To enable the Phase 6 loader runtime again on the next reload:

```js
FreshketSenseLoaderControl.enableRuntimeNextReload()
location.reload()
```

Alternative pre-load kill switch:

```js
localStorage.setItem('freshket_loader_runtime_disabled', '1')
location.reload()
```

Clear it:

```js
localStorage.removeItem('freshket_loader_runtime_disabled')
localStorage.removeItem('freshket_force_legacy_loader')
location.reload()
```

You can also open the app with:

```text
?freshket_loader_runtime=legacy
```

## Staging verdict rule

If the app passes with runtime mode but fails with legacy mode, the issue is not Phase 6 loader runtime.

If the app fails with runtime mode but passes with legacy mode, stop Phase 7 and debug Phase 6 orchestration.
