// Freshket Sense legacy view adapter — Phase 13.
// Intentionally diagnostic-only. It preserves all legacy screen/render functions and exposes a boundary for future extraction.
(function(global){
  'use strict';
  const runtime = global.FreshketSenseViewRuntime || null;
  const registry = global.FreshketSenseViewRegistry || null;
  const status = {
    version: 'phase13-legacy-view-adapter',
    installedAt: new Date().toISOString(),
    mode: runtime ? 'diagnostic-only' : 'missing-runtime',
    registryLoaded: !!registry,
    rewiredFunctions: [],
    behaviorChanged: false,
    note: 'No legacy view functions are overridden in Phase 13.'
  };
  global.FreshketSensePhase13ViewAdapter = Object.freeze(status);
  global.FreshketSensePhase12ViewAdapter = global.FreshketSensePhase12ViewAdapter || Object.freeze(status);
})(window);