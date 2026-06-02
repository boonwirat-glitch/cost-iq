// SECTION:PACE_CHURN
function computePaceSignal(cm,history){
  if(!cm)return{cls:'',pct:0,label:'ไม่มีข้อมูล',isNew:false,histMonths:0};
  const daysElapsed=cm.days_elapsed||1;
  const daysInMonth=cm.days_in_month||30;
  const hist=history&&history.length?history:[];
  const recent3=hist.slice(-3);
  const histMonths=recent3.length;

  // ── NEW ACCOUNT: no prior months ──────────────────────────────
  if(histMonths===0){
    return{
      cls:'new',pct:null,label:'ร้านใหม่',isNew:true,
      histMonths:0,confidence:'none',
      baselineDaily:0,baselineGmv:0,expected:0,lastGmv:0,
      runrate:cm.runrate_gmv,daysElapsed,daysInMonth,
      gmvToDate:cm.gmv_to_date,monthsDetail:[]
    };
  }

  // ── NORMALIZED BASELINE ───────────────────────────────────────
  // Compute daily rate per month (GMV ÷ actual days in that month)
  // then average across available months (1–3)
  const monthsDetail=recent3.map(h=>{
    const days=getThaiMonthDays(h.m);
    return{m:h.m,gmv:h.s,days,daily:Math.round(h.s/days)};
  });
  const baselineDaily=monthsDetail.reduce((s,d)=>s+d.daily,0)/histMonths;
  const baselineGmv=Math.round(baselineDaily*daysInMonth); // Method C: × actual days in current month
  const expected=baselineDaily*daysElapsed;
  const pct=expected>0?Math.round(cm.gmv_to_date/expected*100):0;
  const lastGmv=hist[hist.length-1]?.s||0;

  // ── CONFIDENCE (based on months of data available) ────────────
  const confidence=histMonths>=3?'high':histMonths===2?'medium':'low';

  // ── SIGNAL CLASS ──────────────────────────────────────────────
  let cls='',label='';
  if(daysElapsed<5){
    cls='safe';label='ยังเร็วเกินไป ('+daysElapsed+' วัน)';
  }else if(pct>=100){cls='great';label='ดีเยี่ยม';}
  else if(pct>=95){cls='safe';label='ปลอดภัย';}
  else if(pct>=90){cls='warn';label='MONITOR';}
  else{cls='danger';label='AT RISK';}

  return{
    cls,pct,label,isNew:false,
    histMonths,confidence,baselineDaily:Math.round(baselineDaily),
    baselineGmv,expected:Math.round(expected),lastGmv,
    runrate:cm.runrate_gmv,daysElapsed,daysInMonth,
    gmvToDate:cm.gmv_to_date,monthsDetail
  };
}

function getPaceClass(pct){
  if(pct>=100)return'great';
  if(pct>=95)return'safe';
  if(pct>=90)return'warn';
  return'danger';
}

// ════════════════════════════════════════
// SKU CHURN COMPUTATION
// ════════════════════════════════════════
function computeChurnSignals(){
  if(!D.current_month||!D.skus.length)return[];
  const cm=D.current_month;
  const daysElapsed=cm.days_elapsed||1;
  const daysInMonth=cm.days_in_month||30;
  const skuCurrentEmpty=!(D.sku_current||[]).length;
  // If sku_current is empty but account has positive GMV this month → data not uploaded, can't compute
  // If sku_current is empty AND gmv_to_date===0 → account truly has 0 orders → all last-month SKUs = gone
  if(skuCurrentEmpty && (cm.gmv_to_date||0)>0) return [];
  // Get last finished month SKUs with order_count
  const months=Object.keys(D.skus_monthly||{}).sort((a,b)=>{
    const toDate=m=>{const parts=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(parts[1]||0)*12)+mo.indexOf(parts[0]);};
    return toDate(b)-toDate(a);
  });
  // v156: use last CLOSED month — Q3B now includes MTD so months[0] may be current month
  const _cmLbl2=(D.current_month||{}).month_label||'';
  const _lastClosed2=months.find(m=>m!==_cmLbl2)||months[0];
  const lastMonthSkus=_lastClosed2?D.skus_monthly[_lastClosed2]:D.skus;
  const currentMap=new Map((D.sku_current||[]).map(s=>[s.item_id,s]));
  const signals=[];
  for(const sku of lastMonthSkus){
    const orderCount=sku.order_count||0;
    if(orderCount<1)continue; // skip SKUs with no order history
    const outletCountSku=sku.outlet_count_sku||1;
    // Per-outlet frequency: how many times each ordering outlet buys this SKU/month
    const perOutletFreq=orderCount/outletCountSku;
    // Average days between orders per outlet
    const avgInterval=daysInMonth/perOutletFreq;
    const curr=currentMap.get(String(sku.id||sku.item_id));
    const ordersThisMonth=curr?curr.orders_this_month:0;
    // ── slow: has orders but pace well below last month ──
    if(ordersThisMonth>0){
      const lastGmv=sku.gmv||0;
      if(daysElapsed>15&&daysElapsed>avgInterval&&lastGmv>=3000&&daysElapsed>0){
        const projectedGmv=(curr.gmv_to_date||0)*(daysInMonth/daysElapsed);
        const gapPct=lastGmv>0?Math.round((lastGmv-projectedGmv)/lastGmv*100):0;
        if(gapPct>=30){
          signals.push({
            id:String(sku.id||sku.item_id),
            name:sku.n||sku.name||sku.item_name_th||'—',
            dept:sku.d||sku.dept||'—',
            orderCount,outletCountSku,perOutletFreq,avgInterval:Math.round(avgInterval),
            daysLate:0,daysUntil:0,
            ordersThisMonth,type:'slow',
            gmv:lastGmv,gapPct,
            projectedGmv:Math.round(projectedGmv)
          });
        }
      }
      continue;
    }
    // zero orders → classify gone/near/not_yet as before
    // Classify by how far past the expected reorder point we are
    let type;
    if(daysElapsed<avgInterval)type='not_yet';           // ยังไม่ถึงรอบ
    else if(daysElapsed<avgInterval*1.5)type='near';     // เพิ่งเลยรอบ — เฝ้าดู
    else type='gone';                                     // เลยรอบมากแล้ว — น่าหาย
    const roundedInterval=Math.round(avgInterval);
    const daysLate=Math.max(0,Math.round(daysElapsed-avgInterval));
    const daysUntil=Math.max(0,Math.round(avgInterval-daysElapsed));
    signals.push({
      id:String(sku.id||sku.item_id),
      name:sku.n||sku.name||sku.item_name_th||'—',
      dept:sku.d||sku.dept||'—',
      orderCount,outletCountSku,perOutletFreq,avgInterval:roundedInterval,
      daysLate,daysUntil,
      ordersThisMonth,type,
      gmv:sku.gmv||0
    });
  }
  const typeOrder={gone:0,slow:1,near:2,not_yet:3};
  signals.sort((a,b)=>{
    const td=(typeOrder[a.type]||0)-(typeOrder[b.type]||0);
    return td!==0?td:b.gmv-a.gmv;
  });
  return signals;
}

// ════════════════════════════════════════
// INTERVAL-AWARE CHURN FOR PORTVIEW (per account, uses bulk globals)
// ════════════════════════════════════════
function computeChurnCountsForAccount(accountId){
  const cm=bulkCurrentMonthData[accountId];
  const skusMonthly=bulkSkusData[accountId]||{};
  const skuCurrentArr=bulkSkuCurrentData[accountId]||[];
  if(!cm||!skuCurrentArr)return null;
  const daysElapsed=cm.days_elapsed||1;
  const daysInMonth=cm.days_in_month||30;
  const _moSrt=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
  const months=Object.keys(skusMonthly).sort((a,b)=>_moSrt(b)-_moSrt(a));
  if(!months.length)return null;
  // v156: skip current MTD month — use last closed month as churn baseline
  const _cmLbl2b=(cm&&cm.month_label)||'';
  const _lastClosed2b=months.find(m=>m!==_cmLbl2b)||months[0];
  const lastMonthSkus=(_lastClosed2b?skusMonthly[_lastClosed2b]:[])||[];
  const currentMap=new Map(skuCurrentArr.map(s=>[String(s.item_id||s.id),s]));
  let gone=0,near=0,ordered=0,total=0;
  for(const sku of lastMonthSkus){
    const orderCount=sku.order_count||0;
    if(orderCount<1)continue;
    total++;
    const curr=currentMap.get(String(sku.id||sku.item_id));
    if(curr&&(curr.orders_this_month||0)>0){ordered++;continue;} // ordered this month ✓
    const outletCount=sku.outlet_count_sku||1;
    const avgInterval=daysInMonth/(orderCount/outletCount);
    if(daysElapsed<avgInterval)continue;              // not_yet — skip
    else if(daysElapsed<avgInterval*1.5)near++;       // near — เฝ้าดู
    else gone++;                                       // gone — หาย
  }
  return{gone,near,ordered,total};
}

// ════════════════════════════════════════
// RENDER PACE & CHURN TAB
// ════════════════════════════════════════
// Story line: tells the "why" behind each signal type
function skuStoryLine(s){
  const freq=`0/${s.orderCount} ครั้ง`;
  if(s.type==='slow') return `${s.ordersThisMonth}/${s.orderCount} ครั้ง · −${s.gapPct}%`;
  if(s.type==='gone') return `${freq} · เลยรอบ ${s.daysLate} วันแล้ว`;
  if(s.type==='near') return s.daysLate<=1?`${freq} · เพิ่งเลยรอบ 1 วัน`:`${freq} · เพิ่งเลยรอบ ${s.daysLate} วัน`;
  return `${freq} · รออีก ${s.daysUntil} วัน`;
}


// ════════════════════════════════════════
// PORTVIEW — ALL-ACCOUNTS PORTFOLIO
// ════════════════════════════════════════
function setPortviewFilter(f){
  portviewFilter=(portviewFilter===f)?'all':f; // toggle: same card = deselect
  window._pvLastRenderMs=Date.now(); // guard: prevent IntersectionObserver expanding on content-shrink
  _applyPortviewTierVisual();
  renderPortviewList();
}
function _applyPortviewTierVisual(){
  document.querySelectorAll('.portview-tier-box[data-pf]').forEach(c=>{
    c.classList.remove('pf-active','pf-dim');
    if(portviewFilter!=='all'){
      c.dataset.pf===portviewFilter?c.classList.add('pf-active'):c.classList.add('pf-dim');
    }
  });
}

// ── v183 Restaurant Sheet Overlay ────────────────────────────────────────────

// ── Sense Dark Theme system (v190) ─────────────────────────────────────────
const _SDT_KEY='sense_dark_theme';
const _SDT_THEMES={
  a:{page:'#141414',card:'#1e1e1e',hdr:'#252525',name:'Neutral',dark:true},
  b:{page:'#0c1220',card:'#131d2e',hdr:'#1a2640',name:'Navy',dark:true},
  c:{page:'#13161c',card:'#1a1e26',hdr:'#20252f',name:'Slate',dark:true},
  light:{page:'#f5f5f5',card:'#ffffff',hdr:'#f0f0f0',name:'Light',dark:false}
};
function setSenseDarkTheme(t){
  if(!_SDT_THEMES[t])t='light';
  document.body.classList.remove('sdt-a','sdt-b','sdt-c');
  document.body.classList.add('sdt-'+t);
  try{localStorage.setItem(_SDT_KEY,t);}catch(e){}
  document.querySelectorAll('.sdt-opt').forEach(el=>{
    const on=el.dataset.theme===t;
    el.style.borderColor=on?'var(--g500)':'var(--n200)';
    el.style.boxShadow=on?'inset 0 0 0 1px rgba(0,208,112,.3)':'';
  });
}
function _injectSenseThemePicker(){
  if(document.getElementById('sdt-picker-wrap'))return;
  const dpQuick=document.getElementById('dp-quick');
  if(!dpQuick)return;
  const cur=(()=>{try{return localStorage.getItem(_SDT_KEY)||'light';}catch(e){return'light';}})();
  const wrap=document.createElement('div');
  wrap.id='sdt-picker-wrap';
  wrap.style.cssText='margin-bottom:14px;padding:12px 14px;background:rgba(0,0,0,.03);border:1px solid var(--n200);border-radius:10px';
  wrap.innerHTML=`
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--n500);margin-bottom:10px">✦ Sense Dark Theme</div>
    <div style="display:flex;gap:7px">
      ${Object.entries(_SDT_THEMES).map(([k,t])=>`
        <div class="sdt-opt" data-theme="${k}" onclick="setSenseDarkTheme('${k}')" style="flex:1;border-radius:10px;border:1.5px solid ${k===cur?'var(--g500)':'var(--n200)'};${k===cur?'box-shadow:inset 0 0 0 1px rgba(0,208,112,.3);':''}padding:9px 7px;cursor:pointer;background:var(--n50);text-align:center;transition:all .2s">
          <div style="width:100%;height:16px;border-radius:5px;background:${t.card};margin-bottom:4px;border:1px solid rgba(0,0,0,.15)"></div>
          <div style="width:100%;height:4px;border-radius:2px;background:${t.page};border:1px solid rgba(0,0,0,.1);margin-bottom:6px"></div>
          <div style="font-size:10px;font-weight:700;color:var(--n700)">${t.name}</div>
          ${k==='light'?'<div style="font-size:8px;color:var(--g700);margin-top:2px">default</div>':''}
        </div>
      `).join('')}
    </div>`;
  dpQuick.insertBefore(wrap,dpQuick.firstChild);
}
// Init: apply saved theme on load
(function(){
  const saved=(()=>{try{return localStorage.getItem(_SDT_KEY)||'light';}catch(e){return'light';}})();
  setSenseDarkTheme(saved);
})();
// ─────────────────────────────────────────────────────────────────────────────
// ── Plan Tray — two-stage bottom card (v190) ────────────────────────────────
let _planTrayOpen=false;
function _openPlanTray(){
  if(_planTrayOpen)return;
  _planTrayOpen=true;
  document.body.classList.add('sense-plan-expanded');
  // Pulse on savings amount
  const amtEl=document.getElementById('spr-amt');
  if(amtEl){amtEl.classList.add('sbt-pulse');amtEl.addEventListener('animationend',()=>amtEl.classList.remove('sbt-pulse'),{once:true});}
}
function _closePlanTray(){
  if(!_planTrayOpen)return;
  _planTrayOpen=false;
  document.body.classList.remove('sense-plan-expanded');
}
// [UNUSED] — no callers found; safe to delete in future refactor
function togglePlanTray(){
  _planTrayOpen?_closePlanTray():_openPlanTray();
}
function _initPlanTray(){
  if(document.getElementById('sense-plan-section'))return;
  const bnav=document.querySelector('.bnav');
  if(!bnav)return;
  const sps=document.createElement('div');
  sps.id='sense-plan-section';
  sps.innerHTML=`<div class="sps-info"><div class="sps-label">แผนที่เลือก · <span id="spr-count">—</span></div><div class="sps-amt" id="spr-amt">—</div><div class="sps-sub" id="spr-sub">—</div></div><button class="sps-cta" onclick="showScreen('report')" title="ส่งรายงาน"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:translate(-1px,1px)"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2" fill="none"/></svg></button>`;
  bnav.insertBefore(sps,bnav.firstChild);
  const senseNav=document.getElementById('nav-opportunities');
  if(senseNav&&!senseNav.querySelector('.sense-plan-dot')){
    const nw=senseNav.querySelector('.nwrap');
    if(nw){nw.style.position='relative';const d=document.createElement('div');d.className='sense-plan-dot';nw.appendChild(d);}
  }
}
// ─────────────────────────────────────────────────────────────────────────────
// ── KAM Sense Mode helpers (v190) ──────────────────────────────────────────
function _injectKamSenseBackBtn(){
  if(document.getElementById('kam-sense-back-btn'))return;
  const scr=document.getElementById('scr-opportunities');
  if(!scr)return;
  const sec=scr.querySelector('.sec')||scr;
  const btn=document.createElement('button');
  btn.id='kam-sense-back-btn';
  btn.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> กลับ`;
  btn.onclick=_exitKamSenseMode;
  sec.insertBefore(btn,sec.firstChild);
}
function _exitKamSenseMode(){
  document.body.classList.remove('kam-sense-active','sense-plan-expanded','sense-plan-active');
  _planTrayOpen=false;
  window._kamSenseReturn=false;
  const btn=document.getElementById('kam-sense-back-btn');
  if(btn)btn.remove();
  const sps=document.getElementById('sense-plan-section');
  if(sps)sps.remove();
  showScreen('overview');
}
// ─────────────────────────────────────────────────────────────────────────────
function _updateKamNavDisabled() {
  const hasAcct = currentAccountId && currentAccountId !== 'default';
  const restBtn = document.getElementById('nav-restaurant');
  const senseBtn = document.getElementById('nav-opportunities');
  if (restBtn) restBtn.classList.toggle('nav-disabled', !hasAcct);
  if (senseBtn) {
    if (isKAM) senseBtn.classList.toggle('nav-disabled', !hasAcct);
    else senseBtn.classList.remove('nav-disabled');
  }
}

function _overlayNav(screenName) {
  // Restaurant-style navigation inside overlay (Approach A: isKAM=true but rendering restaurant content)
  const GRP_A = ['overview','portfolio'];
  const GRP_B = ['opportunities','report'];
  const inA = GRP_A.includes(screenName);
  const grpA = document.getElementById('swipe-grp-a');
  const grpB = document.getElementById('swipe-grp-b');
  if (grpA) grpA.classList.toggle('on', inA);
  if (grpB) grpB.classList.toggle('on', !inA);
  const activeGrp = inA ? grpA : grpB;
  const screens = inA ? GRP_A : GRP_B;
  const idx = screens.indexOf(screenName);
  if (activeGrp) activeGrp.scrollTo({ left: idx * activeGrp.offsetWidth, behavior: 'instant' });
  // Update nav highlight
  document.querySelectorAll('.bnav .ni').forEach(n => n.classList.remove('on'));
  const navEl = document.getElementById('nav-' + screenName);
  if (navEl) navEl.classList.add('on');
}

// SECTION:RESTAURANT_SHEET
function openRestaurantSheet() {
  if (!currentAccountId || currentAccountId === 'default') {
    if (typeof showToast === 'function') showToast('เลือกร้านก่อนนะคะ', '⚠');
    return;
  }
  // Track restaurant sheet visit (new entry point since v183 overlay)
  if (isKAM && currentAccountId) trackVisit(currentAccountId, 'restaurant');

  // ── FIX v191: Suspend kam-sense-active BEFORE any DOM manipulation ──
  // Root cause: body.kam-sense-active #swipe-grp-b { position:fixed!important } at L2581
  // wins over body.restaurant-sheet #swipe-grp-b { position:static!important } at L2420
  // (equal specificity — later rule wins). Removing the class before DOM moves
  // eliminates the cascade conflict entirely. Restored on closeRestaurantSheet().
  window._restFromKamSense = document.body.classList.contains('kam-sense-active');
  window._restSenseActivated = senseActivated; // save BEFORE renderOverview() resets it (L8366)
  if (window._restFromKamSense) {
    document.body.classList.remove('kam-sense-active', 'sense-plan-expanded', 'sense-plan-active');
  }

  window._preSheetScreen = document.querySelector('.scr.on')?.id || 'scr-overview';
  window._preSheetKamSubtab = (typeof currentKamSubtab !== 'undefined') ? currentKamSubtab : null;

  const panel = document.getElementById('rest-sheet-body');
  const grpA  = document.getElementById('swipe-grp-a');
  const grpB  = document.getElementById('swipe-grp-b');

  window._restGrpAParent = grpA?.parentNode;
  window._restGrpANext   = grpA?.nextSibling;
  window._restGrpBParent = grpB?.parentNode;
  window._restGrpBNext   = grpB?.nextSibling;

  // v190: Render content first (sync) — content ready before animation starts
  // _suppressAnimN: skip 600ms number counting animation during slide-up
  isKAM = false;
  applyMeta();
  renderOverview();
  activeMonth = D.history.length - 1;
  window._suppressAnimN = true;
  selectMonth(activeMonth, true);  // v205c: init=true so heroLockedToCurrent logic fires
  window._suppressAnimN = false;
  const restOv = document.getElementById('rest-overview');
  const kamOv  = document.getElementById('kam-overview');
  if (restOv) restOv.style.display = 'block';
  if (kamOv)  kamOv.style.display  = 'none';
  isKAM = true;

  // rAF 1: DOM moves — layout settles this frame, no class change yet (no intermediate paint)
  requestAnimationFrame(() => {
    if (panel && grpA) panel.appendChild(grpA);
    if (panel && grpB) panel.appendChild(grpB);
    if (grpA) { grpA.classList.add('on'); grpA.scrollTo({ left: 0, behavior: 'instant' }); }
    if (grpB) grpB.classList.remove('on');

    // rAF 2: add class → CSS transitions fire from settled layout (mirrors data panel pattern)
    // No freeze, no void offsetHeight — no intermediate painted state
    requestAnimationFrame(() => {
      document.body.classList.add('restaurant-sheet');
      _initOverlaySwipeDismiss();
      setTimeout(() => document.body.classList.add('rest-settled'), 450);
      setTimeout(() => {
        if (!document.body.classList.contains('restaurant-sheet')) return;
        isKAM = false;
        renderPortfolio();
        renderOpps();
        isKAM = true;
      }, 450);
      // ── Show swipe pill hint in overlay (v205) ──
      setTimeout(() => {
        if (!document.body.classList.contains('restaurant-sheet')) return;
        _setRestSwipeCue('a', 0, {show:true, duration:2200});
      }, 700);
    });
  });
}

function toggleRestaurantSheet() {
  document.body.classList.contains('restaurant-sheet') ? closeRestaurantSheet() : openRestaurantSheet();
}

function closeRestaurantSheet() {
  if (!document.body.classList.contains('restaurant-sheet')) return;

  // Trigger slide-down animation
  document.body.classList.remove('rest-settled');
  document.body.classList.add('rest-closing');

  const lbl = document.getElementById('nav-restaurant-label');
  if (lbl) lbl.textContent = 'ร้าน';

  setTimeout(() => {
    document.body.classList.remove('restaurant-sheet');
    document.body.classList.remove('rest-closing');

    // Restore swipe-grps to original DOM positions
    const grpA = document.getElementById('swipe-grp-a');
    const grpB = document.getElementById('swipe-grp-b');
    // Restore grpB first (grpANext was grpB, so grpB must be back in .main before inserting grpA)
    if (window._restGrpBParent && grpB) window._restGrpBParent.insertBefore(grpB, window._restGrpBNext || null);
    if (window._restGrpAParent && grpA) window._restGrpAParent.insertBefore(grpA, window._restGrpANext || null);
    window._restGrpAParent = window._restGrpANext = window._restGrpBParent = window._restGrpBNext = null;

    setMode('kam');
    // ── FIX v191: Restore kam-sense-active if we came from Sense mode ──
    if (window._restFromKamSense) {
      // setMode('kam') → showScreen('overview') clears _kamSenseReturn (L16434)
      // and renderOverview() in openRestaurantSheet() reset senseActivated (L8366)
      // Restore all three before showScreen('opportunities') to bypass gate check
      if (window._restSenseActivated !== undefined) senseActivated = window._restSenseActivated;
      window._kamSenseReturn = true;
      document.body.classList.add('kam-sense-active');
      window._restFromKamSense = false;
      window._restSenseActivated = undefined;
      showScreen('opportunities'); // senseActivated=true → L16439 won't open gate
    } else {
      const target = window._preSheetScreen || 'scr-overview';
      const screenName = target.replace('scr-', '');
      if (screenName && screenName !== 'teamview') showScreen(screenName);
    }
    if (window._preSheetKamSubtab && typeof setKamSubtab === 'function') {
      setTimeout(() => setKamSubtab(window._preSheetKamSubtab), 50);
    }
    window._preSheetScreen = null;
    window._preSheetKamSubtab = null;
  }, 350);
}

function _initOverlaySwipeDismiss() {
  // Attach to panel body — top 60px zone triggers dismiss
  // (cap listener can't fire because swipe-grp scroll container captures touch first)
  const panel = document.getElementById('rest-sheet-body');
  if (panel && !panel._swipeDismissInit) {
    panel._swipeDismissInit = true;
    let sy = 0, topZone = false;
    panel.addEventListener('touchstart', e => {
      sy = e.touches[0].clientY;
      const rect = panel.getBoundingClientRect();
      topZone = (e.touches[0].clientY - rect.top) < 60;
    }, { passive: true });
    panel.addEventListener('touchend', e => {
      if (!document.body.classList.contains('restaurant-sheet')) return;
      if (topZone && e.changedTouches[0].clientY - sy > 50) closeRestaurantSheet();
    }, { passive: true });
  }
  // Content area: swipe down from scrolled-to-top to dismiss
  ['scr-overview', 'scr-opportunities'].forEach(id => {
    const scr = document.getElementById(id);
    if (!scr || scr._swipeInit) return;
    scr._swipeInit = true;
    let sy = 0;
    scr.addEventListener('touchstart', e => { sy = e.touches[0].clientY; }, { passive: true });
    scr.addEventListener('touchend', e => {
      if (!document.body.classList.contains('restaurant-sheet')) return;
      if (e.changedTouches[0].clientY - sy > 80 && scr.scrollTop <= 2) closeRestaurantSheet();
    }, { passive: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────

function _goBackToPortfolio(){
  const isTL=currentUserProfile&&(currentUserProfile.role==='tl'||currentUserProfile.role==='admin');
  if(isTL&&window._portviewFromTeamview){
    window._portviewFromTeamview=false;
    showScreen('teamview');
  } else {
    showScreen('portview');
  }
}

// Swipe right on KAM account overview → back to portfolio
// touchmove-based: fires before iOS decides scroll vs swipe (touchend can be cancelled)
(function _initKamSwipeBack(){
  let sx=0,sy=0,fired=false;
  document.addEventListener('touchstart',e=>{
    sx=e.touches[0].clientX;sy=e.touches[0].clientY;fired=false;
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(fired||!e.touches||!e.touches[0])return;
    if(!document.body.classList.contains('kam-mode'))return;
    if(document.body.classList.contains('restaurant-sheet'))return;
    const dx=e.touches[0].clientX-sx;
    const dy=Math.abs(e.touches[0].clientY-sy);
    if(dx>50&&dy<80){fired=true;_goBackToPortfolio();}
  },{passive:true});
})();

// Swipe up on bnav → open restaurant overlay (account view only)
(function _initNavSwipeUp(){
  const nav=document.querySelector('.bnav');
  if(!nav)return;
  let sy=0;
  nav.addEventListener('touchstart',e=>{sy=e.touches[0].clientY;},{passive:true});
  nav.addEventListener('touchmove',e=>{
    if(!document.body.classList.contains('kam-mode'))return;
    if(document.body.classList.contains('restaurant-sheet'))return;
    const scrOv=document.getElementById('scr-overview');
    if(!scrOv||!scrOv.classList.contains('on'))return;
    const dy=sy-e.touches[0].clientY;
    if(dy>30)openRestaurantSheet();
  },{passive:true});
})();

function portviewGoBack(){
  if(portviewLevel==='rep-detail'){
    portviewLevel='rep';
    portviewRepEmail=null;
    portviewAiDone=false;
    window._portviewFromTeamview=false;
    showScreen('teamview');
    return;
  } else if(window._portviewFromTeamview){
    window._portviewFromTeamview=false;
    showScreen('teamview');
  } else {
    portviewLevel='rep';
    renderPortview();
  }
}

async function generatePortviewInsight(){
  const btn=document.getElementById('portview-ai-btn');
  const lbl=document.getElementById('portview-ai-label');
  const out=document.getElementById('portview-ai-output');
  if(!btn||portviewAiDone)return;
  btn.classList.add('loading');
  if(lbl)lbl.innerHTML='<span class="ai-thinking"><svg width="9" height="9" viewBox="0 0 10 10" fill="rgba(100,170,255,.8)" style="animation:iq-spin 1.5s linear infinite;transform-origin:center;flex-shrink:0"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></span>';
  // Build context from at-risk accounts
  const accounts=getPortviewAccounts();
  const _awp=accounts.filter(a=>a.paceSignal&&a.paceSignal.pct>0);
  const portfolioPace=_awp.length>0?Math.round(_awp.reduce((s,a)=>s+a.paceSignal.gmvToDate,0)/Math.max(1,_awp.reduce((s,a)=>s+a.paceSignal.expected,0))*100):0;
  const shortfall=accounts.filter(a=>a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn')).reduce((s,a)=>{
    // v182: use baselineGmv - runrate (projected full-month gap) to match what UI displays
    const g=Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||a.paceSignal.gmvToDate||0));
    return s+g;
  },0);
  const fmtK=n=>n>=1000000?'฿'+(n/1000000).toFixed(1)+'M':n>=1000?'฿'+(n/1000).toFixed(0)+'K':'฿'+Math.round(n);
  // Sort at-risk by ฿ shortfall (GMV impact) — not pace% — so AI prioritizes correctly
  const atRisk=accounts
    .filter(a=>a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn'))
    // v182: rank by baselineGmv - runrate (full-month projected gap) to match UI shortfall display
    .map(a=>({...a,_shortfall:Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||a.paceSignal.gmvToDate||0))}))
    .sort((a,b)=>b._shortfall-a._shortfall)
    .slice(0,8);
  const ctxLines=atRisk.map(a=>{
    const baseline=a.paceSignal.baselineGmv||0;
    const parts=[
      `Pace ${a.paceSignal.pct}% · baseline ฿${baseline>0?fmtK(baseline):'-'}/เดือน · ขาดอีก ${fmtK(a._shortfall)}`
    ];
    // Interval-aware churn (หายจริง vs ยังไม่ถึงรอบ)
    const cc=a._churnCounts;
    if(cc&&(cc.gone>0||cc.near>0)){
      const churnParts=[];
      if(cc.gone>0)churnParts.push(`หายจริง ${cc.gone} ตัว`);
      if(cc.near>0)churnParts.push(`ใกล้รอบ ${cc.near} ตัว`);
      parts.push(`SKU (interval-aware): ${churnParts.join(', ')} จาก ${cc.total} ตัว`);
    } else if(!cc&&a.churnedSkuCount>0){
      // Fallback to SQL if no interval data
      parts.push(`SKU หาย ${a.churnedSkuCount} ตัว (${fmtK(a.churnedGmv||0)}): ${(a.topChurnedNames||'').split(' | ').slice(0,2).join(', ')}`);
    }
    if(a.missingCatCount>0)parts.push(`Category ขาด: ${(a.missingCats||'').split(' | ').slice(0,2).join(', ')}`);
    return`- ${a.name} [${a.paceSignal.cls}]: ${parts.join(' · ')}`;
  }).join('\n');
  // Quick recovery: warn accounts with no churn signal (SKU health ok)
  const quickRecover=accounts
    .filter(a=>a.paceSignal&&a.paceSignal.cls==='warn'&&!(a._churnCounts?.gone>0)&&!(a.churnedSkuCount>0))
    .sort((a,b)=>b.paceSignal.pct-a.paceSignal.pct)
    .slice(0,2)
    .map(a=>`${a.name} (${a.paceSignal.pct}% ขาดอีก ${fmtK(Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||a.paceSignal.gmvToDate||0)))})`)
    .join(', ');
  const prompt=`ข้อมูลพอร์ต:\nภาพรวม: ${accounts.length} ร้าน · Pro Rate ${portfolioPace}% · ส่วนต่างรวม ${fmtK(shortfall)}\n\nAccounts เสี่ยง ranked by ฿ impact (${atRisk.length}):\n${ctxLines||'ไม่มี'}${quickRecover?'\n\nQuick recovery candidates (warn + SKU health ok): '+quickRecover:''}`;
  const sysPv=OLIVE_BASE+`

