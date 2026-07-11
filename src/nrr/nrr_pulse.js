// ── nrr_pulse.js — "Portfolio Pulse" morning-briefing / TV-signage view ───
// A glanceable, self-refreshing board (route #/pulse, admin-only) meant for a
// lobby TV: who came in (new stores, from Sales vs Expansion), what's landing
// (new SKUs), what's slipping (accounts going quiet / dropping) — portfolio-
// wide, as of yesterday (day-1 lag). Deliberately a "signage" look (big type,
// saturated color blocks) — a scoped exception to /nrr's usual hairline/no-fill
// house style, because this has to read across a room.
//
// Data: reuses globals already loaded by the dashboard/portfolio flows —
// bulkQnrrData (Expansion movement, day-level first_dollar_date),
// bulkSalesPipelineData (genuinely new Sales customers — see the "จาก Sales"
// comment below for why kam_rep_view.csv can't be used for this),
// bulkPortviewData (account pace, sku counts, churn), bulkHistoryData
// (quarter base-month baseline, via nrrPaceSignal).

var nrrPulseState = { rotIdx: 0, model: null };
var _nrrPulseRotTimer = null;
var _nrrPulseRefreshTimer = null;
var NRR_PULSE_REFRESH_MS = 10 * 60 * 1000; // re-pull + re-render every 10 min
var NRR_PULSE_ROT_MS = 8000;               // rotate spotlight lists every 8s
var NRR_PULSE_ARR_MAX = 5;                 // arrivals shown per block before rotating
// v48: was 6 (one more than every other list) — with the SKU block's caption
// line taking extra vertical space, a mismatched row count made "ต้องดูแล"
// visibly taller/heavier than its neighbor. Matched to 5 for parity.
var NRR_PULSE_RISK_MAX = 5;

var _NRR_PULSE_TH_DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

function _nrrPulsePad(n) { return (n < 10 ? '0' : '') + n; }

// Every owner/KAM name in this codebase follows "FirstName (Nickname)
// LastName" — the signage board only has room for the nickname. Applied at
// render time (not baked into the model) so the full name stays available.
function _nrrPulseNick(fullName) {
  var m = /\(([^)]+)\)/.exec(fullName || '');
  return m ? m[1] : (fullName || '');
}

// v50: owner names were plain gray caption text — too easy to skim past.
// User wants a KAM glancing at the TV to instantly recognize their OWN name
// (their win or their problem to fix) — a uniform bold-gray treatment
// doesn't help THAT specifically, but a consistent per-person color does:
// once a KAM learns "I'm teal," they can spot their own rows across the
// whole board without reading every line. Reuses the app's existing
// 10-hue category palette (--cat-1..10, already validated for on-screen
// distinctiveness) purely for its hue variety — no category meaning implied
// here. Hashed off the NICKNAME so the same person always gets the same
// color every render.
var _NRR_PULSE_OWNER_PALETTE = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)',
  'var(--cat-6)', 'var(--cat-7)', 'var(--cat-8)', 'var(--cat-9)', 'var(--cat-10)'];
