// SECTION:OVERVIEW
function renderOverview(){
  const renderer = window.FreshketSenseOverviewRenderer;
  if(renderer && typeof renderer.renderFromLegacy === 'function'){
    try{
      const result = renderer.renderFromLegacy({
        D: D,
        SAMPLE: (typeof SAMPLE !== 'undefined' ? SAMPLE : {history:[],cats:[]}),
        activeMonth: activeMonth,
        animN: animN,
        renderCatBars: renderCatBars,
        renderOverviewStats: renderOverviewStats,
        renderInterpretation: renderInterpretation,
        renderPaceAndStrip: _renderOverviewPaceAndStrip,
        setSenseGateState: _sgSetState,
        getFlag: function(name){
          if(name === 'aiCameFromPreview') return aiCameFromPreview;
          if(name === 'senseActivated') return senseActivated;
          if(name === 'footerUnlocked') return footerUnlocked;
          if(name === 'sgRunning') return _sgRunning;
          if(name === 'heroLockedToCurrent') return heroLockedToCurrent;
          return undefined;
        },
        setFlag: function(name, value){
          if(name === 'aiCameFromPreview'){ aiCameFromPreview = value; return true; }
          if(name === 'senseActivated'){ senseActivated = value; return true; }
          if(name === 'footerUnlocked'){ footerUnlocked = value; return true; }
          if(name === 'sgRunning'){ _sgRunning = value; return true; }
          if(name === 'heroLockedToCurrent'){ heroLockedToCurrent = value; return true; }
          return false;
        }
      });
      if(result && result.ok) return result;
    }catch(err){
      console.warn('[Freshket Sense] Overview renderer failed, falling back to legacy renderer:', err && err.message ? err.message : err);
    }
  }
  return __legacyRenderOverviewFallback();
}

function __legacyRenderOverviewFallback(){
  // Reset AI button to idle on data refresh
  const raBtn=document.getElementById('rest-ai-btn');
  const raLoad=document.getElementById('rest-ai-load');
  const raPreview=document.getElementById('rest-ai-preview');
  if(raBtn){raBtn.classList.remove('loading','done');raBtn.style.opacity='';}
  if(raLoad){raLoad.style.display='none';['ras-1','ras-2','ras-3','ras-4'].forEach(id=>{const s=document.getElementById(id);if(s)s.classList.remove('vis');});}
  if(raPreview)raPreview.style.display='none';
  // Sprint 2: reset Sense activation state + restore dial standby
  // v191 guard: skip reset in KAM mode — daily bulk data reload (portview/history/sku) must NOT
  // force KAM through the gate again. Reset only happens on account switch (explicit) or
  // alternatives reload (data changes). Restaurant mode always resets (standby per session).
  if(!isKAM){
    aiCameFromPreview=false;senseActivated=false;footerUnlocked=false;_sgRunning=false;
    const _srhBridge=document.getElementById('srh-bridge');if(_srhBridge)_srhBridge.style.display='none';
    // Close gate if open
    const _gate=document.getElementById('sense-gate');if(_gate)_gate.style.display='none';
    _sgSetState('standby');
    const _oppHdrEl=document.getElementById('opphdr');if(_oppHdrEl)_oppHdrEl.classList.remove('ai-active');
    const _dsvgR=document.getElementById('dial-svg');if(_dsvgR)_dsvgR.classList.remove('sense-loading');
    const _dialOvR2=document.getElementById('dial-standby-overlay');if(_dialOvR2)_dialOvR2.style.display='flex';
    const _doneWR=document.getElementById('sense-done-wrap');if(_doneWR)_doneWR.style.display='none';
    const _dWrap=document.getElementById('dial-clickwrap');if(_dWrap){_dWrap.classList.remove('sense-done');_dWrap.style.pointerEvents='';}
  }
  const hist=D.history.length?D.history:SAMPLE.history;
  const mx=Math.max(...hist.map(h=>h.s),D.current_month?D.current_month.gmv_to_date:0,D.current_month?(D.current_month.runrate_gmv||0):0,1);
  const fmtK=v=>v>=1000000?(v/1000000).toFixed(1)+'M':v>=1000?Math.round(v/1000)+'k':String(Math.round(v));
  // ── Current month bar (partial + ghost run-rate overlay) ──
  const _cm=D.current_month;
  const _rr=_cm?(_cm.runrate_gmv||0):0;
  const _actH=_cm&&_cm.gmv_to_date>0?Math.round((_cm.gmv_to_date/mx)*50):0;
  const _showGhost=_cm&&_rr>_cm.gmv_to_date*1.05&&_actH>0;
  const _rrH=_showGhost?Math.min(Math.round((_rr/mx)*50),52):_actH;
  const _rrGap=_rrH-_actH;
  const _actInnerLeg=_actH>=16?`<span style="position:absolute;top:3px;left:0;right:0;text-align:center;font-size:8px;font-family:monospace;color:rgba(0,0,0,.7);line-height:1;font-weight:700">${fmtK(_cm.gmv_to_date)}</span>`:'';
  const _cmBar=_cm&&_cm.gmv_to_date>0?`<div class="tbw" id="bar-cm" style="cursor:pointer" onclick="selectCurrentMonth()"><span class="tba" style="color:var(--tk-ok-bright);font-size:10px;font-weight:700;font-family:monospace">${_showGhost?fmtK(_rr):fmtK(_cm.gmv_to_date)}</span>${_showGhost?`<div style="position:relative;height:${_rrH}px;width:100%;flex-shrink:0"><div style="position:absolute;inset:0;background:var(--tk-ok-dim);border:1.5px dashed var(--tk-ok-border);border-radius:4px 4px 0 0;box-sizing:border-box"></div><div style="position:absolute;bottom:0;left:0;right:0;height:${_actH}px;background:var(--g500);opacity:.65;border-radius:4px 4px 0 0;overflow:hidden">${_actInnerLeg}</div></div>`:`<div class="tb" style="--bh:${_actH}px;--bar-i:${hist.length};height:${_actH}px;background:var(--g500);opacity:.5;border:1.5px dashed var(--tk-ok-text);box-sizing:border-box"></div>`}<span class="tbl" style="color:var(--tk-ok-text);font-weight:700">${(_cm.month_label||'').split(' ')[0]}</span></div>`:'';

  document.getElementById('tbars').innerHTML=hist.map((h,i)=>`<div class="tbw" id="bar-${i}" onclick="selectMonth(${i})"><span class="tba" id="tba-${i}">${fmtK(h.s)}</span><div class="tb" id="tb-${i}" style="--bh:${Math.round((h.s/mx)*50)}px;--bar-i:${i};height:${Math.round((h.s/mx)*50)}px;background:var(--n200)"></div><span class="tbl">${h.m.split(' ')[0]}</span></div>`).join('')+_cmBar;
  // ── Hero: lock to current month if available ──
  if(_cm&&_cm.gmv_to_date>0){
    heroLockedToCurrent=true;
    const hSpend=document.getElementById('hspend');
    const hMLbl=document.getElementById('hMonthLabel');
    const hOrd=document.getElementById('hOrders');
    const momEl=document.getElementById('hero-mom');
    if(hSpend)animN(hSpend,_cm.gmv_to_date,1200);
    if(hMLbl)hMLbl.textContent=_cm.month_label||'';
    if(hOrd){hOrd.textContent='';hOrd.style.display='none';}
    if(momEl)momEl.style.display='none';
  } else {
    heroLockedToCurrent=false;
  }
  const cats=D.cats.length?D.cats:SAMPLE.cats;
  const _cb=document.getElementById('catbars');if(_cb)_cb.innerHTML=renderCatBars(cats,3);
  // talkingPoints removed — KAM mode uses AI briefing instead (#kamsec hidden)
  // Show category section if data available
  const _catSec=document.getElementById('overview-cats-sec');
  if(_catSec)_catSec.style.display=(cats&&cats.length)?'':'none';
  renderOverviewStats(activeMonth);
  renderInterpretation(activeMonth);
  _renderOverviewPaceAndStrip();
}

function selectCurrentMonth(){
  // Restore current month view — called when user taps ghost bar (พ.ค.)
  const hist=D.history.length?D.history:SAMPLE.history;
  // 1. Reset all history bars to gray
  hist.forEach((_,i)=>{
    const bar=document.getElementById('tb-'+i);
    const wrap=document.getElementById('bar-'+i);
    if(bar)bar.style.background='var(--n200)';
    if(wrap)wrap.classList.remove('active');
  });
  // 2. chart-sel-info: UPDATE to show current month (don't hide!)
  const _csi=document.getElementById('chart-sel-info');
  if(_csi&&D.current_month&&D.current_month.gmv_to_date>0){
    _csi.style.display='flex';
    const _cnEl=document.getElementById('chartMonthName');
    const _caEl=document.getElementById('chartMonthAmt');
    if(_cnEl)_cnEl.textContent=D.current_month.month_label||'';
    if(_caEl)_caEl.textContent=fmt(D.current_month.gmv_to_date);
  }else if(_csi){_csi.style.display='none';}
  // 3. Category: show current month if available
  const _curCatLbl=D.current_month&&D.current_month.month_label;
  if(_curCatLbl&&D.cats_monthly&&D.cats_monthly[_curCatLbl]){
    const catbarsEl=document.getElementById('catbars');
    const catSec=document.getElementById('overview-cats-sec');
    const catHead=catSec?catSec.querySelector('.ct'):null;
    if(catbarsEl)catbarsEl.innerHTML=renderCatBars(D.cats_monthly[_curCatLbl],3);
    if(catSec)catSec.style.display='';
    if(catHead)catHead.textContent='หมวดหมู่ · '+_curCatLbl+' MTD';
  }
  // 4. Score cards: use current month data (pass sentinel -1)
  renderOverviewStats(-1);
  renderInterpretation(hist.length-1);
  heroLockedToCurrent=true;
}

function selectMonth(idx,init){
  const hist=D.history.length?D.history:SAMPLE.history;
  if(idx<0||idx>=hist.length)return;
  activeMonth=idx;const h=hist[idx];
  // v205c: when hero locked to current month + initial render, don't highlight the April bar
  if(!(init && heroLockedToCurrent)){
    hist.forEach((_,i)=>{const bar=document.getElementById('tb-'+i);const wrap=document.getElementById('bar-'+i);if(!bar)return;bar.style.background=i===idx?'var(--g500)':'var(--n200)';wrap.classList.toggle('active',i===idx);});
  } else {
    hist.forEach((_,i)=>{const bar=document.getElementById('tb-'+i);const wrap=document.getElementById('bar-'+i);if(!bar)return;bar.style.background='var(--n200)';wrap.classList.remove('active');});
  }
  // ── Hero: only update when NOT locked to current month ──
  if(!heroLockedToCurrent){
    const _momEl=document.getElementById('hero-mom');
    const _momDelta=document.getElementById('hero-mom-delta');
    const _momLabel=document.getElementById('hero-mom-label');
    if(_momEl&&idx>0){
      const _pct=(h.s-hist[idx-1].s)/hist[idx-1].s*100;
      const _isUp=_pct>=0;
      if(_momDelta){_momDelta.textContent=(_isUp?'+':'')+_pct.toFixed(1)+'%';_momDelta.className='mom-delta '+(_isUp?'mom-up':'mom-dn');}
      if(_momLabel)_momLabel.textContent=(_isUp?' ▲':' ▼')+' จากเดือนก่อน';
      _momEl.style.display='flex';
    } else if(_momEl&&idx===0){_momEl.style.display='none';}
    if(init){animN(document.getElementById('hspend'),h.s,1200);}else{animN(document.getElementById('hspend'),h.s,600);}
    document.getElementById('hMonthLabel').textContent=h.m;
    const _hOrd=document.getElementById('hOrders');
    if(_hOrd){_hOrd.textContent=h.orders+' ออเดอร์';_hOrd.style.display='';}
  }
  // chart-sel-info: show when hero is locked (bar selected ≠ hero month) or past month
  const _csi=document.getElementById('chart-sel-info');
  // v205c: when hero locked + init → show current month in chart-sel-info, not selected bar
  if(init&&heroLockedToCurrent&&D.current_month&&D.current_month.gmv_to_date>0){
    if(_csi)_csi.style.display='flex';
    document.getElementById('chartMonthName').textContent=D.current_month.month_label||'';
    document.getElementById('chartMonthAmt').textContent=fmt(D.current_month.gmv_to_date);
  }else{
    if(_csi)_csi.style.display=(heroLockedToCurrent||idx<hist.length-1)?'flex':'none';
    document.getElementById('chartMonthName').textContent=h.m;
    document.getElementById('chartMonthAmt').textContent=fmt(h.s);
  }
  // v205c: when hero locked to current month AND init=true, prefer current month cats
  const _curCatLbl=D.current_month&&D.current_month.month_label;
  const _useCurCat=init&&heroLockedToCurrent&&_curCatLbl&&D.cats_monthly&&D.cats_monthly[_curCatLbl];
  const _catMonth=_useCurCat?_curCatLbl:h.m;
  const monthCats=D.cats_monthly&&D.cats_monthly[_catMonth]?D.cats_monthly[_catMonth]:null;
  const catbarsEl=document.getElementById('catbars');
  const _catSecSel=document.getElementById('overview-cats-sec');
  const _catHead=_catSecSel?_catSecSel.querySelector('.ct'):null;
  if(monthCats&&monthCats.length){
    if(catbarsEl)catbarsEl.innerHTML=renderCatBars(monthCats,3);
    if(_catSecSel)_catSecSel.style.display='';
    if(_catHead)_catHead.textContent=_useCurCat?'หมวดหมู่ · '+_catMonth+' MTD':(heroLockedToCurrent?'หมวดหมู่ · '+h.m:'หมวดหมู่');
  } else {
    if(_catSecSel)_catSecSel.style.display='none';
  }
  // Update outlet card for selected month
  const monthOutlets=D.outlets_monthly&&D.outlets_monthly[h.m];
  if(monthOutlets&&monthOutlets.length>0){
    D_outlets=monthOutlets;
    renderOutletCard();
    const note=document.getElementById('outlet-month-note');if(note)note.textContent=h.m;
  } else {
    D_outlets=[];
    renderOutletCard();
  }
  renderChartInsight(idx);
  renderOverviewStats(idx);
  renderInterpretation(idx);
}

// ── Overview KPI stats — 4 cards synced to selected bar month ──
// ── Category color palette (tonal green family — overrides data colors) ──
const CAT_PALETTE=['var(--tk-ok-bright)','#00888a','#2d6a4f','#52b788','#74c69d','#1e6091','var(--tk-accent)','#909090'];
function catColor(i){return CAT_PALETTE[Math.min(i,CAT_PALETTE.length-1)];}

// ── Interpretation Strip ──────────────────────────────────────────────────
function computeInterpretation(idx){
  const hist=D.history.length?D.history:SAMPLE.history;
  if(!hist.length||idx<=0)return null;
  const curr=hist[idx],prev=hist[idx-1];
  if(!curr||!prev||!prev.s)return null;
  const gmvDelta=curr.s-prev.s;
  const pctChange=Math.abs(gmvDelta)/prev.s;
  if(pctChange<0.05)return null;

  const fmtAbs=v=>Math.abs(v)>=1000?'฿'+Math.round(Math.abs(v)/1000)+'k':'฿'+Math.round(Math.abs(v));

  const currMo=curr.m,prevMo=prev.m;
  const currSkus=(D.skus_monthly&&D.skus_monthly[currMo])||[];
  const prevSkus=(D.skus_monthly&&D.skus_monthly[prevMo])||[];

  // ── ไม่มี SKU data: แสดง GMV delta เฉยๆ ──
  if(!currSkus.length||!prevSkus.length){
    const dir=gmvDelta>0?'เพิ่มขึ้น':'ลดลง';
    return{type:'type-mixed',main:`ยอดซื้อ${dir} ${fmtAbs(gmvDelta)} จากเดือนก่อน`,sub:'ไม่มีข้อมูลสินค้าสำหรับเปรียบเทียบ'};
  }

  const prevMap={};prevSkus.forEach(s=>{prevMap[String(s.id)]={qty:s.qty_kg||0,price:s.unit_price||s.u||0,dept:s.d||'อื่นๆ'};});
  const currMap={};currSkus.forEach(s=>{currMap[String(s.id)]={qty:s.qty_kg||0,price:s.unit_price||s.u||0,dept:s.d||'อื่นๆ'};});

  let priceEffect=0,volumeEffect=0;
  const catPriceDelta={},catVolDelta={};
  Object.keys(currMap).forEach(id=>{
    const c=currMap[id],p=prevMap[id];
    if(!p||!c.price||!p.price)return;
    const dept=c.dept||p.dept||'อื่นๆ';
    const pe=p.qty*(c.price-p.price);
    const ve=c.price*(c.qty-p.qty);
    priceEffect+=pe;volumeEffect+=ve;
    catPriceDelta[dept]=(catPriceDelta[dept]||0)+pe;
    catVolDelta[dept]=(catVolDelta[dept]||0)+ve;
  });

  const absPE=Math.abs(priceEffect),absVE=Math.abs(volumeEffect);
  const fmtCats=(map,n)=>Object.entries(map).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,n).filter(e=>Math.abs(e[1])>300).map(e=>`${e[0]} (${e[1]>0?'+':'-'}${fmtAbs(e[1])})`).join(' · ');

  const priceCats=fmtCats(catPriceDelta,2);
  const volCats=fmtCats(catVolDelta,2);

  let type,main,sub;
  if(absPE>absVE*1.5){
    type=priceEffect<0?'type-price-dn':'type-price-up';
    if(priceEffect<0){
      // price-down: Bucci's wording — describe fact, short, not defensive
      main=`ที่ยอดลด ${fmtAbs(gmvDelta)} — ราคาต่อหน่วยเฉลี่ยในพอร์ตลดลง`;
      sub=priceCats?`ปริมาณที่สั่งใกล้เดิม — หมวดที่ราคาลด: ${priceCats}`:'ราคาต่อหน่วยเฉลี่ยลดลง — ปริมาณที่สั่งใกล้เดิม';
    } else {
      // price-up: acknowledge uncertainty, don't blame Freshket
      main=`ที่ยอดขึ้น ${fmtAbs(gmvDelta)} — ราคาต่อหน่วยเฉลี่ยในพอร์ตสูงขึ้น`;
      sub=priceCats?`ปริมาณที่สั่งใกล้เดิม — อาจเกิดจากราคาตลาดช่วงนี้: ${priceCats}`:'ปริมาณที่สั่งใกล้เดิม — อาจเกิดจากราคาตลาดช่วงนี้';
    }
  } else if(absVE>absPE*1.5){
    type='type-volume';
    if(volumeEffect>0){
      main=`ที่ยอดขึ้น ${fmtAbs(gmvDelta)} — สั่งปริมาณมากขึ้น`;
      sub=volCats?`โดยเฉพาะหมวด ${volCats}`:'ราคาต่อหน่วยใกล้เดิม';
    } else {
      main=`ที่ยอดลด ${fmtAbs(gmvDelta)} — สั่งปริมาณน้อยลง`;
      sub=volCats?`โดยเฉพาะหมวด ${volCats}`:'ปริมาณที่สั่งลดลง — ราคาต่อหน่วยใกล้เดิม';
    }
  } else {
    type='type-mixed';
    const allDelta={};
    Object.keys(catPriceDelta).forEach(d=>{allDelta[d]=(allDelta[d]||0)+catPriceDelta[d];});
    Object.keys(catVolDelta).forEach(d=>{allDelta[d]=(allDelta[d]||0)+catVolDelta[d];});
    const mixCats=fmtCats(allDelta,2);
    const dir=gmvDelta>0?'เพิ่มขึ้น':'ลดลง';
    main=`ที่ยอดซื้อ${dir} ${fmtAbs(gmvDelta)} — ราคาและปริมาณเปลี่ยนไปพร้อมกัน`;
    sub=mixCats?`หมวดที่มีผลมากที่สุด: ${mixCats}`:'ดูรายละเอียดในหน้าสินค้า';
  }
  return {type,main,sub};
}

