// Freshket Sense Phase 20 — CSS/UI Token Registry + Style Diagnostics
// Purpose: expose read-only style metadata for future CSS cleanup without changing runtime CSS behavior.
// This file must not mutate DOM styles, class names, layout, tokens, or CSS rules.
(function(global) {
  'use strict';

  const VERSION = 'v155-phase21-final-audit-regression';
  const BEHAVIOR_CHANGED = false;

  const TOKEN_NAMES = [
  "--g500",
  "--g50",
  "--g70",
  "--g700",
  "--g800",
  "--g900",
  "--amb",
  "--amb50",
  "--org",
  "--red",
  "--red50",
  "--n0",
  "--n50",
  "--n100",
  "--n200",
  "--n300",
  "--n400",
  "--n600",
  "--n700",
  "--n900",
  "--bd",
  "--sh",
  "--shm",
  "--r",
  "--rs",
  "--conf-hi",
  "--conf-md",
  "--conf-lo",
  "--kam",
  "--kam-dark",
  "--kam-bg"
];

  const STYLE_AREAS = Object.freeze([
    { key: 'base', label: 'Base / typography / root tokens', risk: 'low' },
    { key: 'topbar-data-panel', label: 'Topbar / data panel / data pill', risk: 'medium' },
    { key: 'restaurant-overview', label: 'Restaurant overview / hero / cards', risk: 'medium' },
    { key: 'opportunities-sense', label: 'Opportunities / Sense gate / plan builder', risk: 'high' },
    { key: 'portfolio-sku', label: 'Portfolio / SKU list / SKU detail', risk: 'high' },
    { key: 'kam-mode', label: 'KAM account / portfolio / team views', risk: 'high' },
    { key: 'navigation', label: 'Bottom nav / swipe / mode toggle', risk: 'high' },
    { key: 'olive-chat', label: 'Olive FAB / chat panel', risk: 'medium' },
    { key: 'print-report', label: 'Report / print CSS', risk: 'medium' }
  ]);

  const CRITICAL_SELECTORS = Object.freeze([
    'body', '.topbar', '.bnav', '#swipe-pill', '#data-load-pill', '#dataPanel',
    '#scr-overview', '#scr-portfolio', '#scr-opportunities', '#scr-report',
    '#kam-overview', '#scr-portview', '#scr-teamview', '.aifab', '.aipanel', '#sense-gate'
  ]);

  function safeDocument(){ return global.document || null; }

  function tokenSnapshot() {
    const doc = safeDocument();
    const out = {};
    if (!doc || !global.getComputedStyle) {
      TOKEN_NAMES.forEach(function(name){ out[name] = null; });
      return out;
    }
    const styles = global.getComputedStyle(doc.documentElement);
    TOKEN_NAMES.forEach(function(name) { out[name] = (styles.getPropertyValue(name) || '').trim(); });
    return out;
  }

  function selectorInventory() {
    const doc = safeDocument();
    return CRITICAL_SELECTORS.map(function(selector) {
      let count = 0;
      try { count = doc ? doc.querySelectorAll(selector).length : 0; } catch (err) { count = -1; }
      return { selector: selector, count: count, exists: count > 0 };
    });
  }

  function stylesheetInventory() {
    const doc = safeDocument();
    if (!doc) return { styleTagCount: 0, linkedStylesheetCount: 0, inlineStyleBytesEstimate: 0 };
    const styleTags = Array.prototype.slice.call(doc.querySelectorAll('style'));
    const links = Array.prototype.slice.call(doc.querySelectorAll('link[rel="stylesheet"]'));
    return {
      styleTagCount: styleTags.length,
      linkedStylesheetCount: links.length,
      inlineStyleBytesEstimate: styleTags.reduce(function(sum, tag) { return sum + ((tag.textContent || '').length); }, 0),
      linkedStylesheets: links.map(function(link) { return link.getAttribute('href') || ''; })
    };
  }

  function validate() {
    const tokens = tokenSnapshot();
    const missingTokens = TOKEN_NAMES.filter(function(name) { return !tokens[name]; });
    return {
      ok: missingTokens.length === 0,
      behaviorChanged: BEHAVIOR_CHANGED,
      tokenCount: TOKEN_NAMES.length,
      missingTokens: missingTokens,
      criticalSelectors: selectorInventory(),
      styleAreas: STYLE_AREAS,
      ts: new Date().toISOString()
    };
  }

  function diagnostics() {
    const validation = validate();
    return {
      version: VERSION,
      behaviorChanged: BEHAVIOR_CHANGED,
      tokenNames: TOKEN_NAMES.slice(),
      tokens: tokenSnapshot(),
      styleAreas: STYLE_AREAS,
      stylesheets: stylesheetInventory(),
      validation: validation,
      extractionPolicy: 'No external CSS extraction in Phase 20. Runtime CSS remains inline to preserve mobile/PWA behavior.',
      nextSafeStep: 'Extract CSS by area only after renderer/navigation phases are stable and browser-tested.',
      ts: new Date().toISOString()
    };
  }

  const api = Object.freeze({
    version: VERSION,
    behaviorChanged: BEHAVIOR_CHANGED,
    tokenNames: function() { return TOKEN_NAMES.slice(); },
    styleAreas: function() { return STYLE_AREAS.slice(); },
    criticalSelectors: function() { return CRITICAL_SELECTORS.slice(); },
    tokenSnapshot: tokenSnapshot,
    selectorInventory: selectorInventory,
    stylesheetInventory: stylesheetInventory,
    validate: validate,
    diagnostics: diagnostics
  });

  global.FreshketSenseStyleRuntime = api;
  global.getFreshketStyleRuntimeSnapshot = diagnostics;
  if (!global.FreshketSenseRuntime) global.FreshketSenseRuntime = {};
  global.FreshketSenseRuntime.style = api;
})(window);
