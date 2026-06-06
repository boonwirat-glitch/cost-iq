// SECTION:SCREEN_NAV
function showScreen(name){
  const controller = window.FreshketSenseNavigationRuntime;
  if(controller && typeof controller.showScreenFromLegacy === 'function'){
    try{
      return controller.showScreenFromLegacy({
        isKAM: (typeof isKAM !== 'undefined' ? isKAM : false),
        currentAccountId: (typeof currentAccountId !== 'undefined' ? currentAccountId : null),
        currentUserProfile: (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null),
        senseActivated: (typeof senseActivated !== 'undefined' ? senseActivated : false),
        legacy: { showScreen: __legacyShowScreenFallback }
      }, name);
    }catch(e){
      console.warn('showScreen navigation controller failed, falling back to legacy navigation', e);
    }
  }
  return __legacyShowScreenFallback(name);
}

function __legacyShowScreenFallback(name){
  // ── Role guard: only TL/admin can access teamview ──
  if(name==='teamview'){
    const _role=(currentUserProfile&&currentUserProfile.role)||'rep';
    if(_role!=='tl'&&_role!=='admin'){
      // Silently redirect rep users to their portview instead
      name='portview';
    }
  }
  // ── Gate: intercept opportunities entry when Sense not yet run ──
  // Restaurant mode: always gated. KAM mode: gated only when account selected.
  const _kamWithAcct=isKAM&&currentAccountId&&currentAccountId!=='default';
  // Set KAM sense return flag (before gate — so sgCommit re-entry also hits routing)
  if(_kamWithAcct&&(name==='opportunities'||name==='report'))window._kamSenseReturn=true;
  // Cleanup flag when KAM navigates away from Sense screens
  if(isKAM&&name!=='opportunities'&&name!=='report'&&window._kamSenseReturn){
    document.body.classList.remove('kam-sense-active');
    window._kamSenseReturn=false;
    const _ksb=document.getElementById('kam-sense-back-btn');if(_ksb)_ksb.remove();
  }
  if((name==='opportunities'||name==='report')&&!senseActivated&&(!isKAM||_kamWithAcct)){
    openSenseGate();return;
  }
  // ── KAM Sense Mode: full-screen opportunities routing ──
  if(isKAM&&window._kamSenseReturn&&(name==='opportunities'||name==='report')){
    document.body.classList.add('kam-sense-active');
    const _grpB=document.getElementById('swipe-grp-b');
    if(_grpB)_grpB.classList.add('on');
    document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
    document.querySelectorAll('.ni').forEach(n=>n.classList.remove('on'));
    const _scrEl=document.getElementById('scr-'+name);
    if(_scrEl){_scrEl.classList.add('on');_scrEl.style.display='';}
    const _navEl=document.getElementById('nav-'+name);
    if(_navEl)_navEl.classList.add('on');
    // v207a: route into Sense should never inherit sheet scroll-lock; scroll the actual fixed container, not only window.
    document.body.style.overflow='';
    if(name==='opportunities'&&typeof renderOpps==='function')renderOpps();
    setTimeout(_injectKamSenseBackBtn,80);
    setTimeout(_initPlanTray,100);
    if(_grpB)try{_grpB.scrollTo({top:0,left:0,behavior:'instant'});}catch(e){_grpB.scrollTop=0;}
    window.scrollTo({top:0,left:0,behavior:'instant'});
    setTimeout(()=>{try{if(typeof updatePbFooter==='function')updatePbFooter();}catch(e){}},120);
    return;
  }
  // ── Restaurant swipe mode ──
  const GRP_A=['overview','portfolio'];
  const GRP_B=['opportunities','report'];
  if(!isKAM && (GRP_A.includes(name)||GRP_B.includes(name))){
    const inA=GRP_A.includes(name);
    const grpA=document.getElementById('swipe-grp-a');
    const grpB=document.getElementById('swipe-grp-b');
    if(grpA){grpA.classList.toggle('on',inA);}
    if(grpB){grpB.classList.toggle('on',!inA);}
    const activeGrp=inA?grpA:grpB;
    const screens=inA?GRP_A:GRP_B;
    const idx=screens.indexOf(name);
    if(activeGrp) activeGrp.scrollTo({left:idx*activeGrp.offsetWidth,behavior:'instant'});
    _updateRestSwipe(inA?'a':'b',idx,{teach:inA,duration:2800});
    const footer=document.getElementById('pb-footer');
    if(footer)footer.classList.toggle('hidden',inA||name==='report');
    const modeToggleWrap=document.getElementById('mode-toggle-wrap');
    if(modeToggleWrap)modeToggleWrap.style.display='';
    if(name==='report'&&typeof renderReport==='function')renderReport();
    return;
  }
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('on'));
  const scrEl=document.getElementById('scr-'+name);
  const navEl=document.getElementById('nav-'+name);
  if(scrEl){scrEl.classList.add('on');scrEl.style.display='';}
  if(navEl)navEl.classList.add('on');
  if(name==='report')renderReport();
  if(name==='portview'){renderPortview();
    // In KAM mode nav-overview IS the portview button — highlight it
    if(isKAM){const _ov=document.getElementById('nav-overview');if(_ov)_ov.classList.add('on');}
    // Force-disable ร้าน + Sense on portview — no account in context yet
    const _rb=document.getElementById('nav-restaurant');
    const _sb=document.getElementById('nav-opportunities');
    if(_rb)_rb.classList.add('nav-disabled');
    if(_sb&&isKAM)_sb.classList.add('nav-disabled');
  }
  // KAM account view: ร้าน active (user is "in" a store context), show drag handle
  if(isKAM&&name==='overview'){
    const _ov=document.getElementById('nav-overview');
    const _rs=document.getElementById('nav-restaurant');
    if(_ov)_ov.classList.remove('on');
    if(_rs){_rs.classList.remove('nav-disabled');_rs.classList.add('on');}
  }
  const _handle=document.getElementById('kam-nav-handle');
  if(_handle)_handle.style.display=(isKAM&&name==='overview')?'block':'none';
  if(name==='teamview'){teamviewKamFilter=null;renderTeamview();}
  // portview + teamview live OUTSIDE .main in DOM — hide .main so its min-height
  // doesn't push those screens below the fold
  const mainEl=document.querySelector('.main');
  if(mainEl)mainEl.style.display=(name==='portview'||name==='teamview'||name==='sales-portview'||name==='sales-pipeline'||name==='sales-commission'||name==='sales-teamview')?'none':'';
  // Clean up portview return fab if navigating away from per-account view
  const existingFab=document.getElementById('portview-return-fab');
  if(existingFab&&name==='portview')existingFab.remove();

  window.scrollTo({top:0,left:0,behavior:'instant'});
  document.body.scrollTop=0;
  document.documentElement.scrollTop=0;
  // Hide plan builder footer and swap-sticky in KAM mode
  const footer=document.getElementById('pb-footer');
  if(footer)footer.classList.add('hidden');
  // Show ร้าน|KAM toggle on all screens except KAM portfolio/team views
  const modeToggleWrap=document.getElementById('mode-toggle-wrap');
  if(modeToggleWrap){
    const _showToggle=!(name==='portview'||name==='teamview');
    modeToggleWrap.style.display=_showToggle?'':'none';
    // Dim ร้าน button if no account selected
    const _restBtn=document.getElementById('mbtn-restaurant');
    if(_restBtn){
      const _hasAcct=currentAccountId&&currentAccountId!=='default';
      _restBtn.style.opacity=_hasAcct?'':'0.35';
      _restBtn.style.cursor=_hasAcct?'':'not-allowed';
    }
  }
  // Clean up legacy floating back FAB on any navigation
  const legacyFab=document.getElementById('portview-return-fab');
  if(legacyFab)legacyFab.remove();
  // Show ‹ back button only in account detail (overview) and only when portfolio data exists
  const kamBackBtn=document.getElementById('kam-back-btn');
  if(kamBackBtn){
    const _showBack=(name==='overview'&&portviewBulkData&&portviewBulkData.length>0);
    kamBackBtn.style.display=_showBack?'':'none';
    if(_showBack){kamBackBtn.classList.remove('kam-back-entering');void kamBackBtn.offsetWidth;kamBackBtn.classList.add('kam-back-entering');}
  }
  // ── No-account empty state for KAM Insight ──
  if(isKAM&&name==='overview'&&typeof _renderKamNoAcctState==='function')_renderKamNoAcctState();
  // ── Auto-hint pill when landing on overview (restaurant mode only) ──
  if(!isKAM&&name==='overview'){
    setTimeout(()=>{_showPill();_hidePill(2000);},350);
  }
}

// ════════════════════════════════════════
// KAM MODE — MODEL + ACCOUNT SUMMARY
// ════════════════════════════════════════

function setKamModel(model){
  kamModel=model;
  ['km-haiku','km-sonnet'].forEach(id=>{
    const el=document.getElementById(id);if(!el)return;
    const on=id==='km-'+model;
    el.style.borderColor=on?'#2660c8':'var(--n200)';
    el.style.background=on?'#1a3a6b':'var(--n50)';
    el.querySelector('div').style.color=on?'#fff':'var(--n700)';
  });
  const b1=document.getElementById('kam-model-badge');if(b1)b1.textContent=model==='haiku'?'Haiku':'Sonnet';
}

// SECTION:KAM_ACCOUNT
function computeSkuMovement(){
  // Sort months desc (newest first) — key insertion order is not guaranteed
  const months=Object.keys(D.skus_monthly||{}).sort((a,b)=>{
    const toDate=m=>{const parts=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(parts[1]||0)*12)+mo.indexOf(parts[0]);};return toDate(b)-toDate(a);});
  if(months.length<2)return null;
  // v156: exclude current MTD month — GMV not comparable to full months
  const _cmLbl4=(D.current_month||{}).month_label||'';
  const closedMonths=months.filter(m=>m!==_cmLbl4);
  if(closedMonths.length<2)return null;
  const recent=D.skus_monthly[closedMonths[0]]||[];
  const compareIdx=Math.min(1,closedMonths.length-1);
  const older=D.skus_monthly[closedMonths[compareIdx]]||[];
  const recentMap=new Map(recent.map(s=>[s.id,s]));
  const olderMap=new Map(older.map(s=>[s.id,s]));
  const recentTotal=recent.reduce((a,s)=>a+(s.gmv||s.s||0),0);
  const _mvThresh=Math.max(3000,recentTotal*0.005); // relative: 0.5% of monthly GMV or 3K min
  const newSkus=recent.filter(s=>!olderMap.has(s.id)&&(s.gmv||s.s)>_mvThresh)
    .sort((a,b)=>(b.gmv||b.s)-(a.gmv||a.s)).slice(0,6)
    .map(s=>({name:s.n,gmv:s.gmv||s.s,cat:s.d}));
  const droppedSkus=older.filter(s=>!recentMap.has(s.id)&&(s.gmv||s.s)>_mvThresh)
    .sort((a,b)=>(b.gmv||b.s)-(a.gmv||a.s)).slice(0,6)
    .map(s=>({name:s.n,gmv:s.gmv||s.s,cat:s.d}));
  const growing=[],declining=[];
  recent.forEach(r=>{
    const o=olderMap.get(r.id);if(!o)return;
    const rg=r.gmv||r.s,og=o.gmv||o.s;if(!og||rg===og)return;
    const chg=(rg-og)/og;
    if(chg>0.25&&rg>3000)growing.push({name:r.n,gmv:rg,oldGmv:og,changePct:Math.round(chg*100)});
    if(chg<-0.25&&og>3000)declining.push({name:r.n,gmv:rg,oldGmv:og,changePct:Math.round(chg*100)});
  });
  return{
    newSkus,droppedSkus,
    growing:growing.sort((a,b)=>b.changePct-a.changePct).slice(0,4),
    declining:declining.sort((a,b)=>a.changePct-b.changePct).slice(0,4),
    recentMo:closedMonths[0],compareMo:closedMonths[compareIdx],
    note:'เทียบ MoM: '+closedMonths[compareIdx]+' → '+closedMonths[0]
  };
}

// ── Outlet Cycle Signals — like computeChurnSignals() but for outlets ──
// Requires Q5B v2 (has last_order_date) + current month in outlets_monthly
function computeOutletCycleSignals(){
  const _sortMo=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
  const months=Object.keys(D.outlets_monthly||{}).sort((a,b)=>_sortMo(b)-_sortMo(a));
  if(months.length<2)return[];
  const recentMo=months[0];const prevMo=months[1];
  if(_sortMo(recentMo)<=_sortMo(prevMo))return[]; // no current month data
  const curOutlets=D.outlets_monthly[recentMo]||[];
  const prevOutlets=D.outlets_monthly[prevMo]||[];
  if(!prevOutlets.length)return[];
  const curMap=new Map(curOutlets.map(o=>[o.outlet_id,o]));
  const cm=D.current_month;
  const now=new Date();
  const daysElapsed=cm?.days_elapsed||now.getDate();
  const daysInMonth=cm?.days_in_month||30;
  const signals=[];
  prevOutlets.forEach(prev=>{
    if(!prev.orders||prev.orders<2)return;
    const cycle=Math.round(daysInMonth/prev.orders);
    if(cycle<3)return; // ≥3 day cycle only (orders ≤10/month) — daily outlets too noisy
    const cur=curMap.get(prev.outlet_id);
    if(cur&&(cur.orders||0)>0)return; // has ordered this month → active, skip
    // Only flag outlets with 0 orders this month AND past their expected cycle
    if(daysElapsed<=cycle)return; // not yet past cycle — too early to flag
    const overdue=daysElapsed-cycle;
    const type=overdue>cycle*0.5?'gone':'near';
    signals.push({id:prev.outlet_id,name:prev.outlet_name||'—',gmv:prev.gmv||0,orders:prev.orders,cycle,daysElapsed,overdue,type});
  });
  return signals.sort((a,b)=>b.overdue-a.overdue);
}

function computeOutletMovement(offset=0){
  const _sortMo=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
  const months=Object.keys(D.outlets_monthly||{}).sort((a,b)=>_sortMo(b)-_sortMo(a));
  if(months.length<offset+2)return null;
  const recent=D.outlets_monthly[months[offset]]||[];
  const prev=D.outlets_monthly[months[offset+1]]||[];
  if(recent.length<=1&&prev.length<=1)return null;
  const recentIds=new Set(recent.map(o=>o.outlet_id));
  const prevIds=new Set(prev.map(o=>o.outlet_id));
  return{
    newOutlets:recent.filter(o=>!prevIds.has(o.outlet_id)).map(o=>({name:o.outlet_name,gmv:o.gmv})),
    droppedOutlets:prev.filter(o=>!recentIds.has(o.outlet_id)).map(o=>({name:o.outlet_name,gmv:o.gmv,orders:o.orders||0,outlet_id:o.outlet_id})),
    recentMo:months[offset],prevMo:months[offset+1]
  };
}

function buildKamContext(){
  const hist=D.history.length?D.history:[];
  const last=hist[hist.length-1]||{s:0,orders:0,m:''};
  const prev=hist[hist.length-2]||null;
  const momChange=prev&&prev.s>0?parseFloat(((last.s-prev.s)/prev.s*100).toFixed(1)):null;
  const allHigh=OPPS.filter(o=>getAlt(o).conf==='high');
  const top3=OPPS.slice(0,3).map(o=>{const a=getAlt(o);return{name:o.curName,altName:a.altName,saveMo:a.save,pct:a.pct,conf:a.conf};});
  return{
    account:{name:D.meta.accountName||'ไม่ระบุ',kam:D.meta.kamName||'—'},
    spend:{current:last.s,month:last.m,orders:last.orders,momChangePct:momChange,prevMonth:prev?.m||null},
    topCategories:((portfolioMonth&&D.cats_monthly&&D.cats_monthly[portfolioMonth])?D.cats_monthly[portfolioMonth]:(D.cats.length?D.cats:SAMPLE.cats)).slice(0,3).map(c=>({name:c.n,gmv:c.s,pct:c.p})),
    outletMovement:computeOutletMovement(),
    skuMovement:computeSkuMovement(),
    opportunities:{total:OPPS.length,highConf:allHigh.length,totalSaveMo:totalAll(),top3}
  };
}

// Build consistent SKU movement HTML — 3 columns, period in group header
function renderSkuMovementHtml(sm){
  if(!sm)return'<div style="font-size:12px;color:rgba(255,255,255,.35)">ไม่มีข้อมูล SKU หลายเดือน</div>';
  // Short month label helper: "เม.ย. 2569" → "เม.ย."
  const _shortMo=m=>(m||'').split(' ')[0]||m;
  const _shortRange=(a,b)=>a===b?_shortMo(a):_shortMo(a)+'–'+_shortMo(b);
  // Row: 3 columns only (no period column)
  const row=(ind,cls,name,gmv,pct)=>
    `<div class="kam-sku-row"><span class="kam-sku-ind ${cls}">${ind}</span><span class="kam-sku-name">${name}</span><span class="kam-sku-num">${fmt(gmv)}/เดือน${pct?` · ${pct}`:''}</span></div>`;
  // Group header with subtle period pill
  const grpHead=(label,period)=>
    `<div class="kam-sku-group-label">${label}<span style="font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:400;color:rgba(180,200,255,.45);margin-left:6px">${period}</span></div>`;
  let html='';
  if(sm.newSkus?.length){
    html+=`<div class="kam-sku-group">${grpHead(`เพิ่มใหม่ (${sm.newSkus.length})`,_shortMo(sm.recentMo))}`;
    html+=sm.newSkus.map(s=>row('+','pos',s.name,s.gmv,'')).join('');
    html+='</div>';
  }
  if(sm.droppedSkus?.length){
    html+=`<div class="kam-sku-group">${grpHead(`หยุดสั่ง (${sm.droppedSkus.length})`,_shortMo(sm.compareMo))}`;
    html+=sm.droppedSkus.map(s=>{
      const sub=skuSubstituteMapLM[s.name];
      if(sub){
        return`<div class="kam-sku-row" style="align-items:flex-start;padding:6px 0;background:rgba(38,96,200,.07);border-radius:8px;padding:8px 10px;margin-bottom:4px">
          <span class="kam-sku-ind substituted" style="margin-top:2px">→</span>
          <div style="flex:1;min-width:0">
            <div class="kam-sku-name">${s.name}</div>
            <div style="font-size:10px;color:rgba(255,255,255,.32);margin-top:1px">${s.gmv?fmt(s.gmv)+'/เดือน':''}</div>
            <div style="font-size:11px;color:rgba(180,210,255,.8);margin-top:4px">→ ${sub.substituteName}</div>
            <div style="font-size:10px;color:rgba(140,180,255,.45);margin-top:1px">${sub.reason||''}</div>
          </div>
          <span style="font-size:10px;font-weight:700;background:rgba(38,96,200,.35);color:rgba(180,210,255,.95);border:1px solid rgba(38,96,200,.5);border-radius:10px;padding:2px 8px;flex-shrink:0">สลับ</span>
        </div>`;
      }
      return row('−','neg',s.name,s.gmv,'');
    }).join('');
    html+='</div>';
  }
  if(sm.growing?.length){
    html+=`<div class="kam-sku-group">${grpHead('เพิ่มขึ้นมาก',_shortRange(sm.compareMo,sm.recentMo))}`;
    html+=sm.growing.map(s=>row('↑','pos',s.name,s.gmv,`+${s.changePct}%`)).join('');
    html+='</div>';
  }
  if(sm.declining?.length){
    html+=`<div class="kam-sku-group">${grpHead('ลดลงมาก',_shortRange(sm.compareMo,sm.recentMo))}`;
    html+=sm.declining.map(s=>row('↓','warn',s.name,s.gmv,`${s.changePct}%`)).join('');
    html+='</div>';
  }
  return html||'<div style="font-size:12px;color:rgba(255,255,255,.35)">ไม่พบการเปลี่ยนแปลงที่มีนัยสำคัญ</div>';
}

// ── Shared header update (called by both tab renders) ──
function _renderKamHeader(){
  const ctx=buildKamContext();
  const portRow=portviewBulkData.find(r=>r.id===currentAccountId)
    ||portviewBulkData.find(r=>r.id===D.meta.accountId);
  const displayName=portRow?.name||ctx.account.name||'—';
  const displayKam=portRow?.kamName||ctx.account.kam||'—';
  const displayType=portRow?.accountType||D.meta.accountType||'';
  // Legacy IDs (still written for any code that reads them)
  const dd=document.getElementById('kam-acct-dept');if(dd)dd.textContent=displayType;
  const dm=document.getElementById('kam-acct-meta2');if(dm)dm.textContent=`KAM: ${displayKam}`;
  const dn=document.getElementById('kam-acct-name2');if(dn)dn.textContent=displayName;
  // v185: combined dept·KAM label — show nickname only (Chain · KAM: Bookbig)
  const dkl=document.getElementById('kav-dept-kam-label');
  if(dkl){const nickMatch=displayKam.match(/\(([^)]+)\)/);const kamNick=nickMatch?nickMatch[1]:displayKam.split(' ')[0];dkl.textContent=[displayType,kamNick?`KAM: ${kamNick}`:null].filter(Boolean).join(' · ');}
  const sl=document.getElementById('kam-summary-acct-label');
  if(sl)sl.textContent=displayName?`${displayName.slice(0,18)}${displayName.length>18?'...':''}`:'Account Summary';
  // Update last month tab label dynamically
  const lastMoEl=document.getElementById('kstab-lastmonth-label');
  if(lastMoEl){const h=D.history;const lm=h.length?h[h.length-1].m:'เม.ย.';lastMoEl.textContent=(lm||'เม.ย.').split(' ')[0];}
  const emEl=document.getElementById('kam-empty-state');
  const hasData=(ctx.spend.current>0||OPPS.length>0);
  if(emEl)emEl.style.display=hasData?'none':'block';
  // v184+: update Zone 1 status strip + Zone 3
  _renderKamZone1Status();
  const z3=document.getElementById('kav-z3');
  const hasRealAcct=currentAccountId&&currentAccountId!=='default';
  if(z3)z3.style.display=hasRealAcct&&hasData?'':'none';
  return{ctx,displayName,portRow};
}

