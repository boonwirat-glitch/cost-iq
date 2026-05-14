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

  const ORCH_VERSION = 'v155-phase6-1-stabilized-loader';
  const FOREGROUND = ['portview','history','categories','sku_current','outlets'];
  const BACKGROUND = ['skus','alternatives'];
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

  async function fetchCloudflareFile(spec, opts){
    opts = opts || {};
    const force = !!opts.force;
    const cacheOverride = opts.cacheOverride;
    if(!spec || !spec.tab) return false;
    const tab = spec.tab;
    const inFlight = getInFlight();

    if(!force && isLoaded(tab)) return true;
    if(!force && inFlight[tab]) return inFlight[tab];

    const p = (async function(){
      record('_fetchCloudflareFile', 'start', { tab, force, heavy: !!spec.heavy });
      const dot = document.getElementById('sp-' + tab);
      if(dot) dot.style.background = 'rgba(38,96,200,.12)';
      try{
        let text = null;
        const useCache = (cacheOverride !== undefined) ? cacheOverride : !!spec.cache;
        if(useCache){
          const cached = await baseData.csvCacheGet(tab);
          if(cached && cached.ts && (Date.now() - cached.ts) < getTtl()) text = cached.text;
        }
        if(!text){
          const files = getFiles();
          const url = `${getBase()}/${files[tab] || tab + '.csv'}`;
          text = await baseData.fetchTextWithTimeout(url, fetchTimeout(spec));
          if(useCache) baseData.csvCacheSet(tab, text);
        }
        const ok = await ingestCSVText(spec.type, text, { timeoutMs: ingestTimeout(spec) });
        if(ok){
          markLoaded(tab);
          if(dot){ dot.style.background = 'rgba(0,208,112,.18)'; dot.style.color = 'var(--g700)'; }
          record('_fetchCloudflareFile', 'done', { tab, ok:true });
        }else{
          if(dot){ dot.style.background = 'rgba(240,80,0,.12)'; dot.style.color = 'var(--org)'; }
          record('_fetchCloudflareFile', 'done', { tab, ok:false });
        }
        return !!ok;
      }catch(err){
        if(dot){ dot.style.background = 'rgba(240,80,0,.12)'; dot.style.color = 'var(--org)'; }
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
    baseData.setDataPillText('SKU + ทางเลือก','');

    let pillReleased = false;
    let finished = false;
    const releaseTimer = setTimeout(function(){
      try{ if(finished || token !== _cloudLoadToken) return; }catch(e){ if(finished) return; }
      pillReleased = true;
      orchStatus.backgroundReleased = true;
      baseData.finishDataPill('โหลดต่อเบื้องหลัง',1000);
      safeToast('กำลังโหลด SKU + ทางเลือกต่อเบื้องหลัง','⟳');
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
        safeToast('ข้อมูล Sense พร้อมแล้ว','✓');
      }else{
        if(!pillReleased) baseData.finishDataPill('ข้อมูลหลักพร้อมแล้ว',1400);
        safeToast('ข้อมูลหลักพร้อม แต่ SKU/ทางเลือกยังไม่ครบ — กด Refresh data ได้','⚠');
      }
      try{ if(typeof updateDataStatus === 'function') updateDataStatus(); }catch(e){}
      try{ if(typeof updateMatcherPreStatus === 'function') updateMatcherPreStatus(); }catch(e){}
      record('_startCloudBackgroundLoad', 'done', { okCount, total: BACKGROUND.length });
      return results;
    }).catch(function(err){
      try{ if(token === _cloudLoadToken){
        finished = true; clearTimeout(releaseTimer);
        if(!pillReleased) baseData.finishDataPill('ข้อมูลหลักพร้อมแล้ว',1400);
        safeToast('โหลด SKU/ทางเลือกไม่สำเร็จ — กด Refresh data','⚠');
        safeWarn('[Cloudflare background]', err);
      }}catch(e){}
      recordError('_startCloudBackgroundLoad', err);
      return [false,false];
    }).finally(function(){
      try{ if(token === _cloudLoadToken) _cloudBackgroundPromise = null; }catch(e){}
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

    record('loadFromCloudflareR2', 'start', { token });
    const btn = document.getElementById('sheets-load-btn');
    const counter = document.getElementById('sheets-loaded-count');
    if(btn){ btn.disabled = true; btn.textContent = 'กำลังโหลด...'; }
    baseData.resetDataPill();
    baseData.prepareProgressChips(ALL, ALL.length, getSpecs());
    baseData.setDataPillText('โหลดข้อมูลหลัก','0/' + FOREGROUND.length);

    const p = (async function(){
      let loaded = 0;
      const specs = getSpecs();
      const fgResults = await Promise.all(FOREGROUND.map(async function(key, idx){
        const ok = await fetchCloudflareFile(specs[key], { force:false });
        try{ if(token !== _cloudLoadToken) return ok; }catch(e){}
        if(ok){ loaded++; baseData.markForegroundPillDot(idx); }
        if(counter) counter.textContent = loaded + '/' + ALL.length;
        baseData.setDataPillText('โหลดข้อมูลหลัก', loaded + '/' + FOREGROUND.length);
        return ok;
      }));
      try{ if(token !== _cloudLoadToken) return; }catch(e){}
      const fgOk = fgResults.filter(Boolean).length;
      orchStatus.foregroundLoaded = fgOk;
      if(btn){ btn.disabled = false; btn.textContent = 'Refresh data'; }
      if(fgOk > 0){
        safeToast('พร้อมใช้งาน — ข้อมูลหลัก ' + fgOk + '/' + FOREGROUND.length + ' ไฟล์','✓');
        try{ if(typeof renderPortview === 'function') renderPortview(); }catch(e){}
        try{ if(typeof renderTeamview === 'function' && document.getElementById('scr-teamview')?.classList.contains('on')) renderTeamview(); }catch(e){}
      }else{
        safeToast('โหลดข้อมูลหลักไม่สำเร็จ — กด Refresh data','⚠');
      }
      try{ if(typeof updateDataStatus === 'function') updateDataStatus(); }catch(e){}
      try{ if(typeof updateMatcherPreStatus === 'function') updateMatcherPreStatus(); }catch(e){}
      startCloudBackgroundLoad({ token, fgLoaded:fgOk, total:ALL.length });
      record('loadFromCloudflareR2', 'done', { foregroundOk: fgOk, totalForeground: FOREGROUND.length });
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
