# Phase 18 — KAM / Portfolio View / Team View Renderer Boundary Extraction

Baseline: Phase 17, built on Phase 6.2 chat grounding.

## Scope

Phase 18 routes high-risk KAM mode renderers through a renderer boundary while preserving legacy fallback behavior.

New source:

```text
src/views/kamTeamRenderer.js
```

Wrapped functions:

```js
renderKamThisMonth()
renderKamLastMonth()
renderKamOverview()
renderPortview()
renderPortviewSummary()
renderPortviewList()
renderTeamview()
renderTeamviewSummary()
renderTeamviewKamList()
```

## Safety

Each wrapper delegates to `FreshketSenseKamTeamRenderer` and falls back to the original legacy implementation if the renderer throws.

## Explicit non-goals

No changes to loader, auth/session, splash, navigation, swipe, AI proxy, Olive chat, or CSS/layout.
