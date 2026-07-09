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
  return { pct: pct, cls: cls, label: Math.round(pct) + '%', baseline_gmv: baseRow.gmv };
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
      inner = '<div class="nrr-spark-seg" style="height:' + h + 'px;background:' + color + '"></div>';
    }
    return '<div class="nrr-spark-col' + (b.isBase ? ' base' : '') + '" title="' + nrrEsc(b.label + ': ' + nrrFmtGMV(b.v) + (b.isBase ? ' (เดือนฐาน)' : '')) + '">' +
      '<div class="nrr-spark-stack">' + inner + '</div>' +
      (b.isBase ? '<div class="nrr-spark-basemark"></div>' : '') +
      '</div>';
  }).join('');
  return '<div class="nrr-spark">' + barsHtml + '</div>';
}
window.nrrAcctSparklineHtml = nrrAcctSparklineHtml;
