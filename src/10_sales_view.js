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
    // portviewBulkData already filtered to this sales user via sales_portview_{key}.csv
    // For sales_tl: data contains their whole team (loaded from team CSV if available)
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
  const byMonth = {};
  leads.forEach(l => {
    const ym = (l.expected_start_date || '').substring(0,7);
    if (!ym) return;
    if (!byMonth[ym]) byMonth[ym] = 0;
    byMonth[ym] += parseFloat(l.expected_gmv) || 0;
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

  return [
    { period: m0Period, label: _salesMonthLabel(m0Period), projected: Math.max(0,proj_m0), target, isCurrent: true },
    { period: m1Period, label: _salesMonthLabel(m1Period), projected: Math.max(0,proj_m1), target },
    { period: m2Period, label: _salesMonthLabel(m2Period), projected: Math.max(0,proj_m2), target },
  ];
}

// Format large numbers
function _sv_fmt(n) {
  if (!n || isNaN(n)) return '0';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(0) + 'K';
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
  const totalRunrate = outlets.reduce((s,o) => s+(o.runrate||0), 0);
  const targetPct = target > 0 ? Math.min(200, Math.round(totalRunrate/target*100)) : 0;
  const barClass = targetPct >= 100 ? 'great' : targetPct >= 80 ? '' : targetPct >= 60 ? 'warn' : 'danger';

  // Handover warning: outlets expiring ≤14 days
  const urgentHandover = handover.outlets_m0.filter(o => {
    const d = _daysUntilExp(o.newUserExpDate);
    return d !== null && d <= 14;
  }).sort((a,b) => (a.newUserExpDate||'').localeCompare(b.newUserExpDate||''));

  let handoverHtml = '';
  if (urgentHandover.length) {
    const rows = urgentHandover.slice(0,5).map(o => {
      const d = _daysUntilExp(o.newUserExpDate);
      return `<div class="sv-handover-row">
        <span>${o.name||o.id}</span>
        <span class="sv-handover-days">${d <= 0 ? 'หมดแล้ว' : d + 'd'}</span>
      </div>`;
    }).join('');
    handoverHtml = `<div class="sv-handover-card">
      <div class="sv-handover-title">⚠️ ใกล้ Handover — ${urgentHandover.length} ร้าน</div>
      ${rows}
    </div>`;
  }

  // v6 design: Airbnb/Revolut — big number hero, inline proj, list rows
  const tbarClass = targetPct >= 100 ? 'ok' : targetPct >= 75 ? 'warn' : 'ac';
  const projHtml = proj.map(p => {
    const gap = p.projected - p.target;
    const gapLabel = p.target > 0 ? (gap >= 0 ? `+${_sv_fmt(gap)}` : `−${_sv_fmt(Math.abs(gap))}`) : '';
    const gapCls = gap >= 0 ? 'ok' : Math.abs(gap)/Math.max(p.target,1) < 0.2 ? 'warn' : 'bad';
    return `<div class="sv-proj-cell${p.isCurrent?' now':''}">
      <div class="sv-proj-mon">${p.label}</div>
      <div class="sv-proj-amt">฿${_sv_fmt(p.projected)}</div>
      ${p.target > 0 ? `<div class="sv-proj-gap ${gapCls}">${gapLabel}</div>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="sv-page-hd">
      <div class="sv-page-eye">${period}</div>
      <div class="sv-page-title">พอร์ตของคุณ</div>
    </div>

    <div class="sv-hero">
      <div class="sv-hero-eye">Runrate ในมือ</div>
      <div><span class="sv-hero-num">฿${_sv_fmt(totalRunrate)}</span></div>
      <div class="sv-hero-sub">
        <span>${outlets.length} ร้าน active</span>
        ${target > 0 ? `<span class="sv-gap-badge${targetPct>=100?' ok':''}">
          ${targetPct >= 100 ? '+' : '−'}฿${_sv_fmt(Math.abs(totalRunrate-target))} vs target
        </span>` : '<span style="font-size:12px;color:#FF9500">ยังไม่มี target</span>'}
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
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        ใกล้ Handover
      </span>
      <span class="sv-sec-c">${urgentHandover.length} ร้าน</span>
    </div>
    <div class="sv-hov-section">
      ${urgentHandover.slice(0,5).map(o => {
        const d = _daysUntilExp(o.newUserExpDate);
        return `<div class="sv-hov-row">
          <div class="sv-hov-dot"></div>
          <span class="sv-hov-name">${o.name||o.id}</span>
          <span class="sv-hov-days">${d <= 0 ? 'หมดแล้ว' : d+'d'}</span>
        </div>`;
      }).join('')}
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

  // Load pipeline async then render home summary + outlet list
  _loadSalesPipeline().then(pipeline => {
    el.innerHTML = '';

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

function _renderSalesOutletList(el, outlets) {
  if (!outlets.length) {
    el.innerHTML = `<div class="sv-empty">
      <div class="sv-empty-title">ยังไม่มีร้านในพอร์ต</div>
      <div class="sv-empty-sub">ร้านที่สั่งครั้งแรกจาก Sales จะแสดงที่นี่</div>
    </div>`;
    return;
  }

  // Sort: expiring soonest first
  const sorted = [...outlets].sort((a,b) => {
    const da = a.newUserExpDate || '9999-12-31';
    const db = b.newUserExpDate || '9999-12-31';
    return da.localeCompare(db);
  });

  // v6: Revolut list rows — colored indicator + name + amount + days bar
  const headerHtml = `<div class="sv-sec">
    <span class="sv-sec-t">ร้านทั้งหมด</span>
    <span class="sv-sec-c">${outlets.length} ร้าน</span>
  </div>`;

  const cardsHtml = '<div class="sv-outlet-list">' + sorted.map(o => {
    const daysLeft = _daysUntilExp(o.newUserExpDate);
    const totalDays = (o.daysHeld||0) + (daysLeft !== null ? Math.max(0,daysLeft) : 0);
    const pctHeld = totalDays > 0 ? Math.min(100, Math.round((o.daysHeld||0) / totalDays * 100)) : 0;
    const indCls = pctHeld >= 80 ? 'late' : pctHeld >= 60 ? 'mid' : 'ok';
    const typeCls = pctHeld >= 80 ? '' : pctHeld >= 60 ? 'mid' : 'ok';
    const typeLabel = (o.accountType||'SA').toUpperCase();
    const expLabel = o.newUserExpDate ?
      new Date(o.newUserExpDate).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '—';
    const daysLabel = daysLeft !== null ? (daysLeft <= 0 ? 'หมดแล้ว' : daysLeft+'d') : '—';
    const gmv = _sv_fmt(o.runrate||o.gmvToDate||0);
    const safeId = (o.id||'').replace(/'/g,"\'");
    const safeName = (o.name||'').replace(/'/g,"\'");

    return `<div class="sv-ol-row" onclick="window._salesOpenAccount('${safeId}','${safeName}')">
      <div class="sv-ol-top">
        <div class="sv-ol-ind ${indCls}"></div>
        <div class="sv-ol-info">
          <div class="sv-ol-name">${o.name||o.id}</div>
          <div class="sv-ol-meta">ถือมา ${o.daysHeld||0} วัน</div>
        </div>
        <div class="sv-ol-right">
          <div class="sv-ol-gmv">฿${gmv}</div>
          <div class="sv-ol-type ${typeCls}">${typeLabel} · ${daysLabel}</div>
        </div>
      </div>
      <div class="sv-ol-bar-wrap">
        <div class="sv-days-track"><div class="sv-days-fill ${indCls}" style="width:${pctHeld}%"></div></div>
        <div class="sv-days-meta"><span></span><span class="sv-days-exp">หมด ${expLabel}</span></div>
      </div>
    </div>`;
  }).join('') + '</div>';

  el.innerHTML = headerHtml + cardsHtml;
}

window._salesOpenAccount = function(accountId, accountName) {
  try {
    if (typeof portviewSelectAccount === 'function') {
      portviewSelectAccount(accountId, accountName);
    }
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
  const tgt = 1600000; // placeholder until target system live
  const pipM = {}; pipM[m0]=0; pipM[m1]=0; pipM[m2]=0;
  leads.forEach(l => {
    const ym = (l.expected_start_date||'').substring(0,7);
    const k = ym < m0 ? m0 : ym;
    if(pipM[k]!==undefined) pipM[k] += parseFloat(l.expected_gmv)||0;
  });
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
        html += '<div class="sv-lead-row">' +
          '<div class="sv-lead-info"><div class="sv-lead-name">' + (l.shop_name||'\u2014') + '</div><div class="sv-lead-date">\u0e40\u0e23\u0e34\u0e48\u0e21 ' + dateLabel + '</div></div>' +
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
}

// Add/Edit lead sheet
window._salesAddLead = function(existing) {
  const overlay = document.createElement('div');
  overlay.className = 'sv-sheet-overlay';
  overlay.id = 'sv-lead-overlay';
  const isEdit = !!(existing && existing.id);
  overlay.innerHTML = `<div class="sv-sheet" id="sv-lead-sheet">
    <div class="sv-sheet-title">${isEdit ? 'แก้ไข Lead' : 'เพิ่ม Lead'}</div>
    <div class="sv-field-label">ชื่อร้าน</div>
    <input class="sv-field-input" id="sv-lead-name" type="text" placeholder="ร้านอาหาร..." value="${isEdit?existing.shop_name:''}" />
    <div class="sv-field-label">ยอดคาด / เดือน (บาท)</div>
    <input class="sv-field-input" id="sv-lead-gmv" type="number" inputmode="numeric" placeholder="50000" value="${isEdit?existing.expected_gmv:''}" />
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
  const gmv  = parseFloat(document.getElementById('sv-lead-gmv')?.value||0);
  const date = document.getElementById('sv-lead-date')?.value||'';
  if (!name || !gmv || !date) { alert('กรุณากรอกข้อมูลให้ครบ'); return; }
  const email = (currentUserProfile && currentUserProfile.email) || '';
  const btn = document.querySelector('.sv-btn-save');
  if (btn) { btn.textContent = 'กำลังบันทึก...'; btn.disabled = true; }
  try {
    if (existingId) {
      await supa.from('sales_pipeline').update({
        shop_name: name, expected_gmv: gmv, expected_start_date: date,
        updated_at: new Date().toISOString()
      }).eq('id', existingId);
    } else {
      await supa.from('sales_pipeline').insert({
        sales_email: email, shop_name: name,
        expected_gmv: gmv, expected_start_date: date
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
  // Delegate to KAM teamview render — portviewBulkData already filtered to Sales team
  // TL filters by salesTeamName matching their own team
  if (typeof renderTeamview === 'function') {
    try { renderTeamview(); } catch(e) { console.warn('[Sales TL] renderTeamview failed:', e); }
    return;
  }
  el.innerHTML = `<div class="sv-empty">
    <div class="sv-empty-title">Team View</div>
    <div class="sv-empty-sub">ยังไม่มีข้อมูลทีม</div>
  </div>`;
}

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
    // Inject Sales-specific block; hide KAM elements via CSS class
    const salesBlock = document.createElement('div');
    salesBlock.className = 'sales-content-only';
    // v6: Revolut style tenure section — no card, just rows
    salesBlock.innerHTML = `<div class="sv-band"></div>
      <div class="sv-tenure-section">
        <div class="sv-tenure-eye">ระยะเวลาในมือ</div>
        <div class="sv-tenure-bar-row">
          <div class="sv-tenure-track"><div class="sv-tenure-fill${barClass==='late'?' late':''}" style="width:${pctHeld}%"></div></div>
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
    } catch(e) { console.warn('[Sales router]', e); }
  };

  function _salesUpdateNavActive(activeId) {
    const salesNavIds = ['nav-sales-portview','nav-sales-pipeline','nav-sales-commission','nav-sales-teamview'];
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

