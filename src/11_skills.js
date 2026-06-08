// ══════════════════════════════════════════════════════════════
// 11_skills.js — Skills Feature
// Freshket Sense · Sales + KAM (future)
// State machine: locked → training (rep) → unlocked → mastered (TL)
// ══════════════════════════════════════════════════════════════

'use strict';

// ── Constants ──────────────────────────────────────────────
const SKILLS_SUPABASE_URL = 'https://menslbnyyvpxiyvjywcm.supabase.co';
const SKILLS_TABLE_DEFS   = 'skill_definitions';
const SKILLS_TABLE_PROG   = 'user_skill_progress';
const SKILLS_TABLE_LOG    = 'skill_eval_log';

const SKILL_STATES = ['locked','training','unlocked','mastered'];

const SKILL_STATE_LABEL_TH = {
  locked:   'ล็อคอยู่',
  training: 'กำลังฝึก',
  unlocked: 'ปลดล็อคแล้ว',
  mastered: 'เชี่ยวชาญ',
};

const MODULE_META = {
  A: { name:'The Navigator',    sub:'Foundation & Way of Work', color:'#FF385C' },
  B: { name:'The Scout',        sub:'Preparation',              color:'#34C759' },
  C: { name:'The Consultant',   sub:'Pitch',                    color:'#8B5CF6' },
  D: { name:'The Growth Partner', sub:'Account Development',    color:'#FF9500' },
};

// Module image placeholders (gradient bg per character identity)
const MODULE_BG = {
  A: 'linear-gradient(160deg,#FFD6E0 0%,#FFECD2 100%)',
  B: 'linear-gradient(160deg,#D4EDDA 0%,#F0F7DA 100%)',
  C: 'linear-gradient(160deg,#E8D5F5 0%,#D6E4F5 100%)',
  D: 'linear-gradient(160deg,#FFE8CC 0%,#FFF3CC 100%)',
};


// ── Image render helpers ───────────────────────────────────
// card_image_url / module_banner_url จาก skill_definitions → prepend R2 base
// ถ้า null → fallback gradient (MODULE_BG)

const SK_R2 = (window.FreshketSenseConfig&&window.FreshketSenseConfig.data&&window.FreshketSenseConfig.data.r2Base)||'https://pub-12078d17646340808024e8cc95504995.r2.dev';
function _skUrl(p){if(!p)return'';if(p.startsWith('http'))return p;return SK_R2+p;}

function _skImgTag(def, opts = {}) {
  const w   = opts.w   || '100%';
  const h   = opts.h   || '106px';
  const cls = opts.cls || 'sk-card-img';
  const url = _skUrl(def && def.card_image_url);
  if (url) {
    return `<img src="${url}" class="${cls} sk-img-lazy" style="width:${w};height:${h};object-fit:cover;object-position:center top;display:block;" alt="${def.skill_name_en||''}" onload="this.classList.add('sk-img-loaded')" onerror="this.classList.add('sk-img-loaded')">`;
  }
  // fallback: gradient placeholder
  const bg = MODULE_BG[def ? def.module : 'A'];
  const code = def ? def.skill_code.split('_')[0] : '';
  return `<div class="${cls}" style="width:${w};height:${h};background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
    <span style="font-size:10px;font-weight:600;font-family:'Noto Sans Thai',sans-serif;opacity:.3;">${code}</span>
  </div>`;
}

// Module thumb (50×50) — ใช้รูปจาก def แรกของ module นั้น (Navigator/Scout/etc.)
function _skModThumb(module) {
  const firstDef = _skillDefs.find(d => d.module === module);
  return _skImgTag(firstDef, { w: '64px', h: '64px', cls: 'sk-mod-thumb-img' });
}

// ── Module-level state ─────────────────────────────────────
let _skillDefs    = [];        // skill_definitions rows
let _skillProg    = {};        // { skill_id: progress_row }
let _skillsUserId = null;      // current auth user id
let _skillsRole   = null;      // 'sales' | 'sales_tl' | 'kam' | 'tl' | 'admin'
let _activeSkillId = null;
let _skillUsers   = {};        // { user_id: { full_name, kam_name, email } }     // currently open skill sheet
let _skillViewMode = 'pending';  // TL: 'pending' | 'overview'
let _ovToggle     = 'rep';     // TL overview: 'rep' | 'skill'

// ── Supabase helper ────────────────────────────────────────

