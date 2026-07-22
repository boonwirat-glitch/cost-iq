// SECTION:COMMISSION_COCKPIT
function ensureCommissionCockpitOverlay() {
  let ov = document.getElementById('commission-cockpit-overlay');
  if (ov) return ov;

  ov = document.createElement('div');
  ov.id = 'commission-cockpit-overlay';
  ov.className = 'comm-overlay';
  ov.setAttribute('onclick', 'if(event.target===this)closeCommissionCockpit()');
  ov.innerHTML = `
    <div class="comm-sheet">
      <div class="comm-drag"></div>
      <div class="comm-head">
        <div>
          <div class="comm-title">Commission Cockpit</div>
          <div class="comm-sub">ตั้ง policy, assign plan, review payout, lock snapshot ใน flow เดียว</div>
        </div>
        <button class="comm-close" data-comm-close="1" onclick="window.closeCommissionCockpit&&window.closeCommissionCockpit()">×</button>
      </div>
      <div class="comm-steps">
        <button class="comm-step active" id="comm-step-policy" onclick="switchCommissionStep('policy')">1 Policy</button>
        <button class="comm-step" id="comm-step-setup" onclick="switchCommissionStep('setup')">2 Setup</button>
        <button class="comm-step comm-step-advanced" id="comm-step-assignment" onclick="switchCommissionStep('assignment')">3 Assignment</button>
        <button class="comm-step comm-step-advanced" id="comm-step-rules" onclick="switchCommissionStep('rules')">4 Rules</button>
        <button class="comm-step" id="comm-step-lock" onclick="switchCommissionStep('lock')">5 Preview<br>& Lock</button>
      </div>
      <div class="comm-body" id="commission-cockpit-body"></div>
      <div class="comm-footer">
        <button class="comm-secondary" data-comm-close="1" onclick="window.closeCommissionCockpit&&window.closeCommissionCockpit()">Close</button>
        <button class="comm-secondary" onclick="openCommissionRulebook()" style="color:rgba(var(--ink-blue-hi),.55)">กฎค่าคอมฯ</button>
        <button class="comm-save" onclick="saveCommissionCockpit()">Save changes</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
  return ov;
}

function openCommissionCockpit(step) {
  // v210g: governance cockpit is admin-only. TL/KAM get read-only commission scorecards only.
  if (!currentUserProfile || !isAdminRole(getCurrentRole())) {
    if (typeof showToast === 'function') showToast('Commission Cockpit เปิดได้เฉพาะ Admin', '!');
    return;
  }
  _commCockpitStep = step || 'policy';
  const ov = ensureCommissionCockpitOverlay();
  if (ov) {
    ov.classList.remove('closing');
    ov.classList.add('opening');
    ov.style.display = 'flex';
    ov.style.pointerEvents = 'auto';
    ov.style.zIndex = '10080';
    // v210f: let display:flex paint first, then add .open so bottom-sheet transition actually runs.
    requestAnimationFrame(() => {
      ov.classList.add('open');
      window.setTimeout(() => ov.classList.remove('opening'), 280);
    });
  }
  try {
    renderCommissionCockpit();
  } catch(e) {
    console.error('[Commission Cockpit] render failed', e);
  }
  const body=document.getElementById('commission-cockpit-body'); 
  if(body) body.scrollTop=0;
}
window.openCommissionCockpit = openCommissionCockpit;

(function(){
  if (window.__commCockpitClickBound) return;
  window.__commCockpitClickBound = true;
  document.addEventListener('click', function(e){
    const btn = e.target && e.target.closest && e.target.closest('#tv-commission-btn,.commission-open');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const step = 'lock'; // v865: 'exceptions' step (NRR Exclusion Governance) retired -- see nrr_waivers.js in /nrr
    if (typeof window.openCommissionCockpit === 'function') window.openCommissionCockpit(step);
  }, true);
})();

function closeCommissionCockpit() {
  if (!_commSuppressCloseGuard && _commHasPendingChanges()) {
    const ok = window.confirm('ยังมี changes ที่ยังไม่ได้ save ต้องการปิด Commission Cockpit โดยไม่บันทึกหรือไม่?');
    if (!ok) return;
  }
  const ov = document.getElementById('commission-cockpit-overlay');
  if (ov) {
    ov.classList.add('closing');
    ov.classList.remove('open','opening');
    ov.style.pointerEvents = 'none';
    setTimeout(()=>{ 
      if (!ov.classList.contains('open')) {
        ov.classList.remove('closing');
        ov.style.display = 'none';
      }
    }, 300);
  }
}
window.closeCommissionCockpit = closeCommissionCockpit;

(function(){
  if (window.__commCloseClickBound) return;
  window.__commCloseClickBound = true;
  document.addEventListener('click', function(e){
    const closeBtn = e.target && e.target.closest && e.target.closest('[data-comm-close="1"], .comm-close, .comm-secondary');
    if (!closeBtn) return;
    const ov = document.getElementById('commission-cockpit-overlay');
    if (ov && ov.contains(closeBtn)) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.closeCommissionCockpit === 'function') window.closeCommissionCockpit();
    }
  }, true);
})();

(function(){
  if (window.__commEscBound) return;
  window.__commEscBound = true;
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    const ov = document.getElementById('commission-cockpit-overlay');
    if (ov && ov.classList.contains('open')) {
      e.preventDefault();
      if (typeof window.closeCommissionCockpit === 'function') window.closeCommissionCockpit();
    }
  });
})();

function switchCommissionStep(step) {
  _commCockpitStep = step;
  renderCommissionCockpit();
}
// v289 C: retroactive subtab state
var _commLockSubtab = 'current';
function switchLockSubtab(tab) { _commLockSubtab = tab || 'current'; renderCommissionCockpit(); }
window.switchLockSubtab = switchLockSubtab;
function _commPlanOptionsFor(role) {
  const plans = Object.values((_commRuleConfig && _commRuleConfig.plans) || {}).filter(p => p.beneficiary_role === role && _commIsActivePlan(p));
  const codes = new Set(plans.map(p => p.plan_code));
  if (!codes.has(_commPlanCode(role))) plans.unshift({plan_code:_commPlanCode(role), plan_name:_commPlanName(role), beneficiary_role:role, status:'active'});
  return plans;
}
function _commAssignmentKey(period, scope, assignee) {
  return `${period}|${scope}|${assignee}`;
}
function _commGetAssignmentPlan(period, scope, assignee, role) {
  const key = _commAssignmentKey(period, scope, assignee);
  if (_commAssignmentPending[key]) return _commActivePlanCode(_commAssignmentPending[key], role);

  // Tier 1: person-level override (existing behavior, unchanged).
  const found = ((_commRuleConfig && _commRuleConfig.assignments) || []).find(a => a.period_month === period && a.assignment_scope === scope && a.assignee_key === assignee);
  if (found) {
    const rawCode = found.plan_code || Object.values(((_commRuleConfig&&_commRuleConfig.plans)||{})).find(p=>p.id===found.plan_id)?.plan_code || _commPlanCode(role);
    return _commActivePlanCode(rawCode, role);
  }

  // Tier 2 (v878): role-wide default, admin-configurable in the Cockpit's
  // Assignment step (assignee_key holds the role bucket itself, not an
  // email, for assignment_scope='role_default'). Falls through to the
  // hardcoded bootstrap (tier 3) if no admin has set one yet — this makes
  // tier 2 a true no-op for kam/tl until the Cockpit UI (phase 6) ships,
  // since the phase-1 migration seeded role_default rows pointing at the
  // exact same STD plan _commPlanCode already returns for them.
  const roleDefaultKey = _commAssignmentKey(period, 'role_default', role);
  if (_commAssignmentPending[roleDefaultKey]) return _commActivePlanCode(_commAssignmentPending[roleDefaultKey], role);
  const roleDefault = ((_commRuleConfig && _commRuleConfig.assignments) || []).find(a => a.period_month === period && a.assignment_scope === 'role_default' && a.assignee_key === role);
  if (roleDefault) {
    const rawCode = roleDefault.plan_code || Object.values(((_commRuleConfig&&_commRuleConfig.plans)||{})).find(p=>p.id===roleDefault.plan_id)?.plan_code || _commPlanCode(role);
    return _commActivePlanCode(rawCode, role);
  }

  // Tier 3: hardcoded bootstrap seed (last resort, never business-configured).
  return _commPlanCode(role);
}
function _commSetAssignment(period, scope, assignee, planCode) {
  _commAssignmentPending[_commAssignmentKey(period, scope, assignee)] = planCode;
  _commMarkChanged();
}

function _commCloneLocalPlan(role, baseCode, ownerLabel) {
  const baseDraft = _commGetDraft(role);
  const clean = String(ownerLabel || role || 'Custom').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,24) || 'Custom';
  const code = `${role.toUpperCase()}_NRR_${clean}_${Date.now().toString().slice(-5)}`;
  const planName = `${ownerLabel || clean} NRR Plan`;
  _commRulePending[code] = {
    ...JSON.parse(JSON.stringify(baseDraft)),
    role,
    plan_code: code,
    plan_name: planName,
    beneficiary_role: role
  };
  if (!_commRuleConfig.plans) _commRuleConfig.plans = {};
  _commRuleConfig.plans[code] = {
    id: null,
    plan_code: code,
    plan_name: planName,
    beneficiary_role: role,
    status:'draft'
  };
  return code;
}
// [UNUSED] — no callers found; safe to delete in future refactor
function cloneTlPlanForAssignment(tlEmail, tlName) {
  const period = _nrrExclusionCurrentPeriod();
  const code = _commCloneLocalPlan('tl', _commPlanCode('tl'), tlName || tlEmail);
  _commSetAssignment(period, 'tl', tlEmail, code);
  renderCommissionCockpit();
}
// [UNUSED] — no callers found; safe to delete in future refactor
function cloneKamPlanForAssignment(kamEmail, kamName) {
  const period = _nrrExclusionCurrentPeriod();
  const code = _commCloneLocalPlan('kam', _commPlanCode('kam'), kamName || kamEmail);
  _commSetAssignment(period, 'kam', kamEmail, code);
  renderCommissionCockpit();
}

function _commPlanNameByCode(code, role) {
  const p = ((_commRuleConfig && _commRuleConfig.plans) || {})[code];
  return p ? p.plan_name : (code || _commPlanName(role));
}
function _commBuildTeamPreviewGroups() {
  const model = _commBuildPreviewModel();
  const groups = (typeof _buildKamGroups === 'function') ? (_buildKamGroups() || []) : [];
  const tlMap = {};
  groups.forEach(g => {
    const tlEmail = (g.accounts && g.accounts[0] && g.accounts[0].tlEmail) || 'unassigned';
    const tlName = (g.accounts && g.accounts[0] && g.accounts[0].tlName) || tlEmail;
    if (!tlMap[tlEmail]) tlMap[tlEmail] = { tlEmail, tlName, kamRows: [], kamTotal:0, tlPayout:0, teamNrr:null, total:0 };
    const row = model.kamRows.find(r => r.kamEmail === g.kamEmail) || {};
    tlMap[tlEmail].kamRows.push(row);
    tlMap[tlEmail].kamTotal += Number(row.payout || 0);
  });
  const _policyForTeamNrr = (typeof _nrrGovResolveForVisibleScope === 'function') ? _nrrGovResolveForVisibleScope() : null;
  const _isQTeamNrr = _policyForTeamNrr && _policyForTeamNrr.commission_mode === 'quarterly';
  Object.values(tlMap).forEach(t => {
    // v828: quarterly mode reads Team NRR from QNRR source so it matches the commission total shown below it
    const raw = t.tlEmail === 'unassigned' ? null
      : (_isQTeamNrr && typeof window._qnrrComputeForCommission === 'function')
        ? window._qnrrComputeForCommission(t.tlEmail, 'tl')
        : _tgtComputeKamNRR(null, t.tlEmail);
    const pct = raw ? _nrrGovernedPct(raw, null, t.tlEmail) : null;
    t.teamNrr = pct;
    t.tlPlanCode = _commGetAssignmentPlan(_nrrExclusionCurrentPeriod(), 'tl', t.tlEmail, 'tl');
    t.tlPlanName = _commPlanNameByCode(t.tlPlanCode, 'tl');
    t.tlPayout = _commPayoutForPctByCode(t.tlPlanCode, 'tl', pct);
    t.total = t.tlPayout + t.kamTotal;
  });
  return Object.values(tlMap).sort((a,b)=>b.total-a.total);
}

// ══════════════════════════════════════════════════════════════
// SECTION:COMMISSION_SETUP_COMPONENT_DRAFTS (Commission Setup redesign, phase 1)
// New per-scheme draft/preview layer for the 5 non-NRR components (Gate,
// Upsell P1/P3/Expansion, Handover, TL-mult). Fully separate from the OLD
// global-blob path (_commComponentPending/saveCommissionComponentRates,
// which stays untouched and reachable only via the Advanced tab).
//
// Keyed by plan_code (not plan.id) — a brand-new, never-saved role's plan
// has id:null, so keying by id would make previewing a new role's
// components permanently impossible. Mirrors the proven NRR pattern
// (_commRulePending is also plan_code-keyed).
let _commComponentRulePending = {};

function _commComponentDraftKey(planCode, metricCode, metricVariant) {
  return `${planCode}|${metricCode}|${metricVariant || ''}`;
}

// Read the current value for an editor: pending draft first, else the real
// saved rule (if this plan has been persisted), else null (unconfigured).
function _commGetComponentDraft(planCode, metricCode, metricVariant) {
  const key = _commComponentDraftKey(planCode, metricCode, metricVariant);
  if (Object.prototype.hasOwnProperty.call(_commComponentRulePending, key)) return _commComponentRulePending[key];
  return (typeof _commGetRuleForMetric === 'function') ? _commGetRuleForMetric(planCode, metricCode, metricVariant) : null;
}

// Lazily create a draft (cloned from the real saved rule if one exists,
// else a sensible empty shape) so an editor has something to mutate.
function _commEnsureComponentDraft(planCode, metricCode, metricVariant) {
  const key = _commComponentDraftKey(planCode, metricCode, metricVariant);
  if (!_commComponentRulePending[key]) {
    const existing = (typeof _commGetRuleForMetric === 'function') ? _commGetRuleForMetric(planCode, metricCode, metricVariant) : null;
    _commComponentRulePending[key] = existing
      ? JSON.parse(JSON.stringify(existing))
      : { active: true, params: {}, tiers: [], tier_config: null };
  }
  return _commComponentRulePending[key];
}
function _commSetComponentDraftActive(planCode, metricCode, metricVariant, active) {
  const d = _commEnsureComponentDraft(planCode, metricCode, metricVariant);
  d.active = !!active;
  _commMarkChanged();
}
window._commGetComponentDraft = _commGetComponentDraft;
window._commEnsureComponentDraft = _commEnsureComponentDraft;
window._commSetComponentDraftActive = _commSetComponentDraftActive;

// Builds the previewResolver closure threaded into _commBuildKamPayout/
// _commBuildTlPayout's new optional last param (07a_commission_engine.js).
// Not scoped to a single plan_code — _commBuildKamPayout/_commBuildTlPayout
// resolve their own planCode internally (same as today, via
// _commGetAssignmentPlan) and pass it to every _commCompute* call; the
// resolver just answers "is there a staged draft for THIS (planCode,
// metricCode, variant)" fresh each call, which is always the one planCode
// actually in play for that build — no separate scoping needed. Returns
// undefined (not the pending map's value) for anything with no staged
// draft, so the real compute functions fall back to exactly today's
// saved-state resolution — this is what keeps real Compute/Lock (which
// never pass a resolver at all) provably unaffected.
function _commComponentPreviewResolver() {
  return function(planCode, metricCode, metricVariant) {
    const key = _commComponentDraftKey(planCode, metricCode, metricVariant);
    if (Object.prototype.hasOwnProperty.call(_commComponentRulePending, key)) return _commComponentRulePending[key];
    return undefined;
  };
}
// Preview-only wrappers — the new Setup UI's live-preview panel calls these;
// real Compute/Lock (computeCommissionDraft/lockCommissionSnapshot) never do.
function _commBuildKamPayoutPreview(kamEmail, role) {
  return _commBuildKamPayout(kamEmail, undefined, role, _commComponentPreviewResolver());
}
function _commBuildTlPayoutPreview(tlEmail) {
  return _commBuildTlPayout(tlEmail, undefined, _commComponentPreviewResolver());
}
window._commBuildKamPayoutPreview = _commBuildKamPayoutPreview;
window._commBuildTlPayoutPreview = _commBuildTlPayoutPreview;

window.debugCommissionRules = function(){
  const plans = Object.values((_commRuleConfig && _commRuleConfig.plans) || {});
  const assignments = ((_commRuleConfig && _commRuleConfig.assignments) || []);
  // plan/assignment dump removed — use Commission Cockpit UI instead
  return { plans, assignments, pending:_commRulePending };
};

function renderCommissionCockpit() {
  const stepChanged = _commLastRenderedStep !== _commCockpitStep;
  document.querySelectorAll('.comm-step').forEach(b=>b.classList.remove('active'));
  const btn = document.getElementById('comm-step-' + _commCockpitStep);
  if (btn) btn.classList.add('active');
  const body = document.getElementById('commission-cockpit-body');
  if (!body) return;
  if (stepChanged) {
    body.classList.remove('comm-body-in');
    void body.offsetWidth;
    body.classList.add('comm-body-in');
  } else {
    body.classList.remove('comm-body-in');
  }
  let out;
  if (_commCockpitStep === 'policy') out = renderCommPolicyStep(body);
  else if (_commCockpitStep === 'setup') out = renderCommSetupStep(body);
  else if (_commCockpitStep === 'assignment') out = renderCommAssignmentStep(body);
  else if (_commCockpitStep === 'rules') out = renderCommRulesStep(body);
  else out = renderCommLockStep(body);
  _commLastRenderedStep = _commCockpitStep;
  _commUpdateSaveButtonState();
  return out;
}
function renderCommPolicyStep(body) {
  const q = _tgtActiveQuarter || _tgtCurrentQuarter();
  const months = _tgtQuarterMonths(q);
  const pendingPolicy = Object.keys(_nrrGovPending || {}).length;
  body.innerHTML = `
    <div class="comm-hero">
      <div class="comm-hero-top">
        <div>
          <div class="comm-hero-title">1. Period & NRR Base Policy</div>
          <div class="comm-hero-sub">กำหนดฐาน NRR ก่อน payout ทุกคนจะยึด policy ชุดนี้เป็น source of truth</div>
        </div>
        <span class="comm-badge ${pendingPolicy?'dirty':'blue'}">${pendingPolicy?pendingPolicy+' unsaved':_tgtQuarterLabel(q)}</span>
      </div>
      <div class="comm-readiness-bar ${pendingPolicy?'warn':'ready'}"><span class="comm-readiness-dot"></span><div class="comm-readiness-copy">${pendingPolicy?'มี policy change ที่ยังไม่ได้ save':'Policy state พร้อมใช้งานจากข้อมูลล่าสุด'}</div></div>
    </div>
    ${months.map(m=>{
      const key = _nrrGovKey(m,'all','all');
      const dirty = !!(_nrrGovPending || {})[key];
      const p = _nrrGovGetPending(m,'all','all');
      const opts = _nrrGovBaseMonthOptions(m);
      return `<div class="comm-card comm-policy-card ${dirty?'dirty':''}">
        <div class="comm-card-top"><div><div class="comm-name">${_nrrGovMonthLabel(m)}${dirty?'<span class="comm-unsaved">Unsaved</span>':''}</div><div class="comm-meta">Admin policy · applies to all teams in this foundation</div></div><span class="comm-badge ${p.status==='published'?'ok':'warn'}">${p.status||'draft'}</span></div>
        <div class="comm-grid2">
          <div class="comm-field"><label>Base mode</label><select class="comm-select" onchange="onNrrPolicyChange('${m}','base_mode',this.value)">
            <option value="rolling_mom" ${p.base_mode==='rolling_mom'?'selected':''}>Rolling MoM</option>
            <option value="fixed_month" ${p.base_mode==='fixed_month'?'selected':''}>Fixed base month</option>
          </select></div>
          <div class="comm-field"><label>Base month</label><select class="comm-select" ${p.base_mode==='fixed_month'?'':'disabled'} onchange="onNrrPolicyChange('${m}','base_month',this.value)">
            ${opts.map(o=>`<option value="${o}" ${p.base_month===o?'selected':''}>${_nrrGovMonthLabel(o)}</option>`).join('')}
          </select></div>
          <div class="comm-field"><label>Status</label><select class="comm-select" onchange="onNrrPolicyChange('${m}','status',this.value)">
            <option value="draft" ${p.status==='draft'?'selected':''}>Draft</option>
            <option value="published" ${p.status==='published'?'selected':''}>Published</option>
          </select></div>
          <div class="comm-field"><label>Scope</label><input class="comm-input" value="All teams" disabled></div>
        </div>
      </div>`;
    }).join('')}
    <div class="comm-card" style="margin-top:12px;border:1.5px solid rgba(255,210,80,.18);background:rgba(255,200,60,.04)">
      <div class="comm-card-top">
        <div>
          <div class="comm-name" style="color:#f0c040">Commission Mode — Q3 2026</div>
          <div class="comm-meta">NRR + Expansion + Upsell P1/P3 ใช้ base ไหน &middot; Handover ใช้ MoM เสมอ</div>
        </div>
        <span class="comm-badge" style="background:rgba(255,200,60,.15);color:#f0c040">ก.ค.&ndash;ก.ย.</span>
      </div>
      <div class="comm-grid2" style="margin-top:10px">
        <div class="comm-field" style="grid-column:1/-1">
          <label>Mode</label>
          <div style="display:flex;gap:16px;margin-top:6px;align-items:center">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:var(--text-base);color:rgba(255,255,255,.75)">
              <input type="radio" name="comm_mode_q3" value="monthly"
                ${(_nrrGovGetQuarterlyMode()||'monthly')==='monthly'?'checked':''}
                onchange="onNrrPolicyChangeMode('monthly')">
              Monthly (Rolling MoM)
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:var(--text-base);color:rgba(255,255,255,.75)">
              <input type="radio" name="comm_mode_q3" value="quarterly"
                ${(_nrrGovGetQuarterlyMode()||'monthly')==='quarterly'?'checked':''}
                onchange="onNrrPolicyChangeMode('quarterly')">
              Quarterly (Fixed Base มิ.ย.)
            </label>
          </div>
        </div>
        <div class="comm-field">
          <label>NRR &amp; Expansion</label>
          <div class="comm-input" style="color:rgba(255,255,255,.55)">${(_nrrGovGetQuarterlyMode()||'monthly')==='quarterly'?'vs มิ.ย. 2569 (fixed ตลอด Q3)':'Rolling vs เดือนก่อน'}</div>
        </div>
        <div class="comm-field">
          <label>Upsell P1/P3</label>
          <div class="comm-input" style="color:rgba(255,255,255,.55)">${(_nrrGovGetQuarterlyMode()||'monthly')==='quarterly'?'3M lookback จาก มิ.ย. (pin ตลอด Q3)':'Rolling 3M'}</div>
        </div>
        <div class="comm-field" style="grid-column:1/-1">
          <label>Handover</label>
          <div class="comm-input" style="color:rgba(255,255,255,.52)">&#128274; Monthly เสมอ — ไม่ขึ้นกับ mode (by design)</div>
        </div>
      </div>
    </div>`;
}
// v878 (phase 6): role-wide default scheme selector for the 6 roles beyond
// tl/kam (pm/admin/sales/sales_tl/ad/ad_tl) — no per-person roster source
// exists client-side for these roles yet (portviewBulkData is KAM/TL-only),
// so this section only exposes the ROLE-LEVEL default (assignment_scope=
// 'role_default', assignee_key=the role bucket itself), not per-person
// override — that stays a future enhancement once a people-by-role source
// is wired in. A role default here is a real no-op today for kam/tl (their
// existing per-person assignments always win first, per
// _commGetAssignmentPlan's 3-tier resolution) and is the ONLY lever for the
// other 6 roles until someone is individually assigned.
const _COMM_OTHER_ROLES = ['pm','admin','sales','sales_tl','ad','ad_tl'];
function _renderCommRoleDefaultsSection(period, isUnsaved) {
  const cards = _COMM_OTHER_ROLES.map(role => {
    const plans = _commRulesForRole(role, { activeOnly:true });
    const currentCode = _commGetAssignmentPlan(period, 'role_default', role, role);
    const unsaved = isUnsaved('role_default', role);
    const label = _commPlanName(role).replace(' NRR Standard', '');
    return `<div class="comm-card">
      <div class="comm-card-top"><div><div class="comm-name">${label}${unsaved?'<span class="comm-unsaved">Unsaved</span>':''}</div><div class="comm-meta">Role default · ใช้ก็ต่อเมื่อคนนั้นไม่มี assignment ส่วนตัว</div></div><span class="comm-badge blue">${role.toUpperCase()}</span></div>
      <div class="comm-field" style="margin-top:10px"><label>Default scheme สำหรับ role นี้</label>
        <select class="comm-select" onchange="_commSetAssignment('${period}','role_default','${role}',this.value);this.classList.add('flash')">
          ${plans.map(p=>`<option value="${p.plan_code}" ${currentCode===p.plan_code?'selected':''}>${p.plan_name || p.plan_code}</option>`).join('')}
        </select>
      </div>
      <div class="comm-assignment-summary">ยังไม่มี Rule เฉพาะสำหรับ role นี้? ไป Step 3 Rules → Create Rule แล้วกลับมาเลือกที่นี่</div>
    </div>`;
  }).join('');
  return `<div class="comm-section-title">Role defaults — PM / Admin / Sales / AD</div>${cards}`;
}

// ══════════════════════════════════════════════════════════════
// SECTION:COMMISSION_SETUP (Commission Setup redesign, phase 2)
// Role-first home: one honest status per role, no synthesized-but-
// real-looking placeholders. _commRulesForRole/_commGetDraftByCode both
// inject a synthetic bootstrap entry for dropdown convenience (exactly the
// pattern that confused Bush originally) — this section deliberately does
// NOT reuse those for status detection; it checks real saved/pending state
// directly instead.
const _ALL_ROLES = ['kam', 'tl', ..._COMM_OTHER_ROLES];

function _commRoleHasRealNrrTiers(planCode) {
  const plan = ((_commRuleConfig && _commRuleConfig.plans) || {})[planCode];
  if (!plan || !plan.id) return false;
  const rule = _commRuleConfig.rules && _commRuleConfig.rules[plan.id];
  const tiers = rule && _commRuleConfig.tiers ? (_commRuleConfig.tiers[rule.id] || []) : [];
  return tiers.length > 0;
}
const _COMM_SETUP_COMPONENT_METRICS = [
  ['portfolio_gate', null], ['tl_upsell_mult', null],
  ['upsell_gmv', 'p1_new_sku'], ['upsell_gmv', 'p3_growth'], ['upsell_gmv', 'outlet_expansion'],
  ['handover', null],
];
function _commRoleHasAnySavedComponent(planCode) {
  if (_commRoleHasRealNrrTiers(planCode)) return true;
  return _COMM_SETUP_COMPONENT_METRICS.some(([mc, variant]) => {
    const found = (typeof _commGetRuleForMetric === 'function') ? _commGetRuleForMetric(planCode, mc, variant) : null;
    if (!found || found.active === false) return false;
    return (Array.isArray(found.tiers) && found.tiers.length > 0) || !!found.tier_config;
  });
}
function _commRoleHasAnyPendingComponent(planCode) {
  if (_commRulePending && _commRulePending[planCode]) return true;
  return Object.keys(_commComponentRulePending || {}).some(k => k.indexOf(planCode + '|') === 0);
}
// Real status for the role's OWN default scheme — 'active' only once a real
// saved plan+component exists; 'draft' if something's staged but not saved;
// 'not_set' otherwise. Never returns 'active' for the synthetic bootstrap
// placeholder alone (matches _commPlanCode(role)'s fallback name but has no
// real row) — that placeholder exists only so dropdowns aren't empty, not as
// a signal that anything is actually configured.
function _commRoleSetupStatus(role) {
  const period = _nrrExclusionCurrentPeriod();
  const planCode = _commGetAssignmentPlan(period, 'role_default', role, role);
  const realPlan = ((_commRuleConfig && _commRuleConfig.plans) || {})[planCode];
  const isRealSavedPlan = !!(realPlan && realPlan.id);
  const rawStatus = isRealSavedPlan ? (realPlan.status || 'active') : null;
  const isArchived = rawStatus === 'inactive' || rawStatus === 'archived';
  const hasSaved = isRealSavedPlan && !isArchived && _commRoleHasAnySavedComponent(planCode);
  const hasPending = _commRoleHasAnyPendingComponent(planCode);
  let state = 'not_set';
  if (hasSaved) state = 'active';
  else if (hasPending) state = 'draft';
  return { planCode, state };
}
function _commRolePeopleCount(role) {
  if (role === 'kam') return (typeof _buildKamGroups === 'function') ? (_buildKamGroups() || []).length : 0;
  if (role === 'tl') return (typeof _commGetTlListFromPortview === 'function') ? (_commGetTlListFromPortview() || []).length : 0;
  return (_commOtherRoleRoster || []).filter(p => p.role === role).length;
}
const _COMM_ROLE_LABEL = { kam:'KAM', tl:'Team Lead', pm:'PM', admin:'Admin', sales:'Sales', sales_tl:'Sales TL', ad:'AD', ad_tl:'AD TL' };

function renderCommSetupStep(body) {
  if (_commSetupDetailRole) return renderCommRoleDetail(body, _commSetupDetailRole);
  const cards = _ALL_ROLES.map(role => {
    const { state } = _commRoleSetupStatus(role);
    const people = _commRolePeopleCount(role);
    const badgeClass = state === 'active' ? 'ok' : state === 'draft' ? 'warn' : '';
    const badgeLabel = state === 'active' ? 'Active' : state === 'draft' ? 'Draft' : 'Not set up';
    const peopleLbl = people === 1 ? '1 คน' : `${people} คน`;
    return `<div class="comm-rule-item comm-role-card" onclick="_commOpenRoleDetail('${role}')">
      <div class="comm-role-card-top">
        <div class="comm-rule-item-name">${_COMM_ROLE_LABEL[role] || role.toUpperCase()}</div>
        <span class="comm-badge ${badgeClass}">${badgeLabel}</span>
      </div>
      <div class="comm-rule-item-meta">${peopleLbl}${people === 0 ? ' — ยังไม่มีคนใน role นี้' : ''}</div>
    </div>`;
  }).join('');
  body.innerHTML = `
    <div class="comm-hero">
      <div class="comm-hero-top">
        <div><div class="comm-hero-title">Commission Setup</div><div class="comm-hero-sub">เลือก role แล้วตั้งค่าว่าได้ค่าคอมฯ อะไรบ้าง — ครบในหน้าเดียว</div></div>
      </div>
    </div>
    <div class="comm-role-grid">${cards}</div>
  `;
}
window._commOpenRoleDetail = function(role) {
  _commSetupDetailRole = role;
  _commCockpitStep = 'setup';
  renderCommissionCockpit();
};
window._commCloseRoleDetail = function() {
  _commSetupDetailRole = null;
  renderCommissionCockpit();
};
let _commSetupDetailRole = null;

// Pick one real person currently in this role to preview against — first
// match is enough (the goal is "does this look right", not a full roster
// audit). Returns null if nobody is in the role yet (e.g. AD/AD TL today).
function _commRolePreviewPerson(role) {
  if (role === 'kam') {
    const groups = (typeof _buildKamGroups === 'function') ? (_buildKamGroups() || []) : [];
    const g = groups.find(x => x.kamEmail);
    return g ? { email: g.kamEmail, name: g.kamName || g.kamEmail } : null;
  }
  if (role === 'tl') {
    const tls = (typeof _commGetTlListFromPortview === 'function') ? (_commGetTlListFromPortview() || []) : [];
    const t = tls.find(x => x.email);
    return t ? { email: t.email, name: t.name || t.email } : null;
  }
  const p = (_commOtherRoleRoster || []).find(x => x.email);
  return p ? { email: p.email, name: p.name || p.email } : null;
}
// Draft-aware preview card — reuses _commBuildKamPayoutPreview/
// _commBuildTlPayoutPreview (Phase 1) so this updates live as NRR tiers
// (and, from Phase 4 onward, other components) are edited, before Save.
function _renderRoleLivePreview(role, person) {
  const isTl = role === 'tl';
  let payout = null;
  try {
    payout = isTl ? _commBuildTlPayoutPreview(person.email) : _commBuildKamPayoutPreview(person.email, role);
  } catch(e) { console.warn('[Commission Setup] preview failed', e); }
  const amt = payout ? Number(payout.final_payout || 0) : 0;
  const nrrPct = payout ? _commFmtPct(payout.nrr_pct) : '—';
  return `<div class="comm-card comm-role-preview">
    <div class="comm-role-preview-label">Live preview — คนจริง, อัตราที่ยังไม่ save</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div><div class="comm-name">${_commEscapeHtml(person.name)}</div><div class="comm-meta">NRR ${nrrPct}</div></div>
      <div class="comm-role-preview-amt">${_commFmtPayout(amt)}</div>
    </div>
  </div>`;
}
// Master on/off toggle. Turning ON a role with nothing real/staged yet is a
// pure staging operation (_commSetDraftByCode + _commSetAssignment),
// deferred to the existing global "Save changes" button — mirrors how
// _commCloneLocalPlan already stages a brand-new plan without any eager DB
// write, so an abandoned edit never leaves an orphan row behind. Turning
// OFF a real, already-saved scheme reuses the existing, tested
// archiveCommissionRule() flow (confirm dialog + usage-count check) rather
// than inventing a second, parallel deactivation path.
function _commRoleSetupToggle(role, planCode) {
  const { state } = _commRoleSetupStatus(role);
  if (state === 'active') {
    archiveCommissionRule(planCode);
    return;
  }
  const draft = _commGetDraftByCode(planCode, role);
  draft.beneficiary_role = role;
  draft.plan_name = draft.plan_name || _commPlanName(role);
  _commSetDraftByCode(planCode, draft);
  _commSetAssignment(_nrrExclusionCurrentPeriod(), 'role_default', role, planCode);
  _commMarkChanged();
  renderCommissionCockpit();
}
window._commRoleSetupToggle = _commRoleSetupToggle;

// v879 (Commission Setup redesign, phase 7): "N people on a custom rate"
// subordinate section — counts real per-person overrides (assignment_scope
// === the role bucket itself, e.g. 'kam'/'pm' — the same scope
// _commSetAssignment('kam', kamEmail, ...) already uses today), and deep-
// links into the existing Advanced (Assignment) tab rather than rebuilding
// a second per-person assignment UI. Zero new assignment logic — reuses
// what's already there.
function _commRoleOverrideCount(role) {
  const period = _nrrExclusionCurrentPeriod();
  return ((_commRuleConfig && _commRuleConfig.assignments) || [])
    .filter(a => a.period_month === period && a.assignment_scope === role).length;
}
window._commGoToAdvancedAssignment = function() {
  switchCommissionStep('assignment');
};

function renderCommRoleDetail(body, role) {
  const { planCode, state } = _commRoleSetupStatus(role);
  const people = _commRolePeopleCount(role);
  const isOn = state === 'active' || state === 'draft';
  const roleLabel = _COMM_ROLE_LABEL[role] || role.toUpperCase();
  const previewPerson = isOn ? _commRolePreviewPerson(role) : null;
  // v879: matches the ENGINE's actual branching (_commBuildTlPayout vs
  // _commBuildKamPayout), not a role-name guess. Only the literal 'tl' role
  // uses _commBuildTlPayout (NRR tiers + TL-mult only, no Gate/Handover/
  // Upsell — that function never calls those compute functions at all).
  // Every other role (including sales_tl/ad_tl, per Phase 8's design) goes
  // through _commBuildKamPayout instead, which supports the full component
  // set except TL-mult. Showing the wrong editor for a role would silently
  // do nothing when saved — worse than the confusing-placeholder bug this
  // whole redesign exists to fix.
  const isTl = role === 'tl';

  const gateBody = isOn
    ? `${roleLabel} ได้ค่าคอมฯ — ตั้งค่า component ด้านล่าง`
    : `ปิดอยู่ — ${roleLabel} ได้ ฿0 ทุกคนจนกว่าจะเปิด`;

  body.innerHTML = `
    <div class="comm-hero">
      <div class="comm-hero-top">
        <div>
          <button class="comm-role-back-btn" onclick="_commCloseRoleDetail()" style="margin-bottom:8px">‹ Commission Setup</button>
          <div class="comm-hero-title">${roleLabel}</div>
          <div class="comm-hero-sub">${people} คนใน role นี้</div>
        </div>
      </div>
    </div>
    <div class="comm-card comm-role-gate">
      <div><div class="comm-name">Role นี้ได้ค่าคอมฯ ไหม?</div><div class="comm-meta">${gateBody}</div></div>
      <button class="comm-role-toggle ${isOn ? 'on' : ''}" onclick="_commRoleSetupToggle('${role}','${planCode}')"></button>
    </div>
    ${isOn ? `
      <div class="comm-section-title">NRR tiers</div>
      ${_renderCommRuleEditorByCode(planCode, role)}
      ${isTl ? `
        <div class="comm-section-title">TL Upsell Multiplier</div>
        ${_renderRoleTierLadderEditor(planCode, 'tl_upsell_mult', {
          title: 'TL Upsell Multiplier', unitLabel: 'Upsell%', accentColor: 'rgba(120,200,255,.85)',
          emptyNote: 'ยังไม่มี tier — multiplier default ×1.0 เสมอ'
        })}
      ` : `
        <div class="comm-section-title">Handover</div>
        ${_renderRoleHandoverEditor(planCode)}
        <div class="comm-section-title">NRR / GMV Gate</div>
        ${_renderRoleTierLadderEditor(planCode, 'portfolio_gate', {
          title: 'NRR / GMV Gate', unitLabel: 'NRR%', accentColor: 'rgba(255,140,110,.85)',
          emptyNote: 'ยังไม่มี Gate tier — role นี้จะไม่ถูกหักค่าคอมฯ เลย (cap ×1.0 เสมอ) จนกว่าจะเพิ่ม tier'
        })}
        <div class="comm-section-title">Upsell — สินค้าใหม่ (P1)</div>
        ${_renderRoleUpsellRateEditor(planCode, 'p1_new_sku', {
          title: 'Upsell P1 — สินค้าใหม่', accentColor: 'rgba(255,224,138,.85)', showMinGmv: true
        })}
        <div class="comm-section-title">Upsell — ยอดเติบโต (P3)</div>
        ${_renderRoleUpsellRateEditor(planCode, 'p3_growth', {
          title: 'Upsell P3 — ยอดเติบโต', accentColor: 'rgba(255,224,138,.85)', showGrowthParams: true
        })}
        <div class="comm-section-title">Expansion (ร้านขยาย)</div>
        ${_renderRoleUpsellRateEditor(planCode, 'outlet_expansion', {
          title: 'Expansion — ร้านขยาย', accentColor: 'rgba(0,200,176,.85)'
        })}
        <div class="comm-section-title">โบนัสตามกลุ่มสินค้า (P1 + P3)</div>
        ${_renderRoleUpsellCategoryBonusEditor(planCode)}
      `}
      ${previewPerson ? _renderRoleLivePreview(role, previewPerson) : `<div class="comm-empty">ยังไม่มีคนใน role นี้ให้ preview</div>`}
      <div class="comm-role-override-row">
        <div class="comm-meta">${_commRoleOverrideCount(role)} คนใช้ rate เฉพาะตัว (ไม่ใช้ default ของ role นี้)</div>
        <button class="comm-role-override-link" onclick="_commGoToAdvancedAssignment()">+ ตั้งค่าเฉพาะคน ›</button>
      </div>
    ` : `<div class="comm-empty">เปิด role นี้เพื่อเริ่มตั้งค่า NRR tiers และดู live preview</div>`}
  `;
}

function renderCommAssignmentStep(body) {
  const period = _nrrExclusionCurrentPeriod();
  const tls = _commGetTlListFromPortview();
  const groups = (typeof _buildKamGroups === 'function') ? (_buildKamGroups() || []) : [];
  const tlPlans = _commRulesForRole('tl', { activeOnly:true });
  const kamPlans = _commRulesForRole('kam', { activeOnly:true });
  const isUnsaved = (scope, assignee) => !!_commAssignmentPending[_commAssignmentKey(period, scope, assignee)];
  body.innerHTML = `
    <div class="comm-hero">
      <div class="comm-hero-top">
        <div><div class="comm-hero-title">2. Assign Rules</div><div class="comm-hero-sub">เลือกว่าคนไหนใช้ NRR criteria ชุดไหน Rules ถูกสร้าง/แก้ใน Step 3</div></div>
        <span class="comm-badge ${Object.keys(_commAssignmentPending||{}).length?'dirty':'blue'}">${Object.keys(_commAssignmentPending||{}).length?Object.keys(_commAssignmentPending||{}).length+' unsaved':_nrrGovMonthLabel(period)}</span>
      </div>
      <div class="comm-readiness-bar ${Object.keys(_commAssignmentPending||{}).length?'warn':'ready'}"><span class="comm-readiness-dot"></span><div class="comm-readiness-copy">${Object.keys(_commAssignmentPending||{}).length?'มี assignment change ที่ยังไม่ได้ save':'Assignments ใช้ active rules เท่านั้น · inactive rules ถูกซ่อนแล้ว'}</div></div>
    </div>
    ${_renderCommRoleDefaultsSection(period, isUnsaved)}
    <div class="comm-section-title">Team Lead rules</div>
    ${tls.map(t=>`<div class="comm-card">
      <div class="comm-card-top"><div><div class="comm-name">${t.name||t.email}${isUnsaved('tl',t.email)?'<span class="comm-unsaved">Unsaved</span>':''}</div><div class="comm-meta">${t.email}</div></div><span class="comm-badge blue">TL</span></div>
      <div class="comm-field" style="margin-top:10px"><label>Assigned TL rule</label><select class="comm-select" onchange="_commSetAssignment('${period}','tl','${t.email}',this.value);this.classList.add('flash')">
        ${tlPlans.map(p=>`<option value="${p.plan_code}" ${_commGetAssignmentPlan(period,'tl',t.email,'tl')===p.plan_code?'selected':''}>${p.plan_name || p.plan_code}</option>`).join('')}
      </select></div>
      <div class="comm-assignment-summary">ถ้าต้องการ criteria ใหม่ ให้ไป Step 3 Rules → Create TL Rule แล้วกลับมาเลือกที่นี่</div>
    </div>`).join('') || `<div class="comm-empty">ไม่พบ TL</div>`}
    <div class="comm-section-title">KAM rules by team</div>
    ${tls.map(t=>{
      const kams = groups.filter(g => (g.accounts||[]).some(a=>a.tlEmail===t.email));
      return `<div class="comm-card comm-team-card">
        <div class="comm-team-header"><div><div class="comm-name">${t.name||t.email}</div><div class="comm-meta">${kams.length} KAM under team</div></div></div>
        ${kams.map(g=>`<div class="comm-person-row">
          <div><div class="comm-person-name">${g.kamName||g.kamEmail}${isUnsaved('kam',g.kamEmail)?'<span class="comm-unsaved">Unsaved</span>':''}</div><div class="comm-person-sub">${g.kamEmail}</div></div>
          <select class="comm-select" onchange="_commSetAssignment('${period}','kam','${g.kamEmail}',this.value);this.classList.add('flash')">
            ${kamPlans.map(p=>`<option value="${p.plan_code}" ${_commGetAssignmentPlan(period,'kam',g.kamEmail,'kam')===p.plan_code?'selected':''}>${p.plan_name || p.plan_code}</option>`).join('')}
          </select>
        </div>`).join('') || `<div class="comm-empty">ไม่มี KAM ใต้ทีมนี้</div>`}
      </div>`;
    }).join('')}`;
}

// v226: Component Rates editor — admin-configurable params for Upsell SKU / Outlet / Handover / Gate / TL Mult
// Reads/writes to commission_rules params jsonb via _commGetConfig
// UI uses the same _commRuleConfig cache; on save calls saveCommissionComponentRates()
function _renderComponentRatesEditor() {
  const c = (k,p,d) => { try{ const v=_commGetConfig(k,p,d); return v!=null?v:d; }catch(e){return d;} };
  const fB = n => '฿'+Math.round(Number(n||0)).toLocaleString('en-US');
  const fP = n => (Math.round(Number(n||0)*1000)/10)+'%'; // v92-fix: was whole-number round (1.5% showed as "2%")

  function rateCard(title, color, fields, note) {
    const flds = fields.map(([lbl,k,p,def,step,unit]) => {
      const v = c(k,p,def);
      const isPctD = unit==='pct-d';
      const disp = isPctD ? (Math.round(v*10000)/100) : v;
      const uLbl = isPctD?'%':unit==='pct-i'?'%':unit==='mul'?'×':'฿';
      const expr = isPctD?'this.value/100':'Number(this.value)';
      return `<div>
        <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.78);margin-bottom:5px">${lbl}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <input style="flex:1;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(var(--ink-blue),.12);border-radius:var(--r-9);padding:9px 11px;color:rgba(var(--ink-blue-hi),.90);font-size:var(--text-md);font-family:'IBM Plex Mono','Noto Sans Thai',monospace;text-align:right;outline:none" type="number" step="${step||'any'}" value="${disp}"
            oninput="_commSetComponentParam('${k}','${p}',${expr});_commMarkChanged()" onfocus="this.style.borderColor='rgba(var(--ink-blue),.35)'" onblur="this.style.borderColor='rgba(var(--ink-blue),.12)'">
          <span style="font-size:var(--text-sm);color:rgba(var(--ink-blue),.60);flex-shrink:0">${uLbl}</span>
        </div>
      </div>`;
    }).join('');
    return `<div style="border-radius:13px;border:1px solid rgba(var(--ink-blue),.09);background:rgba(255,255,255,.025);padding:13px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px">
        <span style="width:3px;height:16px;border-radius:var(--r-xxs);background:${color};flex-shrink:0"></span>
        <span style="font-size:var(--text-md);font-weight:800;color:rgba(var(--ink-blue-hi),.85)">${title}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:${note?'10':'0'}px">${flds}</div>
      ${note?`<div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.65);line-height:1.6;padding:8px 10px;background:rgba(0,0,0,.20);border-radius:var(--r-8)">${note}</div>`:''}
    </div>`;
  }

  const p1r = c('upsell_sku','p1_rate',0.03); const p3r = c('upsell_sku','p3_rate',0.03);
  const p3t = c('upsell_sku','p3_threshold_pct',2.00); const p1mg = c('upsell_sku','p1_min_gmv',5000);
  const p3mi = c('upsell_sku','p3_min_incremental',8000);
  const outr = c('upsell_outlet','rate',0.015);
  const gt1 = c('gmv_gate','threshold_1',95); const gt2 = c('gmv_gate','threshold_2',90);
  const gc1 = c('gmv_gate','cap_1',0.70); const gc2 = c('gmv_gate','cap_2',0.35);

  return rateCard('สินค้าใหม่ + ยอดเติบโต (P1 / P3)', '#ffe08a', [
      ['P1 rate — กลุ่มสินค้าใหม่','upsell_sku','p1_rate',0.03,0.005,'pct-d'],
      ['P1 min GMV ต่อกลุ่มสินค้า','upsell_sku','p1_min_gmv',5000,100,'฿'],
      ['P3 rate — ยอดเติบโต','upsell_sku','p3_rate',0.03,0.005,'pct-d'],
      ['P3 threshold (เติบโตกี่เท่า)','upsell_sku','p3_threshold_pct',2.00,0.05,'mul'],
      ['P3 min incremental','upsell_sku','p3_min_incremental',8000,100,'฿'],
    ],
    `P1: กลุ่มสินค้าที่ outlet ไม่เคยซื้อมาก่อน → GMV ≥ ${fB(p1mg)} → ได้ ${fP(p1r)} · P3: กลุ่มที่เคยซื้อแล้ว ยอดโตเกิน ${p3t}× baseline และ incremental ≥ ${fB(p3mi)} → ได้ ${fP(p3r)} × incremental`
  )
  + rateCard('Expansion (สาขาใหม่)', '#00c8b0', [
      ['Expansion rate','upsell_outlet','rate',0.015,0.005,'pct-d'],
    ],
    `outlet ที่ไม่เคยซื้อมาก่อนเลย (first purchase date) → GMV ทั้งหมด × ${Math.round(outr*1000)/10}% · ไม่แบ่ง P1/P3`
  )
  + _renderHandoverGmvTierEditor()
  + rateCard('NRR Gate (KAM เท่านั้น)', 'rgba(255,107,61,.80)', [
      ['เกณฑ์ผ่าน full (%)','gmv_gate','threshold_1',95,1,'pct-i'],
      ['Cap เมื่อต่ำกว่าเกณฑ์ผ่าน','gmv_gate','cap_1',0.70,0.05,'mul'],
      ['เกณฑ์ขั้นต่ำ (%)','gmv_gate','threshold_2',90,1,'pct-i'],
      ['Cap เมื่อต่ำมาก','gmv_gate','cap_2',0.35,0.05,'mul'],
    ],
    `≥ ${gt1}% = ×1.00 · ${gt2}–${gt1}% = ×${gc1} · < ${gt2}% = ×${gc2} · คูณกับยอดรวมทั้งหมดก่อน lock`
  );
}

// ── Handover GMV-tier editor (v91) ────────────────────────────────────
// Two-level: a card per GMV tier, each containing its own retention%→payout
// threshold ladder. Replaces the old flat 4-scalar rate card (tier2_pct/
// tier2_payout/tier3_pct/tier3_bonus) — those legacy keys stay in
// target_settings untouched (engine falls back to them when gmv_tiers is
// empty) so this is purely additive.
//
// Staged as a WHOLE ARRAY unit in _commComponentPending.handover.gmv_tiers
// (see _commHandoverGmvTiersStage below) — NOT through _commSetComponentParam,
// which does Number(value) per scalar field and would coerce an array to NaN.
// Visually modeled on _renderCommRuleEditorByCode's tier cards (reuses the
// same inpBase/inpPay input styles) but do NOT copy _renderTlUpsellTierRows'
// wiring — that pattern is already broken/unused, kept only as a layout
// reference elsewhere in this file.
let _commHandoverGmvTiersDraft = null;

function _commHandoverGmvTiersLive() {
  try {
    const raw = _tgtSettings && _tgtSettings['handover_params'];
    const params = raw ? (typeof raw === 'object' ? raw : JSON.parse(raw)) : null;
    return (params && Array.isArray(params.gmv_tiers)) ? params.gmv_tiers : [];
  } catch(e) { return []; }
}
function _commHandoverGmvTiersGetDraft() {
  if (_commHandoverGmvTiersDraft === null) {
    const pending = _commComponentPending.handover && _commComponentPending.handover.gmv_tiers;
    const src = pending || _commHandoverGmvTiersLive();
    _commHandoverGmvTiersDraft = JSON.parse(JSON.stringify(src));
  }
  return _commHandoverGmvTiersDraft;
}
function _commHandoverGmvTiersStage() {
  if (!_commComponentPending.handover) _commComponentPending.handover = {};
  _commComponentPending.handover.gmv_tiers = _commHandoverGmvTiersDraft;
  _commMarkChanged();
}
function _commAddHandoverGmvTier() {
  const tiers = _commHandoverGmvTiersGetDraft();
  tiers.push({ tier_order: tiers.length + 1, gmv_min: 0, gmv_max: null, label: '',
               thresholds: [{ min_retention_pct: 100, payout: 0 }] });
  _commHandoverGmvTiersStage();
  renderCommissionCockpit();
}
function _commRemoveHandoverGmvTier(tierIdx) {
  const tiers = _commHandoverGmvTiersGetDraft();
  tiers.splice(tierIdx, 1);
  _commHandoverGmvTiersStage();
  renderCommissionCockpit();
}
function _commAddHandoverThreshold(tierIdx) {
  const tiers = _commHandoverGmvTiersGetDraft();
  if (!tiers[tierIdx]) return;
  if (!tiers[tierIdx].thresholds) tiers[tierIdx].thresholds = [];
  tiers[tierIdx].thresholds.push({ min_retention_pct: 100, payout: 0 });
  _commHandoverGmvTiersStage();
  renderCommissionCockpit();
}
function _commRemoveHandoverThreshold(tierIdx, threshIdx) {
  const tiers = _commHandoverGmvTiersGetDraft();
  if (!tiers[tierIdx] || !tiers[tierIdx].thresholds) return;
  tiers[tierIdx].thresholds.splice(threshIdx, 1);
  _commHandoverGmvTiersStage();
  renderCommissionCockpit();
}
function _commSetHandoverField(tierIdx, threshIdx, field, value) {
  const tiers = _commHandoverGmvTiersGetDraft();
  const t = tiers[tierIdx];
  if (!t) return;
  if (threshIdx === null || threshIdx === undefined) {
    if (field === 'label') t.label = value;
    else t[field] = value === '' ? null : Number(value);
  } else {
    const th = (t.thresholds || [])[threshIdx];
    if (!th) return;
    th[field] = value === '' ? null : Number(value);
  }
  _commHandoverGmvTiersStage();
}
window._commAddHandoverGmvTier = _commAddHandoverGmvTier;
window._commRemoveHandoverGmvTier = _commRemoveHandoverGmvTier;
window._commAddHandoverThreshold = _commAddHandoverThreshold;
window._commRemoveHandoverThreshold = _commRemoveHandoverThreshold;
window._commSetHandoverField = _commSetHandoverField;

// Advisory-only checks (this file's save pipeline, saveCommissionComponentRates,
// is shared across 4 unrelated metrics — hard-blocking it on a Handover typo
// would also block saving unrelated Upsell/Gate edits, so these render as a
// visible warning banner rather than a save-blocking gate).
function _commValidateHandoverGmvTiers(tiers) {
  const errs = [];
  const sorted = tiers.map((t, i) => ({ t, i })).slice()
    .sort((a, b) => Number(a.t.gmv_min || 0) - Number(b.t.gmv_min || 0));
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i].t;
    const label = t.label || ('Tier ' + (sorted[i].i + 1));
    const min = Number(t.gmv_min || 0);
    const max = (t.gmv_max === null || t.gmv_max === undefined || t.gmv_max === '') ? null : Number(t.gmv_max);
    if (max != null && max <= min) errs.push(`"${label}": ค่า "ถึง" ต้องมากกว่า "ตั้งแต่"`);
    const next = sorted[i + 1];
    if (next && (max == null || max >= Number(next.t.gmv_min || 0))) {
      errs.push(`"${label}" ทับซ้อนช่วง GMV กับ "${next.t.label || ('Tier ' + (next.i + 1))}"`);
    }
    const seen = {};
    (t.thresholds || []).forEach(th => {
      const key = Number(th.min_retention_pct || 0);
      if (seen[key]) errs.push(`"${label}": มี threshold retention ≥${key}% ซ้ำกัน`);
      seen[key] = true;
    });
  }
  return errs;
}

function _renderHandoverGmvTierEditor() {
  const tiers = _commHandoverGmvTiersGetDraft();
  const inpBase = 'background:rgba(255,255,255,.08);border:1px solid rgba(var(--ink-blue),.18);border-radius:var(--r-9);padding:8px 11px;color:#e8eeff;font-size:var(--text-md);font-family:\'IBM Plex Mono\',monospace;text-align:right;outline:none;width:100%';
  const inpLbl  = 'background:rgba(255,255,255,.08);border:1px solid rgba(var(--ink-blue),.18);border-radius:var(--r-9);padding:8px 11px;color:#e8eeff;font-size:var(--text-md);font-family:var(--tk-font-body),system-ui,sans-serif;text-align:left;outline:none;width:100%';
  const inpPay  = 'background:rgba(255,224,138,.08);border:1px solid rgba(255,224,138,.28);border-radius:var(--r-9);padding:9px 11px;color:#ffe08a;font-size:var(--text-base);font-weight:800;font-family:\'IBM Plex Mono\',monospace;text-align:right;outline:none;width:100%';
  const fB = n => '฿'+Math.round(Number(n||0)).toLocaleString('en-US');

  const tierCards = tiers.map((t, ti) => {
    const gmvMax = t.gmv_max;
    const rangeLbl = gmvMax == null ? `≥ ${fB(t.gmv_min)}` : `${fB(t.gmv_min)}–${fB(gmvMax)}`;
    const threshRows = (t.thresholds || []).map((th, thi) => `
      <div style="display:flex;align-items:flex-end;gap:7px;margin-bottom:6px">
        <div style="flex:1">
          <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">Retention ตั้งแต่ (%)</div>
          <input style="${inpBase}" value="${th.min_retention_pct ?? ''}" inputmode="decimal"
            oninput="_commSetHandoverField(${ti},${thi},'min_retention_pct',this.value)">
        </div>
        <div style="flex:1">
          <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(255,224,138,.85);margin-bottom:3px">ได้รับ (฿)</div>
          <input style="${inpPay}" value="${th.payout ?? 0}" inputmode="numeric"
            oninput="_commSetHandoverField(${ti},${thi},'payout',this.value)">
        </div>
        <button onclick="_commRemoveHandoverThreshold(${ti},${thi})" style="font-size:var(--text-lg);color:var(--tk-text-faint);background:none;border:none;cursor:pointer;padding:8px 4px" onmouseover="this.style.color='rgba(255,80,60,.70)'" onmouseout="this.style.color='rgba(255,255,255,.25)'">×</button>
      </div>`).join('');

    return `<div style="border-radius:var(--r-card);border:1px solid rgba(var(--ink-blue),.14);background:rgba(255,255,255,.03);padding:12px;margin-bottom:9px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">
        <span style="font-size:var(--text-sm);font-weight:800;color:rgba(var(--ink-blue),.85);font-family:'IBM Plex Mono',monospace">GMV ${rangeLbl}</span>
        <button onclick="_commRemoveHandoverGmvTier(${ti})" style="font-size:var(--text-lg2);color:rgba(255,255,255,.52);background:none;border:none;cursor:pointer;padding:0 4px" onmouseover="this.style.color='rgba(255,80,60,.75)'" onmouseout="this.style.color='rgba(255,255,255,.28)'">×</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:7px">
        <div>
          <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">GMV ตั้งแต่ (฿)</div>
          <input style="${inpBase}" value="${t.gmv_min ?? ''}" inputmode="numeric"
            oninput="_commSetHandoverField(${ti},null,'gmv_min',this.value)">
        </div>
        <div>
          <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">ถึง (฿) — ว่าง=∞</div>
          <input style="${inpBase}" value="${gmvMax ?? ''}" placeholder="∞" inputmode="numeric"
            oninput="_commSetHandoverField(${ti},null,'gmv_max',this.value)">
        </div>
      </div>
      <div style="margin-bottom:9px">
        <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">ชื่อ tier</div>
        <input style="${inpLbl}" value="${_commEscapeHtml(t.label||'')}" placeholder="เช่น 20,000–49,999"
          oninput="_commSetHandoverField(${ti},null,'label',this.value)">
      </div>
      ${threshRows}
      <button onclick="_commAddHandoverThreshold(${ti})" style="width:100%;padding:7px;border-radius:var(--r-8);background:rgba(var(--ink-blue),.05);border:1px dashed rgba(var(--ink-blue),.20);color:rgba(var(--ink-blue),.65);font-size:var(--text-sm);font-weight:var(--fw-bold);cursor:pointer;margin-top:2px">+ เพิ่ม threshold</button>
    </div>`;
  }).join('');

  const errs = _commValidateHandoverGmvTiers(tiers);
  const errHtml = errs.length ? `<div style="font-size:var(--text-xs);color:rgba(255,120,80,.90);padding:8px 10px;background:rgba(255,80,60,.10);border-radius:var(--r-8);margin-bottom:9px;line-height:1.6">${errs.map(_commEscapeHtml).join('<br>')}</div>` : '';
  const emptyNote = !tiers.length ? `<div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.55);padding:8px 10px;background:rgba(0,0,0,.20);border-radius:var(--r-8);margin-bottom:9px;line-height:1.6">ยังไม่มี GMV tier — ระบบใช้อัตราเดิม (flat, ไม่มี GMV tier) จนกว่าจะเพิ่ม tier แรก</div>` : '';

  return `<div style="border-radius:13px;border:1px solid rgba(var(--ink-blue),.09);background:rgba(255,255,255,.025);padding:13px;margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px">
      <span style="width:3px;height:16px;border-radius:var(--r-xxs);background:#bcd7ff;flex-shrink:0"></span>
      <span style="font-size:var(--text-md);font-weight:800;color:rgba(var(--ink-blue-hi),.85)">Handover (Sales → KAM) — แบ่งตาม GMV tier</span>
    </div>
    ${errHtml}${emptyNote}${tierCards}
    <button onclick="_commAddHandoverGmvTier()" style="width:100%;padding:10px;border-radius:var(--r-md);background:rgba(var(--ink-blue),.06);border:1px dashed rgba(var(--ink-blue),.22);color:rgba(var(--ink-blue),.70);font-size:var(--text-md);font-weight:var(--fw-bold);cursor:pointer;margin-top:2px">+ เพิ่ม GMV tier</button>
    <div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.45);margin-top:8px;line-height:1.6">ยอด handover ของ KAM (รวมทั้งหมดในงวดนั้น) ต่ำกว่า tier แรกสุด → ได้ ฿0 · Retention คิดจากยอดรวมของ KAM ไม่ใช่รายบัญชี</div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
// SECTION:COMMISSION_SETUP_HANDOVER (Commission Setup redesign, phase 4)
// Per-scheme Handover editor — visually identical to
// _renderHandoverGmvTierEditor above (same markup/inputs/validation), but
// data-sourced from the new per-scheme _commComponentRulePending draft
// (writing tier_config, not the global target_settings blob). Deliberately
// a SEPARATE function, not a parameterized version of the one above — that
// one stays wired to the global blob for the "Advanced" tab, untouched.
function _commRoleHandoverTiers(planCode) {
  const d = _commEnsureComponentDraft(planCode, 'handover', null);
  if (!d.tier_config || !Array.isArray(d.tier_config.gmv_tiers)) d.tier_config = { gmv_tiers: [] };
  return d.tier_config.gmv_tiers;
}
function _commRoleAddHandoverGmvTier(planCode) {
  const tiers = _commRoleHandoverTiers(planCode);
  tiers.push({ tier_order: tiers.length + 1, gmv_min: 0, gmv_max: null, label: '',
               thresholds: [{ min_retention_pct: 100, payout: 0 }] });
  _commMarkChanged();
  renderCommissionCockpit();
}
function _commRoleRemoveHandoverGmvTier(planCode, tierIdx) {
  _commRoleHandoverTiers(planCode).splice(tierIdx, 1);
  _commMarkChanged();
  renderCommissionCockpit();
}
function _commRoleAddHandoverThreshold(planCode, tierIdx) {
  const tiers = _commRoleHandoverTiers(planCode);
  if (!tiers[tierIdx]) return;
  if (!tiers[tierIdx].thresholds) tiers[tierIdx].thresholds = [];
  tiers[tierIdx].thresholds.push({ min_retention_pct: 100, payout: 0 });
  _commMarkChanged();
  renderCommissionCockpit();
}
function _commRoleRemoveHandoverThreshold(planCode, tierIdx, threshIdx) {
  const tiers = _commRoleHandoverTiers(planCode);
  if (!tiers[tierIdx] || !tiers[tierIdx].thresholds) return;
  tiers[tierIdx].thresholds.splice(threshIdx, 1);
  _commMarkChanged();
  renderCommissionCockpit();
}
function _commRoleSetHandoverField(planCode, tierIdx, threshIdx, field, value) {
  const tiers = _commRoleHandoverTiers(planCode);
  const t = tiers[tierIdx];
  if (!t) return;
  if (threshIdx === null || threshIdx === undefined) {
    if (field === 'label') t.label = value;
    else t[field] = value === '' ? null : Number(value);
  } else {
    const th = (t.thresholds || [])[threshIdx];
    if (!th) return;
    th[field] = value === '' ? null : Number(value);
  }
  _commMarkChanged();
}
window._commRoleAddHandoverGmvTier = _commRoleAddHandoverGmvTier;
window._commRoleRemoveHandoverGmvTier = _commRoleRemoveHandoverGmvTier;
window._commRoleAddHandoverThreshold = _commRoleAddHandoverThreshold;
window._commRoleRemoveHandoverThreshold = _commRoleRemoveHandoverThreshold;
window._commRoleSetHandoverField = _commRoleSetHandoverField;

function _renderRoleHandoverEditor(planCode) {
  // Read-only: must NOT stage a pending draft just from rendering, or
  // merely opening this role's page would make "Save changes" write back
  // an unedited/never-configured component (the exact ghost-row bug this
  // redesign exists to eliminate). Staging only happens inside the actual
  // mutators (_commRoleAdd/Remove/SetHandover*), via _commRoleHandoverTiers.
  const draft = _commGetComponentDraft(planCode, 'handover', null);
  const tiers = (draft && draft.tier_config && Array.isArray(draft.tier_config.gmv_tiers)) ? draft.tier_config.gmv_tiers : [];
  const inpBase = 'background:rgba(255,255,255,.08);border:1px solid rgba(var(--ink-blue),.18);border-radius:var(--r-9);padding:8px 11px;color:#e8eeff;font-size:var(--text-md);font-family:\'IBM Plex Mono\',monospace;text-align:right;outline:none;width:100%';
  const inpLbl  = 'background:rgba(255,255,255,.08);border:1px solid rgba(var(--ink-blue),.18);border-radius:var(--r-9);padding:8px 11px;color:#e8eeff;font-size:var(--text-md);font-family:var(--tk-font-body),system-ui,sans-serif;text-align:left;outline:none;width:100%';
  const inpPay  = 'background:rgba(255,224,138,.08);border:1px solid rgba(255,224,138,.28);border-radius:var(--r-9);padding:9px 11px;color:#ffe08a;font-size:var(--text-base);font-weight:800;font-family:\'IBM Plex Mono\',monospace;text-align:right;outline:none;width:100%';
  const fB = n => '฿'+Math.round(Number(n||0)).toLocaleString('en-US');

  const tierCards = tiers.map((t, ti) => {
    const gmvMax = t.gmv_max;
    const rangeLbl = gmvMax == null ? `≥ ${fB(t.gmv_min)}` : `${fB(t.gmv_min)}–${fB(gmvMax)}`;
    const threshRows = (t.thresholds || []).map((th, thi) => `
      <div style="display:flex;align-items:flex-end;gap:7px;margin-bottom:6px">
        <div style="flex:1">
          <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">Retention ตั้งแต่ (%)</div>
          <input style="${inpBase}" value="${th.min_retention_pct ?? ''}" inputmode="decimal"
            oninput="_commRoleSetHandoverField('${planCode}',${ti},${thi},'min_retention_pct',this.value)">
        </div>
        <div style="flex:1">
          <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(255,224,138,.85);margin-bottom:3px">ได้รับ (฿)</div>
          <input style="${inpPay}" value="${th.payout ?? 0}" inputmode="numeric"
            oninput="_commRoleSetHandoverField('${planCode}',${ti},${thi},'payout',this.value)">
        </div>
        <button onclick="_commRoleRemoveHandoverThreshold('${planCode}',${ti},${thi})" style="font-size:var(--text-lg);color:var(--tk-text-faint);background:none;border:none;cursor:pointer;padding:8px 4px" onmouseover="this.style.color='rgba(255,80,60,.70)'" onmouseout="this.style.color='rgba(255,255,255,.25)'">×</button>
      </div>`).join('');

    return `<div style="border-radius:var(--r-card);border:1px solid rgba(var(--ink-blue),.14);background:rgba(255,255,255,.03);padding:12px;margin-bottom:9px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">
        <span style="font-size:var(--text-sm);font-weight:800;color:rgba(var(--ink-blue),.85);font-family:'IBM Plex Mono',monospace">GMV ${rangeLbl}</span>
        <button onclick="_commRoleRemoveHandoverGmvTier('${planCode}',${ti})" style="font-size:var(--text-lg2);color:rgba(255,255,255,.52);background:none;border:none;cursor:pointer;padding:0 4px" onmouseover="this.style.color='rgba(255,80,60,.75)'" onmouseout="this.style.color='rgba(255,255,255,.28)'">×</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:7px">
        <div>
          <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">GMV ตั้งแต่ (฿)</div>
          <input style="${inpBase}" value="${t.gmv_min ?? ''}" inputmode="numeric"
            oninput="_commRoleSetHandoverField('${planCode}',${ti},null,'gmv_min',this.value)">
        </div>
        <div>
          <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">ถึง (฿) — ว่าง=∞</div>
          <input style="${inpBase}" value="${gmvMax ?? ''}" placeholder="∞" inputmode="numeric"
            oninput="_commRoleSetHandoverField('${planCode}',${ti},null,'gmv_max',this.value)">
        </div>
      </div>
      <div style="margin-bottom:9px">
        <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">ชื่อ tier</div>
        <input style="${inpLbl}" value="${_commEscapeHtml(t.label||'')}" placeholder="เช่น 20,000–49,999"
          oninput="_commRoleSetHandoverField('${planCode}',${ti},null,'label',this.value)">
      </div>
      ${threshRows}
      <button onclick="_commRoleAddHandoverThreshold('${planCode}',${ti})" style="width:100%;padding:7px;border-radius:var(--r-8);background:rgba(var(--ink-blue),.05);border:1px dashed rgba(var(--ink-blue),.20);color:rgba(var(--ink-blue),.65);font-size:var(--text-sm);font-weight:var(--fw-bold);cursor:pointer;margin-top:2px">+ เพิ่ม threshold</button>
    </div>`;
  }).join('');

  const errs = _commValidateHandoverGmvTiers(tiers);
  const errHtml = errs.length ? `<div style="font-size:var(--text-xs);color:rgba(255,120,80,.90);padding:8px 10px;background:rgba(255,80,60,.10);border-radius:var(--r-8);margin-bottom:9px;line-height:1.6">${errs.map(_commEscapeHtml).join('<br>')}</div>` : '';
  const emptyNote = !tiers.length ? `<div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.55);padding:8px 10px;background:rgba(0,0,0,.20);border-radius:var(--r-8);margin-bottom:9px;line-height:1.6">ยังไม่มี GMV tier — role นี้จะได้ Handover ฿0 จนกว่าจะเพิ่ม tier แรก</div>` : '';

  return `<div style="border-radius:13px;border:1px solid rgba(var(--ink-blue),.09);background:rgba(255,255,255,.025);padding:13px;margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px">
      <span style="width:3px;height:16px;border-radius:var(--r-xxs);background:#bcd7ff;flex-shrink:0"></span>
      <span style="font-size:var(--text-md);font-weight:800;color:rgba(var(--ink-blue-hi),.85)">Handover — แบ่งตาม GMV tier</span>
    </div>
    ${errHtml}${emptyNote}${tierCards}
    <button onclick="_commRoleAddHandoverGmvTier('${planCode}')" style="width:100%;padding:10px;border-radius:var(--r-md);background:rgba(var(--ink-blue),.06);border:1px dashed rgba(var(--ink-blue),.22);color:rgba(var(--ink-blue),.70);font-size:var(--text-md);font-weight:var(--fw-bold);cursor:pointer;margin-top:2px">+ เพิ่ม GMV tier</button>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
// SECTION:COMMISSION_SETUP_TIER_LADDER (Commission Setup redesign, phase 5)
// Generic per-scheme tier-ladder editor shared by Gate and TL-mult — both
// are structurally identical (a multi-tier ladder keyed on a %, with
// payout_value used as a multiplier rather than a flat ฿ amount), so one
// parameterized editor covers both rather than duplicating the NRR-tier-
// card pattern twice. metricVariant is always null for these two (only
// Upsell uses variants, phase 6).
function _commRoleComponentTiers(planCode, metricCode) {
  const d = _commEnsureComponentDraft(planCode, metricCode, null);
  if (!Array.isArray(d.tiers)) d.tiers = [];
  return d.tiers;
}
function _commRoleAddComponentTier(planCode, metricCode) {
  _commRoleComponentTiers(planCode, metricCode).push({ min_value: null, max_value: null, payout_value: 1.0, payout_label: '' });
  _commMarkChanged();
  renderCommissionCockpit();
}
function _commRoleRemoveComponentTier(planCode, metricCode, idx) {
  _commRoleComponentTiers(planCode, metricCode).splice(idx, 1);
  _commMarkChanged();
  renderCommissionCockpit();
}
function _commRoleSetComponentTier(planCode, metricCode, idx, field, value) {
  const t = _commRoleComponentTiers(planCode, metricCode)[idx];
  if (!t) return;
  t[field] = (field === 'payout_label') ? value : (value === '' ? null : Number(value));
  _commMarkChanged();
}
window._commRoleAddComponentTier = _commRoleAddComponentTier;
window._commRoleRemoveComponentTier = _commRoleRemoveComponentTier;
window._commRoleSetComponentTier = _commRoleSetComponentTier;

function _renderRoleTierLadderEditor(planCode, metricCode, opts) {
  // Read-only for the same reason as _renderRoleHandoverEditor above —
  // staging happens only in the real mutators (_commRoleAdd/Remove/SetComponentTier).
  const draft = _commGetComponentDraft(planCode, metricCode, null);
  const tiers = (draft && Array.isArray(draft.tiers)) ? draft.tiers : [];
  const inpBase = 'background:rgba(255,255,255,.08);border:1px solid rgba(var(--ink-blue),.18);border-radius:var(--r-9);padding:8px 11px;color:#e8eeff;font-size:var(--text-md);font-family:\'IBM Plex Mono\',monospace;text-align:right;outline:none;width:100%';
  const inpPay  = 'background:rgba(255,224,138,.08);border:1px solid rgba(255,224,138,.28);border-radius:var(--r-9);padding:9px 11px;color:#ffe08a;font-size:var(--text-base);font-weight:800;font-family:\'IBM Plex Mono\',monospace;text-align:right;outline:none;width:100%';
  const fmtMult = v => Number(v||0).toFixed(2)+'×';

  const tierCards = tiers.map((t, i) => `<div style="border-radius:var(--r-card);border:1px solid rgba(var(--ink-blue),.14);background:rgba(255,255,255,.03);padding:12px;margin-bottom:9px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">
        <span style="font-size:var(--text-sm);font-weight:800;color:rgba(var(--ink-blue),.85);font-family:'IBM Plex Mono',monospace">Tier ${i+1} — ${fmtMult(t.payout_value)}</span>
        <button onclick="_commRoleRemoveComponentTier('${planCode}','${metricCode}',${i})" style="font-size:var(--text-lg2);color:rgba(255,255,255,.52);background:none;border:none;cursor:pointer;padding:0 4px" onmouseover="this.style.color='rgba(255,80,60,.75)'" onmouseout="this.style.color='rgba(255,255,255,.28)'">×</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:7px">
        <div>
          <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">${opts.unitLabel} ตั้งแต่</div>
          <input style="${inpBase}" value="${t.min_value ?? ''}" inputmode="decimal"
            oninput="_commRoleSetComponentTier('${planCode}','${metricCode}',${i},'min_value',this.value)">
        </div>
        <div>
          <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">ถึง — ว่าง=∞</div>
          <input style="${inpBase}" value="${t.max_value ?? ''}" placeholder="∞" inputmode="decimal"
            oninput="_commRoleSetComponentTier('${planCode}','${metricCode}',${i},'max_value',this.value)">
        </div>
      </div>
      <div>
        <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(255,224,138,.85);margin-bottom:3px">Multiplier (×)</div>
        <input style="${inpPay}" value="${t.payout_value ?? 1}" inputmode="decimal"
          oninput="_commRoleSetComponentTier('${planCode}','${metricCode}',${i},'payout_value',this.value)">
      </div>
    </div>`).join('');

  const emptyNote = !tiers.length ? `<div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.55);padding:8px 10px;background:rgba(0,0,0,.20);border-radius:var(--r-8);margin-bottom:9px;line-height:1.6">${opts.emptyNote}</div>` : '';

  return `<div style="border-radius:13px;border:1px solid rgba(var(--ink-blue),.09);background:rgba(255,255,255,.025);padding:13px;margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px">
      <span style="width:3px;height:16px;border-radius:var(--r-xxs);background:${opts.accentColor || '#bcd7ff'};flex-shrink:0"></span>
      <span style="font-size:var(--text-md);font-weight:800;color:rgba(var(--ink-blue-hi),.85)">${opts.title}</span>
    </div>
    ${emptyNote}${tierCards}
    <button onclick="_commRoleAddComponentTier('${planCode}','${metricCode}')" style="width:100%;padding:10px;border-radius:var(--r-md);background:rgba(var(--ink-blue),.06);border:1px dashed rgba(var(--ink-blue),.22);color:rgba(var(--ink-blue),.70);font-size:var(--text-md);font-weight:var(--fw-bold);cursor:pointer;margin-top:2px">+ เพิ่ม tier</button>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
// SECTION:COMMISSION_SETUP_UPSELL (Commission Setup redesign, phase 6)
// Upsell P1/P3/Expansion editors — all 3 are the "1 tier row for a flat
// rate" shape (never a real multi-tier ladder), so one shared single-rate
// editor covers all 3 upsell_gmv variants. P3 additionally needs 2 scalar
// params (threshold_pct, min_incremental) that don't fit a tier boundary —
// those live in the rule's own params jsonb (see the target model table in
// the Commission Setup plan).
function _commRoleSingleRateTier(planCode, metricCode, metricVariant) {
  const d = _commEnsureComponentDraft(planCode, metricCode, metricVariant);
  if (!Array.isArray(d.tiers) || !d.tiers.length) d.tiers = [{ min_value: null, max_value: null, payout_value: 0, payout_label: '' }];
  return d.tiers[0];
}
function _commRoleSetRatePercent(planCode, metricCode, metricVariant, value) {
  const t = _commRoleSingleRateTier(planCode, metricCode, metricVariant);
  t.payout_value = value === '' ? 0 : Number(value) / 100;
  _commMarkChanged();
}
function _commRoleSetSingleRateField(planCode, metricCode, metricVariant, field, value) {
  const t = _commRoleSingleRateTier(planCode, metricCode, metricVariant);
  t[field] = value === '' ? null : Number(value);
  _commMarkChanged();
}
function _commRoleSetComponentParam(planCode, metricCode, metricVariant, param, value) {
  const d = _commEnsureComponentDraft(planCode, metricCode, metricVariant);
  if (!d.params) d.params = {};
  d.params[param] = value === '' ? null : Number(value);
  _commMarkChanged();
}
window._commRoleSetRatePercent = _commRoleSetRatePercent;
window._commRoleSetSingleRateField = _commRoleSetSingleRateField;
window._commRoleSetComponentParam = _commRoleSetComponentParam;

function _renderRoleUpsellRateEditor(planCode, metricVariant, opts) {
  // Read-only for the same reason as _renderRoleHandoverEditor above —
  // staging happens only in the real mutators (_commRoleSetRatePercent/
  // SetSingleRateField/SetComponentParam).
  const draft = _commGetComponentDraft(planCode, 'upsell_gmv', metricVariant);
  const t = (draft && Array.isArray(draft.tiers) && draft.tiers[0]) ? draft.tiers[0] : { min_value: null, max_value: null, payout_value: 0, payout_label: '' };
  const d = { params: (draft && draft.params) || {} };
  const inpBase = 'background:rgba(255,255,255,.08);border:1px solid rgba(var(--ink-blue),.18);border-radius:var(--r-9);padding:8px 11px;color:#e8eeff;font-size:var(--text-md);font-family:\'IBM Plex Mono\',monospace;text-align:right;outline:none;width:100%';
  const inpPay  = 'background:rgba(255,224,138,.08);border:1px solid rgba(255,224,138,.28);border-radius:var(--r-9);padding:9px 11px;color:#ffe08a;font-size:var(--text-base);font-weight:800;font-family:\'IBM Plex Mono\',monospace;text-align:right;outline:none;width:100%';
  const ratePct = (t.payout_value !== null && t.payout_value !== undefined) ? Math.round(Number(t.payout_value) * 10000) / 100 : '';

  const rateField = `<div>
    <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(255,224,138,.85);margin-bottom:3px">Rate (%)</div>
    <input style="${inpPay}" value="${ratePct}" inputmode="decimal"
      oninput="_commRoleSetRatePercent('${planCode}','upsell_gmv','${metricVariant}',this.value)">
  </div>`;

  let extraFields = '';
  if (opts.showMinGmv) {
    extraFields = `<div>
      <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">Min GMV gate (฿)</div>
      <input style="${inpBase}" value="${t.min_value ?? ''}" inputmode="numeric"
        oninput="_commRoleSetSingleRateField('${planCode}','upsell_gmv','${metricVariant}','min_value',this.value)">
    </div>`;
  } else if (opts.showGrowthParams) {
    const threshPct = d.params.threshold_pct ?? '';
    const minIncr = d.params.min_incremental ?? '';
    extraFields = `<div>
      <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">Growth threshold (%)</div>
      <input style="${inpBase}" value="${threshPct}" inputmode="decimal"
        oninput="_commRoleSetComponentParam('${planCode}','upsell_gmv','${metricVariant}','threshold_pct',this.value)">
    </div>
    <div>
      <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">Min incremental (฿)</div>
      <input style="${inpBase}" value="${minIncr}" inputmode="numeric"
        oninput="_commRoleSetComponentParam('${planCode}','upsell_gmv','${metricVariant}','min_incremental',this.value)">
    </div>`;
  }

  return `<div style="border-radius:13px;border:1px solid rgba(var(--ink-blue),.09);background:rgba(255,255,255,.025);padding:13px;margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px">
      <span style="width:3px;height:16px;border-radius:var(--r-xxs);background:${opts.accentColor || '#bcd7ff'};flex-shrink:0"></span>
      <span style="font-size:var(--text-md);font-weight:800;color:rgba(var(--ink-blue-hi),.85)">${opts.title}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">${rateField}${extraFields}</div>
  </div>`;
}

// ══════════════════════════════════════════════════════════════
// SECTION:COMMISSION_SETUP_UPSELL_CATEGORY_BONUS (v_catbonus, 2026-07-19)
// Per-category / per-group_key Upsell bonus rates — ONE shared override map
// applied to BOTH P1 and P3 (Bush's decision). Stored on a single
// upsell_gmv/category_bonus rule's tier_config as {category_rates,
// group_rates} (the shape the engine's _commResolveUpsellRateMap reads),
// plus a `rows` working array for the editor (harmless extra jsonb, ignored
// by the engine). Modeled on the handover gmv_tiers editor. An override
// REPLACES the base rate (not additive); precedence group > category > base.
// ══════════════════════════════════════════════════════════════
const _COMM_CATEGORIES = ['Beverage Alcohol','Beverage Non-alcohol','DG Food','DG Non-food','Egg','Fish & Seafood','Fruit','Meat','Processed Food','Vegetable'];

// Rebuild the engine-facing maps from the editor's rows (skip incomplete rows).
function _commSyncBonusMaps(tc) {
  const cat = {}, grp = {};
  (tc.rows || []).forEach(r => {
    if (!r || r.key == null || r.key === '' || r.rate == null || r.rate === '' || isNaN(r.rate)) return;
    const frac = Number(r.rate) / 100;
    if (r.level === 'group') grp[r.key] = frac; else cat[r.key] = frac;
  });
  tc.category_rates = cat;
  tc.group_rates = grp;
}
// Ensure the draft's tier_config exists + has a rows working array. On first
// open of a DB-saved scheme (which has category_rates/group_rates but no rows),
// reconstruct rows from the maps so the editor shows existing overrides.
function _commRoleBonusRows(planCode) {
  const d = _commEnsureComponentDraft(planCode, 'upsell_gmv', 'category_bonus');
  if (!d.tier_config || typeof d.tier_config !== 'object') d.tier_config = {};
  const tc = d.tier_config;
  if (!Array.isArray(tc.rows)) {
    const rows = [];
    Object.keys(tc.category_rates || {}).forEach(k => rows.push({ level:'category', key:k, rate: Number(tc.category_rates[k]) * 100 }));
    Object.keys(tc.group_rates || {}).forEach(k => rows.push({ level:'group', key:k, rate: Number(tc.group_rates[k]) * 100 }));
    tc.rows = rows;
  }
  return tc.rows;
}
function _commRoleAddBonusRow(planCode) {
  const rows = _commRoleBonusRows(planCode);
  rows.push({ level:'category', key:'', rate:'' });
  _commMarkChanged();
  renderCommissionCockpit();
}
function _commRoleRemoveBonusRow(planCode, idx) {
  const rows = _commRoleBonusRows(planCode);
  rows.splice(idx, 1);
  const d = _commEnsureComponentDraft(planCode, 'upsell_gmv', 'category_bonus');
  _commSyncBonusMaps(d.tier_config);
  _commMarkChanged();
  renderCommissionCockpit();
}
function _commRoleSetBonusField(planCode, idx, field, value) {
  const rows = _commRoleBonusRows(planCode);
  if (!rows[idx]) return;
  if (field === 'level') { rows[idx].level = value; rows[idx].key = ''; }       // reset key when switching level
  else if (field === 'rate') rows[idx].rate = value;
  else rows[idx].key = value;
  const d = _commEnsureComponentDraft(planCode, 'upsell_gmv', 'category_bonus');
  _commSyncBonusMaps(d.tier_config);
  _commMarkChanged();
  if (field === 'level') renderCommissionCockpit(); // re-render to swap key input type
}
window._commRoleAddBonusRow = _commRoleAddBonusRow;
window._commRoleRemoveBonusRow = _commRoleRemoveBonusRow;
window._commRoleSetBonusField = _commRoleSetBonusField;

// Distinct group_key list (with category) observed in the loaded fast-path
// file — powers the group typeahead so admins pick real groups, not free text.
function _commObservedGroupKeys() {
  const out = [];
  try {
    const byKam = (typeof bulkUpsellTeamGroups !== 'undefined' && bulkUpsellTeamGroups) || {};
    const seen = new Set();
    Object.keys(byKam).forEach(k => (byKam[k] || []).forEach(r => {
      if (r.group_key && !seen.has(r.group_key)) { seen.add(r.group_key); out.push(r.group_key); }
    }));
    out.sort();
  } catch (e) {}
  return out;
}
function _commValidateUpsellCategoryBonus(rows) {
  const errs = [], notes = [];
  const seen = {};
  const catKeys = new Set(rows.filter(r => r.level === 'category' && r.key).map(r => r.key));
  rows.forEach((r, i) => {
    if (!r.key) return;
    const id = r.level + '|' + r.key;
    if (seen[id]) errs.push(`ซ้ำ: ${r.level==='group'?'กลุ่ม':'หมวด'} "${r.key}" มีมากกว่า 1 แถว`);
    seen[id] = true;
    if (r.rate === '' || r.rate == null || isNaN(r.rate) || Number(r.rate) < 0 || Number(r.rate) > 100)
      errs.push(`เรตของ "${r.key}" ต้องอยู่ระหว่าง 0–100%`);
  });
  return { errs, notes };
}

function _renderRoleUpsellCategoryBonusEditor(planCode) {
  // Read-only render (staging only in mutators — same ghost-row guard as the
  // handover/upsell editors above).
  const draft = _commGetComponentDraft(planCode, 'upsell_gmv', 'category_bonus');
  let rows = [];
  if (draft && draft.tier_config) {
    if (Array.isArray(draft.tier_config.rows)) rows = draft.tier_config.rows;
    else {
      Object.keys(draft.tier_config.category_rates || {}).forEach(k => rows.push({ level:'category', key:k, rate: Number(draft.tier_config.category_rates[k])*100 }));
      Object.keys(draft.tier_config.group_rates || {}).forEach(k => rows.push({ level:'group', key:k, rate: Number(draft.tier_config.group_rates[k])*100 }));
    }
  }
  const inpSel = 'background:rgba(255,255,255,.08);border:1px solid rgba(var(--ink-blue),.18);border-radius:var(--r-9);padding:8px 9px;color:#e8eeff;font-size:var(--text-md);font-family:var(--tk-font-body),system-ui,sans-serif;outline:none;width:100%';
  const inpKey = inpSel;
  const inpPay = 'background:rgba(255,224,138,.08);border:1px solid rgba(255,224,138,.28);border-radius:var(--r-9);padding:8px 9px;color:#ffe08a;font-size:var(--text-base);font-weight:800;font-family:\'IBM Plex Mono\',monospace;text-align:right;outline:none;width:100%';
  const groupKeys = _commObservedGroupKeys();
  const dlId = 'comm-grpkeys-' + planCode.replace(/[^a-zA-Z0-9]/g,'');
  const datalist = `<datalist id="${dlId}">${groupKeys.map(g=>`<option value="${_commEscapeHtml(g)}"></option>`).join('')}</datalist>`;

  const rowCards = rows.map((r, i) => {
    const catOpts = _COMM_CATEGORIES.map(c => `<option value="${c}" ${r.key===c?'selected':''}>${c}</option>`).join('');
    const keyField = r.level === 'group'
      ? `<input list="${dlId}" style="${inpKey}" value="${_commEscapeHtml(r.key||'')}" placeholder="พิมพ์/เลือกกลุ่มสินค้า"
           oninput="_commRoleSetBonusField('${planCode}',${i},'key',this.value)">`
      : `<select style="${inpSel}" onchange="_commRoleSetBonusField('${planCode}',${i},'key',this.value)">
           <option value="">— เลือกหมวด —</option>${catOpts}</select>`;
    return `<div style="display:flex;align-items:flex-end;gap:7px;margin-bottom:7px">
      <div style="width:96px">
        <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">ระดับ</div>
        <select style="${inpSel}" onchange="_commRoleSetBonusField('${planCode}',${i},'level',this.value)">
          <option value="category" ${r.level!=='group'?'selected':''}>หมวด</option>
          <option value="group" ${r.level==='group'?'selected':''}>กลุ่มย่อย</option>
        </select>
      </div>
      <div style="flex:1">
        <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.70);margin-bottom:3px">${r.level==='group'?'กลุ่มย่อย (group_key)':'หมวด (category)'}</div>
        ${keyField}
      </div>
      <div style="width:86px">
        <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(255,224,138,.85);margin-bottom:3px">เรต (%)</div>
        <input style="${inpPay}" value="${r.rate ?? ''}" inputmode="decimal"
          oninput="_commRoleSetBonusField('${planCode}',${i},'rate',this.value)">
      </div>
      <button onclick="_commRoleRemoveBonusRow('${planCode}',${i})" style="font-size:var(--text-lg);color:var(--tk-text-faint);background:none;border:none;cursor:pointer;padding:8px 4px" onmouseover="this.style.color='rgba(255,80,60,.70)'" onmouseout="this.style.color='rgba(255,255,255,.25)'">×</button>
    </div>`;
  }).join('');

  const { errs } = _commValidateUpsellCategoryBonus(rows);
  const errHtml = errs.length ? `<div style="font-size:var(--text-xs);color:rgba(255,120,80,.90);padding:8px 10px;background:rgba(255,80,60,.10);border-radius:var(--r-8);margin-bottom:9px;line-height:1.6">${errs.map(_commEscapeHtml).join('<br>')}</div>` : '';
  const emptyNote = !rows.length ? `<div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.55);padding:8px 10px;background:rgba(0,0,0,.20);border-radius:var(--r-8);margin-bottom:9px;line-height:1.6">ยังไม่มีโบนัส — ทุกกลุ่มใช้เรต P1/P3 พื้นฐานด้านบน เพิ่มแถวเพื่อกำหนดเรตพิเศษต่อหมวด/กลุ่มสินค้า</div>` : '';

  return `<div style="border-radius:13px;border:1px solid rgba(var(--ink-blue),.09);background:rgba(255,255,255,.025);padding:13px;margin-bottom:10px">
    ${datalist}
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="width:3px;height:16px;border-radius:var(--r-xxs);background:rgba(120,220,150,.85);flex-shrink:0"></span>
      <span style="font-size:var(--text-md);font-weight:800;color:rgba(var(--ink-blue-hi),.85)">โบนัสตามกลุ่มสินค้า</span>
    </div>
    <div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.62);line-height:1.6;margin-bottom:10px">เรตพิเศษนี้ <b>แทนที่</b>เรต P1/P3 พื้นฐาน และใช้กับ<b>ทั้ง P1 และ P3</b> — ถ้าตั้งทั้งหมวดและกลุ่มย่อยที่ทับกัน กลุ่มย่อยจะชนะ</div>
    ${errHtml}${emptyNote}${rowCards}
    <button onclick="_commRoleAddBonusRow('${planCode}')" style="width:100%;padding:10px;border-radius:var(--r-md);background:rgba(120,220,150,.06);border:1px dashed rgba(120,220,150,.30);color:rgba(150,230,175,.85);font-size:var(--text-md);font-weight:var(--fw-bold);cursor:pointer;margin-top:2px">+ เพิ่มโบนัสกลุ่มสินค้า</button>
  </div>`;
}
window._renderRoleUpsellCategoryBonusEditor = _renderRoleUpsellCategoryBonusEditor;

