// ── nrr_view.js — page controller (v4 "Answer First") ────────────────────
// Narrative order: Pulse hero → Team Scoreboard → Movement (KAM) → KAM
// Leaderboard → PM → Admin → Commission strip → footnote. Every section
// answers ONE user question; the hero answers "are we okay?" in one glance.
// All numbers come from pure compute functions (nrr_logic/nrr_aggregate) —
// this file is presentation + interaction state only.

var nrrState = {
  period: null,        // selected quarter month, drives every section
  selectedTeam: null,  // admin's currently-inspected team in the leaderboard
  // v5: movement multi-view switcher — survives month-chip re-renders.
  mvView: {
    portfolio: null,   // 'vp' | 'kam' | 'pm' | 'admin' (null = pick default on first render)
    kamKey: 'org',     // 'org' | 'tl:<email>' | 'kam:<email>' (KAM tab)
    pmBucket: 'chain',
    adminBucket: 'chain'
  }
};
var nrrSlideoverState = { mode: 'kam', movementFilter: 'all', kamFilter: 'all', search: '' };
var nrrSlideoverOutlets = [];
var nrrLastComparison = null;
var nrrLastKamRows = null;
var nrrLastTeamName = '';

async function nrrInitApp() {
  var app = document.getElementById('nrr-app');
  app.innerHTML = nrrShellHtml();
  document.getElementById('nrr-refresh-btn').addEventListener('click', function () { nrrRefresh(true); });
  document.getElementById('nrr-slideover-body').addEventListener('click', function (e) {
    nrrHandleNoteAffClick(e);
    nrrHandleNoteSaveClick(e);
    var retryBtn = e.target.closest('.nrr-comm-retry-upsell-btn');
    if (retryBtn && nrrCommDrawerState) {
      var target = document.getElementById('nrr-comm-drawer-upsell-body');
      if (target) target.innerHTML = '<div class="ds-skel" style="margin-bottom:8px"></div><div class="ds-skel" style="width:65%"></div>';
      delete nrrUpsellBundleCache[retryBtn.dataset.email];
      var snap = nrrLatestSnapshotFor(nrrCommDrawerState.kamEmail);
      var bd = snap && snap.breakdown ? snap.breakdown : null;
      var expOutlets = nrrOutletsForKam(nrrCommDrawerState.kamEmail, nrrCommDrawerState.period)
        .filter(function (o) { return o.movement === 'expansion'; });
      nrrLoadCommissionUpsellSection(retryBtn.dataset.email, new Set(expOutlets.map(function (o) { return String(o.row.outlet_id); })), bd);
    }
  });
  document.getElementById('nrr-slideover-body').addEventListener('keydown', nrrHandleNoteInputKeydown);
  document.getElementById('nrr-slideover-backdrop').addEventListener('click', nrrCloseSlideover);
  document.getElementById('nrr-slideover-close').addEventListener('click', nrrCloseSlideover);
  document.getElementById('nrr-slideover-search').addEventListener('input', function (e) {
    nrrSlideoverState.search = e.target.value.trim().toLowerCase();
    nrrRenderSlideoverBody();
  });
  document.getElementById('nrr-comm-strip').addEventListener('click', function (e) {
    var drillBtn = e.target.closest('.nrr-comm-drill-btn');
    if (drillBtn) { nrrOpenCommissionDrawer(drillBtn.dataset.email, drillBtn.dataset.name, drillBtn.dataset.period); return; }
    var tabBtn = e.target.closest('.nrr-comm-tab');
    if (tabBtn) { nrrCommViewMode = tabBtn.dataset.mode; nrrRenderCommissionSection(); return; }
  });
  document.getElementById('nrr-comm-strip').addEventListener('change', function (e) {
    if (e.target.id !== 'nrr-comm-period-select') return;
    nrrCommSelectedPeriod = e.target.value;
    nrrRenderCommissionFullTable(nrrCommSelectedPeriod);
  });

  // ── Router wiring — see nrr_router.js ──
  nrrRouterRegister('dashboard', function () {
    // Dashboard DOM stays rendered by nrrRenderAll(); nothing to re-render
    // on route entry. Re-arm the scrollspy in case sections re-appeared.
    nrrInitScrollspy();
  });
  nrrRouterRegister('portfolio', nrrRenderPortfolioLayerView);
  nrrRouterRegister('account', nrrRenderAccountView);

  await nrrRefresh(false);
  nrrHandleRoute();
}

// ── Portfolio layer views (Phase A: placeholders — real build in Phase B/C) ──
function nrrRenderPortfolioLayerView(route) {
  var body = document.getElementById('nrr-portfolio-body');
  if (!body) return;
  body.innerHTML =
    '<div class="nrr-panel-head"><div class="h2">Portfolio</div></div>' +
    '<div class="sub" style="margin-top:6px">มุมมองร้านในมือราย KAM (pace, churn signals, drill-down ราย SKU) — เร็วๆ นี้</div>' +
    '<div class="micro" style="margin-top:12px"><a href="#/" style="color:var(--green-deep)">← กลับ Dashboard</a></div>';
}
function nrrRenderAccountView(route) {
  var body = document.getElementById('nrr-account-body');
  if (!body) return;
  body.innerHTML =
    '<div class="nrr-panel-head"><div class="h2">Account</div></div>' +
    '<div class="sub" style="margin-top:6px">หน้าเจาะลึกรายร้าน — เร็วๆ นี้</div>' +
    '<div class="micro" style="margin-top:12px"><a href="#/portfolio" style="color:var(--green-deep)">← กลับ Portfolio</a></div>';
}
window.nrrInitApp = nrrInitApp;

async function nrrRefresh(force) {
  var status = document.getElementById('nrr-sync-status');
  if (status) status.textContent = 'กำลังโหลดข้อมูล...';
  try {
    await nrrFetchQnrrCsv(force);
    await Promise.all([nrrFetchPmCsv(force), nrrFetchAdminCsv(force), nrrFetchVpCsv(force)]);
    await Promise.all([nrrFetchCommissionSnapshots(), nrrFetchCommissionRates(),
                       nrrFetchCommissionPlans(), nrrFetchUpsellTeamCsv(), nrrFetchHandoverCsv()]);
    nrrRenderAll();
    if (status) status.textContent = 'อัปเดตล่าสุด ' + new Date(window.bulkQnrrData.loadedAt).toLocaleString('th-TH');
  } catch (e) {
    if (status) status.textContent = 'โหลดข้อมูลไม่สำเร็จ — กด "รีเฟรช" เพื่อลองใหม่';
  }
}

// ── Shell ────────────────────────────────────────────────────────────────
function nrrShellHtml() {
  // v7 mockup-parity: NO panel/card wrappers — the page is one white canvas;
  // sections separate with whitespace + hairline top-borders, exactly like
  // nrr_v2_mockup. The masthead is quiet (hairline, no shadow); the subnav
  // shares the .seg pill language with the movement switcher (Cabbage active).
  return '' +
    '<div class="nrr-masthead">' +
    '  <div class="nrr-masthead-title">' +
    '    <div class="eyebrow">NRR ไตรมาส · ' + nrrEsc(QNRR_CFG.quarter.toUpperCase()) + '</div>' +
    '    <div class="nrr-masthead-h">Portfolio Notebook</div>' +
    '  </div>' +
    '  <div class="nrr-masthead-nav">' +
    '  <nav class="nrr-appnav" id="nrr-appnav">' +
    '    <a href="#/" data-view="dashboard" class="on">Dashboard</a>' +
    '    <a href="#/portfolio" data-view="portfolio">Portfolio</a>' +
    '  </nav>' +
    '  <span class="nrr-appnav-div"></span>' +
    '  <nav class="seg nrr-subnav" id="nrr-subnav">' +
    '    <a href="#nrr-sec-pulse" data-sec="nrr-sec-pulse" class="on">ภาพรวม</a>' +
    '    <a href="#nrr-sec-movement" data-sec="nrr-sec-movement">KAM</a>' +
    '    <a href="#nrr-sec-pm" data-sec="nrr-sec-pm">PM</a>' +
    '    <a href="#nrr-sec-admin" data-sec="nrr-sec-admin">Admin</a>' +
    '  </nav>' +
    '  </div>' +
    '  <div class="nrr-masthead-actions">' +
    '    <span class="meta nrr-month-capsule" id="nrr-month-capsule">—</span>' +
    '    <span class="micro" id="nrr-sync-status">—</span>' +
    '    <button class="btn-secondary" id="nrr-refresh-btn">รีเฟรช</button>' +
    '  </div>' +
    '</div>' +
    '<div class="nrr-view" id="nrr-view-dashboard">' +
    '<div class="nrr-page">' +
    '  <div class="nrr-section" id="nrr-sec-pulse" style="animation-delay:.02s"><div class="nrr-panel-body" id="nrr-pulse-body"></div></div>' +
    '  <div class="nrr-section" id="nrr-sec-teams" style="animation-delay:.06s"><div class="nrr-takeaway micro" id="nrr-teams-takeaway"></div><div class="nrr-team-cards" id="nrr-team-cards"></div></div>' +
    '  <div class="nrr-section" id="nrr-sec-movement" style="animation-delay:.10s"><div class="nrr-panel-body">' +
    '    <div class="nrr-panel-head"><div class="h2" id="nrr-movement-title">Outlet Movement</div>' +
    '    <div class="nrr-mv-switch"><div class="seg" id="nrr-mv-portfolio-seg"></div><span id="nrr-mv-secondary"></span></div></div>' +
    '    <div class="nrr-takeaway micro" id="nrr-movement-takeaway"></div>' +
    '    <div id="nrr-movement-chart"></div><div style="margin-top:18px;overflow-x:auto" id="nrr-movement-table"></div>' +
    '  </div></div>' +
    '  <div class="nrr-section" id="nrr-sec-kams" style="animation-delay:.14s"><div class="nrr-panel-body">' +
    '    <div class="nrr-panel-head"><div class="h2" id="nrr-kams-title">KAM Leaderboard</div>' +
    '    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '      <span id="nrr-kams-teamchips"></span>' +
    '      <input class="nrr-search" id="nrr-kams-search" placeholder="ค้นหา KAM...">' +
    '      <button class="btn-secondary" id="nrr-team-browse-btn">ดูร้านค้าทั้งทีม</button>' +
    '      <button class="btn-secondary" id="nrr-kams-export">Export CSV</button>' +
    '      <button class="btn-secondary" id="nrr-copy-summary">คัดลอกสรุป</button>' +
    '    </div></div>' +
    '    <table class="nrr-table"><thead><tr><th>KAM</th><th>%NRR</th><th style="text-align:right">GMV</th><th>ร้านค้า</th></tr></thead><tbody id="nrr-kams-tbody"></tbody></table>' +
    '  </div></div>' +
    '  <div class="nrr-section" id="nrr-sec-pm" style="animation-delay:.18s"><div class="nrr-panel-body" id="nrr-pm-body"></div></div>' +
    '  <div class="nrr-section" id="nrr-sec-admin" style="animation-delay:.22s"><div class="nrr-panel-body" id="nrr-admin-body"></div></div>' +
    '  <div class="nrr-section" id="nrr-sec-commission" style="animation-delay:.26s"><div class="nrr-panel-body nrr-comm-strip" id="nrr-comm-strip"></div></div>' +
    '  <div class="nrr-section" id="nrr-sec-footnote" style="animation-delay:.30s"><div class="nrr-panel-body nrr-footnote">' +
    '    <b>%NRR</b> = GMV เดือนปัจจุบัน หารด้วยฐาน GMV เดือน ' + nrrEsc(QNRR_CFG.months_th[QNRR_CFG.base_month] || QNRR_CFG.base_month) + ' ของร้านค้าที่ยัง active หรือกลับมาซื้อ (ปรับด้วย transfer เข้า/ออก) — เฉพาะ %NRR normalize เป็น 30 วันทั้งสองฝั่งเพื่อเทียบข้ามเดือนอย่างยุติธรรม · <b>ตัวเลขเงินทุกจุด</b>แสดงเป็นยอดจริงตามจำนวนวันของเดือนนั้น: เดือนที่จบแล้ว = ยอดจริง, เดือนที่ยังไม่จบ (มี <span class="nrr-rr-proj">~</span>) = คาดการณ์เต็มเดือนจาก MTD ÷ วันที่ผ่านมา × จำนวนวันของเดือน · ข้อมูลอัปเดตรายวัน (ช้ากว่าจริง 1 วัน) ไม่ใช่ real-time' +
    '  </div></div>' +
    '</div>' +
    '</div>' +
    '<div class="nrr-view" id="nrr-view-portfolio" hidden><div class="nrr-page">' +
    '  <div class="nrr-section"><div class="nrr-panel-body" id="nrr-portfolio-body"></div></div>' +
    '</div></div>' +
    '<div class="nrr-view" id="nrr-view-account" hidden><div class="nrr-page">' +
    '  <div class="nrr-section"><div class="nrr-panel-body" id="nrr-account-body"></div></div>' +
    '</div></div>' +
    '<div id="nrr-slideover-backdrop"></div>' +
    '<div class="float" id="nrr-slideover">' +
    '  <div class="nrr-slideover-head"><div><div class="nrr-sh-title" id="nrr-slideover-title">ร้านค้า</div><div class="meta" id="nrr-slideover-sub"></div></div><button class="nrr-sh-close" id="nrr-slideover-close">✕</button></div>' +
    '  <div style="padding:12px 22px 0;display:flex;gap:8px;align-items:center"><input class="nrr-search" id="nrr-slideover-search" placeholder="ค้นหาร้านค้า/account..." style="flex:1;min-width:0"><span id="nrr-slideover-kamwrap" style="display:none"></span></div>' +
    '  <div style="padding:10px 22px 0"><div class="nrr-chip-row" id="nrr-slideover-chips"></div></div>' +
    '  <div class="nrr-slideover-body" id="nrr-slideover-body"></div>' +
    '</div>';
}