// ── JWT helper — ดึง access token จาก Supabase session ───
function _skGetJWT() {
  try {
    // ใช้ supa client จาก 01_core.js ถ้ามี
    if (typeof supa !== 'undefined' && supa.auth) {
      const session = supa.auth.session ? supa.auth.session() : null;
      if (session && session.access_token) return session.access_token;
    }
    // fallback: อ่านจาก localStorage โดยตรง
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
    if (key) {
      const sess = JSON.parse(localStorage.getItem(key));
      return sess?.access_token || null;
    }
  } catch(_) {}
  return null;
}
async function _skFetch(path, opts = {}) {
  // ใช้ SUPA_KEY และ SUPA_URL จาก 01_core.js (โหลดก่อน 11_skills.js เสมอ)
  const key = (typeof SUPA_KEY !== 'undefined' && SUPA_KEY) ||
              (window.FreshketSenseConfig && window.FreshketSenseConfig.supabase &&
               (window.FreshketSenseConfig.supabase.publishableKey || window.FreshketSenseConfig.supabase.anonKey)) || '';
  const baseUrl = (typeof SUPA_URL !== 'undefined' && SUPA_URL) || SKILLS_SUPABASE_URL;
  const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: {
      'apikey':        key,
      'Authorization': `Bearer ${_skGetJWT() || key}`,
      'Content-Type':  'application/json',
      'Prefer':        opts.prefer || 'return=representation',
      ...opts.headers,
    },
    method: opts.method || 'GET',
    body:   opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Skills API ${res.status}: ${txt}`);
  }
  // handle empty body safely — ทุก status
  const txt = await res.text();
  if (!txt || txt.trim() === '') return null;
  try { return JSON.parse(txt); } catch(_) { return null; }
}

// ── Initialise ─────────────────────────────────────────────
async function skillsInit() {
  const role = typeof getCurrentRole === 'function' ? getCurrentRole() : null;
  _skillsRole = role;

  // get current user id from Supabase session
  const sessionKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
  if (sessionKey) {
    try {
      const sess = JSON.parse(localStorage.getItem(sessionKey));
      _skillsUserId = sess?.user?.id || null;
    } catch(_) {}
  }

  await Promise.all([
    _loadSkillDefs(),
    _loadSkillProgress(),
    _loadEchoObs(),
  ]);
  await _loadSkillUsers();   // โหลดชื่อ rep หลังรู้ว่ามี user_id อะไรบ้าง

  _renderSkillsScreen();
  _updateSkillsNavBadge();
}

async function _loadSkillDefs() {
  try {
    _skillDefs = await _skFetch(`${SKILLS_TABLE_DEFS}?select=*&order=sort_order.asc`);
  } catch(e) {
    console.error('[Skills] loadDefs:', e);
    _skillDefs = [];
  }
}

async function _loadSkillProgress() {
  if (!_skillsUserId) return;
  try {
    const isTL = _skillsRole === 'sales_tl' || _skillsRole === 'tl' || _skillsRole === 'admin';
    const query = isTL
      ? `${SKILLS_TABLE_PROG}?select=*`
      : `${SKILLS_TABLE_PROG}?select=*&user_id=eq.${_skillsUserId}`;
    const rows = await _skFetch(query);
    _skillProg = {};
    (rows || []).forEach(r => {
      const key = isTL ? `${r.user_id}:${r.skill_id}` : String(r.skill_id);
      _skillProg[key] = r;
    });
  } catch(e) {
    console.error('[Skills] loadProgress:', e);
  }
}

// ── Load Echo observations (rep view only) ──────────
let _echoObs   = {}; // rep view  { skill_code: [rows...] }
let _echoObsTL = {}; // TL view   { 'userId:skill_code': [rows...] }

async function _loadEchoObs() {
  const isTL = _skillsRole === 'sales_tl' || _skillsRole === 'tl' || _skillsRole === 'admin';
  if (isTL) {
    _echoObsTL = {};
    try {
      const rows = await _skFetch(
        'echo_skill_observations?order=observed_at.desc&limit=500'
      );
      (rows || []).forEach(r => {
        const key = r.user_id + ':' + r.skill_code;
        if (!_echoObsTL[key]) _echoObsTL[key] = [];
        _echoObsTL[key].push(r);
      });
    } catch(e) { console.warn('[Skills] echoObsTL:', e.message); }
    return;
  }
  _echoObs = {};
  try {
    const rows = await _skFetch(
      'echo_skill_observations?user_id=eq.' + _skillsUserId + '&order=observed_at.desc&limit=100'
    );
    (rows || []).forEach(r => {
      if (!_echoObs[r.skill_code]) _echoObs[r.skill_code] = [];
      _echoObs[r.skill_code].push(r);
    });
  } catch(e) { console.warn('[Skills] echoObs:', e.message); }
}

function _tlEchoObs(userId, skillCode) {
  return _echoObsTL[userId + ':' + skillCode] || [];
}

function _echoScoreLabel(score) {
  return score === 'pass' ? 'ผ่าน' : score === 'developing' ? 'กำลังพัฒนา' : score === 'not_observed' ? 'ไม่เห็นใน session' : '—';
}
function _echoScoreColor(score) {
  return score === 'pass' ? 'var(--sk-ok)' : score === 'developing' ? 'var(--sk-warn)' : 'var(--sk-muted)';
}
function _echoLatestStrip(skillCode) {
  const obs = (_echoObs[skillCode] || []).slice(0, 1)[0];
  if (!obs) return '';
  const date = obs.observed_at ? new Date(obs.observed_at).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '';
  const col   = _echoScoreColor(obs.ai_score);
  const label = _echoScoreLabel(obs.ai_score);
  return '<div class="sk-echo-strip mod-album-echo">'
    + '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M16.243 7.757a6 6 0 010 8.486M7.757 7.757a6 6 0 000 8.486"/></svg>'
    + '<span class="sk-echo-date">' + date + '</span>'
    + '<span class="sk-echo-score" style="color:' + col + '">' + label + '</span>'
    + '</div>';
}

// ── Load user profiles for TL (name display) ─────────
async function _loadSkillUsers() {
  const isTL = _skillsRole === 'sales_tl' || _skillsRole === 'tl' || _skillsRole === 'admin';
  if (!isTL) return;
  _skillUsers = {};
  try {
    const uids = [...new Set(Object.values(_skillProg).map(p => p.user_id).filter(Boolean))];
    if (uids.length === 0) return;
    const rows = await _skFetch(`profiles?select=id,email,full_name,kam_name&id=in.(${uids.join(',')})`);
    (rows || []).forEach(r => {
      if (!r.id) return;
      _skillUsers[r.id] = {
        full_name: r.kam_name || r.full_name || r.email || '',
        kam_name:  r.kam_name || r.full_name || '',
        email:     r.email || '',
      };
    });
    const bulk = (typeof portviewBulkData !== 'undefined' && portviewBulkData) || [];
    if (bulk.length > 0) {
      const emailToName = {};
      bulk.forEach(r => { if (r.kamEmail && r.kamName) emailToName[r.kamEmail.toLowerCase()] = r.kamName; });
      uids.forEach(uid => {
        const u = _skillUsers[uid];
        if (u && u.email && !u.kam_name) u.kam_name = emailToName[u.email.toLowerCase()] || u.full_name;
      });
    }
  } catch(e) { console.error('[Skills] loadUsers:', e); }
}


function _skUserName(userId) {
  if (!userId) return '?';
  // 1. หาจาก _skillProg — user_name ที่บันทึกไว้ตอน training (ไม่ต้องผ่าน RLS)
  const progWithName = Object.values(_skillProg).find(p => p.user_id === userId && p.user_name);
  if (progWithName && progWithName.user_name) return progWithName.user_name;
  // 2. fallback: _skillUsers (ถ้า profiles query สำเร็จ)
  const u = _skillUsers[userId];
  if (u) return u.kam_name || u.full_name || (u.email ? u.email.split('@')[0] : userId.slice(0,8));
  // 3. last resort: UUID 8 chars
  return userId.slice(0,8);
}

function _skUserInitials(userId) {
  const name = _skUserName(userId);
  return name.slice(0,2).toUpperCase();
}

// ── Nav badge (TL: pending count) ─────────────────────────
function _updateSkillsNavBadge() {
  const badge = document.getElementById('skills-nav-badge');
  if (!badge) return;
  const isTL = _skillsRole === 'sales_tl' || _skillsRole === 'tl' || _skillsRole === 'admin';
  if (!isTL) { badge.style.display = 'none'; return; }
  const pending = Object.values(_skillProg).filter(p => p.state === 'training').length;
  badge.style.display = pending > 0 ? 'block' : 'none';
}

// ── Main render dispatcher ─────────────────────────────────

// ── Central screen switcher — reset scr-skills CSS state before every render ──
function _switchSkillsScreen(mode) {
  const scr = document.getElementById('scr-skills');
  if (!scr) return scr;
  // reset เฉพาะ property ที่เราตั้งเอง — ห้ามแตะ display (showScreen เป็นคนคุม)
  scr.classList.remove('sk-detail-mode');
  scr.style.opacity = '';
  scr.style.transition = '';
  scr.style.paddingBottom = '';
  if (mode === 'detail') {
    scr.classList.add('sk-detail-mode');
  }
  return scr;
}

function _renderSkillsScreen() {
  const scr = _switchSkillsScreen('home');
  if (!scr) return;
  const isTL = _skillsRole === 'sales_tl' || _skillsRole === 'tl' || _skillsRole === 'admin';
  scr.innerHTML = isTL ? _renderTLHome() : _renderRepHome();
  _markLoadedImages(scr);
}

// แก้ race condition: รูปที่โหลดจาก cache เสร็จก่อน onload ผูก → เช็ค .complete
function _markLoadedImages(scr) {
  if (!scr) return;
  scr.querySelectorAll('img.mod-album-img, img.s2-char-img, img.s3-hero-img, img.sk-card-img-inner').forEach(img => {
    if (img.complete && img.naturalWidth > 0) {
      img.classList.add('sk-img-loaded');
    }
  });
}

// ══════════════════════════════════════════════════════════
// REP SCREENS
// ══════════════════════════════════════════════════════════

function _renderRepHome() {
  // Count unlocked+mastered
  const unlocked = Object.values(_skillProg).filter(p => p.state === 'unlocked' || p.state === 'mastered').length;
  const total    = _skillDefs.length;

  // Find next skill in training
  const trainingSkill = _skillDefs.find(d => {
    const p = _skillProg[String(d.id)];
    return p && p.state === 'training';
  });
  const nextLabel = trainingSkill ? `${trainingSkill.skill_code.split('_')[0]} · ${trainingSkill.skill_name_en}` : '—';
  const pct = total > 0 ? Math.round(unlocked / total * 100) : 0;

  // Group by module
  const modules = ['A','B','C','D'];
  const moduleRows = modules.map(m => {
    const defs = _skillDefs.filter(d => d.module === m);
    const uCount = defs.filter(d => {
      const p = _skillProg[String(d.id)];
      return p && (p.state === 'unlocked' || p.state === 'mastered');
    }).length;
    const tCount = defs.filter(d => {
      const p = _skillProg[String(d.id)];
      return p && p.state === 'training';
    }).length;
    const meta = MODULE_META[m];
    const ringPct = defs.length > 0 ? uCount / defs.length : 0;
    const ringOffset = 94.25 * (1 - ringPct);
    const ringColor = uCount === defs.length ? 'var(--sk-ok)' : tCount > 0 ? 'var(--sk-info)' : '#EBEBEB';
    const dimClass = uCount === 0 && tCount === 0 ? ' sk-mod-dim' : '';
    // S1 row layout — module_banner_url thumbnail left, info right, ring
    const firstDef = defs[0];
    const thumbUrl = _skUrl(firstDef && (firstDef.module_banner_url || firstDef.card_image_url));
    const thumbHtml = thumbUrl
      ? `<img src="${thumbUrl}" class="sk-row-thumb-img sk-img-lazy" alt="${meta.name}" onload="this.classList.add('sk-img-loaded')" onerror="this.classList.add('sk-img-loaded')">`
      : `<div class="sk-row-thumb-img" style="background:${MODULE_BG[m]}"></div>`;
    const latestObs = defs.flatMap(d=>(_echoObs[d.skill_code]||[]).slice(0,1)).sort((a,b)=>new Date(b.observed_at)-new Date(a.observed_at))[0];
    const echoStrip = latestObs ? (()=>{ const col=_echoScoreColor(latestObs.ai_score); const lbl=_echoScoreLabel(latestObs.ai_score); const dt=new Date(latestObs.observed_at).toLocaleDateString('th-TH',{day:'numeric',month:'short'}); return '<div class="sk-echo-strip"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M16.243 7.757a6 6 0 010 8.486M7.757 7.757a6 6 0 000 8.486"/></svg><span class="sk-echo-date">'+dt+'</span><span class="sk-echo-score" style="color:'+col+'">'+lbl+'</span></div>'; })() : '';
    const stateBadge = tCount > 0 ? `<span class="sk-row-badge badge-training">${tCount} กำลังฝึก</span>`
      : uCount > 0 ? `<span class="sk-row-badge badge-unlocked">${uCount} ปลดล็อค</span>` : '';
    const ringSvg = `<svg class="sk-row-ring" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="15" fill="none" stroke="#EBEBEB" stroke-width="2.5"/>
      ${ringPct > 0 ? `<circle cx="18" cy="18" r="15" fill="none" stroke="${ringColor}" stroke-width="2.5" stroke-dasharray="94.25" stroke-dashoffset="${ringOffset.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 18 18)"/>` : ''}
      <text x="18" y="22" text-anchor="middle" font-size="8" font-weight="700" fill="#222">${uCount}/${defs.length}</text>
    </svg>`;
    return `
<div class="sk-mod-row${dimClass}" onclick="skillsOpenModule('${m}')">
  <div class="sk-row-thumb">${thumbHtml}</div>
  <div class="sk-row-info">
    <div class="sk-row-eye">MODULE ${m} · ${defs.length} SKILLS</div>
    <div class="sk-row-name">${meta.name}</div>
    <div class="sk-row-sub">${meta.sub}</div>
    <div class="sk-row-badges">${stateBadge}${echoStrip}</div>
  </div>
  <div class="sk-row-right">${ringSvg}</div>
</div>`;
  }).join('');

  return `
<div class="sk-hero">
  <div class="sk-eyebrow sk-eyebrow-ac" style="margin-bottom:5px;">SKILLS MASTERY</div>
  <div class="sk-hero-top">
    <div>
      <div style="display:flex;align-items:flex-end;gap:3px;">
        <span class="sk-big">${unlocked}</span><span class="sk-denom">/${total}</span>
      </div>
      <div class="sk-label">ทักษะที่ปลดล็อคแล้ว</div>
    </div>
    <div class="sk-next-block">
      <div class="sk-next-eye">NEXT UP</div>
      <div class="sk-next-name">${nextLabel}</div>
      ${trainingSkill ? '<div class="sk-next-state">TRAINING</div>' : ''}
    </div>
  </div>
  <div class="sk-track"><div class="sk-fill" style="width:${pct}%;"></div></div>
  <div class="sk-meta"><span>${unlocked} UNLOCKED</span><span>${total - unlocked} REMAINING</span></div>
</div>
<div class="sk-sec"><span class="sk-eyebrow">Modules</span></div>
<div class="sk-mod-list">${moduleRows}</div>
<div style="padding:16px 14px;text-align:center;">
  <span class="sk-eyebrow">TL ประเมินและ unlock ทักษะให้คุณ</span>
</div>`;
}

function skillsOpenModule(module) {
  const scr = _switchSkillsScreen('grid');
  if (!scr) return;
  scr.innerHTML = _renderModuleGrid(module);
  _markLoadedImages(scr);
}

function _renderModuleGrid(module) {
  const meta = MODULE_META[module];
  const defs = _skillDefs.filter(d => d.module === module);

  const cards = defs.map(d => {
    const p     = _skillProg[String(d.id)];
    const state = p ? p.state : 'locked';
    const label = SKILL_STATE_LABEL_TH[state];
    const isWide = state === 'mastered';
    const lockIco = state === 'locked'
      ? `<div class="sk-lock-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></div>` : '';
    const starIco = state === 'mastered'
      ? `<svg class="sk-master-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l4-4 5 3 5-3 4 4-2 3h-4l-3 8-3-8H5L3 9z"/></svg>` : '';
    const sparkHtml = state === 'mastered'
      ? `<div class="sk-spark" style="width:3px;height:3px;top:14px;left:18px;animation:sk-spark 2.3s ease-in-out infinite;"></div><div class="sk-spark" style="width:2px;height:2px;top:10px;right:24px;animation:sk-spark 1.7s ease-in-out infinite .5s;"></div><div class="sk-spark" style="width:2px;height:2px;bottom:16px;left:12px;animation:sk-spark 2.0s ease-in-out infinite 1.0s;"></div><div class="sk-spark" style="width:3px;height:3px;bottom:12px;right:20px;animation:sk-spark 1.9s ease-in-out infinite .3s;"></div>` : '';

    if (isWide) {
      return `
<div class="sk-card-wide state-${state}" onclick="skillsOpenDetail(${d.id})">
  <div class="sk-card-img" style="width:90px;height:90px;flex-shrink:0;position:relative;overflow:hidden;">
    ${_skImgTag(d, { w:'90px', h:'90px', cls:'sk-card-img-inner' })}
    ${sparkHtml}
  </div>
  ${starIco}
  <div class="sk-card-body">
    <div class="sk-state-row"><div class="sk-dot"></div><span class="sk-state-label">${label}</span></div>
    <div class="sk-card-name">${d.skill_name_en}</div>
    <div class="sk-card-code">${d.skill_code.split('_')[0]} · สูงสุด</div>
  </div>
</div>`;
    }
    return `
<div class="sk-card state-${state}" onclick="skillsOpenDetail(${d.id})">
  <div class="sk-card-img" style="height:160px;width:100%;position:relative;overflow:hidden;">
    ${_skImgTag(d, { h:'160px', cls:'sk-card-img-inner' })}
    ${sparkHtml}
  </div>
  ${lockIco}
  <div class="sk-card-body">
    <div class="sk-state-row"><div class="sk-dot"></div><span class="sk-state-label">${label}</span></div>
    <div class="sk-card-name">${d.skill_name_en}</div>
    <div class="sk-card-code">${d.skill_code.split('_')[0]}</div>
  </div>
</div>`;
  }).join('');

  // S2 character banner — module_banner_url (full portrait), not skill card
  const bannerDef = defs[0];
  const bannerUrl = _skUrl(bannerDef && (bannerDef.module_banner_url || bannerDef.card_image_url));
  const ambientImg = bannerUrl
    ? `<img src="${bannerUrl}" class="s2-ambient-img sk-img-lazy" alt="" onload="this.classList.add('sk-img-loaded')" onerror="this.classList.add('sk-img-loaded')">`
    : `<div style="width:100%;height:100%;background:${MODULE_BG[module]};"></div>`;
  const charImg = bannerUrl
    ? `<img src="${bannerUrl}" class="s2-char-img sk-img-lazy" alt="${meta.name}" onload="this.classList.add('sk-img-loaded')" onerror="this.classList.add('sk-img-loaded')">`
    : `<div style="width:100%;height:100%;background:${MODULE_BG[module]};"></div>`;

  return `
<div class="s2-ambient">${ambientImg}</div>
<div class="sk-cg-topbar s2-topbar">
  <button class="sk-back-btn" onclick="_renderSkillsScreen()">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 12H5M5 12l7 7M5 12l7-7"/></svg>
    <span>ทักษะ</span>
  </button>
  <div style="text-align:right;">
    <div class="sk-eyebrow">Module ${module}</div>
    <div class="sk-cg-mod-name">${meta.name}</div>
  </div>
</div>
<div class="s2-scroll" style="overflow-y:auto;flex:1;padding-bottom:84px;position:relative;z-index:2;">
  <div class="s2-char">
    ${charImg}
    <div class="s2-char-overlay">
      <div>
        <div class="s2-char-name">${meta.name}</div>
        <div class="s2-char-sub">Module ${module} — ${meta.sub}</div>
      </div>
    </div>
  </div>
  <div class="sk-grid s2-grid">${cards}</div>
</div>`;
}

