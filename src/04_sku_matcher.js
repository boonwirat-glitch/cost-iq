// SECTION:AI_CLIENT
function oliveToneClean(t){ return window.FreshketSenseRuntime.ai && window.FreshketSenseRuntime.ai.oliveToneClean ? window.FreshketSenseRuntime.ai.oliveToneClean(t) : String(t||'').trim(); }
function getAiProxyUrl(){ return window.FreshketSenseRuntime.aiClient && window.FreshketSenseRuntime.aiClient.getAiProxyUrl ? window.FreshketSenseRuntime.aiClient.getAiProxyUrl() : ''; }
function setAiProxyUrl(url){ return window.FreshketSenseRuntime.aiClient && window.FreshketSenseRuntime.aiClient.setAiProxyUrl ? window.FreshketSenseRuntime.aiClient.setAiProxyUrl(url) : undefined; }
function directAiKeyModeAllowed(){ return window.FreshketSenseRuntime.aiClient && window.FreshketSenseRuntime.aiClient.directAiKeyModeAllowed ? window.FreshketSenseRuntime.aiClient.directAiKeyModeAllowed() : false; }
async function callAI(modelKey,sys,messages,maxTok){
  if(!window.FreshketSenseRuntime.aiClient || !window.FreshketSenseRuntime.aiClient.callAI) throw new Error('AI runtime unavailable');
  return window.FreshketSenseRuntime.aiClient.callAI({
    modelKey, sys, messages, maxTok,
    provider: aiProvider,
    geminiApiKey,
    claudeApiKey: CLAUDE_API_KEY
  });
}
function setAiProvider(p){
  if(!window.FreshketSenseRuntime.aiClient || !window.FreshketSenseRuntime.aiClient.setAiProvider){ aiProvider=p; localStorage.setItem((FRESHKET_APP_CONFIG.ai&&FRESHKET_APP_CONFIG.ai.providerStorageKey)||'ai_provider',p); return; }
  return window.FreshketSenseRuntime.aiClient.setAiProvider(p, {
    setProvider: (nextProvider)=>{ aiProvider=nextProvider; }
  });
}
// ─────────────────────────────────────────────────────


// ── PHASE 5 DATA RUNTIME BOUNDARY ───────────────────
// Phase 5 data runtime boundary for Freshket Sense.
// This phase moves low-risk loader helpers into runtime-owned implementations:
// IndexedDB CSV cache, fetch-with-timeout, and data-pill DOM helpers.
// The orchestration flow still remains legacy-compatible to avoid regressions.
(function(global){
  'use strict';

  const runtime = global.FreshketSenseRuntime || {};
  if(!global.FreshketSenseRuntime) global.FreshketSenseRuntime = runtime;

  const DATA_RUNTIME_VERSION = 'v155-phase9-config-extraction';
  const CFG = global.FreshketSenseConfig || {};
  const DATA_CFG = CFG.data || {};
  const STORAGE_CFG = CFG.storage || {};
  const FOREGROUND_KEYS = (DATA_CFG.foregroundKeys || ['portview','history','categories','sku_current','outlets']).slice();
  const BACKGROUND_KEYS = (DATA_CFG.backgroundKeys || ['skus','alternatives']).slice();
  const ALL_KEYS = FOREGROUND_KEYS.concat(BACKGROUND_KEYS);

  const CSV_DB = STORAGE_CFG.csvDbName || 'ciq-csv-v1';
  const CSV_TTL = STORAGE_CFG.csvCacheTtlMs || 6 * 60 * 60 * 1000; // 6 hours
  const R2_BASE = DATA_CFG.r2Base || 'https://pub-12078d17646340808024e8cc95504995.r2.dev';
  const R2_FILES = DATA_CFG.r2Files || Object.freeze({
    portview:'portview.csv',
    history:'bulk_history.csv',
    categories:'bulk_categories.csv',
    sku_current:'bulk_sku_current.csv',
    outlets:'bulk_outlets.csv',
    skus:'bulk_skus.csv',
    alternatives:'bulk_alternatives.csv'
  });
  const R2_SPECS = DATA_CFG.r2Specs || Object.freeze({
    portview:{type:'portview-bulk',tab:'portview',cache:true},
    history:{type:'bulk-data',tab:'history',cache:true},
    categories:{type:'bulk-categories',tab:'categories',cache:true},
    sku_current:{type:'bulk-sku-current',tab:'sku_current',cache:true},
    outlets:{type:'bulk-outlets',tab:'outlets',cache:true},
    skus:{type:'bulk-skus',tab:'skus',cache:false,heavy:true},
    alternatives:{type:'bulk-alternatives',tab:'alternatives',cache:false,heavy:true},
  });

  const status = {
    version: DATA_RUNTIME_VERSION,
    bootedAt: Date.now(),
    lastOperation: null,
    lastError: null,
    operations: [],
    pill: { visible:false, text:'', count:'', lastFinishedAt:null },
    panel: { open:false, lastOpenedAt:null },
    cache: { db: CSV_DB, ttlMs: CSV_TTL, lastGet:null, lastSet:null, lastClear:null },
    fetch: { lastUrl:null, lastMs:null, lastStatus:null },
  };

  let dataPillTimers = [];

  function now(){ return Date.now(); }

  function safeCall(fn, args, ctx){
    if(typeof fn !== 'function') return undefined;
    return fn.apply(ctx || global, args || []);
  }

  function recordOperation(name, phase, extra){
    const evt = Object.assign({ name, phase, ts: now() }, extra || {});
    status.lastOperation = evt;
    status.operations.push(evt);
    if(status.operations.length > 80) status.operations.shift();
    return evt;
  }

  async function wrapAsync(name, original, args, ctx){
    const start = now();
    recordOperation(name, 'start');
    try{
      const result = await safeCall(original, args, ctx);
      recordOperation(name, 'done', { ms: now() - start, ok: result !== false });
      return result;
    }catch(err){
      status.lastError = { name, message: err && err.message ? err.message : String(err), ts: now() };
      recordOperation(name, 'error', { ms: now() - start, message: status.lastError.message });
      throw err;
    }
  }

  function wrapSync(name, original, args, ctx){
    const start = now();
    recordOperation(name, 'start');
    try{
      const result = safeCall(original, args, ctx);
      recordOperation(name, 'done', { ms: now() - start, ok: result !== false });
      return result;
    }catch(err){
      status.lastError = { name, message: err && err.message ? err.message : String(err), ts: now() };
      recordOperation(name, 'error', { ms: now() - start, message: status.lastError.message });
      throw err;
    }
  }

  function onPillText(text, count){
    status.pill.visible = true;
    status.pill.text = text || '';
    status.pill.count = count || '';
  }

  function onPillReset(){
    status.pill.visible = false;
    status.pill.text = '';
    status.pill.count = '';
  }

  function onPillFinish(text){
    status.pill.text = text || status.pill.text || '';
    status.pill.count = '';
    status.pill.lastFinishedAt = now();
  }

  function onPanelOpen(){
    status.panel.open = true;
    status.panel.lastOpenedAt = now();
  }

  function onPanelClose(){
    status.panel.open = false;
  }

  function csvOpen(){
    return new Promise((res, rej)=>{
      try{
        const r = global.indexedDB.open(CSV_DB, 1);
        r.onupgradeneeded = e => e.target.result.createObjectStore('csv');
        r.onsuccess = e => res(e.target.result);
        r.onerror = () => rej(new Error('idb open failed'));
      }catch(e){ rej(e); }
    });
  }

  async function csvCacheGet(tab){
    const start = now();
    try{
      const db = await csvOpen();
      return new Promise(res=>{
        const g = db.transaction('csv','readonly').objectStore('csv').get(tab);
        g.onsuccess = () => {
          status.cache.lastGet = { tab, hit: !!g.result, ms: now() - start, ts: now() };
          res(g.result || null);
        };
        g.onerror = () => {
          status.cache.lastGet = { tab, hit:false, error:true, ms: now() - start, ts: now() };
          res(null);
        };
      });
    }catch(e){
      status.cache.lastGet = { tab, hit:false, error:true, message:e && e.message ? e.message : String(e), ms: now() - start, ts: now() };
      return null;
    }
  }

  async function csvCacheSet(tab, text, etag){
    const start = now();
    try{
      const db = await csvOpen();
      return new Promise(res=>{
        const tx = db.transaction('csv','readwrite');
        tx.objectStore('csv').put({ text, ts: now(), etag: etag || null }, tab);
        tx.oncomplete = () => {
          status.cache.lastSet = { tab, bytes: text ? text.length : 0, ok:true, ms: now() - start, ts: now() };
          res(true);
        };
        tx.onerror = () => {
          status.cache.lastSet = { tab, ok:false, error:true, ms: now() - start, ts: now() };
          res(false);
        };
      });
    }catch(e){
      status.cache.lastSet = { tab, ok:false, error:true, message:e && e.message ? e.message : String(e), ms: now() - start, ts: now() };
      return false;
    }
  }

  async function csvCacheClear(){
    const start = now();
    try{
      const db = await csvOpen();
      return new Promise(res=>{
        const tx = db.transaction('csv','readwrite');
        tx.objectStore('csv').clear();
        tx.oncomplete = () => {
          status.cache.lastClear = { ok:true, ms: now() - start, ts: now() };
          res(true);
        };
        tx.onerror = () => {
          status.cache.lastClear = { ok:false, error:true, ms: now() - start, ts: now() };
          res(false);
        };
      });
    }catch(e){
      status.cache.lastClear = { ok:false, error:true, message:e && e.message ? e.message : String(e), ms: now() - start, ts: now() };
      return false;
    }
  }

  async function fetchTextWithTimeout(url, timeoutMs){
    const start = now();
    const ctrl = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), timeoutMs);
    status.fetch.lastUrl = url;
    status.fetch.lastStatus = 'started';
    try{
      const resp = await fetch(url, { cache:'no-store', signal:ctrl.signal });
      status.fetch.lastStatus = resp.status;
      if(!resp.ok) throw new Error('HTTP ' + resp.status);
      const text = await resp.text();
      status.fetch.lastMs = now() - start;
      return text;
    }catch(err){
      status.fetch.lastMs = now() - start;
      status.fetch.lastStatus = err && err.name === 'AbortError' ? 'timeout' : 'error';
      throw err;
    }finally{
      clearTimeout(timer);
    }
  }

  // v205c: Conditional GET — uses If-None-Match for ETag-based cache validation
  // Returns {text, etag} on 200, or {text:null, etag:cachedEtag, notModified:true} on 304
  async function fetchWithEtag(url, cachedEtag, timeoutMs){
    const start = now();
    const ctrl = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), timeoutMs||90000);
    const headers = {};
    if(cachedEtag) headers['If-None-Match'] = cachedEtag;
    try{
      const resp = await fetch(url, { cache:'no-cache', signal:ctrl.signal, headers });
      if(resp.status===304){
        status.fetch.lastStatus = 304;
        status.fetch.lastMs = now()-start;
        return {text:null, etag:cachedEtag, notModified:true};
      }
      if(!resp.ok) throw new Error('HTTP '+resp.status);
      const etag = resp.headers.get('ETag');
      const text = await resp.text();
      status.fetch.lastStatus = resp.status;
      status.fetch.lastMs = now()-start;
      return {text, etag, notModified:false};
    }catch(err){
      status.fetch.lastMs = now()-start;
      status.fetch.lastStatus = err&&err.name==='AbortError'?'timeout':'error';
      throw err;
    }finally{
      clearTimeout(timer);
    }
  }

  function clearPillTimers(){
    dataPillTimers.forEach(t=>clearTimeout(t));
    dataPillTimers = [];
  }

  function resetDataPill(){
    clearPillTimers();
    const pill = document.getElementById('data-load-pill');
    const dots = document.getElementById('dlp-dots');
    const bgDots = document.getElementById('dlp-bg-dots');
    const icon = document.getElementById('dlp-ready-icon');
    const txt = document.getElementById('dlp-text');
    const cnt = document.getElementById('dlp-count');
    if(pill){ pill.style.display=''; pill.classList.remove('out','ready','visible'); void pill.offsetWidth; }
    if(dots){ dots.style.display='flex'; [...dots.children].forEach(d=>{ d.classList.remove('done'); d.style.background=''; }); }
    if(bgDots){ bgDots.style.display='none'; [...bgDots.children].forEach(d=>{ d.classList.remove('done'); d.style.background=''; }); }
    if(icon) icon.style.display = 'none';
    if(txt) txt.textContent = 'กำลังโหลด';
    if(cnt) cnt.textContent = '';
    onPillReset();
  }

  function setDataPillText(text, count){
    clearPillTimers();
    const pill = document.getElementById('data-load-pill');
    const txt = document.getElementById('dlp-text');
    const cnt = document.getElementById('dlp-count');
    if(pill){ pill.style.display=''; pill.classList.remove('out'); pill.classList.add('visible'); }
    if(txt) txt.textContent = text || 'กำลังโหลด';
    if(cnt) cnt.textContent = count || '';
    onPillText(text, count);
  }

  function finishDataPill(text, hideMs){
    if(hideMs === undefined) hideMs = 1200;
    clearPillTimers();
    const pill = document.getElementById('data-load-pill');
    const txt = document.getElementById('dlp-text');
    const icon = document.getElementById('dlp-ready-icon');
    const dots = document.getElementById('dlp-dots');
    const bgDots = document.getElementById('dlp-bg-dots');
    const cnt = document.getElementById('dlp-count');
    if(txt) txt.textContent = text || 'พร้อมใช้งาน';
    if(cnt) cnt.textContent = '';
    if(dots) dots.style.display = 'none';
    if(bgDots) bgDots.style.display = 'none';
    if(icon) icon.style.display = 'block';
    if(pill){
      pill.classList.add('ready');
      dataPillTimers.push(setTimeout(()=>pill.classList.add('out'), hideMs));
      dataPillTimers.push(setTimeout(()=>{ if(pill) pill.style.display = 'none'; }, hideMs + 700));
    }
    onPillFinish(text);
  }

  function markForegroundPillDot(idx){
    const dot = document.getElementById('dlp-d-' + idx);
    if(dot){
      dot.classList.add('done');
      dot.style.animation = 'dlp-dot-in .3s cubic-bezier(.34,1.56,.64,1) forwards';
    }
  }

  function prepareProgressChips(keys, totalCount, specs){
    const specMap = specs || R2_SPECS;
    const counter = document.getElementById('sheets-loaded-count');
    const progEl = document.getElementById('sheets-progress');
    if(counter){ counter.style.display='inline-block'; counter.textContent='0/' + totalCount; }
    if(progEl){
      progEl.style.display = 'flex';
      progEl.innerHTML = keys
        .map(k=>specMap[k])
        .filter(Boolean)
        .map(f=>`<span id="sp-${f.tab}" style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:8px;background:rgba(0,0,0,.06);color:var(--n500)">${f.tab}</span>`)
        .join('');
    }
  }

  function getSnapshot(extra){
    const e = typeof extra === 'function' ? extra() : (extra || {});
    return Object.assign({
      version: DATA_RUNTIME_VERSION,
      foregroundKeys: FOREGROUND_KEYS.slice(),
      backgroundKeys: BACKGROUND_KEYS.slice(),
      allKeys: ALL_KEYS.slice(),
      cacheDb: CSV_DB,
      cacheTtlMs: CSV_TTL,
      r2Base: R2_BASE,
      status: JSON.parse(JSON.stringify(status)),
    }, e);
  }

  const dataApi = Object.freeze({
    version: DATA_RUNTIME_VERSION,
    foregroundKeys: FOREGROUND_KEYS.slice(),
    backgroundKeys: BACKGROUND_KEYS.slice(),
    allKeys: ALL_KEYS.slice(),
    csvDb: CSV_DB,
    csvTtlMs: CSV_TTL,
    r2Base: R2_BASE,
    r2Files: R2_FILES,
    r2Specs: R2_SPECS,
    status,
    wrapAsync,
    wrapSync,
    onPillText,
    onPillReset,
    onPillFinish,
    onPanelOpen,
    onPanelClose,
    csvOpen,
    csvCacheGet,
    csvCacheSet,
    csvCacheClear,
    fetchTextWithTimeout,
    clearPillTimers,
    resetDataPill,
    setDataPillText,
    finishDataPill,
    markForegroundPillDot,
    prepareProgressChips,
    getSnapshot,
  });
  if(Object.isFrozen(runtime)){
    global.FreshketSenseRuntime = Object.assign({}, runtime, { data: dataApi });
  }else{
    runtime.data = dataApi;
  }
  global.FreshketSenseDataRuntime = dataApi;
})(window);

