// ── nrr_company.js — Company Overview (#/company) + Sales (#/sales) views ──
// v28: both views moved OUT of the dashboard (exec feedback on the v27
// deploy: company content must not mix into the dashboard's journey, the
// inline pipeline outlet list was unusable at 3k rows, and the section had
// no real visual design). Admin-only — nrr_router.js guards both routes.
//
// Journey design:
//   #/company — "How is the company doing?"
//     §1 hero (echoes the dashboard's .nrr-pulse 3-col grid): big MTD
//        number + end-of-month projection verdict + B2C/Chain/SA-MC
//        satellites + month chips; composition strip below.
//     §2 squad race — Chain vs SA/MC monthly columns in the app-native
//        div-column language (.nrr-qcol-* family) with the established
//        hatch-overlay projection visual on the MTD month.
//     §3 squad cards — per-squad total + MoM delta + Sales/KAM/PM/Admin
//        stacked mini-bar (lightness ramp of the squad hue, values always
//        direct-labeled) + "waiting in Sales' hands" link to #/sales.
//     §4 audit table — the sheet-mirror table for reconciling with the
//        "Target & Plan 2H 2026" Google Sheet.
//   #/sales — "What's in Sales' hands and when does it convert?"
//     §1 handover pipeline chips (overdue → +3mo) — click opens the
//        slideover (commission-drawer custom-body precedent) with its own
//        search + chunked rows, never an inline dump.
//     §2 monthly actuals by account_type.
//
// Data: nrrCompanyModel/nrrSalesByBucket/nrrSalesPipelineModel
// (nrr_aggregate.js) over company_gmv.csv + sales_handover_pipeline.csv
// (nrr_data.js, both 404-graceful). Squad colors #c56a2c (Chain) /
// #1295a8 (SA/MC) — validated for lightness/chroma/CVD/contrast in both
// light & dark via the dataviz palette checker (2026-07-10).

var nrrCompanyState = {
  month: null,      // selected month_key for hero + squad cards (null = latest)
  chartWindow: 6,   // 3 | 6 | 0(all) months shown in the race chart
  tableWindow: 6    // same for the audit table
};

var NRR_CO_COLORS = {
  chain: '#c56a2c',
  sa_mc: '#1295a8',
  b2c: 'var(--mv-slate)'
};
// Lightness ramp (as rgba alphas over white) for the Sales/KAM/PM/Admin
// stack inside one squad — sequential-within-hue, identity always carried
// by the labeled key next to it, never color alone.
var NRR_CO_RAMP = { sales: 1, kam: 0.72, pm: 0.48, admin: 0.28 };
var NRR_CO_RGB = { chain: '197,106,44', sa_mc: '18,149,168' };
var NRR_CO_SUBS = [
  { key: 'sales', label: 'Sales' },
  { key: 'kam', label: 'KAM' },
  { key: 'pm', label: 'PM' },
  { key: 'admin', label: 'Admin' }
];

// ── Shared helpers ────────────────────────────────────────────────────────

// Day-of-month of the lag-1 anchor — data always trails 1 calendar day.
function _nrrCompanyMtdDay() {
  var d = new Date(); d.setDate(d.getDate() - 1);
  return d.getDate();
}

function _nrrCoDaysInMonth(monthKey) {
  var p = monthKey.split('-');
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10), 0).getDate();
}

function _nrrCompanyStaleBannerHtml(cd) {
  if (!cd || !cd.isStale) return '';
  return '<div class="nrr-stale-banner">⚠️ company_gmv.csv มีข้อมูลถึงเดือน ' + nrrEsc(cd.maxMonthKey || '—') +
    ' แต่เดือนปัจจุบันคือ ' + nrrEsc(cd.currMonthKey || '—') +
    ' — ไฟล์ยังไม่ได้ re-run/upload ใหม่ ตัวเลขด้านล่างไม่ใช่ข้อมูลล่าสุด</div>';
}

// {mtd, proj, is_partial, curr_days, days_in_month} for one month of the
// company model — raw actuals; proj = straight-line run-rate on the MTD month.
function _nrrCoMonthFigures(model, cd, monthKey) {
  var m = model.by_month[monthKey];
  if (!m) return null;
  var isMtd = cd && cd.currMonthKey && monthKey === cd.currMonthKey;
  var dim = _nrrCoDaysInMonth(monthKey);
  var days = isMtd ? Math.min(_nrrCompanyMtdDay(), dim) : dim;
  var proj = isMtd && days > 0 ? m.total / days * dim : m.total;
  return { mtd: m.total, proj: proj, is_partial: isMtd, curr_days: days, days_in_month: dim };
}

function _nrrCoWindowMonths(model, win) {
  return win > 0 ? model.months.slice(-win) : model.months.slice();
}

function _nrrCoSegHtml(id, current, options, dataAttr) {
  return '<div class="seg" id="' + id + '">' + options.map(function (o) {
    return '<button' + (current === o[0] ? ' class="on"' : '') + ' data-' + dataAttr + '="' + o[0] + '">' + o[1] + '</button>';
  }).join('') + '</div>';
}

function _nrrCoNotFoundHtml(title, fileName, sqlName) {
  return '<div class="nrr-section"><div class="nrr-panel-body">' +
    '<div class="nrr-panel-head"><div class="h2">' + title + '</div></div>' +
    '<div class="micro" style="margin-top:8px">ยังไม่มีข้อมูล — ไฟล์ ' + fileName +
    ' ยังไม่ถูกอัปโหลดไป R2 (รัน ' + sqlName + ' ใน BigQuery แล้วอัปโหลดก่อน)</div>' +
    '</div></div>';
}

// ── §1 Company hero ───────────────────────────────────────────────────────

