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

// handover_params.gmv_tiers is an array, not a scalar — cannot go through
// nrrCommRateGet above (no Number() coercion needed/wanted here, but keeping
// it as a separate reader mirrors Sense's _commGetHandoverGmvTiers split for
// the same reason: one helper per return shape). Empty/absent => caller
// falls back to the legacy flat 2-tier logic.
function nrrCommRateGetHandoverGmvTiers() {
  var raw = nrrCommRatesCache && nrrCommRatesCache.byKey ? nrrCommRatesCache.byKey['handover_params'] : null;
  return (raw && typeof raw === 'object' && Array.isArray(raw.gmv_tiers)) ? raw.gmv_tiers : [];
}
window.nrrCommRateGetHandoverGmvTiers = nrrCommRateGetHandoverGmvTiers;

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
      // v_catbonus: also pull metric_variant + tier_config so the
      // upsell_gmv/category_bonus map is available to the estimate.
      supa.from('commission_rules').select('id,plan_id,metric_code,metric_variant,active,tier_config'),
      supa.from('commission_rule_tiers').select('rule_id,tier_order,min_value,max_value,payout_value'),
      supa.from('commission_plan_assignments').select('period_month,assignment_scope,assignee_key,plan_code')
    ]);
    var plans = res[0].data || [], rules = res[1].data || [];
    var tiers = res[2].data || [], assigns = res[3].data || [];
    var planById = {};
    plans.forEach(function (p) { planById[p.id] = p; });
    var tiersByPlan = {};
    var catBonusByPlan = {}; // v_catbonus: plan_code -> {categoryRates,groupRates}
    rules.forEach(function (r) {
      var plan = planById[r.plan_id];
      if (!plan) return;
      if (r.metric_code === 'nrr' && r.active !== false) {
        tiersByPlan[plan.plan_code] = tiers
          .filter(function (t) { return t.rule_id === r.id; })
          .sort(function (a, b) { return (a.tier_order || 0) - (b.tier_order || 0); });
      }
      if (r.metric_code === 'upsell_gmv' && r.metric_variant === 'category_bonus' && r.active !== false && r.tier_config) {
        catBonusByPlan[plan.plan_code] = {
          categoryRates: (r.tier_config.category_rates && typeof r.tier_config.category_rates === 'object') ? r.tier_config.category_rates : {},
          groupRates:    (r.tier_config.group_rates    && typeof r.tier_config.group_rates    === 'object') ? r.tier_config.group_rates    : {}
        };
      }
    });
    var assignments = {};
    assigns.forEach(function (a) {
      assignments[a.period_month + '|' + a.assignment_scope + '|' + a.assignee_key] = a.plan_code;
    });
    nrrCommPlansCache = { tiersByPlan: tiersByPlan, assignments: assignments, catBonusByPlan: catBonusByPlan, loaded: true };
  } catch (e) {
    console.warn('[nrr] commission plans fetch failed', e);
    nrrCommPlansCache = { tiersByPlan: {}, assignments: {}, loaded: false, error: e.message };
  }
  return nrrCommPlansCache;
}
window.nrrFetchCommissionPlans = nrrFetchCommissionPlans;

// v_catbonus: KAM scheme's shared per-category/group override map (mirrors
// Sense's _commResolveUpsellRateMap). /nrr's estimate is KAM-focused, so the
// standard KAM plan is the relevant scheme. Empty when unconfigured → base
// rate everywhere (no-op).
function nrrCommCategoryBonus() {
  var byPlan = (nrrCommPlansCache && nrrCommPlansCache.catBonusByPlan) || {};
  return byPlan['KAM_NRR_STD'] || { categoryRates: {}, groupRates: {} };
}
// Effective rate for one line: group override > category override > base.
// A stored 0 is a real choice and must beat base (explicit != null checks).
function nrrCommUpsellRateFor(rateMap, baseRate, category, groupKey) {
  if (rateMap) {
    if (groupKey != null && rateMap.groupRates && rateMap.groupRates[groupKey] != null) return Number(rateMap.groupRates[groupKey]);
    if (category != null && rateMap.categoryRates && rateMap.categoryRates[category] != null) return Number(rateMap.categoryRates[category]);
  }
  return baseRate;
}
window.nrrCommCategoryBonus = nrrCommCategoryBonus;
window.nrrCommUpsellRateFor = nrrCommUpsellRateFor;

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

// v_round: round a percent to 1 decimal before comparing it against a tier
// boundary — the exact twin of Sense's _commTierPct (07a_commission_engine.js).
// These two MUST stay identical: if they drift, Sense and /nrr quote different
// commission for the same person on the same month, and neither is checkable
// against the other. Bush's rule, decided 2026-08-02: what the screen prints
// at 1 decimal is what the payout rules see.
function nrrTierPct(pct) {
  if (pct == null || isNaN(pct)) return pct;
  return Math.round(Number(pct) * 10) / 10;
}
window.nrrTierPct = nrrTierPct;

// Tier match — same open-interval convention as _commMatchTierByCode:
// pct >= min (null = open) && pct < max (null = open).
function nrrCommTierPayout(role, email, period, pct) {
  if (pct == null || isNaN(pct)) return 0;
  pct = nrrTierPct(pct);          // v_round: match Sense before comparing
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

// Full tier ladder with current/next flags + the pp gap to the next tier —
// feeds both the KAM/TL self-view tier chip+progress bar and the drawer's
// "วิธีคิดค่าคอมฯ" table. Reuses the exact same tier source/matching
// convention as nrrCommTierPayout (never a second source of truth).
function nrrCommTierTable(role, email, period, pct) {
  var std = role === 'tl' ? 'TL_NRR_STD' : 'KAM_NRR_STD';
  var code = nrrCommPlansCache.assignments[period + '|' + role + '|' + email] || std;
  var tiers = nrrCommPlansCache.tiersByPlan[code] || nrrCommPlansCache.tiersByPlan[std];
  if (!tiers || !tiers.length) tiers = nrrCommDefaultTiers(role);
  tiers = tiers.slice().sort(function (a, b) { return (Number(a.min_value) || -Infinity) - (Number(b.min_value) || -Infinity); });

  // v_round: compare on the same 1dp-rounded value the payout uses, and reuse
  // it for the gap below — otherwise the ladder could highlight one tier while
  // nrrCommTierPayout pays another
  var cmpPct = nrrTierPct(pct);

  var currentIdx = -1;
  if (cmpPct != null && !isNaN(cmpPct)) {
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      var minOk = t.min_value == null || t.min_value === '' || cmpPct >= Number(t.min_value);
      var maxOk = t.max_value == null || t.max_value === '' || cmpPct < Number(t.max_value);
      if (minOk && maxOk) { currentIdx = i; break; }
    }
  }
  var nextIdx = currentIdx >= 0 && currentIdx < tiers.length - 1 ? currentIdx + 1 : -1;
  var rows = tiers.map(function (t, i) {
    return { min: t.min_value, max: t.max_value, payout: Number(t.payout_value || 0), label: t.payout_label || '',
      isCurrent: i === currentIdx, isNext: i === nextIdx };
  });
  // 1-decimal ceiling (was whole-pp) — "push at least this much more"
  // stays a round-UP (never understate the ask), just finer-grained now
  // that %NRR itself displays to 1 decimal everywhere else.
  // v_round: measure the gap from the ROUNDED pct — that is the value the tier
  // actually judges, so quoting a gap from the raw one would overstate the ask
  var gapPp = (nextIdx >= 0 && cmpPct != null) ? Math.max(0, Math.ceil((Number(tiers[nextIdx].min_value) - cmpPct) * 10) / 10) : null;
  return { tiers: rows, currentTier: currentIdx >= 0 ? rows[currentIdx] : null, nextTier: nextIdx >= 0 ? rows[nextIdx] : null, gapPp: gapPp };
}
window.nrrCommTierTable = nrrCommTierTable;

