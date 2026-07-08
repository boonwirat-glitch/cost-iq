// ── nrr_logic.js ──────────────────────────────────────────────────────────
// PORTED VERBATIM from src/07c_qnrr_view.js (lines 1-346, the _qnrrCompute
// engine) for the new /nrr Team Lead & VP notebook dashboard.
//
// DO NOT "fix" or simplify the logic below on your own judgement — every
// asymmetry here (comeback numerator-only, transfer_in/out symmetric base
// adjustment, core_nrr_churn reclassification) is an intentional business
// decision already validated against real numbers in Sense. If a number
// computed here ever disagrees with what Sense's own QNRR sheet shows for
// the same KAM/TL/period, the bug is almost certainly in nrr_data.js's CSV
// parsing or in how this file is called — re-diff against
// src/07c_qnrr_view.js before changing anything in _qnrrCompute itself.
//
// Consumes window.bulkQnrrData, built by nrr_data.js in the exact same shape
// Sense itself builds it in (src/02_data_pipeline.js, bulk-qnrr-single
// handler): { byKamEmail:{email:[row]}, byTlEmail:{email:[row]}, allRows:[],
// loaded:true }.
// ────────────────────────────────────────────────────────────────────────

var QNRR_CFG = {
  quarter:    '2026q3',
  base_month: '2026-06',
  q_months:   ['2026-07', '2026-08', '2026-09'],
  months_th:  {
    '2026-06': 'มิ.ย.', '2026-07': 'ก.ค.',
    '2026-08': 'ส.ค.',  '2026-09': 'ก.ย.'
  },
  csv_file:   'sense_qnrr_2026q3.csv'
};
window.QNRR_CFG = QNRR_CFG;

