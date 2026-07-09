// ── nrr_components.js — render helpers (v4) ──────────────────────────────

var MV_LABEL = {
  core_nrr: 'Core NRR', core_nrr_churn: 'Churn', comeback: 'Comeback',
  transfer_in: 'Transfer in', transfer_out: 'Transfer out',
  handover: 'Handover', new_sales: 'New sales', expansion: 'Expansion'
};

// v4 categorical palette — a SEPARATE system from status colors (green/sun/
// coral thresholds). Gains = green family, losses = coral family, portfolio
// plumbing = neutral cool hues. sun/amber is reserved for threshold-warning
// status and must never appear as a category color (see nrr_tokens.css).
var MV_COLOR = {
  core_nrr: 'var(--green)',
  expansion: 'var(--mv-green-lt)',
  comeback: 'var(--mv-teal)',
  transfer_in: 'var(--mv-violet)',
  handover: 'var(--mv-slate)',
  new_sales: 'var(--mv-slate)',
  core_nrr_churn: 'var(--coral)',
  transfer_out: 'var(--mv-clay)'
};
var MV_TAG_CLASS = {
  core_nrr: 'green', expansion: 'mv-green-lt', comeback: 'mv-teal',
  transfer_in: 'mv-violet', handover: 'mv-slate', new_sales: 'mv-slate',
  core_nrr_churn: 'coral', transfer_out: 'mv-clay'
};

// Stack order for the gains side of the chart (bottom → top).
var STACK_ORDER = ['core_nrr', 'handover', 'new_sales', 'expansion', 'comeback', 'transfer_in'];
// Losses hang below the zero line (top → bottom).
var LOSS_ORDER = ['core_nrr_churn', 'transfer_out'];

function nrrEsc(s) {
  return String(s || '').replace(/[&<>'"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c];
  });
}

function nrrStatTileHtml(id, label, valueAttr) {
  return '<div class="nrr-kpi-tile"><div class="nrr-kpi-value num" id="' + id + '" ' + (valueAttr || '') + '>—</div>' +
    '<div class="nrr-kpi-label">' + nrrEsc(label) + '</div></div>';
}

function nrrTag(movementType) {
  var cls = MV_TAG_CLASS[movementType] || 'muted';
  return '<span class="tag ' + cls + '">' + nrrEsc(MV_LABEL[movementType] || movementType) + '</span>';
}

// v8: small color dot in front of a name — replaces the movement-type text
// pill in outlet/account rows. A pill's width varies with label length
// ("Core NRR" vs "Churn"), which both eats space and nudges row height
// when it wraps; a fixed-size dot never does either, and keeps every row's
// name starting at the same x position regardless of movement type.
// Hover still reveals the exact label via title, so nothing is lost.
function nrrMvDotHtml(movementType) {
  if (!movementType) return '<span class="nrr-mv-dot nrr-mv-dot-mixed" title="หลายประเภท"></span>';
  var color = MV_COLOR[movementType] || 'var(--ink3)';
  var label = MV_LABEL[movementType] || movementType;
  return '<span class="nrr-mv-dot" style="background:' + color + '" title="' + nrrEsc(label) + '"></span>';
}
window.nrrMvDotHtml = nrrMvDotHtml;

// ── v4: number-triple renderer — ONE convention everywhere ───────────────
// run-rate = primary (the number the quarter is judged on), ~ prefix +
// dotted underline while the month is partial; MTD = evidence, plain ink;
// base = yardstick, muted. When the month completes, ~/dots drop and MTD
// equals run-rate, so the secondary line collapses to just the base.
function nrrRunRateTooltip(triple) {
  return 'Run-rate: MTD ÷ ' + triple.curr_days + ' วัน × 30 — ประมาณการถึงสิ้นเดือน';
}

// ── v5: per-outlet momentum vs its own base ───────────────────────────────
// Banding verified on real data (51% up / 21% flat / 28% down at day 6):
// >1.10 growth, 0.90–1.10 flat (no mark — flat is the absence of signal),
// <0.90 shrinking. base=0 with revenue = pure gain (comeback/expansion).
function nrrMomentum(base, runRate) {
  if (base > 0) {
    var ratio = runRate / base;
    if (ratio > 1.10) return { cls: 'nrr-sig-up', glyph: '▲' };
    if (ratio < 0.90) return { cls: 'nrr-sig-down', glyph: '▼' };
    return { cls: '', glyph: '' };
  }
  if (runRate > 0) return { cls: 'nrr-sig-up', glyph: '▲' };
  return { cls: '', glyph: '' };
}
window.nrrMomentum = nrrMomentum;

