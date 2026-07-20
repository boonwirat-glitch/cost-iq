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

  var currentIdx = -1;
  if (pct != null && !isNaN(pct)) {
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      var minOk = t.min_value == null || t.min_value === '' || pct >= Number(t.min_value);
      var maxOk = t.max_value == null || t.max_value === '' || pct < Number(t.max_value);
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
  var gapPp = (nextIdx >= 0 && pct != null) ? Math.max(0, Math.ceil((Number(tiers[nextIdx].min_value) - pct) * 10) / 10) : null;
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
  var EMPTY = { accounts: 0, baseline_gmv: 0, current_gmv: 0, retention_pct: 0, payout: 0, detail: [], gmv_tier_label: null, gmv_bucket_gmv: 0 };
  var qd = window.bulkQnrrData;
  var kamRows = (qd && qd.byKamEmail && qd.byKamEmail[kamEmail]) || [];
  var kamName = kamRows.length ? (kamRows[0].latest_staff_owner || '') : '';
  if (!kamName || !nrrHandoverCsvCache.loaded) return EMPTY;

  var prevMonth = _nrrPrevMonthOf(period);
  var rows = nrrHandoverCsvCache.rows.filter(function (r) {
    return (r.new_kam_name || '').trim() === kamName &&
      (r.prev_owner || '').toUpperCase() === 'SALE' &&
      (r.transfer_month || '') === prevMonth;
  });
  if (!rows.length) return EMPTY;

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
           payout: payout, detail: detail, gmv_tier_label: gmvTierLabel, gmv_bucket_gmv: Math.round(baselineNorm) };
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
        var lbl = evalLabels[evalLabels.length - 1];
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