function _renderTlUpsellTierRows() {
  let tiers = [];
  try {
    const rules = _commRuleConfig && _commRuleConfig.rules && _commRuleConfig.rules['tl_upsell_mult'];
    tiers = (rules && rules[0] && rules[0].tiers) ? rules[0].tiers : [];
  } catch(e) {}
  if (!tiers.length) tiers = [
    {min_pct:0,max_pct:1.99,multiplier:1.00},
    {min_pct:2,max_pct:2.99,multiplier:1.20},
    {min_pct:3,max_pct:3.99,multiplier:1.35},
    {min_pct:4,max_pct:4.99,multiplier:1.50},
    {min_pct:5,max_pct:null,multiplier:1.80}
  ];
  const fmtMult = v => Number(v||1).toFixed(2)+'×';
  return tiers.map((t,i) => {
    const minV = t.min_pct != null ? Number(t.min_pct) : null;
    const maxV = t.max_pct != null ? Number(t.max_pct) : null;
    const mult = Number(t.multiplier || 1.0);
    const isBase = mult <= 1.0;
    const accentColor = isBase ? 'rgba(var(--ink-blue),.30)' : mult >= 1.5 ? 'var(--tk-ok-bright)' : '#ffe08a';
    const prevTxt = minV != null && maxV != null ? `Upsell ${minV}–${maxV}%`
                  : minV != null ? `Upsell ≥ ${minV}%` : `Upsell < ${maxV}%`;
    return `<div style="border-radius:var(--r-card);border:1px solid rgba(var(--ink-blue),.09);background:rgba(255,255,255,.025);padding:12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="width:3px;height:14px;border-radius:var(--r-xxs);background:${accentColor};flex-shrink:0"></span>
          <span style="font-size:var(--text-sm);font-weight:800;color:rgba(var(--ink-blue-hi),.75)">${prevTxt} → ${fmtMult(mult)}</span>
        </div>
        <button onclick="_commRemoveTlUpsellTier(${i})" style="font-size:var(--text-lg);color:rgba(255,255,255,.52);background:none;border:none;cursor:pointer;padding:2px 5px;line-height:1" onmouseover="this.style.color='rgba(255,80,60,.70)'" onmouseout="this.style.color='rgba(255,255,255,.20)'">×</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px">
        <div>
          <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.78);margin-bottom:4px">Upsell ตั้งแต่ (%)</div>
          <input style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(var(--ink-blue),.10);border-radius:var(--r-8);padding:8px 9px;color:rgba(var(--ink-blue-hi),.88);font-size:var(--text-sm);font-family:'IBM Plex Mono','Noto Sans Thai',monospace;text-align:right;outline:none"
            value="${minV ?? ''}" placeholder="0" inputmode="decimal"
            oninput="_commSetTlUpsellTier(${i},'min_pct',this.value);_commMarkChanged()">
        </div>
        <div>
          <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.78);margin-bottom:4px">ถึง (%) — ว่าง=∞</div>
          <input style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(var(--ink-blue),.10);border-radius:var(--r-8);padding:8px 9px;color:rgba(var(--ink-blue-hi),.88);font-size:var(--text-sm);font-family:'IBM Plex Mono','Noto Sans Thai',monospace;text-align:right;outline:none"
            value="${maxV ?? ''}" placeholder="∞" inputmode="decimal"
            oninput="_commSetTlUpsellTier(${i},'max_pct',this.value);_commMarkChanged()">
        </div>
        <div>
          <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.78);margin-bottom:4px">Multiplier ×</div>
          <input style="width:100%;background:rgba(255,224,138,.05);border:1px solid rgba(255,224,138,.18);border-radius:var(--r-8);padding:8px 9px;color:#ffe08a;font-size:var(--text-sm);font-family:'IBM Plex Mono','Noto Sans Thai',monospace;text-align:right;outline:none"
            value="${mult}" placeholder="1.0" inputmode="decimal"
            oninput="_commSetTlUpsellTier(${i},'multiplier',this.value);_commMarkChanged()">
        </div>
      </div>
    </div>`;
  }).join('');
}