// scope: 'kam' | 'tl' | 'admin'
// For 'tl'/'admin' scope, kamEmail may be the TL's own email (direct
// byTlEmail lookup, v817) or null/empty (pure org-wide, v850-fix — kamEmail
// is genuinely optional once scope !== 'kam').
function _qnrrCompute(kamEmail, scope) {
  scope = scope || 'kam';
  if (scope === 'kam' && !kamEmail) return null;
  var qd = window.bulkQnrrData;
  if (!qd || !qd.loaded) return null;

  var myTlEmail = '';
  var kamRows = (qd.byKamEmail && qd.byKamEmail[kamEmail]) || [];
  if (kamRows.length) {
    myTlEmail = (kamRows.find(function (r) { return r.latest_tl_email; }) || {}).latest_tl_email || '';
  }
  // TL/Admin login directly — their own email may live in byTlEmail directly.
  if (!myTlEmail && qd.byTlEmail && qd.byTlEmail[kamEmail]) {
    myTlEmail = kamEmail;
  }

  var allRows;
  if (scope === 'tl' && myTlEmail && qd.byTlEmail && qd.byTlEmail[myTlEmail]) {
    allRows = qd.byTlEmail[myTlEmail];
  } else if (scope === 'tl' && !myTlEmail) {
    // Admin viewing "team" scope with no personal TL — org-wide fallback.
    allRows = qd.allRows || [];
  } else if (scope === 'admin') {
    allRows = qd.allRows || [];
  } else {
    allRows = kamRows;
  }
  if (!allRows || !allRows.length) return null;

  function _rowInScope(r) {
    if (scope === 'kam')   return r.latest_kam_email === kamEmail;
    if (scope === 'tl')    return myTlEmail ? r.latest_tl_email === myTlEmail : true;
    if (scope === 'admin') return true;
    return r.latest_kam_email === kamEmail;
  }

  function _effectiveMovement(r) {
    // core_nrr row with curr_gmv=0 IS a churned outlet this period — the raw
    // CSV never contains the literal 'core_nrr_churn' value.
    if (r.movement_type === 'core_nrr' && (parseFloat(r.curr_gmv) || 0) === 0) {
      return 'core_nrr_churn';
    }
    if (scope === 'kam') return r.movement_type;

    // "org-wide, no portfolio boundary" applies both to scope==='admin' AND
    // to scope==='tl' with myTlEmail==='' (Admin viewing the "ทีม" toggle
    // without personally being a TL of any squad) — same resolved view.
    var isOrgWideView = (scope === 'admin') || (scope === 'tl' && !myTlEmail);
    if (isOrgWideView) {
      // No boundary between individual KAMs at this scope: a pure KAM<->KAM
      // reassignment never cost/gained the org anything, so it reads as
      // core_nrr regardless of squad. Moves involving PM/ADMIN/SALE are a
      // genuine portfolio-TYPE change and stay visible as transfer.
      var isPureKamMove = (r.base_portfolio === 'KAM' && r.current_portfolio === 'KAM') || !r.transfer_scope;
      if (isPureKamMove && r.movement_type === 'transfer_out') return null;
      if (isPureKamMove && r.movement_type === 'transfer_in')  return 'core_nrr';
      return r.movement_type;
    }

    // Same-squad transfer_in/out between KAMs → neutralize. Cross-squad, or
    // moves touching a non-KAM portfolio type → count normally.
    var sameTlBase   = r.base_tl_email && r.base_tl_email === myTlEmail;
    var sameTlPeriod = r.latest_tl_email === myTlEmail;
    var isPureKamMove2 = (r.base_portfolio === 'KAM' && r.current_portfolio === 'KAM') || !r.transfer_scope;
    var sameTeam     = sameTlBase && sameTlPeriod && isPureKamMove2;
    if (sameTeam && r.movement_type === 'transfer_out') return null;
    if (sameTeam && r.movement_type === 'transfer_in')  return 'core_nrr';
    return r.movement_type;
  }

  var scopedRows = allRows.filter(_rowInScope);
  if (!scopedRows.length) return null;

  var base_month = scopedRows[0].base_month || QNRR_CFG.base_month;
  var months   = [];
  var monthSet = {};
  scopedRows.forEach(function (r) {
    if (!monthSet[r.period_month]) { monthSet[r.period_month] = 1; months.push(r.period_month); }
  });
  months.sort();

  // ── Build baseMap from first period-month rows ──────────────────────────
  var baseMap = {};
  var baseMonthRows = scopedRows.filter(function (r) { return r.period_month === months[0]; });
  baseMonthRows.forEach(function (r) {
    if (r.base_gmv > 0 && !baseMap[r.outlet_id] && r.movement_type !== 'handover') {
      baseMap[r.outlet_id] = { gmv: r.base_gmv, days: r.base_days || 31 };
    }
  });

  var base_gmv_original = 0;
  var base_norm_original = 0;
  Object.keys(baseMap).forEach(function (oid) {
    var b = baseMap[oid];
    base_gmv_original  += b.gmv;
    base_norm_original += b.gmv / b.days;
  });

  // ── Core-cohort transfer_out across the entire quarter (retroactive) ────
  var coreTransferOutSet = {};
  scopedRows.forEach(function (r) {
    var mv = _effectiveMovement(r);
    if (mv === 'transfer_out' && baseMap[r.outlet_id] && !coreTransferOutSet[r.outlet_id]) {
      var b = baseMap[r.outlet_id];
      coreTransferOutSet[r.outlet_id] = {
        gmv_norm: b.gmv / b.days,
        account_name: r.account_name || '',
        period_month: r.period_month
      };
    }
  });

  var transfer_out_base_norm = 0;
  var transfer_out_base_gmv  = 0;
  var transfer_out_outlets   = [];
  Object.keys(coreTransferOutSet).forEach(function (oid) {
    var t = coreTransferOutSet[oid];
    transfer_out_base_norm += t.gmv_norm;
    transfer_out_base_gmv  += baseMap[oid].gmv;
    transfer_out_outlets.push({ outlet_id: oid, gmv_norm: t.gmv_norm, account_name: t.account_name, period_month: t.period_month });
  });

  // ── transfer_in across the entire quarter — symmetric with transfer_out ──
  var coreTransferInSet = {};
  scopedRows.forEach(function (r) {
    var mv = _effectiveMovement(r);
    if (mv === 'transfer_in' && !coreTransferInSet[r.outlet_id]) {
      var b_gmv  = parseFloat(r.base_gmv) || 0;
      var b_days = parseFloat(r.base_days) || 31;
      coreTransferInSet[r.outlet_id] = {
        gmv: b_gmv, gmv_norm: b_gmv / b_days,
        account_name: r.account_name || '', period_month: r.period_month
      };
    }
  });
  var transfer_in_base_norm = 0;
  var transfer_in_base_gmv  = 0;
  var transfer_in_outlets   = [];
  Object.keys(coreTransferInSet).forEach(function (oid) {
    var t = coreTransferInSet[oid];
    transfer_in_base_norm += t.gmv_norm;
    transfer_in_base_gmv  += t.gmv;
    transfer_in_outlets.push({ outlet_id: oid, gmv_norm: t.gmv_norm, account_name: t.account_name, period_month: t.period_month });
  });

  var base_norm = base_norm_original - transfer_out_base_norm + transfer_in_base_norm;
  var base_gmv  = base_gmv_original  - transfer_out_base_gmv  + transfer_in_base_gmv;
  var cohort_outlets = Object.keys(baseMap).length;

  var handover_base_norm = 0;
  baseMonthRows.forEach(function (r) {
    if (r.movement_type === 'handover' && r.base_gmv > 0) {
      var base_d = parseFloat(r.base_days) || 31;
      handover_base_norm += (parseFloat(r.base_gmv) || 0) / base_d * 30;
    }
  });

  var MOVEMENTS = ['core_nrr', 'core_nrr_churn', 'handover', 'new_sales',
    'expansion', 'comeback', 'transfer_in', 'transfer_out'];

  var by_month = {};
  months.forEach(function (month) {
    var monthRows = scopedRows.filter(function (r) { return r.period_month === month; });
    var segments = {};
    var outlets  = {};
    MOVEMENTS.forEach(function (m) { segments[m] = 0; outlets[m] = 0; });

    var seenOutlets = {};
    var nrr_curr_norm = 0;
    var core_nrr_base_sum = 0;

    monthRows.forEach(function (r) {
      var mv = _effectiveMovement(r);
      if (!mv) return;
      var base_d = parseFloat(r.base_days) || 31;
      var curr_d = parseFloat(r.curr_days) || 30;
      var gmvVal = (mv === 'core_nrr_churn' || mv === 'transfer_out')
        ? (parseFloat(r.base_gmv) || 0) / base_d * 30
        : (parseFloat(r.curr_gmv) || 0) / curr_d * 30;
      segments[mv] = (segments[mv] || 0) + gmvVal;
      outlets[mv]  = (outlets[mv]  || 0) + 1;

      if (mv === 'core_nrr') {
        core_nrr_base_sum += (parseFloat(r.base_gmv) || 0) / base_d * 30;
      }

      if ((mv === 'core_nrr' || mv === 'core_nrr_churn' || mv === 'transfer_in') && r.base_gmv > 0) {
        if (!seenOutlets[r.outlet_id]) {
          seenOutlets[r.outlet_id] = true;
          var curr_days = r.curr_days || 30;
          nrr_curr_norm += curr_days > 0 ? r.curr_gmv / curr_days : 0;
        }
      }

      // Comeback: pure upside added only to the numerator against an
      // unchanged base (comeback outlets have base_gmv=0 by definition —
      // never in baseMap, never touch the denominator). Intentionally
      // asymmetric with transfer_in, which adds to BOTH sides.
      if (mv === 'comeback') {
        if (!seenOutlets[r.outlet_id]) {
          seenOutlets[r.outlet_id] = true;
          var curr_days_cb = r.curr_days || 30;
          nrr_curr_norm += curr_days_cb > 0 ? r.curr_gmv / curr_days_cb : 0;
        }
      }
    });

    var nrr_pct = base_norm > 0 ? Math.round(nrr_curr_norm / base_norm * 100) : null;

    var total_gmv = MOVEMENTS
      .filter(function (m) { return m !== 'transfer_out' && m !== 'core_nrr_churn'; })
      .reduce(function (s, m) { return s + (segments[m] || 0); }, 0);

    var curr_days_sample = monthRows.find(function (r) { return r.curr_days > 0; });
    var curr_days = curr_days_sample ? curr_days_sample.curr_days : 30;
    var contraction = (segments.core_nrr || 0) - core_nrr_base_sum;

    var monthParts  = month.split('-');
    var daysInMonth = new Date(parseInt(monthParts[0], 10), parseInt(monthParts[1], 10), 0).getDate();
    var isPartial   = curr_days > 0 && curr_days < daysInMonth - 2;

    by_month[month] = {
      nrr_pct: nrr_pct, total_gmv: total_gmv, segments: segments, outlets: outlets,
      rows: monthRows, curr_days: curr_days, days_in_month: daysInMonth,
      is_partial: isPartial, core_nrr_base: core_nrr_base_sum, contraction: contraction
    };
  });

  return {
    quarter: QNRR_CFG.quarter,
    base_month: base_month,
    months: months,
    base_gmv: base_gmv,
    base_norm: base_norm,
    base_norm_original: base_norm_original,
    transfer_out_base_norm: transfer_out_base_norm,
    transfer_out_outlets: transfer_out_outlets,
    transfer_in_base_norm: transfer_in_base_norm,
    transfer_in_outlets: transfer_in_outlets,
    handover_base_norm: handover_base_norm,
    cohort_outlets: cohort_outlets,
    by_month: by_month
  };
}
window._qnrrCompute = _qnrrCompute;

