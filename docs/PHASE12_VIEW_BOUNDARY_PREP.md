# Phase 12 — View Boundary Preparation

Baseline: **Phase 6.2 Chat Grounding** remains the working product baseline. Known Olive chat issues stay parked.

## Objective

Prepare the app for later view/component extraction without changing UI behavior.

Phase 12 adds a diagnostic-only view boundary that maps:

- Restaurant screens: Overview, Portfolio, Opportunities/Sense, Report
- KAM screens: KAM Account Overview, Portfolio View, Team View
- Swipe groups and nav relationships
- Render function inventory and missing renderer checks
- Active screen/nav snapshot for debugging

## What changed

New files:

- `src/runtime/viewBoundaryRuntime.js`
- `src/runtime/legacyViewAdapter.js`
- `scripts/audit-phase12.js`
- `docs/STAGING_TEST_SCRIPT_PHASE12.md`
- `docs/PHASE12_AUDIT_NOTES.md`

New console diagnostics:

```js
FreshketSenseDebug.printViewDiagnostics()
FreshketSenseDebug.viewDiagnostics()
getFreshketViewRuntimeSnapshot()
printFreshketViewDiagnostics()
```

## What did not change

- No render function is overridden.
- No UI behavior is changed.
- No view/component extraction yet.
- No Olive chat redesign.
- No loader/auth/state strategy changes.

The legacy view adapter is diagnostic-only and reports `behaviorChanged: false`.

## Why this phase exists

The next real risk is extracting view renderers from the monolith. Before doing that, we need a map of screen IDs, nav IDs, render functions, active screen state, and view dependencies. Phase 12 builds that map without touching behavior.
