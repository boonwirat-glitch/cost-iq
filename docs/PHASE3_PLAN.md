# Phase 3 plan — runtime wiring

## Goal

Start using extracted modules at runtime while preserving existing globals for inline handlers.

## Step order

1. Wire `src/services/aiClient.js` first.
   - Keep `window.callAI = callAI` adapter.
   - Regression target: Olive chat, KAM insight, Portfolio insight, Team insight, Matcher verify.

2. Wire `src/ai/olivePrompt.js`.
   - Keep `window.OLIVE_BASE` and `window.oliveToneClean`.
   - Regression target: Thai lock, feminine particles, no fabricated data, no wrong currency.

3. Wire data loader.
   - Keep legacy aliases `loadFromGoogleSheets`, `reloadFromGoogleSheets`, `loadFromSupabaseStorage`.
   - Regression target: foreground 5 files, background skus/alternatives, data pill, Sense gate.

4. Wire UI modules.
   - Data pill first.
   - Chat FAB second.
   - Leave view rendering and inline handlers for later.

## Do not do yet

- Do not remove inline `onclick`.
- Do not migrate to React.
- Do not change CSS layout.
- Do not change storage keys.
