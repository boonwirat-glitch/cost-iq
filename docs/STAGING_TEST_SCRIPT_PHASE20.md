# Staging Test Script — Phase 20

Phase 20 is low-risk, but after replacing `index.html` and `sw.js`, use this quick check if convenient.

## Smoke

1. Hard refresh.
2. App opens.
3. Login/relogin still works.
4. Data pill still appears and hides.
5. Restaurant overview still renders.
6. Portfolio/SKU still renders.
7. KAM / Portfolio View / Team View still opens.
8. Bottom nav and swipe still work.
9. Olive panel opens and AI proxy still responds.

## Console diagnostics

```js
FreshketSenseDebug.printStaticSmokeChecklist()
FreshketSenseDebug.printStyleDiagnostics()
FreshketSenseDebug.printNavigationDiagnostics()
FreshketSenseDebug.snapshot()
```

Expected: style runtime exists, behavior unchanged, validation OK.