// ── nrrComputeBucket — PM/Admin portfolio-view NRR, grouped by account_type ──
// PM/Admin data (pm_view.csv / admin_view.csv) has NO kam/tl email columns at
// all — there is no per-person or per-team ownership concept for these two
// portfolio types, only account_type (SA/MC vs Chain). This is NOT a port
// from Sense (nothing in Sense computes PM/Admin NRR today) — it's the same
// %NRR formula as _qnrrCompute above, re-targeted to filter by
// nrrAccountBucket(row) === bucket instead of kam/tl email.
//
// Deliberately simpler than _qnrrCompute in two ways:
//  1. No _effectiveMovement-style neutralization — there's no "same-team
//     transfer" concept across account_type buckets, so every transfer_in/
//     transfer_out counts at face value, always.
//  2. No filtering by current_portfolio — exactly like rep_view rows are
//     never filtered by current_portfolio in _qnrrCompute, pm_view.csv /
//     admin_view.csv rows already represent "this portfolio's movement
//     story" end to end (including rows where current_portfolio shows the
//     outlet left to KAM/SALE this quarter) — filtering them out would
//     incorrectly drop real transfer_out/in adjustments.
//
// rows: the full allRows array from bulkPmData or bulkAdminData.
// bucket: 'chain' | 'sa_mc' | 'other' (see nrrAccountBucket in nrr_data.js).
function nrrComputeBucket(rows, bucket) {
  if (!rows || !rows.length) return null;
  var bucketRows = rows.filter(function (r) { return nrrAccountBucket(r) === bucket; });
  return nrrComputeRowsPool(bucketRows, bucket);
}
window.nrrComputeBucket = nrrComputeBucket;

