// ── nrr_aggregate.js — org / team / KAM / outlet rollups ─────────────────
// All rollups are computed client-side from the single flat CSV, by calling
// the ported _qnrrCompute (nrr_logic.js) at the appropriate scope — never
// by re-filtering/re-classifying rows independently, so movement badges
// shown anywhere in the UI always agree with the totals in the sections
// above them.
//
// Deliberate scope choice (see plan notes): a KAM's own %NRR shown in the
// Team -> KAM drill-down is computed at scope='kam' (their personal number,
// identical to what they see in Sense). The movement badges on the outlets
// listed under that KAM use scope='tl' (the enclosing team's lens) so the
// colors/categories reconcile with the team-level movement breakdown above.
// At the KAM -> Outlet level, everything switches to that KAM's own
// scope='kam' lens (inspecting one person's book on its own terms).

function nrrCurrentPeriod(result) {
  if (!result || !result.months || !result.months.length) return null;
  // Prefer the latest month that actually has row data; QNRR_CFG.q_months
  // may list months that haven't started yet (e.g. Aug/Sep before they
  // occur) — result.months only contains months present in the CSV.
  return result.months[result.months.length - 1];
}
window.nrrCurrentPeriod = nrrCurrentPeriod;

// ── Actual-month display convention (2026-07-09, user decision) ─────────
// The compute engine (nrr_logic.js, frozen twin of Sense's 07c) normalizes
// everything to 30-day figures. The teams however read performance in
// ACTUAL calendar-month baht, so every displayed amount is converted:
//   value_actual = day-rate × days-in-that-month
// Closed months → exact actuals; the open month → full-month projection
// from the MTD run-rate. ONLY money display changes — %NRR stays the
// engine's 30-day-normalized ratio (the fair cross-month comparator).
function nrrDaysIn(month) {
  var p = (month || '').split('-');
  return p.length === 2 ? new Date(parseInt(p[0], 10), parseInt(p[1], 10), 0).getDate() : 30;
}
window.nrrDaysIn = nrrDaysIn;
function nrrBaseDays() { return nrrDaysIn(QNRR_CFG.base_month); }
window.nrrBaseDays = nrrBaseDays;

// Scales one engine result's ×30 display fields (segments, total_gmv,
// handover/core base sums, contraction) to actual-month values, in place,
// exactly once. Applied at every result-producing entry point below so
// every consumer (charts, tables, triples, composition bar) stays
// internally consistent without touching the frozen engine.
function _nrrActualizeResult(result) {
  if (!result || result._actualized) return result;
  var bScale = nrrBaseDays() / 30;
  result.handover_base_norm = (result.handover_base_norm || 0) * bScale;
  Object.keys(result.by_month || {}).forEach(function (m) {
    var bm = result.by_month[m];
    var scale = (bm.days_in_month || nrrDaysIn(m)) / 30;
    Object.keys(bm.segments || {}).forEach(function (mv) {
      // churn/transfer_out segments carry BASE-month GMV ("ฐานที่หาย") —
      // their actual value belongs to the base month's calendar, not the
      // current month's.
      bm.segments[mv] *= (mv === 'core_nrr_churn' || mv === 'transfer_out') ? bScale : scale;
    });
    bm.total_gmv = (bm.total_gmv || 0) * scale; // excludes churn/transfer_out by construction
    if (bm.core_nrr_base != null) bm.core_nrr_base *= bScale;
    if (bm.contraction != null) bm.contraction = (bm.segments.core_nrr || 0) - (bm.core_nrr_base || 0);
  });
  result._actualized = true;
  return result;
}

function nrrOrgResult() {
  return _nrrActualizeResult(_qnrrCompute(null, 'admin'));
}
window.nrrOrgResult = nrrOrgResult;

function nrrTeamResult(tlEmail) {
  return _nrrActualizeResult(_qnrrCompute(tlEmail, 'tl'));
}
window.nrrTeamResult = nrrTeamResult;

function nrrKamResult(kamEmail) {
  return _nrrActualizeResult(_qnrrCompute(kamEmail, 'kam'));
}
window.nrrKamResult = nrrKamResult;