// In-memory staging for component params (flushed on saveCommissionComponentRates)
let _commComponentPending = {};
function _commSetComponentParam(metricCode, param, value) {
  if (!_commComponentPending[metricCode]) _commComponentPending[metricCode] = {};
  _commComponentPending[metricCode][param] = Number(value);
  _commMarkChanged();
}

async function saveCommissionComponentRates() {
  if (!Object.keys(_commComponentPending).length) {
    showToast('ไม่มีการเปลี่ยนแปลง', '!'); return;
  }
  const actor = (currentUserProfile && currentUserProfile.email) || '';
  const toUpsert = [];
  // v562 COMPLETE-ROW SAVE FIX. Two bugs fixed here:
  // (1) `existing` was read from _commRuleConfig.rules — the NRR-only compat path,
  //     ALWAYS empty for component metrics → every save wrote only the touched
  //     fields, producing partial DB rows (e.g. gmv_gate_params missing cap_1).
  //     Now merges with _tgtSettings (real DB readback, v559).
  // (2) Self-heal: every save persists the COMPLETE param catalog for the metric
  //     using the engine's effective values — rows can never be partial again.
  const _COMPONENT_CATALOG = {
    upsell_sku:    { p1_rate:0.03, p3_rate:0.03, p3_threshold_pct:2.00, p1_min_gmv:5000, p3_min_incremental:5000 },
    upsell_outlet: { rate:0.015 },
    handover:      { tier2_pct:100, tier3_pct:120, tier2_payout:2500, tier3_bonus:2500 },
    gmv_gate:      { threshold_1:95, threshold_2:90, cap_1:0.70, cap_2:0.35 }
  }; // defaults mirror 07a engine defaults exactly
  for (const [metricCode, params] of Object.entries(_commComponentPending)) {
    const existing = {};
    try { // compat path first (lowest priority)
      const rules = _commRuleConfig.rules && _commRuleConfig.rules[metricCode];
      if (rules && rules[0] && rules[0].params) Object.assign(existing, rules[0].params);
    } catch(e) {}
    try { // real DB-backed params override compat
      const raw = _tgtSettings && _tgtSettings[metricCode + '_params'];
      if (raw) Object.assign(existing, typeof raw === 'object' ? raw : JSON.parse(raw));
    } catch(e) {}
    const merged = { ...existing, ...params };
    const cat = _COMPONENT_CATALOG[metricCode] || {};
    Object.keys(cat).forEach(p => {
      if (merged[p] === undefined || merged[p] === null) {
        try { merged[p] = typeof _commGetConfig==='function' ? _commGetConfig(metricCode, p, cat[p]) : cat[p]; }
        catch(e) { merged[p] = cat[p]; }
      }
    });
    toUpsert.push({ metric_code: metricCode, params: merged, updated_by: actor });
  }
  try {
    // Upsert into commission_rules — match by metric_code (assumes one rule per metric_code for component rates)
    for (const row of toUpsert) {
      // Store in target_settings (key: '{metric_code}_params')
      // Avoids commission_rules CHECK constraint restrictions
      const { error } = await supa.from('target_settings')
        .upsert({ key: row.metric_code + '_params',
                  value: JSON.stringify(row.params),
                  updated_by: row.updated_by },
                 { onConflict: 'key' });
      if (error) throw error;
      // Update _tgtSettings cache immediately so UI reflects new values
      if (!_tgtSettings) _tgtSettings = {};
      _tgtSettings[row.metric_code + '_params'] = row.params;
    }
    _commComponentPending = {};
    _commHandoverGmvTiersDraft = null; // re-derive from freshly-saved _tgtSettings next render
    _commSoftenPostSaveUi();
    showToast('Component rates saved', '✓');
    renderCommissionCockpit();
  } catch(e) {
    showToast('Save failed: ' + (e.message || e), '✗');
  }
}
window.saveCommissionComponentRates = saveCommissionComponentRates;
window._commSetComponentParam = _commSetComponentParam;
function _commAddTlUpsellTier() {
  try {
    const rules = _commRuleConfig.rules || {};
    if (!rules.tl_upsell_mult) rules.tl_upsell_mult = [{ tiers:[] }];
    if (!rules.tl_upsell_mult[0].tiers) rules.tl_upsell_mult[0].tiers = [];
    rules.tl_upsell_mult[0].tiers.push({min_pct:null,max_pct:null,multiplier:1.0});
    _commMarkChanged();
    renderCommissionCockpit();
  } catch(e) {}
}
function _commRemoveTlUpsellTier(idx) {
  try {
    _commRuleConfig.rules.tl_upsell_mult[0].tiers.splice(idx, 1);
    _commMarkChanged();
    renderCommissionCockpit();
  } catch(e) {}
}
function _commSetTlUpsellTier(idx, field, value) {
  try {
    const t = _commRuleConfig.rules.tl_upsell_mult[0].tiers[idx];
    if (!t) return;
    t[field] = value === '' ? null : Number(value);
    _commMarkChanged();
  } catch(e) {}
}
window._commAddTlUpsellTier = _commAddTlUpsellTier;
window._commRemoveTlUpsellTier = _commRemoveTlUpsellTier;
window._commSetTlUpsellTier = _commSetTlUpsellTier;

