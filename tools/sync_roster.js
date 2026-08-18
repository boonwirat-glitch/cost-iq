#!/usr/bin/env node
// tools/sync_roster.js — the "make onboarding easy" tool.
//
// Reads docs/roster.json (the ONE canonical KAM/PM/AD roster) and patches
// every known SQL location that independently hardcodes this roster, so a
// future hire only ever requires: (1) add one entry to docs/roster.json,
// (2) run this script, (3) run tools/verify_roster_sync.js until green.
//
// Idempotent — safe to re-run. Each target file is only touched if the
// roster it should contain differs from docs/roster.json; a person already
// present (matched by email) is never duplicated.
//
// Built 2026-08-18 to onboard 2 new AD hires (Koi, Wanmai) and to fix two
// pre-existing drift bugs found in the same audit: q3c_upsell_bulk_all_kams_v4.sql
// and q3c_upsell_team_summary_v4.sql were still on the OLD 2-column
// (kam_name, kam_email) shape with a literal `commercial_owner = 'KAM'`
// filter — the 2026-07-17 PM/AD rollout's roster fix for these two files
// only ever landed in a dated handoff snapshot folder, never in the
// canonical sql/ directory Bush actually runs (confirmed via git log).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROSTER = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/roster.json'), 'utf8')).people;

function structRow(p, cols) {
  const parts = cols.map((col) => {
    if (col === 'kam_name') return `'${p.name}' AS kam_name`;
    if (col === 'kam_email') return `'${p.email}' AS kam_email`;
    if (col === 'tl_email') return p.tl_email ? `'${p.tl_email}' AS tl_email` : `CAST(NULL AS STRING) AS tl_email`;
    if (col === 'tl_name') return p.tl_name ? `'${p.tl_name}' AS tl_name` : `CAST(NULL AS STRING) AS tl_name`;
    if (col === 'expected_owner') return `'${p.owner_type}' AS expected_owner`;
    throw new Error('sync_roster: unknown column ' + col);
  });
  return `    STRUCT(${parts.join(', ')})`;
}

