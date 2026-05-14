# Phase 9.1 — Safety Audit / Stabilization

## Purpose

Phase 9 extracted app config/constants into `src/config/appConfig.js` and injects it into `src/app/index.html` at build time.

Phase 9.1 does **not** continue feature refactor. It pauses to harden the Phase 9 change before moving into Auth/Session extraction.

## Baseline

- Working baseline: `v155-phase6.2-chat-grounding`
- Core app flows had passed smoke test before Phase 7/8/9.
- Olive chat issues remain known and parked. Do not redesign Olive chat during core refactor.

## What changed in 9.1

1. Bumped app version and service worker cache to `v155-phase9-1-safety-audit` / `freshket-sense-v155-phase9-1`.
2. Added config diagnostics to `FreshketSenseDebug`:
   - `FreshketSenseDebug.configDiagnostics()`
   - `FreshketSenseDebug.printConfigDiagnostics()`
3. Added a Phase 9.1 audit script to verify build/source/runtime assumptions.
4. Added this staging script.

## What did not change

- No UI behavior change.
- No loader strategy change.
- No auth/session extraction yet.
- No Olive chat redesign.
- No AI proxy behavior change.
- No view renderer extraction.

## Why this matters

Config injection is safe only if the runtime order remains correct:

1. `freshket-sense-config` is injected before app scripts.
2. `window.FreshketSenseConfig` exists before Supabase/R2/AI/manifest code reads it.
3. Generated root files match the source-of-truth build output.
4. Production remains proxy-only for AI.

Phase 9.1 makes those assumptions auditable before touching auth/splash/relogin in the next phase.