// ── v185: Zone 1 — status strip + stat row ──────────────────────
function _renderKamZone1Status(){
  const cm=D.current_month;
  const strip=document.getElementById('kav-status-strip');
  const statRow=document.getElementById('kav-stat-row');
  if(!cm){
    if(strip)strip.style.display='none';
    if(statRow)statRow.style.display='none';
    return;
  }
  const sig=computePaceSignal(cm,D.history);
  window._lastKamPaceSignal=sig;
  const _fK=n=>n>=1e6?'฿'+(n/1e6).toFixed(1)+'M':n>=1e3?'฿'+(n/1e3).toFixed(0)+'K':'฿'+Math.round(n);

  // — status strip —
  if(strip)strip.style.display=sig.isNew?'none':'';
  const pctEl=document.getElementById('kav-pace-pct');
  const chipEl=document.getElementById('kav-pace-chip');
  const daysEl=document.getElementById('kav-days-lbl');
  const barEl=document.getElementById('kav-ss-bar-fill');
  if(pctEl){pctEl.textContent=sig.pct!==null?sig.pct+'%':'—';pctEl.className='kav-pace-num '+(sig.cls||'');}
  // plain-text label matching portview: ON TRACK / MONITOR / AT RISK
  const _labelMap={great:'ON TRACK',safe:'ON TRACK',warn:'MONITOR',danger:'AT RISK',new:'NEW'};
  const _isEarlyMonth = sig.cls==='safe' && sig.daysElapsed < 5;
  if(chipEl){
    chipEl.textContent = _isEarlyMonth ? 'รอข้อมูล' : (_labelMap[sig.cls]||sig.label);
    chipEl.className='kav-status-label '+(_isEarlyMonth?'early':sig.cls||'');
  }
  if(daysEl){
    if(_isEarlyMonth){
      const _updateDay = 6; // pace reliable after day 5, shows on day 6
      daysEl.innerHTML=`${sig.daysElapsed} / ${sig.daysInMonth} วัน&ensp;<span style="font-size:9px;opacity:.85;color:rgba(140,180,255,.9)">· อัพเดทวันที่ ${_updateDay}</span>`;
    } else {
      daysEl.textContent=`${sig.daysElapsed} / ${sig.daysInMonth} วัน`;
    }
  }
  if(barEl){const _r=38,_c=2*Math.PI*_r,_d=_c*Math.min((sig.pct||0)/100,1);barEl.style.strokeDasharray=_d+' '+(_c-_d);barEl.setAttribute('class','kav-ring-fill '+(sig.cls||''));}
  const daysArcEl=document.getElementById('kav-days-arc-fill');
  if(daysArcEl&&sig.daysInMonth>0){const _dr=28,_dc=2*Math.PI*_dr,_dd=_dc*Math.min((sig.daysElapsed||0)/sig.daysInMonth,1);daysArcEl.style.strokeDasharray=_dd+' '+(_dc-_dd);}

  // — stat row —
  if(statRow)statRow.style.display=sig.isNew?'none':'';
  const mtdEl=document.getElementById('kav-mtd-val');
  const expEl=document.getElementById('kav-exp-val');
  const fcstEl=document.getElementById('kav-fcst-val');
  const baseEl=document.getElementById('kav-base-val');
  if(mtdEl)mtdEl.textContent=sig.gmvToDate?_fK(sig.gmvToDate):'—';
  // ควรได้ตอนนี้ = pro-rated baseline × days elapsed — neutral, not a performance signal
  if(expEl){
    expEl.textContent=sig.expected?_fK(Math.round(sig.expected)):'—';
    expEl.style.color=''; // neutral — matches MTD จริง
  }
  // RUN RATE / BASELINE pair — color runrate by vs baseline
  if(fcstEl){
    fcstEl.textContent=sig.runrate?_fK(sig.runrate):'—';
    fcstEl.style.color=sig.runrate&&sig.baselineGmv?(sig.runrate>=sig.baselineGmv?'#4ddc97':'#ff8888'):'rgba(255,255,255,.88)';
  }
  if(baseEl)baseEl.textContent=sig.baselineGmv?_fK(sig.baselineGmv):'—';

  // — formula expand content —
  const fmlEl=document.getElementById('kav-formula-text');
  if(fmlEl&&sig.monthsDetail&&sig.monthsDetail.length){
    const lines=sig.monthsDetail.map(d=>`${d.m}: ${_fK(d.gmv)} ÷ ${d.days} วัน = <strong>${_fK(d.daily)}/วัน</strong>`).join('<br>');
    const method=sig.histMonths>=3?`avg ${sig.histMonths} เดือน`:sig.histMonths===2?'avg 2 เดือน':'1 เดือน';
    fmlEl.innerHTML=`${lines}<br><span style="color:rgba(220,235,255,.4)">method: ${method} · baseline daily = ${_fK(sig.baselineDaily)}/วัน × ${sig.daysInMonth} วัน</span>`;
  }

  // — Zone 3 context label —
  _renderKamZone3Ctx(sig);
}

// ── v185: formula toggle ─────────────────────────────────────────
function _toggleKavFormula(){
  const d=document.getElementById('kav-formula-wrap');
  if(d)d.style.display=d.style.display==='none'||!d.style.display?'block':'none';
}

// ── v185: Zone 3 context button ──────────────────────────────────
function _renderKamZone3Ctx(sig){
  const btn=document.getElementById('kav-z3-secondary');
  if(!btn||!sig)return;
  const icon=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  if(sig.cls==='danger'){
    btn.innerHTML=`${icon} เปิดมุมมองร้าน — ดูสถานการณ์`;
    btn.className='kav-z3-ctx danger-ctx';
  }else{
    btn.innerHTML=`${icon} เปิดมุมมองร้าน`;
    btn.className='kav-z3-ctx';
  }
}

// ── Tab 1 "เดือนนี้": ก่อนเข้าร้าน brief card (new schema: situation/driver/pattern/probe) ──
// ── Tab 1 "เดือนนี้": rule-based data shown immediately; AI card injected after Insight ──
function renderKamThisMonth(){
  const renderer = window.FreshketSenseKamTeamRenderer;
  if(renderer && typeof renderer.renderKamThisMonthFromLegacy === 'function'){
    try{
      return renderer.renderKamThisMonthFromLegacy({
        D: D,
        OPPS: OPPS,
        currentAccountId: currentAccountId,
        currentKamSubtab: (typeof currentKamSubtab !== 'undefined' ? currentKamSubtab : null),
        portviewLevel: (typeof portviewLevel !== 'undefined' ? portviewLevel : null),
        portviewFilter: (typeof portviewFilter !== 'undefined' ? portviewFilter : null),
        teamviewLevel: (typeof teamviewLevel !== 'undefined' ? teamviewLevel : null),
        portviewBulkData: (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []),
        currentUserProfile: (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null),
        legacy: { renderKamThisMonth: __legacyRenderKamThisMonthFallback }
      });
    }catch(e){
      console.warn('renderKamThisMonth renderer failed, falling back to legacy renderer', e);
    }
  }
  return __legacyRenderKamThisMonthFallback();
}

