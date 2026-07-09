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

// ── Estimate engine v2 (2026-07-09) — mirrors the REAL payout structure ──
// The v1 estimator (ported from the retired TL dashboard) was a
// %-of-team-GMV scheme from an older Sales-TL plan — against today's
// fixed-amount tier plans it produced absurd numbers (฿834K for a TL whose
// real payout tops out at ฿50K×mult). v2 replicates what the Cockpit's
// engine actually does at Compute time, from the same live sources:
//
//   TL : NRR tier payout (commission_rule_tiers, e.g. 0/8K/12K/30K/50K)
//        × team upsell multiplier (tl_upsell_mult_params tiers on
//          team upsell GMV ÷ team base GMV, from sense_upsell_team.csv)
//   KAM: NRR tier payout (0/5K/10K)
//        + P1/P3 SKU comm + outlet comm (rates × sense_upsell_team.csv GMVs)
//        × NRR gate cap (gmv_gate_params: <95%→0, 95–98%→cap_1, ≥98%→1)
//        — handover retention NOT estimated (needs per-account handover
//          data); flagged in the returned note.
//
// Still a clearly-labeled ESTIMATE for unlocked periods only — %NRR is the
// MTD run-rate, upsell GMVs refresh on the team CSV's cadence.

// Plan tier tables + per-period assignments (4 small tables, fetched once).
var nrrCommPlansCache = { tiersByPlan: {}, assignments: {}, loaded: false };
async function nrrFetchCommissionPlans() {
  if (nrrCommPlansCache.loaded) return nrrCommPlansCache;
  try {
    var res = await Promise.all([
      supa.from('commission_plans').select('id,plan_code,beneficiary_role,status'),
      supa.from('commission_rules').select('id,plan_id,metric_code,active'),
      supa.from('commission_rule_tiers').select('rule_id,tier_order,min_value,max_value,payout_value'),
      supa.from('commission_plan_assignments').select('period_month,assignment_scope,assignee_key,plan_code')
    ]);
    var plans = res[0].data || [], rules = res[1].data || [];
    var tiers = res[2].data || [], assigns = res[3].data || [];
    var planById = {};
    plans.forEach(function (p) { planById[p.id] = p; });
    var tiersByPlan = {};
    rules.forEach(function (r) {
      if (r.metric_code !== 'nrr' || r.active === false) return;
      var plan = planById[r.plan_id];
      if (!plan) return;
      tiersByPlan[plan.plan_code] = tiers
        .filter(function (t) { return t.rule_id === r.id; })
        .sort(function (a, b) { return (a.tier_order || 0) - (b.tier_order || 0); });
    });
    var assignments = {};
    assigns.forEach(function (a) {
      assignments[a.period_month + '|' + a.assignment_scope + '|' + a.assignee_key] = a.plan_code;
    });
    nrrCommPlansCache = { tiersByPlan: tiersByPlan, assignments: assignments, loaded: true };
  } catch (e) {
    console.warn('[nrr] commission plans fetch failed', e);
    nrrCommPlansCache = { tiersByPlan: {}, assignments: {}, loaded: false, error: e.message };
  }
  return nrrCommPlansCache;
}
window.nrrFetchCommissionPlans = nrrFetchCommissionPlans;

// Engine's hardcoded fallback tiers (_commDefaultTiers) — used only if the
// plan tables can't be fetched, so the estimate degrades to STD not to 0.
function nrrCommDefaultTiers(role) {
  return role === 'tl'
    ? [{ min_value: null, max_value: 98.5, payout_value: 0 },
       { min_value: 98.5, max_value: 99,   payout_value: 0 },
       { min_value: 99,   max_value: 100,  payout_value: 8000 },
       { min_value: 100,  max_value: 102,  payout_value: 12000 },
       { min_value: 102,  max_value: 104,  payout_value: 30000 },
       { min_value: 104,  max_value: null, payout_value: 50000 }]
    : [{ min_value: null, max_value: 100,  payout_value: 0 },
       { min_value: 100,  max_value: 103,  payout_value: 5000 },
       { min_value: 103,  max_value: null, payout_value: 10000 }];
}

// Tier match — same open-interval convention as _commMatchTierByCode:
// pct >= min (null = open) && pct < max (null = open).
function nrrCommTierPayout(role, email, period, pct) {
  if (pct == null || isNaN(pct)) return 0;
  var std = role === 'tl' ? 'TL_NRR_STD' : 'KAM_NRR_STD';
  var code = nrrCommPlansCache.assignments[period + '|' + role + '|' + email] || std;
  var tiers = nrrCommPlansCache.tiersByPlan[code] || nrrCommPlansCache.tiersByPlan[std];
  if (!tiers || !tiers.length) tiers = nrrCommDefaultTiers(role);
  for (var i = 0; i < tiers.length; i++) {
    var t = tiers[i];
    var minOk = t.min_value == null || t.min_value === '' || pct >= Number(t.min_value);
    var maxOk = t.max_value == null || t.max_value === '' || pct < Number(t.max_value);
    if (minOk && maxOk) return Number(t.payout_value || 0);
  }
  return 0;
}
window.nrrCommTierPayout = nrrCommTierPayout;