// ─────────────────────────────────────────────────────

// ── PHASE 5 DATA LEGACY ADAPTER ─────────────────────
// ── PHASE 5 LEGACY DATA ADAPTERS ─────────────────────
// Keep the original data-loading globals alive while routing them through
// FreshketSenseRuntime.data for instrumentation and future extraction.
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
    'fetchWithEtag',
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


// ── PHASE 6.1 LOADER ORCHESTRATION RUNTIME ─────────────────────
// Phase 6.1 stabilized loader orchestration runtime for Freshket Sense.
// This layer owns Cloudflare/R2 orchestration while keeping the legacy globals as adapters.
// It intentionally reads/writes the legacy app state in the same classic-script scope.
(function(global){
  'use strict';

  const rt = global.FreshketSenseRuntime || {};
  const baseData = rt.data || global.FreshketSenseDataRuntime;
  if(!baseData){
    try{ console.warn('[Freshket Sense Phase 6.1] data runtime unavailable; loader orchestration not installed'); }catch(e){}
    return;
  }

  const ORCH_VERSION = 'v206d-loader-silent-hydrate';
  const ORCH_CFG = global.FreshketSenseConfig || {};
  const ORCH_DATA_CFG = ORCH_CFG.data || {};
  const FOREGROUND = (ORCH_DATA_CFG.foregroundKeys || ['portview','history','categories','sku_current','outlets','handover']).slice();
  const CRITICAL = (ORCH_DATA_CFG.criticalKeys || ['portview','history','handover']).slice();
  const ENHANCEMENT = (ORCH_DATA_CFG.enhancementKeys || FOREGROUND.filter(function(k){return CRITICAL.indexOf(k)<0;})).slice();
  const BACKGROUND = (ORCH_DATA_CFG.backgroundKeys || ['skus','alternatives']).slice();
  const ALL = FOREGROUND.concat(BACKGROUND);

  const orchStatus = {
    version: ORCH_VERSION,
    installedAt: Date.now(),
    lastOperation: null,
    lastError: null,
    foregroundLoaded: 0,
    backgroundLoaded: 0,
    loadedTabs: [],
    forceReloads: 0,
    backgroundReleased: false,
  };

  function now(){ return Date.now(); }
  function safeWarn(){ try{ console.warn.apply(console, arguments); }catch(e){} }
  function safeToast(text, icon){ try{ if(typeof showToast === 'function') showToast(text, icon); }catch(e){} }
  function getSpecs(){ try{ if(typeof R2_SPECS !== 'undefined') return R2_SPECS; }catch(e){} return baseData.r2Specs || {}; }
  function getFiles(){ try{ if(typeof R2_FILES !== 'undefined') return R2_FILES; }catch(e){} return baseData.r2Files || {}; }
  function getBase(){ try{ if(typeof R2_BASE !== 'undefined') return R2_BASE; }catch(e){} return baseData.r2Base || ''; }
  function getTtl(){ try{ if(typeof _CSV_TTL !== 'undefined') return _CSV_TTL; }catch(e){} return baseData.csvTtlMs || 0; }
  function getLoadedTabs(){ try{ if(typeof _cloudLoadedTabs !== 'undefined') return _cloudLoadedTabs; }catch(e){} return null; }
  function getInFlight(){ try{ if(typeof _cloudInFlight !== 'undefined') return _cloudInFlight; }catch(e){} return {}; }

  function record(name, phase, extra){
    const evt = Object.assign({ name, phase, ts: now() }, extra || {});
    orchStatus.lastOperation = evt;
    if(baseData && baseData.status && Array.isArray(baseData.status.operations)){
      baseData.status.lastOperation = evt;
      baseData.status.operations.push(evt);
      if(baseData.status.operations.length > 100) baseData.status.operations.shift();
    }
    return evt;
  }

  function recordError(name, err){
    const message = err && err.message ? err.message : String(err);
    orchStatus.lastError = { name, message, ts: now() };
    if(baseData && baseData.status){ baseData.status.lastError = orchStatus.lastError; }
    record(name, 'error', { message });
  }

  function markLoaded(tab){
    const tabs = getLoadedTabs();
    if(tabs && typeof tabs.add === 'function') tabs.add(tab);
    orchStatus.loadedTabs = tabs && typeof tabs.forEach === 'function' ? Array.from(tabs) : orchStatus.loadedTabs;
    try{ if(tab === 'skus') bulkSkusReady = true; }catch(e){}
    try{ if(tab === 'alternatives') bulkAltsReady = true; }catch(e){}
  }

  function isLoaded(tab){
    const tabs = getLoadedTabs();
    return !!(tabs && typeof tabs.has === 'function' && tabs.has(tab));
  }

  function clearInFlight(){
    const inFlight = getInFlight();
    Object.keys(inFlight).forEach(function(k){ delete inFlight[k]; });
  }

  function fetchTimeout(spec){ return spec && spec.heavy ? 240000 : 90000; }
  function ingestTimeout(spec){ return spec && spec.heavy ? 240000 : 90000; }

  const V212_DATA_EPOCH = '2026-05-22-v212-data-freshness';
  const V212_NETWORK_FIRST_TABS = { portview:true, history:true, handover:true, current_movements:true };
  function v212ShouldNetworkFirst(tab, spec, force){
    return !!force || !!V212_NETWORK_FIRST_TABS[tab] || (spec && spec.freshness === 'network-first');
  }
  function v212FreshUrl(url, tab){
    try{
      const sep = String(url).indexOf('?') >= 0 ? '&' : '?';
      return String(url) + sep + 'v=' + encodeURIComponent(V212_DATA_EPOCH) + '&cb=' + Date.now();
    }catch(e){ return url; }
  }
  function v212RecordFreshness(tab, meta){
    try{
      global.FreshketSenseDataFreshness = global.FreshketSenseDataFreshness || {};
      global.FreshketSenseDataFreshness[tab] = Object.assign({ tab:tab, dataEpoch:V212_DATA_EPOCH, checkedAt:Date.now() }, meta || {});
    }catch(e){}
  }

  async function fetchCloudflareFile(spec, opts){
    opts = opts || {};
    const force = !!opts.force;
    const cacheOverride = opts.cacheOverride;
    if(!spec || !spec.tab) return false;
    const tab = spec.tab;
    const inFlight = getInFlight();
    const networkFirst = v212ShouldNetworkFirst(tab, spec, force);

    if(!force && !networkFirst && isLoaded(tab)) return true;
    if(!force && inFlight[tab]) return inFlight[tab];

    const p = (async function(){
      record('_fetchCloudflareFile', 'start', { tab, force, heavy: !!spec.heavy, networkFirst });
      const dot = document.getElementById('sp-' + tab);
      if(dot) dot.style.background = 'rgba(38,96,200,.12)';
      try{
        let text = null;
        let source = 'network';
        let cached = null;
        const useCache = (cacheOverride !== undefined) ? cacheOverride : !!spec.cache;
        if(useCache && !networkFirst){
          cached = await baseData.csvCacheGet(tab);
          if(cached && cached.ts && (Date.now() - cached.ts) < getTtl()){
            text = cached.text;
            source = 'cache';
          }
        }
        if(!text){
          const files = getFiles();
          let url = `${getBase()}/${files[tab] || tab + '.csv'}`;
          if(tab==='current_movements'){
            console.log('%c[Sense DEBUG] current_movements fetch start','color:#ff0;background:#333',{url, useCache, cached:!!cached});
          }
          if(networkFirst) url = v212FreshUrl(url, tab);
          try{
            text = await baseData.fetchTextWithTimeout(url, fetchTimeout(spec));
            source = 'network';
            // v212: keep a fallback copy even for network-first files; never use it before trying network.
            if(useCache || networkFirst) baseData.csvCacheSet(tab, text);
          }catch(fetchErr){
            if(useCache || networkFirst){
              cached = cached || await baseData.csvCacheGet(tab);
              if(cached && cached.text){
                text = cached.text;
                source = 'offline-cache';
                safeWarn('[v212 freshness] network failed; using cached ' + tab, fetchErr && fetchErr.message ? fetchErr.message : fetchErr);
              }else{
                throw fetchErr;
              }
            }else{
              throw fetchErr;
            }
          }
        }
        if(spec.tab==='current_movements'){
          console.log('%c[Sense DEBUG] current_movements ingest start','color:#ff0;background:#333',
            {type:spec.type, textLen:text?text.length:0, source});
        }
        const ok = await ingestCSVText(spec.type, text, { timeoutMs: ingestTimeout(spec) });
        if(spec.tab==='current_movements'){
          console.log('%c[Sense DEBUG] current_movements ingest result','color:#ff0;background:#333',{ok, tab});
        }
        if(ok){
          markLoaded(tab);
          v212RecordFreshness(tab, { source, bytes:text ? text.length : 0, networkFirst, force, ageMs: source === 'cache' || source === 'offline-cache' ? (cached && cached.ts ? Date.now() - cached.ts : null) : 0 });
          if(dot){ dot.style.background = source === 'offline-cache' ? 'rgba(240,176,0,.18)' : 'rgba(0,208,112,.18)'; dot.style.color = source === 'offline-cache' ? '#9a6500' : 'var(--g700)'; }
          record('_fetchCloudflareFile', 'done', { tab, ok:true, source, networkFirst });
        }else{
          if(dot){ dot.style.background = 'rgba(240,80,0,.12)'; dot.style.color = 'var(--org)'; }
          v212RecordFreshness(tab, { source:'failed', networkFirst, force });
          record('_fetchCloudflareFile', 'done', { tab, ok:false, source, networkFirst });
        }
        return !!ok;
      }catch(err){
        if(dot){ dot.style.background = 'rgba(240,80,0,.12)'; dot.style.color = 'var(--org)'; }
        v212RecordFreshness(tab, { source:'error', networkFirst, force, error:err && err.message ? err.message : String(err) });
        recordError('_fetchCloudflareFile:' + tab, err);
        safeWarn('[Cloudflare R2]', tab, err && err.message ? err.message : err);
        return false;
      }finally{
        delete inFlight[tab];
      }
    })();

    inFlight[tab] = p;
    return p;
  }

  async function ensureCloudflareFiles(keys, opts){
    opts = opts || {};
    const label = opts.label || 'กำลังโหลดข้อมูล';
    const force = !!opts.force;
    const specs = (keys || []).map(function(k){ return getSpecs()[k]; }).filter(Boolean);
    if(!specs.length) return true;
    record('ensureCloudflareFiles', 'start', { keys:(keys||[]).slice(), label, force });
    let done = 0;
    baseData.setDataPillText(label, '0/' + specs.length);
    const results = await Promise.all(specs.map(function(spec){
      return fetchCloudflareFile(spec, { force, cacheOverride: spec.heavy ? false : undefined }).then(function(ok){
        done++;
        baseData.setDataPillText(label, done + '/' + specs.length);
        return ok;
      });
    }));
    const ok = results.every(Boolean);
    baseData.finishDataPill(ok ? (label + ' พร้อมแล้ว') : (label + ' โหลดไม่ครบ'), ok ? 900 : 1400);
    record('ensureCloudflareFiles', 'done', { ok, done, total: specs.length });
    return ok;
  }

  function nextIdle(fn, delay){
    delay = delay == null ? 0 : delay;
    if(global.requestIdleCallback){ return global.requestIdleCallback(function(){ fn(); }, { timeout: Math.max(800, delay + 800) }); }
    return setTimeout(fn, delay);
  }

  function startCloudEnhancementLoad(opts){
    opts = opts || {};
    const token = opts.token;
    const criticalLoaded = opts.criticalLoaded || 0;
    const specs = getSpecs();
    const keys = ENHANCEMENT.filter(function(k){ return specs[k]; });
    console.log('%c[Sense DEBUG] ENHANCEMENT keys','color:#ff0;background:#333',
      {ENHANCEMENT:ENHANCEMENT.slice(), keys:keys.slice(), 
       has_current_movements: ENHANCEMENT.indexOf('current_movements')>=0,
       spec_current_movements: !!specs['current_movements']});
    if(!keys.length){ startCloudBackgroundLoad({ token, fgLoaded:criticalLoaded, total:ALL.length }); return Promise.resolve([]); }
    record('startCloudEnhancementLoad', 'start', { token, keys:keys.slice(), criticalLoaded });
    baseData.setDataPillText('เติมรายละเอียด','0/' + keys.length);
    let done = 0;
    const p = Promise.all(keys.map(function(key){
      const spec = specs[key];
      return fetchCloudflareFile(spec,{ force:false }).then(function(ok){
        done++;
        try{ if(token !== _cloudLoadToken) return ok; }catch(e){}
        baseData.setDataPillText('เติมรายละเอียด',done + '/' + keys.length);
        return ok;
      });
    })).then(function(results){
      try{ if(token !== _cloudLoadToken) return results; }catch(e){}
      const okCount = results.filter(Boolean).length;
      orchStatus.foregroundLoaded = criticalLoaded + okCount;
      try{ if(typeof updateDataStatus === 'function') updateDataStatus(); }catch(e){}
      try{ if(typeof updateMatcherPreStatus === 'function') updateMatcherPreStatus(); }catch(e){}
      // v223: RenderBus handles render
      try{ if(window.RenderBus) window.RenderBus.signal('enhancement'); }catch(e){}
      record('startCloudEnhancementLoad','done',{ okCount, total:keys.length });
      startCloudBackgroundLoad({ token, fgLoaded:criticalLoaded + okCount, total:ALL.length });
      return results;
    }).catch(function(err){
      recordError('startCloudEnhancementLoad',err);
      startCloudBackgroundLoad({ token, fgLoaded:criticalLoaded, total:ALL.length });
      return [];
    });
    return p;
  }

  function startCloudBackgroundLoad(opts){
    opts = opts || {};
    const token = opts.token;
    const fgLoaded = opts.fgLoaded || 0;
    const total = opts.total || 7;
    try{ if(_cloudBackgroundPromise) return _cloudBackgroundPromise; }catch(e){}

    record('_startCloudBackgroundLoad', 'start', { token, fgLoaded, total });
    const counter = document.getElementById('sheets-loaded-count');
    const bgDots = document.getElementById('dlp-bg-dots');
    const readyIcon = document.getElementById('dlp-ready-icon');
    const dots = document.getElementById('dlp-dots');
    if(dots) dots.style.display = 'none';
    if(readyIcon) readyIcon.style.display = 'none';
    if(bgDots) bgDots.style.display = 'flex';
    baseData.setDataPillText('SKU','');

    let pillReleased = false;
    let finished = false;
    const releaseTimer = setTimeout(function(){
      try{ if(finished || token !== _cloudLoadToken) return; }catch(e){ if(finished) return; }
      pillReleased = true;
      orchStatus.backgroundReleased = true;
      baseData.finishDataPill('โหลดต่อเบื้องหลัง',1000);
      safeToast('กำลังโหลด SKU ต่อเบื้องหลัง','⟳');
    },18000);

    const specs = getSpecs();
    const p = Promise.all(BACKGROUND.map(async function(key){
      const spec = specs[key];
      const bgDot = document.getElementById(key === 'skus' ? 'dlp-bg-skus' : 'dlp-bg-alts');
      const ok = await fetchCloudflareFile(spec, { force:false, cacheOverride:false });
      try{ if(token !== _cloudLoadToken) return ok; }catch(e){}
      if(ok){ if(bgDot) bgDot.classList.add('done'); }
      else { if(bgDot) bgDot.style.background = 'rgba(240,80,0,.7)'; }
      const loadedNow = fgLoaded + BACKGROUND.filter(function(k){ return isLoaded(specs[k].tab); }).length;
      if(counter) counter.textContent = loadedNow + '/' + total;
      return ok;
    })).then(function(results){
      try{ if(token !== _cloudLoadToken) return results; }catch(e){}
      finished = true; clearTimeout(releaseTimer);
      const okCount = results.filter(Boolean).length;
      orchStatus.backgroundLoaded = okCount;
      if(okCount === BACKGROUND.length){
        if(!pillReleased) baseData.finishDataPill('ข้อมูลครบแล้ว',1000);
        safeToast('ข้อมูล SKU พร้อมแล้ว','✓');
      }else{
        if(!pillReleased) baseData.finishDataPill('ข้อมูลหลักพร้อมแล้ว',1400);
        safeToast('ข้อมูลหลักพร้อม แต่ SKU ยังไม่ครบ — กด Refresh data ได้','⚠');
      }
      try{ if(typeof updateDataStatus === 'function') updateDataStatus(); }catch(e){}
      try{ if(typeof updateMatcherPreStatus === 'function') updateMatcherPreStatus(); }catch(e){}
      record('_startCloudBackgroundLoad', 'done', { okCount, total: BACKGROUND.length });
      return results;
    }).catch(function(err){
      try{ if(token === _cloudLoadToken){
        finished = true; clearTimeout(releaseTimer);
        if(!pillReleased) baseData.finishDataPill('ข้อมูลหลักพร้อมแล้ว',1400);
        safeToast('โหลด SKU ไม่สำเร็จ — กด Refresh data','⚠');
        safeWarn('[Cloudflare background]', err);
      }}catch(e){}
      recordError('_startCloudBackgroundLoad', err);
      return [false,false];
    }).finally(function(){
      try{ if(token === _cloudLoadToken) _cloudBackgroundPromise = null; }catch(e){}
      // ── v221: Tier 3 deferred price load disabled — on-demand only ──
      // v198f path was: setTimeout(function(){ _startDeferredPriceLoad(_pt); }, 3000);
    });

    try{ _cloudBackgroundPromise = p; }catch(e){}
    return p;
  }

  async function loadFromCloudflareR2(){
    try{
      if(sheetsLoadStarted && _cloudInitialPromise) return _cloudInitialPromise;
      if(sheetsLoadStarted) return;
      sheetsLoadStarted = true;
    }catch(e){}
    let token;
    try{ token = ++_cloudLoadToken; }catch(e){ token = Date.now(); }

    record('loadFromCloudflareR2', 'start', { token, critical:CRITICAL.slice(), enhancement:ENHANCEMENT.slice() });
    const btn = document.getElementById('sheets-load-btn');
    const counter = document.getElementById('sheets-loaded-count');
    if(btn){ btn.disabled = true; btn.textContent = 'กำลังโหลด...'; }
    baseData.resetDataPill();
    baseData.prepareProgressChips(ALL, ALL.length, getSpecs());
    baseData.setDataPillText('โหลดข้อมูลหลัก','0/' + CRITICAL.length);

    const p = (async function(){
      let loaded = 0;
      const specs = getSpecs();
      const criticalResults = await Promise.all(CRITICAL.map(async function(key, idx){
        const ok = await fetchCloudflareFile(specs[key], { force:false });
        try{ if(token !== _cloudLoadToken) return ok; }catch(e){}
        if(ok){ loaded++; baseData.markForegroundPillDot(idx); }
        if(counter) counter.textContent = loaded + '/' + ALL.length;
        baseData.setDataPillText('โหลดข้อมูลหลัก', loaded + '/' + CRITICAL.length);
        return ok;
      }));
      try{ if(token !== _cloudLoadToken) return; }catch(e){}
      const criticalOk = criticalResults.filter(Boolean).length;
      orchStatus.foregroundLoaded = criticalOk;
      if(btn){ btn.disabled = false; btn.textContent = 'Refresh data'; }
      if(criticalOk === CRITICAL.length){
        safeToast('พร้อมใช้งาน — ข้อมูลหลัก ' + criticalOk + '/' + CRITICAL.length + ' ไฟล์','✓');
        baseData.setDataPillText('พร้อมใช้งาน','เติมรายละเอียดต่อเบื้องหลัง');
        // v223: RenderBus handles render
        try{ if(window.RenderBus) window.RenderBus.signal('critical'); }catch(e){}
        try{ if(typeof renderTeamview === 'function' && document.getElementById('scr-teamview')?.classList.contains('on') && !window.RenderBus) renderTeamview(); }catch(e){}
        nextIdle(function(){ startCloudEnhancementLoad({ token, criticalLoaded:criticalOk }); }, 450);
      }else{
        safeToast('ข้อมูลหลักยังไม่ครบ — กด Refresh data','⚠');
        nextIdle(function(){ startCloudEnhancementLoad({ token, criticalLoaded:criticalOk }); }, 500);
      }
      try{ if(typeof updateDataStatus === 'function') updateDataStatus(); }catch(e){}
      try{ if(typeof updateMatcherPreStatus === 'function') updateMatcherPreStatus(); }catch(e){}
      record('loadFromCloudflareR2', 'done', { criticalOk: criticalOk, totalCritical: CRITICAL.length, enhancementQueued: ENHANCEMENT.length });
    })().catch(function(err){
      recordError('loadFromCloudflareR2', err);
      safeToast('โหลดข้อมูลหลักไม่สำเร็จ — กด Refresh data','⚠');
      if(btn){ btn.disabled = false; btn.textContent = 'Refresh data'; }
      throw err;
    }).finally(function(){
      try{ if(token === _cloudLoadToken) _cloudInitialPromise = null; }catch(e){}
    });

    try{ _cloudInitialPromise = p; }catch(e){}
    return p;
  }

  async function reloadFromCloudflareR2(){
    record('reloadFromCloudflareR2', 'start');
    orchStatus.forceReloads++;
    await baseData.csvCacheClear();
    try{ sheetsLoadStarted = false; }catch(e){}
    try{ bulkSkusReady = false; bulkAltsReady = false; }catch(e){}
    try{ if(typeof _kamBundleLoaded !== 'undefined' && _kamBundleLoaded && _kamBundleLoaded.clear) _kamBundleLoaded.clear(); }catch(e){}
    try{ if(typeof _kamBundleInFlight !== 'undefined' && _kamBundleInFlight) Object.keys(_kamBundleInFlight).forEach(function(k){ delete _kamBundleInFlight[k]; }); }catch(e){}
    try{ global.FreshketSenseDataFreshness = {}; }catch(e){}
    const tabs = getLoadedTabs();
    if(tabs && typeof tabs.clear === 'function') tabs.clear();
    clearInFlight();
    try{ _cloudInitialPromise = null; _cloudBackgroundPromise = null; _cloudLoadToken++; }catch(e){}
    return loadFromCloudflareR2();
  }

  async function ensureAccountDetailData(accountId){
    if(!accountId) return false;
    const needed = [];
    try{ if(!bulkCatsData[accountId]) needed.push('categories'); }catch(e){ needed.push('categories'); }
    try{ if(!bulkSkuCurrentData[accountId]) needed.push('sku_current'); }catch(e){ needed.push('sku_current'); }
    try{ if(!bulkOutletsData[accountId]) needed.push('outlets'); }catch(e){ needed.push('outlets'); }
    try{ if(!bulkSkusData[accountId]) needed.push('skus'); }catch(e){ needed.push('skus'); }
    if(!needed.length) return true;
    safeToast('กำลังโหลด account intelligence...','⟳');
    const ok = await ensureCloudflareFiles(needed, { label:'Account intelligence' });
    try{ loadFromStorage(accountId); }catch(e){}
    try{ refreshAll(); updateDataStatus(); }catch(e){}
    try{ if(typeof updateMatcherPreStatus === 'function') updateMatcherPreStatus(); }catch(e){}
    try{ if(isKAM && document.getElementById('scr-kam-overview')?.classList.contains('on')) renderKamOverview(); }catch(e){}
    record('ensureAccountDetailData', 'done', { accountId, ok, needed });
    return ok;
  }

  async function ensureSenseData(accountId){
    if(!accountId) return false;
    const needed = [];
    try{ if(!bulkSkusData[accountId]) needed.push('skus'); }catch(e){ needed.push('skus'); }
    try{ if(!bulkAltsReady && !bulkAltsUnverified[accountId]) needed.push('alternatives'); }catch(e){ needed.push('alternatives'); }
    if(!needed.length) return true;
    safeToast('กำลังโหลด SKU + ทางเลือก...','⟳');
    const ok = await ensureCloudflareFiles(needed, { label:'SKU + ทางเลือก' });
    try{ loadFromStorage(accountId); }catch(e){}
    try{ if(D.alts.length && D.skus.length) computeOPPS(); }catch(e){}
    try{ refreshAll(); updateDataStatus(); }catch(e){}
    try{ if(typeof updateMatcherPreStatus === 'function') updateMatcherPreStatus(); }catch(e){}
    record('ensureSenseData', 'done', { accountId, ok, needed });
    return ok;
  }

  function getOrchestrationSnapshot(){
    const tabs = getLoadedTabs();
    return {
      orchestrationVersion: ORCH_VERSION,
      status: JSON.parse(JSON.stringify(orchStatus)),
      loadedTabs: tabs && typeof tabs.forEach === 'function' ? Array.from(tabs) : [],
      foregroundKeys: FOREGROUND.slice(),
      criticalKeys: CRITICAL.slice(),
      enhancementKeys: ENHANCEMENT.slice(),
      backgroundKeys: BACKGROUND.slice(),
      allKeys: ALL.slice(),
      sheetsLoadStarted: (function(){ try{ return sheetsLoadStarted; }catch(e){ return undefined; } })(),
      bulkSkusReady: (function(){ try{ return bulkSkusReady; }catch(e){ return undefined; } })(),
      bulkAltsReady: (function(){ try{ return bulkAltsReady; }catch(e){ return undefined; } })(),
    };
  }

  const phase6Methods = {
    version: ORCH_VERSION,
    loaderOrchestrationVersion: ORCH_VERSION,
    orchestrationStatus: orchStatus,
    fetchCloudflareFile,
    ensureCloudflareFiles,
    startCloudBackgroundLoad,
    loadFromCloudflareR2,
    reloadFromCloudflareR2,
    reloadFromGoogleSheets: reloadFromCloudflareR2,
    loadFromGoogleSheets: loadFromCloudflareR2,
    ensureAccountDetailData,
    ensureSenseData,
    loadFromSupabaseStorage: loadFromCloudflareR2,
    getOrchestrationSnapshot,
  };

  const extendedData = Object.freeze(Object.assign({}, baseData, phase6Methods, {
    getSnapshot: function(extra){
      const baseSnapshot = typeof baseData.getSnapshot === 'function' ? baseData.getSnapshot(extra) : {};
      return Object.assign({}, baseSnapshot, { version: ORCH_VERSION, orchestration: getOrchestrationSnapshot() });
    }
  }));

  const nextRuntime = Object.freeze(Object.assign({}, rt, { data: extendedData }));
  global.FreshketSenseRuntime = nextRuntime;
  global.FreshketSenseDataRuntime = extendedData;
})(window);

