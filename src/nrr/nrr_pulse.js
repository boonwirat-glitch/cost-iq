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

// v65 (major redesign — rotating full-screen SCENES, not a shared page):
// one big idea per glance, cycling automatically — see nrr_pulse.js's own
// header comment update below and the plan doc for the design-thinking
// rationale (a lobby TV read for 2-3s at a time can't absorb ~24 rows of
// simultaneous list content, which the pre-v65 "3 heroes + 4 lists on one
// page" layout required).
var NRR_PULSE_ROT_MS = 8000;                // default: advance to the next scene every 8s
var nrrPulseState = { sceneIdx: 0, rotIdx: 0, model: null, rotMs: NRR_PULSE_ROT_MS, activeScenes: [] };
var _nrrPulseRotTimer = null;
var _nrrPulseRefreshTimer = null;
var _nrrPulseSceneSubTimer = null;   // faster internal list-cycling WHILE a list-heavy scene (skus/risk) is showing
var NRR_PULSE_REFRESH_MS = 10 * 60 * 1000;      // re-pull + re-render every 10 min
var NRR_PULSE_SCENE_SUBROT_MS = 3500;           // internal list re-slice cadence within a scene (faster than full-scene rotation, so more names get airtime before the scene moves on)
// v_signage2 (2026-07-15): unified every rotating-list scene's cap at 5 per
// screen, per explicit user request ("max สุดหน้าละ 5 ร้าน แต่ว่าค่อยๆ หมุนวนไป") —
// was 8 for risk, 3 (no rotation) for wins. All of these now sub-rotate via
// _nrrPulseArmSceneSubRotation, same mechanism SKUs already used.
// v_signage3 (2026-07-15): 5 -> 6 for the two "store" scenes (wins/month) +
// risk. v_signage4 (same day, follow-up): SKU scene also brought to 6 to
// match, per explicit user request -- all four rotating-list scenes now
// share the same cap.
var NRR_PULSE_SCENE_SKU_MAX = 6;    // rows shown at once in the full-screen "new products" scene
var NRR_PULSE_SCENE_RISK_MAX = 6;   // rows shown at once in the full-screen "needs attention" scene
var NRR_PULSE_WINS_SPOTLIGHT_MAX = 6; // "today's wins" scene spotlight cap -- sub-rotates like every other list scene when there are more than 6
var NRR_PULSE_SCENE_MONTH_MAX = 6;  // "new this month" scene spotlight cap (same convention)
// v56: session-only rotation-speed choices (no localStorage — user's explicit
// choice; no /nrr-local persistence precedent existed anyway). [ms, label].
var NRR_PULSE_ROT_CHOICES = [['5000', '5s'], ['8000', '8s'], ['15000', '15s'], ['30000', '30s']];