-- TASK CONTEXT --
A KAM is planning their day right now. They can see the list — they need your read on what it actually means and who to contact first. Accounts are ranked by ฿ shortfall, not pace %. Let the money impact drive the priority, not the percentage.

Urgency logic (read the signals, decide yourself):
- Danger + SKU หาย → โทรวันนี้ก่อนเลย ถามว่าทำไมหยุดสั่ง
- Danger เฉยๆ → โทรวันนี้ เปิดด้วยความห่วงใย ไม่ใช่ pressure
- Warn + category ขาด → พรุ่งนี้ ถามว่ายังซื้อ category นั้นอยู่มั้ย
- Warn เฉยๆ → monitor เตรียม talkline ไว้
- Safe/Great → ไม่ urgent แต่ถ้ามี opportunity ให้หมายเหตุ

-- OUTPUT CONTRACT --
Thai prose — brief enough to read in 30 seconds.

Structure:
1. One sentence on portfolio state — lead with the problem, not how many accounts are fine.
2. Contact list ranked by urgency: name → why it matters → what specifically to ask (max 5)
3. Quick win if one exists.

Don't repeat numbers already visible in the list.
When mentioning a SKU, use ฿ — not %.`;
  try{
    const txt=await callAI('sonnet',sysPv,[{role:'user',content:prompt}],2000);
    if(out){out.style.display='block';out.style.animation='none';out.innerHTML=txt.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');requestAnimationFrame(()=>{out.style.animation='insightReveal 400ms ease forwards';});}
    portviewAiDone=true;
    // Auto-collapse summary cards — insight text now needs the reading space
    const _pvColl=document.getElementById('pv-collapsible');
    const _pvStrip=document.getElementById('pv-compact-strip');
    if(_pvColl){_pvColl.className='pv-collapsible collapsed';window._pvLastCollapseMs=Date.now();}
    if(_pvStrip)_pvStrip.className='pv-compact-strip visible';
    if(lbl)lbl.innerHTML='<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="vertical-align:-.5px"><path d="M1.5 5.5L3.5 7.5L8.5 2.5" stroke="#4ddc97" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Portfolio Insight';
    btn.classList.remove('loading');
    btn.classList.add('done');
    btn.classList.add('done-bounce');
    btn.addEventListener('animationend',e=>{if(e.animationName==='doneBounce')btn.classList.remove('done-bounce');},{once:true});
  }catch(e){
    if(lbl)lbl.textContent='Portfolio Insight';
    btn.classList.remove('loading');
    btn.classList.remove('done');
    showToast('AI error: '+e.message.slice(0,60),'⚠');
  }
}

// v206c: Portview render discipline — short-lived account memo + debounced search.
let _pvAcctCacheKey='';
let _pvAcctCacheTs=0;
let _pvAcctCacheResult=null;
let _pvRenderTimer=null;
function _pvAccountCacheKey(){
  const p=currentUserProfile||{};
  const histN=bulkHistoryData?Object.keys(bulkHistoryData).length:0;
  const cmN=bulkCurrentMonthData?Object.keys(bulkCurrentMonthData).length:0;
  const skuN=bulkSkusData?Object.keys(bulkSkusData).length:0;
  const curSkuN=bulkSkuCurrentData?Object.keys(bulkSkuCurrentData).length:0;
  const pvN=portviewBulkData?portviewBulkData.length:0;
  return [p.email||'',p.role||'',portviewLevel||'',portviewRepEmail||'',pvN,histN,cmN,skuN,curSkuN].join('|');
}
function _pvClearAccountCache(){_pvAcctCacheKey='';_pvAcctCacheTs=0;_pvAcctCacheResult=null;}
function schedulePortviewListRender(delay){
  clearTimeout(_pvRenderTimer);
  _pvRenderTimer=setTimeout(()=>{_pvRenderTimer=null;renderPortviewList();},delay==null?140:delay);
}
function _senseHydrateVisiblePortfolio(reason,opts){
  opts=opts||{};
  const delay=opts.delay==null?260:opts.delay;
  let did=false;
  const onPv=!!document.getElementById('scr-portview')?.classList.contains('on');
  const onTv=!!document.getElementById('scr-teamview')?.classList.contains('on');
  try{ if(typeof _pvClearAccountCache==='function')_pvClearAccountCache(); }catch(e){}
  if(onPv){
    const recent=Date.now()-(window._pvLastRenderMs||0)<850;
    if(opts.full&&!recent&&typeof renderPortview==='function'){
      renderPortview();
    }else{
      try{ if(typeof renderPortviewSummary==='function')renderPortviewSummary(); }catch(e){}
      try{ if(typeof schedulePortviewListRender==='function')schedulePortviewListRender(delay); else if(typeof renderPortviewList==='function')renderPortviewList(); }catch(e){}
      try{ setTimeout(()=>{if(typeof _pvBuildCompactStrip==='function')_pvBuildCompactStrip();},Math.max(120,delay)); }catch(e){}
    }
    did=true;
  }
  if(onTv){
    try{ if(typeof renderTeamviewSummary==='function')renderTeamviewSummary(); }catch(e){}
    try{ setTimeout(()=>{if(typeof renderTeamviewKamList==='function')renderTeamviewKamList();},delay); }catch(e){}
    did=true;
  }
  _senseLog('[v206d hydrate]',reason,{onPv,onTv,delay,full:!!opts.full});
  return did;
}
// SECTION:PORTVIEW
function getPortviewAccounts(){
  if(portviewBulkData&&portviewBulkData.length>0){
    const _ck=_pvAccountCacheKey();
    if(_pvAcctCacheResult&&_pvAcctCacheKey===_ck&&(Date.now()-_pvAcctCacheTs)<1200)return _pvAcctCacheResult;
    const userEmail=(currentUserProfile&&currentUserProfile.email)||'';
    const role=(currentUserProfile&&currentUserProfile.role)||'rep';
    const isTL=(role==='tl'||role==='admin');

    // ── Determine filtered set ──
    let result=null;
    const hasEmailCols=portviewBulkData.some(r=>r.kamEmail||r.tlEmail);
    if(hasEmailCols&&userEmail){
      if(isTL){
        const f=portviewBulkData.filter(r=>r.tlEmail===userEmail);
        if(f.length>0)result=f;
        // TL with no match — fall through to legacy paths below (may see all for old CSVs)
      } else {
        const f=portviewBulkData.filter(r=>r.kamEmail===userEmail);
        if(f.length>0)result=f;
        // ── SAFETY: rep with valid email + email cols but no match → empty (don't leak) ──
        else return[];
      }
    }
    // ── No email cols (legacy CSV) — fall back to accountList match ──
    if(!result&&accountList&&accountList.length>0){
      const myIds=new Set(accountList.map(a=>String(a.account_id||a.id||'').trim()));
      const f=portviewBulkData.filter(a=>myIds.has(String(a.id||'')));
      // TL: show all if no match; rep: only show what matches (or empty)
      if(isTL){result=f.length>0?f:portviewBulkData;}
      else{result=f;}
    }
    // ── Still no result — TL sees all (legacy fallback), rep sees empty ──
    if(!result)result=isTL?portviewBulkData:[];

    // ── rep-detail: TL viewing a specific KAM's portfolio ──
    if(portviewLevel==='rep-detail'&&portviewRepEmail&&result){
      const f=result.filter(r=>r.kamEmail===portviewRepEmail||r.kamName===portviewRepEmail);
      if(f.length>0)result=f;
    }

    // ── Enrich: recompute paceSignal with 3-month normalized baseline when bulk history available ──
    const _out = result.map(a=>{
      const cm=bulkCurrentMonthData[a.id];
      const hist=bulkHistoryData[a.id];
      const _moSrt=m=>{const p=(m||'').split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
      const enriched=cm&&hist&&hist.length>0?{...a,paceSignal:computePaceSignal(cm,hist.slice().sort((a,b)=>_moSrt(a.m)-_moSrt(b.m)))}:a;
      return{...enriched,_churnCounts:computeChurnCountsForAccount(a.id)};
    });
    _pvAcctCacheKey=_ck;_pvAcctCacheTs=Date.now();_pvAcctCacheResult=_out;
    return _out;
  }
  // Otherwise build from localStorage (single-account local mode)
  // Guard: if R2 is actively loading (sheetsLoadStarted=true) and bulk data not yet ready,
  // return [] to show loading state instead of stale localStorage data from previous sessions.
  if(typeof sheetsLoadStarted!=='undefined'&&sheetsLoadStarted)return[];
  const idx=getAccountIndex();
  const results=[];
  for(const acct of idx){
    const raw=localStorage.getItem(_acctKey(acct.id));
    if(!raw)continue;
    try{
      const p=JSON.parse(raw);
      // Storage format: {D:{history,meta,...}, fileStatus, ...}
      const d=p.D||p; // backward compat
      const history=d.history||[];
      const cm=d.current_month||null;
      const skuCurrent=d.sku_current||[];
      const skusMonthly=d.skus_monthly||{};
      // Compute pace signal using shared normalized logic
      let paceSignal=cm?computePaceSignal(cm,history):null;
      // Estimate churn count (simplified)
      let churnCount=0;
      if(cm&&skuCurrent.length&&Object.keys(skusMonthly).length){
        const months=Object.keys(skusMonthly).sort((a,b)=>{
          const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
          const tp=a.split(' ');const tb=b.split(' ');
          return((parseInt(tb[1]||0)*12)+mo.indexOf(tb[0]))-((parseInt(tp[1]||0)*12)+mo.indexOf(tp[0]));
        });
        // v156: skip current MTD month for churn baseline
        const _cmLbl2c=(cm&&cm.month_label)||'';
        const _lastClosed2c=months.find(m=>m!==_cmLbl2c)||months[0];
        const lastMonthSkus=months.length?skusMonthly[_lastClosed2c||months[0]]:[];
        const currMap=new Map(skuCurrent.map(s=>[s.item_id,s]));
        for(const sku of lastMonthSkus){
          if((sku.order_count||0)<3)continue;
          const curr=currMap.get(String(sku.id||sku.item_id));
          if(!curr||curr.orders_this_month===0)churnCount++;
        }
      }
      results.push({
        id:acct.id,
        name:d.meta&&d.meta.accountName?d.meta.accountName:acct.id,
        lastGmv:history.length?history[history.length-1].s:0,
        paceSignal,churnCount,cm
      });
    }catch(e){}
  }
  // Sort: danger → warn → ok → new → no-signal
  const sortOrder={danger:0,warn:1,safe:2,great:3,new:4,'':5};
  results.sort((a,b)=>{
    const ac=a.paceSignal?a.paceSignal.cls:'';
    const bc=b.paceSignal?b.paceSignal.cls:'';
    if(sortOrder[ac]!==sortOrder[bc])return sortOrder[ac]-sortOrder[bc];
    return b.lastGmv-a.lastGmv;
  });
  return results;
}

function renderPortviewList(){
  const renderer = window.FreshketSenseKamTeamRenderer;
  if(renderer && typeof renderer.renderPortviewListFromLegacy === 'function'){
    try{
      return renderer.renderPortviewListFromLegacy({
        D: D,
        OPPS: OPPS,
        currentAccountId: currentAccountId,
        currentKamSubtab: (typeof currentKamSubtab !== 'undefined' ? currentKamSubtab : null),
        portviewLevel: (typeof portviewLevel !== 'undefined' ? portviewLevel : null),
        portviewFilter: (typeof portviewFilter !== 'undefined' ? portviewFilter : null),
        teamviewLevel: (typeof teamviewLevel !== 'undefined' ? teamviewLevel : null),
        portviewBulkData: (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []),
        currentUserProfile: (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null),
        legacy: { renderPortviewList: __legacyRenderPortviewListFallback }
      });
    }catch(e){
      console.warn('renderPortviewList renderer failed, falling back to legacy renderer', e);
    }
  }
  return __legacyRenderPortviewListFallback();
}

function __legacyRenderPortviewListFallback(){
  window._pvLastRenderMs=Date.now(); // guard: prevent IntersectionObserver expanding on content-shrink
  const listEl=document.getElementById('portview-list');
  if(!listEl)return;
  const accounts=getPortviewAccounts();
  const searchQ=(document.getElementById('portview-search')?.value||'').toLowerCase();
  const filtered=accounts.filter(a=>{
    if(searchQ&&!a.name.toLowerCase().includes(searchQ))return false;
    if(portviewFilter==='all')return true;
    const cls=a.paceSignal?a.paceSignal.cls:'';
    if(portviewFilter==='danger')return cls==='danger';
    if(portviewFilter==='warn')return cls==='warn';
    if(portviewFilter==='ok')return cls==='great'||cls==='safe'||cls==='new'||cls==='';
    return true;
  });
  const fmtK=n=>n>=1000000?'฿'+(n/1000000).toFixed(1)+'M':n>=1000?'฿'+(n/1000).toFixed(0)+'K':'฿'+Math.round(n);
  if(!filtered.length){
    const _r2Loading=typeof sheetsLoadStarted!=='undefined'&&sheetsLoadStarted&&(!portviewBulkData||portviewBulkData.length===0);
    listEl.innerHTML=`<div class="portview-no-data"><div class="portview-no-data-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="10" width="24" height="17" rx="2" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" fill="none"/><path d="M4 16h6l2 3h8l2-3h6" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" stroke-linejoin="round" fill="none"/><path d="M11 7l5-3 5 3" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="portview-no-data-text">${_r2Loading?'กำลังโหลด...':'ไม่มีข้อมูล'}</div><div class="portview-no-data-sub">${_r2Loading?'ข้อมูล portfolio กำลังดาวน์โหลด':'อัปโหลด current_month.csv ให้ทุก account<br>เพื่อดู Pace ภาพรวม'}</div></div>`;
    return;
  }
  const _pvVisitMap=getVisitMap((currentUserProfile&&currentUserProfile.email)||'local');

  // Value guard: skip full list rebuild if data + context unchanged
  const _pvSnap=portviewBulkData.length>0
    ?`${portviewBulkData.length}:${portviewBulkData[0]?.accountId||''}:${portviewBulkData[portviewBulkData.length-1]?.accountId||''}`
    :'0';
  // Include heavy-data readiness — list must re-render when SKU/alternatives data arrives
  // v225b fix: add bulkSkusData key count to _skuSnap.
  // Bug: _skuSnap only tracked bulkSkusReady (bulk_skus.csv) and bulkSkuCurrentData.
  // It did NOT track bulkSkusData (per-account SKU monthly data from KAM bundle).
  // Result: when KAM bundle loaded and populated bulkSkusData[accountId], _listKey
  // was unchanged → early return → computeChurnCountsForAccount() never re-ran →
  // สั่ง/หาย/เฝ้าดู badges never appeared on KAM's own portview.
  // TL didn't hit this bug because prewarm loaded bundle BEFORE first portview render.
  const _bulkSkusDataN=(typeof bulkSkusData!=='undefined'&&bulkSkusData)?Object.keys(bulkSkusData).length:0;
  const _skuSnap=(typeof bulkSkusReady!=='undefined'&&bulkSkusReady?'1':'0')+(typeof bulkSkuCurrentData!=='undefined'&&Object.keys(bulkSkuCurrentData||{}).length>0?'s':'')+'b'+_bulkSkusDataN;
  const _listKey=`${portviewFilter}|${portviewLevel||''}|${portviewRepEmail||''}|${pvSortMode}|${pvSortDir}|${pvViewMode}|${searchQ}|${_pvSnap}|${_skuSnap}`;
  if(listEl._lastListKey===_listKey && listEl.children.length>0) return;
  listEl._lastListKey=_listKey;

  // ── Card builders ──
  function _buildBadges(a){
    const _cc=a._churnCounts;
    let churnBadge='';
    if(_cc&&_cc.total>0){
      const orderedPart=_cc.ordered>0?`<span style="color:rgba(0,208,112,.7)">${_cc.ordered} สั่งแล้ว</span>`:'';
      const gonePart=_cc.gone>0?`<span style="color:var(--org)">${orderedPart?' · ':''}${_cc.gone} หาย</span>`:'';
      const nearPart=_cc.near>0?`<span style="color:var(--amb)">${(orderedPart||gonePart)?' · ':''}${_cc.near} เฝ้าดู</span>`:'';
      const totalPart=`<span style="color:rgba(255,255,255,.35)"> / ${_cc.total} SKU</span>`;
      if(orderedPart||gonePart||nearPart){
        churnBadge=`<span class="portview-churn-badge" style="background:rgba(240,80,0,.06);border-color:rgba(240,80,0,.18);gap:0;padding:2px 8px">${orderedPart}${gonePart}${nearPart}${totalPart}</span>`;
      }
    } else if((a.churnedSkuCount||a.churnCount||0)>0){
      // Hidden: old Q8E pre-computed count shown only after Q3B (bulkSkusData) loads
      // churnBadge=`<span class="portview-churn-badge">${a.churnedSkuCount||a.churnCount} SKU หาย</span>`;
    }
    const catBadge=(a.missingCatCount||0)>0?`<span class="portview-churn-badge" style="background:rgba(240,176,0,.2);color:var(--amb);border-color:rgba(240,176,0,.3)">${a.missingCatCount} cat</span>`:'';
    const acctTypeBadge=a.accountType?`<span style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:4px;background:rgba(255,255,255,.1);color:rgba(255,255,255,.5);margin-right:4px;letter-spacing:.3px">${a.accountType}</span>`:'';
    return{churnBadge,catBadge,acctTypeBadge};
  }

  function _buildSparkline(a, cls){
    const aid=a.id;
    const hist=(bulkHistoryData[aid]||[]);
    const _ms=m=>{const p=(m||'').split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
    const sorted=hist.slice().sort((x,y)=>_ms(x.m)-_ms(y.m));
    const histVals=sorted.slice(-5).map(h=>({v:h.s||h.gmv||0,charge:false}));
    const cm=bulkCurrentMonthData[aid];
    const sig=a.paceSignal;
    let lastBar=null;
    if(cm){
      const mtd=cm.gmv_to_date||0;
      const rr=(sig&&sig.runrate&&sig.runrate>mtd)?sig.runrate:mtd;
      lastBar={v:rr,mtd,charge:rr>mtd};
    }
    const bars=lastBar?[...histVals,lastBar]:histVals;
    if(!bars.length)return'';
    const max=Math.max(...bars.map(b=>b.v),1);
    const c={great:'#4ddc97',safe:'#4ddc97',warn:'#f0b000',danger:'#ff8888',new:'rgba(100,160,255,.7)'};
    const hi=c[cls]||'rgba(255,255,255,.3)';
    return bars.map((b,i)=>{
      const isLast=i===bars.length-1;
      const totalH=Math.max(2,Math.round((b.v/max)*13));
      if(isLast&&b.charge){
        const solidH=Math.max(1,Math.round((b.mtd/max)*13));
        const ghostH=Math.max(0,totalH-solidH);
        return`<div style="display:flex;flex-direction:column;width:6px;height:${totalH}px;flex-shrink:0;align-self:flex-end">`+
          (ghostH>0?`<div style="flex:1;background:${hi};opacity:.2;border-radius:2px 2px 0 0"></div>`:'')  +
          `<div style="height:${solidH}px;background:${hi};opacity:.9;border-radius:${ghostH===0?'2px 2px':0} 0 0"></div></div>`;
      }
      return`<div class="pv-sp-bar" style="width:${isLast?6:4}px;height:${totalH}px;background:${isLast?hi:'rgba(255,255,255,.18)'}"></div>`;
    }).join('');
  }

  function _buildChurnBadge(a){
    const _cc=a._churnCounts;
    const catCount=a.missingCatCount||0;
    const parts=[];
    if(_cc&&_cc.ordered>0)parts.push(`<span style="color:rgba(77,220,151,.8);font-weight:600">สั่ง ${_cc.ordered}</span>`);
    if(_cc&&_cc.gone>0)parts.push(`<span style="color:#ff9060;font-weight:600">หาย ${_cc.gone}</span>`);
    if(_cc&&_cc.near>0)parts.push(`<span style="color:#f0c040;font-weight:600">เฝ้าดู ${_cc.near}</span>`);
    if(_cc&&_cc.total>0)parts.push(`<span style="color:rgba(255,255,255,.6)">/ ${_cc.total} SKU</span>`);
    if(catCount>0)parts.push(`<span style="color:rgba(240,176,0,.85);font-weight:600">${catCount} cat</span>`);
    if(!parts.length)return'';
    const dot=`<span style="color:rgba(255,255,255,.15)">·</span>`;
    return`<span style="font-size:10px;font-family:'IBM Plex Mono',monospace;display:inline-flex;gap:5px;align-items:center">${parts.join(dot)}</span>`;
  }

  const _statusLabel=cls=>{
    if(cls==='great'||cls==='safe'||cls==='ok'||cls==='')return'ON TRACK';
    if(cls==='warn')return'MONITOR';
    if(cls==='danger')return'AT RISK';
    return'';
  };

  function fullCard(a,idx=0){
    const _delay=`animation-delay:${Math.min(idx*35,280)}ms`;
    const _vDot=getVisitDot(_pvVisitMap,a.id);
    const _dotHtml=_vDot!=='unseen'?`<span class="pv-dot ${_vDot}"></span>`:'<span class="pv-dot unseen"></span>';
    const sig=a.paceSignal;
    const isNew=sig&&sig.isNew;
    const cls=sig?sig.cls:'';
    const{acctTypeBadge}=_buildBadges(a);
    const churnSegs=_buildChurnBadge(a);
    const spark=_buildSparkline(a,isNew?'new':cls);
    const handoffBadge=(a.daysWithCurrentKam!==null&&a.daysWithCurrentKam<=30)
      ?`<span style="font-size:8px;font-weight:700;font-family:'IBM Plex Mono',monospace;background:rgba(38,96,200,.18);color:rgba(130,178,255,.8);border:1px solid rgba(38,96,200,.35);border-radius:4px;padding:1px 5px;flex-shrink:0">ใหม่ ${a.daysWithCurrentKam} วัน</span>`
      :'';
    if(isNew){
      return`<div class="portview-acct-card new" style="${_delay}" onclick="portviewSelectAccount('${a.id}')">
        <div class="pv-card-inner">
          <div class="pv-card-left">
            <div class="portview-acct-top">${_dotHtml}<div class="portview-acct-name">${a.name}</div>${acctTypeBadge}</div>
            <div class="portview-acct-gmv-row">ยอด ${sig?fmtK(sig.gmvToDate):'—'} · ยังไม่มี baseline</div>
            <div class="portview-acct-badge-row">${churnSegs}</div>
          </div>
          <div class="pv-right-block">
            <div class="portview-acct-pace new">ร้านใหม่</div>
            <div class="pv-status-label" style="opacity:0">—</div>
            <div class="pv-sparkline">${spark}</div>
          </div>
        </div>
      </div>`;
    }
    const pctStr=sig?sig.pct+'%':'—';
    const rrHtml=sig?(sig.runrate
      ?`<span style="color:rgba(77,220,151,.72)">${fmtK(sig.runrate)}</span> / ${fmtK(sig.baselineGmv||0)}`
      :`${fmtK(sig.gmvToDate)} / ${fmtK(sig.baselineGmv||0)}`)
      :'ไม่มีข้อมูล pace';
    return`<div class="portview-acct-card ${cls}" style="${_delay}" onclick="portviewSelectAccount('${a.id}')">
      <div class="pv-card-inner">
        <div class="pv-card-left">
          <div class="portview-acct-top">${_dotHtml}<div class="portview-acct-name">${a.name}</div>${acctTypeBadge}${handoffBadge}</div>
          <div class="portview-acct-gmv-row">${rrHtml}</div>
          <div class="portview-acct-badge-row">${churnSegs}</div>
        </div>
        <div class="pv-right-block">
          <div class="portview-acct-pace ${cls}">${pctStr}</div>
          <div class="pv-status-label ${cls}">${_statusLabel(cls)}</div>
          <div class="pv-sparkline">${spark}</div>
        </div>
      </div>
    </div>`;
  }

  function compactCard(a,idx=0){
    const _vDot=getVisitDot(_pvVisitMap,a.id);
    const sig=a.paceSignal;
    const isNew=sig&&sig.isNew;
    const cls=isNew?'new':(sig?sig.cls:'');
    const pctStr=isNew?'ร้านใหม่':(sig?sig.pct+'%':'—');
    const _delay=`animation-delay:${Math.min(idx*35,280)}ms`;
    // Compact churn signal: just count of gone+near (the urgent ones)
    const _cc=a._churnCounts;
    let churnMini='';
    if(_cc&&(_cc.gone>0||_cc.near>0)){
      const urgent=(_cc.gone||0)+(_cc.near||0);
      churnMini=`<span class="pv-chip-churn">${urgent}↓</span>`;
    } else if((a.churnedSkuCount||a.churnCount||0)>0){
      // Hidden: old Q8E count — suppress until Q3B data loads
      // churnMini=`<span class="pv-chip-churn">${a.churnedSkuCount||a.churnCount}↓</span>`;
    }
    return`<div class="pv-chip ${cls}" style="${_delay}" onclick="portviewSelectAccount('${a.id}')">
      <span class="pv-chip-dot ${_vDot}"></span>
      <span class="pv-chip-name">${a.name}</span>
      ${churnMini}
      <span class="pv-chip-pace ${cls}">${pctStr}</span>
      <span class="pv-chip-arrow">›</span>
    </div>`;
  }

  // ── View toggle row ──
  const _iconFull=`<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="14" height="6" rx="1.5" fill="currentColor"/><rect x="0" y="8" width="14" height="6" rx="1.5" fill="currentColor"/></svg>`;
  const _iconCompact=`<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="2.5" x2="14" y2="2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="11.5" x2="14" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

  // ── Sort ──
  const _getImpact=a=>{const s=a.paceSignal;if(!s)return 0;const r=s.runrate||s.gmvToDate||0;const b=s.baselineGmv||0;return r-b;};
  const _sorted=[...filtered].sort((a,b)=>{
    let diff=0;
    if(pvSortMode==='gmv'){const ag=a.paceSignal?a.paceSignal.runrate||a.paceSignal.gmvToDate||0:0;const bg=b.paceSignal?b.paceSignal.runrate||b.paceSignal.gmvToDate||0:0;diff=bg-ag;}
    else if(pvSortMode==='impact'){diff=_getImpact(a)-_getImpact(b);}
    else{const o={danger:0,warn:1,safe:2,great:3,new:4,'':5};const ac=a.paceSignal?a.paceSignal.cls:'';const bc=b.paceSignal?b.paceSignal.cls:'';if(o[ac]!==o[bc])return(o[ac]-o[bc])*pvSortDir;diff=(b.paceSignal?.runrate||0)-(a.paceSignal?.runrate||0);}
    return diff*pvSortDir;
  });

  const _toggleRow=`<div class="pv-toggle-row">
    <div style="display:flex;align-items:center;gap:6px">
      <span class="pv-toggle-count">${filtered.length} ร้าน</span>
      <div class="pv-sort-divider"></div>
      <button class="pv-sort-btn ${pvSortMode==='pace'?'on':''}" onclick="setPvSort('pace')">PACE</button>
      <button class="pv-sort-btn ${pvSortMode==='gmv'?'on':''}" onclick="setPvSort('gmv')">GMV</button>
      <button class="pv-sort-btn ${pvSortMode==='impact'?'on':''}" onclick="setPvSort('impact')">IMPACT</button>
    </div>
    <div class="pv-toggle-btns">
      <button class="pv-toggle-btn ${pvViewMode==='full'?'on':''}" onclick="setPvView('full')" title="แบบเต็ม">${_iconFull}</button>
      <button class="pv-toggle-btn ${pvViewMode==='compact'?'on':''}" onclick="setPvView('compact')" title="แบบ compact">${_iconCompact}</button>
    </div>
  </div>`;

  const renderer=pvViewMode==='compact'?compactCard:fullCard;
  const _initialLimit=80;
  const _batchSize=60;
  if(_sorted.length>_initialLimit){
    listEl.innerHTML=_sorted.slice(0,_initialLimit).map((a,i)=>renderer(a,i)).join('');
    let _idx=_initialLimit;
    const _appendBatch=()=>{
      if(_idx>=_sorted.length)return;
      const _next=_sorted.slice(_idx,_idx+_batchSize).map((a,i)=>renderer(a,_idx+i)).join('');
      listEl.insertAdjacentHTML('beforeend',_next);
      _idx+=_batchSize;
      if(_idx<_sorted.length){
        if(window.requestIdleCallback)requestIdleCallback(_appendBatch,{timeout:700});
        else setTimeout(_appendBatch,16);
      }
    };
    if(window.requestIdleCallback)requestIdleCallback(_appendBatch,{timeout:700});
    else setTimeout(_appendBatch,16);
  }else{
    listEl.innerHTML=_sorted.map((a,i)=>renderer(a,i)).join('');
  }
  // Sync sticky sort row in portview-header
  const _sc=document.getElementById('pv-sort-count');if(_sc)_sc.textContent=filtered.length+' ร้าน';
  const _arrow=pvSortDir===1?'↓':'↑';
  ['pace','gmv','impact'].forEach(m=>{const b=document.getElementById('psb-'+m);if(b)b.innerHTML=m.toUpperCase()+(pvSortMode===m?` <span class="sort-dir">${_arrow}</span>`:'');b&&(b.className='pv-sort-btn'+(pvSortMode===m?' on':''));});
  const pbF=document.getElementById('ptb-full');const pbC=document.getElementById('ptb-compact');
  if(pbF)pbF.className='pv-toggle-btn'+(pvViewMode==='full'?' on':'');
  if(pbC)pbC.className='pv-toggle-btn'+(pvViewMode==='compact'?' on':'');
}

function setPvSort(mode){
  if(pvSortMode===mode){pvSortDir*=-1;}else{pvSortMode=mode;pvSortDir=1;}
  window._pvLastRenderMs=Date.now();
  renderPortviewList();
}

// ── Portview scroll-collapse ──
function _pvBuildCompactStrip(){
  const strip=document.getElementById('pv-compact-strip');
  if(!strip)return;
  const accounts=getPortviewAccounts();
  if(!accounts||!accounts.length){strip.innerHTML='';return;}
  const fK=n=>n>=1000000?'฿'+(n/1000000).toFixed(1)+'M':n>=1000?'฿'+Math.round(n/1000)+'K':'฿'+Math.round(n);
  const acctWithPace=accounts.filter(a=>a.paceSignal&&(a.paceSignal.histMonths>0||a.paceSignal.isNew===false));
  const _earlyMonth=acctWithPace.length>0&&(acctWithPace[0].paceSignal.daysElapsed||0)<5;
  const portfolioPace=acctWithPace.length>0
    ?(_earlyMonth
      ?Math.round(acctWithPace.reduce((s,a)=>s+(a.paceSignal.lastGmv||0),0)/Math.max(1,acctWithPace.reduce((s,a)=>s+(a.paceSignal.baselineGmv||0),0))*100)
      :Math.round(acctWithPace.reduce((s,a)=>s+a.paceSignal.gmvToDate,0)/Math.max(1,acctWithPace.reduce((s,a)=>s+a.paceSignal.expected,0))*100))
    :0;
  const ppCls=portfolioPace>=100?'great':portfolioPace>=95?'safe':portfolioPace>=85?'warn':'danger';
  const paceColor=ppCls==='great'||ppCls==='safe'?'#4ddc97':ppCls==='warn'?'var(--amb)':'#ff8888';
  const okA=accounts.filter(a=>!a.paceSignal||(a.paceSignal.cls==='great'||a.paceSignal.cls==='safe'));
  const warnA=accounts.filter(a=>a.paceSignal&&a.paceSignal.cls==='warn');
  const dangerA=accounts.filter(a=>a.paceSignal&&a.paceSignal.cls==='danger');
  const okGmv=okA.reduce((s,a)=>s+(a.paceSignal?a.paceSignal.runrate||0:0),0);
  const warnGmv=warnA.reduce((s,a)=>s+(a.paceSignal.runrate||0),0);
  const dangerGmv=dangerA.reduce((s,a)=>s+(a.paceSignal.runrate||0),0);
  const chips=[
    okA.length?{cls:'ok',lbl:'ON TRACK',val:fK(okGmv),sub:okA.length+' ร้าน'}:null,
    warnA.length?{cls:'warn',lbl:'MONITOR',val:fK(warnGmv),sub:warnA.length+' ร้าน'}:null,
    dangerA.length?{cls:'danger',lbl:'AT RISK',val:fK(dangerGmv),sub:dangerA.length+' ร้าน'}:null,
  ].filter(Boolean);
  const searchIconSvg=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg>`;
  strip.innerHTML=
    `<div class="pv-cs-pace"><div class="pv-cs-pace-val" style="color:${paceColor}">${portfolioPace}%</div><div class="pv-cs-pace-lbl">Pro Rate</div></div>`+
    chips.map((c,i)=>{
      const isOn=portviewFilter===c.cls;
      const isDim=portviewFilter!=='all'&&!isOn;
      return (i>0?'<div class="pv-cs-divider"></div>':'')+
        `<div class="pv-cs-chip ${c.cls}${isOn?' pf-on':''}${isDim?' pf-dim':''}" onclick="setPortviewFilter('${c.cls}');_pvSyncChips()"><div class="pv-cs-label">${c.lbl}</div><div class="pv-cs-val">${c.val}</div><div class="pv-cs-sub">${c.sub}</div></div>`;
    }).join('')+
    `<button class="pv-cs-search" id="pv-cs-search-btn" title="ค้นหา" onclick="(function(){const ex=document.getElementById('pv-sort-search-expand');const b=document.getElementById('pv-cs-search-btn');const open=ex.style.display!=='none';ex.style.display=open?'none':'block';b.classList.toggle('active',!open);if(!open){const i=document.getElementById('pv-search-collapsed');if(i){i.focus();}}else{const i=document.getElementById('pv-search-collapsed');if(i){i.value='';document.getElementById('portview-search').value='';renderPortviewList();}}})()">${searchIconSvg}</button>`;
}