function _nrrCoHeroHtml(model, cd, selKey) {
  var m = model.by_month[selKey];
  var fig = _nrrCoMonthFigures(model, cd, selKey);
  var months = model.months;
  var idx = months.indexOf(selKey);
  var prevKey = idx > 0 ? months[idx - 1] : null;
  var prevTotal = prevKey ? model.by_month[prevKey].total : null;

  // Verdict: projection + MoM vs previous month's actual
  var momPct = prevTotal > 0 ? Math.round((fig.proj - prevTotal) / prevTotal * 1000) / 10 : null;
  var momTxt = momPct == null ? '' :
    ' · เทียบ' + nrrEsc((model.labels[prevKey] || prevKey).split(' ')[0]) + ' ' + (momPct >= 0 ? '+' : '') + momPct + '%';
  var verdict = fig.is_partial
    ? 'คาดการณ์จบเดือน ~' + nrrFmtGMV(fig.proj) + momTxt
    : 'จบเดือนที่ ' + nrrFmtGMV(m.total) + momTxt;

  var satDot = function (color) { return '<span class="nrr-sat-dot" style="background:' + color + '"></span>'; };
  var satellitesHtml = '<div class="nrr-pulse-satellites">' +
    '<span>' + satDot(NRR_CO_COLORS.b2c) + 'B2C <b class="num">' + nrrFmtGMV(m.b2c.gmv) + '</b></span>' +
    '<span>' + satDot(NRR_CO_COLORS.chain) + 'Chain <b class="num">' + nrrFmtGMV(m.squads.chain.total) + '</b></span>' +
    '<span>' + satDot(NRR_CO_COLORS.sa_mc) + 'SA/MC <b class="num">' + nrrFmtGMV(m.squads.sa_mc.total) + '</b></span>' +
    '</div>';

  // Custom 3-cell triple with company-appropriate labels (raw actuals —
  // .nrr-triple-lg CSS reused, labels differ from the NRR "ฐาน" semantics)
  var tripleHtml = '<div class="nrr-triple-lg">' +
    '<div class="nrr-triple-cell"><div class="nrr-triple-label">เดือนก่อน</div><div class="num nrr-triple-base">' + (prevTotal != null ? nrrFmtGMV(prevTotal) : '—') + '</div></div>' +
    '<div class="nrr-triple-cell"><div class="nrr-triple-label">' + (fig.is_partial ? 'MTD · ' + fig.curr_days + '/' + fig.days_in_month + ' วัน' : 'ทั้งเดือน') + '</div><div class="num nrr-triple-mtd">' + nrrFmtGMV(fig.mtd) + '</div></div>' +
    '<div class="nrr-triple-cell"><div class="nrr-triple-label">' + (fig.is_partial ? 'คาดการณ์สิ้นเดือน' : 'จบเดือน') + '</div><div class="num nrr-triple-rr' + (fig.is_partial ? ' nrr-rr-proj' : '') + '">' + (fig.is_partial ? '~' : '') + nrrFmtGMV(fig.proj) + '</div></div>' +
    '</div>';

  // Month chips: last 4 months, chronological — MTD chip gets a progress bar
  var chipMonths = months.slice(-4);
  var chipsHtml = chipMonths.map(function (k) {
    var f = _nrrCoMonthFigures(model, cd, k);
    var progress = '';
    if (f && f.is_partial) {
      var w = Math.round(f.curr_days / f.days_in_month * 100);
      progress = '<span class="nrr-month-progress"><span style="width:' + w + '%"></span></span>';
    }
    return '<button class="nrr-month-chip' + (k === selKey ? ' on' : '') + '" data-mkey="' + k + '">' +
      nrrEsc((model.labels[k] || k).split(' ')[0]) + progress + '</button>';
  }).join('');

  // Composition strip — B2C / Chain / SA-MC of the selected month
  var compoItems = [
    { label: 'B2C', v: m.b2c.gmv, color: NRR_CO_COLORS.b2c },
    { label: 'Squad Chain', v: m.squads.chain.total, color: NRR_CO_COLORS.chain },
    { label: 'Squad SA/MC', v: m.squads.sa_mc.total, color: NRR_CO_COLORS.sa_mc }
  ].filter(function (x) { return x.v > 0; });
  var compoTotal = compoItems.reduce(function (s, x) { return s + x.v; }, 0);
  var compoHtml = '';
  if (compoTotal > 0) {
    compoHtml = '<div class="nrr-compo">' +
      '<div class="nrr-compo-lbl">องค์ประกอบของยอด ' + nrrEsc(model.labels[selKey] || selKey) + ' ' + nrrFmtGMV(m.total) + (fig.is_partial ? ' (MTD)' : '') + '</div>' +
      '<div class="nrr-compo-bar">' + compoItems.map(function (x) {
        return '<i style="width:' + (x.v / compoTotal * 100).toFixed(2) + '%;background:' + x.color + '" title="' + nrrEsc(x.label) + '"></i>';
      }).join('') + '</div>' +
      '<div class="nrr-compo-key">' + compoItems.map(function (x) {
        return '<span class="nrr-compo-k"><i style="background:' + x.color + '"></i>' + nrrEsc(x.label) + ' <b class="num">' + nrrFmtGMV(x.v) + '</b></span>';
      }).join('') + '</div>' +
      '</div>';
  }

  return '<div class="nrr-pulse">' +
    '  <div class="nrr-pulse-verdict">' +
    '    <div class="eyebrow">บริษัท · GMV ทุก SEGMENT · ' + nrrEsc(model.labels[selKey] || selKey) + '</div>' +
    '    <div class="nrr-pulse-pct num">' + (fig.is_partial ? '' : '') + nrrFmtGMV(fig.mtd) + '</div>' +
    '    <div class="nrr-verdict">' + verdict + '</div>' + satellitesHtml +
    '  </div>' +
    '  <div class="nrr-pulse-triple">' + tripleHtml + '</div>' +
    '  <div class="nrr-pulse-months">' + chipsHtml + '</div>' +
    '</div>' +
    compoHtml;
}

// ── §2 Squad trend charts — each squad's OWN growth, not a head-to-head ──
// (exec feedback: a paired comparison chart reads as "which squad wins" —
// wanted each squad's own trajectory instead). Two independent single-
// series charts, same div-column + hatch-projection language as before,
// placed side by side.

