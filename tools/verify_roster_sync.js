#!/usr/bin/env node
// tools/verify_roster_sync.js — fails loudly if any known SQL roster
// location has drifted from docs/roster.json (the exact bug class found
// twice in the 2026-08-18 onboarding audit: 2 files missing a whole
// PM/AD batch, 2 files missing a more recent KAM hire). Run this after
// every tools/sync_roster.js pass, and periodically otherwise, to catch
// drift the moment it happens instead of discovering it months later.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROSTER = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/roster.json'), 'utf8')).people;

let checks = 0;
let failures = 0;
function expect(cond, label) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL  ${label}`); }
  else console.log(`ok    ${label}`);
}

// Every file that should contain the FULL roster (all people, no filter).
const FULL_ROSTER_FILES = [
  'sql/Q8E_portview_v3.sql',
  'sql/Q2B_bulk_categories.sql',
  'sql/Q5B_bulk_outlets.sql',
  'sql/Q6B_bulk_price.sql',
  'sql/Q7B_bulk_sku_current.sql',
  'sql/Q9B_bulk_history.sql',
  'sql/Q12B_bulk_sku_outlet.sql',
  'sql/SQL1_sense_skus.sql',
  'sql/SQL2_sense_alts.sql',
  'sql/q3c_upsell_team_groups_v1.sql',
  'sql/q3c_upsell_bulk_all_kams_v4.sql',
  'sql/q3c_upsell_team_summary_v4.sql',
  'sql/Quarterly_KAM_portfolio_reconcile.sql',
  'sql/Quarterly_upsell_reconcile.sql',
];

// Dedicated PM/AD-only file — every non-KAM person, KAM deliberately absent.
const PM_AD_ONLY_FILES = ['sql/pm_rep_view.sql'];

for (const rel of FULL_ROSTER_FILES) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) { expect(false, `${rel} exists`); continue; }
  const src = fs.readFileSync(fp, 'utf8');
  for (const p of ROSTER) {
    expect(src.includes(`'${p.email}'`), `${rel} contains ${p.name} (${p.email})`);
  }
}

for (const rel of PM_AD_ONLY_FILES) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) { expect(false, `${rel} exists`); continue; }
  const src = fs.readFileSync(fp, 'utf8');
  for (const p of ROSTER.filter((x) => x.owner_type !== 'KAM')) {
    expect(src.includes(`'${p.email}'`), `${rel} contains ${p.name} (${p.email})`);
  }
}

// The 2 legacy files must have been converted to the expected_owner join
// pattern — a bare literal 'KAM' filter anywhere in them means the old,
// broken shape crept back in (e.g. someone pasted an outdated version).
for (const rel of ['sql/q3c_upsell_bulk_all_kams_v4.sql', 'sql/q3c_upsell_team_summary_v4.sql']) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  expect(src.includes('expected_owner'), `${rel} uses the expected_owner join pattern`);
  expect(!/commercial_owner = 'KAM'/.test(src), `${rel} has no leftover literal commercial_owner = 'KAM' filter`);
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);
