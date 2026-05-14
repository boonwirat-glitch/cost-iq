# Freshket Sense — Active File Map

This file tells AI assistants which files matter for each type of work.

## Always start from this mental model

- Browser runtime still uses `/index.html` and `/sw.js`.
- Active source lives mostly under `src/`.
- Root `index.html` and `dist/index.html` are deploy outputs that must stay synced with source when app behavior changes.

## By feature area

### App shell / global legacy code

```text
src/app/index.html
index.html
dist/index.html
```

Use for changes that touch large legacy behavior, inline handlers, Olive chat wiring, screen functions, or DOM rendering still embedded in the shell.

### Service worker / cache

```text
src/app/sw.js
sw.js
dist/sw.js
```

Use for cache version, offline fallback, service worker strategy.

### Config/constants

```text
src/config/appConfig.js
```

Use for Supabase public config, R2 base URL, storage keys, app metadata, icons, file specs.

### AI / Olive / chat

Likely relevant files:

```text
src/app/index.html
src/ai/olivePrompt.js
src/runtime/chatGroundingRuntime.js
src/runtime/freshketRuntime.js
src/runtime/readModelRuntime.js
src/services/aiClient.js
workers/ai-proxy-cloudflare-worker.js
```

Also read:

```text
docs/KNOWN_OLIVE_CHAT_ISSUES_PARKED.md
docs/workflow/AI_HANDOFF.md
```

Do not modify Worker code unless the task is about proxy / API call path.

### Data loader / R2 / cache / data pill

```text
src/runtime/dataRuntime.js
src/runtime/loaderOrchestrationRuntime.js
src/runtime/legacyDataAdapter.js
src/runtime/legacyLoaderAdapter.js
src/data/cloudflareDataLoader.js
src/config/appConfig.js
src/ui/dataPill.js
src/app/index.html
```

High-risk: browser smoke test required.

### Auth / session / splash

```text
src/runtime/authSessionRuntime.js
src/runtime/legacyAuthAdapter.js
src/app/index.html
```

High-risk: browser smoke test required.

### State / storage diagnostics

```text
src/runtime/appStateRuntime.js
src/runtime/legacyStateAdapter.js
src/runtime/debugRuntime.js
```

### Read model / selectors

```text
src/runtime/readModelRuntime.js
src/runtime/viewBoundaryRuntime.js
src/views/viewRegistry.js
```

### Restaurant views

```text
src/views/overviewRenderer.js
src/views/portfolioRenderer.js
src/views/reportRenderer.js
src/views/viewRegistry.js
src/runtime/readModelRuntime.js
src/app/index.html
```

### KAM / Portfolio View / Team View

```text
src/views/kamTeamRenderer.js
src/views/viewRegistry.js
src/runtime/readModelRuntime.js
src/app/index.html
```

### Navigation / screen controller

```text
src/runtime/navigationRuntime.js
src/app/index.html
```

High-risk: browser smoke test required.

### Styles / UI tokens

```text
src/styles/uiTokenRegistry.js
src/app/index.html
```

CSS is still inline in the app shell. Do not externalize CSS casually because mobile/PWA/cache/load order risk is high.

### Cloudflare Worker AI proxy

```text
workers/ai-proxy-cloudflare-worker.js
```

Secrets live in Cloudflare Dashboard, not GitHub.

## Files that are usually not active coding inputs

Do not make AI read all of these unless doing audit/history work:

```text
docs/PHASE*.md
docs/STAGING_TEST_SCRIPT_PHASE*.md
scripts/audit-phase*.js
src/legacy/*
src/archive/*
```

They are useful as history, not day-to-day active source.
