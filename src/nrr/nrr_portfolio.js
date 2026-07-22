// ── nrr_portfolio.js — Portfolio layer pure logic (Phase B, 2026-07-09) ──
// Pace/filter logic over window.bulkPortviewData (nrr_data.js). Deliberately
// a separate file from nrr_commission.js — this is account-level pace/churn
// signal, not commission math, even though both feed the same Portfolio view.
//
// Baseline decision (round 2, 2026-07-09 — do not "fix" this back to Sense's
// own convention without re-reading this note): Sense's real portview pace
// (06_portview_teamview.js:2-51, computePaceSignal) uses a ROLLING average
// of the trailing 1-3 months as baseline. /nrr deliberately does NOT copy
// that — every other number on this page (%NRR, commission) is anchored to
// the quarter's FIXED base_month (QNRR_CFG.base_month) for the whole
// quarter, so account-level pace uses that SAME fixed month too. Otherwise
// two baselines would silently disagree once the quarter moves past its
// first month. See plan doc "Phase B round 2" for the full reasoning.

var _NRR_TH_MONTHS_ORDER = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                            'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function _nrrParseThLabel(label) {
  var parts = (label || '').split(' ');
  var mIdx = _NRR_TH_MONTHS_ORDER.indexOf(parts[0]);
  var year = parseInt(parts[1], 10) - 543;
  return { mIdx: mIdx, year: year, key: (mIdx > -1 && year) ? year * 12 + mIdx : null };
}

// Thai label for QNRR_CFG.base_month ('2026-06' -> 'มิ.ย. 2569') — reuses
// nrrThMonthLabel() (nrr_data.js) so the label format always matches what
// bulk_history.csv actually contains.
function nrrBaseMonthThLabel() {
  var p = QNRR_CFG.base_month.split('-');
  return nrrThMonthLabel(new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1));
}
window.nrrBaseMonthThLabel = nrrBaseMonthThLabel;

// pct/cls thresholds mirror Sense's own portview pace banding (100/95/90);
// baseline_gmv is this account's GMV in the quarter's fixed base month
// (bulk_history.csv), NOT a rolling average and NOT portview.csv's
// last_month_gmv (that column drifts month-to-month within the quarter —
// see header note above). runrate_gmv stays from portview.csv, precomputed
// server-side — never re-derived here.
function nrrPaceSignal(row) {
  if (!row) return { pct: null, cls: 'unknown', label: '—', baseline_gmv: 0 };
  var hist = (window.bulkHistoryData && window.bulkHistoryData.byAccountId[row.account_id]) || [];
  var baseLabel = nrrBaseMonthThLabel();
  var baseRow = hist.filter(function (h) { return h.month_label === baseLabel; })[0];
  if (!baseRow || !baseRow.gmv) {
    return { pct: null, cls: 'new', label: 'ร้านใหม่', baseline_gmv: 0 };
  }
  var pct = row.runrate_gmv / baseRow.gmv * 100;
  var cls = pct >= 100 ? 'great' : pct >= 95 ? 'safe' : pct >= 90 ? 'warn' : 'danger';
  // 'expected' = "should have by today if tracking baseline exactly"
  // (Sense's computePaceSignal field of the same name) — Portfolio's row
  // view doesn't show it (no room), the Account page hero does.
  var expected = baseRow.gmv * (row.days_elapsed / (row.days_in_month || 30));
  return { pct: pct, cls: cls, label: Math.round(pct) + '%', baseline_gmv: baseRow.gmv, expected: expected };
}
window.nrrPaceSignal = nrrPaceSignal;

// One KAM's accounts, pace signal attached, sorted worst-pace-first (the
// accounts most worth a rep's attention surface at the top of their list).
function nrrPortfolioRowsFor(kamEmail) {
  var pv = window.bulkPortviewData;
  if (!pv || !pv.loaded) return [];
  return (pv.byKamEmail[kamEmail] || [])
    .map(function (r) { return { row: r, pace: nrrPaceSignal(r) }; })
    .sort(function (a, b) {
      var pa = a.pace.pct == null ? -1 : a.pace.pct;
      var pb = b.pace.pct == null ? -1 : b.pace.pct;
      return pa - pb;
    });
}
window.nrrPortfolioRowsFor = nrrPortfolioRowsFor;

