// ── nrr_waivers.js — #/waivers: Waived Account request/approve queue ─────
// TL sees their own team's requests (read-only history); Admin sees a
// pending queue across all teams with Approve/Reject. Data comes from
// nrr_exclusions.js's nrrExclusionsCache (already fetched in nrrRefresh()
// before any view renders) -- this file is presentation only.

// rows currently on screen (post role-filter) — read by the export menu.
var nrrLastWaiverRows = null;

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

  return '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">' +
    '<div><div class="h2">' + title + '</div>' + howTo + '</div>' +
    exportBtn +
    '</div>' +
    '<div class="nrr-waivers-kpis">' +
    '<div class="nrr-waivers-kpi"><div class="num">' + pending.length + '</div><div class="micro">รออนุมัติ</div></div>' +
    '<div class="nrr-waivers-kpi"><div class="num">' + approved.length + '</div><div class="micro">อนุมัติแล้ว</div></div>' +
    '<div class="nrr-waivers-kpi"><div class="num">' + rejected.length + '</div><div class="micro">ปฏิเสธ</div></div>' +
    '<div class="nrr-waivers-kpi"><div class="num">' + revoked.length + '</div><div class="micro">เพิกถอนแล้ว</div></div>' +
    '</div>' +
    (rows.length
      // v_waiverrow: ตารางแทน card — 1 คำขอ = 1 แถว + audit ครบ (ขอ/ตัดสิน โดยใคร เมื่อไหร่)
      ? '<div style="overflow-x:auto;margin-top:12px"><table class="nrr-table"><thead><tr>' +
        '<th>บริษัท</th><th>ขอบเขต</th><th>เดือน</th><th>สถานะ</th><th>เหตุผล</th>' +
        '<th>ขอโดย</th><th>ตัดสินโดย</th><th></th>' +
        '</tr></thead><tbody>' +
        rows.map(function (r) { return nrrWaiverRowHtml(r, isAdmin); }).join('') +
        '</tbody></table></div>'
      : '<div class="ds-empty" style="margin-top:12px"><div class="ds-empty-title">ยังไม่มีคำขอยกเว้น NRR</div></div>');
}