// ── Top-level render ─────────────────────────────────────────────────────
function nrrScopeResult() {
  return nrrProfile.role === 'admin' ? nrrOrgResult() : nrrTeamResult(nrrProfile.email);
}
function nrrScopeCtx() {
  return nrrProfile.role === 'admin'
    ? { scope: 'admin', tlEmail: '' }
    : { scope: 'tl', tlEmail: nrrProfile.email };
}

function nrrRenderAll() {
  var isAdmin = nrrProfile.role === 'admin';
  var result = nrrScopeResult();
  if (!nrrState.period || !(result && result.by_month[nrrState.period])) {
    nrrState.period = nrrCurrentPeriod(result);
  }
  if (isAdmin && !nrrState.selectedTeam) {
    var teams = nrrListTeams();
    nrrState.selectedTeam = teams.length ? teams[0].email : null;
  }

  nrrRenderMastheadCapsule(result);
  nrrRenderPulse(result);
  nrrRenderTeamCards();
  nrrRenderMovementSection();
  nrrRenderKamLeaderboard();
  nrrRenderPortfolioSection('pm');
  nrrRenderPortfolioSection('admin');
  nrrRenderCommissionSection();
  nrrBindLeaderboardControls();
  nrrInitScrollspy();
}

function nrrRenderMastheadCapsule(result) {
  var el = document.getElementById('nrr-month-capsule');
  var triple = nrrMonthTriple(result, nrrState.period);
  if (!triple) { el.textContent = '—'; return; }
  el.innerHTML = nrrEsc(QNRR_CFG.months_th[nrrState.period] || nrrState.period) +
    ' · วันที่ <span class="num">' + triple.curr_days + '/' + triple.days_in_month + '</span>';
}

// ── §1 Pulse hero — "are we okay?" in one glance ─────────────────────────
// v5: when vp_view.csv is available (admin) the headline becomes the true
// all-portfolio pooled %NRR, and KAM joins PM/Admin as a satellite. Until
// the file is uploaded, the v4 layout (KAM headline) stays, with an
// explicit note so nobody mistakes KAM for the whole business.
function nrrRenderPulse(result) {
  var body = document.getElementById('nrr-pulse-body');
  var period = nrrState.period;
  var isAdmin = nrrProfile.role === 'admin';
  var vpMode = isAdmin && nrrVpLoaded();

  var heroResult = result;
  var eyebrowLabel = isAdmin ? 'องค์กร · KAM PORTFOLIO' : 'ทีมของคุณ';
  var fallbackNote = '';
  if (vpMode) {
    heroResult = nrrVpResult();
    eyebrowLabel = 'องค์กร · ทุก PORTFOLIO (KAM+PM+ADMIN)';
  } else if (isAdmin) {
    fallbackNote = '<div class="micro" style="margin-top:8px">ภาพรวมรวมทุก portfolio ยังไม่พร้อม (vp_view.csv) — ตัวเลขใหญ่คือ KAM portfolio</div>';
  }
  if (isAdmin) {
    fallbackNote += nrrStaleCsvBannerHtml(window.bulkVpData, 'vp_view.csv') +
      nrrStaleCsvBannerHtml(window.bulkPmData, 'pm_view.csv (PM %NRR ด้านล่างนี้)') +
      nrrStaleCsvBannerHtml(window.bulkAdminData, 'admin_view.csv (Admin %NRR ด้านล่างนี้)');
  }

  var bm = heroResult && period ? heroResult.by_month[period] : null;
  var pct = bm ? bm.nrr_pct : null;
  var triple = nrrMonthTriple(heroResult, period);

  var verdict;
  if (pct == null) verdict = 'ยังไม่มีข้อมูลเดือนนี้';
  else if (pct >= 100) verdict = 'เหนือเป้า +' + (pct - 100) + 'pp เทียบ 100%';
  else if (pct >= 90) verdict = 'ต่ำกว่าเป้า −' + (100 - pct) + 'pp — จับตา';
  else verdict = 'ต่ำกว่าเป้า −' + (100 - pct) + 'pp — ต้องแก้';

  var satDot = '<span class="nrr-sat-dot"></span>';
  var satellitesHtml = '';
  if (isAdmin) {
    var t = nrrTotalPortfolio();
    var kamSat = '';
    if (vpMode) {
      var kamBm = result && result.by_month[period] ? result.by_month[period] : null;
      var kamPct = kamBm ? kamBm.nrr_pct : null;
      kamSat = '<span>' + satDot + 'KAM <b class="num" style="color:' + nrrThresholdColorVar(kamPct) + '">' + nrrFmtPct(kamPct) + '</b></span>';
    }
    satellitesHtml = '<div class="nrr-pulse-satellites">' + kamSat +
      '<span>' + satDot + 'PM <b class="num" style="color:' + nrrThresholdColorVar(t.pm.pct) + '">' + nrrFmtPct(t.pm.pct) + '</b></span>' +
      '<span>' + satDot + 'Admin <b class="num" style="color:' + nrrThresholdColorVar(t.admin.pct) + '">' + nrrFmtPct(t.admin.pct) + '</b></span>' +
      '</div>' + fallbackNote;
  } else {
    var org = nrrOrgResult();
    var orgBm = org && org.by_month[period] ? org.by_month[period] : null;
    satellitesHtml = '<div class="nrr-pulse-satellites"><span>' + satDot + 'องค์กร <b class="num">' + nrrFmtPct(orgBm ? orgBm.nrr_pct : null) + '</b></span></div>';
  }

  var chipsHtml = QNRR_CFG.q_months.map(function (m) {
    var has = result && result.months.indexOf(m) !== -1;
    var on = m === period;
    var mbm = has ? result.by_month[m] : null;
    var progress = '';
    if (mbm && mbm.is_partial) {
      var w = Math.round(mbm.curr_days / (mbm.days_in_month || 30) * 100);
      progress = '<span class="nrr-month-progress"><span style="width:' + w + '%"></span></span>';
    }
    return '<button class="nrr-month-chip' + (on ? ' on' : '') + '"' + (has ? ' data-period="' + m + '"' : ' disabled') + '>' +
      nrrEsc(QNRR_CFG.months_th[m] || m) + progress + '</button>';
  }).join('');

  var compoHtml = nrrCompositionBarHtml(heroResult, period);

  body.innerHTML =
    '<div class="nrr-pulse">' +
    '  <div class="nrr-pulse-verdict">' +
    '    <div class="eyebrow">' + nrrEsc(eyebrowLabel) + ' · ' + nrrEsc(QNRR_CFG.months_th[period] || period || '—') + '</div>' +
    '    <div class="nrr-pulse-pct num" id="nrr-pulse-pct" style="color:' + nrrThresholdColorVar(pct) + '">' + (pct == null ? '—' : (triple && triple.is_partial ? '~' : '') + pct + '%') + '</div>' +
    '    <div class="nrr-verdict">' + nrrEsc(verdict) + '</div>' + satellitesHtml +
    '  </div>' +
    '  <div class="nrr-pulse-triple">' + nrrTripleHtml('lg', triple) + '</div>' +
    '  <div class="nrr-pulse-months">' + chipsHtml + '</div>' +
    '</div>' +
    compoHtml;

  body.querySelectorAll('.nrr-month-chip[data-period]').forEach(function (b) {
    b.addEventListener('click', function () {
      nrrState.period = b.dataset.period;
      nrrRenderAll();
    });
  });
}

// ── §2 Team Scoreboard — two rich cards, not a 2-row table ───────────────
function nrrRenderTeamCards() {
  var isAdmin = nrrProfile.role === 'admin';
  var wrap = document.getElementById('nrr-team-cards');
  var takeaway = document.getElementById('nrr-teams-takeaway');
  var comp = nrrTeamComparison();
  nrrLastComparison = comp;

  var rows = comp.rows;
  if (!isAdmin) rows = rows.filter(function (r) { return r.tl_email === nrrProfile.email; });

  if (isAdmin && comp.rows.length >= 2) {
    var lead = comp.rows[0];
    takeaway.textContent = 'ทีม ' + lead.tl_name + ' นำที่ ' + nrrFmtPct(lead.nrr_pct) +
      ' (' + (lead.delta_vs_org >= 0 ? '+' : '') + lead.delta_vs_org + 'pp เทียบองค์กร)';
  } else { takeaway.textContent = ''; }

  // v7 mockup-parity: divider-split halves (no cards) — lead badge on the
  // top team, 36px pct, one meta line, green text-link actions.
  var leadEmail = (isAdmin && comp.rows.length >= 2 && comp.rows[0].nrr_pct != null && comp.rows[1].nrr_pct != null && comp.rows[0].nrr_pct > comp.rows[1].nrr_pct)
    ? comp.rows[0].tl_email : null;
  var leadGap = leadEmail ? comp.rows[0].nrr_pct - comp.rows[1].nrr_pct : 0;

  wrap.innerHTML = rows.map(function (r) {
    var triple = nrrMonthTriple(r.result, nrrState.period);
    var pct = r.result && r.result.by_month[nrrState.period] ? r.result.by_month[nrrState.period].nrr_pct : r.nrr_pct;
    var badge = r.tl_email === leadEmail ? '<span class="nrr-team-badge">นำ +' + leadGap + 'pp</span>' : '';
    var sub = triple
      ? (triple.is_partial ? '~' : '') + nrrFmtGMV(triple.run_rate) + ' · MTD ' + nrrFmtGMV(triple.mtd) + ' · ' + r.outlet_count.toLocaleString() + ' ร้านค้า'
      : r.outlet_count.toLocaleString() + ' ร้านค้า';
    return '<div class="nrr-team" data-email="' + nrrEsc(r.tl_email) + '">' +
      '<div class="nrr-team-top"><span class="nrr-team-nm">ทีม ' + nrrEsc(r.tl_name) + '</span>' + badge + '</div>' +
      '<div class="nrr-team-pct num" style="color:' + nrrThresholdColorVar(pct) + '">' + (triple && triple.is_partial && pct != null ? '~' : '') + nrrFmtPct(pct) + '</div>' +
      '<div class="nrr-team-sub num">' + sub + '</div>' +
      '<div class="nrr-team-acts">' +
      '<a href="#" data-act="kams">ดู KAM →</a>' +
      '<a href="#" data-act="browse">ดูร้านค้าทั้งทีม (' + r.outlet_count.toLocaleString() + ') →</a>' +
      '</div></div>';
  }).join('');

  wrap.querySelectorAll('.nrr-team').forEach(function (card) {
    card.querySelector('[data-act="kams"]').addEventListener('click', function (e) {
      e.preventDefault();
      nrrState.selectedTeam = card.dataset.email;
      nrrRenderKamLeaderboard();
      document.getElementById('nrr-sec-kams').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    card.querySelector('[data-act="browse"]').addEventListener('click', function (e) {
      e.preventDefault();
      nrrOpenSlideoverTeam(card.dataset.email);
    });
  });
}

// ── §3 Movement — multi-view switcher (v5) ───────────────────────────────
// One central chart+table that can show every lens: ภาพรวม (VP pooled) /
// KAM (org · per-team · per-rep) / PM / Admin (Chain|SA-MC). PM/Admin
// sections keep only their tiles — their old duplicate movement modules
// are gone; "ดู movement →" buttons jump here pre-switched instead.

function nrrVpLoaded() {
  return !!(window.bulkVpData && window.bulkVpData.loaded && window.bulkVpData.allRows.length);
}

// Resolve current mvView state → {result, scopeCtx, showKam, title, subLabel}
function nrrMovementViewModel() {
  var isAdmin = nrrProfile.role === 'admin';
  var mv = nrrState.mvView;

  // First-render / invalid-state defaults per role.
  if (!mv.portfolio) mv.portfolio = (isAdmin && nrrVpLoaded()) ? 'vp' : 'kam';
  if (mv.portfolio === 'vp' && (!isAdmin || !nrrVpLoaded())) mv.portfolio = 'kam';
  if (!isAdmin && mv.portfolio === 'kam' && mv.kamKey === 'org') mv.kamKey = 'tl:' + nrrProfile.email;

  if (mv.portfolio === 'vp') {
    return { result: nrrVpResult(), scopeCtx: { scope: 'bucket' }, showKam: false, title: 'Outlet Movement — ภาพรวมทุก Portfolio' };
  }
  if (mv.portfolio === 'pm' || mv.portfolio === 'admin') {
    var bucket = isAdmin ? (mv.portfolio === 'pm' ? mv.pmBucket : mv.adminBucket) : nrrBucketForTl(nrrProfile.email);
    var bucketResult = mv.portfolio === 'pm' ? nrrPmResult() : nrrAdminResult();
    return {
      result: bucketResult ? bucketResult[bucket] : null,
      scopeCtx: { scope: 'bucket' }, showKam: false,
      title: 'Outlet Movement — ' + (mv.portfolio === 'pm' ? 'PM' : 'Admin') + ' · ' + (bucket === 'chain' ? 'Chain' : 'SA/MC')
    };
  }
  // KAM tab
  if (mv.kamKey === 'org') {
    return { result: nrrOrgResult(), scopeCtx: { scope: 'admin', tlEmail: '' }, showKam: true, title: 'Outlet Movement — KAM · องค์กร' };
  }
  if (mv.kamKey.indexOf('tl:') === 0) {
    var tlEmail = mv.kamKey.slice(3);
    var teamName = (nrrListTeams().find(function (t) { return t.email === tlEmail; }) || {}).name || tlEmail;
    return { result: nrrTeamResult(tlEmail), scopeCtx: { scope: 'tl', tlEmail: tlEmail }, showKam: true, title: 'Outlet Movement — KAM · ทีม ' + teamName };
  }
  var kamEmail = mv.kamKey.slice(4);
  var qd = window.bulkQnrrData;
  var kamRow = ((qd && qd.byKamEmail[kamEmail]) || [])[0];
  var kamName = kamRow ? kamRow.latest_staff_owner : kamEmail;
  return { result: nrrKamResult(kamEmail), scopeCtx: { scope: 'kam', tlEmail: '' }, showKam: false, title: 'Outlet Movement — KAM · ' + kamName };
}

function nrrRenderMovementSwitcher() {
  var isAdmin = nrrProfile.role === 'admin';
  var mv = nrrState.mvView;
  var seg = document.getElementById('nrr-mv-portfolio-seg');
  var secondary = document.getElementById('nrr-mv-secondary');

  var tabs = [];
  if (isAdmin && nrrVpLoaded()) tabs.push({ key: 'vp', label: 'ภาพรวม' });
  tabs.push({ key: 'kam', label: 'KAM' }, { key: 'pm', label: 'PM' }, { key: 'admin', label: 'Admin' });

  seg.innerHTML = tabs.map(function (t) {
    return '<button' + (mv.portfolio === t.key ? ' class="on"' : '') + ' data-portfolio="' + t.key + '">' + t.label + '</button>';
  }).join('');
  seg.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      nrrState.mvView.portfolio = b.dataset.portfolio;
      nrrRenderMovementSection();
    });
  });

  // Secondary picker per tab
  if (mv.portfolio === 'kam') {
    var teams = nrrListTeams();
    var myTeams = isAdmin ? teams : teams.filter(function (t) { return t.email === nrrProfile.email; });
    var optHtml = isAdmin ? '<option value="org"' + (mv.kamKey === 'org' ? ' selected' : '') + '>องค์กร</option>' : '';
    optHtml += '<optgroup label="ทีม">' + myTeams.map(function (t) {
      var v = 'tl:' + t.email;
      return '<option value="' + nrrEsc(v) + '"' + (mv.kamKey === v ? ' selected' : '') + '>ทีม ' + nrrEsc(t.name) + '</option>';
    }).join('') + '</optgroup>';
    optHtml += myTeams.map(function (t) {
      return '<optgroup label="ราย KAM · ' + nrrEsc(t.name) + '">' + nrrListKamsForTeam(t.email).map(function (k) {
        var v = 'kam:' + k.email;
        return '<option value="' + nrrEsc(v) + '"' + (mv.kamKey === v ? ' selected' : '') + '>' + nrrEsc(k.name) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    secondary.innerHTML = '<select class="nrr-search" id="nrr-mv-kam-select">' + optHtml + '</select>';
    document.getElementById('nrr-mv-kam-select').addEventListener('change', function (e) {
      nrrState.mvView.kamKey = e.target.value;
      nrrRenderMovementSection();
    });
  } else if ((mv.portfolio === 'pm' || mv.portfolio === 'admin') && isAdmin) {
    var cur = mv.portfolio === 'pm' ? mv.pmBucket : mv.adminBucket;
    secondary.innerHTML = '<div class="seg"><button' + (cur === 'chain' ? ' class="on"' : '') + ' data-bucket="chain">Chain</button><button' + (cur === 'sa_mc' ? ' class="on"' : '') + ' data-bucket="sa_mc">SA/MC</button></div>';
    secondary.querySelectorAll('[data-bucket]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (nrrState.mvView.portfolio === 'pm') nrrState.mvView.pmBucket = b.dataset.bucket;
        else nrrState.mvView.adminBucket = b.dataset.bucket;
        nrrRenderMovementSection();
      });
    });
  } else {
    secondary.innerHTML = '';
  }
}

