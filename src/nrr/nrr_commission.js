// ── nrr_commission.js — commission $ tie-in ──────────────────────────────
// Deliberately does NOT re-implement _commBuildKamPayout/_commBuildTlPayout
// (src/07a_commission_engine.js) — that engine pulls in most of Sense's
// global state (bulkUpsellData, portviewBulkData, governance policy from
// Supabase, gate/cap rules...) and re-deriving it here would risk getting
// real payout numbers subtly wrong outside its native environment.
//
// Instead: query commission_payout_snapshots directly, the SAME table and
// SAME query shape src/dashboard/dash_commission.js already uses. These
// rows are the authoritative, pre-computed output of that engine — under
// quarterly commission mode (confirmed live in the codebase, v829+), each
// period_month's snapshot already reflects that month's payout computed
// from the current quarter's %NRR. We read, never recompute.
//
// Caveat surfaced in the UI (section 8 methodology note): a period_month's
// payout_amount is that MONTH's installment under quarterly NRR mode, not
// a lump quarter-end total — commission is paid out monthly all quarter.

var nrrCommSnapshots = null; // { byEmail: {email: [rows]} , loaded }

async function nrrFetchCommissionSnapshots() {
  if (nrrCommSnapshots && nrrCommSnapshots.loaded) return nrrCommSnapshots;
  if (!supa) { nrrCommSnapshots = { byEmail: {}, loaded: false, error: 'no_auth' }; return nrrCommSnapshots; }
  try {
    var resp = await supa.from('commission_payout_snapshots')
      .select('id,period_month,beneficiary_role,beneficiary_email,team_lead_email,raw_nrr_pct,governed_nrr_pct,payout_amount,snapshot_status,breakdown,updated_at')
      .in('period_month', QNRR_CFG.q_months);
    var rows = resp.data || [];
    var byEmail = {};
    rows.forEach(function (r) {
      var key = r.beneficiary_email;
      if (!key) return;
      if (!byEmail[key]) byEmail[key] = [];
      byEmail[key].push(r);
    });
    nrrCommSnapshots = { byEmail: byEmail, rows: rows, loaded: true };
  } catch (e) {
    console.warn('[nrr] commission snapshot fetch failed', e);
    nrrCommSnapshots = { byEmail: {}, loaded: false, error: e.message };
  }
  return nrrCommSnapshots;
}
window.nrrFetchCommissionSnapshots = nrrFetchCommissionSnapshots;

// Latest available quarter-month snapshot for one beneficiary email.
function nrrLatestSnapshotFor(email) {
  if (!nrrCommSnapshots || !nrrCommSnapshots.loaded) return null;
  var rows = (nrrCommSnapshots.byEmail[email] || []).slice();
  if (!rows.length) return null;
  rows.sort(function (a, b) { return a.period_month < b.period_month ? 1 : -1; });
  return rows[0];
}
window.nrrLatestSnapshotFor = nrrLatestSnapshotFor;

// Sum of latest-available-month payouts across a list of emails (used for
// the org/team commission KPI tiles in section 5).
function nrrSumLatestPayouts(emails) {
  var total = 0; var found = 0; var missing = 0;
  emails.forEach(function (email) {
    var snap = nrrLatestSnapshotFor(email);
    if (snap && snap.payout_amount != null) { total += Number(snap.payout_amount) || 0; found++; }
    else missing++;
  });
  return { total: total, found: found, missing: missing };
}
window.nrrSumLatestPayouts = nrrSumLatestPayouts;

// All available quarter-month snapshots for one email, keyed by period_month
// (nrrLatestSnapshotFor only returns the single latest — the trend strip
// needs all three quarter months to draw its bars).
function nrrSnapshotsForEmailAcrossMonths(email) {
  var out = {};
  if (!nrrCommSnapshots || !nrrCommSnapshots.loaded) return out;
  (nrrCommSnapshots.byEmail[email] || []).forEach(function (r) { out[r.period_month] = r; });
  return out;
}
window.nrrSnapshotsForEmailAcrossMonths = nrrSnapshotsForEmailAcrossMonths;

// ── Live rates/thresholds (target_settings) — footnote only, never used to
// alter a displayed payout number. Mirrors 07a_commission_engine.js's
// _commGetConfig key pattern exactly: '{metricCode}_params' -> JSON object.
var nrrCommRatesCache = null; // { byKey: {key: parsedValue}, loaded }

