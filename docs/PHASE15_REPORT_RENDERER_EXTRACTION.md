# Phase 15 — Report Renderer Extraction

## Baseline

Current working baseline remains **v155 Phase 6.2 Chat Grounding**, with known Olive Chat issues parked for later redesign.

## Scope

Phase 15 extracts the **Report screen renderer** behind a legacy-safe adapter.

New source file:

```text
src/views/reportRenderer.js
```

Injected into the app shell through:

```html
<script id="freshket-report-renderer"></script>
```

## What changed

`renderReport()` now routes to:

```js
FreshketSenseReportRenderer.renderFromLegacy(...)
```

The original report renderer body is retained as:

```js
__legacyRenderReportFallback()
```

This means if the extracted renderer fails, the app falls back to the legacy report rendering path instead of blanking the report.

## What did not change

- No navigation changes
- No loader changes
- No auth/session changes
- No state mutation changes
- No AI proxy changes
- No Olive Chat redesign
- No KAM / Team / Portfolio renderer extraction
- No CSS/layout redesign

## Why Report first

Report is the lowest-risk renderer because it is mostly an output view. It depends on selected opportunities and account metadata, but it does not control core navigation, swipe, auth, loader, or KAM/Team mode.

## Browser smoke recommended

Yes. This is the first phase that routes an actual renderer through a new extracted module, so browser smoke should include the Report tab.
