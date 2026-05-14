// Phase 6.1 legacy loader adapter.
// Phase 6.1 legacy loader adapter.
// It replaces loader globals with runtime-owned orchestration implementations while retaining Phase 5.1 originals as fallback.
(function(global){
  'use strict';
  const data = global.FreshketSenseRuntime && global.FreshketSenseRuntime.data;
  const originals = global.FreshketSenseLegacyData || {};
  const ADAPTED_NAMES = ['_fetchCloudflareFile','ensureCloudflareFiles','_startCloudBackgroundLoad','loadFromCloudflareR2','reloadFromCloudflareR2','loadFromGoogleSheets','reloadFromGoogleSheets','ensureAccountDetailData','ensureSenseData','loadFromSupabaseStorage'];
  const FLAG_KEYS = ['freshket_loader_runtime_disabled','freshket_force_legacy_loader'];
  function normalizeFlag(v){ return v === true || v === '1' || v === 'true' || v === 'yes' || v === 'legacy'; }
  function readFlag(){
    try{
      const qs = new URLSearchParams(global.location && global.location.search || '');
      if(qs.get('freshket_loader_runtime') === 'legacy') return { disabled:true, source:'query:freshket_loader_runtime=legacy' };
      if(qs.get('freshket_loader_runtime') === 'runtime') return { disabled:false, source:'query:freshket_loader_runtime=runtime' };
    }catch(e){}
    try{
      for(const k of FLAG_KEYS){
        const v = global.localStorage && localStorage.getItem(k);
        if(normalizeFlag(v)) return { disabled:true, source:'localStorage:' + k, value:v };
      }
    }catch(e){}
    return { disabled:false, source:'default' };
  }
  function fallback(name){ return originals[name]; }
  function setGlobal(name, fn){
    try{ global[name] = fn; }catch(e){}
    try{ eval(name + ' = fn'); }catch(e){}
  }
  function restoreLegacyNow(){
    const restored = [];
    ADAPTED_NAMES.forEach(function(name){
      if(typeof originals[name] === 'function'){
        setGlobal(name, originals[name]);
        restored.push(name);
      }
    });
    return restored;
  }
  function makeControl(statusRef){
    return Object.freeze({
      version: 'v155-phase6-1-stabilized-loader-control',
      flagKeys: FLAG_KEYS.slice(),
      status: function(){ return Object.assign({}, statusRef, { flag: readFlag() }); },
      disableRuntime: function(reason){
        try{ localStorage.setItem('freshket_loader_runtime_disabled','1'); }catch(e){}
        const restored = restoreLegacyNow();
        statusRef.mode = 'legacy';
        statusRef.disabledByFlag = true;
        statusRef.disabledReason = reason || 'manual-disable';
        statusRef.restored = restored;
        try{ console.warn('[Freshket Sense Phase 6.1] Loader runtime disabled. Refresh recommended.', statusRef); }catch(e){}
        return statusRef;
      },
      enableRuntimeNextReload: function(){
        try{ FLAG_KEYS.forEach(function(k){ localStorage.removeItem(k); }); }catch(e){}
        statusRef.enableRuntimeOnNextReload = true;
        try{ console.info('[Freshket Sense Phase 6.1] Loader runtime will be enabled after refresh.'); }catch(e){}
        return statusRef;
      },
      restoreLegacyNow: restoreLegacyNow,
      refreshRecommended: true,
    });
  }
  const adapterStatus = {
    version: data && data.loaderOrchestrationVersion || 'missing-runtime',
    installedAt: Date.now(),
    mode: 'runtime',
    adapted: [],
    disabledByFlag: false,
    disabledReason: null,
    fallbackCount: 0,
    lastFallback: null,
  };
  global.FreshketSenseLoaderControl = makeControl(adapterStatus);

  if(!data || !data.loaderOrchestrationVersion){
    adapterStatus.mode = 'legacy';
    adapterStatus.disabledReason = 'runtime-missing';
    global.FreshketSensePhase6LoaderAdapter = Object.freeze(adapterStatus);
    try{ console.warn('[Freshket Sense Phase 6.1] loader orchestration runtime missing; keeping Phase 5.1 functions'); }catch(e){}
    return;
  }
  const flag = readFlag();
  if(flag.disabled){
    adapterStatus.mode = 'legacy';
    adapterStatus.disabledByFlag = true;
    adapterStatus.disabledReason = flag.source;
    adapterStatus.restored = restoreLegacyNow();
    global.FreshketSensePhase6LoaderAdapter = Object.freeze(adapterStatus);
    try{ console.warn('[Freshket Sense Phase 6.1] loader runtime disabled by flag; keeping legacy loader path.', adapterStatus); }catch(e){}
    return;
  }
  function asyncAdapter(name, runtimeFn){
    const original = fallback(name);
    const fn = async function(){
      try{ return await runtimeFn.apply(this, Array.prototype.slice.call(arguments)); }
      catch(err){
        adapterStatus.fallbackCount += 1;
        adapterStatus.lastFallback = { name:name, message:err && err.message ? err.message : String(err), ts:Date.now() };
        try{ console.warn('[Freshket Sense Phase 6.1 fallback]', name, err && err.message ? err.message : err); }catch(e){}
        if(typeof original === 'function') return original.apply(this, Array.prototype.slice.call(arguments));
        throw err;
      }
    };
    setGlobal(name, fn);
  }
  function syncAdapter(name, runtimeFn){
    const original = fallback(name);
    const fn = function(){
      try{ return runtimeFn.apply(this, Array.prototype.slice.call(arguments)); }
      catch(err){
        adapterStatus.fallbackCount += 1;
        adapterStatus.lastFallback = { name:name, message:err && err.message ? err.message : String(err), ts:Date.now() };
        try{ console.warn('[Freshket Sense Phase 6.1 fallback]', name, err && err.message ? err.message : err); }catch(e){}
        if(typeof original === 'function') return original.apply(this, Array.prototype.slice.call(arguments));
        throw err;
      }
    };
    setGlobal(name, fn);
  }

  asyncAdapter('_fetchCloudflareFile', data.fetchCloudflareFile);
  asyncAdapter('ensureCloudflareFiles', data.ensureCloudflareFiles);
  syncAdapter('_startCloudBackgroundLoad', data.startCloudBackgroundLoad);
  asyncAdapter('loadFromCloudflareR2', data.loadFromCloudflareR2);
  asyncAdapter('reloadFromCloudflareR2', data.reloadFromCloudflareR2);
  asyncAdapter('loadFromGoogleSheets', data.loadFromGoogleSheets);
  asyncAdapter('reloadFromGoogleSheets', data.reloadFromGoogleSheets);
  asyncAdapter('ensureAccountDetailData', data.ensureAccountDetailData);
  asyncAdapter('ensureSenseData', data.ensureSenseData);
  asyncAdapter('loadFromSupabaseStorage', data.loadFromSupabaseStorage);

  adapterStatus.adapted = ADAPTED_NAMES.slice();
  global.FreshketSensePhase6LoaderAdapter = Object.freeze(adapterStatus);
})(window);
