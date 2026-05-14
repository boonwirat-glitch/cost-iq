// Phase 5 data runtime boundary for Freshket Sense.
// This phase moves low-risk loader helpers into runtime-owned implementations:
// IndexedDB CSV cache, fetch-with-timeout, and data-pill DOM helpers.
// The orchestration flow still remains legacy-compatible to avoid regressions.
(function(global){
  'use strict';

  const runtime = global.FreshketSenseRuntime || {};
  if(!global.FreshketSenseRuntime) global.FreshketSenseRuntime = runtime;

  const DATA_RUNTIME_VERSION = 'v155-phase5.1-audit-patch';
  const FOREGROUND_KEYS = ['portview','history','categories','sku_current','outlets'];
  const BACKGROUND_KEYS = ['skus','alternatives'];
  const ALL_KEYS = FOREGROUND_KEYS.concat(BACKGROUND_KEYS);

  const CSV_DB = 'ciq-csv-v1';
  const CSV_TTL = 6 * 60 * 60 * 1000; // 6 hours
  const R2_BASE = 'https://pub-12078d17646340808024e8cc95504995.r2.dev';
  const R2_FILES = Object.freeze({
    portview:'portview.csv',
    history:'bulk_history.csv',
    categories:'bulk_categories.csv',
    sku_current:'bulk_sku_current.csv',
    outlets:'bulk_outlets.csv',
    skus:'bulk_skus.csv',
    alternatives:'bulk_alternatives.csv'
  });
  const R2_SPECS = Object.freeze({
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

  async function csvCacheSet(tab, text){
    const start = now();
    try{
      const db = await csvOpen();
      return new Promise(res=>{
        const tx = db.transaction('csv','readwrite');
        tx.objectStore('csv').put({ text, ts: now() }, tab);
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
