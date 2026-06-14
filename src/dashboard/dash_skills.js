// ── dash_skills.js — Skills dashboard (Phase 5) ──────────────
// Freshket TL Dashboard v705
// Tables: skill_definitions, user_skill_progress, echo_skill_observations, profiles

// ── State ─────────────────────────────────────────────────────
let skillDefs     = [];   // skill_definitions rows
let skillProg     = {};   // 'userId:skillId' → progress row
let skillEchoObs  = {};   // 'userId:skill_code' → obs[]
let skillMembers  = [];   // { id, email, full_name, role } squad members
let skillDataReady = false;
let skillView     = 'pending';   // 'pending' | 'matrix' | 'echo'

// ── Load ──────────────────────────────────────────────────────
async function loadSkillsData() {
  if (!supa || !currentProfile) return;
  const tlEmail = currentProfile.email;

  try {
    // 1. Squad members from profiles
    const { data: tlRow } = await supa
      .from('profiles')
      .select('squad, sale_team')
      .eq('email', tlEmail)
      .single();

    const squadName = tlRow?.squad || tlRow?.sale_team || null;
    if (squadName) {
      const { data: members } = await supa
        .from('profiles')
        .select('id, email, full_name, role')
        .eq('squad', squadName)
        .in('role', ['sales','rep','tl','sales_tl','ad','ad_tl']);
      skillMembers = (members || []).filter(m => m.email !== tlEmail);
    }

    // 2. Skill definitions
    const { data: defs } = await supa
      .from('skill_definitions')
      .select('id, skill_code, skill_name_en, skill_name_th, sort_order, gate_level')
      .order('sort_order', { ascending: true });
    skillDefs = defs || [];

    // 3. Progress for all squad members
    const memberEmails = skillMembers.map(m => m.email);
    if (memberEmails.length) {
      const { data: prog } = await supa
        .from('user_skill_progress')
        .select('id, user_id, skill_id, state, owner_email, tl_note, updated_at')
        .in('owner_email', memberEmails);
      skillProg = {};
      (prog || []).forEach(p => {
        const key = `${p.user_id}:${p.skill_id}`;
        skillProg[key] = p;
      });
    }

    // 4. Echo observations for squad
    const memberIds = skillMembers.map(m => m.id).filter(Boolean);
    if (memberIds.length) {
      const { data: obs } = await supa
        .from('echo_skill_observations')
        .select('id, user_id, skill_code, ai_score, evidence, observed_at, session_id')
        .in('user_id', memberIds)
        .order('observed_at', { ascending: false })
        .limit(500);
      skillEchoObs = {};
      (obs || []).forEach(o => {
        const key = `${o.user_id}:${o.skill_code}`;
        if (!skillEchoObs[key]) skillEchoObs[key] = [];
        skillEchoObs[key].push(o);
      });
    }

    skillDataReady = true;
  } catch(e) {
    console.warn('[Skills]', e.message);
    skillDataReady = true;
  }

  if (currentView === 'skills') renderSkillsView();
}

// ── Helpers ───────────────────────────────────────────────────
function getMemberName(member) {
  return member.full_name || member.email?.split('@')[0] || '—';
}
function getMemberInitials(member) {
  const name = getMemberName(member);
  return name.charAt(0).toUpperCase();
}
function getMemberProgress(memberId) {
  return Object.values(skillProg).filter(p => p.user_id === memberId);
}
function getSkillState(memberId, skillId) {
  return skillProg[`${memberId}:${skillId}`]?.state || 'locked';
}
function getLatestEcho(memberId, skillCode) {
  return (skillEchoObs[`${memberId}:${skillCode}`] || [])[0] || null;
}
function scoreCls(score) {
  if (score === 'pass')       return 'ok';
  if (score === 'developing') return 'warn';
  if (score === 'miss')       return 'danger';
  return 'neutral';
}
function scoreLabel(score) {
  if (score === 'pass')       return 'Pass';
  if (score === 'developing') return 'Developing';
  if (score === 'miss')       return 'Miss';
  return score || '—';
}
function stateCls(state) {
  if (state === 'unlocked' || state === 'mastered') return 'ok';
  if (state === 'training') return 'warn';
  return 'neutral';
}
function stateLabel(state) {
  if (state === 'unlocked' || state === 'mastered') return 'Pass';
  if (state === 'training') return 'Training';
  return 'Locked';
}