// ── Skill Detail Sheet ─────────────────────────────────────
async function skillsOpenDetail(skillId) {
  const scr = document.getElementById('scr-skills');
  if (scr && scr.innerHTML) {
    scr.style.transition = 'opacity .15s ease';
    scr.style.opacity = '0';
    setTimeout(() => {
      scr.style.transition = '';
      scr.style.opacity = '';
      _doOpenDetail(skillId);
    }, 150);
    return;
  }
  _doOpenDetail(skillId);
}
async function _doOpenDetail(skillId) {
  _activeSkillId = skillId;
  const scr = _switchSkillsScreen('detail');
  if (!scr) return;

  const def   = _skillDefs.find(d => d.id === skillId);
  if (!def) return;
  const p     = _skillProg[String(skillId)];
  const state = p ? p.state : 'locked';

  // Load eval log
  let logs = [];
  try {
    logs = await _skFetch(`${SKILLS_TABLE_LOG}?skill_id=eq.${skillId}&user_id=eq.${_skillsUserId}&order=changed_at.desc&limit=10`);
  } catch(_) {}

  const logRows = (logs || []).map(l => `
<div class="sk-log-row">
  <div class="sk-log-dot ${l.new_state}"></div>
  <div>
    <div class="sk-log-state">${SKILL_STATE_LABEL_TH[l.new_state] || l.new_state}${l.comment ? ` — ${l.comment}` : ''}</div>
    <div class="sk-log-meta">${l.changed_at ? new Date(l.changed_at).toLocaleDateString('th-TH') : ''}</div>
  </div>
</div>`).join('');

  // Echo history for this skill (rep view)
  const _echoHistory = (_echoObs[def.skill_code] || []).slice(0, 3);
  const echoRows = _echoHistory.map(o => {
    const col  = _echoScoreColor(o.ai_score);
    const lbl  = _echoScoreLabel(o.ai_score);
    const dt   = o.observed_at ? new Date(o.observed_at).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'}) : '';
    const ev   = o.evidence   || '';
    const note = o.coaching_note || '';
    return `<div class="sk-echo-row">
  <div class="sk-echo-row-top">
    <div style="display:flex;align-items:center;gap:5px;">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M16.243 7.757a6 6 0 010 8.486M7.757 7.757a6 6 0 000 8.486"/></svg>
      <span class="sk-echo-row-date">${dt}</span>
    </div>
    <span class="sk-echo-row-score" style="color:${col};">${lbl}</span>
  </div>
  ${ev ? `<div class="sk-echo-row-ev">${ev}</div>` : ''}
  ${note ? `<div class="sk-echo-row-note"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> ${note}</div>` : ''}
</div>`;
  }).join('');
  const echoSection = _echoHistory.length > 0 ? `
<div class="sk-divider"></div>
<div class="sk-rubric-block">
  <div class="sk-rubric-eye" style="display:flex;align-items:center;gap:5px;">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M16.243 7.757a6 6 0 010 8.486M7.757 7.757a6 6 0 000 8.486"/></svg>
    Echo Sessions
  </div>
  <div class="sk-echo-list">${echoRows}</div>
</div>` : '';

  // CTA based on state
  let cta = '';
  if (state === 'locked') {
    cta = `<button class="sk-cta-btn sk-cta-primary" onclick="skillsStartTraining(${skillId})">เริ่มฝึก</button>`;
  } else if (state === 'training') {
    cta = `
<div class="sk-rep-hint">รอ TL ประเมินเพื่อ unlock ทักษะนี้</div>
<button class="sk-cta-btn sk-cta-outline" onclick="_skToast('ส่งแล้ว — TL จะเห็นในรายการรอประเมิน')">แจ้ง TL ขอรับการประเมิน</button>`;
  }

  const modCode = def.skill_code.split('_')[0];
  const heroUrl = _skUrl(def.card_image_url);
  const heroImg = heroUrl
    ? `<img src="${heroUrl}" class="s3-hero-img sk-img-lazy" alt="${def.skill_name_en}" onload="this.classList.add('sk-img-loaded')" onerror="this.classList.add('sk-img-loaded')">`
    : `<div style="width:100%;height:100%;background:${MODULE_BG[def.module]};"></div>`;
  scr.innerHTML = `
<div class="s3-detail" id="s3-detail-wrap">
  <div class="s3-hero">${heroImg}<div class="s3-hero-gradient"></div></div>
  <div class="s3-topbar">
    <button class="s3-back" onclick="skillsOpenModule('${def.module}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="15" height="15"><path d="M19 12H5M5 12l7 7M5 12l7-7"/></svg>
      Module ${def.module}
    </button>
    <span class="s3-code-pill">${modCode}</span>
  </div>
  <div class="s3-sheet s3-sheet-peek" id="s3-sheet">
    <div class="s3-sheet-handle" onclick="_s3ToggleSheet()" style="cursor:pointer;padding:6px 0 2px;"></div>
    <div class="s3-peek-hint" onclick="_s3ToggleSheet()">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div class="sk-state-pill pill-${state}"><div class="sk-pill-dot"></div>${SKILL_STATE_LABEL_TH[state]}</div>
        <span class="sk-detail-code" style="font-size:11px;color:#6A6A6A;">${def.skill_name_en} · ${modCode}</span>
      </div>
      <svg class="s3-expand-chevron" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2" stroke-linecap="round" width="20" height="20"><path d="M18 15l-6-6-6 6"/></svg>
    </div>
    <div class="sk-detail-body s3-body-full">
  <div class="sk-state-pill-row">
    <div class="sk-state-pill pill-${state}">
      <div class="sk-pill-dot"></div>${SKILL_STATE_LABEL_TH[state]}
    </div>
    <span class="sk-detail-code">${def.skill_name_en} · ${modCode}</span>
  </div>
  <div class="sk-skill-title">${def.skill_name_th || def.skill_name_en}</div>

  ${def.principle_th ? `
  <div class="sk-rubric-block">
    <div class="sk-rubric-eye">Principle — ทำไมสกิลนี้สำคัญ</div>
    <div class="sk-rubric-text">${def.principle_th}</div>
  </div>
  <div class="sk-divider"></div>` : ''}

  ${def.practice_th ? `
  <div class="sk-rubric-block">
    <div class="sk-rubric-eye">Practice — ต้องทำอะไร</div>
    <div class="sk-rubric-text">${def.practice_th.split('|').map(t => t.trim()).filter(Boolean).map(t => '• ' + t).join('<br>')}</div>
  </div>
  <div class="sk-divider"></div>` : ''}

  ${def.pass_test_th ? `
  <div class="sk-rubric-block">
    <div class="sk-rubric-eye">Pass Test — เกณฑ์ผ่าน</div>
    <div class="sk-rubric-text">${def.pass_test_th.split('/').map((t,i) => t.trim()).filter(Boolean).map((t,i) => (i+1)+'. '+t).join('<br>')}</div>
  </div>
  <div class="sk-divider"></div>` : ''}

  ${echoSection}

  ${cta}

  ${logRows ? `<div class="sk-log-eye">History</div>${logRows}` : ''}
    </div>
  </div>
</div>`;
}