function nrrRenderMovementSection() {
  // Resolve the view model FIRST — it normalizes null/invalid mvView state
  // (role defaults, vp fallback) that the switcher rendering depends on.
  var vm = nrrMovementViewModel();
  nrrRenderMovementSwitcher();
  document.getElementById('nrr-movement-title').textContent = vm.title;

  var takeaway = document.getElementById('nrr-movement-takeaway');
  var bm = vm.result && vm.result.by_month[nrrState.period];
  if (bm) {
    var churnGmv = bm.segments.core_nrr_churn || 0;
    var upside = (bm.segments.expansion || 0) + (bm.segments.comeback || 0) + (bm.segments.transfer_in || 0);
    takeaway.textContent = 'Core รักษาไว้ ' + nrrFmtGMV(bm.segments.core_nrr || 0) +
      ' · เสียจาก churn −' + nrrFmtGMV(churnGmv) + ' (' + (bm.outlets.core_nrr_churn || 0) + ' ร้าน)' +
      ' · ชดเชยกลับ +' + nrrFmtGMV(upside);
  } else {
    takeaway.textContent = vm.result ? '' : 'ยังไม่มีข้อมูลสำหรับมุมมองนี้ (ไฟล์ CSV ยังไม่ถูกอัปโหลดไป R2)';
  }

  nrrRenderMovementChart('nrr-movement-chart', 'nrr-movement-table', vm.result, {
    scopeCtx: vm.scopeCtx,
    showKam: vm.showKam,
    // v6: every non-zero cell opens the slide-over directly (movement mode)
    // instead of an inline expansion row under the table.
    onCellClick: function (mv, cohort, month, outlets) { nrrOpenSlideoverMovement(mv, month, outlets, vm.showKam, cohort); }
  });
}

// ── §4 KAM Leaderboard ───────────────────────────────────────────────────
function nrrRenderKamLeaderboard() {
  var isAdmin = nrrProfile.role === 'admin';
  var tlEmail = isAdmin ? nrrState.selectedTeam : nrrProfile.email;
  if (!tlEmail) return;
  var teamName = (nrrListTeams().find(function (t) { return t.email === tlEmail; }) || {}).name || tlEmail;
  nrrLastTeamName = teamName;

  document.getElementById('nrr-kams-title').textContent = 'KAM Leaderboard — ทีม ' + teamName;

  // Admin: team-switch chips
  var chipWrap = document.getElementById('nrr-kams-teamchips');
  if (isAdmin) {
    chipWrap.innerHTML = nrrListTeams().map(function (t) {
      return '<button class="nrr-chip' + (t.email === tlEmail ? ' on' : '') + '" data-team="' + nrrEsc(t.email) + '">' + nrrEsc(t.name) + '</button>';
    }).join('');
    chipWrap.querySelectorAll('[data-team]').forEach(function (b) {
      b.addEventListener('click', function () {
        nrrState.selectedTeam = b.dataset.team;
        nrrRenderKamLeaderboard();
      });
    });
  } else { chipWrap.innerHTML = ''; }

  var kams = nrrKamRowsForTeam(tlEmail, nrrState.period);
  nrrLastKamRows = kams;
  var tbody = document.getElementById('nrr-kams-tbody');
  tbody.innerHTML = kams.map(function (k, i) {
    var kamResult = nrrKamResult(k.kam_email);
    var triple = nrrMonthTriple(kamResult, k.period);
    return '<tr data-email="' + nrrEsc(k.kam_email) + '" data-period="' + nrrEsc(k.period) + '" data-name="' + nrrEsc(k.kam_name.toLowerCase()) + '" style="animation-delay:' + (i * 0.05) + 's" class="nrr-fade-row">' +
      '<td>' + nrrEsc(k.kam_name) + '</td>' +
      '<td class="num-cell" style="color:' + nrrThresholdColorVar(k.nrr_pct) + '">' + nrrFmtPct(k.nrr_pct) + '</td>' +
      '<td>' + nrrTripleHtml('md', triple) + '</td>' +
      '<td class="num-cell">' + k.outlet_count + '</td>' +
      '</tr>';
  }).join('');
  tbody.querySelectorAll('tr').forEach(function (tr) {
    tr.addEventListener('click', function () { nrrOpenSlideoverKam(tr.dataset.email, tr.dataset.period); });
  });

  var browseBtn = document.getElementById('nrr-team-browse-btn');
  var totalOutlets = kams.reduce(function (s, k) { return s + k.outlet_count; }, 0);
  browseBtn.textContent = 'ดูร้านค้าทั้งทีม (' + totalOutlets + ')';
  browseBtn.onclick = function () { nrrOpenSlideoverTeam(tlEmail); };
}

function nrrBindLeaderboardControls() {
  var search = document.getElementById('nrr-kams-search');
  if (!search._bound) {
    search._bound = true;
    search.addEventListener('input', function (e) { nrrFilterTableRows('nrr-kams-tbody', e.target.value); });
    document.getElementById('nrr-kams-export').addEventListener('click', nrrExportKamsCsv);
    document.getElementById('nrr-copy-summary').addEventListener('click', function (e) {
      nrrCopyText(nrrBuildCopySummary(), e.target);
    });
  }
}

function nrrFilterTableRows(tbodyId, query) {
  var q = query.trim().toLowerCase();
  document.getElementById(tbodyId).querySelectorAll('tr').forEach(function (tr) {
    var name = tr.dataset.name || tr.textContent.toLowerCase();
    tr.style.display = !q || name.indexOf(q) !== -1 ? '' : 'none';
  });
}

function nrrExportKamsCsv() {
  if (!nrrLastKamRows) return;
  nrrExportCsv('nrr-kams-' + QNRR_CFG.quarter + '.csv',
    ['KAM', '%NRR', 'Base GMV', 'ร้านค้า'],
    nrrLastKamRows.map(function (k) { return [k.kam_name, k.nrr_pct, k.base_gmv, k.outlet_count]; }));
}

function nrrBuildCopySummary() {
  var lines = ['NRR ' + QNRR_CFG.quarter.toUpperCase() + ' · ' + (QNRR_CFG.months_th[nrrState.period] || nrrState.period) + ' — ' + (nrrProfile.role === 'admin' ? 'องค์กร' : nrrLastTeamName)];
  if (nrrLastComparison && nrrProfile.role === 'admin') {
    nrrLastComparison.rows.forEach(function (r) { lines.push(r.tl_name + ': ' + nrrFmtPct(r.nrr_pct) + ' (' + nrrFmtGMV(r.base_gmv) + ')'); });
  }
  if (nrrLastKamRows) {
    lines.push('--- KAM: ' + nrrLastTeamName + ' ---');
    nrrLastKamRows.forEach(function (k) { lines.push(k.kam_name + ': ' + nrrFmtPct(k.nrr_pct) + ' (' + nrrFmtGMV(k.base_gmv) + ')'); });
  }
  return lines.join('\n');
}

// ── §5/§6 PM & Admin portfolio sections (v5: tiles only) ─────────────────
// The duplicate collapsible movement modules are gone — the central
// movement switcher covers those views. Each tile keeps its %NRR + triple
// and gains a "ดู movement →" button that pre-switches the central section
// and scrolls there. One chart component, one source of truth on screen.
// Shared banner for a portfolio CSV whose data predates the current
// quarter — see the isStale flag set in _nrrFetchPortfolioCsv (nrr_data.js).
function nrrStaleCsvBannerHtml(bulkData, filename) {
  if (!bulkData || !bulkData.isStale) return '';
  var monthList = (bulkData.months || []).map(function (m) { return QNRR_CFG.months_th[m] || m; }).join(', ');
  return '<div class="nrr-stale-banner">⚠️ ' + nrrEsc(filename) + ' มีข้อมูลเดือน ' + nrrEsc(monthList) +
    ' — ไม่ใช่ไตรมาสปัจจุบัน (' + nrrEsc(QNRR_CFG.q_months.map(function (m) { return QNRR_CFG.months_th[m] || m; }).join(', ')) + ') ' +
    'ตัวเลขด้านล่างเป็นข้อมูลไตรมาสก่อนที่ยังไม่ได้ re-run/upload ใหม่</div>';
}

