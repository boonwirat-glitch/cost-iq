// ── nrr_waivers.js — #/waivers: Waived Account request/approve queue ─────
// TL sees their own team's requests (read-only history); Admin sees a
// pending queue across all teams with Approve/Reject. Data comes from
// nrr_exclusions.js's nrrExclusionsCache (already fetched in nrrRefresh()
// before any view renders) -- this file is presentation only.

function nrrRenderWaiversView(route) {
  var body = document.getElementById('nrr-waivers-body');
  if (!body) return;
  // portview.csv resolves account_id -> account_name (_nrrAccountNameFor
  // below) -- it's normally only fetched when the Account/Portfolio view
  // renders, so landing on #/waivers directly (without visiting either
  // first) previously showed raw UUIDs instead of names.
  Promise.all([nrrFetchExclusions(), nrrFetchPortviewCsv()]).then(function () {
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

  var pending = rows.filter(function (x) { return x.status === 'submitted'; });
  var approved = rows.filter(function (x) { return x.status === 'approved'; });
  var rejected = rows.filter(function (x) { return x.status === 'rejected'; });
  var revoked = rows.filter(function (x) { return x.status === 'revoked'; });

  return '<div class="h2">' + title + '</div>' +
    howTo +
    '<div class="nrr-waivers-kpis">' +
    '<div class="nrr-waivers-kpi"><div class="num">' + pending.length + '</div><div class="micro">รออนุมัติ</div></div>' +
    '<div class="nrr-waivers-kpi"><div class="num">' + approved.length + '</div><div class="micro">อนุมัติแล้ว</div></div>' +
    '<div class="nrr-waivers-kpi"><div class="num">' + rejected.length + '</div><div class="micro">ปฏิเสธ</div></div>' +
    '<div class="nrr-waivers-kpi"><div class="num">' + revoked.length + '</div><div class="micro">เพิกถอนแล้ว</div></div>' +
    '</div>' +
    (rows.length
      ? rows.map(function (r) { return nrrWaiverRowHtml(r, isAdmin); }).join('')
      : '<div class="ds-empty" style="margin-top:12px"><div class="ds-empty-title">ยังไม่มีคำขอยกเว้น NRR</div></div>');
}

function nrrWaiverRowHtml(r, isAdmin) {
  var monthLabel = QNRR_CFG.months_th[r.period_month] || r.period_month;
  var acctName = _nrrAccountNameFor(r.account_id);
  var scopeLabel = r.outlet_id ? ('สาขา ' + r.outlet_id) : 'ทั้ง account';
  var locked = nrrIsPeriodLocked(r.period_month);
  var actions = '';
  if (isAdmin && r.status === 'submitted') {
    if (locked) {
      actions = '<div class="micro" style="color:var(--ink3);margin-top:6px">เดือน ' + nrrEsc(monthLabel) + ' Lock แล้ว — อนุมัติ/ปฏิเสธไม่ได้แล้ว</div>';
    } else {
      actions = '<div class="nrr-waiver-actions">' +
        '<button class="nrr-exclusion-submit-btn" data-action="waiver-approve" data-id="' + nrrEsc(r.id) + '">Approve</button>' +
        '<button class="nrr-exclusion-cancel-btn" data-action="waiver-reject" data-id="' + nrrEsc(r.id) + '">Reject</button>' +
        '</div>';
    }
  } else if (isAdmin && r.status === 'approved') {
    // Revoking an already-effective waiver retroactively changes %NRR/
    // commission math for that month -- disallow once the month is Lock-ed,
    // same rule as new requests, so a paid-out period never silently
    // changes after the fact.
    actions = locked
      ? '<div class="micro" style="color:var(--ink3);margin-top:6px">เดือน ' + nrrEsc(monthLabel) + ' Lock แล้ว — เพิกถอนไม่ได้แล้ว</div>'
      : '<div class="nrr-waiver-actions">' +
        '<button class="nrr-exclusion-cancel-btn" data-action="waiver-revoke" data-id="' + nrrEsc(r.id) + '">เพิกถอน</button>' +
        '</div>';
  }
  return '<div class="nrr-waiver-card ' + r.status + '">' +
    '<div class="nrr-waiver-top">' +
    '<a href="#/account/' + encodeURIComponent(r.account_id) + '" class="nrr-waiver-acct">' + nrrEsc(acctName) + '</a>' +
    '<span class="nrr-waiver-status ' + r.status + '">' + nrrExclusionStatusLabel(r.status) + '</span>' +
    '</div>' +
    '<div class="micro">เดือน ' + nrrEsc(monthLabel) + ' · ระดับ: ' + nrrEsc(scopeLabel) + ' · เหตุผล: ' + nrrEsc(nrrExclusionReasonLabel(r.reason_code)) +
    (r.target_tl_email ? ' · TL ' + nrrEsc(r.target_tl_email) : '') +
    (r.target_kam_email ? ' · KAM ' + nrrEsc(r.target_kam_email) : '') + '</div>' +
    (r.reason_text ? '<div class="micro" style="margin-top:4px;color:var(--ink2)">' + nrrEsc(r.reason_text) + '</div>' : '') +
    actions +
    '</div>';
}

function nrrHandleWaiversClick(e) {
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
