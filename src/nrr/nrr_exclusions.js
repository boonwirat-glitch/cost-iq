// ── nrr_exclusions.js — Waived Account (NRR Exclusion) feature ───────────
// Reads/writes the `nrr_exclusions` Supabase table (shared with Sense —
// Sense's own request/approve UI has been retired in favor of this one,
// per the 2026-07-14 waived-account plan; Sense's engine still READS this
// table via _nrrAccountWaivedForPeriod in src/07a_commission_engine.js).
//
// Same defensive pattern as nrr_notes.js: if the table/RLS isn't reachable,
// set nrrExclusionsAvailable = false once and every affordance hides
// itself rather than showing a broken control.
//
// nrrAccountWaivedForPeriod(accountId, periodMonth) is the one shared
// predicate nrr_logic.js's _qnrrCompute/nrrComputeBucket/nrrComputeRowsPool
// call — must be loaded (nrrFetchExclusions) BEFORE nrrRenderAll() ever
// runs, same timing requirement as nrrFetchCommissionSnapshots (see
// nrrRefresh() in nrr_view.js).

var nrrExclusionsAvailable = null; // null = not checked yet, true/false once known
var nrrExclusionsCache = []; // raw rows for the current quarter's months

var NRR_EXCLUSION_REASONS = [
  { code: 'renovation_closed',   label: 'ร้านปิดปรับปรุงชั่วคราว' },
  { code: 'school_term_break',   label: 'โรงเรียนปิดเทอม' },
  { code: 'business_closed',     label: 'ธุรกิจปิดกิจการ' },
  { code: 'overdue_debt',        label: 'ค้างชำระหนี้เกิน 1 ล้านบาท' }
];
window.NRR_EXCLUSION_REASONS = NRR_EXCLUSION_REASONS;

function nrrExclusionReasonLabel(code) {
  var found = NRR_EXCLUSION_REASONS.find(function (r) { return r.code === code; });
  return found ? found.label : (code || '—');
}
window.nrrExclusionReasonLabel = nrrExclusionReasonLabel;

function nrrExclusionStatusLabel(status) {
  if (status === 'approved') return 'อนุมัติแล้ว';
  if (status === 'rejected') return 'ปฏิเสธ';
  if (status === 'revoked') return 'เพิกถอนแล้ว';
  if (status === 'submitted') return 'รออนุมัติ';
  return status || '—';
}
window.nrrExclusionStatusLabel = nrrExclusionStatusLabel;

async function nrrFetchExclusions(force) {
  if (!force && nrrExclusionsAvailable === true) return nrrExclusionsCache;
  if (!supa) { nrrExclusionsAvailable = false; return nrrExclusionsCache; }
  try {
    var resp = await supa.from('nrr_exclusions')
      .select('id,period_month,account_id,outlet_id,target_kam_email,target_tl_email,reason_code,reason_text,status,requested_by,requested_at,reviewed_by,reviewed_at,review_note,base_gmv,estimated_base_gmv')
      .in('period_month', QNRR_CFG.q_months);
    if (resp.error) throw resp.error;
    nrrExclusionsAvailable = true;
    nrrExclusionsCache = resp.data || [];
  } catch (e) {
    // Table missing, RLS denies, or any other error — feature unavailable,
    // fail quiet (same convention as nrr_notes.js).
    nrrExclusionsAvailable = false;
    console.warn('[nrr] exclusions unavailable:', e.message || e);
  }
  return nrrExclusionsCache;
}
window.nrrFetchExclusions = nrrFetchExclusions;

// The one shared predicate every NRR compute function in nrr_logic.js calls.
// v866 (outlet-level waiving): a row with outlet_id set is scoped to ONLY
// that outlet -- never falls back to matching by account_id alone, or an
// outlet-scoped waiver would over-exclude every other outlet under the
// same account. A row with outlet_id null is a whole-account waiver.
function nrrAccountWaivedForPeriod(accountId, periodMonth, outletId) {
  if (!accountId || !periodMonth) return false;
  return (nrrExclusionsCache || []).some(function (x) {
    if (x.status !== 'approved' || x.period_month !== periodMonth) return false;
    if (x.outlet_id) return !!outletId && x.outlet_id === outletId;
    return x.account_id === accountId;
  });
}
window.nrrAccountWaivedForPeriod = nrrAccountWaivedForPeriod;

function nrrExclusionsForAccount(accountId) {
  return (nrrExclusionsCache || []).filter(function (x) { return x.account_id === accountId; });
}
window.nrrExclusionsForAccount = nrrExclusionsForAccount;

// "Today's" period_month (lag-1, same convention as Sense's
// _nrrExclusionCurrentPeriod), clamped to the active quarter. Deliberately
// independent of any specific KAM's _qnrrCompute result -- the account
// page previously derived this via nrrCurrentPeriod(nrrKamResult(kamEmail)),
// which silently returned null (hiding the request button entirely, no
// error) whenever that KAM had no rows in kam_rep_view.csv for any reason.
// Requesting a waiver for "this month" shouldn't depend on whether that
// KAM's cohort happened to compute successfully.
function nrrExclusionCurrentPeriod() {
  var now = new Date();
  var lag1 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  var lagYM = lag1.getFullYear() + '-' + String(lag1.getMonth() + 1).padStart(2, '0');
  var q = QNRR_CFG.q_months;
  return q.indexOf(lagYM) > -1 ? lagYM : q[q.length - 1];
}
window.nrrExclusionCurrentPeriod = nrrExclusionCurrentPeriod;

