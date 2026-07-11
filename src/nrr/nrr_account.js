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

// Shared month-over-month item diff — nrrSkuPositiveSignals, nrrSkuCycleSignals
// and nrrSkuSwapPairs all read from this ONE computation instead of each
// rebuilding curByItem/lastByItem independently, so they can never drift
// apart on what counts as "new"/"dropped" this month.
function nrrSkuMonthDiff(accountId, kamEmail) {
  var labels = _nrrAccountMonthLabels();
  var curRows = _nrrSkusRowsForMonth(accountId, kamEmail, labels.cur);
  var lastRows = _nrrSkusRowsForMonth(accountId, kamEmail, labels.last);
  var curByItem = {}, lastByItem = {};
  curRows.forEach(function (r) { curByItem[r.item_id] = r; });
  lastRows.forEach(function (r) { lastByItem[r.item_id] = r; });
  // Dropped = ordered last month, no row at all this month. Small noise
  // floor (฿300) so a one-off trivial last-month purchase doesn't generate
  // a swap candidate — the signal lists' own display thresholds (below)
  // are separate and unaffected by this floor.
  var droppedItems = lastRows.filter(function (r) { return !curByItem[r.item_id] && r.gmv_ex_vat > 300; });

  // Items present both months with meaningful projected growth — same
  // rule nrrSkuPositiveSignals uses for its own "growing" bucket (>=20%
  // projected run-rate vs last month, current GMV>2000), computed once
  // here so the swap detector can ALSO consider these as swap-partner
  // candidates (2026-07-11: a real production account showed a dropped
  // SKU's volume landing on an ALREADY-EXISTING sibling pack size that
  // was simply growing, not a brand-new item — the swap detector's
  // original "dropped + genuinely new only" scope missed this).
  var acctRow = _nrrPortviewRowFor(accountId);
  var daysElapsed = (acctRow && acctRow.days_elapsed) || 1;
  var daysInMonth = (acctRow && acctRow.days_in_month) || 30;
  var ratio = daysElapsed > 0 ? daysInMonth / daysElapsed : 1;
  var growingItems = [];
  curRows.forEach(function (r) {
    var last = lastByItem[r.item_id];
    if (!last || !last.gmv_ex_vat) return;
    var proj = r.gmv_ex_vat * ratio;
    var chgPct = (proj - last.gmv_ex_vat) / last.gmv_ex_vat;
    if (chgPct >= 0.20 && r.gmv_ex_vat > 2000) growingItems.push(r);
  });

  return { curRows: curRows, lastRows: lastRows, curByItem: curByItem, lastByItem: lastByItem, droppedItems: droppedItems, growingItems: growingItems };
}
window.nrrSkuMonthDiff = nrrSkuMonthDiff;