// ─────────────────────────────────────────────────────

// ── PHASE 6.1 LEGACY LOADER ADAPTER ─────────────────────
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

// ─────────────────────────────────────────────────────


// ── PHASE 13 VIEW REGISTRY / RENDERER INVENTORY ─────────────────────
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

// Freshket Sense legacy view adapter — Phase 13.
// Intentionally diagnostic-only. It preserves all legacy screen/render functions and exposes a boundary for future extraction.
(function(global){
  'use strict';
  const runtime = global.FreshketSenseViewRuntime || null;
  const registry = global.FreshketSenseViewRegistry || null;
  const status = {
    version: 'phase13-legacy-view-adapter',
    installedAt: new Date().toISOString(),
    mode: runtime ? 'diagnostic-only' : 'missing-runtime',
    registryLoaded: !!registry,
    rewiredFunctions: [],
    behaviorChanged: false,
    note: 'No legacy view functions are overridden in Phase 13.'
  };
  global.FreshketSensePhase13ViewAdapter = Object.freeze(status);
  global.FreshketSensePhase12ViewAdapter = global.FreshketSensePhase12ViewAdapter || Object.freeze(status);
})(window);


// ─────────────────────────────────────────────────────


// ── PHASE 11.1 APP STATE/STORAGE SAFETY STABILIZATION ─────────────────────
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
      knownKeys: knownStorageKeys,
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

// ─────────────────────────────────────────────────────

