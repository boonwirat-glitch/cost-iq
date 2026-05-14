# Phase 21 Audit Notes

Audit script: `scripts/audit-phase21.js`

## Expected static checks

- Build output generated from source.
- Root and dist outputs match expected generated output.
- Service worker cache is `freshket-sense-v155-phase21`.
- Production remains proxy-only.
- No hardcoded Claude/Gemini API secrets.
- No direct Claude/Gemini browser endpoints.
- Phase 6.2 chat grounding retained.
- Renderer boundaries retained.
- Navigation boundary retained.
- CSS/style runtime remains diagnostic-only.
- Phase 21 release/regression/handoff docs exist.

## Browser caveat

Static audit cannot prove 100% browser behavior. Final production confidence still needs a browser smoke pass using `docs/FINAL_REGRESSION_MATRIX.md`.
