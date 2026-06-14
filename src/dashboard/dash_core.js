// ── dash_core.js ─────────────────────────────────────────────
// Freshket TL Dashboard v707
// Single responsibility: auth, logging, error handling, shared utils

const DASH_VERSION = 'DASHBOARD_VERSION';
const SUPA_URL = 'https://menslbnyyvpxiyvjywcm.supabase.co';
const SUPA_KEY = 'sb_publishable_DRCzHd782Gry8Edu4ZIiHA_KuOgBIIG';
const ALLOWED_ROLES = ['tl','admin','sales_tl','ad_tl',
  'team_lead','team lead','ka team lead','sales team lead'];

let supa, currentProfile = null;

// ── Logger ────────────────────────────────────────────────────
// Centralised error log — queryable for debugging
const DashLog = (() => {
  const LOG_KEY   = 'dash_error_log_v1';
  const MAX_ITEMS = 120;

  function _read() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; }
  }
  function _write(arr) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(arr.slice(-MAX_ITEMS))); } catch {}
  }

  return {
    error(module, message, detail = null) {
      const entry = {
        ts: new Date().toISOString(),
        v: DASH_VERSION,
        level: 'error',
        module,
        message: String(message).slice(0, 400),
        detail: detail ? String(detail).slice(0, 400) : undefined,
        user: currentProfile?.email || null,
        view: typeof currentView !== 'undefined' ? currentView : null,
      };
      const log = _read();
      log.push(entry);
      _write(log);
      console.error(`[${module}]`, message, detail || '');
    },

    warn(module, message) {
      console.warn(`[${module}]`, message);
    },

    info(module, message) {
      if (localStorage.getItem('dash_debug') === '1')
        console.log(`[${module}]`, message);
    },

    // Export full log (for debugging)
    dump() { return _read(); },

    // Clear log
    clear() { localStorage.removeItem(LOG_KEY); },

    // Render readable summary (called from dev console)
    print() {
      const log = _read();
      if (!log.length) { console.log('No errors logged.'); return; }
      console.table(log.map(e => ({
        time: e.ts.slice(11,19), module: e.module,
        message: e.message.slice(0,60), user: e.user
      })));
    }
  };
})();

// Expose for console debugging
window.DashLog = DashLog;

// ── Global error boundary ─────────────────────────────────────
window.addEventListener('unhandledrejection', e => {
  DashLog.error('unhandled_promise', e.reason?.message || String(e.reason));
});
window.addEventListener('error', e => {
  DashLog.error('runtime', e.message, `${e.filename}:${e.lineno}`);
});

// ── Init ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);

  try {
    const { data: { session } } = await supa.auth.getSession();
    if (session) await onSessionReady(session);
  } catch(e) {
    DashLog.error('auth_init', e.message);
    showAuthError('เชื่อมต่อระบบไม่ได้ — กรุณาลองใหม่');
  }

  supa.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await onSessionReady(session);
    } else if (event === 'SIGNED_OUT') {
      showAuth();
    } else if (event === 'TOKEN_REFRESHED') {
      DashLog.info('auth', 'token refreshed');
    }
  });
});

async function onSessionReady(session) {
  try {
    const { data: profile, error } = await supa
      .from('profiles').select('*')
      .eq('id', session.user.id).single();

    if (error) DashLog.warn('profile_load', error.message);

    const role = normalizeRole(
      profile?.role || session.user.user_metadata?.role || ''
    );

    if (!ALLOWED_ROLES.includes(role)) {
      await supa.auth.signOut();
      showAuthError('บัญชีนี้ไม่มีสิทธิ์เข้าใช้ Dashboard — กรุณาใช้ Sense บนมือถือ');
      DashLog.error('auth_role', `role '${role}' not allowed`, session.user.email);
      return;
    }

    currentProfile = { ...profile, role, email: session.user.email };
    DashLog.info('auth', `signed in: ${session.user.email} (${role})`);
    showApp();
    initApp();
  } catch(e) {
    DashLog.error('on_session_ready', e.message);
    showAuthError('เกิดข้อผิดพลาด — กรุณา refresh หน้า');
  }
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
  el.textContent = msg; el.style.display = 'block';
}

async function doLogin() {
  const btn   = document.getElementById('auth-btn');
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;
  document.getElementById('auth-error').style.display = 'none';

  if (!email || !pass) { showAuthError('กรุณากรอกอีเมลและรหัสผ่าน'); return; }

  btn.textContent = 'กำลังเข้าสู่ระบบ...';
  btn.disabled = true;

  try {
    const { error } = await supa.auth.signInWithPassword({ email, password: pass });
    if (error) {
      DashLog.error('login', error.message, email);
      showAuthError(error.message || 'เข้าสู่ระบบไม่สำเร็จ');
    }
  } catch(e) {
    DashLog.error('login', e.message);
    showAuthError('เชื่อมต่อไม่ได้ — กรุณาตรวจสอบอินเทอร์เน็ต');
  } finally {
    btn.textContent = 'เข้าสู่ระบบ';
    btn.disabled = false;
  }
}

async function doLogout() {
  await supa.auth.signOut();
  location.reload();
}

function openSense() { window.open('/', '_blank'); }

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'auth-pass') doLogin();
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
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2800);
}

// ── Error panel (inline, replaces blank states) ───────────────
function errorPanel(module, message, retryFn = null) {
  DashLog.error(module, message);
  const retryBtn = retryFn
    ? `<button class="ds-btn ds-btn-secondary" style="height:32px;font-size:var(--text-xs)"
        onclick="(${retryFn.toString()})()">ลองอีกครั้ง</button>` : '';
  return `
    <div style="display:flex;flex-direction:column;align-items:center;padding:var(--space-10) 0;gap:var(--space-3);text-align:center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
      </svg>
      <div style="font-size:var(--text-sm);font-weight:600;color:var(--ink-2)">${message}</div>
      <div style="font-size:var(--text-xs);color:var(--ink-4);font-family:var(--font-mono)">${module}</div>
      ${retryBtn}
    </div>`;
}

// Loading skeleton block
function skeletonBlock(rows = 5, height = 44) {
  return `<div style="display:flex;flex-direction:column;gap:var(--space-2)">
    ${Array(rows).fill('').map(() =>
      `<div class="ds-skel" style="height:${height}px;border-radius:var(--r-md)"></div>`
    ).join('')}
  </div>`;
}

// ── Format helpers ────────────────────────────────────────────
function fmtGMV(v) {
  if (!v && v !== 0) return '—';
  if (v >= 1e6) return '฿' + (v/1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '฿' + Math.round(v/1e3) + 'K';
  return '฿' + Math.round(v).toLocaleString();
}
function fmtNum(v)         { return v != null ? Number(v).toLocaleString() : '—'; }
function fmtPct(v)         { return v != null ? v + '%' : '—'; }
function fmtDelta(c, p)    { if (!p) return ''; const d = Math.round((c-p)/p*100); return (d>=0?'+':'')+d+'%'; }
function deltaCls(c, p)    { return c >= p ? 'up' : 'down'; }
function paceCls(pct) {
  if (pct >= 105) return 'star';
  if (pct >= 95)  return 'ok';
  if (pct >= 90)  return 'warn';
  return 'danger';
}
