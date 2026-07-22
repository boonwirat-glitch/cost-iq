// ══════════════════════════════════════════════════════════════
// TARGET MODULE — sense_v162
// Tables required in Supabase:
//
// CREATE TABLE targets (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   period text NOT NULL,        -- "2026-06"
//   quarter text NOT NULL,       -- "2026-Q2"
//   level text NOT NULL,         -- "team" | "kam"
//   set_by text NOT NULL,
//   for_email text NOT NULL,
//   gmv_target numeric NOT NULL DEFAULT 0,
//   created_at timestamptz DEFAULT now(),
//   updated_at timestamptz DEFAULT now()
// );
// ALTER TABLE targets ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "auth users can read" ON targets FOR SELECT USING (auth.role() = 'authenticated');
// CREATE POLICY "auth users can upsert" ON targets FOR ALL USING (auth.role() = 'authenticated');
//
// CREATE TABLE target_settings (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   key text NOT NULL UNIQUE,    -- "nrr_threshold"
//   value text NOT NULL,
//   updated_by text,
//   updated_at timestamptz DEFAULT now()
// );
// ALTER TABLE target_settings ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "auth users read" ON target_settings FOR SELECT USING (auth.role() = 'authenticated');
// CREATE POLICY "admin write" ON target_settings FOR ALL USING (auth.role() = 'authenticated');
// INSERT INTO target_settings (key, value) VALUES ('nrr_threshold', '98');
//
// CREATE TABLE nrr_policies (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   period_month text NOT NULL,                -- "2026-07"
//   scope_type text NOT NULL DEFAULT 'all',    -- 'all' | 'team' | 'kam'
//   scope_key text NOT NULL DEFAULT 'all',     -- 'all' or email
//   base_mode text NOT NULL DEFAULT 'rolling_mom', -- 'rolling_mom' | 'fixed_month'
//   base_month text,                           -- "2026-06" when fixed
//   status text NOT NULL DEFAULT 'draft',      -- 'draft' | 'published'
//   updated_by text,
//   updated_at timestamptz DEFAULT now(),
//   UNIQUE(period_month, scope_type, scope_key)
// );
// ALTER TABLE nrr_policies ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "auth users read" ON nrr_policies FOR SELECT USING (auth.role() = 'authenticated');
// CREATE POLICY "admin write" ON nrr_policies FOR ALL USING (auth.role() = 'authenticated');
// ══════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────
let _tgtCache = {};           // { "2026-06|kam|ning@f.co": 3200000, ... }
let _tgtSettings = {};        // { nrr_threshold: 98 }
let _tgtLoaded = false;
let _tgtSettingsLoadFailed = false; // v835-fix: true if target_settings query threw — signals _tgtSettings may be running on stale hardcoded defaults, not live Cockpit config
let _tgtActiveTab = 'team';
let _tgtActiveQuarter = null; // "2026-Q3"
let _tgtPendingEdits = {};    // { "2026-06|kam|ning@f.co": 3200000 }
let _tgtMode = null;          // "admin" | "tl"
let _nrrGovPolicies = {};     // { "2026-07|all|all": {...} }
let _nrrGovPending = {};      // { "2026-07|all|all": {...draft...} }
let _commRuleConfig = {};     // { plans:{}, rules:{}, tiers:{} }
// v878 (phase 8/9): roster of people in the 6 roles beyond tl/kam
// (pm/admin/sales/sales_tl/ad/ad_tl), fetched from Supabase profiles (the
// real source of truth for "who has this role" — portviewBulkData/
// _buildKamGroups only ever contain kam/tl people). Populated by
// loadTargets(), consumed by _commBuildSnapshotRows() to actually include
// these people in a commission compute/lock pass.
let _commOtherRoleRoster = [];
let _commRulePending = {};    // editable payout rule draft by plan code
let _nrrExclusions = [];       // loaded/requested NRR exclusions (request/approve UI lives in /nrr -- see nrr_waivers.js)
let _commissionSnapshots = [];  // draft/final payout snapshots loaded from Supabase
let _commCockpitStep = 'policy';
let _commAssignmentPending = {}; // period|scope|assignee -> plan_code
let _commSelectedRuleCode = null; // active rule editor in Rule Library
let _commValidationErrors = {}; // v210e validation map by plan_code
let _commSaveStateTimer = null;
let _commSuppressCloseGuard = false;
let _commLastRenderedStep = null; // v210f: avoid body flash when re-rendering same step

// ── Supabase load ───────────────────────────────────────────────
let _tgtQuarterCache = {}; // per-quarter cache {quarter: {cache, settings, ts}}
const _TGT_CACHE_TTL = 5 * 60 * 1000; // 5 min TTL — fresh enough for a session

// ══════════════════════════════════════════════════════════════
// SECTION:COMMISSION_UPSELL_ENGINE
// Commission components beyond NRR: P1, P3, Upsell Outlet,
// Handover retention, GMV Gate, TL Upsell Multiplier.
// All rates/thresholds are admin-configurable via commission_rules.
// ══════════════════════════════════════════════════════════════

// ── Config helpers ──────────────────────────────────────────────
// _commGetConfig: read component param from target_settings (loaded in _tgtSettings).
// Key pattern: '{metricCode}_params' → JSON object → paramName
// Falls back to hardcoded default so the app never returns NaN.
function _commGetConfig(metricCode, paramName, defaultVal) {
  try {
    const key = metricCode + '_params';
    const raw = _tgtSettings && _tgtSettings[key];
    if (raw) {
      const params = typeof raw === 'object' ? raw : JSON.parse(raw);
      if (params[paramName] !== undefined && params[paramName] !== null)
        return Number(params[paramName]);
    }
  } catch(e) {}
  // Also check _commRuleConfig for backwards compatibility
  try {
    const rules = _commRuleConfig && _commRuleConfig.rules;
    if (rules) {
      const arr = rules[metricCode];
      if (arr && arr.length > 0) {
        const params = arr[0].params || {};
        if (params[paramName] !== undefined && params[paramName] !== null)
          return Number(params[paramName]);
      }
    }
  } catch(e) {}
  return defaultVal !== undefined ? defaultVal : null;
}

// v878 (phase 3): resolves a non-NRR component's rule (+ its tiers/params/
// tier_config) for a given scheme (plan_code), reading the new
// componentRules map built in loadTargets(). Returns null if this scheme
// has no rule row for this component yet — callers should fall back to
// the legacy global target_settings blob via _commGetConfig in that case,
// so an unconfigured scheme behaves exactly like today rather than
// silently zeroing out a component nobody has migrated yet.
function _commGetRuleForMetric(planCode, metricCode, metricVariant) {
  const plan = (_commRuleConfig.plans || {})[planCode];
  if (!plan || !plan.id) return null;
  const key = `${plan.id}|${metricCode}|${metricVariant || ''}`;
  const rule = (_commRuleConfig.componentRules || {})[key];
  if (!rule) return null;
  return {
    rule,
    active: rule.active !== false,
    params: rule.params || {},
    tiers: (_commRuleConfig.tiers && _commRuleConfig.tiers[rule.id]) || [],
    tier_config: rule.tier_config || null
  };
}

// v879 (Commission Setup redesign, phase 1): tries an injected preview
// resolver first (the Setup UI's unsaved component drafts, keyed by
// plan_code so a never-saved role can preview too), falling back to the
// real, saved-only _commGetRuleForMetric otherwise. Every existing caller
// passes no previewResolver, so their resolution is byte-identical to
// before this function existed — real Compute/Lock never pass one. The
// resolver may return `undefined` (no draft, use real resolution), `null`
// (draft says: explicitly no rule), or a _commGetRuleForMetric-shaped
// object (draft says: use this instead).
function _commResolveRuleForMetric(planCode, metricCode, metricVariant, previewResolver) {
  if (typeof previewResolver === 'function') {
    const draft = previewResolver(planCode, metricCode, metricVariant);
    if (draft !== undefined) return draft;
  }
  return _commGetRuleForMetric(planCode, metricCode, metricVariant);
}

// v_catbonus (2026-07-19): per-category / per-group_key Upsell bonus rates.
// Resolves the ONE shared override map for a scheme — a single
// upsell_gmv/category_bonus rule row whose tier_config holds
// { category_rates:{cat->rate}, group_rates:{group_key->rate} }, applied to
// BOTH P1 and P3 (Bush's decision: one shared map, not per-variant). Empty
// {} when no bonus configured → every lookup falls back to the base rate, so
// this is a no-op until an admin sets a rate. Same tier_config-on-the-rule
// mechanism handover's gmv_tiers uses. Returns normalized
// { categoryRates, groupRates } (both plain objects, never null).
function _commResolveUpsellRateMap(planCode, previewResolver) {
  const EMPTY = { categoryRates: {}, groupRates: {} };
  try {
    if (!planCode) return EMPTY;
    const rule = _commResolveRuleForMetric(planCode, 'upsell_gmv', 'category_bonus', previewResolver);
    if (!rule || rule.active === false || !rule.tier_config) return EMPTY;
    const tc = rule.tier_config;
    return {
      categoryRates: (tc.category_rates && typeof tc.category_rates === 'object') ? tc.category_rates : {},
      groupRates:    (tc.group_rates    && typeof tc.group_rates    === 'object') ? tc.group_rates    : {}
    };
  } catch (e) { return EMPTY; }
}

// Resolve the effective Upsell rate for one line item, precedence
// group_key override > category override > base rate (Bush's decision).
// A stored rate of 0 is a real "pay nothing on this group" choice and MUST
// win over base — hence the explicit `!= null` checks, not `||`.
function _commUpsellRateFor(rateMap, baseRate, category, groupKey) {
  if (rateMap) {
    if (groupKey != null && rateMap.groupRates && rateMap.groupRates[groupKey] != null)
      return Number(rateMap.groupRates[groupKey]);
    if (category != null && rateMap.categoryRates && rateMap.categoryRates[category] != null)
      return Number(rateMap.categoryRates[category]);
  }
  return baseRate;
}
window._commResolveUpsellRateMap = _commResolveUpsellRateMap;
window._commUpsellRateFor = _commUpsellRateFor;

// ── Thai month helpers ──────────────────────────────────────────
const _TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                    'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

// ── lag anchor: วันที่ 1 มิ.ย. → lag = 31 พ.ค. → label = "พ.ค." ตรงกับ upsell CSV ──
function _commLagDate() {
  const n = new Date();
  n.setDate(n.getDate() - 1);  // day-1 lag: same anchor as portview/NRR/Q7B
  return n;
}
function _commCurrentMonthLabel() {
  const n = _commLagDate();
  return _TH_MONTHS[n.getMonth()] + ' ' + (n.getFullYear() + 543);
}

function _commBaselineMonthLabel() {
  const n = _commLagDate();
  const b = new Date(n.getFullYear(), n.getMonth() - 1, 1);
  return _TH_MONTHS[b.getMonth()] + ' ' + (b.getFullYear() + 543);
}

// Generate Thai month label N months before current (lag-anchored)
function _commMonthLabelOffset(monthsBack) {
  const n = _commLagDate();
  const d = new Date(n.getFullYear(), n.getMonth() - monthsBack, 1);
  return _TH_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

// Days in a given month (from Thai label e.g. "เม.ย. 2569")
function _commDaysInLabel(label) {
  try {
    const parts = label.split(' ');
    const mIdx = _TH_MONTHS.indexOf(parts[0]);
    const year = parseInt(parts[1]) - 543;
    if (mIdx < 0 || !year) return 30;
    return new Date(year, mIdx + 1, 0).getDate();
  } catch(e) { return 30; }
}

// ── Quarterly base month helper ─────────────────────────────────
// Returns array of Thai month labels, counting back `count` months from baseMonthOverride.
// If baseMonthOverride is null → rolling lag-1 anchor (Q2 / MoM behavior).
function _commBaseMonthLabels(baseMonthOverride, count) {
  if (!baseMonthOverride) {
    // Rolling MoM: labels from lag-1 anchor (existing behavior)
    return Array.from({length: count}, function(_, i) { return _commMonthLabelOffset(i + 1); });
  }
  // Quarterly: anchor is fixed base_month (e.g. '2026-06')
  var parts = baseMonthOverride.split('-');
  var yr = parseInt(parts[0], 10);
  var mo = parseInt(parts[1], 10); // 1-based
  var _THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return Array.from({length: count}, function(_, i) {
    var d = new Date(yr, mo - 1 - i, 1); // mo-1 = 0-based, then subtract i months
    return _THAI_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  });
}

// v836: forward-walking counterpart to _commBaseMonthLabels — the quarter's OWN months
// (baseMonth+1, +2, +3), capped at whichever one is "today" (_commCurrentMonthLabel()),
// so a July run only evaluates July, an August run evaluates July+August, etc. Returns
// [] for null baseMonthOverride (monthly/rolling mode has no "elapsed quarter months"
// concept at all — callers should fall back to a single-month evaluation instead).
function _commElapsedQuarterLabels(baseMonthOverride) {
  if (!baseMonthOverride) return [];
  var parts = baseMonthOverride.split('-');
  var baseYr = parseInt(parts[0], 10), baseMo = parseInt(parts[1], 10); // 1-based
  var lagDate = _commLagDate();
  var out = [];
  for (var i = 1; i <= 3; i++) {
    var d = new Date(baseYr, baseMo - 1 + i, 1); // baseMonth+1, +2, +3
    // v854-fix: was string-label equality against _commCurrentMonthLabel(), which
    // never matches on the quarter's own day-1 (lag anchor still reads the OLD
    // quarter's last month) — the break never fired and the loop wrongly walked
    // all 3 unelapsed future months. Compare dates directly against the lag anchor
    // instead: a month hasn't elapsed if it starts after "today" (lag-adjusted).
    if (d > lagDate) break;
    out.push(_TH_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543));
  }
  return out;
}

// ── Upsell SKU Engine ───────────────────────────────────────────
// Returns { p1, p3, total_comm, total_gmv, tl_upsell_base }
// p1: { gmv, comm, groups:[{group_key,total_gmv,commission}] }
// p3: { gmv_incremental, comm, groups:[{group_key,existing_curr,max_baseline,...}] }
// v836: in quarterly mode (baseMonthOverride set), walks every ELAPSED month of the
// quarter and sums a continuous qualifying streak ending at the current month — a shop
// that just MAINTAINS an elevated level (not necessarily growing further, since the
// frozen baseline never advances mid-quarter) keeps earning each month, capped at the
// quarter boundary — matching the same algorithm already shipped in
// sql/q3c_upsell_team_summary_v4.sql (the two must be kept in sync). Monthly/rolling
// mode (baseMonthOverride null) is UNCHANGED — evalLabels degenerates to exactly
// [currLabel], i.e. the original single-month behavior.
function _commComputeUpsellSku(kamEmail, expansionIds, baseMonthOverride, planCode, previewResolver) {
  // v244: expansionIds = Set of outlet IDs classified as expansion (from bulkOutletsData)
  // expansion outlets earn 1.5% via _commComputeUpsellOutlet — excluded from P1/P3 here
  // baseMonthOverride (optional): '2026-06' for quarterly Q3 — pins P1/P3 3M lookback window.
  //   null → rolling MoM (existing behavior unchanged)
  const _expIds = expansionIds instanceof Set ? expansionIds : new Set();
  const EMPTY = { p1:{gmv:0,comm:0,groups:[]}, p3:{gmv_incremental:0,comm:0,groups:[]},
                  total_comm:0, total_gmv_eligible:0, tl_upsell_base:0 };
  try {
    if (!bulkUpsellData || !bulkUpsellData.loaded) return EMPTY;
    const byKam = bulkUpsellData.byKam || {};
    const baselineGroups = bulkUpsellData.baselineGroups || {};

    // Q3C CSV uses ka_owner (display name) as key, not email.
    // Map: kamEmail → kamName via portviewBulkData for lookup.
    const _pvRow = (portviewBulkData || []).find(r => r.kamEmail === kamEmail);
    const _kamKey = (_pvRow && _pvRow.kamName) ? _pvRow.kamName : kamEmail;
    const kamData = byKam[_kamKey] || byKam[kamEmail] || {};
    if (Object.keys(kamData).length === 0) return EMPTY;

    const baselineSet = baselineGroups[_kamKey] || baselineGroups[kamEmail] || {};

    const currLabel  = _commCurrentMonthLabel();
    // [quarterly] anchor to fixed base_month; [monthly] rolling (unchanged)
    const baseLabel  = baseMonthOverride
      ? _commBaseMonthLabels(baseMonthOverride, 1)[0]
      : _commBaselineMonthLabel();
    // v836: months to classify+sum — every elapsed quarter month up to "today" when
    // quarterly, else just the single current month (original behavior, unchanged).
    const evalLabels = baseMonthOverride ? _commElapsedQuarterLabels(baseMonthOverride) : [currLabel];
    console.log('%c[Sense Upsell] compute','color:#f0b000',
      {kamEmail, kamKey:_kamKey, currLabel, baseLabel, evalLabels, accounts:Object.keys(kamData).length});

    // v878 (phase 4): Config — prefer the assigned scheme's own per-component
    // rule (metric_code='upsell_gmv', metric_variant='p1_new_sku'/'p3_growth')
    // when one exists; otherwise fall back to the legacy global target_settings
    // blob exactly as before (this is the only path today until a scheme is
    // migrated — see the phase-4 seed migration). P1's rate/min-gmv live on
    // the tier row (min_value=gate, payout_value=rate); P3's rate lives on
    // the tier row too, but threshold_pct/min_incremental aren't tier
    // boundaries so they live in the rule's own `params` instead.
    const p1Rule = planCode ? _commResolveRuleForMetric(planCode, 'upsell_gmv', 'p1_new_sku', previewResolver) : null;
    const p3Rule = planCode ? _commResolveRuleForMetric(planCode, 'upsell_gmv', 'p3_growth', previewResolver) : null;
    const p1Tier = (p1Rule && p1Rule.active && p1Rule.tiers[0]) ? p1Rule.tiers[0] : null;
    const p3Tier = (p3Rule && p3Rule.active && p3Rule.tiers[0]) ? p3Rule.tiers[0] : null;

    const p1Rate     = p1Tier ? Number(p1Tier.payout_value) : _commGetConfig('upsell_sku', 'p1_rate', 0.01);       // v835-fix: default was 0.03, live Supabase = 0.01 (changed 2026-06-11, default never updated)
    const p3Rate     = p3Tier ? Number(p3Tier.payout_value) : _commGetConfig('upsell_sku', 'p3_rate', 0.01);       // v835-fix: default was 0.03, live Supabase = 0.01
    const p3Thresh   = (p3Rule && p3Rule.params.threshold_pct != null) ? Number(p3Rule.params.threshold_pct) : _commGetConfig('upsell_sku', 'p3_threshold_pct', 2.00); // 150% = 50% growth
    const p3MinIncr  = (p3Rule && p3Rule.params.min_incremental != null) ? Number(p3Rule.params.min_incremental) : _commGetConfig('upsell_sku', 'p3_min_incremental', 8000); // v835-fix: default was 5000, live Supabase = 8000
    const p1MinGmv   = (p1Tier && p1Tier.min_value != null) ? Number(p1Tier.min_value) : _commGetConfig('upsell_sku', 'p1_min_gmv', 5000);       // ฿5,000 gate for P1 (spec)

    // v_catbonus: shared per-category/group override map (applies to both P1
    // and P3). Empty when unconfigured → _commUpsellRateFor returns the base
    // p1Rate/p3Rate, i.e. no behavior change. groupCategory maps a groupKey
    // to its category_high_level (carried on the ingested rows, since a bare
    // group_key string can't be mapped to a category in JS otherwise).
    const _rateMap = _commResolveUpsellRateMap(planCode, previewResolver);
    const _groupCategory = (bulkUpsellData && bulkUpsellData.groupCategory) || {};

    // MTD mode — commission on actual amounts, no projection
    // MTD mode — actual MTD vs full month baseline, no day scaling
    let daysElapsed = new Date().getDate();
    try {
      const sample = (portviewBulkData || []).find(r => r.kamEmail === kamEmail);
      if (sample && sample.daysElapsed > 0) daysElapsed = sample.daysElapsed;
    } catch(e) {}

    const p1Groups = [];
    const p3Groups = [];

    // v2: loop outlet × group_key (previously account × group_key)
    // baselineSet now: baselineSet[accountId][outletId] = Set<groupKey>  (3-month lookback)
    // legacy fallback: if baselineSet[accountId] is a Set (old format), wrap as {_all: Set}
    Object.keys(kamData).forEach(accountId => {
      const acctData = kamData[accountId];
      // Detect format: new = {outletId: {groupKey: {...}}}  legacy = {groupKey: {monthLabel: {...}}}
      const firstKey = Object.keys(acctData)[0] || '';
      const firstVal = acctData[firstKey];
      const isNewFormat = firstVal && typeof firstVal === 'object' &&
                          Object.values(firstVal)[0] && typeof Object.values(Object.values(firstVal)[0])[0] === 'object';
      const outletMap = isNewFormat ? acctData : { _all: acctData };
      const baselineByOutlet = baselineSet[accountId] || {};
      const legacySet = baselineByOutlet instanceof Set ? baselineByOutlet : null;

      Object.keys(outletMap).forEach(outletId => {
        // v244: skip expansion outlets — earn 1.5% via outlet commission, not P1/P3
        if (_expIds.has(String(outletId))) return;
        const outletGroups = outletMap[outletId];
        // outlet-level baseline: 3-month lookback
        const outletBaseline = legacySet || (baselineByOutlet[outletId] instanceof Set
          ? baselineByOutlet[outletId]
          : new Set());

        Object.keys(outletGroups).forEach(groupKey => {
          const monthData = outletGroups[groupKey];
          // v2 P1: outlet ไม่เคยซื้อ group_key นี้ใน 3 เดือนย้อนหลัง — a STABLE property of
          // this (account,outlet,groupKey) triple once the baseline is frozen (quarterly
          // mode never updates outletBaseline mid-quarter), so an item is either always-P1
          // or always-P3-eligible for the whole quarter, never both, never changing month
          // to month — matches the SQL's identical reasoning.
          const isP1 = !outletBaseline.has(groupKey);

          // v880-fix: was classifying EVERY evaluated month then summing a
          // trailing "streak" of qualifying months together (v836) — Bush's
          // worked example (Avo/Mango/Apple, 2026-07-19) confirmed this is
          // wrong: an item stays ELIGIBLE for the rest of the quarter once it
          // first qualifies, but each month's commission is that month's OWN
          // current GMV alone, never summed with prior months (e.g. Mango
          // drops to 0 in Aug — it doesn't "keep" July's 40k contribution).
          // Only the current (last evaluated) month is tested/used now — in
          // monthly/rolling mode evalLabels already has exactly 1 entry, so
          // this is a no-op there.
          const lbl = evalLabels[evalLabels.length - 1];
          const row = monthData[lbl];
          if (!row) return;
          const rawTotalGmv = row.totalGmv || 0;
          const rawExistingGmv = row.existingGmv || 0;

          // v_catbonus: category of this group_key (for the override lookup)
          const _cat = _groupCategory[groupKey];

          if (isP1) {
            // P1: outlet × group_key ใหม่ — this month's own total GMV × rate
            if (rawTotalGmv < p1MinGmv) return;
            const _r = _commUpsellRateFor(_rateMap, p1Rate, _cat, groupKey);
            p1Groups.push({ accountId, outletId, groupKey, category: _cat || null, applied_rate: _r,
              total_gmv: rawTotalGmv, commission: rawTotalGmv * _r });
            return;
          }

          // P3: existing outlet ซื้อเพิ่มจาก max_baseline — baseline window is
          // ALWAYS the same frozen 3-month pool regardless of which elapsed
          // month we're evaluating (baseline never drifts within the quarter).
          let maxBaseline = 0, maxBaselineMonth = baseLabel;
          const _p3Labels = _commBaseMonthLabels(baseMonthOverride, 3);
          for (let i = 0; i < _p3Labels.length; i++) {
            const l = _p3Labels[i];
            const lRow = monthData[l];
            if (!lRow) continue;
            const d = _commDaysInLabel(l);
            const norm30 = d > 0 ? lRow.totalGmv / d * 30 : lRow.totalGmv;
            if (norm30 > maxBaseline) { maxBaseline = norm30; maxBaselineMonth = l; }
          }
          if (rawExistingGmv <= maxBaseline * p3Thresh) return;
          const incremental = rawExistingGmv - maxBaseline;
          if (incremental < p3MinIncr) return;
          const _r3 = _commUpsellRateFor(_rateMap, p3Rate, _cat, groupKey);
          p3Groups.push({ accountId, outletId, groupKey, category: _cat || null, applied_rate: _r3,
            existing_curr: rawExistingGmv,
            max_baseline: maxBaseline,
            max_baseline_month: maxBaselineMonth,
            incremental: incremental, commission: incremental * _r3 });
        });
      });
    });

    const p1Gmv  = p1Groups.reduce((s,g) => s + g.total_gmv, 0);
    const p1Comm = p1Groups.reduce((s,g) => s + g.commission, 0);
    const p3Incr = p3Groups.reduce((s,g) => s + g.incremental, 0);
    const p3Comm = p3Groups.reduce((s,g) => s + g.commission, 0);
    console.log('%c[Sense Upsell] ✓ result','color:'+((p1Comm+p3Comm)>0?'var(--tk-ok-bright)':'#aaa')+';font-weight:bold',
      {kamEmail, currLabel, p1_groups:p1Groups.length, p1_gmv:Math.round(p1Gmv), p1_comm:Math.round(p1Comm),
       p3_groups:p3Groups.length, p3_incr:Math.round(p3Incr), p3_comm:Math.round(p3Comm),
       total_comm:Math.round(p1Comm+p3Comm),
       warn:(p1Groups.length+p3Groups.length)===0?'⚠️ no groups — currLabel not in CSV?':''});

    return {
      p1: { gmv: p1Gmv, comm: p1Comm, groups: p1Groups },
      p3: { gmv_incremental: p3Incr, comm: p3Comm, groups: p3Groups },
      total_comm: p1Comm + p3Comm,
      total_gmv_eligible: p1Gmv + p3Incr,
      tl_upsell_base: p1Gmv + p3Incr  // TL multiplier uses P1+P3 incremental only
    };
  } catch(e) {
    console.warn('[CommEngine] _commComputeUpsellSku error', e);
    return { p1:{gmv:0,comm:0,groups:[]}, p3:{gmv_incremental:0,comm:0,groups:[]},
             total_comm:0, total_gmv_eligible:0, tl_upsell_base:0 };
  }
}

