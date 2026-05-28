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
        <button class="comm-secondary" onclick="openCommissionRulebook()" style="color:rgba(225,238,255,.55)">กฎค่าคอมฯ</button>
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

// v226: Component Rates editor — admin-configurable params for Upsell SKU / Outlet / Handover / Gate / TL Mult
// Reads/writes to commission_rules params jsonb via _commGetConfig
// UI uses the same _commRuleConfig cache; on save calls saveCommissionComponentRates()
function _renderComponentRatesEditor() {
  const cfg = (k, p, def) => {
    try {
      const v = _commGetConfig(k, p, def);
      return v !== null && v !== undefined ? v : def;
    } catch(e) { return def; }
  };
  // unit types: 'pct-d' = decimal rate (0.03→display 3, save ÷100)
  //             'pct-i' = integer percent (95→display 95, save as-is)
  //             'mul'   = multiplier/cap (0.70→display 0.70, save as-is)
  //             '฿'     = baht amount (2500→display 2500, save as-is)
  const fld = (label, metricCode, param, defaultVal, step, unit) => {
    const v = cfg(metricCode, param, defaultVal);
    const isDecimalPct = unit === 'pct-d';
    const display = isDecimalPct ? (Math.round(v * 10000) / 100) : v;
    const unitLabel = isDecimalPct ? '%' : unit === 'pct-i' ? '%' : unit === 'mul' ? '×' : (unit || '฿');
    const saveExpr = isDecimalPct ? 'this.value/100' : 'Number(this.value)';
    return `<div class="comm-field">
      <label>${_commEscapeHtml(label)}</label>
      <div style="display:flex;align-items:center;gap:6px">
        <input class="comm-input" style="width:90px" type="number" step="${step||'any'}" value="${display}"
          oninput="_commSetComponentParam('${metricCode}','${param}',${saveExpr})">
        <span style="font-size:11px;color:rgba(255,255,255,.5)">${unitLabel}</span>
      </div>
    </div>`;
  };
  return `
    <div class="comm-component-section">
      <div class="comm-component-title">Upsell SKU</div>
      <div class="comm-grid2" style="gap:8px">
        ${fld('P1 rate (item ใหม่ บัญชีนี้)','upsell_sku','p1_rate',0.03,0.005,'pct-d')}
        ${fld('P3 rate (growth existing item)','upsell_sku','p3_rate',0.03,0.005,'pct-d')}
        ${fld('P3 growth threshold ×','upsell_sku','p3_threshold_pct',2.00,0.05,'mul')}
        ${fld('P1 & P3 min GMV (gate)','upsell_sku','p1_min_gmv',2500,100,'฿')}
        ${fld('P3 min incremental (gate)','upsell_sku','p3_min_incremental',5000,100,'฿')}
      </div>
      <div class="comm-formula-note">
        <b>P1</b>: item ใหม่ที่บัญชีนี้ไม่เคยซื้อ (เดือนก่อน) · GMV ≥ ฿${cfg('upsell_sku','p1_min_gmv',2500).toLocaleString('en-US')} · ได้ ${Math.round(cfg('upsell_sku','p1_rate',0.03)*100)}% ทุก outlet<br>
        <b>P3</b>: item เดิม existing outlet · ยอดปัจจุบัน > baseline × ${cfg('upsell_sku','p3_threshold_pct',2.00).toFixed(2)} AND incremental ≥ ฿${cfg('upsell_sku','p3_min_incremental',5000).toLocaleString('en-US')} · ได้ ${Math.round(cfg('upsell_sku','p3_rate',0.03)*100)}% × incremental
      </div>
    </div>
    <div class="comm-component-section" style="margin-top:14px">
      <div class="comm-component-title">Upsell Outlet</div>
      <div class="comm-grid2" style="gap:8px">
        ${fld('Rate (outlet ใหม่/comeback)','upsell_outlet','rate',0.015,0.005,'pct-d')}
      </div>
      <div class="comm-formula-note">
        GMV จาก outlet ใหม่/comeback × ${Math.round(cfg('upsell_outlet','rate',0.015)*1000)/10}% · ไม่นับ item ที่ได้ P1 ไปแล้ว
      </div>
    </div>
    <div class="comm-component-section" style="margin-top:14px">
      <div class="comm-component-title">Handover Retention</div>
      <div class="comm-grid2" style="gap:8px">
        ${fld('Tier 2 retention threshold','handover','tier2_pct',100,5,'pct-i')}
        ${fld('Tier 3 retention threshold','handover','tier3_pct',120,5,'pct-i')}
        ${fld('Tier 2 payout','handover','tier2_payout',2500,500,'฿')}
        ${fld('Tier 3 bonus (เพิ่มเติมจาก T2)','handover','tier3_bonus',2500,500,'฿')}
      </div>
      <div class="comm-formula-note">
        retention = ยอด MTD / ยอดเดือนสุดท้ายก่อนโอน · Tier 1 &lt;${cfg('handover','tier2_pct',100)}% = ฿0 · Tier 2 ≥${cfg('handover','tier2_pct',100)}% = ฿${Number(cfg('handover','tier2_payout',2500)).toLocaleString('en-US')} · Tier 3 ≥${cfg('handover','tier3_pct',120)}% = ฿${Number(cfg('handover','tier2_payout',2500)+cfg('handover','tier3_bonus',2500)).toLocaleString('en-US')} รวม
      </div>
    </div>
    <div class="comm-component-section" style="margin-top:14px">
      <div class="comm-component-title">GMV Gate (KAM only)</div>
      <div class="comm-grid2" style="gap:8px">
        ${fld('Threshold 1 — ไม่มี cap เมื่อ ≥ (%)','gmv_gate','threshold_1',95,1,'pct-i')}
        ${fld('Cap 1 — เมื่อต่ำกว่า T1 (×)','gmv_gate','cap_1',0.70,0.05,'mul')}
        ${fld('Threshold 2 (%)','gmv_gate','threshold_2',90,1,'pct-i')}
        ${fld('Cap 2 — เมื่อต่ำกว่า T2 (×)','gmv_gate','cap_2',0.35,0.05,'mul')}
      </div>
      <div class="comm-formula-note">
        ≥${cfg('gmv_gate','threshold_1',95)}% → ×1.0 (ไม่มี cap) · ${cfg('gmv_gate','threshold_2',90)}–${cfg('gmv_gate','threshold_1',95)}% → ×${cfg('gmv_gate','cap_1',0.70)} · &lt;${cfg('gmv_gate','threshold_2',90)}% → ×${cfg('gmv_gate','cap_2',0.35)}<br>
        ใช้กับ (NRR + Upsell SKU + Upsell Outlet + Handover) รวมก่อน × gate
      </div>
    </div>
    <div class="comm-component-section" style="margin-top:14px">
      <div class="comm-component-title">TL Upsell Multiplier Tiers</div>
      <div class="comm-tier-helper"><span>Upsell %</span><strong>= Σ(P1+P3 incr) ÷ Team NRR baseline</strong></div>
      <div class="comm-table-lite comm-tier-table" style="margin-top:8px">
        <div class="comm-tier-row head"><div>Min upsell %</div><div>Max upsell %</div><div>Multiplier ×</div><div></div></div>
        ${_renderTlUpsellTierRows()}
      </div>
      <button class="comm-add" onclick="_commAddTlUpsellTier()">+ เพิ่ม tier</button>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button class="comm-save" onclick="saveCommissionComponentRates()">Save rates</button>
      <div class="comm-plan-note" style="margin:0;align-self:center">ค่าเหล่านี้ใช้ทันทีหลัง save และกระทบ commission ของทุกคน</div>
    </div>`;
}

function _renderTlUpsellTierRows() {
  // Read tiers from _commRuleConfig.rules.tl_upsell_mult[0].tiers or use defaults
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
  return tiers.map((t,i) => `<div class="comm-tier-row">
    <input class="comm-input comm-tier-min" value="${t.min_pct ?? ''}" placeholder="-" inputmode="decimal"
      oninput="_commSetTlUpsellTier(${i},'min_pct',this.value)">
    <input class="comm-input comm-tier-max" value="${t.max_pct ?? ''}" placeholder="∞" inputmode="decimal"
      oninput="_commSetTlUpsellTier(${i},'max_pct',this.value)">
    <input class="comm-input comm-tier-payout" value="${t.multiplier ?? 1.0}" placeholder="1.0" inputmode="decimal"
      oninput="_commSetTlUpsellTier(${i},'multiplier',this.value)">
    <button class="comm-del" onclick="_commRemoveTlUpsellTier(${i})">×</button>
  </div>`).join('');
}

// In-memory staging for component params (flushed on saveCommissionComponentRates)
let _commComponentPending = {};
function _commSetComponentParam(metricCode, param, value) {
  if (!_commComponentPending[metricCode]) _commComponentPending[metricCode] = {};
  _commComponentPending[metricCode][param] = Number(value);
  _commMarkChanged();
}
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