// Phase 11+ debug and staging smoke-check utilities.
// Console usage:
//   FreshketSenseDebug.snapshot()
//   FreshketSenseDebug.runStaticSmokeChecklist()
//   FreshketSenseDebug.printStaticSmokeChecklist()
//   FreshketSenseDebug.printConfigDiagnostics()
//   FreshketSenseDebug.printBoundaryDiagnostics()
(function(global){
  'use strict';

  function hasFn(name){ return typeof global[name] === 'function'; }
  function hasEl(id){ return !!global.document && !!document.getElementById(id); }
  function safe(fn, fallback){ try{ return fn(); }catch(e){ return fallback; } }
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
      defaultProxyUrl: ai.defaultProxyUrl || null,
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
    const diag = {
      exists: !!auth,
      version: auth && auth.version || null,
      controlExists: !!control,
      status: control && control.status ? control.status() : (auth && auth.status ? auth.status() : null),
      legacyAuthFns: ['doLogin','checkSession','hideLoginOverlay','showSenseSplash','doSignOut','loadUserProfile'].reduce(function(acc,name){ acc[name] = typeof global[name] === 'function'; return acc; }, {}),
      ts: new Date().toISOString()
    };
    return diag;
  }

  function printAuthDiagnostics(){
    const diag = authDiagnostics();
    try{ console.log('Freshket auth/session diagnostics:', diag); }catch(e){}
    return diag;
  }

  function stateDiagnostics(){
    const rt = global.FreshketSenseStateRuntime || (global.FreshketSenseRuntime && global.FreshketSenseRuntime.state) || null;
    return {
      exists: !!rt,
      version: rt && rt.version || null,
      controlExists: !!global.FreshketSenseStateControl,
      status: rt && rt.status ? rt.status() : null,
      appState: rt && rt.getAppStateSnapshot ? rt.getAppStateSnapshot() : null,
      storage: rt && rt.getStorageSnapshot ? rt.getStorageSnapshot() : null,
      ts: new Date().toISOString()
    };
  }

  function printStateDiagnostics(){
    const diag = stateDiagnostics();
    try{ console.log('Freshket state/storage diagnostics:', diag); }catch(e){}
    return diag;
  }

  function boundaryDiagnostics(){
    return {
      config: configDiagnostics(),
      auth: authDiagnostics(),
      loader: loaderDiagnostics(),
      state: stateDiagnostics(),
      smoke: runStaticSmokeChecklist(),
      ts: new Date().toISOString()
    };
  }

  function printBoundaryDiagnostics(){
    const diag = boundaryDiagnostics();
    try{ console.log('Freshket boundary diagnostics:', diag); }catch(e){}
    return diag;
  }

  function runStaticSmokeChecklist(){
    const rt = global.FreshketSenseRuntime || {};
    const aiClient = rt.aiClient || {};
    const data = rt.data || global.FreshketSenseDataRuntime || null;
    const checks = [
      ['runtime object exists', !!rt.version, rt.version || 'missing'],
      ['config object exists', !!global.FreshketSenseConfig, global.FreshketSenseConfig ? (global.FreshketSenseConfig.app && global.FreshketSenseConfig.app.version) : 'missing'],
      ['config version phase21', (global.FreshketSenseConfig && global.FreshketSenseConfig.app && global.FreshketSenseConfig.app.version) === 'v155-phase21-final-audit-regression', global.FreshketSenseConfig && global.FreshketSenseConfig.app && global.FreshketSenseConfig.app.version],
      ['AI runtime exists', !!aiClient.callAI, aiClient.callAI ? 'ok' : 'missing callAI'],
      ['production is proxy-only', aiClient.proxyOnlyProduction === true, aiClient.proxyOnlyProduction],
      ['direct browser key mode disabled', hasFn('directAiKeyModeAllowed') ? global.directAiKeyModeAllowed() === false : aiClient.directAiKeyModeAllowed && aiClient.directAiKeyModeAllowed() === false, 'expected false'],
      ['AI proxy configured', typeof aiClient.getAiProxyUrl === 'function' && !!aiClient.getAiProxyUrl(), typeof aiClient.getAiProxyUrl === 'function' ? (aiClient.getAiProxyUrl() || 'not set') : 'missing'],
      ['data runtime exists', !!data, data ? data.version : 'missing'],
      ['loader control exists', !!global.FreshketSenseLoaderControl, global.FreshketSenseLoaderControl ? 'ok' : 'missing'],
      ['loader adapter status exists', !!global.FreshketSensePhase6LoaderAdapter, global.FreshketSensePhase6LoaderAdapter ? (global.FreshketSensePhase6LoaderAdapter.mode || 'installed') : 'missing'],
      ['auth runtime exists', !!global.FreshketSenseAuthRuntime, global.FreshketSenseAuthRuntime ? global.FreshketSenseAuthRuntime.version : 'missing'],
      ['auth control exists', !!global.FreshketSenseAuthControl, global.FreshketSenseAuthControl ? 'ok' : 'missing'],
      ['state runtime exists', !!global.FreshketSenseStateRuntime, global.FreshketSenseStateRuntime ? global.FreshketSenseStateRuntime.version : 'missing'],
      ['state control exists', !!global.FreshketSenseStateControl, global.FreshketSenseStateControl ? 'ok' : 'missing'],
      ['storage facade exists', !!(global.FreshketSenseStateRuntime && global.FreshketSenseStateRuntime.storage), global.FreshketSenseStateRuntime && global.FreshketSenseStateRuntime.storage ? 'ok' : 'missing'],
      ['state runtime validation ok', !!(global.FreshketSenseStateRuntime && typeof global.FreshketSenseStateRuntime.validate === 'function' && global.FreshketSenseStateRuntime.validate().ok), global.FreshketSenseStateRuntime && typeof global.FreshketSenseStateRuntime.validate === 'function' ? global.FreshketSenseStateRuntime.validate().ok : 'missing'],
      ['view registry exists', !!global.FreshketSenseViewRegistry, global.FreshketSenseViewRegistry ? global.FreshketSenseViewRegistry.version : 'missing'],
      ['view runtime exists', !!global.FreshketSenseViewRuntime, global.FreshketSenseViewRuntime ? global.FreshketSenseViewRuntime.version : 'missing'],
      ['view control exists', !!global.FreshketSenseViewControl, global.FreshketSenseViewControl ? 'ok' : 'missing'],
      ['view adapter diagnostic-only', !!(global.FreshketSensePhase12ViewAdapter && global.FreshketSensePhase12ViewAdapter.behaviorChanged === false), global.FreshketSensePhase12ViewAdapter ? global.FreshketSensePhase12ViewAdapter.mode : 'missing'],
      ['view runtime validation ok', !!(global.FreshketSenseViewRuntime && typeof global.FreshketSenseViewRuntime.validate === 'function' && global.FreshketSenseViewRuntime.validate().ok), global.FreshketSenseViewRuntime && typeof global.FreshketSenseViewRuntime.validate === 'function' ? global.FreshketSenseViewRuntime.validate().ok : 'missing'],
      ['view snapshot helper exists', typeof global.getFreshketViewRuntimeSnapshot === 'function', 'getFreshketViewRuntimeSnapshot'],
      ['read model runtime exists', !!global.FreshketSenseReadModelRuntime, global.FreshketSenseReadModelRuntime ? global.FreshketSenseReadModelRuntime.version : 'missing'],
      ['read model behavior unchanged', !!(global.FreshketSenseReadModelRuntime && global.FreshketSenseReadModelRuntime.behaviorChanged === false), global.FreshketSenseReadModelRuntime ? global.FreshketSenseReadModelRuntime.behaviorChanged : 'missing'],
      ['read model validation ok', !!(global.FreshketSenseReadModelRuntime && typeof global.FreshketSenseReadModelRuntime.validate === 'function' && global.FreshketSenseReadModelRuntime.validate().ok), global.FreshketSenseReadModelRuntime && typeof global.FreshketSenseReadModelRuntime.validate === 'function' ? global.FreshketSenseReadModelRuntime.validate().ok : 'missing'],
      ['read model snapshot helper exists', typeof global.getFreshketReadModelSnapshot === 'function', 'getFreshketReadModelSnapshot'],
      ['navigation runtime exists', !!global.FreshketSenseNavigationRuntime, global.FreshketSenseNavigationRuntime ? global.FreshketSenseNavigationRuntime.version : 'missing'],
      ['navigation behavior unchanged', !!(global.FreshketSenseNavigationRuntime && global.FreshketSenseNavigationRuntime.behaviorChanged === false), global.FreshketSenseNavigationRuntime ? global.FreshketSenseNavigationRuntime.behaviorChanged : 'missing'],
      ['navigation validation ok', !!(global.FreshketSenseNavigationRuntime && typeof global.FreshketSenseNavigationRuntime.validate === 'function' && global.FreshketSenseNavigationRuntime.validate().ok), global.FreshketSenseNavigationRuntime && typeof global.FreshketSenseNavigationRuntime.validate === 'function' ? global.FreshketSenseNavigationRuntime.validate().ok : 'missing'],
      ['navigation snapshot helper exists', typeof global.getFreshketNavigationRuntimeSnapshot === 'function', 'getFreshketNavigationRuntimeSnapshot'],
      ['report renderer exists', !!global.FreshketSenseReportRenderer, global.FreshketSenseReportRenderer ? global.FreshketSenseReportRenderer.version : 'missing'],
      ['report renderer behavior unchanged', !!(global.FreshketSenseReportRenderer && global.FreshketSenseReportRenderer.behaviorChanged === false), global.FreshketSenseReportRenderer ? global.FreshketSenseReportRenderer.behaviorChanged : 'missing'],
      ['report renderer validation ok', !!(global.FreshketSenseReportRenderer && typeof global.FreshketSenseReportRenderer.validate === 'function' && global.FreshketSenseReportRenderer.validate().ok), global.FreshketSenseReportRenderer && typeof global.FreshketSenseReportRenderer.validate === 'function' ? global.FreshketSenseReportRenderer.validate().ok : 'missing'],
      ['report renderer snapshot helper exists', typeof global.getFreshketReportRendererSnapshot === 'function', 'getFreshketReportRendererSnapshot'],
      ['overview renderer exists', !!global.FreshketSenseOverviewRenderer, global.FreshketSenseOverviewRenderer ? global.FreshketSenseOverviewRenderer.version : 'missing'],
      ['overview renderer behavior unchanged', !!(global.FreshketSenseOverviewRenderer && global.FreshketSenseOverviewRenderer.behaviorChanged === false), global.FreshketSenseOverviewRenderer ? global.FreshketSenseOverviewRenderer.behaviorChanged : 'missing'],
      ['overview renderer validation ok', !!(global.FreshketSenseOverviewRenderer && typeof global.FreshketSenseOverviewRenderer.validate === 'function' && global.FreshketSenseOverviewRenderer.validate().ok), global.FreshketSenseOverviewRenderer && typeof global.FreshketSenseOverviewRenderer.validate === 'function' ? global.FreshketSenseOverviewRenderer.validate().ok : 'missing'],
      ['overview renderer snapshot helper exists', typeof global.getFreshketOverviewRendererSnapshot === 'function', 'getFreshketOverviewRendererSnapshot'],
      ['portfolio renderer exists', !!global.FreshketSensePortfolioRenderer, global.FreshketSensePortfolioRenderer ? global.FreshketSensePortfolioRenderer.version : 'missing'],
      ['portfolio renderer behavior unchanged', !!(global.FreshketSensePortfolioRenderer && global.FreshketSensePortfolioRenderer.behaviorChanged === false), global.FreshketSensePortfolioRenderer ? global.FreshketSensePortfolioRenderer.behaviorChanged : 'missing'],
      ['portfolio renderer validation ok', !!(global.FreshketSensePortfolioRenderer && typeof global.FreshketSensePortfolioRenderer.validate === 'function' && global.FreshketSensePortfolioRenderer.validate().ok), global.FreshketSensePortfolioRenderer && typeof global.FreshketSensePortfolioRenderer.validate === 'function' ? global.FreshketSensePortfolioRenderer.validate().ok : 'missing'],
      ['portfolio renderer snapshot helper exists', typeof global.getFreshketPortfolioRendererSnapshot === 'function', 'getFreshketPortfolioRendererSnapshot'],
      ['KAM/Team renderer exists', !!global.FreshketSenseKamTeamRenderer, global.FreshketSenseKamTeamRenderer ? global.FreshketSenseKamTeamRenderer.version : 'missing'],
      ['KAM/Team renderer behavior unchanged', !!(global.FreshketSenseKamTeamRenderer && global.FreshketSenseKamTeamRenderer.behaviorChanged === false), global.FreshketSenseKamTeamRenderer ? global.FreshketSenseKamTeamRenderer.behaviorChanged : 'missing'],
      ['KAM/Team renderer validation ok', !!(global.FreshketSenseKamTeamRenderer && typeof global.FreshketSenseKamTeamRenderer.validate === 'function' && global.FreshketSenseKamTeamRenderer.validate().ok), global.FreshketSenseKamTeamRenderer && typeof global.FreshketSenseKamTeamRenderer.validate === 'function' ? global.FreshketSenseKamTeamRenderer.validate().ok : 'missing'],
      ['KAM/Team renderer snapshot helper exists', typeof global.getFreshketKamTeamRendererSnapshot === 'function', 'getFreshketKamTeamRendererSnapshot'],
      ['style runtime exists', !!global.FreshketSenseStyleRuntime, global.FreshketSenseStyleRuntime ? global.FreshketSenseStyleRuntime.version : 'missing'],
      ['style runtime behavior unchanged', !!(global.FreshketSenseStyleRuntime && global.FreshketSenseStyleRuntime.behaviorChanged === false), global.FreshketSenseStyleRuntime ? global.FreshketSenseStyleRuntime.behaviorChanged : 'missing'],
      ['style runtime validation ok', !!(global.FreshketSenseStyleRuntime && typeof global.FreshketSenseStyleRuntime.validate === 'function' && global.FreshketSenseStyleRuntime.validate().ok), global.FreshketSenseStyleRuntime && typeof global.FreshketSenseStyleRuntime.validate === 'function' ? global.FreshketSenseStyleRuntime.validate().ok : 'missing'],
      ['style snapshot helper exists', typeof global.getFreshketStyleRuntimeSnapshot === 'function', 'getFreshketStyleRuntimeSnapshot'],
      ['state snapshot helper exists', typeof global.getFreshketStateRuntimeSnapshot === 'function', 'getFreshketStateRuntimeSnapshot'],
      ['auth checkSession exists', hasFn('checkSession'), 'checkSession'],
      ['auth doLogin exists', hasFn('doLogin'), 'doLogin'],
      ['data snapshot exists', hasFn('getFreshketDataRuntimeSnapshot'), hasFn('getFreshketDataRuntimeSnapshot') ? 'ok' : 'missing'],
      ['topbar exists', hasEl('dataBtnTop'), 'dataBtnTop'],
      ['data panel exists', hasEl('dataPanel'), 'dataPanel'],
      ['data pill exists', hasEl('data-load-pill'), 'data-load-pill'],
      ['AI FAB exists', hasEl('aiFab'), 'aiFab'],
      ['AI panel exists', hasEl('aiPanel'), 'aiPanel'],
      ['service worker supported', !!(global.navigator && navigator.serviceWorker), 'navigator.serviceWorker'],
      ['legacy load function exists', hasFn('loadFromCloudflareR2'), 'loadFromCloudflareR2'],
      ['legacy ensure function exists', hasFn('ensureCloudflareFiles'), 'ensureCloudflareFiles'],
      ['legacy data panel open exists', hasFn('openDataPanel'), 'openDataPanel'],
    ].map(function(row){ return { name:row[0], ok:!!row[1], detail:row[2] }; });
    return {
      ok: checks.every(function(c){ return c.ok || c.name === 'AI proxy configured'; }),
      note: 'AI proxy may be unset on local/staging until you configure freshket_ai_proxy_url.',
      runtimeVersion: rt.version || null,
      dataRuntimeVersion: data && data.version || null,
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

  function loaderDiagnostics(){
    const rt = global.FreshketSenseRuntime || {};
    const data = rt.data || global.FreshketSenseDataRuntime || null;
    const adapter = global.FreshketSensePhase6LoaderAdapter || null;
    const control = global.FreshketSenseLoaderControl || null;
    const diag = {
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
    return diag;
  }

  function printLoaderDiagnostics(){
    const diag = loaderDiagnostics();
    try{
      console.log('Freshket loader diagnostics:', diag);
      if(diag.orchestration && diag.orchestration.loadedTabs) console.table(diag.orchestration.loadedTabs.map(function(t){ return { loadedTab:t }; }));
    }catch(e){}
    return diag;
  }

  function viewDiagnostics(){
    const view = global.FreshketSenseViewRuntime || null;
    const adapter = global.FreshketSensePhase12ViewAdapter || null;
    return {
      runtimeVersion: view && view.version || null,
      adapter: adapter,
      control: global.FreshketSenseViewControl && global.FreshketSenseViewControl.status ? global.FreshketSenseViewControl.status() : null,
      activeScreens: view && view.activeScreens ? view.activeScreens() : [],
      activeNav: view && view.activeNav ? view.activeNav() : [],
      screens: view && view.screens ? view.screens() : [],
      groups: view && view.groupsDiagnostics ? view.groupsDiagnostics() : [],
      renderers: view && view.renderers ? view.renderers() : [],
      validation: view && view.validate ? view.validate() : { ok:false, reason:'view runtime missing' },
      ts: new Date().toISOString()
    };
  }

  function printViewDiagnostics(){
    const diag = viewDiagnostics();
    try{
      console.log('Freshket view diagnostics:', diag);
      if(diag.screens) console.table(diag.screens.map(function(s){ return { key:s.key, exists:s.exists, active:s.isActive, nav:s.navExists, missingRenderFns:(s.renderFns||[]).filter(function(f){ return !f.exists; }).map(function(f){ return f.name; }).join(', ') }; }));
    }catch(e){}
    return diag;
  }


  function readModelDiagnostics(){
    const rt = global.FreshketSenseReadModelRuntime || (global.FreshketSenseRuntime && global.FreshketSenseRuntime.readModel) || null;
    return rt && rt.diagnostics ? rt.diagnostics() : { version:null, ok:false, reason:'read model runtime missing', ts:new Date().toISOString() };
  }

  function printReadModelDiagnostics(){
    const diag = readModelDiagnostics();
    try{
      console.log('Freshket read model diagnostics:', diag);
      if(diag.validation && diag.validation.models) console.table(diag.validation.models.map(function(m){ return { key:m.key, ok:m.ok, screen:m.screen }; }));
    }catch(e){}
    return diag;
  }

  function navigationDiagnostics(){
    const rt = global.FreshketSenseNavigationRuntime || (global.FreshketSenseRuntime && global.FreshketSenseRuntime.navigation) || null;
    return rt && rt.diagnostics ? rt.diagnostics() : { version:null, ok:false, reason:'navigation runtime missing', ts:new Date().toISOString() };
  }

  function printNavigationDiagnostics(){
    const diag = navigationDiagnostics();
    try{
      console.log('Freshket navigation/screen-controller diagnostics:', diag);
      if(diag.validation && diag.validation.ids) console.table(diag.validation.ids);
    }catch(e){}
    return diag;
  }


  function reportRendererDiagnostics(){
    const rt = global.FreshketSenseReportRenderer || (global.FreshketSenseRuntime && global.FreshketSenseRuntime.views && global.FreshketSenseRuntime.views.reportRenderer) || null;
    return rt && rt.diagnostics ? rt.diagnostics() : { version:null, ok:false, reason:'report renderer missing', ts:new Date().toISOString() };
  }

  function printReportRendererDiagnostics(){
    const diag = reportRendererDiagnostics();
    try{
      console.log('Freshket report renderer diagnostics:', diag);
      if(diag.validation && diag.validation.ids) console.table(diag.validation.ids);
    }catch(e){}
    return diag;
  }


  function overviewRendererDiagnostics(){
    const rt = global.FreshketSenseOverviewRenderer || (global.FreshketSenseRuntime && global.FreshketSenseRuntime.views && global.FreshketSenseRuntime.views.overviewRenderer) || null;
    return rt && rt.diagnostics ? rt.diagnostics() : { version:null, ok:false, reason:'overview renderer missing', ts:new Date().toISOString() };
  }

  function printOverviewRendererDiagnostics(){
    const diag = overviewRendererDiagnostics();
    try{
      console.log('Freshket overview renderer diagnostics:', diag);
      if(diag.validation && diag.validation.ids) console.table(diag.validation.ids);
    }catch(e){}
    return diag;
  }


  function portfolioRendererDiagnostics(){
    const rt = global.FreshketSensePortfolioRenderer || (global.FreshketSenseRuntime && global.FreshketSenseRuntime.views && global.FreshketSenseRuntime.views.portfolioRenderer) || null;
    return rt && rt.diagnostics ? rt.diagnostics() : { version:null, ok:false, reason:'portfolio renderer missing', ts:new Date().toISOString() };
  }

  function printPortfolioRendererDiagnostics(){
    const diag = portfolioRendererDiagnostics();
    try{
      console.log('Freshket portfolio/SKU renderer diagnostics:', diag);
      if(diag.validation && diag.validation.ids) console.table(diag.validation.ids);
    }catch(e){}
    return diag;
  }

  function kamTeamRendererDiagnostics(){
    const rt = global.FreshketSenseKamTeamRenderer || (global.FreshketSenseRuntime && global.FreshketSenseRuntime.views && global.FreshketSenseRuntime.views.kamTeamRenderer) || null;
    return rt && rt.diagnostics ? rt.diagnostics() : { version:null, ok:false, reason:'KAM/Team renderer missing', ts:new Date().toISOString() };
  }

  function printKamTeamRendererDiagnostics(){
    const diag = kamTeamRendererDiagnostics();
    try{
      console.log('Freshket KAM/Team renderer diagnostics:', diag);
      if(diag.validation && diag.validation.ids) console.table(diag.validation.ids);
    }catch(e){}
    return diag;
  }

  function styleDiagnostics(){
    const rt = global.FreshketSenseStyleRuntime || (global.FreshketSenseRuntime && global.FreshketSenseRuntime.style) || null;
    return rt && rt.diagnostics ? rt.diagnostics() : { version:null, ok:false, reason:'style runtime missing', ts:new Date().toISOString() };
  }

  function printStyleDiagnostics(){
    const diag = styleDiagnostics();
    try{
      console.log('Freshket style/token diagnostics:', diag);
      if(diag.validation && diag.validation.criticalSelectors) console.table(diag.validation.criticalSelectors);
    }catch(e){}
    return diag;
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
      data: getDataSnapshot(),
      smoke: runStaticSmokeChecklist(),
      config: configDiagnostics(),
      auth: authDiagnostics(),
      state: stateDiagnostics(),
      boundary: boundaryDiagnostics(),
      view: viewDiagnostics(),
      readModel: readModelDiagnostics(),
      navigation: navigationDiagnostics(),
      reportRenderer: reportRendererDiagnostics(),
      overviewRenderer: overviewRendererDiagnostics(),
      portfolioRenderer: portfolioRendererDiagnostics(),
      kamTeamRenderer: kamTeamRendererDiagnostics(),
      style: styleDiagnostics(),
      ts: new Date().toISOString()
    };
  }

  global.FreshketSenseDebug = Object.freeze({ snapshot, runStaticSmokeChecklist, printStaticSmokeChecklist, loaderDiagnostics, printLoaderDiagnostics, configDiagnostics, printConfigDiagnostics, authDiagnostics, printAuthDiagnostics, stateDiagnostics, printStateDiagnostics, boundaryDiagnostics, printBoundaryDiagnostics, viewDiagnostics, printViewDiagnostics, readModelDiagnostics, printReadModelDiagnostics, navigationDiagnostics, printNavigationDiagnostics, reportRendererDiagnostics, printReportRendererDiagnostics, overviewRendererDiagnostics, printOverviewRendererDiagnostics, portfolioRendererDiagnostics, printPortfolioRendererDiagnostics, kamTeamRendererDiagnostics, printKamTeamRendererDiagnostics, styleDiagnostics, printStyleDiagnostics });
  global.printFreshketLoaderDiagnostics = printLoaderDiagnostics;
  global.printFreshketAuthDiagnostics = printAuthDiagnostics;
  global.printFreshketStateDiagnostics = printStateDiagnostics;
  global.printFreshketBoundaryDiagnostics = printBoundaryDiagnostics;
  global.printFreshketViewDiagnostics = printViewDiagnostics;
  global.printFreshketReadModelDiagnostics = printReadModelDiagnostics;
  global.printFreshketNavigationDiagnostics = printNavigationDiagnostics;
  global.printFreshketReportRendererDiagnostics = printReportRendererDiagnostics;
  global.printFreshketOverviewRendererDiagnostics = printOverviewRendererDiagnostics;
  global.printFreshketPortfolioRendererDiagnostics = printPortfolioRendererDiagnostics;
  global.printFreshketKamTeamRendererDiagnostics = printKamTeamRendererDiagnostics;
  global.printFreshketStyleDiagnostics = printStyleDiagnostics;
  global.runFreshketStaticSmokeChecklist = runStaticSmokeChecklist;
})(window);


// SECTION:SKU_MATCHER
function setMatcherMode(mode, btn){
  matcherMode=mode;
  document.querySelectorAll('.ms-opt[id^="m-"]').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
}
function setMatcherScope(scope, btn){
  matcherScope=scope;
  document.querySelectorAll('.ms-opt').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  const customRow=document.getElementById('ms-custom-row');
  if(customRow)customRow.style.display=scope==='custom'?'block':'none';
  const vsCustomRow=document.getElementById('vs-custom-row');
  if(vsCustomRow)vsCustomRow.style.display=scope==='custom'?'block':'none';
  updateMatcherPreStatus();
}

function updateMatcherPreStatus(){
  // ── v52: dual-source aware ──
  // Priority: matcherRawCsv (legacy) → D.alts unverified (bulk) → empty state
  const el=document.getElementById('gen-pre-status');
  const btn=document.getElementById('gen-btn');
  const reVerifyLink=document.getElementById('gen-reverify-link');
  // Verify sheet mirrors
  const vsEl=document.getElementById('vs-pre-status');
  const vsBtn=document.getElementById('vs-run-btn');
  const vsReVerifyLink=document.getElementById('vs-reverify-link');

  const iconSvg14='<svg width="12" height="12" viewBox="0 0 10 10" fill="currentColor" stroke="none"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg>';

  // Helper to set button text + state for both contexts
  const setBtn=(text,disabled)=>{
    if(btn){
      btn.disabled=!!disabled;btn.style.opacity=disabled?0.5:1;
      const iconSvg='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M13 2L4.5 13.5H12L11 22 19.5 10.5H12L13 2z"/></svg>';
      btn.innerHTML=iconSvg+' '+text;
    }
    if(vsBtn&&!vsBtn.classList.contains('running')){
      vsBtn.disabled=!!disabled;vsBtn.style.opacity=disabled?0.5:1;
      vsBtn.innerHTML=iconSvg14+' <span id="vs-run-label">'+text+'</span>';
    }
  };
  const setStatus=(html)=>{
    if(el)el.innerHTML=html;
    if(vsEl)vsEl.innerHTML=html;
  };
  const setReVerify=(show)=>{
    if(reVerifyLink)reVerifyLink.style.display=show?'block':'none';
    if(vsReVerifyLink)vsReVerifyLink.style.display=show?'block':'none';
  };

  // Legacy flow: matcher_input.csv uploaded
  if(matcherRawCsv){
    const allGroups=parseMatcherInput(matcherRawCsv);
    const scoped=getScopedSkus(allGroups);
    const scopedPairs=scoped.reduce((s,g)=>s+g.alternatives.length,0);
    const scopedGmv=scoped.reduce((s,g)=>s+(g.monthly_gmv||0),0);
    const scopeLabel=matcherScope==='all'?'':(matcherScope==='custom'?` (กำหนดเอง ${scoped.length})`:` (Top ${matcherScope})`);
    const gmvTxt=scopedGmv>0?` · ยอดซื้อรวม <strong>${fmt(scopedGmv)}/เดือน</strong>`:'';
    setStatus(`${scoped.length}${scopeLabel} SKU · ${scopedPairs} คู่${scoped.length<allGroups.length?' จาก '+allGroups.length+' ทั้งหมด':''}${gmvTxt}`);
    setBtn('Generate โอกาสประหยัด',false);
    setReVerify(false);
    return;
  }

  // Bulk flow: D.alts has unverified items
  if(D.alts&&D.alts.length){
    const meta=D.alts_meta||{};
    const allGroups=buildGroupsFromAlts();  // unverified only
    const scoped=getScopedSkus(allGroups);
    const scopedPairs=scoped.reduce((s,g)=>s+g.alternatives.length,0);
    const scopedGmv=scoped.reduce((s,g)=>s+(g.monthly_gmv||0),0);
    const totalSrc=meta.total_source_count||0;
    const verifiedSrc=meta.verified_source_count||0;
    const unverifiedSrc=allGroups.length;

    if(unverifiedSrc===0){
      // All verified state
      setStatus(`<span style="color:var(--g700);font-weight:600">✓ Verified ครบ ${verifiedSrc} SKU</span>${meta.verified_at?` · เมื่อ ${new Date(meta.verified_at).toLocaleDateString('th-TH')}`:''}`)
      setBtn('✓ Verified ครบ',true);
      setReVerify(true);
    } else {
      // Has unverified — show scope
      const scopeLabel=matcherScope==='all'?'':(matcherScope==='custom'?` (กำหนดเอง ${scoped.length})`:` (Top ${matcherScope})`);
      const gmvTxt=scopedGmv>0?` · ยอดซื้อรวม <strong>${fmt(scopedGmv)}/เดือน</strong>`:'';
      const partialTxt=verifiedSrc>0?` <span style="color:var(--g700);font-size:11px">(verified ${verifiedSrc} แล้ว)</span>`:'';
      setStatus(`${scoped.length}${scopeLabel} SKU ยังไม่ verify · ${scopedPairs} คู่${scoped.length<unverifiedSrc?' จาก '+unverifiedSrc+' ใหม่':''}${gmvTxt}${partialTxt}`);
      const btnText=verifiedSrc>0?`เทียบสเปคเพิ่ม ${scoped.length} SKU`:`ให้ Sense เทียบสเปค ${scoped.length} SKU`;
      setBtn(btnText,false);
      setReVerify(verifiedSrc>0);
    }
    return;
  }

  // No data
  setStatus('upload bulk_alternatives.csv หรือ matcher_input.csv ก่อน');
  setBtn('ให้ Sense เทียบสเปค',true);
  setReVerify(false);
}

function getScopedSkus(groups){
  if(matcherScope==='all')return groups;
  let n;
  if(matcherScope==='custom'){
    n=parseInt(document.getElementById('ms-custom-n')?.value)||parseInt(document.getElementById('vs-custom-n')?.value)||0;
    if(!n)return groups;
  }else{
    n=parseInt(matcherScope)||50;
  }
  return groups.slice(0,n);
}

// ════════════════════════════════════════
// MATCHER CORE — ported verbatim from matcher_artifact_v3.html
// processItem: 1 API call per source SKU, top-6 alts, 30s timeout
// ════════════════════════════════════════
async function processItem(g){
  // Diversity sort: mix high-confidence + high-savings for better AI coverage
  const _allAlts=[...g.alternatives];
  const _highConf=_allAlts.filter(a=>(a.grading||'').toLowerCase()==='a'||a.pack_size===g.pack_size).sort((a,b)=>b.price_diff-a.price_diff).slice(0,3);
  const _highConfIds=new Set(_highConf.map(a=>a.catalog_item_id));
  const _highDiff=_allAlts.filter(a=>!_highConfIds.has(a.catalog_item_id)).sort((a,b)=>b.price_diff-a.price_diff).slice(0,3);
  const alts=[..._highConf,..._highDiff].slice(0,6);
  const _unitLabel=g.price_unit_label||(g.price_basis==='per_liter'?'ลิตร':(g.price_basis==='per_egg'?'ฟอง':'กก.'));
  const _priceLabel='฿/'+_unitLabel;
  const altLines=alts.map(a=>`• [${a.catalog_item_id}] ${a.catalog_item_name} | brand: ${a.catalog_brand||'no brand'} | grade: ${a.grading} | pack: ${a.pack_size} | ${_priceLabel}: ${a.catalog_price} | diff: ฿${Number(a.price_diff||0).toFixed(2)}/${_unitLabel}`).join('\n');

  const sharedCriteria=`คุณคือ AI วิเคราะห์การจัดซื้อวัตถุดิบร้านอาหารไทย ทำงานให้ Freshket

หลักการประเมิน (ใช้เหมือนกันทุก mode):

--- EXCLUSION RULES (ถ้าตรงเงื่อนไขใดเข้า ให้ excluded ทันที) ---
1. PACK SIZE ISSUE: ราคาต่อหน่วยที่ส่งให้ต่างกัน >5x ส่วนใหญ่เป็นเรื่อง pack size ไม่ใช่โอกาสจริง → excluded + ตั้ง pack_size_issue=true
2. PRODUCT TYPE: ผลิตภัณฑ์คนละประเภทจริง → excluded (e.g. น้ำมันไก่ vs มันไก่ดิบ)
3. PREMIUM BREED/ORIGIN: account item มี label เช่น คุโรบูตะ/Kurobuta, Wagyu, อิเบริโก้, A5, Hokkaido → catalog ที่ไม่มี label นั้น = excluded
4. SIZE VARIANT: Baby/Mini/เล็ก/ใหญ่ ในชื่อ (Baby Cos ≠ Cos, Cherry Tomato ≠ Tomato) → excluded
5. FLAVOR/RECIPE VARIANT: สูตร/รส/ระบุในชื่อ (สูตรกวางตุ้ง, สูตรไหหลำ, รสเผ็ด, ต้นตำรับ) → flavor ต่างกัน = excluded
6. ACID/VINEGAR TYPE: น้ำส้มสายชูต่างชนิด (ไวน์แดง vs ไวน์ขาว vs แอปเปิ้ล vs ปาล์ม) = excluded
7. BEVERAGE BRAND: เครื่องดื่มแอลกอฮอล์และ branded beverage (เบียร์, ไวน์, แอลกอฮอล์) → brand = ผลต่อประสบการณ์สุดท้ายของลูกค้า → excluded ถ้าข้ามยี่ห้อ

--- CONFIDENCE RULES (ถ้าไม่ถูก exclude ข้างบน) ---
8. SAME CUT: ต้องเป็น cut เดียวกัน → high; cut ต่าง = excluded
9. GRADE: A vs NORMAL → medium + note
10. SIZE SPEC: alternative ไม่ระบุขนาด → medium`;

  const sysFast=sharedCriteria+`

ตอบเป็น JSON เท่านั้น ห้ามเขียน note prose summary ใดๆ ทั้งสิ้น
schema: {"pack_size_issue":false,"verified":[{"catalog_item_id":"12345","catalog_item_name":"ชื่อสินค้า","catalog_price":99.0,"pack_size":"1 kg./pack","price_diff":9.0,"is_substitutable":true,"confidence":"high|medium|low"}],"excluded":[{"catalog_item_id":"12345","catalog_item_name":"ชื่อสินค้า","reason_code":"wrong_type|pack_size|grade|spec|premium_breed|size_variant|flavor_variant|acid_type|beverage_brand"}]}`;

  const sysDetail=sharedCriteria+`

ตอบเป็น JSON เท่านั้น schema:
{"pack_size_issue":false,"pack_size_note":"","verified":[{"catalog_item_id":"12345","catalog_item_name":"...","catalog_price":99.0,"pack_size":"1 kg./pack","price_diff":9.0,"is_substitutable":true,"confidence":"high|medium|low","note_th":"ใช้แทนได้","caveat_th":""}],"excluded":[{"catalog_item_id":"12345","catalog_item_name":"...","catalog_price":47.0,"pack_size":"...","reason_th":"เหตุผลที่ exclude"}],"summary_th":"สรุปสั้นๆ"}`;

  const sys=matcherMode==='fast'?sysFast:sysDetail;
  const maxTok=matcherMode==='fast'?1000:4096;
  const _matLabel=g.monthly_gmv>=20000?'สินค้าหลัก (GMV สูง)':g.monthly_gmv>=5000?'สินค้ารอง':'สินค้าย่อย';
  const userMsg=`Account item:
- item_id: ${g.id}
- ชื่อ: ${g.name}
- pack: ${g.pack_size||'ไม่ระบุ'}
- ราคา/unit: ฿${g.unit_price||'?'}
- ราคา/${_unitLabel}: ฿${g.price}
- price_basis: ${g.price_basis||'per_kg'}
- subclass: ${g.subclass}
- ความสำคัญ: ${_matLabel} (GMV ฿${Math.round(g.monthly_gmv||0).toLocaleString()}/เดือน)

Alternatives:
${altLines}

ตอบ JSON`;

  const fetchPromise=callAI(matcherModel==='sonnet'?'sonnet':'haiku',sys,[{role:'user',content:userMsg}],maxTok);
  const timeoutPromise=new Promise((_,reject)=>setTimeout(()=>reject(new Error('Timeout (30s) — ลอง process ใหม่')),30000));
  const text=await Promise.race([fetchPromise,timeoutPromise]);
  let jsonStr=text.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
  const st=jsonStr.indexOf('{');
  if(st===-1)throw new Error('No JSON in response');
  let depth=0,en=-1;
  for(let i=st;i<jsonStr.length;i++){
    if(jsonStr[i]==='{')depth++;
    else if(jsonStr[i]==='}'){depth--;if(depth===0){en=i;break;}}
  }
  if(en===-1)throw new Error('Response truncated — ลอง process ใหม่');
  jsonStr=jsonStr.slice(st,en+1);
  let parsed;
  try{parsed=JSON.parse(jsonStr);}
  catch(e){throw new Error('JSON parse error: '+e.message.slice(0,60));}
  const hasConfirmed=parsed.verified?.length>0;
  const isFlag=parsed.pack_size_issue||parsed.verified?.some(v=>v.confidence==='low');
  g.result={...parsed,status:hasConfirmed?(isFlag?'done_flag':'done_yes'):'done_no',ai_note:parsed.summary_th||''};
  g.status=g.result.status;
  return g;
}

// [UNUSED] — no callers found; safe to delete in future refactor
async function retryMatcherItem(itemId){
  // Find the item in matcherGroups and re-process it
  if(!window._matcherGroups)return;
  const g=window._matcherGroups.find(x=>String(x.id)===String(itemId));
  if(!g)return showToast('ไม่พบ item '+itemId);
  g.status='pending';g.result=null;
  const btn=document.querySelector('[data-retry-id="'+itemId+'"]');
  if(btn){btn.textContent='กำลัง...';btn.disabled=true;}
  try{
    await processItem(g);
    updateMatcherUI();
    showToast('✓ retry สำเร็จ: '+g.name.slice(0,20));
  }catch(e){
    g.status='error';g.error=e.message;
    showToast('retry ล้มเหลว: '+e.message.slice(0,40));
  }
  if(btn){btn.textContent='retry';btn.disabled=false;}
  updateMatcherUI();
}

// ════════════════════════════════════════
// PRICE BASIS DETECTION (Phase 1)
// ════════════════════════════════════════

// Detect whether item is sold by weight or commercial unit
// Returns: 'per_kg' | 'per_unit_volume' | 'per_unit_count'
// ── Variable-weight range extractor ──────────────────────────────────
// For items like "3-6 kg./pack", "1.7-2.2 กก./ชิ้น" — returns MAX kg
// Freshket displays: price / max_weight = per-kg rate (same as website)
// Returns null if pack_size is not a variable-weight range
function extractRangeKgMax(packSizeStr){
  const s=(packSizeStr||'').toLowerCase().trim();
  if(!s)return null;
  // kg range: "3-6 kg./pack", "1.7-2.2 กก./ชิ้น", "3~6 kg", spaces ok
  const km=s.match(/(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)\s*(kg|กก\.?)/i);
  if(km){
    const maxKg=Math.max(parseFloat(km[1]),parseFloat(km[2]));
    return maxKg>0?maxKg:null;
  }
  // gram range: "500-1000 g./pack" → convert to kg
  const gm=s.match(/(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)\s*(g\b|g\.|กรัม)/i);
  if(gm){
    const maxG=Math.max(parseFloat(gm[1]),parseFloat(gm[2]));
    return maxG>0?maxG/1000:null;
  }
  return null;
}

// ── parsePackSizeUnits: extract total kg or total liter from pack_size string ──
// Returns {kg: N} or {liter: N} or null (no conversion possible)
// Handles: "5 kg", "N x M kg", "500 g.", "N x M g.", "1 L", "N x M ml", "cc", "กก.", "กรัม", "ลิตร"
// Excludes: range strings (3-6 kg) — those are handled by extractRangeKgMax
function parsePackSizeUnits(packSizeStr){
  const s=(packSizeStr||'').trim();
  if(!s)return null;

  // Skip range patterns — extractRangeKgMax handles those
  if(/\d+\s*[-~]\s*\d+\s*(?:kg|กก\.?|g\b|g\.|กรัม)/i.test(s))return null;

  // ── KG patterns ──
  // "N x M kg" or "N x M กก."
  const nxmKg=s.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:kg|กก\.?)(?:\b|\/|$|\s|,)/i);
  if(nxmKg)return{kg:parseFloat(nxmKg[1])*parseFloat(nxmKg[2])};
  // "N kg" or "N กก."
  const oneKg=s.match(/(\d+(?:\.\d+)?)\s*(?:kg|กก\.?)(?:\b|\/|$|\s|,)/i);
  if(oneKg)return{kg:parseFloat(oneKg[1])};

  // ── GRAM patterns ──
  // "N x M g." or "N x M กรัม"
  const nxmG=s.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:g\.?|กรัม)(?:\b|\/|$|\s|,)/i);
  if(nxmG){const kg=(parseFloat(nxmG[1])*parseFloat(nxmG[2]))/1000;return kg>0?{kg}:null;}
  // "N g." or "N กรัม"
  const oneG=s.match(/(\d+(?:\.\d+)?)\s*(?:g\.?|กรัม)(?:\b|\/|$|\s|,)/i);
  if(oneG){const kg=parseFloat(oneG[1])/1000;return kg>0?{kg}:null;}

  // ── LITER patterns ──
  // "N x M L" or "N x M liter/litre/ลิตร"
  const nxmL=s.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:l(?:iter|itre)?|ลิตร|lt)\b/i);
  if(nxmL)return{liter:parseFloat(nxmL[1])*parseFloat(nxmL[2])};
  // "N L" or "N liter/litre/ลิตร/lt"
  const oneL=s.match(/(\d+(?:\.\d+)?)\s*(?:l(?:iter|itre)?|ลิตร|lt)\b/i);
  if(oneL)return{liter:parseFloat(oneL[1])};

  // ── ML / CC patterns ──
  // "N x M ml" or "N x M cc"
  const nxmMl=s.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(?:ml|cc)\b/i);
  if(nxmMl)return{liter:(parseFloat(nxmMl[1])*parseFloat(nxmMl[2]))/1000};
  // "N ml" or "N cc"
  const oneMl=s.match(/(\d+(?:\.\d+)?)\s*(?:ml|cc)\b/i);
  if(oneMl)return{liter:parseFloat(oneMl[1])/1000};

  return null;
}

