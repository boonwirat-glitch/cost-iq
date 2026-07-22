// tools/verify_adsplit_roster.js — v_adsplit regression harness
// Verifies role-aware NRR scoping: portfolio holders whose profiles.role is
// not KAM (window.nrrRoleRoster.nonKamSet) are excluded from 'tl'/'admin'
// scopes, re-bucketed under the new 'ad' scope, self-view untouched, and
// org GMV/base reconcile exactly (same rows, re-bucketed).
// Usage: node tools/verify_adsplit_roster.js [kam_rep_view.csv]
//        (default path expects a fresh curl of the live R2 CSV)
const fs = require('fs');
const vm = require('vm');

const csvText = fs.readFileSync(process.argv[2] || '/tmp/kam_rep_view_now.csv', 'utf8');
const sandbox = { window: {}, console };
sandbox.csvTextGlobal = csvText;
vm.createContext(sandbox);
for (const f of ['src/nrr/nrr_data.js', 'src/nrr/nrr_logic.js', 'src/nrr/nrr_aggregate.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
}

vm.runInContext(`
  var bulk = _nrrParseQnrrCsv(csvTextGlobal); bulk.loaded = true; window.bulkQnrrData = bulk;
  var PLOY = 'pavarisa.mu@freshket.co', ICE = 'ornpreya.s@freshket.co';
  var ICE_ROWS = bulk.allRows.filter(function(r){ return r.latest_kam_email === ICE && r.period_month === '2026-07'; }).length;
  function snap(r){ if(!r) return null; var p = nrrCurrentPeriod(r); var bm = r.by_month[p];
    return { pct: bm.nrr_pct, base_norm: Math.round(r.base_norm), total_gmv: Math.round(bm.total_gmv), rows: bm.rows.length }; }

  // BEFORE: empty roster (default) — old behavior
  var ployBefore = snap(_qnrrCompute(PLOY, 'tl'));
  var orgBefore  = snap(_qnrrCompute(null, 'admin'));
  var iceKamView = snap(_qnrrCompute(ICE, 'kam'));
  var adBefore   = _qnrrCompute(null, 'ad'); // empty adSet -> no rows -> null

  // AFTER: inject roster with Ice as 'ad'
  window.nrrRoleRoster = { loaded: true, nonKamSet: new Set([ICE]), adSet: new Set([ICE]) };
  var ployAfter = snap(_qnrrCompute(PLOY, 'tl'));
  var orgAfter  = snap(_qnrrCompute(null, 'admin'));
  var adAfter   = snap(_qnrrCompute(null, 'ad'));
  var iceSelfAfter = snap(_qnrrCompute(ICE, 'kam'));
  var kamsPloy = nrrListKamsForTeam(PLOY).map(function(k){return k.email;});

  var checks = [
    ['ad scope null when roster empty', adBefore === null],
    ['Ploy rows dropped by Ice-row-count', ployBefore.rows - ployAfter.rows === ICE_ROWS],
    ['Ploy base shrank', ployAfter.base_norm < ployBefore.base_norm],
    ['org rows dropped by Ice-row-count', orgBefore.rows - orgAfter.rows === ICE_ROWS],
    ['AD bucket == Ice self-view pct', adAfter.pct === iceKamView.pct],
    ['AD bucket rows == Ice-row-count', adAfter.rows === ICE_ROWS],
    ['org GMV reconciles (before == after + ad)', Math.abs(orgBefore.total_gmv - (orgAfter.total_gmv + adAfter.total_gmv)) <= 1],
    ['org base reconciles', Math.abs(orgBefore.base_norm - (orgAfter.base_norm + adAfter.base_norm)) <= 1],
    ['Ice self-view unchanged', JSON.stringify(iceSelfAfter) === JSON.stringify(iceKamView)],
    ['Ice removed from team KAM list', kamsPloy.indexOf(ICE) === -1],
    ['other KAMs still listed', kamsPloy.length >= 7]
  ];
  var fails = 0;
  checks.forEach(function(c){ console.log((c[1] ? 'PASS' : '*** FAIL ***') + '  ' + c[0]); if(!c[1]) fails++; });
  console.log('---');
  console.log('Ploy %NRR: ' + ployBefore.pct + ' -> ' + ployAfter.pct + ' | org KAM: ' + orgBefore.pct + ' -> ' + orgAfter.pct + ' | AD: ' + adAfter.pct);
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILED');
`, sandbox);
