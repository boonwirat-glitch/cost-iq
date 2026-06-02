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
let _tgtActiveTab = 'team';
let _tgtActiveQuarter = null; // "2026-Q3"
let _tgtPendingEdits = {};    // { "2026-06|kam|ning@f.co": 3200000 }
let _tgtMode = null;          // "admin" | "tl"
let _nrrGovPolicies = {};     // { "2026-07|all|all": {...} }
let _nrrGovPending = {};      // { "2026-07|all|all": {...draft...} }
let _commRuleConfig = {};     // { plans:{}, rules:{}, tiers:{} }
let _commRulePending = {};    // editable payout rule draft by plan code
let _nrrExclusions = [];       // loaded/requested NRR exclusions
let _nrrExclusionDraft = null;
let _nrrExclusionView = 'pending';
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

// ── Upsell SKU Engine ───────────────────────────────────────────
// Returns { p1, p3, total_comm, total_gmv, tl_upsell_base }
// p1: { gmv, comm, groups:[{group_key,total_gmv,commission}] }
// p3: { gmv_incremental, comm, groups:[{group_key,existing_curr,max_baseline,...}] }
function _commComputeUpsellSku(kamEmail, expansionIds) {
  // v244: expansionIds = Set of outlet IDs classified as expansion (from bulkOutletsData)
  // expansion outlets earn 1.5% via _commComputeUpsellOutlet — excluded from P1/P3 here
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
    const baseLabel  = _commBaselineMonthLabel();
    console.log('%c[Sense Upsell] compute','color:#f0b000',
      {kamEmail, kamKey:_kamKey, currLabel, baseLabel, accounts:Object.keys(kamData).length});

    // Config (admin-configurable, with spec defaults)
    const p1Rate     = _commGetConfig('upsell_sku', 'p1_rate', 0.03);
    const p3Rate     = _commGetConfig('upsell_sku', 'p3_rate', 0.03);
    const p3Thresh   = _commGetConfig('upsell_sku', 'p3_threshold_pct', 2.00); // 150% = 50% growth
    const p3MinIncr  = _commGetConfig('upsell_sku', 'p3_min_incremental', 5000);
    const p1MinGmv   = _commGetConfig('upsell_sku', 'p1_min_gmv', 2500);       // ฿2,500 gate for P1

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
          const currRow = monthData[currLabel];
          if (!currRow) return;

          const rawTotalGmv = currRow.totalGmv || 0;
          const rawExistingGmv = currRow.existingGmv || 0;
          // v247d: rawNewGmv / rawComebackGmv removed — fields dropped from v4 CSV

          // v2 P1: outlet ไม่เคยซื้อ group_key นี้ใน 3 เดือนย้อนหลัง
          const isP1 = !outletBaseline.has(groupKey);

          if (isP1) {
            // P1: outlet × group_key ใหม่ — total GMV × 3%
            if (rawTotalGmv >= p1MinGmv) {
              const comm = rawTotalGmv * p1Rate;
              p1Groups.push({ accountId, outletId, groupKey, total_gmv: rawTotalGmv, commission: comm });
            }
          } else {
            // P3: คงเดิม — existing outlet ซื้อเพิ่มจาก max_baseline
            let maxBaseline = 0;
            let maxBaselineMonth = baseLabel;
            for (let i = 1; i <= 3; i++) {
              const lbl = _commMonthLabelOffset(i);
              const lRow = monthData[lbl];
              if (!lRow) continue;
              const d = _commDaysInLabel(lbl);
              const norm30 = d > 0 ? lRow.totalGmv / d * 30 : lRow.totalGmv;
              if (norm30 > maxBaseline) { maxBaseline = norm30; maxBaselineMonth = lbl; }
            }

            if (rawExistingGmv > maxBaseline * p3Thresh) {
              const incremental = rawExistingGmv - maxBaseline;
              if (incremental >= p3MinIncr) {
                const comm = incremental * p3Rate;
                p3Groups.push({ accountId, outletId, groupKey,
                  existing_curr: rawExistingGmv,
                  max_baseline: maxBaseline,
                  max_baseline_month: maxBaselineMonth,
                  incremental, commission: comm });
              }
            }
          }
        });
      });
    });

    const p1Gmv  = p1Groups.reduce((s,g) => s + g.total_gmv, 0);
    const p1Comm = p1Groups.reduce((s,g) => s + g.commission, 0);
    const p3Incr = p3Groups.reduce((s,g) => s + g.incremental, 0);
    const p3Comm = p3Groups.reduce((s,g) => s + g.commission, 0);
    console.log('%c[Sense Upsell] ✓ result','color:'+((p1Comm+p3Comm)>0?'#4ddc97':'#aaa')+';font-weight:bold',
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

// ── Upsell Outlet Engine ────────────────────────────────────────
// Returns { outlet_gmv, commission, new_gmv, comeback_gmv }
// Counts non-P1 items at new/comeback outlets only (P1 items excluded — they get 3% via P1)
function _commComputeUpsellOutlet(kamEmail) {
  // v244: rewritten to use bulkOutletsData via _tgtComputeKamNRR (portview logic)
  // Expansion = outlet never seen in any historical data (consistent with portview Expansion tab)
  // Comeback excluded — irregular buying patterns shouldn't earn outlet commission
  const EMPTY = { outlet_gmv:0, commission:0, expansion_gmv:0, expansion_outlets:[], _expansionIds: new Set() };
  try {
    if (typeof _tgtComputeKamNRR !== 'function') return EMPTY;
    const rate = _commGetConfig('upsell_outlet', 'rate', 0.015);
    const nrrResult = _tgtComputeKamNRR(kamEmail, null);
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

// ── Handover Retention Engine ───────────────────────────────────
// Uses bulkHandoverData.byNewKamName — accounts that transferred TO this KAM
// Returns { accounts, baseline_gmv, current_gmv, retention_pct, tier, payout, detail[] }
function _commComputeHandoverRetention(kamEmail) {
  // V3 Tactic B:
  // - Source: bulkHandoverData.byNewKamName (Q10 V3) แทน portviewBulkData isNew detection
  // - Filter: prevOwner === 'SALE' เท่านั้น (PM/ADMIN/KAM ไม่นับ)
  // - Baseline: baseline_gmv (GMV เต็มเดือนที่โอน) normalize ÷ baselineDays × 30
  // - Current: perf_gmv (GMV เดือน M+1) normalize ÷ perfDays × 30
  // - Window: transfer_month = เดือนก่อน (M-1) เท่านั้น
  const EMPTY = { accounts:0, baseline_gmv:0, current_gmv:0, retention_pct:0,
                  tier:0, payout:0, detail:[] };
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

    const t2Pct   = _commGetConfig('handover', 'tier2_pct',    100);
    const t3Pct   = _commGetConfig('handover', 'tier3_pct',    120);
    const t2Pay   = _commGetConfig('handover', 'tier2_payout', 2500);
    const t3Bonus = _commGetConfig('handover', 'tier3_bonus',  2500);

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
        perf_raw:       r.perfGmv || 0
      });
    });

    const retentionPct = baselineNorm > 0 ? (perfNorm / baselineNorm * 100) : 0;

    let tier = 1, payout = 0;
    if (retentionPct >= t3Pct)      { tier = 3; payout = t2Pay + t3Bonus; }
    else if (retentionPct >= t2Pct) { tier = 2; payout = t2Pay; }

    console.log('%c[Sense Handover] retention','color:'+(tier>=2?'#4ddc97':'#aaa')+';font-weight:bold',
      {kamEmail, accounts:handoverRows.length,
       baseline_gmv:Math.round(baselineNorm), current_gmv:Math.round(perfNorm),
       retention_pct:Math.round(retentionPct*10)/10+'%',
       tier, payout,
       detail:detail.map(d=>d.name+'  base='+d.baseline+'  curr='+d.current)});
    return {
      accounts:       handoverRows.length,
      baseline_gmv:   Math.round(baselineNorm),
      current_gmv:    Math.round(perfNorm),
      retention_pct:  Math.round(retentionPct * 10) / 10,
      tier, payout, detail
    };
  } catch(e) {
    console.warn('[CommEngine] _commComputeHandoverRetention error', e);
    return EMPTY;
  }
}

