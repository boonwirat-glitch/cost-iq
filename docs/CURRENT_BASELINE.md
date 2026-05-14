# Current Baseline — Freshket Sense v155

## Current package

```text
v155-phase21-final-audit-regression
```

## Working product baseline

```text
v155-phase6.2-chat-grounding
```

Reason: Phase 6.2 had the least-bad AI chat behavior among tested baselines and retained core app functionality. Known Olive Chat issues remain parked.

## Confirmed by user during this refactor

- Core app opened after Phase 6.1.
- Login/relogin/splash worked after auth boundary.
- AI proxy via Cloudflare Worker works.
- AI flows work, except Olive Chat quality issues are parked.
- Report renderer extraction worked.
- Overview renderer extraction worked.

## Current architecture status

- Source-structured repo exists.
- Deploy output still supports `index.html + sw.js`.
- Config boundary exists.
- Auth/session boundary exists.
- Loader/data boundary exists.
- State/storage diagnostics exist.
- View registry/read model exist.
- Report, Overview, Portfolio/SKU, KAM/Team renderer boundaries exist with fallbacks.
- Navigation controller boundary exists with legacy fallback.
- Style token registry is diagnostic-only.

## Service worker cache

```text
freshket-sense-v155-phase21
```

## AI mode

Production is proxy-only. Browser-held Claude/Gemini keys are not allowed.
