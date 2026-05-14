# Phase 9.1 Staging Test Script

Use this after deploying the Phase 9.1 package to staging.

## Deploy files

If using the current root-file Cloudflare Pages workflow, deploy:

```text
index.html
sw.js
```

These files are generated from:

```text
src/app/index.html
src/app/sw.js
src/config/appConfig.js
```

## Hard refresh

In Chrome on Mac:

```text
Cmd + Shift + R
```

If needed, open DevTools and use **Empty Cache and Hard Reload**.

## Console diagnostics

Run:

```js
FreshketSenseDebug.printConfigDiagnostics()
FreshketSenseDebug.printStaticSmokeChecklist()
FreshketSenseDebug.printLoaderDiagnostics()
FreshketSenseDebug.snapshot()
```

Expected:

- Config object exists.
- Version is `v155-phase9-1-safety-audit`.
- AI is proxy-only.
- Supabase public config exists.
- R2 base exists.
- Service worker url is `/sw.js`.
- Loader runtime exists.

## Manual smoke test

1. App opens.
2. Login / relogin does not hang.
3. Splash appears and disappears normally.
4. Data pill appears and disappears.
5. Account data loads.
6. Restaurant mode swipe works.
7. KAM mode opens.
8. Portfolio / Team view does not break.
9. Olive panel opens.
10. AI proxy still works.

## If data load is weird

Use the existing Phase 6.1 kill switch:

```js
FreshketSenseLoaderControl.disableRuntime('phase9.1 staging issue')
location.reload()
```

Re-enable:

```js
FreshketSenseLoaderControl.enableRuntimeNextReload()
location.reload()
```
