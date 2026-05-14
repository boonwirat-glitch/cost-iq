# Staging Test Script — Phase 11.1

Use the generated deploy files:

```text
dist/index.html → index.html
dist/sw.js → sw.js
```

## Browser smoke test

1. Open app
2. Login / relogin
3. Splash appears and disappears normally
4. Data pill appears and disappears normally
5. Account data loads
6. Restaurant mode swipe works
7. KAM mode opens
8. Portfolio / Team view opens
9. Olive panel opens and AI proxy still works
10. Console: `FreshketSenseDebug.printBoundaryDiagnostics()` returns without error

## Expected

- Core app behavior should be unchanged from Phase 11.
- Boundary diagnostics should show config/auth/loader/state objects.
- AI proxy should remain configured via `freshket_ai_proxy_url`.