function __legacyRenderKamThisMonthFallback(){
  _renderKamHeader();
  const kamCards=document.getElementById('kam-cards');
  if(!kamCards)return;
  // Clear signal bar — Insight not yet run for this account; generateKamBriefing will re-populate
  const _sb=document.getElementById('kam-signal-bar');if(_sb){_sb.innerHTML='';_sb.style.display='none';}
  const cm=D.current_month;
  const history=D.history;
  const fmtK=n=>n>=1e6?'฿'+(n/1e6).toFixed(1)+'M':n>=1e3?'฿'+(n/1e3).toFixed(0)+'K':'฿'+Math.round(n).toLocaleString('th-TH');
  let html='';

  // ── 1: PACE card — v185: data now in Zone 1, skip rendering here ──
  // (sig still computed for hidden-risk warning below)
  let sig=null;
  if(cm){
    sig=computePaceSignal(cm,history);
    // pace card suppressed — see Zone 1 status strip
  } else {
    // no data state already handled by empty-state
  }

  // ── 1b: Hidden risk warning — pace ดี แต่มีสัญญาณซ่อน ──
  if(cm&&sig&&(sig.cls==='safe'||sig.cls==='great')){
    const hiddenChurn=computeChurnSignals().filter(s=>s.type==='gone'&&s.gmv>=5000);
    const hiddenOm=computeOutletMovement();
    const droppedBig=(hiddenOm?.droppedOutlets||[]).filter(o=>(o.gmv||0)>=5000);
    const hiddenItems=[];
    if(hiddenChurn.length){
      const topChurn=hiddenChurn.slice(0,2).map(s=>s.name).join(', ');
      const totalGmv=hiddenChurn.reduce((s,c)=>s+c.gmv,0);
      hiddenItems.push(`SKU หายไป ${hiddenChurn.length} ตัว (${fmt(totalGmv)}/เดือน): ${topChurn}`);
    }
    if(droppedBig.length){
      const topDrop=droppedBig.slice(0,2).map(o=>o.outlet_name||o.name||'—').join(', ');
      hiddenItems.push(`Outlet หาย: ${topDrop}`);
    }
    if(hiddenItems.length){
      html+=`<div style="margin-bottom:12px;padding:11px 14px;background:rgba(240,176,0,.07);border:1px solid rgba(240,176,0,.3);border-radius:12px">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:7px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(240,176,0,.8)" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span style="font-size:10px;font-weight:700;color:rgba(240,176,0,.85);text-transform:uppercase;letter-spacing:.7px">ระวัง — Pace ดี แต่มีสัญญาณซ่อน</span>
        </div>
        ${hiddenItems.map(item=>`<div style="font-size:11px;color:rgba(255,220,100,.75);line-height:1.6;padding-left:21px">• ${item}</div>`).join('')}
        <div style="font-size:10px;color:rgba(255,200,80,.55);padding-left:21px;margin-top:6px;line-height:1.5">อาจส่งผลต่อยอดเดือนหน้า — ควร verify ก่อนออกจากร้าน</div>
      </div>`;
    }
  }

  // ── 2: สัญญาณบวก (new + growing SKUs this month) — rule-based ──
  const skuCurrentMap=new Map((D.sku_current||[]).map(s=>[String(s.item_id),s]));
  const moKeys=Object.keys(D.skus_monthly||{}).sort((a,b)=>{
    const toD=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
    return toD(b)-toD(a);
  });
  // v156: use last CLOSED month as baseline (not May MTD) for new/growing signal
  const _cmLbl3=(D.current_month||{}).month_label||'';
  const _prevClosedMoA=moKeys.find(m=>m!==_cmLbl3)||moKeys[0];
  const prevMonthSkuIds=_prevClosedMoA?new Set((D.skus_monthly[_prevClosedMoA]||[]).map(s=>String(s.id||s.item_id))):new Set();
  // New this month: in sku_current but NOT in last finished month
  const newThisMonth=(D.sku_current||[]).filter(s=>!prevMonthSkuIds.has(String(s.item_id))&&(s.gmv_to_date||0)>1000)
    .sort((a,b)=>(b.gmv_to_date||0)-(a.gmv_to_date||0)).slice(0,5);
  // Growing this month: in both, but pace-adjusted gmv > last month gmv
  const growing=[];
  if(cm&&cm.days_elapsed>0&&cm.days_in_month>0){
    const ratio=cm.days_in_month/cm.days_elapsed;
    (D.sku_current||[]).filter(s=>prevMonthSkuIds.has(String(s.item_id))).forEach(s=>{
      const lastSku=(D.skus_monthly[_prevClosedMoA]||[]).find(ls=>String(ls.id||ls.item_id)===String(s.item_id));
      if(!lastSku)return;
      const proj=(s.gmv_to_date||0)*ratio;
      const chgPct=lastSku.gmv>0?Math.round((proj-lastSku.gmv)/lastSku.gmv*100):0;
      const projGmv=(s.gmv_to_date||0)*ratio;
      if(chgPct>=20&&(s.gmv_to_date||0)>2000)growing.push({name:s.item_name_th||lastSku.n||'—',gmv:s.gmv_to_date||0,chgPct,projGmv:Math.round(projGmv),lastGmv:lastSku.gmv||0});
    });
    growing.sort((a,b)=>b.gmv-a.gmv);growing.splice(5);
  }
  if(newThisMonth.length||growing.length){
    html+=`<div class="kam-dc" style="margin-bottom:12px">
      <div class="kam-dc-head"><span class="kam-dc-head-label" style="color:rgba(80,220,160,.85)">สัญญาณบวกเดือนนี้</span></div>
      <div class="kam-dc-body">`;
    if(newThisMonth.length){
      html+=`<div style="font-size:10px;font-weight:700;color:rgba(80,220,160,.5);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">เพิ่งเริ่มสั่ง (${newThisMonth.length})</div>`;
      html+=newThisMonth.map(s=>`<div class="kam-sku-row"><span class="kam-sku-ind pos">+</span><span class="kam-sku-name">${s.item_name_th||'—'}</span><div style="text-align:right;flex-shrink:0;white-space:nowrap"><span style="font-size:13px;font-family:'IBM Plex Mono',monospace;font-weight:700;color:var(--amb)">${fmt(s.gmv_to_date||0)}</span><span style="font-size:10px;color:rgba(240,176,0,.55);margin-left:5px;font-weight:700;letter-spacing:.3px">MTD</span></div></div>`).join('');
    }
    if(growing.length){
      if(newThisMonth.length)html+=`<div style="margin-top:8px"></div>`;
      html+=`<div style="font-size:10px;font-weight:700;color:rgba(80,220,160,.5);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">สั่งเพิ่มขึ้น (${growing.length})</div>`;
      html+=growing.map(s=>{
        const projInc=Math.max(0,s.projGmv-s.lastGmv);
        return`<div class="kam-sku-row"><span class="kam-sku-ind pos">↑</span><span class="kam-sku-name">${s.name}</span><div style="text-align:right;flex-shrink:0;white-space:nowrap"><span style="font-size:12px;font-family:'IBM Plex Mono',monospace;font-weight:700;color:rgba(80,220,160,.95)">+${fmt(projInc)}</span><span style="font-size:9px;color:rgba(80,220,160,.5);margin-left:4px;font-weight:600;letter-spacing:.3px">proj.</span></div></div>`;
      }).join('');
    }
    html+=`</div></div>`;
  }

  // ── 2b: Outlet movement — unified list (dropped enriched with cycle info) ──
  const om=computeOutletMovement(0); // พ.ค. vs เม.ย.
  const cm2b=D.current_month;
  const now2b=new Date();
  const daysEl=cm2b?.days_elapsed||now2b.getDate();
  const daysInMo=cm2b?.days_in_month||30;
  if(om&&(om.newOutlets.length||om.droppedOutlets.length)){
    html+=`<div class="kam-dc" style="margin-bottom:12px">
      <div class="kam-dc-head"><span class="kam-dc-head-label">Outlet · ${om.recentMo}</span></div>
      <div class="kam-dc-body" style="padding-top:8px">`;
    om.newOutlets.forEach(o=>{
      html+=`<div class="kam-sku-row"><span class="kam-sku-ind pos">+</span><span class="kam-sku-name">${o.name||'—'}</span><div style="text-align:right;flex-shrink:0;white-space:nowrap"><span style="font-size:12px;font-family:'IBM Plex Mono',monospace;font-weight:700;color:rgba(255,255,255,.9)">${fmt(o.gmv||0)}</span><span style="font-size:9px;color:rgba(80,220,160,.5);margin-left:4px">ใหม่</span></div></div>`;
    });
    om.droppedOutlets.forEach(o=>{
      const cycle=o.orders>=1?Math.round(daysInMo/Math.max(o.orders,1)):0;
      const isMonthly=o.orders===1;          // สั่ง 1 ครั้ง/เดือน — informational only
      const hasCycle=cycle>=3&&!isMonthly;   // orders≥2: show urgency
      const clr=hasCycle&&daysEl>cycle*1.5?'rgba(255,130,130,.9)':'rgba(240,176,0,.85)';
      const ind=hasCycle&&daysEl>cycle*1.5?'neg':'warn';
      if(hasCycle||isMonthly||o.orders===0){
        const cycleLabel=isMonthly
          ?`<div style="font-size:10px;color:rgba(255,255,255,.28);margin-top:1px">ปกติ 1 ครั้ง/เดือน</div>`
          :o.orders===0?''
          :`<div style="font-size:10px;color:rgba(255,255,255,.32);margin-top:1px">ปกติ ${o.orders} ครั้ง/เดือน · ผ่านมา ${daysEl} วันแล้ว</div>`;
        const statusClr=isMonthly?'rgba(255,255,255,.3)':o.orders===0?'rgba(255,255,255,.3)':clr;
        html+=`<div class="kam-sku-row" style="align-items:flex-start;padding:5px 0">
          <span class="kam-sku-ind ${isMonthly||o.orders===0?'neg':ind}" style="margin-top:2px">−</span>
          <div style="flex:1;min-width:0">
            <div class="kam-sku-name">${o.name||'—'}</div>
            ${cycleLabel}
          </div>
          <div style="text-align:right;flex-shrink:0;white-space:nowrap">
            ${o.gmv?`<div style="font-size:12px;font-family:'IBM Plex Mono',monospace;font-weight:700;color:rgba(255,255,255,.75)">${fmt(o.gmv)}</div>`:''}
            <div style="font-size:11px;font-weight:700;color:${statusClr}">ยังไม่สั่ง</div>
          </div>
        </div>`;
      }
    });
    html+=`</div></div>`;
  }

  // ── 3: SKU Signals — churn (gone + slow) ──
  const signals=computeChurnSignals();
  if(D.sku_current&&D.sku_current.length&&signals.length){
    const goneCount=signals.filter(s=>s.type==='gone').length;
    const slowCount=signals.filter(s=>s.type==='slow').length;
    const nearCount=signals.filter(s=>s.type==='near').length;
    const notYetCount=signals.filter(s=>s.type==='not_yet').length;
    const badgeParts=[];
    if(goneCount)badgeParts.push(goneCount+' ไม่มียอด');
    if(slowCount)badgeParts.push(slowCount+' ยอดลด');
    if(nearCount)badgeParts.push(nearCount+' เฝ้าดู');
    if(notYetCount)badgeParts.push(notYetCount+' ยังไม่ถึงรอบ');
    const infoCard=skuSignalInfoOpen?`<div style="margin:8px 0 4px;padding:10px 12px;background:rgba(255,255,255,.05);border-radius:8px;border-left:2px solid rgba(100,170,255,.4)">
      <div style="font-size:11px;font-weight:700;color:rgba(180,210,255,.9);margin-bottom:6px">SKU Signals คำนวณยังไง?</div>
      <div style="font-size:11px;color:rgba(220,235,255,.7);line-height:1.75">ดูจากเดือนที่แล้วว่าแต่ละ SKU สั่งกี่ครั้ง แล้วคำนวณ "รอบปกติ" ว่าห่างกันกี่วัน</div>
      <div style="margin:7px 0 5px;font-size:10px;font-weight:700;color:rgba(180,210,255,.6);letter-spacing:.5px">ตัวอย่าง: น้ำมันปาล์ม สั่ง 4 ครั้ง/เดือน จาก 2 สาขา</div>
      <div style="font-size:11px;color:rgba(220,235,255,.55);line-height:1.8;padding-left:8px">→ แต่ละสาขาสั่ง 2 ครั้ง → รอบปกติ 15 วัน<br>วันที่ 16 ยังไม่สั่ง → เพิ่งเลยรอบ 1 วัน → <span style="color:rgba(240,176,0,.9);font-weight:700">เฝ้าดู</span><br>วันที่ 23 ยังไม่สั่ง → เลย 8 วัน (>50% ของรอบ) → <span style="color:rgba(255,130,130,.9);font-weight:700">ไม่มียอด</span><br>วันที่ 10 ยังไม่สั่ง → รออีก 5 วัน → <span style="color:rgba(255,255,255,.35);font-weight:700">ยังไม่ถึงรอบ</span></div>
    </div>`:'';
    // SKU Verify button state
    const _verifyDone=skuSubstituteDone;
    const _verifyLoading=skuSubstituteLoading;
    const _vBtnCls='sku-verify-btn'+(_verifyDone?' done':_verifyLoading?' loading':'');
    const _vIcon=`<svg class="svb-icon" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg>`;
    html+=`<div class="kam-dc" style="margin-bottom:12px">
      <div class="kam-dc-head">
        <span class="kam-dc-head-label" style="color:rgba(255,130,130,.85)">SKU Signals</span>
        <button onclick="skuSignalInfoOpen=!skuSignalInfoOpen;refreshAll()" style="width:16px;height:16px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:transparent;color:rgba(255,255,255,.45);font-size:10px;font-style:italic;font-family:Georgia,serif;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-left:6px;font-weight:700">i</button>
        <span style="flex:1"></span>
        <button id="sku-verify-tm-btn" class="${_vBtnCls}" onclick="triggerSkuVerifyFromThisMonth()">${_vIcon}${_verifyLoading?'กำลังตรวจ...':_verifyDone?'✓ SKU Verify':'SKU Verify'}</button>
      </div>
      <div class="kam-dc-body" style="padding-top:8px">${infoCard}`;
    const actionSigs=signals.filter(s=>s.type!=='not_yet');
    const notYetSigs=signals.filter(s=>s.type==='not_yet');
    const renderSkuRow=(s,dimmed=false)=>{
      const sub=skuSubstituteMap[String(s.id)];
      const isSub=!!sub;
      const clr=isSub?'rgba(140,180,255,.9)':s.type==='gone'?'rgba(255,130,130,.9)':s.type==='slow'?'rgba(255,140,40,.9)':s.type==='near'?'rgba(240,176,0,.85)':'rgba(255,255,255,.3)';
      const storyCl=s.type==='gone'?'rgba(255,130,130,.75)':s.type==='slow'?'rgba(255,140,40,.7)':s.type==='near'?'rgba(240,176,0,.7)':'rgba(255,255,255,.45)';
      const ind=isSub?'substituted':s.type==='gone'?'neg':s.type==='slow'?'slow':s.type==='near'?'warn':'';
      const indSymbol=isSub?'→':s.type==='gone'?'−':s.type==='slow'?`<svg width="13" height="12" viewBox="0 0 13 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;display:inline-block;margin-top:-1px"><polyline points="1,2 4,7 8,4 12,9"/><polyline points="9,9 12,9 12,6"/></svg>`:s.type==='near'?'↓':'·';
      const badge=isSub?'สลับ':s.type==='gone'?'ไม่มียอด':s.type==='slow'?'ยอดลด −'+s.gapPct+'%':s.type==='near'?'เฝ้าดู':'ยังไม่ถึงรอบ';
      const story=isSub?'':skuStoryLine(s);
      const nameOp=dimmed?'opacity:.4':'';
      const deptGmv=(s.type!=='not_yet'&&(s.dept||s.gmv>0))?`<div style="font-size:10px;color:rgba(255,255,255,.55);margin-top:1px">${s.dept||''}${s.dept&&s.gmv>0?' · ':''}<span style="font-family:'IBM Plex Mono',monospace;color:var(--amb)">${s.gmv>0?fmt(s.gmv)+'/เดือน':''}</span></div>`:'';
      const subHtml=isSub?`<div style="font-size:11px;color:rgba(180,210,255,.8);margin-top:3px">→ ${sub.substituteName}</div><div style="font-size:10px;color:rgba(140,180,255,.45);margin-top:1px">${sub.reason||''}</div>`:'';
      const badgeColor=isSub?'color:rgba(180,210,255,.9);background:rgba(38,96,200,.3);border:1px solid rgba(38,96,200,.45);border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700':'color:'+clr+';font-size:11px;font-weight:700';
      return`<div class="kam-sku-row" style="align-items:flex-start;padding:6px 0${dimmed?';opacity:.45':''}">
        <span class="kam-sku-ind ${ind}" style="margin-top:2px">${indSymbol}</span>
        <div style="flex:1;min-width:0">
          <div class="kam-sku-name">${s.name}</div>
          ${deptGmv}${subHtml}
        </div>
        <div style="text-align:right;flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:1px;margin-left:8px">
          <span style="${badgeColor}">${badge}</span>
          ${story&&!isSub?`<span style="font-size:10px;color:${storyCl};white-space:nowrap">${story}</span>`:''}
        </div>
      </div>`;
    };
    html+=actionSigs.slice(0,8).map(s=>renderSkuRow(s)).join('');
    if(notYetSigs.length){
      const showNotYet=churnExpanded?notYetSigs:notYetSigs.slice(0,0);
      if(showNotYet.length)html+=showNotYet.map(s=>renderSkuRow(s,true)).join('');
      html+=`<button onclick="churnExpanded=!churnExpanded;refreshAll()" style="width:100%;margin-top:6px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:transparent;color:rgba(255,255,255,.3);font-size:11px;font-weight:600;font-family:'IBM Plex Sans Thai',sans-serif;cursor:pointer;text-align:center">${churnExpanded?'▲ ซ่อน':'ยังไม่ถึงรอบ '+notYetSigs.length+' รายการ — กดดู'}</button>`;
    }
    html+=`</div></div>`;
  } else if(D.sku_current&&D.sku_current.length&&!signals.length){
    html+=`<div class="kam-dc" style="margin-bottom:12px">
      <div class="kam-dc-head"><span class="kam-dc-head-label" style="color:rgba(80,220,160,.85)">SKU Signals</span></div>
      <div class="kam-dc-body" style="color:rgba(80,220,160,.6);font-size:12px">✓ ไม่พบ SKU ที่น่าเป็นห่วงเดือนนี้</div>
    </div>`;
  }

  // ── 4: Category gap ──
  if(cm&&D.cats_monthly&&D.sku_current&&D.sku_current.length){
    const prevCatMoKeys=Object.keys(D.cats_monthly).sort((a,b)=>{const toD=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};return toD(b)-toD(a);});
    const prevCats=prevCatMoKeys.length?D.cats_monthly[prevCatMoKeys[0]]||[]:[];
    const curCatNames=new Set();
    (D.sku_current||[]).forEach(sc=>{const si=(D.skus||[]).find(s=>String(s.id)===String(sc.item_id));if(si)curCatNames.add(si.d);});
    const missingCats=prevCats.filter(c=>c.s>5000&&!curCatNames.has(c.n));
    if(missingCats.length){
      html+=`<div class="kam-dc" style="margin-bottom:12px;border-color:rgba(240,176,0,.2)">
        <div class="kam-dc-head"><span class="kam-dc-head-label" style="color:var(--amb)">Category ยังไม่สั่งเดือนนี้</span><span style="font-size:10px;color:rgba(255,255,255,.3);margin-left:auto">${missingCats.length} หมวด</span></div>
        <div class="kam-dc-body" style="padding-top:8px">
          ${missingCats.slice(0,5).map(c=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)"><span style="font-size:12px;color:rgba(255,255,255,.7)">${c.n}</span><span style="font-size:11px;font-family:'IBM Plex Mono',monospace;color:var(--amb)">${fmt(c.s)} เดือนก่อน</span></div>`).join('')}
        </div>
      </div>`;
    }
  }

  // ── CTA: Insight button hint (if no AI card yet) ──
  // v185: insight hint + อ่าน brief card removed (Zone 3 + overlay handle this)

  kamCards.innerHTML=html;
}

// ── Tab 2 "เม.ย.": Last month data cards (ยอดซื้อ / Outlets / วัตถุดิบ / โอกาส) ──
function renderKamLastMonth(){
  const renderer = window.FreshketSenseKamTeamRenderer;
  if(renderer && typeof renderer.renderKamLastMonthFromLegacy === 'function'){
    try{
      return renderer.renderKamLastMonthFromLegacy({
        D: D,
        OPPS: OPPS,
        currentAccountId: currentAccountId,
        currentKamSubtab: (typeof currentKamSubtab !== 'undefined' ? currentKamSubtab : null),
        portviewLevel: (typeof portviewLevel !== 'undefined' ? portviewLevel : null),
        portviewFilter: (typeof portviewFilter !== 'undefined' ? portviewFilter : null),
        teamviewLevel: (typeof teamviewLevel !== 'undefined' ? teamviewLevel : null),
        portviewBulkData: (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []),
        currentUserProfile: (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null),
        legacy: { renderKamLastMonth: __legacyRenderKamLastMonthFallback }
      });
    }catch(e){
      console.warn('renderKamLastMonth renderer failed, falling back to legacy renderer', e);
    }
  }
  return __legacyRenderKamLastMonthFallback();
}

function __legacyRenderKamLastMonthFallback(){
  _renderKamHeader();
  const ctx=buildKamContext();
  const sp=ctx.spend;
  const op=ctx.opportunities;
  const om=computeOutletMovement(1); // เม.ย. vs มี.ค. — not current month
  const sm=ctx.skuMovement;
  const trendHtml=sp.momChangePct!=null
    ?`<span class="kam-trend-chip ${sp.momChangePct>=0?'up':'dn'}">${sp.momChangePct>=0?'+':''}${sp.momChangePct}%</span>`:'';
  let outletHtml='';
  if(om&&(om.newOutlets.length||om.droppedOutlets.length)){
    const rows=[
      ...om.newOutlets.map(o=>`<div class="kam-outlet-row"><div class="kam-outlet-ind pos">+</div><div class="kam-outlet-name">${o.outlet_name||o.name}</div><div class="kam-outlet-gmv">${fmt(o.gmv)}/เดือน</div></div>`),
      ...om.droppedOutlets.map(o=>`<div class="kam-outlet-row"><div class="kam-outlet-ind neg">−</div><div class="kam-outlet-name">${o.outlet_name||o.name}</div><div class="kam-outlet-gmv">${fmt(o.gmv)}/เดือน</div></div>`),
    ].join('');
    outletHtml=`<div class="kam-dc">
      <div class="kam-dc-head"><span class="kam-dc-head-label">Outlets · ${om.recentMo}</span></div>
      <div class="kam-dc-body">${rows}</div>
      <div class="kam-dc-insight" id="dc-insight-outlet" style="display:none"></div>
    </div>`;
  }
  const top3Html=op.top3.map(o=>`<div class="kam-opp-row"><div class="kam-opp-name">${o.name} → ${o.altName}</div><div class="kam-opp-save">${fmt(o.saveMo)+'/เดือน'}</div><span class="kam-opp-conf ${o.conf==='high'?'hi':'md'}">${o.conf==='high'?'✓':'⚠'}</span></div>`).join('');
  const ctaEl=document.getElementById('kam-opp-count-cta');if(ctaEl)ctaEl.textContent=OPPS.length||'—';
  const lmSec=document.getElementById('kam-lastmonth-section');
  if(!lmSec)return;
  lmSec.innerHTML=`
    <div class="kam-dc">
      <div class="kam-dc-head"><span class="kam-dc-head-label">ยอดซื้อ · ${sp.month}</span></div>
      <div class="kam-dc-body">
        <div class="kam-gmv-main">${fmt(sp.current)}<span style="font-size:13px;font-weight:400;color:rgba(220,235,255,.6)">/เดือน</span>${trendHtml}</div>
        <div class="kam-gmv-sub">${sp.orders} ออเดอร์${sp.prevMonth?' · เทียบจาก '+sp.prevMonth:''}</div>
      </div>
      <div class="kam-dc-insight" id="dc-insight-gmv" style="display:none"></div>
    </div>
    ${outletHtml}
    <div class="kam-dc">
      <div class="kam-dc-head">
        <span class="kam-dc-head-label">วัตถุดิบ — ${sm?sm.compareMo+'–'+sm.recentMo:'3 เดือนล่าสุด'}</span>
        ${sm&&sm.droppedSkus?.length?`<span style="flex:1"></span><button id="sku-verify-lm-btn" class="sku-verify-btn${skuSubstituteDoneLM?' done':skuSubstituteLoadingLM?' loading':''}" onclick="triggerSkuVerifyLastMonth()"><svg class="svb-icon" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg>${skuSubstituteLoadingLM?'กำลังตรวจ...':skuSubstituteDoneLM?'✓ SKU Verify':'SKU Verify'}</button>`:''}
      </div>
      <div class="kam-dc-body">${renderSkuMovementHtml(sm)}</div>
      <div class="kam-dc-insight" id="dc-insight-sku" style="display:none"></div>
    </div>
    <div class="kam-dc">
      <div class="kam-dc-head"><span class="kam-dc-head-label">โอกาสลดต้นทุน</span></div>
      <div class="kam-dc-body">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:700;color:var(--amb);margin-bottom:6px">${fmt(op.totalSaveMo)}<span style="font-size:11px;font-weight:400;color:rgba(220,235,255,.6)">/เดือน</span></div>
        <div style="font-size:11px;color:rgba(255,255,255,.5);margin-bottom:10px">${op.total} รายการ · ${op.highConf} รายการใช้แทนได้ทันที</div>
        ${top3Html}
      </div>
      <div class="kam-dc-insight" id="dc-insight-cost" style="display:none"></div>
      <div style="padding:0 14px 12px">
        <button onclick="closeDataPanel&&closeDataPanel();showScreen('opportunities')" style="font-size:11px;font-weight:700;color:rgba(180,210,255,.85);background:rgba(38,96,200,.15);border:1px solid rgba(38,96,200,.35);border-radius:8px;padding:6px 14px;cursor:pointer;font-family:'IBM Plex Sans Thai',sans-serif;display:inline-flex;align-items:center;gap:5px">
          ดูทั้ง <span id="kam-opp-count-cta">—</span> รายการ →
        </button>
      </div>
    </div>`;
}

// Legacy alias — keeps portview/teamview account-switch paths working
function renderKamOverview(){
  const renderer = window.FreshketSenseKamTeamRenderer;
  if(renderer && typeof renderer.renderKamOverviewFromLegacy === 'function'){
    try{
      return renderer.renderKamOverviewFromLegacy({
        D: D,
        OPPS: OPPS,
        currentAccountId: currentAccountId,
        currentKamSubtab: (typeof currentKamSubtab !== 'undefined' ? currentKamSubtab : null),
        portviewLevel: (typeof portviewLevel !== 'undefined' ? portviewLevel : null),
        portviewFilter: (typeof portviewFilter !== 'undefined' ? portviewFilter : null),
        teamviewLevel: (typeof teamviewLevel !== 'undefined' ? teamviewLevel : null),
        portviewBulkData: (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []),
        currentUserProfile: (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null),
        legacy: { renderKamOverview: __legacyRenderKamOverviewFallback }
      });
    }catch(e){
      console.warn('renderKamOverview renderer failed, falling back to legacy renderer', e);
    }
  }
  return __legacyRenderKamOverviewFallback();
}

function __legacyRenderKamOverviewFallback(){
  if(kamSubtab==='lastmonth'){renderKamLastMonth();return;}
  renderKamThisMonth();
}

function handleKamInsightBtn(){
  if(kamSubtab==='lastmonth')generateLastMonthSummary();
  else generateKamBriefing();
}

// ── SKU Verify for เดือนนี้ tab ──
// Uses newThisMonth (sku_current vs historical) as substitution candidates
// instead of computeSkuMovement().newSkus (historical-only)
async function triggerSkuVerifyFromThisMonth(){
  if(skuSubstituteLoading)return;

  // Class-based button state manager (re-fetches element each call — safe after re-render)
  const _starSvg=`<svg class="svb-icon" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg>`;
  const _setVBtn=(cls,text)=>{const b=document.getElementById('sku-verify-tm-btn');if(!b)return;b.className='sku-verify-btn'+(cls?' '+cls:'');b.innerHTML=_starSvg+text;};

  // ── Build newThisMonth candidates from sku_current ──
  const moKeys=Object.keys(D.skus_monthly||{}).sort((a,b)=>{
    const toD=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
    return toD(b)-toD(a);
  });
  // v156: use last CLOSED month as baseline for new-SKU detection
  const _cmLbl3b=(D.current_month||{}).month_label||'';
  const _prevClosedMoB=moKeys.find(m=>m!==_cmLbl3b)||moKeys[0];
  const prevMonthSkuIds=_prevClosedMoB?new Set((D.skus_monthly[_prevClosedMoB]||[]).map(s=>String(s.id||s.item_id))):new Set();
  const newThisMo=(D.sku_current||[])
    .filter(s=>!prevMonthSkuIds.has(String(s.item_id))&&(s.gmv_to_date||0)>500)
    .sort((a,b)=>(b.gmv_to_date||0)-(a.gmv_to_date||0))
    .slice(0,25);

  const signals=computeChurnSignals();

  // Guard: need both churned SKUs and new SKUs to compare
  if(!signals.length||!newThisMo.length){
    _setVBtn('',signals.length?'ไม่พบ SKU ใหม่เดือนนี้':'ไม่มีข้อมูล');
    setTimeout(()=>_setVBtn(skuSubstituteDone?'done':'','SKU Verify'),2500);
    return;
  }

  // ── Layer 1: subclass pre-filter ──
  const skuLookup={};
  (D.skus||[]).forEach(s=>{skuLookup[String(s.id)]={subclass:s.subclass||'',temperature:s.temperature||''};});
  const allMonthSkus=Object.values(D.skus_monthly||{}).flat();
  const newSkuMeta={};
  newThisMo.forEach(ns=>{
    const name=ns.item_name_th||'';
    const found=(D.skus||[]).find(s=>String(s.id)===String(ns.item_id))||allMonthSkus.find(s=>s.n===name);
    newSkuMeta[name]={subclass:found?.subclass||found?.sc||'',temperature:found?.temperature||found?.temp||'',cat:found?.d||''};
  });

  const candidatePairs=[];
  signals.slice(0,25).forEach(s=>{
    const cMeta=skuLookup[s.id]||{};
    newThisMo.forEach(ns=>{
      const name=ns.item_name_th||'';
      const nMeta=newSkuMeta[name]||{};
      const subclassMatch=!cMeta.subclass||!nMeta.subclass||cMeta.subclass===nMeta.subclass;
      if(!subclassMatch)return;
      candidatePairs.push({
        churned_id:s.id,churned_name:s.name,churned_dept:s.dept,
        churned_subclass:cMeta.subclass||'ไม่ทราบ',churned_gmv:s.gmv,
        new_name:name,new_cat:nMeta.cat||'',
        new_subclass:nMeta.subclass||'ไม่ทราบ',new_gmv:ns.gmv_to_date||0
      });
    });
  });

  if(!candidatePairs.length){
    _setVBtn('','ไม่พบ SKU ที่เปลี่ยน');
    setTimeout(()=>_setVBtn(skuSubstituteDone?'done':'','SKU Verify'),2500);
    return;
  }

  // ── Layer 2: AI judgment ──
  skuSubstituteLoading=true;
  _setVBtn('loading','กำลังตรวจ...');

  const sys=OLIVE_BASE+`

-- TASK CONTEXT --
Right now you are checking whether churned and new SKU pairs represent genuine substitutions — not flagging anything that simply looks similar. This is a precision task: a false positive wastes a KAM's conversation capital on the wrong topic; a false negative misses a real signal. Only include pairs you are genuinely confident about.

-- OUTPUT CONTRACT --
RESPOND WITH JSON ONLY. NO PREAMBLE. NO MARKDOWN.
schema: {"substitutions":[{"churned_id":"string","new_name":"string","confidence":"high|medium","spend_change":"up|down|same","reason":"string"}]}
ถ้าคู่ไหนไม่ใช่การสลับจริง อย่าใส่ — เน้น precision

EXCLUSION: คนละประเภทใน function → excluded | Form ต่างกันพื้นฐาน (บด/สับ vs ชิ้น/แผ่น/ทั้งชิ้น) → excluded | Size variant (Baby/Mini/Cherry) → excluded | สูตร/รสต่างกัน → excluded | น้ำส้มสายชูต่างชนิด → excluded
CONFIDENCE: same subclass+function=high | cut/grade/brand/size ต่างกัน=medium
reason: one sentence, the way you'd explain it to a KAM — clear, specific, no jargon. If not a real substitution, omit entirely.`;

  const userMsg=`คู่ที่ต้องประเมิน (${candidatePairs.length} คู่):\n${JSON.stringify(candidatePairs)}\n\nคู่ไหนเป็นการสลับสินค้าจริง?`;

  try{
    const txt=await callAI(kamModel==='sonnet'?'sonnet':'haiku',sys,[{role:'user',content:userMsg}],600);
    const clean=txt.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'').trim();
    let st=clean.indexOf('{'),en=-1,depth=0;
    for(let i=st;i<clean.length;i++){if(clean[i]==='{')depth++;else if(clean[i]==='}'){depth--;if(depth===0){en=i;break;}}}
    if(st===-1||en===-1)throw new Error('No JSON');
    const result=JSON.parse(clean.slice(st,en+1));
    (result.substitutions||[]).forEach(s=>{
      const pair=candidatePairs.find(p=>String(p.churned_id)===String(s.churned_id)&&p.new_name===s.new_name);
      const newGmv=pair?pair.new_gmv:0;
      skuSubstituteMap[String(s.churned_id)]={substituteName:s.new_name,spendChange:s.spend_change,confidence:s.confidence||'medium',reason:s.reason,kamQuestion:'',newGmv};
    });
    skuSubstituteDone=true;
    skuSubstituteLoading=false; // ← set BEFORE render so button shows done state
    if(kamSubtab==='thismonth')renderKamThisMonth();
    else _setVBtn('done','✓ SKU Verify'); // not on thismonth tab → update directly
  }catch(e){
    console.warn('SKU Verify error',e);
    skuSubstituteLoading=false;
    _setVBtn('','SKU Verify');
  }
}