function _nrrCoSquadTrendChartHtml(model, cd, sq) {
  var months = _nrrCoWindowMonths(model, nrrCompanyState.chartWindow);
  if (!months.length) return '';
  var color = NRR_CO_COLORS[sq];
  var H = 150;

  var maxVal = 0;
  months.forEach(function (k) {
    var f = _nrrCoMonthFigures(model, cd, k);
    var v = model.by_month[k].squads[sq].total;
    if (f.is_partial && f.curr_days > 0) v = v / f.curr_days * f.days_in_month;
    if (v > maxVal) maxVal = v;
  });
  var pxPer = maxVal > 0 ? H / maxVal : 0;
  var lastKey = months[months.length - 1];

  var colsHtml = months.map(function (k) {
    var m = model.by_month[k];
    var f = _nrrCoMonthFigures(model, cd, k);
    var actual = m.squads[sq].total;
    var proj = f.is_partial && f.curr_days > 0 ? actual / f.curr_days * f.days_in_month : actual;
    var solidH = Math.max(3, Math.round(actual * pxPer));
    var hatchH = f.is_partial ? Math.max(0, Math.round((proj - actual) * pxPer)) : 0;
    var isLast = k === lastKey;
    var title = (model.labels[k] || k) + ': ' + nrrFmtGMVExact(actual) + (f.is_partial ? ' (MTD · คาดการณ์ ~' + nrrFmtGMV(proj) + ')' : '');
    // Every column gets its own value label (not just the latest) — the
    // latest still reads as the "headline" via bolder weight + squad color,
    // earlier months in muted ink so the eye still lands on "now" first.
    var capText = (f.is_partial ? '~' : '') + nrrFmtGMV(f.is_partial ? proj : actual);
    var capHtml = '<div class="nrr-cogroup-caps num" style="color:' + (isLast ? color : 'var(--ink2)') +
      ';font-weight:' + (isLast ? '700' : '600') + ';font-size:' + (isLast ? '12.5px' : '11px') + '">' + capText + '</div>';
    return '<div class="nrr-cogroup">' + capHtml +
      '<div class="nrr-cogroup-cols" style="height:' + H + 'px">' +
      '<div class="nrr-cocol" style="width:34px;max-width:42px" title="' + nrrEsc(title) + '">' +
      (hatchH > 0 ? '<div class="nrr-cocol-seg" style="height:' + hatchH + 'px;background:repeating-linear-gradient(-45deg, rgba(255,255,255,0.55) 0 3px, rgba(255,255,255,0) 3px 9px), ' + color + '"></div>' : '') +
      '<div class="nrr-cocol-seg" style="height:' + solidH + 'px;background:' + color + '"></div>' +
      '</div></div>' +
      '<div class="nrr-cogroup-label">' + nrrEsc((model.labels[k] || k).split(' ')[0]) + (f.is_partial ? '<span class="micro"> (MTD)</span>' : '') + '</div>' +
      '</div>';
  }).join('');

  // This squad's own MoM, for the header line above its chart
  var lastF = _nrrCoMonthFigures(model, cd, lastKey);
  var lastActual = model.by_month[lastKey].squads[sq].total;
  var lastProj = lastF.is_partial && lastF.curr_days > 0 ? lastActual / lastF.curr_days * lastF.days_in_month : lastActual;
  var prevKey = months.length >= 2 ? months[months.length - 2] : null;
  var prevTotal = prevKey ? model.by_month[prevKey].squads[sq].total : null;
  var momPct = prevTotal > 0 ? Math.round((lastProj - prevTotal) / prevTotal * 1000) / 10 : null;
  var momHtml = momPct == null ? '' : '<span class="tag ' + (momPct >= 0 ? 'green' : 'coral') + '" style="margin-left:8px">' + (momPct >= 0 ? '+' : '') + momPct + '% MoM</span>';

  return '<div>' +
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
    '<span class="nrr-sat-dot" style="background:' + color + '"></span>' +
    '<span style="font-weight:700;font-size:14.5px">' + (sq === 'chain' ? 'Squad Chain' : 'Squad SA/MC') + '</span>' + momHtml +
    '</div>' +
    '<div class="nrr-cochart">' + colsHtml + '</div>' +
    '</div>';
}

// ── §3 Squad cards ────────────────────────────────────────────────────────

function _nrrCoSquadCardsHtml(model, cd, selKey) {
  var m = model.by_month[selKey];
  var months = model.months;
  var idx = months.indexOf(selKey);
  var prevKey = idx > 0 ? months[idx - 1] : null;
  var fig = _nrrCoMonthFigures(model, cd, selKey);
  var pm = typeof nrrSalesPipelineModel === 'function' ? nrrSalesPipelineModel() : null;

  var cardsHtml = ['chain', 'sa_mc'].map(function (sq) {
    var s = m.squads[sq];
    var name = sq === 'chain' ? 'Squad Chain' : 'Squad SA/MC';
    var color = NRR_CO_COLORS[sq];
    var proj = fig.is_partial && fig.curr_days > 0 ? s.total / fig.curr_days * fig.days_in_month : s.total;
    var prevTotal = prevKey ? model.by_month[prevKey].squads[sq].total : null;
    var momPct = prevTotal > 0 ? Math.round((proj - prevTotal) / prevTotal * 1000) / 10 : null;
    var momTag = momPct == null ? '' :
      '<span class="tag ' + (momPct >= 0 ? 'green' : 'coral') + '">' + (momPct >= 0 ? '+' : '') + momPct + '% MoM</span>';

    // Sub-component stacked bar (Sales/KAM/PM/Admin — lightness ramp)
    var subTotal = NRR_CO_SUBS.reduce(function (t, d) { return t + s[d.key]; }, 0);
    var barHtml = '', keyHtml = '';
    if (subTotal > 0) {
      barHtml = '<div class="nrr-compo-bar" style="margin-top:12px">' + NRR_CO_SUBS.map(function (d) {
        var v = s[d.key];
        if (v <= 0) return '';
        return '<i style="width:' + (v / subTotal * 100).toFixed(2) + '%;background:rgba(' + NRR_CO_RGB[sq] + ',' + NRR_CO_RAMP[d.key] + ')" title="' + d.label + '"></i>';
      }).join('') + '</div>';
      keyHtml = '<div class="nrr-compo-key" style="margin-top:8px">' + NRR_CO_SUBS.map(function (d) {
        return '<span class="nrr-compo-k"><i style="background:rgba(' + NRR_CO_RGB[sq] + ',' + NRR_CO_RAMP[d.key] + ')"></i>' + d.label +
          ' <b class="num">' + nrrFmtGMV(s[d.key]) + '</b></span>';
      }).join('') + '</div>';
    }

    var pipelineGmv = pm && pm.bySquad ? pm.bySquad[sq] || 0 : 0;
    var handoverHtml = pipelineGmv > 0
      ? '<div class="nrr-squad-handover">รอส่งมอบจาก Sales <b class="num">' + nrrFmtGMV(pipelineGmv) + '</b> <a href="#/sales">ดู pipeline →</a></div>'
      : '';

    // The big number is always the MTD/actual — labeled explicitly above it
    // so it's never confused with the run-rate, which gets its own line in
    // the app's established projected-value style ("~" + dotted underline).
    var subLineHtml = fig.is_partial
      ? '<div class="nrr-team-sub nrr-rr-proj" style="display:inline-block">~' + nrrFmtGMV(proj) + ' run-rate เต็มเดือน</div>'
      : '<div class="nrr-team-sub">ทั้งเดือน</div>';

    return '<div class="nrr-team" style="border-top:3px solid ' + color + ';padding-top:14px">' +
      '<div class="nrr-team-top"><span class="nrr-sat-dot" style="background:' + color + '"></span><span class="nrr-team-nm">' + name + '</span>' + momTag + '</div>' +
      '<div class="micro" style="margin-top:6px">' + (fig.is_partial ? 'MTD' : 'ยอดจริง') + '</div>' +
      '<div class="nrr-team-pct num" style="color:' + color + '">' + nrrFmtGMV(s.total) + '</div>' +
      subLineHtml +
      barHtml + keyHtml + handoverHtml +
      '</div>';
  }).join('');

  // B2C gets its own row below — a slim horizontal bar, not a third card,
  // so the two squad cards can each spread full-width (exec feedback).
  var b2cPrev = prevKey ? model.by_month[prevKey].b2c.gmv : null;
  var b2cProj = fig.is_partial && fig.curr_days > 0 ? m.b2c.gmv / fig.curr_days * fig.days_in_month : m.b2c.gmv;
  var b2cMom = b2cPrev > 0 ? Math.round((b2cProj - b2cPrev) / b2cPrev * 1000) / 10 : null;
  var b2cRowHtml = '<div class="nrr-b2c-row">' +
    '<span class="nrr-sat-dot" style="background:' + NRR_CO_COLORS.b2c + '"></span>' +
    '<span style="font-weight:700">B2C</span>' +
    '<b class="num" style="font-size:20px">' + nrrFmtGMV(m.b2c.gmv) + '</b>' +
    (fig.is_partial ? '<span class="micro nrr-rr-proj">~' + nrrFmtGMV(b2cProj) + ' run-rate</span>' : '<span class="micro">ทั้งเดือน</span>') +
    '<span class="micro">' + m.b2c.orders.toLocaleString() + ' ออเดอร์</span>' +
    (b2cMom == null ? '' : '<span class="tag ' + (b2cMom >= 0 ? 'green' : 'coral') + '">' + (b2cMom >= 0 ? '+' : '') + b2cMom + '% MoM</span>') +
    '</div>';

  return '<div class="nrr-team-cards">' + cardsHtml + '</div>' + b2cRowHtml;
}