// ── nrrComputeRowsPool — the pooled-rows NRR formula itself (v5 extract) ──
// Extracted verbatim from nrrComputeBucket so the SAME formula also serves
// the VP view (vp_view.csv: all three portfolios pooled, no bucket filter).
// The formula is naturally correct for VP: transfer_out still subtracts
// from the denominator, and the transfer_in adjustment computes to zero on
// its own because VP rows contain no transfer_in (verified in the Q2 vp
// SQL — inter-portfolio moves are invisible inside one pool).
function nrrComputeRowsPool(bucketRows, bucketLabel) {
  if (!bucketRows || !bucketRows.length) return null;

  function effMv(r) {
    if (r.movement_type === 'core_nrr' && (parseFloat(r.curr_gmv) || 0) === 0) return 'core_nrr_churn';
    return r.movement_type;
  }

  var months = [];
  var monthSet = {};
  bucketRows.forEach(function (r) {
    if (!monthSet[r.period_month]) { monthSet[r.period_month] = 1; months.push(r.period_month); }
  });
  months.sort();
  var baseMonth = months[0];

  var baseMap = {};
  bucketRows.filter(function (r) { return r.period_month === baseMonth; }).forEach(function (r) {
    if (r.base_gmv > 0 && !baseMap[r.outlet_id] && r.movement_type !== 'handover') {
      baseMap[r.outlet_id] = { gmv: r.base_gmv, days: r.base_days || 31 };
    }
  });

  var base_norm_original = 0;
  Object.keys(baseMap).forEach(function (oid) { base_norm_original += baseMap[oid].gmv / baseMap[oid].days; });

  var transferOutNorm = 0;
  var transfer_out_outlets = [];
  var seenOut = {};
  bucketRows.forEach(function (r) {
    if (effMv(r) === 'transfer_out' && baseMap[r.outlet_id] && !seenOut[r.outlet_id]) {
      seenOut[r.outlet_id] = true;
      transferOutNorm += baseMap[r.outlet_id].gmv / baseMap[r.outlet_id].days;
      transfer_out_outlets.push({ outlet_id: r.outlet_id, account_name: r.account_name || '', period_month: r.period_month });
    }
  });

  var transferInNorm = 0;
  var transfer_in_outlets = [];
  var seenIn = {};
  bucketRows.forEach(function (r) {
    if (effMv(r) === 'transfer_in' && !seenIn[r.outlet_id]) {
      seenIn[r.outlet_id] = true;
      var b_gmv = parseFloat(r.base_gmv) || 0;
      var b_days = parseFloat(r.base_days) || 31;
      transferInNorm += b_gmv / b_days;
      transfer_in_outlets.push({ outlet_id: r.outlet_id, account_name: r.account_name || '', period_month: r.period_month });
    }
  });

  var base_norm = base_norm_original - transferOutNorm + transferInNorm;
  var cohort_outlets = Object.keys(baseMap).length;

  // Handover base — base-month GMV of handover-cohort outlets, ×30
  // normalized. Mirrors _qnrrCompute's handover_base_norm so the shared
  // chart's base-column slate segment and the "cohort มิ.ย." table row
  // reconcile for PM/Admin/VP views too (v5 addition; was silently 0 for
  // bucket results in v4).
  var handover_base_norm = 0;
  bucketRows.filter(function (r) { return r.period_month === baseMonth; }).forEach(function (r) {
    if (r.movement_type === 'handover' && r.base_gmv > 0) {
      var hb_d = parseFloat(r.base_days) || 31;
      handover_base_norm += (parseFloat(r.base_gmv) || 0) / hb_d * 30;
    }
  });

  var by_month = {};
  months.forEach(function (month) {
    var monthRows = bucketRows.filter(function (r) { return r.period_month === month; });
    var segments = {}; var outlets = {};
    ['core_nrr', 'core_nrr_churn', 'handover', 'new_sales', 'expansion', 'comeback', 'transfer_in', 'transfer_out'].forEach(function (m) {
      segments[m] = 0; outlets[m] = 0;
    });
    var seenOutlets = {};
    var nrr_curr_norm = 0;

    monthRows.forEach(function (r) {
      var mv = effMv(r);
      var base_d = parseFloat(r.base_days) || 31;
      var curr_d = parseFloat(r.curr_days) || 30;
      var gmvVal = (mv === 'core_nrr_churn' || mv === 'transfer_out')
        ? (parseFloat(r.base_gmv) || 0) / base_d * 30
        : (parseFloat(r.curr_gmv) || 0) / curr_d * 30;
      segments[mv] = (segments[mv] || 0) + gmvVal;
      outlets[mv] = (outlets[mv] || 0) + 1;

      if ((mv === 'core_nrr' || mv === 'core_nrr_churn' || mv === 'transfer_in') && r.base_gmv > 0) {
        if (!seenOutlets[r.outlet_id]) {
          seenOutlets[r.outlet_id] = true;
          nrr_curr_norm += r.curr_days > 0 ? r.curr_gmv / r.curr_days : 0;
        }
      }
      if (mv === 'comeback' && !seenOutlets[r.outlet_id]) {
        seenOutlets[r.outlet_id] = true;
        nrr_curr_norm += r.curr_days > 0 ? r.curr_gmv / r.curr_days : 0;
      }
    });

    var nrr_pct = base_norm > 0 ? Math.round(nrr_curr_norm / base_norm * 100) : null;

    // v4 additive fields mirroring _qnrrCompute's month block, so the
    // shared movement chart/table + expansion components can consume both
    // result shapes identically. (This function is NOT a Sense port — safe
    // to extend, per header comment. _qnrrCompute stays frozen.)
    var total_gmv = ['core_nrr', 'handover', 'new_sales', 'expansion', 'comeback', 'transfer_in']
      .reduce(function (s, m) { return s + (segments[m] || 0); }, 0);
    var curr_days_sample = monthRows.find(function (r) { return r.curr_days > 0; });
    var curr_days = curr_days_sample ? curr_days_sample.curr_days : 30;
    var monthParts = month.split('-');
    var daysInMonth = new Date(parseInt(monthParts[0], 10), parseInt(monthParts[1], 10), 0).getDate();
    var isPartial = curr_days > 0 && curr_days < daysInMonth - 2;

    by_month[month] = {
      nrr_pct: nrr_pct, segments: segments, outlets: outlets,
      rows: monthRows, total_gmv: total_gmv,
      curr_days: curr_days, days_in_month: daysInMonth, is_partial: isPartial
    };
  });

  return {
    bucket: bucketLabel || null,
    // baseMonth above is the first PERIOD month (used only to pick which
    // rows carry the base cohort). The actual base month label is the
    // quarter config's fixed base month — same convention as _qnrrCompute.
    base_month: QNRR_CFG.base_month,
    base_norm: base_norm,
    base_norm_original: base_norm_original,
    transfer_out_base_norm: transferOutNorm,
    transfer_out_outlets: transfer_out_outlets,
    transfer_in_base_norm: transferInNorm,
    transfer_in_outlets: transfer_in_outlets,
    handover_base_norm: handover_base_norm,
    cohort_outlets: cohort_outlets,
    months: months,
    by_month: by_month
  };
}
window.nrrComputeRowsPool = nrrComputeRowsPool;