// ── Upsell quarter timeline (v_qtrux) ───────────────────────────
// Rep-facing "จ่ายทั้งไตรมาส" data: for ONE qualified group (an entry from
// _commComputeUpsellSku().p1/p3.groups), build its month-by-month quarter
// journey from the same bulkUpsellData the engine computed from. Twin of
// nrrUpsellQuarterTimeline (src/nrr/nrr_commission.js) — same shape, keep
// in lockstep. Display-only: never feeds payout math.
// Returns null when data is missing; otherwise:
// { months:[{label, state:'paid'|'mtd'|'future'|'none', comm, estimated}],
//   status:'new'|'kept'|'growing'|'stopped', quarterTotal, isLastMonth,
//   projectionReady }
function _upsellQuarterTimeline(kamEmail, group, kind, baseMonthOverride) {
  try {
    if (!baseMonthOverride || !bulkUpsellData || !bulkUpsellData.loaded || !group) return null;
    const byKam = bulkUpsellData.byKam || {};
    const _pvRow = (portviewBulkData || []).find(r => r.kamEmail === kamEmail);
    const _kamKey = (_pvRow && _pvRow.kamName) ? _pvRow.kamName : kamEmail;
    const kamData = byKam[_kamKey] || byKam[kamEmail] || {};
    const acct = kamData[group.accountId] || {};
    const outletGroups = (acct[group.outletId] || acct._all || {});
    const monthData = outletGroups[group.groupKey] || {};

    // The quarter's own 3 months (base+1..+3) — forward-walking WITHOUT the
    // elapsed cap _commElapsedQuarterLabels applies.
    const parts = baseMonthOverride.split('-');
    const baseYr = parseInt(parts[0], 10), baseMo = parseInt(parts[1], 10);
    const qLabels = [1, 2, 3].map(i => {
      const d = new Date(baseYr, baseMo - 1 + i, 1);
      return _TH_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
    });
    const currLabel = _commCurrentMonthLabel();
    const currIdx = qLabels.indexOf(currLabel);
    if (currIdx === -1) return null; // current month not in this quarter — stale config

    // Gates: same resolution defaults the engine uses (display parity; a
    // per-scheme override of GATES [not rate] would drift here — accepted,
    // rate itself always comes from group.applied_rate which IS per-scheme).
    const p1MinGmv  = _commGetConfig('upsell_sku', 'p1_min_gmv', 5000);
    const p3Thresh  = _commGetConfig('upsell_sku', 'p3_threshold_pct', 2.00);
    const p3MinIncr = _commGetConfig('upsell_sku', 'p3_min_incremental', 8000);
    const rate = Number(group.applied_rate) || 0;

    // Qualified commission for one month's raw row, per the SAME gates the
    // engine applies — 0 when the month doesn't qualify (stopped / below gate).
    function monthComm(lbl) {
      const row = monthData[lbl];
      if (!row) return { comm: 0, has: false };
      if (kind === 'p1') {
        const g = row.totalGmv || 0;
        return { comm: g >= p1MinGmv ? g * rate : 0, has: g > 0 };
      }
      const ex = row.existingGmv || 0;
      const base = Number(group.max_baseline) || 0; // frozen all quarter
      if (ex <= base * p3Thresh) return { comm: 0, has: ex > 0 };
      const incr = ex - base;
      return { comm: incr >= p3MinIncr ? incr * rate : 0, has: ex > 0 };
    }

    // Current-month full-month projection (run-rate) for the future cells.
    let daysElapsed = new Date().getDate();
    try {
      const sample = (portviewBulkData || []).find(r => r.kamEmail === kamEmail);
      if (sample && sample.daysElapsed > 0) daysElapsed = sample.daysElapsed;
    } catch (e) {}
    const daysInCurr = _commDaysInLabel(currLabel);
    const mtdComm = Number(group.commission) || 0;
    const projectionReady = daysElapsed >= 5; // run-rate too noisy before day 5
    const projectedFull = daysElapsed > 0 ? mtdComm / daysElapsed * daysInCurr : mtdComm;

    const months = qLabels.map((lbl, i) => {
      if (i < currIdx) {
        const m = monthComm(lbl);
        // 'none' = ยังไม่เกิด (group ยังไม่ qualify เดือนนั้น) → แสดง "—"
        return { label: lbl, state: m.comm > 0 ? 'paid' : 'none', comm: m.comm, estimated: true };
      }
      if (i === currIdx) return { label: lbl, state: 'mtd', comm: mtdComm, estimated: false };
      return { label: lbl, state: 'future', comm: projectionReady ? projectedFull : null, estimated: true };
    });

    const paidSum = months.filter(m => m.state === 'paid').reduce((s, m) => s + m.comm, 0);
    const futureSum = months.filter(m => m.state === 'future' && m.comm != null).reduce((s, m) => s + m.comm, 0);
    const isLastMonth = currIdx === qLabels.length - 1;
    const quarterTotal = paidSum + (isLastMonth ? mtdComm : (projectionReady ? projectedFull : mtdComm)) + futureSum;

    const anyPriorPaid = months.some((m, i) => i < currIdx && m.state === 'paid');
    const lastPaid = [...months].reverse().find((m, ri) => months.length - 1 - ri < currIdx && m.state === 'paid');
    let status = 'new';
    if (anyPriorPaid) {
      status = 'kept';
      if (projectionReady && lastPaid && projectedFull > lastPaid.comm * 1.1) status = 'growing';
    }
    return { months, status, quarterTotal, isLastMonth, projectionReady };
  } catch (e) {
    console.warn('[CommEngine] _upsellQuarterTimeline error', e);
    return null;
  }
}
window._upsellQuarterTimeline = _upsellQuarterTimeline;

// v_qtrux: groups that EARNED in an earlier elapsed month of the quarter but
// no longer qualify this month — they're absent from _commComputeUpsellSku's
// current groups entirely, yet showing them (gray, ฿0, "ร้านหยุดซื้อ") is the
// strongest possible lesson that the quarter-pay is conditional.
// Returns [{accountId, outletId, groupKey, kind, lastComm, lastLabel}].
function _upsellStoppedGroups(kamEmail, currentGroups, baseMonthOverride) {
  try {
    if (!baseMonthOverride || !bulkUpsellData || !bulkUpsellData.loaded) return [];
    const currentSet = new Set((currentGroups || []).map(g => g.accountId + '|' + g.outletId + '|' + g.groupKey));
    const byKam = bulkUpsellData.byKam || {};
    const baselineGroups = bulkUpsellData.baselineGroups || {};
    const _pvRow = (portviewBulkData || []).find(r => r.kamEmail === kamEmail);
    const _kamKey = (_pvRow && _pvRow.kamName) ? _pvRow.kamName : kamEmail;
    const kamData = byKam[_kamKey] || byKam[kamEmail] || {};
    const baselineSet = baselineGroups[_kamKey] || baselineGroups[kamEmail] || {};
    const elapsed = _commElapsedQuarterLabels(baseMonthOverride);
    if (elapsed.length < 2) return []; // nothing can have "stopped" in month 1
    const priorLabels = elapsed.slice(0, -1);

    const p1MinGmv = _commGetConfig('upsell_sku', 'p1_min_gmv', 5000);
    const p1Rate = _commGetConfig('upsell_sku', 'p1_rate', 0.01);
    const out = [];
    Object.keys(kamData).forEach(accountId => {
      const acctData = kamData[accountId];
      const firstVal = acctData[Object.keys(acctData)[0] || ''];
      const isNewFormat = firstVal && typeof firstVal === 'object' &&
        Object.values(firstVal)[0] && typeof Object.values(Object.values(firstVal)[0])[0] === 'object';
      const outletMap = isNewFormat ? acctData : { _all: acctData };
      const baselineByOutlet = baselineSet[accountId] || {};
      const legacySet = baselineByOutlet instanceof Set ? baselineByOutlet : null;
      Object.keys(outletMap).forEach(outletId => {
        const groups = outletMap[outletId];
        const outletBaseline = legacySet || (baselineByOutlet[outletId] instanceof Set ? baselineByOutlet[outletId] : new Set());
        Object.keys(groups).forEach(groupKey => {
          if (currentSet.has(accountId + '|' + outletId + '|' + groupKey)) return;
          if (outletBaseline.has(groupKey)) return; // P1-only scan: P3 stopped needs frozen baseline context — keep scope tight
          const monthData = groups[groupKey];
          for (let i = priorLabels.length - 1; i >= 0; i--) {
            const row = monthData[priorLabels[i]];
            const g = row ? (row.totalGmv || 0) : 0;
            if (g >= p1MinGmv) {
              out.push({ accountId, outletId, groupKey, kind: 'p1',
                lastComm: g * p1Rate, lastLabel: priorLabels[i] });
              break;
            }
          }
        });
      });
    });
    return out;
  } catch (e) { return []; }
}
window._upsellStoppedGroups = _upsellStoppedGroups;

// ── Upsell Outlet Engine ────────────────────────────────────────
// Returns { outlet_gmv, commission, new_gmv, comeback_gmv }
// Counts non-P1 items at new/comeback outlets only (P1 items excluded — they get 3% via P1)
function _commComputeUpsellOutlet(kamEmail, qnrrRaw, periodOverride, planCode, previewResolver) {
  // v244: rewritten to use bulkOutletsData via _tgtComputeKamNRR (portview logic)
  // Expansion = outlet never seen in any historical data (consistent with portview Expansion tab)
  // Comeback excluded — irregular buying patterns shouldn't earn outlet commission
  // v828: qnrrRaw (optional) = already-computed _qnrrComputeForCommission() result from the
  // caller (_commBuildKamPayout) — when provided, use QNRR-sourced expansion data instead of
  // _tgtComputeKamNRR (MoM). Was previously always MoM even when caller was in quarterly mode,
  // meaning outlets got wrongly INCLUDED in P1/P3 instead of excluded (or vice versa).
  const EMPTY = { outlet_gmv:0, commission:0, expansion_gmv:0, expansion_outlets:[], _expansionIds: new Set() };
  try {
    // v878 (phase 4): prefer the assigned scheme's own rule when one exists.
    const outletRule = planCode ? _commResolveRuleForMetric(planCode, 'upsell_gmv', 'outlet_expansion', previewResolver) : null;
    const outletTier = (outletRule && outletRule.active && outletRule.tiers[0]) ? outletRule.tiers[0] : null;
    const rate = outletTier ? Number(outletTier.payout_value) : _commGetConfig('upsell_outlet', 'rate', 0.005); // v835-fix: default was 0.015, live Supabase = 0.005

    if (qnrrRaw) {
      // v880-fix: v860-fix (2026-07-13) made this cumulative across every
      // elapsed quarter month to "match P1/P3's model" — but confirmed wrong
      // via Bush's own worked example (2026-07-19): a new outlet's Expansion
      // commission each month is that month's OWN current GMV alone (can go
      // up or down month to month — proven since a true cumulative running
      // total could never decrease, and Bush's example has Sep < Aug). The
      // outlet stays ELIGIBLE for Expansion all quarter (that part of "stays
      // in scope" was correct), but the GMV itself must never be summed
      // across months. Reverted to reading only qnrrRaw.currentPeriod's own
      // rows, matching pre-v860 behavior.
      const monthData = qnrrRaw.by_month ? qnrrRaw.by_month[qnrrRaw.currentPeriod] : null;
      const rows = (monthData && monthData.rows) || [];
      const expansionIds = new Set();
      let expansionGmv = 0;
      rows.forEach(r => {
        if (r.movement_type === 'expansion') {
          if (r.outlet_id) expansionIds.add(String(r.outlet_id));
          expansionGmv += parseFloat(r.curr_gmv) || 0;
        }
      });
      return {
        outlet_gmv: expansionGmv,
        commission: expansionGmv * rate,
        expansion_gmv: expansionGmv,
        expansion_outlets: [],
        _expansionIds: expansionIds
      };
    }

    if (typeof _tgtComputeKamNRR !== 'function') return EMPTY;
    const nrrResult = _tgtComputeKamNRR(kamEmail, null, periodOverride);
    if (!nrrResult) return EMPTY;

    // Sum expansion GMV across all cohorts (core + transferIn + newFromSales)
    const expansionGmv = (nrrResult.expansionGmv || 0)
      + (nrrResult.transferIn  && nrrResult.transferIn.expansionGmv  || 0)
      + (nrrResult.newFromSales && nrrResult.newFromSales.expansionGmv || 0);

    // Build expansion outlet ID set — used by _commComputeUpsellSku to exclude from P1/P3
    const expansionIds = new Set();
    const addExpansionIds = (detail) => {
      if (!detail) return;
      (detail.expansionDetail || []).forEach(g =>
        (g.outlets || []).forEach(o => { if(o.outletId) expansionIds.add(String(o.outletId)); })
      );
    };
    addExpansionIds(nrrResult);
    addExpansionIds(nrrResult.transferIn);
    addExpansionIds(nrrResult.newFromSales);

    return {
      outlet_gmv: expansionGmv,
      commission: expansionGmv * rate,
      expansion_gmv: expansionGmv,
      expansion_outlets: [],
      _expansionIds: expansionIds
    };
  } catch(e) {
    console.warn('[CommEngine] _commComputeUpsellOutlet error', e);
    return EMPTY;
  }
}

// ── Quarterly drill-down helper (shared) ─────────────────────────────────
// v828: returns a _tgtComputeKamNRR-shaped result { cohortDetail, expansionDetail,
// comebackDetail, cohortCount, cohortGmv, expansionGmv, comebackGmv } built from
// bulkQnrrData instead of MoM bulkHistoryData — used by every drill-down sheet in
// 07b_cds.js so "click for detail" always matches the quarterly total shown above it.
// Returns null if not in quarterly mode or QNRR data unavailable (caller should then
// fall back to its own existing _tgtComputeKamNRR(email,null) call).
function _commQnrrDrillResult(email, scope) {
  try {
    const policy = _nrrGovResolveForVisibleScope();
    if (!policy || policy.commission_mode !== 'quarterly') return null;
    if (typeof window._qnrrComputeForCommission !== 'function') return null;
    const qr = window._qnrrComputeForCommission(email, scope || 'kam');
    if (!qr || !qr.by_month || !qr.currentPeriod) return null;
    const monthData = qr.by_month[qr.currentPeriod];
    const rows = (monthData && monthData.rows) || [];

    function groupByAccount(movementType) {
      const byAcct = {};
      rows.filter(r => r.movement_type === movementType).forEach(r => {
        const aid = r.account_id || r.account_name;
        if (!byAcct[aid]) byAcct[aid] = { acctId: aid, acctName: r.account_name, outlets: [], prevTotal: 0, currTotal: 0 };
        const prev = Math.round(r.base_gmv || 0), curr = Math.round(r.curr_gmv || 0);
        byAcct[aid].outlets.push({ outletId: r.outlet_id, outletName: r.account_name, prevGmv: prev, currGmv: curr,
          delta: prev > 0 ? Math.round((curr - prev) / prev * 100) : null });
        byAcct[aid].prevTotal += prev; byAcct[aid].currTotal += curr;
      });
      return Object.values(byAcct);
    }

    const cohortDetail    = groupByAccount('core_nrr');
    const expansionDetail = groupByAccount('expansion');
    const comebackDetail  = groupByAccount('comeback');
    const sumCurr = arr => arr.reduce((s,g)=>s+g.currTotal,0);
    const sumCnt  = arr => arr.reduce((s,g)=>s+g.outlets.length,0);

    return {
      nrr: qr.nrr, cohortCount: sumCnt(cohortDetail), cohortGmv: sumCurr(cohortDetail),
      baselinePrevGmv: qr.baselinePrevGmv,
      comebackGmv: sumCurr(comebackDetail), comebackCount: sumCnt(comebackDetail),
      expansionGmv: sumCurr(expansionDetail), expansionCount: sumCnt(expansionDetail),
      cohortDetail, comebackDetail, expansionDetail,
      // v860-fix: forward daysElapsed/daysInMonth from qr (see the matching
      // fix in 07c_qnrr_view.js's _qnrrComputeForCommission) — 07b_cds.js's
      // rr() helper and totals bar both read nr.daysElapsed/nr.daysInMonth
      // and silently fell back to two different wrong constants when this
      // wrapper dropped them on the floor.
      daysElapsed: qr.daysElapsed, daysInMonth: qr.daysInMonth,
      transferIn: null, newFromSales: null // quarterly mode doesn't split these separately
    };
  } catch(e) { console.warn('[CommEngine] _commQnrrDrillResult error', e); return null; }
}
window._commQnrrDrillResult = _commQnrrDrillResult;

// ── Handover GMV-tier config reader ──────────────────────────────
// gmv_tiers lives in target_settings.handover_params alongside the legacy
// flat scalar keys — an array, so it CANNOT go through _commGetConfig
// (that helper does Number(params[paramName]) on every read, which would
// coerce an array to NaN). Empty/absent => caller falls back to the
// legacy flat 2-tier logic (v90 rollout safety: engine change is a safe
// no-op until an admin populates gmv_tiers via the Cockpit).
function _commGetHandoverGmvTiers() {
  try {
    const raw = _tgtSettings && _tgtSettings['handover_params'];
    const params = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : null;
    return (params && Array.isArray(params.gmv_tiers)) ? params.gmv_tiers : [];
  } catch(e) { return []; }
}

// ── Handover Retention Engine ───────────────────────────────────
// Uses bulkHandoverData.byNewKamName — accounts that transferred TO this KAM
// Returns { accounts, baseline_gmv, current_gmv, retention_pct, tier, payout,
//           detail[], gmv_tier_label, gmv_bucket_gmv }
// GMV-tier mode (v91): the KAM's AGGREGATE baseline handover GMV (baselineNorm,
// summed across every account handed over this period — not per-account)
// picks one gmv_tiers[] bucket; that bucket's own threshold ladder is then
// applied to the KAM's existing blended retention %. Mirrored byte-for-byte
// in /nrr's nrrComputeHandoverForKam (nrr_commission.js) — keep both in sync,
// this is the SECOND place these two functions must match exactly (see the
// divergence-bug note there).
function _commComputeHandoverRetention(kamEmail, planCode, previewResolver) {
  // V3 Tactic B:
  // - Source: bulkHandoverData.byNewKamName (Q10 V3) แทน portviewBulkData isNew detection
  // - Filter: prevOwner === 'SALE' เท่านั้น (PM/ADMIN/KAM ไม่นับ)
  // - Baseline: baseline_gmv (GMV เต็มเดือนที่โอน) normalize ÷ baselineDays × 30
  // - Current: perf_gmv (GMV เดือน M+1) normalize ÷ perfDays × 30
  // - Window: transfer_month = เดือนก่อน (M-1) เท่านั้น
  const EMPTY = { accounts:0, baseline_gmv:0, current_gmv:0, retention_pct:0,
                  tier:0, payout:0, detail:[], gmv_tier_label:null, gmv_bucket_gmv:0 };
  try {
    const hd = (typeof bulkHandoverData !== 'undefined' && bulkHandoverData)
              ? bulkHandoverData : { byNewKamName:{} };

    // หา KAM display name จาก portviewBulkData (byNewKamName index ใช้ชื่อ ไม่ใช่ email)
    const pvAccounts = (portviewBulkData || []).filter(r => r.kamEmail === kamEmail);
    const kamName = pvAccounts.length ? (pvAccounts[0].kamName || '') : '';
    if (!kamName) return EMPTY;

    // current month label เพื่อระบุ transfer_month = เดือนก่อน
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthLabel = prevMonth.getFullYear() + '-' +
                           String(prevMonth.getMonth() + 1).padStart(2, '0'); // YYYY-MM

    // ดึงร้านที่โอนมาหา KAM นี้ จาก Q10 V3
    const hoRows = (hd.byNewKamName && hd.byNewKamName[kamName]) || [];

    // Filter: SALE เท่านั้น + transfer_month = เดือนก่อน
    const handoverRows = hoRows.filter(r =>
      (r.prevOwner || '').toUpperCase() === 'SALE' &&
      r.transferMonth === prevMonthLabel
    );

    if (!handoverRows.length) return EMPTY;

    // Normalize: daily rate × 30 เพื่อให้จำนวนวันแฟร์ทั้งสองฝั่ง
    let baselineNorm = 0, perfNorm = 0;
    const detail = [];
    handoverRows.forEach(r => {
      const bDays = r.baselineDays > 0 ? r.baselineDays : 30;
      const pDays = r.perfDays     > 0 ? r.perfDays     : 30;
      const bNorm = (r.baselineGmv || 0) / bDays * 30;
      const pNorm = (r.perfGmv     || 0) / pDays * 30;
      baselineNorm += bNorm;
      perfNorm     += pNorm;
      detail.push({
        account_id:     r.accountId,
        name:           r.accountName,
        oldKamName:     r.kamName || '',
        transfer_month: r.transferMonth,
        baseline:       Math.round(bNorm),
        current:        Math.round(pNorm),
        baseline_raw:   r.baselineGmv || 0,
        perf_raw:       r.perfGmv || 0,
        outlet_id:      r.outletId || ''
      });
    });

    const retentionPct = baselineNorm > 0 ? Math.round((perfNorm / baselineNorm * 100) * 10) / 10 : 0;

    let tier = 0, payout = 0, gmvTierLabel = null;
    // v878 (phase 5): prefer the assigned scheme's own 'handover' rule
    // (nested GMV-tier ladder doesn't fit the flat commission_rule_tiers
    // table, so it lives in the rule's tier_config jsonb column instead —
    // see the phase-1 migration) when one exists; otherwise fall back to
    // the legacy global target_settings blob exactly as before.
    const handoverRule = planCode ? _commResolveRuleForMetric(planCode, 'handover', null, previewResolver) : null;
    const gmvTiers = (handoverRule && handoverRule.active && handoverRule.tier_config && Array.isArray(handoverRule.tier_config.gmv_tiers))
      ? handoverRule.tier_config.gmv_tiers
      : _commGetHandoverGmvTiers();
    if (gmvTiers.length) {
      // GMV-tier mode: aggregate baseline GMV picks ONE bucket, then a
      // best-match scan (highest threshold cleared wins) over that
      // bucket's own ladder. No match (e.g. below the lowest configured
      // gmv_min) => payout ฿0 — an intentional gap, not a fallback.
      const matched = gmvTiers.find(t =>
        baselineNorm >= Number(t.gmv_min || 0) &&
        (t.gmv_max === null || t.gmv_max === undefined || baselineNorm <= Number(t.gmv_max))
      );
      if (matched) {
        gmvTierLabel = matched.label || null;
        const thresholds = (matched.thresholds || []).slice()
          .sort((a, b) => Number(b.min_retention_pct || 0) - Number(a.min_retention_pct || 0));
        for (let i = 0; i < thresholds.length; i++) {
          if (retentionPct >= Number(thresholds[i].min_retention_pct || 0)) {
            payout = Number(thresholds[i].payout || 0);
            tier = thresholds.length - i; // highest threshold cleared = highest tier number
            break;
          }
        }
      }
    } else {
      // Legacy flat 2-tier fallback — used until gmv_tiers is populated
      // via the Cockpit (rollout safety: engine ships before the UI does).
      const t2Pct   = _commGetConfig('handover', 'tier2_pct',    100);
      const t3Pct   = _commGetConfig('handover', 'tier3_pct',    120);
      const t2Pay   = _commGetConfig('handover', 'tier2_payout', 2500);
      const t3Bonus = _commGetConfig('handover', 'tier3_bonus',  2500);
      if (retentionPct >= t3Pct)      { tier = 3; payout = t2Pay + t3Bonus; }
      else if (retentionPct >= t2Pct) { tier = 2; payout = t2Pay; }
    }

    return {
      accounts:       handoverRows.length,
      baseline_gmv:   Math.round(baselineNorm),
      current_gmv:    Math.round(perfNorm),
      retention_pct:  retentionPct,
      tier, payout, detail,
      gmv_tier_label: gmvTierLabel,
      gmv_bucket_gmv: Math.round(baselineNorm)
    };
  } catch(e) {
    console.warn('[CommEngine] _commComputeHandoverRetention error', e);
    return EMPTY;
  }
}

// ── GMV Gate Engine ─────────────────────────────────────────────
// Returns { ach_pct, cap_multiplier, gate_active }
// v878 (phase 3): planCode optional — when the assigned scheme has its own
// 'portfolio_gate' rule (tiers keyed on %NRR, payout_value = multiplier),
// use that; otherwise fall back to the legacy global target_settings blob
// exactly as before (this is the only path today, since no scheme has been
// migrated to a per-scheme gate rule yet — see the phase-3 seed migration).
// No longer hardcoded KAM-only: the restriction now lives in whether a
// role's assigned scheme includes this component at all, not in code.
function _commComputeGmvGate(kamEmail, nrrPct, planCode, previewResolver) {
  // Gate based on NRR% — same metric already computed in _commBuildKamPayout
  // nrrPct passed in directly (no need to recompute GMV separately)
  try {
    if (nrrPct === null || nrrPct === undefined) {
      return { ach_pct: null, cap_multiplier: 1.0, gate_active: false };
    }

    let cap = 1.0;
    const tierMatch = planCode ? _commMatchComponentTier(planCode, 'portfolio_gate', null, nrrPct, previewResolver) : null;
    if (tierMatch) {
      cap = Number(tierMatch.payout_value ?? 1.0);
    } else {
      const t1 = _commGetConfig('gmv_gate', 'threshold_1', 98); // v835-fix: default was 95, live Supabase = 98 — NRR% threshold
      const t2 = _commGetConfig('gmv_gate', 'threshold_2', 95); // v835-fix: default was 90, live Supabase = 95
      const c1 = _commGetConfig('gmv_gate', 'cap_1', 0.3);      // v835-fix: default was 0.70, live Supabase = 0.3
      const c2 = _commGetConfig('gmv_gate', 'cap_2', 0);        // v835-fix: default was 0.35, live Supabase = 0
      if (nrrPct < t2)      cap = c2;
      else if (nrrPct < t1) cap = c1;
    }

    return {
      ach_pct: nrrPct,
      cap_multiplier: cap,
      gate_active: cap < 1.0
    };
  } catch(e) {
    console.warn('[CommEngine] _commComputeGmvGate error', e);
    return { ach_pct: null, cap_multiplier: 1.0, gate_active: false };
  }
}