// ── SKU Verify for เม.ย. (last month) tab ──
// Uses computeSkuMovement().droppedSkus vs newSkus — historical-only, name-keyed
async function triggerSkuVerifyLastMonth(){
  if(skuSubstituteLoadingLM)return;
  const _starSvg=`<svg class="svb-icon" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg>`;
  const _setBtn=(cls,text)=>{const b=document.getElementById('sku-verify-lm-btn');if(!b)return;b.className='sku-verify-btn'+(cls?' '+cls:'');b.innerHTML=_starSvg+text;};

  const sm=computeSkuMovement();
  const dropped=sm?.droppedSkus||[];
  const newSkus=sm?.newSkus||[];

  if(!dropped.length||!newSkus.length){
    _setBtn('',dropped.length?'ไม่พบ SKU ใหม่':'ไม่มีข้อมูล');
    setTimeout(()=>_setBtn(skuSubstituteDoneLM?'done':'','SKU Verify'),2500);
    return;
  }

  // ── Layer 1: subclass pre-filter ──
  const allMonthSkus=Object.values(D.skus_monthly||{}).flat();
  const _meta=name=>{const f=(D.skus||[]).find(s=>s.n===name)||allMonthSkus.find(s=>s.n===name);return{subclass:f?.subclass||f?.sc||'',cat:f?.d||''};};

  const candidatePairs=[];
  dropped.slice(0,25).forEach(d=>{
    const dMeta=_meta(d.name);
    newSkus.slice(0,25).forEach(n=>{
      const nMeta=_meta(n.name);
      const match=!dMeta.subclass||!nMeta.subclass||dMeta.subclass===nMeta.subclass;
      if(!match)return;
      candidatePairs.push({
        churned_name:d.name,churned_dept:d.cat||'',churned_subclass:dMeta.subclass||'ไม่ทราบ',churned_gmv:d.gmv,
        new_name:n.name,new_cat:nMeta.cat||'',new_subclass:nMeta.subclass||'ไม่ทราบ',new_gmv:n.gmv
      });
    });
  });

  if(!candidatePairs.length){
    _setBtn('','ไม่พบ SKU ที่เปลี่ยน');
    setTimeout(()=>_setBtn(skuSubstituteDoneLM?'done':'','SKU Verify'),2500);
    return;
  }

  // ── Layer 2: AI judgment ──
  skuSubstituteLoadingLM=true;
  _setBtn('loading','กำลังตรวจ...');

  const sys=OLIVE_BASE+`

-- TASK CONTEXT --
Right now you are checking whether dropped and new SKU pairs represent genuine substitutions — not flagging anything that simply looks similar. This is a precision task: a false positive wastes a KAM's conversation capital on the wrong topic; a false negative misses a real signal. Only include pairs you are genuinely confident about.

-- OUTPUT CONTRACT --
RESPOND WITH JSON ONLY. NO PREAMBLE. NO MARKDOWN.
schema: {"substitutions":[{"churned_name":"string","new_name":"string","confidence":"high|medium","spend_change":"up|down|same","reason":"string"}]}
ถ้าคู่ไหนไม่ใช่การสลับจริง อย่าใส่ — เน้น precision

EXCLUSION: คนละประเภทใน function → excluded | Form ต่างกันพื้นฐาน (บด/สับ vs ชิ้น/แผ่น/ทั้งชิ้น) → excluded | Size variant (Baby/Mini) → excluded | สูตร/รสต่างกัน → excluded | น้ำส้มสายชูต่างชนิด → excluded
CONFIDENCE: same subclass+function=high | cut/grade/brand/size ต่างกัน=medium
reason: one sentence, the way you'd explain it to a KAM — clear, specific, no jargon. If not a real substitution, omit entirely.`;

  const userMsg=`คู่ที่ต้องประเมิน (${candidatePairs.length} คู่):\n${JSON.stringify(candidatePairs)}\n\nคู่ไหนเป็นการสลับสินค้าจริง?`;

  try{
    const txt=await callAI(kamModel==='sonnet'?'sonnet':'haiku',sys,[{role:'user',content:userMsg}],600);
    const clean=txt.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'').trim();
    let st=clean.indexOf('{'),en=-1,depth=0;
    for(let i=st;i<clean.length;i++){if(clean[i]==='{')depth++;else if(clean[i]==='}'){depth--;if(depth===0){en=i;break;}}}
    if(st===-1||en===-1)throw new Error('No JSON');
    const result=JSON.parse(clean.slice(st,en+1));
    skuSubstituteMapLM={};
    (result.substitutions||[]).forEach(s=>{
      const pair=candidatePairs.find(p=>p.churned_name===s.churned_name&&p.new_name===s.new_name);
      skuSubstituteMapLM[s.churned_name]={substituteName:s.new_name,spendChange:s.spend_change,confidence:s.confidence||'medium',reason:s.reason,newGmv:pair?.new_gmv||0};
    });
    skuSubstituteDoneLM=true;
    skuSubstituteLoadingLM=false;
    if(kamSubtab==='lastmonth')renderKamLastMonth();
    else _setBtn('done','✓ SKU Verify');
  }catch(e){
    console.warn('SKU Verify LM error',e);
    skuSubstituteLoadingLM=false;
    _setBtn('','SKU Verify');
  }
}

async function generateKamBriefing(){
  const loading=document.getElementById('kam-loading2');
  const cards=document.getElementById('kam-cards');
  const btn=document.getElementById('kam-insight-btn');
  const insLabel=document.getElementById('kam-insight-btn-label');
  const talkWrap=document.getElementById('kam-talkline-wrap');
  if(loading){loading.style.display='block';}
  if(talkWrap){talkWrap.style.display='none';}
  if(btn){btn.classList.add('loading');}
  if(insLabel)insLabel.textContent='กำลังวิเคราะห์...';
  const sigBar=document.getElementById('kam-signal-bar');
  if(sigBar)sigBar.style.display='none';
  const steps=['กำลังอ่านสัญญาณ...','กำลังประเมิน materiality...','กำลังหา driver...','กำลังตรวจ cross-signal...','กำลังสรุป action...'];
  let stepIdx=0;
  const stepEl=document.getElementById('kam-loading-step');
  const stepTimer=setInterval(()=>{
    stepIdx=(stepIdx+1)%steps.length;
    if(stepEl){stepEl.style.opacity='0';setTimeout(()=>{if(stepEl){stepEl.textContent=steps[stepIdx];stepEl.style.opacity='1';}},150);}
  },1800);
  renderKamThisMonth();
  if(cards)cards.style.display='block'; // keep content visible while AI thinks
  const ctx=buildKamContext();
  const hist=D.history.length?D.history:[];
  const last=hist[hist.length-1]||{s:0};
  const prev=hist[hist.length-2]||null;
  const momChg=prev&&prev.s>0?(last.s-prev.s)/prev.s*100:0;
  // Baseline = avg of last 3 finished months
  const baselineGmv=hist.length>=3
    ?Math.round(hist.slice(-3).reduce((s,h)=>s+h.s,0)/3)
    :(hist.length?hist[hist.length-1].s:0);
  const portRow2=portviewBulkData.find(r=>r.id===(D.meta.accountId||currentAccountId));
  const accountType=portRow2?.accountType||D.meta.accountType||'';
  const missingCatStr=(portRow2?.missingCats||'').split(' | ').filter(Boolean).slice(0,3).join(', ');
  // Pace
  const paceData=D.current_month?computePaceSignal(D.current_month,D.history):null;
  const paceInfo=paceData?`${paceData.pct}% (${paceData.label}) — ควรได้ ${fmt(Math.round(paceData.expected))} ยอดจริง ${fmt(Math.round(paceData.gmvToDate))}`:'ไม่มีข้อมูล pace';
  const ordersToDate=D.current_month?.orders_to_date||0;
  const scenarioHint=momChg<-15?'churn_risk':totalAll()>20000?'upsell_opportunity':'healthy_account';
  // Materiality filter: only SKUs/events ≥3% baseline for context, ≥5% for situation/driver
  const minMaterial=baselineGmv>0?baselineGmv*0.03:3000;
  const minSituation=baselineGmv>0?baselineGmv*0.05:5000;
  // Churned material SKUs (gone this month, GMV ≥3% baseline)
  const churnSignals=computeChurnSignals();
  const churnedMaterial=churnSignals
    .filter(s=>s.type==='gone'&&s.gmv>=minMaterial)
    .slice(0,5)
    .map(s=>({name:s.name,gmv:s.gmv,pctBaseline:baselineGmv>0?Math.round(s.gmv/baselineGmv*100):0,avgInterval:s.avgInterval}));
  // SKUs not yet due — AI must NOT treat these as churned
  const notYetSkus=churnSignals
    .filter(s=>s.type==='not_yet'&&s.gmv>=minMaterial)
    .slice(0,3)
    .map(s=>({name:s.name,avgInterval:s.avgInterval}));
  // Growing material SKUs (new this month from skuMovement)
  const sm2=computeSkuMovement();
  const growingMaterial=(sm2?.newSkus||[])
    .filter(s=>s.gmv>=minMaterial)
    .slice(0,5)
    .map(s=>({name:s.name,gmv:s.gmv,pctBaseline:baselineGmv>0?Math.round(s.gmv/baselineGmv*100):0}));
  // Opportunities
  const allHigh=OPPS.filter(o=>getAlt(o).conf==='high');
  const top3Opps=OPPS.slice(0,3).map(o=>{const a=getAlt(o);return o.curName+'→'+a.altName+' ('+fmt(a.save)+'/เดือน)';});
  const sys=OLIVE_BASE+`

-- TASK CONTEXT --
A KAM is about to visit this account. They already know the restaurant — they don't need a report. They need a sharp briefing: what is actually happening right now, and what should they walk in ready to ask or address.

Data available: this month's pace, churned SKUs, SKUs not yet due for reorder (notYetSkus), new growing SKUs, category gaps, and cost-saving opportunities.

-- OUTPUT CONTRACT --
Output: JSON only — no preamble, no markdown.
schema: {"paceInsight":"string","skuInsight":"string","costInsight":"string","summary":"string"}

Each field: translate what the signal means for this restaurant, then tell the KAM exactly what to ask or do. Two sentences is the ceiling — not because of a rule, but because a sharp briefing doesn't need more.

Guardrails:
- Only mention SKUs where GMV ≥ 5% of account baseline. Below 2% — don't mention.
- notYetSkus are SKUs not yet due for reorder. Never describe them as missing or churned.
- When naming a SKU, always include ฿ amount — not %.
- costInsight = cost reduction opportunity for the restaurant, not a sales pitch.
- summary: 2-3 sentences — what the KAM should do when they walk in. Action, not recap.
- Don't repeat numbers already visible in the UI.`;

  const slimCtx={
    account:{name:ctx.account.name,type:accountType,baseline:baselineGmv},
    scenarioHint,
    pace:paceInfo,
    thisMonth:{
      ordersToDate,
      churnedMaterial:churnedMaterial.length?churnedMaterial:null,
      notYetSkus:notYetSkus.length?notYetSkus:null,  // ยังไม่ถึงรอบ — ห้าม AI สรุปว่าหาย
      growingMaterial:growingMaterial.length?growingMaterial:null
    },
    topCategories:ctx.topCategories,
    outletMovement:ctx.outletMovement?{
      new:ctx.outletMovement.newOutlets.map(o=>o.name||o.outlet_name),
      dropped:ctx.outletMovement.droppedOutlets.map(o=>o.name||o.outlet_name),
      period:ctx.outletMovement.prevMo+'→'+ctx.outletMovement.recentMo
    }:null,
    categoryGap:missingCatStr||null,
    opportunities:{
      note:'โอกาสลดต้นทุน ไม่ใช่โอกาสขาย',
      highConf:allHigh.length,
      top3:top3Opps
    }
  };
  const userMsg=`ข้อมูลลูกค้า:\n${JSON.stringify(slimCtx,null,1)}\n\nวิเคราะห์และตอบ JSON เท่านั้น`;
  try{
    const txt=await callAI(kamModel==='sonnet'?'sonnet':'haiku',sys,[{role:'user',content:userMsg}],1500);
    if(!txt){console.error('KAM briefing empty response');throw new Error('Empty response');}
    // Find outermost JSON object by brace-scanning raw text — handles markdown fences anywhere
    let st=-1,en=-1,depth=0;
    for(let i=0;i<txt.length;i++){
      if(txt[i]==='{'){if(depth===0)st=i;depth++;}
      else if(txt[i]==='}'){depth--;if(depth===0){en=i;break;}}
    }
    if(st===-1||en===-1)throw new Error('No JSON in response');
    let brief;
    const _slice=txt.slice(st,en+1);
    try{brief=JSON.parse(_slice);}
    catch(e2){
      try{brief=JSON.parse(_slice.replace(/[\x00-\x1f\u2028\u2029]/g,' '));}
      catch(e3){
        const _rx=k=>{const m=_slice.match(new RegExp('"'+k+'"\\s*:\\s*"([\\s\\S]*?)"\\s*[,}]'));return m?m[1].replace(/[\x00-\x1f\u2028\u2029]/g,' ').trim():null;};
        brief={paceInsight:_rx('paceInsight'),skuInsight:_rx('skuInsight'),costInsight:_rx('costInsight'),summary:_rx('summary')};
        if(!brief.paceInsight&&!brief.skuInsight&&!brief.costInsight){console.error('KAM parse fail:',_slice.slice(0,300));throw e3;}
      }
    }
    // Inject per-card insights (same pattern as generateLastMonthSummary)
    const _injectInsight=(id,text)=>{
      const el=document.getElementById(id);if(!el)return;
      if(!text){el.style.display='none';return;}
      const parts=text.split(/(?<=[.!?])\s+(?=[ก-ฮ])/);
      const obs=parts[0]||text;const act=parts[1]||'';
      el.innerHTML=`<div class="kam-dc-insight-inner"><svg class="kam-dc-insight-star" width="10" height="10" viewBox="0 0 10 10" fill="rgba(100,170,255,.7)"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg><div><span class="kam-dc-insight-text">${obs}</span>${act?`<div class="kam-dc-insight-action">${act}</div>`:''}</div></div>`;
      el.style.display='';
    };
    // Per-card insight slots don't exist in เดือนนี้ kamCards — consolidate all into one summary card
    const _existSum=document.getElementById('dc-tm-summary-card');
    if(_existSum)_existSum.remove();
    if(cards){
      const _labelClr={'Pace':'rgba(100,180,255,.8)','วัตถุดิบ':'rgba(0,208,112,.75)','โอกาสต้นทุน':'rgba(240,176,0,.85)'};
      const _insightRow=(label,txt)=>txt?`<div style="margin-bottom:12px"><div style="font-size:9px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:${_labelClr[label]||'rgba(255,255,255,.4)'};margin-bottom:5px;border-bottom:1px solid ${_labelClr[label]||'rgba(255,255,255,.1)'};padding-bottom:3px">${label}</div><div style="font-size:12px;color:rgba(220,235,255,.88);line-height:1.7;font-style:italic">${txt}</div></div>`:'';
      const bodyHtml=_insightRow('Pace',brief.paceInsight)+_insightRow('วัตถุดิบ',brief.skuInsight)+_insightRow('โอกาสต้นทุน',brief.costInsight)+(brief.summary?`<div style="padding-top:8px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;color:rgba(220,235,255,.85);line-height:1.75">${brief.summary}</div>`:'');
      if(bodyHtml){
        const sumCard=document.createElement('div');
        sumCard.className='kam-dc';sumCard.id='dc-tm-summary-card';
        sumCard.innerHTML=`<div class="kam-dc-head"><span class="kam-dc-head-label">สรุปก่อนเข้าเยี่ยม</span></div><div class="kam-dc-body">${bodyHtml}</div>`;
        cards.prepend(sumCard);
      }
    }
    const ctaHint=document.getElementById('dc-insight-cta');
    if(ctaHint)ctaHint.style.display='none';
    // Cache
    if(cards)kamStateCache={html:cards.innerHTML,accountId:currentAccountId};
    clearInterval(stepTimer);
    if(loading)loading.style.display='none';
    if(cards)cards.style.display='block';
    if(btn)btn.classList.remove('loading');
    if(insLabel)insLabel.textContent=_getSummaryInsightLabel(true);
    if(btn)btn.classList.add('done');
    if(talkWrap)talkWrap.style.display='block';
    renderKamSignalBar();
    // SKU substitute analysis is triggered manually via Insight button
  }catch(e){
    clearInterval(stepTimer);
    if(loading)loading.style.display='none';
    if(cards)cards.style.display='block';
    if(btn)btn.classList.remove('loading');
    if(insLabel)insLabel.textContent=_getSummaryInsightLabel(false);
    if(btn)btn.classList.remove('done');
    if(talkWrap)talkWrap.style.display='block';
    renderKamSignalBar();
    console.error('KAM briefing error:',e);
    const _existSumErr=document.getElementById('dc-tm-summary-card');
    if(_existSumErr)_existSumErr.remove();
  }
}

async function generateLastMonthSummary(){
  const lmSec=document.getElementById('kam-lastmonth-section');
  const btn=document.getElementById('kam-insight-btn');
  const insLabel=document.getElementById('kam-insight-btn-label');
  const loading=document.getElementById('kam-loading2');
  if(!lmSec){console.warn('kam-lastmonth-section not found');return;}
  if(btn)btn.classList.add('loading');
  if(insLabel)insLabel.textContent='กำลังวิเคราะห์...';
  if(loading)loading.style.display='block';
  const steps=['กำลังอ่านยอดซื้อเดือนที่แล้ว...','กำลังวิเคราะห์ SKU...','กำลังประเมินโอกาส...','กำลังสรุปผล...'];
  let stepIdx=0;
  const stepEl=document.getElementById('kam-loading-step');
  const stepTimer=setInterval(()=>{
    stepIdx=(stepIdx+1)%steps.length;
    if(stepEl){stepEl.style.opacity='0';setTimeout(()=>{if(stepEl){stepEl.textContent=steps[stepIdx];stepEl.style.opacity='1';}},150);}
  },1800);
  const ctx=buildKamContext();
  const sp=ctx.spend;
  const om=ctx.outletMovement;
  const sm=ctx.skuMovement;
  const op=ctx.opportunities;
  const allHigh=OPPS.filter(o=>getAlt(o).conf==='high');
  const top3Opps=OPPS.slice(0,3).map(o=>{const a=getAlt(o);return o.curName+'→'+a.altName+' ('+fmt(a.save)+'/เดือน)';});
  const hist=D.history.length?D.history:[];
  const last=hist[hist.length-1]||{s:0};
  const prev=hist[hist.length-2]||null;
  const momChg=prev&&prev.s>0?(last.s-prev.s)/prev.s*100:0;
  const scenarioHint=momChg<-15?'churn_risk':totalAll()>20000?'upsell_opportunity':'healthy_account';
  // ── Materiality filter: only send SKUs with GMV ≥ ฿3000/month ──
  const MAT_THRESHOLD=3000;
  const skuCtx=sm?{
    new:sm.newSkus.filter(s=>s.gmv>=MAT_THRESHOLD).map(s=>s.name+' ('+fmt(s.gmv)+')'),
    dropped:sm.droppedSkus.filter(s=>s.gmv>=MAT_THRESHOLD).map(s=>s.name+' ('+fmt(s.gmv)+')'),
    growing:sm.growing.filter(s=>s.gmv>=MAT_THRESHOLD).map(s=>s.name+' +'+s.changePct+'%'),
    declining:sm.declining.filter(s=>s.gmv>=MAT_THRESHOLD).map(s=>s.name+' '+s.changePct+'%'),
    period:sm.compareMo+'→'+sm.recentMo
  }:null;
  // v135: Olive-first architecture
  const sys=OLIVE_BASE+`

-- TASK CONTEXT --
A KAM is reviewing last month's performance before a visit. Help them understand what actually happened and what it means for the conversation they're about to have — not just what the numbers were.

Data available: GMV vs prior month, SKU movement (new, dropped, growing, declining), outlet changes, and cost-saving opportunities.

-- OUTPUT CONTRACT --
Output: JSON only — no preamble, no markdown.
schema: {"gmvInsight":"string","outletInsight":"string|null","skuInsight":"string","costInsight":"string","summary":"string"}

Each field: translate what the signal means for this restaurant, then tell the KAM exactly what to ask or do. Two sentences is the ceiling — not because of a rule, but because a sharp briefing doesn't need more.

Guardrails:
- outletInsight: null if no outlet movement.
- SKU materiality threshold: ≥ ฿3,000/month. Below that — omit.
- When naming a SKU, always include ฿ amount — not %.
- costInsight = cost reduction opportunity for the restaurant, not a sales pitch.
- summary: 2-3 sentences — what the KAM should do when they walk in. Action, not recap.
- Don't repeat numbers already visible in the UI.`;
  const slimCtx={
    account:{name:ctx.account.name},
    spend:{current:fmt(sp.current),month:sp.month,orders:sp.orders,momChange:sp.momChangePct!=null?sp.momChangePct+'%':null,prevMonth:sp.prevMonth},
    topCategories:ctx.topCategories,
    outletMovement:om?{new:om.newOutlets.map(o=>o.name||o.outlet_name),dropped:om.droppedOutlets.map(o=>o.name||o.outlet_name),period:om.prevMo+'→'+om.recentMo}:null,
    skuMovement:skuCtx,
    opportunities:{note:'โอกาสลดต้นทุน ไม่ใช่โอกาสขาย',total:op.total,highConf:allHigh.length,totalSaveMo:fmt(op.totalSaveMo),top3:top3Opps}
  };
  const userMsg=`ข้อมูลเดือนที่แล้ว:\n${JSON.stringify(slimCtx,null,1)}\n\nวิเคราะห์แต่ละ section ด้วย 2 ประโยค ตอบ JSON เท่านั้น`;
  try{
    const txt=await callAI(kamModel==='sonnet'?'sonnet':'haiku',sys,[{role:'user',content:userMsg}],1500);
    if(!txt){console.error('LM empty response');throw new Error('Empty response');}
    // Find outermost JSON object by brace-scanning raw text — handles markdown fences anywhere
    let st=-1,en=-1,depth=0;
    for(let i=0;i<txt.length;i++){
      if(txt[i]==='{'){if(depth===0)st=i;depth++;}
      else if(txt[i]==='}'){depth--;if(depth===0){en=i;break;}}
    }
    if(st===-1||en===-1){console.error('LM response (no JSON found):',txt.slice(0,500));throw new Error('No JSON');}
    let brief;
    try{brief=JSON.parse(txt.slice(st,en+1));}
    catch(e2){
      try{brief=JSON.parse(txt.slice(st,en+1).replace(/[\x00-\x1f]/g,' '));}
      catch(e3){console.error('LM parse fail:',txt.slice(st,en+1).slice(0,300));throw e3;}
    }
    // Inject per-card insights (consistent wrapper — same as v51 injectInsight)
    const injectInsight=(id,text)=>{
      const el=document.getElementById(id);if(!el)return;
      if(!text){el.style.display='none';return;}
      const parts=text.split(/(?<=[.!?])\s+(?=[ก-ฮ])/);
      const obs=parts[0]||text;const act=parts[1]||'';
      el.innerHTML=`<div class="kam-dc-insight-inner"><svg class="kam-dc-insight-star" width="10" height="10" viewBox="0 0 10 10" fill="rgba(100,170,255,.7)"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg><div><span class="kam-dc-insight-text">${obs}</span>${act?`<div class="kam-dc-insight-action">${act}</div>`:''}</div></div>`;
      el.style.display='';
    };
    injectInsight('dc-insight-gmv',brief.gmvInsight);
    injectInsight('dc-insight-sku',brief.skuInsight);
    injectInsight('dc-insight-cost',brief.costInsight);
    const outEl=document.getElementById('dc-insight-outlet');
    if(outEl){if(brief.outletInsight)injectInsight('dc-insight-outlet',brief.outletInsight);else outEl.style.display='none';}
    // Bottom summary card
    const existingSum=document.getElementById('dc-lm-summary-card');
    if(existingSum)existingSum.remove();
    if(brief.summary){
      const sumCard=document.createElement('div');
      sumCard.className='kam-dc';sumCard.id='dc-lm-summary-card';
      sumCard.innerHTML=`<div class="kam-dc-head"><span class="kam-dc-head-label">สรุปก่อนเข้าเยี่ยม</span></div><div class="kam-dc-body"><div style="font-size:12px;color:rgba(220,235,255,.85);line-height:1.75">${brief.summary}</div></div>`;
      lmSec.appendChild(sumCard);
    }
    clearInterval(stepTimer);
    if(loading)loading.style.display='none';
    if(btn)btn.classList.remove('loading');
    if(insLabel)insLabel.textContent=_getSummaryInsightLabel(true);
    if(btn)btn.classList.add('done');
  }catch(e){
    clearInterval(stepTimer);
    if(loading)loading.style.display='none';
    if(btn)btn.classList.remove('loading');
    if(insLabel)insLabel.textContent=_getSummaryInsightLabel(false);
    if(btn)btn.classList.remove('done');
    console.error('Last month summary error:',e);
  }
}

