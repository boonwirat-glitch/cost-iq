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
      saveDisabledOn: ['portview', 'teamview', 'skills'],
    },
    'tl': {
      tabs: ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
      saveDisabledOn: ['portview', 'teamview', 'skills'],
    },
    'admin': {
      tabs: ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
      saveDisabledOn: ['portview', 'teamview', 'skills'],
    },
    'ad': {
      tabs: ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
      saveDisabledOn: ['portview', 'teamview', 'skills'],
    },
    'ad_tl': {
      tabs: ['portview', 'restaurant', 'echo-kam', 'opportunities', 'skills'],
      saveDisabledOn: ['portview', 'teamview', 'skills'],
    },
    'sales': {
      tabs: ['sales-portview', 'sales-pipeline', 'sales-echo', 'sales-commission', 'skills'],
      saveDisabledOn: [],
    },
    'sales_tl': {
      tabs: ['sales-portview', 'sales-pipeline', 'sales-echo', 'sales-commission', 'skills', 'sales-teamview'],
      saveDisabledOn: [],
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

    console.log('[NavConfig] rendered:', role, visibleCount, 'tabs');
  }

  function updateSaveState(screen) {
    var role = (typeof getCurrentRole === 'function') ? getCurrentRole() : null;
    var config = role ? NAV_CONFIG[role] : null;
    var btn = document.getElementById('nav-opportunities');
    if (!btn || !config) return;
    btn.classList.toggle('nav-disabled', config.saveDisabledOn.indexOf(screen) !== -1);
  }

  var _origShow = window.showScreen;
  window.showScreen = function(name) {
    var r = _origShow ? _origShow.call(this, name) : undefined;
    updateSaveState(name);
    return r;
  };

  window.NavConfig = {
    render: renderNav,
    updateSaveState: updateSaveState,
  };

})();