function nrrRenderPortfolioSection(kind) {
  var body = document.getElementById('nrr-' + kind + '-body');
  var isAdmin = nrrProfile.role === 'admin';
  var label = kind === 'pm' ? 'PM' : 'Admin';
  var bucketData = kind === 'pm' ? window.bulkPmData : window.bulkAdminData;
  var staleBanner = nrrStaleCsvBannerHtml(bucketData, kind === 'pm' ? 'pm_view.csv' : 'admin_view.csv');
  var bucketResult = kind === 'pm' ? nrrPmResult() : nrrAdminResult();

  var myBucket = isAdmin ? null : nrrBucketForTl(nrrProfile.email);
  if (!isAdmin && !myBucket) { body.innerHTML = '<div class="h2">' + label + ' Portfolio</div><div class="micro" style="margin-top:8px">ไม่มี bucket ที่ผูกกับทีมของคุณ</div>'; return; }

  if (!bucketResult) {
    body.innerHTML = '<div class="h2">' + label + ' Portfolio</div>' +
      '<div class="micro" style="margin-top:8px">ยังไม่มีข้อมูล ' + label + ' — ไฟล์ ' + (kind === 'pm' ? 'pm_view.csv' : 'admin_view.csv') + ' ยังไม่ถูกอัปโหลดไป R2</div>';
    return;
  }

  var buckets = isAdmin ? ['chain', 'sa_mc'] : [myBucket];
  var tilesHtml = buckets.map(function (b) {
    var r = bucketResult[b];
    var period = r && r.by_month[nrrState.period] ? nrrState.period : (r ? nrrCurrentPeriod(r) : null);
    var pct = r && period ? r.by_month[period].nrr_pct : null;
    var triple = r && period ? nrrMonthTriple(r, period) : null;
    var bLabel = b === 'chain' ? 'Chain' : 'SA/MC';
    return '<div class="nrr-kpi-tile">' +
      '<div class="nrr-kpi-value num" style="color:' + nrrThresholdColorVar(pct) + '">' + (triple && triple.is_partial && pct != null ? '~' : '') + nrrFmtPct(pct) + '</div>' +
      '<div class="nrr-kpi-label">' + bLabel + ' — %NRR</div>' +
      '<div style="margin-top:6px">' + nrrTripleHtml('md', triple) + '</div>' +
      '<div style="margin-top:10px"><button class="btn-secondary" data-mv-jump="' + b + '" style="padding:6px 12px;font-size:12.5px">ดู movement →</button></div>' +
      '</div>';
  }).join('');

  body.innerHTML =
    '<div class="nrr-panel-head"><div class="h2">' + label + ' Portfolio — แยกตาม Account Type</div></div>' +
    staleBanner +
    '<div class="nrr-kpi-grid" style="grid-template-columns:repeat(' + buckets.length + ',1fr)">' + tilesHtml + '</div>';

  body.querySelectorAll('[data-mv-jump]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      nrrState.mvView.portfolio = kind;
      if (kind === 'pm') nrrState.mvView.pmBucket = btn.dataset.mvJump;
      else nrrState.mvView.adminBucket = btn.dataset.mvJump;
      nrrRenderMovementSection();
      document.getElementById('nrr-sec-movement').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ── §7 Commission section — hero + 3-bar trend + per-team/per-KAM
// breakdown, read-only from commission_payout_snapshots (never recomputed).
// Admin sees org total + per-team rows; TL sees own payout + per-KAM rows
// for their own team, matching the role branch the old strip already used.
// 'summary' = existing hero/trend/rows (quick glance, current quarter only).
// 'full' = wide spreadsheet-style table, any historical period, sourced
// entirely from breakdown jsonb — the two views serve different jobs
// (glance vs. audit-everything) so they coexist as tabs, per user request.
var nrrCommViewMode = 'summary';
var nrrCommSelectedPeriod = null;

// Status stamp — the commission signature: money state rendered as one
// consistent chip language everywhere (hero, rows, drawer, full table).
// ESTIMATE = outline (ยังไม่ใช่เงินจริง) · DRAFT = sun fill (รอล็อก) ·
// FINAL = green fill (ล็อกแล้ว — ตราประทับ "จ่ายแล้ว")
function nrrCommStampHtml(status, small) {
  var cls = status === 'final' ? 'final' : status === 'draft' ? 'draft' : 'est';
  var label = status === 'final' ? 'FINAL' : status === 'draft' ? 'DRAFT' : 'ESTIMATE';
  return '<span class="nrr-comm-stamp ' + cls + (small ? ' sm' : '') + '">' + label + '</span>';
}

function nrrRenderCommissionSection() {
  var isAdmin = nrrProfile.role === 'admin';
  var period = nrrState.period;

  // Tabs reuse the page's own .mode segmented control (black .on pill) —
  // .nrr-comm-tab stays as the click-delegation hook, no custom styling.
  var tabsHtml = '<div class="mode">' +
    '<button type="button" class="nrr-comm-tab' + (nrrCommViewMode === 'summary' ? ' on' : '') + '" data-mode="summary">สรุป</button>' +
    '<button type="button" class="nrr-comm-tab' + (nrrCommViewMode === 'full' ? ' on' : '') + '" data-mode="full">ตารางเต็ม</button>' +
    '</div>';

  if (nrrCommViewMode === 'full') {
    document.getElementById('nrr-comm-strip').innerHTML = '<div class="nrr-comm-ds">' + tabsHtml +
      '<select class="nrr-comm-period-select" id="nrr-comm-period-select"><option>กำลังโหลดเดือน...</option></select>' +
      '<div id="nrr-comm-fulltable-body"><div class="ds-skel" style="height:160px"></div></div>' +
      '</div>';
    nrrFetchAvailablePeriods().then(function (periods) {
      var sel = document.getElementById('nrr-comm-period-select');
      if (!sel) return;
      if (!periods.length) {
        sel.innerHTML = '<option>ไม่มีข้อมูล</option>';
        document.getElementById('nrr-comm-fulltable-body').innerHTML = '<div class="ds-empty"><div class="ds-empty-title">ยังไม่มี snapshot ในระบบเลย</div></div>';
        return;
      }
      if (!nrrCommSelectedPeriod || periods.indexOf(nrrCommSelectedPeriod) === -1) nrrCommSelectedPeriod = periods[0];
      sel.innerHTML = periods.map(function (p) {
        return '<option value="' + p + '"' + (p === nrrCommSelectedPeriod ? ' selected' : '') + '>' + nrrEsc(QNRR_CFG.months_th[p] || p) + '</option>';
      }).join('');
      nrrRenderCommissionFullTable(nrrCommSelectedPeriod);
    });
    return;
  }

  var rows = isAdmin
    ? nrrListTeams().map(function (t) { return { email: t.email, name: t.name, kind: 'tl' }; })
    : nrrListKamsForTeam(nrrProfile.email).map(function (k) { return { email: k.email, name: k.name, kind: 'kam' }; });

  document.getElementById('nrr-comm-strip').innerHTML =
    '<div class="nrr-comm-ds">' + tabsHtml +
    nrrCommissionHeroHtml(isAdmin, period) +
    nrrCommissionTrendHtml(isAdmin) +
    nrrCommissionRowsHtml(isAdmin, rows, period) +
    nrrCommissionFootnoteHtml() +
    '</div>';
}

// Tier-based estimate for one beneficiary for one quarter month — the SAME
// path everywhere (hero, trend bars, rows), so the hero always equals the
// sum of its rows. Returns null when the month has no GMV data yet (future
// months) so callers can render "pending" instead of a fake zero.
// Uses the estimate engine v2 in nrr_commission.js (real plan tiers ×
// multiplier/gate), NOT the retired %-of-GMV scheme.
function nrrCommEstimateFor(email, kind, month) {
  var result = kind === 'tl' ? nrrTeamResult(email) : nrrKamResult(email);
  if (!result || !result.by_month || !result.by_month[month]) return null;
  var pct = result.by_month[month].nrr_pct;
  if (pct == null) return null;
  return kind === 'tl'
    ? nrrEstimateTlCommission(email, month, pct)
    : nrrEstimateKamCommission(email, month, pct);
}

// ── Tier achievement UI (Sense-pattern "hit/bonus/miss", ported to Fresh
// Canvas tokens — never Sense's own gold/blue) — a SECOND status axis from
// the ESTIMATE/DRAFT/FINAL stamp: that stamp says "is this number locked
// yet"; this chip says "did the tier target get hit". Both can be shown
// together without conflict. ──────────────────────────────────────────
function nrrCommTierChipHtml(tierTable) {
  if (!tierTable) return '';
  var hasPayout = tierTable.currentTier && tierTable.currentTier.payout > 0;
  var cls = !hasPayout ? 'miss' : tierTable.nextTier ? 'hit' : 'bonus';
  var text = !hasPayout ? 'ยังไม่ถึงเกณฑ์' : tierTable.nextTier ? 'ถึงเกณฑ์แล้ว' : 'โบนัสสูงสุด';
  return '<span class="nrr-comm-tier-chip ' + cls + '">' + text + '</span>';
}

function nrrCommProgressHtml(tierTable, pct) {
  if (!tierTable || pct == null) return '';
  var pctFill;
  if (tierTable.currentTier && tierTable.nextTier) {
    var lo = Number(tierTable.currentTier.min) || 0, hi = Number(tierTable.nextTier.min);
    pctFill = hi > lo ? (pct - lo) / (hi - lo) * 100 : 100;
  } else if (!tierTable.currentTier && tierTable.tiers.length) {
    var firstMin = Number(tierTable.tiers[0].min) || 1;
    pctFill = pct / firstMin * 100;
  } else {
    pctFill = 100; // max tier — bar reads full
  }
  pctFill = Math.max(2, Math.min(100, Math.round(pctFill)));
  return '<div class="nrr-comm-progress"><div class="nrr-comm-progress-fill" style="width:' + pctFill + '%"></div></div>';
}

function nrrCommNextStepHtml(tierTable, pct) {
  if (pct == null) return 'รอข้อมูล NRR ของเดือนนี้';
  if (!tierTable) return '';
  if (!tierTable.currentTier || tierTable.currentTier.payout === 0) {
    var first = tierTable.tiers.filter(function (t) { return t.payout > 0; })[0];
    if (first) return 'ดัน NRR อีก +' + Math.max(0, Math.ceil(Number(first.min) - pct)) + 'pp ถึงเกณฑ์แรก (' + nrrFmtGMVExact(first.payout) + ')';
    return 'ดัน NRR ให้ถึงเกณฑ์แรกเพื่อเริ่มรับค่าคอมฯ';
  }
  if (tierTable.nextTier) {
    return 'อีก +' + tierTable.gapPp + 'pp ถึง ' + nrrFmtGMVExact(tierTable.nextTier.payout) + (tierTable.nextTier.label ? ' (' + nrrEsc(tierTable.nextTier.label) + ')' : '');
  }
  return 'รักษา NRR ให้อยู่ใน tier นี้จนจบเดือน';
}

// ── Receipt — the running-total "why is my number this" statement.
// One line per formula term (add/multiply/subtotal/total). 'add' lines
// with a drillKey and matching content in sectionsByKey become expandable
// <details> rows revealing the account-level list; everything else is a
// plain line. This is the SAME renderer for a locked snapshot's steps
// (nrrCommSnapshotReceiptSteps) and a live estimate's steps
// (nrrCommEstimateReceiptSteps) — one visual language regardless of lock
// status, which is the point of this redesign.
// Compact tier indicator for summary rows (main list + KAM-in-team list) —
// chip + thin progress bar, no next-step prose (that's drawer-only detail).
function nrrCommTierMiniHtml(role, email, period, pct) {
  if (pct == null) return '';
  var t = nrrCommTierTable(role, email, period, pct);
  return '<span class="nrr-comm-tier-mini" style="flex:none;margin-top:2px">' + nrrCommTierChipHtml(t) + nrrCommProgressHtml(t, pct) + '</span>';
}

function nrrCommReceiptHtml(steps, sectionsByKey) {
  sectionsByKey = sectionsByKey || {};
  var rowsHtml = steps.map(function (s) {
    if (s.kind === 'multiply') {
      return '<div class="nrr-comm-receipt-line op"><span>× ' + nrrEsc(s.label) + '</span><span class="num">×' + Number(s.factor).toFixed(2) + '</span></div>';
    }
    if (s.kind === 'subtotal') {
      return '<div class="nrr-comm-receipt-rule"></div><div class="nrr-comm-receipt-line subtotal"><span>' + nrrEsc(s.label) + '</span><span class="num">' + nrrFmtGMVExact(s.amount) + '</span></div>';
    }
    if (s.kind === 'total') {
      return '<div class="nrr-comm-receipt-rule total"></div><div class="nrr-comm-receipt-line total"><span>' + nrrEsc(s.label) + '</span><span class="num">' + nrrFmtGMVExact(s.amount) + '</span></div>';
    }
    var body = s.drillKey ? sectionsByKey[s.drillKey] : null;
    if (body) {
      return '<details class="nrr-comm-receipt-line expandable"><summary><span>+ ' + nrrEsc(s.label) + '</span><span class="num">' + nrrFmtGMVExact(s.amount) + '</span></summary><div class="nrr-comm-receipt-detail">' + body + '</div></details>';
    }
    return '<div class="nrr-comm-receipt-line"><span>+ ' + nrrEsc(s.label) + '</span><span class="num">' + nrrFmtGMVExact(s.amount) + '</span></div>';
  }).join('');
  return '<div class="nrr-comm-receipt">' + rowsHtml + '</div>';
}

function nrrCommissionHeroHtml(isAdmin, period) {
  if (isAdmin) {
    var teams = nrrListTeams();
    var total = 0, snapCount = 0, estCount = 0, statuses = [];
    teams.forEach(function (t) {
      var snap = nrrLatestSnapshotFor(t.email);
      if (snap) {
        total += Number(snap.payout_amount || 0);
        snapCount++;
        statuses.push(snap.snapshot_status);
      } else {
        var est = nrrCommEstimateFor(t.email, 'tl', period);
        if (est) { total += est.est; estCount++; }
      }
    });
    var stamp;
    if (estCount > 0) stamp = nrrCommStampHtml('estimate');
    else if (statuses.length && statuses.every(function (s) { return s === 'final'; })) stamp = nrrCommStampHtml('final');
    else stamp = nrrCommStampHtml(statuses[0] || 'draft');
    var sub = estCount > 0
      ? 'snapshot ' + snapCount + '/' + teams.length + ' ทีม · รวมค่าประมาณ pace-based ' + estCount + ' ทีม (' + nrrEsc(QNRR_CFG.months_th[period] || period) + ')'
      : 'snapshot ' + snapCount + '/' + teams.length + ' ทีม · payout เดือนล่าสุดที่ lock แล้ว';
    return '<div class="ds-hero"><div class="ds-hero-eyebrow">Commission · องค์กร ' + stamp + '</div>' +
      '<div class="ds-hero-number">' + nrrFmtGMVExact(total) + '</div>' +
      '<div class="ds-hero-sub">' + sub + '</div></div>';
  }

  var mySnap = nrrLatestSnapshotFor(nrrProfile.email);
  var showEst = !mySnap;
  var displayPeriod = mySnap ? mySnap.period_month : period;
  var estBadge = showEst ? nrrCommStampHtml('estimate') : nrrCommStampHtml(mySnap.snapshot_status);
  var amountHtml, subHtml;
  if (showEst) {
    var est = nrrCommEstimateFor(nrrProfile.email, 'tl', period);
    amountHtml = nrrFmtGMVExact(est ? est.est : 0);
    subHtml = est
      ? ('NRR ' + est.pct + '% → ' + est.note)
      : 'ไม่มีข้อมูลเพียงพอสำหรับประมาณการ';
  } else {
    amountHtml = nrrFmtGMVExact(Number(mySnap.payout_amount || 0));
    // status itself is now the stamp in the eyebrow — sub only carries the date
    subHtml = mySnap.updated_at
      ? 'อัปเดต ' + new Date(mySnap.updated_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
      : '';
  }
  return '<div class="ds-hero"><div class="ds-hero-eyebrow">Commission · ' +
    nrrEsc(QNRR_CFG.months_th[displayPeriod] || displayPeriod) + estBadge + '</div>' +
    '<div class="ds-hero-number">' + amountHtml + '</div>' +
    '<div class="ds-hero-sub">' + subHtml + '</div></div>';
}

function nrrCommissionTrendHtml(isAdmin) {
  var trendEmails = isAdmin ? nrrListTeams().map(function (t) { return t.email; }) : [nrrProfile.email];
  var bars = QNRR_CFG.q_months.map(function (m) {
    var v = 0; var has = false; var estUsed = false;
    trendEmails.forEach(function (email) {
      var row = nrrSnapshotsForEmailAcrossMonths(email)[m];
      if (row && row.payout_amount != null) {
        v += Number(row.payout_amount) || 0; has = true;
      } else {
        // No snapshot for this beneficiary+month → pace-based estimate.
        // Future months return null (no GMV rows yet) and stay pending.
        var est = nrrCommEstimateFor(email, 'tl', m);
        if (est) { v += est.est; has = true; estUsed = true; }
      }
    });
    return { month: m, v: v, has: has, est: estUsed };
  });
  var maxV = Math.max.apply(null, [1].concat(bars.map(function (b) { return b.v; })));
  var barsHtml = bars.map(function (b) {
    var h = b.has ? Math.max(8, Math.round(b.v / maxV * 100)) : 8;
    var label = (QNRR_CFG.months_th[b.month] || b.month) + ': ' +
      (b.has ? (b.est ? '~' : '') + nrrFmtGMVExact(b.v) + (b.est ? ' (ประมาณการ)' : '') : 'ยังไม่มี snapshot');
    return '<div class="ds-spark-bar' + (b.has ? (b.est ? ' est' : ' active') : '') + '" style="height:' + h + '%" title="' + nrrEsc(label) + '"></div>';
  }).join('');
  var labelsHtml = bars.map(function (b) {
    return '<span>' + nrrEsc((QNRR_CFG.months_th[b.month] || b.month).split(' ')[0]) + '</span>';
  }).join('');
  return '<div class="nrr-comm-drawer-section"><div class="ds-section-hd"><span class="ds-eyebrow">Commission ต่อไตรมาส</span></div>' +
    '<div class="ds-spark">' + barsHtml + '</div>' +
    '<div class="ds-spark-labels">' + labelsHtml + '</div></div>';
}

function nrrCommissionRowsHtml(isAdmin, rows, period) {
  var rowsHtml = rows.map(function (r) {
    var snap = nrrLatestSnapshotFor(r.email);
    var nrrPct, payoutAmt, metaLabel, bd, isEstRow, stampHtml;
    if (snap) {
      nrrPct = snap.governed_nrr_pct != null ? snap.governed_nrr_pct : snap.raw_nrr_pct;
      payoutAmt = Number(snap.payout_amount || 0);
      metaLabel = QNRR_CFG.months_th[snap.period_month] || snap.period_month;
      bd = snap.breakdown || null;
      isEstRow = false;
      stampHtml = nrrCommStampHtml(snap.snapshot_status, true);
    } else {
      var result = r.kind === 'tl' ? nrrTeamResult(r.email) : nrrKamResult(r.email);
      var bm = result && period ? result.by_month[period] : null;
      nrrPct = bm ? bm.nrr_pct : null;
      var est = nrrCommEstimateFor(r.email, r.kind, period);
      payoutAmt = est ? est.est : 0;
      metaLabel = QNRR_CFG.months_th[period] || period;
      bd = null;
      isEstRow = true;
      r._estNote = est ? est.note : null;
      stampHtml = nrrCommStampHtml('estimate', true);
    }
    var detailHtml = bd
      ? nrrCommissionBreakdownDetailHtml(bd)
      : '<div class="ds-stat-row"><span class="ds-stat-label">ประมาณการ: ' + nrrEsc(r._estNote || 'ยังไม่มีข้อมูลเพียงพอ') + '</span></div>';
    // Admin sees team rows — expand to the KAMs inside that team so a TL's
    // number is explainable without switching accounts (user ask 2026-07-09).
    if (r.kind === 'tl' && isAdmin) {
      detailHtml += nrrCommissionTeamKamsHtml(r.email, period);
    }
    // V2: click-through to the full outlet-level drill-down drawer — only
    // meaningful for KAM rows (that's what has upsell/handover/outlet detail).
    var drillLink = r.kind === 'kam'
      ? '<button type="button" class="ds-btn ds-btn-ghost nrr-comm-drill-btn" data-email="' + nrrEsc(r.email) + '" data-name="' + nrrEsc(r.name) + '" data-period="' + nrrEsc(period) + '">ดูรายละเอียดร้านค้า →</button>'
      : '';
    return '<details class="nrr-comm-row-group">' +
      '<summary class="ds-row hover">' +
      '<span class="ds-chev">›</span>' +
      '<span style="display:flex;flex-direction:column;min-width:0;flex:1;gap:2px">' +
      '<span class="ds-row-name" style="flex:none">' + nrrEsc(r.name) + '</span>' +
      '<span class="ds-row-meta" style="flex:none">' + (nrrPct != null ? nrrPct + '% NRR' : '— NRR') + ' · ' + nrrEsc(metaLabel) + ' ' + stampHtml + '</span>' +
      nrrCommTierMiniHtml(r.kind, r.email, period, nrrPct) +
      '</span>' +
      '<span class="ds-row-value" style="color:' + (isEstRow ? 'var(--sun-deep)' : 'var(--green-deep)') + '">' + nrrFmtGMVExact(payoutAmt) + '</span>' +
      '</summary>' +
      '<div class="ds-row-detail">' + detailHtml + drillLink + '</div>' +
      '</details>';
  }).join('');

  return '<div class="nrr-comm-drawer-section"><div class="ds-section-hd"><span class="ds-eyebrow">' +
    (isAdmin ? 'รายทีม' : 'รายบุคคล (KAM)') + '</span></div>' + rowsHtml + '</div>';
}

// Per-KAM rows nested inside an admin team row — same snapshot-first,
// estimate-fallback logic as the top-level rows, one line per KAM with a
// drill-through button into the full outlet-level drawer.
function nrrCommissionTeamKamsHtml(tlEmail, period) {
  var kams = nrrListKamsForTeam(tlEmail);
  if (!kams.length) return '';
  var rows = kams.map(function (k) {
    var snap = nrrLatestSnapshotFor(k.email);
    var amt, stamp, pct;
    if (snap) {
      amt = Number(snap.payout_amount || 0);
      stamp = nrrCommStampHtml(snap.snapshot_status, true);
      pct = snap.governed_nrr_pct != null ? snap.governed_nrr_pct : snap.raw_nrr_pct;
    } else {
      var est = nrrCommEstimateFor(k.email, 'kam', period);
      amt = est ? est.est : 0;
      stamp = nrrCommStampHtml('estimate', true);
      pct = est ? est.pct : null;
    }
    return '<div class="nrr-comm-kam-row">' +
      '<span style="display:flex;flex-direction:column;gap:3px;min-width:0">' +
      '<span class="ds-stat-label">' + nrrEsc(k.name) + (pct != null ? ' · ' + pct + '%' : '') + ' ' + stamp + '</span>' +
      nrrCommTierMiniHtml('kam', k.email, period, pct) +
      '</span>' +
      '<span class="nrr-comm-kam-row-right">' +
      '<span class="num">' + nrrFmtGMVExact(amt) + '</span>' +
      '<button type="button" class="ds-btn ds-btn-ghost nrr-comm-drill-btn" data-email="' + nrrEsc(k.email) + '" data-name="' + nrrEsc(k.name) + '" data-period="' + nrrEsc(period) + '">ดูรายละเอียด →</button>' +
      '</span></div>';
  }).join('');
  return '<div class="ds-section-hd" style="margin-top:14px"><span class="ds-eyebrow">KAM ในทีม</span></div>' + rows;
}

// Parses commission_payout_snapshots.breakdown (jsonb) into label/value
// lines — field names match _commBuildSnapshotRows() in
// src/07a_commission_engine.js exactly (tl_full / kam_full shapes).
function nrrCommissionBreakdownDetailHtml(bd) {
  var lines = [];
  function line(label, val) {
    if (val == null) return;
    lines.push('<div class="ds-stat-row"><span class="ds-stat-label">' + nrrEsc(label) + '</span><span class="ds-stat-value">' + val + '</span></div>');
  }
  if (bd.type === 'tl_full') {
    line('NRR payout', bd.nrr_payout != null ? nrrFmtGMVExact(bd.nrr_payout) : null);
    line('Upsell multiplier', bd.upsell_mult != null && !isNaN(parseFloat(bd.upsell_mult)) ? parseFloat(bd.upsell_mult).toFixed(2) + '×' : null);
    line('Excluded base GMV', bd.excluded_base_gmv ? nrrFmtGMVExact(bd.excluded_base_gmv) : null);
    line('Final payout', bd.final_payout != null ? nrrFmtGMVExact(bd.final_payout) : null);
  } else if (bd.type === 'kam_full') {
    line('NRR payout', bd.nrr_payout != null ? nrrFmtGMVExact(bd.nrr_payout) : null);
    line('Upsell P1+P3', bd.upsell_sku && bd.upsell_sku.total_commission != null ? nrrFmtGMVExact(bd.upsell_sku.total_commission) : null);
    line('Outlet commission', bd.upsell_outlet && bd.upsell_outlet.commission != null ? nrrFmtGMVExact(bd.upsell_outlet.commission) : null);
    line('Handover', bd.handover && bd.handover.payout != null ? nrrFmtGMVExact(bd.handover.payout) : null);
    line('Components subtotal', bd.components_subtotal != null ? nrrFmtGMVExact(bd.components_subtotal) : null);
    line('GMV Gate', bd.gmv_gate && bd.gmv_gate.cap_multiplier != null ? Number(bd.gmv_gate.cap_multiplier).toFixed(2) + '×' : null);
    line('Excluded base GMV', bd.excluded_base_gmv ? nrrFmtGMVExact(bd.excluded_base_gmv) : null);
    line('Final payout', bd.final_payout != null ? nrrFmtGMVExact(bd.final_payout) : null);
  }
  return lines.length ? lines.join('') : '<div class="ds-stat-row"><span class="ds-stat-label">ไม่มีรายละเอียดใน breakdown นี้</span></div>';
}

// Live target_settings footnote — decision: show current Cockpit config,
// not the frozen config_snapshot inside any one snapshot's breakdown.
function nrrCommissionFootnoteHtml() {
  if (!nrrCommRatesCache || !nrrCommRatesCache.loaded) return '';
  var p1Rate = nrrCommRateGet('upsell_sku', 'p1_rate', 0.01);
  var p3Rate = nrrCommRateGet('upsell_sku', 'p3_rate', 0.01);
  var p3Thresh = nrrCommRateGet('upsell_sku', 'p3_threshold_pct', 2.00);
  var p3MinIncr = nrrCommRateGet('upsell_sku', 'p3_min_incremental', 8000);
  var p1MinGmv = nrrCommRateGet('upsell_sku', 'p1_min_gmv', 5000);
  var outRate = nrrCommRateGet('upsell_outlet', 'rate', 0.005);
  var gate1 = nrrCommRateGet('gmv_gate', 'threshold_1', 98);
  var gate2 = nrrCommRateGet('gmv_gate', 'threshold_2', 95);
  var cap1 = nrrCommRateGet('gmv_gate', 'cap_1', 0.3);
  var cap2 = nrrCommRateGet('gmv_gate', 'cap_2', 0);
  return '<div class="micro" style="line-height:1.6;margin-top:4px">' +
    'อัตรา/เกณฑ์ปัจจุบันจาก target_settings (ค่าล่าสุด ไม่ใช่ config_snapshot ที่ freeze ไว้ตอน compute แต่ละรายการ): ' +
    'P1 ' + (p1Rate * 100).toFixed(1) + '% (ขั้นต่ำ ' + nrrFmtGMVExact(p1MinGmv) + ') · ' +
    'P3 ' + (p3Rate * 100).toFixed(1) + '% (>' + p3Thresh + '× baseline, ขั้นต่ำ ' + nrrFmtGMVExact(p3MinIncr) + ') · ' +
    'Outlet ' + (outRate * 100).toFixed(2) + '% · ' +
    'Gate: ≥' + gate1 + '%=1.0× · ' + gate2 + '-' + gate1 + '%=' + cap1 + '× · <' + gate2 + '%=' + cap2 + '×' +
    '</div>';
}

// ── Commission "ตารางเต็ม" — wide spreadsheet-style audit table ──────────
// Any historical period (not just the current quarter), one row per
// TL/KAM with every formula component as its own column. Sourced entirely
// from commission_payout_snapshots.breakdown — no new CSV fetch, no
// recompute. This is a DIFFERENT job than the hero+rows "สรุป" tab above:
// that one is for a quick glance, this one is for auditing every number
// at once (matches the reference spreadsheet the user already works from).
function nrrCommGateClass(mult) {
  var m = Number(mult);
  if (!(m > 0)) return 'nrr-comm-gate-0';
  if (m < 1) return 'nrr-comm-gate-mid';
  return 'nrr-comm-gate-full';
}

function nrrRenderCommissionFullTable(periodMonth) {
  var el = document.getElementById('nrr-comm-fulltable-body');
  if (!el) return;
  el.innerHTML = '<div class="ds-skel" style="height:160px"></div>';
  nrrFetchSnapshotsForPeriod(periodMonth).then(function (res) {
    var target = document.getElementById('nrr-comm-fulltable-body');
    if (!target || nrrCommSelectedPeriod !== periodMonth) return; // stale-guard (dropdown may have changed)
    if (!res.loaded) {
      target.innerHTML = '<div class="ds-empty"><div class="ds-empty-title">โหลดไม่สำเร็จ</div></div>';
      return;
    }
    target.innerHTML = nrrCommissionFullTableHtml(res.rows);
  });
}
window.nrrRenderCommissionFullTable = nrrRenderCommissionFullTable;

function nrrCommissionFullTableHtml(rows) {
  if (!rows.length) {
    return '<div class="ds-empty"><div class="ds-empty-title">ไม่มีข้อมูลสำหรับเดือนนี้</div><div class="ds-empty-desc">ยังไม่มี snapshot ถูก compute ไว้</div></div>';
  }
  var tlRows = rows.filter(function (r) { return r.beneficiary_role === 'tl'; });
  var kamRows = rows.filter(function (r) { return r.beneficiary_role === 'kam'; });

  // Exception-based stamping: everyone final → ONE stamp up top and no
  // per-row noise; otherwise per-row stamps appear only on non-final rows
  // (drafts should stand out — 15 identical FINAL chips would say nothing).
  var allFinal = rows.every(function (r) { return r.snapshot_status === 'final'; });
  var headStamp = allFinal
    ? '<div class="nrr-comm-fullhead">' + nrrCommStampHtml('final') +
      '<span class="micro">ล็อกครบทุกรายการ (' + rows.length + ')</span></div>'
    : '<div class="nrr-comm-fullhead">' + nrrCommStampHtml('draft') +
      '<span class="micro">บางรายการยังไม่ล็อก — แถวที่ไม่ใช่ final มีตรากำกับ</span></div>';

  // tl_full breakdown only stores the upsell MULTIPLIER, not the raw GMV
  // behind it — sum it client-side from the KAM rows under each TL instead
  // of adding a new fetch.
  var teamUpsellGmv = {};
  kamRows.forEach(function (r) {
    var sku = (r.breakdown || {}).upsell_sku || {};
    var gmv = (sku.p1 && sku.p1.gmv || 0) + (sku.p3 && sku.p3.gmv_incremental || 0);
    if (!r.team_lead_email) return;
    teamUpsellGmv[r.team_lead_email] = (teamUpsellGmv[r.team_lead_email] || 0) + gmv;
  });

  return headStamp + nrrCommFullTlTableHtml(tlRows, teamUpsellGmv, allFinal) + nrrCommFullKamTableHtml(kamRows, allFinal);
}

function nrrCommFullTlTableHtml(tlRows, teamUpsellGmv, allFinal) {
  if (!tlRows.length) return '';
  var t = { nrrPayout: 0, upsellGmv: 0, finalPayout: 0 };
  var rowsHtml = tlRows.map(function (r) {
    var bd = r.breakdown || {};
    // Prefer the breakdown's own team_upsell_gmv when present (some periods
    // were manually backfilled from Excel and carry this field directly) —
    // falls back to summing the KAM rows under this TL otherwise. Verified
    // against real data that both agree exactly when both are available.
    var upsellGmv = bd.team_upsell_gmv != null ? Number(bd.team_upsell_gmv) : (teamUpsellGmv[r.beneficiary_email] || 0);
    var finalPayout = Number(r.payout_amount || 0);
    t.nrrPayout += Number(bd.nrr_payout || 0);
    t.upsellGmv += upsellGmv;
    t.finalPayout += finalPayout;
    // upsell_mult varies by data source: numeric (live engine) or a string
    // like "1x"/"2x" (Excel backfill) — parseFloat handles both.
    var mult = parseFloat(bd.upsell_mult);
    // Audit check: the multiplier the money actually reflects is
    // final ÷ nrr_payout. Real June data stores "2x" where the paid math is
    // 12,000 × 1.5 = 18,000 — the Excel's column was a tier label, not the
    // multiplier. Show the stored value but flag it when it doesn't
    // reconcile, so the discrepancy is visible instead of silently wrong.
    var multHtml = !isNaN(mult) ? mult.toFixed(2) + '×' : '—';
    var nrrPay = Number(bd.nrr_payout || 0);
    if (!isNaN(mult) && nrrPay > 0 && Math.abs(nrrPay * mult - finalPayout) > 1) {
      var effective = finalPayout / nrrPay;
      multHtml += ' <span class="nrr-comm-note-dot" title="ค่าที่จ่ายจริงสะท้อนตัวคูณ ' + effective.toFixed(2) + '× (' + nrrFmtGMVExact(nrrPay) + ' × ' + effective.toFixed(2) + ' = ' + nrrFmtGMVExact(finalPayout) + ') — ตัวเลข ' + mult.toFixed(0) + ' ที่บันทึกไว้น่าจะเป็นเลข tier จากไฟล์ Excel ที่ backfill ไม่ใช่ตัวคูณ">ⓘ</span>';
    }
    var rowStamp = (!allFinal && r.snapshot_status !== 'final')
      ? ' ' + nrrCommStampHtml(r.snapshot_status, true) : '';
    return '<tr><td>' + nrrEsc(bd.team_lead_name || r.beneficiary_email) + rowStamp + '</td>' +
      '<td>' + (bd.nrr_pct != null ? bd.nrr_pct + '%' : '—') + '</td>' +
      '<td>' + nrrFmtGMVExact(bd.nrr_payout || 0) + '</td>' +
      '<td>' + nrrFmtGMVExact(upsellGmv) + '</td>' +
      '<td>' + multHtml + '</td>' +
      '<td class="nrr-comm-final">' + nrrFmtGMVExact(finalPayout) + '</td></tr>';
  }).join('');
  var totalHtml = '<tr class="nrr-comm-total-row"><td>GRAND TOTAL</td><td></td>' +
    '<td>' + nrrFmtGMVExact(t.nrrPayout) + '</td><td>' + nrrFmtGMVExact(t.upsellGmv) + '</td><td></td>' +
    '<td>' + nrrFmtGMVExact(t.finalPayout) + '</td></tr>';
  return '<div class="ds-section-hd"><span class="ds-eyebrow">รายทีม (Team Lead)</span></div>' +
    '<div class="nrr-comm-fulltable-wrap"><table class="nrr-comm-fulltable"><thead><tr>' +
    '<th>Team Lead</th><th>NRR %</th><th>NRR Payout</th><th>Upsell GMV (P1+P3)</th><th>Upsell ×</th><th>Final Payout</th>' +
    '</tr></thead><tbody>' + rowsHtml + totalHtml + '</tbody></table></div>';
}

// One cell per money component: bold ฿comm on top, its source GMV/% muted
// underneath. Halves the column count (16 → 10) so the whole audit table
// fits the 1020px page without horizontal scroll — the audit job is
// "compare people against Final", which dies the moment WHO and FINAL
// scroll apart. Zero amounts render muted so real money pops.
function _nrrCommMoneyCell(comm, metaText) {
  var c = Number(comm || 0);
  var commHtml = c === 0
    ? '<span class="nrr-comm-zero">฿0</span>'
    : '<b>' + nrrFmtGMVExact(c) + '</b>';
  var metaHtml = metaText ? '<div class="nrr-comm-cell-meta">' + metaText + '</div>' : '';
  return '<td>' + commHtml + metaHtml + '</td>';
}

function nrrCommFullKamTableHtml(kamRows, allFinal) {
  if (!kamRows.length) return '';
  var t = { nrrPayout: 0, hoPayout: 0, expPayout: 0, p1Comm: 0, p3Comm: 0, upsell: 0, finalPayout: 0 };
  var rowsHtml = kamRows.map(function (r) {
    var bd = r.breakdown || {};
    var sku = bd.upsell_sku || {};
    var p1 = sku.p1 || {}, p3 = sku.p3 || {};
    var ho = bd.handover || {};
    var outlet = bd.upsell_outlet || {};
    var gate = bd.gmv_gate || {};
    var finalPayout = Number(r.payout_amount || 0);
    t.nrrPayout += Number(bd.nrr_payout || 0);
    t.hoPayout += Number(ho.payout || 0);
    t.expPayout += Number(outlet.commission || 0);
    t.p1Comm += Number(p1.comm || 0);
    t.p3Comm += Number(p3.comm || 0);
    t.upsell += Number(sku.total_commission || 0);
    t.finalPayout += finalPayout;
    var gateCls = nrrCommGateClass(gate.cap_multiplier);
    var note = bd.adjustment_note || bd.lock_note || '';
    var noteHtml = note
      ? ' <span class="nrr-comm-note-dot" title="' + nrrEsc(note) + '">ⓘ</span>'
      : '';
    var rowStamp = (!allFinal && r.snapshot_status !== 'final')
      ? ' ' + nrrCommStampHtml(r.snapshot_status, true) : '';
    return '<tr>' +
      '<td><b>' + nrrEsc(bd.kam_name || r.beneficiary_email) + '</b>' + noteHtml + rowStamp +
      '<div class="nrr-comm-cell-meta">' + nrrEsc((r.beneficiary_email || '').split('@')[0]) + '</div></td>' +
      '<td>' + (bd.nrr_pct != null ? bd.nrr_pct + '%' : '—') + '</td>' +
      _nrrCommMoneyCell(bd.nrr_payout, null) +
      _nrrCommMoneyCell(ho.payout, ho.retention_pct ? 'retention ' + ho.retention_pct + '%' : null) +
      _nrrCommMoneyCell(outlet.commission, outlet.outlet_gmv ? 'จาก ' + nrrFmtGMVExact(outlet.outlet_gmv) : null) +
      _nrrCommMoneyCell(p1.comm, p1.gmv ? 'จาก ' + nrrFmtGMVExact(p1.gmv) : null) +
      _nrrCommMoneyCell(p3.comm, p3.gmv_incremental ? 'จาก ' + nrrFmtGMVExact(p3.gmv_incremental) : null) +
      _nrrCommMoneyCell(sku.total_commission, null) +
      '<td><span class="' + gateCls + '">' + (gate.cap_multiplier != null ? Number(gate.cap_multiplier).toFixed(2) + '×' : '—') + '</span></td>' +
      '<td class="nrr-comm-final">' + nrrFmtGMVExact(finalPayout) + '</td></tr>';
  }).join('');
  var totalHtml = '<tr class="nrr-comm-total-row"><td>GRAND TOTAL</td><td></td>' +
    '<td>' + nrrFmtGMVExact(t.nrrPayout) + '</td>' +
    '<td>' + nrrFmtGMVExact(t.hoPayout) + '</td>' +
    '<td>' + nrrFmtGMVExact(t.expPayout) + '</td>' +
    '<td>' + nrrFmtGMVExact(t.p1Comm) + '</td>' +
    '<td>' + nrrFmtGMVExact(t.p3Comm) + '</td>' +
    '<td>' + nrrFmtGMVExact(t.upsell) + '</td><td></td>' +
    '<td class="nrr-comm-final">' + nrrFmtGMVExact(t.finalPayout) + '</td></tr>';
  return '<div class="ds-section-hd" style="margin-top:24px"><span class="ds-eyebrow">รายบุคคล (KAM)</span></div>' +
    '<div class="nrr-comm-fulltable-wrap"><table class="nrr-comm-fulltable"><thead><tr>' +
    '<th>KAM</th><th>NRR %</th><th>NRR</th><th>Handover</th><th>Expansion</th>' +
    '<th>P1 ใหม่</th><th>P3 โต</th><th>Upsell รวม</th><th>Gate ×</th><th>Final</th>' +
    '</tr></thead><tbody>' + rowsHtml + totalHtml + '</tbody></table></div>';
}

// ── Commission V2 — outlet-level drill-down drawer ───────────────────────
// Reuses the physical #nrr-slideover panel/backdrop (same close mechanics
// as the kam/team/movement modes) but does NOT go through
// _nrrOpenSlideover()/nrrRenderSlideoverBody() — those are outlet-array
// shaped for movement drill-downs; commission detail is structured jsonb
// + a lazily-fetched, differently-shaped upsell bundle, so it gets its own
// self-contained render path instead of forcing a shape mismatch.
var nrrCommDrawerState = null; // { kamEmail, period } — stale-guard for the async upsell fetch

function nrrOpenCommissionDrawer(kamEmail, kamName, period) {
  nrrCommDrawerState = { kamEmail: kamEmail, period: period };
  document.getElementById('nrr-slideover-title').textContent = kamName || kamEmail;
  document.getElementById('nrr-slideover-sub').textContent = (QNRR_CFG.months_th[period] || period) + ' · รายละเอียดคอมมิชชั่น';
  document.getElementById('nrr-slideover-search').parentElement.style.display = 'none';
  document.getElementById('nrr-slideover-chips').parentElement.style.display = 'none';
  document.getElementById('nrr-slideover-body').innerHTML = '<div class="nrr-comm-ds" id="nrr-comm-drawer-body"></div>';
  nrrRenderCommissionDrawerBody(kamEmail, period);
  document.getElementById('nrr-slideover-backdrop').classList.add('on');
  document.getElementById('nrr-slideover').classList.add('on');
}
window.nrrOpenCommissionDrawer = nrrOpenCommissionDrawer;

function nrrRenderCommissionDrawerBody(kamEmail, period) {
  var el = document.getElementById('nrr-comm-drawer-body');
  if (!el) return;

  var snap = nrrLatestSnapshotFor(kamEmail);
  var bd = snap && snap.breakdown ? snap.breakdown : null;
  var result = nrrKamResult(kamEmail);
  var bm = result && period && result.by_month ? result.by_month[period] : null;
  var livePct = bm ? bm.nrr_pct : null;
  var est = snap ? null : nrrEstimateKamCommission(kamEmail, period, livePct);
  var pct = bd ? bd.nrr_pct : (est ? est.pct : livePct);

  var heroAmt = snap ? Number(snap.payout_amount || 0) : (est ? est.est : 0);
  var heroSub = bd
    ? 'ล็อกแล้ว — ดูใบเสร็จด้านล่างว่ามาจากอะไรบ้าง'
    : (est ? 'ยังไม่ล็อก · ตัวเลขนี้เป็นค่าประมาณจาก rate ปัจจุบัน' : 'ยังไม่มีข้อมูล %NRR สำหรับงวดนี้');
  var heroHtml = '<div class="ds-hero"><div class="ds-hero-eyebrow">Final payout ' +
    (snap ? nrrCommStampHtml(snap.snapshot_status) : nrrCommStampHtml('estimate')) + '</div>' +
    '<div class="ds-hero-number">' + nrrFmtGMVExact(heroAmt) + '</div>' +
    '<div class="ds-hero-sub">' + heroSub + '</div></div>';

  // Tier chip + progress + next-step — same achievement-status language as
  // the summary rows, so opening the drawer doesn't feel like a different
  // app from the row you clicked.
  var tierTable = pct != null ? nrrCommTierTable('kam', kamEmail, period, pct) : null;
  var tierHtml = tierTable ? '<div class="nrr-comm-tier-block">' +
    '<div class="nrr-comm-tier-row">' + nrrCommTierChipHtml(tierTable) +
    '<span class="micro">NRR ' + pct + '%</span></div>' +
    nrrCommProgressHtml(tierTable, pct) +
    '<div class="nrr-comm-next-step">' + nrrEsc(nrrCommNextStepHtml(tierTable, pct)) + '</div>' +
    '</div>' : '';

  // The receipt — one line per formula term, each optionally expandable
  // into its account-level list. Locked and unlocked periods use the same
  // renderer against two different (but shape-identical) step sources.
  var steps = bd ? nrrCommSnapshotReceiptSteps(bd) : nrrCommEstimateReceiptSteps(est);
  var outletsForKam = nrrOutletsForKam(kamEmail, period);
  var nrrOutlets = outletsForKam.filter(function (o) { return ['core_nrr', 'comeback', 'transfer_in'].indexOf(o.movement) > -1; });
  var expOutlets = outletsForKam.filter(function (o) { return o.movement === 'expansion'; });
  var handoverDetail = (bd && bd.handover && bd.handover.detail) || (est && est.handover && est.handover.detail) || [];
  var sectionsByKey = {
    nrr: nrrCommOutletListHtml(nrrOutlets, 'ยังไม่มีร้านในหมวดนี้เดือนนี้'),
    upsell: '<div id="nrr-comm-drawer-upsell-body"><div class="ds-skel" style="margin-bottom:8px"></div><div class="ds-skel" style="width:65%"></div></div>',
    handover: nrrCommHandoverListHtml(handoverDetail)
  };
  // Expansion isn't a receipt line of its own (it's part of the "Upsell"
  // sum) but still deserves its own drill list — append it after the
  // upsell line's account content once that async fetch resolves too, so
  // for now nest it directly under the upsell key's skeleton via a second
  // block rendered alongside.
  var receiptHtml = nrrCommReceiptHtml(steps, sectionsByKey);
  var expansionHtml = '<div class="nrr-comm-drawer-section"><div class="ds-section-hd"><span class="ds-eyebrow">Expansion · 0.5%</span><span class="ds-section-count">' + expOutlets.length + '</span></div>' +
    nrrCommOutletListHtml(expOutlets, 'ไม่มีร้านขยายใหม่เดือนนี้', 0.005) + '</div>';

  el.innerHTML = heroHtml + tierHtml + receiptHtml + expansionHtml;

  var expansionOutletIds = new Set(expOutlets.map(function (o) { return String(o.row.outlet_id); }));
  nrrLoadCommissionUpsellSection(kamEmail, expansionOutletIds, bd);
}

function nrrLoadCommissionUpsellSection(kamEmail, expansionOutletIds, bd) {
  nrrFetchUpsellBundle(kamEmail).then(function (bundle) {
    // Stale-guard: user may have closed/reopened the drawer for a different KAM
    // (or a different period) while this fetch was in flight.
    if (!nrrCommDrawerState || nrrCommDrawerState.kamEmail !== kamEmail) return;
    var target = document.getElementById('nrr-comm-drawer-upsell-body');
    if (!target) return;
    if (!bundle.loaded) {
      target.innerHTML = '<div class="ds-empty"><div class="ds-empty-title">โหลดไม่สำเร็จ</div>' +
        '<div class="ds-empty-desc">ไม่สามารถโหลดข้อมูล upsell ได้ในขณะนี้</div>' +
        '<button type="button" class="ds-btn ds-btn-ghost nrr-comm-retry-upsell-btn" data-email="' + nrrEsc(kamEmail) + '">ลองใหม่</button></div>';
      return;
    }
    var upsell = nrrComputeUpsellSku(expansionOutletIds, bundle, QNRR_CFG.base_month);
    target.innerHTML = nrrCommUpsellListHtml(upsell, bd);
  });
}

// Account list body for one receipt line — no section wrapper (the
// receipt's own <summary> carries the label+amount now; this is just the
// expandable content). Takes {row, movement}[] — the SAME effective-
// classification shape nrrOutletsForKam() already produces elsewhere in
// the app (movement is post-nrrClassifyRow, so a core_nrr row with
// curr_gmv=0 correctly arrives labeled 'core_nrr_churn', never bare
// 'core_nrr' — the fix for the ฿0-outlets-in-the-NRR-list bug, 2026-07-09).
// Two distinct row shapes by design intent:
//   commissionRate given (Expansion)  -> this outlet EARNED money: show
//     GMV and a real per-account commission = gmv × rate.
//   commissionRate omitted (NRR)      -> this outlet is CONTEXT for why
//     %NRR is what it is (a flat-tier payout, not a per-outlet sum) —
//     show GMV + a movement-type dot, never a fake per-row "commission"
//     that would wrongly imply each outlet was paid individually.
function nrrCommOutletListHtml(outlets, emptyText, commissionRate) {
  if (!outlets.length) return '<div class="ds-empty" style="padding:8px 0"><div class="ds-empty-title">' + nrrEsc(emptyText) + '</div></div>';
  return outlets
    .slice()
    .sort(function (a, b) { return (b.row.curr_gmv || 0) - (a.row.curr_gmv || 0); })
    .map(function (o) {
      var r = o.row;
      var gmv = parseFloat(r.curr_gmv) || 0;
      var segCls = r.account_type === 'Chain' ? 'ds-seg-ch' : r.account_type === 'SA' ? 'ds-seg-sa' : r.account_type === 'MC' ? 'ds-seg-mc' : '';
      var segChip = segCls ? '<span class="' + segCls + '">' + nrrEsc(r.account_type) + '</span>' : '';
      var leading = commissionRate == null ? nrrMvDotHtml(o.movement) : '';
      var valueHtml = commissionRate != null
        ? '<span class="ds-row-value">' + nrrFmtGMVExact(gmv * commissionRate) + '</span>'
        : '<span class="ds-row-meta">' + nrrFmtGMVExact(gmv) + '</span>';
      return '<div class="ds-row">' + leading + '<span class="ds-row-name">' + nrrEsc(r.account_name || r.outlet_id) + '</span>' + segChip + valueHtml + '</div>';
    }).join('');
}

function nrrCommHandoverListHtml(detail) {
  if (!detail || !detail.length) return '<div class="ds-empty" style="padding:8px 0"><div class="ds-empty-title">ไม่มีร้าน handover เดือนนี้</div></div>';
  return detail.map(function (d) {
    var pct = d.baseline > 0 ? Math.round(d.current / d.baseline * 100) : 0;
    return '<div class="ds-row"><span class="ds-row-name">' + nrrEsc(d.name || d.account_id) + '</span>' +
      '<span class="ds-row-meta">' + nrrFmtGMVExact(d.baseline || 0) + ' → ' + nrrFmtGMVExact(d.current || 0) + ' (' + pct + '%) · ' + nrrEsc(d.transfer_month || '') + '</span></div>';
  }).join('');
}

function nrrCommUpsellListHtml(upsell, bd) {
  var p1 = upsell.p1.groups, p3 = upsell.p3.groups;
  var p1Html = p1.length
    ? p1.map(function (g) {
        return '<div class="ds-row"><span class="ds-row-name">' + nrrEsc(g.groupKey) + '</span>' +
          '<span class="ds-row-meta">' + nrrFmtGMVExact(g.total_gmv) + '</span>' +
          '<span class="ds-row-value">' + nrrFmtGMVExact(g.commission) + '</span></div>';
      }).join('')
    : '<div class="ds-empty"><div class="ds-empty-title">ไม่มีสินค้าใหม่ (P1) เดือนนี้</div></div>';
  var p3Html = p3.length
    ? p3.map(function (g) {
        return '<div class="ds-row"><span class="ds-row-name">' + nrrEsc(g.groupKey) + '</span>' +
          '<span class="ds-row-meta">' + nrrFmtGMVExact(g.max_baseline) + ' → ' + nrrFmtGMVExact(g.existing_curr) + '</span>' +
          '<span class="ds-row-value">' + nrrFmtGMVExact(g.commission) + '</span></div>';
      }).join('')
    : '<div class="ds-empty"><div class="ds-empty-title">ไม่มีสินค้าที่เติบโต (P3) เดือนนี้</div></div>';

  // Reconciliation note — this fetch always reflects LIVE rates; a locked
  // snapshot's upsell_sku total was computed with whatever rates were live
  // at compute time, so the two can drift apart if the Cockpit has changed
  // rates since. Flag it only when it's actually detectable.
  var reconHtml = '';
  var snapTotal = bd && bd.upsell_sku && bd.upsell_sku.total_commission != null ? Number(bd.upsell_sku.total_commission) : null;
  if (snapTotal != null && Math.abs(upsell.total_comm - snapTotal) > 1) {
    reconHtml = '<div class="nrr-comm-recon-note">ผลรวมด้านล่างคำนวณจากอัตราปัจจุบันใน target_settings — อาจไม่ตรงกับยอดที่ล็อกไว้ (' + nrrFmtGMVExact(snapTotal) + ') เป๊ะ ถ้า Cockpit เปลี่ยนอัตราไปหลังจากงวดนี้ถูกคำนวณ</div>';
  }

  return '<div class="micro" style="margin-bottom:4px">P1 · สินค้าใหม่ในร้าน</div>' + p1Html +
    '<div class="micro" style="margin:12px 0 4px">P3 · สินค้าเดิมโตขึ้น</div>' + p3Html +
    reconHtml;
}

// ── Scrollspy sub-nav ────────────────────────────────────────────────────
var _nrrSpy = null;
function nrrInitScrollspy() {
  if (_nrrSpy) _nrrSpy.disconnect();
  var links = document.querySelectorAll('#nrr-subnav a');
  var map = { 'nrr-sec-pulse': 'nrr-sec-pulse', 'nrr-sec-teams': 'nrr-sec-pulse', 'nrr-sec-movement': 'nrr-sec-movement', 'nrr-sec-kams': 'nrr-sec-movement', 'nrr-sec-pm': 'nrr-sec-pm', 'nrr-sec-admin': 'nrr-sec-admin', 'nrr-sec-commission': 'nrr-sec-admin' };
  _nrrSpy = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var target = map[en.target.id];
      if (!target) return;
      links.forEach(function (a) { a.classList.toggle('on', a.dataset.sec === target); });
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  ['nrr-sec-pulse', 'nrr-sec-teams', 'nrr-sec-movement', 'nrr-sec-kams', 'nrr-sec-pm', 'nrr-sec-admin', 'nrr-sec-commission'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) _nrrSpy.observe(el);
  });
}

// ── Slide-over (3 modes: kam / team / movement) ──────────────────────────
function nrrOpenSlideoverKam(kamEmail, period) {
  var outlets = nrrOutletsForKam(kamEmail, period);
  var name = outlets[0] && outlets[0].row ? outlets[0].row.latest_staff_owner : kamEmail;
  _nrrOpenSlideover({
    mode: 'kam', title: name || kamEmail,
    sub: (QNRR_CFG.months_th[period] || period) + ' · ' + outlets.length + ' ร้าน',
    outlets: outlets, period: period, showKam: false, showKamChips: false, showMvChips: true
  });
  nrrLoadNotesFor(outlets, period);
}

function nrrOpenSlideoverTeam(tlEmail) {
  var period = nrrState.period;
  var outlets = nrrOutletsForTeam(tlEmail, period);
  var teamName = (nrrListTeams().find(function (t) { return t.email === tlEmail; }) || {}).name || tlEmail;
  _nrrOpenSlideover({
    mode: 'team', title: 'ทีม ' + teamName,
    sub: (QNRR_CFG.months_th[period] || period) + ' · ' + outlets.length + ' ร้าน · ทุก KAM',
    outlets: outlets, period: period, showKam: true, showKamChips: true, showMvChips: true
  });
  nrrLoadNotesFor(outlets, period);
}

// v6: outlets arrive pre-resolved from the movement table (same list the
// old inline expansion used to show — including cohort-scoped lists) so
// the slide-over always reconciles with the table by construction. Every
// non-zero cell click routes here directly now (see nrrRenderMovementSection).
function nrrOpenSlideoverMovement(mv, month, outlets, showKam, cohort) {
  var label = nrrMovementCellLabel(mv, cohort, month);
  _nrrOpenSlideover({
    mode: 'movement', title: label + ' · ' + (QNRR_CFG.months_th[month] || month),
    sub: outlets.length + ' ร้าน',
    outlets: outlets, period: month, showKam: !!showKam, showKamChips: false, showMvChips: false,
    negative: mv === 'core_nrr_churn' || mv === 'transfer_out'
  });
  nrrLoadNotesFor(outlets, month);
}

function _nrrOpenSlideover(cfg) {
  nrrCommDrawerState = null; // leaving commission mode (if it was open) — stale-guards its async fetch
  nrrSlideoverOutlets = cfg.outlets;
  nrrSlideoverState = {
    mode: cfg.mode, period: cfg.period, movementFilter: 'all', kamFilter: 'all', search: '',
    showKam: cfg.showKam, negative: cfg.negative || false
  };
  document.getElementById('nrr-slideover-search').parentElement.style.display = '';
  document.getElementById('nrr-slideover-chips').parentElement.style.display = '';
  document.getElementById('nrr-slideover-search').value = '';
  document.getElementById('nrr-slideover-title').textContent = cfg.title;
  document.getElementById('nrr-slideover-sub').textContent = cfg.sub || '';
  nrrRenderSlideoverChips(cfg.showMvChips, cfg.showKamChips);
  nrrRenderSlideoverBody();
  document.getElementById('nrr-slideover-backdrop').classList.add('on');
  document.getElementById('nrr-slideover').classList.add('on');
}

function nrrLoadNotesFor(outlets, period) {
  var outletIds = outlets.map(function (o) { return o.row.outlet_id; });
  nrrFetchNotesForOutlets(outletIds, period).then(function () {
    if (nrrNotesAvailable) nrrRenderSlideoverBody();
  });
}

function nrrRenderSlideoverChips(showMv, showKamChips) {
  var mvEl = document.getElementById('nrr-slideover-chips');
  var kamWrap = document.getElementById('nrr-slideover-kamwrap');

  if (showMv) {
    var counts = {};
    nrrSlideoverOutlets.forEach(function (o) { counts[o.movement] = (counts[o.movement] || 0) + 1; });
    mvEl.style.display = '';
    mvEl.innerHTML = '<button class="nrr-chip on" data-mv="all">ทั้งหมด ' + nrrSlideoverOutlets.length + '</button>' +
      Object.keys(counts).map(function (mv) {
        return '<button class="nrr-chip" data-mv="' + mv + '">' + (MV_LABEL[mv] || mv) + ' ' + counts[mv] + '</button>';
      }).join('');
    mvEl.querySelectorAll('.nrr-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        mvEl.querySelectorAll('.nrr-chip').forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        nrrSlideoverState.movementFilter = btn.dataset.mv;
        nrrRenderSlideoverBody();
      });
    });
  } else { mvEl.style.display = 'none'; mvEl.innerHTML = ''; }

  // v5: KAM filter as a dropdown beside the search box (chips wasted a
  // whole wrapping row for 8+ names).
  if (showKamChips) {
    var kams = {};
    nrrSlideoverOutlets.forEach(function (o) {
      var k = o.row.latest_staff_owner || '—';
      kams[k] = (kams[k] || 0) + 1;
    });
    kamWrap.style.display = '';
    kamWrap.innerHTML = '<select class="nrr-search" id="nrr-slideover-kamselect" style="max-width:200px">' +
      '<option value="all">ทุก KAM (' + nrrSlideoverOutlets.length + ')</option>' +
      Object.keys(kams).sort().map(function (k) {
        return '<option value="' + nrrEsc(k) + '">' + nrrEsc(k) + ' (' + kams[k] + ')</option>';
      }).join('') + '</select>';
    document.getElementById('nrr-slideover-kamselect').addEventListener('change', function (e) {
      nrrSlideoverState.kamFilter = e.target.value;
      nrrRenderSlideoverBody();
    });
  } else { kamWrap.style.display = 'none'; kamWrap.innerHTML = ''; }
}