// ── S3 sheet peek/expand toggle ────────────────────────────
function _s3ToggleSheet() {
  const sheet = document.getElementById('s3-sheet');
  if (!sheet) return;
  const isExpanded = sheet.classList.contains('s3-sheet-expanded');
  if (isExpanded) {
    sheet.classList.remove('s3-sheet-expanded');
    sheet.classList.add('s3-sheet-peek');
  } else {
    sheet.classList.remove('s3-sheet-peek');
    sheet.classList.add('s3-sheet-expanded');
  }
}

// ── Rep self-mark training ─────────────────────────────────
async function skillsStartTraining(skillId) {
  if (!_skillsUserId) return;
  const def = _skillDefs.find(d => d.id === skillId);
  if (!def) return;
  // guard: ถ้า state ไม่ใช่ locked แล้ว ไม่ต้อง write ซ้ำ
  const existing = _skillProg[String(skillId)];
  if (existing && existing.state !== 'locked') return;

  try {
    // Upsert progress row — on_conflict ใน URL สำหรับ Supabase REST
    await _skFetch(`${SKILLS_TABLE_PROG}?on_conflict=user_id,skill_id`, {
      method:  'POST',
      prefer:  'resolution=merge-duplicates,return=minimal',
      body: {
        user_id:    _skillsUserId,
        skill_id:   skillId,
        state:      'training',
        user_name:  (typeof currentUserProfile !== 'undefined' && currentUserProfile)
                      ? (currentUserProfile.kam_name || currentUserProfile.full_name || currentUserProfile.email || '')
                      : '',
        updated_at: new Date().toISOString(),
      }
    });

    // Write log
    const prog = await _skFetch(`${SKILLS_TABLE_PROG}?user_id=eq.${_skillsUserId}&skill_id=eq.${skillId}&select=id`);
    if (prog && prog[0]) {
      await _skFetch(SKILLS_TABLE_LOG, {
        method: 'POST',
        prefer: 'return=minimal',
        body: {
          progress_id: prog[0].id,
          user_id:     _skillsUserId,
          skill_id:    skillId,
          old_state:   'locked',
          new_state:   'training',
          changed_by:  _skillsUserId,
        }
      });
    }

    // Update local cache
    _skillProg[String(skillId)] = { skill_id: skillId, user_id: _skillsUserId, state: 'training' };
    _skToast('ลุยเลย มาฝึกกัน');
    // Re-render detail with new state
    skillsOpenDetail(skillId);
  } catch(e) {
    console.error('[Skills] startTraining:', e);
    _skToast('เกิดข้อผิดพลาด กรุณาลองใหม่');
  }
}

