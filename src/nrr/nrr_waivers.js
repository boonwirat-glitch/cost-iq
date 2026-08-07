// ── nrr_waivers.js — #/waivers: Waived Account request/approve queue ─────
// TL sees their own team's requests (read-only history); Admin sees a
// pending queue across all teams with Approve/Reject. Data comes from
// nrr_exclusions.js's nrrExclusionsCache (already fetched in nrrRefresh()
// before any view renders) -- this file is presentation only.

// rows currently on screen (post role-filter) — read by the export menu.
var nrrLastWaiverRows = null;

// v_waivercard2: filter state ของหน้านี้ — per-page module object ตาม precedent
// nrrPortfolioState (nrr_view.js) ไม่ปนกับ nrrState ที่เป็นของ dashboard ทั้งหน้า
var nrrWaiversState = { monthFilter: '' }; // '' = ทุกเดือน

// GMV คู่ประกอบการตัดสิน waiver: ฐาน (เดือนฐานไตรมาส) + ยอดเดือนที่ขอ
// - ฐานอ่านจากแถว "เดือนแรกของไตรมาส" เท่านั้น (convention เดียวกับ engine —
//   base_gmv บนแถวเดือนหลังๆ เชื่อถือไม่ได้ ดู nrr_logic.js baseMonthRows)
// - ยอดเดือนที่ขอ = curr_gmv ของแถว period_month นั้น · waiver ระดับ outlet
//   จับ outlet เดียว, ระดับ account รวมทุกสาขาของ account
// - คนละแหล่งกับ nrr_exclusions.base_gmv ใน DB (ค่า freeze จาก bulkHistoryData
//   ระดับ account) — จงใจไม่ใช้ตัวนั้น เพื่อให้เลขบนการ์ดกระทบยอดกับหน้า NRR ได้
function _nrrWaiverGmvFor(r) {
  var qd = window.bulkQnrrData;
  if (!qd || !qd.loaded) return null;
  var firstMonth = QNRR_CFG.q_months[0];
  var base = 0, curr = 0, baseSeen = false, currSeen = false, currDays = null, daysInMonth = 30;
  (qd.allRows || []).forEach(function (row) {
    if (row.account_id !== r.account_id) return;
    if (r.outlet_id && String(row.outlet_id) !== String(r.outlet_id)) return;
    if (row.period_month === firstMonth) { base += parseFloat(row.base_gmv) || 0; baseSeen = true; }
    if (row.period_month === r.period_month) {
      curr += parseFloat(row.curr_gmv) || 0; currSeen = true;
      if (currDays == null) { currDays = row.curr_days; daysInMonth = row.days_in_month || 30; }
    }
  });
  if (currDays != null && !daysInMonth) daysInMonth = 30;
  var partial = currSeen && currDays != null && (function () {
    var p = String(r.period_month || '').split('-');
    var dim = p.length === 2 ? new Date(parseInt(p[0], 10), parseInt(p[1], 10), 0).getDate() : 30;
    return currDays < dim - 2 ? dim : null;
  })();
  return {
    base: baseSeen ? Math.round(base) : null,
    curr: currSeen ? Math.round(curr) : null,
    currDays: currDays, partialDim: partial || null
  };
}

function nrrRenderWaiversView(route) {
  var body = document.getElementById('nrr-waivers-body');
  if (!body) return;
  // portview.csv resolves account_id -> account_name (_nrrAccountNameFor
  // below) -- it's normally only fetched when the Account/Portfolio view
  // renders, so landing on #/waivers directly (without visiting either
  // first) previously showed raw UUIDs instead of names.
  // v_outletname (2026-07-15): bulk_outlets.csv resolves outlet_id ->
  // outlet_name (_nrrOutletNameFor below) for the SAME reason -- an
  // outlet-scoped waiver used to show the raw outlet_id, same bug class as
  // the account-name one above, just missed at the time.
  Promise.all([nrrFetchExclusions(), nrrFetchPortviewCsv(), nrrFetchBulkOutletsCsv()]).then(function () {
    body.innerHTML = nrrWaiversPageHtml();
    // v_waiverecompute: เติมป้าย waive-after-lock (async — เช็ค snapshot เอง)
    if (typeof nrrRenderStaleLockPill === 'function') nrrRenderStaleLockPill('nrr-waivers-stale-pill');
  });
}
nrrRouterRegister('waivers', nrrRenderWaiversView);
window.nrrRenderWaiversView = nrrRenderWaiversView;

