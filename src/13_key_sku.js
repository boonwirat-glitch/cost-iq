// ══════════════════════════════════════════════════════════════════════════
// KEY SKU — src/13_key_sku.js (v_key, 2026-08-16)
//
// Rep picks which SKUs, per account, must never go out of stock. Recommends
// candidates first (rep mostly just confirms/unticks) using 3 signals:
//   (ก) concentration — SKU is a big share of this account's own spend
//   (ข) sole-source   — almost nobody else company-wide buys this SKU either
//   (ค) newness       — account only just started ordering it
//
// Design doc: ~/.claude/plans/feature-price-trend-splendid-sunbeam.md
// Test spec:  tools/verify_key_sku.js
// ══════════════════════════════════════════════════════════════════════════

// ── SECTION: pure scoring functions (unit-tested directly by the harness) ──

function _keySkuNoiseFloorPass(skuGmv, accountMonthTotalGmv) {
  return (skuGmv || 0) >= Math.max(3000, (accountMonthTotalGmv || 0) * 0.005);
}

function _keySkuConcentrationScore(pct, isTop1) {
  if (pct >= 15) return 40;
  if (pct >= 8) return 24;
  if (isTop1) return 12;
  return 0;
}

function _keySkuSoleSourceScore(reach) {
  if (!reach) return 0;
  if (reach.distinct_account_count <= 3 && reach.total_order_count >= 2) return 35;
  if (reach.distinct_account_count >= 4 && reach.distinct_account_count <= 7) return 21;
  return 0;
}

function _keySkuNewnessScore(orderCount, lastOrderDate, nowMs) {
  if (orderCount !== 1) return 0;
  if (!lastOrderDate) return 0;
  var days = (nowMs - new Date(lastOrderDate).getTime()) / 86400000;
  if (days >= 0 && days <= 14) return 25;
  return 0;
}

// Priority: sole-source > newness > concentration (sole-source = "nobody else
// can cover this if it runs out", the most urgent "ห้ามขาด" signal).
function _keySkuBadges(scores) {
  var tags = [];
  if (scores.soleSource > 0) {
    tags.push({ key: 'sole_source', label: 'มีร้านนี้ร้านเดียวที่สั่ง', priority: 1 });
  }
  if (scores.newness > 0) {
    var d = scores.daysSince != null ? scores.daysSince : 0;
    tags.push({ key: 'newness', label: 'เพิ่งเริ่มสั่ง ' + d + ' วันก่อน', priority: 2 });
  }
  if (scores.concentration > 0) {
    var pct = Math.round((scores.pct || 0) * 10) / 10;
    tags.push({ key: 'concentration', label: 'ซื้อ ' + pct + '% ของยอดร้านนี้', priority: 3 });
  }
  tags.sort(function (a, b) { return a.priority - b.priority; });
  return tags.slice(0, 2);
}

// skuRows: [{id,name,pct,isTop1,gmvRecentMonth,accountMonthTotalGmv,orderCount,lastOrderDate,reach}]
function computeKeySkuCandidates(skuRows, opts) {
  opts = opts || {};
  var now = opts.now || Date.now();
  var result = [];
  (skuRows || []).forEach(function (row) {
    if (!row || row.id == null) return;
    if (!_keySkuNoiseFloorPass(row.gmvRecentMonth, row.accountMonthTotalGmv)) return;
    var concentration = _keySkuConcentrationScore(row.pct || 0, !!row.isTop1);
    var soleSource = _keySkuSoleSourceScore(row.reach);
    var newness = _keySkuNewnessScore(row.orderCount, row.lastOrderDate, now);
    var total = concentration + soleSource + newness;
    if (total <= 0) return;
    var daysSince = row.lastOrderDate ? Math.round((now - new Date(row.lastOrderDate).getTime()) / 86400000) : null;
    var badges = _keySkuBadges({ soleSource: soleSource, newness: newness, concentration: concentration, pct: row.pct, daysSince: daysSince });
    result.push({
      id: row.id,
      name: row.name,
      score: total,
      breakdown: { concentration: concentration, soleSource: soleSource, newness: newness },
      badges: badges
    });
  });
  result.sort(function (a, b) { return b.score - a.score; });
  return result;
}

// ── SECTION: bind pure functions to real portfolio data ──────────────────

function _keySkuMonthSort(m) {
  var p = (m || '').split(' ');
  var MO = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return (parseInt(p[1] || 0) * 12) + MO.indexOf(p[0]);
}