// sense_upsell_team.csv — per-KAM quarter-to-date upsell GMV totals
// (kam_email, p1_gmv, p3_incremental, outlet_gmv, tl_upsell_base). ~100KB.
var nrrUpsellTeamCache = { byEmail: {}, loaded: false };
async function nrrFetchUpsellTeamCsv() {
  if (nrrUpsellTeamCache.loaded) return nrrUpsellTeamCache;
  try {
    var resp = await fetch(R2_BASE + '/sense_upsell_team.csv?cb=' + Date.now());
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var lines = (await resp.text()).split('\n').filter(function (l) { return l.trim(); });
    var byEmail = {};
    for (var i = 1; i < lines.length; i++) {
      var c = parseCSVRow(lines[i]);
      byEmail[(c[0] || '').trim().toLowerCase()] = {
        p1_gmv: parseFloat(c[1]) || 0, p3_incremental: parseFloat(c[2]) || 0,
        outlet_gmv: parseFloat(c[3]) || 0, tl_upsell_base: parseFloat(c[4]) || 0
      };
    }
    nrrUpsellTeamCache = { byEmail: byEmail, loaded: true };
  } catch (e) {
    console.warn('[nrr] sense_upsell_team.csv fetch failed', e);
    nrrUpsellTeamCache = { byEmail: {}, loaded: false, error: e.message };
  }
  return nrrUpsellTeamCache;
}
window.nrrFetchUpsellTeamCsv = nrrFetchUpsellTeamCsv;

// Multiplier tiers from live target_settings (tl_upsell_mult_params),
// engine-default fallback baked in.
function nrrCommTeamMultiplier(upsellPct) {
  var raw = nrrCommRatesCache && nrrCommRatesCache.byKey ? nrrCommRatesCache.byKey.tl_upsell_mult_params : null;
  var tiers = raw && raw.tiers ? raw.tiers : [
    { min_pct: 0, max_pct: 1.99, multiplier: 1.00 }, { min_pct: 2, max_pct: 2.99, multiplier: 1.20 },
    { min_pct: 3, max_pct: 3.99, multiplier: 1.35 }, { min_pct: 4, max_pct: 4.99, multiplier: 1.50 },
    { min_pct: 5, max_pct: null, multiplier: 1.80 }];
  var mult = 1.0;
  tiers.forEach(function (t) {
    if (upsellPct >= (t.min_pct || 0) && (t.max_pct == null || upsellPct <= t.max_pct)) mult = t.multiplier;
  });
  return mult;
}

// pct: governed %NRR for the beneficiary (run-rate for the open month).
function nrrEstimateTlCommission(tlEmail, period, pct) {
  if (pct == null) return null;
  var nrrPayout = nrrCommTierPayout('tl', tlEmail, period, pct);
  var teamUpsell = 0, teamBase = 0;
  (typeof nrrListKamsForTeam === 'function' ? nrrListKamsForTeam(tlEmail) : []).forEach(function (k) {
    var row = nrrUpsellTeamCache.byEmail[(k.email || '').toLowerCase()];
    if (row) teamUpsell += row.tl_upsell_base;
    var kr = nrrKamResult(k.email);
    if (kr) teamBase += kr.base_gmv || 0;
  });
  var upsellPct = teamBase > 0 ? teamUpsell / teamBase * 100 : 0;
  var mult = nrrCommTeamMultiplier(upsellPct);
  return {
    kind: 'tl', pct: pct, nrr_payout: nrrPayout,
    upsell_pct: upsellPct, multiplier: mult,
    est: Math.round(nrrPayout * mult),
    note: 'NRR tier ฿' + nrrPayout.toLocaleString('en-US') + ' × ' + mult + 'x (upsell ทีม ' + upsellPct.toFixed(1) + '%)'
  };
}
window.nrrEstimateTlCommission = nrrEstimateTlCommission;

function nrrEstimateKamCommission(kamEmail, period, pct) {
  if (pct == null) return null;
  var nrrPayout = nrrCommTierPayout('kam', kamEmail, period, pct);
  var row = nrrUpsellTeamCache.byEmail[(kamEmail || '').toLowerCase()] || { p1_gmv: 0, p3_incremental: 0, outlet_gmv: 0 };
  var p1Rate = nrrCommRateGet('upsell_sku', 'p1_rate', 0.01);
  var p3Rate = nrrCommRateGet('upsell_sku', 'p3_rate', 0.01);
  var outRate = nrrCommRateGet('upsell_outlet', 'rate', 0.005);
  var upsellComm = row.p1_gmv * p1Rate + row.p3_incremental * p3Rate + row.outlet_gmv * outRate;
  // NRR gate — same thresholds/caps the engine applies (_commComputeGmvGate)
  var t1 = nrrCommRateGet('gmv_gate', 'threshold_1', 98);
  var t2 = nrrCommRateGet('gmv_gate', 'threshold_2', 95);
  var cap = 1.0;
  if (pct < t2) cap = nrrCommRateGet('gmv_gate', 'cap_2', 0);
  else if (pct < t1) cap = nrrCommRateGet('gmv_gate', 'cap_1', 0.3);
  return {
    kind: 'kam', pct: pct, nrr_payout: nrrPayout, upsell_comm: Math.round(upsellComm), gate_cap: cap,
    est: Math.round((nrrPayout + upsellComm) * cap),
    note: '(NRR ฿' + nrrPayout.toLocaleString('en-US') + ' + upsell ฿' + Math.round(upsellComm).toLocaleString('en-US') + ')' +
      (cap < 1 ? ' × gate ' + cap + 'x' : '') + ' · ยังไม่รวม handover'
  };
}
window.nrrEstimateKamCommission = nrrEstimateKamCommission;

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
