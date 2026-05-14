# Phase 16 — Restaurant Overview Renderer Extraction

## Baseline

Current working baseline remains **v155 Phase 6.2 Chat Grounding**, with known Olive Chat issues parked for later redesign.

## Scope

Phase 16 extracts the **Restaurant Overview screen renderer** behind a legacy-safe adapter.

New source file:

```text
src/views/overviewRenderer.js
```

Injected into the app shell through:

```html
<script id="freshket-overview-renderer"></script>
```

## What changed

`renderOverview()` now routes to:

```js
FreshketSenseOverviewRenderer.renderFromLegacy(...)
```

The original overview renderer body is retained as:

```js
__legacyRenderOverviewFallback()
```

If the extracted renderer throws, the app falls back to the legacy overview renderer.

## What the extracted renderer owns

- Resetting Restaurant Sense preview / scan UI on data refresh
- Resetting related Sense flags through adapter callbacks
- Rendering monthly trend bars
- Locking hero to current-month partial GMV when available
- Rendering category bars
- Calling existing overview stats / interpretation / pace-strip helpers

## What did not change

- No navigation changes
- No swipe changes
- No loader changes
- No auth/session changes
- No AI proxy changes
- No Olive Chat redesign
- No KAM / Team / Portfolio renderer extraction
- No CSS/layout redesign

## Risk

Medium-high versus earlier phases because Overview is visible and touches Sense preview state. The scope is still controlled because all downstream helper functions are kept intact and legacy fallback remains available.