function nrrWaiverRowHtml(r, isAdmin) {
  var monthLabel = QNRR_CFG.months_th[r.period_month] || r.period_month;
  var acctName = _nrrAccountNameFor(r.account_id);
  // v_scopepill (2026-07-15): whole-account vs. outlet-only used to be
  // plain text ("ระดับ: ทั้ง account") -- easy to skim past when scanning a
  // list of cards. A distinct pill per scope (muted = whole account, violet
  // = one outlet only) reads at a glance, same convention as every other
  // status pill on this page (.nrr-waiver-status) and elsewhere in /nrr.
  var scopeTag = r.outlet_id
    ? '<span class="tag mv-violet">เฉพาะสาขา ' + nrrEsc(_nrrOutletNameFor(r.account_id, r.outlet_id)) + '</span>'
    : '<span class="tag muted">ทั้ง account</span>';
  var locked = nrrIsPeriodLocked(r.period_month);
  // v_clock: เดือนที่ Lock แล้ว "ตัดสินต่อได้" ไม่ใช่ตันเหมือนเดิม
  //
  // ของเดิมปิดปุ่มทิ้งเพราะตอนนั้นแก้ตัวเลขย้อนหลังไม่ได้ — กด lock = จบ
  // ตอนนี้ Sense มี "คำนวณ %NRR ใหม่" ที่คำนวณเฉพาะ %NRR จาก waiver ล่าสุด
  // โดยไม่แตะ upsell/handover ที่แช่แข็งไว้ การปิดปุ่มไว้จึงขัดกับความสามารถใหม่
  // และทำให้จุดประสงค์ทั้งหมด (lock วันที่ 1 แล้วค่อยตรวจ waiver) ใช้ไม่ได้จริง
  //
  // แต่การอนุมัติหลัง lock **ไม่ได้** ทำให้ยอดที่จ่ายเปลี่ยนเอง — ต้องไปกดคำนวณใหม่
  // ที่ Sense อีกทีเสมอ จึงต้องเตือนตรงนี้ให้ชัด ไม่งั้นจะเข้าใจว่าอนุมัติแล้วจบ
  // inline style ตามแบบเดิมของไฟล์นี้ — ไม่แตะ nrr_components.css เพื่อไม่ให้
  // การแก้เล็กๆ นี้ไปพันกับงานอื่นที่ยังค้างอยู่ในไฟล์ CSS นั้น
  // v_waiverrow (backlog ข้อ 3+4): card → row ตาราง — การ์ดเดิมกินที่แนวตั้ง
  // เยอะมาก (บุชชี้เอง) และไม่โชว์ audit trail ทั้งที่ DB มีครบ (requested_by/
  // requested_at/reviewed_by/reviewed_at/review_note เขียนถูกอยู่แล้วทุก action)
  // แถวล็อกแล้ว: เตือนย่อเป็น ⚠ + title แทน banner เต็ม (สาระเดิมครบ)
  var actions = '';
  var lockWarn = locked
    ? '<span class="tag muted" style="cursor:help" title="เดือน ' + nrrEsc(monthLabel) +
      ' Lock แล้ว — ตัดสินได้ แต่ยอดที่ล็อกไว้จะยังไม่เปลี่ยน จนกว่าจะไปกด คำนวณ %NRR ใหม่ ที่ Sense › Commission Cockpit › Lock">⚠ lock</span> '
    : '';
  if (isAdmin && r.status === 'submitted') {
    actions = lockWarn +
      '<button class="nrr-exclusion-submit-btn" data-action="waiver-approve" data-id="' + nrrEsc(r.id) + '">Approve</button> ' +
      '<button class="nrr-exclusion-cancel-btn" data-action="waiver-reject" data-id="' + nrrEsc(r.id) + '">Reject</button>';
  } else if (isAdmin && r.status === 'approved') {
    // เพิกถอนก็เข้าเส้นทางเดียวกัน — recompute จัดการได้เหมือนกันทุกประการ
    actions = lockWarn +
      '<button class="nrr-exclusion-cancel-btn" data-action="waiver-revoke" data-id="' + nrrEsc(r.id) + '">เพิกถอน</button>';
  }
  // audit trail: ใครขอ/เมื่อไหร่ · ใครตัดสิน/เมื่อไหร่ — ตัด @domain ทิ้งให้อ่านสั้น
  function _who(email) { return email ? nrrEsc(String(email).split('@')[0]) : '—'; }
  function _when(ts) { return ts ? String(ts).slice(0, 10) : ''; }
  var reviewedCell = r.reviewed_at
    ? _who(r.reviewed_by) + '<div class="micro" style="color:var(--ink3)">' + _when(r.reviewed_at) + '</div>'
    : '<span style="color:var(--ink3)">—</span>';
  var reasonCell = nrrEsc(nrrExclusionReasonLabel(r.reason_code)) +
    (r.reason_text ? '<div class="micro" style="color:var(--ink3);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + nrrEsc(r.reason_text) + '">' + nrrEsc(r.reason_text) + '</div>' : '') +
    (r.review_note ? '<div class="micro" style="color:var(--ink3)" title="หมายเหตุผู้ตัดสิน">✎ ' + nrrEsc(r.review_note) + '</div>' : '');
  return '<tr>' +
    '<td><a href="#/account/' + encodeURIComponent(r.account_id) + '" class="nrr-waiver-acct">' + nrrEsc(acctName) + '</a></td>' +
    '<td>' + scopeTag + '</td>' +
    '<td>' + nrrEsc(monthLabel) + '</td>' +
    '<td><span class="nrr-waiver-status ' + r.status + '">' + nrrExclusionStatusLabel(r.status) + '</span></td>' +
    '<td>' + reasonCell + '</td>' +
    '<td>' + _who(r.requested_by) + '<div class="micro" style="color:var(--ink3)">' + _when(r.requested_at) + '</div></td>' +
    '<td>' + reviewedCell + '</td>' +
    '<td style="white-space:nowrap">' + actions + '</td>' +
    '</tr>';
}

function nrrHandleWaiversClick(e) {
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
