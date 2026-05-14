# Freshket Sense v155 Refactor Map

## Current state
The uploaded v155 app is still a single HTML monolith. Phase 1 does not rewrite UI. It creates a safer bridge toward modularization.

## Phase 1 completed in this package
1. Sanitized browser AI secrets from the deployable HTML.
2. Added a proxy-first `callAI()` bridge inside the monolith.
3. Added `workers/ai-proxy-cloudflare-worker.js` as the backend AI call boundary.
4. Extracted Olive prompt into `src/extracted/olivePrompt.js` for the next phase.
5. Extracted the target AI client contract into `src/extracted/aiClient.js`.
6. Added regression checklist and secret scan script.

## Still intentionally not changed
- HTML structure
- CSS
- inline `onclick` handlers
- Cloudflare R2 data loading strategy
- Supabase auth flow
- Splash/relogin behavior
- KAM / Portfolio / Team view rendering logic

## Recommended Phase 2
Move these sections from the monolith into real modules while keeping behavior unchanged:

```text
src/ai/olivePrompt.js
src/services/aiClient.js
src/services/dataLoader.js
src/services/authService.js
src/ui/dataPill.js
src/ui/chatFab.js
src/views/portfolioView.js
src/views/teamView.js
```

Do not start with React. First make the vanilla code modular and testable.