// ── TL Upsell Multiplier Engine ────────────────────────────────
// team_upsell_gmv = Σ(P1_gmv + P3_incremental) across all KAMs in team
// team_upsell_pct = team_upsell_gmv / team_NRR_baseline × 100
// multiplier determined by tier table from commission_rules
function _commComputeTeamUpsellMult(tlEmail, isQuarterly, baseMonthOverride, planCode, previewResolver) {
  const EMPTY = { team_upsell_gmv:0, team_baseline_gmv:0, team_upsell_pct:0, multiplier:1.0, tier:1 };
  try {
    // v_adsplit: portview lists portfolio HOLDERS — someone whose real
    // profiles.role is ad/pm/etc. can appear under this TL without being a
    // team KAM. Their upsell must not count toward the TL's team upsell %
    // (numerator NOR baseline), matching the same exclusion in
    // _rowInScope (07c) and _commBuildSnapshotRows.
    const _nonKamSet = (window.nrrRoleRoster && window.nrrRoleRoster.nonKamSet) || new Set();
    const kamEmails = Array.from(new Set(
      (portviewBulkData || [])
        .filter(r => r.tlEmail === tlEmail && r.kamEmail && !_nonKamSet.has((r.kamEmail || '').toLowerCase()))
        .map(r => r.kamEmail)
    ));
    if (!kamEmails.length) return EMPTY;

    let teamUpsellGmv = 0;
    let teamBaselineGmv = 0;

    // Fast path: use pre-computed team summary (sense_upsell_team.csv)
    // Avoids loading 15 per-KAM bundles just for the multiplier
    const hasTeamData = typeof bulkUpsellTeamData !== 'undefined' &&
                        bulkUpsellTeamData && Object.keys(bulkUpsellTeamData).length > 0;

    kamEmails.forEach(ke => {
      if (hasTeamData && bulkUpsellTeamData[ke]) {
        teamUpsellGmv += bulkUpsellTeamData[ke].tl_upsell_base || 0;
      } else if (bulkUpsellData && bulkUpsellData.loaded) {
        // Fallback: compute from per-KAM bundle if loaded
        // v854-fix: was missing baseMonthOverride — silently fell back to rolling/
        // monthly logic for this KAM's contribution even in quarterly mode whenever
        // they were absent from that day's team-summary CSV.
        const upsell = _commComputeUpsellSku(ke, undefined, baseMonthOverride);
        teamUpsellGmv += upsell.tl_upsell_base;
      }
      // v828: quarterly mode sums each KAM's fixed-base GMV from QNRR, not MoM rolling base
      const raw = isQuarterly && typeof window._qnrrComputeForCommission === 'function'
        ? window._qnrrComputeForCommission(ke, 'kam')
        : _tgtComputeKamNRR(ke, null);
      teamBaselineGmv += raw ? (raw.baselinePrevGmv || 0) : 0;
    });

    const upsellPct = teamBaselineGmv > 0 ? (teamUpsellGmv / teamBaselineGmv * 100) : 0;

    // v878 (phase 3): tier lookup — prefer the assigned scheme's own
    // 'tl_upsell_mult' rule (commission_rule_tiers shape: min_value/
    // max_value/payout_value, payout_value=multiplier) via
    // _commMatchComponentTier; fall back to the exact same hardcoded
    // default tiers as before when no scheme has this component configured
    // yet. Previously read `_commRuleConfig.rules['tl_upsell_mult']`, a key
    // that could never match (rules is keyed by plan_id, not metric_code) —
    // always silently fell through to the hardcoded defaults below.
    // Default tiers per spec: <2%=1.0x, 2-2.9%=1.2x, 3-3.9%=1.35x, 4-4.9%=1.5x, ≥5%=1.8x
    let multiplier = 1.0, tier = 1;
    try {
      const tierMatch = planCode ? _commMatchComponentTier(planCode, 'tl_upsell_mult', null, upsellPct, previewResolver) : null;
      if (tierMatch) {
        multiplier = Number(tierMatch.payout_value ?? 1.0);
        tier = tierMatch.tier_order || 1;
      } else {
        const tiers = [
          { min_pct:0, max_pct:1.99, multiplier:1.00 },
          { min_pct:2, max_pct:2.99, multiplier:1.20 },
          { min_pct:3, max_pct:3.99, multiplier:1.35 },
          { min_pct:4, max_pct:4.99, multiplier:1.50 },
          { min_pct:5, max_pct:null, multiplier:1.80 }
        ];
        for (let i = tiers.length - 1; i >= 0; i--) {
          if (upsellPct >= Number(tiers[i].min_pct || 0)) {
            multiplier = Number(tiers[i].multiplier || 1.0);
            tier = i + 1;
            break;
          }
        }
      }
    } catch(e) {}

    return { team_upsell_gmv: teamUpsellGmv, team_baseline_gmv: teamBaselineGmv,
             team_upsell_pct: Math.round(upsellPct * 100) / 100, multiplier, tier,
             kam_count: kamEmails.length };
  } catch(e) {
    console.warn('[CommEngine] _commComputeTeamUpsellMult error', e);
    return EMPTY;
  }
}

// ── KAM Full Payout Builder ─────────────────────────────────────
// Returns complete breakdown for one KAM
// v878 (phase 8): planRole (optional, defaults to 'kam' — byte-identical to
// before for every existing caller) is the REAL engine role bucket used
// ONLY for commission-plan/tier resolution (_commGetAssignmentPlan/
// _commPayoutForPctByCode) — this is what makes a pm/ad/etc person's own
// assigned scheme apply instead of always resolving as if they were a kam.
// The 'kam' literal passed to _qnrrComputeForCommission/_tgtComputeKamNRR
// below is a DIFFERENT concept (data-scope: "this person's own portfolio,
// not a team rollup") and correctly stays 'kam' regardless of planRole —
// pm/ad people's own-portfolio NRR is still looked up by email the same
// way, per the same bulkQnrrData index a KAM's is.
function _commBuildKamPayout(kamEmail, periodOverride, planRole, previewResolver) {
  const role = planRole || 'kam';
  try {
    const period  = periodOverride || _nrrExclusionCurrentPeriod();
    // v829: resolve policy for the PERIOD BEING COMPUTED, not always "today" — matters when
    // retroactively locking/auto-computing a past month whose quarter/mode may differ from
    // whatever quarter is active right now (e.g. locking July from within Q4/October).
    const policy  = periodOverride ? _nrrGovGet(periodOverride, 'all', 'all') : _nrrGovResolveForVisibleScope();
    const isQ     = policy && policy.commission_mode === 'quarterly';
    const baseMo  = isQ ? (policy.base_month || null) : null;

    // ── NRR source ────────────────────────────────────────────────
    // [quarterly] read from bulkQnrrData via _qnrrComputeForCommission (same source as QNRR sheet)
    //             periodOverride threads through as asOfPeriod for retroactive lock
    // [monthly]   read from bulkHistoryData via _tgtComputeKamNRR — periodOverride threads through
    //             as asOfPeriod for frozen historical-month NRR (retroactive lock / auto-compute)
    let raw, rawPct, governedPct, pct;
    if (isQ && typeof window._qnrrComputeForCommission === 'function') {
      raw = window._qnrrComputeForCommission(kamEmail, 'kam', periodOverride);
    } else {
      raw = _tgtComputeKamNRR(kamEmail, null, periodOverride);
    }
    rawPct      = raw && raw.nrr !== null ? raw.nrr * 100 : null; // v92-fix: unrounded, see _nrrGovernedPct
    governedPct = _nrrGovernedPct(raw, kamEmail, null);
    pct         = governedPct !== null ? governedPct : rawPct;

    const planCode  = _commGetAssignmentPlan(period, role, kamEmail, role);
    const nrrPayout = _commPayoutForPctByCode(planCode, role, pct);

    // ── Upsell ────────────────────────────────────────────────────
    // [quarterly] Expansion GMV comes from qnrrResult (bulkQnrrData), Upsell SKU uses pin window
    // [monthly]   existing logic unchanged
    let upsellSku, upsellOutlet;
    // Q3C Team SQL keys by ka_owner (display name), not email — try both
    const _pvRow = (portviewBulkData || []).find(r => r.kamEmail === kamEmail);
    const _kamDisplayName = _pvRow ? (_pvRow.kamName || '') : '';
    // v836-fix: was `bulkUpsellData.loaded` alone — a GLOBAL flag that flips true the
    // moment ANY one KAM's per-KAM bundle is fetched (e.g. a TL/Admin drilling into just
    // one KAM's detail, or that KAM's own session auto-fetching it on login) and then
    // stays true for the rest of the browser session. Every OTHER KAM would then also
    // take the "detailed" branch below even though THEIR OWN bundle was never fetched —
    // _commComputeUpsellSku's byKam lookup finds nothing for them and silently returns
    // ฿0 upsell commission instead of falling back to the correct team-summary number.
    // Now checks THIS SPECIFIC KAM's bundle presence (same kamName-or-email key
    // resolution _commComputeUpsellSku itself uses) so one KAM's data being loaded can
    // never affect another KAM's branch decision.
    const _bundleLoaded = typeof bulkUpsellData !== 'undefined' && bulkUpsellData && bulkUpsellData.loaded &&
      bulkUpsellData.byKam && (
        (bulkUpsellData.byKam[_kamDisplayName] && Object.keys(bulkUpsellData.byKam[_kamDisplayName]).length > 0) ||
        (bulkUpsellData.byKam[kamEmail] && Object.keys(bulkUpsellData.byKam[kamEmail]).length > 0)
      );
    const _teamRow = typeof bulkUpsellTeamData !== 'undefined' && bulkUpsellTeamData &&
      (bulkUpsellTeamData[kamEmail] || bulkUpsellTeamData[_kamDisplayName] || null);
    const upsellLoading = !_bundleLoaded && !_teamRow; // v228-fix: flag when upsell data unavailable
    if (!_bundleLoaded && _teamRow) {
      // Fast path: use pre-computed totals from team summary (sense_upsell_team.csv)
      // v230fix2: return full p1/p3 sub-objects matching _commComputeUpsellSku structure
      // so _commBuildSnapshotRows can safely access .p1.gmv / .p3.gmv_incremental
      // v878 (phase 4): same per-scheme-rule-first, blob-fallback resolution
      // as the slow path below (_commComputeUpsellSku/_commComputeUpsellOutlet)
      // — keeps the fast (team-summary CSV) path's rates consistent with the
      // slow path's for any KAM who might hit either branch across sessions.
      const _p1R = planCode ? _commResolveRuleForMetric(planCode, 'upsell_gmv', 'p1_new_sku', previewResolver) : null;
      const _p3R = planCode ? _commResolveRuleForMetric(planCode, 'upsell_gmv', 'p3_growth', previewResolver) : null;
      const _outR = planCode ? _commResolveRuleForMetric(planCode, 'upsell_gmv', 'outlet_expansion', previewResolver) : null;
      const p1Rate  = (_p1R && _p1R.active && _p1R.tiers[0]) ? Number(_p1R.tiers[0].payout_value) : _commGetConfig('upsell_sku',   'p1_rate', 0.01);       // v835-fix: was 0.03
      const p3Rate  = (_p3R && _p3R.active && _p3R.tiers[0]) ? Number(_p3R.tiers[0].payout_value) : _commGetConfig('upsell_sku',   'p3_rate', 0.01);       // v835-fix: was 0.03
      const outRate = (_outR && _outR.active && _outR.tiers[0]) ? Number(_outR.tiers[0].payout_value) : _commGetConfig('upsell_outlet', 'rate',   0.005);      // v835-fix: was 0.015
      // v_catbonus: prefer the group-grain fast-path file
      // (sense_upsell_team_groups.csv → bulkUpsellTeamGroups) so per-category
      // rates apply even on the fast (no per-KAM-bundle) path. Falls back to
      // the flat KAM-scalar multiply when that file isn't loaded (rollout-safe).
      const _rateMap = _commResolveUpsellRateMap(planCode, previewResolver);
      const _teamGroups = (typeof bulkUpsellTeamGroups !== 'undefined' && bulkUpsellTeamGroups)
        ? (bulkUpsellTeamGroups[kamEmail] || bulkUpsellTeamGroups[_kamDisplayName] || null)
        : null;
      let p1Comm, p3Comm;
      const _p1Groups = [], _p3Groups = [];
      if (_teamGroups && _teamGroups.length) {
        p1Comm = 0; p3Comm = 0;
        _teamGroups.forEach(gr => {
          const g1 = Number(gr.p1_gmv) || 0, g3 = Number(gr.p3_incremental) || 0;
          if (g1 > 0) {
            const _r = _commUpsellRateFor(_rateMap, p1Rate, gr.category, gr.group_key);
            p1Comm += g1 * _r;
            _p1Groups.push({ groupKey: gr.group_key, category: gr.category || null, applied_rate: _r, total_gmv: g1, commission: g1 * _r });
          }
          if (g3 > 0) {
            const _r = _commUpsellRateFor(_rateMap, p3Rate, gr.category, gr.group_key);
            p3Comm += g3 * _r;
            _p3Groups.push({ groupKey: gr.group_key, category: gr.category || null, applied_rate: _r, incremental: g3, commission: g3 * _r });
          }
        });
      } else {
        p1Comm = _teamRow.p1_gmv  * p1Rate;
        p3Comm = _teamRow.p3_incr * p3Rate;
      }
      const outComm = _teamRow.outlet_gmv * outRate;
      upsellSku = {
        p1: { gmv: _teamRow.p1_gmv,  comm: p1Comm, groups: _p1Groups },
        p3: { gmv_incremental: _teamRow.p3_incr, comm: p3Comm, groups: _p3Groups },
        total_comm: p1Comm + p3Comm,
        p1_comm: p1Comm, p3_comm: p3Comm,
        p1_groups: _p1Groups, p3_groups: _p3Groups,
        total_gmv_eligible: _teamRow.p1_gmv + _teamRow.p3_incr,
        tl_upsell_base: _teamRow.tl_upsell_base || 0
      };
      upsellOutlet = { commission: outComm, outlet_gmv: _teamRow.outlet_gmv };
    } else {
      upsellOutlet = _commComputeUpsellOutlet(kamEmail, isQ ? raw : null, periodOverride, planCode, previewResolver);
      // [quarterly] pass baseMonthOverride to pin P1/P3 3M window; [monthly] null = rolling
      upsellSku    = _commComputeUpsellSku(kamEmail, upsellOutlet._expansionIds, baseMo, planCode, previewResolver);
    }
    const handover = _commComputeHandoverRetention(kamEmail, planCode, previewResolver); // MoM always — do not touch
    const gate     = _commComputeGmvGate(kamEmail, pct, planCode, previewResolver);

    const subtotal    = nrrPayout + upsellSku.total_comm + upsellOutlet.commission + handover.payout;
    const finalPayout = Math.round(subtotal * gate.cap_multiplier);

    return {
      period, kamEmail,
      nrr_pct: pct,
      nrr_payout: nrrPayout,
      // v_qtrux: the base month the upsell computation was anchored to
      // (null in monthly/rolling mode) — lets display surfaces build the
      // per-group quarter timeline (_upsellQuarterTimeline) with the exact
      // same anchor, never re-deriving policy themselves.
      base_month_used: baseMo,
      upsell_sku: upsellSku,
      upsell_outlet: upsellOutlet,
      handover,
      gate,
      subtotal,
      gate_cap: gate.cap_multiplier,
      upsell_loading: upsellLoading,
      commission_mode: isQ ? 'quarterly' : 'monthly',
      base_month:      baseMo,
      quarter_id:      isQ ? (policy.quarter_id || null) : null,
      nrr_base_gmv:    isQ && raw ? Math.round(raw.baselinePrevGmv || 0) : null,
      final_payout: finalPayout
    };
  } catch(e) {
    console.warn('[CommEngine] _commBuildKamPayout error', e);
    return { nrr_payout:0, upsell_sku:{total_comm:0}, upsell_outlet:{commission:0},
             handover:{payout:0}, gate:{cap_multiplier:1,gate_active:false},
             subtotal:0, gate_cap:1, final_payout:0 };
  }
}

// ── TL Full Payout Builder ──────────────────────────────────────
function _commBuildTlPayout(tlEmail, periodOverride, previewResolver) {
  try {
    const period = periodOverride || _nrrExclusionCurrentPeriod();
    // v829: resolve policy for the period being computed, not always "today" (see _commBuildKamPayout)
    const policy = periodOverride ? _nrrGovGet(periodOverride, 'all', 'all') : _nrrGovResolveForVisibleScope();
    const isQ    = policy && policy.commission_mode === 'quarterly';
    const baseMo = isQ ? (policy.base_month || null) : null;

    // [quarterly] TL NRR from QNRR sheet (tl scope); [monthly] existing _tgtComputeKamNRR,
    // periodOverride threads through as asOfPeriod for frozen historical-month NRR
    let raw;
    if (isQ && typeof window._qnrrComputeForCommission === 'function') {
      raw = window._qnrrComputeForCommission(tlEmail, 'tl', periodOverride);
    } else {
      raw = _tgtComputeKamNRR(null, tlEmail, periodOverride);
    }
    const rawPct      = raw && raw.nrr !== null ? raw.nrr * 100 : null; // v92-fix: unrounded, see _nrrGovernedPct
    const governedPct = _nrrGovernedPct(raw, null, tlEmail);
    const pct         = governedPct !== null ? governedPct : rawPct;
    const planCode    = _commGetAssignmentPlan(period, 'tl', tlEmail, 'tl');
    const nrrPayout   = _commPayoutForPctByCode(planCode, 'tl', pct);

    const upsellMult = _commComputeTeamUpsellMult(tlEmail, isQ, baseMo, planCode, previewResolver);
    const finalPayout = Math.round(nrrPayout * upsellMult.multiplier);

    return { period, tlEmail, nrr_pct: pct, nrr_payout: nrrPayout,
             upsell_mult: upsellMult, final_payout: finalPayout };
  } catch(e) {
    console.warn('[CommEngine] _commBuildTlPayout error', e);
    return { nrr_payout:0, upsell_mult:{multiplier:1.0,tier:1}, final_payout:0 };
  }
}

// Expose to window
window._commGetConfig = _commGetConfig;
window._commComputeUpsellSku = _commComputeUpsellSku;
window._commComputeUpsellOutlet = _commComputeUpsellOutlet;
window._commComputeHandoverRetention = _commComputeHandoverRetention;
window._commComputeGmvGate = _commComputeGmvGate;
window._commComputeTeamUpsellMult = _commComputeTeamUpsellMult;
window._commBuildKamPayout = _commBuildKamPayout;
window._commBuildTlPayout = _commBuildTlPayout;


// SECTION:TARGETS
async function loadTargets(quarter) {
  if (!quarter) quarter = _tgtCurrentQuarter();
  const months = _tgtQuarterMonths(quarter);

  const hit = _tgtQuarterCache[quarter];
  if (hit && (Date.now() - hit.ts) < _TGT_CACHE_TTL) {
    _tgtCache = { ...hit.cache };
    _tgtSettings = { ...hit.settings };
    _nrrGovPolicies = { ...(hit.nrrPolicies || {}) };
    _commRuleConfig = JSON.parse(JSON.stringify(hit.commRules || {plans:{},rules:{},tiers:{},componentRules:{}}));
    _nrrExclusions = JSON.parse(JSON.stringify(hit.nrrExclusions || []));
    _commissionSnapshots = JSON.parse(JSON.stringify(hit.commissionSnapshots || []));
    _tgtLoaded = true;
    _tgtSettingsLoadFailed = false; // v835-fix: cache only ever holds successful settings loads now (see bottom of function)
    window._tgtSettingsLoadFailed = false;
    return;
  }

  _tgtCache = {};
  _tgtSettings = { nrr_threshold: 98 };
  _tgtSettingsLoadFailed = false; // v835-fix: reset each fresh load attempt
  _nrrGovPolicies = {};
  _commRuleConfig = { plans:{}, rules:{}, tiers:{}, componentRules:{} };
  _nrrExclusions = [];
  _commissionSnapshots = [];
  try {
    const { data: rows, error: rowsErr } = await supa.from('targets')
      .select('period,level,for_email,gmv_target')
      .in('period', months);
    if (rowsErr) throw new Error(rowsErr.message);
    (rows || []).forEach(r => {
      const key = `${r.period}|${r.level}|${r.for_email}`;
      _tgtCache[key] = r.gmv_target;
    });
  } catch (e) {
    console.warn('[Target] target load failed:', e.message);
  }

  try {
    // v559 PARAMS READBACK FIX: load ALL target_settings keys.
    // Cockpit component params are saved under '{metric}_params' but only
    // 'nrr_threshold' was ever read back — cockpit edits never reached other
    // sessions, so the engine silently computed payouts with hardcoded
    // defaults. Now every key is hydrated into _tgtSettings on loadTargets.
    const { data: sets, error: setsErr } = await supa.from('target_settings')
      .select('key,value');
    if (setsErr) throw new Error(setsErr.message);
    (sets || []).forEach(s => {
      if (!s || !s.key) return;
      if (s.key === 'nrr_threshold') { _tgtSettings.nrr_threshold = parseFloat(s.value) || 98; return; }
      if (/_params$/.test(s.key)) {
        try { _tgtSettings[s.key] = JSON.parse(s.value); }
        catch(e2) { _tgtSettings[s.key] = s.value; } // _commGetConfig parses string values too
        return;
      }
      _tgtSettings[s.key] = s.value;
    });
  } catch (e) {
    _tgtSettingsLoadFailed = true;
    console.error('[Target] 🔴 target_settings load failed — commission math will run on hardcoded JS defaults, NOT live Cockpit config:', e.message);
  }

  try {
    const { data: policies, error: polErr } = await supa.from('nrr_policies')
      .select('period_month,scope_type,scope_key,base_mode,base_month,commission_mode,quarter_id,status,updated_by,updated_at')
      .in('period_month', months);
    if (polErr) throw new Error(polErr.message);
    (policies || []).forEach(p => {
      _nrrGovPolicies[_nrrGovKey(p.period_month, p.scope_type, p.scope_key)] = { ...p };
    });
  } catch (e) {
    console.warn('[NRR governance] load failed (table may not exist yet):', e.message);
  }

  try {
    const { data: excl, error: exclErr } = await supa.from('nrr_exclusions')
      .select('id,period_month,account_id,outlet_id,target_kam_email,target_tl_email,reason_code,reason_text,status,requested_by,requested_at,reviewed_by,reviewed_at,review_note,base_gmv,estimated_base_gmv')
      .in('period_month', months);
    if (exclErr) throw new Error(exclErr.message);
    _nrrExclusions = excl || [];
  } catch (e) {
    console.warn('[NRR exclusions] load failed (table may not have v208d columns yet):', e.message);
    _nrrExclusions = [];
  }


  try {
    const { data: snaps, error: snapErr } = await supa.from('commission_payout_snapshots')
      .select('id,period_month,beneficiary_role,beneficiary_email,team_lead_email,raw_nrr_pct,governed_nrr_pct,payout_amount,snapshot_status,breakdown,updated_at,updated_by')
      .in('period_month', months);
    if (snapErr) throw new Error(snapErr.message);
    _commissionSnapshots = snaps || [];
  } catch (e) {
    console.warn('[Commission snapshots] load failed:', e.message);
    _commissionSnapshots = [];
  }

  try {
    // v878 (phase 8/9): roster of pm/admin/sales/sales_tl/ad/ad_tl people —
    // profiles is the real source of truth for "who has this role" (unlike
    // portviewBulkData/_buildKamGroups, which are kam/tl-only by construction).
    const { data: otherRoleRows, error: otherRoleErr } = await supa.from('profiles')
      .select('email,role,full_name')
      .in('role', ['pm','admin','sales','sales_tl','ad','ad_tl']);
    if (otherRoleErr) throw new Error(otherRoleErr.message);
    _commOtherRoleRoster = (otherRoleRows || [])
      .filter(p => p && p.email)
      .map(p => ({ email: p.email, role: _commEngineRole(p.role), name: p.full_name || p.email }));
    // v_adsplit: keep the shared window.nrrRoleRoster (consumed by
    // 07c_qnrr_view.js's _rowInScope) warm from this fetch too — same
    // source table, so whichever of the two loaders runs first wins.
    try {
      const nonKam = new Set(), ad = new Set();
      (otherRoleRows || []).forEach(p => {
        if (!p || !p.email) return;
        const em = p.email.toLowerCase();
        nonKam.add(em);
        if (p.role === 'ad' || p.role === 'ad_tl') ad.add(em);
      });
      window.nrrRoleRoster = { loaded: true, nonKamSet: nonKam, adSet: ad };
    } catch (e) {}
  } catch (e) {
    console.warn('[Commission other-role roster] load failed:', e.message);
    _commOtherRoleRoster = [];
  }

  try {
    // v210c: load the full Rule Library, not only the two standard plans.
    // v878 (phase 3): widened from ['tl','kam'] to all 8 canonical roles —
    // additive only, existing tl/kam plans/behavior unaffected, just no
    // longer hides plans an admin creates for pm/admin/ad/etc.
    const _COMM_ALL_ROLES = ['tl','kam','pm','admin','sales','sales_tl','ad','ad_tl'];
    let { data: plans, error: planErr } = await supa.from('commission_plans')
      .select('id,plan_code,plan_name,beneficiary_role,status')
      .in('beneficiary_role', _COMM_ALL_ROLES)
      .neq('status', 'inactive')
      .order('created_at', { ascending:true });
    if (planErr && /created_at/.test(planErr.message || '')) {
      const fb = await supa.from('commission_plans')
        .select('id,plan_code,plan_name,beneficiary_role,status')
        .in('beneficiary_role', _COMM_ALL_ROLES)
        .neq('status', 'inactive');
      plans = fb.data; planErr = fb.error;
    }
    if (planErr) throw new Error(planErr.message);

    const planMap = {};
    const planIds = [];
    (plans || []).forEach(p => {
      if (!p || !p.plan_code) return;
      planMap[p.plan_code] = p;
      planIds.push(p.id);
    });

    // Ensure standard placeholders exist in memory even if DB seed failed.
    if (!planMap.TL_NRR_STD) planMap.TL_NRR_STD = { plan_code:'TL_NRR_STD', plan_name:'TL NRR Standard', beneficiary_role:'tl', status:'active' };
    if (!planMap.KAM_NRR_STD) planMap.KAM_NRR_STD = { plan_code:'KAM_NRR_STD', plan_name:'KAM NRR Standard', beneficiary_role:'kam', status:'active' };

    let ruleMap = {}, tierMap = {}, componentRuleMap = {};
    if (planIds.length) {
      // v878 (phase 3): fetch ALL metric_codes now (was .eq('metric_code','nrr')).
      // NRR rows still land in ruleMap keyed by plan_id exactly as before — the
      // existing Rule Library editor (_commGetDraft/_commSetDraft/
      // saveCommissionRules) reads/writes that exact shape and is left
      // untouched. Every OTHER metric_code (portfolio_gate, tl_upsell_mult,
      // upsell_gmv, handover) goes into a NEW parallel componentRuleMap keyed
      // by plan_id+metric_code+metric_variant, read only by the new
      // _commGetRuleForMetric() — zero risk to the working NRR flow.
      const { data: rules, error: ruleErr } = await supa.from('commission_rules')
        .select('id,plan_id,metric_code,metric_variant,measurement_scope,payout_type,stacking_mode,active,params,tier_config')
        .in('plan_id', planIds);
      if (ruleErr) throw new Error(ruleErr.message);
      const ruleIds = [];
      (rules || []).forEach(r => {
        ruleIds.push(r.id);
        if (r.metric_code === 'nrr') {
          ruleMap[r.plan_id] = r;
        } else {
          componentRuleMap[`${r.plan_id}|${r.metric_code}|${r.metric_variant || ''}`] = r;
        }
      });
      if (ruleIds.length) {
        const { data: tiers, error: tierErr } = await supa.from('commission_rule_tiers')
          .select('id,rule_id,tier_order,min_value,max_value,payout_value,payout_label')
          .in('rule_id', ruleIds)
          .order('tier_order', { ascending:true });
        if (tierErr) throw new Error(tierErr.message);
        (tiers || []).forEach(t => {
          if (!tierMap[t.rule_id]) tierMap[t.rule_id] = [];
          tierMap[t.rule_id].push(t);
        });
      }
    }

    let assignments = [];
    try {
      let { data: asg, error: asgErr } = await supa.from('commission_plan_assignments')
        .select('period_month,assignment_scope,assignee_key,team_lead_email,plan_id,plan_code')
        .in('period_month', months);
      if (asgErr && /plan_code/.test(asgErr.message || '')) {
        const fb = await supa.from('commission_plan_assignments')
          .select('period_month,assignment_scope,assignee_key,team_lead_email,plan_id')
          .in('period_month', months);
        asg = fb.data; asgErr = fb.error;
      }
      if (asgErr) throw new Error(asgErr.message);
      assignments = (asg || []).map(r => ({
        ...r,
        plan_code: r.plan_code || Object.values(planMap).find(p => p.id === r.plan_id)?.plan_code || null
      }));
    } catch(asgEx) {
      console.warn('[Commission assignments] load failed:', asgEx.message);
      assignments = [];
    }

    _commRuleConfig = { plans: planMap, rules: ruleMap, tiers: tierMap, assignments, componentRules: componentRuleMap };
  } catch (e) {
    console.warn('[Commission rules] load failed (tables may not exist yet):', e.message);
    _commRuleConfig = { plans: {}, rules: {}, tiers: {}, assignments: [], componentRules: {} };
  }

  // v835-fix: never cache a quarter's state if target_settings failed to load —
  // caching it would serve stale/wrong defaults to every call within _TGT_CACHE_TTL
  // even after Supabase recovers. A failed load always re-fetches next call instead.
  if (!_tgtSettingsLoadFailed) {
    _tgtQuarterCache[quarter] = {
      cache: { ..._tgtCache },
      settings: { ..._tgtSettings },
      nrrPolicies: { ..._nrrGovPolicies },
      commRules: JSON.parse(JSON.stringify(_commRuleConfig || {})),
      nrrExclusions: JSON.parse(JSON.stringify(_nrrExclusions || [])),
      commissionSnapshots: JSON.parse(JSON.stringify(_commissionSnapshots || [])),
      ts: Date.now()
    };
  }
  _tgtLoaded = true;
  window._tgtSettingsLoadFailed = _tgtSettingsLoadFailed; // v835-fix: UI can check this to warn "commission config may be stale"
  window._tgtLoadedFromDB = !_tgtSettingsLoadFailed; // v835-fix: was unconditionally true even when settings load failed — now reflects reality
  // v224e: persist to localStorage — next session reads this instantly (no Supabase cold-start flash)
  // v835-fix: skip persisting if settings load failed — a bad localStorage cache would poison
  // the NEXT session's cold-start too, extending the blast radius beyond just this session
  if (!_tgtSettingsLoadFailed) {
    try{
      localStorage.setItem('sense_tgt_ls_'+quarter,JSON.stringify({ts:Date.now(),data:{
        cache:{..._tgtCache},settings:{..._tgtSettings},nrrPolicies:{..._nrrGovPolicies},
        commRules:JSON.parse(JSON.stringify(_commRuleConfig||{})),
        nrrExclusions:JSON.parse(JSON.stringify(_nrrExclusions||[])),
        commissionSnapshots:JSON.parse(JSON.stringify(_commissionSnapshots||[]))
      }}));
    }catch(e){}
  }
}

