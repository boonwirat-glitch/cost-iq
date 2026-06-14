// ── dash_echo.js — Echo session feed (Phase 6) ───────────────
// Freshket TL Dashboard v706
// Table: ci_sessions, covisit_events

// ── State ─────────────────────────────────────────────────────
let echoSessions     = [];
let echoDataReady    = false;
let echoFilter       = 'pending_review';  // 'pending_review' | 'all' | 'covisit'
let echoSelectedId   = null;
let echoDetailData   = null;

// ── Load ──────────────────────────────────────────────────────
async function loadEchoData() {
  if (!supa || !currentProfile) return;
  try {
    // Get team emails — reuse skillMembers if loaded, else derive from portview
    const teamEmails = getTeamEmails();

    let q = supa.from('ci_sessions')
      .select('id,owner_email,account_id,account_name,visited_at,duration_secs,skill_scores,tone_signals,transcript_summary,tl_reviewed_at,tl_note,covisit_verified,status')
      .order('visited_at', { ascending: false })
      .limit(120);

    if (teamEmails.length) q = q.in('owner_email', teamEmails);

    const { data, error } = await q;
    if (error) throw error;

    // Dedupe (same logic as Sense)
    echoSessions = (data || []).filter((s, i, arr) =>
      !arr.slice(0,i).some(prev =>
        prev.owner_email === s.owner_email &&
        (prev.account_id||prev.account_name) === (s.account_id||s.account_name) &&
        prev.duration_secs === s.duration_secs &&
        Math.abs(new Date(prev.visited_at)-new Date(s.visited_at)) < 60000
      )
    );
    echoDataReady = true;
  } catch(e) {
    console.warn('[Echo]', e.message);
    echoDataReady = true;
  }
  if (currentView === 'echo') renderEchoView();
}

function getTeamEmails() {
  // 1. Use skillMembers if available (Phase 5 data)
  if (skillMembers?.length) return skillMembers.map(m => m.email).filter(Boolean);
  // 2. Derive from portviewBulkData (same as Sense _getTeamEmails)
  const tlEmail = (currentProfile?.email||'').toLowerCase();
  const emails = new Set();
  (portviewBulkData||[]).forEach(r => {
    if (r.tlEmail?.toLowerCase()===tlEmail && r.kamEmail)
      emails.add(r.kamEmail.toLowerCase());
  });
  return [...emails];
}

// ── Format helpers ────────────────────────────────────────────
function fmtDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs/60), s = secs%60;
  return m > 0 ? `${m}:${String(s).padStart(2,'0')}` : `${s}s`;
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('th-TH',{day:'numeric',month:'short'});
}
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
}

// ── Filters ───────────────────────────────────────────────────
function getFilteredSessions() {
  switch (echoFilter) {
    case 'pending_review': return echoSessions.filter(s => !s.tl_reviewed_at);
    case 'covisit':        return echoSessions.filter(s => s.covisit_verified);
    default:               return echoSessions;
  }
}

