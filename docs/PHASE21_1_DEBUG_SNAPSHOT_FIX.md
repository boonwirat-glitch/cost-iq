# Phase 21.1 — Debug Snapshot Fix

## Purpose

Fix a diagnostics-only regression found after deploying Phase 21.

## Issue

`FreshketSenseDebug.snapshot()` threw:

```text
ReferenceError: knownKeys is not defined
```

The app shell, login screen, and production behavior were not blocked. The failure came from the state/storage diagnostics snapshot only.

## Fix

`storageSnapshot()` now returns:

```js
knownKeys: knownStorageKeys
```

instead of referencing an undefined shorthand variable.

## Behavior impact

- Product behavior: unchanged
- UI: unchanged
- Auth/session: unchanged
- Loader: unchanged
- Navigation/renderers: unchanged
- AI proxy: unchanged
- Debug snapshot: fixed

## Service worker

Cache bumped to:

```text
freshket-sense-v155-phase21-1
```