// Cross-team comparison rows for section 3 (admin only), sorted by %NRR desc.
function nrrTeamComparison() {
  var teams = nrrListTeams();
  var org = nrrOrgResult();
  var orgPeriod = nrrCurrentPeriod(org);
  var orgPct = org && orgPeriod ? org.by_month[orgPeriod].nrr_pct : null;

  var rows = teams.map(function (t) {
    var result = nrrTeamResult(t.email);
    var period = nrrCurrentPeriod(result);
    var bm = result && period ? result.by_month[period] : null;
    var outletCount = 0;
    if (bm) {
      ['core_nrr', 'core_nrr_churn', 'comeback', 'transfer_in'].forEach(function (m) {
        outletCount += bm.outlets[m] || 0;
      });
    }
    return {
      tl_email: t.email,
      tl_name: t.name,
      nrr_pct: bm ? bm.nrr_pct : null,
      base_gmv: result ? Math.round(result.base_norm * nrrBaseDays()) : 0,
      outlet_count: outletCount,
      delta_vs_org: (bm && bm.nrr_pct != null && orgPct != null) ? bm.nrr_pct - orgPct : null,
      period: period,
      result: result
    };
  }).filter(function (r) { return r.result; });

  rows.sort(function (a, b) {
    if (a.nrr_pct == null) return 1;
    if (b.nrr_pct == null) return -1;
    return b.nrr_pct - a.nrr_pct;
  });
  return { org_pct: orgPct, org_period: orgPeriod, org_result: org, rows: rows };
}
window.nrrTeamComparison = nrrTeamComparison;

// Movement breakdown (counts + GMV) for a given compute result + period —
// feeds section 4 (org-level or per-team).
function nrrMovementBreakdown(result, period) {
  var MOVEMENTS = ['core_nrr', 'core_nrr_churn', 'comeback', 'transfer_in', 'transfer_out', 'handover', 'expansion'];
  if (!result || !period || !result.by_month[period]) {
    return MOVEMENTS.map(function (m) { return { type: m, outlets: 0, gmv: 0 }; });
  }
  var bm = result.by_month[period];
  return MOVEMENTS.map(function (m) {
    return { type: m, outlets: bm.outlets[m] || 0, gmv: bm.segments[m] || 0 };
  });
}
window.nrrMovementBreakdown = nrrMovementBreakdown;

// Team -> KAM drill-down rows (section 6).
function nrrKamRowsForTeam(tlEmail, period) {
  var kams = nrrListKamsForTeam(tlEmail);
  return kams.map(function (k) {
    var kamResult = nrrKamResult(k.email);
    var kamPeriod = period && kamResult && kamResult.by_month[period] ? period : nrrCurrentPeriod(kamResult);
    var bm = kamResult && kamPeriod ? kamResult.by_month[kamPeriod] : null;

    // Outlet rows for this KAM within this team, classified under the
    // TEAM's scope lens (scope='tl', myTlEmail=tlEmail) so badges reconcile
    // with the team-level movement breakdown shown above this table.
    var qd = window.bulkQnrrData;
    var rawRows = ((qd && qd.byKamEmail[k.email]) || []).filter(function (r) {
      return r.period_month === kamPeriod;
    });
    var outlets = rawRows.map(function (r) {
      return { row: r, movement: nrrClassifyRow(r, 'tl', tlEmail) };
    }).filter(function (o) { return o.movement; });

    return {
      kam_email: k.email,
      kam_name: k.name,
      nrr_pct: bm ? bm.nrr_pct : null,
      base_gmv: kamResult ? Math.round(kamResult.base_norm * nrrBaseDays()) : 0,
      outlet_count: outlets.length,
      period: kamPeriod,
      outlets: outlets
    };
  }).sort(function (a, b) {
    if (a.nrr_pct == null) return 1;
    if (b.nrr_pct == null) return -1;
    return b.nrr_pct - a.nrr_pct;
  });
}
window.nrrKamRowsForTeam = nrrKamRowsForTeam;

// KAM -> Outlet drill-down rows (section 7) — that KAM's own scope='kam' lens.
function nrrOutletsForKam(kamEmail, period) {
  var qd = window.bulkQnrrData;
  if (!qd || !qd.loaded) return [];
  var myTlEmail = '';
  var kamRows = qd.byKamEmail[kamEmail] || [];
  var withTl = kamRows.find(function (r) { return r.latest_tl_email; });
  if (withTl) myTlEmail = withTl.latest_tl_email;

  return kamRows
    .filter(function (r) { return r.period_month === period; })
    .map(function (r) {
      var mv = nrrClassifyRow(r, 'kam', myTlEmail);
      return { row: r, movement: mv };
    })
    .filter(function (o) { return o.movement; })
    .sort(function (a, b) { return (b.row.curr_gmv || 0) - (a.row.curr_gmv || 0); });
}
window.nrrOutletsForKam = nrrOutletsForKam;

