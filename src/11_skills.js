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
// ── v569 MODULE DOT SYSTEM (app-wide, user-approved direction) ──────────────
// Every skill dot is hue-coded by its module (MODULE_META colors):
//   pass → full module color · developing → soft tint · not observed → faint tint
// Replaces uniform gray/orange/green dots everywhere; no skill-name labels needed.
function _skMixWhite(hex, pct) {
  try {
    const n = parseInt(hex.slice(1), 16), r = (n>>16)&255, g = (n>>8)&255, b = n&255;
    const m = c => Math.round(c + (255 - c) * pct);
    return 'rgb(' + m(r) + ',' + m(g) + ',' + m(b) + ')';
  } catch(e) { return hex; }
}
// Unlock-state variant (locked → training → unlocked/mastered) — same hue logic
window._skStateDotColor = function(skillCode, state) {
  const mod = ((skillCode || '')[0] || '').toUpperCase();
  const base = (MODULE_META[mod] && MODULE_META[mod].color) || '#8E8E93';
  if (state === 'unlocked' || state === 'mastered') return base;
  if (state === 'training') return _skMixWhite(base, 0.55);
  return _skMixWhite(base, 0.85); // locked
};
window._skDotColor = function(skillCode, score) {
  const mod = ((skillCode || '')[0] || '').toUpperCase();
  const base = (MODULE_META[mod] && MODULE_META[mod].color) || '#8E8E93';
  if (score === 'pass') return base;
  if (score === 'developing') return _skMixWhite(base, 0.55);
  return _skMixWhite(base, 0.85);
};

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
    <span style="font-size:var(--text-xs);font-weight:var(--fw-semi);font-family:'Noto Sans Thai',sans-serif;opacity:.3;">${code}</span>
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
let _skillsInitRole = null;    // role at last successful init — guard against double-fetch
let _activeSkillId = null;
let _skillUsers   = {};        // { user_id: { full_name, kam_name, email } }     // currently open skill sheet
let _skillViewMode = 'pending';  // TL: 'pending' | 'overview' | 'visits'
let _ovToggle     = 'rep';     // TL overview: 'rep' | 'skill'
let _tlSquad      = null;      // squad name of current TL (e.g. 'Tao', 'Yun')
let _tlSquadEmails = [];       // emails of reps in TL's squad
let _tlBrowseMode = false;     // TL: true เมื่ออยู่ใน skill-card browse mode

// ── Supabase helper ────────────────────────────────────────

// ── JWT helper — ดึง access token จาก Supabase session ───
function _skGetJWT() {
  try {
    // v2: ใช้ currentUser จาก 01_core.js ที่โหลดก่อนแล้ว
    if (typeof window._skCachedJWT === 'string' && window._skCachedJWT) return window._skCachedJWT;
    // localStorage fallback (Android/Chrome)
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
    if (key) {
      const sess = JSON.parse(localStorage.getItem(key));
      const token = sess?.access_token || sess?.data?.session?.access_token || null;
      if (token) return token;
    }
    // sessionStorage fallback (Safari/iOS)
    const skey = Object.keys(sessionStorage).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
    if (skey) {
      const sess = JSON.parse(sessionStorage.getItem(skey));
      const token = sess?.access_token || sess?.data?.session?.access_token || null;
      if (token) return token;
    }
  } catch(_) {}
  return null;
}

// Cache JWT async — called once at skillsInit so _skFetch works on Safari
async function _skCacheJWT() {
  try {
    if (typeof supa !== 'undefined' && supa.auth && supa.auth.getSession) {
      const { data } = await supa.auth.getSession();
      if (data?.session?.access_token) {
        window._skCachedJWT = data.session.access_token;
        return;
      }
    }
  } catch(_) {}
  // fallback: already handled by _skGetJWT sync
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

  // Idempotency guard: same role + data already loaded → just re-render, no re-fetch
  // Prevents double network calls when user taps Skills nav repeatedly
  if (role === _skillsInitRole && _skillDefs.length > 0) {
    _renderSkillsScreen();
    _updateSkillsNavBadge();
    return;
  }

  // Role guard: KAM/rep must not see skills — redirect back to portview
  // v498: rep=KAM IC, ad=Account Development, ad_tl=AD TL — all use Skills
  // pm=Project/Portfolio Manager — same treatment as ad, no pm_tl variant
  const _allowedRoles = ['sales','sales_tl','tl','admin','rep','ad','ad_tl','pm'];
  const _normRole = role ? role.toLowerCase() : '';
  const _isAllowed = _allowedRoles.some(r => _normRole.includes(r));
  if (!_isAllowed) {
    console.warn('[Skills] role not allowed:', role, '→ redirecting to portview');
    if (typeof showScreen === 'function') showScreen('portview');
    return;
  }

  // Reset active state to prevent stale S3 detail from previous session
  _activeSkillId = null;

  // v561: first-open feedback — nav switches to scr-skills immediately (showScreen)
  // but content stayed blank until every fetch resolved. Show light skeleton now;
  // revisits keep previous content visible during refresh (better continuity).
  try {
    const _scr0 = document.getElementById('scr-skills');
    if (_scr0 && !_scr0.innerHTML.trim()) {
      _scr0.innerHTML = '<div style="padding:56px 24px;display:flex;flex-direction:column;align-items:center;gap:14px">'
        + '<div class="skel-light" style="width:120px;height:120px;border-radius:24px"></div>'
        + '<div class="skel-light" style="width:180px;height:16px"></div>'
        + '<div class="skel-light" style="width:120px;height:12px"></div></div>';
    }
  } catch(e) {}

  // Cache JWT first (async, handles Safari/iOS sessionStorage)
  await _skCacheJWT();

  // Get user id — prefer currentUser from 01_core, fallback to localStorage
  if (typeof currentUser !== 'undefined' && currentUser?.id) {
    _skillsUserId = currentUser.id;
  } else {
    const sessionKey = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
    if (sessionKey) {
      try {
        const sess = JSON.parse(localStorage.getItem(sessionKey));
        _skillsUserId = sess?.user?.id || null;
      } catch(_) {}
    }
    // Safari fallback: sessionStorage
    if (!_skillsUserId) {
      const sKey = Object.keys(sessionStorage).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
      if (sKey) {
        try {
          const sess = JSON.parse(sessionStorage.getItem(sKey));
          _skillsUserId = sess?.user?.id || null;
        } catch(_) {}
      }
    }
  }

  console.log('[Skills] init — role:', _skillsRole, '| userId:', _skillsUserId);

  // TL: load squad + squad members from profiles first
  const isTLInit = _skillsRole === 'sales_tl' || _skillsRole === 'tl' || _skillsRole === 'admin' || _skillsRole === 'ad_tl';
  if (isTLInit) {
    await _loadTLSquad();
  }

  await Promise.all([
    _loadSkillDefs(),
    _loadSkillProgress(),
    _loadEchoObs(),
  ]);
  await _loadSkillUsers();   // โหลดชื่อ rep หลังรู้ว่ามี user_id อะไรบ้าง

  _skillsInitRole = role;  // mark init complete for this role
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
    const isTL = _skillsRole === 'sales_tl' || _skillsRole === 'tl' || _skillsRole === 'admin' || _skillsRole === 'ad_tl';
    let query;
    if (isTL) {
      if (_tlSquadEmails.length > 0) {
        const emailList = _tlSquadEmails.map(e => '"' + e + '"').join(',');
        query = SKILLS_TABLE_PROG + '?select=*&owner_email=in.(' + emailList + ')';
      } else {
        // fallback: โหลดทั้งหมดแล้ว filter ที่ render-time
        query = SKILLS_TABLE_PROG + '?select=*';
      }
    } else {
      query = SKILLS_TABLE_PROG + '?select=*&user_id=eq.' + _skillsUserId;
    }
    const rows = await _skFetch(query);
    _skillProg = {};
    (rows || []).forEach(r => {
      const key = isTL ? r.user_id + ':' + r.skill_id : String(r.skill_id);
      _skillProg[key] = r;
    });
  } catch(e) {
    console.error('[Skills] loadProgress:', e);
  }
}

