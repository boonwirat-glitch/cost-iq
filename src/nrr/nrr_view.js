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
  },
  // Company overview section (v26): month window + squad focus filters,
  // survive re-renders same as mvView above.
  companyMonths: 6,          // 3 | 6 | 0 (0 = all months, Jan→current)
  companySquadFocus: 'all',  // 'all' | 'chain' | 'sa_mc'
  pipelineExpandedBucket: null // which handover-pipeline chip's detail list is open
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
      ['nrr-comm-drawer-p1-body', 'nrr-comm-drawer-p3-body'].forEach(function (id) {
        var t = document.getElementById(id);
        if (t) t.innerHTML = '<div class="ds-skel" style="margin-bottom:8px"></div><div class="ds-skel" style="width:65%"></div>';
      });
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
  document.getElementById('nrr-portfolio-body').addEventListener('click', nrrHandlePortfolioClick);
  document.getElementById('nrr-portfolio-body').addEventListener('input', nrrHandlePortfolioInput);
  document.getElementById('nrr-portfolio-body').addEventListener('change', nrrHandlePortfolioChange);
  document.getElementById('nrr-account-body').addEventListener('click', nrrHandleAccountBodyClick);
  document.getElementById('nrr-otip-backdrop').addEventListener('click', nrrCloseAccountOutletTip);

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

// ── Portfolio layer view (Phase B, 2026-07-09) ───────────────────────────
// rep: own portfolio only. tl: own team, with a KAM switcher. admin: every
// KAM, switcher grouped by team. All three render the SAME two blocks —
// self-summary (commission receipt, reused verbatim from the drawer) +
// account card list (portview.csv) — "ภาษาเดียวกัน" across every role.
var nrrPortfolioState = { email: null, search: '', paceFilter: { ok: false, warn: false, danger: false }, skuFilter: false };

// { email, name } list this profile is allowed to switch between — also
// what nrr_router.js's TL guard checks against, so "what the switcher
// offers" and "what the URL guard allows" never drift apart.
function nrrPortfolioSwitcherList() {
  if (nrrProfile.role === 'admin') {
    var out = [];
    nrrListTeams().forEach(function (t) {
      nrrListKamsForTeam(t.email).forEach(function (k) { out.push({ email: k.email, name: k.name, team: t.name }); });
    });
    return out;
  }
  if (nrrProfile.role === 'tl') return nrrListKamsForTeam(nrrProfile.email).map(function (k) { return { email: k.email, name: k.name, team: nrrProfile.name }; });
  return [];
}

