// ── nrr_account.js — Account view (Phase C, 2026-07-09) pure logic ──────
// Feeds #/account/:id. Two SKU signal systems, ported from two DIFFERENT
// Sense functions — do not merge them, they answer different questions:
//   nrrSkuPositiveSignals — live "what's growing this month" (new/growing
//     SKUs), run-rate projected so a partial month is judged fairly.
//     Ported from __legacyRenderKamThisMonthFallback (05_kam_view.js:617-701).
//   nrrSkuCycleSignals — "what's overdue relative to ITS OWN normal
//     reorder cadence" (near/gone), interval-aware so a SKU normally
//     bought every 20 days isn't falsely flagged on day 8. Ported from
//     computeChurnSignals (05_kam_view.js:63-170) — only the 'gone'/'near'
//     branches; Sense also has 'approaching'/'not_yet'/'slow' which are
//     NOT ported here (out of scope for this phase, see plan doc).

var NRR_CAT_MASTER = [
  { n: 'DG Food', c: 'var(--cat-1)' }, { n: 'Processed Food', c: 'var(--cat-2)' },
  { n: 'Vegetable', c: 'var(--cat-3)' }, { n: 'Meat', c: 'var(--cat-4)' },
  { n: 'Fish & Seafood', c: 'var(--cat-5)' }, { n: 'Egg', c: 'var(--cat-6)' },
  { n: 'Fruit', c: 'var(--cat-7)' }, { n: 'Beverage Non-alcohol', c: 'var(--cat-8)' },
  { n: 'Beverage Alcohol', c: 'var(--cat-9)' }, { n: 'DG Non-food', c: 'var(--cat-10)' }
];
window.NRR_CAT_MASTER = NRR_CAT_MASTER;

// { cur, last } Thai month labels — same lag-1-day anchor convention as
// nrrCommCurrentMonthLabel() (nrr_commission.js) so "current month" agrees
// everywhere in the app.
function _nrrAccountMonthLabels() {
  var cur = nrrCommCurrentMonthLabel();
  var lag = new Date(); lag.setDate(lag.getDate() - 1);
  var last = nrrThMonthLabel(new Date(lag.getFullYear(), lag.getMonth() - 1, 1));
  return { cur: cur, last: last };
}

function _nrrPortviewRowFor(accountId) {
  var pv = window.bulkPortviewData;
  if (!pv || !pv.loaded) return null;
  return pv.allRows.filter(function (r) { return r.account_id === accountId; })[0] || null;
}

function _nrrSkusRowsForMonth(accountId, kamEmail, monthLabel) {
  var bundle = nrrSenseSkusCache[kamEmail];
  if (!bundle || !bundle.loaded) return [];
  return (bundle.byAccountId[accountId] || []).filter(function (r) { return r.month_label === monthLabel; });
}

// ── Positive signals — live, run-rate projected ──────────────────────────
function nrrSkuPositiveSignals(accountId, kamEmail) {
  var labels = _nrrAccountMonthLabels();
  var curRows = _nrrSkusRowsForMonth(accountId, kamEmail, labels.cur);
  var lastRows = _nrrSkusRowsForMonth(accountId, kamEmail, labels.last);
  var lastByItem = {};
  lastRows.forEach(function (r) { lastByItem[r.item_id] = r; });

  var acctRow = _nrrPortviewRowFor(accountId);
  var daysElapsed = (acctRow && acctRow.days_elapsed) || 1;
  var daysInMonth = (acctRow && acctRow.days_in_month) || 30;
  var ratio = daysElapsed > 0 ? daysInMonth / daysElapsed : 1;

  var newItems = [], growing = [];
  curRows.forEach(function (r) {
    var last = lastByItem[r.item_id];
    if (!last) {
      if (r.gmv_ex_vat > 1000) newItems.push({ item_id: r.item_id, name: r.item_name_th, gmv: r.gmv_ex_vat });
      return;
    }
    if (!last.gmv_ex_vat) return;
    var proj = r.gmv_ex_vat * ratio;
    var chgPct = (proj - last.gmv_ex_vat) / last.gmv_ex_vat;
    if (chgPct >= 0.20 && r.gmv_ex_vat > 2000) {
      growing.push({ item_id: r.item_id, name: r.item_name_th, gmvToDate: r.gmv_ex_vat, proj: proj, lastGmv: last.gmv_ex_vat, projInc: proj - last.gmv_ex_vat, chgPct: chgPct });
    }
  });
  newItems.sort(function (a, b) { return b.gmv - a.gmv; });
  growing.sort(function (a, b) { return b.projInc - a.projInc; });
  return { new: newItems, growing: growing };
}
window.nrrSkuPositiveSignals = nrrSkuPositiveSignals;