// v56: 5 rows/block everywhere used to be the ceiling even when fullscreen
// left real leftover vertical space on a real TV — one more row fits fine in
// fullscreen (masthead/nav hidden, page expands to 100vw), but the embedded
// admin-nav view is tighter, so only bump the count while actually fullscreen.
// v_signage7 (2026-07-15): removed the +1 bump. Fullscreen now spends its
// extra room on a whole separate, much larger TYPE SCALE (see the
// .nrr-pulse-fs-active rules in nrr_components.css + the mockup this was
// designed from) rather than one more row at the same small size — at that
// bigger scale there usually isn't room left for baseMax+1 anyway (verified
// by DOM measurement: 6 rows already only clears the 1920×1080 canvas with
// modest margin). Every scene's cap is the same in both tiers now.
function _nrrPulseEffMax(baseMax) {
  return baseMax;
}

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
// v_signage8 (2026-07-16): every prior round (v65, v_signage5/6/7) had to
// re-edit a HARDCODED font string here to stay in sync with whatever the
// CSS currently says .nrr-pulse-owner-chip/.nrr-pulse-risk-amt/etc. are
// sized at -- four rounds of the same forgotten-sync bug is four too many,
// especially now that the fullscreen tier is `clamp()`-based (nrr_components
// .css) and has no single fixed size to hardcode at all. Fixed properly:
// an offscreen probe element wearing the SAME class gets inserted into
// <body> once, and its REAL computed font/padding is read fresh every call
// -- whatever the browser actually resolves (any tier, any viewport size,
// any future CSS change to these classes) is what gets measured. No
// constant to forget, ever again.
var _nrrPulseFontProbes = {};
function _nrrPulseProbe(className) {
  var probe = _nrrPulseFontProbes[className];
  if (!probe) {
    probe = document.createElement('span');
    probe.className = className;
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:-9999px;white-space:nowrap;';
    document.body.appendChild(probe);
    _nrrPulseFontProbes[className] = probe;
  }
  return probe;
}
function _nrrPulseProbeFont(className) {
  var cs = getComputedStyle(_nrrPulseProbe(className));
  return cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
}
function _nrrPulseTextWidth(text, font) {
  if (!_nrrPulseMeasureCanvas) _nrrPulseMeasureCanvas = document.createElement('canvas');
  var ctx = _nrrPulseMeasureCanvas.getContext('2d');
  ctx.font = font || _nrrPulseProbeFont('nrr-pulse-owner-chip');
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
  if (maxW <= 0) return 0;
  var cs = getComputedStyle(_nrrPulseProbe('nrr-pulse-owner-chip'));
  var pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight); // chip's own real left+right padding
  return Math.ceil(maxW) + Math.ceil(pad);
}
// Same bug, same fix, one column over: .nrr-pulse-risk-amt-wrap used to be a
// GUESSED fixed width (132px) so the wrap's width wouldn't depend on the
// reason text ("เงียบ" vs "ต่ำกว่าฐาน 45%") and shift the owner chip beside
// it. That stopped the shift, but for any row whose real text is narrower
// than the guess, the right-aligned content leaves dead space on ITS OWN
// left — directly next to the chip — which is exactly what reads as "the
// chip is oddly far from the number." Fix: measure the two real lines
// (amount + reason) actually in this list and use the true longest one,
// same technique as the owner slot above -- now via the same probe pattern.
function _nrrPulseRiskAmtWidth(items) {
  var maxW = 0;
  var amtFont = _nrrPulseProbeFont('nrr-pulse-risk-amt');
  var lblFont = _nrrPulseProbeFont('nrr-pulse-risk-amt-lbl');
  (items || []).forEach(function (it) {
    var amtW = _nrrPulseTextWidth('−' + nrrFmtGMV(it.risk), amtFont);
    var lblW = _nrrPulseTextWidth(it.reason || '', lblFont);
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
      // v56: outlet-grain by construction (one row = one outlet), so unlike
      // the Sales side there's no multi-outlet sum to worry about — today's
      // amount is simply this row's own curr_gmv when isToday, else 0.
      todayGmv: isToday ? (r.curr_gmv || 0) : 0,
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
      if (!acctMap[k]) acctMap[k] = { name: r.account_name, owner: r.staff_owner, gmv: 0, isToday: false, todayGmv: 0 };
      acctMap[k].gmv += r.mtd_gmv || 0;
      // v56: track TODAY's amount separately from the account's full MTD sum.
      // `isToday` fires if ANY ONE outlet under this account first-ordered
      // yesterday — but `gmv` above sums MTD across every outlet under the
      // account. An account with two outlets (one that first-ordered days
      // ago, one yesterday) would otherwise report its combined MTD total as
      // "today's" amount. todayGmv only accumulates the outlet-day(s) that
      // actually match yIso, so the Pulse hero's "มาใหม่วันนี้" list can show
      // the real today figure instead of an inflated multi-outlet sum.
      if (r.first_dollar_date === yIso) {
        acctMap[k].isToday = true;
        acctMap[k].todayGmv += r.mtd_gmv || 0;
      }
    });
    salesItems = Object.keys(acctMap).map(function (k) {
      var it = acctMap[k];
      return { kind: 'sales', name: it.name, sub: '', owner: it.owner, gmv: it.gmv, isToday: it.isToday, todayGmv: it.todayGmv };
    }).sort(function (a, b) { return b.gmv - a.gmv; });
  }

  var salesGmv = salesItems.reduce(function (s, x) { return s + x.gmv; }, 0);
  var expGmv = expItems.reduce(function (s, x) { return s + x.gmv; }, 0);
  var todayCount = salesItems.filter(function (x) { return x.isToday; }).length
    + expItems.filter(function (x) { return x.isToday; }).length;
  // v56: today's arrivals across BOTH sources, ranked by actual today's
  // spend (todayGmv, not the account's/outlet's full MTD gmv) — feeds the
  // green hero's new "มาใหม่วันนี้" mini-list.
  var todayItems = salesItems.filter(function (x) { return x.isToday; })
    .concat(expItems.filter(function (x) { return x.isToday; }))
    .sort(function (a, b) { return b.todayGmv - a.todayGmv; });
  // v_signage9 (2026-07-16): today's own ฿ total, for the Wins scene's hero
  // sub-line -- was showing the whole MONTH's GMV (newStoreGmv) directly
  // under a "ร้านใหม่วันนี้" hero number, which didn't match.
  var todayGmv = todayItems.reduce(function (s, x) { return s + x.todayGmv; }, 0);
  // v_signage2 (2026-07-15): the SAME two sources' FULL-month lists (not just
  // today's slice), for the new dedicated "New this month" scene — ranked by
  // each item's own full-month gmv (unlike todayItems above, which ranks by
  // todayGmv specifically).
  var monthItems = salesItems.concat(expItems).sort(function (a, b) { return b.gmv - a.gmv; });

  // ── At-risk accounts, from portview + history (nrrPaceSignal) ──
  var pv = window.bulkPortviewData;
  var dangerCount = 0, newSkuAdded = 0;
  var riskItems = [];
  if (pv && pv.loaded && pv.allRows) {
    pv.allRows.forEach(function (row) {
      // new-SKU count (v1: count only, no names — no portfolio-wide SKU source)
      var added = (row.cur_sku_count || 0) - (row.last_month_sku_count || 0);
      if (added > 0) newSkuAdded += added;

      var pace = (typeof nrrPaceSignal === 'function') ? nrrPaceSignal(row) : { pct: null, cls: 'unknown', baseline_gmv: 0 };
      if (pace.pct == null) return; // no baseline (brand-new account) — nothing to compare
      var runrate = row.runrate_gmv || 0, baseline = pace.baseline_gmv || 0;
      if (pace.cls !== 'great' && pace.cls !== 'safe') {
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
    todayGmv: todayGmv,
    todayItems: todayItems,
    monthItems: monthItems,
    sales: { count: salesItems.length, gmv: salesGmv, items: salesItems },
    expansion: { count: expItems.length, gmv: expGmv, items: expItems },
    newSkuAdded: newSkuAdded,
    newSkuItems: newSkuItems,
    newSkuGmv: newSkuGmv,
    newSkuCount: newSkuItems.length,
    dangerCount: dangerCount,
    riskTotal: riskTotal,
    risk: riskItems,
    portviewReady: !!(pv && pv.loaded)
  };
}
window.nrrPulseModel = nrrPulseModel;

// ── Render ─────────────────────────────────────────────────────────────────
// v56: rotation-speed control — session-only (no localStorage anywhere in
// /nrr yet, and the user explicitly doesn't want this persisted), hidden
// once fullscreen via the same .nrr-pulse-fs-active class the fs button
// already toggles (a real TV screen shouldn't show interactive chrome).
function _nrrPulseRotControlHtml() {
  return '<div class="nrr-pulse-rot-ctrl"><span class="nrr-pulse-rot-lbl">ความเร็วหมุน</span>' +
    _nrrCoSegHtml('nrr-pulse-rot-seg', String(nrrPulseState.rotMs), NRR_PULSE_ROT_CHOICES, 'rotms') +
    '</div>';
}

function _nrrPulseDatelineHtml(m) {
  var d = m.asOf;
  var dow = _NRR_PULSE_TH_DOW[d.getDay()];
  var dateTh = nrrThMonthLabel ? (d.getDate() + ' ' + nrrThMonthLabel(d)) : (d.getDate() + '/' + (d.getMonth() + 1));
  var upd = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  var isFs = !!document.fullscreenElement;
  return '<div class="nrr-pulse-dateline">' +
    '<div><div class="nrr-pulse-dateline-main">เช้าวัน' + dow + ' · ' + nrrEsc(dateTh) + '</div>' +
    '<div class="nrr-pulse-dateline-sub">ภาพรวม portfolio · ข้อมูลถึงเมื่อวาน · อัปเดต ' + upd + '</div></div>' +
    '<div class="nrr-pulse-dateline-controls">' +
    _nrrPulseRotControlHtml() +
    '<button type="button" class="nrr-pulse-fs-btn" id="nrr-pulse-fs-btn">' +
    (isFs ? '⤡ ออกจากเต็มจอ' : '⤢ เปิดเต็มจอ (สำหรับจอทีวี)') + '</button>' +
    '</div>' +
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
  // v56/v65: row cap (_nrrPulseEffMax) depends on document.fullscreenElement —
  // re-show the current scene immediately so the row count changes the
  // instant fullscreen toggles, not just on the next rotation tick.
  if (nrrPulseState.model && nrrPulseState.activeScenes.length) _nrrPulseShowScene(nrrPulseState.sceneIdx);
});

// ── Scenes ───────────────────────────────────────────────────────────────
// v65: each scene is a full-screen "moment," meant to be read in a single
// 2-3s glance and never sharing the screen with another scene.
// v_signage2 (2026-07-15): order is fixed: wins -> month -> skus -> risk.
// _nrrPulseActiveScenes(m) below decides which of these actually get airtime
// on a given data refresh.
// v76: dropped the "Vibe check" net-momentum scene per explicit user request
// (removed, not hidden — no toggle to bring it back without re-adding this
// function + its 'vibe' scene-key wiring + the .nrr-pulse-scene-vibe CSS).

// Shared by Scene 1 (wins, today-only) and Scene 2 (month, the same two
// sources' full-month list) — both are a name-forward spotlight list with an
// owner chip + Sales/Expansion source tag per row. `amtKey` picks which ₿
// figure to show per row (today's amount vs. the item's full-month amount);
// items not from today (only possible in the month list) get a plain dot
// instead of the pulsing "opened today" one. Slot width is measured from the
// FULL item set (not just the visible window) so the column never resizes
// as rotation cycles through different names — same convention as
// _nrrPulseSkuRowsHtml/_nrrPulseRiskRowsHtml below.
function _nrrPulseSpotlightRowsHtml(items, max, amtKey, emptyMsg) {
  if (!items.length) return '<div class="nrr-pulse-empty" style="color:rgba(255,255,255,.85)">' + emptyMsg + '</div>';
  var slotW = _nrrPulseOwnerSlotWidth(items, 'owner');
  return _nrrPulseWindow(items, nrrPulseState.rotIdx, max).map(function (x) {
    var sourceLabel = x.kind === 'sales' ? 'Sales' : 'Expansion';
    var dotHtml = x.isToday
      ? '<span class="nrr-pulse-today-dot" title="เปิดบิลแรกวันนี้"></span>'
      : '<span class="nrr-pulse-arr-dot"></span>';
    return '<div class="nrr-pulse-spotlight-row">' +
      dotHtml +
      '<div class="nrr-pulse-spotlight-main">' +
      '<div class="nrr-pulse-spotlight-name">' + nrrEsc(x.name) + '</div>' +
      (x.sub ? '<div class="nrr-pulse-arr-sub">' + nrrEsc(x.sub) + '</div>' : '') +
      '</div>' +
      '<span class="nrr-pulse-source-tag ' + x.kind + '">' + sourceLabel + '</span>' +
      _nrrPulseOwnerChip(x.owner, slotW) +
      '<div class="nrr-pulse-spotlight-amt">' + nrrFmtGMV(x[amtKey]) + '</div>' +
      '</div>';
  }).join('');
}

// Scene 1 — Today's wins. v_signage9 (2026-07-16): the hero used to show the
// cumulative MONTH count (the original "137"/"163" number) with a "วันนี้"
// list title underneath carrying no count of its own — read as if that same
// month-cumulative number were today's count (user: "ไม่บอกจำนวนให้ว่า วันนี้ มี
// ใหม่มากี่ร้าน ตอนนี้ไปปนกับเดือนนี้"). First fix (same day) added a count next
// to "วันนี้"; user then asked to go further and replace the hero itself with
// TODAY's own count/฿ — the month-cumulative number belongs on the Month
// scene (right below, "เดือนนี้"), not repeated here too. Hero is now
// `m.todayCount`/`m.todayGmv`; list title reverts to a plain "วันนี้" since
// the count is no longer duplicated below it.
function _nrrPulseSceneWinsHtml(m) {
  var rowsHtml = _nrrPulseSpotlightRowsHtml(m.todayItems, _nrrPulseEffMax(NRR_PULSE_WINS_SPOTLIGHT_MAX), 'todayGmv', '— ยังไม่มีร้านใหม่วันนี้ —');
  return '<div class="nrr-pulse-scene nrr-pulse-scene-wins" data-scene="wins">' +
    '<div class="nrr-pulse-scene-cumul">' +
    '<div class="nrr-pulse-scene-lbl">ร้านใหม่วันนี้</div>' +
    '<div class="nrr-pulse-scene-num" data-count="' + m.todayCount + '">' + m.todayCount + '</div>' +
    '<div class="nrr-pulse-scene-sub">' + nrrFmtGMV(m.todayGmv) + '</div>' +
    '</div>' +
    '<div class="nrr-pulse-spotlight-title">วันนี้</div>' +
    '<div class="nrr-pulse-spotlight-list" id="nrr-pulse-wins-list">' + rowsHtml + '</div>' +
    '</div>';
}

// Scene 2 (new, v_signage2) — same cumulative monthly hero as Scene 1, but
// the spotlight list below it is the FULL month's arrivals (not just today),
// so a KAM who only catches the board once can still see the whole month's
// story, not only whatever happened to land today.
function _nrrPulseSceneMonthHtml(m) {
  var rowsHtml = _nrrPulseSpotlightRowsHtml(m.monthItems, _nrrPulseEffMax(NRR_PULSE_SCENE_MONTH_MAX), 'gmv', '— ยังไม่มีร้านใหม่เดือนนี้ —');
  return '<div class="nrr-pulse-scene nrr-pulse-scene-wins" data-scene="month">' +
    '<div class="nrr-pulse-scene-cumul">' +
    '<div class="nrr-pulse-scene-lbl">ร้านใหม่สะสมเดือนนี้</div>' +
    '<div class="nrr-pulse-scene-num" data-count="' + m.newStoreCount + '">' + m.newStoreCount + '</div>' +
    '<div class="nrr-pulse-scene-sub">' + nrrFmtGMV(m.newStoreGmv) + '</div>' +
    '</div>' +
    '<div class="nrr-pulse-spotlight-title">เดือนนี้</div>' +
    '<div class="nrr-pulse-spotlight-list" id="nrr-pulse-month-list">' + rowsHtml + '</div>' +
    '</div>';
}

function _nrrPulseWindow(items, idx, max) {
  if (!items.length || items.length <= max) return items;
  var out = [];
  for (var i = 0; i < max; i++) out.push(items[(idx + i) % items.length]);
  return out;
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

// Re-fill only the currently-active scene's rotating list container (called
// on scene entry + by the scene's own sub-rotation timer) — every scene's
// list can now outgrow its on-screen max (v_signage2 added sub-rotation to
// wins/month, which previously had none).
function _nrrPulseFillLists(sceneKey) {
  var m = nrrPulseState.model;
  if (!m) return;
  if (sceneKey === 'skus') {
    var sk = document.getElementById('nrr-pulse-sku-list');
    if (sk) sk.innerHTML = _nrrPulseSkuRowsHtml(m.newSkuItems, _nrrPulseEffMax(NRR_PULSE_SCENE_SKU_MAX));
  } else if (sceneKey === 'risk') {
    var r = document.getElementById('nrr-pulse-risk-list');
    if (r) r.innerHTML = _nrrPulseRiskRowsHtml(m.risk, _nrrPulseEffMax(NRR_PULSE_SCENE_RISK_MAX));
  } else if (sceneKey === 'wins') {
    var w = document.getElementById('nrr-pulse-wins-list');
    if (w) w.innerHTML = _nrrPulseSpotlightRowsHtml(m.todayItems, _nrrPulseEffMax(NRR_PULSE_WINS_SPOTLIGHT_MAX), 'todayGmv', '— ยังไม่มีร้านใหม่วันนี้ —');
  } else if (sceneKey === 'month') {
    var mo = document.getElementById('nrr-pulse-month-list');
    if (mo) mo.innerHTML = _nrrPulseSpotlightRowsHtml(m.monthItems, _nrrPulseEffMax(NRR_PULSE_SCENE_MONTH_MAX), 'gmv', '— ยังไม่มีร้านใหม่เดือนนี้ —');
  }
}

// v65: which scenes actually get airtime this data refresh — an empty scene
// (e.g. zero new SKUs some day) is hard-skipped from rotation, never shown
// blank. Recomputed once per NRR_PULSE_REFRESH_MS tick, not per rotation tick.
// v_signage8 (2026-07-16): briefly gated 'wins' the same way as the other
// scenes (hide when m.todayItems is empty) -- reverted same day. Watching a
// real, un-instrumented rotation confirmed the scene-cycling logic itself
// was never broken (wins correctly appears first on load and wraps back
// around every ~32s); "today" arrivals genuinely hit 0 on some data pulls,
// and hiding the scene entirely on those reads as "did something break?"
// just as much as showing an empty message did before. User's call: always
// keep 'wins' in rotation (unconditional, like the original v65 design) and
// let its own empty-state message ("— ยังไม่มีร้านใหม่วันนี้ —") communicate
// "system's working, just nothing yet" instead of the scene vanishing.
function _nrrPulseActiveScenes(m) {
  var scenes = ['wins'];
  if (m.monthItems.length > 0) scenes.push('month');
  if (m.newSkuItems.length > 0 || m.newSkuAdded > 0) scenes.push('skus');
  if (m.risk.length > 0) scenes.push('risk');
  return scenes;
}

// Scene 3 — New products moving. Falls back to the bare count (no
// new_skus_portfolio.csv uploaded yet) same as the pre-v65 page did.
// v_signage3 (2026-07-15): new_skus_portfolio.sql redefined "new" from "new
// to THAT ACCOUNT this month" to "genuinely new to Freshket, first sold
// anywhere on the platform this month" -- caption below updated to match.
// Requires a fresh BigQuery run + R2 re-upload of new_skus_portfolio.csv
// before real numbers reflect this; the fallback branch (newSkuAdded, from
// portview's per-account cur_sku_count diff) is a DIFFERENT, coarser proxy
// and is unaffected by this SQL change -- its caption is left as-is since it
// never claimed "new to Freshket" in the first place.
function _nrrPulseSceneSkusHtml(m) {
  if (!m.newSkuItems.length) {
    return '<div class="nrr-pulse-scene nrr-pulse-scene-skus" data-scene="skus">' +
      '<div class="nrr-pulse-scene-lbl">สินค้าใหม่ที่ขายได้</div>' +
      '<div class="nrr-pulse-scene-num">＋' + m.newSkuAdded.toLocaleString() + '</div>' +
      '<div class="nrr-pulse-scene-sub">จำนวน SKU ที่ร้านต่างๆ ซื้อเพิ่มเดือนนี้ (นับรวมทั้ง portfolio)</div>' +
      '</div>';
  }
  return '<div class="nrr-pulse-scene nrr-pulse-scene-skus" data-scene="skus">' +
    '<div class="nrr-pulse-scene-head"><span class="nrr-pulse-block-title">สินค้าใหม่ที่ขายได้</span>' +
    '<span class="nrr-pulse-block-tally">' + m.newSkuCount + ' SKU · ' + nrrFmtGMV(m.newSkuGmv) + '</span></div>' +
    '<div class="nrr-pulse-block-caption">สินค้าที่ Freshket ขายได้เป็นครั้งแรกเดือนนี้ — ไม่เคยมีร้านไหนซื้อมาก่อนเลย</div>' +
    '<div class="nrr-pulse-list" id="nrr-pulse-sku-list"></div>' +
    '</div>';
}

// Scene 4 — Needs attention: merges the old orange hero (count + total ฿ at
// risk) with its full list onto one screen — deliberately never shares a
// screen with a celebratory scene.
function _nrrPulseSceneRiskHtml(m) {
  return '<div class="nrr-pulse-scene nrr-pulse-scene-risk" data-scene="risk">' +
    '<div class="nrr-pulse-scene-head"><span class="nrr-pulse-block-title">ต้องดูแล — เงียบ / ยอดตก</span>' +
    '<span class="nrr-pulse-block-tally">' + m.dangerCount + ' ร้าน · −' + nrrFmtGMV(m.riskTotal) + '</span></div>' +
    '<div class="nrr-pulse-block-caption">ยอดวิ่ง (run-rate) ต่ำกว่าฐานไตรมาส (มิ.ย.) หรือหยุดสั่งซื้อไปแล้ว</div>' +
    '<div class="nrr-pulse-list" id="nrr-pulse-risk-list"></div>' +
    '</div>';
}

// Show exactly one scene (fade via the .active class in CSS), fill its list
// if it has one, arm/disarm the faster internal sub-rotation accordingly, and
// re-trigger the count-up animation on that scene's own number(s) each time
// it comes back around — so a KAM who glances back at the same scene an hour
// later still sees the number "land," not a static already-settled figure.
function _nrrPulseShowScene(idx) {
  var scenes = nrrPulseState.activeScenes;
  if (!scenes.length) return;
  nrrPulseState.sceneIdx = ((idx % scenes.length) + scenes.length) % scenes.length;
  var key = scenes[nrrPulseState.sceneIdx];
  var area = document.getElementById('nrr-pulse-scene-area');
  if (!area) return;
  area.querySelectorAll('.nrr-pulse-scene').forEach(function (el) {
    el.classList.toggle('active', el.dataset.scene === key);
  });
  if (key === 'skus' || key === 'risk' || key === 'wins' || key === 'month') {
    nrrPulseState.rotIdx = 0;
    _nrrPulseFillLists(key);
  }
  _nrrPulseArmSceneSubRotation(key);
  var activeEl = area.querySelector('.nrr-pulse-scene[data-scene="' + key + '"]');
  if (activeEl) activeEl.querySelectorAll('.nrr-pulse-scene-num[data-count]').forEach(function (el) {
    var target = parseInt(el.dataset.count, 10) || 0;
    nrrCountUp(el, target, 800, function (n) { return Math.round(n).toLocaleString(); });
  });
}

// Any scene whose list can hold more rows than fit on screen at once gets
// re-sliced at a faster cadence than the full-scene rotation, so a long list
// still gets real airtime before the board moves on, instead of only ever
// showing its first N names forever. v_signage2 extended this from
// skus/risk to also cover wins/month, now that all four caps are 5.
function _nrrPulseArmSceneSubRotation(key) {
  if (_nrrPulseSceneSubTimer) { clearInterval(_nrrPulseSceneSubTimer); _nrrPulseSceneSubTimer = null; }
  if (key !== 'skus' && key !== 'risk' && key !== 'wins' && key !== 'month') return;
  _nrrPulseSceneSubTimer = setInterval(function () {
    if (!nrrCurrentRoute || nrrCurrentRoute.view !== 'pulse') { _nrrPulseClearTimers(); return; }
    var max = key === 'skus' ? NRR_PULSE_SCENE_SKU_MAX
      : key === 'risk' ? NRR_PULSE_SCENE_RISK_MAX
      : key === 'wins' ? NRR_PULSE_WINS_SPOTLIGHT_MAX
      : NRR_PULSE_SCENE_MONTH_MAX;
    nrrPulseState.rotIdx += _nrrPulseEffMax(max);
    _nrrPulseFillLists(key);
  }, NRR_PULSE_SCENE_SUBROT_MS);
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
    // Order matters: _nrrPulseArmTimers() clears ALL timers (including the
    // scene sub-rotation one) before re-arming rot+refresh — must run BEFORE
    // _nrrPulseRender()'s _nrrPulseShowScene() call arms the sub-timer, or
    // this would immediately wipe out the sub-rotation it just started.
    _nrrPulseArmTimers();
    _nrrPulseRender();
  });
}
window.nrrRenderPulseView = nrrRenderPulseView;