function nrrTripleHtml(size, triple, opts) {
  if (!triple) return '<span class="micro">—</span>';
  opts = opts || {};
  var p = triple.is_partial;
  var rr = (p ? '~' : '') + nrrFmtGMV(triple.run_rate);
  var rrTitle = p ? ' title="' + nrrEsc(nrrRunRateTooltip(triple)) + '"' : '';
  var rrCls = 'nrr-rr' + (p ? ' nrr-rr-proj' : '');

  if (size === 'lg') {
    return '<div class="nrr-triple-lg">' +
      '<div class="nrr-triple-cell"><div class="nrr-triple-label">ฐาน</div><div class="num nrr-triple-base">' + nrrFmtGMV(triple.base) + '</div></div>' +
      '<div class="nrr-triple-cell"><div class="nrr-triple-label">MTD · ' + triple.curr_days + '/' + triple.days_in_month + ' วัน</div><div class="num nrr-triple-mtd">' + nrrFmtGMV(triple.mtd) + '</div></div>' +
      '<div class="nrr-triple-cell"><div class="nrr-triple-label">' + (p ? 'คาดการณ์สิ้นเดือน' : 'ทั้งเดือน') + '</div><div class="num nrr-triple-rr ' + rrCls + '"' + rrTitle + '>' + rr + '</div></div>' +
      '</div>';
  }
  // md / sm — two-line right-aligned stack. Momentum signal applies ONLY at
  // sm (outlet rows / account headers) — md/lg surfaces already carry
  // threshold-colored %NRR, doubling the signal there would be noise.
  var szCls = size === 'sm' ? 'nrr-triple-sm' : 'nrr-triple-md';
  var sigHtml = '';
  var sigCls = '';
  if (size === 'sm' && opts.signal) {
    var sig = nrrMomentum(triple.base, triple.run_rate);
    sigCls = sig.cls ? ' ' + sig.cls : '';
    sigHtml = sig.glyph ? '<span class="nrr-sig-glyph">' + sig.glyph + '</span>' : '';
  }
  var line2 = p
    ? 'MTD ' + nrrFmtGMV(triple.mtd) + ' · ฐาน ' + nrrFmtGMV(triple.base)
    : 'ฐาน ' + nrrFmtGMV(triple.base);
  return '<div class="' + szCls + '"><div class="num ' + rrCls + sigCls + '"' + rrTitle + '>' + sigHtml + rr + '</div>' +
    '<div class="nrr-triple-sub">' + line2 + '</div></div>';
}
window.nrrTripleHtml = nrrTripleHtml;

// ── v4: unified outlet row — used by slide-over AND movement expansions ──
// One grid for every row (20px chevron slot / text / 150px numbers) so all
// names share the same left edge — this is the alignment fix.
// opts: {showKam, indent, negative} — negative = show lost base (coral).
function nrrOutletRowHtml(o, opts) {
  opts = opts || {};
  var r = o.row;
  var kamMeta = opts.showKam && r.latest_staff_owner
    ? '<span class="nrr-outlet-kam">' + nrrEsc(r.latest_staff_owner) + '</span> · '
    : '';
  // Transfer attribution (verified: base_* = origin, current_* = destination;
  // blank staff owner = the unattributed Admin pool).
  var transferMeta = '';
  if (o.movement === 'transfer_out') {
    transferMeta = ' · <span class="nrr-transfer-attr">→ ' + nrrEsc(r.current_staff_owner || 'Admin pool') + ' (' + nrrEsc(r.current_portfolio || 'ADMIN') + ')</span>';
  } else if (o.movement === 'transfer_in') {
    transferMeta = ' · <span class="nrr-transfer-attr">← ' + nrrEsc(r.base_staff_owner || 'Admin pool') + ' (' + nrrEsc(r.base_portfolio || 'ADMIN') + ')</span>';
  }
  var numbersHtml;
  if (opts.negative) {
    var lost = Math.round((parseFloat(r.base_gmv) || 0) / (parseFloat(r.base_days) || 31) * nrrBaseDays());
    numbersHtml = '<div class="num nrr-lost">−' + nrrFmtGMV(lost) + '</div><div class="nrr-triple-sub">ฐานที่หาย</div>';
  } else {
    var currD = parseFloat(r.curr_days) || 30;
    var mtd = parseFloat(r.curr_gmv) || 0;
    numbersHtml = nrrTripleHtml('sm', {
      base: Math.round(parseFloat(r.base_gmv) || 0),
      mtd: Math.round(mtd),
      run_rate: Math.round(currD > 0 ? mtd / currD * nrrDaysIn(r.period_month) : 0),
      curr_days: currD, days_in_month: nrrDaysIn(r.period_month),
      is_partial: true
    }, { signal: true });
  }
  return '<div class="nrr-row' + (opts.indent ? ' nrr-row-branch' : '') + '">' +
    '<div class="nrr-row-chev"></div>' +
    '<div class="nrr-row-text nrr-row-text-dot">' + nrrMvDotHtml(o.movement) +
    '<div><span class="nrr-row-name">' + nrrEsc(r.res_name || r.account_name) + '</span>' +
    '<div class="nrr-row-meta">' + kamMeta + nrrEsc(r.account_name || '') + transferMeta + '</div></div></div>' +
    '<div class="nrr-row-nums">' + numbersHtml + '</div>' +
    '</div>';
}
window.nrrOutletRowHtml = nrrOutletRowHtml;