function _nrrPulseOwnerColor(nick) {
  var h = 0;
  for (var i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) >>> 0;
  return _NRR_PULSE_OWNER_PALETTE[h % _NRR_PULSE_OWNER_PALETTE.length];
}
// v53: tried a FIXED px slot (100px) so the chip's right edge would still
// line up in a column while its own width kept following the name — right
// idea, wrong number: 100px was a guess, so a short nickname ("To", ~35px)
// left ~65px of unexplained-looking dead space before the chip. v54: instead
// of guessing, MEASURE every nickname actually in this list (via canvas
// text metrics — real pixel widths, not a character-count estimate) and use
// the single longest one as the slot width — so the gap left in front of
// any shorter chip is only ever the true difference to the longest real
// name in that list, never an arbitrary number. Computed ONCE from the
// list's FULL item set (not just the rotating window) so the column width
// never visibly resizes as rotation cycles through different names.
var _nrrPulseMeasureCanvas = null;
function _nrrPulseTextWidth(text, font) {
  if (!_nrrPulseMeasureCanvas) _nrrPulseMeasureCanvas = document.createElement('canvas');
  var ctx = _nrrPulseMeasureCanvas.getContext('2d');
  ctx.font = font || '800 12px -apple-system, "Helvetica Neue", Arial, sans-serif';
  return ctx.measureText(text).width;
}
function _nrrPulseOwnerSlotWidth(items, ownerKey) {
  var maxW = 0;
  (items || []).forEach(function (it) {
    var nick = _nrrPulseNick(it[ownerKey]);
    if (!nick) return;
    var w = _nrrPulseTextWidth(nick);
    if (w > maxW) maxW = w;
  });
  return maxW > 0 ? Math.ceil(maxW) + 22 : 0; // +22 = chip's own left+right padding
}
// Same bug, same fix, one column over: .nrr-pulse-risk-amt-wrap used to be a
// GUESSED fixed width (132px) so the wrap's width wouldn't depend on the
// reason text ("เงียบ" vs "ต่ำกว่าฐาน 45%") and shift the owner chip beside
// it. That stopped the shift, but for any row whose real text is narrower
// than the guess, the right-aligned content leaves dead space on ITS OWN
// left — directly next to the chip — which is exactly what reads as "the
// chip is oddly far from the number." Fix: measure the two real lines
// (amount + reason) actually in this list and use the true longest one,
// same technique as the owner slot above.
function _nrrPulseRiskAmtWidth(items) {
  var maxW = 0;
  (items || []).forEach(function (it) {
    var amtW = _nrrPulseTextWidth('−' + nrrFmtGMV(it.risk), '800 16px "Space Grotesk", -apple-system, "Helvetica Neue", Arial, sans-serif');
    var lblW = _nrrPulseTextWidth(it.reason || '', '700 10.5px -apple-system, "Helvetica Neue", Arial, sans-serif');
    var w = Math.max(amtW, lblW);
    if (w > maxW) maxW = w;
  });
  // +3: canvas measureText() slightly underestimates real rendered width
  // (subpixel/font-metric rounding) — without a small buffer, the widest
  // string in the list clips itself by ~1px and silently ellipsizes.
  return maxW > 0 ? Math.ceil(maxW) + 3 : 0;
}
function _nrrPulseOwnerChip(fullName, slotWidth) {
  var nick = _nrrPulseNick(fullName);
  var chip = nick ? '<span class="nrr-pulse-owner-chip" style="background:' + _nrrPulseOwnerColor(nick) + '">' + nrrEsc(nick) + '</span>' : '';
  return '<span class="nrr-pulse-owner-slot" style="width:' + slotWidth + 'px">' + chip + '</span>';
}

// The data "as of" date = yesterday (day-1 lag convention used app-wide).
function _nrrPulseLagDate() { var d = new Date(); d.setDate(d.getDate() - 1); return d; }
function _nrrPulseIsoDay(d) { return d.getFullYear() + '-' + _nrrPulsePad(d.getMonth() + 1) + '-' + _nrrPulsePad(d.getDate()); }

// Current period (ISO 'YYYY-MM') to read movement rows for: the lag month if
// present in the data, else the latest period_month <= lag month, else the
// latest available. Robust to being run before/after the configured quarter.
function _nrrPulseCurrentPeriod(rows) {
  var lagMonth = _nrrPulseIsoDay(_nrrPulseLagDate()).slice(0, 7);
  var present = {};
  (rows || []).forEach(function (r) { if (r.period_month) present[r.period_month] = 1; });
  var keys = Object.keys(present).sort();
  if (!keys.length) return lagMonth;
  if (present[lagMonth]) return lagMonth;
  var le = keys.filter(function (k) { return k <= lagMonth; });
  return le.length ? le[le.length - 1] : keys[keys.length - 1];
}