// ── §4 Audit table (sheet mirror) ─────────────────────────────────────────

function _nrrCoAuditTableHtml(model, cd) {
  var months = _nrrCoWindowMonths(model, nrrCompanyState.tableWindow);
  var lastKey = months[months.length - 1];
  var isMtd = cd && cd.currMonthKey && lastKey === cd.currMonthKey;
  var dim = isMtd ? _nrrCoDaysInMonth(lastKey) : null;
  var currDays = isMtd ? Math.min(_nrrCompanyMtdDay(), dim) : null;

  // The current (MTD) month becomes TWO real columns — actual MTD and
  // projected run-rate — instead of stacking two lines in one cell. Keeps
  // every row single-line (shorter rows) and each number independently
  // scannable/sortable-by-eye instead of visually paired.
  var cols = [];
  months.forEach(function (k) {
    if (isMtd && k === lastKey) { cols.push({ key: k, kind: 'mtd' }); cols.push({ key: k, kind: 'proj' }); }
    else cols.push({ key: k, kind: 'actual' });
  });

  function headHtml(col) {
    var lbl = nrrEsc(model.labels[col.key] || col.key);
    if (col.kind === 'actual') return '<th style="text-align:right;white-space:nowrap">' + lbl + '</th>';
    if (col.kind === 'mtd') return '<th style="text-align:right;white-space:nowrap">' + lbl + '<div class="micro" style="font-weight:400">MTD ถึงวันที่ ' + _nrrCompanyMtdDay() + '</div></th>';
    return '<th style="text-align:right;white-space:nowrap;color:var(--ink3)">Run-rate<div class="micro" style="font-weight:400">คาดการณ์เต็มเดือน</div></th>';
  }
  function cellHtml(col, v) {
    if (col.kind === 'proj') {
      if (!v || !currDays) return '<td class="num" style="text-align:right;color:var(--ink3)">—</td>';
      var proj = v / currDays * dim;
      return '<td class="num nrr-rr-proj" style="text-align:right;color:var(--ink2)">~' + nrrFmtGMV(proj) + '</td>';
    }
    return '<td class="num" style="text-align:right">' + (v ? nrrFmtGMVExact(v) : '—') + '</td>';
  }

  // Squad rows/sub-rows carry a colored left-border "stripe" (+ a dot on the
  // bold total row) in the squad's own hue, so the whole block scans as one
  // color at a glance — matches the trend-chart/squad-card colors exactly.
  function rowHtml(label, getter, opts) {
    opts = opts || {};
    // Squad total rows get a light tint of the squad's own color so they
    // pop above their Sales/KAM/PM/Admin sub-rows at a glance. Set on BOTH
    // the <tr> (covers ordinary cells) AND the label <td>'s own inline
    // style (an inline style always beats the sticky-column CSS class's
    // opaque background, which would otherwise hide the tint on that cell).
    var bg = opts.highlightRgb ? 'background:rgba(' + opts.highlightRgb + ',0.08);' : '';
    var cells = cols.map(function (col) { return cellHtml(col, getter(model.by_month[col.key])); }).join('');
    var style = (opts.bold ? 'font-weight:600;' : '') +
      'padding-left:' + (opts.indent ? '26px' : '12px') + ';' +
      (opts.squadColor ? 'border-left:3px solid ' + opts.squadColor + ';' : '') + bg;
    var dotHtml = opts.dot ? '<span class="nrr-sat-dot" style="background:' + opts.dot + ';margin-right:7px"></span>' : '';
    var rowStyle = (opts.topline ? 'border-top:1px solid var(--line);' : '') + bg;
    return '<tr' + (rowStyle ? ' style="' + rowStyle + '"' : '') + '>' +
      '<td style="' + style + 'white-space:nowrap">' + dotHtml + label + '</td>' + cells + '</tr>';
  }
  var headCells = cols.map(headHtml).join('');
  var hasUnassigned = months.some(function (k) { return model.by_month[k].unassigned > 0; });

  var rows =
    rowHtml('B2C', function (m) { return m.b2c.gmv; }) +
    rowHtml('Squad Chain', function (m) { return m.squads.chain.total; }, { bold: true, topline: true, dot: NRR_CO_COLORS.chain, squadColor: NRR_CO_COLORS.chain, highlightRgb: NRR_CO_RGB.chain }) +
    rowHtml('Sales', function (m) { return m.squads.chain.sales; }, { indent: true, squadColor: NRR_CO_COLORS.chain }) +
    rowHtml('KAM', function (m) { return m.squads.chain.kam; }, { indent: true, squadColor: NRR_CO_COLORS.chain }) +
    rowHtml('PM', function (m) { return m.squads.chain.pm; }, { indent: true, squadColor: NRR_CO_COLORS.chain }) +
    rowHtml('Admin', function (m) { return m.squads.chain.admin; }, { indent: true, squadColor: NRR_CO_COLORS.chain }) +
    rowHtml('Squad SA/MC', function (m) { return m.squads.sa_mc.total; }, { bold: true, topline: true, dot: NRR_CO_COLORS.sa_mc, squadColor: NRR_CO_COLORS.sa_mc, highlightRgb: NRR_CO_RGB.sa_mc }) +
    rowHtml('Sales', function (m) { return m.squads.sa_mc.sales; }, { indent: true, squadColor: NRR_CO_COLORS.sa_mc }) +
    rowHtml('KAM', function (m) { return m.squads.sa_mc.kam; }, { indent: true, squadColor: NRR_CO_COLORS.sa_mc }) +
    rowHtml('PM', function (m) { return m.squads.sa_mc.pm; }, { indent: true, squadColor: NRR_CO_COLORS.sa_mc }) +
    rowHtml('Admin', function (m) { return m.squads.sa_mc.admin; }, { indent: true, squadColor: NRR_CO_COLORS.sa_mc }) +
    (hasUnassigned ? rowHtml('ยังไม่จัดกลุ่ม (other/unassigned)', function (m) { return m.unassigned; }, { topline: true }) : '') +
    rowHtml('Total GMV', function (m) { return m.total; }, { bold: true, topline: true });

  return '<div style="overflow-x:auto;margin-top:12px">' +
    '<table class="nrr-table nrr-table-compact nrr-table-sticky-col"><thead><tr><th>Segment</th>' + headCells + '</tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>' +
    '<div class="micro" style="margin-top:10px">' +
    'ยอดจริงจาก DWH (gmv_ex_vat, ไม่ normalize) · KAM แบ่ง squad ตามพอร์ตของ TL (squad_params ใน Supabase) — ' +
    'ไม่ใช่ตาม account_type ของร้าน (ยกเว้นร้านที่หา KAM เจ้าของไม่เจอในทะเบียน จะแบ่งตาม account_type แทน) · ' +
    'Sales/PM/Admin แบ่งตาม account_type ตรงๆ · B2C = account_type Consumer/Enduser · ' +
    'เดือนล่าสุดแยกคอลัมน์ MTD (ยอดจริงถึงวันนี้) กับ Run-rate (คาดการณ์เต็มเดือน)</div>';
}