// ── v4/v6: movement chart — two views over the same columns ─────────────
// "ทั้งไตรมาส" (quarter/totals, default): base + one column per month, bar
// height = actual total GMV (run-rate/hatched while partial) — churn is
// NOT baked into this bar (a totals view where losses subtract from height
// makes the bar taller than the real number, which is misleading); churn
// shows in the table and in the delta view instead.
// "การเปลี่ยนแปลง" (delta): the original ChartMogul-style above/below-zero
// view — gains stack up, losses (churn/transfer_out) hang below zero.
// opts: {scopeCtx, showKam, onCellClick(mv, cohort, month)} — v6: clicking
// a cell now opens the slide-over directly (see nrrOpenSlideoverMovement)
// instead of an inline expansion row.
var _nrrMvChartMode = {}; // chartContainerId -> 'quarter' | 'delta'

function _nrrQuarterColumnsHtml(result, columns, baseAdjusted, handoverBase, hasAdjustment) {
  var H = 190;
  var maxVal = baseAdjusted + handoverBase;
  var runRates = columns.map(function (c) {
    if (c.isBase) return baseAdjusted + handoverBase;
    var triple = nrrMonthTriple(result, c.month);
    return triple ? triple.run_rate : 0;
  });
  runRates.forEach(function (v) { if (v > maxVal) maxVal = v; });
  var pxPer = maxVal > 0 ? H / maxVal : 0;

  var colsHtml = columns.map(function (c) {
    if (c.isBase) {
      var coreH = Math.max(4, Math.round(baseAdjusted * pxPer));
      var hovH = handoverBase > 0 ? Math.max(3, Math.round(handoverBase * pxPer)) : 0;
      var segs = (hovH ? '<div class="nrr-qcol-seg" style="height:' + hovH + 'px;background:var(--mv-slate);opacity:.45"></div>' : '') +
        '<div class="nrr-qcol-seg" style="height:' + coreH + 'px;background:var(--green);opacity:.35"></div>';
      return '<div class="nrr-qcol">' +
        '<div class="nrr-qcol-cap num">' + nrrFmtGMV(baseAdjusted + handoverBase) + (hasAdjustment ? '<span class="tag muted" style="margin-left:4px">adj</span>' : '') + '</div>' +
        '<div class="nrr-qcol-stack">' + segs + '</div>' +
        '<div class="nrr-qcol-label">' + nrrEsc(c.label) + '</div>' +
        '<div class="nrr-qcol-nrr">&nbsp;</div></div>';
    }
    var bm = result.by_month[c.month];
    var triple = nrrMonthTriple(result, c.month);
    var runRate = triple ? triple.run_rate : 0;
    var mtd = triple ? triple.mtd : 0;
    var isPartial = !!(triple && triple.is_partial);
    // v7-fix: bm.segments[mv] is ALREADY a 30-day run-rate figure
    // (curr_gmv/curr_days*30, see nrr_logic.js) — segments sum to ~run_rate.
    // Column geometry must be: total height = run_rate exactly, where the
    // SOLID portion sums to MTD (each segment scaled down proportionally so
    // relative proportions stay visible) and the hatch fills the remaining
    // (run_rate − MTD). Two earlier attempts got this wrong: clipping
    // sequentially against MTD hid every segment after core_nrr; stacking
    // at full height AND adding the hatch double-counted (column rendered
    // ~2× taller than its own cap label).
    var segTotal = STACK_ORDER.reduce(function (s, mv) { return s + ((bm && bm.segments[mv]) || 0); }, 0);
    var solidScale = (isPartial && segTotal > 0) ? (mtd / segTotal) : 1;
    var upSegs = STACK_ORDER.map(function (mv) {
      var gmv = (bm && bm.segments[mv]) || 0;
      if (gmv <= 0) return '';
      var h = Math.max(2, Math.round(gmv * solidScale * pxPer));
      return '<div class="nrr-qcol-seg" style="height:' + h + 'px;background:' + (MV_COLOR[mv] || 'var(--ink3)') + '"></div>';
    }).join('');
    var hatchHtml = '';
    if (isPartial && runRate > mtd) {
      var hatchH = Math.max(2, Math.round((runRate - mtd) * pxPer));
      hatchHtml = '<div class="nrr-qcol-hatch" style="height:' + hatchH + 'px" title="' + nrrEsc('ส่วนคาดการณ์ (run-rate − MTD)') + '"></div>';
    }
    var pct = bm ? bm.nrr_pct : null;
    return '<div class="nrr-qcol">' +
      '<div class="nrr-qcol-cap num" style="color:' + (isPartial ? 'var(--green-deep)' : 'var(--ink)') + '">' + (isPartial ? '~' : '') + nrrFmtGMV(runRate) + '</div>' +
      '<div class="nrr-qcol-stack">' + hatchHtml + upSegs + '</div>' +
      '<div class="nrr-qcol-label">' + nrrEsc(c.label) + '</div>' +
      '<div class="nrr-qcol-nrr num" style="color:' + nrrThresholdColorVar(pct) + '">' + (pct == null ? '—' : (isPartial ? '~' : '') + pct + '%') + '</div></div>';
  }).join('');
  return '<div class="nrr-qchart">' + colsHtml + '</div>' +
    '<div class="micro" style="margin-top:10px">ลายเฉียง = ส่วนคาดการณ์ของเดือนที่ยังไม่จบ (run-rate − MTD) · churn ไม่รวมในความสูงแท่ง ดูที่ตารางด้านล่าง</div>';
}