async function generateTalklines(){
  const btn=document.getElementById('kam-talkline-btn');
  const card=document.getElementById('kam-talkline-card');
  const body=document.getElementById('kam-talkline-body');
  const tlLoading=document.getElementById('kam-tl-loading');
  // Show loading skeleton, hide button
  if(btn){btn.style.display='none';}
  if(tlLoading)tlLoading.style.display='block';
  if(card)card.style.display='none';
  const ctx=buildKamContext();
  const tlChurnGone=computeChurnSignals().filter(s=>s.type==='gone'&&s.gmv>2000).slice(0,3).map(s=>s.name);
  const tlPace=D.current_month?computePaceSignal(D.current_month,D.history):null;
  const tlPaceSig=tlPace?`${tlPace.pct}% (${tlPace.label})`:'ไม่ทราบ';
  const tlMissingCats=(portviewBulkData.find(r=>r.id===(D.meta.accountId||currentAccountId))?.missingCats||'').split(' | ').filter(Boolean).slice(0,2);
  const situation=tlPace&&tlPace.cls==='danger'?'pace_danger':tlChurnGone.length>0?'sku_churn':tlMissingCats.length>0?'cat_gap':totalAll()>15000?'has_opportunity':'healthy';

  const sys=OLIVE_BASE+`

-- TASK CONTEXT --
A KAM needs 3 real conversation starters before walking into this account. Not scripts. Not statements. Openers that would actually start a natural conversation with a restaurant owner or manager — someone who's busy, a bit guarded, and can tell immediately if you're reading from a playbook.

The account situation is: ${situation}
Let that shape which angle matters most. But make each line feel like a person talking, not a format being filled.

-- OUTPUT CONTRACT --
Output: JSON only — no preamble, no markdown.
schema: {"talklines":["string","string","string"]}

Rules:
- Every line must open a dialogue, not close it.
- Sound like a person talking, not a sales rep reading a script.
- Don't lead with numbers, and never say "ยอดซื้อลดลง" directly — consultative angle only.
- Gender-neutral Thai — do not start with gendered first-person pronouns.
- Situation priority:
  pace_danger → line 1 asks why volume dropped, nothing else first — ไม่ใช่ขายของ
  sku_churn → line 1 opens on menu or supplier naturally
  cat_gap → line 1 asks if they still buy that category, and where
  has_opportunity → cost angle comes after warmup, not first
  healthy → menu, upcoming events, or expansion`;

  const slimCtx={
    account:ctx.account,
    spend:{current:fmt(ctx.spend.current),momChange:ctx.spend.momChangePct},
    pace:tlPaceSig,
    skuChurnGone:tlChurnGone.length?tlChurnGone:null,
    categoryGap:tlMissingCats.length?tlMissingCats:null,
    skuHighlight:ctx.skuMovement?{new:ctx.skuMovement.newSkus.slice(0,2).map(s=>s.name),dropped:ctx.skuMovement.droppedSkus.slice(0,2).map(s=>s.name)}:null,
    opportunities:{total:ctx.opportunities.total,totalSaveMo:fmt(ctx.opportunities.totalSaveMo),top:ctx.opportunities.top3[0]}
  };
  try{
    const txt=(await callAI(kamModel==='sonnet'?'sonnet':'haiku',sys,[{role:'user',content:`ข้อมูล:\n${JSON.stringify(slimCtx)}\n\nสร้าง 3 แนวทางสนทนา`}],600)).replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'').trim();
    const st=txt.indexOf('{'),en=txt.lastIndexOf('}');
    if(st===-1||en===-1)throw new Error('No JSON');
    const result=JSON.parse(txt.slice(st,en+1));
    if(body&&result.talklines){
      // Gender-neutral post-processing: remove common gendered words
      const neutralize=t=>t.replace(/^(?:ผม(?:จะ|ได้|เห็น|พบ|แนะนำ)|\u0e14\u0e34\u0e09\u0e31\u0e19(?:จะ)?)[\s:：-]*/,'').replace(/ครับผม$/,'ครับ').trim();
      body.innerHTML=result.talklines.map((t,i)=>`<div class="kam-talkline-item"><div class="kam-talkline-num">${i+1}</div><div class="kam-talkline-text">${neutralize(t)}</div></div>`).join('');
    }
    if(tlLoading)tlLoading.style.display='none';
    if(card)card.style.display='block';
    if(btn){btn.classList.remove('loading');btn.style.display='flex';btn.innerHTML='';
      const star=document.createElementNS('http://www.w3.org/2000/svg','svg');star.setAttribute('width','10');star.setAttribute('height','10');star.setAttribute('viewBox','0 0 10 10');star.innerHTML='<path fill="currentColor" d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/>';
      btn.appendChild(star);btn.appendChild(document.createTextNode(' สร้างใหม่'));
    }
  }catch(e){
    console.error('Talkline error:',e);
    if(tlLoading)tlLoading.style.display='none';
    if(btn){btn.classList.remove('loading');btn.style.display='flex';}
  }
}

// ════════════════════════════════════════
// INSIGHT BUTTON LABEL HELPERS
// ════════════════════════════════════════
function _getInsightMonthLabel(){
  // Returns short English month of last ended month e.g. "Apr"
  const hist=D&&D.history?D.history:[];
  if(!hist.length)return null;
  const lastM=hist[hist.length-1].m||''; // e.g. "เม.ย. 2569"
  const map={'ม.ค.':'Jan','ก.พ.':'Feb','มี.ค.':'Mar','เม.ย.':'Apr','พ.ค.':'May',
             'มิ.ย.':'Jun','ก.ค.':'Jul','ส.ค.':'Aug','ก.ย.':'Sep',
             'ต.ค.':'Oct','พ.ย.':'Nov','ธ.ค.':'Dec'};
  const moTh=lastM.split(' ')[0];
  return map[moTh]||null;
}

function _getSummaryInsightLabel(done=false){
  return done?'✓ Brief พร้อมแล้ว':'Brief';
}

function _refreshInsightBtnLabel(){
  const lbl=document.getElementById('kam-insight-btn-label');
  const btn=document.getElementById('kam-insight-btn');
  if(!lbl)return;
  if(kamSubtab==='lastmonth'){
    lbl.textContent='Brief';
    if(btn){btn.classList.remove('done');btn.classList.remove('kav-brief-btn-done');}
  } else {
    const isDone=!!(kamStateCache&&kamStateCache.accountId===currentAccountId);
    lbl.textContent=isDone?'✓ Brief พร้อมแล้ว':'Brief';
    if(btn){btn.classList.toggle('done',isDone);}
  }
}

// ════════════════════════════════════════
// KAM Insight — No-account empty state
// ════════════════════════════════════════
function _hasRealAccount(){
  if(!currentAccountId||currentAccountId==='default')return false;
  if(typeof portviewBulkData!=='undefined'&&portviewBulkData&&portviewBulkData.length>0){
    return !!portviewBulkData.find(r=>r.id===currentAccountId);
  }
  // Single-account local mode: real if has history
  return !!(D&&D.history&&D.history.length>0);
}

function _renderKamNoAcctState(){
  if(!isKAM)return false;
  const noAcct=!_hasRealAccount();
  const noAcctEl=document.getElementById('kam-no-acct-state');
  const acctSticky=document.getElementById('kam-acct-sticky');
  const signalBar=document.getElementById('kam-signal-bar');
  const kamCards=document.getElementById('kam-cards');
  const lastMo=document.getElementById('kam-lastmonth-section');
  const talkWrap=document.getElementById('kam-talkline-wrap');
  const emptyState=document.getElementById('kam-empty-state');
  const kamLoad=document.getElementById('kam-loading2');
  if(noAcct){
    if(acctSticky)acctSticky.style.display='none';
    if(signalBar)signalBar.style.display='none';
    if(kamCards)kamCards.style.display='none';
    if(lastMo)lastMo.style.display='none';
    if(talkWrap)talkWrap.style.display='none';
    if(emptyState)emptyState.style.display='none';
    if(kamLoad)kamLoad.style.display='none';
    if(noAcctEl)noAcctEl.style.display='block';
    _renderKnaRecentList();
    return true;
  } else {
    if(acctSticky)acctSticky.style.display='';
    if(signalBar)signalBar.style.display='';
    if(noAcctEl)noAcctEl.style.display='none';
    return false;
  }
}

function _renderKnaRecentList(){
  const wrap=document.getElementById('kna-recent-wrap');
  const list=document.getElementById('kna-recent-list');
  if(!wrap||!list)return;
  if(typeof portviewBulkData==='undefined'||!portviewBulkData||!portviewBulkData.length){
    wrap.style.display='none';return;
  }
  const email=(currentUserProfile&&currentUserProfile.email)||'local';
  const vm=getVisitMap(email);
  const visits=Object.entries(vm)
    .map(([id,v])=>{
      const acct=portviewBulkData.find(r=>r.id===id);
      if(!acct)return null;
      return{id,name:acct.name,lastSeen:v.lastSeen||0};
    })
    .filter(Boolean)
    .sort((a,b)=>b.lastSeen-a.lastSeen)
    .slice(0,3);
  if(visits.length===0){wrap.style.display='none';return;}
  wrap.style.display='block';
  list.innerHTML=visits.map(v=>`<button class="kna-recent-card" onclick="portviewSelectAccount('${v.id}')"><span style="font-size:12px;font-weight:600;color:rgba(255,255,255,.85);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0">${v.name}</span><span style="font-size:14px;color:rgba(255,255,255,.3);flex-shrink:0">›</span></button>`).join('');
}

// ── navPortHome: "พอร์ต" home button — routes to portview (KAM context) or scr-portfolio (standalone) ──
function navPortHome(){
  const controller = window.FreshketSenseNavigationRuntime;
  if(controller && typeof controller.navPortHomeFromLegacy === 'function'){
    try{
      return controller.navPortHomeFromLegacy({
        isKAM: (typeof isKAM !== 'undefined' ? isKAM : false),
        currentAccountId: (typeof currentAccountId !== 'undefined' ? currentAccountId : null),
        currentUserProfile: (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null),
        senseActivated: (typeof senseActivated !== 'undefined' ? senseActivated : false),
        legacy: { navPortHome: __legacyNavPortHomeFallback }
      });
    }catch(e){
      console.warn('navPortHome navigation controller failed, falling back to legacy navigation', e);
    }
  }
  return __legacyNavPortHomeFallback();
}

function __legacyNavPortHomeFallback(){
  if(typeof portviewBulkData!=='undefined'&&portviewBulkData&&portviewBulkData.length>0){
    // KAM user — always go to portview (home)
    if(!isKAM)setMode('kam');
    showScreen('portview');
  } else {
    // Pure standalone restaurant owner — go to SKU portfolio
    showScreen('portfolio');
  }
}

function setMode(mode){
  const controller = window.FreshketSenseNavigationRuntime;
  if(controller && typeof controller.setModeFromLegacy === 'function'){
    try{
      return controller.setModeFromLegacy({
        isKAM: (typeof isKAM !== 'undefined' ? isKAM : false),
        currentAccountId: (typeof currentAccountId !== 'undefined' ? currentAccountId : null),
        currentUserProfile: (typeof currentUserProfile !== 'undefined' ? currentUserProfile : null),
        senseActivated: (typeof senseActivated !== 'undefined' ? senseActivated : false),
        legacy: { setMode: __legacySetModeFallback }
      }, mode);
    }catch(e){
      console.warn('setMode navigation controller failed, falling back to legacy navigation', e);
    }
  }
  return __legacySetModeFallback(mode);
}

function __legacySetModeFallback(mode){
  // Guard: cannot enter restaurant mode without a selected account
  if(mode==='restaurant'&&(!currentAccountId||currentAccountId==='default'))return;
  // Track restaurant mode visit
  if(mode==='restaurant'&&isKAM&&currentAccountId)trackVisit(currentAccountId,'restaurant');
  // ── v55 Issue 3 fix: cleanup portview/teamview state on mode change ──
  // Mode change invalidates portview drill-down context: remove return FAB,
  // reset return flag, and exit portview/teamview screens when leaving KAM mode.
  const _modeChanged=(mode==='kam')!==isKAM;
  if(_modeChanged){
    const _fab=document.getElementById('portview-return-fab');
    if(_fab)_fab.remove();
    window._returnToPortview=false;
    if(mode!=='kam'){
      const _portScr=document.getElementById('scr-portview');
      const _teamScr=document.getElementById('scr-teamview');
      if((_portScr&&_portScr.classList.contains('on'))||(_teamScr&&_teamScr.classList.contains('on'))){
        showScreen('overview');
      }
      teamviewKamFilter=null;teamviewAiDone=false;
    }
  }
  isKAM=mode==='kam';
  // Sliding pill on mode toggle
  const _modeToggleEl=document.querySelector('.mode-toggle');
  if(_modeToggleEl)_modeToggleEl.classList.toggle('kam-active',isKAM);
  // IQ badge pulse on KAM mode entry
  if(isKAM){
    const iqB=document.querySelector('header .iq-badge, .topbar .iq-badge, .iq-badge');
    if(iqB){iqB.classList.remove('iq-pulse');void iqB.offsetWidth;iqB.classList.add('iq-pulse');iqB.addEventListener('animationend',()=>iqB.classList.remove('iq-pulse'),{once:true});}
  }
  // Apply/remove dark KAM theme
  document.body.classList.toggle('kam-mode',isKAM);
  try{localStorage.setItem('sense_mode',mode);}catch(e){}
  // Swap nav label + icon: ภาพรวม/home ↔ พอร์ต/grid
  const ovLabel=document.getElementById('nav-overview-label');
  if(ovLabel)ovLabel.textContent=isKAM?'พอร์ต':'ภาพรวม';
  const icoNonKam=document.querySelector('#nav-overview .ico-non-kam');
  const icoKam=document.querySelector('#nav-overview .ico-kam');
  if(icoNonKam)icoNonKam.style.display=isKAM?'none':'';
  if(icoKam)icoKam.style.display=isKAM?'':'none';
  // Show Team tab for TL/admin only
  const isTL=currentUserProfile&&(currentUserProfile.role==='tl'||currentUserProfile.role==='admin');
  const _isSales=typeof isSalesAny==='function'&&isSalesAny(currentUserProfile&&currentUserProfile.role);
  const _isSalesTL=typeof isSalesTLRole==='function'&&isSalesTLRole(currentUserProfile&&currentUserProfile.role);
  // Add tl-mode class for 3-col grid + Team tab visibility (CSS .tl-only handles display)
  document.body.classList.toggle('tl-mode',isKAM&&isTL);
  // Sales body classes — controls Sales-specific nav/content visibility
  document.body.classList.toggle('sales-mode',_isSales);
  document.body.classList.toggle('sales-tl-mode',isKAM&&_isSalesTL);
  // v183: Show Team button in portview header for TL/Admin only
  const _portviewTeamBtn = document.getElementById('portview-team-btn');
  if (_portviewTeamBtn) _portviewTeamBtn.style.display = (isTL||_isSalesTL) ? 'flex' : 'none';
  const _portviewTgtBtn = document.getElementById('portview-target-btn');
  if (_portviewTgtBtn) {
    _portviewTgtBtn.style.display = (isTL||_isSalesTL) ? 'flex' : 'none';
    // Store mode so button knows admin vs tl
    window._tgtAdminMode = (currentUserProfile && currentUserProfile.role === 'admin') ? 'admin' :
                           (_isSalesTL ? 'sales_tl' : 'tl');
  }
  // v183: Sync bnav disabled state
  if (typeof _updateKamNavDisabled === 'function') _updateKamNavDisabled();
  // Teamview screen
  const teamScr=document.getElementById('scr-teamview');
  if(teamScr)teamScr.style.display='none'; // reset on mode change
  document.querySelectorAll('.mbtn').forEach((b,i)=>b.classList.toggle('on',(i===0&&!isKAM)||(i===1&&isKAM)));

  document.getElementById('kamsec').style.display='none';
  document.getElementById('hid').style.display=isKAM?'block':'none';
  // Switch between restaurant and KAM overview
  const restOv=document.getElementById('rest-overview');
  const kamOv=document.getElementById('kam-overview');
  const scoreSec=document.getElementById('score-sec');
  if(restOv)restOv.style.display=isKAM?'none':'block';
  if(kamOv)kamOv.style.display=isKAM?'block':'none';
  // Score card hidden from overview — gate screen handles score reveal
  if(scoreSec)scoreSec.style.display='none';
  renderHeroKAM();
  // Show/hide topbar model badge
  const kamModelTopbar=document.getElementById('kam-model-topbar');
  if(kamModelTopbar)kamModelTopbar.style.display='none';
  // Navigate to overview when entering KAM
  if(isKAM){
    // Always force-hide plan builder footer when entering KAM
    const _footer=document.getElementById('pb-footer');
    if(_footer)_footer.classList.add('hidden');
    showScreen('overview');
    // ── No-account empty state takes priority ──
    if(_renderKamNoAcctState())return; // skip rest of render — empty state owns the screen
    const kamCards=document.getElementById('kam-cards');
    const kamLoad=document.getElementById('kam-loading2');
    const kamEmpty=document.getElementById('kam-empty-state');
    const talkWrap=document.getElementById('kam-talkline-wrap');
    const hasData=D.history.length>0||OPPS.length>0;
    if(kamEmpty)kamEmpty.style.display=hasData?'none':'block';
    if(kamLoad)kamLoad.style.display='none';
    // Render signal bar always
    renderKamSignalBar();
    // Restore from cache if same account, else render fresh
    if(kamStateCache.accountId===currentAccountId&&kamStateCache.html){
      if(kamCards){kamCards.innerHTML=kamStateCache.html;kamCards.style.display='block';}
      if(talkWrap)talkWrap.style.display='block';
      const insBtn=document.getElementById('kam-insight-btn');
      const insLabel=document.getElementById('kam-insight-btn-label');
      if(insBtn){insBtn.classList.remove('loading');insBtn.classList.add('done');}
      if(insLabel)insLabel.textContent=_getSummaryInsightLabel(true);
    } else if(hasData){
      // Show rule-based data immediately
      renderKamOverview();
      if(kamCards)kamCards.style.display='block';
      if(talkWrap)talkWrap.style.display='none';
    }
    // ── Restore subtab state — must come LAST to override kamCards show/hide above ──
    setKamSubtab(kamSubtab);
  } else {
    // ── Entering restaurant mode — refresh view with current account's D data ──
    applyMeta();
    refreshAll();
    showScreen('overview');
  }
}

// ════════════════════════════════════════
// AI CHAT
// ════════════════════════════════════════
// SECTION:AI_CHAT
function buildChatSuggestions(){
  const suggs=[];
  // From opportunities
  if(OPPS.length>0){
    const top=[...OPPS].sort((a,b)=>getAlt(b).save-getAlt(a).save)[0];
    const a=getAlt(top);
    suggs.push({label:`เริ่มที่ ${top.curName.slice(0,14)}... ดีไหม?`,q:`ถ้าจะเริ่มเปลี่ยน ${top.curName} เป็น ${a.altName} ประหยัด ${fmt(a.save)}/เดือน มีอะไรควรระวังบ้าง?`});
  }
  // From MoM trend
  const hist=D.history.length?D.history:[];
  if(hist.length>=2){
    const last=hist[hist.length-1],prev=hist[hist.length-2];
    const chg=prev.s>0?(last.s-prev.s)/prev.s*100:0;
    if(Math.abs(chg)>=8){
      const dir=chg>0?'เพิ่มขึ้น':'ลดลง';
      suggs.push({label:`ทำไมยอด${dir} ${Math.abs(chg).toFixed(0)}%?`,q:`ยอดซื้อ ${last.m} ${dir} ${Math.abs(chg).toFixed(0)}% จาก ${prev.m} — เหตุผลที่เป็นไปได้คืออะไร?`});
    }
  }
  // From top category
  const topCat=(D.cats.length?D.cats:[])[0];
  if(topCat)suggs.push({label:`ลดต้นทุน ${topCat.n} ได้ยังไง?`,q:`หมวด ${topCat.n} ใช้จ่าย ${fmt(topCat.s)}/เดือน (${topCat.p}%) มีวิธีลดต้นทุนได้บ้างไหม?`});
  // Mode-specific suggestions: make AI Chat usable beyond the current account
  const activeScreen=(typeof getActiveScreenName==='function')?getActiveScreenName():'';
  if(isKAM){
    if(activeScreen==='teamview'){
      suggs.unshift({label:'ทีมควรโฟกัสใครก่อน?',q:'จากภาพรวมทีม KAM คนไหนควรได้รับ support หรือ coaching ก่อน และเพราะอะไร?'});
    } else if(activeScreen==='portview'){
      suggs.unshift({label:'พอร์ตควรโทรหาใครก่อน?',q:'จากภาพรวมพอร์ต ช่วยจัดลำดับลูกค้าที่ควรติดต่อก่อนวันนี้ พร้อมเหตุผลและคำถามเปิดบทสนทนา'});
    } else if(typeof portviewBulkData!=='undefined'&&portviewBulkData&&portviewBulkData.length){
      suggs.push({label:'ดูภาพรวมพอร์ต',q:'สรุปภาพรวมพอร์ตตอนนี้ให้หน่อย ร้านไหนเสี่ยงสุด และควรเริ่ม follow-up ใครก่อน?'});
    }
    suggs.push({label:'สรุปไปคุยลูกค้า',q:'สรุปประเด็นสำคัญที่ควรพูดถึงเมื่อไปเยี่ยมลูกค้ารายนี้ ให้กระชับ ใช้ข้อมูลจริง'});
  } else {
    suggs.push({label:'สรุปสั้นๆ ให้เจ้าของฟัง',q:'สรุปโอกาสลดต้นทุนของร้านให้เข้าใจง่าย ไม่ต้องมีศัพท์เทคนิค'});
  }
  return suggs.slice(0,4);
}