// ── v4: number-triple accessor ───────────────────────────────────────────
// {base, mtd, run_rate, curr_days, days_in_month, is_partial} for one month
// of a compute result (works for both _qnrrCompute and nrrComputeBucket
// shapes — both carry by_month with rows/total_gmv/curr_days/is_partial).
// MTD = sum of raw curr_gmv over the same movement set total_gmv counts
// (everything except transfer_out/churn, whose "gmv" is base-side) — summed
// raw, NOT derived from total_gmv×days/30, so it's exact per-row.
function nrrMonthTriple(result, month) {
  if (!result || !month || !result.by_month || !result.by_month[month]) return null;
  var bm = result.by_month[month];
  var mtd = 0;
  (bm.rows || []).forEach(function (r) {
    var mv = r.movement_type === 'core_nrr' && (parseFloat(r.curr_gmv) || 0) === 0
      ? 'core_nrr_churn' : r.movement_type;
    if (mv === 'core_nrr_churn' || mv === 'transfer_out') return;
    mtd += parseFloat(r.curr_gmv) || 0;
  });
  return {
    base: Math.round(result.base_norm * nrrBaseDays()),
    mtd: Math.round(mtd),
    run_rate: Math.round(bm.total_gmv || 0),
    curr_days: bm.curr_days,
    days_in_month: bm.days_in_month || 30,
    is_partial: !!bm.is_partial
  };
}
window.nrrMonthTriple = nrrMonthTriple;

// ── v4: outlets behind one movement number (the "why" drill) ─────────────
// scopeCtx: {scope:'tl'|'admin'|'kam', tlEmail} for rep-view results, or
// {scope:'bucket'} for PM/Admin bucket results (bucket rows are already
// pre-filtered; only the churn reclassification applies there).
function nrrOutletsForMovement(result, month, movementType, scopeCtx) {
  if (!result || !result.by_month || !result.by_month[month]) return [];
  var rows = result.by_month[month].rows || [];
  var out = [];
  rows.forEach(function (r) {
    var mv;
    if (scopeCtx && scopeCtx.scope === 'bucket') {
      mv = (r.movement_type === 'core_nrr' && (parseFloat(r.curr_gmv) || 0) === 0)
        ? 'core_nrr_churn' : r.movement_type;
    } else {
      mv = nrrClassifyRow(r, (scopeCtx && scopeCtx.scope) || 'admin', (scopeCtx && scopeCtx.tlEmail) || '');
    }
    if (mv === movementType) out.push({ row: r, movement: mv });
  });
  // Churn/transfer_out sort by LOST base value (that's the pain being
  // inspected); everything else by current run-rate value.
  var negative = movementType === 'core_nrr_churn' || movementType === 'transfer_out';
  out.sort(function (a, b) {
    return negative
      ? (b.row.base_gmv || 0) - (a.row.base_gmv || 0)
      : (b.row.curr_gmv || 0) - (a.row.curr_gmv || 0);
  });
  return out;
}
window.nrrOutletsForMovement = nrrOutletsForMovement;

// ── v4: whole-team outlet browse ─────────────────────────────────────────
// Same scope='tl' lens as nrrKamRowsForTeam, so totals reconcile with the
// KAM table by construction.
function nrrOutletsForTeam(tlEmail, period) {
  var qd = window.bulkQnrrData;
  if (!qd || !qd.loaded) return [];
  return (qd.byTlEmail[tlEmail] || [])
    .filter(function (r) { return r.period_month === period; })
    .map(function (r) {
      return { row: r, movement: nrrClassifyRow(r, 'tl', tlEmail) };
    })
    .filter(function (o) { return o.movement; })
    .sort(function (a, b) { return (b.row.curr_gmv || 0) - (a.row.curr_gmv || 0); });
}
window.nrrOutletsForTeam = nrrOutletsForTeam;