async function _loadTLSquad() {
  _tlSquad = null;
  _tlSquadEmails = [];
  try {
    // Get TL email — try multiple sources
    let tlEmail = '';
    // 1. supa.auth.getSession() — most reliable across browsers
    if (!tlEmail && typeof supa !== 'undefined' && supa?.auth?.getSession) {
      const { data } = await supa.auth.getSession();
      tlEmail = (data?.session?.user?.email || '').toLowerCase();
      if (data?.session?.access_token) window._skCachedJWT = data.session.access_token;
    }
    // 2. window.currentUserProfile (may not be set)
    if (!tlEmail) tlEmail = (window.currentUserProfile?.email || '').toLowerCase();
    // 3. localStorage/sessionStorage fallback
    if (!tlEmail) {
      for (const storage of [localStorage, sessionStorage]) {
        const k = Object.keys(storage).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
        if (k) { try { const s = JSON.parse(storage.getItem(k)); tlEmail = (s?.user?.email || s?.data?.user?.email || '').toLowerCase(); } catch(_){} }
        if (tlEmail) break;
      }
    }
    if (!tlEmail) { console.warn('[Skills] _loadTLSquad: no TL email found'); return; }
    console.log('[Skills] _loadTLSquad: tlEmail =', tlEmail);

    // 1. Get TL's own squad name
    const tlRows = await _skFetch(`profiles?select=squad,sale_team&email=eq.${encodeURIComponent(tlEmail)}&limit=1`);
    const tlRow = tlRows && tlRows[0];
    const squadName = tlRow?.squad || tlRow?.sale_team || null;
    if (!squadName) { console.warn('[Skills] TL squad not set for', tlEmail); return; }
    _tlSquad = squadName;

    // 2. Get all reps in same squad
    // v498: include ad/ad_tl in squad member query
    // pm also included, same squad-member treatment
    const repRows = await _skFetch(`profiles?select=email&squad=eq.${encodeURIComponent(squadName)}&role=in.(sales,rep,sales_tl,tl,ad,ad_tl,pm)`);
    _tlSquadEmails = (repRows || [])
      .map(r => (r.email || '').toLowerCase())
      .filter(e => e && e !== tlEmail);
    console.log('[Skills] TL squad:', squadName, '| members:', _tlSquadEmails);
  } catch(e) {
    console.warn('[Skills] _loadTLSquad failed:', e.message);
  }
}

function _getSquadEmails(tlEmail) {
  // Now purely uses _tlSquadEmails loaded from profiles
  return _tlSquadEmails.length > 0 ? _tlSquadEmails : [];
}

// ── Load Echo observations (rep view only) ──────────
let _echoObs   = {}; // rep view  { skill_code: [rows...] }
let _echoObsTL = {}; // TL view   { 'userId:skill_code': [rows...] }

async function _loadEchoObs() {
  const isTL = _skillsRole === 'sales_tl' || _skillsRole === 'tl' || _skillsRole === 'admin' || _skillsRole === 'ad_tl';
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
  const isTL = _skillsRole === 'sales_tl' || _skillsRole === 'tl' || _skillsRole === 'admin' || _skillsRole === 'ad_tl';
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

// Extract nickname from "(Nick)" pattern, fallback to first word
function _skNickname(fullName) {
  if (!fullName) return '?';
  const m = fullName.match(/\(([^)]+)\)/);
  if (m) return m[1].trim();
  return fullName.split(/\s+/)[0] || fullName;
}

// ── Nav badge (TL: pending count) ─────────────────────────
function _updateSkillsNavBadge() {
  const badge = document.getElementById('skills-nav-badge');
  if (!badge) return;
  const isTL = _skillsRole === 'sales_tl' || _skillsRole === 'tl' || _skillsRole === 'admin' || _skillsRole === 'ad_tl';
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
  const _r = (_skillsRole || '').toLowerCase();
  // v498: allow rep/ad/ad_tl (KAM stack users)
  // pm also allowed, same KAM-stack treatment as ad
  const _allowedToRender = _r.includes('sales') || _r === 'tl' || _r === 'admin' || _r === 'rep' || _r === 'ad' || _r === 'ad_tl' || _r === 'pm';
  if (!_r || !_allowedToRender) {
    if (typeof showScreen === 'function') showScreen('portview');
    return;
  }
  const isTL = _skillsRole === 'sales_tl' || _skillsRole === 'tl' || _skillsRole === 'admin' || _skillsRole === 'ad_tl';
  if (isTL) {
    _tlBrowseMode = false; // reset browse mode เมื่อกลับ TL shell
    _renderTLShell(scr);
  } else {
    scr.innerHTML = _renderRepHome();
  }
  _markLoadedImages(scr);
}

// TL shell: render header + static tab bar once, swap only content zone
function _renderTLShell(scr) {
  // filter _skillProg using _tlSquadEmails (loaded from profiles at init)
  let _progFiltered;
  if (_tlSquadEmails.length > 0) {
    _progFiltered = Object.fromEntries(
      Object.entries(_skillProg).filter(([, p]) =>
        p.owner_email && _tlSquadEmails.includes(p.owner_email.toLowerCase())
      )
    );
  } else {
    _progFiltered = _skillProg;
  }

  const pendCount = Object.values(_progFiltered).filter(p => p.state === 'training').length;
  const heroColor = pendCount === 0 ? 'var(--sk-ok)' : 'var(--sk-ac)';
  const heroLabel = pendCount === 0 ? 'ALL CLEAR' : 'PENDING';
  const repCount  = new Set(Object.values(_progFiltered).map(p => p.user_id).filter(Boolean)).size;
  const squadName = _tlSquad || (window.currentUserProfile && window.currentUserProfile.squad) || 'Squad';

  window._tlProgFiltered = _progFiltered;

  scr.innerHTML = `
<div id="sk-tl-header" style="padding:14px 14px 0;display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0;">
  <div>
    <div class="sk-eyebrow sk-eyebrow-ac">SKILLS</div>
    <div class="sk-tl-squad" style="margin-top:2px;">${squadName}</div>
    <div class="sk-tl-sub">${repCount} sales reps</div>
  </div>
  <div style="text-align:right;">
    <div class="sk-tl-pend-count" style="color:${heroColor};">${pendCount}</div>
    <div class="sk-eyebrow" style="color:${heroColor};">${heroLabel}</div>
  </div>
</div>
<div id="sk-tl-tabs" class="sk-tab-bar" style="margin-top:12px;flex-shrink:0;">
  <div class="sk-tab ${_skillViewMode==='pending'?'sk-tab-on':''}" onclick="_skSetView('pending');_renderTLContent();">
    รอประเมิน${pendCount > 0 ? `<span class="sk-tab-badge">${pendCount}</span>` : ''}
  </div>
  <div class="sk-tab ${_skillViewMode==='overview'?'sk-tab-on':''}" onclick="_skSetView('overview');_renderTLContent();">ภาพรวมทีม</div>
  <div class="sk-tab ${_skillViewMode==='visits'?'sk-tab-on':''}" onclick="_skSetView('visits');_renderTLContent();">Visits</div>
  <div class="sk-tab" onclick="_tlBrowseMode=true;const _bs=_switchSkillsScreen('home');if(_bs){_bs.innerHTML=_renderRepHome();_markLoadedImages(_bs);}">อ่าน Skills</div>
</div>
<div id="sk-tl-content" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;"></div>`;

  _renderTLContent();
}

