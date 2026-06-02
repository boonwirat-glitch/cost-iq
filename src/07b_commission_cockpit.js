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
        retention = (perf_gmv ÷ days_perf) ÷ (baseline_gmv ÷ days_baseline) × 100 · Sales→KAM เท่านั้น · วัดเดือน M+1 หลังโอน · Tier 1 &lt;${cfg('handover','tier2_pct',100)}% = ฿0 · Tier 2 ≥${cfg('handover','tier2_pct',100)}% = ฿${Number(cfg('handover','tier2_payout',2500)).toLocaleString('en-US')} · Tier 3 ≥${cfg('handover','tier3_pct',120)}% = ฿${Number(cfg('handover','tier2_payout',2500)+cfg('handover','tier3_bonus',2500)).toLocaleString('en-US')} รวม
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
      <div class="tgt-lock-actions"><button class="tgt-lock-btn secondary" onclick="exportCommissionSnapshotCsv()">Export CSV</button><button class="tgt-lock-btn outline" onclick="computeCommissionDraft()">Compute</button><button class="tgt-lock-btn primary" onclick="lockCommissionSnapshot()">Lock snapshot</button></div>
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(188,215,255,.95)" stroke-width="2.3" stroke-linecap="round"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
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
            <td class="tgt-snap-mono">${r.governed_nrr_pct !== null && r.governed_nrr_pct !== undefined ? r.governed_nrr_pct + '%' : '—'}</td>
            <td class="tgt-snap-mono">${_commFmtPayout(r.payout_amount)}</td>
            <td><span class="tgt-snap-status ${r.snapshot_status||''}">${r.snapshot_status==='final'?'🔒':'Draft'}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `<div class="tgt-lock-empty">กด Compute เพื่อสร้าง snapshot</div>`}
    <div class="tgt-rule-note">Compute = บันทึก draft · Lock = confirm final · Export ดึงจาก stored rows ไม่ recompute</div>
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
