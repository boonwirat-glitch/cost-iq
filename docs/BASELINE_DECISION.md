# Baseline Decision — Phase 8

## Decision

Use **Phase 6.2 Chat Grounding** as the working baseline for the core refactor.

## Why

The Olive chat issues visible in Phase 6.2 were not new regressions unique to 6.2. They also existed in Phase 6.1 and were worse there. Phase 6.2 improved some grounding discipline while the remaining chat design issues are broader product-intelligence problems.

## Validated before Phase 8

- App opens
- Login / relogin does not hang
- Splash appears and disappears normally
- Data pill appears and hides normally
- Account data loads
- Restaurant mode swipe works
- KAM mode opens
- Portfolio / Team view works
- Olive chat panel opens
- AI proxy works
- AI flows work

## Parked Olive chat issues

Do not keep patching chat during core refactor. Park these for Olive Chat v2 / intelligence-router work later:

1. Chat is too screen-scoped.
2. Chat responses are too long and too structured.
3. Thai quality still has noise.
4. Grounding is safer but can feel rigid.
5. Cross-scope context access is weak.
6. Lens is too defensive: drop / SKU-loss heavy, not enough opportunity pattern discovery.

## Active refactor rule

Continue core refactor from Phase 6.2 / Phase 8 source-of-truth structure.

Normal edits should happen in:

```text
src/app/index.html
src/app/sw.js
```

Then run:

```bash
npm run build
npm run verify
```