// ── Cycle signals — interval-aware, per-SKU, last month's own cadence ────
function nrrSkuCycleSignals(accountId, kamEmail) {
  var labels = _nrrAccountMonthLabels();
  var lastRows = _nrrSkusRowsForMonth(accountId, kamEmail, labels.last);
  var acctRow = _nrrPortviewRowFor(accountId);
  var daysElapsed = (acctRow && acctRow.days_elapsed) || 1;
  var daysInMonth = (acctRow && acctRow.days_in_month) || 30;

  var out = [];
  lastRows.forEach(function (r) {
    if (!r.order_count || r.order_count < 1) return; // need order history to derive a cycle at all
    var outletCount = r.outlet_count_sku || 1;
    var perOutletFreq = r.order_count / outletCount;
    if (perOutletFreq <= 0) return;
    var avgInterval = daysInMonth / perOutletFreq;
    var daysLate = Math.max(0, Math.round(daysElapsed - avgInterval));
    var cls = null;
    if (daysElapsed >= avgInterval * 1.5) cls = 'gone';
    else if (daysElapsed >= avgInterval) cls = 'near';
    if (!cls) return;
    out.push({
      item_id: r.item_id, name: r.item_name_th, monthlyGmv: r.gmv_ex_vat,
      orderCountLastMonth: r.order_count, avgInterval: avgInterval, daysLate: daysLate,
      cls: cls, lastOrderDate: r.last_order_date
    });
  });
  out.sort(function (a, b) { return b.monthlyGmv - a.monthlyGmv; });
  return out;
}
window.nrrSkuCycleSignals = nrrSkuCycleSignals;

// ── Per-outlet breakdown for the floating tooltip on a signal row ───────
function nrrSkuOutletBreakdown(accountId, itemId, kamEmail) {
  var bundle = nrrSenseSkuOutletCache[kamEmail];
  if (!bundle || !bundle.loaded) return null;
  var byItem = bundle.byAccountItem[accountId];
  return (byItem && byItem[String(itemId)]) || null;
}
window.nrrSkuOutletBreakdown = nrrSkuOutletBreakdown;

// ── AOV — current (live, from portview MTD) + historical band/trend ─────
function nrrAovBand(aov) {
  if (aov == null) return { cls: 'unknown', label: '—', color: 'var(--ink3)' };
  if (aov >= 5000) return { cls: 'great', label: 'ดีมาก', color: 'var(--green-deep)' };
  if (aov >= 3000) return { cls: 'good', label: 'ดี', color: 'var(--green)' };
  if (aov >= 1500) return { cls: 'mid', label: 'ปานกลาง', color: 'var(--sun-deep)' };
  return { cls: 'low', label: 'ควรดู', color: 'var(--coral)' };
}
window.nrrAovBand = nrrAovBand;

function nrrAccountAov(accountId) {
  var row = _nrrPortviewRowFor(accountId);
  var current = (row && row.orders_to_date > 0) ? row.gmv_to_date / row.orders_to_date : null;
  var hist = (window.bulkHistoryData && window.bulkHistoryData.byAccountId[accountId]) || [];
  var sorted = hist.slice().sort(function (a, b) { return (_nrrParseThLabel(a.month_label).key || 0) - (_nrrParseThLabel(b.month_label).key || 0); });
  var months = sorted.map(function (h) { return { month: h.month_label, aov: h.orders > 0 ? h.gmv / h.orders : null, orders: h.orders }; });
  var threeAgo = months.length >= 3 ? months[months.length - 3].aov : null;
  var trendPct = (current != null && threeAgo) ? Math.round((current / threeAgo - 1) * 100) : null;
  var lastMonth = months.length ? months[months.length - 1] : null;
  return {
    current: current, band: nrrAovBand(current), months: months, trendPct: trendPct,
    ordersThisMonth: row ? row.orders_to_date : 0,
    lastMonthAov: lastMonth ? lastMonth.aov : null, lastMonthOrders: lastMonth ? lastMonth.orders : 0
  };
}
window.nrrAccountAov = nrrAccountAov;

