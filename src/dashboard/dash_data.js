// ── dash_data.js — Data pipeline (R2 CSV + Supabase) ─────────
// Freshket TL Dashboard v702
// Reuses same R2 URLs as Sense — no duplication

const R2_BASE = 'https://pub-12078d17646340808024e8cc95504995.r2.dev';
const MONTHS = ['Nov 25','Dec 25','Jan 26','Feb 26','Mar 26','Apr 26'];

// State
let portviewBulkData = [];
let currentMonth = 'Apr 26';
let currentMetric = 'gmv';   // gmv | accounts | outlets | new_accounts
let dataReady = false;

// ── Fetch pipeline ────────────────────────────────────────────
async function loadDashData() {
  try {
    const [pvResp] = await Promise.all([
      fetch(`${R2_BASE}/portview.csv?cb=${Date.now()}`)
    ]);

    if (pvResp.ok) {
      const csv = await pvResp.text();
      portviewBulkData = parsePortviewCSV(csv);
    }

    dataReady = true;
    onDataReady();
  } catch (e) {
    console.warn('Dashboard data load error:', e);
    // Render with empty data — don't block UI
    dataReady = true;
    onDataReady();
  }
}

function parsePortviewCSV(csv) {
  const lines = csv.trim().split('\n').slice(1).filter(l => l.trim());
  return lines.map(line => {
    const cols = line.split(',');
    return {
      id:         cols[0]?.trim(),
      name:       cols[1]?.trim(),
      kamEmail:   cols[2]?.trim(),
      tlEmail:    cols[3]?.trim(),
      kamName:    cols[4]?.trim(),
      type:       cols[5]?.trim(),
      cls:        cols[6]?.trim(),
      gmv:        parseGMVCols(cols, 7)
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
  renderSidebarTeam();
  renderCurrentView();
}

// ── Getters ───────────────────────────────────────────────────
function getMyAccounts() {
  if (!currentProfile) return [];
  const email = currentProfile.email;
  const role  = currentProfile.role;
  if (role === 'admin') return portviewBulkData;
  if (role === 'tl' || role === 'ad_tl') {
    const filtered = portviewBulkData.filter(r => r.tlEmail === email);
    return filtered.length ? filtered : portviewBulkData;
  }
  return portviewBulkData.filter(r => r.kamEmail === email);
}

function buildKamGroups() {
  const accounts = getMyAccounts();
  const groups = {};
  accounts.forEach(a => {
    const key = a.kamEmail || a.kamName || 'ไม่มี KAM';
    if (!groups[key]) groups[key] = { key, name: a.kamName || key, email: a.kamEmail || '', accounts: [] };
    groups[key].accounts.push(a);
  });

  return Object.values(groups).map(g => {
    const gmvArr = g.accounts.map(a => a.gmv[currentMonth] || 0);
    const totalGMV = gmvArr.reduce((s, v) => s + v, 0);
    const prevGMV  = g.accounts.reduce((s,a) => {
      const pi = MONTHS.indexOf(currentMonth) - 1;
      return s + (pi >= 0 ? (a.gmv[MONTHS[pi]] || 0) : 0);
    }, 0);
    // Simple pace: GMV vs 3-month baseline
    const baselineArr = g.accounts.map(a => {
      const vals = MONTHS.slice(0, MONTHS.indexOf(currentMonth))
        .slice(-3).map(m => a.gmv[m] || 0).filter(v => v > 0);
      return vals.length ? vals.reduce((s,v) => s+v,0) / vals.length : 0;
    });
    const baseline = baselineArr.reduce((s,v) => s+v, 0);
    const pace = baseline > 0 ? Math.round(totalGMV / baseline * 100) : 0;
    const cls  = paceCls(pace);
    return { ...g, totalGMV, prevGMV, baseline, pace, cls, count: g.accounts.length };
  }).sort((a,b) => {
    const o = { danger:0, warn:1, ok:2, star:3 };
    return (o[a.cls]??2) - (o[b.cls]??2);
  });
}
