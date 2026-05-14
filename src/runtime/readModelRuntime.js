// Freshket Sense read model boundary — Phase 14.
// Purpose: provide read-only selectors for future renderer extraction.
// This file must not mutate DOM, app state, localStorage, IndexedDB, or network state.
(function(global){
  'use strict';

  const VERSION = 'phase14-read-model-boundary';
  const BEHAVIOR_CHANGED = false;

  function now(){ return new Date().toISOString(); }
  function safe(fn, fallback){ try{ return fn(); }catch(e){ return fallback; } }
  function isObj(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }
  function arr(v){ return Array.isArray(v) ? v : []; }
  function num(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function text(v){ return v == null ? '' : String(v); }
  function cloneShallowArray(list, limit){ return arr(list).slice(0, limit || list.length).map(function(x){ return isObj(x) ? Object.assign({}, x) : x; }); }
  function keys(v){ return isObj(v) ? Object.keys(v) : []; }
  function compactObject(obj){
    const out = {};
    Object.keys(obj || {}).forEach(function(k){ if(obj[k] !== undefined) out[k] = obj[k]; });
    return out;
  }

  function baseState(){
    const D = global.D || {};
    return {
      D: D,
      OPPS: arr(global.OPPS),
      selectedOpps: global.selectedOpps || global.sel || null,
      currentAccountId: global.currentAccountId || (D.meta && D.meta.accountId) || null,
      currentUser: global.currentUser || null,
      currentUserProfile: global.currentUserProfile || null,
      mode: global.mode || (global.isKAM ? 'kam' : 'restaurant'),
      isKAM: !!global.isKAM
    };
  }

  function dataAvailability(){
    const s = baseState();
    const D = s.D || {};
    return {
      accountLoaded: !!(s.currentAccountId || (D.meta && D.meta.accountName)),
      historyRows: arr(D.history).length,
      categoryRows: arr(D.cats).length,
      categoryMonthlyKeys: keys(D.cats_monthly).length,
      skuRows: arr(D.skus).length,
      skuCurrentRows: arr(D.sku_current).length,
      skuMonthlyKeys: keys(D.skus_monthly).length,
      alternativeRows: arr(D.alts).length,
      opportunityRows: arr(s.OPPS).length,
      outletMonthlyKeys: keys(D.outlets_monthly).length,
      currentMonthLoaded: !!D.current_month,
      bulkHistoryAccounts: keys(global.bulkHistoryData).length,
      bulkSkuAccounts: keys(global.bulkSkusData).length,
      bulkPortviewRows: arr(global.bulkPortviewData).length,
      weeklyDataAvailable: false,
      supplierDataAvailable: false,
      menuDataAvailable: false,
      customerCallNotesAvailable: false
    };
  }

  function accountIdentity(){
    const s = baseState();
    const D = s.D || {};
    const meta = D.meta || {};
    return compactObject({
      accountId: s.currentAccountId || meta.accountId || null,
      accountName: meta.accountName || global.bulkAccountNames && global.bulkAccountNames[s.currentAccountId] || '',
      kamName: meta.kamName || '',
      currentMonth: D.current_month && (D.current_month.m || D.current_month.month) || D.current_month || null,
      mode: s.mode,
      isKAM: s.isKAM,
      userEmail: s.currentUser && s.currentUser.email || null,
      userRole: s.currentUserProfile && (s.currentUserProfile.role || s.currentUserProfile.user_role) || null
    });
  }

  function historySummary(){
    const h = arr(baseState().D.history);
    const first = h[0] || null;
    const last = h[h.length - 1] || null;
    const total = h.reduce(function(sum,r){ return sum + num(r.gmv || r.gmv_ex_vat || r.sales || r.amount); }, 0);
    return {
      rows: h.length,
      firstMonth: first && (first.m || first.month) || null,
      lastMonth: last && (last.m || last.month) || null,
      first: first ? Object.assign({}, first) : null,
      last: last ? Object.assign({}, last) : null,
      totalKnownGmv: total,
      sample: cloneShallowArray(h, 6)
    };
  }

  function categorySummary(limit){
    const D = baseState().D || {};
    const cats = arr(D.cats);
    const rows = cats.length ? cats : Object.keys(D.cats_monthly || {}).reduce(function(acc,m){ return acc.concat(arr((D.cats_monthly || {})[m])); }, []);
    return {
      rows: rows.length,
      top: cloneShallowArray(rows, limit || 8),
      monthlyKeys: keys(D.cats_monthly)
    };
  }

  function skuSummary(limit){
    const D = baseState().D || {};
    const skus = arr(D.skus);
    return {
      rows: skus.length,
      currentRows: arr(D.sku_current).length,
      monthlyKeys: keys(D.skus_monthly),
      top: cloneShallowArray(skus, limit || 12),
      currentTop: cloneShallowArray(D.sku_current, limit || 12)
    };
  }

  function opportunitySummary(limit){
    const opps = arr(baseState().OPPS);
    const selected = baseState().selectedOpps;
    let selectedCount = 0;
    if(selected && typeof selected.size === 'number') selectedCount = selected.size;
    else if(Array.isArray(selected)) selectedCount = selected.length;
    return {
      rows: opps.length,
      selectedCount: selectedCount,
      top: cloneShallowArray(opps, limit || 10)
    };
  }

  function outletSummary(limit){
    const D = baseState().D || {};
    const monthKeys = keys(D.outlets_monthly);
    const latestKey = monthKeys[monthKeys.length - 1] || null;
    const rows = latestKey ? arr(D.outlets_monthly[latestKey]) : [];
    return {
      monthlyKeys: monthKeys,
      latestMonth: latestKey,
      rows: rows.length,
      top: cloneShallowArray(rows, limit || 8)
    };
  }

  function portfolioSummary(limit){
    const rows = arr(global.bulkPortviewData);
    return {
      rows: rows.length,
      filteredRows: arr(global.portviewAccounts || global.filteredPortviewAccounts).length || null,
      filter: global.portviewFilter || null,
      sort: global.portviewSort || null,
      top: cloneShallowArray(rows, limit || 12),
      bulkHistoryAccounts: keys(global.bulkHistoryData).length,
      bulkCurrentMonthAccounts: keys(global.bulkCurrentMonthData).length
    };
  }

  function teamSummary(limit){
    return {
      scope: global.teamviewScope || null,
      selectedKam: global.teamviewSelectedKam || null,
      rows: arr(global.teamviewRows || global.teamviewKamRows).length,
      top: cloneShallowArray(global.teamviewRows || global.teamviewKamRows, limit || 12),
      bulkHistoryAccounts: keys(global.bulkHistoryData).length,
      currentUserProfile: isObj(global.currentUserProfile) ? Object.assign({}, global.currentUserProfile) : null
    };
  }

  function reportModel(){
    return {
      screen: 'report',
      account: accountIdentity(),
      availability: dataAvailability(),
      history: historySummary(),
      categories: categorySummary(8),
      skus: skuSummary(12),
      opportunities: opportunitySummary(12),
      behaviorChanged: BEHAVIOR_CHANGED,
      ts: now()
    };
  }

  function restaurantOverviewModel(){
    return {
      screen: 'overview',
      account: accountIdentity(),
      availability: dataAvailability(),
      history: historySummary(),
      categories: categorySummary(8),
      outlets: outletSummary(8),
      opportunities: opportunitySummary(5),
      behaviorChanged: BEHAVIOR_CHANGED,
      ts: now()
    };
  }

  function portfolioModel(){
    return {
      screen: 'portfolio',
      account: accountIdentity(),
      availability: dataAvailability(),
      history: historySummary(),
      skus: skuSummary(20),
      behaviorChanged: BEHAVIOR_CHANGED,
      ts: now()
    };
  }

  function opportunitiesModel(){
    return {
      screen: 'opportunities',
      account: accountIdentity(),
      availability: dataAvailability(),
      skus: skuSummary(12),
      opportunities: opportunitySummary(20),
      behaviorChanged: BEHAVIOR_CHANGED,
      ts: now()
    };
  }

  function kamAccountModel(){
    return {
      screen: 'kamOverview',
      account: accountIdentity(),
      availability: dataAvailability(),
      history: historySummary(),
      skus: skuSummary(15),
      opportunities: opportunitySummary(10),
      behaviorChanged: BEHAVIOR_CHANGED,
      ts: now()
    };
  }

  function portviewModel(){
    return {
      screen: 'portview',
      account: accountIdentity(),
      availability: dataAvailability(),
      portfolio: portfolioSummary(20),
      behaviorChanged: BEHAVIOR_CHANGED,
      ts: now()
    };
  }

  function teamviewModel(){
    return {
      screen: 'teamview',
      account: accountIdentity(),
      availability: dataAvailability(),
      team: teamSummary(20),
      behaviorChanged: BEHAVIOR_CHANGED,
      ts: now()
    };
  }

  function getViewModel(key){
    const map = {
      overview: restaurantOverviewModel,
      portfolio: portfolioModel,
      opportunities: opportunitiesModel,
      report: reportModel,
      kamOverview: kamAccountModel,
      portview: portviewModel,
      teamview: teamviewModel
    };
    const fn = map[key] || map.report;
    return fn();
  }

  function diagnostics(){
    const registry = global.FreshketSenseViewRegistry || null;
    const availability = dataAvailability();
    return {
      version: VERSION,
      behaviorChanged: BEHAVIOR_CHANGED,
      registryLoaded: !!registry,
      registryVersion: registry && registry.version || null,
      selectors: ['accountIdentity','dataAvailability','historySummary','categorySummary','skuSummary','opportunitySummary','outletSummary','portfolioSummary','teamSummary','getViewModel'],
      availability: availability,
      account: accountIdentity(),
      validation: validate(),
      ts: now()
    };
  }

  function validate(){
    const required = ['overview','portfolio','opportunities','report','kamOverview','portview','teamview'];
    const models = required.map(function(key){
      return safe(function(){
        const model = getViewModel(key);
        return { key:key, ok:!!model && model.screen === key && model.behaviorChanged === false, screen:model && model.screen || null };
      }, { key:key, ok:false, screen:null });
    });
    return {
      ok: models.every(function(m){ return m.ok; }),
      behaviorChanged: BEHAVIOR_CHANGED,
      models: models
    };
  }

  function printDiagnostics(){
    const diag = diagnostics();
    try{
      console.log('Freshket read model diagnostics:', diag);
      console.table(diag.validation.models.map(function(m){ return { key:m.key, ok:m.ok, screen:m.screen }; }));
    }catch(e){}
    return diag;
  }

  const api = Object.freeze({
    version: VERSION,
    behaviorChanged: BEHAVIOR_CHANGED,
    accountIdentity: accountIdentity,
    dataAvailability: dataAvailability,
    historySummary: historySummary,
    categorySummary: categorySummary,
    skuSummary: skuSummary,
    opportunitySummary: opportunitySummary,
    outletSummary: outletSummary,
    portfolioSummary: portfolioSummary,
    teamSummary: teamSummary,
    getViewModel: getViewModel,
    reportModel: reportModel,
    restaurantOverviewModel: restaurantOverviewModel,
    portfolioModel: portfolioModel,
    opportunitiesModel: opportunitiesModel,
    kamAccountModel: kamAccountModel,
    portviewModel: portviewModel,
    teamviewModel: teamviewModel,
    diagnostics: diagnostics,
    validate: validate,
    printDiagnostics: printDiagnostics
  });

  const previousRuntime = global.FreshketSenseRuntime || {};
  global.FreshketSenseRuntime = Object.assign({}, previousRuntime, { readModel: api });
  global.FreshketSenseReadModelRuntime = api;
  global.getFreshketReadModelSnapshot = diagnostics;
  global.printFreshketReadModelDiagnostics = printDiagnostics;
})(window);