// ── #/company view ────────────────────────────────────────────────────────

function nrrRenderCompanyView() {
  var page = document.getElementById('nrr-company-page');
  if (!page) return;
  var cd = window.bulkCompanyData;
  if (cd && cd.notFound) {
    page.innerHTML = _nrrCoNotFoundHtml('ภาพรวมบริษัท', 'company_gmv.csv', 'sql/company_gmv.sql');
    return;
  }
  var model = typeof nrrCompanyModel === 'function' ? nrrCompanyModel() : null;
  if (!model || !model.months.length) {
    page.innerHTML = _nrrCoNotFoundHtml('ภาพรวมบริษัท', 'company_gmv.csv', 'sql/company_gmv.sql');
    return;
  }
  var months = model.months;
  var selKey = nrrCompanyState.month && months.indexOf(nrrCompanyState.month) > -1
    ? nrrCompanyState.month : months[months.length - 1];

  page.innerHTML =
    // §1 hero
    '<div class="nrr-section"><div class="nrr-panel-body">' +
    _nrrCompanyStaleBannerHtml(cd) +
    _nrrCoHeroHtml(model, cd, selKey) +
    '</div></div>' +
    // §2 squad trends — each squad's own growth, side by side (not a
    // head-to-head comparison)
    '<div class="nrr-section"><div class="nrr-panel-body">' +
    '<div class="nrr-panel-head"><div class="h2">เทรนด์รายเดือน — แยกตาม Squad</div>' +
    _nrrCoSegHtml('nrr-co-chart-seg', nrrCompanyState.chartWindow, [[3, '3 เดือน'], [6, '6 เดือน'], [0, 'ทั้งหมด']], 'cowin') +
    '</div>' +
    '<div style="display:flex;gap:0;margin-top:10px;flex-wrap:wrap">' +
    '<div style="flex:1;min-width:280px;padding-right:28px">' + _nrrCoSquadTrendChartHtml(model, cd, 'chain') + '</div>' +
    '<div style="flex:1;min-width:280px;padding-left:28px;border-left:1px solid var(--line)">' + _nrrCoSquadTrendChartHtml(model, cd, 'sa_mc') + '</div>' +
    '</div>' +
    '<div class="micro" style="margin-top:12px">แถบลาย = คาดการณ์ส่วนที่เหลือของเดือน</div>' +
    '</div></div>' +
    // §3 squad cards
    '<div class="nrr-section"><div class="nrr-panel-body">' +
    '<div class="nrr-panel-head"><div class="h2">เจาะราย Squad — ' + nrrEsc(model.labels[selKey] || selKey) + '</div></div>' +
    _nrrCoSquadCardsHtml(model, cd, selKey) +
    '</div></div>' +
    // §4 audit table
    '<div class="nrr-section"><div class="nrr-panel-body">' +
    '<div class="nrr-panel-head"><div class="h2">ตารางอ้างอิง — เทียบกับ Target & Plan sheet</div>' +
    _nrrCoSegHtml('nrr-co-table-seg', nrrCompanyState.tableWindow, [[3, '3 เดือน'], [6, '6 เดือน'], [0, 'ทั้งหมด']], 'cotable') +
    '</div>' +
    _nrrCoAuditTableHtml(model, cd) +
    '</div></div>';
}

function nrrHandleCompanyClick(e) {
  var chip = e.target.closest('.nrr-month-chip[data-mkey]');
  if (chip) { nrrCompanyState.month = chip.dataset.mkey; nrrRenderCompanyView(); return; }
  var cw = e.target.closest('button[data-cowin]');
  if (cw) { nrrCompanyState.chartWindow = parseInt(cw.dataset.cowin, 10); nrrRenderCompanyView(); return; }
  var tw = e.target.closest('button[data-cotable]');
  if (tw) { nrrCompanyState.tableWindow = parseInt(tw.dataset.cotable, 10); nrrRenderCompanyView(); return; }
}

