// ══════════════════════════════════════════
// SUPABASE CONFIG + AUTH
// ══════════════════════════════════════════
const FRESHKET_APP_CONFIG = window.FreshketSenseConfig || {};
const SUPA_URL = (FRESHKET_APP_CONFIG.supabase && FRESHKET_APP_CONFIG.supabase.url) || 'https://menslbnyyvpxiyvjywcm.supabase.co';
const SUPA_KEY = (FRESHKET_APP_CONFIG.supabase && FRESHKET_APP_CONFIG.supabase.publishableKey) || 'sb_publishable_DRCzHd782Gry8Edu4ZIiHA_KuOgBIIG';

// v208e-fix1: defensive alias for legacy SKU verify button paths.
window.triggerSkuVerifyFromThisMonth = window.triggerSkuVerifyFromThisMonth || function(){
  if (typeof window.triggerSkuVerifyFromCurrentMonth === 'function') return window.triggerSkuVerifyFromCurrentMonth();
  if (typeof window.triggerSkuVerify === 'function') return window.triggerSkuVerify();
  console.warn('[SKU Verify] trigger function not available yet');
};
const supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);

let currentUser = null;
let currentUserProfile = null;

// v210i: Canonical auth-role normalization.
// DB source of truth uses: admin / tl / rep / sales. UI may still label rep as KAM.
// SECTION:AUTH
function normalizeRole(role){
  const r = String(role || '').trim().toLowerCase();
  if(r === 'kam' || r === 'ka' || r === 'key_account' || r === 'key account') return 'rep';
  if(r === 'team_lead' || r === 'team lead') return 'tl';
  if(r === 'sales' || r === 'sale' || r === 'sales_rep') return 'sales';
  if(r === 'sales_tl' || r === 'sales_lead' || r === 'sales_team_lead') return 'sales_tl';
  return r || 'rep';
}
function getCurrentRole(){
  try{ return normalizeRole(currentUserProfile && currentUserProfile.role); }catch(e){ return 'rep'; }
}
function isAdminRole(role){ return normalizeRole(role) === 'admin'; }
function isTLRole(role){ return normalizeRole(role) === 'tl'; }
function isRepRole(role){ return normalizeRole(role) === 'rep'; }
function isSalesRole(role){ return normalizeRole(role) === 'sales'; }
function isSalesTLRole(role){ return normalizeRole(role) === 'sales_tl'; }
function isSalesAny(role){ const r=normalizeRole(role); return r==='sales'||r==='sales_tl'; }
function isEchoUser(role){ const r=normalizeRole(role); return r==='rep'||r==='sales'||r==='sales_tl'; }
function roleLabel(role){
  const r = normalizeRole(role);
  if(r === 'rep') return 'KAM';
  if(r === 'tl') return 'TL';
  if(r === 'admin') return 'Admin';
  if(r === 'sales') return 'Sales';
  if(r === 'sales_tl') return 'Sales TL';
  return role || '';
}
function normalizeCurrentUserProfileRole(){
  try{
    if(currentUserProfile){
      currentUserProfile.role = normalizeRole(currentUserProfile.role);
      currentUserProfile.role_label = roleLabel(currentUserProfile.role);
    }
  }catch(e){}
  return getCurrentRole();
}
try{
  window.normalizeRole = normalizeRole;
  window.normalizeSenseRole = normalizeRole;
  window.getCurrentRole = getCurrentRole;
  window.isAdminRole = isAdminRole;
  window.isTLRole = isTLRole;
  window.isRepRole = isRepRole;
  window.isSalesRole = isSalesRole;
  window.isSalesTLRole = isSalesTLRole;
  window.isSalesAny = isSalesAny;
  window.isEchoUser = isEchoUser;
  window.roleLabel = roleLabel;
}catch(e){}

// v149: guarded splash transition + relogin runtime cleanup
let loginTransitionRunning = false;
let passwordRecoveryMode = false;


function resetRuntimeSessionState(){
  // v224e: cancel pending RenderBus timers BEFORE clearing data — prevents 0-flash
  // when token auto-refresh triggers SIGNED_OUT → portviewBulkData=[] → stale render fires
  try{ if(window.RenderBus) window.RenderBus.reset(); }catch(e){}
  try { sheetsLoadStarted = false; } catch(e) {}
  try { if (typeof _cloudLoadToken !== 'undefined') _cloudLoadToken++; } catch(e) {}
  try {
    if (typeof _cloudInFlight !== 'undefined') {
      if (typeof _clearCloudInFlight === 'function') _clearCloudInFlight();
      else Object.keys(_cloudInFlight).forEach(k => delete _cloudInFlight[k]);
    }
  } catch(e) {}
  try {
    if (typeof _cloudLoadedTabs !== 'undefined' && _cloudLoadedTabs && typeof _cloudLoadedTabs.clear === 'function') {
      _cloudLoadedTabs.clear();
    }
  } catch(e) {}
  try { if (typeof _cloudInitialPromise !== 'undefined') _cloudInitialPromise = null; } catch(e) {}
  try { if (typeof _cloudBackgroundPromise !== 'undefined') _cloudBackgroundPromise = null; } catch(e) {}
  try { bulkSkusReady = false; } catch(e) {}
  try { bulkAltsReady = false; } catch(e) {}
  try { loginTransitionRunning = false; } catch(e) {}
  // Fix v194: reset auth flags so stale state never blocks next login attempt
  try { window._doLoginHandled = false; } catch(e) {}
  try { window._sessionCheckHandling = false; } catch(e) {}
  try { if (window._visibilityGraceTimer) { clearTimeout(window._visibilityGraceTimer); window._visibilityGraceTimer = null; } } catch(e) {}
  try { if (window._pgsGraceTimer) { clearTimeout(window._pgsGraceTimer); window._pgsGraceTimer = null; } } catch(e) {}
  try { window._pwaResumeCheckInFlight = null; } catch(e) {}
  // v202: clear ALL Sense + UI state so next login never inherits previous session
  try { portviewBulkData=[]; } catch(e) {}      // prevents splash from thinking cache=warm with old data
  try { bulkUpsellData={ byKam:{}, baselineGroups:{}, loaded:false }; } catch(e) {}  // Q3C: clear upsell index on logout
  try { bulkUpsellTeamData={}; } catch(e) {}  // clear team summary on logout
  try { currentAccountId=null; } catch(e) {}    // prevents loadFromStorage restoring old account state
  try { senseActivated=false; } catch(e) {}
  try { _sgRunning=false; } catch(e) {}          // prevent stale gate blocking reset
  try { _sgRevealPending=false; } catch(e) {}
  try { footerUnlocked=false; } catch(e) {}       // prevent opportunity screen from being unlocked
  try { if(typeof setMode==='function')setMode('kam'); } catch(e) {} // force KAM mode (prevent restaurant flash)
  try { const b=document.getElementById('opp-nav-badge');if(b){b.textContent='0';b.style.display='none';} } catch(e) {}
  // v202a bundle state
  try { _kamBundleLoaded.clear(); } catch(e) {}
  try { Object.keys(_kamBundleInFlight).forEach(k=>delete _kamBundleInFlight[k]); } catch(e) {}
  // v465: cross-session state reset — prevent data/UI bleed between logins
  // Bug: KAM→Sales→KAM left portviewLevel='rep-detail', portviewRepEmail=prev user, body class stale,
  //      bulk data vars unpurged → wrong commission, wrong pace bar, ghost TL button, missing account data
  try { portviewLevel='rep'; } catch(e) {}
  try { portviewRepEmail=null; } catch(e) {}
  try { bulkHistoryData={}; } catch(e) {}
  try { bulkCatsData={}; } catch(e) {}
  try { bulkSkuCurrentData={}; } catch(e) {}
  try { bulkOutletsData={}; } catch(e) {}
  try { document.body.classList.remove('sales-mode','sales-tl-mode','kam-mode'); } catch(e) {}
  // v479-G2: reset commission render key so _commGatedRender re-renders on next login
  try { if(typeof window._commResetKey==='function') window._commResetKey(); } catch(e) {}
}

function _showLoginOverlayClean(){
  resetRuntimeSessionState();
  const ov = document.getElementById('login-overlay');
  passwordRecoveryMode = false;
  if (ov) {
    ov.classList.remove('lgi-checking');
    ov.classList.remove('password-recovery');
    ov.style.display = 'flex';
    ov.style.opacity = '1';
  }
  const splash = document.getElementById('sense-splash');
  if (splash) {
    splash.style.display = 'none';
    splash.style.opacity = '';
    splash.style.transition = '';
  }
  const bar = document.getElementById('spl-bar');
  if (bar) {
    bar.style.transition = 'none';
    bar.style.width = '0';
  }
  const em = document.getElementById('login-email');
  const pw = document.getElementById('login-password');
  if (em) em.value = '';
  if (pw) pw.value = '';
  const rpw = document.getElementById('reset-password');
  const rpw2 = document.getElementById('reset-password-confirm');
  const rst = document.getElementById('pw-reset-status');
  if (rpw) rpw.value = '';
  if (rpw2) rpw2.value = '';
  if (rst) { rst.textContent = ''; rst.className = 'pw-reset-status'; }
}


