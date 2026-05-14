# Phase 9.1 Audit Notes

## Decision

Take the safer path before Auth/Session extraction.

## Reason

Auth, splash, and relogin have historically been sensitive flows. Phase 9 changed the build/config layer, so the correct next move is to verify runtime order and generated output discipline before modifying auth/session code.

## Pass criteria

- `npm run verify` passes.
- Root and dist files are generated from source.
- `FreshketSenseConfig` is injected and readable.
- `FRESHKET_APP_CONFIG` derives from `FreshketSenseConfig`.
- Production AI remains proxy-only.
- No hardcoded Claude/Gemini secrets.
- No direct browser Claude/Gemini endpoint.
- Phase 6.2 chat grounding is retained.
- Service worker cache is bumped to Phase 9.1.

## Next phase after pass

Phase 10 — Auth / Session Boundary, but only as an adapter-first extraction. Do not rewrite login UI or splash behavior.