// ── Model ────────────────────────────────────────────────────────────────
// Everything the view needs, computed once per render from already-loaded
// globals. Returns null if the core movement data isn't loaded yet.
function nrrPulseModel() {
  var qd = window.bulkQnrrData;
  if (!qd || !qd.loaded || !qd.allRows) return null;
  var lag = _nrrPulseLagDate();
  var yIso = _nrrPulseIsoDay(lag);
  var curPeriod = _nrrPulseCurrentPeriod(qd.allRows);
  var curRows = qd.allRows.filter(function (r) { return r.period_month === curPeriod; });

  // v50: account_id -> its largest-GMV outlet's res_name, so the "ต้องดูแล"
  // block (sourced from portview.csv, which is account-grain and has NO
  // outlet-level name at all) can still show a recognizable branch name to
  // match the Expansion block's look — picks the single biggest outlet as
  // "the" representative branch when an account has more than one.
  var acctBigOutlet = {};
  qd.allRows.forEach(function (r) {
    if (!r.account_id || !r.res_name) return;
    var cur = acctBigOutlet[r.account_id];
    if (!cur || (r.curr_gmv || 0) > cur.gmv) acctBigOutlet[r.account_id] = { name: r.res_name, gmv: r.curr_gmv || 0 };
  });

  // ── New stores this period: "จาก Sales" vs "จาก Expansion" (existing
  // account's new outlet). A row whose first-ever order (first_dollar_date)
  // landed yesterday earns a "today" flag.
  // v46: kam_rep_view.csv carries BOTH the specific outlet/branch name
  // (res_name, short) and the full legal entity name (account_name — often
  // a long multi-company string like "บริษัท ... (มหาชน) ... & บริษัท ...").
  // Primary = res_name (what a KAM actually recognizes at a glance);
  // account_name only shown as a secondary line when it genuinely differs.
  function arrivalItem(r, kind) {
    var isToday = (r.first_dollar_date || '').slice(0, 10) === yIso;
    var primary = r.res_name || r.account_name || r.account_id;
    var secondary = (r.account_name && r.account_name !== primary) ? r.account_name : '';
    return {
      kind: kind,
      name: primary,
      sub: secondary,
      owner: r.latest_staff_owner || r.latest_commercial_owner || '',
      gmv: r.curr_gmv || 0,
      isToday: isToday
    };
  }
  var expRows = curRows.filter(function (r) { return r.movement_type === 'expansion'; });
  var expItems = expRows.map(function (r) { return arrivalItem(r, 'expansion'); })
    .sort(function (a, b) { return b.gmv - a.gmv; });

  // "จาก Sales" — a genuinely NEW customer this period. NOT sourced from
  // bulkQnrrData/kam_rep_view.csv: that file is built with
  // `WHERE latest_commercial_owner = 'KAM'` (q3_2026_movement_rep_view.sql)
  // — it structurally EXCLUDES any account still owned by Sales, by design.
  // Confirmed against real BigQuery (2026-07-11): 97 accounts genuinely had
  // first_dollar_owner='SALE' + first_dollar_date this month, and NONE of
  // them appeared anywhere in kam_rep_view.csv — not staleness, a scope gap.
  // The correct source is sales_handover_pipeline.csv (bulkSalesPipelineData)
  // — the exact complement scope (`WHERE latest_commercial_owner = 'SALE'`),
  // extended in v5 of that SQL with `first_dollar_date`/`mtd_gmv` specifically
  // for this page (v4 only had last-CLOSED-month GMV + a handover deadline
  // that isn't a clean function of first_dollar_date, so neither could
  // answer "arrived this month/today"). Grain there is per OUTLET; group to
  // account since one customer can have multiple outlets.
  var spd = window.bulkSalesPipelineData;
  var salesItems = [];
  if (spd && spd.loaded && spd.allRows) {
    var acctMap = {};
    spd.allRows.forEach(function (r) {
      if (!r.first_dollar_date || r.first_dollar_date.slice(0, 7) !== curPeriod) return;
      var k = r.account_id || r.account_name;
      // v46: sales_handover_pipeline.sql's `account_name` column is itself
      // sourced from `o.res_name` (its `latest_own` CTE) — no separate
      // company-level name is exported here, so there's no secondary line
      // to show (`sub` stays empty); this file already gives the short
      // branch-style name by construction.
      if (!acctMap[k]) acctMap[k] = { name: r.account_name, owner: r.staff_owner, gmv: 0, isToday: false };
      acctMap[k].gmv += r.mtd_gmv || 0;
      if (r.first_dollar_date === yIso) acctMap[k].isToday = true;
    });
    salesItems = Object.keys(acctMap).map(function (k) {
      var it = acctMap[k];
      return { kind: 'sales', name: it.name, sub: '', owner: it.owner, gmv: it.gmv, isToday: it.isToday };
    }).sort(function (a, b) { return b.gmv - a.gmv; });
  }

  var salesGmv = salesItems.reduce(function (s, x) { return s + x.gmv; }, 0);
  var expGmv = expItems.reduce(function (s, x) { return s + x.gmv; }, 0);
  var todayCount = salesItems.filter(function (x) { return x.isToday; }).length
    + expItems.filter(function (x) { return x.isToday; }).length;

  // ── Portfolio momentum + at-risk, from portview + history (nrrPaceSignal) ──
  var pv = window.bulkPortviewData;
  var upside = 0, downside = 0, dangerCount = 0, newSkuAdded = 0;
  var riskItems = [];
  if (pv && pv.loaded && pv.allRows) {
    pv.allRows.forEach(function (row) {
      // new-SKU count (v1: count only, no names — no portfolio-wide SKU source)
      var added = (row.cur_sku_count || 0) - (row.last_month_sku_count || 0);
      if (added > 0) newSkuAdded += added;

      var pace = (typeof nrrPaceSignal === 'function') ? nrrPaceSignal(row) : { pct: null, cls: 'unknown', baseline_gmv: 0 };
      if (pace.pct == null) return; // no baseline (brand-new account) — nothing to compare
      var runrate = row.runrate_gmv || 0, baseline = pace.baseline_gmv || 0;
      if (pace.cls === 'great' || pace.cls === 'safe') {
        upside += Math.max(0, runrate - baseline);
      } else {
        downside += Math.max(0, baseline - runrate);
        // v49: "ต้องดูแล" now requires a drop of MORE than 20% below baseline
        // (pct < 80) — was nrrPaceSignal's own 'danger' band (pct < 90, i.e.
        // >10% drop), which the user found too inclusive/noisy for a "act on
        // this today" TV list. This is a Pulse-page-only threshold — does
        // NOT change nrrPaceSignal itself or anything else in the app that
        // reads pace.cls (e.g. the Account page's own pace coloring).
        if (pace.pct < 80) {
          dangerCount++;
          var shortfall = Math.max(0, baseline - runrate);
          var dropPct = Math.max(0, Math.round(100 - pace.pct));
          var quiet = pace.pct < 50 || (row.churned_gmv || 0) > runrate;
          var acctName = row.account_name || row.account_id;
          var bigOutlet = acctBigOutlet[row.account_id];
          var primaryName = (bigOutlet && bigOutlet.name) || acctName;
          riskItems.push({
            name: primaryName,
            sub: (bigOutlet && bigOutlet.name && bigOutlet.name !== acctName) ? acctName : '',
            kam: row.kam_name || row.kam_email || '',
            risk: shortfall,
            reason: quiet ? 'เงียบ' : 'ต่ำกว่าฐาน ' + dropPct + '%'
          });
        }
      }
    });
  }
  riskItems.sort(function (a, b) { return b.risk - a.risk; });
  // v48: sum across ALL 156 danger-band accounts (riskItems already holds
  // every one, not just the rotating top-N shown) — user asked for the real
  // total ฿ at risk, not just individual row amounts.
  var riskTotal = riskItems.reduce(function (s, x) { return s + x.risk; }, 0);
  var netMomentum = upside - downside;

  // ── New SKUs sold this month — named + ranked (v46) via
  // new_skus_portfolio.csv (sql/new_skus_portfolio.sql), falling back to the
  // v1 bare count (from portview's cur_sku_count - last_month_sku_count) if
  // that CSV hasn't been uploaded yet (404-graceful, same precedent as
  // staff_owner/first_dollar_date before their SQL was rerun).
  var nsd = window.bulkNewSkusPortfolioData;
  var newSkuItems = [], newSkuGmv = 0;
  if (nsd && nsd.loaded && nsd.allRows && nsd.allRows.length) {
    newSkuItems = nsd.allRows.map(function (r) {
      return { name: r.item_name_th || r.item_id, gmv: r.new_gmv, accountCount: r.account_count };
    }).sort(function (a, b) { return b.gmv - a.gmv; });
    newSkuGmv = newSkuItems.reduce(function (s, x) { return s + x.gmv; }, 0);
  }

  return {
    asOf: lag,
    curPeriod: curPeriod,
    curPeriodTh: (QNRR_CFG.months_th && QNRR_CFG.months_th[curPeriod]) || curPeriod,
    newStoreCount: salesItems.length + expItems.length,
    newStoreGmv: salesGmv + expGmv,
    todayCount: todayCount,
    sales: { count: salesItems.length, gmv: salesGmv, items: salesItems },
    expansion: { count: expItems.length, gmv: expGmv, items: expItems },
    newSkuAdded: newSkuAdded,
    newSkuItems: newSkuItems,
    newSkuGmv: newSkuGmv,
    newSkuCount: newSkuItems.length,
    momentum: { net: netMomentum, upside: upside, downside: downside },
    dangerCount: dangerCount,
    riskTotal: riskTotal,
    risk: riskItems,
    portviewReady: !!(pv && pv.loaded)
  };
}
window.nrrPulseModel = nrrPulseModel;

