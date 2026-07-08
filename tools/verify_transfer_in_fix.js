// tools/verify_transfer_in_fix.js — ground-truth check for the transfer_in
// double-count fix (2026-07-08, nrr_v10). Runs the REAL src/nrr/nrr_logic.js
// in Node against real quarterly CSVs and asserts the corrected numbers.
// Re-run this after the twin fix lands in src/07c_qnrr_view.js (point the
// eval at that file + strip its DOM deps) to prove Sense/nrr parity.
//
// Usage:
//   node tools/verify_transfer_in_fix.js <sense_qnrr.csv> <pm_view.csv> <vp_view.csv>
// CSVs come from the R2 bucket (same files /nrr fetches). Expected values
// below are Q3-2026 ground truth, cross-validated against an independent
// Python replica of the algorithm on 2026-07-08 — they are period data, so
// this script is only meaningful against the 2026-07-08 vintage of the CSVs
// (kept in the handoff doc); against fresher data, read it as a harness and
// update the expectations.

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

checkScope('Tape (kam)', window._qnrrCompute('puttipong.w@freshket.co', 'kam'), 6326715, 99);
checkScope('Bookbig (kam)', window._qnrrCompute('anusorn.k@freshket.co', 'kam'), 9725947, 105);
checkScope('Mild (kam)', window._qnrrCompute('rinlaphat.s@freshket.co', 'kam'), 9038963, 103);
checkScope('TL Ploy', window._qnrrCompute('pavarisa.mu@freshket.co', 'tl'), 59115214, 105);
checkScope('TL Name', window._qnrrCompute('nitipat.s@freshket.co', 'tl'), 76661110, 109);
checkScope('Org admin', window._qnrrCompute(null, 'admin'), 135931139, 107);

const pmRows = loadCsv(pmPath);
check('PM chain NRR%', window.nrrComputeBucket(pmRows, 'chain').by_month[M].nrr_pct, 116);
check('PM sa_mc NRR%', window.nrrComputeBucket(pmRows, 'sa_mc').by_month[M].nrr_pct, 101);

// VP pools all portfolios — has no transfer_in rows, so the fix must be a
// no-op here. 108% is the pre-fix value; any drift means a regression.
check('VP pooled NRR% (unchanged)', window.nrrComputeRowsPool(loadCsv(vpPath), 'vp').by_month[M].nrr_pct, 108);

process.exit(fails ? 1 : 0);
