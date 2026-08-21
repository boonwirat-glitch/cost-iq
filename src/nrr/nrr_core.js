// ── nrr_core.js — auth, role gate, format helpers, CountUp ───────────────
// Auth pattern ported from src/dashboard/dash_core.js (same Supabase
// project, same profiles table). Role gate is intentionally narrower than
// /dashboard's: only 'tl'/'admin'/'rep' get in, because _qnrrCompute's scope
// logic (nrr_logic.js) only defines real behavior for scope 'kam'/'tl'/
// 'admin' — sales_tl/ad_tl have no defined NRR-scope semantics in the
// actual business logic, so letting them in would show meaningless numbers.
// 'rep' (added Phase B, 2026-07-09) maps to scope 'kam' — reps only ever
// see the Portfolio layer (nrr_router.js's guard confines them there),
// never the tl/admin dashboard. 'ad' and 'pm' (added 2026-07-17) are
// normalized into 'rep' here too — same own-portfolio-only KAM scope,
// no separate ad/pm semantics anywhere downstream.

var SUPA_URL = 'https://menslbnyyvpxiyvjywcm.supabase.co';
var SUPA_KEY = 'sb_publishable_DRCzHd782Gry8Edu4ZIiHA_KuOgBIIG';
var NRR_ALLOWED_ROLES = ['tl', 'admin', 'team_lead', 'team lead', 'rep'];

var supa = null;
var nrrProfile = null;

// ── v_quotaguard (2026-08-21): /nrr ต้องรอดตอน Supabase ตอบไม่ได้ ──────────────
//
// เดิม /nrr ไม่มีทางถอยเลย: getSession ไม่ได้ session → nrrShowAuth() ปิดตาย และถ้า
// อ่าน profiles ไม่ได้ก็ signOut() ทิ้งเลย ⇒ ตอน Supabase ตอบ 402 (เกินโควตา) จะ
// เข้าไม่ได้ทั้งที่ข้อมูลที่หน้านี้ใช้แสดงผลเกือบทั้งหมดมาจาก R2 ซึ่งยังทำงานปกติดี
//
// พอร์ตกติกาเดียวกับ Sense (src/01_core.js v_quotaguard): 402/408/429/5xx =
// "ตอบไม่ได้" ไม่ใช่ "ไม่มีสิทธิ์" · ห้ามรวม 400/401/403 เพราะนั่นคือคำตัดสินจริง
var NRR_LAST_ID_KEY = 'nrr_last_identity_v1';
var NRR_LAST_ID_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function nrrAuthUnknown(resp) {
  var e = resp && resp.error;
  if (!e) return false;
  var st = Number(e.status || e.statusCode || 0);
  if (st === 402 || st === 408 || st === 429 || (st >= 500 && st <= 599)) return true;
  var m = String(e.message || '').toLowerCase();
  return /failed to fetch|network|load failed|timed? ?out|econn|quota|exceeded/.test(m);
}

function nrrLastIdentitySave(email, role, name) {
  try {
    localStorage.setItem(NRR_LAST_ID_KEY, JSON.stringify({
      email: email || '', role: role || '', name: name || '', savedAt: Date.now()
    }));
  } catch (e) {}
}
function nrrLastIdentityGet() {
  try {
    var o = JSON.parse(localStorage.getItem(NRR_LAST_ID_KEY) || 'null');
    if (!o || !o.email || !o.savedAt) return null;
    if (Date.now() - o.savedAt > NRR_LAST_ID_TTL_MS) return null;
    if (!NRR_ALLOWED_ROLES.includes(o.role)) return null;
    return o;
  } catch (e) { return null; }
}
function nrrLastIdentityClear() { try { localStorage.removeItem(NRR_LAST_ID_KEY); } catch (e) {} }

// เข้าโหมดดูอย่างเดียว — ใช้สิทธิ์ที่จำไว้ พร้อมแถบบอกผู้ใช้ตรงๆ ห้ามเงียบ
function nrrEnterReadOnly(reason) {
  var last = nrrLastIdentityGet();
  if (!last) return false;
  console.warn('[nrr] หลังบ้านตอบไม่ได้ (' + reason + ') — เข้าโหมดดูอย่างเดียวด้วยสิทธิ์ที่จำไว้');
  nrrProfile = { role: last.role, email: last.email, name: last.name || last.email };
  window.NRR_READONLY = true;
  nrrShowApp();
  try {
    var b = document.createElement('div');
    b.id = 'nrr-readonly-banner';
    b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;' +
      'background:rgba(120,72,10,.97);color:#FFE7C2;padding:8px 14px;font-size:13px;' +
      "line-height:1.45;text-align:center;font-family:'Noto Sans Thai',sans-serif";
    b.innerHTML = '⚠️ <b>โหมดดูอย่างเดียว</b> — ระบบหลังบ้านตอบไม่ได้ชั่วคราว ' +
      'ตัวเลขยังใช้ได้ แต่บันทึกหรือแก้ไขอะไรไม่ได้';
    document.body.appendChild(b);
  } catch (e) {}
  if (typeof nrrInitApp === 'function') nrrInitApp();
  return true;
}

