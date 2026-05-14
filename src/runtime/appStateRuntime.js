// Freshket Sense app state/storage runtime boundary — Phase 11.1.
// Classic-script compatible. Diagnostic-first: it does not rewrite legacy state
// or storage behavior. It creates a safe boundary before deeper view extraction.
(function(global){
  'use strict';

  const CFG = global.FreshketSenseConfig || {};
  const STORAGE_CFG = CFG.storage || {};
  const STORAGE_KEY = STORAGE_CFG.stateRuntimeDisabledKey || 'freshket_state_runtime_disabled';
  const VERSION = 'phase11-1-state-storage-stabilization';

  const knownStorageKeys = Object.freeze({
    aiProxy: (CFG.ai && CFG.ai.proxyStorageKey) || 'freshket_ai_proxy_url',
    aiProvider: (CFG.ai && CFG.ai.providerStorageKey) || 'ai_provider',
    chatFabPosition: STORAGE_CFG.chatFabPositionKey || 'fs_aifab_pos_v1',
    loaderRuntimeDisabled: STORAGE_CFG.loaderRuntimeDisabledKey || 'freshket_loader_runtime_disabled',
    authRuntimeDisabled: STORAGE_CFG.authRuntimeDisabledKey || 'freshket_auth_runtime_disabled',
    stateRuntimeDisabled: STORAGE_KEY,
    accountIndex: STORAGE_CFG.accountIndexKey || 'ciq_index',
    localAccountPrefix: STORAGE_CFG.localAccountPrefix || 'ciq_acct_',
    visited: STORAGE_CFG.visitedKey || 'ciq_visited',
    restaurantSwipeLearned: STORAGE_CFG.restaurantSwipeLearnedKey || 'ciq_rest_swipe_learned'
  });

  const state = {
    installedAt: new Date().toISOString(),
    lastOperation: null,
    lastOperationAt: null,
    lastError: null,
    readCount: 0,
    writeCount: 0,
    removeCount: 0
  };

  function now(){ return new Date().toISOString(); }
  function mark(op){ state.lastOperation = op; state.lastOperationAt = now(); }
  function isDisabled(){
    try { return !!global.localStorage && localStorage.getItem(STORAGE_KEY) === '1'; }
    catch(e){ return false; }
  }
  function safeStringify(value){ try { return JSON.stringify(value); } catch(e){ return null; } }
  function getRaw(key){
    mark('storage.getRaw:' + key); state.readCount += 1;
    try { return global.localStorage ? localStorage.getItem(key) : null; }
    catch(error){ state.lastError = { op:'getRaw', key, message:error.message || String(error), at:now() }; return null; }
  }
  function setRaw(key, value){
    mark('storage.setRaw:' + key); state.writeCount += 1;
    try { if(global.localStorage) localStorage.setItem(key, String(value)); return true; }
    catch(error){ state.lastError = { op:'setRaw', key, message:error.message || String(error), at:now() }; return false; }
  }
  function getJSON(key, fallback){
    const raw = getRaw(key);
    if(raw == null || raw === '') return fallback;
    try { return JSON.parse(raw); }
    catch(error){ state.lastError = { op:'getJSON', key, message:error.message || String(error), at:now() }; return fallback; }
  }
  function setJSON(key, value){
    const raw = safeStringify(value);
    if(raw == null){ state.lastError = { op:'setJSON', key, message:'JSON stringify failed', at:now() }; return false; }
    return setRaw(key, raw);
  }
  function remove(key){
    mark('storage.remove:' + key); state.removeCount += 1;
    try { if(global.localStorage) localStorage.removeItem(key); return true; }
    catch(error){ state.lastError = { op:'remove', key, message:error.message || String(error), at:now() }; return false; }
  }
  function localStorageKeys(){
    try {
      if(!global.localStorage) return [];
      const keys = [];
      for(let i=0; i<localStorage.length; i++) keys.push(localStorage.key(i));
      return keys.filter(Boolean).sort();
    } catch(error){
      state.lastError = { op:'localStorageKeys', message:error.message || String(error), at:now() };
      return [];
    }
  }
  function byteLen(value){ return value == null ? 0 : String(value).length; }
  function count(value){
    if(Array.isArray(value)) return value.length;
    if(value && typeof value === 'object') return Object.keys(value).length;
    return value == null ? 0 : 1;
  }
  function storageSnapshot(){
    const keys = localStorageKeys();
    const accountPrefix = knownStorageKeys.localAccountPrefix;
    const accountKeys = keys.filter(k => k.indexOf(accountPrefix) === 0);
    const known = {};
    Object.keys(knownStorageKeys).forEach(name => {
      const key = knownStorageKeys[name];
      if(name === 'localAccountPrefix') return;
      const raw = getRaw(key);
      known[name] = { key, exists: raw != null, bytes: byteLen(raw) };
    });
    return {
      available: !!global.localStorage,
      totalKeys: keys.length,
      accountStorageKeys: accountKeys.length,
      knownKeys,
      known,
      accountIndexCount: count(getJSON(knownStorageKeys.accountIndex, [])),
      currentAccountStorageExists: !!(global.currentAccountId && getRaw(accountPrefix + global.currentAccountId)),
      ts: now()
    };
  }
  function appStateSnapshot(){
    const D = global.D || {};
    const fileStatus = global.fileStatus || {};
    const sel = global.sel;
    const OPPS = global.OPPS;
    const pv = global.portviewBulkData;
    const currentAccountId = global.currentAccountId || (D.meta && D.meta.accountId) || null;
    let activeScreen = null;
    try { activeScreen = typeof global.getActiveScreenName === 'function' ? global.getActiveScreenName() : null; } catch(e) {}
    return {
      mode: global.mode || null,
      isKAM: !!global.isKAM,
      activeScreen,
      currentAccountId,
      accountName: D.meta && D.meta.accountName || null,
      kamName: D.meta && D.meta.kamName || null,
      currentUserEmail: global.currentUser && global.currentUser.email || null,
      profileRole: global.currentUserProfile && global.currentUserProfile.role || null,
      currentPlanMode: global.currentPlanMode || null,
      chatOpen: !!global.chatOpen,
      aiProvider: global.aiProvider || null,
      D: {
        history: count(D.history), cats: count(D.cats), cats_monthly: count(D.cats_monthly),
        skus: count(D.skus), skus_monthly: count(D.skus_monthly), alts: count(D.alts),
        outlets_monthly: count(D.outlets_monthly), sku_current: count(D.sku_current), current_month_loaded: !!D.current_month
      },
      selection: {
        selectedOpps: sel && typeof sel.size === 'number' ? sel.size : count(sel),
        selectedAltCount: count(global.selAlt)
      },
      opportunities: count(OPPS),
      fileStatus: Object.assign({}, fileStatus),
      bulk: {
        portviewRows: count(pv), historyAccounts: count(global.bulkHistoryData), categoryAccounts: count(global.bulkCategoriesData),
        skuAccounts: count(global.bulkSkusData), alternativesAccounts: count(global.bulkAltsData || global.bulkAltsUnverified),
        outletAccounts: count(global.bulkOutletsData), currentMonthAccounts: count(global.bulkCurrentMonthData)
      },
      runtimeFlags: {
        authDisabled: getRaw(knownStorageKeys.authRuntimeDisabled) === '1',
        loaderDisabled: getRaw(knownStorageKeys.loaderRuntimeDisabled) === '1',
        stateDisabled: isDisabled()
      },
      ts: now()
    };
  }
  function status(){
    return {
      version: VERSION,
      disabled: isDisabled(),
      storageKey: STORAGE_KEY,
      installedAt: state.installedAt,
      lastOperation: state.lastOperation,
      lastOperationAt: state.lastOperationAt,
      lastError: state.lastError,
      readCount: state.readCount,
      writeCount: state.writeCount,
      removeCount: state.removeCount,
      knownStorageKeys
    };
  }

  function validateRuntime(){
    const errors = [];
    const methodNames = ['getRaw','setRaw','getJSON','setJSON','remove','localStorageKeys','snapshot'];
    const storageMethods = {};
    methodNames.forEach(function(name){ storageMethods[name] = !!(api && api.storage && typeof api.storage[name] === 'function'); });
    let appStateOk = false;
    let storageOk = false;
    try { const a = appStateSnapshot(); appStateOk = !!(a && a.ts); } catch(error){ errors.push({ area:'appStateSnapshot', message:error.message || String(error) }); }
    try { const s = storageSnapshot(); storageOk = !!(s && typeof s.totalKeys === 'number'); } catch(error){ errors.push({ area:'storageSnapshot', message:error.message || String(error) }); }
    const knownKeysOk = !!(knownStorageKeys.aiProxy && knownStorageKeys.stateRuntimeDisabled && knownStorageKeys.accountIndex);
    const methodsOk = Object.keys(storageMethods).every(function(name){ return storageMethods[name]; });
    return {
      ok: methodsOk && appStateOk && storageOk && knownKeysOk && !errors.length,
      version: VERSION,
      disabled: isDisabled(),
      storageAvailable: !!global.localStorage,
      methods: storageMethods,
      snapshots: { appState: appStateOk, storage: storageOk },
      knownKeysOk: knownKeysOk,
      readOnly: true,
      note: 'Phase 11.1 validation reads snapshots only. It does not rewrite app state or storage behavior.',
      errors: errors,
      ts: now()
    };
  }

  function printDiagnostics(){
    const diag = { status: status(), validation: validateRuntime(), appState: appStateSnapshot(), storage: storageSnapshot() };
    try { console.log('Freshket state/storage diagnostics:', diag); } catch(e) {}
    return diag;
  }
  function disableRuntime(reason){
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch(e) {}
    mark('disableRuntime');
    if(reason) state.lastDisableReason = String(reason);
    return status();
  }
  function enableRuntimeNextReload(){
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
    mark('enableRuntimeNextReload');
    return status();
  }

  const api = Object.freeze({
    version: VERSION,
    status,
    printDiagnostics,
    disableRuntime,
    enableRuntimeNextReload,
    getAppStateSnapshot: appStateSnapshot,
    getStorageSnapshot: storageSnapshot,
    validate: validateRuntime,
    knownStorageKeys,
    storage: Object.freeze({ getRaw, setRaw, getJSON, setJSON, remove, localStorageKeys, snapshot: storageSnapshot })
  });

  const previousRuntime = global.FreshketSenseRuntime || {};
  global.FreshketSenseRuntime = Object.freeze(Object.assign({}, previousRuntime, { state: api }));
  global.FreshketSenseStateRuntime = api;
  global.FreshketSenseStateControl = Object.freeze({ status, printDiagnostics, disableRuntime, enableRuntimeNextReload, snapshot: appStateSnapshot, storageSnapshot, validate: validateRuntime });
  global.getFreshketStateRuntimeSnapshot = appStateSnapshot;
  global.getFreshketStateRuntimeDiagnostics = printDiagnostics;
})(window);