// Group outlet-drill-down rows by account_id — adapted from the proven
// _olGroupByAccount pattern in src/10_sales_view.js:390-406 (1 company can
// have many branches, e.g. Cafe Amazon PTT = 275 outlets under one
// account_id). Groups sorted by total curr_gmv desc, branches within a
// group sorted the same way (kept from nrrOutletsForKam's own sort).
function nrrGroupOutletsByAccount(outlets) {
  var groups = {}; // account_id -> {account_id, account_name, outlets:[], total_curr_gmv, total_base_gmv}
  outlets.forEach(function (o) {
    var key = o.row.account_id || o.row.account_name || 'unknown';
    if (!groups[key]) {
      groups[key] = {
        account_id: key,
        account_name: o.row.account_name || key,
        outlets: [],
        total_curr_gmv: 0,
        total_base_gmv: 0,
        total_run_rate: 0,
        curr_days: 30
      };
    }
    groups[key].outlets.push(o);
    groups[key].total_curr_gmv += o.row.curr_gmv || 0;
    groups[key].total_base_gmv += o.row.base_gmv || 0;
    var gd = parseFloat(o.row.curr_days) || 30;
    groups[key].curr_days = gd;
    groups[key].total_run_rate += gd > 0 ? (o.row.curr_gmv || 0) / gd * nrrDaysIn(o.row.period_month) : 0;
  });
  return Object.values(groups).sort(function (a, b) { return b.total_curr_gmv - a.total_curr_gmv; });
}
window.nrrGroupOutletsByAccount = nrrGroupOutletsByAccount;

// Max last_order_date for ONE specific outlet within an account, across all
// bulk_outlets.csv months for that outlet — deliberately scoped to
// outlet_id, NOT the whole account_id. core_nrr_churn (nrrClassifyRow) is a
// PER-OUTLET classification: a chain account can have one branch churn
// (curr_gmv 0 this period) while a sibling branch under the SAME account_id
// is still very much active. An account-wide max would silently borrow the
// active sibling's fresh order date onto the churned branch's row, making a
// real churn look like a false alarm — caught exactly this way in review
// (2026-07-10): a 2-outlet account showed "churn" next to a days-old order
// date that actually belonged to the OTHER outlet under that account_id.
// ISO YYYY-MM-DD strings sort correctly with a plain string max. Returns
// null if not loaded / no rows for this outlet.
function nrrOutletLastOrderDate(accountId, outletId) {
  var bo = window.bulkOutletsData;
  if (!bo || !bo.loaded || !bo.byAccountId) return null;
  var rows = bo.byAccountId[accountId];
  if (!rows || !rows.length) return null;
  var max = null;
  rows.forEach(function (r) {
    if (String(r.outlet_id) !== String(outletId)) return;
    if (r.last_order_date && (!max || r.last_order_date > max)) max = r.last_order_date;
  });
  return max;
}
window.nrrOutletLastOrderDate = nrrOutletLastOrderDate;

// ── PM / Admin portfolio-level rollups (3-level view: KAM / PM / Admin) ──
// PM/Admin data has no TL/KAM attribution column at all (see nrr_data.js
// header comment) — the user confirmed the intended mapping: a TL's "own"
// slice of PM/Admin is whichever account_type bucket that TL's KAM book is
// primarily made of. Manually configured per the user's explicit answer
// (2026-07-07) — update this map if team composition changes; there is no
// way to derive it from the data itself.
var TL_BUCKET_MAP = {
  'nitipat.s@freshket.co': 'chain',   // TL "Name" — Chain-primary portfolio
  'pavarisa.mu@freshket.co': 'sa_mc'  // TL "Ploy" — SA/MC-primary portfolio
};
window.TL_BUCKET_MAP = TL_BUCKET_MAP;

function nrrBucketForTl(tlEmail) {
  return TL_BUCKET_MAP[tlEmail] || null;
}
window.nrrBucketForTl = nrrBucketForTl;