async function saveCommissionComponentRates() {
  if (!Object.keys(_commComponentPending).length) {
    showToast('ไม่มีการเปลี่ยนแปลง', '!'); return;
  }
  const actor = (currentUserProfile && currentUserProfile.email) || '';
  const toUpsert = [];
  for (const [metricCode, params] of Object.entries(_commComponentPending)) {
    // Merge with existing params
    const existing = {};
    try {
      const rules = _commRuleConfig.rules && _commRuleConfig.rules[metricCode];
      if (rules && rules[0] && rules[0].params) Object.assign(existing, rules[0].params);
    } catch(e) {}
    const merged = { ...existing, ...params };
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
    _commSoftenPostSaveUi();
    showToast('Component rates saved', '✓');
    renderCommissionCockpit();
  } catch(e) {
    showToast('Save failed: ' + (e.message || e), '✗');
  }
}
window.saveCommissionComponentRates = saveCommissionComponentRates;
window._commSetComponentParam = _commSetComponentParam;
window._commAddTlUpsellTier = _commAddTlUpsellTier;
window._commRemoveTlUpsellTier = _commRemoveTlUpsellTier;
window._commSetTlUpsellTier = _commSetTlUpsellTier;

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
    <div class="comm-section-title">Component Rates (Upsell & Gate)</div>
    <div class="comm-card comm-component-rates-card">${_renderComponentRatesEditor()}</div>
    <div class="comm-rule-actions">
      <button class="comm-create-rule-btn" onclick="_commCreateRule('tl')">+ Create TL Rule</button>
      <button class="comm-create-rule-btn" onclick="_commCreateRule('kam')">+ Create KAM Rule</button>
    </div>
    <div class="comm-rule-group-title">TL Rules (NRR Tiers)</div>
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
      ${t.kamRows.slice(0,5).map(k=>{
        // v226: show component breakdown if available in breakdown jsonb
        const bd = k.breakdown || {};
        const nrrP = bd.nrr_payout !== undefined ? _commFmtPayout(bd.nrr_payout) : null;
        const upsellP = (bd.upsell_sku && bd.upsell_sku.total_commission !== undefined) ? _commFmtPayout(bd.upsell_sku.total_commission + ((bd.upsell_outlet && bd.upsell_outlet.commission)||0)) : null;
        const handoverP = bd.handover ? _commFmtPayout(bd.handover.payout||0) : null;
        const gateTxt = bd.gmv_gate && bd.gmv_gate.gate_active ? `⚠ gate×${bd.gmv_gate.cap}` : null;
        const breakdown = nrrP ? `<span style="color:rgba(255,255,255,.5);font-size:10px"> NRR ${nrrP}${upsellP?' · Upsell '+upsellP:''}${handoverP?' · HO '+handoverP:''}${gateTxt?' · '+gateTxt:''}</span>` : '';
        return `<div class="comm-person-row comm-kam-payout-row ${k.payout>0?'hit':''}">
          <div>
            <div class="comm-person-name">${_commEscapeHtml(k.kamName||k.kamEmail)}</div>
            <div class="comm-person-sub">NRR ${k.pct!==null?k.pct+'%':'—'} · ${_commEscapeHtml(k.tierLabel||'—')}${breakdown}</div>
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
      let sub = `NRR ${r.governed_nrr_pct??'—'}%`;
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
    }).join('')}</div>`;
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
      <span style="font-family:monospace;color:rgba(255,255,255,.42)">${model.kamRows.length} KAM</span>
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
    // v241-fix: rawRetention = actual MTD ÷ baseline (no day-normalization)
    // used for handover/new-sales display to be consistent with _commComputeHandoverRetention
    const rawRetention=baselinePrevGmv>0?baseCurrGmv/baselinePrevGmv:null;
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
      nrr, rawRetention, cohortCount:cohort.length, cohortGmv:baseCurrGmv, baselinePrevGmv,
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
      nrr:   newFromSalesResult?.rawRetention ?? null,
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
  // v225-comm: buildSources uses real payout via _commBuildKamPayout
  // v226-comm: NRR always from governance st.payout; upsell/handover added on top when bundle loaded
  function buildSources(st){
    var nrr=Number(st&&st.payout||0);
    var base={loading:false,nrr:nrr,uplift:0,handover:0,gate_cap:1.0,gate_active:false,final:nrr};
    if(typeof bulkUpsellData==='undefined'||!bulkUpsellData||!bulkUpsellData.loaded){
      return Object.assign({},base,{loading:true});
    }
    try{
      var email=st&&st.email;
      var p=email&&typeof _commBuildKamPayout==='function'?_commBuildKamPayout(email):null;
      if(!p) return base;
      var uplift=Number((p.upsell_sku&&p.upsell_sku.total_comm)||0)+Number((p.upsell_outlet&&p.upsell_outlet.commission)||0);
      var hv=Number((p.handover&&p.handover.payout)||0);
      var cap=Number(p.gate_cap||1.0);
      // final = governance NRR (st.payout) + upsell + handover, then gate applied
      // Do NOT use p.nrr_payout which may be 0 if plan lookup fails
      return {loading:false,nrr:nrr,uplift:uplift,handover:hv,
        // Keep separate fields for sheet detail rows
        upsell_sku:Number((p.upsell_sku&&p.upsell_sku.total_comm)||0),
        upsell_outlet:Number((p.upsell_outlet&&p.upsell_outlet.commission)||0),
        gate_cap:cap,gate_active:!!(p.gate&&p.gate.gate_active),gate:p.gate,
        upsell_sku_detail:p.upsell_sku,upsell_outlet_detail:p.upsell_outlet,handover_detail:p.handover,
        final:Math.round((nrr+uplift+hv)*cap)};
    }catch(e){ return base; }
  }
  function buildCompactStrip(){
    if(typeof _commBuildKamSelfState!=='function') return '';
    var st=_commBuildKamSelfState();
    if(!st) return '';
    var src=buildSources(st);
    if(!src) return '';
    // Self-healing: if upsell not loaded yet, trigger fetch now
    if(src.loading && st.email && typeof _fetchUpsellBundle==='function'){
      _fetchUpsellBundle(st.email).catch(function(){});
    }
    var finalAmt=src.loading?null:src.final;
    var paid=!src.loading&&finalAmt>0;
    var cls='v210k '+(paid?'paid':'unpaid')+' '+esc(st.cls||'');
    var status=src.loading?'กำลังโหลด...':(st.status||(paid?'\u0e16\u0e36\u0e07\u0e40\u0e01\u0e13\u0e11\u0e41\u0e25\u0e49\u0e27':'\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e16\u0e36\u0e07\u0e40\u0e01\u0e13\u0e11'));
    var gateNote=(!src.loading&&src.gate_active)?(' <span class="pv-comm-gate-warn">\u26a0 gate '+Math.round(src.gate_cap*100)+'%</span>'):'';
    var mainHtml=src.loading
      ?'<div class="skel" style="width:90px;height:28px;border-radius:6px;display:inline-block"></div>'
      :money(finalAmt);
    return '<div class="pv-comm-strip '+cls+'" data-v210k="1">'
      +'<div class="pv-comm-title">\u0e04\u0e48\u0e32\u0e04\u0e2d\u0e21\u0e2f \u0e40\u0e14\u0e37\u0e2d\u0e19\u0e19\u0e35\u0e49'+gateNote+'</div>'
      +'<div class="pv-comm-main">'+mainHtml+'</div>'
      +'<div class="pv-comm-chip" title="'+esc(status)+'">'+esc(status)+'</div>'
      +'<button class="pv-comm-i" onclick="event.stopPropagation();_commOpenKamSelfSheet();">i</button>'
      +'<div class="pv-comm-sources">'
      +'<span style="color:'+(src.nrr>0?'#ffe08a':'rgba(255,255,255,.35)')+'"><b>NRR</b> '+money(src.nrr)+'</span><span class="pv-comm-sep">\u00b7</span>'
      +'<span style="color:'+(!src.loading&&(src.uplift||0)>0?'#ffe08a':'rgba(255,255,255,.35)')+'"><b>Uplift</b> '+(src.loading?'\u2014':money(src.uplift||0))+'</span><span class="pv-comm-sep">\u00b7</span>'
      +'<span style="color:'+(!src.loading&&(src.handover||0)>0?'#ffe08a':'rgba(255,255,255,.35)')+'"><b>Handover</b> '+(src.loading?'\u2014':money(src.handover||0))+'</span>'
      +'</div>'
      +'</div>';
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
    if(typeof _commBuildKamSelfState!=="function") return;
    var st=_commBuildKamSelfState();
    if(!st) return;
    var ov=document.getElementById("pv-comm-sheet-overlay");
    if(!ov){
      ov=document.createElement("div");
      ov.id="pv-comm-sheet-overlay";
      ov.className="pv-comm-sheet-overlay";
      ov.onclick=function(e){ if(e.target===ov) closeCompactSheet(); };
      document.body.appendChild(ov);
    }
    var pctText=st.pct!==null&&st.pct!==undefined?(st.pct+"%"):"—";
    var src=buildSources(st);
    if(!src) src={loading:false,nrr:Number(st&&st.payout||0),upsell_sku:0,upsell_outlet:0,handover:0,gate_cap:1.0,gate_active:false,final:Number(st&&st.payout||0)};
    var finalAmt=src.loading?src.nrr:src.final;

    // Config-tied rule values
    function cfg(k,p,d){try{return typeof _commGetConfig==="function"?_commGetConfig(k,p,d):d;}catch(e){return d;}}
    var p1Rate=Math.round(cfg("upsell_sku","p1_rate",0.03)*100);
    var p3Rate=Math.round(cfg("upsell_sku","p3_rate",0.03)*100);
    var p3Thresh=cfg("upsell_sku","p3_threshold_pct",2.00);
    var p3ThreshPct=Math.round((p3Thresh-1)*100);
    var p3MinIncr=Number(cfg("upsell_sku","p3_min_incremental",5000)).toLocaleString("en-US");
    var p1MinGmv=Number(cfg("upsell_sku","p1_min_gmv",2500)).toLocaleString("en-US");
    var outRate=Math.round(cfg("upsell_outlet","rate",0.015)*1000)/10;
    var hoT2=cfg("handover","tier2_pct",100);
    var hoT3=cfg("handover","tier3_pct",120);
    var hoT2Pay=Number(cfg("handover","tier2_payout",2500)).toLocaleString("en-US");
    var hoT3Bon=Number(cfg("handover","tier3_bonus",2500)).toLocaleString("en-US");
    var gT1=cfg("gmv_gate","threshold_1",95);
    var gT2=cfg("gmv_gate","threshold_2",90);
    var gC1=Math.round(cfg("gmv_gate","cap_1",0.70)*100);
    var gC2=Math.round(cfg("gmv_gate","cap_2",0.35)*100);

    // NRR tiers
    var tierRows=(st.tiers||[]).map(function(t,idx){
      var on=st.tier&&idx===st.currentIdx;
      var isNext=st.next&&String(t.id||idx)===String(st.next.id||(st.tiers||[]).indexOf(st.next));
      var lbl=(typeof _commTierRangeLabel==="function"?_commTierRangeLabel(t):"")+"·"+(t.payout_label||"");
      return ["<div class=\"pv-comm-tier-row ",(on?"on":isNext?"next":""),"\">",              "<div class=\"pv-comm-tier-range\">",esc(lbl),"</div>",              "<div class=\"pv-comm-tier-pay\">",money(t.payout_value),"</div></div>"].join("");
    }).join("");

    // Action note
    var action="รอข้อมูล NRR";
    if(st.pct!==null&&st.pct!==undefined){
      if(st.next) action="NRR ต้องเพิ่มอีก +"+pts(Math.max(0,Number(st.next.min_value)-Number(st.pct)))+" pts ถึง tier ถัดไป";
      else if(finalAmt>0) action="รักษา NRR ให้อยู่ใน tier นี้จนจบเดือน";
      else action="ยังไม่ถึง tier แรก";
    }

    // Helper: build a source row
    function srcRow(cls,name,note,pay,detail){
      return ["<div class=\"pv-comm-source-row ",cls,"\"><div>",
              "<span class=\"pv-comm-source-name\">",esc(name),"</span>",
              "<span class=\"pv-comm-source-note\">",note,"</span>",
              "</div><div class=\"pv-comm-source-pay\">",pay,"</div></div>",
              detail||""].join("");
    }
    function ruleBox(lines){
      return "<div class=\"pv-comm-rule-box\">"+lines.join("")+"</div>";
    }
    function ruleLine(hit,label,pay){
      return "<div class=\"pv-comm-rule-line "+(hit?"hit":"miss")+"\"><span>"+esc(label)+"</span><span>"+pay+"</span></div>";
    }
    function ruleIndent(txt){
      return "<div class=\"pv-comm-rule-indent\">"+txt+"</div>";
    }

    // NRR row
    var firstPayTier=st.tiers&&st.tiers.find(function(t){return Number(t.payout_value||0)>0;});
    var nrrMinPct=firstPayTier&&firstPayTier.min_value!==null?firstPayTier.min_value:"—";
    var nrrRow=srcRow(src.nrr>0?"paid":"","NRR","เกณฑ์ ≥"+nrrMinPct+"% · "+esc(st.ruleName||"—"),money(src.nrr),"");

    // Upsell SKU row — v235: renamed P1→กลุ่มสินค้าใหม่, P3→ยอดเติบโต; added outlet drill
    // v239-fix: declare p1g/p3g OUTSIDE if block so upsellHasDrill can see them
    var p1Detail=[],p3Detail=[],p1g=[],p3g=[];
    if(src.upsell_sku_detail){
      var d=src.upsell_sku_detail;
      p1g=d.p1&&d.p1.groups?d.p1.groups:[];
      p3g=d.p3&&d.p3.groups?d.p3.groups:[];
      window._pvCommP1Groups=p1g; window._pvCommP3Groups=p3g; // store for drill
      p1Detail=[ruleLine(p1g.length>0,"กลุ่มสินค้าใหม่ (GMV ≥฿"+p1MinGmv+") × "+p1Rate+"%",money(d.p1?d.p1.comm:0))];
      if(p1g.length) p1Detail.push(ruleIndent("<span onclick=\"_commOpenUpsellDrill('p1')\" style=\"color:#bcd7ff;cursor:pointer;font-weight:700;text-decoration:underline;text-underline-offset:2px\">"+p1g.length+" รายการ — ดูทั้งหมด ›</span>"));
      p3Detail=[ruleLine(p3g.length>0,"ยอดเติบโต >"+p3ThreshPct+"% & incr ≥฿"+p3MinIncr+" × "+p3Rate+"%",money(d.p3?d.p3.comm:0))];
      if(p3g.length) p3Detail.push(ruleIndent("<span onclick=\"_commOpenUpsellDrill('p3')\" style=\"color:#bcd7ff;cursor:pointer;font-weight:700;text-decoration:underline;text-underline-offset:2px\">"+p3g.length+" รายการ — ดูทั้งหมด ›</span>"));
    }
    var upsellSkuDetail=p1Detail.length||p3Detail.length?ruleBox(p1Detail.concat(p3Detail)):"";
    var upsellSkuRow=srcRow(src.upsell_sku>0?"paid":"","กลุ่มสินค้าใหม่ + ยอดเติบโต","กลุ่มสินค้าใหม่ "+p1Rate+"% · ยอดเติบโต >"+p3ThreshPct+"% → "+p3Rate+"%",money(src.upsell_sku),upsellSkuDetail);

    // Upsell Outlet row
    var outDetail="";
    if(src.upsell_outlet_detail){
      var od=src.upsell_outlet_detail;
      outDetail=ruleBox([ruleLine(od.outlet_gmv>0,"ใหม่ "+money(od.new_gmv)+" · comeback "+money(od.comeback_gmv)," × "+outRate+"%"),
                          ruleIndent("ไม่นับ item ที่ได้ P1 ไปแล้ว")]);
    }
    var upsellOutRow=srcRow(src.upsell_outlet>0?"paid":"","Expansion","สาขาใหม่/comeback × "+outRate+"%",money(src.upsell_outlet),outDetail);

    // Handover row — 2-line tier breakdown
    var hoDetail="";
    if(src.handover_detail){
      var hd=src.handover_detail;
      var hoHit2=hd.retention_pct>=hoT2;
      var hoHit3=hd.retention_pct>=hoT3;
      hoDetail=ruleBox([
        ruleIndent("retention "+hd.retention_pct+"% ("+hd.accounts+" ร้าน) — "+money(hd.current_gmv)+" / "+money(hd.baseline_gmv)),
        ruleLine(hoHit2,"≥"+hoT2+"% → ฿"+hoT2Pay,hoHit2?money(hd.payout>0?Math.min(hd.payout,Number(String(hoT2Pay).replace(/,/g,""))||2500):0):""),
        ruleLine(hoHit3,"≥"+hoT3+"% → +฿"+hoT3Bon+" (bonus)",hoHit3?money(Number(String(hoT3Bon).replace(/,/g,""))||2500):"")
      ]);
    }
    var handoverRow=srcRow(src.handover>0?"paid":"","Handover","≥"+hoT2+"% = ฿"+hoT2Pay+" · ≥"+hoT3+"% = +฿"+hoT3Bon,money(src.handover),hoDetail);

    // NRR Gate row (renamed from GMV Gate — gate uses NRR%, not run-rate)
    var gateRow="";
    if(src.gate&&src.gate.ach_pct!==null&&src.gate.ach_pct!==undefined){
      var gPct=src.gate.ach_pct;
      var gCapPct=Math.round(src.gate_cap*100);
    }else{ var gPct=st.pct||null; var gCapPct=100; }

    var loadNote=src.loading?'<div style="font-size:11px;color:#ffe08a;padding:6px 18px">⚠ กำลังโหลด upsell — ตัวเลขจะอับเดตอัตโนมัติ</div>':'';
    var kpiCls=finalAmt>0?'val-bonus':'';
    var nowStr=(function(){var d=new Date();return d.getDate()+'/'+(d.getMonth()+1)+' '+d.getHours()+':'+(d.getMinutes()<10?'0':'')+d.getMinutes();})();

    // Store drill data for drill functions
    window._pvCommDrillSt=st; window._pvCommDrillSrc=src;
    window._pvCommDrillCfg={p1Rate:p1Rate,p3Rate:p3Rate,p3ThreshPct:p3ThreshPct,outRate:outRate,hoT2:hoT2,hoT3:hoT3,hoT2Pay:hoT2Pay,hoT3Bon:hoT3Bon,tierRows:tierRows,action:action};

    // Clean component row builder
    function cRow(dot,label,sub,amt,amtColor,drillFn){
      var hasAmt=Number(amt||0)>0;
      return '<div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid rgba(188,215,255,.09);'+(drillFn?'cursor:pointer':'')+'"'
        +(drillFn?' onclick="'+drillFn+'" onmouseenter="this.style.background=\'rgba(188,215,255,.04)\'" onmouseleave="this.style.background=\'\'"':'')+'>'
        +'<div style="width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:2px;background:'+dot+'"></div>'
        +'<div style="flex:1;min-width:0">'
        +'<div style="font-size:14px;font-weight:700;color:rgba(225,238,255,.88);line-height:1.25">'+label+'</div>'
        +'<div style="font-size:11px;color:rgba(225,238,255,.40);margin-top:2px">'+sub+'</div>'
        +'</div>'
        +'<div style="display:flex;align-items:center;gap:7px;flex-shrink:0">'
        +'<span style="font-size:14px;font-weight:900;font-family:\'IBM Plex Mono\',monospace;letter-spacing:-.02em;color:'+(hasAmt?amtColor:'rgba(225,238,255,.25)')+'">'+money(amt||0)+'</span>'
        +(drillFn?'<span style="font-size:16px;color:rgba(188,215,255,.28)">›</span>':'')
        +'</div></div>';
    }

    // Row definitions
    var nrrSub='NRR '+pctText+' · '+esc(st.tierLabel||st.ruleName||'—');
    if(st.next)nrrSub+=' · ต้องอีก +'+(Number(st.next.min_value)-Number(st.pct||0)).toFixed(1)+'pts';
    var nrrRowHtml=cRow('#4ddc97','NRR Commission',nrrSub,src.nrr,'#4ddc97','_commDrillNRR()');

    var upsellSub=(p1g&&p1g.length?'กลุ่มสินค้าใหม่ '+p1g.length+' รายการ':'')+(p1g&&p1g.length&&p3g&&p3g.length?' · ':'')+(p3g&&p3g.length?'ยอดเติบโต '+p3g.length+' รายการ':'');
    if(!upsellSub)upsellSub='กลุ่มสินค้าใหม่ '+p1Rate+'% · ยอดเติบโต >'+p3ThreshPct+'% → '+p3Rate+'%';
    var upsellHasDrill=!!(p1g&&p1g.length||p3g&&p3g.length);
    var upsellRowHtml=cRow('rgba(255,224,138,.9)','กลุ่มสินค้าใหม่ + ยอดเติบโต',upsellSub,src.upsell_sku,'#ffe08a',upsellHasDrill?'_commDrillUpsellChooser()':null);

    var ncSub='สาขาใหม่ × '+outRate+'%'+(src.upsell_outlet_detail&&src.upsell_outlet_detail.outlet_gmv>0?' · GMV '+money(src.upsell_outlet_detail.outlet_gmv):'');
    var ncRowHtml=cRow('rgba(255,224,138,.8)','Expansion',ncSub,src.upsell_outlet,'#ffe08a','_commDrillExpansion()');

    // v239-fix: hoSub แสดง baseline + current + retention เพื่อ reconcile ได้
    var hoSub=(function(){
      if(!src.handover_detail||!src.handover_detail.accounts)return'≥'+hoT2+'% = ฿'+hoT2Pay+' · ≥'+hoT3+'% = +฿'+hoT3Bon;
      var hd=src.handover_detail;
      var baseMon=hd.baseline_gmv>=1000?'฿'+(hd.baseline_gmv/1000).toFixed(0)+'K':'฿'+Math.round(hd.baseline_gmv);
      var currMon=hd.current_gmv>=1000?'฿'+(hd.current_gmv/1000).toFixed(0)+'K':'฿'+Math.round(hd.current_gmv);
      return hd.accounts+' ร้าน · '+baseMon+' → '+currMon+' ('+hd.retention_pct+'%)';
    })();
    var hoRowHtml=cRow('#bcd7ff','Handover',hoSub,src.handover,'#bcd7ff','_commDrillHandover()');

    var subtotalAmt=(src.nrr||0)+(src.upsell_sku||0)+(src.upsell_outlet||0)+(src.handover||0);
    var gateOk2=!src.gate_active;
    var gateCardHtml='<div style="margin:0 18px 12px;background:'+(gateOk2?'rgba(77,220,151,.08)':'rgba(240,80,0,.08)')+';border:1px solid '+(gateOk2?'rgba(77,220,151,.2)':'rgba(240,80,0,.2)')+';border-radius:10px;padding:10px 13px;display:flex;align-items:center;justify-content:space-between">'
      +'<div><div style="font-size:12px;color:rgba(225,238,255,.78)">NRR Gate</div>'
      +'<div style="font-size:10px;color:rgba(225,238,255,.35);margin-top:2px">NRR '+(gPct||'—')+'% '+(gateOk2?'≥'+gT1+'% — ผ่าน':'— ถูก cap')+'</div></div>'
      +'<span style="font-size:13px;font-weight:900;color:'+(gateOk2?'#4ddc97':'#ff6b3d')+';font-family:\'IBM Plex Mono\',monospace">× '+gCapPct+'% '+(gateOk2?'✓':'⚠')+'</span></div>';

    var heroHtml='<div style="padding:18px;text-align:center">'
      +'<div style="font-size:9px;font-weight:850;text-transform:uppercase;letter-spacing:.12em;color:rgba(188,215,255,.55);font-family:\'IBM Plex Mono\',monospace;margin-bottom:5px">Final Payout</div>'
      +'<div style="font-size:36px;font-weight:950;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace;letter-spacing:-.025em;text-shadow:0 0 24px rgba(255,224,138,.15);line-height:1.1">'+money(finalAmt)+'</div>'
      +(!src.loading?'<div style="font-size:11px;color:#4ddc97;margin-top:5px;font-weight:700">ตรงกับ commission panel ✓</div>':'')
      +'</div>';

    var exportBtnHtml=(src.upsell_sku>0||src.upsell_outlet>0)
      ?'<button onclick="_commExportAuditCSV()" style="display:block;width:calc(100% - 36px);margin:0 18px 8px;padding:12px;border-radius:10px;background:rgba(188,215,255,.07);border:1px solid rgba(188,215,255,.18);color:rgba(225,238,255,.78);font-size:13px;font-weight:700;cursor:pointer;font-family:\'IBM Plex Sans Thai\',sans-serif">↓ Export audit CSV</button>'
      :'';

    var html=[
      '<div class="pv-comm-sheet">',
      '<div class="pv-comm-sheet-handle"></div>',
      '<div style="overflow-y:auto">',
      loadNote,
      '<div style="padding:14px 18px 0;display:flex;align-items:flex-start;justify-content:space-between">',
      '<div><div style="font-size:17px;font-weight:900;color:#fff">วิธีคิดค่าคอมฯ</div>',
      '<div style="font-size:11px;color:rgba(225,238,255,.40);margin-top:3px">สรุปตามแหล่งที่มา · คำนวณ '+nowStr+'</div></div>',
      '<button onclick="_commCloseKamSelfSheet()" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.42);font-size:13px;cursor:pointer;flex-shrink:0;font-family:inherit;margin-top:2px">✕</button>',
      '</div>',
      '<div class="pv-comm-sheet-kpis" style="margin:12px 18px 14px">',
      '<div class="pv-comm-sheet-kpi '+kpiCls+'"><div class="pv-comm-sheet-kpi-label">ค่าคอมฯ สุทธิ์</div><div class="pv-comm-sheet-kpi-val">'+money(finalAmt)+'</div></div>',
      '<div class="pv-comm-sheet-kpi"><div class="pv-comm-sheet-kpi-label">NRR</div><div class="pv-comm-sheet-kpi-val">'+esc(pctText)+'</div></div>',
      '</div>',
      '<div style="font-size:9px;font-weight:850;text-transform:uppercase;letter-spacing:.07em;color:rgba(225,238,255,.35);padding:2px 18px 6px;font-family:\'IBM Plex Mono\',monospace">ที่มาของยอด</div>',
      nrrRowHtml,upsellRowHtml,ncRowHtml,hoRowHtml,
      '<div style="height:1px;background:rgba(188,215,255,.10);margin:4px 18px"></div>',
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 18px">',
      '<span style="font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.07em;color:rgba(225,238,255,.38);font-family:\'IBM Plex Mono\',monospace">Subtotal</span>',
      '<span style="font-size:15px;font-weight:900;color:rgba(225,238,255,.88);font-family:\'IBM Plex Mono\',monospace">'+money(subtotalAmt)+'</span>',
      '</div>',
      gateCardHtml,
      '<div style="height:1px;background:rgba(188,215,255,.10);margin:0 18px"></div>',
      heroHtml,
      '<div style="font-size:10px;color:rgba(225,238,255,.22);text-align:center;padding:0 18px 12px;font-family:\'IBM Plex Mono\',monospace">คำนวณจาก CSV ที่โหลดอยู่ · v235 · '+nowStr+'</div>',
      exportBtnHtml,
      '<div style="padding:0 18px 4px;display:flex;gap:6px"><button onclick="_commCloseKamSelfSheet();setTimeout(openCommissionHistory,80)" style="flex:1;padding:10px;border-radius:10px;background:rgba(77,220,151,.10);border:1px solid rgba(77,220,151,.25);color:#4ddc97;font-size:12px;font-weight:700;cursor:pointer;font-family:\'IBM Plex Sans Thai\',sans-serif">History</button><button onclick="_commCloseKamSelfSheet();setTimeout(openCommissionRulebook,80)" style="flex:1;padding:10px;border-radius:10px;background:rgba(188,215,255,.08);border:1px solid rgba(188,215,255,.22);color:rgba(225,238,255,.88);font-size:12px;font-weight:700;cursor:pointer;font-family:\'IBM Plex Sans Thai\',sans-serif">Rules</button></div>',
      '<div style="padding:0 18px 20px"><button onclick="_commCloseKamSelfSheet()" style="width:100%;padding:11px;border-radius:10px;background:rgba(255,255,255,.055);border:1px solid rgba(188,215,255,.12);color:rgba(225,238,255,.55);font-size:13px;font-weight:700;cursor:pointer;font-family:\'IBM Plex Sans Thai\',sans-serif">ปิด</button></div>',
      '</div>',
      '</div></div>',
    ].join('');
    ov.innerHTML=html;
    requestAnimationFrame(function(){ov.classList.add('on');});
  }
  function closeCompactSheet(){
    var ov=document.getElementById('pv-comm-sheet-overlay');
    if(!ov)return;
    ov.classList.remove('on');
    setTimeout(function(){ov.innerHTML='';},260);
  }

  // v237+v243: helper functions exposed to window for cross-scope calls
  window._pvOutletName=function(outletId,accountId){
    if(!outletId||outletId==='_all')return'—';
    if(typeof bulkOutletsData!=='undefined'&&bulkOutletsData&&accountId){
      var months=bulkOutletsData[accountId];
      if(months){var labels=Object.keys(months);for(var li=0;li<labels.length;li++){var arr=months[labels[li]];if(!arr)continue;for(var oi=0;oi<arr.length;oi++){var o=arr[oi];var oid=o.outlet_id||o.outletId||o.id;if(String(oid)===String(outletId)&&(o.outlet_name||o.outletName))return o.outlet_name||o.outletName;}}}
    }
    if(typeof bulkOutletsData!=='undefined'&&bulkOutletsData){
      var accts=Object.keys(bulkOutletsData);for(var ai=0;ai<accts.length;ai++){var months2=bulkOutletsData[accts[ai]];if(!months2)continue;var labels2=Object.keys(months2);for(var li2=0;li2<labels2.length;li2++){var arr2=months2[labels2[li2]];if(!arr2)continue;for(var oi2=0;oi2<arr2.length;oi2++){var o2=arr2[oi2];var oid2=o2.outlet_id||o2.outletId||o2.id;if(String(oid2)===String(outletId)&&(o2.outlet_name||o2.outletName))return o2.outlet_name||o2.outletName;}}}
    }
    return outletId;
  };

  // ── v235: Outlet drill sheet ────────────────────────────────────────────────
  function _commOpenUpsellDrill(type){
    var ov=document.getElementById('pv-comm-sheet-overlay');
    var sheetEl=ov&&ov.querySelector('.pv-comm-sheet');
    if(!sheetEl)return;
    window._pvCommDrillSaved=sheetEl.outerHTML;

    var groups=type==='p1'?(window._pvCommP1Groups||[]):(window._pvCommP3Groups||[]);
    var titleLabel=type==='p1'?'กลุ่มสินค้าใหม่':'ยอดเติบโต';
    var badgeColor=type==='p1'?'rgba(77,220,151,.15)':'rgba(255,224,138,.15)';
    var badgeText=type==='p1'?'#4ddc97':'#ffe08a';

    function mon(n){n=Number(n||0);if(!n)return'฿0';if(n>=1000000)return'฿'+(n/1000000).toFixed(1)+'M';if(n>=1000)return'฿'+(n/1000).toFixed(0)+'K';return'฿'+Math.round(n).toLocaleString('en-US');}
    function es(s){return String(s||'').replace(/[&<>'"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];});}

    // Group by outletId — include account for name lookup
    var byOutlet={};
    groups.forEach(function(g){
      var key=g.outletId||'_all';
      if(!byOutlet[key])byOutlet[key]={outletId:key,accountId:g.accountId||'',items:[],totalComm:0,totalPrimary:0};
      byOutlet[key].items.push(g);
      byOutlet[key].totalComm+=g.commission||0;
      byOutlet[key].totalPrimary+=type==='p1'?(g.total_gmv||0):(g.incremental||0);
    });
    var outlets=Object.values(byOutlet).sort(function(a,b){return b.totalComm-a.totalComm;});
    var totalComm=groups.reduce(function(s,g){return s+(g.commission||0);},0);
    var totalOutlets=outlets.length;

    var allExpandedInitially=totalOutlets<=5; // auto-expand if few
    var expandState={}; // outletId → bool
    outlets.forEach(function(o,i){expandState['pvd'+i]=allExpandedInitially;});
    window._pvDrillExpandState=expandState;

    function buildRows(expanded){
      return outlets.map(function(o,i){
        var oid='pvd'+i;
        var oName=_pvOutletName(o.outletId, o.accountId);
        var isOpen=expanded?true:(window._pvDrillExpandState[oid]||false);
        var skuRows=o.items.map(function(g){
          if(type==='p1'){
            return '<div style="display:grid;grid-template-columns:1fr 64px 56px;padding:7px 16px 7px 24px;border-bottom:1px solid rgba(188,215,255,.08);align-items:center">'
              +'<span style="font-size:11px;font-weight:700;color:rgba(225,238,255,.65)">'+es(g.groupKey||g.group_key)+'</span>'
              +'<span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:700;color:#4ddc97">'+mon(g.total_gmv)+'</span>'
              +'<span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:700;color:#ffe08a">'+mon(g.commission)+'</span>'
              +'</div>';
          } else {
            return '<div style="display:grid;grid-template-columns:1fr 52px 56px 52px;padding:7px 16px 7px 24px;border-bottom:1px solid rgba(188,215,255,.08);align-items:center;gap:2px">'
              +'<div><div style="font-size:11px;font-weight:700;color:rgba(225,238,255,.65)">'+es(g.groupKey||g.group_key)+'</div>'
              +(g.max_baseline_month?'<div style="font-size:9px;color:rgba(225,238,255,.28);margin-top:1px">Base: '+es(g.max_baseline_month)+'</div>':'')+'</div>'
              +'<span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:700;color:rgba(188,215,255,.50)">'+mon(g.max_baseline||0)+'</span>'
              +'<span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:700;color:#4ddc97">'+mon(g.incremental)+'</span>'
              +'<span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:700;color:#ffe08a">'+mon(g.commission)+'</span>'
              +'</div>';
          }
        }).join('');
        var colsHd=type==='p1'?'grid-template-columns:1fr 64px 56px':'grid-template-columns:1fr 52px 56px 52px';
        var amtCols=type==='p1'
          ?('<span style="font-size:13px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:900;color:#4ddc97">'+mon(o.totalPrimary)+'</span>'
            +'<span style="font-size:13px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:900;color:#ffe08a">'+mon(o.totalComm)+'</span>')
          :('<span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace;text-align:right;color:rgba(188,215,255,.35)">—</span>'
            +'<span style="font-size:13px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:900;color:#4ddc97">'+mon(o.totalPrimary)+'</span>'
            +'<span style="font-size:13px;font-family:\'IBM Plex Mono\',monospace;text-align:right;font-weight:900;color:#ffe08a">'+mon(o.totalComm)+'</span>');
        return '<div>'
          +'<div style="display:grid;'+colsHd+' 20px;padding:10px 16px;border-bottom:1px solid rgba(188,215,255,.09);align-items:center;cursor:pointer;background:rgba(188,215,255,.05)" '
          +'onclick="_commToggleDrillOutlet(\''+oid+'\')">'
          +'<div><div style="font-size:13px;font-weight:900;color:rgba(225,238,255,.92)">'+es(oName)+'</div>'
          +'<div style="font-size:10px;color:rgba(225,238,255,.35);margin-top:2px">'+o.items.length+' กลุ่มสินค้า</div></div>'
          +amtCols
          +'<span id="pvdchev'+i+'" style="font-size:14px;color:rgba(188,215,255,.28);transition:transform 150ms;text-align:right'+(isOpen?';transform:rotate(90deg);color:rgba(188,215,255,.55)':'')+'">›</span>'
          +'</div>'
          +'<div id="'+oid+'" style="display:'+(isOpen?'block':'none')+'">'+skuRows+'</div>'
          +'</div>';
      }).join('');
    }

    window._pvDrillRebuild=function(expandAll){
      outlets.forEach(function(_,i){window._pvDrillExpandState['pvd'+i]=expandAll;});
      var list=document.getElementById('pvDrillList');
      if(list)list.innerHTML=buildRows(expandAll);
      var btn=document.getElementById('pvDrillToggleBtn');
      if(btn){
        var anyOpen=expandAll||outlets.some(function(_,i){return window._pvDrillExpandState['pvd'+i];});
        btn.textContent=anyOpen?'ย่อทั้งหมด':'ขยายทั้งหมด';
      }
    };

    var colsHdStr=type==='p1'
      ?'<span>Outlet</span><span style="text-align:right">GMV</span><span style="text-align:right">Comm</span>'
      :'<span>Outlet</span><span style="text-align:right">Base</span><span style="text-align:right">Incr</span><span style="text-align:right">Comm</span>';
    var colsHdGrid=type==='p1'?'grid-template-columns:1fr 64px 56px 20px':'grid-template-columns:1fr 52px 56px 52px 20px';

    var html='<div class="pv-comm-sheet" style="display:flex;flex-direction:column;touch-action:pan-y">'
      +'<div style="flex-shrink:0"><div class="pv-comm-sheet-handle"></div>'
      +'<div style="padding:12px 16px 10px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(188,215,255,.10)">'
      +'<button onclick="_commDrillBack()" style="width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.055);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.78);font-size:15px;cursor:pointer;font-family:inherit">‹</button>'
      +'<div style="flex:1"><div style="font-size:15px;font-weight:900;color:#fff;display:flex;align-items:center;gap:8px">'+es(titleLabel)
      +'<span style="font-size:9px;font-weight:850;padding:3px 8px;border-radius:999px;background:'+badgeColor+';color:'+badgeText+';font-family:\'IBM Plex Mono\',monospace;letter-spacing:.04em">× 3%</span></div></div>'
      +'<button onclick="_commCloseKamSelfSheet()" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.42);font-size:13px;cursor:pointer;font-family:inherit">✕</button>'
      +'</div>'
      +'<div style="padding:10px 16px;display:flex;align-items:center;border-bottom:1px solid rgba(188,215,255,.10)">'
      +'<div style="flex:1;text-align:center;border-right:1px solid rgba(188,215,255,.08)"><div style="font-size:15px;font-weight:950;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace">'+totalOutlets+'</div><div style="font-size:9px;color:rgba(225,238,255,.35);margin-top:3px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-family:\'IBM Plex Mono\',monospace">outlet</div></div>'
      +'<div style="flex:1;text-align:center"><div style="font-size:15px;font-weight:950;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace">'+mon(totalComm)+'</div><div style="font-size:9px;color:rgba(225,238,255,.35);margin-top:3px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-family:\'IBM Plex Mono\',monospace">commission</div></div>'
      +'<button id="pvDrillToggleBtn" onclick="_pvDrillRebuild(this.textContent===\'ขยายทั้งหมด\')" style="flex-shrink:0;margin-left:12px;padding:5px 10px;border-radius:8px;background:rgba(188,215,255,.08);border:1px solid rgba(188,215,255,.18);color:rgba(225,238,255,.65);font-size:11px;font-weight:700;cursor:pointer;font-family:\'IBM Plex Sans Thai\',sans-serif">'+(allExpandedInitially?'ย่อทั้งหมด':'ขยายทั้งหมด')+'</button>'
      +'</div>'
      +'<div style="display:grid;'+colsHdGrid+';padding:6px 16px;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(188,215,255,.10);font-size:9px;font-weight:850;text-transform:uppercase;letter-spacing:.08em;color:rgba(225,238,255,.35);font-family:\'IBM Plex Mono\',monospace">'+colsHdStr+'<span></span></div>'
      +'</div>'
      +'<div id="pvDrillList" style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch">'+buildRows(false)+'</div>'
      +'<div style="display:flex;gap:8px;padding:10px 16px 16px;flex-shrink:0;border-top:1px solid rgba(188,215,255,.10)">'
      +'<button onclick="_commExportAuditCSV(\''+type+'\')" style="flex:1;padding:10px;border-radius:10px;background:rgba(188,215,255,.07);border:1px solid rgba(188,215,255,.18);color:rgba(225,238,255,.78);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">↓ ดาวน์โหลด CSV</button>'
      +'</div>'
      +'</div>';

    sheetEl.outerHTML=html;
  }
  window._commOpenUpsellDrill=_commOpenUpsellDrill;

  window._commDrillBack=function(){
    var ov=document.getElementById('pv-comm-sheet-overlay');
    if(!ov||!window._pvCommDrillSaved)return;
    var tmp=document.createElement('div');
    tmp.innerHTML=window._pvCommDrillSaved;
    var restored=tmp.firstElementChild;
    if(restored){
      var old=ov.querySelector('.pv-comm-sheet');
      if(old)old.parentNode.replaceChild(restored,old);
    }
    window._pvCommDrillSaved=null;
    // v247c: fade restored sheet — no translateX overflow
    var restored2=document.querySelector('#pv-comm-sheet-overlay .pv-comm-sheet');
    if(restored2){
      restored2.style.opacity='0';
      restored2.style.transition='opacity 160ms ease';
      requestAnimationFrame(function(){requestAnimationFrame(function(){
        restored2.style.opacity='1';
        setTimeout(function(){restored2.style.transition='';restored2.style.opacity='';},180);
      });});
    }
    // v244-fix: re-attach chooser listeners if restored sheet is the chooser
    requestAnimationFrame(function(){
      var b1=document.getElementById('pvChooseP1');
      var b3=document.getElementById('pvChooseP3');
      if(b1)b1.addEventListener('click',function(){window._commOpenUpsellDrill('p1');});
      if(b3)b3.addEventListener('click',function(){window._commOpenUpsellDrill('p3');});
    });
  };

  window._commToggleDrillOutlet=function(oid){
    var el=document.getElementById(oid);
    if(!el)return;
    var open=el.style.display!=='none';
    el.style.display=open?'none':'block';
    if(window._pvDrillExpandState)window._pvDrillExpandState[oid]=!open;
    // update chevron
    var idx=oid.replace('pvd','');
    var chev=document.getElementById('pvdchev'+idx);
    if(chev){chev.style.transform=open?'':'rotate(90deg)';chev.style.color=open?'rgba(188,215,255,.28)':'rgba(188,215,255,.55)';}
    // update toggle button label
    var btn=document.getElementById('pvDrillToggleBtn');
    if(btn&&window._pvDrillExpandState){
      var anyOpen=Object.values(window._pvDrillExpandState).some(function(v){return v;});
      btn.textContent=anyOpen?'ย่อทั้งหมด':'ขยายทั้งหมด';
    }
  };

  // ── Export CSV ──────────────────────────────────────────────────────────────
  window._commExportAuditCSV=function(type){
    var groups=[];
    var filename='audit_upsell.csv';
    var header='';
    if(!type||type==='p1'){
      groups=groups.concat((window._pvCommP1Groups||[]).map(function(g){return Object.assign({},g,{audit_type:'กลุ่มสินค้าใหม่'});}));
    }
    if(!type||type==='p3'){
      groups=groups.concat((window._pvCommP3Groups||[]).map(function(g){return Object.assign({},g,{audit_type:'ยอดเติบโต'});}));
    }
    if(type==='p1'){header='audit_type,outlet_id,group_key,gmv,commission\n';filename='audit_กลุ่มสินค้าใหม่.csv';}
    else if(type==='p3'){header='audit_type,outlet_id,group_key,base,incr,commission,base_month\n';filename='audit_ยอดเติบโต.csv';}
    else{header='audit_type,outlet_id,group_key,gmv,base,incr,commission,base_month\n';filename='audit_upsell.csv';}

    var rows=groups.map(function(g){
      var cols=[
        g.audit_type||'',
        g.outletId||g.outlet_id||'',
        g.groupKey||g.group_key||'',
        type==='p3'?'':(g.total_gmv||0),
        type==='p1'?'':(g.max_baseline||0),
        type==='p1'?'':(g.incremental||0),
        g.commission||0,
        g.max_baseline_month||''
      ].filter(function(_,i){
        if(type==='p1')return[0,1,2,3,6].indexOf(i)>=0;
        if(type==='p3')return[0,1,2,4,5,6,7].indexOf(i)>=0;
        return true;
      });
      return cols.map(function(v){return typeof v==='string'&&v.indexOf(',')>=0?'"'+v+'"':v;}).join(',');
    }).join('\n');

    var blob=new Blob(['\ufeff'+header+rows],{type:'text/csv;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url;a.download=filename;a.click();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
  };

  // ── v235: Drill helper — push content into existing sheet ──────────────────
  window._pvPushDrill=function _pvPushDrill(html){
    var ov=document.getElementById('pv-comm-sheet-overlay');
    var sheetEl=ov&&ov.querySelector('.pv-comm-sheet');
    if(!sheetEl)return;
    window._pvCommDrillSaved=sheetEl.outerHTML;
    var tmp=document.createElement('div');tmp.innerHTML=html;
    var el=tmp.firstElementChild;
    if(!el)return;
    // v247c: fade only — translateX caused sheet to overflow overlay bounds
    el.style.opacity='0';
    el.style.transition='opacity 180ms ease';
    sheetEl.parentNode.replaceChild(el,sheetEl);
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        el.style.opacity='1';
        // clear transition after done so it doesnt affect content
        setTimeout(function(){el.style.transition='';el.style.opacity='';},200);
      });
    });
  }
  window._pvDrillHeader=function _pvDrillHeader(title,badge,badgeBg,badgeColor){
    return '<div style="flex-shrink:0"><div class="pv-comm-sheet-handle"></div>'
      +'<div style="padding:12px 16px 10px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(188,215,255,.10)">'
      +'<button onclick="window._commDrillBack()" style="width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.055);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.78);font-size:15px;cursor:pointer;font-family:inherit">‹</button>'
      +'<div style="flex:1;font-size:15px;font-weight:900;color:#fff;display:flex;align-items:center;gap:8px">'+title
      +(badge?'<span style="font-size:9px;font-weight:850;padding:3px 8px;border-radius:999px;background:'+badgeBg+';color:'+badgeColor+';font-family:\'IBM Plex Mono\',monospace;letter-spacing:.04em">'+badge+'</span>':'')
      +'</div>'
      +'<button onclick="_commCloseKamSelfSheet()" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.42);font-size:13px;cursor:pointer;font-family:inherit">✕</button>'
      +'</div></div>';
  }

  // NRR drill — tier table + action note
  // v247e: NRR drill rewritten to reuse _tgtShowCohortSheet design
  // Injects NRR result for current KAM then opens the existing cohort sheet (tabs: NRR/Comeback/Expansion)
  window._commDrillNRR=function(){
    var st=window._pvCommDrillSt||{};
    var email=st&&st.email;
    // If cohort sheet available + NRR data computable → use rich design
    if(email&&typeof _tgtComputeKamNRR==='function'&&typeof _tgtShowCohortSheet==='function'){
      var nrrResult=null;
      try{ nrrResult=_tgtComputeKamNRR(email,null); }catch(e){}
      if(nrrResult){
        window._ncsLastNrrResult=nrrResult;
        // Label: prefer portview display name
        var pvRow=(portviewBulkData||[]).find(function(r){return r.kamEmail===email;});
        window._ncsKamLabel=(pvRow&&pvRow.kamName)||email.split('@')[0];
        _tgtShowCohortSheet('nrr');
        return;
      }
    }
    // Fallback: minimal panel (no outlet data)
    var cfg=window._pvCommDrillCfg||{};
    var src=window._pvCommDrillSrc||{};
    function mon(n){return'฿'+Math.round(n||0).toLocaleString('en-US');}
    var html='<div class="pv-comm-sheet" style="display:flex;flex-direction:column;max-height:80vh">'
      +_pvDrillHeader('NRR Commission','','','')
      +'<div style="overflow-y:auto;flex:1">'
      +'<div style="padding:14px 18px 10px">'+(cfg.tierRows||'')+'</div>'
      +'<div style="padding:10px 18px;background:rgba(77,220,151,.06);border-top:1px solid rgba(77,220,151,.12)">'
      +'<div style="font-size:12px;color:rgba(225,238,255,.75);line-height:1.6">'+(cfg.action||'')+'</div>'
      +'</div>'
      +(src.nrr>0?'<div style="padding:14px 18px"><div style="display:flex;justify-content:space-between">'
        +'<span style="font-size:13px;color:rgba(225,238,255,.75)">NRR Payout</span>'
        +'<span style="font-size:18px;font-weight:900;color:#4ddc97;font-family:\'IBM Plex Mono\',monospace">'+mon(src.nrr)+'</span>'
        +'</div></div>':'')
      +'</div></div>';
    _pvPushDrill(html);
  };

  // Upsell chooser — pick กลุ่มสินค้าใหม่ or ยอดเติบโต
  window._commDrillUpsellChooser=function(){
    var p1g=window._pvCommP1Groups||[];
    var p3g=window._pvCommP3Groups||[];
    function mon(n){n=Number(n||0);if(!n)return'\u0e3f0';if(n>=1000)return'\u0e3f'+(n/1000).toFixed(0)+'K';return'\u0e3f'+Math.round(n).toLocaleString('en-US');}
    var p1comm=p1g.reduce(function(s,g){return s+(g.commission||0);},0);
    var p3comm=p3g.reduce(function(s,g){return s+(g.commission||0);},0);
    if(p1g.length&&!p3g.length){window._commOpenUpsellDrill('p1');return;}
    if(p3g.length&&!p1g.length){window._commOpenUpsellDrill('p3');return;}
    var html='<div class="pv-comm-sheet" style="display:flex;flex-direction:column;touch-action:pan-y">'
      +window._pvDrillHeader('กลุ่มสินค้าใหม่ + ยอดเติบโต','','','')
      +'<div style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;padding:16px 18px;display:flex;flex-direction:column;gap:10px">'
      +(p1g.length
        ?'<div id="pvChooseP1" style="padding:16px;border-radius:12px;background:rgba(77,220,151,.08);border:1px solid rgba(77,220,151,.2);cursor:pointer;display:flex;align-items:center;justify-content:space-between">'
          +'<div><div style="font-size:14px;font-weight:700;color:rgba(225,238,255,.88)">กลุ่มสินค้าใหม่</div>'
          +'<div style="font-size:11px;color:rgba(225,238,255,.40);margin-top:3px">'+p1g.length+' outlet × group · GMV × 3%</div></div>'
          +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#4ddc97;font-family:\'IBM Plex Mono\',monospace">'+mon(p1comm)+'</div>'
          +'<div style="font-size:13px;color:rgba(188,215,255,.35)">›</div></div>'
          +'</div>'
        :'')
      +(p3g.length
        ?'<div id="pvChooseP3" style="padding:16px;border-radius:12px;background:rgba(255,224,138,.08);border:1px solid rgba(255,224,138,.18);cursor:pointer;display:flex;align-items:center;justify-content:space-between">'
          +'<div><div style="font-size:14px;font-weight:700;color:rgba(225,238,255,.88)">ยอดเติบโต</div>'
          +'<div style="font-size:11px;color:rgba(225,238,255,.40);margin-top:3px">'+p3g.length+' outlet × group · Incr × 3%</div></div>'
          +'<div style="text-align:right"><div style="font-size:16px;font-weight:900;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace">'+mon(p3comm)+'</div>'
          +'<div style="font-size:13px;color:rgba(188,215,255,.35)">›</div></div>'
          +'</div>'
        :'')
      +'</div></div>';
    window._pvPushDrill(html);
    // attach listeners after DOM is ready (no inline onclick = no quote hell)
    requestAnimationFrame(function(){
      var b1=document.getElementById('pvChooseP1');
      var b3=document.getElementById('pvChooseP3');
      if(b1)b1.addEventListener('click',function(){window._commOpenUpsellDrill('p1');});
      if(b3)b3.addEventListener('click',function(){window._commOpenUpsellDrill('p3');});
    });
  };

  window._commDrillExpansion=function(){
    var st=window._pvCommDrillSt||{};
    var cfg=window._pvCommDrillCfg||{};
    var EX='#00c8b0';
    function mon(n){n=Number(n||0);if(!n)return'\u0e3f0';if(n>=1000000)return'\u0e3f'+(n/1000000).toFixed(1)+'M';if(n>=1000)return'\u0e3f'+(n/1000).toFixed(0)+'K';return'\u0e3f'+Math.round(n).toLocaleString('en-US');}
    function es(s){return String(s||'').replace(/[&<>'"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];});}

    var nrrResult=typeof _tgtComputeKamNRR==='function'?_tgtComputeKamNRR(st.email,null):null;
    var rate=Number(String(cfg.outRate||'1.5'))/100||0.015;

    var allAccounts=[];
    var totalGmv=0, totalOutlets=0;
    var expandState={};
    function addExpansion(result){
      if(!result)return;
      (result.expansionDetail||[]).forEach(function(g){
        var acctGmv=0;
        var outlets=(g.outlets||[]);
        outlets.forEach(function(o){acctGmv+=o.currGmv||0;totalGmv+=o.currGmv||0;});
        totalOutlets+=outlets.length;
        if(!outlets.length)return;
        var aid='pvExAcct'+allAccounts.length;
        expandState[aid]=false;
        allAccounts.push({aid:aid,name:g.acctName||g.acctId||'—',gmv:acctGmv,outlets:outlets});
      });
    }
    if(nrrResult){addExpansion(nrrResult);addExpansion(nrrResult.transferIn);addExpansion(nrrResult.newFromSales);}

    var comm=Math.round(totalGmv*rate);

    function buildRows(forceOpen){
      return allAccounts.map(function(a){
        var isOpen=forceOpen!==undefined?forceOpen:(expandState[a.aid]||false);
        var outletRows=a.outlets.map(function(o){
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 16px 9px 24px;border-bottom:1px solid rgba(0,200,176,.06)">'
            +'<span style="font-size:12px;color:rgba(225,238,255,.72)">'+es(o.outletName||o.outletId||'—')+'</span>'
            +'<span style="font-size:12px;font-weight:700;color:'+EX+';font-family:monospace">'+mon(o.currGmv||0)+'</span>'
            +'</div>';
        }).join('');
        return '<div>'
          +'<div onclick="_pvExToggle(\''+a.aid+'\')" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(0,200,176,.10);cursor:pointer;background:rgba(0,200,176,.04);transition:background 120ms">'
          +'<span style="font-size:13px;font-weight:900;color:rgba(225,238,255,.92)">'+es(a.name)+'</span>'
          +'<div style="display:flex;align-items:center;gap:10px">'
          +'<span style="font-size:13px;font-weight:900;color:'+EX+';font-family:monospace">'+mon(a.gmv)+'</span>'
          +'<span id="pvExChev'+a.aid+'" style="font-size:14px;color:rgba(0,200,176,.45);transition:transform 200ms ease'+(isOpen?';transform:rotate(90deg)':'')+'">›</span>'
          +'</div></div>'
          +'<div id="'+a.aid+'" style="overflow:hidden;transition:max-height 250ms ease;max-height:'+(isOpen?'600px':'0')+'">'+outletRows+'</div>'
          +'</div>';
      }).join('');
    }

    window._pvExToggle=function(aid){
      var el=document.getElementById(aid);
      if(!el)return;
      var isOpen=el.style.maxHeight!=='0px'&&el.style.maxHeight!=='';
      el.style.maxHeight=isOpen?'0':'600px';
      expandState[aid]=!isOpen;
      var chev=document.getElementById('pvExChev'+aid);
      if(chev){chev.style.transform=isOpen?'':'rotate(90deg)';chev.style.color=isOpen?'rgba(0,200,176,.45)':'rgba(0,200,176,.85)';}
      var btn=document.getElementById('pvExToggleBtn');
      if(btn){var anyOpen=Object.values(expandState).some(Boolean);btn.textContent=anyOpen?'ย่อทั้งหมด':'ขยายทั้งหมด';}
    };
    window._pvExToggleAll=function(){
      var anyOpen=Object.values(expandState).some(Boolean);
      var target=!anyOpen;
      Object.keys(expandState).forEach(function(k){expandState[k]=target;});
      document.querySelectorAll('#pv-comm-sheet-overlay [id^="pvExAcct"]').forEach(function(el){
        el.style.maxHeight=target?'600px':'0';
        var chev=document.getElementById('pvExChev'+el.id);
        if(chev){chev.style.transform=target?'rotate(90deg)':'';chev.style.color=target?'rgba(0,200,176,.85)':'rgba(0,200,176,.45)';}
      });
      var btn=document.getElementById('pvExToggleBtn');
      if(btn)btn.textContent=target?'ย่อทั้งหมด':'ขยายทั้งหมด';
    };

    // Scorecard: hero GMV + secondary account/outlet counts + commission
    var scorecard='<div style="padding:14px 16px 12px;border-bottom:1px solid rgba(0,200,176,.10);flex-shrink:0">'
      // Hero row: GMV (large) + commission
      +'<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">'
      +'<div>'
      +'<div style="font-size:28px;font-weight:950;color:'+EX+';font-family:monospace;line-height:1.1;letter-spacing:-.02em">'+mon(totalGmv)+'</div>'
      +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(0,200,176,.6);margin-top:3px">Expansion GMV · MTD</div>'
      +'</div>'
      +'<div style="text-align:right">'
      +'<div style="font-size:22px;font-weight:950;color:#ffe08a;font-family:monospace;line-height:1.1;text-shadow:0 0 16px rgba(255,224,138,.15)">'+mon(comm)+'</div>'
      +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,224,138,.5);margin-top:3px">Commission</div>'
      +'</div>'
      +'</div>'
      // Secondary: account + outlet counts
      +'<div style="display:flex;gap:12px">'
      +'<div style="display:flex;align-items:center;gap:5px;background:rgba(0,200,176,.08);border:1px solid rgba(0,200,176,.15);border-radius:20px;padding:3px 10px">'
      +'<span style="font-size:12px;font-weight:700;color:'+EX+';font-family:monospace">'+allAccounts.length+'</span>'
      +'<span style="font-size:11px;color:rgba(0,200,176,.65)">account</span>'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:5px;background:rgba(0,200,176,.08);border:1px solid rgba(0,200,176,.15);border-radius:20px;padding:3px 10px">'
      +'<span style="font-size:12px;font-weight:700;color:'+EX+';font-family:monospace">'+totalOutlets+'</span>'
      +'<span style="font-size:11px;color:rgba(0,200,176,.65)">สาขา</span>'
      +'</div>'
      +'</div>'
      +'</div>';

    var html='<div class="pv-comm-sheet" style="display:flex;flex-direction:column;touch-action:pan-y;overflow:hidden">'
      +window._pvDrillHeader('Expansion','× '+(cfg.outRate||'1.5')+'%','rgba(0,200,176,.12)','#00c8b0')
      +scorecard
      +(allAccounts.length
        ?'<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;flex-shrink:0;border-bottom:1px solid rgba(0,200,176,.08)">'
          +'<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgba(225,238,255,.35)">สาขาใหม่เดือนนี้</span>'
          +'<button id="pvExToggleBtn" onclick="window._pvExToggleAll()" style="padding:4px 10px;border-radius:8px;background:rgba(0,200,176,.08);border:1px solid rgba(0,200,176,.18);color:rgba(0,200,176,.8);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">ขยายทั้งหมด</button>'
          +'</div>'
          +'<div id="pvExList" style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch">'+buildRows()+'</div>'
        :'<div style="padding:24px;text-align:center;color:rgba(225,238,255,.35);font-size:13px">ไม่มีสาขาใหม่เดือนนี้</div>'
      )
      +'</div>';
    window._pvPushDrill(html);
  };
  window._commDrillNewComeback=window._commDrillExpansion; // alias for back-compat
  window._commDrillHandover=function(){
    var src=window._pvCommDrillSrc||{};
    var cfg=window._pvCommDrillCfg||{};
    var hd=src.handover_detail||{};
    function mon(n){return'฿'+Math.round(n||0).toLocaleString('en-US');}
    var hit2=hd.retention_pct>=cfg.hoT2;
    var hit3=hd.retention_pct>=cfg.hoT3;
    var detailRows=(hd.detail||[]).slice(0,8).map(function(a){
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(188,215,255,.09)">'
        +'<div><div style="font-size:12px;font-weight:700;color:rgba(225,238,255,.82)">'+String(a.name||a.account_id||'—').slice(0,30)+'</div>'
        +'<div style="font-size:10px;color:rgba(225,238,255,.35);margin-top:1px">Base '+mon(a.baseline)+' → MTD '+mon(a.current)+'</div></div>'
        +'</div>';
    }).join('');
    var html='<div class="pv-comm-sheet" style="display:flex;flex-direction:column">'
      +_pvDrillHeader('Handover','','','')
      +'<div style="overflow-y:auto;flex:1;padding:14px 18px">'
      +(hd.accounts?'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">'
        +'<div class="pv-comm-sheet-kpi"><div class="pv-comm-sheet-kpi-label">Accounts</div><div class="pv-comm-sheet-kpi-val" style="font-size:20px">'+(hd.accounts||0)+'</div></div>'
        +'<div class="pv-comm-sheet-kpi '+(hit2?'val-good':'')+'"><div class="pv-comm-sheet-kpi-label">Retention</div><div class="pv-comm-sheet-kpi-val" style="font-size:20px">'+(hd.retention_pct||0)+'%</div></div>'
        +'</div>':'')
      +'<div style="background:rgba(188,215,255,.06);border:1px solid rgba(188,215,255,.12);border-radius:10px;padding:12px 14px;margin-bottom:12px">'
      +'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(188,215,255,.08)">'
      +'<span style="font-size:12px;color:'+(hit2?'rgba(225,238,255,.78)':'rgba(225,238,255,.35)')+'">≥'+cfg.hoT2+'% → ฿'+cfg.hoT2Pay+'</span>'
      +'<span style="font-size:12px;font-weight:700;color:'+(hit2?'#4ddc97':'rgba(225,238,255,.25)')+'">'+(hit2?'✓ '+mon(Number(String(cfg.hoT2Pay).replace(/,/g,''))||0):'—')+'</span>'
      +'</div>'
      +'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(188,215,255,.08)">'
      +'<span style="font-size:12px;color:'+(hit3?'rgba(225,238,255,.78)':'rgba(225,238,255,.35)')+'">≥'+cfg.hoT3+'% → +฿'+cfg.hoT3Bon+' (bonus)</span>'
      +'<span style="font-size:12px;font-weight:700;color:'+(hit3?'#4ddc97':'rgba(225,238,255,.25)')+'">'+(hit3?'✓ '+mon(Number(String(cfg.hoT3Bon).replace(/,/g,''))||0):'—')+'</span>'
      +'</div>'
      +'<div style="display:flex;justify-content:space-between;padding:6px 0">'
      +'<span style="font-size:13px;font-weight:700;color:rgba(225,238,255,.78)">Handover Payout</span>'
      +'<span style="font-size:16px;font-weight:900;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace">'+mon(src.handover||0)+'</span>'
      +'</div></div>'
      +(detailRows?'<div style="font-size:9px;font-weight:850;text-transform:uppercase;letter-spacing:.07em;color:rgba(225,238,255,.35);margin-bottom:8px;font-family:\'IBM Plex Mono\',monospace">รายชื่อร้าน</div>'+detailRows:'')
      +'</div></div>';
    _pvPushDrill(html);
  };
  window._commRenderKamSelfStrip=renderCompactStrip;
  window._commOpenKamSelfSheet=openCompactSheet;
  window._commCloseKamSelfSheet=closeCompactSheet;
  try{ _commRenderKamSelfStrip=renderCompactStrip; }catch(e){}
  try{ _commOpenKamSelfSheet=openCompactSheet; }catch(e){}
  try{ _commCloseKamSelfSheet=closeCompactSheet; }catch(e){}
  // v224e render-gate: DOMContentLoaded timers removed — renderCompactStrip called via _commGatedRender
})();


//////////////////////////////////////////////////////////////////////////////
// ── Commission Detail Sheet (cds) ────────────────────────────────────────
// Single-sheet stack: Zone A summary · Zone B tabs · Zone C body · Zone D footer
// Session 2: HTML template functions + open/close/tab-switch skeleton
// Zone C content filled per-tab in Sessions 3–7
//////////////////////////////////////////////////////////////////////////////

(function(){

  // ── Helpers ───────────────────────────────────────────────────────────
  function esc(v){
    return String(v==null?'':v).replace(/[&<>'"]/g,function(c){
      return{'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];
    });
  }
  function fmt(n){
    n=Number(n||0);
    if(!n)return'฿0';
    if(n>=1000000)return'฿'+(n/1000000).toFixed(1)+'M';
    if(n>=1000)return'฿'+Math.round(n/1000)+'K';
    return'฿'+Math.round(n).toLocaleString('en-US');
  }

  // ── Chip labels (single-row abbreviations) ────────────────────────────
  var CDS_TABS=[
    {key:'p1', label:'สินค้าใหม่', short:'ใหม่',   cls:'t-p1',  valCls:'v-amber'},
    {key:'p3', label:'ยอดเติบโต', short:'โต',     cls:'t-p3',  valCls:'v-amber'},
    {key:'nrr',label:'NRR',       short:'NRR',    cls:'t-nrr', valCls:'v-green'},
    {key:'exp',label:'Expansion', short:'Exp',    cls:'t-exp', valCls:'v-teal'},
    {key:'ho', label:'Handover',  short:'H/O',    cls:'t-ho',  valCls:'v-blue'}
  ];

  // ── Zone A: Summary bar ───────────────────────────────────────────────
  function _cdsSummaryHtml(src, activeKey){
    var payout=src.loading?null:src.final;
    var gateOk=!src.gate_active;
    var gatePct=Math.round((src.gate_cap||1)*100);
    var gateHtml=(!src.loading&&src.gate&&src.gate.ach_pct!==null)
      ?'<span class="cds-gate-pill '+(gateOk?'ok':'warn')+'">× '+gatePct+'% '+(gateOk?'✓':'⚠')+'</span>'
      :'';
    var amtHtml=src.loading
      ?'<span class="cds-shimmer" style="display:inline-block;width:80px;height:22px;vertical-align:-4px"></span>'
      :esc(fmt(payout));

    var amounts={
      p1: src.upsell_sku  ? Math.round(Number((src.upsell_sku_detail&&src.upsell_sku_detail.p1&&src.upsell_sku_detail.p1.comm)||0)) : 0,
      p3: src.upsell_sku  ? Math.round(Number((src.upsell_sku_detail&&src.upsell_sku_detail.p3&&src.upsell_sku_detail.p3.comm)||0)) : 0,
      nrr:Number(src.nrr||0),
      exp:Number(src.upsell_outlet||0),
      ho: Number(src.handover||0)
    };

    var chipsHtml=CDS_TABS.map(function(t){
      var active=t.key===activeKey?'active':'';
      var amt=src.loading?'—':fmt(amounts[t.key]||0);
      return '<button class="cds-chip '+t.cls+' '+active+'" onclick="_cdsSetTab(\''+t.key+'\')">'
        +'<span class="cds-chip-dot"></span>'+esc(t.short)+' '+esc(amt)
        +'</button>';
    }).join('');

    return '<div class="cds-summary">'
      +'<div class="cds-summary-head">'
      +'<div><div class="cds-summary-label">ค่าคอมฯ เดือนนี้</div>'
      +'<div class="cds-summary-payout">'+amtHtml+gateHtml+'</div></div>'
      +'<button class="cds-summary-close" onclick="_cdsClose()">✕</button>'
      +'</div>'
      +'<div class="cds-chips">'+chipsHtml+'</div>'
      +'</div>';
  }

  // ── Zone B: Tab bar ───────────────────────────────────────────────────
  function _cdsTabBarHtml(src, activeKey){
    var counts={
      p1:(src.upsell_sku_detail&&src.upsell_sku_detail.p1&&src.upsell_sku_detail.p1.groups)?src.upsell_sku_detail.p1.groups.length:0,
      p3:(src.upsell_sku_detail&&src.upsell_sku_detail.p3&&src.upsell_sku_detail.p3.groups)?src.upsell_sku_detail.p3.groups.length:0,
      nrr:null,
      exp:src.upsell_outlet_detail?src.upsell_outlet_detail.outlet_gmv||0:null,
      ho: src.handover_detail?src.handover_detail.accounts:0
    };
    return '<div class="cds-tabs">'+CDS_TABS.map(function(t){
      var active=t.key===activeKey?'active':'';
      var sub=counts[t.key]!==null?'<br><span style="font-size:8px;opacity:.6">'+counts[t.key]+'</span>':'';
      return '<button class="cds-tab '+t.cls+' '+active+'" onclick="_cdsSetTab(\''+t.key+'\')">'
        +esc(t.label)+sub+'</button>';
    }).join('')+'</div>';
  }

  // ── Zone C: column header templates ──────────────────────────────────
  var CDS_COL_DEFS={
    p1: [{l:'OUTLET'},{l:'GMV',r:1},{l:'COMM',r:1}],
    p3: [{l:'OUTLET'},{l:'ฐาน',r:1},{l:'เพิ่ม',r:1},{l:'COMM',r:1}],
    nrr:[{l:'OUTLET'},{l:'ฐาน',r:1},{l:'RUN RATE',r:1},{l:'MTD',r:1}],
    exp:[{l:'OUTLET/ACCOUNT'},{l:'สาขา',r:1},{l:'GMV',r:1},{l:'COMM',r:1}],
    ho: [{l:'ACCOUNT'},{l:'ฐาน',r:1},{l:'MTD',r:1},{l:'RET%',r:1}]
  };
  function _cdsTblHeadHtml(tabKey){
    var cols=CDS_COL_DEFS[tabKey]||CDS_COL_DEFS.p1;
    return '<div class="cds-tbl-head '+tabKey+'-cols">'
      +cols.map(function(c){return'<span class="cds-th'+(c.r?' r':'')+'">'+(c.l||'')+'</span>';}).join('')
      +'</div>';
  }

  // ── Zone C: accordion chip row ────────────────────────────────────────
  function _cdsChipRowHtml(id, name, meta, val, valCls, open){
    return '<div class="cds-chip-row'+(open?' open':'')+'" id="'+id+'" onclick="_cdsToggleRow(\''+id+'\')">'
      +'<span class="cds-chip-chev">&#8250;</span>'
      +'<div style="flex:1;min-width:0">'
      +'<div class="cds-chip-name">'+esc(name)+'</div>'
      +(meta?'<div class="cds-chip-meta">'+esc(meta)+'</div>':'')
      +'</div>'
      +'<span class="cds-chip-val '+valCls+'">'+esc(val)+'</span>'
      +'</div>'
      +'<div class="cds-sub-rows'+(open?' open':'')+'" id="'+id+'-sub">';
      // sub-rows injected here by each tab renderer
  }
  function _cdsChipRowClose(){ return '</div></div>'; }

  // ── Zone C: sub-row (grid columns) ────────────────────────────────────
  // cells = [{text, cls}]
  function _cdsSubRowHtml(cells, tabKey){
    return '<div class="cds-sub-row '+tabKey+'-cols">'
      +cells.map(function(c){
        return'<span class="'+(c.cls||'cds-val v-muted')+'">'+esc(c.text||'')+'</span>';
      }).join('')
      +'</div>';
  }

  // ── Zone C: proof card ────────────────────────────────────────────────
  // rows = [{label, result, pass}]  pass=true/false/null(neutral)
  function _cdsProofHtml(id, rows){
    return '<div class="cds-proof" id="proof-'+id+'">'
      +rows.map(function(r){
        var resCls='cds-proof-result'+(r.pass===true?' pass':r.pass===false?' fail':'');
        return'<div class="cds-proof-row">'
          +'<span class="cds-proof-label">'+esc(r.label)+'</span>'
          +'<span class="'+resCls+'">'+esc(r.result)+'</span>'
          +'</div>';
      }).join('')
      +'</div>';
  }

  // ── Zone D: Total + Footer ─────────────────────────────────────────────
  function _cdsTotalHtml(label, val, valCls){
    return '<div class="cds-total">'
      +'<span class="cds-total-label">'+esc(label)+'</span>'
      +'<span class="cds-total-val '+valCls+'">'+esc(val)+'</span>'
      +'</div>';
  }
  function _cdsFooterHtml(showExport, exportFn){
    return '<div class="cds-footer">'
      +(showExport?'<button class="cds-btn primary" onclick="'+esc(exportFn||'')+'">↓ Export CSV</button>':'')
      +'<button class="cds-btn secondary" onclick="_cdsClose();setTimeout(openCommissionRulebook,80)">กฎค่าคอมฯ</button>'
      +'<button class="cds-btn secondary" onclick="_cdsClose();setTimeout(openCommissionHistory,80)">History</button>'
      +'</div>';
  }

  // ── Zone C: placeholder (shown while tab renderer not yet built) ──────
  function _cdsTabPlaceholder(label){
    return '<div class="cds-empty">'+esc(label)+'<br>'
      +'<span style="font-size:10px;opacity:.5">coming next session</span></div>';
  }

  // ── Row toggle (accordion) ────────────────────────────────────────────
  window._cdsToggleRow=function(id){
    var row=document.getElementById(id);
    var sub=document.getElementById(id+'-sub');
    if(!row||!sub)return;
    var open=row.classList.toggle('open');
    sub.classList.toggle('open',open);
    var btn=document.getElementById('cds-toggle-btn');
    if(btn){
      var anyOpen=document.getElementById('cds-body').querySelectorAll('.cds-sub-rows.open').length>0;
      btn.textContent=anyOpen?'ย่อทั้งหมด':'ขยายทั้งหมด';
    }
  };
  window._cdsToggleAll=function(){
    var body=document.getElementById('cds-body');
    if(!body)return;
    var chips=Array.from(body.querySelectorAll('.cds-chip-row'));
    var subs=Array.from(body.querySelectorAll('.cds-sub-rows'));
    var anyOpen=subs.some(function(s){return s.classList.contains('open');});
    chips.forEach(function(c){c.classList.toggle('open',!anyOpen);});
    subs.forEach(function(s){s.classList.toggle('open',!anyOpen);});
    var btn=document.getElementById('cds-toggle-btn');
    if(btn)btn.textContent=anyOpen?'ขยายทั้งหมด':'ย่อทั้งหมด';
  };

  // ── Tab switch ────────────────────────────────────────────────────────
  window._cdsSetTab=function(key){
    window._cdsActiveTab=key;
    var ov=document.getElementById('cds-overlay');
    if(!ov)return;
    // update chips active
    ov.querySelectorAll('.cds-chip').forEach(function(c){
      c.classList.toggle('active',c.classList.contains('t-'+key));
    });
    // update tabs active
    ov.querySelectorAll('.cds-tab').forEach(function(c){
      c.classList.toggle('active',c.classList.contains('t-'+key));
    });
    // re-render Zone C
    var src=window._cdsSrc||{loading:true,final:0,nrr:0,upsell_sku:0,upsell_outlet:0,handover:0,gate_cap:1,gate_active:false};
    _cdsRenderZoneC(key, src);
    var body=document.getElementById('cds-body');
    if(body)body.scrollTop=0;
  };

  // ── Zone C dispatcher (stubs replaced per session) ────────────────────
  function _cdsRenderZoneC(key, src){
    var head=document.getElementById('cds-tbl-head-slot');
    var meta=document.getElementById('cds-meta-slot');
    var body=document.getElementById('cds-body');
    var total=document.getElementById('cds-total-slot');
    if(!body)return;

    var t=CDS_TABS.find(function(x){return x.key===key;})||CDS_TABS[0];

    // Column header — update class + innerHTML in place
    if(head){
      var cols=CDS_COL_DEFS[key]||CDS_COL_DEFS.p1;
      head.className='cds-tbl-head '+key+'-cols';
      head.innerHTML=cols.map(function(c){
        return'<span class="cds-th'+(c.r?' r':'')+'">'+(c.l||'')+'</span>';
      }).join('');
    }

    // Delegate to tab-specific renderer when available
    var fn=window['_cdsRender_'+key];
    if(typeof fn==='function'){
      fn(src, body, meta, total);
      return;
    }
    // Placeholder
    if(meta)meta.innerHTML='';
    body.innerHTML=_cdsTabPlaceholder(t.label);
    if(total)total.innerHTML=_cdsTotalHtml('รวม '+t.label,'—',t.valCls);
  }

  // ── Main open ──────────────────────────────────────────────────────────
  function _cdsOpen(){
    if(typeof _commBuildKamSelfState!=='function')return;
    var st=_commBuildKamSelfState();
    if(!st)return;

    // Build src (same logic as v210k buildSources)
    var nrr=Number(st.payout||0);
    var src={loading:false,nrr:nrr,upsell_sku:0,upsell_outlet:0,handover:0,gate_cap:1,gate_active:false,final:nrr};
    if(typeof bulkUpsellData!=='undefined'&&bulkUpsellData&&bulkUpsellData.loaded&&typeof _commBuildKamPayout==='function'){
      try{
        var p=_commBuildKamPayout(st.email);
        if(p){
          src.upsell_sku=Number((p.upsell_sku&&p.upsell_sku.total_comm)||0);
          src.upsell_outlet=Number((p.upsell_outlet&&p.upsell_outlet.commission)||0);
          src.handover=Number((p.handover&&p.handover.payout)||0);
          src.gate_cap=Number(p.gate_cap||1);
          src.gate_active=!!(p.gate&&p.gate.gate_active);
          src.gate=p.gate;
          src.upsell_sku_detail=p.upsell_sku;
          src.upsell_outlet_detail=p.upsell_outlet;
          src.handover_detail=p.handover;
          src.final=Math.round((nrr+src.upsell_sku+src.upsell_outlet+src.handover)*src.gate_cap);
        }
      }catch(e){ console.warn('[cds] buildSrc error',e); }
    }else if(typeof bulkUpsellData==='undefined'||!bulkUpsellData||!bulkUpsellData.loaded){
      src.loading=true;
      if(st.email&&typeof _fetchUpsellBundle==='function')_fetchUpsellBundle(st.email).catch(function(){});
    }

    window._cdsSrc=src;
    window._cdsKamSt=st;
    var activeKey=window._cdsActiveTab||'p1';

    // Build overlay + sheet HTML
    var html='<div class="cds-overlay on" id="cds-overlay" onclick="if(event.target===this)_cdsClose()">'
      +'<div class="cds-sheet">'
      +'<div class="cds-handle"><div></div></div>'
      +_cdsSummaryHtml(src, activeKey)
      +_cdsTabBarHtml(src, activeKey)
      // Zone C slots (id hooks for _cdsRenderZoneC)
      +'<div id="cds-meta-slot"></div>'
      +'<div class="cds-tbl-head" id="cds-tbl-head-slot"></div>'
      +'<div class="cds-body" id="cds-body"></div>'
      +'<div id="cds-total-slot"></div>'
      +_cdsFooterHtml(
          src.upsell_sku>0||src.upsell_outlet>0,
          '_cdsExportCSV&&_cdsExportCSV()'
        )
      +'</div></div>';

    // Inject into DOM
    var existing=document.getElementById('cds-overlay');
    if(existing)existing.remove();
    var tmp=document.createElement('div');
    tmp.innerHTML=html;
    document.body.appendChild(tmp.firstElementChild);

    // Render Zone C
    _cdsRenderZoneC(activeKey, src);

    // Animate in
    requestAnimationFrame(function(){
      var ov=document.getElementById('cds-overlay');
      if(ov)ov.classList.add('on');
    });
  }

  // ── Close ──────────────────────────────────────────────────────────────
  function _cdsClose(){
    var ov=document.getElementById('cds-overlay');
    if(!ov)return;
    ov.classList.remove('on');
    setTimeout(function(){ov.remove();},280);
  }

  // ── Wire up: replace old openCompactSheet ────────────────────────────
  window._commOpenKamSelfSheet=_cdsOpen;
  window._cdsOpen=_cdsOpen;
  window._cdsClose=_cdsClose;
  try{ _commOpenKamSelfSheet=_cdsOpen; }catch(e){}

  // Expose template helpers for later sessions
  window._cdsHtml={
    chipRow:_cdsChipRowHtml,chipRowClose:_cdsChipRowClose,
    subRow:_cdsSubRowHtml,proof:_cdsProofHtml,
    total:_cdsTotalHtml,footer:_cdsFooterHtml,
    fmt:fmt,esc:esc,tabs:CDS_TABS,colDefs:CDS_COL_DEFS
  };

})();


//////////////////////////////////////////////////////////////////////////////
// ── CDS Session 3: P1 tab renderer (สินค้าใหม่) ──────────────────────────
//////////////////////////////////////////////////////////////////////////////

window._cdsRender_p1 = function(src, body, meta, totalEl) {
  var h = window._cdsHtml;
  if (!h) return;

  // ── Config ──────────────────────────────────────────────────────────
  function cfg(k, p, d) {
    try { return typeof _commGetConfig === 'function' ? _commGetConfig(k, p, d) : d; } catch(e) { return d; }
  }
  var p1Rate    = Math.round(cfg('upsell_sku', 'p1_rate', 0.03) * 100);
  var p1MinGmv  = Number(cfg('upsell_sku', 'p1_min_gmv', 2500));
  var fmt = h.fmt;
  var esc = h.esc;

  // ── Loading state ────────────────────────────────────────────────────
  if (src.loading) {
    if (meta) meta.innerHTML = '';
    body.innerHTML = '<div class="cds-empty">กำลังโหลด upsell...</div>';
    if (totalEl) totalEl.innerHTML = h.total('รวม สินค้าใหม่', '—', 'v-amber');
    return;
  }

  var d = src.upsell_sku_detail && src.upsell_sku_detail.p1;
  var groups = (d && d.groups) ? d.groups : [];
  var totalComm = d ? Number(d.comm || 0) : 0;

  // ── Empty state ──────────────────────────────────────────────────────
  if (!groups.length) {
    if (meta) meta.innerHTML = '';
    body.innerHTML = '<div class="cds-empty">ไม่มีกลุ่มสินค้าใหม่เดือนนี้<br>'
      + '<span style="font-size:10px;opacity:.5">เงื่อนไข: GMV ≥ ฿' + p1MinGmv.toLocaleString('en-US') + ' · ไม่เคยซื้อใน 3 เดือนย้อนหลัง</span></div>';
    if (totalEl) totalEl.innerHTML = h.total('รวม สินค้าใหม่', '฿0', 'v-dim');
    return;
  }

  // ── Group by outlet ──────────────────────────────────────────────────
  var byOutlet = {};
  groups.forEach(function(g) {
    var key = g.outletId || '_all';
    if (!byOutlet[key]) byOutlet[key] = { outletId: key, accountId: g.accountId || '', items: [], totalComm: 0, totalGmv: 0 };
    byOutlet[key].items.push(g);
    byOutlet[key].totalComm += g.commission || 0;
    byOutlet[key].totalGmv  += g.total_gmv  || 0;
  });
  var outlets = Object.values(byOutlet).sort(function(a, b) { return b.totalComm - a.totalComm; });

  // ── Meta bar ─────────────────────────────────────────────────────────
  if (meta) {
    meta.innerHTML = '<div class="cds-meta">'
      + '<span class="cds-meta-text">' + outlets.length + ' outlet · ' + groups.length + ' กลุ่มสินค้า · × ' + p1Rate + '%</span>'
      + '<button class="cds-toggle-btn" id="cds-toggle-btn" onclick="_cdsToggleAll()">ขยายทั้งหมด</button>'
      + '</div>';
  }

  // ── Body rows ─────────────────────────────────────────────────────────
  var html = '';
  outlets.forEach(function(o, oi) {
    var rowId   = 'p1r' + oi;
    var oName   = typeof _pvOutletName === 'function' ? _pvOutletName(o.outletId, o.accountId) : (o.outletId || '—');
    var meta_   = o.items.length + ' กลุ่มสินค้า';

    // Accordion header
    html += h.chipRow(rowId, oName, meta_, fmt(o.totalComm), 'v-amber', oi < 3);

    // Group sub-rows
    o.items.forEach(function(g, gi) {
      var proofId = rowId + 'g' + gi;
      html += h.subRow([
        { text: g.groupKey || g.group_key || '—', cls: 'cds-outlet-name' },
        { text: fmt(g.total_gmv),  cls: 'cds-val v-muted' },
        { text: fmt(g.commission), cls: 'cds-val v-amber' }
      ], 'p1');

      // Proof card (collapsed, opened on sub-row tap)
      html += h.proof(proofId, [
        { label: 'GMV เดือนนี้',     result: fmt(g.total_gmv) },
        { label: 'เกณฑ์ขั้นต่ำ',   result: '≥ ฿' + p1MinGmv.toLocaleString('en-US'), pass: g.total_gmv >= p1MinGmv },
        { label: 'อัตราค่าคอมฯ',    result: p1Rate + '%' },
        { label: 'commission',       result: fmt(g.total_gmv) + ' × ' + p1Rate + '% = ' + fmt(g.commission), pass: true }
      ]);
    });

    html += h.chipRowClose();
  });

  body.innerHTML = html;

  // ── Wire sub-row tap → toggle proof ──────────────────────────────────
  body.querySelectorAll('.cds-sub-row.p1-cols').forEach(function(row, idx) {
    row.style.cursor = 'pointer';
    row.addEventListener('click', function() {
      var proof = row.nextElementSibling;
      if (proof && proof.classList.contains('cds-proof')) {
        proof.classList.toggle('open');
      }
    });
  });

  // ── Total bar ─────────────────────────────────────────────────────────
  if (totalEl) totalEl.innerHTML = h.total('รวม สินค้าใหม่', fmt(totalComm), 'v-amber');
};


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

// ── Commission Rulebook — v247d ──────────────────────────────────────────────
// Opens a standalone bottom sheet explaining all commission rules in plain language.
// Entry points: KAM compact sheet · TL commission sheet · Admin cockpit footer
// All numeric values read live from _commGetConfig() to stay in sync with admin config.

function openCommissionRulebook() {
  var ov = document.getElementById('comm-rulebook-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'comm-rulebook-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9100;background:rgba(5,14,28,.0);transition:background .28s;pointer-events:none';
    ov.onclick = function(e){ if(e.target===ov) closeCommissionRulebook(); };
    document.body.appendChild(ov);
  }
  function cfg(k,p,d){ try{ return typeof _commGetConfig==='function'?_commGetConfig(k,p,d):d; }catch(e){ return d; } }
  function fmtPct(n){ return Math.round(Number(n||0)*100)+'%'; }
  function fmtB(n){ var v=Number(n||0); return '฿'+v.toLocaleString('en-US'); }
  function fmtPctRaw(n){ return Number(n||0)+'%'; }

  // Read live config
  var p1Rate     = Math.round(cfg('upsell_sku','p1_rate',0.03)*100);
  var p3Rate     = Math.round(cfg('upsell_sku','p3_rate',0.03)*100);
  var p3Thresh   = Math.round((cfg('upsell_sku','p3_threshold_pct',2.00)-1)*100);
  var p1MinGmv   = fmtB(cfg('upsell_sku','p1_min_gmv',2500));
  var p3MinIncr  = fmtB(cfg('upsell_sku','p3_min_incremental',5000));
  var outRate    = Math.round(cfg('upsell_outlet','rate',0.015)*1000)/10;
  var hoT2Pct    = cfg('handover','tier2_pct',100);
  var hoT3Pct    = cfg('handover','tier3_pct',120);
  var hoT2Pay    = fmtB(cfg('handover','tier2_payout',2500));
  var hoT3Bon    = fmtB(cfg('handover','tier3_bonus',2500));
  var gT1        = cfg('gmv_gate','threshold_1',95);
  var gT2        = cfg('gmv_gate','threshold_2',90);
  var gC1        = Math.round(cfg('gmv_gate','cap_1',0.70)*100);
  var gC2        = Math.round(cfg('gmv_gate','cap_2',0.35)*100);

  function sec(title, color, rows) {
    var rowHtml = rows.map(function(r) {
      return '<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(188,215,255,.10)">'+
        '<div style="font-size:11px;font-weight:700;color:rgba(188,215,255,.70);min-width:90px;flex-shrink:0;padding-top:1px">'+r[0]+'</div>'+
        '<div style="font-size:13px;color:rgba(225,238,255,.92);line-height:1.55">'+r[1]+'</div>'+
        '</div>';
    }).join('');
    return '<div style="margin-bottom:14px">'+
      '<div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:'+color+';padding:12px 0 6px;font-family:'+"'IBM Plex Mono',monospace"+'">'+title+'</div>'+
      rowHtml+
      '</div>';
  }

  var html = [
    sec('NRR', '#4ddc97', [
      ['วัดอะไร', 'ยอด GMV ของร้านในกลุ่ม cohort (ร้านที่ซื้อเดือนที่แล้ว) เทียบกับเดือนที่แล้ว'],
      ['เดือนฐาน', 'เดือนล่าสุดในไฟล์ประวัติ (rolling MoM โดย default)'],
      ['วิธีคำนวณ', 'Daily rate ทั้งสองฝั่ง: NRR = (GMV MTD ÷ วันที่ผ่านมา) ÷ (GMV เดือนฐาน ÷ วันในเดือนฐาน)'],
      ['cohort คือ', 'outlet ที่มี GMV ในเดือนฐาน — ไม่นับ comeback, expansion ใน cohort หลัก'],
      ['Transfer In', 'ร้านที่โอนมาจาก KAM อื่นเดือนนี้ — NRR แยกแสดง ไม่นับในยอด commission'],
      ['Exclusion', 'ถ้ามี exclusion approved จะหักฐานก่อนคำนวณ NRR ด้วย daily rate เหมือนกัน']
    ]),
    sec('Expansion (สาขาใหม่)', '#00c8b0', [
      ['นิยาม', 'outlet ที่ซื้อเดือนนี้ แต่ไม่เคยปรากฏใน history ย้อนหลัง 6 เดือน (ก่อนเดือนที่แล้ว)'],
      ['ไม่ใช่ expansion', 'Comeback (เคยซื้อ→หาย→กลับมา) ไม่ได้ค่าคอมฯ'],
      ['อัตรา', outRate+'% ของ GMV ทั้งหมดของ outlet นั้น (flat rate, ไม่แบ่ง P1/P3)'],
      ['ข้อมูล', 'sense_outlets_monthly.csv (everSeen set ย้อนหลัง 6 เดือนจาก bulk_outlets)']
    ]),
    sec('P1 — กลุ่มสินค้าใหม่', '#ffe08a', [
      ['เงื่อนไข', 'outlet ที่ไม่ใช่ expansion + ไม่เคยซื้อ group_key นี้ใน 3 เดือนที่ผ่านมา (M-1, M-2, M-3)'],
      ['ระดับ', 'วัดที่ระดับ outlet × group_key (ไม่ใช่ account)'],
      ['เกณฑ์ขั้นต่ำ', 'GMV เดือนนี้ใน group_key นั้น ≥ '+p1MinGmv],
      ['อัตรา', p1Rate+'% ของ GMV รวมของ group_key นั้น (actual MTD)'],
      ['ข้อยกเว้น', 'Expansion outlets ถูก exclude ก่อน — ได้แค่ '+outRate+'% flat ผ่าน expansion']
    ]),
    sec('P3 — ยอดเติบโต', '#ffe08a', [
      ['เงื่อนไข', 'outlet ที่เคยซื้อ group_key นี้ใน 3 เดือนที่ผ่านมา + ยอดเดือนนี้โตเกิน '+p3Thresh+'% จาก max baseline'],
      ['max baseline', 'เอา GMV ของ M-1, M-2, M-3 มา normalize เป็น 30 วัน แล้วเอาค่าสูงสุด'],
      ['incremental', 'GMV existing เดือนนี้ (actual MTD) − max baseline (normalized)'],
      ['เกณฑ์ขั้นต่ำ', 'incremental ≥ '+p3MinIncr],
      ['อัตรา', p3Rate+'% ของ incremental'],
      ['MTD note', 'ฝั่ง current = actual MTD (ไม่ normalized) → ต้นเดือนมักยังไม่ผ่านเกณฑ์ ยอดจะค่อยๆ ขึ้นปลายเดือน'],
      ['ข้อยกเว้น', 'Expansion outlets ถูก exclude เช่นเดียวกับ P1']
    ]),
    sec('Handover (จาก Sales)', '#bcd7ff', [
      ['นิยาม', 'ร้านที่เพิ่งย้ายมาอยู่กับ KAM เดือนนี้ + ไม่ได้มาจาก KAM คนอื่น (มาจาก Sales/PM)'],
      ['ต่างจาก Transfer In', 'Transfer In = มาจาก KAM อื่น (มีบันทึกใน handover CSV) → ไม่ได้ค่าคอม Handover'],
      ['เดือนฐาน', 'GMV เดือนที่แล้วของร้านนั้น (ยอดสุดท้ายที่ทำกับ Sales)'],
      ['วิธีวัด', 'Retention = GMV MTD เดือนนี้ ÷ GMV เดือนฐาน × 100 (actual, ไม่ normalize)'],
      ['Tier', '≥ '+hoT2Pct+'% → '+hoT2Pay+' · ≥ '+hoT3Pct+'% → '+hoT2Pay+' + '+hoT3Bon+' bonus · < '+hoT2Pct+'% → ฿0']
    ]),
    sec('NRR Gate (KAM)', 'rgba(255,107,61,.9)', [
      ['ทำงานยังไง', 'ถ้า NRR ต่ำเกินเกณฑ์ จะ cap ค่าคอมฯ ทุกส่วน (NRR + upsell + handover) รวมกัน'],
      ['เกณฑ์', 'NRR < '+gT1+'% → ×'+gC1+'% · NRR < '+gT2+'% → ×'+gC2+'% · NRR ≥ '+gT1+'% → ×100%'],
      ['ใครโดน', 'KAM เท่านั้น — TL ไม่มี gate']
    ]),
    sec('TL NRR', '#c084fc', [
      ['วัดอะไร', 'NRR รวมของทุก account ในทีม (aggregate ทุก KAM ในทีม)'],
      ['tier', '< 98.5% = ฿0 · 98.5–99% = ฿5K · 99–100% = ฿8K · 100–102% = ฿12K · 102–103% = ฿30K · ≥103% = ฿50K'],
      ['Upsell Mult', 'NRR payout ถูก × ด้วย multiplier จาก upsell performance ของทีม (ดูด้านล่าง)']
    ]),
    sec('TL Upsell Multiplier', '#c084fc', [
      ['สูตร', 'team_upsell_pct = Σ(P1 + P3 incr ทุก KAM) ÷ Σ(baseline GMV ทุก KAM) × 100'],
      ['Tier', '< 2% = ×1.00 · 2–2.99% = ×1.20 · 3–3.99% = ×1.35 · 4–4.99% = ×1.50 · ≥5% = ×1.80'],
      ['หมายเหตุ', 'Expansion outlets ไม่นับใน upsell base ของ TL (P1+P3 ที่ existing outlets เท่านั้น)'],
      ['Final TL', 'TL final = NRR payout × multiplier (ไม่มี gate, ไม่มี expansion commission โดยตรง)']
    ])
  ].join('');

  ov.innerHTML = '<div style="position:fixed;bottom:0;left:50%;transform:translateX(-50%) translateY(100%);width:100%;max-width:440px;background:#0f1b2f;border-radius:18px 18px 0 0;max-height:82vh;overflow-y:auto;-webkit-overflow-scrolling:touch;z-index:9101;transition:transform .30s cubic-bezier(.34,1.1,.64,1)">'+
    '<div style="width:36px;height:4px;background:rgba(188,215,255,.18);border-radius:2px;margin:10px auto 0"></div>'+
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 10px;position:sticky;top:0;background:#0f1b2f;z-index:1">'+
      '<div style="font-size:15px;font-weight:900;color:#fff">กฎค่าคอมฯ ทั้งหมด</div>'+
      '<div style="display:flex;align-items:center;gap:8px">'+
        '<div style="font-size:10px;color:rgba(188,215,255,.35);font-family:'+"'IBM Plex Mono',monospace"+'">live config</div>'+
        '<button onclick="closeCommissionRulebook()" style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.45);font-size:12px;cursor:pointer;font-family:inherit">✕</button>'+
      '</div>'+
    '</div>'+
    '<div style="padding:0 18px 32px">'+html+'</div>'+
  '</div>';

  requestAnimationFrame(function(){
    ov.style.background='rgba(5,14,28,.72)';
    ov.style.pointerEvents='all';
    var sh=ov.querySelector('div');
    if(sh){ sh.style.transform='translateX(-50%) translateY(0)'; }
  });
}

function closeCommissionRulebook() {
  var ov = document.getElementById('comm-rulebook-overlay');
  if (!ov) return;
  var sh = ov.querySelector('div');
  if (sh) sh.style.transform = 'translateX(-50%) translateY(100%)';
  ov.style.background = 'rgba(5,14,28,.0)';
  ov.style.pointerEvents = 'none';
  setTimeout(function(){ if(ov.parentNode) ov.parentNode.removeChild(ov); }, 310);
}

window.openCommissionRulebook = openCommissionRulebook;
window.closeCommissionRulebook = closeCommissionRulebook;

// ── v247e: Commission History Sheet ─────────────────────────────────────────
// Opens a bottom sheet showing locked commission snapshots for past 6 months.
// All roles: KAM sees own rows, TL sees team, Admin sees all.
// Tap a locked month → reconcile detail view (NRR cohort, P1/P3, expansion, handover).

function openCommissionHistory() {
  var ov = document.getElementById('comm-history-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'comm-history-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9200;background:rgba(5,14,28,.0);transition:background .28s;pointer-events:none';
    ov.onclick = function(e){ if(e.target===ov) closeCommissionHistory(); };
    document.body.appendChild(ov);
  }

  // Loading state
  ov.innerHTML = '<div style="position:fixed;bottom:0;left:50%;transform:translateX(-50%) translateY(100%);width:100%;max-width:440px;background:#0f1b2f;border-radius:18px 18px 0 0;max-height:82vh;overflow-y:auto;-webkit-overflow-scrolling:touch;z-index:9201;transition:transform .30s cubic-bezier(.34,1.1,.64,1)">'
    + '<div style="width:36px;height:4px;background:rgba(188,215,255,.18);border-radius:2px;margin:10px auto 0"></div>'
    + '<div style="padding:14px 18px;font-size:15px;font-weight:900;color:#fff">Commission ย้อนหลัง</div>'
    + '<div style="padding:24px;text-align:center;color:rgba(188,215,255,.45);font-size:13px">กำลังโหลด...</div>'
    + '</div>';

  requestAnimationFrame(function(){
    ov.style.background='rgba(5,14,28,.75)';
    ov.style.pointerEvents='all';
    var sh=ov.querySelector('div');
    if(sh){ sh.style.transform='translateX(-50%) translateY(0)'; }
  });

  var role = getCurrentRole ? getCurrentRole() : '';
  var email = (currentUserProfile && currentUserProfile.email) || '';

  if (typeof _commLoadHistory !== 'function') {
    _commRenderHistoryList(ov, [], role, email);
    return;
  }

  _commLoadHistory(6).then(function(allRows) {
    _commRenderHistoryList(ov, allRows, role, email);
  }).catch(function() {
    _commRenderHistoryList(ov, [], role, email);
  });
}

function _commRenderHistoryList(ov, allRows, role, email) {
  function fmtPeriod(p) {
    var parts = (p||'').split('-');
    var mo = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(parts[1])-1]||parts[1];
    return mo + ' ' + (parseInt(parts[0])+543);
  }
  function money(n){ var v=Number(n||0); if(!v)return'฿0'; if(v>=1000000)return'฿'+(v/1e6).toFixed(1)+'M'; if(v>=1000)return'฿'+Math.round(v/1000)+'K'; return'฿'+Math.round(v).toLocaleString('en-US'); }

  // Scope rows to current user
  var rows = allRows || [];
  if (isRepRole(role)) {
    rows = rows.filter(function(r){ return r.beneficiary_role==='kam' && (r.beneficiary_email||'').toLowerCase()===email.toLowerCase(); });
  } else if (isTLRole(role)) {
    rows = rows.filter(function(r){ return (r.team_lead_email||'').toLowerCase()===email.toLowerCase() || (r.beneficiary_email||'').toLowerCase()===email.toLowerCase(); });
  }

  // Group by period
  var byPeriod = {};
  rows.forEach(function(r) {
    if (!byPeriod[r.period_month]) byPeriod[r.period_month] = [];
    byPeriod[r.period_month].push(r);
  });

  // Build list of last 6 months
  var now = new Date();
  var periods = [];
  for (var i = 1; i <= 6; i++) {
    var d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    periods.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'));
  }

  var listHtml = periods.map(function(p) {
    var pRows = byPeriod[p] || [];
    var hasLock = pRows.some(function(r){ return String(r.snapshot_status||'').toLowerCase()==='final'; });
    var myRow = pRows.find(function(r){ return isRepRole(role) && r.beneficiary_role==='kam'; })
              || pRows.find(function(r){ return isTLRole(role) && r.beneficiary_role==='tl'; })
              || pRows[0];
    var payout = myRow ? Number(myRow.payout_amount||0) : 0;
    var nrr = myRow ? (myRow.governed_nrr_pct!==null&&myRow.governed_nrr_pct!==undefined ? myRow.governed_nrr_pct+'%' : '—') : '—';

    if (!hasLock) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-bottom:1px solid rgba(188,215,255,.06)">'
        +'<div><div style="font-size:13px;font-weight:700;color:rgba(225,238,255,.40)">'+fmtPeriod(p)+'</div>'
        +'<div style="font-size:11px;color:rgba(225,238,255,.25);margin-top:2px">ไม่มี snapshot</div></div>'
        +'<div style="font-size:11px;color:rgba(225,238,255,.25)">—</div>'
        +'</div>';
    }

    var kamCount = isAdminRole(role) ? pRows.filter(function(r){return r.beneficiary_role==='kam';}).length : null;
    var sub = isAdminRole(role) ? (kamCount+' KAM') : ('NRR '+nrr);

    return '<div onclick="_commOpenHistoryDetail(\''+p+'\')" style="display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-bottom:1px solid rgba(188,215,255,.06);cursor:pointer;-webkit-tap-highlight-color:rgba(188,215,255,.06)" onmouseenter="this.style.background=\'rgba(188,215,255,.04)\'" onmouseleave="this.style.background=\'\'">'
      +'<div><div style="font-size:14px;font-weight:700;color:rgba(225,238,255,.88)">'+fmtPeriod(p)+'</div>'
      +'<div style="font-size:11px;color:rgba(188,215,255,.45);margin-top:2px">'+sub+' · ล็อกแล้ว</div></div>'
      +'<div style="display:flex;align-items:center;gap:8px">'
      +'<span style="font-size:14px;font-weight:900;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace">'+money(payout)+'</span>'
      +'<span style="color:rgba(188,215,255,.3);font-size:16px">›</span>'
      +'</div></div>';
  }).join('');

  // Store rows globally for detail lookup
  window._commHistoryAllRows = allRows;

  ov.innerHTML = '<div style="position:fixed;bottom:0;left:50%;transform:translateX(-50%) translateY(0);width:100%;max-width:440px;background:#0f1b2f;border-radius:18px 18px 0 0;max-height:82vh;overflow-y:auto;-webkit-overflow-scrolling:touch;z-index:9201;transition:transform .30s cubic-bezier(.34,1.1,.64,1)">'
    +'<div style="width:36px;height:4px;background:rgba(188,215,255,.18);border-radius:2px;margin:10px auto 0"></div>'
    +'<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 10px;position:sticky;top:0;background:#0f1b2f;z-index:1">'
      +'<div style="font-size:15px;font-weight:900;color:#fff">Commission ย้อนหลัง</div>'
      +'<button onclick="closeCommissionHistory()" style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.07);border:1px solid rgba(188,215,255,.14);color:rgba(225,238,255,.45);font-size:12px;cursor:pointer;font-family:inherit">✕</button>'
    +'</div>'
    +'<div style="font-size:10px;color:rgba(188,215,255,.35);padding:0 18px 10px;font-family:\'IBM Plex Mono\',monospace">6 เดือนย้อนหลัง · tap เพื่อดู reconcile</div>'
    +listHtml
    +'<div style="height:24px"></div>'
    +'</div>';
}

window._commOpenHistoryDetail = function(period) {
  var ov = document.getElementById('comm-history-overlay');
  if (!ov) return;
  var allRows = window._commHistoryAllRows || [];
  var role = getCurrentRole ? getCurrentRole() : '';
  var email = (currentUserProfile && currentUserProfile.email) || '';
  var pRows = allRows.filter(function(r){ return r.period_month===period; });

  if (isRepRole(role)) pRows = pRows.filter(function(r){ return r.beneficiary_role==='kam'&&(r.beneficiary_email||'').toLowerCase()===email.toLowerCase(); });
  else if (isTLRole(role)) pRows = pRows.filter(function(r){ return (r.team_lead_email||'').toLowerCase()===email.toLowerCase()||(r.beneficiary_email||'').toLowerCase()===email.toLowerCase(); });

  function fmtPeriod(p){ var pts=(p||'').split('-'); var mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(pts[1])-1]||pts[1]; return mo+' '+(parseInt(pts[0])+543); }
  function money(n){ var v=Number(n||0); if(!v)return'฿0'; if(v>=1e6)return'฿'+(v/1e6).toFixed(1)+'M'; if(v>=1000)return'฿'+Math.round(v/1e3)+'K'; return'฿'+Math.round(v).toLocaleString('en-US'); }
  function secLabel(s,color){ return '<div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.07em;color:'+color+';padding:12px 18px 4px;font-family:\'IBM Plex Mono\',monospace">'+s+'</div>'; }
  function kpiRow(label,val,color){ return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 18px;border-bottom:1px solid rgba(188,215,255,.06)"><span style="font-size:12px;color:rgba(225,238,255,.60)">'+label+'</span><span style="font-size:13px;font-weight:900;color:'+(color||'rgba(225,238,255,.88)')+';font-family:\'IBM Plex Mono\',monospace">'+val+'</span></div>'; }

  var myKam = pRows.find(function(r){return r.beneficiary_role==='kam';});
  var myTl  = pRows.find(function(r){return r.beneficiary_role==='tl';});
  var focusRow = myKam || myTl || pRows[0];
  if (!focusRow) { ov.querySelector('div').innerHTML += '<div style="padding:20px;text-align:center;color:rgba(188,215,255,.4)">ไม่มีข้อมูล</div>'; return; }

  var bd = focusRow.breakdown || {};
  var upsellTotal = (bd.upsell_sku ? (bd.upsell_sku.total_commission||bd.upsell_sku.total_comm||0) : 0)
                  + (bd.upsell_outlet ? (bd.upsell_outlet.commission||0) : 0);

  // NRR cohort detail for reconcile
  var cohortDetail = bd.nrr_cohort_detail || [];
  var expansionDetail = bd.expansion_detail || [];
  var p1Groups = (bd.upsell_sku&&bd.upsell_sku.p1&&bd.upsell_sku.p1.groups) ? bd.upsell_sku.p1.groups : [];
  var p3Groups = (bd.upsell_sku&&bd.upsell_sku.p3&&bd.upsell_sku.p3.groups) ? bd.upsell_sku.p3.groups : [];
  var hoDetail = bd.handover || {};

  var cohortHtml = '';
  if (cohortDetail.length) {
    cohortHtml = cohortDetail.slice(0,8).map(function(g){
      var delta = g.outlets&&g.outlets.length ? Math.round(g.outlets.reduce(function(s,o){return s+(o.currGmv||0);},0)/Math.max(1,g.outlets.reduce(function(s,o){return s+(o.prevGmv||0);},0))*100) : null;
      var dCls = delta===null?'':'';
      var dStr = delta!==null?(delta>=100?'<span style="color:#4ddc97">'+delta+'%</span>':'<span style="color:rgba(255,107,61,.9)">'+delta+'%</span>'):'';
      return '<div style="padding:7px 18px;border-bottom:1px solid rgba(188,215,255,.05);display:flex;justify-content:space-between"><span style="font-size:11px;color:rgba(225,238,255,.70)">'+(g.acctName||g.acctId)+'</span><span style="font-size:11px;font-family:\'IBM Plex Mono\',monospace">'+dStr+'</span></div>';
    }).join('');
    if (cohortDetail.length > 8) cohortHtml += '<div style="padding:7px 18px;font-size:10px;color:rgba(188,215,255,.35)">+' + (cohortDetail.length-8) + ' รายการ</div>';
  }

  var expHtml = expansionDetail.slice(0,5).map(function(o){
    return '<div style="padding:7px 18px;border-bottom:1px solid rgba(188,215,255,.05);display:flex;justify-content:space-between"><span style="font-size:11px;color:rgba(225,238,255,.70)">'+(o.outletName||o.outletId)+'</span><span style="font-size:11px;color:#00c8b0;font-family:\'IBM Plex Mono\',monospace">'+money(o.gmv)+'</span></div>';
  }).join('');

  var p1Html = p1Groups.slice(0,5).map(function(g){
    return '<div style="padding:7px 18px;border-bottom:1px solid rgba(188,215,255,.05);display:flex;justify-content:space-between"><span style="font-size:11px;color:rgba(225,238,255,.70)">'+(g.groupKey||'')+'</span><span style="font-size:11px;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace">'+money(g.commission)+'</span></div>';
  }).join('');

  var p3Html = p3Groups.slice(0,5).map(function(g){
    return '<div style="padding:7px 18px;border-bottom:1px solid rgba(188,215,255,.05);display:flex;justify-content:space-between"><span style="font-size:11px;color:rgba(225,238,255,.70)">'+(g.groupKey||'')+'</span><span style="font-size:11px;color:#ffe08a;font-family:\'IBM Plex Mono\',monospace">'+money(g.commission)+'</span></div>';
  }).join('');

  var _mxH=(window.innerHeight-80)+'px';
  var detailHtml = '<div style="width:100%;max-width:100%;max-height:'+_mxH+';height:'+_mxH+';background:#0f1b2f;border-radius:18px 18px 0 0;display:flex;flex-direction:column;overflow:hidden">'
    +'<div style="width:36px;height:4px;background:rgba(188,215,255,.18);border-radius:2px;margin:10px auto 0"></div>'
    +'<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 8px">'
      +'<div>'
        +'<div style="font-size:15px;font-weight:900;color:#fff">'+fmtPeriod(period)+'</div>'
        +'<div style="font-size:10px;color:rgba(188,215,255,.4);font-family:\'IBM Plex Mono\',monospace;margin-top:2px">LOCKED SNAPSHOT</div>'
      +'</div>'
      +'<button onclick="_commOpenHistoryList()" style="font-size:11px;color:rgba(188,215,255,.5);background:none;border:none;cursor:pointer;padding:4px 6px">‹ ย้อนหลัง</button>'
    +'</div>'
    +'<div style="overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1">'
    +secLabel('สรุป','rgba(188,215,255,.5)')
    +kpiRow('NRR', (focusRow.governed_nrr_pct!==null&&focusRow.governed_nrr_pct!==undefined?focusRow.governed_nrr_pct+'%':'—'), '#4ddc97')
    +kpiRow('NRR payout', money(bd.nrr_payout||0), '#4ddc97')
    +(upsellTotal>0?kpiRow('Upsell (P1+P3+Expansion)', money(upsellTotal), '#ffe08a'):'')
    +(hoDetail.payout?kpiRow('Handover', money(hoDetail.payout), '#bcd7ff'):'')
    +(bd.gmv_gate&&bd.gmv_gate.gate_active?kpiRow('NRR Gate', '×'+Math.round(bd.gmv_gate.cap_multiplier*100)+'%', 'rgba(255,107,61,.9)'):'')
    +kpiRow('Final payout', money(focusRow.payout_amount), '#ffe08a')
    +(cohortDetail.length?secLabel('NRR Cohort ('+cohortDetail.length+' accounts)','#4ddc97')+cohortHtml:'')
    +(expansionDetail.length?secLabel('Expansion ('+expansionDetail.length+' outlets)','#00c8b0')+expHtml:'')
    +(p1Groups.length?secLabel('P1 — กลุ่มสินค้าใหม่ ('+p1Groups.length+' items)','#ffe08a')+p1Html:'')
    +(p3Groups.length?secLabel('P3 — ยอดเติบโต ('+p3Groups.length+' items)','#ffe08a')+p3Html:'')
    +(hoDetail.accounts?secLabel('Handover','#bcd7ff')
      +kpiRow('จำนวนร้าน', hoDetail.accounts+' ร้าน')
      +kpiRow('Retention', (hoDetail.retention_pct||0)+'%')
      +kpiRow('Baseline', money(hoDetail.baseline_gmv))
      +kpiRow('MTD', money(hoDetail.current_gmv))
      :'')
    +(bd.lock_trigger?'<div style="padding:12px 18px 20px;font-size:10px;color:rgba(188,215,255,.30);font-family:\'IBM Plex Mono\',monospace">lock: '+bd.lock_trigger+' · '+(bd.csv_data_as_of?bd.csv_data_as_of.split('T')[0]:'—')+'</div>':'<div style="height:20px"></div>')
    +'</div>'
    +'</div>';

  ov.innerHTML = detailHtml;
};

window._commOpenHistoryList = function() {
  var allRows = window._commHistoryAllRows || [];
  var role = getCurrentRole ? getCurrentRole() : '';
  var email = (currentUserProfile && currentUserProfile.email) || '';
  var ov = document.getElementById('comm-history-overlay');
  if (ov) _commRenderHistoryList(ov, allRows, role, email);
};

function closeCommissionHistory() {
  var ov = document.getElementById('comm-history-overlay');
  if (!ov) return;
  var sh = ov.querySelector('div');
  if (sh) sh.style.transform = 'translateX(-50%) translateY(100%)';
  ov.style.background = 'rgba(5,14,28,.0)';
  ov.style.pointerEvents = 'none';
  setTimeout(function(){ if(ov.parentNode) ov.parentNode.removeChild(ov); }, 310);
}

window.openCommissionHistory = openCommissionHistory;
window.closeCommissionHistory = closeCommissionHistory;


console.log('[Target Module v1] loaded');