function nrrRenderSlideoverBody() {
  var body = document.getElementById('nrr-slideover-body');
  var st = nrrSlideoverState;
  var filtered = nrrSlideoverOutlets.filter(function (o) {
    if (st.movementFilter !== 'all' && o.movement !== st.movementFilter) return false;
    if (st.kamFilter && st.kamFilter !== 'all' && (o.row.latest_staff_owner || '—') !== st.kamFilter) return false;
    if (st.search) {
      var hay = ((o.row.account_name || '') + ' ' + (o.row.res_name || '') + ' ' + (o.row.latest_staff_owner || '')).toLowerCase();
      if (hay.indexOf(st.search) === -1) return false;
    }
    return true;
  });

  if (!filtered.length) {
    body.innerHTML = '<div class="micro" style="padding:16px 0">ไม่มีร้านค้าตรงกับตัวกรอง</div>';
    return;
  }

  var groups = nrrGroupOutletsByAccount(filtered);
  body.innerHTML = groups.map(function (g) {
    var rowOpts = { showKam: st.showKam, negative: st.negative };
    if (g.outlets.length === 1) {
      return nrrSlideoverRowHtml(g.outlets[0], rowOpts);
    }
    var branches = g.outlets.map(function (o) {
      var opts = { showKam: st.showKam, negative: st.negative, indent: true };
      return nrrSlideoverRowHtml(o, opts);
    }).join('');
    // Account header shows the same base|MTD|run-rate triple as everything
    // else (v5) — group base = Σ member bases; comeback/expansion members
    // contribute base 0, which legitimately reads as growth.
    var groupTriple = {
      base: Math.round(g.total_base_gmv),
      mtd: Math.round(g.total_curr_gmv),
      run_rate: Math.round(g.total_run_rate),
      curr_days: g.curr_days, days_in_month: 30,
      is_partial: true
    };
    // v8: dot reflects the group's movement type only when every branch
    // agrees — a mixed group gets the neutral "mixed" dot rather than an
    // arbitrary/misleading single color.
    var uniformMv = g.outlets.every(function (o) { return o.movement === g.outlets[0].movement; }) ? g.outlets[0].movement : null;
    return '<details class="nrr-acct-group">' +
      '<summary class="nrr-row"><div class="nrr-row-chev"><span class="nrr-chev-icon">›</span></div>' +
      '<div class="nrr-row-text nrr-row-text-dot">' + nrrMvDotHtml(uniformMv) +
      '<div><span class="nrr-row-name">' + nrrEsc(g.account_name) + '</span>' +
      '<div class="nrr-row-meta">' + g.outlets.length + ' สาขา</div></div></div>' +
      '<div class="nrr-row-nums">' + nrrTripleHtml('sm', groupTriple, { signal: true }) + '</div>' +
      '</summary><div class="nrr-branch-block">' + branches + '</div></details>';
  }).join('');
}

