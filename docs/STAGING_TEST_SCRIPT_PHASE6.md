# Phase 6 Staging Test Script

## Setup

Deploy these two files to a staging branch or test URL:

```text
dist/index.html -> index.html
dist/sw.js -> sw.js
```

Clear previous app state or open in an incognito browser for first test.

## Console checks

Run:

```js
FreshketSenseDebug.printStaticSmokeChecklist()
FreshketSenseRuntime.data.getOrchestrationSnapshot()
```

Expected:

- data runtime version = `v155-phase6-loader-orchestration`
- Phase 6 loader adapter exists: `FreshketSensePhase6LoaderAdapter`
- proxy-only production remains true

## Flow checklist

1. Open app fresh
2. Login / relogin
3. Confirm splash appears and exits
4. Confirm data pill appears for core files
5. Confirm foreground 5 files load first
6. Confirm app becomes usable before heavy files finish
7. Confirm SKU + alternatives continue in background
8. Open data panel and refresh data
9. Open KAM mode
10. Open Team view if account is TL/admin
11. Open one account
12. Trigger Sense gate
13. Open Olive chat after proxy is configured
14. Confirm no browser API key input appears in production

## Regression flags

Rollback if any of these happen:

- login/relogin loop
- splash stuck
- data pill stuck visible
- foreground data never renders
- background SKU load blocks app usage
- Team view crashes after data load
- Sense gate never exits
- Olive chat calls direct model endpoint instead of proxy