function renderCommRulesStep(body) {
  const tlRules = _commRulesForRole('tl', { activeOnly:true });
  const kamRules = _commRulesForRole('kam', { activeOnly:true });
  // v878 (phase 6): rules for the 6 roles beyond tl/kam, grouped together
  // (each individually would mostly be empty until an admin creates one).
  const otherRules = _COMM_OTHER_ROLES.flatMap(r => _commRulesForRole(r, { activeOnly:true }));
  const allRules = [...tlRules, ...kamRules, ...otherRules];
  if (!_commSelectedRuleCode || !allRules.some(p => p.plan_code === _commSelectedRuleCode)) _commSelectedRuleCode = (tlRules[0] && tlRules[0].plan_code) || _commPlanCode('tl');
  const selected = allRules.find(p => p.plan_code === _commSelectedRuleCode) || tlRules[0] || kamRules[0];
  const role = selected?.beneficiary_role || 'tl';
  body.innerHTML = `
    <div class="comm-hero">
      <div class="comm-hero-top">
        <div><div class="comm-hero-title">3. Rule Library</div><div class="comm-hero-sub">สร้าง rule หลายชุด แล้วนำไป assign ให้ TL/KAM ใน Step 2</div></div>
      </div>
    </div>
    <div class="comm-section-title">Component Rates (Upsell & Gate)</div>
    <div class="comm-card comm-component-rates-card">${_renderComponentRatesEditor()}</div>
    <div class="comm-rule-actions">
      <button class="comm-create-rule-btn" onclick="_commCreateRule('tl')">+ Create TL Rule</button>
      <button class="comm-create-rule-btn" onclick="_commCreateRule('kam')">+ Create KAM Rule</button>
      <select class="comm-select" id="comm-other-role-select" style="width:auto">
        ${_COMM_OTHER_ROLES.map(r=>`<option value="${r}">${r.toUpperCase()}</option>`).join('')}
      </select>
      <button class="comm-create-rule-btn" onclick="_commCreateRule(document.getElementById('comm-other-role-select').value)">+ Create Rule</button>
    </div>
    <div class="comm-rule-group-title">TL Rules (NRR Tiers)</div>
    <div class="comm-rule-library">${tlRules.map(p=>_renderRuleLibraryItem(p)).join('')}</div>
    <div class="comm-rule-group-title">KAM Rules</div>
    <div class="comm-rule-library">${kamRules.map(p=>_renderRuleLibraryItem(p)).join('')}</div>
    <div class="comm-rule-group-title">Other roles (PM / Admin / Sales / AD)</div>
    <div class="comm-rule-library">${otherRules.map(p=>_renderRuleLibraryItem(p)).join('') || `<div class="comm-empty">ยังไม่มี rule สำหรับ role อื่น — กด "+ Create Rule" ด้านบน</div>`}</div>
    <div class="comm-section-title">Edit selected rule</div>
    ${selected ? _renderCommRuleEditorByCode(selected.plan_code, role) : `<div class="comm-empty">ยังไม่มี rule ให้แก้</div>`}
  `;
}
function _renderRuleLibraryItem(p) {
  const active = p.plan_code === _commSelectedRuleCode;
  const pending = !!_commRulePending[p.plan_code];
  const used = _commRuleUsageCount(p.plan_code);
  const isActive = _commIsActivePlan(p);
  return `<div class="comm-rule-item ${active?'active':''} ${isActive?'':'archived'}" onclick="_commSelectedRuleCode='${p.plan_code}';renderCommissionCockpit()">
    <div>
      <div class="comm-rule-item-name">${p.plan_name || p.plan_code}${pending?'<span class="comm-unsaved">Unsaved</span>':''}</div>
      <div class="comm-rule-item-meta">${p.plan_code} · ${(p.beneficiary_role||'').toUpperCase()} · ${p.status || 'active'}</div>
    </div>
    <div class="comm-rule-item-right">
      <span class="comm-used-pill ${used?'used':''}">Used ${used}</span>
      <span class="comm-badge ${p.beneficiary_role==='tl'?'blue':'ok'}">${(p.beneficiary_role||'').toUpperCase()}</span>
    </div>
  </div>`;
}
function _renderCommRuleEditorByCode(planCode, role) {
  const d = _commGetDraftByCode(planCode, role);
  const used = _commRuleUsageCount(planCode);
  const isStandard = planCode === _commPlanCode(role);
  const err = (_commValidationErrors || {})[planCode] || {};
  const tiers = (d && d.tiers) || [];

  const tierCards = tiers.map((t,i) => {
    const minV = t.min_value != null ? Number(t.min_value) : null;
    const maxV = t.max_value != null ? Number(t.max_value) : null;
    const pay  = Number(t.payout_value || 0);
    const te = (err.tiers || {})[i] || {};

    // Pill style by pay value
    const pillStyle = pay === 0
      ? 'background:rgba(255,100,60,.18);color:rgba(255,120,80,1);border:1px solid rgba(255,100,60,.35)'
      : pay >= 30000
      ? 'background:var(--tk-ok-dim-2);color:var(--tk-ok-bright);border:1px solid var(--tk-ok-border)'
      : 'background:rgba(255,224,138,.14);color:#ffe08a;border:1px solid rgba(255,224,138,.30)';
    const pillLbl = pay === 0 ? 'ไม่ถึงเกณฑ์' : `Tier ${i+1}`;

    // Range label
    const rangeLbl = minV != null && maxV != null ? `${minV}–${maxV}%`
                   : minV != null ? `≥ ${minV}%` : maxV != null ? `< ${maxV}%` : '—';
    const payLbl = pay ? '฿'+Math.round(pay).toLocaleString('en-US') : '฿0';
    const previewColor = pay === 0 ? 'rgba(255,120,80,.85)' : pay >= 30000 ? 'var(--tk-ok-bright)' : '#ffe08a';
    const borderLeft = pay === 0 ? 'rgba(255,100,60,.50)' : pay >= 30000 ? 'var(--tk-ok-border)' : 'rgba(255,224,138,.40)';

    // Compact: range fields on one row, payout prominent below
    const inpBase = 'background:rgba(255,255,255,.08);border:1px solid rgba(var(--ink-blue),.18);border-radius:var(--r-9);padding:8px 11px;color:#e8eeff;font-size:var(--text-base);font-family:\'IBM Plex Mono\',monospace;text-align:right;outline:none;width:100%';
    const inpPay  = 'background:rgba(255,224,138,.08);border:1px solid rgba(255,224,138,.28);border-radius:var(--r-9);padding:10px 12px;color:#ffe08a;font-size:var(--text-lg2);font-weight:900;font-family:\'IBM Plex Mono\',monospace;text-align:right;outline:none;width:100%';

    return `<div style="border-radius:var(--r-card);border:1px solid rgba(var(--ink-blue),.12);background:rgba(255,255,255,.04);padding:12px;margin-bottom:7px${te.range||te.payout?';border-color:rgba(255,100,60,.40)':''}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span style="font-size:var(--text-xs);font-weight:800;padding:3px 9px;border-radius:99px;${pillStyle}">${pillLbl}</span>
        <button onclick="removeRuleTier('${planCode}',${i})" style="font-size:var(--text-xl);color:rgba(255,255,255,.52);background:none;border:none;cursor:pointer;padding:0 4px;line-height:1" onmouseover="this.style.color='rgba(255,80,60,.80)'" onmouseout="this.style.color='rgba(255,255,255,.30)'">×</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:8px">
        <div>
          <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.75);margin-bottom:4px">${pay===0?'NRR ต่ำกว่า (%)':'NRR ตั้งแต่ (%)'}</div>
          <input style="${inpBase}" value="${pay===0?(maxV??''):(minV??'')}" placeholder="—" inputmode="decimal"
            oninput="onRuleTierInput('${planCode}',${i},'${pay===0?'max_value':'min_value'}',this.value)">
        </div>
        <div>
          <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.75);margin-bottom:4px">${pay===0?'\u00a0':'ถึง (%) — ว่าง=∞'}</div>
          ${pay===0?'<div style="height:38px"></div>':`<input style="${inpBase}" value="${maxV??''}" placeholder="∞" inputmode="decimal" oninput="onRuleTierInput('${planCode}',${i},'max_value',this.value)">`}
        </div>
      </div>
      <div style="margin-bottom:8px">
        <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);color:rgba(var(--ink-blue),.75);margin-bottom:4px">ได้รับ (฿)</div>
        <input style="${inpPay}" value="${pay}" inputmode="numeric"
          oninput="onRuleTierInput('${planCode}',${i},'payout_value',this.value)">
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:var(--r-7);background:rgba(0,0,0,.25);border-left:2px solid ${borderLeft}">
        <span style="font-size:var(--text-sm);font-family:'IBM Plex Mono','Noto Sans Thai',monospace;color:rgba(var(--ink-blue),.65)">NRR ${rangeLbl} → <span style="font-weight:800;color:${previewColor}">${payLbl}</span></span>
      </div>
      ${te.range||te.payout?`<div style="font-size:var(--text-xs);color:rgba(255,120,80,.90);padding:5px 0 0">${_commEscapeHtml(te.range||te.payout)}</div>`:''}
    </div>`;
  }).join('');

  const generalErr = err.general ? `<div style="font-size:var(--text-sm);color:rgba(255,100,60,.90);padding:8px 10px;background:rgba(255,80,60,.10);border-radius:var(--r-8);margin-bottom:10px">${_commEscapeHtml(err.general)}</div>` : '';
  // Empty ladder = valid no-op (role gets ฿0 NRR, other components still
  // pay) — same convention as the Gate/TL-mult editors' emptyNote. Shown as
  // an informational note, NOT a validation error (see _commValidateDrafts).
  const emptyNote = !tiers.length ? `<div style="font-size:var(--text-sm);color:rgba(var(--ink-blue),.60);padding:8px 10px;background:rgba(255,255,255,.04);border:1px dashed rgba(var(--ink-blue),.20);border-radius:var(--r-8);margin-bottom:10px">ยังไม่มี NRR tier — role นี้ได้ NRR ฿0 (component อื่น เช่น Upsell ยังจ่ายตามที่ตั้งไว้) · กด "+ เพิ่ม tier" ถ้าต้องการให้ role นี้ได้ค่าคอมฯ จาก NRR ด้วย</div>` : '';

  return `<div style="border-radius:var(--r-lg);border:1px solid rgba(var(--ink-blue),.12);background:rgba(255,255,255,.03);padding:14px;margin-bottom:8px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;gap:10px">
      <div>
        <input style="background:transparent;border:none;border-bottom:1px solid rgba(var(--ink-blue),.22);color:var(--tk-text-primary);font-size:var(--text-lg);font-weight:900;padding:2px 0;outline:none;width:210px;font-family:var(--tk-font-body),system-ui,sans-serif"
          value="${_commEscapeHtml(d.plan_name||'')}" placeholder="ชื่อ rule"
          oninput="onRuleHeaderInput('${planCode}','plan_name',this.value)">
        ${_commRulePending[planCode]?'<span style="font-size:var(--text-2xs);color:#ffe08a;font-weight:800;margin-left:6px;vertical-align:middle">Unsaved</span>':''}
        <div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.55);font-family:'IBM Plex Mono','Noto Sans Thai',monospace;margin-top:5px">${planCode} · ใช้อยู่ ${used} คน</div>
      </div>
      <button onclick="archiveCommissionRule('${planCode}')" ${isStandard?'disabled title="Standard rule ลบไม่ได้"':''}
        style="font-size:var(--text-xs);color:${isStandard?'rgba(var(--ink-blue),.25)':'rgba(255,100,60,.70)'};background:none;border:1px solid ${isStandard?'rgba(var(--ink-blue),.10)':'rgba(255,100,60,.28)'};border-radius:var(--r-7);padding:5px 10px;cursor:${isStandard?'default':'pointer'};white-space:nowrap">Archive</button>
    </div>
    ${generalErr}
    ${emptyNote}
    ${tierCards}
    <button class="comm-add" onclick="addRuleTier('${planCode}')"
      style="width:100%;padding:10px;border-radius:var(--r-md);background:rgba(var(--ink-blue),.06);border:1px dashed rgba(var(--ink-blue),.22);color:rgba(var(--ink-blue),.70);font-size:var(--text-md);font-weight:var(--fw-bold);cursor:pointer;margin-top:2px;font-family:var(--tk-font-body),system-ui,sans-serif">+ เพิ่ม tier</button>
    <div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.45);margin-top:8px;line-height:1.5">Rule นี้จะกระทบทุก TL/KAM ที่ assign ใช้ใน Step 2 · กด Save changes ที่ footer ด้านล่าง</div>
  </div>`;
}