function _nrrAccountNameFor(accountId) {
  var pv = window.bulkPortviewData;
  if (!pv || !pv.allRows) return accountId;
  var row = pv.allRows.find(function (r) { return r.account_id === accountId; });
  return row ? (row.account_name || accountId) : accountId;
}

function _nrrOutletNameFor(accountId, outletId) {
  var rows = (window.bulkOutletsData && window.bulkOutletsData.byAccountId[accountId]) || [];
  var row = rows.find(function (r) { return r.outlet_id === outletId; });
  return row ? (row.outlet_name || outletId) : outletId;
}

function nrrWaiversPageHtml() {
  var isAdmin = nrrProfile && nrrProfile.role === 'admin';
  var title = isAdmin ? 'คำขอยกเว้น NRR (ทั้งบริษัท)' : 'คำขอยกเว้น NRR ของทีมฉัน';
  // v_waiverecompute: ป้ายเตือน "waive หลังล็อก" — เติมเนื้อหาแบบ async โดย
  // nrrRenderStaleLockPill (เรียกจาก nrrRenderWaiversView + หลัง approve/reject)
  var stalePillHost = '<div class="nrr-stale-host" id="nrr-waivers-stale-pill"></div>';
  // This page is history/review only -- the actual "request" control lives
  // on each account's own page (#/account/:id), since a waiver is inherently
  // tied to one specific account+month. Say so up front (TL especially) so
  // landing here doesn't read as a dead end.
  var howTo = '<div class="micro" style="margin-top:6px;color:var(--ink2)">' +
    (isAdmin
      ? 'อนุมัติ/ปฏิเสธคำขอได้ที่นี่ — TL ส่งคำขอจากหน้าร้านค้านั้นๆ ใน Portfolio'
      : 'หน้านี้แสดงประวัติคำขอเท่านั้น — วิธีขอยกเว้นใหม่: เข้าไปที่หน้าร้านค้านั้นๆ (Portfolio → เลือกร้าน) แล้วกดปุ่ม "ขอยกเว้น NRR เดือนนี้"') +
    '</div>';

  if (nrrExclusionsAvailable === false) {
    return '<div class="h2">' + title + '</div>' +
      '<div class="micro" style="margin-top:8px">ฟีเจอร์นี้ยังไม่พร้อมใช้งาน — ตาราง/สิทธิ์เข้าถึงยังไม่ถูกตั้งค่าใน Supabase</div>';
  }

  var rows = (nrrExclusionsCache || []).slice();
  if (!isAdmin) {
    rows = rows.filter(function (x) { return x.target_tl_email === (nrrProfile && nrrProfile.email); });
  }
  // v_waivercard2: month filter — กรอง "ก่อน" KPI + nrrLastWaiverRows เสมอ
  // เพื่อคงกติกาของไฟล์นี้: จอ = KPI = export ชุดเดียวกันตลอด
  if (nrrWaiversState.monthFilter) {
    rows = rows.filter(function (x) { return x.period_month === nrrWaiversState.monthFilter; });
  }
  rows.sort(function (a, b) { return (a.requested_at || '') < (b.requested_at || '') ? 1 : -1; });

  // cached for the export functions below — mirrors nrrLastKamRows pattern
  // in nrr_view.js (module-level "what's on screen right now" var)
  nrrLastWaiverRows = rows;

  var pending = rows.filter(function (x) { return x.status === 'submitted'; });
  var approved = rows.filter(function (x) { return x.status === 'approved'; });
  var rejected = rows.filter(function (x) { return x.status === 'rejected'; });
  var revoked = rows.filter(function (x) { return x.status === 'revoked'; });

  var exportBtn = rows.length ? (
    '<div style="position:relative;flex-shrink:0">' +
    '<button class="btn-secondary" data-action="waivers-export-toggle" id="nrr-waivers-export-btn">Export</button>' +
    '<div class="float" id="nrr-waivers-export-menu" style="display:none;position:absolute;right:0;top:calc(100% + 6px);min-width:190px;padding:5px;z-index:20">' +
    '<button class="nrr-export-menu-item" data-action="waivers-export-excel">Excel (.xls)</button>' +
    '<button class="nrr-export-menu-item" data-action="waivers-export-sheets">Google Sheets</button>' +
    '<button class="nrr-export-menu-item" data-action="waivers-export-csv">CSV</button>' +
    '<button class="nrr-export-menu-item" data-action="waivers-export-copy">คัดลอกไปวาง (Copy)</button>' +
    '</div></div>'
  ) : '';

  return stalePillHost +
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
    '<div><div class="h2">' + title + '</div>' + howTo + '</div>' +
    exportBtn +
    '</div>' +
    '<div class="nrr-waivers-kpis">' +
    '<div class="nrr-waivers-kpi"><div class="num">' + pending.length + '</div><div class="micro">รออนุมัติ</div></div>' +
    '<div class="nrr-waivers-kpi"><div class="num">' + approved.length + '</div><div class="micro">อนุมัติแล้ว</div></div>' +
    '<div class="nrr-waivers-kpi"><div class="num">' + rejected.length + '</div><div class="micro">ปฏิเสธ</div></div>' +
    '<div class="nrr-waivers-kpi"><div class="num">' + revoked.length + '</div><div class="micro">เพิกถอนแล้ว</div></div>' +
    '</div>' +
    // v_waivercard2: chips เลือกเดือน (ค่าที่มีได้แค่ q_months — select เกินจำเป็น)
    '<div class="nrr-chip-row" style="margin-top:4px">' +
    [{ v: '', l: 'ทั้งหมด' }].concat(QNRR_CFG.q_months.map(function (m) { return { v: m, l: QNRR_CFG.months_th[m] || m }; }))
      .map(function (c) {
        return '<button class="nrr-chip' + (nrrWaiversState.monthFilter === c.v ? ' on' : '') +
          '" data-action="waiver-month-filter" data-month="' + nrrEsc(c.v) + '">' + nrrEsc(c.l) + '</button>';
      }).join('') +
    '</div>' +
    (rows.length
      // v_waivercard2: กลับมาใช้ cards — เวอร์ชันตาราง (v_waiverrow) กว้างเกิน
      // container (~1290px ใน 1020px) จนคอลัมน์ปุ่ม approve ตกขอบขวาแบบไร้
      // สัญญาณ (บุชเจอบน production: "ไม่มีปุ่มให้กดอนุมัติ") · ของที่ตาราง
      // เพิ่มมาเก็บไว้ครบใน card: audit trail + review_note (ฝั่ง export ไม่แตะ)
      ? '<div style="margin-top:12px">' + rows.map(function (r) { return nrrWaiverRowHtml(r, isAdmin); }).join('') + '</div>'
      : '<div class="ds-empty" style="margin-top:12px"><div class="ds-empty-title">ยังไม่มีคำขอยกเว้น NRR' + (nrrWaiversState.monthFilter ? ' ในเดือนที่เลือก' : '') + '</div></div>');
}

