// Freshket Sense KAM / Portfolio View / Team View Renderer Adapter — Phase 18.
// Purpose: route high-risk KAM renderers through a single renderer boundary while preserving legacy fallback.
// Scope: KAM account tabs, Portfolio View, Team View. No navigation, loader, auth, chat, or CSS/layout changes.
(function(global){
  'use strict';

  const VERSION = 'phase18-kam-team-renderer';
  const BEHAVIOR_CHANGED = false;
  const METHODS = [
    'renderKamThisMonth',
    'renderKamLastMonth',
    'renderKamOverview',
    'renderPortview',
    'renderPortviewSummary',
    'renderPortviewList',
    'renderTeamview',
    'renderTeamviewSummary',
    'renderTeamviewKamList'
  ];

  const calls = [];
  const MAX_CALLS = 80;

  function now(){ return new Date().toISOString(); }
  function pushCall(name, ok, detail){
    calls.push({ name, ok: !!ok, detail: detail || '', ts: now() });
    if(calls.length > MAX_CALLS) calls.shift();
  }
  function arr(v){ return Array.isArray(v) ? v : []; }
  function el(id){ return global.document && document.getElementById(id); }
  function hasFn(fn){ return typeof fn === 'function'; }
  function safeCall(name, fn){
    if(!hasFn(fn)){
      pushCall(name, false, 'missing legacy fallback');
      return { ok:false, renderer:VERSION, method:name, reason:'missing legacy fallback', behaviorChanged:BEHAVIOR_CHANGED, ts:now() };
    }
    try{
      const value = fn();
      pushCall(name, true, 'legacy-rendered-through-adapter');
      return { ok:true, renderer:VERSION, method:name, value, behaviorChanged:BEHAVIOR_CHANGED, ts:now() };
    }catch(error){
      pushCall(name, false, error && error.message || String(error));
      throw error;
    }
  }
  function normalizeContext(ctx){
    ctx = ctx || {};
    return {
      legacy: ctx.legacy || {},
      mode: ctx.mode || global.mode || null,
      currentAccountId: ctx.currentAccountId || global.currentAccountId || null,
      currentKamSubtab: ctx.currentKamSubtab || global.currentKamSubtab || null,
      portviewLevel: ctx.portviewLevel || global.portviewLevel || null,
      portviewFilter: ctx.portviewFilter || global.portviewFilter || null,
      teamviewLevel: ctx.teamviewLevel || global.teamviewLevel || null,
      D: ctx.D || global.D || null,
      OPPS: ctx.OPPS || global.OPPS || [],
      portviewBulkData: ctx.portviewBulkData || global.portviewBulkData || [],
      currentUserProfile: ctx.currentUserProfile || global.currentUserProfile || null
    };
  }
  function renderViaLegacy(methodName, ctx){
    ctx = normalizeContext(ctx);
    return safeCall(methodName, ctx.legacy && ctx.legacy[methodName]);
  }

  function renderKamThisMonthFromLegacy(ctx){ return renderViaLegacy('renderKamThisMonth', ctx); }
  function renderKamLastMonthFromLegacy(ctx){ return renderViaLegacy('renderKamLastMonth', ctx); }
  function renderKamOverviewFromLegacy(ctx){ return renderViaLegacy('renderKamOverview', ctx); }
  function renderPortviewFromLegacy(ctx){ return renderViaLegacy('renderPortview', ctx); }
  function renderPortviewSummaryFromLegacy(ctx){ return renderViaLegacy('renderPortviewSummary', ctx); }
  function renderPortviewListFromLegacy(ctx){ return renderViaLegacy('renderPortviewList', ctx); }
  function renderTeamviewFromLegacy(ctx){ return renderViaLegacy('renderTeamview', ctx); }
  function renderTeamviewSummaryFromLegacy(ctx){ return renderViaLegacy('renderTeamviewSummary', ctx); }
  function renderTeamviewKamListFromLegacy(ctx){ return renderViaLegacy('renderTeamviewKamList', ctx); }

  function validate(){
    const ids = [
      ['kam-cards', !!el('kam-cards')],
      ['kam-overview', !!el('kam-overview')],
      ['portview-list', !!el('portview-list')],
      ['teamview-list', !!el('teamview-list')],
      ['teamview-summary', !!el('teamview-summary')],
      ['portview-summary-row', !!el('portview-summary-row')]
    ].map(function(row){ return { id:row[0], ok:!!row[1] }; });
    const softOk = ids.some(function(x){ return x.ok; });
    return { ok: softOk || !global.document, ids, note:'DOM anchors are soft-validated because mode-specific screens may not all be mounted/visible.', behaviorChanged:BEHAVIOR_CHANGED, ts:now() };
  }

  function diagnostics(){
    const ctx = normalizeContext({});
    return {
      version: VERSION,
      behaviorChanged: BEHAVIOR_CHANGED,
      methods: METHODS.slice(),
      validation: validate(),
      context: {
        mode: ctx.mode,
        currentAccountId: ctx.currentAccountId,
        currentKamSubtab: ctx.currentKamSubtab,
        portviewLevel: ctx.portviewLevel,
        portviewFilter: ctx.portviewFilter,
        teamviewLevel: ctx.teamviewLevel,
        hasD: !!ctx.D,
        historyCount: ctx.D && arr(ctx.D.history).length || 0,
        oppCount: arr(ctx.OPPS).length,
        bulkAccountCount: arr(ctx.portviewBulkData).length,
        userRole: ctx.currentUserProfile && ctx.currentUserProfile.role || null
      },
      recentCalls: calls.slice(-20),
      ts: now()
    };
  }

  const api = Object.freeze({
    version: VERSION,
    behaviorChanged: BEHAVIOR_CHANGED,
    methods: METHODS.slice(),
    renderKamThisMonthFromLegacy,
    renderKamLastMonthFromLegacy,
    renderKamOverviewFromLegacy,
    renderPortviewFromLegacy,
    renderPortviewSummaryFromLegacy,
    renderPortviewListFromLegacy,
    renderTeamviewFromLegacy,
    renderTeamviewSummaryFromLegacy,
    renderTeamviewKamListFromLegacy,
    validate,
    diagnostics
  });

  global.FreshketSenseKamTeamRenderer = api;
  global.FreshketSenseRuntime = global.FreshketSenseRuntime || {};
  global.FreshketSenseRuntime.views = global.FreshketSenseRuntime.views || {};
  global.FreshketSenseRuntime.views.kamTeamRenderer = api;
  global.getFreshketKamTeamRendererSnapshot = diagnostics;
})(window);
