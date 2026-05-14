# Staging Test Script — Phase 10

Deploy the Phase 10 root files or dist files as usual:

```text
index.html
sw.js
```

Hard refresh after deploy.

## Required checks

1. Open app
2. Login with normal user
3. Confirm splash appears and disappears smoothly
4. Confirm data pill appears and disappears
5. Confirm account data loads
6. Reload while logged in; app should relogin/session-resume without hanging
7. Sign out; login overlay should return cleanly
8. Login again
9. KAM mode opens
10. Portfolio / Team view does not break
11. Olive panel opens
12. AI proxy still works

## Console diagnostics

```js
FreshketSenseDebug.printAuthDiagnostics()
FreshketSenseDebug.printStaticSmokeChecklist()
FreshketSenseDebug.snapshot()
```

## Rollback auth runtime only

If login/relogin/splash behaves strangely:

```js
FreshketSenseAuthControl.disableRuntime('staging auth issue')
location.reload()
```

If the problem disappears after this, the issue is in Phase 10 auth wrapper path.

Re-enable:

```js
FreshketSenseAuthControl.enableRuntimeNextReload()
location.reload()
```