// v_waivercard2: card ต่อ 1 คำขอ — กู้โครงจากเวอร์ชันก่อน v_waiverrow แล้วเก็บ
// ของที่ตารางเพิ่มมาไว้ครบ (audit trail + review_note) + ของใหม่ตามที่บุชขอ:
// GMV ฐาน/เดือนที่ขอ · ความสูงคุมด้วย ellipsis บน free-text (title มีข้อความเต็ม)
function nrrWaiverRowHtml(r, isAdmin) {
  var monthLabel = QNRR_CFG.months_th[r.period_month] || r.period_month;
  var acctName = _nrrAccountNameFor(r.account_id);
  var scopeTag = r.outlet_id
    ? '<span class="tag mv-violet">เฉพาะสาขา ' + nrrEsc(_nrrOutletNameFor(r.account_id, r.outlet_id)) + '</span>'
    : '<span class="tag muted">ทั้ง account</span>';
  var locked = nrrIsPeriodLocked(r.period_month);
  // banner เตือนงวดล็อกแบบเต็มความ (เวอร์ชันตารางย่อเหลือ ⚠ ใน title ซึ่งมองไม่เห็น
  // บนจอสัมผัสและถูกดันตกขอบ) — เดี๋ยวนี้คำนวณใหม่ทำจาก /nrr เองได้ด้วย (ป้ายส้ม
  // ด้านบนหน้านี้) เลยชี้ทางทั้งสองที่
  var lockedNote = '<div class="micro" style="color:var(--sun-deep);background:var(--sun-soft);' +
    'border-radius:8px;padding:6px 9px;margin-top:8px;line-height:1.45">' +
    'เดือน ' + nrrEsc(monthLabel) + ' Lock แล้ว — ตัดสินได้ แต่<b>ยอดที่ล็อกไว้จะยังไม่เปลี่ยน</b> ' +
    'จนกว่าจะกด "คำนวณใหม่" (ป้ายเตือนด้านบนหน้านี้ หรือ Sense › Commission Cockpit › Lock)</div>';
  var actions = '';
  if (isAdmin && r.status === 'submitted') {
    actions = (locked ? lockedNote : '') +
      '<div class="nrr-waiver-actions">' +
      '<button class="nrr-exclusion-submit-btn" data-action="waiver-approve" data-id="' + nrrEsc(r.id) + '">Approve</button>' +
      '<button class="nrr-exclusion-cancel-btn" data-action="waiver-reject" data-id="' + nrrEsc(r.id) + '">Reject</button>' +
      '</div>';
  } else if (isAdmin && r.status === 'approved') {
    actions = (locked ? lockedNote : '') +
      '<div class="nrr-waiver-actions">' +
      '<button class="nrr-exclusion-cancel-btn" data-action="waiver-revoke" data-id="' + nrrEsc(r.id) + '">เพิกถอน</button>' +
      '</div>';
  }
  function _who(email) { return email ? nrrEsc(String(email).split('@')[0]) : '—'; }
  function _when(ts) { return ts ? String(ts).slice(0, 10) : ''; }
  // GMV คู่: ฐาน (เดือนฐานไตรมาส) + ยอดเดือนที่ขอ — ให้ admin เห็นน้ำหนักเงิน
  // ของคำขอโดยไม่ต้องเปิดหน้าร้าน · เดือนกำลังวิ่งติดป้าย MTD กันอ่านเป็นเดือนเต็ม
  var gmv = _nrrWaiverGmvFor(r);
  var baseMonthTh = QNRR_CFG.months_th[QNRR_CFG.base_month] || QNRR_CFG.base_month;
  var gmvLine = '<div class="micro nrr-waiver-gmv">' +
    'GMV ฐาน (' + nrrEsc(baseMonthTh) + ') <b class="num">' + (gmv && gmv.base != null ? nrrFmtGMVExact(gmv.base) : '—') + '</b>' +
    ' · เดือนที่ขอ (' + nrrEsc(monthLabel) + ') <b class="num">' + (gmv && gmv.curr != null ? nrrFmtGMVExact(gmv.curr) : '—') + '</b>' +
    (gmv && gmv.curr != null && gmv.partialDim ? ' <span class="tag muted">MTD ' + gmv.currDays + '/' + gmv.partialDim + ' วัน</span>' : '') +
    '</div>';
  var auditLine = '<div class="micro nrr-waiver-audit">ขอโดย ' + _who(r.requested_by) +
    (r.requested_at ? ' · ' + _when(r.requested_at) : '') +
    (r.reviewed_at ? ' — ตัดสินโดย ' + _who(r.reviewed_by) + ' · ' + _when(r.reviewed_at) : ' — ยังไม่ตัดสิน') +
    '</div>';
  return '<div class="nrr-waiver-card ' + r.status + '">' +
    '<div class="nrr-waiver-top">' +
    '<a href="#/account/' + encodeURIComponent(r.account_id) + '" class="nrr-waiver-acct">' + nrrEsc(acctName) + '</a>' +
    '<span style="display:flex;align-items:center;gap:6px;flex-shrink:0">' +
    scopeTag +
    '<span class="nrr-waiver-status ' + r.status + '">' + nrrExclusionStatusLabel(r.status) + '</span>' +
    '</span>' +
    '</div>' +
    '<div class="micro">เดือน ' + nrrEsc(monthLabel) + ' · เหตุผล: ' + nrrEsc(nrrExclusionReasonLabel(r.reason_code)) +
    (r.target_tl_email ? ' · TL ' + nrrEsc(String(r.target_tl_email).split('@')[0]) : '') +
    (r.target_kam_email ? ' · KAM ' + nrrEsc(String(r.target_kam_email).split('@')[0]) : '') + '</div>' +
    gmvLine +
    (r.reason_text ? '<div class="micro nrr-waiver-freetext" title="' + nrrEsc(r.reason_text) + '">' + nrrEsc(r.reason_text) + '</div>' : '') +
    (r.review_note ? '<div class="micro nrr-waiver-freetext" title="หมายเหตุผู้ตัดสิน: ' + nrrEsc(r.review_note) + '">✎ ' + nrrEsc(r.review_note) + '</div>' : '') +
    auditLine +
    actions +
    '</div>';
}

