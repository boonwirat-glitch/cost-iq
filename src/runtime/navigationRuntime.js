// Freshket Sense Navigation / Screen Controller Boundary — Phase 19.
// Purpose: route navigation entry points through a single controller seam while preserving legacy fallback.
// Scope: showScreen, setMode, navPortHome. No nav/swipe/mode behavior changes intended.
(function(global){
  'use strict';

  const VERSION = 'phase19-1-navigation-regression-test';
  const BEHAVIOR_CHANGED = false;
  const ENTRY_POINTS = ['showScreen', 'setMode', 'navPortHome'];
  const calls = [];
  const MAX_CALLS = 100;

  function now(){ return new Date().toISOString(); }
  function pushCall(name, args, ok, detail){
    calls.push({ name, args: Array.prototype.slice.call(args || []), ok: !!ok, detail: detail || '', ts: now() });
    if(calls.length > MAX_CALLS) calls.shift();
  }
  function hasFn(fn){ return typeof fn === 'function'; }
  function el(id){ return global.document && document.getElementById(id); }
  function getActiveScreen(){
    const active = global.document && document.querySelector('.scr.on');
    return active && active.id ? active.id.replace(/^scr-/, '') : null;
  }
  function getActiveNav(){
    const active = global.document && document.querySelector('.ni.on');
    return active && active.id ? active.id.replace(/^nav-/, '') : null;
  }
  function getSwipeGroups(){
    return ['swipe-grp-a','swipe-grp-b'].map(function(id){
      const node = el(id);
      return { id, exists: !!node, active: !!(node && node.classList.contains('on')), scrollLeft: node ? node.scrollLeft : null };
    });
  }
  function normalizeContext(ctx){
    ctx = ctx || {};
    return {
      legacy: ctx.legacy || {},
      isKAM: typeof ctx.isKAM === 'boolean' ? ctx.isKAM : !!global.isKAM,
      currentAccountId: ctx.currentAccountId || global.currentAccountId || null,
      currentUserProfile: ctx.currentUserProfile || global.currentUserProfile || null,
      senseActivated: typeof ctx.senseActivated === 'boolean' ? ctx.senseActivated : !!global.senseActivated,
      activeScreen: getActiveScreen(),
      activeNav: getActiveNav(),
      bodyKamMode: !!(global.document && document.body && document.body.classList.contains('kam-mode')),
      swipeGroups: getSwipeGroups()
    };
  }
  function safeLegacy(name, fn, args){
    if(!hasFn(fn)){
      pushCall(name, args, false, 'missing legacy fallback');
      return { ok:false, controller:VERSION, method:name, reason:'missing legacy fallback', behaviorChanged:BEHAVIOR_CHANGED, ts:now() };
    }
    try{
      const value = fn.apply(global, args || []);
      pushCall(name, args, true, 'legacy-navigation-through-controller');
      return value;
    }catch(error){
      pushCall(name, args, false, error && error.message || String(error));
      throw error;
    }
  }

  function showScreenFromLegacy(ctx, name){
    ctx = normalizeContext(ctx);
    return safeLegacy('showScreen', ctx.legacy && ctx.legacy.showScreen, [name]);
  }
  function setModeFromLegacy(ctx, mode){
    ctx = normalizeContext(ctx);
    return safeLegacy('setMode', ctx.legacy && ctx.legacy.setMode, [mode]);
  }
  function navPortHomeFromLegacy(ctx){
    ctx = normalizeContext(ctx);
    return safeLegacy('navPortHome', ctx.legacy && ctx.legacy.navPortHome, []);
  }

  function validate(){
    const ids = [
      ['nav-overview', !!el('nav-overview')],
      ['nav-portfolio', !!el('nav-portfolio')],
      ['nav-opportunities', !!el('nav-opportunities')],
      ['nav-portview', !!el('nav-portview')],
      ['nav-teamview', !!el('nav-teamview')],
      ['swipe-grp-a', !!el('swipe-grp-a')],
      ['swipe-grp-b', !!el('swipe-grp-b')],
      ['mode-toggle-wrap', !!el('mode-toggle-wrap')],
      ['kambar', !!el('kambar')]
    ].map(function(row){ return { id:row[0], ok:!!row[1] }; });
    return {
      ok: !!global.document ? ids.filter(function(x){ return x.ok; }).length >= 4 : true,
      ids,
      note: 'Navigation anchors are soft-validated because role/mode-specific elements may be hidden or absent in some sessions.',
      behaviorChanged: BEHAVIOR_CHANGED,
      ts: now()
    };
  }

  function diagnostics(){
    const ctx = normalizeContext({});
    return {
      version: VERSION,
      behaviorChanged: BEHAVIOR_CHANGED,
      entryPoints: ENTRY_POINTS.slice(),
      validation: validate(),
      context: ctx,
      recentCalls: calls.slice(-30),
      ts: now()
    };
  }

  const api = Object.freeze({
    version: VERSION,
    behaviorChanged: BEHAVIOR_CHANGED,
    entryPoints: ENTRY_POINTS.slice(),
    showScreenFromLegacy,
    setModeFromLegacy,
    navPortHomeFromLegacy,
    validate,
    diagnostics
  });

  global.FreshketSenseNavigationRuntime = api;
  global.FreshketSenseRuntime = global.FreshketSenseRuntime || {};
  global.FreshketSenseRuntime.navigation = api;
  global.getFreshketNavigationRuntimeSnapshot = diagnostics;
})(window);