// Converts an estimate object (nrrEstimateTlCommission/nrrEstimateKamCommission's
// return shape) into an ordered list of "receipt" steps — one line per
// term of the real formula ((nrr_payout [+ upsell_comm]) × gate_cap [×
// team multiplier for TL] + handover.payout) — so the drawer can render
// the exact arithmetic instead of a paraphrased note. drillKey lets the
// renderer wire each line to its matching account-level section (or null
// for lines with no account list, e.g. the NRR tier line itself).
function nrrCommEstimateReceiptSteps(est) {
  if (!est) return [];
  var steps = [{ kind: 'add', first: true, label: 'NRR (' + est.pct + '%)', amount: est.nrr_payout, drillKey: 'nrr' }];
  if (est.kind === 'kam') {
    // v16: every component of the real formula gets its OWN line — always,
    // even at ฿0 — so the receipt never has a missing term and "why is
    // expansion separate from upsell" stops being a question (they're
    // visible siblings). Handover included at ฿0 too ("ไม่มีเดือนนี้").
    // A receipt must ADD UP exactly on screen: the last component absorbs
    // the per-line rounding remainder so Σ(lines) === subtotal to the baht.
    var p1r = est.p1_comm || 0, p3r = est.p3_comm || 0;
    var outR = (est.upsell_comm || 0) - p1r - p3r;
    var hoPay = (est.handover && est.handover.payout) || 0;
    steps.push({ kind: 'add', label: 'Upsell P1 · สินค้าใหม่', amount: p1r, drillKey: 'p1' });
    steps.push({ kind: 'add', label: 'Upsell P3 · สินค้าโต', amount: p3r, drillKey: 'p3' });
    steps.push({ kind: 'add', label: 'Expansion · ร้านขยาย 0.5%', amount: outR, drillKey: 'expansion' });
    // Handover is INSIDE the gate (engine 07a:691) — show it as a component
    // above the subtotal, then multiply the whole subtotal by the gate.
    steps.push({ kind: 'add', label: 'Handover · retention', amount: hoPay,
      meta: est.handover && est.handover.accounts ? est.handover.accounts + ' ร้าน · retention ' + nrrFmtPct(est.handover.retention_pct) : 'ไม่มีเดือนนี้',
      drillKey: est.handover && est.handover.detail && est.handover.detail.length ? 'handover' : null });
    steps.push({ kind: 'subtotal', label: 'รวมก่อน Gate', amount: est.nrr_payout + (est.upsell_comm || 0) + hoPay });
    steps.push({ kind: 'multiply', label: 'NRR Gate (' + nrrFmtPct(est.pct) + ' ' + (est.gate_cap >= 1 ? '≥' : '<') + ' ' + (est.gate_threshold || 98) + '%)', factor: est.gate_cap });
  } else {
    steps.push({ kind: 'multiply', label: 'ตัวคูณ upsell ทีม (' + (est.upsell_pct != null ? est.upsell_pct.toFixed(1) : '0.0') + '% ของฐาน)', factor: est.multiplier, drillKey: 'mult' });
  }
  steps.push({ kind: 'total', label: 'รวมค่าคอมฯ', amount: est.est });
  return steps;
}
window.nrrCommEstimateReceiptSteps = nrrCommEstimateReceiptSteps;

// Same receipt shape, sourced from a LOCKED snapshot's breakdown jsonb
// instead of a live estimate — field names match _commBuildSnapshotRows()
// (07a_commission_engine.js) exactly. Keeps one receipt renderer for both
// locked and unlocked periods — the whole point of this redesign is that
// both look the same.
function nrrCommSnapshotReceiptSteps(bd) {
  if (!bd) return [];
  var steps = [{ kind: 'add', first: true, label: 'NRR (' + nrrFmtPct(bd.nrr_pct) + ')', amount: bd.nrr_payout || 0, drillKey: 'nrr' }];
  if (bd.type === 'kam_full') {
    var sku = bd.upsell_sku || {};
    var upsell = ((sku.p1 && sku.p1.comm) || 0) + ((sku.p3 && sku.p3.comm) || 0) + ((bd.upsell_outlet && bd.upsell_outlet.commission) || 0);
    // Same add-up-exactly rule as the estimate steps: round P1/P3, the
    // Expansion line absorbs the remainder so Σ(lines) === subtotal.
    var p1Comm = Math.round((sku.p1 && sku.p1.comm) || 0);
    var p3Comm = Math.round((sku.p3 && sku.p3.comm) || 0);
    var outletComm = Math.round(upsell) - p1Comm - p3Comm;
    var hoPay = (bd.handover && bd.handover.payout) || 0;
    steps.push({ kind: 'add', label: 'Upsell P1 · สินค้าใหม่', amount: p1Comm, drillKey: 'p1' });
    steps.push({ kind: 'add', label: 'Upsell P3 · สินค้าโต', amount: p3Comm, drillKey: 'p3' });
    steps.push({ kind: 'add', label: 'Expansion · ร้านขยาย 0.5%', amount: outletComm, drillKey: 'expansion' });
    // Handover is INSIDE the gate (engine 07a:691) — component above the
    // subtotal, whole subtotal then ×gate to reach final_payout.
    steps.push({ kind: 'add', label: 'Handover · retention', amount: hoPay,
      meta: bd.handover && bd.handover.accounts ? bd.handover.accounts + ' ร้าน · retention ' + nrrFmtPct(bd.handover.retention_pct) : 'ไม่มีเดือนนี้',
      drillKey: bd.handover && bd.handover.detail && bd.handover.detail.length ? 'handover' : null });
    steps.push({ kind: 'subtotal', label: 'รวมก่อน Gate', amount: (bd.nrr_payout || 0) + upsell + hoPay });
    var gcap = bd.gmv_gate ? bd.gmv_gate.cap_multiplier : 1;
    steps.push({ kind: 'multiply', label: 'NRR Gate' + (bd.nrr_pct != null ? ' (' + nrrFmtPct(bd.nrr_pct) + ')' : ''), factor: gcap });
  } else {
    var mult = bd.upsell_mult;
    steps.push({ kind: 'multiply', label: 'ตัวคูณ upsell ทีม', factor: typeof mult === 'object' ? mult.multiplier : parseFloat(mult) || 1, drillKey: 'mult' });
  }
  steps.push({ kind: 'total', label: 'รวมค่าคอมฯ', amount: bd.final_payout != null ? bd.final_payout : 0 });
  return steps;
}
window.nrrCommSnapshotReceiptSteps = nrrCommSnapshotReceiptSteps;

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

// v_catbonus: sense_upsell_team_groups.csv — group-key-grain P1/P3 GMV per
// (kam, category, group_key). Lets the /nrr headline estimate apply
// per-category bonus rates on the fast path (parity with Sense). Absent →
// nrrEstimateKamCommission falls back to the flat team-scalar multiply.
var nrrUpsellTeamGroupsCache = { byEmail: {}, loaded: false };
async function nrrFetchUpsellTeamGroupsCsv() {
  if (nrrUpsellTeamGroupsCache.loaded) return nrrUpsellTeamGroupsCache;
  try {
    var resp = await fetch(R2_BASE + '/sense_upsell_team_groups.csv?cb=' + Date.now());
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var lines = (await resp.text()).split('\n').filter(function (l) { return l.trim(); });
    var byEmail = {};
    for (var i = 1; i < lines.length; i++) {
      var c = parseCSVRow(lines[i]);
      var em = (c[0] || '').trim().toLowerCase();
      if (!em) continue;
      if (!byEmail[em]) byEmail[em] = [];
      byEmail[em].push({ category: (c[1] || '').trim(), group_key: (c[2] || '').trim(),
        p1_gmv: parseFloat(c[3]) || 0, p3_incremental: parseFloat(c[4]) || 0 });
    }
    nrrUpsellTeamGroupsCache = { byEmail: byEmail, loaded: true };
  } catch (e) {
    // Non-fatal — estimate falls back to the flat scalar path.
    nrrUpsellTeamGroupsCache = { byEmail: {}, loaded: false, error: e.message };
  }
  return nrrUpsellTeamGroupsCache;
}
window.nrrFetchUpsellTeamGroupsCsv = nrrFetchUpsellTeamGroupsCsv;

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

// ── Handover retention — live drill-down for the drawer ─────────────────
// portview_handover.csv is org-wide (all KAMs, one row per handed-over
// account) — fetched once, filtered per-KAM client-side. Mirrors
// _commComputeHandoverRetention's shape/columns exactly (07a_commission_
// engine.js:440) but period-relative (transfer_month = the month BEFORE
// the period being viewed) instead of relative to real "today", since
// /nrr's drawer can be opened for any period, not just the live one.
var nrrHandoverCsvCache = { rows: [], loaded: false };
async function nrrFetchHandoverCsv() {
  if (nrrHandoverCsvCache.loaded) return nrrHandoverCsvCache;
  try {
    var resp = await fetch(R2_BASE + '/portview_handover.csv?cb=' + Date.now());
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var lines = (await resp.text()).split('\n').filter(function (l) { return l.trim(); });
    var header = parseCSVRow(lines[0]);
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var c = parseCSVRow(lines[i]), o = {};
      header.forEach(function (h, idx) { o[h] = c[idx]; });
      rows.push(o);
    }
    nrrHandoverCsvCache = { rows: rows, loaded: true };
  } catch (e) {
    console.warn('[nrr] portview_handover.csv fetch failed', e);
    nrrHandoverCsvCache = { rows: [], loaded: false, error: e.message };
  }
  return nrrHandoverCsvCache;
}
window.nrrFetchHandoverCsv = nrrFetchHandoverCsv;