// ── SKU swap detection — rule-based, NO AI (ported from Sense's own
// deterministic "SKU Verify" fallback scorer, src/05_kam_view.js:3096-3167 —
// same thresholds, same Thai stopword list, same form-conflict rules).
// Runs automatically on every Account page render, narrowed to a SINGLE
// high-confidence tier (no medium/annotate tier — a match either moves out
// of the risk/opportunity lists entirely, or it isn't treated as a swap at
// all): egg-grade-number match, OR same family (subclass) + name similarity
// >=0.4 + no form conflict + comparable quantity.
//
// Sense's version is human-reviewed (a KAM eyeballs each pair before it
// affects anything visible); this version runs unsupervised and reshapes
// real risk/opportunity numbers, so it adds one gate Sense's doesn't need:
// magnitude comparability. Decided 2026-07-11 (see plan doc) to gate this
// on QUANTITY (qty_kg), not GMV — a genuine pack-size swap (1kg pack -> 5kg
// pack, same product) keeps roughly the same purchased volume while its
// GMV can legitimately jump 4-5x, so a GMV-based gate would wrongly reject
// real pack-size swaps. Falls back to a GMV-ratio check only when qty_kg
// is missing/zero on either side.
var _NRR_SKU_TH_DIGITS = { '๐':'0','๑':'1','๒':'2','๓':'3','๔':'4','๕':'5','๖':'6','๗':'7','๘':'8','๙':'9' };
function _nrrSkuToAsciiDigits(s) {
  return String(s || '').replace(/[๐-๙]/g, function (d) { return _NRR_SKU_TH_DIGITS[d] || d; });
}
function _nrrSkuNormName(s) {
  return _nrrSkuToAsciiDigits(s).toLowerCase()
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[·•|,:;_\-/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function _nrrSkuCompact(s) { return _nrrSkuNormName(s).replace(/\s+/g, ''); }
function _nrrSkuEggKey(name) {
  var n = _nrrSkuNormName(name), c = _nrrSkuCompact(name);
  if (n.indexOf('ไข่') < 0 && c.indexOf('egg') < 0) return '';
  var m = n.match(/เบอร์\s*(\d+)/) || c.match(/เบอร์(\d+)/) || n.match(/no\.?\s*(\d+)/) || c.match(/no(\d+)/);
  if (m && m[1]) return 'egg:no' + m[1];
  if (c.indexOf('เบอร์หนึ่ง') >= 0) return 'egg:no1';
  return 'egg:unknown';
}
function _nrrSkuFamilyKey(name, subclass) {
  var e = _nrrSkuEggKey(name);
  if (e && e !== 'egg:unknown') return e;
  var sub = _nrrSkuNormName(subclass || '');
  return sub ? 'sub:' + sub : '';
}
// Generic preservation-state/quality/sourcing qualifiers — describe HOW a
// product is kept/graded/sourced, not WHAT it is, so they must not count
// toward name similarity. Added 2026-07-11 after a real false positive:
// "ปีกไก่กลาง (แช่แข็ง) ตราเบทาโกร" (frozen chicken wing) matched "ขาไก่
// (ตัดเล็บ) (แช่แข็ง)" (frozen chicken leg) as a "swap" — the ONLY token
// the two names shared was "แช่แข็ง" (frozen), a word that appears on
// countless unrelated frozen products. formConflict's frozen/แช่แข็ง group
// doesn't catch this: it only fires on a MISMATCH (one frozen, one not),
// not when both sides share the same generic state word. This is a
// curated list, not a provably complete one — extend it if further
// mismatches like this turn up in real use (see plan doc).
var _NRR_SKU_QUALIFIER_STOPWORDS = [
  'แช่แข็ง', 'frozen', 'แช่เย็น', 'chilled', 'สด', 'ทั้งตัว', 'คัดพิเศษ',
  'เกรดเอ', 'เกรด', 'ออร์แกนิค', 'ตัดแต่ง', 'นำเข้า'
];
function _nrrSkuTokens(name) {
  return _nrrSkuNormName(name).split(' ').filter(function (t) {
    return t && !/^\d+$/.test(t) && ['ตรา', 'brand', 'ยี่ห้อ'].indexOf(t) === -1
      && _NRR_SKU_QUALIFIER_STOPWORDS.indexOf(t) === -1;
  });
}
function _nrrSkuJaccard(a, b) {
  var tokA = _nrrSkuTokens(a), tokB = _nrrSkuTokens(b);
  if (!tokA.length || !tokB.length) return 0;
  var setA = {}; tokA.forEach(function (t) { setA[t] = true; });
  var setB = {}; tokB.forEach(function (t) { setB[t] = true; });
  var sizeA = Object.keys(setA).length, sizeB = Object.keys(setB).length;
  var inter = 0;
  Object.keys(setA).forEach(function (t) { if (setB[t]) inter++; });
  return inter / Math.max(1, sizeA + sizeB - inter);
}
function _nrrSkuFormConflict(a, b) {
  var aa = _nrrSkuCompact(a), bb = _nrrSkuCompact(b);
  var groups = [['บด', 'สับ'], ['ชิ้น', 'แผ่น', 'สไลซ์'], ['ผง'], ['น้ำ'], ['แช่แข็ง', 'frozen']];
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    var ha = g.some(function (x) { return aa.indexOf(x) >= 0; });
    var hb = g.some(function (x) { return bb.indexOf(x) >= 0; });
    if ((ha || hb) && ha !== hb) return true;
  }
  return false;
}
function _nrrSkuMagnitudeOk(pair) {
  var qtyA = parseFloat(pair.droppedQty) || 0, qtyB = parseFloat(pair.newQty) || 0;
  if (qtyA > 0 && qtyB > 0) {
    var qr = qtyB / qtyA;
    return qr >= 0.4 && qr <= 2.5;
  }
  // qty_kg missing on either side — fall back to GMV ratio as a secondary
  // safety net only (not the primary check — see header note above).
  var gA = parseFloat(pair.droppedGmv) || 0, gB = parseFloat(pair.newGmv) || 0;
  if (!gA || !gB) return false;
  var gr = gB / gA;
  return gr >= 0.4 && gr <= 2.5;
}
function _nrrSkuPairScore(pair) {
  if (_nrrSkuFormConflict(pair.droppedName, pair.newName)) return { ok: false, score: 0 };
  if (!_nrrSkuMagnitudeOk(pair)) return { ok: false, score: 0 };
  var eggA = _nrrSkuEggKey(pair.droppedName), eggB = _nrrSkuEggKey(pair.newName);
  if (eggA && eggB && eggA === eggB) return { ok: true, score: 1.0 };
  var fkA = _nrrSkuFamilyKey(pair.droppedName, pair.droppedSubclass);
  var fkB = _nrrSkuFamilyKey(pair.newName, pair.newSubclass);
  if (fkA && fkB && fkA === fkB) {
    // Threshold kept at Sense's own proven 0.20 (not tightened further) —
    // testing during implementation showed short 2-3 token Thai product
    // names (e.g. "แครอทหั่นเต๋า ตราเอ" vs "...ตราบี") structurally cap
    // around jaccard 0.33 even for an obvious same-product/different-brand
    // pair, so a stricter bar would miss common real cases. The magnitude
    // (qty_kg) gate above is this feature's actual extra safety net for
    // running unsupervised, not a tighter jaccard bar on top of it too.
    var sim = _nrrSkuJaccard(pair.droppedName, pair.newName);
    if (sim >= 0.20) return { ok: true, score: 0.72 + sim };
  }
  return { ok: false, score: 0 };
}

// Best-match-per-dropped-item (mirrors Sense's fallbackSubstitutions), with
// a reverse guard so one candidate partner can't simultaneously "absorb"
// two different dropped items — the higher-scoring claim wins, the loser
// stays an unmatched (genuine) signal in its own list.
//
// Two kinds of partner, DIFFERENT downstream treatment (decided with the
// user 2026-07-11 after a real account showed this exact split):
//   'new'      — partner never existed before this month. Net delta is
//                close to ฿0 by construction (nothing else could explain
//                its GMV) — this is a genuine "same non-event," shown in
//                its own "สลับ SKU" section, excluded entirely from both
//                signal lists.
//   'growing'  — partner already existed last month too and is ALSO
//                independently growing (nrrSkuMonthDiff's own growingItems
//                bucket). Its GMV is NOT purely explained by the dropped
//                item — the account's real production data showed a case
//                where the combined category total grew ~15-25%/month even
//                after accounting for the swap, i.e. genuine extra demand,
//                not just a relabeled transfer. So the growing side stays
//                fully visible in "สัญญาณบวก" (never netted out), and only
//                the dropped side gets pulled off "ต้องดูแล" — annotated
//                with which item it was absorbed by, not hidden as a wash.
function nrrSkuSwapPairs(accountId, kamEmail) {
  var diff = nrrSkuMonthDiff(accountId, kamEmail);
  var newRows = diff.curRows.filter(function (r) { return !diff.lastByItem[r.item_id]; });
  var partners = newRows.map(function (r) { return { row: r, kind: 'new' }; })
    .concat(diff.growingItems.map(function (r) { return { row: r, kind: 'growing' }; }));
  var droppedRows = diff.droppedItems;
  if (!droppedRows.length || !partners.length) return [];

  var candidates = [];
  droppedRows.forEach(function (d) {
    var best = null, bestScore = 0;
    partners.forEach(function (p) {
      var n = p.row;
      var s = _nrrSkuPairScore({
        droppedName: d.item_name_th, droppedSubclass: d.subclass, droppedGmv: d.gmv_ex_vat, droppedQty: d.qty_kg,
        newName: n.item_name_th, newSubclass: n.subclass, newGmv: n.gmv_ex_vat, newQty: n.qty_kg
      });
      if (s.ok && s.score > bestScore) { best = { dropped: d, newRow: n, kind: p.kind, score: s.score }; bestScore = s.score; }
    });
    if (best) candidates.push(best);
  });

  var claimedNew = {};
  return candidates
    .sort(function (a, b) { return b.score - a.score; })
    .filter(function (c) {
      var nid = c.newRow.item_id;
      if (claimedNew[nid]) return false;
      claimedNew[nid] = true;
      return true;
    })
    .map(function (c) {
      return {
        kind: c.kind,
        droppedItemId: c.dropped.item_id, droppedName: c.dropped.item_name_th, droppedGmv: c.dropped.gmv_ex_vat,
        newItemId: c.newRow.item_id, newName: c.newRow.item_name_th, newGmv: c.newRow.gmv_ex_vat,
        netDelta: c.newRow.gmv_ex_vat - c.dropped.gmv_ex_vat
      };
    });
}
window.nrrSkuSwapPairs = nrrSkuSwapPairs;

// Exclusion/annotation lookups for the two signal-list functions below.
//   droppedIds   — every dropped item_id from ANY confirmed pair (both
//                  kinds) — always pulled off "ต้องดูแล", since in both
//                  cases the customer hasn't genuinely lost the need.
//   newOnlyIds   — only 'new'-kind partner item_ids — pulled off
//                  "สัญญาณบวก"'s "new" bucket (shown in "สลับ SKU" instead).
//   growingNotes — item_id -> the dropped item's name it absorbed, for a
//                  small annotation on the still-fully-shown "growing" row
//                  (never excluded — see nrrSkuSwapPairs' header comment).
function nrrSkuSwapExclusions(accountId, kamEmail) {
  var pairs = nrrSkuSwapPairs(accountId, kamEmail);
  var droppedIds = {}, newOnlyIds = {}, growingNotes = {};
  pairs.forEach(function (p) {
    droppedIds[String(p.droppedItemId)] = true;
    if (p.kind === 'new') newOnlyIds[String(p.newItemId)] = true;
    else growingNotes[String(p.newItemId)] = p.droppedName;
  });
  return { droppedIds: droppedIds, newOnlyIds: newOnlyIds, growingNotes: growingNotes };
}
window.nrrSkuSwapExclusions = nrrSkuSwapExclusions;

// ── Positive signals — live, run-rate projected ──────────────────────────
function nrrSkuPositiveSignals(accountId, kamEmail) {
  var diff = nrrSkuMonthDiff(accountId, kamEmail);
  var swapEx = nrrSkuSwapExclusions(accountId, kamEmail);

  var acctRow = _nrrPortviewRowFor(accountId);
  var daysElapsed = (acctRow && acctRow.days_elapsed) || 1;
  var daysInMonth = (acctRow && acctRow.days_in_month) || 30;
  var ratio = daysElapsed > 0 ? daysInMonth / daysElapsed : 1;

  var newItems = [], growing = [];
  diff.curRows.forEach(function (r) {
    var last = diff.lastByItem[r.item_id];
    if (!last) {
      // Confirmed "new"-kind swap partner — shown in the "สลับ SKU" section
      // instead, not double-counted here as a genuine "new" signal.
      if (swapEx.newOnlyIds[String(r.item_id)]) return;
      if (r.gmv_ex_vat > 1000) newItems.push({ item_id: r.item_id, name: r.item_name_th, gmv: r.gmv_ex_vat });
      return;
    }
    if (!last.gmv_ex_vat) return;
    var proj = r.gmv_ex_vat * ratio;
    var chgPct = (proj - last.gmv_ex_vat) / last.gmv_ex_vat;
    if (chgPct >= 0.20 && r.gmv_ex_vat > 2000) {
      // "growing"-kind swap partner — NEVER excluded (see nrrSkuSwapPairs'
      // header comment: this GMV is real, not purely explained by the
      // dropped item), just annotated with which item it absorbed.
      var swapNote = swapEx.growingNotes[String(r.item_id)] || null;
      growing.push({ item_id: r.item_id, name: r.item_name_th, gmvToDate: r.gmv_ex_vat, proj: proj, lastGmv: last.gmv_ex_vat, projInc: proj - last.gmv_ex_vat, chgPct: chgPct, swapNote: swapNote });
    }
  });
  newItems.sort(function (a, b) { return b.gmv - a.gmv; });
  growing.sort(function (a, b) { return b.projInc - a.projInc; });
  return { new: newItems, growing: growing };
}
window.nrrSkuPositiveSignals = nrrSkuPositiveSignals;

// ── Cycle signals — interval-aware, per-SKU, last month's own cadence ────
function nrrSkuCycleSignals(accountId, kamEmail) {
  var diff = nrrSkuMonthDiff(accountId, kamEmail);
  var lastRows = diff.lastRows;
  var swapEx = nrrSkuSwapExclusions(accountId, kamEmail);
  var acctRow = _nrrPortviewRowFor(accountId);
  var daysElapsed = (acctRow && acctRow.days_elapsed) || 1;
  var daysInMonth = (acctRow && acctRow.days_in_month) || 30;

  var out = [];
  lastRows.forEach(function (r) {
    // Confirmed dropped-side swap (either kind — see nrrSkuSwapPairs' header
    // comment) — the customer hasn't genuinely lost this need either way,
    // so it's never a real risk signal regardless of which kind matched.
    if (swapEx.droppedIds[String(r.item_id)]) return;
    // Pre-existing gap, found 2026-07-11 while investigating a real account
    // showing the SAME item in both "สัญญาณบวก" and "ต้องดูแล" at once: this
    // whole function only ever looked at LAST month's cadence to predict
    // "should have reordered by now" — it never checked whether the item
    // has ALREADY been reordered THIS month (diff.curByItem). An item
    // growing nicely this month could still get flagged overdue purely
    // because the check never looked at current-month activity at all.
    // If it has any row this month, the cadence question is moot — skip it
    // here entirely (nrrSkuPositiveSignals already judges whether that
    // current-month activity is itself growing/flat/declining).
    if (diff.curByItem[r.item_id]) return;
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
  if (!byItem) return { net: 0, up: [], down: [], upCount: 0, downCount: 0, hasCurrentData: false, creeping: [] };

  var labels = _nrrAccountMonthLabels();
  var skuBundle = nrrSenseSkusCache[kamEmail];
  var skuRows = (skuBundle && skuBundle.loaded && skuBundle.byAccountId[accountId]) || [];
  var nameByItem = {}, qtyByItem = {};
  skuRows.forEach(function (r) {
    if (!nameByItem[r.item_id]) nameByItem[r.item_id] = r.item_name_th; // any month, so an item dropped this month still gets a name
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
  var flagged = {};      // item_ids already caught by the this-month ≥1% threshold below
  var historyByItem = {}; // item_id -> [{month_label, unit_price}] across all closed months in bulk_price.csv (up to 6)

  Object.keys(byItem).forEach(function (itemId) {
    var rows = byItem[itemId];
    var history = rows
      .filter(function (r) { return r.unit_price > 0; })
      .slice()
      .sort(function (a, b) { return (_nrrParseThLabel(a.month_label).key || 0) - (_nrrParseThLabel(b.month_label).key || 0); })
      .map(function (r) { return { month_label: r.month_label, unit_price: r.unit_price }; });
    historyByItem[itemId] = history;

    var curRow = rows.filter(function (r) { return r.month_label === labels.cur; })[0];
    if (curRow) hasCurrentData = true;
    var lastRow = rows.filter(function (r) { return r.month_label === labels.last; })[0];
    if (!curRow || !lastRow || !lastRow.unit_price) return;
    var pctChange = (curRow.unit_price - lastRow.unit_price) / lastRow.unit_price * 100;
    if (Math.abs(pctChange) < 1) return; // Sense's own ≥1% threshold (computePriceChanges)
    var qty = qtyByItem[itemId] || 0;
    var impact = (curRow.unit_price - lastRow.unit_price) * qty;
    var entry = { item_id: itemId, name: nameByItem[itemId] || itemId, pctChange: pctChange, impact: impact, history: history };
    if (pctChange > 0) up.push(entry); else down.push(entry);
    flagged[itemId] = true;
  });
  up.sort(function (a, b) { return b.impact - a.impact; });
  down.sort(function (a, b) { return a.impact - b.impact; });
  var net = up.reduce(function (s, e) { return s + e.impact; }, 0) + down.reduce(function (s, e) { return s + e.impact; }, 0);

  // Creep signal — cumulative % move across the full bulk_price.csv history
  // (up to 6 closed months), for items the single-month threshold above
  // never catches because no ONE step ever looked alarming on its own.
  // Thresholds are calibrated against the real file, not guessed: a
  // strict <1%-per-step / ≥3%-cumulative bar (matching the up/down list's
  // own ≥1% threshold) fires on ZERO of the ~111K item-histories in
  // bulk_price.csv as of 2026-07-09 — fresh-food pricing here moves in
  // discrete jumps, not smooth drift, so that bar is unusable. <2%-per-step
  // / ≥2.5%-cumulative fires on 299, a real and checkable set. Re-check
  // this distribution if it goes quiet again after future price resets.
  var CREEP_STEP_CEILING_PCT = 2;
  var CREEP_THRESHOLD_PCT = 2.5;
  var creeping = [];
  Object.keys(historyByItem).forEach(function (itemId) {
    if (flagged[itemId]) return;
    var history = historyByItem[itemId];
    if (history.length < 2) return;
    // Every INDIVIDUAL step has to stay under the ceiling — otherwise this
    // isn't a slow creep, it's a jump between two months that just happens
    // not to be the cur/last pair the up/down list above checks (e.g. a
    // spike between two closed months). With only 2 data points cumPct
    // === the one step's pct, so this also naturally requires ≥3 months
    // of history for anything to qualify.
    var maxStepPct = 0;
    for (var i = 1; i < history.length; i++) {
      var p0 = history[i - 1].unit_price, p1 = history[i].unit_price;
      if (p0 > 0) maxStepPct = Math.max(maxStepPct, Math.abs((p1 - p0) / p0 * 100));
    }
    if (maxStepPct >= CREEP_STEP_CEILING_PCT) return;
    var first = history[0], last = history[history.length - 1];
    if (!first.unit_price) return;
    var cumPct = (last.unit_price - first.unit_price) / first.unit_price * 100;
    if (Math.abs(cumPct) < CREEP_THRESHOLD_PCT) return;
    creeping.push({ item_id: itemId, name: nameByItem[itemId] || itemId, cumPct: cumPct, history: history });
  });
  creeping.sort(function (a, b) { return Math.abs(b.cumPct) - Math.abs(a.cumPct); });

  return { net: net, up: up, down: down, upCount: up.length, downCount: down.length, hasCurrentData: hasCurrentData, creeping: creeping };
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