function _tgtGet(period, level, email) {
  return _tgtCache[`${period}|${level}|${email}`] || 0;
}

// ── Open / Close ────────────────────────────────────────────────
async function openTargetSetup(mode) {
  _tgtMode = mode || 'tl';
  _tgtActiveTab = 'team';
  _tgtPendingEdits = {};
  _nrrGovPending = {};
  _commRulePending = {};
  if (!_tgtActiveQuarter) _tgtActiveQuarter = _tgtCurrentQuarter();
  const overlay = document.getElementById('target-setup-overlay');
  if (overlay) overlay.classList.add('open');
  const title = document.getElementById('tgt-sheet-title');
  const _isSalesTL = typeof isSalesTLRole === 'function' && isSalesTLRole(
    currentUserProfile && currentUserProfile.role
  );
  if (title) title.textContent = mode === 'admin' ? 'ตั้ง Target ทีม' : (_isSalesTL ? 'ตั้ง Target Sales' : 'ตั้ง Target KAM');
  const tabRow = document.getElementById('tgt-tab-row');
  if (tabRow) tabRow.style.display = mode === 'admin' ? 'flex' : 'none';
  // v209: Target sheet is for target/settings only. Commission governance moved to Commission Cockpit.
  ['policy','rules','preview','lock'].forEach(k=>{
    const b=document.getElementById('tgt-tab-'+k);
    if(b) b.style.display='none';
  });
  const saveBtn = document.getElementById('tgt-save-btn');
  if (saveBtn) saveBtn.disabled = true;
  _tgtShowSkeleton();
  await loadTargets(_tgtActiveQuarter);
  _tgtClearSkeleton();
  if (saveBtn) saveBtn.disabled = false;
  renderTargetSheetBody();
}

function _tgtShowSkeleton() {
  // Use sense design pattern: thinking dots in title area, not skeleton cards
  const title = document.getElementById('tgt-sheet-title');
  const body = document.getElementById('tgt-sheet-body');
  // Animate title to show loading state
  if (title) {
    title._origText = title.textContent;
    // keep title clean — show loading indicator as small subtitle below
  }
  // Show loading as subtle subtitle under title, not inline
  const titleWrap = title && title.parentNode;
  if (titleWrap && !document.getElementById('tgt-loading-sub')) {
    const sub = document.createElement('div');
    sub.id = 'tgt-loading-sub';
    sub.style.cssText = 'font-size:var(--text-sm);color:rgba(255,255,255,.52);margin-top:2px;display:flex;align-items:center;gap:5px;padding:0 16px 10px';
    sub.innerHTML = '<span class="ai-thinking"><svg width="9" height="9" viewBox="0 0 10 10" fill="var(--tk-ok-bright)" style="animation:iq-spin 1.5s linear infinite;transform-origin:center;flex-shrink:0"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></span><span>กำลังดึงข้อมูล</span>';
    titleWrap.appendChild(sub);
  }
  if (body) body.innerHTML = '';
}

function _tgtClearSkeleton() {
  const sub = document.getElementById('tgt-loading-sub');
  if (sub) sub.remove();
}

function closeTargetSetup() {
  const overlay = document.getElementById('target-setup-overlay');
  if (overlay) overlay.classList.remove('open');
  _tgtPendingEdits = {};
  _nrrGovPending = {};
  _commRulePending = {};
  // Refresh target-dependent views after save
  setTimeout(() => {
    try{ renderPortviewTargetBar(); }catch(e){ console.warn('[target refresh] portview', e); }
    // Sales TL: refresh Sales teamview; KAM TL/Admin: refresh KAM teamview
    const _closeRole = typeof isSalesTLRole === 'function' && isSalesTLRole(
      currentUserProfile && currentUserProfile.role
    );
    if (_closeRole) {
      try{ if(typeof renderSalesTeamview==='function') renderSalesTeamview(); }catch(e){ console.warn('[target refresh] sales teamview', e); }
    } else {
      try{ if(typeof renderTeamviewSummary==='function') renderTeamviewSummary(); }catch(e){ console.warn('[target refresh] team summary', e); }
      try{ if(typeof renderTeamviewKamList==='function') renderTeamviewKamList(); }catch(e){ console.warn('[target refresh] team list', e); }
    }
  }, 100);
}

function switchTargetTab(tab) {
  _tgtActiveTab = tab;
  document.querySelectorAll('.tgt-tab-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tgt-tab-' + tab);
  if (btn) btn.classList.add('active');
  renderTargetSheetBody();
}

// ── Quarter navigation ──────────────────────────────────────────
function tgtNavQuarter(dir) {
  _tgtActiveQuarter = dir > 0
    ? _tgtNextQuarter(_tgtActiveQuarter)
    : _tgtPrevQuarter(_tgtActiveQuarter);
  _tgtPendingEdits = {};
  const saveBtn = document.getElementById('tgt-save-btn');
  if (saveBtn) saveBtn.disabled = true;
  const body = document.getElementById('tgt-sheet-body');
  if (body) body.innerHTML = '<div style="text-align:center;padding:32px;color:rgba(255,255,255,.52);font-size:var(--text-base)">กำลังโหลด...</div>';
  // Use Promise chain — async function not supported in this script context
  loadTargets(_tgtActiveQuarter).then(function() {
    _tgtClearSkeleton();
    renderTargetSheetBody();
    if (saveBtn) saveBtn.disabled = false;
  });
}

// ── Render sheet body ───────────────────────────────────────────
function renderTargetSheetBody() {
  if (_tgtActiveTab === 'settings' && _tgtMode === 'admin') {
    renderTargetSettingsTab();
    return;
  }
  if (_tgtActiveTab === 'policy' && _tgtMode === 'admin') {
    renderNrrPolicyTab();
    return;
  }
  if (_tgtActiveTab === 'rules' && _tgtMode === 'admin') {
    renderPayoutRulesTab();
    return;
  }
  if (_tgtActiveTab === 'preview' && _tgtMode === 'admin') {
    renderCommissionPreviewTab();
    return;
  }
  if (_tgtActiveTab === 'lock' && _tgtMode === 'admin') {
    renderCommissionLockTab();
    return;
  }
  const months = _tgtQuarterMonths(_tgtActiveQuarter);
  const moLabels = months.map(_tgtMonthLabel);
  let html = '';

  html += `<div class="tgt-quarter-nav">
    <button onclick="tgtNavQuarter(-1)">‹</button>
    <div class="tgt-quarter-label">${_tgtQuarterLabel(_tgtActiveQuarter)}</div>
    <button onclick="tgtNavQuarter(1)">›</button>
  </div>`;

  const _isSalesTLMode = typeof isSalesTLRole === 'function' && isSalesTLRole(
    currentUserProfile && currentUserProfile.role
  );
  if (_tgtMode === 'admin') {
    html += _renderAdminTLBlocks(months, moLabels);
  } else if (_isSalesTLMode) {
    html += _renderTLSalesBlocks(months, moLabels);
  } else {
    html += _renderTLKamBlocks(months, moLabels);
  }

  const body = document.getElementById('tgt-sheet-body');
  if (body) body.innerHTML = html;
}

// Admin: ตั้ง target per TL team
function _renderAdminTLBlocks(months, moLabels) {
  const tlMap = {};
  if (typeof portviewBulkData !== 'undefined' && portviewBulkData.length) {
    portviewBulkData.forEach(r => {
      const email = r.tlEmail || '';
      const name = r.tlName || email || 'ไม่ระบุ';
      if (email && !tlMap[email]) tlMap[email] = { email, name };
    });
  }
  const tls = Object.values(tlMap);
  if (!tls.length && currentUserProfile) {
    tls.push({ email: currentUserProfile.email, name: currentUserProfile.full_name || currentUserProfile.email });
  }

  let html = '';
  tls.forEach(tl => {
    const vals = months.map(m => _tgtGet(m, 'team', tl.email));
    const anchor = _tgtKamBaseline3mo(null, tl.email, 'tl');
    html += `<div class="tgt-person-block">
      <div class="tgt-person-name">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--tk-ok-bright)" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        ${tl.name}
      </div>
      <div class="tgt-person-meta">${tl.email}</div>
      <div class="tgt-month-grid">
        ${months.map((m, i) => `<div class="tgt-month-col">
          <label>${moLabels[i]}</label>
          <input class="tgt-month-input" id="tgt-inp-team-${_tgtSafeId(tl.email)}-${m}"
            value="${vals[i] ? _tgtFmtInput(vals[i]) : ''}"
            placeholder="฿"
            oninput="onTgtInput('team','${tl.email}','${m}',this.value)">
        </div>`).join('')}
      </div>
      ${anchor > 0 ? `<div class="tgt-person-anchor">Avg 3mo ทีม: <span>${_tgtFmtM(anchor)}</span></div>` : ''}
    </div>`;
  });
  return html;
}

// TL: ตั้ง target per KAM
function _renderTLKamBlocks(months, moLabels) {
  const tlEmail = (currentUserProfile && currentUserProfile.email) || '';
  const teamTargets = months.map(m => _tgtGet(m, 'team', tlEmail));
  const kamMap = {};
  if (typeof portviewBulkData !== 'undefined' && portviewBulkData.length) {
    portviewBulkData.filter(r => !tlEmail || r.tlEmail === tlEmail).forEach(r => {
      const email = r.kamEmail || '';
      const name = r.kamName || email || 'ไม่ระบุ';
      if (email && !kamMap[email]) kamMap[email] = { email, name };
    });
  }
  const kams = Object.values(kamMap);
  let html = '';

  if (teamTargets.some(v => v > 0)) {
    const allocByMonth = months.map(m => {
      let sum = 0;
      kams.forEach(k => {
        const key = `${m}|kam|${k.email}`;
        const pending = _tgtPendingEdits[key];
        sum += pending !== undefined ? pending : _tgtGet(m, 'kam', k.email);
      });
      return sum;
    });
    html += `<div class="tgt-alloc-bar" id="tgt-alloc-bar">
      <div class="tgt-alloc-mo-grid">
        ${months.map((m, i) => {
          const vp = teamTargets[i];
          const alloc = allocByMonth[i];
          const diff = alloc - vp;
          const pct = vp > 0 ? Math.min(110, Math.round(alloc / vp * 100)) : 0;
          const barPct = Math.min(100, pct);
          const barCls = pct >= 100 ? 'great' : 'warn';
          let diffText = '', diffCls = '';
          if (vp <= 0)         { diffText = 'VP ยังไม่ตั้ง'; diffCls = 'none'; }
          else if (alloc === 0){ diffText = 'ยังไม่แบ่ง';    diffCls = 'warn'; }
          else if (diff < 0)   { diffText = 'ขาด ' + _tgtFmtM(-diff); diffCls = 'warn'; }
          else if (diff === 0) { diffText = 'ครบแล้ว';        diffCls = 'ok'; }
          else                 { diffText = '+' + _tgtFmtM(diff);       diffCls = 'over'; }
          return '<div class="tgt-alloc-mo-col" id="tgt-alloc-mo-' + m + '">'
            + '<div class="tgt-alloc-mo-label">' + moLabels[i] + '</div>'
            + (vp > 0
              ? '<div class="tgt-alloc-mo-vp">' + _tgtFmtM(vp) + '</div>'
              : '<div class="tgt-alloc-mo-vp dim">–</div>')
            + '<div class="tgt-alloc-track" style="margin:4px 0 2px">'
            +   '<div class="tgt-alloc-fill kav-ss-bar-fill ' + barCls + '" style="width:' + barPct + '%"></div>'
            + '</div>'
            + '<div class="tgt-alloc-mo-alloc">' + (vp > 0 && alloc > 0 ? _tgtFmtM(alloc) : '') + '</div>'
            + '<div class="tgt-alloc-mo-diff ' + diffCls + '">' + diffText + '</div>'
            + '</div>';
        }).join('')}
      </div>
    </div>`;
  }

  kams.forEach(kam => {
    const vals = months.map(m => _tgtGet(m, 'kam', kam.email));
    const anchor = _tgtKamBaseline3mo(kam.email, null, 'kam');
    html += `<div class="tgt-person-block">
      <div class="tgt-person-name">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(100,170,255,.7)" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        ${kam.name}
      </div>
      <div class="tgt-month-grid">
        ${months.map((m, i) => `<div class="tgt-month-col">
          <label>${moLabels[i]}</label>
          <input class="tgt-month-input" id="tgt-inp-kam-${_tgtSafeId(kam.email)}-${m}"
            value="${vals[i] ? _tgtFmtInput(vals[i]) : ''}"
            placeholder="฿"
            oninput="onTgtInput('kam','${kam.email}','${m}',this.value)">
        </div>`).join('')}
      </div>
      ${anchor > 0 ? `<div class="tgt-person-anchor">Avg 3mo (baseline): <span>${_tgtFmtM(anchor)}</span></div>` : ''}
    </div>`;
  });

  if (!kams.length) {
    html += `<div style="text-align:center;padding:24px;color:rgba(255,255,255,.52);font-size:var(--text-base)">ไม่พบ KAM ในทีม<br><span style="font-size:var(--text-sm)">อัปโหลด portview.csv ก่อน</span></div>`;
  }
  return html;
}

// W3: Sales TL — assign target per Sales rep (uses portviewBulkData filtered by salesTeamName)
function _renderTLSalesBlocks(months, moLabels) {
  const tlEmail = (currentUserProfile && currentUserProfile.email) || '';
  const teamTargets = months.map(m => _tgtGet(m, 'sales_team', tlEmail));
  // Get Sales reps from portviewBulkData (Sales portview CSV has kamEmail=rep email, tlEmail=TL email)
  const repMap = {};
  if (typeof portviewBulkData !== 'undefined' && portviewBulkData.length) {
    portviewBulkData.filter(r => !tlEmail || (r.tlEmail || '').toLowerCase() === tlEmail.toLowerCase()).forEach(r => {
      const email = (r.kamEmail || '').toLowerCase();
      const name = r.kamName || email || 'ไม่ระบุ';
      if (email && !repMap[email]) repMap[email] = { email, name };
    });
  }
  const reps = Object.values(repMap);
  let html = '';

  // Alloc bar — team target vs sum of rep targets
  if (teamTargets.some(v => v > 0)) {
    const allocByMonth = months.map(m => {
      let sum = 0;
      reps.forEach(r => {
        const key = m + '|sales|' + r.email;
        const pending = _tgtPendingEdits[key];
        sum += pending !== undefined ? pending : _tgtGet(m, 'sales', r.email);
      });
      return sum;
    });
    html += '<div class="tgt-alloc-bar" id="tgt-alloc-bar"><div class="tgt-alloc-mo-grid">' +
      months.map(function(m, i) {
        const vp = teamTargets[i];
        const alloc = allocByMonth[i];
        const diff = alloc - vp;
        const pct = vp > 0 ? Math.min(110, Math.round(alloc / vp * 100)) : 0;
        const barPct = Math.min(100, pct);
        const barCls = pct >= 100 ? 'great' : 'warn';
        let diffText = '', diffCls = '';
        if (vp <= 0)          { diffText = 'ยังไม่มี team target'; diffCls = 'none'; }
        else if (alloc === 0) { diffText = 'ยังไม่แบ่ง';           diffCls = 'warn'; }
        else if (diff < 0)    { diffText = 'ขาด ' + _tgtFmtM(-diff); diffCls = 'warn'; }
        else if (diff === 0)  { diffText = 'ครบแล้ว';               diffCls = 'ok'; }
        else                  { diffText = '+' + _tgtFmtM(diff);    diffCls = 'over'; }
        return '<div class="tgt-alloc-mo-col" id="tgt-alloc-mo-' + m + '">'
          + '<div class="tgt-alloc-mo-label">' + moLabels[i] + '</div>'
          + (vp > 0 ? '<div class="tgt-alloc-mo-vp">' + _tgtFmtM(vp) + '</div>'
                    : '<div class="tgt-alloc-mo-vp dim">–</div>')
          + '<div class="tgt-alloc-track" style="margin:4px 0 2px">'
          +   '<div class="tgt-alloc-fill kav-ss-bar-fill ' + barCls + '" style="width:' + barPct + '%"></div>'
          + '</div>'
          + '<div class="tgt-alloc-mo-alloc">' + (vp > 0 && alloc > 0 ? _tgtFmtM(alloc) : '') + '</div>'
          + '<div class="tgt-alloc-mo-diff ' + diffCls + '">' + diffText + '</div>'
          + '</div>';
      }).join('') + '</div></div>';
  }

  // Rep blocks
  reps.forEach(function(rep) {
    const vals = months.map(m => _tgtGet(m, 'sales', rep.email));
    html += '<div class="tgt-person-block">'
      + '<div class="tgt-person-name">'
      +   '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,56,92,.7)" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> '
      +   rep.name
      + '</div>'
      + '<div class="tgt-person-meta">' + rep.email + '</div>'
      + '<div class="tgt-month-grid">'
      + months.map(function(m, i) {
          return '<div class="tgt-month-col">'
            + '<label>' + moLabels[i] + '</label>'
            + '<input class="tgt-month-input" id="tgt-inp-sales-' + _tgtSafeId(rep.email) + '-' + m + '"'
            +   ' value="' + (vals[i] ? _tgtFmtInput(vals[i]) : '') + '"'
            +   ' placeholder="฿"'
            +   ' oninput="onTgtInput(\"sales\",\"' + rep.email + '\",\"' + m + '\",this.value)">'
            + '</div>';
        }).join('')
      + '</div>'
      + '</div>';
  });

  if (!reps.length) {
    html += '<div style="text-align:center;padding:24px;color:rgba(255,255,255,.52);font-size:var(--text-base)">'
      + 'ไม่พบ Sales rep ในทีม<br><span style="font-size:var(--text-sm)">ตรวจสอบว่า portview CSV upload แล้ว</span></div>';
  }
  return html;
}

function renderTargetSettingsTab() {
  const threshold = _tgtSettings.nrr_threshold || 98;
  const body = document.getElementById('tgt-sheet-body');
  if (!body) return;
  body.innerHTML = `
    <div class="tgt-nrr-config">
      <div class="tgt-nrr-config-title">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--tk-ok-bright)" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r=".5" fill="var(--tk-ok-bright)"/></svg>
        NRR Warning Threshold
      </div>
      <div class="tgt-nrr-config-row">
        <div class="tgt-nrr-config-label">แสดงสัญญาณเตือนเมื่อ NRR ต่ำกว่า</div>
        <div style="display:flex;align-items:center;gap:4px">
          <input class="tgt-nrr-config-input" id="tgt-nrr-input" type="number" min="50" max="110" step="1"
            value="${threshold}"
            oninput="onTgtNrrInput(this.value)">
          <span style="font-size:var(--text-md);color:var(--tk-text-muted)">%</span>
        </div>
      </div>
      <div style="font-size:var(--text-xs);color:rgba(255,255,255,.52);margin-top:8px">
        ค่าเริ่มต้น: 98% · ใช้กับ signal ปัจจุบันของทุก KAM / TL
      </div>
    </div>
    <div style="font-size:var(--text-sm);color:rgba(255,255,255,.52);padding:4px 2px">
      threshold นี้มีผลกับสี warning ในมุมมอง NRR ตอนนี้ ส่วน payout rule builder จะต่อยอดบน policy tab
    </div>`;
}