// ── Squad config (company overview) ──────────────────────────────────────
// TL → squad mapping for the company section. Source of truth is the
// Supabase target_settings key 'squad_params' (seeded by
// sql/supabase_seed_squad_params.sql, arrives for free inside
// nrrCommRatesCache because nrrFetchCommissionRates() selects ALL of
// target_settings and JSON-parses every '*_params' key). Falls back to a
// TL_BUCKET_MAP-derived shape when the key is missing/unreadable, so the
// section still works before the seed is run. head_email is reserved for
// the future head-of-squad commission build — unused here.
function nrrSquadConfig() {
  try {
    if (typeof nrrCommRatesCache !== 'undefined' && nrrCommRatesCache &&
        nrrCommRatesCache.byKey && nrrCommRatesCache.byKey.squad_params) {
      var sp = nrrCommRatesCache.byKey.squad_params;
      if (sp && typeof sp === 'object' && sp.squads &&
          sp.squads.chain && sp.squads.sa_mc) return sp;
    }
  } catch (e) {}
  // Fallback: derive from the hardcoded TL_BUCKET_MAP
  var squads = { chain: { label: 'Chain', head_email: '', tl_emails: [] },
                 sa_mc: { label: 'SA/MC', head_email: '', tl_emails: [] } };
  Object.keys(TL_BUCKET_MAP).forEach(function (tl) {
    var b = TL_BUCKET_MAP[tl];
    if (squads[b]) squads[b].tl_emails.push(tl);
  });
  return { version: 0, squads: squads };
}
window.nrrSquadConfig = nrrSquadConfig;

function nrrSquadForTl(tlEmail) {
  var t = (tlEmail || '').toLowerCase();
  if (!t) return null;
  var cfg = nrrSquadConfig();
  var keys = Object.keys(cfg.squads);
  for (var i = 0; i < keys.length; i++) {
    var tls = cfg.squads[keys[i]].tl_emails || [];
    if (tls.some(function (e) { return (e || '').toLowerCase() === t; })) return keys[i];
  }
  return null;
}
window.nrrSquadForTl = nrrSquadForTl;

// ── Company model (from bulkCompanyData / company_gmv.csv) ───────────────
// Classification (per user's rules):
//   kam rows            → squad by tl_email → nrrSquadForTl (KAM inherits
//                         their TL's squad — NOT the account's own type)
//   pm/admin/sale rows  → squad by bucket (chain → chain, sa_mc → sa_mc)
//   b2c rows            → company-level b2c (outside squads)
//   everything unmapped → unassigned (owner_group 'other', bucket 'other',
//                         kam rows with unknown TL) — kept visible so the
//                         Total always reconciles to DWH.
// Returns null until the CSV is loaded.
// {
//   months: ['2026-01', ...] (sorted month_keys),
//   labels: {month_key: month_label},
//   by_month: {month_key: {
//     b2c: {gmv, orders},
//     squads: {chain: {sales,kam,pm,admin,total}, sa_mc: {...}},  // gmv only
//     unassigned: gmv, total: gmv
//   }}
// }
function nrrCompanyModel() {
  var cd = window.bulkCompanyData;
  if (!cd || !cd.loaded || !cd.allRows || !cd.allRows.length) return null;
  var months = [], labels = {}, byMonth = {};
  function ensureMonth(k, lbl) {
    if (!byMonth[k]) {
      months.push(k); labels[k] = lbl;
      byMonth[k] = {
        b2c: { gmv: 0, orders: 0 },
        squads: {
          chain: { sales: 0, kam: 0, pm: 0, admin: 0, total: 0 },
          sa_mc: { sales: 0, kam: 0, pm: 0, admin: 0, total: 0 }
        },
        unassigned: 0, total: 0
      };
    }
    return byMonth[k];
  }
  cd.allRows.forEach(function (r) {
    var m = ensureMonth(r.month_key, r.month_label);
    m.total += r.gmv;
    if (r.owner_group === 'b2c') { m.b2c.gmv += r.gmv; m.b2c.orders += r.orders; return; }
    var squadKey = null, subKey = null;
    if (r.owner_group === 'kam') {
      squadKey = nrrSquadForTl(r.tl_email);
      // v26-fix: a KAM row whose owning TL doesn't resolve to a squad (most
      // commonly kam_email='unassigned' — the outlet's current owner isn't
      // in the SQL's kam_directory roster, e.g. a resigned KAM's old book)
      // falls back to the account's own account_type bucket, same as
      // PM/Admin/Sales — per user: "ถ้าจัดไม่ได้เพราะไม่มี owner อยู่ใน list
      // ให้แยกเข้า sa/mc/chain ตาม account type เลย". This does NOT apply to
      // matched KAMs (squad always comes from their TL's portfolio first).
      if (!squadKey && (r.bucket === 'chain' || r.bucket === 'sa_mc')) squadKey = r.bucket;
      subKey = 'kam';
    } else if (r.owner_group === 'pm' || r.owner_group === 'admin' || r.owner_group === 'sale') {
      squadKey = (r.bucket === 'chain' || r.bucket === 'sa_mc') ? r.bucket : null;
      subKey = r.owner_group === 'sale' ? 'sales' : r.owner_group;
    }
    if (squadKey && m.squads[squadKey] && subKey) {
      m.squads[squadKey][subKey] += r.gmv;
      m.squads[squadKey].total += r.gmv;
    } else {
      m.unassigned += r.gmv;
    }
  });
  months.sort();
  return { months: months, labels: labels, by_month: byMonth };
}
window.nrrCompanyModel = nrrCompanyModel;

