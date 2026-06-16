// ════════════════════════════════════════════════════════════════════════════
// Freshket Sense — Quarter NRR Health Sheet  (v753f)
// src/07c_qnrr_view.js
//
// Entry:  _qnrrOpen()  — called by portview header tap
// Close:  _qnrrClose() — backdrop tap / swipe down
// Data:   _tgtComputeQuarterNRR() from 07b_nrr_target.js
//         _fetchQnrrBundle() from 02_data_pipeline.js
//
// Scope toggle: KAM → ทีม → Admin
// ════════════════════════════════════════════════════════════════════════════

(function(){
'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
var SCOPES   = ['KAM','ทีม','Admin'];
var SCOPE_MAP= ['kam','tl','admin'];
var MONTHS_TH = {'2026-03':'มี.ค.','2026-04':'เม.ย.','2026-05':'พ.ค.','2026-06':'มิ.ย.'};
var Q_MONTHS  = ['2026-04','2026-05','2026-06'];
var BASE_MONTH= '2026-03';

// Movement display config
var MV_CFG = {
  core_nrr:      {label:'Core NRR',   color:'rgba(77,220,151,.80)',  order:0},
  handover:      {label:'Handover',   color:'rgba(240,176,0,.75)',   order:1},
  new_sales:     {label:'New Sales',  color:'rgba(140,180,255,.55)', order:2},
  expansion:     {label:'Expansion',  color:'rgba(77,220,151,.55)',  order:3},
  transfer_in:   {label:'Transfer in',color:'rgba(255,255,255,.15)', order:4},
  core_nrr_churn:{label:'Churn',      color:'rgba(229,62,62,.75)',   order:5},
  transfer_out:  {label:'Transfer out',color:'ghost',               order:6}
};
var LEGEND_ORDER = ['core_nrr','handover','expansion','new_sales','transfer_in','core_nrr_churn','transfer_out'];

// ── State ──────────────────────────────────────────────────────────────────
var _scopeIdx  = 0;
var _selBar    = '2026-04';
var _selMv     = 'all';
var _data      = null;   // result of _tgtComputeQuarterNRR
var _swipeY0   = null;

// ── Helpers ────────────────────────────────────────────────────────────────
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
  overlay.classList.add('on');
  sheet.classList.add('on');
  document.body.style.overflow='hidden';
  // fetch bundle if needed
  var email=(currentUserProfile&&currentUserProfile.email)||'';
  if(email&&typeof _fetchQnrrBundle==='function'){
    _fetchQnrrBundle(email).then(function(){_qnrrRender();}).catch(function(){_qnrrRender();});
  } else {
    _qnrrRender();
  }
  _qnrrInitSwipe(sheet);
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

// ── Swipe down to dismiss ──────────────────────────────────────────────────
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

// ── Cycle scope ────────────────────────────────────────────────────────────
function _qnrrCycleScope(){
  _scopeIdx=(_scopeIdx+1)%SCOPES.length;
  var lbl=_el('qnrr-scope-lbl');
  if(lbl)lbl.textContent=SCOPES[_scopeIdx];
  _qnrrRender();
}
window._qnrrCycleScope=_qnrrCycleScope;

// ── Filter ─────────────────────────────────────────────────────────────────
function _qnrrSetMv(mv,btn){
  _selMv=mv;
  var btns=document.querySelectorAll('.qnrr-mv-btn');
  btns.forEach(function(b){b.classList.remove('on');});
  if(btn)btn.classList.add('on');
  _qnrrRenderDrill();
}
window._qnrrSetMv=_qnrrSetMv;

// ── Select bar ─────────────────────────────────────────────────────────────
function _qnrrSelBar(month){
  _selBar=month;
  document.querySelectorAll('.qnrr-bar-col').forEach(function(c){
    c.classList.toggle('active',c.dataset.month===month);
  });
  _qnrrRenderDrill();
}
window._qnrrSelBar=_qnrrSelBar;

// ── Toggle account row ─────────────────────────────────────────────────────
function _qnrrToggleAcct(id,row){
  var wrap=_el('qnrr-ow-'+id);
  if(!wrap)return;
  var open=wrap.classList.toggle('open');
  if(row)row.classList.toggle('open',open);
}
window._qnrrToggleAcct=_qnrrToggleAcct;

// ── Sparkline hover ────────────────────────────────────────────────────────
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

// ── Main render ────────────────────────────────────────────────────────────
function _qnrrRender(){
  var email=(currentUserProfile&&currentUserProfile.email)||'';
  var scope=SCOPE_MAP[_scopeIdx]||'kam';

  // compute
  _data=null;
  if(typeof _tgtComputeQuarterNRR==='function'){
    try{_data=_tgtComputeQuarterNRR(email,scope);}catch(e){console.warn('[qnrr]',e);}
  }

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
  if(baseVal)baseVal.textContent=_fmtM(_data.base_gmv);
  if(baseSub)baseSub.textContent=_data.cohort_outlets+' outlets · core cohort';

  // NRR% per month
  var vals=[];var mos=[];
  Q_MONTHS.forEach(function(m){
    var bm=_data.by_month[m];
    var pct=bm?bm.nrr_pct:null;
    var color=pct===null?'rgba(255,255,255,.2)':pct>=100?'#4ddc97':pct>=90?'#4ddc97':'var(--amb)';
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

  // compute max GMV across all months for scaling
  var allGmvs=[_data.base_gmv];
  Q_MONTHS.forEach(function(m){
    var bm=_data.by_month[m];
    if(bm)allGmvs.push(bm.total_gmv);
  });
  var maxGmv=Math.max.apply(null,allGmvs)||1;
  var chartH=148; // px

  // detect transfer_out
  var hasTout=false;var toutGmv=0;var toutMonths=[];
  Q_MONTHS.forEach(function(m){
    var bm=_data.by_month[m];
    if(bm&&bm.segments&&bm.segments.transfer_out>0){
      hasTout=true;toutGmv+=bm.segments.transfer_out;toutMonths.push(MONTHS_TH[m]||m);
    }
  });

  // reference lines
  if(refLines){
    var baseTop=chartH-Math.round(_data.base_gmv/maxGmv*chartH);
    var html='<div class="qnrr-ref-line" style="top:'+baseTop+'px"><span class="qnrr-ref-label">'+_fmtM(_data.base_gmv)+' ฐาน</span></div>';
    refLines.innerHTML=html;
  }

  // transfer_out explanation
  if(toutNote){
    if(hasTout){
      toutNote.style.display='flex';
      var toutText=_el('qnrr-tout-text');
      if(toutText)toutText.textContent='มี transfer out '+_fmtM(toutGmv)+' ใน '+toutMonths.join(', ')+' — ฐาน NRR adjusted';
    } else {
      toutNote.style.display='none';
    }
  }

  // build bars
  var allBars=[{month:BASE_MONTH,isBase:true}];
  Q_MONTHS.forEach(function(m){allBars.push({month:m,isBase:false});});

  var barsHtml=allBars.map(function(b){
    var m=b.month;
    var isBase=b.isBase;
    var bm=_data.by_month[m];
    var barH=isBase?Math.max(6,Math.round(_data.base_gmv/maxGmv*chartH)):bm?Math.max(6,Math.round(bm.total_gmv/maxGmv*chartH)):6;
    var active=(!isBase&&m===_selBar)?'active':'';
    var lbl=MONTHS_TH[m]||m;
    var onclick=isBase?'_qnrrSelBar(\''+m+'\')':'_qnrrSelBar(\''+m+'\')';

    // NRR label
    var nrrHtml='';
    if(isBase){
      nrrHtml='<div class="qnrr-bar-nrr" style="color:rgba(255,255,255,.22);font-size:10px;font-weight:700">BASE</div>';
    } else if(bm&&bm.nrr_pct!==null){
      var pctColor=bm.nrr_pct>=100?'#4ddc97':bm.nrr_pct>=90?'#4ddc97':'var(--amb)';
      nrrHtml='<div class="qnrr-bar-nrr" style="color:'+pctColor+'">'+bm.nrr_pct+'%</div>';
    } else {
      nrrHtml='<div class="qnrr-bar-nrr" style="color:rgba(255,255,255,.2)">—</div>';
    }

    // bar body segments
    var segsHtml='';
    if(isBase){
      segsHtml='<div class="qnrr-seg" style="height:'+barH+'px;background:linear-gradient(180deg,rgba(38,96,200,.28) 0%,rgba(38,96,200,.12) 100%);border:1px solid rgba(38,96,200,.22)"></div>';
    } else if(bm){
      // stack: core_nrr (bottom) → handover → new_sales → expansion → transfer_in (top)
      var stackOrder=['transfer_in','expansion','new_sales','handover','core_nrr'];
      var totalSeg=bm.total_gmv||1;
      stackOrder.forEach(function(mv){
        var gmv=(bm.segments&&bm.segments[mv])||0;
        if(gmv<=0)return;
        var h=Math.max(4,Math.round(gmv/maxGmv*chartH));
        var cfg=MV_CFG[mv];
        segsHtml+='<div class="qnrr-seg" style="height:'+h+'px;background:'+cfg.color+'"></div>';
      });
    }

    // ghost bar for transfer_out
    var ghostHtml='';
    if(!isBase&&bm&&bm.segments&&bm.segments.transfer_out>0){
      var ghostH=Math.max(6,Math.round(_data.base_gmv/maxGmv*chartH));
      ghostHtml='<div class="qnrr-ghost-bar" style="height:'+ghostH+'px"></div>';
    }

    return '<div class="qnrr-bar-col '+active+'" data-month="'+m+'" onclick="'+onclick+'">'+
      ghostHtml+
      '<div class="qnrr-bar-body" style="height:'+barH+'px">'+segsHtml+'</div>'+
      '<div class="qnrr-bar-lbl"'+(_selBar===m&&!isBase?' style="color:rgba(188,215,255,.65)"':'')+'>'+_esc(lbl)+'</div>'+
      nrrHtml+
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

  // filter by movement
  var filtered=rows;
  if(_selMv==='churn') filtered=rows.filter(function(r){return r.movement_type==='core_nrr_churn';});
  else if(_selMv==='handover') filtered=rows.filter(function(r){return r.movement_type==='handover';});
  else if(_selMv==='expansion') filtered=rows.filter(function(r){return r.movement_type==='expansion';});

  // group by account
  var byAcct={};var acctOrder=[];
  filtered.forEach(function(r){
    var aid=r.account_id;
    if(!byAcct[aid]){
      byAcct[aid]={name:r.account_name,type:r.movement_type,outlets:[],baseGmv:0,currGmv:0};
      acctOrder.push(aid);
    }
    byAcct[aid].outlets.push(r);
    byAcct[aid].baseGmv+=r.base_gmv||0;
    byAcct[aid].currGmv+=r.curr_gmv||0;
  });

  if(lbl)lbl.textContent=(MONTHS_TH[_selBar]||_selBar)+' — '+acctOrder.length+' accounts';

  if(!acctOrder.length){
    list.innerHTML='<div style="padding:24px;text-align:center;color:rgba(255,255,255,.25);font-size:11px">ไม่มีข้อมูล</div>';
    return;
  }

  // sort by currGmv desc
  acctOrder.sort(function(a,b){return (byAcct[b].currGmv||0)-(byAcct[a].currGmv||0);});

  var html=acctOrder.map(function(aid,idx){
    var a=byAcct[aid];
    var cfg=MV_CFG[a.type]||{color:'rgba(255,255,255,.3)'};
    var dotColor=cfg.color==='ghost'?'rgba(229,62,62,.6)':cfg.color;
    var tagColor=a.type==='core_nrr_churn'?'rgba(229,62,62,.45)':
                 a.type==='handover'?'rgba(240,176,0,.45)':
                 a.type==='expansion'?'rgba(77,220,151,.4)':
                 a.type==='new_sales'?'rgba(140,180,255,.4)':'rgba(255,255,255,.2)';

    // build sparkline — GMV across Q months for this account
    var allMonths=[BASE_MONTH].concat(Q_MONTHS);
    var acctGmvByMonth={};
    // for base month, use base_gmv of any outlet
    acctGmvByMonth[BASE_MONTH]=a.outlets.reduce(function(s,o){return s+(o.base_gmv||0);},0);
    // for Q months, only this month has curr_gmv; we'd need full data — use available
    acctGmvByMonth[_selBar]=a.currGmv;
    var maxSp=Math.max.apply(null,Object.values(acctGmvByMonth).filter(function(v){return v>0;}))||1;

    var sbHtml=allMonths.map(function(m){
      var v=acctGmvByMonth[m]||0;
      var h=v>0?Math.max(3,Math.round(v/maxSp*18)):2;
      var bg=v>0?(m===BASE_MONTH?'rgba(38,96,200,.3)':dotColor):'rgba(255,255,255,.06)';
      return '<div class="qnrr-sb" style="height:'+h+'px;background:'+bg+'" data-m="'+(MONTHS_TH[m]||m)+'" data-v="'+_fmtM(v)+'"></div>';
    }).join('');

    // outlet rows
    var outHtml=a.outlets.map(function(o){
      var oColor=dotColor;
      var oName=_esc((o.outlet_id||'—').slice(0,38));
      // outlet sparkline (base vs curr)
      var oMax=Math.max(o.base_gmv||0,o.curr_gmv||0)||1;
      var obH=o.base_gmv>0?Math.max(2,Math.round(o.base_gmv/oMax*11)):1;
      var ocH=o.curr_gmv>0?Math.max(2,Math.round(o.curr_gmv/oMax*11)):1;
      return '<div class="qnrr-out-row">'+
        '<div class="qnrr-out-dot" style="background:'+oColor+'"></div>'+
        '<div class="qnrr-out-name">'+oName+'</div>'+
        '<div class="qnrr-out-spark">'+
          '<div class="qnrr-osb" style="height:'+obH+'px;background:rgba(38,96,200,.3)"></div>'+
          '<div class="qnrr-osb" style="height:'+ocH+'px;background:'+oColor+'"></div>'+
        '</div>'+
      '</div>';
    }).join('');

    var rowId='qnrr-r'+idx;
    return '<div class="qnrr-acct-row" onclick="_qnrrToggleAcct(\''+rowId+'\',this)">'+
      '<div class="qnrr-mv-dot" style="background:'+dotColor+'"></div>'+
      '<div class="qnrr-acct-left">'+
        '<div class="qnrr-acct-name">'+_esc(a.name||aid)+'</div>'+
        '<div class="qnrr-acct-tag" style="color:'+tagColor+'">'+_esc(a.type)+'</div>'+
      '</div>'+
      '<div class="qnrr-acct-right">'+
        '<div class="qnrr-spark" onmousemove="_qnrrSparkMove(event,this)" onmouseleave="_qnrrSparkLeave(this)">'+
          sbHtml+
          '<div class="qnrr-sp-tt"><div class="qnrr-tt-mo"></div><div class="qnrr-tt-v"></div></div>'+
        '</div>'+
        '<div class="qnrr-chev">›</div>'+
      '</div>'+
    '</div>'+
    '<div class="qnrr-outlet-wrap" id="qnrr-ow-'+rowId+'">'+outHtml+'</div>';
  }).join('');

  list.innerHTML=html;
}

})();
