// ── v309: Commission History Sheet — redesign ────────────────────────────────
// History list: gold design system, full ฿ amounts, readable contrast
// Reconcile detail: mobile-capped, component breakdown with counts

function openCommissionHistory() {
  var ov = document.getElementById('comm-history-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'comm-history-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9200;background:rgba(5,14,28,.0);transition:background .28s;pointer-events:none';
    ov.onclick = function(e){ if(e.target===ov) closeCommissionHistory(); };
    document.body.appendChild(ov);
  }
  ov.innerHTML = '<div style="position:fixed;bottom:0;left:50%;transform:translateX(-50%) translateY(100%);width:100%;max-width:440px;background:#0d1c34;border-radius:18px 18px 0 0;max-height:82vh;overflow-y:auto;-webkit-overflow-scrolling:touch;z-index:9201;transition:transform .30s cubic-bezier(.34,1.1,.64,1)">'
    + '<div style="width:36px;height:4px;background:rgba(var(--ink-blue),.18);border-radius:var(--r-xxs);margin:10px auto 0"></div>'
    + '<div style="padding:14px 18px;font-size:var(--text-lg2);font-weight:900;color:var(--tk-text-primary)">Commission ย้อนหลัง</div>'
    + '<div style="padding:24px;text-align:center;color:rgba(var(--ink-blue),.55);font-size:var(--text-base)">กำลังโหลด...</div>'
    + '</div>';
  requestAnimationFrame(function(){
    ov.style.background='rgba(5,14,28,.75)';
    ov.style.pointerEvents='all';
    var sh=ov.querySelector('div');
    if(sh){ sh.style.transform='translateX(-50%) translateY(0)'; }
  });
  var role = getCurrentRole ? getCurrentRole() : '';
  var email = (currentUserProfile && currentUserProfile.email) || '';
  if (typeof _commLoadHistory !== 'function') { _commRenderHistoryList(ov, [], role, email); return; }
  _commLoadHistory(6).then(function(allRows){ _commRenderHistoryList(ov, allRows, role, email); }).catch(function(){ _commRenderHistoryList(ov, [], role, email); });
}