// Sale-only pivot for the standalone Sales section: per month
// {chain, sa_mc, other, total} (gmv) + {orders_total}.
function nrrSalesByBucket() {
  var cd = window.bulkCompanyData;
  if (!cd || !cd.loaded || !cd.allRows || !cd.allRows.length) return null;
  var months = [], labels = {}, byMonth = {};
  cd.allRows.forEach(function (r) {
    if (r.owner_group !== 'sale') return;
    if (!byMonth[r.month_key]) {
      months.push(r.month_key); labels[r.month_key] = r.month_label;
      byMonth[r.month_key] = { chain: 0, sa_mc: 0, other: 0, total: 0, orders_total: 0 };
    }
    var m = byMonth[r.month_key];
    var b = (r.bucket === 'chain' || r.bucket === 'sa_mc') ? r.bucket : 'other';
    m[b] += r.gmv; m.total += r.gmv; m.orders_total += r.orders;
  });
  months.sort();
  return { months: months, labels: labels, by_month: byMonth };
}
window.nrrSalesByBucket = nrrSalesByBucket;

// ── Sales handover pipeline model (from bulkSalesPipelineData) ───────────
// Buckets each currently-Sales-owned outlet by how soon its handover
// deadline (new_user_exp_date) falls, using REAL today (not the day-1 lag
// anchor used elsewhere) since this is a business deadline, not a
// data-availability concern:
//   overdue         — deadline already passed, still Sales-owned (needs
//                     action now)
//   this_month      — deadline is later this calendar month
//   next_month      — deadline falls in the following calendar month
//   plus2           — two months out
//   plus3_or_later  — three-plus months out
//   no_date         — new_user_exp_date missing/unparseable
// Each bucket carries {gmv, outlets, rows[]} (rows sorted soonest/most-
// overdue first) so the UI can both show a headline number and drill into
// the underlying account list.
// v29: buckets by REAL forward calendar month (not vague "+N เดือน" labels)
// so the pipeline reads as an actual month-by-month table, same language as
// the company audit table. Buckets: overdue, m0 (this month) .. m{MAX_OFFSET}
// (the last one is a "this month or later" catch-all), no_date. 45-day SA /
// 90-day MC-Chain deadlines mean nothing meaningful lives past ~3 months out
// today, but the bucket count isn't hardcoded to that assumption.
var NRR_PIPE_MAX_OFFSET = 5;

function nrrSalesPipelineModel() {
  var pd = window.bulkSalesPipelineData;
  if (!pd || !pd.loaded || !pd.allRows || !pd.allRows.length) return null;
  var TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var todayKey = today.getFullYear() * 12 + today.getMonth();

  var order = ['overdue'];
  var labels = { overdue: 'เลยกำหนดแล้ว', no_date: 'ไม่มีกำหนด' };
  for (var i = 0; i <= NRR_PIPE_MAX_OFFSET; i++) {
    var d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    var key = 'm' + i;
    order.push(key);
    var lbl = TH_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
    labels[key] = i === 0 ? 'เดือนนี้ (' + lbl + ')' : (i === NRR_PIPE_MAX_OFFSET ? lbl + ' ขึ้นไป' : lbl);
  }
  order.push('no_date');

  var buckets = {};
  order.forEach(function (k) { buckets[k] = { gmv: 0, outlets: 0, rows: [] }; });
  var bySquad = { chain: 0, sa_mc: 0, other: 0 };

  pd.allRows.forEach(function (r) {
    var key;
    var d = r.new_user_exp_date ? new Date(r.new_user_exp_date + 'T00:00:00') : null;
    if (!d || isNaN(d.getTime())) {
      key = 'no_date';
    } else if (d < today) {
      key = 'overdue';
    } else {
      var diff = (d.getFullYear() * 12 + d.getMonth()) - todayKey;
      key = 'm' + Math.min(diff, NRR_PIPE_MAX_OFFSET);
    }
    buckets[key].gmv += r.last_month_gmv;
    buckets[key].outlets += 1;
    buckets[key].rows.push(r);
    if (r.bucket === 'chain' || r.bucket === 'sa_mc') bySquad[r.bucket] += r.last_month_gmv;
    else bySquad.other += r.last_month_gmv;
  });

  // overdue: most-overdue (oldest date) first; future buckets: soonest first
  order.forEach(function (k) {
    buckets[k].rows.sort(function (a, b) {
      if (a.new_user_exp_date === b.new_user_exp_date) return 0;
      return a.new_user_exp_date < b.new_user_exp_date ? -1 : 1;
    });
  });

  var total = order.reduce(function (s, k) { return s + buckets[k].gmv; }, 0);
  return { buckets: buckets, order: order, labels: labels, bySquad: bySquad, total: total, asOf: today };
}
window.nrrSalesPipelineModel = nrrSalesPipelineModel;

