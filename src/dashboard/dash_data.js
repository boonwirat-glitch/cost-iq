// ── dash_data.js ──────────────────────────────────────────────
// Freshket TL Dashboard v707
// Data pipeline: R2 CSV + KAM group builder

const R2_BASE = 'https://pub-12078d17646340808024e8cc95504995.r2.dev';
const MONTHS  = ['Nov 25','Dec 25','Jan 26','Feb 26','Mar 26','Apr 26'];

// ── State ─────────────────────────────────────────────────────
let portviewBulkData = [];
let currentMonth     = 'Apr 26';
let currentMetric    = 'gmv';
let dataReady        = false;
let dataLoadError    = null;

// ── Fetch with retry ─────────────────────────────────────────
async function fetchWithRetry(url, retries = 2, delayMs = 1200) {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch(e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
}

// ── Load pipeline ─────────────────────────────────────────────
async function loadDashData() {
  const el = document.getElementById('sidebar-content');
  if (el) el.innerHTML = skeletonBlock(6);

  try {
    const csv = await fetchWithRetry(`${R2_BASE}/portview.csv?cb=${Date.now()}`);
    portviewBulkData = parsePortviewCSV(csv);
    DashLog.info('data', `portview loaded: ${portviewBulkData.length} accounts`);
  } catch(e) {
    DashLog.error('data_load', e.message, 'portview.csv');
    dataLoadError = e.message;
    // Render degraded state — don't block the rest of the app
  }

  dataReady = true;
  onDataReady();
}

function parsePortviewCSV(csv) {
  const lines = csv.trim().split('\n').slice(1).filter(l => l.trim());
  return lines.map(line => {
    const cols = line.split(',');
    return {
      id:       cols[0]?.trim(),
      name:     cols[1]?.trim(),
      kamEmail: cols[2]?.trim(),
      tlEmail:  cols[3]?.trim(),
      kamName:  cols[4]?.trim(),
      type:     cols[5]?.trim(),
      cls:      cols[6]?.trim(),
      gmv:      parseGMVCols(cols, 7),
    };
  });
}

function parseGMVCols(cols, startIdx) {
  const result = {};
  MONTHS.forEach((m, i) => {
    const v = parseFloat(cols[startIdx + i]);
    if (!isNaN(v)) result[m] = v;
  });
  return result;
}

function onDataReady() {
  hideSidebarShimmer();

  if (dataLoadError) {
    // Show degraded notice but still render with empty data
    showToast('โหลดข้อมูลไม่ครบ — บางส่วนอาจไม่แสดง', 'warn');
  }

  renderSidebarTeam();
  renderCurrentView();
}

// ── Getters ───────────────────────────────────────────────────
function getMyAccounts() {
  if (!currentProfile) return [];
  const email = currentProfile.email;
  const role  = currentProfile.role;
  if (role === 'admin') return portviewBulkData;
  if (['tl','ad_tl','sales_tl'].includes(role)) {
    const f = portviewBulkData.filter(r => r.tlEmail === email);
    return f.length ? f : portviewBulkData;
  }
  return portviewBulkData.filter(r => r.kamEmail === email);
}

function buildKamGroups() {
  const accounts = getMyAccounts();
  const groups   = {};

  accounts.forEach(a => {
    const key = a.kamEmail || a.kamName || 'ไม่มี KAM';
    if (!groups[key]) groups[key] = { key, name: a.kamName||key, email: a.kamEmail||'', accounts: [] };
    groups[key].accounts.push(a);
  });

  return Object.values(groups).map(g => {
    const totalGMV = g.accounts.reduce((s,a) => s+(a.gmv[currentMonth]||0), 0);
    const prevIdx  = MONTHS.indexOf(currentMonth) - 1;
    const prevGMV  = prevIdx >= 0
      ? g.accounts.reduce((s,a) => s+(a.gmv[MONTHS[prevIdx]]||0), 0) : 0;

    // 3-month rolling baseline
    const baseline = g.accounts.reduce((s,a) => {
      const vals = MONTHS.slice(0, MONTHS.indexOf(currentMonth))
        .slice(-3).map(m => a.gmv[m]||0).filter(v=>v>0);
      return s + (vals.length ? vals.reduce((x,y)=>x+y,0)/vals.length : 0);
    }, 0);

    const pace = baseline > 0 ? Math.round(totalGMV/baseline*100) : 0;
    const cls  = paceCls(pace);

    return {
      ...g,
      totalGMV, prevGMV, baseline,
      pace, cls,
      count: g.accounts.length,
    };
  }).sort((a,b) => {
    const o = { danger:0, warn:1, ok:2, star:3 };
    return (o[a.cls]??2)-(o[b.cls]??2);
  });
}
