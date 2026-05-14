# Phase 19 — Navigation / Screen Controller Boundary

Baseline: Phase 18, built on Phase 6.2 chat grounding.

## Scope

Phase 19 creates a navigation/screen-controller seam while preserving legacy behavior.

New source:

```text
src/runtime/navigationRuntime.js
```

Wrapped entry points:

```js
showScreen(name)
setMode(mode)
navPortHome()
```

## Safety

Each wrapper delegates to `FreshketSenseNavigationRuntime` and falls back to the original legacy implementation if the controller throws.

## Explicit non-goals

No actual rewrite of bottom navigation, swipe groups, KAM/Restaurant mode switching, view renderers, loader, auth/session, AI proxy, Olive chat, or CSS/layout.

This phase prepares for a later controller extraction but keeps the current navigation behavior intact.
