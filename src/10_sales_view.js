// ══════════════════════════════════════════════════════════════
// SALES MODULE — 10_sales_view.js
// Role: sales | sales_tl
// Screens: sales-portview, sales-pipeline, sales-commission, sales-teamview
// Depends on: 01_core (roles), 02_data_pipeline (portviewBulkData, R2_FILES),
//             06_portview_teamview (portviewSelectAccount), 07a (targets)
// Does NOT touch: commission logic, KAM NRR, upsell
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════
// SECTION:SALES_DATA
// ══════════════════════════════════════════

// Get current month string "2026-06"
function _salesCurrentPeriod() {
  const d = new Date();
  d.setDate(d.getDate() - 1); // day-1 lag
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}

// Get month string N months from now
function _salesMonthOffset(n) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}

function _salesMonthLabel(ym) {
  const [y, m] = ym.split('-');
  const d = new Date(parseInt(y), parseInt(m)-1, 1);
  return d.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
}

// Returns portviewBulkData filtered to Sales user's outlets only
function getSalesPortviewData() {
  try {
    const email = (currentUserProfile && currentUserProfile.email) || '';
    if (!email) return [];
    const role = getCurrentRole();
    const data = (typeof portviewBulkData !== 'undefined' && portviewBulkData) || [];
    // Bulk CSV: filter by kamEmail for Sales rep, tlEmail for Sales TL
    // (sales_portview.csv contains all Sales reps — client-side filter)
    if (role === 'sales') {
      return data.filter(r => (r.kamEmail || '').toLowerCase() === email.toLowerCase());
    }
    if (role === 'sales_tl') {
      // TL sees entire team — filter by tlEmail matching their own email
      return data.filter(r => (r.tlEmail || '').toLowerCase() === email.toLowerCase());
    }
    return data;
  } catch(e) { return []; }
}

// Partition outlets into: active this month, expiring this month, future months
function _salesPartitionOutlets(outlets) {
  const m0 = _salesMonthOffset(0);
  const m1 = _salesMonthOffset(1);
  const m2 = _salesMonthOffset(2);
  const active = [], expiringM0 = [], expiringM1 = [], expiringM2 = [];
  outlets.forEach(o => {
    const exp = o.newUserExpDate || '';
    if (!exp) { active.push(o); return; }
    const expYM = exp.substring(0,7);
    if (expYM <= m0) expiringM0.push(o);
    else if (expYM === m1) expiringM1.push(o);
    else if (expYM === m2) expiringM2.push(o);
    else active.push(o);
  });
  return { active, expiringM0, expiringM1, expiringM2 };
}

// Net runrate = sum runrate of outlets NOT expiring this month
function getSalesRunrate(outlets) {
  const { active, expiringM1, expiringM2, expiringM0 } = _salesPartitionOutlets(outlets);
  const kept = [...active, ...expiringM1, ...expiringM2]; // still held past M0
  return kept.reduce((s, o) => s + (o.runrate || 0), 0);
}

// Handover out GMV per month
function getSalesHandoverOut(outlets) {
  const { expiringM0, expiringM1, expiringM2 } = _salesPartitionOutlets(outlets);
  return {
    m0: expiringM0.reduce((s,o) => s+((o.runrate||0)), 0),
    m1: expiringM1.reduce((s,o) => s+((o.runrate||0)), 0),
    m2: expiringM2.reduce((s,o) => s+((o.runrate||0)), 0),
    outlets_m0: expiringM0,
  };
}

// Sales target for current user
function getSalesTarget(period, email) {
  try {
    if (typeof _tgtGet === 'function') return _tgtGet(period, 'sales', email) || 0;
    return 0;
  } catch(e) { return 0; }
}

// Pipeline data from Supabase
let _salesPipelineCache = null;
let _salesPipelineLoading = false;

async function _loadSalesPipeline() {
  if (_salesPipelineLoading) return _salesPipelineCache || [];
  _salesPipelineLoading = true;
  try {
    const email = (currentUserProfile && currentUserProfile.email) || '';
    if (!email) return [];
    const { data, error } = await supa.from('sales_pipeline')
      .select('*')
      .eq('sales_email', email)
      .eq('status', 'active')
      .order('expected_start_date', { ascending: true });
    if (error) throw error;
    _salesPipelineCache = data || [];
    return _salesPipelineCache;
  } catch(e) {
    console.warn('[Sales] pipeline load failed:', e.message);
    return _salesPipelineCache || [];
  } finally {
    _salesPipelineLoading = false;
  }
}

// Pipeline GMV per month
function _pipelineByMonth(leads) {
  // Spread GMV across tenure months based on account_type
  // SA=45d (~1-2mo), MC/Chain=90d (~3mo) — spread monthly GMV across holding period
  const byMonth = {};
  leads.forEach(l => {
    const startYM = (l.expected_start_date || '').substring(0,7);
    if (!startYM) return;
    const gmv = parseFloat(l.expected_gmv) || 0;
    const type = (l.account_type || 'SA').toUpperCase();
    // months to spread: SA→1, MC/Chain→3
    const spreadMonths = (type === 'MC' || type === 'CHAIN') ? 3 : 1;
    const [y, m] = startYM.split('-').map(Number);
    for (let i = 0; i < spreadMonths; i++) {
      const d = new Date(y, m - 1 + i, 1);
      const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      if (!byMonth[key]) byMonth[key] = 0;
      byMonth[key] += gmv;
    }
  });
  return byMonth;
}

// 3-month projection
function getSalesProjection(outlets, pipeline, target) {
  const { expiringM0, expiringM1, expiringM2, active } = _salesPartitionOutlets(outlets);
  const pipeByMonth = _pipelineByMonth(pipeline);

  // M+0: full runrate of all outlets - runrate of outlets expiring this month + pipeline this month
  const totalRunrate = outlets.reduce((s,o) => s+(o.runrate||0), 0);
  const m0Period = _salesMonthOffset(0);
  const m1Period = _salesMonthOffset(1);
  const m2Period = _salesMonthOffset(2);

  const proj_m0 = totalRunrate - (expiringM0.reduce((s,o)=>s+(o.runrate||0),0)) + (pipeByMonth[m0Period]||0);
  const runrate_m1_base = [...active,...expiringM1,...expiringM2].reduce((s,o)=>s+(o.runrate||0),0);
  const proj_m1 = runrate_m1_base - (expiringM1.reduce((s,o)=>s+(o.runrate||0),0)) + (pipeByMonth[m1Period]||0);
  const runrate_m2_base = [...active,...expiringM2].reduce((s,o)=>s+(o.runrate||0),0);
  const proj_m2 = runrate_m2_base - (expiringM2.reduce((s,o)=>s+(o.runrate||0),0)) + (pipeByMonth[m2Period]||0);

  const handoverOut = getSalesHandoverOut(outlets);
  return [
    { period: m0Period, label: _salesMonthLabel(m0Period), projected: Math.max(0,proj_m0), target, isCurrent: true,
      runratePart: totalRunrate, pipelinePart: pipeByMonth[m0Period]||0, handoverPart: handoverOut.m0 },
    { period: m1Period, label: _salesMonthLabel(m1Period), projected: Math.max(0,proj_m1), target,
      runratePart: runrate_m1_base, pipelinePart: pipeByMonth[m1Period]||0, handoverPart: handoverOut.m1 },
    { period: m2Period, label: _salesMonthLabel(m2Period), projected: Math.max(0,proj_m2), target,
      runratePart: runrate_m2_base, pipelinePart: pipeByMonth[m2Period]||0, handoverPart: handoverOut.m2 },
  ];
}

// Format large numbers
function _sv_fmt(n) {
  if (!n || isNaN(n)) return '0';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1000) return (n/1000).toFixed(1).replace(/\.0$/, '') + 'K';
  if (n >= 500) return (n/1000).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}

// Days remaining until expiry
function _daysUntilExp(expDateStr) {
  if (!expDateStr) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const exp = new Date(expDateStr); exp.setHours(0,0,0,0);
  return Math.ceil((exp - today) / 86400000);
}

// ══════════════════════════════════════════
// SECTION:SALES_HOME
// ══════════════════════════════════════════

function showSalesHome() {
  try { if (typeof showScreen === 'function') showScreen('sales-portview'); } catch(e){}
  renderSalesPortview();
}