function onRuleHeaderInput(planCode, field, value) {
  const d = _commGetDraftByCode(planCode);
  d[field] = value;
  _commClearValidationForPlan(planCode);
  _commSetDraftByCode(planCode, d);
  if (field === 'plan_name' && _commRuleConfig.plans && _commRuleConfig.plans[planCode]) _commRuleConfig.plans[planCode].plan_name = value;
  _commMarkChanged();
}
function onRuleTierInput(planCode, idx, field, value) {
  const d = _commGetDraftByCode(planCode);
  if (!d.tiers[idx]) return;
  d.tiers[idx][field] = field === 'payout_label' ? value : (value === '' ? null : Number(value));
  _commClearValidationForPlan(planCode);
  _commSetDraftByCode(planCode, d);
  _commMarkChanged();
}
function addRuleTier(planCode) {
  const d = _commGetDraftByCode(planCode);
  d.tiers.push({min_value:null,max_value:null,payout_value:0,payout_label:'New tier'});
  _commClearValidationForPlan(planCode);
  _commSetDraftByCode(planCode, d);
  _commMarkChanged();
  renderCommissionCockpit();
}
function removeRuleTier(planCode, idx) {
  const d = _commGetDraftByCode(planCode);
  d.tiers.splice(idx,1);
  _commClearValidationForPlan(planCode);
  _commSetDraftByCode(planCode,d);
  _commMarkChanged();
  renderCommissionCockpit();
}