// ── nrrClassifyRow — standalone per-row classifier for outlet-level UI ──
// _effectiveMovement above is a closure private to _qnrrCompute (matches
// Sense's own source exactly, on purpose — do not touch it). The drill-down
// UI (movement badges on individual outlet rows) needs the same
// classification available OUTSIDE that closure, so this is a parameterized
// copy of the identical logic. If _effectiveMovement above ever changes,
// this must change too, in lockstep.
function nrrClassifyRow(r, scope, myTlEmail) {
  if (r.movement_type === 'core_nrr' && (parseFloat(r.curr_gmv) || 0) === 0) {
    return 'core_nrr_churn';
  }
  if (scope === 'kam') return r.movement_type;

  var isOrgWideView = (scope === 'admin') || (scope === 'tl' && !myTlEmail);
  if (isOrgWideView) {
    var isPureKamMoveOrg = (r.base_portfolio === 'KAM' && r.current_portfolio === 'KAM') || !r.transfer_scope;
    if (isPureKamMoveOrg && r.movement_type === 'transfer_out') return null;
    if (isPureKamMoveOrg && r.movement_type === 'transfer_in')  return 'core_nrr';
    return r.movement_type;
  }

  var sameTlBase   = r.base_tl_email && r.base_tl_email === myTlEmail;
  var sameTlPeriod = r.latest_tl_email === myTlEmail;
  var isPureKamMove = (r.base_portfolio === 'KAM' && r.current_portfolio === 'KAM') || !r.transfer_scope;
  var sameTeam = sameTlBase && sameTlPeriod && isPureKamMove;
  if (sameTeam && r.movement_type === 'transfer_out') return null;
  if (sameTeam && r.movement_type === 'transfer_in')  return 'core_nrr';
  return r.movement_type;
}
window.nrrClassifyRow = nrrClassifyRow;