function renderInterpretation(idx){
  const wrap=document.getElementById('interp-strip-wrap');
  const strip=document.getElementById('interp-strip');
  const mainEl=document.getElementById('interp-main');
  const subEl=document.getElementById('interp-sub');
  if(!wrap||!strip||!mainEl||!subEl)return;
  const result=computeInterpretation(idx);
  if(!result){wrap.style.display='none';return;}
  strip.className='interp-strip '+result.type;
  mainEl.textContent=result.main;
  subEl.textContent=result.sub;
  wrap.style.display='';
}

function renderOverviewStats(idx){
  const el=document.getElementById('overview-stats');if(!el)return;
  const hist=D.history.length?D.history:SAMPLE.history;
  if(!hist.length){el.innerHTML='';return;}
  // v205c: idx=-1 → use current month data for score cards
  const _useCurMonth = idx===-1 && D.current_month && D.current_month.gmv_to_date>0;
  let h, mo;
  if(_useCurMonth){
    const cm=D.current_month;
    mo=cm.month_label||'';
    h={m:mo, s:cm.gmv_to_date, orders:Math.max(cm.orders_to_date||1,1)};
  }else{
    const safeIdx=Math.max(0,Math.min(idx||0,hist.length-1));
    h=hist[safeIdx];if(!h){el.innerHTML='';return;}
    mo=h.m;
  }
  const ords=Math.max(h.orders,1);
  const ordPerDay=ords/30;

  // ── Portfolio lens ──
  const skusMo=D.skus_monthly||{};
  const skusThisMo=skusMo[mo]||D.skus||[];
  const skuCount=skusThisMo.length;
  const cats=D.cats_monthly&&D.cats_monthly[mo]?D.cats_monthly[mo]:(D.cats||[]);
  const catCount=cats.length;
  const sortedSkus=[...skusThisMo].sort((a,b)=>(b.gmv||b.s||0)-(a.gmv||a.s||0));
  const top5gmv=sortedSkus.slice(0,5).reduce((s,x)=>s+(x.gmv||x.s||0),0);
  const top5pct=h.s>0?Math.round(top5gmv/h.s*100):0;

  // dot grid: scale skuCount → max 35 dots in 5 rows of 7
  const dotCount=Math.max(3,Math.min(35,Math.round(skuCount/Math.max(skuCount,1)*35)));
  const dots=Array.from({length:35},(_,i)=>{
    const filled=i<dotCount;
    return`<circle cx="${(i%7)*5+2.5}" cy="${Math.floor(i/7)*5+2.5}" r="1.8" fill="${filled?'var(--g500)':'var(--n200)'}"/>`;
  }).join('');
  const portfolioSvg=`<svg class="lens-vis" width="38" height="28" viewBox="0 0 38 28">${dots}</svg>`;
  const portfolioSub=`${catCount} หมวด · Top 5 = ${top5pct}%`;

  // ── Rhythm lens ──
  const avgOrd=Math.round(h.s/ords);
  const freqLabel=ordPerDay>=1?`${ordPerDay.toFixed(1)}x/วัน`:`${(ords/4.3).toFixed(1)}x/สัปดาห์`;
  const fmtAvg=v=>v>=1000?'฿'+Math.round(v/1000)+'k/ครั้ง':'฿'+v+'/ครั้ง';

  // pulse bars: 7 bars simulating weekly order pattern from frequency
  const baseH=ordPerDay>=1?16:10;
  const pulseHeights=[.7,1,.5,.9,.4,.85,.6].map(f=>Math.round(baseH*f+2));
  const pulseBars=pulseHeights.map((h,i)=>`<rect x="${i*5+1}" y="${20-h}" width="3" height="${h}" rx="1" fill="var(--g500)"/>`).join('');
  const rhythmSvg=`<svg class="lens-vis" width="38" height="22" viewBox="0 0 38 22">${pulseBars}</svg>`;

  // ── Outlets lens ──
  const outlets=D_outlets&&D_outlets.length?D_outlets:[];
  let outletMain,outletSub,outletSvg='';
  if(outlets.length>=2){
    const sorted=[...outlets].sort((a,b)=>b.gmv-a.gmv).slice(0,3);
    const maxGmv=sorted[0].gmv||1;
    const outletBars=sorted.map((o,i)=>{
      const barW=Math.round((o.gmv/maxGmv)*28);
      return`<rect x="0" y="${i*7}" width="${barW}" height="5" rx="1.5" fill="${i===0?'var(--g500)':'var(--n300)'}"/>`;
    }).join('');
    outletSvg=`<svg class="lens-vis" width="30" height="${sorted.length*7}" viewBox="0 0 30 ${sorted.length*7}">${outletBars}</svg>`;
    const topName=sorted[0].n||sorted[0].outlet_name||'สาขาหลัก';
    const topPct=h.s>0?Math.round(sorted[0].gmv/h.s*100):0;
    outletMain=`${outlets.length} สาขา`;
    outletSub=`สาขาหลัก ${topPct}% ยอดรวม`;
  } else {
    outletMain='1 สาขา';outletSub=mo;
    outletSvg=`<svg class="lens-vis" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="var(--g500)" stroke-width="2"/><circle cx="9" cy="9" r="3" fill="var(--g500)"/></svg>`;
  }

  el.innerHTML=`<div class="lens-row">
    <div class="lens-card">${portfolioSvg}<div class="lens-lbl">Portfolio</div><div class="lens-val">${skuCount} SKU</div><div class="lens-sub">${portfolioSub}</div></div>
    <div class="lens-card">${rhythmSvg}<div class="lens-lbl">AOV</div><div class="lens-val">${fmtAvg(avgOrd)}</div><div class="lens-sub">${freqLabel}</div></div>
    <div class="lens-card">${outletSvg}<div class="lens-lbl">Outlets</div><div class="lens-val">${outletMain}</div><div class="lens-sub">${outletSub}</div></div>
  </div>`;
}
// ════════════════════════════════════════
// ════════════════════════════════════════
// RENDER — PORTFOLIO
// ════════════════════════════════════════
function setPortfolioMonth(mo,btn){
  portfolioMonth=mo;
  priceMovFilter=null;
  if(window._expandPortTop)window._expandPortTop();
  document.querySelectorAll('#port-month-bar .mopill').forEach(p=>p.classList.remove('on'));
  if(btn)btn.classList.add('on');
  renderPortfolio();
  renderPortMoMInsight();
}

// SECTION:PORTFOLIO
function renderPortfolio(){
  const renderer = window.FreshketSensePortfolioRenderer;
  if(renderer && typeof renderer.renderPortfolioFromLegacy === 'function'){
    try{
      const result = renderer.renderPortfolioFromLegacy({
        D: D,
        SAMPLE: (typeof SAMPLE !== 'undefined' ? SAMPLE : {history:[],cats:[],skus:[]}),
        OPPS: OPPS,
        portfolioMonth: portfolioMonth,
        skuFilter: skuFilter,
        priceMovFilter: priceMovFilter,
        skuView: skuView,
        fmt: fmt,
        computePriceChanges: computePriceChanges,
        computeSkuMovement: computeSkuMovement,
        renderSparkline: renderSparkline,
        renderPortMoMInsight: renderPortMoMInsight,
        expandPortTop: window._expandPortTop,
        setState: function(name, value){
          if(name === 'portfolioMonth'){ portfolioMonth = value; return true; }
          if(name === 'skuFilter'){ skuFilter = value; return true; }
          if(name === 'priceMovFilter'){ priceMovFilter = value; return true; }
          if(name === 'skuView'){ skuView = value; return true; }
          return false;
        }
      });
      if(result && result.ok) return result;
    }catch(err){
      console.warn('[Freshket Sense] Portfolio renderer failed, falling back to legacy renderer:', err && err.message ? err.message : err);
    }
  }
  return __legacyRenderPortfolioFallback();
}

function __legacyRenderPortfolioFallback(){
  const hist=D.history.length?D.history:SAMPLE.history;

  // Build month list from skus_monthly (newest first)
  const _moSort=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
  const moKeys=D.skus_monthly&&Object.keys(D.skus_monthly).length?Object.keys(D.skus_monthly).sort((a,b)=>_moSort(b)-_moSort(a)):[];
  // Sync portfolioMonth: default to last month
  if(!portfolioMonth||!moKeys.includes(portfolioMonth))portfolioMonth=moKeys[0]||'';

  // Render month pills
  const barEl=document.getElementById('port-month-bar');
  if(barEl){
    if(moKeys.length>1){
      barEl.innerHTML=moKeys.map(m=>`<button class="mopill ${m===portfolioMonth?'on':''}" onclick="setPortfolioMonth('${m}',this)">${m}</button>`).join('');
      barEl.style.display='flex';
    } else { barEl.style.display='none'; }
  }
  const labelEl=document.getElementById('port-month-label');
  if(labelEl)labelEl.textContent=portfolioMonth||'';

  // Resolve skus and cats for selected month
  const skus=(portfolioMonth&&D.skus_monthly[portfolioMonth])?
    [...D.skus_monthly[portfolioMonth]].sort((a,b)=>(b.gmv||0)-(a.gmv||0)):
    (D.skus.length?D.skus:SAMPLE.skus);
  const cats=(portfolioMonth&&D.cats_monthly&&D.cats_monthly[portfolioMonth])?
    D.cats_monthly[portfolioMonth]:
    portfolioMonth&&D.skus_monthly&&D.skus_monthly[portfolioMonth]
      ?_catsFromSkus(D.skus_monthly[portfolioMonth])
      :(D.cats.length?D.cats:SAMPLE.cats);

  // v156: current month → use gmv_to_date as denominator
  const _isCurPortMo=D.current_month&&portfolioMonth===D.current_month.month_label;
  const histRow=_isCurPortMo
    ?{s:D.current_month.gmv_to_date||0,orders:D.current_month.orders_to_date||0,m:portfolioMonth}
    :hist.find(h=>h.m===portfolioMonth)||hist[hist.length-1]||{s:0,orders:0};
  const last=histRow;

  const top5=[...skus].slice(0,5);
  // Correct top5 % from actual GMV ratio
  const top5gmv=top5.reduce((s,x)=>s+(x.gmv||x.s||0),0);
  const top5pct=last.s>0?(top5gmv/last.s*100).toFixed(1):'0';
  // Order frequency
  const ords=Math.max(last.orders,1);
  const ordPerDay=ords/30;
  const freqLabel=ordPerDay>=1?`${ordPerDay.toFixed(1)} ออเดอร์/วัน`:`${(ords/4.3).toFixed(1)} ออเดอร์/สัปดาห์`;
  const hrsPerOrd=30*24/ords;
  const freqSub=ordPerDay>=1?`${last.orders} ออเดอร์ใน ${histRow?.m||'เดือนนี้'}`:`${last.orders} ออเดอร์/เดือน`;

  // ── Previous month data for comparisons ──
  const histIdx=hist.findIndex(h=>h.m===(portfolioMonth||last.m));
  const prevHistRow=histIdx>0?hist[histIdx-1]:hist.length>=2?hist[hist.length-2]:null;
  const momDelta=prevHistRow&&prevHistRow.s>0?((last.s-prevHistRow.s)/prevHistRow.s*100):null;
  const momStr=momDelta!==null
    ?`<span style="color:${momDelta<=0?'var(--g500)':'#f0b000'};font-weight:700">${momDelta>0?'▲':'▼'} ${Math.abs(momDelta).toFixed(1)}%</span> vs เดือนก่อน`
    :`${last.orders} ออเดอร์`;
  const avgOrd=Math.round(last.s/ords);
  const prevAvgOrd=prevHistRow?Math.round(prevHistRow.s/Math.max(prevHistRow.orders,1)):null;
  const avgDelta=prevAvgOrd&&prevAvgOrd>0?((avgOrd-prevAvgOrd)/prevAvgOrd*100):null;
  const avgStr=avgDelta!==null
    ?`<span style="color:${avgDelta<=0?'var(--g500)':'#9a6500'};font-weight:700">${avgDelta>0?'▲':'▼'} ${Math.abs(avgDelta).toFixed(1)}%</span> vs เดือนก่อน`
    :(hist[hist.length-1]?.m||'');

  // ── Price movement for selected portfolioMonth ──
  const _moSortD=m=>{const p=m.split(' ');const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];return(parseInt(p[1]||0)*12)+mo.indexOf(p[0]);};
  const moKeysSortedD=Object.keys(D.skus_monthly||{}).sort((a,b)=>_moSortD(b)-_moSortD(a));
  const portMoIdx=moKeysSortedD.indexOf(portfolioMonth);
  const prevPortMo=portMoIdx>=0&&portMoIdx<moKeysSortedD.length-1?moKeysSortedD[portMoIdx+1]:null;
  let priceUp=0,priceDn=0,priceStable=0,netPriceImpact=0;
  if(portfolioMonth&&prevPortMo&&D.skus_monthly[portfolioMonth]&&D.skus_monthly[prevPortMo]){
    const curPM={};(D.skus_monthly[portfolioMonth]||[]).forEach(s=>{curPM[String(s.id)]={p:s.unit_price||s.u||0,q:s.qty_kg||0};});
    const prevPM={};(D.skus_monthly[prevPortMo]||[]).forEach(s=>{prevPM[String(s.id)]={p:s.unit_price||s.u||0,q:s.qty_kg||0};});
    Object.keys(curPM).forEach(id=>{
      const c=curPM[id],pv=prevPM[id];
      if(!c.p||!pv||!pv.p)return;
      const pct=(c.p-pv.p)/pv.p*100;
      if(pct>=1)priceUp++;else if(pct<=-1)priceDn++;else priceStable++;
      netPriceImpact+=(pv.q||c.q)*(c.p-pv.p);
    });
  }
  const priceTotal=priceUp+priceDn;
  // ── Concentration card ──
  const topPctNum=parseFloat(top5pct)||0;
  const conBarColor=topPctNum>70?'rgba(240,176,0,.9)':topPctNum>=50?'rgba(255,255,255,.55)':'var(--tk-ok-bright)';
  const conInterp=topPctNum>70?'พึ่งพาสินค้าหลักสูง — ถ้า SKU เหล่านี้ขาดหรือราคาขึ้น กระทบยอดทันที':topPctNum>=50?'พอร์ตกระจายพอสมควร — ยังมี SKU อื่นรองรับหากสินค้าหลักขาด':'พอร์ตกระจายดี — ไม่พึ่งพาสินค้าใดสินค้าหนึ่งมากเกินไป';
  const topSkuEl=document.getElementById('top-sku-card');
  if(topSkuEl){
    const conBg=topPctNum>70?'var(--amb50)':topPctNum<50?'var(--tk-ok-bg)':'var(--n50)';
    const conBorder=topPctNum>70?'var(--amb)':topPctNum<50?'var(--g500)':'var(--n200)';
    const conTextColor=topPctNum>70?'#9a6500':topPctNum<50?'var(--tk-ok-text)':'var(--n600)';
    const conNumColor=topPctNum>70?'var(--amb)':topPctNum<50?'var(--g500)':'var(--n400)';
    topSkuEl.style.cssText=`background:${conBg};border-left:3px solid ${conBorder};border-radius:0 var(--rs) var(--rs) 0;padding:10px 12px;margin-bottom:12px;display:block;box-shadow:none`;
    topSkuEl.innerHTML=`<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><span style="font-size:10px;font-weight:700;letter-spacing:.5px;color:var(--n400);text-transform:uppercase">Top 5</span><span style="font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:700;color:${conNumColor}">${top5pct}%</span></div><div style="font-size:12px;color:${conTextColor};line-height:1.5;font-weight:500">${conInterp}</div>`;
  }
  // ── Category pills only ──
  const depts=['ทั้งหมด',...new Set(skus.map(s=>s.d))];
  document.getElementById('skuCatFilter').innerHTML=depts.map(d=>`<button class="fpill ${d==='ทั้งหมด'&&!priceMovFilter?'on':''}" onclick="setSkuFilter('${d}',this)">${d}</button>`).join('');
  // ── Price filter row ──
  const priceRow=document.getElementById('sku-price-filter-row');
  if(priceRow){
    priceRow.innerHTML=priceTotal>0?(priceUp>0?`<button class="fpill fpill-pu ${priceMovFilter==='up'?'on':''}" id="pf-pill-up" onclick="setPriceFilter('up')">▲ ${priceUp} ราคาขึ้น</button>`:'')+(priceDn>0?`<button class="fpill fpill-pd ${priceMovFilter==='down'?'on':''}" id="pf-pill-dn" onclick="setPriceFilter('down')">▼ ${priceDn} ราคาลง</button>`:'')
:'';
    priceRow.style.display=priceTotal>0?'flex':'none';
  }
  renderSKUList(skus);
  renderPortMoMInsight();
  if(window._expandPortTop)window._expandPortTop();
}

function renderSKUList(passedSkus){
  const renderer = window.FreshketSensePortfolioRenderer;
  if(renderer && typeof renderer.renderSKUListFromLegacy === 'function'){
    try{
      const result = renderer.renderSKUListFromLegacy({
        D: D,
        SAMPLE: (typeof SAMPLE !== 'undefined' ? SAMPLE : {skus:[]}),
        OPPS: OPPS,
        portfolioMonth: portfolioMonth,
        skuFilter: skuFilter,
        priceMovFilter: priceMovFilter,
        skuView: skuView,
        fmt: fmt,
        computePriceChanges: computePriceChanges,
        computeSkuMovement: computeSkuMovement,
        renderSparkline: renderSparkline
      }, passedSkus);
      if(result && result.ok) return result;
    }catch(err){
      console.warn('[Freshket Sense] SKU list renderer failed, falling back to legacy renderer:', err && err.message ? err.message : err);
    }
  }
  return __legacyRenderSKUListFallback(passedSkus);
}

