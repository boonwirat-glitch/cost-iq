// Freshket Sense Report Renderer — Phase 15.
// Purpose: extract the first actual renderer path behind a legacy-safe adapter.
// Scope: Report screen only. Must not touch navigation, loader, auth, chat, or other renderers.
(function(global){
  'use strict';

  const VERSION = 'phase15-report-renderer';
  const BEHAVIOR_CHANGED = false;

  function now(){ return new Date().toISOString(); }
  function safe(fn, fallback){ try{ return fn(); }catch(e){ return fallback; } }
  function arr(v){ return Array.isArray(v) ? v : []; }
  function isSet(v){ return !!v && typeof v.has === 'function' && typeof v.size === 'number'; }
  function text(v){ return v == null ? '' : String(v); }
  function el(id){ return global.document && document.getElementById(id); }
  function setText(id, value){ const node = el(id); if(node) node.textContent = text(value); return !!node; }
  function setHTML(id, value){ const node = el(id); if(node) node.innerHTML = text(value); return !!node; }
  function call(fn, fallback){ return typeof fn === 'function' ? safe(fn, fallback) : fallback; }

  function contextFromLegacy(ctx){
    ctx = ctx || {};
    return {
      D: ctx.D || global.D || { meta:{}, history:[] },
      SAMPLE: ctx.SAMPLE || global.SAMPLE || { history:[] },
      OPPS: arr(ctx.OPPS || global.OPPS),
      sel: ctx.sel || global.sel || new Set(),
      getAlt: ctx.getAlt || global.getAlt,
      totalSel: ctx.totalSel || global.totalSel,
      fmt: ctx.fmt || global.fmt || function(v){ return String(v == null ? '' : v); }
    };
  }

  function selectedItems(c){
    const selected = c.sel;
    return arr(c.OPPS).filter(function(o){ return isSet(selected) ? selected.has(o.id) : false; })
      .sort(function(a,b){
        const aa = call(function(){ return c.getAlt(a); }, {});
        const bb = call(function(){ return c.getAlt(b); }, {});
        return Number(bb.save || 0) - Number(aa.save || 0);
      });
  }

  function viewModel(ctx){
    const c = contextFromLegacy(ctx);
    const D = c.D || {};
    const meta = D.meta || {};
    const hist = arr(D.history).length ? arr(D.history) : arr(c.SAMPLE.history);
    const last = hist[hist.length - 1] || { s:0, m:'' };
    const items = selectedItems(c);
    const save = call(function(){ return c.totalSel(); }, 0);
    return {
      accountName: meta.accountName || 'ร้านอาหาร',
      kamName: meta.kamName || '—',
      lastMonth: last.m || '—',
      dateStr: new Date().toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' }),
      selectedItems: items,
      selectedSave: save,
      context: c,
      ts: now()
    };
  }

  function renderRows(model){
    const c = model.context;
    if(!model.selectedItems.length){
      return '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--n400);font-size:12px">ยังไม่ได้เลือกรายการ — กลับไปหน้า Sense เพื่อเลือก</td></tr>';
    }
    return model.selectedItems.map(function(o,i){
      const a = call(function(){ return c.getAlt(o); }, {});
      const curPriceStr = o.curP > 0 ? c.fmt(o.curP) + '/' + o.curU : '—';
      const altPriceStr = a.altP > 0 ? c.fmt(a.altP) + '/' + a.altU : '—';
      const confHigh = a.conf === 'high';
      return '<tr>'+
        '<td class="rpt2-num">'+(i+1)+'</td>'+
        '<td><div class="rpt2-sku-name">'+text(o.curName)+'</div><div class="rpt2-sku-meta">#'+text(o.curId)+(o.curSpec?' · '+text(o.curSpec):'')+(curPriceStr!=='—'?' · '+curPriceStr:'')+'</div></td>'+
        '<td class="rpt2-arr">→</td>'+
        '<td><div class="rpt2-sku-name">'+text(a.altName)+'</div><div class="rpt2-sku-meta">#'+text(a.altId)+(a.altSpec?' · '+text(a.altSpec):'')+(altPriceStr!=='—'?' · '+altPriceStr:'')+'</div></td>'+
        '<td class="rpt2-save"><div class="rpt2-save-amt">'+c.fmt(a.save)+'</div><div class="rpt2-save-pct'+(confHigh?' high':'')+'">−'+text(a.pct)+'%</div></td>'+
      '</tr>';
    }).join('');
  }

  function renderTotal(model){
    const c = model.context;
    if(!model.selectedItems.length) return '';
    return '<tr class="rpt2-total-row">'+
      '<td colspan="4"><span class="rpt2-total-label">รวม '+model.selectedItems.length+' รายการ</span></td>'+
      '<td><div class="rpt2-total-amt">'+c.fmt(model.selectedSave)+'</div><div class="rpt2-total-yr">'+c.fmt(model.selectedSave*12)+' / ปี</div></td>'+
    '</tr>';
  }

  function renderFromLegacy(ctx){
    const model = viewModel(ctx);
    const c = model.context;

    setText('rpt2-acct', model.accountName);
    setText('rpt2-date', model.dateStr);
    setText('rpt2-kam', 'KAM: ' + model.kamName);
    setText('rpt2-sum-label', 'Sense หาวัตถุดิบที่ราคาคุ้มกว่าได้ ' + model.selectedItems.length + ' รายการ');
    setText('rpt2-sum-mo', c.fmt(model.selectedSave) + ' / เดือน');
    setText('rpt2-sum-yr', c.fmt(model.selectedSave*12) + ' / ปี');
    setHTML('rpt2-tbody', renderRows(model));
    setHTML('rpt2-tfoot', renderTotal(model));
    setText('rpt2-note', '* ประมาณการจากยอดซื้อและราคาสินค้า ' + model.lastMonth + ' — ตัวเลขจริงอาจต่างกันตามปริมาณและราคาที่เปลี่ยนแปลง');

    return { ok:true, renderer:VERSION, selectedCount:model.selectedItems.length, selectedSave:model.selectedSave, behaviorChanged:BEHAVIOR_CHANGED, ts:now() };
  }

  function validate(){
    const requiredIds = ['rpt2-acct','rpt2-date','rpt2-kam','rpt2-sum-label','rpt2-sum-mo','rpt2-sum-yr','rpt2-tbody','rpt2-tfoot','rpt2-note'];
    const ids = requiredIds.map(function(id){ return { id:id, exists:!!el(id) }; });
    return { ok: ids.every(function(x){ return x.exists; }), ids: ids, behaviorChanged: BEHAVIOR_CHANGED };
  }

  function diagnostics(){
    const rm = global.FreshketSenseReadModelRuntime || (global.FreshketSenseRuntime && global.FreshketSenseRuntime.readModel) || null;
    return {
      version: VERSION,
      behaviorChanged: BEHAVIOR_CHANGED,
      screen: 'report',
      readModelLoaded: !!rm,
      readModelReportAvailable: !!(rm && typeof rm.getViewModel === 'function'),
      validation: validate(),
      ts: now()
    };
  }

  function printDiagnostics(){
    const diag = diagnostics();
    try{
      console.log('Freshket report renderer diagnostics:', diag);
      if(diag.validation && diag.validation.ids) console.table(diag.validation.ids);
    }catch(e){}
    return diag;
  }

  const api = Object.freeze({
    version: VERSION,
    behaviorChanged: BEHAVIOR_CHANGED,
    viewModel: viewModel,
    renderFromLegacy: renderFromLegacy,
    validate: validate,
    diagnostics: diagnostics,
    printDiagnostics: printDiagnostics
  });

  const previousRuntime = global.FreshketSenseRuntime || {};
  const previousViews = previousRuntime.views || {};
  global.FreshketSenseRuntime = Object.assign({}, previousRuntime, { views: Object.assign({}, previousViews, { reportRenderer: api }) });
  global.FreshketSenseReportRenderer = api;
  global.getFreshketReportRendererSnapshot = diagnostics;
  global.printFreshketReportRendererDiagnostics = printDiagnostics;
})(window);