// Portfolio-level risk summary — same grouping Sense's ON TRACK/MONITOR/
// AT RISK boxes use (06_portview_teamview.js:1580-1700: group by
// paceSignal.cls, value = surplus above baseline for the ok bucket, or
// shortfall below baseline for warn/danger) — but against /nrr's own
// fixed-base-month baseline, not Sense's rolling one. Accounts with no
// baseline (cls 'new') are excluded — there's nothing to compare them to.
function nrrPortfolioRiskSummary(kamEmail) {
  var buckets = {
    ok:     { count: 0, value: 0 },
    warn:   { count: 0, value: 0 },
    danger: { count: 0, value: 0 }
  };
  nrrPortfolioRowsFor(kamEmail).forEach(function (item) {
    if (item.pace.pct == null) return;
    var runrate = item.row.runrate_gmv || 0, baseline = item.pace.baseline_gmv || 0;
    if (item.pace.cls === 'great' || item.pace.cls === 'safe') {
      buckets.ok.count++;
      buckets.ok.value += Math.max(0, runrate - baseline);
    } else if (item.pace.cls === 'warn') {
      buckets.warn.count++;
      buckets.warn.value += Math.max(0, baseline - runrate);
    } else {
      buckets.danger.count++;
      buckets.danger.value += Math.max(0, baseline - runrate);
    }
  });
  return buckets;
}
window.nrrPortfolioRiskSummary = nrrPortfolioRiskSummary;

// ══ PM Portfolio Mode (v_pmmode, 2026-07-21) ═══════════════════════════════
// A PM holds 400+ accounts — the flat per-account card list that works for a
// 20-account KAM is unusable at that scale, and per-account metrics don't
// match the inputs a PM actually controls (one-to-many campaigns, not
// per-account calls). Three layers, all computed from data ALREADY loaded
// client-side (nrrKamResult / bulkPortviewData) — no new SQL:
//   1. nrrPortfolioWaterfall — NRR flow decomposition (base → churn/
//      contraction/comeback/new → current), a pure re-presentation of
//      _qnrrCompute's own segments so it can never disagree with the %NRR
//      shown elsewhere on the page.
//   2. nrrRiskQueue — the ฿-ranked "ต้องดูแล" triage list, extracted from
//      nrr_pulse.js's proven inline logic (Pulse now calls this too).
//   3. nrrPortfolioTiers — Pareto A/B/C by account size, so the top ~40
//      accounts (60% of GMV) can be worked KAM-style and the tail managed
//      as a cohort.
// Activation is by PORTFOLIO SIZE, not role (>= NRR_PM_MODE_MIN_ACCOUNTS),
// so an admin opening a PM's portfolio gets the same treatment with zero
// new role plumbing, and small KAM portfolios keep the existing view.
var NRR_PM_MODE_MIN_ACCOUNTS = 100;

// Flow decomposition for one owner+period, derived 1:1 from
// nrrKamResult(email).by_month[period] (nrr_aggregate.js/_qnrrCompute):
//   base − churn + contraction + comeback + newStores + inflow === curr
// holds EXACTLY (contraction = segments.core_nrr − core_nrr_base by
// definition, so the sum telescopes back to total_gmv). All ฿ values are
// the same day-normalized (÷days×30) figures _qnrrCompute produces.
function nrrPortfolioWaterfall(email, period) {
  var result = (typeof nrrKamResult === 'function') ? nrrKamResult(email) : null;
  var bm = result && period ? result.by_month[period] : null;
  if (!bm) return null;
  var seg = bm.segments || {}, out = bm.outlets || {};
  var churn = seg.core_nrr_churn || 0;
  var activeN = out.core_nrr || 0, churnedN = out.core_nrr_churn || 0;
  return {
    base: (bm.core_nrr_base || 0) + churn,
    churn: churn,
    contraction: bm.contraction || 0,   // core cohort's own delta vs base — can be + (growth) or − (shrink)
    comeback: seg.comeback || 0,
    newStores: (seg.expansion || 0) + (seg.new_sales || 0),
    inflow: (seg.handover || 0) + (seg.transfer_in || 0),
    curr: bm.total_gmv || 0,
    counts: {
      active: activeN, churned: churnedN,
      comeback: out.comeback || 0,
      newStores: (out.expansion || 0) + (out.new_sales || 0),
      inflow: (out.handover || 0) + (out.transfer_in || 0)
    },
    activeRatio: (activeN + churnedN) > 0 ? activeN / (activeN + churnedN) * 100 : null,
    nrr_pct: bm.nrr_pct
  };
}
window.nrrPortfolioWaterfall = nrrPortfolioWaterfall;

