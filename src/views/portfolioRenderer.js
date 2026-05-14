// Freshket Sense Portfolio / SKU Renderer — Phase 17.
// Purpose: extract the Restaurant Portfolio/SKU renderer behind a legacy-safe adapter.
// Scope: Restaurant Portfolio screen + SKU list only. Must not touch navigation, loader, auth, chat, KAM, or Team renderers.
(function(global){
  'use strict';

  const VERSION = 'phase17-portfolio-sku-renderer';
  const BEHAVIOR_CHANGED = false;

  function now(){ return new Date().toISOString(); }
  function safe(fn, fallback){ try{ return fn(); }catch(e){ return fallback; } }
  function arr(v){ return Array.isArray(v) ? v : []; }
  function el(id){ return global.document && document.getElementById(id); }
  function call(fn, fallback){ return typeof fn === 'function' ? safe(fn, fallback) : fallback; }
  function text(v){ return v == null ? '' : String(v); }

  function monthSort(m){
    const p=text(m).split(' ');
    const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return (parseInt(p[1]||0)*12)+mo.indexOf(p[0]);
  }

  function normalizeContext(ctx){
    ctx = ctx || {};
    return {
      D: ctx.D || global.D || { history:[], cats:[], skus:[], skus_monthly:{}, cats_monthly:{} },
      SAMPLE: ctx.SAMPLE || global.SAMPLE || { history:[], cats:[], skus:[] },
      OPPS: arr(ctx.OPPS || global.OPPS),
      portfolioMonth: ctx.portfolioMonth || '',
      skuFilter: ctx.skuFilter || 'ทั้งหมด',
      priceMovFilter: ctx.priceMovFilter || null,
      skuView: ctx.skuView || 'gmv',
      setState: ctx.setState,
      helpers: {
        fmt: ctx.fmt || global.fmt || function(v){ return String(v == null ? '' : v); },
        computePriceChanges: ctx.computePriceChanges || global.computePriceChanges,
        computeSkuMovement: ctx.computeSkuMovement || global.computeSkuMovement,
        renderSparkline: ctx.renderSparkline || global.renderSparkline,
        renderPortMoMInsight: ctx.renderPortMoMInsight || global.renderPortMoMInsight,
        expandPortTop: ctx.expandPortTop || global._expandPortTop
      }
    };
  }

  function setLegacyState(ctx, name, value){
    if(ctx && typeof ctx.setState === 'function') return ctx.setState(name, value);
    return false;
  }

  function resolvePortfolioMonth(ctx, moKeys){
    let m = ctx.portfolioMonth;
    if(!m || moKeys.indexOf(m) < 0){
      m = moKeys[0] || '';
      setLegacyState(ctx, 'portfolioMonth', m);
    }
    return m;
  }

  function renderSKUListFromLegacy(input, passedSkus){
    const ctx = normalizeContext(input);
    const D = ctx.D || {};
    const SAMPLE = ctx.SAMPLE || {};
    const h = ctx.helpers;
    const rawSkus = passedSkus || (ctx.portfolioMonth && D.skus_monthly && D.skus_monthly[ctx.portfolioMonth]
      ? D.skus_monthly[ctx.portfolioMonth]
      : (arr(D.skus).length ? D.skus : arr(SAMPLE.skus)));
    const skus = arr(rawSkus).slice().sort(function(a,b){ return (Number(b.gmv||b.s||0)) - (Number(a.gmv||a.s||0)); });
    const search = (el('skuSearch') && el('skuSearch').value || '').toLowerCase();
    let filtered = skus;
    if(ctx.skuFilter !== 'ทั้งหมด') filtered = filtered.filter(function(s){ return s.d === ctx.skuFilter; });
    if(search) filtered = filtered.filter(function(s){ return text(s.n).toLowerCase().indexOf(search) >= 0; });
    if(ctx.priceMovFilter){
      const pcMap2 = {};
      arr(call(h.computePriceChanges, [])).forEach(function(p){ pcMap2[String(p.id)] = p; });
      filtered = filtered.filter(function(s){
        const pc = pcMap2[String(s.id)];
        const pct = pc ? pc.pct : 0;
        if(ctx.priceMovFilter === 'up') return pc && pct >= 1;
        if(ctx.priceMovFilter === 'down') return pc && pct <= -1;
        if(ctx.priceMovFilter === 'stable') return !pc || (pct > -1 && pct < 1);
        return true;
      });
    }
    const totalCount = el('sku-total-count');
    const showingCount = el('sku-showing-count');
    if(totalCount) totalCount.textContent = skus.length + ' รายการ';
    if(showingCount) showingCount.textContent = 'แสดง ' + filtered.length + ' รายการ' + (search || ctx.skuFilter !== 'ทั้งหมด' || ctx.priceMovFilter ? ' (filtered)' : '');

    const priceChanges = arr(call(h.computePriceChanges, []));
    const pcMap = {}; priceChanges.forEach(function(p){ pcMap[String(p.id)] = p; });
    const oppIds = new Set(ctx.OPPS.map(function(o){ return String(o.curId); }));
    const skuMov = call(h.computeSkuMovement, { newSkus:[], declining:[] }) || { newSkus:[], declining:[] };
    const newIds = new Set(arr(skuMov.newSkus).map(function(s){
      const found = arr(rawSkus).find(function(r){ return r.n === s.name; });
      return found ? String(found.id) : '';
    }).filter(Boolean));
    const declIds = new Set(arr(skuMov.declining).map(function(s){
      const found = arr(rawSkus).find(function(r){ return r.n === s.name; });
      return found ? String(found.id) : '';
    }).filter(Boolean));
    const sortedMoKeys = Object.keys(D.skus_monthly || {}).sort(function(a,b){ return monthSort(a)-monthSort(b); });
    const list = el('skulist');
    if(!list) return { ok:false, reason:'missing #skulist', renderer:VERSION, behaviorChanged:BEHAVIOR_CHANGED, ts:now() };

    list.innerHTML = filtered.map(function(s){
      const origRank = skus.findIndex(function(x){ return x.id === s.id; }) + 1;
      const rankClass = origRank === 1 ? 'top1' : origRank === 2 ? 'top2' : origRank === 3 ? 'top3' : origRank <= 5 ? 'top5' : '';
      const sid = String(s.id);
      let badges = '';
      const pc = pcMap[sid];
      if(newIds.has(sid)){
        badges += '<span class="skbadge skbadge-new">เพิ่งเริ่มสั่ง</span>';
      } else if(pc){
        if(pc.pct > 0) badges += '<span class="skbadge skbadge-price-up">▲ ' + Math.abs(pc.pct).toFixed(1) + '% vs เดือนก่อน</span>';
        else badges += '<span class="skbadge skbadge-price-dn">▼ ' + Math.abs(pc.pct).toFixed(1) + '% vs เดือนก่อน</span>';
      } else if(declIds.has(sid)){
        badges += '<span class="skbadge skbadge-anomaly">สั่งลดลง</span>';
      }
      if(oppIds.has(sid)) badges += '<span class="skbadge skbadge-opp">มีตัวเลือก</span>';
      const badgeRow = badges ? '<div class="sku-badge-row">' + badges + '</div>' : '';
      const price = (s.display_price || s.u || 0);
      const priceText = '฿' + Number(price).toFixed(s.display_price >= 100 ? 0 : 2) + '/' + (s.display_unit || 'กก.');
      if(ctx.skuView === 'price'){
        const spark = typeof h.renderSparkline === 'function' ? h.renderSparkline(sid, sortedMoKeys, 64, 22) : '<span style="font-size:9px;color:var(--n300)">—</span>';
        return '<div class="skrow" style="cursor:pointer;-webkit-tap-highlight-color:rgba(0,0,0,.04)" onclick="openSkuDetail(\'' + sid + '\')">' +
          '<div class="skrk ' + rankClass + '">' + origRank + '</div>' +
          '<div style="flex:1;min-width:0"><div class="skn">' + text(s.n) + '</div><div class="skc">' + text(s.d) + (s.pack_size ? ' · ' + text(s.pack_size) : '') + ' · ' + priceText + '</div>' + badgeRow + '</div>' +
          '<div style="flex-shrink:0;display:flex;align-items:center;padding-left:8px">' + spark + '</div>' +
        '</div>';
      }
      return '<div class="skrow"><div class="skrk ' + rankClass + '">' + origRank + '</div><div style="flex:1;min-width:0"><div class="skn">' + text(s.n) + '</div><div class="skc">' + text(s.d) + (s.pack_size ? ' · ' + text(s.pack_size) : '') + ' · ' + priceText + '</div>' + badgeRow + '</div><div style="flex-shrink:0"><div class="sksp">' + h.fmt(s.s) + '</div><div class="skpc">' + text(s.p) + '%</div></div></div>';
    }).join('') || '<div style="padding:20px;text-align:center;color:var(--n400);font-size:13px">ไม่พบสินค้า</div>';

    return { ok:true, renderer:VERSION, screen:'portfolio-sku-list', rawCount:skus.length, filteredCount:filtered.length, behaviorChanged:BEHAVIOR_CHANGED, ts:now() };
  }

  function renderPortfolioFromLegacy(input){
    const ctx = normalizeContext(input);
    const D = ctx.D || {};
    const SAMPLE = ctx.SAMPLE || {};
    const h = ctx.helpers;
    const hist = arr(D.history).length ? arr(D.history) : arr(SAMPLE.history);
    const moKeys = D.skus_monthly && Object.keys(D.skus_monthly).length ? Object.keys(D.skus_monthly).sort(function(a,b){ return monthSort(b)-monthSort(a); }) : [];
    const portfolioMonth = resolvePortfolioMonth(ctx, moKeys);
    ctx.portfolioMonth = portfolioMonth;

    const barEl = el('port-month-bar');
    if(barEl){
      if(moKeys.length > 1){
        barEl.innerHTML = moKeys.map(function(m){ return '<button class="mopill ' + (m === portfolioMonth ? 'on' : '') + '" onclick="setPortfolioMonth(\'' + m + '\',this)">' + m + '</button>'; }).join('');
        barEl.style.display = 'flex';
      } else {
        barEl.style.display = 'none';
      }
    }
    const labelEl = el('port-month-label');
    if(labelEl) labelEl.textContent = portfolioMonth || '';

    const skus = (portfolioMonth && D.skus_monthly && D.skus_monthly[portfolioMonth])
      ? arr(D.skus_monthly[portfolioMonth]).slice().sort(function(a,b){ return (Number(b.gmv||0))-(Number(a.gmv||0)); })
      : (arr(D.skus).length ? D.skus : arr(SAMPLE.skus));
    const cats = (portfolioMonth && D.cats_monthly && D.cats_monthly[portfolioMonth])
      ? D.cats_monthly[portfolioMonth]
      : (arr(D.cats).length ? D.cats : arr(SAMPLE.cats));

    const histRow = hist.find(function(hh){ return hh.m === portfolioMonth; }) || hist[hist.length-1] || { s:176249, orders:58 };
    const last = histRow;
    const top5 = arr(skus).slice(0,5);
    const top5gmv = top5.reduce(function(s,x){ return s + Number(x.gmv || x.s || 0); }, 0);
    const top5pct = last.s > 0 ? (top5gmv / last.s * 100).toFixed(1) : '0';

    const topPctNum = parseFloat(top5pct) || 0;
    const conInterp = topPctNum > 70 ? 'พึ่งพาสินค้าหลักสูง — ถ้า SKU เหล่านี้ขาดหรือราคาขึ้น กระทบยอดทันที' : topPctNum >= 50 ? 'พอร์ตกระจายพอสมควร — ยังมี SKU อื่นรองรับหากสินค้าหลักขาด' : 'พอร์ตกระจายดี — ไม่พึ่งพาสินค้าใดสินค้าหนึ่งมากเกินไป';
    const topSkuEl = el('top-sku-card');
    if(topSkuEl){
      const conBg = topPctNum > 70 ? 'var(--amb50)' : topPctNum < 50 ? 'var(--g50)' : 'var(--n50)';
      const conBorder = topPctNum > 70 ? 'var(--amb)' : topPctNum < 50 ? 'var(--g500)' : 'var(--n200)';
      const conTextColor = topPctNum > 70 ? '#9a6500' : topPctNum < 50 ? 'var(--g700)' : 'var(--n600)';
      const conNumColor = topPctNum > 70 ? 'var(--amb)' : topPctNum < 50 ? 'var(--g500)' : 'var(--n400)';
      topSkuEl.style.cssText = 'background:' + conBg + ';border-left:3px solid ' + conBorder + ';border-radius:0 var(--rs) var(--rs) 0;padding:10px 12px;margin-bottom:12px;display:block;box-shadow:none';
      topSkuEl.innerHTML = '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><span style="font-size:10px;font-weight:700;letter-spacing:.5px;color:var(--n400);text-transform:uppercase">Top 5</span><span style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;font-weight:700;color:' + conNumColor + '">' + top5pct + '%</span></div><div style="font-size:12px;color:' + conTextColor + ';line-height:1.5;font-weight:500">' + conInterp + '</div>';
    }

    const depts = ['ทั้งหมด'].concat(Array.from(new Set(arr(skus).map(function(s){ return s.d; }))));
    const catFilter = el('skuCatFilter');
    if(catFilter) catFilter.innerHTML = depts.map(function(d){ return '<button class="fpill ' + (d === 'ทั้งหมด' && !ctx.priceMovFilter ? 'on' : '') + '" onclick="setSkuFilter(\'' + text(d).replace(/'/g,"\\'") + '\',this)">' + text(d) + '</button>'; }).join('');

    const priceRow = el('sku-price-filter-row');
    let priceUp=0, priceDn=0, priceStable=0, netPriceImpact=0;
    const moKeysSortedD = Object.keys(D.skus_monthly || {}).sort(function(a,b){ return monthSort(b)-monthSort(a); });
    const portMoIdx = moKeysSortedD.indexOf(portfolioMonth);
    const prevPortMo = portMoIdx >= 0 && portMoIdx < moKeysSortedD.length-1 ? moKeysSortedD[portMoIdx+1] : null;
    if(portfolioMonth && prevPortMo && D.skus_monthly && D.skus_monthly[portfolioMonth] && D.skus_monthly[prevPortMo]){
      const curPM = {}; arr(D.skus_monthly[portfolioMonth]).forEach(function(s){ curPM[String(s.id)] = { p:s.unit_price||s.u||0, q:s.qty_kg||0 }; });
      const prevPM = {}; arr(D.skus_monthly[prevPortMo]).forEach(function(s){ prevPM[String(s.id)] = { p:s.unit_price||s.u||0, q:s.qty_kg||0 }; });
      Object.keys(curPM).forEach(function(id){
        const c=curPM[id], pv=prevPM[id];
        if(!c.p || !pv || !pv.p) return;
        const pct=(c.p-pv.p)/pv.p*100;
        if(pct>=1) priceUp++; else if(pct<=-1) priceDn++; else priceStable++;
        netPriceImpact += (pv.q || c.q) * (c.p - pv.p);
      });
    }
    const priceTotal = priceUp + priceDn;
    if(priceRow){
      priceRow.innerHTML = priceTotal > 0
        ? (priceUp > 0 ? '<button class="fpill fpill-pu ' + (ctx.priceMovFilter === 'up' ? 'on' : '') + '" id="pf-pill-up" onclick="setPriceFilter(\'up\')">▲ ' + priceUp + ' ราคาขึ้น</button>' : '') +
          (priceDn > 0 ? '<button class="fpill fpill-pd ' + (ctx.priceMovFilter === 'down' ? 'on' : '') + '" id="pf-pill-dn" onclick="setPriceFilter(\'down\')">▼ ' + priceDn + ' ราคาลง</button>' : '')
        : '';
      priceRow.style.display = priceTotal > 0 ? 'flex' : 'none';
    }

    const skuResult = renderSKUListFromLegacy(ctx, skus);
    if(typeof h.renderPortMoMInsight === 'function') h.renderPortMoMInsight();
    if(typeof h.expandPortTop === 'function') h.expandPortTop();

    return {
      ok:true,
      renderer:VERSION,
      screen:'portfolio',
      portfolioMonth:portfolioMonth,
      skuCount:arr(skus).length,
      categoryCount:arr(cats).length,
      top5pct:top5pct,
      skuList:skuResult,
      behaviorChanged:BEHAVIOR_CHANGED,
      ts:now()
    };
  }

  function validate(){
    const requiredIds = ['scr-portfolio','port-month-bar','port-month-label','top-sku-card','skuCatFilter','sku-price-filter-row','sku-total-count','sku-showing-count','skulist','skuSearch'];
    const ids = requiredIds.map(function(id){ return { id:id, exists:!!el(id) }; });
    return { ok: ids.every(function(x){ return x.exists; }), ids: ids, behaviorChanged: BEHAVIOR_CHANGED };
  }

  function diagnostics(){
    const rm = global.FreshketSenseReadModelRuntime || (global.FreshketSenseRuntime && global.FreshketSenseRuntime.readModel) || null;
    return {
      version: VERSION,
      behaviorChanged: BEHAVIOR_CHANGED,
      screen: 'portfolio',
      readModelLoaded: !!rm,
      readModelPortfolioAvailable: !!(rm && typeof rm.getViewModel === 'function'),
      validation: validate(),
      ts: now()
    };
  }

  function printDiagnostics(){
    const diag = diagnostics();
    try{
      console.log('Freshket portfolio/SKU renderer diagnostics:', diag);
      if(diag.validation && diag.validation.ids) console.table(diag.validation.ids);
    }catch(e){}
    return diag;
  }

  const api = Object.freeze({
    version: VERSION,
    behaviorChanged: BEHAVIOR_CHANGED,
    renderPortfolioFromLegacy: renderPortfolioFromLegacy,
    renderSKUListFromLegacy: renderSKUListFromLegacy,
    validate: validate,
    diagnostics: diagnostics,
    printDiagnostics: printDiagnostics
  });

  const previousRuntime = global.FreshketSenseRuntime || {};
  const previousViews = previousRuntime.views || {};
  global.FreshketSenseRuntime = Object.assign({}, previousRuntime, { views: Object.assign({}, previousViews, { portfolioRenderer: api }) });
  global.FreshketSensePortfolioRenderer = api;
  global.getFreshketPortfolioRendererSnapshot = diagnostics;
  global.printFreshketPortfolioRendererDiagnostics = printDiagnostics;
})(window);
