// ── QNRR Quarter Config (global) — แก้แค่ที่นี่ทุก quarter ─────────────────
// Q2 2026: base=มี.ค., period=เม.ย.–มิ.ย.
// Q3 2026: base_month='2026-06', q_months=['2026-07','2026-08','2026-09'], etc.
var QNRR_CFG = {
  quarter:    '2026q3',
  base_month: '2026-06',
  q_months:   ['2026-07','2026-08','2026-09'],
  months_th:  {
    '2026-06':'มิ.ย.','2026-07':'ก.ค.',
    '2026-08':'ส.ค.', '2026-09':'ก.ย.'
  },
  csv_file:   'kam_rep_view.csv'
};
// ─────────────────────────────────────────────────────────────────────────────

// ── Role roster (v_adsplit, twin of src/nrr/nrr_data.js's copy) ──────────────
// latest_kam_email in kam_rep_view.csv tracks portfolio OWNERSHIP, not
// employment role — an AD/PM person can still hold outlets there. This roster
// (profiles.role driven) lets _rowInScope below reclassify those rows OUT of
// KAM/TL-scoped %NRR. Both bundles populate the same window.nrrRoleRoster
// shape; empty sets = old behavior, so a failed fetch degrades gracefully.
// NOTE: this %NRR feeds real commission payouts via _qnrrComputeForCommission.
window.nrrRoleRoster = window.nrrRoleRoster || { loaded: false, nonKamSet: new Set(), adSet: new Set(), pmSet: new Set() };
async function _qnrrFetchRoleRoster() {
  if (window.nrrRoleRoster.loaded) return window.nrrRoleRoster;
  try {
    const { data, error } = await supa.from('profiles').select('email,role')
      .in('role', ['pm', 'admin', 'sales', 'sales_tl', 'ad', 'ad_tl']);
    if (error) throw new Error(error.message);
    const nonKam = new Set(), ad = new Set(), pm = new Set();
    (data || []).forEach(p => {
      if (!p || !p.email) return;
      const em = p.email.toLowerCase();
      nonKam.add(em);
      if (p.role === 'ad' || p.role === 'ad_tl') ad.add(em);
      // v_adperson: kept in lockstep with the /nrr twin's shape even though
      // Sense doesn't consume pmSet today — see nrr_data.js's copy.
      if (p.role === 'pm') pm.add(em);
    });
    window.nrrRoleRoster = { loaded: true, nonKamSet: nonKam, adSet: ad, pmSet: pm };
  } catch (e) {
    console.warn('[Sense qnrr] role roster fetch failed — KAM scoping falls back to email-only', e);
  }
  return window.nrrRoleRoster;
}
window._qnrrFetchRoleRoster = _qnrrFetchRoleRoster;