// ── Simple-append targets ───────────────────────────────────────────────
// Each already uses the correct shape and just needs whoever's missing
// (matched by email) spliced in right after the given anchor line — the
// anchor is the exact current LAST row of that file's roster array.
const APPEND_TARGETS = [
  { file: 'sql/Q8E_portview_v3.sql', cols: ['kam_name', 'kam_email', 'tl_email', 'expected_owner'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai' AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'PM' AS expected_owner)",
    filter: () => true },
  { file: 'sql/Q2B_bulk_categories.sql', cols: ['kam_name', 'kam_email', 'tl_email', 'expected_owner'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai' AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'PM' AS expected_owner)",
    filter: () => true },
  { file: 'sql/Q9B_bulk_history.sql', cols: ['kam_name', 'kam_email', 'tl_email', 'expected_owner'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai' AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'PM' AS expected_owner)",
    filter: () => true },
  { file: 'sql/SQL2_sense_alts.sql', cols: ['kam_name', 'kam_email', 'tl_email', 'expected_owner'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai' AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'PM' AS expected_owner)",
    filter: () => true },
  { file: 'sql/Q5B_bulk_outlets.sql', cols: ['kam_name', 'kam_email', 'expected_owner'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai' AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'PM' AS expected_owner)",
    filter: () => true },
  { file: 'sql/Q6B_bulk_price.sql', cols: ['kam_name', 'kam_email', 'expected_owner'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai' AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'PM' AS expected_owner)",
    filter: () => true },
  { file: 'sql/Q7B_bulk_sku_current.sql', cols: ['kam_name', 'kam_email', 'expected_owner'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai' AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'PM' AS expected_owner)",
    filter: () => true },
  { file: 'sql/Q12B_bulk_sku_outlet.sql', cols: ['kam_name', 'kam_email', 'expected_owner'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai' AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'PM' AS expected_owner)",
    filter: () => true },
  { file: 'sql/SQL1_sense_skus.sql', cols: ['kam_name', 'kam_email', 'expected_owner'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai' AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'PM' AS expected_owner)",
    filter: () => true },
  { file: 'sql/q3c_upsell_team_groups_v1.sql', cols: ['kam_name', 'kam_email', 'expected_owner'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai'               AS kam_name, 'ornpreya.s@freshket.co'     AS kam_email, 'PM'  AS expected_owner)",
    filter: () => true },
  // Dedicated PM/AD-only file — different shape (tl_name instead of expected_owner), KAM excluded.
  { file: 'sql/pm_rep_view.sql', cols: ['kam_name', 'kam_email', 'tl_email', 'tl_name'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai'   AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name)",
    filter: (p) => p.owner_type !== 'KAM' },
  // Also missing "May" (a KAM) as a separate, older drift bug — falls out
  // naturally since these two include every role and match on email.
  { file: 'sql/Quarterly_KAM_portfolio_reconcile.sql', cols: ['kam_name', 'kam_email', 'tl_email', 'expected_owner'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai'               AS kam_name, 'ornpreya.s@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'PM'  AS expected_owner)",
    filter: () => true },
  { file: 'sql/Quarterly_upsell_reconcile.sql', cols: ['kam_name', 'kam_email', 'tl_email', 'expected_owner'],
    anchor: "    STRUCT('Ornpreya (Ice) Sukthai'               AS kam_name, 'ornpreya.s@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'PM'  AS expected_owner)",
    filter: () => true },
];

// ── Legacy-conversion targets ───────────────────────────────────────────
// These two never received the 2026-07 expected_owner upgrade in the
// canonical sql/ directory (only in a dated handoff snapshot — see header
// comment). One-time structural fix: widen kam_list to 3 columns and
// regenerate its full contents from roster.json, then swap the 3 places
// each file filters on a literal 'KAM' string to join on expected_owner
// instead (same pattern every other roster file already uses).
const LEGACY_CONVERT = [
  {
    file: 'sql/q3c_upsell_bulk_all_kams_v4.sql',
    literalFixes: [
      ["WHERE um.commercial_owner = 'KAM'", 'WHERE um.commercial_owner = k.expected_owner'],
      ["JOIN kam_list k_m ON mo.commercial_owner = 'KAM'\n    AND TRIM(mo.staff_owner) = TRIM(k_m.kam_name)",
       'JOIN kam_list k_m ON mo.commercial_owner = k_m.expected_owner\n    AND TRIM(mo.staff_owner) = TRIM(k_m.kam_name)'],
      ["JOIN kam_list k_a ON a.commercial_owner = 'KAM'\n    AND TRIM(a.staff_owner) = TRIM(k_a.kam_name)",
       'JOIN kam_list k_a ON a.commercial_owner = k_a.expected_owner\n    AND TRIM(a.staff_owner) = TRIM(k_a.kam_name)'],
    ],
  },
  {
    file: 'sql/q3c_upsell_team_summary_v4.sql',
    literalFixes: [
      ["WHERE um.commercial_owner = 'KAM'", 'WHERE um.commercial_owner = k.expected_owner'],
      ["JOIN kam_list k_m ON m.commercial_owner = 'KAM' AND TRIM(m.staff_owner) = TRIM(k_m.kam_name)",
       'JOIN kam_list k_m ON m.commercial_owner = k_m.expected_owner AND TRIM(m.staff_owner) = TRIM(k_m.kam_name)'],
      ["JOIN kam_list k_a ON a.commercial_owner = 'KAM' AND TRIM(a.staff_owner) = TRIM(k_a.kam_name)",
       'JOIN kam_list k_a ON a.commercial_owner = k_a.expected_owner AND TRIM(a.staff_owner) = TRIM(k_a.kam_name)'],
    ],
  },
];
const LEGACY_BLOCK_RE = /kam_list AS \(\s*SELECT kam_name, kam_email FROM UNNEST\(\[[\s\S]*?\]\)\s*\)/;

let changed = 0;
let skipped = 0;

for (const t of APPEND_TARGETS) {
  const fp = path.join(ROOT, t.file);
  let src = fs.readFileSync(fp, 'utf8');
  const missing = ROSTER.filter(t.filter).filter((p) => !src.includes(`'${p.email}'`));
  if (!missing.length) { console.log(`OK       ${t.file} — nothing missing`); continue; }
  if (!src.includes(t.anchor)) {
    console.error(`ANCHOR MISSING in ${t.file} — file shape changed, skipped (check manually)`);
    skipped++;
    continue;
  }
  const newRows = missing.map((p) => structRow(p, t.cols)).join(',\n');
  src = src.replace(t.anchor, t.anchor + ',\n' + newRows);
  fs.writeFileSync(fp, src);
  console.log(`UPDATED  ${t.file} — added ${missing.map((p) => p.name).join(', ')}`);
  changed++;
}

for (const t of LEGACY_CONVERT) {
  const fp = path.join(ROOT, t.file);
  let src = fs.readFileSync(fp, 'utf8');
  if (!LEGACY_BLOCK_RE.test(src)) {
    console.log(`OK       ${t.file} — already converted (or shape changed, verify manually)`);
    continue;
  }
  const rows = ROSTER.map((p) => structRow(p, ['kam_name', 'kam_email', 'expected_owner'])).join(',\n');
  const newBlock = `kam_list AS (\n  SELECT kam_name, kam_email, expected_owner FROM UNNEST([\n${rows}\n  ])\n)`;
  src = src.replace(LEGACY_BLOCK_RE, newBlock);
  for (const [oldText, newText] of t.literalFixes) {
    if (!src.includes(oldText)) {
      console.error(`LEGACY FIX PATTERN NOT FOUND in ${t.file}: "${oldText.slice(0, 60)}..." — skipped, check manually`);
      skipped++;
      continue;
    }
    src = src.replace(oldText, newText);
  }
  fs.writeFileSync(fp, src);
  console.log(`CONVERTED ${t.file} — upgraded to expected_owner shape + full roster (${ROSTER.length} people)`);
  changed++;
}

console.log(`\n${changed} file(s) updated, ${skipped} anchor(s)/pattern(s) not found (needs manual check).`);
process.exit(skipped ? 1 : 0);