// Slide-over row = unified row + (optionally) the notes block beneath it.
function nrrSlideoverRowHtml(o, opts) {
  var rowHtml = nrrOutletRowHtml(o, opts);
  var notesHtml = nrrOutletNotesHtml(o.row.outlet_id, o.movement);
  if (!notesHtml) return rowHtml;
  return '<div class="nrr-row-with-notes">' + rowHtml + '<div class="nrr-row-notes">' + notesHtml + '</div></div>';
}

function nrrCloseSlideover() {
  nrrCommDrawerState = null; // stale-guards the commission drawer's async upsell fetch, if any was in flight
  document.getElementById('nrr-slideover-backdrop').classList.remove('on');
  document.getElementById('nrr-slideover').classList.remove('on');
}

// ── Outlet notes — quiet, reveal-on-intent (v6) ──────────────────────────
// A note is a human-left breadcrumb for another human, not a form every row
// owes an answer to. Default state: existing notes show as a quoted line
// (or nothing at all if there are none); the input only appears once someone
// clicks "+ โน้ต". Never a permanently-rendered box.
// v7: feature-flagged OFF until the note workflow actually launches — flip
// this to true once the team is ready to use it.
var NRR_NOTES_ENABLED = false;
function nrrOutletNotesHtml(outletId, movementType) {
  if (!NRR_NOTES_ENABLED || !nrrNotesAvailable) return '';
  var notes = nrrNotesCache[outletId] || [];
  var notesListHtml = notes.map(function (n) {
    return '<div class="nrr-note-line">' + nrrEsc(n.note) + ' <span class="nrr-note-author">— ' + nrrEsc(n.author_email) + '</span></div>';
  }).join('');
  return '<div class="nrr-notes">' + notesListHtml +
    '<span class="nrr-note-aff" data-note-open="' + nrrEsc(outletId) + '">+ โน้ต</span>' +
    '<div class="nrr-note-input-row" data-note-row="' + nrrEsc(outletId) + '" hidden>' +
    '<input class="nrr-note-input" data-note-input="' + nrrEsc(outletId) + '" placeholder="พิมพ์โน้ต แล้วกด Enter...">' +
    '<button class="nrr-note-save" data-note-save="' + nrrEsc(outletId) + '" data-note-mv="' + nrrEsc(movementType) + '">บันทึก</button>' +
    '</div></div>';
}