function detectPriceBasis(packSize, unitPrice, kgPrice){
  const s=(packSize||'').toLowerCase();

  // Clear weight indicators → per_kg
  if(/\d+\s*(g\b|g\.|กรัม|kg\b)/.test(s)) return 'per_kg';

  // Volume indicators → per_unit_volume (still compare per kg, display per unit)
  if(/\d+\s*(ml|ลิตร|liter)\b/.test(s)) return 'per_unit_volume';
  if(/\b(l\/|\/l\b)/.test(s)&&!/\bkg\b/.test(s)) return 'per_unit_volume';

  // Count/commercial unit indicators → per_unit_count
  if(/กระป๋อง|ขวด|ลัง|แพ็ค|can|bottle|case|carton|piece|pcs|ชิ้น/.test(s)) return 'per_unit_count';

  // Fallback heuristic: if unit_price differs significantly from kg_price, likely unit-based
  if(unitPrice>0 && kgPrice>0){
    const ratio=Math.abs(unitPrice-kgPrice)/kgPrice;
    if(ratio>0.4) return 'per_unit_count';
  }

  return 'per_kg';
}

// Derive display unit label from pack_size string
function getUnitLabel(packSize, priceBasis){
  if(priceBasis==='per_kg') return 'กก.';
  const s=(packSize||'').toLowerCase();
  if(s.includes('ถัง')) return 'ถัง';
  if(s.includes('ลัง')||s.includes('case')||s.includes('carton')) return 'ลัง';
  if(s.includes('กระป๋อง')||s.includes('can')) return 'กระป๋อง';
  if(s.includes('ขวด')||s.includes('bottle')) return 'ขวด';
  if(s.includes('แพ็ค')||s.includes('แพ็ก')||s.includes('pack')) return 'แพ็ค';
  if(s.includes('ชิ้น')||s.includes('pcs')||s.includes('piece')) return 'ชิ้น';
  if(s.includes('โหล')||s.includes('dozen')) return 'โหล';
  if(/ml|ลิตร|liter/.test(s)) return 'ขวด';
  if(s.includes('หน่วย')) return 'หน่วย';
  // Fallback: return trimmed pack_size if it's short and readable, else 'ชิ้น'
  const trimmed=(packSize||'').trim();
  if(trimmed&&trimmed.length<=20) return trimmed;
  return 'ชิ้น';
}

