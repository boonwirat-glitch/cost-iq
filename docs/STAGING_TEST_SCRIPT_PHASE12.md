# Staging Test Script — Phase 12

Use the normal deploy pair:

```text
dist/index.html -> index.html
dist/sw.js -> sw.js
```

Then hard refresh.

## Smoke test

1. Open app.
2. Login / relogin.
3. Splash appears and disappears normally.
4. Data pill appears and disappears.
5. Account data loads.
6. Restaurant Overview works.
7. Restaurant swipe to Portfolio works.
8. Sense / Opportunities opens.
9. Report opens.
10. KAM mode opens.
11. Portfolio View opens.
12. Team View opens.
13. Olive panel opens; AI proxy still works.

## Console diagnostics

```js
FreshketSenseDebug.printStaticSmokeChecklist()
FreshketSenseDebug.printViewDiagnostics()
FreshketSenseDebug.printBoundaryDiagnostics()
FreshketSenseDebug.snapshot()
```

Expected:

- `view runtime exists` = ✅
- `view adapter diagnostic-only` = ✅
- `view runtime validation ok` = ✅
- `behaviorChanged` = `false`

Phase 12 should not visually change the app.
