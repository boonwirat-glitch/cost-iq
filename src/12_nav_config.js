/**
 * Freshket Sense — Nav Config System (v2)
 * src/12_nav_config.js
 *
 * Single source of truth: role → tabs
 * Trigger: MutationObserver on body[data-role] — no setTimeout race
 */
(function() {
  'use strict';

  // ─── Tab map: key → HTML button ID ─────────────────────────────────────────
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

  // ─── Role → ordered tabs ────────────────────────────────────────────────────
  var NAV_CONFIG = {
    'rep':      ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    'tl':       ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    'admin':    ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    'ad':       ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    'ad_tl':    ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    'sales':    ['sales-portview', 'sales-pipeline', 'sales-echo', 'sales-commission', 'skills'],
    'sales_tl': ['sales-portview', 'sales-pipeline', 'sales-echo', 'sales-commission', 'skills', 'sales-teamview'],
  };

  // All HTML nav button IDs — everything NOT in active config gets hidden
  var ALL_IDS = [
    'nav-overview', 'nav-portview', 'nav-restaurant', 'nav-echo-kam', 'nav-opportunities',
    'nav-skills', 'nav-teamview', 'nav-overview',
    'nav-sales-portview', 'nav-sales-pipeline', 'nav-echo',
    'nav-sales-commission', 'nav-sales-teamview',
    'nav-portfolio', 'nav-report',
  ];

  // Save disabled on these screens (no account selected)
  var SAVE_DISABLED = ['portview', 'teamview'];

  // ─── renderNav ──────────────────────────────────────────────────────────────
  function renderNav(role) {
    var tabs = NAV_CONFIG[role];
    if (!tabs) { console.warn('[NavConfig] unknown role:', role); return; }

    // 1. Hide everything
    ALL_IDS.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // 2. Show tabs in order
    tabs.forEach(function(key, i) {
      var id = TABS[key];
      if (!id) return;
      var el = document.getElementById(id);
      if (!el) return;
      el.style.display = 'flex';
      el.style.order = String(i + 1);
    });

    // 3. Tell CSS how many tabs via CSS variable
    var bnav = document.querySelector('.bnav');
    if (bnav) bnav.style.setProperty('--tab-count', String(tabs.length));

    console.log('[NavConfig] rendered:', role, '→', tabs.length, 'tabs');
  }

  // ─── updateSaveState ────────────────────────────────────────────────────────
  function updateSaveState(screen) {
    var btn = document.getElementById('nav-opportunities');
    if (!btn) return;
    var disable = SAVE_DISABLED.indexOf(screen) !== -1;
    btn.classList.toggle('nav-disabled', disable);
  }

  // ─── Patch showScreen for Save state ────────────────────────────────────────
  // Safe: runs after all other scripts load (12 is last)
  var _orig = window.showScreen;
  window.showScreen = function(name) {
    var r = _orig ? _orig.call(this, name) : undefined;
    updateSaveState(name);
    return r;
  };

  // ─── Watch body[data-role] via MutationObserver ──────────────────────────────
  // _autoRouteAfterLogin calls normalizeProfileAndBody which sets data-role
  // This fires immediately when that happens — no setTimeout needed
  var _lastRole = null;
  var _obs = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.attributeName === 'data-role') {
        var role = document.body.getAttribute('data-role');
        if (role && role !== _lastRole) {
          _lastRole = role;
          renderNav(role);
        }
      }
    });
  });
  _obs.observe(document.body, { attributes: true, attributeFilter: ['data-role'] });

  // ─── Also run on DOMContentLoaded if data-role already set ──────────────────
  function _tryInit() {
    var role = document.body.getAttribute('data-role');
    if (role) { _lastRole = role; renderNav(role); }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _tryInit);
  } else {
    _tryInit();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  window.NavConfig = {
    render: renderNav,
    updateSaveState: updateSaveState,
  };

})();
