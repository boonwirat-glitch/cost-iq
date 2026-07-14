// ── nrr_core.js — auth, role gate, format helpers, CountUp ───────────────
// Auth pattern ported from src/dashboard/dash_core.js (same Supabase
// project, same profiles table). Role gate is intentionally narrower than
// /dashboard's: only 'tl'/'admin'/'rep' get in, because _qnrrCompute's scope
// logic (nrr_logic.js) only defines real behavior for scope 'kam'/'tl'/
// 'admin' — sales_tl/ad_tl have no defined NRR-scope semantics in the
// actual business logic, so letting them in would show meaningless numbers.
// 'rep' (added Phase B, 2026-07-09) maps to scope 'kam' — reps only ever
// see the Portfolio layer (nrr_router.js's guard confines them there),
// never the tl/admin dashboard.

var SUPA_URL = 'https://menslbnyyvpxiyvjywcm.supabase.co';
var SUPA_KEY = 'sb_publishable_DRCzHd782Gry8Edu4ZIiHA_KuOgBIIG';
var NRR_ALLOWED_ROLES = ['tl', 'admin', 'team_lead', 'team lead', 'rep'];

var supa = null;
var nrrProfile = null;

function nrrNormalizeRole(r) {
  var s = String(r || '').trim().toLowerCase();
  if (['team_lead', 'team lead', 'tl'].includes(s)) return 'tl';
  if (['admin', 'ad'].includes(s)) return 'admin';
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
    else nrrShowAuth();
  } catch (e) {
    console.error('[nrr] auth_init', e.message);
    nrrShowAuthError('เชื่อมต่อระบบไม่ได้ — กรุณาลองใหม่');
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

    if (!NRR_ALLOWED_ROLES.includes(role)) {
      await supa.auth.signOut();
      nrrShowAuthError('บัญชีนี้ไม่มีสิทธิ์เข้าใช้หน้านี้');
      return;
    }

    nrrProfile = { role: role, email: session.user.email, name: (profile && profile.full_name) || session.user.email };
    nrrShowApp();
    if (typeof nrrInitApp === 'function') nrrInitApp();
  } catch (e) {
    console.error('[nrr] on_session_ready', e.message);
    nrrShowAuthError('เกิดข้อผิดพลาด — กรุณา refresh หน้า');
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