function nrrHandleWaiversClick(e) {
  // v_waiverecompute: ป้าย/พรีวิว/ยืนยันคำนวณใหม่ — logic เดียวกับหน้า Commission
  if (typeof nrrHandleRecomputeClick === 'function' && nrrHandleRecomputeClick(e)) return;
  // v_waivercard2: chips เลือกเดือน — วาดทั้งหน้าใหม่ (KPI + list + export ตามกันหมด)
  var mBtn = e.target.closest('[data-action="waiver-month-filter"]');
  if (mBtn) {
    nrrWaiversState.monthFilter = mBtn.dataset.month || '';
    var mBody = document.getElementById('nrr-waivers-body');
    if (mBody) mBody.innerHTML = nrrWaiversPageHtml();
    if (typeof nrrRenderStaleLockPill === 'function') nrrRenderStaleLockPill('nrr-waivers-stale-pill');
    return;
  }
  var exportBtn = e.target.closest('[data-action^="waivers-export"]');
  if (exportBtn) { nrrHandleWaiverExportClick(exportBtn); return; }

  var btn = e.target.closest('[data-action="waiver-approve"],[data-action="waiver-reject"],[data-action="waiver-revoke"]');
  if (!btn) return;
  var status = btn.dataset.action === 'waiver-approve' ? 'approved'
    : btn.dataset.action === 'waiver-revoke' ? 'revoked' : 'rejected';
  if (status === 'revoked' && !confirm('เพิกถอนคำอนุมัตินี้? ร้านนี้จะกลับมานับ NRR ตามปกติทันที')) return;
  btn.disabled = true;
  nrrReviewExclusion(btn.dataset.id, status).then(function (res) {
    if (!res.ok && typeof nrrToast === 'function') nrrToast('อัปเดตไม่สำเร็จ: ' + (res.error || ''));
    var body = document.getElementById('nrr-waivers-body');
    if (body) body.innerHTML = nrrWaiversPageHtml();
    // v_waiverecompute: การตัดสินเมื่อกี้อาจเพิ่งทำให้งวดที่ล็อกแล้ว stale — เช็คทันที
    if (typeof nrrRenderStaleLockPill === 'function') nrrRenderStaleLockPill('nrr-waivers-stale-pill');
  });
}
window.nrrHandleWaiversClick = nrrHandleWaiversClick;