function _commRenderHistoryList(ov, allRows, role, email) {
  function fmtPeriod(p){ var pts=(p||'').split('-'); var mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(pts[1])-1]||pts[1]; return mo+' '+(parseInt(pts[0])+543); }
  // full baht format — no K/M abbreviation for commission amounts
  function moneyFull(n){ var v=Math.round(Number(n||0)); if(!v)return'฿0'; return '฿'+v.toLocaleString('en-US'); }
  // abbreviated for sub-labels only
  function moneyK(n){ var v=Number(n||0); if(!v)return'฿0'; if(v>=1e6)return'฿'+(v/1e6).toFixed(1)+'M'; if(v>=1000)return'฿'+Math.round(v/1000)+'K'; return'฿'+Math.round(v); }

  var rows = allRows || [];
  if (isRepRole(role)) rows = rows.filter(function(r){ return r.beneficiary_role==='kam'&&(r.beneficiary_email||'').toLowerCase()===email.toLowerCase(); });
  else if (isTLRole(role)) rows = rows.filter(function(r){ return (r.team_lead_email||'').toLowerCase()===email.toLowerCase()||(r.beneficiary_email||'').toLowerCase()===email.toLowerCase(); });

  var byPeriod = {};
  rows.forEach(function(r){ if(!byPeriod[r.period_month])byPeriod[r.period_month]=[]; byPeriod[r.period_month].push(r); });

  var now = new Date();
  var periods = [];
  for (var i=1;i<=6;i++){ var d=new Date(now.getFullYear(),now.getMonth()-i,1); periods.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')); }

  var listHtml = periods.map(function(p){
    var pRows = byPeriod[p]||[];
    var hasLock = pRows.some(function(r){ return String(r.snapshot_status||'').toLowerCase()==='final'; });
    var myRow = pRows.find(function(r){ return isRepRole(role)&&r.beneficiary_role==='kam'; })
              || pRows.find(function(r){ return isTLRole(role)&&r.beneficiary_role==='tl'; })
              || pRows[0];
    var payout = myRow ? Number(myRow.payout_amount||0) : 0;
    var nrr = myRow ? _commFmtPct(myRow.governed_nrr_pct) : '—';

    if (!hasLock) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid rgba(var(--ink-blue),.06)">'
        +'<div><div style="font-size:var(--text-base);font-weight:var(--fw-semi);color:rgba(var(--ink-blue-hi),.52)">'+fmtPeriod(p)+'</div>'
        +'<div style="font-size:var(--text-sm);color:rgba(var(--ink-blue-hi),.52);margin-top:2px">ไม่มี snapshot</div></div>'
        +'<div style="font-size:var(--text-md);color:rgba(var(--ink-blue-hi),.52)">—</div>'
        +'</div>';
    }

    var kamCount = isAdminRole(role) ? pRows.filter(function(r){return r.beneficiary_role==='kam';}).length : null;
    var sub = isAdminRole(role) ? (kamCount+' KAM') : ('NRR '+nrr);

    return '<div onclick="_commOpenHistoryDetail(\''+p+'\')" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(var(--ink-blue),.07);cursor:pointer;background:rgba(255,224,138,.02);-webkit-tap-highlight-color:rgba(255,224,138,.08)" onmouseenter="this.style.background=\'rgba(255,224,138,.06)\'" onmouseleave="this.style.background=\'rgba(255,224,138,.02)\'">'
      +'<div>'
      +'<div style="display:flex;align-items:center;gap:7px">'
      +'<span style="width:5px;height:5px;border-radius:50%;background:#ffe08a;display:inline-block;flex-shrink:0"></span>'
      +'<span style="font-size:var(--text-lg);font-weight:800;color:rgba(var(--ink-blue-hi),.92)">'+fmtPeriod(p)+'</span>'
      +'</div>'
      +'<div style="font-size:var(--text-sm);color:rgba(var(--ink-blue),.72);margin-top:4px;padding-left:12px">'+sub+' · ล็อกแล้ว</div>'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:8px">'
      +'<span style="font-size:var(--text-lg2);font-weight:900;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace;letter-spacing:-.5px">'+moneyFull(payout)+'</span>'
      +'<span style="color:rgba(255,224,138,.40);font-size:var(--text-xl)">›</span>'
      +'</div></div>';
  }).join('');

  // current month
  var _cp=(function(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');})();
  var _cr=(allRows||[]).filter(function(r){return r.period_month===_cp;});
  var _cf=_cr.some(function(r){return r.snapshot_status==='final';});
  var _cd=!_cf&&_cr.some(function(r){return r.snapshot_status==='draft';});
  var _ca=null,_cn=null;
  try{
    if(isRepRole(role)&&typeof _commBuildKamPayout==='function'){var _zz=_commBuildKamPayout(email);if(_zz){_ca=_zz.final_payout;_cn=_zz.nrr_pct;}}
    else if(isTLRole(role)&&typeof _commBuildTlPayout==='function'){var _zz=_commBuildTlPayout(email);if(_zz){_ca=_zz.final_payout;_cn=_zz.nrr_pct;}}
  }catch(e){}
  var _cmr=_cr.find(function(r){return isRepRole(role)?r.beneficiary_role==='kam':r.beneficiary_role==='tl';})||_cr[0];
  if(_cmr){_ca=Number(_cmr.payout_amount||0);_cn=_cmr.governed_nrr_pct;}
  var _cl=_cf?'🔒 ล็อกแล้ว':_cd?'Draft · รอ lock':'Live · ยังไม่ lock';
  var _cc=_cf?'#ffe08a':_cd?'rgba(255,224,138,.60)':'rgba(var(--ink-blue),.70)';
  var _cns=_cn!=null?_cn+'%':'—';
  var currentMonthHtml='<div style="padding:13px 18px 12px;border-bottom:2px solid rgba(var(--ink-blue),.10);background:rgba(var(--ink-blue),.04)">'
    +'<div style="display:flex;align-items:center;justify-content:space-between">'
    +'<div><div style="font-size:var(--text-base);font-weight:var(--fw-bold);color:rgba(var(--ink-blue-hi),.88)">'+fmtPeriod(_cp)+'</div>'
    +'<div style="font-size:var(--text-sm);margin-top:3px;color:'+_cc+'">'+_cl+'</div></div>'
    +'<div style="text-align:right">'
    +(_ca!=null?'<div style="font-size:var(--text-lg2);font-weight:900;color:'+_cc+';font-family:\'IBM Plex Mono\',monospace;letter-spacing:-.5px">'+moneyFull(_ca)+'</div>':'<div style="font-size:var(--text-base);color:rgba(var(--ink-blue-hi),.52)">—</div>')
    +(_cns!=='—'?'<div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.60);margin-top:2px">NRR '+_cns+'</div>':'')
    +'</div></div></div>';

  window._commHistoryAllRows = allRows;

  ov.innerHTML = '<div style="position:fixed;bottom:0;left:50%;transform:translateX(-50%) translateY(0);width:100%;max-width:440px;background:#0d1c34;border-radius:18px 18px 0 0;max-height:82vh;overflow-y:auto;-webkit-overflow-scrolling:touch;z-index:9201;transition:transform .30s cubic-bezier(.34,1.1,.64,1)">'
    +'<div style="width:36px;height:4px;background:rgba(var(--ink-blue),.18);border-radius:var(--r-xxs);margin:10px auto 0"></div>'
    +'<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 10px;position:sticky;top:0;background:#0d1c34;z-index:1;border-bottom:1px solid rgba(var(--ink-blue),.07)">'
      +'<div style="font-size:var(--text-lg2);font-weight:900;color:var(--tk-text-primary)">Commission ย้อนหลัง</div>'
      +'<button onclick="closeCommissionHistory()" style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid rgba(var(--ink-blue),.14);color:rgba(var(--ink-blue-hi),.60);font-size:var(--text-md);cursor:pointer;font-family:inherit">✕</button>'
    +'</div>'
    +'<div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.55);padding:8px 18px 10px;font-family:\'IBM Plex Mono\',monospace">เดือนนี้ + 6 เดือนย้อนหลัง · tap เพื่อดู reconcile</div>'
    +currentMonthHtml
    +listHtml
    +'<div style="height:24px"></div>'
    +'</div>';
}

window._commOpenHistoryDetail = function(period) {
  var ov = document.getElementById('comm-history-overlay');
  if (!ov) return;
  var allRows = window._commHistoryAllRows || [];
  var role = getCurrentRole ? getCurrentRole() : '';
  var email = (currentUserProfile && currentUserProfile.email) || '';
  var pRows = allRows.filter(function(r){ return r.period_month===period; });
  if (isRepRole(role)) pRows = pRows.filter(function(r){ return r.beneficiary_role==='kam'&&(r.beneficiary_email||'').toLowerCase()===email.toLowerCase(); });
  else if (isTLRole(role)) pRows = pRows.filter(function(r){ return (r.team_lead_email||'').toLowerCase()===email.toLowerCase()||(r.beneficiary_email||'').toLowerCase()===email.toLowerCase(); });

  function fmtPeriod(p){ var pts=(p||'').split('-'); var mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(pts[1])-1]||pts[1]; return mo+' '+(parseInt(pts[0])+543); }
  function moneyFull(n){ var v=Math.round(Number(n||0)); if(!v)return'฿0'; return '฿'+v.toLocaleString('en-US'); }
  function moneyK(n){ var v=Number(n||0); if(!v)return'฿0'; if(v>=1e6)return'฿'+(v/1e6).toFixed(1)+'M'; if(v>=1000)return'฿'+Math.round(v/1000)+'K'; return'฿'+Math.round(v); }

  var myKam = pRows.find(function(r){return r.beneficiary_role==='kam';});
  var myTl  = pRows.find(function(r){return r.beneficiary_role==='tl';});
  var focusRow = myKam || myTl || pRows[0];
  if (!focusRow) { ov.querySelector('div').innerHTML += '<div style="padding:20px;text-align:center;color:rgba(var(--ink-blue),.52)">ไม่มีข้อมูล</div>'; return; }

  // v560: rates from the snapshot's frozen config (audit truth) → live cfg → engine default.
  // History must show the rates that were USED at lock time, not today's settings.
  var _cs = focusRow.config_snapshot || {};
  function _rateP(csKey, metric, param, dflt){
    var v = _cs[csKey];
    if (v == null) { try { v = typeof _commGetConfig==='function' ? _commGetConfig(metric, param, dflt) : dflt; } catch(e){ v = dflt; } }
    return Math.round(Number(v)*1000)/10;
  }
  var _p1Pct  = _rateP('upsell_sku_p1_rate','upsell_sku','p1_rate',0.03);
  var _p3Pct  = _rateP('upsell_sku_p3_rate','upsell_sku','p3_rate',0.03);
  var _expPct = _rateP('upsell_outlet_rate','upsell_outlet','rate',0.015);

  var bd = focusRow.breakdown || {};
  var isTlRow = focusRow.beneficiary_role === 'tl';
  var ho = bd.handover || {};
  var gate = bd.gmv_gate || {};
  var p1 = (bd.upsell_sku && bd.upsell_sku.p1) || {};
  var p3 = (bd.upsell_sku && bd.upsell_sku.p3) || {};
  var expOutlet = bd.upsell_outlet || {};

  // counts from breakdown
  var p1GroupCount = Number(bd.p1_group_count || (p1.group_count) || (p1.groups && p1.groups.length) || 0);
  var p3GroupCount = Number(bd.p3_group_count || (p3.group_count) || (p3.groups && p3.groups.length) || 0);
  var nrrOutletCount = Number(bd.account_count || 0);
  var expOutletCount = Number(bd.expansion_outlet_count || (bd.expansion_detail && bd.expansion_detail.length) || 0);

  var gateActive = gate.gate_active === true;
  var gateMult = gate.cap_multiplier != null ? Number(gate.cap_multiplier) : 1;

  // section label
  function secLbl(txt, color){
    return '<div style="font-size:var(--text-2xs);font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:'+(color||'rgba(var(--ink-blue),.45)')+';padding:12px 18px 5px;font-family:\'IBM Plex Mono\',monospace">'+txt+'</div>';
  }
  // source row: label + sub + amount
  function srcRow(label, sub, amount, color, borderBottom){
    var border = borderBottom!==false ? 'border-bottom:1px solid rgba(var(--ink-blue),.06);' : '';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 18px;'+border+'">'
      +'<div>'
      +'<div style="font-size:var(--text-md);font-weight:var(--fw-bold);color:rgba(var(--ink-blue-hi),.82)">'+label+'</div>'
      +(sub?'<div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.55);margin-top:2px">'+sub+'</div>':'')
      +'</div>'
      +'<div style="font-size:var(--text-base);font-weight:900;color:'+(color||'#ffe08a')+';font-family:\'IBM Plex Mono\',monospace;letter-spacing:-.3px;flex-shrink:0;margin-left:12px">'+amount+'</div>'
      +'</div>';
  }
  // gate row
  function gateRow(){
    if (!gateActive) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 18px;border-bottom:1px solid rgba(var(--ink-blue),.06)">'
        +'<div style="font-size:var(--text-sm);color:rgba(var(--ink-blue),.45)">NRR Gate</div>'
        +'<div style="font-size:var(--text-sm);font-weight:var(--fw-bold);color:var(--tk-ok-border);font-family:\'IBM Plex Mono\',monospace">×1.00 ผ่าน</div>'
        +'</div>';
    }
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 18px;border-bottom:1px solid rgba(var(--ink-blue),.06);background:rgba(255,80,60,.05)">'
      +'<div>'
      +'<div style="font-size:var(--text-md);font-weight:var(--fw-bold);color:rgba(255,120,80,.90)">NRR Gate ⚠</div>'
      +'<div style="font-size:var(--text-xs);color:rgba(255,120,80,.60);margin-top:1px">ถูกหักเหลือ '+Math.round(gateMult*100)+'%</div>'
      +'</div>'
      +'<div style="font-size:var(--text-base);font-weight:900;color:rgba(255,120,80,.90);font-family:\'IBM Plex Mono\',monospace">×'+gateMult.toFixed(2)+'</div>'
      +'</div>';
  }

  var bodyHtml = '';

  // hero card
  bodyHtml += '<div style="margin:8px 18px 4px;padding:14px 16px;background:rgba(255,224,138,.07);border:1px solid rgba(255,224,138,.16);border-radius:var(--r-lg);display:flex;align-items:center;justify-content:space-between">'
    +'<div>'
    +'<div style="font-size:var(--text-2xs);font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,224,138,.55);font-family:\'IBM Plex Mono\',monospace;margin-bottom:5px">รวมทั้งหมด</div>'
    +'<div style="font-size:26px;font-weight:900;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace;letter-spacing:-1px">'+moneyFull(focusRow.payout_amount)+'</div>'
    +'</div>'
    +'<div style="text-align:right">'
    +'<div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);text-transform:uppercase;letter-spacing:.06em;color:var(--tk-ok-glow);font-family:\'IBM Plex Mono\',monospace;margin-bottom:4px">NRR</div>'
    +'<div style="font-size:var(--text-3xl);font-weight:900;color:var(--tk-ok-bright);font-family:\'IBM Plex Mono\',monospace">'+_commFmtPct(focusRow.governed_nrr_pct)+'</div>'
    +(bd.commission_mode?'<div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.45);margin-top:2px">NRR '+_commFmtPct(focusRow.governed_nrr_pct)+' · '+(bd.commission_mode==='quarterly'?'vs มิ.ย. (Q3 fixed)':('vs '+bd.prevMonth+' (rolling)'))+'</div>':'')
    +'</div>'
    +'</div>';

  if (isTlRow) {
    // TL view
    bodyHtml += secLbl('ที่มาของค่าคอมฯ');
    bodyHtml += srcRow('NRR ทีม (รักษาฐาน)', null, moneyFull(bd.nrr_payout||0), 'var(--tk-ok-bright)');
    if (bd.upsell_mult) {
      bodyHtml += srcRow('Upsell multiplier', bd.upsell_mult, '', 'rgba(var(--ink-blue),.70)');
    }
    bodyHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 18px;border-top:1px solid rgba(255,224,138,.15);margin-top:2px">'
      +'<div style="font-size:var(--text-base);font-weight:800;color:rgba(var(--ink-blue-hi),.80)">รวม</div>'
      +'<div style="font-size:var(--text-xl);font-weight:900;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace;letter-spacing:-.5px">'+moneyFull(focusRow.payout_amount)+'</div>'
      +'</div>';
  } else {
    // KAM view — full breakdown
    bodyHtml += secLbl('ที่มาของค่าคอมฯ');

    // NRR row
    var nrrSub = 'NRR '+_commFmtPct(focusRow.governed_nrr_pct);
    if (nrrOutletCount) nrrSub += ' · '+nrrOutletCount+' outlets';
    // [quarterly] show base_month pin label; [monthly] show rolling label
    var _baseModeLbl = bd.commission_mode === 'quarterly'
      ? 'vs มิ.ย. 2569 (Q3 fixed)'
      : (bd.prevMonth ? 'vs ' + bd.prevMonth + ' (rolling)' : '');
    if (_baseModeLbl) nrrSub += ' · ' + _baseModeLbl;
    bodyHtml += srcRow('NRR (รักษาฐาน)', nrrSub, moneyFull(bd.nrr_payout||0), 'var(--tk-ok-bright)');

    // P1
    if (Number(p1.comm||0) > 0 || p1GroupCount > 0) {
      var p1Sub = 'GMV '+moneyK(p1.gmv||0)+' · '+_p1Pct+'%';
      if (p1GroupCount) p1Sub += ' · '+p1GroupCount+' กลุ่มสินค้า';
      bodyHtml += srcRow('สินค้าใหม่', p1Sub, moneyFull(p1.comm||0), '#ffe08a');
    }

    // P3
    if (Number(p3.comm||0) > 0 || p3GroupCount > 0) {
      var p3Sub = 'Incremental '+moneyK(p3.gmv_incremental||0)+' · '+_p3Pct+'%';
      if (p3GroupCount) p3Sub += ' · '+p3GroupCount+' กลุ่มสินค้า';
      bodyHtml += srcRow('ยอดเติบโต', p3Sub, moneyFull(p3.comm||0), '#ffe08a');
    }

    // Expansion
    if (Number(expOutlet.commission||0) > 0 || expOutletCount > 0) {
      var expSub = 'GMV '+moneyK(expOutlet.outlet_gmv||0)+' · '+_expPct+'%';
      if (expOutletCount) expSub += ' · '+expOutletCount+' outlets';
      bodyHtml += srcRow('Expansion (ร้านขยาย)', expSub, moneyFull(expOutlet.commission||0), '#00c8b0');
    }

    // Handover
    if (Number(ho.payout||0) > 0 || ho.accounts) {
      var hoSub = '';
      if (ho.accounts) hoSub += ho.accounts+' ร้าน';
      if (ho.retention_pct) hoSub += (hoSub?' · ':'')+' Retention '+_commFmtPct(ho.retention_pct);
      if (ho.baseline_gmv) hoSub += (hoSub?' · ':'')+'Base '+moneyK(ho.baseline_gmv)+' → MTD '+moneyK(ho.current_gmv);
      bodyHtml += srcRow('Handover (รับโอนร้าน)', hoSub||null, moneyFull(ho.payout||0), '#bcd7ff');
    }

    // Gate
    bodyHtml += gateRow();

    // Total line
    bodyHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-top:1px solid rgba(255,224,138,.15);margin-top:2px">'
      +'<div style="font-size:var(--text-base);font-weight:800;color:rgba(var(--ink-blue-hi),.80)">รวม</div>'
      +'<div style="font-size:var(--text-xl);font-weight:900;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace;letter-spacing:-.5px">'+moneyFull(focusRow.payout_amount)+'</div>'
      +'</div>';
  }

  // footer meta
  bodyHtml += '<div style="padding:8px 18px 20px;font-size:var(--text-xs);color:rgba(var(--ink-blue),.52);font-family:\'IBM Plex Mono\',monospace">lock: '+(bd.lock_trigger||'—')+' · '+(bd.csv_data_as_of?bd.csv_data_as_of.split('T')[0]:period)+'</div>';

  var _mxH = (window.innerHeight - 60) + 'px';
  var detailHtml = '<div style="position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:440px;max-height:'+_mxH+';background:#0d1c34;border-radius:18px 18px 0 0;display:flex;flex-direction:column;overflow:hidden;z-index:9201">'
    +'<div style="width:36px;height:4px;background:rgba(var(--ink-blue),.18);border-radius:var(--r-xxs);margin:10px auto 0;flex-shrink:0"></div>'
    +'<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px 8px;flex-shrink:0;border-bottom:1px solid rgba(var(--ink-blue),.08)">'
      +'<div>'
        +'<div style="font-size:var(--text-lg2);font-weight:900;color:var(--tk-text-primary)">'+fmtPeriod(period)+'</div>'
        +'<div style="font-size:var(--text-2xs);color:rgba(255,224,138,.45);font-family:\'IBM Plex Mono\',monospace;margin-top:2px;letter-spacing:.07em;text-transform:uppercase">LOCKED SNAPSHOT</div>'
      +'</div>'
      +'<button onclick="_commOpenHistoryList()" style="font-size:var(--text-sm);color:rgba(var(--ink-blue),.60);background:rgba(var(--ink-blue),.06);border:1px solid rgba(var(--ink-blue),.12);border-radius:var(--r-8);cursor:pointer;padding:5px 10px;font-family:inherit">‹ ย้อนหลัง</button>'
    +'</div>'
    +'<div style="overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1">'
    + bodyHtml
    +'</div>'
    +'</div>';

  ov.innerHTML = detailHtml;
};