// How many distinct accounts within a given set of rows (e.g. one
// by_month[period].rows array from any _qnrrCompute/nrrComputeBucket/
// nrrComputeRowsPool result) are waived for that period -- used to surface
// a visible "N ร้านถูกยกเว้น" indicator on the Outlet Movement chart/table,
// since the waiver otherwise only shows up as a silent shift in %NRR with
// no on-screen explanation (2026-07-14 user report: "how do I see an
// adjustment was made on this page").
function nrrWaivedAccountCountForRows(rows, periodMonth) {
  if (!rows || !rows.length || typeof nrrAccountWaivedForPeriod !== 'function') return 0;
  var seen = {}; var count = 0;
  rows.forEach(function (r) {
    if (seen[r.account_id]) return;
    seen[r.account_id] = true;
    // Pass r.outlet_id too -- an outlet-scoped waiver only matches when the
    // caller supplies the matching outlet_id (see nrrAccountWaivedForPeriod);
    // omitting it here would silently undercount outlet-level waivers.
    if (nrrAccountWaivedForPeriod(r.account_id, periodMonth, r.outlet_id)) count++;
  });
  return count;
}
window.nrrWaivedAccountCountForRows = nrrWaivedAccountCountForRows;

// A period is locked once ANY commission_payout_snapshots row for it is
// 'final' — same signal Sense's own lock/compute cycle uses (confirmed
// live: May/June 2026 already 'final', July onward not yet). Reuses
// nrr_commission.js's existing fetcher/cache rather than a second query.
function nrrIsPeriodLocked(periodMonth) {
  if (!nrrCommSnapshots || !nrrCommSnapshots.loaded) return false; // unknown -> don't block
  return (nrrCommSnapshots.rows || []).some(function (r) {
    return r.period_month === periodMonth && r.snapshot_status === 'final';
  });
}
window.nrrIsPeriodLocked = nrrIsPeriodLocked;

async function nrrRequestExclusion(accountId, periodMonth, reasonCode, reasonText, targetKamEmail, targetTlEmail, baseGmv, outletId) {
  if (!supa || !nrrProfile) return { ok: false, error: 'not_authenticated' };
  if (nrrIsPeriodLocked(periodMonth)) return { ok: false, error: 'period_locked' };
  // "Already requested" is scoped to the EXACT scope being requested now --
  // matches the DB's two partial unique indexes (one whole-account row per
  // account+month, one row per outlet+month) -- a different outlet under
  // the same account, or the whole account itself, can still get its own
  // independent request even if some other scope already has one.
  if (nrrExclusionsForAccount(accountId).some(function (x) {
    if (x.period_month !== periodMonth || x.status === 'rejected') return false;
    return outletId ? x.outlet_id === outletId : !x.outlet_id;
  })) {
    return { ok: false, error: 'already_requested' };
  }
  try {
    var row = {
      period_month: periodMonth,
      account_id: accountId,
      outlet_id: outletId || null,
      target_kam_email: targetKamEmail || null,
      target_tl_email: targetTlEmail || null,
      reason_code: reasonCode,
      reason_text: reasonText || null,
      status: 'submitted',
      requested_by: nrrProfile.email,
      requested_at: new Date().toISOString(),
      base_gmv: baseGmv || null,
      estimated_base_gmv: baseGmv || null
    };
    var resp = await supa.from('nrr_exclusions').insert(row).select('*').single();
    if (resp.error) throw resp.error;
    nrrExclusionsCache.push(resp.data || row);
    return { ok: true, row: resp.data || row };
  } catch (e) {
    console.warn('[nrr] exclusion request failed', e);
    return { ok: false, error: e.message || String(e) };
  }
}
window.nrrRequestExclusion = nrrRequestExclusion;

// Admin-only in practice — also enforced at the RLS layer (a non-admin's
// UPDATE attempt that would move status away from 'submitted' is rejected
// by the DB itself, per the 2026-07-14 migration), this app-level check is
// just so the button never appears to a TL in the first place.
async function nrrReviewExclusion(id, status, reviewNote) {
  if (!supa || !nrrProfile || nrrProfile.role !== 'admin') return { ok: false, error: 'not_authorized' };
  try {
    var resp = await supa.from('nrr_exclusions')
      .update({ status: status, reviewed_by: nrrProfile.email, reviewed_at: new Date().toISOString(), review_note: reviewNote || null })
      .eq('id', id)
      .select('*')
      .single();
    if (resp.error) throw resp.error;
    nrrExclusionsCache = (nrrExclusionsCache || []).map(function (r) { return r.id === id ? (resp.data || Object.assign({}, r, { status: status })) : r; });
    return { ok: true };
  } catch (e) {
    console.warn('[nrr] exclusion review failed', e);
    return { ok: false, error: e.message || String(e) };
  }
}
window.nrrReviewExclusion = nrrReviewExclusion;