// v65: builds the WHOLE rotation up front — every active scene's DOM node
// inserted into .nrr-pulse-scene-area, hidden via CSS except the active one
// — rather than re-rendering innerHTML per rotation tick (smoother fades,
// far less GC churn over unattended kiosk hours; see plan doc).
function _nrrPulseRender() {
  var page = document.getElementById('nrr-pulse-page');
  if (!page) return;
  var m = nrrPulseModel();
  nrrPulseState.model = m;
  if (!m) {
    page.innerHTML = '<div class="nrr-pulse-loading">ยังไม่มีข้อมูลภาพรวม</div>';
    return;
  }
  var scenes = _nrrPulseActiveScenes(m);
  nrrPulseState.activeScenes = scenes;
  // keep showing "the same moment" across a data refresh where possible,
  // clamped in case the previous scene got dropped for being empty now.
  var keepIdx = Math.min(nrrPulseState.sceneIdx, scenes.length - 1);
  var sceneHtmlByKey = { wins: _nrrPulseSceneWinsHtml, month: _nrrPulseSceneMonthHtml, skus: _nrrPulseSceneSkusHtml, risk: _nrrPulseSceneRiskHtml };
  var sceneAreaHtml = scenes.map(function (key) { return sceneHtmlByKey[key](m); }).join('');
  page.innerHTML =
    '<div class="nrr-pulseboard">' +
    _nrrPulseDatelineHtml(m) +
    (typeof nrrStalePortviewBannerHtml === 'function' ? nrrStalePortviewBannerHtml() : '') +
    (typeof nrrStaleBulkHistoryBannerHtml === 'function' ? nrrStaleBulkHistoryBannerHtml() : '') +
    '<div class="nrr-pulse-scene-area" id="nrr-pulse-scene-area">' + sceneAreaHtml + '</div>' +
    '</div>';
  _nrrPulseShowScene(keepIdx < 0 ? 0 : keepIdx);
  var fsBtn = document.getElementById('nrr-pulse-fs-btn');
  if (fsBtn) fsBtn.addEventListener('click', _nrrPulseToggleFullscreen);
  var rotSeg = document.getElementById('nrr-pulse-rot-seg');
  if (rotSeg) rotSeg.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-rotms]');
    if (!btn) return;
    var ms = parseInt(btn.dataset.rotms, 10);
    if (!ms || ms === nrrPulseState.rotMs) return;
    nrrPulseState.rotMs = ms;
    rotSeg.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', parseInt(b.dataset.rotms, 10) === ms);
    });
    // re-arm with the new interval — _nrrPulseArmTimers always clears both
    // timers first, so this also resets the 10-min refresh countdown; a
    // harmless side effect (refresh lands up to ~10min later, worst case),
    // not worth splitting into two separate arm functions for this scope.
    _nrrPulseArmTimers();
  });
}