// ══════════════════════════════════════════════════════════
// TL SCREENS
// ══════════════════════════════════════════════════════════

function _renderTLHome() {
  return _skillViewMode === 'pending' ? _renderTLPending() : _renderTLOverview();
}

function _renderTLPending() {
  const pending = Object.values(_skillProg).filter(p => p.state === 'training');
  // Sort by updated_at asc (oldest first)
  pending.sort((a,b) => new Date(a.updated_at||0) - new Date(b.updated_at||0));

  const pendCount = pending.length;
  const heroColor = pendCount === 0 ? 'var(--sk-ok)' : 'var(--sk-ac)';
  const heroLabel = pendCount === 0 ? 'ALL CLEAR' : 'PENDING';

  const rows = pending.map(p => {
    const def = _skillDefs.find(d => d.id === p.skill_id);
    if (!def) return '';
    const code = def.skill_code.split('_')[0];
    const daysAgo = p.updated_at
      ? Math.floor((Date.now() - new Date(p.updated_at)) / 86400000)
      : null;
    const dateLabel = daysAgo === null ? '' : daysAgo === 0 ? 'today' : `${daysAgo} day${daysAgo>1?'s':''} ago`;
    const initials  = _skUserInitials(p.user_id);
    const repName   = _skUserName(p.user_id);
    const echoObs   = _tlEchoObs(p.user_id, def.skill_code).slice(0,1)[0];
    const echoStrip = echoObs ? (() => {
      const col = _echoScoreColor(echoObs.ai_score);
      const lbl = _echoScoreLabel(echoObs.ai_score);
      const dt  = new Date(echoObs.observed_at).toLocaleDateString('th-TH',{day:'numeric',month:'short'});
      const ev  = echoObs.evidence ? '<div class="sk-pend-echo-ev">' + echoObs.evidence.slice(0,80) + (echoObs.evidence.length>80?'…':'') + '</div>' : '';
      return '<div class="sk-pend-echo-strip">'
        + '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="' + col + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0014 0M12 19v3M9 22h6"/></svg>'
        + '<span class="sk-pend-echo-date">' + dt + '</span>'
        + '<span class="sk-pend-echo-score" style="color:' + col + ';">' + lbl + '</span>'
        + '</div>' + ev;
    })() : '';
    return `
<div class="sk-pend-row" onclick="skillsTLOpenEval('${p.user_id}',${p.skill_id})">
  <div class="sk-pend-avatar">${initials}</div>
  <div class="sk-pend-info">
    <div class="sk-pend-name">${repName}</div>
    <div class="sk-pend-skill">${code} · ${def.skill_name_en}</div>
    <div class="sk-pend-date">self-marked ${dateLabel}</div>
    ${echoStrip}
  </div>
  <div class="sk-pend-right">
    <div class="sk-state-pill-sm"><div class="sk-pill-dot-sm"></div>Training</div>
    <svg class="sk-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
  </div>
</div>`;
  }).join('');

  const empty = pendCount === 0 ? `
<div class="sk-empty">
  <svg class="sk-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
  <div class="sk-empty-title">ทีมทุกคนเป็นปัจจุบัน</div>
  <div class="sk-empty-sub">ไม่มีทักษะที่รอการประเมิน<br>ดูภาพรวมทีมได้ที่ tab ถัดไป</div>
</div>` : '';

  return `
<div class="sk-tl-hero">
  <div>
    <div class="sk-eyebrow sk-eyebrow-ac">SKILLS</div>
    <div class="sk-tl-squad">${(window.currentUserProfile && window.currentUserProfile.squad) || 'Squad'}</div>
    <div class="sk-tl-sub">${Object.keys(Object.values(_skillProg).reduce((a,p)=>{a[p.user_id]=1;return a},{})).length} sales reps</div>
  </div>
  <div style="text-align:right;">
    <div class="sk-tl-pend-count" style="color:${heroColor};">${pendCount}</div>
    <div class="sk-eyebrow" style="color:${heroColor};">${heroLabel}</div>
  </div>
</div>
<div class="sk-tab-bar">
  <div class="sk-tab sk-tab-on" onclick="_skSetView('pending')">
    รอประเมิน${pendCount > 0 ? `<span class="sk-tab-badge">${pendCount}</span>` : ''}
  </div>
  <div class="sk-tab" onclick="_skSetView('overview')">ภาพรวมทีม</div>
</div>
${pendCount > 0 ? `<div class="sk-sec"><span class="sk-eyebrow">เรียงตาม · รอนานสุด</span></div><div class="sk-pend-list">${rows}</div>` : empty}`;
}

