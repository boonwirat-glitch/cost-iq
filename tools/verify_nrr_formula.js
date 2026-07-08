// tools/verify_nrr_formula.js — standing assertions on the %NRR formula
// (added 2026-07-09 after user-requested validation). Guards two invariants
// against silent refactor drift in src/nrr/nrr_logic.js (and, by twin-file
// convention, src/07c_qnrr_view.js):
//
//   1. 30-day normalization on BOTH sides — the engine's day-rate form
//      (curr_gmv/curr_days ÷ Σ base_gmv/base_days) must equal the explicit
//      ×30-both-sides form for every scope (the ×30 cancels; if someone
//      ever normalizes only one side, this breaks loudly).
//   2. Comeback counts in the NUMERATOR (v848 "Bucci decision 2026-07-07"):
//      engine pct must equal an independent recompute that includes
//      comeback, and the unrounded numerator delta vs a no-comeback
//      variant must equal Σ(comeback curr_gmv/curr_days) exactly.
//
// Usage: node tools/verify_nrr_formula.js <sense_qnrr.csv>
// (fetch the CSV fresh from R2 — invariants hold for any data vintage,
// unlike tools/verify_transfer_in_fix.js whose expected values are pinned
// to the 2026-07-08 export.)

const fs = require('fs');
const [qnrrPath] = process.argv.slice(2);
if (!qnrrPath) {
  console.error('usage: node tools/verify_nrr_formula.js <sense_qnrr.csv>');
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
  out.push(cur); return out;
}
const raw = fs.readFileSync(qnrrPath, 'utf8').split('\n').filter(l => l.trim());
const header = parseRow(raw[0].replace(/^﻿/, ''));
const rows = raw.slice(1).map(l => {
  const c = parseRow(l), o = {};
  header.forEach((h, i) => o[h] = c[i]);
  ['curr_gmv', 'base_gmv', 'base_days', 'curr_days'].forEach(k => o[k] = parseFloat(o[k]) || 0);
  return o;
});
const byKam = {}, byTl = {};
rows.forEach(r => {
  if (r.latest_kam_email) (byKam[r.latest_kam_email] = byKam[r.latest_kam_email] || []).push(r);
  if (r.latest_tl_email) (byTl[r.latest_tl_email] = byTl[r.latest_tl_email] || []).push(r);
});
window.bulkQnrrData = { byKamEmail: byKam, byTlEmail: byTl, allRows: rows, loaded: true };

// Independent kam-scope recompute mirroring _qnrrCompute's formula.
// variant: 'day-rate' | 'x30' (×30 both sides) | 'no-comeback'
function recompute(scopeRows, month, variant) {
  const eff = r => (r.movement_type === 'core_nrr' && r.curr_gmv === 0) ? 'core_nrr_churn' : r.movement_type;
  const K = variant === 'x30' ? 30 : 1;
  const baseMap = {};
  scopeRows.filter(r => r.period_month === month).forEach(r => {
    if (r.base_gmv > 0 && !baseMap[r.outlet_id] && r.movement_type !== 'handover' && eff(r) !== 'transfer_in')
      baseMap[r.outlet_id] = r.base_gmv / (r.base_days || 31) * K;
  });
  let baseNorm = Object.values(baseMap).reduce((s, v) => s + v, 0);
  const tin = {};
  scopeRows.forEach(r => { if (eff(r) === 'transfer_in' && !(r.outlet_id in tin)) tin[r.outlet_id] = (r.base_gmv || 0) / (r.base_days || 31) * K; });
  baseNorm += Object.values(tin).reduce((s, v) => s + v, 0);
  const seen = {}; let num = 0;
  scopeRows.filter(r => r.period_month === month).forEach(r => {
    const mv = eff(r);
    const incl = (mv === 'core_nrr' || mv === 'core_nrr_churn' || mv === 'transfer_in') && r.base_gmv > 0;
    const inclCb = mv === 'comeback' && variant !== 'no-comeback';
    if ((incl || inclCb) && !seen[r.outlet_id]) {
      seen[r.outlet_id] = true;
      const cd = r.curr_days || 30;
      num += cd > 0 ? r.curr_gmv / cd * K : 0;
    }
  });
  return { pct: Math.round(num / baseNorm * 100), num, baseNorm };
}

const months = [...new Set(rows.map(r => r.period_month))].sort();
const M = months[0];
let fails = 0;
function check(label, ok, detail) {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : '*** FAIL ***'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
}

// Run both invariants over EVERY KAM scope (catches per-scope edge cases).
let cbScopesTested = 0;
Object.keys(byKam).forEach(email => {
  const engine = window._qnrrCompute(email, 'kam');
  if (!engine || !engine.by_month[M]) return;
  const enginePct = engine.by_month[M].nrr_pct;
  const a = recompute(byKam[email], M, 'day-rate');
  const b = recompute(byKam[email], M, 'x30');

  if (a.pct !== enginePct || b.pct !== a.pct) {
    check(`30-day equivalence @ ${email}`, false, `engine ${enginePct}% dayrate ${a.pct}% x30 ${b.pct}%`);
  }

  const cbRows = byKam[email].filter(r => r.movement_type === 'comeback' && r.period_month === M);
  if (cbRows.length) {
    cbScopesTested++;
    const c = recompute(byKam[email], M, 'no-comeback');
    const cbDayRate = cbRows.reduce((s, r) => s + (r.curr_days > 0 ? r.curr_gmv / r.curr_days : 0), 0);
    const deltaOk = Math.abs((a.num - c.num) - cbDayRate) < 0.01;
    if (!deltaOk || a.pct !== enginePct) {
      check(`comeback-in-numerator @ ${email}`, false, `delta ${(a.num - c.num).toFixed(2)} vs Σcb ${cbDayRate.toFixed(2)}`);
    }
  }
});
check(`30-day equivalence — all ${Object.keys(byKam).length} KAM scopes`, fails === 0);
check(`comeback-in-numerator — ${cbScopesTested} scopes with comeback rows`, fails === 0 && cbScopesTested > 0,
  cbScopesTested === 0 ? 'no comeback rows in this export — invariant untested' : undefined);

process.exit(fails ? 1 : 0);
