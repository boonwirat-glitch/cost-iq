// Freshket Sense auth/session runtime boundary — Phase 10.
// Classic-script compatible. This runtime intentionally wraps the existing legacy
// auth/session functions rather than changing behavior. It gives us diagnostics
// and a kill switch before deeper auth extraction.
(function(global){
  'use strict';

  const STORAGE_KEY = 'freshket_auth_runtime_disabled';
  const VERSION = 'phase10-auth-session-boundary';
  const LEGACY_FN_NAMES = [
    'resetRuntimeSessionState',
    '_showLoginOverlayClean',
    '_urlLooksLikePasswordRecovery',
    '_clearPasswordRecoveryUrl',
    'showPasswordResetForm',
    'showResetStatus',
    'showLoginInfo',
    'submitPasswordReset',
    'doLogin',
    'showLoginError',
    'showSenseSplash',
    'hideLoginOverlay',
    '_autoRouteAfterLogin',
    'loadUserProfile',
    'doSignOut',
    'activateLocalMode',
    '_setLocalPersona',
    'checkSession'
  ];

  const state = {
    wrappersInstalled: false,
    installedAt: null,
    lastOperation: null,
    lastOperationAt: null,
    fallbackCount: 0,
    wrappedFunctions: [],
    missingFunctions: [],
    lastError: null
  };

  const legacy = {};

  function now(){ return new Date().toISOString(); }

  function isDisabled(){
    try { return global.localStorage && localStorage.getItem(STORAGE_KEY) === '1'; }
    catch(e){ return false; }
  }

  function setLastOperation(name){
    state.lastOperation = name;
    state.lastOperationAt = now();
  }

  function captureLegacy(){
    LEGACY_FN_NAMES.forEach(function(name){
      if (typeof global[name] === 'function') legacy[name] = global[name];
      else state.missingFunctions.push(name);
    });
  }

  function callLegacy(name, thisArg, args){
    const fn = legacy[name];
    if (typeof fn !== 'function') {
      const err = new Error('Missing legacy auth function: ' + name);
      state.lastError = { name:name, message:err.message, at:now() };
      throw err;
    }
    setLastOperation(name);
    try {
      return fn.apply(thisArg || global, args || []);
    } catch (error) {
      state.lastError = { name:name, message:error && error.message || String(error), at:now() };
      state.fallbackCount += 1;
      throw error;
    }
  }

  function wrap(name){
    if (typeof legacy[name] !== 'function') return;
    global[name] = function(){
      if (isDisabled()) return legacy[name].apply(this, arguments);
      return callLegacy(name, this, Array.prototype.slice.call(arguments));
    };
    state.wrappedFunctions.push(name);
  }

  function installAdapters(){
    if (state.wrappersInstalled) return status();
    captureLegacy();
    LEGACY_FN_NAMES.forEach(wrap);
    state.wrappersInstalled = true;
    state.installedAt = now();
    return status();
  }

  function disableRuntime(reason){
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch(e) {}
    state.lastOperation = 'disableRuntime';
    state.lastOperationAt = now();
    if (reason) state.lastDisableReason = String(reason);
    return status();
  }

  function enableRuntimeNextReload(){
    try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
    state.lastOperation = 'enableRuntimeNextReload';
    state.lastOperationAt = now();
    return status();
  }

  function currentAuthState(){
    return {
      currentUserEmail: global.currentUser && global.currentUser.email || null,
      currentUserId: global.currentUser && global.currentUser.id || null,
      profileRole: global.currentUserProfile && global.currentUserProfile.role || null,
      profileEmail: global.currentUserProfile && global.currentUserProfile.email || null,
      loginTransitionRunning: !!global.loginTransitionRunning,
      passwordRecoveryMode: !!global.passwordRecoveryMode,
      loginOverlayVisible: !!(global.document && document.getElementById('login-overlay') && document.getElementById('login-overlay').style.display !== 'none'),
      splashVisible: !!(global.document && document.getElementById('sense-splash') && document.getElementById('sense-splash').style.display !== 'none')
    };
  }

  function status(){
    return {
      version: VERSION,
      disabled: isDisabled(),
      storageKey: STORAGE_KEY,
      wrappersInstalled: state.wrappersInstalled,
      wrappedFunctions: state.wrappedFunctions.slice(),
      missingFunctions: state.missingFunctions.slice(),
      installedAt: state.installedAt,
      lastOperation: state.lastOperation,
      lastOperationAt: state.lastOperationAt,
      fallbackCount: state.fallbackCount,
      lastError: state.lastError,
      authState: currentAuthState()
    };
  }

  function printDiagnostics(){
    const s = status();
    try {
      console.log('Freshket auth/session diagnostics:', s);
      console.table(s.wrappedFunctions.map(function(name){ return { wrapped:name }; }));
    } catch(e) {}
    return s;
  }

  const api = Object.freeze({
    version: VERSION,
    installAdapters: installAdapters,
    status: status,
    printDiagnostics: printDiagnostics,
    disableRuntime: disableRuntime,
    enableRuntimeNextReload: enableRuntimeNextReload,
    legacy: legacy,
    callLegacy: function(name){ return callLegacy(name, global, Array.prototype.slice.call(arguments, 1)); }
  });

  global.FreshketSenseAuthRuntime = api;
  global.FreshketSenseAuthControl = Object.freeze({
    status: status,
    printDiagnostics: printDiagnostics,
    disableRuntime: disableRuntime,
    enableRuntimeNextReload: enableRuntimeNextReload
  });

  installAdapters();
})(window);
