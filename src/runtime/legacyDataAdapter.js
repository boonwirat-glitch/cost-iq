// ── PHASE 5 LEGACY DATA ADAPTERS ─────────────────────
// Keep the original data-loading globals alive while routing them through
// FreshketSenseRuntime.data for instrumentation and helper extraction.
(function(global){
  'use strict';
  const dataRuntime = global.FreshketSenseRuntime && global.FreshketSenseRuntime.data;
  if(!dataRuntime){
    global.getFreshketDataRuntimeSnapshot = function(){ return { ok:false, error:'data runtime unavailable', ts:Date.now() }; };
    try{ console.warn('[Freshket Sense] data runtime unavailable; legacy data functions are running without instrumentation'); }catch(e){}
    return;
  }

  const legacy = {};
  const asyncNames = [
    'ensureCloudflareFiles',
    'loadFromCloudflareR2',
    'reloadFromCloudflareR2',
    'loadFromGoogleSheets',
    'reloadFromGoogleSheets',
    'ensureAccountDetailData',
    'ensureSenseData',
    'loadFromSupabaseStorage',
    '_csvCacheClear',
    '_fetchCloudflareFile'
  ];
  const syncNames = [
    '_resetDataPill',
    '_setDataPillText',
    '_finishDataPill',
    '_markForegroundPillDot',
    '_prepareProgressChips',
    '_startCloudBackgroundLoad',
    'openDataPanel',
    'closeDataPanel',
    'updateDataStatus',
    'setDpMode'
  ];

  function getGlobal(name){
    try { return global[name]; } catch(e) { return undefined; }
  }
  function setGlobal(name, fn){
    try { global[name] = fn; } catch(e) { /* ignore non-writable */ }
  }

  asyncNames.forEach(function(name){
    const original = getGlobal(name);
    if(typeof original !== 'function') return;
    legacy[name] = original;
    const wrapped = function(){
      return dataRuntime.wrapAsync(name, original, Array.prototype.slice.call(arguments), this);
    };
    setGlobal(name, wrapped);
    try { eval(name + ' = wrapped'); } catch(e) { /* global binding may not be writable in some contexts */ }
  });

  syncNames.forEach(function(name){
    const original = getGlobal(name);
    if(typeof original !== 'function') return;
    legacy[name] = original;
    const wrapped = function(){
      const args = Array.prototype.slice.call(arguments);
      if(name === '_setDataPillText') dataRuntime.onPillText(args[0], args[1]);
      if(name === '_resetDataPill') dataRuntime.onPillReset();
      if(name === '_finishDataPill') dataRuntime.onPillFinish(args[0]);
      if(name === 'openDataPanel') dataRuntime.onPanelOpen();
      if(name === 'closeDataPanel') dataRuntime.onPanelClose();
      return dataRuntime.wrapSync(name, original, args, this);
    };
    setGlobal(name, wrapped);
    try { eval(name + ' = wrapped'); } catch(e) { /* global binding may not be writable in some contexts */ }
  });

  global.FreshketSenseLegacyData = Object.freeze(legacy);
  global.getFreshketDataRuntimeSnapshot = function(){
    return dataRuntime.getSnapshot(function(){
      return {
        loadedTabs: (global._cloudLoadedTabs && typeof global._cloudLoadedTabs.size === 'number') ? Array.from(global._cloudLoadedTabs) : undefined,
        bulkSkusReady: typeof global.bulkSkusReady === 'boolean' ? global.bulkSkusReady : undefined,
        bulkAltsReady: typeof global.bulkAltsReady === 'boolean' ? global.bulkAltsReady : undefined,
        sheetsLoadStarted: typeof global.sheetsLoadStarted === 'boolean' ? global.sheetsLoadStarted : undefined,
      };
    });
  };
})(window);
// ─────────────────────────────────────────────────────
