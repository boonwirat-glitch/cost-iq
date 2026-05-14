# Phase 9 Audit Notes

Result: Phase 9 is intended as a behavior-neutral config extraction.

## Safe changes

- Added `src/config/appConfig.js` as public config source.
- Build injects the config into generated HTML.
- Existing constants still keep safe fallbacks to old values.
- Service worker cache bumped to `freshket-sense-v155-phase9`.
- Phase 6.2 chat grounding remains the baseline.

## Not changed

- No view renderer refactor.
- No chat redesign.
- No loader strategy change.
- No AI key reintroduction.

## Risk

The main risk is config injection order. The config script is inserted before service worker registration, manifest generation, auth setup, data loader setup, and runtime boundary scripts.

## Rollback

If staging shows config-related data-load issues, use:

```js
FreshketSenseLoaderControl.disableRuntime('phase9 config issue')
location.reload()
```

If shell-level issues appear, rollback to Phase 8 or Phase 6.2 deploy files.