function _renderTLOverview() {
  const allProg   = Object.values(_skillProg);
  const total     = allProg.length;
  const unlocked  = allProg.filter(p => p.state === 'unlocked' || p.state === 'mastered').length;
  const pct       = total > 0 ? Math.round(unlocked / total * 100) : 0;
  const pendCount = allProg.filter(p => p.state === 'training').length;

  const byRepToggle = _ovToggle === 'rep' ? 'sk-tab-on' : '';
  const bySkillToggle = _ovToggle === 'skill' ? 'sk-tab-on' : '';

  // Group progress by user for By Rep view
  const userMap = {};
  allProg.forEach(p => {
    if (!userMap[p.user_id]) userMap[p.user_id] = [];
    userMap[p.user_id].push(p);
  });

  let viewContent = '';
  if (_ovToggle === 'rep') {
    const repRows = Object.entries(userMap).map(([uid, progs]) => {
      const uCount  = progs.filter(p => p.state==='unlocked'||p.state==='mastered').length;
      const tCount  = progs.filter(p => p.state==='training').length;
      const uTotal  = _skillDefs.length;
      const pct2    = uTotal > 0 ? Math.round(uCount/uTotal*100) : 0;
      const fillCls = pct2 >= 50 ? 'sk-rep-fill-ok' : pct2 >= 25 ? 'sk-rep-fill-mid' : 'sk-rep-fill-low';
      const pendDot = tCount > 0 ? '<div class="sk-rep-pend-dot"></div>' : '';
      const initials = _skUserInitials(uid);
      return `
<div class="sk-rep-row" onclick="skillsTLOpenRepDetail('${uid}')">
  <div class="sk-rep-avatar">${initials}</div>
  <div class="sk-rep-info">
    <div class="sk-rep-name">${pendDot}${_skUserName(uid)}</div>
    <div class="sk-rep-prog-row">
      <div class="sk-rep-track"><div class="sk-rep-fill ${fillCls}" style="width:${pct2}%;"></div></div>
      <span class="sk-rep-count">${uCount}/${uTotal}</span>
    </div>
  </div>
  <svg class="sk-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
</div>`;
    }).join('');
    viewContent = `<div class="sk-rep-list">${repRows}</div>`;
  } else {
    // By Skill — A→D fixed order
    const modules = ['A','B','C','D'];
    const skillRows = modules.map(m => {
      const defs = _skillDefs.filter(d => d.module === m);
      if (defs.length === 0) return '';
      const userCount = Object.keys(userMap).length || 1;
      const hd = `<div class="sk-skill-mod-hd">Module ${m} — ${MODULE_META[m].sub}</div>`;
      const rows = defs.map(d => {
        const progs    = allProg.filter(p => p.skill_id === d.id);
        const passCount = progs.filter(p => p.state==='unlocked'||p.state==='mastered').length;
        const pct3     = userCount > 0 ? Math.round(passCount/userCount*100) : 0;
        const fillCls  = pct3 === 0 ? 'sk-skill-fill-zero' : pct3 < 40 ? 'sk-skill-fill-low' : 'sk-skill-fill-ok';
        const dotCls   = pct3 === 0 ? 'sk-warn-dot-ac' : pct3 < 40 ? 'sk-warn-dot-warn' : 'sk-warn-dot-ok';
        const code     = d.skill_code.split('_')[0];
        return `
<div class="sk-skill-row">
  <div class="sk-warn-dot ${dotCls}"></div>
  <div class="sk-skill-info">
    <div style="display:flex;align-items:center;gap:6px;">
      <span class="sk-skill-code">${code}</span>
      <span class="sk-skill-name">${d.skill_name_en}</span>
    </div>
    <div class="sk-skill-bar-row">
      <div class="sk-skill-track"><div class="sk-skill-fill ${fillCls}" style="width:${pct3}%;"></div></div>
      <span class="sk-skill-count">${passCount}/${userCount}</span>
    </div>
  </div>
</div>`;
      }).join('');
      return hd + rows;
    }).join('');
    viewContent = `
<div class="sk-skill-list">${skillRows}</div>
<div style="padding:10px 14px;display:flex;gap:14px;">
  <div style="display:flex;align-items:center;gap:5px;"><div class="sk-warn-dot sk-warn-dot-ac"></div><span class="sk-eyebrow">0 passed</span></div>
  <div style="display:flex;align-items:center;gap:5px;"><div class="sk-warn-dot sk-warn-dot-warn"></div><span class="sk-eyebrow">&lt;40% · อ่อน</span></div>
</div>`;
  }

  return `
<div class="sk-ov-hero">
  <div class="sk-eyebrow sk-eyebrow-ac" style="margin-bottom:6px;">TEAM SKILLS</div>
  <div class="sk-ov-hero-row">
    <div>
      <div style="display:flex;align-items:flex-end;gap:3px;">
        <span class="sk-ov-big">${unlocked}</span><span class="sk-ov-denom">/${total}</span>
      </div>
      <div class="sk-ov-label">ทีม unlock แล้ว</div>
    </div>
    <div class="sk-ov-pct">${pct}%</div>
  </div>
  <div class="sk-ov-track"><div class="sk-ov-fill" style="width:${pct}%;"></div></div>
  <div class="sk-ov-meta"><span>${unlocked} UNLOCKED</span><span>${total-unlocked} REMAINING</span></div>
</div>
<div class="sk-tab-bar">
  <div class="sk-tab sk-tab-on" onclick="_skSetView('pending')">
    รอประเมิน${pendCount>0?`<span class="sk-tab-badge">${pendCount}</span>`:''}
  </div>
  <div class="sk-tab sk-tab-on" onclick="_skSetView('overview')">ภาพรวมทีม</div>
</div>
<div class="sk-view-toggle">
  <div class="sk-vt ${byRepToggle}" onclick="_skSetOvToggle('rep')">By Rep</div>
  <div class="sk-vt ${bySkillToggle}" onclick="_skSetOvToggle('skill')">By Skill</div>
</div>
${viewContent}`;
}

