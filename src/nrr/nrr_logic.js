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
// NOTE (2026-07-08, nrr_v10 + Sense v852): baseMap construction excludes rows
// whose _effectiveMovement is 'transfer_in' — without this, a transfer_in
// landing in the FIRST period month of the quarter had its base_gmv counted
// TWICE (once via baseMap, once via the symmetric transfer_in adjustment),
// inflating the base and deflating NRR% (2026-07 PM→KAM bulk move: 44
// outlets, ฿2.34M double-counted; Tape showed 92% instead of 99%). The same
// fix is applied in src/07c_qnrr_view.js (v852) — both engines are in sync.
// Details: docs/handoff-2026-07-08-nrr-transfer-in-fix.md
//
// NOTE (2026-07-14, waived-account feature): a deliberate, CONFIRMED
// exception to the "do not fix independently" rule above — this is a real
// feature addition (waived-account NRR exclusion), not an unreviewed bug
// fix, applied in lockstep with the identical diff in
// src/07c_qnrr_view.js's _qnrrCompute in the same commit. See
// nrr_exclusions.js for nrrAccountWaivedForPeriod().
//
// NOTE (2026-07-28, v_segfilter): _qnrrCompute gained an OPTIONAL third
// `opts` param carrying `{segments:['sa','mc','chain','other']}` — a
// customer-segment (account_type) filter for the /nrr dashboard's Movement +
// KAM Leaderboard sections. Omitting it is byte-identical to the old
// behavior, which is deliberate: nrrKamResult is also called by
// nrr_commission.js, nrr_portfolio.js and the masthead, and NONE of them
// may be affected by a dashboard filter. That guarantee is structural — a
// call site that doesn't pass `opts` cannot be filtered — which is why this
// is an explicit param and not an ambient module-level variable.
//
// The filter MUST live inside _rowInScope, never as a pre-filter on
// bulkQnrrData. Pre-filtering empties qd.byTlEmail[tl], so myTlEmail
// resolves to '' and the "Admin viewing team scope with no personal TL"
// org-wide fallback silently fires — measured: a team with zero SA outlets
// returned the whole ORG's SA figure (nrr=100.6) under its own team
// heading, no error. _rowInScope runs after myTlEmail is resolved from the
// unfiltered index, so it is immune. tools/verify_segment_filter.js locks
// this with an explicit assertion.
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
  csv_file:   'kam_rep_view.csv'
};
window.QNRR_CFG = QNRR_CFG;

// scope: 'kam' | 'tl' | 'admin' | 'ad'
// For 'tl'/'admin'/'ad' scope, kamEmail may be the TL's own email (direct
// byTlEmail lookup, v817) or null/empty (pure org-wide, v850-fix — kamEmail
// is genuinely optional once scope !== 'kam').
//
// v_adsplit (2026-07-22, mirrored in src/07c_qnrr_view.js in the same
// commit): 'tl' and 'admin' scopes now EXCLUDE rows whose latest_kam_email
// belongs to someone whose real profiles.role is not KAM (pm/admin/sales/
// ad/... — window.nrrRoleRoster.nonKamSet), and a new 'ad' scope selects
// exactly the ad/ad_tl people's rows for the org AD bucket. Rationale: the
// CSV's latest_kam_email tracks portfolio OWNERSHIP, not employment role —
// an AD (Ornpreya "Ice") holding 75 outlets under team Ploy was inflating
// the KAM team's %NRR (and the TL's commission NRR). scope 'kam' is
// deliberately untouched so her own self-view keeps working. Empty roster
// (fetch failed / not yet loaded) = exactly the old behavior.
// v_segfilter: 4-way customer-segment key. Deliberately NOT nrrAccountBucket()
// (nrr_data.js), which collapses SA+MC into one 'sa_mc' bucket for the
// Company/Squad views — the dashboard filter needs SA and MC apart. 'other'
// catches 'Unknown', blank, and any value BigQuery starts emitting later, so
// selecting all four keys always filters exactly nothing. That makes
// "all tiles on == unfiltered" a provable invariant rather than an
// approximation, which is why the tail is a real key and not a dropped row.
function nrrSegmentKey(row) {
  var t = (row.account_type || '').trim();
  if (t === 'SA') return 'sa';
  if (t === 'MC') return 'mc';
  if (t === 'Chain') return 'chain';
  return 'other';
}
window.nrrSegmentKey = nrrSegmentKey;