function __legacyRenderSKUListFallback(passedSkus){
  const rawSkus=passedSkus||(portfolioMonth&&D.skus_monthly[portfolioMonth]?D.skus_monthly[portfolioMonth]:D.skus.length?D.skus:SAMPLE.skus);
  const skus=[...rawSkus].sort((a,b)=>(b.gmv||b.s||0)-(a.gmv||a.s||0));
  const search=(document.getElementById('skuSearch')?.value||'').toLowerCase();
  let filtered=skus;
  if(skuFilter!=='ทั้งหมด')filtered=filtered.filter(s=>s.d===skuFilter);
  if(search)filtered=filtered.filter(s=>s.n.toLowerCase().includes(search));
  if(priceMovFilter){
    const pcMap2={};computePriceChanges().forEach(p=>{pcMap2[String(p.id)]=p;});
    filtered=filtered.filter(s=>{
      const pc=pcMap2[String(s.id)];const pct=pc?pc.pct:0;
      if(priceMovFilter==='up')return pc&&pct>=1;
      if(priceMovFilter==='down')return pc&&pct<=-1;
      if(priceMovFilter==='stable')return !pc||(pct>-1&&pct<1);
      return true;
    });
  }
  document.getElementById('sku-total-count').textContent=skus.length+' รายการ';
  document.getElementById('sku-showing-count').textContent=`แสดง ${filtered.length} รายการ${search||skuFilter!=='ทั้งหมด'||priceMovFilter?' (filtered)':''}`;
  // Pre-compute badge data once (not per-row)
  const priceChanges=computePriceChanges();
  const pcMap={};priceChanges.forEach(p=>{pcMap[p.id]=p;});
  const oppIds=new Set(OPPS.map(o=>String(o.curId)));
  const skuMov=computeSkuMovement();
  const newIds=new Set((skuMov?.newSkus||[]).map(s=>{
    // newSkus has name not id — match by name
    const found=rawSkus.find(r=>r.n===s.name);return found?String(found.id):'';
  }).filter(Boolean));
  const declIds=new Set((skuMov?.declining||[]).map(s=>{
    const found=rawSkus.find(r=>r.n===s.name);return found?String(found.id):'';
  }).filter(Boolean));
  // sortedMoKeys for sparklines (oldest→newest, left→right)
  const sortedMoKeys=Object.keys(D.skus_monthly||{}).sort((a,b)=>_moSortAsc(a)-_moSortAsc(b));
  document.getElementById('skulist').innerHTML=filtered.map((s,i)=>{
    const origRank=skus.findIndex(x=>x.id===s.id)+1;
    const rankClass=origRank===1?'top1':origRank===2?'top2':origRank===3?'top3':origRank<=5?'top5':'';
    const sid=String(s.id);
    // Build badges — max 2 shown (price/new, then opp)
    let badges='';
    const pc=pcMap[sid];
    if(newIds.has(sid)){
      badges+=`<span class="skbadge skbadge-new">เพิ่งเริ่มสั่ง</span>`;
    } else if(pc){
      if(pc.pct>0) badges+=`<span class="skbadge skbadge-price-up">▲ ${Math.abs(pc.pct).toFixed(1)}% vs เดือนก่อน</span>`;
      else badges+=`<span class="skbadge skbadge-price-dn">▼ ${Math.abs(pc.pct).toFixed(1)}% vs เดือนก่อน</span>`;
    } else if(declIds.has(sid)){
      badges+=`<span class="skbadge skbadge-anomaly">สั่งลดลง</span>`;
    }
    if(oppIds.has(sid)) badges+=`<span class="skbadge skbadge-opp">มีตัวเลือก</span>`;
    const badgeRow=badges?`<div class="sku-badge-row">${badges}</div>`:'';
    if(skuView==='price'){
      const spark=renderSparkline(sid,sortedMoKeys,64,22);
      return`<div class="skrow" style="cursor:pointer;-webkit-tap-highlight-color:rgba(0,0,0,.04)" onclick="openSkuDetail('${sid}')">
        <div class="skrk ${rankClass}">${origRank}</div>
        <div style="flex:1;min-width:0"><div class="skn">${s.n}</div><div class="skc">${s.d}${s.pack_size?' · '+s.pack_size:''} · ฿${(s.display_price||s.u||0).toFixed(s.display_price>=100?0:2)}/${s.display_unit||'กก.'}</div>${badgeRow}</div>
        <div style="flex-shrink:0;display:flex;align-items:center;padding-left:8px">${spark}</div>
      </div>`;
    }
    return`<div class="skrow"><div class="skrk ${rankClass}">${origRank}</div><div style="flex:1;min-width:0"><div class="skn">${s.n}</div><div class="skc">${s.d}${s.pack_size?' · '+s.pack_size:''} · ฿${(s.display_price||s.u||0).toFixed(s.display_price>=100?0:2)}/${s.display_unit||'กก.'}</div>${badgeRow}</div><div style="flex-shrink:0"><div class="sksp">${fmt(s.s)}</div><div class="skpc">${s.p}%</div></div></div>`;
  }).join('')||'<div style="padding:20px;text-align:center;color:var(--n400);font-size:13px">ไม่พบสินค้า</div>';
}
function filterSKUs(){renderSKUList();}
function setSkuFilter(cat,btn){
  skuFilter=cat;priceMovFilter=null;
  document.querySelectorAll('#skuCatFilter .fpill').forEach(p=>p.classList.remove('on'));
  btn.classList.add('on');
  renderSKUList();
}
function setPriceFilter(type){
  priceMovFilter=(priceMovFilter===type)?null:type;
  skuFilter='ทั้งหมด';
  document.querySelectorAll('#skuCatFilter .fpill').forEach(p=>p.classList.remove('on'));
  if(!priceMovFilter){const a=document.querySelector('#skuCatFilter .fpill');if(a)a.classList.add('on');}
  const upPill=document.getElementById('pf-pill-up');
  const dnPill=document.getElementById('pf-pill-dn');
  if(upPill)upPill.classList.toggle('on',priceMovFilter==='up');
  if(dnPill)dnPill.classList.toggle('on',priceMovFilter==='down');
  renderSKUList();
}

// ════════════════════════════════════════
// RENDER — OPPORTUNITIES
// ════════════════════════════════════════
function _oppImpact(o){
  try{const a=getAlt(o);return Number(a&&a.save)||0;}catch(e){return 0;}
}
function _oppSortImpact(a,b){
  const d=_oppImpact(b)-_oppImpact(a);
  if(d!==0)return d;
  return (Number(b.monthlyGmv)||0)-(Number(a.monthlyGmv)||0);
}
function getFilteredOpps(){
  // v207a: Opportunity should rank by actionable impact (monthly savings), not spend size.
  let opps=[...OPPS].sort(_oppSortImpact);
  let n;
  if(oppFilter==='top10')n=10;else if(oppFilter==='top20')n=20;else if(oppFilter==='top50')n=50;
  else if(oppFilter==='custom')n=parseInt(document.getElementById('opp-n-input')?.value)||0;
  if(n)opps=opps.slice(0,n);
  return opps;
}

// SECTION:OPPORTUNITIES
function renderOpps(){
  const opps=getFilteredOpps();
  // Hero — show filtered set savings (B4)
  const filtMo=opps.reduce((s,o)=>s+getAlt(o).save,0);
  const filtYr=filtMo*12;
  const spend=curSpend();const pct=spend>0?(filtMo/spend*100).toFixed(1):'0';
  // Sprint 2: toggle between sense-result-hdr (earned) and opphdr (raw savings)
  const srhWrap=document.getElementById('sense-result-hdr');
  const opphdrEl=document.getElementById('opphdr');
  if(srhWrap)srhWrap.style.display=senseActivated&&OPPS.length>0?'block':'none';
  if(opphdrEl)opphdrEl.style.display=senseActivated&&OPPS.length>0?'none':'block';

  if(senseActivated&&OPPS.length>0){
    // Sense-result-hdr: count + sub
    const srhCount=document.getElementById('srh-count');
    const srhSub=document.getElementById('srh-sub');
    const lastMo=D.history.length?D.history[D.history.length-1].m:'';
    // Compact dial arc
    const _senseMetrics2=getSenseScoreMetrics();
    const _score2=_senseMetrics2.score;
    const _circ=263.9;
    const _sColor2=_score2>=72?'var(--tk-ok-text)':_score2>=55?'var(--amb)':'var(--org)';
    const _schArc=document.getElementById('sch-darc');
    const _schTxt=document.getElementById('sch-score-txt');
    if(_schArc){_schArc.style.stroke=_score2>=72?'var(--g500)':_score2>=55?'var(--amb)':'var(--org)';setTimeout(()=>{_schArc.style.strokeDashoffset=String(_circ-(_score2/100)*_circ);},80);}
    if(_schTxt){_schTxt.style.fill=_sColor2;_schTxt.textContent=String(_score2);}
    // Band label on score bar
    const _ssbBand=document.getElementById('ssb-band');
    if(_ssbBand)_ssbBand.textContent=_score2>=85?'บริหารต้นทุนดีมาก':_score2>=72?'บริหารดี ยังมีช่อง':_score2>=58?'มีช่องประหยัดได้':'Sense เจอราคาคุ้มกว่ามาก';
    if(srhCount){
      if(aiCameFromPreview){srhCount.textContent='0';
        const _se=Date.now();
        (function _st(){const _p=Math.min((Date.now()-_se)/900,1);const _e=1-Math.pow(1-_p,3);srhCount.textContent=String(Math.round(OPPS.length*_e));if(_p<1)requestAnimationFrame(_st);else srhCount.textContent='มี '+OPPS.length+' รายการที่ราคาคุ้มกว่า';})();
      }else{srhCount.textContent='มี '+OPPS.length+' รายการที่ราคาคุ้มกว่า';}
    }
    if(srhSub)srhSub.textContent='สแกน '+(D.alts.length||D.skus.length||'—')+' SKU'+(lastMo?' · ยอดซื้อ '+lastMo:'');
    // Bridge: show on first land (before plan selected), hide after
    const srhBridge=document.getElementById('srh-bridge');
    if(srhBridge){srhBridge.style.display=footerUnlocked?'none':'block';}
    if(aiCameFromPreview){
      aiCameFromPreview=false;
      const _oh=document.getElementById('opphdr');
      if(_oh){_oh.classList.add('ai-active');setTimeout(()=>{_oh.classList.remove('ai-active');},3200);}
    }
  } else {
    // Original opphdr: savings
    const hdrYr=document.getElementById('opphdr-yr');const hdrMo=document.getElementById('opphdr-mo');
    const hdrPct=document.getElementById('opphdr-pct');const hdrUnit=document.getElementById('opphdr-yr-unit');
    if(hdrMo)hdrMo.style.display='';
    if(hdrYr){if(aiCameFromPreview){aiCameFromPreview=false;hdrYr.textContent=fmt(0);animN(hdrYr,filtYr,1200);}else{hdrYr.textContent=fmt(filtYr);}}
    if(hdrMo)hdrMo.textContent=fmt(filtMo);
    if(hdrPct)hdrPct.textContent='−'+pct+'%';
    if(hdrUnit)hdrUnit.textContent=opps.length<OPPS.length?`ต่อปี · ${opps.length}/${OPPS.length} รายการ`:`ต่อปี · ${OPPS.length} รายการ`;
    const condLabel=document.getElementById('opphdr-cond-label');
    if(condLabel)condLabel.textContent=`ถ้าเปลี่ยนครบทั้ง ${OPPS.length} รายการ`;
    const vintEl=document.getElementById('opphdr-vintage-mo');
    const lastMo=D.history.length?D.history[D.history.length-1].m:'';
    if(vintEl&&lastMo)vintEl.textContent=lastMo;
  }
  // Gap 8: cross-month warning
  let xwarnEl=document.getElementById('xmonth-warn');
  const xwarnMsg=checkCrossMonthWarning();
  if(xwarnMsg&&OPPS.length>0){
    if(!xwarnEl){xwarnEl=document.createElement('div');xwarnEl.id='xmonth-warn';xwarnEl.className='xmonth-warn';const oppSec=document.getElementById('scr-opportunities');if(oppSec){const sec=oppSec.querySelector('.sec');if(sec)sec.insertBefore(xwarnEl,sec.querySelector('.opphdr'));}}
    if(xwarnEl)xwarnEl.innerHTML=`⚠ ${xwarnMsg}`;
  } else if(xwarnEl){xwarnEl.style.display='none';}
  const lastMo=D.history.length?D.history[D.history.length-1].m:'';
  const vintEl=document.getElementById('opphdr-vintage-mo');if(vintEl&&lastMo)vintEl.textContent=lastMo;
  // AI reasoning transparency: show number of pairs evaluated
  const aiCtx=document.getElementById('opphdr-ai-context');
  const aiPairs=document.getElementById('opphdr-ai-pairs');
  if(aiCtx&&aiPairs&&D.alts.length>0){
    aiPairs.textContent=D.alts.length;
    aiCtx.style.display='inline';
  } else if(aiCtx) aiCtx.style.display='none';
  // Filter info
  const gmvSum=opps.reduce((s,o)=>s+o.monthlyGmv,0);
  // filter-info now rendered inside renderPlanBuilder dynamic HTML
  // Hide legacy standalone verify banner if exists
  const vBanner=document.getElementById('opp-verify-banner');
  if(vBanner)vBanner.style.display='none';
  // Empty state (B5) — differentiate no-data vs no-alts
  if(OPPS.length===0){
    const hasSkus=D.skus.length>0;
    const emptyTitle=hasSkus?'ยังไม่มีข้อมูลทางเลือก':'ยังไม่มีข้อมูล';
    const emptyBody=hasSkus?'SKU ของร้านโหลดแล้ว — กด Generate เพื่อให้ AI หาทางเลือกที่ถูกกว่า':'อัปโหลดไฟล์ข้อมูลเพื่อเริ่มต้น';
    const emptyBtn=hasSkus?`<button class="es-btn" onclick="openDataPanel();setTimeout(()=>{setDpMode('quick');document.getElementById('dp-quick-matcher')?.scrollIntoView({behavior:'smooth',block:'start'});},350)">Generate โอกาสประหยัด</button>`:`<button class="es-btn" onclick="openDataPanel()">อัปโหลดข้อมูล</button>`;
    document.getElementById('opplist').innerHTML=`<div class="empty-state"><div class="es-title">${emptyTitle}</div><div class="es-body">${emptyBody}</div>${emptyBtn}</div>`;
    return;
  }
  // Always Plan Builder (no view toggle)
  renderPlanBuilder(opps);
  updatePbFooter();
}