// Per-Sales-rep breakdown of a set of pipeline rows (a bucket's rows, or any
// subset) — {rep, gmv, outlets, rows[]} sorted by GMV desc. Rows with no
// staff_owner (old CSV before the v4 SQL added it, or genuinely blank) group
// under "ไม่ระบุ Sales".
function nrrPipelineByRep(rows) {
  var byRep = {};
  rows.forEach(function (r) {
    var rep = (r.staff_owner || '').trim() || 'ไม่ระบุ Sales';
    if (!byRep[rep]) byRep[rep] = { rep: rep, gmv: 0, outlets: 0, rows: [] };
    byRep[rep].gmv += r.last_month_gmv;
    byRep[rep].outlets += 1;
    byRep[rep].rows.push(r);
  });
  return Object.values(byRep).sort(function (a, b) { return b.gmv - a.gmv; });
}
window.nrrPipelineByRep = nrrPipelineByRep;

// {chain: computeResult|null, sa_mc: computeResult|null, other: computeResult|null}
function nrrPmResult() {
  var pd = window.bulkPmData;
  if (!pd || !pd.loaded) return null;
  return {
    chain: _nrrActualizeResult(nrrComputeBucket(pd.allRows, 'chain')),
    sa_mc: _nrrActualizeResult(nrrComputeBucket(pd.allRows, 'sa_mc')),
    other: _nrrActualizeResult(nrrComputeBucket(pd.allRows, 'other'))
  };
}
window.nrrPmResult = nrrPmResult;

function nrrAdminResult() {
  var ad = window.bulkAdminData;
  if (!ad || !ad.loaded) return null;
  return {
    chain: _nrrActualizeResult(nrrComputeBucket(ad.allRows, 'chain')),
    sa_mc: _nrrActualizeResult(nrrComputeBucket(ad.allRows, 'sa_mc')),
    other: _nrrActualizeResult(nrrComputeBucket(ad.allRows, 'other'))
  };
}
window.nrrAdminResult = nrrAdminResult;

// ── v5: VP pooled result — ALL portfolios as one book ────────────────────
// Same formula as the buckets (nrrComputeRowsPool), no bucket filter.
function nrrVpResult() {
  var vd = window.bulkVpData;
  if (!vd || !vd.loaded || !vd.allRows.length) return null;
  return _nrrActualizeResult(nrrComputeRowsPool(vd.allRows, 'vp'));
}
window.nrrVpResult = nrrVpResult;