// Builds the skuRows input for computeKeySkuCandidates from bulkSkusData +
// bulkCurrentMonthData + companySkuReachData (all already loaded portfolio-
// wide — no extra fetch needed, this runs client-side per account on open).
function _keySkuBuildRows(accountId) {
  var byMonth = (typeof bulkSkusData !== 'undefined' && bulkSkusData[accountId]) || {};
  var months = Object.keys(byMonth).sort(function (a, b) { return _keySkuMonthSort(b) - _keySkuMonthSort(a); });
  if (!months.length) return [];

  var curLabel = (typeof bulkCurrentMonthData !== 'undefined' && bulkCurrentMonthData[accountId] && bulkCurrentMonthData[accountId].month_label) || '';
  var closedMonths = months.filter(function (m) { return m !== curLabel; });
  var latestMonth = months[0];
  var latestClosed = closedMonths[0];
  if (!latestClosed) {
    // v_key self-review fix: a brand-new account (first month ever, no closed
    // month to anchor concentration/noise-floor against) used to return []
    // here — showing ZERO candidates for exactly the accounts where "just
    // started ordering" (criterion ค) matters most. Fall back to using the
    // only month available (almost always MTD) as its own baseline instead:
    // less precise than a full closed month, but far better than nothing.
    if (!latestMonth) return [];
    var mtdRows = (byMonth[latestMonth] || []).filter(function (r) { return r && r.id != null; });
    var mtdTotal = mtdRows.reduce(function (s, r) { return s + (r.gmv || r.s || 0); }, 0);
    var mtdTop1Id = null, mtdTop1Val = -1;
    mtdRows.forEach(function (r) {
      var v = r.p != null ? r.p : (r.pct || 0);
      if (v > mtdTop1Val) { mtdTop1Val = v; mtdTop1Id = r.id; }
    });
    return mtdRows.map(function (r) {
      return {
        id: r.id,
        name: r.n || r.name || '',
        pct: r.p != null ? r.p : (r.pct || 0),
        isTop1: r.id === mtdTop1Id,
        gmvRecentMonth: r.gmv || r.s || 0,
        accountMonthTotalGmv: mtdTotal,
        orderCount: r.order_count != null ? r.order_count : 0,
        lastOrderDate: r.last_order_date || null,
        reach: (typeof companySkuReachData !== 'undefined' ? companySkuReachData[r.id] : null) || null
      };
    });
  }

  var latestClosedRows = byMonth[latestClosed] || [];
  var accountMonthTotalGmv = latestClosedRows.reduce(function (s, r) { return s + (r.gmv || r.s || 0); }, 0);
  var latestMonthRows = byMonth[latestMonth] || [];
  var latestMonthMap = {};
  latestMonthRows.forEach(function (r) { if (r && r.id != null) latestMonthMap[r.id] = r; });
  var latestClosedMap = {};
  latestClosedRows.forEach(function (r) { if (r && r.id != null) latestClosedMap[r.id] = r; });

  // avg pct across closed months only (excludes MTD — a big MTD order shouldn't skew concentration)
  var pctSum = {}, pctCount = {};
  closedMonths.forEach(function (m) {
    (byMonth[m] || []).forEach(function (r) {
      if (!r || r.id == null) return;
      pctSum[r.id] = (pctSum[r.id] || 0) + (r.p != null ? r.p : (r.pct || 0));
      pctCount[r.id] = (pctCount[r.id] || 0) + 1;
    });
  });
  var avgPct = {};
  Object.keys(pctSum).forEach(function (id) { avgPct[id] = pctSum[id] / pctCount[id]; });
  var top1Id = null, top1Val = -1;
  Object.keys(avgPct).forEach(function (id) { if (avgPct[id] > top1Val) { top1Val = avgPct[id]; top1Id = id; } });

  // union of ids from the latest closed month AND the latest month (which may be MTD) —
  // a SKU that appears ONLY in MTD (order_count=1, brand new) must still be scored,
  // otherwise Tier B of the "newness" criterion silently never fires.
  var allIds = {};
  Object.keys(latestClosedMap).forEach(function (id) { allIds[id] = true; });
  Object.keys(latestMonthMap).forEach(function (id) { allIds[id] = true; });

  var rows = [];
  Object.keys(allIds).forEach(function (id) {
    var closedRow = latestClosedMap[id];
    var latestRow = latestMonthMap[id] || closedRow;
    if (!latestRow) return;
    rows.push({
      id: id,
      name: latestRow.n || latestRow.name || '',
      pct: avgPct[id] != null ? avgPct[id] : (latestRow.p != null ? latestRow.p : (latestRow.pct || 0)),
      isTop1: id === top1Id,
      // noise floor / concentration base always come from the closed month when available —
      // an MTD-only new SKU has no closed-month figure, so its own (partial-month) gmv is
      // the best available signal instead.
      gmvRecentMonth: closedRow ? (closedRow.gmv || closedRow.s || 0) : (latestRow.gmv || latestRow.s || 0),
      accountMonthTotalGmv: accountMonthTotalGmv,
      orderCount: latestRow.order_count != null ? latestRow.order_count : 0,
      lastOrderDate: latestRow.last_order_date || null,
      reach: (typeof companySkuReachData !== 'undefined' ? companySkuReachData[id] : null) || null
    });
  });
  return rows;
}

function computeKeySkuCandidatesForAccount(accountId, opts) {
  return computeKeySkuCandidates(_keySkuBuildRows(accountId), opts);
}

// ── SECTION: small inline icons (this app uses hand-rolled stroke SVGs, no icon font) ──
var _KEY_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"></circle><path d="M21 2l-9.6 9.6"></path><path d="M15.5 7.5l3 3L22 7l-3-3"></path></svg>';
var _KEY_BACK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
var _KEY_CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