// ══════════════════════════════════════════════════════════════════════════════
// _qnrrCompute — Quarter NRR Health compute (v776 — adjusted base for core transfer_out)
//
// KEY CHANGE v776:
//   transfer_out outlets ที่อยู่ใน core cohort (baseMap) จะถูกหักออกจาก base_norm
//   แบบ retroactive — ไม่ว่า transfer จะเกิดเดือนไหนใน Q ก็ตาม
//   → adjusted_base_norm ใช้คำนวณ NRR ทุกเดือน (Apr/May/Jun)
//   → base_norm_original เก็บไว้แสดง ghost bar บน Mar
//
//   Rule: เฉพาะ outlet ที่ (1) movement_type='transfer_out' ใน Q และ
//         (2) outlet_id อยู่ใน baseMap (core cohort Mar)
//   outlet ที่มาจาก transfer_in/handover/new_sales/comeback แล้ว transfer_out ใน Q
//   → ไม่หักฐาน (ไม่อยู่ใน baseMap)
// ══════════════════════════════════════════════════════════════════════════════
function _qnrrCompute(kamEmail, scope) {
  scope = scope || 'kam';
  // v850-fix: kamEmail is genuinely optional for 'tl'/'admin' org-wide scope -- allRows
  // selection and _rowInScope() below both already branch away from kamEmail for those
  // scopes (admin: allRows=qd.allRows, _rowInScope=true unconditionally; tl-with-no-
  // myTlEmail: same org-wide fallback). Only 'kam' scope actually needs a real email
  // (used to filter r.latest_kam_email === kamEmail). The old unconditional guard here
  // silently returned null every time the Admin "ทีม" org-wide toggle called this with
  // kamEmail=null, scope='admin' -- portview bar (_nrrBarSource(null,null) for _showAll)
  // then fell back to the legacy MoM calc while the QNRR panel (which happens to pass
  // the viewer's own email even in admin scope) computed correctly. That's the source
  // of the 107% (portview, wrong) vs 105% (QNRR panel, correct) mismatch Bucci found
  // live on the Admin org-wide view (2026-07-07).
  if (scope === 'kam' && !kamEmail) return null;
  var qd = window.bulkQnrrData;
  if (!qd || !qd.loaded) return null;

  var myTlEmail = '';
  var kamRows = (qd.byKamEmail && qd.byKamEmail[kamEmail]) || [];
  if (kamRows.length) {
    myTlEmail = (kamRows.find(function(r){return r.latest_tl_email;}) || {}).latest_tl_email || ''; // v827-fix
  }
  // v817: TL/Admin login ตรงๆ — email ของตัวเองอาจอยู่ใน byTlEmail โดยตรง
  if (!myTlEmail && qd.byTlEmail && qd.byTlEmail[kamEmail]) {
    myTlEmail = kamEmail;
  }

  var allRows;
  if (scope === 'tl' && myTlEmail && qd.byTlEmail && qd.byTlEmail[myTlEmail]) {
    allRows = qd.byTlEmail[myTlEmail];
  } else if (scope === 'tl' && !myTlEmail) {
    // Admin ดู tl scope แต่ไม่มี myTlEmail → ใช้ allRows (portfolio ทั้งองค์กร)
    allRows = qd.allRows || [];
  } else if (scope === 'admin' || scope === 'ad') {
    allRows = qd.allRows || [];
  } else {
    allRows = kamRows;
  }
  if (!allRows || !allRows.length) return null;

  // v_adsplit (2026-07-22, mirrored in src/nrr/nrr_logic.js in the same
  // commit): 'tl'/'admin' scopes exclude rows owned by someone whose real
  // profiles.role is not KAM (window.nrrRoleRoster.nonKamSet); new 'ad'
  // scope selects exactly the ad/ad_tl people's rows. scope 'kam' untouched
  // (self-view). Empty roster = old behavior. This CHANGES the TL %NRR that
  // feeds commission for teams carrying a non-KAM portfolio holder —
  // intended (an AD's book must not inflate a KAM team's number).
  var _roster = window.nrrRoleRoster || { nonKamSet: new Set(), adSet: new Set() };
  var _nonKam = _roster.nonKamSet || new Set();
  var _adSet = _roster.adSet || new Set();
  function _isNonKamOwner(r) {
    return _nonKam.has((r.latest_kam_email || '').toLowerCase());
  }
  function _rowInScope(r) {
    if (scope === 'kam')   return r.latest_kam_email === kamEmail; // v827-fix
    if (scope === 'tl')    return (myTlEmail ? r.latest_tl_email === myTlEmail : true) && !_isNonKamOwner(r);
    if (scope === 'admin') return !_isNonKamOwner(r);
    if (scope === 'ad')    return _adSet.has((r.latest_kam_email || '').toLowerCase());
    return r.latest_kam_email === kamEmail;
  }

  function _effectiveMovement(r) {
    // v830-fix: raw CSV never contains movement_type='core_nrr_churn' as a literal value
    // (confirmed against actual rep_view export) -- the UI's Churn sub-row expects this
    // category but nothing ever produced it, so Churn always rendered as "--" regardless
    // of real data. Reclassify here: a core_nrr row with curr_gmv=0 IS a churned outlet
    // (was in the retained cohort, dropped to zero this period) -- matches the same
    // curr_gmv===0 split logic validated against real rep_kam export data.
    if (r.movement_type === 'core_nrr' && (parseFloat(r.curr_gmv) || 0) === 0) {
      return 'core_nrr_churn';
    }
    if (scope === 'kam') return r.movement_type;
    // v6-fix: "org-wide, no portfolio boundary" applies in TWO cases, not just
    // scope==='admin' -- when Admin views the "ทีม" (Team) dropdown without being
    // personally a TL of any squad, the code path taken is scope==='tl' with
    // myTlEmail==='' (see allRows selection above), which resolves to the exact same
    // all-rows, no-boundary view as scope==='admin'. Missing this second path was
    // why the reported bug reproduced from the "ทีม" toggle specifically.
    var isOrgWideView = (scope === 'admin') || (scope === 'ad') || (scope === 'tl' && !myTlEmail); // v_adsplit: 'ad' is boundary-less too
    if (isOrgWideView) {
      // At this scope there is no portfolio boundary between individual KAMs -- if
      // an outlet just moves from one KAM to another (both sides still 'KAM'
      // portfolio type), the org never lost it, so it should read as core_nrr here
      // regardless of squad. Moves involving PM/ADMIN/SALE are a genuine portfolio-
      // TYPE change, not just a KAM reassignment, so those stay visible as transfer
      // -- more meaningful signal at VP level. (Flagged separately: whether
      // PM/ADMIN/SALE-involving transfers should ALSO be neutralized at this scope
      // is a business call, not addressed here -- this fix only covers the reported
      // KAM<->KAM case.)
      // v6-fix3: strengthened the check with a second signal. Per the rep_view SQL
      // design, transfer_scope is only tagged 'inter' (PM/ADMIN involved) or
      // 'external' (SALE involved) when the move crosses a real portfolio-TYPE
      // boundary -- for a pure KAM<->KAM reassignment it's blank/falsy. Checking
      // BOTH signals (portfolio fields AND transfer_scope) hedges against either one
      // alone being an incomplete signal for this specific row shape.
      var isPureKamMove = (r.base_portfolio === 'KAM' && r.current_portfolio === 'KAM') || !r.transfer_scope;
      if (isPureKamMove && r.movement_type === 'transfer_out') return null;
      if (isPureKamMove && r.movement_type === 'transfer_in')  return 'core_nrr';
      return r.movement_type;
    }
    // v814: ใช้ base_tl_email แทน base_kam_email ในการ detect same-squad transfer
    // transfer_in/out ระหว่าง KAM ใน squad เดียวกัน → ไม่นับ (neutralize)
    // transfer_in/out ข้ามsquad หรือมาจาก non-KAM (PM/AD/Admin) → นับตามปกติ
    var sameTlBase   = r.base_tl_email && r.base_tl_email === myTlEmail;
    var sameTlPeriod = r.latest_tl_email === myTlEmail; // v827-fix
    // v6-fix2: same bug class as the v840 admin-scope fix, different code path.
    // base_tl_email/latest_tl_email are org-chart TL attribution, set independently
    // of portfolio TYPE -- an outlet moving from ADMIN bucket to a KAM on this exact
    // squad can have base_tl_email===latest_tl_email===myTlEmail even though nothing
    // was previously KAM-managed here at all. That's a genuine new-coverage gain for
    // this squad, not an internal KAM<->KAM reshuffle, so it must NOT be neutralized.
    // Require both sides to already be 'KAM' portfolio type before treating it as
    // same-squad noise.
    var isPureKamMove = (r.base_portfolio === 'KAM' && r.current_portfolio === 'KAM') || !r.transfer_scope;
    var sameTeam     = sameTlBase && sameTlPeriod && isPureKamMove;
    if (sameTeam && r.movement_type === 'transfer_out') return null;
    if (sameTeam && r.movement_type === 'transfer_in')  return 'core_nrr';
    return r.movement_type;
  }

  var scopedRows = allRows.filter(_rowInScope);
  if (!scopedRows.length) return null;

  var base_month  = scopedRows[0].base_month || QNRR_CFG.base_month;
  var months      = [];
  var monthSet    = {};
  scopedRows.forEach(function(r){
    if (!monthSet[r.period_month]){ monthSet[r.period_month]=1; months.push(r.period_month); }
  });
  months.sort();

  // ── Build baseMap from first period month rows ──────────────────────────────
  var baseMap = {};
  var baseMonthRows = scopedRows.filter(function(r){ return r.period_month === months[0]; });
  baseMonthRows.forEach(function(r){
    // exclude handover outlets — KAM ไม่ได้ดูแลจริงๆ ใน base month
    // v852: exclude transfer_in ด้วย — base_gmv ของแถว transfer_in คือฐานภายใต้
    // เจ้าของเดิม (PM/ADMIN/KAM อื่น) และถูกบวกเข้า base_norm ครั้งเดียวอยู่แล้ว
    // โดย symmetric transfer_in adjustment ด้านล่าง ถ้า transfer เกิดในเดือนแรก
    // ของไตรมาส แถวนั้นจะอยู่ใน baseMonthRows พอดีและเคยหลุดเข้า baseMap
    // → ฐานถูกนับซ้ำ 2 ครั้ง (เจอจริง ก.ค. 2026: PM→KAM 44 ร้าน ฐาน ฿2.34M
    // นับซ้ำทั้ง org, Tape โชว์ 92% แทนที่จะเป็น 99%) ตรงกับ invariant v776
    // ในหัวไฟล์ที่ระบุว่าร้าน transfer_in "ไม่อยู่ใน baseMap" อยู่แล้ว
    // ใช้ _effectiveMovement (ไม่ใช่ raw movement_type) เพื่อให้การย้าย KAM↔KAM
    // ทีมเดียวกันที่ tl/admin scope (ซึ่ง reclassify เป็น core_nrr) ยังอยู่ใน
    // baseMap ถูกต้อง — ร้านนั้นเป็นของ scope นั้นตั้งแต่เดือนฐานจริงๆ
    if (r.base_gmv > 0 && !baseMap[r.outlet_id] && r.movement_type !== 'handover'
        && _effectiveMovement(r) !== 'transfer_in') {
      baseMap[r.outlet_id] = { gmv: r.base_gmv, days: r.base_days || 31, account_id: r.account_id };
    }
  });

  // ── Compute original base (before transfer_out adjustment) ──────────────────
  var base_gmv_original = 0;
  var base_norm_original = 0;
  Object.keys(baseMap).forEach(function(oid){
    var b = baseMap[oid];
    base_gmv_original  += b.gmv;
    base_norm_original += b.gmv / b.days;
  });

  // ── Find all core-cohort transfer_out outlets across entire Q ───────────────
  // Rule: movement_type='transfer_out' ในเดือนไหนก็ได้ใน Q
  //       AND outlet_id อยู่ใน baseMap (core cohort)
  var coreTransferOutSet = {}; // outlet_id → {gmv_norm, account_name, period_month}
  // gmv_norm ใช้ unit เดียวกับ base_norm_original = gmv / days (ไม่ × 30)
  // เพื่อให้ base_norm = base_norm_original − transfer_out_base_norm หักได้ถูก
  scopedRows.forEach(function(r){
    var mv = _effectiveMovement(r);
    if (mv === 'transfer_out' && baseMap[r.outlet_id] && !coreTransferOutSet[r.outlet_id]) {
      var b = baseMap[r.outlet_id];
      coreTransferOutSet[r.outlet_id] = {
        gmv_norm:     b.gmv / b.days,   // unit: GMV/day (same as base_norm_original)
        account_name: r.account_name || '',
        period_month: r.period_month
      };
    }
  });

  // ── Adjusted base = original base − core transfer_out ──────────────────────
  var transfer_out_base_norm = 0;
  var transfer_out_base_gmv  = 0;
  var transfer_out_outlets   = [];
  Object.keys(coreTransferOutSet).forEach(function(oid){
    var t = coreTransferOutSet[oid];
    transfer_out_base_norm += t.gmv_norm;
    transfer_out_base_gmv  += baseMap[oid].gmv;
    transfer_out_outlets.push({ outlet_id: oid, gmv_norm: t.gmv_norm,
      account_name: t.account_name, period_month: t.period_month });
  });

  // ── Find all transfer_in outlets across entire Q (symmetric with transfer_out) ──
  // v6-fix4: per Bucci decision 2026-07-06 — transfer_in must count toward NRR the
  // same way transfer_out does. Before this: an outlet transferring OUT got its base
  // GMV removed from the denominator (fair — not the portfolio's fault), but an
  // outlet transferring IN was never added to either side of the ratio at all — it
  // only showed in the separate "Transfer in" display bucket and in Total GMV. That
  // meant a portfolio receiving a large transferred-in account got zero accountability
  // for it for the rest of the quarter: its performance never touched core NRR%,
  // which is what drives commission/pace tracking. This mirrors transfer_out exactly
  // (same quarter-level, non-month-specific treatment) rather than introducing a new
  // inconsistency.
  var coreTransferInSet = {}; // outlet_id → {gmv, gmv_norm, account_name, period_month}
  scopedRows.forEach(function(r){
    var mv = _effectiveMovement(r);
    if (mv === 'transfer_in' && !coreTransferInSet[r.outlet_id]) {
      var b_gmv  = parseFloat(r.base_gmv) || 0;
      var b_days = parseFloat(r.base_days) || 31;
      coreTransferInSet[r.outlet_id] = {
        gmv:          b_gmv,
        gmv_norm:     b_gmv / b_days,   // unit: GMV/day (same as base_norm_original)
        account_name: r.account_name || '',
        period_month: r.period_month
      };
    }
  });
  var transfer_in_base_norm = 0;
  var transfer_in_base_gmv  = 0;
  var transfer_in_outlets   = [];
  Object.keys(coreTransferInSet).forEach(function(oid){
    var t = coreTransferInSet[oid];
    transfer_in_base_norm += t.gmv_norm;
    transfer_in_base_gmv  += t.gmv;
    transfer_in_outlets.push({ outlet_id: oid, gmv_norm: t.gmv_norm,
      account_name: t.account_name, period_month: t.period_month });
  });

  var base_norm = base_norm_original - transfer_out_base_norm + transfer_in_base_norm;
  var base_gmv  = base_gmv_original  - transfer_out_base_gmv  + transfer_in_base_gmv;
  var cohort_outlets = Object.keys(baseMap).length; // แสดง original cohort count

  // handover base: Mar GMV ของ handover outlets (แสดงใน Mar bar แต่ไม่นับใน NRR denom)
  var handover_base_norm = 0;
  baseMonthRows.forEach(function(r){
    if (r.movement_type === 'handover' && r.base_gmv > 0) {
      var base_d = parseFloat(r.base_days) || 31;
      handover_base_norm += (parseFloat(r.base_gmv) || 0) / base_d * 30;
    }
  });

  var MOVEMENTS = ['core_nrr','core_nrr_churn','handover','new_sales',
                   'expansion','comeback','transfer_in','transfer_out'];

  var by_month = {};
  months.forEach(function(month){
    var monthRows = scopedRows.filter(function(r){ return r.period_month === month; });
    var segments  = {};
    var outlets   = {};
    MOVEMENTS.forEach(function(m){ segments[m] = 0; outlets[m] = 0; });

    var seenOutlets = {};
    var nrr_curr_norm = 0;
    var core_nrr_base_sum = 0;

    monthRows.forEach(function(r){
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

      // Waived accounts (nrr_exclusions, approved for this exact period_month)
      // still count toward GMV/segments/outlets above -- only excluded from the
      // NRR numerator (here) and denominator (base_norm, see effectiveBaseNorm
      // below) since GMV/other performance metrics must stay unaffected.
      var waived = typeof _nrrAccountWaivedForPeriod === 'function' &&
        _nrrAccountWaivedForPeriod(r.account_id, month, r.outlet_id);

      if (!waived && (mv === 'core_nrr' || mv === 'core_nrr_churn' || mv === 'transfer_in') && r.base_gmv > 0) {
        if (!seenOutlets[r.outlet_id]) {
          seenOutlets[r.outlet_id] = true;
          var curr_days = r.curr_days || 30;
          nrr_curr_norm += curr_days > 0 ? r.curr_gmv / curr_days : 0;
        }
      }

      // v848: comeback GMV now counts toward the NRR numerator (Bucci decision 2026-07-07).
      // Comeback outlets have base_gmv=0 by definition (they churned before the base month),
      // so they were never in baseMap and never touch the denominator -- no base_gmv>0 gate
      // needed/possible here. This is intentionally ASYMMETRIC with transfer_in (which adds
      // to both numerator AND denominator, v845): comeback is pure upside added only to the
      // numerator against an unchanged base. Example: base 10M (core 10M + comeback 0M since
      // inactive in base month) -> Sep core 9.5M + comeback 0.5M -> numerator 9.5+0.5=10M ->
      // NRR = 10M/10M = 100%.
      if (!waived && mv === 'comeback') {
        if (!seenOutlets[r.outlet_id]) {
          seenOutlets[r.outlet_id] = true;
          var curr_days_cb = r.curr_days || 30;
          nrr_curr_norm += curr_days_cb > 0 ? r.curr_gmv / curr_days_cb : 0;
        }
      }
    });

    // Waived-account (nrr_exclusions) base contribution is removed per-month --
    // unlike transfer_out/in (quarter-wide, computed once into base_norm above),
    // a waiver applies to one specific month only, so it must be recomputed here.
    var effectiveBaseNorm = base_norm;
    if (typeof _nrrAccountWaivedForPeriod === 'function') {
      Object.keys(baseMap).forEach(function(oid){
        var b = baseMap[oid];
        if (b.account_id && _nrrAccountWaivedForPeriod(b.account_id, month, oid)) {
          effectiveBaseNorm -= (b.gmv / b.days);
        }
      });
    }

    // NRR คำนวณจาก adjusted base_norm (หัก core transfer_out แล้ว retroactive,
    // และหัก waived-account base ของเดือนนี้)
    // v92-fix: NO rounding — this flows into _qnrrComputeForCommission's
    // `nrr` ratio (line ~493 below), which the commission engine's tier/gate
    // threshold comparisons ultimately use. Rounding here before that
    // decision was the quarterly-mode half of a real payout-rounding bug
    // (see 07a_commission_engine.js's _nrrGovernedPct comment). Round only
    // for display, via _commFmtPct(), never before a threshold decision.
    var nrr_pct = effectiveBaseNorm > 0
      ? (nrr_curr_norm / effectiveBaseNorm * 100)
      : null;

    var total_gmv = MOVEMENTS
      .filter(function(m){ return m !== 'transfer_out' && m !== 'core_nrr_churn'; })
      .reduce(function(s,m){ return s + (segments[m] || 0); }, 0);

    var curr_days_sample = monthRows.find(function(r){return r.curr_days>0;});
    var curr_days = curr_days_sample ? curr_days_sample.curr_days : 30;

    var contraction = (segments.core_nrr || 0) - core_nrr_base_sum;

    var monthParts  = month.split('-');
    var daysInMonth = new Date(parseInt(monthParts[0]), parseInt(monthParts[1]), 0).getDate();
    var isPartial   = curr_days > 0 && curr_days < daysInMonth - 2;

    by_month[month] = {
      nrr_pct:        nrr_pct,
      effective_base_norm: effectiveBaseNorm, // v865: per-month base after waived-account subtraction (base_norm itself is quarter-wide)
      total_gmv:      total_gmv,
      segments:       segments,
      outlets:        outlets,
      rows:           monthRows,
      curr_days:      curr_days,
      days_in_month:  daysInMonth,
      is_partial:     isPartial,
      core_nrr_base:  core_nrr_base_sum,
      contraction:    contraction
    };
  });

  return {
    quarter:                window._QNRR_QUARTER || QNRR_CFG.quarter,
    base_month:             base_month,
    months:                 months,
    base_gmv:               base_gmv,
    base_norm:              base_norm,
    base_norm_original:     base_norm_original,      // v776: ฐานก่อนหัก transfer_out
    transfer_out_base_norm: transfer_out_base_norm,  // v776: จำนวนที่ถูกหัก
    transfer_out_outlets:   transfer_out_outlets,    // v776: รายการ outlet ที่ถูกหัก
    transfer_in_base_norm:  transfer_in_base_norm,   // v6-fix4: จำนวนที่ถูกบวกเข้า (สมมาตรกับ transfer_out)
    transfer_in_outlets:    transfer_in_outlets,     // v6-fix4: รายการ outlet ที่ถูกบวกเข้า
    handover_base_norm:     handover_base_norm,
    cohort_outlets:         cohort_outlets,
    by_month:               by_month
  };
}
window._qnrrCompute = _qnrrCompute;

// ── _qnrrEnsureLoaded — self-heal for IDB-FAST path skipping qnrr (v849-fix) ────
// Root cause (found 2026-07-07, Bucci): _preloadFromIndexedDB() (02_data_pipeline.js)
// has no fallback fetch for the 'qnrr' tab specifically when it's missing/expired in
// IndexedDB. The IDB-FAST boot path only requires the 3 CRITICAL tabs (portview/
// history/handover) to activate -- it can fire successfully while 'qnrr' silently
// stays unloaded forever, because _prefetchQnrrIfNeeded() only lives inside the full
// loadFromCloudflareR2() flow, which IDB-FAST skips entirely. Symptom observed live:
// portview bar and commission cockpit silently fell back to stale/wrong numbers
// (legacy MoM calc, or a confident-looking ฿0) with zero visible error, and no
// browser reload fixed it because the same IDB-FAST race reproduced identically
// every time. Same bug CLASS as the v231-fix already applied for upsell_team
// (06_portview_teamview.js:2330) -- this is the same fix pattern applied to qnrr.
// Called from _qnrrComputeForCommission() below so every consumer (portview bar,
// commission strip/cockpit, team governance card) self-heals from one place.
function _qnrrEnsureLoaded() {
  if (window.bulkQnrrData && window.bulkQnrrData.loaded) return;
  if (window._qnrrSelfHealInFlight) return;
  if (typeof window._fetchQnrrBundle !== 'function') return;
  window._qnrrSelfHealInFlight = true;
  window._fetchQnrrBundle().finally(function () {
    window._qnrrSelfHealInFlight = false;
    if (!window.bulkQnrrData || !window.bulkQnrrData.loaded) return; // genuinely failed -- existing 15s force-release in _fetchQnrrBundle still applies, leave as-is
    // Broad re-render so every consumer picks up the freshly-loaded data without
    // requiring a manual page reload.
    try {
      var _bar = document.getElementById('tgt-portview-bar');
      if (_bar) _bar._lastRenderMs = 0; // bypass anti-flicker debounce for this authoritative repaint
      if (typeof renderPortviewTargetBar === 'function') renderPortviewTargetBar();
    } catch (e) {}
    try { if (typeof window._commRenderKamSelfStrip === 'function') window._commRenderKamSelfStrip(); } catch (e) {}
    try { if (typeof window._commGatedRender === 'function') window._commGatedRender(); } catch (e) {}
    try { if (typeof _qnrrRender === 'function') _qnrrRender(); } catch (e) {}
    try {
      if (document.getElementById('scr-teamview')?.classList.contains('on') && typeof renderTeamviewKamList === 'function') {
        renderTeamviewKamList();
      }
    } catch (e) {}
  });
}
window._qnrrEnsureLoaded = _qnrrEnsureLoaded;