async function nrrFetchCommissionRates() {
  if (nrrCommRatesCache && nrrCommRatesCache.loaded) return nrrCommRatesCache;
  if (!supa) { nrrCommRatesCache = { byKey: {}, loaded: false, error: 'no_auth' }; return nrrCommRatesCache; }
  try {
    var resp = await supa.from('target_settings').select('key,value');
    var rows = resp.data || [];
    var byKey = {};
    rows.forEach(function (s) {
      if (/_params$/.test(s.key)) {
        try { byKey[s.key] = JSON.parse(s.value); }
        catch (e) { byKey[s.key] = s.value; }
      } else {
        byKey[s.key] = s.value;
      }
    });
    nrrCommRatesCache = { byKey: byKey, loaded: true };
  } catch (e) {
    console.warn('[nrr] target_settings fetch failed', e);
    nrrCommRatesCache = { byKey: {}, loaded: false, error: e.message };
  }
  return nrrCommRatesCache;
}
window.nrrFetchCommissionRates = nrrFetchCommissionRates;

function nrrCommRateGet(metricCode, paramName, fallback) {
  var raw = nrrCommRatesCache && nrrCommRatesCache.byKey ? nrrCommRatesCache.byKey[metricCode + '_params'] : null;
  if (raw && typeof raw === 'object' && raw[paramName] != null) return raw[paramName];
  return fallback;
}
window.nrrCommRateGet = nrrCommRateGet;

// ── Pace-based estimate for periods with no locked snapshot yet ─────────
// Ported from src/dashboard/dash_commission.js's estimateTLCommission() /
// _getSalesTLBrackets() — same bracket table, same math. Deliberately reads
// GMV/baseline from /nrr's own already-loaded aggregates (nrrMonthTriple)
// rather than adding a parallel data fetch. This is a guess for UNLOCKED
// periods only — it must never be confused with a real snapshot payout.
function nrrTLBrackets() {
  return [
    { min: 0,   max: 84,  rate: 0,     label: '< 85%' },
    { min: 85,  max: 89,  rate: .0055, label: '85–90%' },
    { min: 90,  max: 94,  rate: .007,  label: '90–95%' },
    { min: 95,  max: 99,  rate: .008,  label: '95–100%' },
    { min: 100, max: 119, rate: .010,  label: '100–120%' },
    { min: 120, max: 999, rate: .012,  label: '≥ 120%' }
  ];
}
window.nrrTLBrackets = nrrTLBrackets;

function nrrEstimateCommission(rows) {
  var total = rows.reduce(function (s, g) { return s + (g.totalGMV || 0); }, 0);
  var baseline = rows.reduce(function (s, g) { return s + (g.baseline || 0); }, 0);
  var pace = baseline > 0 ? Math.round(total / baseline * 100) : 0;
  var brackets = nrrTLBrackets();
  var bracket = brackets.filter(function (b) { return pace >= b.min && pace <= b.max; })[0] || brackets[0];
  return { pace: pace, total: total, baseline: baseline, bracket: bracket, est: Math.round(total * bracket.rate) };
}
window.nrrEstimateCommission = nrrEstimateCommission;