// ── Timers (auto-refresh + spotlight rotation) ──────────────────────────────
// Only run while #/pulse is the active view; self-clear otherwise so nothing
// leaks when the user (or a wall TV kiosk) navigates away.
function _nrrPulseArmTimers() {
  _nrrPulseClearTimers();
  _nrrPulseRotTimer = setInterval(function () {
    if (!nrrCurrentRoute || nrrCurrentRoute.view !== 'pulse') { _nrrPulseClearTimers(); return; }
    _nrrPulseShowScene(nrrPulseState.sceneIdx + 1);
  }, nrrPulseState.rotMs);
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
  // _nrrPulseClearTimers() above just wiped the scene sub-rotation timer too
  // (e.g. when a rotation-speed pill click re-arms everything) — restart it
  // for whichever scene is currently showing so a list-heavy scene doesn't
  // silently lose its internal cycling until the next full-scene rotation.
  if (nrrPulseState.activeScenes.length) {
    _nrrPulseArmSceneSubRotation(nrrPulseState.activeScenes[nrrPulseState.sceneIdx]);
  }
}
function _nrrPulseClearTimers() {
  if (_nrrPulseRotTimer) { clearInterval(_nrrPulseRotTimer); _nrrPulseRotTimer = null; }
  if (_nrrPulseRefreshTimer) { clearInterval(_nrrPulseRefreshTimer); _nrrPulseRefreshTimer = null; }
  if (_nrrPulseSceneSubTimer) { clearInterval(_nrrPulseSceneSubTimer); _nrrPulseSceneSubTimer = null; }
  // Leaving #/pulse always exits TV fullscreen too — same cleanup hook.
  if (document.fullscreenElement) (document.exitFullscreen() || Promise.resolve()).catch(function () {});
}

// ── Route registration (nrr_router.js is injected before this module) ────────
nrrRouterRegister('pulse', nrrRenderPulseView);
window.nrrRenderPulseView = nrrRenderPulseView;
