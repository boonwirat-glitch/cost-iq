# Phase 10 — Auth / Session Boundary

## Baseline

Working baseline: **Phase 6.2 Chat Grounding**.

Known Olive chat issues remain parked. This phase does not redesign Olive chat.

## Scope

Phase 10 creates an adapter-first boundary around Supabase auth/session flows:

- login
- relogin/session check
- splash transition
- password recovery
- sign out
- local persona mode
- user profile loading

## What changed

Added runtime boundary:

```text
src/runtime/authSessionRuntime.js
src/runtime/legacyAuthAdapter.js
```

Injected into the app shell as:

```html
<script id="freshket-auth-session-runtime">
```

The runtime wraps existing global auth functions and delegates back to the original implementation. It is intentionally not a rewrite.

## Runtime control

Console diagnostics:

```js
FreshketSenseAuthControl.status()
FreshketSenseAuthControl.printDiagnostics()
FreshketSenseDebug.authDiagnostics()
FreshketSenseDebug.printAuthDiagnostics()
```

Kill switch:

```js
FreshketSenseAuthControl.disableRuntime('staging issue')
location.reload()
```

Enable again on next reload:

```js
FreshketSenseAuthControl.enableRuntimeNextReload()
location.reload()
```

## Non-goals

This phase does not change:

- UI
- loader strategy
- KAM / Restaurant / Portfolio / Team views
- AI proxy behavior
- Olive chat behavior
- Supabase schema

## Risk note

Auth/session is a high-risk area because previous versions had splash/relogin regressions. Phase 10 adds wrappers and diagnostics only; browser smoke testing is required before extracting implementation deeper.