async function archiveCommissionRule(planCode) {
  const plan = ((_commRuleConfig && _commRuleConfig.plans) || {})[planCode];
  const role = (plan && plan.beneficiary_role) || (planCode && planCode.startsWith('TL_') ? 'tl' : 'kam');
  if (planCode === _commPlanCode(role)) {
    if (typeof showToast === 'function') showToast('Standard rule archive ไม่ได้', '!');
    return;
  }
  const used = _commRuleUsageCount(planCode);
  if (used > 0) {
    const ok = window.confirm(`Rule นี้ถูก assign อยู่ ${used} รายการในเดือนนี้

Archive ต่อหรือไม่? หลัง archive rule นี้จะไม่ถูกใช้ใน Assignment/Preview ใหม่ และจะ fallback ไป Standard rule`);
    if (!ok) return;
  } else {
    const ok = window.confirm('Archive rule นี้หรือไม่? Rule จะถูกซ่อนจาก Assignment และ Rule Library active list แต่ไม่ถูก hard delete');
    if (!ok) return;
  }
  const actor = (currentUserProfile && currentUserProfile.email) || '';
  try {
    if (plan && plan.id) {
      const { error } = await supa.from('commission_plans').update({
        status:'inactive',
        updated_by: actor,
        updated_at: new Date().toISOString()
      }).eq('id', plan.id);
      if (error) throw new Error(error.message);
    }
    if (_commRulePending && _commRulePending[planCode]) delete _commRulePending[planCode];
    if (_commRuleConfig && _commRuleConfig.plans && _commRuleConfig.plans[planCode]) {
      _commRuleConfig.plans[planCode].status = 'inactive';
    }
    Object.keys(_commAssignmentPending || {}).forEach(k => {
      if (_commAssignmentPending[k] === planCode) delete _commAssignmentPending[k];
    });
    const activeRules = _commRulesForRole(role, { activeOnly:true });
    _commSelectedRuleCode = (activeRules[0] && activeRules[0].plan_code) || _commPlanCode(role);
    if (_tgtActiveQuarter) delete _tgtQuarterCache[_tgtActiveQuarter];
    if (typeof showToast === 'function') showToast('Archive rule สำเร็จ', 'ok');
    renderCommissionCockpit();
  } catch(e) {
    console.error('[Commission rules] archive failed', e);
    if (typeof showToast === 'function') showToast('Archive ไม่สำเร็จ: ' + (e.message || ''), '!');
  }
}

function renderCommLockStep(body) {
  const model = _commBuildPreviewModel();
  const teams = _commBuildTeamPreviewGroups();
  const rows = _commBuildSnapshotRows();
  const summary = _commBuildPayoutSummary((currentUserProfile&&currentUserProfile.role)==='tl'?'tl':undefined);
  const pending = (_nrrExclusions || []).filter(r => r.status === 'submitted' || r.status === 'pending').length;
  const threshold = Number(_tgtSettings.nrr_threshold || 98);
  const teamHit = model.teamPct !== null && model.teamPct >= threshold;
  const ready = rows.length > 0 && pending === 0;
  if (_commLockSubtab === 'retroactive') {
    body.innerHTML = `<div class="comm-hero"><div class="comm-hero-top"><div><div class="comm-hero-title">5. Preview &amp; Lock</div><div class="comm-hero-sub">ตรวจสอบก่อน lock snapshot และ export CSV</div></div><span class="comm-badge blue">EXPOSURE</span></div></div><div class="comm-lock-subtabs" style="margin:8px 0 4px"><button class="comm-lock-subtab" onclick="_commLockSubtab='current';renderCommissionCockpit()">เดือนนี้</button><button class="comm-lock-subtab active">Retroactive</button></div>` + _commRenderRetroactiveSection();
    return;
  }
  body.innerHTML = `
    <div class="comm-hero">
      <div class="comm-hero-top">
        <div><div class="comm-hero-title">5. Preview & Lock</div><div class="comm-hero-sub">ตรวจภาพรวมก่อน lock snapshot และ export CSV</div></div>
        <div class="comm-total"><div class="comm-total-lbl">Exposure</div><div class="comm-total-val">${_commFmtPayout(summary.total)}</div></div>
      </div>
      <div class="comm-lock-subtabs" style="margin:10px 0 -2px"><button class="comm-lock-subtab ${_commLockSubtab==='current'?'active':''}" onclick="switchLockSubtab('current')">เดือนนี้</button><button class="comm-lock-subtab ${_commLockSubtab==='retroactive'?'active':''}" onclick="switchLockSubtab('retroactive')">Retroactive ↩</button></div>
      <div class="comm-kpis">
        <div class="comm-kpi ${teamHit?'hit':'miss'}"><div class="comm-kpi-lbl">${(currentUserProfile&&currentUserProfile.role)==='admin'?'Teams':'Team NRR'}</div><div class="comm-kpi-val">${(currentUserProfile&&currentUserProfile.role)==='admin'?summary.teamCount:_commFmtPct(model.teamPct)}</div><div class="comm-kpi-sub">${(currentUserProfile&&currentUserProfile.role)==='admin'?'TL groups in snapshot':'Target '+threshold+'%'}</div></div>
        <div class="comm-kpi ${summary.tlPayout>0?'hit payout-hit':'miss'}"><div class="comm-kpi-lbl">TL payout</div><div class="comm-kpi-val">${_commFmtPayout(summary.tlPayout)}</div><div class="comm-kpi-sub">${summary.tlRows.length} TL rows</div></div>
        <div class="comm-kpi ${summary.kamPayout>0?'hit payout-hit':'miss'}"><div class="comm-kpi-lbl">KAM payout</div><div class="comm-kpi-val">${_commFmtPayout(summary.kamPayout)}</div><div class="comm-kpi-sub">${summary.hitKams}/${summary.kamCount} KAM hit payout</div></div>
      </div>
      <div class="comm-readiness-bar ${ready?'ready':'warn'}"><span class="comm-readiness-dot"></span><div class="comm-readiness-copy">${ready?'พร้อม lock: ไม่มี pending exception และมี snapshot rows แล้ว': pending?'ยังมี exclusion pending ' + pending + ' รายการ ถ้า lock ตอนนี้จะไม่ถูกนับ':'ยังไม่มีข้อมูล payout ให้ lock'}</div></div>
      <div class="tgt-lock-actions"><button class="tgt-lock-btn secondary" onclick="exportCommissionSnapshotCsv()">Export CSV</button><button class="tgt-lock-btn outline" onclick="computeCommissionDraft()">Compute</button><button class="tgt-lock-btn primary" onclick="lockCommissionSnapshot()">Lock snapshot</button></div>
    </div>
    <div id="comm-lock-detail-body">
    <div class="comm-section-title comm-preview-section-title"><span>By Team Lead</span><em>TL payout + KAM payout grouped by team</em></div>
    ${teams.map(t=>`<div class="comm-card comm-team-card comm-preview-team-card">
      <div class="comm-preview-tl-band">
        <div class="comm-preview-tl-left">
          <div class="comm-team-eyebrow">TEAM LEAD</div>
          <div class="comm-name">${_commEscapeHtml(t.tlName||t.tlEmail)}</div>
          <div class="comm-meta">${_commEscapeHtml(t.tlEmail||'')} · Team NRR ${_commFmtPct(t.teamNrr)}</div>
          <div class="comm-rule-chip">TL rule · ${_commEscapeHtml(t.tlPlanName || _commPlanNameByCode(t.tlPlanCode,'tl'))}</div>
        </div>
        <div class="comm-preview-tl-money"><span>Total payout</span><strong>${_commFmtPayout(t.total)}</strong><em>TL ${_commFmtPayout(t.tlPayout)}</em></div>
      </div>
      <div class="comm-kam-subhead"><span>KAM payout in this team</span><em>${t.kamRows.filter(k=>k.payout>0).length}/${t.kamRows.length} hit payout</em></div>
      ${t.kamRows.slice(0,5).map(k=>{
        // v226: show component breakdown if available in breakdown jsonb
        const bd = k.breakdown || {};
        const nrrP = bd.nrr_payout !== undefined ? _commFmtPayout(bd.nrr_payout) : null;
        const upsellP = (bd.upsell_sku && bd.upsell_sku.total_commission !== undefined) ? _commFmtPayout(bd.upsell_sku.total_commission + ((bd.upsell_outlet && bd.upsell_outlet.commission)||0)) : null;
        const handoverP = bd.handover ? _commFmtPayout(bd.handover.payout||0) : null;
        const gateTxt = bd.gmv_gate && bd.gmv_gate.gate_active ? `⚠ gate×${bd.gmv_gate.cap}` : null;
        const breakdown = nrrP ? `<span style="color:rgba(255,255,255,.5);font-size:var(--text-xs)"> NRR ${nrrP}${upsellP?' · Upsell '+upsellP:''}${handoverP?' · HO '+handoverP:''}${gateTxt?' · '+gateTxt:''}</span>` : '';
        return `<div class="comm-person-row comm-kam-payout-row ${k.payout>0?'hit':''}">
          <div>
            <div class="comm-person-name">${_commEscapeHtml(k.kamName||k.kamEmail)}</div>
            <div class="comm-person-sub">NRR ${_commFmtPct(k.pct)} · ${_commEscapeHtml(k.tierLabel||'—')}${breakdown}</div>
          </div>
          <div class="comm-person-payout ${k.payout>0?'comm-row-money hit':'comm-row-money'}">${_commFmtPayout(k.payout)}</div>
        </div>`;
      }).join('')}
      ${t.kamRows.length>5?`<div class="comm-meta comm-more-note">+${t.kamRows.length-5} more KAM in CSV/export</div>`:''}
    </div>`).join('') || `<div class="comm-empty">ยังไม่มีทีมให้ preview</div>`}
    <div class="comm-section-title">Snapshot rows</div>
    <div class="comm-lock-list">${rows.slice(0,12).map(r=>{
      const bd = r.breakdown || {};
      const isKam = r.beneficiary_role === 'kam';
      const name = _commEscapeHtml(bd.kam_name || bd.team_lead_name || r.beneficiary_email);
      let sub = `NRR ${_commFmtPct(r.governed_nrr_pct)}`;
      if (isKam && bd.nrr_payout !== undefined) {
        const parts = [`NRR ${_commFmtPayout(bd.nrr_payout)}`];
        if (bd.upsell_sku && bd.upsell_sku.total_commission > 0) parts.push(`Upsell ${_commFmtPayout(bd.upsell_sku.total_commission)}`);
        if (bd.upsell_outlet && bd.upsell_outlet.commission > 0) parts.push(`Outlet ${_commFmtPayout(bd.upsell_outlet.commission)}`);
        if (bd.handover && bd.handover.payout > 0) parts.push(`HO ${_commFmtPayout(bd.handover.payout)}`);
        if (bd.gmv_gate && bd.gmv_gate.gate_active) parts.push(`Gate×${bd.gmv_gate.cap}`);
        sub = parts.join(' · ');
      } else if (!isKam && bd.upsell_mult) {
        sub = `NRR ${_commFmtPayout(bd.nrr_payout||0)} × ${bd.upsell_mult.multiplier||1}× (Upsell ${bd.upsell_mult.team_upsell_pct||0}%)`;
      }
      return `<div class="comm-lock-row">
        <div class="comm-role-dot ${r.beneficiary_role}">${r.beneficiary_role.toUpperCase()}</div>
        <div><div class="comm-person-name">${name}</div><div class="comm-person-sub">${sub}</div></div>
        <div class="comm-row-money ${Number(r.payout_amount||0)>0?'hit':''}">${_commFmtPayout(r.payout_amount)}</div>
      </div>`;
    }).join('')}</div>
    </div>
    ${rows.length===0?'<div class="comm-empty" style="padding:16px;text-align:center">ยังไม่มี snapshot rows · กด Compute เพื่อสร้าง</div>':''}
  `;
}

