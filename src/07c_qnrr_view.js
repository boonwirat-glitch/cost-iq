// ══════════════════════════════════════════════════════════════════════════════
// _qnrrCompute — Quarter NRR Health compute (moved from 07b, fixed base dedup)
// ══════════════════════════════════════════════════════════════════════════════
//
// _qnrrCompute(kamEmail, scope)
//
// scope: 'kam' | 'tl' | 'admin'
//
// Returns:
//   { quarter, base_month, months, base_gmv, cohort_outlets,
//     base_norm,  ← SUM(base_gmv/base_days) per unique outlet (true denominator)
//     by_month: {
//       '2026-04': {
//         nrr_pct, total_gmv,
//         segments: { core_nrr, core_nrr_churn, handover, new_sales,
//                     expansion, comeback, transfer_in, transfer_out },
//         outlets:  { ... },
//         rows:     []  // raw rows for drill
//       }, ...
//     }
//   }
//
// BUG FIX (v753l):
//   base_gmv previously summed per-row inside month loop → outlet counted
//   3× (one per Q month). Now deduped by outlet_id ONCE before month loop.
//   Denominator = SUM(unique_outlet.base_gmv / base_days) — correct.
//
function _qnrrCompute(kamEmail, scope) {
  scope = scope || 'kam';
  if (!kamEmail) return null;
  var qd = window.bulkQnrrData;
  if (!qd || !qd.loaded) return null;

  // ── Resolve row set based on scope ──────────────────────────────────────
  var myTlEmail = '';
  var kamRows = (qd.byKamEmail && qd.byKamEmail[kamEmail]) || [];
  if (kamRows.length) {
    myTlEmail = (kamRows.find(function(r){return r.period_tl_email;}) || {}).period_tl_email || '';
  }

  var allRows;
  if (scope === 'tl' && myTlEmail && qd.byTlEmail && qd.byTlEmail[myTlEmail]) {
    allRows = qd.byTlEmail[myTlEmail];
  } else if (scope === 'admin') {
    allRows = qd.allRows || [];
  } else {
    allRows = kamRows;
  }
  if (!allRows || !allRows.length) return null;

  function _rowInScope(r) {
    if (scope === 'kam')   return r.period_kam_email === kamEmail;
    if (scope === 'tl')    return r.period_tl_email  === myTlEmail;
    if (scope === 'admin') return true;
    return r.period_kam_email === kamEmail;
  }

  // For TL/admin: internal team transfers collapse to core_nrr
  function _effectiveMovement(r) {
    if (scope === 'kam') return r.movement_type;
    var sameTeam = r.base_kam_email && r.period_tl_email === myTlEmail
      && (r.base_kam_email !== r.period_kam_email);
    if (sameTeam && r.movement_type === 'transfer_out') return null;
    if (sameTeam && r.movement_type === 'transfer_in')  return 'core_nrr';
    return r.movement_type;
  }

  var scopedRows = allRows.filter(_rowInScope);
  if (!scopedRows.length) return null;

  var base_month  = scopedRows[0].base_month || '2026-03';
  var months      = [];
  var monthSet    = {};
  scopedRows.forEach(function(r){
    if (!monthSet[r.period_month]){ monthSet[r.period_month]=1; months.push(r.period_month); }
  });
  months.sort();

  // ── FIX: Build unique outlet base map ONCE — not per month ────────────
  // outlet_id → { base_gmv, base_days }
  // Use first occurrence (all rows for same outlet have same base values)
  var baseMap = {}; // outlet_id → { gmv, days }
  scopedRows.forEach(function(r){
    if (r.base_gmv > 0 && !baseMap[r.outlet_id]) {
      baseMap[r.outlet_id] = {
        gmv:  r.base_gmv,
        days: r.base_days || 31
      };
    }
  });

  var base_gmv = 0;
  var base_norm = 0; // normalized daily rate (true NRR denominator)
  Object.keys(baseMap).forEach(function(oid){
    var b = baseMap[oid];
    base_gmv  += b.gmv;
    base_norm += b.gmv / b.days;
  });
  var cohort_outlets = Object.keys(baseMap).length;

  // ── Per-month aggregation ────────────────────────────────────────────────
  var MOVEMENTS = ['core_nrr','core_nrr_churn','handover','new_sales',
                   'expansion','comeback','transfer_in','transfer_out'];

  var by_month = {};
  months.forEach(function(month){
    var monthRows = scopedRows.filter(function(r){ return r.period_month === month; });
    var segments  = {};
    var outlets   = {};
    MOVEMENTS.forEach(function(m){ segments[m] = 0; outlets[m] = 0; });

    // Numerator: deduplicate outlet_id per month
    var seenOutlets = {};
    var nrr_curr_norm = 0; // SUM(curr_gmv / curr_days) for unique core outlets

    monthRows.forEach(function(r){
      var mv = _effectiveMovement(r);
      if (!mv) return;
      segments[mv] = (segments[mv] || 0) + r.curr_gmv;
      outlets[mv]  = (outlets[mv]  || 0) + 1;

      // NRR numerator — core cohort, deduplicated per outlet per month
      if ((mv === 'core_nrr' || mv === 'core_nrr_churn') && r.base_gmv > 0) {
        if (!seenOutlets[r.outlet_id]) {
          seenOutlets[r.outlet_id] = true;
          var curr_days = r.curr_days || 30;
          nrr_curr_norm += curr_days > 0 ? r.curr_gmv / curr_days : 0;
        }
      }
    });

    // NRR% = normalized curr / normalized base × 100
    var nrr_pct = base_norm > 0
      ? Math.round(nrr_curr_norm / base_norm * 100)
      : null;

    // total_gmv = all positive movements (excludes transfer_out, churn)
    var total_gmv = MOVEMENTS
      .filter(function(m){ return m !== 'transfer_out' && m !== 'core_nrr_churn'; })
      .reduce(function(s,m){ return s + (segments[m] || 0); }, 0);

    by_month[month] = { nrr_pct: nrr_pct, total_gmv: total_gmv,
                        segments: segments, outlets: outlets, rows: monthRows };
  });

  return {
    quarter:        window._QNRR_QUARTER || '2026q2',
    base_month:     base_month,
    months:         months,
    base_gmv:       base_gmv,
    base_norm:      base_norm,
    cohort_outlets: cohort_outlets,
    by_month:       by_month
  };
}
window._qnrrCompute = _qnrrCompute;