function renderNrrPolicyTab() {
  const months = _tgtQuarterMonths(_tgtActiveQuarter);
  const body = document.getElementById('tgt-sheet-body');
  if (!body) return;
  if (!months.length) {
    body.innerHTML = '<div class="tgt-policy-empty">ไม่พบช่วงเวลา</div>';
    return;
  }
  body.innerHTML = `
    <div class="tgt-quarter-nav">
      <button onclick="tgtNavQuarter(-1)">‹</button>
      <div class="tgt-quarter-label">Policy · ${_tgtQuarterLabel(_tgtActiveQuarter)}</div>
      <button onclick="tgtNavQuarter(1)">›</button>
    </div>
    ${months.map(periodMonth => {
      const policy = _nrrGovGetPending(periodMonth, 'all', 'all');
      const options = _nrrGovBaseMonthOptions(periodMonth);
      return `<div class="tgt-policy-block">
        <div class="tgt-policy-head">
          <div>
            <div class="tgt-policy-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(100,170,255,.8)" stroke-width="2.2" stroke-linecap="round"><path d="M12 2l2.2 4.8L19 9l-4.8 2.2L12 16l-2.2-4.8L5 9l4.8-2.2L12 2z"/></svg>
              ${_nrrGovMonthLabel(periodMonth)}
            </div>
            <div class="tgt-policy-sub">ตั้ง logic base ของ NRR เพื่อให้ TL/KAM ใช้ commission policy เดียวกันในเดือนนั้น</div>
          </div>
          <span class="tgt-policy-status ${policy.status === 'published' ? 'published' : ''}">${policy.status === 'published' ? 'Published' : 'Draft'}</span>
        </div>
        <div class="tgt-policy-grid">
          <div class="tgt-policy-field">
            <label>Base mode</label>
            <select class="tgt-policy-select" onchange="onNrrPolicyChange('${periodMonth}','base_mode',this.value)">
              <option value="rolling_mom" ${policy.base_mode === 'rolling_mom' ? 'selected' : ''}>Rolling MoM</option>
              <option value="fixed_month" ${policy.base_mode === 'fixed_month' ? 'selected' : ''}>Fixed base month</option>
            </select>
          </div>
          <div class="tgt-policy-field">
            <label>Base month</label>
            <select class="tgt-policy-select" onchange="onNrrPolicyChange('${periodMonth}','base_month',this.value)" ${policy.base_mode === 'fixed_month' ? '' : 'disabled'}>
              ${options.map(opt => `<option value="${opt}" ${policy.base_month === opt ? 'selected' : ''}>${_nrrGovMonthLabel(opt)}</option>`).join('')}
            </select>
          </div>
          <div class="tgt-policy-field">
            <label>Status</label>
            <select class="tgt-policy-select" onchange="onNrrPolicyChange('${periodMonth}','status',this.value)">
              <option value="draft" ${policy.status === 'draft' ? 'selected' : ''}>Draft</option>
              <option value="published" ${policy.status === 'published' ? 'selected' : ''}>Published</option>
            </select>
          </div>
          <div class="tgt-policy-field">
            <label>Apply to</label>
            <input class="tgt-policy-input" value="All teams (v208 foundation)" disabled>
          </div>
        </div>
        <div class="tgt-policy-note">รองรับ use case เช่น Q2 ใช้ Apr เป็น base สำหรับ May/Jun หรือ Q3 ใช้ Jun เป็น base สำหรับ Jul/Aug/Sep ได้แล้วในระดับ policy. การตั้ง per TL / per KAM จะต่อใน phase ถัดไปบน data model เดียวกัน</div>
      </div>`;
    }).join('')}`;
}


