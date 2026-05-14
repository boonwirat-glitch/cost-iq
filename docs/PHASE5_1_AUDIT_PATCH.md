# Freshket Sense v155 — Phase 5.1 Audit Patch

## Purpose

Phase 5.1 pauses the refactor and patches audit findings before moving to Phase 6.

This is not a UI rewrite and not a component extraction phase. It is a safety patch.

## Changes

1. Production AI is now proxy-only.
   - `PROXY_ONLY_PRODUCTION = true`.
   - `directAiKeyModeAllowed()` always returns false in this production build.
   - Direct Anthropic/Gemini browser endpoints are removed from `dist/index.html`.
   - Browser key input fields are removed from the production DOM.

2. Runtime guards were added.
   - AI adapter now has fallback checks if `FreshketSenseRuntime` is unavailable.
   - Data adapter now exposes a fallback `getFreshketDataRuntimeSnapshot()` instead of silently returning.

3. Debug and staging utilities were added.
   - `FreshketSenseDebug.snapshot()`
   - `FreshketSenseDebug.runStaticSmokeChecklist()`
   - `FreshketSenseDebug.printStaticSmokeChecklist()`
   - `runFreshketStaticSmokeChecklist()`

4. Service worker cache was bumped.
   - `freshket-sense-v155-phase5-1`

## Important limitation

The app still runs primarily from the legacy monolith. Phase 5.1 hardens the migration seam; it does not complete the modular refactor.

## Deployment stance

Use this as staging candidate only until the full regression checklist passes with a configured AI proxy.