// ── Outlet movement + per-outlet cycle signal (Chain accounts) ──────────
function nrrOutletMovement(accountId) {
  var labels = _nrrAccountMonthLabels();
  var rows = (window.bulkOutletsData && window.bulkOutletsData.byAccountId[accountId]) || [];
  var curByOutlet = {}, lastByOutlet = {}, nameByOutlet = {};
  rows.forEach(function (r) {
    nameByOutlet[r.outlet_id] = r.outlet_name;
    if (r.month_label === labels.cur) curByOutlet[r.outlet_id] = r;
    if (r.month_label === labels.last) lastByOutlet[r.outlet_id] = r;
  });
  var acctRow = _nrrPortviewRowFor(accountId);
  var daysElapsed = (acctRow && acctRow.days_elapsed) || 1;
  var daysInMonth = (acctRow && acctRow.days_in_month) || 30;

  var list = Object.keys(nameByOutlet).map(function (oid) {
    var last = lastByOutlet[oid], cur = curByOutlet[oid];
    var status = (!last && cur) ? 'new' : (last && !cur) ? 'quiet' : 'steady';
    // Same interval math as nrrSkuCycleSignals, applied per-outlet instead
    // of per-SKU (Sense's computeOutletCycleSignals precedent) — cycles
    // under 3 days are excluded, matching Sense's own noise floor for
    // near-daily-ordering outlets where "overdue" stops being meaningful.
    var cycle = null;
    if (status === 'steady' && last && last.orders > 0) {
      var interval = daysInMonth / last.orders;
      if (interval >= 3) {
        if (daysElapsed >= interval * 1.5) cycle = 'gone';
        else if (daysElapsed >= interval) cycle = 'near';
      }
    }
    return {
      outlet_id: oid, outlet_name: nameByOutlet[oid], status: status, cycle: cycle,
      gmv: cur ? cur.gmv_ex_vat : 0, lastGmv: last ? last.gmv_ex_vat : 0,
      lastOrderDate: (cur && cur.last_order_date) || (last && last.last_order_date) || null
    };
  });

  var counts = { steady: 0, new: 0, quiet: 0 };
  list.forEach(function (o) {
    if (o.status === 'quiet' || o.cycle === 'gone') counts.quiet++;
    else if (o.status === 'new') counts.new++;
    else counts.steady++;
  });
  // sort quiet-first (most worth attention) then new, then steady
  var order = { quiet: 0, new: 1, steady: 2 };
  list.sort(function (a, b) { return (order[a.status] || 2) - (order[b.status] || 2); });
  return { outlets: list, counts: counts, total: list.length };
}
window.nrrOutletMovement = nrrOutletMovement;

// ── Category coverage — all 10 Freshket categories, gaps included ───────
function nrrAccountCategoryCoverage(accountId, kamEmail) {
  var catRows = (window.bulkCategoriesData && window.bulkCategoriesData.byAccountId[accountId]) || [];
  var labels = _nrrAccountMonthLabels();
  var hasCur = catRows.some(function (r) { return r.month_label === labels.cur; });
  var useLabel = hasCur ? labels.cur : labels.last; // early-month MTD may have zero category rows yet

  var byCat = {};
  catRows.forEach(function (r) { if (r.month_label === useLabel) byCat[r.category] = (byCat[r.category] || 0) + r.gmv; });
  var total = Object.keys(byCat).reduce(function (s, k) { return s + byCat[k]; }, 0);

  var skuBundle = nrrSenseSkusCache[kamEmail];
  var skuRows = (skuBundle && skuBundle.loaded && skuBundle.byAccountId[accountId]) || [];
  var skuCountByCat = {}, seenItem = {};
  skuRows.forEach(function (r) {
    if (r.month_label !== useLabel) return;
    var key = r.dept + '|' + r.item_id;
    if (seenItem[key]) return;
    seenItem[key] = true;
    skuCountByCat[r.dept] = (skuCountByCat[r.dept] || 0) + 1;
  });

  var categories = NRR_CAT_MASTER.map(function (c) {
    var gmv = byCat[c.n] || 0;
    return { name: c.n, color: c.c, bought: gmv > 0, gmv: gmv, pct: total > 0 ? Math.round(gmv / total * 100) : 0, skuCount: skuCountByCat[c.n] || 0 };
  });
  var boughtCount = categories.filter(function (c) { return c.bought; }).length;
  return { categories: categories, boughtCount: boughtCount, total: NRR_CAT_MASTER.length, monthUsed: useLabel };
}
window.nrrAccountCategoryCoverage = nrrAccountCategoryCoverage;