// ── Render ────────────────────────────────────────────────────
function renderSkillsView() {
  const el = document.getElementById('skills-content');
  if (!el) return;

  if (!skillDataReady) {
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;max-width:400px">
      ${[80,60,70,55,65].map(w =>
        `<div class="ds-skel" style="height:44px;border-radius:var(--r-md)"></div>`
      ).join('')}
    </div>`;
    return;
  }

  // Sub-nav tabs
  const tabs = [
    { key:'pending', label:`รอประเมิน${pendingCount()>0?` (${pendingCount()})`:''}`},
    { key:'matrix',  label:'ภาพรวมทีม' },
    { key:'echo',    label:'Echo สัปดาห์นี้' },
  ];
  const tabsHtml = `<div class="td-skills-tabs">
    ${tabs.map(t =>
      `<button class="td-skills-tab${skillView===t.key?' active':''}"
        onclick="setSkillView('${t.key}')">${t.label}</button>`
    ).join('')}
  </div>`;

  let body = '';
  if (skillView === 'pending')  body = renderSkillsPending();
  if (skillView === 'matrix')   body = renderSkillsMatrix();
  if (skillView === 'echo')     body = renderSkillsEcho();

  el.innerHTML = `<div style="max-width:780px">${tabsHtml}${body}</div>`;
}

function setSkillView(v) {
  skillView = v;
  renderSkillsView();
}

function pendingCount() {
  return Object.values(skillProg).filter(p => p.state === 'training').length;
}

// ── Tab: Pending evaluations ──────────────────────────────────
function renderSkillsPending() {
  const pending = Object.values(skillProg)
    .filter(p => p.state === 'training')
    .sort((a,b) => new Date(a.updated_at||0) - new Date(b.updated_at||0));

  if (!pending.length) return `
    <div class="ds-empty" style="padding:var(--space-10) 0">
      <svg class="ds-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>
      </svg>
      <div class="ds-empty-title">ไม่มีรายการรอประเมิน</div>
      <div class="ds-empty-desc">ทุก rep อยู่ใน state ปัจจุบันแล้ว</div>
    </div>`;

  const rows = pending.map(p => {
    const def    = skillDefs.find(d => d.id === p.skill_id);
    if (!def) return '';
    const member = skillMembers.find(m => m.id === p.user_id);
    if (!member) return '';

    const daysAgo = p.updated_at
      ? Math.floor((Date.now() - new Date(p.updated_at)) / 86400000) : null;
    const dateLabel = daysAgo === null ? '' : daysAgo === 0 ? 'วันนี้' : `${daysAgo} วันที่แล้ว`;

    // Latest echo evidence
    const echo = getLatestEcho(p.user_id, def.skill_code);
    const echoHtml = echo ? `
      <div class="td-skill-echo-strip">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--${scoreCls(echo.ai_score)})" stroke-width="2">
          <rect x="9" y="2" width="6" height="11" rx="3"/>
          <path d="M5 10a7 7 0 0014 0M12 19v3M9 22h6"/>
        </svg>
        <span class="td-skill-echo-score" style="color:var(--${scoreCls(echo.ai_score)})">${scoreLabel(echo.ai_score)}</span>
        <span class="td-skill-echo-date">${new Date(echo.observed_at).toLocaleDateString('th-TH',{day:'numeric',month:'short'})}</span>
        ${echo.evidence ? `<span class="td-skill-echo-ev">${echo.evidence.slice(0,72)}${echo.evidence.length>72?'…':''}</span>` : ''}
      </div>` : '';

    const gateLabel = def.gate_level ? `Gate ${def.gate_level}` : '';

    return `
      <div class="td-skill-pend-row">
        <div class="ds-avatar md">${getMemberInitials(member)}</div>
        <div class="td-skill-pend-body">
          <div class="td-skill-pend-name">${getMemberName(member)}</div>
          <div class="td-skill-pend-skill">
            ${def.skill_name_en}
            ${gateLabel ? `<span class="td-skill-gate">${gateLabel}</span>` : ''}
          </div>
          <div class="td-skill-pend-date">self-marked · ${dateLabel}</div>
          ${echoHtml}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
          <span class="ds-pill ds-pill-warn">Training</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" stroke-width="1.5">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </div>
      </div>`;
  }).join('');

  return `
    <div style="margin-bottom:var(--space-2)">
      <span class="ds-eyebrow">${pending.length} รายการ · เรียงตามรอนานสุด</span>
    </div>
    <div style="border-radius:var(--r-md);border:1px solid var(--hair);overflow:hidden">
      ${rows}
    </div>`;
}

// ── Tab: Team matrix ──────────────────────────────────────────
function renderSkillsMatrix() {
  if (!skillMembers.length || !skillDefs.length) {
    return `<div class="ds-empty"><div class="ds-empty-title">ยังไม่มีข้อมูล</div></div>`;
  }

  // Rep rows
  const memberRows = skillMembers.map(member => {
    const prog = getMemberProgress(member.id);
    const total    = skillDefs.length;
    const unlocked = prog.filter(p => p.state==='unlocked'||p.state==='mastered').length;
    const training = prog.filter(p => p.state==='training').length;
    const pct = total > 0 ? Math.round(unlocked/total*100) : 0;

    // Skill dots
    const dots = skillDefs.map(def => {
      const state = getSkillState(member.id, def.id);
      const echo  = getLatestEcho(member.id, def.skill_code);
      const dotCls = state==='unlocked'||state==='mastered' ? 'pass'
                   : state==='training' ? 'train' : 'lock';
      const echoDot = echo ? `<div class="td-skill-echo-dot ${scoreCls(echo.ai_score)}"></div>` : '';
      return `<div class="td-skill-matrix-cell" title="${def.skill_name_en} · ${stateLabel(state)}">
        <div class="td-skill-matrix-dot ${dotCls}">${echoDot}</div>
      </div>`;
    }).join('');

    const barPct = pct;
    return `
      <div class="td-skill-matrix-row">
        <div class="td-skill-matrix-rep">
          <div class="ds-avatar sm">${getMemberInitials(member)}</div>
          <div>
            <div style="font-size:var(--text-sm);font-weight:600;color:var(--ink-1)">${getMemberName(member)}</div>
            <div style="font-size:var(--text-micro);color:var(--ink-4);font-family:var(--font-mono)">${unlocked}/${total} · ${training > 0 ? training+' pending':''}  </div>
          </div>
        </div>
        <div class="td-skill-matrix-dots">${dots}</div>
        <div class="td-skill-matrix-bar">
          <div class="ds-bar-track" style="width:80px">
            <div class="ds-bar-fill ${pct>=80?'ok':pct>=50?'warn':'danger'}" style="width:${barPct}%"></div>
          </div>
          <span style="font-family:var(--font-mono);font-size:var(--text-micro);color:var(--ink-3);margin-left:6px">${pct}%</span>
        </div>
      </div>`;
  }).join('');

  // Skill headers
  const headers = skillDefs.map(def =>
    `<div class="td-skill-matrix-hd" title="${def.skill_name_en}">
      ${def.skill_code.split('_')[0]}
    </div>`
  ).join('');

  return `
    <div class="td-skill-matrix-wrap">
      <div class="td-skill-matrix-header">
        <div style="min-width:200px;flex-shrink:0"></div>
        <div class="td-skill-matrix-dots-hd">${headers}</div>
        <div style="width:120px;flex-shrink:0"></div>
      </div>
      ${memberRows}
    </div>
    <div style="margin-top:var(--space-4);display:flex;gap:var(--space-4);font-size:var(--text-xs);color:var(--ink-3)">
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--ok);margin-right:4px;vertical-align:middle"></span>Pass</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--warn);margin-right:4px;vertical-align:middle"></span>Training</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--hair-3);margin-right:4px;vertical-align:middle"></span>Locked</span>
    </div>`;
}

// ── Tab: Echo this week ───────────────────────────────────────
function renderSkillsEcho() {
  const weekAgo = Date.now() - 7 * 86400000;
  const recentObs = Object.entries(skillEchoObs)
    .flatMap(([key, obs]) => obs.map(o => ({ ...o, _key: key })))
    .filter(o => new Date(o.observed_at) >= weekAgo)
    .sort((a,b) => new Date(b.observed_at) - new Date(a.observed_at))
    .slice(0, 30);

  if (!recentObs.length) return `
    <div class="ds-empty" style="padding:var(--space-10) 0">
      <svg class="ds-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="9" y="2" width="6" height="11" rx="3"/>
        <path d="M5 10a7 7 0 0014 0M12 19v3M9 22h6"/>
      </svg>
      <div class="ds-empty-title">ไม่มี Echo session สัปดาห์นี้</div>
      <div class="ds-empty-desc">Echo observations จะปรากฏที่นี่ภายใน 7 วัน</div>
    </div>`;

  const rows = recentObs.map(o => {
    const member = skillMembers.find(m => m.id === o.user_id);
    const def    = skillDefs.find(d => d.skill_code === o.skill_code);
    const cls    = scoreCls(o.ai_score);
    const dt     = new Date(o.observed_at).toLocaleDateString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

    return `
      <div style="display:flex;align-items:flex-start;gap:var(--space-3);padding:var(--space-3) 0;border-bottom:1px solid var(--hair)">
        <div class="ds-avatar sm" style="margin-top:2px">${member ? getMemberInitials(member) : '?'}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:2px">
            <span style="font-size:var(--text-sm);font-weight:600;color:var(--ink-1)">${member ? getMemberName(member) : o.user_id}</span>
            <span class="ds-badge ds-badge-${cls === 'ok'?'ok':cls==='warn'?'warn':cls==='danger'?'danger':'neutral'}">${scoreLabel(o.ai_score)}</span>
          </div>
          <div style="font-size:var(--text-xs);color:var(--ink-3)">${def?.skill_name_en || o.skill_code} · ${dt}</div>
          ${o.evidence ? `<div style="font-size:var(--text-xs);color:var(--ink-2);margin-top:3px;line-height:1.5">${o.evidence.slice(0,120)}${o.evidence.length>120?'…':''}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  return `
    <div style="margin-bottom:var(--space-2)">
      <span class="ds-eyebrow">${recentObs.length} observations · 7 วันล่าสุด</span>
    </div>
    ${rows}`;
}