// ฿-ranked at-risk queue. Extracted VERBATIM from nrr_pulse.js's inline
// "ต้องดูแล" computation (v49 threshold: run-rate >20% below the quarter's
// fixed base month, i.e. pace.pct < 80 — deliberately stricter than
// nrrPaceSignal's own 'danger' band so the list stays actionable, see the
// original v49 note now living here). Pulse calls this with
// opts.bigOutletByAcct (its account→biggest-outlet name map) to keep its
// display names identical; the Portfolio queue passes no opts and shows
// plain account names (rows deep-link to the Account page anyway).
function nrrRiskQueue(rows, opts) {
  var out = [];
  (rows || []).forEach(function (row) {
    var pace = (typeof nrrPaceSignal === 'function') ? nrrPaceSignal(row) : { pct: null, cls: 'unknown', baseline_gmv: 0 };
    if (pace.pct == null) return; // no baseline (brand-new account) — nothing to compare
    if (pace.cls === 'great' || pace.cls === 'safe') return;
    if (pace.pct >= 80) return;
    var runrate = row.runrate_gmv || 0, baseline = pace.baseline_gmv || 0;
    var shortfall = Math.max(0, baseline - runrate);
    var dropPct = Math.max(0, Math.round(100 - pace.pct));
    var quiet = pace.pct < 50 || (row.churned_gmv || 0) > runrate;
    var acctName = row.account_name || row.account_id;
    var big = (opts && opts.bigOutletByAcct) ? opts.bigOutletByAcct[row.account_id] : null;
    out.push({
      account_id: row.account_id,
      name: (big && big.name) || acctName,
      sub: (big && big.name && big.name !== acctName) ? acctName : '',
      kam: row.kam_name || row.kam_email || '',
      risk: shortfall,
      reason: quiet ? 'เงียบ' : 'ต่ำกว่าฐาน ' + dropPct + '%'
    });
  });
  out.sort(function (a, b) { return b.risk - a.risk; });
  return out;
}
window.nrrRiskQueue = nrrRiskQueue;

// Pareto tiers: sort by account size (fixed-base-month GMV; run-rate as the
// fallback for baseline-less new accounts so a big new account isn't buried
// in C), then cumulative share — A = accounts covering the first 60% of
// portfolio GMV, B = to 90%, C = the tail. The account that CROSSES a
// boundary stays in the earlier tier (cum measured before adding it).
var NRR_TIER_BOUNDS = { A: 0.60, B: 0.90 };
function nrrPortfolioTiers(email) {
  function mk() { return { count: 0, gmv: 0, baseline: 0, runrate: 0, byId: {} }; }
  var tiers = { A: mk(), B: mk(), C: mk() };
  var sized = nrrPortfolioRowsFor(email).map(function (it) {
    return { it: it, size: (it.pace.baseline_gmv || 0) > 0 ? it.pace.baseline_gmv : (it.row.runrate_gmv || 0) };
  }).sort(function (a, b) { return b.size - a.size; });
  var total = sized.reduce(function (s, x) { return s + x.size; }, 0);
  var cum = 0;
  sized.forEach(function (x) {
    var key = total <= 0 ? 'C'
      : cum < total * NRR_TIER_BOUNDS.A ? 'A'
      : cum < total * NRR_TIER_BOUNDS.B ? 'B' : 'C';
    cum += x.size;
    var t = tiers[key];
    t.count++;
    t.gmv += x.size;
    t.baseline += x.it.pace.baseline_gmv || 0;
    t.runrate += x.it.row.runrate_gmv || 0;
    t.byId[x.it.row.account_id] = true;
  });
  ['A', 'B', 'C'].forEach(function (k) {
    var t = tiers[k];
    t.share = total > 0 ? t.gmv / total * 100 : 0;
    // "retention" here = tier's pooled run-rate vs its pooled fixed base —
    // the same ratio nrrPaceSignal computes per account, pooled per tier.
    t.retention = t.baseline > 0 ? t.runrate / t.baseline * 100 : null;
  });
  tiers.total = total;
  return tiers;
}
window.nrrPortfolioTiers = nrrPortfolioTiers;

