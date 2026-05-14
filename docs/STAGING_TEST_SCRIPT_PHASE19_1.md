# Staging Test Script — Phase 19.1

This test is focused only on navigation/screen behavior after Phase 19.1.

## Quick browser smoke

1. Open the app.
2. Confirm login/relogin works.
3. Confirm data pill appears and disappears.
4. In restaurant mode:
   - tap Overview
   - tap Portfolio
   - tap Sense/Opportunities
   - tap Report
   - swipe between restaurant screens
5. In KAM mode:
   - switch to KAM mode
   - open Portfolio View
   - open Team View
   - open an account from Portfolio View
   - return back to Portfolio View
6. Tap the home/พอร์ต button.
7. Open Olive panel.

## Console checks

```js
FreshketSenseDebug.printNavigationDiagnostics()
FreshketSenseDebug.printStaticSmokeChecklist()
FreshketSenseDebug.snapshot()
```

Expected:

- `FreshketSenseNavigationRuntime.behaviorChanged` is `false`.
- `validation.ok` is true or acceptable based on current role/mode.
- recent calls show navigation routed through controller.
- screens/nav state updates as expected.

## Rollback expectation

Phase 19/19.1 has legacy fallback in each wrapped function. If runtime errors, the app should still call the legacy implementation.