// ── Render view ───────────────────────────────────────────────
function renderEchoView() {
  const el = document.getElementById('echo-content');
  if (!el) return;

  if (!echoDataReady) {
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;max-width:560px">
      ${[1,2,3,4,5].map(()=>`<div class="ds-skel" style="height:80px;border-radius:var(--r-md)"></div>`).join('')}
    </div>`;
    return;
  }

  const all      = echoSessions.length;
  const pending  = echoSessions.filter(s => !s.tl_reviewed_at).length;
  const covisits = echoSessions.filter(s => s.covisit_verified).length;

  const tabs = [
    { key:'pending_review', label:`รอรีวิว (${pending})` },
    { key:'all',            label:`ทั้งหมด (${all})` },
    { key:'covisit',        label:`Co-visit (${covisits})` },
  ];

  const tabsHtml = `<div class="td-skills-tabs">
    ${tabs.map(t =>
      `<button class="td-skills-tab${echoFilter===t.key?' active':''}"
        onclick="setEchoFilter('${t.key}')">${t.label}</button>`
    ).join('')}
  </div>`;

  const sessions = getFilteredSessions();

  const feedHtml = sessions.length
    ? `<div class="td-echo-feed">${sessions.map(renderEchoCard).join('')}</div>`
    : `<div class="ds-empty" style="padding:var(--space-10) 0">
        <svg class="ds-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="9" y="2" width="6" height="11" rx="3"/>
          <path d="M5 10a7 7 0 0014 0M12 19v3M9 22h6"/>
        </svg>
        <div class="ds-empty-title">ไม่มี session ที่ตรงกับ filter</div>
      </div>`;

  el.innerHTML = `<div style="max-width:680px">${tabsHtml}${feedHtml}</div>`;
}

function setEchoFilter(f) {
  echoFilter = f;
  renderEchoView();
}

// ── Session card ──────────────────────────────────────────────
function renderEchoCard(s) {
  const repName   = s.owner_email ? s.owner_email.split('@')[0] : '—';
  const initials  = repName.slice(0,2).toUpperCase();
  const date      = fmtDate(s.visited_at);
  const dur       = fmtDuration(s.duration_secs);
  const reviewed  = !!s.tl_reviewed_at;
  const isSelected = s.id === echoSelectedId;

  // Skill dots
  const skills = s.skill_scores?.skills || [];
  const dots = skills.slice(0,8).map(sk => {
    const sc = sk.tl_override || sk.score;
    const cls = sc==='pass'?'ok':sc==='developing'?'warn':'neutral';
    return `<span class="td-echo-dot ${cls}"></span>`;
  }).join('');

  // Tone badge
  let toneBadge = '';
  if (s.tone_signals?.rep_confidence) {
    const c = s.tone_signals.rep_confidence;
    const cls = c==='high'?'ok':c==='medium'?'warn':'danger';
    const lbl = c==='high'?'Confident':c==='medium'?'Steady':'Hesitant';
    toneBadge = `<span class="ds-badge ds-badge-${cls}">${lbl}</span>`;
  }

  // Status badge
  const statusBadge = reviewed
    ? `<span class="ds-badge ds-badge-ok">รีวิวแล้ว</span>`
    : `<span class="ds-badge ds-badge-warn">รอรีวิว</span>`;

  // Co-visit badge
  const cvBadge = s.covisit_verified
    ? `<span class="ds-badge ds-badge-ok">Co-visit ✓</span>` : '';

  // TL note preview
  const noteHtml = s.tl_note
    ? `<div class="td-echo-note">${s.tl_note.length>80?s.tl_note.slice(0,80)+'…':s.tl_note}</div>` : '';

  // Transcript summary preview
  const summaryHtml = (!s.tl_note && s.transcript_summary)
    ? `<div class="td-echo-summary">${s.transcript_summary.slice(0,100)}${s.transcript_summary.length>100?'…':''}</div>` : '';

  return `
    <div class="td-echo-card${isSelected?' selected':''}" onclick="openEchoDetail('${s.id}')">
      <div class="td-echo-card-top">
        <div class="td-echo-card-left">
          <div class="ds-avatar sm">${initials}</div>
          <div>
            <div class="td-echo-rep">${repName}</div>
            <div class="td-echo-acct">${s.account_name || '—'}</div>
          </div>
        </div>
        <div class="td-echo-card-right">
          <div class="td-echo-meta">${date}${dur?' · '+dur:''}</div>
        </div>
      </div>
      <div class="td-echo-badges">
        <div class="td-echo-dots">${dots}</div>
        ${toneBadge}${cvBadge}${statusBadge}
      </div>
      ${noteHtml}${summaryHtml}
    </div>`;
}

// ── Session detail (right panel) ─────────────────────────────
async function openEchoDetail(sessionId) {
  if (echoSelectedId === sessionId) {
    echoSelectedId = null;
    closeDetail();
    renderEchoView();
    return;
  }
  echoSelectedId = sessionId;
  renderEchoView();  // re-render to show selected state

  // Fetch full session
  try {
    const { data, error } = await supa.from('ci_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    if (error) throw error;
    echoDetailData = data;
    openDetail(renderEchoDetailPanel(data));
  } catch(e) {
    console.warn('[Echo detail]', e.message);
  }
}

function renderEchoDetailPanel(s) {
  const repName = s.owner_email ? s.owner_email.split('@')[0] : '—';
  const dur     = fmtDuration(s.duration_secs);
  const dt      = fmtDateTime(s.visited_at);
  const reviewed = !!s.tl_reviewed_at;

  // Skill scores table
  const skills = s.skill_scores?.skills || [];
  const skillRows = skills.map(sk => {
    const score = sk.tl_override || sk.score;
    const cls   = score==='pass'?'ok':score==='developing'?'warn':score==='miss'?'danger':'neutral';
    return `<div class="ds-stat-row" style="align-items:center">
      <span class="ds-stat-label" style="flex:1">${sk.skill_name||sk.skill_code||'—'}</span>
      <span class="ds-badge ds-badge-${cls}">${score||'—'}</span>
    </div>`;
  }).join('') || `<div style="font-size:var(--text-xs);color:var(--ink-4);padding:var(--space-2) 0">ยังไม่มีข้อมูล skill</div>`;

  // Tone signals
  const tone = s.tone_signals || {};
  const toneRows = Object.entries({
    'Confidence': tone.rep_confidence,
    'Clarity':    tone.rep_clarity,
    'Energy':     tone.rep_energy,
  }).filter(([,v])=>v).map(([k,v]) => {
    const cls = v==='high'?'ok':v==='medium'?'warn':'danger';
    return `<div class="ds-stat-row">
      <span class="ds-stat-label">${k}</span>
      <span class="ds-badge ds-badge-${cls}">${v}</span>
    </div>`;
  }).join('');

  // Next actions
  const actions = (s.next_actions||[]).slice(0,3).map(a =>
    `<div style="font-size:var(--text-xs);color:var(--ink-2);padding:var(--space-1) 0;border-bottom:1px solid var(--hair);line-height:1.5">
      <span style="color:var(--ac);margin-right:4px">→</span>${a}
    </div>`
  ).join('');

  // TL note section
  const noteSection = `
    <div class="td-detail-section">
      <div class="ds-eyebrow" style="margin-bottom:var(--space-2)">TL Note</div>
      <textarea id="echo-note-input" class="td-echo-note-input"
        placeholder="เพิ่ม coaching note...">${s.tl_note||''}</textarea>
      <div style="display:flex;gap:var(--space-2);margin-top:var(--space-2)">
        <button class="ds-btn ds-btn-primary" style="height:32px;font-size:var(--text-xs)"
          onclick="saveEchoNote('${s.id}')">บันทึก Note</button>
        ${!reviewed
          ? `<button class="ds-btn ds-btn-secondary" style="height:32px;font-size:var(--text-xs)"
              onclick="markEchoReviewed('${s.id}')">Mark รีวิวแล้ว</button>`
          : `<span style="font-size:var(--text-micro);color:var(--ink-4);padding:var(--space-2) 0;display:flex;align-items:center">
              รีวิวแล้ว ${fmtDateTime(s.tl_reviewed_at)}</span>`
        }
      </div>
    </div>`;

  return `
    <div class="td-detail-hd">
      <div class="ds-eyebrow">ECHO SESSION</div>
      <div class="td-detail-title">${repName}</div>
      <div class="td-detail-sub">${s.account_name||'—'} · ${dt}${dur?' · '+dur:''}</div>
    </div>
    <div class="td-detail-body">

      ${s.transcript_summary ? `
        <div class="td-detail-section">
          <div class="ds-eyebrow" style="margin-bottom:var(--space-2)">Summary</div>
          <div style="font-size:var(--text-sm);color:var(--ink-2);line-height:1.6">${s.transcript_summary}</div>
        </div>` : ''}

      ${skills.length ? `
        <div class="td-detail-section">
          <div class="ds-eyebrow" style="margin-bottom:var(--space-2)">Skill Scores</div>
          ${skillRows}
        </div>` : ''}

      ${toneRows ? `
        <div class="td-detail-section">
          <div class="ds-eyebrow" style="margin-bottom:var(--space-2)">Tone</div>
          ${toneRows}
        </div>` : ''}

      ${actions ? `
        <div class="td-detail-section">
          <div class="ds-eyebrow" style="margin-bottom:var(--space-2)">Next Actions</div>
          ${actions}
        </div>` : ''}

      ${noteSection}
    </div>`;
}

// ── TL actions ────────────────────────────────────────────────
async function saveEchoNote(sessionId) {
  const note = document.getElementById('echo-note-input')?.value || '';
  try {
    const { error } = await supa.from('ci_sessions')
      .update({ tl_note: note || null })
      .eq('id', sessionId);
    if (error) throw error;
    // Update local cache
    const s = echoSessions.find(s => s.id === sessionId);
    if (s) s.tl_note = note || null;
    if (echoDetailData?.id === sessionId) echoDetailData.tl_note = note || null;
    showToast('บันทึก note แล้ว', 'ok');
    renderEchoView();
  } catch(e) {
    showToast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}

async function markEchoReviewed(sessionId) {
  const now = new Date().toISOString();
  try {
    const { error } = await supa.from('ci_sessions')
      .update({ tl_reviewed_at: now, tl_reviewed_by: currentProfile?.email || null })
      .eq('id', sessionId);
    if (error) throw error;
    const s = echoSessions.find(s => s.id === sessionId);
    if (s) { s.tl_reviewed_at = now; }
    showToast('Mark รีวิวแล้ว', 'ok');
    // Re-fetch detail and re-render
    if (echoDetailData?.id === sessionId) {
      echoDetailData.tl_reviewed_at = now;
      openDetail(renderEchoDetailPanel(echoDetailData));
    }
    renderEchoView();
  } catch(e) {
    showToast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}
