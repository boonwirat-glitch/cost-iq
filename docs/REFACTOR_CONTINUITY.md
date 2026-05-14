# Refactor Continuity — Freshket Sense v155

## Resume point

Continue from:

```text
v155-phase21-final-audit-regression
```

## Baseline decision

Use **Phase 6.2 Chat Grounding** as the working product baseline.

Do not roll back to Phase 6.1. The user confirmed that issues in Phase 6.2 also existed in Phase 6.1 and were worse there.

## Parked Olive Chat issues

Do not keep patching Olive Chat during core refactor maintenance unless required for safety.

Known parked issues:

1. Chat is too screen-scoped.
2. Answers are too long and template-like.
3. Thai language quality is noisy.
4. Grounding is not yet balanced enough.
5. Cross-scope context router is weak.
6. Lens is too defensive: drop/SKU-loss heavy, not enough growth/wallet opportunity.

## Current architecture boundaries

- Config: `src/config/appConfig.js`
- App shell: `src/app/index.html`
- Service worker: `src/app/sw.js`
- AI proxy: `workers/ai-proxy-cloudflare-worker.js`
- Runtime boundaries: `src/runtime/*`
- View boundaries: `src/views/*`
- Style diagnostics: `src/styles/uiTokenRegistry.js`

## Source/deploy rule

Edit source files and run build/verify. Root and dist deploy files are generated outputs.

```bash
npm run verify
```

## Current next step

Run final browser smoke test using:

```text
docs/FINAL_REGRESSION_MATRIX.md
```

If passed, Phase 21 can be treated as the post-refactor baseline.
