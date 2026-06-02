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