function _nrrDeltaColumnsHtml(result, columns, baseAdjusted, handoverBase, hasAdjustment) {
  // Shared scale: gains side sized by the tallest positive stack, losses
  // side by the deepest loss stack — same ฿-per-px on both sides.
  var maxUp = baseAdjusted + handoverBase;
  var maxDown = 0;
  columns.forEach(function (c) {
    if (c.isBase) return;
    var bm = result.by_month[c.month];
    if (!bm) return;
    var up = STACK_ORDER.reduce(function (s, mv) { return s + (bm.segments[mv] || 0); }, 0);
    var down = LOSS_ORDER.reduce(function (s, mv) { return s + (bm.segments[mv] || 0); }, 0);
    if (up > maxUp) maxUp = up;
    if (down > maxDown) maxDown = down;
  });
  var UP_H = 150;
  var pxPer = maxUp > 0 ? UP_H / maxUp : 0;
  var DOWN_H = Math.min(90, Math.max(maxDown > 0 ? 24 : 0, Math.round(maxDown * pxPer)));
  var downPxPer = maxDown > 0 ? DOWN_H / maxDown : 0;

  var colsHtml = columns.map(function (c) {
    var upSegs = '', downSegs = '', hatchHtml = '', topLabel, subLabel, downLabel = '';
    if (c.isBase) {
      var coreH = Math.max(4, Math.round(baseAdjusted * pxPer));
      var hovH = handoverBase > 0 ? Math.max(3, Math.round(handoverBase * pxPer)) : 0;
      upSegs =
        (hovH ? '<div class="nrr-col-seg" style="height:' + hovH + 'px;background:var(--mv-slate)"></div>' : '') +
        '<div class="nrr-col-seg" style="height:' + coreH + 'px;background:var(--green)"></div>';
      topLabel = nrrFmtGMV(baseAdjusted) + (hasAdjustment ? '<span class="tag muted" style="margin-left:4px">adj</span>' : '');
      subLabel = result.cohort_outlets + ' สาขา';
    } else {
      var bm = result.by_month[c.month];
      var upTotal = 0;
      upSegs = STACK_ORDER.map(function (mv) {
        var gmv = (bm && bm.segments[mv]) || 0;
        if (gmv <= 0) return '';
        upTotal += gmv;
        var h = Math.max(3, Math.round(gmv * pxPer));
        return '<div class="nrr-col-seg" style="height:' + h + 'px;background:' + (MV_COLOR[mv] || 'var(--ink3)') + '"></div>';
      }).join('');
      var downTotal = 0;
      downSegs = LOSS_ORDER.map(function (mv) {
        var gmv = (bm && bm.segments[mv]) || 0;
        if (gmv <= 0) return '';
        downTotal += gmv;
        var h = Math.max(3, Math.round(gmv * downPxPer));
        return '<div class="nrr-col-seg" style="height:' + h + 'px;background:' + (MV_COLOR[mv] || 'var(--coral)') + '"></div>';
      }).join('');
      if (downTotal > 0) downLabel = '<div class="nrr-col-down-label num">−' + nrrFmtGMV(downTotal) + '</div>';

      // Hatched projection overlay: portion of the gains stack above MTD.
      var triple = nrrMonthTriple(result, c.month);
      if (triple && triple.is_partial && triple.run_rate > triple.mtd && upTotal > 0) {
        var hatchH = Math.min(Math.round(upTotal * pxPer), Math.max(2, Math.round((triple.run_rate - triple.mtd) * pxPer)));
        hatchHtml = '<div class="nrr-col-hatch" style="height:' + hatchH + 'px" title="' + nrrEsc('ส่วนคาดการณ์ (run-rate − MTD)') + '"></div>';
      }
      // v7-fix: this view answers "เปลี่ยนไปเท่าไหร่" — its headline is the
      // NET change vs the (adjusted) base, not the same gross run-rate the
      // quarter view already shows. Signed + colored so the two views are
      // numerically distinct at a glance.
      var netChange = triple ? triple.run_rate - (baseAdjusted + handoverBase) : null;
      if (netChange == null) topLabel = '—';
      else {
        var netCls = netChange >= 0 ? 'var(--green-deep)' : 'var(--coral)';
        topLabel = '<span style="color:' + netCls + '">' + (triple.is_partial ? '~' : '') + (netChange >= 0 ? '+' : '−') + nrrFmtGMV(Math.abs(netChange)) + '</span>';
      }
      var activeOutlets = bm ? (bm.outlets.core_nrr || 0) : 0;
      subLabel = activeOutlets + ' สาขา' + (triple && triple.is_partial ? ' · MTD ' + nrrFmtGMV(triple.mtd) : '');
    }
    return '<div class="nrr-col">' +
      '<div class="nrr-col-top num">' + topLabel + '</div>' +
      '<div class="nrr-col-up" style="height:' + UP_H + 'px">' + hatchHtml + upSegs + '</div>' +
      (DOWN_H > 0 ? '<div class="nrr-col-down" style="height:' + DOWN_H + 'px">' + downSegs + '</div>' + downLabel : '') +
      '<div class="nrr-col-label">' + nrrEsc(c.label) + '</div>' +
      '<div class="micro">' + subLabel + '</div></div>';
  }).join('');
  return '<div class="nrr-col-chart">' + colsHtml + '</div>';
}