function renderSalesHome(el, outlets, pipeline) {
  if (!el) return;
  const email = (currentUserProfile && currentUserProfile.email) || '';
  const period = _salesCurrentPeriod();
  const target = getSalesTarget(period, email);
  const handover = getSalesHandoverOut(outlets);
  const proj = getSalesProjection(outlets, pipeline, target);
  // W2: runrate = outlets still held PAST this month (exclude expiring M0)
  // totalRunrate is used for outlet count only; heroRunrate drives target comparison
  const totalRunrate = outlets.reduce((s,o) => s+(o.runrate||0), 0);
  const heroRunrate = getSalesRunrate(outlets);
  const targetPct = target > 0 ? Math.min(200, Math.round(heroRunrate/target*100)) : 0;
  const barClass = targetPct >= 100 ? 'great' : targetPct >= 80 ? '' : targetPct >= 60 ? 'warn' : 'danger';

  // Handover warning: outlets expiring ≤15 days
  const urgentHandover = outlets.filter(o => {
    const d = _daysUntilExp(o.newUserExpDate);
    return d !== null && d <= 15;
  }).sort((a,b) => (a.newUserExpDate||'').localeCompare(b.newUserExpDate||''));
  const handoverGmv = urgentHandover.reduce((s,o) => s+(o.runrate||0), 0);

  // v6 design: Airbnb/Revolut — big number hero, inline proj, list rows
  const tbarClass = targetPct >= 100 ? 'ok' : targetPct >= 75 ? 'warn' : 'ac';
  const projHtml = proj.map(p => {
    const gap = p.projected - p.target;
    const gapLabel = p.target > 0 ? (gap >= 0 ? `+${_sv_fmt(gap)}` : `−${_sv_fmt(Math.abs(gap))}`) : '';
    const gapCls = gap >= 0 ? 'ok' : Math.abs(gap)/Math.max(p.target,1) < 0.2 ? 'warn' : 'bad';
    // Build breakdown string: runrate · pipeline · -handover
    // Revolut-style breakdown rows: dot + label left, value right
    const bRows = [];
    if (p.runratePart > 0) bRows.push('<div class="sv-pb-row"><span class="sv-pb-lbl"><span class="sv-pb-dot run"></span>runrate</span><span class="sv-pb-val">฿'+_sv_fmt(p.runratePart)+'</span></div>');
    if (p.pipelinePart > 0) bRows.push('<div class="sv-pb-row"><span class="sv-pb-lbl"><span class="sv-pb-dot pipe"></span>pipeline</span><span class="sv-pb-val pipe">+฿'+_sv_fmt(p.pipelinePart)+'</span></div>');
    if (p.handoverPart > 0) bRows.push('<div class="sv-pb-row"><span class="sv-pb-lbl"><span class="sv-pb-dot hov"></span>handover</span><span class="sv-pb-val hov">−฿'+_sv_fmt(p.handoverPart)+'</span></div>');
    p.breakdown = bRows.join('');
    return `<div class="sv-proj-cell${p.isCurrent?' now':''}">
      <div class="sv-proj-mon">${p.label}</div>
      <div class="sv-proj-amt">฿${_sv_fmt(p.projected)}</div>
      ${p.breakdown ? `<div class="sv-proj-breakdown">${p.breakdown}</div>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="sv-page-hd">
      <div class="sv-page-eye">${period}</div>
      <div class="sv-page-title">พอร์ตของคุณ</div>
    </div>

    <div class="sv-hero">
      <div class="sv-hero-eye">Runrate ในมือ</div>
      <div><span class="sv-hero-num">฿${_sv_fmt(heroRunrate)}</span></div>
      <div class="sv-hero-sub">
        <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#6A6A6A">MTD ฿${_sv_fmt(outlets.reduce((s,o)=>s+(o.gmvToDate||0),0))}</span>
        <span style="color:#EBEBEB">·</span>
        <span>${outlets.filter(o=>o.gmvToDate>0).length} / ${outlets.length} active</span>
        ${target === 0 ? '<span style="font-size:12px;color:#FF9500">ยังไม่มี target (TL กรุณาตั้ง)</span>' : ''}
      </div>
      ${target > 0 ? `<div class="sv-tbar">
        <div class="sv-tbar-track"><div class="sv-tbar-fill ${tbarClass}" style="width:${Math.min(100,targetPct)}%"></div></div>
        <div class="sv-tbar-meta"><span>${targetPct}% of target</span><span>Target ฿${_sv_fmt(target)}</span></div>
      </div>` : ''}
    </div>

    <div class="sv-proj-row">${projHtml}</div>

    ${urgentHandover.length ? `
    <div class="sv-sec">
      <span class="sv-sec-t ac">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Handover
      </span>
    </div>
    <div class="sv-hov-summary" onclick="window._salesOpenHandoverSheet()">
      <div class="sv-hov-sum-l">
        <div class="sv-hov-sum-dot"></div>
        <div>
          <div class="sv-hov-sum-label">${urgentHandover.length} ร้าน</div>
          <div class="sv-hov-sum-meta">ภายใน 15 วัน</div>
        </div>
      </div>
      <div class="sv-hov-sum-r">
        <div class="sv-hov-sum-gmv">฿${_sv_fmt(handoverGmv)}</div>
        <div class="sv-hov-sum-arrow">กดดูรายการ ›</div>
      </div>
    </div>` : ''}
  `;
}

// ══════════════════════════════════════════
// SECTION:SALES_PORTVIEW
// ══════════════════════════════════════════

function renderSalesPortview() {
  const el = document.getElementById('scr-sales-portview');
  if (!el) return;

  const outlets = getSalesPortviewData();
  const email = (currentUserProfile && currentUserProfile.email) || '';

  // Reset account-view guard so RenderBus can render portview normally again
  window._salesInAccountView = false;

  // Load pipeline async then render home summary + outlet list
  _loadSalesPipeline().then(pipeline => {
    el.innerHTML = '';
    el.onclick = null;
    window.scrollTo(0, 0);
    try { el.scrollTop = 0; } catch(e) {}

    // Home summary section at top
    const homeSec = document.createElement('div');
    homeSec.id = 'sv-home-section';
    el.appendChild(homeSec);
    renderSalesHome(homeSec, outlets, pipeline);

    // Outlet list section
    const listSec = document.createElement('div');
    listSec.id = 'sv-outlet-list';
    el.appendChild(listSec);
    _renderSalesOutletList(listSec, outlets);
  });
}

// ── Outlet list state ──────────────────────────────
let _olSort = 'mtd';     // 'mtd' | 'expiry'
let _olFilter = 'all';   // 'all' | 'ordered' | 'not-ordered' | 'stopped'
let _olView = 'list';    // 'list' | 'grid'
let _olCollapsed = {};   // accountId → boolean

function _olFilterOutlets(outlets) {
  const today = new Date(); today.setHours(0,0,0,0);
  return outlets.filter(o => {
    const gmvMtd = o.gmvToDate || 0;
    const lastOrder = o.lastOrderDate ? new Date(o.lastOrderDate) : null;
    const daysSinceLast = lastOrder ? Math.floor((today - lastOrder) / 86400000) : 999;
    if (_olFilter === 'ordered') return gmvMtd > 0;
    if (_olFilter === 'not-ordered') return gmvMtd === 0 && daysSinceLast <= 7;
    if (_olFilter === 'stopped') return gmvMtd === 0 && daysSinceLast > 7;
    return true;
  });
}

function _olSortOutlets(outlets) {
  return [...outlets].sort((a,b) => {
    if (_olSort === 'expiry') {
      return (a.newUserExpDate||'9999-12-31').localeCompare(b.newUserExpDate||'9999-12-31');
    }
    if (_olSort === 'mtd') return (b.gmvToDate||0) - (a.gmvToDate||0);
    return (b.runrate||0) - (a.runrate||0); // gmv default
  });
}

function _olGroupByAccount(outlets) {
  // Group by account_id (same UUID for all branches of one account)
  // Use accountGroupName (col[24]) as group display name — falls back to res_name
  const groups = {}; // account_id → {name, outlets[]}
  outlets.forEach(o => {
    const gKey = o.id; // account_id = same for all branches
    const groupName = o.accountGroupName || o.name || o.id;
    if (!groups[gKey]) groups[gKey] = { name: groupName, outlets: [] };
    groups[gKey].outlets.push(o);
  });
  return Object.values(groups).sort((a,b) => {
    // Sort groups by top outlet in each group
    const aTop = a.outlets.reduce((mx,o) => Math.max(mx, o.runrate||0), 0);
    const bTop = b.outlets.reduce((mx,o) => Math.max(mx, o.runrate||0), 0);
    return bTop - aTop;
  });
}

function _olRenderOutletRow(o, isChild) {
  const daysLeft = _daysUntilExp(o.newUserExpDate);
  const totalDays = (o.daysHeld||0) + (daysLeft !== null ? Math.max(0,daysLeft) : 0);
  const pctHeld = totalDays > 0 ? Math.min(100, Math.round((o.daysHeld||0)/totalDays*100)) : 0;
  const indCls = pctHeld >= 80 ? 'late' : pctHeld >= 60 ? 'mid' : 'ok';
  const typeLabel = (o.accountType||'SA').toUpperCase();
  const expLabel = o.newUserExpDate ?
    new Date(o.newUserExpDate).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '—';
  const daysLeftLabel = daysLeft !== null ? (daysLeft <= 0 ? 'หมดแล้ว' : daysLeft+'d') : '—';
  const gmv = _sv_fmt(o.runrate||0);
  const mtd = _sv_fmt(o.gmvToDate||0);
  const safeId = (o.id||'').replace(/"/g,'');
  const indent = isChild ? ' sv-ol-branch' : '';
  return '<div class="sv-ol-row' + indent + '" data-acctid="' + safeId + '">' +
    '<div class="sv-ol-top">' +
      '<div class="sv-ol-ind ' + indCls + '"></div>' +
      '<div class="sv-ol-info">' +
        '<div class="sv-ol-name">' + (o.name||o.id) + '</div>' +
        '<div class="sv-ol-meta">' + typeLabel + ' · ถือมา ' + (o.daysHeld||0) + ' วัน</div>' +
      '</div>' +
      '<div class="sv-ol-right">' +
        '<div class="sv-ol-gmv">฿' + gmv + '</div>' +
        '<div class="sv-ol-mtd">MTD ฿' + mtd + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="sv-ol-bar-wrap">' +
      '<div class="sv-days-track"><div class="sv-days-fill ' + indCls + '" style="width:' + pctHeld + '%"></div></div>' +
      '<div class="sv-days-meta">' +
        '<span></span>' +
        '<span class="sv-days-exp">handover ' + expLabel + (daysLeft!==null?' ('+daysLeftLabel+')':'') + '</span>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function _olRenderCardRow(o) {
  const daysLeft = _daysUntilExp(o.newUserExpDate);
  const totalDays = (o.daysHeld||0) + (daysLeft !== null ? Math.max(0,daysLeft) : 0);
  const pctHeld = totalDays > 0 ? Math.min(100, Math.round((o.daysHeld||0)/totalDays*100)) : 0;
  const indCls = pctHeld >= 80 ? 'late' : pctHeld >= 60 ? 'mid' : 'ok';
  const typeLabel = (o.accountType||'SA').toUpperCase();
  const expLabel = o.newUserExpDate ?
    new Date(o.newUserExpDate).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '—';
  const daysLeftLabel = daysLeft !== null ? (daysLeft <= 0 ? 'หมดแล้ว' : daysLeft+'d') : '';
  const safeId = (o.id||'').replace(/"/g,'');
  return '<div class="sv-ol-card ' + indCls + '" onclick="window._salesOpenAccount(\"' + safeId + '\")">' +
    '<div class="sv-oc-badge">' + typeLabel + '</div>' +
    '<div class="sv-oc-name">' + (o.name||o.id) + '</div>' +
    '<div class="sv-oc-gmv">฿' + _sv_fmt(o.runrate||0) + '</div>' +
    '<div class="sv-oc-sub">handover ' + expLabel + (daysLeftLabel?' · '+daysLeftLabel:'') + '</div>' +
  '</div>';
}

function _renderSalesOutletList(el, outlets) {
  if (!outlets.length) {
    el.innerHTML = '<div class="sv-empty"><div class="sv-empty-title">ยังไม่มีร้านในพอร์ต</div><div class="sv-empty-sub">ร้านที่สั่งครั้งแรกจาก Sales จะแสดงที่นี่</div></div>';
    return;
  }

  const filtered = _olFilterOutlets(outlets);
  const sorted = _olSortOutlets(filtered);
  const groups = _olGroupByAccount(sorted);

  // ── Action bar ──
  const fPills = [
    {key:'all', label:'ทั้งหมด'},
    {key:'ordered', label:'สั่งแล้ว'},
    {key:'not-ordered', label:'ยังไม่สั่ง'},
    {key:'stopped', label:'หยุดสั่ง'},
  ];
  const sPills = [
    {key:'gmv', label:'GMV'},
    {key:'expiry', label:'Expiry'},
    {key:'mtd', label:'MTD'},
  ];

  const filterHtml = fPills.map(function(p) {
    return '<button class="sv-fpill' + (_olFilter===p.key?' on':'') + '" onclick="_olSetFilter(\'' + p.key + '\')">' + p.label + '</button>';
  }).join('');

  const sortHtml = '<button class="sv-sort-btn" onclick="window._olCycleSort()">' +
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="9" y2="18"/></svg>' +
    '<span>' + (_olSort==='expiry'?'Expiry':'MTD') + '</span>' +
  '</button>';

  const viewHtml = ''; // view toggle removed

  let html = '<div class="sv-sec">' +
    '<span class="sv-sec-t">ร้านทั้งหมด</span>' +
    '<span class="sv-sec-c">' + outlets.length + ' ร้าน</span>' +
  '</div>' +
  '<div class="sv-action-bar">' +
    '<div class="sv-filter-pills">' + filterHtml + '</div>' +
    '<div class="sv-icon-bar">' + sortHtml + viewHtml + '</div>' +
  '</div>';

  if (!filtered.length) {
    html += '<div class="sv-empty" style="padding:32px 20px"><div class="sv-empty-title">ไม่มีร้านในกลุ่มนี้</div></div>';
    el.innerHTML = html;
    return;
  }

  // ── Grouped list — account header + branch rows ──
  html += '<div class="sv-outlet-list">';
  groups.forEach(function(g) {
    if (g.outlets.length > 1) {
      // 8px surface band before group — visual break (Airbnb pattern)
      html += '<div class="sv-ol-band"></div>';
      const gGmv = g.outlets.reduce(function(s,o){ return s+(o.runrate||0); }, 0);
      const gId = g.outlets[0].id;
      const collapsed = !!_olCollapsed[gId];
      // Group header: uppercase muted label (typography hierarchy, no card/border)
      html += '<div class="sv-ol-grp-hd" data-gid="' + gId + '">' +
        '<div class="sv-ol-grp-name">' + g.name +
          '<span class="sv-ol-grp-arrow">' + (collapsed?'▸':'▾') + '</span>' +
        '</div>' +
        '<span class="sv-ol-grp-meta">' + g.outlets.length + ' สาขา · ฿' + _sv_fmt(gGmv) + '</span>' +
      '</div>';
      if (!collapsed) {
        g.outlets.forEach(function(o) { html += _olRenderOutletRow(o, true); });
        // 8px band after group closes
        html += '<div class="sv-ol-band"></div>';
      }
    } else {
      html += _olRenderOutletRow(g.outlets[0], false);
    }
  });
  html += '</div>';

  el.innerHTML = html;
  // Click delegation for outlet rows
  el.onclick = function(e) {
    const acctHd = e.target.closest('[data-gid]');
    if (acctHd) {
      const gid = acctHd.getAttribute('data-gid');
      if (gid) { window._olToggleGroup(gid); return; }
    }
    const row = e.target.closest('[data-acctid]');
    if (row) { const aid = row.getAttribute('data-acctid'); if (aid) window._salesOpenAccount(aid); }
  };
}

// State setters — re-render outlet list only
function _olSetFilter(f) { window._olSetFilter(f); }
function _olSetView(v) { window._olSetView(v); }
function _olCycleSort() { window._olCycleSort(); }
window._olSetFilter = function(f) { _olFilter=f; const el=document.getElementById('sv-outlet-list'); if(el) { const outlets=getSalesPortviewData(); _renderSalesOutletList(el,outlets); } };
window._olSetView = function(v) { _olView=v; const el=document.getElementById('sv-outlet-list'); if(el) { const outlets=getSalesPortviewData(); _renderSalesOutletList(el,outlets); } };
window._olCycleSort = function() { const s=['mtd','expiry']; _olSort=s[(s.indexOf(_olSort)+1)%s.length]; const el=document.getElementById('sv-outlet-list'); if(el) { const outlets=getSalesPortviewData(); _renderSalesOutletList(el,outlets); } };
window._olToggleGroup = function(id) { _olCollapsed[id]=!_olCollapsed[id]; const el=document.getElementById('sv-outlet-list'); if(el) { const outlets=getSalesPortviewData(); _renderSalesOutletList(el,outlets); } };
// ── Handover bottom sheet ──────────────────────────────
window._salesOpenHandoverSheet = function() {
  const outlets = getSalesPortviewData();
  const urgent = outlets.filter(o => {
    const d = _daysUntilExp(o.newUserExpDate);
    return d !== null && d <= 15;
  }).sort((a,b) => (a.newUserExpDate||'').localeCompare(b.newUserExpDate||''));

  // Sort by runrate DESC
  urgent.sort((a,b) => (b.runrate||0)-(a.runrate||0));
  const rows = urgent.map(o => {
    const d = _daysUntilExp(o.newUserExpDate);
    const expLabel = o.newUserExpDate ?
      new Date(o.newUserExpDate).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '—';
    return '<div class="sv-sheet-row">' +
      '<div class="sv-sheet-dot"></div>' +
      '<span class="sv-sheet-name">' + (o.name||o.id) + '</span>' +
      '<span class="sv-sheet-days">' + (d<=0?'หมด':d+'d') + '</span>' +
      '<span class="sv-sheet-gmv">Runrate ฿' + _sv_fmt(o.runrate||0) + '</span>' +
    '</div>';
  }).join('');

  const totalGmv = urgent.reduce((s,o) => s+(o.runrate||0), 0);

  const overlay = document.createElement('div');
  overlay.className = 'sv-sheet-overlay';
  overlay.id = 'sv-handover-overlay';
  overlay.innerHTML =
    '<div class="sv-sheet" id="sv-handover-sheet">' +
      '<div class="sv-sheet-handle"></div>' +
      '<div class="sv-sheet-title">Handover ภายใน 15 วัน</div>' +
      '<div class="sv-sheet-sub">' + urgent.length + ' ร้าน · ฿' + _sv_fmt(totalGmv) + '/เดือน</div>' +
      '<div class="sv-sheet-scroll">' + rows + '</div>' +
    '</div>';

  // Close on backdrop tap
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) window._salesCloseHandoverSheet();
  });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    const s = document.getElementById('sv-handover-sheet');
    if (s) s.classList.add('open');
  });
};

window._salesCloseHandoverSheet = function() {
  const ov = document.getElementById('sv-handover-overlay');
  if (!ov) return;
  const s = document.getElementById('sv-handover-sheet');
  if (s) s.classList.remove('open');
  setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 300);
};



window._salesOpenAccount = function(accountId, accountName) {
  try {
    const data = (typeof portviewBulkData !== 'undefined' && portviewBulkData) || [];
    const acct = data.find(r => (r.id||'') === accountId || (r.account_guid||'') === accountId);
    if (!acct) { console.warn('[Sales] account not found:', accountId); return; }
    const el = document.getElementById('scr-sales-portview');
    if (!el) return;

    // Guard: tell RenderBus not to overwrite account view with portview list
    window._salesInAccountView = true;

    const daysLeft = _daysUntilExp(acct.newUserExpDate);
    const totalDays = (acct.daysHeld||0) + (daysLeft !== null ? Math.max(0,daysLeft) : 0);
    const pctHeld = totalDays > 0 ? Math.min(100, Math.round((acct.daysHeld||0)/totalDays*100)) : 0;
    const barCls = pctHeld >= 80 ? 'late' : pctHeld >= 60 ? 'mid' : '';
    const expLabel = acct.newUserExpDate ?
      new Date(acct.newUserExpDate).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'}) : '—';
    const typeLabel = (acct.accountType||'SA').toUpperCase();

    // GMV history from bulkHistoryData
    // sales_history.csv keyed by o.account_id (from dwh.order) which may differ from account_guid
    // Try multiple keys: accountId (account_guid), then numeric res_id variants
    const _bhData = typeof bulkHistoryData !== 'undefined' ? bulkHistoryData : {};
    const _skuData = typeof bulkSkuCurrentData !== 'undefined' ? bulkSkuCurrentData : {};
    const _catData = typeof bulkCatsData !== 'undefined' ? bulkCatsData : {};
    // Debug: log available keys in bulkHistoryData vs accountId
    const _bhKeys = Object.keys(_bhData).slice(0,5);
    console.log('[Sales acct] accountId:', accountId, '| acct.id:', acct.id, '| bulkHistoryData sample keys:', _bhKeys);
    // Build candidate keys from acct object
    const _keys = [accountId, acct.id, acct.res_id, acct.user_id, String(acct.res_id||''), String(acct.user_id||'')].filter(Boolean);
    const _findData = (store) => { for (const k of _keys) { if (store[k] && store[k].length) return store[k]; } return []; };
    const _findObjData = (store) => { for (const k of _keys) { if (store[k] && Object.keys(store[k]).length) return store[k]; } return {}; };
    const hist = _findData(_bhData);
    const moSort = m => { const p=(m||'').split(' '); const mo=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']; return (parseInt(p[1]||0)*12)+mo.indexOf(p[0]); };
    const sorted3 = hist.slice().sort((a,b) => moSort(a.m)-moSort(b.m)).slice(-3);

    // Chart bars — max for scaling
    const maxGmv = Math.max(...sorted3.map(h=>h.s||0), acct.runrate||0, 1);
    const chartHtml = sorted3.length ? (
      '<div class="sv-chart-sec">' +
      '<div class="sv-c-eye">GMV ย้อนหลัง</div>' +
      '<div class="sv-bars">' +
      sorted3.map((h,i) => {
        const ht = Math.round((h.s||0)/maxGmv*56);
        const isCurrent = i === sorted3.length-1;
        const showLabel = ht >= 10; // hide amount label if bar too short to avoid overlap
        return '<div class="sv-bw' + (isCurrent?' now':'') + '">' +
          '<div class="sv-bv">' + (showLabel ? '฿'+_sv_fmt(h.s||0) : '') + '</div>' +
          '<div class="sv-b solid" style="height:' + Math.max(2,ht) + 'px"></div>' +
          '<div class="sv-bl">' + (h.m||'') + '</div>' +
        '</div>';
      }).join('') +
      // Ghost bar for MTD
      (acct.gmvToDate !== undefined ? (function() {
        const ghostHt = Math.round((acct.runrate||0)/maxGmv*56);
        const mtdHt = Math.round((acct.gmvToDate||0)/maxGmv*56);
        return '<div class="sv-bw now">' +
          '<div class="sv-bv" style="color:#FF385C">฿' + _sv_fmt(acct.runrate||0) + '</div>' +
          '<div class="sv-b-ghost-wrap" style="height:' + Math.max(2,ghostHt) + 'px">' +
            '<div class="sv-b ghost"></div>' +
            '<div class="sv-b-mtd-fill" style="height:' + Math.round((acct.gmvToDate||0)/(acct.runrate||1)*100) + '%"></div>' +
          '</div>' +
          '<div class="sv-bl" style="color:#FF385C;font-size:9px">MTD ฿' + _sv_fmt(acct.gmvToDate||0) + '</div>' +
        '</div>';
      })() : '') +
      '</div>' +
      // runrate shown as label on ghost bar, no separate note line +
      '</div>'
    ) : (acct.gmvToDate > 0 ? (
      // No history but has MTD: show MTD bar + runrate ghost
      '<div class="sv-chart-sec">' +
      '<div class="sv-c-eye">GMV เดือนนี้</div>' +
      '<div class="sv-bars">' +
        '<div class="sv-bw now">' +
          '<div class="sv-bv" style="color:#FF385C">฿' + _sv_fmt(acct.runrate||0) + '</div>' +
          '<div class="sv-b-ghost-wrap" style="height:42px">' +
            '<div class="sv-b ghost"></div>' +
            '<div class="sv-b-mtd-fill" style="height:' + Math.min(100,Math.round((acct.gmvToDate||0)/(acct.runrate||1)*100)) + '%"></div>' +
          '</div>' +
          '<div class="sv-bl" style="color:#FF385C;font-size:9px">MTD ฿' + _sv_fmt(acct.gmvToDate||0) + '</div>' +
        '</div>' +
      '</div>' +
      '</div>'
    ) : '');

    // SKU current
    const skus = _findData(_skuData);
    const prevHist = sorted3.length >= 2 ? (hist.filter(h => moSort(h.m) < moSort(sorted3[sorted3.length-1].m))) : [];
    const prevMonthLabel = prevHist.length ? prevHist[prevHist.length-1].m : null;
    const skusSorted = skus.slice().sort((a,b) => (b.gmv_to_date||0)-(a.gmv_to_date||0)).slice(0,6);
    const skuHtml = skusSorted.length ? (
      '<div class="sv-sku-sec">' +
      '<div class="sv-sec"><span class="sv-sec-t">SKU ที่สั่งเดือนนี้</span><span class="sv-sec-c">top ' + skusSorted.length + '</span></div>' +
      '<div class="sv-sku-list">' +
      skusSorted.map(s => {
        const isNew = !!s.is_new || false;
        return '<div class="sv-sku-row">' +
          '<span class="sv-sku-name">' + (s.item_name_th||'—') + '</span>' +
          '<span class="sv-sku-gmv">฿' + _sv_fmt(s.gmv_to_date||0) + '</span>' +
          (isNew ? '<span class="sv-sku-badge-new">ใหม่</span>' : '') +
        '</div>';
      }).join('') +
      '</div></div>'
    ) : '';

    // Category breakdown — show ฿ amounts + categories not yet purchased
    const _CAT_MASTER = ['Beverage Alcohol','Beverage Non-alcohol','DG Food','DG Non-food','Egg','Fish & Seafood','Fruit','Meat','Processed Food','Vegetable'];
    const cats = _findObjData(_catData);
    const catKeys = Object.keys(cats).sort((a,b) => moSort(b)-moSort(a));
    const purchasedCats = catKeys.length ? (cats[catKeys[0]]||[]) : [];
    const purchasedNames = new Set(purchasedCats.map(c => c.n));
    const totalCatGmv = purchasedCats.reduce((s,c) => s+(c.s||0), 0);
    // Merge: purchased (sorted by ฿) + not-yet-purchased
    const notPurchased = _CAT_MASTER.filter(n => !purchasedNames.has(n)).map(n => ({n, s:0, p:0, c:'#EBEBEB', empty:true}));
    const allCats = [...purchasedCats.slice().sort((a,b) => (b.s||0)-(a.s||0)), ...notPurchased];
    const catHtml = allCats.length ? (
      '<div class="sv-cat-sec">' +
      '<div class="sv-sec"><span class="sv-sec-t">Category</span><span class="sv-sec-c">' + purchasedCats.length + '/' + _CAT_MASTER.length + ' หมวด</span></div>' +
      '<div class="sv-cat-list">' +
      allCats.map(c => {
        const barW = totalCatGmv > 0 ? Math.round((c.s||0)/totalCatGmv*100) : 0;
        const gmvLabel = c.empty ? '<span style="font-size:11px;color:#EBEBEB;font-family:\'IBM Plex Mono\',monospace">—</span>' :
          '<span style="font-size:12px;font-weight:700;color:#222222;font-family:\'IBM Plex Mono\',monospace">฿' + _sv_fmt(c.s||0) + '</span>';
        return '<div class="sv-cat-row">' +
          '<span class="sv-cat-name' + (c.empty?' sv-cat-empty':'') + '">' + (c.n||'—') + '</span>' +
          '<div class="sv-cat-bar-wrap"><div class="sv-cat-fill" style="width:' + barW + '%;background:' + (c.c||'#EBEBEB') + ';opacity:' + (c.empty?'0.3':'0.65') + '"></div></div>' +
          gmvLabel +
        '</div>';
      }).join('') +
      '</div></div>'
    ) : '';

    // Clear outlet list click delegation before replacing innerHTML
    el.onclick = null;

    el.innerHTML =
      '<div class="sv-page-hd" style="display:flex;align-items:center;gap:8px;padding:10px 16px 10px;">' +
        '<button onclick="renderSalesPortview()" style="display:flex;align-items:center;gap:3px;background:none;border:none;cursor:pointer;padding:0;">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FF385C" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>' +
          '<span style="font-size:14px;font-weight:600;color:#FF385C;font-family:\'Noto Sans Thai\',sans-serif">พอร์ต</span>' +
        '</button>' +
      '</div>' +
      '<div style="padding:0 16px 12px;">' +
        '<div class="sv-page-eye">' + typeLabel + '</div>' +
        '<div class="sv-page-title">' + (acct.name||acct.id) + '</div>' +
      '</div>' +
      '<div class="sv-band"></div>' +
      '<div class="sv-tenure-section">' +
        '<div class="sv-tenure-eye">ระยะเวลาในมือ</div>' +
        '<div class="sv-tenure-bar-row">' +
          '<div class="sv-tenure-track"><div class="sv-tenure-fill ' + barCls + '" style="width:' + pctHeld + '%"></div></div>' +
          '<span class="sv-tenure-pct' + (barCls?' '+barCls:'') + '">' + pctHeld + '%</span>' +
        '</div>' +
        '<div class="sv-tenure-dl">' +
          '<span class="sv-tenure-held">ถือมา ' + (acct.daysHeld||0) + ' วัน</span>' +
          '<span class="sv-tenure-exp">handover ' + expLabel + (daysLeft!==null?' ('+daysLeft+'d)':'') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="sv-band"></div>' +
      chartHtml +
      (chartHtml ? '<div class="sv-band"></div>' : '') +
      skuHtml +
      (skuHtml ? '<div class="sv-band"></div>' : '') +
      catHtml;

    // Scroll to top — body scrolls in Sales mode (not element)
    window.scrollTo(0, 0);
    try { el.scrollTop = 0; } catch(e) {}

  } catch(e) { console.warn('[Sales] open account failed:', e); }
};


// ══════════════════════════════════════════
// SECTION:SALES_PIPELINE
// ══════════════════════════════════════════

function renderSalesPipeline() {
  const el = document.getElementById('scr-sales-pipeline');
  if (!el) return;
  el.innerHTML = '<div class="sv-empty"><div class="sv-empty-title">กำลังโหลด...</div></div>';

  _loadSalesPipeline().then(leads => {
    _renderPipelineList(el, leads);
  });
}


// Helper for gap chart rows (avoids nested template literals)
function _renderGapRows(gaps) {
  return gaps.map(function(g) {
    var col = g.cls==='ok'?'#34C759':g.cls==='warn'?'#FF9500':'#FF385C';
    var sign = g.val>=0?'+':'−';
    return '<div class="sv-gap-row">' +
      '<span class="sv-gap-mon">'+g.mon+'</span>' +
      '<div class="sv-gap-track"><div class="sv-gap-fill '+g.cls+'" style="width:'+g.fill+'%"></div></div>' +
      '<span class="sv-gap-val" style="color:'+col+'">'+sign+'฿'+_sv_fmt(Math.abs(g.val))+'</span>' +
      '</div>';
  }).join('');
}

function _renderPipelineList(el, leads) {
  const m0 = _salesMonthOffset(0), m1 = _salesMonthOffset(1), m2 = _salesMonthOffset(2);
  const groups = {};
  leads.forEach(l => {
    const ym = (l.expected_start_date||'').substring(0,7);
    const key = ym < m0 ? m0 : ym;
    if (!groups[key]) groups[key] = [];
    groups[key].push(l);
  });
  const monthOrder = [m0, m1, m2];
  Object.keys(groups).forEach(k => { if (!monthOrder.includes(k)) monthOrder.push(k); });

  const totalPipeline = leads.reduce((s,l)=>s+(parseFloat(l.expected_gmv)||0),0);
  // W2: connect to real target via _tgtGet (same Supabase targets table as KAM)
  const _email = (currentUserProfile && currentUserProfile.email) || '';
  const _period = _salesCurrentPeriod();
  const tgt = getSalesTarget(_period, _email) || 0;
  // No target = no gap display (don't show misleading -1.6M)
  // Use _pipelineByMonth so Chain 90d spreads correctly across 3 months
  // (old code dumped full GMV into start month only — wrong for multi-month tenure)
  const pipM = _pipelineByMonth(leads);
  // Clamp past months into M0
  [m0,m1,m2].forEach(k => { if(!pipM[k]) pipM[k]=0; });
  const pastKeys = Object.keys(pipM).filter(k => k < m0);
  pastKeys.forEach(k => { pipM[m0] = (pipM[m0]||0) + pipM[k]; delete pipM[k]; });

  const gaps = [m0,m1,m2].map(function(ym) {
    const v = pipM[ym]||0;
    return {mon:_salesMonthLabel(ym),fill:Math.min(100,Math.round(v/tgt*100)),val:v-tgt,cls:v>=tgt?'ok':v/tgt>0.8?'warn':'bad'};
  });

  const gapSign = totalPipeline >= tgt ? '+' : '\u2212';
  const badCls = totalPipeline < tgt ? ' bad' : '';

  let html = '<div class="sv-page-hd">' +
    '<div class="sv-page-eye">Manual estimate</div>' +
    '<div class="sv-page-title">Pipeline</div>' +
    '</div>';

  html += '<div class="sv-kpi-inline">' +
    '<div class="sv-ki"><div class="sv-ki-l">Leads</div><div class="sv-ki-v">' + leads.length + '</div></div>' +
    '<div class="sv-ki"><div class="sv-ki-l">ยอดคาด</div><div class="sv-ki-v">\u0e3f' + _sv_fmt(totalPipeline) + '</div></div>' +
    '<div class="sv-ki"><div class="sv-ki-l">Gap</div><div class="sv-ki-v' + badCls + '">' + gapSign + '\u0e3f' + _sv_fmt(Math.abs(totalPipeline-tgt)) + '</div></div>' +
    '</div>';

  html += '<div class="sv-sec"><span class="sv-sec-t">ยอด vs Target</span></div>';
  html += '<div class="sv-gap-section">' + _renderGapRows(gaps) + '</div>';

  if (!leads.length) {
    html += '<div class="sv-empty"><div class="sv-empty-title">ยังไม่มี leads</div><div class="sv-empty-sub">กดปุ่ม + เพื่อเพิ่ม lead ที่คุยอยู่</div></div>';
  } else {
    html += '<div class="sv-lead-list">';
    monthOrder.forEach(function(ym) {
      const items = groups[ym];
      if (!items || !items.length) return;
      const total = items.reduce((s,l)=>s+(parseFloat(l.expected_gmv)||0),0);
      html += '<div class="sv-lead-month-hd">' +
        '<span class="sv-lead-month-name">' + _salesMonthLabel(ym) + '</span>' +
        '<span class="sv-lead-month-total">\u0e3f' + _sv_fmt(total) + ' \u00b7 ' + items.length + ' leads</span>' +
        '</div>';
      items.forEach(function(l) {
        const dateLabel = l.expected_start_date ?
          new Date(l.expected_start_date).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '\u2014';
        const safeId = (l.id||'');
        const safeName = (l.shop_name||'').replace(/'/g,"\\'");
        const editBtn = '<button class="sv-lead-btn" onclick="window._salesEditLead(\'' + safeId + '\')">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          '</button>';
        const delBtn = '<button class="sv-lead-btn" onclick="window._salesDeleteLead(\'' + safeId + '\',\'' + safeName + '\')">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>';
        var lType = (l.account_type||'SA').toUpperCase();
        var spreadMonths = (lType==='MC'||lType==='CHAIN') ? 3 : 1;
        var startYM = (l.expected_start_date||'').substring(0,7);
        var endLabel = '';
        if(startYM && spreadMonths > 1) {
          var _sp = startYM.split('-').map(Number);
          var _ed = new Date(_sp[0], _sp[1]-1+spreadMonths-1, 1);
          var _moTH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
          var _stMo = _moTH[_sp[1]-1];
          var _edMo = _moTH[_ed.getMonth()];
          endLabel = ' · ' + _stMo + '–' + _edMo;
        }
        var typePill = '<span class="sv-lead-type-pill">' + lType + endLabel + '</span>';
        html += '<div class="sv-lead-row">' +
          '<div class="sv-lead-info"><div class="sv-lead-name">' + (l.shop_name||'\u2014') + typePill + '</div><div class="sv-lead-date">\u0e40\u0e23\u0e34\u0e48\u0e21 ' + dateLabel + '</div></div>' +
          '<div class="sv-lead-gmv">\u0e3f' + _sv_fmt(l.expected_gmv) + '</div>' +
          '<div class="sv-lead-actions">' + editBtn + delBtn + '</div>' +
          '</div>';
      });
    });
    html += '</div>';
  }

  html += '<button class="sv-fab" id="sv-fab-add" onclick="window._salesAddLead()">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
    ' \u0e40\u0e1e\u0e34\u0e48\u0e21 Lead</button>';

  el.innerHTML = html;
  // Click delegation for outlet rows
  el.onclick = function(e) {
    const acctHd = e.target.closest('[data-gid]');
    if (acctHd) {
      const gid = acctHd.getAttribute('data-gid');
      if (gid) { window._olToggleGroup(gid); return; }
    }
    const row = e.target.closest('[data-acctid]');
    if (row) { const aid = row.getAttribute('data-acctid'); if (aid) window._salesOpenAccount(aid); }
  };
}

// Add/Edit lead sheet
window._salesAddLead = function(existing) {
  const overlay = document.createElement('div');
  overlay.className = 'sv-sheet-overlay';
  overlay.id = 'sv-lead-overlay';
  const isEdit = !!(existing && existing.id);
  const _acctType = isEdit ? (existing.account_type||'SA') : 'SA';
  overlay.innerHTML = `<div class="sv-sheet" id="sv-lead-sheet">
    <div class="sv-sheet-title">${isEdit ? 'แก้ไข Lead' : 'เพิ่ม Lead'}</div>
    <div class="sv-field-label">ชื่อร้าน</div>
    <input class="sv-field-input" id="sv-lead-name" type="text" placeholder="ร้านอาหาร..." value="${isEdit?existing.shop_name:''}" />
    <div class="sv-field-label">ประเภทร้าน</div>
    <div class="sv-type-row">
      <button class="sv-type-btn${_acctType==='SA'?' on':''}" data-type="SA" onclick="window._salesSelectType(this,'SA')">SA <span class="sv-type-tenure">45d</span></button>
      <button class="sv-type-btn${_acctType==='MC'?' on':''}" data-type="MC" onclick="window._salesSelectType(this,'MC')">MC <span class="sv-type-tenure">90d</span></button>
      <button class="sv-type-btn${_acctType==='Chain'?' on':''}" data-type="Chain" onclick="window._salesSelectType(this,'Chain')">Chain <span class="sv-type-tenure">90d</span></button>
    </div>
    <input type="hidden" id="sv-lead-type" value="${_acctType}" />
    <div class="sv-field-label">ยอดคาด / เดือน (บาท)</div>
    <input class="sv-field-input" id="sv-lead-gmv" type="text" inputmode="numeric" pattern="[0-9,]*" placeholder="50,000" value="${isEdit?(existing.expected_gmv?Number(existing.expected_gmv).toLocaleString():'')+'':''}" oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,',')" />
    <div class="sv-field-label">วันที่ยอดน่าจะเริ่มเข้า</div>
    <input class="sv-field-input" id="sv-lead-date" type="date" value="${isEdit?existing.expected_start_date:''}" />
    <div class="sv-sheet-actions">
      <button class="sv-btn-save" onclick="window._salesSaveLead('${isEdit?existing.id:''}')">บันทึก</button>
      <button class="sv-btn-cancel" onclick="window._salesCloseSheet()">ยกเลิก</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    const s = document.getElementById('sv-lead-sheet');
    if (s) s.classList.add('open');
  });
};