function _urlLooksLikePasswordRecovery(){
  const raw = String(window.location.search || '') + ' ' + String(window.location.hash || '');
  return /(?:^|[?#&])type=recovery(?:&|$)/i.test(raw) || /password[_-]?recovery/i.test(raw);
}

function _clearPasswordRecoveryUrl(){
  try {
    const keep = new URLSearchParams(window.location.search);
    ['code','token','token_hash','type','access_token','refresh_token','expires_in','expires_at'].forEach(k => keep.delete(k));
    const qs = keep.toString();
    const clean = window.location.pathname + (qs ? '?' + qs : '');
    window.history.replaceState({}, document.title, clean);
  } catch(e) {}
}

function showPasswordResetForm(){
  passwordRecoveryMode = true;
  loginTransitionRunning = false;
  const ov = document.getElementById('login-overlay');
  if (ov) {
    ov.classList.remove('lgi-checking');
    ov.classList.add('password-recovery');
    ov.style.display = 'flex';
    ov.style.opacity = '1';
  }
  const splash = document.getElementById('sense-splash');
  if (splash) {
    splash.style.display = 'none';
    splash.style.opacity = '';
    splash.style.transition = '';
  }
  const em = document.getElementById('pw-reset-email');
  if (em) em.textContent = currentUser?.email ? currentUser.email : '';
  const loginErr = document.getElementById('login-error');
  if (loginErr) { loginErr.textContent = ''; loginErr.className = 'lgi-err'; loginErr.style.display = 'none'; }
  setTimeout(() => {
    const p = document.getElementById('reset-password');
    if (p) p.focus();
  }, 60);
}

function showResetStatus(msg, type){
  const el = document.getElementById('pw-reset-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'pw-reset-status ' + (type === 'ok' ? 'ok' : 'err');
}

function showLoginInfo(msg){
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent = msg;
  el.className = 'lgi-err ok';
  el.style.display = 'block';
}

async function submitPasswordReset(){
  const p1 = document.getElementById('reset-password')?.value || '';
  const p2 = document.getElementById('reset-password-confirm')?.value || '';
  const btn = document.getElementById('pw-reset-btn');
  const txt = document.getElementById('pw-reset-btn-text');

  if (p1.length < 8) { showResetStatus('Password ต้องมีอย่างน้อย 8 ตัวอักษร', 'err'); return; }
  if (p1 !== p2) { showResetStatus('Password สองช่องไม่ตรงกัน', 'err'); return; }

  if (btn) btn.disabled = true;
  if (txt) txt.textContent = 'กำลังบันทึก...';
  try {
    const { error } = await supa.auth.updateUser({ password: p1 });
    if (error) {
      console.warn('[password recovery] update failed:', error.message);
      showResetStatus('บันทึก password ไม่สำเร็จ: ' + (error.message || 'กรุณาขอลิงก์ใหม่'), 'err');
      return;
    }
    showResetStatus('ตั้ง password ใหม่สำเร็จ กำลังกลับไปหน้า login...', 'ok');
    _clearPasswordRecoveryUrl();
    passwordRecoveryMode = false;
    currentUser = null;
    currentUserProfile = null;
    try { await supa.auth.signOut(); } catch(e) {}
    _showLoginOverlayClean();
    showLoginInfo('ตั้ง password ใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วย password ใหม่');
  } catch(e) {
    console.error('[password recovery]', e);
    showResetStatus('เกิดข้อผิดพลาด กรุณาลองใหม่ หรือขอลิงก์ reset ใหม่', 'err');
  } finally {
    if (btn) btn.disabled = false;
    if (txt) txt.textContent = 'บันทึก password ใหม่';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// v223 RESUME STATE — Option A + B
// Save current screen + account on leave → restore on warm resume → skip splash
// ─────────────────────────────────────────────────────────────────────────────
(function(){
  var KEY = 'sense_resume_state_v1';

  // Save state before page leaves (swipe out, tab switch, close)
  function saveResumeState(){
    if(!window.currentUser||!window.currentUserProfile) return;
    try{
      var screen = 'portview';
      try{
        // Read active screen from DOM
        ['portview','teamview','sense','account','history-scr'].forEach(function(s){
          var el=document.getElementById('scr-'+s)||document.getElementById(s);
          if(el&&el.classList.contains('on')) screen=s;
        });
      }catch(e){}
      var state = {
        screen: screen,
        accountId: window.currentAccountId||'default',
        savedAt: Date.now()
      };
      localStorage.setItem(KEY, JSON.stringify(state));
    }catch(e){}
  }

  window._getResumeState = function(){
    try{
      var raw=localStorage.getItem(KEY);
      if(!raw) return null;
      var s=JSON.parse(raw);
      // Only restore if saved within 6 hours
      if(!s||!s.savedAt||(Date.now()-s.savedAt)>6*60*60*1000) return null;
      return s;
    }catch(e){return null;}
  };

  window._clearResumeState = function(){
    try{localStorage.removeItem(KEY);}catch(e){}
  };

  // Save on every leave event
  window.addEventListener('pagehide', saveResumeState);
  window.addEventListener('visibilitychange', function(){
    if(document.visibilityState==='hidden') saveResumeState();
  });
  window.addEventListener('beforeunload', saveResumeState);
})();


// Guard A: only act when currentUser not yet set → prevents double-invoke
//          if doLogin() already completed before onAuthStateChange fires
// Guard D: SIGNED_OUT only triggers login UI if we were actually logged in
//          (avoids showing login on initial page load when no session exists)
// Fix v194: _doLoginHandled — set by doLogin() to prevent onAuthStateChange(SIGNED_IN)
// from calling hideLoginOverlay() a second time after doLogin already handled it.
// _sessionCheckHandling — set by checkSession() to block INITIAL_SESSION race.
// _visibilityGraceTimer — cancellable timer for visibilitychange grace period.
window._doLoginHandled = false;
window._sessionCheckHandling = false;
window._visibilityGraceTimer = null;
window._pwaResumeCheckInFlight = null;

supa.auth.onAuthStateChange((event, session) => {
  console.log('[auth:v202]', event, '| session:', !!session, '| currentUser:', !!currentUser, '| loginRunning:', loginTransitionRunning, '@', Date.now());
  // Recovery links create a temporary auth session first. Do not route into the app yet.
  if (event === 'PASSWORD_RECOVERY' || passwordRecoveryMode || _urlLooksLikePasswordRecovery()) {
    if (session?.user) currentUser = session.user;
    showPasswordResetForm();
    return;
  }

  if (event === 'TOKEN_REFRESHED' && session) {
    // Fix v22.2: handle silent token refresh on mobile.
    currentUser = session.user;
    // v206a: cancel all PWA resume grace timers — token refresh confirms session alive.
    if (window._visibilityGraceTimer) { clearTimeout(window._visibilityGraceTimer); window._visibilityGraceTimer = null; }
    if (window._pgsGraceTimer) { clearTimeout(window._pgsGraceTimer); window._pgsGraceTimer = null; }
    return;
  }

  if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
    // v206a: auth recovered; cancel delayed signed-out/login UI from mobile token churn.
    if (window._signedOutTimer) { clearTimeout(window._signedOutTimer); window._signedOutTimer = null; }
    if (window._visibilityGraceTimer) { clearTimeout(window._visibilityGraceTimer); window._visibilityGraceTimer = null; }
    if (window._pgsGraceTimer) { clearTimeout(window._pgsGraceTimer); window._pgsGraceTimer = null; }
    // Fix v194 Guard A: doLogin() already handled this SIGNED_IN — skip to avoid double hideLoginOverlay.
    if (event === 'SIGNED_IN' && window._doLoginHandled) {
      window._doLoginHandled = false;
      return;
    }
    // Fix v194 Guard B: checkSession() is mid-flight handling INITIAL_SESSION — skip race.
    if (event === 'INITIAL_SESSION' && window._sessionCheckHandling) return;
    // Guard A (original): only proceed if no one else has set currentUser yet.
    if (!currentUser) {
      currentUser = session.user;
      // v219 STRATEGY B: Step 1 — fast IndexedDB preload (no network, no ETag).
      // Runs parallel with loadUserProfile (~3s). By the time showSenseSplash() is called,
      // all 3 critical files should already be in memory from IndexedDB → splash fades in ~900ms.
      // If IndexedDB empty (cold start), returns 0 → ETag path takes over (normal flow).
      window._idbPreloaded=false;
      // v225 A1: expose promise so profile-cache-hit path can wait for IDB result (race fix).
      var _idbPreloadProm = _preloadFromIndexedDB();
      window._idbPreloadPromise = _idbPreloadProm;
      _idbPreloadProm.then(function(count){
        if(count<3){
          // Partial or no IndexedDB hit — kick off normal R2 load with ETag
          // v379: must patch R2 filenames for Sales BEFORE fetch starts.
          // Profile may already be set (cache hit path above), or may still be loading.
          // We wait up to 2s for profile, then patch and fetch regardless.
          var _doR2Fetch = function(){
            try{ if(typeof _patchR2FilesForSales==='function') _patchR2FilesForSales(); }catch(e){}
            try{ if(typeof loadFromCloudflareR2==='function') loadFromCloudflareR2(); }catch(e){}
          };
          if(currentUserProfile && currentUserProfile.email){
            _doR2Fetch();
          } else {
            // v480-E1: replace 50ms poll (max 2s) with direct supa.auth.getSession().
            // On slow networks, loadUserProfile() can take >2s → poll expires → Sales gets
            // KAM files. getSession() is a local JWT decode (no network) → always instant.
            // Inject email into currentUserProfile so _patchR2FilesForSales() can read it.
            (function(){
              try{
                supa.auth.getSession().then(function(result){
                  var _sess = result && result.data && result.data.session;
                  var _email = (_sess && _sess.user && _sess.user.email) || '';
                  if(_email && currentUserProfile && !currentUserProfile.email){
                    currentUserProfile.email = _email;
                  }
                  _doR2Fetch();
                }).catch(function(){ _doR2Fetch(); });
              }catch(e){ _doR2Fetch(); }
            })();
          }
        }
        // v224d: ETag check fires immediately after IDB render (was 3000ms).
        // Minimises stale-data window: 304 = silent no-op, 200 = re-render within ~500ms.
        if(count>0){
          clearTimeout(window._bgEtagTimer);
          window._bgEtagTimer=setTimeout(async function(){
            try{
              _senseDataLog('BACKGROUND','ETag check for portview+history+handover...');
              for(var _bt of ['portview','history','handover']){
                try{ var _bs=R2_SPECS[_bt]; if(_bs) await _fetchCloudflareFile(_bs,{force:true}); }catch(e){}
              }
              window._idbPreloaded=false; // reset after first real ETag cycle
              _senseDataLog('BACKGROUND','ETag check complete');
            }catch(e){}
          },0);
        }
      });
      // v220 PROFILE CACHE: inject cached profile → hideLoginOverlay immediately (no 3s wait).
      // loadUserProfile() runs in background → silent update if profile changed.
      // First-ever login: cache miss → falls back to original await path.
      //
      // v225 A2: skip-splash race fix — wait for IDB preload before calling hideLoginOverlay.
      // Root cause: _canSkipSplash evaluates window._idbPreloaded synchronously, but IDB is async.
      // Profile cache hit fired hideLoginOverlay before IDB resolved → _idbPreloaded always false
      // → skip-splash never triggered even on warm boot.
      // Fix: race IDB promise against 500ms timeout. IDB typically resolves in ~150ms on warm boot.
      // If IDB takes >500ms (cold start / very slow device), proceed anyway — skip-splash won't fire
      // but that's correct (IDB not ready = not a warm boot).
      var _cp=_profileCacheGet(currentUser.id);
      if(_cp){
        currentUserProfile=_cp; normalizeCurrentUserProfileRole();
        _senseDataLog('PROFILE','⚡ cache hit → waiting for IDB preload before hideLoginOverlay (max 500ms)');
        Promise.race([
          window._idbPreloadPromise,
          new Promise(function(r){setTimeout(r,500);})
        ]).then(function(){
          hideLoginOverlay();
          loadUserProfile(); // background revalidate — no await, no gate
        });
      }else{
        loadUserProfile().then(function(){hideLoginOverlay();});
      }
    }
  } else if (event === 'SIGNED_OUT' && currentUser) {
    currentUser = null;
    currentUserProfile = null;
    // v223: SIGNED_OUT from JWT expiry — Supabase auto-refresh may be in flight.
    // Strategy:
    //   1. Wait 600ms for rapid SIGNED_IN (fast network token refresh)
    //   2. If no SIGNED_IN: actively call getSession() — Supabase may have a valid
    //      refreshed session that hasn't fired SIGNED_IN yet (race condition)
    //   3. If getSession() returns a valid session: inject it silently (no login form)
    //   4. Only show login if getSession() confirms truly signed out
    clearTimeout(window._signedOutTimer);
    window._signedOutTimer = setTimeout(async () => {
      window._signedOutTimer = null;
      if (currentUser) return; // SIGNED_IN already fired — cancel
      // Step 2: active session check before showing login
      try {
        const { data } = await supa.auth.getSession();
        if (data && data.session && data.session.user) {
          // Session recovered — inject silently without showing login
          _senseDataLog('AUTH','✅ session recovered after SIGNED_OUT (JWT refresh race) — staying signed in');
          currentUser = data.session.user;
          loadUserProfile(); // refresh profile in background
          return;
        }
      } catch(e) {
        console.warn('[auth] getSession() failed after SIGNED_OUT:', e);
      }
      // Truly signed out — show login
      _senseDataLog('AUTH','🔒 SIGNED_OUT confirmed — showing login');
      _profileCacheClear(currentUser?.id);
      _showLoginOverlayClean();
    }, 1200); // v478-B3: 800→1200ms — iOS Supabase token refresh can take >800ms, causing login flash
  }
});

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pwd = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  const btnText = document.getElementById('login-btn-text');
  if (!email || !pwd) { showLoginError('กรุณากรอก email และ password'); return; }
  btn.disabled = true; btnText.textContent = 'กำลังเข้าสู่ระบบ...';
  errEl.style.display = 'none';
  try {
    const { data, error } = await supa.auth.signInWithPassword({ email, password: pwd });
    if (error) { showLoginError('Email หรือ password ไม่ถูกต้อง'); return; }
    // Fix v194: set flag BEFORE hideLoginOverlay so onAuthStateChange(SIGNED_IN)
    // (which fires async from signInWithPassword) knows doLogin already handles UI.
    window._doLoginHandled = true;
    currentUser = data.user;
    // Load profile first so role is known before R2 fetch starts
    await loadUserProfile();
    // v348: patch R2 filenames for Sales BEFORE starting fetch
    try{ if(typeof _patchR2FilesForSales==='function') _patchR2FilesForSales(); }catch(e){}
    // v195 Step 1: start R2 fetch after profile + patch ready
    if(!sheetsLoadStarted&&typeof loadFromGoogleSheets==='function')loadFromGoogleSheets();
    hideLoginOverlay();
  } catch(e) {
    window._doLoginHandled = false;
    showLoginError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    console.error('[login]', e);
  } finally {
    btn.disabled = false; btnText.textContent = 'เข้าสู่ระบบ';
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.className = 'lgi-err';
  el.textContent = msg; el.style.display = 'block';
  el.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function showSenseSplash(onDone){
  const splash=document.getElementById('sense-splash');
  if(!splash){onDone();return;}
  // v217 FIX B: set active flag so refreshAll() calls during load are queued, not executed.
  // Prevents 4-flash pattern where each R2 file's onLoad callback re-renders the visible screen.
  // Guard is released and one final refreshAll fires in doFade after splash fully disappears.
  window._senseSplashActive=true;
  window._pendingRefreshAll=false;
  splash.style.display='flex';splash.style.opacity='1';
  const tickerEl=document.getElementById('spl-ticker');
  const bar=document.getElementById('spl-bar');
  // v195 Step 2: if portviewBulkData already loaded from IndexedDB cache (pre-fetch
  // started in doLogin/checkSession before splash), use fast-path timing.
  // Falls through to normal timing if cache was cold — zero regression risk.
  const _cacheWarm = typeof portviewBulkData !== 'undefined' && portviewBulkData && portviewBulkData.length > 0 && !window._idbPreloaded;
  // v219 STRATEGY B: _idbPreloaded = 3 critical files loaded from IndexedDB (no ETag).
  // data is in memory but JS wasn't warm (different from _cacheWarm which is JS-state warm from prev session).
  // Use MAX_SHOW > tSetup(900ms) so routing fires correctly before splash force-fades.
  const _idbPreloaded = !!window._idbPreloaded;
  const _lastReady=Number((function(){try{return localStorage.getItem('sense_last_critical_ready');}catch(e){return 0;}})());
  // v218b: extended from 30min → 6h (= IndexedDB TTL). Data freshness is guaranteed separately
  // by ETag conditional GET on every load — warm boot only controls splash MIN/MAX timing.
  const _isWarmBoot=_lastReady>0 && (Date.now()-_lastReady)<6*60*60*1000;
  const MIN_SHOW=(_cacheWarm||_idbPreloaded) ? 0 : (_isWarmBoot ? 0 : 1650);
  _senseDataLog('SPLASH',
    _cacheWarm    ? '🟢 WARM (JS state)' :
    _idbPreloaded ? '⚡ IDB-FAST (Strategy B — no ETag) — MIN=0ms MAX=1500ms' :
    _isWarmBoot   ? '🟡 WARM (IndexedDB < 6h) — MIN=0ms MAX=6000ms' :
                    '🔴 COLD — MIN=1650ms MAX=5000ms',
    _lastReady ? ('last_critical_ready: '+Math.round((Date.now()-_lastReady)/60000)+'min ago') : 'first load'
  );
  // Boot version stamp — always visible at top of console
  const _appVer = (typeof FreshketSenseConfig!=='undefined'&&FreshketSenseConfig.app&&FreshketSenseConfig.app.version)||'unknown';
  console.log('%c[Sense] v'+_appVer+' boot','color:#fff;background:#006050;padding:2px 8px;border-radius:4px;font-weight:bold',
    {cache_state: _cacheWarm?'WARM':_idbPreloaded?'IDB':_isWarmBoot?'WARM-BOOT':'COLD',
     user_agent: navigator.userAgent.split(' ').slice(-1)[0]});
  // v219: _idbPreloaded → MAX_SHOW=1500ms (> tSetup 900ms → routing fires before force-fade)
  const MAX_SHOW=_cacheWarm ? 400 : (_idbPreloaded ? 1500 : (_isWarmBoot ? 5000 : 5000)); // v224e: reduced — splash never blocks beyond 5s
  const startMs=Date.now();
  let faded=false;
  let appReady=false;   // onDone called
  // v219: if IndexedDB preloaded, allCriticalReady()=true → dataReady=true immediately
  // (gate already fired before showSenseSplash was called → no need to wait for _splashDataReady signal)
  let dataReady=_cacheWarm || (_idbPreloaded && allCriticalReady());

  // ── Progress bar: data-driven (not fake) ──────────────────
  // Exported so data loaders can update it
  window._splashProgress = function(pct, tickerMsg) {
    if(faded)return;
    if(bar){
      bar.style.transition='width .4s ease';
      bar.style.width=Math.min(pct,92)+'%';  // hold at 92% until truly ready
    }
    if(tickerMsg&&tickerEl){
      tickerEl.style.opacity='0';
      setTimeout(()=>{
        if(!faded){tickerEl.textContent=tickerMsg;tickerEl.style.opacity='1';}
      },180);
    }
  };

  // ── Splash done: called when portview+history both loaded ──
  window._splashDataReady = function() {
    if(faded)return;
    dataReady=true;
    // v217 FIX C: save timestamp so next cold boot knows data was recently ready → warm boot path.
    try{ localStorage.setItem('sense_last_critical_ready', Date.now()); }catch(e){}
    if(bar){bar.style.transition='width .25s ease';bar.style.width='100%';}
    if(tickerEl){
      tickerEl.style.opacity='0';
      setTimeout(()=>{if(!faded){tickerEl.textContent='พร้อมแล้ว ✦';tickerEl.style.opacity='1';}},180);
    }
    // Fade as soon as min time passed AND app routing done
    const elapsed=Date.now()-startMs;
    const wait=Math.max(0,MIN_SHOW-elapsed);
    setTimeout(()=>{if(appReady)doFade();},wait+200);
  };

  // Initial ticker
  if(tickerEl)tickerEl.textContent='กำลังดึงข้อมูล portfolio...';
  if(bar){bar.style.transition='none';bar.style.width='0';}

  // App setup fires at 900ms behind the splash (no flash)
  const tSetup=setTimeout(()=>{appReady=true;onDone();},900);

  // Fallback: force fade after MAX_SHOW regardless
  const tMax=setTimeout(()=>doFade(),MAX_SHOW);

  // Also fade if MIN_SHOW passed and both ready
  const tCheck=setInterval(()=>{
    if(faded){clearInterval(tCheck);return;}
    if(appReady&&dataReady&&(Date.now()-startMs>=MIN_SHOW))doFade();
  },100);

  function doFade(){
    if(faded)return;
    faded=true;
    clearTimeout(tSetup);clearTimeout(tMax);clearInterval(tCheck);
    // v218b: log splash total duration
    _senseDataLog('SPLASH','⬇️ fading at t='+Math.round(Date.now()-startMs)+'ms',
      dataReady?'(data ready)':'(MAX_SHOW timeout — data not all ready)');
    window._splashProgress=null;window._splashDataReady=null;
    if(bar){bar.style.transition='width .25s ease';bar.style.width='100%';}
    setTimeout(()=>{
      // v202d: force correct screen BEFORE splash becomes transparent
      // ensures old session screen is never visible through fading splash
      try{if(typeof window._splashPreFade==='function'){window._splashPreFade();window._splashPreFade=null;}}catch(e){}
      splash.style.transition='opacity .38s ease';
      splash.style.opacity='0';
      setTimeout(()=>{
        splash.style.display='none';
        splash.style.opacity='';splash.style.transition='';
        if(bar){bar.style.transition='none';bar.style.width='0';}
        // v217 FIX B + v218: release splash guard; fire pending render only if data also ready.
        window._senseSplashActive=false;
        if(window._pendingRefreshAll && (typeof allCriticalReady!=='function' || allCriticalReady())){
          window._pendingRefreshAll=false;
          // v223: stamp RenderBus settle window so background files batch correctly after this
          if(window.RenderBus) window.RenderBus.markRender();
          try{if(typeof refreshAll==='function')refreshAll();}catch(e){}
        }
      },380);
    },220);
  }
}
function hideLoginOverlay() {
  // Fix v194 Fix F: safety net — ensure _doLoginHandled never stays true
  // across multiple hideLoginOverlay calls regardless of which path triggered it.
  window._doLoginHandled = false;
  if (loginTransitionRunning) return;
  loginTransitionRunning = true;

  // v198 flash fix: hide login overlay IMMEDIATELY before splash starts.
  // Root cause: cache-warm splash fades at t=400ms but onDone() fires at t=900ms
  // → login overlay shows through the fading splash (500ms window).
  // Hiding here ensures login is gone before any splash animation.
  const ovImmediate = document.getElementById('login-overlay');
  if (ovImmediate) {
    ovImmediate.style.display = 'none';
    ovImmediate.classList.remove('lgi-checking');
  }

  // Safety valve v22.2: if transition never completes (e.g. concurrent auth events
  // during splash), force-clear lock after 4s and ensure login overlay is hidden.
  // Prevents the "hang + loop" symptom where loginTransitionRunning stays true
  // and subsequent hideLoginOverlay() calls all return early, leaving login visible.
  const lockSafetyTimer = setTimeout(() => {
    if (loginTransitionRunning) {
      loginTransitionRunning = false;
      const _ovSafe = document.getElementById('login-overlay');
      if (_ovSafe && currentUser) {
        _ovSafe.style.display = 'none';
        _ovSafe.classList.remove('lgi-checking');
      }
      console.warn('[login transition] safety valve triggered — forced unlock after 4s');
    }
  }, 4000);

  const ov = document.getElementById('login-overlay');
  let finished = false;
  const fallbackTimer = setTimeout(() => {
    console.warn('[login transition] splash fallback release');
    finish();
  }, 3200);

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(fallbackTimer);
    clearTimeout(lockSafetyTimer);

    if (ov) {
      ov.style.display = 'none';
      ov.classList.remove('lgi-checking');
    }

    _autoRouteAfterLogin();

    setTimeout(() => {
      loginTransitionRunning = false;
    }, 300);
  };

  // v202d: set pre-fade hook — correct screen forced right before splash becomes transparent
  window._splashPreFade = () => {
    try{
      const _pf_role = getCurrentRole();
      _senseLog('[v206d debug] _splashPreFade role=', _pf_role);
      if(_pf_role==='tl'||_pf_role==='admin'){if(typeof showScreen==='function')showScreen('teamview');}
      else if(_pf_role==='sales'||_pf_role==='sales_tl'){
        // Set sales-mode body class FIRST so CSS gates work before render
        document.body.classList.add('sales-mode');
        if(_pf_role==='sales_tl') document.body.classList.add('sales-tl-mode');
        if(typeof setMode==='function') setMode('kam');
        if(typeof showScreen==='function') showScreen('sales-portview');
      }
      else{if(typeof showScreen==='function')showScreen('portview');}
    }catch(e){}
  };

// ── v224e: PWA Shimmer — shown on warm IDB resume instead of stale data ─────
// Injects skeleton placeholders for portview/teamview while ETag check runs.
// Cleared by RenderBus._flush() right before the first real render fires.
(function(){
  var _SHIMMER_CSS_ID = 'sense-shimmer-css';
  var _SHIMMER_IDS = ['pv-shimmer-wrap','tv-shimmer-wrap'];

  function _injectCSS(){
    if(document.getElementById(_SHIMMER_CSS_ID)) return;
    var s=document.createElement('style');
    s.id=_SHIMMER_CSS_ID;
    s.textContent=[
      '@keyframes sense-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}',
      '.sense-shimmer-line{border-radius:6px;background:linear-gradient(90deg,rgba(255,255,255,.04) 25%,rgba(255,255,255,.10) 50%,rgba(255,255,255,.04) 75%);background-size:200% 100%;animation:sense-shimmer 1.4s ease infinite;}',
      '.sense-shimmer-card{background:rgba(255,255,255,.03);border-radius:12px;padding:16px;margin-bottom:10px;}',
    ].join('');
    document.head.appendChild(s);
  }

  function _makeBar(w,h,mb){
    return '<div class="sense-shimmer-line" style="width:'+w+';height:'+h+'px;margin-bottom:'+(mb||8)+'px"></div>';
  }

  function _makeCard(){
    return '<div class="sense-shimmer-card">'+
      _makeBar('55%',11,10)+
      _makeBar('80%',20,10)+
      _makeBar('40%',9,0)+
    '</div>';
  }

  window._activatePortviewShimmer = function(){
    try{
      _injectCSS();
      // Summary row shimmer
      var summaryEl=document.getElementById('portview-summary-row');
      if(summaryEl && !document.getElementById('pv-shimmer-wrap')){
        var sw=document.createElement('div');
        sw.id='pv-shimmer-wrap';
        sw.style.cssText='padding:0 0 8px';
        sw.innerHTML=_makeBar('45%',11,10)+_makeBar('100%',6,0);
        summaryEl.innerHTML='';
        summaryEl.appendChild(sw);
      }
      // List shimmer (3 skeleton cards)
      var listEl=document.getElementById('portview-list');
      if(listEl && !document.getElementById('tv-shimmer-wrap')){
        var lw=document.createElement('div');
        lw.id='tv-shimmer-wrap';
        lw.innerHTML=_makeCard()+_makeCard()+_makeCard();
        listEl.innerHTML='';
        listEl.appendChild(lw);
      }
      window._pwaShimmerActive=true;
    }catch(e){}
  };

  window._activateTeamviewShimmer = function(){
    try{
      _injectCSS();
      var sumEl=document.getElementById('teamview-summary');
      if(sumEl){
        sumEl.innerHTML='<div style="padding:12px">'+_makeBar('40%',11,10)+_makeBar('100%',6,0)+'</div>';
      }
      var listEl=document.getElementById('teamview-list');
      if(listEl){
        listEl.innerHTML='<div style="padding:4px 0">'+_makeCard()+_makeCard()+_makeCard()+'</div>';
      }
      window._pwaShimmerActive=true;
    }catch(e){}
  };

  window._deactivatePortviewShimmer = function(){
    try{
      window._pwaShimmerActive=false;
      _SHIMMER_IDS.forEach(function(id){
        var el=document.getElementById(id);
        if(el && el.parentNode) el.parentNode.removeChild(el);
      });
    }catch(e){}
  };
})();

  // v224e: skip splash entirely on warm IDB boot
  // Conditions: IDB preloaded 3+ critical files + last_critical_ready < 90min
  // → show shimmer skeleton → ETag check in background → replace with real data
  var _canSkipSplash = (function(){
    try{
      if(!window._idbPreloaded) return false;
      var lr = Number(localStorage.getItem('sense_last_critical_ready')||0);
      if(!lr) return false;
      var ageMin = (Date.now()-lr)/60000;
      return ageMin < 90; // v224e: extended 30→90min — data updates once/day, daily workflow fits easily
    }catch(e){return false;}
  })();

  if(_canSkipSplash){
    // Option B: restore last screen + account before rendering
    var _rs = window._getResumeState ? window._getResumeState() : null;
    if(_rs){
      try{
        if(_rs.accountId&&_rs.accountId!=='default') window.currentAccountId=_rs.accountId;
      }catch(e){}
      _senseDataLog('RESUME','⚡ skip splash — restoring to '+(_rs.screen||'portview')+
        ' (IDB '+Math.round((Date.now()-Number(localStorage.getItem('sense_last_critical_ready')||0))/60000)+'min old)');
    }else{
      _senseDataLog('RESUME','⚡ skip splash — warm IDB boot (no saved state)');
    }
    // Hide splash + login overlay immediately
    var _splEl=document.getElementById('sense-splash');
    if(_splEl){_splEl.style.display='none';_splEl.style.opacity='0';}
    window._senseSplashActive=false;
    window._pendingRefreshAll=false;
    // Fire _autoRouteAfterLogin → loads R2 bundles, starts background ETag
    _autoRouteAfterLogin();
    // Restore saved screen (after route which defaults to portview/teamview)
    var _targetScreen='portview';
    if(_rs&&_rs.screen){_targetScreen=_rs.screen;}
    if(typeof showScreen==='function'){
      setTimeout(function(){
        try{
          var safeScreens=['portview','teamview'];
          if(safeScreens.indexOf(_targetScreen)>=0) showScreen(_targetScreen);
        }catch(e){}
      },0);
    }
    // v224e: show shimmer skeleton instead of stale data.
    // RenderBus will clear shimmer and render once ETag check completes (~200-400ms).
    setTimeout(function(){
      try{
        var onPv = document.getElementById('scr-portview') &&
                   document.getElementById('scr-portview').classList.contains('on');
        var onTv = document.getElementById('scr-teamview') &&
                   document.getElementById('scr-teamview').classList.contains('on');
        if(onPv && typeof window._activatePortviewShimmer==='function') window._activatePortviewShimmer();
        else if(onTv && typeof window._activateTeamviewShimmer==='function') window._activateTeamviewShimmer();
        // If shimmer not activated (wrong screen / DOM not ready), fall back to normal render
        if(!window._pwaShimmerActive){
          if(window.RenderBus) window.RenderBus.signal('resume-skip-splash');
          else if(typeof refreshAll==='function') refreshAll();
        }
        // v479-C5: shimmer safety fallback 3000→1500ms — ETag typically resolves <400ms;
        // 3s was too long, user saw skeleton card stuck for 1-3s on warm resume.
        setTimeout(function(){
          if(window._pwaShimmerActive){
            if(typeof window._deactivatePortviewShimmer==='function') window._deactivatePortviewShimmer();
            if(typeof refreshAll==='function') refreshAll();
          }
        }, 1500);
      }catch(e){
        // Fallback: render without shimmer
        if(window.RenderBus) window.RenderBus.signal('resume-skip-splash');
        else if(typeof refreshAll==='function') refreshAll();
      }
    }, 0);
    loginTransitionRunning=false;
    clearTimeout(lockSafetyTimer);
    return;
  }

  try {
    if (typeof showSenseSplash === 'function') {
      showSenseSplash(finish);
    } else {
      finish();
    }
  } catch(e) {
    console.warn('[login transition] splash failed:', e);
    finish();
  }
}

function _autoRouteAfterLogin() {
  // Auto-load core portfolio data from Cloudflare R2
  // Guard: skip if already started
  if(!sheetsLoadStarted&&typeof loadFromGoogleSheets==='function')loadFromGoogleSheets();

  const role = getCurrentRole();
  _senseLog('[v206d debug] _autoRouteAfterLogin:',role,currentUser&&currentUser.email);
  // v202 Fix 1: trigger bundle here — currentUser is guaranteed set at this point
  if(isRepRole(role)&&currentUser&&currentUser.email){
    // v225: removed _bundlePreWarming flag — consistent with TL prewarm removal
    _fetchKamBundle(currentUser.email).catch(()=>{}).finally(()=>{
      // v223: RenderBus batches with concurrent file arrivals
      if(window.RenderBus) window.RenderBus.signal('bundle');
      else refreshAll();
    });
  }
  // v206d: TL/Admin pre-warm is deliberately throttled and capped.
  // Old behavior fetched every KAM bundle sequentially after 5s, causing console noise + memory/CPU pressure.
  if(isTLRole(role)||isAdminRole(role))_startTlBundlePrewarm();
  if (isTLRole(role) || isAdminRole(role)) {
    setMode('kam');
    showScreen('teamview');
  } else if (isSalesAny && isSalesAny(role)) {
    // Sales: set body classes then route to Sales portview
    document.body.classList.add('sales-mode');
    if (isSalesTLRole && isSalesTLRole(role)) document.body.classList.add('sales-tl-mode');
    setMode('kam');
    showScreen('sales-portview');
  } else {
    setMode('kam');
    // v477-H5: guard IDB stale data — only auto-open single account when R2 data is settled.
    // Root cause: IDB preload runs before auth completes; portviewBulkData may contain prev-session
    // data → getPortviewAccounts().length===1 → wrong account auto-opens before fresh data arrives.
    // Fix: skip auto-select if sheets are mid-load; RenderBus will re-render portview when data ready.
    const _r2Settled = !(typeof sheetsLoadStarted !== 'undefined' && sheetsLoadStarted) ||
                       (typeof allCriticalReady === 'function' && allCriticalReady());
    const myAccounts = _r2Settled ? getPortviewAccounts() : [];
    if (myAccounts && myAccounts.length === 1) {
      portviewSelectAccount(myAccounts[0].id);
    } else {
      showScreen('portview');
    }
  }
}

// v220 PROFILE CACHE: stale-while-revalidate for currentUserProfile.
// Eliminates ~3s Supabase gate on every cold boot (warm AND cold — profile fetch is always slow).
// Key: sense_profile_v1_{userId}, TTL 24h. Invalidated on signOut.
// Safe fields: id, email, role, full_name, kam_name, squad — no tokens, no sensitive data.
const _PROFILE_CACHE_KEY_PREFIX='sense_profile_v1_';
const _PROFILE_CACHE_TTL=24*60*60*1000; // 24h
function _profileCacheGet(userId){
  try{
    var raw=localStorage.getItem(_PROFILE_CACHE_KEY_PREFIX+userId);
    if(!raw) return null;
    var obj=JSON.parse(raw);
    if(!obj||!obj.ts||!obj.profile) return null;
    if(Date.now()-obj.ts>_PROFILE_CACHE_TTL){ localStorage.removeItem(_PROFILE_CACHE_KEY_PREFIX+userId); return null; }
    return obj.profile;
  }catch(e){return null;}
}
function _profileCacheSet(profile){
  try{
    if(!profile||!profile.id) return;
    localStorage.setItem(_PROFILE_CACHE_KEY_PREFIX+profile.id,
      JSON.stringify({ts:Date.now(),profile:profile}));
  }catch(e){}
}
function _profileCacheClear(userId){
  try{ if(userId) localStorage.removeItem(_PROFILE_CACHE_KEY_PREFIX+userId); }catch(e){}
}

async function loadUserProfile() {
  if (!currentUser) return;
  try {
    const { data, error } = await supa.from('profiles').select('*').eq('id', currentUser.id).single();
    if (!error && data) {
      currentUserProfile = data;
      normalizeCurrentUserProfileRole();
      _profileCacheSet(currentUserProfile); // v220: persist for next cold boot
    } else {
      // Fallback: build minimal profile from auth session so role/email still work
      currentUserProfile = { id: currentUser.id, email: currentUser.email, role: 'rep', full_name: '' };
      normalizeCurrentUserProfileRole();
      if (error) console.warn('[loadUserProfile] profiles fetch error:', error.message);
    }
  } catch(e) {
    currentUserProfile = { id: currentUser.id, email: currentUser.email, role: 'rep', full_name: '' };
    normalizeCurrentUserProfileRole();
    console.warn('[loadUserProfile] exception:', e.message);
  }
}

async function doSignOut() {
  try {
    await supa.auth.signOut();
  } catch(e) {
    console.warn('[signOut]', e);
  }
  _profileCacheClear(currentUser && currentUser.id); // v220: invalidate cache on explicit logout
  // Note: onAuthStateChange(SIGNED_OUT) should also run. This fallback prevents stale splash/loader state.
  currentUser = null;
  currentUserProfile = null;
  _showLoginOverlayClean();
}

async function saveAltsToSupabase(accountId, altData) {
  if (!currentUser || !accountId) return;
  try {
    await supa.from('acct_alternatives').upsert({
      account_id: accountId,
      data: altData,
      generated_at: new Date().toISOString()
    }, { onConflict: 'account_id' });
  } catch(e) { console.warn('[Supabase] save alts failed:', e.message); }
}

async function loadAltsFromSupabase(accountId) {
  if (!currentUser || !accountId) return null;
  try {
    const { data, error } = await supa.from('acct_alternatives')
      .select('data, generated_at')
      .eq('account_id', accountId)
      .single();
    if (error || !data) return null;
    return data;
  } catch(e) { return null; }
}

function activateLocalMode(){
  // Show persona picker so tester can simulate KAM or TL without Supabase
  const overlay=document.getElementById('local-persona-overlay');
  if(overlay){overlay.style.display='flex';return;}
  // Fallback if overlay not in DOM
  _setLocalPersona('rep','guntinun.t@freshket.co','Guntinun (Monet)');
}

function _setLocalPersona(role, email, name){
  currentUser={id:'local-'+role,email:email};
  currentUserProfile={id:'local-'+role,email:email,full_name:name,kam_name:name,role:normalizeRole(role),squad:'SA'};
  // Reset account context so new persona starts clean (prevent stale account/visit bleed)
  currentAccountId='default';
  if(typeof kamStateCache!=='undefined')kamStateCache={accountId:null,html:''};
  const overlay=document.getElementById('local-persona-overlay');
  if(overlay)overlay.style.display='none';
  hideLoginOverlay();
  showToast('Local mode: '+name+' ('+role+')','🔧');
  // If portview data already loaded, re-filter for this persona
  if(portviewBulkData&&portviewBulkData.length)renderPortview();
}

async function checkSession() {
  // LOCAL DEV MODE: ?local=1 bypasses Supabase auth entirely
  if(window.location.search.includes('local=1')){
    activateLocalMode();
    return;
  }
  if(window.self!==window.top){activateLocalMode();return;}
  // Password recovery links should show reset form, not bypass login into the app.
  if(_urlLooksLikePasswordRecovery()){
    try {
      const { data: { session } } = await supa.auth.getSession();
      if (session?.user) currentUser = session.user;
    } catch(e) {
      console.warn('[password recovery] session check failed:', e.message);
    }
    showPasswordResetForm();
    return;
  }
  // Show "checking session" state — hides form, shows dots
  const ov = document.getElementById('login-overlay');
  if(ov) ov.classList.add('lgi-checking');
  try {
    const { data: { session } } = await supa.auth.getSession();
    // Fix v194 Guard B: set flag BEFORE await to block onAuthStateChange(INITIAL_SESSION)
    // from racing into hideLoginOverlay() while checkSession is still handling it.
    if (session && !currentUser) {
      window._sessionCheckHandling = true;
      currentUser = session.user;
      // v220 PROFILE CACHE: same cache-first pattern as onAuthStateChange path.
      var _cpcs=_profileCacheGet(session.user.id);
      if(_cpcs){
        currentUserProfile=_cpcs; normalizeCurrentUserProfileRole();
        _senseDataLog('PROFILE','⚡ cache hit (checkSession) → hideLoginOverlay immediately');
        // v348: patch R2 for Sales before fetch
        try{ if(typeof _patchR2FilesForSales==='function') _patchR2FilesForSales(); }catch(e){}
        if(!sheetsLoadStarted&&typeof loadFromGoogleSheets==='function')loadFromGoogleSheets();
        window._sessionCheckHandling=false;
        hideLoginOverlay();
        loadUserProfile(); // background revalidate
      }else{
        await loadUserProfile();
        // v348: patch R2 for Sales before fetch
        try{ if(typeof _patchR2FilesForSales==='function') _patchR2FilesForSales(); }catch(e){}
        if(!sheetsLoadStarted&&typeof loadFromGoogleSheets==='function')loadFromGoogleSheets();
        window._sessionCheckHandling = false;
        hideLoginOverlay();
      }
      return;
    }
  } catch(e) {
    window._sessionCheckHandling = false;
    // Network error (offline, etc.) — fall through to show login form
    console.warn('[checkSession] network error:', e.message);
  }
  // No valid session or error — reveal login form
  if(ov) ov.classList.remove('lgi-checking');
}

// v206a: shared PWA resume session verifier.
// Goal: Home Screen app resume should verify silently and keep the current screen when the session is alive.
async function _pwaSilentSessionCheck(reason, graceMs){
  if(passwordRecoveryMode)return true;
  if(window._pwaResumeCheckInFlight)return window._pwaResumeCheckInFlight;
  window._pwaResumeCheckInFlight=(async()=>{
    try{
      const first=await supa.auth.getSession();
      let session=first&&first.data&&first.data.session;
      if(session&&session.user){
        currentUser=session.user;
        const ov=document.getElementById('login-overlay');
        if(ov&&currentUser){ov.style.display='none';ov.classList.remove('lgi-checking');}
        return true;
      }
      await new Promise(r=>setTimeout(r,graceMs||2500));
      const second=await supa.auth.getSession();
      session=second&&second.data&&second.data.session;
      if(session&&session.user){
        currentUser=session.user;
        const ov=document.getElementById('login-overlay');
        if(ov&&currentUser){ov.style.display='none';ov.classList.remove('lgi-checking');}
        return true;
      }
      if(currentUser){
        console.warn('[pwa:v206a] confirmed session lost after resume',reason);
        currentUser=null;
        currentUserProfile=null;
        sheetsLoadStarted=false;
        _showLoginOverlayClean();
      }
      return false;
    }catch(e){
      // Offline / flaky mobile network: do not disrupt the current screen.
      console.warn('[pwa:v206a] resume session check skipped',reason,e&&e.message?e.message:e);
      return true;
    }finally{
      window._pwaResumeCheckInFlight=null;
    }
  })();
  return window._pwaResumeCheckInFlight;
}

// Phase 10: Auth/session runtime boundary (adapter-first; no behavior change intended).
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


// ════════════════════════════════════════
// SECTION:SAMPLE_DATA
// SAMPLE DATA
// ════════════════════════════════════════
const SAMPLE = {
  history:[
    {m:'พ.ย. 2568',s:145000,orders:50},{m:'ธ.ค. 2568',s:175600,orders:56},
    {m:'ม.ค. 2569',s:162000,orders:53},{m:'ก.พ. 2569',s:136400,orders:44},
    {m:'มี.ค. 2569',s:176200,orders:57},{m:'เม.ย. 2569',s:176249,orders:58},
  ],
  cats:[
    {n:'เนื้อสัตว์',s:54793,p:31.1,c:'#f05000'},{n:'DG Food',s:36492,p:20.7,c:'#f0b000'},
    {n:'DG Non-food',s:23970,p:13.6,c:'#a0a0a0'},{n:'Processed',s:21150,p:12.0,c:'#f0a070'},
    {n:'ผัก',s:15686,p:8.9,c:'var(--tk-ok-500)'},{n:'เครื่องดื่ม',s:12866,p:7.3,c:'#5fe3a8'},
    {n:'ไข่',s:6698,p:3.8,c:'#f0e0b0'},{n:'ปลา',s:4583,p:2.6,c:'#008060'},
  ],
  skus:[
    {id:10417,n:'หมูบด / เนื้อหมูบดละเอียด A',d:'เนื้อสัตว์',s:8775,p:4.97,q:70,u:125.75,gmv:8775},
    {id:47565,n:'สันคอหมูตัดแต่ง A (K)',d:'เนื้อสัตว์',s:8736,p:4.95,q:47,u:187,gmv:8736},
    {id:45855,n:'น้ำมันปาล์ม ตราเกสร 18L',d:'DG Food',s:8020,p:4.55,q:8.5,u:936,gmv:8020},
    {id:99001,n:'เต้าหู้โอฮาโย (OHAYO)',d:'Processed',s:7850,p:4.45,q:85,u:92,gmv:7850},
    {id:46381,n:'อกไก่ลอกหนัง 250-300 กรัม/ชิ้น',d:'เนื้อสัตว์',s:7410,p:4.20,q:68,u:108.64,gmv:7410},
    {id:34308,n:'สันในไก่ ตราซีพี (5kg pack)',d:'เนื้อสัตว์',s:6930,p:3.93,q:14,u:495,gmv:6930},
    {id:99002,n:'น้ำดื่มแร่ธาตุ (กล่อง)',d:'เครื่องดื่ม',s:6800,p:3.86,q:40,u:170,gmv:6800},
    {id:42349,n:'ปีกไก่กลาง (5kg pack)',d:'เนื้อสัตว์',s:5390,p:3.06,q:7,u:770,gmv:5390},
    {id:28585,n:'สะโพกไก่เลาะกระดูก ซีพี (2kg)',d:'เนื้อสัตว์',s:3200,p:1.81,q:10,u:320,gmv:3200},
    {id:37648,n:'น้ำมันไก่ ตราเบทาโกร',d:'DG Food',s:2944,p:1.67,q:30,u:98.13,gmv:2944},
    {id:99003,n:'กระเทียม สด',d:'ผัก',s:2100,p:1.19,q:35,u:60,gmv:2100},
    {id:99004,n:'ต้นหอม',d:'ผัก',s:1950,p:1.11,q:43,u:45,gmv:1950},
    {id:99005,n:'ไข่ไก่เบอร์ 0',d:'ไข่',s:1820,p:1.03,q:18.2,u:100,gmv:1820},
    {id:99006,n:'ซีอิ๊วขาว ตราแม่ครัว 1L',d:'DG Food',s:1680,p:0.95,q:28,u:60,gmv:1680},
    {id:99007,n:'น้ำมันหอย ตราแม่ครัว 800ml',d:'DG Food',s:1560,p:0.88,q:12,u:130,gmv:1560},
    {id:99008,n:'มิโซะ ญี่ปุ่น',d:'Processed',s:1480,p:0.84,q:20,u:74,gmv:1480},
    {id:99009,n:'ขิงสด',d:'ผัก',s:1350,p:0.77,q:20,u:67.5,gmv:1350},
    {id:99010,n:'กุ้งขาวสด 30-35 ตัว/kg',d:'ปลา',s:1290,p:0.73,q:5,u:258,gmv:1290},
    {id:99011,n:'หอมแดง',d:'ผัก',s:1200,p:0.68,q:30,u:40,gmv:1200},
    {id:99012,n:'แครอท',d:'ผัก',s:1100,p:0.62,q:44,u:25,gmv:1100},
  ],
  outlets_monthly:{
    'พ.ย. 2568':[{outlet_id:'o1',outlet_name:'สาขาสีลม',gmv:78000,orders:26},{outlet_id:'o2',outlet_name:'สาขาทองหล่อ',gmv:42000,orders:16},{outlet_id:'o3',outlet_name:'สาขาพระราม 9',gmv:25000,orders:8}],
    'ธ.ค. 2568':[{outlet_id:'o1',outlet_name:'สาขาสีลม',gmv:92000,orders:30},{outlet_id:'o2',outlet_name:'สาขาทองหล่อ',gmv:51000,orders:18},{outlet_id:'o3',outlet_name:'สาขาพระราม 9',gmv:32600,orders:8}],
    'ม.ค. 2569':[{outlet_id:'o1',outlet_name:'สาขาสีลม',gmv:86000,orders:28},{outlet_id:'o2',outlet_name:'สาขาทองหล่อ',gmv:47000,orders:16},{outlet_id:'o3',outlet_name:'สาขาพระราม 9',gmv:29000,orders:9}],
    'ก.พ. 2569':[{outlet_id:'o1',outlet_name:'สาขาสีลม',gmv:72000,orders:22},{outlet_id:'o2',outlet_name:'สาขาทองหล่อ',gmv:39000,orders:14},{outlet_id:'o3',outlet_name:'สาขาพระราม 9',gmv:25400,orders:8}],
    'มี.ค. 2569':[{outlet_id:'o1',outlet_name:'สาขาสีลม',gmv:93000,orders:30},{outlet_id:'o2',outlet_name:'สาขาทองหล่อ',gmv:52000,orders:18},{outlet_id:'o3',outlet_name:'สาขาพระราม 9',gmv:31200,orders:9}],
    'เม.ย. 2569':[{outlet_id:'o1',outlet_name:'สาขาสีลม',gmv:94800,orders:31},{outlet_id:'o2',outlet_name:'สาขาทองหล่อ',gmv:49500,orders:17},{outlet_id:'o3',outlet_name:'สาขาพระราม 9',gmv:31949,orders:10}],
  },
};

const GOOD_SKUS=[
  {n:'สันในไก่ ซีพี (5kg pack)',r:'ซื้อ bulk ฿99/kg ถูกกว่าซื้อ 1kg อยู่ 29%'},
  {n:'ปีกไก่กลาง (5kg pack)',r:'bulk pack ฿154/kg ถูกกว่า 1kg แล้ว'},
  {n:'หนังไก่, เนื้อหมูบด (main)',r:'ไม่มียี่ห้อ ราคาดีที่สุดในกลุ่มแล้ว'},
];

const CAT_COLORS={'เนื้อสัตว์':'#f05000','DG Food':'#f0b000','DG Non-food':'#a0a0a0','Processed':'#f0a070','ผัก':'var(--tk-ok-500)','เครื่องดื่ม':'#5fe3a8','ไข่':'#f0e0b0','ปลา':'#008060','Meat':'#f05000','Processed Food':'#f0a070','Fish & Seafood':'#008060','Vegetable':'var(--tk-ok-500)','Egg':'#f0e0b0','Beverage Non-alcohol':'#5fe3a8','Beverage Alcohol':'#a0608c','Fruit':'#e06030','BASIC FOOD':'#f0b000','FROZEN FOOD':'#60b0d0','BAKERY':'#d09060','HOUSEHOLD':'#a0a0a0'};
const getCatColor=n=>CAT_COLORS[n]||'#d0d0d0';

// HARDCODED OPPS (sample data fallback)
const OPPS_SAMPLE=[
  {id:1,cat:'น้ำมัน',curId:45855,curName:'น้ำมันปาล์ม ตราเกสร',curSpec:'18L / ถัง',curP:935.93,curU:'บาท/ถัง',monthlyGmv:12150,monthlyQty:8.5,qu:'ถัง/เดือน',
   alts:[{altId:42614,altName:'น้ำมันปาล์ม ตราผึ้ง',altSpec:'18L / ถัง (ถังเหลือง)',altP:838.57,altU:'บาท/ถัง',save:827,pct:10.4,note:'ใช้แทนกันได้เลย คุณภาพใกล้เคียง ทอดทุกประเภท',conf:'high',recommended:true},
          {altId:32374,altName:'น้ำมันปาล์ม ตรามรกต',altSpec:'18L / ถัง',altP:871.00,altU:'บาท/ถัง',save:551,pct:6.9,note:'ใช้แทนได้ มั่นใจสูง',conf:'high',recommended:false}]},
  {id:2,cat:'เนื้อสัตว์',curId:10417,curName:'หมูบด เกรด A',curSpec:'1 kg/pack',curP:125.75,curU:'บาท/kg',monthlyGmv:8802,monthlyQty:70,qu:'kg/เดือน',
   alts:[{altId:42628,altName:'เนื้อหมูบด CUT AND TRIMMED',altSpec:'1 kg/pack',altP:116.62,altU:'บาท/kg',save:639,pct:7.3,note:'หมูบดเหมือนกัน แนะนำทดสอบในเมนูที่ใช้เนื้อบดก่อน',conf:'medium',recommended:true}]},
  {id:3,cat:'เนื้อสัตว์',curId:46381,curName:'อกไก่ลอกหนัง',curSpec:'250-300 กรัม/ชิ้น',curP:108.64,curU:'บาท/kg',monthlyGmv:7480,monthlyQty:68,qu:'kg/เดือน',
   alts:[{altId:10422,altName:'อกไก่ลอกหนัง ทั่วไป',altSpec:'ไม่ระบุขนาด · 1 kg/pack',altP:98.75,altU:'บาท/kg',save:672,pct:9.1,note:'อกไก่เหมือนกัน ถ้า portion control เคร่ง ลองสั่งทดสอบ 5kg ก่อน',conf:'medium',recommended:true},
          {altId:18871,altName:'อกไก่ลอกหนัง ตราเบทาโกร',altSpec:'ทั่วไป',altP:99.91,altU:'บาท/kg',save:593,pct:8.2,note:'แบรนด์เบทาโกร คุณภาพดี',conf:'medium',recommended:false}]},
  {id:4,cat:'เนื้อสัตว์',curId:28585,curName:'สะโพกไก่เลาะกระดูก ซีพี',curSpec:'2 kg/pack',curP:320,curU:'บาท/pack',monthlyGmv:1600,monthlyQty:5,qu:'pack/เดือน',
   alts:[{altId:31016,altName:'สะโพกไก่เลาะกระดูก',altSpec:'ไม่มียี่ห้อ · 1 kg/pack',altP:131.88,altU:'บาท/kg',save:280,pct:17.5,note:'Cut เดียวกัน ส่วนต่าง 17%',conf:'medium',recommended:true}]},
  {id:5,cat:'เนื้อสัตว์',curId:44806,curName:'น่องไก่ล้วน',curSpec:'7-8 ชิ้น/kg',curP:90.56,curU:'บาท/kg',monthlyGmv:1268,monthlyQty:14,qu:'kg/เดือน',
   alts:[{altId:40138,altName:'น่องไก่ทั่วไป',altSpec:'1 kg/pack',altP:84.37,altU:'บาท/kg',save:87,pct:6.8,note:'น่องไก่เหมือนกัน ไม่ระบุจำนวนชิ้น',conf:'medium',recommended:true},
          {altId:10425,altName:'น่องไก่ ตราเบทาโกร',altSpec:'1 kg/pack',altP:85.05,altU:'บาท/kg',save:77,pct:6.1,note:'แบรนด์เบทาโกร',conf:'medium',recommended:false}]},
];

// ════════════════════════════════════════
// STATE
// ════════════════════════════════════════
let OPPS = [...OPPS_SAMPLE];
let D={history:[],cats:[],cats_monthly:{},skus:[],skus_monthly:{},alts:[],alts_meta:{status:'none',verified_count:0,total_count:0,verified_at:null,bulk_loaded_at:null},outlets_monthly:{},current_month:null,sku_current:[],meta:{accountName:'',accountId:'',kamName:''}};
let fileStatus={history:false,categories:false,skus:false,outlets:false,alternatives:false,'matcher_input':false,'current-month':false,'sku-current':false};
let sessionUploads=new Set();
let sel=new Set([1,2,3]);
let selAlt={};
let isKAM=false;
let chatOpen=false,chatHist=[],aiLoading=false;
let oppFilter='all';
let aiCameFromPreview=false; // one-shot: triggers count-up animation on first visit to opps
let senseActivated=false;    // Sprint 2: set when Sense scan completes → persists until data refresh
let footerUnlocked=false;    // Sprint 2: footer hidden until user taps plan selector
let currentPlanMode='all'; // 'high' | 'all' | 'custom'
let expandedOpps=new Set();
let pbExpandedAlts=new Set(); // plan builder alt expand state
let collapsedCats=new Set();  // plan builder category collapse state
let skuFilter='ทั้งหมด';
let kamSubtab='thismonth'; // 'thismonth' | 'lastmonth'
let churnExpanded=false;let skuSignalInfoOpen=false;  // expand all SKU signals beyond initial 15
let skuSubstituteMap={};  // {churned_item_id: {substituteName, spendChange, reason}} — เดือนนี้ tab
let skuSubstituteLoading=false;
let skuSubstituteDone=false;
let skuSubstituteMapLM={};  // {churned_sku_name: {...}} — เม.ย. (last month, name-keyed)
let skuSubstituteLoadingLM=false;
let skuSubstituteDoneLM=false;
let portviewFilter='all'; // portview filter
let portviewBulkData=[]; // loaded from portview_bulk.csv (Q8 output)
// ── v52 localStorage fix ──────────────────────────────────────────────────
// Bulk ops data is IN-MEMORY ONLY — too large for localStorage (quota ~5-10MB).
// These globals are populated by bulk upload handlers and lost on page refresh.
// localStorage only stores user-generated work: verified alts, plan, current_month.
// ─────────────────────────────────────────────────────────────────────────
let bulkHistoryData={};    // Q9: aid → [{m,s,orders}]
let bulkCurrentMonthData={};  // Q8E: aid → {month_label,gmv_to_date,days_elapsed,...}
let bulkAccountNames={};  // merged from Q8E+Q9: aid → account name string
let bulkCatsData={};       // Q2B: aid → {month_label → [{n,s,p,c}]}
let bulkSkusData={};       // Q3B: aid → {month_label → [sku objects]}
const _bulkSkusSeen={};   // v202 dedup: aid → mo → Set<itemId> — prevents double-push when bundle+bulk both load
let bulkPriceData={};      // Q6B: aid → {item_id → [{mo, unit_price, avg_piece_price}]} (6-month price history for sparkline)
let bulkHandoverData={ byAccountId:{}, byKamName:{} }; // Q10: portview_handover.csv — transfer out per KAM
let bulkOutletsData={};    // Q5B: aid → {month_label → [outlet objects]}
let bulkUpsellData={ byKam:{}, baselineGroups:{}, loaded:false }; // Q3C: sense_upsell_{safekey}.csv — per-KAM demand bundle
let bulkUpsellTeamData={}; // team summary: {[kamEmail]:{p1_gmv,p3_incr,outlet_gmv,tl_upsell_base}}
let bulkSkuCurrentData={}; // Q7B: aid → [{item_id, orders_this_month, gmv_to_date, item_name_th, last_order_date}]
let bulkAltsUnverified={}; // Q4B: aid → [unverified alt pairs]
let bulkKamNames={};       // Q8E v2: aid → kam_name string (for TL grouping)
let portviewLevel='rep';  // 'rep' | 'tl' | 'rep-detail' (TL viewing specific rep)
let teamviewKamFilter=null; // null=show all KAMs, 'email@...'=show that KAM's accounts
let tvViewMode='full'; // 'full'|'compact' (teamview)
let pvViewMode='full'; // 'full'|'compact' (portview — KAM's own accounts)
let pvSortMode='impact'; // v205c default: positive impact highest first (green accounts)
let pvSortDir=-1;        // -1=descending (runrate > baseline first)
let teamviewAiDone=false;
let portviewRepEmail=null; // which rep TL is viewing
let portviewAiDone=false;
let activeMonth=0;
let portfolioMonth=''; // '' = last month (default)
let currentAccountId='default';
// Account Discovery
let accountList=[];let selectedAccount=null;
// Outlet
let D_outlets=[];let outletsExpanded=false;
// Matcher
let matcherRawCsv='';let matcherRunning=false;
let matcherProgress={current:0,total:0,found:0};
let matcherMode='fast';let matcherScope='all';let matcherModel='haiku';
let kamModel='sonnet'; // KAM briefing model (separate from Matcher) — default Sonnet
let aiProvider=localStorage.getItem((FRESHKET_APP_CONFIG.ai&&FRESHKET_APP_CONFIG.ai.providerStorageKey)||'ai_provider')||((FRESHKET_APP_CONFIG.ai&&FRESHKET_APP_CONFIG.ai.defaultProvider)||'claude'); // 'claude' | 'gemini'
let geminiApiKey=''; // Phase 2: browser-held AI keys are disabled by default; use AI proxy.
let kamStateCache={html:null,insights:null,accountId:null};
let skuView='gmv'; // 'gmv' | 'price' — SKU list view mode
let priceMovFilter=null; // 'up'|'stable'|'down'|null
let heroLockedToCurrent=false; // true when D.current_month is shown in hero (restaurant mode)

// ════════════════════════════════════════
// KAM SIGNALS (rule-based, no AI)
// ════════════════════════════════════════
// SECTION:KAM_SIGNALS
function computeKamSignals(){
  const signals=[];
  const hist=D.history.length?D.history:[];
  const last=hist[hist.length-1]||{s:0,orders:0,m:''};
  const prev=hist[hist.length-2]||null;
  // GMV drop >15%
  if(prev&&prev.s>0&&last.s<prev.s*0.85){
    const drop=Math.round((1-last.s/prev.s)*100);
    // Context check: if drop month is known holiday period → softer signal
    const dropMo=(last.m||'').split(' ')[0];
    const isHoliday=['เม.ย.','ม.ค.','ธ.ค.'].includes(dropMo);
    const sigType=isHoliday?'explore':'urgent';
    const ctxNote=isHoliday?' (ช่วงเทศกาล)':'';
    signals.push({type:sigType,main:`ยอดซื้อลด ${drop}%${ctxNote}`,sub:`${prev.m} → ${last.m}`});
  } else if(prev&&prev.s>0&&last.s>prev.s*1.15){
    const rise=Math.round((last.s/prev.s-1)*100);
    signals.push({type:'healthy',main:`ยอดซื้อเพิ่ม ${rise}%`,sub:`${prev.m} → ${last.m}`});
  }
  // SKU dropout
  const sm=computeSkuMovement();
  if(sm){
    const bigDrops=(sm.droppedSkus||[]).filter(s=>s.gmv>5000);
    if(bigDrops.length>0){
      signals.push({type:'urgent',main:`หยุดสั่ง ${bigDrops.length} รายการ`,sub:bigDrops[0].name.slice(0,22)+(bigDrops[0].name.length>22?'...':'')});
    }
    const newBig=(sm.newSkus||[]).filter(s=>s.gmv>3000);
    if(newBig.length>0){
      signals.push({type:'explore',main:`SKU ใหม่ ${newBig.length} รายการ`,sub:newBig[0].name.slice(0,22)+(newBig[0].name.length>22?'...':'')});
    }
  }
  // Big savings not started
  if(totalAll()>20000&&OPPS.length>0){
    signals.push({type:'opportunity',main:`โอกาสประหยัด ${fmt(totalAll())}`,sub:`${OPPS.length} รายการ ยังไม่ได้เริ่ม`});
  }
  // ── v55: removed "ยอดซื้อปกติ" healthy fallback —
  //   conflicts with locked rule "show only negative signals" and
  //   appeared during AI loading state, creating false "all clear" signal.
  return signals.slice(0,3);
}

function openVerifySheet(){
  const acctName=D.meta.accountName||'ร้านนี้';
  const unverified=(D.alts||[]).filter(a=>!a.confidence||a.confidence==='unverified').length;
  const nameEl=document.getElementById('verify-sheet-acct-name');
  const subEl=document.getElementById('verify-sheet-sub');
  if(nameEl)nameEl.textContent=acctName;
  if(subEl)subEl.textContent=`${unverified>0?unverified+' คู่ยังไม่ผ่านการเทียบสเปค':'พร้อมเทียบสเปค'} · Sense จะเช็คว่าใช้แทนกันได้จริง`;
  syncVsStatus();vsUpdateMode();
  document.getElementById('verifySheet')?.classList.add('open');
  document.getElementById('verifySheetOverlay')?.classList.add('on');
  document.body.style.overflow='hidden';
}
function closeVerifySheet(){
  document.getElementById('verifySheet')?.classList.remove('open');
  document.getElementById('verifySheetOverlay')?.classList.remove('on');
  document.body.style.overflow='';
  // Reset layout so next open starts at config (unless mid-run)
  if(!matcherRunning){
    const cfg=document.getElementById('vs-config-section');if(cfg)cfg.style.display='block';
    const prog=document.getElementById('vs-progress-wrap');if(prog)prog.style.display='none';
    const res=document.getElementById('vs-result');if(res)res.style.display='none';
  }
}
function goToSenseOpportunitiesAfterVerify(){
  // v207a: one safe exit path from matcher back to Opportunity, especially inside KAM/PWA fixed-scroll mode.
  senseActivated=true;
  footerUnlocked=true;
  if(isKAM&&currentAccountId&&currentAccountId!=='default')window._kamSenseReturn=true;
  closeVerifySheet();
  try{if(typeof renderOpps==='function')renderOpps();}catch(e){}
  showScreen('opportunities');
  setTimeout(()=>{
    const grp=document.getElementById('swipe-grp-b');
    if(grp)try{grp.scrollTo({top:0,left:0,behavior:'instant'});}catch(e){grp.scrollTop=0;}
    try{if(typeof updatePbFooter==='function')updatePbFooter();}catch(e){}
  },80);
}
function vsUpdateMode(){
  const m=matcherMode||'fast';const isF=m==='fast';
  const hEl=document.getElementById('vs-haiku');const sEl=document.getElementById('vs-sonnet');
  if(!hEl||!sEl)return;
  hEl.style.borderColor=isF?'var(--g500)':'var(--n200)';hEl.style.background=isF?'var(--g900)':'var(--n50)';
  hEl.querySelector('div').style.color=isF?'#fff':'var(--n700)';
  sEl.style.borderColor=!isF?'var(--g500)':'var(--n200)';sEl.style.background=!isF?'var(--g900)':'var(--n50)';
  sEl.querySelector('div').style.color=!isF?'#fff':'var(--n700)';
}
function syncVsStatus(){
  const src=document.getElementById('gen-pre-status');
  const dst=document.getElementById('vs-pre-status');
  if(src&&dst)dst.textContent=src.textContent;
  const genBtn=document.getElementById('gen-btn');
  const runLabel=document.getElementById('vs-run-label');
  if(genBtn&&runLabel)runLabel.textContent=genBtn.querySelector('svg+*')?.textContent||genBtn.textContent.trim().replace(/^\S+\s*/,'');
}

function renderKamSignalBar(){
  const el=document.getElementById('kam-signal-bar');if(!el)return;
  const signals=computeKamSignals();
  if(!signals.length){el.style.display='none';return;}
  el.style.display='flex';
  el.innerHTML=signals.map(s=>`<div class="kam-signal-chip ${s.type}"><span class="kam-signal-main">${s.main}</span></div>`).join('');
}


// ════════════════════════════════════════
// UTILS
// ════════════════════════════════════════
const fmt=n=>{const r='฿'+Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');return r;};
window.fmt=fmt;

// ── Toast notification ──
let _toastTimer=null;
// SECTION:UTILS
function showToast(msg,icon='✓'){
  let t=document.getElementById('app-toast');
  if(!t){t=document.createElement('div');t.id='app-toast';t.className='toast';document.body.appendChild(t);}
  t.textContent=icon+' '+msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>t.classList.remove('show'),2200);
}
const getAlt=o=>{const idx=selAlt[o.id]??o.alts.findIndex(a=>a.recommended)??0;return o.alts[idx]||o.alts[0];};
const totalSel=()=>OPPS.filter(o=>sel.has(o.id)).reduce((s,o)=>s+getAlt(o).save,0);
const totalAll=()=>OPPS.reduce((s,o)=>s+getAlt(o).save,0);
// v207e: do not use SAMPLE fallback in live scoring/reporting. If account history is missing,
// fall back only to current-month data, otherwise 0 so the UI shows data limits honestly.
const curSpend=()=>{
  const h=Array.isArray(D.history)&&D.history.length?D.history[D.history.length-1]:null;
  if(h&&Number(h.s)>0)return Number(h.s)||0;
  const c=D.current||D.current_month||{};
  return Number(c.gmv_to_date||c.gmvToDate||c.s||0)||0;
};
function getSenseScoreMetrics(){
  const spend=curSpend();
  const savPct=spend>0?totalAll()/spend*100:0;
  const skuCoverage=(D.alts&&D.alts.length>0&&D.skus&&D.skus.length>0)?Math.min(1,D.alts.length/(D.skus.length*0.3)):0;
  const score=Math.min(95,Math.max(45,Math.round(95-savPct*1.8-(1-skuCoverage)*10)));
  return{spend,savPct,skuCoverage,score};
}
const computeSenseScore=()=>getSenseScoreMetrics().score;

function animN(el,to,dur){
  if(!el)return;
  if(window._suppressAnimN){el.textContent=fmt(Math.round(to));return;}
  el._animNId=(el._animNId||0)+1;
  const myId=el._animNId;
  const start=Date.now();
  (function tick(){
    if(el._animNId!==myId)return;
    const t=Math.min((Date.now()-start)/dur,1);
    const e=1-Math.pow(1-t,3);
    el.textContent=fmt(Math.round(to*e));
    if(t<1)requestAnimationFrame(tick);
  })();
}

// ════════════════════════════════════════
// MULTI-ACCOUNT STORAGE
// ════════════════════════════════════════
// ACCOUNT STORAGE — multi-account
// Key: ciq_acct_{accountId}  (full ID, no truncation)
// Index: ciq_index [{id,name,kamName,monthly,savings,ts}]
// ════════════════════════════════════════
// SECTION:STORAGE
function _acctKey(id){return 'ciq_acct_'+(id||currentAccountId);}

function getAccountIndex(){
  try{
    const raw=JSON.parse(localStorage.getItem('ciq_index')||'[]');
    // Always deduplicate by id at read time — keep first occurrence (newest saved)
    const seen=new Set();
    return raw.filter(a=>a&&a.id&&!seen.has(a.id)&&seen.add(a.id));
  }catch(e){return[];}
}

function updateAccountIndex(){
  if(!D.history.length&&!D.skus.length)return;
  const idx=getAccountIndex().filter(a=>a.id!==currentAccountId);
  idx.unshift({id:currentAccountId,name:D.meta.accountName||'ไม่ระบุชื่อ',kamName:D.meta.kamName||'',monthly:curSpend(),savings:totalAll(),ts:new Date().toISOString()});
  try{localStorage.setItem('ciq_index',JSON.stringify(idx.slice(0,50)));}catch(e){}
}


let _saveTimer=null;
function debouncedSave(){clearTimeout(_saveTimer);_saveTimer=setTimeout(saveToStorage,1500);}

function saveToStorage(){
  try{
    updateAccountIndex();
    // ── v52: Only persist user work (small). Bulk ops data stays in-memory globals. ──
    const smallD={
      alts:D.alts.filter(p=>p.confidence&&p.confidence!=='unverified'), // verified only
      alts_meta:D.alts_meta,
      // v203: current_month excluded — always sourced from portview (bulkCurrentMonthData), never localStorage
      meta:D.meta,
      sku_current:[]  // per-account churn; skip — regenerated from bulk
    };
    localStorage.setItem(_acctKey(),JSON.stringify({D:smallD,fileStatus,sel:Array.from(sel),selAlt,currentPlanMode,ts:new Date().toISOString()}));
  }catch(e){console.warn('save failed',e);}
}

function loadFromStorage(targetId){
  try{
    if(targetId)currentAccountId=targetId;
    const aid=currentAccountId;
    // Reset D completely before loading
    D={history:[],cats:[],cats_monthly:{},skus:[],skus_monthly:{},alts:[],
       alts_meta:{status:'none',verified_count:0,total_count:0,verified_at:null,bulk_loaded_at:null},
       outlets_monthly:{},current_month:null,sku_current:[],
       meta:{accountName:'',accountId:aid||'',kamName:''}};
    sel=new Set();selAlt={};OPPS.length=0;

    // ── Step 1: Load persisted user work from localStorage ──
    const s=localStorage.getItem(_acctKey());
    if(s){
      const{D:d,fileStatus:fs,sel:sv,selAlt:sa,currentPlanMode:sp,ts}=JSON.parse(s);
      if(d){
        D.alts=d.alts||[];         // verified alts (user work)
        D.alts_meta=d.alts_meta||D.alts_meta;
        // v203: current_month intentionally NOT loaded from localStorage — always sourced from portview
        D.meta=d.meta||D.meta;
        D.sku_current=d.sku_current||[];
      }
      fileStatus=fs||{};
      if(sv&&Array.isArray(sv))sel=new Set(sv);
      if(sa&&typeof sa==='object')selAlt=sa;
      if(sp)currentPlanMode=sp;
      const updEl=document.getElementById('dp-updated-time');
      if(updEl&&ts)updEl.textContent='โหลดครั้งล่าสุด: '+new Date(ts).toLocaleString('th-TH');
      // v203: one-time migration — remove stale current_month from existing localStorage entries
      if(d&&d.current_month!==undefined){
        try{const _raw=JSON.parse(s);if(_raw.D)delete _raw.D.current_month;localStorage.setItem(_acctKey(),JSON.stringify(_raw));}catch(e){}
      }
    }

    // ── Step 2: Inject bulk ops data from in-memory globals ──
    const _moSortBulk=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
    // Sort history chronologically (Q9 SQL sorts by Thai month text = alphabetical = wrong)
    D.history=(bulkHistoryData[aid]||[]).slice().sort((a,b)=>_moSortBulk(a.m)-_moSortBulk(b.m));
    D.cats_monthly=bulkCatsData[aid]||{};
    const cMoKeys=Object.keys(D.cats_monthly).sort((a,b)=>_moSortBulk(b)-_moSortBulk(a));
    D.cats=cMoKeys.length?D.cats_monthly[cMoKeys[0]]:[];
    D.skus_monthly=bulkSkusData[aid]||{};
    const sMoKeys=Object.keys(D.skus_monthly).sort((a,b)=>_moSortBulk(b)-_moSortBulk(a));
    D.skus=sMoKeys.length?D.skus_monthly[sMoKeys[0]]:[];
    D.outlets_monthly=bulkOutletsData[aid]||{};
    // Inject sku_current from Q7B bulk if exists, else keep per-account upload from localStorage
    if(bulkSkuCurrentData[aid])D.sku_current=bulkSkuCurrentData[aid];
    // Inject current_month — bulk always wins over stale localStorage
    if(bulkCurrentMonthData[aid])D.current_month=bulkCurrentMonthData[aid];
    // Inject account name — bulk always wins over stale localStorage meta
    if(bulkAccountNames[aid])D.meta.accountName=bulkAccountNames[aid];
    else if(!D.meta.accountName){const _idxEntry=getAccountIndex().find(x=>x.id===aid);if(_idxEntry&&_idxEntry.name)D.meta.accountName=_idxEntry.name;}
    // Inject KAM name — bulk always wins
    if(bulkKamNames[aid])D.meta.kamName=bulkKamNames[aid];

    // ── Step 3: Merge verified alts (localStorage) + unverified candidates (Q4B global) ──
    const unverified=bulkAltsUnverified[aid]||[];
    if(unverified.length>0){
      const verifiedAlts=D.alts.filter(p=>p.confidence&&p.confidence!=='unverified');
      const verifiedKeys=new Set(verifiedAlts.map(p=>p.source_item_id+'_'+p.alt_item_id));
      const stillUnverified=unverified.filter(p=>!verifiedKeys.has(p.source_item_id+'_'+p.alt_item_id));
      D.alts=[...verifiedAlts,...stillUnverified];
      // Recompute alts_meta status from merged set
      if(!D.alts_meta||D.alts_meta.status==='none'){
        const allSrc=new Set(D.alts.map(p=>p.source_item_id));
        D.alts_meta={status:'unverified',verified_count:0,total_count:D.alts.length,
          verified_source_count:0,total_source_count:allSrc.size,verified_at:null,bulk_loaded_at:new Date().toISOString()};
      }
    }

    // ── Step 4: Rebuild fileStatus from actual data ──
    fileStatus.history=D.history.length>0;
    fileStatus.categories=Object.keys(D.cats_monthly).length>0;
    fileStatus.skus=D.skus.length>0;
    fileStatus.outlets=Object.keys(D.outlets_monthly).length>0;
    fileStatus.alternatives=D.alts.length>0;
    fileStatus['current-month']=!!D.current_month;
    D.meta.accountName=D.meta.accountName||'';
    D.meta.accountId=D.meta.accountId||aid||'';
    D.meta.kamName=D.meta.kamName||'';

    if(D.alts.length&&D.skus.length)computeOPPS();
    // Auto-restore session state: if user had verified alts + a plan, treat as active
    if(OPPS.length>0&&D.alts.some(p=>p.confidence&&p.confidence!=='unverified')){
      senseActivated=true;
      if(currentPlanMode&&currentPlanMode!=='none')footerUnlocked=true;
    }
    return true;
  }catch(e){console.warn('load failed',e);return false;}
}

function switchAccount(accountId){
  if(accountId===currentAccountId){closeDataPanel();return;}
  const _swKam=_getKamEmailForAccount&&_getKamEmailForAccount(accountId);
  // switchAccount debug log removed (v257)
  saveToStorage();
  kamStateCache={html:null,insights:null,accountId:null};
  churnExpanded=false;skuSubstituteMap={};skuSubstituteLoading=false;skuSubstituteDone=false;
  skuSubstituteMapLM={};skuSubstituteLoadingLM=false;skuSubstituteDoneLM=false;
  // Reset insight button to default (non-done) state
  const _ib=document.getElementById('kam-insight-btn');
  const _il=document.getElementById('kam-insight-btn-label');
  if(_ib)_ib.classList.remove('done');
  if(_il)_il.textContent='Insight'; // will be updated by updateKamSubtabVisibility after data loads
  // v191: explicit reset on account switch — new account = new scan required
  // (renderOverview guard above only protects data reload, not account change)
  senseActivated=false;_sgRunning=false;
  const loaded=loadFromStorage(accountId);
  if(loaded){
    refreshAll();updateDataStatus();updateDpAccountCard();renderAccountLibrary();
    if(typeof updateMatcherPreStatus==='function')updateMatcherPreStatus();
    if(typeof _updateKamNavDisabled==='function')_updateKamNavDisabled(); // v183
    closeDataPanel();
    showToast('สลับไปแล้ว','✓');
    // Lazy-load account-level intelligence only after account is opened.
    if(typeof ensureAccountDetailData==='function'){
      ensureAccountDetailData(accountId).then(()=>{
        updateDpAccountCard();renderAccountLibrary();
      }).catch(()=>{});
    }
    // Auto-load alternatives from Supabase if not in localStorage
    if(currentUser&&(!D.alts||!D.alts.length)){
      loadAltsFromSupabase(accountId).then(result=>{
        if(result&&result.data&&result.data.pairs&&result.data.pairs.length){
          D.alts=parseAlternatives(JSON.stringify(result.data));
          fileStatus.alternatives=true;
          computeOPPS();refreshAll();updateDataStatus();
          if(typeof updateMatcherPreStatus==='function')updateMatcherPreStatus();
          const d=result.generated_at?new Date(result.generated_at).toLocaleDateString('th-TH'):'';
          showToast('โหลด alternatives จาก cloud'+(d?' ('+d+')':''),'☁');
        }
      }).catch(()=>{});
    }
  }
}

function deleteAccountFromStorage(accountId,e){
  if(e)e.stopPropagation();
  if(accountId===currentAccountId){showToast('ไม่สามารถลบร้านที่กำลังดูอยู่','⚠');return;}
  localStorage.removeItem(_acctKey(accountId));
  const idx=getAccountIndex().filter(a=>a.id!==accountId);
  localStorage.setItem('ciq_index',JSON.stringify(idx));
  renderAccountLibrary();
  showToast('ลบแล้ว','✓');
}

function renderAccountLibrary(){
  const listEl=document.getElementById('dp-lib-list');
  const countEl=document.getElementById('dp-lib-count');
  if(!listEl)return;
  const idx=getAccountIndex(); // always deduped at source now
  if(countEl)countEl.textContent=idx.length>0?'('+idx.length+' ร้าน)':'';
  if(!idx.length){
    listEl.innerHTML='<div class="dp-lib-empty">ยังไม่มีร้านบันทึกไว้<br>กดเพิ่มร้านใหม่ด้านล่าง</div>';
    return;
  }
  listEl.innerHTML=idx.map(function(a){
    var isCurrent=a.id===currentAccountId;
    var ago=a.ts?Math.round((Date.now()-new Date(a.ts).getTime())/60000):null;
    var agoStr=ago===null?'':ago<60?ago+'นาทีที่แล้ว':ago<1440?Math.round(ago/60)+'ชม.ที่แล้ว':Math.round(ago/1440)+'วันที่แล้ว';
    return '<div class="dp-lib-row'+(isCurrent?' active-acct':'')+'" data-libid="'+a.id+'" onclick="libRowClick(this)">'
      +'<div class="dp-lib-dot"></div>'
      +'<div class="dp-lib-info"><div class="dp-lib-name">'+a.name+'</div>'
      +(agoStr?'<div class="dp-lib-meta">'+agoStr+'</div>':'')+'</div>'
      +'<div class="dp-lib-right">'+(isCurrent
        ?'<span class="dp-lib-current">กำลังดู</span>'
        :'<span class="dp-lib-switch">สลับ &rarr;</span>'
        +'<button class="dp-lib-del" data-did="'+a.id+'" onclick="event.stopPropagation();var id=this.getAttribute(\'data-did\');deleteAccountFromStorage(id,null)">\u2715</button>'
      )+'</div>'
    +'</div>';
  }).join('');
}

function libRowClick(el){
  var id=el.getAttribute('data-libid');
  if(id&&!el.classList.contains('active-acct'))switchAccount(id);
}
// [UNUSED] — no callers found; safe to delete in future refactor
function libDelClick(btn,e){
  e.stopPropagation();
  var id=btn.getAttribute('data-delidx');
  if(id)deleteAccountFromStorage(id,null);
}

function updateDpAccountCard(){
  const nameEl=document.getElementById('dp-acct-name');
  const metaEl=document.getElementById('dp-acct-meta');
  const statsEl=document.getElementById('dp-acct-stats');
  const spendEl=document.getElementById('dp-acct-spend');
  const savEl=document.getElementById('dp-acct-sav');
  const name=D.meta.accountName||document.getElementById('acct-name-input')?.value.trim()||'—';
  if(nameEl)nameEl.textContent=name;
  const hasData=D.history.length>0||D.skus.length>0;
  if(metaEl){
    if(hasData){
      const last=D.history[D.history.length-1];
      metaEl.textContent=(D.meta.accountId?'#'+D.meta.accountId.slice(0,8)+' · ':'')+( last?.m||'');
    }else{metaEl.textContent='ยังไม่ได้โหลดข้อมูล';}
  }
  if(statsEl)statsEl.style.display=hasData?'flex':'none';
  if(spendEl)spendEl.textContent=fmt(curSpend());
  if(savEl)savEl.textContent=fmt(totalAll())+'/เดือน';
}


function parseAlternatives(jsonText){try{const data=JSON.parse(jsonText);return data.pairs||[];}catch(e){return[];}}

// ── v53 fix D: quoted-CSV row parser ──
// Handles BigQuery CSV export where fields containing commas or quotes are double-quoted.
// Returns array of trimmed field strings, same interface as l.split(',').

