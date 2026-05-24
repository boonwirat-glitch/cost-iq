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
  const commissionMeta = isTLRole(role)
    ? `KAM team ${_commFmtPayout(summary.kamPayout)}`
    : `TL ${_commFmtPayout(summary.tlPayout)} · KAM ${_commFmtPayout(summary.kamPayout)}`;
  return `<div class="tv-gov-card">
    <div class="tv-signal-wrap">
      <div class="tv-signal-card ${nrrOk ? 'ok' : 'warn'}">
        <div class="tv-signal-label">NRR</div>
        <div class="tv-signal-value ${nrrOk ? 'ok' : 'warn'}">${governedPct !== null ? governedPct + '%' : '—'}</div>
        <div class="tv-signal-meta">${baseTxt}</div>
      </div>
      <div class="tv-signal-card commission">
        <div class="tv-signal-label">Commission</div>
        <div class="tv-signal-value">${_commFmtPayout(commissionMain)}</div>
        <div class="tv-signal-meta">${commissionMeta}</div>
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
  const eligibleBase = Math.max(1, base - excludedBase);
  return Math.round(curr / eligibleBase * 100);
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
    const raw = _tgtComputeKamNRR(null, tl.email);
    const rawPct = raw && raw.nrr !== null ? Math.round(raw.nrr * 100) : null;
    const governedPct = _nrrGovernedPct(raw, null, tl.email);
    const pct = governedPct !== null ? governedPct : rawPct;
    const planCode = _commGetAssignmentPlan(period, 'tl', tl.email, 'tl');
    const payout = _commPayoutForPctByCode(planCode, 'tl', pct);
    rows.push({
      period_month: period,
      beneficiary_role: 'tl',
      beneficiary_email: tl.email,
      team_lead_email: tl.email,
      raw_nrr_pct: rawPct,
      governed_nrr_pct: pct,
      payout_amount: payout,
      snapshot_status: 'final',
      breakdown: {
        type: 'tl_nrr',
        role: 'tl',
        team_lead_name: tl.name || tl.email,
        raw_nrr_pct: rawPct,
        governed_nrr_pct: pct,
        excluded_base_gmv: _nrrExclusionBaseImpact(null, tl.email),
        base_gmv: raw ? raw.baselinePrevGmv : 0,
        current_gmv: raw ? raw.cohortGmv : 0,
        payout_source: planCode,
        rule_name: _commPlanNameByCode(planCode, 'tl')
      },
      created_by: actor,
      updated_by: actor
    });
  });

  const groups = role === 'admin' ? allGroups : allGroups.filter(g => (g.accounts || []).some(a => a.tlEmail === visibleTlEmail));
  groups.forEach(g => {
    if (!g.kamEmail) return;
    const raw = _tgtComputeKamNRR(g.kamEmail, null);
    const rawPct = raw && raw.nrr !== null ? Math.round(raw.nrr * 100) : null;
    const governedPct = _nrrGovernedPct(raw, g.kamEmail, null);
    const pct = governedPct !== null ? governedPct : rawPct;
    const planCode = _commGetAssignmentPlan(period, 'kam', g.kamEmail, 'kam');
    const payout = _commPayoutForPctByCode(planCode, 'kam', pct);
    const tlEmail = (g.accounts && g.accounts[0] && g.accounts[0].tlEmail) || null;
    rows.push({
      period_month: period,
      beneficiary_role: 'kam',
      beneficiary_email: g.kamEmail,
      team_lead_email: tlEmail,
      raw_nrr_pct: rawPct,
      governed_nrr_pct: pct,
      payout_amount: payout,
      snapshot_status: 'final',
      breakdown: {
        type: 'kam_nrr',
        role: 'kam',
        kam_name: g.kamName || g.kamEmail,
        raw_nrr_pct: rawPct,
        governed_nrr_pct: pct,
        excluded_base_gmv: _nrrExclusionBaseImpact(g.kamEmail, null),
        base_gmv: raw ? raw.baselinePrevGmv : 0,
        current_gmv: raw ? raw.cohortGmv : 0,
        account_count: g.total || ((g.accounts || []).length),
        payout_source: planCode,
        rule_name: _commPlanNameByCode(planCode, 'kam')
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
window._commRenderKamSelfStrip = _commRenderKamSelfStrip;
window._commOpenKamSelfSheet = _commOpenKamSelfSheet;
window._commCloseKamSelfSheet = _commCloseKamSelfSheet;

function _commSnapshotCsv(rows) {
  const headers = ['period_month','beneficiary_role','beneficiary_email','team_lead_email','rule_name','raw_nrr_pct','governed_nrr_pct','payout_amount','status'];
  const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
  const getVal = (r,h) => h === 'rule_name' ? (r.breakdown && r.breakdown.rule_name) : r[h];
  return [headers.join(',')].concat(rows.map(r => headers.map(h => esc(getVal(r,h))).join(','))).join('\n');
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

// ── Supabase load ───────────────────────────────────────────────
let _tgtQuarterCache = {}; // per-quarter cache {quarter: {cache, settings, ts}}
const _TGT_CACHE_TTL = 5 * 60 * 1000; // 5 min TTL — fresh enough for a session

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