// ── PLAN BUILDER ──
function renderPlanBuilder(opps){
  const allHigh=opps.filter(o=>getAlt(o).conf==='high');
  const highSave=allHigh.reduce((s,o)=>s+getAlt(o).save,0);
  const allSave=opps.reduce((s,o)=>s+getAlt(o).save,0);
  const verifyDone=allHigh.length>0;
  // Plan selector panel
  // ── PLAN TABS ──
  const isAll=currentPlanMode==='all';
  const isHigh=currentPlanMode==='high';
  // Tab content panel: changes based on active plan
  const tabPanel=isHigh
    ?`<div class="ptc-desc">Sense คัดสเปคใกล้เคียงไว้แล้ว · ลองเทียบกับเมนูของร้านก่อนสั่ง</div>
      <div class="ptc-nums">${allHigh.length} รายการ · <span class="plan-save">${fmt(highSave)}</span><span style="font-size:9px;opacity:.7">/เดือน</span></div>
      <div class="ptc-rerun" onclick="openVerifySheet()">✦ เทียบสเปคเพิ่ม</div>`
    :`<div class="ptc-desc">บางตัวควรเทสกับเมนูก่อน</div>
      <div class="ptc-nums">${opps.length} รายการ · <span class="plan-save">${fmt(allSave)}</span><span style="font-size:9px;opacity:.7">/เดือน</span></div>`;
  // Filter pills HTML (dynamic, replaces static HTML)
  const _f=oppFilter||'all';
  const _ni=typeof oppNInput!=='undefined'?oppNInput:0;
  const _customVal=(()=>{try{return document.getElementById('opp-n-input')?.value||'';}catch(e){return'';}})();
  const filterPillsHtml=`<div class="fpills" id="oppfilter">
    <button class="pill ${_f==='all'?'on':''}" onclick="setOppFilter('all',this)">ทั้งหมด</button>
    <button class="pill ${_f==='top10'?'on':''}" onclick="setOppFilter('top10',this)">Top 10</button>
    <button class="pill ${_f==='top20'?'on':''}" onclick="setOppFilter('top20',this)">Top 20</button>
    <button class="pill ${_f==='top50'?'on':''}" onclick="setOppFilter('top50',this)">Top 50</button>
    <button class="pill ${_f==='custom'?'on':''}" onclick="setOppFilter('custom',this)">กำหนดเอง</button>
  </div>
  <div id="opp-custom-row" style="display:${_f==='custom'?'block':'none'};margin:4px 0 8px">
    <input type="number" id="opp-n-input" min="1" value="${_customVal}" placeholder="จำนวน SKU" style="width:100%;padding:7px 12px;border:1.5px solid var(--n200);border-radius:20px;font-size:13px;font-family:var(--tk-font-body);outline:none" oninput="renderOpps()">
  </div>
`;

  let smartHtml=`<div class="plan-selector">
    <div class="plan-sel-title">เลือกแผนของคุณ</div>
    <div class="plan-tabs">
      <div class="plan-tab ${isAll?'active':''}" onclick="smartSelect('all',event)">
        <div class="plan-tab-row"><span class="plan-tab-title">${'คุ้มที่สุดที่ Sense หาได้'}</span><span class="plan-tab-val ${isAll?'on':''}">${fmt(allSave)+'/เดือน'}</span></div>
        <div class="plan-tab-sub">ประหยัดได้ · ${opps.length} รายการ</div>
      </div>
      <div class="plan-tab sense-tab ${isHigh?'active':''}${!verifyDone?' cta-mode':''}" onclick="${verifyDone?'smartSelect(\'high\',event)':'openVerifySheet()'}">
        <div class="plan-tab-row"><span class="plan-tab-title sense"><span class="pvc-star"><svg width="8" height="8" viewBox="0 0 10 10" fill="var(--tk-ok-bright)"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg></span> ให้ Sense ตรวจสเปค</span><span class="plan-tab-val sense">${!verifyDone?'เทียบสเปค →':(fmt(highSave)+'/เดือน')}</span></div>
        <div class="plan-tab-sub">${!verifyDone?'ยังไม่ได้ตรวจ':(allHigh.length+' รายการ ✓')}</div>
      </div>
    </div>
    <div class="plan-tab-panel">${tabPanel}</div>
  </div>${filterPillsHtml}`;

  // Group by category — v207a: categories and rows both sort by impact high → low.
  const catGroups={};
  opps.forEach(o=>{if(!catGroups[o.cat])catGroups[o.cat]=[];catGroups[o.cat].push(o);});
  const catEntries=Object.entries(catGroups).map(([cat,items])=>{
    items.sort(_oppSortImpact);
    return [cat,items];
  }).sort((a,b)=>{
    const as=a[1].reduce((s,o)=>s+_oppImpact(o),0);
    const bs=b[1].reduce((s,o)=>s+_oppImpact(o),0);
    if(bs!==as)return bs-as;
    return String(a[0]).localeCompare(String(b[0]),'th');
  });

  let groupsHtml='<div class="pb-groups">';
  catEntries.forEach(([cat,items])=>{
    const catSave=items.reduce((s,o)=>s+(sel.has(o.id)?getAlt(o).save:0),0);
    const catTotal=items.reduce((s,o)=>s+getAlt(o).save,0);
    const selCount=items.filter(o=>sel.has(o.id)).length;
    const totalCount=items.length;
    const allCatSel=selCount===totalCount;
    const partialSel=selCount>0&&!allCatSel;
    const badgeClass=allCatSel?'full':partialSel?'partial':'';
    const badgeLabel=allCatSel?`✓ ${selCount}/${totalCount}`:selCount>0?`${selCount}/${totalCount}`:`0/${totalCount}`;
    const collapsed=collapsedCats.has(cat);
    groupsHtml+=`<div class="pb-cat-group" id="pbg-${CSS.escape(cat)}">
      <div class="pb-cat-hdr${collapsed?' collapsed':''}" onclick="togglePbCat('${cat.replace(/'/g,"\\'")}')">
        <div class="pb-cat-hdr-left">
          <span class="pb-cat-name">${cat}</span>
        </div>
        <div class="pb-cat-hdr-right">
          <span class="pb-cat-spend">${fmt(catTotal)}/เดือน</span>
          <button class="pb-cat-badge ${badgeClass}" onclick="event.stopPropagation();selectCat('${cat.replace(/'/g,"\\'")}')">${badgeLabel}</button>
          <span class="pb-cat-chev">▾</span>
        </div>
      </div>`;
    if(!collapsed){
      items.forEach(o=>{
        const isSel=sel.has(o.id);const chosen=getAlt(o);const altExpanded=pbExpandedAlts.has(o.id);
        const hasAlts=o.alts.length>1;
        const badgeClass=`pb-pct-badge${chosen.conf!=='high'?' med':''}${hasAlts?' tappable':''}${(hasAlts&&altExpanded)?' open':''}`;
        groupsHtml+=`<div class="pb-item-wrap">
          <div class="pb-item${isSel?' sel':''}" id="pbi-${o.id}">
            <div class="pb-ck${isSel?' sel':''}" onclick="toggleOpp(${o.id});event.stopPropagation()">${isSel?'✓':''}</div>
            <div class="pb-item-body" onclick="openDetailSheet(${o.id})">
              <div class="pb-item-name">${o.curName}</div>
              <div class="pb-item-arrow">→ <strong>${chosen.altName}</strong></div>
            </div>
            <div class="pb-item-info-hint" onclick="openDetailSheet(${o.id});event.stopPropagation()" title="ดูรายละเอียด"><i>i</i></div>
            <div class="pb-right-block">
              <div class="pb-save-amt">${fmt(chosen.save)}</div>
              <div class="${badgeClass}" ${hasAlts?`onclick="togglePbAlt(${o.id});event.stopPropagation()"`:''}>
                −${chosen.pct}%${hasAlts?'<span class="pchev">▾</span>':''}
              </div>
            </div>
          </div>`;
        // Alt picker
        if(altExpanded){
          const selIdx=selAlt[o.id]??o.alts.findIndex(a=>a.recommended)??0;
          groupsHtml+=`<div class="pb-alt-expand"><div class="pb-alt-expand-label">เลือกสินค้าทดแทน</div>`;
          o.alts.forEach((a,ai)=>{
            const isSe=ai===selIdx;
            groupsHtml+=`<div class="pb-alt-row${isSe?' sel':''}" onclick="selectAlt(event,${o.id},${ai})">
              <div class="pb-alt-radio"><div class="pb-alt-radio-dot"></div></div>
              <div class="pb-alt-info">
                <div class="pb-alt-name">${a.altName}${a.recommended?'<span class="pb-alt-rec">★ แนะนำ</span>':''}</div>
                <div class="pb-alt-sub">${a.altSpec||''}${a.altSpec?' · ':''}<span class="pb-conf-badge ${a.conf}">${a.conf==='high'?'✓ มั่นใจสูง':'— ทดลองก่อน'}</span></div>
              </div>
              <div class="pb-alt-right">
                <div class="pb-alt-save">${fmt(a.save)}</div>
                <div class="pb-alt-pct">−${a.pct}%</div>
              </div>
            </div>`;
          });
          groupsHtml+='</div>';
        }
        groupsHtml+='</div>'; // pb-item-wrap
      });
    }
    groupsHtml+='</div>'; // pb-cat-group
  });
  groupsHtml+='</div>';

  const pickHintHtml=(!footerUnlocked&&senseActivated)?'<div id="opplist-pick-hint">เลือกแบบด้านบนก่อน</div>':'';
  document.getElementById('opplist').innerHTML=smartHtml+pickHintHtml+groupsHtml;
}

function togglePbCat(cat){
  collapsedCats.has(cat)?collapsedCats.delete(cat):collapsedCats.add(cat);
  renderOpps();
}

function togglePbAlt(id){
  pbExpandedAlts.has(id)?pbExpandedAlts.delete(id):pbExpandedAlts.add(id);
  renderOpps();
}

function smartSelect(mode,e){
  if(e)e.stopPropagation();
  currentPlanMode=mode;
  const opps=getFilteredOpps();
  sel.clear();
  if(mode==='high'){opps.filter(o=>getAlt(o).conf==='high').forEach(o=>sel.add(o.id));}
  else{opps.forEach(o=>sel.add(o.id));}
  footerUnlocked=true; // Sprint 2: plan tapped = savings earned
  // Unmute cards with reveal animation
  const oppList=document.getElementById('opplist');
  if(oppList&&oppList.classList.contains('opplist-muted')){
    oppList.classList.add('opplist-unmuting');
    oppList.classList.remove('opplist-muted');
    setTimeout(()=>oppList.classList.remove('opplist-unmuting'),500);
  }
  renderOpps();updateSim();
}

function selectCat(cat){
  const opps=getFilteredOpps().filter(o=>o.cat===cat);
  const allSel=opps.every(o=>sel.has(o.id));
  if(allSel){opps.forEach(o=>sel.delete(o.id));}else{opps.forEach(o=>sel.add(o.id));}
  currentPlanMode='custom';
  renderOpps();updateSim();debouncedSave();
}

function updatePbFooter(){
  const footer=document.getElementById('pb-footer');if(!footer)return;
  const grpB=document.getElementById('swipe-grp-b');
  const inKamSense=document.body.classList.contains('kam-sense-active');
  const inGrpB=grpB&&grpB.classList.contains('on')&&(!isKAM||inKamSense);
  const show=inGrpB&&footerUnlocked&&sel.size>0;
  if(inKamSense){
    footer.classList.add('hidden'); // pb-footer hidden; SPS in pill handles display
    if(show){
      const t=totalSel(),yr=t*12;
      const lastM=D.history.length?D.history[D.history.length-1].m:'';
      const sc=document.getElementById('spr-count'),sa=document.getElementById('spr-amt'),ss=document.getElementById('spr-sub');
      if(sc)sc.textContent=sel.size+' รายการ';
      if(sa){sa.innerHTML=fmt(t)+'<span class="sps-unit"> / เดือน</span>';}
      if(ss)ss.textContent=fmt(yr)+' / ปี'+(lastM?' · จากยอดซื้อ '+lastM:'');
      document.body.classList.add('sense-plan-active');
      if(!_planTrayOpen)_openPlanTray();
    }else{ document.body.classList.remove('sense-plan-active'); _closePlanTray(); }
    return;
  }else{
    footer.classList.toggle('hidden',!show);
  }
  if(show){
    const t=totalSel();const yr=t*12;
    document.getElementById('pf-count').textContent=sel.size+' รายการ';
    document.getElementById('pf-mo').textContent=fmt(t)+' / เดือน';
    document.getElementById('pf-yr').textContent=fmt(yr)+' / ปี';
    const lastMoF=D.history.length?D.history[D.history.length-1].m:'';
    const pfVint=document.getElementById('pf-vintage');if(pfVint)pfVint.textContent=lastMoF?`จากยอดซื้อ ${lastMoF}`:'ประมาณการจากเดือนล่าสุด';
  }
}


// ════════════════════════════════════════
// DETAIL SHEET
// ════════════════════════════════════════
function openDetailSheet(oppId){
  const opp=OPPS.find(o=>o.id===oppId);if(!opp)return;
  const catColor=getCatColor(opp.cat)||'var(--n600)';
  document.getElementById('detail-sheet-cat').textContent=opp.cat;
  document.getElementById('detail-sheet-cat').style.color=catColor;
  document.getElementById('detail-sheet-title').textContent=opp.curName;
  document.getElementById('detail-sheet-body').innerHTML=renderSingleCard(opp);
  document.getElementById('detailSheet').classList.add('open');
  document.getElementById('detailOverlay').classList.add('on');
  document.body.style.overflow='hidden';
}

function sheetTogglePlan(id){
  sel.has(id)?sel.delete(id):sel.add(id);
  currentPlanMode='custom';
  // Update button state inline without closing sheet
  const btn=document.getElementById('sheet-plan-btn-'+id);
  if(btn){
    const now=sel.has(id);
    btn.textContent=now?'✓ อยู่ในแผนแล้ว':'+ เพิ่มเข้าแผน';
    btn.style.borderColor=now?'var(--tk-ok-500)':'var(--n200)';
    btn.style.background=now?'var(--tk-ok-bg)':'var(--n0)';
    btn.style.color=now?'var(--tk-ok-text)':'var(--n700)';
  }
  updatePbFooter();updateSim();
}

function closeDetailSheet(){
  document.getElementById('detailSheet').classList.remove('open');
  document.getElementById('detailOverlay').classList.remove('on');
  document.body.style.overflow='';
  // Re-render plan builder so arrow/savings reflects any alt change made in sheet
  renderOpps();
}

function renderSingleCard(o){
  const ck=sel.has(o.id);
  const selIdx=selAlt[o.id]??o.alts.findIndex(a=>a.recommended)??0;
  const chosen=o.alts[selIdx]||o.alts[0];
  const altRows=o.alts.map((a,i)=>{
    const isSel=i===selIdx;
    const hasNote=a.note&&a.note.length>3;
    return`<div class="oalt-row ${isSel?'selected':''}" onclick="selectAlt(event,${o.id},${i})"><div class="oalt-radio"><div class="oalt-radio-dot"></div></div><div class="oalt-info"><div class="oalt-name">${a.altName}${a.recommended?`<span class="oalt-rec">★ แนะนำ</span>`:''} <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--n400);font-weight:400">#${a.altId}</span></div><div class="oalt-spec">${a.altSpec||''}${a.altSpec?' · ':''}<span style="font-size:9px;font-weight:700;color:${a.conf==='high'?'var(--tk-ok-text)':'var(--amb)'}">${a.conf==='high'?'✓ มั่นใจสูง':'ทดลองก่อน'}</span></div>${hasNote?`<div class="oalt-note">${a.note}</div>`:''}</div><div class="oalt-right"><div class="oalt-price">฿${(a.altP||0).toLocaleString('th-TH')}/${o.priceUnitLabel||'kg'}</div><div class="oalt-save${a.conf!=='high'?' med':''}">${'−'+a.pct+'%'}</div></div></div>`;
  }).join('');
  const confTag=chosen.conf==='high'
    ?`<span style="color:var(--tk-ok-text);font-weight:700">✓ มั่นใจสูง</span>`
    :`<span style="color:var(--amb);font-weight:700">— ทดลองก่อน</span>`;
  const _qtyUnit=deriveQtyUnit(o.curSpec,o.priceBasis);
  return`<div style="padding:8px 13px 10px;border-bottom:1px solid var(--n100)">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
      <div style="min-width:0;flex:1">
        <div style="font-size:12px;color:var(--n500);font-weight:500">${o.curSpec}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;color:var(--n400);text-decoration:line-through;white-space:nowrap">฿${(o.curP||0).toLocaleString('th-TH')}/${o.priceUnitLabel||'kg'}</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--n500);margin-top:3px;white-space:nowrap">${fmt(o.monthlyGmv)}/เดือน · ${o.monthlyQty||'?'} ${_qtyUnit}</div>
      </div>
    </div>
  </div>
  <div class="oalt-section" style="padding-top:12px">${altRows}</div>
  <div class="osave">
    <div>
      <div class="osave-lbl">ประหยัดได้ต่อเดือน</div>
      <div class="osave-sub" id="osave-sub-${o.id}">${o.monthlyQty||'?'} ${_qtyUnit}/เดือน · ลด ${chosen.pct}%</div>
    </div>
    <div>
      <div class="osave-num" id="osave-num-${o.id}">${fmt(chosen.save)}</div>
      <div class="osave-yr" id="osave-yr-${o.id}">${fmt(chosen.save*12)} / ปี</div>
    </div>
  </div>
  ${chosen.caveat?`<div class="onote" style="color:var(--amb);border-top:1px solid var(--n100);padding-top:8px">▲ ${chosen.caveat}</div>`:''}
  <div style="padding:12px 13px 4px;display:flex;align-items:center;justify-content:space-between;gap:10px">
    <button id="sheet-plan-btn-${o.id}" style="flex:1;padding:11px;border-radius:10px;border:1.5px solid ${ck?'var(--g500)':'var(--n200)'};background:${ck?'var(--tk-ok-bg)':'var(--n0)'};color:${ck?'var(--tk-ok-text)':'var(--n700)'};font-size:13px;font-weight:700;font-family:var(--tk-font-body);cursor:pointer;transition:all .2s" onclick="sheetTogglePlan(${o.id})">${ck?'✓ อยู่ในแผนแล้ว':'+ เพิ่มเข้าแผน'}</button>
  </div>`;
}

// ── CARD VIEW (legacy — used internally only) ──
function renderOppCards(opps){}

// ── TABLE VIEW ──
function renderOppTable(opps){
  document.getElementById('opplist').innerHTML='<div style="border:1px solid var(--bd);border-radius:var(--r);overflow:hidden">'+
    opps.map((o,i)=>{
      const a=getAlt(o);const ck=sel.has(o.id);const exp=expandedOpps.has(o.id);
      const altRows=exp?o.alts.map((alt,ai)=>{
        const isSe=(selAlt[o.id]??o.alts.findIndex(x=>x.recommended)??0)===ai;
        return`<div class="ot-expand-row ${isSe?'ot-exp-sel':''}" onclick="selectAlt(event,${o.id},${ai})"><div style="width:14px;height:14px;border-radius:50%;border:2px solid ${isSe?'var(--g500)':'var(--n300)'};background:${isSe?'var(--g500)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-left:28px">${isSe?'<div style="width:5px;height:5px;border-radius:50%;background:#fff"></div>':''}</div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600">${alt.altName}${alt.recommended?' <span style="font-size:9px;background:var(--tk-ok-bg);color:var(--g800);border-radius:10px;padding:2px 6px;font-weight:700">★</span>':''}</div><div style="font-size:11px;font-weight:600;color:${alt.conf==='high'?'var(--tk-ok-text)':'var(--amb)'};margin-top:1px">${alt.conf==='high'?'✓ มั่นใจสูง':'— ทดลองก่อน'}</div></div><div style="text-align:right;flex-shrink:0"><div style="font-size:13px;font-weight:700;color:${alt.conf==='high'?'var(--tk-ok-text)':'var(--amb)'};font-family:'IBM Plex Mono',monospace">${fmt(alt.save)}</div><div style="font-size:11px;color:var(--n600);font-weight:500;margin-top:2px">${fmt(alt.save*12)+'/ปี <span style="font-family:IBM Plex Mono,monospace;font-weight:700">−'+alt.pct+'%</span>'}</div></div></div>`;
      }).join(''):'';
      return`<div class="ot-row-wrap${i>0?' ot-border-top':''}" id="otr-${o.id}"><div class="ot-main-row" onclick="toggleExpand(${o.id})"><div style="font-size:11px;color:var(--n600);font-weight:600;width:18px;flex-shrink:0">${i+1}</div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${o.curName}</div><div style="font-size:11px;color:var(--n600);font-weight:500;margin-top:1px">${o.cat} · ${fmt(o.monthlyGmv)}/เดือน</div></div><div style="text-align:right;flex-shrink:0;margin-right:8px"><div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;color:var(--tk-ok-text)">${fmt(a.save)}</div><div style="font-size:11px;color:var(--n600);font-weight:500;margin-top:1px">${fmt(a.save*12)}/ปี · <strong style='font-family:IBM Plex Mono,monospace'>−${a.pct}%</strong></div></div><div style="display:flex;align-items:center;gap:6px;flex-shrink:0"><div style="font-size:14px;color:var(--n400);transition:transform .2s;transform:rotate(${exp?180:0}deg)">▾</div><div class="ot-chk ${ck?'on':''}" onclick="event.stopPropagation();toggleOpp(${o.id})">${ck?'<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>':''}</div></div></div>${exp?`<div class="ot-expand-body">${altRows}</div>`:''}</div>`;
    }).join('')+'</div>';
}

function toggleExpand(id){expandedOpps.has(id)?expandedOpps.delete(id):expandedOpps.add(id);renderOpps();}
// setOppView removed — single view
function setOppFilter(f,btn){oppFilter=f;renderOpps();}

function selectAlt(e,oppId,altIdx){
  e.stopPropagation();
  selAlt[oppId]=altIdx;
  const opp=OPPS.find(o=>o.id===oppId);if(!opp)return;
  // Partial DOM update — works for both detail sheet and any card in DOM
  const chosen=opp.alts[altIdx]||opp.alts[0];
  document.querySelectorAll(`[id^="oc"]`);// find context
  const sheet=document.getElementById('detailSheet');
  if(sheet&&sheet.classList.contains('open')){
    sheet.querySelectorAll('.oalt-row').forEach((row,i)=>row.classList.toggle('selected',i===altIdx));
    const saveEl=document.getElementById('osave-num-'+oppId);const yrEl=document.getElementById('osave-yr-'+oppId);const subEl=document.getElementById('osave-sub-'+oppId);
    if(saveEl){saveEl.textContent=fmt(chosen.save);saveEl.style.color='';}if(yrEl)yrEl.textContent=fmt(chosen.save*12)+' / ปี';
    if(subEl){const qu=deriveQtyUnit(opp.curSpec,opp.priceBasis);subEl.textContent=(opp.monthlyQty||'?')+' '+qu+'/เดือน · ลด '+chosen.pct+'%';}
  } else {renderOpps();}
  updateSim();updatePbFooter();
}

