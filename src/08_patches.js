// Freshket Sense — Consolidated Patch Scripts
// v206e through v213f, in original document order.
// Structural consolidation only — logic unchanged, IIFEs preserved.
// Deep inline into core to follow in future sessions per-patch.


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v206e-bundle-micro-patch
//////////////////////////////////////////////////////////////////////////////

// v206e: TL/KAM account-level bundle micro-state.
// Goal: account page opens immediately; SKU/Sense sections clearly show loading/retry
// when a TL opens an account before that KAM bundle is ready. Avoid silent heavy bulk
// fallback for TL/Admin/PWA unless the user explicitly retries through app logic later.
(function(global){
  'use strict';
  if(global._v206eBundleMicroPatchInstalled) return;
  global._v206eBundleMicroPatchInstalled = true;

  const VERSION = 'v206e-bundle-demand-state';
  const TIMEOUT_MS = 30000;
  const state = {
    failures: {},          // safeKey -> {ts, message}
    loadingAccounts: {},   // accountId -> true
    lastPaintedAccountId: null,
    installedAt: Date.now(),
  };

  function debug(){
    try{return localStorage.getItem('senseDebug')==='1'||localStorage.getItem('freshket_debug')==='1';}
    catch(e){return false;}
  }
  function log(){try{if(debug())console.log.apply(console,arguments);}catch(e){}}
  function warn(){try{if(debug())console.warn.apply(console,arguments);}catch(e){}}
  function role(){try{return (currentUserProfile&&currentUserProfile.role)||'rep';}catch(e){return 'rep';}}
  function isStandalonePwa(){
    try{return (global.matchMedia&&global.matchMedia('(display-mode: standalone)').matches)||global.navigator.standalone===true;}
    catch(e){return false;}
  }
  function toast(msg,icon){try{if(typeof showToast==='function')showToast(msg,icon||'⟳');}catch(e){}}
  function aidOf(accountId){
    try{return String(accountId || currentAccountId || (D&&D.meta&&D.meta.accountId) || '');}
    catch(e){return String(accountId||'');}
  }
  function safeKey(email){
    try{if(typeof _kamSafeKey==='function')return _kamSafeKey(email);}
    catch(e){}
    return (email||'').toLowerCase().replace(/[^a-z0-9]/g,'_');
  }
  function getKamEmail(accountId){
    const aid = aidOf(accountId);
    if(!aid) return null;
    try{
      if(typeof _getKamEmailForAccount==='function'){
        const e = _getKamEmailForAccount(aid);
        if(e) return e;
      }
    }catch(e){}
    try{
      const row = (portviewBulkData||[]).find(r=>String(r.id)===String(aid));
      if(row && row.kamEmail) return row.kamEmail;
    }catch(e){}
    try{
      if(role()!=='tl'&&role()!=='admin'&&currentUser&&currentUser.email) return currentUser.email;
    }catch(e){}
    return null;
  }
  function accountHasSkuData(accountId){
    const aid = aidOf(accountId);
    if(!aid) return false;
    let hasSkus=false, hasAlts=false;
    try{hasSkus = !!(bulkSkusData && bulkSkusData[aid]);}catch(e){}
    try{hasAlts = !!(bulkAltsReady || (bulkAltsUnverified && bulkAltsUnverified[aid]));}catch(e){}
    return !!(hasSkus && hasAlts);
  }
  function getBundleState(accountId){
    const aid = aidOf(accountId);
    const kamEmail = getKamEmail(aid);
    const sk = safeKey(kamEmail||'');
    let loaded=false, inflight=false;
    try{loaded = !!(sk && _kamBundleLoaded && _kamBundleLoaded.has(sk));}catch(e){}
    try{inflight = !!(sk && _kamBundleInFlight && _kamBundleInFlight[sk]);}catch(e){}
    const ready = accountHasSkuData(aid);
    const loading = !!(state.loadingAccounts[aid] || inflight);
    const failed = !!(sk && state.failures[sk]);
    const status = ready ? 'ready' : loading ? 'loading' : failed ? 'failed' : 'pending';
    return { aid, kamEmail, safeKey:sk, ready, loaded, loading, failed, status, failure:sk?state.failures[sk]:null };
  }
  function cardHtml(st){
    const isFail = st.status === 'failed';
    const isPending = st.status === 'pending';
    const title = isFail ? 'โหลด SKU detail ไม่สำเร็จ' : isPending ? 'SKU intelligence ยังไม่พร้อม' : 'กำลังโหลด SKU intelligence...';
    const body = isFail
      ? 'เปิดหน้า account ได้ปกติ แต่ Sense / SKU Verify ต้องใช้ bundle ของ KAM นี้ก่อน ระบบยังไม่โหลด bulk ใหญ่เพื่อกัน PWA หน่วง'
      : isPending
        ? 'หน้า account เปิดได้ก่อน ส่วน SKU Signals / Sense / SKU Verify จะโหลดตาม demand เมื่อเริ่มใช้งาน'
        : 'เปิดหน้า account ได้ก่อน กำลังเติม SKU Signals / Sense / SKU Verify เฉพาะ KAM นี้อยู่เบื้องหลัง';
    const icon = isFail ? '⚠' : '⟳';
    const color = isFail ? 'rgba(240,176,0,.9)' : 'rgba(120,180,255,.95)';
    const border = isFail ? 'rgba(240,176,0,.28)' : 'rgba(100,170,255,.24)';
    const bg = isFail ? 'rgba(240,176,0,.07)' : 'rgba(38,96,200,.10)';
    const retry = isFail || isPending ? `<button type="button" onclick="window._v206eRetryCurrentBundle && window._v206eRetryCurrentBundle()" style="margin-top:9px;padding:7px 12px;border-radius:9px;border:1px solid ${border};background:rgba(255,255,255,.06);color:${color};font-family:'IBM Plex Sans Thai',sans-serif;font-size:11px;font-weight:700;cursor:pointer">${isFail?'Retry SKU intelligence':'โหลดตอนนี้'}</button>` : '';
    return `<div id="kam-bundle-state-card" class="kam-dc" style="margin-bottom:12px;border-color:${border};background:${bg}">
      <div class="kam-dc-head" style="border-bottom-color:rgba(255,255,255,.06)"><span class="kam-dc-head-label" style="color:${color}">${icon} ${title}</span></div>
      <div class="kam-dc-body" style="font-size:12px;color:rgba(220,235,255,.82);line-height:1.65">${body}${retry}</div>
    </div>`;
  }
  function updateDeepButtons(st){
    try{
      const ready = st && st.ready;
      ['sku-verify-tm-btn','sku-verify-lm-btn'].forEach(id=>{
        const b=document.getElementById(id);
        if(!b) return;
        if(ready){
          b.disabled=false;
          b.style.opacity='';
          b.title='';
          return;
        }
        b.disabled = st.status === 'loading';
        b.style.opacity = st.status === 'loading' ? '.62' : '.86';
        b.title = st.status === 'failed' ? 'Retry ผ่านการ์ด SKU intelligence ด้านบน' : 'กำลังโหลด SKU intelligence ของ KAM นี้';
        if(st.status === 'loading'){
          b.className='sku-verify-btn loading';
          b.innerHTML='<svg class="svb-icon" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg>โหลด SKU...';
        }
      });
    }catch(e){}
  }
  function paint(accountId){
    const aid = aidOf(accountId);
    if(!aid) return;
    const st = getBundleState(aid);
    state.lastPaintedAccountId = aid;
    const cards = document.getElementById('kam-cards');
    if(!cards) return;
    const old = document.getElementById('kam-bundle-state-card');
    if(st.ready){
      if(old) old.remove();
      updateDeepButtons(st);
      return;
    }
    const html = cardHtml(st);
    if(old) old.outerHTML = html;
    else cards.insertAdjacentHTML('afterbegin', html);
    updateDeepButtons(st);
  }
  async function fetchAccountBundle(accountId, opts){
    opts = opts || {};
    const aid = aidOf(accountId);
    if(!aid) return false;
    if(accountHasSkuData(aid)) { paint(aid); return true; }
    const st = getBundleState(aid);
    if(!st.kamEmail){
      warn('[v206e] no kamEmail for account bundle', aid);
      return false;
    }
    try{ delete state.failures[st.safeKey]; }catch(e){}
    state.loadingAccounts[aid] = true;
    paint(aid);
    let ok = false;
    try{
      const p = (typeof _kamBundleInFlight !== 'undefined' && _kamBundleInFlight[st.safeKey])
        ? _kamBundleInFlight[st.safeKey]
        : (typeof _fetchKamBundle === 'function' ? _fetchKamBundle(st.kamEmail) : Promise.resolve(false));
      ok = await Promise.race([p, new Promise(r=>setTimeout(()=>r(false), opts.timeoutMs || TIMEOUT_MS))]);
    }catch(e){
      ok = false;
      state.failures[st.safeKey] = { ts:Date.now(), message:e&&e.message?e.message:String(e) };
    }finally{
      delete state.loadingAccounts[aid];
    }
    if(ok){
      try{ delete state.failures[st.safeKey]; }catch(e){}
      try{
        if(String(currentAccountId||'')===String(aid)){
          if(typeof loadFromStorage==='function') loadFromStorage(aid);
          if(D&&D.alts&&D.alts.length&&D.skus&&D.skus.length&&typeof computeOPPS==='function') computeOPPS();
        }
      }catch(e){}
      paint(aid);
      if(String(currentAccountId||'')===String(aid) && opts.rerender!==false){
        setTimeout(()=>{
          try{
            if(typeof currentKamSubtab !== 'undefined' && currentKamSubtab === 'lastmonth' && typeof renderKamLastMonth==='function') renderKamLastMonth();
            else if(typeof renderKamThisMonth==='function') renderKamThisMonth();
          }catch(e){}
        }, opts.renderDelay || 260);
      }
      log('[v206e] bundle ready for account', aid, st.kamEmail);
      return true;
    }
    state.failures[st.safeKey] = state.failures[st.safeKey] || { ts:Date.now(), message:'bundle fetch failed or timed out' };
    paint(aid);
    log('[v206e] bundle failed for account', aid, st.kamEmail);
    return false;
  }
  async function ensureForDeepFlow(label){
    const aid = aidOf();
    if(!aid) return false;
    if(accountHasSkuData(aid)) return true;
    toast('กำลังโหลด SKU intelligence ของ KAM นี้...','⟳');
    const ok = await fetchAccountBundle(aid, { reason:label, rerender:true });
    if(!ok){
      toast('โหลด SKU detail ไม่สำเร็จ — กด Retry ได้ในการ์ดด้านบน','⚠');
      return false;
    }
    return true;
  }

  global._v206eRetryCurrentBundle = function(){
    const aid = aidOf();
    if(!aid) return;
    try{
      const st = getBundleState(aid);
      if(st.safeKey) delete state.failures[st.safeKey];
    }catch(e){}
    fetchAccountBundle(aid, { reason:'manual-retry', rerender:true });
  };
  global.getFreshketV206eBundleState = function(accountId){ return Object.assign({ version:VERSION }, getBundleState(accountId)); };

  const origEnsure = global.ensureSenseData;
  global.ensureSenseData = async function(accountId, opts){
    const aid = aidOf(accountId);
    const options = opts || {};
    if(!aid) return false;
    if(accountHasSkuData(aid)) return true;
    const st = getBundleState(aid);
    if(st.kamEmail){
      const ok = await fetchAccountBundle(aid, { reason:'ensureSenseData', rerender:!options.silent });
      if(ok){
        try{ if(!options.silent && typeof refreshAll==='function'){ refreshAll(); if(typeof updateDataStatus==='function') updateDataStatus(); } }catch(e){}
        try{ if(typeof updateMatcherPreStatus==='function') updateMatcherPreStatus(); }catch(e){}
        return true;
      }
      // For TL/Admin and installed/mobile PWA, avoid silently pulling the heavy bulk files.
      if(role()==='tl' || role()==='admin' || isStandalonePwa()) return false;
    }
    if(typeof origEnsure === 'function') return origEnsure.apply(this, arguments);
    return false;
  };
  try{ ensureSenseData = global.ensureSenseData; }catch(e){}

  const origPortviewSelect = global.portviewSelectAccount;
  if(typeof origPortviewSelect === 'function'){
    global.portviewSelectAccount = function(accountId){
      const aid = aidOf(accountId);
      try{ fetchAccountBundle(aid, { reason:'account-enter-prefetch', rerender:false }); }catch(e){}
      const ret = origPortviewSelect.apply(this, arguments);
      setTimeout(()=>paint(aid), 380);
      setTimeout(()=>paint(aid), 900);
      return ret;
    };
    try{ portviewSelectAccount = global.portviewSelectAccount; }catch(e){}
  }

  const origRenderThis = global.renderKamThisMonth;
  if(typeof origRenderThis === 'function'){
    global.renderKamThisMonth = function(){
      const ret = origRenderThis.apply(this, arguments);
      setTimeout(()=>paint(), 0);
      return ret;
    };
    try{ renderKamThisMonth = global.renderKamThisMonth; }catch(e){}
  }
  const origRenderLast = global.renderKamLastMonth;
  if(typeof origRenderLast === 'function'){
    global.renderKamLastMonth = function(){
      const ret = origRenderLast.apply(this, arguments);
      setTimeout(()=>paint(), 0);
      return ret;
    };
    try{ renderKamLastMonth = global.renderKamLastMonth; }catch(e){}
  }
  const origRenderOverview = global.renderKamOverview;
  if(typeof origRenderOverview === 'function'){
    global.renderKamOverview = function(){
      const ret = origRenderOverview.apply(this, arguments);
      setTimeout(()=>paint(), 30);
      return ret;
    };
    try{ renderKamOverview = global.renderKamOverview; }catch(e){}
  }

  function wrapDeepAction(name, label){
    const orig = global[name];
    if(typeof orig !== 'function') return;
    global[name] = async function(){
      const ok = await ensureForDeepFlow(label || name);
      if(!ok) return;
      return orig.apply(this, arguments);
    };
    try{ eval(name + ' = global[name]'); }catch(e){}
  }
  wrapDeepAction('triggerSkuVerifyFromThisMonth','SKU Verify');
  wrapDeepAction('triggerSkuVerifyLastMonth','SKU Verify');
  wrapDeepAction('generateKamBriefing','Brief');

  // Paint once after late target/hydration hooks settle.
  setTimeout(()=>paint(), 1200);
  log('[v206e] bundle micro patch installed');
})(window);


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v206f-pwa-resume-patch
//////////////////////////////////////////////////////////////////////////////

