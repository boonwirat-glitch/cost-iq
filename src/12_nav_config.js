/**
 * Freshket Sense — Nav Config System (v3)
 * src/12_nav_config.js
 *
 * Hook: patches _senseNormalizeProfileAndBody (set by 07b_cds.js)
 * Called every time role is confirmed — guaranteed correct timing.
 */
(function() {
  'use strict';

  var TABS = {
    'portview':         'nav-overview',
    'restaurant':       'nav-restaurant',
    'echo-kam':         'nav-echo-kam',
    'opportunities':    'nav-opportunities',
    'skills':           'nav-skills',
    'sales-portview':   'nav-sales-portview',
    'sales-pipeline':   'nav-sales-pipeline',
    'sales-echo':       'nav-echo',
    'sales-commission': 'nav-sales-commission',
    'sales-teamview':   'nav-sales-teamview',
  };

  var NAV_CONFIG = {
    'rep':      ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    'tl':       ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    'admin':    ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    'ad':       ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    'ad_tl':    ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    'sales':    ['sales-portview', 'sales-pipeline', 'sales-echo', 'sales-commission', 'skills'],
    'sales_tl': ['sales-portview', 'sales-pipeline', 'sales-echo', 'sales-commission', 'skills', 'sales-teamview'],
  };

  var ALL_IDS = [
    'nav-overview', 'nav-portview', 'nav-restaurant', 'nav-echo-kam',
    'nav-opportunities', 'nav-skills', 'nav-teamview',
    'nav-sales-portview', 'nav-sales-pipeline', 'nav-echo',
    'nav-sales-commission', 'nav-sales-teamview',
    'nav-portfolio', 'nav-report',
  ];

  var SAVE_DISABLED = ['portview', 'teamview'];

  // ─── renderNav ──────────────────────────────────────────────────────────────
  function renderNav(role) {
    var tabs = NAV_CONFIG[role];
    if (!tabs) { console.warn('[NavConfig] unknown role:', role); return; }

    // Hide all
    ALL_IDS.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // Show tabs in order
    tabs.forEach(function(key, i) {
      var id = TABS[key];
      if (!id) return;
      var el = document.getElementById(id);
      if (!el) return;
      el.style.display = 'flex';
      el.style.order = String(i + 1);
    });

    // Set CSS variable for grid columns
    var bnav = document.querySelector('.bnav');
    if (bnav) bnav.style.setProperty('--tab-count', String(tabs.length));

    console.log('[NavConfig] rendered:', role, tabs.length, 'tabs');
  }

  // ─── updateSaveState ────────────────────────────────────────────────────────
  function updateSaveState(screen) {
    var btn = document.getElementById('nav-opportunities');
    if (!btn) return;
    btn.classList.toggle('nav-disabled', SAVE_DISABLED.indexOf(screen) !== -1);
  }

  // ─── Patch showScreen ───────────────────────────────────────────────────────
  var _origShow = window.showScreen;
  window.showScreen = function(name) {
    var r = _origShow ? _origShow.call(this, name) : undefined;
    updateSaveState(name);
    return r;
  };

  // ─── Hook: patch _senseNormalizeProfileAndBody ─────────────────────────────
  // 07b_cds.js sets window._senseNormalizeProfileAndBody = normalizeProfileAndBody
  // We wrap it so renderNav fires every time role is confirmed (login, re-render, etc.)
  function _patchNormalize() {
    var orig = window._senseNormalizeProfileAndBody;
    if (!orig || orig._navConfigPatched) return false;
    window._senseNormalizeProfileAndBody = function() {
      var role = orig.apply(this, arguments);
      if (role) renderNav(role);
      return role;
    };
    window._senseNormalizeProfileAndBody._navConfigPatched = true;
    console.log('[NavConfig] hooked _senseNormalizeProfileAndBody');
    return true;
  }

  // Try immediately (12 loads after 07b — should be ready)
  if (!_patchNormalize()) {
    // Fallback: retry once after a tick (race condition safety net)
    setTimeout(function() {
      if (!_patchNormalize()) {
        console.warn('[NavConfig] _senseNormalizeProfileAndBody not found — using data-role fallback');
        // Last resort: read data-role directly
        var role = document.body.getAttribute('data-role');
        if (role) renderNav(role);
      }
    }, 200);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  window.NavConfig = {
    render: renderNav,
    updateSaveState: updateSaveState,
  };

})();