function toggleOpp(id){
  sel.has(id)?sel.delete(id):sel.add(id);
  currentPlanMode='custom';
  footerUnlocked=true; // Sprint 2: individual selection also earns the footer
  renderOpps();updateSim();updatePbFooter();
}

// ════════════════════════════════════════
// RENDER — SIMULATOR
// ════════════════════════════════════════
// ════════════════════════════════════════
// SCENARIO PLANNER
// ════════════════════════════════════════

// Legacy stubs (still called from toggleSim, selectAll)
function updateSim(){renderOpps();updatePbFooter();}
function toggleSim(id){sel.has(id)?sel.delete(id):sel.add(id);renderOpps();updatePbFooter();}
function selectAll(){OPPS.forEach(o=>sel.add(o.id));renderOpps();updatePbFooter();}

// ════════════════════════════════════════
// ONBOARDING
// ════════════════════════════════════════
function checkOnboarding(){
  // v143: intro/onboarding disabled. Keep this function as a safe no-op
  // because the initial app boot still calls it when sample data is loaded.
  try{localStorage.setItem('ciq_visited','1');}catch(e){}
  const overlay=document.getElementById('onboard-overlay');
  if(overlay)overlay.style.display='none';
}

function closeOnboarding(){
  document.getElementById('onboard-overlay').style.display='none';
  try{localStorage.setItem('ciq_visited','1');}catch(e){}
}

function onboardSample(){
  closeOnboarding();
  useSampleData();
}

function onboardSetup(){
  closeOnboarding();
  document.getElementById('dataPanel').classList.add('open');
  document.getElementById('dataOverlay').classList.add('on');
  setDpMode('bulk');
  updateDpAccountCard();renderAccountLibrary();
}

// ════════════════════════════════════════
// RENDER — REPORT (fixed: uses totalSel, shows both plan + full potential)
// ════════════════════════════════════════
function renderReport(){
  const renderer = window.FreshketSenseReportRenderer;
  if(renderer && typeof renderer.renderFromLegacy === 'function'){
    try{
      const result = renderer.renderFromLegacy({
        D: D,
        SAMPLE: (typeof SAMPLE !== 'undefined' ? SAMPLE : {history:[]}),
        OPPS: OPPS,
        sel: sel,
        getAlt: getAlt,
        totalSel: totalSel,
        curSpend: (typeof curSpend === 'function' ? curSpend : function(){ return 0; }),
        fmt: fmt
      });
      if(result && result.ok) return result;
    }catch(err){
      console.warn('[Freshket Sense] Report renderer failed, falling back to legacy renderer:', err && err.message ? err.message : err);
    }
  }
  return __legacyRenderReportFallback();
}

function __legacyRenderReportFallback(){
  const hist=D.history.length?D.history:SAMPLE.history;
  const last=hist[hist.length-1]||{s:0,m:''};
  const acctName=D.meta.accountName||'ร้านอาหาร';
  const kamName=D.meta.kamName||'—';
  const lastMo=last.m||'—';
  const spend=typeof curSpend==='function'?curSpend():0;
  // v494: sort by save desc, group by category
  const selItems=[...OPPS.filter(o=>sel.has(o.id))].sort((a,b)=>getAlt(b).save-getAlt(a).save);
  const selSave=totalSel();
  const savPct=spend>0?(selSave/spend*100).toFixed(1):'—';
  const highCount=selItems.filter(o=>getAlt(o).conf==='high').length;
  const medCount=selItems.length-highCount;
  const dateStr=new Date().toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric'});

  // Header
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('rpt2-acct',acctName);
  set('rpt2-date',dateStr);
  set('rpt2-kam','KAM: '+kamName);
  set('rpt2-kpi-spend',fmt(spend));
  set('rpt2-kpi-save-mo',fmt(selSave));
  set('rpt2-kpi-save-count',selItems.length+' รายการที่เลือก');
  set('rpt2-kpi-save-yr',fmt(selSave*12));
  set('rpt2-kpi-pct',(savPct!=='—'?savPct+'%':'—')+' ของยอดซื้อ');
  set('rpt2-kpi-high',highCount+' รายการ — ใช้แทนได้เลย');
  set('rpt2-kpi-med',medCount+' รายการ — แนะนำทดสอบก่อน');

  // Table rows — grouped by category
  const tbody=document.getElementById('rpt2-tbody');
  if(tbody){
    if(!selItems.length){
      tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--n400);font-size:12px">ยังไม่ได้เลือกรายการ — กลับไปหน้า Sense เพื่อเลือก</td></tr>';
    } else {
      const catMap={};const catOrder=[];
      selItems.forEach(o=>{const cat=o.cat||'อื่นๆ';if(!catMap[cat]){catMap[cat]=[];catOrder.push(cat);}catMap[cat].push(o);});
      let rowNum=0;
      tbody.innerHTML=catOrder.map(cat=>{
        const gItems=catMap[cat];
        const gSave=gItems.reduce((s,o)=>s+getAlt(o).save,0);
        const catRow=`<tr class="rpt2-cat-row"><td colspan="7"><span class="rpt2-cat-name">${cat}</span><span class="rpt2-cat-meta">${gItems.length} รายการ</span><span class="rpt2-cat-save">${fmt(gSave)} / เดือน</span></td></tr>`;
        const rows=gItems.map(o=>{
          rowNum++;
          const a=getAlt(o);
          const confHigh=a.conf==='high';
          const confMed=a.conf==='medium';
          const curMeta=`#${o.curId}${o.curSpec?' · '+o.curSpec:''}${o.curP>0?' · ฿'+o.curP+'/'+o.curU:''}`;
          const altMeta=`#${a.altId}${a.altSpec?' · '+a.altSpec:''}${a.altP>0?' · ฿'+a.altP+'/'+a.altU:''}`;
          const dotCls=confHigh?'rpt2-dot-hi':confMed?'rpt2-dot-med':'rpt2-dot-lo';
          return`<tr>
            <td class="rpt2-num">${rowNum}</td>
            <td><div class="rpt2-sku-name">${o.curName}</div><div class="rpt2-sku-meta">${curMeta}</div></td>
            <td class="rpt2-arr">→</td>
            <td><div class="rpt2-sku-name">${a.altName}</div><div class="rpt2-sku-meta">${altMeta}</div></td>
            <td class="rpt2-gmv"><div class="rpt2-gmv-val">${fmt(o.monthlyGmv||0)}</div><div class="rpt2-gmv-qty">${o.monthlyQty>0?+(+o.monthlyQty).toFixed(1)+' '+(o.qu||''):''}</div></td>
            <td class="rpt2-save"><div class="rpt2-save-amt">${fmt(a.save)}</div><div><span class="rpt2-save-pct${confHigh?' high':''}">−${a.pct}%</span></div></td>
            <td class="rpt2-conf"><span class="rpt2-dot ${dotCls}"></span></td>
          </tr>`;
        }).join('');
        return catRow+rows;
      }).join('');
    }
  }

  // Total row
  const tfoot=document.getElementById('rpt2-tfoot');
  if(tfoot&&selItems.length>0){
    tfoot.innerHTML=`<tr class="rpt2-total-row">
      <td colspan="5"><span class="rpt2-total-label">รวม ${selItems.length} รายการที่เลือกในแผน</span></td>
      <td class="rpt2-save"><div class="rpt2-total-amt">${fmt(selSave)} / เดือน</div><div class="rpt2-total-yr">${fmt(selSave*12)} / ปี</div></td>
      <td></td>
    </tr>`;
  } else if(tfoot){tfoot.innerHTML='';}

  const noteEl=document.getElementById('rpt2-note');
  if(noteEl)noteEl.textContent='* ประมาณการจากยอดซื้อและราคาสินค้า '+lastMo+' — ตัวเลขจริงอาจต่างกันตามปริมาณและราคาที่เปลี่ยนแปลง';
}

// ════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════


