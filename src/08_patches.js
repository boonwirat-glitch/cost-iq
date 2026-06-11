// Freshket Sense — Consolidated Patch Scripts
// v206e through v213f, in original document order.
// Structural consolidation only — logic unchanged, IIFEs preserved.
// Deep inline into core to follow in future sessions per-patch.

// ─────────────────────────────────────────────────────────────────────────────
// ── Save Plan Badge (v500) ──────────────────────────────────────────────────
// Attaches after _initPlanTray creates #sense-plan-section.
// Adds: 1) save-plan-card (hidden by default, slides in on first custom select)
//       2) sps-cta dual-icon (report vs share) swapped by body.sense-on-report
//       3) savePlanBadge_onCustom / savePlanBadge_onDefault hooks (called from 03_rendering)
//       4) doSavePlan / doShareFromPill handlers
// ─────────────────────────────────────────────────────────────────────────────
(function(){
  'use strict';

  var _spcVisible = false;      // card is in DOM and visible
  var _spcSaved   = false;      // user has pressed บันทึก at least once
  var _spcInited  = false;      // badge card injected into DOM
  var _shareInFlight = false;   // debounce share

  // ── Wait for _initPlanTray to fire, then patch the sps-cta icons ──────────
  function _patchSpsCta(){
    var cta = document.querySelector('.sps-cta');
    if(!cta) return false;
    // Already patched
    if(cta.querySelector('.icon-report')) return true;
    // Replace inner SVG with two-icon structure
    cta.innerHTML =
      '<span class="icon-report" aria-hidden="true">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
          '<polyline points="14 2 14 8 20 8"/>' +
          '<line x1="16" y1="13" x2="8" y2="13"/>' +
          '<line x1="16" y1="17" x2="8" y2="17"/>' +
          '<polyline points="10 9 9 9 8 9"/>' +
        '</svg>' +
      '</span>' +
      '<span class="icon-share" aria-hidden="true" style="display:none">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>' +
          '<polyline points="16 6 12 2 8 6"/>' +
          '<line x1="12" y1="2" x2="12" y2="15"/>' +
        '</svg>' +
      '</span>';
    // Wire onclick: context-aware
    cta.onclick = function(){
      if(document.body.classList.contains('sense-on-report')){
        if(typeof doShareFromPill === 'function') doShareFromPill();
      } else {
        showScreen('report');
        document.body.classList.add('sense-on-report');
        if(typeof savePlanBadge_onReport === 'function') savePlanBadge_onReport();
      }
    };
    cta.title = '';
    return true;
  }

  // ── Inject the save-plan-card into plan-cards container ───────────────────
  function _injectBadgeCard(){
    if(_spcInited) return;
    var planCards = document.querySelector('.plan-cards');
    if(!planCards) return;
    var card = document.createElement('div');
    card.id = 'save-plan-card';
    card.className = 'save-plan-card hidden';
    card.innerHTML =
      '<div class="spc-row">' +
        '<div class="spc-left" id="spc-left">' +
          '<div class="spc-text">' +
            '<div class="spc-label" id="spc-label">บันทึกแผนนี้</div>' +
            '<div class="spc-sub" id="spc-sub">เลือกไว้ <span id="spc-count">0</span> รายการ · ยังไม่บันทึก</div>' +
          '</div>' +
        '</div>' +
        '<button class="spc-btn cta" id="spc-btn" onclick="doSavePlan()">บันทึก</button>' +
      '</div>';
    planCards.appendChild(card);
    _spcInited = true;
  }

  // ── Show card with slide-in animation ─────────────────────────────────────
  function _showCard(){
    if(_spcVisible) return;
    var card = document.getElementById('save-plan-card');
    if(!card) return;
    _spcVisible = true;
    card.className = 'save-plan-card spc-entering';
    // After animation ends, settle to stable class
    setTimeout(function(){
      if(card.className.indexOf('spc-entering') >= 0){
        card.className = 'save-plan-card spc-unsaved';
      }
    }, 340);
  }

  // ── Hide card with slide-out animation ────────────────────────────────────
  function _hideCard(){
    if(!_spcVisible || _spcSaved) return; // never hide after user saved
    var card = document.getElementById('save-plan-card');
    if(!card) return;
    card.className = 'save-plan-card spc-exiting';
    setTimeout(function(){
      card.className = 'save-plan-card hidden';
      _spcVisible = false;
    }, 230);
  }

  // ── Update count inside card ───────────────────────────────────────────────
  function _updateCardCount(){
    var countEl = document.getElementById('spc-count');
    if(!countEl) return;
    // sel is the global Set in 03_rendering
    var n = (typeof sel !== 'undefined') ? sel.size : 0;
    countEl.textContent = n;
  }

  // ── HOOK: called from toggleOpp (user ticked/unticked a SKU) ─────────────
  window.savePlanBadge_onCustom = function(){
    _injectBadgeCard();
    _patchSpsCta();
    _showCard();
    _updateCardCount();
    // If previously saved and user changes selection → flip back to unsaved
    if(_spcSaved){
      _spcSaved = false;
      var card = document.getElementById('save-plan-card');
      if(card) card.className = 'save-plan-card spc-unsaved';
      var lbl = document.getElementById('spc-label');
      var sub = document.getElementById('spc-sub');
      var btn = document.getElementById('spc-btn');
      var dot = document.querySelector('#spc-left .spc-dot');
      if(lbl) lbl.textContent = 'บันทึกแผนนี้';
      if(sub){ sub.className = 'spc-sub'; sub.innerHTML = 'เลือกไว้ <span id="spc-count">0</span> รายการ · ยังไม่บันทึก'; _updateCardCount(); }
      if(btn){ btn.textContent = 'บันทึก'; btn.className = 'spc-btn cta'; }
      if(dot) dot.remove();
    }
  };

  // ── HOOK: called from smartSelect (user tapped card 1 or 2) ──────────────
  window.savePlanBadge_onDefault = function(){
    // Hide only if not yet saved — if saved, leave visible (user's plan still persists)
    _hideCard();
  };

  // ── HOOK: called when entering report screen ───────────────────────────────
  window.savePlanBadge_onReport = function(){
    // Nothing extra needed — CSS body.sense-on-report handles icon swap
  };

  // ── ACTION: บันทึกแผน ─────────────────────────────────────────────────────
  window.doSavePlan = function(){
    var btn = document.getElementById('spc-btn');
    if(!btn || btn.disabled) return;
    btn.style.transform = 'scale(.92)';
    btn.style.opacity = '.6';
    btn.disabled = true;
    setTimeout(function(){
      btn.style.transform = '';
      btn.style.opacity = '';
      btn.disabled = false;
      _spcSaved = true;

      // Update card state
      var card = document.getElementById('save-plan-card');
      if(card) card.className = 'save-plan-card spc-saved';

      var lbl = document.getElementById('spc-label');
      var sub = document.getElementById('spc-sub');
      if(lbl) lbl.textContent = 'แผนบันทึกแล้ว';

      // Format timestamp
      var now = new Date();
      var dd = now.getDate();
      var mm = now.getMonth()+1;
      var yy = (now.getFullYear()-543); // convert to BE — actually keep CE for simplicity
      var hh = String(now.getHours()).padStart(2,'0');
      var min = String(now.getMinutes()).padStart(2,'0');
      var ts = dd+' มิ.ย. '+now.getFullYear()+' · '+hh+':'+min;
      var n = (typeof sel !== 'undefined') ? sel.size : 0;
      if(sub){
        sub.className = 'spc-sub green';
        sub.textContent = ts+' · '+n+' รายการ · relogin ยังดูได้';
      }

      btn.textContent = 'อัปเดต';
      btn.className = 'spc-btn done';

      // Dot pop animation
      var left = document.getElementById('spc-left');
      if(left && !left.querySelector('.spc-dot')){
        var dot = document.createElement('div');
        dot.className = 'spc-dot saved pop';
        left.prepend(dot);
        setTimeout(function(){ dot.classList.remove('pop'); }, 400);
      }

      // Save to Supabase (per-account, Option B from design session)
      _persistPlan();
    }, 150);
  };

  // ── Supabase save (stub — wire to real Supabase in next session) ──────────
  function _persistPlan(){
    try{
      var accountId = (typeof currentAccountId !== 'undefined') ? currentAccountId : null;
      var userEmail = (typeof currentUserProfile !== 'undefined' && currentUserProfile) ? currentUserProfile.email : null;
      var selArr = (typeof sel !== 'undefined') ? Array.from(sel) : [];
      var payload = {
        account_id: accountId,
        user_email: userEmail,
        selections: selArr,
        plan_mode: (typeof currentPlanMode !== 'undefined') ? currentPlanMode : 'custom',
        saved_at: new Date().toISOString()
      };
      // Store locally as fallback always
      try{ localStorage.setItem('spb_plan_'+accountId, JSON.stringify(payload)); }catch(e){}
      // TODO next session: upsert to Supabase saved_plans table
      // if(window._supabase){ window._supabase.from('saved_plans').upsert({...payload}); }
    }catch(e){}
  }

  // ── ACTION: Share from pill button (report screen) ────────────────────────
  window.doShareFromPill = function(){
    if(_shareInFlight) return;
    _shareInFlight = true;
    var cta = document.querySelector('.sps-cta');
    var shareIcon = cta && cta.querySelector('.icon-share');

    // Scale press
    if(cta){ cta.style.transform = 'scale(.88)'; }
    setTimeout(function(){
      if(cta){ cta.style.transform = ''; }

      // Spinner in pill
      if(shareIcon){
        shareIcon.innerHTML = '<svg class="spin-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
      }

      // Delegate to existing shareReport() for PDF + share sheet
      var shareBtn = document.getElementById('rpt2-share-btn');
      if(shareBtn){
        shareBtn.classList.add('sharing-loading');
        if(typeof shareReport === 'function'){
          try{ shareReport(); }catch(e){}
        }
      }

      // After 1.4s assume done (shareReport is async, no reliable callback)
      setTimeout(function(){
        if(shareIcon){
          shareIcon.innerHTML =
            '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>' +
              '<polyline points="16 6 12 2 8 6"/>' +
              '<line x1="12" y1="2" x2="12" y2="15"/>' +
            '</svg>';
        }
        if(shareBtn) shareBtn.classList.remove('sharing-loading');
        if(cta){ cta.style.background=''; } // revert to CSS rule
        _shareInFlight = false;
      }, 1400);
    }, 120);
  };

  // ── Init: wait for plan tray to be created, then patch ────────────────────
  function _tryInit(){
    var patched = _patchSpsCta();
    if(!patched){
      // _initPlanTray hasn't fired yet — retry
      setTimeout(_tryInit, 300);
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(_tryInit, 500); });
  } else {
    setTimeout(_tryInit, 500);
  }

})();
