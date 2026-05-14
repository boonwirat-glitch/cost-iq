# Phase 20 — CSS / UI Token Cleanup + Final Build Cleanup

## Baseline

Working baseline remains **Phase 6.2 Chat Grounding**, with known Olive chat issues parked. Phase 20 builds on Phase 19.1 navigation regression stabilization.

## Scope

Phase 20 is a behavior-preserving CSS/build discipline phase. It does **not** extract CSS into external files yet.

Added:

- `src/styles/uiTokenRegistry.js`
- `<script id="freshket-style-runtime">` build injection
- `FreshketSenseStyleRuntime` diagnostic API
- `FreshketSenseDebug.printStyleDiagnostics()`
- `scripts/audit-phase20.js`

## Why CSS was not externalized yet

Freshket Sense relies on a single deployable HTML shell and has sensitive mobile/PWA layout behavior. Moving CSS into a separate file now would add cache/load-order risk without enough benefit. Phase 20 therefore inventories tokens/selectors first and keeps runtime CSS inline.

## Behavior

`behaviorChanged = false`

No CSS rule, selector, class name, layout behavior, navigation, renderer behavior, loader behavior, auth behavior, or AI behavior is intentionally changed.

## Debug

Use browser console:

```js
FreshketSenseDebug.printStyleDiagnostics()
FreshketSenseDebug.snapshot()
getFreshketStyleRuntimeSnapshot()
```

## Next

The next reasonable step is either:

1. **Final audit / regression package**, if we want to stabilize before wider testing.
2. **Optional CSS area extraction**, but only after browser testing Phase 19/20 and deciding which UI area is safest to split first.
