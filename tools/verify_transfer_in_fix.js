// tools/verify_transfer_in_fix.js — ground-truth check for the transfer_in
// double-count fix (2026-07-08, nrr_v10). Runs the REAL src/nrr/nrr_logic.js
// in Node against real quarterly CSVs and asserts the corrected numbers.
// Re-run this after the twin fix lands in src/07c_qnrr_view.js (point the
// eval at that file + strip its DOM deps) to prove Sense/nrr parity.
//
// Usage:
//   node tools/verify_transfer_in_fix.js <sense_qnrr.csv> <pm_view.csv> <vp_view.csv>
// CSVs come from the R2 bucket (same files /nrr fetches). Expected values
// below are Q3-2026 period data — pinned to a specific CSV vintage; against
// fresher data, read it as a harness and update the expectations.
//
// RE-PIN 2026-08-07 (นโยบาย MONTH-SCOPED TRANSFER): ตัวเลขทั้งชุดถูกปักใหม่
// กับไฟล์รุ่น 2026-08-07 หลังเปลี่ยนกฎเป็น "ย้ายเดือน M มีผลกับฐานตั้งแต่เดือน M"
// (เดิม quarter-wide retroactive) — เลขเก่ารุ่น 2026-07-08 ใช้เทียบไม่ได้ทั้งจาก
// ข้อมูลใหม่ (tin-full + การย้ายพอร์ตหลังจากนั้น) และจากนโยบายใหม่
// Ground truth ภายนอก: May (treerak.s) ก.ค. = 103.2% ตรงกับ hand-reconcile
// ของบุชใน Google Sheet (tab May_n, 2026-08-07) ถึงบาท — ฐาน 6,453,184 ของเดือน
// ก.ค. ไม่รวมโอเพ่น คิทเช่น ฿150,467 ที่ย้ายเข้า ส.ค. (จุดที่นโยบายเดิมคิดผิด)

const fs = require('fs');
const [qnrrPath, pmPath, vpPath] = process.argv.slice(2);
if (!qnrrPath || !pmPath || !vpPath) {
  console.error('usage: node tools/verify_transfer_in_fix.js <sense_qnrr.csv> <pm_view.csv> <vp_view.csv>');
  process.exit(2);
}

global.window = {};
eval(fs.readFileSync(__dirname + '/../src/nrr/nrr_logic.js', 'utf8'));

function parseRow(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function loadCsv(path) {
  const raw = fs.readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
  const header = parseRow(raw[0].replace(/^﻿/, ''));
  return raw.slice(1).map(l => {
    const c = parseRow(l), o = {};
    header.forEach((h, i) => o[h] = c[i]);
    ['curr_gmv', 'base_gmv', 'base_days', 'curr_days'].forEach(k => o[k] = parseFloat(o[k]) || 0);
    return o;
  });
}

const rows = loadCsv(qnrrPath);
const byKam = {}, byTl = {};
rows.forEach(r => {
  if (r.latest_kam_email) (byKam[r.latest_kam_email] = byKam[r.latest_kam_email] || []).push(r);
  if (r.latest_tl_email) (byTl[r.latest_tl_email] = byTl[r.latest_tl_email] || []).push(r);
});
window.bulkQnrrData = { byKamEmail: byKam, byTlEmail: byTl, allRows: rows, loaded: true };
global.nrrAccountBucket = r => {
  const t = (r.account_type || '').trim();
  return t === 'Chain' ? 'chain' : (t === 'SA' || t === 'MC') ? 'sa_mc' : 'other';
};

const M = '2026-07';
let fails = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : '*** FAIL ***'}  ${label}: ${actual} (expected ${expected})`);
}
function checkScope(label, res, expBase, expNrr) {
  check(`${label} base_gmv`, Math.round(res.base_gmv), expBase);
  check(`${label} NRR%`, res.by_month[M].nrr_pct, expNrr);
}

checkScope('Tape (kam)', window._qnrrCompute('puttipong.w@freshket.co', 'kam'), 6326715, 102.5);
checkScope('Bookbig (kam)', window._qnrrCompute('anusorn.k@freshket.co', 'kam'), 9786673, 107.6);
checkScope('Mild (kam)', window._qnrrCompute('rinlaphat.s@freshket.co', 'kam'), 9156560, 100.5);
// May — ground truth ภายนอก (บุช hand-reconcile ยืนยัน 103.2%; ดูหัวไฟล์)
checkScope('May (kam)', window._qnrrCompute('treerak.s@freshket.co', 'kam'), 6603651, 103.2);
checkScope('TL Ploy', window._qnrrCompute('pavarisa.mu@freshket.co', 'tl'), 59578478, 102.8);
checkScope('TL Name', window._qnrrCompute('nitipat.s@freshket.co', 'tl'), 77066948, 107.3);
checkScope('Org admin', window._qnrrCompute(null, 'admin'), 136809250, 105.4);

const pmRows = loadCsv(pmPath);
check('PM chain NRR%', window.nrrComputeBucket(pmRows, 'chain').by_month[M].nrr_pct, 112.5);
check('PM sa_mc NRR%', window.nrrComputeBucket(pmRows, 'sa_mc').by_month[M].nrr_pct, 98.3);

// VP pools all portfolios — has no transfer_in rows, so the transfer fix and
// the month-scoped policy must both be no-ops here; any drift = regression.
check('VP pooled NRR% (no transfers, policy no-op)', window.nrrComputeRowsPool(loadCsv(vpPath), 'vp').by_month[M].nrr_pct, 105.3);

process.exit(fails ? 1 : 0);
