# Phase 11 — App State / Storage Boundary

Baseline: `v155-phase6.2-chat-grounding` with Phase 10 auth/session smoke-tested by the user.

Phase 11 adds a diagnostic-first app state and storage boundary. It does not rewrite legacy state behavior.

Runtime globals:
- `FreshketSenseStateRuntime`
- `FreshketSenseStateControl`
- `FreshketSenseDebug.stateDiagnostics()`
- `FreshketSenseDebug.printStateDiagnostics()`

It snapshots active account/mode/KAM state, loaded data counts, selected opportunities, bulk data availability, fileStatus, known localStorage keys, and runtime flags.

Not changed: UI, loader strategy, auth/session behavior, splash/relogin, KAM mode, Restaurant mode, Portfolio/Team view, and Olive chat design.
