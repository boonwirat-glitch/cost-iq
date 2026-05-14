# Phase 13 — View Registry / Renderer Inventory

## Goal

Prepare for future view extraction without touching UI behavior. Phase 13 creates a source-of-truth registry for screens, renderers, DOM anchors, state reads, and extraction risk.

## Baseline

Current working baseline remains **Phase 6.2 Chat Grounding**. Known Olive chat issues remain parked for a later redesign.

## Added

- `src/views/viewRegistry.js`
- Enhanced `FreshketSenseViewRuntime` diagnostics that read `FreshketSenseViewRegistry`
- `scripts/audit-phase13.js`
- `docs/STAGING_TEST_SCRIPT_PHASE13.md`
- `docs/PHASE13_AUDIT_NOTES.md`

## Behavior

No legacy render functions are overridden. No navigation, swipe, loader, auth, AI proxy, or Olive chat design behavior is changed.

## Why this matters

Before extracting renderers, we need to know exactly:

- which screen owns which renderer
- which DOM anchors each screen depends on
- which global state areas are read
- which screens are high-risk and should wait

This prevents a premature component split from breaking Portfolio, Team View, KAM mode, or Restaurant swipe behavior.