// ── Price impact — net ฿ effect of price changes this month vs last ─────
function nrrAccountPriceImpact(accountId, kamEmail) {
  var priceBundle = window.bulkPriceData;
  if (!priceBundle || !priceBundle.loaded) return null;
  var byItem = priceBundle.byAccountItem[accountId];
  if (!byItem) return { net: 0, up: [], down: [], upCount: 0, downCount: 0, hasCurrentData: false };

  var labels = _nrrAccountMonthLabels();
  var skuBundle = nrrSenseSkusCache[kamEmail];
  var skuRows = (skuBundle && skuBundle.loaded && skuBundle.byAccountId[accountId]) || [];
  var nameByItem = {}, qtyByItem = {};
  skuRows.forEach(function (r) {
    if (r.month_label === labels.cur) { nameByItem[r.item_id] = r.item_name_th; qtyByItem[r.item_id] = r.qty_kg; }
  });

  // bulk_price.csv is a closed-month batch export — it does not carry a
  // row for the in-progress month until the pipeline's month-end run
  // (confirmed 2026-07-09: file had zero "ก.ค. 2569" rows on day 9 of
  // July). Track that explicitly so the UI can say "รอข้อมูลปิดเดือน"
  // instead of a misleading "+฿0 ไม่มีการเปลี่ยนแปลง" that looks like a
  // verified zero when it's actually just missing data.
  var hasCurrentData = false;
  var up = [], down = [];
  Object.keys(byItem).forEach(function (itemId) {
    var rows = byItem[itemId];
    var curRow = rows.filter(function (r) { return r.month_label === labels.cur; })[0];
    if (curRow) hasCurrentData = true;
    var lastRow = rows.filter(function (r) { return r.month_label === labels.last; })[0];
    if (!curRow || !lastRow || !lastRow.unit_price) return;
    var pctChange = (curRow.unit_price - lastRow.unit_price) / lastRow.unit_price * 100;
    if (Math.abs(pctChange) < 1) return; // Sense's own ≥1% threshold (computePriceChanges)
    var qty = qtyByItem[itemId] || 0;
    var impact = (curRow.unit_price - lastRow.unit_price) * qty;
    var entry = { item_id: itemId, name: nameByItem[itemId] || itemId, pctChange: pctChange, impact: impact };
    if (pctChange > 0) up.push(entry); else down.push(entry);
  });
  up.sort(function (a, b) { return b.impact - a.impact; });
  down.sort(function (a, b) { return a.impact - b.impact; });
  var net = up.reduce(function (s, e) { return s + e.impact; }, 0) + down.reduce(function (s, e) { return s + e.impact; }, 0);
  return { net: net, up: up, down: down, upCount: up.length, downCount: down.length, hasCurrentData: hasCurrentData };
}
window.nrrAccountPriceImpact = nrrAccountPriceImpact;

// ── Net signal summary — the one-sentence verdict above the two lists ───
function nrrNetSignalSummary(accountId, kamEmail) {
  var pos = nrrSkuPositiveSignals(accountId, kamEmail);
  var risk = nrrSkuCycleSignals(accountId, kamEmail);
  var gain = pos.new.reduce(function (s, x) { return s + x.gmv; }, 0) + pos.growing.reduce(function (s, x) { return s + x.projInc; }, 0);
  var atRisk = risk.reduce(function (s, x) { return s + x.monthlyGmv; }, 0);
  var acctRow = _nrrPortviewRowFor(accountId);
  var runrate = acctRow ? acctRow.runrate_gmv : null;
  var netRunrate = runrate != null ? runrate + gain - atRisk : null;
  return {
    gainAmount: gain, gainCount: pos.new.length + pos.growing.length,
    riskAmount: atRisk, riskCount: risk.length,
    runrate: runrate, netRunrate: netRunrate
  };
}
window.nrrNetSignalSummary = nrrNetSignalSummary;
