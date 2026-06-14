// ── dash_core.js — Auth, session, role guard ─────────────────
// Freshket TL Dashboard v702
// Supabase: menslbnyyvpxiyvjywcm.supabase.co

const DASH_VERSION = 'DASHBOARD_VERSION';
const SUPA_URL = 'https://menslbnyyvpxiyvjywcm.supabase.co';
const SUPA_KEY = 'sb_publishable_DRCzHd782Gry8Edu4ZIiHA_KuOgBIIG';
const ALLOWED_ROLES = ['tl', 'admin', 'sales_tl', 'ad_tl',
  'team_lead', 'team lead', 'ka team lead', 'sales team lead'];

let supa, currentProfile = null;

// ── Init ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);

  // Check existing session first
  const { data: { session } } = await supa.auth.getSession();
  if (session) {
    await onSessionReady(session);
  }

  // Watch auth state changes
  supa.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await onSessionReady(session);
    } else if (event === 'SIGNED_OUT') {
      showAuth();
    }
  });
});

async function onSessionReady(session) {
  // Fetch profile
  const { data: profile } = await supa
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  const role = normalizeRole(
    profile?.role || session.user.user_metadata?.role || ''
  );

  if (!ALLOWED_ROLES.includes(role)) {
    await supa.auth.signOut();
    showAuthError('บัญชีนี้ไม่มีสิทธิ์เข้าใช้ Dashboard — กรุณาใช้ Sense บนมือถือ');
    return;
  }

  currentProfile = { ...profile, role, email: session.user.email };
  showApp();
  initApp();
}

function normalizeRole(r) {
  const s = String(r || '').trim().toLowerCase();
  if (['kam','ka','key_account','key account','rep'].includes(s)) return 'rep';
  if (['team_lead','team lead','tl'].includes(s)) return 'tl';
  if (['sales_tl','sales_lead','sales team lead'].includes(s)) return 'sales_tl';
  if (['ad_tl','ad_lead','ad team lead'].includes(s)) return 'ad_tl';
  return s || 'rep';
}

// ── Auth UI ───────────────────────────────────────────────────
function showAuth() {
  document.getElementById('auth-overlay').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}
function showApp() {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
}
function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

async function doLogin() {
  const btn = document.getElementById('auth-btn');
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;
  document.getElementById('auth-error').style.display = 'none';

  if (!email || !pass) { showAuthError('กรุณากรอกอีเมลและรหัสผ่าน'); return; }

  btn.textContent = 'กำลังเข้าสู่ระบบ...';
  btn.disabled = true;

  const { error } = await supa.auth.signInWithPassword({ email, password: pass });
  btn.textContent = 'เข้าสู่ระบบ';
  btn.disabled = false;

  if (error) showAuthError(error.message || 'เข้าสู่ระบบไม่สำเร็จ');
}

async function doLogout() {
  await supa.auth.signOut();
  location.reload();
}

function openSense() {
  window.open('/', '_blank');
}

// Enter key on password
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'auth-pass') {
    doLogin();
  }
});

// ── User menu ─────────────────────────────────────────────────
function toggleUserMenu() {
  const m = document.getElementById('user-menu');
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
}
document.addEventListener('click', e => {
  if (!e.target.closest('#topbar-user')) {
    const m = document.getElementById('user-menu');
    if (m) m.style.display = 'none';
  }
});

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `td-toast${type ? ' ' + type : ''}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2800);
}

// ── Format helpers ────────────────────────────────────────────
function fmtGMV(v) {
  if (!v && v !== 0) return '—';
  if (v >= 1e6)  return '฿' + (v/1e6).toFixed(1) + 'M';
  if (v >= 1e3)  return '฿' + Math.round(v/1e3) + 'K';
  return '฿' + Math.round(v).toLocaleString();
}
function fmtNum(v) { return v != null ? Number(v).toLocaleString() : '—'; }
function fmtPct(v) { return v != null ? v + '%' : '—'; }
function fmtDelta(curr, prev) {
  if (!prev) return '';
  const p = Math.round((curr - prev) / prev * 100);
  return (p >= 0 ? '+' : '') + p + '%';
}
function deltaCls(curr, prev) { return curr >= prev ? 'up' : 'down'; }
function paceCls(pct) {
  if (pct >= 105) return 'star';
  if (pct >= 95)  return 'ok';
  if (pct >= 90)  return 'warn';
  return 'danger';
}