function nrrRenderMovementChart(chartContainerId, tableContainerId, result, opts) {
  opts = opts || {};
  var chartEl = document.getElementById(chartContainerId);
  var tableEl = document.getElementById(tableContainerId);
  if (!chartEl || !tableEl) return;
  if (!result || !result.months || !result.months.length) {
    chartEl.innerHTML = '<div class="micro">ไม่มีข้อมูล</div>';
    tableEl.innerHTML = '';
    return;
  }

  var baseAdjusted = Math.round(result.base_norm * nrrBaseDays());
  var baseOriginal = Math.round((result.base_norm_original || result.base_norm) * nrrBaseDays());
  var handoverBase = Math.round(result.handover_base_norm || 0);
  var hasAdjustment = (result.transfer_out_base_norm || 0) > 0 || (result.transfer_in_base_norm || 0) > 0;

  var columns = [{ label: 'ฐาน (' + (QNRR_CFG.months_th[result.base_month] || result.base_month) + ')', isBase: true }];
  result.months.forEach(function (m) { columns.push({ label: QNRR_CFG.months_th[m] || m, month: m, isBase: false }); });

  if (!_nrrMvChartMode[chartContainerId]) _nrrMvChartMode[chartContainerId] = 'quarter';
  var mode = _nrrMvChartMode[chartContainerId];
  var modeHtml = '<div class="mode">' +
    '<button' + (mode === 'quarter' ? ' class="on"' : '') + ' data-chart-mode="quarter">ทั้งไตรมาส</button>' +
    '<button' + (mode === 'delta' ? ' class="on"' : '') + ' data-chart-mode="delta">การเปลี่ยนแปลง</button>' +
    '</div>';
  var chartBodyHtml = mode === 'quarter'
    ? _nrrQuarterColumnsHtml(result, columns, baseAdjusted, handoverBase, hasAdjustment)
    : _nrrDeltaColumnsHtml(result, columns, baseAdjusted, handoverBase, hasAdjustment);
  chartEl.innerHTML = modeHtml + '<div class="nrr-chart-body">' + chartBodyHtml + '</div>' + nrrLegendHtml();
  chartEl.querySelectorAll('[data-chart-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      _nrrMvChartMode[chartContainerId] = b.dataset.chartMode;
      nrrRenderMovementChart(chartContainerId, tableContainerId, result, opts);
    });
  });

  // ── Breakdown table — every non-zero cell clickable → inline expansion ──
  // Handover & New renders as a cohort block (Sense's verified pattern):
  // parent row = handover + new_sales combined; "└ cohort <base>" sub-row =
  // handover rows (exp date in base month); one "└ cohort <m>" sub-row per
  // non-empty new_sales cohort (claim-dedup by first appearance month,
  // carry-forward afterwards, "—" before).
  var cohortModel = nrrHandoverCohorts(result);

  function cellBtn(rowKey, cohort, month, cls, display) {
    return '<td class="num-cell"><button class="nrr-cell-btn" data-mv="' + rowKey + '" data-cohort="' + nrrEsc(cohort || '') + '" data-month="' + nrrEsc(month) + '" style="color:var(--' + cls + ')">' + display + '</button></td>';
  }
  var DASH = '<td class="micro">—</td>';

  var TABLE_ROWS = [
    { key: 'core_nrr', label: 'Core NRR active', cls: 'green' },
    { key: 'core_nrr_churn', label: '↳ Churn', cls: 'coral', sub: true, negative: true },
    { key: 'expansion', label: 'Expansion', cls: 'mv-green-lt' },
    { key: 'comeback', label: 'Comeback', cls: 'mv-teal' },
    { key: 'transfer_in', label: 'Transfer in', cls: 'mv-violet' },
    { key: 'transfer_out', label: 'Transfer out', cls: 'mv-clay', negative: true }
  ];
  var colCount = columns.length + 1;
  var theadHtml = '<tr><th>Movement</th>' + columns.map(function (c) { return '<th>' + nrrEsc(c.label) + '</th>'; }).join('') + '</tr>';

  function simpleRowHtml(row) {
    var cells = columns.map(function (c) {
      if (c.isBase) {
        if (row.key === 'core_nrr') return '<td class="num-cell">' + nrrFmtGMV(baseAdjusted) + '</td>';
        return DASH;
      }
      var bm = result.by_month[c.month];
      var v = bm ? (bm.segments[row.key] || 0) : 0;
      var n = bm ? (bm.outlets[row.key] || 0) : 0;
      if (v === 0 && n === 0) return DASH;
      var display = row.negative ? '−' + nrrFmtGMV(v) : nrrFmtGMV(v);
      return cellBtn(row.key, '', c.month, row.cls, display);
    }).join('');
    return '<tr data-mv-row="' + row.key + '"' + (row.sub ? ' class="nrr-table-subrow"' : '') + '><td>' + row.label + '</td>' + cells + '</tr>';
  }

  function handoverBlockHtml() {
    var baseLabel = QNRR_CFG.months_th[result.base_month] || result.base_month;
    // Parent row: handover + new_sales combined per month.
    var parentCells = columns.map(function (c) {
      if (c.isBase) return handoverBase > 0 ? '<td class="num-cell">' + nrrFmtGMV(handoverBase) + '</td>' : DASH;
      var bm = result.by_month[c.month];
      var v = bm ? (bm.segments.handover || 0) + (bm.segments.new_sales || 0) : 0;
      var n = bm ? (bm.outlets.handover || 0) + (bm.outlets.new_sales || 0) : 0;
      if (v === 0 && n === 0) return DASH;
      return cellBtn('handover_new', '', c.month, 'mv-slate', nrrFmtGMV(v));
    }).join('');
    var html = '<tr data-mv-row="handover_new"><td>Handover &amp; New</td>' + parentCells + '</tr>';

    // Base cohort sub-row (handover rows) — only when it has anything.
    var hasHandover = handoverBase > 0 || result.months.some(function (m) {
      return (cohortModel.handover.by_month[m] || {}).outlets && cohortModel.handover.by_month[m].outlets.length > 0;
    });
    if (hasHandover) {
      var hovCells = columns.map(function (c) {
        if (c.isBase) return handoverBase > 0 ? '<td class="num-cell">' + nrrFmtGMV(handoverBase) + '</td>' : DASH;
        var cm = cohortModel.handover.by_month[c.month];
        if (!cm || !cm.outlets.length) return DASH;
        return cellBtn('handover_new', 'base', c.month, 'mv-slate', nrrFmtGMV(cm.gmv));
      }).join('');
      html += '<tr data-mv-row="handover_new:base" class="nrr-table-subrow"><td>└ cohort ' + nrrEsc(baseLabel) + '</td>' + hovCells + '</tr>';
    }

    // New-sales cohort sub-rows — only non-empty cohorts render.
    cohortModel.new_cohorts.forEach(function (cohort) {
      var label = QNRR_CFG.months_th[cohort.cohort_month] || cohort.cohort_month;
      var cells = columns.map(function (c) {
        if (c.isBase) return DASH;
        var cm = cohort.by_month[c.month];
        if (!cm || !cm.outlets.length) return DASH; // null before cohort month → "—"
        return cellBtn('handover_new', cohort.cohort_month, c.month, 'mv-slate', nrrFmtGMV(cm.gmv));
      }).join('');
      html += '<tr data-mv-row="handover_new:' + nrrEsc(cohort.cohort_month) + '" class="nrr-table-subrow"><td>└ cohort ' + nrrEsc(label) + '</td>' + cells + '</tr>';
    });
    return html;
  }

  var tbodyHtml =
    simpleRowHtml(TABLE_ROWS[0]) + simpleRowHtml(TABLE_ROWS[1]) +
    handoverBlockHtml() +
    TABLE_ROWS.slice(2).map(simpleRowHtml).join('');
  var totalRow = '<tr class="nrr-table-total"><td>Total GMV</td>' + columns.map(function (c) {
    if (c.isBase) return '<td class="num-cell">' + nrrFmtGMV(baseAdjusted + handoverBase) + '</td>';
    var bm = result.by_month[c.month];
    return '<td class="num-cell">' + (bm ? nrrFmtGMV(bm.total_gmv) : '—') + '</td>';
  }).join('') + '</tr>';

  var adjNote = '';
  if (hasAdjustment) {
    adjNote = '<div class="micro" style="margin-top:8px">ฐานปรับจาก ' + nrrFmtGMV(baseOriginal) + ' → ' + nrrFmtGMV(baseAdjusted) +
      (result.transfer_out_base_norm > 0 ? ' (หัก ' + result.transfer_out_outlets.length + ' outlet ย้ายออก −' + nrrFmtGMV(Math.round(result.transfer_out_base_norm * nrrBaseDays())) + ')' : '') +
      (result.transfer_in_base_norm > 0 ? ' (บวก ' + result.transfer_in_outlets.length + ' outlet ย้ายเข้า +' + nrrFmtGMV(Math.round(result.transfer_in_base_norm * nrrBaseDays())) + ')' : '') +
      '</div>';
  }
  tableEl.innerHTML = '<table class="nrr-table nrr-mv-table"><thead>' + theadHtml + '</thead><tbody>' + tbodyHtml + totalRow + '</tbody></table>' + adjNote;

  // v6: click delegation — every non-zero cell opens the slide-over
  // directly (movement mode) instead of an inline expansion row. Bound
  // once per container; _nrrMvOpts is refreshed on every render so the
  // handler always resolves against the current result/scope.
  if (!tableEl._nrrMvBound) {
    tableEl._nrrMvBound = true;
    tableEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.nrr-cell-btn');
      if (!btn) return;
      var o = tableEl._nrrMvOpts;
      if (!o || !o.onCellClick) return;
      var outlets = _nrrResolveMvOutlets(o, btn.dataset.mv, btn.dataset.cohort || '', btn.dataset.month);
      var prev = tableEl.querySelector('.nrr-cell-btn.on');
      if (prev) prev.classList.remove('on');
      btn.classList.add('on');
      o.onCellClick(btn.dataset.mv, btn.dataset.cohort || '', btn.dataset.month, outlets);
    });
  }
  tableEl._nrrMvOpts = { result: result, scopeCtx: opts.scopeCtx, showKam: opts.showKam, onCellClick: opts.onCellClick, cohortModel: cohortModel };
}
window.nrrRenderMovementChart = nrrRenderMovementChart;

