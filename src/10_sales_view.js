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

  // Projection strip
  const projHtml = proj.map(p => {
    const gap = p.projected - p.target;
    const gapLabel = gap >= 0 ? `+${_sv_fmt(gap)}` : `−${_sv_fmt(Math.abs(gap))}`;
    const gapClass = gap >= 0 ? 'hit' : Math.abs(gap)/p.target < 0.15 ? 'gap' : 'miss';
    return `<div class="sv-proj-card${p.isCurrent?' current':''}">
      <div class="sv-proj-month">${p.label}</div>
      <div class="sv-proj-amount">฿${_sv_fmt(p.projected)}</div>
      ${p.target > 0 ? `<div class="sv-proj-vs ${gapClass}">${gapLabel} vs target</div>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="sv-header">
      <div>
        <div class="sv-header-title">Sales Dashboard</div>
        <div class="sv-header-sub">${period}</div>
      </div>
    </div>

    <div class="sv-card">
      <div class="sv-card-label">Runrate ในมือ</div>
      <div class="sv-card-value">฿${_sv_fmt(totalRunrate)}<span class="sv-card-value-unit">/เดือน</span></div>
      <div class="sv-card-sub">${outlets.length} ร้าน active · Handover ออก ฿${_sv_fmt(handover.m0)} เดือนนี้</div>
      ${target > 0 ? `
      <div class="sv-target-bar-wrap">
        <div class="sv-target-bar-track">
          <div class="sv-target-bar-fill ${barClass}" style="width:${Math.min(100,targetPct)}%"></div>
        </div>
        <div class="sv-target-labels">
          <span>${targetPct}% of target</span>
          <span>Target ฿${_sv_fmt(target)}</span>
        </div>
      </div>` : '<div class="sv-card-sub" style="margin-top:6px;color:rgba(255,165,0,.6)">ยังไม่มี target — TL ต้องตั้ง</div>'}
    </div>

    ${handoverHtml}

    <div style="padding:0 20px 8px;font-size:10px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.35);font-family:'DM Mono',monospace">Projection 3 เดือน</div>
    <div class="sv-projection-strip">${projHtml}</div>

    <div class="sv-card" style="cursor:pointer" onclick="if(typeof showScreen==='function')showScreen('sales-pipeline')">
      <div class="sv-card-label">Pipeline (Manual)</div>
      <div class="sv-card-value">฿${_sv_fmt(pipeline.reduce((s,l)=>s+(parseFloat(l.expected_gmv)||0),0))}<span class="sv-card-value-unit">/เดือน est.</span></div>
      <div class="sv-card-sub">${pipeline.length} leads · แตะเพื่อจัดการ →</div>
    </div>
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

  const headerHtml = `<div class="sv-portview-header">
    <div class="sv-portview-title">ร้านทั้งหมด (${outlets.length})</div>
  </div>`;

  const cardsHtml = sorted.map(o => {
    const daysLeft = _daysUntilExp(o.newUserExpDate);
    const totalDays = o.daysHeld + (daysLeft !== null ? daysLeft : 0);
    const pctHeld = totalDays > 0 ? Math.min(100, Math.round(o.daysHeld / totalDays * 100)) : 0;
    const barClass = pctHeld >= 80 ? 'late' : pctHeld >= 60 ? 'mid' : '';
    const cardClass = daysLeft !== null && daysLeft <= 7 ? 'expiring-critical' :
                      daysLeft !== null && daysLeft <= 14 ? 'expiring-soon' : '';
    const typeLabel = (o.accountType||'SA').toUpperCase();
    const expLabel = o.newUserExpDate ?
      new Date(o.newUserExpDate).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '—';
    const gmvLabel = `฿${_sv_fmt(o.runrate||o.gmvToDate||0)}/เดือน`;

    return `<div class="sv-outlet-card ${cardClass}"
      onclick="window._salesOpenAccount('${(o.id||'').replace(/'/g,"\\'")}','${(o.name||'').replace(/'/g,"\\'")}')"
    >
      <div class="sv-outlet-name">
        <span>${o.name||o.id}</span>
        <span class="sv-outlet-type">${typeLabel}</span>
      </div>
      <div class="sv-outlet-gmv">${gmvLabel}</div>
      <div class="sv-days-bar-wrap">
        <div class="sv-days-bar-track">
          <div class="sv-days-bar-fill ${barClass}" style="width:${pctHeld}%"></div>
        </div>
        <div class="sv-days-meta">
          <span>ถือมา ${o.daysHeld||0} วัน</span>
          <span class="sv-days-deadline">หมด ${expLabel}${daysLeft!==null?' ('+daysLeft+'d)':''}</span>
        </div>
      </div>
    </div>`;
  }).join('');

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

function _renderPipelineList(el, leads) {
  const m0 = _salesMonthOffset(0);
  const m1 = _salesMonthOffset(1);
  const m2 = _salesMonthOffset(2);

  // Group by month
  const groups = {};
  leads.forEach(l => {
    const ym = (l.expected_start_date||'').substring(0,7);
    const key = ym < m0 ? m0 : ym; // past → bucket into M0
    if (!groups[key]) groups[key] = [];
    groups[key].push(l);
  });

  const monthOrder = [m0, m1, m2];
  // Add any future months beyond M2
  Object.keys(groups).forEach(k => { if (!monthOrder.includes(k)) monthOrder.push(k); });

  let html = `<div class="sv-pipeline-header">
    <div class="sv-pipeline-title">Pipeline</div>
  </div>`;

  if (!leads.length) {
    html += `<div class="sv-empty">
      <div class="sv-empty-title">ยังไม่มี leads</div>
      <div class="sv-empty-sub">กดปุ่ม + เพื่อเพิ่ม lead ที่คุยอยู่</div>
    </div>`;
  } else {
    monthOrder.forEach(ym => {
      const items = groups[ym];
      if (!items || !items.length) return;
      const total = items.reduce((s,l)=>s+(parseFloat(l.expected_gmv)||0),0);
      html += `<div class="sv-pipeline-month-label">${_salesMonthLabel(ym)}</div>
        <div class="sv-pipeline-summary">฿${_sv_fmt(total)} รวม · ${items.length} leads</div>`;
      items.forEach(l => {
        const dateLabel = l.expected_start_date ?
          new Date(l.expected_start_date).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '—';
        html += `<div class="sv-lead-card">
          <div class="sv-lead-info">
            <div class="sv-lead-name">${l.shop_name||'—'}</div>
            <div class="sv-lead-date">เริ่ม ${dateLabel}</div>
          </div>
          <div class="sv-lead-gmv">฿${_sv_fmt(l.expected_gmv)}</div>
          <div class="sv-lead-actions">
            <div class="sv-lead-btn" onclick="window._salesEditLead('${l.id}')">✎</div>
            <div class="sv-lead-btn" onclick="window._salesDeleteLead('${l.id}','${(l.shop_name||'').replace(/'/g,"\\'")}')">✕</div>
          </div>
        </div>`;
      });
    });
  }

  html += `<button class="sv-fab" id="sv-fab-add" onclick="window._salesAddLead()">+</button>`;
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
    <div class="sv-coming-soon-icon">💰</div>
    <div class="sv-coming-soon-title">Commission</div>
    <div class="sv-coming-soon-sub">ระบบ commission สำหรับ Sales<br>อยู่ระหว่างออกแบบ<br><br>Coming soon</div>
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
    const barClass = pctHeld >= 80 ? 'late' : pctHeld >= 60 ? 'mid' : '';
    const expLabel = acct.newUserExpDate ?
      new Date(acct.newUserExpDate).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'}) : '—';

    const target = document.getElementById('portview-summary');
    if (!target) return;
    // Inject Sales-specific block; hide KAM elements via CSS class
    const salesBlock = document.createElement('div');
    salesBlock.className = 'sales-content-only';
    salesBlock.innerHTML = `<div style="padding:12px 16px;background:rgba(255,255,255,.05);border-radius:14px;margin:8px 0">
      <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.4);font-family:'DM Mono',monospace;margin-bottom:8px">ระยะเวลาในมือ</div>
      <div class="sv-days-bar-track" style="margin-bottom:6px">
        <div class="sv-days-bar-fill ${barClass}" style="width:${pctHeld}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,.5)">
        <span>ถือมา ${acct.daysHeld||0} วัน</span>
        <span>หมด ${expLabel}${daysLeft!==null?' ('+daysLeft+'d)':''}</span>
      </div>
    </div>`;
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