// ── _qnrrComputeForCommission (Q3 quarterly mode) ───────────────────────────────
// Wraps _qnrrCompute() and reshapes output for _commBuildKamPayout / _commBuildTlPayout.
// Source of truth: bulkQnrrData (kam_rep_view.csv) — same as QNRR sheet.
// Guarantees NRR% in commission = NRR% in QNRR sheet (T3).
//
// scope: 'kam' | 'tl' | 'admin'
// currentPeriod: '2026-07' | '2026-08' | '2026-09' (lag-1 YYYY-MM)
function _qnrrComputeForCommission(kamEmail, scope, asOfPeriod) {
  try {
    // v849-fix: kick the self-heal check on every call -- cheap no-op once loaded
    // or already in flight, but guarantees a fetch eventually fires even if the
    // IDB-FAST boot path skipped it (see _qnrrEnsureLoaded comment above).
    _qnrrEnsureLoaded();

    var validQ = QNRR_CFG.q_months;  // ['2026-07','2026-08','2026-09']
    var currentPeriod;
    if (asOfPeriod && validQ.includes(asOfPeriod)) {
      // v829: explicit period requested (Retroactive Lock / auto-compute-at-month-start) —
      // use it directly instead of "today". bulkQnrrData already has rows for all 3 quarter
      // months at once, so no extra fetch is needed — just pick a different by_month key.
      currentPeriod = asOfPeriod;
    } else {
      // Determine current billing period from lag-1 date (Day-1 lag, same as MoM engine)
      var now    = new Date();
      var lag1   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      var lagYM  = lag1.getFullYear() + '-' + String(lag1.getMonth() + 1).padStart(2, '0');
      // Clamp to Q3 months — if lagged date is outside Q3, use last available Q3 month
      currentPeriod = validQ.includes(lagYM) ? lagYM : validQ[validQ.length - 1];
    }

    // Delegate to existing _qnrrCompute — no logic duplication
    var result = _qnrrCompute(kamEmail, scope || 'kam');
    if (!result || !result.by_month) {
      console.warn('[QnrrComm] _qnrrCompute returned null for', kamEmail, scope);
      return null;
    }

    var monthData = result.by_month[currentPeriod];
    if (!monthData) {
      // Period data not yet available (e.g. Sep not started) — use latest available
      var availableMonths = validQ.filter(function(m) { return !!result.by_month[m]; });
      if (!availableMonths.length) {
        console.warn('[QnrrComm] no period data for', kamEmail, currentPeriod);
        return null;
      }
      currentPeriod = availableMonths[availableMonths.length - 1];
      monthData = result.by_month[currentPeriod];
    }

    var segs    = monthData.segments || {};
    var outlets = monthData.outlets  || {};

    // effective_base_norm × 30 = normalized base GMV for this month (Jun @ 30 days,
    // locked for Q3), already net of any waived account's base for this specific
    // month — falls back to the quarter-wide base_norm for older by_month entries
    // that predate this field.
    var baseGmv = Math.round((monthData.effective_base_norm != null ? monthData.effective_base_norm : result.base_norm || 0) * 30);

    // Thai month label for base_month (มิ.ย. 2569) — shown in history detail
    var baseMo  = QNRR_CFG.base_month;  // '2026-06'
    var baseParts = baseMo.split('-');
    var _THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    var baseMoLabel = _THAI_MONTHS[parseInt(baseParts[1], 10) - 1] + ' ' + (parseInt(baseParts[0], 10) + 543);

    console.log('%c[QnrrComm] compute','color:#60a5fa',
      {kamEmail, scope, currentPeriod, nrr_pct: monthData.nrr_pct, baseGmv,
       core: segs.core_nrr, expansion: segs.expansion, comeback: segs.comeback});

    return {
      // NRR fields matching _tgtComputeKamNRR() output shape (used by _commBuildKamPayout)
      nrr:              (monthData.nrr_pct || 0) / 100,
      baselinePrevGmv:  baseGmv,
      cohortGmv:        segs.core_nrr   || 0,
      expansionGmv:     segs.expansion  || 0,
      comebackGmv:      segs.comeback   || 0,
      cohortCount:      outlets.core_nrr || 0,
      // v860-fix: monthData already computes these correctly (line ~319-335
      // above) but this return object never forwarded them — 07b_cds.js's
      // RUN RATE column/totals silently fell back to two DIFFERENT (and
      // wrong) constants when they came through as undefined, producing
      // "RUN RATE == MTD" per row and a ~30x-inflated totals-bar number.
      // Forwarding the real values here fixes both call sites at once.
      daysElapsed:      monthData.curr_days,
      daysInMonth:      monthData.days_in_month,
      // Quarterly metadata — stored in breakdown snapshot
      prevMonth:        baseMoLabel,           // 'มิ.ย. 2569' — fixed label for Q3
      base_month:       baseMo,                // '2026-06'
      quarter_id:       QNRR_CFG.quarter,      // '2026q3'
      commission_mode:  'quarterly',
      // Source info
      currentPeriod:    currentPeriod,
      by_month:         result.by_month
    };
  } catch (e) {
    console.warn('[QnrrComm] _qnrrComputeForCommission error', e);
    return null;
  }
}
window._qnrrComputeForCommission = _qnrrComputeForCommission;


// ════════════════════════════════════════════════════════════════════════════
// Freshket Sense — Quarter NRR Health Sheet (v775)
// src/07c_qnrr_view.js
// Redesign: semantic color palette, hero NRR zone, toggle chart/breakdown,
// transfer_out callout card, outlet count shows active+churn only
// ════════════════════════════════════════════════════════════════════════════

