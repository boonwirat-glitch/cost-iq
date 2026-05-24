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
        <button class="comm-step" id="comm-step-assignment" onclick="switchCommissionStep('assignment')">2 Assignment</button>
        <button class="comm-step" id="comm-step-rules" onclick="switchCommissionStep('rules')">3 Rules</button>
        <button class="comm-step" id="comm-step-exceptions" onclick="switchCommissionStep('exceptions')">4 Exceptions</button>
        <button class="comm-step" id="comm-step-lock" onclick="switchCommissionStep('lock')">5 Preview<br>& Lock</button>
      </div>
      <div class="comm-body" id="commission-cockpit-body"></div>
      <div class="comm-footer">
        <button class="comm-secondary" data-comm-close="1" onclick="window.closeCommissionCockpit&&window.closeCommissionCockpit()">Close</button>
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
    const step = btn.classList.contains('commission-open') ? (btn.textContent && btn.textContent.includes('Review') ? 'exceptions' : 'lock') : 'lock';
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
  const found = ((_commRuleConfig && _commRuleConfig.assignments) || []).find(a => a.period_month === period && a.assignment_scope === scope && a.assignee_key === assignee);
  if (!found) return _commPlanCode(role);
  const rawCode = found.plan_code || Object.values(((_commRuleConfig&&_commRuleConfig.plans)||{})).find(p=>p.id===found.plan_id)?.plan_code || _commPlanCode(role);
  return _commActivePlanCode(rawCode, role);
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
  Object.values(tlMap).forEach(t => {
    const raw = t.tlEmail === 'unassigned' ? null : _tgtComputeKamNRR(null, t.tlEmail);
    const pct = raw ? _nrrGovernedPct(raw, null, t.tlEmail) : null;
    t.teamNrr = pct;
    t.tlPlanCode = _commGetAssignmentPlan(_nrrExclusionCurrentPeriod(), 'tl', t.tlEmail, 'tl');
    t.tlPlanName = _commPlanNameByCode(t.tlPlanCode, 'tl');
    t.tlPayout = _commPayoutForPctByCode(t.tlPlanCode, 'tl', pct);
    t.total = t.tlPayout + t.kamTotal;
  });
  return Object.values(tlMap).sort((a,b)=>b.total-a.total);
}

window.debugCommissionRules = function(){
  const plans = Object.values((_commRuleConfig && _commRuleConfig.plans) || {});
  const assignments = ((_commRuleConfig && _commRuleConfig.assignments) || []);
  console.table(plans.map(p=>({plan_code:p.plan_code, name:p.plan_name, role:p.beneficiary_role, id:p.id, status:p.status})));
  console.log('assignments', assignments);
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
  else if (_commCockpitStep === 'assignment') out = renderCommAssignmentStep(body);
  else if (_commCockpitStep === 'rules') out = renderCommRulesStep(body);
  else if (_commCockpitStep === 'exceptions') out = renderCommExceptionsStep(body);
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
    }).join('')}`;
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

function renderCommRulesStep(body) {
  const tlRules = _commRulesForRole('tl', { activeOnly:true });
  const kamRules = _commRulesForRole('kam', { activeOnly:true });
  if (!_commSelectedRuleCode || ![...tlRules, ...kamRules].some(p => p.plan_code === _commSelectedRuleCode)) _commSelectedRuleCode = (tlRules[0] && tlRules[0].plan_code) || _commPlanCode('tl');
  const selected = [...tlRules, ...kamRules].find(p => p.plan_code === _commSelectedRuleCode) || tlRules[0] || kamRules[0];
  const role = selected?.beneficiary_role || 'tl';
  body.innerHTML = `
    <div class="comm-hero">
      <div class="comm-hero-top">
        <div><div class="comm-hero-title">3. Rule Library</div><div class="comm-hero-sub">สร้าง rule หลายชุด แล้วนำไป assign ให้ TL/KAM ใน Step 2</div></div>
      </div>
    </div>
    <div class="comm-rule-actions">
      <button class="comm-create-rule-btn" onclick="_commCreateRule('tl')">+ Create TL Rule</button>
      <button class="comm-create-rule-btn" onclick="_commCreateRule('kam')">+ Create KAM Rule</button>
    </div>
    <div class="comm-rule-group-title">TL Rules</div>
    <div class="comm-rule-library">${tlRules.map(p=>_renderRuleLibraryItem(p)).join('')}</div>
    <div class="comm-rule-group-title">KAM Rules</div>
    <div class="comm-rule-library">${kamRules.map(p=>_renderRuleLibraryItem(p)).join('')}</div>
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
  const generalErr = err.general ? `<div class="comm-inline-error">${_commEscapeHtml(err.general)}</div>` : '';
  return `<div class="comm-card comm-rule-editor-card ${Object.keys(err).length?'dirty':''}">
    <div class="comm-rule-editor-head"><div><div class="comm-name">${_commEscapeHtml(d.plan_name || planCode)}${_commRulePending[planCode]?'<span class="comm-unsaved">Unsaved</span>':''}</div><div class="comm-meta">${_commEscapeHtml(d.plan_code)} · ${_commEscapeHtml(d.measurement_scope || 'governed_nrr')} · Used by ${used}</div></div><span class="comm-badge ok">Governed NRR</span></div>
    ${generalErr}
    <div class="comm-grid2">
      <div class="comm-field"><label>Rule name</label><input class="comm-input ${err.name?'invalid':''}" value="${_commEscapeHtml(d.plan_name||'')}" placeholder="เช่น KAM NRR Stretch Q3" oninput="onRuleHeaderInput('${planCode}','plan_name',this.value)">${err.name?`<div class="comm-inline-error">${_commEscapeHtml(err.name)}</div>`:''}</div>
      <div class="comm-field"><label>Payout type</label><select class="comm-select" onchange="onRuleHeaderInput('${planCode}','payout_type',this.value)">
        <option value="flat_amount" ${d.payout_type==='flat_amount'?'selected':''}>Flat amount</option>
        <option value="bonus_amount" ${d.payout_type==='bonus_amount'?'selected':''}>Bonus amount</option>
      </select></div>
    </div>
    <div class="comm-tier-helper"><span>Rule logic</span><strong>Min ≤ Governed NRR &lt; Max</strong><em>ปล่อย Min/Max ว่างได้สำหรับ open-ended tier</em></div>
    <div class="comm-table-lite comm-tier-table" style="margin-top:10px">
      <div class="comm-tier-row head"><div>Min</div><div>Max</div><div>Payout</div><div>Label</div><div></div></div>
      ${(d.tiers||[]).map((t,i)=>{
        const te = (err.tiers || {})[i] || {};
        return `<div class="comm-tier-row ${Object.keys(te).length?'rule-tier-invalid':''}">
          <input class="comm-input comm-tier-min ${te.range?'invalid':''}" value="${t.min_value ?? ''}" placeholder="-" inputmode="decimal" oninput="onRuleTierInput('${planCode}',${i},'min_value',this.value)">
          <input class="comm-input comm-tier-max ${te.range?'invalid':''}" value="${t.max_value ?? ''}" placeholder="∞" inputmode="decimal" oninput="onRuleTierInput('${planCode}',${i},'max_value',this.value)">
          <input class="comm-input comm-tier-payout ${te.payout?'invalid':''}" value="${t.payout_value ?? 0}" placeholder="0" inputmode="numeric" oninput="onRuleTierInput('${planCode}',${i},'payout_value',this.value)">
          <input class="comm-input comm-tier-label" value="${_commEscapeHtml(t.payout_label || '')}" placeholder="Label" oninput="onRuleTierInput('${planCode}',${i},'payout_label',this.value)">
          <button class="comm-del" onclick="removeRuleTier('${planCode}',${i})">×</button>
          ${(te.range||te.payout)?`<div class="comm-inline-error" style="grid-column:1 / -1">${_commEscapeHtml(te.range||te.payout)}</div>`:''}
        </div>`;
      }).join('')}
    </div>
    <button class="comm-add" onclick="addRuleTier('${planCode}')">+ เพิ่ม tier</button>
    <div class="comm-rule-editor-actions">
      <button class="comm-archive-rule-btn" ${isStandard?'disabled title="Standard rule cannot be archived"':''} onclick="archiveCommissionRule('${planCode}')">Archive rule</button>
    </div>
    <div class="comm-plan-note">Rule นี้จะกระทบทุก TL/KAM ที่ assign ใช้ rule นี้ใน Step 2 · Archive จะเปลี่ยน status เป็น inactive ไม่ลบข้อมูลย้อนหลัง</div>
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

function renderCommExceptionsStep(body) {
  _nrrExclusionView = _nrrExclusionView || 'pending';
  const savedBody = document.getElementById('tgt-sheet-body');
  // Render a clean, embedded copy instead of reusing the old target body.
  const current = _nrrExclusionCurrentPeriod();
  const rows = (_nrrExclusions || []).filter(r => r.period_month === current);
  const pending = rows.filter(r => r.status === 'submitted' || r.status === 'pending');
  const approved = rows.filter(r => r.status === 'approved');
  body.innerHTML = `
    <div class="comm-hero"><div class="comm-hero-top"><div><div class="comm-hero-title">4. Review Exceptions</div><div class="comm-hero-sub">Approved เท่านั้นที่กระทบ Governed NRR และ payout preview</div></div><span class="comm-badge ${pending.length?'warn':'ok'}">${pending.length} pending</span></div>
    <div class="comm-kpis"><div class="comm-kpi"><div class="comm-kpi-lbl">Pending</div><div class="comm-kpi-val">${pending.length}</div></div><div class="comm-kpi"><div class="comm-kpi-lbl">Approved</div><div class="comm-kpi-val">${approved.length}</div></div><div class="comm-kpi"><div class="comm-kpi-lbl">Base impact</div><div class="comm-kpi-val">${_tgtFmtM(approved.reduce((s,r)=>s+Number(r.base_gmv||r.estimated_base_gmv||0),0))}</div></div></div></div>
    ${rows.length ? rows.map(r=>_renderNrrExclusionCard(r,(currentUserProfile&&currentUserProfile.role)==='admin')).join('') : `<div class="comm-empty">ยังไม่มี exception request</div>`}`;
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
  body.innerHTML = `
    <div class="comm-hero">
      <div class="comm-hero-top">
        <div><div class="comm-hero-title">5. Preview & Lock</div><div class="comm-hero-sub">ตรวจภาพรวมก่อน lock snapshot และ export CSV</div></div>
        <div class="comm-total"><div class="comm-total-lbl">Exposure</div><div class="comm-total-val">${_commFmtPayout(summary.total)}</div></div>
      </div>
      <div class="comm-kpis">
        <div class="comm-kpi ${teamHit?'hit':'miss'}"><div class="comm-kpi-lbl">${(currentUserProfile&&currentUserProfile.role)==='admin'?'Teams':'Team NRR'}</div><div class="comm-kpi-val">${(currentUserProfile&&currentUserProfile.role)==='admin'?summary.teamCount:(model.teamPct!==null?model.teamPct+'%':'—')}</div><div class="comm-kpi-sub">${(currentUserProfile&&currentUserProfile.role)==='admin'?'TL groups in snapshot':'Target '+threshold+'%'}</div></div>
        <div class="comm-kpi ${summary.tlPayout>0?'hit payout-hit':'miss'}"><div class="comm-kpi-lbl">TL payout</div><div class="comm-kpi-val">${_commFmtPayout(summary.tlPayout)}</div><div class="comm-kpi-sub">${summary.tlRows.length} TL rows</div></div>
        <div class="comm-kpi ${summary.kamPayout>0?'hit payout-hit':'miss'}"><div class="comm-kpi-lbl">KAM payout</div><div class="comm-kpi-val">${_commFmtPayout(summary.kamPayout)}</div><div class="comm-kpi-sub">${summary.hitKams}/${summary.kamCount} KAM hit payout</div></div>
      </div>
      <div class="comm-readiness-bar ${ready?'ready':'warn'}"><span class="comm-readiness-dot"></span><div class="comm-readiness-copy">${ready?'พร้อม lock: ไม่มี pending exception และมี snapshot rows แล้ว': pending?`ยังมี exclusion pending ${pending} รายการ ถ้า lock ตอนนี้จะไม่ถูกนับ`:'ยังไม่มีข้อมูล payout ให้ lock'}</div></div>
      <div class="tgt-lock-actions"><button class="tgt-lock-btn secondary" onclick="exportCommissionSnapshotCsv()">Export CSV</button><button class="tgt-lock-btn primary" onclick="lockCommissionSnapshot()">Lock snapshot</button></div>
    </div>
    <div class="comm-section-title comm-preview-section-title"><span>By Team Lead</span><em>TL payout + KAM payout grouped by team</em></div>
    ${teams.map(t=>`<div class="comm-card comm-team-card comm-preview-team-card">
      <div class="comm-preview-tl-band">
        <div class="comm-preview-tl-left">
          <div class="comm-team-eyebrow">TEAM LEAD</div>
          <div class="comm-name">${_commEscapeHtml(t.tlName||t.tlEmail)}</div>
          <div class="comm-meta">${_commEscapeHtml(t.tlEmail||'')} · Team NRR ${t.teamNrr!==null?t.teamNrr+'%':'—'}</div>
          <div class="comm-rule-chip">TL rule · ${_commEscapeHtml(t.tlPlanName || _commPlanNameByCode(t.tlPlanCode,'tl'))}</div>
        </div>
        <div class="comm-preview-tl-money"><span>Total payout</span><strong>${_commFmtPayout(t.total)}</strong><em>TL ${_commFmtPayout(t.tlPayout)}</em></div>
      </div>
      <div class="comm-kam-subhead"><span>KAM payout in this team</span><em>${t.kamRows.filter(k=>k.payout>0).length}/${t.kamRows.length} hit payout</em></div>
      ${t.kamRows.slice(0,5).map(k=>`<div class="comm-person-row comm-kam-payout-row ${k.payout>0?'hit':''}"><div><div class="comm-person-name">${_commEscapeHtml(k.kamName||k.kamEmail)}</div><div class="comm-person-sub">NRR ${k.pct!==null?k.pct+'%':'—'} · Rule: ${_commEscapeHtml(k.planName || _commPlanNameByCode(k.planCode,'kam'))} · ${_commEscapeHtml(k.tierLabel||'—')}</div></div><div class="comm-person-payout ${k.payout>0?'comm-row-money hit':'comm-row-money'}">${_commFmtPayout(k.payout)}</div></div>`).join('')}
      ${t.kamRows.length>5?`<div class="comm-meta comm-more-note">+${t.kamRows.length-5} more KAM in CSV/export</div>`:''}
    </div>`).join('') || `<div class="comm-empty">ยังไม่มีทีมให้ preview</div>`}
    <div class="comm-section-title">Snapshot rows</div>
    <div class="comm-lock-list">${rows.slice(0,12).map(r=>`<div class="comm-lock-row"><div class="comm-role-dot ${r.beneficiary_role}">${r.beneficiary_role.toUpperCase()}</div><div><div class="comm-person-name">${_commEscapeHtml(r.breakdown?.kam_name||r.breakdown?.team_lead_name||r.beneficiary_email)}</div><div class="comm-person-sub">${_commEscapeHtml(r.breakdown?.rule_name || _commPlanNameByCode(r.breakdown?.payout_source, r.beneficiary_role))} · Raw ${r.raw_nrr_pct??'—'}% → Governed ${r.governed_nrr_pct??'—'}%</div></div><div class="comm-row-money ${Number(r.payout_amount||0)>0?'hit':''}">${_commFmtPayout(r.payout_amount)}</div></div>`).join('')}</div>`;
}

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
    _commSelectedRuleCode = firstInvalid;
    _commCockpitStep = 'rules';
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
    await saveCommissionAssignments();
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


function renderCommissionLockTab() {
  const body = document.getElementById('tgt-sheet-body');
  if (!body) return;
  const period = _nrrExclusionCurrentPeriod();
  const rows = _commBuildSnapshotRows();
  const finalRows = (_commissionSnapshots || []).filter(r => r.period_month === period && r.snapshot_status === 'final');
  const pending = (_nrrExclusions || []).filter(r => r.period_month === period && (r.status === 'submitted' || r.status === 'pending')).length;
  const total = rows.reduce((s,r)=>s+Number(r.payout_amount || 0),0);
  const finalTotal = finalRows.reduce((s,r)=>s+Number(r.payout_amount || 0),0);
  const isLocked = finalRows.length > 0;
  body.innerHTML = `
    <div class="tgt-lock-hero">
      <div class="tgt-lock-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(188,215,255,.95)" stroke-width="2.3" stroke-linecap="round"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        Period Lock & Snapshot
      </div>
      <div class="tgt-lock-sub">Freeze current governed NRR + payout estimate into commission_payout_snapshots. ใช้เป็นฐานสำหรับ export / dispute / revision ต่อไป</div>
      <span class="tgt-lock-status ${isLocked ? 'final' : ''}">${isLocked ? `Locked · ${finalRows.length} rows · ${_commFmtPayout(finalTotal)}` : `Draft preview · ${rows.length} rows · ${_commFmtPayout(total)}`}</span>
      ${pending ? `<div class="tgt-lock-warning">ยังมี exclusion pending ${pending} รายการ ถ้า lock ตอนนี้ รายการ pending จะไม่ถูกนับใน governed NRR final</div>` : ''}
      <div class="tgt-lock-actions">
        <button class="tgt-lock-btn secondary" onclick="exportCommissionSnapshotCsv()">Export CSV</button>
        <button class="tgt-lock-btn primary" onclick="lockCommissionSnapshot()">${isLocked ? 'Re-lock / revise snapshot' : 'Lock snapshot'}</button>
      </div>
    </div>
    ${rows.length ? `<div class="tgt-snap-table-wrap">
      <table class="tgt-snap-table">
        <thead><tr><th>Role</th><th>Beneficiary</th><th>TL</th><th>Raw</th><th>Governed</th><th>Payout</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td><span class="tgt-snap-role ${r.beneficiary_role}">${r.beneficiary_role.toUpperCase()}</span></td>
            <td><div class="tgt-snap-name">${r.breakdown?.kam_name || r.breakdown?.team_lead_name || r.beneficiary_email}</div><div class="tgt-preview-meta">${r.beneficiary_email}</div></td>
            <td>${r.team_lead_email || '—'}</td>
            <td class="tgt-snap-mono">${r.raw_nrr_pct !== null && r.raw_nrr_pct !== undefined ? r.raw_nrr_pct + '%' : '—'}</td>
            <td class="tgt-snap-mono">${r.governed_nrr_pct !== null && r.governed_nrr_pct !== undefined ? r.governed_nrr_pct + '%' : '—'}</td>
            <td class="tgt-snap-mono">${_commFmtPayout(r.payout_amount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `<div class="tgt-lock-empty">ยังไม่มีข้อมูลสำหรับ snapshot</div>`}
    <div class="tgt-rule-note">v208e ยังเป็น snapshot layer — ถ้าต้องแก้หลัง lock จะใช้ re-lock/revision log ใน phase ถัดไป</div>
  `;
}