// ════════════════════════════════════════
// SQL TEMPLATES
// ════════════════════════════════════════
// SECTION:SQL_TEMPLATES
const BULK_SQL={
Q8E:`-- ════════════════════════════════════════════════════════════
-- Q8E v3: Portview Enriched + KAM Mapping
-- FIX: days_elapsed now uses MAX(delivery_date) not CURRENT_DATE
--      corrects ~12-14% pace underestimation from day-1 data lag
-- ════════════════════════════════════════════════════════════
-- Output: portview.csv
-- Columns: account_id, account_name, last_month_gmv, gmv_to_date,
--          days_elapsed, days_in_month, runrate_gmv, account_type,
--          churned_sku_count, churned_gmv, top_churned_names,
--          missing_cat_count, missing_cats,
--          last_month_sku_count, cur_sku_count, orders_to_date,
--          kam_name  ← NEW (col 17, 0-indexed)
-- Refresh: Daily (7:00 AM)
--
-- STEP 1: Upload kam_account_mapping.csv เป็น BQ table ก่อน
--   BigQuery Console → dataset ชั่วคราว (เช่น freshket-rn.ops_staging)
--   → Create table → Upload → ตั้งชื่อ kam_account_mapping
--   Schema: kam_name STRING, account_id STRING,
--           account_name STRING, account_type STRING
--
-- STEP 2: รัน query นี้ → Save → CSV → portview.csv
-- ════════════════════════════════════════════════════════════

WITH params AS (
  SELECT
    DATE_TRUNC(CURRENT_DATE(), MONTH)                                                              AS cur_month_start,
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)                                 AS last_month_start,
    -- max_date: latest delivery_date with actual data (data pipeline = day -1 lag)
    -- Using this instead of CURRENT_DATE() prevents days_elapsed overcounting by 1 day
    (SELECT MAX(delivery_date) FROM \`dwh.order\`
     WHERE delivery_date >= DATE_TRUNC(CURRENT_DATE(), MONTH))                                    AS max_date,
    EXTRACT(DAY FROM DATE_SUB(DATE_TRUNC(DATE_ADD(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH), INTERVAL 1 DAY)) AS days_in_month
),

-- params_derived: computes days_elapsed from max_date (not CURRENT_DATE)
-- Fix: days_elapsed 8 → 7 when data only goes to yesterday
-- Effect: pace +~14% more accurate; runrate corrected proportionally
params_derived AS (
  SELECT
    cur_month_start,
    last_month_start,
    max_date,
    days_in_month,
    DATE_DIFF(max_date, DATE_TRUNC(max_date, MONTH), DAY) + 1 AS days_elapsed
  FROM params
),

-- ── KAM Mapping (source of truth: kam_account_mapping.csv) ──
-- กรองเฉพาะ accounts ที่มี KAM ถือ — ตัดร้านที่ไม่มีเจ้าของออก
kam_list AS (
  SELECT kam_name, kam_email, tl_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email)
  ])
),
-- v201f: dynamic KAM mapping (replaces hardcoded 623-row list) | 90d churn window
-- v207g: current portfolio owner source-of-truth = user_master.staff_owner_email.
-- Fallback to latest order owner only when the master record has no owner email.
user_master_current AS (
  SELECT *
  FROM \`freshket-rn.dim.user_master\`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),
master_kam_accounts AS (
  SELECT um.account_guid AS account_id, k.kam_name, k.kam_email, k.tl_email, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_map AS (
  SELECT account_id, kam_name, kam_email, tl_email
  FROM master_kam_accounts
),

-- Last month GMV — เฉพาะ accounts ใน mapping
last_month AS (
  SELECT
    o.account_id,
    MAX(o.account_name)       AS account_name,
    MAX(o.res_name)           AS res_name,
    ROUND(SUM(i.gmv_ex_vat), 0) AS last_month_gmv,
    MAX(o.account_type)       AS account_type,
    COUNT(DISTINCT i.item_id) AS last_month_sku_count
  FROM \`dwh.order\` o, UNNEST(o.item) AS i, params_derived p
  INNER JOIN kam_map km ON o.account_id = km.account_id   -- ← filter to KAM accounts only
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.last_month_start
    AND i.gmv_ex_vat > 0
  GROUP BY 1
),

-- Current month GMV
current_month AS (
  SELECT
    o.account_id,
    ROUND(SUM(i.gmv_ex_vat), 0) AS gmv_to_date,
    COUNT(DISTINCT o.order_id)   AS orders_to_date,
    COUNT(DISTINCT i.item_id)    AS cur_sku_count
  FROM \`dwh.order\` o, UNNEST(o.item) AS i, params_derived p
  INNER JOIN kam_map km ON o.account_id = km.account_id
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.cur_month_start
    AND o.delivery_date <= p.max_date  -- cap at latest available date
    AND i.gmv_ex_vat > 0
  GROUP BY 1
),

-- SKU churn: ordered last month (≥3 times) but NOT this month
last_month_skus AS (
  SELECT
    o.account_id, i.item_id, i.item_name_th,
    COUNT(DISTINCT o.order_id) AS order_count,
    ROUND(SUM(i.gmv_ex_vat), 0) AS gmv
  FROM \`dwh.order\` o, UNNEST(o.item) AS i, params_derived p
  INNER JOIN kam_map km ON o.account_id = km.account_id
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.last_month_start
    AND i.gmv_ex_vat > 0
  GROUP BY 1, 2, 3
  HAVING order_count >= 3
),

current_month_skus AS (
  SELECT DISTINCT o.account_id, i.item_id
  FROM \`dwh.order\` o, UNNEST(o.item) AS i, params_derived p
  INNER JOIN kam_map km ON o.account_id = km.account_id
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.cur_month_start
    AND o.delivery_date <= p.max_date  -- cap at latest available date
    AND i.gmv_ex_vat > 0
),

churn_summary AS (
  SELECT
    lm.account_id,
    COUNT(*)                   AS churned_sku_count,
    ROUND(SUM(lm.gmv), 0)     AS churned_gmv,
    STRING_AGG(lm.item_name_th, ' | ' ORDER BY lm.gmv DESC LIMIT 5) AS top_churned_names
  FROM last_month_skus lm
  LEFT JOIN current_month_skus cm
    ON lm.account_id = cm.account_id AND lm.item_id = cm.item_id
  WHERE cm.item_id IS NULL
  GROUP BY 1
),

-- Category gap: had GMV last month but zero this month
last_month_cats AS (
  SELECT
    o.account_id, i.category_high_level AS cat,
    ROUND(SUM(i.gmv_ex_vat), 0) AS gmv
  FROM \`dwh.order\` o, UNNEST(o.item) AS i, params_derived p
  INNER JOIN kam_map km ON o.account_id = km.account_id
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.last_month_start
    AND i.gmv_ex_vat > 0
  GROUP BY 1, 2
  HAVING gmv >= 3000
),

current_month_cats AS (
  SELECT DISTINCT o.account_id, i.category_high_level AS cat
  FROM \`dwh.order\` o, UNNEST(o.item) AS i, params_derived p
  INNER JOIN kam_map km ON o.account_id = km.account_id
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.cur_month_start
    AND o.delivery_date <= p.max_date  -- cap at latest available date
    AND i.gmv_ex_vat > 0
),

cat_gap_summary AS (
  SELECT
    lc.account_id,
    COUNT(*) AS missing_cat_count,
    STRING_AGG(lc.cat || ' (' || CAST(lc.gmv AS STRING) || ')', ' | ' ORDER BY lc.gmv DESC) AS missing_cats
  FROM last_month_cats lc
  LEFT JOIN current_month_cats cc
    ON lc.account_id = cc.account_id AND lc.cat = cc.cat
  WHERE cc.cat IS NULL
  GROUP BY 1
),

-- KAM assignment date: first order date under current KAM (proxy for handoff date).
-- v207g: if master owner moved but no order has happened under the new KAM yet, set 0
-- so NRR treats it as transfer-in/pending first order instead of old core.
kam_since AS (
  SELECT
    account_id,
    ka_owner,
    MIN(delivery_date) AS first_order_date
  FROM \`dwh.order\`
  WHERE ka_owner IS NOT NULL
    AND ka_owner NOT IN ('ka.sa.admin', 'Admin Freshket')
    AND delivery_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
  GROUP BY 1, 2
),
last_known_order_owner AS (
  SELECT
    account_id,
    ka_owner AS last_order_kam,
    delivery_date AS last_order_date
  FROM \`dwh.order\`
  WHERE account_type IN ('SA','MC','Chain','Unknown')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY delivery_date DESC) = 1
)

SELECT
  lm.account_id,
  lm.account_name,
  lm.last_month_gmv,
  COALESCE(cm.gmv_to_date, 0)                                                                     AS gmv_to_date,
  p.days_elapsed,
  p.days_in_month,
  ROUND(COALESCE(cm.gmv_to_date, 0) / NULLIF(p.days_elapsed, 0) * p.days_in_month, 0)            AS runrate_gmv,
  lm.account_type,
  COALESCE(ch.churned_sku_count, 0)                                                               AS churned_sku_count,
  COALESCE(ch.churned_gmv, 0)                                                                     AS churned_gmv,
  ch.top_churned_names,
  COALESCE(cg.missing_cat_count, 0)                                                               AS missing_cat_count,
  cg.missing_cats,
  lm.last_month_sku_count,
  COALESCE(cm.cur_sku_count, 0)                                                                    AS cur_sku_count,
  COALESCE(cm.orders_to_date, 0)                                                                   AS orders_to_date,
  km.kam_name                                                                                      AS kam_name,   -- col 16
  km.kam_email                                                                                     AS kam_email,  -- col 17
  km.tl_email                                                                                      AS tl_email,   -- col 18
  CASE
    -- v207h: if the latest order owner is not the current master owner, this is a pending transfer
    -- until the first order under the new owner happens. This must win over any older historical
    -- order the account may have had under the same KAM in the last 12 months.
    WHEN lko.last_order_kam IS NOT NULL AND LOWER(TRIM(lko.last_order_kam)) != LOWER(TRIM(km.kam_name)) THEN 0
    WHEN ks.first_order_date IS NOT NULL THEN DATE_DIFF(CURRENT_DATE(), ks.first_order_date, DAY)
    ELSE NULL
  END                                                                                                 AS days_with_current_kam  -- col 19; v207h: 0 = transfer pending first order

FROM last_month lm
INNER JOIN kam_map km       ON lm.account_id = km.account_id
LEFT JOIN current_month cm  ON lm.account_id = cm.account_id
LEFT JOIN churn_summary ch  ON lm.account_id = ch.account_id
LEFT JOIN cat_gap_summary cg ON lm.account_id = cg.account_id
LEFT JOIN kam_since ks      ON lm.account_id = ks.account_id AND ks.ka_owner = km.kam_name
LEFT JOIN last_known_order_owner lko ON lm.account_id = lko.account_id
CROSS JOIN params_derived p

QUALIFY ROW_NUMBER() OVER (
  PARTITION BY km.kam_name, COALESCE(lm.res_name, lm.account_id)
  ORDER BY COALESCE(cm.gmv_to_date, 0) DESC, lm.last_month_gmv DESC
) = 1

ORDER BY km.kam_name, COALESCE(cm.gmv_to_date, 0) / NULLIF(lm.last_month_gmv * p.days_elapsed / p.days_in_month, 0) ASC;
`,
Q9B:`-- ════════════════════════════════════════════════════════════
-- Q9 v2: Bulk History — KAM accounts × 6 months
-- ════════════════════════════════════════════════════════════
-- Output: bulk_history.csv
-- Refresh: Weekly (จันทร์ 6:00 AM)

WITH kam_list AS (
  SELECT kam_name, kam_email, tl_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email)
  ])
),
-- v201f: dynamic KAM mapping (replaces hardcoded 623-row list) | 90d churn window
-- v207g: current portfolio owner source-of-truth = user_master.staff_owner_email.
-- Fallback to latest order owner only when the master record has no owner email.
user_master_current AS (
  SELECT *
  FROM \`freshket-rn.dim.user_master\`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),
master_kam_accounts AS (
  SELECT um.account_guid AS account_id, k.kam_name, k.kam_email, k.tl_email, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_map AS (
  SELECT account_id, kam_name, kam_email, tl_email
  FROM master_kam_accounts
),

-- res_primary: for each (KAM, res_name), find the primary account_id
-- Primary = account with most recent order → ensures migrated accounts collapse to new ID
res_last_order AS (
  SELECT
    km.kam_name,
    o.res_name,
    o.account_id,
    MAX(o.delivery_date) AS last_order_date
  FROM \`freshket-rn.dwh.order\` o
  INNER JOIN kam_map km ON o.account_id = km.account_id
  WHERE o.res_name IS NOT NULL
    AND o.delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH), MONTH)
  GROUP BY 1, 2, 3
),
res_primary AS (
  SELECT kam_name, res_name, account_id AS primary_account_id
  FROM res_last_order
  QUALIFY ROW_NUMBER() OVER (PARTITION BY kam_name, res_name ORDER BY last_order_date DESC) = 1
)

SELECT
  COALESCE(rp.primary_account_id, o.account_id) AS account_id,
  MAX(o.account_name) AS account_name,
  CASE EXTRACT(MONTH FROM DATE_TRUNC(o.delivery_date, MONTH))
    WHEN 1  THEN 'ม.ค.'  WHEN 2  THEN 'ก.พ.'  WHEN 3  THEN 'มี.ค.'
    WHEN 4  THEN 'เม.ย.' WHEN 5  THEN 'พ.ค.'  WHEN 6  THEN 'มิ.ย.'
    WHEN 7  THEN 'ก.ค.'  WHEN 8  THEN 'ส.ค.'  WHEN 9  THEN 'ก.ย.'
    WHEN 10 THEN 'ต.ค.'  WHEN 11 THEN 'พ.ย.'  WHEN 12 THEN 'ธ.ค.'
  END || ' ' || CAST(EXTRACT(YEAR FROM DATE_TRUNC(o.delivery_date, MONTH)) + 543 AS STRING) AS month_label,
  ROUND(SUM(i.gmv_ex_vat), 0) AS gmv,
  COUNT(DISTINCT o.order_id)  AS orders

FROM \`dwh.order\` o, UNNEST(o.item) AS i
INNER JOIN kam_map km ON o.account_id = km.account_id
LEFT JOIN res_primary rp ON km.kam_name = rp.kam_name AND o.res_name = rp.res_name

WHERE o.delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH), MONTH)
  AND o.delivery_date <  DATE_TRUNC(CURRENT_DATE(), MONTH)
  AND i.gmv_ex_vat > 0

GROUP BY 1, 3
ORDER BY 1, 3;
`,
Q7B:`-- ════════════════════════════════════════════════════════════════════════════
-- Q7B — Bulk SKU Current Month-to-Date (KAM Cost IQ)
-- Output: account_id, item_id, item_name_th, order_count_mtd, gmv_mtd, last_order_date
-- Window: current month start → today (Asia/Bangkok)
-- Filter: 653 piloted accounts (from kam_account_mapping_v2.csv)
-- Locked rules: gmv_ex_vat, no order status filter, account_id from dwh.order
-- ════════════════════════════════════════════════════════════════════════════

WITH kam_list AS (
  SELECT kam_name, kam_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email)
  ])
),
-- v201f: dynamic KAM mapping (replaces hardcoded 623-row list) | 90d churn window
-- v207g: current portfolio owner source-of-truth = user_master.staff_owner_email.
-- Fallback to latest order owner only when the master record has no owner email.
user_master_current AS (
  SELECT *
  FROM \`freshket-rn.dim.user_master\`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),
master_kam_accounts AS (
  SELECT um.account_guid AS account_id, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_map AS (
  SELECT account_id FROM master_kam_accounts
),
mtd_items AS (
  SELECT
    o.account_id,
    o.order_id,
    o.delivery_date,
    i.item_id,
    i.item_name_th,
    i.gmv_ex_vat
  FROM \`freshket-rn.dwh.order\` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_map ON o.account_id = kam_map.account_id
  WHERE TRUE
    AND o.delivery_date >= DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH)
    AND o.delivery_date <= CURRENT_DATE('Asia/Bangkok')
)
SELECT
  account_id,
  CAST(item_id AS STRING) AS item_id,
  ANY_VALUE(item_name_th) AS item_name_th,
  COUNT(DISTINCT order_id) AS order_count_mtd,
  ROUND(SUM(gmv_ex_vat), 2) AS gmv_mtd,
  MAX(delivery_date) AS last_order_date
FROM mtd_items
WHERE item_id IS NOT NULL
GROUP BY account_id, item_id
ORDER BY account_id, gmv_mtd DESC;
`,
Q2B:`-- ════════════════════════════════════════════════════════════
-- Q2B v3: Bulk Categories — KAM accounts × 6 months + current month MTD
-- ════════════════════════════════════════════════════════════
-- Output: bulk_categories.csv
-- Refresh: Daily (7:00 AM)

WITH kam_list AS (
  SELECT kam_name, kam_email, tl_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email)
  ])
),
-- v201f: dynamic KAM mapping (replaces hardcoded 623-row list) | 90d churn window
-- v207g: current portfolio owner source-of-truth = user_master.staff_owner_email.
-- Fallback to latest order owner only when the master record has no owner email.
user_master_current AS (
  SELECT *
  FROM \`freshket-rn.dim.user_master\`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),
master_kam_accounts AS (
  SELECT um.account_guid AS account_id, k.kam_name, k.kam_email, k.tl_email, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_map AS (
  SELECT account_id, kam_name, kam_email, tl_email
  FROM master_kam_accounts
),
-- v3: max_date caps current month at latest pipeline data (avoids 1-day lag overcounting)
params AS (
  SELECT (SELECT MAX(delivery_date) FROM \`dwh.order\`
          WHERE delivery_date >= DATE_TRUNC(CURRENT_DATE(), MONTH)) AS max_date
)

SELECT
  o.account_id,
  CASE EXTRACT(MONTH FROM DATE_TRUNC(o.delivery_date, MONTH))
    WHEN 1  THEN 'ม.ค.'  WHEN 2  THEN 'ก.พ.'  WHEN 3  THEN 'มี.ค.'
    WHEN 4  THEN 'เม.ย.' WHEN 5  THEN 'พ.ค.'  WHEN 6  THEN 'มิ.ย.'
    WHEN 7  THEN 'ก.ค.'  WHEN 8  THEN 'ส.ค.'  WHEN 9  THEN 'ก.ย.'
    WHEN 10 THEN 'ต.ค.'  WHEN 11 THEN 'พ.ย.'  WHEN 12 THEN 'ธ.ค.'
  END || ' ' || CAST(EXTRACT(YEAR FROM DATE_TRUNC(o.delivery_date, MONTH)) + 543 AS STRING) AS month_label,
  i.category_high_level AS category,
  ROUND(SUM(i.gmv_ex_vat), 0) AS gmv

FROM \`dwh.order\` o, UNNEST(o.item) AS i
CROSS JOIN params p
INNER JOIN kam_map km ON o.account_id = km.account_id

WHERE o.delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH), MONTH)
  AND o.delivery_date <= p.max_date  -- v3: include current month MTD (raw GMV, not run rate)
  AND i.gmv_ex_vat > 0

GROUP BY 1, 2, 3
ORDER BY 1, 2, gmv DESC;`,
Q3B:`-- ════════════════════════════════════════════════════════════════════════════
-- Q3B v3 — Bulk SKU Monthly (KAM Cost IQ · pack_size + outlet_count_sku + bi_source unit)
-- Columns (18): account_id, month_label, item_id, item_name_th, dept,
--               subclass, temperature, pack_size,
--               gmv_ex_vat, pct, qty_kg, unit_price, order_count, avg_piece_price,
--               outlet_count_sku, default_unit_group, ea_unit_name, universal_ea_value
-- Window: last 2 complete months + current month MTD (Mar/Apr/May at time of export)
-- Locked rules: gmv_ex_vat, no order status filter, account_id from dwh.order
-- pack_size: from item.pack_size in dwh.order → drives unit label detection (ขวด/ถัง/กก.)
-- bi_source join: adds default_unit_group/ea_unit_name/universal_ea_value for bundle pricing
-- ════════════════════════════════════════════════════════════════════════════

WITH kam_list AS (
  SELECT kam_name, kam_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email)
  ])
),
-- v201f: dynamic KAM mapping (replaces hardcoded 623-row list) | 90d churn window
-- v207g: current portfolio owner source-of-truth = user_master.staff_owner_email.
-- Fallback to latest order owner only when the master record has no owner email.
user_master_current AS (
  SELECT *
  FROM \`freshket-rn.dim.user_master\`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),
master_kam_accounts AS (
  SELECT um.account_guid AS account_id, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_map AS (
  SELECT account_id FROM master_kam_accounts
),

raw AS (
  SELECT
    o.account_id,
    DATE_TRUNC(o.delivery_date, MONTH)   AS month_date,
    CAST(i.item_id AS STRING)            AS item_id,
    i.item_name_th,
    COALESCE(i.category_high_level_v2, i.category_high_level, '')  AS dept,
    COALESCE(i.subclass_name, '')        AS subclass,
    COALESCE(i.temperature, '')          AS temperature,
    COALESCE(i.pack_size, '')            AS pack_size,
    i.gmv_ex_vat,
    i.qty,
    i.price_ex_vat,                      -- price per ordering unit (ขวด, ถัง, kg, etc.)
    o.order_id,
    o.user_id                             -- outlet identifier for outlet_count_sku
  FROM \`freshket-rn.dwh.order\` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_map ON o.account_id = kam_map.account_id
  WHERE TRUE
    AND o.delivery_date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH), INTERVAL 2 MONTH)
    AND o.delivery_date <= CURRENT_DATE('Asia/Bangkok')
    AND i.item_id IS NOT NULL
),

monthly_total AS (
  SELECT account_id, month_date, SUM(gmv_ex_vat) AS total_gmv
  FROM raw
  GROUP BY account_id, month_date
),

agg AS (
  SELECT
    r.account_id,
    r.month_date,
    r.item_id,
    ANY_VALUE(r.item_name_th)                                          AS item_name_th,
    ANY_VALUE(r.dept)                                                  AS dept,
    ANY_VALUE(r.subclass)                                              AS subclass,
    ANY_VALUE(r.temperature)                                           AS temperature,
    ANY_VALUE(r.pack_size)                                             AS pack_size,
    ROUND(SUM(r.gmv_ex_vat), 2)                                        AS gmv_ex_vat,
    ROUND(SUM(r.qty), 3)                                               AS qty_kg,
    -- unit_price = per-kg price (used when item is sold by weight)
    ROUND(SAFE_DIVIDE(SUM(r.gmv_ex_vat), NULLIF(SUM(r.qty), 0)), 2)   AS unit_price,
    COUNT(DISTINCT r.order_id)                                         AS order_count,
    -- avg_piece_price = avg price per ordering unit (ขวด/ถัง/pack)
    -- when this differs from unit_price, the app detects per-unit pricing
    ROUND(AVG(r.price_ex_vat), 2)                                      AS avg_piece_price,
    -- outlet_count_sku = outlets that actually ordered this SKU (≠ total outlet count)
    -- used for per-outlet frequency → churn interval logic in app
    COUNT(DISTINCT r.user_id)                                          AS outlet_count_sku
  FROM raw r
  GROUP BY r.account_id, r.month_date, r.item_id
)

SELECT
  a.account_id,
  CONCAT(
    CASE EXTRACT(MONTH FROM month_date)
      WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
      WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
      WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
      WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
    END,
    ' ',
    CAST(EXTRACT(YEAR FROM a.month_date) + 543 AS STRING)
  ) AS month_label,
  a.item_id,
  a.item_name_th,
  a.dept,
  a.subclass,
  a.temperature,
  a.pack_size,                           -- ← drives ขวด/ถัง/กก. detection in app
  a.gmv_ex_vat,
  ROUND(SAFE_DIVIDE(a.gmv_ex_vat, t.total_gmv) * 100, 1) AS pct,
  a.qty_kg,
  a.unit_price,
  a.order_count,
  a.avg_piece_price,
  a.outlet_count_sku,
  COALESCE(m.default_unit_group, '')  AS default_unit_group,   -- 'EACH' | 'WEIGHT' | ''
  COALESCE(m.ea_unit_name, '')        AS ea_unit_name,          -- กระป๋อง/ขวด/ถุง/แพ็ค etc.
  COALESCE(m.universal_ea_value, 0)   AS universal_ea_value     -- N per pack (24, 12, 20 ...)
FROM agg a
JOIN monthly_total t USING (account_id, month_date)
LEFT JOIN \`freshket-rn.bi_source.item_master_merchandise\` m ON CAST(m.item_id AS STRING) = a.item_id
ORDER BY a.account_id, a.month_date DESC, a.gmv_ex_vat DESC;
`,
Q4B:`
-- ── Helper: extract total liters from pack_size string ──────────────────
-- Mirrors parsePackSizeUnits() in v160 JS. Returns NULL if not a liquid pack.
CREATE TEMP FUNCTION extract_pack_liters(ps STRING) AS ((
  CASE
    -- N x M ml  (e.g. "24 x 320 ml./Carton")
    WHEN REGEXP_CONTAINS(ps, r'(?i)\d+\.?\d*\s*[xX]\s*\d+\.?\d*\s*ml\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(?i)(\d+\.?\d*)\s*[xX]') AS FLOAT64)
           * CAST(REGEXP_EXTRACT(ps, r'(?i)[xX]\s*(\d+\.?\d*)\s*ml') AS FLOAT64)
           / 1000
    -- N ml  (e.g. "700 ml./bottle")
    WHEN REGEXP_CONTAINS(ps, r'(?i)\d+\.?\d*\s*ml\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(?i)(\d+\.?\d*)\s*ml') AS FLOAT64) / 1000
    -- N x M liter/litre/lt/L
    WHEN REGEXP_CONTAINS(ps, r'(?i)\d+\.?\d*\s*[xX]\s*\d+\.?\d*\s*(liter|litre|lt|L)\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(?i)(\d+\.?\d*)\s*[xX]') AS FLOAT64)
           * CAST(REGEXP_EXTRACT(ps, r'(?i)[xX]\s*(\d+\.?\d*)\s*(liter|litre|lt|L)') AS FLOAT64)
    -- N liter/litre/lt  (e.g. "18 liter/Tin", "13.75Litre/each", "1 liter/bottle")
    WHEN REGEXP_CONTAINS(ps, r'(?i)\d+\.?\d*\s*(liter|litre|lt)\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(?i)(\d+\.?\d*)\s*(liter|litre|lt)') AS FLOAT64)
    -- Single "L" (e.g. "5 L/bottle") — must be preceded by digit to avoid false matches
    WHEN REGEXP_CONTAINS(ps, r'\d+\.?\d*\s*L\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(\d+\.?\d*)\s*L\b') AS FLOAT64)
    ELSE NULL
  END
));

-- ════════════════════════════════════════════════════════════
-- Q4B v2: Bulk Alternatives — KAM accounts × last month
-- ════════════════════════════════════════════════════════════
-- Output: bulk_alternatives.csv
-- Refresh: Weekly (จันทร์ 6:00 AM)
-- Notes:
--   • Last month only (closed) — stable within month
--   • catalog CTE ยังใช้ทุก account เป็น price reference (ถูกต้อง)
--     เพราะต้องการราคากลางของ catalog ไม่ใช่ราคาของแต่ละ KAM

WITH kam_list AS (
  SELECT kam_name, kam_email, tl_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email)
  ])
),
-- v201f: dynamic KAM mapping (replaces hardcoded 623-row list) | 90d churn window
-- v207g: current portfolio owner source-of-truth = user_master.staff_owner_email.
-- Fallback to latest order owner only when the master record has no owner email.
user_master_current AS (
  SELECT *
  FROM \`freshket-rn.dim.user_master\`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),
master_kam_accounts AS (
  SELECT um.account_guid AS account_id, k.kam_name, k.kam_email, k.tl_email, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_map AS (
  SELECT account_id, kam_name, kam_email, tl_email
  FROM master_kam_accounts
),

account_items AS (
  SELECT
    o.account_id,
    item.item_id,
    item.item_name_th,
    item.subclass_name,
    item.temperature,
    item.pack_size AS account_pack_size,
    TRIM(SPLIT(item.item_name_th, ' ตรา')[OFFSET(0)]) AS core_name,
    -- per_kg: weight items — same as v2
    ROUND(SUM(item.gmv_ex_vat) OVER (PARTITION BY o.account_id, item.item_id)
          / NULLIF(SUM(item.weight_kg) OVER (PARTITION BY o.account_id, item.item_id), 0), 2)
          AS avg_price_per_kg,
    -- per_liter: liquid items (weight_kg=0, pack_size has volume) — new in v3
    ROUND(
      SAFE_DIVIDE(SUM(item.gmv_ex_vat) OVER (PARTITION BY o.account_id, item.item_id),
                  NULLIF(SUM(item.qty) OVER (PARTITION BY o.account_id, item.item_id), 0))
      / NULLIF(extract_pack_liters(item.pack_size), 0)
    , 2) AS avg_price_per_liter,
    -- price_basis: determines which normalized price to use
    CASE
      WHEN SUM(item.weight_kg) OVER (PARTITION BY o.account_id, item.item_id) > 0 THEN 'per_kg'
      WHEN extract_pack_liters(item.pack_size) IS NOT NULL THEN 'per_liter'
      ELSE NULL
    END AS price_basis,
    ROUND(SUM(item.gmv_ex_vat) OVER (PARTITION BY o.account_id, item.item_id)
          / NULLIF(SUM(item.qty) OVER (PARTITION BY o.account_id, item.item_id), 0), 2)
          AS avg_unit_price,
    ROUND(SUM(item.qty)        OVER (PARTITION BY o.account_id, item.item_id), 2) AS monthly_qty,
    ROUND(SUM(item.gmv_ex_vat) OVER (PARTITION BY o.account_id, item.item_id), 2) AS monthly_gmv
  FROM \`dwh.order\` o, UNNEST(o.item) AS item
  INNER JOIN kam_map km ON o.account_id = km.account_id
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)
    AND item.gmv_ex_vat > 0
    AND item.category_high_level != 'DG Non-food'
    AND (item.weight_kg > 0                                                -- per_kg path (เดิม)
         OR extract_pack_liters(item.pack_size) IS NOT NULL)               -- per_liter path (ใหม่)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.account_id, item.item_id ORDER BY o.delivery_date DESC) = 1
),

-- catalog ใช้ทุก account เป็น reference ราคากลาง (ไม่ filter KAM)
catalog AS (
  SELECT
    item.item_id,
    item.item_name_th,
    item.brand_name_th,
    item.grading,
    item.pack_size AS catalog_pack_size,
    item.subclass_name,
    item.temperature,
    TRIM(SPLIT(item.item_name_th, ' ตรา')[OFFSET(0)]) AS core_name,
    ROUND(SUM(item.gmv_ex_vat) OVER (PARTITION BY item.item_id)
          / NULLIF(SUM(item.weight_kg) OVER (PARTITION BY item.item_id), 0), 2)
          AS catalog_price_per_kg,
    ROUND(
      SAFE_DIVIDE(SUM(item.gmv_ex_vat) OVER (PARTITION BY item.item_id),
                  NULLIF(SUM(item.qty) OVER (PARTITION BY item.item_id), 0))
      / NULLIF(extract_pack_liters(item.pack_size), 0)
    , 2) AS catalog_price_per_liter,
    CASE
      WHEN SUM(item.weight_kg) OVER (PARTITION BY item.item_id) > 0 THEN 'per_kg'
      WHEN extract_pack_liters(item.pack_size) IS NOT NULL THEN 'per_liter'
      ELSE NULL
    END AS price_basis,
    ROUND(SUM(item.gmv_ex_vat) OVER (PARTITION BY item.item_id)
          / NULLIF(SUM(item.qty) OVER (PARTITION BY item.item_id), 0), 2)
          AS catalog_unit_price
  FROM \`dwh.order\` o, UNNEST(o.item) AS item
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)
    AND o.account_type != 'enduser'
    AND item.gmv_ex_vat > 0
    AND item.category_high_level != 'DG Non-food'
    AND (item.weight_kg > 0 OR extract_pack_liters(item.pack_size) IS NOT NULL)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY item.item_id ORDER BY o.delivery_date DESC) = 1
)

SELECT
  a.account_id,
  a.item_id                                           AS account_item_id,
  a.item_name_th                                      AS account_item_name,
  a.core_name                                         AS account_core_name,
  COALESCE(a.avg_price_per_kg, a.avg_price_per_liter) AS account_price,
  a.subclass_name,
  c.item_id                                           AS catalog_item_id,
  c.item_name_th                                      AS catalog_item_name,
  c.brand_name_th                                     AS catalog_brand,
  c.grading,
  c.catalog_pack_size                                 AS pack_size,
  COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter) AS catalog_price,
  ROUND(COALESCE(a.avg_price_per_kg, a.avg_price_per_liter)
      - COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter), 2) AS price_diff,
  a.avg_unit_price                                    AS account_unit_price,
  a.account_pack_size,
  c.catalog_unit_price,
  a.monthly_qty,
  a.monthly_gmv,
  a.price_basis                                       AS price_basis

FROM account_items a
JOIN catalog c
  ON  a.subclass_name  = c.subclass_name
  AND a.temperature    = c.temperature
  AND a.item_id       != c.item_id
  AND a.price_basis    = c.price_basis                                     -- ห้ามเทียบข้าม unit
  AND (c.core_name LIKE CONCAT('%', a.core_name, '%') OR a.core_name LIKE CONCAT('%', c.core_name, '%'))
  AND COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter)
      < COALESCE(a.avg_price_per_kg, a.avg_price_per_liter) * 0.97
  AND COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter) > 0
  AND COALESCE(a.avg_price_per_kg, a.avg_price_per_liter)
      / NULLIF(COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter), 0) <= 10

QUALIFY ROW_NUMBER() OVER (
  PARTITION BY a.account_id, a.item_id
  ORDER BY price_diff DESC
) <= 5
ORDER BY a.account_id, a.monthly_gmv DESC, price_diff DESC;`,
Q5B:`-- ════════════════════════════════════════════════════════════════════════════
-- Q5B — Bulk Outlets Monthly (KAM Cost IQ)
-- Columns (9): account_id, month_label, outlet_id, outlet_name,
--              gmv_ex_vat, orders, shipping_incvat, mode_timeslot, last_order_date
-- Window: last 6 complete months + current month MTD (for outlet cycle signals)
-- Note: outlet card renders only for accounts with 2+ outlets (Chain)
--       Single-outlet SA/MC accounts will be skipped by the app automatically
-- ════════════════════════════════════════════════════════════════════════════

WITH kam_list AS (
  SELECT kam_name, kam_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email)
  ])
),
-- v201f: dynamic KAM mapping (replaces hardcoded 623-row list) | 90d churn window
-- v207g: current portfolio owner source-of-truth = user_master.staff_owner_email.
-- Fallback to latest order owner only when the master record has no owner email.
user_master_current AS (
  SELECT *
  FROM \`freshket-rn.dim.user_master\`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),
master_kam_accounts AS (
  SELECT um.account_guid AS account_id, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_map AS (
  SELECT account_id FROM master_kam_accounts
),

raw AS (
  SELECT
    o.account_id,
    DATE_TRUNC(o.delivery_date, MONTH)  AS month_date,
    o.delivery_date,
    CAST(o.user_id AS STRING)           AS outlet_id,
    o.res_name                          AS outlet_name,
    o.gmv_ex_vat,
    o.order_id,
    o.po_time_slot,
    o.shipping_cost
  FROM \`freshket-rn.dwh.order\` o
  JOIN kam_map ON o.account_id = kam_map.account_id
  WHERE TRUE
    AND o.delivery_date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH), INTERVAL 6 MONTH)
    AND o.delivery_date <= CURRENT_DATE('Asia/Bangkok')
),

agg AS (
  SELECT
    account_id,
    month_date,
    outlet_id,
    ANY_VALUE(outlet_name)                                        AS outlet_name,
    ROUND(SUM(gmv_ex_vat), 2)                                    AS gmv_ex_vat,
    COUNT(DISTINCT order_id)                                     AS orders,
    ROUND(SUM(shipping_cost), 2)                                 AS shipping_incvat,
    -- mode delivery timeslot (most common slot for this outlet this month)
    CAST(
      COALESCE(
        APPROX_TOP_COUNT(po_time_slot, 1)[SAFE_OFFSET(0)].value,
        0
      ) AS FLOAT64
    )                                                            AS mode_timeslot,
    MAX(delivery_date)                                           AS last_order_date
  FROM raw
  GROUP BY account_id, month_date, outlet_id
)

SELECT
  a.account_id,
  CONCAT(
    CASE EXTRACT(MONTH FROM month_date)
      WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
      WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
      WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
      WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
    END,
    ' ',
    CAST(EXTRACT(YEAR FROM a.month_date) + 543 AS STRING)
  ) AS month_label,
  a.outlet_id,
  a.outlet_name,
  a.gmv_ex_vat,
  a.orders,
  a.shipping_incvat,
  a.mode_timeslot,
  FORMAT_DATE('%Y-%m-%d', a.last_order_date) AS last_order_date
FROM agg a
ORDER BY a.account_id, a.month_date DESC, a.gmv_ex_vat DESC;
`,
Q6B:`-- ════════════════════════════════════════════════════════════
-- Q6B v2: Bulk Price History — KAM accounts × 6 months
-- ════════════════════════════════════════════════════════════
-- Output: bulk_price.csv
-- Refresh: Monthly (1st of month, after Q3B)
-- Purpose: historical price range for sparkline Y-axis normalization
-- Columns (5): account_id, month_label, item_id, unit_price, avg_piece_price
-- Window: last 6 complete months (excludes current month-to-date)
-- Filter: GMV ≥ 100/month per SKU (cuts long-tail, ~40-50% row reduction)
-- Size: ~35-40MB (vs 68MB at 9mo / no filter)
-- ════════════════════════════════════════════════════════════

WITH kam_list AS (
  SELECT kam_name, kam_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email)
  ])
),
-- v201f: dynamic KAM mapping (replaces hardcoded 623-row list) | 90d churn window
-- v207g: current portfolio owner source-of-truth = user_master.staff_owner_email.
-- Fallback to latest order owner only when the master record has no owner email.
user_master_current AS (
  SELECT *
  FROM \`freshket-rn.dim.user_master\`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),
master_kam_accounts AS (
  SELECT um.account_guid AS account_id, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_map AS (
  SELECT account_id FROM master_kam_accounts
),


raw AS (
  SELECT
    o.account_id,
    DATE_TRUNC(o.delivery_date, MONTH)   AS month_date,
    CAST(i.item_id AS STRING)            AS item_id,
    i.gmv_ex_vat,
    i.qty,
    i.price_ex_vat
  FROM \`freshket-rn.dwh.order\` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_map ON o.account_id = kam_map.account_id
  WHERE TRUE
    AND o.delivery_date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH), INTERVAL 6 MONTH)
    AND o.delivery_date <  DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH)
    AND i.item_id IS NOT NULL
    AND i.gmv_ex_vat >= 100
)

SELECT
  account_id,
  CONCAT(
    CASE EXTRACT(MONTH FROM month_date)
      WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
      WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
      WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
      WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
    END, ' ',
    CAST(EXTRACT(YEAR FROM month_date) + 543 AS STRING)
  ) AS month_label,
  item_id,
  ROUND(SAFE_DIVIDE(SUM(gmv_ex_vat), NULLIF(SUM(qty), 0)), 2) AS unit_price,
  ROUND(AVG(price_ex_vat), 2)                                   AS avg_piece_price
FROM raw
GROUP BY account_id, month_date, item_id
ORDER BY account_id, month_date, item_id;
`,
Q10:`-- Q10_FIXED_PROD: portview_handover.csv
-- ใช้ export เป็นไฟล์ portview_handover.csv แล้วอัปขึ้น R2
-- Fix สำคัญ:
-- 1) old KAM ไม่จำเป็นต้องอยู่ใน active KAM list
-- 2) current owner ใช้ user_master.staff_owner_email เป็น source of truth
-- 3) filter dormant zero-zero rows ออก
-- 4) output schema compatible กับ Freshket Sense เดิม

WITH params AS (
  SELECT
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH) AS lm_start,
    DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 DAY) AS lm_end,
    DATE_TRUNC(CURRENT_DATE(), MONTH) AS cm_start,
    (
      SELECT MAX(delivery_date)
      FROM \`freshket-rn.dwh.order\`
      WHERE delivery_date >= DATE_TRUNC(CURRENT_DATE(), MONTH)
    ) AS cm_max_date
),

current_kam_list AS (
  SELECT kam_name, kam_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email)
  ])
),

user_master_current AS (
  SELECT *
  FROM \`freshket-rn.dim.user_master\`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE
        WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0
        ELSE 1
      END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),

current_master_owner AS (
  SELECT
    CAST(um.account_guid AS STRING) AS account_id,
    um.account_name AS master_account_name,
    um.account_type AS master_account_type,
    um.commercial_owner AS current_owner_type,
    um.staff_owner AS master_staff_owner,
    LOWER(TRIM(um.staff_owner_email)) AS master_staff_owner_email,
    k.kam_name AS mapped_kam_name,
    k.kam_email AS mapped_kam_email
  FROM user_master_current um
  LEFT JOIN current_kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.account_type IN ('SA', 'MC', 'Chain', 'Unknown')
),

last_month_kam AS (
  SELECT
    CAST(o.account_id AS STRING) AS account_id,
    ARRAY_AGG(o.account_name ORDER BY o.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)] AS account_name,
    ARRAY_AGG(o.account_type ORDER BY o.gmv_ex_vat DESC LIMIT 1)[OFFSET(0)] AS account_type,
    o.ka_owner AS old_kam_name,
    SUM(o.gmv_ex_vat) AS last_month_gmv,
    MAX(o.delivery_date) AS last_order_date_in_last_month,
    'last_month_kam' AS transfer_basis
  FROM \`freshket-rn.dwh.order\` o, params p
  WHERE o.delivery_date BETWEEN p.lm_start AND p.lm_end
    AND o.commercial_owner = 'KAM'
    AND o.ka_owner IS NOT NULL
    AND TRIM(o.ka_owner) != ''
    AND o.account_type IN ('SA', 'MC', 'Chain', 'Unknown')
  GROUP BY CAST(o.account_id AS STRING), o.ka_owner
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_id
    ORDER BY SUM(o.gmv_ex_vat) DESC, MAX(o.delivery_date) DESC
  ) = 1
),

cur_month_gmv AS (
  SELECT
    CAST(o.account_id AS STRING) AS account_id,
    SUM(o.gmv_ex_vat) AS cur_month_gmv
  FROM \`freshket-rn.dwh.order\` o, params p
  WHERE o.delivery_date BETWEEN p.cm_start AND p.cm_max_date
    AND o.account_type IN ('SA', 'MC', 'Chain', 'Unknown')
  GROUP BY CAST(o.account_id AS STRING)
),

last_known_owner AS (
  SELECT
    CAST(o.account_id AS STRING) AS account_id,
    o.account_name,
    o.account_type,
    o.commercial_owner AS last_owner,
    o.ka_owner AS last_ka_owner,
    o.delivery_date AS last_order_date
  FROM \`freshket-rn.dwh.order\` o
  WHERE o.account_type IN ('SA', 'MC', 'Chain', 'Unknown')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(o.account_id AS STRING)
    ORDER BY o.delivery_date DESC
  ) = 1
),

transfer_base AS (
  -- Active transfer: ร้านที่เดือนก่อนยังมียอดภายใต้ KAM เดิม ไม่ว่า KAM เดิมจะยัง active อยู่หรือไม่
  SELECT
    lm.old_kam_name,
    lm.account_id,
    lm.account_name,
    lm.account_type,
    ROUND(lm.last_month_gmv) AS last_month_gmv,
    lm.last_order_date_in_last_month AS last_order_date,
    lm.transfer_basis
  FROM last_month_kam lm

  UNION ALL

  -- Dormant transfer: ร้านที่ไม่มี GMV เดือนก่อน แต่ last known owner เป็น KAM
  -- จะถูก filter zero-zero ออกท้าย query
  SELECT
    lko.last_ka_owner AS old_kam_name,
    lko.account_id,
    COALESCE(cmo.master_account_name, lko.account_name) AS account_name,
    COALESCE(cmo.master_account_type, lko.account_type) AS account_type,
    0 AS last_month_gmv,
    lko.last_order_date,
    'dormant_last_known_kam' AS transfer_basis
  FROM last_known_owner lko
  LEFT JOIN last_month_kam lm
    ON lm.account_id = lko.account_id
  LEFT JOIN current_master_owner cmo
    ON cmo.account_id = lko.account_id
  WHERE lm.account_id IS NULL
    AND lko.last_owner = 'KAM'
    AND lko.last_ka_owner IS NOT NULL
    AND TRIM(lko.last_ka_owner) != ''
),

movement_rows AS (
  SELECT
    tb.old_kam_name AS kam_name,
    tb.account_id,
    tb.account_name,
    tb.account_type,
    CAST(tb.last_month_gmv AS INT64) AS last_month_gmv,
    CAST(ROUND(COALESCE(cm.cur_month_gmv, 0)) AS INT64) AS cur_month_gmv,
    COALESCE(cmo.current_owner_type, lko.last_owner, 'none') AS new_owner_type,
    CASE
      WHEN cmo.mapped_kam_name IS NOT NULL
        THEN cmo.mapped_kam_name
      WHEN cmo.account_id IS NOT NULL
        THEN COALESCE(cmo.master_staff_owner, cmo.master_staff_owner_email, 'none')
      ELSE COALESCE(lko.last_ka_owner, 'none')
    END AS new_kam_name,
    tb.transfer_basis,
    CAST(tb.last_order_date AS STRING) AS last_order_date
  FROM transfer_base tb
  LEFT JOIN cur_month_gmv cm
    USING (account_id)
  LEFT JOIN current_master_owner cmo
    USING (account_id)
  LEFT JOIN last_known_owner lko
    USING (account_id)
  WHERE
    (
      cmo.mapped_kam_name IS NOT NULL
      AND LOWER(TRIM(cmo.mapped_kam_name)) != LOWER(TRIM(tb.old_kam_name))
    )
    OR (
      cmo.account_id IS NOT NULL
      AND (
        cmo.mapped_kam_name IS NULL
        OR cmo.current_owner_type != 'KAM'
      )
    )
    OR (
      cmo.account_id IS NULL
      AND lko.last_owner = 'KAM'
      AND LOWER(TRIM(lko.last_ka_owner)) != LOWER(TRIM(tb.old_kam_name))
    )
    OR (
      cmo.account_id IS NULL
      AND lko.last_owner IN ('SALE', 'PM', 'ADMIN')
    )
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY tb.account_id, tb.old_kam_name
    ORDER BY tb.last_month_gmv DESC, tb.last_order_date DESC
  ) = 1
),

cleaned AS (
  SELECT *
  FROM movement_rows
  WHERE NOT (
    transfer_basis = 'dormant_last_known_kam'
    AND COALESCE(last_month_gmv, 0) = 0
    AND COALESCE(cur_month_gmv, 0) = 0
  )
)

SELECT
  kam_name,
  account_id,
  account_name,
  account_type,
  last_month_gmv,
  cur_month_gmv,
  new_owner_type,
  new_kam_name,
  transfer_basis,
  last_order_date
FROM cleaned
ORDER BY
  kam_name,
  last_month_gmv DESC,
  cur_month_gmv DESC,
  last_order_date DESC`
};