// ── Render ─────────────────────────────────────────────────────────────────
function _nrrPulseDatelineHtml(m) {
  var d = m.asOf;
  var dow = _NRR_PULSE_TH_DOW[d.getDay()];
  var dateTh = nrrThMonthLabel ? (d.getDate() + ' ' + nrrThMonthLabel(d)) : (d.getDate() + '/' + (d.getMonth() + 1));
  var upd = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  var isFs = !!document.fullscreenElement;
  return '<div class="nrr-pulse-dateline">' +
    '<div><div class="nrr-pulse-dateline-main">เช้าวัน' + dow + ' · ' + nrrEsc(dateTh) + '</div>' +
    '<div class="nrr-pulse-dateline-sub">ภาพรวม portfolio · ข้อมูลถึงเมื่อวาน · อัปเดต ' + upd + '</div></div>' +
    '<button type="button" class="nrr-pulse-fs-btn" id="nrr-pulse-fs-btn">' +
    (isFs ? '⤡ ออกจากเต็มจอ' : '⤢ เปิดเต็มจอ (สำหรับจอทีวี)') + '</button>' +
    '</div>';
}

// ── Fullscreen / TV mode ─────────────────────────────────────────────────
// Uses the standard Fullscreen API (a user gesture is required to invoke
// it, hence the button — can't auto-trigger on page load). Hides the app's
// masthead/nav while active so the board is pure signage on the TV, no
// browser chrome or app nav competing for space. Tied to the SAME cleanup
// hook that already clears the rotation/refresh timers on route-away, so
// leaving #/pulse always exits fullscreen too.
function _nrrPulseToggleFullscreen() {
  if (!document.fullscreenElement) {
    (document.documentElement.requestFullscreen() || Promise.resolve()).catch(function () {});
  } else {
    (document.exitFullscreen() || Promise.resolve()).catch(function () {});
  }
}
document.addEventListener('fullscreenchange', function () {
  var isFs = !!document.fullscreenElement;
  document.body.classList.toggle('nrr-pulse-fs-active', isFs);
  var btn = document.getElementById('nrr-pulse-fs-btn');
  if (btn) btn.textContent = isFs ? '⤡ ออกจากเต็มจอ' : '⤢ เปิดเต็มจอ (สำหรับจอทีวี)';
});