function _nrrPrevMonthOf(period) {
  var p = (period || '').split('-');
  if (p.length !== 2) return '';
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1 - 1, 1); // -1 for 0-index, -1 for prev month
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Returns { accounts, baseline_gmv, current_gmv, retention_pct, payout, detail,
//           gmv_tier_label, gmv_bucket_gmv }
// detail: [{ name, account_id, baseline, current, transfer_month }]
// GMV-tier mode (v91): mirrors Sense's _commComputeHandoverRetention
// (07a_commission_engine.js) byte-for-byte — the KAM's AGGREGATE normalized
// baseline GMV (baselineNorm, summed across every handover account this
// period, not per-account) picks one gmv_tiers[] bucket; that bucket's own
// threshold ladder is applied to the KAM's blended retention %. This is the
// SECOND place these two functions must match exactly (see the divergence-
// bug note in nrrEstimateKamCommission below, from the first one).
function nrrComputeHandoverForKam(kamEmail, period) {
  var EMPTY = { accounts: 0, baseline_gmv: 0, current_gmv: 0, retention_pct: 0, payout: 0, detail: [], gmv_tier_label: null, gmv_bucket_gmv: 0, data_missing: false };
  var qd = window.bulkQnrrData;
  var kamRows = (qd && qd.byKamEmail && qd.byKamEmail[kamEmail]) || [];
  var kamName = kamRows.length ? (kamRows[0].latest_staff_owner || '') : '';
  // v_hofix: ไฟล์โหลดไม่ได้ = ไม่มีข้อมูล ไม่ใช่ ฿0 จริง
  if (!nrrHandoverCsvCache.loaded) return Object.assign({}, EMPTY, { data_missing: true });
  if (!kamName) return EMPTY;

  var prevMonth = _nrrPrevMonthOf(period);
  // v_hofix: เช็คระดับไฟล์ก่อน — portview_handover.csv เก็บได้เดือนเดียวและถูกเขียนทับ
  // ทุกครั้งที่รัน Q10 ใหม่ ถ้าเดือนที่ขอไม่อยู่ในไฟล์เลย นั่นคือ "ข้อมูลขาด"
  // ต้องบอกให้ชัด ไม่ใช่โชว์ ฿0 ซึ่งอ่านแล้วเข้าใจว่า "เดือนนี้ไม่มีใครได้"
  var monthPresent = nrrHandoverCsvCache.rows.some(function (r) {
    return (r.transfer_month || '') === prevMonth;
  });

  var rows = nrrHandoverCsvCache.rows.filter(function (r) {
    return (r.new_kam_name || '').trim() === kamName &&
      (r.prev_owner || '').toUpperCase() === 'SALE' &&
      (r.transfer_month || '') === prevMonth;
  });
  if (!rows.length) return monthPresent ? EMPTY : Object.assign({}, EMPTY, { data_missing: true });

  var baselineNorm = 0, perfNorm = 0, baselineGmv = 0, currentGmv = 0;
  var detail = rows.map(function (r) {
    var b = parseFloat(r.baseline_gmv) || 0, p = parseFloat(r.perf_gmv) || 0;
    var bd = parseFloat(r.baseline_days_in_month) || 30, pd = parseFloat(r.perf_days_in_month) || 30;
    baselineNorm += b / bd * 30; perfNorm += p / pd * 30;
    baselineGmv += b; currentGmv += p;
    return { name: r.account_name || r.account_id, account_id: r.account_id, baseline: b, current: p, transfer_month: r.transfer_month };
  });
  // v91: rounded to 1 decimal (was Math.round to a whole %) — must match
  // Sense's rounding exactly, or a KAM at e.g. 99.94% retention would round
  // UP to 100% here but round to 99.9% in Sense, clearing a threshold in
  // one engine but not the other. Pre-existing divergence, fixed here since
  // GMV-tier "zero drift" is this feature's own completion bar.
  var retentionPct = baselineNorm > 0 ? Math.round((perfNorm / baselineNorm * 100) * 10) / 10 : 0;

  var payout = 0, gmvTierLabel = null;
  var gmvTiers = nrrCommRateGetHandoverGmvTiers();
  if (gmvTiers.length) {
    // GMV-tier mode: aggregate baseline GMV picks ONE bucket; no match
    // (e.g. below the lowest configured gmv_min) => payout ฿0, intentional.
    var matched = null;
    for (var i = 0; i < gmvTiers.length; i++) {
      var gt = gmvTiers[i];
      if (baselineNorm >= Number(gt.gmv_min || 0) && (gt.gmv_max == null || baselineNorm <= Number(gt.gmv_max))) { matched = gt; break; }
    }
    if (matched) {
      gmvTierLabel = matched.label || null;
      var thresholds = (matched.thresholds || []).slice()
        .sort(function (a, b) { return Number(b.min_retention_pct || 0) - Number(a.min_retention_pct || 0); });
      for (var j = 0; j < thresholds.length; j++) {
        if (retentionPct >= Number(thresholds[j].min_retention_pct || 0)) { payout = Number(thresholds[j].payout || 0); break; }
      }
    }
  } else {
    // Legacy flat 2-tier fallback — identical to Sense's fallback path,
    // used until an admin populates gmv_tiers via the Cockpit.
    var t2Pct = nrrCommRateGet('handover', 'tier2_pct', 100);
    var t3Pct = nrrCommRateGet('handover', 'tier3_pct', 120);
    var t2Pay = nrrCommRateGet('handover', 'tier2_payout', 2500);
    var t3Bonus = nrrCommRateGet('handover', 'tier3_bonus', 2500);
    payout = retentionPct >= t3Pct ? t2Pay + t3Bonus : retentionPct >= t2Pct ? t2Pay : 0;
  }

  return { accounts: rows.length, baseline_gmv: baselineGmv, current_gmv: currentGmv, retention_pct: retentionPct,
           payout: payout, detail: detail, gmv_tier_label: gmvTierLabel, gmv_bucket_gmv: Math.round(baselineNorm),
           data_missing: false };  // v_hofix: มีข้อมูลจริงถึงมาถึงบรรทัดนี้ได้
}
window.nrrComputeHandoverForKam = nrrComputeHandoverForKam;

function nrrEstimateKamCommission(kamEmail, period, pct) {
  if (pct == null) return null;
  var nrrPayout = nrrCommTierPayout('kam', kamEmail, period, pct);
  var row = nrrUpsellTeamCache.byEmail[(kamEmail || '').toLowerCase()] || { p1_gmv: 0, p3_incremental: 0, outlet_gmv: 0 };
  var p1Rate = nrrCommRateGet('upsell_sku', 'p1_rate', 0.01);
  var p3Rate = nrrCommRateGet('upsell_sku', 'p3_rate', 0.01);
  var outRate = nrrCommRateGet('upsell_outlet', 'rate', 0.005);
  // Components kept separate (v16) — the receipt renders one line per
  // component; only the arithmetic below combines them.
  // v_catbonus: if the group-grain team file is loaded, compute P1/P3 with
  // per-category bonus rates (group > category > base); else flat scalar.
  var p1Comm, p3Comm;
  var _grpRows = nrrUpsellTeamGroupsCache.byEmail[(kamEmail || '').toLowerCase()];
  if (_grpRows && _grpRows.length) {
    var _rateMap = nrrCommCategoryBonus();
    p1Comm = 0; p3Comm = 0;
    _grpRows.forEach(function (gr) {
      if (gr.p1_gmv > 0) p1Comm += gr.p1_gmv * nrrCommUpsellRateFor(_rateMap, p1Rate, gr.category, gr.group_key);
      if (gr.p3_incremental > 0) p3Comm += gr.p3_incremental * nrrCommUpsellRateFor(_rateMap, p3Rate, gr.category, gr.group_key);
    });
  } else {
    p1Comm = row.p1_gmv * p1Rate;
    p3Comm = row.p3_incremental * p3Rate;
  }
  var outletComm = row.outlet_gmv * outRate;
  var upsellComm = p1Comm + p3Comm + outletComm;
  // NRR gate — same thresholds/caps the engine applies (_commComputeGmvGate).
  // Handover IS gated: the real engine (_commBuildKamPayout,
  // 07a_commission_engine.js:688-692) folds handover.payout into the
  // subtotal FIRST, then multiplies the whole thing by the gate cap:
  //   subtotal = nrr + upsell(sku+outlet) + handover
  //   final    = round(subtotal × cap)
  // (An earlier port added handover OUTSIDE the gate; that was wrong —
  // the two "verification" rows it cited both happened to be cases where
  // the formulas coincide, Dent handover=0 and Pop gate=1.0, so the
  // gate<1 AND handover>0 case was never actually exercised. Fixed
  // 2026-07-09 to match the engine that generates locked payroll.)
  // v91: GMV-tier bucketing inside nrrComputeHandoverForKam is a SECOND
  // place this port must match _commComputeHandoverRetention exactly —
  // same aggregate-GMV bucketing, same best-match threshold scan, same
  // 1-decimal retention rounding. No automated test guards this; verify
  // manually side-by-side when either engine changes.
  var t1 = nrrCommRateGet('gmv_gate', 'threshold_1', 98);
  var t2 = nrrCommRateGet('gmv_gate', 'threshold_2', 95);
  var cap = 1.0;
  if (pct < t2) cap = nrrCommRateGet('gmv_gate', 'cap_2', 0);
  else if (pct < t1) cap = nrrCommRateGet('gmv_gate', 'cap_1', 0.3);
  var handover = nrrComputeHandoverForKam(kamEmail, period);
  return {
    kind: 'kam', pct: pct, nrr_payout: nrrPayout,
    p1_comm: Math.round(p1Comm), p3_comm: Math.round(p3Comm), outlet_comm: Math.round(outletComm),
    upsell_comm: Math.round(upsellComm),
    gate_threshold: t1, gate_cap: cap, handover: handover,
    est: Math.round((nrrPayout + upsellComm + handover.payout) * cap),
    note: '(NRR ฿' + nrrPayout.toLocaleString('en-US') + ' + upsell ฿' + Math.round(upsellComm).toLocaleString('en-US') +
      (handover.payout ? ' + handover ฿' + handover.payout.toLocaleString('en-US') : '') + ')' +
      (cap < 1 ? ' × gate ' + cap + 'x' : '')
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
// v7 (SUPERSEDED, kept for history): v860-fix (2026-07-13) made this
// cumulative across every elapsed quarter month (streak-sum), to match the
// real engine's v836 change. That change is now known to be WRONG.
//
// v880-fix (2026-07-19): confirmed via Bush's own worked examples (Ning/
// Avo-Mango-Apple for P1, Ning/Coke for P3) that each month's commission
// must be that month's OWN current GMV alone — an item/outlet stays
// ELIGIBLE for the rest of the quarter once it first qualifies, but the
// value itself is never summed across months (e.g. an item dropping out
// one month doesn't "keep" a prior month's contribution once it requalifies
// later). Mirrors the identical fix in _commComputeUpsellSku
// (07a_commission_engine.js). In non-quarterly use (baseMonthIso falsy —
// /nrr never actually calls it that way today) evalLabels degenerates to
// exactly [currLabel], i.e. this was always a no-op there.
// v_simtab (2026-07-25): parameterized twin — accepts an `overrides` object
// ({p1MinGmv, p3ThreshPct, p3MinIncr}) so the Commission tab's "what-if"
// simulator can re-test today's real upsell data against a different set of
// cutoffs, purely client-side (visualization only, never writes back to
// target_settings). nrrComputeUpsellSku (below) is now a thin wrapper that
// calls this with overrides=null — ONE implementation, not two twins that
// could silently drift apart (the exact failure mode this codebase has been
// bitten by before — see the GMV-tier-bucketing and P1-baseline-freeze
// comments elsewhere in this file). Calling with overrides=null MUST
// reproduce nrrComputeUpsellSku's old standalone behavior exactly by
// construction, since that's now the only code path.
// Rates (p1Rate/p3Rate) are deliberately NOT overridable — Bush's ask was
// specifically about the three threshold cutoffs, not the payout rates.
function nrrComputeUpsellSkuWithParams(expansionOutletIds, bundle, baseMonthIso, overrides) {
  var EMPTY = { p1: { gmv: 0, comm: 0, groups: [] }, p3: { gmv_incremental: 0, comm: 0, groups: [] },
                total_comm: 0, total_gmv_eligible: 0 };
  if (!bundle || !bundle.loaded) return EMPTY;
  var expIds = expansionOutletIds instanceof Set ? expansionOutletIds : new Set();
  var data = bundle.data || {};
  var baselineGroups = bundle.baselineGroups || {};

  var p1Rate    = nrrCommRateGet('upsell_sku', 'p1_rate', 0.01);
  var p3Rate    = nrrCommRateGet('upsell_sku', 'p3_rate', 0.01);
  var p3Thresh  = (overrides && overrides.p3ThreshPct != null) ? Number(overrides.p3ThreshPct) : nrrCommRateGet('upsell_sku', 'p3_threshold_pct', 2.00);
  var p3MinIncr = (overrides && overrides.p3MinIncr != null) ? Number(overrides.p3MinIncr) : nrrCommRateGet('upsell_sku', 'p3_min_incremental', 8000);
  var p1MinGmv  = (overrides && overrides.p1MinGmv != null) ? Number(overrides.p1MinGmv) : nrrCommRateGet('upsell_sku', 'p1_min_gmv', 5000);

  var currLabel = nrrCommCurrentMonthLabel();
  var p3Labels = nrrP3WindowLabels(baseMonthIso, 3);
  var evalLabels = baseMonthIso ? _nrrCommElapsedQuarterLabels(baseMonthIso) : [currLabel];

  // v_catbonus: shared per-category/group override map + group→category
  // lookup (carried on the bundle rows). Empty → base rate (no-op).
  var _rateMap = nrrCommCategoryBonus();
  var _groupCategory = (bundle && bundle.groupCategory) || {};

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
        // v860-fix: isP1 is a STABLE property of this (account,outlet,
        // groupKey) triple once the baseline is frozen (quarterly mode
        // never updates outletBaseline mid-quarter) — matches the real
        // engine's identical reasoning, so classifying once outside the
        // per-month loop below is correct, not an approximation.
        var isP1 = !outletBaseline[groupKey];

        // v880-fix: only the current (last evaluated) month is tested/used
        // now — no more streak/gap tracking. See header comment above.
        // v_recon2: overrides.evalLabel ตรึงเดือนที่ประเมินได้ (export ย้อนหลัง
        // ต้องดูเดือนของงวดนั้น ไม่ใช่เดือนปัจจุบัน — ไม่ส่งมา = พฤติกรรมเดิมเป๊ะ)
        var lbl = (overrides && overrides.evalLabel) || evalLabels[evalLabels.length - 1];
        var row = monthData[lbl];
        if (!row) return;
        var rawTotalGmv = row.totalGmv || 0;
        var rawExistingGmv = row.existingGmv || 0;

        var _cat = _groupCategory[groupKey]; // v_catbonus

        if (isP1) {
          if (rawTotalGmv < p1MinGmv) return;
          var _r1 = nrrCommUpsellRateFor(_rateMap, p1Rate, _cat, groupKey);
          p1Groups.push({ accountId: accountId, outletId: outletId, groupKey: groupKey, category: _cat || null, applied_rate: _r1, total_gmv: rawTotalGmv, commission: rawTotalGmv * _r1 });
          return;
        }

        var maxBaseline = 0, maxBaselineMonth = p3Labels[0];
        p3Labels.forEach(function (l) {
          var lRow = monthData[l];
          if (!lRow) return;
          var d = nrrDaysInLabel(l);
          var norm30 = d > 0 ? lRow.totalGmv / d * 30 : lRow.totalGmv;
          if (norm30 > maxBaseline) { maxBaseline = norm30; maxBaselineMonth = l; }
        });
        if (rawExistingGmv <= maxBaseline * p3Thresh) return;
        var incremental = rawExistingGmv - maxBaseline;
        if (incremental < p3MinIncr) return;
        var _r3 = nrrCommUpsellRateFor(_rateMap, p3Rate, _cat, groupKey);
        p3Groups.push({ accountId: accountId, outletId: outletId, groupKey: groupKey, category: _cat || null, applied_rate: _r3,
          existing_curr: rawExistingGmv, max_baseline: maxBaseline, max_baseline_month: maxBaselineMonth,
          incremental: incremental, commission: incremental * _r3 });
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
window.nrrComputeUpsellSkuWithParams = nrrComputeUpsellSkuWithParams;

function nrrComputeUpsellSku(expansionOutletIds, bundle, baseMonthIso) {
  return nrrComputeUpsellSkuWithParams(expansionOutletIds, bundle, baseMonthIso, null);
}
window.nrrComputeUpsellSku = nrrComputeUpsellSku;

// ── Commission tab (v_simtab) — org-wide bundle fetch + full enumeration ──
// nrrFetchUpsellBundle (nrr_data.js) already exists and is proven — today
// it's only ever called for ONE KAM at a time (the Portfolio drill-down
// drawer). This loops it across a whole roster for the new Commission tab's
// simulator + breakdown table. Runs once per tab visit (not on every
// dashboard refresh) — the caller is expected to cache the result.
function nrrFetchAllUpsellBundles(roster, baseMonthIso) {
  return Promise.all((roster || []).map(function (person) {
    return nrrFetchUpsellBundle(person.email, baseMonthIso).then(function (bundle) {
      return { person: person, bundle: bundle };
    });
  }));
}
window.nrrFetchAllUpsellBundles = nrrFetchAllUpsellBundles;

// Enumerates EVERY (account, outlet, groupKey) row for one KAM this month —
// unlike nrrComputeUpsellSkuWithParams, this does NOT drop rows that fail
// the current threshold. That function's job is "what would actually get
// paid" (matches the real engine, which only ever pays qualifying rows);
// this one's job is Bush's second ask — "which near-miss items are on pace
// to cross the line by month-end" — so every row with real activity this
// month is kept, tagged with qualifies/projectedQualifies. Never used to
// alter a payout number; read-only display data for the breakdown table.
// ── v_gp: GP ต่อแถวของตาราง BREAKDOWN ─────────────────────────────────────
//
// กฎเดียวที่ต้องถือ: GP ในแถวต้องจับคู่กับ "เลขเงินที่แถวนั้นแสดง" ให้ตรงฐาน
// ไม่ใช่หยิบ margin ก้อนที่หาง่ายที่สุดมาวาง ถ้าไม่ตรงฐาน %GP จะผิดแบบเงียบๆ
// ในหน้าที่กำลังจะใช้สอนทีมว่า GP คืออะไร
//
// คืน null เมื่อไฟล์ยังไม่มีคอลัมน์ GP (ทุกจุดแสดงผลต้องเช็ค null เสมอ)
// pctValid=false เมื่อตัวส่วน <= 0 — ให้แสดงจำนวนบาทได้ แต่ห้ามแสดง %
function _nrrRowGpBase(gp, denom, covWith, covTotal) {
  if (!(covWith > 0)) return null;              // ไม่มีข้อมูล GP เลย → ไม่แสดงอะไร
  var coverage = covTotal > 0 ? (covWith / covTotal) : 0;
  return {
    gp: gp,
    gmv: denom,
    pctValid: denom > 0,
    gpPct: denom > 0 ? (gp / denom * 100) : null,
    coverage: coverage,
    ready: coverage >= (typeof NRR_GP_MIN_COVERAGE === 'number' ? NRR_GP_MIN_COVERAGE : 0.70),
    hasData: true
  };
}

// P1: ทั้งกลุ่มสินค้าเป็นของใหม่ → current = totalGmv จึงจับกับ totalMargin ตรงๆ
function _nrrRowGpP1(row) {
  if (!row) return null;
  return _nrrRowGpBase(row.totalMargin || 0, row.totalGmv || 0, row.gmvWithMargin || 0, row.totalGmv || 0);
}

// P3: current = incremental (ยอดเดือนนี้ − ฐานสูงสุด normalize 30 วัน)
// GP จึงต้องเป็น incremental ด้วย = margin เดือนนี้ − margin ของเดือนฐาน
// (normalize ×30/วัน แบบเดียวกับที่ maxBaseline ทำกับ GMV เป๊ะๆ ไม่งั้นตัวลบ
// สองตัวอยู่คนละสเกล แล้ว "GP ที่โต" จะเพี้ยนตามจำนวนวันของเดือนฐาน)
//
// กับดักที่ต้องกัน: ถ้าเดือนฐานมียอดแต่ไม่มีข้อมูล margin (margin=0 ทั้งที่ GMV>0)
// การลบจะได้ incremental GP ที่สูงเกินจริง เพราะตัวลบเป็น 0 โดยที่ข้อมูลขาด
// ไม่ใช่เพราะกำไรเป็นศูนย์จริง → เคสนี้ต้องตีเป็น "ข้อมูลไม่พอ" (ready=false)
function _nrrRowGpP3(row, baseRow, baseLabel, incrementalGmv) {
  if (!row) return null;
  var curMargin = row.existingMargin || 0;
  var baseMargin = 0;
  var baseIncomplete = false;
  if (baseRow) {
    var d = nrrDaysInLabel(baseLabel);
    var bm = baseRow.totalMargin || 0;
    baseMargin = d > 0 ? (bm / d * 30) : bm;
    if ((baseRow.totalGmv || 0) > 0 && !((baseRow.gmvWithMargin || 0) > 0)) baseIncomplete = true;
  }
  // ตัวส่วนคือ incremental GMV ตัวเดียวกับที่แถวแสดงในคอลัมน์ "ส่วนที่โต"
  // ส่งเข้ามาจากผู้เรียกเพื่อให้เป็นเลขเดียวกันแน่ๆ ไม่คำนวณซ้ำที่นี่
  var res = _nrrRowGpBase(
    curMargin - baseMargin,
    incrementalGmv || 0,
    row.gmvWithMargin || 0,
    row.totalGmv || 0
  );
  if (!res) return null;
  if (baseIncomplete) { res.ready = false; res.baseMissingMargin = true; }
  return res;
}

function nrrEnumerateUpsellGroups(person, bundle, baseMonthIso, overrides, expansionOutletIds) {
  var out = [];
  if (!bundle || !bundle.loaded) return out;
  var expIds = expansionOutletIds instanceof Set ? expansionOutletIds : new Set();
  var data = bundle.data || {};
  var baselineGroups = bundle.baselineGroups || {};
  var groupCategory = bundle.groupCategory || {};

  var p1Rate    = nrrCommRateGet('upsell_sku', 'p1_rate', 0.01);
  var p3Rate    = nrrCommRateGet('upsell_sku', 'p3_rate', 0.01);
  var p3Thresh  = (overrides && overrides.p3ThreshPct != null) ? Number(overrides.p3ThreshPct) : nrrCommRateGet('upsell_sku', 'p3_threshold_pct', 2.00);
  var p3MinIncr = (overrides && overrides.p3MinIncr != null) ? Number(overrides.p3MinIncr) : nrrCommRateGet('upsell_sku', 'p3_min_incremental', 8000);
  var p1MinGmv  = (overrides && overrides.p1MinGmv != null) ? Number(overrides.p1MinGmv) : nrrCommRateGet('upsell_sku', 'p1_min_gmv', 5000);
  var _rateMap  = nrrCommCategoryBonus();

  var currLabel = nrrCommCurrentMonthLabel();
  var p3Labels = nrrP3WindowLabels(baseMonthIso, 3);
  var evalLabels = baseMonthIso ? _nrrCommElapsedQuarterLabels(baseMonthIso) : [currLabel];
  // v_brkperiod: pin เดือนที่ประเมินได้ — ทางเดียวกับ nrrComputeUpsellSkuWithParams
  // (:729) เดิมตาราง BREAKDOWN ใช้เดือนนาฬิกาเครื่องเสมอ ทั้งที่หัวข้อพิมพ์เดือน
  // ที่เลือกไว้ (บุชเจอ: หัวบอก ก.ค. แถวเป็น ส.ค.) · additive — ไม่ส่ง = เดิมเป๊ะ
  var lbl = (overrides && overrides.evalLabel) || evalLabels[evalLabels.length - 1];
  var isPastMonth = lbl !== currLabel;

  // Same linear run-rate convention as nrrUpsellQuarterTimeline (MTD ÷ days
  // elapsed × days in month) — held back before day 5 for the same reason
  // (too early to extrapolate off 1-2 days of data).
  // v_brkperiod: เดือนที่จบแล้วไม่มี "คาดสิ้นเดือน" — ตัวเลขคือ actual ทั้งเดือน
  // daysElapsed มาจากนาฬิกาวันนี้ ใช้ project เดือนเก่าไม่ได้
  var daysElapsed = new Date().getDate();
  var daysInCurr = nrrDaysInLabel(currLabel);
  var projectionReady = !isPastMonth && daysElapsed >= 5;

  Object.keys(data).forEach(function (accountId) {
    var outletMap = data[accountId];
    var baselineByOutlet = baselineGroups[accountId] || {};

    Object.keys(outletMap).forEach(function (outletId) {
      if (expIds.has(String(outletId))) return; // earns 0.5% via Expansion instead — same exclusion as the commission calc
      var outletGroups = outletMap[outletId];
      var outletBaseline = baselineByOutlet[outletId] || {};

      Object.keys(outletGroups).forEach(function (groupKey) {
        var monthData = outletGroups[groupKey];
        var row = monthData[lbl];
        if (!row) return;
        var isP1 = !outletBaseline[groupKey];
        var category = groupCategory[groupKey] || null;

        if (isP1) {
          var rawTotalGmv = row.totalGmv || 0;
          if (rawTotalGmv <= 0) return; // no activity this month — not worth a row
          var r1 = nrrCommUpsellRateFor(_rateMap, p1Rate, category, groupKey);
          var qualifies1 = rawTotalGmv >= p1MinGmv;
          var projGmv1 = daysElapsed > 0 ? rawTotalGmv / daysElapsed * daysInCurr : rawTotalGmv;
          out.push({
            person: person, accountId: accountId, outletId: outletId, groupKey: groupKey, category: category,
            kind: 'p1', current: rawTotalGmv, threshold: p1MinGmv, qualifies: qualifies1,
            commission: qualifies1 ? rawTotalGmv * r1 : 0, applied_rate: r1,
            projected: projectionReady ? projGmv1 : null, projectionReady: projectionReady,
            projectedQualifies: projectionReady ? (projGmv1 >= p1MinGmv) : null,
            // v_gp: GP ของ P1 จับคู่กับ current = totalGmv ตรงๆ (ทั้งกลุ่มเป็นของใหม่)
            gp: _nrrRowGpP1(row)
          });
          return;
        }

        var rawExistingGmv = row.existingGmv || 0;
        if (rawExistingGmv <= 0) return;
        var maxBaseline = 0;
        var maxBaselineMonth = null;
        p3Labels.forEach(function (l) {
          var lRow = monthData[l];
          if (!lRow) return;
          var d = nrrDaysInLabel(l);
          var norm30 = d > 0 ? lRow.totalGmv / d * 30 : lRow.totalGmv;
          if (norm30 > maxBaseline) { maxBaseline = norm30; maxBaselineMonth = l; }
        });
        var incremental = rawExistingGmv - maxBaseline;
        var qualifies3 = rawExistingGmv > maxBaseline * p3Thresh && incremental >= p3MinIncr;
        var r3 = nrrCommUpsellRateFor(_rateMap, p3Rate, category, groupKey);
        var projExisting = daysElapsed > 0 ? rawExistingGmv / daysElapsed * daysInCurr : rawExistingGmv;
        var projIncremental = projExisting - maxBaseline;
        out.push({
          person: person, accountId: accountId, outletId: outletId, groupKey: groupKey, category: category,
          // v_brkgrowth: `current` is the INCREMENTAL for p3 (kept as-is — the
          // commission is charged on it and the harness pins that). But a
          // breakdown reader needs "grew FROM x TO y", and y was previously
          // unrecoverable from the row. Carry the absolute alongside it, plus
          // which lookback month set the bar — mirrors what
          // nrrComputeUpsellSkuWithParams already returns (existing_curr /
          // max_baseline / max_baseline_month).
          kind: 'p3', current: incremental, threshold: p3MinIncr, baseline: maxBaseline, thresholdPct: p3Thresh,
          existing_curr: rawExistingGmv, baselineMonth: maxBaselineMonth,
          qualifies: qualifies3, commission: qualifies3 ? incremental * r3 : 0, applied_rate: r3,
          projected: projectionReady ? projIncremental : null, projectionReady: projectionReady,
          projectedQualifies: projectionReady ? (projExisting > maxBaseline * p3Thresh && projIncremental >= p3MinIncr) : null,
          // v_gp: GP ของ P3 ต้องเป็น "ส่วนที่โต" ให้ตรงกับ current ที่เป็น incremental
          // ไม่ใช่ GP ทั้งก้อนของเดือนนี้ — ดู _nrrRowGpP3
          gp: _nrrRowGpP3(row, monthData[maxBaselineMonth], maxBaselineMonth, incremental)
        });
      });
    });
  });

  return out;
}
window.nrrEnumerateUpsellGroups = nrrEnumerateUpsellGroups;

// v_brkperiod gate — ไฟล์ upsell บน R2 มี existing/new split จริงแค่ "เดือน
// ปัจจุบันของไฟล์" (เดือนย้อนหลัง SQL q3c ใส่ 0.0 AS existing_gmv ไว้) →
// P3 สดของเดือนย้อนหลังเป็น ฿0 เชิงโครงสร้าง ห้ามเอาไปโชว์เหมือนเป็นเลขจริง
// (หลักเดียวกับ handover data_missing) · precedent ฝั่ง Sense:
// _commTeamCsvCoversPeriod (07a:341)
// เช็ค 2 ทาง: (1) label คือเดือนปัจจุบัน → ผ่านทันที (เดือนเดียวที่มี split
// เสมอ) (2) ไฟล์มีแถวเดือนนั้นที่ existingGmv > 0 → ผ่าน (แปลว่าไฟล์ถูก rerun
// ด้วย SQL ตัวใหม่ที่ split ทุกเดือนแล้ว — gate นี้จะเปิดเองไม่ต้องแก้โค้ด)
function nrrUpsellBundleCoversPeriod(bundle, evalLabel) {
  if (!evalLabel || evalLabel === nrrCommCurrentMonthLabel()) return true;
  if (!bundle || !bundle.loaded || !bundle.data) return false;
  var accs = Object.keys(bundle.data);
  for (var i = 0; i < accs.length; i++) {
    var outletMap = bundle.data[accs[i]];
    for (var outletId in outletMap) {
      var groups = outletMap[outletId];
      for (var gk in groups) {
        var row = groups[gk][evalLabel];
        if (row && row.existingGmv > 0) return true;
      }
    }
  }
  return false;
}
window.nrrUpsellBundleCoversPeriod = nrrUpsellBundleCoversPeriod;

// ── v_brkgrowth: how far is this row from qualifying? ─────────────────────
// ONE definition, consumed by both the status badge and the breakdown filter,
// so the badge can never say "เกือบถึง" about a row the filter excludes.
//
// The useful insight for P3: its two AND-ed conditions —
//   (1) existing > baseline × thresholdPct
//   (2) (existing − baseline) >= minIncremental
// are BOTH just "needs more GMV this month", so each converts to a baht gap
// and the binding constraint is simply the larger one. That collapses a
// two-dimensional threshold into a single honest number a KAM can act on:
// "this family needs ฿X more before month-end."
//
//   gap for (1) = baseline × pct − existing
//   gap for (2) = minIncremental − (existing − baseline)
//
// P1 has a single condition (total >= p1MinGmv), so its gap is direct.
var NRR_UPSELL_NEAR_FRAC = 0.70; // >=70% of the way = "เกือบถึง". Tunable; see the
                                 // gap column in the UI, which always shows the
                                 // raw baht number so this band is never the only
                                 // thing the reader has to go on.

function nrrUpsellRowGap(r) {
  if (!r) return null;
  var achieved, needed;
  if (r.kind === 'p1') {
    achieved = r.current || 0;              // p1 `current` IS the absolute total
    needed = r.threshold || 0;
  } else {
    // p3: work in absolute month GMV, which is the quantity a KAM moves.
    var base = r.baseline || 0;
    var abs = (r.existing_curr != null) ? r.existing_curr : (base + (r.current || 0));
    // Condition (1) is a STRICT inequality (existing > base × pct), so the
    // target is the smallest whole baht that actually EXCEEDS it — not
    // base × pct itself. Landing exactly on the line fails, and a gap that
    // leaves the row still short would be worse than no gap column at all.
    // (Caught by tools/verify_nrrcomm_simulator.js Part 6, which adds the gap
    // back and re-runs the real pass condition.)
    var needRatio = Math.floor(base * (r.thresholdPct || 0)) + 1;
    // Condition (2) is `>=`, so its target needs no such nudge.
    var needFloor = base + (r.threshold || 0);
    achieved = abs;
    needed = Math.max(needRatio, needFloor);
  }
  var gap = Math.max(0, needed - achieved);
  var progress = needed > 0 ? achieved / needed : (achieved > 0 ? 1 : 0);
  return {
    achieved: achieved,
    needed: needed,
    gap: gap,
    progress: progress,
    // Which condition is holding it back — worth naming, because "needs 2×"
    // and "needs ฿8,000 more" call for different sales moves.
    binding: (r.kind === 'p1') ? 'floor'
      : (Math.floor((r.baseline || 0) * (r.thresholdPct || 0)) + 1 >= (r.baseline || 0) + (r.threshold || 0) ? 'ratio' : 'floor'),
    near: !r.qualifies && gap > 0 && progress >= NRR_UPSELL_NEAR_FRAC
  };
}
window.nrrUpsellRowGap = nrrUpsellRowGap;

// ── Upsell quarter timeline (v_qtrux) — twin of _upsellQuarterTimeline
// (07a_commission_engine.js), same shape/lockstep. Rep-facing display data:
// one qualified group's month-by-month quarter journey. Display-only.
function nrrUpsellQuarterTimeline(bundle, group, kind, baseMonthIso) {
  try {
    if (!baseMonthIso || !bundle || !bundle.loaded || !group) return null;
    var data = bundle.data || {};
    var acct = data[group.accountId] || {};
    var outletGroups = acct[group.outletId] || {};
    var monthData = outletGroups[group.groupKey] || {};

    var parts = baseMonthIso.split('-');
    var baseYr = parseInt(parts[0], 10), baseMo = parseInt(parts[1], 10);
    var TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    // v_qsum: EN month abbreviation twin of 07a_commission_engine.js's
    // _EN_MONTHS_SHORT — display-only companion for compact UI, not used by
    // any /nrr surface yet, kept in lockstep in case one adopts it later.
    var EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var qLabels = [1, 2, 3].map(function (i) {
      var d = new Date(baseYr, baseMo - 1 + i, 1);
      return TH[d.getMonth()] + ' ' + (d.getFullYear() + 543);
    });
    var qLabelsEn = [1, 2, 3].map(function (i) {
      var d = new Date(baseYr, baseMo - 1 + i, 1);
      return EN[d.getMonth()];
    });
    var currLabel = nrrCommCurrentMonthLabel();
    var currIdx = qLabels.indexOf(currLabel);
    if (currIdx === -1) return null;

    var p1MinGmv = nrrCommRateGet('upsell_sku', 'p1_min_gmv', 5000);
    var p3Thresh = nrrCommRateGet('upsell_sku', 'p3_threshold_pct', 2.00);
    var p3MinIncr = nrrCommRateGet('upsell_sku', 'p3_min_incremental', 8000);
    var rate = Number(group.applied_rate) || 0;

    // v_gmv: also returns the GMV the rate was applied to (twin of the
    // Sense-side comment in 07a_commission_engine.js's monthComm) — `has`
    // distinguishes true zero (group hadn't started yet) from a real but
    // below-gate purchase, so the render layer can pick "ยังไม่ขาย" vs
    // "ไม่ถึงเกณฑ์" for the same 'none' state.
    function monthComm(lbl) {
      var row = monthData[lbl];
      if (!row) return { comm: 0, has: false, gmv: 0 };
      if (kind === 'p1') {
        var g = row.totalGmv || 0;
        return { comm: g >= p1MinGmv ? g * rate : 0, has: g > 0, gmv: g };
      }
      var ex = row.existingGmv || 0;
      var base = Number(group.max_baseline) || 0;
      var incrRaw = ex - base;
      if (ex <= base * p3Thresh) return { comm: 0, has: ex > 0, gmv: Math.max(0, incrRaw) };
      return { comm: incrRaw >= p3MinIncr ? incrRaw * rate : 0, has: ex > 0, gmv: incrRaw };
    }

    var daysElapsed = new Date().getDate();
    var daysInCurr = nrrDaysInLabel(currLabel);
    var mtdComm = Number(group.commission) || 0;
    var mtdGmv = kind === 'p1' ? (Number(group.total_gmv) || 0) : (Number(group.incremental) || 0);
    var projectionReady = daysElapsed >= 5;
    var projectedFull = daysElapsed > 0 ? mtdComm / daysElapsed * daysInCurr : mtdComm;
    var projectedGmvFull = daysElapsed > 0 ? mtdGmv / daysElapsed * daysInCurr : mtdGmv;

    var months = qLabels.map(function (lbl, i) {
      var labelEn = qLabelsEn[i];
      if (i < currIdx) {
        var m = monthComm(lbl);
        return { label: lbl, labelEn: labelEn, state: m.comm > 0 ? 'paid' : 'none', comm: m.comm, gmv: m.gmv, hasGmv: m.has, estimated: true };
      }
      if (i === currIdx) return { label: lbl, labelEn: labelEn, state: 'mtd', comm: mtdComm, gmv: mtdGmv, estimated: false };
      return { label: lbl, labelEn: labelEn, state: 'future', comm: projectionReady ? projectedFull : null, gmv: projectionReady ? projectedGmvFull : null, estimated: true };
    });

    var paidSum = 0, futureSum = 0, paidGmvSum = 0, futureGmvSum = 0, anyPriorPaid = false, lastPaid = null;
    months.forEach(function (m, i) {
      if (m.state === 'paid') { paidSum += m.comm; paidGmvSum += (m.gmv || 0); if (i < currIdx) { anyPriorPaid = true; lastPaid = m; } }
      if (m.state === 'future' && m.comm != null) futureSum += m.comm;
      if (m.state === 'future' && m.gmv != null) futureGmvSum += m.gmv;
    });
    var isLastMonth = currIdx === qLabels.length - 1;
    var quarterTotal = paidSum + (isLastMonth ? mtdComm : (projectionReady ? projectedFull : mtdComm)) + futureSum;
    // v_qsum: GMV mirror of quarterTotal — twin of the Sense-side addition.
    var quarterTotalGmv = paidGmvSum + (isLastMonth ? mtdGmv : (projectionReady ? projectedGmvFull : mtdGmv)) + futureGmvSum;

    var status = 'new';
    if (anyPriorPaid) {
      status = 'kept';
      if (projectionReady && lastPaid && projectedFull > lastPaid.comm * 1.1) status = 'growing';
    }
    return { months: months, status: status, quarterTotal: quarterTotal, quarterTotalGmv: quarterTotalGmv, isLastMonth: isLastMonth, projectionReady: projectionReady };
  } catch (e) {
    console.warn('[nrr] nrrUpsellQuarterTimeline error', e);
    return null;
  }
}
window.nrrUpsellQuarterTimeline = nrrUpsellQuarterTimeline;

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

// ── v_waiverecompute (backlog ข้อ 2) — waive หลัง lock แล้วคำนวณใหม่จาก /nrr ──
//
// สามชิ้น: detect (read-only) → preview (read-only) → apply (เขียนเงินจริง)
// ทุกชิ้น mirror มาจาก Sense (07a_commission_engine.js) ไม่คิดสูตรใหม่เอง:
//   _commWaiversDecidedAfterLock → nrrDetectStaleLockedPeriods
//   _commRecomputeRowNrrOnly     → _nrrRecomputeRowNrrOnly
//   recomputeNrrOnlyPreview      → nrrRecomputeNrrOnlyPreview
//   recomputeNrrOnlyApply        → nrrRecomputeNrrOnlyApply (payload ต้อง
//                                  หน้าตาเหมือน Sense ทุก field — สองเครื่องมือ
//                                  เขียนแถวแบบเดียวกัน อ่านสลับกันได้)
//
// ต่างจาก Sense จุดเดียวที่ "แหล่ง %NRR สด": Sense ใช้ _qnrrComputeForCommission
// ซึ่ง**แทนเดือนให้เงียบๆ ได้** (07c:524-550) จึงต้องมีการ์ดกันเดือนสลับ —
// ฝั่ง /nrr อ่าน result.by_month[period] ตรงๆ จาก twin engine (_qnrrCompute ผ่าน
// nrrKamResult/nrrTeamResult) ซึ่งไม่มีทางคืนเดือนอื่นใต้ key เดือนที่ขอ:
// เดือนไม่มีข้อมูล = key ไม่มีอยู่ = skip. การ์ดเดือนสลับจึงเป็น structural
// ไม่ใช่ runtime check — harness tools/verify_nrr_recompute.js ล็อกไว้

// นโยบายงวด (nrr_policies) — ใช้เช็คโหมด quarterly เท่านั้น cache ต่อ period
var nrrCommPolicyCache = {}; // { [period]: { commission_mode, loaded } }
async function nrrFetchPolicyForPeriod(periodMonth) {
  if (nrrCommPolicyCache[periodMonth] && nrrCommPolicyCache[periodMonth].loaded) return nrrCommPolicyCache[periodMonth];
  if (!supa) return { commission_mode: null, loaded: false };
  try {
    var resp = await supa.from('nrr_policies')
      .select('period_month,scope_type,scope_key,commission_mode,status')
      .eq('period_month', periodMonth);
    if (resp.error) throw resp.error;
    // Sense fallback ladder: scope ตรง > all|all > default (ไม่มี commission_mode)
    var rows = resp.data || [];
    var hit = rows.find(function (p) { return p.scope_type === 'all' && p.scope_key === 'all'; }) || rows[0];
    var out = { commission_mode: hit ? hit.commission_mode : null, loaded: true };
    nrrCommPolicyCache[periodMonth] = out;
    return out;
  } catch (e) {
    console.warn('[nrr] nrr_policies fetch failed for ' + periodMonth, e);
    return { commission_mode: null, loaded: false, error: e.message };
  }
}
window.nrrFetchPolicyForPeriod = nrrFetchPolicyForPeriod;

// twin ของ _commFrozenComponents (07a:4014) — อ่าน component ที่แช่แข็งใน breakdown
// TL multiplier เก็บได้ 2 รูปแบบ (object หรือ string '1.50x' จาก Excel backfill)
// hasMultiplier แยก "เก็บไว้ว่า 1.0 จริงๆ" ออกจาก "ไม่มีให้อ่านเลย" — กรณีหลังห้ามเดา
function _nrrCommFrozenComponents(row) {
  var bd = (row && row.breakdown) || {};
  var sku = bd.upsell_sku || {};
  var outlet = bd.upsell_outlet || {};
  var handover = bd.handover || {};
  var mult = bd.upsell_mult || {};
  return {
    upsellSku: Number(sku.total_commission != null ? sku.total_commission : (sku.total_comm || 0)) || 0,
    upsellOutlet: Number(outlet.commission || 0) || 0,
    handover: Number(handover.payout || 0) || 0,
    multiplier: (function () {
      if (mult && typeof mult === 'object' && mult.multiplier != null) return Number(mult.multiplier) || 1;
      if (typeof mult === 'string') { var m = parseFloat(mult); return isNaN(m) ? 1 : m; }
      return 1;
    })(),
    hasMultiplier: !!((mult && typeof mult === 'object' && mult.multiplier != null)
                      || (typeof mult === 'string' && !isNaN(parseFloat(mult))))
  };
}
window._nrrCommFrozenComponents = _nrrCommFrozenComponents;

// twin ของ _commRecomputeRowNrrOnly (07a:4041) — แถวเดียว, %NRR สด + component แช่แข็ง
// คืน {skip: เหตุผล} เมื่อคำนวณไม่ได้ — **ห้ามตีเป็น 0** เพราะเท่ากับตัดเงินคน
// ทั้งที่ข้อมูลแค่หายชั่วคราว
function _nrrRecomputeRowNrrOnly(row, period) {
  try {
    if (!row) return null;
    var role = String(row.beneficiary_role || '').toLowerCase();
    var email = row.beneficiary_email;
    if (!email) return { skip: 'ไม่มีอีเมลผู้รับ' };

    // /nrr มี twin engine เฉพาะ scope kam/tl — role อื่น (pm/ad/sales/admin)
    // จ่ายด้วย scheme อื่นที่ /nrr ไม่ได้ mirror ไว้ → ส่งไปทำที่ Sense Cockpit
    if (role !== 'kam' && role !== 'tl') {
      return { skip: 'รองรับเฉพาะ kam/tl จาก /nrr — role ' + role + ' ให้คำนวณใหม่จาก Sense Cockpit' };
    }

    var frozen = _nrrCommFrozenComponents(row);
    if (role === 'tl' && !frozen.hasMultiplier) {
      return { skip: 'แถว TL ไม่มีตัวคูณ upsell ที่ล็อกไว้ — ต้องตรวจมือ' };
    }

    // %NRR สด — waiver ล่าสุดถูกนับเองเพราะ _qnrrCompute อ่าน nrrExclusionsCache สด
    var result = role === 'tl' ? nrrTeamResult(email) : nrrKamResult(email);
    var bm = result && result.by_month ? result.by_month[period] : null;
    if (!bm) return { skip: 'engine ไม่มีข้อมูลเดือน ' + period + ' (CSV ปัจจุบันไม่ครอบเดือนนี้)' };

    // pct ไม่ปัด — twin ของ _nrrGovernedPct (07a:3013 "NO rounding here"):
    // ค่านี้ไปเข้าการเทียบ tier/gate ซึ่งปัด 1 ตำแหน่งเองที่ขอบ (nrrTierPct)
    // bm.nrr_pct ถูกปัด 1 ตำแหน่งแล้ว ใช้เป็น fallback เท่านั้น
    var pct = (bm.nrr_curr_norm != null && bm.effective_base_norm > 0)
      ? bm.nrr_curr_norm / bm.effective_base_norm * 100
      : bm.nrr_pct;
    if (pct === null || pct === undefined || isNaN(pct)) return { skip: 'คำนวณ %NRR ใหม่ไม่ได้ (ฐานเป็นศูนย์)' };

    var nrrPayout = nrrCommTierPayout(role, email, period, pct);

    var finalPayout, gate = null, subtotal;
    if (role === 'tl') {
      subtotal = nrrPayout;
      finalPayout = Math.round(nrrPayout * frozen.multiplier);
    } else {
      // gate — twin ของ _commComputeGmvGate (07a:1135): เทียบด้วยค่าปัด 1 ตำแหน่ง
      // (v_round) แต่ ach_pct เก็บค่าไม่ปัดไว้เป็น audit trail
      var t1 = nrrCommRateGet('gmv_gate', 'threshold_1', 98);
      var t2 = nrrCommRateGet('gmv_gate', 'threshold_2', 95);
      var cap = 1.0;
      var gatePct = nrrTierPct(pct);
      if (gatePct < t2) cap = nrrCommRateGet('gmv_gate', 'cap_2', 0);
      else if (gatePct < t1) cap = nrrCommRateGet('gmv_gate', 'cap_1', 0.3);
      gate = { ach_pct: pct, cap_multiplier: cap, gate_active: cap < 1.0 };
      subtotal = nrrPayout + frozen.upsellSku + frozen.upsellOutlet + frozen.handover;
      finalPayout = Math.round(subtotal * cap);
    }

    return {
      role: role, email: email, period: period,
      oldPct: (row.governed_nrr_pct != null ? Number(row.governed_nrr_pct)
                                            : (row.raw_nrr_pct != null ? Number(row.raw_nrr_pct) : null)),
      newPct: pct,
      oldPayout: Number(row.payout_amount || 0),
      newPayout: finalPayout,
      diff: finalPayout - Number(row.payout_amount || 0),
      nrrPayout: nrrPayout, subtotal: subtotal, gate: gate, frozen: frozen,
      name: ((row.breakdown || {}).kam_name) || ((row.breakdown || {}).team_lead_name) || email,
      sourceRow: row
    };
  } catch (e) {
    console.error('[nrr recompute] แถว ' + (row && row.beneficiary_email) + ' คำนวณใหม่ไม่ได้', e);
    return { skip: 'เกิดข้อผิดพลาดระหว่างคำนวณ: ' + (e && e.message) };
  }
}
window._nrrRecomputeRowNrrOnly = _nrrRecomputeRowNrrOnly;

// พรีวิว — twin ของ recomputeNrrOnlyPreview (07a:4124) — **ไม่เขียนอะไร**
async function nrrRecomputeNrrOnlyPreview(period) {
  // /nrr engine คำนวณได้เฉพาะเดือนในไตรมาสปัจจุบัน (CSV บน R2 ครอบแค่นั้น)
  if ((QNRR_CFG.q_months || []).indexOf(period) === -1) {
    return { ok: false, reason: 'period_outside_quarter', changes: [], skipped: [] };
  }
  // โหมดรายเดือน — ฐานคำนวณคนละตัวกับ twin engine → ไม่รองรับ (เหมือน Sense)
  var policy = await nrrFetchPolicyForPeriod(period);
  if (!policy.loaded) return { ok: false, reason: 'policy_unreachable', changes: [], skipped: [] };
  if (policy.commission_mode !== 'quarterly') {
    return { ok: false, reason: 'not_quarterly_mode', changes: [], skipped: [] };
  }
  // ให้ tier/gate/waiver caches พร้อมก่อนคำนวณ
  await Promise.all([nrrFetchCommissionPlans(), nrrFetchCommissionRates(), nrrFetchExclusions(true)]);

  // ดึงแถว final เต็มคอลัมน์ (frozen component อยู่ใน breakdown)
  var fullRows = [];
  try {
    var resp = await supa.from('commission_payout_snapshots')
      .select('*').eq('period_month', period).eq('snapshot_status', 'final');
    if (resp.error) throw resp.error;
    fullRows = resp.data || [];
  } catch (e) {
    console.warn('[nrr recompute] ดึงแถว snapshot ไม่ได้', e);
    return { ok: false, reason: 'db_unreachable', changes: [], skipped: [] };
  }
  if (!fullRows.length) return { ok: false, reason: 'no_final_rows', changes: [], skipped: [] };

  var changes = [], skipped = [];
  fullRows.forEach(function (r) {
    var res = _nrrRecomputeRowNrrOnly(r, period);
    if (!res || res.skip) {
      skipped.push({ email: r.beneficiary_email, role: r.beneficiary_role,
                     reason: (res && res.skip) || 'คำนวณ %NRR ใหม่ไม่ได้' });
      return;
    }
    // tolerance เดียวกับ Sense: ค่าเดิมจาก DB เป็น NUMERIC ปัดทศนิยม ค่าใหม่ float เต็ม
    var pctMoved = res.oldPct === null || res.oldPct === undefined
      || Math.abs(Number(res.newPct) - Number(res.oldPct)) > 0.005;
    if (res.diff !== 0 || pctMoved) changes.push(res);
  });
  return { ok: true, period: period, changes: changes, skipped: skipped,
           totalRows: fullRows.length,
           totalDiff: changes.reduce(function (s, c) { return s + c.diff; }, 0) };
}
window.nrrRecomputeNrrOnlyPreview = nrrRecomputeNrrOnlyPreview;

// เขียนผลที่พรีวิวไว้ — twin ของ recomputeNrrOnlyApply (07a:4161)
// รับ changes ที่ผู้ใช้เห็นแล้วเท่านั้น ไม่คำนวณซ้ำตอนเขียน (สิ่งที่เขียน = สิ่งที่ยืนยัน)
// payload ทุก field ต้องเหมือน Sense — source-locked โดย tools/verify_nrr_recompute.js
var _nrrRecomputeInFlight = null;
async function nrrRecomputeNrrOnlyApply(period, changes, reason) {
  if (!changes || !changes.length) return { ok: false, error: 'no_changes' };
  if (!supa || !nrrProfile || nrrProfile.role !== 'admin') return { ok: false, error: 'not_authorized' };
  if (_nrrRecomputeInFlight === period) return { ok: false, error: 'in_flight' };
  _nrrRecomputeInFlight = period;
  try {
    var actor = nrrProfile.email || '';
    var now = new Date().toISOString();
    var payload = changes.map(function (c) {
      var row = c.sourceRow;
      var bd = Object.assign({}, row.breakdown || {});
      bd.revisions = (bd.revisions || []).concat([{
        at: now, by: actor, kind: 'nrr_only',
        reason: reason || 'waiver updated after lock',
        prev_payout: c.oldPayout, prev_nrr_pct: c.oldPct,
        new_payout: c.newPayout, new_nrr_pct: c.newPct
      }]);
      bd.nrr_pct = c.newPct;
      bd.nrr_payout = c.nrrPayout;
      bd.components_subtotal = c.subtotal;
      if (c.gate) bd.gmv_gate = c.gate;
      bd.final_payout = c.newPayout;
      bd.frozen_components = ['upsell_sku', 'upsell_outlet', 'handover', 'upsell_mult'];
      bd.recomputed_at = now;
      return Object.assign({}, row, {
        breakdown: bd,
        raw_nrr_pct: c.newPct,
        governed_nrr_pct: c.newPct,
        payout_amount: c.newPayout,
        snapshot_status: 'final',      // คง final — ไม่ปลดล็อกกลับเป็น draft
        updated_at: now, updated_by: actor
      });
    });
    var resp = await supa.from('commission_payout_snapshots')
      .upsert(payload, { onConflict: 'period_month,beneficiary_role,beneficiary_email' })
      .select('id');
    if (resp.error) throw new Error(resp.error.message);
    // ล้าง cache ทุกชั้นที่ถือแถวงวดนี้ — ให้รอบอ่านถัดไปเห็นตัวเลขใหม่
    nrrCommSnapshots = null;
    delete nrrCommPeriodCache[period];
    return { ok: true, count: payload.length, at: now };
  } catch (e) {
    console.error('[nrr recompute] เขียนผลไม่สำเร็จ', e);
    return { ok: false, error: e.message };
  } finally {
    _nrrRecomputeInFlight = null;
  }
}
window.nrrRecomputeNrrOnlyApply = nrrRecomputeNrrOnlyApply;

// detect — งวดที่ล็อกแล้วแต่มี waiver ตัดสิน "หลัง" เวลาล็อก/คำนวณล่าสุด
// sync ล้วน อ่านจาก cache ที่หน้า waivers/commission โหลดอยู่แล้ว
// กว้างกว่า Sense (_commWaiversDecidedAfterLock ดูเฉพาะ approved) หนึ่งจุด:
// นับ revoked ด้วย — เพิกถอน waiver หลังล็อกก็ทำให้ %NRR ที่ล็อกไว้ stale เหมือนกัน
// (ปลอดภัย: detect แค่ขึ้นป้าย ตัวเลขจริงไปโชว์ในพรีวิวก่อนเขียนเสมอ)
function nrrDetectStaleLockedPeriods() {
  if (!nrrCommSnapshots || !nrrCommSnapshots.loaded) return [];
  var byPeriod = {};
  (nrrCommSnapshots.rows || []).forEach(function (r) {
    if (String(r.snapshot_status || '').toLowerCase() !== 'final') return;
    if (!byPeriod[r.period_month]) byPeriod[r.period_month] = [];
    byPeriod[r.period_month].push(r);
  });
  var out = [];
  Object.keys(byPeriod).forEach(function (period) {
    // เวลาอ้างอิง = การคำนวณล่าสุดของงวด (recompute แล้วป้ายต้องหายเอง)
    var lockedAt = byPeriod[period]
      .map(function (r) { var bd = r.breakdown || {}; return bd.recomputed_at || bd.computed_at || r.updated_at; })
      .filter(Boolean).sort().pop();
    if (!lockedAt) return;
    var stale = (nrrExclusionsCache || []).filter(function (x) {
      if (String(x.period_month || '') !== String(period)) return false;
      var st = String(x.status || '').toLowerCase();
      if (st !== 'approved' && st !== 'revoked') return false;
      return x.reviewed_at && x.reviewed_at > lockedAt;
    });
    if (stale.length) out.push({ period: period, lockedAt: lockedAt, waivers: stale, count: stale.length });
  });
  return out.sort(function (a, b) { return a.period < b.period ? -1 : 1; });
}
window.nrrDetectStaleLockedPeriods = nrrDetectStaleLockedPeriods;
