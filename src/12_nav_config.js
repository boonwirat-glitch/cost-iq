/**
 * Freshket Sense — Nav Config System
 * src/12_nav_config.js
 *
 * SINGLE SOURCE OF TRUTH for nav behavior per role.
 *
 * To add a new tab:
 *   1. Add to TABS with its HTML button ID
 *   2. Add to ALL_IDS
 *   3. Add to relevant roles in NAV_CONFIG
 *
 * To add a new role:
 *   1. Add a row to NAV_CONFIG
 *
 * No CSS changes needed.
 */
(function() {
  'use strict';

  var TABS = {
    'portview':         { id: 'nav-overview' },
    'restaurant':       { id: 'nav-restaurant' },
    'echo-kam':         { id: 'nav-echo-kam' },
    'opportunities':    { id: 'nav-opportunities' },
    'skills':           { id: 'nav-skills', hideWhen: ['sense-plan-expanded', 'kam-sense-active'] },
    'sales-portview':   { id: 'nav-sales-portview' },
    'sales-pipeline':   { id: 'nav-sales-pipeline' },
    'sales-echo':       { id: 'nav-echo' },
    'sales-commission': { id: 'nav-sales-commission' },
    'sales-teamview':   { id: 'nav-sales-teamview' },
  };

  var NAV_CONFIG = {
    'rep': {
      tabs: ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    },
    'tl': {
      tabs: ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    },
    'admin': {
      tabs: ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    },
    'ad': {
      tabs: ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    },
    'pm': {
      tabs: ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    },
    'ad_tl': {
      tabs: ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
    },
    'sales': {
      tabs: ['sales-portview', 'sales-pipeline', 'sales-echo', 'sales-commission', 'skills'],
    },
    'sales_tl': {
      tabs: ['sales-portview', 'sales-pipeline', 'sales-echo', 'sales-commission', 'skills', 'sales-teamview'],
    },
  };

  var ALL_IDS = [
    'nav-overview', 'nav-portview', 'nav-restaurant', 'nav-echo-kam',
    'nav-opportunities', 'nav-skills', 'nav-teamview',
    'nav-sales-portview', 'nav-sales-pipeline', 'nav-echo',
    'nav-sales-commission', 'nav-sales-teamview',
    'nav-portfolio', 'nav-report',
  ];

  function renderNav(role) {
    var config = NAV_CONFIG[role];
    if (!config) { console.warn('[NavConfig] unknown role:', role); return; }

    var bodyClasses = document.body.className;

    ALL_IDS.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    var visibleCount = 0;
    config.tabs.forEach(function(key, i) {
      var tab = TABS[key];
      if (!tab) return;
      if (tab.hideWhen && tab.hideWhen.some(function(cls) {
        return bodyClasses.indexOf(cls) !== -1;
      })) return;
      var el = document.getElementById(tab.id);
      if (!el) return;
      el.style.display = 'flex';
      el.style.order = String(i + 1);
      visibleCount++;
    });

    var bnav = document.querySelector('.bnav');
    if (bnav) bnav.style.gridTemplateColumns = 'repeat(' + visibleCount + ', 1fr)';

  }

  // v_key round3: Products (nav-opportunities) used to be Save-only and got disabled
  // on account-less screens via a per-role disabled-screens list — retired now that its
  // popover's Key SKU row works with no account selected too. Kept as a no-op since other
  // modules still call this defensively (see 05_kam_view.js's "idempotent" comment at its call site).
  function updateSaveState(screen) {
    var btn = document.getElementById('nav-opportunities');
    if (btn) btn.classList.remove('nav-disabled');
  }

  var _origShow = window.showScreen;
  window.showScreen = function(name) {
    var r = _origShow ? _origShow.call(this, name) : undefined;
    updateSaveState(name);
    // v806: re-render nav whenever returning to a non-Save screen.
    // showScreen (05_kam_view) removes kam-sense-active before calling _origShow,
    // but only when _kamSenseReturn is true. If the user entered Save without an
    // account selected (_kamSenseReturn never set), kam-sense-active stays on body
    // and Skills stays hidden after returning to portview.
    // Calling renderNav here — AFTER _origShow — sees the final body class state
    // and always shows the correct tabs for the destination screen.
    var _screensNeedingNavRefresh = ['portview','overview','teamview','skills','echo-kam'];
    if (_screensNeedingNavRefresh.indexOf(name) !== -1) {
      try {
        var role = (typeof getCurrentRole === 'function') ? getCurrentRole() : null;
        if (role) renderNav(role);
      } catch(_e) {}
    }
    return r;
  };

  window.NavConfig = {
    render: renderNav,
    updateSaveState: updateSaveState,
  };

})();
