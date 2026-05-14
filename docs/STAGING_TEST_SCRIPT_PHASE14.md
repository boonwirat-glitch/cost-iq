# Staging Test Script — Phase 14

Phase 14 is low-risk and diagnostic-only. Full manual smoke test is optional.

## Minimal console checks

After deploying staging, open Console and run:

```js
FreshketSenseDebug.printStaticSmokeChecklist()
FreshketSenseDebug.printReadModelDiagnostics()
FreshketSenseDebug.snapshot()
```

Expected:

- read model runtime exists
- read model validation ok
- behaviorChanged is false
- proxy-only production remains true

## Optional app checks

- Open app
- Confirm login/relogin still works
- Confirm account data still loads
- Confirm one Restaurant view and one KAM/Portfolio/Team view still open
- Confirm Olive panel still opens

Actual browser smoke is more important after Phase 15, because that will extract an actual renderer.
