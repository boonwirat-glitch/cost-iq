# Phase 19.1 — Navigation Regression Test / Stabilization

## Purpose

Phase 19 introduced a navigation/screen-controller boundary around:

- `showScreen(name)`
- `setMode(mode)`
- `navPortHome()`

Phase 19.1 does **not** introduce new product behavior. It adds a stricter regression comparison against the Phase 6.2 baseline so we can continue with more confidence.

## What was compared

The original Phase 6.2 navigation functions were extracted and normalized:

- `showScreen`
- `setMode`
- `navPortHome`

Phase 19.1 verifies that the Phase 19.1 legacy fallbacks still match those original Phase 6.2 functions by hash and byte length:

- `__legacyShowScreenFallback` ↔ Phase 6.2 `showScreen`
- `__legacySetModeFallback` ↔ Phase 6.2 `setMode`
- `__legacyNavPortHomeFallback` ↔ Phase 6.2 `navPortHome`

This proves the actual legacy navigation body was preserved exactly inside the fallback path.

## What this does not prove

This is a static/source-level regression test. It cannot prove 100% browser runtime behavior because it cannot simulate all real DOM/session/user interactions, such as:

- real swipe inertia
- browser cache/service worker timing
- logged-in session timing
- user-specific KAM role state
- data loading race timing

For that, use the staging smoke script.

## Result

Automated verification passes when:

- deploy output is generated from source
- navigation runtime remains `behaviorChanged=false`
- controller delegates to legacy functions only
- all three fallback functions match the Phase 6.2 baseline hashes
- proxy-only AI mode remains intact
- no hardcoded AI secrets are present

## Recommendation

This phase is safe to use as the next baseline if either:

1. you accept static equivalence plus fallback safety, or
2. a browser smoke test confirms nav/swipe/mode switching still works.