// ── Commission V2 — P1/P3 upsell classification ──────────────────────────
// Verbatim port of _commComputeUpsellSku() (07a_commission_engine.js:176-318)
// against the lean per-KAM bundle nrrFetchUpsellBundle() builds. Read-only,
// on-demand, drill-down-supporting math — never used to alter a displayed
// payout number (that always comes from the locked snapshot or the pace
// estimate). expansionOutletIds: Set<string> of outlet IDs already earning
// the 0.5% outlet commission, excluded here — /nrr derives this for free
// from its own already-loaded QNRR rows (movement_type === 'expansion'),
// no extra fetch needed.
function nrrComputeUpsellSku(expansionOutletIds, bundle, baseMonthIso) {
  var EMPTY = { p1: { gmv: 0, comm: 0, groups: [] }, p3: { gmv_incremental: 0, comm: 0, groups: [] },
                total_comm: 0, total_gmv_eligible: 0 };
  if (!bundle || !bundle.loaded) return EMPTY;
  var expIds = expansionOutletIds instanceof Set ? expansionOutletIds : new Set();
  var data = bundle.data || {};
  var baselineGroups = bundle.baselineGroups || {};

  var p1Rate    = nrrCommRateGet('upsell_sku', 'p1_rate', 0.01);
  var p3Rate    = nrrCommRateGet('upsell_sku', 'p3_rate', 0.01);
  var p3Thresh  = nrrCommRateGet('upsell_sku', 'p3_threshold_pct', 2.00);
  var p3MinIncr = nrrCommRateGet('upsell_sku', 'p3_min_incremental', 8000);
  var p1MinGmv  = nrrCommRateGet('upsell_sku', 'p1_min_gmv', 5000);

  var currLabel = nrrCommCurrentMonthLabel();
  var p3Labels = nrrP3WindowLabels(baseMonthIso, 3);

  var p1Groups = [], p3Groups = [];

  Object.keys(data).forEach(function (accountId) {
    var outletMap = data[accountId];
    var baselineByOutlet = baselineGroups[accountId] || {};

    Object.keys(outletMap).forEach(function (outletId) {
      if (expIds.has(String(outletId))) return; // earns 0.5% via outlet commission instead
      var outletGroups = outletMap[outletId];
      var outletBaseline = baselineByOutlet[outletId] || {};

      Object.keys(outletGroups).forEach(function (groupKey) {
        var monthData = outletGroups[groupKey];
        var currRow = monthData[currLabel];
        if (!currRow) return;

        var rawTotalGmv = currRow.totalGmv || 0;
        var rawExistingGmv = currRow.existingGmv || 0;
        var isP1 = !outletBaseline[groupKey];

        if (isP1) {
          if (rawTotalGmv >= p1MinGmv) {
            var p1Comm = rawTotalGmv * p1Rate;
            p1Groups.push({ accountId: accountId, outletId: outletId, groupKey: groupKey, total_gmv: rawTotalGmv, commission: p1Comm });
          }
        } else {
          var maxBaseline = 0, maxBaselineMonth = p3Labels[0];
          p3Labels.forEach(function (lbl) {
            var lRow = monthData[lbl];
            if (!lRow) return;
            var d = nrrDaysInLabel(lbl);
            var norm30 = d > 0 ? lRow.totalGmv / d * 30 : lRow.totalGmv;
            if (norm30 > maxBaseline) { maxBaseline = norm30; maxBaselineMonth = lbl; }
          });
          if (rawExistingGmv > maxBaseline * p3Thresh) {
            var incremental = rawExistingGmv - maxBaseline;
            if (incremental >= p3MinIncr) {
              var p3Comm = incremental * p3Rate;
              p3Groups.push({ accountId: accountId, outletId: outletId, groupKey: groupKey,
                existing_curr: rawExistingGmv, max_baseline: maxBaseline, max_baseline_month: maxBaselineMonth,
                incremental: incremental, commission: p3Comm });
            }
          }
        }
      });
    });
  });

  var p1Gmv = p1Groups.reduce(function (s, g) { return s + g.total_gmv; }, 0);
  var p1Comm = p1Groups.reduce(function (s, g) { return s + g.commission; }, 0);
  var p3Incr = p3Groups.reduce(function (s, g) { return s + g.incremental; }, 0);
  var p3Comm = p3Groups.reduce(function (s, g) { return s + g.commission; }, 0);

  return {
    p1: { gmv: p1Gmv, comm: p1Comm, groups: p1Groups },
    p3: { gmv_incremental: p3Incr, comm: p3Comm, groups: p3Groups },
    total_comm: p1Comm + p3Comm,
    total_gmv_eligible: p1Gmv + p3Incr
  };
}
window.nrrComputeUpsellSku = nrrComputeUpsellSku;

// ── Full Table view (history) — arbitrary period, not limited to the
// current quarter's QNRR_CFG.q_months. Same table/columns as
// nrrFetchCommissionSnapshots, just without the quarter filter, so any
// locked/draft period ever computed in Sense can be browsed here. Cached
// per period_month so switching the dropdown back and forth is instant.
var nrrCommAvailablePeriods = null; // [ '2026-06', '2026-05', ... ] desc
var nrrCommPeriodCache = {}; // { [period_month]: { rows, loaded } }

async function nrrFetchAvailablePeriods() {
  if (nrrCommAvailablePeriods) return nrrCommAvailablePeriods;
  if (!supa) return [];
  try {
    var resp = await supa.from('commission_payout_snapshots').select('period_month');
    var seen = {};
    (resp.data || []).forEach(function (r) { if (r.period_month) seen[r.period_month] = true; });
    nrrCommAvailablePeriods = Object.keys(seen).sort().reverse();
  } catch (e) {
    console.warn('[nrr] failed to load available commission periods', e);
    nrrCommAvailablePeriods = [];
  }
  return nrrCommAvailablePeriods;
}
window.nrrFetchAvailablePeriods = nrrFetchAvailablePeriods;

async function nrrFetchSnapshotsForPeriod(periodMonth) {
  if (nrrCommPeriodCache[periodMonth] && nrrCommPeriodCache[periodMonth].loaded) return nrrCommPeriodCache[periodMonth];
  if (!supa) return { rows: [], loaded: false, error: 'no_auth' };
  try {
    var resp = await supa.from('commission_payout_snapshots')
      .select('id,period_month,beneficiary_role,beneficiary_email,team_lead_email,raw_nrr_pct,governed_nrr_pct,payout_amount,snapshot_status,breakdown,updated_at')
      .eq('period_month', periodMonth);
    var out = { rows: resp.data || [], loaded: true };
    nrrCommPeriodCache[periodMonth] = out;
    return out;
  } catch (e) {
    console.warn('[nrr] failed to load snapshots for ' + periodMonth, e);
    return { rows: [], loaded: false, error: e.message };
  }
}
window.nrrFetchSnapshotsForPeriod = nrrFetchSnapshotsForPeriod;