// Resolve the outlet list behind one cell — plain movements come from
// nrrOutletsForMovement; handover_new cells come from the cohort model so
// counts/sums reconcile with the cohort sub-rows by construction.
function _nrrResolveMvOutlets(o, mv, cohort, month) {
  if (mv !== 'handover_new') return nrrOutletsForMovement(o.result, month, mv, o.scopeCtx);
  var cm = o.cohortModel;
  if (cohort === 'base') return (cm.handover.by_month[month] || {}).outlets || [];
  if (cohort) {
    var c = cm.new_cohorts.find(function (x) { return x.cohort_month === cohort; });
    return c && c.by_month[month] ? c.by_month[month].outlets : [];
  }
  // parent = handover + all new_sales cohorts for that month
  var all = ((cm.handover.by_month[month] || {}).outlets || []).slice();
  cm.new_cohorts.forEach(function (c) {
    if (c.by_month[month]) all = all.concat(c.by_month[month].outlets);
  });
  return all;
}

// v6: cohort-aware label helper — used by nrrOpenSlideoverMovement so the
// slide-over title matches what the old inline-expansion header used to say.
function nrrMovementCellLabel(mv, cohort, month) {
  var tagMv = mv === 'handover_new' ? 'handover' : mv;
  var label = mv === 'handover_new' ? 'Handover & New' : (MV_LABEL[tagMv] || tagMv);
  var cohortLabel = '';
  if (mv === 'handover_new' && cohort) {
    cohortLabel = ' · cohort ' + (cohort === 'base' ? (QNRR_CFG.months_th[QNRR_CFG.base_month] || QNRR_CFG.base_month) : (QNRR_CFG.months_th[cohort] || cohort));
  }
  return label + cohortLabel;
}
window.nrrMovementCellLabel = nrrMovementCellLabel;

