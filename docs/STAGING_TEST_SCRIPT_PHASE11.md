# Phase 11 staging smoke test

Deploy root `index.html` and `sw.js`, then hard refresh.

Checks: open app, login/relogin, splash, data pill, account data, Restaurant swipe, KAM mode, Portfolio/Team, Olive panel + AI proxy.

Console:
```js
FreshketSenseDebug.printStaticSmokeChecklist()
FreshketSenseDebug.printStateDiagnostics()
FreshketSenseDebug.snapshot()
```

Expected: state runtime exists, state control exists, storage facade exists.
