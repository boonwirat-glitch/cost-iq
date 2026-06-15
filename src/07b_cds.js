// COMMISSION PATCHES — inlined for locality
// Original patches: v210h · v210i · v210k · v211 (dependency order)
// Execution order preserved. All commission logic now in this block.
// ══════════════════════════════════════════════════════════════════

// ── [v210h] Commission admin visibility ─────────────────────────────
// PATCH: freshket-v210h-commission-regression-fix-js
//////////////////////////////////////////////////////////////////////////////

(function(){
  function syncCommissionAdminVisibility(){
    var btn=document.getElementById('tv-commission-btn');
    if(!btn)return;
    var role=(window.currentUserProfile&&window.currentUserProfile.role)||'';
    var isAdmin=role==='admin';
    btn.classList.toggle('comm-admin-hidden', !isAdmin);
    btn.setAttribute('aria-hidden', isAdmin?'false':'true');
    btn.tabIndex=isAdmin?0:-1;
    btn.style.display=isAdmin?'inline-flex':'none';
  }
  window.syncCommissionAdminVisibility=syncCommissionAdminVisibility;
  // v224e render-gate: commission admin visibility handled by _commGatedRender, not timers
  document.addEventListener('click', function(e){
    var btn=e.target&&e.target.closest&&e.target.closest('#tv-commission-btn,.commission-open');
    if(!btn)return;
    var role=(window.currentUserProfile&&window.currentUserProfile.role)||'';
    if(role!=='admin'){
      e.preventDefault();e.stopPropagation();
      if(typeof window.showToast==='function')window.showToast('Commission Cockpit เปิดได้เฉพาะ Admin','!');
    }
  }, true);
})();


//////////////////////////////////////////////////////////////////////////////

// ── [v210i] Role normalization + body class sync ────────────────────
// PATCH: freshket-v210i-role-normalization-js
//////////////////////////////////////////////////////////////////////////////

(function(){
  function safeProfile(){ try{return currentUserProfile||null;}catch(e){return null;} }
  function norm(role){
    if(typeof normalizeRole==='function') return normalizeRole(role);
    var r=String(role||'').trim().toLowerCase();
    if(r==='kam'||r==='ka'||r==='key_account'||r==='key account')return 'rep';
    if(r==='team_lead'||r==='team lead')return 'tl';
    return r||'rep';
  }
  function curRole(){
    try{ if(typeof getCurrentRole==='function') return getCurrentRole(); }catch(e){}
    var p=safeProfile(); return norm(p&&p.role);
  }
  function isAdmin(){return curRole()==='admin';}
  function isTL(){return curRole()==='tl';}
  function isRep(){return curRole()==='rep';}
  function normalizeProfileAndBody(){
    var p=safeProfile();
    var r=curRole();
    try{ if(p){ p.role=r; p.role_label=(r==='rep'?'KAM':r==='tl'?'TL':r==='admin'?'Admin':r); } }catch(e){}
    try{
      document.body.classList.toggle('role-admin',    r==='admin');
      document.body.classList.toggle('role-tl',       r==='tl');
      document.body.classList.toggle('role-rep',       r==='rep');
      document.body.classList.toggle('role-sales',     r==='sales');
      document.body.classList.toggle('role-sales-tl',  r==='sales_tl');
      document.body.classList.toggle('role-ad',        r==='ad');
      document.body.classList.toggle('role-ad-tl',     r==='ad_tl');
      document.body.setAttribute('data-role', r);
    }catch(e){}
    return r;
  }
  function syncCommissionAdminVisibility(){
    var r=normalizeProfileAndBody();
    var btn=document.getElementById('tv-commission-btn');
    if(!btn)return;
    var admin=(r==='admin');
    btn.classList.toggle('comm-admin-hidden', !admin);
    btn.setAttribute('aria-hidden', admin?'false':'true');
    btn.tabIndex=admin?0:-1;
    btn.style.display=admin?'inline-flex':'none';
  }
  function ensureKamCommissionCard(){
    normalizeProfileAndBody();
    try{
      if (typeof _commRenderKamSelfStrip === 'function') {
        _commRenderKamSelfStrip();
        return;
      }
    }catch(e){ console.warn('[v210j] KAM commission strip render failed', e); }
    var slot=document.getElementById('pv-commission-strip');
    if(slot) slot.innerHTML='';
  }
  window.syncCommissionAdminVisibility=syncCommissionAdminVisibility;
  window._commEnsureKamSelfCard=ensureKamCommissionCard;
  window._senseNormalizeProfileAndBody=normalizeProfileAndBody;

  try{
    var _renderPortviewSummary=renderPortviewSummary;
    renderPortviewSummary=function(){
      normalizeProfileAndBody();
      var out=_renderPortviewSummary.apply(this, arguments);
      requestAnimationFrame(function(){ syncCommissionAdminVisibility(); });
      // v224e: ensureKamCommissionCard moved to _commGatedRender (data-gate-aware)
      return out;
    };
  }catch(e){}
  try{
    var _renderPortview=renderPortview;
    renderPortview=function(){
      normalizeProfileAndBody();
      var out=_renderPortview.apply(this, arguments);
      // v224e: ensureKamCommissionCard moved to _commGatedRender (fires once after data ready)
      if(typeof window._commGatedRender==='function') window._commGatedRender();
      return out;
    };
  }catch(e){}
  try{
    var _renderTeamview=renderTeamview;
    renderTeamview=function(){
      normalizeProfileAndBody();
      var out=_renderTeamview.apply(this, arguments);
      requestAnimationFrame(syncCommissionAdminVisibility);
      return out;
    };
  }catch(e){}
  try{
    var _openCommissionCockpit=openCommissionCockpit;
    openCommissionCockpit=function(step){
      normalizeProfileAndBody();
      if(!isAdmin()){
        if(typeof showToast==='function') showToast('Commission Cockpit เปิดได้เฉพาะ Admin','!');
        return;
      }
      return _openCommissionCockpit.apply(this, arguments);
    };
    window.openCommissionCockpit=openCommissionCockpit;
  }catch(e){}

  document.addEventListener('click', function(e){
    var btn=e.target&&e.target.closest&&e.target.closest('#tv-commission-btn,.commission-open');
    if(!btn)return;
    normalizeProfileAndBody();
    if(!isAdmin()){
      e.preventDefault(); e.stopPropagation();
      if(typeof showToast==='function') showToast('Commission Cockpit เปิดได้เฉพาะ Admin','!');
    }
  }, true);
  // v224e render-gate: DOMContentLoaded timers and setInterval polling removed.
  // Commission strip renders via _commGatedRender() which fires once after
  // allCriticalReady() = true. Eliminates 7-render cascade on login.
})();


//////////////////////////////////////////////////////////////////////////////

// ── [v210k] KAM commission compact strip ────────────────────────────
// PATCH: freshket-v210k-kam-commission-compact-js
//////////////////////////////////////////////////////////////////////////////