// ── Display unit helpers (Phase 3: egg + liquid normalization) ──

// Extract egg count from pack_size string (e.g. "30 egg/pack" → 30)
function extractEggCount(packSize){
  const m=(packSize||'').match(/(\d+)\s*eggs?[./\s]/i);
  return m?parseInt(m[1]):0;
}

// Derive the purchase/trading unit from pack_size string
// e.g. "12 x 800 ml./carton" → "ลัง", "1 kg/pack" → "แพ็ค"
function deriveQtyUnit(packSize,priceBasis){
  if(!packSize){return(priceBasis==='per_kg')?'kg':'ชิ้น';}
  const ps=packSize.toLowerCase();
  if(/carton/.test(ps)) return 'ลัง';
  if(/bottle/.test(ps)) return 'ขวด';
  if(/bag/.test(ps))    return 'ถุง';
  if(/can/.test(ps))    return 'กระป๋อง';
  if(/pack/.test(ps))   return 'แพ็ค';
  if(/\bkg\b|กก\./.test(ps)) return 'kg';
  if(priceBasis==='per_kg') return 'kg';
  return 'ชิ้น';
}

// Detect the natural trade unit for display
// Returns: 'per_kg' | 'per_liter' | 'per_egg'
function detectDisplayMode(subclass,packSize){
  const sub=(subclass||'').toUpperCase();
  const ps=(packSize||'').toLowerCase();
  // Eggs first
  if(/\bEGG\b/.test(sub)||extractEggCount(packSize)>0) return 'per_egg';
  // Liquid subclasses
  if(/MINERAL.WATER|DRINKING.WATER|STILL.WATER|SPARKLING|COLA|SODA|SYRUP|JUICE|MIXER|BEER|WINE|SPIRIT|LIQUOR|COCKTAIL|COFFEE.DRINK|ENERGY.DRINK|TEA.DRINK/.test(sub)) return 'per_liter';
  // Liquid by pack_size pattern (e.g. "12 x 500 ml./pack", "6 x 1.5 litres/pack")
  if(/\d+\s*x\s*[\d.]+\s*(ml|liter|litre|l\.)/i.test(ps)||/[\d.]+\s*(ml|liter|litre)\s*[/.]\b/i.test(ps)) return 'per_liter';
  return 'per_kg';
}

