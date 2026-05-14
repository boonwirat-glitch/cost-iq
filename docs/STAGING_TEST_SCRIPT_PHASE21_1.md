# Staging Test Script — Phase 21.1

## Basic check

1. Deploy `index.html` and `sw.js` from this package.
2. Hard refresh the app.
3. Open Chrome DevTools Console.
4. Run:

```js
FreshketSenseDebug.snapshot()
FreshketSenseDebug.printStateDiagnostics()
FreshketSenseDebug.printBoundaryDiagnostics()
```

Expected: no `knownKeys is not defined` error.

## Product smoke

The fix is diagnostics-only, but check quickly:

- login screen renders
- login/relogin works
- data loads
- navigation opens
- Olive panel opens