window._salesSelectType = function(btn, type) {
  document.querySelectorAll('.sv-type-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  const inp = document.getElementById('sv-lead-type');
  if (inp) inp.value = type;
};

window._salesEditLead = function(id) {
  const lead = (_salesPipelineCache||[]).find(l=>l.id===id);
  if (lead) window._salesAddLead(lead);
};

window._salesCloseSheet = function() {
  const ov = document.getElementById('sv-lead-overlay');
  if (!ov) return;
  const s = document.getElementById('sv-lead-sheet');
  if (s) s.classList.remove('open');
  setTimeout(() => ov.remove(), 320);
};

window._salesSaveLead = async function(existingId) {
  const name = (document.getElementById('sv-lead-name')?.value||'').trim();
  const gmv  = parseFloat((document.getElementById('sv-lead-gmv')?.value||'0').replace(/,/g,''));
  const date = document.getElementById('sv-lead-date')?.value||'';
  const acctType = document.getElementById('sv-lead-type')?.value || 'SA';
  if (!name || !gmv || !date) { alert('กรุณากรอกข้อมูลให้ครบ'); return; }
  const email = (currentUserProfile && currentUserProfile.email) || '';
  const btn = document.querySelector('.sv-btn-save');
  if (btn) { btn.textContent = 'กำลังบันทึก...'; btn.disabled = true; }
  try {
    if (existingId) {
      await supa.from('sales_pipeline').update({
        shop_name: name, expected_gmv: gmv, expected_start_date: date,
        account_type: acctType, updated_at: new Date().toISOString()
      }).eq('id', existingId);
    } else {
      await supa.from('sales_pipeline').insert({
        sales_email: email, shop_name: name,
        expected_gmv: gmv, expected_start_date: date, account_type: acctType
      });
    }
    _salesPipelineCache = null; // invalidate cache
    window._salesCloseSheet();
    renderSalesPipeline(); // re-render
  } catch(e) {
    console.warn('[Sales] save lead failed:', e);
    if (btn) { btn.textContent = 'บันทึก'; btn.disabled = false; }
    alert('บันทึกไม่สำเร็จ: ' + e.message);
  }
};

window._salesDeleteLead = async function(id, name) {
  if (!confirm(`ลบ "${name}" ออกจาก pipeline?`)) return;
  try {
    await supa.from('sales_pipeline').update({ status: 'dropped' }).eq('id', id);
    _salesPipelineCache = null;
    renderSalesPipeline();
  } catch(e) { console.warn('[Sales] delete lead failed:', e); }
};

// ══════════════════════════════════════════
// SECTION:SALES_COMMISSION
// ══════════════════════════════════════════

function renderSalesCommission() {
  const el = document.getElementById('scr-sales-commission');
  if (!el) return;
  el.innerHTML = `<div class="sv-coming-soon">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FF385C" stroke-width="1.5" stroke-linecap="round" style="opacity:.4;margin-bottom:16px"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
    <div class="sv-coming-soon-title">Commission</div>
    <div class="sv-coming-soon-sub">ระบบ commission สำหรับ Sales<br>อยู่ระหว่างออกแบบร่วมกับทีม</div>
    <div class="sv-coming-badge">Coming Soon</div>
  </div>`;
}

// ══════════════════════════════════════════
// SECTION:SALES_TL
// ══════════════════════════════════════════

function renderSalesTeamview() {
  const el = document.getElementById('scr-sales-teamview');
  if (!el) return;
  const role = getCurrentRole();
  if (role !== 'sales_tl' && role !== 'admin') {
    el.innerHTML = '';
    return;
  }
  const email = (currentUserProfile && currentUserProfile.email) || '';
  const period = _salesCurrentPeriod();
  // Filter portviewBulkData to this TL's Sales team
  const allData = (typeof portviewBulkData !== 'undefined' && portviewBulkData) || [];
  const teamData = allData.filter(r => {
    // Sales TL sees their team; admin sees all
    if (role === 'admin') return true;
    return (r.tlEmail || '').toLowerCase() === email.toLowerCase();
  });
  // Group by rep email
  const repMap = {};
  teamData.forEach(r => {
    const re = (r.kamEmail || '').toLowerCase();
    if (!re) return;
    if (!repMap[re]) repMap[re] = { email: re, name: r.kamName || re, outlets: [], runrate: 0 };
    repMap[re].outlets.push(r);
    repMap[re].runrate += (r.runrate || 0);
  });
  const reps = Object.values(repMap).sort((a,b) => b.runrate - a.runrate);
  const teamRunrate = reps.reduce((s,r) => s + r.runrate, 0);
  // Team target: _tgtGet for team level
  const teamTarget = (typeof _tgtGet === 'function')
    ? (_tgtGet(period, 'sales_team', email) || 0)
    : 0;
  const teamPct = teamTarget > 0 ? Math.min(200, Math.round(teamRunrate / teamTarget * 100)) : 0;
  const tbarCls = teamPct >= 100 ? 'ok' : teamPct >= 75 ? 'warn' : 'ac';

  // Target button: show for sales_tl and admin
  const canSetTarget = (role === 'sales_tl' || role === 'admin');
  const targetBtnHtml = canSetTarget
    ? '<button class="sv-tl-target-btn" onclick="window._salesOpenTargetSetup()">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
        ' ตั้ง Target</button>'
    : '';

  let html = '<div class="sv-page-hd" style="display:flex;align-items:flex-start;justify-content:space-between;">' +
    '<div><div class="sv-page-eye">Sales Team</div><div class="sv-page-title">ภาพรวมทีม</div></div>' +
    targetBtnHtml + '</div>';

  // Team hero
  html += '<div class="sv-hero">' +
    '<div class="sv-hero-eye">Runrate ทีม</div>' +
    '<div><span class="sv-hero-num">฿' + _sv_fmt(teamRunrate) + '</span></div>' +
    '<div class="sv-hero-sub">' +
      '<span>' + reps.length + ' reps · ' + teamData.length + ' ร้าน</span>' +
      (teamTarget > 0
        ? '<span class="sv-gap-badge' + (teamPct >= 100 ? ' ok' : '') + '">' +
            (teamPct >= 100 ? '+' : '−') + '฿' + _sv_fmt(Math.abs(teamRunrate - teamTarget)) + ' vs target</span>'
        : '<span style="font-size:12px;color:#FF9500">ยังไม่มี team target</span>') +
    '</div>' +
    (teamTarget > 0
      ? '<div class="sv-tbar"><div class="sv-tbar-track"><div class="sv-tbar-fill ' + tbarCls + '" style="width:' + Math.min(100,teamPct) + '%"></div></div>' +
        '<div class="sv-tbar-meta"><span>' + teamPct + '% of target</span><span>Target ฿' + _sv_fmt(teamTarget) + '</span></div></div>'
      : '') +
    '</div>';

  // Rep list
  html += '<div class="sv-sec"><span class="sv-sec-t">แต่ละ Rep</span><span class="sv-sec-c">' + reps.length + ' คน</span></div>';
  if (!reps.length) {
    html += '<div class="sv-empty"><div class="sv-empty-title">ไม่มีข้อมูล Rep</div><div class="sv-empty-sub">ตรวจสอบว่า Sales portview CSV upload แล้ว</div></div>';
  } else {
    html += '<div class="sv-outlet-list">';
    reps.forEach(function(rep) {
      const repTarget = (typeof _tgtGet === 'function') ? (_tgtGet(period, 'sales', rep.email) || 0) : 0;
      const repPct = repTarget > 0 ? Math.min(200, Math.round(rep.runrate / repTarget * 100)) : 0;
      const indCls = repPct >= 100 ? 'ok' : repPct >= 75 ? 'mid' : 'late';
      const repName = rep.name.split('@')[0]; // short name fallback
      html += '<div class="sv-ol-row" onclick="window._salesTLDrillRep("' + rep.email + '"' + ')">' +
        '<div class="sv-ol-top">' +
          '<div class="sv-ol-ind ' + indCls + '"></div>' +
          '<div class="sv-ol-info">' +
            '<div class="sv-ol-name">' + repName + '</div>' +
            '<div class="sv-ol-meta">' + rep.outlets.length + ' ร้าน' + (repTarget > 0 ? ' · target ฿' + _sv_fmt(repTarget) : '') + '</div>' +
          '</div>' +
          '<div class="sv-ol-right">' +
            '<div class="sv-ol-gmv">฿' + _sv_fmt(rep.runrate) + '</div>' +
            (repTarget > 0
              ? '<div class="sv-ol-type ' + (repPct >= 100 ? 'ok' : repPct >= 75 ? 'mid' : '') + '">' + repPct + '% target</div>'
              : '<div class="sv-ol-type" style="color:#FF9500">ยังไม่มี target</div>') +
          '</div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
  }

  el.innerHTML = html;
  // Click delegation for outlet rows
  el.onclick = function(e) {
    const acctHd = e.target.closest('[data-gid]');
    if (acctHd) {
      const gid = acctHd.getAttribute('data-gid');
      if (gid) { window._olToggleGroup(gid); return; }
    }
    const row = e.target.closest('[data-acctid]');
    if (row) { const aid = row.getAttribute('data-acctid'); if (aid) window._salesOpenAccount(aid); }
  };
}

// W4: TL target setup trigger
window._salesOpenTargetSetup = function() {
  const role = getCurrentRole();
  if (typeof openTargetSetup === 'function') {
    try { openTargetSetup(role === 'admin' ? 'admin' : 'tl'); } catch(e) {}
  }
};

// W4: TL drill into individual rep (show their portview)
window._salesTLDrillRep = function(repEmail) {
  if (!repEmail) return;
  // Find first outlet of this rep to get a display name
  const allData = (typeof portviewBulkData !== 'undefined' && portviewBulkData) || [];
  const repRow = allData.find(r => (r.kamEmail||'').toLowerCase() === repEmail.toLowerCase());
  const repName = repRow ? (repRow.kamName || repEmail.split('@')[0]) : repEmail.split('@')[0];

  // Render a filtered portview scoped to this rep's outlets
  const el = document.getElementById('scr-sales-teamview');
  if (!el) return;

  const repOutlets = allData.filter(r => (r.kamEmail||'').toLowerCase() === repEmail.toLowerCase());
  const period = _salesCurrentPeriod();
  const repTarget = (typeof _tgtGet === 'function') ? (_tgtGet(period, 'sales', repEmail) || 0) : 0;
  const repRunrate = repOutlets.reduce((s,o) => s+(o.runrate||0), 0);
  const repPct = repTarget > 0 ? Math.min(200, Math.round(repRunrate/repTarget*100)) : 0;
  const tbarCls = repPct >= 100 ? 'ok' : repPct >= 75 ? 'warn' : 'ac';

  // Sort outlets by expiry soonest first (same as Sales portview)
  const sorted = [...repOutlets].sort((a,b) => {
    const da = a.newUserExpDate || '9999-12-31';
    const db = b.newUserExpDate || '9999-12-31';
    return da.localeCompare(db);
  });

  let html = '<div class="sv-page-hd" style="display:flex;align-items:center;gap:10px;">' +
    '<button class="sv-back-row" onclick="renderSalesTeamview()" style="background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;gap:4px;">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF385C" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>' +
      '<span class="sv-back-label">ทีม</span>' +
    '</button>' +
    '<div>' +
      '<div class="sv-page-eye">Sales Rep</div>' +
      '<div class="sv-page-title">' + repName + '</div>' +
    '</div>' +
  '</div>';

  // Mini hero for this rep
  html += '<div class="sv-hero">' +
    '<div class="sv-hero-eye">Runrate</div>' +
    '<div><span class="sv-hero-num">฿' + _sv_fmt(repRunrate) + '</span></div>' +
    '<div class="sv-hero-sub">' +
      '<span>' + repOutlets.length + ' ร้าน</span>' +
      (repTarget > 0
        ? '<span class="sv-gap-badge' + (repPct>=100?' ok':'') + '">' +
            (repPct>=100?'+':'−') + '฿' + _sv_fmt(Math.abs(repRunrate-repTarget)) + ' vs target</span>'
        : '<span style="font-size:12px;color:#FF9500">ยังไม่มี target</span>') +
    '</div>' +
    (repTarget > 0
      ? '<div class="sv-tbar"><div class="sv-tbar-track"><div class="sv-tbar-fill ' + tbarCls + '" style="width:' + Math.min(100,repPct) + '%"></div></div>' +
        '<div class="sv-tbar-meta"><span>' + repPct + '% of target</span><span>Target ฿' + _sv_fmt(repTarget) + '</span></div></div>'
      : '') +
  '</div>';

  // Outlet list
  html += '<div class="sv-sec"><span class="sv-sec-t">ร้านทั้งหมด</span><span class="sv-sec-c">' + sorted.length + ' ร้าน</span></div>';

  if (!sorted.length) {
    html += '<div class="sv-empty"><div class="sv-empty-title">ไม่มีร้านในพอร์ต</div></div>';
  } else {
    html += '<div class="sv-outlet-list">';
    sorted.forEach(function(o) {
      const daysLeft = _daysUntilExp(o.newUserExpDate);
      const totalDays = (o.daysHeld||0) + (daysLeft !== null ? Math.max(0,daysLeft) : 0);
      const pctHeld = totalDays > 0 ? Math.min(100, Math.round((o.daysHeld||0)/totalDays*100)) : 0;
      const indCls = pctHeld >= 80 ? 'late' : pctHeld >= 60 ? 'mid' : 'ok';
      const typeLabel = (o.accountType||'SA').toUpperCase();
      const expLabel = o.newUserExpDate
        ? new Date(o.newUserExpDate).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '—';
      const daysLabel = daysLeft !== null ? (daysLeft<=0?'หมดแล้ว':daysLeft+'d') : '—';
      html += '<div class="sv-ol-row">' +
        '<div class="sv-ol-top">' +
          '<div class="sv-ol-ind ' + indCls + '"></div>' +
          '<div class="sv-ol-info">' +
            '<div class="sv-ol-name">' + (o.name||o.id) + '</div>' +
            '<div class="sv-ol-meta">ถือมา ' + (o.daysHeld||0) + ' วัน</div>' +
          '</div>' +
          '<div class="sv-ol-right">' +
            '<div class="sv-ol-gmv">฿' + _sv_fmt(o.runrate||o.gmvToDate||0) + '</div>' +
            '<div class="sv-ol-type ' + (indCls==='ok'?'ok':indCls==='mid'?'mid':'') + '">' + typeLabel + ' · ' + daysLabel + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="sv-ol-bar-wrap">' +
          '<div class="sv-days-track"><div class="sv-days-fill ' + indCls + '" style="width:' + pctHeld + '%"></div></div>' +
          '<div class="sv-days-meta"><span></span><span class="sv-days-exp">หมด ' + expLabel + '</span></div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
  }

  el.innerHTML = html;
  // Click delegation for outlet rows
  el.onclick = function(e) {
    const acctHd = e.target.closest('[data-gid]');
    if (acctHd) {
      const gid = acctHd.getAttribute('data-gid');
      if (gid) { window._olToggleGroup(gid); return; }
    }
    const row = e.target.closest('[data-acctid]');
    if (row) { const aid = row.getAttribute('data-acctid'); if (aid) window._salesOpenAccount(aid); }
  };
};

// ══════════════════════════════════════════
// SECTION:SALES_ACCOUNT_VIEW_PATCH
// ══════════════════════════════════════════
// WRAPPER: patch renderPortviewSummary for Sales — hide NRR/upsell, show days_held
(function() {
  const _origRenderPortviewSummary = (typeof renderPortviewSummary === 'function') ? renderPortviewSummary : null;
  window.renderPortviewSummary = function() {
    const role = typeof getCurrentRole === 'function' ? getCurrentRole() : '';
    if (role === 'sales' || role === 'sales_tl') {
      _renderSalesAccountSummary();
      return;
    }
    if (_origRenderPortviewSummary) _origRenderPortviewSummary.apply(this, arguments);
  };

  function _renderSalesAccountSummary() {
    // Find account in portviewBulkData
    const data = (typeof portviewBulkData !== 'undefined' && portviewBulkData) || [];
    const acctId = (typeof currentAccountId !== 'undefined') ? currentAccountId : null;
    const acct = acctId ? data.find(r => r.id === acctId || r.account_guid === acctId) : null;
    if (!acct) return;

    const daysLeft = _daysUntilExp(acct.newUserExpDate);
    const totalDays = (acct.daysHeld||0) + (daysLeft !== null ? Math.max(0,daysLeft) : 0);
    const pctHeld = totalDays > 0 ? Math.min(100, Math.round((acct.daysHeld||0)/totalDays*100)) : 0;
    const barClass = pctHeld >= 80 ? 'late' : pctHeld >= 60 ? 'mid' : 'ok';
    const expLabel = acct.newUserExpDate ?
      new Date(acct.newUserExpDate).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'}) : '—';

    const target = document.getElementById('portview-summary');
    if (!target) return;
    // Clear any previous Sales block to avoid duplicate on re-render
    const existing = target.querySelector('.sales-content-only');
    if (existing) existing.remove();
    const salesBlock = document.createElement('div');
    salesBlock.className = 'sales-content-only';
    // v6: Revolut style tenure section — no card, just rows
    salesBlock.innerHTML = `<div class="sv-band"></div>
      <div class="sv-tenure-section">
        <div class="sv-tenure-eye">ระยะเวลาในมือ</div>
        <div class="sv-tenure-bar-row">
          <div class="sv-tenure-track"><div class="sv-tenure-fill${barClass==='late'?' late':barClass==='mid'?' mid':''}" style="width:${pctHeld}%"></div></div>
          <span class="sv-tenure-pct${barClass==='late'?' late':''}">${pctHeld}%</span>
        </div>
        <div class="sv-tenure-dl">
          <span class="sv-tenure-held">ถือมา ${acct.daysHeld||0} วัน</span>
          <span class="sv-tenure-exp">หมด ${expLabel}${daysLeft!==null?' ('+daysLeft+'d)':''}</span>
        </div>
      </div>
      <div class="sv-band"></div>`;
    target.prepend(salesBlock);
  }
})();

// ══════════════════════════════════════════
// SECTION:SALES_ROUTER
// ══════════════════════════════════════════
// Hook into showScreen to render Sales screens on navigation

(function() {
  const _origShowScreen = (typeof showScreen === 'function') ? showScreen : null;
  window.showScreen = function(name) {
    if (_origShowScreen) _origShowScreen.apply(this, arguments);
    try {
      if (name === 'sales-portview') { renderSalesPortview(); _salesUpdateNavActive('nav-sales-portview'); }
      else if (name === 'sales-pipeline') { renderSalesPipeline(); _salesUpdateNavActive('nav-sales-pipeline'); }
      else if (name === 'sales-commission') { renderSalesCommission(); _salesUpdateNavActive('nav-sales-commission'); }
      else if (name === 'sales-teamview') { renderSalesTeamview(); _salesUpdateNavActive('nav-sales-teamview'); }
      else if (name === 'skills') { _salesUpdateNavActive('nav-skills'); }
    } catch(e) { console.warn('[Sales router]', e); }
  };

  function _salesUpdateNavActive(activeId) {
    const salesNavIds = ['nav-sales-portview','nav-sales-pipeline','nav-sales-commission','nav-sales-teamview','nav-skills'];
    salesNavIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('on', id === activeId);
    });
  }
})();

// ══════════════════════════════════════════
// SECTION:SALES_INIT
// ══════════════════════════════════════════
// Patch R2 files routing after login for Sales users
// Called from doLogin / checkSession after profile loads

(function() {
  const _origLoadUserProfile = (typeof loadUserProfile === 'function') ? loadUserProfile : null;
  if (!_origLoadUserProfile) return;
  window.loadUserProfile = async function() {
    await _origLoadUserProfile.apply(this, arguments);
    try {
      if (typeof _patchR2FilesForSales === 'function') _patchR2FilesForSales();
    } catch(e) {}
  };
})();

console.log('%c[Sense] Sales module loaded','color:#4ddc97');