// v206f: Installed PWA live-update + resume data repair.
// Scope: no business logic, no SQL, no AI changes.
(function(global){
  'use strict';
  if(global._v206fPwaResumePatchInstalled) return;
  global._v206fPwaResumePatchInstalled = true;

  const VERSION = 'v206f-pwa-resume-repair';
  const BUILD_RE = /Freshket Sense\s+v(\d+[a-z]?)/i;
  const BUILD_STORAGE_KEY = 'freshket_sense_build_version';
  const LAST_RELOAD_KEY = 'freshket_sense_last_build_reload';
  let resumeRepairTimer = null;
  let buildCheckInFlight = null;
  let dataRepairInFlight = null;

  function debugOn(){
    try{return localStorage.getItem('senseDebug')==='1' || localStorage.getItem('freshketDebug')==='1';}catch(e){return false;}
  }
  function log(){ if(debugOn()) try{ console.log.apply(console, ['[v206f pwa]'].concat([].slice.call(arguments))); }catch(e){} }
  function warn(){ try{ console.warn.apply(console, ['[v206f pwa]'].concat([].slice.call(arguments))); }catch(e){} }
  function isStandalonePwa(){
    try{return !!(global.matchMedia&&global.matchMedia('(display-mode: standalone)').matches) || !!navigator.standalone;}catch(e){return false;}
  }
  function now(){ return Date.now ? Date.now() : +new Date(); }
  function safeCount(obj){ try{return obj ? Object.keys(obj).length : 0;}catch(e){return 0;} }
  function pvCount(){ try{return Array.isArray(global.portviewBulkData) ? global.portviewBulkData.length : 0;}catch(e){return 0;} }
  function cmCount(){ try{return safeCount(global.bulkCurrentMonthData);}catch(e){return 0;} }
  function histCount(){ try{return safeCount(global.bulkHistoryData);}catch(e){return 0;} }
  function isLoggedIn(){ try{return !!global.currentUser;}catch(e){return false;} }
  function role(){ try{return (global.currentUserProfile&&global.currentUserProfile.role||'').toLowerCase();}catch(e){return '';} }
  function onPortfolioSurface(){
    try{
      return !!(document.getElementById('scr-portview')?.classList.contains('on') || document.getElementById('scr-teamview')?.classList.contains('on'));
    }catch(e){return false;}
  }
  function criticalReady(){
    const pv = pvCount();
    const cm = cmCount();
    // portview parse builds bulkCurrentMonthData from the same file. If pv exists but cm is empty,
    // runtime is very likely in a stale/resumed partial state.
    return pv > 0 && cm > 0;
  }
  function getBuildFromHtml(txt){
    try{ const m = String(txt||'').match(BUILD_RE); return m ? ('v'+m[1]) : null; }catch(e){return null;}
  }
  function currentBuild(){
    try{
      const cfg=global.FreshketSenseConfig||{};
      const v=cfg.app&&cfg.app.version;
      const m=String(v||'').match(/v\d+[a-z]?/i);
      if(m) return m[0].toLowerCase();
    }catch(e){}
    try{
      const c=(document.documentElement&&document.documentElement.innerHTML||'').match(/Freshket Sense\s+v(\d+[a-z]?)/i);
      if(c) return ('v'+c[1]).toLowerCase();
    }catch(e){}
    return 'v207d';
  }

  function markBuild(){
    try{
      const prev=localStorage.getItem(BUILD_STORAGE_KEY);
      if(prev && prev!==currentBuild()) sessionStorage.setItem('freshket_build_changed_this_session','1');
      localStorage.setItem(BUILD_STORAGE_KEY,currentBuild());
    }catch(e){}
  }
  markBuild();

  async function askWaitingServiceWorkerToActivate(reg){
    try{
      if(reg&&reg.waiting) reg.waiting.postMessage({type:'SKIP_WAITING', source:'freshket-sense', version:VERSION});
    }catch(e){}
  }

  function installServiceWorkerUpdateGuard(){
    if(!('serviceWorker' in navigator)) return;
    try{
      navigator.serviceWorker.ready.then(function(reg){
        try{ reg.update && reg.update(); }catch(e){}
        askWaitingServiceWorkerToActivate(reg);
        try{
          reg.addEventListener('updatefound', function(){
            const sw = reg.installing;
            if(!sw) return;
            sw.addEventListener('statechange', function(){
              if(sw.state === 'installed' && navigator.serviceWorker.controller){
                try{ sw.postMessage({type:'SKIP_WAITING', source:'freshket-sense', version:VERSION}); }catch(e){}
              }
            });
          });
        }catch(e){}
      }).catch(function(){});
      navigator.serviceWorker.addEventListener('controllerchange', function(){
        // v215 NEUTRALIZED — duplicate SW reload handler.
        // Reason: earlier handler at line ~5088 already reloads once on controllerchange with
        //         its own sessionStorage guard. Having a second handler with a different guard
        //         key meant a second reload could fire mid-boot if the first guard was cleared
        //         (e.g., sessionStorage cleared by browser on PWA kill). Single owner is safer.
        try{ console.info('[Sense v215] duplicate SW controllerchange handler neutralized'); }catch(e){}
        return;
        // ── original body below kept for forensic reference only; never executed ──
        // Existing older handler may also reload. Keep a separate short-lived guard to prevent loops.
        try{
          if(sessionStorage.getItem('freshket_sw_controller_reloaded_v206f')) return;
          sessionStorage.setItem('freshket_sw_controller_reloaded_v206f', String(now()));
        }catch(e){}
        setTimeout(function(){ try{ location.reload(); }catch(e){} }, 160);
      });
    }catch(e){}
  }
  installServiceWorkerUpdateGuard();

  async function checkRemoteBuild(reason){
    // v207c: live reload is useful for installed PWA, but harmful on desktop while testing/Sense flow.
    // Desktop can refresh manually; avoid forced reload/login loops caused by stale build token mismatch.
    if(!isStandalonePwa()) return currentBuild();
    try{
      if(global._senseFlowHeavyActive===true || document.body.classList.contains('kam-sense-active')){
        log('build-check deferred during Sense flow', reason);
        return currentBuild();
      }
    }catch(e){}
    if(buildCheckInFlight) return buildCheckInFlight;
    buildCheckInFlight = (async function(){
      try{
        // Only check on launch/resume. While the app is active, avoid surprise reloads.
        const url = location.origin + location.pathname + '?__sense_build_check=' + now();
        const res = await fetch(url, {cache:'no-store', credentials:'same-origin'});
        if(!res || !res.ok) return null;
        const txt = await res.text();
        const remote = getBuildFromHtml(txt);
        const local = currentBuild();
        log('build-check', {reason, local, remote});
        if(remote && remote !== local){
          const last = Number(sessionStorage.getItem(LAST_RELOAD_KEY)||0);
          if(now() - last > 12000){
            sessionStorage.setItem(LAST_RELOAD_KEY, String(now()));
            // Force a network navigation and avoid reusing stale in-memory PWA state.
            const next = location.origin + location.pathname + '?__sense_reload=' + encodeURIComponent(remote) + '&t=' + now() + location.hash;
            warn('new build detected; reloading', {local, remote, reason});
            location.replace(next);
          }
        }
        return remote;
      }catch(e){ log('build-check skipped', reason, e&&e.message?e.message:e); return null; }
      finally{ buildCheckInFlight = null; }
    })();
    return buildCheckInFlight;
  }

  async function repairCriticalData(reason, opts){
    opts = opts || {};
    if(dataRepairInFlight) return dataRepairInFlight;
    dataRepairInFlight = (async function(){
      try{
        if(!isLoggedIn()) return false;
        const pv = pvCount(), cm = cmCount(), hist = histCount();
        const force = !!opts.force;
        const loading = !!global.sheetsLoadStarted;
        const initialInFlight = !!global._cloudInitialPromise;
        const needsRepair = force || !criticalReady() || (loading && !initialInFlight && pv===0);
        log('data-sanity', {reason, force, pv, cm, hist, loading, initialInFlight, needsRepair, role:role()});
        if(!needsRepair) return false;
        // Do not run multiple loaders on top of each other. If a real initial load is active, let it finish.
        if(initialInFlight) return false;
        try{ global.sheetsLoadStarted = false; }catch(e){}
        try{ global._cloudInitialPromise = null; }catch(e){}
        try{ global._cloudBackgroundPromise = null; }catch(e){}
        try{ if(global._clearCloudInFlight) global._clearCloudInFlight(); }catch(e){}
        try{ if(global._cloudLoadedTabs && global._cloudLoadedTabs.clear) global._cloudLoadedTabs.clear(); }catch(e){}
        try{ if(global.showToast) global.showToast('รีเฟรชข้อมูลหลังกลับเข้าแอป...','⟳'); }catch(e){}
        if(typeof global.loadFromCloudflareR2 === 'function'){
          await global.loadFromCloudflareR2();
        }else if(typeof global.loadFromGoogleSheets === 'function'){
          await global.loadFromGoogleSheets();
        }
        setTimeout(function(){
          try{
            if(onPortfolioSurface() && typeof global.renderPortview === 'function') global.renderPortview();
            if(document.getElementById('scr-teamview')?.classList.contains('on') && typeof global.renderTeamview === 'function') global.renderTeamview();
          }catch(e){}
        }, 260);
        return true;
      }catch(e){ warn('data repair failed', reason, e&&e.message?e.message:e); return false; }
      finally{ dataRepairInFlight = null; }
    })();
    return dataRepairInFlight;
  }

  function scheduleResumeRepair(reason, opts){
    opts = opts || {};
    if(resumeRepairTimer) clearTimeout(resumeRepairTimer);
    resumeRepairTimer = setTimeout(function(){
      resumeRepairTimer = null;
      checkRemoteBuild(reason);
      // PWA/Home Screen is the risky surface, but this is cheap and useful on desktop too.
      repairCriticalData(reason, opts);
    }, opts.delay == null ? 900 : opts.delay);
  }

  // v225: visibilitychange/pageshow/focus/online listeners REMOVED from v206f.
  // Replaced by ResumeCoordinator at end of 08_patches.js — single coordinator
  // for all 3 patches (v206f/v212/v212a) to prevent 3× render on every resume.

  // First-load sanity: when a new build is loaded over an old local/session state, repair once after auth/routing settles.
  setTimeout(function(){
    const changed = (function(){ try{return sessionStorage.getItem('freshket_build_changed_this_session')==='1';}catch(e){return false;} })();
    scheduleResumeRepair(changed ? 'new-build-first-load' : 'first-load-sanity', {delay: changed ? 600 : 2200, force: changed});
  }, 1200);

  global.getFreshketV206fPwaState = function(){
    return {version:VERSION, standalone:isStandalonePwa(), loggedIn:isLoggedIn(), role:role(), pvCount:pvCount(), currentMonthAccounts:cmCount(), historyAccounts:histCount(), criticalReady:criticalReady(), sheetsLoadStarted:!!global.sheetsLoadStarted, hasInitialPromise:!!global._cloudInitialPromise};
  };
})(window);


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v207-console-sku-verify-cleanup
//////////////////////////////////////////////////////////////////////////////

