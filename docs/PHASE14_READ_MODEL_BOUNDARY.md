# Phase 14 — Continuity Docs + Read Model Boundary

## Goal

Prepare for actual renderer extraction without changing UI behavior.

This phase adds:

- continuity markdown for long-running refactor handoff
- a read-only renderer data boundary: `FreshketSenseReadModelRuntime`
- selector-style read models for each registered screen
- diagnostics for read model validation

## Added source

```text
src/runtime/readModelRuntime.js
```

## Runtime globals

```js
FreshketSenseReadModelRuntime
FreshketSenseRuntime.readModel
getFreshketReadModelSnapshot()
printFreshketReadModelDiagnostics()
FreshketSenseDebug.readModelDiagnostics()
FreshketSenseDebug.printReadModelDiagnostics()
```

## Read models available

```js
FreshketSenseReadModelRuntime.getViewModel('report')
FreshketSenseReadModelRuntime.getViewModel('overview')
FreshketSenseReadModelRuntime.getViewModel('portfolio')
FreshketSenseReadModelRuntime.getViewModel('opportunities')
FreshketSenseReadModelRuntime.getViewModel('kamOverview')
FreshketSenseReadModelRuntime.getViewModel('portview')
FreshketSenseReadModelRuntime.getViewModel('teamview')
```

## What this phase does not do

- Does not override any renderer.
- Does not change DOM.
- Does not change navigation.
- Does not mutate app state.
- Does not change auth, loader, service worker strategy, AI proxy, or Olive chat design.

## Next phase

Phase 15 should extract the Report renderer first and wire it to the read model boundary.