let _pvCollapseObserver=null;
function _pvSyncChips(){
  // Sync active/dim classes on compact strip chips without full rebuild
  const strip=document.getElementById('pv-compact-strip');
  if(!strip)return;
  strip.querySelectorAll('.pv-cs-chip').forEach(chip=>{
    const cls=Array.from(chip.classList).find(c=>['ok','warn','danger'].includes(c));
    if(!cls)return;
    const isOn=portviewFilter===cls;
    const isDim=portviewFilter!=='all'&&!isOn;
    chip.classList.toggle('pf-on',isOn);
    chip.classList.toggle('pf-dim',isDim);
  });
}

function _pvInitCollapseObserver(){
  // v153 surgical patch: use real scroll position instead of relying only on
  // IntersectionObserver + sentinel. The old observer was fragile when the
  // sticky header / scroll root changed, so Portfolio could stop collapsing
  // even though the CSS and DOM were still present.
  if(_pvCollapseObserver){_pvCollapseObserver.disconnect();_pvCollapseObserver=null;}
  const old=document.getElementById('pv-collapse-sentinel');if(old)old.remove();
  const screen=document.getElementById('scr-portview');
  const collapsible=document.getElementById('pv-collapsible');
  const strip=document.getElementById('pv-compact-strip');
  const listEl=document.getElementById('portview-list');
  if(!screen||!collapsible||!strip||!listEl)return;

  let raf=0;
  let lastCollapsed=null;
  const COLLAPSE_AT=42;
  const EXPAND_AT=8;

  function _scrollTop(){
    const se=document.scrollingElement||document.documentElement;
    return Math.max(
      window.pageYOffset||0,
      se?se.scrollTop||0:0,
      document.documentElement?document.documentElement.scrollTop||0:0,
      document.body?document.body.scrollTop||0:0,
      screen.scrollTop||0
    );
  }
  function _aiVisible(){
    const aiOut=document.getElementById('portview-ai-output');
    return !!(aiOut&&aiOut.style.display!=='none');
  }
  function _canExpand(){
    // Keep the previous guard: filter/sort renders can shrink content and fire
    // scroll events; do not treat that as an intentional scroll-back-to-top.
    const msSinceRender=Date.now()-(window._pvLastRenderMs||0);
    return msSinceRender>350&&!_aiVisible();
  }
  function _apply(collapsed){
    if(lastCollapsed===collapsed)return;
    lastCollapsed=collapsed;
    collapsible.className='pv-collapsible '+(collapsed?'collapsed':'expanded');
    strip.className='pv-compact-strip '+(collapsed?'visible':'hidden');
    window._pvLastCollapseMs=collapsed?Date.now():0;
    // Auto-expand search bar when compact strip appears
    const searchExpand=document.getElementById('pv-sort-search-expand');
    if(collapsed&&searchExpand){
      searchExpand.style.display='block';
      const si=document.getElementById('pv-search-collapsed');
      if(si&&!si.value)setTimeout(()=>si.focus(),180);
      const sb=document.getElementById('pv-cs-search-btn');
      if(sb)sb.classList.add('active');
    } else if(!collapsed&&searchExpand){
      const si=document.getElementById('pv-search-collapsed');
      if(si&&!si.value){
        searchExpand.style.display='none';
        const sb=document.getElementById('pv-cs-search-btn');
        if(sb)sb.classList.remove('active');
      }
    }
  }
  function _check(){
    raf=0;
    if(!screen.classList.contains('on'))return;
    const y=_scrollTop();
    if(y>COLLAPSE_AT){
      _apply(true);
    }else if(y<=EXPAND_AT&&_canExpand()){
      _apply(false);
    }
  }
  function _schedule(){
    if(raf)return;
    raf=requestAnimationFrame(_check);
  }

  window.addEventListener('scroll',_schedule,{passive:true});
  document.addEventListener('scroll',_schedule,true);
  screen.addEventListener('scroll',_schedule,{passive:true});
  window.addEventListener('resize',_schedule,{passive:true});

  // Run once after layout settles. Avoid immediate re-expand during render.
  setTimeout(_schedule,180);

  _pvCollapseObserver={disconnect:()=>{
    if(raf){cancelAnimationFrame(raf);raf=0;}
    window.removeEventListener('scroll',_schedule);
    document.removeEventListener('scroll',_schedule,true);
    screen.removeEventListener('scroll',_schedule);
    window.removeEventListener('resize',_schedule);
  }};
}

