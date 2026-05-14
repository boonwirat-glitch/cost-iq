# Handoff for Next Workstream

## Current state

Phase 21 is the post-refactor baseline package.

The codebase has moved from a pure single-file monolith toward a source-structured repo with generated deploy output. The app still deploys as `index.html + sw.js`, but source boundaries now exist for config, runtime, views, renderer adapters, navigation, style diagnostics, and AI proxy.

## Baseline decision

Use Phase 6.2 as the product baseline. Do not roll back to Phase 6.1.

Known Olive Chat issues are parked and should not be fixed through random prompt patches during core refactor maintenance.

## What is safe to do next

- Browser final smoke test
- Production/staging release hardening
- Documentation cleanup
- Olive Chat v2 design as a separate workstream
- Gradual deeper extraction of actual renderers only after regression confidence

## What not to do casually

- Rewrite to React immediately
- Move CSS to external files without PWA/mobile cache testing
- Remove legacy fallbacks too early
- Change service worker strategy without testing old-shell behavior
- Let browser hold AI API keys again
- Patch Olive Chat prompt without solving context router/read model design

## Next recommended product/engineering work

1. Run Phase 21 final regression matrix.
2. Treat Phase 21 as the stable refactor baseline if smoke test passes.
3. Start a separate Olive Chat v2 design:
   - cross-scope context router
   - concise analyst style
   - Thai language quality guard
   - fact/inference/hypothesis separation without rigid templates
   - opportunity lens beyond drop/SKU loss