// ── Export menu — Excel / Google Sheets / CSV / copy-to-clipboard ────────
// All four read the SAME cached rows (nrrLastWaiverRows, set by
// nrrWaiversPageHtml right before render) so what you export always matches
// what's on screen — same admin-vs-TL scoping, same sort order.

function nrrHandleWaiverExportClick(btn) {
  var action = btn.dataset.action;
  if (action === 'waivers-export-toggle') { nrrToggleWaiverExportMenu(); return; }
  nrrCloseWaiverExportMenu();
  if (action === 'waivers-export-excel') nrrExportWaiversExcel();
  else if (action === 'waivers-export-sheets') nrrExportWaiversGoogleSheets();
  else if (action === 'waivers-export-csv') nrrExportWaiversCsv();
  else if (action === 'waivers-export-copy') nrrCopyWaiversClipboard(btn);
}

var _nrrWaiverExportOutsideClickBound = false;
function nrrToggleWaiverExportMenu() {
  var menu = document.getElementById('nrr-waivers-export-menu');
  if (!menu) return;
  var opening = menu.style.display === 'none';
  menu.style.display = opening ? 'block' : 'none';
  if (opening && !_nrrWaiverExportOutsideClickBound) {
    _nrrWaiverExportOutsideClickBound = true;
    // one shared listener, not one per open — re-checks the menu's current
    // state each time rather than assuming it's still the one that opened it
    document.addEventListener('click', function _onDocClick(ev) {
      var m = document.getElementById('nrr-waivers-export-menu');
      if (!m || m.style.display === 'none') return;
      if (ev.target.closest('#nrr-waivers-export-menu') || ev.target.closest('#nrr-waivers-export-btn')) return;
      m.style.display = 'none';
    });
  }
}
function nrrCloseWaiverExportMenu() {
  var menu = document.getElementById('nrr-waivers-export-menu');
  if (menu) menu.style.display = 'none';
}