function renderNrrExclusionsTab() {
  const body = document.getElementById('tgt-sheet-body');
  if (!body) return;
  const role = (currentUserProfile && currentUserProfile.role) || '';
  const isAdmin = role === 'admin';
  const current = _nrrExclusionCurrentPeriod();
  const rows = (_nrrExclusions || []).filter(r => !current || r.period_month === current);
  const filtered = rows.filter(r => {
    if (_nrrExclusionView === 'pending') return r.status === 'submitted' || r.status === 'pending';
    if (_nrrExclusionView === 'approved') return r.status === 'approved';
    if (_nrrExclusionView === 'rejected') return r.status === 'rejected';
    return true;
  });
  const pendingCount = rows.filter(r => r.status === 'submitted' || r.status === 'pending').length;
  const approvedCount = rows.filter(r => r.status === 'approved').length;
  const impact = rows.filter(r => r.status === 'approved').reduce((s,r)=>s+Number(r.base_gmv || r.estimated_base_gmv || 0),0);
  body.innerHTML = `
    <div class="tgt-excl-head">
      <div>
        <div class="tgt-excl-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(240,176,0,.9)" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
          NRR Exclusion Governance
        </div>
        <div class="tgt-excl-sub">TL request ได้ แต่ Admin เท่านั้นที่ approve/reject แล้วจึงกระทบ Governed NRR</div>
      </div>
      <span class="tgt-rule-pill">${_nrrGovMonthLabel(current)}</span>
    </div>
    <div class="tgt-preview-grid" style="margin-bottom:12px">
      <div class="tgt-preview-kpi"><div class="tgt-preview-kpi-label">Pending</div><div class="tgt-preview-kpi-val">${pendingCount}</div></div>
      <div class="tgt-preview-kpi"><div class="tgt-preview-kpi-label">Approved</div><div class="tgt-preview-kpi-val">${approvedCount}</div></div>
      <div class="tgt-preview-kpi"><div class="tgt-preview-kpi-label">Base impact</div><div class="tgt-preview-kpi-val">${_tgtFmtM(impact)}</div></div>
    </div>
    <div class="tgt-excl-tabs">
      ${['pending','approved','rejected','all'].map(v=>`<button class="tgt-excl-tab ${_nrrExclusionView===v?'active':''}" onclick="setNrrExclusionView('${v}')">${v==='pending'?'Pending':v==='approved'?'Approved':v==='rejected'?'Rejected':'All'}</button>`).join('')}
    </div>
    ${filtered.length ? filtered.map(r=>_renderNrrExclusionCard(r,isAdmin)).join('') : `<div class="tgt-preview-empty">ไม่มีรายการในสถานะนี้</div>`}
    <div class="tgt-rule-note">ตอนนี้ใช้ base impact จาก request estimate ก่อน รอบ lock จะสร้าง immutable snapshot แยกต่างหาก</div>
  `;
}
function _renderNrrExclusionCard(r, isAdmin) {
  const status = r.status === 'pending' ? 'submitted' : r.status;
  const base = Number(r.base_gmv || r.estimated_base_gmv || 0);
  const payoutImpact = 0; // precise payout delta will be calculated at snapshot phase
  return `<div class="tgt-excl-card ${status === 'submitted' ? 'pending' : status}">
    <div class="tgt-excl-top">
      <div>
        <div class="tgt-excl-name">${r.account_id || 'Account'} ${r.outlet_id ? '· '+r.outlet_id : ''}</div>
        <div class="tgt-excl-meta">${_nrrReasonLabel(r.reason_code)} · KAM ${r.target_kam_email || '—'} · TL ${r.target_tl_email || '—'}</div>
      </div>
      <span class="tgt-excl-status ${status === 'submitted' ? 'pending' : status}">${_nrrExclusionStatusLabel(status)}</span>
    </div>
    ${r.reason_text ? `<div class="tgt-excl-meta" style="margin-top:7px">${r.reason_text}</div>` : ''}
    <div class="tgt-excl-impact">
      <span class="tgt-excl-chip">Base ${_tgtFmtM(base)}</span>
      <span class="tgt-excl-chip good">Governed NRR impact after approval</span>
      <span class="tgt-excl-chip money">Payout impact calculated in preview</span>
    </div>
    ${isAdmin && status === 'submitted' ? `<div class="tgt-excl-actions">
      <button class="tgt-excl-action approve" onclick="reviewNrrExclusion('${r.id}','approved')">Approve</button>
      <button class="tgt-excl-action reject" onclick="reviewNrrExclusion('${r.id}','rejected')">Reject</button>
    </div>` : ''}
  </div>`;
}
function setNrrExclusionView(v) {
  _nrrExclusionView = v;
  renderNrrExclusionsTab();
}
function openNrrExclusionSheetFromKam(kamEmail, accountId, accountName, baseGmv, tlEmail) {
  _nrrExclusionDraft = {
    period_month: _nrrExclusionCurrentPeriod(),
    account_id: accountId || accountName || '',
    account_name: accountName || accountId || '',
    target_kam_email: kamEmail || '',
    target_tl_email: tlEmail || '',
    base_gmv: Number(baseGmv || 0)
  };
  const ov = document.getElementById('nrr-excl-overlay');
  const acc = document.getElementById('nrr-excl-account');
  const note = document.getElementById('nrr-excl-note');
  const reason = document.getElementById('nrr-excl-reason');
  if (acc) acc.value = `${_nrrExclusionDraft.account_name || _nrrExclusionDraft.account_id} · base ${_tgtFmtM(_nrrExclusionDraft.base_gmv)}`;
  if (note) note.value = '';
  if (reason) reason.value = 'closed_business';
  if (ov) ov.classList.add('open');
}
function closeNrrExclusionSheet() {
  const ov = document.getElementById('nrr-excl-overlay');
  if (ov) ov.classList.remove('open');
  _nrrExclusionDraft = null;
}
async function submitNrrExclusionRequest() {
  if (!_nrrExclusionDraft) return;
  const reason = document.getElementById('nrr-excl-reason')?.value || 'other';
  const note = document.getElementById('nrr-excl-note')?.value || '';
  const actor = (currentUserProfile && currentUserProfile.email) || '';
  const row = {
    period_month: _nrrExclusionDraft.period_month,
    account_id: _nrrExclusionDraft.account_id,
    outlet_id: null,
    applies_to: 'both',
    target_kam_email: _nrrExclusionDraft.target_kam_email,
    target_tl_email: _nrrExclusionDraft.target_tl_email,
    reason_code: reason,
    reason_text: note,
    status: 'submitted',
    requested_by: actor,
    requested_at: new Date().toISOString(),
    base_gmv: _nrrExclusionDraft.base_gmv,
    estimated_base_gmv: _nrrExclusionDraft.base_gmv
  };
  try {
    const { data, error } = await supa.from('nrr_exclusions').insert(row).select('*').single();
    if (error) throw new Error(error.message);
    _nrrExclusions.push(data || row);
    closeNrrExclusionSheet();
    if (typeof showToast === 'function') showToast('ส่งคำขอ exclusion แล้ว', 'ok');
    try { renderTeamviewSummary(); renderTeamviewKamList(); } catch(e) {}
  } catch (e) {
    console.error('[NRR exclusion] submit failed:', e);
    if (typeof showToast === 'function') showToast('ส่งคำขอไม่สำเร็จ: ' + (e.message || ''), '!');
  }
}
async function reviewNrrExclusion(id, status) {
  const actor = (currentUserProfile && currentUserProfile.email) || '';
  try {
    const { data, error } = await supa.from('nrr_exclusions')
      .update({ status, reviewed_by: actor, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    _nrrExclusions = (_nrrExclusions || []).map(r => r.id === id ? (data || { ...r, status }) : r);
    renderNrrExclusionsTab();
    try { renderTeamviewSummary(); renderTeamviewKamList(); renderCommissionPreviewTab(); } catch(e) {}
  } catch (e) {
    console.error('[NRR exclusion] review failed:', e);
    if (typeof showToast === 'function') showToast('อัปเดตไม่สำเร็จ: ' + (e.message || ''), '!');
  }
}


function renderCommissionPreviewTab() {
  const body = document.getElementById('tgt-sheet-body');
  if (!body) return;
  const model = _commBuildPreviewModel();
  if (!model.kamRows.length && model.teamPct === null) {
    body.innerHTML = `<div class="tgt-preview-empty">ยังไม่มีข้อมูลพอสำหรับ preview<br><span style="font-size:10px;color:rgba(255,255,255,.32)">โหลด portview.csv / history ก่อน แล้วกลับมาที่หน้านี้</span></div>`;
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
          <div class="tgt-preview-kpi-val">${model.teamPct !== null ? model.teamPct + '%' : '—'}</div>
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
      <span style="font-family:'IBM Plex Mono',monospace;color:rgba(255,255,255,.42)">${model.kamRows.length} KAM</span>
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
          <span class="tgt-preview-chip ${cls}">NRR ${r.pct !== null ? r.pct + '%' : '—'}</span>
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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(0,208,112,.75)" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7H14.5a3.5 3.5 0 0 1 0 7H6"/></svg>
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
// SECTION:NRR_COMPUTE
function _tgtComputeKamNRR(kamEmail, tlEmail) {
  if (typeof bulkHistoryData === 'undefined' || !bulkHistoryData) return null;
  const allAccounts = (typeof portviewBulkData !== 'undefined' ? portviewBulkData : [])
    .filter(a => {
      if (kamEmail) return a.kamEmail === kamEmail;
      if (tlEmail)  return a.tlEmail  === tlEmail;
      return true;
    });
  if (!allAccounts.length) return null;

  const mo = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const moSort = m => { const p=(m||'').split(' '); return (parseInt(p[1]||0)*12)+mo.indexOf(p[0]); };

  // prevMonth from Q9 history
  const allMonths = new Set();
  allAccounts.forEach(a => (bulkHistoryData[a.id]||[]).forEach(h => { if(h.m) allMonths.add(h.m); }));
  const sortedMonths = Array.from(allMonths).sort((a,b) => moSort(a)-moSort(b));
  if (!sortedMonths.length) return null;
  const prevMonth = sortedMonths[sortedMonths.length - 1];

  // daysElapsed + currentMonthLabel from bulkCurrentMonthData
  let currentMonthLabel = '';
  let daysElapsed = 0;
  const hasCM = typeof bulkCurrentMonthData !== 'undefined' && bulkCurrentMonthData;
  if (hasCM) {
    for (const a of allAccounts) {
      const cm = bulkCurrentMonthData[a.id];
      if (cm && cm.month_label && cm.days_elapsed > 0) {
        currentMonthLabel = cm.month_label;
        daysElapsed = cm.days_elapsed;
        break;
      }
    }
  }
  // Fallback: compute currentMonthLabel from today's date (match history year format)
  if (!daysElapsed && allAccounts.length) {
    daysElapsed = allAccounts.find(a => a.daysElapsed > 0)?.daysElapsed || 0;
    if (daysElapsed && !currentMonthLabel) {
      const _nd = new Date();
      const _moN = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      // Detect year format from history data (CE ~2024 vs Thai ~2567)
      const _sampleYr = parseInt((Array.from(allMonths)[0]||'').split(' ')[1]||'0');
      const _yr = _sampleYr > 2500 ? _nd.getFullYear() + 543 : _nd.getFullYear();
      currentMonthLabel = _moN[_nd.getMonth()] + ' ' + _yr;
    }
  }
  if (!currentMonthLabel || !daysElapsed) return null;
  if (moSort(currentMonthLabel) <= moSort(prevMonth)) return null;

  const prevDays = getThaiMonthDays(prevMonth);
  const hasOutlets = typeof bulkOutletsData !== 'undefined' && bulkOutletsData;
  const hd = (typeof bulkHandoverData !== 'undefined' && bulkHandoverData) ? bulkHandoverData : { byAccountId:{}, byKamName:{} };

  // ── Classify accounts into cohorts ─────────────────────────────
  // Core NRR: account อยู่กับ KAM นี้ก่อนเดือนปัจจุบัน
  // Transfer in: ใหม่เดือนนี้ + มีใน bulkHandoverData (มาจาก KAM อื่น)
  // New from Sales: ใหม่เดือนนี้ + ไม่มีใน bulkHandoverData (มาจาก Sales/PM)
  const coreAccounts=[], transferInAccounts=[], newFromSalesAccounts=[];
  allAccounts.forEach(a => {
    const isNew = a.daysWithCurrentKam !== null && a.daysWithCurrentKam !== undefined && a.daysWithCurrentKam <= daysElapsed;
    if (!isNew) { coreAccounts.push(a); return; }
    if (hd.byAccountId[a.id]) { transferInAccounts.push(a); }
    else { newFromSalesAccounts.push(a); }
  });

  // ── Helper: compute NRR for a group of accounts ─────────────────
  function _groupNRR(group) {
    if (!group.length) return null;
    let prevGmvByOutlet={}, currGmvByOutlet={}, everSeen=new Set();
    // v206: track outlet→account mapping for drill-down detail
    const outletToAcct={}, outletName={};
    group.forEach(a => {
      const acctName=(typeof bulkAccountNames!=='undefined'&&bulkAccountNames[a.id])||a.name||a.id;
      const outletMonths = hasOutlets ? bulkOutletsData[a.id] : null;
      if (outletMonths && typeof outletMonths === 'object' && !Array.isArray(outletMonths)) {
        Object.entries(outletMonths).forEach(([mLabel,entries]) => {
          if (moSort(mLabel) >= moSort(prevMonth)) return;
          (entries||[]).forEach(o => { const oid=o.outlet_id||o.outletId||o.id; if(oid) everSeen.add(oid); });
        });
        (outletMonths[prevMonth]||[]).forEach(o => {
          const oid=o.outlet_id||o.outletId||o.id;
          if(oid && o.gmv>0){
            prevGmvByOutlet[oid]=(prevGmvByOutlet[oid]||0)+o.gmv;
            outletToAcct[oid]={acctId:a.id,acctName};
            if(!outletName[oid])outletName[oid]=o.outlet_name||o.outletName||oid;
          }
        });
        (outletMonths[currentMonthLabel]||[]).forEach(o => {
          const oid=o.outlet_id||o.outletId||o.id;
          if(oid && o.gmv>0){
            currGmvByOutlet[oid]=(currGmvByOutlet[oid]||0)+o.gmv;
            if(!outletToAcct[oid])outletToAcct[oid]={acctId:a.id,acctName};
            if(!outletName[oid])outletName[oid]=o.outlet_name||o.outletName||oid;
          }
        });
      } else {
        const hist=bulkHistoryData[a.id]||[];
        hist.filter(h=>moSort(h.m)<moSort(prevMonth)).forEach(()=>everSeen.add(a.id));
        const prevRow=hist.find(h=>h.m===prevMonth);
        if(prevRow&&(prevRow.gmv||prevRow.s||0)>0){
          prevGmvByOutlet[a.id]=prevRow.gmv||prevRow.s||0;
          outletToAcct[a.id]={acctId:a.id,acctName};
          outletName[a.id]=acctName;
        }
        const cm=hasCM?bulkCurrentMonthData[a.id]:null;
        if(cm&&cm.gmv_to_date>0){
          currGmvByOutlet[a.id]=cm.gmv_to_date;
          if(!outletToAcct[a.id])outletToAcct[a.id]={acctId:a.id,acctName};
          if(!outletName[a.id])outletName[a.id]=acctName;
        }
      }
    });
    const cohort=Object.keys(prevGmvByOutlet);
    const currentIds=Object.keys(currGmvByOutlet);
    // v207h: comeback/expansion can exist even when there is no prev-month NRR cohort.
    // Do not return null just because cohort is empty; otherwise transfer-in/new-sales current GMV
    // gets hidden and may look like 0 even when the account already purchased this month.
    if(!cohort.length && !currentIds.length) return null;
    const baselinePrevGmv=cohort.reduce((s,id)=>s+(prevGmvByOutlet[id]||0),0);
    const baseCurrGmv=cohort.reduce((s,id)=>s+(currGmvByOutlet[id]||0),0);
    const prevDailyRate=prevDays>0?baselinePrevGmv/prevDays:0;
    const currDailyRate=daysElapsed>0?baseCurrGmv/daysElapsed:0;
    const nrr=prevDailyRate>0?currDailyRate/prevDailyRate:null;
    const nonCohortIds=currentIds.filter(id=>!prevGmvByOutlet[id]);
    const comebackIds=nonCohortIds.filter(id=>everSeen.has(id));
    const expansionIds=nonCohortIds.filter(id=>!everSeen.has(id));
    // ── v206: build grouped detail arrays ────────────────────────
    function _buildDetail(ids,type){
      // group by account, sort each account's outlets by delta (NRR) or currGmv (CB/EX)
      const byAcct={};
      ids.forEach(oid=>{
        const info=outletToAcct[oid]||{acctId:oid,acctName:oid};
        if(!byAcct[info.acctId])byAcct[info.acctId]={acctId:info.acctId,acctName:info.acctName,outlets:[],prevTotal:0,currTotal:0};
        const prev=prevGmvByOutlet[oid]||0;
        const curr=currGmvByOutlet[oid]||0;
        const delta=prev>0?Math.round((curr-prev)/prev*100):null;
        byAcct[info.acctId].outlets.push({outletId:oid,outletName:outletName[oid]||oid,prevGmv:prev,currGmv:curr,delta});
        byAcct[info.acctId].prevTotal+=prev;
        byAcct[info.acctId].currTotal+=curr;
      });
      return Object.values(byAcct).map(g=>{
        // sort outlets: NRR → delta% asc (worst first); CB/EX → currGmv desc
        g.outlets.sort((a,b)=>type==='nrr'?(a.delta??0)-(b.delta??0):b.currGmv-a.currGmv);
        g.delta=g.prevTotal>0?Math.round((g.currTotal-g.prevTotal)/g.prevTotal*100):null;
        return g;
      }).sort((a,b)=>type==='nrr'?(a.delta??0)-(b.delta??0):b.currTotal-a.currTotal);
    }
    const cohortDetail=_buildDetail(cohort,'nrr');
    const comebackDetail=_buildDetail(comebackIds,'cb');
    const expansionDetail=_buildDetail(expansionIds,'ex');
    return {
      nrr, cohortCount:cohort.length, cohortGmv:baseCurrGmv, baselinePrevGmv,
      comebackGmv:comebackIds.reduce((s,id)=>s+(currGmvByOutlet[id]||0),0),
      comebackCount:comebackIds.length,
      expansionGmv:expansionIds.reduce((s,id)=>s+(currGmvByOutlet[id]||0),0),
      expansionCount:expansionIds.length,
      cohortDetail, comebackDetail, expansionDetail
    };
  }

  const coreResult = _groupNRR(coreAccounts);
  const transferInResult = _groupNRR(transferInAccounts);
  const newFromSalesResult = _groupNRR(newFromSalesAccounts);

  // ── Transfer out from bulkHandoverData ─────────────────────────
  // KAM mode: lookup by kamName | TL mode: aggregate all KAMs in team
  let transferOutList = [];
  if (kamEmail) {
    const kamName = allAccounts.find(a => a.kamName)?.kamName || '';
    transferOutList = kamName ? (hd.byKamName[kamName] || []) : [];
  } else if (tlEmail) {
    const teamKamNames = new Set(allAccounts.map(a => a.kamName).filter(Boolean));
    teamKamNames.forEach(n => { (hd.byKamName[n] || []).forEach(r => transferOutList.push(r)); });
  } else {
    // v207e: admin all-team view aggregates transfer-out across all visible KAMs.
    const allKamNames = new Set(allAccounts.map(a => a.kamName).filter(Boolean));
    allKamNames.forEach(n => { (hd.byKamName[n] || []).forEach(r => transferOutList.push(r)); });
  }
  // v207h: dedupe transfer-out rows defensively. Q10 should be unique, but TL/Admin aggregation
  // can otherwise double-count if the CSV is regenerated with overlapping old-owner rows.
  const _seenTransferOut = new Set();
  transferOutList = transferOutList.filter(r=>{
    const key=(r.accountId||'')+'|'+(r.kamName||'')+'|'+(r.newKamName||'');
    if(_seenTransferOut.has(key)) return false;
    _seenTransferOut.add(key); return true;
  });
  const transferOutGmv = transferOutList.reduce((s,a)=>s+(a.lastMonthGmv||0),0);
  const _movementGmv = r => (r ? ((r.cohortGmv||0)+(r.comebackGmv||0)+(r.expansionGmv||0)) : 0);

  // ── Build return value (core fields stay backward-compatible) ───
  const core = coreResult || {};
  return {
    // Core NRR (backward-compatible fields)
    nrr: core.nrr ?? null,
    daysElapsed, prevDays, prevMonth, currentMonthLabel,
    cohortCount:   core.cohortCount   || 0,
    cohortGmv:     core.cohortGmv     || 0,
    baselinePrevGmv: core.baselinePrevGmv || 0,
    comebackGmv:   core.comebackGmv   || 0,
    comebackCount: core.comebackCount || 0,
    expansionGmv:  core.expansionGmv  || 0,
    expansionCount:core.expansionCount|| 0,
    // v206: drill-down detail arrays (account-grouped, sorted)
    cohortDetail:    core.cohortDetail    || [],
    comebackDetail:  core.comebackDetail  || [],
    expansionDetail: core.expansionDetail || [],
    // Movement groups (v198)
    transferIn: {
      count: transferInAccounts.length,
      // v207h: movement GMV = all current-month GMV in this movement group, not only NRR cohort GMV.
      // This keeps transfer-in with no prev-month cohort from showing as ฿0 when it has CB/EX current GMV.
      gmv:   _movementGmv(transferInResult),
      nrr:   transferInResult?.nrr ?? null,
      cohortGmv: transferInResult?.cohortGmv || 0,
      comebackGmv: transferInResult?.comebackGmv || 0,
      expansionGmv: transferInResult?.expansionGmv || 0,
      cohortDetail: transferInResult?.cohortDetail || [],
      comebackDetail: transferInResult?.comebackDetail || [],
      expansionDetail: transferInResult?.expansionDetail || []
    },
    newFromSales: {
      count: newFromSalesAccounts.length,
      gmv:   _movementGmv(newFromSalesResult),
      nrr:   newFromSalesResult?.nrr ?? null,
      cohortGmv: newFromSalesResult?.cohortGmv || 0,
      comebackGmv: newFromSalesResult?.comebackGmv || 0,
      expansionGmv: newFromSalesResult?.expansionGmv || 0,
      cohortDetail: newFromSalesResult?.cohortDetail || [],
      comebackDetail: newFromSalesResult?.comebackDetail || [],
      expansionDetail: newFromSalesResult?.expansionDetail || []
    },
    transferOut: {
      count: transferOutList.length,
      gmv:   transferOutGmv,
      detail: transferOutList
    }
  };
}


// ── NRR Cohort Drill-down Sheet (v206) ──────────────────────────
// _tgtShowCohortSheet(tab, kamLabel)
// tab: 'nrr' | 'cb' | 'ex'
// reads window._ncsLastNrrResult set by renderPortviewTargetBar
function _tgtShowCohortSheet(tab) {
  const nr = window._ncsLastNrrResult;
  const kamLabel = window._ncsKamLabel || '';
  if (!nr) {
    if (typeof showToast === 'function') showToast('\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25 NRR \u2014 \u0e42\u0e2b\u0e25\u0e14 portview.csv \u0e01\u0e48\u0e2d\u0e19', '!');
    return;
  }

  // ── Formatting helpers ─────────────────────────────────────────
  const _fmtK = function(v) {
    if (!v) return '\u0e3f0';
    const av = Math.abs(v);
    if (av >= 1000000) return '\u0e3f' + (v / 1000000).toFixed(1) + 'M';
    if (av >= 1000)    return '\u0e3f' + Math.round(v / 1000) + 'K';
    return '\u0e3f' + Math.round(v);
  };

  // ── Days in current month (for run-rate) ─────────────────────
  const _moNames = ['\u0e21.\u0e04.','\u0e01.\u0e1e.','\u0e21\u0e35.\u0e04.','\u0e40\u0e21.\u0e22.','\u0e1e.\u0e04.','\u0e21\u0e34.\u0e22.','\u0e01.\u0e04.','\u0e2a.\u0e04.','\u0e01.\u0e22.','\u0e15.\u0e04.','\u0e1e.\u0e22.','\u0e18.\u0e04.'];
  const _cp = (nr.currentMonthLabel || '').split(' ');
  const _mi = _moNames.indexOf(_cp[0]);
  const _yr = parseInt(_cp[1] || '0') - 543;
  const daysInCurrMonth = (_mi >= 0 && _yr > 1900) ? new Date(_yr, _mi + 1, 0).getDate() : 30;
  const _rr = function(v) { return nr.daysElapsed > 0 ? Math.round(v / nr.daysElapsed * daysInCurrMonth) : v; };

  // ── Ensure overlay + sheet DOM ─────────────────────────────────
  let overlay = document.getElementById('ncs-overlay');
  let sheet   = document.getElementById('ncs-sheet');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'ncs-overlay'; overlay.className = 'ncs-overlay'; overlay.setAttribute('onclick', '_ncsClose()'); document.body.appendChild(overlay); }
  if (!sheet)   { sheet   = document.createElement('div'); sheet.id = 'ncs-sheet'; sheet.className = 'ncs-sheet'; document.body.appendChild(sheet); }

  // ── State ──────────────────────────────────────────────────────
  let activeTab = tab || 'nrr';
  const tabs = [
    {key:'nrr', label:'NRR',       count:nr.cohortCount,    gmv:nr.cohortGmv,    data:nr.cohortDetail,    color:'#1AE87B'},
    {key:'cb',  label:'Comeback',  count:nr.comebackCount,  gmv:nr.comebackGmv,  data:nr.comebackDetail,  color:'#64a0ff'},
    {key:'ex',  label:'Expansion', count:nr.expansionCount, gmv:nr.expansionGmv, data:nr.expansionDetail, color:'#00c8b0'}
  ];

  // ── Tab meta line ─────────────────────────────────────────────
  function _tabMeta(t) {
    if (t.key === 'nrr') return t.count + ' outlets \u00b7 ' + _fmtK(t.gmv) + ' MTD \u00b7 \u0e10\u0e32\u0e19 ' + nr.prevMonth;
    if (t.key === 'cb')  return t.count + ' outlets \u0e01\u0e25\u0e31\u0e1a\u0e21\u0e32\u0e0b\u0e37\u0e49\u0e2d \u00b7 \u0e44\u0e21\u0e48\u0e21\u0e35\u0e22\u0e2d\u0e14 ' + nr.prevMonth;
    return t.count + ' outlets \u0e43\u0e2b\u0e21\u0e48 \u00b7 \u0e44\u0e21\u0e48\u0e40\u0e04\u0e22\u0e0b\u0e37\u0e49\u0e2d\u0e21\u0e32\u0e01\u0e48\u0e2d\u0e19';
  }

  // ── Render account groups (Option B: chip separator + flat outlet rows) ───
  function _renderRows(t) {
    if (!t.data || !t.data.length) return '<div class="ncs-empty">\u0e44\u0e21\u0e48\u0e21\u0e35\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25</div>';
    const isNrr = t.key === 'nrr';
    const colCls = isNrr ? 'nrr-cols' : 'simple-cols';
    const cbColor = t.key === 'cb' ? '#64a0ff' : '#00c8b0';

    return t.data.map(function(g, gi) {
      const autoOpen = gi < 4;
      // ── Chip row ────────────────────────────────────────────────
      const chipRR = isNrr ? _fmtK(_rr(g.currTotal)) : _fmtK(g.currTotal);
      const chipColor = isNrr ? 'rgba(26,232,123,.7)' : (t.key === 'cb' ? 'rgba(100,160,255,.8)' : 'rgba(0,200,176,.8)');
      const chip = '<div class="ncs-chip' + (autoOpen ? ' open' : '') + '" onclick="_ncsChipToggle(this)">'
        + '<span class="ncs-chip-chev">&#8250;</span>'
        + '<span class="ncs-chip-name">' + g.acctName + '</span>'
        + '<span class="ncs-chip-rr" style="color:' + chipColor + '">' + chipRR + '</span>'
        + '</div>';

      // ── Outlet rows ─────────────────────────────────────────────
      const outletRows = g.outlets.map(function(o) {
        const nameStr = (o.outletName || '\u2014').slice(0, 38);
        if (isNrr) {
          const rrVal = _rr(o.currGmv);
          const rrCls = rrVal >= o.prevGmv ? 'ncs-gmv rr-up' : 'ncs-gmv rr-dn';
          return '<div class="ncs-outlet-row nrr-cols">'
            + '<div class="ncs-outlet-name">' + nameStr + '</div>'
            + '<div class="ncs-gmv base">' + (o.prevGmv > 0 ? _fmtK(o.prevGmv) : '\u2014') + '</div>'
            + '<div class="' + rrCls + '">' + _fmtK(rrVal) + '</div>'
            + '<div class="ncs-gmv mtd">' + _fmtK(o.currGmv) + '</div>'
            + '</div>';
        } else {
          return '<div class="ncs-outlet-row simple-cols">'
            + '<div class="ncs-outlet-name">' + nameStr + '</div>'
            + '<div class="ncs-gmv" style="text-align:right;color:' + cbColor + '">' + _fmtK(o.currGmv) + '</div>'
            + '</div>';
        }
      }).join('');

      return chip + '<div class="ncs-outlet-rows' + (autoOpen ? ' open' : '') + '">' + outletRows + '</div>';
    }).join('');
  }

  // ── Main render ───────────────────────────────────────────────
  function _render() {
    const t = tabs.find(function(x) { return x.key === activeTab; }) || tabs[0];
    const isNrr = t.key === 'nrr';

    const tabStrip = tabs.map(function(x) {
      return '<button class="ncs-tab t-' + x.key + (x.key === activeTab ? ' on' : '') + '" onclick="_ncsSetTab(\'' + x.key + '\')">'
        + x.label + '<br><span style="font-size:9px;opacity:.7">' + x.count + ' outlets</span></button>';
    }).join('');

    const thRow = isNrr
      ? '<div class="ncs-th">Outlet</div>'
        + '<div class="ncs-th r">\u0e10\u0e32\u0e19</div>'
        + '<div class="ncs-th r" style="color:rgba(26,232,123,.65)">Run Rate</div>'
        + '<div class="ncs-th r">MTD</div>'
      : '<div class="ncs-th">Outlet / Account</div>'
        + '<div class="ncs-th r">MTD</div>';

    const colCls = isNrr ? 'nrr-cols' : 'simple-cols';
    const totalColor = t.key === 'nrr' ? '#1AE87B' : t.key === 'cb' ? '#64a0ff' : '#00c8b0';
    const totalPrefix = t.key === 'nrr' ? '' : '+';

    sheet.innerHTML =
      '<div class="ncs-handle"><div></div></div>'
      + '<div class="ncs-header">'
        + '<div class="ncs-title">\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14 GMV \u2014 ' + kamLabel + '</div>'
        + '<div class="ncs-tabs">' + tabStrip + '</div>'
      + '</div>'
      + '<div class="ncs-meta">'
        + '<span class="ncs-meta-text">' + _tabMeta(t) + '</span>'
        + '<button id="ncs-toggle-btn" class="ncs-sort-btn" onclick="_ncsToggleAll()">\u0e22\u0e48\u0e2d\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14</button>'
      + '</div>'
      + '<div class="ncs-tbl-head ' + colCls + '">' + thRow + '</div>'
      + '<div class="ncs-body" id="ncs-body">' + _renderRows(t) + '</div>'
      + '<div class="ncs-total">'
        + '<span class="ncs-total-lbl">\u0e23\u0e27\u0e21 ' + t.label + '</span>'
        + '<span class="ncs-total-val" style="color:' + totalColor + '">' + totalPrefix + _fmtK(t.gmv) + '</span>'
      + '</div>'
      + '<div class="ncs-footer">'
        + '<button class="ncs-btn primary" onclick="_ncsExportCSV()">&#8595; \u0e14\u0e32\u0e27\u0e19\u0e4c\u0e42\u0e2b\u0e25\u0e14 CSV</button>'
        + '<button class="ncs-btn secondary" onclick="_ncsCopyTSV()">&#9112; Copy TSV</button>'
      + '</div>';
  }

  // ── Chip toggle (single account group) ───────────────────────
  window._ncsChipToggle = function(chip) {
    chip.classList.toggle('open');
    var r = chip.nextElementSibling;
    if (r) r.classList.toggle('open');
  };

  // ── Toggle all expand / collapse ─────────────────────────────
  window._ncsToggleAll = function() {
    var body = document.getElementById('ncs-body');
    if (!body) return;
    var chips   = Array.from(body.querySelectorAll('.ncs-chip'));
    var outlets = Array.from(body.querySelectorAll('.ncs-outlet-rows'));
    var anyOpen = outlets.some(function(r) { return r.classList.contains('open'); });
    chips.forEach(function(r)   { r.classList.toggle('open', !anyOpen); });
    outlets.forEach(function(r) { r.classList.toggle('open', !anyOpen); });
    var btn = document.getElementById('ncs-toggle-btn');
    if (btn) btn.textContent = anyOpen ? '\u0e02\u0e22\u0e32\u0e22\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14' : '\u0e22\u0e48\u0e2d\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14';
  };

  // ── Tab switch ───────────────────────────────────────────────
  window._ncsSetTab = function(key) {
    activeTab = key;
    _render();
    var body = document.getElementById('ncs-body');
    if (body) body.scrollTop = 0;
  };

  // ── Export helpers ────────────────────────────────────────────
  function _buildRows(t) {
    const isNrr = t.key === 'nrr';
    const rows = [];
    const hdr = isNrr
      ? ['Account', 'Outlet', 'GMV \u0e10\u0e32\u0e19 (' + nr.prevMonth + ')', 'Run Rate', 'GMV MTD']
      : ['Account', 'Outlet', 'GMV MTD'];
    rows.push(hdr);
    (t.data || []).forEach(function(g) {
      g.outlets.forEach(function(o) {
        if (isNrr) rows.push([g.acctName, o.outletName || o.outletId, Math.round(o.prevGmv), Math.round(_rr(o.currGmv)), Math.round(o.currGmv)]);
        else       rows.push([g.acctName, o.outletName || o.outletId, Math.round(o.currGmv)]);
      });
    });
    return rows;
  }

  window._ncsExportCSV = function() {
    var t = tabs.find(function(x) { return x.key === activeTab; }) || tabs[0];
    var rows = _buildRows(t);
    var csv = rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var blob = new Blob(['\uFEFF' + csv], {type: 'text/csv;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var mo = (nr.currentMonthLabel || '').replace(/\s/g, '_');
    a.href = url; a.download = 'freshket_' + t.label + '_' + kamLabel + '_' + mo + '.csv';
    a.click(); URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast('\u0e14\u0e32\u0e27\u0e19\u0e4c\u0e42\u0e2b\u0e25\u0e14 CSV \u0e41\u0e25\u0e49\u0e27', '\u2193');
  };

  window._ncsCopyTSV = function() {
    var t = tabs.find(function(x) { return x.key === activeTab; }) || tabs[0];
    var rows = _buildRows(t);
    var tsv = rows.map(function(r) { return r.join('\t'); }).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv).then(function() {
        if (typeof showToast === 'function') showToast('Copy \u0e41\u0e25\u0e49\u0e27 \u2014 paste \u0e25\u0e07 Sheets \u0e44\u0e14\u0e49\u0e40\u0e25\u0e22', '\u2713');
      }).catch(function() {
        if (typeof showToast === 'function') showToast('Copy \u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08 \u2014 \u0e25\u0e2d\u0e07 CSV \u0e41\u0e17\u0e19', '!');
      });
    }
  };

  window._ncsClose = function() {
    var o = document.getElementById('ncs-overlay');
    var s = document.getElementById('ncs-sheet');
    if (o) o.classList.remove('on');
    if (s) s.classList.remove('on');
  };

  // ── Show ──────────────────────────────────────────────────────
  try {
    _render();
    overlay.classList.remove('on'); sheet.classList.remove('on');
    void overlay.offsetHeight;
    overlay.classList.add('on');
    sheet.classList.add('on');
  } catch(err) {
    if (typeof showToast === 'function') showToast('Sheet error: ' + err.message, '!');
    console.error('[NCS]', err);
  }
}


// ── renderPortviewNRRBar: retired — merged into renderPortviewTargetBar ──
function renderPortviewNRRBar() {
  const bar = document.getElementById('tgt-nrr-bar');
  if (bar) bar.innerHTML = '';
}

// ── Portview NRR + Target Widget ────────────────────────────────
// SECTION:NRR_WIDGET
async function renderPortviewTargetBar() {
  const bar = document.getElementById('tgt-portview-bar');
  if (!bar) return;
  // Debounce: skip if rendered within last 300ms AND same KAM context (prevents flicker)
  // v198c: bypass debounce when portviewLevel/portviewRepEmail changes — fixes TL/Admin stuck transfer data
  const _now = Date.now();
  const _ctxKey = `${(typeof portviewLevel!=='undefined'?portviewLevel:'')}|${(typeof portviewRepEmail!=='undefined'?portviewRepEmail:'')}`;
  if (bar._lastRenderMs && _now - bar._lastRenderMs < 300 && bar._lastCtxKey === _ctxKey) return;
  bar._lastRenderMs = _now;
  bar._lastCtxKey = _ctxKey;

  const role  = (currentUserProfile && currentUserProfile.role)  || 'rep';
  const email = (currentUserProfile && currentUserProfile.email) || '';
  const isTL  = role === 'tl' || role === 'admin';

  // Micro-interaction: show calculating state while awaiting Supabase targets
  if (!_tgtLoaded) {
    const _calcEl=document.getElementById('tgt-nrr-bar');
    if(_calcEl&&!_calcEl.innerHTML.trim()){
      _calcEl.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;color:rgba(255,255,255,.35);font-size:11px"><span class="spl-dot-pulse" style="display:inline-flex;gap:3px">'+'<span style="width:4px;height:4px;border-radius:50%;background:rgba(0,208,112,.4);animation:_dotBlink .9s ease-in-out infinite"></span>'.repeat(3)+'</span>กำลังคำนวณ NRR...</div>';
    }
    await loadTargets(_tgtCurrentQuarter());
    if(_calcEl)_calcEl.innerHTML=''; // clear placeholder before real render
    // Reset debounce: targets freshly loaded — allow immediate re-render on next call
    bar._lastRenderMs = 0;
    // v224e: re-render teamview KAM list so each KAM's pace% uses real target, not baseline
    // (fixes "stuck at baseline" case where KAM cards never updated after targets loaded)
    try{
      if(document.getElementById('scr-teamview')?.classList.contains('on')&&typeof renderTeamviewKamList==='function'){
        setTimeout(()=>{try{renderTeamviewKamList();}catch(e){}},50);
      }
    }catch(e){}
  }

  const now    = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // ── Accounts + run-rate ──────────────────────────────────────
  // v182: TL/admin now filter by tlEmail (was incorrectly using all accounts → inflated runRate)
  const _pvData = (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []);
  const _hasEmailCols = _pvData.some(a => a.kamEmail || a.tlEmail);

  // ── rep-detail: TL/admin drilling into a specific KAM's portfolio ──
  const _repDetail = (typeof portviewLevel !== 'undefined' && portviewLevel === 'rep-detail' &&
                      typeof portviewRepEmail !== 'undefined' && portviewRepEmail);
  const _repEmail  = _repDetail ? portviewRepEmail : null;

  // Admin fallback: admin email ≠ any tlEmail in CSV → show all teams combined
  const _tlHasMatch = !_repDetail && isTL && _hasEmailCols && _pvData.some(a => a.tlEmail === email);
  const _showAll = !_repDetail && isTL && !_tlHasMatch; // admin with no tlEmail match → all accounts
  const accounts = _pvData.filter(a => {
      if (_repDetail) return a.kamEmail === _repEmail || a.kamName === _repEmail; // rep-detail: filter to this KAM
      if (!_hasEmailCols || _showAll) return true;
      if (isTL) return a.tlEmail === email;
      return a.kamEmail === email;
    });
  const withPace = accounts.filter(a => a.paceSignal && a.paceSignal.runrate > 0);
  const runRate = withPace.reduce((s,a) => s+(a.paceSignal.runrate||0), 0);

  // Bug fix: daysElapsed lives on account object, not inside paceSignal
  const daysElapsed = withPace.length ? (withPace[0].daysElapsed || withPace[0].paceSignal?.daysElapsed || 0) : 0;
  const daysInMonth = withPace.length ? (withPace[0].daysInMonth || withPace[0].paceSignal?.daysInMonth || 30) : 30;

  // ── Target: Case A → B → C ──────────────────────────────────
  // In rep-detail mode: always treat as KAM-level target for the viewed KAM
  const _targetEmail = _repDetail ? _repEmail : (_showAll ? null : email);
  const level = _showAll ? 'all' : ((isTL && !_repDetail) ? 'team' : 'kam');
  let target = _showAll
    ? Array.from(new Set(accounts.map(a => a.tlEmail).filter(Boolean))).reduce((s,tl)=>s+(_tgtGet(period,'team',tl)||0),0)
    : _tgtGet(period, level, _targetEmail);
  let fbMode = _showAll && target > 0 ? 'team' : null;

  if (!target && (!isTL || _repDetail)) {
    // Primary: tlEmail from portview CSV col 18
    let tlEmail = accounts.length ? (accounts[0].tlEmail||'') : '';
    // v205b fallback: if CSV missing tl_email col, scan _tgtCache for any team-level entry
    // that belongs to a TL whose accounts overlap with this KAM's accounts
    if (!tlEmail) {
      const kamAccountIds = new Set(accounts.map(a => a.id));
      const allPvData = (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []);
      // Find a row from same squad where tlEmail is known
      const sameSqRow = allPvData.find(a => a.tlEmail && accounts.some(b => b.kamEmail === a.kamEmail));
      if (sameSqRow) tlEmail = sameSqRow.tlEmail;
      // Final fallback: pick first team-level entry in _tgtCache for current period
      if (!tlEmail) {
        const teamKey = Object.keys(_tgtCache).find(k => k.startsWith(period + '|team|'));
        if (teamKey) tlEmail = teamKey.split('|')[2] || '';
      }
    }
    const tlTarget = tlEmail ? _tgtGet(period, 'team', tlEmail) : 0;
    if (tlTarget > 0) {
      const kamBaseline  = _tgtKamBaseline3mo(_targetEmail, null, 'kam');
      const teamBaseline = _tgtKamBaseline3mo(null, tlEmail, 'tl');
      const share = teamBaseline > 0 ? kamBaseline/teamBaseline : 1/Math.max(1,accounts.length);
      target = Math.round(tlTarget * share);
      fbMode = 'team';
    }
  }
  // 3mo avg baseline — for parens display when real/allocated target exists
  const _baseline3mo = _showAll
    ? _tgtKamBaseline3mo(null, null, 'all')
    : _tgtKamBaseline3mo(_repDetail ? _repEmail : (isTL ? null : email), _repDetail ? null : (isTL ? email : null), _repDetail ? 'kam' : (isTL ? 'tl' : 'kam'));

  if (!target) {
    target = _baseline3mo;
    if (target > 0) fbMode = 'base';
  }

  if (!target) {
    bar.style.display = 'none';
    // Self-heal: portviewBulkData or targets may still be loading.
    // Schedule one retry — bypasses debounce so widget recovers without kill+reload.
    if (!bar._healPending) {
      bar._healPending = true;
      setTimeout(() => {
        bar._healPending = false;
        bar._lastRenderMs = 0; // bypass debounce for retry
        try { renderPortviewTargetBar(); } catch(e) {}
      }, 2000);
    }
    return;
  }
  bar._healPending = false; // render succeeded — clear retry flag

  // ── Pace % ───────────────────────────────────────────────────
  const pct = Math.round(runRate / target * 100);
  const cls = pct>=105?'great':pct>=100?'safe':pct>=90?'warn':'danger';

  // ── NRR computation ──────────────────────────────────────────
  // v182: pass tlEmail as second arg for TL so NRR is scoped to team only
  // rep-detail: admin/TL viewing a specific KAM → use that KAM's email, not admin email
  //
  // v225g: outlets gate — without bulkOutletsData, _tgtComputeKamNRR gives account-level NRR
  // (not outlet-level), causing wrong NRR%/Comeback%/Expansion% at first render.
  // If outlets not loaded yet: skip NRR computation → nrrPct=null → shimmer shown.
  // When outlets arrive, RenderBus re-renders → key changes ('loading'→actual) → correct values.
  // v225g fix2: check if outlets FILE was ingested, not if it has data.
  // bulkOutletsData = {accountId: months} — empty {} if KAM has no outlet accounts.
  // Object.keys({}).length === 0 → _outletsReady always false → shimmer never resolves.
  // Correct: use _cloudLoadedTabs.has('outlets') (set after ingest, cleared during ETag refresh).
  const _outletsReady = (function(){
    try{ return typeof _cloudLoadedTabs !== 'undefined' && _cloudLoadedTabs.has('outlets'); }
    catch(e){ return typeof bulkOutletsData !== 'undefined' && bulkOutletsData && Object.keys(bulkOutletsData).length > 0; }
  })();

  const nrrResult = _outletsReady
    ? (_repDetail
        ? _tgtComputeKamNRR(_repEmail, null)
        : (_showAll ? _tgtComputeKamNRR(null, null) : _tgtComputeKamNRR(isTL ? null : email, isTL ? email : null)))
    : null;
  let nrrPct=null, cohortGmv=0, cbGmv=0, exGmv=0;
  let cohortCount=0, cbCount=0, exCount=0, baselinePrevGmv=0;

  if (nrrResult && nrrResult.nrr !== null) {
    nrrPct      = Math.round(nrrResult.nrr * 100);
    cohortGmv   = nrrResult.cohortGmv    || 0;
    cbGmv       = nrrResult.comebackGmv  || 0;
    exGmv       = nrrResult.expansionGmv || 0;
    cohortCount = nrrResult.cohortCount  || 0;
    cbCount     = nrrResult.comebackCount  || 0;
    exCount     = nrrResult.expansionCount || 0;
    baselinePrevGmv = nrrResult.baselinePrevGmv || 0;
  }

  // ── Bar: simple proportional segments within min(pct,100)% fill ─
  // Segments color the fill; bar edge = 100% of target (no confusion)
  const barFill = Math.min(pct, 100); // total bar fill %
  const totalSegGmv = cohortGmv + cbGmv + exGmv;
  let nrrBarW, cbBarW, exBarW;
  if (nrrResult && totalSegGmv > 0) {
    nrrBarW = +(barFill * cohortGmv / totalSegGmv).toFixed(2);
    cbBarW  = +(barFill * cbGmv     / totalSegGmv).toFixed(2);
    exBarW  = +(barFill * exGmv     / totalSegGmv).toFixed(2);
    // absorb rounding remainder into nrr
    nrrBarW = +(barFill - cbBarW - exBarW).toFixed(2);
  } else {
    nrrBarW = barFill; cbBarW = 0; exBarW = 0;
  }
  const segFull = nrrBarW > 0 && cbBarW === 0 && exBarW === 0 ? ' seg-full' : '';
  // Store pct globally so compact strip can sync
  window._tgtPortviewPct = pct;
  // Refresh compact strip so it shows the same % as widget
  if (typeof _pvBuildCompactStrip === 'function') setTimeout(_pvBuildCompactStrip, 0);

  // ── Pct legend (hide if 0; shimmer if outlets not yet loaded) ────
  // v225g: outlets not ready → show shimmer pill instead of wrong NRR%
  const _nrrShimmer = `<span class="tgt-pl-item" style="display:inline-flex;align-items:center;gap:4px"><span class="tgt-pl-dot nrr" style="opacity:.3"></span><span style="display:inline-block;width:52px;height:10px;border-radius:5px;background:rgba(255,255,255,.08);animation:_dotBlink 1.2s ease-in-out infinite"></span></span>`;
  const nrrLeg = !_outletsReady
    ? _nrrShimmer
    : (nrrPct !== null
        ? `<span class="tgt-pl-item"><span class="tgt-pl-dot nrr"></span><span class="tgt-pl-lbl">NRR</span>&thinsp;<span class="tgt-pl-val nrr">${nrrPct}%</span></span>`
        : '');
  const cbPct  = baselinePrevGmv>0&&cbGmv>0 ? '+'+Math.round(cbGmv/baselinePrevGmv*100)+'%' : null;
  const exPct  = baselinePrevGmv>0&&exGmv>0 ? '+'+Math.round(exGmv/baselinePrevGmv*100)+'%' : null;
  const cbLeg  = cbPct ? `<span class="tgt-pl-item"><span class="tgt-pl-dot comeback"></span><span class="tgt-pl-lbl">Comeback</span>&thinsp;<span class="tgt-pl-val comeback">${cbPct}</span></span>` : '';
  const exLeg  = exPct ? `<span class="tgt-pl-item"><span class="tgt-pl-dot expansion"></span><span class="tgt-pl-lbl">Expansion</span>&thinsp;<span class="tgt-pl-val expansion">${exPct}</span></span>` : '';

  // ── Setup button ─────────────────────────────────────────────
  const setupBtn = ''; // removed — Target button now in portview/teamview header

  // ── GMV detail section ────────────────────────────────────────
  window._ncsLastNrrResult = nrrResult;
  window._ncsKamLabel = _repDetail ? (_repEmail||'').split('@')[0] : (isTL ? (accounts[0]?.kamName||'ทีม') : email.split('@')[0]);
  const gmvSection = nrrResult ? `
    <div class="tgt-det-section">
      <div class="tgt-det-stitle">GMV รายประเภท</div>
      <div class="tgt-det-row tappable" onclick="_tgtShowCohortSheet('nrr')">
        <div class="tgt-det-dot" style="background:#4ddc97"></div><span class="tgt-det-lbl">NRR</span><span class="tgt-det-val" style="color:#4ddc97">${_tgtFmtM(cohortGmv)}</span><span class="tgt-det-count">${cohortCount} outlets</span><span class="ncs-row-btn">ดู ›</span></div>
      ${cbGmv>0?`<div class="tgt-det-row tappable" onclick="_tgtShowCohortSheet('cb')"><div class="tgt-det-dot" style="background:#64a0ff"></div><span class="tgt-det-lbl">Comeback</span><span class="tgt-det-val" style="color:#64a0ff">+${_tgtFmtM(cbGmv)}</span><span class="tgt-det-count">${cbCount} outlets</span><span class="ncs-row-btn" style="color:#64a0ff;border-color:rgba(100,160,255,.3)">ดู ›</span></div>`:''}
      ${exGmv>0?`<div class="tgt-det-row tappable" onclick="_tgtShowCohortSheet('ex')"><div class="tgt-det-dot" style="background:#00c8b0"></div><span class="tgt-det-lbl">Expansion</span><span class="tgt-det-val" style="color:#00c8b0">+${_tgtFmtM(exGmv)}</span><span class="tgt-det-count">${exCount} outlets</span><span class="ncs-row-btn" style="color:#00c8b0;border-color:rgba(0,200,176,.3)">ดู ›</span></div>`:''}
    </div>` : '';

  // ── Baseline formula section ──────────────────────────────────
  let baselineSection = '';
  if (typeof bulkHistoryData !== 'undefined' && bulkHistoryData) {
    const _mo2 = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const _ms2 = m => { const p=(m||'').split(' '); return (parseInt(p[1]||0)*12)+_mo2.indexOf(p[0]); };
    const allM2 = new Set();
    accounts.forEach(a => (bulkHistoryData[a.id]||[]).forEach(h => { if(h.m) allM2.add(h.m); }));
    // v205c: exclude current month from baseline (same as _tgtKamBaseline3mo — avoids partial MTD skew)
    const _nowBS = new Date();
    const _curMoBS = _mo2[_nowBS.getMonth()] + ' ' + (_nowBS.getFullYear() + 543);
    const last3m = Array.from(allM2).filter(m => m !== _curMoBS).sort((a,b)=>_ms2(a)-_ms2(b)).slice(-3);
    const hasOutlets2 = typeof bulkOutletsData !== 'undefined' && bulkOutletsData;
    if (last3m.length) {
      // v205c: dedup accounts by id — prevents double-counting if portview.csv has duplicate rows
      const _dedupAccts = Array.from(new Map(accounts.map(a=>[a.id,a])).values());
      const rows3 = last3m.map(m => {
        const gmv = _dedupAccts.reduce((s,a) => { const r=(bulkHistoryData[a.id]||[]).find(h=>h.m===m); return s+(r?(r.gmv||r.s||0):0); }, 0);
        const days = getThaiMonthDays(m);
        // Count unique outlets that month
        let outletCount = 0;
        if (hasOutlets2) {
          const seen = new Set();
          accounts.forEach(a => { (((bulkOutletsData[a.id]||{})[m])||[]).forEach(o => { const id=o.outlet_id||o.outletId||o.id; if(id&&o.gmv>0) seen.add(id); }); });
          outletCount = seen.size;
        }
        return { m, gmv, days, daily: days>0?Math.round(gmv/days):0, outletCount };
      });
      const avgDaily = Math.round(rows3.reduce((s,r)=>s+r.daily,0)/rows3.length);
      const fmlRows = rows3.map(r=>`<div class="tgt-fml-row"><span class="tgt-fml-mo">${r.m}</span><span class="tgt-fml-eq">${_tgtFmtM(r.gmv)} ÷ ${r.days}d × ${daysInMonth}d${r.outletCount>0?' · '+r.outletCount+' outlets':''}</span><span class="tgt-fml-res">~${_tgtFmtM(Math.round(r.daily*daysInMonth))}/เดือน</span></div>`).join('');
      baselineSection = `<div class="tgt-det-section">
        <div class="tgt-det-stitle">วิธีคำนวณ Baseline</div>
        ${fmlRows}
        <div class="tgt-fml-total"><span class="tgt-fml-total-lbl">avg ${rows3.length} เดือน (normalized)</span><span class="tgt-fml-total-val">= ${_tgtFmtM(avgDaily*daysInMonth)}/เดือน</span></div>
      </div>`;
    }
  }

  // ── Movement rows (v198) ─────────────────────────────────────
  const fmtK = v => v>=1000000?'฿'+(v/1000000).toFixed(1)+'M':v>=1000?'฿'+(v/1000).toFixed(0)+'K':'฿'+Math.round(v);
  const nrrColor = n => n===null?'rgba(255,255,255,.3)':n>=1?'#4ddc97':n>=0.9?'rgba(240,176,0,.9)':'rgba(255,100,100,.9)';
  const nrrPctStr = n => n===null?'—':Math.round(n*100)+'%';
  const mvRows = [];
  if (nrrResult && nrrResult.transferIn && nrrResult.transferIn.count > 0) {
    const ti = nrrResult.transferIn;
    mvRows.push(`<div class="tgt-mv-row"><span class="tgt-mv-label">Transfer in</span><span class="tgt-mv-count">${ti.count} ร้าน</span><span class="tgt-mv-gmv">${fmtK(ti.gmv)}</span><span class="tgt-mv-nrr" style="color:${nrrColor(ti.nrr)}">${nrrPctStr(ti.nrr)}</span></div>`);
  }
  if (nrrResult && nrrResult.newFromSales && nrrResult.newFromSales.count > 0) {
    const ns = nrrResult.newFromSales;
    mvRows.push(`<div class="tgt-mv-row"><span class="tgt-mv-label">New (Sales)</span><span class="tgt-mv-count">${ns.count} ร้าน</span><span class="tgt-mv-gmv">${fmtK(ns.gmv)}</span><span class="tgt-mv-nrr" style="color:${nrrColor(ns.nrr)}">${nrrPctStr(ns.nrr)}</span></div>`);
  }
  if (nrrResult && nrrResult.transferOut && nrrResult.transferOut.count > 0) {
    const to = nrrResult.transferOut;
    mvRows.push(`<div class="tgt-mv-row tgt-mv-out"><span class="tgt-mv-label">Transfer out</span><span class="tgt-mv-count">${to.count} ร้าน</span><span class="tgt-mv-gmv tgt-mv-neg">−${fmtK(to.gmv)}</span><span class="tgt-mv-nrr" style="color:rgba(255,255,255,.3)">—</span></div>`);
  }
  const mvSection = mvRows.length ? `<div class="tgt-mv-wrap">
    <div class="tgt-mv-header"><span class="tgt-mv-label">การเคลื่อนไหวพอร์ต</span><span class="tgt-mv-count">ร้าน</span><span class="tgt-mv-gmv">GMV</span><span class="tgt-mv-nrr">NRR</span></div>
    ${mvRows.join('')}
  </div>` : '';

  // ── NRR formula + cohort definition for ⓘ panel ──────────────

  let nrrSection = '';
  if (nrrResult && nrrPct !== null) {
    const prevDaily = nrrResult.prevDays>0 ? Math.round(nrrResult.baselinePrevGmv/nrrResult.prevDays) : 0;
    const currDaily = nrrResult.daysElapsed>0 ? Math.round(nrrResult.cohortGmv/nrrResult.daysElapsed) : 0;
    const prevNorm = Math.round(prevDaily * daysInMonth);
    const currNorm = Math.round(currDaily * daysInMonth);
    // Movement summary for ⓘ panel
    const hasMv = nrrResult.transferIn?.count||nrrResult.newFromSales?.count||nrrResult.transferOut?.count;
    const mvDefSection = hasMv ? `<div class="tgt-det-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div class="tgt-det-stitle" style="margin-bottom:0">นิยาม Portfolio Movement</div>
        <button onclick="var d=this.parentElement.nextElementSibling;d.style.display=d.style.display==='none'?'block':'none';this.textContent=d.style.display==='none'?'▾ ดูนิยาม':'▴ ซ่อน'" style="font-size:9px;color:rgba(255,255,255,.4);background:none;border:none;cursor:pointer;padding:0;font-family:'IBM Plex Sans Thai',sans-serif">▾ ดูนิยาม</button>
      </div>
      <div style="display:none">
        <div class="tgt-fml-row" style="align-items:flex-start"><span class="tgt-fml-mo" style="color:#4ddc97">Core NRR</span><span class="tgt-fml-eq" style="font-size:10px">account ที่อยู่กับ KAM นี้ก่อนต้นเดือน (daysWithKAM &gt; daysElapsed) — วัด retention จริง</span></div>
        <div class="tgt-fml-row" style="align-items:flex-start"><span class="tgt-fml-mo" style="color:rgba(140,180,255,.9)">Transfer in</span><span class="tgt-fml-eq" style="font-size:10px">account ที่โอนมาจาก KAM อื่นในเดือนนี้ — วัด NRR ต่อเนื่องหลังรับโอน</span></div>
        <div class="tgt-fml-row" style="align-items:flex-start"><span class="tgt-fml-mo" style="color:rgba(0,200,176,.9)">New (Sales)</span><span class="tgt-fml-eq" style="font-size:10px">account ที่ Sales ปิดดีล แล้วโอนมา KAM เดือนนี้ — วัด onboarding success</span></div>
        <div class="tgt-fml-row" style="align-items:flex-start"><span class="tgt-fml-mo" style="color:rgba(255,140,100,.8)">Transfer out</span><span class="tgt-fml-eq" style="font-size:10px">account ที่ออกจากพอร์ตนี้ไปเดือนนี้ — GMV เดือนก่อนของ account เหล่านั้น</span></div>
        <div class="tgt-fml-row" style="align-items:flex-start;margin-top:4px"><span class="tgt-fml-mo" style="color:rgba(255,255,255,.3)">Graduation</span><span class="tgt-fml-eq" style="font-size:10px">Transfer in / New จะกลายเป็น Core NRR อัตโนมัติเดือนหน้า โดยใช้ GMV เต็มเดือนนี้เป็น baseline</span></div>
      </div>
    </div>` : '';
    nrrSection = `<div class="tgt-det-section">
      <div class="tgt-det-stitle">Core NRR — วิธีคำนวณ</div>
      <div style="font-size:11px;color:rgba(255,255,255,.65);margin-bottom:8px;line-height:1.5">NRR วัดว่าร้านเดิมยังซื้ออยู่มากน้อยแค่ไหนเทียบกับเดือนก่อน — โดยประมาณจากยอด MTD × ${daysInMonth} วัน</div>
      <div style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:6px">เฉพาะร้านที่อยู่ในพอร์ตมาตั้งแต่เดือนก่อน</div>
      <div class="tgt-fml-row"><span class="tgt-fml-mo">${nrrResult.prevMonth}</span><span class="tgt-fml-eq">${_tgtFmtM(nrrResult.baselinePrevGmv)} ÷ ${nrrResult.prevDays}d × ${daysInMonth}d · ${nrrResult.cohortCount} outlets</span><span class="tgt-fml-res">~${_tgtFmtM(prevNorm)}/เดือน</span></div>
      <div class="tgt-fml-row"><span class="tgt-fml-mo">${nrrResult.currentMonthLabel} MTD</span><span class="tgt-fml-eq">${_tgtFmtM(nrrResult.cohortGmv)} ÷ ${nrrResult.daysElapsed}d × ${daysInMonth}d · ${nrrResult.cohortCount} outlets</span><span class="tgt-fml-res">~${_tgtFmtM(currNorm)}/เดือน</span></div>
      <div class="tgt-fml-total"><span class="tgt-fml-total-lbl">~${_tgtFmtM(currNorm)} ÷ ~${_tgtFmtM(prevNorm)}</span><span class="tgt-fml-total-val">= Core NRR ${nrrPct}%</span></div>
    </div>${mvDefSection}`;
  }

  // ── IDs ──────────────────────────────────────────────────────
  const detPanelId = 'tgt-dp-'+(isTL?'tl':email.replace(/\W/g,'_'));
  const detHandleId= 'tgt-dh-'+(isTL?'tl':email.replace(/\W/g,'_'));

  // ── Target color code ─────────────────────────────────────────
  const targetCls = fbMode===null ? 'tgt-real' : fbMode==='team' ? 'tgt-alloc' : 'tgt-base';
  const denomTilde = fbMode ? '~' : '';

  bar.className = fbMode==='team'?'fb-team':fbMode==='base'?'fb-base':'';
  // Ensure pace bar is hidden — tgt bar is the single visible widget (v190)
  const oldBar = document.getElementById('portview-pace-bar');
  if (oldBar) oldBar.style.display = 'none';
  bar.style.display = target > 0 ? 'block' : 'none';
  bar.style.opacity = '1';
  bar.classList.remove('tgt-skeleton');
  if (!target) {
    // No target set — reveal legacy pace bar as fallback (v190)
    if (oldBar) oldBar.style.display = 'block';
    return;
  }
  // Value guard: skip re-render only if BOTH pace% AND nrr state are unchanged
  // v224d fix: nrrPct must be part of key — otherwise widget won't update when history.csv loads late
  const _existingPctEl = bar.querySelector('#tgt-pct-num');
  // v225g: include outlets state in key — forces re-render when outlets arrive (shimmer→real)
  const _renderKey = `${pct}|${_outletsReady ? (nrrPct !== null ? nrrPct : 'x') : 'loading'}`;
  if (_existingPctEl && _existingPctEl.dataset.renderKey === _renderKey) return;
  if (_existingPctEl) _existingPctEl.dataset.renderKey = _renderKey;

  void bar.offsetHeight;
  const colorKeySection = `<div class="tgt-det-section">
    <div class="tgt-det-stitle">สีของตัวเลข เป้าหมาย</div>
    <div class="tgt-color-key">
      <div class="tgt-ck-item"><div class="tgt-ck-swatch" style="background:#4ddc97"></div><span class="tgt-ck-lbl">สีเขียว = Target จริงที่ TL ตั้ง</span></div>
      <div class="tgt-ck-item"><div class="tgt-ck-swatch" style="background:var(--amb,#f0b000)"></div><span class="tgt-ck-lbl">อำพัน = ประมาณการจากโควต้าทีม</span></div>
      <div class="tgt-ck-item"><div class="tgt-ck-swatch" style="background:rgba(255,255,255,.4);border:1px solid rgba(255,255,255,.2)"></div><span class="tgt-ck-lbl">ขาวหมอง = baseline avg 3 เดือน (ยังไม่มี Target)</span></div>
    </div>
  </div>`;

  const overflowBadge = pct > 100
    ? `<span class="tgt-overflow-badge">+${pct-100}%</span>`
    : '';

  bar.innerHTML = `
    <div class="tgt-bar-header">
      <div class="tgt-bar-left">
        <span id="tgt-pct-num" class="tgt-bar-pct ${cls}">${pct}%</span>
        ${daysElapsed>0?`<span class="tgt-bar-days-inline">${daysElapsed} / ${daysInMonth} วัน</span>`:''}
      </div>
      <div class="tgt-bar-right">
        <div class="tgt-rr-label">RUN RATE</div>
        <div class="tgt-rr-row">
          <span class="tgt-rr-actual">${_tgtFmtM(runRate)}</span>
          <span class="tgt-rr-sep">/</span>
          <span class="tgt-rr-target ${targetCls}">${denomTilde}${_tgtFmtM(target)}</span>
          ${(fbMode!=='base'&&_baseline3mo>0)?`<span style="font-size:11px;color:rgba(255,255,255,.55);margin-left:3px">(${_tgtFmtM(_baseline3mo)})</span>`:``}
        </div>
      </div>
    </div>
    <div class="tgt-seg-wrap">
      ${nrrBarW>0?`<div class="tgt-seg nrr${segFull}" style="left:0;width:${nrrBarW}%"></div>`:''}
      ${cbBarW>0?`<div class="tgt-seg comeback" style="left:${nrrBarW}%;width:${cbBarW}%"></div>`:''}
      ${exBarW>0?`<div class="tgt-seg expansion" style="left:${nrrBarW+cbBarW}%;width:${exBarW}%"></div>`:''}
    </div>
    <div class="tgt-pct-legend">
      ${nrrLeg}${cbLeg}${exLeg}
      ${overflowBadge}
      ${setupBtn}
      <button class="tgt-info-btn${false?' open':''}" id="${detHandleId}" onclick="_tgtToggleDetail('${detPanelId}','${detHandleId}')">i</button>
    </div>
    ${mvSection}
    <div class="tgt-detail-panel" id="${detPanelId}">
      ${gmvSection}${nrrSection}${baselineSection}${colorKeySection}
    </div>`;

}

function _tgtToggleDetail(panelId, handleId) {
  const p=document.getElementById(panelId);
  const h=document.getElementById(handleId);
  if(!p||!h) return;
  const open=p.classList.toggle('open');
  h.classList.toggle('open',open);
}

// ── Teamview: target rows are now rendered in the main KAM card metrics ───────
function _tgtInjectTeamviewTargetRows() {
  // v207f: no-op by design. Teamview cards already use runRate ÷ target when targets exist,
  // so appending a second target row would create duplicate/conflicting signals.
  return;
}

// ── Utility helpers ─────────────────────────────────────────────
function _tgtSafeId(str) {
  return (str || '').replace(/[^a-zA-Z0-9]/g, '_');
}

function _tgtGetKamsForTL(tlEmail) {
  const kamMap = {};
  if (typeof portviewBulkData !== 'undefined' && portviewBulkData.length) {
    portviewBulkData.filter(r => !tlEmail || r.tlEmail === tlEmail).forEach(r => {
      const email = r.kamEmail || '';
      const name = r.kamName || email;
      if (email && !kamMap[email]) kamMap[email] = { email, name };
    });
  }
  return Object.values(kamMap);
}

function _tgtKamBaseline3mo(kamEmail, tlEmail, mode) {
  // Method C: avg daily rate across last 3 closed months × days in current month
  if (typeof bulkHistoryData === 'undefined') return 0;
  const accounts = (typeof portviewBulkData !== 'undefined' ? portviewBulkData : [])
    .filter(a => {
      if (mode === 'kam' && kamEmail) return a.kamEmail === kamEmail;
      if (mode === 'tl' && tlEmail) return a.tlEmail === tlEmail;
      return true;
    });
  if (!accounts.length) return 0;
  const mo = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const moSort = m => { const p = (m||'').split(' '); return (parseInt(p[1]||0)*12) + mo.indexOf(p[0]); };
  const allMonths = new Set();
  accounts.forEach(a => (bulkHistoryData[a.id] || []).forEach(h => { if (h.m) allMonths.add(h.m); }));
  // v205c: exclude current month (MTD partial data skews daily rate down)
  const _now3mo = new Date();
  const _curMonthLabel3mo = mo[_now3mo.getMonth()] + ' ' + (_now3mo.getFullYear() + 543);
  const last3 = Array.from(allMonths)
    .filter(m => m !== _curMonthLabel3mo)
    .sort((a,b) => moSort(a)-moSort(b))
    .slice(-3);
  if (!last3.length) return 0;
  // Sum GMV per month, normalize by days in that month → get avg daily rate
  const dailyRates = last3.map(m => {
    const monthGmv = accounts.reduce((s, a) => {
      const row = (bulkHistoryData[a.id] || []).find(h => h.m === m);
      return s + (row ? (row.gmv || row.s || 0) : 0);
    }, 0);
    const days = getThaiMonthDays(m);
    return days > 0 ? monthGmv / days : 0;
  });
  const avgDailyRate = dailyRates.reduce((s,v) => s+v, 0) / last3.length;
  // × days in current month (from paceSignal or calendar)
  // v205c fix: daysInMonth is top-level on account object, NOT inside paceSignal
  // a.paceSignal.daysInMonth is always undefined → was defaulting to 30 even in 31-day months
  let daysInCurrentMonth = 30;
  for (const a of accounts) {
    const dim = a.daysInMonth || (a.paceSignal && a.paceSignal.daysInMonth) || 0;
    if (dim > 0) { daysInCurrentMonth = dim; break; }
  }
  return Math.round(avgDailyRate * daysInCurrentMonth);
}

// ── Hook into existing render pipeline ─────────────────────────
// Patch renderTeamviewKamList to inject target rows
const _origRenderTeamviewKamList = typeof renderTeamviewKamList === 'function' ? renderTeamviewKamList : null;
if (_origRenderTeamviewKamList) {
  window.renderTeamviewKamList = function() {
    _origRenderTeamviewKamList.apply(this, arguments);
    requestAnimationFrame(()=>setTimeout(() => _tgtInjectTeamviewTargetRows(), 120));
  };
}

// ── Admin button in teamview header ────────────────────────────
// Inject "ตั้ง Target" button into tv-pace-bar area for admin/TL
function _tgtInjectAdminBtn() {
  // v193i: Target button moved to teamview header (tv-target-btn) — no longer injected here
  return;
  const role = (currentUserProfile && currentUserProfile.role) || 'rep';
  if (role !== 'tl' && role !== 'admin') return;
  const tvBar = document.getElementById('tv-pace-bar');
  if (!tvBar) return;
  if (document.getElementById('tgt-tv-admin-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'tgt-tv-admin-btn';
  btn.className = 'tgt-admin-btn';
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> ตั้ง Target`;
  btn.onclick = () => openTargetSetup(role === 'admin' ? 'admin' : 'tl');
  tvBar.parentNode.insertBefore(btn, tvBar);
}

// ── Inject target bar placeholder into portview HTML ──────────
function _injectPortviewBarEl() {
  const ref = document.getElementById('portview-pace-bar');
  if (ref) {
    if (!document.getElementById('tgt-portview-bar')) {
      const div = document.createElement('div');
      div.id = 'tgt-portview-bar';
      div.style.display = 'none';
      ref.parentNode.insertBefore(div, ref);
    }
    if (!document.getElementById('tgt-nrr-bar')) {
      const nrrDiv = document.createElement('div');
      nrrDiv.id = 'tgt-nrr-bar';
      ref.parentNode.insertBefore(nrrDiv, ref);
    }
  }
}
// Run immediately + on DOM ready (portview may not exist yet at parse time)
_injectPortviewBarEl();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _injectPortviewBarEl);
} else {
  setTimeout(_injectPortviewBarEl, 500);
}

// ── v224e: Pre-load targets from localStorage at module parse time ──
// Runs synchronously before first refreshAll — _tgtLoaded=true means first render uses real target,
// not 3-month baseline fallback. Eliminates baseline→target flash on TL teamview.
(function _tgtPreloadFromLocalStorage(){
  try{
    const _q=_tgtCurrentQuarter();
    const _raw=localStorage.getItem('sense_tgt_ls_'+_q);
    if(!_raw)return;
    const _obj=JSON.parse(_raw);
    if(!_obj||!_obj.ts||!_obj.data)return;
    if(Date.now()-_obj.ts>24*60*60*1000)return; // stale after 24h
    const d=_obj.data;
    _tgtCache={...(d.cache||{})};
    _tgtSettings={...(d.settings||{nrr_threshold:98})};
    _nrrGovPolicies={...(d.nrrPolicies||{})};
    _commRuleConfig=JSON.parse(JSON.stringify(d.commRules||{plans:{},rules:{},tiers:{}}));
    _nrrExclusions=JSON.parse(JSON.stringify(d.nrrExclusions||[]));
    _commissionSnapshots=JSON.parse(JSON.stringify(d.commissionSnapshots||[]));
    _tgtQuarterCache[_q]={cache:{..._tgtCache},settings:{..._tgtSettings},nrrPolicies:{..._nrrGovPolicies},
      commRules:JSON.parse(JSON.stringify(_commRuleConfig)),nrrExclusions:JSON.parse(JSON.stringify(_nrrExclusions)),
      commissionSnapshots:JSON.parse(JSON.stringify(_commissionSnapshots)),ts:_obj.ts};
    _tgtLoaded=true;
  }catch(e){}
})();

// ── Init: poll for portview visibility on startup ──────────────
setTimeout(async function _tgtInitCheck() {
  const role = (currentUserProfile && currentUserProfile.role) || '';
  if (!role) { setTimeout(_tgtInitCheck, 600); return; }
  // v224e render-gate: wait for portview+history data before NRR render
  // prevents NRR bar rendering with ฿0 then re-rendering with real value
  if (typeof allCriticalReady === 'function' && !allCriticalReady()) {
    setTimeout(_tgtInitCheck, 400); return;
  }
  _injectPortviewBarEl();
  await loadTargets(_tgtCurrentQuarter());
  renderPortviewTargetBar();
  renderPortviewNRRBar();
  _tgtInjectAdminBtn();
  try{
    const tv=document.getElementById('scr-teamview');
    if(tv && tv.classList.contains('on')){
      if(typeof renderTeamviewSummary==='function') renderTeamviewSummary();
      if(typeof renderTeamviewKamList==='function') renderTeamviewKamList();
    }
  }catch(e){ console.warn('[target init] teamview refresh', e); }
  _tgtInjectTeamviewTargetRows();
}, 1500);

// Also hook into portview renders directly
const _origRPL_tgt = typeof renderPortviewList === 'function' ? renderPortviewList : null;
if (_origRPL_tgt && !window._tgtPortviewHooked) {
  window._tgtPortviewHooked = true;
  const _prev = window.renderPortviewList;
  window.renderPortviewList = function() {
    _prev && _prev.apply(this, arguments);
    _injectPortviewBarEl(); setTimeout(() => { renderPortviewTargetBar(); renderPortviewNRRBar(); }, 80);
  };
}



// ── Commission Render Gate (v224e) ─────────────────────────────────────
// Single entry point for all commission UI renders on startup.
// Renders ONCE when role AND allCriticalReady() are both true.
// Deduplicates: skips re-render if underlying data hasn't changed.
// Eliminates the 7-render cascade (DOMContentLoaded × 3 timers + setInterval)
// that caused commission numbers to flicker on every login.
(function(){
  'use strict';
  var _lastCommKey = '';
  var _hooked = false;

  function _dataKey(){
    try{
      var ph = (typeof portviewBulkData!=='undefined' && portviewBulkData) ? portviewBulkData.length : -1;
      var hh = (typeof bulkHistoryData!=='undefined' && bulkHistoryData) ? Object.keys(bulkHistoryData).length : -1;
      var r  = (typeof getCurrentRole==='function') ? getCurrentRole()
                : ((window.currentUserProfile&&window.currentUserProfile.role)||'');
      return r + ':' + ph + ':' + hh;
    }catch(e){ return ''; }
  }

  function _commGatedRender(){
    var r = (typeof getCurrentRole==='function') ? getCurrentRole()
            : ((window.currentUserProfile&&window.currentUserProfile.role)||'');
    if (!r) return;
    if (typeof allCriticalReady==='function' && !allCriticalReady()) return;
    var key = _dataKey();
    if (!key || key === _lastCommKey) return;
    _lastCommKey = key;
    try{ if(typeof syncCommissionAdminVisibility==='function') syncCommissionAdminVisibility(); }catch(e){}
    try{ if(typeof ensureKamCommissionCard==='function') ensureKamCommissionCard(); }catch(e){}
  }

  window._commGatedRender = _commGatedRender;

  // Reset key on each refreshAll so commission re-renders after data refresh
  function _hookRefreshAll(){
    if(_hooked) return;
    if(typeof refreshAll !== 'function') return;
    _hooked = true;
    var _orig = refreshAll;
    var _hooked_fn = function(){
      var res = _orig.apply(this, arguments);
      _lastCommKey = ''; // allow re-render with new data
      _commGatedRender();
      return res;
    };
    window.refreshAll = _hooked_fn;
    try{ refreshAll = _hooked_fn; }catch(e){}
  }

  // Hook immediately if refreshAll already defined, else retry
  _hookRefreshAll();
  if(!_hooked){
    var _hookTimer = setInterval(function(){
      _hookRefreshAll();
      if(_hooked) clearInterval(_hookTimer);
    }, 200);
    setTimeout(function(){ clearInterval(_hookTimer); }, 5000);
  }
})();

// ══════════════════════════════════════════════════════════════════
// COMMISSION PATCHES — inlined for locality
// Original patches: v210h · v210i · v210k · v211 (dependency order)
// Execution order preserved. All commission logic now in this block.
// ══════════════════════════════════════════════════════════════════

// ── [v210h] Commission admin visibility ─────────────────────────────
// PATCH: freshket-v210h-commission-regression-fix-js
//////////////////////////////////////////////////////////////////////////////

(function(){
  function syncCommissionAdminVisibility(){
    var btn=document.getElementById('tv-commission-btn');
    if(!btn)return;
    var role=(window.currentUserProfile&&window.currentUserProfile.role)||'';
    var isAdmin=role==='admin';
    btn.classList.toggle('comm-admin-hidden', !isAdmin);
    btn.setAttribute('aria-hidden', isAdmin?'false':'true');
    btn.tabIndex=isAdmin?0:-1;
    btn.style.display=isAdmin?'inline-flex':'none';
  }
  window.syncCommissionAdminVisibility=syncCommissionAdminVisibility;
  // v224e render-gate: commission admin visibility handled by _commGatedRender, not timers
  document.addEventListener('click', function(e){
    var btn=e.target&&e.target.closest&&e.target.closest('#tv-commission-btn,.commission-open');
    if(!btn)return;
    var role=(window.currentUserProfile&&window.currentUserProfile.role)||'';
    if(role!=='admin'){
      e.preventDefault();e.stopPropagation();
      if(typeof window.showToast==='function')window.showToast('Commission Cockpit เปิดได้เฉพาะ Admin','!');
    }
  }, true);
})();


//////////////////////////////////////////////////////////////////////////////

// ── [v210i] Role normalization + body class sync ────────────────────
// PATCH: freshket-v210i-role-normalization-js
//////////////////////////////////////////////////////////////////////////////

(function(){
  function safeProfile(){ try{return currentUserProfile||null;}catch(e){return null;} }
  function norm(role){
    if(typeof normalizeRole==='function') return normalizeRole(role);
    var r=String(role||'').trim().toLowerCase();
    if(r==='kam'||r==='ka'||r==='key_account'||r==='key account')return 'rep';
    if(r==='team_lead'||r==='team lead')return 'tl';
    return r||'rep';
  }
  function curRole(){
    try{ if(typeof getCurrentRole==='function') return getCurrentRole(); }catch(e){}
    var p=safeProfile(); return norm(p&&p.role);
  }
  function isAdmin(){return curRole()==='admin';}
  function isTL(){return curRole()==='tl';}
  function isRep(){return curRole()==='rep';}
  function normalizeProfileAndBody(){
    var p=safeProfile();
    var r=curRole();
    try{ if(p){ p.role=r; p.role_label=(r==='rep'?'KAM':r==='tl'?'TL':r==='admin'?'Admin':r); } }catch(e){}
    try{
      document.body.classList.toggle('role-admin', r==='admin');
      document.body.classList.toggle('role-tl', r==='tl');
      document.body.classList.toggle('role-rep', r==='rep');
      document.body.setAttribute('data-role', r);
    }catch(e){}
    return r;
  }
  function syncCommissionAdminVisibility(){
    var r=normalizeProfileAndBody();
    var btn=document.getElementById('tv-commission-btn');
    if(!btn)return;
    var admin=(r==='admin');
    btn.classList.toggle('comm-admin-hidden', !admin);
    btn.setAttribute('aria-hidden', admin?'false':'true');
    btn.tabIndex=admin?0:-1;
    btn.style.display=admin?'inline-flex':'none';
  }
  function ensureKamCommissionCard(){
    normalizeProfileAndBody();
    try{
      if (typeof _commRenderKamSelfStrip === 'function') {
        _commRenderKamSelfStrip();
        return;
      }
    }catch(e){ console.warn('[v210j] KAM commission strip render failed', e); }
    var slot=document.getElementById('pv-commission-strip');
    if(slot) slot.innerHTML='';
  }
  window.syncCommissionAdminVisibility=syncCommissionAdminVisibility;
  window._commEnsureKamSelfCard=ensureKamCommissionCard;
  window._senseNormalizeProfileAndBody=normalizeProfileAndBody;

  try{
    var _renderPortviewSummary=renderPortviewSummary;
    renderPortviewSummary=function(){
      normalizeProfileAndBody();
      var out=_renderPortviewSummary.apply(this, arguments);
      requestAnimationFrame(function(){ syncCommissionAdminVisibility(); });
      // v224e: ensureKamCommissionCard moved to _commGatedRender (data-gate-aware)
      return out;
    };
  }catch(e){}
  try{
    var _renderPortview=renderPortview;
    renderPortview=function(){
      normalizeProfileAndBody();
      var out=_renderPortview.apply(this, arguments);
      // v224e: ensureKamCommissionCard moved to _commGatedRender (fires once after data ready)
      if(typeof window._commGatedRender==='function') window._commGatedRender();
      return out;
    };
  }catch(e){}
  try{
    var _renderTeamview=renderTeamview;
    renderTeamview=function(){
      normalizeProfileAndBody();
      var out=_renderTeamview.apply(this, arguments);
      requestAnimationFrame(syncCommissionAdminVisibility);
      return out;
    };
  }catch(e){}
  try{
    var _openCommissionCockpit=openCommissionCockpit;
    openCommissionCockpit=function(step){
      normalizeProfileAndBody();
      if(!isAdmin()){
        if(typeof showToast==='function') showToast('Commission Cockpit เปิดได้เฉพาะ Admin','!');
        return;
      }
      return _openCommissionCockpit.apply(this, arguments);
    };
    window.openCommissionCockpit=openCommissionCockpit;
  }catch(e){}

  document.addEventListener('click', function(e){
    var btn=e.target&&e.target.closest&&e.target.closest('#tv-commission-btn,.commission-open');
    if(!btn)return;
    normalizeProfileAndBody();
    if(!isAdmin()){
      e.preventDefault(); e.stopPropagation();
      if(typeof showToast==='function') showToast('Commission Cockpit เปิดได้เฉพาะ Admin','!');
    }
  }, true);
  // v224e render-gate: DOMContentLoaded timers and setInterval polling removed.
  // Commission strip renders via _commGatedRender() which fires once after
  // allCriticalReady() = true. Eliminates 7-render cascade on login.
})();


//////////////////////////////////////////////////////////////////////////////

// ── [v210k] KAM commission compact strip ────────────────────────────
// PATCH: freshket-v210k-kam-commission-compact-js
//////////////////////////////////////////////////////////////////////////////

(function(){
  function esc(v){
    try{ return typeof _commEscapeHtml==='function' ? _commEscapeHtml(v) : String(v ?? '').replace(/[&<>'"]/g, function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];}); }
    catch(e){ return String(v ?? ''); }
  }
  function money(n){ try{return _commFmtPayout(n);}catch(e){ n=Number(n||0); return n?'฿'+Math.round(n).toLocaleString('en-US'):'฿0'; } }
  function pts(n){ try{return _commFormatPts(n);}catch(e){ var x=Number(n||0); return x.toFixed(1).replace('.0',''); } }
  function buildSources(st){
    var nrr=Number(st&&st.payout||0);
    var uplift=0;
    var handover=0;
    return { nrr:nrr, uplift:uplift, handover:handover };
  }
  function buildCompactStrip(){
    if(typeof _commBuildKamSelfState!=='function') return '';
    var st=_commBuildKamSelfState();
    if(!st) return '';
    var src=buildSources(st);
    var paid=Number(st.payout||0)>0;
    var cls='v210k '+(paid?'paid':'unpaid')+' '+esc(st.cls||'');
    var status=st.status || (paid?'ถึงเกณฑ์แล้ว':'ยังไม่ถึงเกณฑ์');
    return '<div class="pv-comm-strip '+cls+'" data-v210k="1">'
      + '<div class="pv-comm-title">ค่าคอมฯ เดือนนี้</div>'
      + '<div class="pv-comm-main">'+money(st.payout)+'</div>'
      + '<div class="pv-comm-chip" title="'+esc(status)+'">'+esc(status)+'</div>'
      + '<button class="pv-comm-i" aria-label="ดูวิธีคิดค่าคอมฯ" onclick="event.stopPropagation();_commOpenKamSelfSheet();">i</button>'
      + '<div class="pv-comm-sources" title="NRR '+esc(money(src.nrr))+' · Uplift '+esc(money(src.uplift))+' · Handover '+esc(money(src.handover))+'">'
      + '<span class="src-nrr"><b>NRR</b> '+money(src.nrr)+'</span><span class="pv-comm-sep">·</span>'
      + '<span><b>Uplift</b> '+money(src.uplift)+'</span><span class="pv-comm-sep">·</span>'
      + '<span><b>Handover</b> '+money(src.handover)+'</span>'
      + '</div>'
      + '</div>';
  }
  function renderCompactStrip(){
    var slot=document.getElementById('pv-commission-strip') || (function(){
      var row=document.getElementById('portview-summary-row');
      if(!row||!row.parentNode) return null;
      var d=document.createElement('div');
      d.id='pv-commission-strip';
      d.className='pv-commission-strip-slot';
      row.parentNode.insertBefore(d,row);
      return d;
    })();
    if(!slot) return;
    var html=buildCompactStrip() || '';
    // Value guard: skip rebuild if content unchanged
    if(slot._lastCommHtml===html && slot.innerHTML) return;
    slot._lastCommHtml=html;
    slot.innerHTML=html;
  }
  function openCompactSheet(){
    if(typeof _commBuildKamSelfState!=='function') return;
    var st=_commBuildKamSelfState();
    if(!st) return;
    var ov=document.getElementById('pv-comm-sheet-overlay');
    if(!ov){
      ov=document.createElement('div');
      ov.id='pv-comm-sheet-overlay';
      ov.className='pv-comm-sheet-overlay';
      ov.onclick=function(e){ if(e.target===ov) closeCompactSheet(); };
      document.body.appendChild(ov);
    }
    var pctText=st.pct!==null && st.pct!==undefined ? (st.pct+'%') : '—';
    var src=buildSources(st);
    var tierRows=(st.tiers||[]).map(function(t,idx){
      var on=st.tier && idx===st.currentIdx;
      var isNext=st.next && String(t.id||idx)===String(st.next.id||(st.tiers||[]).indexOf(st.next));
      var label=(typeof _commTierRangeLabel==='function'?_commTierRangeLabel(t):'')+' · '+(t.payout_label||'');
      return '<div class="pv-comm-tier-row '+(on?'on':isNext?'next':'')+'"><div class="pv-comm-tier-range">'+esc(label)+'</div><div class="pv-comm-tier-pay">'+money(t.payout_value)+'</div></div>';
    }).join('');
    var action='รอข้อมูล NRR สำหรับคำนวณค่าคอมฯ เดือนนี้';
    if(st.pct!==null && st.pct!==undefined){
      if(st.next) action='NRR ต้องเพิ่มอีก +'+pts(Math.max(0, Number(st.next.min_value)-Number(st.pct)))+' pts เพื่อถึง tier ถัดไป';
      else if(Number(st.payout||0)>0) action='รักษา NRR ให้อยู่ใน tier นี้จนจบเดือน';
      else action='ยังไม่ถึง tier แรก ให้โฟกัสร้านเสี่ยงและ monitor ก่อน';
    }
    var kpiCls=Number(st.payout||0)>0?'val-bonus':'';
    ov.innerHTML='<div class="pv-comm-sheet">'
      + '<div class="pv-comm-sheet-handle"></div>'
      + '<div class="pv-comm-sheet-body">'
      + '<div class="pv-comm-sheet-title">วิธีคิดค่าคอมฯ</div>'
      + '<div class="pv-comm-sheet-sub">สรุปค่าคอมฯ เดือนนี้ แยกตามแหล่งที่มา</div>'
      + '<div class="pv-comm-sheet-kpis">'
      + '<div class="pv-comm-sheet-kpi '+kpiCls+'"><div class="pv-comm-sheet-kpi-label">ค่าคอมฯ ตอนนี้</div><div class="pv-comm-sheet-kpi-val">'+money(st.payout)+'</div></div>'
      + '<div class="pv-comm-sheet-kpi"><div class="pv-comm-sheet-kpi-label">NRR ที่ใช้คิด</div><div class="pv-comm-sheet-kpi-val">'+esc(pctText)+'</div></div>'
      + '</div>'
      + '<div class="pv-comm-source-table">'
      + '<div class="pv-comm-source-row '+(src.nrr>0?'paid':'')+'"><div><span class="pv-comm-source-name">NRR</span><span class="pv-comm-source-note">คิดจาก rule: '+esc(st.ruleName||'-')+'</span></div><div class="pv-comm-source-pay">'+money(src.nrr)+'</div></div>'
      + '<div class="pv-comm-source-row"><div><span class="pv-comm-source-name">Uplift</span><span class="pv-comm-source-note">ยังไม่ได้เปิดใช้ในรอบนี้</span></div><div class="pv-comm-source-pay">'+money(src.uplift)+'</div></div>'
      + '<div class="pv-comm-source-row"><div><span class="pv-comm-source-name">Handover</span><span class="pv-comm-source-note">ยังไม่ได้เปิดใช้ในรอบนี้</span></div><div class="pv-comm-source-pay">'+money(src.handover)+'</div></div>'
      + '</div>'
      + '<div class="pv-comm-tier-table">'+tierRows+'</div>'
      + '<div class="pv-comm-action-note">'+esc(action)+'</div>'
      + '<button class="pv-comm-sheet-close" onclick="_commCloseKamSelfSheet()">ปิด</button>'
      + '</div></div>';
    requestAnimationFrame(function(){ov.classList.add('on');});
  }
  function closeCompactSheet(){
    var ov=document.getElementById('pv-comm-sheet-overlay');
    if(!ov)return;
    ov.classList.remove('on');
    setTimeout(function(){ov.innerHTML='';},260);
  }
  window._commRenderKamSelfStrip=renderCompactStrip;
  window._commOpenKamSelfSheet=openCompactSheet;
  window._commCloseKamSelfSheet=closeCompactSheet;
  try{ _commRenderKamSelfStrip=renderCompactStrip; }catch(e){}
  try{ _commOpenKamSelfSheet=openCompactSheet; }catch(e){}
  try{ _commCloseKamSelfSheet=closeCompactSheet; }catch(e){}
  // v224e render-gate: DOMContentLoaded timers removed — renderCompactStrip called via _commGatedRender
})();


//////////////////////////////////////////////////////////////////////////////

// ── [v211] Commission snapshot hardening + admin guards ─────────────
// PATCH: freshket-v211-commission-snapshot-hardening-js
//////////////////////////////////////////////////////////////////////////////

(function(){
  var VERSION='v211a';
  function toast(msg,type){ try{ if(typeof showToast==='function') showToast(msg,type||'!'); }catch(e){} }
  function role(){ try{ return typeof getCurrentRole==='function' ? getCurrentRole() : String((currentUserProfile&&currentUserProfile.role)||'').toLowerCase(); }catch(e){ return ''; } }
  function isAdmin(){ try{ return typeof isAdminRole==='function' ? isAdminRole(role()) : role()==='admin'; }catch(e){ return false; } }
  function isTL(){ try{ return typeof isTLRole==='function' ? isTLRole(role()) : role()==='tl'; }catch(e){ return false; } }
  function isRep(){ try{ return typeof isRepRole==='function' ? isRepRole(role()) : role()==='rep'; }catch(e){ return role()==='rep' || role()==='kam'; } }
  function period(){ try{ return typeof _nrrExclusionCurrentPeriod==='function' ? _nrrExclusionCurrentPeriod() : (new Date()).toISOString().slice(0,7); }catch(e){ return (new Date()).toISOString().slice(0,7); } }
  function money(n){ try{ return _commFmtPayout(n); }catch(e){ n=Number(n||0); return n?'฿'+Math.round(n).toLocaleString('en-US'):'฿0'; } }
  function esc(v){ try{ return typeof _commEscapeHtml==='function' ? _commEscapeHtml(v) : String(v ?? '').replace(/[&<>'"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];}); }catch(e){ return String(v ?? ''); } }
  function asObj(v){ if(!v) return {}; if(typeof v==='object') return v; try{return JSON.parse(v);}catch(e){return {};} }
  function low(v){ return String(v||'').trim().toLowerCase(); }
  function benRole(v){ var r=low(v); return r==='rep'?'kam':r; }
  function isKamBen(r){ return benRole(r)==='kam'; }
  function isTlBen(r){ return benRole(r)==='tl'; }
  function normalizeSnapshotRow(r, opts){
    opts=opts||{};
    if(!r) return null;
    var per=opts.period || r.period_month || period();
    var br=benRole(r.beneficiary_role);
    var be=low(r.beneficiary_email);
    var tl=low(r.team_lead_email);
    if(!per || !br || !be) return null;
    return Object.assign({}, r, {
      period_month: per,
      beneficiary_role: br,
      beneficiary_email: be,
      team_lead_email: tl || null,
      raw_nrr_pct: r.raw_nrr_pct==null?null:Number(r.raw_nrr_pct),
      governed_nrr_pct: r.governed_nrr_pct==null?null:Number(r.governed_nrr_pct),
      payout_amount: Number(r.payout_amount||0),
      snapshot_status: opts.status || r.snapshot_status || 'live',
      breakdown: asObj(r.breakdown)
    });
  }
  function normalizeRows(rows, opts){ return (rows||[]).map(function(r){return normalizeSnapshotRow(r,opts);}).filter(Boolean); }
  function rowsFinalForPeriod(p){
    var per=p||period();
    var rows=(typeof _commissionSnapshots!=='undefined' && Array.isArray(_commissionSnapshots)) ? _commissionSnapshots : [];
    return normalizeRows(rows,{period:per}).filter(function(r){ return r.period_month===per && String(r.snapshot_status||'').toLowerCase()==='final'; });
  }
  function isLocked(p){ return rowsFinalForPeriod(p).length>0; }
  function liveRows(){
    try{
      var rows=(typeof _commBuildSnapshotRowsLive==='function' ? _commBuildSnapshotRowsLive() : []);
      return normalizeRows(rows,{period:period(),status:'live'});
    }catch(e){ console.warn('[v211a] live rows failed', e); return []; }
  }
  if(typeof window._commBuildSnapshotRowsLive!=='function'){
    try{ window._commBuildSnapshotRowsLive = window._commBuildSnapshotRows || _commBuildSnapshotRows; }catch(e){}
  }
  function rowsForDisplay(opts){
    opts=opts||{};
    var per=opts.period||period();
    var finalRows=rowsFinalForPeriod(per);
    if(opts.forceLive) return liveRows();
    if(opts.preferLocked!==false && finalRows.length) return finalRows;
    return liveRows();
  }
  function scopeRows(rows, scope){
    var email=low((currentUserProfile&&currentUserProfile.email)||'');
    var scoped=rows||[];
    if(scope==='kam' || isRep()) scoped=scoped.filter(function(x){return isKamBen(x.beneficiary_role) && low(x.beneficiary_email)===email;});
    else if(scope==='tl' || isTL()) scoped=scoped.filter(function(x){return low(x.team_lead_email)===email || low(x.beneficiary_email)===email;});
    return scoped;
  }
  function summaryFromRows(rows, scope){
    var normalized=normalizeRows(rows,{period:period()});
    var scoped=scopeRows(normalized, scope);
    var tlRows=scoped.filter(function(r){return isTlBen(r.beneficiary_role);});
    var kamRows=scoped.filter(function(r){return isKamBen(r.beneficiary_role);});
    var sum=function(arr){return arr.reduce(function(s,r){return s+Number(r.payout_amount||0);},0);};
    var lockedSource=scoped.some(function(r){return String(r.snapshot_status||'').toLowerCase()==='final';});
    return { rows:scoped, tlRows:tlRows, kamRows:kamRows, tlPayout:sum(tlRows), kamPayout:sum(kamRows), total:sum(scoped), hitKams:kamRows.filter(function(r){return Number(r.payout_amount||0)>0;}).length, kamCount:kamRows.length, teamCount:Array.from(new Set(scoped.map(function(r){return r.team_lead_email;}).filter(Boolean))).length, sourceLocked:lockedSource };
  }
  window._commIsPeriodLocked=isLocked;
  window._commGetCommissionRowsForDisplay=rowsForDisplay;
  window._commSummaryFromRows=summaryFromRows;
  window._commNormalizeSnapshotRowsForQA=normalizeRows;

  var oldSummary=null;
  try{ oldSummary=window._commBuildPayoutSummary || _commBuildPayoutSummary; }catch(e){}
  window._commBuildPayoutSummary=function(scope, opts){
    try{ return summaryFromRows(rowsForDisplay(opts||{}), scope); }
    catch(e){ console.warn('[v211a] display summary failed, fallback live', e); return oldSummary ? oldSummary(scope) : summaryFromRows(liveRows(), scope); }
  };
  try{ _commBuildPayoutSummary=window._commBuildPayoutSummary; }catch(e){}

  function guardAdmin(action){
    if(isAdmin()) return true;
    toast((action||'Action')+' ทำได้เฉพาะ Admin','!');
    return false;
  }
  function wrapAdmin(fnName, label){
    var old=window[fnName];
    if(typeof old!=='function') return;
    if(old.__commAdminGuarded) return;
    var wrapped=function(){ if(!guardAdmin(label||fnName)) return; return old.apply(this, arguments); };
    wrapped.__commAdminGuarded=true;
    window[fnName]=wrapped;
    try{ eval(fnName+'=window[fnName]'); }catch(e){}
  }
  ['saveCommissionCockpit','saveCommissionRules','saveCommissionAssignments','saveCommissionPoliciesFromCockpit','archiveCommissionRule'].forEach(function(n){ wrapAdmin(n, 'Commission governance'); });
  var oldSetAssignment=window._commSetAssignment;
  if(typeof oldSetAssignment==='function' && !oldSetAssignment.__commAdminGuarded){
    window._commSetAssignment=function(){ if(!guardAdmin('Assign rule')) return; return oldSetAssignment.apply(this,arguments); };
    window._commSetAssignment.__commAdminGuarded=true;
    try{ _commSetAssignment=window._commSetAssignment; }catch(e){}
  }
  var oldPolicyChange=window.onNrrPolicyChange;
  if(typeof oldPolicyChange==='function' && !oldPolicyChange.__commAdminGuarded){
    window.onNrrPolicyChange=function(){ if(!guardAdmin('Policy edit')) return; return oldPolicyChange.apply(this,arguments); };
    window.onNrrPolicyChange.__commAdminGuarded=true;
    try{ onNrrPolicyChange=window.onNrrPolicyChange; }catch(e){}
  }

  function teamGroupsFromRows(rows){
    var by={};
    normalizeRows(rows,{period:period()}).forEach(function(r){
      var bd=asObj(r.breakdown);
      var tl=r.team_lead_email || r.beneficiary_email || 'unknown';
      if(!by[tl]) by[tl]={tlEmail:tl, tlName:bd.team_lead_name||tl, teamNrr:null, tlPayout:0, tlPlanName:'', kamRows:[], total:0};
      if(isTlBen(r.beneficiary_role)){
        by[tl].tlName=bd.team_lead_name||by[tl].tlName;
        by[tl].teamNrr=r.governed_nrr_pct;
        by[tl].tlPayout=Number(r.payout_amount||0);
        by[tl].tlPlanName=bd.rule_name || bd.payout_source || '';
      } else if(isKamBen(r.beneficiary_role)){
        by[tl].kamRows.push({
          kamEmail:r.beneficiary_email,
          kamName:bd.kam_name||r.beneficiary_email,
          pct:r.governed_nrr_pct,
          payout:Number(r.payout_amount||0),
          planName:bd.rule_name||bd.payout_source||'',
          tierLabel:bd.tier_label||''
        });
      }
    });
    Object.values(by).forEach(function(t){ t.kamRows.sort(function(a,b){return (b.payout-a.payout)||String(a.kamName).localeCompare(String(b.kamName));}); t.kamTotal=t.kamRows.reduce(function(s,k){return s+Number(k.payout||0);},0); t.total=t.tlPayout+t.kamTotal; });
    return Object.values(by).sort(function(a,b){return (b.total-a.total)||String(a.tlName).localeCompare(String(b.tlName));});
  }
  function roleLabelForRow(r){ var br=benRole(r); return br==='kam'?'KAM':String(br||'').toUpperCase(); }
  function renderRowsList(rows){
    return normalizeRows(rows,{period:period()}).slice(0,14).map(function(r){
      var bd=asObj(r.breakdown);
      var name=bd.kam_name||bd.team_lead_name||r.beneficiary_email;
      var rule=bd.rule_name||bd.payout_source||'';
      return '<div class="comm-lock-row"><div class="comm-role-dot '+esc(benRole(r.beneficiary_role))+'">'+esc(roleLabelForRow(r.beneficiary_role))+'</div><div><div class="comm-person-name">'+esc(name)+'</div><div class="comm-person-sub">'+esc(rule)+' · Raw '+(r.raw_nrr_pct??'—')+'% → NRR ที่ใช้คิด '+(r.governed_nrr_pct??'—')+'%</div></div><div class="comm-row-money '+(Number(r.payout_amount||0)>0?'hit':'')+' '+(isLocked()?'locked':'')+'">'+money(r.payout_amount)+'</div></div>';
    }).join('');
  }
  window.renderCommLockStep=function(body){
    var per=period();
    var locked=isLocked(per);
    var rows=rowsForDisplay({period:per, preferLocked:true});
    var summary=summaryFromRows(rows);
    var teams=teamGroupsFromRows(rows);
    var pending=(typeof _nrrExclusions!=='undefined'?(_nrrExclusions||[]):[]).filter(function(r){return r.status==='submitted'||r.status==='pending';}).length;
    var ready=rows.length>0 && pending===0;
    var sourceCopy=locked ? 'ล็อกแล้ว: ใช้ frozen snapshot สำหรับ preview / scorecard / CSV' : 'Live preview: ยังไม่ lock snapshot ตัวเลขจะตาม rule และ assignment ล่าสุด';
    body.innerHTML='<div class="comm-hero">'
      +'<div class="comm-hero-top"><div><div class="comm-hero-title">5. Preview & Lock</div><div class="comm-hero-sub">ตรวจภาพรวมก่อน lock snapshot และ export CSV</div></div><div class="comm-total"><div class="comm-total-lbl">Exposure</div><div class="comm-total-val">'+money(summary.total)+'</div></div></div>'
      +'<div class="comm-lock-state-row"><div><div class="comm-lock-state-main">'+esc(sourceCopy)+'</div><div class="comm-lock-state-sub">'+(locked?'การแก้ rule/assignment หลังจากนี้จะไม่เปลี่ยน snapshot ที่ lock ไว้ จนกว่า Admin จะ re-lock':'เมื่อ lock แล้ว snapshot จะ freeze แยกจาก rule/assignment ปัจจุบัน')+'</div></div><span class="comm-lock-pill '+(locked?'locked':'live')+'"><span class="dot"></span>'+(locked?'LOCKED':'LIVE')+'</span></div>'
      +'<div class="comm-kpis"><div class="comm-kpi '+(summary.teamCount?'hit':'miss')+'"><div class="comm-kpi-lbl">Teams</div><div class="comm-kpi-val">'+summary.teamCount+'</div><div class="comm-kpi-sub">TL groups in '+(locked?'snapshot':'preview')+'</div></div><div class="comm-kpi '+(summary.tlPayout>0?'hit payout-hit':'miss')+'"><div class="comm-kpi-lbl">TL payout</div><div class="comm-kpi-val">'+money(summary.tlPayout)+'</div><div class="comm-kpi-sub">'+summary.tlRows.length+' TL rows</div></div><div class="comm-kpi '+(summary.kamPayout>0?'hit payout-hit':'miss')+'"><div class="comm-kpi-lbl">KAM payout</div><div class="comm-kpi-val">'+money(summary.kamPayout)+'</div><div class="comm-kpi-sub">'+summary.hitKams+'/'+summary.kamCount+' KAM hit payout</div></div></div>'
      +'<div class="comm-readiness-bar '+(ready?'ready':'warn')+'"><span class="comm-readiness-dot"></span><div class="comm-readiness-copy">'+(ready?(locked?'Snapshot locked แล้ว · export จะใช้ frozen rows ชุดนี้':'พร้อม lock: ไม่มี pending exception และมี snapshot rows แล้ว'):(pending?'ยังมี exclusion pending '+pending+' รายการ ถ้า lock ตอนนี้จะไม่ถูกนับ':'ยังไม่มีข้อมูล payout ให้ lock'))+'</div></div>'
      +'<div class="tgt-lock-actions"><button class="tgt-lock-btn secondary" onclick="exportCommissionSnapshotCsv()">Export CSV</button><button class="tgt-lock-btn primary" onclick="lockCommissionSnapshot()">'+(locked?'Re-lock / revise snapshot':'Lock snapshot')+'</button></div>'
      +(locked?'<div class="comm-lock-actions-note">ถ้าต้อง revise ให้กด Re-lock หลังตรวจ live data แล้วเท่านั้น</div>':'')
      +'</div>'
      +'<div class="comm-section-title comm-preview-section-title"><span>By Team Lead</span><em>'+(locked?'Locked rows':'Live rows')+' grouped by team</em></div>'
      +(teams.length?teams.map(function(t){return '<div class="comm-card comm-team-card comm-preview-team-card"><div class="comm-preview-tl-band"><div class="comm-preview-tl-left"><div class="comm-team-eyebrow">TEAM LEAD</div><div class="comm-name">'+esc(t.tlName||t.tlEmail)+'</div><div class="comm-meta">'+esc(t.tlEmail||'')+' · Team NRR '+(t.teamNrr!=null?t.teamNrr+'%':'—')+'</div><div class="comm-rule-chip">TL rule · '+esc(t.tlPlanName||'-')+'</div></div><div class="comm-preview-tl-money"><span>Total payout</span><strong>'+money(t.total)+'</strong><em>TL '+money(t.tlPayout)+'</em></div></div><div class="comm-kam-subhead"><span>KAM payout in this team</span><em>'+t.kamRows.filter(function(k){return k.payout>0;}).length+'/'+t.kamRows.length+' hit payout</em></div>'+t.kamRows.slice(0,5).map(function(k){return '<div class="comm-person-row comm-kam-payout-row '+(k.payout>0?'hit':'')+'"><div><div class="comm-person-name">'+esc(k.kamName||k.kamEmail)+'</div><div class="comm-person-sub">NRR '+(k.pct!=null?k.pct+'%':'—')+' · Rule: '+esc(k.planName||'-')+'</div></div><div class="comm-person-payout '+(k.payout>0?'comm-row-money hit':'comm-row-money')+'">'+money(k.payout)+'</div></div>';}).join('')+(t.kamRows.length>5?'<div class="comm-meta comm-more-note">+'+(t.kamRows.length-5)+' more KAM in CSV/export</div>':'')+'</div>';}).join(''):'<div class="comm-empty">ยังไม่มีทีมให้ preview</div>')
      +'<div class="comm-section-title">Snapshot rows</div><div class="comm-lock-list">'+(rows.length?renderRowsList(rows):'<div class="comm-empty">ยังไม่มีข้อมูลสำหรับ snapshot</div>')+'</div>';
  };
  try{ renderCommLockStep=window.renderCommLockStep; }catch(e){}

  window.exportCommissionSnapshotCsv=function(){
    if(!guardAdmin('Export commission snapshot')) return;
    var rows=rowsForDisplay({preferLocked:true});
    if(!rows.length){ toast('ยังไม่มีข้อมูล snapshot ให้ export','!'); return; }
    try{
      var csv=(typeof _commSnapshotCsv==='function') ? _commSnapshotCsv(rows) : JSON.stringify(rows,null,2);
      var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); var url=URL.createObjectURL(blob); var a=document.createElement('a');
      a.href=url; a.download='freshket_commission_'+(isLocked()?'locked':'preview')+'_'+period()+'.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }catch(e){ console.error('[v211a] export failed', e); toast('Export ไม่สำเร็จ: '+(e.message||''),'!'); }
  };
  try{ exportCommissionSnapshotCsv=window.exportCommissionSnapshotCsv; }catch(e){}

  window.lockCommissionSnapshot=async function(){
    if(!guardAdmin('Lock commission snapshot')) return;
    var per=period(); var locked=isLocked(per);
    if(locked && !confirm('เดือนนี้มี locked snapshot อยู่แล้ว ต้องการ re-lock เพื่อ revise ตัวเลขหรือไม่?')) return;
    var rows=liveRows();
    if(!rows.length){ toast('ไม่มีข้อมูลสำหรับ lock','!'); return; }
    var invalid=rows.filter(function(r){ return !r.period_month || !r.beneficiary_role || !r.beneficiary_email; });
    if(invalid.length){ toast('Lock ไม่สำเร็จ: snapshot rows ไม่ครบ '+invalid.length+' แถว','!'); console.warn('[v211a] invalid snapshot rows', invalid); return; }
    var pending=(typeof _nrrExclusions!=='undefined'?(_nrrExclusions||[]):[]).filter(function(r){return r.status==='submitted'||r.status==='pending';}).length;
    if(pending>0 && !confirm('ยังมี exclusion pending '+pending+' รายการ ต้องการ lock ต่อเลยหรือไม่?')) return;
    var actor=(currentUserProfile&&currentUserProfile.email)||'';
    try{
      var lockedAt=new Date().toISOString();
      var payload=rows.map(function(r){
        var bd=Object.assign({}, asObj(r.breakdown), { locked_source:'v211a_live_rows', locked_rule_name:asObj(r.breakdown).rule_name||'' });
        return Object.assign({}, r, { period_month:per, beneficiary_role:benRole(r.beneficiary_role), beneficiary_email:low(r.beneficiary_email), team_lead_email:low(r.team_lead_email)||null, payout_amount:Number(r.payout_amount||0), snapshot_status:'final', breakdown:bd, updated_at:lockedAt, updated_by:actor, created_by:r.created_by||actor, locked_at:lockedAt, locked_by:actor });
      });
      var res=await supa.from('commission_payout_snapshots').upsert(payload,{onConflict:'period_month,beneficiary_role,beneficiary_email'}).select('*');
      if(res.error) throw new Error(res.error.message);
      _commissionSnapshots=res.data||payload;
      if(typeof _tgtActiveQuarter!=='undefined' && _tgtActiveQuarter && typeof _tgtQuarterCache!=='undefined') delete _tgtQuarterCache[_tgtActiveQuarter];
      toast(locked?'Re-lock snapshot สำเร็จ':'Lock commission snapshot สำเร็จ','ok');
      try{ renderCommissionCockpit(); }catch(e){ try{ renderCommLockStep(document.getElementById('commission-cockpit-body')); }catch(_e){} }
      try{ renderTeamviewSummary(); renderTeamviewKamList(); }catch(e){}
      try{ if(typeof _commRenderKamSelfStrip==='function') _commRenderKamSelfStrip(); }catch(e){}
    }catch(e){ console.error('[v211a] lock failed', e); toast('Lock ไม่สำเร็จ: '+(e.message||''),'!'); }
  };
  try{ lockCommissionSnapshot=window.lockCommissionSnapshot; }catch(e){}

  var oldKamState=null;
  try{ oldKamState=window._commBuildKamSelfState || _commBuildKamSelfState; }catch(e){}
  if(typeof oldKamState==='function'){
    window._commBuildKamSelfState=function(){
      var st=oldKamState.apply(this,arguments); if(!st) return st;
      var email=low((currentUserProfile&&currentUserProfile.email)||'');
      var finalRow=rowsFinalForPeriod(st.period||period()).find(function(r){return isKamBen(r.beneficiary_role) && low(r.beneficiary_email)===email;});
      if(finalRow){
        var bd=asObj(finalRow.breakdown);
        st.locked=true; st.pct=finalRow.governed_nrr_pct; st.payout=Number(finalRow.payout_amount||0); st.ruleName=bd.rule_name||st.ruleName; st.status=st.payout>0?(st.status||'ถึงเกณฑ์แล้ว'):'ยังไม่ถึงเกณฑ์'; st.cls=st.payout>0?'bonus':'miss'; st.sourceBreakdown={nrr:st.payout,uplift:0,handover:0};
      }
      return st;
    };
    try{ _commBuildKamSelfState=window._commBuildKamSelfState; }catch(e){}
  }
  // Add a locked class to compact KAM strip after each render without touching v210k internals.
  var oldRenderStrip=window._commRenderKamSelfStrip;
  if(typeof oldRenderStrip==='function'){
    window._commRenderKamSelfStrip=function(){ var r=oldRenderStrip.apply(this,arguments); try{ var el=document.querySelector('.pv-comm-strip.v210k'); if(el && isLocked()) el.classList.add('locked'); }catch(e){} return r; };
    try{ _commRenderKamSelfStrip=window._commRenderKamSelfStrip; }catch(e){}
  }
  console.log('[Freshket Sense '+VERSION+'] Commission snapshot + permission hardening QA cleanup loaded');
})();


//////////////////////////////////////////////////////////////////////////////

console.log('[Target Module v1] loaded');