function setPvView(mode){
  pvViewMode=mode;
  renderPortviewList();
}

function _countUp(el,target,duration){
  if(target===0){el.textContent='0';return;}
  const start=performance.now();
  const tick=t=>{
    const p=Math.min((t-start)/duration,1);
    const eased=1-Math.pow(1-p,3);
    el.textContent=Math.round(eased*target);
    if(p<1)requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderPortviewSummary(){
  const renderer = window.FreshketSenseKamTeamRenderer;
  if(renderer && typeof renderer.renderPortviewSummaryFromLegacy === 'function'){
    try{
      return renderer.renderPortviewSummaryFromLegacy({
        D: D,
        OPPS: OPPS,
        currentAccountId: currentAccountId,
        currentKamSubtab: (typeof currentKamSubtab !== 'undefined' ? currentKamSubtab : null),
        portviewLevel: (typeof portviewLevel !== 'undefined' ? portviewLevel : null),
        portviewFilter: (typeof portviewFilter !== 'undefined' ? portviewFilter : null),
        teamviewLevel: (typeof teamviewLevel !== 'undefined' ? teamviewLevel : null),
        portviewBulkData: (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []),
        currentUserProfile: (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null),
        legacy: { renderPortviewSummary: __legacyRenderPortviewSummaryFallback }
      });
    }catch(e){
      console.warn('renderPortviewSummary renderer failed, falling back to legacy renderer', e);
    }
  }
  return __legacyRenderPortviewSummaryFallback();
}

function __legacyRenderPortviewSummaryFallback(){
  // v224e: Skip render entirely if portview+history not ready yet.
  // Prevents partial renders showing 0%/danger pace before data loads.
  // refreshAll() (gated on allCriticalReady) will trigger the correct render.
  if(typeof allCriticalReady==='function' && !allCriticalReady() &&
     (typeof portviewBulkData==='undefined' || !portviewBulkData || portviewBulkData.length===0)){
    return;
  }
  // v210h: create target widget anchor before legacy pace renders.
  // This prevents the first-login 1-2 frame double-panel flash in KAM Portfolio.
  try { if (typeof _injectPortviewBarEl === 'function') _injectPortviewBarEl(); } catch(_e) {}
  const _preferTargetWidget = !!document.getElementById('tgt-portview-bar');
  const accounts=getPortviewAccounts();
  const danger=accounts.filter(a=>a.paceSignal&&a.paceSignal.cls==='danger').length;
  const warn=accounts.filter(a=>a.paceSignal&&a.paceSignal.cls==='warn').length;
  const ok=accounts.filter(a=>!a.paceSignal||(a.paceSignal.cls==='great'||a.paceSignal.cls==='safe')).length;
  const el=document.getElementById('portview-summary-row');
  if(!el)return;
  const acctWithPace=accounts.filter(a=>a.paceSignal&&a.paceSignal.pct>0);
  const portfolioPace=acctWithPace.length>0?Math.round(acctWithPace.reduce((s,a)=>s+a.paceSignal.gmvToDate,0)/Math.max(1,acctWithPace.reduce((s,a)=>s+a.paceSignal.expected,0))*100):0;
  const ppCls=portfolioPace>=100?'great':portfolioPace>=95?'safe':portfolioPace>=85?'warn':'danger';
  const fmtGMV=n=>n>=1000000?'฿'+(n/1000000).toFixed(1)+'M':n>=1000?'฿'+(n/1000).toFixed(0)+'K':'฿'+Math.round(n);
  // Portfolio-level run rate vs baseline (for pace bar)
  const totalRunRate=acctWithPace.reduce((s,a)=>s+(a.paceSignal.runrate||0),0);
  const totalBaseline=acctWithPace.reduce((s,a)=>s+(a.paceSignal.baselineGmv||0),0);
  // Tier-level GMV
  const okRunRate=accounts.filter(a=>!a.paceSignal||(a.paceSignal.cls==='great'||a.paceSignal.cls==='safe')).reduce((s,a)=>s+(a.paceSignal?a.paceSignal.runrate||0:0),0);
  const warnRunRate=accounts.filter(a=>a.paceSignal&&a.paceSignal.cls==='warn').reduce((s,a)=>s+(a.paceSignal.runrate||0),0);
  const dangerRunRate=accounts.filter(a=>a.paceSignal&&a.paceSignal.cls==='danger').reduce((s,a)=>s+(a.paceSignal.runrate||0),0);
  const okBaseline=accounts.filter(a=>!a.paceSignal||(a.paceSignal.cls==='great'||a.paceSignal.cls==='safe')).reduce((s,a)=>s+(a.paceSignal?a.paceSignal.baselineGmv||0:0),0);
  const okSurplus=Math.max(0,okRunRate-okBaseline);
  const warnShortfall=accounts.filter(a=>a.paceSignal&&a.paceSignal.cls==='warn').reduce((s,a)=>s+Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||0)),0);
  const dangerShortfall=accounts.filter(a=>a.paceSignal&&a.paceSignal.cls==='danger').reduce((s,a)=>s+Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||0)),0);
  // Pace bar with run rate / baseline
  const paceBarEl=document.getElementById('portview-pace-bar');
  // v224e: suppress pace bar if data not fully loaded — prevents low/0% flash
  const _dataReady = typeof allCriticalReady!=='function' || allCriticalReady();
  if(paceBarEl&&acctWithPace.length>0&&!_preferTargetWidget&&_dataReady){
    const _pvDays=acctWithPace[0]?.paceSignal.daysElapsed||0;
    const _pvDaysInMo=acctWithPace[0]?.paceSignal.daysInMonth||30;
    const _totalGmv=acctWithPace.reduce((s,a)=>s+a.paceSignal.gmvToDate,0);
    const _totalExp=acctWithPace.reduce((s,a)=>s+a.paceSignal.expected,0);
    // Value guard: skip full re-render if value unchanged
    const _prevPacePct = paceBarEl.querySelector('#pv-pace-pct');
    if(_prevPacePct && _prevPacePct.textContent===portfolioPace+'%' && paceBarEl.style.display==='block') return;
    paceBarEl.style.display='block';
    paceBarEl.innerHTML=`<div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:6px">
      <div style="display:flex;align-items:baseline;gap:6px">
        <span id="pv-pace-pct" style="font-family:'IBM Plex Mono',monospace;font-size:24px;font-weight:700" class="pace-pct-val ${ppCls}">${portfolioPace}%</span>
        <div style="display:flex;align-items:center;gap:5px">
          <span style="font-size:11px;color:rgba(255,255,255,.4)">Pro Rate พอร์ต</span>
          <button onclick="(function(){const d=document.getElementById('pv-formula-panel');if(!d)return;const open=d.style.display!=='none';d.style.display=open?'none':'block';this.style.background=open?'transparent':'rgba(255,255,255,.15)';}).call(this)" style="width:15px;height:15px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:transparent;color:rgba(255,255,255,.45);font-size:9px;font-style:italic;font-family:Georgia,serif;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700;transition:all .15s">i</button>
        </div>
      </div>
      ${totalBaseline>0?`<div style="text-align:right;line-height:1.4"><span style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:700;color:rgba(255,255,255,.8)">${fmtGMV(totalRunRate)}</span><span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:rgba(255,255,255,.3)"> / ${fmtGMV(totalBaseline)}</span><div style="font-size:9px;color:rgba(255,255,255,.25);text-align:right;margin-top:1px">baseline</div></div>`:''}
    </div>
    <div class="pace-bar-wrap"><div class="pace-bar-fill ${ppCls}" style="width:${Math.min(portfolioPace,100)}%"></div></div>
    <div id="pv-formula-panel" style="display:none">
      <div class="pace-formula-row" style="margin-top:8px">
        <div class="pace-formula-label">วิธีคิด Pro Rate พอร์ต</div>
        <div class="pace-formula-line">ยอดจริงรวม ${acctWithPace.length} ร้าน: <strong>${fmtGMV(_totalGmv)}</strong><br>÷ เป้าสะสมรวม (baseline/วัน × ${_pvDays} วัน): <strong>${fmtGMV(_totalExp)}</strong><br>= <strong>${portfolioPace}%</strong> &nbsp;·&nbsp; ${_pvDays}/${_pvDaysInMo} วัน</div>
      </div>
      <div class="pace-formula-row" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)">
        <div class="pace-formula-label">วิธีคิด Baseline (รวมพอร์ต)</div>
        <div class="pace-formula-line">${(()=>{const agg={};acctWithPace.forEach(a=>{if(!a.paceSignal.monthsDetail||!a.paceSignal.monthsDetail.length)return;a.paceSignal.monthsDetail.forEach(d=>{if(!agg[d.m])agg[d.m]={m:d.m,gmv:0,days:d.days,n:0};agg[d.m].gmv+=d.gmv;agg[d.m].n++;});});const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];const rows=Object.values(agg).sort((a,b)=>{const p=m=>{const s=m.split(' ');return parseInt(s[1]||0)*12+mo.indexOf(s[0]);};return p(a.m)-p(b.m);});const avgDaily=rows.length?Math.round(rows.reduce((s,d)=>s+d.gmv/d.days,0)/rows.length):0;return rows.map(d=>`${d.m}: ${fmtGMV(d.gmv)} ÷ ${d.days}วัน = <strong>${fmtGMV(Math.round(d.gmv/d.days))}/วัน</strong> <span style="color:rgba(255,255,255,.35)">(${d.n} ร้าน)</span>`).join('<br>')+'<br>avg = <strong>'+fmtGMV(avgDaily)+'/วัน</strong> × '+_pvDays+' วัน = <strong>'+fmtGMV(_totalExp)+'</strong>';})()}</div>
      </div>
      <div class="pace-formula-row" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)">
        <div class="pace-formula-label">เกณฑ์ Pace รายร้าน</div>
        <div class="pace-formula-line" style="display:flex;flex-direction:column;gap:3px">
          <div style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#4ddc97;flex-shrink:0"></span><span style="color:#4ddc97;font-weight:700">≥ 100%</span><span style="color:rgba(255,255,255,.45)">ดีเยี่ยม → ปกติ</span></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#4ddc97;flex-shrink:0"></span><span style="color:#4ddc97;font-weight:700">≥ 95%</span><span style="color:rgba(255,255,255,.45)">ปลอดภัย → ปกติ</span></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#f6ad55;flex-shrink:0"></span><span style="color:#f6ad55;font-weight:700">≥ 90%</span><span style="color:rgba(255,255,255,.45)">เสี่ยง → เสี่ยง</span></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#ff8888;flex-shrink:0"></span><span style="color:#ff8888;font-weight:700">&lt; 90%</span><span style="color:rgba(255,255,255,.45)">เสี่ยงมาก → เสี่ยงมาก</span></div>
          <div style="margin-top:4px;font-size:9px;color:rgba(255,255,255,.25);line-height:1.5">baseline = avg daily GMV ย้อน 1–3 เดือน × วันที่ผ่านมา</div>
        </div>
      </div>
    </div>`;
  } else if(paceBarEl){
    paceBarEl.style.display='none';
    paceBarEl.classList.add('pv-legacy-suppressed');
  }
  // Tier grid HTML
  const _pfOk=portviewFilter==='ok'?' pf-active':(portviewFilter!=='all'?' pf-dim':'');
  const _pfWarn=portviewFilter==='warn'?' pf-active':(portviewFilter!=='all'?' pf-dim':'');
  const _pfDanger=portviewFilter==='danger'?' pf-active':(portviewFilter!=='all'?' pf-dim':'');
  // ── Tier box helper: consistent 2-number layout ──
  // ── Tier grid: proportional widths clamped 45-70% for ปกติ ─
  const totalAccts = ok + warn + danger;
  const okRatio = totalAccts > 0 ? ok / totalAccts : 0.6;
  const okColW = Math.round(Math.min(70, Math.max(45, okRatio * 100)));

  // ── At-risk mini card helper (compact) ───────────────────────
  const _tierBox=(cls,pf,lbl,runRate,count,diffVal,diffLbl,diffColor,isDashed)=>{
    if(isDashed)return`<div class="portview-tier-box ${cls}${pf}" data-pf="${pf}" onclick="setPortviewFilter('${pf}')" style="border-style:dashed;align-items:center;justify-content:center;display:flex;gap:6px;flex-direction:row">
      <div class="portview-tier-lbl" style="opacity:.4;margin:0">${lbl}</div>
      <div style="font-size:10px;color:rgba(255,255,255,.25)">0 ร้าน</div>
    </div>`;
    return`<div class="portview-tier-box ${cls}${pf}" data-pf="${cls}" onclick="setPortviewFilter('${cls}')">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:4px;margin-bottom:4px">
        <div style="display:flex;align-items:baseline;gap:5px">
          <div class="portview-tier-lbl" style="margin:0">${lbl}</div>
          <div style="font-size:9px;color:rgba(255,255,255,.35);font-family:'IBM Plex Sans Thai',sans-serif">${count} ร้าน</div>
        </div>
        ${diffVal>0?`<div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;color:${diffColor};flex-shrink:0;line-height:1">-${fmtGMV(diffVal)}</div>`:''}
      </div>
      <div class="portview-tier-val">${fmtGMV(runRate)}</div>
    </div>`;
  };
  const _warnBox=_tierBox('warn',_pfWarn,'MONITOR',warnRunRate,warn,warnShortfall,'ต่ำกว่า baseline','rgba(240,176,0,.9)',warn===0);
  const _dangerBox=_tierBox('danger',_pfDanger,'AT RISK',dangerRunRate,danger,dangerShortfall,'กำลังหาย','rgba(255,136,136,.9)',danger===0);
  try { if (typeof _commRenderKamSelfStrip === 'function') _commRenderKamSelfStrip(); } catch(_e) {}
  // Value guard: skip tier grid rebuild if counts and GMV unchanged
  const _tierKey=`${ok}|${warn}|${danger}|${Math.round(okRunRate)}|${Math.round(warnRunRate)}|${Math.round(dangerRunRate)}`;
  if(el._lastTierKey===_tierKey && el.innerHTML.trim()) return;
  el._lastTierKey=_tierKey;
  el.innerHTML=`<div class="portview-tier-grid">
    <div class="portview-tier-col-ok" style="width:${okColW}%">
      <div class="portview-tier-box safe${_pfOk}" data-pf="ok" onclick="setPortviewFilter('ok')">
        <div style="display:flex;align-items:baseline;gap:5px;margin-bottom:4px">
          <div class="portview-tier-lbl" style="margin:0">ON TRACK</div>
          <div style="font-size:9px;color:rgba(255,255,255,.35);font-family:'IBM Plex Sans Thai',sans-serif">${ok} ร้าน</div>
        </div>
        <div class="portview-tier-val">${fmtGMV(okRunRate)}</div>
        <div style="border-top:1px solid rgba(77,220,151,.18);margin-top:8px;padding-top:7px;display:flex;align-items:baseline;gap:5px">
          <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;color:#4ddc97">${okSurplus>0?'+':''}${fmtGMV(okSurplus)}</span>
          <span style="font-size:10px;color:rgba(255,255,255,.55)">เหนือ baseline</span>
        </div>
      </div>
    </div>
    <div class="portview-tier-col-risk">
      ${_warnBox}
      ${_dangerBox}
    </div>
  </div>`;
  // Update nav badge
  const navBadge=document.getElementById('port-nav-badge');
  if(navBadge){
    const atRisk=danger+warn;
    navBadge.textContent=atRisk;
    navBadge.style.display=atRisk>0?'flex':'none';
  }
}

function portviewSelectAccount(accountId){
  // Navigate to that account + switch to pace tab
  trackVisit(accountId,'account'); // ← visit tracking
  try{
    closeDataPanel&&closeDataPanel();
    window._returnToPortview=true;
    // v224e: TL/Admin — eagerly start bundle fetch BEFORE switchAccount
    // so bundle is in-flight while UI transitions, reducing SKU movement wait time
    const _pvRole=(currentUserProfile&&currentUserProfile.role)||'';
    if(_pvRole==='tl'||_pvRole==='admin'){
      const _pvKamEmail=typeof _getKamEmailForAccount==='function'?_getKamEmailForAccount(accountId):null;
      if(_pvKamEmail&&typeof _fetchKamBundle==='function'){
        _fetchKamBundle(_pvKamEmail).catch(()=>{});
      }
    }
    switchAccount(accountId);
    showScreen('overview');
    setTimeout(()=>{
      if(!isKAM){
        setMode('kam'); // setMode handles renderKamOverview internally
      } else {
        // Already in KAM mode — refreshAll was called by switchAccount but
        // renderKamOverview is guarded by kamStateCache check which may have been stale.
        // Force a header re-render now that currentAccountId and D.meta are definitely updated.
        renderKamOverview();
        const kamCards=document.getElementById('kam-cards');
        if(kamCards)kamCards.style.display='block';
        // Re-enable nav buttons now account is selected
        if(typeof _updateKamNavDisabled==='function')_updateKamNavDisabled();
      }
      setKamSubtab('thismonth');
    },300);
  }catch(err){
    showToast('portviewSelect error: '+err.message,'⚠');
  }
}

function renderPortview(){
  const renderer = window.FreshketSenseKamTeamRenderer;
  if(renderer && typeof renderer.renderPortviewFromLegacy === 'function'){
    try{
      return renderer.renderPortviewFromLegacy({
        D: D,
        OPPS: OPPS,
        currentAccountId: currentAccountId,
        currentKamSubtab: (typeof currentKamSubtab !== 'undefined' ? currentKamSubtab : null),
        portviewLevel: (typeof portviewLevel !== 'undefined' ? portviewLevel : null),
        portviewFilter: (typeof portviewFilter !== 'undefined' ? portviewFilter : null),
        teamviewLevel: (typeof teamviewLevel !== 'undefined' ? teamviewLevel : null),
        portviewBulkData: (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []),
        currentUserProfile: (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null),
        legacy: { renderPortview: __legacyRenderPortviewFallback }
      });
    }catch(e){
      console.warn('renderPortview renderer failed, falling back to legacy renderer', e);
    }
  }
  return __legacyRenderPortviewFallback();
}

function __legacyRenderPortviewFallback(){
  portviewAiDone=false;
  const aiOut=document.getElementById('portview-ai-output');
  if(aiOut)aiOut.style.display='none';
  const heading=document.getElementById('portview-heading');
  const levelBadge=document.getElementById('portview-level-badge');
  const backWrap=document.getElementById('portview-back-wrap');
  const role=currentUserProfile?currentUserProfile.role:'rep';
  if(portviewLevel==='rep-detail'){
    const _repGroup=_buildKamGroups().find(g=>g.kamEmail===portviewRepEmail||g.kamName===portviewRepEmail);
    if(heading)heading.textContent=_repGroup?_repGroup.kamName:(portviewRepEmail||'KAM');
    if(levelBadge)levelBadge.textContent='TL';
    if(backWrap)backWrap.style.display='block';
    const _bl=document.getElementById('portview-back-label');
    if(_bl)_bl.textContent='ภาพรวมทีม';
  } else {
    if(heading)heading.textContent='พอร์ตของฉัน';
    if(levelBadge)levelBadge.textContent=role==='tl'||role==='admin'?'TL':'KAM';
    if(backWrap)backWrap.style.display='none';
  }
  renderPortviewSummary();
  renderPortviewList();
  // Reset collapse state + rebuild compact strip + init observer
  const coll=document.getElementById('pv-collapsible');
  const strip=document.getElementById('pv-compact-strip');
  if(coll){coll.className='pv-collapsible expanded';}
  if(strip){strip.className='pv-compact-strip hidden';}
  // Remove old sentinel
  const old=document.getElementById('pv-collapse-sentinel');if(old)old.remove();
  setTimeout(()=>{_pvBuildCompactStrip();_pvInitCollapseObserver();},120);
}

// ════════════════════════════════════════
// TEAMVIEW — TL TEAM OVERVIEW
// ════════════════════════════════════════
function _tvFmtK(n){return n>=1000000?'฿'+(n/1000000).toFixed(1)+'M':n>=1000?'฿'+(n/1000).toFixed(0)+'K':'฿'+Math.round(n);}


function _tvCurrentPeriod(){
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function _tvTargetsReady(){
  return (typeof _tgtLoaded !== 'undefined' && _tgtLoaded && typeof _tgtGet === 'function');
}
function _tvFirstTlEmail(accounts){
  const rows = Array.isArray(accounts) ? accounts : [];
  const direct = rows.find(a => a && a.tlEmail);
  if (direct && direct.tlEmail) return direct.tlEmail;
  const kamEmail = rows.find(a => a && a.kamEmail)?.kamEmail || '';
  if (kamEmail && Array.isArray(portviewBulkData)) {
    const sameKam = portviewBulkData.find(a => a && a.kamEmail === kamEmail && a.tlEmail);
    if (sameKam && sameKam.tlEmail) return sameKam.tlEmail;
  }
  return '';
}
function _tvResolveKamDenominator(g, fallbackBaseline){
  const baseline = Math.max(0, Number(fallbackBaseline || 0));
  let target = 0;
  let mode = 'base';
  let label = 'baseline';
  const period = _tvCurrentPeriod();
  const kamEmail = (g && g.kamEmail) || '';

  if (_tvTargetsReady()) {
    if (kamEmail) target = Number(_tgtGet(period, 'kam', kamEmail) || 0);
    if (target > 0) {
      mode = 'kam';
      label = 'target';
    } else {
      const tlEmail = _tvFirstTlEmail(g && g.accounts);
      const tlTarget = tlEmail ? Number(_tgtGet(period, 'team', tlEmail) || 0) : 0;
      if (tlTarget > 0) {
        const kamBaseline = (typeof _tgtKamBaseline3mo === 'function' && kamEmail)
          ? (_tgtKamBaseline3mo(kamEmail, null, 'kam') || baseline)
          : baseline;
        const teamBaseline = (typeof _tgtKamBaseline3mo === 'function')
          ? (_tgtKamBaseline3mo(null, tlEmail, 'tl') || 0)
          : 0;
        let share = teamBaseline > 0 ? kamBaseline / teamBaseline : 0;
        if (!(share > 0)) {
          const kamCount = (typeof _tgtGetKamsForTL === 'function' ? _tgtGetKamsForTL(tlEmail).length : 0) || 1;
          share = 1 / Math.max(1, kamCount);
        }
        target = Math.round(tlTarget * share);
        if (target > 0) {
          mode = 'team';
          label = 'allocated target';
        }
      }
    }
  }

  const denominator = target > 0 ? target : baseline;
  return { denominator, target, baseline, mode, label, hasTarget: target > 0 };
}
function _tvResolveTeamDenominator(groups, allAccts){
  groups = Array.isArray(groups) ? groups : [];
  allAccts = Array.isArray(allAccts) ? allAccts : [];
  const baseline = groups.reduce((s,g) => s + Number(g.baseline || 0), 0);
  let target = 0;
  let mode = 'base';
  let label = 'baseline';
  const period = _tvCurrentPeriod();

  if (_tvTargetsReady()) {
    const role = (currentUserProfile && currentUserProfile.role) || '';
    const email = (currentUserProfile && currentUserProfile.email) || '';
    if (role === 'tl' && email) {
      target = Number(_tgtGet(period, 'team', email) || 0);
      if (target > 0) { mode = 'team'; label = 'target'; }
    } else if (role === 'admin') {
      const tlEmails = Array.from(new Set(allAccts.map(a => a && a.tlEmail).filter(Boolean)));
      const sumTeamTargets = tlEmails.reduce((s,tl) => s + Number(_tgtGet(period, 'team', tl) || 0), 0);
      if (sumTeamTargets > 0) { target = sumTeamTargets; mode = 'team'; label = 'target'; }
    }
    if (!(target > 0)) {
      const sumKamTargets = groups.reduce((s,g) => s + Number(g.target || 0), 0);
      if (sumKamTargets > 0) { target = sumKamTargets; mode = 'kam'; label = 'KAM targets'; }
    }
  }

  const denominator = target > 0 ? target : baseline;
  return { denominator, target, baseline, mode, label, hasTarget: target > 0 };
}
function _tvDenomLabel(info){
  if (!info || !info.hasTarget) return 'baseline';
  return info.mode === 'team' ? 'target' : (info.mode === 'kam' ? 'KAM target' : 'target');
}

// SECTION:TEAMVIEW
function _buildKamGroups(){
  // Group portviewBulkData by kamEmail, filtered to TL's accounts
  const tlEmail=(currentUserProfile&&currentUserProfile.email)||'';
  const hasEmailCols=portviewBulkData.some(r=>r.kamEmail||r.tlEmail);
  let accounts=portviewBulkData;
  if(hasEmailCols&&tlEmail){
    const filtered=portviewBulkData.filter(r=>r.tlEmail===tlEmail);
    if(filtered.length>0)accounts=filtered;
  }
  // Enrich accounts with 3-month sorted baseline (same as getPortviewAccounts)
  const _tvMoSrt=m=>{const p=(m||'').split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
  const enrichedAccounts=accounts.map(a=>{
    const cm=bulkCurrentMonthData[a.id];
    const hist=bulkHistoryData[a.id];
    if(cm&&hist&&hist.length>0){
      const histSorted=hist.slice().sort((a,b)=>_tvMoSrt(a.m)-_tvMoSrt(b.m));
      return{...a,paceSignal:computePaceSignal(cm,histSorted)};
    }
    return a;
  });
  const groups={};
  enrichedAccounts.forEach(a=>{
    const key=a.kamEmail||a.kamName||'ไม่มี KAM';
    if(!groups[key])groups[key]={kamEmail:a.kamEmail||'',kamName:a.kamName||key,accounts:[]};
    groups[key].accounts.push(a);
  });
  // Compute per-KAM stats
  return Object.values(groups).map(g=>{
    const accts=g.accounts;
    const withPace=accts.filter(a=>a.paceSignal&&a.paceSignal.pct>0);
    const danger=accts.filter(a=>a.paceSignal&&a.paceSignal.cls==='danger').length;
    const warn=accts.filter(a=>a.paceSignal&&a.paceSignal.cls==='warn').length;
    const ok=accts.length-danger-warn;
    const runRate=withPace.reduce((s,a)=>s+(a.paceSignal.runrate||0),0);
    // v205c: use _tgtKamBaseline3mo for consistent 3-month baseline
    const baseline=typeof _tgtKamBaseline3mo==='function'?(_tgtKamBaseline3mo(g.kamEmail,null,'kam')||withPace.reduce((s,a)=>s+(a.paceSignal.baselineGmv||0),0)):(withPace.reduce((s,a)=>s+(a.paceSignal.baselineGmv||0),0));
    // v207f: if a real KAM/team target exists, every Teamview % must use runRate ÷ target; baseline is fallback only.
    const targetInfo=_tvResolveKamDenominator({...g,accounts:accts},baseline);
    const denominator=targetInfo.denominator||baseline;
    const pace=denominator>0?Math.round(runRate/denominator*100):(withPace.length?Math.round(withPace.reduce((s,a)=>s+a.paceSignal.gmvToDate,0)/Math.max(1,withPace.reduce((s,a)=>s+a.paceSignal.expected,0))*100):0);
    const shortfall=denominator>0?Math.max(0,denominator-runRate):0;
    const paceCls=pace>=105?'star':pace>=100?'great':pace>=95?'safe':pace>=90?'warn':'danger';
    const worstCls=(paceCls==='danger'||paceCls==='warn')?paceCls:'ok';
    return{...g,pace,paceCls,danger,warn,ok,shortfall,runRate,baseline,target:targetInfo.target,targetDenominator:denominator,targetMode:targetInfo.mode,targetLabel:targetInfo.label,hasTarget:targetInfo.hasTarget,worstCls,total:accts.length};
  }).sort((a,b)=>{
    const order={danger:0,warn:1,ok:2};
    return(order[a.worstCls]??2)-(order[b.worstCls]??2)||b.shortfall-a.shortfall;
  });
}

function renderTeamview(){
  const renderer = window.FreshketSenseKamTeamRenderer;
  if(renderer && typeof renderer.renderTeamviewFromLegacy === 'function'){
    try{
      return renderer.renderTeamviewFromLegacy({
        D: D,
        OPPS: OPPS,
        currentAccountId: currentAccountId,
        currentKamSubtab: (typeof currentKamSubtab !== 'undefined' ? currentKamSubtab : null),
        portviewLevel: (typeof portviewLevel !== 'undefined' ? portviewLevel : null),
        portviewFilter: (typeof portviewFilter !== 'undefined' ? portviewFilter : null),
        teamviewLevel: (typeof teamviewLevel !== 'undefined' ? teamviewLevel : null),
        portviewBulkData: (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []),
        currentUserProfile: (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null),
        legacy: { renderTeamview: __legacyRenderTeamviewFallback }
      });
    }catch(e){
      console.warn('renderTeamview renderer failed, falling back to legacy renderer', e);
    }
  }
  return __legacyRenderTeamviewFallback();
}

function __legacyRenderTeamviewFallback(){
  teamviewAiDone=false;
  const aiOut=document.getElementById('tv-ai-output');
  if(aiOut)aiOut.style.display='none';
  // Show TL/Admin action buttons in teamview header
  const _roleNow=getCurrentRole();
  const _isTLAdmin=(isTLRole(_roleNow)||isAdminRole(_roleNow));
  const _tvPortBtn=document.getElementById('tv-portfolio-btn');
  if(_tvPortBtn) _tvPortBtn.style.display=_isTLAdmin?'flex':'none';
  const _tvTgtBtn=document.getElementById('tv-target-btn');
  if(_tvTgtBtn){
    _tvTgtBtn.style.display=_isTLAdmin?'flex':'none';
    window._tgtAdminMode=isAdminRole(_roleNow)?'admin':'tl';
  }
  const _tvCommBtn=document.getElementById('tv-commission-btn');
  // v210h: Commission Cockpit is admin-only. Hide at source for TL/KAM, not just block clicks.
  if(_tvCommBtn){
    const _isAdmin = isAdminRole(getCurrentRole());
    _tvCommBtn.classList.toggle('comm-admin-hidden', !_isAdmin);
    _tvCommBtn.setAttribute('aria-hidden', _isAdmin ? 'false' : 'true');
    _tvCommBtn.tabIndex = _isAdmin ? 0 : -1;
    _tvCommBtn.style.display = _isAdmin ? 'inline-flex' : 'none';
  }
  const titleEl=document.getElementById('tv-title');
  const backWrap=document.getElementById('tv-back-wrap');
  if(!portviewBulkData||!portviewBulkData.length){
    document.getElementById('teamview-content').innerHTML=`<div class="portview-no-data"><div class="portview-no-data-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="10" width="24" height="17" rx="2" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" fill="none"/><path d="M4 16h6l2 3h8l2-3h6" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" stroke-linejoin="round" fill="none"/><path d="M11 7l5-3 5 3" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="portview-no-data-text">ยังไม่มีข้อมูลทีม</div><div class="portview-no-data-sub">อัปโหลด portview.csv (Q8E)<br>เพื่อดูพอร์ตของ KAM แต่ละคนในทีม</div></div>`;
    if(titleEl)titleEl.textContent='ภาพรวมทีม';
    if(backWrap)backWrap.style.display='none';
    renderTeamviewSummary();
    return;
  }
  if(false){
    // (drill-down now handled by portview — kept as structural placeholder)
  } else {
    if(titleEl)titleEl.textContent='ภาพรวมทีม';
    if(backWrap)backWrap.style.display='none';
    renderTeamviewSummary();
    renderTeamviewKamList();
    // v154c: Teamview must stay expanded. Do not attach the scroll-collapse behavior here.
    if(_tvCollapseObserver){_tvCollapseObserver.disconnect();_tvCollapseObserver=null;}
    const tvColl=document.getElementById('tv-collapsible');
    const tvStrip=document.getElementById('tv-compact-strip');
    if(tvColl){tvColl.className='pv-collapsible expanded';}
    if(tvStrip){tvStrip.className='pv-compact-strip hidden';tvStrip.innerHTML='';}
    const _tvSen=document.getElementById('tv-collapse-sentinel');if(_tvSen)_tvSen.remove();
  }
}