// ════════════════════════════════════════════════════════════════════════════
// Freshket Sense — Quarter NRR Health Sheet  (v753l)
// src/07c_qnrr_view.js
// ════════════════════════════════════════════════════════════════════════════

(function(){
'use strict';

var SCOPES   = ['KAM'];
var SCOPE_MAP= ['kam'];
var MONTHS_TH = {'2026-03':'มี.ค.','2026-04':'เม.ย.','2026-05':'พ.ค.','2026-06':'มิ.ย.'};
var Q_MONTHS  = ['2026-04','2026-05','2026-06'];
var BASE_MONTH= '2026-03';

var MV_CFG = {
  core_nrr:       {label:'Core NRR',    color:'rgba(77,220,151,.88)',  order:0},
  handover:       {label:'Handover',    color:'rgba(240,176,0,.82)',   order:1},
  new_sales:      {label:'New Sales',   color:'rgba(160,200,255,.65)', order:2},
  expansion:      {label:'Expansion',   color:'rgba(100,180,255,.75)', order:3},
  transfer_in:    {label:'Transfer in', color:'rgba(255,255,255,.20)', order:4},
  comeback:       {label:'Comeback',    color:'rgba(200,160,255,.68)', order:5},
  core_nrr_churn: {label:'Churn',       color:'rgba(229,62,62,.78)',   order:6},
  transfer_out:   {label:'Transfer out',color:'ghost',                order:7}
};
// Stack order: core_nrr at bottom, others on top (column-reverse in CSS)
var STACK_ORDER = ['core_nrr','handover','new_sales','expansion','comeback','transfer_in'];
var LEGEND_ORDER= ['core_nrr','handover','expansion','new_sales','comeback','transfer_in','core_nrr_churn','transfer_out'];

var _scopeIdx  = 0;
var _selBar    = '2026-04';
var _selMv     = 'all';
var _data      = null;
var _swipeY0   = null;

function _fmtM(n){
  n=Math.round(n||0);
  if(n>=1000000)return'฿'+(n/1000000).toFixed(1)+'M';
  if(n>=1000)return'฿'+Math.round(n/1000)+'K';
  return'฿'+n;
}
function _el(id){return document.getElementById(id);}
function _esc(s){return String(s||'').replace(/[&<>'"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];});}

// ── Open / Close ───────────────────────────────────────────────────────────
function _qnrrOpen(){
  var overlay=_el('qnrr-overlay');
  var sheet  =_el('qnrr-sheet');
  if(!overlay||!sheet)return;

  var role=(typeof getCurrentRole==='function')?getCurrentRole():'';
  if(role==='sales'||role==='sales_tl')return;

  if(role==='tl'||role==='ad_tl'){
    SCOPES=['KAM','ทีม']; SCOPE_MAP=['kam','tl'];
  } else if(role==='admin'||role==='ad'){
    SCOPES=['KAM','ทีม','Admin']; SCOPE_MAP=['kam','tl','admin'];
  } else {
    SCOPES=['KAM']; SCOPE_MAP=['kam'];
  }
  _scopeIdx=0;
  var scopeBtn=_el('qnrr-scope-btn');
  var scopeLbl=_el('qnrr-scope-lbl');
  if(scopeBtn)scopeBtn.style.display=SCOPES.length>1?'flex':'none';
  if(scopeLbl)scopeLbl.textContent=SCOPES[0];

  overlay.classList.add('on');
  sheet.classList.add('on');
  document.body.style.overflow='hidden';
  _qnrrInitSwipe(sheet);

  var qd=window.bulkQnrrData;
  if(qd&&qd.loaded){
    _qnrrRender();
  } else {
    _qnrrShowSkeleton();
    if(typeof _fetchQnrrBundle==='function'){
      _fetchQnrrBundle()
        .then(function(){_qnrrRender();})
        .catch(function(){_qnrrShowError();});
    } else {
      _qnrrShowError();
    }
  }
}
window._qnrrOpen=_qnrrOpen;

function _qnrrClose(){
  var overlay=_el('qnrr-overlay');
  var sheet  =_el('qnrr-sheet');
  if(!overlay||!sheet)return;
  overlay.classList.remove('on');
  sheet.classList.remove('on');
  document.body.style.overflow='';
}
window._qnrrClose=_qnrrClose;

function _qnrrInitSwipe(sheet){
  var handle=_el('qnrr-handle');
  if(!handle||handle._swipeInit)return;
  handle._swipeInit=true;
  handle.addEventListener('touchstart',function(e){_swipeY0=e.touches[0].clientY;},{passive:true});
  handle.addEventListener('touchmove',function(e){
    if(_swipeY0===null)return;
    var dy=e.touches[0].clientY-_swipeY0;
    if(dy>0)sheet.style.transform='translateX(-50%) translateY('+dy+'px)';
  },{passive:true});
  handle.addEventListener('touchend',function(e){
    if(_swipeY0===null)return;
    var dy=e.changedTouches[0].clientY-_swipeY0;
    sheet.style.transform='';
    if(dy>80)_qnrrClose();
    _swipeY0=null;
  },{passive:true});
}

function _qnrrCycleScope(){
  _scopeIdx=(_scopeIdx+1)%SCOPES.length;
  var lbl=_el('qnrr-scope-lbl');
  if(lbl)lbl.textContent=SCOPES[_scopeIdx];
  _qnrrRender();
}
window._qnrrCycleScope=_qnrrCycleScope;

function _qnrrSetMv(mv,btn){
  _selMv=mv;
  var btns=document.querySelectorAll('.qnrr-mv-btn');
  btns.forEach(function(b){b.classList.remove('on');});
  if(btn)btn.classList.add('on');
  _qnrrRenderDrill();
}
window._qnrrSetMv=_qnrrSetMv;

function _qnrrSelBar(month){
  _selBar=month;
  document.querySelectorAll('.qnrr-bar-col').forEach(function(c){
    c.classList.toggle('active',c.dataset.month===month);
  });
  _qnrrRenderDrill();
}
window._qnrrSelBar=_qnrrSelBar;

function _qnrrToggleAcct(id,row){
  var wrap=_el('qnrr-ow-'+id);
  if(!wrap)return;
  var open=wrap.classList.toggle('open');
  if(row)row.classList.toggle('open',open);
}
window._qnrrToggleAcct=_qnrrToggleAcct;

function _qnrrSparkMove(e,wrap){
  var bars=wrap.querySelectorAll('.qnrr-sb');
  var rect=wrap.getBoundingClientRect();
  var x=e.clientX-rect.left;
  var idx=Math.min(Math.max(0,Math.floor(x/10)),bars.length-1);
  bars.forEach(function(b,i){b.classList.toggle('hi',i===idx);});
  var bar=bars[idx];var tt=wrap.querySelector('.qnrr-sp-tt');
  if(!tt||!bar)return;
  tt.querySelector('.qnrr-tt-mo').textContent=bar.dataset.m||'';
  tt.querySelector('.qnrr-tt-v').textContent=bar.dataset.v||'';
}
function _qnrrSparkLeave(wrap){
  wrap.querySelectorAll('.qnrr-sb').forEach(function(b){b.classList.remove('hi');});
}
window._qnrrSparkMove=_qnrrSparkMove;
window._qnrrSparkLeave=_qnrrSparkLeave;

// ── Skeleton ───────────────────────────────────────────────────────────────
function _qnrrShowSkeleton(){
  var barsRow=_el('qnrr-bars-row');
  var list=_el('qnrr-acct-list');
  var lbl=_el('qnrr-drill-lbl');
  var baseVal=_el('qnrr-base-val');
  var nrrVals=_el('qnrr-nrr-vals');
  if(baseVal)baseVal.innerHTML='<span class="qnrr-skel">฿—</span>';
  if(nrrVals)nrrVals.innerHTML='<span class="qnrr-skel">—% · —% · —%</span>';
  if(lbl)lbl.textContent='กำลังโหลด...';
  if(barsRow){
    var skelH=[148,120,140,100];
    barsRow.innerHTML=skelH.map(function(h){
      return '<div class="qnrr-bar-col"><div class="qnrr-skel-bar" style="height:'+h+'px"></div>'+
             '<div class="qnrr-bar-lbl"><span class="qnrr-skel" style="width:24px;display:inline-block">&nbsp;</span></div>'+
             '<div class="qnrr-bar-nrr"><span class="qnrr-skel" style="width:32px;display:inline-block">&nbsp;</span></div></div>';
    }).join('');
  }
  if(list){
    list.innerHTML=[1,2,3].map(function(){
      return '<div class="qnrr-acct-row" style="pointer-events:none">'+
        '<div class="qnrr-mv-dot qnrr-skel"></div>'+
        '<div class="qnrr-acct-left">'+
          '<div class="qnrr-skel" style="height:13px;width:60%;border-radius:4px;margin-bottom:5px"></div>'+
        '</div>'+
        '<div class="qnrr-acct-right"><div class="qnrr-skel" style="width:44px;height:22px;border-radius:3px"></div></div>'+
      '</div>';
    }).join('');
  }
}

function _qnrrShowError(){
  var list=_el('qnrr-acct-list');
  var barsRow=_el('qnrr-bars-row');
  var lbl=_el('qnrr-drill-lbl');
  if(lbl)lbl.textContent='โหลดไม่สำเร็จ';
  if(barsRow)barsRow.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:30px 0;color:rgba(255,255,255,.25);font-size:11px">ไม่พบไฟล์ข้อมูล Q<br><span style="font-size:9px;opacity:.6">sense_qnrr_2026q2.csv ยังไม่ได้อัปโหลด</span></div>';
  if(list)list.innerHTML='';
}

// ── Main render ────────────────────────────────────────────────────────────
function _qnrrRender(){
  var email=(currentUserProfile&&currentUserProfile.email)||'';
  var scope=SCOPE_MAP[_scopeIdx]||'kam';
  if(!window.bulkQnrrData||!window.bulkQnrrData.loaded){_qnrrShowSkeleton();return;}

  _data=null;
  try{_data=_qnrrCompute(email,scope);}catch(e){console.warn('[qnrr]',e);}

  _qnrrRenderBase();
  _qnrrRenderChart();
  _qnrrRenderLegend();
  _qnrrRenderDrill();
}

// ── Zone B: base strip ─────────────────────────────────────────────────────
function _qnrrRenderBase(){
  var baseVal=_el('qnrr-base-val');
  var baseSub=_el('qnrr-base-sub');
  var nrrVals=_el('qnrr-nrr-vals');
  var nrrMos =_el('qnrr-nrr-mos');
  if(!_data){
    if(baseVal)baseVal.textContent='—';
    if(baseSub)baseSub.textContent='โหลดข้อมูล...';
    if(nrrVals)nrrVals.innerHTML='<span style="color:rgba(255,255,255,.3)">กำลังโหลด</span>';
    if(nrrMos) nrrMos.textContent='';
    return;
  }
  var effectiveBase=_data.base_norm>0?Math.round(_data.base_norm*30):_data.base_gmv;
  if(baseVal)baseVal.textContent=_fmtM(effectiveBase);
  if(baseSub)baseSub.textContent=_data.cohort_outlets+' outlets · core cohort (normalized)';

  var vals=[];var mos=[];
  Q_MONTHS.forEach(function(m){
    var bm=_data.by_month[m];
    var pct=bm?bm.nrr_pct:null;
    var color=pct===null?'rgba(255,255,255,.2)':pct>=100?'#4ddc97':pct>=90?'var(--tk-warn)':'rgba(229,62,62,.9)';
    var label=pct===null?'—':pct+'%';
    vals.push('<span class="qnrr-nrr-v" style="color:'+color+'">'+_esc(label)+'</span>');
    mos.push(MONTHS_TH[m]||m);
  });
  if(nrrVals)nrrVals.innerHTML=vals.join('<span class="qnrr-nrr-sep">·</span>');
  if(nrrMos) nrrMos.textContent=mos.join(' · ')+' (normalized)';
}

// ── Zone C: chart ──────────────────────────────────────────────────────────
function _qnrrRenderChart(){
  var barsRow=_el('qnrr-bars-row');
  var refLines=_el('qnrr-ref-lines');
  var toutNote=_el('qnrr-tout-note');
  if(!barsRow)return;

  if(!_data){
    barsRow.innerHTML='<div style="grid-column:1/-1;text-align:center;color:rgba(255,255,255,.25);font-size:11px;padding:40px 0">ไม่มีข้อมูล Q</div>';
    return;
  }

  var allGmvs=[_data.base_gmv];
  Q_MONTHS.forEach(function(m){
    var bm=_data.by_month[m];
    if(bm)allGmvs.push(bm.total_gmv);
  });
  var maxGmv=Math.max.apply(null,allGmvs)||1;
  var chartH=148;

  // transfer_out note
  var hasTout=false;var toutGmv=0;var toutMonths=[];
  Q_MONTHS.forEach(function(m){
    var bm=_data.by_month[m];
    if(bm&&bm.segments&&bm.segments.transfer_out>0){
      hasTout=true;toutGmv+=bm.segments.transfer_out;toutMonths.push(MONTHS_TH[m]||m);
    }
  });
  if(toutNote){
    if(hasTout){
      toutNote.style.display='flex';
      var toutText=_el('qnrr-tout-text');
      if(toutText)toutText.textContent='มี transfer out '+_fmtM(toutGmv)+' ใน '+toutMonths.join(', ')+' — ฐาน NRR adjusted';
    } else {
      toutNote.style.display='none';
    }
  }

  // reference line at base GMV height
  if(refLines){
    var baseTop=chartH-Math.round(_data.base_gmv/maxGmv*chartH);
    refLines.innerHTML='<div class="qnrr-ref-line" style="top:'+baseTop+'px">'+
      '<span class="qnrr-ref-label">'+_fmtM(_data.base_gmv)+' ฐาน</span></div>';
  }

  var allBars=[{month:BASE_MONTH,isBase:true}];
  Q_MONTHS.forEach(function(m){allBars.push({month:m,isBase:false});});

  var barsHtml=allBars.map(function(b){
    var m=b.month;
    var isBase=b.isBase;
    var bm=_data.by_month[m];
    // FIX: use base_gmv for Mar height, total_gmv for Q months
    var barH=isBase
      ? Math.max(6,Math.round(_data.base_gmv/maxGmv*chartH))
      : bm ? Math.max(6,Math.round(bm.total_gmv/maxGmv*chartH)) : 6;
    var isActive=(!isBase&&m===_selBar);
    var lbl=MONTHS_TH[m]||m;
    var lblColor=isActive?'rgba(188,215,255,.75)':'rgba(255,255,255,.45)';

    // Labels: GMV on top, NRR% overlaid inside bar
    var topLabelHtml=''; var overlayHtml='';
    if(isBase){
      var _effBase=_data.base_norm>0?Math.round(_data.base_norm*30):_data.base_gmv;
      topLabelHtml='<div class="qnrr-bar-top-label">'+_fmtM(_effBase)+'</div>';
    } else if(bm){
      var pctColor=bm.nrr_pct!==null?(bm.nrr_pct>=100?'#4ddc97':bm.nrr_pct>=90?'var(--tk-warn)':'rgba(229,62,62,.9)'):'rgba(255,255,255,.2)';
      var pctLabel=bm.nrr_pct!==null?bm.nrr_pct+'%':'—';
      topLabelHtml='<div class="qnrr-bar-top-label">'+_fmtM(bm.total_gmv)+'</div>';
      overlayHtml='<div class="qnrr-bar-nrr-below" style="color:'+pctColor+'">'+pctLabel+'</div>';
    }

    // bar body — FIX stack: core_nrr at BOTTOM, movements on top
    // CSS flex-direction:column + reverse order in HTML = core_nrr renders at bottom
    var segsHtml='';
    if(isBase){
      // Mar reference bar — single solid segment
      segsHtml='<div class="qnrr-seg" style="height:'+barH+'px;'+
        'background:linear-gradient(180deg,rgba(38,96,200,.35) 0%,rgba(38,96,200,.15) 100%);'+
        'border:1px dashed rgba(38,96,200,.40);border-radius:5px"></div>';
    } else if(bm){
      // STACK_ORDER: last item in array renders at bottom of column-reverse flex
      // So core_nrr (last) appears at physical bottom ✓
      STACK_ORDER.forEach(function(mv){
        var gmv=(bm.segments&&bm.segments[mv])||0;
        if(gmv<=0)return;
        var h=Math.max(3,Math.round(gmv/maxGmv*chartH));
        var cfg=MV_CFG[mv];
        segsHtml+='<div class="qnrr-seg" style="height:'+h+'px;background:'+cfg.color+';min-height:3px"></div>';
      });
    }

    // ghost for transfer_out
    var ghostHtml='';
    if(!isBase&&bm&&bm.segments&&bm.segments.transfer_out>0){
      var ghostH=Math.max(6,Math.round(_data.base_gmv/maxGmv*chartH));
      ghostHtml='<div class="qnrr-ghost-bar" style="height:'+ghostH+'px"></div>';
    }

    return '<div class="qnrr-bar-col'+(isActive?' active':'')+'" data-month="'+m+'" onclick="_qnrrSelBar(\''+m+'\')">'+
      topLabelHtml+
      ghostHtml+
      '<div class="qnrr-bar-body" style="height:'+barH+'px">'+segsHtml+'</div>'+
      overlayHtml+
      '<div class="qnrr-bar-lbl" style="color:'+lblColor+'">'+_esc(lbl)+'</div>'+
    '</div>';
  }).join('');

  barsRow.innerHTML=barsHtml;
}

// ── Zone E: Legend ─────────────────────────────────────────────────────────
function _qnrrRenderLegend(){
  var leg=_el('qnrr-legend');
  if(!leg)return;
  var html=LEGEND_ORDER.map(function(mv){
    var cfg=MV_CFG[mv];
    if(mv==='transfer_out'){
      return '<div class="qnrr-leg ghost"><div class="qnrr-leg-sq"></div>'+_esc(cfg.label)+'</div>';
    }
    return '<div class="qnrr-leg"><div class="qnrr-leg-sq" style="background:'+cfg.color+'"></div>'+_esc(cfg.label)+'</div>';
  }).join('');
  leg.innerHTML=html;
}

// ── Zone G: Account + outlet drill ────────────────────────────────────────
function _qnrrRenderDrill(){
  var list=_el('qnrr-acct-list');
  var lbl =_el('qnrr-drill-lbl');
  if(!list)return;

  if(!_data||!_data.by_month[_selBar]){
    if(lbl)lbl.textContent='ไม่มีข้อมูล';
    list.innerHTML='<div style="padding:24px;text-align:center;color:rgba(255,255,255,.25);font-size:11px">ไม่มีข้อมูลเดือนนี้</div>';
    return;
  }

  var bm=_data.by_month[_selBar];
  var rows=bm.rows||[];

  var filtered=rows;
  if(_selMv==='churn')     filtered=rows.filter(function(r){return r.movement_type==='core_nrr_churn';});
  else if(_selMv==='handover')  filtered=rows.filter(function(r){return r.movement_type==='handover';});
  else if(_selMv==='expansion') filtered=rows.filter(function(r){return r.movement_type==='expansion';});

  // group by account_id, collect GMV across ALL months
  var byAcct={};var acctOrder=[];
  filtered.forEach(function(r){
    var aid=r.account_id;
    if(!byAcct[aid]){
      byAcct[aid]={name:r.account_name||aid,type:r.movement_type,outlets:[],
                   gmvByMonth:{},baseGmv:0,currGmv:0};
      acctOrder.push(aid);
    }
    byAcct[aid].outlets.push(r);
    byAcct[aid].baseGmv+=r.base_gmv||0;
    byAcct[aid].currGmv+=r.curr_gmv||0;
  });

  // Collect GMV across all Q months for sparkline (from full data)
  if(_data){
    Q_MONTHS.forEach(function(qm){
      var qbm=_data.by_month[qm];
      if(!qbm)return;
      (qbm.rows||[]).forEach(function(r){
        if(byAcct[r.account_id]){
          byAcct[r.account_id].gmvByMonth[qm]=(byAcct[r.account_id].gmvByMonth[qm]||0)+r.curr_gmv;
        }
      });
    });
    // base month GMV
    acctOrder.forEach(function(aid){
      var a=byAcct[aid];
      a.gmvByMonth[BASE_MONTH]=a.baseGmv;
    });
  }

  if(lbl)lbl.textContent=(MONTHS_TH[_selBar]||_selBar)+' — '+acctOrder.length+' accounts';

  if(!acctOrder.length){
    list.innerHTML='<div style="padding:24px;text-align:center;color:rgba(255,255,255,.25);font-size:11px">ไม่มีข้อมูล</div>';
    return;
  }

  acctOrder.sort(function(a,b){return (byAcct[b].currGmv||0)-(byAcct[a].currGmv||0);});

  var html=acctOrder.map(function(aid,idx){
    var a=byAcct[aid];
    var cfg=MV_CFG[a.type]||{color:'rgba(255,255,255,.3)'};
    var dotColor=cfg.color==='ghost'?'rgba(229,62,62,.6)':cfg.color;

    // Sparkline: 4 bars (Mar/Apr/May/Jun) — use full month GMV
    var allMonths=[BASE_MONTH].concat(Q_MONTHS);
    var gmvVals=allMonths.map(function(m){return a.gmvByMonth[m]||0;});
    var maxSp=Math.max.apply(null,gmvVals)||1;

    var sbHtml=allMonths.map(function(m,mi){
      var v=gmvVals[mi];
      var h=v>0?Math.max(4,Math.round(v/maxSp*20)):2;
      var bg=v>0?(m===BASE_MONTH?'rgba(38,96,200,.45)':dotColor):'rgba(255,255,255,.06)';
      return '<div class="qnrr-sb" style="height:'+h+'px;background:'+bg+'" data-m="'+(MONTHS_TH[m]||m)+'" data-v="'+_fmtM(v)+'"></div>';
    }).join('');

    var baseGmvLabel=_fmtM(a.baseGmv);
    var currGmvLabel=_fmtM(a.currGmv);

    // Outlet rows — use outlet_name if available, fallback to outlet_id
    var outHtml=a.outlets.map(function(o){
      // FIX: use account_name + outlet context, not raw outlet_id
      var oName=o.outlet_name||o.account_name||o.outlet_id||'—';
      // If multiple outlets in same account, show outlet_id as suffix
      if(a.outlets.length>1&&o.outlet_id){
        oName=o.account_name||o.outlet_id;
      }
      var oBaseGmv=o.base_gmv||0;
      var oCurrGmv=o.curr_gmv||0;
      var oMax=Math.max(oBaseGmv,oCurrGmv)||1;
      var obH=oBaseGmv>0?Math.max(3,Math.round(oBaseGmv/oMax*14)):2;
      var ocH=oCurrGmv>0?Math.max(3,Math.round(oCurrGmv/oMax*14)):2;
      return '<div class="qnrr-out-row">'+
        '<div class="qnrr-out-dot" style="background:'+dotColor+'"></div>'+
        '<div class="qnrr-out-name">'+_esc(String(oName).slice(0,45))+'</div>'+
        '<div class="qnrr-out-spark-wrap">'+
          '<div class="qnrr-out-spark">'+
            '<div class="qnrr-osb" style="height:'+obH+'px;background:rgba(38,96,200,.4)" title="ฐาน '+_fmtM(oBaseGmv)+'"></div>'+
            '<div class="qnrr-osb" style="height:'+ocH+'px;background:'+dotColor+'" title="'+MONTHS_TH[_selBar]+' '+_fmtM(oCurrGmv)+'"></div>'+
          '</div>'+
          '<div class="qnrr-out-spark-lbl">'+
            '<span>'+_fmtM(oBaseGmv)+'</span>'+
            '<span style="color:'+dotColor+'">'+_fmtM(oCurrGmv)+'</span>'+
          '</div>'+
        '</div>'+
      '</div>';
    }).join('');

    var rowId='qnrr-r'+idx;
    return '<div class="qnrr-acct-row" onclick="_qnrrToggleAcct(\''+rowId+'\',this)">'+
      '<div class="qnrr-mv-dot" style="background:'+dotColor+'"></div>'+
      '<div class="qnrr-acct-left">'+
        '<div class="qnrr-acct-name">'+_esc(a.name||aid)+'</div>'+
      '</div>'+
      '<div class="qnrr-acct-right">'+
        '<div class="qnrr-spark-col">'+
          '<div class="qnrr-spark-row">'+
            '<span class="qnrr-slbl-base">'+baseGmvLabel+'</span>'+
            '<div class="qnrr-spark" onmousemove="_qnrrSparkMove(event,this)" onmouseleave="_qnrrSparkLeave(this)">'+
              sbHtml+
              '<div class="qnrr-sp-tt"><div class="qnrr-tt-mo"></div><div class="qnrr-tt-v"></div></div>'+
            '</div>'+
            '<span class="qnrr-slbl-curr" style="color:'+dotColor+'">'+currGmvLabel+'</span>'+
          '</div>'+
        '</div>'+
        '<div class="qnrr-chev">›</div>'+
      '</div>'+
    '</div>'+
    '<div class="qnrr-outlet-wrap" id="qnrr-ow-'+rowId+'">'+outHtml+'</div>';
  }).join('');

  list.innerHTML=html;
}

})();

