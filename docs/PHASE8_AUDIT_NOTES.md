# Phase 8 Audit Notes

## Audit focus

Phase 8 checks source-of-truth discipline, not feature behavior.

Required pass conditions:

- `src/app/index.html` exists
- `src/app/sw.js` exists
- root and dist files are generated from `src/app/*`
- Phase 6.2 chat grounding remains retained
- production AI remains proxy-only
- no hardcoded AI secrets are found
- no direct Anthropic/Gemini browser endpoints exist in deployable HTML
- service worker cache is bumped to `freshket-sense-v155-phase8`
- debug runtime source scaffold is trimmed and no longer contains accidental legacy tail content

## Parked items

Olive chat is still intentionally parked. Known issues remain:

- too screen-scoped
- too structured/long
- Thai language noise
- weak cross-scope context access
- overly defensive drop/SKU-loss lens

Do not solve these during core refactor unless there is a safety issue.