// Only swap content zone — header + tab bar stay fixed
function _renderTLContent() {
  const content = document.getElementById('sk-tl-content');
  if (!content) { _renderSkillsScreen(); return; }

  // Update tab active state without re-rendering header
  const tabs = document.querySelectorAll('#sk-tl-tabs .sk-tab');
  tabs.forEach((t, i) => {
    const isActive = (i === 0 && _skillViewMode === 'pending') ||
                     (i === 1 && _skillViewMode === 'overview') ||
                     (i === 2 && _skillViewMode === 'visits');
    t.classList.toggle('sk-tab-on', isActive);
  });

  if (_skillViewMode === 'pending') {
    content.innerHTML = _renderTLPendingContent();
  } else if (_skillViewMode === 'visits') {
    _renderTLVisitContent(content);
  } else {
    content.innerHTML = _renderTLOverviewContent();
  }
}

// ── TL Visit Tracker ───────────────────────────────────────
async function _renderTLVisitContent(container) {
  if (!container) return;
  const _loadingMsg = `<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:var(--sk-muted);font-family:var(--font,sans-serif);">กำลังโหลด...</div>`;
  const _emptyTeam  = `<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:var(--sk-muted);font-family:var(--font,sans-serif);">ไม่พบข้อมูลทีม</div>`;
  const _noData     = `<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:var(--sk-muted);font-family:var(--font,sans-serif);">ยังไม่มี visit ที่บันทึกไว้</div>`;
  const _errMsg     = `<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:var(--sk-muted);font-family:var(--font,sans-serif);">โหลดข้อมูลไม่สำเร็จ</div>`;
  container.innerHTML = _loadingMsg;

  try {
    const emails = _tlSquadEmails.length > 0 ? _tlSquadEmails : [];
    if (!emails.length) { container.innerHTML = _emptyTeam; return; }

    const since = new Date(Date.now() - 35 * 86400000).toISOString();
    const emailFilter = emails.map(e => `"${e}"`).join(',');
    const rows = await _skFetch(
      `ci_sessions?select=owner_email,visited_at,account_name,duration_secs` +
      `&owner_email=in.(${emailFilter})&visited_at=gte.${since}&order=visited_at.desc&limit=500`
    );
    if (!rows || !rows.length) { container.innerHTML = _noData; return; }

    // Week boundaries (Mon–Sun)
    const now = new Date();
    const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const thisMonStart = new Date(now); thisMonStart.setHours(0,0,0,0); thisMonStart.setDate(now.getDate() - dow);
    const lastMonStart = new Date(thisMonStart); lastMonStart.setDate(thisMonStart.getDate() - 7);
    const monthStart   = new Date(now.getFullYear(), now.getMonth(), 1);

    const repMap = {};
    emails.forEach(e => { repMap[e] = { thisWeek:0, lastWeek:0, thisMonth:0, lastVisit:null }; });
    rows.forEach(r => {
      const e = (r.owner_email || '').toLowerCase();
      if (!repMap[e]) return;
      const d = new Date(r.visited_at);
      if (d >= thisMonStart) repMap[e].thisWeek++;
      else if (d >= lastMonStart) repMap[e].lastWeek++;
      if (d >= monthStart) repMap[e].thisMonth++;
      if (!repMap[e].lastVisit || d > new Date(repMap[e].lastVisit)) repMap[e].lastVisit = r.visited_at;
    });

    // Account count per rep from portviewBulkData — quarterly target
    const _pvBulk = (typeof portviewBulkData !== 'undefined' && portviewBulkData) || [];
    const acctPerRep = {};
    emails.forEach(e => { acctPerRep[e] = 0; });
    _pvBulk.forEach(r => {
      const e = (r.kamEmail || '').toLowerCase();
      if (acctPerRep[e] !== undefined) acctPerRep[e]++;
    });

    // Quarterly visit count per rep
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1);
    emails.forEach(e => {
      repMap[e].thisQuarter = rows.filter(r =>
        (r.owner_email||'').toLowerCase() === e && new Date(r.visited_at) >= qStart
      ).length;
    });

    const totalThis  = emails.reduce((s,e) => s + repMap[e].thisWeek, 0);
    const avgThis    = emails.length ? (totalThis / emails.length).toFixed(1) : 0;
    const totalMonth = emails.reduce((s,e) => s + repMap[e].thisMonth, 0);
    // lowCount = reps who haven't visited all their accounts this quarter
    const lowCount   = emails.filter(e => {
      const tgt = acctPerRep[e] || 0;
      return tgt > 0 && repMap[e].thisQuarter < tgt;
    }).length;
    const todayStr   = now.toLocaleDateString('th-TH', {weekday:'short', day:'numeric', month:'short'});

    // Quarter label
    const qNum = Math.floor(now.getMonth()/3) + 1;
    const qLabel = `Q${qNum} ${now.getFullYear()}`;

    let html = `
<div style="padding:14px 14px 10px;flex-shrink:0;">
  <div class="sk-eyebrow sk-eyebrow-ac" style="margin-bottom:3px;">VISITS · สัปดาห์นี้</div>
  <div style="font-size:var(--text-xs);color:var(--sk-muted);font-family:'IBM Plex Mono','Noto Sans Thai',monospace;">${todayStr}</div>
</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 14px 14px;">
  <div style="background:var(--sk-surface);border-radius:var(--r-8);padding:10px 12px;">
    <div style="font-size:var(--text-2xl);font-weight:var(--fw-bold);color:var(--sk-ink);line-height:1;font-family:'IBM Plex Mono','Noto Sans Thai',monospace;">${totalThis}</div>
    <div class="sk-eyebrow" style="margin-top:3px;">visits/week</div>
  </div>
  <div style="background:var(--sk-surface);border-radius:var(--r-8);padding:10px 12px;">
    <div style="font-size:var(--text-2xl);font-weight:var(--fw-bold);color:var(--sk-ink);line-height:1;font-family:'IBM Plex Mono','Noto Sans Thai',monospace;">${avgThis}</div>
    <div class="sk-eyebrow" style="margin-top:3px;">avg/rep</div>
  </div>
  <div style="background:${lowCount > 0 ? 'rgba(255,56,92,.07)' : 'var(--sk-surface)'};border-radius:var(--r-8);padding:10px 12px;${lowCount > 0 ? 'border:1px solid rgba(255,56,92,.18);' : ''}">
    <div style="font-size:var(--text-2xl);font-weight:var(--fw-bold);color:${lowCount > 0 ? 'var(--sk-ac)' : 'var(--sk-ok)'};line-height:1;font-family:'IBM Plex Mono','Noto Sans Thai',monospace;">${lowCount}</div>
    <div class="sk-eyebrow" style="margin-top:3px;color:${lowCount > 0 ? 'var(--sk-ac)' : ''};">ไม่ครบ ${qLabel}</div>
  </div>
</div>`;

    const sorted = [...emails].sort((a,b) => repMap[b].thisWeek - repMap[a].thisWeek);
    html += `<div style="margin:0 14px;">`;
    sorted.forEach(email => {
      const d = repMap[email];
      // Name lookup: portviewBulkData first (most reliable for KAM/AD), then _skillUsers, then email prefix
      const _pvBulkNames = (typeof portviewBulkData !== 'undefined' && portviewBulkData) || [];
      const _pvNameMatch = _pvBulkNames.find(r => (r.kamEmail || '').toLowerCase() === email);
      const uKey = !_pvNameMatch && Object.keys(_skillUsers || {}).find(k => (_skillUsers[k].email || '').toLowerCase() === email);
      const uRec = uKey ? _skillUsers[uKey] : null;
      const rawName = (_pvNameMatch && (_pvNameMatch.kamName || ''))
        || (uRec && (uRec.kam_name || uRec.full_name))
        || email.split('@')[0];
      const nick    = _skNickname(rawName);
      const acctTgt = acctPerRep[email] || 0;
      const qPct    = acctTgt > 0 ? Math.min(100, Math.round((d.thisQuarter / acctTgt) * 100)) : 0;
      const isLow   = acctTgt > 0 && d.thisQuarter < acctTgt;
      const barColor = qPct >= 100 ? 'var(--sk-ok)' : qPct >= 60 ? 'var(--sk-warn)' : 'var(--sk-ac)';
      const isToday = d.lastVisit && new Date(d.lastVisit).toDateString() === now.toDateString();
      const lastStr = d.lastVisit
        ? new Date(d.lastVisit).toLocaleDateString('th-TH', {day:'numeric', month:'short'})
        : '—';
      html += `
<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:0.5px solid var(--sk-hairline);">
  <div style="width:28px;height:28px;border-radius:50%;background:var(--sk-ac-dim);border:1px solid rgba(255,56,92,.2);display:flex;align-items:center;justify-content:center;font-size:var(--text-xs);font-weight:var(--fw-bold);color:var(--sk-ac);flex-shrink:0;letter-spacing:-.02em;">${nick}</div>
  <div style="flex:1;min-width:0;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:3px;">
      <div style="font-size:var(--text-md);font-weight:var(--fw-semi);color:var(--sk-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${rawName}</div>
      ${acctTgt > 0 ? `<div style="font-size:var(--text-xs);color:var(--sk-muted);font-family:'IBM Plex Mono','Noto Sans Thai',monospace;flex-shrink:0;">${d.thisQuarter}/${acctTgt}</div>` : ''}
    </div>
    <div style="height:3px;background:var(--sk-hairline);border-radius:var(--r-xxs);overflow:hidden;">
      <div style="height:100%;width:${qPct}%;background:${barColor};border-radius:var(--r-xxs);transition:width .3s;"></div>
    </div>
  </div>
  <div style="text-align:right;flex-shrink:0;min-width:28px;">
    <div style="font-size:var(--text-lg);font-weight:var(--fw-bold);color:${isLow ? 'var(--sk-ac)' : 'var(--sk-ink)'};font-family:'IBM Plex Mono','Noto Sans Thai',monospace;line-height:1;">${d.thisWeek}</div>
    <div style="font-size:var(--text-xs);color:${isToday ? 'var(--sk-ok)' : 'var(--sk-muted)'};margin-top:2px;">${isToday ? '●วันนี้' : lastStr}</div>
  </div>
</div>`;
    });
    html += `</div>`;
    html += `<div style="padding:10px 14px 24px;text-align:center;"><span class="sk-eyebrow">เดือนนี้ ${totalMonth} visits · ${qLabel} เป้า 100% accounts</span></div>`;

    container.innerHTML = html;
  } catch(e) {
    console.warn('[Skills] _renderTLVisitContent:', e.message);
    container.innerHTML = _errMsg;
  }
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
      ? `<img src="${thumbUrl}" class="sk-row-thumb-img sk-img-lazy" alt="${meta.name}" onload="this.classList.add('sk-img-loaded')" onerror="this.classList.add('sk-img-loaded')"><div class="sk-row-thumb-fade"></div>`
      : `<div class="sk-row-thumb-img" style="background:${MODULE_BG[m]}"></div><div class="sk-row-thumb-fade"></div>`;
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
<div class="sk-mod-row${dimClass}" onclick="skillsOpenModule('${m}',this)">
  <div class="sk-row-thumb">${thumbHtml}</div>
  <div class="sk-row-info">
    <div class="sk-row-eye" style="color:${meta.color}">MODULE ${m} · ${defs.length} SKILLS</div>
    <div class="sk-row-name">${meta.name}</div>
    <div class="sk-row-sub">${meta.sub}</div>
    <div class="sk-row-badges">${stateBadge}</div>
  </div>
  <div class="sk-row-right">${ringSvg}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#BDBDBD" stroke-width="2.5" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg></div>
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
 // Option C: auto-reveal sheet after 600ms
  setTimeout(() => {
    const sh = document.getElementById('s3-sheet');
    if (sh && sh.classList.contains('s3-sheet-hidden')) {
      sh.classList.remove('s3-sheet-hidden');
      sh.classList.add('s3-sheet-peek');
    }
  }, 600);
  // Ambient bg
  if (heroUrl) {
    const ambEl = document.getElementById('s3-ambient-bg');
    if (ambEl) {
      ambEl.style.backgroundImage = `url(${heroUrl})`;
      setTimeout(() => ambEl.classList.add('loaded'), 50);
    }
  }
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
    const lockIco = state === 'locked'
      ? `<div class="sk-lock-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></div>` : '';
    const starIco = state === 'mastered'
      ? `<svg class="sk-master-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l4-4 5 3 5-3 4 4-2 3h-4l-3 8-3-8H5L3 9z"/></svg>` : '';
    const sparkHtml = ''; // foil/gleam style — no spark particles
    return `
<div class="sk-card state-${state}" onclick="skillsOpenDetail(${d.id})">
  <div class="sk-card-img" style="height:180px;width:100%;position:relative;overflow:hidden;">
    ${_skImgTag(d, { h:'180px', cls:'sk-card-img-inner' })}
    ${sparkHtml}
  </div>
  ${lockIco}${starIco}
  <div class="sk-card-body">
    <div class="sk-state-row"><div class="sk-dot"></div><span class="sk-state-label">${label}</span></div>
    <div class="sk-card-name">${d.skill_name_en}</div>
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
<div class="s2-screen">
  <div class="s2-scroll">
    <div class="s2-topbar">
      <button class="sk-back-btn s2-back" onclick="_renderSkillsScreen()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="15" height="15"><path d="M19 12H5M5 12l7 7M5 12l7-7"/></svg>
        <span>ทักษะ</span>
      </button>
    </div>
    <div class="s2-banner">
      ${charImg}
      <div class="s2-banner-gradient"></div>
      <div class="s2-banner-overlay">
        <div class="s2-banner-mod-eye">Module ${module} · ${defs.length} Skills</div>
        <div class="s2-banner-title">${meta.name}</div>
        <div class="s2-banner-sub">${meta.sub}</div>
      </div>
    </div>
    <div class="sk-grid s2-grid">${cards}</div>
  </div>
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

  const modCode = def.skill_code.split('_')[0];
  const heroUrl = _skUrl(def.card_image_url);
  const heroImg = heroUrl
    ? `<img src="${heroUrl}" class="s3-hero-img sk-img-lazy" alt="${def.skill_name_en}" onload="this.classList.add('sk-img-loaded')" onerror="this.classList.add('sk-img-loaded')">`
    : `<div style="width:100%;height:100%;background:${MODULE_BG[def.module]};"></div>`;
  const teaserText = def.principle_th ? def.principle_th.split(/[.。]/)[0] : (def.skill_name_th || def.skill_name_en);

  // CTA based on state — suppress for TL in browse mode
  let cta = '';
  const _isTLBrowse = _tlBrowseMode && (
    _skillsRole === 'sales_tl' || _skillsRole === 'tl' ||
    _skillsRole === 'admin'    || _skillsRole === 'ad_tl');
  if (_isTLBrowse) {
    cta = `<div style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:100px;background:var(--sk-surface);font-size:var(--text-xs);font-weight:var(--fw-semi);color:var(--sk-muted);font-family:'IBM Plex Mono','Noto Sans Thai',monospace;letter-spacing:.08em;text-transform:uppercase;">READ ONLY</div>`;
  } else if (state === 'locked') {
    cta = `<button class="sk-cta-btn sk-cta-primary" onclick="skillsStartTraining(${skillId})">เริ่มฝึก</button>`;
  } else if (state === 'training') {
    cta = `
<div class="sk-rep-hint">รอ TL ประเมินเพื่อ unlock ทักษะนี้</div>
<button class="sk-cta-btn sk-cta-outline" onclick="_skToast('ส่งแล้ว — TL จะเห็นในรายการรอประเมิน')">แจ้ง TL ขอรับการประเมิน</button>`;
  }

  // ── RENDER SHELL IMMEDIATELY (no flash) ──────────────────
  scr.innerHTML = `
<div class="s3-detail" id="s3-detail-wrap">
  <div class="s3-hero">
    ${heroImg}
    <div class="s3-hero-gradient"></div>
  </div>
  <div class="s3-topbar">
    <button class="s3-back" onclick="skillsOpenModule('${def.module}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="15" height="15"><path d="M19 12H5M5 12l7 7M5 12l7-7"/></svg>
      Module ${def.module}
    </button>
    <span class="s3-code-pill">${modCode}</span>
  </div>
  <div class="s3-sheet s3-sheet-peek" id="s3-sheet">
    <div class="s3-sheet-handle" onclick="_s3ToggleSheet()" style="cursor:pointer;padding:6px 0 2px;"></div>
    <!-- Peek: title + principle always visible -->
    <div class="s3-peek-static" style="padding:0 16px 4px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <div class="sk-state-pill pill-${state}"><div class="sk-pill-dot"></div>${SKILL_STATE_LABEL_TH[state]}</div>
            <span class="sk-detail-code" style="font-size:var(--text-sm);color:#6A6A6A;">${def.skill_name_en} · ${modCode}</span>
          </div>
          <div style="font-size:var(--text-xl3);font-weight:800;color:var(--sk-ink);line-height:1.2;margin-bottom:10px;font-family:'Noto Sans Thai',sans-serif;">${def.skill_name_th || def.skill_name_en}</div>
          ${def.principle_th ? `
          <div class="sk-rubric-eye" style="margin-bottom:5px;">Principle — ทำไมสกิลนี้สำคัญ</div>
          <div class="sk-rubric-text" style="white-space:pre-wrap;">${def.principle_th}</div>` : ''}
        </div>
        <svg class="s3-expand-chevron" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2" stroke-linecap="round" width="20" height="20" style="flex-shrink:0;margin-top:4px;margin-left:10px;" onclick="_s3ToggleSheet()"><path d="M18 15l-6-6-6 6"/></svg>
      </div>
    </div>
    <!-- Expanded-only: practice + pass test + cta -->
    <div class="sk-detail-body s3-body-full" id="s3-body-content">
  <div class="sk-skill-title">${def.skill_name_th || def.skill_name_en}</div>

  ${def.principle_th ? `
  <div class="sk-rubric-block">
    <div class="sk-rubric-eye">Principle — ทำไมสกิลนี้สำคัญ</div>
    <div class="sk-rubric-text" style="white-space:pre-wrap">${def.principle_th}</div>
  </div>
  <div class="sk-divider"></div>` : ''}

  ${def.practice_th ? `
  <div class="sk-rubric-block">
    <div class="sk-rubric-eye">Practice — ต้องทำอะไร</div>
    <div class="sk-rubric-text">${(def.practice_th.includes('\n') ? def.practice_th.split('\n') : def.practice_th.split('|')).map(t => t.trim()).filter(Boolean).map(t => t.startsWith('#') ? '<span style="font-weight:var(--fw-semi);color:var(--sk-ink);display:block;margin-top:8px;margin-bottom:2px">' + t.slice(1).trim() + '</span>' : '<span style="display:block;padding-left:10px">• ' + t + '</span>').join('')}</div>
  </div>
  <div class="sk-divider"></div>` : ''}

  ${def.pass_test_th ? `
  <div class="sk-rubric-block">
    <div class="sk-rubric-eye">Pass Test — เกณฑ์ผ่าน</div>
    <div class="sk-rubric-text">${(def.pass_test_th.includes('\n') ? def.pass_test_th.split('\n') : def.pass_test_th.split('/')).map((t,i) => t.trim()).filter(Boolean).map((t,i) => (i+1)+'. '+t).join('<br>')}</div>
  </div>
  <div class="sk-divider"></div>` : ''}

  ${cta}
  <div id="s3-async-section"></div>
    </div>
  </div>
</div>`;

  // ── Setup hero, parallax, ambient ────────────────────────
  if (scr._s3ScrollHandler) scr.removeEventListener('scroll', scr._s3ScrollHandler);
  scr._s3ScrollHandler = function() {
    var hero = document.querySelector('.s3-hero');
    if (hero) hero.style.transform = 'translateY(' + Math.min(scr.scrollTop * 0.4, 60) + 'px)';
  };
  scr.addEventListener('scroll', scr._s3ScrollHandler, {passive:true});

  const detailEl = document.getElementById('s3-detail-wrap');
  if (detailEl) detailEl.style.height = window.innerHeight + 'px';

  const sh = document.getElementById('s3-sheet');
  if (sh) {
    sh.classList.remove('s3-sheet-hidden');
    sh.classList.add('s3-sheet-peek');
  }
  if (heroUrl && detailEl) {
    detailEl.style.setProperty('--s3-ambient-url', `url(${heroUrl})`);
    setTimeout(() => detailEl.classList.add('s3-ambient-loaded'), 50);
  }
  _markLoadedImages(scr);

  // ── FETCH log + echo AFTER render (no blocking flash) ────
  let logs = [];
  try {
    logs = await _skFetch(`${SKILLS_TABLE_LOG}?skill_id=eq.${skillId}&user_id=eq.${_skillsUserId}&order=changed_at.desc&limit=10`);
  } catch(_) {}

  const asyncSection = document.getElementById('s3-async-section');
  if (!asyncSection || _activeSkillId !== skillId) return; // navigated away

  const logRows = (logs || []).map(l => `
<div class="sk-log-row">
  <div class="sk-log-dot ${l.new_state}"></div>
  <div>
    <div class="sk-log-state">${SKILL_STATE_LABEL_TH[l.new_state] || l.new_state}${l.comment ? ` — ${l.comment}` : ''}</div>
    <div class="sk-log-meta">${l.changed_at ? new Date(l.changed_at).toLocaleDateString('th-TH') : ''}</div>
  </div>
</div>`).join('');

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

  asyncSection.innerHTML = `${echoSection}${logRows ? `<div class="sk-log-eye">History</div>${logRows}` : ''}`;
}
// ── S3 sheet peek/expand toggle ────────────────────────────
function _s3ToggleSheet() {
  const sheet = document.getElementById('s3-sheet');
  if (!sheet) return;
  const isExpanded = sheet.classList.contains('s3-sheet-expanded');
  sheet.classList.remove('s3-sheet-hidden','s3-sheet-peek','s3-sheet-expanded');
  sheet.classList.add(isExpanded ? 's3-sheet-peek' : 's3-sheet-expanded');
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
        owner_email: (typeof currentUserProfile !== 'undefined' && currentUserProfile)
                      ? (currentUserProfile.email || '').toLowerCase()
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
  return _renderTLPendingContent();
}

