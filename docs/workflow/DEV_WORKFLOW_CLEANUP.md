# Phase 21.2 — Dev Workflow Cleanup

This is a docs/workflow-only cleanup. It does not change product runtime behavior.

## Purpose

Make future GPT/Claude work less confusing by defining:

- which files are active source;
- which files are generated deploy output;
- when to use patch-only packages;
- how to hand off work to Claude Sonnet;
- which legacy/audit docs are not active coding context.

## New workflow docs

```text
docs/workflow/AI_HANDOFF.md
docs/workflow/ACTIVE_FILE_MAP.md
docs/workflow/PATCH_WORKFLOW.md
docs/workflow/CLAUDE_CONTINUATION_PROMPT.md
```

## Behavior impact

None. This phase does not modify runtime app code.

## Current baseline after this cleanup

```text
Current working baseline: Phase 21.1 Debug Snapshot Fix
Workflow docs baseline: Phase 21.2 Dev Workflow Cleanup
```
