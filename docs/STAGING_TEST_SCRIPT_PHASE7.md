# Phase 7 Staging Test Script

After uploading the Phase 7 repo structure to a staging branch or staging Pages project, test:

1. App opens
2. Login / relogin does not hang
3. Splash appears/disappears normally
4. Data pill appears and disappears
5. Account data loads
6. Restaurant mode swipe works
7. KAM mode opens
8. Portfolio / Team view do not break
9. Olive chat panel opens
10. Olive chat responds through AI proxy
11. KAM Insight / Team Insight / Sense AI flows still run

Console diagnostics:

```js
FreshketSenseDebug.snapshot()
FreshketSenseDebug.printLoaderDiagnostics()
FreshketSenseDebug.printStaticSmokeChecklist()
localStorage.getItem('freshket_ai_proxy_url')
```

If data loading appears broken, isolate the runtime loader:

```js
FreshketSenseLoaderControl.disableRuntime('phase7 staging issue')
location.reload()
```

Re-enable:

```js
FreshketSenseLoaderControl.enableRuntimeNextReload()
location.reload()
```