// ── v5: handover cohort model (replicates Sense's verified pattern) ──────
// movement_type already encodes the cohort split at the SQL level:
//   'handover'  = new_user_exp_date in the base month → "cohort มิ.ย."
//   'new_sales' = exp date during the quarter → one cohort per the FIRST
//                 period_month the outlet appears in (claim-dedup), with
//                 its GMV carried forward into later months.
// Returns:
// {
//   handover:    { by_month: {m: {gmv, outlets:[{row,movement}]}} },
//   new_cohorts: [ { cohort_month, by_month: {m: {gmv, outlets}} } ]  // non-empty only
// }
function nrrHandoverCohorts(result) {
  var model = { handover: { by_month: {} }, new_cohorts: [] };
  if (!result || !result.months) return model;

  result.months.forEach(function (month) {
    var bm = result.by_month[month];
    var outlets = (bm.rows || []).filter(function (r) { return r.movement_type === 'handover'; })
      .map(function (r) { return { row: r, movement: 'handover' }; });
    var gmv = outlets.reduce(function (s, o) {
      var d = parseFloat(o.row.curr_days) || 30;
      return s + (d > 0 ? (parseFloat(o.row.curr_gmv) || 0) / d * nrrDaysIn(o.row.period_month) : 0);
    }, 0);
    model.handover.by_month[month] = { gmv: gmv, outlets: outlets };
  });

  // new_sales cohorts: claim each outlet into the first month it appears.
  var claimed = {}; // outlet_id -> cohort_month
  result.months.forEach(function (month) {
    (result.by_month[month].rows || []).forEach(function (r) {
      if (r.movement_type === 'new_sales' && !claimed[r.outlet_id]) claimed[r.outlet_id] = month;
    });
  });
  var cohortMonths = {};
  Object.keys(claimed).forEach(function (oid) { cohortMonths[claimed[oid]] = true; });

  Object.keys(cohortMonths).sort().forEach(function (cm) {
    var cohort = { cohort_month: cm, by_month: {} };
    result.months.forEach(function (month) {
      if (month < cm) { cohort.by_month[month] = null; return; } // "—" before cohort month
      var outlets = (result.by_month[month].rows || []).filter(function (r) {
        return r.movement_type === 'new_sales' && claimed[r.outlet_id] === cm;
      }).map(function (r) { return { row: r, movement: 'new_sales' }; });
      var gmv = outlets.reduce(function (s, o) {
        var d = parseFloat(o.row.curr_days) || 30;
        return s + (d > 0 ? (parseFloat(o.row.curr_gmv) || 0) / d * nrrDaysIn(o.row.period_month) : 0);
      }, 0);
      cohort.by_month[month] = { gmv: gmv, outlets: outlets };
    });
    model.new_cohorts.push(cohort);
  });

  return model;
}
window.nrrHandoverCohorts = nrrHandoverCohorts;

// VP "Total Portfolio" — 3 separate %NRR (KAM/PM/Admin), never blended into
// one number (per user's explicit answer), plus one combined GMV figure.
function nrrTotalPortfolio() {
  var kam = nrrOrgResult();
  var kamPeriod = nrrCurrentPeriod(kam);
  var kamPct = kam && kamPeriod ? kam.by_month[kamPeriod].nrr_pct : null;
  var kamGmv = kam ? Math.round(kam.base_norm * nrrBaseDays()) : 0;

  var pm = nrrPmResult();
  var pmPct = _nrrBlendedBucketPct(pm);
  var pmGmv = _nrrBlendedBucketGmv(pm);

  var admin = nrrAdminResult();
  var adminPct = _nrrBlendedBucketPct(admin);
  var adminGmv = _nrrBlendedBucketGmv(admin);

  return {
    kam: { pct: kamPct, gmv: kamGmv },
    pm: { pct: pmPct, gmv: pmGmv },
    admin: { pct: adminPct, gmv: adminGmv },
    total_gmv: kamGmv + pmGmv + adminGmv
  };
}
window.nrrTotalPortfolio = nrrTotalPortfolio;

// For a PM/Admin section's own headline %NRR (e.g. "PM overall"), blend its
// chain+sa_mc+other buckets back into one pooled numerator/denominator —
// this is a within-portfolio blend (chain+sa_mc are both still "PM"), not
// the KAM/PM/Admin cross-portfolio blend the user explicitly said NOT to do.
function _nrrBlendedBucketPct(bucketResult) {
  if (!bucketResult) return null;
  var buckets = ['chain', 'sa_mc', 'other'];
  var num = 0, den = 0;
  buckets.forEach(function (b) {
    var r = bucketResult[b];
    if (!r) return;
    var period = nrrCurrentPeriod(r);
    var bm = period ? r.by_month[period] : null;
    if (!bm || bm.nrr_pct == null) return;
    den += r.base_norm;
    num += (bm.nrr_pct / 100) * r.base_norm;
  });
  return den > 0 ? Math.round(num / den * 100) : null;
}

function _nrrBlendedBucketGmv(bucketResult) {
  if (!bucketResult) return 0;
  var buckets = ['chain', 'sa_mc', 'other'];
  var total = 0;
  buckets.forEach(function (b) {
    var r = bucketResult[b];
    if (r) total += Math.round(r.base_norm * nrrBaseDays());
  });
  return total;
}