// ── v6: composition bar — the fix for "only green and white". A single
// glanceable strip under the Pulse hero showing the categorical palette's
// proportions immediately, so the page doesn't read monochrome before the
// user scrolls down to the movement chart. Not a strict ledger (churn/
// transfer_out are losses shown as their own slice, not subtracted) — it's
// a "color signature of the business right now," visible in 5 seconds.
var COMPO_DEFS = [
  { key: 'core_nrr', label: 'Core NRR' },
  { key: 'core_nrr_churn', label: 'Churn' },
  { key: 'handover_new', label: 'Handover & New' },
  { key: 'comeback', label: 'Comeback' },
  { key: 'expansion', label: 'Expansion' },
  { key: 'transfer_in', label: 'Transfer in' },
  { key: 'transfer_out', label: 'Transfer out' }
];
function _nrrCompoColor(key) { return key === 'handover_new' ? MV_COLOR.handover : (MV_COLOR[key] || 'var(--ink3)'); }
function _nrrCompoValue(segs, key) {
  if (key === 'handover_new') return (segs.handover || 0) + (segs.new_sales || 0);
  return segs[key] || 0;
}

function nrrCompositionBarHtml(result, period) {
  var bm = result && period ? result.by_month[period] : null;
  if (!bm) return '';
  var items = COMPO_DEFS.map(function (d) {
    return { key: d.key, label: d.label, v: Math.abs(_nrrCompoValue(bm.segments, d.key)) };
  }).filter(function (x) { return x.v > 0; });
  var total = items.reduce(function (s, x) { return s + x.v; }, 0);
  if (!total) return '';

  var barHtml = items.map(function (x) {
    return '<i style="width:' + (x.v / total * 100).toFixed(2) + '%;background:' + _nrrCompoColor(x.key) + '" title="' + nrrEsc(x.label) + '"></i>';
  }).join('');
  var keyHtml = items.map(function (x) {
    var neg = x.key === 'core_nrr_churn' || x.key === 'transfer_out';
    return '<span class="nrr-compo-k"><i style="background:' + _nrrCompoColor(x.key) + '"></i>' + nrrEsc(x.label) +
      ' <b class="num">' + (neg ? '−' : '') + nrrFmtGMV(x.v) + '</b></span>';
  }).join('');
  var baseLabel = nrrFmtGMV(Math.round((result.base_norm || 0) * nrrBaseDays()));
  return '<div class="nrr-compo">' +
    '<div class="nrr-compo-lbl">องค์ประกอบของฐาน ' + baseLabel + '</div>' +
    '<div class="nrr-compo-bar">' + barHtml + '</div>' +
    '<div class="nrr-compo-key">' + keyHtml + '</div>' +
    '</div>';
}
window.nrrCompositionBarHtml = nrrCompositionBarHtml;