function _nrrPulseHeroHtml(m) {
  var net = m.momentum.net;
  var netCls = net >= 0 ? 'up' : 'down';
  var netSign = net >= 0 ? '+' : '−';
  var todayChip = m.todayCount > 0
    ? '<span class="nrr-pulse-today-chip">＋' + m.todayCount + ' วันนี้</span>' : '';
  return '<div class="nrr-pulse-heroes">' +
    // new stores
    '<div class="nrr-pulse-hero green">' +
    '<div class="nrr-pulse-hero-lbl">ร้านใหม่เดือนนี้</div>' +
    '<div class="nrr-pulse-hero-num" data-count="' + m.newStoreCount + '">' + m.newStoreCount + '</div>' +
    '<div class="nrr-pulse-hero-sub">' + nrrFmtGMV(m.newStoreGmv) + ' ' + todayChip + '</div>' +
    '</div>' +
    // net momentum
    '<div class="nrr-pulse-hero ' + netCls + '">' +
    '<div class="nrr-pulse-hero-lbl">โมเมนตัมสุทธิ <span style="opacity:.75;font-weight:600">(คาดการณ์เต็มเดือน)</span></div>' +
    '<div class="nrr-pulse-hero-num">' + netSign + nrrFmtGMV(Math.abs(net)) + '</div>' +
    '<div class="nrr-pulse-hero-sub">▲ ' + nrrFmtGMV(m.momentum.upside) + ' ได้เพิ่ม · ▼ ' + nrrFmtGMV(m.momentum.downside) + ' เสี่ยง</div>' +
    '</div>' +
    // needs attention
    '<div class="nrr-pulse-hero ' + (m.dangerCount > 0 ? 'alert' : 'calm') + '">' +
    '<div class="nrr-pulse-hero-lbl">ต้องตามด่วน</div>' +
    '<div class="nrr-pulse-hero-num" data-count="' + m.dangerCount + '">' + m.dangerCount + '</div>' +
    '<div class="nrr-pulse-hero-sub">ร้านยอดตกต่ำกว่าฐาน หรือเงียบไป</div>' +
    '</div>' +
    '</div>';
}

function _nrrPulseWindow(items, idx, max) {
  if (!items.length || items.length <= max) return items;
  var out = [];
  for (var i = 0; i < max; i++) out.push(items[(idx + i) % items.length]);
  return out;
}