(function(){
  function esc(v){
    try{ return typeof _commEscapeHtml==='function' ? _commEscapeHtml(v) : String(v ?? '').replace(/[&<>'"]/g, function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];}); }
    catch(e){ return String(v ?? ''); }
  }
  function money(n){ try{return _commFmtPayout(n);}catch(e){ n=Number(n||0); return n?'฿'+Math.round(n).toLocaleString('en-US'):'฿0'; } }
  function pts(n){ try{return _commFormatPts(n);}catch(e){ var x=Number(n||0); return x.toFixed(1).replace('.0',''); } }
  // v225-comm: buildSources uses real payout via _commBuildKamPayout
  // v226-comm: NRR always from governance st.payout; upsell/handover added on top when bundle loaded
  function buildSources(st){
    var nrr=Number(st&&st.payout||0);
    var base={loading:false,nrr:nrr,uplift:0,handover:0,gate_cap:1.0,gate_active:false,final:nrr};
    if(typeof bulkUpsellData==='undefined'||!bulkUpsellData||!bulkUpsellData.loaded){
      return Object.assign({},base,{loading:true});
    }
    try{
      var email=st&&st.email;
      var p=email&&typeof _commBuildKamPayout==='function'?_commBuildKamPayout(email):null;
      if(!p) return base;
      var uplift=Number((p.upsell_sku&&p.upsell_sku.total_comm)||0)+Number((p.upsell_outlet&&p.upsell_outlet.commission)||0);
      var hv=Number((p.handover&&p.handover.payout)||0);
      var cap=Number(p.gate_cap||1.0);
      // final = governance NRR (st.payout) + upsell + handover, then gate applied
      // Do NOT use p.nrr_payout which may be 0 if plan lookup fails
      return {loading:false,nrr:nrr,uplift:uplift,handover:hv,
        // Keep separate fields for sheet detail rows
        upsell_sku:Number((p.upsell_sku&&p.upsell_sku.total_comm)||0),
        upsell_outlet:Number((p.upsell_outlet&&p.upsell_outlet.commission)||0),
        gate_cap:cap,gate_active:!!(p.gate&&p.gate.gate_active),gate:p.gate,
        upsell_sku_detail:p.upsell_sku,upsell_outlet_detail:p.upsell_outlet,handover_detail:p.handover,
        final:Math.round((nrr+uplift+hv)*cap)};
    }catch(e){ return base; }
  }
  function buildCompactStrip(){
    if(typeof _commBuildKamSelfState!=='function') return '';
    var st=_commBuildKamSelfState();
    if(!st) return '';
    var src=buildSources(st);
    if(!src) return '';
    // Self-healing: if upsell not loaded yet, trigger fetch now
    if(src.loading && st.email && typeof _fetchUpsellBundle==='function'){
      _fetchUpsellBundle(st.email).catch(function(){});
    }
    // v565 TIERS-READY GATE: NRR payout comes from commission_rule_tiers loaded by
    // loadTargets(). Before _tgtLoaded, _commGetDraft falls back to hardcoded default
    // tiers → strip showed e.g. ฿7,500 (default ≥102% tier) then snapped to ฿10,000
    // (real DB tier ≥103%) — a money-trust violation. Treat tiers-not-ready as loading;
    // _commGatedRender's 'กำลังโหลด' peek + _tgtInitCheck both retry once tiers arrive.
    var _tiersReady=(typeof _tgtLoaded!=='undefined')?!!_tgtLoaded:true;
    var _stripLoading=!!src.loading||!_tiersReady;
    var finalAmt=_stripLoading?null:src.final;
    var paid=!_stripLoading&&finalAmt>0;
    var cls='v210k '+(paid?'paid':'unpaid')+' '+esc(st.cls||'');
    var status=_stripLoading?'กำลังโหลด...':(st.status||(paid?'\u0e16\u0e36\u0e07\u0e40\u0e01\u0e13\u0e11\u0e41\u0e25\u0e49\u0e27':'\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e16\u0e36\u0e07\u0e40\u0e01\u0e13\u0e11'));
    var gateNote=(!_stripLoading&&src.gate_active)?(' <span class="pv-comm-gate-warn">\u26a0 gate '+Math.round(src.gate_cap*100)+'%</span>'):'';
    var mainHtml=_stripLoading
      ?'<div class="skel" style="width:90px;height:28px;border-radius:6px;display:inline-block"></div>'
      :money(finalAmt);
    return '<div class="pv-comm-strip '+cls+'" data-v210k="1" onclick="_commOpenKamSelfSheet()" style="cursor:pointer">'
      +'<div class="pv-comm-title">\u0e04\u0e48\u0e32\u0e04\u0e2d\u0e21\u0e2f \u0e40\u0e14\u0e37\u0e2d\u0e19\u0e19\u0e35\u0e49'+gateNote+'</div>'
      +'<div class="pv-comm-main">'+mainHtml+'</div>'
      +'<div class="pv-comm-chip" title="'+esc(status)+'">'+esc(status)+'</div>'
      +'<button class="pv-comm-hist-btn" title="ประวัติ commission" onclick="event.stopPropagation();if(typeof openCommissionHistory===\'function\')openCommissionHistory();">'
      +'<svg class="pv-comm-hist-icon" width="16" height="16" viewBox="0 0 32 32" fill="none">'
      +'<path d="M16 4 A12 12 0 1 1 5.5 22" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>'
      +'<polyline points="5,17 5.5,22 10,21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
      +'<circle cx="16" cy="16" r="1.8" fill="currentColor"/>'
      +'<line x1="16" y1="16" x2="16" y2="10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
      +'<line x1="16" y1="16" x2="20" y2="18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
      +'</svg>'
      +'<span class="pv-comm-hist-lbl">\u0e1b\u0e23\u0e30\u0e27\u0e31\u0e15\u0e34</span>'
      +'</button>'
      +'<div class="pv-comm-sources">'
      +'<span style="color:'+(src.nrr>0?'#ffe08a':'rgba(255,255,255,.35)')+'"><b>NRR</b> '+money(src.nrr)+'</span><span class="pv-comm-sep">\u00b7</span>'
      +'<span style="color:'+(!src.loading&&(src.uplift||0)>0?'#ffe08a':'rgba(255,255,255,.35)')+'"><b>Uplift</b> '+(src.loading?'\u2014':money(src.uplift||0))+'</span><span class="pv-comm-sep">\u00b7</span>'
      +'<span style="color:'+(!src.loading&&(src.handover||0)>0?'#ffe08a':'rgba(255,255,255,.35)')+'"><b>Handover</b> '+(src.loading?'\u2014':money(src.handover||0))+'</span>'
      +'</div>'
      +'</div>';
  }
  function renderCompactStrip(){
    var slot=document.getElementById('pv-commission-strip') || (function(){
      var row=document.getElementById('portview-summary-row');
      if(!row||!row.parentNode) return null;
      var d=document.createElement('div');
      d.id='pv-commission-strip';
      d.className='pv-commission-strip-slot';
      row.parentNode.insertBefore(d,row);
      return d;
    })();
    if(!slot) return;
    var html=buildCompactStrip() || '';
    // Value guard: skip rebuild if content unchanged
    if(slot._lastCommHtml===html && slot.innerHTML) return;
    slot._lastCommHtml=html;
    slot.innerHTML=html;
  }
  function openCompactSheet(){
    if(typeof _commBuildKamSelfState!=="function") return;
    var st=_commBuildKamSelfState();
    if(!st) return;
    var ov=document.getElementById("pv-comm-sheet-overlay");
    if(!ov){
      ov=document.createElement("div");
      ov.id="pv-comm-sheet-overlay";
      ov.className="pv-comm-sheet-overlay";
      ov.onclick=function(e){ if(e.target===ov) closeCompactSheet(); };
      document.body.appendChild(ov);
    }
    var pctText=st.pct!==null&&st.pct!==undefined?(st.pct+"%"):"—";
    var src=buildSources(st);
    if(!src) src={loading:false,nrr:Number(st&&st.payout||0),upsell_sku:0,upsell_outlet:0,handover:0,gate_cap:1.0,gate_active:false,final:Number(st&&st.payout||0)};
    var finalAmt=src.loading?src.nrr:src.final;

    // Config-tied rule values
    function cfg(k,p,d){try{return typeof _commGetConfig==="function"?_commGetConfig(k,p,d):d;}catch(e){return d;}}
    var p1Rate=Math.round(cfg("upsell_sku","p1_rate",0.03)*100);
    var p3Rate=Math.round(cfg("upsell_sku","p3_rate",0.03)*100);
    var p3Thresh=cfg("upsell_sku","p3_threshold_pct",2.00);
    var p3ThreshPct=Math.round((p3Thresh-1)*100);
    var p3MinIncr=Number(cfg("upsell_sku","p3_min_incremental",5000)).toLocaleString("en-US");
    var p1MinGmv=Number(cfg("upsell_sku","p1_min_gmv",5000)).toLocaleString("en-US");
    var outRate=Math.round(cfg("upsell_outlet","rate",0.015)*1000)/10;
    var hoT2=cfg("handover","tier2_pct",100);
    var hoT3=cfg("handover","tier3_pct",120);
    var hoT2Pay=Number(cfg("handover","tier2_payout",2500)).toLocaleString("en-US");
    var hoT3Bon=Number(cfg("handover","tier3_bonus",2500)).toLocaleString("en-US");
    var gT1=cfg("gmv_gate","threshold_1",95);
    var gT2=cfg("gmv_gate","threshold_2",90);
    var gC1=Math.round(cfg("gmv_gate","cap_1",0.70)*100);
    var gC2=Math.round(cfg("gmv_gate","cap_2",0.35)*100);

    // NRR tiers
    var tierRows=(st.tiers||[]).map(function(t,idx){
      var on=st.tier&&idx===st.currentIdx;
      var isNext=st.next&&String(t.id||idx)===String(st.next.id||(st.tiers||[]).indexOf(st.next));
      var lbl=(typeof _commTierRangeLabel==="function"?_commTierRangeLabel(t):"")+"·"+(t.payout_label||"");
      return ["<div class=\"pv-comm-tier-row ",(on?"on":isNext?"next":""),"\">",              "<div class=\"pv-comm-tier-range\">",esc(lbl),"</div>",              "<div class=\"pv-comm-tier-pay\">",money(t.payout_value),"</div></div>"].join("");
    }).join("");

    // Action note
    var action="รอข้อมูล NRR";
    if(st.pct!==null&&st.pct!==undefined){
      if(st.next) action="NRR ต้องเพิ่มอีก +"+pts(Math.max(0,Number(st.next.min_value)-Number(st.pct)))+" pts ถึง tier ถัดไป";
      else if(finalAmt>0) action="รักษา NRR ให้อยู่ใน tier นี้จนจบเดือน";
      else action="ยังไม่ถึง tier แรก";
    }

    // Helper: build a source row
    function srcRow(cls,name,note,pay,detail){
      return ["<div class=\"pv-comm-source-row ",cls,"\"><div>",
              "<span class=\"pv-comm-source-name\">",esc(name),"</span>",
              "<span class=\"pv-comm-source-note\">",note,"</span>",
              "</div><div class=\"pv-comm-source-pay\">",pay,"</div></div>",
              detail||""].join("");
    }
    function ruleBox(lines){
      return "<div class=\"pv-comm-rule-box\">"+lines.join("")+"</div>";
    }
    function ruleLine(hit,label,pay){
      return "<div class=\"pv-comm-rule-line "+(hit?"hit":"miss")+"\"><span>"+esc(label)+"</span><span>"+pay+"</span></div>";
    }
    function ruleIndent(txt){
      return "<div class=\"pv-comm-rule-indent\">"+txt+"</div>";
    }

    // NRR row
    var firstPayTier=st.tiers&&st.tiers.find(function(t){return Number(t.payout_value||0)>0;});
    var nrrMinPct=firstPayTier&&firstPayTier.min_value!==null?firstPayTier.min_value:"—";
    var nrrRow=srcRow(src.nrr>0?"paid":"","NRR","เกณฑ์ ≥"+nrrMinPct+"% · "+esc(st.ruleName||"—"),money(src.nrr),"");

    // Upsell SKU row — v235: renamed P1→กลุ่มสินค้าใหม่, P3→ยอดเติบโต; added outlet drill
    // v239-fix: declare p1g/p3g OUTSIDE if block so upsellHasDrill can see them
    var p1Detail=[],p3Detail=[],p1g=[],p3g=[];
    if(src.upsell_sku_detail){
      var d=src.upsell_sku_detail;
      p1g=d.p1&&d.p1.groups?d.p1.groups:[];
      p3g=d.p3&&d.p3.groups?d.p3.groups:[];
      window._pvCommP1Groups=p1g; window._pvCommP3Groups=p3g; // store for drill
      p1Detail=[ruleLine(p1g.length>0,"กลุ่มสินค้าใหม่ (GMV ≥฿"+p1MinGmv+") × "+p1Rate+"%",money(d.p1?d.p1.comm:0))];
      if(p1g.length) p1Detail.push(ruleIndent("<span onclick=\"_commOpenUpsellDrill('p1')\" style=\"color:#bcd7ff;cursor:pointer;font-weight:700;text-decoration:underline;text-underline-offset:2px\">"+p1g.length+" รายการ — ดูทั้งหมด ›</span>"));
      p3Detail=[ruleLine(p3g.length>0,"ยอดเติบโต >"+p3ThreshPct+"% & incr ≥฿"+p3MinIncr+" × "+p3Rate+"%",money(d.p3?d.p3.comm:0))];
      if(p3g.length) p3Detail.push(ruleIndent("<span onclick=\"_commOpenUpsellDrill('p3')\" style=\"color:#bcd7ff;cursor:pointer;font-weight:700;text-decoration:underline;text-underline-offset:2px\">"+p3g.length+" รายการ — ดูทั้งหมด ›</span>"));
    }
    var upsellSkuDetail=p1Detail.length||p3Detail.length?ruleBox(p1Detail.concat(p3Detail)):"";
    var upsellSkuRow=srcRow(src.upsell_sku>0?"paid":"","กลุ่มสินค้าใหม่ + ยอดเติบโต","กลุ่มสินค้าใหม่ "+p1Rate+"% · ยอดเติบโต >"+p3ThreshPct+"% → "+p3Rate+"%",money(src.upsell_sku),upsellSkuDetail);

    // Upsell Outlet row
    var outDetail="";
    if(src.upsell_outlet_detail){
      var od=src.upsell_outlet_detail;
      outDetail=ruleBox([ruleLine(od.outlet_gmv>0,"ใหม่ "+money(od.new_gmv)+" · comeback "+money(od.comeback_gmv)," × "+outRate+"%"),
                          ruleIndent("ไม่นับ item ที่ได้ P1 ไปแล้ว")]);
    }
    var upsellOutRow=srcRow(src.upsell_outlet>0?"paid":"","Expansion","สาขาใหม่/comeback × "+outRate+"%",money(src.upsell_outlet),outDetail);

    // Handover row — 2-line tier breakdown
    var hoDetail="";
    if(src.handover_detail){
      var hd=src.handover_detail;
      var hoHit2=hd.retention_pct>=hoT2;
      var hoHit3=hd.retention_pct>=hoT3;
      hoDetail=ruleBox([
        ruleIndent("retention "+hd.retention_pct+"% ("+hd.accounts+" ร้าน) — "+money(hd.current_gmv)+" / "+money(hd.baseline_gmv)),
        ruleLine(hoHit2,"≥"+hoT2+"% → ฿"+hoT2Pay,hoHit2?money(hd.payout>0?Math.min(hd.payout,Number(String(hoT2Pay).replace(/,/g,""))||2500):0):""),
        ruleLine(hoHit3,"≥"+hoT3+"% → +฿"+hoT3Bon+" (bonus)",hoHit3?money(Number(String(hoT3Bon).replace(/,/g,""))||2500):"")
      ]);
    }
    var handoverRow=srcRow(src.handover>0?"paid":"","Handover","≥"+hoT2+"% = ฿"+hoT2Pay+" · ≥"+hoT3+"% = +฿"+hoT3Bon,money(src.handover),hoDetail);

    // NRR Gate row (renamed from GMV Gate — gate uses NRR%, not run-rate)
    var gateRow="";
    if(src.gate&&src.gate.ach_pct!==null&&src.gate.ach_pct!==undefined){
      var gPct=src.gate.ach_pct;
      var gCapPct=Math.round(src.gate_cap*100);
    }else{ var gPct=st.pct||null; var gCapPct=100; }

    var loadNote=src.loading?'<div style="font-size:11px;color:#ffe08a;padding:6px 18px">⚠ กำลังโหลด upsell — ตัวเลขจะอับเดตอัตโนมัติ</div>':'';
    var kpiCls=finalAmt>0?'val-bonus':'';
    var nowStr=(function(){var d=new Date();return d.getDate()+'/'+(d.getMonth()+1)+' '+d.getHours()+':'+(d.getMinutes()<10?'0':'')+d.getMinutes();})();

    // Store drill data for drill functions
    window._pvCommDrillSt=st; window._pvCommDrillSrc=src;
    window._pvCommDrillCfg={p1Rate:p1Rate,p3Rate:p3Rate,p3ThreshPct:p3ThreshPct,outRate:outRate,hoT2:hoT2,hoT3:hoT3,hoT2Pay:hoT2Pay,hoT3Bon:hoT3Bon,tierRows:tierRows,action:action};

    // Clean component row builder
    function cRow(dot,label,sub,amt,amtColor,drillFn){
      var hasAmt=Number(amt||0)>0;
      return '<div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid rgba(188,215,255,.09);'+(drillFn?'cursor:pointer':'')+'"'
        +(drillFn?' onclick="'+drillFn+'" onmouseenter="this.style.background=\'rgba(188,215,255,.04)\'" onmouseleave="this.style.background=\'\'"':'')+'>'
        +'<div style="width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:2px;background:'+dot+'"></div>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:14px;font-weight:700;color:rgba(225,238,255,.88);line-height:1.25">'+label+'</div>'
        +'<div style="font-size:11px;color:rgba(225,238,255,.40);margin-top:2px">'+sub+'</div>'
        +'</div>'
        +'<div style="display:flex;align-items:center;gap:7px;flex-shrink:0">'
        +'<span style="font-size:14px;font-weight:900;font-family:\'IBM Plex Mono\',monospace;letter-spacing:-.02em;color:'+(hasAmt?amtColor:'rgba(225,238,255,.25)')+'">'+money(amt||0)+'</span>'
        +(drillFn?'<span style="font-size:16px;color:rgba(188,215,255,.28)">›</span>':'')
        +'</div></div>';
    }

    // Row definitions
    var nrrSub='NRR '+pctText+' · '+esc(st.tierLabel||st.ruleName||'—');
    if(st.next)nrrSub+=' · ต้องอีก +'+(Number(st.next.min_value)-Number(st.pct||0)).toFixed(1)+'pts';
    var nrrRowHtml=cRow('var(--tk-ok-bright)','NRR Commission',nrrSub,src.nrr,'var(--tk-ok-bright)','_commDrillNRR()');

    var upsellSub=(p1g&&p1g.length?'กลุ่มสินค้าใหม่ '+p1g.length+' รายการ':'')+(p1g&&p1g.length&&p3g&&p3g.length?' · ':'')+(p3g&&p3g.length?'ยอดเติบโต '+p3g.length+' รายการ':'');
    if(!upsellSub)upsellSub='กลุ่มสินค้าใหม่ '+p1Rate+'% · ยอดเติบโต >'+p3ThreshPct+'% → '+p3Rate+'%';
    var upsellHasDrill=!!(p1g&&p1g.length||p3g&&p3g.length);
    var upsellRowHtml=cRow('rgba(255,224,138,.9)','กลุ่มสินค้าใหม่ + ยอดเติบโต',upsellSub,src.upsell_sku,'#ffe08a',upsellHasDrill?'_commDrillUpsellChooser()':null);

    var ncSub='สาขาใหม่ × '+outRate+'%'+(src.upsell_outlet_detail&&src.upsell_outlet_detail.outlet_gmv>0?' · GMV '+money(src.upsell_outlet_detail.outlet_gmv):'');
    var ncRowHtml=cRow('rgba(255,224,138,.8)','Expansion',ncSub,src.upsell_outlet,'#ffe08a','_commDrillExpansion()');

    // v239-fix: hoSub แสดง baseline + current + retention เพื่อ reconcile ได้
    var hoSub=(function(){
      if(!src.handover_detail||!src.handover_detail.accounts)return'≥'+hoT2+'% = ฿'+hoT2Pay+' · ≥'+hoT3+'% = +฿'+hoT3Bon;
      var hd=src.handover_detail;
      var baseMon=hd.baseline_gmv>=1000?'฿'+(hd.baseline_gmv/1000).toFixed(0)+'K':'฿'+Math.round(hd.baseline_gmv);
      var currMon=hd.current_gmv>=1000?'฿'+(hd.current_gmv/1000).toFixed(0)+'K':'฿'+Math.round(hd.current_gmv);
      return hd.accounts+' ร้าน · '+baseMon+' → '+currMon+' ('+hd.retention_pct+'%)';
    })();
    var hoRowHtml=cRow('#bcd7ff','Handover',hoSub,src.handover,'#bcd7ff','_commDrillHandover()');

    var subtotalAmt=(src.nrr||0)+(src.upsell_sku||0)+(src.upsell_outlet||0)+(src.handover||0);
    var gateOk2=!src.gate_active;
    var gateCardHtml='<div style="margin:0 18px 12px;background:'+(gateOk2?'var(--tk-ok-dim)':'rgba(240,80,0,.08)')+';border:1px solid '+(gateOk2?'var(--tk-ok-dim-2)':'rgba(240,80,0,.2)')+';border-radius:10px;padding:10px 13px;display:flex;align-items:center;justify-content:space-between">'
      +'<div><div style="font-size:12px;color:rgba(225,238,255,.78)">NRR Gate</div>'
      +'<div style="font-size:10px;color:rgba(225,238,255,.35);margin-top:2px">NRR '+(gPct||'—')+'% '+(gateOk2?'≥'+gT1+'% — ผ่าน':'— ถูก cap')+'</div></div>'
      +'<span style="font-size:13px;font-weight:900;color:'+(gateOk2?'var(--tk-ok-bright)':'#ff6b3d')+';font-family:\'IBM Plex Mono\',monospace">× '+gCapPct+'% '+(gateOk2?'✓':'⚠')+'</span></div>';

    var heroHtml='<div style="padding:18px;text-align:center">'
      +'<div style="font-size:9px;font-weight:850;text-transform:uppercase;letter-spacing:.12em;color:rgba(188,215,255,.55);font-family:\'IBM Plex Mono\',monospace;margin-bottom:5px">Final Payout</div>'
      +'<div style="font-size:36px;font-weight:950;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace;letter-spacing:-.025em;text-shadow:0 0 24px rgba(255,224,138,.15);line-height:1.1">'+money(finalAmt)+'</div>'
      +(!src.loading?'<div style="font-size:11px;color:var(--tk-ok-bright);margin-top:5px;font-weight:700">ตรงกับ commission panel ✓</div>':'')
      +'</div>';

    var exportBtnHtml=(src.upsell_sku>0||src.upsell_outlet>0)
      ?'<button onclick="_commExportAuditCSV()" style="display:block;width:calc(100% - 36px);margin:0 18px 8px;padding:12px;border-radius:10px;background:rgba(188,215,255,.07);border:1px solid rgba(188,215,255,.18);color:rgba(225,238,255,.78);font-size:13px;font-weight:700;cursor:pointer;font-family:\'Noto Sans Thai\',sans-serif">↓ Export audit CSV</button>'
      :'';

    var html=[
      '<div class="pv-comm-sheet">',
      '<div class="pv-comm-sheet-handle"></div>',
      '<div style="overflow-y:auto">',
      loadNote,
      '<div style="padding:14px 18px 0;display:flex;align-items:flex-start;justify-content:space-between">',
      '<div><div style="font-size:17px;font-weight:900;color:#fff">วิธีคิดค่าคอมฯ</div>',
      '<div style="font-size:11px;color:rgba(225,238,255,.40);margin-top:3px">สรุปตามแหล่งที่มา · คำนวณ '+nowStr+'</div></div>',
      '<button onclick="_commCloseKamSelfSheet()" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.42);font-size:13px;cursor:pointer;flex-shrink:0;font-family:inherit;margin-top:2px">✕</button>',
      '</div>',
      '<div class="pv-comm-sheet-kpis" style="margin:12px 18px 14px">',
      '<div class="pv-comm-sheet-kpi '+kpiCls+'"><div class="pv-comm-sheet-kpi-label">ค่าคอมฯ สุทธิ์</div><div class="pv-comm-sheet-kpi-val">'+money(finalAmt)+'</div></div>',
      '<div class="pv-comm-sheet-kpi"><div class="pv-comm-sheet-kpi-label">NRR</div><div class="pv-comm-sheet-kpi-val">'+esc(pctText)+'</div></div>',
      '</div>',
      '<div style="font-size:9px;font-weight:850;text-transform:uppercase;letter-spacing:.07em;color:rgba(225,238,255,.35);padding:2px 18px 6px;font-family:\'IBM Plex Mono\',monospace">ที่มาของยอด</div>',
      nrrRowHtml,upsellRowHtml,ncRowHtml,hoRowHtml,
      '<div style="height:1px;background:rgba(188,215,255,.10);margin:4px 18px"></div>',
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 18px">',
      '<span style="font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.07em;color:rgba(225,238,255,.38);font-family:\'IBM Plex Mono\',monospace">Subtotal</span>',
      '<span style="font-size:15px;font-weight:900;color:rgba(225,238,255,.88);font-family:\'IBM Plex Mono\',monospace">'+money(subtotalAmt)+'</span>',
      '</div>',
      gateCardHtml,
      '<div style="height:1px;background:rgba(188,215,255,.10);margin:0 18px"></div>',
      heroHtml,
      '<div style="font-size:10px;color:rgba(225,238,255,.22);text-align:center;padding:0 18px 12px;font-family:\'IBM Plex Mono\',monospace">คำนวณจาก CSV ที่โหลดอยู่ · v235 · '+nowStr+'</div>',
      exportBtnHtml,
      '<div style="padding:0 18px 4px;display:flex;gap:6px"><button onclick="_commCloseKamSelfSheet();setTimeout(openCommissionHistory,80)" style="flex:1;padding:10px;border-radius:10px;background:var(--tk-ok-dim);border:1px solid var(--tk-ok-dim-2);color:var(--tk-ok-bright);font-size:12px;font-weight:700;cursor:pointer;font-family:\'Noto Sans Thai\',sans-serif">History</button><button onclick="_commCloseKamSelfSheet();setTimeout(openCommissionRulebook,80)" style="flex:1;padding:10px;border-radius:10px;background:rgba(188,215,255,.08);border:1px solid rgba(188,215,255,.22);color:rgba(225,238,255,.88);font-size:12px;font-weight:700;cursor:pointer;font-family:\'Noto Sans Thai\',sans-serif">Rules</button></div>',
      '<div style="padding:0 18px 20px"><button onclick="_commCloseKamSelfSheet()" style="width:100%;padding:11px;border-radius:10px;background:rgba(255,255,255,.055);border:1px solid rgba(188,215,255,.12);color:rgba(225,238,255,.55);font-size:13px;font-weight:700;cursor:pointer;font-family:\'Noto Sans Thai\',sans-serif">ปิด</button></div>',
      '</div>',
      '</div></div>',
    ].join('');
    ov.innerHTML=html;
    requestAnimationFrame(function(){ov.classList.add('on');});
  }
  function closeCompactSheet(){
    var ov=document.getElementById('pv-comm-sheet-overlay');
    if(!ov)return;
    ov.classList.remove('on');
    setTimeout(function(){ov.innerHTML='';},260);
  }

  // v237+v243: helper functions exposed to window for cross-scope calls
  window._pvOutletName=function(outletId,accountId){
    if(!outletId||outletId==='_all')return'—';
    if(typeof bulkOutletsData!=='undefined'&&bulkOutletsData&&accountId){
      var months=bulkOutletsData[accountId];
      if(months){var labels=Object.keys(months);for(var li=0;li<labels.length;li++){var arr=months[labels[li]];if(!arr)continue;for(var oi=0;oi<arr.length;oi++){var o=arr[oi];var oid=o.outlet_id||o.outletId||o.id;if(String(oid)===String(outletId)&&(o.outlet_name||o.outletName))return o.outlet_name||o.outletName;}}}
    }
    if(typeof bulkOutletsData!=='undefined'&&bulkOutletsData){
      var accts=Object.keys(bulkOutletsData);for(var ai=0;ai<accts.length;ai++){var months2=bulkOutletsData[accts[ai]];if(!months2)continue;var labels2=Object.keys(months2);for(var li2=0;li2<labels2.length;li2++){var arr2=months2[labels2[li2]];if(!arr2)continue;for(var oi2=0;oi2<arr2.length;oi2++){var o2=arr2[oi2];var oid2=o2.outlet_id||o2.outletId||o2.id;if(String(oid2)===String(outletId)&&(o2.outlet_name||o2.outletName))return o2.outlet_name||o2.outletName;}}}
    }
    return outletId;
  };

  // ── v235: Outlet drill sheet ────────────────────────────────────────────────
  function _commOpenUpsellDrill(type){
    var ov=document.getElementById('pv-comm-sheet-overlay');
    var sheetEl=ov&&ov.querySelector('.pv-comm-sheet');
    if(!sheetEl)return;
    window._pvCommDrillSaved=sheetEl.outerHTML;

    var groups=type==='p1'?(window._pvCommP1Groups||[]):(window._pvCommP3Groups||[]);
    var titleLabel=type==='p1'?'กลุ่มสินค้าใหม่':'ยอดเติบโต';
    var badgeColor=type==='p1'?'var(--tk-ok-dim)':'rgba(255,224,138,.15)';
    var badgeText=type==='p1'?'var(--tk-ok-bright)':'#ffe08a';

    function mon(n){n=Number(n||0);if(!n)return'฿0';if(n>=1000000)return'฿'+(n/1000000).toFixed(1)+'M';if(n>=1000)return'฿'+(n/1000).toFixed(0)+'K';return'฿'+Math.round(n).toLocaleString('en-US');}
    function es(s){return String(s||'').replace(/[&<>'"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];});}

    // Group by outletId — include account for name lookup
    var byOutlet={};
    groups.forEach(function(g){
      var key=g.outletId||'_all';
      if(!byOutlet[key])byOutlet[key]={outletId:key,accountId:g.accountId||'',items:[],totalComm:0,totalPrimary:0};
      byOutlet[key].items.push(g);
      byOutlet[key].totalComm+=g.commission||0;
      byOutlet[key].totalPrimary+=type==='p1'?(g.total_gmv||0):(g.incremental||0);
    });
    var outlets=Object.values(byOutlet).sort(function(a,b){return b.totalComm-a.totalComm;});
    var totalComm=groups.reduce(function(s,g){return s+(g.commission||0);},0);
    var totalOutlets=outlets.length;

    var allExpandedInitially=totalOutlets<=5; // auto-expand if few
    var expandState={}; // outletId → bool
    outlets.forEach(function(o,i){expandState['pvd'+i]=allExpandedInitially;});
    window._pvDrillExpandState=expandState;

    function buildRows(expanded){
      return outlets.map(function(o,i){
        var oid='pvd'+i;
        var oName=_pvOutletName(o.outletId, o.accountId);
        var isOpen=expanded?true:(window._pvDrillExpandState[oid]||false);
        var skuRows=o.items.map(function(g){
          if(type==='p1'){
            return '<div style="display:grid;grid-template-columns:1fr 64px 56px;padding:7px 16px 7px 24px;border-bottom:1px solid rgba(188,215,255,.08);align-items:center">'
              +'<span style="font-size:11px;font-weight:700;color:rgba(225,238,255,.65)">'+es(g.groupKey||g.group_key)+'</span>'
              +'<span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:700;color:var(--tk-ok-bright)">'+mon(g.total_gmv)+'</span>'
              +'<span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:700;color:#ffe08a">'+mon(g.commission)+'</span>'
              +'</div>';
          } else {
            return '<div style="display:grid;grid-template-columns:1fr 52px 56px 52px;padding:7px 16px 7px 24px;border-bottom:1px solid rgba(188,215,255,.08);align-items:center;gap:2px">'
              +'<div><div style="font-size:11px;font-weight:700;color:rgba(225,238,255,.65)">'+es(g.groupKey||g.group_key)+'</div>'
              +(g.max_baseline_month?'<div style="font-size:9px;color:rgba(225,238,255,.28);margin-top:1px">Base: '+es(g.max_baseline_month)+'</div>':'')+'</div>'
              +'<span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:700;color:rgba(188,215,255,.50)">'+mon(g.max_baseline||0)+'</span>'
              +'<span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:700;color:var(--tk-ok-bright)">'+mon(g.incremental)+'</span>'
              +'<span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:700;color:#ffe08a">'+mon(g.commission)+'</span>'
              +'</div>';
          }
        }).join('');
        var colsHd=type==='p1'?'grid-template-columns:1fr 64px 56px':'grid-template-columns:1fr 52px 56px 52px';
        var amtCols=type==='p1'
          ?('<span style="font-size:13px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:900;color:var(--tk-ok-bright)">'+mon(o.totalPrimary)+'</span>'
            +'<span style="font-size:13px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:900;color:#ffe08a">'+mon(o.totalComm)+'</span>')
          :('<span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;text-align:right;color:rgba(188,215,255,.35)">—</span>'
            +'<span style="font-size:13px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:900;color:var(--tk-ok-bright)">'+mon(o.totalPrimary)+'</span>'
            +'<span style="font-size:13px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:900;color:#ffe08a">'+mon(o.totalComm)+'</span>');
        return '<div>'
          +'<div style="display:grid;'+colsHd+' 20px;padding:10px 16px;border-bottom:1px solid rgba(188,215,255,.09);align-items:center;cursor:pointer;background:rgba(188,215,255,.05)" '
          +'onclick="_commToggleDrillOutlet(\''+oid+'\')">'
          +'<div><div style="font-size:13px;font-weight:900;color:rgba(225,238,255,.92)">'+es(oName)+'</div>'
          +'<div style="font-size:10px;color:rgba(225,238,255,.35);margin-top:2px">'+o.items.length+' กลุ่มสินค้า</div></div>'
          +amtCols
          +'<span id="pvdchev'+i+'" style="font-size:14px;color:rgba(188,215,255,.28);transition:transform 150ms;text-align:right'+(isOpen?';transform:rotate(90deg);color:rgba(188,215,255,.55)':'')+'">›</span>'
          +'</div>'
          +'<div id="'+oid+'" style="display:'+(isOpen?'block':'none')+'">'+skuRows+'</div>'
          +'</div>';
      }).join('');
    }

    window._pvDrillRebuild=function(expandAll){
      outlets.forEach(function(_,i){window._pvDrillExpandState['pvd'+i]=expandAll;});
      var list=document.getElementById('pvDrillList');
      if(list)list.innerHTML=buildRows(expandAll);
      var btn=document.getElementById('pvDrillToggleBtn');
      if(btn){
        var anyOpen=expandAll||outlets.some(function(_,i){return window._pvDrillExpandState['pvd'+i];});
        btn.innerHTML=anyOpen?'<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"1\" y1=\"3.5\" x2=\"13\" y2=\"3.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"7\" x2=\"13\" y2=\"7\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"10.5\" x2=\"13\" y2=\"10.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>':'<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg>';
      }
    };

    var colsHdStr=type==='p1'
      ?'<span>Outlet</span><span style="text-align:right">GMV</span><span style="text-align:right">Comm</span>'
      :'<span>Outlet</span><span style="text-align:right">Base</span><span style="text-align:right">Incr</span><span style="text-align:right">Comm</span>';
    var colsHdGrid=type==='p1'?'grid-template-columns:1fr 64px 56px 20px':'grid-template-columns:1fr 52px 56px 52px 20px';
    var _dcB=window._pvCommDrillCfg||{};
    var _badgeRate=(type==='p1'?_dcB.p1Rate:_dcB.p3Rate); if(_badgeRate==null)_badgeRate=3; // v560: live rate badge (was hardcoded × 3%)

    var html='<div class="pv-comm-sheet" style="display:flex;flex-direction:column;touch-action:pan-y">'
      +'<div style="flex-shrink:0"><div class="pv-comm-sheet-handle"></div>'
      +'<div style="padding:12px 16px 10px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(188,215,255,.10)">'
      +'<button onclick="_commDrillBack()" style="width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.055);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.78);font-size:15px;cursor:pointer;font-family:inherit">‹</button>'
      +'<div style="flex:1"><div style="font-size:15px;font-weight:900;color:#fff;display:flex;align-items:center;gap:8px">'+es(titleLabel)
      +'<span style="font-size:9px;font-weight:850;padding:3px 8px;border-radius:999px;background:'+badgeColor+';color:'+badgeText+';font-family:\'IBM Plex Mono\',monospace;letter-spacing:.04em">× '+_badgeRate+'%</span></div></div>'
      +'<button onclick="_commCloseKamSelfSheet()" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.42);font-size:13px;cursor:pointer;font-family:inherit">✕</button>'
      +'</div>'
      +'<div style="padding:10px 16px;display:flex;align-items:center;border-bottom:1px solid rgba(188,215,255,.10)">'
      +'<div style="flex:1;text-align:center;border-right:1px solid rgba(188,215,255,.08)"><div style="font-size:15px;font-weight:950;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace">'+totalOutlets+'</div><div style="font-size:9px;color:rgba(225,238,255,.35);margin-top:3px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-family:\'IBM Plex Mono\',monospace">outlet</div></div>'
      +'<div style="flex:1;text-align:center"><div style="font-size:15px;font-weight:950;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace">'+mon(totalComm)+'</div><div style="font-size:9px;color:rgba(225,238,255,.35);margin-top:3px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-family:\'IBM Plex Mono\',monospace">commission</div></div>'
      +'<button id="pvDrillToggleBtn" onclick="window._pvDrillRebuild(this.dataset.exp!==\'1\')" data-exp="'+(allExpandedInitially?'1':'0')+'" title="ขยาย/ย่อ" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;background:rgba(255,255,255,.06);border-radius:7px;cursor:pointer;color:rgba(255,255,255,.55);flex-shrink:0">'+(allExpandedInitially?'<svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="1" y1="3.5" x2="13" y2="3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="10.5" x2="13" y2="10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>':'<svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor"/><rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor"/><rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor"/><rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor"/></svg>')+'</button>'
      +'</div>'
      +'<div style="display:grid;'+colsHdGrid+';padding:6px 16px;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(188,215,255,.10);font-size:9px;font-weight:850;text-transform:uppercase;letter-spacing:.08em;color:rgba(225,238,255,.35);font-family:\'IBM Plex Mono\',monospace">'+colsHdStr+'<span></span></div>'
      +'</div>'
      +'<div id="pvDrillList" style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch">'+buildRows(false)+'</div>'
      +'<div style="display:flex;gap:8px;padding:10px 16px 16px;flex-shrink:0;border-top:1px solid rgba(188,215,255,.10)">'
      +'<button onclick="_commExportAuditCSV(\''+type+'\')" style="flex:1;padding:10px;border-radius:10px;background:rgba(188,215,255,.07);border:1px solid rgba(188,215,255,.18);color:rgba(225,238,255,.78);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">↓ ดาวน์โหลด CSV</button>'
      +'</div>'
      +'</div>';

    sheetEl.outerHTML=html;
  }
  window._commOpenUpsellDrill=_commOpenUpsellDrill;

  window._commDrillBack=function(){
    var ov=document.getElementById('pv-comm-sheet-overlay');
    if(!ov||!window._pvCommDrillSaved)return;
    var tmp=document.createElement('div');
    tmp.innerHTML=window._pvCommDrillSaved;
    var restored=tmp.firstElementChild;
    if(restored){
      var old=ov.querySelector('.pv-comm-sheet');
      if(old)old.parentNode.replaceChild(restored,old);
    }
    window._pvCommDrillSaved=null;
    // v247c: fade restored sheet — no translateX overflow
    var restored2=document.querySelector('#pv-comm-sheet-overlay .pv-comm-sheet');
    if(restored2){
      restored2.style.opacity='0';
      restored2.style.transition='opacity 160ms ease';
      requestAnimationFrame(function(){requestAnimationFrame(function(){
        restored2.style.opacity='1';
        setTimeout(function(){restored2.style.transition='';restored2.style.opacity='';},180);
      });});
    }
    // v244-fix: re-attach chooser listeners if restored sheet is the chooser
    requestAnimationFrame(function(){
      var b1=document.getElementById('pvChooseP1');
      var b3=document.getElementById('pvChooseP3');
      if(b1)b1.addEventListener('click',function(){window._commOpenUpsellDrill('p1');});
      if(b3)b3.addEventListener('click',function(){window._commOpenUpsellDrill('p3');});
    });
  };

  window._commToggleDrillOutlet=function(oid){
    var el=document.getElementById(oid);
    if(!el)return;
    var open=el.style.display!=='none';
    el.style.display=open?'none':'block';
    if(window._pvDrillExpandState)window._pvDrillExpandState[oid]=!open;
    // update chevron
    var idx=oid.replace('pvd','');
    var chev=document.getElementById('pvdchev'+idx);
    if(chev){chev.style.transform=open?'':'rotate(90deg)';chev.style.color=open?'rgba(188,215,255,.28)':'rgba(188,215,255,.55)';}
    // update toggle button label
    var btn=document.getElementById('pvDrillToggleBtn');
    if(btn&&window._pvDrillExpandState){
      var anyOpen=Object.values(window._pvDrillExpandState).some(function(v){return v;});
      btn.innerHTML=anyOpen?'<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"1\" y1=\"3.5\" x2=\"13\" y2=\"3.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"7\" x2=\"13\" y2=\"7\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"10.5\" x2=\"13\" y2=\"10.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>':'<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg>';
    }
  };

  // ── Export CSV ──────────────────────────────────────────────────────────────
  window._commExportAuditCSV=function(type){
    var groups=[];
    var filename='audit_upsell.csv';
    var header='';
    if(!type||type==='p1'){
      groups=groups.concat((window._pvCommP1Groups||[]).map(function(g){return Object.assign({},g,{audit_type:'กลุ่มสินค้าใหม่'});}));
    }
    if(!type||type==='p3'){
      groups=groups.concat((window._pvCommP3Groups||[]).map(function(g){return Object.assign({},g,{audit_type:'ยอดเติบโต'});}));
    }
    if(type==='p1'){header='audit_type,outlet_id,group_key,gmv,commission\n';filename='audit_กลุ่มสินค้าใหม่.csv';}
    else if(type==='p3'){header='audit_type,outlet_id,group_key,base,incr,commission,base_month\n';filename='audit_ยอดเติบโต.csv';}
    else{header='audit_type,outlet_id,group_key,gmv,base,incr,commission,base_month\n';filename='audit_upsell.csv';}

    var rows=groups.map(function(g){
      var cols=[
        g.audit_type||'',
        g.outletId||g.outlet_id||'',
        g.groupKey||g.group_key||'',
        type==='p3'?'':(g.total_gmv||0),
        type==='p1'?'':(g.max_baseline||0),
        type==='p1'?'':(g.incremental||0),
        g.commission||0,
        g.max_baseline_month||''
      ].filter(function(_,i){
        if(type==='p1')return[0,1,2,3,6].indexOf(i)>=0;
        if(type==='p3')return[0,1,2,4,5,6,7].indexOf(i)>=0;
        return true;
      });
      return cols.map(function(v){return typeof v==='string'&&v.indexOf(',')>=0?'"'+v+'"':v;}).join(',');
    }).join('\n');

    var blob=new Blob(['\ufeff'+header+rows],{type:'text/csv;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url;a.download=filename;a.click();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
  };

  // ── v235: Drill helper — push content into existing sheet ──────────────────
  window._pvPushDrill=function _pvPushDrill(html){
    var ov=document.getElementById('pv-comm-sheet-overlay');
    var sheetEl=ov&&ov.querySelector('.pv-comm-sheet');
    if(!sheetEl)return;
    window._pvCommDrillSaved=sheetEl.outerHTML;
    var tmp=document.createElement('div');tmp.innerHTML=html;
    var el=tmp.firstElementChild;
    if(!el)return;
    // v247c: fade only — translateX caused sheet to overflow overlay bounds
    el.style.opacity='0';
    el.style.transition='opacity 180ms ease';
    sheetEl.parentNode.replaceChild(el,sheetEl);
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        el.style.opacity='1';
        // clear transition after done so it doesnt affect content
        setTimeout(function(){el.style.transition='';el.style.opacity='';},200);
      });
    });
  }
  window._pvDrillHeader=function _pvDrillHeader(title,badge,badgeBg,badgeColor){
    return '<div style="flex-shrink:0"><div class="pv-comm-sheet-handle"></div>'
      +'<div style="padding:12px 16px 10px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(188,215,255,.10)">'
      +'<button onclick="window._commDrillBack()" style="width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.055);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.78);font-size:15px;cursor:pointer;font-family:inherit">‹</button>'
      +'<div style="flex:1;font-size:15px;font-weight:900;color:#fff;display:flex;align-items:center;gap:8px">'+title
      +(badge?'<span style="font-size:9px;font-weight:850;padding:3px 8px;border-radius:999px;background:'+badgeBg+';color:'+badgeColor+';font-family:\'IBM Plex Mono\',monospace;letter-spacing:.04em">'+badge+'</span>':'')
      +'</div>'
      +'<button onclick="_commCloseKamSelfSheet()" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.42);font-size:13px;cursor:pointer;font-family:inherit">✕</button>'
      +'</div></div>';
  }

  // NRR drill — tier table + action note
  // v247e: NRR drill rewritten to reuse _tgtShowCohortSheet design
  // Injects NRR result for current KAM then opens the existing cohort sheet (tabs: NRR/Comeback/Expansion)
  window._commDrillNRR=function(){
    var st=window._pvCommDrillSt||{};
    var email=st&&st.email;
    // If cohort sheet available + NRR data computable → use rich design
    if(email&&typeof _tgtComputeKamNRR==='function'&&typeof _tgtShowCohortSheet==='function'){
      var nrrResult=null;
      try{ nrrResult=_tgtComputeKamNRR(email,null); }catch(e){}
      if(nrrResult){
        window._ncsLastNrrResult=nrrResult;
        // Label: prefer portview display name
        var pvRow=(portviewBulkData||[]).find(function(r){return r.kamEmail===email;});
        window._ncsKamLabel=(pvRow&&pvRow.kamName)||email.split('@')[0];
        _tgtShowCohortSheet('nrr');
        return;
      }
    }
    // Fallback: minimal panel (no outlet data)
    var cfg=window._pvCommDrillCfg||{};
    var src=window._pvCommDrillSrc||{};
    function mon(n){return'฿'+Math.round(n||0).toLocaleString('en-US');}
    var html='<div class="pv-comm-sheet" style="display:flex;flex-direction:column;max-height:80vh">'
      +_pvDrillHeader('NRR Commission','','','')
      +'<div style="overflow-y:auto;flex:1">'
      +'<div style="padding:14px 18px 10px">'+(cfg.tierRows||'')+'</div>'
      +'<div style="padding:10px 18px;background:var(--tk-ok-dim);border-top:1px solid var(--tk-ok-dim)">'
      +'<div style="font-size:12px;color:rgba(225,238,255,.75);line-height:1.6">'+(cfg.action||'')+'</div>'
      +'</div>'
      +(src.nrr>0?'<div style="padding:14px 18px"><div style="display:flex;justify-content:space-between">'
        +'<span style="font-size:13px;color:rgba(225,238,255,.75)">NRR Payout</span>'
        +'<span style="font-size:18px;font-weight:900;color:var(--tk-ok-bright);font-family:\'IBM Plex Mono\',monospace">'+mon(src.nrr)+'</span>'
        +'</div></div>':'')
      +'</div></div>';
    _pvPushDrill(html);
  };

  // Upsell chooser — pick กลุ่มสินค้าใหม่ or ยอดเติบโต
  window._commDrillUpsellChooser=function(){
    var p1g=window._pvCommP1Groups||[];
    var p3g=window._pvCommP3Groups||[];
    function mon(n){n=Number(n||0);if(!n)return'\u0e3f0';if(n>=1000)return'\u0e3f'+(n/1000).toFixed(0)+'K';return'\u0e3f'+Math.round(n).toLocaleString('en-US');}
    var p1comm=p1g.reduce(function(s,g){return s+(g.commission||0);},0);
    var p3comm=p3g.reduce(function(s,g){return s+(g.commission||0);},0);
    var _dc=window._pvCommDrillCfg||{};
    var _p1R=(_dc.p1Rate!=null)?_dc.p1Rate:3, _p3R=(_dc.p3Rate!=null)?_dc.p3Rate:3; // v560: live rates (was hardcoded 3%)
    if(p1g.length&&!p3g.length){window._commOpenUpsellDrill('p1');return;}
    if(p3g.length&&!p1g.length){window._commOpenUpsellDrill('p3');return;}
    var html='<div class="pv-comm-sheet" style="display:flex;flex-direction:column;touch-action:pan-y">'
      +window._pvDrillHeader('กลุ่มสินค้าใหม่ + ยอดเติบโต','','','')
      +'<div style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;padding:16px 18px;display:flex;flex-direction:column;gap:10px">'
      +(p1g.length
        ?'<div id="pvChooseP1" style="padding:16px;border-radius:12px;background:var(--tk-ok-dim);border:1px solid var(--tk-ok-dim-2);cursor:pointer;display:flex;align-items:center;justify-content:space-between">'
          +'<div><div style="font-size:14px;font-weight:700;color:rgba(225,238,255,.88)">กลุ่มสินค้าใหม่</div>'
          +'<div style="font-size:11px;color:rgba(225,238,255,.40);margin-top:3px">'+p1g.length+' outlet × group · GMV × '+_p1R+'%</div></div>'
          +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:var(--tk-ok-bright);font-family:\'IBM Plex Mono\',monospace">'+mon(p1comm)+'</div>'
          +'<div style="font-size:13px;color:rgba(188,215,255,.35)">›</div></div>'
          +'</div>'
        :'')
      +(p3g.length
        ?'<div id="pvChooseP3" style="padding:16px;border-radius:12px;background:rgba(255,224,138,.08);border:1px solid rgba(255,224,138,.18);cursor:pointer;display:flex;align-items:center;justify-content:space-between">'
          +'<div><div style="font-size:14px;font-weight:700;color:rgba(225,238,255,.88)">ยอดเติบโต</div>'
          +'<div style="font-size:11px;color:rgba(225,238,255,.40);margin-top:3px">'+p3g.length+' outlet × group · Incr × '+_p3R+'%</div></div>'
          +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace">'+mon(p3comm)+'</div>'
          +'<div style="font-size:13px;color:rgba(188,215,255,.35)">›</div></div>'
          +'</div>'
        :'')
      +'</div></div>';
    window._pvPushDrill(html);
    // attach listeners after DOM is ready (no inline onclick = no quote hell)
    requestAnimationFrame(function(){
      var b1=document.getElementById('pvChooseP1');
      var b3=document.getElementById('pvChooseP3');
      if(b1)b1.addEventListener('click',function(){window._commOpenUpsellDrill('p1');});
      if(b3)b3.addEventListener('click',function(){window._commOpenUpsellDrill('p3');});
    });
  };

  window._commDrillExpansion=function(){
    var st=window._pvCommDrillSt||{};
    var cfg=window._pvCommDrillCfg||{};
    var EX='#00c8b0';
    function mon(n){n=Number(n||0);if(!n)return'\u0e3f0';if(n>=1000000)return'\u0e3f'+(n/1000000).toFixed(1)+'M';if(n>=1000)return'\u0e3f'+(n/1000).toFixed(0)+'K';return'\u0e3f'+Math.round(n).toLocaleString('en-US');}
    function es(s){return String(s||'').replace(/[&<>'"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];});}

    var nrrResult=typeof _tgtComputeKamNRR==='function'?_tgtComputeKamNRR(st.email,null):null;
    var rate=Number(String(cfg.outRate||'1.5'))/100||0.015;

    var allAccounts=[];
    var totalGmv=0, totalOutlets=0;
    var expandState={};
    function addExpansion(result){
      if(!result)return;
      (result.expansionDetail||[]).forEach(function(g){
        var acctGmv=0;
        var outlets=(g.outlets||[]);
        outlets.forEach(function(o){acctGmv+=o.currGmv||0;totalGmv+=o.currGmv||0;});
        totalOutlets+=outlets.length;
        if(!outlets.length)return;
        var aid='pvExAcct'+allAccounts.length;
        expandState[aid]=false;
        allAccounts.push({aid:aid,name:g.acctName||g.acctId||'—',gmv:acctGmv,outlets:outlets});
      });
    }
    if(nrrResult){addExpansion(nrrResult);addExpansion(nrrResult.transferIn);addExpansion(nrrResult.newFromSales);}

    var comm=Math.round(totalGmv*rate);

    function buildRows(forceOpen){
      return allAccounts.map(function(a){
        var isOpen=forceOpen!==undefined?forceOpen:(expandState[a.aid]||false);
        var outletRows=a.outlets.map(function(o){
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 16px 9px 24px;border-bottom:1px solid rgba(0,200,176,.06)">'
            +'<span style="font-size:12px;color:rgba(225,238,255,.72)">'+es(o.outletName||o.outletId||'—')+'</span>'
            +'<span style="font-size:12px;font-weight:700;color:'+EX+';font-family:monospace">'+mon(o.currGmv||0)+'</span>'
            +'</div>';
        }).join('');
        return '<div>'
          +'<div onclick="_pvExToggle(\''+a.aid+'\')" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(0,200,176,.10);cursor:pointer;background:rgba(0,200,176,.04);transition:background 120ms">'
          +'<span style="font-size:13px;font-weight:900;color:rgba(225,238,255,.92)">'+es(a.name)+'</span>'
          +'<div style="display:flex;align-items:center;gap:10px">'
          +'<span style="font-size:13px;font-weight:900;color:'+EX+';font-family:monospace">'+mon(a.gmv)+'</span>'
          +'<span id="pvExChev'+a.aid+'" style="font-size:14px;color:rgba(0,200,176,.45);transition:transform 200ms ease'+(isOpen?';transform:rotate(90deg)':'')+'">›</span>'
          +'</div></div>'
          +'<div id="'+a.aid+'" style="overflow:hidden;transition:max-height 250ms ease;max-height:'+(isOpen?'600px':'0')+'">'+outletRows+'</div>'
          +'</div>';
      }).join('');
    }

    window._pvExToggle=function(aid){
      var el=document.getElementById(aid);
      if(!el)return;
      var isOpen=el.style.maxHeight!=='0px'&&el.style.maxHeight!=='';
      el.style.maxHeight=isOpen?'0':'600px';
      expandState[aid]=!isOpen;
      var chev=document.getElementById('pvExChev'+aid);
      if(chev){chev.style.transform=isOpen?'':'rotate(90deg)';chev.style.color=isOpen?'rgba(0,200,176,.45)':'rgba(0,200,176,.85)';}
      var btn=document.getElementById('pvExToggleBtn');
      if(btn){var anyOpen=Object.values(expandState).some(Boolean);btn.innerHTML=anyOpen?'<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"1\" y1=\"3.5\" x2=\"13\" y2=\"3.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"7\" x2=\"13\" y2=\"7\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"10.5\" x2=\"13\" y2=\"10.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>':'<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg>';}
    };
    window._pvExToggleAll=function(){
      var anyOpen=Object.values(expandState).some(Boolean);
      var target=!anyOpen;
      Object.keys(expandState).forEach(function(k){expandState[k]=target;});
      document.querySelectorAll('#pv-comm-sheet-overlay [id^="pvExAcct"]').forEach(function(el){
        el.style.maxHeight=target?'600px':'0';
        var chev=document.getElementById('pvExChev'+el.id);
        if(chev){chev.style.transform=target?'rotate(90deg)':'';chev.style.color=target?'rgba(0,200,176,.85)':'rgba(0,200,176,.45)';}
      });
      var btn=document.getElementById('pvExToggleBtn');
      if(btn)btn.innerHTML=target?'<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"1\" y1=\"3.5\" x2=\"13\" y2=\"3.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"7\" x2=\"13\" y2=\"7\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"10.5\" x2=\"13\" y2=\"10.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>':'<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg>';
    };

    // Scorecard: hero GMV + secondary account/outlet counts + commission
    var scorecard='<div style="padding:14px 16px 12px;border-bottom:1px solid rgba(0,200,176,.10);flex-shrink:0">'
      // Hero row: GMV (large) + commission
      +'<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">'
      +'<div>'
      +'<div style="font-size:28px;font-weight:950;color:'+EX+';font-family:monospace;line-height:1.1;letter-spacing:-.02em">'+mon(totalGmv)+'</div>'
      +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(0,200,176,.6);margin-top:3px">Expansion GMV · MTD</div>'
      +'</div>'
      +'<div style="text-align:right">'
      +'<div style="font-size:22px;font-weight:950;color:#ffe08a;font-family:monospace;line-height:1.1;text-shadow:0 0 16px rgba(255,224,138,.15)">'+mon(comm)+'</div>'
      +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,224,138,.5);margin-top:3px">Commission</div>'
      +'</div>'
      +'</div>'
      // Secondary: account + outlet counts
      +'<div style="display:flex;gap:12px">'
      +'<div style="display:flex;align-items:center;gap:5px;background:rgba(0,200,176,.08);border:1px solid rgba(0,200,176,.15);border-radius:20px;padding:3px 10px">'
      +'<span style="font-size:12px;font-weight:700;color:'+EX+';font-family:monospace">'+allAccounts.length+'</span>'
      +'<span style="font-size:11px;color:rgba(0,200,176,.65)">account</span>'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:5px;background:rgba(0,200,176,.08);border:1px solid rgba(0,200,176,.15);border-radius:20px;padding:3px 10px">'
      +'<span style="font-size:12px;font-weight:700;color:'+EX+';font-family:monospace">'+totalOutlets+'</span>'
      +'<span style="font-size:11px;color:rgba(0,200,176,.65)">สาขา</span>'
      +'</div>'
      +'</div>'
      +'</div>';

    var html='<div class="pv-comm-sheet" style="display:flex;flex-direction:column;touch-action:pan-y;overflow:hidden">'
      +window._pvDrillHeader('Expansion','× '+(cfg.outRate||'1.5')+'%','rgba(0,200,176,.12)','#00c8b0')
      +scorecard
      +(allAccounts.length
        ?'<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;flex-shrink:0;border-bottom:1px solid rgba(0,200,176,.08)">'
          +'<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgba(225,238,255,.35)">สาขาใหม่เดือนนี้</span>'
          +'<button id="pvExToggleBtn" onclick="window._pvExToggleAll()" title="ขยาย/ย่อ" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;background:rgba(255,255,255,.06);border-radius:7px;cursor:pointer;color:rgba(255,255,255,.55);flex-shrink:0"><svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg></button>'
          +'</div>'
          +'<div id="pvExList" style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch">'+buildRows()+'</div>'
        :'<div style="padding:24px;text-align:center;color:rgba(225,238,255,.35);font-size:13px">ไม่มีสาขาใหม่เดือนนี้</div>'
      )
      +'</div>';
    window._pvPushDrill(html);
  };
  window._commDrillNewComeback=window._commDrillExpansion; // alias for back-compat
  window._commDrillHandover=function(){
    var src=window._pvCommDrillSrc||{};
    var cfg=window._pvCommDrillCfg||{};
    var hd=src.handover_detail||{};
    function mon(n){return'฿'+Math.round(n||0).toLocaleString('en-US');}
    var hit2=hd.retention_pct>=cfg.hoT2;
    var hit3=hd.retention_pct>=cfg.hoT3;
    var detailRows=(hd.detail||[]).slice(0,8).map(function(a){
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(188,215,255,.09)">'
        +'<div><div style="font-size:12px;font-weight:700;color:rgba(225,238,255,.82)">'+String(a.name||a.account_id||'—').slice(0,30)+'</div>'
        +'<div style="font-size:10px;color:rgba(225,238,255,.35);margin-top:1px">Base '+mon(a.baseline)+' → MTD '+mon(a.current)+'</div></div>'
        +'</div>';
    }).join('');
    var html='<div class="pv-comm-sheet" style="display:flex;flex-direction:column">'
      +_pvDrillHeader('Handover','','','')
      +'<div style="overflow-y:auto;flex:1;padding:14px 18px">'
      +(hd.accounts?'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">'
        +'<div class="pv-comm-sheet-kpi"><div class="pv-comm-sheet-kpi-label">Accounts</div><div class="pv-comm-sheet-kpi-val" style="font-size:20px">'+(hd.accounts||0)+'</div></div>'
        +'<div class="pv-comm-sheet-kpi '+(hit2?'val-good':'')+'"><div class="pv-comm-sheet-kpi-label">Retention</div><div class="pv-comm-sheet-kpi-val" style="font-size:20px">'+(hd.retention_pct||0)+'%</div></div>'
        +'</div>':'')
      +'<div style="background:rgba(188,215,255,.06);border:1px solid rgba(188,215,255,.12);border-radius:10px;padding:12px 14px;margin-bottom:12px">'
      +'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(188,215,255,.08)">'
      +'<span style="font-size:12px;color:'+(hit2?'rgba(225,238,255,.78)':'rgba(225,238,255,.35)')+'">≥'+cfg.hoT2+'% → ฿'+cfg.hoT2Pay+'</span>'
      +'<span style="font-size:12px;font-weight:700;color:'+(hit2?'var(--tk-ok-bright)':'rgba(225,238,255,.25)')+'">'+(hit2?'✓ '+mon(Number(String(cfg.hoT2Pay).replace(/,/g,''))||0):'—')+'</span>'
      +'</div>'
      +'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(188,215,255,.08)">'
      +'<span style="font-size:12px;color:'+(hit3?'rgba(225,238,255,.78)':'rgba(225,238,255,.35)')+'">≥'+cfg.hoT3+'% → +฿'+cfg.hoT3Bon+' (bonus)</span>'
      +'<span style="font-size:12px;font-weight:700;color:'+(hit3?'var(--tk-ok-bright)':'rgba(225,238,255,.25)')+'">'+(hit3?'✓ '+mon(Number(String(cfg.hoT3Bon).replace(/,/g,''))||0):'—')+'</span>'
      +'</div>'
      +'<div style="display:flex;justify-content:space-between;padding:6px 0">'
      +'<span style="font-size:13px;font-weight:700;color:rgba(225,238,255,.78)">Handover Payout</span>'
      +'<span style="font-size:16px;font-weight:900;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace">'+mon(src.handover||0)+'</span>'
      +'</div></div>'
      +(detailRows?'<div style="font-size:9px;font-weight:850;text-transform:uppercase;letter-spacing:.07em;color:rgba(225,238,255,.35);margin-bottom:8px;font-family:\'IBM Plex Mono\',monospace">รายชื่อร้าน</div>'+detailRows:'')
      +'</div></div>';
    _pvPushDrill(html);
  };
  window._commRenderKamSelfStrip=renderCompactStrip;
  // _commOpenKamSelfSheet + _commCloseKamSelfSheet wired by CDS block below
  try{ _commRenderKamSelfStrip=renderCompactStrip; }catch(e){}
  // v224e render-gate: DOMContentLoaded timers removed — renderCompactStrip called via _commGatedRender
})();


//////////////////////////////////////////////////////////////////////////////
// ── Commission Detail Sheet (cds) ────────────────────────────────────────
// Single-sheet stack: Zone A summary · Zone B tabs · Zone C body · Zone D footer
// Session 2: HTML template functions + open/close/tab-switch skeleton
// Zone C content filled per-tab in Sessions 3–7
//////////////////////////////////////////////////////////////////////////////

(function(){

  // ── Helpers ───────────────────────────────────────────────────────────
  function esc(v){
    return String(v==null?'':v).replace(/[&<>'"]/g,function(c){
      return{'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];
    });
  }
  function fmt(n){
    n=Number(n||0);
    if(!n)return'฿0';
    if(n>=1000000)return'฿'+(n/1000000).toFixed(1)+'M';
    if(n>=1000)return'฿'+Math.round(n/1000)+'K';
    return'฿'+Math.round(n).toLocaleString('en-US');
  }
  function fmtFull(n){ n=Number(n||0); return n?'฿'+Math.round(n).toLocaleString('en-US'):'฿0'; }

  // ── Chip labels (single-row abbreviations) ────────────────────────────
  var CDS_TABS=[
    {key:'p1', label:'สินค้าใหม่', short:'ใหม่',   cls:'t-p1',  valCls:'v-amber'},
    {key:'p3', label:'ยอดเติบโต', short:'โต',     cls:'t-p3',  valCls:'v-amber'},
    {key:'nrr',label:'NRR',       short:'NRR',    cls:'t-nrr', valCls:'v-green'},
    {key:'exp',label:'Expansion', short:'Exp',    cls:'t-exp', valCls:'v-teal'},
    {key:'ho', label:'Handover',  short:'H/O',    cls:'t-ho',  valCls:'v-blue'}
  ];

  // ── Zone A: Summary bar ───────────────────────────────────────────────
  function _cdsSummaryHtml(src, activeKey){
    var payout=src.loading?null:src.final;
    var gateOk=!src.gate_active;
    var gatePct=Math.round((src.gate_cap||1)*100);
    var gateHtml=(!src.loading&&src.gate&&src.gate.ach_pct!==null)
      ?'<span class="cds-gate-pill '+(gateOk?'ok':'warn')+'">× '+gatePct+'% '+(gateOk?'✓':'⚠')+'</span>'
      :'';
    var amtHtml=src.loading
      ?'<span class="cds-shimmer" style="display:inline-block;width:80px;height:22px;vertical-align:-4px"></span>'
      :esc(fmt(payout));

    var amounts={
      p1: src.upsell_sku  ? Math.round(Number((src.upsell_sku_detail&&src.upsell_sku_detail.p1&&src.upsell_sku_detail.p1.comm)||0)) : 0,
      p3: src.upsell_sku  ? Math.round(Number((src.upsell_sku_detail&&src.upsell_sku_detail.p3&&src.upsell_sku_detail.p3.comm)||0)) : 0,
      nrr:Number(src.nrr||0),
      exp:Number(src.upsell_outlet||0),
      ho: Number(src.handover||0)
    };

    var chipsHtml=CDS_TABS.map(function(t){
      var active=t.key===activeKey?'active':'';
      var amt=src.loading?'—':fmt(amounts[t.key]||0);
      return '<button class="cds-chip '+t.cls+' '+active+'" onclick="_cdsSetTab(\''+t.key+'\')">'
        +'<span class="cds-chip-dot"></span>'+esc(t.short)+' '+esc(amt)
        +'</button>';
    }).join('');

    return '<div class="cds-summary">'
      +'<div class="cds-summary-head">'
      +'<div><div class="cds-summary-label">ค่าคอมฯ เดือนนี้</div>'
      +'<div class="cds-summary-payout">'+amtHtml+gateHtml+'</div></div>'
      +'<button class="cds-summary-close" onclick="_cdsClose()">✕</button>'
      +'</div>'
      +'<div class="cds-chips">'+chipsHtml+'</div>'
      +'</div>';
  }

  // ── Zone B: Tab bar ───────────────────────────────────────────────────
  function _cdsTabBarHtml(src, activeKey){
    var counts={
      p1:(src.upsell_sku_detail&&src.upsell_sku_detail.p1&&src.upsell_sku_detail.p1.groups)?src.upsell_sku_detail.p1.groups.length:0,
      p3:(src.upsell_sku_detail&&src.upsell_sku_detail.p3&&src.upsell_sku_detail.p3.groups)?src.upsell_sku_detail.p3.groups.length:0,
      nrr:null,
      exp:src.upsell_outlet_detail?src.upsell_outlet_detail.outlet_gmv||0:null,
      ho: src.handover_detail?src.handover_detail.accounts:0
    };
    return '<div class="cds-tabs">'+CDS_TABS.map(function(t){
      var active=t.key===activeKey?'active':'';
      var sub=counts[t.key]!==null?'<br><span style="font-size:8px;opacity:.6">'+counts[t.key]+'</span>':'';
      return '<button class="cds-tab '+t.cls+' '+active+'" onclick="_cdsSetTab(\''+t.key+'\')">'
        +esc(t.label)+sub+'</button>';
    }).join('')+'</div>';
  }

  // ── Zone C: column header templates ──────────────────────────────────
  var CDS_COL_DEFS={
    p1: [{l:'OUTLET'},{l:'GMV',r:1},{l:'COMM',r:1}],
    p3: [{l:'OUTLET'},{l:'ฐาน',r:1},{l:'โต',r:1},{l:'COMM',r:1}],
    nrr:[{l:'OUTLET'},{l:'ฐาน',r:1},{l:'RUN RATE',r:1},{l:'MTD',r:1}],
    exp:[{l:'OUTLET/ACCOUNT'},{l:'สาขา',r:1},{l:'GMV',r:1},{l:'COMM',r:1}],
    ho: [{l:'ACCOUNT'},{l:'ฐาน',r:1},{l:'MTD',r:1},{l:'RET%',r:1}]
  };
  function _cdsTblHeadHtml(tabKey){
    var cols=CDS_COL_DEFS[tabKey]||CDS_COL_DEFS.p1;
    return '<div class="cds-tbl-head '+tabKey+'-cols">'
      +cols.map(function(c){return'<span class="cds-th'+(c.r?' r':'')+'">'+(c.l||'')+'</span>';}).join('')
      +'</div>';
  }

  // ── Zone C: accordion chip row ────────────────────────────────────────
  function _cdsChipRowHtml(id, name, meta, val, valCls, open){
    return '<div class="cds-chip-row'+(open?' open':'')+'" id="'+id+'" onclick="_cdsToggleRow(\''+id+'\')">'
      +'<span class="cds-chip-chev">&#8250;</span>'
      +'<div style="flex:1;min-width:0">'
      +'<div class="cds-chip-name">'+esc(name)+'</div>'
      +(meta?'<div class="cds-chip-meta">'+esc(meta)+'</div>':'')
      +'</div>'
      +'<span class="cds-chip-val '+valCls+'">'+esc(val)+'</span>'
      +'</div>'
      +'<div class="cds-sub-rows'+(open?' open':'')+'" id="'+id+'-sub">';
      // sub-rows injected here by each tab renderer
  }
  function _cdsChipRowClose(){ return '</div></div>'; }

  // ── Zone C: sub-row (grid columns) ────────────────────────────────────
  // cells = [{text, cls}]
  function _cdsSubRowHtml(cells, tabKey){
    return '<div class="cds-sub-row '+tabKey+'-cols">'
      +cells.map(function(c){
        return'<span class="'+(c.cls||'cds-val v-muted')+'">'+esc(c.text||'')+'</span>';
      }).join('')
      +'</div>';
  }

  // ── Zone C: proof card ────────────────────────────────────────────────
  // rows = [{label, result, pass}]  pass=true/false/null(neutral)
  function _cdsProofHtml(id, rows){
    return '<div class="cds-proof" id="proof-'+id+'">'
      +rows.map(function(r){
        var resCls='cds-proof-result'+(r.pass===true?' pass':r.pass===false?' fail':'');
        return'<div class="cds-proof-row">'
          +'<span class="cds-proof-label">'+esc(r.label)+'</span>'
          +'<span class="'+resCls+'">'+esc(r.result)+'</span>'
          +'</div>';
      }).join('')
      +'</div>';
  }

  // ── Zone D: Total + Footer ─────────────────────────────────────────────
  function _cdsTotalHtml(label, val, valCls){
    return '<div class="cds-total">'
      +'<span class="cds-total-label">'+esc(label)+'</span>'
      +'<span class="cds-total-val '+valCls+'">'+esc(val)+'</span>'
      +'</div>';
  }
  function _cdsFooterHtml(showExport, exportFn){
    return '<div class="cds-footer">'
      +(showExport?'<button class="cds-btn primary" onclick="'+esc(exportFn||'')+'">↓ Export CSV</button>':'')
      +'<button class="cds-btn secondary" onclick="_cdsClose();setTimeout(openCommissionRulebook,80)">กฎค่าคอมฯ</button>'
      +'<button class="cds-btn secondary" onclick="_cdsClose();setTimeout(openCommissionHistory,80)">Commission ย้อนหลัง</button>'
      +'</div>';
  }

  // ── Zone C: placeholder (shown while tab renderer not yet built) ──────
  function _cdsTabPlaceholder(label){
    return '<div class="cds-empty">'+esc(label)+'<br>'
      +'<span style="font-size:10px;opacity:.5">coming next session</span></div>';
  }

  // ── Row toggle (accordion) ────────────────────────────────────────────
  window._cdsToggleRow=function(id){
    var row=document.getElementById(id);
    var sub=document.getElementById(id+'-sub');
    if(!row||!sub)return;
    var open=row.classList.toggle('open');
    sub.classList.toggle('open',open);
    var btn=document.getElementById('cds-toggle-btn');
    if(btn){
      var anyOpen=document.getElementById('cds-body').querySelectorAll('.cds-sub-rows.open').length>0;
      btn.innerHTML=anyOpen?'<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"1\" y1=\"3.5\" x2=\"13\" y2=\"3.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"7\" x2=\"13\" y2=\"7\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"10.5\" x2=\"13\" y2=\"10.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>':'<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg>';
    }
  };
  window._cdsToggleAll=function(){
    var body=document.getElementById('cds-body');
    if(!body)return;
    var chips=Array.from(body.querySelectorAll('.cds-chip-row'));
    var subs=Array.from(body.querySelectorAll('.cds-sub-rows'));
    var anyOpen=subs.some(function(s){return s.classList.contains('open');});
    chips.forEach(function(c){c.classList.toggle('open',!anyOpen);});
    subs.forEach(function(s){s.classList.toggle('open',!anyOpen);});
    var btn=document.getElementById('cds-toggle-btn');
    if(btn)btn.innerHTML=anyOpen?'<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg>':'<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"1\" y1=\"3.5\" x2=\"13\" y2=\"3.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"7\" x2=\"13\" y2=\"7\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"10.5\" x2=\"13\" y2=\"10.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>';
  };

  // ── Tab switch (L1 → L2 entry, or L2 tab switch) ────────────────────────
  window._cdsSetTab=function(key){
    window._cdsActiveTab=key;

    if(window._cdsLevel!==2){
      // Transition Level 1 → Level 2
      window._cdsLevel=2;
      var src=window._cdsSrc||{loading:true,final:0,nrr:0,upsell_sku:0,upsell_outlet:0,handover:0,gate_cap:1,gate_active:false};
      var sheet=document.querySelector('#cds-overlay .cds-sheet');
      if(!sheet)return;
      var handle=sheet.querySelector('.cds-handle');
      var handleHtml=handle?handle.outerHTML:'<div class="cds-handle"><div></div></div>';
      sheet.innerHTML=handleHtml
        +window._cdsRenderL2Header(key,src)
        +'<div id="cds-meta-slot"></div>'
        +'<div class="cds-tbl-head" id="cds-tbl-head-slot"></div>'
        +'<div class="cds-body" id="cds-body"></div>'
        +'<div id="cds-total-slot"></div>'
        +_cdsFooterHtml(src.upsell_sku>0||src.upsell_outlet>0,'_cdsExportCSV&&_cdsExportCSV()');
      _cdsRenderZoneC(key,src);
      var body=document.getElementById('cds-body');
      if(body){void body.offsetWidth;body.classList.add('cds-body-enter');}
      return;
    }

    // Already Level 2 — switch tabs
    var ov=document.getElementById('cds-overlay');
    if(!ov)return;
    ov.querySelectorAll('.cds-tab-card').forEach(function(c){
      c.classList.toggle('active',c.classList.contains('t-'+key));
    });
    // update formula bar
    var fb=document.getElementById('cds-formula-bar');
    if(fb){fb.className='cds-formula t-'+key;fb.innerHTML=_cdsFormulaContent(key);}
    var src=window._cdsSrc||{loading:true,final:0,nrr:0,upsell_sku:0,upsell_outlet:0,handover:0,gate_cap:1,gate_active:false};
    _cdsRenderZoneC(key,src);
    var body=document.getElementById('cds-body');
    if(body){body.classList.remove('cds-body-enter');void body.offsetWidth;body.classList.add('cds-body-enter');body.scrollTop=0;}
  };

  // ── Zone C dispatcher (stubs replaced per session) ────────────────────
  function _cdsRenderZoneC(key, src){
    var head=document.getElementById('cds-tbl-head-slot');
    var meta=document.getElementById('cds-meta-slot');
    var body=document.getElementById('cds-body');
    var total=document.getElementById('cds-total-slot');
    if(!body)return;

    var t=CDS_TABS.find(function(x){return x.key===key;})||CDS_TABS[0];

    // Column header — update class + innerHTML in place
    if(head){
      var cols=CDS_COL_DEFS[key]||CDS_COL_DEFS.p1;
      head.className='cds-tbl-head '+key+'-cols';
      head.innerHTML=cols.map(function(c){
        return'<span class="cds-th'+(c.r?' r':'')+'">'+(c.l||'')+'</span>';
      }).join('');
    }

    // Delegate to tab-specific renderer when available
    var fn=window['_cdsRender_'+key];
    if(typeof fn==='function'){
      fn(src, body, meta, total);
      return;
    }
    // Placeholder
    if(meta)meta.innerHTML='';
    body.innerHTML=_cdsTabPlaceholder(t.label);
    if(total)total.innerHTML=_cdsTotalHtml('รวม '+t.label,'—',t.valCls);
  }

  // ── Main open: renders Level 1 summary ────────────────────────────────
  function _cdsOpen(){
    if(typeof _commBuildKamSelfState!=='function')return;
    var st=_commBuildKamSelfState();
    if(!st)return;

    var nrr=Number(st.payout||0);
    var src={loading:false,nrr:nrr,upsell_sku:0,upsell_outlet:0,handover:0,gate_cap:1,gate_active:false,final:nrr};
    if(typeof bulkUpsellData!=='undefined'&&bulkUpsellData&&bulkUpsellData.loaded&&typeof _commBuildKamPayout==='function'){
      try{
        var p=_commBuildKamPayout(st.email);
        if(p){
          src.upsell_sku=Number((p.upsell_sku&&p.upsell_sku.total_comm)||0);
          src.upsell_outlet=Number((p.upsell_outlet&&p.upsell_outlet.commission)||0);
          src.handover=Number((p.handover&&p.handover.payout)||0);
          src.gate_cap=Number(p.gate_cap||1);
          src.gate_active=!!(p.gate&&p.gate.gate_active);
          src.gate=p.gate;
          src.upsell_sku_detail=p.upsell_sku;
          src.upsell_outlet_detail=p.upsell_outlet;
          src.handover_detail=p.handover;
          src.final=Math.round((nrr+src.upsell_sku+src.upsell_outlet+src.handover)*src.gate_cap);
        }
      }catch(e){ console.warn('[cds] buildSrc error',e); }
    }else if(typeof bulkUpsellData==='undefined'||!bulkUpsellData||!bulkUpsellData.loaded){
      src.loading=true;
      if(st.email&&typeof _fetchUpsellBundle==='function')_fetchUpsellBundle(st.email).catch(function(){});
    }

    window._cdsSrc=src;
    window._cdsKamSt=st;
    window._cdsLevel=1;
    window._cdsActiveTab=window._cdsActiveTab||'p1';

    // Minimal shell: handle + scrollable body (L1 fills it)
    var html='<div class="cds-overlay" id="cds-overlay" onclick="if(event.target===this)_cdsClose()">'
      +'<div class="cds-sheet"><div class="cds-handle"><div></div></div>'
      +'<div class="cds-body" id="cds-body"></div>'
      +'</div></div>';

    var existing=document.getElementById('cds-overlay');
    if(existing)existing.remove();
    var tmp=document.createElement('div');
    tmp.innerHTML=html;
    document.body.appendChild(tmp.firstElementChild);

    // Render Level 1 summary
    window._cdsRenderL1(src,st);

    requestAnimationFrame(function(){
      var ov=document.getElementById('cds-overlay');
      if(ov){ov.classList.add('on');}
    });
  }

  // ── Close ──────────────────────────────────────────────────────────────
  function _cdsClose(){
    var ov=document.getElementById('cds-overlay');
    if(!ov)return;
    ov.classList.remove('on');
    setTimeout(function(){ov.remove();},280);
  }

  // ── Wire up: replace old openCompactSheet ────────────────────────────
  window._commOpenKamSelfSheet=_cdsOpen;
  window._cdsOpen=_cdsOpen;
  window._cdsClose=_cdsClose;
  try{ _commOpenKamSelfSheet=_cdsOpen; }catch(e){}

  // Expose template helpers for later sessions
  window._cdsHtml={
    chipRow:_cdsChipRowHtml,chipRowClose:_cdsChipRowClose,
    subRow:_cdsSubRowHtml,proof:_cdsProofHtml,
    total:_cdsTotalHtml,footer:_cdsFooterHtml,
    fmt:fmt,esc:esc,fmtFull:fmtFull,tabs:CDS_TABS,colDefs:CDS_COL_DEFS
  };

})();


//////////////////////////////////////////////////////////////////////////////
// ── CDS: Level 1 Summary + Level 2 Header + Formula Bar ─────────────────
//////////////////////////////////////////////////////////////////////////////

// ── Formula bar content (config-aware) ────────────────────────────────────
function _cdsFormulaContent(key) {
  function cfg(k, p, d) { try { return typeof _commGetConfig==='function'?_commGetConfig(k,p,d):d; }catch(e){return d;} }
  var texts = {
    p1: 'สินค้าใหม่ที่ไม่เคยซื้อใน 3 เดือน · GMV ≥ ฿'+Number(cfg('upsell_sku','p1_min_gmv',5000)).toLocaleString('en-US')+' · × '+Math.round(cfg('upsell_sku','p1_rate',0.03)*100)+'%',
    p3: 'สินค้าเดิม ยอดเกิน '+cfg('upsell_sku','p3_threshold_pct',2.00).toFixed(1)+'× baseline (เพิ่ม >'+Math.round((cfg('upsell_sku','p3_threshold_pct',2.00)-1)*100)+'%) · Incr ≥ ฿'+Number(cfg('upsell_sku','p3_min_incremental',5000)).toLocaleString('en-US')+' · × '+Math.round(cfg('upsell_sku','p3_rate',0.03)*100)+'%',
    nrr: 'สาขาเดิมรักษายอดไว้ได้แค่ไหนเทียบ baseline · tier-based payout จาก NRR%',
    exp: 'สาขาใหม่ หรือ comeback ในรอบ 6 เดือน · GMV × '+(Math.round(cfg('upsell_outlet','rate',0.015)*1000)/10)+'%',
    ho:  'ร้านจาก Sales เดือนก่อน วัด performance เดือนนี้ (normalize)<br>≥'+cfg('handover','tier2_pct',100)+'% ได้ ฿'+Number(cfg('handover','tier2_payout',2500)).toLocaleString('en-US')+' · ≥'+cfg('handover','tier3_pct',120)+'% ได้ +฿'+(Number(cfg('handover','tier2_payout',2500))+Number(cfg('handover','tier3_bonus',2500))).toLocaleString('en-US')
  };
  return '<div class="cds-formula-dot"></div><div class="cds-formula-text">'+(texts[key]||'')+'</div>';
}

// ── Level 2 header: back button + tab cards + formula bar ─────────────────
window._cdsRenderL2Header = function(key, src) {
  var fmt = window._cdsHtml ? window._cdsHtml.fmt : function(n){n=Number(n||0);if(!n)return'฿0';if(n>=1000)return'฿'+Math.round(n/1000)+'K';return'฿'+Math.round(n);};
  var fmtFull = (window._cdsHtml && window._cdsHtml.fmtFull) ? window._cdsHtml.fmtFull : function(n){n=Number(n||0);return n?'฿'+Math.round(n).toLocaleString('en-US'):'฿0';};
  var amounts = {
    p1: src.upsell_sku_detail&&src.upsell_sku_detail.p1 ? Number(src.upsell_sku_detail.p1.comm||0) : 0,
    p3: src.upsell_sku_detail&&src.upsell_sku_detail.p3 ? Number(src.upsell_sku_detail.p3.comm||0) : 0,
    nrr: Number(src.nrr||0),
    exp: Number(src.upsell_outlet||0),
    ho:  Number(src.handover||0)
  };
  var tabs=[{key:'p1',label:'สินค้าใหม่'},{key:'p3',label:'ยอดเติบโต'},{key:'nrr',label:'NRR'},{key:'exp',label:'Expansion'},{key:'ho',label:'Handover'}];
  var tabCards=tabs.map(function(t){
    var active=t.key===key?'active':'';
    var amt=amounts[t.key]||0;
    var amtStr=src.loading?'—':('฿'+Math.round(amt).toLocaleString('en-US'));
    var tcFontSize=amtStr.length>8?'font-size:11px;':'font-size:14px;';
    return '<button class="cds-tab-card t-'+t.key+' '+active+'" onclick="_cdsSetTab(\'' + t.key + '\')">'
      +'<span class="tc-name">'+t.label+'</span>'
      +'<span class="tc-amt" style="'+tcFontSize+'">'+amtStr+'</span>'
      +'</button>';
  }).join('');
  return '<div class="cds-l2-header">'
    +'<div class="cds-l2-back">'
    +'<button class="cds-l2-back-btn" onclick="_cdsBackToSummary()">&#8249;</button>'
    +'<span class="cds-l2-back-title">ค่าคอมฯ เดือนนี้</span>'
    +'</div>'
    +'<div class="cds-tab-bar">'+tabCards+'</div>'
    +'<div class="cds-formula t-'+key+'" id="cds-formula-bar">'+_cdsFormulaContent(key)+'</div>'
    +'</div>';
};

// ── Back to Level 1 ────────────────────────────────────────────────────────
window._cdsBackToSummary = function() {
  window._cdsLevel = 1;
  var sheet = document.querySelector('#cds-overlay .cds-sheet');
  if(!sheet) return;
  var handle = sheet.querySelector('.cds-handle');
  var handleHtml = handle ? handle.outerHTML : '<div class="cds-handle"><div></div></div>';
  sheet.innerHTML = handleHtml + '<div class="cds-body" id="cds-body"></div>';
  window._cdsRenderL1(window._cdsSrc, window._cdsKamSt);
  var body = document.getElementById('cds-body');
  if(body){void body.offsetWidth; body.classList.add('cds-body-enter'); body.scrollTop=0;}
};

// ── Level 1 summary — EXACT original "วิธีคิดค่าคอมฯ" design ───────────────
window._cdsRenderL1 = function(src, st) {
  var body = document.getElementById('cds-body');
  if(!body) return;
  src = src || {}; st = st || {};
  var h   = window._cdsHtml;
  var fmtFull = (window._cdsHtml && window._cdsHtml.fmtFull) ? window._cdsHtml.fmtFull : function(n){n=Number(n||0);return n?'฿'+Math.round(n).toLocaleString('en-US'):'฿0';};
  var fmt = h ? h.fmt : function(n){n=Number(n||0);if(!n)return'฿0';if(n>=1000000)return'฿'+(n/1000000).toFixed(1)+'M';if(n>=1000)return'฿'+Math.round(n/1000)+'K';return'฿'+Math.round(n);};
  var esc = h ? h.esc : function(v){return String(v==null?'':v).replace(/[&<>'"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];});};

  var nrrAmt    = Number(src.nrr||0);
  var p1amt     = src.upsell_sku_detail&&src.upsell_sku_detail.p1 ? Number(src.upsell_sku_detail.p1.comm||0):0;
  var p3amt     = src.upsell_sku_detail&&src.upsell_sku_detail.p3 ? Number(src.upsell_sku_detail.p3.comm||0):0;
  var upsellAmt = p1amt + p3amt;
  var expAmt    = Number(src.upsell_outlet||0);
  var hoAmt     = Number(src.handover||0);
  var subtotal  = nrrAmt + upsellAmt + expAmt + hoAmt;
  var finalAmt  = src.loading ? null : src.final;
  var gateOk    = !src.gate_active;
  var gatePct   = Math.round((src.gate_cap||1)*100);
  var pctText   = (st.pct!==null&&st.pct!==undefined) ? (st.pct+'%') : '—';
  var nowStr    = (function(){var d=new Date();return d.getDate()+'/'+(d.getMonth()+1)+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);})();

  // Row subtitles
  var nrrSub   = esc((pctText!=='—'?'NRR '+pctText+' · ':'')+esc(st.tierLabel||st.ruleName||'—'));
  var p1cnt    = src.upsell_sku_detail&&src.upsell_sku_detail.p1&&src.upsell_sku_detail.p1.groups?src.upsell_sku_detail.p1.groups.length:0;
  var p3cnt    = src.upsell_sku_detail&&src.upsell_sku_detail.p3&&src.upsell_sku_detail.p3.groups?src.upsell_sku_detail.p3.groups.length:0;
  var upSub    = (p1cnt?'สินค้าใหม่ '+p1cnt+' รายการ':'')+(p1cnt&&p3cnt?' · ':'')+(p3cnt?'ยอดเติบโต '+p3cnt+' รายการ':'');
  if(!upSub) upSub='สินค้าใหม่ + ยอดเติบโต';
  var ed       = src.upsell_outlet_detail;
  // v560: live config (was hardcoded 1.5% / ฿2,500 tiers)
  var _cfgQ    = function(k,p,d){ try{ return typeof _commGetConfig==='function'?_commGetConfig(k,p,d):d; }catch(e){ return d; } };
  var _orPct   = Math.round(_cfgQ('upsell_outlet','rate',0.015)*1000)/10;
  var _ht2     = _cfgQ('handover','tier2_pct',100), _ht3 = _cfgQ('handover','tier3_pct',120);
  var _ht2Pay  = Number(_cfgQ('handover','tier2_payout',2500)).toLocaleString('en-US');
  var _ht3Bon  = Number(_cfgQ('handover','tier3_bonus',2500)).toLocaleString('en-US');
  var expSub   = ed&&ed.outlet_gmv>0?'สาขาใหม่ × '+_orPct+'% · GMV '+fmt(ed.outlet_gmv):' สาขาใหม่/comeback × '+_orPct+'%';
  var hd       = src.handover_detail||{};
  var hoSub    = hd.accounts?hd.accounts+' account · retention '+(hd.retention_pct||0)+'%':'≥'+_ht2+'% = ฿'+_ht2Pay+' · ≥'+_ht3+'% = +฿'+_ht3Bon;

  function srcRow(tabKey, dotColor, name, sub, amt) {
    var earned = amt > 0;
    return '<div class="cds-src-row" data-tab="'+tabKey+'">'
      +'<div class="cds-src-dot" style="background:'+dotColor+';'+(earned?'box-shadow:0 0 7px '+dotColor.replace(')',', .45)'):'')+'" ></div>'
      +'<div class="cds-src-body"><div class="cds-src-name">'+esc(name)+'</div>'
      +'<div class="cds-src-sub">'+sub+'</div></div>'
      +'<div class="cds-src-right">'
      +'<span class="cds-src-amt'+(earned?' earned':'')+'" style="color:'+(earned?'#ffe08a':'rgba(225,238,255,.28)')+'">'+fmtFull(amt)+'</span>'
      +'<span class="cds-src-chevron">&#8250;</span>'
      +'</div></div>';
  }

  // ── KPI grid ──────────────────────────────────────────────────────────────
  var kpiHtml = '<div class="cds-l1-kpis">'
    +'<div class="cds-l1-kpi">'
    +'<div class="cds-l1-kpi-label">ค่าคอมฯ สูงสุด</div>'
    +'<div class="cds-l1-kpi-val gold">'+(src.loading?'…':fmtFull(finalAmt))+'</div>'
    +'</div>'
    +'<div class="cds-l1-kpi'+(gateOk?' passed':'')+'">'
    +'<div class="cds-l1-kpi-label">NRR'+(gateOk?' ✓':'')+' </div>'
    +'<div class="cds-l1-kpi-val">'+esc(pctText)+'</div>'
    +'</div></div>';

  // ── Gate card ─────────────────────────────────────────────────────────────
  var gateGmv  = src.gate&&src.gate.ach_pct!=null ? src.gate.ach_pct : (st.pct||null);
  var gT1 = 95; try{gT1=_commGetConfig('gmv_gate','threshold_1',95);}catch(e){}
  var gateSub  = gateGmv!==null ? 'NRR '+gateGmv+'% ≥'+gT1+'% — '+(gateOk?'ผ่าน':'ถูก cap') : 'NRR —';
  var gateHtml = '<div class="cds-l1-gate '+(gateOk?'ok':'warn')+'">'
    +'<div class="cds-l1-gate-info">'
    +'<div class="cds-l1-gate-title">NRR Gate</div>'
    +'<div class="cds-l1-gate-sub">'+esc(gateSub)+'</div>'
    +'</div>'
    +'<div class="cds-l1-gate-result">× '+gatePct+'% '+(gateOk?'✓':'⚠')+'</div>'
    +'</div>';

  // ── Final payout hero ─────────────────────────────────────────────────────
  var heroHtml = '<div class="cds-l1-final">'
    +'<div class="cds-l1-final-label">Final Payout</div>'
    +'<div class="cds-l1-final-amt">'+(src.loading?'…':fmtFull(finalAmt))+'</div>'
    +(!src.loading?'<div class="cds-l1-final-check">ตรงกับ commission panel ✓</div>':'')
    +'<div class="cds-l1-final-ts">คำนวณจาก CSV ที่โหลดอยู่ · '+nowStr+'</div>'
    +'</div>';

  // ── Export button ─────────────────────────────────────────────────────────
  var exportBtn = (upsellAmt>0||expAmt>0)
    ?'<div style="padding:0 18px 8px"><button class="cds-btn primary" style="width:100%;font-size:13px" onclick="_cdsExportCSV&&_cdsExportCSV()">&#8595; Export audit CSV</button></div>'
    :'';

  body.innerHTML =
    '<div style="padding:14px 18px 0;display:flex;align-items:flex-start;justify-content:space-between">'
    +'<div><div class="cds-l1-title">วิธีคิดค่าคอมฯ</div>'
    +'<div class="cds-l1-ts">สรุปตามแหล่งที่มา · คำนวณ '+nowStr+'</div>'
    +'</div>'
    +'<button class="cds-summary-close" onclick="_cdsClose()">✕</button>'
    +'</div>'
    +(src.loading?'<div style="font-size:11px;color:#ffe08a;padding:6px 18px 0">⚠ กำลังโหลด upsell...</div>':'')
    +kpiHtml
    +'<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:rgba(225,238,255,.28);padding:2px 18px 2px">ที่มาของยอด</div>'
    +srcRow('nrr',  'var(--tk-ok-bright)', 'NRR Commission', nrrSub, nrrAmt)
    +srcRow('p1',   '#ffe08a', 'สินค้าใหม่ + ยอดเติบโต', upSub, upsellAmt)
    +srcRow('exp',  '#00c8b0', 'Expansion', expSub, expAmt)
    +srcRow('ho',   '#bcd7ff', 'Handover', hoSub, hoAmt)
    +'<div style="height:1px;background:rgba(188,215,255,.08);margin:2px 18px 0"></div>'
    +'<div class="cds-l1-subtotal"><span class="cds-l1-subtotal-lbl">Subtotal</span>'
    +'<span class="cds-l1-subtotal-val">'+fmtFull(subtotal)+'</span></div>'
    +gateHtml
    +'<div style="height:1px;background:rgba(188,215,255,.08);margin:0 18px 0"></div>'
    +heroHtml
    +exportBtn
    +'<div style="padding:0 18px 18px;display:flex;gap:7px;margin-top:6px">'
    +'<button class="cds-btn secondary" style="flex:1" onclick="_cdsClose();setTimeout(openCommissionHistory,80)">Commission ย้อนหลัง</button>'
    +'<button class="cds-btn secondary" style="flex:1" onclick="_cdsClose();setTimeout(openCommissionRulebook,80)">กฎค่าคอมฯ</button>'
    +'</div>';

  body.querySelectorAll('.cds-src-row').forEach(function(row){
    row.addEventListener('click',function(){_cdsSetTab(row.getAttribute('data-tab'));});
  });
  body.classList.add('cds-body-enter');
};


//////////////////////////////////////////////////////////////////////////////
// ── CDS Session 3: P1 tab renderer (สินค้าใหม่) ──────────────────────────
//////////////////////////////////////////////////////////////////////////////

window._cdsRender_p1 = function(src, body, meta, totalEl) {
  var h = window._cdsHtml;
  var fmtFull = (window._cdsHtml && window._cdsHtml.fmtFull) ? window._cdsHtml.fmtFull : function(n){n=Number(n||0);return n?'฿'+Math.round(n).toLocaleString('en-US'):'฿0';};
  if (!h) return;

  function cfg(k, p, d) {
    try { return typeof _commGetConfig === 'function' ? _commGetConfig(k, p, d) : d; } catch(e) { return d; }
  }
  var p1Rate    = Math.round(cfg('upsell_sku', 'p1_rate', 0.03) * 100);
  var p1MinGmv  = Number(cfg('upsell_sku', 'p1_min_gmv', 5000));
  var fmt = h.fmt;
  var esc = h.esc;

  if (src.loading) {
    if (meta) meta.innerHTML = '';
    body.innerHTML = '<div class="cds-empty">กำลังโหลด upsell...</div>';
    if (totalEl) totalEl.innerHTML = h.total('รวม สินค้าใหม่', '—', 'v-amber');
    return;
  }

  var d = src.upsell_sku_detail && src.upsell_sku_detail.p1;
  var groups = (d && d.groups) ? d.groups : [];
  var totalComm = d ? Number(d.comm || 0) : 0;

  if (!groups.length) {
    if (meta) meta.innerHTML = '';
    body.innerHTML = '<div class="cds-empty">ไม่มีกลุ่มสินค้าใหม่เดือนนี้<br>'
      + '<span style="font-size:10px;opacity:.5">เงื่อนไข: GMV ≥ ฿' + p1MinGmv.toLocaleString('en-US') + ' · ไม่เคยซื้อใน 3 เดือนย้อนหลัง</span></div>';
    if (totalEl) totalEl.innerHTML = h.total('รวม สินค้าใหม่', '฿0', 'v-dim');
    return;
  }

  var byOutlet = {};
  groups.forEach(function(g) {
    var key = g.outletId || '_all';
    if (!byOutlet[key]) byOutlet[key] = { outletId: key, accountId: g.accountId || '', items: [], totalComm: 0, totalGmv: 0 };
    byOutlet[key].items.push(g);
    byOutlet[key].totalComm += g.commission || 0;
    byOutlet[key].totalGmv  += g.total_gmv  || 0;
  });
  var outlets = Object.values(byOutlet).sort(function(a, b) { return b.totalComm - a.totalComm; });

  if (meta) {
    meta.innerHTML = '<div class="cds-meta">'
      + '<span class="cds-meta-text">' + outlets.length + ' outlet · ' + groups.length + ' กลุ่มสินค้า · × ' + p1Rate + '%</span>'
      + '<button class="cds-toggle-btn" id="cds-toggle-btn" onclick="_cdsToggleAll()" title="ขยาย/ย่อ"><svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg></button>'
      + '</div>';
  }

  var html = '';
  outlets.forEach(function(o, oi) {
    var rowId   = 'p1r' + oi;
    var oName   = typeof _pvOutletName === 'function' ? _pvOutletName(o.outletId, o.accountId) : (o.outletId || '—');
    html += h.chipRow(rowId, oName, o.items.length + ' กลุ่มสินค้า', fmt(o.totalComm), 'v-amber', oi < 3);
    o.items.forEach(function(g, gi) {
      var proofId = rowId + 'g' + gi;
      html += h.subRow([
        { text: g.groupKey || g.group_key || '—', cls: 'cds-outlet-name' },
        { text: fmt(g.total_gmv),  cls: 'cds-val v-muted' },
        { text: fmt(g.commission), cls: 'cds-val v-amber' }
      ], 'p1');
      html += h.proof(proofId, [
        { label: 'GMV เดือนนี้',     result: fmt(g.total_gmv) },
        { label: 'เกณฑ์ขั้นต่ำ',   result: '≥ ฿' + p1MinGmv.toLocaleString('en-US'), pass: g.total_gmv >= p1MinGmv },
        { label: 'อัตราค่าคอมฯ',    result: p1Rate + '%' },
        { label: 'commission',       result: fmt(g.total_gmv) + ' × ' + p1Rate + '% = ' + fmt(g.commission), pass: true }
      ]);
    });
    html += h.chipRowClose();
  });

  body.innerHTML = html;

  body.querySelectorAll('.cds-sub-row.p1-cols').forEach(function(row) {
    row.style.cursor = 'pointer';
    row.addEventListener('click', function() {
      var proof = row.nextElementSibling;
      if (proof && proof.classList.contains('cds-proof')) proof.classList.toggle('open');
    });
  });

  if (totalEl) totalEl.innerHTML = h.total('รวม สินค้าใหม่', fmtFull(totalComm), 'v-amber');
};


//////////////////////////////////////////////////////////////////////////////
// ── CDS Session 4: P3 tab renderer (ยอดเติบโต) ───────────────────────────
//////////////////////////////////////////////////////////////////////////////

window._cdsRender_p3 = function(src, body, meta, totalEl) {
  var h = window._cdsHtml;
  var fmtFull = (window._cdsHtml && window._cdsHtml.fmtFull) ? window._cdsHtml.fmtFull : function(n){n=Number(n||0);return n?'฿'+Math.round(n).toLocaleString('en-US'):'฿0';};
  if (!h) return;

  function cfg(k, p, d) {
    try { return typeof _commGetConfig === 'function' ? _commGetConfig(k, p, d) : d; } catch(e) { return d; }
  }
  var p3Rate      = Math.round(cfg('upsell_sku', 'p3_rate', 0.03) * 100);
  var p3Thresh    = cfg('upsell_sku', 'p3_threshold_pct', 2.00);
  var p3ThreshPct = Math.round((p3Thresh - 1) * 100);
  var p3MinIncr   = Number(cfg('upsell_sku', 'p3_min_incremental', 5000));
  var fmt = h.fmt;
  var esc = h.esc;

  if (src.loading) {
    if (meta) meta.innerHTML = '';
    body.innerHTML = '<div class="cds-empty">กำลังโหลด upsell...</div>';
    if (totalEl) totalEl.innerHTML = h.total('รวม ยอดเติบโต', '—', 'v-amber');
    return;
  }

  var d = src.upsell_sku_detail && src.upsell_sku_detail.p3;
  var groups = (d && d.groups) ? d.groups : [];
  var totalComm = d ? Number(d.comm || 0) : 0;

  if (!groups.length) {
    if (meta) meta.innerHTML = '';
    body.innerHTML = '<div class="cds-empty">ไม่มียอดเติบโตเดือนนี้<br>'
      + '<span style="font-size:10px;opacity:.5">เงื่อนไข: เพิ่ม &gt;' + p3ThreshPct + '% vs baseline · ≥ ฿' + p3MinIncr.toLocaleString('en-US') + '</span></div>';
    if (totalEl) totalEl.innerHTML = h.total('รวม ยอดเติบโต', '฿0', 'v-dim');
    return;
  }

  var byOutlet = {};
  groups.forEach(function(g) {
    var key = g.outletId || '_all';
    if (!byOutlet[key]) byOutlet[key] = { outletId: key, accountId: g.accountId || '', items: [], totalComm: 0, totalIncr: 0 };
    byOutlet[key].items.push(g);
    byOutlet[key].totalComm += g.commission  || 0;
    byOutlet[key].totalIncr += g.incremental || 0;
  });
  var outlets = Object.values(byOutlet).sort(function(a, b) { return b.totalComm - a.totalComm; });

  if (meta) {
    meta.innerHTML = '<div class="cds-meta">'
      + '<span class="cds-meta-text">' + outlets.length + ' outlet · ' + groups.length + ' กลุ่ม · &gt;' + p3ThreshPct + '% × ' + p3Rate + '%</span>'
      + '<button class="cds-toggle-btn" id="cds-toggle-btn" onclick="_cdsToggleAll()" title="ขยาย/ย่อ"><svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg></button>'
      + '</div>';
  }

  var html = '';
  outlets.forEach(function(o, oi) {
    var rowId = 'p3r' + oi;
    var oName = typeof _pvOutletName === 'function' ? _pvOutletName(o.outletId, o.accountId) : (o.outletId || '—');
    html += h.chipRow(rowId, oName, o.items.length + ' กลุ่มสินค้า', fmt(o.totalComm), 'v-amber', oi < 3);
    o.items.forEach(function(g, gi) {
      var proofId = rowId + 'g' + gi;
      var growthPct = g.max_baseline > 0 ? Math.round(g.existing_curr / g.max_baseline * 100) : 0;
      var passGrowth = growthPct > (p3ThreshPct + 100);
      var passMinIncr = g.incremental >= p3MinIncr;
      html += h.subRow([
        { text: g.groupKey || g.group_key || '—', cls: 'cds-outlet-name' },
        { text: fmt(g.max_baseline),  cls: 'cds-val v-muted' },
        { text: fmt(g.incremental),   cls: 'cds-val v-green' },
        { text: fmt(g.commission),    cls: 'cds-val v-amber' }
      ], 'p3');
      html += h.proof(proofId, [
        { label: 'Baseline (' + esc(g.max_baseline_month || '') + ')', result: fmt(g.max_baseline) },
        { label: 'GMV เดือนนี้', result: fmt(g.existing_curr) + ' (' + growthPct + '%)' },
        { label: 'ต้องเพิ่ม &gt;' + p3ThreshPct + '%', result: passGrowth ? 'ผ่าน ✓' : 'ไม่ผ่าน ✗', pass: passGrowth },
        { label: 'Incremental ≥ ฿' + p3MinIncr.toLocaleString('en-US'), result: fmt(g.incremental), pass: passMinIncr },
        { label: 'commission', result: fmt(g.incremental) + ' × ' + p3Rate + '% = ' + fmt(g.commission), pass: true }
      ]);
    });
    html += h.chipRowClose();
  });

  body.innerHTML = html;

  body.querySelectorAll('.cds-sub-row.p3-cols').forEach(function(row) {
    row.style.cursor = 'pointer';
    row.addEventListener('click', function() {
      var proof = row.nextElementSibling;
      if (proof && proof.classList.contains('cds-proof')) proof.classList.toggle('open');
    });
  });

  if (totalEl) totalEl.innerHTML = h.total('รวม ยอดเติบโต', fmtFull(totalComm), 'v-amber');
};


//////////////////////////////////////////////////////////////////////////////
// ── CDS Session 5: Expansion tab renderer ────────────────────────────────
//////////////////////////////////////////////////////////////////////////////

window._cdsRender_exp = function(src, body, meta, totalEl) {
  var h = window._cdsHtml;
  var fmtFull = (window._cdsHtml && window._cdsHtml.fmtFull) ? window._cdsHtml.fmtFull : function(n){n=Number(n||0);return n?'฿'+Math.round(n).toLocaleString('en-US'):'฿0';};
  if (!h) return;

  function cfg(k, p, d) {
    try { return typeof _commGetConfig === 'function' ? _commGetConfig(k, p, d) : d; } catch(e) { return d; }
  }
  var rate    = cfg('upsell_outlet', 'rate', 0.015);
  var ratePct = Math.round(rate * 1000) / 10;
  var fmt = h.fmt;
  var esc = h.esc;

  // ── Collect expansion data via _tgtComputeKamNRR ─────────────────────
  var st  = window._cdsKamSt || {};
  var nrr = null;
  try {
    if (st.email && typeof _tgtComputeKamNRR === 'function') {
      nrr = _tgtComputeKamNRR(st.email, null);
    }
  } catch(e) {}

  // Merge expansionDetail from core + transferIn + newFromSales
  var allAccounts = [];
  var totalGmv = 0;

  function addDetail(result) {
    if (!result) return;
    (result.expansionDetail || []).forEach(function(g) {
      var outlets = (g.outlets || []).filter(function(o) { return (o.currGmv || 0) > 0; });
      if (!outlets.length) return;
      var acctGmv = outlets.reduce(function(s, o) { return s + (o.currGmv || 0); }, 0);
      totalGmv += acctGmv;
      allAccounts.push({ name: g.acctName || g.acctId || '—', gmv: acctGmv, outlets: outlets });
    });
  }
  if (nrr) { addDetail(nrr); addDetail(nrr.transferIn); addDetail(nrr.newFromSales); }

  var totalComm = Math.round(totalGmv * rate);
  var totalOutlets = allAccounts.reduce(function(s, a) { return s + a.outlets.length; }, 0);

  // ── Fallback: use aggregate from src when NRR data unavailable ────────
  var noDetail = !nrr && src.upsell_outlet_detail;

  if (!nrr && !src.loading) {
    if (meta) meta.innerHTML = '';
    body.innerHTML = '<div class="cds-empty">โหลด portview.csv เพื่อดูรายละเอียด outlet<br>'
      + '<span style="font-size:10px;opacity:.5">commission รวม: '
      + fmt(Number(src.upsell_outlet || 0)) + '</span></div>';
    if (totalEl) totalEl.innerHTML = h.total('รวม Expansion', fmtFull(Number(src.upsell_outlet || 0)), 'v-amber');
    return;
  }

  if (!allAccounts.length) {
    if (meta) meta.innerHTML = '';
    body.innerHTML = '<div class="cds-empty">ไม่มี outlet ใหม่/comeback เดือนนี้</div>';
    if (totalEl) totalEl.innerHTML = h.total('รวม Expansion', '฿0', 'v-dim');
    return;
  }

  // Sort by GMV desc
  allAccounts.sort(function(a, b) { return b.gmv - a.gmv; });

  // ── Meta bar ──────────────────────────────────────────────────────────
  if (meta) {
    meta.innerHTML = '<div class="cds-meta">'
      + '<span class="cds-meta-text">' + allAccounts.length + ' account · ' + totalOutlets + ' outlet · × ' + ratePct + '%</span>'
      + '<button class="cds-toggle-btn" id="cds-toggle-btn" onclick="_cdsToggleAll()" title="ขยาย/ย่อ"><svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg></button>'
      + '</div>';
  }

  // ── Body rows ─────────────────────────────────────────────────────────
  var html = '';
  allAccounts.forEach(function(a, ai) {
    var rowId   = 'expr' + ai;
    var acctComm = Math.round(a.gmv * rate);

    html += h.chipRow(rowId,
      esc(a.name),
      a.outlets.length + ' outlet',
      fmt(acctComm), 'v-amber', ai < 3);

    a.outlets.forEach(function(o, oi) {
      var outletComm = Math.round((o.currGmv || 0) * rate);
      html += h.subRow([
        { text: o.outletName || o.outletId || '—', cls: 'cds-outlet-name' },
        { text: '',                                 cls: 'cds-val v-dim' },       // สาขา col (blank at outlet level)
        { text: fmt(o.currGmv || 0),                cls: 'cds-val v-teal' },
        { text: fmt(outletComm),                    cls: 'cds-val v-amber' }
      ], 'exp');
    });

    html += h.chipRowClose();
  });

  body.innerHTML = html;

  // ── Total bar ─────────────────────────────────────────────────────────
  // v753c: Expansion total — show GMV + commission aligned with exp-cols
  if (totalEl) {
    totalEl.innerHTML = '<div class="cds-total exp-cols">'
      + '<span class="cds-total-label">รวม Expansion</span>'
      + '<span class="cds-total-val v-dim">' + totalOutlets + ' outlet</span>'
      + '<span class="cds-total-val v-teal">' + fmtFull(totalGmv) + '</span>'
      + '<span class="cds-total-val v-amber">' + fmtFull(totalComm) + '</span>'
      + '</div>';
  }
};


//////////////////////////////////////////////////////////////////////////////
// ── CDS Session 6: Handover tab renderer ─────────────────────────────────
//////////////////////////////////////////////////////////////////////////////

window._cdsRender_ho = function(src, body, meta, totalEl) {
  var h = window._cdsHtml;
  var fmtFull = (window._cdsHtml && window._cdsHtml.fmtFull) ? window._cdsHtml.fmtFull : function(n){n=Number(n||0);return n?'฿'+Math.round(n).toLocaleString('en-US'):'฿0';};
  if (!h) return;

  function cfg(k, p, d) {
    try { return typeof _commGetConfig === 'function' ? _commGetConfig(k, p, d) : d; } catch(e) { return d; }
  }
  var t2Pct  = cfg('handover', 'tier2_pct',    100);
  var t3Pct  = cfg('handover', 'tier3_pct',    120);
  var t2Pay  = Number(cfg('handover', 'tier2_payout', 2500));
  var t3Bon  = Number(cfg('handover', 'tier3_bonus',  2500));
  var fmt = h.fmt;
  var esc = h.esc;

  var hd = src.handover_detail || {};
  var detail = hd.detail || [];
  var retPct = hd.retention_pct || 0;
  var hit2   = retPct >= t2Pct;
  var hit3   = retPct >= t3Pct;
  var payout = Number(src.handover || 0);

  if (!hd.accounts) {
    if (meta) meta.innerHTML = '';
    body.innerHTML = '<div class="cds-empty">ไม่มี account handover เดือนนี้</div>';
    if (totalEl) totalEl.innerHTML = h.total('รวม Handover', '฿0', 'v-dim');
    return;
  }

  if (meta) {
    var tierHtml =
      '<span style="font-size:10px;font-family:\'IBM Plex Mono\',monospace;padding:3px 8px;border-radius:999px;'
      + (hit2 ? 'background:var(--tk-ok-dim);color:var(--tk-ok-bright);' : 'background:rgba(255,255,255,.05);color:rgba(225,238,255,.3);')
      + '">≥' + t2Pct + '% ฿' + fmt(t2Pay) + '</span> '
      + '<span style="font-size:10px;font-family:\'IBM Plex Mono\',monospace;padding:3px 8px;border-radius:999px;'
      + (hit3 ? 'background:var(--tk-ok-dim);color:var(--tk-ok-bright);' : 'background:rgba(255,255,255,.05);color:rgba(225,238,255,.3);')
      + '">≥' + t3Pct + '% +฿' + fmt(t3Bon) + '</span>';

    meta.innerHTML = '<div class="cds-meta" style="flex-wrap:wrap;gap:6px;padding:8px 16px;">'
      + '<span class="cds-meta-text">' + hd.accounts + ' account · retention <b style="color:'
      + (hit2 ? 'var(--tk-ok-bright)' : retPct >= (t2Pct * 0.9) ? '#ffe08a' : 'rgba(225,238,255,.6)') + '">'
      + retPct + '%</b></span>'
      + '<span style="display:flex;gap:5px;">' + tierHtml + '</span>'
      + '</div>';
  }

  var sorted = detail.slice().sort(function(a, b) { return (b.current || 0) - (a.current || 0); });
  var html = '';

  sorted.forEach(function(a, idx) {
    var retA   = a.baseline > 0 ? Math.round(a.current / a.baseline * 100) : 0;
    var retCls = retA >= t2Pct ? 'v-green' : retA >= (t2Pct * 0.85) ? 'v-amber' : 'v-dim';
    var proofId = 'hor' + idx;
    html += '<div class="cds-sub-row ho-cols" style="cursor:pointer" data-hoid="' + proofId + '">'
      + '<div style="min-width:0">'
      + '<div class="cds-outlet-name">' + esc(String(a.name || a.account_id || '—').slice(0, 36)) + '</div>'
      + (a.oldKamName ? '<div class="cds-outlet-meta">มาจาก: ' + esc(a.oldKamName) + '</div>' : '')
      + '</div>'
      + '<span class="cds-val v-muted">' + fmt(a.baseline) + '</span>'
      + '<span class="cds-val v-blue">'  + fmt(a.current)  + '</span>'
      + '<span class="cds-val ' + retCls + '">' + retA + '%</span>'
      + '</div>'
      + h.proof(proofId, [
          { label: 'Baseline GMV', result: fmt(a.baseline) },
          { label: 'MTD GMV',      result: fmt(a.current) },
          { label: 'Retention',    result: retA + '%', pass: retA >= t2Pct }
        ]);
  });

  body.innerHTML = html;

  body.addEventListener('click', function(e) {
    var row = e.target.closest('[data-hoid]');
    if (!row) return;
    var el = document.getElementById('proof-' + row.getAttribute('data-hoid'));
    if (el) el.classList.toggle('open');
  });

  // v753c: Handover total — show baseline + MTD + payout aligned with ho-cols
  if (totalEl) {
    var _hoBase = detail.reduce(function(s,a){return s+(a.baseline||0);},0);
    var _hoMtd  = detail.reduce(function(s,a){return s+(a.current||0);},0);
    totalEl.innerHTML = '<div class="cds-total ho-cols">'
      + '<span class="cds-total-label">รวม Handover</span>'
      + '<span class="cds-total-val v-dim">' + fmtFull(_hoBase) + '</span>'
      + '<span class="cds-total-val v-blue">' + fmtFull(_hoMtd) + '</span>'
      + '<span class="cds-total-val ' + (payout > 0 ? 'v-amber' : 'v-dim') + '">' + fmtFull(payout) + '</span>'
      + '</div>';
  }
};


//////////////////////////////////////////////////////////////////////////////
// ── CDS Session 7: NRR tab renderer ──────────────────────────────────────
//////////////////////////////////////////////////////////////////////////////

window._cdsRender_nrr = function(src, body, meta, totalEl) {
  var h   = window._cdsHtml;
  var fmtFull = (window._cdsHtml && window._cdsHtml.fmtFull) ? window._cdsHtml.fmtFull : function(n){n=Number(n||0);return n?'฿'+Math.round(n).toLocaleString('en-US'):'฿0';};
  var st  = window._cdsKamSt || {};
  if (!h) return;
  var fmt = h.fmt;
  var esc = h.esc;

  // ── Get NRR compute result ────────────────────────────────────────────
  var nr = null;
  try {
    if (st.email && typeof _tgtComputeKamNRR === 'function') {
      window._ncsLastNrrResult = window._ncsLastNrrResult || null;
      nr = _tgtComputeKamNRR(st.email, null);
      window._ncsLastNrrResult = nr;
      window._ncsKamLabel = (st.kamName || st.email || '').split('@')[0];
    }
  } catch(e) { console.warn('[cds-nrr]', e); }

  var nrrPayout = Number(src.nrr || 0);
  var pctText   = st.pct !== null && st.pct !== undefined ? (st.pct + '%') : '—';

  // ── Commission context card (uses .cds-nrr-ctx CSS) ──────────────────
  var isTopTier = !st.next && nrrPayout > 0;
  var nextNote = st.next
    ? 'ต้องอีก +' + (Number(st.next.min_value) - Number(st.pct || 0)).toFixed(1) + ' pts → tier ถัดไป'
    : (nrrPayout > 0 ? '' : 'ยังไม่ถึง tier แรก');

  var ctxHtml = '<div class="cds-nrr-ctx' + (nrrPayout > 0 ? '' : ' no-tier') + '">'
    + '<div class="cds-nrr-ctx-top">'
    + '<div><div class="cds-nrr-ctx-eyebrow">NRR Commission</div>'
    + '<div class="cds-nrr-ctx-pct">' + esc(pctText) + '</div>'
    + '<div class="cds-nrr-ctx-tier">' + esc(st.tierLabel || st.ruleName || '—') + '</div>'
    + '</div>'
    + '<div class="cds-nrr-ctx-payout">'
    + '<div class="cds-nrr-ctx-payout-lbl">Payout</div>'
    + '<div class="cds-nrr-ctx-payout-val">' + fmtFull(nrrPayout) + '</div>'
    + (isTopTier
        ? '<div class="cds-nrr-ctx-next-inline">โบนัสสูงสุด ✓</div>'
        : (nextNote ? '<div class="cds-nrr-ctx-next-inline">' + esc(nextNote) + '</div>' : ''))
    + '</div></div>'
    + '</div>';

  // ── Run-rate helper (days-elapsed projection) ─────────────────────────
  var daysInCurrMonth = nr && nr.daysInMonth ? nr.daysInMonth : 30;
  function rr(v){ return (nr && nr.daysElapsed > 0) ? Math.round(v / nr.daysElapsed * daysInCurrMonth) : v; }

  // ── Outlet rows (reuse ncs-chip + ncs-outlet-row classes) ────────────
  var cohortData = nr.cohortDetail || [];
  var rowsHtml = cohortData.map(function(g, gi) {
    var autoOpen = gi < 3;
    var chipRR   = fmt(rr(g.currTotal || 0));
    var outletRows = (g.outlets || []).map(function(o) {
      var rrVal = rr(o.currGmv || 0);
      var rrCls = rrVal >= (o.prevGmv || 0) ? 'ncs-gmv rr-up' : 'ncs-gmv rr-dn';
      return '<div class="ncs-outlet-row nrr-cols">'
        + '<div class="ncs-outlet-name">' + esc((o.outletName || o.outletId || '—').slice(0, 38)) + '</div>'
        + '<div class="ncs-gmv base">' + (o.prevGmv > 0 ? fmt(o.prevGmv) : '—') + '</div>'
        + '<div class="' + rrCls + '">'  + fmt(rrVal) + '</div>'
        + '<div class="ncs-gmv mtd">'    + fmt(o.currGmv || 0) + '</div>'
        + '</div>';
    }).join('');
    var prevAcct = (g.outlets||[]).reduce(function(s,o){return s+(o.prevGmv||0);},0);
    var rrAcct = rr(g.currTotal||0);
    var mtdAcct = g.currTotal||0;
    return '<div class="ncs-chip nrr-cols' + (autoOpen ? ' open' : '') + '" data-ncs-chip="1" style="position:relative">'      + '<span class="ncs-chip-chev" style="position:absolute;left:14px;top:50%;transform:translateY(-50%)">&#8250;</span>'      + '<div class="ncs-outlet-name" style="font-size:11px;font-weight:700;color:rgba(255,255,255,.82);padding-left:16px">' + esc(g.acctName || '—') + '</div>'      + '<div class="ncs-gmv base" style="font-size:11px">' + (prevAcct > 0 ? fmt(prevAcct) : '—') + '</div>'      + '<div class="' + (rrAcct >= prevAcct ? 'ncs-gmv rr-up' : 'ncs-gmv rr-dn') + '" style="font-size:11px">' + fmt(rrAcct) + '</div>'      + '<div class="ncs-gmv mtd" style="font-size:11px">' + fmt(mtdAcct) + '</div>'      + '</div>'
      + '<div class="ncs-outlet-rows' + (autoOpen ? ' open' : '') + '">' + outletRows + '</div>';
  }).join('');

  // ── Meta bar + score card above table header ────────────────────────────
  var nrrAcctCount = nr ? (nr.cohortDetail||[]).length : 0;
  var baseMonthLabel = nr && nr.baselineMonth ? nr.baselineMonth : '';
  var metaBarText = nrrAcctCount + ' account · ' + fmt(nr?(nr.cohortGmv||0):0) + ' MTD'
    + (baseMonthLabel ? ' · ฐาน ' + esc(baseMonthLabel) : '');
  if (meta) meta.innerHTML = '<div class="cds-meta">'
    + '<span class="cds-meta-text">' + metaBarText + '</span>'
    + '<button class="cds-toggle-btn" id="cds-toggle-btn" title="ขยาย/ย่อ"><svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg></button>'
    + '</div>';
  if (meta) meta.innerHTML = ctxHtml + meta.innerHTML;
  body.innerHTML = rowsHtml;

  // Chip toggle via event delegation — use named fn to prevent listener stacking on tab re-entry
  if (body._nrrChipHandler) body.removeEventListener('click', body._nrrChipHandler);
  body._nrrChipHandler = function(e) {
    var chip = e.target.closest('[data-ncs-chip]');
    if (!chip) return;
    chip.classList.toggle('open');
    var rows = chip.nextElementSibling;
    if (rows && rows.classList.contains('ncs-outlet-rows')) rows.classList.toggle('open');
    // keep toggle-btn label in sync
    var btn = document.getElementById('cds-toggle-btn');
    if (btn) {
      var anyOpen = body.querySelectorAll('.ncs-outlet-rows.open').length > 0;
      btn.innerHTML = anyOpen ? '<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"1\" y1=\"3.5\" x2=\"13\" y2=\"3.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"7\" x2=\"13\" y2=\"7\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"10.5\" x2=\"13\" y2=\"10.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>' : '<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg>';
    }
  };
  body.addEventListener('click', body._nrrChipHandler);

  // Toggle-all for NRR tab (ncs- classes, not cds- classes)
  var nrrToggleBtn = document.getElementById('cds-toggle-btn');
  if (nrrToggleBtn) {
    nrrToggleBtn.onclick = function() {
      var chips   = Array.from(body.querySelectorAll('[data-ncs-chip]'));
      var outlets = Array.from(body.querySelectorAll('.ncs-outlet-rows'));
      var anyOpen = outlets.some(function(r) { return r.classList.contains('open'); });
      chips.forEach(function(c)   { c.classList.toggle('open', !anyOpen); });
      outlets.forEach(function(r) { r.classList.toggle('open', !anyOpen); });
      nrrToggleBtn.innerHTML = anyOpen ? '<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"1\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"1\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/><rect x=\"8\" y=\"8\" width=\"5\" height=\"5\" rx=\"1\" fill=\"currentColor\"/></svg>' : '<svg width=\"12\" height=\"12\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"1\" y1=\"3.5\" x2=\"13\" y2=\"3.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"7\" x2=\"13\" y2=\"7\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><line x1=\"1\" y1=\"10.5\" x2=\"13\" y2=\"10.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>';
    };
  }

  // ── Total bar ─────────────────────────────────────────────────────────
  // v753c: NRR total bar — 3 columns aligned with header (base / run rate / MTD)
  if (totalEl) {
    var _nrrBase = nr.baselinePrevGmv || 0;
    var _nrrMtd  = nr.cohortGmv || 0;
    var _nrrDays = nr.daysElapsed || 1;
    var _nrrDim  = nr.daysInMonth || 30;
    var _nrrRr   = Math.round(_nrrMtd / _nrrDays * _nrrDim);
    totalEl.innerHTML = '<div class="cds-total nrr-cols">'
      + '<span class="cds-total-label">รวม NRR GMV</span>'
      + '<span class="cds-total-val v-dim" title="Base (เดือนก่อน)">' + fmtFull(_nrrBase) + '</span>'
      + '<span class="cds-total-val v-green" title="Run Rate (normalize)">' + fmtFull(_nrrRr) + '</span>'
      + '<span class="cds-total-val" style="color:rgba(26,232,123,.55)" title="MTD">' + fmtFull(_nrrMtd) + '</span>'
      + '</div>';
  }
};


//////////////////////////////////////////////////////////////////////////////

// ── [v211] Commission snapshot hardening + admin guards ─────────────
// PATCH: freshket-v211-commission-snapshot-hardening-js
//////////////////////////////////////////////////////////////////////////////

(function(){
  var VERSION='v211a';
  function toast(msg,type){ try{ if(typeof showToast==='function') showToast(msg,type||'!'); }catch(e){} }
  function role(){ try{ return typeof getCurrentRole==='function' ? getCurrentRole() : String((currentUserProfile&&currentUserProfile.role)||'').toLowerCase(); }catch(e){ return ''; } }
  function isAdmin(){ try{ return typeof isAdminRole==='function' ? isAdminRole(role()) : role()==='admin'; }catch(e){ return false; } }
  function isTL(){ try{ return typeof isTLRole==='function' ? isTLRole(role()) : role()==='tl'; }catch(e){ return false; } }
  function isRep(){ try{ return typeof isRepRole==='function' ? isRepRole(role()) : role()==='rep'; }catch(e){ return role()==='rep' || role()==='kam'; } }
  function period(){ try{ return typeof _nrrExclusionCurrentPeriod==='function' ? _nrrExclusionCurrentPeriod() : (new Date()).toISOString().slice(0,7); }catch(e){ return (new Date()).toISOString().slice(0,7); } }
  function money(n){ try{ return _commFmtPayout(n); }catch(e){ n=Number(n||0); return n?'฿'+Math.round(n).toLocaleString('en-US'):'฿0'; } }
  function esc(v){ try{ return typeof _commEscapeHtml==='function' ? _commEscapeHtml(v) : String(v ?? '').replace(/[&<>'"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];}); }catch(e){ return String(v ?? ''); } }
  function asObj(v){ if(!v) return {}; if(typeof v==='object') return v; try{return JSON.parse(v);}catch(e){return {};} }
  function low(v){ return String(v||'').trim().toLowerCase(); }
  function benRole(v){ var r=low(v); return r==='rep'?'kam':r; }
  function isKamBen(r){ return benRole(r)==='kam'; }
  function isTlBen(r){ return benRole(r)==='tl'; }
  function normalizeSnapshotRow(r, opts){
    opts=opts||{};
    if(!r) return null;
    var per=r.period_month || opts.period || period();
    var br=benRole(r.beneficiary_role);
    var be=low(r.beneficiary_email);
    var tl=low(r.team_lead_email);
    if(!per || !br || !be) return null;
    return Object.assign({}, r, {
      period_month: per,
      beneficiary_role: br,
      beneficiary_email: be,
      team_lead_email: tl || null,
      raw_nrr_pct: r.raw_nrr_pct==null?null:Number(r.raw_nrr_pct),
      governed_nrr_pct: r.governed_nrr_pct==null?null:Number(r.governed_nrr_pct),
      payout_amount: Number(r.payout_amount||0),
      snapshot_status: opts.status || r.snapshot_status || 'live',
      breakdown: asObj(r.breakdown)
    });
  }
  function normalizeRows(rows, opts){ return (rows||[]).map(function(r){return normalizeSnapshotRow(r,opts);}).filter(Boolean); }
  function rowsFinalForPeriod(p){
    var per=p||period();
    var rows=(typeof _commissionSnapshots!=='undefined' && Array.isArray(_commissionSnapshots)) ? _commissionSnapshots : [];
    return normalizeRows(rows,{period:per}).filter(function(r){ return r.period_month===per && String(r.snapshot_status||'').toLowerCase()==='final'; });
  }
  function isLocked(p){ return rowsFinalForPeriod(p).length>0; }
  function liveRows(){
    try{
      var rows=(typeof _commBuildSnapshotRowsLive==='function' ? _commBuildSnapshotRowsLive() : []);
      return normalizeRows(rows,{period:period(),status:'live'});
    }catch(e){ console.warn('[v211a] live rows failed', e); return []; }
  }
  if(typeof window._commBuildSnapshotRowsLive!=='function'){
    try{ window._commBuildSnapshotRowsLive = window._commBuildSnapshotRows || _commBuildSnapshotRows; }catch(e){}
  }
  function rowsForDisplay(opts){
    opts=opts||{};
    var per=opts.period||period();
    var finalRows=rowsFinalForPeriod(per);
    if(opts.forceLive) return liveRows();
    if(opts.preferLocked!==false && finalRows.length) return finalRows;
    return liveRows();
  }
  function scopeRows(rows, scope){
    var email=low((currentUserProfile&&currentUserProfile.email)||'');
    var scoped=rows||[];
    if(scope==='kam' || isRep()) scoped=scoped.filter(function(x){return isKamBen(x.beneficiary_role) && low(x.beneficiary_email)===email;});
    else if(scope==='tl' || isTL()) scoped=scoped.filter(function(x){return low(x.team_lead_email)===email || low(x.beneficiary_email)===email;});
    return scoped;
  }
  function summaryFromRows(rows, scope){
    var normalized=normalizeRows(rows,{period:period()});
    var scoped=scopeRows(normalized, scope);
    var tlRows=scoped.filter(function(r){return isTlBen(r.beneficiary_role);});
    var kamRows=scoped.filter(function(r){return isKamBen(r.beneficiary_role);});
    var sum=function(arr){return arr.reduce(function(s,r){return s+Number(r.payout_amount||0);},0);};
    var lockedSource=scoped.some(function(r){return String(r.snapshot_status||'').toLowerCase()==='final';});
    return { rows:scoped, tlRows:tlRows, kamRows:kamRows, tlPayout:sum(tlRows), kamPayout:sum(kamRows), total:sum(scoped), hitKams:kamRows.filter(function(r){return Number(r.payout_amount||0)>0;}).length, kamCount:kamRows.length, teamCount:Array.from(new Set(scoped.map(function(r){return r.team_lead_email;}).filter(Boolean))).length, sourceLocked:lockedSource };
  }
  window._commIsPeriodLocked=isLocked;
  window._commGetCommissionRowsForDisplay=rowsForDisplay;
  window._commSummaryFromRows=summaryFromRows;
  window._commNormalizeSnapshotRowsForQA=normalizeRows;

  var oldSummary=null;
  try{ oldSummary=window._commBuildPayoutSummary || _commBuildPayoutSummary; }catch(e){}
  window._commBuildPayoutSummary=function(scope, opts){
    try{ return summaryFromRows(rowsForDisplay(opts||{}), scope); }
    catch(e){ console.warn('[v211a] display summary failed, fallback live', e); return oldSummary ? oldSummary(scope) : summaryFromRows(liveRows(), scope); }
  };
  try{ _commBuildPayoutSummary=window._commBuildPayoutSummary; }catch(e){}

  function guardAdmin(action){
    if(isAdmin()) return true;
    toast((action||'Action')+' ทำได้เฉพาะ Admin','!');
    return false;
  }
  function wrapAdmin(fnName, label){
    var old=window[fnName];
    if(typeof old!=='function') return;
    if(old.__commAdminGuarded) return;
    var wrapped=function(){ if(!guardAdmin(label||fnName)) return; return old.apply(this, arguments); };
    wrapped.__commAdminGuarded=true;
    window[fnName]=wrapped;
    try{ eval(fnName+'=window[fnName]'); }catch(e){}
  }
  ['saveCommissionCockpit','saveCommissionRules','saveCommissionAssignments','saveCommissionPoliciesFromCockpit','archiveCommissionRule'].forEach(function(n){ wrapAdmin(n, 'Commission governance'); });
  var oldSetAssignment=window._commSetAssignment;
  if(typeof oldSetAssignment==='function' && !oldSetAssignment.__commAdminGuarded){
    window._commSetAssignment=function(){ if(!guardAdmin('Assign rule')) return; return oldSetAssignment.apply(this,arguments); };
    window._commSetAssignment.__commAdminGuarded=true;
    try{ _commSetAssignment=window._commSetAssignment; }catch(e){}
  }
  var oldPolicyChange=window.onNrrPolicyChange;
  if(typeof oldPolicyChange==='function' && !oldPolicyChange.__commAdminGuarded){
    window.onNrrPolicyChange=function(){ if(!guardAdmin('Policy edit')) return; return oldPolicyChange.apply(this,arguments); };
    window.onNrrPolicyChange.__commAdminGuarded=true;
    try{ onNrrPolicyChange=window.onNrrPolicyChange; }catch(e){}
  }

  function teamGroupsFromRows(rows){
    var by={};
    normalizeRows(rows,{period:period()}).forEach(function(r){
      var bd=asObj(r.breakdown);
      var tl=r.team_lead_email || r.beneficiary_email || 'unknown';
      if(!by[tl]) by[tl]={tlEmail:tl, tlName:bd.team_lead_name||tl, teamNrr:null, tlPayout:0, tlPlanName:'', kamRows:[], total:0};
      if(isTlBen(r.beneficiary_role)){
        by[tl].tlName=bd.team_lead_name||by[tl].tlName;
        by[tl].teamNrr=r.governed_nrr_pct;
        by[tl].tlPayout=Number(r.payout_amount||0);
        by[tl].tlPlanName=bd.rule_name || bd.payout_source || '';
      } else if(isKamBen(r.beneficiary_role)){
        by[tl].kamRows.push({
          kamEmail:r.beneficiary_email,
          kamName:bd.kam_name||r.beneficiary_email,
          pct:r.governed_nrr_pct,
          payout:Number(r.payout_amount||0),
          planName:bd.rule_name||bd.payout_source||'',
          tierLabel:bd.tier_label||''
        });
      }
    });
    Object.values(by).forEach(function(t){ t.kamRows.sort(function(a,b){return (b.payout-a.payout)||String(a.kamName).localeCompare(String(b.kamName));}); t.kamTotal=t.kamRows.reduce(function(s,k){return s+Number(k.payout||0);},0); t.total=t.tlPayout+t.kamTotal; });
    return Object.values(by).sort(function(a,b){return (b.total-a.total)||String(a.tlName).localeCompare(String(b.tlName));});
  }
  function roleLabelForRow(r){ var br=benRole(r); return br==='kam'?'KAM':String(br||'').toUpperCase(); }
  function renderRowsList(rows){
    return normalizeRows(rows,{period:period()}).slice(0,14).map(function(r){
      var bd=asObj(r.breakdown);
      var name=bd.kam_name||bd.team_lead_name||r.beneficiary_email;
      var rule=bd.rule_name||bd.payout_source||'';
      return '<div class="comm-lock-row"><div class="comm-role-dot '+esc(benRole(r.beneficiary_role))+'">'+esc(roleLabelForRow(r.beneficiary_role))+'</div><div><div class="comm-person-name">'+esc(name)+'</div><div class="comm-person-sub">'+esc(rule)+' · Raw '+(r.raw_nrr_pct??'—')+'% → NRR ที่ใช้คิด '+(r.governed_nrr_pct??'—')+'%</div></div><div class="comm-row-money '+(Number(r.payout_amount||0)>0?'hit':'')+' '+(isLocked()?'locked':'')+'">'+money(r.payout_amount)+'</div></div>';
    }).join('');
  }
  window.renderCommLockStep=function(body){
    var per=period();
    var locked=isLocked(per);
    var rows=rowsForDisplay({period:per, preferLocked:true});
    var summary=summaryFromRows(rows);
    var teams=teamGroupsFromRows(rows);
    var pending=(typeof _nrrExclusions!=='undefined'?(_nrrExclusions||[]):[]).filter(function(r){return r.status==='submitted'||r.status==='pending';}).length;
    var ready=rows.length>0 && pending===0;
    var sourceCopy=locked ? 'ล็อกแล้ว: ใช้ frozen snapshot สำหรับ preview / scorecard / CSV' : 'Live preview: ยังไม่ lock snapshot ตัวเลขจะตาม rule และ assignment ล่าสุด';
    body.innerHTML='<div class="comm-hero">'
      +'<div class="comm-hero-top"><div><div class="comm-hero-title">5. Preview & Lock</div><div class="comm-hero-sub">ตรวจภาพรวมก่อน lock snapshot และ export CSV</div></div><div class="comm-total"><div class="comm-total-lbl">Exposure</div><div class="comm-total-val">'+money(summary.total)+'</div></div></div>'
      +'<div class="comm-lock-state-row"><div><div class="comm-lock-state-main">'+esc(sourceCopy)+'</div><div class="comm-lock-state-sub">'+(locked?'การแก้ rule/assignment หลังจากนี้จะไม่เปลี่ยน snapshot ที่ lock ไว้ จนกว่า Admin จะ re-lock':'เมื่อ lock แล้ว snapshot จะ freeze แยกจาก rule/assignment ปัจจุบัน')+'</div></div><span class="comm-lock-pill '+(locked?'locked':'live')+'"><span class="dot"></span>'+(locked?'LOCKED':'LIVE')+'</span></div>'
      +'<div class="comm-kpis"><div class="comm-kpi '+(summary.teamCount?'hit':'miss')+'"><div class="comm-kpi-lbl">Teams</div><div class="comm-kpi-val">'+summary.teamCount+'</div><div class="comm-kpi-sub">TL groups in '+(locked?'snapshot':'preview')+'</div></div><div class="comm-kpi '+(summary.tlPayout>0?'hit payout-hit':'miss')+'"><div class="comm-kpi-lbl">TL payout</div><div class="comm-kpi-val">'+money(summary.tlPayout)+'</div><div class="comm-kpi-sub">'+summary.tlRows.length+' TL rows</div></div><div class="comm-kpi '+(summary.kamPayout>0?'hit payout-hit':'miss')+'"><div class="comm-kpi-lbl">KAM payout</div><div class="comm-kpi-val">'+money(summary.kamPayout)+'</div><div class="comm-kpi-sub">'+summary.hitKams+'/'+summary.kamCount+' KAM hit payout</div></div></div>'
      +'<div class="comm-readiness-bar '+(ready?'ready':'warn')+'"><span class="comm-readiness-dot"></span><div class="comm-readiness-copy">'+(ready?(locked?'Snapshot locked แล้ว · export จะใช้ frozen rows ชุดนี้':'พร้อม lock: ไม่มี pending exception และมี snapshot rows แล้ว'):(pending?'ยังมี exclusion pending '+pending+' รายการ ถ้า lock ตอนนี้จะไม่ถูกนับ':'ยังไม่มีข้อมูล payout ให้ lock'))+'</div></div>'
      +'<div class="tgt-lock-actions"><button class="tgt-lock-btn secondary" onclick="exportCommissionSnapshotCsv()">Export CSV</button><button class="tgt-lock-btn primary" onclick="lockCommissionSnapshot()">'+(locked?'Re-lock / revise snapshot':'Lock snapshot')+'</button></div>'
      +(locked?'<div class="comm-lock-actions-note">ถ้าต้อง revise ให้กด Re-lock หลังตรวจ live data แล้วเท่านั้น</div>':'')
      +'</div>'
      +'<div class="comm-section-title comm-preview-section-title"><span>By Team Lead</span><em>'+(locked?'Locked rows':'Live rows')+' grouped by team</em></div>'
      +(teams.length?teams.map(function(t){return '<div class="comm-card comm-team-card comm-preview-team-card"><div class="comm-preview-tl-band"><div class="comm-preview-tl-left"><div class="comm-team-eyebrow">TEAM LEAD</div><div class="comm-name">'+esc(t.tlName||t.tlEmail)+'</div><div class="comm-meta">'+esc(t.tlEmail||'')+' · Team NRR '+(t.teamNrr!=null?t.teamNrr+'%':'—')+'</div><div class="comm-rule-chip">TL rule · '+esc(t.tlPlanName||'-')+'</div></div><div class="comm-preview-tl-money"><span>Total payout</span><strong>'+money(t.total)+'</strong><em>TL '+money(t.tlPayout)+'</em></div></div><div class="comm-kam-subhead"><span>KAM payout in this team</span><em>'+t.kamRows.filter(function(k){return k.payout>0;}).length+'/'+t.kamRows.length+' hit payout</em></div>'+t.kamRows.slice(0,5).map(function(k){return '<div class="comm-person-row comm-kam-payout-row '+(k.payout>0?'hit':'')+'"><div><div class="comm-person-name">'+esc(k.kamName||k.kamEmail)+'</div><div class="comm-person-sub">NRR '+(k.pct!=null?k.pct+'%':'—')+' · Rule: '+esc(k.planName||'-')+'</div></div><div class="comm-person-payout '+(k.payout>0?'comm-row-money hit':'comm-row-money')+'">'+money(k.payout)+'</div></div>';}).join('')+(t.kamRows.length>5?'<div class="comm-meta comm-more-note">+'+(t.kamRows.length-5)+' more KAM in CSV/export</div>':'')+'</div>';}).join(''):'<div class="comm-empty">ยังไม่มีทีมให้ preview</div>')
      +'<div class="comm-section-title">Snapshot rows</div><div class="comm-lock-list">'+(rows.length?renderRowsList(rows):'<div class="comm-empty">ยังไม่มีข้อมูลสำหรับ snapshot</div>')+'</div>';
  };
  try{ renderCommLockStep=window.renderCommLockStep; }catch(e){}

  window.exportCommissionSnapshotCsv=function(){
    if(!guardAdmin('Export commission snapshot')) return;
    var rows=rowsForDisplay({preferLocked:true});
    if(!rows.length){ toast('ยังไม่มีข้อมูล snapshot ให้ export','!'); return; }
    try{
      var csv=(typeof _commSnapshotCsv==='function') ? _commSnapshotCsv(rows) : JSON.stringify(rows,null,2);
      var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); var url=URL.createObjectURL(blob); var a=document.createElement('a');
      a.href=url; a.download='freshket_commission_'+(isLocked()?'locked':'preview')+'_'+period()+'.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }catch(e){ console.error('[v211a] export failed', e); toast('Export ไม่สำเร็จ: '+(e.message||''),'!'); }
  };
  try{ exportCommissionSnapshotCsv=window.exportCommissionSnapshotCsv; }catch(e){}

  window.lockCommissionSnapshot=async function(){
    if(!guardAdmin('Lock commission snapshot')) return;
    var per=period(); var locked=isLocked(per);
    if(locked && !confirm('เดือนนี้มี locked snapshot อยู่แล้ว ต้องการ re-lock เพื่อ revise ตัวเลขหรือไม่?')) return;
    var rows=liveRows();
    if(!rows.length){ toast('ไม่มีข้อมูลสำหรับ lock','!'); return; }
    var invalid=rows.filter(function(r){ return !r.period_month || !r.beneficiary_role || !r.beneficiary_email; });
    if(invalid.length){ toast('Lock ไม่สำเร็จ: snapshot rows ไม่ครบ '+invalid.length+' แถว','!'); console.warn('[v211a] invalid snapshot rows', invalid); return; }
    var pending=(typeof _nrrExclusions!=='undefined'?(_nrrExclusions||[]):[]).filter(function(r){return r.status==='submitted'||r.status==='pending';}).length;
    if(pending>0 && !confirm('ยังมี exclusion pending '+pending+' รายการ ต้องการ lock ต่อเลยหรือไม่?')) return;
    var actor=(currentUserProfile&&currentUserProfile.email)||'';
    try{
      var lockedAt=new Date().toISOString();
      var payload=rows.map(function(r){
        var bd=Object.assign({}, asObj(r.breakdown), { locked_source:'v211a_live_rows', locked_rule_name:asObj(r.breakdown).rule_name||'' });
        return Object.assign({}, r, { period_month:per, beneficiary_role:benRole(r.beneficiary_role), beneficiary_email:low(r.beneficiary_email), team_lead_email:low(r.team_lead_email)||null, payout_amount:Number(r.payout_amount||0), snapshot_status:'final', breakdown:bd, updated_at:lockedAt, updated_by:actor, created_by:r.created_by||actor, locked_at:lockedAt, locked_by:actor });
      });
      var res=await supa.from('commission_payout_snapshots').upsert(payload,{onConflict:'period_month,beneficiary_role,beneficiary_email'}).select('*');
      if(res.error) throw new Error(res.error.message);
      _commissionSnapshots=res.data||payload;
      if(typeof _tgtActiveQuarter!=='undefined' && _tgtActiveQuarter && typeof _tgtQuarterCache!=='undefined') delete _tgtQuarterCache[_tgtActiveQuarter];
      toast(locked?'Re-lock snapshot สำเร็จ':'Lock commission snapshot สำเร็จ','ok');
      try{ renderCommissionCockpit(); }catch(e){ try{ renderCommLockStep(document.getElementById('commission-cockpit-body')); }catch(_e){} }
      try{ renderTeamviewSummary(); renderTeamviewKamList(); }catch(e){}
      try{ if(typeof _commRenderKamSelfStrip==='function') _commRenderKamSelfStrip(); }catch(e){}
    }catch(e){ console.error('[v211a] lock failed', e); toast('Lock ไม่สำเร็จ: '+(e.message||''),'!'); }
  };
  try{ lockCommissionSnapshot=window.lockCommissionSnapshot; }catch(e){}

  var oldKamState=null;
  try{ oldKamState=window._commBuildKamSelfState || _commBuildKamSelfState; }catch(e){}
  if(typeof oldKamState==='function'){
    window._commBuildKamSelfState=function(){
      var st=oldKamState.apply(this,arguments); if(!st) return st;
      var email=low((currentUserProfile&&currentUserProfile.email)||'');
      var finalRow=rowsFinalForPeriod(st.period||period()).find(function(r){return isKamBen(r.beneficiary_role) && low(r.beneficiary_email)===email;});
      if(finalRow){
        var bd=asObj(finalRow.breakdown);
        st.locked=true; st.pct=finalRow.governed_nrr_pct; st.payout=Number(finalRow.payout_amount||0); st.ruleName=bd.rule_name||st.ruleName; st.status=st.payout>0?(st.status||'ถึงเกณฑ์แล้ว'):'ยังไม่ถึงเกณฑ์'; st.cls=st.payout>0?'bonus':'miss'; st.sourceBreakdown={nrr:st.payout,uplift:0,handover:0};
      }
      return st;
    };
    try{ _commBuildKamSelfState=window._commBuildKamSelfState; }catch(e){}
  }
  // Add a locked class to compact KAM strip after each render without touching v210k internals.
  var oldRenderStrip=window._commRenderKamSelfStrip;
  if(typeof oldRenderStrip==='function'){
    window._commRenderKamSelfStrip=function(){ var r=oldRenderStrip.apply(this,arguments); try{ var el=document.querySelector('.pv-comm-strip.v210k'); if(el && isLocked()) el.classList.add('locked'); }catch(e){} return r; };
    try{ _commRenderKamSelfStrip=window._commRenderKamSelfStrip; }catch(e){}
  }
  // boot log removed
})();


//////////////////////////////////////////////////////////////////////////////

// ── Commission Rulebook — v247d ──────────────────────────────────────────────
// Opens a standalone bottom sheet explaining all commission rules in plain language.
// Entry points: KAM compact sheet · TL commission sheet · Admin cockpit footer
// All numeric values read live from _commGetConfig() to stay in sync with admin config.

function openCommissionRulebook() {
  var ov = document.getElementById('comm-rulebook-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'comm-rulebook-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9100;background:rgba(5,14,28,.0);transition:background .28s;pointer-events:none';
    ov.onclick = function(e){ if(e.target===ov) closeCommissionRulebook(); };
    document.body.appendChild(ov);
  }

  function cfg(k,p,d){ try{ return typeof _commGetConfig==='function'?_commGetConfig(k,p,d):d; }catch(e){ return d; } }

  // v558 CONFIG-READY GATE: never present fallback defaults as truth.
  // _tgtLoaded flips true when loadTargets() completes (cache-hit or fresh path).
  // Until then the badge reads SYNCING, an amber strip warns in Thai, and we
  // re-render this sheet automatically the moment real settings arrive.
  var _cfgReady = (typeof _tgtLoaded !== 'undefined') ? !!_tgtLoaded : true;
  if (!_cfgReady && !window._rbCfgPoll) {
    var _rbTries = 0;
    window._rbCfgPoll = setInterval(function(){
      _rbTries++;
      var ready = (typeof _tgtLoaded !== 'undefined') ? !!_tgtLoaded : true;
      if (ready || _rbTries > 40) {
        clearInterval(window._rbCfgPoll); window._rbCfgPoll = null;
        if (ready && document.getElementById('comm-rulebook-overlay')) openCommissionRulebook();
      }
    }, 500);
  }
  var _syncStrip = '<div style="margin:2px 0 14px;padding:9px 12px;border-radius:10px;background:rgba(255,180,84,.08);border:1px solid rgba(255,180,84,.25);font-size:11px;color:#ffb454;font-family:\'Noto Sans Thai\',sans-serif;line-height:1.5">กำลังซิงค์ค่าจริงจากระบบ — ตัวเลขจะอัปเดตอัตโนมัติในไม่กี่วินาที</div>';
  function fmtB(n){ var v=Math.round(Number(n||0)); return '฿'+v.toLocaleString('en-US'); }
  function fmtPctRaw(n){ return Number(n||0)+'%'; }

  // Live config params
  var p1Rate    = Math.round(cfg('upsell_sku','p1_rate',0.03)*100);
  var p3Rate    = Math.round(cfg('upsell_sku','p3_rate',0.03)*100);
  var p3Thresh  = cfg('upsell_sku','p3_threshold_pct',2.00);
  var p3GrowPct = Math.round((p3Thresh-1)*100); // v558: unified phrasing — multiplier AND growth-%
  var p1MinGmv  = fmtB(cfg('upsell_sku','p1_min_gmv',5000));
  var p3MinIncr = fmtB(cfg('upsell_sku','p3_min_incremental',5000)); // v558: default aligned to engine (was 8000)
  var outRate   = Math.round(cfg('upsell_outlet','rate',0.015)*1000)/10;
  var hoT2Pct   = cfg('handover','tier2_pct',100);
  var hoT3Pct   = cfg('handover','tier3_pct',120);
  var hoT2Pay   = fmtB(cfg('handover','tier2_payout',2500));
  var hoT3Total = fmtB(cfg('handover','tier2_payout',2500)+cfg('handover','tier3_bonus',2500));
  var gT1       = cfg('gmv_gate','threshold_1',95);
  var gT2       = cfg('gmv_gate','threshold_2',90);
  var gC1       = Math.round(cfg('gmv_gate','cap_1',0.70)*100);
  var gC2       = Math.round(cfg('gmv_gate','cap_2',0.35)*100);

  // Get current user's plan tiers
  var role = typeof getCurrentRole==='function' ? getCurrentRole() : '';
  var email = (currentUserProfile && currentUserProfile.email) || '';
  var period = typeof _nrrExclusionCurrentPeriod==='function' ? _nrrExclusionCurrentPeriod() : '';
  var isRep = typeof isRepRole==='function' ? isRepRole(role) : false;
  var isTL  = typeof isTLRole==='function'  ? isTLRole(role)  : false;

  function getMyTiers(myRole, myEmail) {
    try {
      var planCode = typeof _commGetAssignmentPlan==='function'
        ? _commGetAssignmentPlan(period, myRole, myEmail, myRole)
        : (myRole==='tl'?'TL_NRR_STD':'KAM_NRR_STD');
      var draft = typeof _commGetDraftByCode==='function' ? _commGetDraftByCode(planCode, myRole) : null;
      return (draft && draft.tiers && draft.tiers.length) ? draft.tiers : [];
    } catch(e) { return []; }
  }

  function getPlanName(myRole, myEmail) {
    try {
      var planCode = typeof _commGetAssignmentPlan==='function'
        ? _commGetAssignmentPlan(period, myRole, myEmail, myRole)
        : (myRole==='tl'?'TL_NRR_STD':'KAM_NRR_STD');
      var plans = (_commRuleConfig && _commRuleConfig.plans) || {};
      return (plans[planCode] && plans[planCode].plan_name) || planCode || '';
    } catch(e) { return ''; }
  }

  function getTlUpsellTiers() {
    try {
      var rules = _commRuleConfig && _commRuleConfig.rules && _commRuleConfig.rules['tl_upsell_mult'];
      var tiers = (rules && rules[0] && rules[0].tiers) ? rules[0].tiers : [];
      if (!tiers.length) tiers = [
        {min_pct:0,max_pct:1.99,multiplier:1.00},{min_pct:2,max_pct:2.99,multiplier:1.20},
        {min_pct:3,max_pct:3.99,multiplier:1.35},{min_pct:4,max_pct:4.99,multiplier:1.50},
        {min_pct:5,max_pct:null,multiplier:1.80}
      ];
      return tiers;
    } catch(e) { return []; }
  }

  // Get current NRR% for "← ตอนนี้" indicator
  function getMyNrrPct() {
    try {
      if (isRep && typeof _commBuildKamPayout==='function') {
        var r = _commBuildKamPayout(email); return r ? r.nrr_pct : null;
      }
      if (isTL && typeof _commBuildTlPayout==='function') {
        var r = _commBuildTlPayout(email); return r ? r.nrr_pct : null;
      }
    } catch(e) {}
    return null;
  }

  var myNrrPct = getMyNrrPct();

  // Render NRR tier table from live plan
  function renderNrrTierTable(tiers, currentPct, color) {
    if (!tiers || !tiers.length) return '<div style="font-size:11px;color:rgba(188,215,255,.40);padding:8px 0">ไม่มีข้อมูล tier</div>';
    var html = '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:4px">';
    tiers.forEach(function(t) {
      var minV = t.min_value != null ? Number(t.min_value) : null;
      var maxV = t.max_value != null ? Number(t.max_value) : null;
      var pay  = Number(t.payout_value || 0);
      var label = minV != null && maxV != null ? ('NRR '+minV+'%–'+maxV+'%')
                : minV != null ? ('NRR ≥ '+minV+'%')
                : maxV != null ? ('NRR < '+maxV+'%') : 'ทุกช่วง';
      var isCurr = currentPct != null
        && (minV == null || currentPct >= minV)
        && (maxV == null || currentPct < maxV);
      var border = isCurr ? 'border:1.5px solid rgba(255,224,138,.35);' : 'border:1px solid rgba(188,215,255,.10);';
      var bg     = isCurr ? 'background:rgba(255,224,138,.07);' : 'background:rgba(188,215,255,.03);';
      var lblClr = isCurr ? '#ffe08a' : 'rgba(225,238,255,.72)';
      var payClr = pay > 0 ? (isCurr ? '#ffe08a' : (color||'rgba(225,238,255,.80)')) : 'rgba(225,238,255,.28)';
      var badge  = isCurr ? '<span style="font-size:9px;font-weight:800;color:rgba(255,224,138,.80);background:rgba(255,224,138,.12);border-radius:5px;padding:1px 6px;font-family:\'IBM Plex Mono\',monospace;margin-left:6px">ตอนนี้</span>' : '';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:10px;'+border+bg+'">'
        +'<div style="font-size:12px;font-weight:700;color:'+lblClr+'">'+label+badge+'</div>'
        +'<div style="font-size:14px;font-weight:900;color:'+payClr+';font-family:\'IBM Plex Mono\',monospace">'+(pay?fmtB(pay):'฿0')+'</div>'
        +'</div>';
    });
    html += '</div>';
    return html;
  }

  function renderTlUpsellTierTable(tiers, currentPct) {
    if (!tiers || !tiers.length) return '';
    var html = '';
    tiers.forEach(function(t) {
      var minV = t.min_pct != null ? Number(t.min_pct) : null;
      var maxV = t.max_pct != null ? Number(t.max_pct) : null;
      var mult = Number(t.multiplier || 1.0);
      var label = minV != null && maxV != null ? (minV+'%–'+maxV+'%')
                : minV != null ? ('≥ '+minV+'%') : '< '+maxV+'%';
      var isCurr = currentPct != null
        && (minV == null || currentPct >= minV)
        && (maxV == null || currentPct < maxV);
      var rowBg  = isCurr ? 'background:rgba(192,132,252,.06);' : '';
      var lblClr = isCurr ? '#c084fc' : 'rgba(225,238,255,.70)';
      var mulClr = mult > 1 ? (isCurr ? '#c084fc' : 'rgba(225,238,255,.80)') : 'rgba(225,238,255,.32)';
      var curr   = isCurr ? ' <span style="font-size:9px;color:rgba(192,132,252,.70);font-family:\'IBM Plex Mono\',monospace"> ← ตอนนี้</span>' : '';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(188,215,255,.07);'+rowBg+'">'
        +'<div style="font-size:12px;font-weight:700;color:'+lblClr+'">'+label+curr+'</div>'
        +'<div style="font-size:13px;font-weight:900;color:'+mulClr+';font-family:\'IBM Plex Mono\',monospace">×'+mult.toFixed(2)+'</div>'
        +'</div>';
    });
    return html;
  }

  // Section header
  function secHdr(title, color) {
    return '<div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:'+color+';padding:14px 0 6px;font-family:\'IBM Plex Mono\',monospace">'+title+'</div>';
  }
  // Detail row (key: value)
  function detailRow(k, v) {
    return '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid rgba(188,215,255,.07)">'
      +'<div style="font-size:11px;font-weight:700;color:rgba(188,215,255,.65);min-width:88px;flex-shrink:0;padding-top:1px">'+k+'</div>'
      +'<div style="font-size:12px;color:rgba(225,238,255,.88);line-height:1.55">'+v+'</div>'
      +'</div>';
  }

  // ── Build HTML sections ───────────────────────────────────────
  var html = '';
  var planName = '';

  // KAM or TL: show their own NRR tier first
  if (isRep) {
    var tiers = getMyTiers('kam', email);
    planName  = getPlanName('kam', email);
    html += secHdr('NRR — รักษาฐานลูกค้า'+( planName ? ' ('+planName+')' : ''), 'var(--tk-ok-bright)');
    html += renderNrrTierTable(tiers, myNrrPct, 'var(--tk-ok-bright)');
    html += '<div style="font-size:10px;color:rgba(188,215,255,.40);padding:6px 0 4px;font-family:\'IBM Plex Mono\',monospace">วัด: daily-rate NRR ของ cohort เดือนนี้ vs เดือนก่อน</div>';
  }
  if (isTL) {
    var tiers = getMyTiers('tl', email);
    planName  = getPlanName('tl', email);
    html += secHdr('NRR ทีม'+( planName ? ' — '+planName : ''), '#c084fc');
    html += renderNrrTierTable(tiers, myNrrPct, '#c084fc');
    var tlUpsellTiers = getTlUpsellTiers();
    // get current upsell pct for indicator
    var tlUpsellPct = null;
    try { var tu = _commBuildTlPayout(email); if(tu&&tu.upsell_mult) tlUpsellPct=tu.upsell_mult.team_upsell_pct; } catch(e){}
    html += secHdr('Upsell Multiplier × NRR payout', '#c084fc');
    html += renderTlUpsellTierTable(tlUpsellTiers, tlUpsellPct ? tlUpsellPct*100 : null);
    html += detailRow('สูตร', 'Σ(P1+P3 incr ทุก KAM) ÷ Σ(baseline GMV ทุก KAM) × 100');
    html += detailRow('final', 'NRR payout × multiplier (ไม่มี gate)');
  }
  if (!isRep && !isTL) {
    // Admin: show both KAM std and TL std
    var kamTiers = getMyTiers('kam','');
    var tlTiers  = getMyTiers('tl','');
    html += secHdr('KAM NRR (Standard)', 'var(--tk-ok-bright)');
    html += renderNrrTierTable(kamTiers, null, 'var(--tk-ok-bright)');
    html += secHdr('TL NRR (Standard)', '#c084fc');
    html += renderNrrTierTable(tlTiers, null, '#c084fc');
    var tlUpsellTiers = getTlUpsellTiers();
    html += secHdr('TL Upsell Multiplier', '#c084fc');
    html += renderTlUpsellTierTable(tlUpsellTiers, null);
  }

  // Component rates — all roles see this
  html += secHdr('Upsell', '#ffe08a');
  html += detailRow('สินค้าใหม่ (P1)', p1Rate+'% × GMV · ต่อ outlet × กลุ่มสินค้า · min '+p1MinGmv);
  html += detailRow('ยอดเติบโต (P3)', p3Rate+'% × incremental · ยอดเกิน '+p3Thresh+'× baseline (เพิ่ม >'+p3GrowPct+'%) · incremental ขั้นต่ำ '+p3MinIncr);
  html += detailRow('Expansion', outRate+'% × GMV (outlet ที่ไม่เคยซื้อมาก่อนเลย ตาม first purchase date ทั้งชีวิต)');

  html += secHdr('Handover (Sales → KAM เท่านั้น)', '#bcd7ff');
  html += detailRow('Tier', 'Retention ≥ '+hoT2Pct+'% → '+hoT2Pay+' · ≥ '+hoT3Pct+'% → '+hoT3Total+' รวม · < '+hoT2Pct+'% → ฿0');
  html += detailRow('วัดยังไง', 'Retention = (perf ÷ days) ÷ (baseline ÷ days) × 100 (normalize ทั้งคู่)');

  html += secHdr('NRR Gate (KAM เท่านั้น)', 'rgba(255,107,61,.85)');
  html += detailRow('เกณฑ์', 'NRR ≥ '+gT1+'% → ×1.00 · '+gT2+'–'+gT1+'% → ×'+gC1+'% · < '+gT2+'% → ×'+gC2+'%');
  html += detailRow('cap ที่ไหน', 'ทุกส่วน (NRR + upsell + handover) คูณก่อน lock');

  // How to calculate — methodology
  html += '<div style="margin-top:14px;padding:12px;background:rgba(188,215,255,.05);border-radius:10px;border:1px solid rgba(188,215,255,.10)">';
  html += '<div style="font-size:11px;font-weight:700;color:rgba(188,215,255,.55);margin-bottom:8px">วิธีคำนวณ NRR</div>';
  html += '<div style="font-size:11px;color:rgba(225,238,255,.75);line-height:1.8">';
  html += 'NRR = (GMV MTD ÷ วันที่ผ่านมา) ÷ (GMV เดือนฐาน ÷ วันในเดือนฐาน)<br>';
  html += '<br>';
  html += '<span style="color:rgba(188,215,255,.60)">cohort (core)</span> = outlet ที่มี GMV เดือนก่อน — ไม่รวม comeback, expansion, Transfer In<br>';
  html += '<span style="color:rgba(188,215,255,.60)">ไม่นับ Handover</span> = outlet ที่รับโอนจาก Sales เดือนที่แล้ว และเดือนนี้ ถูก exclude จาก cohort หลัก (นับแยกเป็น handover commission)<br>';
  html += '<span style="color:rgba(188,215,255,.60)">Transfer In</span> = โอนมาจาก KAM อื่น — แสดงแยก ไม่นับใน NRR commission<br>';
  html += '</div>';
  html += '</div>';

  ov.innerHTML = '<div style="position:fixed;bottom:0;left:50%;transform:translateX(-50%) translateY(100%);width:100%;max-width:440px;background:#0d1c34;border-radius:18px 18px 0 0;max-height:84vh;overflow-y:auto;-webkit-overflow-scrolling:touch;z-index:9101;transition:transform .30s cubic-bezier(.34,1.1,.64,1)">'
    +'<div style="width:36px;height:4px;background:rgba(188,215,255,.18);border-radius:2px;margin:10px auto 0"></div>'
    +'<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 10px;position:sticky;top:0;background:#0d1c34;z-index:1;border-bottom:1px solid rgba(188,215,255,.08)">'
      +'<div style="font-size:15px;font-weight:900;color:#fff">กฎค่าคอมฯ</div>'
      +'<div style="display:flex;align-items:center;gap:8px">'
        +'<div style="font-size:9px;color:'+(_cfgReady?'rgba(188,215,255,.40)':'#ffb454')+';font-family:\'IBM Plex Mono\',monospace;letter-spacing:.04em">'+(_cfgReady?'LIVE CONFIG':'SYNCING CONFIG')+'</div>'
        +'<button onclick="closeCommissionRulebook()" style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.55);font-size:12px;cursor:pointer;font-family:inherit">✕</button>'
      +'</div>'
    +'</div>'
    +'<div style="padding:0 18px 32px">'+(_cfgReady?'':_syncStrip)+html+'</div>'
    +'</div>';

  requestAnimationFrame(function(){
    ov.style.background='rgba(5,14,28,.75)';
    ov.style.pointerEvents='all';
    var sh=ov.querySelector('div');
    if(sh){ sh.style.transform='translateX(-50%) translateY(0)'; }
  });
}


function closeCommissionRulebook() {
  var ov = document.getElementById('comm-rulebook-overlay');
  if (!ov) return;
  var sh = ov.querySelector('div');
  if (sh) sh.style.transform = 'translateX(-50%) translateY(100%)';
  ov.style.background = 'rgba(5,14,28,.0)';
  ov.style.pointerEvents = 'none';
  setTimeout(function(){ if(ov.parentNode) ov.parentNode.removeChild(ov); }, 310);
}

window.openCommissionRulebook = openCommissionRulebook;
window.closeCommissionRulebook = closeCommissionRulebook;