function nrrWaiverExportRows(rows) {
  // v_waiverrow: audit trail ครบในไฟล์ (ขอโดย/เมื่อไหร่ · ตัดสินโดย/เมื่อไหร่ ·
  // หมายเหตุผู้ตัดสิน) + outlet_id (res_id) สำหรับเอาไป mapping ต่อ — DB มีครบ
  // อยู่แล้ว แค่ไม่เคยถูกพ่นออกมา
  var headers = ['บริษัท', 'account_id', 'ขอบเขต', 'outlet_id', 'เดือน', 'สถานะ', 'เหตุผล', 'หมายเหตุ',
    'TL', 'KAM', 'ขอโดย', 'วันที่ขอ', 'ตัดสินโดย', 'วันที่ตัดสิน', 'หมายเหตุผู้ตัดสิน'];
  var data = rows.map(function (r) {
    var acctName = _nrrAccountNameFor(r.account_id);
    var scope = r.outlet_id ? ('เฉพาะสาขา ' + _nrrOutletNameFor(r.account_id, r.outlet_id)) : 'ทั้ง account';
    var monthLabel = QNRR_CFG.months_th[r.period_month] || r.period_month;
    return [
      acctName, r.account_id || '', scope, r.outlet_id || '', monthLabel, nrrExclusionStatusLabel(r.status),
      nrrExclusionReasonLabel(r.reason_code), r.reason_text || '',
      r.target_tl_email || '', r.target_kam_email || '',
      r.requested_by || '', r.requested_at ? String(r.requested_at).slice(0, 10) : '',
      r.reviewed_by || '', r.reviewed_at ? String(r.reviewed_at).slice(0, 10) : '',
      r.review_note || ''
    ];
  });
  return { headers: headers, data: data };
}

function nrrWaiverExportFilename(ext) {
  var q = (typeof QNRR_CFG !== 'undefined' && QNRR_CFG.quarter) || 'export';
  return 'nrr-waivers-' + q + '.' + ext;
}

function nrrWaiverTsv(built) {
  var esc = function (v) { return String(v == null ? '' : v).replace(/\t/g, ' ').replace(/\r?\n/g, ' '); };
  return [built.headers.map(esc).join('\t')]
    .concat(built.data.map(function (r) { return r.map(esc).join('\t'); }))
    .join('\n');
}

function nrrExportWaiversCsv() {
  if (!nrrLastWaiverRows) return;
  var built = nrrWaiverExportRows(nrrLastWaiverRows);
  nrrExportCsv(nrrWaiverExportFilename('csv'), built.headers, built.data);
}

function nrrCopyWaiversClipboard(btnEl) {
  if (!nrrLastWaiverRows) return;
  var built = nrrWaiverExportRows(nrrLastWaiverRows);
  nrrCopyText(nrrWaiverTsv(built), btnEl);
}

// Google Sheets has no "import from webpage" without OAuth — the practical
// no-backend move is: copy tab-separated data to the clipboard, then open a
// blank sheet so the user just pastes (Ctrl/Cmd+V lands it in cells, not one
// long string, because it's TSV not CSV).
function nrrExportWaiversGoogleSheets() {
  if (!nrrLastWaiverRows) return;
  var built = nrrWaiverExportRows(nrrLastWaiverRows);
  navigator.clipboard.writeText(nrrWaiverTsv(built)).then(function () {
    if (typeof nrrToast === 'function') nrrToast('คัดลอกข้อมูลแล้ว — วางที่ Google Sheets ที่เพิ่งเปิด (Ctrl/Cmd+V)');
    window.open('https://sheets.new', '_blank', 'noopener');
  }).catch(function () {
    if (typeof nrrToast === 'function') nrrToast('คัดลอกไม่สำเร็จ — ลองโหมด Excel หรือ CSV แทน');
  });
}

// Excel via SpreadsheetML (Office XML) — no bundled library needed; Excel
// opens this format natively via the mso-application hint below, and it
// keeps Thai text intact (declared UTF-8, no separate BOM/encoding tricks
// needed the way raw CSV does).
function nrrExportWaiversExcel() {
  if (!nrrLastWaiverRows) return;
  var built = nrrWaiverExportRows(nrrLastWaiverRows);
  var escXml = function (v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var rowXml = function (cells) {
    return '<Row>' + cells.map(function (c) { return '<Cell><Data ss:Type="String">' + escXml(c) + '</Data></Cell>'; }).join('') + '</Row>';
  };
  var xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<?mso-application progid="Excel.Sheet"?>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    '<Worksheet ss:Name="Waivers"><Table>' +
    rowXml(built.headers) +
    built.data.map(rowXml).join('') +
    '</Table></Worksheet></Workbook>';
  var blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = nrrWaiverExportFilename('xls');
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