function _nrrPulseArrivalRowsHtml(items, max) {
  if (!items.length) return '<div class="nrr-pulse-empty">— ยังไม่มีเดือนนี้ —</div>';
  // v54: measured once from the FULL list (not the rotating window) so the
  // owner column's width never changes as rotation cycles through names.
  var slotW = _nrrPulseOwnerSlotWidth(items, 'owner');
  return _nrrPulseWindow(items, nrrPulseState.rotIdx, max).map(function (x) {
    // v46: primary = outlet/branch name (x.name), secondary = the full legal
    // entity name ONLY when it genuinely differs (x.sub) — was showing the
    // long combined-entity name as the primary line, which is what made
    // rows like "บริษัท ปตท. ... (มหาชน) ... & บริษัท ..." unreadable on a TV.
    return '<div class="nrr-pulse-arr-row">' +
      (x.isToday ? '<span class="nrr-pulse-today-dot" title="เปิดบิลแรกเมื่อวาน"></span>' : '<span class="nrr-pulse-arr-dot"></span>') +
      '<div class="nrr-pulse-arr-main">' +
      '<div class="nrr-pulse-arr-name">' + nrrEsc(x.name) + '</div>' +
      (x.sub ? '<div class="nrr-pulse-arr-sub">' + nrrEsc(x.sub) + '</div>' : '') +
      '</div>' +
      _nrrPulseOwnerChip(x.owner, slotW) +
      '<div class="nrr-pulse-arr-gmv">' + nrrFmtGMV(x.gmv) + '</div>' +
      '</div>';
  }).join('');
}

// v46: ranked, named new-SKU rows (once new_skus_portfolio.csv is uploaded)
// — reuses the arrival-row layout since it's the same "dot + name + ฿" shape.
function _nrrPulseSkuRowsHtml(items, max) {
  if (!items.length) return '<div class="nrr-pulse-empty">— ไม่มีข้อมูล —</div>';
  return _nrrPulseWindow(items, nrrPulseState.rotIdx, max).map(function (x) {
    return '<div class="nrr-pulse-arr-row">' +
      '<span class="nrr-pulse-arr-dot"></span>' +
      '<div class="nrr-pulse-arr-main"><div class="nrr-pulse-arr-name">' + nrrEsc(x.name) + '</div></div>' +
      '<div class="nrr-pulse-arr-gmv">' + nrrFmtGMV(x.gmv) + '</div>' +
      '</div>';
  }).join('');
}

// v50: rebuilt to match the arrival rows' own layout exactly (same request
// as the Expansion fix) — res_name primary / account_name secondary, owner
// chip on the right. The ฿ figure is the SHORTFALL vs the quarter's fixed
// baseline (baseline − run-rate, never the account's actual MTD spend) —
// was previously labeled with a vague "เสี่ยงเสีย"; now the actual reason
// ("ต่ำกว่าฐาน N%" / "เงียบ") sits directly under the number instead, so the
// number and its cause read together instead of needing a separate legend.
function _nrrPulseRiskRowsHtml(items, max) {
  if (!items.length) return '<div class="nrr-pulse-empty">— ไม่มีร้านที่ต้องตามด่วน —</div>';
  var slotW = _nrrPulseOwnerSlotWidth(items, 'kam');
  var amtW = _nrrPulseRiskAmtWidth(items);
  return _nrrPulseWindow(items, nrrPulseState.rotIdx, max).map(function (x) {
    return '<div class="nrr-pulse-risk-row">' +
      '<div class="nrr-pulse-arr-main">' +
      '<div class="nrr-pulse-arr-name">' + nrrEsc(x.name) + '</div>' +
      (x.sub ? '<div class="nrr-pulse-arr-sub">' + nrrEsc(x.sub) + '</div>' : '') +
      '</div>' +
      _nrrPulseOwnerChip(x.kam, slotW) +
      '<div class="nrr-pulse-risk-amt-wrap" style="width:' + amtW + 'px"><div class="nrr-pulse-risk-amt">−' + nrrFmtGMV(x.risk) + '</div>' +
      '<div class="nrr-pulse-risk-amt-lbl">' + nrrEsc(x.reason) + '</div></div>' +
      '</div>';
  }).join('');
}

// Re-fill only the rotating list containers (called by main render + rotation
// timer) so rotation never rebuilds the whole page.
function _nrrPulseFillLists() {
  var m = nrrPulseState.model;
  if (!m) return;
  var s = document.getElementById('nrr-pulse-sales-list');
  if (s) s.innerHTML = _nrrPulseArrivalRowsHtml(m.sales.items, NRR_PULSE_ARR_MAX);
  var e = document.getElementById('nrr-pulse-exp-list');
  if (e) e.innerHTML = _nrrPulseArrivalRowsHtml(m.expansion.items, NRR_PULSE_ARR_MAX);
  var r = document.getElementById('nrr-pulse-risk-list');
  if (r) r.innerHTML = _nrrPulseRiskRowsHtml(m.risk, NRR_PULSE_RISK_MAX);
  var sk = document.getElementById('nrr-pulse-sku-list');
  if (sk) sk.innerHTML = _nrrPulseSkuRowsHtml(m.newSkuItems, NRR_PULSE_ARR_MAX);
}