function toggleChat(){if(window.__aifabDragSuppress){window.__aifabDragSuppress=false;return;}chatOpen?closeChat():openChat();}
function openChat(){
  chatOpen=true;
  document.getElementById('aipanel').classList.add('open');
  document.getElementById('overlay').classList.add('on');
  document.getElementById('aifab').classList.add('open');
  // F2: Update suggestions dynamically
  const suggs=buildChatSuggestions();
  const suggEl=document.getElementById('aisugg');
  if(suggEl){
    suggEl.style.display='flex';
    suggEl.innerHTML=suggs.map(s=>`<button class="sgbtn" onclick="askQ(${JSON.stringify(s.q)})">${s.label}</button>`).join('');
  }
  // F3: Update subtitle based on mode (header name is always Olive)
  const aist=document.getElementById('aist-sub')||document.querySelector('.aist');
  if(aist)aist.textContent=isKAM?'● ผู้ช่วย KAM · วิเคราะห์บัญชีลูกค้า':'● ผู้ช่วยวิเคราะห์ต้นทุนร้านคุณ';
  // F4: Update Olive intro message with current account context
  const introMsg=document.getElementById('chat-intro-msg');
  if(introMsg){
    const _an=(D&&D.meta&&D.meta.accountName&&
      currentAccountId&&currentAccountId!=='default'&&!currentAccountId.startsWith('sample_'))
      ? D.meta.accountName : '';
    const txt=isKAM&&_an
      ?`สวัสดีค่ะ <strong>Olive</strong> พร้อมช่วยวิเคราะห์บัญชีลูกค้า <strong>${_an}</strong><br><br>วันนี้อยากให้ช่วยดูประเด็นไหนเป็นพิเศษคะ`
      :isKAM
      ?`สวัสดีค่ะ <strong>Olive</strong> พร้อมช่วยวิเคราะห์บัญชีลูกค้าจาก Freshket<br><br>เลือกร้านที่พอร์ตก่อน แล้ว Olive จะวิเคราะห์ให้เลยค่ะ`
      :`สวัสดีค่ะ <strong>Olive</strong> พร้อมช่วยวิเคราะห์ต้นทุนจาก Freshket<br><br>วิเคราะห์ข้อมูลต้นทุนร้านคุณ และช่วยวางแผนลดต้นทุนได้เลยค่ะ`;
    introMsg.querySelector('.mb').innerHTML=txt;
  }
}
function closeChat(){chatOpen=false;document.getElementById('aipanel').classList.remove('open');document.getElementById('overlay').classList.remove('on');document.getElementById('aifab').classList.remove('open');}

function initChatFabDrag(){
  const fab=document.getElementById('aifab');
  if(!fab||fab.dataset.dragInit==='1')return;
  fab.dataset.dragInit='1';
  const key=(window.FreshketSenseConfig&&window.FreshketSenseConfig.storage&&window.FreshketSenseConfig.storage.chatFabPositionKey)||'fs_aifab_pos_v1';
  function clamp(x,y){
    const pad=10;
    const r=fab.getBoundingClientRect();
    const w=r.width||54,h=r.height||54;
    const vw=window.innerWidth||440,vh=window.innerHeight||700;
    return {x:Math.max(pad,Math.min(x,vw-w-pad)),y:Math.max(pad,Math.min(y,vh-h-pad))};
  }
  function setPos(x,y,persist){
    const p=clamp(x,y);
    fab.style.left=p.x+'px';
    fab.style.top=p.y+'px';
    fab.style.right='auto';
    fab.style.bottom='auto';
    fab.classList.add('moved');
    if(persist){try{localStorage.setItem(key,JSON.stringify(p));}catch(e){}}
  }
  try{
    const saved=JSON.parse(localStorage.getItem(key)||'null');
    if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))setPos(saved.x,saved.y,false);
  }catch(e){}
  let startX=0,startY=0,origX=0,origY=0,dragging=false,moved=false,pid=null;
  fab.addEventListener('pointerdown',e=>{
    if(e.button!==undefined&&e.button!==0)return;
    const r=fab.getBoundingClientRect();
    startX=e.clientX;startY=e.clientY;origX=r.left;origY=r.top;
    dragging=true;moved=false;pid=e.pointerId;
    if(fab.setPointerCapture)fab.setPointerCapture(pid);
    fab.classList.add('dragging');
  },{passive:false});
  fab.addEventListener('pointermove',e=>{
    if(!dragging)return;
    const dx=e.clientX-startX,dy=e.clientY-startY;
    if(Math.abs(dx)+Math.abs(dy)>6)moved=true;
    if(moved){e.preventDefault();setPos(origX+dx,origY+dy,false);}
  },{passive:false});
  function endDrag(){
    if(!dragging)return;
    dragging=false;fab.classList.remove('dragging');
    try{if(fab.releasePointerCapture&&pid!==null)fab.releasePointerCapture(pid);}catch(e){}
    if(moved){
      const r=fab.getBoundingClientRect();
      setPos(r.left,r.top,true);
      window.__aifabDragSuppress=true;
      setTimeout(()=>{window.__aifabDragSuppress=false;},260);
    }
  }
  fab.addEventListener('pointerup',endDrag);
  fab.addEventListener('pointercancel',endDrag);
  window.addEventListener('resize',()=>{
    if(!fab.classList.contains('moved'))return;
    const r=fab.getBoundingClientRect();
    setPos(r.left,r.top,true);
  });
}

function askQ(q){document.getElementById('aiinput').value=q;sendChat();}
function addMsg(role,txt,loading=false){const msgs=document.getElementById('aimsgs');const d=document.createElement('div');d.className=`msg ${role}`;d.innerHTML=`<div class="mb ${loading?'ld':''}">${txt}</div>`;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d;}

// ── AI CHAT SCOPE + CONTEXT ROUTER ───────────────────
function getActiveScreenName(){
  const el=document.querySelector('.scr.on');
  return el&&el.id?el.id.replace(/^scr-/,''):'overview';
}

function chatHasPortfolioData(){
  try{return !!(typeof getPortviewAccounts==='function'&&getPortviewAccounts().length>0);}catch(e){return false;}
}
function chatHasTeamData(){
  try{return !!(typeof _buildKamGroups==='function'&&_buildKamGroups().length>0);}catch(e){return false;}
}

function detectChatIntent(q){
  const text=String(q||'').toLowerCase();
  if(/(gmv|ยอด|ยอดขาย|ยอดซื้อ|spend|sales).*(สูงสุด|เยอะสุด|มากสุด|top|อันดับ|ranking|rank)|ร้านไหน.*(gmv|ยอด|ยอดซื้อ|ยอดขาย).*(เยอะ|สูง|มาก)|top\s*account|top\s*customer/.test(text))return 'top_gmv';
  if(/ใครก่อน|โทรหาใคร|priority|prioritize|จัดลำดับ|follow.?up|ติดต่อลูกค้า|action วันนี้|วันนี้ควร/.test(text))return 'priority';
  if(/ทีม|team|tl|หัวหน้าทีม|coach|coaching|support|kam แต่ละคน|แต่ละ kam/.test(text))return 'team_management';
  if(/โอกาส|opportunity|wallet|ขยาย|เพิ่มยอด|upsell|cross.?sell|category เพิ่ม|sku เพิ่ม|penetration|growth/.test(text))return 'opportunity';
  if(/ทำไม|root cause|diagnose|วิเคราะห์|เกิดอะไร|สาเหตุ|ลด|ตก|หาย|risk|เสี่ยง/.test(text))return 'diagnosis';
  if(/สรุป|brief|ควรรู้|overview|ภาพรวม|เล่าให้ฟัง/.test(text))return 'summary';
  return 'general';
}

function detectChatScope(q){
  const text=String(q||'').toLowerCase();
  const intent=detectChatIntent(q);
  const hasPortfolio=chatHasPortfolioData();
  const hasTeam=chatHasTeamData();

  // Query intent should beat current screen. Chat is a co-pilot, not a screen reader.
  if(intent==='top_gmv'&&hasPortfolio)return 'portfolio';
  if(/ทีม|team|tl|หัวหน้าทีม|kam แต่ละคน|แต่ละ kam|เซลล์แต่ละคน|sales แต่ละคน|โค้ช|coach|support/.test(text))return hasTeam?'team':'portfolio';
  if(/พอร์ต|portfolio|ภาพรวมทั้งหมด|ร้านทั้งหมด|ลูกค้าทั้งหมด|บัญชีทั้งหมด|account ทั้งหมด|accounts ทั้งหมด|ใครก่อน|โทรหาใคร|priority|prioritize|จัดลำดับ|at[- ]?risk|เสี่ยงทั้งหมด|ร้านไหน/.test(text))return hasPortfolio?'portfolio':'account';
  if(/ร้านนี้|บัญชีนี้|ลูกค้ารายนี้|account นี้|sku|สินค้า|ต้นทุน|ประหยัด|หมวด|category|สั่งซื้อ|ออเดอร์|สเปค|ราคา/.test(text))return 'account';

  const screen=getActiveScreenName();
  if(screen==='teamview'&&hasTeam)return 'team';
  if(screen==='portview'&&hasPortfolio)return 'portfolio';
  return 'account';
}

function fmtChatK(n){return n>=1000000?'฿'+(n/1000000).toFixed(1)+'M':n>=1000?'฿'+Math.round(n/1000)+'K':'฿'+Math.round(n).toLocaleString('th-TH');}
function pctChat(n){return Number.isFinite(n)?Math.round(n)+'%':'n/a';}
function chatMoneyValue(a){
  const ps=a&&a.paceSignal||{};
  return {
    current:Number(a&&a.gmvToDate||ps.gmvToDate||0),
    runrate:Number(a&&a.runrate||ps.runrate||0),
    last:Number(a&&a.lastGmv||ps.lastGmv||0),
    baseline:Number(ps.baselineGmv||ps.expected||0)
  };
}
function chatAccountName(a){return (a&&a.name)||'ไม่ทราบชื่อร้าน';}

function buildAccountChatContext(){
  const _an=D.meta.accountName||document.getElementById('acct-name-input')?.value.trim()||'ร้านอาหารของคุณ';
  const _skus=Array.isArray(D.skus)?D.skus:[];
  const _cats=Array.isArray(D.cats)?D.cats:[];
  const _hist=Array.isArray(D.history)?D.history:[];
  const _hasRealSkus=_skus.length>0;
  const _hasRealCats=_cats.length>0;
  const _hasRealHistory=_hist.length>0;
  const _hasMonthlySkus=!!(D.skus_monthly&&Object.keys(D.skus_monthly).length>=2);
  const _senseMetricsChat=getSenseScoreMetrics();
  const _sp=_senseMetricsChat.savPct;
  const _sc=_senseMetricsChat.score;

  const _trend=_hasRealHistory
    ?_hist.slice(-6).map(h=>h.m+' '+fmt(h.s)+' ('+(h.orders||0)+' ออเดอร์)').join(', ')
    :'ไม่มี monthly history ที่โหลดอยู่ใน session นี้';
  const _catStr=_hasRealCats
    ?_cats.slice(0,8).map(c=>c.n+' '+fmt(c.s)+' ('+c.p+'%)').join(', ')
    :'ไม่มี category breakdown ที่โหลดอยู่ใน session นี้';
  const _skuTop=_hasRealSkus?[..._skus].sort((a,b)=>(b.gmv||b.s||0)-(a.gmv||a.s||0)).slice(0,10):[];
  const _skuStr=_skuTop.length
    ?_skuTop.map((s,i)=>(i+1)+'. '+s.n+' ['+(s.d||'-')+'] '+fmt(s.gmv||s.s||0)+'/ด.'+(s.unit_price?' ฿'+s.unit_price+'/kg':'')).join('\n')+(_skus.length>10?'\n(+'+(_skus.length-10)+' รายการ)':'')
    :'ไม่มี SKU-level data ที่โหลดอยู่ใน session นี้';

  let _skuMovement='ไม่มี SKU monthly movement ที่โหลดอยู่ใน session นี้';
  const _skuMonths=D.skus_monthly&&Object.keys(D.skus_monthly);
  if(_skuMonths&&_skuMonths.length>=2){
    const _cSort=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
    const months=[..._skuMonths].sort((a,b)=>_cSort(b)-_cSort(a)).slice(0,5);
    // v156: skip current MTD month so AI doesn't see false drops
    const _cmLbl5=(D.current_month||{}).month_label||'';
    const lastMo=months.find(m=>m!==_cmLbl5)||months[0];
    const prevMonths=months.filter(m=>m!==lastMo).slice(0,4);
    const lastSet=new Set((D.skus_monthly[lastMo]||[]).map(s=>s.id));
    const prevAllIds=new Set(prevMonths.flatMap(m=>(D.skus_monthly[m]||[]).map(s=>s.id)));
    const newSkus=(D.skus_monthly[lastMo]||[]).filter(s=>!prevAllIds.has(s.id)).sort((a,b)=>(b.gmv||0)-(a.gmv||0)).slice(0,4);
    const prev1Mo=months[1];
    const droppedSkus=(D.skus_monthly[prev1Mo]||[]).filter(s=>!lastSet.has(s.id)).sort((a,b)=>(b.gmv||0)-(a.gmv||0)).slice(0,4);
    const prevAvg={};
    prevMonths.forEach(m=>{(D.skus_monthly[m]||[]).forEach(s=>{if(!prevAvg[s.id])prevAvg[s.id]={sum:0,cnt:0,n:s.n,d:s.d};prevAvg[s.id].sum+=s.qty_kg||0;prevAvg[s.id].cnt++;});});
    const volChanges=(_skus).filter(s=>prevAvg[s.id]&&prevAvg[s.id].cnt>0).map(s=>{const avg=prevAvg[s.id].sum/prevAvg[s.id].cnt;const chg=avg>0?((s.qty_kg||0)-avg)/avg*100:0;return{...s,avgQty:avg,chgPct:chg};}).filter(s=>Math.abs(s.chgPct)>=35).sort((a,b)=>Math.abs(b.chgPct)-Math.abs(a.chgPct)).slice(0,4);
    const newStr=newSkus.length?newSkus.map(s=>'+ '+s.n+' ['+fmt(s.gmv||0)+'/ด. ใน '+lastMo+']').join('\n'):'ไม่มี';
    const dropStr=droppedSkus.length?droppedSkus.map(s=>'- '+s.n+' ['+fmt(s.gmv||0)+'/ด. ใน '+prev1Mo+' แต่ไม่พบใน '+lastMo+']').join('\n'):'ไม่มี';
    const volStr=volChanges.length?volChanges.map(s=>(s.chgPct>0?'↑':'↓')+' '+s.n+' '+s.chgPct.toFixed(0)+'% ('+(s.qty_kg||0).toFixed(1)+'kg vs avg '+s.avgQty.toFixed(1)+'kg)').join('\n'):'ไม่มี';
    _skuMovement=`ช่วง ${months[months.length-1]} – ${lastMo} (${months.length} เดือน; monthly granularity only)\nSKU เพิ่งเริ่มซื้อในเดือนล่าสุดเทียบช่วงก่อนหน้า:\n${newStr}\nSKU ที่ไม่พบในเดือนล่าสุดเทียบเดือนก่อนหน้า:\n${dropStr}\nVolume เปลี่ยนแปลง ≥35%:\n${volStr}`;
  }

  const _ol=OPPS.length
    ?OPPS.slice(0,10).map((o,i)=>{const a=getAlt(o);return(i+1)+'. '+o.curName+' → '+a.altName+': ประหยัด '+fmt(a.save)+'/ด. ('+a.pct+'%, '+(a.conf==='high'?'มั่นใจสูง':'ทดลองก่อน')+')'}).join('\n')+(OPPS.length>10?'\n(+'+(OPPS.length-10)+' opportunities)':'')
    :'ยังไม่มีข้อมูล alternatives ที่โหลดอยู่ใน session นี้';

  return `-- ACCOUNT CONTEXT --\nชื่อ: ${_an}\nค่าใช้จ่ายเดือนล่าสุด: ${fmt(curSpend())}\nCost IQ Score: ${_sc}/100\nเลือกแผนแล้ว: ${fmt(totalSel())}/เดือน (${sel.size} รายการ)\nโอกาสเต็มที่จาก alternatives: ${fmt(totalAll())}/เดือน\nData: monthly_history=${_hasRealHistory?'loaded':'not_loaded'}, category=${_hasRealCats?'loaded':'not_loaded'}, sku=${_hasRealSkus?'loaded':'not_loaded'}, sku_monthly=${_hasMonthlySkus?'loaded':'not_loaded'}, weekly=not_available, supplier=not_available, menu=not_available\n\nMonthly trend:\n${_trend}\n\nCategory latest:\n${_catStr}\n\nTop SKU latest:\n${_skuStr}\n\nSKU monthly signals:\n${_skuMovement}\n\nCost-saving alternatives:\n${_ol}`;
}