function copyBulkSQL(key, btn){
  const sql=BULK_SQL[key];
  if(!sql){showToast("SQL ไม่พบ: "+key,"⚠");return;}
  function showCopied(){if(!btn)return;btn.textContent="✓";btn.classList.add("copied");setTimeout(()=>{btn.textContent="SQL";btn.classList.remove("copied");},2000);}
  function fallbackCopy(){const ta=document.createElement("textarea");ta.value=sql;ta.style.cssText="position:fixed;opacity:0;top:0;left:0";document.body.appendChild(ta);ta.focus();ta.select();try{document.execCommand("copy");showCopied();}catch(e){showToast("ไม่สามารถ copy ได้","⚠");}document.body.removeChild(ta);}
  if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(sql).then(showCopied).catch(fallbackCopy);}else{fallbackCopy();}
}

// SECTION:OUTLET_CARD
function renderOutletCard(){
  const wrap=document.getElementById('outlet-card-wrap');if(!wrap)return;
  if(!D_outlets||D_outlets.length<=1){wrap.style.display='none';return;}
  wrap.style.display='block';
  const badge=document.getElementById('outlet-count-badge');
  if(badge)badge.textContent=D_outlets.length+' outlets';

  // Basket tier: color dot (CSS only, no emoji)
  function basketTier(b){
    if(b<1500)return{color:'#E53E3E',label:'< ฿1,500 · จ่ายค่าส่งทุก order'};
    if(b<3000)return{color:'var(--amb)',label:'฿1,500–2,999'};
    if(b<=5000)return{color:'var(--g500)',label:'฿3,000–5,000'};
    return{color:'#818CF8',label:'> ฿5,000 · premium'};
  }

  // Timeslot label: float hour → "08:00"
  function slotLabel(v){
    if(!v||v===0)return'';
    return String(Math.floor(v)).padStart(2,'0')+':00';
  }

  const sorted=[...D_outlets].map(o=>({...o,basket:o.orders>0?Math.round(o.gmv/o.orders):0}))
    .sort((a,b)=>b.basket-a.basket);

  const list=document.getElementById('outlet-list');
  if(list)list.innerHTML=sorted.map(o=>{
    const tier=basketTier(o.basket);
    const slot=slotLabel(o.timeslot);
    const shipAmt=o.shipping||0;
    // Row 2: tier dot + basket · shipping · timeslot
    const shipStr=shipAmt>0
      ?`<span style="color:var(--amb);font-weight:600">ค่าส่ง ${fmt(shipAmt)}</span>`
      :'<span style="color:var(--tk-ok-text)">ค่าส่งฟรี</span>';
    const slotStr=slot
      ?`<span style="font-family:'IBM Plex Mono',monospace;font-size:9px;color:var(--n400)">${slot}</span>`
      :'';
    return`<div style="padding:9px 0;border-bottom:1px solid var(--n100)">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px">
        <div style="font-size:12px;font-weight:600;color:var(--n900);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${o.outlet_name}</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--n900);flex-shrink:0">${fmt(o.gmv)}<span style="font-size:9px;font-weight:400;color:var(--n400);font-family:var(--tk-font-body)">/เดือน</span></div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:10px">
        <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${tier.color};flex-shrink:0;box-shadow:0 0 0 2px ${tier.color}22"></span>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;color:${tier.color}">${fmt(o.basket)}</span>
        <span style="color:var(--n300);font-size:10px">/ออเดอร์</span>
        <span style="color:var(--n200);font-size:10px">·</span>
        ${shipStr}
        ${slot?`<span style="color:var(--n200);font-size:10px">·</span>${slotStr}`:''}
      </div>
    </div>`;
  }).join('');
  // Remove last border
  if(list)list.style.display=outletsExpanded?'block':'none';
  const chev=document.getElementById('outlet-chev');
  if(chev)chev.style.transform=outletsExpanded?'rotate(180deg)':'rotate(0deg)';
}

