# Staging Test Script — Phase 21

Deploy the Phase 21 root files or dist files, then hard refresh.

## Quick pass

1. Open app.
2. Login/relogin.
3. Confirm splash exits.
4. Confirm data pill exits.
5. Select/open an account.
6. Test Restaurant Overview.
7. Test Portfolio/SKU.
8. Test Sense/Opportunities.
9. Test Report.
10. Test KAM mode.
11. Test Portfolio View and Team View.
12. Open Olive panel and ask a simple AI question.

## Console diagnostics

```js
FreshketSenseDebug.snapshot()
FreshketSenseDebug.printStaticSmokeChecklist()
FreshketSenseDebug.printBoundaryDiagnostics()
FreshketSenseDebug.printNavigationDiagnostics()
FreshketSenseDebug.printStyleDiagnostics()
```