window._commOpenHistoryList = function() {
  var allRows = window._commHistoryAllRows || [];
  var role = getCurrentRole ? getCurrentRole() : '';
  var email = (currentUserProfile && currentUserProfile.email) || '';
  var ov = document.getElementById('comm-history-overlay');
  if (ov) _commRenderHistoryList(ov, allRows, role, email);
};

function closeCommissionHistory() {
  var ov = document.getElementById('comm-history-overlay');
  if (!ov) return;
  var sh = ov.querySelector('div');
  if (sh) sh.style.transform = 'translateX(-50%) translateY(100%)';
  ov.style.background = 'rgba(5,14,28,.0)';
  ov.style.pointerEvents = 'none';
  setTimeout(function(){ if(ov.parentNode) ov.parentNode.removeChild(ov); }, 310);
}

window.openCommissionHistory = openCommissionHistory;
window.closeCommissionHistory = closeCommissionHistory;


// target module loaded


// ============================================================
// Folded from 08_patches.js — Step 2 dissolve
// ============================================================


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v211c-handover-movement-fix-js
//////////////////////////////////////////////////////////////////////////////

(function(){
  var VERSION='v211c';
  var DATA_VERSION='2026-05-22-v211c-handover-fix';
  function normId(v){return String(v==null?'':v).trim();}
  function normName(v){return String(v==null?'':v).trim().toLowerCase().replace(/\s+/g,' ');}
  function esc(v){try{return String(v==null?'':v).replace(/[&<>'"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];});}catch(e){return String(v||'');}}
  function parseLine(line){try{if(typeof parseCSVRow==='function')return parseCSVRow(line);}catch(e){} var out=[],cur='',q=false; for(var i=0;i<String(line).length;i++){var c=line[i]; if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===','&&!q){out.push(cur);cur='';}else cur+=c;} out.push(cur); return out;}
  function fmtK(v){v=Number(v||0);var sign=v<0?'−':'';var av=Math.abs(v);if(av>=1000000)return sign+'฿'+(av/1000000).toFixed(1)+'M';if(av>=1000)return sign+'฿'+Math.round(av/1000)+'K';return sign+'฿'+Math.round(v);}
  function currentKamName(){try{return window._ncsKamLabel || (currentUserProfile&&(currentUserProfile.kam_name||currentUserProfile.full_name)) || '';}catch(e){return '';}}
  function setHandoverData(data){try{bulkHandoverData=data;}catch(e){window.bulkHandoverData=data;}}
  function getHandoverData(){try{return bulkHandoverData || {byAccountId:{},byKamName:{},byAccountIdNorm:{}};}catch(e){return window.bulkHandoverData || {byAccountId:{},byKamName:{},byAccountIdNorm:{}};}}
  function parseHandoverText(text){
    var lines=String(text||'').trim().split(/\r?\n/).filter(function(l){return l.trim();});
    if(lines.length && /kam_name/i.test(lines[0])) lines=lines.slice(1);
    var byAccountId={}, byAccountIdNorm={}, byOutletId={}, byKamName={}, byNewKamName={}, rows=[];
    lines.forEach(function(l){
      var p=parseLine(l);
      var kamName=(p[0]||'').trim(), accountId=normId(p[1]), accountName=(p[2]||'').trim(), accountType=(p[3]||'').trim();
      var lastMonthGmv=Number(p[4]||0)||0, curMonthGmv=Number(p[5]||0)||0, newOwnerType=(p[6]||'').trim(), newKamName=(p[7]||'').trim();
      var transferBasis=(p[8]||'').trim(), lastOrderDate=(p[9]||'').trim();
      // V3: new columns for prev_owner + commission tactic B
      var prevOwner=(p[10]||'NEW').trim()||'NEW';
      var transferMonth=(p[11]||'').trim();
      var baselineGmv=Number(p[12]||0)||0, perfGmv=Number(p[13]||0)||0;
      var perfDays=parseInt(p[14])||30, baselineDays=parseInt(p[15])||30;
      var outletId=(p[16]||'').trim();  // v300: user_id (res_id) — outlet-level handover exclude
      if(!kamName || !accountId) return;
      var row={kamName:kamName,accountId:accountId,accountName:accountName,accountType:accountType,lastMonthGmv:lastMonthGmv,curMonthGmv:curMonthGmv,newOwnerType:newOwnerType,newKamName:newKamName,transferBasis:transferBasis,lastOrderDate:lastOrderDate,prevOwner:prevOwner,transferMonth:transferMonth,baselineGmv:baselineGmv,perfGmv:perfGmv,perfDays:perfDays,baselineDays:baselineDays,outletId:outletId};
      rows.push(row);
      // v300: outlet-level index so app can exclude handover outlets from NRR core
      if(outletId){ byOutletId[outletId]={kamName:kamName,accountId:accountId,accountName:accountName,prevOwner:prevOwner,newKamName:newKamName}; }
      // ถ้า account นี้มีหลาย outlet: ให้ SALE prevOwner มาก่อนเสมอ (ไม่ overwrite ด้วย non-SALE)
      if (!byAccountId[accountId] || (row.prevOwner||'').toUpperCase()==='SALE') {
        byAccountId[accountId]=row; byAccountIdNorm[normId(accountId).toLowerCase()]=row;
      }
      (byKamName[kamName]||(byKamName[kamName]=[])).push(row);
      if(newKamName)(byNewKamName[newKamName]||(byNewKamName[newKamName]=[])).push(row);
    });
    return {byAccountId:byAccountId,byAccountIdNorm:byAccountIdNorm,byOutletId:byOutletId,byKamName:byKamName,byNewKamName:byNewKamName,rows:rows,loadedAt:Date.now(),version:DATA_VERSION};
  }
  function schedulePortviewRefresh(){
    try{window._freshketHandoverLoadedAt=Date.now();}catch(e){}
    setTimeout(function(){
      try{ if(typeof renderPortviewTargetBar==='function') renderPortviewTargetBar(); }catch(e){}
      try{ if(document.getElementById('scr-portview')&&document.getElementById('scr-portview').classList.contains('on')){ if(typeof renderPortviewSummary==='function')renderPortviewSummary(); if(typeof renderPortviewList==='function')renderPortviewList(); } }catch(e){}
    },120);
  }
  try{
    if(typeof R2_FILES!=='undefined' && R2_FILES){ R2_FILES.handover='portview_handover.csv?v='+encodeURIComponent(DATA_VERSION); }
    // v224d: removed handover IDB clear (_csvCacheSet('handover','',null)) — was preventing handover from ever being cached → cold-boot on every load
    // v224d: removed R2_SPECS.handover.cache=false override — handover now uses cache:true for warm-boot IDB fast path
  }catch(e){}
  var oldHandle=window.handleFileUpload;
  if(typeof oldHandle==='function'){
    window.handleFileUpload=function(type,input){
      if(type!=='bulk-handover') return oldHandle.apply(this,arguments);
      var file=input&&input.files&&input.files[0]; if(!file) return;
      var done=(input&&typeof input._ciqDone==='function')?input._ciqDone:function(){};
      var reader=new FileReader();
      reader.onload=function(e){
        try{
          var data=parseHandoverText(e.target.result||'');
          setHandoverData(data);
          var b=document.getElementById('badge-bulk-handover'); if(b){b.textContent='✓ '+(data.rows?data.rows.length:Object.keys(data.byAccountId||{}).length)+' rows';b.className='dp-slot-badge ok';}
          var sl=document.getElementById('slot-bulk-handover'); if(sl)sl.style.borderColor='var(--g500)';
          if((data.byNewKamName&&data.byNewKamName['Ploynitcha (Nitcha) Rujipiromthagoon']) || (data.rows||[]).some(function(r){return /ploynitcha/i.test(r.newKamName||'');})){
            try{console.log('[Freshket Sense '+VERSION+'] handover contains Ploynitcha transfer-in rows');}catch(e){}
          }
          schedulePortviewRefresh(); done();
        }catch(err){console.warn('[Freshket Sense '+VERSION+'] handover parse failed',err); done();}
      };
      reader.readAsText(file);
    };
  }
  function lookupHandover(accountId){var hd=getHandoverData();return (hd.byAccountId&&hd.byAccountId[normId(accountId)]) || (hd.byAccountIdNorm&&hd.byAccountIdNorm[normId(accountId).toLowerCase()]) || null;}
  function monthDaysFromNr(nr){var mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];var cp=String(nr.currentMonthLabel||'').split(' '),mi=mo.indexOf(cp[0]),yr=parseInt(cp[1]||'0',10)-543;return (mi>=0&&yr>1900)?new Date(yr,mi+1,0).getDate():30;}
  function rr(v,nr){return nr.daysElapsed>0?Math.round(Number(v||0)/nr.daysElapsed*monthDaysFromNr(nr)):Number(v||0);}
  function ensure(){var overlay=document.getElementById('ncs-overlay'),sheet=document.getElementById('ncs-sheet');if(!overlay){overlay=document.createElement('div');overlay.id='ncs-overlay';overlay.className='ncs-overlay';overlay.onclick=function(e){if(e.target===overlay)window._ncsClose();};document.body.appendChild(overlay);}if(!sheet){sheet=document.createElement('div');sheet.id='ncs-sheet';sheet.className='ncs-sheet';document.body.appendChild(sheet);}return{overlay:overlay,sheet:sheet};}
  function normalTabData(nr){return[{key:'nrr',label:'NRR',count:nr.cohortCount||0,gmv:nr.cohortGmv||0,data:nr.cohortDetail||[],color:'var(--tk-ok-bright)'},{key:'cb',label:'Comeback',count:nr.comebackCount||0,gmv:nr.comebackGmv||0,data:nr.comebackDetail||[],color:'#70a8ff'},{key:'ex',label:'Expansion',count:nr.expansionCount||0,gmv:nr.expansionGmv||0,data:nr.expansionDetail||[],color:'#18d0c0'}];}
  function pushGroups(arr,list,label,color){(list||[]).forEach(function(g){arr.push(Object.assign({},g,{mvType:label,mvColor:color,_mode:'movement'}));});}
  function movementData(nr,key){
    var grp,title,thai,color;
    if(key==='mv-ti'||key==='ti'||key==='transfer-in'){grp=nr.transferIn||{};title='Transfer in';thai='ร้านที่รับโอนเข้าเดือนนี้';color='#70a8ff';}
    else if(key==='mv-new'||key==='new'||key==='new-sales'){grp=nr.newFromSales||{};title='New (Sales)';thai='ร้านใหม่จาก Sales เดือนนี้';color='#18d0c0';}
    else {grp=nr.transferOut||{};title='Transfer out';thai='ร้านที่โอนออกจากพอร์ตนี้';color='#ff8a70';}
    if(key==='mv-to'||key==='to'||key==='transfer-out'){
      var rows=(grp.detail||[]).map(function(r){return Object.assign({},r,{_mode:'transferOut'});});
      return{kind:'transferOut',title:title,thai:thai,color:color,count:grp.count||rows.length||0,gmv:grp.gmv||0,rows:rows};
    }
    var groups=[]; pushGroups(groups,grp.cohortDetail||[],'NRR','var(--tk-ok-bright)'); pushGroups(groups,grp.comebackDetail||[],'Comeback','#70a8ff'); pushGroups(groups,grp.expansionDetail||[],'Expansion','#18d0c0');
    groups=groups.reduce(function(acc,g){
      var id=normId(g.acctId||''); var existing=acc.find(function(x){return normId(x.acctId)===id && id;});
      if(existing){existing.prevTotal+=Number(g.prevTotal||0);existing.currTotal+=Number(g.currTotal||0);existing.outlets=(existing.outlets||[]).concat(g.outlets||[]);}
      else acc.push(Object.assign({prevTotal:0,currTotal:0,outlets:[]},g));
      return acc;
    },[]).map(function(g){
      // v251: removed lookupHandover GMV override — portview_handover.csv is Apr commission data
      // Portview movement prevTotal comes from actual order GMV, not Apr commission baseline
      return g;
    }).sort(function(a,b){return (b.currTotal||0)-(a.currTotal||0);});
    return{kind:'movement',title:title,thai:thai,color:color,count:grp.count||0,gmv:grp.gmv||0,nrr:grp.nrr,groups:groups};
  }
  function metaFor(t){if(t.kind==='movement')return (t.count||0)+' ร้าน · '+fmtK(t.gmv||0)+' MTD เดือนนี้';return (t.count||0)+' ร้าน · '+fmtK(t.gmv||0)+' GMV เดือนก่อนที่ออกจากพอร์ต';}
  function renderNormalRows(t,nr){
    if(!t.data||!t.data.length)return '<div class="ncs-empty">ไม่มีข้อมูล</div>'; var days=monthDaysFromNr(nr),isNrr=t.key==='nrr';
    return (t.data||[]).map(function(g,gi){var open=gi<4,chipVal=isNrr?fmtK(rr(g.currTotal,nr)):fmtK(g.currTotal||0);var chip='<div class="ncs-chip'+(open?' open':'')+'" onclick="_ncsChipToggle(this)"><span class="ncs-chip-chev">›</span><span class="ncs-chip-name">'+esc(g.acctName||g.acctId||'—')+'</span><span class="ncs-chip-rr" style="color:'+t.color+'">'+chipVal+'</span></div>';var rows=(g.outlets||[]).map(function(o){if(isNrr){var rv=rr(o.currGmv,nr), cls=rv>=Number(o.prevGmv||0)?'ncs-gmv rr-up':'ncs-gmv rr-dn';return '<div class="ncs-outlet-row nrr-cols"><div class="ncs-outlet-name">'+esc(o.outletName||o.outletId||'—')+'</div><div class="ncs-gmv base">'+(o.prevGmv>0?fmtK(o.prevGmv):'—')+'</div><div class="'+cls+'">'+fmtK(rv)+'</div><div class="ncs-gmv mtd">'+fmtK(o.currGmv||0)+'</div></div>';}return '<div class="ncs-outlet-row simple-cols"><div class="ncs-outlet-name">'+esc(o.outletName||o.outletId||'—')+'</div><div class="ncs-gmv" style="text-align:right;color:'+t.color+'">'+fmtK(o.currGmv||0)+'</div></div>';}).join('');return chip+'<div class="ncs-outlet-rows'+(open?' open':'')+'">'+rows+'</div>';}).join('');
  }
  function renderMovementRows(t){
    if(!t.groups||!t.groups.length)return '<div class="ncs-empty">ไม่มีข้อมูล</div>';
    return t.groups.map(function(g,gi){var open=gi<2;var prev=Number(g.prevTotal||0);var curr=Number(g.currTotal||0);var chip='<div class="ncs-chip mv2'+(open?' open':'')+'" onclick="_ncsChipToggle(this)"><span class="ncs-chip-name"><span class="ncs-chip-chev">›</span> '+esc(g.acctName||g.acctId||'—')+'</span><span class="ncs-prev-val">'+(prev?fmtK(prev):'—')+'</span><span class="ncs-mtd-val" style="color:'+t.color+'">'+fmtK(curr)+'</span></div>';var outs=(g.outlets||[]).slice(0,80).map(function(o){return '<div class="ncs-outlet-row ncs-mv2-outlet"><div class="ncs-outlet-name">'+esc(o.outletName||o.outletId||'—')+'</div><div class="ncs-gmv base">'+(o.prevGmv?fmtK(o.prevGmv):'—')+'</div><div class="ncs-gmv" style="color:'+t.color+'">'+fmtK(o.currGmv||0)+'</div></div>';}).join('');return chip+'<div class="ncs-outlet-rows'+(open?' open':'')+'">'+outs+'</div>';}).join('');
  }
  function renderTransferOutRows(t){
    if(!t.rows||!t.rows.length)return '<div class="ncs-empty">ไม่มีร้านที่โอนออก</div>';
    return t.rows.sort(function(a,b){return (b.lastMonthGmv||0)-(a.lastMonthGmv||0);}).map(function(r){var owner=r.newKamName||r.newOwnerType||'—';return '<div class="ncs-transfer-card"><div><div class="ncs-transfer-name">'+esc(r.accountName||r.accountId||'—')+'</div><div class="ncs-transfer-sub">'+esc(r.accountType||'')+' · ย้ายไป: '+esc(owner)+'</div></div><div><div class="ncs-transfer-gmv">'+fmtK(r.lastMonthGmv||0)+'</div><div class="ncs-transfer-mtd">MTD '+fmtK(r.curMonthGmv||0)+'</div></div></div>';}).join('');
  }
  function buildRowsForExport(mode,nr){var rows=[]; if(mode==='mv-to'||mode==='to'||mode==='transfer-out'){var t=movementData(nr,'mv-to');rows.push(['Type','Account','Account Type','Last Month GMV','Current MTD GMV','New Owner']);(t.rows||[]).forEach(function(r){rows.push(['Transfer out',r.accountName||r.accountId||'',r.accountType||'',Math.round(r.lastMonthGmv||0),Math.round(r.curMonthGmv||0),r.newKamName||r.newOwnerType||'']);});return rows;} if(/^mv-|^ti$|^new$|transfer-in|new-sales/.test(mode)){var mt=movementData(nr,mode);rows.push(['Movement','Account','Previous Month GMV','Current MTD GMV']);(mt.groups||[]).forEach(function(g){rows.push([mt.title,g.acctName||g.acctId||'',Math.round(g.prevTotal||0),Math.round(g.currTotal||0)]);});return rows;} var tab=(normalTabData(nr).find(function(x){return x.key===mode;})||normalTabData(nr)[0]);rows.push(tab.key==='nrr'?['Type','Account','Outlet','Baseline','Run Rate','GMV MTD']:['Type','Account','Outlet','GMV MTD']);(tab.data||[]).forEach(function(g){(g.outlets||[]).forEach(function(o){if(tab.key==='nrr')rows.push([tab.label,g.acctName||'',o.outletName||o.outletId||'',Math.round(o.prevGmv||0),Math.round(rr(o.currGmv,nr)),Math.round(o.currGmv||0)]);else rows.push([tab.label,g.acctName||'',o.outletName||o.outletId||'',Math.round(o.currGmv||0)]);});});return rows;}
  function csvEscape(v){v=String(v==null?'':v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;} function downloadRows(rows,name){var csv=rows.map(function(r){return r.map(csvEscape).join(',');}).join('\n');var blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name||'portfolio-detail.csv';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},200);}
  function render(mode){var nr=window._ncsLastNrrResult, kamLabel=window._ncsKamLabel||currentKamName(); if(!nr){try{showToast('ยังไม่มีข้อมูลพอร์ต','!');}catch(e){}return;} var activeMode=mode||'nrr'; window._ncsActiveMode=activeMode; var dom=ensure(), overlay=dom.overlay, sheet=dom.sheet; var isMovement=/^mv-|^ti$|^new$|^to$|transfer-in|transfer-out|new-sales/.test(activeMode); var title='รายละเอียด GMV', subtitle='ดูรายร้าน/สาขา โดยไม่ต้องปิด panel คำอธิบายหลัก', meta='', head='', body='', total='', totalColor='var(--tk-ok-bright)';
    if(isMovement){var mt=movementData(nr,activeMode);title='รายละเอียด '+mt.title;subtitle=mt.thai+' — '+esc(kamLabel);meta=metaFor(mt);total=fmtK(mt.gmv||0);totalColor=mt.color;if(mt.kind==='transferOut'){head='';body=renderTransferOutRows(mt);sheet.innerHTML='<div class="ncs-handle"><div></div></div><button class="ncs-close-x" onclick="_ncsClose()">×</button><div class="ncs-header"><div class="ncs-title">'+esc(title)+'</div><div class="ncs-subtitle">'+esc(subtitle)+'</div></div><div class="ncs-meta"><span class="ncs-meta-text">'+esc(meta)+'</span></div><div class="ncs-body" id="ncs-body">'+body+'</div><div class="ncs-total"><span class="ncs-total-lbl">รวม '+esc(mt.title)+'</span><span class="ncs-total-val" style="color:'+totalColor+'">'+total+'</span></div><div class="ncs-footer"><button class="ncs-btn primary" onclick="_ncsExportCSV()">↓ ดาวน์โหลด CSV</button><button class="ncs-btn secondary" onclick="_ncsCopyTSV()">Copy TSV</button></div>';}else{head='<div class="ncs-th">Outlet / Account</div><div class="ncs-th r">เดือนก่อน</div><div class="ncs-th r">MTD</div>';body=renderMovementRows(mt);sheet.innerHTML='<div class="ncs-handle"><div></div></div><button class="ncs-close-x" onclick="_ncsClose()">×</button><div class="ncs-header"><div class="ncs-title">'+esc(title)+'</div><div class="ncs-subtitle">'+esc(subtitle)+'</div></div><div class="ncs-meta"><span class="ncs-meta-text">'+esc(meta)+'</span><button id="ncs-toggle-btn" class="ncs-sort-btn" onclick="_ncsToggleAll()">ย่อทั้งหมด</button></div><div class="ncs-tbl-head ncs-mv2-cols">'+head+'</div><div class="ncs-body" id="ncs-body">'+body+'</div><div class="ncs-total"><span class="ncs-total-lbl">รวม '+esc(mt.title)+' <span class="ncs-subtle-note">MTD</span></span><span class="ncs-total-val" style="color:'+totalColor+'">'+total+'</span></div><div class="ncs-footer"><button class="ncs-btn primary" onclick="_ncsExportCSV()">↓ ดาวน์โหลด CSV</button><button class="ncs-btn secondary" onclick="_ncsCopyTSV()">Copy TSV</button></div>';}}
    else{var tabs=normalTabData(nr); if(!tabs.find(function(x){return x.key===activeMode;})) activeMode='nrr'; var t=tabs.find(function(x){return x.key===activeMode;})||tabs[0]; var tabsHtml=tabs.map(function(x){return '<button class="ncs-tab t-'+x.key+(x.key===activeMode?' on':'')+'" onclick="_ncsSetTab(\''+x.key+'\')">'+x.label+'<br><span style="font-size:var(--text-2xs);opacity:.75">'+(x.count||0)+' outlets</span></button>';}).join(''); head=t.key==='nrr'?'<div class="ncs-th">Outlet</div><div class="ncs-th r">ฐาน</div><div class="ncs-th r" style="color:var(--tk-ok-bright)">Run Rate</div><div class="ncs-th r">MTD</div>':'<div class="ncs-th">Outlet / Account</div><div class="ncs-th r">MTD</div>'; body=renderNormalRows(t,nr); sheet.innerHTML='<div class="ncs-handle"><div></div></div><button class="ncs-close-x" onclick="_ncsClose()">×</button><div class="ncs-header"><div class="ncs-title">รายละเอียด GMV — '+esc(kamLabel)+'</div><div class="ncs-subtitle">แยก NRR / Comeback / Expansion ให้ดูระดับ account และ outlet</div><div class="ncs-tabs">'+tabsHtml+'</div></div><div class="ncs-meta"><span class="ncs-meta-text">'+(t.count||0)+' outlets · '+fmtK(t.gmv||0)+' MTD</span><button id="ncs-toggle-btn" class="ncs-sort-btn" onclick="_ncsToggleAll()">ย่อทั้งหมด</button></div><div class="ncs-tbl-head '+(t.key==='nrr'?'nrr-cols':'simple-cols')+'">'+head+'</div><div class="ncs-body" id="ncs-body">'+body+'</div><div class="ncs-total"><span class="ncs-total-lbl">รวม '+esc(t.label)+'</span><span class="ncs-total-val" style="color:'+t.color+'">'+(t.key==='nrr'?'':'+')+fmtK(t.gmv||0)+'</span></div><div class="ncs-footer"><button class="ncs-btn primary" onclick="_ncsExportCSV()">↓ ดาวน์โหลด CSV</button><button class="ncs-btn secondary" onclick="_ncsCopyTSV()">Copy TSV</button></div>';}
    var parent=document.getElementById('tgt-explain-sheet-overlay'); if(parent&&parent.classList.contains('on'))parent.classList.add('ncs-child-open'); requestAnimationFrame(function(){overlay.classList.add('on');sheet.classList.add('on');});
  }
  window._tgtShowCohortSheet=function(tab){render(tab||'nrr');};
  window._ncsClose=function(){var overlay=document.getElementById('ncs-overlay'),sheet=document.getElementById('ncs-sheet');if(overlay)overlay.classList.remove('on');if(sheet)sheet.classList.remove('on');var parent=document.getElementById('tgt-explain-sheet-overlay');if(parent)parent.classList.remove('ncs-child-open');setTimeout(function(){if(sheet)sheet.innerHTML='';},280);};
  window._ncsChipToggle=function(chip){chip.classList.toggle('open');var r=chip.nextElementSibling;if(r)r.classList.toggle('open');};
  window._ncsToggleAll=function(){var body=document.getElementById('ncs-body');if(!body)return;var chips=Array.from(body.querySelectorAll('.ncs-chip'));var groups=Array.from(body.querySelectorAll('.ncs-outlet-rows'));var any=groups.some(function(g){return g.classList.contains('open');});chips.forEach(function(c){c.classList.toggle('open',!any);});groups.forEach(function(g){g.classList.toggle('open',!any);});var btn=document.getElementById('ncs-toggle-btn');if(btn)btn.textContent=any?'ขยายทั้งหมด':'ย่อทั้งหมด';};
  window._ncsSetTab=function(k){render(k||'nrr');};
  window._ncsExportCSV=function(){try{downloadRows(buildRowsForExport(window._ncsActiveMode||'nrr',window._ncsLastNrrResult),'portfolio_'+String(window._ncsActiveMode||'nrr').replace(/[^a-z0-9_-]/gi,'_')+'.csv');}catch(e){console.warn('[v211c] csv export failed',e);}};
  window._ncsCopyTSV=function(){try{var rows=buildRowsForExport(window._ncsActiveMode||'nrr',window._ncsLastNrrResult);var tsv=rows.map(function(r){return r.join('\t');}).join('\n');navigator.clipboard.writeText(tsv);try{showToast('Copy TSV แล้ว','ok');}catch(e){}}catch(e){console.warn('[v211c] copy failed',e);}};
  document.addEventListener('click',function(e){var row=e.target.closest&&e.target.closest('.tgt-mv-row');if(!row||e.target.closest('.tgt-mv-header'))return;var txt=(row.textContent||'').toLowerCase();if(txt.indexOf('transfer in')>=0){e.preventDefault();e.stopPropagation();render('mv-ti');}else if(txt.indexOf('new (sales)')>=0||txt.indexOf('new')>=0){e.preventDefault();e.stopPropagation();render('mv-new');}else if(txt.indexOf('transfer out')>=0){e.preventDefault();e.stopPropagation();render('mv-to');}},true);
  console.log('[Freshket Sense '+VERSION+'] Handover cache bust + movement sheet UI fix loaded');
})();


//////////////////////////////////////////////////////////////////////////////