// ── #/sales view ──────────────────────────────────────────────────────────
// v29: pipeline is a real table stretching out into named future months
// (from nrrSalesPipelineModel's order/labels — 'overdue', 'm0'..'m{N}',
// 'no_date'), not a fixed 6-chip summary — so it reads as "how much is
// still outstanding, month by month" rather than a snapshot. Color is
// urgency (status), same tokens as before; identity is always the visible
// month label, never color alone.

function _nrrPipeBucketColor(key) {
  if (key === 'overdue') return 'var(--coral)';
  if (key === 'no_date') return 'var(--ink3)';
  var n = parseInt(key.replace('m', ''), 10);
  return n <= 1 ? 'var(--sun-deep)' : 'var(--ink2)';
}

function _nrrSalesPipelineTakeaway(pm) {
  var b = pm.buckets;
  var near = (b.m0 ? b.m0.gmv : 0) + (b.m1 ? b.m1.gmv : 0);
  return 'Sales ถืออยู่ ' + nrrFmtGMV(pm.total) + ' (ยอดเดือนปิดล่าสุด) · จะส่งมอบภายใน 2 เดือน ~' + nrrFmtGMV(near) +
    (b.overdue.gmv > 0 ? ' · เลยกำหนดแล้ว ' + nrrFmtGMV(b.overdue.gmv) + ' (' + b.overdue.outlets.toLocaleString() + ' ร้าน)' : '');
}

function _nrrSalesPipelineTableHtml(pm) {
  var headCells = pm.order.map(function (key) {
    return '<th style="text-align:right;white-space:nowrap;color:' + _nrrPipeBucketColor(key) + '">' + nrrEsc(pm.labels[key]) + '</th>';
  }).join('');
  var hasOther = pm.order.some(function (key) { return pm.buckets[key].bySquad.other.gmv > 0; });

  function cellHtml(key, squadKey) {
    var b = squadKey ? pm.buckets[key].bySquad[squadKey] : pm.buckets[key];
    var attrs = 'data-bucket="' + key + '"' + (squadKey ? ' data-squad="' + squadKey + '"' : '');
    if (!b.gmv) return '<td class="num nrr-pipe-cell" ' + attrs + ' style="text-align:right;cursor:pointer;color:var(--ink3)">—</td>';
    return '<td class="num nrr-pipe-cell" ' + attrs + ' style="text-align:right;cursor:pointer">' +
      nrrFmtGMVExact(b.gmv) +
      '<div class="micro" style="margin-top:1px;color:var(--ink3)">' + b.outlets.toLocaleString() + ' ร้าน</div></td>';
  }
  function rowHtml(label, squadKey, opts) {
    opts = opts || {};
    var color = squadKey === 'chain' ? NRR_CO_COLORS.chain : squadKey === 'sa_mc' ? NRR_CO_COLORS.sa_mc : null;
    var dotHtml = color ? '<span class="nrr-sat-dot" style="background:' + color + ';margin-right:7px"></span>' : '';
    var borderStyle = color ? 'border-left:3px solid ' + color + ';' : '';
    var cells = pm.order.map(function (key) { return cellHtml(key, squadKey); }).join('');
    return '<tr' + (opts.topline ? ' style="border-top:1px solid var(--line)"' : '') + '>' +
      '<td style="' + (opts.bold ? 'font-weight:600;' : '') + borderStyle + 'padding-left:12px;white-space:nowrap">' + dotHtml + label + '</td>' + cells + '</tr>';
  }
  return '<div style="overflow-x:auto">' +
    '<table class="nrr-table nrr-table-compact"><thead><tr><th></th>' + headCells + '</tr></thead>' +
    '<tbody>' +
    rowHtml('Chain', 'chain') +
    rowHtml('SA/MC', 'sa_mc') +
    (hasOther ? rowHtml('อื่นๆ', 'other') : '') +
    rowHtml('รวม Sales ทั้งหมด', null, { bold: true, topline: true }) +
    '</tbody></table></div>' +
    '<div class="micro" style="margin-top:8px">กดตัวเลขเพื่อดูรายชื่อร้าน (แยกตาม Sales รายคนได้) · SA ต้องส่งมอบใน 45 วัน / MC-Chain ใน 90 วัน นับจากคำสั่งซื้อแรก</div>';
}

function _nrrSalesActualsTableHtml(model, cd) {
  var months = model.months;
  var lastKey = months[months.length - 1];
  var isMtd = cd && cd.currMonthKey && lastKey === cd.currMonthKey;
  var mtdChip = isMtd ? ' <span class="micro">(MTD ถึงวันที่ ' + _nrrCompanyMtdDay() + ')</span>' : '';
  var dim = isMtd ? _nrrCoDaysInMonth(lastKey) : null;
  var currDays = isMtd ? Math.min(_nrrCompanyMtdDay(), dim) : null;
  var headCells = months.map(function (k) {
    return '<th style="text-align:right;white-space:nowrap">' + nrrEsc(model.labels[k] || k) + (isMtd && k === lastKey ? mtdChip : '') + '</th>';
  }).join('');
  var ROW_COLOR = { chain: NRR_CO_COLORS.chain, sa_mc: NRR_CO_COLORS.sa_mc };
  function rowHtml(label, key, opts) {
    opts = opts || {};
    var cells = months.map(function (k) {
      var v = model.by_month[k][key];
      if (!v) return '<td class="num" style="text-align:right">—</td>';
      if (isMtd && k === lastKey && currDays > 0) {
        var proj = v / currDays * dim;
        return '<td class="num" style="text-align:right">' + nrrFmtGMVExact(v) +
          '<div class="micro nrr-rr-proj" style="margin-top:1px">~' + nrrFmtGMV(proj) + ' run-rate</div></td>';
      }
      return '<td class="num" style="text-align:right">' + nrrFmtGMVExact(v) + '</td>';
    }).join('');
    var color = ROW_COLOR[key];
    var dotHtml = color ? '<span class="nrr-sat-dot" style="background:' + color + ';margin-right:7px"></span>' : '';
    var borderStyle = color ? 'border-left:3px solid ' + color + ';' : '';
    return '<tr' + (opts.topline ? ' style="border-top:1px solid var(--line)"' : '') + '>' +
      '<td style="' + (opts.bold ? 'font-weight:600;' : '') + borderStyle + 'padding-left:12px;white-space:nowrap">' + dotHtml + label + '</td>' + cells + '</tr>';
  }
  var hasOther = months.some(function (k) { return model.by_month[k].other > 0; });
  return '<div style="overflow-x:auto">' +
    '<table class="nrr-table"><thead><tr><th>Account Type</th>' + headCells + '</tr></thead>' +
    '<tbody>' +
    rowHtml('Chain', 'chain') +
    rowHtml('SA/MC', 'sa_mc') +
    (hasOther ? rowHtml('อื่นๆ', 'other') : '') +
    rowHtml('รวม Sales', 'total', { bold: true, topline: true }) +
    '</tbody></table></div>' +
    '<div class="micro" style="margin-top:10px">' +
    'ยอดซื้อลูกค้าใหม่จาก DWH order ที่ commercial_owner = SALE ตรงๆ (ไม่มี NRR concept) · ' +
    'แบ่งตาม account_type ของร้าน · เดือนปัจจุบันเป็น MTD (ข้อมูลช้ากว่าจริง 1 วัน)</div>';
}