// v879 (Commission Setup redesign, phase 4): generic save for the 5
// non-NRR per-scheme components (Gate/TL-mult/Upsell P1/P3/Expansion/
// Handover) staged in _commComponentRulePending. Handles both tier-shaped
// metrics (draft.tiers -> commission_rule_tiers, like NRR) and Handover's
// tier_config jsonb (no tier rows at all) uniformly. MUST run after
// saveCommissionRules() in the save sequence — that's what guarantees
// _commRuleConfig.plans[planCode].id is a real, persisted uuid by the time
// this reads it (a brand-new role's plan has id:null until saved).
const _COMM_METRIC_DEFAULTS = {
  portfolio_gate: { measurement_scope:'governed_nrr', payout_type:'lock_percent' },
  tl_upsell_mult: { measurement_scope:'team_upsell_pct', payout_type:'lock_percent' },
  upsell_gmv:     { measurement_scope:'gmv_raw', payout_type:'rate_percent' },
  handover:       { measurement_scope:'governed_nrr', payout_type:'flat_amount' },
};
async function saveCommissionComponentRulesByScheme() {
  const keys = Object.keys(_commComponentRulePending || {});
  if (!keys.length) return;
  const skipped = [];
  for (const key of keys) {
    const parts = key.split('|');
    const planCode = parts[0], metricCode = parts[1], metricVariant = parts[2] || null;
    const plan = (_commRuleConfig.plans || {})[planCode];
    if (!plan || !plan.id) {
      // Should be unreachable in the normal save order (saveCommissionRules
      // persists every _commRulePending plan first) — but if it ever fires,
      // the user MUST know their component edit didn't land. The old code
      // console.warn'd and then wiped the draft below, silently losing the
      // staged rates while the save toast still said สำเร็จ.
      console.warn('[Commission Setup] skipped component save — plan not persisted yet', key);
      skipped.push(key);
      continue;
    }
    const draft = _commComponentRulePending[key];
    const defaults = _COMM_METRIC_DEFAULTS[metricCode] || { measurement_scope:'governed_nrr', payout_type:'flat_amount' };

    let existQuery = supa.from('commission_rules').select('id').eq('plan_id', plan.id).eq('metric_code', metricCode);
    existQuery = metricVariant ? existQuery.eq('metric_variant', metricVariant) : existQuery.is('metric_variant', null);
    const { data: existingRows, error: exErr } = await existQuery.limit(1);
    if (exErr) throw new Error(exErr.message);
    const existingId = existingRows && existingRows[0] && existingRows[0].id;

    const rulePayload = {
      plan_id: plan.id,
      metric_code: metricCode,
      metric_variant: metricVariant,
      measurement_scope: draft.measurement_scope || defaults.measurement_scope,
      payout_type: draft.payout_type || defaults.payout_type,
      active: draft.active !== false,
      params: draft.params || {},
      tier_config: draft.tier_config || null,
      updated_at: new Date().toISOString()
    };

    let ruleId;
    if (existingId) {
      const { error } = await supa.from('commission_rules').update(rulePayload).eq('id', existingId);
      if (error) throw new Error(error.message);
      ruleId = existingId;
    } else {
      const { data, error } = await supa.from('commission_rules').insert(rulePayload).select('id').single();
      if (error) throw new Error(error.message);
      ruleId = data.id;
    }

    if (Array.isArray(draft.tiers)) {
      const { error: delErr } = await supa.from('commission_rule_tiers').delete().eq('rule_id', ruleId);
      if (delErr) throw new Error(delErr.message);
      const tierRows = draft.tiers.map((t, idx) => ({
        rule_id: ruleId,
        tier_order: idx + 1,
        min_value: t.min_value === '' ? null : t.min_value,
        max_value: t.max_value === '' ? null : t.max_value,
        payout_value: Number(t.payout_value || 0),
        payout_label: t.payout_label || ''
      }));
      if (tierRows.length) {
        const { error: insErr } = await supa.from('commission_rule_tiers').insert(tierRows);
        if (insErr) throw new Error(insErr.message);
      }
      if (!_commRuleConfig.tiers) _commRuleConfig.tiers = {};
      _commRuleConfig.tiers[ruleId] = tierRows.map((t, idx) => ({ ...t, id: `local-${ruleId}-${idx}` }));
    }

    if (!_commRuleConfig.componentRules) _commRuleConfig.componentRules = {};
    const cacheKey = `${plan.id}|${metricCode}|${metricVariant || ''}`;
    _commRuleConfig.componentRules[cacheKey] = {
      id: ruleId, plan_id: plan.id, metric_code: metricCode, metric_variant: metricVariant,
      active: rulePayload.active, params: rulePayload.params, tier_config: rulePayload.tier_config
    };
    delete _commComponentRulePending[key];
  }
  // Only successfully-saved keys were deleted above — skipped drafts stay
  // staged (Save button stays lit) instead of being silently discarded.
  if (skipped.length && typeof showToast === 'function') {
    showToast(`บาง component ยังไม่ถูกบันทึก (${skipped.length}) — กด Save อีกครั้ง ถ้ายังไม่หายให้แจ้ง dev`, '!');
  }
}
window.saveCommissionComponentRulesByScheme = saveCommissionComponentRulesByScheme;

async function saveCommissionRules() {
  const drafts = Object.values(_commRulePending || {});
  if (!drafts.length) return;
  const actor = (currentUserProfile && currentUserProfile.email) || '';

  for (const draft of drafts) {
    const planPayload = {
      plan_code: draft.plan_code,
      plan_name: draft.plan_name || _commPlanName(draft.role),
      beneficiary_role: draft.beneficiary_role || draft.role,
      status: 'active',
      updated_by: actor,
      updated_at: new Date().toISOString()
    };

    const { data: savedPlan, error: planErr } = await supa.from('commission_plans')
      .upsert(planPayload, { onConflict: 'plan_code' })
      .select('id,plan_code,plan_name,beneficiary_role,status')
      .single();
    if (planErr) throw new Error(planErr.message);

    let ruleId = null;
    const { data: existingRules, error: exRuleErr } = await supa.from('commission_rules')
      .select('id')
      .eq('plan_id', savedPlan.id)
      .eq('metric_code', 'nrr')
      .limit(1);
    if (exRuleErr) throw new Error(exRuleErr.message);

    ruleId = existingRules && existingRules[0] && existingRules[0].id;
    if (ruleId) {
      const { error: updRuleErr } = await supa.from('commission_rules').update({
        measurement_scope: draft.measurement_scope || 'governed_nrr',
        payout_type: draft.payout_type || 'flat_amount',
        stacking_mode: 'best_match',
        active: true,
        updated_at: new Date().toISOString()
      }).eq('id', ruleId);
      if (updRuleErr) throw new Error(updRuleErr.message);
    } else {
      const { data: ruleRow, error: insRuleErr } = await supa.from('commission_rules').insert({
        plan_id: savedPlan.id,
        metric_code: 'nrr',
        measurement_scope: draft.measurement_scope || 'governed_nrr',
        payout_type: draft.payout_type || 'flat_amount',
        stacking_mode: 'best_match',
        active: true
      }).select('id').single();
      if (insRuleErr) throw new Error(insRuleErr.message);
      ruleId = ruleRow.id;
    }

    const { error: delTierErr } = await supa.from('commission_rule_tiers').delete().eq('rule_id', ruleId);
    if (delTierErr) throw new Error(delTierErr.message);

    const tierRows = (draft.tiers || []).map((t, idx) => ({
      rule_id: ruleId,
      tier_order: idx + 1,
      min_value: t.min_value === '' ? null : t.min_value,
      max_value: t.max_value === '' ? null : t.max_value,
      payout_value: Number(t.payout_value || 0),
      payout_label: t.payout_label || ''
    }));
    if (tierRows.length) {
      const { error: tierErr } = await supa.from('commission_rule_tiers').insert(tierRows);
      if (tierErr) throw new Error(tierErr.message);
    }

    if (!_commRuleConfig.plans) _commRuleConfig.plans = {};
    if (!_commRuleConfig.rules) _commRuleConfig.rules = {};
    if (!_commRuleConfig.tiers) _commRuleConfig.tiers = {};
    _commRuleConfig.plans[draft.plan_code] = savedPlan;
    _commRuleConfig.rules[savedPlan.id] = {
      id: ruleId,
      plan_id: savedPlan.id,
      metric_code: 'nrr',
      measurement_scope: draft.measurement_scope || 'governed_nrr',
      payout_type: draft.payout_type || 'flat_amount',
      stacking_mode: 'best_match',
      active: true
    };
    _commRuleConfig.tiers[ruleId] = tierRows.map((t, idx) => ({ ...t, id: `local-${ruleId}-${idx}` }));
  }

  _commRulePending = {};
  if (_tgtActiveQuarter) delete _tgtQuarterCache[_tgtActiveQuarter];
  // v210f: keep cockpit stable after save. Do not full-reload/render here; next open/quarter load will verify Supabase persistence.
}

async function saveCommissionCockpit() {
  if (!currentUserProfile || !isAdminRole(getCurrentRole())) {
    if (typeof showToast === 'function') showToast('Commission settings บันทึกได้เฉพาะ Admin', '!');
    return;
  }
  const btn = document.querySelector('#commission-cockpit-overlay .comm-save');
  if (!_commHasPendingChanges()) {
    if (typeof showToast === 'function') showToast('ยังไม่มี change ใหม่ให้บันทึก', 'ok');
    _commUpdateSaveButtonState();
    return;
  }
  const validation = _commValidateDrafts();
  const firstInvalid = _commFirstValidationPlan(validation);
  if (firstInvalid) {
    // Keep the user in the Setup role-detail page when that's where they
    // are editing — the NRR editor there renders the same inline validation
    // errors. Bouncing to the Advanced 'rules' step mid-Setup (the old
    // behavior) read as "save silently failed and dumped me somewhere else"
    // — that exact confusion was reported for the AD-role setup flow.
    const stayInSetup = _commCockpitStep === 'setup' && _commSetupDetailRole;
    if (!stayInSetup) {
      _commSelectedRuleCode = firstInvalid;
      _commCockpitStep = 'rules';
    }
    renderCommissionCockpit();
    if (typeof showToast === 'function') showToast('กรุณาแก้ rule ที่ยังไม่ครบก่อน save', '!');
    setTimeout(()=>{
      const el = document.querySelector('#commission-cockpit-overlay .comm-input.invalid, #commission-cockpit-overlay .comm-select.invalid');
      if (el) el.focus({preventScroll:false});
    }, 80);
    return;
  }
  if (btn) { btn.disabled = true; btn.classList.add('saving'); btn.classList.remove('no-changes','has-changes'); btn.textContent = 'Saving'; }
  try {
    await saveCommissionPoliciesFromCockpit();
    await saveCommissionRules();
    await saveCommissionComponentRulesByScheme();
    await saveCommissionAssignments();
    if (Object.keys(_commComponentPending||{}).length) await saveCommissionComponentRates();
    _commValidationErrors = {};
    if (btn) { btn.classList.remove('saving'); btn.classList.add('saved'); btn.textContent = 'Saved'; }
    _commSoftenPostSaveUi();
    if (typeof showToast === 'function') showToast('บันทึก Commission สำเร็จ', 'ok');
    try { renderTeamviewSummary(); renderTeamviewKamList(); } catch(e) {}
    setTimeout(()=>{
      if(btn){ btn.classList.remove('saved'); }
      _commUpdateSaveButtonState();
    }, 520);
  } catch(e) {
    console.error('[Commission cockpit] save failed', e);
    if (typeof showToast === 'function') showToast('Save ไม่สำเร็จ: ' + (e.message || ''), '!');
    if (btn) { btn.classList.remove('saving'); btn.textContent = 'Save changes'; btn.disabled = false; }
    _commUpdateSaveButtonState();
  }
}
async function saveCommissionAssignments() {
  const entries = Object.entries(_commAssignmentPending || {});
  if (!entries.length) return;
  const actor = (currentUserProfile && currentUserProfile.email) || '';
  // Persist any locally cloned plan first so assignment has a real plan_id.
  for (const [, planCode] of entries) {
    const plan = ((_commRuleConfig && _commRuleConfig.plans) || {})[planCode];
    if (plan && !plan.id) {
      const draft = _commRulePending[planCode] || {
        role: plan.beneficiary_role,
        plan_code: plan.plan_code,
        plan_name: plan.plan_name,
        beneficiary_role: plan.beneficiary_role,
        payout_type:'flat_amount',
        measurement_scope:'governed_nrr',
        tiers:_commDefaultTiers(plan.beneficiary_role)
      };
      const { data: savedPlan, error: planErr } = await supa.from('commission_plans')
        .upsert({
          plan_code: draft.plan_code,
          plan_name: draft.plan_name,
          beneficiary_role: draft.beneficiary_role || draft.role,
          status:'active',
          updated_by: actor,
          updated_at: new Date().toISOString()
        }, { onConflict:'plan_code' })
        .select('id,plan_code,plan_name,beneficiary_role,status')
        .single();
      if (planErr) throw new Error(planErr.message);
      _commRuleConfig.plans[planCode] = savedPlan;
      plan.id = savedPlan.id;
    }
  }
  const rows = entries.map(([key, planCode]) => {
    const [period, scope, assignee] = key.split('|');
    const plan = ((_commRuleConfig && _commRuleConfig.plans) || {})[planCode] || {};
    return {
      period_month: period,
      plan_id: plan.id,
      plan_code: planCode,
      assignment_scope: scope,
      assignee_key: assignee,
      team_lead_email: scope === 'tl' ? assignee : null,
      created_by: actor,
      updated_by: actor,
      updated_at: new Date().toISOString()
    };
  }).filter(r => r.plan_id);
  try {
    let { error } = await supa.from('commission_plan_assignments').upsert(rows, { onConflict:'period_month,assignment_scope,assignee_key' });
    if (error && /plan_code/.test(error.message || '')) {
      const writeRows = rows.map(({ plan_code, ...r }) => r);
      const fb = await supa.from('commission_plan_assignments').upsert(writeRows, { onConflict:'period_month,assignment_scope,assignee_key' });
      error = fb.error;
    }
    if (error) throw new Error(error.message);
    _commRuleConfig.assignments = [
      ...(((_commRuleConfig && _commRuleConfig.assignments) || []).filter(a => !entries.some(([key]) => {
        const [p,s,k] = key.split('|'); return a.period_month===p && a.assignment_scope===s && a.assignee_key===k;
      }))),
      ...rows
    ];
    _commAssignmentPending = {};
    // v210f: parent saveCommissionCockpit owns success feedback. Avoid inner render/toast that caused visible flash.
  } catch(e) {
    console.error('[Commission assignments] save failed', e);
    if (typeof showToast === 'function') showToast('บันทึก assignment ไม่สำเร็จ: ' + (e.message || ''), '!');
  }
}


