// ── nrr_data.js — R2 CSV fetch + parse for /nrr ──────────────────────────
// parseCSVRow ported verbatim from src/02_data_pipeline.js (repo-wide
// convention — no external CSV library anywhere in this codebase).
// The bulkQnrrData shape built here matches EXACTLY what Sense's own
// bulk-qnrr-single handler builds (src/02_data_pipeline.js:1120-1176),
// including the 29-column order, so nrr_logic.js's ported _qnrrCompute
// works unmodified against it.

var R2_BASE = 'https://pub-12078d17646340808024e8cc95504995.r2.dev';

window.bulkQnrrData = { loaded: false };

function parseCSVRow(row) {
  var fields = []; var cur = ''; var inQ = false;
  for (var i = 0; i < row.length; i++) {
    var c = row[i];
    if (inQ) {
      if (c === '"' && row[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { cur += c; }
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { fields.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
  }
  fields.push(cur.trim());
  return fields;
}

function _nrrParseQnrrCsv(text) {
  var lines = text.trim().split('\n').slice(1).filter(function (l) { return l.trim(); });
  var byKamEmail = {}, byTlEmail = {}, allRows = [];
  lines.forEach(function (l) {
    var p = parseCSVRow(l);
    if (!p[0] || !p[1]) return;
    var row = {
      period_month:            (p[0] || '').trim(),
      movement_type:           (p[1] || '').trim(),
      transfer_scope:          (p[2] || '').trim(),
      current_portfolio:       (p[3] || '').trim(),
      current_staff_owner:     (p[4] || '').trim(),
      base_portfolio:          (p[5] || '').trim(),
      base_staff_owner:        (p[6] || '').trim(),
      outlet_id:               (p[7] || '').trim(),
      account_id:              (p[8] || '').trim(),
      account_name:            (p[9] || '').trim(),
      res_name:                (p[10] || '').trim(),
      account_type:            (p[11] || '').trim(),
      cohort_month:            (p[12] || '').trim(),
      curr_gmv:                parseFloat(p[13]) || 0,
      base_gmv:                parseFloat(p[14]) || 0,
      base_days:               parseInt(p[15], 10) || 31,
      curr_days:               parseInt(p[16], 10) || 30,
      first_dollar_date:       (p[17] || '').trim(),
      first_portfolio_date:    (p[18] || '').trim(),
      first_dollar_owner:      (p[19] || '').trim(),
      new_user_exp_date:       (p[20] || '').trim(),
      latest_tl:               (p[21] || '').trim(),
      base_tl:                 (p[22] || '').trim(),
      latest_staff_owner:      (p[23] || '').trim(),
      latest_commercial_owner: (p[24] || '').trim(),
      latest_kam_email:        (p[25] || '').trim(),
      latest_tl_email:         (p[26] || '').trim(),
      base_kam_email:          (p[27] || '').trim(),
      base_tl_email:           (p[28] || '').trim()
    };
    allRows.push(row);
    // Blank latest_kam_email/latest_tl_email rows (a handful exist in real
    // data) are intentionally left out of the per-person indices but still
    // land in allRows — org/admin-scope aggregation must never depend on a
    // per-person key being present (see docs on the v840-class bug).
    if (row.latest_kam_email) {
      if (!byKamEmail[row.latest_kam_email]) byKamEmail[row.latest_kam_email] = [];
      byKamEmail[row.latest_kam_email].push(row);
    }
    if (row.latest_tl_email) {
      if (!byTlEmail[row.latest_tl_email]) byTlEmail[row.latest_tl_email] = [];
      byTlEmail[row.latest_tl_email].push(row);
    }
  });
  return { byKamEmail: byKamEmail, byTlEmail: byTlEmail, allRows: allRows };
}

async function nrrFetchQnrrCsv(force) {
  if (window.bulkQnrrData && window.bulkQnrrData.loaded && !force) return window.bulkQnrrData;
  var url = R2_BASE + '/' + QNRR_CFG.csv_file + '?cb=' + Date.now();
  var lastErr = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var text = await res.text();
      var parsed = _nrrParseQnrrCsv(text);
      window.bulkQnrrData = {
        byKamEmail: parsed.byKamEmail,
        byTlEmail: parsed.byTlEmail,
        allRows: parsed.allRows,
        loaded: true,
        loadedAt: Date.now()
      };
      return window.bulkQnrrData;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise(function (r) { setTimeout(r, 800 * (attempt + 1)); });
    }
  }
  console.warn('[nrr] failed to load ' + QNRR_CFG.csv_file, lastErr);
  throw lastErr;
}
window.nrrFetchQnrrCsv = nrrFetchQnrrCsv;

// List of distinct TLs present in the data (email + display name), sorted
// by display name — drives the cross-team comparison table (admin only).
function nrrListTeams() {
  var qd = window.bulkQnrrData;
  if (!qd || !qd.loaded) return [];
  var seen = {};
  var out = [];
  (qd.allRows || []).forEach(function (r) {
    var email = r.latest_tl_email;
    if (!email || seen[email]) return;
    seen[email] = true;
    out.push({ email: email, name: r.latest_tl || email });
  });
  out.sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  return out;
}
window.nrrListTeams = nrrListTeams;

// List of distinct KAMs within a team (by latest_tl_email), for the
// Team -> KAM drill-down.
function nrrListKamsForTeam(tlEmail) {
  var qd = window.bulkQnrrData;
  if (!qd || !qd.loaded) return [];
  var seen = {};
  var out = [];
  (qd.byTlEmail[tlEmail] || []).forEach(function (r) {
    var email = r.latest_kam_email;
    if (!email || seen[email]) return;
    seen[email] = true;
    out.push({ email: email, name: r.latest_staff_owner || email });
  });
  out.sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
  return out;
}
window.nrrListKamsForTeam = nrrListKamsForTeam;

// ── PM / Admin portfolio views ───────────────────────────────────────────
// pm_view.csv / admin_view.csv come from DIFFERENT SQL sources
// (sql/q3_2026_movement_pm_view.sql, .../admin_view.sql) with a SMALLER
// 21-column schema — no latest_kam_email/latest_tl_email/latest_tl/base_tl
// at all, because PM/Admin portfolios have no per-KAM/TL ownership concept.
// PM rows are ~99% staff-attributed by NAME (no email); Admin rows are ~99%
// blank. Neither can be grouped by person reliably, so both are grouped by
// account_type (SA/MC vs Chain) instead — see nrrAccountBucket() below.
window.bulkPmData = { loaded: false };
window.bulkAdminData = { loaded: false };

function _nrrParsePortfolioCsv(text) {
  var lines = text.trim().split('\n').slice(1).filter(function (l) { return l.trim(); });
  var allRows = [];
  lines.forEach(function (l) {
    var p = parseCSVRow(l);
    if (!p[0] || !p[1]) return;
    allRows.push({
      period_month:         (p[0] || '').trim(),
      movement_type:        (p[1] || '').trim(),
      transfer_scope:       (p[2] || '').trim(),
      current_portfolio:    (p[3] || '').trim(),
      current_staff_owner:  (p[4] || '').trim(),
      base_portfolio:       (p[5] || '').trim(),
      base_staff_owner:     (p[6] || '').trim(),
      outlet_id:            (p[7] || '').trim(),
      account_id:           (p[8] || '').trim(),
      account_name:         (p[9] || '').trim(),
      res_name:             (p[10] || '').trim(),
      account_type:         (p[11] || '').trim(),
      cohort_month:         (p[12] || '').trim(),
      curr_gmv:             parseFloat(p[13]) || 0,
      base_gmv:             parseFloat(p[14]) || 0,
      base_days:            parseInt(p[15], 10) || 31,
      curr_days:            parseInt(p[16], 10) || 30,
      first_dollar_date:    (p[17] || '').trim(),
      first_portfolio_date: (p[18] || '').trim(),
      first_dollar_owner:   (p[19] || '').trim(),
      new_user_exp_date:    (p[20] || '').trim()
    });
  });
  return allRows;
}

// Shared fetch for both portfolio-view files. Returns {allRows, loaded}
// or {allRows:[], loaded:false, notFound:true} on 404 — callers must show
// an explicit "PM/Admin data not available yet" state, never fail silently
// (this file is genuinely not uploaded to R2 as of first implementation —
// confirmed 404 when checked directly).
async function _nrrFetchPortfolioCsv(filename) {
  var url = R2_BASE + '/' + filename + '?cb=' + Date.now();
  try {
    var res = await fetch(url);
    if (res.status === 404) return { allRows: [], loaded: false, notFound: true };
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    var allRows = _nrrParsePortfolioCsv(text);
    // Staleness guard (added 2026-07-09): pm_view.csv/admin_view.csv are
    // each regenerated by a separate BigQuery run + manual R2 upload, not
    // wired to any auto-refresh — a run gets skipped and nobody notices
    // until the numbers look off (caught for admin_view: it silently held
    // 2026-Q2 data — Apr/May/Jun — three months INTO Q3). Flag it loudly
    // instead of quietly rendering last quarter's movement as "current."
    var months = Array.from(new Set(allRows.map(function (r) { return r.period_month; })));
    var isStale = months.length > 0 && !months.some(function (m) { return QNRR_CFG.q_months.indexOf(m) > -1; });
    return { allRows: allRows, loaded: true, loadedAt: Date.now(), months: months, isStale: isStale };
  } catch (e) {
    console.warn('[nrr] failed to load ' + filename, e);
    return { allRows: [], loaded: false, error: e.message };
  }
}

async function nrrFetchPmCsv(force) {
  if (window.bulkPmData.loaded && !force) return window.bulkPmData;
  window.bulkPmData = await _nrrFetchPortfolioCsv('pm_view.csv');
  return window.bulkPmData;
}
window.nrrFetchPmCsv = nrrFetchPmCsv;

async function nrrFetchAdminCsv(force) {
  if (window.bulkAdminData.loaded && !force) return window.bulkAdminData;
  window.bulkAdminData = await _nrrFetchPortfolioCsv('admin_view.csv');
  return window.bulkAdminData;
}
window.nrrFetchAdminCsv = nrrFetchAdminCsv;

// VP view — ALL THREE portfolios pooled (KAM+PM+ADMIN as one book). Same
// 21-col schema as pm/admin views; produced by sql/q3_2026_movement_vp_view.sql.
// 404-graceful like the others: until vp_view.csv is uploaded to R2 the
// hero falls back to the KAM headline and the ภาพรวม switcher option hides.
window.bulkVpData = { loaded: false };

async function nrrFetchVpCsv(force) {
  if (window.bulkVpData.loaded && !force) return window.bulkVpData;
  window.bulkVpData = await _nrrFetchPortfolioCsv('vp_view.csv');
  return window.bulkVpData;
}
window.nrrFetchVpCsv = nrrFetchVpCsv;

// Single place that maps account_type -> the 2 buckets the business cares
// about ('Unknown' and any unexpected value fall into 'other', confirmed
// ~1 stray row in real pm_view.csv).
function nrrAccountBucket(row) {
  var t = (row.account_type || '').trim();
  if (t === 'Chain') return 'chain';
  if (t === 'SA' || t === 'MC') return 'sa_mc';
  return 'other';
}
window.nrrAccountBucket = nrrAccountBucket;

// ── Commission V2 — per-KAM upsell bundle (lazy, on-demand) ─────────────
// Mirrors src/02_data_pipeline.js's per-KAM bundle handler exactly: same
// R2_BASE, same safe-key derivation, same "no kam_email column" format
// (that column only exists in the ALL-KAMs bulk file, not the per-KAM one —
// confirmed by reading the real parser, not assumed from the SQL header
// comment, which describes the bulk file's 7 cols, not this 6-col one).
var nrrUpsellBundleCache = {}; // { [email]: {data, baselineGroups, loaded} }
var nrrUpsellBundleInFlight = {};

function _nrrKamSafeKey(email) {
  return (email || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
}

var _TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function nrrThMonthLabel(d) { return _TH_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543); }

// Every existing last_order_date consumer just echoes the raw ISO string —
// this is a deliberate new convention for the churn drawer specifically,
// since "29 มิ.ย." reads far better next to a Thai-labeled ฿ amount than
// "2026-06-29" does. Day-level only (no year) to match the month chips'
// own terseness.
function nrrShortThaiDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  var mIdx = parseInt(m[2], 10) - 1;
  if (mIdx < 0 || mIdx > 11) return null;
  return parseInt(m[3], 10) + ' ' + _TH_MONTHS[mIdx];
}
window.nrrShortThaiDate = nrrShortThaiDate;

// Rolling, "today"-relative 3-month window — matches 02_data_pipeline.js's
// _p1BaselineLabels exactly (lag-1 anchor, months 1/2/3 back from there).
// NOTE: this is deliberately NOT the quarterly-pinned base_month window —
// P1's "has this outlet ever bought this group" check floats with today's
// date in the real system too; only P3's baseline magnitude is quarter-pinned
// (see nrrP3WindowLabels). Faithfully replicating both, not "fixing" either.
function nrrP1BaselineLabels() {
  var lag = new Date(); lag.setDate(lag.getDate() - 1);
  var set = {};
  [1, 2, 3].forEach(function (i) {
    var d = new Date(lag.getFullYear(), lag.getMonth() - i, 1);
    set[nrrThMonthLabel(d)] = true;
  });
  return set;
}

function nrrCommCurrentMonthLabel() {
  var lag = new Date(); lag.setDate(lag.getDate() - 1);
  return nrrThMonthLabel(lag);
}

// Quarterly-pinned window: labels for baseMonthIso ('2026-06') and the
// (count-1) months before it — matches 07a_commission_engine.js's
// _commBaseMonthLabels(baseMonthOverride, count) exactly.
function nrrP3WindowLabels(baseMonthIso, count) {
  var parts = baseMonthIso.split('-');
  var yr = parseInt(parts[0], 10), mo = parseInt(parts[1], 10); // mo is 1-based
  var out = [];
  for (var i = 0; i < count; i++) {
    var d = new Date(yr, mo - 1 - i, 1);
    out.push(nrrThMonthLabel(d));
  }
  return out;
}
window.nrrP3WindowLabels = nrrP3WindowLabels;
window.nrrCommCurrentMonthLabel = nrrCommCurrentMonthLabel;

function nrrDaysInLabel(label) {
  try {
    var parts = label.split(' ');
    var mIdx = _TH_MONTHS.indexOf(parts[0]);
    var year = parseInt(parts[1], 10) - 543;
    if (mIdx < 0 || !year) return 30;
    return new Date(year, mIdx + 1, 0).getDate();
  } catch (e) { return 30; }
}
window.nrrDaysInLabel = nrrDaysInLabel;

async function nrrFetchUpsellBundle(kamEmail) {
  if (nrrUpsellBundleCache[kamEmail] && nrrUpsellBundleCache[kamEmail].loaded) return nrrUpsellBundleCache[kamEmail];
  if (nrrUpsellBundleInFlight[kamEmail]) return nrrUpsellBundleInFlight[kamEmail];
  var safeKey = _nrrKamSafeKey(kamEmail);
  var url = R2_BASE + '/sense_upsell_' + safeKey + '.csv?cb=' + Date.now();
  var p = (async function () {
    try {
      var res = await fetch(url);
      if (res.status === 404) return { data: {}, baselineGroups: {}, loaded: false, notFound: true };
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var text = await res.text();
      var lines = text.trim().split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (lines.length && /account_id/i.test(lines[0])) lines = lines.slice(1);

      var p1Labels = nrrP1BaselineLabels();
      var currLabel = nrrCommCurrentMonthLabel();
      var data = {};             // accountId -> outletId -> groupKey -> monthLabel -> {existingGmv,totalGmv}
      var baselineGroups = {};   // accountId -> outletId -> Set-like object of groupKey -> true

      lines.forEach(function (l) {
        // Per-KAM bundle has NO kam_email column: account_id, outlet_id,
        // month_label, group_key, existing_gmv, total_gmv (6 cols).
        var p = parseCSVRow(l);
        var accountId = (p[0] || '').trim();
        var outletId = (p[1] || '').trim();
        var monthLabel = (p[2] || '').trim();
        var groupKey = (p[3] || '').trim();
        var existingGmv = parseFloat(p[4]) || 0;
        var totalGmv = parseFloat(p[5]) || 0;
        if (!accountId || !outletId || !monthLabel || !groupKey) return;

        if (!data[accountId]) data[accountId] = {};
        if (!data[accountId][outletId]) data[accountId][outletId] = {};
        if (!data[accountId][outletId][groupKey]) data[accountId][outletId][groupKey] = {};
        data[accountId][outletId][groupKey][monthLabel] = { existingGmv: existingGmv, totalGmv: totalGmv };

        if (monthLabel !== currLabel && totalGmv > 0 && p1Labels[monthLabel]) {
          if (!baselineGroups[accountId]) baselineGroups[accountId] = {};
          if (!baselineGroups[accountId][outletId]) baselineGroups[accountId][outletId] = {};
          baselineGroups[accountId][outletId][groupKey] = true;
        }
      });

      var bundle = { data: data, baselineGroups: baselineGroups, loaded: true, loadedAt: Date.now() };
      nrrUpsellBundleCache[kamEmail] = bundle;
      return bundle;
    } catch (e) {
      console.warn('[nrr] failed to load upsell bundle for ' + kamEmail, e);
      return { data: {}, baselineGroups: {}, loaded: false, error: e.message };
    } finally {
      delete nrrUpsellBundleInFlight[kamEmail];
    }
  })();
  nrrUpsellBundleInFlight[kamEmail] = p;
  return p;
}
window.nrrFetchUpsellBundle = nrrFetchUpsellBundle;

// ── Portfolio layer (Phase B) — portview.csv ─────────────────────────────
// One row per account, precomputed pace/churn/missing-category signals —
// confirmed against the real file in R2 (2026-07-09), 20 columns. Fetched
// once, lazily, the first time any role opens the Portfolio layer (NOT part
// of nrrRefresh()'s dashboard fetch group — different concern, different
// audience: every role visits Portfolio, only tl/admin visit the dashboard).
window.bulkPortviewData = { loaded: false };

function _nrrParsePortviewCsv(text) {
  var lines = text.trim().split('\n').slice(1).filter(function (l) { return l.trim(); });
  var byKamEmail = {}, allRows = [];
  lines.forEach(function (l) {
    var p = parseCSVRow(l);
    if (!p[0]) return;
    var row = {
      account_id:            (p[0] || '').trim(),
      account_name:          (p[1] || '').trim(),
      last_month_gmv:        parseFloat(p[2]) || 0,
      gmv_to_date:           parseFloat(p[3]) || 0,
      days_elapsed:          parseInt(p[4], 10) || 0,
      days_in_month:         parseInt(p[5], 10) || 30,
      runrate_gmv:           parseFloat(p[6]) || 0,
      account_type:          (p[7] || '').trim(),
      churned_sku_count:     parseInt(p[8], 10) || 0,
      churned_gmv:           parseFloat(p[9]) || 0,
      top_churned_names:     (p[10] || '').trim(),
      missing_cat_count:     parseInt(p[11], 10) || 0,
      missing_cats:          (p[12] || '').trim(),
      last_month_sku_count:  parseInt(p[13], 10) || 0,
      cur_sku_count:         parseInt(p[14], 10) || 0,
      orders_to_date:        parseInt(p[15], 10) || 0,
      kam_name:              (p[16] || '').trim(),
      kam_email:             (p[17] || '').trim(),
      tl_email:              (p[18] || '').trim(),
      days_with_current_kam: parseInt(p[19], 10) || 0
    };
    allRows.push(row);
    if (row.kam_email) {
      if (!byKamEmail[row.kam_email]) byKamEmail[row.kam_email] = [];
      byKamEmail[row.kam_email].push(row);
    }
  });
  return { byKamEmail: byKamEmail, allRows: allRows };
}

async function nrrFetchPortviewCsv(force) {
  if (window.bulkPortviewData.loaded && !force) return window.bulkPortviewData;
  try {
    var res = await fetch(R2_BASE + '/portview.csv?cb=' + Date.now());
    if (res.status === 404) { window.bulkPortviewData = { allRows: [], byKamEmail: {}, loaded: false, notFound: true }; return window.bulkPortviewData; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    var parsed = _nrrParsePortviewCsv(text);
    window.bulkPortviewData = { allRows: parsed.allRows, byKamEmail: parsed.byKamEmail, loaded: true, loadedAt: Date.now() };
  } catch (e) {
    console.warn('[nrr] failed to load portview.csv', e);
    window.bulkPortviewData = { allRows: [], byKamEmail: {}, loaded: false, error: e.message };
  }
  return window.bulkPortviewData;
}
window.nrrFetchPortviewCsv = nrrFetchPortviewCsv;

// ── Portfolio layer round 2 — bulk_history.csv ───────────────────────────
// account_id, account_name, month_label, gmv, orders — one row per
// account per month (confirmed against the real file in R2, 585KB).
// Fetched lazily alongside portview.csv on first Portfolio visit. Two
// uses: (1) the quarter-base-month lookup nrrPaceSignal needs (see
// nrr_portfolio.js — /nrr intentionally anchors account-level pace to the
// SAME fixed base_month %NRR uses, not Sense's rolling 3-month average),
// (2) the per-account 6-month sparkline.
window.bulkHistoryData = { loaded: false };

function _nrrParseBulkHistoryCsv(text) {
  var lines = text.trim().split('\n').slice(1).filter(function (l) { return l.trim(); });
  var byAccountId = {};
  lines.forEach(function (l) {
    var p = parseCSVRow(l);
    if (!p[0]) return;
    var row = {
      account_id:   (p[0] || '').trim(),
      account_name: (p[1] || '').trim(),
      month_label:  (p[2] || '').trim(),
      gmv:          parseFloat(p[3]) || 0,
      orders:       parseInt(p[4], 10) || 0
    };
    if (!byAccountId[row.account_id]) byAccountId[row.account_id] = [];
    byAccountId[row.account_id].push(row);
  });
  return byAccountId;
}

async function nrrFetchBulkHistoryCsv(force) {
  if (window.bulkHistoryData.loaded && !force) return window.bulkHistoryData;
  try {
    var res = await fetch(R2_BASE + '/bulk_history.csv?cb=' + Date.now());
    if (res.status === 404) { window.bulkHistoryData = { byAccountId: {}, loaded: false, notFound: true }; return window.bulkHistoryData; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    window.bulkHistoryData = { byAccountId: _nrrParseBulkHistoryCsv(text), loaded: true, loadedAt: Date.now() };
  } catch (e) {
    console.warn('[nrr] failed to load bulk_history.csv', e);
    window.bulkHistoryData = { byAccountId: {}, loaded: false, error: e.message };
  }
  return window.bulkHistoryData;
}
window.nrrFetchBulkHistoryCsv = nrrFetchBulkHistoryCsv;

// ── Account view (Phase C) — per-KAM SKU detail ──────────────────────────
// sense_skus_{kamSafeKey}.csv (~6-8MB/KAM) — account_id × month_label ×
// item_id rows. Feeds BOTH the positive/cycle SKU signals (nrr_account.js)
// AND the category SKU-count breakdown (group by dept) — one fetch, two
// uses, same file already used for commission P1/P3 classification
// (nrrFetchUpsellBundle above) but that's a DIFFERENT file (sense_upsell_)
// — do not confuse the two.
var nrrSenseSkusCache = {}; // { [kamEmail]: { byAccountId: {accountId: [row]}, loaded } }
var nrrSenseSkusInFlight = {};

function _nrrParseSenseSkusCsv(text) {
  var lines = text.trim().split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (lines.length && /^account_id,/i.test(lines[0])) lines = lines.slice(1);
  var byAccountId = {};
  lines.forEach(function (l) {
    var p = parseCSVRow(l);
    if (!p[0]) return;
    var row = {
      account_id:       (p[0] || '').trim(),
      month_label:      (p[1] || '').trim(),
      item_id:          (p[2] || '').trim(),
      item_name_th:     (p[3] || '').trim(),
      dept:             (p[4] || '').trim(),
      subclass:         (p[5] || '').trim(),
      temperature:      (p[6] || '').trim(),
      pack_size:        (p[7] || '').trim(),
      gmv_ex_vat:       parseFloat(p[8]) || 0,
      pct:              parseFloat(p[9]) || 0,
      qty_kg:           parseFloat(p[10]) || 0,
      unit_price:       parseFloat(p[11]) || 0,
      order_count:      parseInt(p[12], 10) || 0,
      avg_piece_price:  parseFloat(p[13]) || 0,
      outlet_count_sku: parseInt(p[14], 10) || 0,
      last_order_date:  (p[18] || '').trim()
    };
    if (!byAccountId[row.account_id]) byAccountId[row.account_id] = [];
    byAccountId[row.account_id].push(row);
  });
  return byAccountId;
}

async function nrrFetchSenseSkusCsv(kamEmail) {
  if (nrrSenseSkusCache[kamEmail] && nrrSenseSkusCache[kamEmail].loaded) return nrrSenseSkusCache[kamEmail];
  if (nrrSenseSkusInFlight[kamEmail]) return nrrSenseSkusInFlight[kamEmail];
  var safeKey = _nrrKamSafeKey(kamEmail);
  var p = (async function () {
    try {
      var res = await fetch(R2_BASE + '/sense_skus_' + safeKey + '.csv?cb=' + Date.now());
      if (res.status === 404) return { byAccountId: {}, loaded: false, notFound: true };
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var text = await res.text();
      var bundle = { byAccountId: _nrrParseSenseSkusCsv(text), loaded: true, loadedAt: Date.now() };
      nrrSenseSkusCache[kamEmail] = bundle;
      return bundle;
    } catch (e) {
      console.warn('[nrr] failed to load sense_skus for ' + kamEmail, e);
      return { byAccountId: {}, loaded: false, error: e.message };
    } finally {
      delete nrrSenseSkusInFlight[kamEmail];
    }
  })();
  nrrSenseSkusInFlight[kamEmail] = p;
  return p;
}
window.nrrFetchSenseSkusCsv = nrrFetchSenseSkusCsv;

// sense_sku_outlet_{kamSafeKey}.csv (~1.2MB/KAM) — account_id × item_id ×
// outlet_id, last/this month orders+gmv. Feeds the floating per-outlet
// tooltip on SKU signal rows — confirmed live in R2 under THIS name
// (2026-07-09; an earlier pass guessed "bulk_sku_outlet.csv"/Q12B and
// wrongly concluded the data didn't exist — it does, just under Sense's
// own real filename, cf. 02_data_pipeline.js:839-844,1680).
var nrrSenseSkuOutletCache = {};
var nrrSenseSkuOutletInFlight = {};

function _nrrParseSenseSkuOutletCsv(text) {
  var lines = text.trim().split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (lines.length && /^account_id,/i.test(lines[0])) lines = lines.slice(1);
  var byAccountItem = {}; // accountId -> itemId -> [{outlet_id,outlet_name,last_month_orders,last_month_gmv,this_month_orders,this_month_gmv}]
  lines.forEach(function (l) {
    var p = parseCSVRow(l);
    if (!p[0]) return;
    var accountId = (p[0] || '').trim(), itemId = (p[1] || '').trim();
    if (!byAccountItem[accountId]) byAccountItem[accountId] = {};
    if (!byAccountItem[accountId][itemId]) byAccountItem[accountId][itemId] = [];
    byAccountItem[accountId][itemId].push({
      outlet_id: (p[2] || '').trim(),
      outlet_name: (p[3] || '').trim(),
      last_month_orders: parseInt(p[4], 10) || 0,
      last_month_gmv: parseFloat(p[5]) || 0,
      this_month_orders: parseInt(p[6], 10) || 0,
      this_month_gmv: parseFloat(p[7]) || 0
    });
  });
  return byAccountItem;
}

async function nrrFetchSenseSkuOutletCsv(kamEmail) {
  if (nrrSenseSkuOutletCache[kamEmail] && nrrSenseSkuOutletCache[kamEmail].loaded) return nrrSenseSkuOutletCache[kamEmail];
  if (nrrSenseSkuOutletInFlight[kamEmail]) return nrrSenseSkuOutletInFlight[kamEmail];
  var safeKey = _nrrKamSafeKey(kamEmail);
  var p = (async function () {
    try {
      var res = await fetch(R2_BASE + '/sense_sku_outlet_' + safeKey + '.csv?cb=' + Date.now());
      if (res.status === 404) return { byAccountItem: {}, loaded: false, notFound: true };
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var text = await res.text();
      var bundle = { byAccountItem: _nrrParseSenseSkuOutletCsv(text), loaded: true, loadedAt: Date.now() };
      nrrSenseSkuOutletCache[kamEmail] = bundle;
      return bundle;
    } catch (e) {
      console.warn('[nrr] failed to load sense_sku_outlet for ' + kamEmail, e);
      return { byAccountItem: {}, loaded: false, error: e.message };
    } finally {
      delete nrrSenseSkuOutletInFlight[kamEmail];
    }
  })();
  nrrSenseSkuOutletInFlight[kamEmail] = p;
  return p;
}
window.nrrFetchSenseSkuOutletCsv = nrrFetchSenseSkuOutletCsv;

// bulk_outlets.csv (3.1MB, global) — account_id × month_label × outlet_id,
// GMV/orders/last_order_date. Feeds the "สาขา" stat cell (movement +
// per-outlet cycle signal for Chain accounts).
window.bulkOutletsData = { loaded: false };
// In-flight dedupe — harmless with the single Account-view call site this
// had until now, but the Dashboard's Churn/transfer_out drawer is a SECOND
// caller (see nrrOpenSlideoverMovement), and rapid clicks across those
// cells would otherwise fire duplicate 3.1MB fetches (the cache-buster
// query param defeats the HTTP cache too). Mirrors nrrSenseSkuOutletInFlight.
var nrrBulkOutletsInFlight = null;
function _nrrParseBulkOutletsCsv(text) {
  var lines = text.trim().split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (lines.length && /^account_id,/i.test(lines[0])) lines = lines.slice(1);
  var byAccountId = {};
  lines.forEach(function (l) {
    var p = parseCSVRow(l);
    if (!p[0]) return;
    var row = {
      account_id: (p[0] || '').trim(), month_label: (p[1] || '').trim(),
      outlet_id: (p[2] || '').trim(), outlet_name: (p[3] || '').trim(),
      gmv_ex_vat: parseFloat(p[4]) || 0, orders: parseInt(p[5], 10) || 0,
      last_order_date: (p[8] || '').trim()
    };
    if (!byAccountId[row.account_id]) byAccountId[row.account_id] = [];
    byAccountId[row.account_id].push(row);
  });
  return byAccountId;
}
async function nrrFetchBulkOutletsCsv(force) {
  if (window.bulkOutletsData.loaded && !force) return window.bulkOutletsData;
  if (nrrBulkOutletsInFlight && !force) return nrrBulkOutletsInFlight;
  nrrBulkOutletsInFlight = (async function () {
    try {
      var res = await fetch(R2_BASE + '/bulk_outlets.csv?cb=' + Date.now());
      if (res.status === 404) { window.bulkOutletsData = { byAccountId: {}, loaded: false, notFound: true }; return window.bulkOutletsData; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var text = await res.text();
      window.bulkOutletsData = { byAccountId: _nrrParseBulkOutletsCsv(text), loaded: true, loadedAt: Date.now() };
    } catch (e) {
      console.warn('[nrr] failed to load bulk_outlets.csv', e);
      window.bulkOutletsData = { byAccountId: {}, loaded: false, error: e.message };
    } finally {
      nrrBulkOutletsInFlight = null;
    }
    return window.bulkOutletsData;
  })();
  return nrrBulkOutletsInFlight;
}
window.nrrFetchBulkOutletsCsv = nrrFetchBulkOutletsCsv;

// bulk_categories.csv (2.7MB, global) — account_id × month_label ×
// category × gmv. Only rows for categories the account ACTUALLY bought —
// absence of a row is how "hasn't bought this category" shows up, diffed
// against _CAT_MASTER in nrr_account.js.
window.bulkCategoriesData = { loaded: false };
function _nrrParseBulkCategoriesCsv(text) {
  var lines = text.trim().split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (lines.length && /^account_id,/i.test(lines[0])) lines = lines.slice(1);
  var byAccountId = {};
  lines.forEach(function (l) {
    var p = parseCSVRow(l);
    if (!p[0]) return;
    var row = { account_id: (p[0] || '').trim(), month_label: (p[1] || '').trim(), category: (p[2] || '').trim(), gmv: parseFloat(p[3]) || 0 };
    if (!byAccountId[row.account_id]) byAccountId[row.account_id] = [];
    byAccountId[row.account_id].push(row);
  });
  return byAccountId;
}
async function nrrFetchBulkCategoriesCsv(force) {
  if (window.bulkCategoriesData.loaded && !force) return window.bulkCategoriesData;
  try {
    var res = await fetch(R2_BASE + '/bulk_categories.csv?cb=' + Date.now());
    if (res.status === 404) { window.bulkCategoriesData = { byAccountId: {}, loaded: false, notFound: true }; return window.bulkCategoriesData; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    window.bulkCategoriesData = { byAccountId: _nrrParseBulkCategoriesCsv(text), loaded: true, loadedAt: Date.now() };
  } catch (e) {
    console.warn('[nrr] failed to load bulk_categories.csv', e);
    window.bulkCategoriesData = { byAccountId: {}, loaded: false, error: e.message };
  }
  return window.bulkCategoriesData;
}
window.nrrFetchBulkCategoriesCsv = nrrFetchBulkCategoriesCsv;

// bulk_price.csv (36MB, global — the heaviest fetch in the app, accepted
// deliberately as a one-time lazy cost on first Account view visit per
// session, not a recurring one; see plan doc for the cost/benefit call).
// account_id × month_label × item_id × unit_price — no item name column,
// join against sense_skus_{kam}.csv (already fetched) for display names.
window.bulkPriceData = { loaded: false };
function _nrrParseBulkPriceCsv(text) {
  var lines = text.trim().split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (lines.length && /^account_id,/i.test(lines[0])) lines = lines.slice(1);
  var byAccountItem = {}; // accountId -> itemId -> [{month_label, unit_price}]
  lines.forEach(function (l) {
    var p = parseCSVRow(l);
    if (!p[0]) return;
    var accountId = (p[0] || '').trim(), itemId = (p[2] || '').trim();
    if (!byAccountItem[accountId]) byAccountItem[accountId] = {};
    if (!byAccountItem[accountId][itemId]) byAccountItem[accountId][itemId] = [];
    byAccountItem[accountId][itemId].push({ month_label: (p[1] || '').trim(), unit_price: parseFloat(p[3]) || 0 });
  });
  return byAccountItem;
}
async function nrrFetchBulkPriceCsv(force) {
  if (window.bulkPriceData.loaded && !force) return window.bulkPriceData;
  try {
    var res = await fetch(R2_BASE + '/bulk_price.csv?cb=' + Date.now());
    if (res.status === 404) { window.bulkPriceData = { byAccountItem: {}, loaded: false, notFound: true }; return window.bulkPriceData; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    window.bulkPriceData = { byAccountItem: _nrrParseBulkPriceCsv(text), loaded: true, loadedAt: Date.now() };
  } catch (e) {
    console.warn('[nrr] failed to load bulk_price.csv', e);
    window.bulkPriceData = { byAccountItem: {}, loaded: false, error: e.message };
  }
  return window.bulkPriceData;
}
window.nrrFetchBulkPriceCsv = nrrFetchBulkPriceCsv;