function nrrHandleNoteAffClick(e) {
  var aff = e.target.closest('[data-note-open]');
  if (!aff) return;
  var outletId = aff.dataset.noteOpen;
  var row = document.querySelector('[data-note-row="' + outletId + '"]');
  if (!row) return;
  aff.hidden = true;
  row.hidden = false;
  var input = row.querySelector('[data-note-input]');
  if (input) input.focus();
}

function nrrHandleNoteInputKeydown(e) {
  if (e.key !== 'Enter') return;
  var input = e.target.closest('[data-note-input]');
  if (!input) return;
  var outletId = input.dataset.noteInput;
  var btn = document.querySelector('[data-note-save="' + outletId + '"]');
  if (btn) btn.click();
}

function nrrHandleNoteSaveClick(e) {
  var btn = e.target.closest('[data-note-save]');
  if (!btn) return;
  var outletId = btn.dataset.noteSave;
  var mv = btn.dataset.noteMv;
  var input = document.querySelector('[data-note-input="' + outletId + '"]');
  var text = input ? input.value.trim() : '';
  if (!text) return;
  btn.disabled = true;
  nrrSaveNote(outletId, nrrSlideoverState.period, QNRR_CFG.quarter, mv, text).then(function (res) {
    btn.disabled = false;
    if (!res.ok) return;
    var outletIds = nrrSlideoverOutlets.map(function (o) { return o.row.outlet_id; });
    nrrFetchNotesForOutlets(outletIds, nrrSlideoverState.period).then(function () { nrrRenderSlideoverBody(); });
  });
}