function nrrNormalizeRole(r) {
  var s = String(r || '').trim().toLowerCase();
  if (['team_lead', 'team lead', 'tl'].includes(s)) return 'tl';
  if (s === 'admin') return 'admin';
  // ad (Account Development) and pm (Project/Portfolio Manager) use the same
  // KAM data stack as rep in Sense — own-portfolio-only, never admin/tl
  // scope. Fixed 2026-07-17: 'ad' used to collapse into 'admin' here, which
  // silently gave any AD user full /nrr admin access instead of their own
  // portfolio — folding into 'rep' scope instead fixes that bug too.
  if (['rep', 'ad', 'pm'].includes(s)) return 'rep';
  return s || '';
}

function nrrRoleLabel(role) {
  if (role === 'tl') return 'Team Lead';
  if (role === 'admin') return 'Admin';
  if (role === 'rep') return 'Rep';
  return role || '—';
}
window.nrrRoleLabel = nrrRoleLabel;

window.addEventListener('DOMContentLoaded', async function () {
  supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);

  try {
    var sessionResp = await supa.auth.getSession();
    var session = sessionResp.data.session;
    if (session) await nrrOnSessionReady(session);
    // v_quotaguard: ไม่มี session เพราะ "ตอบไม่ได้" ≠ ไม่มีสิทธิ์ — ลองโหมดดูอย่างเดียว
    // ก่อนปิดประตู · ถ้าไม่มีสิทธิ์ที่จำไว้ ค่อยขึ้นหน้าล็อกอินตามเดิม
    else if (!(nrrAuthUnknown(sessionResp) && nrrEnterReadOnly('getSession'))) nrrShowAuth();
  } catch (e) {
    console.error('[nrr] auth_init', e.message);
    // โยน exception = เน็ตล่ม/timeout ก็เข้าเกณฑ์ "ตอบไม่ได้" เหมือนกัน
    if (!nrrEnterReadOnly('auth_init_throw')) {
      nrrShowAuth();
      nrrShowAuthError('เชื่อมต่อระบบไม่ได้ — กรุณาลองใหม่');
    }
  }

  supa.auth.onAuthStateChange(async function (event, session) {
    if (event === 'SIGNED_IN' && session) {
      await nrrOnSessionReady(session);
    } else if (event === 'SIGNED_OUT') {
      nrrShowAuth();
    }
  });
});

async function nrrOnSessionReady(session) {
  try {
    var profResp = await supa.from('profiles').select('*').eq('id', session.user.id).single();
    var profile = profResp.data;
    var role = nrrNormalizeRole(profile && profile.role || session.user.user_metadata && session.user.user_metadata.role || '');

    // v_quotaguard: อ่าน profiles ไม่ได้เพราะ "ตอบไม่ได้" ต้องไม่ signOut ทิ้ง
    // ของเดิมตกมาที่ role = '' แล้วเข้าเงื่อนไขข้างล่าง → signOut() → ล็อกอินกลับก็
    // ไม่ได้เพราะโดนตัดเหมือนกัน ⇒ ผู้ใช้เข้าไม่ได้ถาวรจนโควตากลับมา
    if (!profile && nrrAuthUnknown(profResp)) {
      if (nrrEnterReadOnly('profiles')) return;
    }

    if (!NRR_ALLOWED_ROLES.includes(role)) {
      await supa.auth.signOut();
      nrrLastIdentityClear();   // ไม่มีสิทธิ์จริง = ต้องไม่เหลือทางเข้าโหมดดูอย่างเดียว
      nrrShowAuthError('บัญชีนี้ไม่มีสิทธิ์เข้าใช้หน้านี้');
      return;
    }

    nrrProfile = { role: role, email: session.user.email, name: (profile && profile.full_name) || session.user.email };
    // v_quotaguard: จำสิทธิ์ไว้เพื่อให้เข้าโหมดดูอย่างเดียวได้ถ้าหลังบ้านล่มวันหลัง
    nrrLastIdentitySave(nrrProfile.email, role, nrrProfile.name);
    nrrShowApp();
    if (typeof nrrInitApp === 'function') nrrInitApp();
  } catch (e) {
    console.error('[nrr] on_session_ready', e.message);
    // v_quotaguard: ล้มด้วย exception ก็ถือว่า "ตอบไม่ได้" — ลองโหมดดูอย่างเดียวก่อน
    if (!nrrEnterReadOnly('on_session_ready_throw')) {
      nrrShowAuthError('เกิดข้อผิดพลาด — กรุณา refresh หน้า');
    }
  }
}