// ── GMV Gate Engine ─────────────────────────────────────────────
// Returns { ach_pct, cap_multiplier, gate_active }
// KAM-only: TL does not have GMV Gate
function _commComputeGmvGate(kamEmail, nrrPct) {
  // Gate based on NRR% — same metric already computed in _commBuildKamPayout
  // nrrPct passed in directly (no need to recompute GMV separately)
  try {
    const t1 = _commGetConfig('gmv_gate', 'threshold_1', 95); // NRR% threshold
    const t2 = _commGetConfig('gmv_gate', 'threshold_2', 90);
    const c1 = _commGetConfig('gmv_gate', 'cap_1', 0.70);
    const c2 = _commGetConfig('gmv_gate', 'cap_2', 0.35);

    if (nrrPct === null || nrrPct === undefined) {
      return { ach_pct: null, cap_multiplier: 1.0, gate_active: false };
    }

    let cap = 1.0;
    if (nrrPct < t2)      cap = c2;
    else if (nrrPct < t1) cap = c1;

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
function _commComputeTeamUpsellMult(tlEmail) {
  const EMPTY = { team_upsell_gmv:0, team_baseline_gmv:0, team_upsell_pct:0, multiplier:1.0, tier:1 };
  try {
    const kamEmails = Array.from(new Set(
      (portviewBulkData || [])
        .filter(r => r.tlEmail === tlEmail && r.kamEmail)
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
        const upsell = _commComputeUpsellSku(ke);
        teamUpsellGmv += upsell.tl_upsell_base;
      }
      const raw = _tgtComputeKamNRR(ke, null);
      teamBaselineGmv += raw ? (raw.baselinePrevGmv || 0) : 0;
    });

    const upsellPct = teamBaselineGmv > 0 ? (teamUpsellGmv / teamBaselineGmv * 100) : 0;

    // Tier lookup from commission_rules tl_upsell_mult tiers
    // Default tiers per spec: <2%=1.0x, 2-2.9%=1.2x, 3-3.9%=1.35x, 4-4.9%=1.5x, ≥5%=1.8x
    let multiplier = 1.0, tier = 1;
    try {
      const rules = (_commRuleConfig && _commRuleConfig.rules && _commRuleConfig.rules['tl_upsell_mult']) || [];
      const tiers = (rules[0] && rules[0].tiers) ? rules[0].tiers : [
        { min_pct:0, max_pct:1.99, multiplier:1.00 },
        { min_pct:2, max_pct:2.99, multiplier:1.20 },
        { min_pct:3, max_pct:3.99, multiplier:1.35 },
        { min_pct:4, max_pct:4.99, multiplier:1.50 },
        { min_pct:5, max_pct:null, multiplier:1.80 }
      ];
      tiers.sort((a,b) => Number(a.min_pct||0) - Number(b.min_pct||0));
      for (let i = tiers.length - 1; i >= 0; i--) {
        if (upsellPct >= Number(tiers[i].min_pct || 0)) {
          multiplier = Number(tiers[i].multiplier || 1.0);
          tier = i + 1;
          break;
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
function _commBuildKamPayout(kamEmail) {
  try {
    const period = _nrrExclusionCurrentPeriod();
    const raw = _tgtComputeKamNRR(kamEmail, null);
    const rawPct = raw && raw.nrr !== null ? Math.round(raw.nrr * 100) : null;
    const governedPct = _nrrGovernedPct(raw, kamEmail, null);
    const pct = governedPct !== null ? governedPct : rawPct;
    const planCode = _commGetAssignmentPlan(period, 'kam', kamEmail, 'kam');
    const nrrPayout = _commPayoutForPctByCode(planCode, 'kam', pct);

    // Upsell: try full bundle first, fall back to pre-computed team summary
    // Team summary (bulkUpsellTeamData) is loaded as FOREGROUND — always available
    let upsellSku, upsellOutlet;
    const _bundleLoaded = typeof bulkUpsellData !== 'undefined' && bulkUpsellData && bulkUpsellData.loaded;
    // Q3C Team SQL keys by ka_owner (display name), not email — try both
    const _pvRow = (portviewBulkData || []).find(r => r.kamEmail === kamEmail);
    const _kamDisplayName = _pvRow ? (_pvRow.kamName || '') : '';
    const _teamRow = typeof bulkUpsellTeamData !== 'undefined' && bulkUpsellTeamData &&
      (bulkUpsellTeamData[kamEmail] || bulkUpsellTeamData[_kamDisplayName] || null);
    const upsellLoading = !_bundleLoaded && !_teamRow; // v228-fix: flag when upsell data unavailable
    if (!_bundleLoaded && _teamRow) {
      // Fast path: use pre-computed totals from team summary (sense_upsell_team.csv)
      // v230fix2: return full p1/p3 sub-objects matching _commComputeUpsellSku structure
      // so _commBuildSnapshotRows can safely access .p1.gmv / .p3.gmv_incremental
      const p1Rate  = _commGetConfig('upsell_sku',   'p1_rate', 0.03);
      const p3Rate  = _commGetConfig('upsell_sku',   'p3_rate', 0.03);
      const outRate = _commGetConfig('upsell_outlet', 'rate',   0.015);
      const p1Comm  = _teamRow.p1_gmv   * p1Rate;
      const p3Comm  = _teamRow.p3_incr  * p3Rate;
      const outComm = _teamRow.outlet_gmv * outRate;
      upsellSku = {
        p1: { gmv: _teamRow.p1_gmv,  comm: p1Comm, groups: [] },
        p3: { gmv_incremental: _teamRow.p3_incr, comm: p3Comm, groups: [] },
        total_comm: p1Comm + p3Comm,
        p1_comm: p1Comm, p3_comm: p3Comm,
        p1_groups: [], p3_groups: [],
        total_gmv_eligible: _teamRow.p1_gmv + _teamRow.p3_incr,
        tl_upsell_base: _teamRow.tl_upsell_base || 0
      };
      upsellOutlet = { commission: outComm, outlet_gmv: _teamRow.outlet_gmv };
    } else {
      upsellOutlet = _commComputeUpsellOutlet(kamEmail);
      upsellSku    = _commComputeUpsellSku(kamEmail, upsellOutlet._expansionIds);
    }
    const handover      = _commComputeHandoverRetention(kamEmail);
    const gate          = _commComputeGmvGate(kamEmail, pct); // pct = NRR% already computed

    const subtotal = nrrPayout + upsellSku.total_comm + upsellOutlet.commission + handover.payout;
    const finalPayout = Math.round(subtotal * gate.cap_multiplier);
    console.log('%c[Sense Comm] ✓ KAM payout','color:#b794f4;font-weight:bold',
      {kamEmail, nrr_pct:pct!==null?pct+'%':'null',
       nrr_payout:Math.round(nrrPayout||0),
       p1_comm:Math.round(upsellSku&&upsellSku.p1&&upsellSku.p1.comm||0),
       p3_comm:Math.round(upsellSku&&upsellSku.p3&&upsellSku.p3.comm||0),
       handover_payout:Math.round(handover&&handover.payout||0),
       subtotal:Math.round(subtotal||0),
       gate_cap:gate&&gate.cap_multiplier||1,
       FINAL:finalPayout});

    return {
      period, kamEmail,
      nrr_pct: pct,
      nrr_payout: nrrPayout,
      upsell_sku: upsellSku,
      upsell_outlet: upsellOutlet,
      handover,
      gate,
      subtotal,
      gate_cap: gate.cap_multiplier,
      upsell_loading: upsellLoading, // v228-fix: true when upsell CSV not loaded in session
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
function _commBuildTlPayout(tlEmail) {
  try {
    const period = _nrrExclusionCurrentPeriod();
    const raw = _tgtComputeKamNRR(null, tlEmail);
    const rawPct = raw && raw.nrr !== null ? Math.round(raw.nrr * 100) : null;
    const governedPct = _nrrGovernedPct(raw, null, tlEmail);
    const pct = governedPct !== null ? governedPct : rawPct;
    const planCode = _commGetAssignmentPlan(period, 'tl', tlEmail, 'tl');
    const nrrPayout = _commPayoutForPctByCode(planCode, 'tl', pct);

    const upsellMult = _commComputeTeamUpsellMult(tlEmail);
    const finalPayout = Math.round(nrrPayout * upsellMult.multiplier);

    console.log('%c[Sense Comm] ✓ TL payout','color:#b794f4;font-weight:bold',
      {tlEmail, nrr_pct:pct!==null?pct+'%':'null',
       nrr_payout:Math.round(nrrPayout||0),
       upsell_mult:upsellMult.multiplier+'x (tier '+upsellMult.tier+')',
       team_upsell_pct:(upsellMult.team_upsell_pct||0).toFixed(1)+'%',
       FINAL:finalPayout});
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
    _commRuleConfig = JSON.parse(JSON.stringify(hit.commRules || {plans:{},rules:{},tiers:{}}));
    _nrrExclusions = JSON.parse(JSON.stringify(hit.nrrExclusions || []));
    _commissionSnapshots = JSON.parse(JSON.stringify(hit.commissionSnapshots || []));
    _tgtLoaded = true;
    return;
  }

  _tgtCache = {};
  _tgtSettings = { nrr_threshold: 98 };
  _nrrGovPolicies = {};
  _commRuleConfig = { plans:{}, rules:{}, tiers:{} };
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
    const { data: sets, error: setsErr } = await supa.from('target_settings')
      .select('key,value')
      .eq('key', 'nrr_threshold')
      .single();
    if (setsErr && setsErr.code !== 'PGRST116') throw new Error(setsErr.message);
    if (sets) _tgtSettings.nrr_threshold = parseFloat(sets.value) || 98;
  } catch (e) {
    console.warn('[Target] settings load failed:', e.message);
  }

  try {
    const { data: policies, error: polErr } = await supa.from('nrr_policies')
      .select('period_month,scope_type,scope_key,base_mode,base_month,status,updated_by,updated_at')
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
      .select('id,period_month,account_id,outlet_id,applies_to,target_kam_email,target_tl_email,reason_code,reason_text,status,requested_by,requested_at,reviewed_by,reviewed_at,review_note,base_gmv,estimated_base_gmv')
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
    // v210c: load the full Rule Library, not only the two standard plans.
    let { data: plans, error: planErr } = await supa.from('commission_plans')
      .select('id,plan_code,plan_name,beneficiary_role,status')
      .in('beneficiary_role', ['tl','kam'])
      .neq('status', 'inactive')
      .order('created_at', { ascending:true });
    if (planErr && /created_at/.test(planErr.message || '')) {
      const fb = await supa.from('commission_plans')
        .select('id,plan_code,plan_name,beneficiary_role,status')
        .in('beneficiary_role', ['tl','kam'])
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

    let ruleMap = {}, tierMap = {};
    if (planIds.length) {
      const { data: rules, error: ruleErr } = await supa.from('commission_rules')
        .select('id,plan_id,metric_code,measurement_scope,payout_type,stacking_mode,active')
        .in('plan_id', planIds)
        .eq('metric_code', 'nrr');
      if (ruleErr) throw new Error(ruleErr.message);
      const ruleIds = [];
      (rules || []).forEach(r => { ruleMap[r.plan_id] = r; ruleIds.push(r.id); });
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

    _commRuleConfig = { plans: planMap, rules: ruleMap, tiers: tierMap, assignments };
  } catch (e) {
    console.warn('[Commission rules] load failed (tables may not exist yet):', e.message);
    _commRuleConfig = { plans: {}, rules: {}, tiers: {}, assignments: [] };
  }

  _tgtQuarterCache[quarter] = {
    cache: { ..._tgtCache },
    settings: { ..._tgtSettings },
    nrrPolicies: { ..._nrrGovPolicies },
    commRules: JSON.parse(JSON.stringify(_commRuleConfig || {})),
    nrrExclusions: JSON.parse(JSON.stringify(_nrrExclusions || [])),
    commissionSnapshots: JSON.parse(JSON.stringify(_commissionSnapshots || [])),
    ts: Date.now()
  };
  _tgtLoaded = true;
  // v224e: persist to localStorage — next session reads this instantly (no Supabase cold-start flash)
  try{
    localStorage.setItem('sense_tgt_ls_'+quarter,JSON.stringify({ts:Date.now(),data:{
      cache:{..._tgtCache},settings:{..._tgtSettings},nrrPolicies:{..._nrrGovPolicies},
      commRules:JSON.parse(JSON.stringify(_commRuleConfig||{})),
      nrrExclusions:JSON.parse(JSON.stringify(_nrrExclusions||[])),
      commissionSnapshots:JSON.parse(JSON.stringify(_commissionSnapshots||[]))
    }}));
  }catch(e){}
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
  if (title) title.textContent = mode === 'admin' ? 'ตั้ง Target ทีม' : 'ตั้ง Target KAM';
  const tabRow = document.getElementById('tgt-tab-row');
  if (tabRow) tabRow.style.display = mode === 'admin' ? 'flex' : 'none';
  // v209: Target sheet is for target/settings only. Commission governance moved to Commission Cockpit.
  ['policy','rules','preview','exclusions','lock'].forEach(k=>{
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
    sub.style.cssText = 'font-size:11px;color:rgba(255,255,255,.35);margin-top:2px;display:flex;align-items:center;gap:5px;padding:0 16px 10px';
    sub.innerHTML = '<span class="ai-thinking"><svg width="9" height="9" viewBox="0 0 10 10" fill="rgba(0,208,112,.7)" style="animation:iq-spin 1.5s linear infinite;transform-origin:center;flex-shrink:0"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></span><span>กำลังดึงข้อมูล</span>';
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
    try{ if(typeof renderTeamviewSummary==='function') renderTeamviewSummary(); }catch(e){ console.warn('[target refresh] team summary', e); }
    try{ if(typeof renderTeamviewKamList==='function') renderTeamviewKamList(); }catch(e){ console.warn('[target refresh] team list', e); }
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
  if (body) body.innerHTML = '<div style="text-align:center;padding:32px;color:rgba(255,255,255,.4);font-size:13px">กำลังโหลด...</div>';
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
  if (_tgtActiveTab === 'exclusions') {
    renderNrrExclusionsTab();
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

  if (_tgtMode === 'admin') {
    html += _renderAdminTLBlocks(months, moLabels);
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
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(0,208,112,.7)" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
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
    html += `<div style="text-align:center;padding:24px;color:rgba(255,255,255,.35);font-size:13px">ไม่พบ KAM ในทีม<br><span style="font-size:11px">อัปโหลด portview.csv ก่อน</span></div>`;
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
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(0,208,112,.7)" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r=".5" fill="rgba(0,208,112,.7)"/></svg>
        NRR Warning Threshold
      </div>
      <div class="tgt-nrr-config-row">
        <div class="tgt-nrr-config-label">แสดงสัญญาณเตือนเมื่อ NRR ต่ำกว่า</div>
        <div style="display:flex;align-items:center;gap:4px">
          <input class="tgt-nrr-config-input" id="tgt-nrr-input" type="number" min="50" max="110" step="1"
            value="${threshold}"
            oninput="onTgtNrrInput(this.value)">
          <span style="font-size:12px;color:rgba(255,255,255,.45)">%</span>
        </div>
      </div>
      <div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:8px">
        ค่าเริ่มต้น: 98% · ใช้กับ signal ปัจจุบันของทุก KAM / TL
      </div>
    </div>
    <div style="font-size:11px;color:rgba(255,255,255,.3);padding:4px 2px">
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
  // QC-12: show TL multiplier tier in govCard meta
  let _tlMultText = '';
  try {
    if (isTLRole(role)) {
      const _govEm2 = (currentUserProfile && currentUserProfile.email) || '';
      const _um2 = typeof _commComputeTeamUpsellMult==='function' && (typeof bulkUpsellTeamData!=='undefined'&&bulkUpsellTeamData&&Object.keys(bulkUpsellTeamData).length>0)
        ? _commComputeTeamUpsellMult(_govEm2) : null;
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
      umData = _govEmail ? _commComputeTeamUpsellMult(_govEmail) : null;
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
        <div class="tv-signal-value ${nrrOk ? 'ok' : 'warn'}">${governedPct !== null ? governedPct + '%' : '—'}</div>
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
      ${(!ready && isAdmin) ? `<div class="tv-action-strip ${actionCls}">
        <div class="tv-action-text"><strong>${actionTitle}</strong><br>${actionMsg}</div>
        <button class="tv-action-btn commission-open" onclick="event.stopPropagation();openCommissionCockpit('exceptions')">Review now</button>
      </div>` : ''}
    </div>
  </div>`;
}

// SECTION:COMMISSION_CORE
function _commDefaultTiers(role) {
  if (isTLRole(role)) {
    return [
      {min_value:null, max_value:98.5, payout_value:0, payout_label:'Below threshold'},
      {min_value:98.5, max_value:99.0, payout_value:5000, payout_label:'Tier 2'},
      {min_value:99.0, max_value:100.0, payout_value:8000, payout_label:'Tier 3'},
      {min_value:100.0, max_value:102.0, payout_value:12000, payout_label:'Tier 4'},
      {min_value:102.0, max_value:103.0, payout_value:30000, payout_label:'Tier 5'},
      {min_value:103.0, max_value:null, payout_value:50000, payout_label:'Tier 6'}
    ];
  }
  return [
    {min_value:null, max_value:99.0, payout_value:0, payout_label:'Below threshold'},
    {min_value:99.0, max_value:102.0, payout_value:5000, payout_label:'Base NRR'},
    {min_value:102.0, max_value:null, payout_value:7500, payout_label:'Bonus NRR'}
  ];
}
function _commPlanCode(role) {
  return role === 'tl' ? 'TL_NRR_STD' : 'KAM_NRR_STD';
}
function _commPlanName(role) {
  return role === 'tl' ? 'TL NRR Standard' : 'KAM NRR Standard';
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
  const prefix = role === 'tl' ? 'TL_NRR_RULE' : 'KAM_NRR_RULE';
  const code = `${prefix}_${Date.now().toString().slice(-6)}`;
  const name = role === 'tl' ? 'New TL NRR Rule' : 'New KAM NRR Rule';
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
function _commFmtPayout(n) {
  n = Number(n || 0);
  if (!n) return '฿0';
  return '฿' + Math.round(n).toLocaleString('en-US');
}

function _commEscapeHtml(v) {
  return String(v ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}
function _commPendingCount() {
  return Object.keys(_commRulePending || {}).length + Object.keys(_commAssignmentPending || {}).length + Object.keys(_nrrGovPending || {}).length;
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
    if (!tiers.length) e.general = 'ต้องมีอย่างน้อย 1 tier';
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
    period_month: p.period_month,
    scope_type: p.scope_type || 'all',
    scope_key: p.scope_key || 'all',
    base_mode: p.base_mode || 'rolling_mom',
    base_month: p.base_mode === 'fixed_month' ? (p.base_month || _nrrGovPrevMonth(p.period_month)) : _nrrGovPrevMonth(p.period_month),
    status: p.status || 'draft',
    updated_by: actor,
    updated_at: new Date().toISOString()
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
function _nrrExclusionApprovedForScope(kamEmail, tlEmail) {
  return (_nrrExclusions || []).filter(x =>
    x.status === 'approved' &&
    (!x.target_kam_email || !kamEmail || x.target_kam_email === kamEmail) &&
    (!x.target_tl_email || !tlEmail || x.target_tl_email === tlEmail)
  );
}
function _nrrExclusionBaseImpact(kamEmail, tlEmail) {
  const approved = _nrrExclusionApprovedForScope(kamEmail, tlEmail);
  return approved.reduce((s,x)=>s + Number(x.base_gmv || x.estimated_base_gmv || 0), 0);
}
function _nrrGovernedPct(rawResult, kamEmail, tlEmail) {
  if (!rawResult || rawResult.nrr === null) return null;
  const base = Number(rawResult.baselinePrevGmv || 0);
  const curr = Number(rawResult.cohortGmv || 0);
  const excludedBase = Math.min(base, _nrrExclusionBaseImpact(kamEmail, tlEmail));
  if (base <= 0 || excludedBase <= 0) return Math.round(rawResult.nrr * 100);
  // v247d: normalize by daily rate (same as raw NRR) — prevents mid-month deflation when exclusion is approved
  const prevDays = Number(rawResult.prevDays || 30);
  const daysElapsed = Number(rawResult.daysElapsed || 30);
  const eligibleBase = Math.max(1, base - excludedBase);
  const currRate = daysElapsed > 0 ? curr / daysElapsed : 0;
  const baseRate = prevDays > 0 ? eligibleBase / prevDays : 0;
  return baseRate > 0 ? Math.round(currRate / baseRate * 100) : Math.round(rawResult.nrr * 100);
}
function _nrrGovernanceForVisibleTeam() {
  const scope = _commVisibleTeamScope();
  const raw = _tgtGetVisibleTeamNrrResult();
  const rawPct = raw && raw.nrr !== null ? Math.round(raw.nrr * 100) : null;
  const governedPct = _nrrGovernedPct(raw, null, scope.tlEmail);
  const exclBase = _nrrExclusionBaseImpact(null, scope.tlEmail);
  return { raw, rawPct, governedPct, excludedBase: exclBase };
}
function _nrrGovernanceForKam(kamEmail) {
  const raw = _tgtComputeKamNRR(kamEmail, null);
  const rawPct = raw && raw.nrr !== null ? Math.round(raw.nrr * 100) : null;
  const governedPct = _nrrGovernedPct(raw, kamEmail, null);
  const exclBase = _nrrExclusionBaseImpact(kamEmail, null);
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
function _commBuildSnapshotRows() {
  const period = _nrrExclusionCurrentPeriod();
  const actor = (currentUserProfile && currentUserProfile.email) || '';
  const role = (currentUserProfile && currentUserProfile.role) || '';
  const rows = [];
  const allGroups = (typeof _buildKamGroups === 'function') ? (_buildKamGroups() || []) : [];
  const visibleTlEmail = role === 'admin'
    ? null
    : ((currentUserProfile && currentUserProfile.email) || '');
  const tls = role === 'admin' ? _commGetTlListFromPortview() : [{ email: visibleTlEmail, name: (currentUserProfile && currentUserProfile.full_name) || visibleTlEmail }];

  tls.filter(t => t.email).forEach(tl => {
    const tlPayout = _commBuildTlPayout(tl.email);
    rows.push({
      period_month: period,
      beneficiary_role: 'tl',
      beneficiary_email: tl.email,
      team_lead_email: tl.email,
      raw_nrr_pct: tlPayout.nrr_pct,
      governed_nrr_pct: tlPayout.nrr_pct,
      payout_amount: tlPayout.final_payout,
      snapshot_status: 'final',
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
        excluded_base_gmv: _nrrExclusionBaseImpact(null, tl.email)
      },
      created_by: actor,
      updated_by: actor
    });
  });

  const groups = role === 'admin' ? allGroups : allGroups.filter(g => (g.accounts || []).some(a => a.tlEmail === visibleTlEmail));
  groups.forEach(g => {
    if (!g.kamEmail) return;
    const tlEmail = (g.accounts && g.accounts[0] && g.accounts[0].tlEmail) || null;
    const kamPayout = _commBuildKamPayout(g.kamEmail);
    rows.push({
      period_month: period,
      beneficiary_role: 'kam',
      beneficiary_email: g.kamEmail,
      team_lead_email: tlEmail,
      raw_nrr_pct: kamPayout.nrr_pct,
      governed_nrr_pct: kamPayout.nrr_pct,
      payout_amount: kamPayout.final_payout,
      snapshot_status: 'final',
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
                    detail: kamPayout.handover.detail },
        components_subtotal: kamPayout.subtotal,
        gmv_gate: kamPayout.gate,
        final_payout: kamPayout.final_payout,
        excluded_base_gmv: _nrrExclusionBaseImpact(g.kamEmail, null),
        account_count: g.total || ((g.accounts || []).length),
        // v247e: NRR detail for reconcile — cohort + expansion outlet breakdown
        nrr_cohort_detail: (() => { try { const _r=_tgtComputeKamNRR(g.kamEmail,null); return _r&&_r.cohortDetail?_r.cohortDetail.map(a=>({acctId:a.acctId,acctName:a.acctName,outlets:(a.outlets||[]).map(o=>({outletId:o.outletId,outletName:o.outletName,prevGmv:Math.round(o.prevGmv||0),currGmv:Math.round(o.currGmv||0)}))})):[] } catch(e){return []} })(),
        expansion_detail: (() => { try { const _r=_tgtComputeKamNRR(g.kamEmail,null); const _ex=[]; const _add=d=>{(d&&d.expansionDetail||[]).forEach(a=>{(a.outlets||[]).forEach(o=>{_ex.push({outletId:o.outletId,outletName:o.outletName,gmv:Math.round(o.currGmv||0)});})})}; if(_r){_add(_r);_add(_r.transferIn);_add(_r.newFromSales);} return _ex; } catch(e){return []} })(),
        lock_trigger: 'manual',
        csv_data_as_of: new Date().toISOString(),
        // Config snapshot — freeze param values at time of snapshot for audit
        config_snapshot: {
          upsell_sku_p1_rate:           _commGetConfig('upsell_sku','p1_rate',0.03),
          upsell_sku_p3_rate:           _commGetConfig('upsell_sku','p3_rate',0.03),
          upsell_sku_p3_threshold_pct:  _commGetConfig('upsell_sku','p3_threshold_pct',2.00),
          upsell_sku_p3_min_incremental:_commGetConfig('upsell_sku','p3_min_incremental',5000),
          upsell_sku_p1_min_gmv:        _commGetConfig('upsell_sku','p1_min_gmv',2500),
          upsell_outlet_rate:           _commGetConfig('upsell_outlet','rate',0.015),
          gmv_gate_threshold_1:         _commGetConfig('gmv_gate','threshold_1',95),
          gmv_gate_threshold_2:         _commGetConfig('gmv_gate','threshold_2',90),
          gmv_gate_cap_1:               _commGetConfig('gmv_gate','cap_1',0.70),
          gmv_gate_cap_2:               _commGetConfig('gmv_gate','cap_2',0.35)
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
  const email = (currentUserProfile && currentUserProfile.email) || '';
  if (isTLRole(role) || isAdminRole(role) || !email || portviewLevel === 'rep-detail') return null;
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
  const pctText = st.pct !== null ? `${st.pct}%` : '—';
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
  const pctText = st.pct !== null ? `${st.pct}%` : '—';
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
      <div class="pv-comm-sheet-sub"><strong style="color:#fff">Rule:</strong> ${_commEscapeHtml(st.ruleName)}</div>
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
  if (!isTLRole(role) && !isAdminRole(role)) return;
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
    _loadOv.innerHTML = '<div class="pv-comm-sheet"><div class="pv-comm-sheet-handle"></div><div class="pv-comm-sheet-body" style="display:flex;align-items:center;justify-content:center;min-height:160px"><div style="text-align:center;color:rgba(188,215,255,.7);font-size:13px">กำลังโหลดข้อมูล upsell...<br><span style="font-size:11px;opacity:.6">ใช้เวลาไม่กี่วินาที</span></div></div></div>';
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
  const um = typeof _commComputeTeamUpsellMult === 'function' ? _commComputeTeamUpsellMult(tlEmail) : {multiplier:1.0,tier:1,team_upsell_pct:0};
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
    const nrr  = r.governed_nrr_pct !== null && r.governed_nrr_pct !== undefined ? r.governed_nrr_pct+'%' : '—';
    const detailParts = ['NRR '+fmtP(nrrP)];
    if (upsell > 0) detailParts.push('Uplift '+fmtP(upsell));
    if (ho > 0)     detailParts.push('HO '+fmtP(ho));
    // v228-fix: show — when upsell not loaded and NRR payout is 0
    const upsellNotLoaded = r.breakdown && r.breakdown.upsell_loading;
    const displayAmt = (upsellNotLoaded && nrrP === 0) ? null : finalAmt;
    const amberStyle = (displayAmt !== null && displayAmt > 0) ? 'color:#ffe08a;font-weight:700' : 'color:rgba(255,255,255,.4)';
    const payText = displayAmt === null ? '<span style="color:rgba(255,255,255,.3);font-size:11px">— โหลด...</span>' : fmtP(displayAmt);
    return `<div class="pv-comm-tl-kam-row">
      <div class="pv-comm-tl-kam-name">${_commEscapeHtml(name)}</div>
      <div class="pv-comm-tl-kam-nrr">${nrr}</div>
      <div class="pv-comm-tl-kam-pay" style="${amberStyle}">${payText}</div>
      <div class="pv-comm-tl-kam-detail">${detailParts.join(' · ')}</div>
    </div>`;
  }).join('');

  const multSection = multLoaded
    ? `<div class="pv-comm-tl-mult">
        <span style="color:#ffe08a;font-weight:700">×${um.multiplier.toFixed(2)} Upsell Mult</span>
        <span style="color:rgba(255,255,255,.6);font-size:11px">${um.team_upsell_pct.toFixed(1)}% upsell · T${um.tier}</span>
       </div>`
    : `<div class="pv-comm-tl-mult" style="color:rgba(255,255,255,.4)">Upsell Mult — กำลังโหลด...</div>`;

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
      <div class="pv-comm-sheet-sub">NRR ทีม ${tlPayout.nrr_pct!==null?tlPayout.nrr_pct+'%':'—'} · NRR payout ${fmtP(tlPayout.nrr_payout)}</div>
      ${multSection}
      ${(()=>{try{var _e=typeof _commEomStatus==='function'?_commEomStatus():null;if(_e&&(_e.showEomBanner||_e.showGraceBanner)){var _d=_e.showGraceBanner?_e.prevPeriod:_e.period;var _mo=_d.split('-');var _thmo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(_mo[1])-1];var _lbl=_thmo+' '+( parseInt(_mo[0])+543);var _bg=_e.showGraceBanner||_e.daysLeft<=1?'rgba(240,80,0,.12)':'rgba(240,160,0,.08)';var _bc=_e.showGraceBanner||_e.daysLeft<=1?'rgba(240,80,0,.35)':'rgba(240,160,0,.25)';var _txt=_e.showGraceBanner?'ยัง lock ค่าคอมฯ '+_lbl+' ไม่ได้':'เหลือ '+_e.daysLeft+' วัน — Lock ค่าคอมฯ '+_lbl+' ก่อนสิ้นเดือน';return '<div style="margin:8px 18px;padding:10px 12px;border-radius:10px;background:'+_bg+';border:1px solid '+_bc+';display:flex;align-items:center;justify-content:space-between;gap:8px"><div style="font-size:11px;color:rgba(225,238,255,.80);line-height:1.4">'+_txt+'</div><button onclick="event.stopPropagation();lockCommissionSnapshot()" style="flex-shrink:0;padding:6px 10px;border-radius:8px;background:rgba(255,224,138,.15);border:1px solid rgba(255,224,138,.3);color:#ffe08a;font-size:11px;font-weight:700;cursor:pointer;font-family:\'IBM Plex Sans Thai\',sans-serif">Lock ตอนนี้</button></div>';}return '';}catch(e){return '';}})()} 
      <div class="pv-comm-section-label" style="margin-top:4px">รายละเอียดต่อ KAM</div>
      <div class="pv-comm-tl-kam-header">
        <span>ชื่อ</span><span>NRR</span><span>ค่าคอมฯ</span>
      </div>
      <div class="pv-comm-tl-kam-list">${kamRows||'<div style="color:rgba(255,255,255,.4);font-size:12px;padding:8px">กำลังโหลด...</div>'}</div>
      <div style="display:flex;gap:6px;margin:0 18px 8px">
        <button onclick="typeof openCommissionHistory==='function'&&(_commCloseTlDetailSheet(),setTimeout(openCommissionHistory,80))" style="flex:1;padding:10px;border-radius:10px;background:rgba(77,220,151,.10);border:1px solid rgba(77,220,151,.25);color:#4ddc97;font-size:12px;font-weight:700;cursor:pointer;font-family:'IBM Plex Sans Thai',sans-serif">History</button>
        <button onclick="typeof openCommissionRulebook==='function'&&(_commCloseTlDetailSheet(),setTimeout(openCommissionRulebook,80))" style="flex:1;padding:10px;border-radius:10px;background:rgba(188,215,255,.08);border:1px solid rgba(188,215,255,.22);color:rgba(225,238,255,.88);font-size:12px;font-weight:700;cursor:pointer;font-family:'IBM Plex Sans Thai',sans-serif">Rules</button>
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
    .tv-mult-badge{display:inline-flex;align-items:center;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;margin-left:4px;background:rgba(255,255,255,.1);color:rgba(255,255,255,.6);vertical-align:middle}
    .tv-mult-badge.ok{background:rgba(255,224,138,.15);color:#ffe08a}
    .tv-mult-badge.loading{color:rgba(255,255,255,.35)}
    .pv-comm-tl-mult{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,224,138,.07);border:1px solid rgba(255,224,138,.18);border-radius:8px;font-size:12px;font-weight:600;color:rgba(255,255,255,.85);margin:8px 0 0}
    .pv-comm-tl-kam-header{display:grid;grid-template-columns:1fr 44px 76px;gap:4px;padding:6px 0 4px;font-size:9px;font-weight:700;color:rgba(255,255,255,.38);text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid rgba(255,255,255,.07);margin-top:6px}
    .pv-comm-tl-kam-list{display:flex;flex-direction:column;max-height:320px;overflow-y:auto;margin-top:2px}
    .pv-comm-tl-kam-row{display:grid;grid-template-columns:1fr 44px 76px;grid-template-rows:auto auto;gap:1px 4px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);align-items:center}
    .pv-comm-tl-kam-row:last-child{border-bottom:none}
    .pv-comm-tl-kam-name{font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;grid-row:1;grid-column:1}
    .pv-comm-tl-kam-nrr{font-size:11px;color:rgba(255,255,255,.55);text-align:right;grid-row:1;grid-column:2}
    .pv-comm-tl-kam-pay{font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:700;text-align:right;grid-row:1;grid-column:3}
    .pv-comm-tl-kam-detail{grid-column:1/-1;grid-row:2;font-size:10px;color:rgba(255,255,255,.72);line-height:1.4}
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
function exportCommissionSnapshotCsv() {
  const rows = _commBuildSnapshotRows();
  if (!rows.length) {
    if (typeof showToast === 'function') showToast('ยังไม่มีข้อมูล snapshot ให้ export', '!');
    return;
  }
  const csv = _commSnapshotCsv(rows);
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `freshket_commission_snapshot_${_nrrExclusionCurrentPeriod()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
async function lockCommissionSnapshot() {
  const rows = _commBuildSnapshotRows();
  if (!rows.length) {
    if (typeof showToast === 'function') showToast('ไม่มีข้อมูลสำหรับ lock', '!');
    return;
  }
  const pending = (_nrrExclusions || []).filter(r => r.status === 'submitted' || r.status === 'pending').length;
  if (pending > 0 && !confirm(`ยังมี exclusion pending ${pending} รายการ ต้องการ lock ต่อเลยหรือไม่?`)) return;
  const actor = (currentUserProfile && currentUserProfile.email) || '';
  try {
    const payload = rows.map(r => ({
      ...r,
      breakdown: r.breakdown || {},
      updated_at: new Date().toISOString(),
      updated_by: actor,
      created_by: r.created_by || actor,
      locked_at: new Date().toISOString(),
      locked_by: actor
    }));
    const { data, error } = await supa.from('commission_payout_snapshots')
      .upsert(payload, { onConflict: 'period_month,beneficiary_role,beneficiary_email' })
      .select('*');
    if (error) throw new Error(error.message);
    _commissionSnapshots = data || payload;
    if (typeof showToast === 'function') showToast('Lock commission snapshot สำเร็จ', 'ok');
    renderCommissionLockTab();
  } catch (e) {
    console.error('[Commission lock] failed:', e);
    if (typeof showToast === 'function') showToast('Lock ไม่สำเร็จ: ' + (e.message || ''), '!');
  }
}
function _nrrExclusionStatusLabel(s) {
  return s === 'approved' ? 'Approved' : s === 'rejected' ? 'Rejected' : s === 'submitted' ? 'Pending' : (s || 'Draft');
}
function _nrrReasonLabel(code) {
  const m = {
    closed_business:'ร้านปิดกิจการ',
    bad_debt:'ติดหนี้ / credit hold',
    force_majeure:'Force majeure',
    fraud:'Fraud / data issue',
    other:'Other'
  };
  return m[code] || code || '—';
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
      el.style.background = ok ? 'rgba(0,208,112,.18)' : 'rgba(0,0,0,.06)';
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
      counter.style.background = loaded >= FOREGROUND_KEYS.length ? 'rgba(0,208,112,.16)' : 'rgba(38,96,200,.15)';
      counter.style.color = loaded >= FOREGROUND_KEYS.length ? 'var(--g700)' : 'rgba(38,96,200,.85)';
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


//////////////////////////////////////////////////////////////////////////////
// PATCH: freshket-v206e-bundle-micro-patch
//////////////////////////////////////////////////////////////////////////////

// v206e: TL/KAM account-level bundle micro-state.
// Goal: account page opens immediately; SKU/Sense sections clearly show loading/retry
// when a TL opens an account before that KAM bundle is ready. Avoid silent heavy bulk
// fallback for TL/Admin/PWA unless the user explicitly retries through app logic later.
(function(global){
  'use strict';
  if(global._v206eBundleMicroPatchInstalled) return;
  global._v206eBundleMicroPatchInstalled = true;

  const VERSION = 'v206e-bundle-demand-state';
  const TIMEOUT_MS = 30000;
  const state = {
    failures: {},          // safeKey -> {ts, message}
    loadingAccounts: {},   // accountId -> true
    lastPaintedAccountId: null,
    installedAt: Date.now(),
  };

  function debug(){
    try{return localStorage.getItem('senseDebug')==='1'||localStorage.getItem('freshket_debug')==='1';}
    catch(e){return false;}
  }
  function log(){try{if(debug())console.log.apply(console,arguments);}catch(e){}}
  function warn(){try{if(debug())console.warn.apply(console,arguments);}catch(e){}}
  function role(){try{return (currentUserProfile&&currentUserProfile.role)||'rep';}catch(e){return 'rep';}}
  function isStandalonePwa(){
    try{return (global.matchMedia&&global.matchMedia('(display-mode: standalone)').matches)||global.navigator.standalone===true;}
    catch(e){return false;}
  }
  function toast(msg,icon){try{if(typeof showToast==='function')showToast(msg,icon||'⟳');}catch(e){}}
  function aidOf(accountId){
    try{return String(accountId || currentAccountId || (D&&D.meta&&D.meta.accountId) || '');}
    catch(e){return String(accountId||'');}
  }
  function safeKey(email){
    try{if(typeof _kamSafeKey==='function')return _kamSafeKey(email);}
    catch(e){}
    return (email||'').toLowerCase().replace(/[^a-z0-9]/g,'_');
  }
  function getKamEmail(accountId){
    const aid = aidOf(accountId);
    if(!aid) return null;
    try{
      if(typeof _getKamEmailForAccount==='function'){
        const e = _getKamEmailForAccount(aid);
        if(e) return e;
      }
    }catch(e){}
    try{
      const row = (portviewBulkData||[]).find(r=>String(r.id)===String(aid));
      if(row && row.kamEmail) return row.kamEmail;
    }catch(e){}
    try{
      if(role()!=='tl'&&role()!=='admin'&&currentUser&&currentUser.email) return currentUser.email;
    }catch(e){}
    return null;
  }
  function accountHasSkuData(accountId){
    const aid = aidOf(accountId);
    if(!aid) return false;
    let hasSkus=false, hasAlts=false;
    try{hasSkus = !!(bulkSkusData && bulkSkusData[aid]);}catch(e){}
    try{hasAlts = !!(bulkAltsReady || (bulkAltsUnverified && bulkAltsUnverified[aid]));}catch(e){}
    return !!(hasSkus && hasAlts);
  }
  function getBundleState(accountId){
    const aid = aidOf(accountId);
    const kamEmail = getKamEmail(aid);
    const sk = safeKey(kamEmail||'');
    let loaded=false, inflight=false;
    try{loaded = !!(sk && _kamBundleLoaded && _kamBundleLoaded.has(sk));}catch(e){}
    try{inflight = !!(sk && _kamBundleInFlight && _kamBundleInFlight[sk]);}catch(e){}
    const ready = accountHasSkuData(aid);
    const loading = !!(state.loadingAccounts[aid] || inflight);
    const failed = !!(sk && state.failures[sk]);
    const status = ready ? 'ready' : loading ? 'loading' : failed ? 'failed' : 'pending';
    return { aid, kamEmail, safeKey:sk, ready, loaded, loading, failed, status, failure:sk?state.failures[sk]:null };
  }
  function cardHtml(st){
    const isFail = st.status === 'failed';
    const isPending = st.status === 'pending';
    const title = isFail ? 'โหลด SKU detail ไม่สำเร็จ' : isPending ? 'SKU intelligence ยังไม่พร้อม' : 'กำลังโหลด SKU intelligence...';
    const body = isFail
      ? 'เปิดหน้า account ได้ปกติ แต่ Sense / SKU Verify ต้องใช้ bundle ของ KAM นี้ก่อน ระบบยังไม่โหลด bulk ใหญ่เพื่อกัน PWA หน่วง'
      : isPending
        ? 'หน้า account เปิดได้ก่อน ส่วน SKU Signals / Sense / SKU Verify จะโหลดตาม demand เมื่อเริ่มใช้งาน'
        : 'เปิดหน้า account ได้ก่อน กำลังเติม SKU Signals / Sense / SKU Verify เฉพาะ KAM นี้อยู่เบื้องหลัง';
    const icon = isFail ? '⚠' : '⟳';
    const color = isFail ? 'rgba(240,176,0,.9)' : 'rgba(120,180,255,.95)';
    const border = isFail ? 'rgba(240,176,0,.28)' : 'rgba(100,170,255,.24)';
    const bg = isFail ? 'rgba(240,176,0,.07)' : 'rgba(38,96,200,.10)';
    const retry = isFail || isPending ? `<button type="button" onclick="window._v206eRetryCurrentBundle && window._v206eRetryCurrentBundle()" style="margin-top:9px;padding:7px 12px;border-radius:9px;border:1px solid ${border};background:rgba(255,255,255,.06);color:${color};font-family:'IBM Plex Sans Thai',sans-serif;font-size:11px;font-weight:700;cursor:pointer">${isFail?'Retry SKU intelligence':'โหลดตอนนี้'}</button>` : '';
    return `<div id="kam-bundle-state-card" class="kam-dc" style="margin-bottom:12px;border-color:${border};background:${bg}">
      <div class="kam-dc-head" style="border-bottom-color:rgba(255,255,255,.06)"><span class="kam-dc-head-label" style="color:${color}">${icon} ${title}</span></div>
      <div class="kam-dc-body" style="font-size:12px;color:rgba(220,235,255,.82);line-height:1.65">${body}${retry}</div>
    </div>`;
  }
  function updateDeepButtons(st){
    try{
      const ready = st && st.ready;
      ['sku-verify-tm-btn','sku-verify-lm-btn'].forEach(id=>{
        const b=document.getElementById(id);
        if(!b) return;
        if(ready){
          b.disabled=false;
          b.style.opacity='';
          b.title='';
          return;
        }
        b.disabled = st.status === 'loading';
        b.style.opacity = st.status === 'loading' ? '.62' : '.86';
        b.title = st.status === 'failed' ? 'Retry ผ่านการ์ด SKU intelligence ด้านบน' : 'กำลังโหลด SKU intelligence ของ KAM นี้';
        if(st.status === 'loading'){
          b.className='sku-verify-btn loading';
          b.innerHTML='<svg class="svb-icon" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg>โหลด SKU...';
        }
      });
    }catch(e){}
  }
  function paint(accountId){
    const aid = aidOf(accountId);
    if(!aid) return;
    const st = getBundleState(aid);
    state.lastPaintedAccountId = aid;
    const cards = document.getElementById('kam-cards');
    if(!cards) return;
    const old = document.getElementById('kam-bundle-state-card');
    if(st.ready){
      if(old) old.remove();
      updateDeepButtons(st);
      return;
    }
    const html = cardHtml(st);
    if(old) old.outerHTML = html;
    else cards.insertAdjacentHTML('afterbegin', html);
    updateDeepButtons(st);
  }
  async function fetchAccountBundle(accountId, opts){
    opts = opts || {};
    const aid = aidOf(accountId);
    if(!aid) return false;
    if(accountHasSkuData(aid)) { paint(aid); return true; }
    const st = getBundleState(aid);
    if(!st.kamEmail){
      warn('[v206e] no kamEmail for account bundle', aid);
      return false;
    }
    try{ delete state.failures[st.safeKey]; }catch(e){}
    state.loadingAccounts[aid] = true;
    paint(aid);
    let ok = false;
    try{
      const p = (typeof _kamBundleInFlight !== 'undefined' && _kamBundleInFlight[st.safeKey])
        ? _kamBundleInFlight[st.safeKey]
        : (typeof _fetchKamBundle === 'function' ? _fetchKamBundle(st.kamEmail) : Promise.resolve(false));
      ok = await Promise.race([p, new Promise(r=>setTimeout(()=>r(false), opts.timeoutMs || TIMEOUT_MS))]);
    }catch(e){
      ok = false;
      state.failures[st.safeKey] = { ts:Date.now(), message:e&&e.message?e.message:String(e) };
    }finally{
      delete state.loadingAccounts[aid];
    }
    if(ok){
      try{ delete state.failures[st.safeKey]; }catch(e){}
      try{
        if(String(currentAccountId||'')===String(aid)){
          if(typeof loadFromStorage==='function') loadFromStorage(aid);
          if(D&&D.alts&&D.alts.length&&D.skus&&D.skus.length&&typeof computeOPPS==='function') computeOPPS();
        }
      }catch(e){}
      paint(aid);
      if(String(currentAccountId||'')===String(aid) && opts.rerender!==false){
        setTimeout(()=>{
          try{
            if(typeof currentKamSubtab !== 'undefined' && currentKamSubtab === 'lastmonth' && typeof renderKamLastMonth==='function') renderKamLastMonth();
            else if(typeof renderKamThisMonth==='function') renderKamThisMonth();
          }catch(e){}
        }, opts.renderDelay || 260);
      }
      log('[v206e] bundle ready for account', aid, st.kamEmail);
      return true;
    }
    state.failures[st.safeKey] = state.failures[st.safeKey] || { ts:Date.now(), message:'bundle fetch failed or timed out' };
    paint(aid);
    log('[v206e] bundle failed for account', aid, st.kamEmail);
    return false;
  }
  async function ensureForDeepFlow(label){
    const aid = aidOf();
    if(!aid) return false;
    if(accountHasSkuData(aid)) return true;
    toast('กำลังโหลด SKU intelligence ของ KAM นี้...','⟳');
    const ok = await fetchAccountBundle(aid, { reason:label, rerender:true });
    if(!ok){
      toast('โหลด SKU detail ไม่สำเร็จ — กด Retry ได้ในการ์ดด้านบน','⚠');
      return false;
    }
    return true;
  }

  global._v206eRetryCurrentBundle = function(){
    const aid = aidOf();
    if(!aid) return;
    try{
      const st = getBundleState(aid);
      if(st.safeKey) delete state.failures[st.safeKey];
    }catch(e){}
    fetchAccountBundle(aid, { reason:'manual-retry', rerender:true });
  };
  global.getFreshketV206eBundleState = function(accountId){ return Object.assign({ version:VERSION }, getBundleState(accountId)); };

  const origEnsure = global.ensureSenseData;
  global.ensureSenseData = async function(accountId, opts){
    const aid = aidOf(accountId);
    const options = opts || {};
    if(!aid) return false;
    if(accountHasSkuData(aid)) return true;
    const st = getBundleState(aid);
    if(st.kamEmail){
      const ok = await fetchAccountBundle(aid, { reason:'ensureSenseData', rerender:!options.silent });
      if(ok){
        try{ if(!options.silent && typeof refreshAll==='function'){ refreshAll(); if(typeof updateDataStatus==='function') updateDataStatus(); } }catch(e){}
        try{ if(typeof updateMatcherPreStatus==='function') updateMatcherPreStatus(); }catch(e){}
        return true;
      }
      // For TL/Admin and installed/mobile PWA, avoid silently pulling the heavy bulk files.
      if(role()==='tl' || role()==='admin' || isStandalonePwa()) return false;
    }
    if(typeof origEnsure === 'function') return origEnsure.apply(this, arguments);
    return false;
  };
  try{ ensureSenseData = global.ensureSenseData; }catch(e){}

  const origPortviewSelect = global.portviewSelectAccount;
  if(typeof origPortviewSelect === 'function'){
    global.portviewSelectAccount = function(accountId){
      const aid = aidOf(accountId);
      try{ fetchAccountBundle(aid, { reason:'account-enter-prefetch', rerender:false }); }catch(e){}
      const ret = origPortviewSelect.apply(this, arguments);
      setTimeout(()=>paint(aid), 380);
      setTimeout(()=>paint(aid), 900);
      return ret;
    };
    try{ portviewSelectAccount = global.portviewSelectAccount; }catch(e){}
  }

  const origRenderThis = global.renderKamThisMonth;
  if(typeof origRenderThis === 'function'){
    global.renderKamThisMonth = function(){
      const ret = origRenderThis.apply(this, arguments);
      setTimeout(()=>paint(), 0);
      return ret;
    };
    try{ renderKamThisMonth = global.renderKamThisMonth; }catch(e){}
  }
  const origRenderLast = global.renderKamLastMonth;
  if(typeof origRenderLast === 'function'){
    global.renderKamLastMonth = function(){
      const ret = origRenderLast.apply(this, arguments);
      setTimeout(()=>paint(), 0);
      return ret;
    };
    try{ renderKamLastMonth = global.renderKamLastMonth; }catch(e){}
  }
  const origRenderOverview = global.renderKamOverview;
  if(typeof origRenderOverview === 'function'){
    global.renderKamOverview = function(){
      const ret = origRenderOverview.apply(this, arguments);
      setTimeout(()=>paint(), 30);
      return ret;
    };
    try{ renderKamOverview = global.renderKamOverview; }catch(e){}
  }

  function wrapDeepAction(name, label){
    const orig = global[name];
    if(typeof orig !== 'function') return;
    global[name] = async function(){
      const ok = await ensureForDeepFlow(label || name);
      if(!ok) return;
      return orig.apply(this, arguments);
    };
    try{ eval(name + ' = global[name]'); }catch(e){}
  }
  wrapDeepAction('triggerSkuVerifyFromThisMonth','SKU Verify');
  wrapDeepAction('triggerSkuVerifyLastMonth','SKU Verify');
  wrapDeepAction('generateKamBriefing','Brief');

  // Paint once after late target/hydration hooks settle.
  setTimeout(()=>paint(), 1200);
  log('[v206e] bundle micro patch installed');
})(window);


// PATCH: freshket-v210l-portfolio-state-cleanup-js
//////////////////////////////////////////////////////////////////////////////

(function(){
  function esc(v){
    try{ return typeof _commEscapeHtml==='function' ? _commEscapeHtml(v) : String(v ?? '').replace(/[&<>'"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];}); }
    catch(e){ return String(v ?? ''); }
  }
  function fmtK(n){ n=Number(n||0); return n>=1000000?'฿'+(n/1000000).toFixed(1)+'M':n>=1000?'฿'+(n/1000).toFixed(0)+'K':'฿'+Math.round(n); }
  function insightStar(){ return '<svg class="pv-insight-mini-star" viewBox="0 0 10 10" fill="rgba(170,210,255,.95)" xmlns="http://www.w3.org/2000/svg"><path d="M5,0 L6.3,3.7 L10,5 L6.3,6.3 L5,10 L3.7,6.3 L0,5 L3.7,3.7 Z"/></svg>'; }
  function ensureInsightControl(){
    var wrap=document.querySelector('#pv-sort-sticky .pv-toggle-btns');
    if(!wrap) return null;
    var btn=document.getElementById('pv-insight-mini');
    if(!btn){
      btn=document.createElement('button');
      btn.id='pv-insight-mini';
      btn.className='pv-insight-mini';
      btn.type='button';
      btn.onclick=function(){ generatePortviewInsight(); };
      wrap.insertBefore(btn, wrap.firstChild);
    }
    syncInsightButton();
    return btn;
  }
  function syncInsightButton(state){
    var btn=document.getElementById('pv-insight-mini');
    if(!btn) return;
    btn.classList.remove('loading','done','done-bounce');
    if(state==='loading'){
      btn.classList.add('loading');
      btn.innerHTML='<span class="ai-thinking">'+insightStar()+'<span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></span>';
      return;
    }
    var done=false;
    try{ done=!!portviewAiDone; }catch(e){ done=!!window._pvLastInsightHtml; }
    if(done || state==='done') btn.classList.add('done');
    btn.innerHTML=insightStar()+'<span class="pv-insight-word">Insight</span>';
  }
  function openInsightSheet(html, opts){
    opts=opts||{};
    var ov=document.getElementById('pv-insight-sheet-overlay');
    if(!ov){
      ov=document.createElement('div');
      ov.id='pv-insight-sheet-overlay';
      ov.className='pv-insight-sheet-overlay';
      ov.onclick=function(e){ if(e.target===ov) closeInsightSheet(); };
      document.body.appendChild(ov);
    }
    var body='';
    if(opts.loading){
      body='<div class="pv-insight-loading"><div class="pv-insight-loading-star">'+insightStar()+'</div><div>Olive กำลังอ่านสัญญาณพอร์ต...</div><div style="font-size:11px;color:rgba(198,216,245,.62);margin-top:3px">จัดลำดับร้านที่ควรดูต่อให้ก่อน</div></div>';
    }else if(opts.error){
      body='<div class="pv-insight-error">'+esc(opts.error)+'</div>';
    }else{
      body=html||'<div class="pv-insight-loading">ยังไม่มี Insight</div>';
    }
    ov.innerHTML='<div class="pv-insight-sheet">'
      +'<div class="pv-insight-sheet-handle"></div>'
      +'<div class="pv-insight-sheet-head"><div><div class="pv-insight-sheet-title">'+insightStar()+' Portfolio Insight</div><div class="pv-insight-sheet-sub">อ่านแล้วปิดกลับมาดูพอร์ตต่อได้ ไม่เปลี่ยนตำแหน่งหน้า</div></div><button class="pv-insight-sheet-close" onclick="_pvCloseInsightSheet()">×</button></div>'
      +'<div class="pv-insight-sheet-body">'+body+'</div>'
      +'</div>';
    requestAnimationFrame(function(){ ov.classList.add('on'); });
  }
  function closeInsightSheet(){
    var ov=document.getElementById('pv-insight-sheet-overlay');
    if(!ov) return;
    ov.classList.remove('on');
    setTimeout(function(){ ov.innerHTML=''; },260);
  }
  window._pvCloseInsightSheet=closeInsightSheet;
  window._pvEnsureInsightControl=ensureInsightControl;

  async function generateInsightSheet(){
    ensureInsightControl();
    try{
      if(portviewAiDone && window._pvLastInsightHtml){
        openInsightSheet(window._pvLastInsightHtml);
        syncInsightButton('done');
        return;
      }
    }catch(e){ if(window._pvLastInsightHtml){ openInsightSheet(window._pvLastInsightHtml); return; } }
    syncInsightButton('loading');
    openInsightSheet('',{loading:true});
    var accounts=getPortviewAccounts();
    var _awp=accounts.filter(function(a){return a.paceSignal&&a.paceSignal.pct>0;});
    var portfolioPace=_awp.length>0?Math.round(_awp.reduce(function(s,a){return s+a.paceSignal.gmvToDate;},0)/Math.max(1,_awp.reduce(function(s,a){return s+a.paceSignal.expected;},0))*100):0;
    var shortfall=accounts.filter(function(a){return a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn');}).reduce(function(s,a){
      var g=Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||a.paceSignal.gmvToDate||0));
      return s+g;
    },0);
    var atRisk=accounts
      .filter(function(a){return a.paceSignal&&(a.paceSignal.cls==='danger'||a.paceSignal.cls==='warn');})
      .map(function(a){a._shortfall=Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||a.paceSignal.gmvToDate||0));return a;})
      .sort(function(a,b){return b._shortfall-a._shortfall;})
      .slice(0,8);
    var ctxLines=atRisk.map(function(a){
      var baseline=a.paceSignal.baselineGmv||0;
      var parts=['Pace '+a.paceSignal.pct+'% · baseline '+(baseline>0?fmtK(baseline):'-')+'/เดือน · ขาดอีก '+fmtK(a._shortfall)];
      var cc=a._churnCounts;
      if(cc&&(cc.gone>0||cc.near>0)){
        var churnParts=[];
        if(cc.gone>0)churnParts.push('หายจริง '+cc.gone+' ตัว');
        if(cc.near>0)churnParts.push('ใกล้รอบ '+cc.near+' ตัว');
        parts.push('SKU (interval-aware): '+churnParts.join(', ')+' จาก '+cc.total+' ตัว');
      } else if(!cc&&a.churnedSkuCount>0){
        parts.push('SKU หาย '+a.churnedSkuCount+' ตัว ('+fmtK(a.churnedGmv||0)+'): '+(a.topChurnedNames||'').split(' | ').slice(0,2).join(', '));
      }
      if(a.missingCatCount>0) parts.push('Category ขาด: '+(a.missingCats||'').split(' | ').slice(0,2).join(', '));
      return '- '+a.name+' ['+a.paceSignal.cls+']: '+parts.join(' · ');
    }).join('\n');
    var quickRecover=accounts
      .filter(function(a){return a.paceSignal&&a.paceSignal.cls==='warn'&&!(a._churnCounts&&a._churnCounts.gone>0)&&!(a.churnedSkuCount>0);})
      .sort(function(a,b){return b.paceSignal.pct-a.paceSignal.pct;})
      .slice(0,2)
      .map(function(a){return a.name+' ('+a.paceSignal.pct+'% ขาดอีก '+fmtK(Math.max(0,(a.paceSignal.baselineGmv||0)-(a.paceSignal.runrate||a.paceSignal.gmvToDate||0)))+')';})
      .join(', ');
    var prompt='ข้อมูลพอร์ต:\nภาพรวม: '+accounts.length+' ร้าน · Pro Rate '+portfolioPace+'% · ส่วนต่างรวม '+fmtK(shortfall)+'\n\nAccounts เสี่ยง ranked by ฿ impact ('+atRisk.length+'):\n'+(ctxLines||'ไม่มี')+(quickRecover?'\n\nQuick recovery candidates (warn + SKU health ok): '+quickRecover:'');
    var sysPv=OLIVE_BASE+`\n\n-- TASK CONTEXT --\nA KAM is planning their day right now. They can see the list — they need your read on what it actually means and who to contact first. Accounts are ranked by ฿ shortfall, not pace %. Let the money impact drive the priority, not the percentage.\n\nUrgency logic (read the signals, decide yourself):\n- Danger + SKU หาย → โทรวันนี้ก่อนเลย ถามว่าทำไมหยุดสั่ง\n- Danger เฉยๆ → โทรวันนี้ เปิดด้วยความห่วงใย ไม่ใช่ pressure\n- Warn + category ขาด → พรุ่งนี้ ถามว่ายังซื้อ category นั้นอยู่มั้ย\n- Warn เฉยๆ → monitor เตรียม talkline ไว้\n- Safe/Great → ไม่ urgent แต่ถ้ามี opportunity ให้หมายเหตุ\n\n-- OUTPUT CONTRACT --\nThai prose — brief enough to read in 30 seconds.\n\nStructure:\n1. One sentence on portfolio state — lead with the problem, not how many accounts are fine.\n2. Contact list ranked by urgency: name → why it matters → what specifically to ask (max 5)\n3. Quick win if one exists.\n\nDon't repeat numbers already visible in the list.\nWhen mentioning a SKU, use ฿ — not %.`;
    try{
      var txt=await callAI('sonnet',sysPv,[{role:'user',content:prompt}],2000);
      var html=String(txt||'').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
      window._pvLastInsightHtml=html;
      try{ portviewAiDone=true; }catch(e){}
      openInsightSheet(html);
      syncInsightButton('done');
      var btn=document.getElementById('pv-insight-mini');
      if(btn){btn.classList.add('done-bounce');btn.addEventListener('animationend',function(e){if(e.animationName==='doneBounce')btn.classList.remove('done-bounce');},{once:true});}
    }catch(e){
      syncInsightButton();
      openInsightSheet('',{error:'AI error: '+String(e.message||e).slice(0,80)});
      try{ showToast('AI error: '+String(e.message||e).slice(0,60),'⚠'); }catch(_e){}
    }
  }
  window.generatePortviewInsight=generateInsightSheet;

  function openTargetExplain(panelId, handleId){
    var p=document.getElementById(panelId), h=document.getElementById(handleId);
    if(!p) return;
    if(h) h.classList.add('open');
    p.classList.remove('open');
    var clone=p.cloneNode(true);
    clone.classList.add('open');
    clone.querySelectorAll('.tgt-det-section').forEach(function(sec){
      if(sec.querySelector('.tgt-color-key') || /สีของตัวเลข\s*เป้าหมาย/.test(sec.textContent||'')) sec.remove();
    });
    var ov=document.getElementById('tgt-explain-sheet-overlay');
    if(!ov){
      ov=document.createElement('div');
      ov.id='tgt-explain-sheet-overlay';
      ov.className='tgt-explain-sheet-overlay';
      ov.onclick=function(e){ if(e.target===ov) closeTargetExplain(); };
      document.body.appendChild(ov);
    }
    ov.dataset.handleId=handleId||'';
    ov.innerHTML='<div class="tgt-explain-sheet">'
      +'<div class="tgt-explain-sheet-handle"></div>'
      +'<div class="tgt-explain-sheet-head"><div><div class="tgt-explain-sheet-title">วิธีอ่านตัวเลขพอร์ต</div><div class="tgt-explain-sheet-sub">แยกข้อมูลยาวออกจากหน้าหลัก เพื่อให้อ่านได้โดยไม่โดนยุบตอน scroll</div></div><button class="tgt-explain-sheet-close" onclick="_tgtCloseExplainSheet()">×</button></div>'
      +'<div class="tgt-explain-sheet-body">'+clone.outerHTML+'</div>'
      +'</div>';
    requestAnimationFrame(function(){ ov.classList.add('on'); });
  }
  function closeTargetExplain(){
    var ov=document.getElementById('tgt-explain-sheet-overlay');
    if(!ov) return;
    var handleId=ov.dataset.handleId;
    if(handleId){ var h=document.getElementById(handleId); if(h) h.classList.remove('open'); }
    ov.classList.remove('on');
    setTimeout(function(){ov.innerHTML='';},260);
  }
  window._tgtToggleDetail=openTargetExplain;
  window._tgtCloseExplainSheet=closeTargetExplain;

  function afterRenderHook(){
    setTimeout(function(){
      ensureInsightControl();
      var out=document.getElementById('portview-ai-output'); if(out){out.style.display='none'; out.innerHTML='';}
    },80);
  }
  var _oldRenderPortview=window.renderPortview;
  if(typeof _oldRenderPortview==='function'){
    window.renderPortview=function(){ var r=_oldRenderPortview.apply(this,arguments); afterRenderHook(); return r; };
    try{ renderPortview=window.renderPortview; }catch(e){}
  }
  var _oldRenderPortviewList=window.renderPortviewList;
  if(typeof _oldRenderPortviewList==='function'){
    window.renderPortviewList=function(){ var r=_oldRenderPortviewList.apply(this,arguments); afterRenderHook(); return r; };
    try{ renderPortviewList=window.renderPortviewList; }catch(e){}
  }
  document.addEventListener('DOMContentLoaded',function(){ setTimeout(ensureInsightControl,0); setTimeout(ensureInsightControl,350); });
  setTimeout(ensureInsightControl,0);
})();
(function(global){
  'use strict';
  var VERSION = 'v212a-pwa-freshness-unification';
  var DATA_EPOCH = '2026-05-22-v212a-pwa-freshness-unification';
  var CRITICAL = ['portview','history','handover'];
  var lastGovernanceLoadAt = 0;
  var governanceInFlight = null;
  var resumeInFlight = null;
  // v216 FIX 2D: was `0` — caused first cold-load to bypass minGap check and force-fetch CSV at ~3.2s,
  //              producing the "5th flash" 5-10s after splash. Initialize to boot time so cold load is
  //              treated as "already validated" — main loader already fetched fresh data.
  var lastResumeAt = (typeof Date.now === 'function' ? Date.now() : +new Date());

  function debugOn(){ try{return localStorage.getItem('senseDebug')==='1'||localStorage.getItem('freshketDebug')==='1';}catch(e){return false;} }
  function log(){ if(debugOn()) try{ console.log.apply(console, ['[v212a freshness]'].concat([].slice.call(arguments))); }catch(e){} }
  function warn(){ try{ console.warn.apply(console, ['[v212a freshness]'].concat([].slice.call(arguments))); }catch(e){} }
  function now(){ return Date.now ? Date.now() : +new Date(); }
  function safeClone(x){ try{return JSON.parse(JSON.stringify(x));}catch(e){return x;} }
  function isLoggedIn(){ try{return !!currentUser;}catch(e){return false;} }
  function currentQuarter(){ try{return _tgtCurrentQuarter();}catch(e){ return null; } }
  function hasCoreData(){ try{return Array.isArray(portviewBulkData) && portviewBulkData.length>0;}catch(e){return false;} }
  function markGov(meta){
    try{
      global.FreshketSenseGovernanceFreshness = Object.assign({
        version: VERSION,
        dataEpoch: DATA_EPOCH,
        checkedAt: now(),
        quarter: currentQuarter()
      }, meta || {});
    }catch(e){}
  }
  function clearGovernanceMemory(reason){
    try{ _tgtQuarterCache = {}; }catch(e){}
    try{ _tgtLoaded = false; }catch(e){}
    try{ _tgtCache = {}; }catch(e){}
    try{ _tgtSettings = { nrr_threshold: 98 }; }catch(e){}
    try{ _nrrGovPolicies = {}; }catch(e){}
    try{ _nrrExclusions = []; }catch(e){}
    try{ _commissionSnapshots = []; }catch(e){}
    try{ _commRuleConfig = { plans:{}, rules:{}, tiers:{}, assignments:[] }; }catch(e){}
    markGov({source:'cleared', reason:reason||'manual'});
  }
  async function forceGovernanceReload(reason, opts){
    opts = opts || {};
    var force = !!opts.force;
    var minGap = opts.minGap == null ? 60000 : opts.minGap;
    if(governanceInFlight) return governanceInFlight;
    if(!isLoggedIn() && !opts.allowLoggedOut) return false;
    if(!force && lastGovernanceLoadAt && (now() - lastGovernanceLoadAt) < minGap){
      markGov(Object.assign({}, global.FreshketSenseGovernanceFreshness||{}, {source:'memory-fresh', reason:reason||'throttled', skipped:true, ageMs:now()-lastGovernanceLoadAt}));
      return true;
    }
    governanceInFlight = (async function(){
      var q = currentQuarter();
      var started = now();
      try{
        if(typeof loadTargets !== 'function' || !q){ markGov({source:'unavailable', reason:reason||'unknown'}); return false; }
        clearGovernanceMemory(reason||'force-reload');
        if(typeof _setDataPillText === 'function' && !opts.silent) _setDataPillText('Sync governance','Supabase');
        await loadTargets(q);
        lastGovernanceLoadAt = now();
        var metrics = {};
        try{ metrics.targetKeys = Object.keys(_tgtCache||{}).length; }catch(e){}
        try{ metrics.policyKeys = Object.keys(_nrrGovPolicies||{}).length; }catch(e){}
        try{ metrics.exclusions = (_nrrExclusions||[]).length; }catch(e){}
        try{ metrics.snapshots = (_commissionSnapshots||[]).length; }catch(e){}
        try{ metrics.assignments = ((_commRuleConfig||{}).assignments||[]).length; }catch(e){}
        markGov(Object.assign({source:'network', ok:true, reason:reason||'reload', durationMs:now()-started}, metrics));
        log('governance reloaded', reason, metrics);
        return true;
      }catch(err){
        markGov({source:'error', ok:false, reason:reason||'reload', durationMs:now()-started, error:err && err.message ? err.message : String(err)});
        warn('governance reload failed', reason, err && err.message ? err.message : err);
        return false;
      }finally{ governanceInFlight = null; }
    })();
    return governanceInFlight;
  }
  function hydrateVisible(reason){
    try{ if(typeof updateDataStatus === 'function') updateDataStatus(); }catch(e){}
    try{ if(typeof updateMatcherPreStatus === 'function') updateMatcherPreStatus(); }catch(e){}
    // v223: RenderBus handles all screen renders — one flush for all screens
    if(window.RenderBus){
      window.RenderBus.signal('hydrate-'+reason);
    } else {
      // Fallback if RenderBus not available
      try{ if(typeof renderTeamview === 'function' && document.getElementById('scr-teamview')?.classList.contains('on')) renderTeamview(); }catch(e){}
      try{ if(typeof renderPortview === 'function' && document.getElementById('scr-portview')?.classList.contains('on')) renderPortview(); }catch(e){}
      try{ if(typeof renderKamOverview === 'function' && document.getElementById('scr-kam-overview')?.classList.contains('on')) renderKamOverview(); }catch(e){}
    }
  }
  function keysAreCritical(keys){
    if(!Array.isArray(keys)) return false;
    var map = {}; keys.forEach(function(k){ map[k]=true; });
    return CRITICAL.every(function(k){ return !!map[k]; });
  }
  async function validateUnifiedFreshness(reason, opts){
    opts = opts || {};
    var minGap = opts.force ? 0 : 120000;
    if(resumeInFlight) return resumeInFlight;
    if(!isLoggedIn()) return false;
    if(!opts.force && !hasCoreData()) return false;
    if(!opts.force && lastResumeAt && (now()-lastResumeAt)<minGap) return false;
    lastResumeAt = now();
    resumeInFlight = (async function(){
      try{
        if(navigator && navigator.onLine === false){
          try{ if(typeof showToast === 'function') showToast('ใช้ข้อมูล cached — offline','⚠'); }catch(e){}
          return false;
        }
        var csvOk = true;
        if(typeof ensureCloudflareFiles === 'function'){
          // v218 DATA GATE: clear loaded tabs before force-reload so refreshAll() stays blocked
          // (allCriticalReady()=false) during the entire reload window. When the last file
          // completes, _fetchCloudflareFile's gate flushes _pendingRefreshAll → ONE render.
          // Without this, _cloudLoadedTabs has stale entries → allCriticalReady()=true → each
          // file completion fires refreshAll() → 6 flashes visible during resume reload.
          try{ if(window._cloudLoadedTabs && typeof window._cloudLoadedTabs.clear==='function') window._cloudLoadedTabs.clear(); }catch(e){}
          if(window.RenderBus) window.RenderBus.reset(); // v223: reset so re-arriving files batch correctly
          csvOk = await ensureCloudflareFiles(CRITICAL, { label:'ตรวจข้อมูลล่าสุด', force:true });
        }
        var govOk = await forceGovernanceReload(reason||'resume', {force:true, silent:true, minGap:0});
        if(csvOk && govOk){
          hydrateVisible(reason||'resume');
          try{ if(typeof showToast === 'function') showToast('ข้อมูลล่าสุดแล้ว','✓'); }catch(e){}
          return true;
        }
        try{ if(typeof showToast === 'function') showToast('ตรวจข้อมูลล่าสุดไม่ครบ — ใช้ข้อมูลที่มีอยู่','⚠'); }catch(e){}
        return false;
      }catch(err){ warn('unified validation failed', reason, err&&err.message?err.message:err); return false; }
      finally{ resumeInFlight = null; }
    })();
    return resumeInFlight;
  }

  // Wrap CSV ensure: when critical CSV is refreshed, Supabase governance/commission state must refresh before callers hydrate UI.
  try{
    var oldEnsure = ensureCloudflareFiles;
    if(typeof oldEnsure === 'function' && !oldEnsure.__v212aWrapped){
      var wrappedEnsure = async function(keys, opts){
        var ok = await oldEnsure.apply(this, arguments);
        try{
          if(ok && (opts && opts.force || keysAreCritical(keys)) && keysAreCritical(keys)){
            await forceGovernanceReload('ensure-critical-csv', {force:true, silent:true, minGap:0});
          }
        }catch(e){ warn('post-ensure governance sync failed', e&&e.message?e.message:e); }
        return ok;
      };
      wrappedEnsure.__v212aWrapped = true;
      ensureCloudflareFiles = wrappedEnsure;
    }
  }catch(e){ warn('ensureCloudflareFiles wrap failed', e&&e.message?e.message:e); }

  // Wrap cold load: clear/reload governance before CSV render path to avoid PWA using stale target/exclusion/snapshot memory.
  try{
    var oldLoad = loadFromCloudflareR2;
    if(typeof oldLoad === 'function' && !oldLoad.__v212aWrapped){
      var wrappedLoad = async function(){
        await forceGovernanceReload('cold-load-pre-render', {force:true, silent:true, minGap:0});
        var res = await oldLoad.apply(this, arguments);
        await forceGovernanceReload('cold-load-post-csv', {force:true, silent:true, minGap:0});
        hydrateVisible('cold-load-complete');
        return res;
      };
      wrappedLoad.__v212aWrapped = true;
      loadFromCloudflareR2 = wrappedLoad;
      try{ loadFromGoogleSheets = wrappedLoad; }catch(e){}
      try{ loadFromSupabaseStorage = wrappedLoad; }catch(e){}
    }
  }catch(e){ warn('loadFromCloudflareR2 wrap failed', e&&e.message?e.message:e); }

  // Wrap manual refresh: clear both CSV/KAM bundle and Supabase-derived state.
  try{
    var oldReload = reloadFromCloudflareR2;
    if(typeof oldReload === 'function' && !oldReload.__v212aWrapped){
      var wrappedReload = async function(){
        clearGovernanceMemory('manual-refresh');
        try{ lastGovernanceLoadAt = 0; lastResumeAt = 0; }catch(e){}
        var res = await oldReload.apply(this, arguments);
        await forceGovernanceReload('manual-refresh-post-csv', {force:true, silent:true, minGap:0});
        hydrateVisible('manual-refresh');
        return res;
      };
      wrappedReload.__v212aWrapped = true;
      reloadFromCloudflareR2 = wrappedReload;
      try{ reloadFromGoogleSheets = wrappedReload; }catch(e){}
    }
  }catch(e){ warn('reloadFromCloudflareR2 wrap failed', e&&e.message?e.message:e); }

  // v225: visibilitychange/pageshow/focus/online listeners REMOVED from v212a.
  // Handled by ResumeCoordinator at end of 08_patches.js.

  var api = {
    version: VERSION,
    dataEpoch: DATA_EPOCH,
    criticalKeys: CRITICAL.slice(),
    forceGovernanceReload: forceGovernanceReload,
    clearGovernanceMemory: clearGovernanceMemory,
    validateFreshnessOnResume: validateUnifiedFreshness,
    getFreshness: function(){
      return {
        csv: safeClone(global.FreshketSenseDataFreshness || {}),
        governance: safeClone(global.FreshketSenseGovernanceFreshness || {}),
        app: { version: VERSION, dataEpoch: DATA_EPOCH, ts: now() }
      };
    }
  };
  global.FreshketSenseV212a = api;
  try{
    global.FreshketSenseV212 = Object.assign(global.FreshketSenseV212 || {}, {
      version: VERSION,
      dataEpoch: DATA_EPOCH,
      validateFreshnessOnResume: validateUnifiedFreshness,
      forceGovernanceReload: forceGovernanceReload,
      getFreshness: api.getFreshness
    });
  }catch(e){}
  markGov({source:'boot', reason:'v212a-loaded'});
  log('loaded');
})(window);