// v288: renderCommissionLockTab — shows stored draft/final rows from Supabase
// Compute button = _commBuildSnapshotRows() → save draft
// Lock button    = draft → final (no recompute)
function renderCommissionLockTab() {
  const body = document.getElementById('tgt-sheet-body');
  if (!body) return;
  const period = _nrrExclusionCurrentPeriod();
  // Prefer stored rows — live compute only if nothing stored yet
  const storedRows = (_commissionSnapshots || []).filter(r => r.period_month === period);
  const finalRows  = storedRows.filter(r => r.snapshot_status === 'final');
  const draftRows  = storedRows.filter(r => r.snapshot_status === 'draft');
  const displayRows = finalRows.length ? finalRows : draftRows.length ? draftRows : [];
  const pending = (_nrrExclusions || []).filter(r => r.period_month === period && (r.status === 'submitted' || r.status === 'pending')).length;
  const isLocked = finalRows.length > 0;
  const isDraft  = !isLocked && draftRows.length > 0;
  const total    = displayRows.reduce((s,r)=>s+Number(r.payout_amount||0),0);
  // Status label
  const statusLabel = isLocked
    ? `🔒 Locked · ${finalRows.length} rows · ${_commFmtPayout(total)}`
    : isDraft
      ? `Draft · ${draftRows.length} rows · ${_commFmtPayout(total)} · ยังไม่ได้ lock`
      : 'ยังไม่มี snapshot — กด Compute ก่อน';
  const statusCls = isLocked ? 'final' : isDraft ? 'draft' : '';
  body.innerHTML = `
    <div class="tgt-lock-hero">
      <div class="tgt-lock-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--ink-blue),.95)" stroke-width="2.3" stroke-linecap="round"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        Period Lock & Snapshot
      </div>
      <div class="tgt-lock-sub">${period} · Compute เพื่อ freeze ตัวเลข → ตรวจ → Lock เพื่อ confirm จ่ายเงิน</div>
      <span class="tgt-lock-status ${statusCls}">${statusLabel}</span>
      ${pending ? `<div class="tgt-lock-warning">ยังมี exclusion pending ${pending} รายการ — approve ก่อน lock จะได้ตัวเลขถูกต้อง</div>` : ''}
      <div class="tgt-lock-actions">
        <button class="tgt-lock-btn secondary" onclick="exportCommissionSnapshotCsv()" ${!displayRows.length?'disabled':''}>Export CSV</button>
        <button class="tgt-lock-btn outline" onclick="computeCommissionDraft()">↻ Compute</button>
        <button class="tgt-lock-btn primary" onclick="lockCommissionSnapshot()" ${!isDraft&&!isLocked?'disabled':''}>${isLocked ? 'Re-lock' : 'Lock Final'}</button>
      </div>
    </div>
    ${displayRows.length ? `<div class="tgt-snap-table-wrap">
      <table class="tgt-snap-table">
        <thead><tr><th>Role</th><th>Beneficiary</th><th>TL</th><th>NRR%</th><th>Payout</th><th>Status</th></tr></thead>
        <tbody>
          ${displayRows.map(r => `<tr>
            <td><span class="tgt-snap-role ${r.beneficiary_role}">${r.beneficiary_role.toUpperCase()}</span></td>
            <td><div class="tgt-snap-name">${r.breakdown?.kam_name || r.breakdown?.team_lead_name || r.beneficiary_email}</div><div class="tgt-preview-meta">${r.beneficiary_email}</div></td>
            <td>${r.team_lead_email || '—'}</td>
            <td class="tgt-snap-mono">${_commFmtPct(r.governed_nrr_pct)}</td>
            <td class="tgt-snap-mono">${_commFmtPayout(r.payout_amount)}</td>
            <td><span class="tgt-snap-status ${r.snapshot_status||''}">${r.snapshot_status==='final'?'🔒':'Draft'}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `<div class="tgt-lock-empty">กด Compute เพื่อสร้าง snapshot</div>`}
    <div class="tgt-rule-note">Compute = บันทึก draft · Lock = confirm final · Export ดึงจาก stored rows ไม่ recompute</div>
    </div>
  `;
}


function renderCommissionPreviewTab() {
  const body = document.getElementById('tgt-sheet-body');
  if (!body) return;
  const model = _commBuildPreviewModel();
  if (!model.kamRows.length && model.teamPct === null) {
    body.innerHTML = `<div class="tgt-preview-empty">ยังไม่มีข้อมูลพอสำหรับ preview<br><span style="font-size:var(--text-xs);color:rgba(255,255,255,.52)">โหลด portview.csv / history ก่อน แล้วกลับมาที่หน้านี้</span></div>`;
    return;
  }
  const teamTier = _commMatchTier('tl', model.teamPct);
  body.innerHTML = `
    <div class="tgt-preview-hero">
      <div class="tgt-preview-head">
        <div>
          <div class="tgt-preview-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(100,170,255,.9)" stroke-width="2.2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 4 4 5-8"/></svg>
            Commission Preview
          </div>
          <div class="tgt-preview-sub">Estimate จาก NRR ปัจจุบัน + payout tier ที่ admin ตั้งไว้ ยังไม่ใช่ยอดจ่าย final</div>
        </div>
        <div class="tgt-preview-total">
          <div class="tgt-preview-total-label">Exposure</div>
          <div class="tgt-preview-total-val">${_commFmtPayout(model.totalExposure)}</div>
        </div>
      </div>
      <div class="tgt-preview-grid">
        <div class="tgt-preview-kpi">
          <div class="tgt-preview-kpi-label">Team NRR</div>
          <div class="tgt-preview-kpi-val">${_commFmtPct(model.teamPct)}</div>
        </div>
        <div class="tgt-preview-kpi">
          <div class="tgt-preview-kpi-label">TL payout</div>
          <div class="tgt-preview-kpi-val">${_commFmtPayout(model.tlPayout)}</div>
        </div>
        <div class="tgt-preview-kpi">
          <div class="tgt-preview-kpi-label">KAM payout</div>
          <div class="tgt-preview-kpi-val">${_commFmtPayout(model.kamTotal)}</div>
        </div>
      </div>
      <div class="tgt-rule-note">TL tier: ${teamTier ? (teamTier.payout_label || 'matched tier') : 'no matched tier'} · Governed NRR currently equals Raw NRR until exclusion workflow is active</div>
    </div>
    <div class="tgt-preview-section-title">
      <span>KAM payout estimate</span>
      <span style="font-family:monospace;color:rgba(255,255,255,.52)">${model.kamRows.length} KAM</span>
    </div>
    ${model.kamRows.map(r => {
      const cls = r.pct === null ? '' : (r.pct >= (_tgtSettings.nrr_threshold || 98) ? 'ok' : 'warn');
      return `<div class="tgt-preview-row">
        <div class="tgt-preview-row-top">
          <div>
            <div class="tgt-preview-name">${r.kamName || r.kamEmail || 'ไม่ระบุ'}</div>
            <div class="tgt-preview-meta">${r.accounts || 0} accounts · ${r.kamEmail || ''}</div>
          </div>
          <div class="tgt-preview-payout">${_commFmtPayout(r.payout)}</div>
        </div>
        <div class="tgt-preview-row-bottom">
          <span class="tgt-preview-chip ${cls}">NRR ${_commFmtPct(r.pct)}</span>
          <span class="tgt-preview-chip">Tier ${r.tierLabel || '—'}</span>
          <span class="tgt-preview-chip">Pace ${r.pace !== null ? r.pace + '%' : '—'}</span>
        </div>
      </div>`;
    }).join('')}`;
}


function renderPayoutRulesTab() {
  const body = document.getElementById('tgt-sheet-body');
  if (!body) return;
  const roles = ['tl','kam'];
  body.innerHTML = `
    <div class="tgt-rule-note" style="margin:0 2px 12px">
      Admin ตั้ง NRR payout tier ได้จากตรงนี้ รอบนี้รองรับ standard plan สำหรับ TL และ KAM ก่อน ส่วน assignment per TL / KAM-under-TL จะต่อยอด phase ถัดไป
    </div>
    ${roles.map(role => _renderPayoutRuleBlock(role)).join('')}`;
}
function _renderPayoutRuleBlock(role) {
  const d = _commGetDraft(role);
  const title = role === 'tl' ? 'TL NRR Commission' : 'KAM NRR Commission';
  const sub = role === 'tl'
    ? 'ใช้กับ Team Lead payout จาก Team Governed NRR'
    : 'ใช้กับ KAM payout จาก Individual Governed NRR';
  return `<div class="tgt-rule-block" data-role="${role}">
    <div class="tgt-rule-head">
      <div>
        <div class="tgt-rule-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--tk-ok-bright)" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7H14.5a3.5 3.5 0 0 1 0 7H6"/></svg>
          ${title}
        </div>
        <div class="tgt-rule-sub">${sub}</div>
      </div>
      <span class="tgt-rule-pill">${d.measurement_scope === 'governed_nrr' ? 'Governed NRR' : 'Raw NRR'}</span>
    </div>
    <div class="tgt-rule-grid">
      <div class="tgt-rule-field">
        <label>Plan name</label>
        <input class="tgt-rule-input" value="${d.plan_name || ''}" oninput="onPayoutRuleHeader('${role}','plan_name',this.value)">
      </div>
      <div class="tgt-rule-field">
        <label>Payout type</label>
        <select class="tgt-rule-select" onchange="onPayoutRuleHeader('${role}','payout_type',this.value)">
          <option value="flat_amount" ${d.payout_type === 'flat_amount' ? 'selected' : ''}>Flat amount</option>
          <option value="bonus_amount" ${d.payout_type === 'bonus_amount' ? 'selected' : ''}>Bonus amount</option>
        </select>
      </div>
    </div>
    <table class="tgt-rule-table">
      <thead><tr><th style="width:22%">Min %</th><th style="width:22%">Max %</th><th style="width:24%">Payout</th><th>Label</th><th style="width:30px"></th></tr></thead>
      <tbody>
        ${(d.tiers || []).map((t, i) => `<tr>
          <td><input class="tgt-rule-tier-input" value="${t.min_value ?? ''}" placeholder="-" oninput="onPayoutTierInput('${role}',${i},'min_value',this.value)"></td>
          <td><input class="tgt-rule-tier-input" value="${t.max_value ?? ''}" placeholder="∞" oninput="onPayoutTierInput('${role}',${i},'max_value',this.value)"></td>
          <td><input class="tgt-rule-tier-input" value="${t.payout_value ?? 0}" oninput="onPayoutTierInput('${role}',${i},'payout_value',this.value)"></td>
          <td><input class="tgt-rule-tier-label" value="${t.payout_label || ''}" oninput="onPayoutTierInput('${role}',${i},'payout_label',this.value)"></td>
          <td><button class="tgt-rule-del" onclick="removePayoutTier('${role}',${i})">×</button></td>
        </tr>`).join('')}
      </tbody>
    </table>
    <button class="tgt-rule-add" onclick="addPayoutTier('${role}')">+ เพิ่ม tier</button>
    <div class="tgt-rule-note">ช่วง tier ใช้หลัก min inclusive / max exclusive เช่น 98.5 ถึง 99.0 หมายถึง ≥98.5 และ &lt;99.0</div>
  </div>`;
}
function onPayoutRuleHeader(role, field, value) {
  const d = _commGetDraft(role);
  d[field] = value;
  _commSetDraft(role, d);
}
function onPayoutTierInput(role, idx, field, value) {
  const d = _commGetDraft(role);
  if (!d.tiers[idx]) return;
  if (field === 'payout_label') d.tiers[idx][field] = value;
  else d.tiers[idx][field] = value === '' ? null : Number(value);
  _commSetDraft(role, d);
}
function addPayoutTier(role) {
  const d = _commGetDraft(role);
  d.tiers.push({ min_value:null, max_value:null, payout_value:0, payout_label:'New tier' });
  _commSetDraft(role, d);
  renderPayoutRulesTab();
}
function removePayoutTier(role, idx) {
  const d = _commGetDraft(role);
  d.tiers.splice(idx, 1);
  _commSetDraft(role, d);
  renderPayoutRulesTab();
}


function onTgtInput(level, email, period, rawVal) {
  const key = `${period}|${level}|${email}`;
  const v = _tgtParseInput(rawVal);
  _tgtPendingEdits[key] = v;
  const inpId = `tgt-inp-${level}-${_tgtSafeId(email)}-${period}`;
  const inp = document.getElementById(inpId);
  if (inp) inp.classList.toggle('changed', v > 0);
  if (_tgtMode === 'tl') _tgtRefreshAllocBar();
}

function onTgtNrrInput(val) {
  const v = parseFloat(val);
  if (v >= 50 && v <= 110) {
    _tgtPendingEdits['__nrr_threshold'] = v;
  }
}

function onNrrPolicyChange(periodMonth, field, value) {
  const key = _nrrGovKey(periodMonth, 'all', 'all');
  const current = _nrrGovGetPending(periodMonth, 'all', 'all');
  const next = { ...current, [field]: value };
  if (field === 'base_mode' && value === 'rolling_mom') next.base_month = _nrrGovPrevMonth(periodMonth);
  _nrrGovPending[key] = next;
  _commMarkChanged();
  const commOpen = document.getElementById('commission-cockpit-overlay')?.classList.contains('open');
  if (field === 'base_mode') {
    if (commOpen) renderCommissionCockpit(); else renderNrrPolicyTab();
  } else if (commOpen) {
    _commUpdateSaveButtonState();
  }
}

// ── Quarterly mode helpers ─────────────────────────────────────────────
// Get current commission_mode from all visible periods' policies
function _nrrGovGetQuarterlyMode() {
  // Read from published/pending policies — any period with commission_mode='quarterly' wins
  const allPolicies = Object.values(_nrrGovPolicies || {});
  const allPending  = Object.values(_nrrGovPending  || {});
  const combined    = [...allPending, ...allPolicies];
  const q = combined.find(function(p) { return p && p.commission_mode === 'quarterly'; });
  if (q) return 'quarterly';
  const m = combined.find(function(p) { return p && p.commission_mode === 'monthly'; });
  return m ? 'monthly' : 'monthly'; // default monthly
}

// Called from Quarterly Mode UI radio button change
function onNrrPolicyChangeMode(mode) {
  // Apply commission_mode to all visible period policies
  const now = new Date();
  const q   = _tgtActiveQuarter || _tgtCurrentQuarter();
  const months = _tgtQuarterMonths(q);
  months.forEach(function(m) {
    const key     = _nrrGovKey(m, 'all', 'all');
    const current = _nrrGovGetPending(m, 'all', 'all');
    _nrrGovPending[key] = {
      ...current,
      commission_mode: mode,
      quarter_id: mode === 'quarterly' ? '2026-Q3' : null
    };
  });
  _commMarkChanged();
  const commOpen = document.getElementById('commission-cockpit-overlay')?.classList.contains('open');
  if (commOpen) renderCommissionCockpit(); else renderNrrPolicyTab();
}
window.onNrrPolicyChangeMode = onNrrPolicyChangeMode;

function _tgtRefreshAllocBar() {
  const tlEmail = (currentUserProfile && currentUserProfile.email) || '';
  const months = _tgtQuarterMonths(_tgtActiveQuarter);
  const kams = _tgtGetKamsForTL(tlEmail);
  months.forEach(m => {
    const col = document.getElementById('tgt-alloc-mo-' + m);
    if (!col) return;
    const vp = _tgtGet(m, 'team', tlEmail);
    if (!vp) return;
    let alloc = 0;
    kams.forEach(k => {
      const key = m + '|kam|' + k.email;
      alloc += _tgtPendingEdits[key] !== undefined ? _tgtPendingEdits[key] : _tgtGet(m, 'kam', k.email);
    });
    const diff = alloc - vp;
    const pct = Math.min(110, Math.round(alloc / vp * 100));
    const barPct = Math.min(100, pct);
    const fill = col.querySelector('.tgt-alloc-fill');
    if (fill) {
      fill.className = 'tgt-alloc-fill kav-ss-bar-fill ' + (pct >= 100 ? 'great' : 'warn');
      fill.style.width = barPct + '%';
    }
    const allocEl = col.querySelector('.tgt-alloc-mo-alloc');
    if (allocEl) allocEl.textContent = alloc > 0 ? _tgtFmtM(alloc) : '';
    const diffEl = col.querySelector('.tgt-alloc-mo-diff');
    if (diffEl) {
      if (alloc === 0)     { diffEl.textContent = 'ยังไม่แบ่ง';         diffEl.className = 'tgt-alloc-mo-diff warn'; }
      else if (diff < 0)   { diffEl.textContent = 'ขาด ' + _tgtFmtM(-diff); diffEl.className = 'tgt-alloc-mo-diff warn'; }
      else if (diff === 0) { diffEl.textContent = 'ครบแล้ว';             diffEl.className = 'tgt-alloc-mo-diff ok'; }
      else                 { diffEl.textContent = '+' + _tgtFmtM(diff);  diffEl.className = 'tgt-alloc-mo-diff over'; }
    }
  });
}

// ── Save ────────────────────────────────────────────────────────
async function saveTargets() {
  const btn = document.getElementById('tgt-save-btn');
  const status = document.getElementById('tgt-status');
  if (btn) btn.disabled = true;
  if (status) { status.className = 'tgt-status'; status.style.display = 'none'; }

  const upsertRows = [];
  const setBy = (currentUserProfile && currentUserProfile.email) || '';

  Object.entries(_tgtPendingEdits).forEach(([key, val]) => {
    if (key === '__nrr_threshold') return;
    const [period, level, email] = key.split('|');
    if (!period || !level || !email) return;
    const [y, mo] = period.split('-');
    const q = Math.ceil(parseInt(mo, 10) / 3);
    upsertRows.push({
      period,
      quarter: `${y}-Q${q}`,
      level,
      set_by: setBy,
      for_email: email,
      gmv_target: val,
      updated_at: new Date().toISOString()
    });
  });

  const policyRows = Object.values(_nrrGovPending).map(p => ({
    period_month: p.period_month,
    scope_type: p.scope_type || 'all',
    scope_key: p.scope_key || 'all',
    base_mode: p.base_mode || 'rolling_mom',
    base_month: p.base_mode === 'fixed_month' ? (p.base_month || _nrrGovPrevMonth(p.period_month)) : _nrrGovPrevMonth(p.period_month),
    status: p.status || 'draft',
    updated_by: setBy,
    updated_at: new Date().toISOString()
  }));

  try {
    if (upsertRows.length > 0) {
      const { error } = await supa.from('targets').upsert(upsertRows, {
        onConflict: 'period,level,for_email'
      });
      if (error) throw new Error(error.message);
    }
    if (_tgtPendingEdits['__nrr_threshold'] !== undefined) {
      const v = _tgtPendingEdits['__nrr_threshold'];
      const { error: settingsErr } = await supa.from('target_settings').upsert({
        key: 'nrr_threshold',
        value: String(v),
        updated_by: setBy,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });
      if (settingsErr) throw new Error(settingsErr.message);
      _tgtSettings.nrr_threshold = v;
    }
    if (policyRows.length > 0) {
      const { error: policyErr } = await supa.from('nrr_policies').upsert(policyRows, {
        onConflict: 'period_month,scope_type,scope_key'
      });
      if (policyErr) throw new Error(policyErr.message);
      policyRows.forEach(r => {
        _nrrGovPolicies[_nrrGovKey(r.period_month, r.scope_type, r.scope_key)] = { ...r };
      });
      _nrrGovPending = {};
    }

    for (const draft of Object.values(_commRulePending)) {
      const planPayload = {
        plan_code: draft.plan_code,
        plan_name: draft.plan_name || _commPlanName(draft.role),
        beneficiary_role: draft.beneficiary_role || draft.role,
        status: 'active',
        updated_by: setBy,
        updated_at: new Date().toISOString()
      };
      const { data: planRows, error: planErr } = await supa.from('commission_plans')
        .upsert(planPayload, { onConflict: 'plan_code' })
        .select('id,plan_code,plan_name,beneficiary_role,status')
        .single();
      if (planErr) throw new Error(planErr.message);
      const plan = planRows;
      const { data: existingRules, error: exRuleErr } = await supa.from('commission_rules')
        .select('id')
        .eq('plan_id', plan.id)
        .eq('metric_code', 'nrr')
        .limit(1);
      if (exRuleErr) throw new Error(exRuleErr.message);
      let ruleId = existingRules && existingRules[0] && existingRules[0].id;
      if (ruleId) {
        const { error: updRuleErr } = await supa.from('commission_rules').update({
          measurement_scope: draft.measurement_scope || 'governed_nrr',
          payout_type: draft.payout_type || 'flat_amount',
          stacking_mode: 'best_match',
          active: true,
          updated_at: new Date().toISOString()
        }).eq('id', ruleId);
        if (updRuleErr) throw new Error(updRuleErr.message);
      } else {
        const { data: ruleRow, error: insRuleErr } = await supa.from('commission_rules').insert({
          plan_id: plan.id,
          metric_code: 'nrr',
          measurement_scope: draft.measurement_scope || 'governed_nrr',
          payout_type: draft.payout_type || 'flat_amount',
          stacking_mode: 'best_match',
          active: true
        }).select('id').single();
        if (insRuleErr) throw new Error(insRuleErr.message);
        ruleId = ruleRow.id;
      }
      const { error: delTierErr } = await supa.from('commission_rule_tiers').delete().eq('rule_id', ruleId);
      if (delTierErr) throw new Error(delTierErr.message);
      const tierRows = (draft.tiers || []).map((t, idx) => ({
        rule_id: ruleId,
        tier_order: idx + 1,
        min_value: t.min_value === '' ? null : t.min_value,
        max_value: t.max_value === '' ? null : t.max_value,
        payout_value: Number(t.payout_value || 0),
        payout_label: t.payout_label || ''
      }));
      if (tierRows.length) {
        const { error: tierErr } = await supa.from('commission_rule_tiers').insert(tierRows);
        if (tierErr) throw new Error(tierErr.message);
      }
      _commRuleConfig.plans[draft.plan_code] = plan;
    }
    _commRulePending = {};

    upsertRows.forEach(r => {
      _tgtCache[`${r.period}|${r.level}|${r.for_email}`] = r.gmv_target;
    });
    _tgtPendingEdits = {};
    if (_tgtActiveQuarter) delete _tgtQuarterCache[_tgtActiveQuarter];
    if (status) { status.textContent = '✓ บันทึกสำเร็จ'; status.className = 'tgt-status ok'; status.style.display = 'block'; }
    setTimeout(() => closeTargetSetup(), 900);
  } catch (e) {
    console.error('[Target] save failed:', e);
    if (status) { status.textContent = 'บันทึกไม่สำเร็จ: ' + (e.message || 'กรุณาลองใหม่'); status.className = 'tgt-status err'; status.style.display = 'block'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── NRR computation (Outlet-aware, Method 3, daily-rate normalized) ─────
// v198: cohort classification — Core / Transfer in / New from Sales / Transfer out


// v289 C: retroactive lock section
function _commRenderRetroactiveSection() {
  const now = new Date();
  const months = [];
  for (let i = 1; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    const moNames = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    months.push({ val, label: moNames[d.getMonth()] + ' ' + (d.getFullYear()+543) });
  }
  const stored = new Set((_commissionSnapshots||[]).map(r=>r.period_month));
  const sel = window._commRetroactivePeriod || months[0].val;
  const opts = months.map(m => '<option value="' + m.val + '"' + (m.val===sel?' selected':'') + '>' + m.label + (stored.has(m.val)?' ✓':'') + '</option>').join('');
  const sRows  = (_commissionSnapshots||[]).filter(r => r.period_month === sel);
  const sFinal = sRows.filter(r => r.snapshot_status==='final');
  const sDraft  = sRows.filter(r => r.snapshot_status==='draft');
  const disp    = sFinal.length ? sFinal : sDraft.length ? sDraft : [];
  const locked  = sFinal.length > 0;
  const draft   = !locked && sDraft.length > 0;
  const stTxt   = locked ? 'Locked' : draft ? 'Draft' : 'ไม่มี snapshot';
  const stClr   = locked ? '#ffe08a' : draft ? 'rgba(255,224,138,.55)' : 'rgba(var(--ink-blue-hi),.30)';
  const tot     = disp.reduce((s,r)=>s+Number(r.payout_amount||0),0);

  const tRows = disp.map(r => {
    const bd = r.breakdown || {};
    const nm = _commEscapeHtml(bd.kam_name||bd.team_lead_name||r.beneficiary_email);
    return '<tr><td><span class="tgt-snap-role ' + r.beneficiary_role + '">' + r.beneficiary_role.toUpperCase() + '</span></td>'
      + '<td><div class="tgt-snap-name">' + nm + '</div><div class="tgt-preview-meta">' + _commEscapeHtml(r.beneficiary_email) + '</div></td>'
      + '<td class="tgt-snap-mono">' + _commFmtPct(r.governed_nrr_pct) + '</td>'
      + '<td class="tgt-snap-mono">' + _commFmtPayout(r.payout_amount) + '</td>'
      + '<td><span class="tgt-snap-status ' + (r.snapshot_status||'') + '">' + (r.snapshot_status==='final'?'[L]':'Draft') + '</span></td>'
      + '</tr>';
  }).join('');

  const tHtml = disp.length
    ? '<div class="tgt-snap-table-wrap" style="margin-top:10px"><table class="tgt-snap-table"><thead><tr><th>Role</th><th>Beneficiary</th><th>NRR%</th><th>Payout</th><th>Status</th></tr></thead><tbody>' + tRows + '</tbody></table></div>'
    : '<div class="tgt-lock-empty">ยังไม่มี snapshot — กด Compute</div>';

    // subtabs — allow switching back to current
  const subtabHtml = '<div class="comm-lock-subtabs" style="margin-bottom:12px">'
    + '<button class="comm-lock-subtab" onclick="_commLockSubtab=\'current\';renderCommissionCockpit()">เดือนนี้</button>'
    + '<button class="comm-lock-subtab active">Retroactive</button>'
    + '</div>';

  // status badge
  const stBadge = locked
    ? '<span style="font-size:var(--text-xs);font-weight:800;padding:3px 9px;border-radius:99px;background:rgba(255,224,138,.16);color:#ffe08a;border:1px solid rgba(255,224,138,.30)">Locked</span>'
    : draft
    ? '<span style="font-size:var(--text-xs);font-weight:800;padding:3px 9px;border-radius:99px;background:rgba(var(--ink-blue),.10);color:rgba(var(--ink-blue),.70);border:1px solid rgba(var(--ink-blue),.20)">Draft</span>'
    : '<span style="font-size:var(--text-xs);color:rgba(var(--ink-blue-hi),.52)">ไม่มี snapshot</span>';

  // row status badge
  const rowStatusBadge = (status) => status === 'final'
    ? '<span style="font-size:var(--text-2xs);font-weight:800;padding:2px 7px;border-radius:99px;background:rgba(255,224,138,.14);color:#ffe08a;border:1px solid rgba(255,224,138,.25)">Locked</span>'
    : '<span style="font-size:var(--text-2xs);font-weight:var(--fw-bold);padding:2px 7px;border-radius:99px;background:rgba(var(--ink-blue),.08);color:rgba(var(--ink-blue),.55);border:1px solid rgba(var(--ink-blue),.14)">Draft</span>';

  const tRows2 = disp.map(r => {
    const bd = r.breakdown || {};
    const nm = _commEscapeHtml(bd.kam_name||bd.team_lead_name||r.beneficiary_email);
    return '<div class="comm-lock-row">'
      + '<div class="comm-role-dot ' + r.beneficiary_role + '">' + r.beneficiary_role.toUpperCase() + '</div>'
      + '<div style="flex:1;min-width:0"><div class="comm-person-name">' + nm + '</div>'
      + '<div class="comm-person-sub" style="font-size:var(--text-xs)">' + _commEscapeHtml(r.beneficiary_email||'') + '</div></div>'
      + '<div style="text-align:right;flex-shrink:0">'
      + '<div class="comm-row-money ' + (Number(r.payout_amount||0)>0?'hit':'') + '">' + _commFmtPayout(r.payout_amount) + '</div>'
      + '<div style="margin-top:3px">' + rowStatusBadge(r.snapshot_status) + '</div>'
      + '</div>'
      + '</div>';
  }).join('');

  const tHtml2 = disp.length
    ? '<div style="margin-top:8px">' + tRows2 + '</div>'
    : '<div class="comm-empty">ยังไม่มี snapshot — กด Compute draft</div>';

  return '<div class="comm-section-title" style="margin-top:4px"><span>Retroactive Lock</span><em>ล็อคย้อนหลังสำหรับเดือนที่ผ่านไปแล้ว</em></div>'
    + '<div class="comm-card" style="padding:14px 16px;margin-bottom:8px">'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
    + '<label style="font-size:var(--text-sm);color:rgba(var(--ink-blue),.75);white-space:nowrap">Period</label>'
    + '<select class="comm-select" style="flex:1" onchange="window._commRetroactivePeriod=this.value;renderCommissionCockpit()">' + opts + '</select>'
    + stBadge
    + '</div>'
    + '<div style="display:flex;gap:7px;flex-wrap:wrap">'
    + '<button class="tgt-lock-btn outline" style="flex:1;min-width:100px" onclick="computeCommissionDraft(window._commRetroactivePeriod||\'' + sel.replace(/'/g,"\\'") + '\')">↻ Compute</button>'
    + '<button class="tgt-lock-btn secondary" style="flex:1;min-width:100px"' + (!disp.length?' disabled':'') + ' onclick="exportCommissionSnapshotCsv(window._commRetroactivePeriod||\'' + sel.replace(/'/g,"\\'") + '\')">Export CSV</button>'
    + '<button class="tgt-lock-btn primary" style="flex:1;min-width:100px"' + (!draft&&!locked?' disabled':'') + ' onclick="lockCommissionSnapshot(window._commRetroactivePeriod||\'' + sel.replace(/'/g,"\\'") + '\')">' + (locked ? 'Re-lock' : 'Lock Final') + '</button>'
    + '</div>'
    + (disp.length ? '<div style="font-size:var(--text-xs);color:rgba(var(--ink-blue),.45);margin-top:8px">' + disp.length + ' rows · ' + _commFmtPayout(tot) + '</div>' : '')
    + '</div>'
    + tHtml2
    + '<div class="tgt-rule-note" style="margin-top:8px">Backfill: BigQuery SQL → Compute → Lock Final</div>';
}
window._commRenderRetroactiveSection = _commRenderRetroactiveSection;
window._commRetroactivePeriod = null;