// ── TL eval detail ─────────────────────────────────────────
async function skillsTLOpenEval(userId, skillId) {
  const scr = document.getElementById('scr-skills');
  if (!scr) return;
  const def   = _skillDefs.find(d => d.id === skillId);
  if (!def) return;
  const key   = `${userId}:${skillId}`;
  const p     = _skillProg[key];
  const state = p ? p.state : 'locked';

  let logs = [];
  try {
    logs = await _skFetch(`${SKILLS_TABLE_LOG}?skill_id=eq.${skillId}&user_id=eq.${userId}&order=changed_at.desc&limit=10`);
  } catch(_) {}

  const logRows = (logs||[]).map(l => `
<div class="sk-log-row">
  <div class="sk-log-dot ${l.new_state}"></div>
  <div>
    <div class="sk-log-state">${SKILL_STATE_LABEL_TH[l.new_state]}${l.comment?` — ${l.comment}`:''}</div>
    <div class="sk-log-meta">${l.changed_at?new Date(l.changed_at).toLocaleDateString('th-TH'):''}</div>
  </div>
</div>`).join('');

  const modCode = def.skill_code.split('_')[0];
  const SK_BTN_ICONS = {
    locked:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>',
    training: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="currentColor" d="M12 2c0 0-4 4-4 9a4 4 0 008 0c0-5-4-9-4-9z"/><circle cx="12" cy="14.5" r="1.5" fill="currentColor" stroke="none"/></svg>',
    unlocked: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.35C16.5 22.15 20 17.25 20 12V6l-8-4z"/><polyline points="9 12 11 14 15 10"/></svg>',
    mastered: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l4-4 5 3 5-3 4 4-2 3h-4l-3 8-3-8H5L3 9z"/></svg>',
  };
  const stateButtons = ['locked','training','unlocked','mastered'].map(s => {
    const isSelected = s === state;
    const dimCls = !isSelected ? ' sk-tl-btn-dim' : '';
    const selCls = isSelected ? ` sk-tl-btn-sel-${s}` : '';
    return `<button class="sk-tl-btn${selCls}${dimCls}" onclick="_skTLSelectState('${s}')" style="color:var(--sk-state-${s});">
  <div class="sk-tl-btn-icon">${SK_BTN_ICONS[s]}</div>
  <span class="sk-tl-btn-label">${SKILL_STATE_LABEL_TH[s]}</span>
</button>`;
  }).join('');

  scr.innerHTML = `
<div class="sk-cg-topbar">
  <button class="sk-back-btn" onclick="_skSetView('pending');_renderSkillsScreen()">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 12H5M5 12l7 7M5 12l7-7"/></svg>
    <span>รอประเมิน</span>
  </button>
  <div class="sk-tl-role-chip">TL View</div>
</div>
<div class="sk-img-zone" style="height:150px;">${_skImgTag(def, { h:'150px', cls:'sk-img-zone-img' })}
  <div class="sk-img-fade"></div>
</div>
<div class="sk-detail-body">
  <div class="sk-state-pill-row">
    <div class="sk-state-pill pill-${state}"><div class="sk-pill-dot"></div>${SKILL_STATE_LABEL_TH[state]}</div>
    <span class="sk-detail-code">${modCode}</span>
  </div>
  <div class="sk-skill-title">${def.skill_name_en}</div>
  <div class="sk-rubric-block">
    <div class="sk-rubric-eye">Pass Test — เกณฑ์ผ่าน</div>
    <div class="sk-rubric-text">${(def.pass_test_th||'').replace(/\//g,'<br>')}</div>
  </div>
  <div class="sk-divider"></div>
  ${(() => {
    const obs = _tlEchoObs(userId, def.skill_code).slice(0,3);
    if (!obs.length) return '';
    const rows = obs.map(o => {
      const col  = _echoScoreColor(o.ai_score);
      const lbl  = _echoScoreLabel(o.ai_score);
      const dt   = new Date(o.observed_at).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'});
      const ev   = o.evidence    ? '<div class="sk-echo-row-ev">'   + o.evidence    + '</div>' : '';
      const note = o.coaching_note ? '<div class="sk-echo-row-note"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> ' + o.coaching_note + '</div>' : '';
      return '<div class="sk-echo-row">'
        + '<div class="sk-echo-row-top">'
        + '<div style="display:flex;align-items:center;gap:5px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="' + col + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0014 0M12 19v3M9 22h6"/></svg>'
        + '<span class="sk-echo-row-date">' + dt + '</span></div>'
        + '<span class="sk-echo-row-score" style="color:' + col + ';">' + lbl + '</span>'
        + '</div>' + ev + note + '</div>';
    }).join('');
    return '<div class="sk-rubric-block">'
      + '<div class="sk-rubric-eye" style="display:flex;align-items:center;gap:5px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--sk-ac)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0014 0M12 19v3M9 22h6"/></svg> Echo Sessions</div>'
      + '<div class="sk-echo-list">' + rows + '</div>'
      + '</div><div class="sk-divider"></div>';
  })()}
  <div class="sk-tl-zone">
    <div class="sk-tl-eye">TL · Evaluation</div>
    <div class="sk-tl-rep-row">
      <div class="sk-tl-avatar">${_skUserInitials(userId)}</div>
      <div>
        <div class="sk-tl-rep-name">${_skUserName(userId)}</div>
        <div class="sk-tl-rep-meta">Sales · self-marked ${p&&p.updated_at?new Date(p.updated_at).toLocaleDateString('th-TH'):''}</div>
      </div>
    </div>
    <div class="sk-tl-state-label">Mark as</div>
    <div class="sk-tl-state-row" id="tl-state-row">${stateButtons}</div>
    <textarea class="sk-tl-note" id="tl-note" rows="2" placeholder="Note (optional)"></textarea>
    <button class="sk-tl-save" onclick="skillsTLSave('${userId}',${skillId},'${state}')">บันทึกการประเมิน</button>
  </div>
  ${logRows ? `<div class="sk-log-eye">History</div>${logRows}` : ''}
</div>`;

  // store selected state in dataset
  document.getElementById('tl-state-row').dataset.selected = state;
}

function _skTLSelectState(newState) {
  const row = document.getElementById('tl-state-row');
  if (!row) return;
  row.dataset.selected = newState;
  // Re-render buttons with new selected
  const _btnIcons = {
    locked:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>',
    training: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="currentColor" d="M12 2c0 0-4 4-4 9a4 4 0 008 0c0-5-4-9-4-9z"/><circle cx="12" cy="14.5" r="1.5" fill="currentColor" stroke="none"/></svg>',
    unlocked: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.35C16.5 22.15 20 17.25 20 12V6l-8-4z"/><polyline points="9 12 11 14 15 10"/></svg>',
    mastered: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l4-4 5 3 5-3 4 4-2 3h-4l-3 8-3-8H5L3 9z"/></svg>',
  };
  row.innerHTML = SKILL_STATES.map(s => {
    const isSelected = s === newState;
    const dimCls = !isSelected ? ' sk-tl-btn-dim' : '';
    const selCls = isSelected ? ` sk-tl-btn-sel-${s}` : '';
    return `<button class="sk-tl-btn${selCls}${dimCls}" onclick="_skTLSelectState('${s}')" style="color:var(--sk-state-${s});">
  <div class="sk-tl-btn-icon">${_btnIcons[s]}</div>
  <span class="sk-tl-btn-label">${SKILL_STATE_LABEL_TH[s]}</span>
</button>`;
  }).join('');
}

