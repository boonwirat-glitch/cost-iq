# Freshket Sense — Patch Workflow

Use this workflow for future upgrades.

## Rule 1 — Do not upload the full repo for every fix

For normal work, use patch-only packages.

A patch-only package should include only:

1. Files changed in source.
2. Generated deploy files if app runtime changes.
3. Minimal docs/version files if needed.

## Rule 2 — App behavior changes require deploy output

If a change affects browser runtime, patch must include:

```text
source file(s) changed
index.html
dist/index.html
```

If service worker/cache changes, also include:

```text
src/app/sw.js
sw.js
dist/sw.js
```

## Rule 3 — Docs-only changes do not need deploy files

For docs/workflow/readme-only changes, patch can include only docs and metadata.

No need to upload `index.html` or `sw.js`.

## Rule 4 — Ask for minimum input files

When using Claude/GPT:

1. Tell the AI the task.
2. Ask it to name the smallest required file set.
3. Upload only those files.
4. Ask it to return a patch-only ZIP.

Do not send full repo unless the work is architecture-wide.

## Standard patch return format

The AI should return:

```text
patch-name.zip
changed-files-list.txt
short-risk-note.md
```

In the chat answer, it should say exactly which files/folders to upload. No multiple options unless explicitly asked.

## Upload instruction convention

Use one clear instruction:

```text
Unzip the patch and upload everything inside the patch to GitHub root.
```

Avoid giving multiple upload alternatives unless the user asks.

## Smoke test rules

Require browser smoke test if changed:

```text
auth/session/splash
loader/data pill
navigation/swipe/mode switching
renderer DOM output
AI proxy/call path
service worker/cache
state mutation
```

No browser smoke needed for:

```text
docs/workflow updates
read-only diagnostics
metadata-only changes
```

## Recommended commit messages

```text
Docs: add AI handoff workflow
Fix: debug snapshot knownKeys error
Refactor: extract report renderer
Refactor: update read model selectors
Feature: improve Olive chat routing
```