function nrrPortfolioSwitcherHtml(list, selectedEmail) {
  if (nrrProfile.role === 'rep' || !list.length) return '';
  var optionsHtml;
  if (nrrProfile.role === 'admin') {
    var byTeam = {};
    list.forEach(function (k) { (byTeam[k.team] = byTeam[k.team] || []).push(k); });
    optionsHtml = Object.keys(byTeam).sort(function (a, b) { return a.localeCompare(b, 'th'); }).map(function (team) {
      return '<optgroup label="' + nrrEsc(team) + '">' + byTeam[team].map(function (k) {
        return '<option value="' + nrrEsc(k.email) + '"' + (k.email === selectedEmail ? ' selected' : '') + '>' + nrrEsc(k.name) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  } else {
    optionsHtml = list.map(function (k) {
      return '<option value="' + nrrEsc(k.email) + '"' + (k.email === selectedEmail ? ' selected' : '') + '>' + nrrEsc(k.name) + '</option>';
    }).join('');
  }
  return '<select class="nrr-search" id="nrr-port-kam-select" style="cursor:pointer">' + optionsHtml + '</select>';
}

// Plain-language status word alongside pace% (Sense pattern, ported from
// 06_portview_teamview.js's _statusLabel — never rely on color alone).
function nrrPaceStatusWord(pace) {
  if (pace.pct == null) return { text: 'ไม่มีฐานเทียบ', color: 'var(--ink3)' };
  if (pace.cls === 'great' || pace.cls === 'safe') return { text: 'ตามเป้า', color: 'var(--green-deep)' };
  if (pace.cls === 'warn') return { text: 'เฝ้าดู', color: 'var(--sun-deep)' };
  return { text: 'น่าเป็นห่วง', color: 'var(--coral)' };
}

// churned_sku_count/last_month_sku_count reframed POSITIVE (round 2,
// 2026-07-09) — "SKU ที่กลับมาสั่งซ้ำ" (last_month_sku_count - churned)
// out of last month's SKU base, not "SKU ที่หลุด." Same early-month-bias
// caveat as before (portview compares last month's orders against THIS
// month's MTD, so early in the month a lot of normal-cadence SKUs haven't
// re-ordered yet) — framing it as "ordered" instead of "churned" and
// escalating color only when the reorder rate is actually LOW (inverted
// from round 1: high ratio = good = quiet, low ratio = bad = coral) reads
// far less alarmist while showing the exact same underlying numbers.
function nrrSkuGapSeverity(row) {
  var m = row.last_month_sku_count || 0;
  if (m <= 0) return null;
  var ordered = Math.max(0, m - (row.churned_sku_count || 0));
  var ratio = ordered / m;
  var cls = ratio >= 0.75 ? 'quiet' : ratio >= 0.5 ? 'warn' : 'danger';
  return { ordered: ordered, m: m, cls: cls };
}

function nrrAcctRowHtml(item) {
  var r = item.row, pace = item.pace;
  var color = pace.pct == null ? 'var(--ink3)' : nrrThresholdColorVar(pace.pct);
  var status = nrrPaceStatusWord(pace);
  var gap = nrrSkuGapSeverity(r);
  var gapHtml = gap
    ? '<span class="nrr-acct-flag ' + gap.cls + '">สั่งแล้ว ' + gap.ordered + '/' + gap.m + ' SKU</span>' : '';
  var missingHtml = r.missing_cat_count > 0
    ? '<span class="nrr-acct-flag">ไม่มีหมวด ' + r.missing_cat_count + '</span>' : '';
  // Whole row is a link into Account view (Phase C) — was intentionally
  // absent in Phase B ("ไม่มีปุ่ม/ลิงก์เข้า account detail" — the view didn't
  // exist yet, an affordance that goes nowhere is worse than none). Now
  // that #/account/:id is real, the row is the natural click target
  // (matches Sense's own "tap the card to open the account" gesture).
  return '<a class="nrr-acct-row" href="#/account/' + encodeURIComponent(r.account_id) + '" style="border-left-color:' + color + '">' +
    '<div class="nrr-acct-row-left">' +
    '<div class="nrr-acct-row-name">' + nrrEsc(r.account_name || r.account_id) + '</div>' +
    '<div class="nrr-acct-row-meta"><span class="num">' + nrrFmtGMV(r.runrate_gmv) + '</span><span class="micro">run-rate</span>' +
    '<span class="micro">/ ' + (pace.pct != null ? nrrFmtGMV(pace.baseline_gmv) : '—') + ' เดือนฐาน</span>' +
    '<span class="micro">· ดูแล ' + (r.days_with_current_kam || 0) + ' วัน</span></div>' +
    (gapHtml || missingHtml ? '<div class="nrr-acct-row-flags">' + gapHtml + missingHtml + '</div>' : '') +
    '</div>' +
    '<div class="nrr-acct-row-right">' +
    '<span class="num nrr-acct-row-pace" style="color:' + color + '">' + pace.label + '</span>' +
    '<span class="nrr-acct-row-status" style="color:' + status.color + '">' + nrrEsc(status.text) + '</span>' +
    nrrAcctSparklineHtml(r, pace) +
    '</div>' +
    '</a>';
}

// Portfolio-level risk summary — Sense's ON TRACK/MONITOR/AT RISK boxes
// (06_portview_teamview.js:1580-1700), ported as a count+value stat strip.
// Round 3 (2026-07-09): the tiles ARE the pace filter now — click one or
// more to narrow the list to those buckets (multi-select, OR'd); none
// selected = show everything. Replaces the old separate "ทั้งหมด"/"ต่ำกว่า
// pace" chips, which were redundant with what these tiles already show.
function nrrPortfolioRiskSummaryHtml(kamEmail) {
  var b = nrrPortfolioRiskSummary(kamEmail);
  var anySelected = nrrPortfolioState.paceFilter.ok || nrrPortfolioState.paceFilter.warn || nrrPortfolioState.paceFilter.danger;
  function tile(key, color, label, count, value, sign) {
    var selected = nrrPortfolioState.paceFilter[key];
    return '<div class="nrr-risk-tile ' + key + (selected ? ' selected' : '') + '" data-risk-filter="' + key + '">' +
      '<div class="nrr-risk-tile-label" style="color:' + color + '">' + nrrEsc(label) + ' <span class="num">' + count + ' ร้าน</span></div>' +
      '<div class="num nrr-risk-tile-value" style="color:' + color + '">' + sign + nrrFmtGMV(value) + '</div>' +
      '</div>';
  }
  return '<div class="nrr-risk-strip' + (anySelected ? ' has-selection' : '') + '" id="nrr-port-risk-strip">' +
    tile('ok', 'var(--green-deep)', 'ตามเป้า', b.ok.count, b.ok.value, '+') +
    tile('warn', 'var(--sun-deep)', 'เฝ้าดู', b.warn.count, b.warn.value, '-') +
    tile('danger', 'var(--coral)', 'น่าเป็นห่วง', b.danger.count, b.danger.value, '-') +
    '</div>';
}

// Filters/sorts this KAM's accounts against the current search+filter
// state. Split from the shell (below) so typing in the search box only
// repaints the grid, not the input itself (which would drop focus/cursor
// position).
function nrrPortfolioAcctGridHtml(email) {
  var pf = nrrPortfolioState.paceFilter;
  var anyPaceSelected = pf.ok || pf.warn || pf.danger;
  var filtered = nrrPortfolioRowsFor(email).filter(function (item) {
    if (anyPaceSelected) {
      var bucket = (item.pace.cls === 'great' || item.pace.cls === 'safe') ? 'ok' : (item.pace.cls === 'warn' ? 'warn' : (item.pace.cls === 'danger' ? 'danger' : null));
      if (!bucket || !pf[bucket]) return false;
    }
    if (nrrPortfolioState.skuFilter) {
      var gap = nrrSkuGapSeverity(item.row);
      if (!gap || gap.cls === 'quiet') return false;
    }
    if (nrrPortfolioState.search && item.row.account_name.toLowerCase().indexOf(nrrPortfolioState.search) === -1) return false;
    return true;
  });
  return filtered.length
    ? '<div class="nrr-acct-list">' + filtered.map(nrrAcctRowHtml).join('') + '</div>'
    : '<div class="ds-empty"><div class="ds-empty-title">ไม่พบร้านที่ตรงกับตัวกรอง</div></div>';
}

function nrrPortfolioAcctListHtml(email) {
  var all = nrrPortfolioRowsFor(email);
  var skuChip = '<button type="button" class="nrr-chip' + (nrrPortfolioState.skuFilter ? ' on' : '') + '" data-port-filter="churn">สั่งซ้ำต่ำ</button>';
  return '<div class="nrr-panel-head" style="margin-top:8px"><div class="h2" style="font-size:18px">ร้านในมือ (' + all.length + ')</div></div>' +
    nrrPortfolioRiskSummaryHtml(email) +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;margin-top:14px">' +
    '<input class="nrr-search" id="nrr-port-search" placeholder="ค้นหาร้าน..." value="' + nrrEsc(nrrPortfolioState.search) + '">' +
    '</div>' +
    '<div class="nrr-chip-row" id="nrr-port-chips">' + skuChip + '</div>' +
    '<div id="nrr-port-acct-grid">' + nrrPortfolioAcctGridHtml(email) + '</div>';
}

// NRR/GMV hero — this is the primary "how am I doing" answer for the page
// (round 2, 2026-07-09: promoted above the commission section, which used
// to lead — money is a downstream consequence of this number, not the
// headline). Reuses nrrMonthTriple/nrrTripleHtml exactly as the dashboard
// does elsewhere in this app — one convention, no new component.
function nrrPortfolioPulseHtml(email, period) {
  var result = nrrKamResult(email);
  var bm = result && period ? result.by_month[period] : null;
  var pct = bm ? bm.nrr_pct : null;
  var triple = nrrMonthTriple(result, period);
  return '<div class="nrr-port-pulse">' +
    '<div class="eyebrow">%NRR · ' + nrrEsc(QNRR_CFG.months_th[period] || period) + '</div>' +
    '<div class="num nrr-port-pulse-pct" style="color:' + (pct != null ? nrrThresholdColorVar(pct) : 'var(--ink3)') + '">' + (pct != null ? pct + '%' : '—') + '</div>' +
    nrrTripleHtml('lg', triple) +
    '</div>';
}

function nrrRenderPortfolioBody() {
  var body = document.getElementById('nrr-portfolio-body');
  if (!body) return;
  var email = nrrPortfolioState.email;
  if (!email) {
    body.innerHTML = '<div class="nrr-panel-head"><div class="h2">Portfolio</div></div>' +
      '<div class="ds-empty"><div class="ds-empty-title">ยังไม่มี KAM ในทีมให้เลือกดู</div></div>';
    return;
  }
  var list = nrrPortfolioSwitcherList();
  var switcherHtml = nrrPortfolioSwitcherHtml(list, email);
  var kamName = (list.find(function (k) { return k.email === email; }) || {}).name || email;

  var period = nrrCurrentPeriod(nrrKamResult(email));
  var pulseHtml = period ? nrrPortfolioPulseHtml(email, period) : '';
  var summaryHtml;
  if (period) {
    var bundle = nrrCommReceiptBundle(email, period, 'nrr-port-p1-body', 'nrr-port-p3-body');
    summaryHtml = '<div class="nrr-comm-ds">' + bundle.html + '</div>';
  } else {
    bundle = null;
    summaryHtml = '<div class="ds-empty"><div class="ds-empty-title">ยังไม่มีข้อมูล %NRR ของเดือนนี้</div></div>';
  }

  body.innerHTML =
    '<div class="nrr-panel-head">' +
    '<div><div class="eyebrow">Portfolio' + (nrrProfile.role !== 'rep' ? ' · ' + nrrEsc(kamName) : '') + '</div><div class="h2">' + (nrrProfile.role === 'rep' ? 'ของฉัน' : nrrEsc(kamName)) + '</div></div>' +
    switcherHtml +
    '</div>' +
    pulseHtml +
    '<div class="nrr-panel-head" style="margin-top:22px"><div class="h2" style="font-size:18px">ค่าคอมมิชชั่น</div></div>' +
    summaryHtml +
    nrrPortfolioAcctListHtml(email);

  if (period && bundle) {
    nrrLoadCommissionUpsellSection(email, bundle.expansionOutletIds, bundle.bd, 'nrr-port-p1-body', 'nrr-port-p3-body',
      function (e) { return nrrPortfolioState.email === e; });
  }

  // Lock the account-list container to its just-rendered height so typing
  // in the search box (which only ever removes rows relative to this
  // baseline) can't shrink the page and bounce the scroll position —
  // re-measured fresh on every full body render (KAM switch included).
  var gridElInit = document.getElementById('nrr-port-acct-grid');
  if (gridElInit) gridElInit.style.minHeight = gridElInit.scrollHeight + 'px';
}

function nrrRenderPortfolioLayerView(route) {
  var body = document.getElementById('nrr-portfolio-body');
  if (!body) return;
  body.innerHTML = '<div class="ds-skel" style="height:120px"></div>';
  Promise.all([nrrFetchPortviewCsv(), nrrFetchBulkHistoryCsv()]).then(function () {
    var email = route.param || nrrProfile.email;
    if (nrrProfile.role !== 'rep' && !route.param) {
      var list = nrrPortfolioSwitcherList();
      email = list.length ? list[0].email : null;
    }
    nrrPortfolioState.email = email;
    nrrRenderPortfolioBody();
  });
}

// Delegated interaction handlers — bound once in nrrInitApp to the
// persistent #nrr-portfolio-body container (the router re-renders its
// innerHTML on every route change, so listeners must live on the parent).
function nrrHandlePortfolioClick(e) {
  var riskTile = e.target.closest('[data-risk-filter]');
  if (riskTile) {
    var key = riskTile.dataset.riskFilter;
    nrrPortfolioState.paceFilter[key] = !nrrPortfolioState.paceFilter[key];
    var stripEl = document.getElementById('nrr-port-risk-strip');
    if (stripEl) stripEl.outerHTML = nrrPortfolioRiskSummaryHtml(nrrPortfolioState.email);
    var gridEl0 = document.getElementById('nrr-port-acct-grid');
    if (gridEl0) gridEl0.innerHTML = nrrPortfolioAcctGridHtml(nrrPortfolioState.email);
    return;
  }
  var chip = e.target.closest('[data-port-filter]');
  if (chip) {
    nrrPortfolioState.skuFilter = !nrrPortfolioState.skuFilter;
    chip.classList.toggle('on', nrrPortfolioState.skuFilter);
    var gridEl = document.getElementById('nrr-port-acct-grid');
    if (gridEl) gridEl.innerHTML = nrrPortfolioAcctGridHtml(nrrPortfolioState.email);
    return;
  }
  var retryBtn = e.target.closest('.nrr-comm-retry-upsell-btn');
  if (retryBtn && nrrPortfolioState.email === retryBtn.dataset.email) {
    ['nrr-port-p1-body', 'nrr-port-p3-body'].forEach(function (id) {
      var t = document.getElementById(id);
      if (t) t.innerHTML = '<div class="ds-skel" style="margin-bottom:8px"></div><div class="ds-skel" style="width:65%"></div>';
    });
    delete nrrUpsellBundleCache[retryBtn.dataset.email];
    var period = nrrCurrentPeriod(nrrKamResult(retryBtn.dataset.email));
    var bundle = nrrCommReceiptBundle(retryBtn.dataset.email, period, 'nrr-port-p1-body', 'nrr-port-p3-body');
    nrrLoadCommissionUpsellSection(retryBtn.dataset.email, bundle.expansionOutletIds, bundle.bd, 'nrr-port-p1-body', 'nrr-port-p3-body',
      function (e2) { return nrrPortfolioState.email === e2; });
  }
}
function nrrHandlePortfolioInput(e) {
  if (e.target.id !== 'nrr-port-search') return;
  nrrPortfolioState.search = e.target.value.trim().toLowerCase();
  var gridEl = document.getElementById('nrr-port-acct-grid');
  if (gridEl) gridEl.innerHTML = nrrPortfolioAcctGridHtml(nrrPortfolioState.email);
}
function nrrHandlePortfolioChange(e) {
  if (e.target.id !== 'nrr-port-kam-select') return;
  nrrNavigate('#/portfolio/' + encodeURIComponent(e.target.value));
}
// ── Account view (Phase C, 2026-07-09) ───────────────────────────────────
// #/account/:id — opened from a Portfolio account row. Ownership guard
// lives HERE (not in nrr_router.js's synchronous nrrRouteGuard) because a
// rep/TL could deep-link straight to this URL before portview.csv has
// loaded — the router can't know account→KAM mapping until data arrives,
// so the check happens once that data is in hand (see nrr_router.js's own
// comment, which anticipated exactly this).
var nrrAccountState = { accountId: null, kamEmail: null, trendMonths: null, showAllPos: false, showAllRisk: false };

// Shaped like the real page (mast/hero/stat-row/two lists), not one flat
// bar — the fetch chain here includes bulk_price.csv (36MB) so this can
// sit on screen for a few seconds; it should read as "loading this page"
// not "the page broke." Reuses .ds-skel's shimmer (now unscoped, see
// nrr_components.css) — no new animation.
function nrrAccountSkeletonHtml() {
  var trendBars = Array.from({ length: 7 }, function () { return '<div class="ds-skel nrr-acct-skel-bar"></div>'; }).join('');
  var statCells = Array.from({ length: 4 }, function () { return '<div class="ds-skel nrr-acct-skel-stat"></div>'; }).join('');
  var rows = Array.from({ length: 3 }, function () { return '<div class="ds-skel nrr-acct-skel-row"></div>'; }).join('');
  return '<div class="nrr-acct-skel">' +
    '<div class="nrr-acct-skel-mast"><div class="ds-skel" style="width:30px;height:30px;border-radius:50%"></div><div class="ds-skel" style="width:220px;height:19px"></div></div>' +
    '<div class="ds-skel" style="width:130px;height:12px;margin-top:26px"></div>' +
    '<div class="ds-skel" style="width:170px;height:32px;margin-top:8px"></div>' +
    '<div class="ds-skel" style="height:9px;border-radius:999px;margin-top:18px"></div>' +
    '<div class="nrr-acct-skel-trend">' + trendBars + '</div>' +
    '<div class="nrr-acct-skel-stats">' + statCells + '</div>' +
    '<div class="ds-skel" style="height:52px;margin-top:22px"></div>' +
    '<div class="ds-skel" style="width:160px;height:16px;margin-top:26px"></div>' +
    '<div class="nrr-acct-skel-rows">' + rows + '</div>' +
    '</div>';
}

function nrrRenderAccountView(route) {
  var body = document.getElementById('nrr-account-body');
  if (!body) return;
  var accountId = route.param;
  if (!accountId) {
    body.innerHTML = '<div class="ds-empty"><div class="ds-empty-title">ไม่พบร้านนี้</div><div class="micro" style="margin-top:8px"><a href="#/portfolio" style="color:var(--green-deep)">← กลับ Portfolio</a></div></div>';
    return;
  }
  body.innerHTML = nrrAccountSkeletonHtml();
  Promise.all([nrrFetchPortviewCsv(), nrrFetchBulkHistoryCsv()]).then(function () {
    var row = (window.bulkPortviewData.allRows || []).filter(function (r) { return r.account_id === accountId; })[0];
    if (!row) {
      body.innerHTML = '<div class="ds-empty"><div class="ds-empty-title">ไม่พบร้านนี้</div><div class="micro" style="margin-top:8px"><a href="#/portfolio" style="color:var(--green-deep)">← กลับ Portfolio</a></div></div>';
      return;
    }
    if (nrrProfile.role === 'rep' && row.kam_email !== nrrProfile.email) { nrrNavigate('#/portfolio'); return; }
    if (nrrProfile.role === 'tl' && row.tl_email !== nrrProfile.email) { nrrNavigate('#/portfolio'); return; }

    nrrAccountState.accountId = accountId;
    nrrAccountState.kamEmail = row.kam_email;
    nrrAccountState.showAllPos = false;
    nrrAccountState.showAllRisk = false;

    Promise.all([
      nrrFetchSenseSkusCsv(row.kam_email), nrrFetchSenseSkuOutletCsv(row.kam_email),
      nrrFetchBulkOutletsCsv(), nrrFetchBulkCategoriesCsv(), nrrFetchBulkPriceCsv()
    ]).then(function () {
      if (nrrAccountState.accountId !== accountId) return; // navigated away mid-fetch
      nrrRenderAccountBody(row);
    });
  });
}

function nrrRenderAccountBody(row) {
  var body = document.getElementById('nrr-account-body');
  if (!body) return;
  var kamEmail = nrrAccountState.kamEmail;
  body.innerHTML =
    nrrAccountHeaderHtml(row) +
    nrrAccountHeroHtml(row) +
    nrrAccountStatRowHtml(row, kamEmail) +
    nrrAccountVerdictHtml(row, kamEmail) +
    nrrAccountSignalListsHtml(row, kamEmail);
  nrrRenderAccountTrendChart(row);
}

function nrrAccountHeaderHtml(row) {
  return '<div class="nrr-acct-mast">' +
    '<a href="#/portfolio" class="nrr-acct-back" aria-label="กลับ Portfolio">←</a>' +
    '<div><div class="eyebrow">' + nrrEsc(row.account_type || '') +
    '<span class="nrr-acct-type-chip">' + nrrEsc(row.kam_name || '') + '</span></div>' +
    '<div class="h2" style="font-size:19px">' + nrrEsc(row.account_name || row.account_id) + '</div></div>' +
    '</div>';
}

function nrrAccountHeroHtml(row) {
  var pace = nrrPaceSignal(row);
  var color = pace.pct == null ? 'var(--ink3)' : nrrThresholdColorVar(pace.pct);
  var status = nrrPaceStatusWord(pace);
  var scaleMax = Math.max(row.runrate_gmv || 0, pace.baseline_gmv || 0, row.gmv_to_date || 0) || 1;
  var fillPct = Math.min(100, Math.round((row.gmv_to_date || 0) / scaleMax * 100));
  var expectPct = (pace.expected != null) ? Math.min(100, Math.round(pace.expected / scaleMax * 100)) : null;

  return '<div class="nrr-acct-hero">' +
    '<div class="nrr-acct-hero-head">' +
    '<div><div class="micro">ซื้อแล้วเดือนนี้ (MTD)</div><div class="num nrr-acct-hero-num" style="color:' + color + '">' + nrrFmtGMVExact(row.gmv_to_date) + '</div></div>' +
    '<div class="nrr-acct-hero-side">' +
    '<div class="num nrr-acct-hero-side-v">' + nrrFmtGMV(row.runrate_gmv) + '</div><div class="micro">คาดเต็มเดือน</div>' +
    (pace.baseline_gmv ? '<div class="num nrr-acct-hero-side-v" style="color:var(--ink2);margin-top:6px">' + nrrFmtGMV(pace.baseline_gmv) + '</div><div class="micro">เดือนฐานไตรมาส (' + nrrEsc(QNRR_CFG.months_th[QNRR_CFG.base_month] || '') + ')</div>' : '') +
    '</div></div>' +
    '<div class="nrr-acct-pace-row">' +
    '<span class="micro"><b class="num" style="color:' + color + '">' + (pace.pct != null ? pace.label : '—') + '</b> ' + nrrEsc(status.text) + '</span>' +
    '<div class="nrr-acct-pace-track"><div class="nrr-acct-pace-fill" style="width:' + fillPct + '%;background:' + color + '"></div>' +
    (expectPct != null ? '<div class="nrr-acct-pace-expect" style="left:' + expectPct + '%" title="ควรได้ตอนนี้ ' + nrrFmtGMV(pace.expected) + '"></div>' : '') +
    '</div>' +
    '<span class="micro">วันที่ ' + (row.days_elapsed || 0) + '/' + (row.days_in_month || 0) + '</span>' +
    '</div>' +
    '<div class="nrr-acct-trend" id="nrr-acct-trend"></div>' +
    '<div class="nrr-acct-trend-summary" id="nrr-acct-trend-summary"></div>' +
    '</div>';
}

function nrrRenderAccountTrendChart(row) {
  var histRows = ((window.bulkHistoryData && window.bulkHistoryData.byAccountId[row.account_id]) || []).slice()
    .sort(function (a, b) { return (_nrrParseThLabel(a.month_label).key || 0) - (_nrrParseThLabel(b.month_label).key || 0); });
  var baseLabel = nrrBaseMonthThLabel();
  var months = histRows.slice(-6).map(function (h) { return { label: h.month_label, v: h.gmv, isBase: h.month_label === baseLabel }; });
  months.push({ label: nrrCommCurrentMonthLabel(), v: row.gmv_to_date || 0, proj: row.runrate_gmv || 0, current: true });
  nrrAccountState.trendMonths = months;

  var chart = document.getElementById('nrr-acct-trend');
  if (!chart) return;
  var maxV = Math.max.apply(null, months.map(function (m) { return m.proj || m.v; }).concat([1]));
  chart.innerHTML = months.map(function (m, i) {
    var totalH = Math.round(((m.proj || m.v) / maxV) * 78);
    var solidH = m.current ? Math.round((m.v / maxV) * 78) : totalH;
    var hatchH = m.current ? Math.max(0, totalH - solidH) : 0;
    // No dashed border on the base month bar anymore — it read as a dark
    // tick and inflated the bar's apparent height. Base month is marked on
    // its LABEL instead (below) — but the tag span is rendered for EVERY
    // column now (CSS toggles visibility, see .nrr-acct-trend-basetag),
    // not just appended for isBase. .nrr-acct-trend uses align-items:
    // flex-end with no fixed column height, so a column whose label is
    // taller than its siblings (the old conditional-append) gets its top
    // pushed up to keep bottoms level — visually shifting its number/bar
    // upward. Reserving the same slot on every column, hidden or not,
    // keeps every column's height identical so none of them shift.
    var bar = m.current
      ? '<div class="nrr-qcol-hatch" style="height:' + hatchH + 'px"></div><div class="nrr-acct-trend-bar" style="height:' + solidH + 'px;background:var(--green);opacity:.85"></div>'
      : '<div class="nrr-acct-trend-bar" style="height:' + solidH + 'px"></div>';
    var lbl = nrrEsc(m.label.split(' ')[0]) + '<span class="nrr-acct-trend-basetag">ฐาน</span>';
    return '<button type="button" class="nrr-acct-trend-col' + (i === months.length - 1 ? ' sel' : '') + (m.isBase ? ' base' : '') + '" data-i="' + i + '">' +
      '<div class="nrr-acct-trend-val num">' + nrrFmtGMV(m.v) + '</div>' +
      '<div class="nrr-acct-trend-bar-track">' + bar + '</div>' +
      '<div class="nrr-acct-trend-lbl">' + lbl + '</div></button>';
  }).join('');
  nrrSelectAccountTrendMonth(months.length - 1);
}

function nrrSelectAccountTrendMonth(i) {
  var months = nrrAccountState.trendMonths || [];
  var chart = document.getElementById('nrr-acct-trend');
  if (chart) chart.querySelectorAll('.nrr-acct-trend-col').forEach(function (c, idx) { c.classList.toggle('sel', idx === i); });
  var m = months[i];
  if (!m) return;
  var maxV = Math.max.apply(null, months.map(function (x) { return x.v; }).concat([1]));
  var note = m.current ? 'MTD จริง' : m.isBase ? 'เดือนฐานของไตรมาสนี้' : (m.v === maxV ? 'สูงสุดในช่วงนี้' : '');
  var summary = document.getElementById('nrr-acct-trend-summary');
  if (summary) summary.innerHTML = '<span>' + nrrEsc(m.label) + (note ? ' · ' + nrrEsc(note) : '') + '</span><span class="num nrr-acct-trend-amt">' + nrrFmtGMVExact(m.v) + '</span>';
}

// ── Stat row (4 cells: AOV/outlet/category/price) — .nrr-triple-lg-style
// hairline cells, never a filled box (see nrr_base.css's own warning
// about gray fills being "the single biggest contributor to the boxes
// everywhere look" — the design mockups fell into exactly that trap once
// before this was written). Each cell opens #nrr-slideover, the SAME
// component the commission drawer/movement drill-down already use — no
// parallel overlay component.
function nrrAcctSparklineSvg(months) {
  var vals = months.map(function (m) { return m.aov; }).filter(function (v) { return v != null; });
  if (vals.length < 2) return '';
  // Zero-floored scale, not min/max-of-visible-data — matches
  // nrrRenderAccountTrendChart's convention. A min/max scale always fills
  // the same pixel range regardless of magnitude, so a 77% decline and a
  // 6% decline would render as visually identical slopes; scaling from 0
  // lets a real decline actually look like one.
  var maxV = Math.max.apply(null, vals.concat([0])) || 1, minV = 0;
  var range = maxV - minV || 1;
  var pts = vals.map(function (v, i) { var x = i / (vals.length - 1) * 100; var y = 18 - ((v - minV) / range * 16 + 1); return x + ',' + y; }).join(' ');
  var lastY = 18 - ((vals[vals.length - 1] - minV) / range * 16 + 1);
  return '<svg class="nrr-acct-spark-svg" viewBox="0 0 100 18" preserveAspectRatio="none">' +
    '<polyline points="' + pts + '" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
    '<circle cx="100" cy="' + lastY + '" r="2.4" fill="var(--green-deep)"></circle></svg>';
}
// ── SKU price history chart — click-to-expand row inside the "ราคาสินค้า"
// drawer. Loosely ported from Sense's SKU detail sheet (05_kam_view.js
// renderSkuDetailContent) but simplified: no opportunity/alternative
// overlay, no qty footer — this rides entirely on bulk_price.csv's
// unit_price so it renders even for items no longer on this month's SKU
// list (nrrAccountPriceImpact's nameByItem fallback covers the name).
// Min/max-of-data scale on purpose (NOT nrrAcctSparklineSvg's zero-floor
// convention) — unit prices never approach ฿0, so zero-flooring would
// flatten a real move into a barely-visible wiggle.
function nrrFmtUnitPrice(v) {
  if (v == null || isNaN(v)) return '—';
  var r = Math.round(v * 100) / 100;
  return '฿' + (r % 1 === 0 ? r.toFixed(0) : r.toFixed(2));
}
function nrrSkuPriceHistorySvg(history) {
  if (!history || history.length < 2) {
    return '<div class="micro" style="color:var(--ink3);padding:4px 0 10px">ไม่มีข้อมูลราคาย้อนหลังพอสำหรับกราฟ</div>';
  }
  var prices = history.map(function (h) { return h.unit_price; });
  var mn = Math.min.apply(null, prices), mx = Math.max.apply(null, prices);
  var rng = (mx - mn) || (mn * 0.01) || 1;
  var first = history[0], last = history[history.length - 1];
  var delta = last.unit_price - first.unit_price;
  var flatBand = Math.abs(first.unit_price) * 0.005;
  var color = delta > flatBand ? 'var(--green-deep)' : delta < -flatBand ? 'var(--coral)' : 'var(--ink3)';
  var W = 280, H = 90, pL = 10, pR = 10, pT = 16, pB = 20;
  var cW = W - pL - pR, cH = H - pT - pB;
  var pts = history.map(function (h, i) {
    return { x: pL + (i / (history.length - 1)) * cW, y: pT + cH - ((h.unit_price - mn) / rng) * cH, mo: h.month_label };
  });
  var linePts = pts.map(function (p) { return p.x + ',' + p.y; }).join(' ');
  var areaPts = pL + ',' + (pT + cH) + ' ' + linePts + ' ' + (pL + cW) + ',' + (pT + cH);
  var dots = pts.map(function (p, i) {
    return (i === 0 || i === pts.length - 1) ? '<circle cx="' + p.x + '" cy="' + p.y + '" r="2.6" fill="' + color + '"></circle>' : '';
  }).join('');
  var monthLbls = pts.map(function (p) {
    return '<text x="' + p.x + '" y="' + (H - 4) + '" font-size="8" fill="var(--ink3)" text-anchor="middle">' + nrrEsc(p.mo.split(' ')[0]) + '</text>';
  }).join('');
  var deltaPct = first.unit_price > 0 ? (delta / first.unit_price) * 100 : 0;
  return '<div style="padding:6px 0 10px">' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none">' +
    '<polygon points="' + areaPts + '" fill="' + color + '" opacity="0.08"></polygon>' +
    '<polyline points="' + linePts + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
    dots + monthLbls +
    '</svg>' +
    '<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:2px">' +
    '<span style="color:var(--ink2)">' + nrrFmtUnitPrice(first.unit_price) + ' → ' + nrrFmtUnitPrice(last.unit_price) + '</span>' +
    '<span style="color:' + color + ';font-weight:700">' + (deltaPct >= 0 ? '+' : '') + Math.round(deltaPct * 10) / 10 + '% ตลอดช่วง</span>' +
    '</div></div>';
}
window.nrrSkuPriceHistorySvg = nrrSkuPriceHistorySvg;

function nrrOutletDotGridHtml(outlets) {
  return '<div class="nrr-acct-outlet-dots">' + outlets.map(function (o) {
    var cls = (o.status === 'quiet' || o.cycle === 'gone') ? 'quiet' : o.status === 'new' ? 'new' : '';
    return '<span class="' + cls + '" title="' + nrrEsc(o.outlet_name) + '"></span>';
  }).join('') + '</div>';
}
function nrrOutletStackedBarHtml(counts, total) {
  if (!total) return '';
  function w(n) { return Math.round(n / total * 100); }
  return '<div class="nrr-acct-outlet-stack">' +
    '<i style="width:' + w(counts.steady) + '%;background:var(--green)"></i>' +
    '<i style="width:' + w(counts.new) + '%;background:var(--sun)"></i>' +
    '<i style="width:' + w(counts.quiet) + '%;background:var(--coral);opacity:.6"></i>' +
    '</div>';
}
function nrrPriceDivBarHtml(price) {
  var upTotal = price.up.reduce(function (s, e) { return s + e.impact; }, 0);
  var downTotal = Math.abs(price.down.reduce(function (s, e) { return s + e.impact; }, 0));
  var total = upTotal + downTotal;
  if (!total) return '';
  var upW = Math.round(upTotal / total * 100);
  return '<div class="nrr-acct-price-div"><i style="width:' + upW + '%;background:var(--green)"></i><i style="width:' + (100 - upW) + '%;background:var(--coral)"></i></div>';
}

function nrrAccountStatRowHtml(row, kamEmail) {
  var aov = nrrAccountAov(row.account_id);
  var outlet = nrrOutletMovement(row.account_id);
  var cat = nrrAccountCategoryCoverage(row.account_id, kamEmail);
  var price = nrrAccountPriceImpact(row.account_id, kamEmail);

  var aovCell = '<button type="button" class="nrr-acct-stat-cell" data-stat="aov" style="border-top-color:' + aov.band.color + '">' +
    '<div class="nrr-acct-stat-lbl">AOV เฉลี่ย <span>›</span></div>' +
    '<div class="num nrr-acct-stat-val" style="color:' + aov.band.color + '">' + (aov.current != null ? nrrFmtGMVExact(aov.current) : '—') + '</div>' +
    nrrAcctSparklineSvg(aov.months) +
    '<div class="nrr-acct-stat-sub">ระดับ <b style="color:' + aov.band.color + '">' + nrrEsc(aov.band.label) + '</b>' +
    (aov.trendPct != null ? ' · ' + (aov.trendPct >= 0 ? 'โต' : 'ลด') + ' ' + Math.abs(aov.trendPct) + '%/3 เดือน' : '') + '</div>' +
    '</button>';

  // Accent color per cell reflects that cell's own health, same "colored
  // signal, not a decoration" rule as everywhere else in the app —
  // outlet: any quiet outlet outranks a new one for attention.
  var outletAccent = outlet.counts.quiet > 0 ? 'var(--coral)' : outlet.counts.new > 0 ? 'var(--sun)' : 'var(--green)';
  var outletViz = outlet.total > 15 ? nrrOutletStackedBarHtml(outlet.counts, outlet.total) : nrrOutletDotGridHtml(outlet.outlets);
  var outletCell = '<button type="button" class="nrr-acct-stat-cell" data-stat="outlet" style="border-top-color:' + outletAccent + '">' +
    '<div class="nrr-acct-stat-lbl">สาขา <span>›</span></div>' +
    '<div class="num nrr-acct-stat-val">' + outlet.total + ' สาขา</div>' +
    outletViz +
    '<div class="nrr-acct-stat-sub">' + outlet.counts.steady + ' ปกติ · ' + outlet.counts.new + ' ใหม่ · ' + outlet.counts.quiet + ' เงียบ</div>' +
    '</button>';

  var catGaps = cat.total - cat.boughtCount;
  var catAccent = catGaps === 0 ? 'var(--green)' : catGaps <= 3 ? 'var(--sun)' : 'var(--coral)';
  var catCell = '<button type="button" class="nrr-acct-stat-cell" data-stat="category" style="border-top-color:' + catAccent + '">' +
    '<div class="nrr-acct-stat-lbl">หมวดสินค้า <span>›</span></div>' +
    '<div class="num nrr-acct-stat-val">' + cat.boughtCount + '<span style="font-size:13px;color:var(--ink3)">/' + cat.total + '</span></div>' +
    '<div class="nrr-acct-cat-swatches">' + cat.categories.map(function (c) {
      return '<i style="background:' + c.color + ';opacity:' + (c.bought ? '1' : '.25') + '" title="' + nrrEsc(c.name) + '"></i>';
    }).join('') + '</div>' +
    '<div class="nrr-acct-stat-sub">เหลือ ' + catGaps + ' หมวดที่ยังไม่ซื้อ</div>' +
    '</button>';

  var priceCell;
  if (!price) {
    priceCell = '<div class="nrr-acct-stat-cell" style="cursor:default;border-top-color:var(--ink3)"><div class="nrr-acct-stat-lbl">ราคาสินค้า</div><div class="micro">กำลังโหลด...</div></div>';
  } else if (!price.hasCurrentData && !(price.creeping && price.creeping.length)) {
    // bulk_price.csv hasn't been batched for this month yet — say so
    // plainly rather than showing a "+฿0 ไม่มีการเปลี่ยนแปลง" that reads
    // as a verified zero (see nrrAccountPriceImpact comment).
    priceCell = '<div class="nrr-acct-stat-cell" style="cursor:default;border-top-color:var(--ink3)">' +
      '<div class="nrr-acct-stat-lbl">ราคาสินค้า</div>' +
      '<div class="num nrr-acct-stat-val" style="color:var(--ink3)">—</div>' +
      '<div class="nrr-acct-stat-sub">รอข้อมูลราคาปิดเดือน</div>' +
      '</div>';
  } else if (!price.hasCurrentData) {
    // This-month comparison isn't ready, but the 6-month creep signal
    // (nrrAccountPriceImpact) doesn't depend on the current month at all
    // — still worth a clickable cell instead of burying it until the
    // month-end batch lands.
    priceCell = '<button type="button" class="nrr-acct-stat-cell" data-stat="price" style="border-top-color:var(--sun-deep)">' +
      '<div class="nrr-acct-stat-lbl">ราคาสินค้า <span>›</span></div>' +
      '<div class="num nrr-acct-stat-val" style="color:var(--ink3)">—</div>' +
      '<div class="nrr-acct-stat-sub">รอข้อมูลเดือนนี้ · ' + price.creeping.length + ' รายการขยับสะสม 6 เดือน</div>' +
      '</button>';
  } else {
    var netColor = price.net >= 0 ? 'var(--green-deep)' : 'var(--coral)';
    priceCell = '<button type="button" class="nrr-acct-stat-cell" data-stat="price" style="border-top-color:' + netColor + '">' +
      '<div class="nrr-acct-stat-lbl">ราคาสินค้า <span>›</span></div>' +
      '<div class="num nrr-acct-stat-val" style="color:' + netColor + '">' + (price.net >= 0 ? '+' : '') + nrrFmtGMVExact(price.net) + '</div>' +
      nrrPriceDivBarHtml(price) +
      '<div class="nrr-acct-stat-sub">▲' + price.upCount + ' ขึ้นราคา · ▼' + price.downCount + ' ลดราคา</div>' +
      '</button>';
  }

  return '<div class="nrr-acct-stat-row">' + aovCell + outletCell + catCell + priceCell + '</div>';
}

// "Before → after" transformation strip — deliberately its own visual
// language (not .nrr-verdict's plain sentence, not the AOV callout's
// icon-in-circle, not the stat row's top-accent cells — user asked for
// something distinct from both when this reverted from prose back to a
// visual, 2026-07-09). No background fill anywhere; the gradient line +
// colored deltas carry it.
// Simplified per feedback (2026-07-09, third pass on this component) —
// Two soft-tint summary blocks (Round 5, 2026-07-09) — a deliberate,
// user-approved exception to the app's "no fills" rule for JUST these two
// headline totals, so the summary reads as distinctly more prominent than
// (and visually separate from) the thin left-border signal rows below.
// Numbers come straight from nrrNetSignalSummary — no math here.
function nrrAccountVerdictHtml(row, kamEmail) {
  var net = nrrNetSignalSummary(row.account_id, kamEmail);
  if (!net.gainCount && !net.riskCount) return '';
  var blocks = '';
  if (net.gainCount) blocks += '<div class="nrr-acct-net-block up">' +
    '<div class="nrr-acct-net-hd"><span class="nrr-acct-net-tri">▲</span>โอกาสได้เพิ่ม</div>' +
    '<div class="num nrr-acct-net-amt">+' + nrrFmtGMVExact(net.gainAmount) + '</div>' +
    '<div class="nrr-acct-net-sub">' + net.gainCount + ' สัญญาณบวก</div></div>';
  if (net.riskCount) blocks += '<div class="nrr-acct-net-block down">' +
    '<div class="nrr-acct-net-hd"><span class="nrr-acct-net-tri">▼</span>เสี่ยงเสีย</div>' +
    '<div class="num nrr-acct-net-amt">−' + nrrFmtGMVExact(net.riskAmount) + '</div>' +
    '<div class="nrr-acct-net-sub">' + net.riskCount + ' ต้องดูแล</div></div>';
  return '<div class="nrr-acct-net">' + blocks + '</div>';
}

function nrrAccountSignalRowHtml(kind, item, accountId) {
  // Every row shares one visual grammar regardless of kind, so the two
  // lists read the same way: name → colored badge (the one number/state
  // that matters most) → muted secondary stats → a right-aligned ฿
  // headline. Left border color repeats the badge color as a down-the-
  // list scan cue (same motif as Portfolio's .nrr-acct-row pace border).
  var name = item.name, badge, meta, amt, unit, border;
  if (kind === 'new') {
    badge = 'ใหม่'; meta = 'เพิ่งเริ่มสั่งเดือนนี้';
    amt = nrrFmtGMVExact(item.gmv); unit = 'MTD'; border = 'var(--green)';
  } else if (kind === 'growing') {
    badge = '+' + Math.round(item.chgPct * 100) + '%'; meta = 'จากเดือนก่อน · คาดเต็มเดือน';
    amt = '+' + nrrFmtGMVExact(item.projInc); unit = ''; border = 'var(--green)';
  } else {
    badge = kind === 'gone' ? 'เลยรอบ ' + item.daysLate + ' วันแล้ว' : 'เพิ่งเลยรอบ ' + item.daysLate + ' วัน';
    meta = 'ทุก ~' + Math.round(item.avgInterval) + ' วัน' + (item.lastOrderDate ? ' · ล่าสุด ' + nrrEsc(item.lastOrderDate) : '');
    amt = nrrFmtGMVExact(item.monthlyGmv); unit = '/เดือน'; border = kind === 'gone' ? 'var(--coral)' : 'var(--sun)';
  }
  var amtColor = (kind === 'new' || kind === 'growing') ? 'var(--green-deep)' : 'var(--ink)';
  return '<button type="button" class="nrr-acct-sig-row ' + kind + '" style="border-left-color:' + border + '" data-item="' + nrrEsc(item.item_id) + '" data-account="' + nrrEsc(accountId) + '">' +
    '<div class="nrr-acct-sig-main">' +
    '<div class="nrr-acct-sig-name">' + nrrEsc(name) + '</div>' +
    '<div class="nrr-acct-sig-line2"><span class="nrr-acct-sig-badge ' + kind + '">' + nrrEsc(badge) + '</span><span class="nrr-acct-sig-meta">' + meta + '</span></div>' +
    '</div>' +
    '<div class="nrr-acct-sig-right"><span class="num nrr-acct-sig-amt" style="color:' + amtColor + '">' + amt + '</span>' + (unit ? '<span class="nrr-acct-sig-unit">' + unit + '</span>' : '') + '</div>' +
    '<span class="nrr-acct-sig-chev">›</span>' +
    '</button>';
}

function nrrAccountSignalListsHtml(row, kamEmail) {
  var pos = nrrSkuPositiveSignals(row.account_id, kamEmail);
  var risk = nrrSkuCycleSignals(row.account_id, kamEmail);
  var posItems = pos.new.map(function (i) { return { kind: 'new', item: i }; })
    .concat(pos.growing.map(function (i) { return { kind: 'growing', item: i }; }));
  posItems.sort(function (a, b) {
    var av = a.kind === 'new' ? a.item.gmv : a.item.projInc, bv = b.kind === 'new' ? b.item.gmv : b.item.projInc;
    return bv - av;
  });

  var posCap = nrrAccountState.showAllPos ? posItems.length : 8;
  var riskCap = nrrAccountState.showAllRisk ? risk.length : 8;
  var posShown = posItems.slice(0, posCap);
  var riskShown = risk.slice(0, riskCap);

  function listHtml(items, mapFn) {
    return items.length ? items.map(mapFn).join('') : '<div class="ds-empty"><div class="ds-empty-title">ไม่มีรายการ</div></div>';
  }

  return '<div class="nrr-acct-signal-cols">' +
    '<div class="nrr-acct-signal-col">' +
    '<div class="nrr-panel-head" style="margin-bottom:8px"><div class="h2 nrr-acct-signal-title pos" style="font-size:16px">สัญญาณบวกเดือนนี้</div><div class="micro">' + posItems.length + ' รายการ</div></div>' +
    listHtml(posShown, function (x) { return nrrAccountSignalRowHtml(x.kind, x.item, row.account_id); }) +
    (posItems.length > posCap ? '<button type="button" class="btn-secondary nrr-acct-showall" data-list="pos" style="margin-top:10px">ดูทั้งหมด (' + posItems.length + ')</button>' : '') +
    '</div>' +
    '<div class="nrr-acct-signal-col">' +
    '<div class="nrr-panel-head" style="margin-bottom:8px"><div class="h2 nrr-acct-signal-title watch" style="font-size:16px">ต้องดูแล</div><div class="micro">' + risk.length + ' รายการ</div></div>' +
    listHtml(riskShown, function (x) { return nrrAccountSignalRowHtml(x.cls, x, row.account_id); }) +
    (risk.length > riskCap ? '<button type="button" class="btn-secondary nrr-acct-showall" data-list="risk" style="margin-top:10px">ดูทั้งหมด (' + risk.length + ')</button>' : '') +
    '</div>' +
    '</div>';
}

// ── Slideover content builders — reuse #nrr-slideover exactly as the
// commission drawer does (hide search/chips, own body div) ─────────────
function nrrOpenAccountStatDrawer(key, row, kamEmail) {
  document.getElementById('nrr-slideover-search').parentElement.style.display = 'none';
  document.getElementById('nrr-slideover-chips').parentElement.style.display = 'none';
  var title = '', html = '';
  if (key === 'aov') {
    var aov = nrrAccountAov(row.account_id);
    title = 'AOV — ระดับและแนวโน้ม';
    html = nrrAovDrawerHtml(aov);
  } else if (key === 'outlet') {
    var outlet = nrrOutletMovement(row.account_id);
    title = outlet.total + ' สาขา — ' + outlet.counts.steady + ' ปกติ · ' + outlet.counts.new + ' ใหม่ · ' + outlet.counts.quiet + ' เงียบ';
    html = nrrOutletDrawerHtml(outlet);
  } else if (key === 'category') {
    var cat = nrrAccountCategoryCoverage(row.account_id, kamEmail);
    title = 'ซื้ออยู่ ' + cat.boughtCount + '/' + cat.total + ' หมวดของ Freshket';
    html = nrrCategoryDrawerHtml(cat);
  } else if (key === 'price') {
    var price = nrrAccountPriceImpact(row.account_id, kamEmail);
    title = (price && !price.hasCurrentData)
      ? 'แนวโน้มราคาสะสม (รอข้อมูลปิดเดือนนี้)'
      : 'ผลกระทบราคาสุทธิ ' + (price && price.net >= 0 ? '+' : '') + (price ? nrrFmtGMVExact(price.net) : '—');
    html = nrrPriceDrawerHtml(price);
  }
  document.getElementById('nrr-slideover-title').textContent = title;
  document.getElementById('nrr-slideover-sub').textContent = '';
  document.getElementById('nrr-slideover-body').innerHTML = '<div class="nrr-comm-ds">' + html + '</div>';
  document.getElementById('nrr-slideover-backdrop').classList.add('on');
  document.getElementById('nrr-slideover').classList.add('on');
}

function nrrAovDrawerHtml(aov) {
  function bandRow(range, label, color, active) {
    return '<div class="ds-stat-row"' + (active ? ' style="font-weight:700"' : '') + '><span class="ds-stat-label">' + range + '</span><span class="ds-stat-value" style="color:' + color + '">' + label + '</span></div>';
  }
  // This callout carries two independent axes at once — the absolute
  // tier (band, threshold-based) and the recent direction (trendPct,
  // 3-month movement) — which is exactly why it earns its own look
  // instead of the generic .nrr-verdict wash every other drawer uses:
  // a great-tier account can still be trending down, and that's worth
  // seeing as its own signal, not flattened into one line of prose.
  var callout = '';
  if (aov.trendPct != null) {
    var up = aov.trendPct >= 0;
    callout = '<div class="nrr-acct-aov-callout ' + aov.band.cls + '">' +
      '<span class="nrr-acct-aov-arrow ' + (up ? 'up' : 'down') + '">' + (up ? '▲' : '▼') + '</span>' +
      '<div class="nrr-acct-aov-callout-body">' +
      '<div class="num nrr-acct-aov-callout-pct">' + Math.abs(aov.trendPct) + '%</div>' +
      '<div class="nrr-acct-aov-callout-label">AOV ' + (up ? 'กำลังโตขึ้น' : 'กำลังลดลง') + 'ใน 3 เดือน — อยู่ในเกณฑ์ <b>' + nrrEsc(aov.band.label) + '</b></div>' +
      '</div></div>';
  }
  // History — MTD first (bold), then every closed month we have (most
  // recent first), matching the hero trend chart's window instead of
  // just "this month vs last month".
  var histRows = aov.months.slice(-6).slice().reverse();
  var history = '<div class="ds-row" style="font-weight:700"><span class="ds-row-name">เดือนนี้ (MTD)</span><span class="ds-row-meta">' + (aov.ordersThisMonth || 0) + ' ออเดอร์</span><span class="ds-row-value" style="color:' + aov.band.color + '">' + (aov.current != null ? nrrFmtGMVExact(aov.current) : '—') + '</span></div>' +
    histRows.map(function (m) {
      return '<div class="ds-row"><span class="ds-row-name">' + nrrEsc(m.month) + '</span><span class="ds-row-meta">' + (m.orders || 0) + ' ออเดอร์</span><span class="ds-row-value">' + (m.aov != null ? nrrFmtGMVExact(m.aov) : '—') + '</span></div>';
    }).join('');

  return callout +
    bandRow('&lt; ฿1,500', 'ควรดู', 'var(--coral)', aov.band.cls === 'low') +
    bandRow('฿1,500–3,000', 'ปานกลาง', 'var(--sun-deep)', aov.band.cls === 'mid') +
    bandRow('฿3,000–5,000', 'ดี', 'var(--green)', aov.band.cls === 'good') +
    bandRow('&gt; ฿5,000', 'ดีมาก', 'var(--green-deep)', aov.band.cls === 'great') +
    '<div style="margin-top:14px">' + history + '</div>';
}

function nrrOutletDrawerHtml(outlet) {
  if (!outlet.total) return '<div class="ds-empty"><div class="ds-empty-title">ไม่มีข้อมูลสาขา</div></div>';
  var quietList = outlet.outlets.filter(function (o) { return o.status === 'quiet' || o.cycle === 'gone'; });
  var verdict = quietList.length ? '<div class="nrr-verdict">' + quietList.length + ' สาขาเงียบไป แต่ยอดรวมอาจยังดูปกติเพราะสาขาอื่นชดเชยไว้</div>' : '';
  return verdict + outlet.outlets.map(function (o) {
    var badge = o.status === 'new' ? '<span style="color:var(--sun-deep);font-size:11px;font-weight:700;flex-shrink:0">ใหม่</span>'
      : (o.status === 'quiet' || o.cycle === 'gone') ? '<span style="color:var(--coral);font-size:11px;font-weight:700;flex-shrink:0">เงียบ</span>'
      : o.cycle === 'near' ? '<span style="color:var(--sun-deep);font-size:11px;font-weight:700;flex-shrink:0">เฝ้าดู</span>' : '';
    return '<div class="ds-row"><span class="ds-row-name">' + nrrEsc(o.outlet_name) + '</span>' +
      '<span class="ds-row-meta">' + (o.lastOrderDate ? 'ล่าสุด ' + nrrEsc(o.lastOrderDate) : '') + '</span>' + badge +
      '<span class="ds-row-value">' + nrrFmtGMVExact(o.gmv) + '</span></div>';
  }).join('');
}

function nrrCategoryDrawerHtml(cat) {
  var gapCount = cat.total - cat.boughtCount;
  var verdict = gapCount ? '<div class="nrr-verdict">เหลือ ' + gapCount + ' หมวดที่ยังไม่เคยซื้อ — โอกาสเปิดคุยตอนไปเยี่ยม</div>' : '';
  return verdict + cat.categories.map(function (c) {
    return '<div class="nrr-acct-catfull-row">' +
      '<div class="nrr-acct-catfull-top"><span class="nrr-acct-catfull-sw" style="background:' + c.color + ';opacity:' + (c.bought ? '1' : '.3') + '"></span>' +
      '<span style="flex:1;font-weight:' + (c.bought ? '600' : '500') + ';color:' + (c.bought ? 'var(--ink)' : 'var(--ink3)') + '">' + nrrEsc(c.name) + '</span>' +
      '<span class="num" style="font-size:11.5px;color:var(--ink2)">' + (c.bought ? nrrFmtGMVExact(c.gmv) + ' · ' + c.skuCount + ' SKU · ' + c.pct + '%' : 'ยังไม่เคยซื้อ') + '</span></div>' +
      '<div class="nrr-acct-catfull-track"><div class="nrr-acct-catfull-fill" style="width:' + c.pct + '%;background:' + c.color + '"></div></div></div>';
  }).join('');
}

// Each row is a native <details> accordion (same pattern as the commission
// drawer's TL/admin rows, nrr_view.js:1783-1794) — click to expand a
// 6-month price chart for that SKU inline, no JS click handler needed.
function nrrPriceRowHtml(name, metaHtml, valueHtml, valueColor, history) {
  return '<details class="nrr-price-row-group">' +
    '<summary class="ds-row hover">' +
    '<span class="ds-chev">›</span>' +
    '<span class="ds-row-name">' + nrrEsc(name) + '</span>' +
    '<span class="ds-row-meta">' + metaHtml + '</span>' +
    '<span class="ds-row-value" style="color:' + valueColor + '">' + valueHtml + '</span>' +
    '</summary>' +
    '<div class="ds-row-detail">' + nrrSkuPriceHistorySvg(history) + '</div>' +
    '</details>';
}
function nrrPriceDrawerHtml(price) {
  if (!price) return '<div class="ds-empty"><div class="ds-empty-title">กำลังโหลดข้อมูลราคา...</div></div>';
  var hasCreep = price.creeping && price.creeping.length > 0;
  if (!price.upCount && !price.downCount && !hasCreep) return '<div class="ds-empty"><div class="ds-empty-title">ไม่มีการเปลี่ยนราคาที่มีนัยสำคัญเดือนนี้</div></div>';

  var rows = price.up.concat(price.down);
  var mainHtml = rows.map(function (e) {
    return nrrPriceRowHtml(
      e.name,
      (e.pctChange >= 0 ? 'ขึ้นราคา ' : 'ลดราคา ') + Math.abs(Math.round(e.pctChange * 10) / 10) + '%',
      (e.impact >= 0 ? '+' : '') + nrrFmtGMVExact(e.impact),
      e.impact >= 0 ? 'var(--green-deep)' : 'var(--coral)',
      e.history
    );
  }).join('');

  // Cumulative 6-month creep — a distinct signal from the up/down list
  // above (see nrrAccountPriceImpact): items that never crossed the ≥1%
  // single-month threshold, but have drifted ≥3% over the full window.
  var creepHtml = '';
  if (hasCreep) {
    creepHtml = '<div class="nrr-comm-drawer-section" style="margin-top:22px">' +
      '<div class="ds-section-hd"><span class="ds-eyebrow">ราคาสะสมขึ้น/ลงต่อเนื่อง (6 เดือน)</span></div>' +
      '<div class="micro" style="margin-bottom:6px;color:var(--ink3)">ไม่มีเดือนไหนขยับแรงพอให้สังเกตเห็นเดี่ยวๆ แต่สะสมหลายเดือนแล้วขยับจริง</div>' +
      price.creeping.map(function (e) {
        return nrrPriceRowHtml(
          e.name,
          'ย้อนหลัง ' + e.history.length + ' เดือน',
          (e.cumPct >= 0 ? '+' : '') + Math.round(e.cumPct * 10) / 10 + '%',
          e.cumPct >= 0 ? 'var(--green-deep)' : 'var(--coral)',
          e.history
        );
      }).join('') + '</div>';
  }

  return '<div class="nrr-verdict">ยอดโตส่วนหนึ่งอาจมาจากราคา ไม่ใช่ปริมาณอย่างเดียว — เช็คให้ชัดก่อนสรุปว่าร้านนี้โตจริง</div>' +
    mainHtml + creepHtml;
}

// ── Floating per-outlet tooltip (SKU signal rows) ────────────────────────
function nrrOpenAccountOutletTip(btn) {
  var itemId = btn.dataset.item, accountId = btn.dataset.account;
  var rows = nrrSkuOutletBreakdown(accountId, itemId, nrrAccountState.kamEmail);
  var otip = document.getElementById('nrr-otip');
  if (!otip) return;
  if (!rows || !rows.length) {
    otip.innerHTML = '<div class="nrr-otip-head">สั่งที่สาขาไหนบ้าง</div><div class="micro" style="padding:4px 14px 10px">ไม่มีข้อมูลรายสาขา</div>';
  } else {
    otip.innerHTML = '<div class="nrr-otip-head">สั่งที่สาขาไหนบ้าง (เดือนนี้)</div>' +
      rows.slice().sort(function (a, b) { return b.this_month_gmv - a.this_month_gmv; }).map(function (r) {
        var zero = r.this_month_orders === 0;
        return '<div class="nrr-otip-row"><span class="n">' + nrrEsc(r.outlet_name) + '</span><span class="v' + (zero ? ' zero' : '') + '">' + (zero ? 'ยังไม่สั่ง' : nrrFmtGMVExact(r.this_month_gmv)) + '</span></div>';
      }).join('');
  }
  var r = btn.getBoundingClientRect();
  var top = r.bottom + 6;
  if (top + 260 > window.innerHeight) top = Math.max(8, r.top - 6 - Math.min(260, otip.scrollHeight || 200));
  var left = Math.min(Math.max(8, r.left - 200), window.innerWidth - 296);
  otip.style.top = top + 'px';
  otip.style.left = left + 'px';
  otip.classList.add('on');
  document.getElementById('nrr-otip-backdrop').classList.add('on');
}
function nrrCloseAccountOutletTip() {
  var otip = document.getElementById('nrr-otip');
  if (otip) otip.classList.remove('on');
  var b = document.getElementById('nrr-otip-backdrop');
  if (b) b.classList.remove('on');
}

// Delegated on #nrr-account-body (bound once in nrrInitApp) — the router
// replaces this container's innerHTML on every render, so listeners must
// live on the persistent parent, same pattern as Portfolio's handlers.
function nrrHandleAccountBodyClick(e) {
  var trendCol = e.target.closest('.nrr-acct-trend-col');
  if (trendCol) { nrrSelectAccountTrendMonth(parseInt(trendCol.dataset.i, 10)); return; }
  var statCell = e.target.closest('.nrr-acct-stat-cell[data-stat]');
  if (statCell) {
    var row = _nrrPortviewRowFor(nrrAccountState.accountId);
    if (row) nrrOpenAccountStatDrawer(statCell.dataset.stat, row, nrrAccountState.kamEmail);
    return;
  }
  var sigRow = e.target.closest('.nrr-acct-sig-row[data-item]');
  if (sigRow) { nrrOpenAccountOutletTip(sigRow); return; }
  var showAllBtn = e.target.closest('.nrr-acct-showall');
  if (showAllBtn) {
    if (showAllBtn.dataset.list === 'pos') nrrAccountState.showAllPos = true;
    else nrrAccountState.showAllRisk = true;
    var row2 = _nrrPortviewRowFor(nrrAccountState.accountId);
    var container = document.querySelector('.nrr-acct-signal-cols');
    if (container && row2) container.outerHTML = nrrAccountSignalListsHtml(row2, nrrAccountState.kamEmail);
  }
}
window.nrrInitApp = nrrInitApp;

async function nrrRefresh(force) {
  var status = document.getElementById('nrr-sync-status');
  if (status) status.textContent = 'กำลังโหลดข้อมูล...';
  try {
    await nrrFetchQnrrCsv(force);
    await Promise.all([nrrFetchPmCsv(force), nrrFetchAdminCsv(force), nrrFetchVpCsv(force), nrrFetchCompanyCsv(force), nrrFetchSalesPipelineCsv(force)]);
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
    '    <a href="#nrr-sec-company" data-sec="nrr-sec-company" id="nrr-subnav-company" hidden>บริษัท</a>' +
    '    <a href="#nrr-sec-sales" data-sec="nrr-sec-sales" id="nrr-subnav-sales" hidden>Sales</a>' +
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
    // Company overview + Sales segments (admin-only; unhidden in their render
    // fns) — hidden default keeps TL views untouched.
    '  <div class="nrr-section" id="nrr-sec-company" style="animation-delay:.04s" hidden><div class="nrr-panel-body" id="nrr-company-body"></div></div>' +
    '  <div class="nrr-section" id="nrr-sec-sales" style="animation-delay:.05s" hidden><div class="nrr-panel-body" id="nrr-sales-body"></div></div>' +
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
    '</div>' +
    // Floating per-outlet tooltip (Account view, Phase C) — sibling of the
    // main containers, position:fixed, same reasoning as #nrr-slideover
    // itself: a floating overlay must never be a descendant of anything
    // that could clip it (see nrr_account.js port notes / plan doc — this
    // exact bug bit the design mockup).
    '<div class="nrr-otip-backdrop" id="nrr-otip-backdrop"></div>' +
    '<div class="float nrr-otip" id="nrr-otip"></div>';
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
  nrrRenderCompanySection();
  nrrRenderSalesSection();
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

// ── Company Overview + Sales sections (admin-only) ───────────────────────
// Whole-company GMV by segment from company_gmv.csv (sql/company_gmv.sql),
// mirroring the "Target & Plan 2H 2026" sheet: B2C · squad Chain · squad
// SA/MC, each squad broken into Sales/KAM/PM/Admin sub-rows. Raw actuals
// (no ×30 normalization) so numbers reconcile with the sheet/DWH directly.
// KAM GMV → squad via tl_email → squad_params (Supabase, TL_BUCKET_MAP
// fallback); PM/Admin/Sales → squad via account_type bucket; see
// nrrCompanyModel() in nrr_aggregate.js. Actuals only this round — targets
// / %Ach deferred until head-of-squad commission is built in the Cockpit.

function _nrrCompanyStaleBannerHtml(cd) {
  if (!cd || !cd.isStale) return '';
  return '<div class="nrr-stale-banner">⚠️ company_gmv.csv มีข้อมูลถึงเดือน ' + nrrEsc(cd.maxMonthKey || '—') +
    ' แต่เดือนปัจจุบันคือ ' + nrrEsc(cd.currMonthKey || '—') +
    ' — ไฟล์ยังไม่ได้ re-run/upload ใหม่ ตัวเลขด้านล่างไม่ใช่ข้อมูลล่าสุด</div>';
}

// Day-of-month of the lag-1 anchor — for the "MTD (ถึงวันที่ N)" chip.
function _nrrCompanyMtdDay() {
  var d = new Date(); d.setDate(d.getDate() - 1);
  return d.getDate();
}

// Chain vs SA/MC trend — grouped bars, fixed categorical colors (validated:
// #c56a2c/#1295a8 pass lightness/chroma/CVD/contrast in both light & dark —
// see dataviz skill palette validator), legend + <title> tooltips + a
// selective direct label on the current month only (never one per bar).
function _nrrCompanyTrendSvg(months, labels, byMonth) {
  if (!months.length) return '';
  var chainColor = '#c56a2c', samcColor = '#1295a8';
  var vals = [];
  months.forEach(function (k) { vals.push(byMonth[k].squads.chain.total, byMonth[k].squads.sa_mc.total); });
  var mx = Math.max.apply(null, vals) || 1;
  var groupW = 46, barW = 16, gap = 3, padL = 6, padR = 6, padT = 22, padB = 22;
  var W = padL + padR + months.length * groupW, H = 130, cH = H - padT - padB;
  var bars = '', xLabels = '';
  months.forEach(function (k, i) {
    var gx = padL + i * groupW;
    var m = byMonth[k];
    var chainH = (m.squads.chain.total / mx) * cH;
    var samcH = (m.squads.sa_mc.total / mx) * cH;
    var isLast = i === months.length - 1;
    var x1 = gx + (groupW - (barW * 2 + gap)) / 2;
    var x2 = x1 + barW + gap;
    bars +=
      '<rect x="' + x1 + '" y="' + (padT + cH - chainH) + '" width="' + barW + '" height="' + Math.max(chainH, 1) + '" rx="2.5" fill="' + chainColor + '"><title>Chain ' + nrrEsc(labels[k]) + ': ' + nrrFmtGMVExact(m.squads.chain.total) + '</title></rect>' +
      '<rect x="' + x2 + '" y="' + (padT + cH - samcH) + '" width="' + barW + '" height="' + Math.max(samcH, 1) + '" rx="2.5" fill="' + samcColor + '"><title>SA/MC ' + nrrEsc(labels[k]) + ': ' + nrrFmtGMVExact(m.squads.sa_mc.total) + '</title></rect>' +
      (isLast ? '<text x="' + (x1 + barW / 2) + '" y="' + (padT + cH - chainH - 5) + '" font-size="9" fill="' + chainColor + '" text-anchor="middle" font-weight="700">' + nrrFmtGMV(m.squads.chain.total) + '</text>' +
                '<text x="' + (x2 + barW / 2) + '" y="' + (padT + cH - samcH - 5) + '" font-size="9" fill="' + samcColor + '" text-anchor="middle" font-weight="700">' + nrrFmtGMV(m.squads.sa_mc.total) + '</text>' : '');
    xLabels += '<text x="' + (gx + groupW / 2) + '" y="' + (H - 6) + '" font-size="9" fill="var(--ink3)" text-anchor="middle">' + nrrEsc((labels[k] || k).split(' ')[0]) + '</text>';
  });
  return '<div style="margin-top:14px">' +
    '<div style="display:flex;gap:16px;align-items:center;font-size:12px;color:var(--ink2);margin-bottom:2px">' +
    '<span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' + chainColor + ';margin-right:5px"></span>Chain</span>' +
    '<span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' + samcColor + ';margin-right:5px"></span>SA/MC</span>' +
    '</div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="xMinYMid meet">' + bars + xLabels + '</svg>' +
    '</div>';
}

function _nrrCompanyFilterChipsHtml() {
  var monthOpts = [[3, '3 เดือน'], [6, '6 เดือน'], [0, 'ทั้งหมด']];
  var squadOpts = [['all', 'ทั้งหมด'], ['chain', 'Chain'], ['sa_mc', 'SA/MC']];
  return '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0 4px">' +
    '<div class="seg" id="nrr-company-months-seg">' + monthOpts.map(function (o) {
      return '<button' + (nrrState.companyMonths === o[0] ? ' class="on"' : '') + ' data-months="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div>' +
    '<div class="seg" id="nrr-company-squad-seg">' + squadOpts.map(function (o) {
      return '<button' + (nrrState.companySquadFocus === o[0] ? ' class="on"' : '') + ' data-squad="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div>' +
    '</div>';
}

function nrrRenderCompanySection() {
  var sec = document.getElementById('nrr-sec-company');
  var body = document.getElementById('nrr-company-body');
  var pill = document.getElementById('nrr-subnav-company');
  if (!sec || !body) return;
  if (nrrProfile.role !== 'admin') { sec.hidden = true; if (pill) pill.hidden = true; return; }
  sec.hidden = false; if (pill) pill.hidden = false;

  var cd = window.bulkCompanyData;
  var head = '<div class="nrr-panel-head"><div class="h2">ภาพรวมบริษัท — GMV ทุก Segment</div></div>';
  if (cd && cd.notFound) {
    body.innerHTML = head + '<div class="micro" style="margin-top:8px">ยังไม่มีข้อมูล — ไฟล์ company_gmv.csv ยังไม่ถูกอัปโหลดไป R2 (รัน sql/company_gmv.sql ใน BigQuery แล้วอัปโหลดก่อน)</div>';
    return;
  }
  var model = nrrCompanyModel();
  if (!model || !model.months.length) {
    body.innerHTML = head + '<div class="micro" style="margin-top:8px">ยังไม่มีข้อมูล company_gmv.csv' + (cd && cd.error ? ' (โหลดไม่สำเร็จ: ' + nrrEsc(cd.error) + ')' : '') + '</div>';
    return;
  }

  var allMonths = model.months;
  var win = nrrState.companyMonths || allMonths.length;
  var months = win > 0 ? allMonths.slice(-win) : allMonths;
  var lastKey = months[months.length - 1];
  var isMtd = cd && cd.currMonthKey && lastKey === cd.currMonthKey;
  var lastM = model.by_month[lastKey];
  var mtdChip = isMtd ? ' <span class="micro">(MTD ถึงวันที่ ' + _nrrCompanyMtdDay() + ')</span>' : '';
  var focus = nrrState.companySquadFocus; // 'all' | 'chain' | 'sa_mc'

  // KPI tiles — latest month (respect squad focus: show that squad's own
  // Sales/KAM/PM/Admin split instead of the 4-way company split)
  var tiles;
  if (focus === 'all') {
    tiles = [['Total GMV', lastM.total], ['B2C', lastM.b2c.gmv],
             ['Squad Chain', lastM.squads.chain.total], ['Squad SA/MC', lastM.squads.sa_mc.total]];
  } else {
    var sq = lastM.squads[focus];
    tiles = [['รวม Squad', sq.total], ['Sales', sq.sales], ['KAM', sq.kam], ['PM', sq.pm], ['Admin', sq.admin]];
  }
  var tilesHtml = '<div class="nrr-kpi-grid" style="grid-template-columns:repeat(' + tiles.length + ',1fr)">' +
    tiles.map(function (t) {
      return '<div class="nrr-kpi-tile">' +
        '<div class="nrr-kpi-value num">' + nrrFmtGMV(t[1]) + '</div>' +
        '<div class="nrr-kpi-label">' + t[0] + (isMtd ? ' — MTD' : '') + '</div>' +
        '</div>';
    }).join('') + '</div>';

  var trendHtml = focus === 'all' ? _nrrCompanyTrendSvg(months, model.labels, model.by_month) : '';

  // Sheet-mirror table: rows × months
  function rowHtml(label, getter, opts) {
    opts = opts || {};
    var cells = months.map(function (k) {
      var v = getter(model.by_month[k]);
      return '<td class="num" style="text-align:right">' + (v ? nrrFmtGMVExact(v) : '—') + '</td>';
    }).join('');
    var style = (opts.bold ? 'font-weight:600;' : '') + (opts.indent ? 'padding-left:22px;' : '');
    return '<tr' + (opts.topline ? ' style="border-top:1px solid var(--nrr-hairline,#e3e3e3)"' : '') + '>' +
      '<td style="' + style + 'white-space:nowrap">' + label + '</td>' + cells + '</tr>';
  }
  var headCells = months.map(function (k) {
    var isCur = isMtd && k === lastKey;
    return '<th style="text-align:right;white-space:nowrap">' + nrrEsc(model.labels[k] || k) + (isCur ? mtdChip : '') + '</th>';
  }).join('');
  var hasUnassigned = months.some(function (k) { return model.by_month[k].unassigned > 0; });

  var rows;
  if (focus === 'all') {
    rows =
      rowHtml('B2C', function (m) { return m.b2c.gmv; }) +
      rowHtml('Squad Chain', function (m) { return m.squads.chain.total; }, { bold: true, topline: true }) +
      rowHtml('Sales', function (m) { return m.squads.chain.sales; }, { indent: true }) +
      rowHtml('KAM', function (m) { return m.squads.chain.kam; }, { indent: true }) +
      rowHtml('PM', function (m) { return m.squads.chain.pm; }, { indent: true }) +
      rowHtml('Admin', function (m) { return m.squads.chain.admin; }, { indent: true }) +
      rowHtml('Squad SA/MC', function (m) { return m.squads.sa_mc.total; }, { bold: true, topline: true }) +
      rowHtml('Sales', function (m) { return m.squads.sa_mc.sales; }, { indent: true }) +
      rowHtml('KAM', function (m) { return m.squads.sa_mc.kam; }, { indent: true }) +
      rowHtml('PM', function (m) { return m.squads.sa_mc.pm; }, { indent: true }) +
      rowHtml('Admin', function (m) { return m.squads.sa_mc.admin; }, { indent: true }) +
      (hasUnassigned ? rowHtml('ยังไม่จัดกลุ่ม (other/unassigned)', function (m) { return m.unassigned; }, { topline: true }) : '') +
      rowHtml('Total GMV', function (m) { return m.total; }, { bold: true, topline: true });
  } else {
    var sqLabel = focus === 'chain' ? 'Chain' : 'SA/MC';
    rows =
      rowHtml('Sales', function (m) { return m.squads[focus].sales; }) +
      rowHtml('KAM', function (m) { return m.squads[focus].kam; }) +
      rowHtml('PM', function (m) { return m.squads[focus].pm; }) +
      rowHtml('Admin', function (m) { return m.squads[focus].admin; }) +
      rowHtml('รวม Squad ' + sqLabel, function (m) { return m.squads[focus].total; }, { bold: true, topline: true });
  }

  body.innerHTML = head + _nrrCompanyStaleBannerHtml(cd) + _nrrCompanyFilterChipsHtml() + tilesHtml + trendHtml +
    '<div style="margin-top:18px;overflow-x:auto">' +
    '<table class="nrr-table"><thead><tr><th>Segment</th>' + headCells + '</tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>' +
    '<div class="micro" style="margin-top:10px">' +
    'ยอดจริงจาก DWH (gmv_ex_vat, ไม่ normalize) · KAM แบ่ง squad ตามพอร์ตของ TL (squad_params ใน Supabase) — ' +
    'ไม่ใช่ตาม account_type ของร้าน (ยกเว้นร้านที่หา KAM เจ้าของไม่เจอในทะเบียน จะแบ่งตาม account_type แทน) · ' +
    'Sales/PM/Admin แบ่งตาม account_type ตรงๆ · ' +
    'B2C = account_type Consumer/Enduser · เดือนปัจจุบันเป็น MTD (ข้อมูลช้ากว่าจริง 1 วัน)' +
    '</div>';

  body.querySelectorAll('#nrr-company-months-seg button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      nrrState.companyMonths = parseInt(btn.dataset.months, 10);
      nrrRenderCompanySection();
    });
  });
  body.querySelectorAll('#nrr-company-squad-seg button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      nrrState.companySquadFocus = btn.dataset.squad;
      nrrRenderCompanySection();
    });
  });
}

// ── Sales section: actuals-by-account_type + handover pipeline forecast ──
// The pipeline forecast answers the Sales lead's actual question: "how much
// of what's in my hands right now will roll off (get handed to KAM/PM/
// Admin) in the coming months, and is anything overdue?" — built from
// sales_handover_pipeline.csv's new_user_exp_date (the 45-day SA / 90-day
// MC-Chain handover deadline, already computed upstream) via
// nrrSalesPipelineModel(). Color = urgency (status), never identity alone —
// each chip is labeled in text, not color-only.
var PIPELINE_BUCKET_META = {
  overdue:        { label: 'เลยกำหนดแล้ว', color: 'var(--coral)',    soft: 'var(--coral-soft)' },
  this_month:     { label: 'เดือนนี้',      color: 'var(--sun-deep)', soft: 'var(--sun-soft)' },
  next_month:     { label: 'เดือนหน้า',     color: 'var(--sun-deep)', soft: 'var(--sun-soft)' },
  plus2:          { label: '+2 เดือน',      color: 'var(--ink2)',     soft: 'var(--fill)' },
  plus3_or_later: { label: '+3 เดือนขึ้นไป', color: 'var(--ink2)',     soft: 'var(--fill)' },
  no_date:        { label: 'ไม่มีกำหนด',    color: 'var(--ink3)',     soft: 'var(--fill)' }
};

function _nrrPipelineDetailRowsHtml(rows) {
  if (!rows.length) return '<div class="micro" style="padding:8px 0">ไม่มีร้านในกลุ่มนี้</div>';
  var today = new Date(); today.setHours(0, 0, 0, 0);
  return '<div style="overflow-x:auto;margin-top:8px">' +
    '<table class="nrr-table"><thead><tr><th>ร้านค้า</th><th>Account Type</th><th>วันครบกำหนด</th><th style="text-align:right">GMV เดือนล่าสุด</th></tr></thead><tbody>' +
    rows.slice(0, 50).map(function (r) {
      var dTxt = '—', dExtra = '';
      if (r.new_user_exp_date) {
        var d = new Date(r.new_user_exp_date + 'T00:00:00');
        if (!isNaN(d.getTime())) {
          dTxt = r.new_user_exp_date;
          var days = Math.round((d - today) / 86400000);
          dExtra = days < 0 ? ' <span style="color:var(--coral)">(เลย ' + Math.abs(days) + ' วัน)</span>' : days === 0 ? ' (วันนี้)' : ' (อีก ' + days + ' วัน)';
        }
      }
      return '<tr><td>' + nrrEsc(r.account_name || r.account_id || '—') + '</td>' +
        '<td>' + nrrEsc(r.account_type || '—') + '</td>' +
        '<td>' + dTxt + dExtra + '</td>' +
        '<td class="num" style="text-align:right">' + nrrFmtGMVExact(r.last_month_gmv) + '</td></tr>';
    }).join('') +
    '</tbody></table>' +
    (rows.length > 50 ? '<div class="micro" style="margin-top:6px">แสดง 50 จาก ' + rows.length + ' ร้าน</div>' : '') +
    '</div>';
}

function _nrrRenderPipelineForecastHtml(pm) {
  if (!pm) return '';
  var chipsHtml = pm.order.map(function (key) {
    var b = pm.buckets[key], meta = PIPELINE_BUCKET_META[key];
    var isOpen = nrrState.pipelineExpandedBucket === key;
    return '<button class="nrr-pipeline-chip" data-bucket="' + key + '" style="border-color:' + meta.color + ';background:' + (isOpen ? meta.soft : 'transparent') + '">' +
      '<div style="font-size:11px;color:' + meta.color + ';font-weight:600">' + meta.label + '</div>' +
      '<div class="num" style="font-size:16px;font-weight:700;margin-top:2px">' + nrrFmtGMV(b.gmv) + '</div>' +
      '<div class="micro">' + b.outlets + ' ร้าน</div>' +
      '</button>';
  }).join('');

  var expandedKey = nrrState.pipelineExpandedBucket;
  var detailHtml = '';
  if (expandedKey && pm.buckets[expandedKey]) {
    detailHtml = '<div style="margin-top:4px">' +
      '<div class="h2" style="font-size:13px">รายละเอียด — ' + PIPELINE_BUCKET_META[expandedKey].label + '</div>' +
      _nrrPipelineDetailRowsHtml(pm.buckets[expandedKey].rows) +
      '</div>';
  }

  return '<div style="margin-top:22px;padding-top:16px;border-top:1px solid var(--nrr-hairline,#e3e3e3)">' +
    '<div class="nrr-panel-head"><div class="h2">Pipeline การส่งต่อ (Handover Forecast)</div></div>' +
    '<div class="micro" style="margin-bottom:10px">ร้านที่อยู่ในมือ Sales ตอนนี้ ' + nrrFmtGMVExact(pm.total) + ' — จะทยอยโอนออกไปเดือนไหนบ้าง (SA 45 วัน / MC-Chain 90 วัน นับจากคำสั่งซื้อแรก) กดที่การ์ดเพื่อดูรายชื่อร้าน</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px">' + chipsHtml + '</div>' +
    detailHtml +
    '</div>';
}

function nrrRenderSalesSection() {
  var sec = document.getElementById('nrr-sec-sales');
  var body = document.getElementById('nrr-sales-body');
  var pill = document.getElementById('nrr-subnav-sales');
  if (!sec || !body) return;
  if (nrrProfile.role !== 'admin') { sec.hidden = true; if (pill) pill.hidden = true; return; }
  sec.hidden = false; if (pill) pill.hidden = false;

  var cd = window.bulkCompanyData;
  var head = '<div class="nrr-panel-head"><div class="h2">Sales — ลูกค้าใหม่ (commercial_owner = SALE)</div></div>';
  if (cd && cd.notFound) {
    body.innerHTML = head + '<div class="micro" style="margin-top:8px">ยังไม่มีข้อมูล — ไฟล์ company_gmv.csv ยังไม่ถูกอัปโหลดไป R2</div>';
    return;
  }
  var model = nrrSalesByBucket();
  if (!model || !model.months.length) {
    body.innerHTML = head + '<div class="micro" style="margin-top:8px">ยังไม่มีข้อมูล Sales ใน company_gmv.csv</div>';
    return;
  }

  var months = model.months;
  var lastKey = months[months.length - 1];
  var isMtd = cd && cd.currMonthKey && lastKey === cd.currMonthKey;
  var mtdChip = isMtd ? ' <span class="micro">(MTD ถึงวันที่ ' + _nrrCompanyMtdDay() + ')</span>' : '';
  var headCells = months.map(function (k) {
    var isCur = isMtd && k === lastKey;
    return '<th style="text-align:right;white-space:nowrap">' + nrrEsc(model.labels[k] || k) + (isCur ? mtdChip : '') + '</th>';
  }).join('');
  function rowHtml(label, key, opts) {
    opts = opts || {};
    var cells = months.map(function (k) {
      var v = model.by_month[k][key];
      return '<td class="num" style="text-align:right">' + (v ? nrrFmtGMVExact(v) : '—') + '</td>';
    }).join('');
    return '<tr' + (opts.topline ? ' style="border-top:1px solid var(--nrr-hairline,#e3e3e3)"' : '') + '>' +
      '<td style="' + (opts.bold ? 'font-weight:600;' : '') + 'white-space:nowrap">' + label + '</td>' + cells + '</tr>';
  }
  var hasOther = months.some(function (k) { return model.by_month[k].other > 0; });

  var pd = window.bulkSalesPipelineData;
  var pm = nrrSalesPipelineModel();
  var pipelineHtml = pd && pd.notFound
    ? '<div class="micro" style="margin-top:16px">Pipeline forecast: ยังไม่มีข้อมูล — ไฟล์ sales_handover_pipeline.csv ยังไม่ถูกอัปโหลดไป R2 (รัน sql/sales_handover_pipeline.sql ใน BigQuery แล้วอัปโหลดก่อน)</div>'
    : _nrrRenderPipelineForecastHtml(pm);

  body.innerHTML = head + _nrrCompanyStaleBannerHtml(cd) +
    '<div style="overflow-x:auto">' +
    '<table class="nrr-table"><thead><tr><th>Account Type</th>' + headCells + '</tr></thead>' +
    '<tbody>' +
    rowHtml('Chain', 'chain') +
    rowHtml('SA/MC', 'sa_mc') +
    (hasOther ? rowHtml('อื่นๆ', 'other') : '') +
    rowHtml('รวม Sales', 'total', { bold: true, topline: true }) +
    '</tbody></table></div>' +
    '<div class="micro" style="margin-top:10px">' +
    'ยอดซื้อลูกค้าใหม่จาก DWH order ที่ commercial_owner = SALE ตรงๆ (ไม่มี NRR concept) · ' +
    'แบ่งตาม account_type ของร้าน · เดือนปัจจุบันเป็น MTD (ข้อมูลช้ากว่าจริง 1 วัน)' +
    '</div>' +
    pipelineHtml;

  body.querySelectorAll('.nrr-pipeline-chip').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.dataset.bucket;
      nrrState.pipelineExpandedBucket = nrrState.pipelineExpandedBucket === key ? null : key;
      nrrRenderSalesSection();
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
// v16: progress bar ONLY. The hit/bonus/miss chip lives exclusively in the
// drawer's tier block: a row already carries %NRR in the page's threshold
// color, so a chip repeating the same state on every row was pure noise
// (the "everything shouts at once" problem the user flagged).
function nrrCommTierMiniHtml(role, email, period, pct) {
  if (pct == null) return '';
  var t = nrrCommTierTable(role, email, period, pct);
  return '<span class="nrr-comm-tier-mini" style="flex:none;margin-top:2px">' + nrrCommProgressHtml(t, pct) + '</span>';
}

// ── Receipt renderer — one line per formula term, four fixed columns:
// [chevron 16px][operator 20px][label, left][amount, right]. The operator
// (+/×/=) is its own column so labels start at the same x on every line
// (v16 — fixes the v15 bug where flex space-between floated labels to the
// center). Lines with a drillKey AND matching content in sectionsByKey
// render as <details>; that includes 'multiply' lines (TL's team-upsell
// multiplier expands to the per-KAM contributions that produced it).
function _nrrReceiptCells(op, labelHtml, valueHtml, hasChevron) {
  return '<span class="nrr-rcpt-chev">' + (hasChevron ? '›' : '') + '</span>' +
    '<span class="nrr-rcpt-op">' + op + '</span>' +
    '<span class="nrr-rcpt-label">' + labelHtml + '</span>' +
    '<span class="nrr-rcpt-amt num">' + valueHtml + '</span>';
}
function nrrCommReceiptHtml(steps, sectionsByKey) {
  sectionsByKey = sectionsByKey || {};
  var rowsHtml = steps.map(function (s) {
    var op = s.kind === 'multiply' ? '×' : (s.first || s.kind === 'subtotal' || s.kind === 'total') ? '' : '+';
    var metaHtml = s.meta ? ' <span class="nrr-rcpt-meta">' + nrrEsc(s.meta) + '</span>' : '';
    var valueHtml = s.kind === 'multiply' ? '×' + Number(s.factor).toFixed(2) : nrrFmtGMVExact(s.amount);
    var body = s.drillKey ? sectionsByKey[s.drillKey] : null;
    var lineCls = s.kind === 'multiply' ? ' op' : s.kind === 'subtotal' ? ' subtotal' : s.kind === 'total' ? ' total' : '';
    var rule = s.kind === 'subtotal' ? '<div class="nrr-comm-receipt-rule"></div>'
      : s.kind === 'total' ? '<div class="nrr-comm-receipt-rule total"></div>' : '';
    // Per-component color cue (Round 5) — component lines (drillKey set)
    // get a data-comm-type attr driving a colored left accent; subtotal/
    // multiply/total lines stay neutral (no drillKey → no attr).
    var typeAttr = (s.drillKey && s.drillKey !== 'mult') ? ' data-comm-type="' + s.drillKey + '"' : '';
    if (body) {
      return rule + '<details class="nrr-comm-receipt-line expandable' + lineCls + '"' + typeAttr + '><summary>' +
        _nrrReceiptCells(op, nrrEsc(s.label) + metaHtml, valueHtml, true) +
        '</summary><div class="nrr-comm-receipt-detail">' + body + '</div></details>';
    }
    return rule + '<div class="nrr-comm-receipt-line' + lineCls + '"' + typeAttr + '>' +
      _nrrReceiptCells(op, nrrEsc(s.label) + metaHtml, valueHtml, false) + '</div>';
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

// STAMP FREQUENCY RULE (v16, twin of the full table's exception-based
// stamps): when every row in a set shares one lock status, say it ONCE at
// the section header; a per-row stamp appears only on rows that DIFFER.
// Returns { uniform: status|null, headerStamp, rowStamp(status) }.
function nrrCommStatusPlan(statuses) {
  var uniform = statuses.length && statuses.every(function (s) { return s === statuses[0]; }) ? statuses[0] : null;
  return {
    uniform: uniform,
    headerStamp: uniform ? ' ' + nrrCommStampHtml(uniform, true) : '',
    rowStamp: function (status) { return uniform ? '' : ' ' + nrrCommStampHtml(status, true); }
  };
}

// Drill body for the TL multiplier line — which KAM's upsell pushed the
// team multiplier (tl_upsell_base per KAM from sense_upsell_team.csv).
function nrrCommTeamMultDrillHtml(tlEmail) {
  var kams = nrrListKamsForTeam(tlEmail);
  if (!kams.length || !nrrUpsellTeamCache.loaded) return null;
  var rows = kams.map(function (k) {
    var row = nrrUpsellTeamCache.byEmail[(k.email || '').toLowerCase()];
    return { name: k.name, base: row ? row.tl_upsell_base : 0 };
  }).sort(function (a, b) { return b.base - a.base; });
  return rows.map(function (r) {
    return '<div class="ds-row"><span class="ds-row-name">' + nrrEsc(r.name) + '</span>' +
      '<span class="ds-row-meta">' + nrrFmtGMVExact(r.base) + '</span></div>';
  }).join('');
}

function nrrCommissionRowsHtml(isAdmin, rows, period) {
  // Pass 1 — resolve each row's data so the stamp plan can see all statuses.
  var resolved = rows.map(function (r) {
    var snap = nrrLatestSnapshotFor(r.email);
    if (snap) {
      return { r: r, snap: snap, status: snap.snapshot_status,
        nrrPct: snap.governed_nrr_pct != null ? snap.governed_nrr_pct : snap.raw_nrr_pct,
        payoutAmt: Number(snap.payout_amount || 0),
        metaLabel: QNRR_CFG.months_th[snap.period_month] || snap.period_month,
        bd: snap.breakdown || null, est: null };
    }
    var result = r.kind === 'tl' ? nrrTeamResult(r.email) : nrrKamResult(r.email);
    var bm = result && period ? result.by_month[period] : null;
    var est = nrrCommEstimateFor(r.email, r.kind, period);
    return { r: r, snap: null, status: 'estimate',
      nrrPct: bm ? bm.nrr_pct : null, payoutAmt: est ? est.est : 0,
      metaLabel: QNRR_CFG.months_th[period] || period, bd: null, est: est };
  });
  var plan = nrrCommStatusPlan(resolved.map(function (x) { return x.status; }));

  var rowsHtml = resolved.map(function (x) {
    var r = x.r;
    // KAM rows open the full drawer directly on click (no inline expand) —
    // the drilldown is the whole point for a KAM (upsell/handover/outlet
    // detail), so skip the intermediate expand step (and skip computing
    // detailHtml below entirely, since a kam row never renders it).
    // TL/admin-team rows keep <details> because expanding shows the team
    // receipt + the nested per-KAM list in place. (2026-07-09)
    if (r.kind === 'kam') {
      return '<button type="button" class="ds-row hover nrr-comm-kam-drill nrr-comm-drill-btn" ' +
        'data-email="' + nrrEsc(r.email) + '" data-name="' + nrrEsc(r.name) + '" data-period="' + nrrEsc(period) + '">' +
        '<span class="ds-chev" style="transform:none">›</span>' +
        '<span style="display:flex;flex-direction:column;min-width:0;flex:1;gap:2px;text-align:left">' +
        '<span class="ds-row-name" style="flex:none">' + nrrEsc(r.name) + '</span>' +
        '<span class="ds-row-meta" style="flex:none"><span class="num" style="color:' + nrrThresholdColorVar(x.nrrPct) + '">' + (x.nrrPct != null ? x.nrrPct + '%' : '—') + '</span> NRR · ' + nrrEsc(x.metaLabel) + plan.rowStamp(x.status) + '</span>' +
        nrrCommTierMiniHtml(r.kind, r.email, period, x.nrrPct) +
        '</span>' +
        '<span class="ds-row-value" style="color:' + (x.snap ? 'var(--green-deep)' : 'var(--sun-deep)') + '">' + nrrFmtGMVExact(x.payoutAmt) + '</span>' +
        '</button>';
    }
    // TL detail = the TL receipt (same visual language as the KAM drawer),
    // multiplier line expands to per-KAM upsell contributions.
    var steps = x.bd ? nrrCommSnapshotReceiptSteps(x.bd) : nrrCommEstimateReceiptSteps(x.est);
    var multBody = nrrCommTeamMultDrillHtml(r.email);
    var detailHtml = steps.length
      ? nrrCommReceiptHtml(steps, multBody ? { mult: multBody } : {})
      : '<div class="ds-stat-row"><span class="ds-stat-label">ยังไม่มีข้อมูลเพียงพอ</span></div>';
    if (isAdmin) detailHtml += nrrCommissionTeamKamsHtml(r.email, period);
    return '<details class="nrr-comm-row-group">' +
      '<summary class="ds-row hover">' +
      '<span class="ds-chev">›</span>' +
      '<span style="display:flex;flex-direction:column;min-width:0;flex:1;gap:2px">' +
      '<span class="ds-row-name" style="flex:none">' + nrrEsc(r.name) + '</span>' +
      '<span class="ds-row-meta" style="flex:none"><span class="num" style="color:' + nrrThresholdColorVar(x.nrrPct) + '">' + (x.nrrPct != null ? x.nrrPct + '%' : '—') + '</span> NRR · ' + nrrEsc(x.metaLabel) + plan.rowStamp(x.status) + '</span>' +
      nrrCommTierMiniHtml(r.kind, r.email, period, x.nrrPct) +
      '</span>' +
      '<span class="ds-row-value" style="color:' + (x.snap ? 'var(--green-deep)' : 'var(--sun-deep)') + '">' + nrrFmtGMVExact(x.payoutAmt) + '</span>' +
      '</summary>' +
      '<div class="ds-row-detail">' + detailHtml + '</div>' +
      '</details>';
  }).join('');

  return '<div class="nrr-comm-drawer-section"><div class="ds-section-hd"><span class="ds-eyebrow">' +
    (isAdmin ? 'รายทีม' : 'รายบุคคล (KAM)') + plan.headerStamp + '</span></div>' + rowsHtml + '</div>';
}

// Per-KAM rows nested inside an admin team row — same snapshot-first,
// estimate-fallback logic as the top-level rows, one line per KAM with a
// drill-through button into the full outlet-level drawer.
function nrrCommissionTeamKamsHtml(tlEmail, period) {
  var kams = nrrListKamsForTeam(tlEmail);
  if (!kams.length) return '';
  var resolved = kams.map(function (k) {
    var snap = nrrLatestSnapshotFor(k.email);
    if (snap) {
      return { k: k, status: snap.snapshot_status, amt: Number(snap.payout_amount || 0), snap: snap,
        pct: snap.governed_nrr_pct != null ? snap.governed_nrr_pct : snap.raw_nrr_pct };
    }
    var est = nrrCommEstimateFor(k.email, 'kam', period);
    return { k: k, status: 'estimate', amt: est ? est.est : 0, snap: null, pct: est ? est.pct : null };
  });
  var plan = nrrCommStatusPlan(resolved.map(function (x) { return x.status; }));
  var rows = resolved.map(function (x) {
    // Whole row opens the drawer (2026-07-09) — was a div + separate
    // "ดูรายละเอียด →" button; now a single clickable row for a bigger hit
    // target, same .nrr-comm-drill-btn handler.
    return '<button type="button" class="nrr-comm-kam-row nrr-comm-drill-btn" data-email="' + nrrEsc(x.k.email) + '" data-name="' + nrrEsc(x.k.name) + '" data-period="' + nrrEsc(period) + '">' +
      '<span style="display:flex;flex-direction:column;gap:3px;min-width:0;text-align:left">' +
      '<span class="ds-stat-label">' + nrrEsc(x.k.name) +
      (x.pct != null ? ' · <span class="num" style="color:' + nrrThresholdColorVar(x.pct) + '">' + x.pct + '%</span>' : '') +
      plan.rowStamp(x.status) + '</span>' +
      nrrCommTierMiniHtml('kam', x.k.email, period, x.pct) +
      '</span>' +
      '<span class="nrr-comm-kam-row-right">' +
      '<span class="num" style="color:' + (x.snap ? 'var(--ink)' : 'var(--sun-deep)') + '">' + nrrFmtGMVExact(x.amt) + '</span>' +
      '<span class="ds-chev" style="transform:none">›</span>' +
      '</span></button>';
  }).join('');
  return '<div class="ds-section-hd" style="margin-top:14px"><span class="ds-eyebrow">KAM ในทีม' + plan.headerStamp + '</span></div>' + rows;
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

// Assembles the hero+tier+receipt HTML for one KAM/period — the exact same
// bundle the drawer and the Portfolio self-summary (Phase B) both render,
// so a rep's own view and a TL/Admin's drill-down of that same person are
// pixel-for-pixel identical (the whole point of Phase A's "reuse, don't
// reimplement" design). p1ElId/p3ElId let each caller give the async upsell
// section its own DOM ids (drawer vs. portfolio body render at the same
// time in different callers, so they can't share one hardcoded id).
function nrrCommReceiptBundle(kamEmail, period, p1ElId, p3ElId) {
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

  // The receipt — one line per formula term (NRR / P1 / P3 / Expansion /
  // Gate / Handover — never a missing term), each expandable into its own
  // account/group list. Locked and unlocked periods use the same renderer
  // against two shape-identical step sources.
  var steps = bd ? nrrCommSnapshotReceiptSteps(bd) : nrrCommEstimateReceiptSteps(est);
  var outletsForKam = nrrOutletsForKam(kamEmail, period);
  var nrrOutlets = outletsForKam.filter(function (o) { return ['core_nrr', 'comeback', 'transfer_in'].indexOf(o.movement) > -1; });
  var expOutlets = outletsForKam.filter(function (o) { return o.movement === 'expansion'; });
  var handoverDetail = (bd && bd.handover && bd.handover.detail) || (est && est.handover && est.handover.detail) || [];
  var skel = '<div class="ds-skel" style="margin-bottom:8px"></div><div class="ds-skel" style="width:65%"></div>';
  var p1p3Note = '<div class="nrr-rcpt-note">นับเฉพาะร้านนอกกลุ่ม Expansion — ร้านขยายได้ 0.5% ในบรรทัด Expansion</div>';
  var sectionsByKey = {
    nrr: nrrCommOutletListHtml(nrrOutlets, 'ยังไม่มีร้านในหมวดนี้เดือนนี้'),
    p1: p1p3Note + '<div id="' + p1ElId + '">' + skel + '</div>',
    p3: p1p3Note + '<div id="' + p3ElId + '">' + skel + '</div>',
    expansion: nrrCommOutletListHtml(expOutlets, 'ไม่มีร้านขยายใหม่เดือนนี้', 0.005),
    handover: nrrCommHandoverListHtml(handoverDetail)
  };
  var expansionOutletIds = new Set(expOutlets.map(function (o) { return String(o.row.outlet_id); }));
  return {
    html: heroHtml + tierHtml + nrrCommReceiptHtml(steps, sectionsByKey),
    expansionOutletIds: expansionOutletIds,
    bd: bd
  };
}

function nrrRenderCommissionDrawerBody(kamEmail, period) {
  var el = document.getElementById('nrr-comm-drawer-body');
  if (!el) return;
  var bundle = nrrCommReceiptBundle(kamEmail, period, 'nrr-comm-drawer-p1-body', 'nrr-comm-drawer-p3-body');
  el.innerHTML = bundle.html;
  nrrLoadCommissionUpsellSection(kamEmail, bundle.expansionOutletIds, bundle.bd);
}

// guardFn(email) -> bool: is this fetch still relevant to render? Defaults
// to the drawer's own stale-guard (nrrCommDrawerState) — callers rendering
// somewhere other than the drawer (Portfolio, Phase B) pass their own ids
// + guard so a KAM switch mid-fetch can't paint the wrong person's numbers.
function nrrLoadCommissionUpsellSection(kamEmail, expansionOutletIds, bd, p1ElId, p3ElId, guardFn) {
  p1ElId = p1ElId || 'nrr-comm-drawer-p1-body';
  p3ElId = p3ElId || 'nrr-comm-drawer-p3-body';
  guardFn = guardFn || function (email) { return nrrCommDrawerState && nrrCommDrawerState.kamEmail === email; };
  nrrFetchUpsellBundle(kamEmail).then(function (bundle) {
    if (!guardFn(kamEmail)) return;
    var p1Target = document.getElementById(p1ElId);
    var p3Target = document.getElementById(p3ElId);
    if (!p1Target && !p3Target) return;
    if (!bundle.loaded) {
      var failHtml = '<div class="ds-empty"><div class="ds-empty-title">โหลดไม่สำเร็จ</div>' +
        '<div class="ds-empty-desc">ไม่สามารถโหลดข้อมูล upsell ได้ในขณะนี้</div>' +
        '<button type="button" class="ds-btn ds-btn-ghost nrr-comm-retry-upsell-btn" data-email="' + nrrEsc(kamEmail) + '">ลองใหม่</button></div>';
      if (p1Target) p1Target.innerHTML = failHtml;
      if (p3Target) p3Target.innerHTML = '<div class="ds-empty"><div class="ds-empty-title">โหลดไม่สำเร็จ</div></div>';
      return;
    }
    var upsell = nrrComputeUpsellSku(expansionOutletIds, bundle, QNRR_CFG.base_month);
    var lists = nrrCommUpsellListsHtml(upsell, bd);
    if (p1Target) p1Target.innerHTML = lists.p1;
    if (p3Target) p3Target.innerHTML = lists.p3;
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

// Group lists for the two upsell receipt lines — {p1, p3} html, filled
// into their own drill targets once the per-KAM CSV resolves.
function nrrCommUpsellListsHtml(upsell, bd) {
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
    reconHtml = '<div class="nrr-comm-recon-note">ผลรวมนี้คำนวณจากอัตราปัจจุบันใน target_settings — อาจไม่ตรงกับยอดที่ล็อกไว้ (' + nrrFmtGMVExact(snapTotal) + ') เป๊ะ ถ้า Cockpit เปลี่ยนอัตราไปหลังจากงวดนี้ถูกคำนวณ</div>';
  }
  return { p1: p1Html + reconHtml, p3: p3Html };
}

// ── Scrollspy sub-nav ────────────────────────────────────────────────────
var _nrrSpy = null;
function nrrInitScrollspy() {
  if (_nrrSpy) _nrrSpy.disconnect();
  var links = document.querySelectorAll('#nrr-subnav a');
  var map = { 'nrr-sec-pulse': 'nrr-sec-pulse', 'nrr-sec-company': 'nrr-sec-company', 'nrr-sec-sales': 'nrr-sec-sales', 'nrr-sec-teams': 'nrr-sec-pulse', 'nrr-sec-movement': 'nrr-sec-movement', 'nrr-sec-kams': 'nrr-sec-movement', 'nrr-sec-pm': 'nrr-sec-pm', 'nrr-sec-admin': 'nrr-sec-admin', 'nrr-sec-commission': 'nrr-sec-admin' };
  _nrrSpy = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var target = map[en.target.id];
      if (!target) return;
      links.forEach(function (a) { a.classList.toggle('on', a.dataset.sec === target); });
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  // hidden sections never intersect, so observing them unconditionally is
  // safe for roles that can't see company/sales
  ['nrr-sec-pulse', 'nrr-sec-company', 'nrr-sec-sales', 'nrr-sec-teams', 'nrr-sec-movement', 'nrr-sec-kams', 'nrr-sec-pm', 'nrr-sec-admin', 'nrr-sec-commission'].forEach(function (id) {
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
  var negative = mv === 'core_nrr_churn' || mv === 'transfer_out';
  _nrrOpenSlideover({
    mode: 'movement', title: label + ' · ' + (QNRR_CFG.months_th[month] || month),
    sub: outlets.length + ' ร้าน',
    outlets: outlets, period: month, showKam: !!showKam, showKamChips: false, showMvChips: false,
    negative: negative
  });
  nrrLoadNotesFor(outlets, month);
  // Churn/transfer_out rows show last-order-date (nrrAccountLastOrderDate,
  // sourced from bulk_outlets.csv) — lazy global fetch, same fire-then-
  // rerender shape as nrrLoadNotesFor above. Gated on `negative` since only
  // that row branch consumes the date — no point fetching 3.1MB for
  // "New"/"Expansion" drawer opens.
  if (negative && !window.bulkOutletsData.loaded) {
    nrrFetchBulkOutletsCsv().then(function () { nrrRenderSlideoverBody(); });
  }
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