function _nrrPulseArrivalsHtml(m) {
  return '<div class="nrr-pulse-arrivals">' +
    '<div class="nrr-pulse-block teal">' +
    '<div class="nrr-pulse-block-head"><span class="nrr-pulse-block-title">มาใหม่ · จาก Sales</span>' +
    '<span class="nrr-pulse-block-tally">' + m.sales.count + ' ร้าน · ' + nrrFmtGMV(m.sales.gmv) + '</span></div>' +
    '<div class="nrr-pulse-list" id="nrr-pulse-sales-list"></div>' +
    '</div>' +
    '<div class="nrr-pulse-block leaf">' +
    '<div class="nrr-pulse-block-head"><span class="nrr-pulse-block-title">มาใหม่ · จาก Expansion</span>' +
    '<span class="nrr-pulse-block-tally">' + m.expansion.count + ' สาขา · ' + nrrFmtGMV(m.expansion.gmv) + '</span></div>' +
    '<div class="nrr-pulse-list" id="nrr-pulse-exp-list"></div>' +
    '</div>' +
    '</div>';
}

function _nrrPulseLowerHtml(m) {
  // v46: named + ranked once new_skus_portfolio.csv is uploaded (sql/
  // new_skus_portfolio.sql); falls back to the v1 bare count otherwise —
  // 404-graceful, same precedent as the Sales fix before its SQL reran.
  // v47: show a real "N SKU" count (not just ฿) + a plain-language caption
  // explaining what "new" means — user asked "how many SKU are new, and
  // what does new even mean, in simple words." Definition, spelled out:
  // an item counts once a SHOP buys it for the first time this month
  // (didn't buy it last month) and spends at least ฿1,000 on it — summed
  // across every shop in the portfolio.
  var skuBlock = m.newSkuItems.length
    ? '<div class="nrr-pulse-block sun">' +
      '<div class="nrr-pulse-block-head"><span class="nrr-pulse-block-title">สินค้าใหม่ที่ขายได้</span>' +
      '<span class="nrr-pulse-block-tally">' + m.newSkuCount + ' SKU · ' + nrrFmtGMV(m.newSkuGmv) + '</span></div>' +
      '<div class="nrr-pulse-block-caption">สินค้าที่ร้านเริ่มซื้อเดือนนี้ — เดือนก่อนไม่เคยซื้อ และซื้อแล้วอย่างน้อย ฿1,000/ร้าน</div>' +
      '<div class="nrr-pulse-list" id="nrr-pulse-sku-list"></div>' +
      '</div>'
    : '<div class="nrr-pulse-block sun compact">' +
      '<div class="nrr-pulse-block-title">สินค้าใหม่ที่ขายได้</div>' +
      '<div class="nrr-pulse-sku-num">＋' + m.newSkuAdded.toLocaleString() + '</div>' +
      '<div class="nrr-pulse-sku-sub">จำนวน SKU ที่ร้านต่างๆ ซื้อเพิ่มเดือนนี้ (นับรวมทั้ง portfolio)</div>' +
      '</div>';
  return '<div class="nrr-pulse-lower">' +
    skuBlock +
    // at-risk list — v48: total ฿ at risk across ALL 156 (not just the
    // rotating rows shown), + a caption defining "ฐาน" so the whole block
    // reads as clearly as the SKU block next to it.
    '<div class="nrr-pulse-block coral">' +
    '<div class="nrr-pulse-block-head"><span class="nrr-pulse-block-title">ต้องดูแล — เงียบ / ยอดตก</span>' +
    '<span class="nrr-pulse-block-tally">' + m.dangerCount + ' ร้าน · −' + nrrFmtGMV(m.riskTotal) + '</span></div>' +
    '<div class="nrr-pulse-block-caption">ยอดวิ่ง (run-rate) ต่ำกว่าฐานไตรมาส (มิ.ย.) หรือหยุดสั่งซื้อไปแล้ว</div>' +
    '<div class="nrr-pulse-list" id="nrr-pulse-risk-list"></div>' +
    '</div>' +
    '</div>';
}