function nrrRenderSalesView() {
  var page = document.getElementById('nrr-sales-page');
  if (!page) return;
  var pd = window.bulkSalesPipelineData;
  var cd = window.bulkCompanyData;
  var pm = typeof nrrSalesPipelineModel === 'function' ? nrrSalesPipelineModel() : null;
  var salesModel = typeof nrrSalesByBucket === 'function' ? nrrSalesByBucket() : null;

  var pipelineHtml;
  if (pd && pd.notFound) {
    pipelineHtml = '<div class="micro" style="margin-top:8px">ยังไม่มีข้อมูล pipeline — ไฟล์ sales_handover_pipeline.csv ยังไม่ถูกอัปโหลดไป R2 (รัน sql/sales_handover_pipeline.sql ใน BigQuery แล้วอัปโหลดก่อน)</div>';
  } else if (!pm) {
    pipelineHtml = '<div class="micro" style="margin-top:8px">ยังไม่มีข้อมูล sales_handover_pipeline.csv</div>';
  } else {
    pipelineHtml = '<div class="nrr-takeaway micro">' + nrrEsc(_nrrSalesPipelineTakeaway(pm)) + '</div>' +
      _nrrSalesPipelineTableHtml(pm);
  }

  var actualsHtml;
  if (cd && cd.notFound) {
    actualsHtml = '<div class="micro" style="margin-top:8px">ยังไม่มีข้อมูล — ไฟล์ company_gmv.csv ยังไม่ถูกอัปโหลดไป R2</div>';
  } else if (!salesModel || !salesModel.months.length) {
    actualsHtml = '<div class="micro" style="margin-top:8px">ยังไม่มีข้อมูล Sales ใน company_gmv.csv</div>';
  } else {
    actualsHtml = _nrrCompanyStaleBannerHtml(cd) + _nrrSalesActualsTableHtml(salesModel, cd);
  }

  page.innerHTML =
    '<div class="nrr-section"><div class="nrr-panel-body">' +
    '<div class="nrr-panel-head"><div class="h2">Pipeline การส่งมอบ (Handover Forecast)</div></div>' +
    pipelineHtml +
    '</div></div>' +
    '<div class="nrr-section"><div class="nrr-panel-body">' +
    '<div class="nrr-panel-head"><div class="h2">ยอดซื้อลูกค้าใหม่ — commercial_owner = SALE</div></div>' +
    actualsHtml +
    '</div></div>';
}

function nrrHandleSalesClick(e) {
  var cell = e.target.closest('.nrr-pipe-cell[data-bucket]');
  if (cell) { nrrOpenPipelineDrawer(cell.dataset.bucket, cell.dataset.squad || null); return; }
}

// ── Pipeline drawer — slideover with custom body (commission precedent) ──
// Two levels: (1) per-Sales-rep summary (short — ~15 reps, always cheap to
// render even for the 3k-row overdue bucket) is the default view; clicking
// a rep drills into (2) that rep's own outlet list, chunked (first 100,
// +300 per "โหลดเพิ่ม") behind a dedicated search input, so the drawer
// never locks the DOM even for the biggest bucket.

var nrrPipeDrawerState = null; // { bucketKey, squadKey, search, shown, repFilter }

var NRR_PIPE_SQUAD_LABEL = { chain: 'Chain', sa_mc: 'SA/MC', other: 'อื่นๆ' };

function nrrOpenPipelineDrawer(bucketKey, squadKey) {
  var pm = typeof nrrSalesPipelineModel === 'function' ? nrrSalesPipelineModel() : null;
  if (!pm || !pm.buckets[bucketKey]) return;
  var label = pm.labels[bucketKey];
  var b = squadKey ? pm.buckets[bucketKey].bySquad[squadKey] : pm.buckets[bucketKey];
  if (!b) return;
  nrrCommDrawerState = null; // leaving commission mode (stale-guards its async fetch)
  nrrPipeDrawerState = { bucketKey: bucketKey, squadKey: squadKey || null, search: '', shown: 100, repFilter: null };

  document.getElementById('nrr-slideover-title').textContent = 'Pipeline — ' + label + (squadKey ? ' · ' + NRR_PIPE_SQUAD_LABEL[squadKey] : '');
  document.getElementById('nrr-slideover-sub').textContent = b.outlets.toLocaleString() + ' ร้าน · ' + nrrFmtGMVExact(b.gmv);
  // Hide the shared search/chips rows — _nrrOpenSlideover restores them on
  // its next open (same pattern as the commission drawer)
  document.getElementById('nrr-slideover-search').parentElement.style.display = 'none';
  document.getElementById('nrr-slideover-chips').parentElement.style.display = 'none';
  document.getElementById('nrr-slideover-momentum-chips').style.display = 'none';
  document.getElementById('nrr-slideover-body').innerHTML =
    '<div style="padding:4px 2px 12px"><input class="nrr-search" id="nrr-pipe-search" placeholder="ค้นหาร้านค้า หรือชื่อ Sales..." style="width:100%"></div>' +
    '<div id="nrr-pipe-rows"></div>';
  nrrRenderPipeRows();
  var searchEl = document.getElementById('nrr-pipe-search');
  searchEl.addEventListener('input', function () {
    nrrPipeDrawerState.search = searchEl.value.trim().toLowerCase();
    nrrPipeDrawerState.shown = 100;
    nrrRenderPipeRows();
  });
  document.getElementById('nrr-slideover-backdrop').classList.add('on');
  document.getElementById('nrr-slideover').classList.add('on');
}
window.nrrOpenPipelineDrawer = nrrOpenPipelineDrawer;