// SECTION:AUDIT_SQL_HELPERS
// QC-13: Generate pre-filled BQ audit SQL for KAM upsell reconciliation
function _commBuildKamAuditSql(kamEmail) {
  try {
    const pvRow = (portviewBulkData || []).find(r => r.kamEmail === kamEmail);
    const kamName = pvRow ? pvRow.kamName : kamEmail;
    const period = _nrrExclusionCurrentPeriod(); // "2026-05"
    const [yr, mo] = period.split('-');
    const accountIds = (portviewBulkData || [])
      .filter(r => r.kamEmail === kamEmail)
      .map(r => `'${r.id}'`)
      .slice(0, 50)
      .join(',');
    if (!accountIds) return null;
    return `-- Audit: Upsell SKU detail for ${kamName} — ${period}\n` +
      `-- commission_type: P1_new_item | Upsell_Outlet | P3_candidate\n` +
      `-- Run in BigQuery → Export to Google Sheets to verify commission\n\n` +
      `SELECT * FROM \`freshket-rn.commission_audit.upsell_sku_detail\`\n` +
      `WHERE kam_email = '${kamName}'\n` +
      `  AND account_id IN (${accountIds})\n` +
      `ORDER BY commission_type, group_key, gmv_ex_vat DESC;`;
  } catch(e) { return null; }
}
function _commCopyAuditSql(st) {
  try {
    const sql = _commBuildKamAuditSql(st && st.email);
    if (!sql) { if(typeof showToast==='function') showToast('ไม่มีข้อมูลสำหรับ audit SQL','!'); return; }
    navigator.clipboard.writeText(sql)
      .then(() => { if(typeof showToast==='function') showToast('Audit SQL copied — paste ใน BigQuery','✓'); })
      .catch(() => { if(typeof showToast==='function') showToast('Copy failed — ดู console','!'); console.log(sql); });
  } catch(e) {}
}
window._commBuildKamAuditSql = _commBuildKamAuditSql;
window._commCopyAuditSql = _commCopyAuditSql;
// ── Quarter helpers ─────────────────────────────────────────────
// SECTION:TARGET_HELPERS
function _tgtCurrentQuarter() {
  const now = new Date();
  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return `${y}-Q${q}`;
}
function _tgtQuarterMonths(qStr) {
  // "2026-Q3" → ["2026-07","2026-08","2026-09"]
  const [y, qPart] = qStr.split('-Q');
  const q = parseInt(qPart);
  const startMonth = (q - 1) * 3 + 1;
  return [0, 1, 2].map(i => {
    const m = startMonth + i;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
}
function _tgtQuarterLabel(qStr) {
  const [y, qPart] = qStr.split('-Q');
  const q = parseInt(qPart);
  const thaiY = parseInt(y) + 543;
  const names = { 1: 'Q1 (ม.ค.–มี.ค.)', 2: 'Q2 (เม.ย.–มิ.ย.)', 3: 'Q3 (ก.ค.–ก.ย.)', 4: 'Q4 (ต.ค.–ธ.ค.)' };
  return `${names[q] || ('Q' + q)} ${thaiY}`;
}
function _tgtMonthLabel(yyyymm) {
  const mo = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const m = parseInt(yyyymm.split('-')[1]) - 1;
  return mo[m] || yyyymm;
}
function _tgtNextQuarter(qStr) {
  const [y, qPart] = qStr.split('-Q');
  let q = parseInt(qPart) + 1, yr = parseInt(y);
  if (q > 4) { q = 1; yr++; }
  return `${yr}-Q${q}`;
}
function _tgtPrevQuarter(qStr) {
  const [y, qPart] = qStr.split('-Q');
  let q = parseInt(qPart) - 1, yr = parseInt(y);
  if (q < 1) { q = 4; yr--; }
  return `${yr}-Q${q}`;
}

// ── Format helpers ──────────────────────────────────────────────
function _tgtFmtM(n) {
  if (!n || n === 0) return '—';
  if (n >= 1000000) return '฿' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '฿' + Math.round(n / 1000) + 'K';
  return '฿' + Math.round(n);
}
function _tgtParseInput(str) {
  if (!str || str.trim() === '' || str.trim() === '—') return 0;
  const s = str.replace(/,/g, '').replace(/฿/g, '').trim().toLowerCase();
  if (s.endsWith('m')) return Math.round(parseFloat(s) * 1000000);
  if (s.endsWith('k')) return Math.round(parseFloat(s) * 1000);
  return Math.round(parseFloat(s)) || 0;
}
function _tgtFmtInput(n) {
  if (!n) return '';
  return Math.round(n / 1000) * 1000 === n ? (n / 1000000 >= 1 ? (n / 1000000).toFixed(1) + 'M' : Math.round(n / 1000) + 'K') : String(n);
}

// SECTION:NRR_GOV_POLICY
function _nrrGovKey(periodMonth, scopeType, scopeKey) {
  return `${periodMonth}|${scopeType || 'all'}|${scopeKey || 'all'}`;
}
function _nrrGovDefaultPolicy(periodMonth) {
  return {
    period_month: periodMonth,
    scope_type: 'all',
    scope_key: 'all',
    base_mode: 'rolling_mom',
    base_month: _nrrGovPrevMonth(periodMonth),
    status: 'draft',
    updated_by: '',
    updated_at: null
  };
}
function _nrrGovPrevMonth(periodMonth) {
  if (!periodMonth) return null;
  const [y, m] = periodMonth.split('-').map(v => parseInt(v, 10));
  const d = new Date(y, (m || 1) - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function _nrrGovMonthLabel(periodMonth) {
  if (!periodMonth) return '—';
  const mo = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const [y, m] = periodMonth.split('-');
  return `${mo[(parseInt(m, 10) || 1) - 1]} ${parseInt(y, 10) + 543}`;
}
function _nrrGovBaseMonthOptions(periodMonth) {
  if (!periodMonth) return [];
  const [y, m] = periodMonth.split('-').map(v => parseInt(v, 10));
  const start = new Date(y, (m || 1) - 1, 1);
  const out = [];
  for (let i = 1; i <= 12; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), 1);
    d.setMonth(d.getMonth() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
function _nrrGovGet(periodMonth, scopeType, scopeKey) {
  const direct = _nrrGovPolicies[_nrrGovKey(periodMonth, scopeType, scopeKey)];
  if (direct) return { ...direct };
  const fallback = _nrrGovPolicies[_nrrGovKey(periodMonth, 'all', 'all')];
  return fallback ? { ...fallback } : _nrrGovDefaultPolicy(periodMonth);
}
function _nrrGovGetPending(periodMonth, scopeType, scopeKey) {
  const key = _nrrGovKey(periodMonth, scopeType, scopeKey);
  if (_nrrGovPending[key]) return { ..._nrrGovPending[key] };
  return _nrrGovGet(periodMonth, scopeType, scopeKey);
}
function _nrrGovResolveForVisibleScope() {
  const periodMonth = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();
  return _nrrGovGet(periodMonth, 'all', 'all');
}
function _nrrGovPolicySummary(policy) {
  if (!policy) return 'Rolling MoM';
  if (policy.base_mode === 'fixed_month') return `Fixed base: ${_nrrGovMonthLabel(policy.base_month)}`;
  return 'Rolling MoM';
}
function _tgtGetVisibleTeamNrrResult() {
  const email = (currentUserProfile && currentUserProfile.email) || '';
  const role = (currentUserProfile && currentUserProfile.role) || '';
  const tlMatch = (typeof portviewBulkData !== 'undefined' ? (portviewBulkData || []) : []).some(a => a.tlEmail === email);
  const showAll = role === 'admin' && !tlMatch;
  // v828: Team Governance Card's NRR% — use QNRR when quarterly, else MoM as before
  const policy = _nrrGovResolveForVisibleScope();
  if (policy && policy.commission_mode === 'quarterly' && typeof window._qnrrComputeForCommission === 'function') {
    const scopeEmail = showAll ? null : email;
    const r = window._qnrrComputeForCommission(scopeEmail || email, showAll ? 'admin' : 'tl');
    if (r) return r;
  }
  return _tgtComputeKamNRR(null, showAll ? null : email);
}
function _tgtRenderTeamGovCard() {
  const policy = _nrrGovResolveForVisibleScope();
  const gov = _nrrGovernanceForVisibleTeam();
  const threshold = _tgtSettings.nrr_threshold || 98;
  const rawPct = gov.rawPct;
  const governedPct = gov.governedPct !== null ? gov.governedPct : rawPct;
  const nrrOk = governedPct !== null && governedPct >= threshold;
  const baseTxt = policy.base_mode === 'fixed_month'
    ? `${_nrrGovMonthLabel(policy.base_month)} fixed`
    : 'Rolling MoM';
  const role = getCurrentRole();
  const summary = _commBuildPayoutSummary(isTLRole(role) ? 'tl' : undefined);
  const pending = (_nrrExclusions || []).filter(r => r.status === 'submitted' || r.status === 'pending').length;
  const policyPublished = policy.status === 'published';
  const ready = policyPublished && pending === 0;
  const actionCls = ready ? 'ok' : 'warn';
  const actionTitle = ready ? 'All clear' : 'Action needed';
  const actionMsg = ready
    ? 'Policy published · no pending exceptions'
    : `${!policyPublished ? 'Policy still draft' : ''}${(!policyPublished && pending) ? ' · ' : ''}${pending ? pending + ' pending exception' + (pending>1?'s':'') : ''}`;
  const isAdmin = isAdminRole(role);
  const commissionMain = isTLRole(role) ? summary.tlPayout : summary.total;
  // v854-fix: baseMo threaded to _commComputeTeamUpsellMult so its per-KAM fallback
  // path (used when a KAM is missing from the team-summary CSV) doesn't silently
  // revert to rolling logic while the org is in quarterly mode.
  const _tgcIsQ   = policy && policy.commission_mode === 'quarterly';
  const _tgcBaseMo = _tgcIsQ ? (policy.base_month || null) : null;
  // QC-12: show TL multiplier tier in govCard meta
  let _tlMultText = '';
  try {
    if (isTLRole(role)) {
      const _govEm2 = (currentUserProfile && currentUserProfile.email) || '';
      const _um2 = typeof _commComputeTeamUpsellMult==='function' && (typeof bulkUpsellTeamData!=='undefined'&&bulkUpsellTeamData&&Object.keys(bulkUpsellTeamData).length>0)
        ? _commComputeTeamUpsellMult(_govEm2, _tgcIsQ, _tgcBaseMo) : null;
      if (_um2 && _um2.multiplier > 1) _tlMultText = ` · ×${_um2.multiplier.toFixed(2)} upsell mult`;
    }
  } catch(e) {}
  const commissionMeta = isTLRole(role)
    ? `KAM team ${_commFmtPayout(summary.kamPayout)}${_tlMultText}`
    : `TL ${_commFmtPayout(summary.tlPayout)} · KAM ${_commFmtPayout(summary.kamPayout)}`;
  // Upsell Mult — folded into Commission card meta (not a separate card)
  const _teamUpsellReady = typeof bulkUpsellTeamData!=='undefined'&&bulkUpsellTeamData&&Object.keys(bulkUpsellTeamData).length>0; // hoisted to fn scope
  let multBadge = '';
  let umData = null;
  if ((isTLRole(role) || isAdminRole(role)) && typeof _commComputeTeamUpsellMult === 'function') {
    try {
      const _govEmail = isTLRole(role)
        ? ((currentUserProfile && currentUserProfile.email) || '')
        : ((_commGetTlListFromPortview()[0] || {}).email || '');
      umData = _govEmail ? _commComputeTeamUpsellMult(_govEmail, _tgcIsQ, _tgcBaseMo) : null;
      if (umData && _teamUpsellReady) {
        const multCls = umData.multiplier > 1 ? 'ok' : '';
        multBadge = `<span class="tv-mult-badge ${multCls}">×${umData.multiplier.toFixed(2)}</span>`;
      } else if (isTLRole(role) || isAdminRole(role)) {
        multBadge = `<span class="tv-mult-badge loading">×—</span>`;
      }
    } catch(e) {}
  }
  const commMeta2 = isTLRole(role)
    ? (umData && _teamUpsellReady
        ? `KAM team ${_commFmtPayout(summary.kamPayout)} · ${umData.team_upsell_pct.toFixed(1)}% upsell`
        : `KAM team ${_commFmtPayout(summary.kamPayout)}`)
    : `TL ${_commFmtPayout(summary.tlPayout)} · KAM ${_commFmtPayout(summary.kamPayout)}`;

  return `<div class="tv-gov-card">
    <div class="tv-signal-wrap">
      <div class="tv-signal-card ${nrrOk ? 'ok' : 'warn'}">
        <div class="tv-signal-label">NRR</div>
        <div class="tv-signal-value ${nrrOk ? 'ok' : 'warn'}">${_commFmtPct(governedPct)}</div>
        <div class="tv-signal-meta">${baseTxt}</div>
      </div>
      <div class="tv-signal-card commission" style="cursor:pointer" onclick="event.stopPropagation();_commOpenTlDetailSheet()">
        <div class="tv-signal-label">Commission ${multBadge}</div>
        <div class="tv-signal-value">${_commFmtPayout(commissionMain)}</div>
        <div class="tv-signal-meta">${commMeta2}</div>
      </div>
      <div class="tv-signal-card ${pending ? 'warn' : 'ok'}">
        <div class="tv-signal-label">Exceptions</div>
        <div class="tv-signal-value ${pending ? 'warn' : 'ok'}">${pending}</div>
        <div class="tv-signal-meta">${policyPublished ? 'Published' : 'Draft policy'}</div>
      </div>
      <!-- v686: action strip hidden — Commission header button is the access point -->
    </div>
  </div>`;
}

// SECTION:COMMISSION_CORE
function _commDefaultTiers(role) {
  // v754f: ลบ hardcoded tiers ทิ้ง — ไม่มี fallback อีกต่อไป
  // ถ้า Supabase ยังไม่โหลด commission_rule_tiers → return [] → strip แสดง skeleton
  // ป้องกัน stale tier (฿5,000/฿7,500 เก่า) flash ก่อน DB data มา
  return [];
}
// v878: maps profiles.role (normalizeRole() output: admin/tl/rep/sales/
// sales_tl/ad/ad_tl/pm) to the commission engine's own beneficiary-role
// bucket vocabulary ('kam' for 'rep', everything else passes through).
// This is the ONLY place that vocabulary translation happens — nothing
// downstream should special-case profiles.role strings again.
function _commEngineRole(profileRole) {
  const r = (typeof normalizeRole === 'function') ? normalizeRole(profileRole) : String(profileRole || '');
  return r === 'rep' ? 'kam' : r;
}
window._commEngineRole = _commEngineRole;

// v878: bootstrap seed plan per engine role bucket — used ONLY as the
// last-resort fallback when no role_default/person assignment row exists
// at all (see _commGetAssignmentPlan's 3-tier resolution). This is NOT
// "the admin's current choice" — that lives in commission_plan_assignments
// and always wins when present. kam/tl values are unchanged from before
// this generalization; the rest have no real scheme configured yet, so
// they resolve to a plan_code that doesn't exist in commission_plans —
// harmless, since every per-component compute function treats "no rule
// row found for this plan_code" as "component inactive," not an error.
const _COMM_BOOTSTRAP_PLAN = {
  kam: 'KAM_NRR_STD', tl: 'TL_NRR_STD',
  pm: 'PM_NRR_STD', admin: 'ADMIN_NRR_STD',
  sales: 'SALES_NRR_STD', sales_tl: 'SALES_TL_NRR_STD',
  ad: 'AD_NRR_STD', ad_tl: 'AD_TL_NRR_STD'
};
function _commPlanCode(role) {
  return _COMM_BOOTSTRAP_PLAN[role] || _COMM_BOOTSTRAP_PLAN.kam;
}
// v878 (phase 6): widened alongside _commPlanCode's bootstrap map — tl/kam
// unchanged, other roles get a sensible default label until an admin
// renames their scheme via the Cockpit.
const _COMM_BOOTSTRAP_PLAN_NAME = {
  kam: 'KAM NRR Standard', tl: 'TL NRR Standard',
  pm: 'PM NRR Standard', admin: 'Admin NRR Standard',
  sales: 'Sales NRR Standard', sales_tl: 'Sales TL NRR Standard',
  ad: 'AD NRR Standard', ad_tl: 'AD TL NRR Standard'
};
function _commPlanName(role) {
  return _COMM_BOOTSTRAP_PLAN_NAME[role] || _COMM_BOOTSTRAP_PLAN_NAME.kam;
}
function _commGetDraft(role) {
  const code = _commPlanCode(role);
  if (_commRulePending[code]) return JSON.parse(JSON.stringify(_commRulePending[code]));
  const plan = (_commRuleConfig.plans && _commRuleConfig.plans[code]) || null;
  const rule = plan && _commRuleConfig.rules ? _commRuleConfig.rules[plan.id] : null;
  const tiers = rule && _commRuleConfig.tiers ? (_commRuleConfig.tiers[rule.id] || []) : [];
  return {
    role,
    plan_code: code,
    plan_name: plan?.plan_name || _commPlanName(role),
    beneficiary_role: role,
    payout_type: rule?.payout_type || 'flat_amount',
    measurement_scope: rule?.measurement_scope || 'governed_nrr',
    tiers: tiers.length ? tiers.map(t => ({
      min_value: t.min_value,
      max_value: t.max_value,
      payout_value: t.payout_value,
      payout_label: t.payout_label || ''
    })) : _commDefaultTiers(role)
  };
}
function _commSetDraft(role, draft) {
  _commRulePending[_commPlanCode(role)] = JSON.parse(JSON.stringify(draft));
}

function _commGetDraftByCode(planCode, roleHint) {
  const role = roleHint || (planCode && planCode.startsWith('TL_') ? 'tl' : 'kam');
  if (!planCode) return _commGetDraft(role);
  if (_commRulePending[planCode]) return JSON.parse(JSON.stringify(_commRulePending[planCode]));
  const plan = (_commRuleConfig.plans && _commRuleConfig.plans[planCode]) || null;
  const rule = plan && _commRuleConfig.rules ? _commRuleConfig.rules[plan.id] : null;
  const tiers = rule && _commRuleConfig.tiers ? (_commRuleConfig.tiers[rule.id] || []) : [];
  return {
    role,
    plan_code: planCode,
    plan_name: plan?.plan_name || _commPlanName(role),
    beneficiary_role: plan?.beneficiary_role || role,
    payout_type: rule?.payout_type || 'flat_amount',
    measurement_scope: rule?.measurement_scope || 'governed_nrr',
    tiers: tiers.length ? tiers.map(t => ({
      min_value: t.min_value,
      max_value: t.max_value,
      payout_value: t.payout_value,
      payout_label: t.payout_label || ''
    })) : _commDefaultTiers(role)
  };
}
function _commSetDraftByCode(planCode, draft) {
  _commRulePending[planCode] = JSON.parse(JSON.stringify(draft));
  if (!_commRuleConfig.plans) _commRuleConfig.plans = {};
  _commRuleConfig.plans[planCode] = {
    ...((_commRuleConfig.plans && _commRuleConfig.plans[planCode]) || {}),
    plan_code: planCode,
    plan_name: draft.plan_name || planCode,
    beneficiary_role: draft.beneficiary_role || draft.role,
    status: 'active'
  };
}
function _commCreateRule(role) {
  // v878 (phase 6): widened from the tl/kam-only ternary to any of the 8
  // engine role buckets, mirroring _commPlanCode's bootstrap map.
  const prefix = `${String(role || 'kam').toUpperCase()}_NRR_RULE`;
  const code = `${prefix}_${Date.now().toString().slice(-6)}`;
  const name = `New ${_commPlanName(role)}`;
  const draft = {
    role,
    plan_code: code,
    plan_name: name,
    beneficiary_role: role,
    payout_type:'flat_amount',
    measurement_scope:'governed_nrr',
    tiers:_commDefaultTiers(role)
  };
  _commSetDraftByCode(code, draft);
  _commSelectedRuleCode = code;
  renderCommissionCockpit();
  return code; // for Setup-tab wrappers that select the new scheme in-place
}
function _commPlanStatus(p) {
  return String((p && p.status) || 'active').toLowerCase();
}
function _commIsActivePlan(p) {
  const st = _commPlanStatus(p);
  return st !== 'inactive' && st !== 'archived';
}
function _commIsPlanCodeActive(planCode, role) {
  const code = planCode || _commPlanCode(role);
  if (code === _commPlanCode(role)) return true;
  const pending = (_commRulePending || {})[code];
  if (pending) return _commIsActivePlan(pending);
  const plan = ((_commRuleConfig && _commRuleConfig.plans) || {})[code];
  return !!(plan && _commIsActivePlan(plan));
}
function _commActivePlanCode(planCode, role) {
  const code = planCode || _commPlanCode(role);
  return _commIsPlanCodeActive(code, role) ? code : _commPlanCode(role);
}
function _commRuleUsageCount(planCode, period) {
  if (!planCode) return 0;
  const per = period || _nrrExclusionCurrentPeriod();
  const plan = ((_commRuleConfig && _commRuleConfig.plans) || {})[planCode] || {};
  const keys = new Set();
  ((_commRuleConfig && _commRuleConfig.assignments) || []).forEach(a => {
    if (!a || a.period_month !== per) return;
    const matchCode = a.plan_code === planCode;
    const matchId = plan.id && a.plan_id === plan.id;
    if (matchCode || matchId) keys.add(_commAssignmentKey(a.period_month, a.assignment_scope, a.assignee_key));
  });
  Object.entries(_commAssignmentPending || {}).forEach(([key, code]) => {
    const [p] = key.split('|');
    if (p === per && code === planCode) keys.add(key);
  });
  return keys.size;
}
function _commRulesForRole(role, opts) {
  const options = opts || {};
  const plans = Object.values((_commRuleConfig && _commRuleConfig.plans) || {}).filter(p => p.beneficiary_role === role);
  const pending = Object.values(_commRulePending || {}).filter(d => (d.beneficiary_role || d.role) === role)
    .map(d => ({ plan_code:d.plan_code, plan_name:d.plan_name, beneficiary_role:role, status:d.status || 'active' }));
  const byCode = {};
  [...plans, ...pending].forEach(p => { if (p && p.plan_code) byCode[p.plan_code] = p; });
  const base = _commPlanCode(role);
  if (!byCode[base]) byCode[base] = { plan_code:base, plan_name:_commPlanName(role), beneficiary_role:role, status:'active' };
  return Object.values(byCode).filter(p => !options.activeOnly || _commIsActivePlan(p));
}
function _commMatchTierByCode(planCode, role, pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return null;
  const effectiveCode = _commActivePlanCode(planCode || _commPlanCode(role), role);
  const d = _commGetDraftByCode(effectiveCode, role);
  const tiers = (d.tiers || []).slice().sort((a,b)=>(Number(a.min_value ?? -999999))-(Number(b.min_value ?? -999999)));
  for (const t of tiers) {
    const minOk = (t.min_value === null || t.min_value === '' || pct >= Number(t.min_value));
    const maxOk = (t.max_value === null || t.max_value === '' || pct < Number(t.max_value));
    if (minOk && maxOk) return t;
  }
  return null;
}
function _commPayoutForPctByCode(planCode, role, pct) {
  const t = _commMatchTierByCode(planCode || _commPlanCode(role), role, pct);
  return t ? Number(t.payout_value || 0) : 0;
}

// v878 (phase 3): same min_value/max_value tier-matching algorithm as
// _commMatchTierByCode (lowest-inclusive, highest-exclusive-unless-null),
// but sourced from a component's own per-scheme rule (via
// _commGetRuleForMetric) instead of the NRR-only rules/tiers maps
// _commMatchTierByCode is hardwired to. Returns null if this scheme has no
// rule row for this component yet — caller decides the legacy fallback.
// v879: pure tier-match logic, taking an already-resolved `found` object
// (same shape _commGetRuleForMetric returns) instead of resolving it
// internally — lets the preview path inject a draft `found` object
// (tiers included inline) without a second id-keyed tiers lookup.
function _commMatchTierInRule(found, pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return null;
  if (!found || !found.active || !found.tiers.length) return null;
  const tiers = found.tiers.slice().sort((a,b)=>(Number(a.min_value ?? -999999))-(Number(b.min_value ?? -999999)));
  for (const t of tiers) {
    const minOk = (t.min_value === null || t.min_value === '' || pct >= Number(t.min_value));
    const maxOk = (t.max_value === null || t.max_value === '' || pct < Number(t.max_value));
    if (minOk && maxOk) return t;
  }
  return null;
}
function _commMatchComponentTier(planCode, metricCode, metricVariant, pct, previewResolver) {
  return _commMatchTierInRule(_commResolveRuleForMetric(planCode, metricCode, metricVariant, previewResolver), pct);
}
function _commFmtPayout(n) {
  n = Number(n || 0);
  if (!n) return '฿0';
  return '฿' + Math.round(n).toLocaleString('en-US');
}
// v92: shared %NRR/retention% display formatter (mirrors /nrr's nrrFmtPct()).
// Always 1 decimal — the underlying pct value itself is now UNROUNDED
// through tier/gate decisions (see _nrrGovernedPct), so this is purely a
// display concern, never a computation one.
function _commFmtPct(v) {
  return (v !== null && v !== undefined && !isNaN(v)) ? Number(v).toFixed(1) + '%' : '—';
}
window._commFmtPct = _commFmtPct;

function _commEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}
function _commPendingCount() {
  return Object.keys(_commRulePending || {}).length
       + Object.keys(_commAssignmentPending || {}).length
       + Object.keys(_nrrGovPending || {}).length
       + Object.keys((typeof _commComponentPending !== 'undefined' ? _commComponentPending : {})).length
       // v879 (Commission Setup redesign): the new per-scheme component
       // draft map (Gate/Upsell/Handover/TL-mult edited via the Setup tab)
       // — without this, editing e.g. only a Handover tier on an already-
       // active role would show "No changes" and block Save entirely.
       + Object.keys((typeof _commComponentRulePending !== 'undefined' ? _commComponentRulePending : {})).length;
}
function _commHasPendingChanges() {
  return _commPendingCount() > 0;
}
function _commUpdateSaveButtonState() {
  const btn = document.querySelector('#commission-cockpit-overlay .comm-save');
  if (!btn || btn.classList.contains('saving') || btn.classList.contains('saved')) return;
  const count = _commPendingCount();
  btn.disabled = count === 0;
  btn.classList.toggle('has-changes', count > 0);
  btn.classList.toggle('no-changes', count === 0);
  btn.textContent = count > 0 ? `Save changes (${count})` : 'No changes';
}
function _commMarkChanged() {
  if (_commSaveStateTimer) clearTimeout(_commSaveStateTimer);
  _commSaveStateTimer = setTimeout(_commUpdateSaveButtonState, 0);
}
function _commSoftenPostSaveUi() {
  const ov = document.getElementById('commission-cockpit-overlay');
  if (!ov) return;
  ov.querySelectorAll('.comm-unsaved').forEach(el => { el.classList.add('comm-fade-out'); setTimeout(()=>el.remove(), 180); });
  ov.querySelectorAll('.dirty,.flash,.invalid,.rule-tier-invalid').forEach(el => el.classList.remove('dirty','flash','invalid','rule-tier-invalid'));
  ov.querySelectorAll('.comm-inline-error').forEach(el => { el.classList.add('comm-fade-out'); setTimeout(()=>el.remove(), 180); });
  const bars = ov.querySelectorAll('.comm-readiness-bar.warn');
  bars.forEach(b => {
    b.classList.remove('warn'); b.classList.add('ready');
    const copy = b.querySelector('.comm-readiness-copy');
    if (copy) copy.textContent = 'Saved แล้ว · cockpit ไม่ refresh หน้าจอ';
  });
}
function _commClearValidationForPlan(planCode) {
  if (_commValidationErrors && _commValidationErrors[planCode]) delete _commValidationErrors[planCode];
}
function _commValidateDrafts() {
  const errors = {};
  const drafts = Object.values(_commRulePending || {});
  drafts.forEach(d => {
    const code = d.plan_code;
    const e = { tiers:{} };
    if (!String(d.plan_name || '').trim()) e.name = 'กรุณาใส่ชื่อ rule เพื่อให้ audit ได้ว่าใช้ criteria ชุดไหน';
    const tiers = Array.isArray(d.tiers) ? d.tiers : [];
    // An EMPTY tier ladder is legitimate, not an error: it means "this role
    // gets ฿0 from the NRR component" while other components (Upsell P1/P3,
    // Handover, ...) still pay — the exact shape a role like AD needs. The
    // old hard block ('ต้องมีอย่างน้อย 1 tier') made the whole Setup save
    // abort for any never-configured role the moment its toggle was turned
    // on (the toggle stages an NRR draft whose default tiers are [] since
    // v754f), so AD/PM/... could never be saved at all. The sibling ladder
    // editors (Gate, TL-mult) already treat empty as a valid no-op; the NRR
    // editor now shows an inline note instead of blocking.
    tiers.forEach((t, i) => {
      const te = {};
      const minEmpty = t.min_value === null || t.min_value === '' || t.min_value === undefined;
      const maxEmpty = t.max_value === null || t.max_value === '' || t.max_value === undefined;
      const min = minEmpty ? null : Number(t.min_value);
      const max = maxEmpty ? null : Number(t.max_value);
      const payout = Number(t.payout_value);
      if ((!minEmpty && !Number.isFinite(min)) || (!maxEmpty && !Number.isFinite(max))) te.range = 'Min/Max ต้องเป็นตัวเลข หรือเว้นว่างได้';
      if (Number.isFinite(min) && Number.isFinite(max) && min >= max) te.range = 'Min ต้องน้อยกว่า Max';
      if (!Number.isFinite(payout) || payout < 0) te.payout = 'Payout ต้องเป็นตัวเลข 0 ขึ้นไป';
      if (Object.keys(te).length) e.tiers[i] = te;
    });
    if (e.name || e.general || Object.keys(e.tiers).length) errors[code] = e;
  });
  _commValidationErrors = errors;
  return errors;
}
function _commFirstValidationPlan(errors) {
  const keys = Object.keys(errors || {});
  return keys.length ? keys[0] : null;
}
async function saveCommissionPoliciesFromCockpit() {
  const rows = Object.values(_nrrGovPending || {});
  if (!rows.length) return;
  const actor = (currentUserProfile && currentUserProfile.email) || '';
  const payload = rows.map(p => ({
    period_month:    p.period_month,
    scope_type:      p.scope_type || 'all',
    scope_key:       p.scope_key || 'all',
    base_mode:       p.base_mode || 'rolling_mom',
    base_month:      p.base_mode === 'fixed_month' ? (p.base_month || _nrrGovPrevMonth(p.period_month)) : _nrrGovPrevMonth(p.period_month),
    commission_mode: p.commission_mode || 'monthly',   // 'monthly' | 'quarterly'
    quarter_id:      p.commission_mode === 'quarterly' ? (p.quarter_id || null) : null,
    status:          p.status || 'draft',
    updated_by:      actor,
    updated_at:      new Date().toISOString()
  }));
  const { error } = await supa.from('nrr_policies').upsert(payload, { onConflict:'period_month,scope_type,scope_key' });
  if (error) throw new Error(error.message);
  payload.forEach(r => { _nrrGovPolicies[_nrrGovKey(r.period_month, r.scope_type, r.scope_key)] = { ...r }; });
  _nrrGovPending = {};
}
function _commMatchTier(role, pct) {
  return _commMatchTierByCode(_commPlanCode(role), role, pct);
}
function _commPayoutForPct(role, pct) {
  return _commPayoutForPctByCode(_commPlanCode(role), role, pct);
}

function _commVisibleTeamScope() {
  const email = (currentUserProfile && currentUserProfile.email) || '';
  const role = (currentUserProfile && currentUserProfile.role) || '';
  const tlMatch = (typeof portviewBulkData !== 'undefined' ? (portviewBulkData || []) : []).some(a => a.tlEmail === email);
  return { email, role, showAll: role === 'admin' && !tlMatch, tlEmail: (role === 'admin' && !tlMatch) ? null : email };
}
function _commKamNrrPct(kamEmail) {
  const g = _nrrGovernanceForKam(kamEmail);
  return g.governedPct !== null ? g.governedPct : g.rawPct;
}
function _commTeamNrrPct() {
  const g = _nrrGovernanceForVisibleTeam();
  return g.governedPct !== null ? g.governedPct : g.rawPct;
}
// SECTION:COMMISSION_PREVIEW
function _commBuildPreviewModel() {
  const groups = (typeof _buildKamGroups === 'function') ? (_buildKamGroups() || []) : [];
  const teamPct = _commTeamNrrPct();
  const period = _nrrExclusionCurrentPeriod();
  const tlPlanCode = _commActivePlanCode(_commPlanCode('tl'), 'tl');
  const tlPayout = _commPayoutForPctByCode(tlPlanCode, 'tl', teamPct);
  const kamRows = groups.map(g => {
    const pct = _commKamNrrPct(g.kamEmail);
    const planCode = _commGetAssignmentPlan(period, 'kam', g.kamEmail, 'kam');
    const payout = _commPayoutForPctByCode(planCode, 'kam', pct);
    const tier = _commMatchTierByCode(planCode, 'kam', pct);
    return {
      kamEmail: g.kamEmail,
      kamName: g.kamName,
      pct,
      payout,
      planCode,
      planName: _commPlanNameByCode(planCode, 'kam'),
      tierLabel: tier ? (tier.payout_label || '') : '',
      accounts: g.total || (g.accounts ? g.accounts.length : 0),
      pace: g.pace || null,
      paceCls: g.paceCls || ''
    };
  }).sort((a,b)=>(b.payout-a.payout)||((a.pct??-1)-(b.pct??-1)));
  const kamTotal = kamRows.reduce((s,r)=>s+(r.payout||0),0);
  return {
    teamPct,
    tlPlanCode,
    tlPlanName: _commPlanNameByCode(tlPlanCode, 'tl'),
    tlPayout,
    kamRows,
    kamTotal,
    totalExposure: tlPayout + kamTotal
  };
}

// SECTION:NRR_EXCLUSIONS
function _nrrExclusionCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function _nrrExclusionRowKey(r) {
  return `${r.period_month}|${r.account_id || ''}|${r.outlet_id || ''}|${r.target_kam_email || ''}|${r.status || ''}`;
}
// v865 (waived-account feature): fixed to actually scope by period_month --
// previously an approved waiver for one month silently suppressed NRR for
// every other month too, since this filter never checked period_month
// despite the column existing on every row.
function _nrrExclusionApprovedForScope(kamEmail, tlEmail, periodMonth) {
  return (_nrrExclusions || []).filter(x =>
    x.status === 'approved' &&
    (!periodMonth || x.period_month === periodMonth) &&
    (!x.target_kam_email || !kamEmail || x.target_kam_email === kamEmail) &&
    (!x.target_tl_email || !tlEmail || x.target_tl_email === tlEmail)
  );
}
// v865: the one shared predicate every NRR compute function (Sense's
// _qnrrCompute/_groupNRR and /nrr's ports) calls to check whether an
// account is waived for a given month -- single source of truth, so the
// exclusion is applied once, upstream, instead of only in the commission
// payout wrapper (which used to under-apply it everywhere except the
// final payout number -- see [[commission-quarterly-fix]] round 4 / the
// waived-account feature plan for why "computed in more than one place"
// is the exact bug class this avoids).
// v866 (outlet-level waiving): a row with outlet_id set is scoped to ONLY
// that outlet -- it must never fall back to matching by account_id alone,
// or an outlet-scoped waiver would silently over-exclude every other
// outlet under the same account too. A row with outlet_id null is a
// whole-account waiver and matches by account_id regardless of which
// outlet the caller is asking about.
function _nrrAccountWaivedForPeriod(accountId, periodMonth, outletId) {
  if (!accountId || !periodMonth) return false;
  return (_nrrExclusions || []).some(x => {
    if (x.status !== 'approved' || x.period_month !== periodMonth) return false;
    if (x.outlet_id) return !!outletId && x.outlet_id === outletId;
    return x.account_id === accountId;
  });
}
window._nrrAccountWaivedForPeriod = _nrrAccountWaivedForPeriod;
function _nrrExclusionBaseImpact(kamEmail, tlEmail, periodMonth) {
  const approved = _nrrExclusionApprovedForScope(kamEmail, tlEmail, periodMonth);
  return approved.reduce((s,x)=>s + Number(x.base_gmv || x.estimated_base_gmv || 0), 0);
}
// v865: the waiver is now applied INSIDE the core compute functions
// (_qnrrCompute/_groupNRR via _nrrAccountWaivedForPeriod) so rawResult.nrr
// already reflects it -- this is now a pure passthrough. It used to
// separately re-subtract excluded base here on top of the raw result,
// which after this change would double-subtract. Kept as a named function
// (rather than inlined at call sites) so a future "%NRR annotation" can
// still hook in without touching payout math.
function _nrrGovernedPct(rawResult) {
  if (!rawResult || rawResult.nrr === null) return null;
  // v92-fix: NO rounding here — this value feeds tier/gate threshold
  // comparisons (_commMatchTierByCode/_commComputeGmvGate) downstream.
  // Rounding to a whole number (or even 1 decimal) BEFORE that comparison
  // can flip a real payout decision at a boundary (e.g. true 97.96% vs a
  // gate at 98% — rounds to 98, wrongly clears the gate). Round only for
  // DISPLAY/STORAGE, via _commFmtPct(), never before a threshold decision.
  return rawResult.nrr * 100;
}
// v865: read-only reporting helper -- "this month's %NRR excludes N waived
// accounts totaling ฿X" -- must never feed back into payout math (that's
// exactly the bug _nrrGovernedPct used to have).
function _nrrWaivedAccountsSummary(kamEmail, tlEmail, periodMonth) {
  const rows = _nrrExclusionApprovedForScope(kamEmail, tlEmail, periodMonth);
  return { count: rows.length, totalBaseGmv: rows.reduce((s,x)=>s + Number(x.base_gmv || x.estimated_base_gmv || 0), 0) };
}
function _nrrGovernanceForVisibleTeam() {
  const scope = _commVisibleTeamScope();
  const raw = _tgtGetVisibleTeamNrrResult();
  const rawPct = raw && raw.nrr !== null ? raw.nrr * 100 : null; // v92-fix: unrounded, see _nrrGovernedPct
  const governedPct = _nrrGovernedPct(raw);
  const exclBase = _nrrExclusionBaseImpact(null, scope.tlEmail, raw && raw.currentPeriod);
  return { raw, rawPct, governedPct, excludedBase: exclBase };
}
function _nrrGovernanceForKam(kamEmail) {
  // v828: use QNRR source in quarterly mode so exclusion/threshold checks match commission total
  const _policy = _nrrGovResolveForVisibleScope();
  const raw = (_policy && _policy.commission_mode === 'quarterly' && typeof window._qnrrComputeForCommission === 'function')
    ? window._qnrrComputeForCommission(kamEmail, 'kam')
    : _tgtComputeKamNRR(kamEmail, null);
  const rawPct = raw && raw.nrr !== null ? raw.nrr * 100 : null; // v92-fix: unrounded, see _nrrGovernedPct
  const governedPct = _nrrGovernedPct(raw);
  const exclBase = _nrrExclusionBaseImpact(kamEmail, null, raw && raw.currentPeriod);
  return { raw, rawPct, governedPct, excludedBase: exclBase };
}

function _commGetTlListFromPortview() {
  const map = {};
  const rows = (typeof portviewBulkData !== 'undefined' ? (portviewBulkData || []) : []);
  rows.forEach(r => {
    const email = r.tlEmail || '';
    if (!email) return;
    if (!map[email]) map[email] = { email, name: r.tlName || email };
  });
  return Object.values(map);
}
// v225-comm: Extended snapshot rows with full component breakdown
// payout_amount = final_payout (NRR + Upsell + Handover) × GMV Gate
// breakdown jsonb includes config_snapshot for audit immutability
function _commBuildSnapshotRows(periodOverride) {
  const period = periodOverride || _nrrExclusionCurrentPeriod();
  const actor = (currentUserProfile && currentUserProfile.email) || '';
  const role = (currentUserProfile && currentUserProfile.role) || '';
  const rows = [];
  const allGroups = (typeof _buildKamGroups === 'function') ? (_buildKamGroups() || []) : [];
  const visibleTlEmail = role === 'admin'
    ? null
    : ((currentUserProfile && currentUserProfile.email) || '');
  const tls = role === 'admin' ? _commGetTlListFromPortview() : [{ email: visibleTlEmail, name: (currentUserProfile && currentUserProfile.full_name) || visibleTlEmail }];

  tls.filter(t => t.email).forEach(tl => {
    // v826: thread periodOverride so retroactive/auto-compute freezes the correct historical month
    const tlPayout = _commBuildTlPayout(tl.email, periodOverride);
    // v878 (phase 7): resolve+freeze which scheme actually produced this
    // payout — populates the previously-dead assigned_plan_id FK and gives
    // TL rows a config_snapshot for the first time (previously none at all).
    const tlPlanCode = _commGetAssignmentPlan(period, 'tl', tl.email, 'tl');
    const tlPlanRowId = ((_commRuleConfig && _commRuleConfig.plans) || {})[tlPlanCode]?.id || null;
    rows.push({
      period_month: period,
      beneficiary_role: 'tl',
      beneficiary_email: tl.email,
      team_lead_email: tl.email,
      raw_nrr_pct: tlPayout.nrr_pct,
      governed_nrr_pct: tlPayout.nrr_pct,
      payout_amount: tlPayout.final_payout,
      snapshot_status: 'final',
      assigned_plan_id: tlPlanRowId,
      breakdown: {
        version: 1,
        computed_at: new Date().toISOString(),
        period,
        type: 'tl_full',
        role: 'tl',
        team_lead_name: tl.name || tl.email,
        nrr_pct: tlPayout.nrr_pct,
        nrr_payout: tlPayout.nrr_payout,
        upsell_mult: tlPayout.upsell_mult,
        final_payout: tlPayout.final_payout,
        excluded_base_gmv: _nrrExclusionBaseImpact(null, tl.email),
        config_snapshot: {
          assigned_plan_code: tlPlanCode,
          assigned_plan_id: tlPlanRowId,
          tl_upsell_mult_tier: tlPayout.upsell_mult
        }
      },
      created_by: actor,
      updated_by: actor
    });
  });

  const groups = role === 'admin' ? allGroups : allGroups.filter(g => (g.accounts || []).some(a => a.tlEmail === visibleTlEmail));
  // PM/AD/sales/... people who hold a portfolio appear in portview grouped
  // as "a KAM under a team" (data side), but their REAL beneficiary role
  // comes from profiles (loaded into _commOtherRoleRoster). Without this
  // skip they'd get TWO snapshot rows per Compute — one paid at KAM rates
  // via this loop + one at their own role's rates via the otherRoster loop
  // below. Skip them here; their single correct row is built below.
  const _otherRoleEmails = new Set((_commOtherRoleRoster || []).map(p => (p.email || '').toLowerCase()));
  groups.forEach(g => {
    if (!g.kamEmail) return;
    if (_otherRoleEmails.has(g.kamEmail.toLowerCase())) return;
    const tlEmail = (g.accounts && g.accounts[0] && g.accounts[0].tlEmail) || null;
    const kamPayout = _commBuildKamPayout(g.kamEmail, periodOverride);
    // v878 (phase 7): resolve+freeze which scheme actually produced this
    // payout — populates the previously-dead assigned_plan_id FK.
    const kamPlanCode = _commGetAssignmentPlan(period, 'kam', g.kamEmail, 'kam');
    const kamPlanRowId = ((_commRuleConfig && _commRuleConfig.plans) || {})[kamPlanCode]?.id || null;
    rows.push({
      period_month: period,
      beneficiary_role: 'kam',
      beneficiary_email: g.kamEmail,
      team_lead_email: tlEmail,
      raw_nrr_pct: kamPayout.nrr_pct,
      governed_nrr_pct: kamPayout.nrr_pct,
      payout_amount: kamPayout.final_payout,
      snapshot_status: 'final',
      assigned_plan_id: kamPlanRowId,
      breakdown: {
        version: 1,
        computed_at: new Date().toISOString(),
        period,
        baseline_month: (bulkUpsellData && bulkUpsellData.baselineLabel) || '',
        type: 'kam_full',
        role: 'kam',
        kam_name: g.kamName || g.kamEmail,
        nrr_pct: kamPayout.nrr_pct,
        nrr_payout: kamPayout.nrr_payout,
        upsell_sku: {
          total_commission: kamPayout.upsell_sku.total_comm,
          p1: { gmv: kamPayout.upsell_sku.p1.gmv, comm: kamPayout.upsell_sku.p1.comm,
                groups: kamPayout.upsell_sku.p1.groups },
          p3: { gmv_incremental: kamPayout.upsell_sku.p3.gmv_incremental,
                comm: kamPayout.upsell_sku.p3.comm, groups: kamPayout.upsell_sku.p3.groups }
        },
        upsell_outlet: kamPayout.upsell_outlet,
        handover: { accounts: kamPayout.handover.accounts,
                    baseline_gmv: kamPayout.handover.baseline_gmv,
                    current_gmv: kamPayout.handover.current_gmv,
                    retention_pct: kamPayout.handover.retention_pct,
                    tier: kamPayout.handover.tier,
                    payout: kamPayout.handover.payout,
                    detail: kamPayout.handover.detail,
                    gmv_tier_label: kamPayout.handover.gmv_tier_label,
                    gmv_bucket_gmv: kamPayout.handover.gmv_bucket_gmv },
        components_subtotal: kamPayout.subtotal,
        gmv_gate: kamPayout.gate,
        final_payout: kamPayout.final_payout,
        excluded_base_gmv: _nrrExclusionBaseImpact(g.kamEmail, null),
        account_count: g.total || ((g.accounts || []).length),
        // v247e: NRR detail for reconcile — cohort + expansion outlet breakdown
        // v828: quarterly mode reads cohort detail from bulkQnrrData rows (grouped by
        // account) instead of _tgtComputeKamNRR — was silently showing MoM detail that
        // didn't reconcile with the quarterly total shown just above.
        nrr_cohort_detail: (() => { try {
          if (kamPayout.commission_mode === 'quarterly' && typeof window._qnrrComputeForCommission === 'function') {
            const _qr = window._qnrrComputeForCommission(g.kamEmail, 'kam');
            const _rows = (_qr && _qr.by_month && _qr.by_month[_qr.currentPeriod] && _qr.by_month[_qr.currentPeriod].rows) || [];
            const _byAcct = {};
            _rows.filter(r => r.movement_type === 'core_nrr').forEach(r => {
              const aid = r.account_id || r.account_name;
              if (!_byAcct[aid]) _byAcct[aid] = { acctId: aid, acctName: r.account_name, outlets: [] };
              _byAcct[aid].outlets.push({ outletId: r.outlet_id, outletName: r.account_name,
                prevGmv: Math.round(r.base_gmv||0), currGmv: Math.round(r.curr_gmv||0) });
            });
            return Object.values(_byAcct);
          }
          const _r=_tgtComputeKamNRR(g.kamEmail,null,periodOverride); return _r&&_r.cohortDetail?_r.cohortDetail.map(a=>({acctId:a.acctId,acctName:a.acctName,outlets:(a.outlets||[]).map(o=>({outletId:o.outletId,outletName:o.outletName,prevGmv:Math.round(o.prevGmv||0),currGmv:Math.round(o.currGmv||0)}))})):[]
        } catch(e){return []} })(),
        expansion_detail: (() => { try {
          if (kamPayout.commission_mode === 'quarterly' && typeof window._qnrrComputeForCommission === 'function') {
            const _qr = window._qnrrComputeForCommission(g.kamEmail, 'kam');
            const _rows = (_qr && _qr.by_month && _qr.by_month[_qr.currentPeriod] && _qr.by_month[_qr.currentPeriod].rows) || [];
            return _rows.filter(r => r.movement_type === 'expansion')
              .map(r => ({ outletId: r.outlet_id, outletName: r.account_name, gmv: Math.round(r.curr_gmv||0) }));
          }
          const _r=_tgtComputeKamNRR(g.kamEmail,null,periodOverride); const _ex=[]; const _add=d=>{(d&&d.expansionDetail||[]).forEach(a=>{(a.outlets||[]).forEach(o=>{_ex.push({outletId:o.outletId,outletName:o.outletName,gmv:Math.round(o.currGmv||0)});})})}; if(_r){_add(_r);_add(_r.transferIn);_add(_r.newFromSales);} return _ex;
        } catch(e){return []} })(),
        lock_trigger: 'manual',
        csv_data_as_of: new Date().toISOString(),
        // Config snapshot — freeze param values at time of snapshot for audit.
        // v878 (phase 7): added assigned_plan_code/id (which scheme actually
        // computed this row — previously not recorded anywhere) and the
        // Handover gmv_tiers ladder actually in effect (previously only the
        // resolved tier/payout were frozen, never the ladder that produced
        // them). The scalar rates below still read the legacy global blob
        // directly — correct today because every currently-active
        // per-scheme component rule was seeded to match those blob values
        // exactly (see phases 3-5's seed migrations), but once the Cockpit
        // gains a per-scheme component editor (deferred, phase 6 scope
        // note) this must switch to reading the resolved values kamPayout
        // actually used instead of re-reading global config after the fact.
        config_snapshot: {
          assigned_plan_code:           kamPlanCode,
          assigned_plan_id:             kamPlanRowId,
          upsell_sku_p1_rate:           _commGetConfig('upsell_sku','p1_rate',0.01),   // v835-fix: was 0.03
          upsell_sku_p3_rate:           _commGetConfig('upsell_sku','p3_rate',0.01),   // v835-fix: was 0.03
          upsell_sku_p3_threshold_pct:  _commGetConfig('upsell_sku','p3_threshold_pct',2.00),
          upsell_sku_p3_min_incremental:_commGetConfig('upsell_sku','p3_min_incremental',8000), // v835-fix: was 5000
          upsell_sku_p1_min_gmv:        _commGetConfig('upsell_sku','p1_min_gmv',5000), // v6-fix: was 2500, drifted from the real gate check (line ~210) and confirmed Supabase value (5000)
          upsell_outlet_rate:           _commGetConfig('upsell_outlet','rate',0.005),  // v835-fix: was 0.015
          gmv_gate_threshold_1:         _commGetConfig('gmv_gate','threshold_1',98),   // v835-fix: was 95
          gmv_gate_threshold_2:         _commGetConfig('gmv_gate','threshold_2',95),   // v835-fix: was 90
          gmv_gate_cap_1:               _commGetConfig('gmv_gate','cap_1',0.3),        // v835-fix: was 0.70
          gmv_gate_cap_2:               _commGetConfig('gmv_gate','cap_2',0),          // v835-fix: was 0.35
          handover_gmv_tiers:           _commGetHandoverGmvTiers(),
          // v_catbonus: freeze the per-category/group override map actually in
          // effect for this scheme when locked. The p1_rate/p3_rate above stay
          // the BASE rate (the fallback for un-bonus'd groups); the per-group
          // rate that actually hit each line is stored per-group in
          // breakdown.upsell_sku.p1.groups[].applied_rate (see engine).
          upsell_category_bonus:        _commResolveUpsellRateMap(kamPlanCode)
        }
      },
      created_by: actor,
      updated_by: actor
    });
  });

  // v878 (phase 8): other-role roster (pm/admin/sales/sales_tl/ad/ad_tl),
  // sourced from `profiles` via loadTargets() — mirrors the kam branch's
  // breakdown shape (same _commBuildKamPayout return shape for any role)
  // since none of these roles have a TL concept, team_lead_email stays null.
  const otherRoster = role === 'admin'
    ? _commOtherRoleRoster
    : _commOtherRoleRoster.filter(p => p.email === actor);
  otherRoster.forEach(person => {
    const personPayout = _commBuildKamPayout(person.email, periodOverride, person.role);
    const personPlanCode = _commGetAssignmentPlan(period, person.role, person.email, person.role);
    const personPlanRowId = ((_commRuleConfig && _commRuleConfig.plans) || {})[personPlanCode]?.id || null;
    rows.push({
      period_month: period,
      beneficiary_role: person.role,
      beneficiary_email: person.email,
      team_lead_email: null,
      raw_nrr_pct: personPayout.nrr_pct,
      governed_nrr_pct: personPayout.nrr_pct,
      payout_amount: personPayout.final_payout,
      snapshot_status: 'final',
      assigned_plan_id: personPlanRowId,
      breakdown: {
        version: 1,
        computed_at: new Date().toISOString(),
        period,
        baseline_month: (bulkUpsellData && bulkUpsellData.baselineLabel) || '',
        type: 'kam_full',
        role: person.role,
        kam_name: person.name || person.email,
        nrr_pct: personPayout.nrr_pct,
        nrr_payout: personPayout.nrr_payout,
        upsell_sku: {
          total_commission: personPayout.upsell_sku.total_comm,
          p1: { gmv: personPayout.upsell_sku.p1.gmv, comm: personPayout.upsell_sku.p1.comm,
                groups: personPayout.upsell_sku.p1.groups },
          p3: { gmv_incremental: personPayout.upsell_sku.p3.gmv_incremental,
                comm: personPayout.upsell_sku.p3.comm, groups: personPayout.upsell_sku.p3.groups }
        },
        upsell_outlet: personPayout.upsell_outlet,
        handover: { accounts: personPayout.handover.accounts,
                    baseline_gmv: personPayout.handover.baseline_gmv,
                    current_gmv: personPayout.handover.current_gmv,
                    retention_pct: personPayout.handover.retention_pct,
                    tier: personPayout.handover.tier,
                    payout: personPayout.handover.payout,
                    detail: personPayout.handover.detail,
                    gmv_tier_label: personPayout.handover.gmv_tier_label,
                    gmv_bucket_gmv: personPayout.handover.gmv_bucket_gmv },
        components_subtotal: personPayout.subtotal,
        gmv_gate: personPayout.gate,
        final_payout: personPayout.final_payout,
        excluded_base_gmv: _nrrExclusionBaseImpact(person.email, null),
        account_count: 0,
        config_snapshot: {
          assigned_plan_code: personPlanCode,
          assigned_plan_id: personPlanRowId
        }
      },
      created_by: actor,
      updated_by: actor
    });
  });

  return rows;
}

// v210g: one source of truth for scorecard/preview totals.
// Uses the same snapshot rows used by Lock/CSV, so Admin/TL/KAM totals cannot drift from Preview.
function _commBuildPayoutSummary(scope) {
  const role = getCurrentRole();
  const email = (currentUserProfile && currentUserProfile.email) || '';
  const rows = _commBuildSnapshotRows();
  let scoped = rows;
  if (scope === 'kam' || isRepRole(role)) {
    scoped = rows.filter(r => r.beneficiary_role === 'kam' && r.beneficiary_email === email);
  } else if (scope === 'tl' || role === 'tl') {
    scoped = rows.filter(r => r.team_lead_email === email || r.beneficiary_email === email);
  }
  const tlRows = scoped.filter(r => r.beneficiary_role === 'tl');
  const kamRows = scoped.filter(r => r.beneficiary_role === 'kam');
  const sum = arr => arr.reduce((s,r)=>s+Number(r.payout_amount||0),0);
  return {
    rows: scoped,
    tlRows,
    kamRows,
    tlPayout: sum(tlRows),
    kamPayout: sum(kamRows),
    total: sum(scoped),
    hitKams: kamRows.filter(r=>Number(r.payout_amount||0)>0).length,
    kamCount: kamRows.length,
    teamCount: Array.from(new Set(scoped.map(r=>r.team_lead_email).filter(Boolean))).length
  };
}

function _commFormatPts(n) {
  const x = Number(n || 0);
  return x.toFixed(1).replace('.0','');
}
function _commTierRangeLabel(t) {
  const min = t.min_value === null || t.min_value === undefined || t.min_value === '' ? null : Number(t.min_value);
  const max = t.max_value === null || t.max_value === undefined || t.max_value === '' ? null : Number(t.max_value);
  if (min === null && max !== null) return `< ${_commFormatPts(max)}%`;
  if (min !== null && max === null) return `≥ ${_commFormatPts(min)}%`;
  if (min !== null && max !== null) return `${_commFormatPts(min)}–${_commFormatPts(max)}%`;
  return 'ทุกช่วง';
}
// SECTION:COMMISSION_KAM_SELF
function _commBuildKamSelfState() {
  const role = getCurrentRole ? getCurrentRole() : ((currentUserProfile && currentUserProfile.role) || '');
  const selfEmail = (currentUserProfile && currentUserProfile.email) || '';
  // v305: TL/Admin drilling into a KAM portfolio (rep-detail) → show that KAM's commission strip
  const isViewingKamPortfolio = (isTLRole(role) || isAdminRole(role)) && portviewLevel === 'rep-detail' && portviewRepEmail;
  const email = isViewingKamPortfolio ? portviewRepEmail : selfEmail;
  if (!isViewingKamPortfolio && (isTLRole(role) || isAdminRole(role))) return null;
  if (!email) return null;
  // v6-fix: guard against QNRR not loaded yet (quarterly mode). Without this,
  // _qnrrComputeForCommission() returns null while bulkQnrrData isn't ready, the null
  // pct fails to match any tier in _commPayoutForPctByCode(), and the function silently
  // resolves to payout=0 — showing a confident-looking "฿0 NRR" instead of a loading
  // state. Mirrors the existing bulkQnrrData.loaded guard already used in
  // 07c_qnrr_view.js:606. Force-releases after 15s (see _fetchQnrrBundle) so this can
  // never shimmer forever if QNRR genuinely fails to load.
  const _qPolicy = typeof _nrrGovResolveForVisibleScope === 'function' ? _nrrGovResolveForVisibleScope() : null;
  const _isQuarterly = _qPolicy && _qPolicy.commission_mode === 'quarterly';
  const _qnrrReady = typeof window.bulkQnrrData !== 'undefined' && window.bulkQnrrData && window.bulkQnrrData.loaded;
  const _qnrrForceReleased = typeof window._qnrrForceRelease !== 'undefined' && window._qnrrForceRelease;
  if (_isQuarterly && !_qnrrReady && !_qnrrForceReleased) {
    return { role, email, loading: true };
  }
  const period = _nrrExclusionCurrentPeriod();
  const pct = _commKamNrrPct(email);
  const planCode = _commGetAssignmentPlan(period, 'kam', email, 'kam');
  const payout = _commPayoutForPctByCode(planCode, 'kam', pct);
  const tier = _commMatchTierByCode(planCode, 'kam', pct);
  const ruleName = _commPlanNameByCode(planCode, 'kam');
  const tiers = (_commGetDraftByCode(planCode, 'kam').tiers || [])
    .slice()
    .sort((a,b)=>Number(a.min_value ?? -Infinity)-Number(b.min_value ?? -Infinity));
  const next = pct === null ? null : tiers.find(t => Number(t.payout_value||0) > Number(payout||0) && t.min_value !== null && Number(t.min_value) > pct);
  const currentIdx = tier ? tiers.findIndex(t => String(t.id||'') === String(tier.id||'') || (t.min_value === tier.min_value && t.max_value === tier.max_value && t.payout_value === tier.payout_value)) : -1;
  let status = 'ยังไม่ถึงเกณฑ์';
  let cls = 'miss';
  if (payout > 0) {
    const maxPayout = Math.max(0, ...tiers.map(t=>Number(t.payout_value||0)));
    cls = payout >= maxPayout && maxPayout > 0 ? 'bonus' : 'hit';
    status = cls === 'bonus' ? 'โบนัสสูงสุด' : 'ถึงเกณฑ์แล้ว';
  }
  let nextText = 'ดัน NRR ให้ถึงเกณฑ์แรกเพื่อเริ่มรับค่าคอมฯ';
  if (pct === null) nextText = 'รอข้อมูล NRR ของเดือนนี้';
  else if (next) nextText = `อีก +${_commFormatPts(Math.max(0, Number(next.min_value)-pct))} pts ถึง ${_commFmtPayout(next.payout_value)}`;
  else if (payout > 0) nextText = 'รักษา NRR ให้อยู่ใน tier นี้จนจบเดือน';
  const currentMin = tier && tier.min_value !== null && tier.min_value !== undefined ? Number(tier.min_value) : null;
  const nextMin = next && next.min_value !== null && next.min_value !== undefined ? Number(next.min_value) : null;
  let progress = payout > 0 ? 100 : 0;
  if (pct !== null && nextMin !== null) {
    const base = currentMin !== null ? currentMin : Math.max(0, nextMin - 10);
    const denom = Math.max(1, nextMin - base);
    progress = Math.max(4, Math.min(96, ((pct - base) / denom) * 100));
  }
  return { role, email, period, pct, planCode, payout, tier, ruleName, tiers, next, currentIdx, status, cls, nextText, progress };
}
function _commBuildKamSelfCard() {
  const st = _commBuildKamSelfState();
  if (!st) return '';
  if (st.loading) {
    return `<div class="pv-comm-strip">
    <div class="pv-comm-left">
      <div class="pv-comm-top">
        <div class="pv-comm-eyebrow">ค่าคอมฯ เดือนนี้</div>
      </div>
      <div class="pv-comm-copyline"><span class="skel" style="display:inline-block;width:130px;height:12px;border-radius:var(--r-xs);vertical-align:middle"></span></div>
      <div class="pv-comm-next"><span class="skel" style="display:inline-block;width:90px;height:11px;border-radius:var(--r-xs);vertical-align:middle"></span></div>
    </div>
    <div class="pv-comm-right">
      <div class="pv-comm-main"><span class="skel" style="display:inline-block;width:56px;height:20px;border-radius:var(--r-xs);vertical-align:middle"></span></div>
    </div>
  </div>`;
  }
  const pctText = _commFmtPct(st.pct);
  const tierLabel = st.tier && st.tier.payout_label ? _commEscapeHtml(st.tier.payout_label) : st.status;
  return `<div class="pv-comm-strip ${st.cls}">
    <div class="pv-comm-left">
      <div class="pv-comm-top">
        <div class="pv-comm-eyebrow">ค่าคอมฯ เดือนนี้</div>
        <div class="pv-comm-chip">${_commEscapeHtml(st.status)}</div>
      </div>
      <div class="pv-comm-copyline">Governed NRR ${pctText} · ${tierLabel}</div>
      <div class="pv-comm-next">${_commEscapeHtml(st.nextText)}</div>
    </div>
    <div class="pv-comm-right">
      <div class="pv-comm-main">${_commFmtPayout(st.payout)}</div>
      <button class="pv-comm-i" aria-label="ดูวิธีคำนวณค่าคอมฯ" onclick="event.stopPropagation();_commOpenKamSelfSheet();">i</button>
    </div>
    <div class="pv-comm-progress"><div class="pv-comm-progress-fill" style="width:${Math.round(st.progress)}%"></div></div>
  </div>`;
}
function _commRenderKamSelfStrip() {
  const slot = document.getElementById('pv-commission-strip') || (function(){
    const row = document.getElementById('portview-summary-row');
    if (!row || !row.parentNode) return null;
    const d = document.createElement('div');
    d.id = 'pv-commission-strip';
    d.className = 'pv-commission-strip-slot';
    row.parentNode.insertBefore(d, row);
    return d;
  })();
  if (!slot) return;
  const html = _commBuildKamSelfCard();
  slot.innerHTML = html || '';
}
function _commOpenKamSelfSheet() {
  const st = _commBuildKamSelfState();
  if (!st) return;
  let ov = document.getElementById('pv-comm-sheet-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'pv-comm-sheet-overlay';
    ov.className = 'pv-comm-sheet-overlay';
    ov.onclick = function(e){ if(e.target === ov) _commCloseKamSelfSheet(); };
    document.body.appendChild(ov);
  }
  const pctText = _commFmtPct(st.pct);
  const tierRows = st.tiers.map((t, idx)=>{
    const on = st.tier && (idx === st.currentIdx);
    const isNext = st.next && String(t.id||idx) === String(st.next.id||st.tiers.indexOf(st.next));
    return `<div class="pv-comm-tier-row ${on?'on':isNext?'next':''}">
      <div class="pv-comm-tier-range">${_commEscapeHtml(_commTierRangeLabel(t))} · ${_commEscapeHtml(t.payout_label || '')}</div>
      <div class="pv-comm-tier-pay">${_commFmtPayout(t.payout_value)}</div>
    </div>`;
  }).join('');
  const kpiCls = st.cls === 'bonus' ? 'val-bonus' : (st.payout > 0 ? 'val-good' : '');
  const action = st.pct === null
    ? 'ยังไม่มีข้อมูล NRR สำหรับคำนวณค่าคอมฯ เดือนนี้'
    : (st.next ? `ต้องเพิ่ม Governed NRR อีก +${_commFormatPts(Math.max(0, Number(st.next.min_value)-st.pct))} pts เพื่อถึง tier ถัดไป` : (st.payout > 0 ? 'ตอนนี้ถึง tier แล้ว เป้าหมายคือรักษา NRR ไม่ให้หลุดก่อนจบเดือน' : 'ยังไม่ถึง payout tier แรก ให้โฟกัสร้านเสี่ยงและ monitor ก่อน'));
  ov.innerHTML = `<div class="pv-comm-sheet">
    <div class="pv-comm-sheet-handle"></div>
    <div class="pv-comm-sheet-body">
      <div class="pv-comm-sheet-title">วิธีคิดค่าคอมฯ</div>
      <div class="pv-comm-sheet-sub">คำนวณจาก Governed NRR หลัง policy adjustment ของเดือนนี้</div>
      <div class="pv-comm-sheet-kpis">
        <div class="pv-comm-sheet-kpi ${kpiCls}"><div class="pv-comm-sheet-kpi-label">ค่าคอมฯ ตอนนี้</div><div class="pv-comm-sheet-kpi-val">${_commFmtPayout(st.payout)}</div></div>
        <div class="pv-comm-sheet-kpi"><div class="pv-comm-sheet-kpi-label">Governed NRR</div><div class="pv-comm-sheet-kpi-val">${pctText}</div></div>
      </div>
      <div class="pv-comm-sheet-sub"><strong style="color:var(--tk-text-primary)">Rule:</strong> ${_commEscapeHtml(st.ruleName)}</div>
      <div class="pv-comm-tier-table">${tierRows}</div>
      <div class="pv-comm-action-note">${_commEscapeHtml(action)}</div>
      <button class="pv-comm-sheet-close" onclick="_commCloseKamSelfSheet()">ปิด</button>
    </div>
  </div>`;
  requestAnimationFrame(()=>ov.classList.add('on'));
}
function _commCloseKamSelfSheet() {
  const ov = document.getElementById('pv-comm-sheet-overlay');
  if (!ov) return;
  ov.classList.remove('on');
  setTimeout(()=>{ ov.innerHTML=''; }, 260);
}
// ── TL Commission Detail Sheet ────────────────────────────────
function _commOpenTlDetailSheet(opts) {
  opts = opts || {};
  const role = getCurrentRole ? getCurrentRole() : '';
  // v499: ad_tl can also open TL commission detail sheet
  if (!isTLRole(role) && !isAdminRole(role) && !(typeof isADTLRole==='function' && isADTLRole(role))) return;
  // v230-fix: force-fetch upsell_team from R2 on first open if not in memory.
  // Root cause: _cloudInitialPromise is nulled after FOREGROUND load, and upsell_team
  // fetch silently fails (not in IDB cache + R2 fetch error) → bulkUpsellTeamData stays empty.
  const _upsellTeamReady = typeof bulkUpsellTeamData !== 'undefined' &&
                           bulkUpsellTeamData && Object.keys(bulkUpsellTeamData).length > 0;
  if (!_upsellTeamReady && !opts._skipUpsellFetch) {
    let _loadOv = document.getElementById('pv-comm-tl-sheet-overlay');
    if (!_loadOv) {
      _loadOv = document.createElement('div');
      _loadOv.id = 'pv-comm-tl-sheet-overlay';
      _loadOv.className = 'pv-comm-sheet-overlay';
      _loadOv.onclick = function(e){ if(e.target===_loadOv) _commCloseTlDetailSheet(); };
      document.body.appendChild(_loadOv);
    }
    _loadOv.innerHTML = '<div class="pv-comm-sheet"><div class="pv-comm-sheet-handle"></div><div class="pv-comm-sheet-body" style="display:flex;align-items:center;justify-content:center;min-height:160px"><div style="text-align:center;color:rgba(var(--ink-blue),.7);font-size:var(--text-base)">กำลังโหลดข้อมูล upsell...<br><span style="font-size:var(--text-sm);opacity:.6">ใช้เวลาไม่กี่วินาที</span></div></div></div>';
    requestAnimationFrame(function(){ _loadOv.classList.add('on'); });
    var _doFetch = typeof _fetchCloudflareFile === 'function' && typeof R2_SPECS !== 'undefined' && R2_SPECS && R2_SPECS['upsell_team'];
    var _fp = _doFetch ? _fetchCloudflareFile(R2_SPECS['upsell_team'], {force:true}) : Promise.resolve(false);
    _fp.finally(function() {
      var _ov2 = document.getElementById('pv-comm-tl-sheet-overlay');
      if (_ov2) { _ov2.classList.remove('on'); _ov2.innerHTML = ''; }
      setTimeout(function(){ _commOpenTlDetailSheet({_skipUpsellFetch:true}); }, 60);
    });
    return;
  }
  let ov = document.getElementById('pv-comm-tl-sheet-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'pv-comm-tl-sheet-overlay';
    ov.className = 'pv-comm-sheet-overlay';
    ov.onclick = function(e){ if(e.target===ov) _commCloseTlDetailSheet(); };
    document.body.appendChild(ov);
  }
  const tlEmail = (currentUserProfile && currentUserProfile.email) || '';
  const tlPayout = _commBuildTlPayout(tlEmail);
  const summary = _commBuildPayoutSummary('tl');
  // v854-fix: was calling _commComputeTeamUpsellMult(tlEmail) with no isQuarterly/
  // baseMo, so the multiplier % badge shown here always used rolling-MoM logic even
  // in quarterly mode — diverging from tlPayout.upsell_mult (the value actually baked
  // into final_payout above, which IS correctly wired via _commBuildTlPayout).
  const _tdsPolicy = typeof _nrrGovResolveForVisibleScope === 'function' ? _nrrGovResolveForVisibleScope() : null;
  const _tdsIsQ     = _tdsPolicy && _tdsPolicy.commission_mode === 'quarterly';
  const _tdsBaseMo  = _tdsIsQ ? (_tdsPolicy.base_month || null) : null;
  const um = typeof _commComputeTeamUpsellMult === 'function' ? _commComputeTeamUpsellMult(tlEmail, _tdsIsQ, _tdsBaseMo) : {multiplier:1.0,tier:1,team_upsell_pct:0};
  const multLoaded = typeof bulkUpsellTeamData!=='undefined'&&bulkUpsellTeamData&&Object.keys(bulkUpsellTeamData).length>0; // v230fix3: use team summary, not full bundle
  function fmtP(n){ return _commFmtPayout(n||0); }

  // KAM rows — single line per KAM, amber payout, readable detail
  const kamRows = (summary.kamRows || []).map(r => {
    const bd = r.breakdown || {};
    const upsell = (bd.upsell_sku ? (bd.upsell_sku.total_comm||bd.upsell_sku.total_commission||0) : 0)
                 + (bd.upsell_outlet ? (bd.upsell_outlet.commission||0) : 0);
    const nrrP = bd.nrr_payout || 0;
    const ho   = bd.handover ? (bd.handover.payout||0) : 0;
    const finalAmt = r.payout_amount || r.final_payout || 0;
    // resolve name: use portview display name
    const pvRow = (portviewBulkData||[]).find(p => p.kamEmail === (r.beneficiary_email||''));
    const name = (pvRow && pvRow.kamName) || bd.kam_name || r.beneficiary_email || '';
    const nrr  = _commFmtPct(r.governed_nrr_pct);
    const detailParts = ['NRR '+fmtP(nrrP)];
    if (upsell > 0) detailParts.push('Uplift '+fmtP(upsell));
    if (ho > 0)     detailParts.push('HO '+fmtP(ho));
    // v228-fix: show — when upsell not loaded and NRR payout is 0
    const upsellNotLoaded = r.breakdown && r.breakdown.upsell_loading;
    const displayAmt = (upsellNotLoaded && nrrP === 0) ? null : finalAmt;
    const amberStyle = (displayAmt !== null && displayAmt > 0) ? 'color:#ffe08a;font-weight:var(--fw-bold)' : 'color:rgba(255,255,255,.52)';
    const payText = displayAmt === null ? '<span style="color:rgba(255,255,255,.52);font-size:var(--text-sm)">— โหลด...</span>' : fmtP(displayAmt);
    return `<div class="pv-comm-tl-kam-row">
      <div class="pv-comm-tl-kam-name">${_commEscapeHtml(name)}</div>
      <div class="pv-comm-tl-kam-nrr">${nrr}</div>
      <div class="pv-comm-tl-kam-pay" style="${amberStyle}">${payText}</div>
      <div class="pv-comm-tl-kam-detail">${detailParts.join(' · ')}</div>
    </div>`;
  }).join('');

  const multSection = multLoaded
    ? `<div class="pv-comm-tl-mult">
        <span style="color:#ffe08a;font-weight:var(--fw-bold)">×${um.multiplier.toFixed(2)} Upsell Mult</span>
        <span style="color:rgba(255,255,255,.6);font-size:var(--text-sm)">${um.team_upsell_pct.toFixed(1)}% upsell · T${um.tier}</span>
       </div>`
    : `<div class="pv-comm-tl-mult" style="color:rgba(255,255,255,.52)">Upsell Mult — กำลังโหลด...</div>`;

  ov.innerHTML = `<div class="pv-comm-sheet">
    <div class="pv-comm-sheet-handle"></div>
    <div class="pv-comm-sheet-body">
      <div class="pv-comm-sheet-title">Commission ทีม</div>
      <div class="pv-comm-sheet-kpis">
        <div class="pv-comm-sheet-kpi val-bonus">
          <div class="pv-comm-sheet-kpi-label">TL ได้</div>
          <div class="pv-comm-sheet-kpi-val">${fmtP(tlPayout.final_payout)}</div>
        </div>
        <div class="pv-comm-sheet-kpi val-bonus">
          <div class="pv-comm-sheet-kpi-label">KAM ทีมรวม</div>
          <div class="pv-comm-sheet-kpi-val">${fmtP(summary.kamPayout)}</div>
        </div>
      </div>
      <div class="pv-comm-sheet-sub">NRR ทีม ${_commFmtPct(tlPayout.nrr_pct)} · NRR payout ${fmtP(tlPayout.nrr_payout)}</div>
      ${multSection}
      ${(()=>{try{var _e=typeof _commEomStatus==='function'?_commEomStatus():null;if(_e&&(_e.showEomBanner||_e.showGraceBanner)){var _d=_e.showGraceBanner?_e.prevPeriod:_e.period;var _mo=_d.split('-');var _thmo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(_mo[1])-1];var _lbl=_thmo+' '+( parseInt(_mo[0])+543);var _bg=_e.showGraceBanner||_e.daysLeft<=1?'rgba(240,80,0,.12)':'rgba(240,160,0,.08)';var _bc=_e.showGraceBanner||_e.daysLeft<=1?'rgba(240,80,0,.35)':'rgba(240,160,0,.25)';var _txt=_e.showGraceBanner?'ยัง lock ค่าคอมฯ '+_lbl+' ไม่ได้':'เหลือ '+_e.daysLeft+' วัน — Lock ค่าคอมฯ '+_lbl+' ก่อนสิ้นเดือน';return '<div style="margin:8px 18px;padding:10px 12px;border-radius:var(--r-md);background:'+_bg+';border:1px solid '+_bc+';display:flex;align-items:center;justify-content:space-between;gap:8px"><div style="font-size:var(--text-sm);color:rgba(var(--ink-blue-hi),.80);line-height:1.4">'+_txt+'</div><button onclick="event.stopPropagation();lockCommissionSnapshot()" style="flex-shrink:0;padding:6px 10px;border-radius:var(--r-8);background:rgba(255,224,138,.15);border:1px solid rgba(255,224,138,.3);color:#ffe08a;font-size:var(--text-sm);font-weight:var(--fw-bold);cursor:pointer;font-family:\'Noto Sans Thai\',sans-serif">Lock ตอนนี้</button></div>';}return '';}catch(e){return '';}})()} 
      <div class="pv-comm-section-label" style="margin-top:4px">รายละเอียดต่อ KAM</div>
      <div class="pv-comm-tl-kam-header">
        <span>ชื่อ</span><span>NRR</span><span>ค่าคอมฯ</span>
      </div>
      <div class="pv-comm-tl-kam-list">${kamRows||'<div style="color:rgba(255,255,255,.52);font-size:var(--text-md);padding:8px">กำลังโหลด...</div>'}</div>
      <div style="display:flex;gap:6px;margin:0 18px 8px">
        <button onclick="typeof openCommissionHistory==='function'&&(_commCloseTlDetailSheet(),setTimeout(openCommissionHistory,80))" style="flex:1;padding:10px;border-radius:var(--r-md);background:var(--tk-ok-dim);border:1px solid var(--tk-ok-dim-2);color:var(--tk-ok-bright);font-size:var(--text-md);font-weight:var(--fw-bold);cursor:pointer;font-family:var(--tk-font-body)">History</button>
        <button onclick="typeof openCommissionRulebook==='function'&&(_commCloseTlDetailSheet(),setTimeout(openCommissionRulebook,80))" style="flex:1;padding:10px;border-radius:var(--r-md);background:rgba(var(--ink-blue),.08);border:1px solid rgba(var(--ink-blue),.22);color:rgba(var(--ink-blue-hi),.88);font-size:var(--text-md);font-weight:var(--fw-bold);cursor:pointer;font-family:var(--tk-font-body)">Rules</button>
      </div>
      <button class="pv-comm-sheet-close" onclick="_commCloseTlDetailSheet()">ปิด</button>
    </div>
  </div>`;
  requestAnimationFrame(()=>ov.classList.add('on'));
}
function _commCloseTlDetailSheet() {
  const ov = document.getElementById('pv-comm-tl-sheet-overlay');
  if (!ov) return;
  ov.classList.remove('on');
  setTimeout(()=>{ ov.innerHTML=''; }, 260);
}
window._commOpenTlDetailSheet = _commOpenTlDetailSheet;
window._commCloseTlDetailSheet = _commCloseTlDetailSheet;

// Inject CSS for TL badge + TL detail sheet + KAM list
(function(){
  if (document.getElementById('_comm_tl_styles')) return;
  const s = document.createElement('style');
  s.id = '_comm_tl_styles';
  s.textContent = `
    .tv-mult-badge{display:inline-flex;align-items:center;font-size:var(--text-xs);font-weight:var(--fw-bold);padding:1px 5px;border-radius:var(--r-xs);margin-left:4px;background:rgba(255,255,255,.1);color:rgba(255,255,255,.6);vertical-align:middle}
    .tv-mult-badge.ok{background:rgba(255,224,138,.15);color:#ffe08a}
    .tv-mult-badge.loading{color:rgba(255,255,255,.52)}
    .pv-comm-tl-mult{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,224,138,.07);border:1px solid rgba(255,224,138,.18);border-radius:var(--r-8);font-size:var(--text-md);font-weight:var(--fw-semi);color:rgba(255,255,255,.85);margin:8px 0 0}
    .pv-comm-tl-kam-header{display:grid;grid-template-columns:1fr 44px 76px;gap:4px;padding:6px 0 4px;font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(255,255,255,.52);text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid rgba(255,255,255,.07);margin-top:6px}
    .pv-comm-tl-kam-list{display:flex;flex-direction:column;max-height:320px;overflow-y:auto;margin-top:2px}
    .pv-comm-tl-kam-row{display:grid;grid-template-columns:1fr 44px 76px;grid-template-rows:auto auto;gap:1px 4px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);align-items:center}
    .pv-comm-tl-kam-row:last-child{border-bottom:none}
    .pv-comm-tl-kam-name{font-size:var(--text-md);font-weight:var(--fw-semi);color:var(--tk-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;grid-row:1;grid-column:1}
    .pv-comm-tl-kam-nrr{font-size:var(--text-sm);color:rgba(255,255,255,.55);text-align:right;grid-row:1;grid-column:2}
    .pv-comm-tl-kam-pay{font-family:'IBM Plex Mono','Noto Sans Thai',monospace;font-size:var(--text-base);font-weight:var(--fw-bold);text-align:right;grid-row:1;grid-column:3}
    .pv-comm-tl-kam-detail{grid-column:1/-1;grid-row:2;font-size:var(--text-xs);color:rgba(255,255,255,.72);line-height:1.4}
  `;
  (document.head || document.body).appendChild(s);
})();
window._commOpenKamSelfSheet = _commOpenKamSelfSheet;
window._commCloseKamSelfSheet = _commCloseKamSelfSheet;

function _commSnapshotCsv(rows) {
  const header = [
    'period_month','beneficiary_role','beneficiary_email','team_lead_email',
    'name','raw_nrr_pct','governed_nrr_pct',
    'nrr_payout','upsell_sku','upsell_outlet','handover',
    'subtotal','gate_cap','final_payout',
    'handover_retention_pct','handover_accounts',
    'p1_gmv','p3_incremental','upsell_mult',
    'snapshot_status','computed_at'
  ].join(',');
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g,'""') + '"' : s;
  };
  const dataRows = rows.map(r => {
    const bd = r.breakdown || {};
    const isKam = r.beneficiary_role === 'kam';
    const name = bd.kam_name || bd.team_lead_name || r.beneficiary_email;
    const upsellSku   = isKam && bd.upsell_sku ? bd.upsell_sku.total_commission : '';
    const upsellOut   = isKam && bd.upsell_outlet ? bd.upsell_outlet.commission : '';
    const handoverPay = isKam && bd.handover ? bd.handover.payout : '';
    const subtotal    = isKam && bd.components_subtotal !== undefined ? bd.components_subtotal : '';
    const gateCap     = isKam && bd.gmv_gate ? bd.gmv_gate.cap_multiplier : '';
    const retPct      = isKam && bd.handover ? bd.handover.retention_pct : '';
    const hoAccts     = isKam && bd.handover ? bd.handover.accounts : '';
    const p1Gmv       = isKam && bd.upsell_sku && bd.upsell_sku.p1 ? bd.upsell_sku.p1.gmv : '';
    const p3Incr      = isKam && bd.upsell_sku && bd.upsell_sku.p3 ? bd.upsell_sku.p3.gmv_incremental : '';
    const upsellMult  = !isKam && bd.upsell_mult ? bd.upsell_mult.multiplier : '';
    return [
      esc(r.period_month), esc(r.beneficiary_role), esc(r.beneficiary_email), esc(r.team_lead_email),
      esc(name), esc(r.raw_nrr_pct), esc(r.governed_nrr_pct),
      esc(bd.nrr_payout !== undefined ? bd.nrr_payout : ''), esc(upsellSku), esc(upsellOut), esc(handoverPay),
      esc(subtotal), esc(gateCap), esc(r.payout_amount),
      esc(retPct), esc(hoAccts),
      esc(p1Gmv), esc(p3Incr), esc(upsellMult),
      esc(r.snapshot_status), esc(bd.computed_at || '')
    ].join(',');
  });
  return [header, ...dataRows].join('\n');
}
// SECTION:SNAPSHOT_LOCK
function exportCommissionSnapshotCsv(periodOverride) {
  // v288: export from stored snapshot (draft or final) — not live recompute
  // This ensures CSV matches what was locked, not a re-run at export time.
  const period = periodOverride || _nrrExclusionCurrentPeriod();
  const stored = (_commissionSnapshots || []).filter(r => r.period_month === period);
  const rows = stored.length ? stored : _commBuildSnapshotRows();
  const source = stored.length ? (stored.some(r => r.snapshot_status === 'final') ? 'final' : 'draft') : 'live';
  if (!rows.length) {
    if (typeof showToast === 'function') showToast('ยังไม่มีข้อมูล snapshot ให้ export', '!');
    return;
  }
  const csv = _commSnapshotCsv(rows);
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `freshket_commission_${source}_${period}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  console.log(`[CommExport] exported ${rows.length} rows from ${source} snapshot for ${period}`);
}
// v288: computeCommissionDraft — บันทึก draft ก่อน lock
// Admin กด Compute → เห็นตัวเลข frozen → กด Lock → เปลี่ยนเป็น final
async function computeCommissionDraft(periodOverride) {
  const period = periodOverride || _nrrExclusionCurrentPeriod();
  // v6-fix: guard against silently overwriting an already-locked (final) snapshot.
  // Root cause: this function previously unconditionally upserted fresh draft rows over
  // ANY existing row (including 'final') for the same period+role+email key -- no check,
  // no warning. Clicking "Compute" again on an already-locked period would silently
  // demote it back to 'draft' with freshly-computed (possibly different) numbers, with
  // no way to know it happened. Same confirm() pattern already used below in
  // lockCommissionSnapshot() for the pending-exclusion check.
  const _lockedRows = (_commissionSnapshots || []).filter(r =>
    r.period_month === period && r.snapshot_status === 'final'
  );
  let _overwroteLock = false;
  if (_lockedRows.length) {
    const _lockedTotal = _lockedRows.reduce((sum, r) => sum + Number(r.payout_amount || r.final_payout || 0), 0);
    const _confirmMsg = `⚠️ เดือน ${period} ถูก Lock แล้ว ${_lockedRows.length} รายการ (รวม ${typeof _commFmtPayout === 'function' ? _commFmtPayout(_lockedTotal) : '฿' + Math.round(_lockedTotal).toLocaleString('en-US')})\n\nComp ใหม่จะ Unlock และเขียนทับตัวเลขที่ lock ไว้ทั้งหมด ไม่สามารถย้อนกลับได้ ต้องการดำเนินการต่อหรือไม่?`;
    if (!confirm(_confirmMsg)) {
      if (typeof showToast === 'function') showToast('ยกเลิก — ข้อมูลที่ lock ไว้ไม่ถูกแตะต้อง', '!');
      console.warn(`[CommDraft] user declined overwrite of ${_lockedRows.length} locked rows for ${period}`);
      return false;
    }
    _overwroteLock = true;
    console.warn(`[CommDraft] user confirmed overwrite of ${_lockedRows.length} locked rows for ${period}`);
  }
  // v826: thread periodOverride through — previously always computed live/current data
  // and just relabeled it, which is why retroactive Compute produced wrong numbers.
  const rows = _commBuildSnapshotRows(periodOverride);
  if (!rows.length) {
    if (typeof showToast === 'function') showToast('ไม่มีข้อมูลสำหรับ compute', '!');
    return false;
  }
  const actor = (currentUserProfile && currentUserProfile.email) || '';
  try {
    const payload = rows.map(r => ({
      ...r,
      period_month: period,
      snapshot_status: 'draft',
      // note: retroactive/manual tag stored inside breakdown jsonb —
      // commission_payout_snapshots has no top-level column for it (was causing 400 error)
      breakdown: {
        ...(r.breakdown || {}),
        lock_note: periodOverride ? 'retroactive' : 'manual',
        // v6-fix: audit trail for lock-overwrite events, so a review of breakdown jsonb
        // shows exactly when/who/what got unlocked-and-recomputed, not just a silent gap.
        ...(_overwroteLock ? { unlock_overwrite_at: new Date().toISOString(), unlock_overwrite_by: actor } : {})
      },
      updated_at: new Date().toISOString(),
      updated_by: actor,
      created_by: r.created_by || actor
    }));
    const { data, error } = await supa.from('commission_payout_snapshots')
      .upsert(payload, { onConflict: 'period_month,beneficiary_role,beneficiary_email' })
      .select('*');
    if (error) throw new Error(error.message);
    // Merge into _commissionSnapshots — keep rows for other periods intact
    const others = (_commissionSnapshots || []).filter(r => r.period_month !== period);
    _commissionSnapshots = [...others, ...(data || payload)];
    if (typeof showToast === 'function') showToast('Compute สำเร็จ — ตรวจก่อนกด Lock', 'ok');
    // fix: renderCommissionLockTab() targets #tgt-sheet-body (KAM/TL personal scorecard sheet),
    // NOT #commission-cockpit-body where the Cockpit's Lock/Retroactive section actually lives.
    // Re-render whichever surface is currently open so the just-saved draft becomes visible.
    const _cockpitOpen = document.getElementById('commission-cockpit-overlay')?.classList.contains('open');
    if (_cockpitOpen && typeof renderCommissionCockpit === 'function') renderCommissionCockpit();
    else if (typeof renderCommissionLockTab === 'function') renderCommissionLockTab();
    console.log(`[CommDraft] saved ${payload.length} draft rows for ${period}`);
    return true;
  } catch (e) {
    console.error('[CommDraft] failed:', e);
    if (typeof showToast === 'function') showToast('Compute ไม่สำเร็จ: ' + (e.message || ''), '!');
    return false;
  }
}
window.computeCommissionDraft = computeCommissionDraft;

// v288: lockCommissionSnapshot — เปลี่ยน draft → final (ไม่ recompute)
// ถ้ายังไม่มี draft → auto-compute ก่อน แล้ว lock ต่อ
async function lockCommissionSnapshot(periodOverride) {
  const period = periodOverride || _nrrExclusionCurrentPeriod();
  const pending = (_nrrExclusions || []).filter(r => r.status === 'submitted' || r.status === 'pending').length;
  if (pending > 0 && !confirm(`ยังมี exclusion pending ${pending} รายการ ต้องการ lock ต่อเลยหรือไม่?`)) return;
  const actor = (currentUserProfile && currentUserProfile.email) || '';

  // Use stored draft if available — otherwise compute now
  let draftRows = (_commissionSnapshots || []).filter(r =>
    r.period_month === period && r.snapshot_status === 'draft'
  );
  if (!draftRows.length) {
    if (typeof showToast === 'function') showToast('กำลัง compute ก่อน lock...', 'ok');
    const ok = await computeCommissionDraft(periodOverride);
    if (!ok) return;
    draftRows = (_commissionSnapshots || []).filter(r =>
      r.period_month === period && r.snapshot_status === 'draft'
    );
  }
  if (!draftRows.length) {
    if (typeof showToast === 'function') showToast('ไม่มีข้อมูลสำหรับ lock', '!');
    return;
  }

  try {
    const payload = draftRows.map(r => ({
      ...r,
      snapshot_status: 'final',
      locked_at: new Date().toISOString(),
      locked_by: actor,
      updated_at: new Date().toISOString(),
      updated_by: actor
    }));
    const { data, error } = await supa.from('commission_payout_snapshots')
      .upsert(payload, { onConflict: 'period_month,beneficiary_role,beneficiary_email' })
      .select('*');
    if (error) throw new Error(error.message);
    const others = (_commissionSnapshots || []).filter(r => r.period_month !== period);
    _commissionSnapshots = [...others, ...(data || payload)];
    if (typeof showToast === 'function') showToast('🔒 Lock commission สำเร็จ', 'ok');
    // fix: same #tgt-sheet-body vs #commission-cockpit-body mismatch as computeCommissionDraft above.
    const _cockpitOpenLock = document.getElementById('commission-cockpit-overlay')?.classList.contains('open');
    if (_cockpitOpenLock && typeof renderCommissionCockpit === 'function') renderCommissionCockpit();
    else if (typeof renderCommissionLockTab === 'function') renderCommissionLockTab();
    console.log(`[CommLock] locked ${payload.length} rows for ${period}`);
  } catch (e) {
    console.error('[CommLock] failed:', e);
    if (typeof showToast === 'function') showToast('Lock ไม่สำเร็จ: ' + (e.message || ''), '!');
  }
}

// ── v247e: End-of-month lock status ────────────────────────────────────────
function _commEomStatus() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const today = now.getDate();
  const daysLeft = lastDay - today;
  const period = _nrrExclusionCurrentPeriod();
  const hasLock = (_commissionSnapshots || []).some(r =>
    r.period_month === period && String(r.snapshot_status||'').toLowerCase() === 'final'
  );
  const isGrace = today <= 3;
  const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevPeriod = `${prevD.getFullYear()}-${String(prevD.getMonth()+1).padStart(2,'0')}`;
  const prevHasLock = (_commissionSnapshots || []).some(r =>
    r.period_month === prevPeriod && String(r.snapshot_status||'').toLowerCase() === 'final'
  );
  return { daysLeft, period, hasLock, showEomBanner: daysLeft <= 3 && !hasLock,
           isGrace, prevPeriod, prevHasLock, showGraceBanner: isGrace && !prevHasLock };
}
window._commEomStatus = _commEomStatus;

// ── v247e: Commission History ────────────────────────────────────────────────
let _commHistoryCache = {};
const _HIST_TTL = 10 * 60 * 1000;

async function _commLoadHistory(lookbackMonths) {
  lookbackMonths = lookbackMonths || 6;
  const now = new Date();
  const periods = [];
  for (let i = 1; i <= lookbackMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  // Return cached result if all periods are fresh (within TTL)
  const allCached = periods.every(p => _commHistoryCache[p] && (Date.now() - _commHistoryCache[p].ts) < _HIST_TTL);
  if (allCached) {
    return periods.flatMap(p => _commHistoryCache[p].rows);
  }
  try {
    const { data, error } = await supa
      .from('commission_payout_snapshots')
      .select('period_month,beneficiary_role,beneficiary_email,team_lead_email,payout_amount,snapshot_status,governed_nrr_pct,updated_at,breakdown')
      .in('period_month', periods)
      .order('period_month', { ascending: false });
    if (error) throw new Error(error.message);
    periods.forEach(p => { _commHistoryCache[p] = { rows: (data||[]).filter(r=>r.period_month===p), ts: Date.now() }; });
    return data || [];
  } catch(e) {
    console.warn('[CommHistory] load failed:', e.message);
    return [];
  }
}
window._commLoadHistory = _commLoadHistory;


// ============================================================
// Folded from 08_patches.js — Step 2 dissolve
// ============================================================


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v212b-panel-target-ui-js
//////////////////////////////////////////////////////////////////////////////

// v212b — Data panel counter sync + target comma formatting + redundant badge cleanup.
// Scope: UI/freshness visibility only. No NRR, commission, owner, or movement formula changes.
(function(global){
  'use strict';
  var VERSION = 'v212b-pwa-freshness-ui-fix';
  var FOREGROUND_KEYS = ['portview','history','categories','sku_current','outlets','handover'];

  function countObj(o){ try{ return o && typeof o === 'object' ? Object.keys(o).length : 0; }catch(e){ return 0; } }
  function loadedTabs(){ try{ if(typeof _cloudLoadedTabs !== 'undefined' && _cloudLoadedTabs && typeof _cloudLoadedTabs.has === 'function') return _cloudLoadedTabs; }catch(e){} return null; }
  function hasTab(tab){ var t=loadedTabs(); return !!(t && t.has(tab)); }
  function dataLoaded(key){
    try{
      if(key === 'portview') return hasTab('portview') || (Array.isArray(global.portviewBulkData) && global.portviewBulkData.length > 0);
      if(key === 'history') return hasTab('history') || countObj(global.bulkHistoryData) > 0;
      if(key === 'categories') return hasTab('categories') || countObj(global.bulkCatsData) > 0 || countObj(global.bulkCategoriesData) > 0;
      if(key === 'sku_current') return hasTab('sku_current') || countObj(global.bulkSkuCurrentData) > 0;
      if(key === 'outlets') return hasTab('outlets') || countObj(global.bulkOutletsData) > 0;
      if(key === 'handover'){
        var h = global.bulkHandoverData || {};
        return hasTab('handover') || countObj(h.byAccountId) > 0 || countObj(h.byKamName) > 0;
      }
    }catch(e){}
    return false;
  }
  function keyToTab(key){ return key === 'sku_current' ? 'sku_current' : key; }
  function styleChip(key, ok){
    try{
      var id = 'sp-' + keyToTab(key);
      var el = document.getElementById(id);
      if(!el) return;
      el.style.background = ok ? 'var(--tk-ok-dim-2)' : 'rgba(0,0,0,.06)';
      el.style.color = ok ? 'var(--g700)' : 'var(--n500)';
      el.style.fontWeight = ok ? '800' : '600';
    }catch(e){}
  }
  function syncPanelCounter(){
    var loaded = 0;
    FOREGROUND_KEYS.forEach(function(k){ var ok = dataLoaded(k); if(ok) loaded++; styleChip(k, ok); });
    var counter = document.getElementById('sheets-loaded-count');
    if(counter){
      counter.style.display = 'inline-block';
      counter.textContent = loaded >= FOREGROUND_KEYS.length ? (loaded + '/' + FOREGROUND_KEYS.length) : (loaded >= 3 ? 'Core 3/3' : (loaded + '/' + FOREGROUND_KEYS.length));
      counter.title = loaded >= FOREGROUND_KEYS.length
        ? 'Foreground data loaded: portview, history, handover, categories, sku_current, outlets'
        : 'Core data is ready. Enhancement files may still load in background.';
      counter.style.background = loaded >= FOREGROUND_KEYS.length ? 'var(--tk-ok-dim-2)' : 'var(--tk-accent-dim)';
      counter.style.color = loaded >= FOREGROUND_KEYS.length ? 'var(--g700)' : 'var(--tk-accent-solid)';
    }
    return {loaded:loaded,total:FOREGROUND_KEYS.length,keys:FOREGROUND_KEYS.slice()};
  }

  function parseTargetNumber(v){
    try{
      if(typeof global._tgtParseInput === 'function') return global._tgtParseInput(String(v||''));
    }catch(e){}
    var s = String(v||'').replace(/,/g,'').replace(/฿/g,'').trim().toLowerCase();
    if(!s || s === '—') return 0;
    if(s.endsWith('m')) return Math.round((parseFloat(s)||0)*1000000);
    if(s.endsWith('k')) return Math.round((parseFloat(s)||0)*1000);
    return Math.round(parseFloat(s)||0);
  }
  function fmtComma(n){
    n = Number(n||0);
    if(!Number.isFinite(n) || n <= 0) return '';
    return Math.round(n).toLocaleString('en-US');
  }
  function formatTargetInput(el){
    if(!el || !el.classList || !el.classList.contains('tgt-month-input')) return;
    var v = parseTargetNumber(el.value);
    el.value = v > 0 ? fmtComma(v) : '';
    try{ el.classList.toggle('changed', v > 0); }catch(e){}
  }
  function formatAllTargetInputs(root){
    try{ (root||document).querySelectorAll('.tgt-month-input').forEach(formatTargetInput); }catch(e){}
  }

  // Override display helper so freshly rendered target sheets use comma format.
  try{
    global._tgtFmtInput = function(n){ return fmtComma(n); };
    try{ _tgtFmtInput = global._tgtFmtInput; }catch(e){}
  }catch(e){}

  // Wrap target render so existing raw-number targets become readable immediately.
  try{
    var oldRenderTargetSheetBody = global.renderTargetSheetBody;
    if(typeof oldRenderTargetSheetBody === 'function' && !oldRenderTargetSheetBody.__v212bWrapped){
      var wrappedRenderTargetSheetBody = function(){
        var r = oldRenderTargetSheetBody.apply(this, arguments);
        setTimeout(function(){ formatAllTargetInputs(document); }, 0);
        return r;
      };
      wrappedRenderTargetSheetBody.__v212bWrapped = true;
      global.renderTargetSheetBody = wrappedRenderTargetSheetBody;
      try{ renderTargetSheetBody = wrappedRenderTargetSheetBody; }catch(e){}
    }
  }catch(e){}

  // Format on blur, but don't fight the cursor on every keypress.
  document.addEventListener('blur', function(e){
    var el = e && e.target;
    if(el && el.classList && el.classList.contains('tgt-month-input')) formatTargetInput(el);
  }, true);
  document.addEventListener('focus', function(e){
    var el = e && e.target;
    if(el && el.classList && el.classList.contains('tgt-month-input')){
      try{ el.inputMode = 'decimal'; }catch(x){}
    }
  }, true);

  // Keep the panel counter honest after any load/status render, and after opening the panel.
  try{
    var oldUpdateDataStatus = global.updateDataStatus;
    if(typeof oldUpdateDataStatus === 'function' && !oldUpdateDataStatus.__v212bWrapped){
      var wrappedUpdateDataStatus = function(){
        var r = oldUpdateDataStatus.apply(this, arguments);
        setTimeout(syncPanelCounter, 0);
        return r;
      };
      wrappedUpdateDataStatus.__v212bWrapped = true;
      global.updateDataStatus = wrappedUpdateDataStatus;
      try{ updateDataStatus = wrappedUpdateDataStatus; }catch(e){}
    }
  }catch(e){}
  try{
    var oldOpenDataPanel = global.openDataPanel;
    if(typeof oldOpenDataPanel === 'function' && !oldOpenDataPanel.__v212bWrapped){
      var wrappedOpenDataPanel = function(){
        var r = oldOpenDataPanel.apply(this, arguments);
        setTimeout(syncPanelCounter, 80);
        setTimeout(syncPanelCounter, 800);
        return r;
      };
      wrappedOpenDataPanel.__v212bWrapped = true;
      global.openDataPanel = wrappedOpenDataPanel;
      try{ openDataPanel = wrappedOpenDataPanel; }catch(e){}
    }
  }catch(e){}

  // Also resync after foreground/enhancement loads, without forcing network.
  [1200, 3000, 6000, 12000].forEach(function(ms){ setTimeout(syncPanelCounter, ms); });

  var api = Object.freeze({
    version: VERSION,
    syncPanelCounter: syncPanelCounter,
    formatTargetInputs: function(){ formatAllTargetInputs(document); },
    parseTargetNumber: parseTargetNumber,
    formatComma: fmtComma
  });
  global.FreshketSenseV212b = api;
  try{
    var prevA = global.FreshketSenseV212a;
    if(prevA && typeof prevA === 'object'){
      // Do not mutate frozen v212a object; expose v212b separately.
    }
  }catch(e){}
})(window);


//////////////////////////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////////////////////////


// ============================================================
// Folded from 08_patches.js — Step 2 dissolve
// ============================================================