function _keySkuEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Safe to embed as a single-quoted JS string-literal ARGUMENT inside an
// onclick="..." HTML attribute (e.g. onclick="fn('VALUE')"). _keySkuEsc alone
// is NOT enough here: the browser HTML-decodes the attribute value BEFORE
// compiling it as JS, so escaping a quote as the entity &#39; just decodes
// back to a literal ' before the JS parser ever sees it — an apostrophe in a
// real SKU/account name (e.g. "Chef's Choice") would terminate the JS string
// early, breaking the handler or worse. Escape the JS string delimiter first
// (backslash, then quote), THEN HTML-escape the result for the surrounding
// double-quoted attribute.
function _keySkuAttrEsc(s) {
  var str = String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── SECTION: persist/restore — mirrors _persistPlan/_restorePlan (08_patches.js) ──

var _keySkuState = { byAccount: {} }; // accountId -> {existingIds:Set<string>, rows:[{sku_id,sku_name,set_at}], loaded:bool, loading:Promise|null}
var _keySkuPortfolioIds = null; // Set<accountId> with >=1 active row, from one bulk query — powers coverage counts without N queries
var _keySkuPortfolioRows = null; // [{account_id,sku_id,sku_name,set_at}] — same bulk query, full rows for the flat "ปกป้องแล้ว" feed

function _keySkuLocalKey(accountId) { return 'sbk_key_' + accountId; }

// Every outlet under an account, deduped across whatever months are loaded —
// used to fan a confirmed Key SKU out to every outlet (supply planning works
// at outlet/res_id grain, not billing-account grain). Reads bulkOutletsData,
// already in memory client-side (bulk_outlets.csv) — no new fetch.
function _keySkuOutletsFor(accountId) {
  var byMonth = (typeof bulkOutletsData !== 'undefined' && bulkOutletsData[accountId]) || {};
  var seen = {}; var out = [];
  Object.keys(byMonth).forEach(function (m) {
    (byMonth[m] || []).forEach(function (o) {
      if (!o || !o.outlet_id || seen[o.outlet_id]) return;
      seen[o.outlet_id] = true;
      out.push({ outlet_id: o.outlet_id, outlet_name: o.outlet_name || '' });
    });
  });
  return out;
}

function _keySkuEnsureLoaded(accountId) {
  if (!accountId) return Promise.resolve({ existingIds: new Set(), rows: [] });
  var st = _keySkuState.byAccount[accountId];
  if (st && st.loaded) return Promise.resolve(st);
  if (st && st.loading) return st.loading;
  var p = new Promise(function (resolve) {
    function applyRows(rows) {
      // v_keyoutlet: a confirmed SKU now writes one DB row per outlet, so the
      // same sku_id can arrive multiple times here — collapse to one entry
      // per sku_id before it reaches the per-account "existing" list/count,
      // else the UI would show the same SKU N times (once per outlet).
      var seenSku = {}; var deduped = [];
      (rows || []).forEach(function (r) {
        if (seenSku[r.sku_id]) return;
        seenSku[r.sku_id] = true;
        deduped.push(r);
      });
      var ids = new Set(deduped.map(function (r) { return String(r.sku_id); }));
      var next = { existingIds: ids, rows: deduped, loaded: true, loading: null };
      _keySkuState.byAccount[accountId] = next;
      resolve(next);
    }
    if (typeof supa !== 'undefined' && supa) {
      supa.from('key_skus').select('sku_id,sku_name,set_at')
        .eq('account_id', accountId).eq('status', 'active')
        .then(function (res) {
          if (res.error) console.warn('[KeySKU] restore error:', res.error.message);
          if (res.data) {
            try { localStorage.setItem(_keySkuLocalKey(accountId), JSON.stringify(res.data)); } catch (e) {}
            applyRows(res.data);
          } else {
            try {
              var local = localStorage.getItem(_keySkuLocalKey(accountId));
              applyRows(local ? JSON.parse(local) : []);
            } catch (e) { applyRows([]); }
          }
        })
        .catch(function () {
          try {
            var local = localStorage.getItem(_keySkuLocalKey(accountId));
            applyRows(local ? JSON.parse(local) : []);
          } catch (e) { applyRows([]); }
        });
    } else {
      try {
        var local = localStorage.getItem(_keySkuLocalKey(accountId));
        applyRows(local ? JSON.parse(local) : []);
      } catch (e) { applyRows([]); }
    }
  });
  _keySkuState.byAccount[accountId] = { loaded: false, loading: p };
  return p;
}

// One bulk query for "which accounts have at least 1 active Key SKU" — avoids
// firing N per-account queries just to paint coverage counts on Portview/queue.
function _keySkuEnsurePortfolioLoaded() {
  if (_keySkuPortfolioIds) return Promise.resolve(_keySkuPortfolioIds);
  var userEmail = (typeof currentUserProfile !== 'undefined' && currentUserProfile) ? currentUserProfile.email : null;
  if (typeof supa === 'undefined' || !supa || !userEmail) {
    _keySkuPortfolioIds = new Set(); _keySkuPortfolioRows = [];
    return Promise.resolve(_keySkuPortfolioIds);
  }
  // Same query as before, just widened by 3 columns — one round trip still powers both
  // the coverage Set (existing callers) and the flat "ปกป้องแล้ว" feed (getPortfolioProtectedItems).
  return supa.from('key_skus').select('account_id,sku_id,sku_name,set_at').eq('set_by', userEmail).eq('status', 'active')
    .then(function (res) {
      var rows = res.data || [];
      _keySkuPortfolioRows = rows;
      var ids = new Set(rows.map(function (r) { return r.account_id; }));
      _keySkuPortfolioIds = ids;
      return ids;
    })
    .catch(function () { _keySkuPortfolioIds = new Set(); _keySkuPortfolioRows = []; return _keySkuPortfolioIds; });
}

function _keySkuConfirm(accountId, items) {
  if (!accountId || !items || !items.length) return Promise.resolve();
  var userEmail = (typeof currentUserProfile !== 'undefined' && currentUserProfile) ? currentUserProfile.email : null;
  var accountName = (typeof bulkAccountNames !== 'undefined' && bulkAccountNames[accountId]) || '';
  var nowIso = new Date().toISOString();
  // Bush 2026-08-16: supply planning works at outlet grain (res_name/res_id),
  // not billing-account grain — marking a SKU "Key" for an account must apply
  // to every outlet under it. Fan out one DB row per (item, outlet) pair;
  // fall back to the old single-row-per-account shape (outlet_id null) only
  // when the outlet list isn't loaded yet, so a confirm never silently no-ops.
  var outlets = _keySkuOutletsFor(accountId);
  var rows = [];
  items.forEach(function (it) {
    if (outlets.length) {
      outlets.forEach(function (o) {
        rows.push({
          account_id: accountId, account_name: accountName, outlet_id: o.outlet_id, outlet_name: o.outlet_name,
          sku_id: String(it.id), sku_name: it.name || '',
          status: 'active', set_by: userEmail, set_at: nowIso, removed_by: null, removed_at: null
        });
      });
    } else {
      rows.push({
        account_id: accountId, account_name: accountName, outlet_id: null, outlet_name: null,
        sku_id: String(it.id), sku_name: it.name || '',
        status: 'active', set_by: userEmail, set_at: nowIso, removed_by: null, removed_at: null
      });
    }
  });
  // Always write localStorage as instant fallback, mirroring _persistPlan.
  // Built from `items` (one entry per SKU), not the outlet-fanned `rows` —
  // the local cache backs the per-account "existing" list, which is SKU-level.
  try {
    var existing = _keySkuState.byAccount[accountId];
    var mergedRows = (existing && existing.rows ? existing.rows.filter(function (r) { return !items.some(function (it) { return String(it.id) === String(r.sku_id); }); }) : [])
      .concat(items.map(function (it) { return { sku_id: String(it.id), sku_name: it.name || '', set_at: nowIso }; }));
    localStorage.setItem(_keySkuLocalKey(accountId), JSON.stringify(mergedRows));
  } catch (e) {}
  if (typeof supa !== 'undefined' && supa) {
    // Plain insert, not upsert: key_skus_active_uidx is a PARTIAL unique index
    // (where status='active'), and Postgres can't use a partial index as an
    // ON CONFLICT arbiter unless the ON CONFLICT clause repeats that exact
    // predicate — which supabase-js's {onConflict:'cols'} option has no way to
    // express, so .upsert() here fails every call with 42P10 (confirmed against
    // the real DB). In practice this is always a fresh insert anyway: the
    // candidate list already excludes any sku_id with an existing active row
    // (see renderKeyScreen's `!existingIds.has(...)` filter), so a real conflict
    // only happens on a stale in-memory list (e.g. two tabs) — treat 23505
    // (unique_violation) as "already active, nothing to do" rather than an error.
    return supa.from('key_skus').insert(rows)
      .then(function (res) {
        if (res.error && res.error.code !== '23505') console.warn('[KeySKU] confirm insert error:', res.error.message);
      })
      .catch(function (e) { console.warn('[KeySKU] confirm exception:', e.message); })
      .then(function () { delete _keySkuState.byAccount[accountId]; _keySkuPortfolioIds = null; _keySkuPortfolioRows = null; });
  }
  delete _keySkuState.byAccount[accountId];
  return Promise.resolve();
}

// Soft delete only — status flip, never a hard DELETE (audit trail must survive).
function _keySkuRemoveOne(accountId, skuId) {
  var userEmail = (typeof currentUserProfile !== 'undefined' && currentUserProfile) ? currentUserProfile.email : null;
  var nowIso = new Date().toISOString();
  if (typeof supa !== 'undefined' && supa) {
    return supa.from('key_skus')
      .update({ status: 'removed', removed_by: userEmail, removed_at: nowIso })
      .eq('account_id', accountId).eq('sku_id', String(skuId))
      .then(function (res) { if (res.error) console.warn('[KeySKU] remove error:', res.error.message); })
      .catch(function (e) { console.warn('[KeySKU] remove exception:', e.message); })
      .then(function () { delete _keySkuState.byAccount[accountId]; _keySkuPortfolioIds = null; _keySkuPortfolioRows = null; });
  }
  delete _keySkuState.byAccount[accountId];
  return Promise.resolve();
}

// ── SECTION: scr-key-queue (cross-portfolio) ──────────────────────────────

// Short calendar date ("14 ส.ค.") — same Thai-month-abbreviation convention used
// throughout 02_data_pipeline.js, no year (this feed only ever shows recent items).
function _keySkuShortDate(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  var MO = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return d.getDate() + ' ' + MO[d.getMonth()];
}

// Flat, cross-portfolio feed of already-confirmed Key SKUs — reuses the same bulk
// query _keySkuEnsurePortfolioLoaded() already runs for coverage counts (call that
// first; this just maps the cached rows, no extra fetch).
function getPortfolioProtectedItems() {
  // v_keyoutlet: rows are now one-per-outlet for the same account+sku — collapse
  // back to one card per confirmed SKU before this reaches the flat home feed.
  var seen = {}; var rows = [];
  (_keySkuPortfolioRows || []).forEach(function (r) {
    var key = r.account_id + '|' + String(r.sku_id);
    if (seen[key]) return;
    seen[key] = true;
    rows.push(r);
  });
  return rows.map(function (r) {
    return {
      accountId: r.account_id,
      accountName: (typeof bulkAccountNames !== 'undefined' && bulkAccountNames[r.account_id]) || r.account_id,
      skuId: r.sku_id, skuName: r.sku_name, setAt: r.set_at
    };
  }).sort(function (a, b) { return new Date(b.setAt) - new Date(a.setAt); });
}

// Flat, cross-portfolio candidate feed — same per-account scoring as the account
// screen (computeKeySkuCandidatesForAccount), just flattened across every account
// already loaded in portview and tagged with which store each one is from. Excludes
// anything already confirmed for that account (checked against the same bulk query).
function getPortfolioKeySkuCandidates() {
  var accounts = (typeof getPortviewAccounts === 'function') ? getPortviewAccounts() : [];
  var confirmedKeys = new Set((_keySkuPortfolioRows || []).map(function (r) { return r.account_id + '|' + String(r.sku_id); }));
  var out = [];
  accounts.forEach(function (a) {
    computeKeySkuCandidatesForAccount(a.id).forEach(function (c) {
      if (confirmedKeys.has(a.id + '|' + String(c.id))) return;
      out.push({ accountId: a.id, accountName: a.name, sku: c });
    });
  });
  out.sort(function (x, y) {
    var xSole = x.sku.badges.some(function (b) { return b.key === 'sole_source'; });
    var ySole = y.sku.badges.some(function (b) { return b.key === 'sole_source'; });
    if (xSole !== ySole) return xSole ? -1 : 1;
    return (y.sku.score || 0) - (x.sku.score || 0);
  });
  return out;
}

// Cross-account search for the pinned search bar — loops each account's own latest-
// month SKU rows (already in memory via bulkSkusData, same data computeKeySkuCandidates
// reads) matching against SKU name or account name. No new fetch.
function _keySkuPortfolioSearch(query) {
  query = (query || '').trim().toLowerCase();
  if (!query) return [];
  var accounts = (typeof getPortviewAccounts === 'function') ? getPortviewAccounts() : [];
  var confirmedKeys = new Set((_keySkuPortfolioRows || []).map(function (r) { return r.account_id + '|' + String(r.sku_id); }));
  var out = [];
  accounts.forEach(function (a) {
    var nameMatches = a.name && a.name.toLowerCase().indexOf(query) !== -1;
    var byMonth = (typeof bulkSkusData !== 'undefined' && bulkSkusData[a.id]) || {};
    var months = Object.keys(byMonth).sort(function (x, y) { return _keySkuMonthSort(y) - _keySkuMonthSort(x); });
    var latestRows = months.length ? (byMonth[months[0]] || []) : [];
    latestRows.forEach(function (r) {
      if (!r || !r.n) return;
      if (confirmedKeys.has(a.id + '|' + String(r.id))) return;
      if (nameMatches || r.n.toLowerCase().indexOf(query) !== -1) {
        out.push({ accountId: a.id, accountName: a.name, skuId: r.id, skuName: r.n });
      }
    });
  });
  return out.slice(0, 20);
}

// One-tap confirm from the flat feed or search results — writes straight to
// key_skus via the existing _keySkuConfirm (same insert/localStorage/invalidate
// path the per-account screen's "ยืนยัน" button uses), then repaints this screen
// from fresh state so counts/badge stay consistent (simpler and safer than trying
// to hand-patch every derived count in place).
function keyPortfolioQuickConfirm(accountId, skuId, skuName, btnEl) {
  if (btnEl) btnEl.disabled = true;
  _keySkuConfirm(accountId, [{ id: skuId, name: skuName }]).then(function () {
    if (typeof showToast === 'function') showToast('เพิ่ม "' + skuName + '" เป็น Key SKU แล้ว');
    if (typeof renderKeySkuNavBadge === 'function') renderKeySkuNavBadge();
    if (typeof renderKeySkuSplitButton === 'function') renderKeySkuSplitButton();
    renderKeyQueueScreen();
  });
}

var _KEY_SHIELD_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3.5v6c0 5-3.4 8.8-8 10-4.6-1.2-8-5-8-10v-6z"></path><path d="M9 12l2 2 4-4"></path></svg>';
var _KEY_PLUS_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>';
var _KEY_SEARCH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>';

function _keySkuBadgeHtml(badges) {
  return (badges || []).map(function (b) {
    return '<span class="skbadge skbadge-' + (b.key === 'sole_source' ? 'sole-source' : b.key === 'newness' ? 'newness-key' : 'concentration-key') + '">' + _keySkuEsc(b.label) + '</span>';
  }).join('');
}

var _keyHomeQuery = ''; // sticky across re-renders so a quick-confirm repaint doesn't clear what the rep was searching
var _keyProtExpanded = false, _keyRecoExpanded = false;
var KEY_PROT_CAP = 8, KEY_RECO_CAP = 10;

function renderKeyQueueScreen() {
  var scr = document.getElementById('scr-key-queue');
  if (!scr) return;
  var accounts = (typeof getPortviewAccounts === 'function') ? getPortviewAccounts() : [];
  scr.innerHTML =
    '<div class="key-screen-pad">' +
      '<div class="key-header">' +
        '<button class="key-back-btn" onclick="showScreen(\'portview\')">' + _KEY_BACK_SVG + '</button>' +
        '<div><div class="key-header-title">Key SKU</div><div class="key-header-sub">ทั่วพอร์ต · ' + accounts.length + ' ร้าน</div></div>' +
      '</div>' +
      '<div class="key-hero"><div class="key-hero-ico">' + _KEY_SHIELD_SVG + '</div>' +
        '<div><div class="key-hero-n" id="key-hero-n">0</div><div class="key-hero-lbl">Marked as Key SKU</div></div>' +
      '</div>' +
      '<div class="key-home-search">' + _KEY_SEARCH_SVG +
        '<input type="text" id="key-home-q" placeholder="ค้นหา SKU หรือชื่อร้าน..." value="' + _keySkuEsc(_keyHomeQuery) + '" oninput="_keyHomeFilter(this.value)">' +
      '</div>' +
      '<div class="key-sec-label">ปกป้องแล้ว <span class="key-sec-count" id="key-prot-count"></span></div>' +
      '<div id="key-prot-list">กำลังโหลด...</div>' +
      '<div class="key-more-hint" id="key-prot-more" style="display:none;cursor:pointer" onclick="_keyProtExpandToggle()"></div>' +
      '<div class="key-sec-label" style="margin-top:20px">แนะนำเพิ่ม <span class="key-sec-count" id="key-reco-count"></span></div>' +
      '<div id="key-reco-list"></div>' +
      '<div class="key-more-hint" id="key-reco-more" style="display:none;cursor:pointer" onclick="_keyRecoExpandToggle()"></div>' +
    '</div>';
  if (!accounts.length) {
    document.getElementById('key-prot-list').innerHTML = '<div class="key-queue-empty">ยังไม่มีร้านในพอร์ต</div>';
    return;
  }
  _keySkuEnsurePortfolioLoaded().then(function () { _keyHomeRenderLists(_keyHomeQuery); });
}

function _keyHomeFilter(value) {
  _keyHomeQuery = value;
  _keyProtExpanded = false; _keyRecoExpanded = false; // a new search starts collapsed again
  _keyHomeRenderLists(value);
}

function _keyProtExpandToggle() { _keyProtExpanded = true; _keyHomeRenderLists(_keyHomeQuery); }
function _keyRecoExpandToggle() { _keyRecoExpanded = true; _keyHomeRenderLists(_keyHomeQuery); }

function _keyHomeRenderLists(query) {
  var q = (query || '').trim().toLowerCase();
  var allProt = getPortfolioProtectedItems();
  var allReco = getPortfolioKeySkuCandidates();

  var prot = q ? allProt.filter(function (p) {
    return p.skuName.toLowerCase().indexOf(q) > -1 || p.accountName.toLowerCase().indexOf(q) > -1;
  }) : allProt;
  var reco = q ? allReco.filter(function (r) {
    return r.sku.name.toLowerCase().indexOf(q) > -1 || r.accountName.toLowerCase().indexOf(q) > -1;
  }) : allReco;

  // Searching also surfaces SKUs the scoring engine didn't flag — "เพิ่มเอง" fallback,
  // same data _keySkuPortfolioSearch already scans (bulkSkusData, no extra fetch).
  if (q) {
    var already = new Set(reco.map(function (r) { return r.accountId + '|' + String(r.sku.id); }));
    _keySkuPortfolioSearch(q).forEach(function (m) {
      var k = m.accountId + '|' + String(m.skuId);
      if (already.has(k)) return;
      already.add(k);
      reco.push({ accountId: m.accountId, accountName: m.accountName, sku: { id: m.skuId, name: m.skuName, badges: [] } });
    });
  }

  var heroN = document.getElementById('key-hero-n');
  if (heroN) heroN.textContent = allProt.length;
  var protCountEl = document.getElementById('key-prot-count');
  if (protCountEl) protCountEl.textContent = prot.length + ' จาก ' + allProt.length;
  var recoCountEl = document.getElementById('key-reco-count');
  if (recoCountEl) recoCountEl.textContent = reco.length + ' ทั่วพอร์ต';

  var protShow = _keyProtExpanded ? prot : prot.slice(0, KEY_PROT_CAP);
  var protListEl = document.getElementById('key-prot-list');
  if (protListEl) {
    protListEl.innerHTML = protShow.length ? protShow.map(function (p) {
      return '<div class="prow"><div class="pcheck">' + _KEY_CHECK_SVG + '</div><div style="flex:1;min-width:0">' +
        '<div class="pname">' + _keySkuEsc(p.skuName) + '</div><div class="ptag-row"><span class="ptag">' + _keySkuEsc(p.accountName) + '</span>' +
        '<span class="pwhen">เพิ่มเมื่อ ' + _keySkuShortDate(p.setAt) + '</span></div></div></div>';
    }).join('') : '<div class="key-empty-state">' + (q ? 'ไม่พบ SKU ที่ตรงกับคำค้นนี้' : 'ยังไม่มี SKU ที่ตั้งเป็น Key') + '</div>';
  }
  var protMoreEl = document.getElementById('key-prot-more');
  if (protMoreEl) {
    if (!_keyProtExpanded && prot.length > KEY_PROT_CAP) { protMoreEl.style.display = ''; protMoreEl.textContent = 'ดูทั้งหมด ' + prot.length + ' รายการ →'; }
    else protMoreEl.style.display = 'none';
  }

  var recoShow = _keyRecoExpanded ? reco : reco.slice(0, KEY_RECO_CAP);
  var recoListEl = document.getElementById('key-reco-list');
  if (recoListEl) {
    recoListEl.innerHTML = recoShow.length ? recoShow.map(function (r) {
      var badgeHtml = _keySkuBadgeHtml(r.sku.badges);
      return '<div class="rrow"><div style="flex:1;min-width:0"><div class="rname">' + _keySkuEsc(r.sku.name) + '</div>' +
        '<div class="rtag-row"><span class="rtag">' + _keySkuEsc(r.accountName) + '</span>' + badgeHtml + '</div></div>' +
        '<button class="addbtn" onclick="keyPortfolioQuickConfirm(\'' + _keySkuAttrEsc(r.accountId) + '\',\'' + _keySkuAttrEsc(r.sku.id) + '\',\'' + _keySkuAttrEsc(r.sku.name) + '\',this)">' + _KEY_PLUS_SVG + '</button></div>';
    }).join('') : '<div class="key-empty-state">' + (q ? 'ไม่พบ SKU ที่ตรงกับคำค้นนี้' : 'ไม่มี SKU แนะนำเพิ่มแล้ว') + '</div>';
  }
  var recoMoreEl = document.getElementById('key-reco-more');
  if (recoMoreEl) {
    if (!_keyRecoExpanded && reco.length > KEY_RECO_CAP) { recoMoreEl.style.display = ''; recoMoreEl.textContent = 'ดูเพิ่มอีก ' + (reco.length - KEY_RECO_CAP) + ' รายการ →'; }
    else recoMoreEl.style.display = 'none';
  }
}

// ── SECTION: scr-key (per-account picker) ─────────────────────────────────

var _keyScreenState = null; // {accountId, candidates, checkedIds:Set<string>, existingRows:[]}
var _keyScreenEntryFrom = null; // screen name to return to on back — set right before showScreen('key')

function _keySkuDaysAgo(dateStr) {
  if (!dateStr) return null;
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function renderKeyScreen() {
  var scr = document.getElementById('scr-key');
  if (!scr) return;
  var accountId = (typeof currentAccountId !== 'undefined') ? currentAccountId : null;
  var accountName = (accountId && typeof bulkAccountNames !== 'undefined' && bulkAccountNames[accountId]) || '—';
  if (!accountId || accountId === 'default') {
    scr.innerHTML = '<div class="key-screen-pad"><div class="key-empty-state">เลือกร้านก่อน — กลับไปที่คิว Key SKU แล้วเลือกร้าน</div></div>';
    return;
  }
  var candidates = computeKeySkuCandidatesForAccount(accountId);
  var backTarget = _keyScreenEntryFrom || 'key-queue';
  scr.innerHTML =
    '<div class="key-screen-pad">' +
      '<div class="key-header">' +
        '<button class="key-back-btn" onclick="showScreen(\'' + backTarget + '\')">' + _KEY_BACK_SVG + '</button>' +
        '<div><div class="key-header-title">' + _keySkuEsc(accountName) + '</div><div class="key-header-sub">Key SKU</div></div>' +
      '</div>' +
      '<div id="key-body-slot">กำลังโหลด...</div>' +
    '</div>';
  _keySkuEnsureLoaded(accountId).then(function (st) {
    var existingIds = st.existingIds;
    var recommended = candidates.filter(function (c) { return !existingIds.has(String(c.id)); });
    _keyScreenState = {
      accountId: accountId,
      candidates: recommended,
      checkedIds: new Set(recommended.map(function (c) { return String(c.id); })), // pre-ticked — rep unticks the wrong ones
      existingRows: st.rows
    };
    _keyRenderBody();
  });
}

function _keyRenderBody() {
  var s = _keyScreenState;
  if (!s) return;
  var slot = document.getElementById('key-body-slot');
  if (!slot) return;

  var recoHtml = s.candidates.length
    ? s.candidates.map(function (c) {
        var checked = s.checkedIds.has(String(c.id));
        var badgeHtml = c.badges.map(function (b) {
          return '<span class="skbadge skbadge-' + (b.key === 'sole_source' ? 'sole-source' : b.key === 'newness' ? 'newness-key' : 'concentration-key') + '">' + _keySkuEsc(b.label) + '</span>';
        }).join('');
        return '<div class="key-row" data-sku-id="' + _keySkuEsc(c.id) + '" onclick="toggleKeyRow(this)">' +
          '<div class="key-check' + (checked ? '' : ' off') + '">' + _KEY_CHECK_SVG + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="key-sku-name">' + _keySkuEsc(c.name) + '</div>' +
            (badgeHtml ? '<div class="sku-badge-row">' + badgeHtml + '</div>' : '') +
          '</div>' +
        '</div>';
      }).join('')
    : '<div class="key-empty-state">ยังไม่มี SKU ที่เข้าเกณฑ์แนะนำสำหรับร้านนี้ — เพิ่มเองได้ด้านล่าง</div>';

  var existingHtml = '';
  if (s.existingRows.length) {
    var showN = Math.min(6, s.existingRows.length);
    existingHtml = s.existingRows.slice(0, showN).map(function (r) {
      var days = _keySkuDaysAgo(r.set_at);
      var stale = false; // v1: staleness needs last_order_date lookup against current bulkSkusData — left for a follow-up pass
      return '<div class="key-existing-row">' +
        '<div style="flex:1;min-width:0">' +
          '<div class="key-sku-name">' + _keySkuEsc(r.sku_name) + '</div>' +
          '<div class="key-existing-meta' + (stale ? ' stale' : '') + '">Key SKU ตั้งแต่ ' + (r.set_at ? new Date(r.set_at).toLocaleDateString('th-TH') : '—') + '</div>' +
        '</div>' +
        '<button class="key-remove-btn" onclick="keyRemoveExisting(\'' + _keySkuAttrEsc(r.sku_id) + '\')">เอาออก</button>' +
      '</div>';
    }).join('') + (s.existingRows.length > showN ? '<div class="key-more-hint">และอีก ' + (s.existingRows.length - showN) + ' รายการ</div>' : '');
  }

  slot.innerHTML =
    '<div class="key-summary-bar">' +
      '<div class="key-summary-cell"><div class="key-summary-label">ยืนยันแล้ว</div><div class="key-summary-val">' + s.existingRows.length + '</div></div>' +
      '<div class="key-summary-cell reco"><div class="key-summary-label">แนะนำเพิ่ม</div><div class="key-summary-val">' + s.candidates.length + '</div></div>' +
    '</div>' +
    (s.candidates.length ? '<div class="key-sec-label">แนะนำให้เป็น Key</div>' + recoHtml : recoHtml) +
    (s.existingRows.length ? '<div class="key-sec-label">เป็น Key SKU อยู่แล้ว</div>' + existingHtml : '') +
    '<div class="key-sec-label">เพิ่มเอง</div>' +
    '<input type="text" class="key-add-search" placeholder="ค้นหา SKU อื่น..." oninput="keySearchAddSku(this.value)">' +
    '<div class="key-add-results" id="key-add-results"></div>' +
    '<div class="key-footer">' +
      '<div class="key-footer-count">เลือกไว้ <b id="key-footer-n">' + s.checkedIds.size + '</b> SKU</div>' +
      '<button class="key-confirm-btn" onclick="keyConfirmSelections()">ยืนยัน</button>' +
    '</div>';
}

function toggleKeyRow(el) {
  var s = _keyScreenState;
  if (!s) return;
  var skuId = el.getAttribute('data-sku-id');
  var box = el.querySelector('.key-check');
  if (s.checkedIds.has(skuId)) {
    s.checkedIds.delete(skuId);
    box.classList.add('off');
  } else {
    s.checkedIds.add(skuId);
    box.classList.remove('off');
  }
  var footerN = document.getElementById('key-footer-n');
  if (footerN) footerN.textContent = s.checkedIds.size;
}

function keyRemoveExisting(skuId) {
  var s = _keyScreenState;
  if (!s) return;
  _keySkuRemoveOne(s.accountId, skuId).then(function () {
    if (typeof showToast === 'function') showToast('เอา ' + skuId + ' ออกจาก Key SKU แล้ว');
    renderKeyScreen(); // re-fetch + repaint — coverage recompute is live, not cached
  });
}

function keySearchAddSku(query) {
  var s = _keyScreenState;
  var results = document.getElementById('key-add-results');
  if (!s || !results) return;
  query = (query || '').trim().toLowerCase();
  if (!query) { results.innerHTML = ''; return; }
  var byMonth = (typeof bulkSkusData !== 'undefined' && bulkSkusData[s.accountId]) || {};
  var months = Object.keys(byMonth).sort(function (a, b) { return _keySkuMonthSort(b) - _keySkuMonthSort(a); });
  var latestRows = months.length ? (byMonth[months[0]] || []) : [];
  var alreadyKey = new Set(s.existingRows.map(function (r) { return String(r.sku_id); }));
  var alreadyCandidate = new Set(s.candidates.map(function (c) { return String(c.id); }));
  var matches = latestRows.filter(function (r) {
    return r && r.n && r.n.toLowerCase().indexOf(query) !== -1 && !alreadyKey.has(String(r.id)) && !alreadyCandidate.has(String(r.id));
  }).slice(0, 8);
  results.innerHTML = matches.length
    ? matches.map(function (r) {
        return '<div class="key-add-row"><div class="key-sku-name">' + _keySkuEsc(r.n) + '</div>' +
          '<button class="key-add-btn" onclick="keyAddSku(\'' + _keySkuAttrEsc(r.id) + '\',\'' + _keySkuAttrEsc(r.n) + '\')">เพิ่ม</button></div>';
      }).join('')
    : '<div class="key-more-hint">ไม่พบ SKU ที่ตรงกับคำค้นนี้</div>';
}

function keyAddSku(skuId, skuName) {
  var s = _keyScreenState;
  if (!s) return;
  s.candidates.push({ id: skuId, name: skuName, score: 0, breakdown: {}, badges: [] });
  s.checkedIds.add(String(skuId));
  var results = document.getElementById('key-add-results');
  if (results) results.innerHTML = '';
  var input = document.querySelector('.key-add-search');
  if (input) input.value = '';
  _keyRenderBody();
}

function keyConfirmSelections() {
  var s = _keyScreenState;
  if (!s) return;
  var items = s.candidates.filter(function (c) { return s.checkedIds.has(String(c.id)); });
  if (!items.length) { if (typeof showToast === 'function') showToast('ยังไม่ได้เลือก SKU'); return; }
  _keySkuConfirm(s.accountId, items).then(function () {
    if (typeof showToast === 'function') showToast('บันทึก Key SKU แล้ว ' + items.length + ' รายการ');
    renderKeyScreen(); // repaint from fresh DB state — moves confirmed items into "เป็น Key SKU อยู่แล้ว"
  });
}

// ── SECTION: Products popover (nav) + kam-overview split button ──────────
// v_key pivot (2026-08-16): self-review found the original entry points (a
// standalone card wedged into the portview tier grid, a rollup section stacked
// above teamview's own stats) visually crowded existing screens. Replaced with:
//   (1) the "Save" nav tab renamed "Products" — tapping it opens this popover
//       instead of navigating away, offering SAVE or Key SKU in-flow.
//   (2) a sibling button next to "Account Insight" on the account screen,
//       splitting that row 50/50 instead of adding a new row.
// Colour is --fk-orange (#FF6600, real Freshket brand orange, verified against
// freshket.co) — not --fk-red (an invented token, never real Freshket brand).

function _keySkuSaveSubline() {
  if (typeof currentAccountId === 'undefined' || !currentAccountId || currentAccountId === 'default') return 'เลือกร้านก่อน';
  if (typeof senseActivated === 'undefined' || !senseActivated) return 'แตะเพื่อเริ่มวิเคราะห์';
  var n = (typeof OPPS !== 'undefined' && OPPS) ? OPPS.length : 0;
  return n > 0 ? (n + ' SKU มีโอกาสประหยัด') : 'ไม่พบช่องประหยัดเพิ่ม';
}

function renderProductsPopover() {
  var pop = document.getElementById('products-popover');
  if (!pop) return;
  var accountId = (typeof currentAccountId !== 'undefined') ? currentAccountId : null;
  var saveSub = _keySkuSaveSubline();
  var keySub = 'กำลังโหลด...';
  pop.innerHTML =
    '<div class="pv-row" onclick="productsGoSave()">' +
      '<svg width="16" height="16" viewBox="0 0 10 10" fill="currentColor"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"></path></svg>' +
      '<div><div>SAVE</div><div class="pv-sub" id="pv-save-sub">' + _keySkuEsc(saveSub) + '</div></div>' +
    '</div>' +
    '<div class="pv-row key" onclick="productsGoKeySku()">' +
      _KEY_ICON_SVG +
      '<div><div>Key SKU</div><div class="pv-sub" id="pv-key-sub">' + _keySkuEsc(keySub) + '</div></div>' +
    '</div>';
  if (!accountId || accountId === 'default') {
    _keySkuEnsurePortfolioLoaded().then(function (coveredIds) {
      var accounts = (typeof getPortviewAccounts === 'function') ? getPortviewAccounts() : [];
      var pending = accounts.filter(function (a) {
        return computeKeySkuCandidatesForAccount(a.id).length > 0 && !coveredIds.has(a.id);
      }).length;
      var el = document.getElementById('pv-key-sub');
      if (el) el.textContent = pending > 0 ? (pending + ' ร้านยังไม่ได้ตรวจ') : 'ตรวจครบทุกร้านแล้ว';
    });
  } else {
    _keySkuEnsureLoaded(accountId).then(function (st) {
      var pending = computeKeySkuCandidatesForAccount(accountId).filter(function (c) { return !st.existingIds.has(String(c.id)); }).length;
      var el = document.getElementById('pv-key-sub');
      if (el) el.textContent = pending > 0 ? (pending + ' SKU รอตรวจ') : (st.existingIds.size + ' SKU ยืนยันแล้ว');
    });
  }
}

function toggleProductsPopover(btnEl, forceClose) {
  var pop = document.getElementById('products-popover');
  var backdrop = document.getElementById('products-popover-backdrop');
  if (!pop || !backdrop) return;
  var willShow = !forceClose && pop.style.display === 'none';
  if (!willShow) { pop.style.display = 'none'; backdrop.style.display = 'none'; return; }
  if (btnEl && btnEl.getBoundingClientRect) {
    var r = btnEl.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var halfW = 104; // .products-popover width:208px / 2 — keep in sync with styles_key.css
    var vv = window.visualViewport;
    var voffTop = (vv && vv.offsetTop) || 0;
    var vh = (vv && vv.height) || window.innerHeight;
    // Clamp against the app shell's own bounds (.bnav is the real max-width:440px shell,
    // centered) rather than the raw window — on a viewport wider than the shell (desktop
    // testing, tablets) window.innerWidth alone would place the popover off to one side.
    var bnavRect = (function () { var el = document.querySelector('.bnav'); return el ? el.getBoundingClientRect() : null; })();
    var shellLeft = bnavRect ? bnavRect.left : ((vv && vv.offsetLeft) || 0);
    var shellRight = bnavRect ? bnavRect.right : (((vv && vv.width) || window.innerWidth) + ((vv && vv.offsetLeft) || 0));
    var margin = 10; // small safety gutter from the shell edge
    pop.style.left = Math.max(shellLeft + halfW + margin, Math.min(shellRight - halfW - margin, cx)) + 'px';
    // Vertical: mirror installFabSafeZone's spirit (06_portview_teamview.js) — clamp so the
    // popover can never render pushed above the topbar area, even from an unusual btnEl position.
    var rawBottom = vh + voffTop - r.top + 10;
    pop.style.bottom = Math.max(10, Math.min(rawBottom, vh + voffTop - 80)) + 'px';
  }
  renderProductsPopover();
  pop.style.display = 'block';
  backdrop.style.display = 'block';
}

// Whatever screen div currently carries the 'on' class — used to send scr-key's
// back button to wherever the user actually came from, instead of a hardcoded target.
function _keySkuCurrentScreenName() {
  var el = document.querySelector('.scr.on');
  return el ? el.id.replace(/^scr-/, '') : null;
}

// Byte-identical to what nav-opportunities's onclick used to do directly,
// before Products/the popover existed — same Sense-gate/overlay-nav behaviour.
// v_key round3: now reachable from Home too (nav-opportunities is no longer
// disabled there) — this path never ran with no account before, and 'opportunities'
// was never built to render without one, so guard it explicitly instead of guessing.
function productsGoSave() {
  toggleProductsPopover(null, true);
  var accountId = (typeof currentAccountId !== 'undefined') ? currentAccountId : null;
  if (!accountId || accountId === 'default') {
    if (typeof showToast === 'function') showToast('เลือกร้านก่อนเพื่อดู SAVE');
    return;
  }
  if (isKAM && document.body.classList.contains('restaurant-sheet')) { _overlayNav('opportunities'); return; }
  showScreen('opportunities');
  document.body.classList.remove('sense-on-report');
}

function productsGoKeySku() {
  toggleProductsPopover(null, true);
  var accountId = (typeof currentAccountId !== 'undefined') ? currentAccountId : null;
  if (accountId && accountId !== 'default') {
    _keyScreenEntryFrom = _keySkuCurrentScreenName() || 'overview';
    showScreen('key');
  } else {
    showScreen('key-queue');
  }
}

// Portfolio-wide pending-account count on the Products nav badge — cheap,
// loops accounts already in memory, one bulk Supabase query (not N-per-account).
function renderKeySkuNavBadge() {
  var badge = document.getElementById('key-nav-badge');
  if (!badge) return;
  var accounts = (typeof getPortviewAccounts === 'function') ? getPortviewAccounts() : [];
  if (!accounts.length) { badge.style.display = 'none'; return; }
  _keySkuEnsurePortfolioLoaded().then(function (coveredIds) {
    var pending = accounts.filter(function (a) {
      return computeKeySkuCandidatesForAccount(a.id).length > 0 && !coveredIds.has(a.id);
    }).length;
    badge.textContent = pending;
    badge.style.display = pending > 0 ? 'flex' : 'none';
  });
}

// Account-level split button (right half of the Account Insight row).
function renderKeySkuSplitButton() {
  var btn = document.getElementById('key-sku-split-btn');
  var lbl = document.getElementById('key-sku-split-btn-label');
  if (!btn || !lbl) return;
  var accountId = (typeof currentAccountId !== 'undefined') ? currentAccountId : null;
  if (!accountId || accountId === 'default') { btn.style.display = 'none'; return; }
  var candidates = computeKeySkuCandidatesForAccount(accountId);
  _keySkuEnsureLoaded(accountId).then(function (st) {
    var pending = candidates.filter(function (c) { return !st.existingIds.has(String(c.id)); }).length;
    if (candidates.length === 0 && st.existingIds.size === 0) { btn.style.display = 'none'; return; }
    btn.style.display = 'inline-flex';
    lbl.textContent = pending > 0 ? ('Key SKU · ' + pending) : ('Key SKU · ' + st.existingIds.size + ' ตรวจแล้ว');
  });
}
