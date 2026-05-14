// Freshket Sense Restaurant Overview Renderer — Phase 16.
// Purpose: extract the Restaurant Overview renderer behind a legacy-safe adapter.
// Scope: Restaurant Overview screen only. Must not touch navigation, loader, auth, chat, KAM, Portfolio, or Team renderers.
(function(global){
  'use strict';

  const VERSION = 'phase16-overview-renderer';
  const BEHAVIOR_CHANGED = false;

  function now(){ return new Date().toISOString(); }
  function safe(fn, fallback){ try{ return fn(); }catch(e){ return fallback; } }
  function arr(v){ return Array.isArray(v) ? v : []; }
  function el(id){ return global.document && document.getElementById(id); }
  function setDisplay(id, value){ const node=el(id); if(node) node.style.display=value; return !!node; }
  function call(fn, fallback){ return typeof fn === 'function' ? safe(fn, fallback) : fallback; }
  function setFlag(ctx, name, value){ if(ctx && typeof ctx.setFlag === 'function') return ctx.setFlag(name, value); return false; }
  function getFlag(ctx, name, fallback){ if(ctx && typeof ctx.getFlag === 'function') return ctx.getFlag(name); return fallback; }
  function fmtK(v){
    v = Number(v || 0);
    return v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? Math.round(v/1000)+'k' : String(Math.round(v));
  }

  function normalizeContext(ctx){
    ctx = ctx || {};
    return {
      D: ctx.D || global.D || { meta:{}, history:[], cats:[] },
      SAMPLE: ctx.SAMPLE || global.SAMPLE || { history:[], cats:[] },
      activeMonth: Number.isFinite(Number(ctx.activeMonth)) ? Number(ctx.activeMonth) : 0,
      helpers: {
        animN: ctx.animN,
        renderCatBars: ctx.renderCatBars,
        renderOverviewStats: ctx.renderOverviewStats,
        renderInterpretation: ctx.renderInterpretation,
        renderPaceAndStrip: ctx.renderPaceAndStrip,
        setSenseGateState: ctx.setSenseGateState
      },
      getFlag: ctx.getFlag,
      setFlag: ctx.setFlag
    };
  }

  function resetSenseUi(ctx){
    const raBtn = el('rest-ai-btn');
    const raLoad = el('rest-ai-load');
    const raPreview = el('rest-ai-preview');
    if(raBtn){ raBtn.classList.remove('loading','done'); raBtn.style.opacity=''; }
    if(raLoad){
      raLoad.style.display='none';
      ['ras-1','ras-2','ras-3','ras-4'].forEach(function(id){ const s=el(id); if(s) s.classList.remove('vis'); });
    }
    if(raPreview) raPreview.style.display='none';

    setFlag(ctx, 'aiCameFromPreview', false);
    setFlag(ctx, 'senseActivated', false);
    setFlag(ctx, 'footerUnlocked', false);
    setFlag(ctx, 'sgRunning', false);

    setDisplay('srh-bridge', 'none');
    setDisplay('sense-gate', 'none');
    call(ctx.helpers.setSenseGateState, null) && ctx.helpers.setSenseGateState('standby');

    const oppHdr = el('opphdr'); if(oppHdr) oppHdr.classList.remove('ai-active');
    const dsvg = el('dial-svg'); if(dsvg) dsvg.classList.remove('sense-loading');
    setDisplay('dial-standby-overlay', 'flex');
    setDisplay('sense-done-wrap', 'none');
    const dWrap = el('dial-clickwrap');
    if(dWrap){ dWrap.classList.remove('sense-done'); dWrap.style.pointerEvents=''; }
  }

  function renderTrendBars(ctx, hist, currentMonth){
    const tbars = el('tbars');
    if(!tbars) return false;
    const maxValue = Math.max.apply(Math, hist.map(function(h){ return Number(h.s || 0); }).concat([currentMonth ? Number(currentMonth.gmv_to_date || 0) : 0, 1]));
    const currentBar = currentMonth && currentMonth.gmv_to_date > 0
      ? '<div class="tbw" id="bar-cm" style="cursor:default"><span class="tba" style="color:var(--g700)">'+fmtK(currentMonth.gmv_to_date)+'</span><div class="tb" style="--bh:'+Math.round((currentMonth.gmv_to_date/maxValue)*50)+'px;--bar-i:'+hist.length+';height:'+Math.round((currentMonth.gmv_to_date/maxValue)*50)+'px;background:var(--g500);opacity:.5;border:1.5px dashed var(--g700);box-sizing:border-box"></div><span class="tbl" style="color:var(--g700);font-weight:700">'+String(currentMonth.month_label||'').split(' ')[0]+'</span></div>'
      : '';
    tbars.innerHTML = hist.map(function(h,i){
      return '<div class="tbw" id="bar-'+i+'" onclick="selectMonth('+i+')"><span class="tba" id="tba-'+i+'">'+fmtK(h.s)+'</span><div class="tb" id="tb-'+i+'" style="--bh:'+Math.round((h.s/maxValue)*50)+'px;--bar-i:'+i+';height:'+Math.round((h.s/maxValue)*50)+'px;background:var(--n200)"></div><span class="tbl">'+String(h.m||'').split(' ')[0]+'</span></div>';
    }).join('') + currentBar;
    return true;
  }

  function renderHeroCurrentMonth(ctx, currentMonth){
    if(currentMonth && currentMonth.gmv_to_date > 0){
      setFlag(ctx, 'heroLockedToCurrent', true);
      const hSpend = el('hspend');
      const hMLbl = el('hMonthLabel');
      const hOrd = el('hOrders');
      const momEl = el('hero-mom');
      if(hSpend) call(ctx.helpers.animN, function(){ hSpend.textContent = String(Math.round(currentMonth.gmv_to_date || 0)); }) && ctx.helpers.animN(hSpend, currentMonth.gmv_to_date, 1200);
      if(hMLbl) hMLbl.textContent = currentMonth.month_label || '';
      if(hOrd){ hOrd.textContent=''; hOrd.style.display='none'; }
      if(momEl) momEl.style.display='none';
    } else {
      setFlag(ctx, 'heroLockedToCurrent', false);
    }
  }

  function renderCategories(ctx, cats){
    const cb = el('catbars');
    if(cb){
      if(typeof ctx.helpers.renderCatBars === 'function') cb.innerHTML = ctx.helpers.renderCatBars(cats, 3);
      else cb.innerHTML = '';
    }
    const catSec = el('overview-cats-sec');
    if(catSec) catSec.style.display = (cats && cats.length) ? '' : 'none';
  }

  function renderFromLegacy(input){
    const ctx = normalizeContext(input);
    const D = ctx.D || {};
    const SAMPLE = ctx.SAMPLE || {};
    resetSenseUi(ctx);

    const hist = arr(D.history).length ? arr(D.history) : arr(SAMPLE.history);
    const currentMonth = D.current_month || null;
    renderTrendBars(ctx, hist, currentMonth);
    renderHeroCurrentMonth(ctx, currentMonth);

    const cats = arr(D.cats).length ? arr(D.cats) : arr(SAMPLE.cats);
    renderCategories(ctx, cats);

    if(typeof ctx.helpers.renderOverviewStats === 'function') ctx.helpers.renderOverviewStats(ctx.activeMonth);
    if(typeof ctx.helpers.renderInterpretation === 'function') ctx.helpers.renderInterpretation(ctx.activeMonth);
    if(typeof ctx.helpers.renderPaceAndStrip === 'function') ctx.helpers.renderPaceAndStrip();

    return {
      ok: true,
      renderer: VERSION,
      screen: 'overview',
      historyCount: hist.length,
      categoryCount: cats.length,
      currentMonth: !!(currentMonth && currentMonth.gmv_to_date > 0),
      behaviorChanged: BEHAVIOR_CHANGED,
      ts: now()
    };
  }

  function validate(){
    const requiredIds = ['scr-overview','tbars','hspend','hMonthLabel','hOrders','catbars','overview-cats-sec','overview-stats','interp-strip-wrap','hero-pace-wrap','ov-price-strip-wrap'];
    const ids = requiredIds.map(function(id){ return { id:id, exists:!!el(id) }; });
    return { ok: ids.every(function(x){ return x.exists; }), ids: ids, behaviorChanged: BEHAVIOR_CHANGED };
  }

  function diagnostics(){
    const rm = global.FreshketSenseReadModelRuntime || (global.FreshketSenseRuntime && global.FreshketSenseRuntime.readModel) || null;
    return {
      version: VERSION,
      behaviorChanged: BEHAVIOR_CHANGED,
      screen: 'overview',
      readModelLoaded: !!rm,
      readModelOverviewAvailable: !!(rm && typeof rm.getViewModel === 'function'),
      validation: validate(),
      ts: now()
    };
  }

  function printDiagnostics(){
    const diag = diagnostics();
    try{
      console.log('Freshket overview renderer diagnostics:', diag);
      if(diag.validation && diag.validation.ids) console.table(diag.validation.ids);
    }catch(e){}
    return diag;
  }

  const api = Object.freeze({
    version: VERSION,
    behaviorChanged: BEHAVIOR_CHANGED,
    renderFromLegacy: renderFromLegacy,
    validate: validate,
    diagnostics: diagnostics,
    printDiagnostics: printDiagnostics
  });

  const previousRuntime = global.FreshketSenseRuntime || {};
  const previousViews = previousRuntime.views || {};
  global.FreshketSenseRuntime = Object.assign({}, previousRuntime, { views: Object.assign({}, previousViews, { overviewRenderer: api }) });
  global.FreshketSenseOverviewRenderer = api;
  global.getFreshketOverviewRendererSnapshot = diagnostics;
  global.printFreshketOverviewRendererDiagnostics = printDiagnostics;
})(window);
