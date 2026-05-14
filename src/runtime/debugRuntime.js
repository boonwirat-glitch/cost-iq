// Freshket Sense debug and staging smoke-check utilities — Phase 11.
(function(global){
  'use strict';

  function hasFn(name){ return typeof global[name] === 'function'; }
  function hasEl(id){ return !!global.document && !!document.getElementById(id); }
  function getDataSnapshot(){
    return hasFn('getFreshketDataRuntimeSnapshot') ? global.getFreshketDataRuntimeSnapshot() : { ok:false, error:'getFreshketDataRuntimeSnapshot missing' };
  }

  function configDiagnostics(){
    const cfg = global.FreshketSenseConfig || {};
    const app = cfg.app || {};
    const ai = cfg.ai || {};
    const data = cfg.data || {};
    const storage = cfg.storage || {};
    const assets = cfg.assets || {};
    const supabase = cfg.supabase || {};
    return {
      exists: !!global.FreshketSenseConfig,
      frozen: !!global.FreshketSenseConfig && Object.isFrozen(global.FreshketSenseConfig),
      appVersion: app.version || null,
      workingBaseline: app.workingBaseline || null,
      serviceWorkerUrl: app.serviceWorkerUrl || null,
      proxyOnlyProduction: ai.proxyOnlyProduction === true,
      proxyStorageKey: ai.proxyStorageKey || null,
      providerStorageKey: ai.providerStorageKey || null,
      supabaseUrlPresent: !!supabase.url,
      supabaseKeyType: supabase.publishableKey && supabase.publishableKey.indexOf('sb_publishable_') === 0 ? 'publishable' : (supabase.publishableKey ? 'unknown-present' : 'missing'),
      r2BasePresent: !!data.r2Base,
      foregroundKeys: Array.isArray(data.foregroundKeys) ? data.foregroundKeys.slice() : [],
      backgroundKeys: Array.isArray(data.backgroundKeys) ? data.backgroundKeys.slice() : [],
      csvDbName: storage.csvDbName || null,
      chatFabPositionKey: storage.chatFabPositionKey || null,
      iconUrlPresent: !!assets.iconUrl,
      oliveAvatarUrlPresent: !!assets.oliveAvatarUrl,
      ts: new Date().toISOString()
    };
  }

  function printConfigDiagnostics(){
    const diag = configDiagnostics();
    try{ console.log('Freshket config diagnostics:', diag); }catch(e){}
    return diag;
  }

  function authDiagnostics(){
    const auth = global.FreshketSenseAuthRuntime || null;
    const control = global.FreshketSenseAuthControl || null;
    return {
      exists: !!auth,
      version: auth && auth.version || null,
      controlExists: !!control,
      status: control && control.status ? control.status() : (auth && auth.status ? auth.status() : null),
      legacyAuthFns: ['doLogin','checkSession','hideLoginOverlay','showSenseSplash','doSignOut','loadUserProfile'].reduce(function(acc,name){ acc[name] = typeof global[name] === 'function'; return acc; }, {}),
      ts: new Date().toISOString()
    };
  }

  function printAuthDiagnostics(){
    const diag = authDiagnostics();
    try{ console.log('Freshket auth/session diagnostics:', diag); }catch(e){}
    return diag;
  }

  function loaderDiagnostics(){
    const rt = global.FreshketSenseRuntime || {};
    const data = rt.data || global.FreshketSenseDataRuntime || null;
    const adapter = global.FreshketSensePhase6LoaderAdapter || null;
    const control = global.FreshketSenseLoaderControl || null;
    return {
      runtimeVersion: rt.version || null,
      dataRuntimeVersion: data && data.version || null,
      loaderOrchestrationVersion: data && data.loaderOrchestrationVersion || null,
      adapter: adapter,
      control: control && control.status ? control.status() : null,
      orchestration: data && data.getOrchestrationSnapshot ? data.getOrchestrationSnapshot() : null,
      legacyAvailable: !!global.FreshketSenseLegacyData,
      loaderFns: ['_fetchCloudflareFile','ensureCloudflareFiles','_startCloudBackgroundLoad','loadFromCloudflareR2','reloadFromCloudflareR2','ensureAccountDetailData','ensureSenseData'].reduce(function(acc,name){ acc[name] = typeof global[name] === 'function'; return acc; }, {}),
      ts: new Date().toISOString()
    };
  }

  function printLoaderDiagnostics(){
    const diag = loaderDiagnostics();
    try{ console.log('Freshket loader diagnostics:', diag); }catch(e){}
    return diag;
  }

  function runStaticSmokeChecklist(){
    const rt = global.FreshketSenseRuntime || {};
    const aiClient = rt.aiClient || {};
    const data = rt.data || global.FreshketSenseDataRuntime || null;
    const checks = [
      ['runtime object exists', !!rt.version, rt.version || 'missing'],
      ['config object exists', !!global.FreshketSenseConfig, global.FreshketSenseConfig ? (global.FreshketSenseConfig.app && global.FreshketSenseConfig.app.version) : 'missing'],
      ['config version phase11', (global.FreshketSenseConfig && global.FreshketSenseConfig.app && global.FreshketSenseConfig.app.version) === 'v155-phase11-state-storage-boundary', global.FreshketSenseConfig && global.FreshketSenseConfig.app && global.FreshketSenseConfig.app.version],
      ['AI runtime exists', !!aiClient.callAI, aiClient.callAI ? 'ok' : 'missing callAI'],
      ['production is proxy-only', aiClient.proxyOnlyProduction === true, aiClient.proxyOnlyProduction],
      ['direct browser key mode disabled', hasFn('directAiKeyModeAllowed') ? global.directAiKeyModeAllowed() === false : aiClient.directAiKeyModeAllowed && aiClient.directAiKeyModeAllowed() === false, 'expected false'],
      ['data runtime exists', !!data, data ? data.version : 'missing'],
      ['loader control exists', !!global.FreshketSenseLoaderControl, global.FreshketSenseLoaderControl ? 'ok' : 'missing'],
      ['auth runtime exists', !!global.FreshketSenseAuthRuntime, global.FreshketSenseAuthRuntime ? global.FreshketSenseAuthRuntime.version : 'missing'],
      ['auth control exists', !!global.FreshketSenseAuthControl, global.FreshketSenseAuthControl ? 'ok' : 'missing'],
      ['auth checkSession exists', hasFn('checkSession'), 'checkSession'],
      ['auth doLogin exists', hasFn('doLogin'), 'doLogin'],
      ['data snapshot exists', hasFn('getFreshketDataRuntimeSnapshot'), hasFn('getFreshketDataRuntimeSnapshot') ? 'ok' : 'missing'],
      ['login overlay exists', hasEl('login-overlay'), 'login-overlay'],
      ['splash exists', hasEl('sense-splash'), 'sense-splash'],
      ['topbar exists', hasEl('dataBtnTop'), 'dataBtnTop'],
      ['data panel exists', hasEl('dataPanel'), 'dataPanel'],
      ['data pill exists', hasEl('data-load-pill'), 'data-load-pill'],
      ['AI FAB exists', hasEl('aiFab'), 'aiFab'],
      ['AI panel exists', hasEl('aiPanel'), 'aiPanel'],
      ['service worker supported', !!(global.navigator && navigator.serviceWorker), 'navigator.serviceWorker'],
      ['legacy load function exists', hasFn('loadFromCloudflareR2'), 'loadFromCloudflareR2'],
      ['legacy ensure function exists', hasFn('ensureCloudflareFiles'), 'ensureCloudflareFiles']
    ].map(function(row){ return { name:row[0], ok:!!row[1], detail:row[2] }; });
    return {
      ok: checks.every(function(c){ return c.ok || c.name === 'AI proxy configured'; }),
      note: 'Phase 10 adds auth/session adapter diagnostics. Browser smoke test remains required for login/relogin/splash.',
      runtimeVersion: rt.version || null,
      dataRuntimeVersion: data && data.version || null,
      auth: authDiagnostics(),
      proxyUrl: aiClient.getAiProxyUrl ? aiClient.getAiProxyUrl() : '',
      checks: checks,
      dataSnapshot: getDataSnapshot(),
      ts: new Date().toISOString()
    };
  }

  function printStaticSmokeChecklist(){
    const result = runStaticSmokeChecklist();
    const rows = result.checks.map(function(c){ return { ok:c.ok ? '✅' : '❌', check:c.name, detail:String(c.detail || '') }; });
    try{ console.table(rows); console.log('Freshket static smoke result:', result); }catch(e){}
    return result;
  }

  function snapshot(){
    const rt = global.FreshketSenseRuntime || {};
    return {
      runtimeVersion: rt.version || null,
      proxyOnlyProduction: !!(rt.aiClient && rt.aiClient.proxyOnlyProduction),
      proxyUrl: rt.aiClient && rt.aiClient.getAiProxyUrl ? rt.aiClient.getAiProxyUrl() : '',
      aiProvider: global.aiProvider,
      currentUserEmail: global.currentUser && global.currentUser.email || null,
      currentMode: global.mode || null,
      currentAccountId: global.currentAccountId || null,
      loader: loaderDiagnostics(),
      auth: authDiagnostics(),
      data: getDataSnapshot(),
      smoke: runStaticSmokeChecklist(),
      config: configDiagnostics(),
      ts: new Date().toISOString()
    };
  }

  global.FreshketSenseDebug = Object.freeze({ snapshot, runStaticSmokeChecklist, printStaticSmokeChecklist, loaderDiagnostics, printLoaderDiagnostics, configDiagnostics, printConfigDiagnostics, authDiagnostics, printAuthDiagnostics, stateDiagnostics, printStateDiagnostics });
  global.printFreshketLoaderDiagnostics = printLoaderDiagnostics;
  global.printFreshketAuthDiagnostics = printAuthDiagnostics;
  global.printFreshketStateDiagnostics = printStateDiagnostics;
  global.runFreshketStaticSmokeChecklist = runStaticSmokeChecklist;
})(window);