function toggleOutletCard(){
  outletsExpanded=!outletsExpanded;
  const list=document.getElementById('outlet-list');
  const chev=document.getElementById('outlet-chev');
  if(list)list.style.display=outletsExpanded?'block':'none';
  if(chev)chev.style.transform=outletsExpanded?'rotate(180deg)':'rotate(0deg)';
}

// ════════════════════════════════════════
// IN-APP MATCHER
// ════════════════════════════════════════
// parseMatcherInput — builds groups exactly like original parseData()
// Returns array of groups sorted by monthly_gmv DESC
function parseMatcherInput(csv){
  const lines=csv.trim().split('\n').slice(1);
  const rows=lines.filter(l=>l.trim()).map(l=>{
    const p=parseCSVRow(l);
    return{
      account_item_id:p[0]?.trim(),account_item_name:p[1]?.trim(),account_core_name:p[2]?.trim(),
      account_price:parseFloat(p[3])||0,subclass_name:p[4]?.trim(),
      catalog_item_id:p[5]?.trim(),catalog_item_name:p[6]?.trim(),catalog_brand:p[7]?.trim(),
      grading:p[8]?.trim(),pack_size:p[9]?.trim(),catalog_price:parseFloat(p[10])||0,
      price_diff:parseFloat(p[11])||0,account_unit_price:p[12]?parseFloat(p[12]):null,
      account_pack_size:p[13]?.trim(),catalog_unit_price:parseFloat(p[14])||0,
      monthly_qty:parseFloat(p[15])||0,monthly_gmv:parseFloat(p[16])||0,
      price_basis:p[17]?.trim()||'per_kg',price_unit_label:p[18]?.trim()||''
    };
  }).filter(r=>r.account_item_id&&r.catalog_item_id);
  // Build groups (source SKU → its alternatives)
  const map=new Map();
  rows.forEach(r=>{
    if(!map.has(r.account_item_id))
      map.set(r.account_item_id,{id:r.account_item_id,name:r.account_item_name,core_name:r.account_core_name,
        price:r.account_price,unit_price:r.account_unit_price,pack_size:r.account_pack_size,
        subclass:r.subclass_name,price_basis:r.price_basis||'per_kg',
        price_unit_label:r.price_unit_label||(r.price_basis==='per_liter'?'ลิตร':(r.price_basis==='per_egg'?'ฟอง':'กก.')),
        monthly_gmv:r.monthly_gmv,monthly_qty:r.monthly_qty,
        alternatives:[],status:'pending'});
    map.get(r.account_item_id).alternatives.push({
      catalog_item_id:r.catalog_item_id,catalog_item_name:r.catalog_item_name,
      catalog_brand:r.catalog_brand,grading:r.grading,pack_size:r.pack_size,
      catalog_price:r.catalog_price,price_diff:r.price_diff,
      catalog_unit_price:r.catalog_unit_price||0
    });
  });
  return Array.from(map.values()).sort((a,b)=>b.monthly_gmv-a.monthly_gmv);
}

function chunkArray(arr,size){const c=[];for(let i=0;i<arr.length;i+=size)c.push(arr.slice(i,i+size));return c;}

// Mode + Scope setters
function setMatcherModel(model){
  matcherModel=model;
  // Sync mode: Fast(haiku)=no notes, Detail(sonnet)=with note_th/caveat_th
  matcherMode=model==='sonnet'?'detail':'fast';
  const hEl=document.getElementById('mm-haiku');
  const sEl=document.getElementById('mm-sonnet');
  if(hEl){hEl.style.borderColor=model==='haiku'?'var(--g500)':'var(--n200)';hEl.style.background=model==='haiku'?'var(--g900)':'var(--n50)';hEl.querySelector('div').style.color=model==='haiku'?'#fff':'var(--n700)';}
  if(sEl){sEl.style.borderColor=model==='sonnet'?'var(--g500)':'var(--n200)';sEl.style.background=model==='sonnet'?'var(--g900)':'var(--n50)';sEl.querySelector('div').style.color=model==='sonnet'?'#fff':'var(--n700)';}
}
// ── PHASE 3 RUNTIME WIRING ─────────────────────────
// Phase 3 runtime boundary for Freshket Sense.
// This file is classic-script compatible by design because the legacy app still relies on global names.
// It gives the monolith a real runtime module seam without forcing an ES-module migration yet.
(function(global){
  'use strict';

  const RUNTIME_VERSION = 'v155-phase22-olive-chat-v2';
  const PROXY_ONLY_PRODUCTION = true;

  // ── Olive identity source of truth ───────────────────
  const OLIVE_BASE = `You are Olive, Freshket Sense's female-coded internal intelligence partner for Freshket's Sales and KAM teams.

Olive helps users understand what is really happening across accounts, portfolios, teams, and customer purchasing behavior — then turns that diagnosis into practical next actions.

Voice:
- Smart, calm, warm, concise, practical, and lightly playful when the moment fits.
- Friendly without being childish. Playful without being silly. Honest without sounding cold. Sharp without sounding arrogant.
- Accuracy and usefulness matter more than sounding confident. Signature behavior: เก่งแบบไม่มั่ว.
- Do not force jokes. Do not over-soften serious business risks.
- Do not use emojis in AI chat answers unless the user explicitly asks for them.

Thai identity and language rules:
- If the user writes Thai or mixed Thai-English, reply in Thai. Use English only for metric names, field names, product terms, or if the user explicitly asks for English.
- Refer to yourself only as "Olive".
- Never use "หนู", "ฉัน", "ดิฉัน", "ผม", "เรา" as Olive's self-reference.
- Never call the user "อาจารย์".
- Do not use "ครับ".
- Use feminine Thai particles like "ค่ะ/นะคะ" naturally and lightly. Do not put a particle at the end of every sentence.

Currency rules:
- All monetary values in this product are Thai Baht (THB).
- Use "บาท" or "฿" only.
- Never use เยน, JPY, ¥, dollar, USD, or any other currency unless the user explicitly asks about foreign currency.

Analysis behavior:
- Answer first.
- Then give only the evidence, interpretation, recommendation, and next step that are useful for the user’s actual question.
- Never invent data. If the loaded context is not enough, say exactly what is missing and give the safest next step.
- Separate facts, assumptions, and interpretation.
- For summaries or action plans only, identify Decision, Owner, Deadline, Next step, and Risk when that structure helps.

Grounded intelligence behavior:
- Be smart and wide-ranging, but never pretend an inference is a fact.
- Use available account, portfolio, team, SKU, category, trend, and alternative data when present.
- When context is thin, diagnose what can be known, then suggest what KAM should ask or verify.
- Do not overfit every answer to churn/SKU-loss. Also look for growth, wallet protection, wallet expansion, ordering-cycle, branch, spec, price, and menu-mix opportunities when the context supports it.
- Never create week-level patterns from monthly data. Never create supplier/menu/customer-intent facts without evidence.

Restaurant reasoning lens:
- Diagnose purchasing signals like someone who understands restaurant operations: menu design, ingredient specs, food cost pressure, ordering cycles, supplier switching, prep burden, waste, branch dynamics, and chef/menu changes.
- A missing SKU may indicate menu change, ordering cycle, supplier switch, branch behavior, or prep/waste pressure — not automatically churn.
- A new SKU may indicate menu change, chef change, spec change, promotion, or substitution.
- Getting the diagnosis right changes how a KAM should approach the conversation.

Outreach behavior:
- When recommending customer contact, assume LINE is the default channel in Thailand. Mention LINE only when it naturally helps the action; do not force the word LINE into every recommendation.

On cost-saving alternatives:
- The system surfaces potential substitutions from a database, but these have not been spec-verified against the customer's actual requirements.
- Frame alternatives as options to explore, not confirmed recommendations, because the customer may have brand, spec, menu, or contract reasons for their current choice that the data does not show.`;

  function oliveToneClean(t){
  // Last-mile guard for Olive's Thai voice. Keep this narrow enough to avoid rewriting business meaning.
  let s=String(t||'');
  s=s
    .replace(/\u0e14\u0e34\u0e09\u0e31\u0e19/g,'Olive')
    .replace(/(^|[\n\r\t \u00A0])\u0e09\u0e31\u0e19(?=(\s|จะ|ขอ|เห็น|คิด|แนะนำ|ช่วย|พร้อม|วิเคราะห์|เป็น|คือ|มอง|สรุป|เช็ค))/g,'$1Olive')
    .replace(/(^|[\n\r\t \u00A0])หนู(?=(\s|จะ|ขอ|เห็น|คิด|แนะนำ|ช่วย|พร้อม|วิเคราะห์|เป็น|คือ|มอง|สรุป|เช็ค))/g,'$1Olive')
    .replace(/(^|[\n\r\t \u00A0])ผม(?=(\s|จะ|ขอ|เห็น|คิด|แนะนำ|ช่วย|พร้อม|วิเคราะห์|เป็น|คือ|มอง|สรุป|เช็ค))/g,'$1Olive')
    .replace(/(^|[\n\r\t \u00A0])เรา(?=(\s|จะ|ขอ|เห็น|คิด|แนะนำ|ช่วย|พร้อม|วิเคราะห์|เป็น|คือ|มอง|สรุป|เช็ค))/g,'$1Olive')
    .replace(/อาจารย์/g,'คุณ')
    .replace(/นะครับ/g,'นะคะ')
    .replace(/ครับผม/g,'ค่ะ')
    .replace(/ครับ/g,'ค่ะ')
    .replace(/เยน|JPY|¥/gi,'บาท')
    .replace(/ดอลลาร์|USD/gi,'บาท')
    .replace(/ค่ะค่ะ/g,'ค่ะ')
    .replace(/คะค่ะ/g,'ค่ะ')
    .replace(/ค่ะนะคะ/g,'นะคะ')
    .replace(/นะคะค่ะ/g,'นะคะ')
    .replace(/ฟอกประมาณ/g,'คิดเป็นประมาณ')
    .replace(/ยังมีหลังคาให้ยัง/g,'ยังมี room ให้ปรับ')
    .replace(/โทรตอบรับเสียว/g,'โทรเช็คอิน')
    .replace(/ตอบรับเสียว/g,'เช็คอิน')
    .replace(/ไม่ได้มีซื้อ/g,'ไม่มีการซื้อ')
    .replace(/สัปดาห์เรียว/g,'สัปดาห์ต่อเนื่อง')
    .replace(/[ \t]+\n/g,'\n')
    .trim();
  return s;
  }

  // ── AI provider/runtime boundary ─────────────────────
  function getAiProxyStorageKey(){
    return (global.FreshketSenseConfig && global.FreshketSenseConfig.ai && global.FreshketSenseConfig.ai.proxyStorageKey) || 'freshket_ai_proxy_url';
  }

  function getAiProxyUrl(){
    const configDefault=(global.FreshketSenseConfig&&global.FreshketSenseConfig.ai&&global.FreshketSenseConfig.ai.defaultProxyUrl)||'';
    return (global.FRESHKET_AI_PROXY_URL||global.localStorage?.getItem(getAiProxyStorageKey())||configDefault||'').trim();
  }

  function setAiProxyUrl(url){
    const key=getAiProxyStorageKey();
    if(url) global.localStorage?.setItem(key, String(url).trim());
    else global.localStorage?.removeItem(key);
  }

  function directAiKeyModeAllowed(){
    return false;
  }

  async function callAI(opts){
    const {modelKey, sys, messages, maxTok, provider, geminiApiKey, claudeApiKey} = opts || {};
    const activeProvider = provider || 'claude';

    // ── iframe / local: direct Anthropic API FIRST (Claude artifact context) ──
    // Must be checked BEFORE proxyUrl — defaultProxyUrl is always set in config,
    // but Worker calls are CSP-blocked inside Claude chat iframe.
    const _isIframe = global.self !== global.top;
    const _isLocal = global.location?.search?.includes('local=1');
    if(_isIframe || _isLocal){
      const _modelMap = {
        'haiku':  'claude-haiku-4-5-20251001',
        'sonnet': 'claude-sonnet-4-6',
      };
      const _model = _modelMap[modelKey] || _modelMap['sonnet'];
      const _body = {model:_model, max_tokens:maxTok||1000, messages};
      if(sys) _body.system = sys;
      const res = await fetch('https://api.anthropic.com/v1/messages',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(_body)
      });
      if(!res.ok) throw new Error('Direct API '+res.status+': '+(await res.text()).slice(0,120));
      const d = await res.json();
      return d.content?.[0]?.text || '';
    }

    // ── Production: proxy only ──
    const proxyUrl=getAiProxyUrl();
    if(proxyUrl){
      const res=await fetch(proxyUrl,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({provider:activeProvider,modelKey,system:sys,messages,maxTokens:maxTok})
      });
      if(!res.ok)throw new Error('AI proxy '+res.status+': '+await res.text());
      const d=await res.json();
      return d.text||'';
    }

    // Phase 5.1: production is proxy-only. No browser-held Claude/Gemini keys and no direct model endpoints.
    throw new Error('AI proxy ยังไม่ถูกตั้งค่า — ตั้งค่า freshket_ai_proxy_url ก่อนใช้งาน Olive AI');
  }


  function setAiProvider(p, deps){
    const d=deps||{};
    d.setProvider?.(p);
    global.localStorage?.setItem((global.FreshketSenseConfig&&global.FreshketSenseConfig.ai&&global.FreshketSenseConfig.ai.providerStorageKey)||'ai_provider',p);

    const cBtn=document.getElementById('aip-claude');
    const gBtn=document.getElementById('aip-gemini');
    const gKeyRow=document.getElementById('aip-gemini-key-row');
    const claudeSection=document.getElementById('aip-claude-section');
    const badge=document.getElementById('aip-badge');

    if(cBtn){
      cBtn.style.background=p==='claude'?'var(--g900)':'var(--n50)';
      cBtn.style.borderColor=p==='claude'?'var(--g500)':'var(--n200)';
      const label=cBtn.querySelector('div');
      if(label) label.style.color=p==='claude'?'#fff':'var(--n700)';
    }
    if(gBtn){
      gBtn.style.background=p==='gemini'?'#2d1b5e':'var(--n50)';
      gBtn.style.borderColor=p==='gemini'?'#7c3aed':'var(--n200)';
      const label=gBtn.querySelector('div');
      if(label) label.style.color=p==='gemini'?'#fff':'var(--n700)';
    }
    if(gKeyRow)gKeyRow.style.display='none';
    const matcherKeyRow=document.getElementById('matcher-api-key-row');
    if(matcherKeyRow)matcherKeyRow.style.display='none';
    if(claudeSection)claudeSection.style.opacity=p==='gemini'?'.4':'1';
    if(claudeSection)claudeSection.style.pointerEvents=p==='gemini'?'none':'auto';
    if(badge){
      badge.textContent=p==='gemini'?'Gemini':'Claude';
      badge.style.background=p==='gemini'?'rgba(124,58,237,.15)':'var(--tk-ok-dim)';
      badge.style.color=p==='gemini'?'#7c3aed':'var(--tk-ok-text)';
      badge.style.borderColor=p==='gemini'?'rgba(124,58,237,.3)':'var(--tk-ok-border)';
    }
  }

  const previousRuntime = global.FreshketSenseRuntime || {};
  global.FreshketSenseRuntime = Object.freeze({
    version:RUNTIME_VERSION,
    ai:Object.freeze({OLIVE_BASE,oliveToneClean}),
    aiClient:Object.freeze({proxyOnlyProduction:PROXY_ONLY_PRODUCTION,getAiProxyUrl,setAiProxyUrl,directAiKeyModeAllowed,callAI,setAiProvider}),
    data: previousRuntime.data
  });
})(window);

// ── PHASE 3 LEGACY AI ADAPTERS ──────────────────────
// Keep the original global names alive while delegating to FreshketSenseRuntime.
// This lets inline handlers and legacy call sites continue to work during modular migration.
window.FreshketSenseRuntime = window.FreshketSenseRuntime || { ai:{ OLIVE_BASE:'', oliveToneClean:function(t){return String(t||'').trim();} }, aiClient:{} };
var OLIVE_BASE = window.FreshketSenseRuntime.ai && window.FreshketSenseRuntime.ai.OLIVE_BASE || '';