(function(){
'use strict';

// v6-fix: removed duplicate QNRR_CFG declaration that used to be here (was byte-for-byte
// identical to the one at the top of this file) -- having two copies meant a future
// session could update one when adding a new quarter's months_th entry and forget the
// other, silently going out of sync. QNRR_CFG is already declared once, above.
var MONTHS_TH = QNRR_CFG.months_th;
var Q_MONTHS  = QNRR_CFG.q_months;
var BASE_MONTH= QNRR_CFG.base_month;

var SCOPES    = ['KAM'];
var SCOPE_MAP = ['kam'];

// ── v775 semantic color palette ────────────────────────────────────────────
var MV_CFG = {
  core_nrr:       {label:'Core NRR',    color:'rgba(74,222,128,.86)',   order:0},
  handover:       {label:'Handover',    color:'rgba(96,165,250,.80)',   order:1},
  new_sales:      {label:'New Sales',   color:'rgba(167,139,250,.72)', order:2},
  expansion:      {label:'Expansion',   color:'rgba(52,211,153,.72)',   order:3},
  transfer_in:    {label:'Transfer in', color:'rgba(64,200,216,.62)',  order:4},
  comeback:       {label:'Comeback',    color:'rgba(251,191,36,.72)',   order:5},
  core_nrr_churn: {label:'Churn',       color:'rgba(248,113,113,.84)', order:6},
  transfer_out:   {label:'Transfer out',color:'ghost',                 order:7}
};
var STACK_ORDER  = ['core_nrr','handover','new_sales','expansion','comeback','transfer_in'];
var LEGEND_ORDER = ['core_nrr','handover','expansion','comeback','transfer_in','core_nrr_churn','transfer_out'];
var BK_ORDER     = ['core_nrr','handover','expansion','comeback','transfer_in','core_nrr_churn','transfer_out'];
// new_sales ถูก merge เข้า handover cohort block — ไม่ render แยก

var _scopeIdx = 0;
var _selBar   = null; // ไม่ highlight bar ไหนจนกว่า user จะ tap
var _selMv    = 'all';
var _viewMode = 'chart'; // 'chart' | 'break'
var _data     = null;
var _swipeY0  = null;

function _fmtM(n){
  var neg = n < 0; n = Math.abs(Math.round(n || 0));
  var s;
  if (n >= 1000000) s = '฿' + (n/1000000).toFixed(1) + 'M';
  else if (n >= 1000) s = '฿' + (n/1000).toFixed(0) + 'K';
  else s = '฿' + n;
  return neg ? '-' + s : s;
}
function _el(id){ return document.getElementById(id); }
function _esc(s){ return String(s||'').replace(/[&<>'"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];}); }
function _nrrColor(pct){
  if (pct === null || pct === undefined) return 'rgba(255,255,255,.25)';
  if (pct >= 100) return '#4ADE80';
  if (pct >= 90)  return '#FBBF24';
  return '#F87171';
}

// ── Open / Close ───────────────────────────────────────────────────────────
function _qnrrOpen(){
  var overlay = _el('qnrr-overlay');
  var sheet   = _el('qnrr-sheet');
  if (!overlay || !sheet) return;

  var role = (typeof getCurrentRole === 'function') ? getCurrentRole() : '';
  if (role === 'sales' || role === 'sales_tl') return;

  if (role === 'tl' || role === 'ad_tl') {
    SCOPES = ['ทีม','KAM']; SCOPE_MAP = ['tl','kam'];
  } else if (role === 'admin' || role === 'ad') {
    SCOPES = ['ทีม','KAM','Admin']; SCOPE_MAP = ['tl','kam','admin'];
  } else {
    SCOPES = ['KAM']; SCOPE_MAP = ['kam'];
  }
  _scopeIdx = 0;
  var scopeBtn = _el('qnrr-scope-btn');
  var scopeLbl = _el('qnrr-scope-lbl');
  if (scopeBtn) scopeBtn.style.display = SCOPES.length > 1 ? 'flex' : 'none';
  if (scopeLbl) scopeLbl.textContent = SCOPES[0];

  overlay.classList.add('on');
  sheet.classList.add('on');
  document.body.style.overflow = 'hidden';
  _qnrrInitSwipe(sheet);
  // v810: sync toolbar to default chart view on every open
  _allExpanded = true;
  _qnrrSyncToolbar('chart');

  var qd = window.bulkQnrrData;
  if (qd && qd.loaded) {
    _qnrrRender();
  } else {
    _qnrrShowSkeleton();
    if (typeof _fetchQnrrBundle === 'function') {
      _fetchQnrrBundle()
        .then(function(){ _qnrrRender(); })
        .catch(function(){ _qnrrShowError(); });
    } else {
      _qnrrShowError();
    }
  }
}
window._qnrrOpen = _qnrrOpen;

function _qnrrClose(){
  var overlay = _el('qnrr-overlay');
  var sheet   = _el('qnrr-sheet');
  if (!overlay || !sheet) return;
  overlay.classList.remove('on');
  sheet.classList.remove('on');
  document.body.style.overflow = '';
}
window._qnrrClose = _qnrrClose;

function _qnrrInitSwipe(sheet){
  var handle = _el('qnrr-handle');
  if (!handle || handle._swipeInit) return;
  handle._swipeInit = true;
  handle.addEventListener('touchstart', function(e){ _swipeY0 = e.touches[0].clientY; }, {passive:true});
  handle.addEventListener('touchmove',  function(e){
    if (_swipeY0 === null) return;
    var dy = e.touches[0].clientY - _swipeY0;
    if (dy > 0) sheet.style.transform = 'translateX(-50%) translateY(' + dy + 'px)';
  }, {passive:true});
  handle.addEventListener('touchend', function(e){
    if (_swipeY0 === null) return;
    var dy = e.changedTouches[0].clientY - _swipeY0;
    sheet.style.transform = '';
    if (dy > 80) _qnrrClose();
    _swipeY0 = null;
  }, {passive:true});
}

function _qnrrCycleScope(){
  _scopeIdx = (_scopeIdx + 1) % SCOPES.length;
  var lbl = _el('qnrr-scope-lbl');
  if (lbl) lbl.textContent = SCOPES[_scopeIdx];
  _qnrrRender();
}
window._qnrrCycleScope = _qnrrCycleScope;

function _qnrrSetMv(mv, btn){
  _selMv = mv;
  document.querySelectorAll('.qnrr-mv-btn').forEach(function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  _qnrrRenderDrill();
}
window._qnrrSetMv = _qnrrSetMv;

function _qnrrSelBar(month){
  // toggle: tap same bar = deselect
  if (_selBar === month) {
    _selBar = null;
    document.querySelectorAll('.qnrr-bar-col').forEach(function(c){ c.classList.remove('active'); });
  } else {
    _selBar = month;
    document.querySelectorAll('.qnrr-bar-col').forEach(function(c){
      c.classList.toggle('active', c.dataset.month === month);
    });
  }
  _qnrrRenderToutCard();
}
window._qnrrSelBar = _qnrrSelBar;

function _qnrrToggleAcct(id, row){
  var wrap = _el('qnrr-ow-' + id);
  if (!wrap) return;
  var open = wrap.classList.toggle('open');
  if (row) row.classList.toggle('open', open);
}
window._qnrrToggleAcct = _qnrrToggleAcct;

function _qnrrSetView(mode, btn){
  _viewMode = mode;
  // v810: sync iOS segmented control + expand btn via toolbar helper
  _qnrrSyncToolbar(mode);

  var chartWrap = _el('qnrr-chart-bars-wrap');
  var bkWrap    = _el('qnrr-breakdown-wrap');
  var legend    = _el('qnrr-legend');
  var toutCard  = _el('qnrr-tout-card');
  var listWrap  = _el('qnrr-list-wrap');

  if (mode === 'chart') {
    if (chartWrap) chartWrap.style.display = 'block';
    if (bkWrap)    { bkWrap.classList.add('show'); _qnrrRenderBreakdown(); }
    if (legend)    legend.style.display = '';
    if (toutCard)  toutCard.style.display = '';
    if (listWrap)  listWrap.style.display = 'none';
  } else if (mode === 'list') {
    if (chartWrap) chartWrap.style.display = 'none';
    if (bkWrap)    bkWrap.classList.remove('show');
    if (legend)    legend.style.display = 'none';
    if (toutCard)  toutCard.style.display = 'none';
    if (listWrap)  { listWrap.style.display = 'block'; _qnrrRenderList(); }
  }
  _qnrrRenderToutCard();
}
window._qnrrSetView = _qnrrSetView;

function _qnrrSparkMove(e, wrap){
  var bars = wrap.querySelectorAll('.qnrr-sb');
  var rect = wrap.getBoundingClientRect();
  var x    = e.clientX - rect.left;
  var idx  = Math.min(Math.max(0, Math.floor(x / 10)), bars.length - 1);
  bars.forEach(function(b,i){ b.classList.toggle('hi', i === idx); });
  var bar = bars[idx]; var tt = wrap.querySelector('.qnrr-sp-tt');
  if (!tt || !bar) return;
  tt.querySelector('.qnrr-tt-mo').textContent = bar.dataset.m || '';
  tt.querySelector('.qnrr-tt-v').textContent  = bar.dataset.v || '';
}
function _qnrrSparkLeave(wrap){
  wrap.querySelectorAll('.qnrr-sb').forEach(function(b){ b.classList.remove('hi'); });
}
window._qnrrSparkMove  = _qnrrSparkMove;
window._qnrrSparkLeave = _qnrrSparkLeave;

// ── Skeleton ────────────────────────────────────────────────────────────────
function _qnrrShowSkeleton(){
  var barsRow = _el('qnrr-bars-row');
  var list    = _el('qnrr-acct-list');
  var baseVal = _el('qnrr-base-val');
  var nrrVals = _el('qnrr-nrr-vals');
  var dl      = _el('qnrr-drill-lbl');
  if (baseVal) baseVal.innerHTML = '<span class="qnrr-skel">฿—</span>';
  if (nrrVals) nrrVals.innerHTML = '<span class="qnrr-skel">—</span>';
  if (dl) dl.textContent = 'กำลังโหลด...';
  if (barsRow) {
    var skelH = [130,106,124,90];
    barsRow.innerHTML = skelH.map(function(h){
      return '<div class="qnrr-bar-col"><div class="qnrr-bar-top-wrap"></div>' +
             '<div class="qnrr-bar-chart-area"><div class="qnrr-skel-bar" style="height:' + h + 'px;position:absolute;bottom:0;left:0;right:0"></div></div>' +
             '<div class="qnrr-bar-lbl"><span class="qnrr-skel" style="width:22px;display:inline-block">&nbsp;</span></div></div>';
    }).join('');
  }
  if (list) {
    list.innerHTML = [1,2,3].map(function(){
      return '<div class="qnrr-acct-row" style="pointer-events:none">' +
        '<div class="qnrr-mv-dot qnrr-skel"></div>' +
        '<div class="qnrr-acct-left"><div class="qnrr-skel" style="height:12px;width:55%;border-radius:var(--r-xs)"></div></div>' +
        '<div class="qnrr-acct-right"><div class="qnrr-skel" style="width:40px;height:20px;border-radius:3px"></div></div>' +
      '</div>';
    }).join('');
  }
}

function _qnrrShowError(){
  var list    = _el('qnrr-acct-list');
  var barsRow = _el('qnrr-bars-row');
  var dl      = _el('qnrr-drill-lbl');
  if (dl) dl.textContent = 'โหลดไม่สำเร็จ';
  if (barsRow) barsRow.innerHTML = '<div style="text-align:center;padding:30px 0;color:rgba(255,255,255,.52);font-size:var(--text-sm)">ไม่พบไฟล์ข้อมูล Q<br><span style="font-size:var(--text-2xs);opacity:.6">' + QNRR_CFG.csv_file + ' ยังไม่ได้อัปโหลด</span></div>';
  if (list) list.innerHTML = '';
}

// ── Main render ─────────────────────────────────────────────────────────────
function _qnrrRender(){
  // v812: ถ้า admin/TL กำลัง drill-down ดูพอร์ต KAM รายคน ให้ใช้ email ของ KAM คนนั้นแทน
  var email = (typeof portviewRepEmail !== 'undefined' && portviewRepEmail)
    ? portviewRepEmail
    : ((currentUserProfile && currentUserProfile.email) || '');
  var scope = SCOPE_MAP[_scopeIdx] || 'kam';
  if (!window.bulkQnrrData || !window.bulkQnrrData.loaded) {
    _qnrrShowSkeleton();
    _qnrrEnsureLoaded(); // v849-fix: actively trigger fetch instead of passively waiting on skeleton
    return;
  }

  _data = null;
  try { _data = _qnrrCompute(email, scope); } catch(e) { console.warn('[qnrr]', e); }

  _qnrrRenderHero();
  _qnrrRenderChart();
  _qnrrRenderLegend();
  // breakdown always visible in chart mode (stacked below bar chart)
  var bkWrap = _el('qnrr-breakdown-wrap');
  if (_viewMode === 'chart') {
    if (bkWrap) bkWrap.classList.add('show');
    _qnrrRenderBreakdown();
  } else if (_viewMode === 'list') {
    _qnrrRenderList();
  }
  _qnrrRenderToutCard();
}

// ── Zone A: Hero ─────────────────────────────────────────────────────────────
function _qnrrRenderHero(){
  var baseVal = _el('qnrr-base-val');
  var baseSub = _el('qnrr-base-sub');
  var nrrVals = _el('qnrr-nrr-vals'); // new element: holds 3-slot NRR cluster

  if (!_data) {
    if (baseVal) baseVal.textContent = '—';
    if (baseSub) baseSub.textContent = '— outlets';
    if (nrrVals) nrrVals.innerHTML   = '<span style="color:rgba(255,255,255,.52)">กำลังโหลด</span>';
    return;
  }

  var DISPLAY_BASE = _data.base_norm > 0 ? Math.round(_data.base_norm * 30) : _data.base_gmv;
  if (baseVal) baseVal.textContent = _fmtM(DISPLAY_BASE);
  if (baseSub) baseSub.textContent = _data.cohort_outlets + ' outlets · core cohort · excl. handover · ÷days×30';

  // NRR cluster — 3 slots with separators, NO stats row duplication
  if (nrrVals) {
    var slots = [];
    Q_MONTHS.forEach(function(m, idx){
      var bm  = _data.by_month[m];
      var pct = bm ? bm.nrr_pct : null;
      var color = _nrrColor(pct);
      var label = _commFmtPct(pct);
      var isLast = (m === Q_MONTHS[Q_MONTHS.length - 1]);
      var moSuffix = (isLast && bm && bm.curr_days && bm.curr_days < 28) ? '~' : '';
      if (idx > 0) slots.push('<div class="qnrr-nrr-sep"></div>');
      slots.push(
        '<div class="qnrr-nrr-slot">' +
          '<div class="qnrr-nrr-pct" style="color:' + color + '">' + _esc(label) + '</div>' +
          '<div class="qnrr-nrr-mo">' + (MONTHS_TH[m] || m) + moSuffix + '</div>' +
        '</div>'
      );
    });
    nrrVals.innerHTML = slots.join('');
  }
}

// ── Zone B: Bar chart ────────────────────────────────────────────────────────
function _qnrrRenderChart(){
  var barsRow = _el('qnrr-bars-row');
  var refLines= _el('qnrr-ref-lines');
  if (!barsRow) return;

  if (!_data) {
    barsRow.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,.52);font-size:var(--text-sm);padding:36px 0">ไม่มีข้อมูล Q</div>';
    return;
  }

  // Mar bar total = original base (ก่อนหัก transfer_out) + handover
  // ใช้ base_norm_original เพื่อให้ bar height = ฐานเดิมทั้งหมด
  // ghost segment จะแสดงส่วน transfer_out ที่ถูกหัก (อยู่บนสุดของ bar)
  var baseNormOrig = _data.base_norm_original || _data.base_norm;
  var marBarTotal = Math.round((baseNormOrig + (_data.handover_base_norm / 30)) * 30);
  var allGmvs = [marBarTotal];
  // Pre-compute rawTotals for partial months so maxGmv covers both MTD and run-rate
  var rawTotals = {};
  Q_MONTHS.forEach(function(m){
    var bm = _data.by_month[m];
    if (!bm) return;
    if (bm.is_partial) {
      var raw = bm.rows ? bm.rows.reduce(function(s,r){ return s+(parseFloat(r.curr_gmv)||0); },0) : bm.total_gmv;
      rawTotals[m] = raw;
      allGmvs.push(bm.total_gmv); // run-rate (normalized) drives max height
      allGmvs.push(raw);          // also include raw so it fits within chart
    } else {
      allGmvs.push(bm.total_gmv);
    }
  });
  var maxGmv = Math.max.apply(null, allGmvs) || 1;
  // v6-uxfix: top-wrap grew 32->44px to fit an always-visible run-rate line (was tooltip-only,
  // invisible on mobile where title= doesn't work). chartH shrinks by the same 12px for EVERY
  // column uniformly -- must stay uniform across columns or bars stop being visually comparable
  // (a column with a shorter chart-area would render the same ฿ value as a taller bar than a
  // column with a taller chart-area, breaking the whole point of a bar chart).
  var chartH  = 142; // v6-uxfix4: was 112 -- bars-row grew 178->208px (+30) for more breathing room around tall ghost-bar projections, chartH raised by the same amount

  // ref-line removed — ฐาน แสดงใน hero zone แล้ว ไม่ต้องซ้ำ
  if (refLines) refLines.innerHTML = '';

  var allBars = [{month: BASE_MONTH, isBase: true}];
  Q_MONTHS.forEach(function(m){ allBars.push({month: m, isBase: false}); });

  var barsHtml = allBars.map(function(b){
    var m      = b.month;
    var isBase = b.isBase;
    var bm     = _data.by_month[m];
    // For partial months: barH = raw MTD (shorter), projH = run-rate (taller)
    // For full months: barH = normalized total_gmv
    var _gmvForHeight = (!isBase && bm && bm.is_partial && rawTotals[m])
      ? rawTotals[m]
      : (isBase ? marBarTotal : (bm ? bm.total_gmv : 0));
    var barH = Math.max(6, Math.round(_gmvForHeight / maxGmv * chartH));
    var isActive = (!isBase && m === _selBar);
    var isLast   = (m === Q_MONTHS[Q_MONTHS.length - 1]);

    // v6-uxfix: compute partial-month ghost/run-rate numbers ONCE here, shared by both
    // topHtml (always-visible run-rate line, added below) and bodyHtml (the ghost bar
    // element itself) -- previously this was computed twice in two different shapes,
    // which was exactly how the top label and the ghost bar could disagree.
    var isPartialMonth  = !isBase && bm && bm.is_partial && bm.curr_days > 0;
    var runRate      = isPartialMonth ? bm.total_gmv : 0; // normalized ÷curr_days×30
    var isLowConf    = isPartialMonth && bm.curr_days < 7; // <1 week of data — projection is noisy
    var projH        = isPartialMonth ? Math.max(6, Math.round(runRate / maxGmv * chartH)) : 0;
    var rawGapH      = isPartialMonth ? (projH - barH) : 0; // pixels above actual bar, uncapped
    // Cap so the ghost never overflows past the chart area's top edge (was getting silently
    // clipped by .qnrr-bar-chart-area's overflow:hidden with a hard edge -- looked like a
    // rendering bug, especially early in the month when a run-rate projected from very few
    // days of data can spike far above every other bar).
    var maxGapH      = Math.max(0, chartH - barH - 10); // v6-uxfix3: was 4px — measured live in browser: hardcoded chartH (112) vs actual rendered .qnrr-bar-chart-area height (109.5px) differ by 2.5px, eating most of the old 4px buffer down to 1.5px real headroom. Widened so small CSS drift like this can't reopen the crop.
    var isGhostClipped = isPartialMonth && rawGapH > maxGapH;
    var gapH         = isPartialMonth ? Math.min(rawGapH, maxGapH) : 0;

    // Top label: GMV only (NRR% removed — lives in hero zone now)
    var topHtml = '';
    if (isBase) {
      // v776: ถ้ามี core transfer_out → แสดงฐานที่ปรับแล้ว + indicator
      // v6-fix4: also trigger on transfer_in now that it adjusts base_norm too
      var hasTout = (_data.transfer_out_base_norm || 0) > 0 || (_data.transfer_in_base_norm || 0) > 0;
      var adjBase = Math.round(_data.base_norm * 30);
      var baseLabel = hasTout
        ? _fmtM(adjBase) + '<span class="qnrr-base-adj-tag">adj</span>'
        : _fmtM(marBarTotal);
      topHtml = '<div class="qnrr-bar-top-label">' + baseLabel + '</div>' +
                '<div class="qnrr-bar-mar-sub" style="color:rgba(var(--ink-blue),.70);font-weight:800">' + _data.cohort_outlets + ' สาขา</div>';
    } else if (bm) {
      var activeOut = (bm.outlets && bm.outlets.core_nrr) ? bm.outlets.core_nrr : '';
      var outLabel  = '';
      if (bm.is_partial) {
        // Partial month: show days on bar header, days info also in ghost bar tooltip
        var rawTotal = rawTotals[m] || bm.total_gmv;
        // v6-uxfix: run-rate number now always visible here (not tooltip-only — title=
        // does not show on tap for most mobile browsers, so it was effectively invisible
        // on mobile even before the overflow bug). Low-confidence (<7 days) gets a dimmer
        // treatment instead of extra text, to keep the line compact.
        var runrateLbl = '<div class="qnrr-bar-runrate-label' + (isLowConf ? ' low-conf' : '') + '">run-rate ≈' + _fmtM(runRate) + '</div>';
        topHtml =
          '<div class="qnrr-bar-top-label">' + _fmtM(rawTotal) +
            '<span class="qnrr-top-actual-tag"> mtd</span></div>' +
          runrateLbl +
          '<div class="qnrr-bar-mar-sub" style="color:rgba(var(--ink-blue),.55);font-weight:var(--fw-bold)">' +
            bm.curr_days + '/' + bm.days_in_month + 'd</div>';
        topHtml = '<!-- partial -->' + topHtml;
      } else {
        outLabel = activeOut ? '<div class="qnrr-bar-mar-sub" style="color:rgba(var(--ink-blue),.70);font-weight:800">' + activeOut + ' สาขา</div>' : '';
        topHtml = '<div class="qnrr-bar-top-label">' + _fmtM(bm.total_gmv) + '</div>' + outLabel;
      }
    }

    // Bar body segments
    var bodyHtml = '';
    if (isBase) {
      // Base bar: core segment (dashed bg) + handover segment (น้ำเงิน) อยู่บนสุด
      // v776: ถ้ามี transfer_out ที่ถูกหักออกจากฐาน → แสดง ghost segment บนสุด
      var toutNorm = _data.transfer_out_base_norm || 0;
      var toutOuts = (_data.transfer_out_outlets || []).length;

      // coreH คำนวณจาก adjusted base_norm (หัก transfer_out แล้ว)
      var coreH   = Math.max(4, Math.round(_data.base_norm * 30 / maxGmv * chartH));
      var hovNorm = _data.handover_base_norm || 0;
      var hovH    = hovNorm > 0 ? Math.max(3, Math.round(hovNorm / maxGmv * chartH)) : 0;
      var toutH   = toutNorm > 0 ? Math.max(3, Math.round(toutNorm * 30 / maxGmv * chartH)) : 0;

      var hovSeg  = hovH > 0
        ? '<div class="qnrr-seg qnrr-base-hov-seg" style="height:' + hovH + 'px"></div>'
        : '';
      var coreSeg = '<div class="qnrr-seg qnrr-base-core-seg" style="height:' + coreH + 'px"></div>';

      // Ghost segment: dashed red — แทน transfer_out ที่ถูกตัดออกจากฐาน
      var toutTooltip = toutH > 0
        ? 'ฐานเดิม ' + _fmtM(Math.round(_data.base_norm_original * 30)) +
          ' → ปรับเหลือ ' + _fmtM(Math.round(_data.base_norm * 30)) +
          ' (หัก ' + toutOuts + ' outlet transfer ออก −' + _fmtM(Math.round(toutNorm * 30)) + ')'
        : '';
      var toutSeg = toutH > 0
        ? '<div class="qnrr-seg qnrr-base-tout-seg" style="height:' + toutH + 'px" title="' + toutTooltip + '"></div>'
        : '';

      bodyHtml = '<div class="qnrr-bar-body qnrr-base-body" style="height:' + barH + 'px">' + coreSeg + hovSeg + toutSeg + '</div>';
    } else if (bm) {
      var segsHtml = '';
      STACK_ORDER.forEach(function(mv){
        var gmv = (bm.segments && bm.segments[mv]) || 0;
        if (gmv <= 0) return;
        var h   = Math.max(3, Math.round(gmv / maxGmv * chartH));
        var cfg = MV_CFG[mv];
        segsHtml += '<div class="qnrr-seg" style="height:' + h + 'px;background:' + cfg.color + ';min-height:3px"></div>';
      });
      // Partial month ghost — dashed outline only ABOVE the actual bar
      var ghostHtml = '';
      if (isPartialMonth) {
        if (gapH > 3) {
          // ghost-top: dashed box floating above actual bar, capped to never overflow
          // the chart area (see maxGapH above). When the real projection is taller than
          // the cap, fade the top edge + small indicator instead of a hard cut, so it
          // reads as "continues beyond, see number above" rather than a rendering glitch.
          var confNote = isLowConf ? ' — ข้อมูลแค่ ' + bm.curr_days + ' วัน ยังไม่นิ่ง' : '';
          var clipNote = isGhostClipped ? ' (ย่อสัดส่วนเพื่อให้พอดีกราฟ)' : '';
          var tooltipTxt = 'Run-rate: ' + _fmtM(runRate) + ' (' + bm.curr_days + '/' + bm.days_in_month + 'd ÷' + bm.curr_days + 'd×30)' + confNote + clipNote;
          var ghostCls = 'qnrr-ghost-top' + (isGhostClipped ? ' qnrr-ghost-top-clipped' : '') + (isLowConf ? ' qnrr-ghost-top-lowconf' : '');
          ghostHtml = '<div class="' + ghostCls + '" style="height:' + gapH + 'px;bottom:' + barH + 'px" title="' + tooltipTxt + '"></div>';
        } else if (gapH <= 3 && rawGapH > -3) {
          // run-rate ≈ actual (overperformance or same) — show thin line at run-rate level
          var lineBottom = Math.min(Math.max(barH, projH), chartH - 2);
          ghostHtml = '<div class="qnrr-ghost-line' + (isLowConf ? ' qnrr-ghost-top-lowconf' : '') + '" style="bottom:' + lineBottom + 'px" title="Run-rate ≈ actual: ' + _fmtM(runRate) + '"></div>';
        }
      }
      // v6-uxfix3: when a ghost extension sits on top, square off the bar's top corners
      // (via CSS class below) so the two read as one continuous shape instead of two
      // separate floating boxes with a visible seam where the bar's rounded top met
      // the ghost's square bottom.
      var barBodyCls = 'qnrr-bar-body' + (ghostHtml ? ' qnrr-bar-body-has-ghost' : '');
      bodyHtml = ghostHtml + '<div class="' + barBodyCls + '" style="height:' + barH + 'px">' + segsHtml + '</div>';
    }

    var onclickStr = isBase ? '' : 'onclick="_qnrrSelBar(\'' + m + '\')"';
    var isPartialBar = !isBase && bm && bm.is_partial;
    return '<div class="qnrr-bar-col' + (isBase ? ' base-col' : '') + (isActive ? ' active' : '') + '" data-month="' + m + '" ' + onclickStr + '>' +
      '<div class="qnrr-bar-top-wrap' + (isPartialBar ? ' partial' : '') + '">' + topHtml.replace('<!-- partial -->','') + '</div>' +
      '<div class="qnrr-bar-chart-area">' + bodyHtml + '</div>' +
      '<div class="qnrr-bar-lbl">' + _esc(MONTHS_TH[m] || m) + (isLast ? '~' : '') + '</div>' +
    '</div>';
  }).join('');

  barsRow.innerHTML = barsHtml;
}

// ── iOS segmented control tap handler ───────────────────────────────────────
// Called when user taps anywhere on the qnrr-seg pill
function _qnrrSegTap(seg){
  var chartBtn = document.getElementById('qnrr-seg-chart');
  var listBtn  = document.getElementById('qnrr-seg-list');
  if (!chartBtn || !listBtn) return;
  // Determine which side was tapped by comparing clientX to pill midpoint
  var rect = seg.getBoundingClientRect();
  var mid  = rect.left + rect.width / 2;
  var mode = (window.event && window.event.clientX < mid) ? 'chart' : 'list';
  _qnrrSetView(mode, null);
}
window._qnrrSegTap = _qnrrSegTap;

// ── Update segmented control + expand btn to match current view ──────────────
function _qnrrSyncToolbar(mode){
  var chartBtn  = document.getElementById('qnrr-seg-chart');
  var listBtn   = document.getElementById('qnrr-seg-list');
  var thumb     = document.getElementById('qnrr-seg-thumb');
  var expandBtn = document.getElementById('qnrr-expand-btn');
  if (chartBtn) { chartBtn.classList.toggle('active', mode === 'chart'); chartBtn.setAttribute('aria-pressed', String(mode === 'chart')); }
  if (listBtn)  { listBtn.classList.toggle('active',  mode === 'list');  listBtn.setAttribute('aria-pressed', String(mode === 'list')); }
  if (thumb)    thumb.style.transform = mode === 'chart' ? 'translateX(0)' : 'translateX(100%)';
  if (expandBtn) expandBtn.style.display = mode === 'list' ? 'flex' : 'none';
}

// ── Breakdown table — 4 months × movement ──────────────────────────────────
function _qnrrRenderBreakdown(){
  var wrap = _el('qnrr-breakdown-wrap');
  if (!wrap) return;

  if (!_data) { wrap.innerHTML = ''; return; }

  var ALL_MONTHS = [BASE_MONTH].concat(Q_MONTHS);
  var MONTH_HDRS = ALL_MONTHS.map(function(m){ return MONTHS_TH[m] || m; });

  // Header: active outlets only (core_nrr, not including churn)
  var outletHeaders = ALL_MONTHS.map(function(m){
    if (m === BASE_MONTH) return _data.cohort_outlets + ' สาขา';
    var bm = _data.by_month[m];
    if (!bm) return '—';
    var active = bm.outlets.core_nrr || 0;
    return active + ' สาขา';  // v807: removed 17/30d — days info in tooltip only
  });

  // v776: dispBase = adjusted base (หัก core transfer_out แล้ว)
  // v6-fix4: also add transfer_in now that it's part of the adjustment
  var dispBase = _data.base_norm > 0 ? Math.round(_data.base_norm * 30) : _data.base_gmv;
  var hasToutAdj = (_data.transfer_out_base_norm || 0) > 0 || (_data.transfer_in_base_norm || 0) > 0;

  // colgroup: fixed width ป้องกัน partial month column ถ่าง
  var colgroup = '<colgroup><col style="width:100px">' +
    ALL_MONTHS.map(function(){ return '<col style="width:58px">'; }).join('') +
    '</colgroup>';

  // ── Base adjustment note row (แสดงเมื่อมี core transfer_out/in ปรับฐาน) ──
  var adjNoteHtml = '';
  if (hasToutAdj) {
    var toutOuts = (_data.transfer_out_outlets || []).length;
    var tinOuts  = (_data.transfer_in_outlets  || []).length;
    var origBase = Math.round(_data.base_norm_original * 30);
    var adjAmt   = Math.round((_data.transfer_out_base_norm || 0) * 30);
    var addAmt   = Math.round((_data.transfer_in_base_norm  || 0) * 30);
    var parts = [];
    if (toutOuts > 0) parts.push('หัก ' + toutOuts + ' outlet ย้ายออก: −' + _fmtM(adjAmt));
    if (tinOuts  > 0) parts.push('บวก ' + tinOuts + ' outlet ย้ายเข้า: +' + _fmtM(addAmt));
    adjNoteHtml = '<tr class="bk-base-adj-row">' +
      '<td colspan="' + (ALL_MONTHS.length + 1) + '">' +
        '<div class="qnrr-base-adj-note">' +
          '<span class="qnrr-base-adj-icon"></span>' +
          'ฐานปรับจาก ' + _fmtM(origBase) + ' → ' + _fmtM(dispBase) +
          ' (' + parts.join(', ') + ')' +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  var html = '<table class="qnrr-bk-table" aria-label="NRR movement breakdown by month">' + colgroup + '<thead><tr>' +
    '<th style="text-align:left">Movement</th>' +
    ALL_MONTHS.map(function(m, i){
      var bm2 = _data.by_month[m];
      var isPartialCol = bm2 && bm2.is_partial;
      return '<th>' + MONTH_HDRS[i] + (isPartialCol ? '~' : '') +
        '<br><span style="color:rgba(var(--ink-blue),.52);font-size:var(--text-2xs);font-weight:var(--fw-semi);text-transform:none;letter-spacing:0">'
        + outletHeaders[i] + '</span></th>';
    }).join('') +
    '</tr></thead><tbody>' + adjNoteHtml;

  // ── Core NRR block: main row + 2 sub-rows (churn + net) ──────────────────
  var coreColor = MV_CFG.core_nrr.color;
  var coreSqStyle = 'background:' + coreColor;

  // Main "Core NRR active" row
  html += '<tr>' +
    '<td><div class="qnrr-bk-mv-cell">' +
      '<div class="qnrr-bk-dot" style="' + coreSqStyle + '"></div>' +
      '<span class="qnrr-bk-mv-name">Core NRR active</span>' +
    '</div></td>';
  ALL_MONTHS.forEach(function(m){
    if (m === BASE_MONTH) {
      html += '<td style="color:rgba(74,222,128,.65)">' + _fmtM(dispBase) + '</td>';
      return;
    }
    var bm = _data.by_month[m];
    var g  = (bm && bm.segments.core_nrr) || 0;
    html += '<td class="bk-pos">' + (g > 0 ? _fmtM(g) : '<span style="color:rgba(255,255,255,.52)">—</span>') + '</td>';
  });
  html += '</tr>';

  // Sub-row: Churn (negative)
  html += '<tr class="bk-subrow">' +
    '<td><div class="qnrr-bk-mv-cell">' +
      '<div class="qnrr-bk-dot" style="background:rgba(248,113,113,.82)"></div>' +
      '<span class="qnrr-bk-mv-name">└ Churn</span>' +
    '</div></td>';
  ALL_MONTHS.forEach(function(m){
    if (m === BASE_MONTH) { html += '<td style="color:rgba(255,255,255,.52)">—</td>'; return; }
    var bm = _data.by_month[m];
    var g  = (bm && bm.segments.core_nrr_churn) || 0;
    html += '<td class="bk-churn">' + (g > 0 ? '-' + _fmtM(g) : '<span style="color:rgba(255,255,255,.52)">—</span>') + '</td>';
  });
  html += '</tr>';

  // Sub-row: Contraction (core active outlets ที่ซื้อลดลง)
  // = curr_gmv - base_gmv ของ active outlets เท่านั้น (ไม่รวม churn)
  html += '<tr class="bk-subrow">' +
    '<td><div class="qnrr-bk-mv-cell">' +
      '<div class="qnrr-bk-dot" style="background:rgba(251,191,36,.70)"></div>' +
      '<span class="qnrr-bk-mv-name">└ Up/Down</span>' +
    '</div></td>';
  ALL_MONTHS.forEach(function(m){
    if (m === BASE_MONTH) { html += '<td style="color:rgba(255,255,255,.52)">—</td>'; return; }
    var bm = _data.by_month[m];
    var c  = bm ? (bm.contraction || 0) : 0;
    if (!bm || (bm.segments.core_nrr === 0 && bm.segments.core_nrr_churn === 0)) {
      html += '<td style="color:rgba(255,255,255,.52)">—</td>'; return;
    }
    // negative = ซื้อลด, positive = ซื้อเพิ่ม (expansion ภายใน core)
    var col = c >= 0 ? 'rgba(74,222,128,.72)' : 'rgba(248,113,113,.80)';
    var prefix = c >= 0 ? '+' : '';
    html += '<td style="color:' + col + '">' + prefix + _fmtM(c) + '</td>';
  });
  html += '</tr>';


  // ── Other movements (skip core_nrr, core_nrr_churn, new_sales — handled separately) ─
  var SKIP = {core_nrr: true, core_nrr_churn: true, new_sales: true};
  BK_ORDER.forEach(function(mv){
    if (SKIP[mv]) return;
    var cfg = MV_CFG[mv];
    var hasAny = ALL_MONTHS.some(function(m){
      if (m === BASE_MONTH) return false;
      var bm = _data.by_month[m];
      if (!bm) return false;
      if (mv === 'handover') return (bm.segments['handover'] || 0) + (bm.segments['new_sales'] || 0) > 0;
      return bm && (bm.segments[mv] || 0) > 0;
    });
    if (!hasAny) return;

    var isChurn = (mv === 'transfer_out');
    var isPos   = (mv === 'expansion' || mv === 'comeback');
    var isNeut  = (mv === 'handover' || mv === 'transfer_in');
    var sqStyle = cfg.color === 'ghost'
      ? 'border:1px dashed rgba(255,255,255,.28);background:transparent'
      : 'background:' + cfg.color;

    if (mv === 'handover') {
      // ── Handover + New Sales cohort block ────────────────────────────────
      // Main row = total (handover + new_sales) ทุกเดือน
      html += '<tr>' +
        '<td><div class="qnrr-bk-mv-cell">' +
          '<div class="qnrr-bk-dot" style="' + sqStyle + '"></div>' +
          '<span class="qnrr-bk-mv-name">Handover & New</span>' +
        '</div></td>';
      ALL_MONTHS.forEach(function(m){
        if (m === BASE_MONTH) {
          // Mar: แสดง handover base (Mar GMV ของ handover cohort)
          if (_data.handover_base_norm > 0) {
            html += '<td class="bk-neut">' + _fmtM(Math.round(_data.handover_base_norm)) + '</td>';
          } else {
            html += '<td style="color:rgba(255,255,255,.52)">—</td>';
          }
          return;
        }
        var bm = _data.by_month[m];
        var g  = ((bm && bm.segments['handover']) || 0) + ((bm && bm.segments['new_sales']) || 0);
        html += '<td style="color:' + (g>0 ? 'rgba(96,165,250,.80)' : 'rgba(255,255,255,.15)') + '">' + (g > 0 ? _fmtM(g) : '—') + '</td>';
      });
      html += '</tr>';

      // Sub-rows: cohort Mar (handover) + cohort Apr / May / Jun (new_sales by month)
      // cohort Mar = handover outlets — Mar GMV in base col, then their curr GMV each month
      var hovColor = 'rgba(96,165,250,.72)';
      html += '<tr class="bk-subrow">' +
        '<td><div class="qnrr-bk-mv-cell">' +
          '<div class="qnrr-bk-dot" style="background:' + hovColor + '"></div>' +
          '<span class="qnrr-bk-mv-name">└ cohort ' + (QNRR_CFG.months_th[BASE_MONTH] || BASE_MONTH) + '</span>' +
        '</div></td>';
      ALL_MONTHS.forEach(function(m){
        if (m === BASE_MONTH) {
          html += _data.handover_base_norm > 0
            ? '<td class="bk-neut">' + _fmtM(Math.round(_data.handover_base_norm)) + '</td>'
            : '<td style="color:rgba(255,255,255,.52)">—</td>';
          return;
        }
        var bm = _data.by_month[m];
        var g  = (bm && bm.segments['handover']) || 0;
        html += '<td style="color:' + (g>0 ? hovColor : 'rgba(255,255,255,.12)') + '">' + (g > 0 ? _fmtM(g) : '—') + '</td>';
      });
      html += '</tr>';

      // cohort Apr/May/Jun — derived from QNRR_CFG.q_months (auto-updates each quarter)
      // สีน้ำเงินเหมือน cohort มี.ค. — ต่างแค่ opacity เพื่อแยกชั้น
      var nsColors = ['rgba(96,165,250,.72)','rgba(96,165,250,.72)','rgba(96,165,250,.72)'];
      var nsCohortDefs = QNRR_CFG.q_months.map(function(m, i){
        return {month: m, label: '└ cohort ' + (QNRR_CFG.months_th[m] || m), color: nsColors[i] || 'rgba(96,165,250,.60)'};
      });

      // Build cumulative set of outlet_ids ที่ถูก claim โดย cohort ก่อนหน้าแล้ว
      // เพื่อ prevent double-count ข้าม cohort
      var claimedByEarlierCohort = {};

      nsCohortDefs.forEach(function(nc){
        // Collect outlet_ids ที่เป็น new_sales ใน nc.month เท่านั้น
        // และต้องไม่ถูก claim โดย cohort เดือนก่อนหน้าแล้ว
        var cohortBm = _data.by_month[nc.month];
        if (!cohortBm) return;
        var cohortOutlets = {};
        (cohortBm.rows || []).forEach(function(r){
          if (r.movement_type === 'new_sales' && !claimedByEarlierCohort[r.outlet_id]) {
            cohortOutlets[r.outlet_id] = true;
          }
        });
        if (!Object.keys(cohortOutlets).length) return;

        // Mark outlet_ids ของ cohort นี้ว่า claimed แล้ว
        // cohort เดือนถัดไปจะ exclude ออก ไม่ให้ double-count
        Object.keys(cohortOutlets).forEach(function(oid){
          claimedByEarlierCohort[oid] = true;
        });

        // Render row: for each month, sum curr_gmv ของ outlet_ids ใน cohort นี้
        // carry-forward = ดู GMV outlet เหล่านี้ในเดือนถัดๆ ไปด้วย
        // dedupe outlet_id ต่อเดือน — TL/Admin scope อาจมีหลาย rows ต่อ outlet (transfer rows)
        html += '<tr class="bk-subrow">' +
          '<td><div class="qnrr-bk-mv-cell">' +
            '<div class="qnrr-bk-dot" style="background:' + nc.color + '"></div>' +
            '<span class="qnrr-bk-mv-name">' + _esc(nc.label) + '</span>' +
          '</div></td>';
        ALL_MONTHS.forEach(function(m){
          if (m === BASE_MONTH) { html += '<td style="color:rgba(255,255,255,.52)">—</td>'; return; }
          var bm2 = _data.by_month[m];
          if (!bm2) { html += '<td style="color:rgba(255,255,255,.52)">—</td>'; return; }
          var g = 0;
          var seenInMonth = {};
          (bm2.rows || []).forEach(function(r){
            if (cohortOutlets[r.outlet_id] && !seenInMonth[r.outlet_id]) {
              var cd = parseFloat(r.curr_days) || 30;
              var gmv = parseFloat(r.curr_gmv) || 0;
              if (gmv > 0) {
                seenInMonth[r.outlet_id] = true;
                g += gmv / cd * 30;
              }
            }
          });
          g = Math.round(g);
          var isBeforeCohort = (m < nc.month);
          var col = isBeforeCohort ? 'rgba(255,255,255,.10)' : (g > 0 ? nc.color : 'rgba(255,255,255,.20)');
          html += '<td style="color:' + col + '">' + (g > 0 && !isBeforeCohort ? _fmtM(g) : '—') + '</td>';
        });
        html += '</tr>';
      });
    } else {
      // ── Standard movement row ──────────────────────────────────────────────
      html += '<tr>' +
        '<td><div class="qnrr-bk-mv-cell">' +
          '<div class="qnrr-bk-dot" style="' + sqStyle + '"></div>' +
          '<span class="qnrr-bk-mv-name">' + _esc(cfg.label) + '</span>' +
        '</div></td>';

      ALL_MONTHS.forEach(function(m){
        if (m === BASE_MONTH) {
          html += '<td style="color:rgba(255,255,255,.52)">—</td>';
          return;
        }
        var bm = _data.by_month[m];
        var g  = (bm && bm.segments[mv]) || 0;
        var cellColor = g > 0
          ? (isChurn ? 'rgba(248,113,113,.84)'
            : isNeut ? 'rgba(96,165,250,.80)'
            : cfg.color !== 'ghost' ? cfg.color : 'rgba(255,255,255,.5)')
          : '';
        var cellStyle = cellColor ? 'color:' + cellColor : 'color:rgba(255,255,255,.52)';
        html += '<td style="' + cellStyle + '">' + (g > 0 ? (isChurn ? '-' : '') + _fmtM(g) : '—') + '</td>';
      });
      html += '</tr>';
    }
  });

  // ── Total GMV row ─────────────────────────────────────────────────────────
  // Mar Total = original base (ก่อนหัก transfer_out) + handover = GMV จริงใน Mar
  var baseOrigForTotal = _data.base_norm_original || _data.base_norm;
  var dispBaseTotalMar = Math.round((baseOrigForTotal + (_data.handover_base_norm / 30)) * 30);
  html += '<tr class="bk-total"><td><div class="qnrr-bk-mv-cell"><span class="qnrr-bk-mv-name" style="color:rgba(255,255,255,.65)">Total GMV</span></div></td>';
  ALL_MONTHS.forEach(function(m){
    if (m === BASE_MONTH) {
      html += '<td style="color:rgba(255,255,255,.72)">' + _fmtM(dispBaseTotalMar) + '</td>';
    } else {
      var bm = _data.by_month[m];
      html += '<td style="color:rgba(255,255,255,.72)">' + (bm ? _fmtM(bm.total_gmv) : '—') + '</td>';
    }
  });
  html += '</tr></tbody></table>';

  wrap.innerHTML = html;
}

// ── Transfer out callout card ────────────────────────────────────────────────
// v776: แสดงข้อมูลครบ — outlet count, GMV, แยก core vs non-core
function _qnrrRenderToutCard(){
  var card = _el('qnrr-tout-card');
  if (!card) return;
  if (!_data) { card.className = 'qnrr-tout-card'; return; }

  var bm    = _data.by_month[_selBar];
  var toutG = (bm && bm.segments && bm.segments.transfer_out) || 0;
  var toutN = (bm && bm.outlets  && bm.outlets.transfer_out)  || 0;

  // ตรวจว่าใน transfer_out เดือนที่เลือก มีกี่ outlet ที่เป็น core cohort
  var coreSet = _data.transfer_out_outlets || [];
  var selMonth = _selBar;
  var coreToutThisMonth = coreSet.filter(function(t){ return t.period_month === selMonth; });
  var coreCount = coreToutThisMonth.length;
  var coreNorm  = coreToutThisMonth.reduce(function(s,t){ return s + t.gmv_norm; }, 0);

  if (toutG > 0 && _viewMode === 'chart') {
    card.className = 'qnrr-tout-card show';
    var html =
      '<div class="qnrr-tout-icon"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.3" opacity=".7"/><path d="M8 7v4M8 5.5v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></div>' +
      '<div class="qnrr-tout-body">' +
        '<div class="qnrr-tout-card-label">TRANSFER OUT · ' + (MONTHS_TH[_selBar] || _selBar) + '</div>' +
        '<div class="qnrr-tout-card-row">' +
          '<span class="qnrr-tout-card-desc">' + toutN + ' outlet' + (toutN !== 1 ? 's' : '') + ' ย้ายออก</span>' +
          '<span class="qnrr-tout-card-val">−' + _fmtM(toutG) + '</span>' +
        '</div>' +
        (coreCount > 0
          ? '<div class="qnrr-tout-card-note">' +
              coreCount + ' outlet เป็น core cohort → ฐาน NRR ถูกปรับลด −' + _fmtM(Math.round(coreNorm * 30)) +
            '</div>'
          : '<div class="qnrr-tout-card-note">outlet เหล่านี้ไม่ได้อยู่ใน core cohort → ฐาน NRR ไม่เปลี่ยน</div>'
        ) +
      '</div>';
    card.innerHTML = html;
  } else {
    card.className = 'qnrr-tout-card';
    card.innerHTML = '';
  }
}

// ── Legend ───────────────────────────────────────────────────────────────────
function _qnrrRenderLegend(){
  var leg = _el('qnrr-legend');
  if (!leg) return;
  var html = LEGEND_ORDER.map(function(mv){
    var cfg = MV_CFG[mv];
    if (mv === 'transfer_out') {
      return '<div class="qnrr-leg ghost"><div class="qnrr-leg-sq"></div>' + _esc(cfg.label) + '</div>';
    }
    return '<div class="qnrr-leg"><div class="qnrr-leg-sq" style="background:' + cfg.color + '"></div>' + _esc(cfg.label) + '</div>';
  }).join('');
  leg.innerHTML = html;
}

// ── Drill list ───────────────────────────────────────────────────────────────
function _qnrrRenderDrill(){
  var list = _el('qnrr-acct-list');
  var lbl  = _el('qnrr-drill-lbl');
  if (!list) return;

  if (!_data || !_data.by_month[_selBar]) {
    if (lbl) lbl.textContent = 'ไม่มีข้อมูล';
    list.innerHTML = '<div style="padding:20px;text-align:center;color:rgba(255,255,255,.52);font-size:var(--text-sm)">ไม่มีข้อมูลเดือนนี้</div>';
    return;
  }

  var bm   = _data.by_month[_selBar];
  var rows = bm.rows || [];

  var filtered = rows;
  if (_selMv === 'churn')     filtered = rows.filter(function(r){ return r.movement_type === 'core_nrr_churn'; });
  else if (_selMv === 'handover')  filtered = rows.filter(function(r){ return r.movement_type === 'handover'; });
  else if (_selMv === 'expansion') filtered = rows.filter(function(r){ return r.movement_type === 'expansion'; });

  // Build outlet name map from bulkOutletsData
  var outletNameMap = {};
  if (typeof bulkOutletsData !== 'undefined') {
    Object.values(bulkOutletsData).forEach(function(monthsObj){
      Object.values(monthsObj).forEach(function(outletArr){
        if (!Array.isArray(outletArr)) return;
        outletArr.forEach(function(o){
          if (o.outlet_id && o.outlet_name && !outletNameMap[o.outlet_id]) {
            outletNameMap[o.outlet_id] = o.outlet_name;
          }
        });
      });
    });
  }

  // Group by account_id
  var byAcct = {}; var acctOrder = [];
  filtered.forEach(function(r){
    var aid = r.account_id;
    if (!byAcct[aid]) {
      byAcct[aid] = { name: r.account_name || aid, outlets: [], baseGmv: 0, currGmv: 0, gmvByMonth: {}, dominantMv: null, mvGmv: {} };
      acctOrder.push(aid);
    }
    var oName = outletNameMap[String(r.outlet_id)] || outletNameMap[r.outlet_id] || r.account_name || String(r.outlet_id);
    byAcct[aid].outlets.push({ outlet_id: r.outlet_id, outlet_name: oName, base_gmv: r.base_gmv || 0, curr_gmv: r.curr_gmv || 0, movement_type: r.movement_type });
    byAcct[aid].baseGmv += r.base_gmv || 0;
    byAcct[aid].currGmv += r.curr_gmv || 0;
    byAcct[aid].mvGmv[r.movement_type] = (byAcct[aid].mvGmv[r.movement_type] || 0) + (r.curr_gmv || 0);
  });

  // Determine dominant movement per account (by GMV weight)
  acctOrder.forEach(function(aid){
    var a = byAcct[aid];
    var best = null; var bestG = -1;
    Object.keys(a.mvGmv).forEach(function(mv){ if ((a.mvGmv[mv] || 0) > bestG) { bestG = a.mvGmv[mv]; best = mv; } });
    a.dominantMv = best || 'core_nrr';
    // Also collect all-month GMV for sparkline
    var allMonths = [BASE_MONTH].concat(Q_MONTHS);
    allMonths.forEach(function(m){
      if (m === BASE_MONTH) { a.gmvByMonth[m] = a.baseGmv; return; }
      var mbm = _data.by_month[m];
      if (!mbm) { a.gmvByMonth[m] = 0; return; }
      var sum = 0;
      (mbm.rows || []).forEach(function(r){ if (r.account_id === aid) sum += r.curr_gmv || 0; });
      a.gmvByMonth[m] = sum;
    });
  });

  // Update drill label
  if (lbl) lbl.textContent = acctOrder.length + ' accounts · ' + (MONTHS_TH[_selBar] || _selBar);

  // Sort: currGmv DESC, then baseGmv DESC for ties
  acctOrder.sort(function(a,b){
    var cv = (byAcct[b].currGmv || 0) - (byAcct[a].currGmv || 0);
    return cv !== 0 ? cv : (byAcct[b].baseGmv || 0) - (byAcct[a].baseGmv || 0);
  });

  var html = acctOrder.map(function(aid, idx){
    var a   = byAcct[aid];
    var cfg = MV_CFG[a.dominantMv] || {color:'rgba(255,255,255,.3)'};
    var dotColor = cfg.color === 'ghost' ? 'rgba(180,180,200,.40)' : cfg.color;

    // Sparkline: 4 bars (Mar/Apr/May/Jun)
    var allMonths = [BASE_MONTH].concat(Q_MONTHS);
    var gmvVals   = allMonths.map(function(m){ return a.gmvByMonth[m] || 0; });
    var maxSp     = Math.max.apply(null, gmvVals) || 1;
    var sbHtml = allMonths.map(function(m, mi){
      var v  = gmvVals[mi];
      var h  = v > 0 ? Math.max(4, Math.round(v / maxSp * 20)) : 2;
      var bg = v > 0 ? (m === BASE_MONTH ? 'rgba(38,96,200,.42)' : dotColor) : 'rgba(255,255,255,.06)';
      return '<div class="qnrr-sb" style="height:' + h + 'px;background:' + bg + '" data-m="' + (MONTHS_TH[m]||m) + '" data-v="' + _fmtM(v) + '"></div>';
    }).join('');

    // Outlet rows
    var outHtml = a.outlets.map(function(o){
      var oName   = o.outlet_name || String(o.outlet_id);
      var oCfg    = MV_CFG[o.movement_type] || {color:'rgba(255,255,255,.3)'};
      var oDotCol = oCfg.color === 'ghost' ? 'rgba(180,180,200,.40)' : oCfg.color;
      // outlet 4-bar sparkline
      var oAllM   = [BASE_MONTH].concat(Q_MONTHS);
      var oGmvs   = oAllM.map(function(qm){
        if (qm === BASE_MONTH) return o.base_gmv || 0;
        var qbm = _data.by_month[qm];
        if (!qbm) return 0;
        var found = (qbm.rows || []).find(function(rr){ return rr.outlet_id === o.outlet_id; });
        return found ? found.curr_gmv : 0;
      });
      var oMax = Math.max.apply(null, oGmvs) || 1;
      var oSparkHtml = oAllM.map(function(qm, qi){
        var v  = oGmvs[qi];
        var h  = v > 0 ? Math.max(3, Math.round(v / oMax * 16)) : 2;
        var bg = qm === BASE_MONTH ? 'rgba(38,96,200,.42)' : (qm === _selBar ? oDotCol : 'rgba(255,255,255,.13)');
        return '<div class="qnrr-osb" style="height:' + h + 'px;background:' + bg + '" title="' + (MONTHS_TH[qm]||qm) + ' ' + _fmtM(v) + '"></div>';
      }).join('');
      var oSelGmv  = oGmvs[oAllM.indexOf(_selBar)] || 0;
      return '<div class="qnrr-out-row">' +
        '<div class="qnrr-out-dot" style="background:' + oDotCol + '"></div>' +
        '<div class="qnrr-out-name">' + _esc(String(oName).slice(0, 40)) + '</div>' +
        '<div class="qnrr-out-spark-wrap">' +
          '<div class="qnrr-out-spark">' + oSparkHtml + '</div>' +
          '<div class="qnrr-out-spark-lbl">' +
            '<span>' + _fmtM(o.base_gmv) + '</span>' +
            '<span style="color:' + oDotCol + '">' + _fmtM(oSelGmv) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    var rowId = 'qnrr-r' + idx;
    return '<div class="qnrr-acct-row" onclick="_qnrrToggleAcct(\'' + rowId + '\',this)">' +
      '<div class="qnrr-mv-dot" style="background:' + dotColor + '"></div>' +
      '<div class="qnrr-acct-left">' +
        '<div class="qnrr-acct-name">' + _esc(a.name || aid) + '</div>' +
      '</div>' +
      '<div class="qnrr-acct-right">' +
        '<div class="qnrr-spark-col">' +
          '<div class="qnrr-spark-row">' +
            '<span class="qnrr-slbl-base">' + _fmtM(a.baseGmv) + '</span>' +
            '<div class="qnrr-spark" onmousemove="_qnrrSparkMove(event,this)" onmouseleave="_qnrrSparkLeave(this)">' +
              sbHtml +
              '<div class="qnrr-sp-tt"><div class="qnrr-tt-mo"></div><div class="qnrr-tt-v"></div></div>' +
            '</div>' +
            '<span class="qnrr-slbl-curr" style="color:' + dotColor + '">' + _fmtM(a.currGmv) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="qnrr-chev">›</div>' +
      '</div>' +
    '</div>' +
    '<div class="qnrr-outlet-wrap" id="qnrr-ow-' + rowId + '">' + outHtml + '</div>';
  }).join('');

  list.innerHTML = html;
}


// ── _qnrrRenderList — full-quarter account × outlet list (v781) ──────────────
var _listFilter = 'all';

function _qnrrListFilter(mv, btn){
  _listFilter = mv;
  document.querySelectorAll('.qnrr-list-filter-bar .qnrr-chip').forEach(function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  _qnrrRenderList();
}
window._qnrrListFilter = _qnrrListFilter;

function _qnrrExpandAll(expand){
  document.querySelectorAll('.qnrr-ol-rows').forEach(function(el){
    el.style.display = expand ? 'block' : 'none';
  });
  document.querySelectorAll('.qnrr-acct-hdr').forEach(function(el){
    el.classList.toggle('expanded', expand);
  });
}
window._qnrrExpandAll = _qnrrExpandAll;

// v776c: single toggle button
var _allExpanded = true;
function _qnrrToggleAll(btn){
  _allExpanded = !_allExpanded;
  _qnrrExpandAll(_allExpanded);
  // v810: update double-chevron icon direction (up=กาง, down=หุบ)
  var icon = document.getElementById('qnrr-expand-icon');
  if (icon) {
    // กาง (expanded) = chevrons point UP; หุบ (collapsed) = chevrons point DOWN
    var polylines = icon.querySelectorAll('polyline');
    if (_allExpanded) {
      if (polylines[0]) polylines[0].setAttribute('points', '3,10 8,4 13,10');
      if (polylines[1]) polylines[1].setAttribute('points', '3,14 8,8 13,14');
    } else {
      if (polylines[0]) polylines[0].setAttribute('points', '3,4 8,10 13,4');
      if (polylines[1]) polylines[1].setAttribute('points', '3,8 8,14 13,8');
    }
  }
  // dim the button slightly when all collapsed
  var expandBtn = document.getElementById('qnrr-expand-btn');
  if (expandBtn) expandBtn.style.opacity = _allExpanded ? '1' : '0.55';
}
window._qnrrToggleAll = _qnrrToggleAll;

function _qnrrRenderList(){
  var wrap = _el('qnrr-acct-list');
  if (!wrap) return;
  if (!_data) { wrap.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,.52);font-size:var(--text-sm)">ไม่มีข้อมูล</div>'; return; }

  var ALL_MONTHS = [QNRR_CFG.base_month].concat(QNRR_CFG.q_months);
  var MTH_SHORT  = QNRR_CFG.months_th;

  // Collect all rows across Q months
  var allRows = [];
  QNRR_CFG.q_months.forEach(function(m){
    var bm = _data.by_month[m];
    if (bm) (bm.rows || []).forEach(function(r){ allRows.push(r); });
  });

  // Group by account → outlet
  var byAcct = {}; var acctOrder = [];
  allRows.forEach(function(r){
    var aid = r.account_id;
    if (!byAcct[aid]) {
      byAcct[aid] = {name: r.account_name || aid, outlets: {}, totalCurr: 0};
      acctOrder.push(aid);
    }
    var oid = r.outlet_id;
    if (!byAcct[aid].outlets[oid]) {
      byAcct[aid].outlets[oid] = {
        name: r.account_name || String(oid),
        gmv:  Object.fromEntries([QNRR_CFG.base_month].concat(QNRR_CFG.q_months).map(function(m){ return [m, 0]; })),
        mv:   Object.fromEntries(QNRR_CFG.q_months.map(function(m){ return [m, null]; }))
      };
      var _bd = parseFloat(r.base_days) || 31;
      byAcct[aid].outlets[oid].gmv[QNRR_CFG.base_month] = ((parseFloat(r.base_gmv) || 0) / _bd) * 30;
    }
    var od = byAcct[aid].outlets[oid];
    var _cd = parseFloat(r.curr_days) || 30;
    od.gmv[r.period_month] = (od.gmv[r.period_month]||0) + ((parseFloat(r.curr_gmv)||0) / _cd * 30);
    if (!od.mv[r.period_month]) od.mv[r.period_month] = r.movement_type;
    byAcct[aid].totalCurr += parseFloat(r.curr_gmv)||0;
  });

  // Movement priority for dominant label
  var MV_PRIO = ['core_nrr_churn','transfer_out','handover','expansion','new_sales','comeback','transfer_in','core_nrr'];
  function _domMv(od){
    for (var i=0;i<MV_PRIO.length;i++){
      var mv=MV_PRIO[i];
      if (QNRR_CFG.q_months.some(function(m){ return od.mv[m]===mv; })) return mv;
    }
    return 'core_nrr';
  }

  // Filter accounts: keep only those with at least one outlet matching _listFilter
  var filteredAccts = acctOrder.filter(function(aid){
    if (_listFilter === 'all') return true;
    return Object.keys(byAcct[aid].outlets).some(function(oid){
      return _domMv(byAcct[aid].outlets[oid]) === _listFilter;
    });
  });

  // Sort by totalCurr DESC
  filteredAccts.sort(function(a,b){ return byAcct[b].totalCurr - byAcct[a].totalCurr; });

  // ── Update filter chip counts ─────────────────────────────────────────────
  // Count outlets per movement type across all accounts
  var mvCounts = {all: 0};
  acctOrder.forEach(function(aid){
    Object.keys(byAcct[aid].outlets).forEach(function(oid){
      var mv = _domMv(byAcct[aid].outlets[oid]);
      mvCounts[mv] = (mvCounts[mv] || 0) + 1;
      mvCounts['all'] = (mvCounts['all'] || 0) + 1;
    });
  });

  // v776: inject transfer_out chip ถ้ายังไม่มีใน DOM
  var filterBar = document.querySelector('.qnrr-list-filter-bar');
  if (filterBar && !filterBar.querySelector('[data-mv="transfer_out"]')) {
    var toutChip = document.createElement('button');
    toutChip.className = 'qnrr-chip qnrr-tout-chip';
    toutChip.setAttribute('data-mv', 'transfer_out');
    toutChip.setAttribute('data-orig-label', 'Transfer out');
    toutChip.setAttribute('onclick', "_qnrrListFilter('transfer_out',this)");
    toutChip.textContent = 'Transfer out';
    toutChip.style.display = 'none'; // hidden until count > 0
    filterBar.appendChild(toutChip);
  }
  // v6-fix: transfer_in chip was never added anywhere (static HTML or injected) --
  // only transfer_out got this treatment in v776. Chart view has always shown
  // Transfer in correctly (via _qnrrRenderBreakdown), but the list view had no way
  // to filter down to it since the chip itself didn't exist.
  if (filterBar && !filterBar.querySelector('[data-mv="transfer_in"]')) {
    var tinChip = document.createElement('button');
    tinChip.className = 'qnrr-chip qnrr-tin-chip';
    tinChip.setAttribute('data-mv', 'transfer_in');
    tinChip.setAttribute('data-orig-label', 'Transfer in');
    tinChip.setAttribute('onclick', "_qnrrListFilter('transfer_in',this)");
    tinChip.textContent = 'Transfer in';
    tinChip.style.display = 'none'; // hidden until count > 0
    filterBar.appendChild(tinChip);
  }

  document.querySelectorAll('.qnrr-list-filter-bar .qnrr-chip').forEach(function(btn){
    var onclick = btn.getAttribute('onclick') || '';
    var mvMatch = onclick.match(/'([a-z_]+)'/);
    var mv = mvMatch ? mvMatch[1] : null;
    if (!mv) return;
    var cnt = mvCounts[mv] || 0;
    var origText = btn.dataset.origLabel || btn.textContent.replace(/\s*\d+$/, '').trim();
    btn.dataset.origLabel = origText;
    btn.textContent = cnt > 0 ? origText + ' ' + cnt : origText;
    // Hide chip if zero count and not 'all'
    btn.style.display = (mv !== 'all' && cnt === 0) ? 'none' : '';
  });

  // Build outletNameMap once — ไม่ build ซ้ำใน loop
  var outletNameMap2 = {};
  if (typeof bulkOutletsData !== 'undefined') {
    Object.values(bulkOutletsData).forEach(function(mo){
      Object.values(mo).forEach(function(arr){
        if (!Array.isArray(arr)) return;
        arr.forEach(function(o){ if (o.outlet_id && o.outlet_name) outletNameMap2[String(o.outlet_id)] = o.outlet_name; });
      });
    });
  }

  var _lastMonth = QNRR_CFG.q_months[QNRR_CFG.q_months.length - 1];
  var partialTilde = (_data.by_month[_lastMonth] && _data.by_month[_lastMonth].is_partial) ? '~' : '';
  var COL_W = 42;

  // ── Sticky month header (outside account tables) ─────────────────────────
  // header row ครอบทั้ง list — align กับ table colgroup (auto + 4×42px)
  // ใช้ div+grid ไม่ใช้ table เพราะ account name col width เปลี่ยนตาม screen
  var partialJun = _data.by_month[_lastMonth] && _data.by_month[_lastMonth].is_partial;
  var listMoHdrs = [QNRR_CFG.months_th[QNRR_CFG.base_month] || QNRR_CFG.base_month]
    .concat(QNRR_CFG.q_months.map(function(m, i){
      return (QNRR_CFG.months_th[m] || m) + (i === QNRR_CFG.q_months.length-1 && partialJun ? '~' : '');
    }));
  // header: sticky เหนือ account list — column-align grid มี 4 fixed cols = COL_W px ทางขวา
  var headerHtml = '<div class="qnrr-list-mo-hdr">' +
    '<div class="qnrr-list-mo-hdr-name"></div>' +
    listMoHdrs.map(function(mo){
      return '<div class="qnrr-list-mo-hdr-cell">' + mo + '</div>';
    }).join('') +
  '</div>';

  var html = headerHtml;
  filteredAccts.forEach(function(aid){
    var a = byAcct[aid];

    var outletIds = Object.keys(a.outlets).filter(function(oid){
      if (_listFilter === 'all') return true;
      return _domMv(a.outlets[oid]) === _listFilter;
    });
    if (!outletIds.length) return;

    outletIds.sort(function(x,y){
      var xd=_domMv(a.outlets[x]), yd=_domMv(a.outlets[y]);
      var xB=(xd==='core_nrr_churn'||xd==='transfer_out');
      var yB=(yd==='core_nrr_churn'||yd==='transfer_out');
      if (xB!==yB) return xB?1:-1;
      return (a.outlets[y].gmv[QNRR_CFG.q_months[0]]||0)-(a.outlets[x].gmv[QNRR_CFG.q_months[0]]||0);
    });

    var acctId = 'qnrr-olrows-' + aid.replace(/[^a-z0-9]/gi,'_');

    html += '<div class="qnrr-acct-hdr expanded" onclick="_qnrrToggleAcctRows(\'' + acctId + '\',this)">' +
      '<div class="qnrr-acct-hdr-name">' + _esc(a.name) + '</div>' +
      '<div class="qnrr-acct-hdr-right">' +
        '<div class="qnrr-acct-hdr-tot">' + outletIds.length + ' outlets</div>' +
        '<svg class="qnrr-hdr-chev" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</div>' +
    '</div>';
    html += '<div class="qnrr-ol-rows" id="' + acctId + '">' +
      '<table class="qnrr-acct-tbl">' +
      '<colgroup>' +
        '<col style="width:auto">' +  // name col flexible
        ALL_MONTHS.map(function(){ return '<col style="width:' + COL_W + 'px">'; }).join('') +
      '</colgroup>' +
      '<tbody>';

    outletIds.forEach(function(oid){
      var od = a.outlets[oid];
      var oName  = outletNameMap2[String(oid)] || od.name || String(oid);
      var domMv  = _domMv(od);
      var cfg    = MV_CFG[domMv] || {color:'rgba(255,255,255,.3)'};
      var dotCol = cfg.color === 'ghost' ? 'rgba(180,180,200,.40)' : cfg.color;

      var cells = ALL_MONTHS.map(function(m){
        var v = od.gmv[m] || 0;
        var isBase = (m === QNRR_CFG.base_month);
        var isZero = !isBase && v===0;
        var isHi   = !isBase && v>0 && od.gmv[QNRR_CFG.base_month]>0 && v > od.gmv[QNRR_CFG.base_month]*1.05;
        var cls    = isBase?'base-col':isZero?'zero-col':isHi?'hi-col':'';
        var disp   = isZero ? '✕' : (v>0 ? _fmtM(v) : '—');
        return '<td class="' + cls + '">' + disp + '</td>';
      }).join('');

      html +=
        '<tr>' +
          '<td class="qnrr-ol-name-cell">' +
            '<span class="qnrr-ol-dot2" style="background:' + dotCol + '"></span>' +
            '<span class="qnrr-ol-name2">' + _esc(String(oName).slice(0,32)) + '</span>' +
          '</td>' +
          cells +
        '</tr>';
    });

    html += '</tbody></table></div>';
  }); // end filteredAccts.forEach

  if (!html) html = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,.52);font-size:var(--text-sm)">ไม่มี outlet ใน filter นี้</div>';
  wrap.innerHTML = html;
}
window._qnrrRenderList = _qnrrRenderList;

function _qnrrToggleAcctRows(id, hdr){
  var el = document.getElementById(id);
  if (!el) return;
  var open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (hdr) hdr.classList.toggle('expanded', !open);
}
window._qnrrToggleAcctRows = _qnrrToggleAcctRows;

})();