function teamviewGoBack(){
  teamviewKamFilter=null;
  renderTeamview();
}

// ── Teamview scroll-collapse (TL/Admin) ──
let _tvCollapseObserver=null;
function _tvBuildCompactStrip(){
  const strip=document.getElementById('tv-compact-strip');
  if(!strip)return;
  const groups=_buildKamGroups();
  if(!groups||!groups.length){strip.innerHTML='';return;}
  const fK=n=>n>=1000000?'฿'+(n/1000000).toFixed(1)+'M':n>=1000?'฿'+Math.round(n/1000)+'K':'฿'+Math.round(n);
  const totalGmv=groups.reduce((s,g)=>s+(g.portfolioRunRate||0),0);
  const totalBaseline=groups.reduce((s,g)=>s+(g.portfolioBaseline||0),0);
  const pace=totalBaseline>0?Math.round(totalGmv/totalBaseline*100):0;
  const cls=pace>=100?'great':pace>=95?'safe':pace>=85?'warn':'danger';
  const color=cls==='great'||cls==='safe'?'#4ddc97':cls==='warn'?'var(--amb)':'#ff8888';
  const danger=groups.filter(g=>g.cls==='danger');const warn=groups.filter(g=>g.cls==='warn');const ok=groups.filter(g=>g.cls==='safe'||g.cls==='great'||!g.cls);
  const searchIconSvg=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg>`;
  const chips=[
    ok.length?{cls:'ok',lbl:'ON TRACK',val:fK(ok.reduce((s,g)=>s+(g.portfolioRunRate||0),0)),sub:ok.length+' KAM'}:null,
    warn.length?{cls:'warn',lbl:'MONITOR',val:fK(warn.reduce((s,g)=>s+(g.portfolioRunRate||0),0)),sub:warn.length+' KAM'}:null,
    danger.length?{cls:'danger',lbl:'AT RISK',val:fK(danger.reduce((s,g)=>s+(g.portfolioRunRate||0),0)),sub:danger.length+' KAM'}:null,
  ].filter(Boolean);
  strip.innerHTML=
    `<div class="pv-cs-pace"><div class="pv-cs-pace-val" style="color:${color}">${pace}%</div><div class="pv-cs-pace-lbl">Pro Rate</div></div>`+
    chips.map((c,i)=>(i>0?'<div class="pv-cs-divider"></div>':'')+`<div class="pv-cs-chip ${c.cls}"><div class="pv-cs-label">${c.lbl}</div><div class="pv-cs-val">${c.val}</div><div class="pv-cs-sub">${c.sub}</div></div>`).join('')+
    `<button class="pv-cs-search" title="ค้นหา" onclick="(function(){const ex=document.getElementById('tv-sort-search-expand');const open=ex.style.display!=='none';ex.style.display=open?'none':'block';if(!open){const i=document.getElementById('tv-search-collapsed');if(i)i.focus();}else{const i=document.getElementById('tv-search-collapsed');if(i){i.value='';const ts=document.getElementById('tv-search');if(ts){ts.value='';renderTeamviewKamList();}}}}})()">${searchIconSvg}</button>`;
  const sc=document.getElementById('tv-sort-count');if(sc)sc.textContent=groups.length+' KAM';
}
function _tvInitCollapseObserver(){
  // v154c: disabled by design. Teamview should keep the full summary visible.
  // Keep this as a safeguard because older call sites may still invoke it.
  if(_tvCollapseObserver){_tvCollapseObserver.disconnect();_tvCollapseObserver=null;}
  const oldSen=document.getElementById('tv-collapse-sentinel');if(oldSen)oldSen.remove();
  const collapsible=document.getElementById('tv-collapsible');
  const strip=document.getElementById('tv-compact-strip');
  if(collapsible)collapsible.className='pv-collapsible expanded';
  if(strip){strip.className='pv-compact-strip hidden';strip.innerHTML='';}
}


function renderTeamviewSummary(){
  const renderer = window.FreshketSenseKamTeamRenderer;
  if(renderer && typeof renderer.renderTeamviewSummaryFromLegacy === 'function'){
    try{
      return renderer.renderTeamviewSummaryFromLegacy({
        D: D,
        OPPS: OPPS,
        currentAccountId: currentAccountId,
        currentKamSubtab: (typeof currentKamSubtab !== 'undefined' ? currentKamSubtab : null),
        portviewLevel: (typeof portviewLevel !== 'undefined' ? portviewLevel : null),
        portviewFilter: (typeof portviewFilter !== 'undefined' ? portviewFilter : null),
        teamviewLevel: (typeof teamviewLevel !== 'undefined' ? teamviewLevel : null),
        portviewBulkData: (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []),
        currentUserProfile: (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null),
        legacy: { renderTeamviewSummary: __legacyRenderTeamviewSummaryFallback }
      });
    }catch(e){
      console.warn('renderTeamviewSummary renderer failed, falling back to legacy renderer', e);
    }
  }
  return __legacyRenderTeamviewSummaryFallback();
}

function __legacyRenderTeamviewSummaryFallback(){
  const groups=_buildKamGroups();
  const allAccts=groups.flatMap(g=>g.accounts);
  const withPace=allAccts.filter(a=>a.paceSignal&&(a.paceSignal.histMonths>0||a.paceSignal.isNew===false));
  const _tvEarlyMonth=withPace.length>0&&(withPace[0].paceSignal.daysElapsed||0)<5;
  const _tvTotalRunRate=_tvEarlyMonth
    ?withPace.reduce((s,a)=>s+(a.paceSignal.lastGmv||0),0)
    :withPace.reduce((s,a)=>s+(a.paceSignal.runrate||0),0);
  const _tvTotalBaseline=groups.reduce((s,g)=>s+(g.baseline||0),0) || withPace.reduce((s,a)=>s+(a.paceSignal.baselineGmv||0),0);
  const _tvTeamTargetInfo=_tvResolveTeamDenominator(groups,allAccts);
  const _tvDenominator=_tvTeamTargetInfo.denominator||_tvTotalBaseline;
  const teamPace=_tvDenominator>0?Math.round(_tvTotalRunRate/_tvDenominator*100):(withPace.length?Math.round(withPace.reduce((s,a)=>s+(a.paceSignal.lastGmv||0),0)/Math.max(1,withPace.reduce((s,a)=>s+(a.paceSignal.baselineGmv||0),0))*100):0);
  const teamPaceCls=teamPace>=105?'star':teamPace>=100?'great':teamPace>=95?'safe':teamPace>=90?'warn':'danger';
  const totalDanger=groups.filter(g=>g.paceCls==='danger').length;
  const totalWarn=groups.filter(g=>g.paceCls==='warn').length;
  const totalShortfall=groups.reduce((s,g)=>s+(g.shortfall||0),0);
  const fmtSF=n=>n>=1000000?(n/1000000).toFixed(1)+'M':n>=1000?(n/1000).toFixed(0)+'K':Math.round(n);
  const paceBarEl=document.getElementById('tv-pace-bar');
  if(paceBarEl&&withPace.length){
    const _tvDays=withPace[0]?.paceSignal.daysElapsed||0;
    const _tvDaysInMo=withPace[0]?.paceSignal.daysInMonth||30;
    const _tvTotalGmv=withPace.reduce((s,a)=>s+a.paceSignal.gmvToDate,0);
    const _tvTotalExp=withPace.reduce((s,a)=>s+a.paceSignal.expected,0);
    const _tvFmtG=n=>n>=1000000?'฿'+(n/1000000).toFixed(1)+'M':n>=1000?'฿'+(n/1000).toFixed(0)+'K':'฿'+Math.round(n);
    const _tvDenomLabelTxt=_tvDenomLabel(_tvTeamTargetInfo);
    paceBarEl.style.display='block';
    const _prevPacePct = paceBarEl.querySelector('#pv-pace-pct');
    const _prevPaceVal = _prevPacePct ? parseInt(_prevPacePct.textContent)||0 : 0;
    paceBarEl.innerHTML=`<div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:6px">
      <div style="display:flex;align-items:baseline;gap:6px">
        <span style="font-family:'IBM Plex Mono',monospace;font-size:24px;font-weight:700" class="pace-pct-val ${teamPaceCls}">${teamPace}%</span>
        <div style="display:flex;align-items:center;gap:5px">
          <span style="font-size:11px;color:rgba(255,255,255,.65)">Pro Rate ทีม · ${groups.length} KAM</span>
          <button onclick="(function(){const d=document.getElementById('tv-formula-panel');if(!d)return;const open=d.style.display!=='none';d.style.display=open?'none':'block';this.style.background=open?'transparent':'rgba(255,255,255,.15)';}).call(this)" style="width:15px;height:15px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:transparent;color:rgba(255,255,255,.55);font-size:9px;font-style:italic;font-family:Georgia,serif;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700;transition:all .15s">i</button>
        </div>
      </div>
      ${_tvDenominator>0?`<div style="text-align:right;line-height:1.4"><span style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:700;color:rgba(255,255,255,.85)">${_tvFmtG(_tvTotalRunRate)}</span><span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:rgba(255,255,255,.45)"> / ${_tvFmtG(_tvDenominator)}</span><div style="font-size:9px;color:rgba(255,255,255,.4);text-align:right;margin-top:1px">${_tvDenomLabelTxt}</div></div>`:''}
    </div>
    <div class="pace-bar-wrap"><div class="pace-bar-fill ${teamPaceCls}" style="width:${Math.min(teamPace,100)}%"></div></div>
    <div id="tv-formula-panel" style="display:none">
      <div class="pace-formula-row" style="margin-top:8px">
        <div class="pace-formula-label">วิธีคิด Pro Rate ทีม</div>
        <div class="pace-formula-line">${_tvTeamTargetInfo.hasTarget?`Run rate รวม: <strong>${_tvFmtG(_tvTotalRunRate)}</strong><br>÷ ${_tvDenomLabelTxt} รวม: <strong>${_tvFmtG(_tvDenominator)}</strong><br>= <strong>${teamPace}%</strong> &nbsp;·&nbsp; ${_tvDays}/${_tvDaysInMo} วัน`:`ยอดจริงรวม ${withPace.length} ร้าน: <strong>${_tvFmtG(_tvTotalGmv)}</strong><br>÷ เป้าสะสมรวม (baseline/วัน × ${_tvDays} วัน): <strong>${_tvFmtG(_tvTotalExp)}</strong><br>= <strong>${teamPace}%</strong> &nbsp;·&nbsp; ${_tvDays}/${_tvDaysInMo} วัน`}</div>
      </div>
      <div class="pace-formula-row" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)">
        <div class="pace-formula-label">วิธีคิด Baseline (รวมทีม)</div>
        <div class="pace-formula-line">${(()=>{const agg={};withPace.forEach(a=>{if(!a.paceSignal.monthsDetail||!a.paceSignal.monthsDetail.length)return;a.paceSignal.monthsDetail.forEach(d=>{if(!agg[d.m])agg[d.m]={m:d.m,gmv:0,days:d.days,n:0};agg[d.m].gmv+=d.gmv;agg[d.m].n++;});});const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];const rows=Object.values(agg).sort((a,b)=>{const p=m=>{const s=m.split(' ');return parseInt(s[1]||0)*12+mo.indexOf(s[0]);};return p(a.m)-p(b.m);});const avgDaily=rows.length?Math.round(rows.reduce((s,d)=>s+d.gmv/d.days,0)/rows.length):0;return rows.map(d=>`${d.m}: ${_tvFmtG(d.gmv)} ÷ ${d.days}วัน = <strong>${_tvFmtG(Math.round(d.gmv/d.days))}/วัน</strong> <span style="color:rgba(255,255,255,.35)">(${d.n} ร้าน)</span>`).join('<br>')+'<br>avg = <strong>'+_tvFmtG(avgDaily)+'/วัน</strong> × '+_tvDays+' วัน = <strong>'+_tvFmtG(_tvTotalExp)+'</strong>';})()}</div>
      </div>
      <div class="pace-formula-row" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)">
        <div class="pace-formula-label">เกณฑ์ Pace รายร้าน</div>
        <div class="pace-formula-line" style="display:flex;flex-direction:column;gap:3px">
          <div style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#d8b4fe;flex-shrink:0"></span><span style="color:#d8b4fe;font-weight:700">≥ 105%</span><span style="color:rgba(255,255,255,.55)">เกินเป้า → ดาว</span></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#4ddc97;flex-shrink:0"></span><span style="color:#4ddc97;font-weight:700">≥ 100%</span><span style="color:rgba(255,255,255,.55)">ดีเยี่ยม → ปกติ</span></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#4ddc97;flex-shrink:0"></span><span style="color:#4ddc97;font-weight:700">≥ 95%</span><span style="color:rgba(255,255,255,.55)">ปลอดภัย → ปกติ</span></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#f6ad55;flex-shrink:0"></span><span style="color:#f6ad55;font-weight:700">≥ 90%</span><span style="color:rgba(255,255,255,.55)">เสี่ยง → เสี่ยง</span></div>
          <div style="display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#ff8888;flex-shrink:0"></span><span style="color:#ff8888;font-weight:700">&lt; 90%</span><span style="color:rgba(255,255,255,.55)">เสี่ยงมาก → เสี่ยงมาก</span></div>
          <div style="margin-top:4px;font-size:9px;color:rgba(255,255,255,.35);line-height:1.5">${_tvTeamTargetInfo.hasTarget?'target = target ที่ตั้งไว้; หากไม่มี KAM target จะ allocate จาก team target ตาม baseline share':'baseline = avg daily GMV ย้อน 1–3 เดือน × วันที่ผ่านมา'}</div>
        </div>
      </div>
    </div>`;
  } else if(paceBarEl)paceBarEl.style.display='none';
  // Tier-level ฿ computation
  const okAccts=allAccts.filter(a=>a.paceSignal&&(a.paceSignal.cls==='great'||a.paceSignal.cls==='safe'));
  const warnAccts=allAccts.filter(a=>a.paceSignal&&a.paceSignal.cls==='warn');
  const dangerAccts=allAccts.filter(a=>a.paceSignal&&a.paceSignal.cls==='danger');
  const _sum=(arr,fn)=>arr.reduce((s,a)=>s+fn(a),0);
  const okSurplus=_sum(okAccts,a=>(a.paceSignal.runrate||0)-(a.paceSignal.baselineGmv||0));
  const warnShort=_sum(warnAccts,a=>Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||0)));
  const dangerShort=_sum(dangerAccts,a=>Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||0)));
  const _amt=(n,pos)=>pos?(n>0?'+฿'+fmtSF(n):''):('-฿'+fmtSF(n));

  const sumEl=document.getElementById('tv-summary-row');
  if(sumEl){
    const govCard = _tgtRenderTeamGovCard();
    sumEl.innerHTML=`${govCard}
    <div class="portview-stat"><div class="portview-stat-val" style="color:#fff;font-size:20px">${allAccts.length}</div><div class="portview-stat-lbl" style="font-size:9px">${groups.length} KAM</div></div>
    <div class="portview-stat ok"><div class="portview-stat-val" style="color:#4ddc97;font-size:20px">${okAccts.length}</div>${okSurplus>0?`<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:700;color:#4ddc97;margin-top:3px">+฿${fmtSF(okSurplus)}</div>`:''}</div>
    <div class="portview-stat ${warnAccts.length>0?'warn':'ok'}"><div class="portview-stat-val" style="font-size:20px">${warnAccts.length}</div>${warnShort>0?`<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:700;color:var(--amb);margin-top:3px">-฿${fmtSF(warnShort)}</div>`:''}</div>
    <div class="portview-stat ${dangerAccts.length>0?'danger':'ok'}"><div class="portview-stat-val" style="font-size:20px">${dangerAccts.length}</div>${dangerShort>0?`<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:700;color:#ff8888;margin-top:3px">-฿${fmtSF(dangerShort)}</div>`:''}</div>`;
  }
}

function renderTeamviewKamList(){
  const renderer = window.FreshketSenseKamTeamRenderer;
  if(renderer && typeof renderer.renderTeamviewKamListFromLegacy === 'function'){
    try{
      return renderer.renderTeamviewKamListFromLegacy({
        D: D,
        OPPS: OPPS,
        currentAccountId: currentAccountId,
        currentKamSubtab: (typeof currentKamSubtab !== 'undefined' ? currentKamSubtab : null),
        portviewLevel: (typeof portviewLevel !== 'undefined' ? portviewLevel : null),
        portviewFilter: (typeof portviewFilter !== 'undefined' ? portviewFilter : null),
        teamviewLevel: (typeof teamviewLevel !== 'undefined' ? teamviewLevel : null),
        portviewBulkData: (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []),
        currentUserProfile: (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null),
        legacy: { renderTeamviewKamList: __legacyRenderTeamviewKamListFallback }
      });
    }catch(e){
      console.warn('renderTeamviewKamList renderer failed, falling back to legacy renderer', e);
    }
  }
  return __legacyRenderTeamviewKamListFallback();
}

// v226-qc: per-render cache for _commBuildKamPayout (called up to 3× per KAM card)
const _kamPayoutCache = {};
let _kamPayoutCacheKey = '';
function _getCachedKamPayout(kamEmail) {
  // v232-fix: include bulkUpsellTeamData size in key.
  // Bug: fast-path uses bulkUpsellTeamData but key only tracked bulkUpsellData.loaded
  // → cache hit after upsell_team loads → stale result (NRR only, no upsell) returned forever.
  const _utN = typeof bulkUpsellTeamData!=='undefined'&&bulkUpsellTeamData?Object.keys(bulkUpsellTeamData).length:0;
  const cacheKey = (typeof _nrrExclusionCurrentPeriod==='function'?_nrrExclusionCurrentPeriod():'') + '|' + (typeof bulkUpsellData!=='undefined'&&bulkUpsellData&&bulkUpsellData.loaded?'u':'') + '|t' + _utN;
  if (_kamPayoutCacheKey !== cacheKey) {
    Object.keys(_kamPayoutCache).forEach(k => delete _kamPayoutCache[k]);
    _kamPayoutCacheKey = cacheKey;
  }
  if (!_kamPayoutCache[kamEmail]) {
    _kamPayoutCache[kamEmail] = typeof _commBuildKamPayout==='function' ? _commBuildKamPayout(kamEmail) : null;
  }
  return _kamPayoutCache[kamEmail];
}

async function __legacyRenderTeamviewKamListFallbackAsync(){
  window._tvLastRenderMs=Date.now();
  const el=document.getElementById('teamview-content');
  if(!el)return;

  // v225f: ensure targets loaded BEFORE _buildKamGroups().
  // Root cause: original code built groups first, then awaited visit map.
  // _tvResolveKamDenominator() inside _buildKamGroups() checks _tvTargetsReady()=(_tgtLoaded&&_tgtGet).
  // If targets not yet loaded when groups are built → denominator=baseline, baked in permanently.
  // Fix: load targets first → then build groups → groups use correct targets from the start.
  if(typeof _tgtLoaded !== 'undefined' && !_tgtLoaded){
    if(typeof loadTargets === 'function' && typeof _tgtCurrentQuarter === 'function'){
      try{ await loadTargets(_tgtCurrentQuarter()); }catch(e){}
    }
  }

  // v231-fix: if upsell_team not in memory, backfill from R2 before rendering.
  // Root cause: IDB-FAST path skips upsell_team when not in IDB cache, and R2 fetch
  // can silently fail (AbortSignal / timeout) with no retry in teamview.
  // The v230-fix in _commOpenTlDetailSheet handles this only on commission cockpit open.
  // This fix gives teamview its own one-shot self-heal so shimmer resolves automatically.
  const _upsellTeamNow = typeof bulkUpsellTeamData !== 'undefined' &&
                         bulkUpsellTeamData && Object.keys(bulkUpsellTeamData).length > 0;
  if (!_upsellTeamNow && !window._tvUpsellFetchInFlight) {
    window._tvUpsellFetchInFlight = true;
    const _canFetch = typeof _fetchCloudflareFile === 'function' &&
                      typeof R2_SPECS !== 'undefined' && R2_SPECS && R2_SPECS['upsell_team'];
    if (_canFetch) {
      _fetchCloudflareFile(R2_SPECS['upsell_team'], {force:true}).finally(function(){
        window._tvUpsellFetchInFlight = false;
        // ingestCSVText callback already calls renderTeamview() — this is a safety-net
        // for cases where the tab wasn't active during the callback.
        try{
          if(typeof renderTeamviewKamList==='function' &&
             document.getElementById('scr-teamview')?.classList.contains('on'))
            renderTeamviewKamList();
        }catch(e){}
      });
    } else {
      window._tvUpsellFetchInFlight = false;
    }
  }

  const groups=_buildKamGroups();
  // Pre-fetch visit data from Supabase for TL/Admin (so "ทำการบ้าน" shows KAM's actual visits)
  const _isTLAdmin = currentUserProfile && (currentUserProfile.role==='tl'||currentUserProfile.role==='admin');
  if(_isTLAdmin && typeof getTeamVisitMapFromSupabase === 'function'){
    const kamEmails = [...new Set(groups.map(g=>g.kamEmail).filter(Boolean))];
    window._tvVisitMap = await getTeamVisitMapFromSupabase(kamEmails);
  } else {
    window._tvVisitMap = null; // KAM reads own localStorage via getVisitMap()
  }
  __legacyRenderTeamviewKamListSync(groups, el);
}

function __legacyRenderTeamviewKamListFallback(){
  // Kick off async version; render sync immediately with localStorage data as placeholder
  __legacyRenderTeamviewKamListFallbackAsync().catch(e=>console.warn('[teamview visit]',e));
}

function __legacyRenderTeamviewKamListSync(groups, el){
  if(!el)return;
  if(!groups)groups=_buildKamGroups();

  // ── v225e Value Guard ─────────────────────────────────────────────────────
  // Skip DOM repaint if visible data hasn't changed since last render.
  // Prevents redundant repaints from: ETag 304, bundle:prewarm-complete,
  // hydrate-cold-load-complete when no actual data change occurred.
  try{
    var _tvPvSnap=portviewBulkData&&portviewBulkData.length>0
      ?portviewBulkData.length+':'+(portviewBulkData[0]&&(portviewBulkData[0].accountId||portviewBulkData[0].id)||''):'0';
    var _tvHistN=typeof bulkHistoryData!=='undefined'?Object.keys(bulkHistoryData).length:0;
    var _tvCommN=(typeof window._tgtCache!=='undefined'&&window._tgtCache)?Object.keys(window._tgtCache).length:0;
    var _tvVisitN=window._tvVisitMap
      ?Object.values(window._tvVisitMap).reduce(function(s,v){return s+Object.keys(v||{}).length;},0):-1;
    var _tvUpsellN=typeof bulkUpsellTeamData!=='undefined'&&bulkUpsellTeamData?Object.keys(bulkUpsellTeamData).length:0;
    var _tvDaysEl=(typeof portviewBulkData!=='undefined'&&portviewBulkData&&portviewBulkData[0])?portviewBulkData[0].daysElapsed||0:0;
    var _tvKey=[
      typeof tvViewMode!=='undefined'?tvViewMode:'full',
      typeof teamviewLevel!=='undefined'?(teamviewLevel||''):'',
      typeof portviewRepEmail!=='undefined'?(portviewRepEmail||''):'',
      _tvPvSnap,_tvHistN,_tvCommN,_tvVisitN,_tvUpsellN,_tvDaysEl
    ].join('|');
    if(el._lastTvListKey===_tvKey&&el.children.length>0){
      try{window._senseDataLog('TEAMVIEW','⚡ value guard — skip repaint (unchanged)');}catch(e){}
      return;
    }
    el._lastTvListKey=_tvKey;
  }catch(e){}
  // ─────────────────────────────────────────────────────────────────────────
  if(!groups.length){el.innerHTML=`<div class="portview-no-data"><div class="portview-no-data-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="10" width="24" height="17" rx="2" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" fill="none"/><path d="M4 16h6l2 3h8l2-3h6" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" stroke-linejoin="round" fill="none"/><path d="M11 7l5-3 5 3" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="portview-no-data-text">ไม่มีข้อมูล KAM</div><div class="portview-no-data-sub">Q8E ต้องมีคอลัมน์ kam_email และ tl_email<br>เพื่อแยกพอร์ตตาม KAM ได้</div></div>`;return;}

  // Flat list sorted by urgency: danger → warn → safe/great → star
  const _paceOrder={danger:0,warn:1,safe:2,great:3,star:4};
  const sorted=[...groups].sort((a,b)=>(_paceOrder[a.paceCls]??5)-(_paceOrder[b.paceCls]??5));

  const fmtSF=n=>n>=1000000?'฿'+(n/1000000).toFixed(1)+'M':n>=1000?'฿'+(n/1000).toFixed(0)+'K':'฿'+Math.round(n);

  function fullCard(g){
    const vm=(window._tvVisitMap&&window._tvVisitMap[g.kamEmail])||getVisitMap(g.kamEmail||'');
    const visited=g.accounts.filter(a=>vm[a.id]).length;
    const dot=(color,n)=>n>0?`<span style="display:inline-flex;align-items:center;gap:3px;margin-right:8px"><span style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0"></span><span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;color:${color}">${n}</span></span>`:'';
    const chips=dot('#4ddc97',g.ok)+dot('var(--amb)',g.warn)+dot('#ff8888',g.danger);
    const rrStr=(g.targetDenominator||g.baseline)>0?`<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;color:rgba(255,255,255,.75)">${fmtSF(g.runRate)}<span style="color:rgba(255,255,255,.55);font-weight:400"> / ${fmtSF(g.targetDenominator||g.baseline)}</span><span style="font-size:9px;color:rgba(255,255,255,.35);font-family:'IBM Plex Sans Thai',sans-serif;margin-left:4px">${_tvDenomLabel(g)}</span></span>`:'';
    const _nrr=_tgtComputeKamNRR(g.kamEmail, null);
    const nrrPct=_nrr&&_nrr.nrr!==null?Math.round(_nrr.nrr*100):null;
    const kamPlanCode=_commGetAssignmentPlan(_nrrExclusionCurrentPeriod(),'kam',g.kamEmail,'kam');
    // v226: show final_payout (NRR+Upsell+Handover×Gate) not just NRR payout
    const _kp1=_getCachedKamPayout(g.kamEmail);
    const _kamFinal1=_kp1?_kp1.final_payout:_commPayoutForPctByCode(kamPlanCode,'kam',nrrPct);
    const _teamUpsellReady=typeof bulkUpsellTeamData!=='undefined'&&bulkUpsellTeamData&&Object.keys(bulkUpsellTeamData).length>0;
    const _kp1UL=!_teamUpsellReady; // shimmer only until team summary loaded
    const _kamPillTxt=_kp1UL?'<span class=\'skel\' style=\'display:inline-block;width:52px;height:16px;border-radius:4px;vertical-align:middle\'></span>':_commFmtPayout(_kamFinal1);
    const nrrPill=nrrPct!==null?`<span class="tv-nrr-pill ${nrrPct>=(_tgtSettings.nrr_threshold||98)?'ok':'warn'}">NRR ${nrrPct}%</span><span class="tv-payout-pill">${_kamPillTxt}</span>`:'';
    const worst=(g.accounts||[]).find(a=>a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn')) || (g.accounts||[])[0] || {};
    const exclBtn=`<button class="tgt-excl-request-btn tv-card-exclude" onclick="event.stopPropagation();openNrrExclusionSheetFromKam('${g.kamEmail||''}','${worst.id||''}','${(worst.name||g.kamName||'').replace(/'/g,'')}','${worst.paceSignal?.baselineGmv||g.baseline||0}','${worst.tlEmail||''}')">ขอ exclude</button>`;
    return`<div class="tv-full-card ${g.paceCls}" onclick="teamviewDrillKam('${g.kamEmail||g.kamName}')">
      <div class="tv-full-top">
        <div class="tv-full-name">${g.kamName}<span style="font-size:9px;font-weight:600;color:rgba(255,255,255,.65);margin-left:6px"> ทำการบ้าน ${visited}/${g.total}</span></div>
        <div class="tv-full-pace ${g.paceCls}">${g.pace||'—'}%</div>
      </div>
      <div class="tv-full-bar"><div class="tv-full-fill ${g.paceCls}" style="width:${Math.min(g.pace||0,100)}%"></div></div>
      <div class="tv-full-meta">
        <div class="tv-risk-chips">${chips}${nrrPill}</div>
        ${rrStr}${exclBtn}
      </div>
    </div>`;
  }

  function starCard(g){
    const vm=(window._tvVisitMap&&window._tvVisitMap[g.kamEmail])||getVisitMap(g.kamEmail||'');
    const visited=g.accounts.filter(a=>vm[a.id]).length;
    const surplus=g.pace-100;
    const dot=(color,n)=>n>0?`<span style="display:inline-flex;align-items:center;gap:3px;margin-right:8px"><span style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0"></span><span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;color:${color}">${n}</span></span>`:'';
    const chips=dot('#4ddc97',g.ok)+dot('var(--amb)',g.warn)+dot('#ff8888',g.danger);
    const rrStr=(g.targetDenominator||g.baseline)>0?`<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;color:rgba(255,255,255,.75)">${fmtSF(g.runRate)}<span style="color:rgba(255,255,255,.55);font-weight:400"> / ${fmtSF(g.targetDenominator||g.baseline)}</span><span style="font-size:9px;color:rgba(255,255,255,.35);font-family:'IBM Plex Sans Thai',sans-serif;margin-left:4px">${_tvDenomLabel(g)}</span></span>`:'';
    const _nrr=_tgtComputeKamNRR(g.kamEmail, null);
    const nrrPct=_nrr&&_nrr.nrr!==null?Math.round(_nrr.nrr*100):null;
    const kamPlanCode=_commGetAssignmentPlan(_nrrExclusionCurrentPeriod(),'kam',g.kamEmail,'kam');
    // v226: show final_payout (NRR+Upsell+Handover×Gate) not just NRR payout
    const _kp1=_getCachedKamPayout(g.kamEmail);
    const _kamFinal1=_kp1?_kp1.final_payout:_commPayoutForPctByCode(kamPlanCode,'kam',nrrPct);
    const _teamUpsellReady=typeof bulkUpsellTeamData!=='undefined'&&bulkUpsellTeamData&&Object.keys(bulkUpsellTeamData).length>0;
    const _kp1UL=!_teamUpsellReady; // shimmer only until team summary loaded
    const _kamPillTxt=_kp1UL?'<span class=\'skel\' style=\'display:inline-block;width:52px;height:16px;border-radius:4px;vertical-align:middle\'></span>':_commFmtPayout(_kamFinal1);
    const nrrPill=nrrPct!==null?`<span class="tv-nrr-pill ${nrrPct>=(_tgtSettings.nrr_threshold||98)?'ok':'warn'}">NRR ${nrrPct}%</span><span class="tv-payout-pill">${_kamPillTxt}</span>`:'';
    const worst=(g.accounts||[]).find(a=>a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn')) || (g.accounts||[])[0] || {};
    const exclBtn=`<button class="tgt-excl-request-btn tv-card-exclude" onclick="event.stopPropagation();openNrrExclusionSheetFromKam('${g.kamEmail||''}','${worst.id||''}','${(worst.name||g.kamName||'').replace(/'/g,'')}','${worst.paceSignal?.baselineGmv||g.baseline||0}','${worst.tlEmail||''}')">ขอ exclude</button>`;
    return`<div class="tv-star-card tv-star-glow" onclick="teamviewDrillKam('${g.kamEmail||g.kamName}')">
      <div class="tv-full-top">
        <div style="display:flex;align-items:center;gap:7px;min-width:0">
          <div class="tv-full-name">${g.kamName}<span style="font-size:9px;font-weight:600;color:rgba(255,255,255,.65);margin-left:6px"> ทำการบ้าน ${visited}/${g.total}</span></div>
          <span class="tv-star-badge">+${surplus}%</span>
        </div>
        <div class="tv-star-pace">${g.pace}%</div>
      </div>
      <div class="tv-star-bar"><div class="tv-star-fill" style="width:${Math.min(g.pace,100)}%"></div></div>
      <div class="tv-full-meta">
        <div class="tv-risk-chips">${chips}${nrrPill}</div>
        ${rrStr}${exclBtn}
      </div>
    </div>`;
  }

  function chipRow(g){
    const vm=getVisitMap(g.kamEmail||'');
    const visited=g.accounts.filter(a=>vm[a.id]).length;
    const dot=(color,n)=>n>0?`<span style="display:inline-flex;align-items:center;gap:2px;margin-right:5px"><span style="width:5px;height:5px;border-radius:50%;background:${color}"></span><span style="font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:700;color:${color}">${n}</span></span>`:'';
    const chips=dot('#4ddc97',g.ok)+dot('var(--amb)',g.warn)+dot('#ff8888',g.danger);
    const _nrr=_tgtComputeKamNRR(g.kamEmail, null);
    const nrrPct=_nrr&&_nrr.nrr!==null?Math.round(_nrr.nrr*100):null;
    const kamPlanCode=_commGetAssignmentPlan(_nrrExclusionCurrentPeriod(),'kam',g.kamEmail,'kam');
    const _kpC=_getCachedKamPayout(g.kamEmail);
    const _kamFinalC=_kpC?_kpC.final_payout:_commPayoutForPctByCode(kamPlanCode,'kam',nrrPct);
    const _teamUpsellReadyC=typeof bulkUpsellTeamData!=='undefined'&&bulkUpsellTeamData&&Object.keys(bulkUpsellTeamData).length>0;
    const _kpCUL=!_teamUpsellReadyC; // shimmer only until team summary loaded
    return`<div class="tv-chip" onclick="teamviewDrillKam('${g.kamEmail||g.kamName}')">
      <div class="tv-chip-main">
        <div class="tv-chip-name">${g.kamName}<span style="font-size:9px;color:rgba(255,255,255,.65);margin-left:4px"> ทำการบ้าน ${visited}/${g.total}</span></div>
        <div class="tv-chip-bottom">
          <div class="tv-chip-risk">${chips}${nrrPct!==null?`<span class="tv-chip-nrr">NRR ${nrrPct}%</span>`:''}</div>
        </div>
      </div>
      ${nrrPct!==null?`<span class="tv-chip-comm">${_kpCUL?'<span class=\'skel\' style=\'display:inline-block;width:46px;height:14px;border-radius:3px;vertical-align:middle\'></span>':_commFmtPayout(_kamFinalC)}</span>`:'<span class="tv-chip-comm">—</span>'}
      <span class="tv-chip-pace">${g.pace||'—'}%</span>
      <span class="tv-chip-arrow">›</span>
    </div>`;
  }

  const _renderCard=g=>tvViewMode==='compact'?chipRow(g):(g.paceCls==='star'?starCard(g):fullCard(g));

  // Icon toggle row — sits above the KAM list
  const _iconFull=`<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="14" height="6" rx="1.5" fill="currentColor"/><rect x="0" y="8" width="14" height="6" rx="1.5" fill="currentColor"/></svg>`;
  const _iconCompact=`<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="2.5" x2="14" y2="2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="0" y1="11.5" x2="14" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const _toggleRow=`<div style="display:flex;align-items:center;justify-content:space-between;padding:0 0 10px">
    <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:rgba(255,255,255,.35)">${sorted.length} KAM</span>
    <div style="display:flex;align-items:center;gap:2px">
      <button onclick="setTvView('full')" style="width:30px;height:28px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:6px;color:${tvViewMode==='full'?'rgba(255,255,255,.9)':'rgba(255,255,255,.25)'};transition:color .15s">${_iconFull}</button>
      <button onclick="setTvView('compact')" style="width:30px;height:28px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:6px;color:${tvViewMode==='compact'?'rgba(255,255,255,.9)':'rgba(255,255,255,.25)'};transition:color .15s">${_iconCompact}</button>
    </div>
  </div>`;
  el.innerHTML=_toggleRow+sorted.map(_renderCard).join('');
}

function setTvView(mode){
  tvViewMode=mode;
  renderTeamviewKamList();
}

function teamviewDrillKam(kamKey){
  portviewRepEmail=kamKey;
  // v202: pre-warm KAM bundle when TL drills into a rep (silent, fire-and-forget)
  if(kamKey)_fetchKamBundle(kamKey).catch(()=>{});
  portviewLevel='rep-detail';
  portviewAiDone=false;
  window._portviewFromTeamview=true;
  showScreen('portview');
}


async function generateTeamviewInsight(){
  const btn=document.getElementById('tv-ai-btn');
  const lbl=document.getElementById('tv-ai-label');
  const out=document.getElementById('tv-ai-output');
  if(!btn||teamviewAiDone)return;
  btn.classList.add('loading');
  if(lbl)lbl.innerHTML='<span class="ai-thinking"><svg width="9" height="9" viewBox="0 0 10 10" fill="rgba(100,170,255,.8)" style="animation:iq-spin 1.5s linear infinite;transform-origin:center;flex-shrink:0"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></span>';
  const groups=_buildKamGroups();
  const allAccts=groups.flatMap(g=>g.accounts);
  const withPace=allAccts.filter(a=>a.paceSignal&&a.paceSignal.pct>0);
  const teamPace=withPace.length?Math.round(withPace.reduce((s,a)=>s+a.paceSignal.gmvToDate,0)/Math.max(1,withPace.reduce((s,a)=>s+a.paceSignal.expected,0))*100):0;
  const totalShortfall=allAccts.filter(a=>a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn')).reduce((s,a)=>s+Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||0)),0);
  const kamLines=groups.map(g=>{
    const atRisk=g.accounts.filter(a=>a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn'));
    const topRisk=atRisk.slice(0,3).map(a=>`${a.name}(${a.paceSignal?.pct||0}%${(a.churnedSkuCount||0)>0?' +'+a.churnedSkuCount+'SKUหาย':''})`).join(', ');
    return`- ${g.kamName}: ${g.total}ร้าน · pace ${g.pace}% · เสี่ยง ${g.danger+g.warn} · shortfall ${_tvFmtK(g.shortfall)}${topRisk?' | '+topRisk:''}`;
  }).join('\n');
  const tvUserMsg=`ข้อมูลทีม:\nภาพรวม: ${groups.length} KAM · ${allAccts.length} ร้าน · Pro Rate ทีม ${teamPace}% · ส่วนต่างรวม ${_tvFmtK(totalShortfall)}\n\nKAM แต่ละคน:\n${kamLines}`;
  const sysTv=OLIVE_BASE+`

-- TASK CONTEXT --
A Team Lead is preparing for morning standup. They need to know which KAMs need attention — and whether that's coaching, support, or a push in a different direction. A KAM with a genuinely hard portfolio deserves support and resource, not a coaching conversation. Getting this distinction wrong sends the wrong signal to the team.

Key distinction:
- พอร์ตแย่ + ลูกค้าใหม่/ยาก = ต้องการ support และ resource — ไม่ใช่ coach
- พอร์ตแย่ + ลูกค้าเดิมแต่ไม่ follow up = ต้องการ coaching เรื่อง discipline
- พอร์ตดี + ไม่มี opportunity ใหม่ = ต้องการ push ให้ deepen หรือ upsell

-- OUTPUT CONTRACT --
Thai prose — brief enough for a pre-standup scan.

Structure:
1. One sentence on team state — focus on what needs fixing, not what's healthy.
2. KAMs who need intervention: name → support or coach → specific reason why
3. One standup question per KAM — a hypothesis to verify in the conversation, not an open-ended question.

Don't repeat pace % or shortfall numbers already visible.
When mentioning a SKU, use ฿ — not %.`;
  try{
    const txt=await callAI('sonnet',sysTv,[{role:'user',content:tvUserMsg}],1200);
    if(out){out.style.display='block';out.style.animation='none';out.innerHTML=txt.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');requestAnimationFrame(()=>{out.style.animation='insightReveal 400ms ease forwards';});}
    teamviewAiDone=true;
    // v154c: keep Teamview expanded after insight; no compact strip on Team.
    const _tvColl=document.getElementById('tv-collapsible');
    const _tvStrip=document.getElementById('tv-compact-strip');
    if(_tvColl){_tvColl.className='pv-collapsible expanded';}
    if(_tvStrip){_tvStrip.className='pv-compact-strip hidden';_tvStrip.innerHTML='';}
    if(lbl)lbl.innerHTML='<svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="vertical-align:-.5px"><path d="M1.5 5.5L3.5 7.5L8.5 2.5" stroke="#4ddc97" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Team Insight';
    btn.classList.add('done');
    btn.classList.add('done-bounce');
    btn.addEventListener('animationend',e=>{if(e.animationName==='doneBounce')btn.classList.remove('done-bounce');},{once:true});
  }catch(e){if(lbl)lbl.textContent='Team Insight';btn.classList.remove('done');showToast('AI error: '+e.message.slice(0,60),'⚠');}
  btn.classList.remove('loading');
}

// [override blocks removed — portview wired directly in showScreen and refreshAll]

// ════════════════════════════════════════
// SQL TEMPLATES — ADD Q6 AND Q7
// ════════════════════════════════════════

// ════════════════════════════════════════
// VISIT TRACKING — localStorage + Supabase sync
// localStorage: instant read/write for KAM self-view
// Supabase kam_visits: TL/Admin cross-KAM visibility
//
// Supabase table required:
//   CREATE TABLE kam_visits (
//     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//     kam_email text NOT NULL,
//     account_id text NOT NULL,
//     last_seen timestamptz NOT NULL DEFAULT now(),
//     modes text[] NOT NULL DEFAULT '{}',
//     UNIQUE (kam_email, account_id)
//   );
//   -- RLS: KAM can insert/update own rows; TL/Admin can select all
// ════════════════════════════════════════
const _VISIT_KEY='ciq_visits';
const _VISIT_TTL=90*24*60*60*1000; // 90 days ms

// SECTION:VISIT_TRACKING
function _visitKey(kamEmail,accountId){return kamEmail+'::'+accountId;}

// ── Supabase sync (fire-and-forget, non-blocking) ──
async function _syncVisitToSupabase(kamEmail,accountId,modes){
  if(!currentUser||!kamEmail||kamEmail==='local')return;
  try{
    await supa.from('kam_visits').upsert({
      kam_email: kamEmail,
      account_id: accountId,
      last_seen: new Date().toISOString(),
      modes: modes
    },{onConflict:'kam_email,account_id'});
  }catch(e){
    // Silently fail — localStorage is the source of truth for self-view
    console.warn('[Visit sync]',e.message);
  }
}

function trackVisit(accountId,mode){
  if(!accountId)return;
  const email=(currentUserProfile&&currentUserProfile.email)||'local';
  try{
    const store=JSON.parse(localStorage.getItem(_VISIT_KEY)||'{}');
    const k=_visitKey(email,accountId);
    const entry=store[k]||{lastSeen:0,modes:[]};
    entry.lastSeen=Date.now();
    if(!entry.modes.includes(mode))entry.modes.push(mode);
    store[k]=entry;
    // Prune entries older than TTL to keep localStorage lean
    const now=Date.now();
    Object.keys(store).forEach(key=>{if(now-store[key].lastSeen>_VISIT_TTL)delete store[key];});
    localStorage.setItem(_VISIT_KEY,JSON.stringify(store));
    // Sync to Supabase non-blocking (TL/Admin visibility)
    _syncVisitToSupabase(email,accountId,entry.modes);
  }catch(e){}
}

function getVisitMap(kamEmail){
  // Returns {accountId: {lastSeen, modes}} filtered to 90-day window
  try{
    const store=JSON.parse(localStorage.getItem(_VISIT_KEY)||'{}');
    const prefix=(kamEmail||'local')+'::';
    const now=Date.now();
    const result={};
    Object.entries(store).forEach(([k,v])=>{
      if(k.startsWith(prefix)&&now-v.lastSeen<=_VISIT_TTL){
        result[k.slice(prefix.length)]=v;
      }
    });
    return result;
  }catch(e){return{};}
}

// ── TL/Admin: load visit map from Supabase for a specific KAM ──
// Called by teamview when rendering KAM rows to show visit dots
async function getVisitMapFromSupabase(kamEmail){
  if(!currentUser||!kamEmail)return{};
  try{
    const {data,error}=await supa.from('kam_visits')
      .select('account_id,last_seen,modes')
      .eq('kam_email',kamEmail)
      .gte('last_seen',new Date(Date.now()-_VISIT_TTL).toISOString());
    if(error||!data)return{};
    const result={};
    data.forEach(r=>{
      result[r.account_id]={
        lastSeen: new Date(r.last_seen).getTime(),
        modes: r.modes||[]
      };
    });
    return result;
  }catch(e){return{};}
}

// ── Load all visits for full team (TL sees all KAMs at once) ──
async function getTeamVisitMapFromSupabase(kamEmails){
  if(!currentUser||!kamEmails||!kamEmails.length)return{};
  try{
    const {data,error}=await supa.from('kam_visits')
      .select('kam_email,account_id,last_seen,modes')
      .in('kam_email',kamEmails)
      .gte('last_seen',new Date(Date.now()-_VISIT_TTL).toISOString());
    if(error||!data)return{};
    // Returns {kamEmail: {accountId: {lastSeen, modes}}}
    const result={};
    data.forEach(r=>{
      if(!result[r.kam_email])result[r.kam_email]={};
      result[r.kam_email][r.account_id]={
        lastSeen: new Date(r.last_seen).getTime(),
        modes: r.modes||[]
      };
    });
    return result;
  }catch(e){return{};}
}

function getVisitDot(visitMap,accountId){
  // Returns 'full'|'account'|'unseen'
  const v=visitMap[accountId];
  if(!v)return'unseen';
  if(v.modes.includes('restaurant'))return'full';
  return'account';
}

// ════════════════════════════════════════
// FOLDER LOAD — input[webkitdirectory] (works in iframe/Claude preview)
// ════════════════════════════════════════
const _FOLDER_MAP={'portview.csv':'portview-bulk','bulk_sku_current.csv':'bulk-sku-current','bulk_outlets.csv':'bulk-outlets','bulk_history.csv':'bulk-data','bulk_categories.csv':'bulk-categories','bulk_skus.csv':'bulk-skus','bulk_alternatives.csv':'bulk-alternatives','bulk_price.csv':'bulk-price'};

function pickFolder(){document.getElementById('fi-folder-dir').click();}
// [UNUSED] — no callers found; safe to delete in future refactor
function reloadFolder(){document.getElementById('fi-folder-dir').click();}

function _onFolderSelected(input){
  const files=Array.from(input.files||[]);
  if(!files.length)return;
  let n=0;
  files.forEach(f=>{
    const name=f.name.toLowerCase();
    const type=Object.entries(_FOLDER_MAP).find(([k])=>name===k)?.[1];
    if(type){handleFileUpload(type,{files:[f]});n++;}
  });
  const folderName=files[0].webkitRelativePath.split('/')[0]||'folder';
  const lbl=document.getElementById('dp-folder-label');if(lbl)lbl.textContent='📂 '+folderName+' ('+n+' ไฟล์)';
  if(n)showToast('โหลดจาก folder — '+n+' ไฟล์','📂');
  setTimeout(()=>{updateDataStatus();if(typeof renderPortviewList==='function')renderPortviewList();if(typeof renderPortviewSummary==='function')renderPortviewSummary();},800);
}

function _initFolderAutoLoad(){}

function initOliveAvatar(){
  if(!OLIVE_AVATAR_URL)return;
  const _setImg=(imgId,svgId)=>{
    const img=document.getElementById(imgId);
    const svg=document.getElementById(svgId);
    if(!img||!svg)return;
    img.onerror=()=>{img.style.display='none';svg.style.display='block';};
    img.onload=()=>{img.style.display='block';svg.style.display='none';};
    img.src=OLIVE_AVATAR_URL;
  };
  _setImg('fab-avatar-img','fab-avatar-svg');
  _setImg('aiav-img','aiav-svg');
}

(function init(){
  // Show local-dev-btn only on localhost
  if(window.location.hostname==='localhost'||window.location.hostname==='127.0.0.1'){
    const ldb=document.getElementById('local-dev-btn');
    if(ldb)ldb.style.display='block';
  }
  // v218 FIX: purge stale sample_ entries from ciq_index localStorage left over from
  // pre-v216 sessions when useSampleData() was allowed to run and called saveToStorage().
  // These caused "[ตัวอย่าง] บ.ลีฟ ทู อีท จำกัด" to appear in the account list.
  try{
    var _raw=localStorage.getItem('ciq_index');
    if(_raw){
      var _parsed=JSON.parse(_raw);
      if(Array.isArray(_parsed)){
        var _clean=_parsed.filter(function(a){return a&&a.id&&!/^sample_/.test(a.id);});
        if(_clean.length!==_parsed.length){
          localStorage.setItem('ciq_index',JSON.stringify(_clean));
          console.info('[Sense v218] purged',_parsed.length-_clean.length,'sample_ entries from ciq_index');
        }
      }
    }
  }catch(e){}
  // Do not prefetch bulk data before auth; mobile Safari can crash on large CSV parsing.
  // Check Supabase session first (shows/hides login overlay)
  checkSession().catch(()=>{});
  // ── Guard B: visibilitychange — silent token re-check only, NO routing ────
  // Fires when user returns to the PWA after backgrounding it.
  // Fix v22.2: added 2s grace period before forcing re-login.
  // Problem: getSession() can return null momentarily while Supabase silently
  // refreshes the token in background. Immediately nulling currentUser caused
  // login flash → onAuthStateChange(SIGNED_IN) → auto-login loop.
  // Solution: wait 2s, re-check. Only force login if session truly gone.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !currentUser) return;
    if (window._visibilityGraceTimer) { clearTimeout(window._visibilityGraceTimer); window._visibilityGraceTimer = null; }
    window._visibilityGraceTimer = setTimeout(() => {
      window._visibilityGraceTimer = null;
      _pwaSilentSessionCheck('visibilitychange',3500);
    }, 150);
  });
  _initFolderAutoLoad();
  // ── Guard C: pageshow — iOS bfcache restore ───────────────────────────────
  // Fix v22.2: iOS Safari PWA restores pages from bfcache (back-forward cache)
  // on app resume. In this case visibilitychange may NOT fire, but pageshow
  // fires with event.persisted = true. JS state is frozen from before suspend
  // (currentUser may be set) but the Supabase token may have expired.
  // Without this handler, user gets into a state where currentUser exists but
  // API calls fail — OR the session looks valid but onAuthStateChange never fires.
  // Fix v194: _pgsGraceTimer — cancellable grace timer for pageshow bfcache restore.
  // Mirrors _visibilityGraceTimer pattern; guards against double-fire from browser quirks.
  window._pgsGraceTimer = null;

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return; // Normal page load — checkSession() handles it
    if (!currentUser) return;     // Not logged in — nothing to verify
    if (window._pgsGraceTimer) { clearTimeout(window._pgsGraceTimer); window._pgsGraceTimer = null; }
    window._pgsGraceTimer = setTimeout(() => {
      window._pgsGraceTimer = null;
      _pwaSilentSessionCheck('pageshow-bfcache',2500);
    }, 150);
  });
  // Restore AI provider setting
  setAiProvider(aiProvider);
  initOliveAvatar();
  initChatFabDrag();
  // Restore accounts list from localStorage
  // Migrate old ciq_accounts to ciq_index (one-time migration)
  try{
    const oldList=localStorage.getItem('ciq_accounts');
    if(oldList&&!localStorage.getItem('ciq_index')){
      const parsed=JSON.parse(oldList);
      if(Array.isArray(parsed)&&parsed.length){
        localStorage.setItem('ciq_index',JSON.stringify(parsed));
        // Also migrate data keys: ciq_{id} → ciq_acct_{id}
        parsed.forEach(function(a){
          const oldKey='ciq_'+a.id;
          const newKey='ciq_acct_'+a.id;
          const oldData=localStorage.getItem(oldKey);
          if(oldData&&!localStorage.getItem(newKey)){
            localStorage.setItem(newKey,oldData);
          }
        });
      }
    }
  }catch(e){}
  // Restore last used account
  const recent=getAccountIndex();
  if(recent.length>0)currentAccountId=recent[0].id;
  // v217 FIX A: if localStorage has a stale sample_ ID from before v216 (when useSampleData
  // ran and called saveToStorage), clear it so R2 load doesn't warn about sample_741a4cb1abcd.
  try{ if(currentAccountId && /^sample_/.test(currentAccountId)) currentAccountId=null; }catch(e){}
  const fromStorage=loadFromStorage();
  updateDataStatus();
  if(fromStorage&&(D.history.length||D.skus.length)){
    applyMeta();refreshAll();
    // User has real data — skip onboarding
    try{localStorage.setItem('ciq_visited','1');}catch(e){}
  }else if((function(){
    // v216 FIX 2A: detect Supabase auth token in localStorage synchronously.
    // If session exists, real data will arrive from R2 — phantom sample data ("[ตัวอย่าง] บ.ลีฟ ทู อีท จำกัด" / sample_741a4cb1abcd)
    // must NOT render in between. This was the source of "[v202 debug] _getKamEmailForAccount: portviewBulkData not loaded yet for sample_..." console noise.
    try{
      for(var i=0;i<localStorage.length;i++){
        var k=localStorage.key(i);
        if(k && /^sb-.+-auth-token$/.test(k)){
          var v=localStorage.getItem(k);
          if(v && v.length>20) return true;
        }
      }
    }catch(e){}
    return false;
  })()){
    // Authenticated session detected — skip useSampleData(). Real R2 data arrives shortly.
    try{ console.info('[Sense v216] useSampleData() skipped — Supabase session detected, real data loading from R2'); }catch(e){}
  }else{
    useSampleData();
    // Check if first visit — show onboarding (with sample data loaded as preview)
    checkOnboarding();
  }
})();

// ── Restaurant swipe cue helpers (v154) ──
var _pillHideTimer;
var _pillCleanupTimer;
var _restSwipeCueState={grp:'a',idx:0};
// SECTION:SWIPE_HELPERS
function _hasRestSwipeLearned(){
  try{return localStorage.getItem('ciq_rest_swipe_learned')==='1';}catch(e){return false;}
}
function _markRestSwipeLearned(){
  try{localStorage.setItem('ciq_rest_swipe_learned','1');}catch(e){}
}
function _setRestSwipeCue(grp,idx,opts){
  opts=opts||{};
  _restSwipeCueState={grp:grp||'a',idx:idx||0};
  const p=document.getElementById('swipe-pill');
  if(!p)return;
  if(typeof isKAM!=='undefined'&&isKAM&&!document.body.classList.contains('restaurant-sheet')){clearTimeout(_pillHideTimer);clearTimeout(_pillCleanupTimer);p.classList.remove('show','teach','compact');return;}
  const labels={a:['ภาพรวม','พอร์ต'],b:['Sense','รายงาน']};
  const l=(labels[grp]||labels.a);
  const left=document.getElementById('sp-left-label');
  const right=document.getElementById('sp-right-label');
  const d0=document.getElementById('spda0');
  const d1=document.getElementById('spda1');
  const arrow=document.getElementById('sp-mini-arrow');
  const teachCopy=document.getElementById('sp-teach-copy');
  if(left){left.textContent=l[0];left.classList.toggle('on',idx===0);}
  if(right){right.textContent=l[1];right.classList.toggle('on',idx===1);}
  if(d0)d0.className='sp-dot'+(idx===0?' on':'');
  if(d1)d1.className='sp-dot'+(idx===1?' on':'');
  if(arrow)arrow.textContent=idx===0?'→':'←';
  if(teachCopy){
    if(grp==='a')teachCopy.textContent=idx===0?'ปัดซ้ายดูพอร์ตสินค้า →':'← ปัดขวากลับหน้าภาพรวม';
    else teachCopy.textContent=idx===0?'ปัดซ้ายดูรายงาน →':'← ปัดขวากลับ Sense';
  }
  const teach=!!(opts.teach&&grp==='a'&&!_hasRestSwipeLearned());
  const shouldShow=opts.show!==false&&(teach||opts.teach||opts.flash||opts.show);
  clearTimeout(_pillHideTimer);
  clearTimeout(_pillCleanupTimer);
  p.classList.toggle('teach',teach);
  p.classList.toggle('compact',!teach);
  if(!shouldShow){return;}
  p.classList.add('show');
  const hideAfter=teach?(opts.duration||2800):(opts.duration||1100);
  _pillHideTimer=setTimeout(function(){
    // v154d: fade out first, then clean up mode classes after opacity transition.
    // Removing teach/compact immediately changes content width mid-fade and causes a visible jump.
    p.classList.remove('show');
    _pillCleanupTimer=setTimeout(function(){
      if(!p.classList.contains('show'))p.classList.remove('teach','compact');
    },360);
  },hideAfter);
}
function _showPill(opts){
  opts=opts||{};
  _setRestSwipeCue(_restSwipeCueState.grp,_restSwipeCueState.idx,Object.assign({show:true},opts));
}
function _hidePill(delay){
  clearTimeout(_pillHideTimer);
  clearTimeout(_pillCleanupTimer);
  const p=document.getElementById('swipe-pill');
  if(!p)return;
  _pillHideTimer=setTimeout(function(){
    p.classList.remove('show');
    _pillCleanupTimer=setTimeout(function(){
      if(!p.classList.contains('show'))p.classList.remove('teach','compact');
    },360);
  },delay||0);
}
function _handleSwipeCueTap(){
  const st=_restSwipeCueState||{grp:'a',idx:0};
  const targets={a:['overview','portfolio'],b:['opportunities','report']};
  const arr=targets[st.grp]||targets.a;
  const nextIdx=st.idx===0?1:0;
  if(st.grp==='a')_markRestSwipeLearned();
  showScreen(arr[nextIdx]);
}
// ── Restaurant swipe helpers ──
function _updateRestSwipe(grp,idx,opts){
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('on'));
  // Map grp+idx → correct nav button (portfolio + report now have their own nav)
  const navMap={'a':['nav-overview','nav-portfolio'],'b':['nav-opportunities','nav-report']};
  const navId=navMap[grp]&&navMap[grp][idx];
  const navEl=navId?document.getElementById(navId):null;
  if(navEl)navEl.classList.add('on');
  _setRestSwipeCue(grp,idx,opts||{});
}
(function initSwipe(){
  function addListener(grpId,screens){
    const grp=document.getElementById('swipe-grp-'+grpId);
    if(!grp)return;
    let lastIdx=-1;
    grp.addEventListener('scroll',()=>{
      const idx=Math.round(grp.scrollLeft/grp.offsetWidth);
      if(idx===lastIdx)return;
      if(grpId==='a'&&lastIdx>=0&&idx!==lastIdx)_markRestSwipeLearned();
      lastIdx=idx;
      _updateRestSwipe(grpId,idx,{teach:false,flash:true,duration:900});
      const name=screens[idx];
      const footer=document.getElementById('pb-footer');
      if(footer)footer.classList.toggle('hidden',grpId!=='b'||name==='report');
      if(name==='report'&&typeof renderReport==='function')renderReport();
    },{passive:true});
  }
  addListener('a',['overview','portfolio']);
  addListener('b',['opportunities','report']);

  // Simple port-top re-measure (no collapse behavior)
  window._expandPortTop=function(){
    const portTop=document.getElementById('port-top');
    if(portTop){portTop.style.height='auto';portTop.style.overflow='visible';portTop.style.opacity='1';}
  };
})();


// ══════════════════════════════════════════════════════════════
// SECTION:TEAMVIEW_PATCHES — folded from 08_patches.js (Step 2a)
// 
// 4 IIFE patches moved here verbatim (logic unchanged):
//   v213c — PWA teamview responsive repair (fab hide on mobile)
//   v213d — teamview rail cleanup (compact commission meta + pace label)
//   v213e — full rail align (CSS class toggle)
//   v213f — card rail balance (CSS class toggle)
// 
// NOTE: CSS for these lives in styles_main.css (PATCH CSS section).
// Step 2b will dissolve dead code after per-patch mobile verification.
// ══════════════════════════════════════════════════════════════
//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v213d-teamview-rail-cleanup-js
//////////////////////////////////////////////////////////////////////////////

// v213d — Teamview PWA rail/alignment cleanup. UI only; no data/NRR/commission formula change.
(function(global){
  'use strict';
  var VERSION='v213d-teamview-rail-cleanup';
  var DATA_EPOCH='2026-05-22-v213d-teamview-rail-cleanup';
  function log(){try{console.log.apply(console,['[Sense v213d]'].concat([].slice.call(arguments)));}catch(e){}}
  function small(){try{return !!(global.matchMedia&&global.matchMedia('(max-width: 430px)').matches);}catch(e){return false;}}
  function isTeam(){try{return !!document.getElementById('scr-teamview')?.classList.contains('on');}catch(e){return false;}}
  function shortBaht(txt){
    try{
      return String(txt||'')
        .replace(/฿(\d{1,3}),(\d{3})(?!\d)/g,function(_,a,b){ var n=parseInt(a+b,10); return n>=1000?'฿'+(n/1000).toFixed(n%1000?1:0)+'k':'฿'+n; })
        .replace(/฿(\d+),(\d{3}),(\d{3})/g,function(_,a,b,c){ var n=parseInt(a+b+c,10); return '฿'+(n/1000000).toFixed(1)+'M'; });
    }catch(e){return txt;}
  }
  function compactCommissionMeta(){
    if(!small()||!isTeam()) return;
    try{
      document.querySelectorAll('#tv-summary-row .tv-signal-card.commission .tv-signal-meta').forEach(function(el){
        if(!el.dataset.v213dFull) el.dataset.v213dFull=el.textContent||'';
        var t=el.dataset.v213dFull;
        t=t.replace(/^KAM team\s+/i,'KAM ');
        el.textContent=shortBaht(t);
        el.title=el.dataset.v213dFull;
      });
    }catch(e){}
  }
  function cleanupPaceLabel(){
    if(!small()||!isTeam()) return;
    try{
      var bar=document.getElementById('tv-pace-bar');
      if(!bar) return;
      var right=bar.querySelector(':scope > div:first-child > div:last-child');
      if(right){
        var divs=right.querySelectorAll('div');
        divs.forEach(function(d){ if(/target|baseline/i.test(d.textContent||'')) d.style.display='none'; });
      }
    }catch(e){}
  }
  function apply(){
    try{document.body.classList.toggle('v213d-teamview-active',isTeam());}catch(e){}
    compactCommissionMeta(); cleanupPaceLabel();
  }
  function setVersion(){
    try{global.FRESHKET_BUILD='v213d';}catch(e){}
    try{if(global.FRESHKET_CONFIG&&global.FRESHKET_CONFIG.app) global.FRESHKET_CONFIG.app.version=VERSION;}catch(e){}
    try{global.currentBuild=function(){return 'v213d';};}catch(e){}
    try{if(global.FreshketSenseDebug){var old=global.FreshketSenseDebug.version;global.FreshketSenseDebug.version=function(){var base={};try{base=typeof old==='function'?old():{};}catch(e){} base.build=VERSION;base.dataEpoch=DATA_EPOCH;base.configVersion=VERSION;base.currentBuild='v213d';base.objects=Object.assign({},base.objects||{},{v213d:true});return base;};}}catch(e){}
  }
  function wrap(){['renderTeamview','renderTeamviewSummary','renderTeamviewKamList','showScreen','setTvView'].forEach(function(name){try{var old=global[name];if(typeof old==='function'&&!old.__v213dRail){var w=function(){var r=old.apply(this,arguments);setTimeout(apply,0);setTimeout(apply,80);setTimeout(apply,260);return r;};w.__v213dRail=true;global[name]=w;try{eval(name+'=w');}catch(e){} }}catch(e){}});}
  setVersion(); wrap();
  try{document.addEventListener('DOMContentLoaded',function(){setTimeout(apply,120);});}catch(e){}
  try{global.addEventListener('resize',function(){setTimeout(apply,80);},{passive:true});}catch(e){}
  try{global.addEventListener('pageshow',function(){setTimeout(apply,180);},{passive:true});}catch(e){}
  global.FreshketSenseV213d={version:VERSION,dataEpoch:DATA_EPOCH,apply:apply};
  setTimeout(function(){apply();log('installed');},300);
})(window);


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v213e-teamview-full-rail-align-js
//////////////////////////////////////////////////////////////////////////////

// v213e — Teamview PWA full-rail align. UI only; no data/NRR/commission formula change.
(function(global){
  'use strict';
  var VERSION='v213e-teamview-full-rail-align';
  var DATA_EPOCH='2026-05-22-v213e-teamview-full-rail-align';
  function isTeam(){try{return !!document.getElementById('scr-teamview')?.classList.contains('on');}catch(e){return false;}}
  function apply(){try{document.body.classList.toggle('v213e-teamview-active',isTeam());}catch(e){}}
  function setVersion(){
    try{global.FRESHKET_BUILD='v213e';}catch(e){}
    try{if(global.FRESHKET_CONFIG&&global.FRESHKET_CONFIG.app) global.FRESHKET_CONFIG.app.version=VERSION;}catch(e){}
    try{global.currentBuild=function(){return 'v213e';};}catch(e){}
    try{if(global.FreshketSenseDebug){var old=global.FreshketSenseDebug.version;global.FreshketSenseDebug.version=function(){var base={};try{base=typeof old==='function'?old():{};}catch(e){} base.build=VERSION;base.dataEpoch=DATA_EPOCH;base.configVersion=VERSION;base.currentBuild='v213e';base.objects=Object.assign({},base.objects||{},{v213e:true});return base;};}}catch(e){}
  }
  function wrap(){['renderTeamview','renderTeamviewSummary','renderTeamviewKamList','showScreen','setTvView'].forEach(function(name){try{var old=global[name];if(typeof old==='function'&&!old.__v213eRail){var w=function(){var r=old.apply(this,arguments);setTimeout(apply,0);setTimeout(apply,80);setTimeout(apply,260);return r;};w.__v213eRail=true;global[name]=w;try{eval(name+'=w');}catch(e){} }}catch(e){}});}
  setVersion(); wrap();
  try{document.addEventListener('DOMContentLoaded',function(){setTimeout(apply,120);});}catch(e){}
  try{global.addEventListener('resize',function(){setTimeout(apply,80);},{passive:true});}catch(e){}
  try{global.addEventListener('pageshow',function(){setTimeout(apply,180);},{passive:true});}catch(e){}
  global.FreshketSenseV213e={version:VERSION,dataEpoch:DATA_EPOCH,apply:apply};
  setTimeout(function(){apply();try{console.log('[Sense v213e] installed');}catch(e){}},300);
})(window);


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v213f-teamview-card-rail-balance-js
//////////////////////////////////////////////////////////////////////////////

// v213f — Teamview PWA card rail balance. UI only; no data/NRR/commission formula change.
(function(global){
  'use strict';
  var VERSION='v213f-teamview-card-rail-balance';
  var DATA_EPOCH='2026-05-22-v213f-teamview-card-rail-balance';
  function isTeam(){try{return !!document.getElementById('scr-teamview')?.classList.contains('on');}catch(e){return false;}}
  function apply(){try{document.body.classList.toggle('v213f-teamview-active',isTeam());}catch(e){}}
  function setVersion(){
    try{global.FRESHKET_BUILD='v213f';}catch(e){}
    try{if(global.FRESHKET_CONFIG&&global.FRESHKET_CONFIG.app) global.FRESHKET_CONFIG.app.version=VERSION;}catch(e){}
    try{global.currentBuild=function(){return 'v213f';};}catch(e){}
    try{if(global.FreshketSenseDebug){var old=global.FreshketSenseDebug.version;global.FreshketSenseDebug.version=function(){var base={};try{base=typeof old==='function'?old():{};}catch(e){} base.build=VERSION;base.dataEpoch=DATA_EPOCH;base.configVersion=VERSION;base.currentBuild='v213f';base.objects=Object.assign({},base.objects||{},{v213f:true});return base;};}}catch(e){}
  }
  function wrap(){['renderTeamview','renderTeamviewSummary','renderTeamviewKamList','showScreen','setTvView'].forEach(function(name){try{var old=global[name];if(typeof old==='function'&&!old.__v213fCardRail){var w=function(){var r=old.apply(this,arguments);setTimeout(apply,0);setTimeout(apply,80);setTimeout(apply,260);return r;};w.__v213fCardRail=true;global[name]=w;try{eval(name+'=w');}catch(e){} }}catch(e){}});}
  setVersion(); wrap();
  try{document.addEventListener('DOMContentLoaded',function(){setTimeout(apply,120);});}catch(e){}
  try{global.addEventListener('resize',function(){setTimeout(apply,80);},{passive:true});}catch(e){}
  try{global.addEventListener('pageshow',function(){setTimeout(apply,180);},{passive:true});}catch(e){}
  global.FreshketSenseV213f={version:VERSION,dataEpoch:DATA_EPOCH,apply:apply};
  setTimeout(function(){apply();try{console.log('[Sense v213f] installed');}catch(e){}},300);
})(window);


//////////////////////////////////////////////////////////////////////////////