function _qnrrCompute(kamEmail, scope, opts) {
  scope = scope || 'kam';
  if (scope === 'kam' && !kamEmail) return null;
  // Captured once so it stays constant across every _rowInScope / baseMap /
  // _effectiveMovement pass within this one compute. Empty/absent => null =>
  // the predicate below short-circuits and this function is byte-identical
  // to its pre-v_segfilter behavior.
  var _segs = (opts && opts.segments && opts.segments.length) ? opts.segments : null;
  var qd = window.bulkQnrrData;
  if (!qd || !qd.loaded) return null;
  var _roster = window.nrrRoleRoster || { nonKamSet: new Set(), adSet: new Set() };
  var _nonKam = _roster.nonKamSet || new Set();
  var _adSet = _roster.adSet || new Set();

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
  } else if (scope === 'admin' || scope === 'ad') {
    allRows = qd.allRows || [];
  } else {
    allRows = kamRows;
  }
  if (!allRows || !allRows.length) return null;

  function _isNonKamOwner(r) {
    return _nonKam.has((r.latest_kam_email || '').toLowerCase());
  }
  function _rowInScope(r) {
    // v_segfilter: segment gate runs FIRST and is orthogonal to every scope
    // branch below — an AND-condition, not a sibling of them.
    if (_segs && _segs.indexOf(nrrSegmentKey(r)) === -1) return false;
    if (scope === 'kam')   return r.latest_kam_email === kamEmail;
    if (scope === 'tl')    return (myTlEmail ? r.latest_tl_email === myTlEmail : true) && !_isNonKamOwner(r);
    if (scope === 'admin') return !_isNonKamOwner(r);
    if (scope === 'ad')    return _adSet.has((r.latest_kam_email || '').toLowerCase());
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
    // v_adsplit: scope 'ad' is also boundary-less (org-level AD bucket).
    var isOrgWideView = (scope === 'admin') || (scope === 'ad') || (scope === 'tl' && !myTlEmail);
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
  // v_recon: หลักฐานการนับฐาน — บันทึกว่าแต่ละ outlet เข้า/ไม่เข้าฐาน "เพราะอะไร"
  // เขียนคู่ไปกับการตัดสินจริงในลูปเดียวกัน จึงโกหกไม่ได้ (ถ้า logic เปลี่ยน
  // audit เปลี่ยนตาม) · เป็น field เพิ่มล้วน ไม่แตะการคำนวณเดิมแม้แต่บรรทัดเดียว
  // เหตุผลที่ต้องมี: ก่อนหน้านี้ไม่มีทางรู้เลยว่าเลขฐานบนจอประกอบด้วย outlet ไหนบ้าง
  // ต้องมานั่งเดา/เขียนสูตรซ้ำข้างนอก ซึ่งคือต้นตอที่ทำให้เลขไม่ตรงกันหลายรอบ
  var base_audit = [];
  var baseMonthRows = scopedRows.filter(function (r) { return r.period_month === months[0]; });
  baseMonthRows.forEach(function (r) {
    // transfer_in excluded (like handover): its base_gmv belongs to the
    // PREVIOUS owner and is added exactly once by the symmetric transfer_in
    // adjustment below. Effective (not raw) movement, so a same-team
    // KAM↔KAM move reclassified to core_nrr at tl/admin scope stays in the
    // base — it was this scope's outlet in the base month already.
    var _eff = _effectiveMovement(r);
    var _reason = '';
    if (!(r.base_gmv > 0))                  _reason = 'base_gmv=0';
    else if (baseMap[r.outlet_id])          _reason = 'duplicate_outlet';
    else if (r.movement_type === 'handover') _reason = 'handover';
    else if (_eff === 'transfer_in')        _reason = 'transfer_in (บวกกลับแยกด้านล่าง)';
    if (!_reason) {
      baseMap[r.outlet_id] = { gmv: r.base_gmv, days: r.base_days || 31, account_id: r.account_id };
    }
    base_audit.push({
      outlet_id: r.outlet_id, account_id: r.account_id,
      account_name: r.account_name || '', outlet_name: r.res_name || '',
      account_type: r.account_type || '', cohort_month: r.cohort_month || '',
      kam_email: r.latest_kam_email || '', kam_name: r.latest_staff_owner || '',
      movement_type: r.movement_type, movement_effective: _eff || '(neutralized)',
      base_gmv: parseFloat(r.base_gmv) || 0, base_days: parseFloat(r.base_days) || 31,
      base_norm_30d: (parseFloat(r.base_gmv) || 0) / (parseFloat(r.base_days) || 31) * 30,
      included: !_reason, exclude_reason: _reason
    });
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
    // v_recon: หลักฐานฝั่งตัวตั้ง — คู่กับ base_audit ด้านบน ทำให้เห็นเคสสำคัญที่สุด
    // คือ outlet ที่ "อยู่ในตัวหารแต่ไม่อยู่ในตัวตั้ง" ซึ่งกด %NRR ลงโดยไม่มีใครเห็น
    var numerator_audit = [];

    monthRows.forEach(function (r) {
      var mv = _effectiveMovement(r);
      if (!mv) {
        numerator_audit.push({
          outlet_id: r.outlet_id, account_id: r.account_id,
          account_name: r.account_name || '', outlet_name: r.res_name || '',
          movement_type: r.movement_type, movement_effective: '(neutralized)',
          curr_gmv: parseFloat(r.curr_gmv) || 0, curr_days: parseFloat(r.curr_days) || 30,
          curr_norm_30d: 0, counted: false, waived: false,
          reason: 'neutralized (transfer ในทีมเดียวกัน ไม่นับทั้งสองฝั่ง)'
        });
        return;
      }
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

      // Waived accounts (nrr_exclusions, approved for this exact
      // period_month) still count toward GMV/segments/outlets above — only
      // excluded from the NRR numerator (here) and denominator
      // (effectiveBaseNorm below).
      var waived = typeof nrrAccountWaivedForPeriod === 'function' &&
        nrrAccountWaivedForPeriod(r.account_id, month, r.outlet_id);

      var _counted = false, _why = '';
      if (!waived && (mv === 'core_nrr' || mv === 'core_nrr_churn' || mv === 'transfer_in') && r.base_gmv > 0) {
        if (!seenOutlets[r.outlet_id]) {
          seenOutlets[r.outlet_id] = true;
          var curr_days = r.curr_days || 30;
          nrr_curr_norm += curr_days > 0 ? r.curr_gmv / curr_days : 0;
          _counted = true; _why = mv;
        } else { _why = 'duplicate_outlet'; }
      }

      // Comeback: pure upside added only to the numerator against an
      // unchanged base (comeback outlets have base_gmv=0 by definition —
      // never in baseMap, never touch the denominator). Intentionally
      // asymmetric with transfer_in, which adds to BOTH sides.
      if (!waived && mv === 'comeback') {
        if (!seenOutlets[r.outlet_id]) {
          seenOutlets[r.outlet_id] = true;
          var curr_days_cb = r.curr_days || 30;
          nrr_curr_norm += curr_days_cb > 0 ? r.curr_gmv / curr_days_cb : 0;
          _counted = true; _why = 'comeback';
        } else { _why = 'duplicate_outlet'; }
      }
      if (!_counted && !_why) {
        _why = waived ? 'waived (ยกเว้นตามคำขอ)'
             : (r.base_gmv > 0 ? 'ไม่อยู่ในนิยามตัวตั้ง: ' + mv
                               : 'ไม่อยู่ในนิยามตัวตั้ง: ' + mv + ' + ไม่มียอดฐาน');
      }
      var _cd = parseFloat(r.curr_days) || 30;
      numerator_audit.push({
        outlet_id: r.outlet_id, account_id: r.account_id,
        account_name: r.account_name || '', outlet_name: r.res_name || '',
        account_type: r.account_type || '', cohort_month: r.cohort_month || '',
        kam_email: r.latest_kam_email || '', kam_name: r.latest_staff_owner || '',
        movement_type: r.movement_type, movement_effective: mv,
        base_gmv: parseFloat(r.base_gmv) || 0,
        curr_gmv: parseFloat(r.curr_gmv) || 0, curr_days: _cd,
        curr_norm_30d: _cd > 0 ? (parseFloat(r.curr_gmv) || 0) / _cd * 30 : 0,
        counted: _counted, waived: !!waived, reason: _why
      });
    });

    // Waived-account base contribution removed per-month (unlike
    // transfer_out/in, which are quarter-wide and already baked into
    // base_norm above) — a waiver applies to one specific month only.
    var effectiveBaseNorm = base_norm;
    if (typeof nrrAccountWaivedForPeriod === 'function') {
      Object.keys(baseMap).forEach(function (oid) {
        var b = baseMap[oid];
        if (b.account_id && nrrAccountWaivedForPeriod(b.account_id, month, oid)) {
          effectiveBaseNorm -= (b.gmv / b.days);
        }
      });
    }

    // 1-decimal precision (was whole-number) per 2026-07-14 user request —
    // matches the real precision Supabase's locked commission snapshots
    // already carry (raw_nrr_pct/governed_nrr_pct are NUMERIC(x,2)), so a
    // client-side ESTIMATE for an unlocked period doesn't look artificially
    // coarser than the real number that eventually locks in for it.
    var nrr_pct = effectiveBaseNorm > 0 ? Math.round(nrr_curr_norm / effectiveBaseNorm * 1000) / 10 : null;

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
      nrr_pct: nrr_pct, effective_base_norm: effectiveBaseNorm, total_gmv: total_gmv, segments: segments, outlets: outlets,
      rows: monthRows, curr_days: curr_days, days_in_month: daysInMonth,
      is_partial: isPartial, core_nrr_base: core_nrr_base_sum, contraction: contraction,
      // v_recon: ตัวตั้งดิบ (ยังไม่หาร) เก็บไว้ให้ export กระทบยอดได้ตรงๆ
      nrr_curr_norm: nrr_curr_norm, numerator_audit: numerator_audit
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
    // v_recon: หลักฐานว่าฐานประกอบด้วย outlet ไหนบ้าง + ตัวไหนถูกตัดเพราะอะไร
    base_audit: base_audit,
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
    // Same month-1 transfer_in exclusion as _qnrrCompute's baseMap (see the
    // divergence note in the file header) — pm_view.csv carries inbound
    // transfer_in rows too, so the pool base double-counts identically.
    if (r.base_gmv > 0 && !baseMap[r.outlet_id] && r.movement_type !== 'handover'
        && effMv(r) !== 'transfer_in') {
      baseMap[r.outlet_id] = { gmv: r.base_gmv, days: r.base_days || 31, account_id: r.account_id };
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

      var waived = typeof nrrAccountWaivedForPeriod === 'function' &&
        nrrAccountWaivedForPeriod(r.account_id, month, r.outlet_id);

      if (!waived && (mv === 'core_nrr' || mv === 'core_nrr_churn' || mv === 'transfer_in') && r.base_gmv > 0) {
        if (!seenOutlets[r.outlet_id]) {
          seenOutlets[r.outlet_id] = true;
          nrr_curr_norm += r.curr_days > 0 ? r.curr_gmv / r.curr_days : 0;
        }
      }
      if (!waived && mv === 'comeback' && !seenOutlets[r.outlet_id]) {
        seenOutlets[r.outlet_id] = true;
        nrr_curr_norm += r.curr_days > 0 ? r.curr_gmv / r.curr_days : 0;
      }
    });

    var effectiveBaseNorm = base_norm;
    if (typeof nrrAccountWaivedForPeriod === 'function') {
      Object.keys(baseMap).forEach(function (oid) {
        var b = baseMap[oid];
        if (b.account_id && nrrAccountWaivedForPeriod(b.account_id, month, oid)) {
          effectiveBaseNorm -= (b.gmv / b.days);
        }
      });
    }

    // 1-decimal precision — see the matching comment on _qnrrCompute's own
    // nrr_pct line above; same rationale applies to the PM/Admin/VP pool.
    var nrr_pct = effectiveBaseNorm > 0 ? Math.round(nrr_curr_norm / effectiveBaseNorm * 1000) / 10 : null;

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
      nrr_pct: nrr_pct, effective_base_norm: effectiveBaseNorm, segments: segments, outlets: outlets,
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