function nrrRenderPulseView() {
  var page = document.getElementById('nrr-pulse-page');
  if (!page) return;
  // Ensure the portfolio-level data this page needs is loaded (dashboard init
  // only fetches movement/company data; portview + history come from the
  // portfolio/account flows). Idempotent + cached — safe to await every entry.
  page.innerHTML = '<div class="nrr-pulse-loading">กำลังโหลดภาพรวม...</div>';
  Promise.all([
    (typeof nrrFetchQnrrCsv === 'function' ? nrrFetchQnrrCsv(false) : Promise.resolve()),
    (typeof nrrFetchPortviewCsv === 'function' ? nrrFetchPortviewCsv(false) : Promise.resolve()),
    (typeof nrrFetchBulkHistoryCsv === 'function' ? nrrFetchBulkHistoryCsv(false) : Promise.resolve()),
    (typeof nrrFetchSalesPipelineCsv === 'function' ? nrrFetchSalesPipelineCsv(false) : Promise.resolve()),
    (typeof nrrFetchNewSkusPortfolioCsv === 'function' ? nrrFetchNewSkusPortfolioCsv(false) : Promise.resolve())
  ]).then(function () {
    if (!nrrCurrentRoute || nrrCurrentRoute.view !== 'pulse') return; // navigated away mid-fetch
    _nrrPulseRender();
    _nrrPulseArmTimers();
  });
}
window.nrrRenderPulseView = nrrRenderPulseView;

function _nrrPulseRender() {
  var page = document.getElementById('nrr-pulse-page');
  if (!page) return;
  var m = nrrPulseModel();
  nrrPulseState.model = m;
  if (!m) {
    page.innerHTML = '<div class="nrr-pulse-loading">ยังไม่มีข้อมูลภาพรวม</div>';
    return;
  }
  page.innerHTML =
    '<div class="nrr-pulseboard">' +
    _nrrPulseDatelineHtml(m) +
    _nrrPulseHeroHtml(m) +
    _nrrPulseArrivalsHtml(m) +
    _nrrPulseLowerHtml(m) +
    '</div>';
  _nrrPulseFillLists();
  // celebratory count-up on the two integer heroes
  page.querySelectorAll('.nrr-pulse-hero-num[data-count]').forEach(function (el) {
    var target = parseInt(el.dataset.count, 10) || 0;
    nrrCountUp(el, target, 800, function (n) { return Math.round(n).toLocaleString(); });
  });
  var fsBtn = document.getElementById('nrr-pulse-fs-btn');
  if (fsBtn) fsBtn.addEventListener('click', _nrrPulseToggleFullscreen);
}

// ── Timers (auto-refresh + spotlight rotation) ──────────────────────────────
// Only run while #/pulse is the active view; self-clear otherwise so nothing
// leaks when the user (or a wall TV kiosk) navigates away.
function _nrrPulseArmTimers() {
  _nrrPulseClearTimers();
  _nrrPulseRotTimer = setInterval(function () {
    if (!nrrCurrentRoute || nrrCurrentRoute.view !== 'pulse') { _nrrPulseClearTimers(); return; }
    nrrPulseState.rotIdx += Math.max(NRR_PULSE_ARR_MAX, NRR_PULSE_RISK_MAX);
    _nrrPulseFillLists();
  }, NRR_PULSE_ROT_MS);
  _nrrPulseRefreshTimer = setInterval(function () {
    if (!nrrCurrentRoute || nrrCurrentRoute.view !== 'pulse') { _nrrPulseClearTimers(); return; }
    Promise.all([
      nrrFetchQnrrCsv(true),
      nrrFetchPortviewCsv(true),
      nrrFetchBulkHistoryCsv(true),
      nrrFetchSalesPipelineCsv(true),
      nrrFetchNewSkusPortfolioCsv(true)
    ]).then(function () {
      if (!nrrCurrentRoute || nrrCurrentRoute.view !== 'pulse') return;
      _nrrPulseRender();
    });
  }, NRR_PULSE_REFRESH_MS);
}
function _nrrPulseClearTimers() {
  if (_nrrPulseRotTimer) { clearInterval(_nrrPulseRotTimer); _nrrPulseRotTimer = null; }
  if (_nrrPulseRefreshTimer) { clearInterval(_nrrPulseRefreshTimer); _nrrPulseRefreshTimer = null; }
  // Leaving #/pulse always exits TV fullscreen too — same cleanup hook.
  if (document.fullscreenElement) (document.exitFullscreen() || Promise.resolve()).catch(function () {});
}

// ── Route registration (nrr_router.js is injected before this module) ────────
nrrRouterRegister('pulse', nrrRenderPulseView);
window.nrrRenderPulseView = nrrRenderPulseView;