async function runMatcherInApp(vsMode=false){
  if(matcherRunning)return;
  if(!matcherRawCsv&&(!D.alts.length||!D.skus.length)&&typeof ensureSenseData==='function'){
    await ensureSenseData(currentAccountId);
  }

  // ── Element lookup: maps logical key → DOM id based on context ──
  const _EL={
    btn:         vsMode?'vs-run-btn':'gen-btn',
    progressWrap:vsMode?'vs-progress-wrap':'gen-progress-wrap',
    result:      vsMode?'vs-result':'gen-result',
    skuLog:      vsMode?'vs-sku-log':'gen-sku-log',
    fill:        vsMode?'vs-progress-fill':'gen-progress-fill',
    progSku:     vsMode?'vs-prog-sku':'gen-prog-sku',
    progFound:   vsMode?'vs-prog-found':'gen-prog-found',
    progDetail:  vsMode?'vs-prog-detail':'gen-prog-detail',
  };
  const _g=key=>document.getElementById(_EL[key]);

  // ── v52: source can be matcherRawCsv (legacy) OR D.alts (bulk_alternatives) ──
  // Priority: matcherRawCsv (manual upload wins for backward compat)
  let allGroups=[];
  let sourceMode='legacy';
  if(matcherRawCsv){
    allGroups=parseMatcherInput(matcherRawCsv);
    sourceMode='legacy';
  } else if(D.alts&&D.alts.length){
    // Build groups from unverified pairs in D.alts
    allGroups=buildGroupsFromAlts();
    sourceMode='bulk';
    if(allGroups.length===0){
      showToast('ทุก SKU verified แล้ว — กด "Re-verify ทั้งหมด" ถ้าต้องการรันใหม่','✓');
      return;
    }
  } else {
    showToast('ไม่มีข้อมูลให้ verify — upload bulk_alternatives.csv หรือ matcher_input.csv ก่อน','⚠');
    return;
  }

  matcherRunning=true;
  const btn=_g('btn');if(btn){btn.disabled=true;btn.classList.add('running');}
  const progWrap=_g('progressWrap');if(progWrap)progWrap.style.display='block';
  const resEl=_g('result');if(resEl)resEl.style.display='none';
  const skuLogEl=_g('skuLog');if(skuLogEl)skuLogEl.innerHTML='';

  const groups=getScopedSkus(allGroups);               // apply top-N scope
  const total=groups.length;

  if(total===0){
    const det=_g('progDetail');if(det)det.textContent='ไม่พบ SKU ที่วิเคราะห์ได้';
    matcherRunning=false;if(btn){btn.disabled=false;btn.classList.remove('running');}return;
  }

  let processed=0;
  for(const g of groups){
    const det=_g('progDetail');if(det)det.textContent=`กำลังวิเคราะห์: ${g.name.substring(0,28)}...`;
    try{
      await processItem(g);
    }catch(e){
      g.status='error';g.result={status:'error',ai_note:e.message};
      console.warn('processItem error:',g.name,e.message);
    }
    processed++;

    // Update live progress
    const pct=Math.round(processed/total*100);
    const fill=_g('fill');if(fill)fill.style.width=pct+'%';
    const skuEl=_g('progSku');if(skuEl)skuEl.textContent=`ตรวจสอบ ${processed} / ${total} SKU`;
    const verifiedCount=groups.filter(x=>x.status==='done_yes'||x.status==='done_flag').reduce((s,x)=>(s+(x.result?.verified?.length||0)),0);
    const foundEl=_g('progFound');if(foundEl)foundEl.textContent=`พบ ${verifiedCount} ตัวเลือก`;

    // Log to SKU list — pass verified + excluded
    appendSkuLog(g.name, g.result?.verified?.length||0, g.status, g.result?.excluded||[], g.result?.pack_size_issue, vsMode);

    await new Promise(r=>setTimeout(r,400)); // 400ms sleep between items (same as original)
  }

  // Build alternatives.json format from verified results
  // Export format identical to original exportJSON()
  const pairs=[];
  groups.forEach(g=>{
    if(!g.result?.verified)return;
    // v207e: preserve basis from Q4B / matcher_input instead of forcing every verified pair to per_kg.
    const _basis=g.price_basis||'per_kg';
    const _unitLabel=g.price_unit_label||(_basis==='per_liter'?'ลิตร':(_basis==='per_egg'?'ฟอง':'กก.'));
    g.result.verified.forEach(v=>{
      if(!v.is_substitutable) return;
      const _alt=g.alternatives.find(a=>String(a.catalog_item_id)===String(v.catalog_item_id))||{};
      const _srcDisplay=Number(g.price)||0;
      const _diff=Number(v.price_diff)||0;
      const _altDisplay=Number(v.catalog_price)||Math.max(0,_srcDisplay-_diff);
      pairs.push({
        source_item_id:parseInt(g.id),source_item_name:g.name,
        source_price:_srcDisplay,
        source_pack_size:g.pack_size||'',
        alt_item_id:parseInt(v.catalog_item_id),alt_item_name:v.catalog_item_name,
        alt_price:_altDisplay,
        price_diff:_diff,
        pack_size:v.pack_size||'',
        confidence:v.confidence,note_th:v.note_th||'',caveat_th:v.caveat_th||'',
        subclass:g.subclass,
        price_basis:_basis,price_unit_label:_unitLabel,
        source_display_price:_srcDisplay,
        alt_display_price:_altDisplay,
        price_diff_display:_diff,
        source_unit_price:g.unit_price||null,
        alt_unit_price:_alt.catalog_unit_price||null,
        monthly_qty_commercial:g.monthly_qty||0
      });
    });
  });

  // ── v52: MERGE strategy instead of REPLACE ──
  // For source SKUs that were verified in this run → drop their old pairs, add new verified ones
  // For source SKUs not in this run (still unverified or previously verified) → keep as-is
  const verifiedSourceIds=new Set(groups.map(g=>parseInt(g.id)));
  const keptPairs=(D.alts||[]).filter(p=>!verifiedSourceIds.has(p.source_item_id));
  const mergedPairs=[...keptPairs,...pairs];

  const altData={generated:new Date().toISOString(),pairs:mergedPairs};
  D.alts=parseAlternatives(JSON.stringify(altData));
  fileStatus.alternatives=true;

  // ── v52: Update alts_meta ──
  const allSourceIds=new Set(D.alts.map(p=>p.source_item_id));
  const verifiedNowSourceIds=new Set(D.alts.filter(p=>p.confidence&&p.confidence!=='unverified').map(p=>p.source_item_id));
  const totalCnt=D.alts.length;
  const verifiedCnt=D.alts.filter(p=>p.confidence&&p.confidence!=='unverified').length;
  let metaStatus='unverified';
  if(verifiedCnt===0)metaStatus='unverified';
  else if(verifiedNowSourceIds.size===allSourceIds.size)metaStatus='verified';
  else metaStatus='partial';
  D.alts_meta={
    status:metaStatus,
    verified_count:verifiedCnt,
    total_count:totalCnt,
    verified_source_count:verifiedNowSourceIds.size,
    total_source_count:allSourceIds.size,
    verified_at:new Date().toISOString(),
    bulk_loaded_at:D.alts_meta?.bulk_loaded_at||null
  };

  computeOPPS();saveToStorage();refreshAll();updateDataStatus();updateMatcherPreStatus();
  // Auto-activate Sense after matcher so opportunities screen reflects new verified SKUs
  senseActivated=true;
  matcherRunning=false;if(btn){btn.disabled=false;btn.classList.remove('running');}
  // Save to Supabase so result persists across devices
  if(currentAccountId){saveAltsToSupabase(currentAccountId,altData).then(()=>showToast('บันทึก alternatives ไว้ใน cloud แล้ว','☁'));}
  showMatcherResults(groups,pairs.length,vsMode);
}

// ── v52: Re-verify ทั้งหมด (force re-run on already-verified pairs) ──
async function reVerifyAll(){
  if(matcherRunning)return;
  if(!confirm('Re-verify ทั้งหมด? — จะเสีย AI cost รัน Matcher ทุก SKU อีกครั้ง'))return;
  // Reset all D.alts to unverified status, then run
  D.alts=(D.alts||[]).map(p=>({...p,confidence:'unverified',note_th:'',caveat_th:''}));
  D.alts_meta={...D.alts_meta,status:'unverified',verified_count:0,verified_source_count:0,verified_at:null};
  saveToStorage();
  updateMatcherPreStatus();
  await runMatcherInApp(false);
}

async function reVerifyAllFromSheet(){
  if(matcherRunning)return;
  if(!confirm('Re-verify ทั้งหมด? — จะเสีย AI cost รัน Matcher ทุก SKU อีกครั้ง'))return;
  D.alts=(D.alts||[]).map(p=>({...p,confidence:'unverified',note_th:'',caveat_th:''}));
  D.alts_meta={...D.alts_meta,status:'unverified',verified_count:0,verified_source_count:0,verified_at:null};
  saveToStorage();
  updateMatcherPreStatus();
  await runMatcherInApp(true);
}

function runMatcherFromSheet(){
  // Hide config, show progress inline — no redirect to data panel
  const cfg=document.getElementById('vs-config-section');
  if(cfg)cfg.style.display='none';
  runMatcherInApp(true);
}

function vsResetToConfig(){
  // Show config section again (e.g. after result, user wants to re-configure scope)
  const cfg=document.getElementById('vs-config-section');
  if(cfg)cfg.style.display='block';
  const res=document.getElementById('vs-result');
  if(res)res.style.display='none';
  const prog=document.getElementById('vs-progress-wrap');
  if(prog)prog.style.display='none';
  syncVsStatus();
}

function appendSkuLog(name, altCount, status, excluded, packSizeIssue, vsMode=false){
  const log=document.getElementById(vsMode?'vs-sku-log':'gen-sku-log');if(!log)return;
  const ok=altCount>0;const isErr=status==='error';const isFlag=status==='done_flag';
  const wrap=document.createElement('div');
  wrap.style.cssText='border-bottom:1px solid var(--n100);padding:4px 0';
  // Main row
  const row=document.createElement('div');
  row.className='gen-sku-row '+(isErr?'skip':ok?'ok':'skip');
  const icon=isErr?'✕':isFlag?'⚑':ok?'✓':'—';
  const packNote=packSizeIssue?'<span style="font-size:9px;color:var(--amb);font-weight:700;margin-left:4px">pack⚠</span>':'';
  row.innerHTML=`<span style="font-size:10px">${icon}</span><span class="gsr-name">${name}${packNote}</span>${ok?`<span class="gsr-count">${altCount} ตัวเลือก</span>`:isErr?`<span class="gsr-count" style="color:var(--org)">${status}</span>`:'<span class="gsr-count" style="color:var(--n400)">ไม่พบ</span>'}`;
  wrap.appendChild(row);
  // Excluded sub-rows
  if(excluded?.length){
    excluded.slice(0,3).forEach(ex=>{
      const sub=document.createElement('div');
      sub.style.cssText='display:flex;align-items:center;gap:5px;font-size:9px;color:var(--n400);padding:1px 0 1px 14px';
      const reason=ex.reason_code||ex.reason_th||'excluded';
      sub.innerHTML=`<span>✕</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ex.catalog_item_name}</span><span style="flex-shrink:0;font-style:italic">${reason.split('|')[0]}</span>`;
      wrap.appendChild(sub);
    });
    if(excluded.length>3){
      const more=document.createElement('div');
      more.style.cssText='font-size:9px;color:var(--n400);padding:1px 0 1px 14px';
      more.textContent=`+ ${excluded.length-3} อีก excluded`;
      wrap.appendChild(more);
    }
  }
  log.appendChild(wrap);log.scrollTop=log.scrollHeight;
}

// [UNUSED] — no callers found; safe to delete in future refactor
function updateGenProgress(){}  // no-op, progress updated inline in runMatcherInApp

function showMatcherResults(groups,totalPairs,vsMode=false){
  const resultEl=document.getElementById(vsMode?'vs-result':'gen-result');if(!resultEl)return;
  resultEl.style.display='block';
  const withAlts=groups.filter(g=>g.result?.verified?.length>0);
  const flags=groups.filter(g=>g.status==='done_flag').length;
  const summaryEl=document.getElementById(vsMode?'vs-result-summary':'gen-result-summary');
  if(summaryEl)summaryEl.innerHTML=`✓ เสร็จแล้ว · ตรวจ ${groups.length} SKU · <strong>${withAlts.length} มีตัวเลือก</strong>${flags?` · ${flags} ⚑ review`:''}${OPPS.length!==withAlts.length?` · ทั้งหมดใน app ${OPPS.length}`:''}`;
  const tableEl=document.getElementById(vsMode?'vs-result-table':'gen-result-table');
  if(tableEl)tableEl.innerHTML=
    '<div class="grt-row header"><span class="grt-name">SKU</span><span class="grt-alts">ตัวเลือก</span><span class="grt-save">ประหยัด/kg</span></div>'+
    withAlts.slice(0,15).map(g=>{
      const maxSave=Math.max(...(g.result.verified||[]).map(v=>v.price_diff),0);
      const badge=g.status==='done_flag'?'⚑ ':g.status==='done_yes'?'✓ ':'';
      return`<div class="grt-row"><span class="grt-name">${badge}${g.name}</span><span class="grt-alts">${g.result.verified.length}</span><span class="grt-save">฿${maxSave.toFixed(0)}</span></div>`;
    }).join('')+(withAlts.length>15?`<div class="grt-row" style="color:var(--n400);text-align:center;justify-content:center">+ ${withAlts.length-15} รายการ</div>`:'');

  if(vsMode){
    // VS mode: update the pre-wired nav button label + no dl button needed
    const _thisRunCount=withAlts.length;  // SKUs verified in THIS run
    const navLbl=document.getElementById('vs-nav-opps-label');
    if(navLbl)navLbl.textContent=`ดูรายการที่เพิ่งตรวจ ${withAlts.length} SKU →`;
    return;
  }

  // Data panel mode: dynamically add download + nav buttons
  let dlBtn=document.getElementById('gen-dl-btn');
  if(!dlBtn){
    dlBtn=document.createElement('button');
    dlBtn.id='gen-dl-btn';
    dlBtn.style.cssText='width:100%;margin-top:10px;padding:10px;border-radius:10px;border:1.5px solid var(--g500);background:var(--g50);color:var(--g700);font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px';
    resultEl.appendChild(dlBtn);
  }
  dlBtn.onclick=downloadAlternatives;
  const acctLabel=D.meta.accountName?D.meta.accountName.slice(0,12):'account';
  dlBtn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> บันทึก alternatives.json`;
  // CTA to navigate to Opportunities
  let navBtn=document.getElementById('gen-nav-opps-btn');
  if(!navBtn){
    navBtn=document.createElement('button');
    navBtn.id='gen-nav-opps-btn';
    navBtn.style.cssText='width:100%;margin-top:8px;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#1a4a3a,#0d3328);color:#fff;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px';
    navBtn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M13 2L4.5 13.5H12L11 22 19.5 10.5H12L13 2z"/></svg> ดูรายการที่เพิ่งตรวจ ${withAlts.length} SKU →`;
    navBtn.onclick=()=>{closeDataPanel();showScreen('opportunities');};
    resultEl.appendChild(navBtn);
  } else {
    navBtn.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M13 2L4.5 13.5H12L11 22 19.5 10.5H12L13 2z"/></svg> ดูรายการที่เพิ่งตรวจ ${withAlts.length} SKU →`;
  }
}

function downloadAlternatives(){
  if(!D.alts||!D.alts.length){showToast('ยังไม่มีข้อมูล alternatives','⚠');return;}
  const pairs=D.alts;
  const blob=new Blob([JSON.stringify({generated:new Date().toISOString(),account:D.meta.accountName||'',pairs},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const acct=(D.meta.accountId||'account').slice(0,8);
  a.href=url;a.download=`alternatives_${acct}.json`;
  document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);document.body.removeChild(a);},500);
  showToast('บันทึก alternatives.json แล้ว','↓');
}

// ════════════════════════════════════════
// SENSE GATE OVERLAY
// ════════════════════════════════════════
let _sgRunning=false;
let _sgTickerTimer=null;
let _sgRevealTimer=null;  // v201b: storable timer so abort-on-fail can cancel reveal
let _sgRevealPending=false;  // v201c: set when reveal timer fires before data ready — sgOrbTap triggers reveal on data arrival

// SECTION:SENSE_GATE
function openSenseGate(){
  const gate=document.getElementById('sense-gate');
  if(!gate)return;
  gate.style.display='flex';gate.style.opacity='1';gate.classList.remove('sg-exit');
  // Inject personalized data context (now in text-area, above tap hint)
  const ringData=document.getElementById('sg-ring-data');
  if(ringData){
    const n=OPPS.length||D.skus.length||0;
    const lastMo=D.history.length?D.history[D.history.length-1].m:'';
    ringData.textContent=n>0?(n+' SKU'+(lastMo?' · '+lastMo:'')):'';
    ringData.style.opacity=n>0?'1':'0';
    ringData.style.display='';
  }
  _sgSetState('standby');
}

function _sgSetState(state){
  const ringSvg=document.getElementById('sg-ring-svg');
  const ringFill=document.getElementById('sg-ring-fill');
  const ringScan=document.getElementById('sg-ring-scan');
  const orbStar=document.getElementById('sg-orb-star');
  const scoreWrap=document.getElementById('sg-score-wrap');
  const ticker=document.getElementById('sg-ticker');
  const ctaWrap=document.getElementById('sg-cta-wrap');
  const title=document.getElementById('sg-title');
  const sub=document.getElementById('sg-sub');
  const tapHint=document.getElementById('sg-tap-hint');
  const beacon=document.getElementById('sg-beacon');
  const ringData=document.getElementById('sg-ring-data');
  if(state==='standby'){
    _sgRunning=false;
    if(_sgTickerTimer){clearTimeout(_sgTickerTimer);_sgTickerTimer=null;}
    if(_sgRevealTimer){clearTimeout(_sgRevealTimer);_sgRevealTimer=null;}
    _sgRevealPending=false;
    if(ringSvg)ringSvg.setAttribute('class','');
    if(ringFill){ringFill.style.opacity='0';ringFill.style.strokeDashoffset='565.2';}
    if(ringScan){ringScan.style.opacity='';ringScan.style.transition='';ringScan.style.animation='';ringScan.style.strokeDasharray='';}
    _sgStopElectrons();
    ['sg-ring-scan2','sg-ring-scan3'].forEach(id=>{const el=document.getElementById(id);if(el){el.style.animation='';el.style.opacity='';};});
    ['sg-ring-scan2','sg-ring-scan3','sg-od1','sg-od2','sg-od3'].forEach(id=>{
      const el=document.getElementById(id);
      if(el){el.style.animation='';el.style.opacity='';}
    });
    if(orbStar){orbStar.style.display='block';orbStar.style.opacity='1';}
    if(scoreWrap)scoreWrap.classList.remove('visible');
    if(ticker){ticker.style.display='none';}
    if(ctaWrap)ctaWrap.classList.remove('visible');
    if(title){title.textContent='Freshket Sense';title.style.opacity='1';}
    if(sub){sub.style.opacity='1';}
    if(tapHint){tapHint.classList.remove('hidden');tapHint.style.display='';}
    if(beacon)beacon.style.display='';
    if(ringData){ringData.style.opacity='1';ringData.style.display='';}
  }
}

