// ── nrr_data.js — R2 CSV fetch + parse for /nrr ──────────────────────────
// parseCSVRow ported verbatim from src/02_data_pipeline.js (repo-wide
// convention — no external CSV library anywhere in this codebase).
// The bulkQnrrData shape built here matches EXACTLY what Sense's own
// bulk-qnrr-single handler builds (src/02_data_pipeline.js:1120-1176),
// including the 29-column order, so nrr_logic.js's ported _qnrrCompute
// works unmodified against it.

// ?localdata=1 — dev-only override, mirrors the same flag in src/shell.html:
// serves CSVs from a `localtest/` folder next to this build's HTML file
// instead of the real R2 bucket. Never affects production.
var R2_BASE = (typeof location !== 'undefined' && location.search.indexOf('localdata=1') !== -1)
  ? (location.origin + location.pathname.replace(/[^/]*$/, '') + 'localtest')
  : 'https://pub-12078d17646340808024e8cc95504995.r2.dev';

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

// v878: pm_rep_view.csv (PM/AD roster, from sql/pm_rep_view.sql) is an
// independent BigQuery output uploaded to R2 by data team separately from
// kam_rep_view.csv — no merge step on their side. Optional: 404/missing is
// fine, KAM data still loads. Mirrors the same fix in
// src/02_data_pipeline.js's _fetchQnrrBundle (Sense side).
async function _nrrFetchOptionalCsvText(filename) {
  try {
    // v878-fix: bound this fetch — it has no retry of its own, and an
    // unbounded hang here would stall the whole dashboard even after the
    // required KAM CSV already arrived successfully.
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
    var res = await fetch(R2_BASE + '/' + filename + '?cb=' + Date.now(), ctrl ? { signal: ctrl.signal } : undefined);
    if (timer) clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

async function nrrFetchQnrrCsv(force) {
  if (window.bulkQnrrData && window.bulkQnrrData.loaded && !force) return window.bulkQnrrData;
  var url = R2_BASE + '/' + QNRR_CFG.csv_file + '?cb=' + Date.now();
  var lastErr = null;
  // v878-fix: fire once, in parallel with the KAM fetch below (previously
  // sequential — added latency on every load) and reuse across KAM retries
  // (previously re-fetched pm_rep_view.csv up to 3x if only the KAM fetch
  // needed a retry).
  var pmTextPromise = _nrrFetchOptionalCsvText('pm_rep_view.csv');
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var text = await res.text();
      var pmText = await pmTextPromise;
      if (pmText) {
        var pmRows = pmText.trim().split('\n').slice(1).join('\n');
        if (pmRows) text = text.trim() + '\n' + pmRows;
      }
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

// ── Company overview — company_gmv.csv (sql/company_gmv.sql) ─────────────
// Whole-company monthly GMV by segment: b2c / kam / pm / admin / sale / other,
// with bucket (chain|sa_mc|other) + kam/tl emails on kam rows. 404-graceful
// like vp_view.csv — until the file is uploaded to R2 the company/sales
// sections show an explicit empty state.
window.bulkCompanyData = { loaded: false };

// 8 cols: month_key, month_label, owner_group, kam_email, tl_email,
//         bucket, gmv, orders
function _nrrParseCompanyCsv(text) {
  var lines = text.trim().split('\n').slice(1);
  var rows = [];
  lines.forEach(function (line) {
    if (!line.trim()) return;
    var p = parseCSVRow(line);
    if (p.length < 8) return;
    rows.push({
      month_key:   (p[0] || '').trim(),
      month_label: (p[1] || '').trim(),
      owner_group: (p[2] || '').trim(),
      kam_email:   (p[3] || '').trim().toLowerCase(),
      tl_email:    (p[4] || '').trim().toLowerCase(),
      bucket:      (p[5] || '').trim(),
      gmv:         parseFloat(p[6]) || 0,
      orders:      parseInt(p[7], 10) || 0
    });
  });
  return rows;
}

async function nrrFetchCompanyCsv(force) {
  if (window.bulkCompanyData.loaded && !force) return window.bulkCompanyData;
  var url = R2_BASE + '/company_gmv.csv?cb=' + Date.now();
  try {
    var res = await fetch(url);
    if (res.status === 404) { window.bulkCompanyData = { allRows: [], loaded: false, notFound: true }; return window.bulkCompanyData; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    var allRows = _nrrParseCompanyCsv(text);
    // Staleness: month_key-based (NOT QNRR_CFG.q_months-coupled — this file
    // spans the whole calendar year and must survive quarter rollovers).
    // Stale = the file's newest month is older than the lag-1 current month.
    var lag = new Date(); lag.setDate(lag.getDate() - 1);
    var currKey = lag.getFullYear() + '-' + String(lag.getMonth() + 1).padStart(2, '0');
    var maxKey = allRows.reduce(function (m, r) { return r.month_key > m ? r.month_key : m; }, '');
    var isStale = allRows.length > 0 && maxKey < currKey;
    window.bulkCompanyData = { allRows: allRows, loaded: true, loadedAt: Date.now(), maxMonthKey: maxKey, currMonthKey: currKey, isStale: isStale };
  } catch (e) {
    console.warn('[nrr] failed to load company_gmv.csv', e);
    window.bulkCompanyData = { allRows: [], loaded: false, error: e.message };
  }
  return window.bulkCompanyData;
}
window.nrrFetchCompanyCsv = nrrFetchCompanyCsv;

// ── Sales handover pipeline — sales_handover_pipeline.csv ────────────────
// Forward-looking snapshot (one row per outlet currently owned by Sales),
// pairing new_user_exp_date (the 45-day SA / 90-day MC-Chain handover
// deadline, already computed upstream) with last-closed-month GMV, so the
// dashboard can forecast which month each outlet's GMV rolls off Sales'
// book. 404-graceful like company_gmv.csv.
window.bulkSalesPipelineData = { loaded: false };

// 11 cols (v5 SQL — first_dollar_date + mtd_gmv added): outlet_id,
//         account_id, account_name, account_type, bucket, new_user_exp_date
//         (YYYY-MM-DD or ''), last_month_gmv, orders, staff_owner,
//         first_dollar_date (YYYY-MM-DD or ''), mtd_gmv
function _nrrParseSalesPipelineCsv(text) {
  var lines = text.trim().split('\n').slice(1);
  var rows = [];
  lines.forEach(function (line) {
    if (!line.trim()) return;
    var p = parseCSVRow(line);
    if (p.length < 8) return;
    rows.push({
      outlet_id: (p[0] || '').trim(),
      account_id: (p[1] || '').trim(),
      account_name: (p[2] || '').trim(),
      account_type: (p[3] || '').trim(),
      bucket: (p[4] || '').trim(),
      new_user_exp_date: (p[5] || '').trim(),
      last_month_gmv: parseFloat(p[6]) || 0,
      orders: parseInt(p[7], 10) || 0,
      // v4 SQL column — absent (undefined→'') in any CSV uploaded before
      // that re-run; degrades gracefully to "ไม่ระบุ Sales" grouping.
      staff_owner: (p[8] || '').trim(),
      // v5 SQL columns — absent (undefined→''/0) in any CSV uploaded before
      // that re-run; the Pulse page's "จาก Sales" block degrades to showing
      // 0 items rather than crashing (same graceful-degrade precedent).
      first_dollar_date: (p[9] || '').trim(),
      mtd_gmv: parseFloat(p[10]) || 0
    });
  });
  return rows;
}

async function nrrFetchSalesPipelineCsv(force) {
  if (window.bulkSalesPipelineData.loaded && !force) return window.bulkSalesPipelineData;
  var url = R2_BASE + '/sales_handover_pipeline.csv?cb=' + Date.now();
  try {
    var res = await fetch(url);
    if (res.status === 404) { window.bulkSalesPipelineData = { allRows: [], loaded: false, notFound: true }; return window.bulkSalesPipelineData; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    window.bulkSalesPipelineData = { allRows: _nrrParseSalesPipelineCsv(text), loaded: true, loadedAt: Date.now() };
  } catch (e) {
    console.warn('[nrr] failed to load sales_handover_pipeline.csv', e);
    window.bulkSalesPipelineData = { allRows: [], loaded: false, error: e.message };
  }
  return window.bulkSalesPipelineData;
}
window.nrrFetchSalesPipelineCsv = nrrFetchSalesPipelineCsv;

// ── new_skus_portfolio.csv (v46, sql/new_skus_portfolio.sql) — portfolio-
// wide "new SKU adoption this month" ranking, feeds the Pulse page's SKU
// block with real names instead of a bare count. 4 cols: item_id,
// item_name_th, new_gmv, account_count. 404-graceful (page falls back to
// the count-only view if this CSV hasn't been uploaded yet).
window.bulkNewSkusPortfolioData = { loaded: false };
function _nrrParseNewSkusPortfolioCsv(text) {
  var lines = text.trim().split('\n').slice(1);
  var rows = [];
  lines.forEach(function (line) {
    if (!line.trim()) return;
    var p = parseCSVRow(line);
    if (p.length < 4) return;
    rows.push({
      item_id: (p[0] || '').trim(),
      item_name_th: (p[1] || '').trim(),
      new_gmv: parseFloat(p[2]) || 0,
      account_count: parseInt(p[3], 10) || 0
    });
  });
  return rows;
}
async function nrrFetchNewSkusPortfolioCsv(force) {
  if (window.bulkNewSkusPortfolioData.loaded && !force) return window.bulkNewSkusPortfolioData;
  var url = R2_BASE + '/new_skus_portfolio.csv?cb=' + Date.now();
  try {
    var res = await fetch(url);
    if (res.status === 404) { window.bulkNewSkusPortfolioData = { allRows: [], loaded: false, notFound: true }; return window.bulkNewSkusPortfolioData; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    window.bulkNewSkusPortfolioData = { allRows: _nrrParseNewSkusPortfolioCsv(text), loaded: true, loadedAt: Date.now() };
  } catch (e) {
    console.warn('[nrr] failed to load new_skus_portfolio.csv', e);
    window.bulkNewSkusPortfolioData = { allRows: [], loaded: false, error: e.message };
  }
  return window.bulkNewSkusPortfolioData;
}
window.nrrFetchNewSkusPortfolioCsv = nrrFetchNewSkusPortfolioCsv;

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

// v860-fix (2026-07-13): this comment used to say P1's baseline
// "deliberately floats with today's date, faithfully replicating" the real
// engine — that was true before commit 44c8bee, but the real engine's own
// P1 baseline now FREEZES to the quarter's base month in quarterly mode
// (02_data_pipeline.js:1061-1065, the `_q3cBaseMonth` branch). This was a
// real, unfixed divergence between /nrr's drill-down and Sense's actual
// payout math — found during a repo-wide commission-quarterly-alignment
// audit. Now mirrors that branch exactly: pass baseMonthIso (/nrr always
// does — QNRR_CFG.base_month is always set) to freeze the window; the
// rolling fallback below only exists for signature parity with the real
// engine, which still supports a non-quarterly mode /nrr doesn't need.
function nrrP1BaselineLabels(baseMonthIso) {
  var set = {};
  if (baseMonthIso) {
    var p = baseMonthIso.split('-');
    var yr = parseInt(p[0], 10), mo = parseInt(p[1], 10);
    [0, 1, 2].forEach(function (i) {
      var d = new Date(yr, mo - 1 - i, 1);
      set[nrrThMonthLabel(d)] = true;
    });
    return set;
  }
  var lag = new Date(); lag.setDate(lag.getDate() - 1);
  [1, 2, 3].forEach(function (i) {
    var d = new Date(lag.getFullYear(), lag.getMonth() - i, 1);
    set[nrrThMonthLabel(d)] = true;
  });
  return set;
}

// Mirrors 07a_commission_engine.js's _commElapsedQuarterLabels exactly —
// every ELAPSED month of the quarter (base_month+1, +2, +3, capped at
// today's lag-1 date) — so /nrr's P1/P3 drill-down can sum a real
// cumulative streak instead of evaluating only the current month.
function _nrrCommElapsedQuarterLabels(baseMonthIso) {
  if (!baseMonthIso) return [];
  var parts = baseMonthIso.split('-');
  var baseYr = parseInt(parts[0], 10), baseMo = parseInt(parts[1], 10);
  var lag = new Date(); lag.setDate(lag.getDate() - 1);
  var out = [];
  for (var i = 1; i <= 3; i++) {
    var d = new Date(baseYr, baseMo - 1 + i, 1);
    if (d > lag) break;
    out.push(nrrThMonthLabel(d));
  }
  return out;
}
window._nrrCommElapsedQuarterLabels = _nrrCommElapsedQuarterLabels;

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

async function nrrFetchUpsellBundle(kamEmail, baseMonthIso) {
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

      var p1Labels = nrrP1BaselineLabels(baseMonthIso);
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

        // v860-fix: mirrors 02_data_pipeline.js:1104-1111's v854 fix — in
        // quarterly mode (baseMonthIso set) p1Labels is already a closed,
        // past-bounded window ending at the frozen base month, so it can
        // never include the row being tested by construction. Skip the
        // !==currLabel guard entirely in that mode (it exists only to stop
        // rolling mode's "current month" from counting as its own
        // baseline, and on the quarter's own day-1 the lag anchor still
        // reads base_month itself, wrongly colliding with it otherwise).
        if ((baseMonthIso || monthLabel !== currLabel) && totalGmv > 0 && p1Labels[monthLabel]) {
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
      days_with_current_kam: parseInt(p[19], 10) || 0,
      // v4 (2026-07-13): may be absent on an un-re-run CSV — stays '' until
      // Q8E_portview_v3.sql is rerun, which is the graceful-degrade signal
      // nrrFetchPortviewCsv uses to skip the staleness banner entirely.
      data_asof_date:        (p[20] || '').trim()
    };
    allRows.push(row);
    if (row.kam_email) {
      if (!byKamEmail[row.kam_email]) byKamEmail[row.kam_email] = [];
      byKamEmail[row.kam_email].push(row);
    }
  });
  return { byKamEmail: byKamEmail, allRows: allRows };
}

// v4 (2026-07-13): portview.csv is a single current-state snapshot with no
// date/period column otherwise — data_asof_date (= the SQL's own lag_date)
// is the only signal the app has for "how fresh is this file." Computed
// once per fetch (not per-row, every row shares the same value) so
// nrrStalePortviewBannerHtml can render one banner without re-deriving this
// on every call. daysBehind=0 means "run today" (asOfDate = yesterday,
// matching the same day-1 lag convention used everywhere else in /nrr);
// null means the CSV predates this column (un-re-run) — banner skips
// entirely rather than guessing, same 404-graceful precedent as other
// new columns added to existing CSVs this session.
function _nrrPortviewAsOfDate(dateStr) {
  if (!dateStr) return null;
  var d = new Date(dateStr + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}
function _nrrPortviewDaysBehind(asOfDate) {
  if (!asOfDate) return null;
  var expected = new Date();
  expected.setDate(expected.getDate() - 1);
  expected.setHours(0, 0, 0, 0);
  return Math.round((expected - asOfDate) / 86400000);
}

async function nrrFetchPortviewCsv(force) {
  if (window.bulkPortviewData.loaded && !force) return window.bulkPortviewData;
  try {
    var res = await fetch(R2_BASE + '/portview.csv?cb=' + Date.now());
    if (res.status === 404) { window.bulkPortviewData = { allRows: [], byKamEmail: {}, loaded: false, notFound: true }; return window.bulkPortviewData; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    var parsed = _nrrParsePortviewCsv(text);
    var asOfDate = parsed.allRows.length ? _nrrPortviewAsOfDate(parsed.allRows[0].data_asof_date) : null;
    window.bulkPortviewData = {
      allRows: parsed.allRows, byKamEmail: parsed.byKamEmail, loaded: true, loadedAt: Date.now(),
      asOfDate: asOfDate, daysBehind: _nrrPortviewDaysBehind(asOfDate)
    };
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
  // v56: no schema change needed here (unlike portview.csv) — this file
  // already carries month_label per row; staleness just means "the latest
  // CLOSED month isn't present yet." Collected once during parsing so the
  // staleness check doesn't have to rescan every account's row array.
  var monthsPresent = {};
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
    if (row.month_label) monthsPresent[row.month_label] = true;
  });
  return { byAccountId: byAccountId, monthsPresent: monthsPresent };
}

// v56: expected latest CLOSED month label, mirroring Q9B_bulk_history.sql's
// own WHERE clause exactly (`< DATE_TRUNC(DATE_SUB(lag_date, INTERVAL 1
// DAY), MONTH)` — i.e. the month before the one containing "yesterday").
function _nrrBulkHistoryExpectedLatestMonth() {
  var lag = new Date(); lag.setDate(lag.getDate() - 1);
  var closed = new Date(lag.getFullYear(), lag.getMonth(), 1);
  closed.setMonth(closed.getMonth() - 1);
  return nrrThMonthLabel(closed);
}

async function nrrFetchBulkHistoryCsv(force) {
  if (window.bulkHistoryData.loaded && !force) return window.bulkHistoryData;
  try {
    var res = await fetch(R2_BASE + '/bulk_history.csv?cb=' + Date.now());
    if (res.status === 404) { window.bulkHistoryData = { byAccountId: {}, monthsPresent: {}, loaded: false, notFound: true }; return window.bulkHistoryData; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    var parsed = _nrrParseBulkHistoryCsv(text);
    var expectedMonth = _nrrBulkHistoryExpectedLatestMonth();
    window.bulkHistoryData = {
      byAccountId: parsed.byAccountId, monthsPresent: parsed.monthsPresent, loaded: true, loadedAt: Date.now(),
      expectedMonth: expectedMonth, isStaleMonth: !parsed.monthsPresent[expectedMonth]
    };
  } catch (e) {
    console.warn('[nrr] failed to load bulk_history.csv', e);
    window.bulkHistoryData = { byAccountId: {}, monthsPresent: {}, loaded: false, error: e.message };
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
      // cols 15-17: unit-normalization metadata from item_master (SQL1
      // v207g exports these; earlier the parser skipped straight to 18).
      // Feed nrrSkuDisplayPrice → normalized ฿/หน่วย (฿/กก., ฿/ลิตร,
      // ฿/ฟอง...) so the price feature never shows an unlabeled raw
      // unit_price whose basis (per-kg vs per-piece) is ambiguous.
      default_unit_group: (p[15] || '').trim(),
      ea_unit_name:       (p[16] || '').trim(),
      universal_ea_value: parseFloat(p[17]) || 0,
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