function nrrLegendHtml() {
  var legendMvs = ['core_nrr', 'handover', 'expansion', 'comeback', 'transfer_in', 'core_nrr_churn', 'transfer_out'];
  return '<div class="nrr-movement-legend">' + legendMvs.map(function (mv) {
    return '<div class="nrr-movement-legend-item"><span class="nrr-movement-legend-dot" style="background:' + (MV_COLOR[mv] || 'var(--ink3)') + '"></span>' + (MV_LABEL[mv] || mv) + '</div>';
  }).join('') + '</div>';
}

// ── Threshold coloring (STATUS system — separate from category palette) ──
// ≥100% green, 90-99% amber/sun, <90% coral.
function nrrThresholdColorVar(pct) {
  if (pct == null) return 'var(--ink3)';
  if (pct >= 100) return 'var(--green-deep)'; // text-safe (Raw Papaya) — --green (Cabbage) is the fill/glyph role, too low-contrast for text
  if (pct >= 90) return 'var(--sun-deep)';
  return 'var(--coral)';
}
window.nrrThresholdColorVar = nrrThresholdColorVar;

// ── CSV export — client-side only, UTF-8 BOM so Thai opens right in Excel.
function nrrExportCsv(filename, headers, rows) {
  var esc = function (v) {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  var lines = [headers.map(esc).join(',')].concat(rows.map(function (r) { return r.map(esc).join(','); }));
  var csv = '﻿' + lines.join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
window.nrrExportCsv = nrrExportCsv;

// ── Copy-to-clipboard — for pasting a quick summary into Slack/email.
async function nrrCopyText(text, btnEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (btnEl) {
      var orig = btnEl.textContent;
      btnEl.textContent = 'คัดลอกแล้ว ✓';
      setTimeout(function () { btnEl.textContent = orig; }, 1600);
    }
  } catch (e) {
    console.warn('[nrr] clipboard copy failed', e);
  }
}
window.nrrCopyText = nrrCopyText;