// Mini 6-month bar chart per account (Sense's _buildSparkline pattern,
// 06_portview_teamview.js:987-1017, ghost/solid two-tone last bar) — the
// 5 closed months come straight from bulk_history.csv; the current
// (open) month comes from the portview row itself (bulk_history.csv never
// contains the in-progress month). The quarter base month gets a small
// marker so it's visible which bar the pace% above is actually measured
// against.
function nrrAcctSparklineHtml(row, pace) {
  var hist = (window.bulkHistoryData && window.bulkHistoryData.byAccountId[row.account_id]) || [];
  var baseLabel = nrrBaseMonthThLabel();
  var closed = hist.slice().sort(function (a, b) {
    return (_nrrParseThLabel(a.month_label).key || 0) - (_nrrParseThLabel(b.month_label).key || 0);
  }).slice(-5);

  var bars = closed.map(function (h) {
    return { label: h.month_label, v: h.gmv, isBase: h.month_label === baseLabel, mtd: null };
  });
  bars.push({ label: 'MTD', v: row.runrate_gmv || 0, mtd: row.gmv_to_date || 0, isBase: false, isCurrent: true });

  var maxV = Math.max.apply(null, [1].concat(bars.map(function (b) { return b.v; })));
  var H = 26;
  var color = pace.pct == null ? 'var(--ink3)' : nrrThresholdColorVar(pace.pct);
  var barsHtml = bars.map(function (b) {
    var h = Math.max(2, Math.round((b.v / maxV) * H));
    var inner;
    if (b.isCurrent && b.mtd != null && b.v > b.mtd) {
      var solidH = Math.max(1, Math.round((b.mtd / maxV) * H));
      var hatchH = Math.max(1, h - solidH);
      inner = '<div class="nrr-spark-hatch" style="height:' + hatchH + 'px;background:repeating-linear-gradient(-45deg,rgba(255,255,255,0.5) 0 2px,rgba(255,255,255,0) 2px 5px),' + color + '"></div>' +
        '<div class="nrr-spark-seg" style="height:' + solidH + 'px;background:' + color + '"></div>';
    } else {
      // Base month gets an INSET top marker (box-shadow — draws inside
      // the box, adds no height) instead of the old trailing mark element
      // below the bar. That trailing element made the base column's total
      // height greater than its neighbors; since columns bottom-align,
      // the extra height pushed the base bar itself UP, making it look
      // taller/bigger than its real value (2026-07-09 — same bug shape
      // already fixed once in the Account view's own trend chart).
      inner = '<div class="nrr-spark-seg" style="height:' + h + 'px;background:' + color + (b.isBase ? ';box-shadow:inset 0 2px 0 var(--ink)' : '') + '"></div>';
    }
    return '<div class="nrr-spark-col' + (b.isBase ? ' base' : '') + '" title="' + nrrEsc(b.label + ': ' + nrrFmtGMV(b.v) + (b.isBase ? ' (เดือนฐาน)' : '')) + '">' +
      '<div class="nrr-spark-stack">' + inner + '</div>' +
      '</div>';
  }).join('');
  return '<div class="nrr-spark">' + barsHtml + '</div>';
}
window.nrrAcctSparklineHtml = nrrAcctSparklineHtml;
