# Freshket Sense — AI Handoff

Use this file when continuing Freshket Sense development with Claude Sonnet, GPT, or another AI assistant.

## Current baseline

- Current app package: **v155 Phase 21.1 Debug Snapshot Fix**.
- Working product baseline: **Phase 6.2 Chat Grounding**.
- Core refactor through Phase 21 is complete enough to continue repo-based work.
- Cloudflare Worker AI proxy is working.
- Production AI mode is **proxy-only**. Do not put Claude/Gemini keys into browser code, GitHub, localStorage, or `index.html`.
- Known Olive Chat issues are parked for a later **Olive Chat v2** redesign.

## The repo is not fully Lovable-style yet

The app still deploys from:

```text
/index.html
/sw.js
```

But the repo now has source structure:

```text
src/app/index.html     active app source shell
src/app/sw.js          active service worker source
src/runtime/           runtime boundaries and adapters
src/views/             extracted view renderer boundaries
src/config/            app config/constants
src/styles/            style/token registry
docs/                  docs, handoff, audit, regression notes
scripts/               build/audit/secret check scripts
workers/               Cloudflare Worker AI proxy
```

Think of this as a **safe migration repo**, not a fully external-module frontend app. When changing runtime app behavior, keep source and generated deploy output in sync.

## Source-of-truth rule

For app behavior changes, edit source first:

```text
src/app/index.html
src/runtime/*
src/views/*
src/config/*
src/styles/*
```

Then sync deploy output:

```text
index.html
dist/index.html
```

For service worker changes, sync:

```text
src/app/sw.js
sw.js
dist/sw.js
```

Do not edit only root `index.html` unless it is a temporary emergency hotfix, and then reconcile back into `src/app/index.html`.

## What not to touch unless explicitly requested

- Do not redesign Olive Chat during unrelated refactor work.
- Do not change loader/auth/navigation behavior unless the task is specifically about those areas.
- Do not remove legacy fallbacks unless a dedicated cleanup phase asks for it.
- Do not remove diagnostics/audit helpers without a specific reason.
- Do not convert to React or full module bundling without an explicit migration plan.
- Do not reintroduce direct browser calls to Claude/Gemini APIs.

## Known parked Olive Chat issues

These are known and should not be patched ad hoc during unrelated work:

1. Chat is too screen-scoped; it should route across account / portfolio / team context.
2. Grounding improved, but responses can be too rigid and template-like.
3. Thai language quality still has noise.
4. Answers can be too long.
5. Lens is too defensive: drop/SKU-loss heavy, not enough opportunity/wallet pattern discovery.
6. Account-level diagnosis needs a true context router and evidence contract.

Handle as a separate project: **Olive Chat v2 — Intelligence Router + Grounded Analyst**.

## Required response format for future AI coding work

When asked to modify the app, the AI should:

1. State the smallest file set needed.
2. Avoid asking for the full ZIP unless architecture-wide work is required.
3. Make source changes first.
4. Include generated deploy files in the patch if app runtime changes.
5. Return a patch-only package listing exactly which files to upload.
6. Include a short smoke test focused only on touched behavior.

## Current highest-risk areas

Treat these as high risk and request browser smoke tests if changed:

```text
auth/session/splash
loader/data pill/IndexedDB/service worker
navigation/swipe/bottom nav/mode switching
actual renderer DOM output
AI proxy/call path
state mutation
```

Low-risk changes usually do not need browser smoke tests:

```text
docs
workflow files
audit notes
read-only diagnostics
registry updates
non-runtime metadata
```