async function sgOrbTap(){
  if(_sgRunning||senseActivated)return;
  _sgRunning=true;
  // v201b: hide tap hint + start animation IMMEDIATELY — don't wait for data load
  const tapHint=document.getElementById('sg-tap-hint');
  const beacon=document.getElementById('sg-beacon');
  if(tapHint)tapHint.classList.add('hidden');
  if(beacon)beacon.style.display='none';
  _sgRunThinking();  // animation starts now (8-10s window = enough time to download)
  // If data not ready, load in background while animation is already running
  if(!D.alts.length||!D.skus.length){
    console.log('[SenseGate] lazy-load start (animation already running) | alts:'+D.alts.length+' skus:'+D.skus.length);
    if(typeof ensureSenseData==='function')await ensureSenseData(currentAccountId,{silent:true});
    console.log('[SenseGate] ensureSenseData done | alts:'+D.alts.length+' skus:'+D.skus.length+' _sgRunning:'+_sgRunning);
    if(!D.alts.length||!D.skus.length){
      // Load failed — abort animation, reset to standby
      console.warn('[SenseGate] ❌ lazy-load failed — aborting animation');
      _sgSetState('standby');
      const sub=document.getElementById('sg-sub');
      if(sub){sub.style.opacity='1';sub.textContent='ยังไม่มีข้อมูลเพียงพอสำหรับร้านนี้';setTimeout(()=>{sub.textContent='';},2200);}
      return;
    }
    console.log('[SenseGate] data ready mid-animation | alts:'+D.alts.length+' skus:'+D.skus.length);
    // reveal timer may have fired while waiting — trigger now if pending
    if(_sgRevealPending&&_sgRunning&&!senseActivated){
      console.log('[SenseGate] _sgRevealPending=true — triggering delayed reveal now');
      _sgRevealPending=false;
      _sgRevealScore();
    }
  } else {
    console.log('[SenseGate] data already ready, starting scan | alts:'+D.alts.length+' skus:'+D.skus.length);
  }
  // _sgRevealTimer will fire in ~8-10s and call _sgRevealScore() with data ready
}

let _sgElectronRAF=null;
function _sgStartElectrons(){
  const svgEl=document.getElementById('sg-ring-svg');
  // Generate many particles dynamically
  const svgNS='http://www.w3.org/2000/svg';
  const svgEl2=document.getElementById('sg-ring-svg');
  // Remove old dynamic dots if any
  document.querySelectorAll('.sg-edot').forEach(e=>e.remove());
  const dotDefs=[
    {r:3.5,color:'#00ff99'},{r:2.5,color:'#66ffbb'},{r:2,color:'#00cc6a'},
    {r:1.5,color:'#00ff88'},{r:3,color:'#44ffaa'},{r:1.5,color:'#00ee77'},
    {r:2,color:'#88ffcc'},{r:1,color:'#00cc6a'},{r:2.5,color:'#33ff99'},
    {r:1.5,color:'#00ffaa'},{r:1,color:'#55ffbb'},{r:3,color:'#00ff88'},
  ];
  const dots=dotDefs.map((def,i)=>{
    const c=document.createElementNS(svgNS,'circle');
    c.setAttribute('class','sg-edot');
    c.setAttribute('r',def.r);
    c.setAttribute('fill',def.color);
    c.setAttribute('opacity','0');
    if(svgEl2)svgEl2.appendChild(c);
    return{el:c,baseR:def.r,angle:Math.random()*Math.PI*2,speed:0.8+Math.random()*1.8,phase:Math.random()};
  });
  const cx=110,cy=110,r=90;
  function tick(){
    const now=performance.now()/1000;
    dots.forEach(d=>{
      if(!d.el)return;
      const cyc=((now*d.speed*0.35)+d.phase)%1;
      let x,y,op;
      if(cyc<0.65){
        const angle=d.angle+now*d.speed;
        x=cx+r*Math.cos(angle);y=cy+r*Math.sin(angle);
        op=cyc<0.08?cyc/0.08:0.85;
        d.el.setAttribute('r',String(d.baseR*(cyc<0.08?cyc/0.08:1)));
      } else {
        const t=(cyc-0.65)/0.35;
        const ease=t*t*(3-2*t);
        const angle=d.angle+now*d.speed;
        x=cx+(r*(1-ease))*Math.cos(angle);
        y=cy+(r*(1-ease))*Math.sin(angle);
        op=(1-ease)*0.85;
        d.el.setAttribute('r',String(d.baseR*Math.max(0.2,1-ease*0.8)));
      }
      d.el.setAttribute('cx',x.toFixed(2));
      d.el.setAttribute('cy',y.toFixed(2));
      d.el.setAttribute('opacity',op.toFixed(2));
    });
    _sgElectronRAF=requestAnimationFrame(tick);
  }
  tick();
}
function _sgStopElectrons(){
  if(_sgElectronRAF){cancelAnimationFrame(_sgElectronRAF);_sgElectronRAF=null;}
  document.querySelectorAll('.sg-edot').forEach(e=>e.remove());
}
function _sgRunThinking(){
  const ringSvg=document.getElementById('sg-ring-svg');
  const orbStar=document.getElementById('sg-orb-star');
  const ticker=document.getElementById('sg-ticker');
  const tickerLine=document.getElementById('sg-ticker-line');
  const tickerText=document.getElementById('sg-ticker-text');
  const title=document.getElementById('sg-title');
  const sub=document.getElementById('sg-sub');
  const ringData=document.getElementById('sg-ring-data');
  const tapHint=document.getElementById('sg-tap-hint');
  if(ringSvg)ringSvg.setAttribute('class','thinking');
  if(orbStar)orbStar.style.display='none';
  // Directly activate A+B+C via inline styles (bypasses CSS specificity battle)
  setTimeout(()=>{
    // A: scan1 faster CW (direct JS — bypass SVG className CSS issue)
    const s1=document.getElementById('sg-ring-scan');
    if(s1){s1.style.strokeDasharray='110 490';s1.style.animation='sg-scan-rotate .9s linear infinite';}
    // A: scan2 CCW
    const s2=document.getElementById('sg-ring-scan2');
    if(s2){s2.style.opacity='.6';s2.style.animation='sg-scan-rotate-ccw 2.1s linear infinite';}
    // B: scan3 short fragment CW
    const s3=document.getElementById('sg-ring-scan3');
    if(s3){s3.style.opacity='.45';s3.style.animation='sg-scan-rotate 1.5s linear infinite';}
    // C: electron-suck JS loop
    _sgStartElectrons();
  },50);
  if(ringData){ringData.style.opacity='0';}
  if(tapHint){tapHint.classList.add('hidden');setTimeout(()=>{tapHint.style.display='none';},350);}
  if(title)title.style.opacity='0';
  if(sub)sub.style.opacity='0';
  if(ticker)ticker.style.display='block';
  // Phases — keep original wording (confirmed by Bucci)
  const n=OPPS.length||D.skus.length||0;
  const phases=[
    'กำลังตรวจ '+(n||'—')+' รายการของร้าน',
    'เปรียบราคาตลาด Freshket',
    'คัดสินค้าที่ใกล้เคียงสเปค',
    'Sense จัดลำดับโอกาสสำหรับคุณ',
    'ทบทวนผลการวิเคราะห์',
  ];
  // Random total duration 8000–10000ms
  const totalMs=8000+Math.floor(Math.random()*2001);
  const baseSlice=totalMs/phases.length;
  let t=0;
  const timings=[];
  phases.forEach((_,i)=>{
    const jitter=(Math.random()-.5)*baseSlice*.4;
    timings.push({start:Math.round(t),text:phases[i]});
    t+=baseSlice+jitter;
  });
  if(tickerText)tickerText.textContent=timings[0].text;
  timings.slice(1).forEach(({start,text})=>{
    _sgTickerTimer=setTimeout(()=>{
      if(tickerLine)tickerLine.classList.add('fade-out');
      setTimeout(()=>{
        if(tickerText)tickerText.textContent=text;
        if(tickerLine)tickerLine.classList.remove('fade-out');
      },390);
    },start);
  });
  _sgRevealTimer=setTimeout(()=>{
    _sgRevealTimer=null;
    if(!D.alts.length||!D.skus.length){
      // data not ready yet (Tier 2 still loading) — hold reveal until sgOrbTap gets data
      console.log('[SenseGate] reveal timer fired but data not ready — setting _sgRevealPending');
      _sgRevealPending=true;
      return;
    }
    _sgRevealScore();
  },totalMs+600);
}

function _sgRevealScore(){
  const ringSvg=document.getElementById('sg-ring-svg');
  const ringFill=document.getElementById('sg-ring-fill');
  const orbStar=document.getElementById('sg-orb-star');
  const scoreWrap=document.getElementById('sg-score-wrap');
  const scoreNum=document.getElementById('sg-score-num');
  const scoreUnit=document.getElementById('sg-score-unit');
  const ctaWrap=document.getElementById('sg-cta-wrap');
  const ticker=document.getElementById('sg-ticker');
  const tickerLine=document.getElementById('sg-ticker-line');
  const doneLabel=document.getElementById('sg-done-label');
  const doneDesc=document.getElementById('sg-done-desc');
  // Compute score
  const senseMetrics=getSenseScoreMetrics();
  const savPct=senseMetrics.savPct;
  const score=senseMetrics.score;
  const scoreLabel=score>=85?'บริหารต้นทุนดีมาก':score>=72?'บริหารดี ยังมีช่อง':score>=58?'มีช่องประหยัดได้':'Sense เจอราคาคุ้มกว่ามาก';
  const circ=565.2;
  // Set globals
  senseActivated=true;aiCameFromPreview=true;
  // Ring: stop scan (CSS + opacity), show fill arc
  if(ringSvg)ringSvg.setAttribute('class','done-state');
  if(orbStar)orbStar.style.display='none';
  // Hard-stop all scan arcs + electrons
  _sgStopElectrons();
  ['sg-ring-scan','sg-ring-scan2','sg-ring-scan3'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.style.animation='none';el.style.opacity='0';}
  });
  if(ringFill){
    ringFill.style.opacity='1';
    setTimeout(()=>{ringFill.style.strokeDashoffset=String(circ-(score/100)*circ);},80);
  }
  // Score in ring — SENSE SCORE label underneath
  if(scoreNum){scoreNum.style.color='#ffffff';scoreNum.textContent='0';}
  if(scoreUnit){scoreUnit.textContent='SENSE SCORE';scoreUnit.style.cssText='font-size:8px;color:rgba(160,255,200,.6);font-family:\'IBM Plex Sans Thai\',sans-serif;margin-top:5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;';}
  requestAnimationFrame(()=>{
    if(scoreWrap)scoreWrap.classList.add('visible');
    if(scoreNum){
      const start=Date.now();
      (function tick(){
        const t=Math.min((Date.now()-start)/1200,1);
        const e=1-Math.pow(1-t,3);
        if(scoreNum)scoreNum.textContent=String(Math.round(score*e));
        if(t<1)requestAnimationFrame(tick);
      })();
    }
  });
  // Fade ticker out cleanly
  setTimeout(()=>{if(tickerLine)tickerLine.classList.add('fade-out');},200);
  setTimeout(()=>{if(ticker)ticker.style.display='none';},650);
  // CTA slide up — personalized: savings % + count
  const savYr=totalAll()*12;
  setTimeout(()=>{
    if(doneLabel){
      doneLabel.textContent='มี '+OPPS.length+' รายการที่ราคาคุ้มกว่า';
      doneLabel.style.cssText='font-size:15px;font-weight:700;color:#fff;text-align:center;font-family:\'IBM Plex Sans Thai\',sans-serif;margin-bottom:4px;';
    }
    if(doneDesc){
      doneDesc.textContent='ประหยัดได้ '+(savYr>0?fmt(savYr):'—')+' / ปี';
      doneDesc.style.color='#f0b000';
    }
    if(ctaWrap)ctaWrap.classList.add('visible');
  },900);
  // Sync score to compact dial in opportunities (background)
  _unlockScore();
}

function sgCommit(){
  const gate=document.getElementById('sense-gate');
  const orbWrap=document.getElementById('sg-orb-wrap');
  if(orbWrap){
    orbWrap.style.transition='transform .38s cubic-bezier(.4,0,.2,1),opacity .3s ease';
    orbWrap.style.transform='translate(-80px,-160px) scale(.28)';
    orbWrap.style.opacity='0';
  }
  setTimeout(()=>{
    if(gate)gate.classList.add('sg-exit');
    showScreen('opportunities');
    // Render opportunities with senseActivated=true so compact header shows
    renderOpps();
    // v202b: mute AFTER renderOpps (element now exists) and SYNCHRONOUSLY
    // so browser never paints an un-muted frame
    const _oppListEl=document.getElementById('opplist');
    if(_oppListEl&&!footerUnlocked)_oppListEl.classList.add('opplist-muted');
    _scheduleOppReveal();
    // Pulse plan selector to guide user's next action
    setTimeout(()=>{
      const planSel=document.querySelector('.plan-selector');
      if(planSel){
        planSel.classList.add('plan-pulse');
        planSel.addEventListener('animationend',(e)=>{
          if(e.animationName==='plan-sel-pulse')planSel.classList.remove('plan-pulse');
        },{once:true});
      }
      // Re-assert mute after plan-pulse (belt-and-suspenders)
      const oppList=document.getElementById('opplist');
      if(oppList&&!footerUnlocked)oppList.classList.add('opplist-muted');
    },420);
  },300);
  setTimeout(()=>{
    if(gate){gate.style.display='none';gate.classList.remove('sg-exit');}
    if(orbWrap){orbWrap.style.transform='';orbWrap.style.opacity='';}
  },650);
}

function _scheduleOppReveal(){
  // Stagger animate first 8 items in opplist
  setTimeout(()=>{
    const items=document.querySelectorAll('#opplist .pb-cat-group, #opplist .opp-card');
    items.forEach((el,i)=>{
      if(i<8){el.classList.add('opp-reveal');el.style.animationDelay=`${i*55}ms`;}
    });
    setTimeout(()=>{items.forEach(el=>el.classList.remove('opp-reveal'));},1200);
  },350);
}

function toggleScoreTooltip(){
  const tt=document.getElementById('score-tooltip');
  const btn=document.getElementById('score-info-btn');
  if(!tt)return;
  const on=tt.classList.toggle('on');
  if(btn){btn.classList.toggle('active-info',on);}  if(on){
    // Inject personalized "ทำไมไม่ 100?" content
    const whyEl=document.getElementById('st-why-txt');
    if(whyEl){
      const savPct=curSpend()>0?totalAll()/curSpend()*100:0;
      const nOpps=OPPS.length;
      const savAmt=totalAll();
      if(nOpps>0&&savAmt>0){
        whyEl.innerHTML=`Sense สแกนแล้วพบ <strong style="color:#fff">${nOpps} รายการ</strong> วัตถุดิบที่มีราคาคุ้มกว่าใน catalog Freshket — ประหยัดได้ <strong style="color:var(--amb)">${fmt(savAmt)}/เดือน</strong> หรือ <strong style="color:var(--amb)">${fmt(savAmt*12)}/ปี</strong><br><span style="font-size:11px;color:rgba(255,255,255,.45);margin-top:4px;display:block">Score สูง = พอร์ตเรียบร้อยดีแล้ว · Score ต่ำ = Sense เจอวัตถุดิบราคาคุ้มกว่ามาก</span>`;
      }else{
        whyEl.textContent='ยังไม่มีข้อมูลวิเคราะห์ SKU — อัปโหลด alternatives.json เพื่อดูโอกาสประหยัด';
      }
    }
    tt.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
}

function toggleSsbTooltip(){
  const tt=document.getElementById('ssb-tooltip');
  if(!tt)return;
  const on=tt.classList.toggle('on');
  if(on)setTimeout(()=>tt.scrollIntoView({behavior:'smooth',block:'nearest'}),50);
}


// ════════════════════════════════════════
// ยืนยันแผน
// ════════════════════════════════════════