function buildPortfolioChatContext(){
  let accounts=[];
  try{accounts=typeof getPortviewAccounts==='function'?getPortviewAccounts():[];}catch(e){accounts=[];}
  if(!accounts||!accounts.length){
    return `-- PORTFOLIO CONTEXT --\nยังไม่มีข้อมูลพอร์ตที่โหลดอยู่ใน session นี้ หรือผู้ใช้ไม่มีสิทธิ์เห็นพอร์ตนี้`;
  }
  const enriched=accounts.map(a=>{const v=chatMoneyValue(a);return{...a,_chatMoney:v,_currentGmv:v.current,_runrate:v.runrate,_lastGmv:v.last};});
  const withPace=enriched.filter(a=>a.paceSignal&&a.paceSignal.pct>0);
  const portfolioPace=withPace.length?Math.round(withPace.reduce((s,a)=>s+(a.paceSignal.gmvToDate||0),0)/Math.max(1,withPace.reduce((s,a)=>s+(a.paceSignal.expected||0),0))*100):0;
  const atRisk=enriched.filter(a=>a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn'));
  const healthy=enriched.filter(a=>a.paceSignal&&(a.paceSignal.cls==='safe'||a.paceSignal.cls==='great')).length;
  const topCurrent=[...enriched].sort((a,b)=>(b._currentGmv||0)-(a._currentGmv||0)).slice(0,10);
  const topRunrate=[...enriched].sort((a,b)=>(b._runrate||0)-(a._runrate||0)).slice(0,8);
  const rankedRisk=[...atRisk].sort((a,b)=>Math.max(0,(b.paceSignal?.baselineGmv||0)-(b.paceSignal?.runrate||0))-Math.max(0,(a.paceSignal?.baselineGmv||0)-(a.paceSignal?.runrate||0))).slice(0,8);
  const topCurrentLines=topCurrent.map((a,i)=>`${i+1}. ${chatAccountName(a)} — current GMV-to-date ${fmtChatK(a._currentGmv||0)}, run-rate ${fmtChatK(a._runrate||0)}, last-month ${fmtChatK(a._lastGmv||0)}${a.kamName?' · KAM '+a.kamName:''}`).join('\n');
  const topRunrateLines=topRunrate.map((a,i)=>`${i+1}. ${chatAccountName(a)} — run-rate ${fmtChatK(a._runrate||0)}, current ${fmtChatK(a._currentGmv||0)}, pace ${pctChat(a.paceSignal?.pct)}`).join('\n');
  const riskLines=rankedRisk.map((a,i)=>{const ps=a.paceSignal||{};const gap=Math.max(0,(ps.baselineGmv||ps.expected||0)-(ps.runrate||ps.gmvToDate||0));return `${i+1}. ${chatAccountName(a)} — ${ps.cls||'n/a'} pace ${pctChat(ps.pct)} gap ${fmtChatK(gap)}${(a.churnedSkuCount||0)>0?' · SKU ไม่พบ '+a.churnedSkuCount:''}`;}).join('\n');
  return `-- PORTFOLIO CONTEXT --\nจำนวนร้านที่เห็น: ${enriched.length}\nPortfolio pro-rate: ${portfolioPace}%\nAt-risk: ${atRisk.length} ร้าน\nHealthy/Safe: ${healthy} ร้าน\n\nTop accounts by current GMV-to-date:\n${topCurrentLines||'ไม่มีข้อมูล current GMV'}\n\nTop accounts by run-rate GMV:\n${topRunrateLines||'ไม่มีข้อมูล run-rate'}\n\nAt-risk accounts by money impact:\n${riskLines||'ไม่มีร้านเสี่ยงจากข้อมูลที่โหลดอยู่'}`;
}

function buildTeamChatContext(){
  let groups=[];
  try{groups=typeof _buildKamGroups==='function'?_buildKamGroups():[];}catch(e){groups=[];}
  if(!groups||!groups.length){
    return `-- TEAM CONTEXT --\nยังไม่มีข้อมูลทีมที่โหลดอยู่ใน session นี้ หรือ user ไม่ใช่ TL/admin`;
  }
  const allAccts=groups.flatMap(g=>(g.accounts||[]).map(a=>({...a,_kamGroup:g.kamName})));
  const withPace=allAccts.filter(a=>a.paceSignal&&a.paceSignal.pct>0);
  const teamPace=withPace.length?Math.round(withPace.reduce((s,a)=>s+(a.paceSignal.gmvToDate||0),0)/Math.max(1,withPace.reduce((s,a)=>s+(a.paceSignal.expected||0),0))*100):0;
  const totalShortfall=groups.reduce((s,g)=>s+(g.shortfall||0),0);
  const kamLines=groups.slice(0,10).map(g=>`- ${g.kamName}: ${g.total} ร้าน · pace ${g.pace}% · เสี่ยง ${g.danger+g.warn} · shortfall ${fmtChatK(g.shortfall||0)}`).join('\n');
  const topAccts=allAccts.map(a=>{const v=chatMoneyValue(a);return{...a,_currentGmv:v.current,_runrate:v.runrate,_lastGmv:v.last};}).sort((a,b)=>(b._currentGmv||0)-(a._currentGmv||0)).slice(0,8);
  const topAcctLines=topAccts.map((a,i)=>`${i+1}. ${chatAccountName(a)} — current ${fmtChatK(a._currentGmv||0)}, run-rate ${fmtChatK(a._runrate||0)}, KAM ${a.kamName||a._kamGroup||'-'}`).join('\n');
  return `-- TEAM CONTEXT --\nจำนวน KAM: ${groups.length}\nจำนวนร้าน: ${allAccts.length}\nTeam pro-rate: ${teamPace}%\nTotal shortfall: ${fmtChatK(totalShortfall)}\n\nKAM groups:\n${kamLines}\n\nTop accounts visible to this team by current GMV-to-date:\n${topAcctLines||'ไม่มีข้อมูล current GMV รายร้านใน team context'}`;
}

function buildChatContextByScope(scope,q){
  // Olive Chat v2: always provide a compact cross-scope packet when available.
  // This prevents the bot from acting like a screen reader stuck on the current tab.
  const active=getActiveScreenName();
  const intent=detectChatIntent(q||'');
  const sections=[`-- CHAT ROUTER --\nselected_scope: ${scope}\nquery_intent: ${intent}\nactive_screen: ${active}\nrule: answer the user’s actual question; do not say a scope is unavailable if another loaded context below contains the answer.`];
  if(scope==='account'){
    sections.push(buildAccountChatContext());
    if(chatHasPortfolioData())sections.push(buildPortfolioChatContext());
    if(chatHasTeamData())sections.push(buildTeamChatContext());
  }else if(scope==='portfolio'){
    sections.push(buildPortfolioChatContext());
    sections.push(buildAccountChatContext());
    if(chatHasTeamData())sections.push(buildTeamChatContext());
  }else if(scope==='team'){
    sections.push(buildTeamChatContext());
    if(chatHasPortfolioData())sections.push(buildPortfolioChatContext());
    sections.push(buildAccountChatContext());
  }else{
    sections.push(buildAccountChatContext());
    if(chatHasPortfolioData())sections.push(buildPortfolioChatContext());
    if(chatHasTeamData())sections.push(buildTeamChatContext());
  }
  return sections.join('\n\n');
}

function oliveChatGroundingClean(t, context, scope){
  // Olive Chat v2: narrow last-mile cleanup only. Do not rewrite business meaning.
  let s=String(t||'');
  const ctx=String(context||'');
  const noWeekly=/weekly=not_available|weekly_data:\s*not_available/i.test(ctx);
  if(noWeekly){
    s=s.replace(/(ลดลง|เพิ่มขึ้น|หายไป|โตขึ้น|ตกลง)\s*(\d+)\s*สัปดาห์(?:\s*ต่อเนื่อง|\s*ติด|\s*เรียว)?/g,'$1ต่อเนื่องในข้อมูลรายเดือนที่มี');
    s=s.replace(/(\d+)\s*สัปดาห์เรียว/g,'ข้อมูลรายเดือนที่มี');
  }
  s=s
    .replace(/ฟอกประมาณ/g,'คิดเป็นประมาณ')
    .replace(/ยังมีหลังคาให้ยัง/g,'ยังมี room ให้ปรับ')
    .replace(/โทรตอบรับเสียวตอนนี้/g,'โทรเช็คอินตอนนี้')
    .replace(/ตอบรับเสียว/g,'เช็คอิน')
    .replace(/ไม่ได้มีซื้อ/g,'ไม่มีการซื้อ')
    .replace(/สัปดาห์เรียว/g,'สัปดาห์ต่อเนื่อง')
    .replace(/ดีดตัวออกมา ค่อยๆ/g,'มีสัญญาณฟื้นตัวแบบค่อยเป็นค่อยไป')
    .replace(/ออเดอร์หลัง/g,'จำนวนออเดอร์')
    .replace(/มีหลังคาให้ปรับ/g,'ยังมี room ให้ปรับ')
    .replace(/เนื้อที่ซื้อ/g,'หมวดที่ซื้อ')
    .replace(/emergency/gi,'เคสเร่งด่วน')
    .replace(/\bchurn\b/gi,'เสี่ยงหลุด')
    .replace(/\bdrop\b/gi,'ยอดลด')
    .replace(/[📊🔍⚠️✅💡🙂😀😅🚨]/g,'')
    .replace(/ค่ะค่ะ/g,'ค่ะ')
    .replace(/คะค่ะ/g,'ค่ะ')
    .replace(/ค่ะนะคะ/g,'นะคะ')
    .replace(/นะคะค่ะ/g,'นะคะ');
  // soften over-certain unsupported operational diagnoses
  s=s.replace(/ลูกค้าเปลี่ยนซัพพลายเออร์/g,'ลูกค้าอาจเปลี่ยนแหล่งซื้อ (ต้องถามยืนยัน)');
  s=s.replace(/เปลี่ยน supplier/g,'อาจเปลี่ยน supplier (ต้องถามยืนยัน)');
  s=s.replace(/เปลี่ยนเมนู/g,'อาจเปลี่ยนเมนู (ต้องถามยืนยัน)');
  s=s.replace(/เตรียม promote/g,'อาจมีแผนโปรโมชัน (ต้องถามยืนยัน)');
  return s.replace(/\n{3,}/g,'\n\n').trim();
}

async function sendChat(){
  if(aiLoading)return;
  const inp=document.getElementById('aiinput');
  const q=inp.value.trim();
  if(!q)return;
  inp.value='';
  document.getElementById('aisugg').style.display='none';
  addMsg('u',q);
  const ldEl=addMsg('a','<span class="ai-typing"><span></span><span></span><span></span></span>',true);
  aiLoading=true;
  chatHist.push({role:'user',content:q});
  if(chatHist.length>10)chatHist=chatHist.slice(-10);

  const _scope=detectChatScope(q);
  const _context=buildChatContextByScope(_scope,q);
  const _intent=detectChatIntent(q);
  const _mustReplyThai=/[\u0E00-\u0E7F]/.test(q) && !/(answer|reply|respond)\s+in\s+english|english\s+only|ภาษาอังกฤษ/i.test(q);
  const _languageContract=_mustReplyThai
    ? 'ผู้ใช้ถามเป็นภาษาไทยหรือไทยปนอังกฤษ: ตอบภาษาไทยเท่านั้น ใช้คำอังกฤษเฉพาะชื่อ metric/field/feature หรือศัพท์ธุรกิจที่จำเป็น'
    : 'Mirror the user\'s requested language. If no explicit English request exists, prefer Thai.';
  const _isGreeting=/^(hi|hello|hey|สวัสดี|หวัดดี|ดีครับ|ดีค่ะ)\b/i.test(q.trim());
  const _simple=/^(ร้านไหน|ใคร|อะไร|เท่าไหร่|กี่|top|highest|มากสุด|เยอะสุด)/i.test(q.trim())&&q.length<80;
  const _chatModelKey=_isGreeting?'haiku':'sonnet';
  const _maxTok=_simple?650:950;

  const sys=OLIVE_BASE+`

-- OLIVE CHAT V2 TASK --
You are answering inside Freshket Sense AI Chat. You are not a screen reader. You are a KAM intelligence partner who can use all loaded context provided below.

selected_scope: ${_scope}
query_intent: ${_intent}

${_context}

-- LANGUAGE CONTRACT --
${_languageContract}

-- ANSWER STYLE CONTRACT --
- Answer the user’s question directly in the first 1–2 lines.
- Default length: 4–8 concise lines. Do not write a full report unless the user asks for one.
- Do not use a fixed template like “สถานะ / สัญญาณ / ควรทำ” every time. Choose the shape that fits the question.
- No markdown tables unless the user explicitly asks for a table.
- No emojis.
- Be practical and KAM-native: what matters, why, what to do next.
- If the answer is a ranking, give the ranking first, then one caveat about metric definition if needed.

-- GROUNDING CONTRACT --
- Use only the context above for numbers, dates, account names, SKU names, category names, percentages, and money values.
- If a useful answer exists in portfolio/team context, use it even if the current screen is different.
- Do not tell the user to open another page unless no loaded context can answer the question.
- Distinguish: fact from data / interpretation / hypothesis to verify. But do this naturally, not as a rigid template.
- Never invent week-level patterns. If weekly data is not available, do not mention weeks.
- Supplier/menu/promotion/churn/customer intent can only be a hypothesis to verify unless explicitly present in context.
- Balance risk and upside: look for growth, wallet protection, wallet expansion, category penetration, ordering-cycle, spec, price, and menu-mix opportunities when context supports them.
- Use Thai Baht only: บาท or ฿. Never use เยน, JPY, ¥, dollar, or USD.
- Refer to yourself only as Olive. Never use หนู, ฉัน, ดิฉัน, ผม, เรา, อาจารย์, or ครับ.`;

  try{
    const reply=await callAI(_chatModelKey,sys,chatHist.slice(-8),_maxTok);
    const cleanReply=oliveChatGroundingClean(oliveToneClean(reply), _context, _scope);
    ldEl.querySelector('.mb').innerHTML=cleanReply.replace(/\n/g,'<br>');
    ldEl.querySelector('.mb').classList.remove('ld');
    chatHist.push({role:'assistant',content:cleanReply});
  }catch(e){
    ldEl.querySelector('.mb').textContent='ขออภัย เชื่อมต่อไม่ได้ขณะนี้';
    ldEl.querySelector('.mb').classList.remove('ld');
  }
  aiLoading=false;
}

function shareLine(){
  const _sn=D.meta.accountName||document.getElementById('acct-name-input')?.value.trim()||'ร้านอาหารของคุณ';
  const _sp=curSpend()>0?totalSel()/curSpend()*100:0;
  const _sc=computeSenseScore();
  const _cta=isKAM?'ข้อมูลนี้จัดทำโดย KAM Freshket':'สอบถามที่ KAM ของท่าน';
  const txt='รายงาน Freshket Sense\n\n'+_sn+'\nค่าใช้จ่าย: '+fmt(curSpend())+'/เดือน\nแผนประหยัด: '+fmt(totalSel())+'/เดือน ('+sel.size+' รายการ)\nต่อปี: '+fmt(totalSel()*12)+'\nFull Potential: '+fmt(totalAll()*12)+'/ปี\nCost IQ Score: '+_sc+'/100\n\n'+_cta;
  window.open('https://social-plugins.line.me/lineit/share?url='+encodeURIComponent('https://freshket.co')+'&text='+encodeURIComponent(txt),'_blank');
}

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
// Keyboard: Escape closes overlays
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    const sheet=document.getElementById('detailSheet');
    if(sheet&&sheet.classList.contains('open')){closeDetailSheet();return;}
    const panel=document.getElementById('dataPanel');
    if(panel&&panel.classList.contains('open')){closeDataPanel();return;}
  }
});
// ════════════════════════════════════════
// GROUP A — NEW RENDER FUNCTIONS
// ════════════════════════════════════════

// ── Hero: KAM identity (customer mode only) ──
// SECTION:HERO_RENDERS
function renderHeroKAM(){
  const row=document.getElementById('h-kam-row');
  const nameEl=document.getElementById('h-kam-name');
  const kamName=D.meta.kamName||'';
  if(!kamName||isKAM){if(row)row.style.display='none';return;}
  if(nameEl)nameEl.textContent=kamName;
  if(row)row.style.display='flex';
}

// ── Hero: MoM spend delta ──
function renderHeroMoM(){
  if(heroLockedToCurrent)return;
  const el=document.getElementById('hero-mom');
  const deltaEl=document.getElementById('hero-mom-delta');
  const labelEl=document.getElementById('hero-mom-label');
  if(!el)return;
  const hist=D.history.length?D.history:SAMPLE.history;
  if(hist.length<2){el.style.display='none';return;}
  const cur=hist[hist.length-1].s;
  const prev=hist[hist.length-2].s;
  if(!prev){el.style.display='none';return;}
  const pct=(cur-prev)/prev*100;
  const isUp=pct>=0;
  const sign=isUp?'+':'';
  if(deltaEl){deltaEl.textContent=sign+pct.toFixed(1)+'%';deltaEl.className='mom-delta '+(isUp?'mom-up':'mom-dn');}
  if(labelEl)labelEl.textContent=(isUp?' ▲':' ▼')+' จากเดือนก่อน';
  el.style.display='flex';
}

// ── Compute unit_price changes between last 2 months ──
function computePriceChanges(){
  const _moSort=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
  const moKeys=D.skus_monthly&&Object.keys(D.skus_monthly).length?Object.keys(D.skus_monthly).sort((a,b)=>_moSort(b)-_moSort(a)):[];
  if(moKeys.length<2)return[];
  const curSkus=D.skus_monthly[moKeys[0]]||[];
  const prevSkus=D.skus_monthly[moKeys[1]]||[];
  const prevMap={};prevSkus.forEach(s=>{prevMap[String(s.id)]=s.unit_price||s.u||0;});
  const changes=[];
  curSkus.forEach(s=>{
    const cur=s.unit_price||s.u||0;
    const prev=prevMap[String(s.id)]||0;
    if(!cur||!prev)return;
    const pct=(cur-prev)/prev*100;
    if(Math.abs(pct)>=1)changes.push({id:String(s.id),name:s.n,pct,curPrice:cur,prevPrice:prev});
  });
  return changes.sort((a,b)=>Math.abs(b.pct)-Math.abs(a.pct));
}

// ── Quick Wins card ──
function renderQuickWins(){
  const sec=document.getElementById('quick-wins-sec');
  const itemsEl=document.getElementById('qw-items');
  const footerEl=document.getElementById('qw-footer');
  const footerSaveEl=document.getElementById('qw-footer-save');
  if(!sec||!itemsEl)return;
  if(OPPS.length===0){sec.style.display='none';return;}
  // Sort: high confidence first, then by savings
  const sorted=[...OPPS].sort((a,b)=>{
    const ac=getAlt(a).conf==='high'?1:0,bc=getAlt(b).conf==='high'?1:0;
    if(bc!==ac)return bc-ac;
    return getAlt(b).save-getAlt(a).save;
  });
  const top3=sorted.slice(0,3);
  const priceChanges=computePriceChanges();
  itemsEl.innerHTML=top3.map(o=>{
    const alt=getAlt(o);
    const isSel=sel.has(o.id);
    const pc=priceChanges.find(p=>p.id===String(o.curId));
    const priceTag=pc&&pc.pct>0?`<span class="qw-price-tag">ราคา▲${Math.abs(pc.pct).toFixed(0)}%</span>`:'';
    const btnLabel=isSel?'✓ เพิ่มแล้ว':'+ เพิ่ม';
    return`<div class="qw-item">
      <div class="qw-names">
        <div class="qw-from-line"><span class="qw-from">${o.curName}</span>${priceTag}</div>
        <div class="qw-to">${alt.altName}</div>
      </div>
      <div class="qw-save-col">
        <div class="qw-save">${fmt(alt.save)}</div>
        <div class="qw-save-unit">/เดือน</div>
      </div>
      <button class="qw-btn${isSel?' added':''}" id="qwbtn-${o.id}" onclick="qwToggle(${o.id})">${btnLabel}</button>
    </div>`;
  }).join('');
  const total=top3.reduce((s,o)=>s+getAlt(o).save,0);
  if(footerEl)footerEl.style.display='flex';
  if(footerSaveEl)footerSaveEl.textContent=fmt(total);
  sec.style.display='block';
}

function qwToggle(id){
  // ── v52 C1 fix: don't allow adding unverified opps to plan via Quick Wins ──
  const o=OPPS.find(x=>x.id===id);

  if(sel.has(id))sel.delete(id);else sel.add(id);
  currentPlanMode='custom';
  const btn=document.getElementById('qwbtn-'+id);
  if(btn){const on=sel.has(id);btn.textContent=on?'✓ เพิ่มแล้ว':'+ เพิ่ม';btn.className='qw-btn'+(on?' added':'');}
  renderOpps();updatePbFooter();updateSim();debouncedSave();
}

// ── Chart insight: biggest category mover vs prev month ──
function renderChartInsight(idx){
  const el=document.getElementById('chart-insight');
  if(!el)return;
  const hist=D.history.length?D.history:SAMPLE.history;
  if(idx<1){el.style.display='none';return;}
  const curMo=hist[idx]?.m;const prevMo=hist[idx-1]?.m;
  if(!curMo||!prevMo){el.style.display='none';return;}
  const curCats=D.cats_monthly&&D.cats_monthly[curMo];
  const prevCats=D.cats_monthly&&D.cats_monthly[prevMo];
  if(!curCats||!prevCats){el.style.display='none';return;}
  const prevMap={};prevCats.forEach(c=>{prevMap[c.n]=c.s;});
  let bigDelta=0,bigCat='';
  curCats.forEach(c=>{const d=c.s-(prevMap[c.n]||0);if(Math.abs(d)>Math.abs(bigDelta)){bigDelta=d;bigCat=c.n;}});

  // ── Trend annotation (priority over category mover) ──
  let trendNote='';
  if(hist.length>=3){
    const vals=hist.map(h=>h.s);
    const cur=vals[idx];
    const max6=Math.max(...vals);const min6=Math.min(...vals);
    // consecutive direction
    let runDir=0,runLen=1;
    for(let i=1;i<hist.length;i++){
      const d=vals[i-1]-vals[i];const dir=d>0?1:d<0?-1:0;
      if(i===1){runDir=dir;}else if(dir===runDir&&dir!==0){runLen++;}else break;
    }
    // variance
    const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
    const variance=Math.sqrt(vals.reduce((s,v)=>s+Math.pow(v-avg,2),0)/vals.length)/avg;
    if(cur===max6&&hist.length>=3){trendNote='เดือนนี้สูงสุดใน '+hist.length+' เดือนที่ผ่านมา';}
    else if(cur===min6&&hist.length>=3){trendNote='เดือนนี้ต่ำสุดใน '+hist.length+' เดือนที่ผ่านมา';}
    else if(runLen>=3&&runDir!==0){trendNote='ค่าใช้จ่าย'+(runDir>0?'เพิ่มขึ้น':'ลดลง')+'ต่อเนื่อง '+runLen+' เดือน';}
    else if(variance<0.08&&hist.length>=4){trendNote='ค่าใช้จ่ายสม่ำเสมอ '+hist.length+' เดือนที่ผ่านมา';}
  }

  if(trendNote){
    el.innerHTML=trendNote;
    el.style.display='block';
  } else if(bigCat&&Math.abs(bigDelta)>=500){
    const verb=bigDelta>0?'มากขึ้น':'ลดลง';
    el.innerHTML=`ยอดซื้อ<strong>${bigCat}</strong>${verb} ${fmt(Math.abs(bigDelta))} จากเดือนก่อน`;
    el.style.display='block';
  } else {
    el.style.display='none';
  }
}

// ── Portfolio MoM insight ──
// ── v156: Derive category breakdown from skus when cats_monthly missing (e.g. MTD month not in Q2B) ──
function _catsFromSkus(skuArr){
  const map={};
  (skuArr||[]).forEach(s=>{const n=s.d||'อื่นๆ';if(!map[n])map[n]={n,s:0,p:0,c:0};map[n].s+=(s.gmv||s.s||0);map[n].c++;});
  const total=Object.values(map).reduce((a,c)=>a+c.s,0);
  return Object.values(map).map(c=>({...c,p:total>0?Math.round(c.s/total*100):0})).sort((a,b)=>b.s-a.s);
}

function renderPortMoMInsight(){
  const el=document.getElementById('port-mom-insight');
  if(!el)return;
  const _moSort=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
  const moKeys=D.skus_monthly&&Object.keys(D.skus_monthly).length?Object.keys(D.skus_monthly).sort((a,b)=>_moSort(b)-_moSort(a)):[];
  if(!portfolioMonth||moKeys.length<2){el.style.display='none';return;}
  const idx=moKeys.indexOf(portfolioMonth);
  if(idx<0||idx>=moKeys.length-1){el.style.display='none';return;}
  const prevMo=moKeys[idx+1];
  const curCats=D.cats_monthly&&D.cats_monthly[portfolioMonth];
  const prevCats=D.cats_monthly&&D.cats_monthly[prevMo];
  const curSkus=D.skus_monthly[portfolioMonth]||[];
  const prevSkus=D.skus_monthly[prevMo]||[];
  const prevIds=new Set(prevSkus.map(s=>String(s.id)));
  const newCount=curSkus.filter(s=>!prevIds.has(String(s.id))).length;
  const parts=[];
  if(curCats&&prevCats){
    const pm={};prevCats.forEach(c=>{pm[c.n]=c.s;});
    const movers=curCats.map(c=>({n:c.n,d:c.s-(pm[c.n]||0)}))
      .filter(x=>Math.abs(x.d)>=500).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0,2);
    movers.forEach(m=>{parts.push(`${m.n} ${m.d>0?'+':''}${fmt(m.d)}`);});
  }
  if(newCount>0)parts.push(`SKU ใหม่ ${newCount} รายการ`);
  if(!parts.length){el.style.display='none';return;}
  el.innerHTML=`เทียบ ${prevMo}: <strong>${parts.join(' · ')}</strong>`;
  el.style.display='block';
}

// ── SKU View Toggle ──
function setSkuView(v){
  skuView=v;
  ['gmv','price'].forEach(k=>{const b=document.getElementById('svt-'+k);if(b)b.classList.toggle('on',k===v);});
  const btn=document.getElementById('sparkline-info-btn');
  const note=document.getElementById('sparkline-note');
  if(btn)btn.style.display=v==='price'?'flex':'none';
  if(note&&v!=='price')note.style.display='none'; // hide note when switching away
  renderSKUList();
}
function toggleSparklineNote(){
  const note=document.getElementById('sparkline-note');
  const btn=document.getElementById('sparkline-info-btn');
  if(!note)return;
  const open=note.style.display==='none'||note.style.display==='';
  note.style.display=open?'block':'none';
  if(btn){btn.style.background=open?'var(--n100)':'transparent';btn.style.color=open?'var(--n700)':'var(--n500)';}
}