async function skillsTLSave(userId, skillId) {
  const row      = document.getElementById('tl-state-row');
  const newState = row ? row.dataset.selected : null;
  const note     = (document.getElementById('tl-note')||{}).value || '';
  // ดึง oldState จาก local cache (source of truth) ไม่ใช่จาก HTML parameter
  const key      = `${userId}:${skillId}`;
  const oldState = _skillProg[key] ? _skillProg[key].state : 'locked';
  if (!newState) return;
  // guard: ถ้า state เหมือนเดิม และไม่มี note ก็ไม่ต้อง write
  if (newState === oldState && !note.trim()) return;

  try {
    // Update progress
    // ดึง user_name จาก cache ถ้ายังไม่มี
    const _tlProgKey = `${userId}:${skillId}`;
    const _existingName = _skillProg[_tlProgKey] ? _skillProg[_tlProgKey].user_name : null;
    await _skFetch(`${SKILLS_TABLE_PROG}?user_id=eq.${userId}&skill_id=eq.${skillId}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        state:        newState,
        evaluated_by: _skillsUserId,
        evaluated_at: new Date().toISOString(),
        notes:        note || null,
        user_name:    _existingName || _skUserName(userId) || null,
      }
    });

    // Log
    const prog = await _skFetch(`${SKILLS_TABLE_PROG}?user_id=eq.${userId}&skill_id=eq.${skillId}&select=id`);
    if (prog && prog[0]) {
      await _skFetch(SKILLS_TABLE_LOG, {
        method: 'POST', prefer: 'return=minimal',
        body: {
          progress_id: prog[0].id,
          user_id:     userId,
          skill_id:    skillId,
          old_state:   oldState,
          new_state:   newState,
          changed_by:  _skillsUserId,
          comment:     note || null,
        }
      });
    }

    // Update local cache + re-render
    const cacheKey = `${userId}:${skillId}`;
    if (_skillProg[cacheKey]) {
      _skillProg[cacheKey].state      = newState;
      _skillProg[cacheKey].evaluated_by = _skillsUserId;
      _skillProg[cacheKey].evaluated_at = new Date().toISOString();
    }
    _updateSkillsNavBadge();   // badge อัพเดททันทีหลัง save
    _skToast(`บันทึกแล้ว — ${SKILL_STATE_LABEL_TH[newState]}`);
    _skSetView('pending');
    _renderSkillsScreen();
  } catch(e) {
    console.error('[Skills] TL save:', e);
    _skToast('เกิดข้อผิดพลาด กรุณาลองใหม่');
  }
}

// ── TL rep detail ──────────────────────────────────────────
function skillsTLOpenRepDetail(userId) {
  const scr = document.getElementById('scr-skills');
  if (!scr) return;
  const progs    = Object.values(_skillProg).filter(p => p.user_id === userId);
  const uCount   = progs.filter(p => p.state==='unlocked'||p.state==='mastered').length;
  const uTotal   = _skillDefs.length;
  const ringPct  = uTotal > 0 ? uCount/uTotal : 0;
  const ringOff  = 94.25*(1-ringPct);
  let   showAll  = false;

  const renderList = (all) => {
    const filtered = all
      ? _skillDefs
      : _skillDefs.filter(d => {
          const p = progs.find(p => p.skill_id === d.id);
          return !p || p.state === 'locked' || p.state === 'training';
        });
    return filtered.map(d => {
      const p = progs.find(p => p.skill_id === d.id);
      const s = p ? p.state : 'locked';
      const code = d.skill_code.split('_')[0];
      return `
<div class="sk-det-skill-row" onclick="skillsTLOpenEval('${userId}',${d.id})">
  <span class="sk-det-skill-mod">${code}</span>
  <span class="sk-det-skill-name">${d.skill_name_en}</span>
  <div class="sk-det-state" style="color:var(--sk-state-${s});">
    <div class="sk-det-dot" style="background:var(--sk-state-${s});"></div>${SKILL_STATE_LABEL_TH[s]}
  </div>
  <svg style="width:12px;height:12px;opacity:.5;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:2;margin-left:4px;" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
</div>`;
    }).join('');
  };

  scr.innerHTML = `
<div class="sk-cg-topbar">
  <button class="sk-back-btn" onclick="_skSetView('overview');_renderSkillsScreen()">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 12H5M5 12l7 7M5 12l7-7"/></svg>
    <span>ภาพรวมทีม</span>
  </button>
  <div class="sk-tl-role-chip">TL View</div>
</div>
<div style="overflow-y:auto;flex:1;padding-bottom:84px;">
  <div class="sk-rep-det-hd">
    <div class="sk-rep-det-avatar">${_skUserInitials(userId)}</div>
    <div>
      <div class="sk-rep-det-name">${_skUserName(userId)}</div>
      <div class="sk-rep-det-meta">Sales · ${uCount}/${uTotal} unlocked</div>
    </div>
    <div style="position:relative;width:36px;height:36px;margin-left:auto;">
      <svg viewBox="0 0 36 36" style="width:36px;height:36px;transform:rotate(-90deg);">
        <circle cx="18" cy="18" r="15" fill="none" stroke="#EBEBEB" stroke-width="2.5"/>
        ${ringPct>0?`<circle cx="18" cy="18" r="15" fill="none" stroke="var(--sk-ac)" stroke-width="2.5"
          stroke-dasharray="94.25" stroke-dashoffset="${ringOff.toFixed(2)}" stroke-linecap="round"/>`:''}
      </svg>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:var(--sk-ac);font-family:'Noto Sans Thai',sans-serif;">${uCount}/${uTotal}</div>
    </div>
  </div>
  <div class="sk-filter-row">
    <span class="sk-fpill sk-fpill-on" id="fp-notyet" onclick="_skRepFilter(false,'${userId}')">ยังไม่ผ่าน</span>
    <span class="sk-fpill" id="fp-all" onclick="_skRepFilter(true,'${userId}')">ดูทั้งหมด</span>
  </div>
  <div class="sk-det-skill-list" id="rep-det-list">${renderList(false)}</div>
</div>`;
}

function _skRepFilter(all, userId) {
  const progs = Object.values(_skillProg).filter(p => p.user_id === userId);
  const filtered = all
    ? _skillDefs
    : _skillDefs.filter(d => {
        const p = progs.find(p => p.skill_id === d.id);
        return !p || p.state === 'locked' || p.state === 'training';
      });
  const list = document.getElementById('rep-det-list');
  if (!list) return;
  list.innerHTML = filtered.map(d => {
    const p = progs.find(p => p.skill_id === d.id);
    const s = p ? p.state : 'locked';
    const code = d.skill_code.split('_')[0];
    return `
<div class="sk-det-skill-row" onclick="skillsTLOpenEval('${userId}',${d.id})">
  <span class="sk-det-skill-mod">${code}</span>
  <span class="sk-det-skill-name">${d.skill_name_en}</span>
  <div class="sk-det-state" style="color:var(--sk-state-${s});">
    <div class="sk-det-dot" style="background:var(--sk-state-${s});"></div>${SKILL_STATE_LABEL_TH[s]}
  </div>
  <svg style="width:12px;height:12px;opacity:.5;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:2;margin-left:4px;" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
</div>`;
  }).join('');
  document.querySelectorAll('.sk-fpill').forEach(el => el.classList.remove('sk-fpill-on'));
  const target = all ? document.getElementById('fp-all') : document.getElementById('fp-notyet');
  if (target) target.classList.add('sk-fpill-on');
}

// ── Helpers ────────────────────────────────────────────────
function _skSetView(v) { _skillViewMode = v; }
function _skSetOvToggle(v) { _ovToggle = v; _renderSkillsScreen(); }

function _skToast(msg) {
  let t = document.getElementById('sk-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'sk-toast';
    t.className = 'sk-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('sk-toast-show');
  setTimeout(() => t.classList.remove('sk-toast-show'), 2200);
}

// ── Expose globals ─────────────────────────────────────────
window.skillsInit              = skillsInit;
window.skillsOpenModule        = skillsOpenModule;
window.skillsOpenDetail        = skillsOpenDetail;
window.skillsStartTraining     = skillsStartTraining;
window.skillsTLOpenEval        = skillsTLOpenEval;
window.skillsTLSave            = skillsTLSave;
window.skillsTLOpenRepDetail   = skillsTLOpenRepDetail;
window._skSetView              = _skSetView;
window._skSetOvToggle          = _skSetOvToggle;
window._skTLSelectState        = _skTLSelectState;
window._skRepFilter            = _skRepFilter;
window._renderSkillsScreen     = _renderSkillsScreen;