// v207: console hygiene + SKU Verify robustness.
// Scope: no loader/performance path changes. Keeps v206f PWA baseline intact.
(function(global){
  'use strict';
  if(global._v207ConsoleSkuPatchInstalled) return;
  global._v207ConsoleSkuPatchInstalled = true;

  const VERSION = 'v207-console-sku-verify-cleanup';

  function debugOn(){
    try{return localStorage.getItem('senseDebug')==='1' || localStorage.getItem('freshketDebug')==='1' || localStorage.getItem('freshket_debug')==='1';}
    catch(e){return false;}
  }
  function log(){ if(debugOn()) try{ console.log.apply(console, ['[v207]'].concat([].slice.call(arguments))); }catch(e){} }
  function warn(){ if(debugOn()) try{ console.warn.apply(console, ['[v207]'].concat([].slice.call(arguments))); }catch(e){} }
  function toast(msg, icon){ try{ if(typeof showToast==='function') showToast(msg, icon || '✓'); }catch(e){} }

  // ── Console hygiene: hide known noisy debug lines unless explicit debug is on ──
  try{
    if(!global._v207ConsoleFiltered){
      global._v207ConsoleFiltered = true;
      const origLog = console.log.bind(console);
      const origWarn = console.warn.bind(console);
      const shouldHide = function(args){
        if(debugOn()) return false;
        const s = Array.prototype.slice.call(args).map(x=>String(x&&x.message?x.message:x)).join(' ');
        return s.indexOf('[SenseGate debug]') >= 0 || s.indexOf('[Target Module v1] loaded') >= 0;
      };
      console.log = function(){ if(shouldHide(arguments)) return; return origLog.apply(console, arguments); };
      console.warn = function(){ if(shouldHide(arguments)) return; return origWarn.apply(console, arguments); };
    }
  }catch(e){}

  // ── Supabase no-row cleanup: 406/PGRST116 should mean "no cloud alts", not an app error ──
  try{
    loadAltsFromSupabase = async function(accountId){
      if(!currentUser || !accountId) return null;
      try{
        let q = supa.from('acct_alternatives')
          .select('data, generated_at')
          .eq('account_id', accountId);
        q = (typeof q.maybeSingle === 'function') ? q.maybeSingle() : q.limit(1);
        const { data, error } = await q;
        if(error){
          const code = error.code || '';
          const status = error.status || 0;
          if(code === 'PGRST116' || status === 406) return null;
          warn('loadAltsFromSupabase error', error.message || error);
          return null;
        }
        if(Array.isArray(data)) return data[0] || null;
        return data || null;
      }catch(e){
        warn('loadAltsFromSupabase exception', e && e.message ? e.message : e);
        return null;
      }
    };
    global.loadAltsFromSupabase = loadAltsFromSupabase;
  }catch(e){}

  // ── SKU Verify helpers ─────────────────────────────────────────────
  const TH_DIGITS = {'๐':'0','๑':'1','๒':'2','๓':'3','๔':'4','๕':'5','๖':'6','๗':'7','๘':'8','๙':'9'};
  function toAsciiDigits(s){ return String(s||'').replace(/[๐-๙]/g, d=>TH_DIGITS[d]||d); }
  function normName(s){
    return toAsciiDigits(s)
      .toLowerCase()
      .replace(/[()\[\]{}]/g,' ')
      .replace(/[·•|,:;_\-/\\]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }
  function compact(s){ return normName(s).replace(/\s+/g,''); }
  function eggKey(name){
    const n = normName(name);
    const c = compact(name);
    if(n.indexOf('ไข่') < 0 && c.indexOf('egg') < 0) return '';
    let m = n.match(/เบอร์\s*(\d+)/) || c.match(/เบอร์(\d+)/) || n.match(/no\.?\s*(\d+)/) || c.match(/no(\d+)/);
    if(m && m[1]) return 'egg:no'+m[1];
    if(c.indexOf('เบอร์หนึ่ง')>=0) return 'egg:no1';
    return 'egg:unknown';
  }
  function familyKey(name, meta){
    const e = eggKey(name);
    if(e && e !== 'egg:unknown') return e;
    const sub = normName(meta && (meta.subclass || meta.sc) || '');
    if(sub) return 'sub:'+sub;
    return '';
  }
  function tokens(name){
    return normName(name).split(' ').filter(t=>t && !/^\d+$/.test(t) && !['ตรา','brand','ยี่ห้อ'].includes(t));
  }
  function jaccard(a,b){
    const A = new Set(tokens(a)), B = new Set(tokens(b));
    if(!A.size || !B.size) return 0;
    let inter=0; A.forEach(x=>{ if(B.has(x)) inter++; });
    return inter / Math.max(1, A.size + B.size - inter);
  }
  function formConflict(a,b){
    const aa = compact(a), bb = compact(b);
    const groups = [['บด','สับ'], ['ชิ้น','แผ่น','สไลซ์'], ['ผง'], ['น้ำ'], ['แช่แข็ง','frozen']];
    for(const g of groups){
      const ha = g.some(x=>aa.indexOf(x)>=0);
      const hb = g.some(x=>bb.indexOf(x)>=0);
      if((ha || hb) && ha !== hb) return true;
    }
    return false;
  }
  function spendChange(oldGmv, newGmv){
    oldGmv = Number(oldGmv||0); newGmv = Number(newGmv||0);
    if(!oldGmv) return 'same';
    const r = newGmv / oldGmv;
    if(r >= 1.10) return 'up';
    if(r <= 0.90) return 'down';
    return 'same';
  }
  function substituteReason(pair, confidence){
    const ekA = eggKey(pair.churned_name || ''), ekB = eggKey(pair.new_name || '');
    if(ekA && ekB && ekA === ekB) return 'เป็นไข่ไก่เบอร์เดียวกัน แต่เปลี่ยนแบรนด์/ผู้ขาย จึงน่าจะเป็นการสลับ SKU';
    if(confidence === 'high') return 'สินค้าอยู่ในกลุ่มและฟังก์ชันเดียวกัน จึงน่าจะเป็นการสลับไปใช้ SKU ใหม่';
    return 'สินค้าใกล้เคียงกันในกลุ่มเดียวกัน ควรให้ KAM เช็กว่าเป็นการสลับแบรนด์หรือสเปคหรือไม่';
  }
  function pairScore(pair){
    const fkA = familyKey(pair.churned_name, {subclass:pair.churned_subclass});
    const fkB = familyKey(pair.new_name, {subclass:pair.new_subclass});
    const eggA = eggKey(pair.churned_name), eggB = eggKey(pair.new_name);
    if(formConflict(pair.churned_name, pair.new_name)) return {ok:false, score:0, confidence:'medium'};
    if(eggA && eggB && eggA === eggB) return {ok:true, score:1.0, confidence:'high'};
    if(fkA && fkB && fkA === fkB){
      const sim = jaccard(pair.churned_name, pair.new_name);
      return {ok:sim >= 0.20 || compact(pair.churned_name).slice(0,4) === compact(pair.new_name).slice(0,4), score:0.72 + sim, confidence:sim >= 0.45 ? 'high' : 'medium'};
    }
    const sim = jaccard(pair.churned_name, pair.new_name);
    return {ok:sim >= 0.55, score:sim, confidence:'medium'};
  }
  function fallbackSubstitutions(candidatePairs, mode){
    const bestByChurned = new Map();
    (candidatePairs||[]).forEach(pair=>{
      const s = pairScore(pair);
      if(!s.ok) return;
      const key = mode === 'lm' ? String(pair.churned_name) : String(pair.churned_id);
      const current = bestByChurned.get(key);
      const ranked = Object.assign({}, pair, { _score:s.score, confidence:s.confidence });
      if(!current || ranked._score > current._score || (ranked._score === current._score && (ranked.new_gmv||0) > (current.new_gmv||0))){
        bestByChurned.set(key, ranked);
      }
    });
    return Array.from(bestByChurned.values())
      .sort((a,b)=>(b._score-a._score)||((b.new_gmv||0)-(a.new_gmv||0)))
      .slice(0,8)
      .map(p=> mode === 'lm'
        ? { churned_name:p.churned_name, new_name:p.new_name, confidence:p.confidence, spend_change:spendChange(p.churned_gmv,p.new_gmv), reason:substituteReason(p,p.confidence) }
        : { churned_id:String(p.churned_id), new_name:p.new_name, confidence:p.confidence, spend_change:spendChange(p.churned_gmv,p.new_gmv), reason:substituteReason(p,p.confidence) }
      );
  }
  function parseJsonObject(text){
    const clean = String(text||'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    if(!clean) return null;
    let st = clean.indexOf('{');
    if(st < 0) return null;
    let en=-1, depth=0, inStr=false, esc=false;
    for(let i=st;i<clean.length;i++){
      const ch=clean[i];
      if(esc){ esc=false; continue; }
      if(ch==='\\'){ esc=true; continue; }
      if(ch==='"'){ inStr=!inStr; continue; }
      if(inStr) continue;
      if(ch==='{') depth++;
      else if(ch==='}'){
        depth--;
        if(depth===0){ en=i; break; }
      }
    }
    if(en < 0) return null;
    try{return JSON.parse(clean.slice(st,en+1));}catch(e){return null;}
  }
  async function judgePairsWithAI(candidatePairs, mode){
    const fallback = fallbackSubstitutions(candidatePairs, mode);
    if(!candidatePairs.length) return { substitutions:[], source:'none' };
    const schema = mode === 'lm'
      ? '{"substitutions":[{"churned_name":"string","new_name":"string","confidence":"high|medium","spend_change":"up|down|same","reason":"string"}]}'
      : '{"substitutions":[{"churned_id":"string","new_name":"string","confidence":"high|medium","spend_change":"up|down|same","reason":"string"}]}';
    const sys = OLIVE_BASE + `\n\n-- TASK CONTEXT --\nYou verify whether a churned SKU and a current/new SKU are genuine substitutes. Return JSON only. Same product + same size/grade but different brand/vendor is a valid substitution. Example: egg no.1 brand A -> egg no.1 brand B should be included. Do not include different functions, formulas, flavors, or basic forms.\n\n-- OUTPUT CONTRACT --\nRESPOND WITH VALID JSON ONLY. No markdown. No preamble.\nschema: ${schema}\nIf no pair is a genuine substitution, return {"substitutions":[]}.\nReason must be one short Thai sentence for KAM.`;
    const userMsg = `Evaluate candidate SKU substitution pairs (${candidatePairs.length} pairs). Use precision, but do not miss same product/brand-switch cases.\n${JSON.stringify(candidatePairs.slice(0,80))}`;
    try{
      const txt = await callAI(kamModel==='sonnet'?'sonnet':'haiku', sys, [{role:'user', content:userMsg}], 1000);
      const parsed = parseJsonObject(txt);
      const subs = parsed && Array.isArray(parsed.substitutions) ? parsed.substitutions : null;
      if(subs){
        // If the model returns empty but deterministic evidence is high-confidence, keep the high-confidence fallback.
        const highFallback = fallback.filter(x=>x.confidence==='high');
        return { substitutions: subs.length ? subs : highFallback, source: subs.length ? 'ai' : (highFallback.length?'fallback-high':'ai-empty') };
      }
      return { substitutions:fallback, source:'fallback-no-json' };
    }catch(e){
      warn('SKU Verify AI failed; using deterministic fallback', e && e.message ? e.message : e);
      return { substitutions:fallback, source:'fallback-error' };
    }
  }
  function monthSort(label){
    const p=String(label||'').split(' ');
    const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return (parseInt(p[1]||0,10)*12)+mo.indexOf(p[0]);
  }
  function findSkuMetaByIdOrName(id, name){
    const sid = String(id||'');
    const nm = String(name||'');
    const all = [].concat((D&&D.skus)||[], Object.values((D&&D.skus_monthly)||{}).flat());
    return all.find(s=>String(s.id||s.item_id)===sid) || all.find(s=>String(s.n||s.name||s.item_name_th||'')===nm) || null;
  }
  function uniquePairs(pairs, mode){
    const seen = new Set();
    return pairs.filter(p=>{
      const key = mode==='lm' ? `${p.churned_name}=>${p.new_name}` : `${p.churned_id}=>${p.new_name}`;
      if(seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function currentPoolForThisMonth(prevMonthSkuIds){
    const rows = ((D&&D.sku_current)||[])
      .filter(s=>Number(s.gmv_to_date||0)>500)
      .sort((a,b)=>Number(b.gmv_to_date||0)-Number(a.gmv_to_date||0))
      .slice(0,80);
    return rows.map(ns=>{
      const name = ns.item_name_th || ns.n || ns.name || '';
      const meta = findSkuMetaByIdOrName(ns.item_id, name) || ns;
      return {
        item_id:String(ns.item_id||ns.id||''),
        item_name_th:name,
        gmv_to_date:Number(ns.gmv_to_date||ns.gmv||0),
        orders_this_month:Number(ns.orders_this_month||ns.orders||0),
        is_new_this_month: !prevMonthSkuIds.has(String(ns.item_id||ns.id||'')),
        subclass:meta.subclass||meta.sc||'',
        temperature:meta.temperature||meta.temp||'',
        cat:meta.d||meta.dept||meta.cat||''
      };
    });
  }
  function buildThisMonthPairs(){
    const signals = (typeof computeChurnSignals==='function' ? computeChurnSignals() : [])
      .filter(s=>s && (s.type==='gone' || s.type==='slow' || s.type==='near'))
      .sort((a,b)=>({gone:0,slow:1,near:2}[a.type]||3)-({gone:0,slow:1,near:2}[b.type]||3) || (b.gmv||0)-(a.gmv||0))
      .slice(0,35);
    const moKeys=Object.keys((D&&D.skus_monthly)||{}).sort((a,b)=>monthSort(b)-monthSort(a));
    const cmLbl=(D&&D.current_month&&D.current_month.month_label)||'';
    const prevClosed=moKeys.find(m=>m!==cmLbl)||moKeys[0];
    const prevMonthSkuIds=prevClosed?new Set(((D.skus_monthly[prevClosed])||[]).map(s=>String(s.id||s.item_id))):new Set();
    const currentPool = currentPoolForThisMonth(prevMonthSkuIds);
    const pairs=[];
    signals.forEach(s=>{
      const cMeta = findSkuMetaByIdOrName(s.id, s.name) || {};
      currentPool.forEach(ns=>{
        if(String(ns.item_id) === String(s.id)) return;
        const p = {
          churned_id:String(s.id), churned_name:s.name, churned_dept:s.dept,
          churned_subclass:cMeta.subclass||cMeta.sc||'ไม่ทราบ', churned_gmv:Number(s.gmv||0), churned_type:s.type,
          new_id:String(ns.item_id||''), new_name:ns.item_name_th||'', new_cat:ns.cat||'',
          new_subclass:ns.subclass||'ไม่ทราบ', new_gmv:Number(ns.gmv_to_date||0),
          is_new_this_month:!!ns.is_new_this_month
        };
        const sc = pairScore(p);
        const subclassCompatible = !p.churned_subclass || !p.new_subclass || p.churned_subclass==='ไม่ทราบ' || p.new_subclass==='ไม่ทราบ' || p.churned_subclass===p.new_subclass;
        if(sc.ok || subclassCompatible) pairs.push(p);
      });
    });
    return uniquePairs(pairs, 'tm')
      .sort((a,b)=>(pairScore(b).score||0)-(pairScore(a).score||0) || (b.new_gmv||0)-(a.new_gmv||0))
      .slice(0,80);
  }
  function buildLastMonthPairs(){
    const sm = typeof computeSkuMovement==='function' ? computeSkuMovement() : null;
    const dropped = (sm&&sm.droppedSkus)||[];
    const newSkus = (sm&&sm.newSkus)||[];
    const pairs=[];
    dropped.slice(0,35).forEach(d=>{
      const dMeta = findSkuMetaByIdOrName(d.id, d.name) || {};
      newSkus.slice(0,60).forEach(n=>{
        const nMeta = findSkuMetaByIdOrName(n.id, n.name) || {};
        const p = {
          churned_name:d.name, churned_dept:d.cat||'', churned_subclass:dMeta.subclass||dMeta.sc||'ไม่ทราบ', churned_gmv:Number(d.gmv||0),
          new_name:n.name, new_cat:nMeta.d||nMeta.dept||'', new_subclass:nMeta.subclass||nMeta.sc||'ไม่ทราบ', new_gmv:Number(n.gmv||0)
        };
        const sc = pairScore(p);
        const subclassCompatible = !p.churned_subclass || !p.new_subclass || p.churned_subclass==='ไม่ทราบ' || p.new_subclass==='ไม่ทราบ' || p.churned_subclass===p.new_subclass;
        if(sc.ok || subclassCompatible) pairs.push(p);
      });
    });
    return uniquePairs(pairs, 'lm')
      .sort((a,b)=>(pairScore(b).score||0)-(pairScore(a).score||0) || (b.new_gmv||0)-(a.new_gmv||0))
      .slice(0,80);
  }
  function starSvg(){ return `<svg class="svb-icon" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg>`; }
  function setBtn(id, cls, text){
    const b=document.getElementById(id); if(!b) return;
    b.disabled=false; b.style.opacity=''; b.title='';
    b.className='sku-verify-btn'+(cls?' '+cls:'');
    b.innerHTML=starSvg()+text;
  }

  triggerSkuVerifyFromThisMonth = async function(){
    if(skuSubstituteLoading) return;
    const pairs = buildThisMonthPairs();
    if(!pairs.length){
      setBtn('sku-verify-tm-btn','','ไม่พบ SKU ที่เปลี่ยน');
      setTimeout(()=>setBtn('sku-verify-tm-btn', skuSubstituteDone?'done':'', 'SKU Verify'),2500);
      return;
    }
    skuSubstituteLoading=true;
    setBtn('sku-verify-tm-btn','loading','กำลังตรวจ...');
    try{
      const judged = await judgePairsWithAI(pairs, 'tm');
      skuSubstituteMap = {};
      (judged.substitutions||[]).forEach(s=>{
        const pair = pairs.find(p=>String(p.churned_id)===String(s.churned_id) && p.new_name===s.new_name);
        if(!pair) return;
        skuSubstituteMap[String(s.churned_id)] = {
          substituteName:s.new_name,
          spendChange:s.spend_change || spendChange(pair.churned_gmv, pair.new_gmv),
          confidence:s.confidence || 'medium',
          reason:s.reason || substituteReason(pair, s.confidence||'medium'),
          kamQuestion:'',
          newGmv:pair.new_gmv || 0,
          source:judged.source
        };
      });
      skuSubstituteDone=true;
      skuSubstituteLoading=false;
      if(kamSubtab==='thismonth' && typeof renderKamThisMonth==='function') renderKamThisMonth();
      else setBtn('sku-verify-tm-btn','done','✓ SKU Verify');
      if(judged.source && judged.source.indexOf('fallback')===0) toast('SKU Verify ใช้ rule fallback แล้ว','✓');
    }catch(e){
      warn('SKU Verify unexpected error', e && e.message ? e.message : e);
      skuSubstituteLoading=false;
      setBtn('sku-verify-tm-btn','','SKU Verify');
      toast('SKU Verify ยังตรวจไม่สำเร็จ','⚠');
    }
  };
  global.triggerSkuVerifyFromThisMonth = triggerSkuVerifyFromThisMonth;

  triggerSkuVerifyLastMonth = async function(){
    if(skuSubstituteLoadingLM) return;
    const pairs = buildLastMonthPairs();
    if(!pairs.length){
      setBtn('sku-verify-lm-btn','','ไม่พบ SKU ที่เปลี่ยน');
      setTimeout(()=>setBtn('sku-verify-lm-btn', skuSubstituteDoneLM?'done':'', 'SKU Verify'),2500);
      return;
    }
    skuSubstituteLoadingLM=true;
    setBtn('sku-verify-lm-btn','loading','กำลังตรวจ...');
    try{
      const judged = await judgePairsWithAI(pairs, 'lm');
      skuSubstituteMapLM = {};
      (judged.substitutions||[]).forEach(s=>{
        const pair = pairs.find(p=>p.churned_name===s.churned_name && p.new_name===s.new_name);
        if(!pair) return;
        skuSubstituteMapLM[s.churned_name] = {
          substituteName:s.new_name,
          spendChange:s.spend_change || spendChange(pair.churned_gmv, pair.new_gmv),
          confidence:s.confidence || 'medium',
          reason:s.reason || substituteReason(pair, s.confidence||'medium'),
          newGmv:pair.new_gmv || 0,
          source:judged.source
        };
      });
      skuSubstituteDoneLM=true;
      skuSubstituteLoadingLM=false;
      if(kamSubtab==='lastmonth' && typeof renderKamLastMonth==='function') renderKamLastMonth();
      else setBtn('sku-verify-lm-btn','done','✓ SKU Verify');
      if(judged.source && judged.source.indexOf('fallback')===0) toast('SKU Verify ใช้ rule fallback แล้ว','✓');
    }catch(e){
      warn('SKU Verify LM unexpected error', e && e.message ? e.message : e);
      skuSubstituteLoadingLM=false;
      setBtn('sku-verify-lm-btn','','SKU Verify');
      toast('SKU Verify ยังตรวจไม่สำเร็จ','⚠');
    }
  };
  global.triggerSkuVerifyLastMonth = triggerSkuVerifyLastMonth;

  global.getFreshketV207SkuVerifyState = function(){
    return {
      version: VERSION,
      thisMonthPairs: buildThisMonthPairs().slice(0,20),
      lastMonthPairs: buildLastMonthPairs().slice(0,20),
      thisMonthMap: skuSubstituteMap,
      lastMonthMap: skuSubstituteMapLM,
      debug: debugOn()
    };
  };

  log('installed');
})(window);
// PATCH: freshket-v207b-sense-flow-stability-js
//////////////////////////////////////////////////////////////////////////////

(function(global){
  'use strict';
  const VERSION='v207d-sense-glass-nav-fix';
  const DEBUG_KEY='senseDebug';
  const isDebug=()=>{try{return localStorage.getItem(DEBUG_KEY)==='1';}catch(e){return false;}};
  const log=(...a)=>{if(isDebug())try{console.log.apply(console,a);}catch(e){}};
  const warn=(...a)=>{try{console.warn.apply(console,a);}catch(e){}};
  function role(){try{return (currentUserProfile&&currentUserProfile.role)||'';}catch(e){return '';}}
  function isPwa(){try{return (global.matchMedia&&global.matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;}catch(e){return false;}}
  function shouldAvoidGlobalHeavy(){const r=role();return r==='tl'||r==='admin'||isPwa()||document.body.classList.contains('kam-sense-active')||global._senseFlowHeavyActive===true;}
  function toast(msg,icon){try{if(typeof showToast==='function')showToast(msg,icon||'⟳');}catch(e){}}
  function setTopbarHeight(){
    try{
      const tb=document.querySelector('.topbar');
      const h=tb?Math.ceil(tb.getBoundingClientRect().height):0;
      if(h>40)document.documentElement.style.setProperty('--sense-topbar-h',h+'px');
      const nav=document.querySelector('.bnav');
      if(nav){
        const nh=Math.ceil(nav.getBoundingClientRect().height);
        if(nh>60){
          const expanded=document.body.classList.contains('sense-plan-expanded');
          document.documentElement.style.setProperty(expanded?'--sense-plan-tray-h':'--sense-bottom-nav-h',nh+'px');
        }
      }
    }catch(e){}
  }
  ['load','resize','orientationchange'].forEach(ev=>global.addEventListener(ev,()=>setTimeout(setTopbarHeight,80),{passive:true}));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(setTopbarHeight,80));else setTimeout(setTopbarHeight,80);
  const _mo=new MutationObserver(()=>setTimeout(setTopbarHeight,60));
  try{_mo.observe(document.body,{attributes:true,attributeFilter:['class'],childList:false,subtree:false});}catch(e){}

  // Prevent heavy global bulk files from auto-loading on TL/Admin/PWA. Sense uses per-KAM bundles.
  const origStartBg=global._startCloudBackgroundLoad;
  if(typeof origStartBg==='function'){
    global._startCloudBackgroundLoad=function(opts){
      if(shouldAvoidGlobalHeavy()){
        log('[v207b] skip global bulk SKU background load', {role:role(), pwa:isPwa(), sense:document.body.classList.contains('kam-sense-active')});
        try{if(typeof _finishDataPill==='function')_finishDataPill('ข้อมูลหลักพร้อมแล้ว',900);}catch(e){}
        return Promise.resolve([]);
      }
      return origStartBg.apply(this,arguments);
    };
    try{_startCloudBackgroundLoad=global._startCloudBackgroundLoad;}catch(e){}
  }
  const origDeferredPrice=global._startDeferredPriceLoad;
  if(typeof origDeferredPrice==='function'){
    global._startDeferredPriceLoad=function(token){
      if(shouldAvoidGlobalHeavy()){
        log('[v207b] skip deferred bulk price load', {role:role(), pwa:isPwa()});
        return Promise.resolve(false);
      }
      return origDeferredPrice.apply(this,arguments);
    };
    try{_startDeferredPriceLoad=global._startDeferredPriceLoad;}catch(e){}
  }

  // Account detail should not pull global bulk_skus for TL/Admin/PWA. Bundle handles SKU/Sense sections.
  const origEnsureAccount=global.ensureAccountDetailData;
  global.ensureAccountDetailData=async function(accountId){
    if(!accountId)return false;
    if(shouldAvoidGlobalHeavy()){
      const needed=[];
      try{if(!bulkCatsData[accountId])needed.push('categories');}catch(e){needed.push('categories');}
      try{if(!bulkSkuCurrentData[accountId])needed.push('sku_current');}catch(e){needed.push('sku_current');}
      try{if(!bulkOutletsData[accountId])needed.push('outlets');}catch(e){needed.push('outlets');}
      if(!needed.length)return true;
      try{toast('กำลังเติมข้อมูล account...','⟳');}catch(e){}
      const ok=typeof ensureCloudflareFiles==='function'?await ensureCloudflareFiles(needed,{label:'Account detail'}):false;
      try{loadFromStorage(accountId);}catch(e){}
      try{if(typeof updateDataStatus==='function')updateDataStatus();}catch(e){}
      try{if(typeof updateMatcherPreStatus==='function')updateMatcherPreStatus();}catch(e){}
      return !!ok;
    }
    return typeof origEnsureAccount==='function'?origEnsureAccount.apply(this,arguments):false;
  };
  try{ensureAccountDetailData=global.ensureAccountDetailData;}catch(e){}

  // Sequential per-KAM bundle load. It is slower by a few hundred ms, but much safer on iOS/PWA.
  const origFetchBundle=global._fetchKamBundle;
  if(typeof origFetchBundle==='function' && typeof _fetchKamFile==='function'){
    global._fetchKamBundle=async function(kamEmail){
      if(!kamEmail)return false;
      let safeKey='';
      try{safeKey=typeof _kamSafeKey==='function'?_kamSafeKey(kamEmail):(kamEmail||'').toLowerCase().replace(/[^a-z0-9]/g,'_');}catch(e){safeKey=(kamEmail||'').toLowerCase().replace(/[^a-z0-9]/g,'_');}
      try{if(_kamBundleLoaded&&_kamBundleLoaded.has(safeKey))return true;}catch(e){}
      try{if(_kamBundleInFlight&&_kamBundleInFlight[safeKey])return _kamBundleInFlight[safeKey];}catch(e){}
      const p=(async()=>{
        try{
          const base=typeof R2_BASE!=='undefined'?R2_BASE:'';
          const skusUrl=`${base}/sense_skus_${safeKey}.csv`;
          const altsUrl=`${base}/sense_alts_${safeKey}.csv`;
          log('[v207b bundle] sequential fetch start',kamEmail);
          const okSkus=await _fetchKamFile({url:skusUrl,type:'bulk-skus',tab:`bundle-skus-${safeKey}`});
          await new Promise(r=>setTimeout(r,shouldAvoidGlobalHeavy()?450:180));
          const okAlts=await _fetchKamFile({url:altsUrl,type:'bulk-alternatives',tab:`bundle-alts-${safeKey}`});
          if(okSkus&&okAlts){try{_kamBundleLoaded.add(safeKey);}catch(e){} log('[v207b bundle] ready',kamEmail);return true;}
          warn('[v207b bundle] incomplete',kamEmail,{okSkus,okAlts});
          return false;
        }catch(e){warn('[v207b bundle] error',kamEmail,e&&e.message?e.message:e);return false;}
        finally{try{delete _kamBundleInFlight[safeKey];}catch(e){}}
      })();
      try{_kamBundleInFlight[safeKey]=p;}catch(e){}
      return p;
    };
    try{_fetchKamBundle=global._fetchKamBundle;}catch(e){}
  }

  function senseDataReady(){try{return !!(D&&D.skus&&D.skus.length&&D.alts&&D.alts.length);}catch(e){return false;}}
  function setGatePrep(text,sub){
    try{
      const hint=document.getElementById('sg-tap-hint'); if(hint)hint.classList.add('hidden');
      const title=document.getElementById('sg-title'); if(title){title.style.opacity='1';title.textContent=text||'กำลังเตรียม Sense...';}
      const s=document.getElementById('sg-sub'); if(s){s.style.opacity='1';s.textContent=sub||'โหลด SKU intelligence เฉพาะ KAM นี้ก่อนเริ่มสแกน';}
      const ticker=document.getElementById('sg-ticker'); if(ticker)ticker.style.display='block';
      const line=document.querySelector('#sg-ticker .sg-ticker-line'); if(line)line.innerHTML='กำลังเตรียมข้อมูล<span class="sg-ticker-dot"></span><span class="sg-ticker-dot"></span><span class="sg-ticker-dot"></span>';
      const svg=document.getElementById('sg-ring-svg'); if(svg)svg.classList.add('thinking');
    }catch(e){}
  }
  function clearGatePrep(){
    try{const ticker=document.getElementById('sg-ticker'); if(ticker)ticker.style.display='none';}catch(e){}
  }
  const origSgOrb=global.sgOrbTap;
  if(typeof origSgOrb==='function'){
    global.sgOrbTap=async function(){
      try{if(global._senseFlowPreflightRunning)return;}catch(e){}
      if(senseDataReady())return origSgOrb.apply(this,arguments);
      global._senseFlowPreflightRunning=true;
      global._senseFlowHeavyActive=true;
      setGatePrep('กำลังเตรียม Sense...', 'โหลด SKU intelligence เฉพาะ KAM นี้ก่อนเริ่มสแกน');
      try{
        const ok=typeof ensureSenseData==='function'?await ensureSenseData(currentAccountId,{silent:true,preflight:true}):false;
        if(!ok){
          setGatePrep('โหลดข้อมูลไม่สำเร็จ', 'กดกลับแล้วลองใหม่ หรือรอ connection ให้เสถียรก่อน');
          setTimeout(()=>{try{global._senseFlowHeavyActive=false;}catch(e){}},1200);
          return false;
        }
        try{if(typeof loadFromStorage==='function')loadFromStorage(currentAccountId);}catch(e){}
        try{if(D&&D.alts&&D.skus&&D.alts.length&&D.skus.length&&typeof computeOPPS==='function')computeOPPS();}catch(e){}
        clearGatePrep();
        return origSgOrb.apply(this,arguments);
      }finally{
        global._senseFlowPreflightRunning=false;
        setTimeout(()=>{try{global._senseFlowHeavyActive=false;}catch(e){}},2500);
      }
    };
    try{sgOrbTap=global.sgOrbTap;}catch(e){}
  }

  // Clean matcher CTA labels after render, in case older inline text is created before this patch runs.
  const origShowMatcher=global.showMatcherResults;
  if(typeof origShowMatcher==='function'){
    global.showMatcherResults=function(groups,totalPairs,vsMode){
      const ret=origShowMatcher.apply(this,arguments);
      try{
        const withAlts=(groups||[]).filter(g=>g&&g.result&&Array.isArray(g.result.verified)&&g.result.verified.length>0);
        const navLbl=document.getElementById(vsMode?'vs-nav-opps-label':null);
        if(navLbl)navLbl.textContent=`ดูรายการที่เพิ่งตรวจ ${withAlts.length} SKU →`;
        const gen=document.getElementById('gen-nav-opps-btn');
        if(gen)gen.innerHTML=`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M13 2L4.5 13.5H12L11 22 19.5 10.5H12L13 2z"/></svg> ดูรายการที่เพิ่งตรวจ ${withAlts.length} SKU →`;
      }catch(e){}
      return ret;
    };
    try{showMatcherResults=global.showMatcherResults;}catch(e){}
  }

  global.getFreshketV207bSenseFlowState=function(){
    let loadedTabs=[];try{loadedTabs=Array.from(_cloudLoadedTabs||[]);}catch(e){}
    return {version:VERSION,role:role(),pwa:isPwa(),avoidGlobalHeavy:shouldAvoidGlobalHeavy(),senseFlowHeavyActive:!!global._senseFlowHeavyActive,loadedTabs,skusReady:(()=>{try{return !!bulkSkusReady;}catch(e){return undefined;}})(),altsReady:(()=>{try{return !!bulkAltsReady;}catch(e){return undefined;}})(),currentAccountId:(()=>{try{return currentAccountId;}catch(e){return null;}})(),senseDataReady:senseDataReady()};
  };
  log('[v207b] Sense flow stability patch installed');
})(window);


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v210l-portfolio-state-cleanup-js
//////////////////////////////////////////////////////////////////////////////

(function(){
  function esc(v){
    try{ return typeof _commEscapeHtml==='function' ? _commEscapeHtml(v) : String(v ?? '').replace(/[&<>'"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];}); }
    catch(e){ return String(v ?? ''); }
  }
  function fmtK(n){ n=Number(n||0); return n>=1000000?'฿'+(n/1000000).toFixed(1)+'M':n>=1000?'฿'+(n/1000).toFixed(0)+'K':'฿'+Math.round(n); }
  function insightStar(){ return '<svg class="pv-insight-mini-star" viewBox="0 0 10 10" fill="rgba(170,210,255,.95)" xmlns="http://www.w3.org/2000/svg"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg>'; }
  function ensureInsightControl(){
    var wrap=document.querySelector('#pv-sort-sticky .pv-toggle-btns');
    if(!wrap) return null;
    var btn=document.getElementById('pv-insight-mini');
    if(!btn){
      btn=document.createElement('button');
      btn.id='pv-insight-mini';
      btn.className='pv-insight-mini';
      btn.type='button';
      btn.onclick=function(){ generatePortviewInsight(); };
      wrap.insertBefore(btn, wrap.firstChild);
    }
    syncInsightButton();
    return btn;
  }
  function syncInsightButton(state){
    var btn=document.getElementById('pv-insight-mini');
    if(!btn) return;
    btn.classList.remove('loading','done','done-bounce');
    if(state==='loading'){
      btn.classList.add('loading');
      btn.innerHTML='<span class="ai-thinking">'+insightStar()+'<span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></span>';
      return;
    }
    var done=false;
    try{ done=!!portviewAiDone; }catch(e){ done=!!window._pvLastInsightHtml; }
    if(done || state==='done') btn.classList.add('done');
    btn.innerHTML=insightStar()+'<span class="pv-insight-word">Insight</span>';
  }
  function openInsightSheet(html, opts){
    opts=opts||{};
    var ov=document.getElementById('pv-insight-sheet-overlay');
    if(!ov){
      ov=document.createElement('div');
      ov.id='pv-insight-sheet-overlay';
      ov.className='pv-insight-sheet-overlay';
      ov.onclick=function(e){ if(e.target===ov) closeInsightSheet(); };
      document.body.appendChild(ov);
    }
    var body='';
    if(opts.loading){
      body='<div class="pv-insight-loading"><div class="pv-insight-loading-star">'+insightStar()+'</div><div>Olive กำลังอ่านสัญญาณพอร์ต...</div><div style="font-size:11px;color:rgba(198,216,245,.62);margin-top:3px">จัดลำดับร้านที่ควรดูต่อให้ก่อน</div></div>';
    }else if(opts.error){
      body='<div class="pv-insight-error">'+esc(opts.error)+'</div>';
    }else{
      body=html||'<div class="pv-insight-loading">ยังไม่มี Insight</div>';
    }
    ov.innerHTML='<div class="pv-insight-sheet">'
      +'<div class="pv-insight-sheet-handle"></div>'
      +'<div class="pv-insight-sheet-head"><div><div class="pv-insight-sheet-title">'+insightStar()+' Portfolio Insight</div><div class="pv-insight-sheet-sub">อ่านแล้วปิดกลับมาดูพอร์ตต่อได้ ไม่เปลี่ยนตำแหน่งหน้า</div></div><button class="pv-insight-sheet-close" onclick="_pvCloseInsightSheet()">×</button></div>'
      +'<div class="pv-insight-sheet-body">'+body+'</div>'
      +'</div>';
    requestAnimationFrame(function(){ ov.classList.add('on'); });
  }
  function closeInsightSheet(){
    var ov=document.getElementById('pv-insight-sheet-overlay');
    if(!ov) return;
    ov.classList.remove('on');
    setTimeout(function(){ ov.innerHTML=''; },260);
  }
  window._pvCloseInsightSheet=closeInsightSheet;
  window._pvEnsureInsightControl=ensureInsightControl;

  async function generateInsightSheet(){
    ensureInsightControl();
    try{
      if(portviewAiDone && window._pvLastInsightHtml){
        openInsightSheet(window._pvLastInsightHtml);
        syncInsightButton('done');
        return;
      }
    }catch(e){ if(window._pvLastInsightHtml){ openInsightSheet(window._pvLastInsightHtml); return; } }
    syncInsightButton('loading');
    openInsightSheet('',{loading:true});
    var accounts=getPortviewAccounts();
    var _awp=accounts.filter(function(a){return a.paceSignal&&a.paceSignal.pct>0;});
    var portfolioPace=_awp.length>0?Math.round(_awp.reduce(function(s,a){return s+a.paceSignal.gmvToDate;},0)/Math.max(1,_awp.reduce(function(s,a){return s+a.paceSignal.expected;},0))*100):0;
    var shortfall=accounts.filter(function(a){return a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn');}).reduce(function(s,a){
      var g=Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||a.paceSignal.gmvToDate||0));
      return s+g;
    },0);
    var atRisk=accounts
      .filter(function(a){return a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn');})
      .map(function(a){a._shortfall=Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||a.paceSignal.gmvToDate||0));return a;})
      .sort(function(a,b){return b._shortfall-a._shortfall;})
      .slice(0,8);
    var ctxLines=atRisk.map(function(a){
      var baseline=a.paceSignal.baselineGmv||0;
      var parts=['Pace '+a.paceSignal.pct+'% · baseline '+(baseline>0?fmtK(baseline):'-')+'/เดือน · ขาดอีก '+fmtK(a._shortfall)];
      var cc=a._churnCounts;
      if(cc&&(cc.gone>0||cc.near>0)){
        var churnParts=[];
        if(cc.gone>0)churnParts.push('หายจริง '+cc.gone+' ตัว');
        if(cc.near>0)churnParts.push('ใกล้รอบ '+cc.near+' ตัว');
        parts.push('SKU (interval-aware): '+churnParts.join(', ')+' จาก '+cc.total+' ตัว');
      } else if(!cc&&a.churnedSkuCount>0){
        parts.push('SKU หาย '+a.churnedSkuCount+' ตัว ('+fmtK(a.churnedGmv||0)+'): '+(a.topChurnedNames||'').split(' | ').slice(0,2).join(', '));
      }
      if(a.missingCatCount>0) parts.push('Category ขาด: '+(a.missingCats||'').split(' | ').slice(0,2).join(', '));
      return '- '+a.name+' ['+a.paceSignal.cls+']: '+parts.join(' · ');
    }).join('\n');
    var quickRecover=accounts
      .filter(function(a){return a.paceSignal&&a.paceSignal.cls==='warn'&&!(a._churnCounts&&a._churnCounts.gone>0)&&!(a.churnedSkuCount>0);})
      .sort(function(a,b){return b.paceSignal.pct-a.paceSignal.pct;})
      .slice(0,2)
      .map(function(a){return a.name+' ('+a.paceSignal.pct+'% ขาดอีก '+fmtK(Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||a.paceSignal.gmvToDate||0)))+')';})
      .join(', ');
    var prompt='ข้อมูลพอร์ต:\nภาพรวม: '+accounts.length+' ร้าน · Pro Rate '+portfolioPace+'% · ส่วนต่างรวม '+fmtK(shortfall)+'\n\nAccounts เสี่ยง ranked by ฿ impact ('+atRisk.length+'):\n'+(ctxLines||'ไม่มี')+(quickRecover?'\n\nQuick recovery candidates (warn + SKU health ok): '+quickRecover:'');
    var sysPv=OLIVE_BASE+`\n\n-- TASK CONTEXT --\nA KAM is planning their day right now. They can see the list — they need your read on what it actually means and who to contact first. Accounts are ranked by ฿ shortfall, not pace %. Let the money impact drive the priority, not the percentage.\n\nUrgency logic (read the signals, decide yourself):\n- Danger + SKU หาย → โทรวันนี้ก่อนเลย ถามว่าทำไมหยุดสั่ง\n- Danger เฉยๆ → โทรวันนี้ เปิดด้วยความห่วงใย ไม่ใช่ pressure\n- Warn + category ขาด → พรุ่งนี้ ถามว่ายังซื้อ category นั้นอยู่มั้ย\n- Warn เฉยๆ → monitor เตรียม talkline ไว้\n- Safe/Great → ไม่ urgent แต่ถ้ามี opportunity ให้หมายเหตุ\n\n-- OUTPUT CONTRACT --\nThai prose — brief enough to read in 30 seconds.\n\nStructure:\n1. One sentence on portfolio state — lead with the problem, not how many accounts are fine.\n2. Contact list ranked by urgency: name → why it matters → what specifically to ask (max 5)\n3. Quick win if one exists.\n\nDon't repeat numbers already visible in the list.\nWhen mentioning a SKU, use ฿ — not %.`;
    try{
      var txt=await callAI('sonnet',sysPv,[{role:'user',content:prompt}],2000);
      var html=String(txt||'').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
      window._pvLastInsightHtml=html;
      try{ portviewAiDone=true; }catch(e){}
      openInsightSheet(html);
      syncInsightButton('done');
      var btn=document.getElementById('pv-insight-mini');
      if(btn){btn.classList.add('done-bounce');btn.addEventListener('animationend',function(e){if(e.animationName==='doneBounce')btn.classList.remove('done-bounce');},{once:true});}
    }catch(e){
      syncInsightButton();
      openInsightSheet('',{error:'AI error: '+String(e.message||e).slice(0,80)});
      try{ showToast('AI error: '+String(e.message||e).slice(0,60),'⚠'); }catch(_e){}
    }
  }
  window.generatePortviewInsight=generateInsightSheet;

  function openTargetExplain(panelId, handleId){
    var p=document.getElementById(panelId), h=document.getElementById(handleId);
    if(!p) return;
    if(h) h.classList.add('open');
    p.classList.remove('open');
    var clone=p.cloneNode(true);
    clone.classList.add('open');
    clone.querySelectorAll('.tgt-det-section').forEach(function(sec){
      if(sec.querySelector('.tgt-color-key') || /สีของตัวเลข\s*เป้าหมาย/.test(sec.textContent||'')) sec.remove();
    });
    var ov=document.getElementById('tgt-explain-sheet-overlay');
    if(!ov){
      ov=document.createElement('div');
      ov.id='tgt-explain-sheet-overlay';
      ov.className='tgt-explain-sheet-overlay';
      ov.onclick=function(e){ if(e.target===ov) closeTargetExplain(); };
      document.body.appendChild(ov);
    }
    ov.dataset.handleId=handleId||'';
    ov.innerHTML='<div class="tgt-explain-sheet">'
      +'<div class="tgt-explain-sheet-handle"></div>'
      +'<div class="tgt-explain-sheet-head"><div><div class="tgt-explain-sheet-title">วิธีอ่านตัวเลขพอร์ต</div><div class="tgt-explain-sheet-sub">แยกข้อมูลยาวออกจากหน้าหลัก เพื่อให้อ่านได้โดยไม่โดนยุบตอน scroll</div></div><button class="tgt-explain-sheet-close" onclick="_tgtCloseExplainSheet()">×</button></div>'
      +'<div class="tgt-explain-sheet-body">'+clone.outerHTML+'</div>'
      +'</div>';
    requestAnimationFrame(function(){ ov.classList.add('on'); });
  }
  function closeTargetExplain(){
    var ov=document.getElementById('tgt-explain-sheet-overlay');
    if(!ov) return;
    var handleId=ov.dataset.handleId;
    if(handleId){ var h=document.getElementById(handleId); if(h) h.classList.remove('open'); }
    ov.classList.remove('on');
    setTimeout(function(){ov.innerHTML='';},260);
  }
  window._tgtToggleDetail=openTargetExplain;
  window._tgtCloseExplainSheet=closeTargetExplain;

  function afterRenderHook(){
    setTimeout(function(){
      ensureInsightControl();
      var out=document.getElementById('portview-ai-output'); if(out){out.style.display='none'; out.innerHTML='';}
    },80);
  }
  var _oldRenderPortview=window.renderPortview;
  if(typeof _oldRenderPortview==='function'){
    window.renderPortview=function(){ var r=_oldRenderPortview.apply(this,arguments); afterRenderHook(); return r; };
    try{ renderPortview=window.renderPortview; }catch(e){}
  }
  var _oldRenderPortviewList=window.renderPortviewList;
  if(typeof _oldRenderPortviewList==='function'){
    window.renderPortviewList=function(){ var r=_oldRenderPortviewList.apply(this,arguments); afterRenderHook(); return r; };
    try{ renderPortviewList=window.renderPortviewList; }catch(e){}
  }
  document.addEventListener('DOMContentLoaded',function(){ setTimeout(ensureInsightControl,0); setTimeout(ensureInsightControl,350); });
  setTimeout(ensureInsightControl,0);
})();
(function(global){
  'use strict';
  var VERSION = 'v212a-pwa-freshness-unification';
  var DATA_EPOCH = '2026-05-22-v212a-pwa-freshness-unification';
  var CRITICAL = ['portview','history','handover'];
  var lastGovernanceLoadAt = 0;
  var governanceInFlight = null;
  var resumeInFlight = null;
  // v216 FIX 2D: was `0` — caused first cold-load to bypass minGap check and force-fetch CSV at ~3.2s,
  //              producing the "5th flash" 5-10s after splash. Initialize to boot time so cold load is
  //              treated as "already validated" — main loader already fetched fresh data.
  var lastResumeAt = (typeof Date.now === 'function' ? Date.now() : +new Date());

  function debugOn(){ try{return localStorage.getItem('senseDebug')==='1'||localStorage.getItem('freshketDebug')==='1';}catch(e){return false;} }
  function log(){ if(debugOn()) try{ console.log.apply(console, ['[v212a freshness]'].concat([].slice.call(arguments))); }catch(e){} }
  function warn(){ try{ console.warn.apply(console, ['[v212a freshness]'].concat([].slice.call(arguments))); }catch(e){} }
  function now(){ return Date.now ? Date.now() : +new Date(); }
  function safeClone(x){ try{return JSON.parse(JSON.stringify(x));}catch(e){return x;} }
  function isLoggedIn(){ try{return !!currentUser;}catch(e){return false;} }
  function currentQuarter(){ try{return _tgtCurrentQuarter();}catch(e){ return null; } }
  function hasCoreData(){ try{return Array.isArray(portviewBulkData) && portviewBulkData.length>0;}catch(e){return false;} }
  function markGov(meta){
    try{
      global.FreshketSenseGovernanceFreshness = Object.assign({
        version: VERSION,
        dataEpoch: DATA_EPOCH,
        checkedAt: now(),
        quarter: currentQuarter()
      }, meta || {});
    }catch(e){}
  }
  function clearGovernanceMemory(reason){
    try{ _tgtQuarterCache = {}; }catch(e){}
    try{ _tgtLoaded = false; }catch(e){}
    try{ _tgtCache = {}; }catch(e){}
    try{ _tgtSettings = { nrr_threshold: 98 }; }catch(e){}
    try{ _nrrGovPolicies = {}; }catch(e){}
    try{ _nrrExclusions = []; }catch(e){}
    try{ _commissionSnapshots = []; }catch(e){}
    try{ _commRuleConfig = { plans:{}, rules:{}, tiers:{}, assignments:[] }; }catch(e){}
    markGov({source:'cleared', reason:reason||'manual'});
  }
  async function forceGovernanceReload(reason, opts){
    opts = opts || {};
    var force = !!opts.force;
    var minGap = opts.minGap == null ? 60000 : opts.minGap;
    if(governanceInFlight) return governanceInFlight;
    if(!isLoggedIn() && !opts.allowLoggedOut) return false;
    if(!force && lastGovernanceLoadAt && (now() - lastGovernanceLoadAt) < minGap){
      markGov(Object.assign({}, global.FreshketSenseGovernanceFreshness||{}, {source:'memory-fresh', reason:reason||'throttled', skipped:true, ageMs:now()-lastGovernanceLoadAt}));
      return true;
    }
    governanceInFlight = (async function(){
      var q = currentQuarter();
      var started = now();
      try{
        if(typeof loadTargets !== 'function' || !q){ markGov({source:'unavailable', reason:reason||'unknown'}); return false; }
        clearGovernanceMemory(reason||'force-reload');
        if(typeof _setDataPillText === 'function' && !opts.silent) _setDataPillText('Sync governance','Supabase');
        await loadTargets(q);
        lastGovernanceLoadAt = now();
        var metrics = {};
        try{ metrics.targetKeys = Object.keys(_tgtCache||{}).length; }catch(e){}
        try{ metrics.policyKeys = Object.keys(_nrrGovPolicies||{}).length; }catch(e){}
        try{ metrics.exclusions = (_nrrExclusions||[]).length; }catch(e){}
        try{ metrics.snapshots = (_commissionSnapshots||[]).length; }catch(e){}
        try{ metrics.assignments = ((_commRuleConfig||{}).assignments||[]).length; }catch(e){}
        markGov(Object.assign({source:'network', ok:true, reason:reason||'reload', durationMs:now()-started}, metrics));
        log('governance reloaded', reason, metrics);
        return true;
      }catch(err){
        markGov({source:'error', ok:false, reason:reason||'reload', durationMs:now()-started, error:err && err.message ? err.message : String(err)});
        warn('governance reload failed', reason, err && err.message ? err.message : err);
        return false;
      }finally{ governanceInFlight = null; }
    })();
    return governanceInFlight;
  }
  function hydrateVisible(reason){
    try{ if(typeof updateDataStatus === 'function') updateDataStatus(); }catch(e){}
    try{ if(typeof updateMatcherPreStatus === 'function') updateMatcherPreStatus(); }catch(e){}
    // v223: RenderBus handles all screen renders — one flush for all screens
    if(window.RenderBus){
      window.RenderBus.signal('hydrate-'+reason);
    } else {
      // Fallback if RenderBus not available
      try{ if(typeof renderTeamview === 'function' && document.getElementById('scr-teamview')?.classList.contains('on')) renderTeamview(); }catch(e){}
      try{ if(typeof renderPortview === 'function' && document.getElementById('scr-portview')?.classList.contains('on')) renderPortview(); }catch(e){}
      try{ if(typeof renderKamOverview === 'function' && document.getElementById('scr-kam-overview')?.classList.contains('on')) renderKamOverview(); }catch(e){}
    }
  }
  function keysAreCritical(keys){
    if(!Array.isArray(keys)) return false;
    var map = {}; keys.forEach(function(k){ map[k]=true; });
    return CRITICAL.every(function(k){ return !!map[k]; });
  }
  async function validateUnifiedFreshness(reason, opts){
    opts = opts || {};
    var minGap = opts.force ? 0 : 120000;
    if(resumeInFlight) return resumeInFlight;
    if(!isLoggedIn()) return false;
    if(!opts.force && !hasCoreData()) return false;
    if(!opts.force && lastResumeAt && (now()-lastResumeAt)<minGap) return false;
    lastResumeAt = now();
    resumeInFlight = (async function(){
      try{
        if(navigator && navigator.onLine === false){
          try{ if(typeof showToast === 'function') showToast('ใช้ข้อมูล cached — offline','⚠'); }catch(e){}
          return false;
        }
        var csvOk = true;
        if(typeof ensureCloudflareFiles === 'function'){
          // v218 DATA GATE: clear loaded tabs before force-reload so refreshAll() stays blocked
          // (allCriticalReady()=false) during the entire reload window. When the last file
          // completes, _fetchCloudflareFile's gate flushes _pendingRefreshAll → ONE render.
          // Without this, _cloudLoadedTabs has stale entries → allCriticalReady()=true → each
          // file completion fires refreshAll() → 6 flashes visible during resume reload.
          try{ if(window._cloudLoadedTabs && typeof window._cloudLoadedTabs.clear==='function') window._cloudLoadedTabs.clear(); }catch(e){}
          if(window.RenderBus) window.RenderBus.reset(); // v223: reset so re-arriving files batch correctly
          csvOk = await ensureCloudflareFiles(CRITICAL, { label:'ตรวจข้อมูลล่าสุด', force:true });
        }
        var govOk = await forceGovernanceReload(reason||'resume', {force:true, silent:true, minGap:0});
        if(csvOk && govOk){
          hydrateVisible(reason||'resume');
          try{ if(typeof showToast === 'function') showToast('ข้อมูลล่าสุดแล้ว','✓'); }catch(e){}
          return true;
        }
        try{ if(typeof showToast === 'function') showToast('ตรวจข้อมูลล่าสุดไม่ครบ — ใช้ข้อมูลที่มีอยู่','⚠'); }catch(e){}
        return false;
      }catch(err){ warn('unified validation failed', reason, err&&err.message?err.message:err); return false; }
      finally{ resumeInFlight = null; }
    })();
    return resumeInFlight;
  }

  // Wrap CSV ensure: when critical CSV is refreshed, Supabase governance/commission state must refresh before callers hydrate UI.
  try{
    var oldEnsure = ensureCloudflareFiles;
    if(typeof oldEnsure === 'function' && !oldEnsure.__v212aWrapped){
      var wrappedEnsure = async function(keys, opts){
        var ok = await oldEnsure.apply(this, arguments);
        try{
          if(ok && (opts && opts.force || keysAreCritical(keys)) && keysAreCritical(keys)){
            await forceGovernanceReload('ensure-critical-csv', {force:true, silent:true, minGap:0});
          }
        }catch(e){ warn('post-ensure governance sync failed', e&&e.message?e.message:e); }
        return ok;
      };
      wrappedEnsure.__v212aWrapped = true;
      ensureCloudflareFiles = wrappedEnsure;
    }
  }catch(e){ warn('ensureCloudflareFiles wrap failed', e&&e.message?e.message:e); }

  // Wrap cold load: clear/reload governance before CSV render path to avoid PWA using stale target/exclusion/snapshot memory.
  try{
    var oldLoad = loadFromCloudflareR2;
    if(typeof oldLoad === 'function' && !oldLoad.__v212aWrapped){
      var wrappedLoad = async function(){
        await forceGovernanceReload('cold-load-pre-render', {force:true, silent:true, minGap:0});
        var res = await oldLoad.apply(this, arguments);
        await forceGovernanceReload('cold-load-post-csv', {force:true, silent:true, minGap:0});
        hydrateVisible('cold-load-complete');
        return res;
      };
      wrappedLoad.__v212aWrapped = true;
      loadFromCloudflareR2 = wrappedLoad;
      try{ loadFromGoogleSheets = wrappedLoad; }catch(e){}
      try{ loadFromSupabaseStorage = wrappedLoad; }catch(e){}
    }
  }catch(e){ warn('loadFromCloudflareR2 wrap failed', e&&e.message?e.message:e); }

  // Wrap manual refresh: clear both CSV/KAM bundle and Supabase-derived state.
  try{
    var oldReload = reloadFromCloudflareR2;
    if(typeof oldReload === 'function' && !oldReload.__v212aWrapped){
      var wrappedReload = async function(){
        clearGovernanceMemory('manual-refresh');
        try{ lastGovernanceLoadAt = 0; lastResumeAt = 0; }catch(e){}
        var res = await oldReload.apply(this, arguments);
        await forceGovernanceReload('manual-refresh-post-csv', {force:true, silent:true, minGap:0});
        hydrateVisible('manual-refresh');
        return res;
      };
      wrappedReload.__v212aWrapped = true;
      reloadFromCloudflareR2 = wrappedReload;
      try{ reloadFromGoogleSheets = wrappedReload; }catch(e){}
    }
  }catch(e){ warn('reloadFromCloudflareR2 wrap failed', e&&e.message?e.message:e); }

  // v225: visibilitychange/pageshow/focus/online listeners REMOVED from v212a.
  // Handled by ResumeCoordinator at end of 08_patches.js.

  var api = {
    version: VERSION,
    dataEpoch: DATA_EPOCH,
    criticalKeys: CRITICAL.slice(),
    forceGovernanceReload: forceGovernanceReload,
    clearGovernanceMemory: clearGovernanceMemory,
    validateFreshnessOnResume: validateUnifiedFreshness,
    getFreshness: function(){
      return {
        csv: safeClone(global.FreshketSenseDataFreshness || {}),
        governance: safeClone(global.FreshketSenseGovernanceFreshness || {}),
        app: { version: VERSION, dataEpoch: DATA_EPOCH, ts: now() }
      };
    }
  };
  global.FreshketSenseV212a = api;
  try{
    global.FreshketSenseV212 = Object.assign(global.FreshketSenseV212 || {}, {
      version: VERSION,
      dataEpoch: DATA_EPOCH,
      validateFreshnessOnResume: validateUnifiedFreshness,
      forceGovernanceReload: forceGovernanceReload,
      getFreshness: api.getFreshness
    });
  }catch(e){}
  markGov({source:'boot', reason:'v212a-loaded'});
  log('loaded');
})(window);


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v212b-panel-target-ui-js
//////////////////////////////////////////////////////////////////////////////

// v212b — Data panel counter sync + target comma formatting + redundant badge cleanup.
// Scope: UI/freshness visibility only. No NRR, commission, owner, or movement formula changes.
(function(global){
  'use strict';
  var VERSION = 'v212b-pwa-freshness-ui-fix';
  var FOREGROUND_KEYS = ['portview','history','categories','sku_current','outlets','handover'];

  function countObj(o){ try{ return o && typeof o === 'object' ? Object.keys(o).length : 0; }catch(e){ return 0; } }
  function loadedTabs(){ try{ if(typeof _cloudLoadedTabs !== 'undefined' && _cloudLoadedTabs && typeof _cloudLoadedTabs.has === 'function') return _cloudLoadedTabs; }catch(e){} return null; }
  function hasTab(tab){ var t=loadedTabs(); return !!(t && t.has(tab)); }
  function dataLoaded(key){
    try{
      if(key === 'portview') return hasTab('portview') || (Array.isArray(global.portviewBulkData) && global.portviewBulkData.length > 0);
      if(key === 'history') return hasTab('history') || countObj(global.bulkHistoryData) > 0;
      if(key === 'categories') return hasTab('categories') || countObj(global.bulkCatsData) > 0 || countObj(global.bulkCategoriesData) > 0;
      if(key === 'sku_current') return hasTab('sku_current') || countObj(global.bulkSkuCurrentData) > 0;
      if(key === 'outlets') return hasTab('outlets') || countObj(global.bulkOutletsData) > 0;
      if(key === 'handover'){
        var h = global.bulkHandoverData || {};
        return hasTab('handover') || countObj(h.byAccountId) > 0 || countObj(h.byKamName) > 0;
      }
    }catch(e){}
    return false;
  }
  function keyToTab(key){ return key === 'sku_current' ? 'sku_current' : key; }
  function styleChip(key, ok){
    try{
      var id = 'sp-' + keyToTab(key);
      var el = document.getElementById(id);
      if(!el) return;
      el.style.background = ok ? 'rgba(0,208,112,.18)' : 'rgba(0,0,0,.06)';
      el.style.color = ok ? 'var(--g700)' : 'var(--n500)';
      el.style.fontWeight = ok ? '800' : '600';
    }catch(e){}
  }
  function syncPanelCounter(){
    var loaded = 0;
    FOREGROUND_KEYS.forEach(function(k){ var ok = dataLoaded(k); if(ok) loaded++; styleChip(k, ok); });
    var counter = document.getElementById('sheets-loaded-count');
    if(counter){
      counter.style.display = 'inline-block';
      counter.textContent = loaded >= FOREGROUND_KEYS.length ? (loaded + '/' + FOREGROUND_KEYS.length) : (loaded >= 3 ? 'Core 3/3' : (loaded + '/' + FOREGROUND_KEYS.length));
      counter.title = loaded >= FOREGROUND_KEYS.length
        ? 'Foreground data loaded: portview, history, handover, categories, sku_current, outlets'
        : 'Core data is ready. Enhancement files may still load in background.';
      counter.style.background = loaded >= FOREGROUND_KEYS.length ? 'rgba(0,208,112,.16)' : 'rgba(38,96,200,.15)';
      counter.style.color = loaded >= FOREGROUND_KEYS.length ? 'var(--g700)' : 'rgba(38,96,200,.85)';
    }
    return {loaded:loaded,total:FOREGROUND_KEYS.length,keys:FOREGROUND_KEYS.slice()};
  }

  function parseTargetNumber(v){
    try{
      if(typeof global._tgtParseInput === 'function') return global._tgtParseInput(String(v||''));
    }catch(e){}
    var s = String(v||'').replace(/,/g,'').replace(/฿/g,'').trim().toLowerCase();
    if(!s || s === '—') return 0;
    if(s.endsWith('m')) return Math.round((parseFloat(s)||0)*1000000);
    if(s.endsWith('k')) return Math.round((parseFloat(s)||0)*1000);
    return Math.round(parseFloat(s)||0);
  }
  function fmtComma(n){
    n = Number(n||0);
    if(!Number.isFinite(n) || n <= 0) return '';
    return Math.round(n).toLocaleString('en-US');
  }
  function formatTargetInput(el){
    if(!el || !el.classList || !el.classList.contains('tgt-month-input')) return;
    var v = parseTargetNumber(el.value);
    el.value = v > 0 ? fmtComma(v) : '';
    try{ el.classList.toggle('changed', v > 0); }catch(e){}
  }
  function formatAllTargetInputs(root){
    try{ (root||document).querySelectorAll('.tgt-month-input').forEach(formatTargetInput); }catch(e){}
  }

  // Override display helper so freshly rendered target sheets use comma format.
  try{
    global._tgtFmtInput = function(n){ return fmtComma(n); };
    try{ _tgtFmtInput = global._tgtFmtInput; }catch(e){}
  }catch(e){}

  // Wrap target render so existing raw-number targets become readable immediately.
  try{
    var oldRenderTargetSheetBody = global.renderTargetSheetBody;
    if(typeof oldRenderTargetSheetBody === 'function' && !oldRenderTargetSheetBody.__v212bWrapped){
      var wrappedRenderTargetSheetBody = function(){
        var r = oldRenderTargetSheetBody.apply(this, arguments);
        setTimeout(function(){ formatAllTargetInputs(document); }, 0);
        return r;
      };
      wrappedRenderTargetSheetBody.__v212bWrapped = true;
      global.renderTargetSheetBody = wrappedRenderTargetSheetBody;
      try{ renderTargetSheetBody = wrappedRenderTargetSheetBody; }catch(e){}
    }
  }catch(e){}

  // Format on blur, but don't fight the cursor on every keypress.
  document.addEventListener('blur', function(e){
    var el = e && e.target;
    if(el && el.classList && el.classList.contains('tgt-month-input')) formatTargetInput(el);
  }, true);
  document.addEventListener('focus', function(e){
    var el = e && e.target;
    if(el && el.classList && el.classList.contains('tgt-month-input')){
      try{ el.inputMode = 'decimal'; }catch(x){}
    }
  }, true);

  // Keep the panel counter honest after any load/status render, and after opening the panel.
  try{
    var oldUpdateDataStatus = global.updateDataStatus;
    if(typeof oldUpdateDataStatus === 'function' && !oldUpdateDataStatus.__v212bWrapped){
      var wrappedUpdateDataStatus = function(){
        var r = oldUpdateDataStatus.apply(this, arguments);
        setTimeout(syncPanelCounter, 0);
        return r;
      };
      wrappedUpdateDataStatus.__v212bWrapped = true;
      global.updateDataStatus = wrappedUpdateDataStatus;
      try{ updateDataStatus = wrappedUpdateDataStatus; }catch(e){}
    }
  }catch(e){}
  try{
    var oldOpenDataPanel = global.openDataPanel;
    if(typeof oldOpenDataPanel === 'function' && !oldOpenDataPanel.__v212bWrapped){
      var wrappedOpenDataPanel = function(){
        var r = oldOpenDataPanel.apply(this, arguments);
        setTimeout(syncPanelCounter, 80);
        setTimeout(syncPanelCounter, 800);
        return r;
      };
      wrappedOpenDataPanel.__v212bWrapped = true;
      global.openDataPanel = wrappedOpenDataPanel;
      try{ openDataPanel = wrappedOpenDataPanel; }catch(e){}
    }
  }catch(e){}

  // Also resync after foreground/enhancement loads, without forcing network.
  [1200, 3000, 6000, 12000].forEach(function(ms){ setTimeout(syncPanelCounter, ms); });

  var api = Object.freeze({
    version: VERSION,
    syncPanelCounter: syncPanelCounter,
    formatTargetInputs: function(){ formatAllTargetInputs(document); },
    parseTargetNumber: parseTargetNumber,
    formatComma: fmtComma
  });
  global.FreshketSenseV212b = api;
  try{
    var prevA = global.FreshketSenseV212a;
    if(prevA && typeof prevA === 'object'){
      // Do not mutate frozen v212a object; expose v212b separately.
    }
  }catch(e){}
})(window);


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v212c-diagnostics-js
//////////////////////////////////////////////////////////////////////////////

// v212c — Reliable diagnostics + foreground counter, with zero extra network/reload behavior.
// Scope: debug/readability only. Does not change NRR, commission, owner, movement, loader policy, or SQL.
(function(global){
  'use strict';
  var VERSION = 'v212c-diagnostics-counter-fix';
  var DATA_EPOCH = '2026-05-22-v212c-diagnostics-counter-fix';
  var FOREGROUND = ['portview','history','categories','sku_current','outlets','handover'];
  var CORE = ['portview','history','handover'];

  function now(){ return Date.now ? Date.now() : +new Date(); }
  function safeClone(x){ try{return JSON.parse(JSON.stringify(x));}catch(e){return x;} }
  function countObj(o){ try{return o && typeof o === 'object' ? Object.keys(o).length : 0;}catch(e){return 0;} }
  function arrLen(a){ try{return Array.isArray(a) ? a.length : 0;}catch(e){return 0;} }
  function readVar(name){
    try{ if(Object.prototype.hasOwnProperty.call(global, name)) return global[name]; }catch(e){}
    try{ return (0,eval)(name); }catch(e){}
    try{ return eval(name); }catch(e){}
    return undefined;
  }
  function readTabs(){
    var t = readVar('_cloudLoadedTabs');
    try{ return t && typeof t.has === 'function' ? t : null; }catch(e){ return null; }
  }
  function tabHas(k){ var t=readTabs(); try{return !!(t && t.has(k));}catch(e){return false;} }
  function tabList(){ var t=readTabs(); try{return t ? Array.from(t) : [];}catch(e){return [];} }
  function handoverCounts(){
    var h = readVar('bulkHandoverData') || {};
    return {
      accounts: countObj(h.byAccountId),
      kams: countObj(h.byKamName),
      rawRows: arrLen(h.rows || h.rawRows || h.data)
    };
  }
  function rows(){
    var h = handoverCounts();
    var out = {
      portviewRows: arrLen(readVar('portviewBulkData')),
      currentMonthAccounts: countObj(readVar('bulkCurrentMonthData')),
      historyAccounts: countObj(readVar('bulkHistoryData')),
      handoverAccounts: h.accounts,
      handoverKams: h.kams,
      handoverRawRows: h.rawRows,
      categoriesAccounts: countObj(readVar('bulkCatsData')) || countObj(readVar('bulkCategoriesData')),
      skuCurrentAccounts: countObj(readVar('bulkSkuCurrentData')),
      outletsAccounts: countObj(readVar('bulkOutletsData')),
      loadedTabs: tabList()
    };
    out.coreReady = !!(out.portviewRows > 0 && out.historyAccounts > 0 && (out.handoverAccounts > 0 || out.handoverKams > 0 || tabHas('handover')));
    out.foregroundReadyCount = FOREGROUND.filter(function(k){ return loaded(k, out); }).length;
    out.foregroundTotal = FOREGROUND.length;
    return out;
  }
  function loaded(key, snapshot){
    var r = snapshot || rows();
    if(key === 'portview') return tabHas('portview') || r.portviewRows > 0;
    if(key === 'history') return tabHas('history') || r.historyAccounts > 0;
    if(key === 'categories') return tabHas('categories') || r.categoriesAccounts > 0;
    if(key === 'sku_current') return tabHas('sku_current') || r.skuCurrentAccounts > 0;
    if(key === 'outlets') return tabHas('outlets') || r.outletsAccounts > 0;
    if(key === 'handover') return tabHas('handover') || r.handoverAccounts > 0 || r.handoverKams > 0 || r.handoverRawRows > 0;
    return false;
  }
  function freshness(){
    var v212 = null, v212a = null;
    try{ v212 = global.FreshketSenseV212 && typeof global.FreshketSenseV212.getFreshness === 'function' ? global.FreshketSenseV212.getFreshness() : null; }catch(e){ v212 = {error:e&&e.message?e.message:String(e)}; }
    try{ v212a = global.FreshketSenseV212a && typeof global.FreshketSenseV212a.getFreshness === 'function' ? global.FreshketSenseV212a.getFreshness() : null; }catch(e){ v212a = {error:e&&e.message?e.message:String(e)}; }
    return {
      csv: safeClone(global.FreshketSenseDataFreshness || (v212&&v212.csv) || (v212a&&v212a.csv) || {}),
      governance: safeClone(global.FreshketSenseGovernanceFreshness || (v212&&v212.governance) || (v212a&&v212a.governance) || {}),
      v212: safeClone(v212),
      v212a: safeClone(v212a)
    };
  }
  function version(){
    var cfg = global.FreshketSenseConfig || global.FRESHKET_CONFIG || {};
    var cfgVersion = null;
    try{ cfgVersion = cfg.app && cfg.app.version; }catch(e){}
    return {
      build: VERSION,
      dataEpoch: DATA_EPOCH,
      configVersion: cfgVersion || null,
      currentBuild: VERSION.replace(/^v(\d+[a-z]?).*$/i, 'v$1'),
      objects: {
        FreshketSenseDebug: !!global.FreshketSenseDebug,
        FreshketSenseV212b: !!global.FreshketSenseV212b,
        FreshketSenseV212a: !!global.FreshketSenseV212a,
        FreshketSenseV212: !!global.FreshketSenseV212
      },
      url: String(location.href),
      standalone: !!((global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) || navigator.standalone)
    };
  }
  function resourceRows(pattern){
    var re = pattern instanceof RegExp ? pattern : /portview|bulk_|sense_|supabase|rest\/v1/i;
    try{
      return performance.getEntriesByType('resource')
        .filter(function(r){ return re.test(r.name); })
        .map(function(r){ return {
          file: String(r.name).split('/').pop().split('?')[0],
          url: r.name,
          duration: Math.round(r.duration || 0),
          sizeKB: Math.round((r.transferSize || 0) / 1024),
          startMs: Math.round(r.startTime || 0),
          initiator: r.initiatorType || ''
        }; });
    }catch(e){ return [{error:e&&e.message?e.message:String(e)}]; }
  }
  function network(){ return resourceRows(); }
  function heavyNetwork(){ return resourceRows(/bulk_skus|bulk_alternatives|sense_skus|sense_alts|bulk_price/i); }
  function status(){
    var r = rows();
    var f = freshness();
    return {
      version: version(),
      rows: r,
      freshness: f,
      counter: syncCounter(),
      networkSummary: {
        matchingResources: network().length,
        heavyResources: heavyNetwork().length
      },
      ts: now()
    };
  }
  function chipId(key){
    if(key === 'history') return 'sp-history';
    if(key === 'categories') return 'sp-categories';
    if(key === 'sku_current') return 'sp-sku_current';
    if(key === 'outlets') return 'sp-outlets';
    if(key === 'handover') return 'sp-handover';
    return 'sp-' + key;
  }
  function paintChip(key, ok){
    try{
      var el = document.getElementById(chipId(key));
      if(!el) return;
      el.style.background = ok ? 'rgba(0,208,112,.18)' : 'rgba(0,0,0,.06)';
      el.style.color = ok ? 'var(--g700)' : 'var(--n500)';
      el.style.fontWeight = ok ? '800' : '600';
      el.title = ok ? 'Loaded' : 'Not confirmed loaded';
    }catch(e){}
  }
  function syncCounter(){
    var r = rows();
    var loadedKeys = FOREGROUND.filter(function(k){ return loaded(k, r); });
    var coreKeys = CORE.filter(function(k){ return loaded(k, r); });
    FOREGROUND.forEach(function(k){ paintChip(k, loadedKeys.indexOf(k) >= 0); });
    var counter = document.getElementById('sheets-loaded-count');
    var label;
    if(loadedKeys.length >= FOREGROUND.length) label = loadedKeys.length + '/' + FOREGROUND.length;
    else if(coreKeys.length >= CORE.length) label = 'Core 3/3';
    else label = loadedKeys.length + '/' + FOREGROUND.length;
    if(counter){
      counter.style.display = 'inline-block';
      counter.textContent = label;
      counter.classList.remove('sense-core-ready','sense-all-ready','sense-partial');
      counter.classList.add(loadedKeys.length >= FOREGROUND.length ? 'sense-all-ready' : (coreKeys.length >= CORE.length ? 'sense-core-ready' : 'sense-partial'));
      counter.title = 'Foreground loaded: ' + loadedKeys.join(', ') + ' | Core: ' + coreKeys.join(', ');
    }
    return {label:label, loaded:loadedKeys.length, total:FOREGROUND.length, loadedKeys:loadedKeys, coreLoaded:coreKeys.length, coreTotal:CORE.length, coreKeys:coreKeys, rows:r};
  }
  function installWrappers(){
    try{
      var oldUpdate = global.updateDataStatus;
      if(typeof oldUpdate === 'function' && !oldUpdate.__v212cWrapped){
        var wrappedUpdate = function(){ var ret = oldUpdate.apply(this, arguments); setTimeout(syncCounter, 0); setTimeout(syncCounter, 300); return ret; };
        wrappedUpdate.__v212cWrapped = true;
        global.updateDataStatus = wrappedUpdate;
        try{ updateDataStatus = wrappedUpdate; }catch(e){}
      }
    }catch(e){}
    try{
      var oldOpen = global.openDataPanel;
      if(typeof oldOpen === 'function' && !oldOpen.__v212cWrapped){
        var wrappedOpen = function(){ var ret = oldOpen.apply(this, arguments); setTimeout(syncCounter, 60); setTimeout(syncCounter, 700); setTimeout(syncCounter, 1800); return ret; };
        wrappedOpen.__v212cWrapped = true;
        global.openDataPanel = wrappedOpen;
        try{ openDataPanel = wrappedOpen; }catch(e){}
      }
    }catch(e){}
  }
  function logLoaded(reason){
    try{ console.log('[SenseDebug]', reason || 'status', status()); }catch(e){}
  }

  installWrappers();
  try{ global.FRESHKET_CONFIG = global.FreshketSenseConfig || global.FRESHKET_CONFIG || {}; }catch(e){}
  try{ global.FRESHKET_BUILD = VERSION; }catch(e){}
  try{ global.currentBuild = function(){ return 'v212c'; }; }catch(e){}

  var api = Object.freeze({
    version: version,
    rows: rows,
    freshness: freshness,
    network: network,
    heavyNetwork: heavyNetwork,
    status: status,
    syncCounter: syncCounter,
    log: logLoaded
  });
  global.FreshketSenseDebug = api;
  global.FreshketSenseV212c = api;

  [250, 1200, 3000, 7000, 14000].forEach(function(ms){ setTimeout(syncCounter, ms); });
  try{ document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible') setTimeout(syncCounter, 1200); }); }catch(e){}
  try{ global.addEventListener('pageshow', function(){ setTimeout(syncCounter, 1200); }); }catch(e){}
  try{ global.addEventListener('online', function(){ setTimeout(syncCounter, 600); }); }catch(e){}
  try{ console.log('[SenseDebug] v212c installed', version()); }catch(e){}
})(window);


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v213-guided-intelligence-ux-js
//////////////////////////////////////////////////////////////////////////////

(function(global){
  'use strict';
  var VERSION='v213-guided-intelligence-ux';
  var SKU_FORCE=false;
  function $(id){return document.getElementById(id);}
  function log(){try{console.log.apply(console, ['[Freshket Sense v213]'].concat([].slice.call(arguments)));}catch(e){}}

  function setBuildMetadata(){
    try{ global.FRESHKET_BUILD=VERSION; }catch(e){}
    try{ global.currentBuild=function(){return 'v213';}; }catch(e){}
    try{
      var cfg=global.FRESHKET_CONFIG || global.FreshketSenseConfig || {};
      cfg.app=cfg.app||{}; cfg.app.version=VERSION;
      global.FRESHKET_CONFIG=cfg;
      if(global.FreshketSenseConfig){ global.FreshketSenseConfig.app=global.FreshketSenseConfig.app||{}; global.FreshketSenseConfig.app.version=VERSION; }
    }catch(e){}
    try{
      var debug=global.FreshketSenseDebug;
      if(debug && !debug.__v213Wrapped){
        var oldVersion=debug.version;
        var wrapped=Object.assign({}, debug, {version:function(){
          var base={}; try{ base=oldVersion?oldVersion():{}; }catch(e){}
          return Object.assign({}, base, {build:VERSION,currentBuild:'v213',uxPatch:'guided-intelligence'});
        }});
        wrapped.__v213Wrapped=true;
        global.FreshketSenseDebug=wrapped;
      }
    }catch(e){}
  }

  function installViewportReset(){
    try{
      var meta=document.querySelector('meta[name="viewport"]');
      if(meta){
        var c=meta.getAttribute('content')||'';
        if(!/maximum-scale/.test(c)) c += ', maximum-scale=1.0';
        if(!/user-scalable/.test(c)) c += ', user-scalable=no';
        meta.setAttribute('content', c.replace(/\s*,\s*/g, ', '));
      }
    }catch(e){}
    function reset(reason){
      try{ document.documentElement.classList.add('v213-app-entry-reset'); }catch(e){}
      try{ if(document.activeElement && typeof document.activeElement.blur==='function') document.activeElement.blur(); }catch(e){}
      try{ document.body.style.transform=''; document.body.style.zoom=''; }catch(e){}
      [0,80,240,520].forEach(function(ms){ setTimeout(function(){ try{ if(reason==='entry'||reason==='login'||reason==='pageshow') global.scrollTo(0,0); }catch(e){} }, ms); });
      setTimeout(function(){ try{ document.documentElement.classList.remove('v213-app-entry-reset'); }catch(e){} }, 750);
    }
    global.FreshketSenseV213_resetViewport=reset;
    ['hideLoginOverlay','_autoRouteAfterLogin','checkSession'].forEach(function(name){
      try{
        var old=global[name];
        if(typeof old==='function' && !old.__v213ViewportWrapped){
          var wrapped=function(){ var ret=old.apply(this,arguments); setTimeout(function(){reset(name==='hideLoginOverlay'?'login':'entry');},60); return ret; };
          wrapped.__v213ViewportWrapped=true; global[name]=wrapped; try{ eval(name+'=global[name]'); }catch(e){}
        }
      }catch(e){}
    });
    try{ global.addEventListener('pageshow', function(){ reset('pageshow'); }, {passive:true}); }catch(e){}
  }

  function installSkuPriceDefault(){
    function markToggle(){ try{ var t=document.querySelector('.sku-view-toggle'); if(t) t.classList.add('v213-price-default'); }catch(e){} }
    function forcePrice(reason){
      try{
        var screen=$('scr-portfolio');
        if(!screen || !screen.classList.contains('on')) return false;
        if(global._v213SkuManualChoice) return false;
        if(typeof global.setSkuView==='function'){
          SKU_FORCE=true; global.setSkuView('price'); SKU_FORCE=false;
          markToggle();
          return true;
        }
        var btn=$('svt-price'); if(btn){ btn.click(); markToggle(); return true; }
      }catch(e){ SKU_FORCE=false; }
      return false;
    }
    try{
      var oldSet=global.setSkuView;
      if(typeof oldSet==='function' && !oldSet.__v213Wrapped){
        var wrappedSet=function(v){ if(!SKU_FORCE) global._v213SkuManualChoice=true; return oldSet.apply(this,arguments); };
        wrappedSet.__v213Wrapped=true; global.setSkuView=wrappedSet; try{ setSkuView=wrappedSet; }catch(e){}
      }
    }catch(e){}
    try{
      var oldShow=global.showScreen;
      if(typeof oldShow==='function' && !oldShow.__v213SkuWrapped){
        var wrappedShow=function(name){ var ret=oldShow.apply(this,arguments); if(name==='portfolio'){ setTimeout(function(){ forcePrice('showScreen'); },80); setTimeout(function(){ forcePrice('showScreen-late'); },360); } return ret; };
        wrappedShow.__v213SkuWrapped=true; global.showScreen=wrappedShow; try{ showScreen=wrappedShow; }catch(e){}
      }
    }catch(e){}
    try{
      var oldOverlay=global._overlayNav;
      if(typeof oldOverlay==='function' && !oldOverlay.__v213SkuWrapped){
        var wrappedOverlay=function(name){ var ret=oldOverlay.apply(this,arguments); if(name==='portfolio'){ setTimeout(function(){ forcePrice('overlay'); },80); setTimeout(function(){ forcePrice('overlay-late'); },360); } return ret; };
        wrappedOverlay.__v213SkuWrapped=true; global._overlayNav=wrappedOverlay; try{ _overlayNav=wrappedOverlay; }catch(e){}
      }
    }catch(e){}
    [250,800,1800].forEach(function(ms){ setTimeout(function(){ markToggle(); forcePrice('boot'); },ms); });
  }

  function installRestaurantDrillCoach(){
    function ensureCoachEl(){
      var el=$('v213-drill-coach'); if(el) return el;
      el=document.createElement('div'); el.id='v213-drill-coach';
      el.innerHTML='<div class="v213-coach-star">✦</div><div class="v213-coach-copy">แตะ <strong>รายร้าน</strong> เพื่อเจาะรายละเอียดแต่ละสาขาใน account นี้</div><button type="button" aria-label="ปิด">×</button>';
      document.body.appendChild(el);
      el.querySelector('button').addEventListener('click',function(){ hideCoach(true); });
      return el;
    }
    function hideCoach(persist){
      var el=$('v213-drill-coach'); if(el) el.classList.remove('show');
      var nav=$('nav-restaurant'); if(nav) nav.classList.remove('v213-coach-pulse');
      if(persist){ try{ localStorage.setItem('sense_hint_restaurant_drill_seen','1'); }catch(e){} }
    }
    function canShow(){
      try{
        if(localStorage.getItem('sense_hint_restaurant_drill_seen')==='1') return false;
        if(!document.body.classList.contains('kam-mode')) return false;
        if(document.body.classList.contains('restaurant-sheet')) return false;
        var nav=$('nav-restaurant'); if(!nav || !nav.getClientRects().length) return false;
        return true;
      }catch(e){ return false; }
    }
    function showCoachSoon(){
      setTimeout(function(){
        if(!canShow()) return;
        var el=ensureCoachEl();
        var nav=$('nav-restaurant'); if(nav) nav.classList.add('v213-coach-pulse');
        el.classList.add('show');
        setTimeout(function(){ hideCoach(false); }, 3600);
      }, 850);
    }
    function relabel(){
      var lab=$('nav-restaurant-label'); if(lab) lab.textContent='รายร้าน';
      var nav=$('nav-restaurant'); if(nav){ nav.setAttribute('aria-label','เปิดมุมมองรายร้าน'); nav.title='เปิดมุมมองรายร้านใน account นี้'; }
    }
    relabel(); showCoachSoon();
    try{
      var oldToggle=global.toggleRestaurantSheet;
      if(typeof oldToggle==='function' && !oldToggle.__v213DrillWrapped){
        var wrapped=function(){ hideCoach(true); var ret=oldToggle.apply(this,arguments); setTimeout(relabel,0); return ret; };
        wrapped.__v213DrillWrapped=true; global.toggleRestaurantSheet=wrapped; try{ toggleRestaurantSheet=wrapped; }catch(e){}
      }
    }catch(e){}
    try{
      var oldOpen=global.openRestaurantSheet;
      if(typeof oldOpen==='function' && !oldOpen.__v213DrillWrapped){
        var wrappedOpen=function(){ hideCoach(true); return oldOpen.apply(this,arguments); };
        wrappedOpen.__v213DrillWrapped=true; global.openRestaurantSheet=wrappedOpen; try{ openRestaurantSheet=wrappedOpen; }catch(e){}
      }
    }catch(e){}
    try{
      var oldShow=global.showScreen;
      if(typeof oldShow==='function' && !oldShow.__v213CoachWrapped){
        var wrappedShow=function(){ var ret=oldShow.apply(this,arguments); setTimeout(function(){ relabel(); showCoachSoon(); },500); return ret; };
        wrappedShow.__v213CoachWrapped=true; global.showScreen=wrappedShow; try{ showScreen=wrappedShow; }catch(e){}
      }
    }catch(e){}
    setTimeout(relabel,600); setTimeout(relabel,1800);
  }

  function applyCommissionClasses(){
    try{
      var el=document.querySelector('.pv-comm-strip.v210k');
      if(!el) return;
      el.classList.remove('v213-locked','v213-near','v213-unlocked');
      var st=null; try{ if(typeof global._commBuildKamSelfState==='function') st=global._commBuildKamSelfState(); }catch(e){}
      var payout=st?Number(st.payout||0):0;
      var pct=st&&st.pct!=null?Number(st.pct):NaN;
      var threshold=98; try{ threshold=Number((global._tgtSettings&&global._tgtSettings.nrr_threshold)||threshold); }catch(e){}
      if(payout>0){ el.classList.add('v213-unlocked'); }
      else if(Number.isFinite(pct) && (threshold-pct)<=3 && pct<threshold){ el.classList.add('v213-near'); }
      else{ el.classList.add('v213-locked'); }
      var chip=el.querySelector('.pv-comm-chip');
      if(chip && !chip.dataset.v213Copy){
        var current=(chip.textContent||'').trim();
        if(payout>0) chip.textContent='ถึงเกณฑ์แล้ว';
        else if(Number.isFinite(pct) && pct<threshold && (threshold-pct)<=3) chip.textContent='ใกล้ปลดล็อก';
        else if(/ยังไม่ถึง/.test(current) || !current) chip.textContent='ยังไม่ถึงเกณฑ์';
        chip.dataset.v213Copy='1';
      }
    }catch(e){}
  }
  function installCommissionReward(){
    try{
      var old=global._commRenderKamSelfStrip;
      if(typeof old==='function' && !old.__v213RewardWrapped){
        var wrapped=function(){ var ret=old.apply(this,arguments); setTimeout(applyCommissionClasses,0); setTimeout(applyCommissionClasses,250); return ret; };
        wrapped.__v213RewardWrapped=true; global._commRenderKamSelfStrip=wrapped; try{ _commRenderKamSelfStrip=wrapped; }catch(e){}
      }
    }catch(e){}
    [400,1200,2600,5200].forEach(function(ms){ setTimeout(applyCommissionClasses,ms); });
  }

  function installFabSafeZone(){
    var key='fs_aifab_pos_v1';
    try{ key=(global.FreshketSenseConfig&&global.FreshketSenseConfig.storage&&global.FreshketSenseConfig.storage.chatFabPositionKey)||key; }catch(e){}
    function bounds(fab){
      var r=fab.getBoundingClientRect(); var w=r.width||54,h=r.height||54;
      var vv=global.visualViewport; var vw=(vv&&vv.width)||global.innerWidth||440; var vh=(vv&&vv.height)||global.innerHeight||700; var ox=(vv&&vv.offsetLeft)||0, oy=(vv&&vv.offsetTop)||0;
      var topbar=document.querySelector('.topbar'); var top=96+oy;
      try{ if(topbar){ var tr=topbar.getBoundingClientRect(); top=Math.max(top,tr.bottom+12); } }catch(e){}
      var bnav=document.querySelector('.bnav'); var bottom=vh+oy-h-18;
      try{ if(bnav){ var br=bnav.getBoundingClientRect(); if(br.top>0) bottom=Math.min(bottom,br.top-h-14); } }catch(e){}
      var left=ox+12,right=ox+vw-w-12;
      if(bottom<top) bottom=top+8;
      return {left:left,right:right,top:top,bottom:bottom,w:w,h:h};
    }
    function clampAndSnap(persist, animate){
      var fab=$('aifab'); if(!fab) return null;
      var r=fab.getBoundingClientRect(); var b=bounds(fab);
      var x=Math.max(b.left,Math.min(r.left,b.right)); var y=Math.max(b.top,Math.min(r.top,b.bottom));
      var mid=(b.left+b.right)/2; x=(x<mid?b.left:b.right);
      if(animate) fab.classList.add('v213-safe-correcting');
      fab.style.left=Math.round(x)+'px'; fab.style.top=Math.round(y)+'px'; fab.style.right='auto'; fab.style.bottom='auto'; fab.classList.add('moved','v213-edge-snapped');
      if(persist){ try{ localStorage.setItem(key,JSON.stringify({x:Math.round(x),y:Math.round(y)})); }catch(e){} }
      if(animate) setTimeout(function(){ try{ fab.classList.remove('v213-safe-correcting'); }catch(e){} },320);
      return {x:x,y:y,bounds:b};
    }
    global.FreshketSenseV213_clampAssistantFab=clampAndSnap;
    function resetFab(){
      var fab=$('aifab'); if(!fab) return;
      try{ localStorage.removeItem(key); }catch(e){}
      fab.style.left=''; fab.style.top=''; fab.style.right='16px'; fab.style.bottom='150px'; fab.classList.remove('moved','v213-edge-snapped');
      setTimeout(function(){ clampAndSnap(true,true); },80);
      try{ if(typeof showToast==='function') showToast('รีเซ็ตตำแหน่ง Olive แล้ว','ok'); }catch(e){}
    }
    global.FreshketSenseV213_resetAssistantFab=resetFab;
    function installLongPress(){
      var fab=$('aifab'); if(!fab || fab.dataset.v213LongPress==='1') return;
      fab.dataset.v213LongPress='1'; var t=null, moved=false, sx=0, sy=0;
      fab.addEventListener('pointerdown',function(e){ moved=false; sx=e.clientX; sy=e.clientY; clearTimeout(t); t=setTimeout(function(){ if(!moved) resetFab(); },950); },{passive:true});
      fab.addEventListener('pointermove',function(e){ if(Math.abs(e.clientX-sx)+Math.abs(e.clientY-sy)>10) moved=true; },{passive:true});
      ['pointerup','pointercancel','lostpointercapture'].forEach(function(ev){ fab.addEventListener(ev,function(){ clearTimeout(t); setTimeout(function(){ clampAndSnap(true,true); },30); },{passive:true}); });
    }
    [300,900,1800,4000].forEach(function(ms){ setTimeout(function(){ installLongPress(); clampAndSnap(true,ms>800); },ms); });
    try{ global.addEventListener('resize',function(){ setTimeout(function(){ clampAndSnap(true,true); },100); },{passive:true}); }catch(e){}
    try{ global.addEventListener('pageshow',function(){ setTimeout(function(){ clampAndSnap(true,true); },500); },{passive:true}); }catch(e){}
    try{ document.addEventListener('visibilitychange',function(){ if(document.visibilityState==='visible') setTimeout(function(){ clampAndSnap(true,true); },500); },{passive:true}); }catch(e){}
  }

  function boot(){
    setBuildMetadata();
    installViewportReset();
    installSkuPriceDefault();
    installRestaurantDrillCoach();
    installCommissionReward();
    installFabSafeZone();
    try{ log('Guided Intelligence UX installed'); }catch(e){}
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
  global.FreshketSenseV213={version:VERSION, applyCommissionClasses:applyCommissionClasses, clampAssistantFab:function(){return global.FreshketSenseV213_clampAssistantFab&&global.FreshketSenseV213_clampAssistantFab(true,true);}, resetAssistantFab:function(){return global.FreshketSenseV213_resetAssistantFab&&global.FreshketSenseV213_resetAssistantFab();}};
})(window);