// ── Month sort helper (asc = oldest first, for sparkline left→right) ──
const _moSortAsc=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};

// ── Render sparkline SVG ──
function renderSparkline(sid,moKeys,w,h){
  const aid=currentAccountId||'';
  const priceHist=aid&&bulkPriceData[aid]&&bulkPriceData[aid][sid];

  // ── Build combined price timeline: Q6B history + Q3B (newest, most accurate) ──
  const q3bSet=new Set(moKeys);
  const q3bPrices={};
  // Get rangeKgMax from the SKU's stored value (set during Q3B ingest)
  let _rangeMax=null;
  let _eaUnitVal=null;
  let _q6bFactor=null;
  let _q6bEaDivide=false;
  moKeys.forEach(mo=>{
    const s=(D.skus_monthly[mo]||[]).find(x=>String(x.id)===sid);
    if(s&&(s.unit_price||s.u)>0){
      q3bPrices[mo]=s.display_price||(s.unit_price||s.u);
      if(s.range_kg_max&&!_rangeMax)_rangeMax=s.range_kg_max;
      if(s.ea_unit_value&&!_eaUnitVal)_eaUnitVal=s.ea_unit_value;
      if(s.q6b_factor&&!_q6bFactor)_q6bFactor=s.q6b_factor;
      if(s.q6b_ea_divide)_q6bEaDivide=true;
    }
  });

  // Collect all months: older from Q6B + Q3B months
  const allPoints=[];
  if(priceHist&&priceHist.length>0){
    priceHist.forEach(p=>{
      if(!q3bSet.has(p.mo)&&p.unit_price>0){
        let price=p.unit_price;
        // Apply same conversion factor as Q3B display_price
        if(_q6bFactor&&_q6bFactor.divisor>0){
          price=Math.round((p.unit_price/_q6bFactor.divisor)*100)/100;
        } else if(_q6bEaDivide&&_eaUnitVal>0){
          price=Math.round(p.unit_price/_eaUnitVal*100)/100;
        } else if(_rangeMax){
          price=Math.round(p.unit_price/_rangeMax*100)/100;
        }
        allPoints.push({mo:p.mo,p:price,src:'q6b'});
      }
    });
  }
  moKeys.forEach(mo=>{if(q3bPrices[mo])allPoints.push({mo,p:q3bPrices[mo],src:'q3b'});});
  allPoints.sort((a,b)=>_moSortAsc(a.mo)-_moSortAsc(b.mo));

  const valid=allPoints.map(x=>x.p).filter(p=>p>0);
  if(valid.length<2)return`<span style="font-size:9px;color:var(--n300)">—</span>`;

  // ── Y-axis: historical range from Q6B, else local normalize ──
  let mn,mx,rng;
  if(priceHist&&priceHist.length>=3){
    const hp=priceHist.map(p=>p.unit_price).filter(p=>p>0);
    if(hp.length>=2){
      mn=Math.min(...hp);mx=Math.max(...hp);
      const pad=(mx-mn)*0.1||mn*0.05||1;
      mn=mn-pad;mx=mx+pad;rng=mx-mn;
    }
  }
  if(!rng){mn=Math.min(...valid);mx=Math.max(...valid);rng=mx-mn||mn*0.01||1;}

  // ── Render points ──
  const n=allPoints.length;
  const pts=allPoints.map((d,i)=>({
    x:2+(i/(n-1))*(w-4),
    y:2+((mx-d.p)/rng)*(h-4),
    p:d.p,mo:d.mo,src:d.src
  }));

  const first=pts[0],last=pts[pts.length-1];
  const delta=last.p-first.p;
  const lc=delta<-0.05?'var(--g500)':delta>0.05?'var(--amb)':'var(--n300)';
  const fc=delta<-0.05?'rgba(0,208,112,.07)':delta>0.05?'rgba(240,176,0,.07)':'rgba(160,160,160,.04)';
  const polyPts=pts.map(d=>`${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(' ');
  const areaD=`M${first.x.toFixed(1)},${h} L${pts.map(d=>`${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(' L')} L${last.x.toFixed(1)},${h}Z`;
  const pct=first.p>0?((delta/first.p)*100).toFixed(1):'0';
  const pctC=delta<-0.05?'var(--g700)':delta>0.05?'#9a6500':'var(--n400)';
  const pctSign=delta>0.05?'+':'';
  const title=pts.map(d=>d.mo.split(' ')[0]+' ฿'+d.p.toFixed(0)).join(', ');
  return`<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;overflow:hidden;max-width:${w+4}px">
    <svg width="${w}" height="${h}" viewBox="-2 -2 ${w+4} ${h+4}" style="display:block;overflow:visible"><title>${title}</title>
      <path d="${areaD}" fill="${fc}"/>
      <polyline points="${polyPts}" fill="none" stroke="${lc}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2.5" fill="${lc}" stroke="var(--n0)" stroke-width="1.2"/>
    </svg>
    <span style="font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:700;color:${pctC};line-height:1">${pctSign}${pct}%</span>
  </div>`;
}

// ── Open SKU detail popup ──
// SECTION:SKU_DETAIL
function openSkuDetail(sid){
  const moKeys=Object.keys(D.skus_monthly||{}).sort((a,b)=>_moSortAsc(a)-_moSortAsc(b));
  if(!moKeys.length)return;
  let info=null;
  for(let i=moKeys.length-1;i>=0;i--){
    const f=(D.skus_monthly[moKeys[i]]||[]).find(s=>String(s.id)===sid);
    if(f){info=f;break;}
  }
  if(!info)return;
  // ── Merge Q3B months + Q6B historical months for full price timeline ──
  const aid=currentAccountId||'';
  const priceHist=(aid&&bulkPriceData[aid]&&bulkPriceData[aid][sid])||[];
  const q3bSet=new Set(moKeys);
  // Use display_price from Q3B (already has rangeKgMax applied) + get rangeKgMax
  let _rangeMaxDetail=null;
  let _eaUnitValDetail=null;
  let _q6bFactorDetail=null;
  let _q6bEaDivideDetail=false;
  const q3bPriceData=moKeys.map(mo=>{
    const s=(D.skus_monthly[mo]||[]).find(x=>String(x.id)===sid);
    const pr=s?(s.display_price||s.unit_price||s.u||0):0;
    if(s&&s.range_kg_max&&!_rangeMaxDetail)_rangeMaxDetail=s.range_kg_max;
    if(s&&s.ea_unit_value&&!_eaUnitValDetail)_eaUnitValDetail=s.ea_unit_value;
    if(s&&s.q6b_factor&&!_q6bFactorDetail)_q6bFactorDetail=s.q6b_factor;
    if(s&&s.q6b_ea_divide)_q6bEaDivideDetail=true;
    return pr>0?{mo,price:pr}:null;
  }).filter(Boolean);
  const q6bExtra=priceHist
    .filter(p=>!q3bSet.has(p.mo)&&(p.unit_price||p.avg_piece_price)>0)
    .map(p=>{
      const raw=p.unit_price||p.avg_piece_price;
      let price=raw;
      if(_q6bFactorDetail&&_q6bFactorDetail.divisor>0){
        price=Math.round((raw/_q6bFactorDetail.divisor)*100)/100;
      } else if(_q6bEaDivideDetail&&_eaUnitValDetail>0){
        price=Math.round(raw/_eaUnitValDetail*100)/100;
      } else if(_rangeMaxDetail){
        price=Math.round(raw/_rangeMaxDetail*100)/100;
      }
      return{mo:p.mo,price};
    });
  // Dedup by month (last-write wins = latest price per month)
  const _pdMap=new Map();
  [...q6bExtra,...q3bPriceData].sort((a,b)=>_moSortAsc(a.mo)-_moSortAsc(b.mo)).forEach(d=>_pdMap.set(d.mo,d));
  const priceData=Array.from(_pdMap.values());
  const catEl=document.getElementById('skuDetailCat');
  const titleEl=document.getElementById('skuDetailTitle');
  const body=document.getElementById('skuDetailBody');
  const sheet=document.getElementById('skuDetailSheet');
  if(!sheet||!body)return;
  if(catEl)catEl.textContent=info.d||'—';
  if(titleEl)titleEl.textContent=info.n;
  body.innerHTML=renderSkuDetailContent(info,priceData);
  sheet.classList.add('open');
  document.getElementById('skuDetailOverlay').classList.add('on');
  document.body.style.overflow='hidden';
}

function closeSkuDetail(){
  document.getElementById('skuDetailSheet')?.classList.remove('open');
  document.getElementById('skuDetailOverlay')?.classList.remove('on');
  document.body.style.overflow='';
}

// ── Full price trend content for detail sheet ──
function renderSkuDetailContent(sku,priceData){
  if(priceData.length<2)return`<div style="padding:28px;text-align:center;color:var(--n400);font-size:13px">ไม่มีข้อมูลราคาย้อนหลัง<br><span style="font-size:11px">ต้องใช้ข้อมูล Q3 หลายเดือน</span></div>`;
  const prices=priceData.map(d=>d.price);
  const mn=Math.min(...prices),mx=Math.max(...prices),rng=mx-mn||mn*0.01||1;
  const first=priceData[0],last=priceData[priceData.length-1];
  const delta=last.price-first.price;
  const deltaPct=first.price>0?((delta/first.price)*100).toFixed(1):'0';
  const trendC=delta<-0.05?'var(--g700)':delta>0.05?'#9a6500':'var(--n600)';
  const trendIcon=delta<-0.05?'▼':delta>0.05?'▲':'→';
  const trendSign=delta>0.05?'+':'';

  // Chart dimensions
  const W=320,H=110,pL=10,pR=10,pT=18,pB=22;
  const cW=W-pL-pR,cH=H-pT-pB;
  const pts=priceData.map((d,i)=>({
    x:pL+(i/(priceData.length-1))*cW,
    y:pT+cH-((d.price-mn)/rng)*cH,
    price:d.price,mo:d.mo
  }));
  const polyPts=pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaD=`M${pts[0].x.toFixed(1)},${pT+cH} L${pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')} L${pts[pts.length-1].x.toFixed(1)},${pT+cH}Z`;
  const lc=delta<-0.05?'var(--g500)':delta>0.05?'var(--amb)':'var(--n300)';
  const fc=delta<-0.05?'rgba(0,208,112,.08)':delta>0.05?'rgba(240,176,0,.08)':'rgba(160,160,160,.05)';

  // Price labels — show at first, last, and distinct min/max
  const shownPrices=new Set();
  const labelSvg=pts.map((p,i)=>{
    const isF=i===0,isL=i===pts.length-1;
    const isMn=p.price===mn,isMx=p.price===mx;
    if(!isF&&!isL&&!isMn&&!isMx)return'';
    // Skip if already labeled same price nearby
    const k=p.price.toFixed(0);
    if(shownPrices.has(k)&&!isF&&!isL)return'';
    shownPrices.add(k);
    const tooHigh=p.y-9<pT;
    const lblY=tooHigh?p.y+13:p.y-6;
    const anchor=p.x<pL+24?'start':p.x>W-pR-24?'end':'middle';
    const pr=p.price>=100?p.price.toFixed(0):p.price.toFixed(1);
    return`<text x="${p.x.toFixed(1)}" y="${lblY}" text-anchor="${anchor}" font-family="IBM Plex Mono,monospace" font-size="8.5" fill="var(--n600)" font-weight="500">฿${pr}</text>`;
  }).join('');

  // Month labels
  const moLabelSvg=pts.map((p,i)=>{
    const n=priceData.length;
    const show=n<=4||(i===0||i===n-1||(n>4&&i===Math.floor(n/2)));
    if(!show)return'';
    const mo=p.mo.split(' ')[0];
    const anchor=i===0?'start':i===pts.length-1?'end':'middle';
    return`<text x="${p.x.toFixed(1)}" y="${H-4}" text-anchor="${anchor}" font-family="IBM Plex Sans Thai,sans-serif" font-size="8" fill="var(--n400)">${mo}</text>`;
  }).join('');

  // Dots — thin out for many points (show first/last/min/max only if >6 pts)
  const dotsSvg=pts.map((p,i)=>{
    const isEndpt=i===0||i===pts.length-1;
    const isExtr=p.price===mn||p.price===mx;
    if(pts.length>6&&!isEndpt&&!isExtr)return'';
    const r=isEndpt?3.5:2.5;
    return`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${lc}" stroke="var(--n0)" stroke-width="1.5"/>`;
  }).join('');

  // Opportunity info
  const opp=OPPS.find(o=>String(o.curId)===String(sku.id));
  const oppHtml=opp?`<div style="margin:10px 16px 0;background:var(--g50);border:1px solid rgba(0,208,112,.2);border-radius:10px;padding:10px 12px">
    <div style="font-size:10px;font-weight:700;color:var(--g700);margin-bottom:4px">ประหยัดได้จากการเปลี่ยน SKU</div>
    <div style="font-size:12px;color:var(--n700);margin-bottom:4px">
      <span style="color:var(--n400);text-decoration:line-through;font-size:11px">${sku.n}</span><br>
      <strong>→ ${getAlt(opp).altName}</strong>
    </div>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:14px;font-weight:700;color:var(--amb)">${fmt(getAlt(opp).save)}/เดือน · −${getAlt(opp).pct}%</div>
  </div>`:'';

  const lastPr=last.price>=100?last.price.toFixed(0):last.price.toFixed(2);
  const mnStr=mn>=100?mn.toFixed(0):mn.toFixed(2);
  const mxStr=mx>=100?mx.toFixed(0):mx.toFixed(2);
  return`<div style="padding:12px 16px 0">
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <div><div style="font-size:9px;color:var(--n400);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">ราคาล่าสุด</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:19px;font-weight:700;color:var(--n900)">฿${lastPr}<span style="font-size:11px;font-weight:400;color:var(--n400);font-family:'IBM Plex Sans Thai',sans-serif">/${sku.display_unit||'กก.'}</span></div>
        ${sku.pack_size?`<div style="font-size:10px;color:var(--n400);margin-top:2px">${sku.pack_size}</div>`:''}</div>
      <div><div style="font-size:9px;color:var(--n400);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">${first.mo} – ${last.mo}</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:19px;font-weight:700;color:${trendC}">${trendIcon} ${Math.abs(parseFloat(deltaPct))}%</div></div>
    </div>
  </div>
  <div style="padding:6px 4px 0">
    <svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">
      <line x1="${pL}" y1="${pT}" x2="${W-pR}" y2="${pT}" stroke="var(--n100)" stroke-width="0.5"/>
      <line x1="${pL}" y1="${pT+cH}" x2="${W-pR}" y2="${pT+cH}" stroke="var(--n100)" stroke-width="0.5"/>
      <line x1="${pL}" y1="${pT+cH/2}" x2="${W-pR}" y2="${pT+cH/2}" stroke="var(--n100)" stroke-width="0.5" stroke-dasharray="3,2"/>
      <path d="${areaD}" fill="${fc}"/>
      <polyline points="${polyPts}" fill="none" stroke="${lc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${dotsSvg}${labelSvg}${moLabelSvg}
    </svg>
  </div>
  <div style="display:flex;margin:6px 16px 0;border:1px solid var(--n100);border-radius:10px;overflow:hidden">
    <div style="flex:1;padding:8px;text-align:center;border-right:1px solid var(--n100)">
      <div style="font-size:9px;color:var(--n400);font-weight:600;margin-bottom:2px">ต่ำสุด</div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;color:var(--g700)">฿${mnStr}</div>
    </div>
    <div style="flex:1;padding:8px;text-align:center;border-right:1px solid var(--n100)">
      <div style="font-size:9px;color:var(--n400);font-weight:600;margin-bottom:2px">สูงสุด</div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;color:#9a6500">฿${mxStr}</div>
    </div>
    <div style="flex:1;padding:8px;text-align:center">
      <div style="font-size:9px;color:var(--n400);font-weight:600;margin-bottom:2px">สั่ง/เดือน</div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;color:var(--n900)">${sku.qty_kg||sku.q||'?'} ${sku.display_unit==='kg'||!sku.display_unit?'กก.':sku.display_unit}</div>
    </div>
  </div>
  ${oppHtml}
  <div style="height:12px"></div>`;
}


// ════════════════════════════════════════
// KAM SUB-TABS
// ════════════════════════════════════════
// SECTION:KAM_SUBTABS
function updateKamSubtabVisibility(){
  const hasData=!!(D.current_month)||(D.sku_current||[]).length>0;
  const tabs=document.getElementById('kam-subtabs');
  if(tabs)tabs.style.display=hasData?'flex':'none';
  // Update เม.ย. label with last month name
  const sumLabel=document.getElementById('kstab-summary-label');
  if(sumLabel&&D.history&&D.history.length){
    const lastM=D.history[D.history.length-1];
    sumLabel.textContent='สรุป '+( lastM.m||'—').split(' ').slice(0,1).join('')+' '+(lastM.m||'').split(' ').slice(-1)[0];
  } else if(sumLabel){
    sumLabel.textContent='สรุป';
  }
  // Sync insight button label to reflect current tab + done state
  _refreshInsightBtnLabel();
}

function setKamSubtab(tab){
  kamSubtab=tab;
  // Update tab button active states
  ['thismonth','lastmonth'].forEach(t=>{
    const btn=document.getElementById('kstab-'+t);
    if(btn)btn.classList.toggle('on',t===tab);
  });
  const kamCards=document.getElementById('kam-cards');
  const lmSec=document.getElementById('kam-lastmonth-section');
  const talkWrap=document.getElementById('kam-talkline-wrap');
  const sigBar=document.getElementById('kam-signal-bar');
  const insLabel=document.getElementById('kam-insight-btn-label');
  const insBtn=document.getElementById('kam-insight-btn');
  // Hide all sections first
  if(kamCards)kamCards.style.display='none';
  if(lmSec)lmSec.style.display='none';
  if(talkWrap)talkWrap.style.display='none';
  if(sigBar)sigBar.style.display='none';
  if(tab==='lastmonth'){
    const hasData=D.history.length>0||OPPS.length>0;
    if(hasData){
      if(lmSec){lmSec.style.display='block';renderKamLastMonth();}
    }
    if(sigBar)sigBar.style.display='';
    if(insLabel)insLabel.textContent=_getSummaryInsightLabel(false);
    if(insBtn)insBtn.classList.remove('done');
  } else {
    // thismonth (default)
    if(sigBar)sigBar.style.display='';
    const hasData=D.history.length>0||OPPS.length>0;
    if(hasData){
      if(kamCards)kamCards.style.display='block';
      if(kamStateCache.accountId===currentAccountId&&kamStateCache.html){
        if(talkWrap)talkWrap.style.display='block';
      }
    }
    const isDone=kamStateCache&&kamStateCache.accountId===currentAccountId;
    if(insLabel)insLabel.textContent=_getSummaryInsightLabel(isDone);
    if(insBtn)insBtn.classList.toggle('done',!!isDone);
  }
}

// ════════════════════════════════════════
// UTILITY: days in a Thai-label month
// label format: "เม.ย. 2569" → returns 30
// ════════════════════════════════════════
function getThaiMonthDays(label){
  const moMap={'ม.ค.':1,'ก.พ.':2,'มี.ค.':3,'เม.ย.':4,'พ.ค.':5,'มิ.ย.':6,'ก.ค.':7,'ส.ค.':8,'ก.ย.':9,'ต.ค.':10,'พ.ย.':11,'ธ.ค.':12};
  const p=(label||'').split(' ');
  const mo=moMap[p[0]];
  const yr=parseInt(p[1]||0)-543;
  if(!mo||!yr||isNaN(yr))return 30;
  return new Date(yr,mo,0).getDate();
}

// ════════════════════════════════════════
// PACE SIGNAL COMPUTATION
// Logic:
//   baseline = avg daily GMV over recent 1–3 months
//             (each month normalized by its own day count)
//   expected = baseline_daily × days_elapsed_this_month
//   pct      = gmv_to_date / expected × 100
//
// Why normalize? Apr has 30 days, May has 31 — raw GMV totals
//   are not directly comparable without day normalization.
// ════════════════════════════════════════


// ============================================================
// Folded from 08_patches.js — Step 2 dissolve
// ============================================================


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v207a-sense-opportunity-patch
//////////////////////////////////////////////////////////////////////////////

(function(global){
  global.getFreshketV207aSenseFlowState=function(){
    const grp=document.getElementById('swipe-grp-b');
    const bnav=document.querySelector('.bnav');
    return {
      version: typeof VERSION!=='undefined'?VERSION:'v207a',
      kamSenseActive: document.body.classList.contains('kam-sense-active'),
      planExpanded: document.body.classList.contains('sense-plan-expanded'),
      bodyOverflow: document.body.style.overflow||'',
      opportunityCount: Array.isArray(global.OPPS)?global.OPPS.length:null,
      selectedCount: (global.sel&&typeof global.sel.size==='number')?global.sel.size:null,
      topImpact: Array.isArray(global.OPPS)?global.OPPS.slice().sort(function(a,b){
        try{return (getAlt(b).save||0)-(getAlt(a).save||0);}catch(e){return 0;}
      }).slice(0,8).map(function(o){return {name:o.curName, cat:o.cat, save:(getAlt(o)||{}).save||0};}):[],
      grpB:{top:grp?grp.scrollTop:null, bottomCss:grp?getComputedStyle(grp).bottom:null},
      bnav:{height:bnav?Math.round(bnav.getBoundingClientRect().height):null, paddingBottom:bnav?getComputedStyle(bnav).paddingBottom:null}
    };
  };
})(window);


//////////////////////////////////////////////////////////////////////////////


// ============================================================
// Folded from 08_patches.js — Step 2 dissolve
// ============================================================


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