function nrrShowAuth() {
  var a = document.getElementById('nrr-auth-overlay');
  var app = document.getElementById('nrr-app');
  if (a) a.style.display = 'flex';
  if (app) app.style.display = 'none';
}
function nrrShowApp() {
  var a = document.getElementById('nrr-auth-overlay');
  var app = document.getElementById('nrr-app');
  if (a) a.style.display = 'none';
  if (app) app.style.display = 'block';
}
function nrrShowAuthError(msg) {
  var el = document.getElementById('nrr-auth-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

async function nrrDoLogin() {
  var btn = document.getElementById('nrr-auth-btn');
  var email = document.getElementById('nrr-auth-email').value.trim();
  var pass = document.getElementById('nrr-auth-pass').value;
  var errEl = document.getElementById('nrr-auth-error');
  if (errEl) errEl.style.display = 'none';
  if (!email || !pass) { nrrShowAuthError('กรุณากรอกอีเมลและรหัสผ่าน'); return; }

  btn.textContent = 'กำลังเข้าสู่ระบบ...';
  btn.disabled = true;
  try {
    var res = await supa.auth.signInWithPassword({ email: email, password: pass });
    if (res.error) nrrShowAuthError(res.error.message || 'เข้าสู่ระบบไม่สำเร็จ');
  } catch (e) {
    nrrShowAuthError('เชื่อมต่อไม่ได้ — กรุณาตรวจสอบอินเทอร์เน็ต');
  } finally {
    btn.textContent = 'เข้าสู่ระบบ';
    btn.disabled = false;
  }
}
window.nrrDoLogin = nrrDoLogin;

async function nrrDoLogout() {
  try { await supa.auth.signOut(); } finally { location.reload(); }
}
window.nrrDoLogout = nrrDoLogout;

document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'nrr-auth-pass') nrrDoLogin();
});

// ── Format helpers ────────────────────────────────────────────────────
function nrrFmtGMV(v) {
  if (v == null || isNaN(v)) return '—';
  var neg = v < 0; v = Math.abs(v);
  var s;
  if (v >= 1e6) s = '฿' + (v / 1e6).toFixed(1) + 'M';
  else if (v >= 1e3) s = '฿' + Math.round(v / 1e3) + 'K';
  else s = '฿' + Math.round(v).toLocaleString();
  return neg ? '-' + s : s;
}
window.nrrFmtGMV = nrrFmtGMV;

// Exact-baht formatter — for commission payouts specifically (user ask
// 2026-07-09: "50,123" not "50K"). Movement/GMV figures elsewhere in the
// app stay abbreviated via nrrFmtGMV — commission is a payroll number
// teams reconcile against payslips, where nrrFmtGMV's rounding is
// actively unhelpful.
function nrrFmtGMVExact(v) {
  if (v == null || isNaN(v)) return '—';
  var neg = v < 0;
  return (neg ? '-' : '') + '฿' + Math.round(Math.abs(v)).toLocaleString('en-US');
}
window.nrrFmtGMVExact = nrrFmtGMVExact;

// 2026-07-14: always exactly 1 decimal place, e.g. "103.4%" not "103%" —
// Number(v) first since locked commission snapshots (Supabase NUMERIC
// columns, raw_nrr_pct/governed_nrr_pct) can come back as strings.
function nrrFmtPct(v) { return v != null ? Number(v).toFixed(1) + '%' : '—'; }
window.nrrFmtPct = nrrFmtPct;

function nrrFmtDelta(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v + 'pp';
}
window.nrrFmtDelta = nrrFmtDelta;

// Every owner/KAM name in this data follows "FirstName (Nickname) LastName";
// dense tables and the signage board only have room for the nickname. Applied
// at RENDER time, never baked into the model, so the full name stays available
// for a title=/hover. Returns the full string unchanged when there are no
// parens (some rows carry an email or a bare name) — a caller that needs it
// short should also truncate, which is what the table cells do.
// v_simtab (2026-07-25): promoted here from nrr_pulse.js's own _nrrPulseNick
// (which now delegates to this) once the Commission breakdown table needed the
// same thing — one implementation, not two that could drift.
function nrrPersonNick(fullName) {
  var m = /\(([^)]+)\)/.exec(fullName || '');
  return m ? m[1] : (fullName || '');
}
window.nrrPersonNick = nrrPersonNick;

// ── CountUp — cubic ease-out, ported from src/06_portview_teamview.js ──
function nrrCountUp(el, target, duration, formatter) {
  duration = duration || 900;
  formatter = formatter || function (n) { return Math.round(n).toLocaleString(); };
  if (!el) return;
  if (target === 0) { el.textContent = formatter(0); return; }
  var start = performance.now();
  var startVal = 0;
  function tick(t) {
    var p = Math.min((t - start) / duration, 1);
    var eased = 1 - Math.pow(1 - p, 3);
    el.textContent = formatter(startVal + eased * (target - startVal));
    if (p < 1) requestAnimationFrame(tick);
    else {
      el.classList.add('nrr-pop');
      setTimeout(function () { el.classList.remove('nrr-pop'); }, 420);
    }
  }
  requestAnimationFrame(tick);
}
window.nrrCountUp = nrrCountUp;