function _nrrPipeOutletRowHtml(r, today) {
  var dTxt;
  if (r.new_user_exp_date) {
    var d = new Date(r.new_user_exp_date + 'T00:00:00');
    if (!isNaN(d.getTime())) {
      var days = Math.round((d - today) / 86400000);
      var rel = days < 0 ? '<span style="color:var(--coral)">เลย ' + Math.abs(days) + ' วัน</span>'
              : days === 0 ? 'วันนี้' : 'อีก ' + days + ' วัน';
      dTxt = 'ครบกำหนด ' + r.new_user_exp_date + ' (' + rel + ')';
    } else { dTxt = 'ไม่มีกำหนดส่งมอบ'; }
  } else { dTxt = 'ไม่มีกำหนดส่งมอบ'; }
  return '<div class="nrr-pipe-row">' +
    '<div class="nrr-pipe-main">' +
    '<div class="nrr-pipe-name">' + nrrEsc(r.account_name || r.account_id || r.outlet_id || '—') + '</div>' +
    '<div class="micro">' + nrrEsc(r.account_type || '—') + ' · ' + dTxt + '</div>' +
    '</div>' +
    '<div class="num nrr-pipe-gmv">' + (r.last_month_gmv > 0 ? nrrFmtGMVExact(r.last_month_gmv) : '—') + '</div>' +
    '</div>';
}

function nrrRenderPipeRows() {
  var wrap = document.getElementById('nrr-pipe-rows');
  if (!wrap || !nrrPipeDrawerState) return;
  var pm = typeof nrrSalesPipelineModel === 'function' ? nrrSalesPipelineModel() : null;
  if (!pm) { wrap.innerHTML = ''; return; }
  var bucketRows = pm.buckets[nrrPipeDrawerState.bucketKey].rows;
  var squadKey = nrrPipeDrawerState.squadKey;
  if (squadKey) {
    bucketRows = bucketRows.filter(function (r) {
      var sq = (r.bucket === 'chain' || r.bucket === 'sa_mc') ? r.bucket : 'other';
      return sq === squadKey;
    });
  }
  var q = nrrPipeDrawerState.search;

  // ── Level 1: per-Sales-rep summary (default view) ──
  if (nrrPipeDrawerState.repFilter === null) {
    var reps = nrrPipelineByRep(bucketRows);
    if (q) reps = reps.filter(function (r) { return r.rep.toLowerCase().indexOf(q) > -1; });
    if (!reps.length) { wrap.innerHTML = '<div class="micro" style="padding:10px 0">ไม่พบ Sales ที่ตรงกับคำค้น</div>'; return; }
    var repsHtml = reps.map(function (r) {
      return '<div class="nrr-pipe-row nrr-pipe-rep-row" data-rep="' + nrrEsc(r.rep) + '" style="cursor:pointer">' +
        '<div class="nrr-pipe-main">' +
        '<div class="nrr-pipe-name">' + nrrEsc(r.rep) + '</div>' +
        '<div class="micro">' + r.outlets.toLocaleString() + ' ร้าน</div>' +
        '</div>' +
        '<div class="num nrr-pipe-gmv">' + nrrFmtGMVExact(r.gmv) + ' →</div>' +
        '</div>';
    }).join('');
    wrap.innerHTML = '<div class="micro" style="margin-bottom:6px">แยกตาม Sales — กดชื่อเพื่อดูรายร้าน</div>' + repsHtml;
    wrap.querySelectorAll('.nrr-pipe-rep-row').forEach(function (el) {
      el.addEventListener('click', function () {
        nrrPipeDrawerState.repFilter = el.dataset.rep;
        nrrPipeDrawerState.search = '';
        nrrPipeDrawerState.shown = 100;
        var s = document.getElementById('nrr-pipe-search'); if (s) s.value = '';
        nrrRenderPipeRows();
      });
    });
    return;
  }

  // ── Level 2: one rep's outlets, chunked ──
  var rows = bucketRows.filter(function (r) {
    var repKey = (r.staff_owner || '').trim() || 'ไม่ระบุ Sales';
    return repKey === nrrPipeDrawerState.repFilter;
  });
  if (q) {
    rows = rows.filter(function (r) {
      return (r.account_name || '').toLowerCase().indexOf(q) > -1 ||
             (r.account_type || '').toLowerCase().indexOf(q) > -1 ||
             (r.outlet_id || '').indexOf(q) > -1;
    });
  }
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var shown = rows.slice(0, nrrPipeDrawerState.shown);
  var rowsHtml = shown.map(function (r) { return _nrrPipeOutletRowHtml(r, today); }).join('');
  var moreHtml = rows.length > shown.length
    ? '<button class="btn-secondary nrr-pipe-more">โหลดเพิ่ม (แสดง ' + shown.length + ' จาก ' + rows.length.toLocaleString() + ' ร้าน)</button>'
    : (rows.length ? '<div class="micro" style="text-align:center;padding:10px 0">แสดงครบ ' + rows.length.toLocaleString() + ' ร้านแล้ว</div>' : '<div class="micro" style="padding:10px 0">ไม่พบร้านที่ตรงกับคำค้น</div>');
  wrap.innerHTML =
    '<button class="btn-secondary nrr-pipe-back" style="margin-bottom:10px">← กลับไปดูตาม Sales</button>' +
    '<div class="micro" style="margin-bottom:6px;font-weight:600">' + nrrEsc(nrrPipeDrawerState.repFilter) + '</div>' +
    rowsHtml + '<div style="text-align:center;margin-top:10px">' + moreHtml + '</div>';
  var backBtn = wrap.querySelector('.nrr-pipe-back');
  if (backBtn) {
    backBtn.addEventListener('click', function () {
      nrrPipeDrawerState.repFilter = null;
      nrrPipeDrawerState.search = '';
      nrrPipeDrawerState.shown = 100;
      var s = document.getElementById('nrr-pipe-search'); if (s) s.value = '';
      nrrRenderPipeRows();
    });
  }
  var moreBtn = wrap.querySelector('.nrr-pipe-more');
  if (moreBtn) {
    moreBtn.addEventListener('click', function () {
      nrrPipeDrawerState.shown += 300;
      nrrRenderPipeRows();
    });
  }
}

// ── Route registration (nrr_router.js is injected before this module) ────
nrrRouterRegister('company', nrrRenderCompanyView);
nrrRouterRegister('sales', nrrRenderSalesView);
window.nrrRenderCompanyView = nrrRenderCompanyView;
window.nrrRenderSalesView = nrrRenderSalesView;
window.nrrHandleCompanyClick = nrrHandleCompanyClick;
window.nrrHandleSalesClick = nrrHandleSalesClick;
