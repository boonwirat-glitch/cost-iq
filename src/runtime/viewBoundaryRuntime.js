// Freshket Sense view boundary runtime — Phase 13.
// Diagnostic-first boundary: reads FreshketSenseViewRegistry and validates screen/renderer inventory without rewriting UI behavior.
(function(global){
  'use strict';

  const CFG = global.FreshketSenseConfig || {};
  const STORAGE_CFG = CFG.storage || {};
  const STORAGE_KEY = STORAGE_CFG.viewRuntimeDisabledKey || 'freshket_view_runtime_disabled';
  const VERSION = 'phase13-view-registry-inventory';
  const REGISTRY = global.FreshketSenseViewRegistry || { screens:{}, groups:{}, rendererNames:[], domAnchors:[], stateReads:[], extractionOrder:[], behaviorChanged:false };
  const screenRegistry = REGISTRY.screens || {};
  const viewGroups = REGISTRY.groups || {};

  const state = {
    installedAt: new Date().toISOString(),
    lastOperation: null,
    lastOperationAt: null,
    lastError: null,
    readCount: 0
  };

  function now(){ return new Date().toISOString(); }
  function mark(op){ state.lastOperation = op; state.lastOperationAt = now(); }
  function keys(obj){ return Object.keys(obj || {}); }
  function isDisabled(){
    try { return !!global.localStorage && localStorage.getItem(STORAGE_KEY) === '1'; }
    catch(e){ return false; }
  }
  function hasEl(id){ return !!(id && global.document && document.getElementById(id)); }
  function getElClass(id){ const el = id && global.document && document.getElementById(id); return el ? String(el.className || '') : null; }
  function hasFn(name){ return typeof global[name] === 'function'; }
  function isVisibleByClass(id){
    const el = id && global.document && document.getElementById(id);
    if(!el) return false;
    return el.classList ? el.classList.contains('on') : /\bon\b/.test(String(el.className || ''));
  }
  function domAnchorDiagnostics(meta){
    return (meta.domAnchors || []).map(function(id){ return { id:id, exists:hasEl(id), className:getElClass(id) }; });
  }
  function rendererDiagnostics(meta){
    return (meta.primaryRenderers || meta.renderFns || []).map(function(fn){ return { name:fn, exists:hasFn(fn) }; });
  }
  function getActiveScreen(){
    mark('view.getActiveScreen'); state.readCount += 1;
    const active = [];
    keys(screenRegistry).forEach(function(key){
      const meta = screenRegistry[key];
      if(isVisibleByClass(meta.id)) active.push({ key:key, id:meta.id, label:meta.label, mode:meta.mode || null });
    });
    return active;
  }
  function getActiveNav(){
    mark('view.getActiveNav'); state.readCount += 1;
    const navs = [];
    try{
      if(global.document){
        document.querySelectorAll('.ni.on').forEach(function(el){
          navs.push({ id:el.id || null, label:el.textContent ? el.textContent.trim().replace(/\s+/g,' ') : '' });
        });
      }
    }catch(error){ state.lastError = { op:'getActiveNav', message:error.message || String(error), at:now() }; }
    return navs;
  }
  function getScreenDiagnostics(){
    mark('view.getScreenDiagnostics'); state.readCount += 1;
    return keys(screenRegistry).map(function(key){
      const meta = screenRegistry[key];
      return {
        key:key,
        id:meta.id,
        label:meta.label,
        mode:meta.mode || null,
        group:meta.group,
        exists:hasEl(meta.id),
        navId:meta.navId,
        navExists:meta.navId ? hasEl(meta.navId) : false,
        isActive:isVisibleByClass(meta.id),
        className:getElClass(meta.id),
        extractionRisk:meta.extractionRisk || 'unknown',
        renderFns:rendererDiagnostics(meta),
        domAnchors:domAnchorDiagnostics(meta),
        stateReads:(meta.stateReads || []).slice(),
        notes:meta.notes || ''
      };
    });
  }
  function getGroupDiagnostics(){
    mark('view.getGroupDiagnostics'); state.readCount += 1;
    return keys(viewGroups).map(function(key){
      const group = viewGroups[key];
      return {
        key:key,
        id:group.id,
        mode:group.mode || null,
        behavior:group.behavior || null,
        exists:hasEl(group.id),
        className:getElClass(group.id),
        screens:(group.screens || []).slice()
      };
    });
  }
  function getRendererInventory(){
    mark('view.getRendererInventory'); state.readCount += 1;
    const names = (REGISTRY.rendererNames || []).slice().sort();
    return names.map(function(name){ return { name:name, exists:hasFn(name) }; });
  }
  function getDomInventory(){
    mark('view.getDomInventory'); state.readCount += 1;
    return (REGISTRY.domAnchors || []).slice().sort().map(function(id){ return { id:id, exists:hasEl(id) }; });
  }
  function getStateReadInventory(){
    mark('view.getStateReadInventory'); state.readCount += 1;
    return (REGISTRY.stateReads || []).slice().sort();
  }
  function getExtractionPlan(){
    mark('view.getExtractionPlan'); state.readCount += 1;
    return (REGISTRY.extractionOrder || []).map(function(item){ return Object.assign({}, item); });
  }
  function validate(){
    const screens = getScreenDiagnostics();
    const groups = getGroupDiagnostics();
    const criticalScreens = ['overview','portfolio','opportunities','report'];
    const missingCriticalScreens = screens.filter(function(s){ return criticalScreens.indexOf(s.key) >= 0 && !s.exists; }).map(function(s){ return s.key; });
    const missingGroups = groups.filter(function(g){ return (g.key === 'restaurantA' || g.key === 'restaurantB') && !g.exists; }).map(function(g){ return g.key; });
    const missingRendererNames = getRendererInventory().filter(function(r){ return !r.exists; }).map(function(r){ return r.name; });
    const missingDomAnchors = getDomInventory().filter(function(d){ return !d.exists; }).map(function(d){ return d.id; });
    return {
      ok: missingCriticalScreens.length === 0 && missingGroups.length === 0,
      registryLoaded: !!global.FreshketSenseViewRegistry,
      registryVersion: REGISTRY.version || null,
      behaviorChanged: !!REGISTRY.behaviorChanged,
      missingCriticalScreens: missingCriticalScreens,
      missingGroups: missingGroups,
      missingRenderFns: missingRendererNames,
      missingDomAnchors: missingDomAnchors,
      at: now()
    };
  }
  function getSnapshot(){
    return {
      version: VERSION,
      registryVersion: REGISTRY.version || null,
      disabled: isDisabled(),
      behaviorChanged: false,
      state: Object.assign({}, state),
      activeScreens: getActiveScreen(),
      activeNav: getActiveNav(),
      screens: getScreenDiagnostics(),
      groups: getGroupDiagnostics(),
      renderers: getRendererInventory(),
      domAnchors: getDomInventory(),
      stateReads: getStateReadInventory(),
      extractionPlan: getExtractionPlan(),
      validation: validate(),
      mode: global.isKAM ? 'kam' : 'restaurant',
      currentMode: global.mode || null,
      ts: now()
    };
  }
  function printSnapshot(){
    const snapshot = getSnapshot();
    try{
      console.log('Freshket view registry / renderer inventory diagnostics:', snapshot);
      console.table(snapshot.screens.map(function(s){ return {
        key:s.key,
        exists:s.exists,
        active:s.isActive,
        nav:s.navExists,
        risk:s.extractionRisk,
        missingRenderFns:s.renderFns.filter(function(f){ return !f.exists; }).map(function(f){ return f.name; }).join(', '),
        missingDom:s.domAnchors.filter(function(d){ return !d.exists; }).map(function(d){ return d.id; }).join(', ')
      }; }));
    }catch(e){}
    return snapshot;
  }

  const runtime = Object.freeze({
    version: VERSION,
    storageKey: STORAGE_KEY,
    registry: REGISTRY,
    screensRegistry: screenRegistry,
    groups: viewGroups,
    isDisabled: isDisabled,
    activeScreens: getActiveScreen,
    activeNav: getActiveNav,
    screens: getScreenDiagnostics,
    groupsDiagnostics: getGroupDiagnostics,
    renderers: getRendererInventory,
    domInventory: getDomInventory,
    stateReadInventory: getStateReadInventory,
    extractionPlan: getExtractionPlan,
    validate: validate,
    getSnapshot: getSnapshot,
    printSnapshot: printSnapshot
  });

  const control = Object.freeze({
    version: VERSION,
    status: function(){ return { disabled:isDisabled(), storageKey:STORAGE_KEY, validation:validate(), at:now() }; },
    disableRuntime: function(reason){ try{ localStorage.setItem(STORAGE_KEY,'1'); }catch(e){} try{ console.warn('[Freshket Sense Phase 13] View runtime disabled flag set. Diagnostics remain safe; refresh optional.', reason || 'manual-disable'); }catch(e){} return this.status(); },
    enableRuntimeNextReload: function(){ try{ localStorage.removeItem(STORAGE_KEY); }catch(e){} return this.status(); }
  });

  global.FreshketSenseViewRuntime = runtime;
  global.FreshketSenseViewControl = control;
  global.getFreshketViewRuntimeSnapshot = getSnapshot;
  global.printFreshketViewDiagnostics = printSnapshot;
})(window);