function _renderTLPending() { return _renderTLPendingContent(); }

function _renderTLPendingContent() {
  const prog    = window._tlProgFiltered || _skillProg;
  const pending = Object.values(prog).filter(p => p.state === 'training');
  pending.sort((a,b) => new Date(a.updated_at||0) - new Date(b.updated_at||0));
  const pendCount = pending.length;

  const rows = pending.map(p => {
    const def = _skillDefs.find(d => d.id === p.skill_id);
    if (!def) return '';
    const code = def.skill_code.split('_')[0];
    const daysAgo = p.updated_at
      ? Math.floor((Date.now() - new Date(p.updated_at)) / 86400000) : null;
    const dateLabel = daysAgo === null ? '' : daysAgo === 0 ? 'today' : `${daysAgo} day${daysAgo>1?'s':''} ago`;
    const initials  = _skUserInitials(p.user_id);
    const repName   = _skUserName(p.user_id);

    // Echo strip: แสดงเฉพาะ pass / developing เท่านั้น
    const echoObs = _tlEchoObs(p.user_id, def.skill_code)
      .filter(o => o.ai_score === 'pass' || o.ai_score === 'developing')
      .slice(0, 1)[0];
    const echoStrip = echoObs ? (() => {
      const col = _echoScoreColor(echoObs.ai_score);
      const lbl = _echoScoreLabel(echoObs.ai_score);
      const dt  = new Date(echoObs.observed_at).toLocaleDateString('th-TH',{day:'numeric',month:'short'});
      const ev  = echoObs.evidence
        ? `<div class="sk-pend-echo-ev">${echoObs.evidence.slice(0,80)}${echoObs.evidence.length>80?'…':''}</div>`
        : '';
      return `<div class="sk-pend-echo-strip">`
        + `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0014 0M12 19v3M9 22h6"/></svg>`
        + `<span class="sk-pend-echo-date">${dt}</span>`
        + `<span class="sk-pend-echo-score" style="color:${col};">${lbl}</span>`
        + `</div>${ev}`;
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
  <div class="sk-pend-right" style="align-self:flex-start;min-width:72px;align-items:flex-end;">
    <div class="sk-state-pill-sm"><div class="sk-pill-dot-sm"></div>Training</div>
    <svg class="sk-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
  </div>
</div>`;
  }).join('');

  if (pendCount === 0) return `
<div class="sk-empty">
  <svg class="sk-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
  <div class="sk-empty-title">ไม่มีรายการรอประเมิน</div>
  <div class="sk-empty-sub">ไม่มีทักษะที่รอการประเมิน</div>
</div>`;

  return `
<div style="padding:12px 14px 4px;"><span class="sk-eyebrow">เรียงตาม · รอนานสุด</span></div>
<div class="sk-pend-list">${rows}</div>`;
}

function _renderTLOverview() { return _renderTLOverviewContent(); }

function _renderTLOverviewContent() {
  const allProg  = Object.values(window._tlProgFiltered || _skillProg);
  const total    = allProg.length;
  const unlocked = allProg.filter(p => p.state==='unlocked'||p.state==='mastered').length;
  const pct      = total > 0 ? Math.round(unlocked/total*100) : 0;

  const byRepToggle   = _ovToggle === 'rep'   ? 'sk-tab-on' : '';
  const bySkillToggle = _ovToggle === 'skill' ? 'sk-tab-on' : '';

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
      return `
<div class="sk-rep-row" onclick="skillsTLOpenRepDetail('${uid}')">
  <div class="sk-rep-avatar">${_skUserInitials(uid)}</div>
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
    const skillRows = ['A','B','C','D'].map(m => {
      const defs = _skillDefs.filter(d => d.module === m);
      if (!defs.length) return '';
      // userCount = จำนวน reps จริงในทีม ไม่ใช่จำนวนที่มี progress rows
      const userCount = _tlSquadEmails.length > 0 ? _tlSquadEmails.length : (Object.keys(userMap).length || 1);
      const hd = `<div class="sk-skill-mod-hd">Module ${m} — ${MODULE_META[m].sub}</div>`;
      const rows = defs.map(d => {
        const progs     = allProg.filter(p => p.skill_id === d.id);
        const passCount = progs.filter(p => p.state==='unlocked'||p.state==='mastered').length;
        const pct3      = Math.round(passCount/userCount*100);
        const fillCls   = pct3 === 0 ? 'sk-skill-fill-zero' : pct3 < 40 ? 'sk-skill-fill-low' : 'sk-skill-fill-ok';
        const dotCls    = pct3 === 0 ? 'sk-warn-dot-ac'     : pct3 < 40 ? 'sk-warn-dot-warn'   : 'sk-warn-dot-ok';
        const code      = d.skill_code.split('_')[0];
        return `
<div class="sk-skill-row">
  <div class="sk-warn-dot ${dotCls}" style="flex-shrink:0;margin-top:3px;"></div>
  <div class="sk-skill-info" style="flex:1;min-width:0;">
    <div style="display:flex;align-items:center;gap:5px;">
      <span class="sk-skill-code">${code}</span>
      <span class="sk-skill-name">${d.skill_name_en}</span>
    </div>
    <div class="sk-skill-bar-row">
      <div class="sk-skill-track"><div class="sk-skill-fill ${fillCls}" style="width:${pct3}%;"></div></div>
      <span class="sk-skill-count">${passCount}/${userCount} คน</span>
    </div>
  </div>
</div>`;
      }).join('');
      return hd + rows;
    }).join('');
    viewContent = `
<div class="sk-skill-list">${skillRows}</div>
<div style="padding:10px 14px;display:flex;gap:12px;flex-wrap:wrap;">
  <div style="display:flex;align-items:center;gap:5px;"><div class="sk-warn-dot sk-warn-dot-ac"></div><span class="sk-eyebrow">0 passed</span></div>
  <div style="display:flex;align-items:center;gap:5px;"><div class="sk-warn-dot sk-warn-dot-warn"></div><span class="sk-eyebrow">&lt;40% อ่อน</span></div>
  <div style="display:flex;align-items:center;gap:5px;"><div class="sk-warn-dot sk-warn-dot-ok"></div><span class="sk-eyebrow">≥40% ดี</span></div>
</div>`;
  }

  // Hero stat — flat white, ไม่มี card wrapper
  return `
<div style="padding:12px 14px 0;display:flex;align-items:flex-end;justify-content:space-between;">
  <div>
    <div style="font-size:var(--text-kpi);font-weight:var(--fw-bold);color:var(--sk-ink);letter-spacing:-.03em;line-height:1;">${unlocked}<span style="font-size:var(--text-base);font-weight:var(--fw-medium);color:var(--sk-muted);">/${total}</span></div>
    <div style="font-size:10.5px;color:var(--sk-muted);margin-top:2px;">ทีม unlock แล้ว</div>
  </div>
  <div style="font-size:var(--text-2xl);font-weight:var(--fw-bold);color:var(--sk-ac);">${pct}%</div>
</div>
<div style="margin:8px 14px 0;height:3px;background:var(--sk-hairline);border-radius:var(--r-xxs);overflow:hidden;">
  <div style="height:100%;border-radius:var(--r-xxs);background:var(--sk-ac);width:${pct}%;"></div>
</div>
<div style="display:flex;justify-content:space-between;margin:3px 14px 0;font-size:7.5px;color:var(--sk-muted);">
  <span>${unlocked} UNLOCKED</span><span>${total-unlocked} REMAINING</span>
</div>
<div class="sk-view-toggle" style="margin-top:10px;">
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
    training: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    unlocked: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    mastered: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
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
<div style="position:relative;width:100%;overflow:hidden;">
  ${_skImgTag(def, { w:'100%', h:'260px', cls:'sk-img-lazy' })}
  <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.42) 0%,transparent 45%,rgba(0,0,0,.58) 100%);pointer-events:none;"></div>
  <div style="position:absolute;top:0;left:0;right:0;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;z-index:10;">
    <button onclick="_skSetView('pending');_renderSkillsScreen()" style="display:inline-flex;align-items:center;gap:5px;background:rgba(0,0,0,.32);border:none;border-radius:var(--r-pill);padding:6px 12px;cursor:pointer;font-family:'Noto Sans Thai',sans-serif;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2"><path d="M19 12H5M5 12l7 7M5 12l7-7"/></svg>
      <span style="font-size:var(--text-md);font-weight:var(--fw-semi);color:var(--tk-text-primary);">รอประเมิน</span>
    </button>
    <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);color:rgba(255,255,255,.85);background:rgba(124,58,237,.45);border-radius:var(--r-pill);padding:3px 9px;font-family:'Noto Sans Thai',sans-serif;backdrop-filter:blur(4px);">TL</div>
  </div>
  <div style="position:absolute;bottom:0;left:0;right:0;padding:16px 16px 18px;">
    <div style="font-size:var(--text-2xs);font-weight:var(--fw-bold);letter-spacing:.12em;text-transform:uppercase;color:var(--tk-text-secondary);font-family:'IBM Plex Mono','Noto Sans Thai',monospace;">${modCode}</div>
    <div style="font-size:var(--text-2xl);font-weight:var(--fw-bold);color:var(--tk-text-primary);line-height:1.2;margin-top:2px;">${def.skill_name_en}</div>
    <div class="sk-state-pill pill-${state}" style="margin-top:8px;display:inline-flex;"><div class="sk-pill-dot"></div>${SKILL_STATE_LABEL_TH[state]}</div>
  </div>
</div>
<div class="sk-detail-body">
  <div class="sk-rubric-block" style="margin-top:14px;">
    <div class="sk-rubric-eye">Pass Test — เกณฑ์ผ่าน</div>
    <div class="sk-rubric-text">${((def.pass_test_th||'').includes('\n') ? (def.pass_test_th||'').split('\n') : (def.pass_test_th||'').split('/')).map((t,i)=>t.trim()).filter(Boolean).map((t,i)=>(i+1)+'. '+t).join('<br>')}</div>
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
    const _existingRow = _skillProg[_tlProgKey] || {};
    const _existingName = _existingRow.user_name || null;
    const _existingEmail = _existingRow.owner_email || null;
    await _skFetch(`${SKILLS_TABLE_PROG}?user_id=eq.${userId}&skill_id=eq.${skillId}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        state:        newState,
        evaluated_by: _skillsUserId,
        evaluated_at: new Date().toISOString(),
        notes:        note || null,
        user_name:    _existingName || _skUserName(userId) || null,
        owner_email:  _existingEmail || null,
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
    <div class="sk-det-dot" style="background:${window._skStateDotColor ? window._skStateDotColor(d.skill_code, s) : `var(--sk-state-${s})`};"></div>${SKILL_STATE_LABEL_TH[s]}
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
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:var(--text-xs);font-weight:var(--fw-bold);color:var(--sk-ac);font-family:'Noto Sans Thai',sans-serif;">${uCount}/${uTotal}</div>
    </div>
  </div>
  <div class="sk-filter-row">
    <span class="sk-fpill" id="fp-notyet" onclick="_skRepFilter(false,'${userId}')">ยังไม่ผ่าน</span>
    <span class="sk-fpill sk-fpill-on" id="fp-all" onclick="_skRepFilter(true,'${userId}')">ดูทั้งหมด</span>
  </div>
  <div class="sk-det-skill-list" id="rep-det-list">${renderList(true)}</div>
  ${_buildEchoSparkSection(userId)}
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
    <div class="sk-det-dot" style="background:${window._skStateDotColor ? window._skStateDotColor(d.skill_code, s) : `var(--sk-state-${s})`};"></div>${SKILL_STATE_LABEL_TH[s]}
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
function _skSetOvToggle(v) { _ovToggle = v; if (typeof _renderTLContent === 'function') { _renderTLContent(); } else { _renderSkillsScreen(); } }

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

// ── Micro-interaction helpers ─────────────────────────
function _skCardRipple(el) {
  if (!el) return;
  el.style.transition = 'transform .12s cubic-bezier(.32,.72,0,1)';
  el.style.transform = 'scale(.97)';
  setTimeout(function(){ el.style.transform=''; el.style.transition=''; }, 200);
}

function _skShowSkeleton(scr) {
  if (!scr) return;
  var rows = [1,2,3,4].map(function(){ return '<div class="sk-skeleton-row"><div class="sk-skel-thumb sk-shimmer"></div><div class="sk-skel-body"><div class="sk-skel-line w70 sk-shimmer"></div><div class="sk-skel-line w50 sk-shimmer"></div></div></div>'; }).join('');
  scr.innerHTML = '<div class="sk-skeleton-wrap">' + rows + '</div>';
}

// ── Expose globals ─────────────────────────────────────────
window.skillsInit              = skillsInit;
window.skillsOpenModule        = skillsOpenModule;
window.skillsOpenDetail        = skillsOpenDetail;
window.skillsStartTraining     = skillsStartTraining;
window.skillsTLOpenEval        = skillsTLOpenEval;
window.skillsTLSave            = skillsTLSave;
// ── Echo Session Sparkline (TL rep detail) ─────────────────────────────────
// แสดง skill score trend ย้อนหลัง 10 sessions ต่อ rep
// อ่านจาก _echoObsTL ที่โหลดไว้แล้ว

function _buildEchoSparkSection(userId) {
  // รวม observations ทุก skill ของ user นี้ sort by date
  const allObs = [];
  Object.entries(_echoObsTL).forEach(([key, rows]) => {
    if (!key.startsWith(userId + ':')) return;
    const skillCode = key.split(':').slice(1).join(':');
    rows.forEach(r => allObs.push({ ...r, skill_code: skillCode }));
  });
  if (!allObs.length) return '';

  // Group by session (observed_at date) — แต่ละวัน = 1 session
  const bySession = {};
  allObs.forEach(r => {
    const day = (r.observed_at || '').slice(0, 10);
    if (!bySession[day]) bySession[day] = [];
    bySession[day].push(r);
  });
  const sessions = Object.entries(bySession)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 10);

  if (!sessions.length) return '';

  // Per-skill trend: last 10 sessions
  // Get skill codes that appear
  const skillSet = new Set(allObs.map(r => r.skill_code));
  const skillCodes = [...skillSet].slice(0, 11); // max 11 skills

  const scoreVal = s => s === 'pass' ? 2 : s === 'developing' ? 1 : 0;
  const scoreCol = s => s === 'pass' ? '#34C759' : s === 'developing' ? '#FF9500' : '#E5E5EA';

  // Build sparkline rows — one per skill
  const sparkRows = skillCodes.map(code => {
    const shortCode = code.split('_')[0];
    // Latest score for this skill
    const latestObs = (allObs.filter(r => r.skill_code === code)
      .sort((a, b) => (b.observed_at||'').localeCompare(a.observed_at||'')))[0];
    const latestScore = latestObs?.ai_score || 'not_observed';
    const latestCol   = scoreCol(latestScore);

    // Dots for last 10 sessions (oldest → newest left to right)
    const sessionDays = sessions.map(([day]) => day).reverse(); // oldest first
    const dots = sessionDays.map(day => {
      const obs = bySession[day]?.find(r => r.skill_code === code);
      const sc  = obs?.ai_score || null;
      // v569: module-hued dots — state encoded by tint, hue by module
      const col = sc ? (typeof window._skDotColor==='function' ? window._skDotColor(code, sc) : scoreCol(sc)) : '#F2F2F7';
      return `<span style="width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0;display:inline-block"></span>`;
    }).join('');

    const def = Array.isArray(_skillDefs) ? _skillDefs.find(d => d.skill_code === code || d.skill_code.startsWith(code + '_')) : null;
    const skillLabel = def ? (def.skill_name_th || def.skill_name_en || shortCode) : shortCode;
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:0.5px solid #F7F7F7">
  <span style="font-size:var(--text-sm);font-weight:var(--fw-medium);color:var(--sk-ink,#222);font-family:'Noto Sans Thai',sans-serif;flex:0 0 96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${skillLabel}</span>
  <div style="display:flex;gap:3px;align-items:center;flex:1">${dots}</div>
  <span style="font-size:var(--text-xs);font-weight:var(--fw-medium);color:${latestCol};font-family:'Noto Sans Thai',sans-serif;min-width:52px;text-align:right">${latestScore==='pass'?'ผ่าน':latestScore==='developing'?'กำลังพัฒนา':'—'}</span>
</div>`;
  }).join('');

  // Legend header with session count labels (newest = rightmost)
  const sessionLabels = sessions.map(([day]) => {
    const d = new Date(day);
    return d.toLocaleDateString('th-TH', { day:'numeric', month:'short' });
  }).reverse().map(l =>
    `<span style="font-size:var(--text-2xs);color:#8E8E93;font-family:'Noto Sans Thai',sans-serif;flex:1;text-align:center;overflow:hidden">${l}</span>`
  ).join('');

  return `
<div style="margin-top:16px;padding:0 14px;">
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;padding-bottom:8px;border-bottom:0.5px solid var(--sk-hairline,#EBEBEB);">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--sk-ac,#FF385C)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0014 0M12 19v3M9 22h6"/></svg>
    <span style="font-size:var(--text-sm);font-weight:var(--fw-semi);color:var(--sk-ink,#222);font-family:'Noto Sans Thai',sans-serif;letter-spacing:.01em;">Echo Skill Trend</span>
    <span style="font-size:var(--text-xs);color:var(--sk-muted,#6A6A6A);font-family:'Noto Sans Thai',sans-serif;">${sessions.length} sessions ล่าสุด</span>
  </div>
  <div style="display:flex;gap:8px;align-items:center;padding:0 0 4px;padding-left:104px;">
    ${sessionLabels}
    <span style="min-width:52px;"></span>
  </div>
  ${sparkRows}
  <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:8px;padding-top:6px;border-top:0.5px solid var(--sk-hairline,#EBEBEB);">
    ${['A','B','C','D'].map(m => `<span style="display:flex;align-items:center;gap:4px;font-size:var(--text-xs);color:var(--sk-muted,#6A6A6A);font-family:'Noto Sans Thai',sans-serif"><span style="width:7px;height:7px;border-radius:50%;background:${MODULE_META[m].color};display:inline-block"></span>${MODULE_META[m].name.replace('The ','')}</span>`).join('')}
    <span style="font-size:var(--text-xs);color:var(--sk-muted,#6A6A6A);font-family:'Noto Sans Thai',sans-serif;margin-left:auto">สีเต็ม = ผ่าน · สีจาง = ยังไม่ผ่าน</span>
  </div>
</div>`;
}


window._skSetView              = _skSetView;
window._skSetOvToggle          = _skSetOvToggle;
window._skTLSelectState        = _skTLSelectState;
window._skRepFilter            = _skRepFilter;
window._renderSkillsScreen     = _renderSkillsScreen;
window._renderTLContent        = _renderTLContent;
window._s3ToggleSheet          = _s3ToggleSheet;
window._skCardRipple           = _skCardRipple;

