# Phase 7 — Source Repo Structure

## Objective

Make GitHub reflect the refactor work instead of containing only `index.html` and `sw.js`.

## What changed

Phase 7 adds root-level deploy files and preserves the refactor scaffold:

```text
/index.html
/sw.js
/dist/index.html
/dist/sw.js
/src/
/docs/
/scripts/
/workers/
/package.json
/README.md
```

## What did not change

No intentional product behavior change:

- No React rewrite
- No UI redesign
- No loader strategy change
- No Olive chat redesign
- No AI proxy change
- No KAM/Restaurant/Portfolio/Team view change

Only the service worker cache name was bumped to `freshket-sense-v155-phase7` to avoid stale shell cache after deployment.

## How to deploy now

For the current workflow, upload the full repo folder to GitHub and ensure these files exist at root:

```text
/index.html
/sw.js
```

Cloudflare Pages can still serve the app from root.

## How to build later

Run:

```bash
npm run verify
```

This copies canonical legacy shell files from `src/legacy/` to both root and `dist/`.
