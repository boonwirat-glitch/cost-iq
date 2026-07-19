#!/usr/bin/env node
// tools/add_pm_portfolio_phase1.js — Phase 1 of PM/AD portfolio access
// (2026-07-17). Lets 3 PM + 1 AD staff see their OWN portfolio in the
// view-layer CSVs, WITHOUT any risk to the 15 existing KAMs' numbers.
//
// The robust mechanism: instead of broadening the ownership filter to a
// blanket `IN ('KAM','PM')` — which would leak existing KAMs' incidental
// PM-tagged outlets (napat has 26, treerak 7, ploynitcha 1 — confirmed in
// dim.user_master) into their portfolios and change their figures — we bind
// an `expected_owner` to each person in the roster and match on it:
//     WHERE um.commercial_owner = k.expected_owner
// 15 KAMs → expected_owner='KAM' (byte-identical to today's `= 'KAM'`);
// 4 new people → 'PM' (their outlets are PM-tagged in dim.user_master, even
// the AD person Ice — verified). No cross-contamination, provably.
//
// SCOPE: ONLY the 11 view-layer files (portfolio screen + account drawers +
// per-KAM bundles). The commission/movement/upsell files
// (q3_2026_movement_rep_view, q3c_upsell_*, upsell_May2026, May2026_reconcile)
// are deliberately NOT touched — PM has no commission, AD's upsell is a later
// phase, and rep_view's KAM-as-self movement logic needs a separate design.
//
// Idempotent: skips a file that already has `expected_owner`. Dry-run by
// default; --apply to write.

const fs = require('fs');

const FILES = [
  'sql/Q8E_portview_v3.sql',
  'sql/Q12B_bulk_sku_outlet.sql',
  'sql/Q2B_bulk_categories.sql',
  'sql/Q3B_bulk_skus.sql',
  'sql/Q4B_bulk_alternatives.sql',
  'sql/Q5B_bulk_outlets.sql',
  'sql/Q6B_bulk_price.sql',
  'sql/Q7B_bulk_sku_current.sql',
  'sql/Q9B_bulk_history.sql',
  'sql/SQL1_sense_skus.sql',
  'sql/SQL2_sense_alts.sql',
];

// All 4 people's outlets are PM-tagged in dim.user_master (Ice/AD included).
// The 3 PMs have no TL; Ice's TL is Pavarisa (Ploiiy) — kept so Ploy's team
// view correctly includes Ice. tl_email only emitted in 3-column-shape files.
const NEW_PEOPLE = [
  { name: 'Panitan (Aom) Promta',     email: 'panitan.p@freshket.co',  tl: null,                       owner: 'PM' },
  { name: 'Sarawoot (Oh) Kaewkhao',   email: 'sarawoot.k@freshket.co', tl: null,                       owner: 'PM' },
  { name: 'Nichamon (Ninew) Kanghae', email: 'nichamon.k@freshket.co', tl: null,                       owner: 'PM' },
  { name: 'Ornpreya (Ice) Sukthai',   email: 'ornpreya.s@freshket.co', tl: 'pavarisa.mu@freshket.co',  owner: 'PM' },
];

const sqlStr = (v) => (v === null ? 'CAST(NULL AS STRING)' : `'${v}'`);

function newStructLine(p, threeCol, isLast) {
  let s = `    STRUCT(${sqlStr(p.name)} AS kam_name, ${sqlStr(p.email)} AS kam_email`;
  if (threeCol) s += `, ${sqlStr(p.tl)} AS tl_email`;
  s += `, ${sqlStr(p.owner)} AS expected_owner)`;
  return s + (isLast ? '' : ',');
}

function processFile(path, apply) {
  let src = fs.readFileSync(path, 'utf8');
  if (src.includes('expected_owner')) { console.log(`SKIP  ${path} (already has expected_owner)`); return; }

  // Detect roster shape from the projection line inside kam_list.
  const projRe = /(SELECT\s+kam_name[^\n]*?)\s+FROM UNNEST\(\[/;
  const projMatch = src.match(projRe);
  if (!projMatch) { console.log(`WARN  ${path}: no kam_list projection found — skipping`); return; }
  const threeCol = /tl_email/.test(projMatch[1]);

  // 1. Projection: add expected_owner to the CTE's output columns.
  src = src.replace(projRe, `$1, expected_owner FROM UNNEST([`);

  // 2. Existing roster rows: insert ", 'KAM' AS expected_owner" before each
  //    STRUCT's closing paren. Scoped to lines carrying "AS kam_name".
  const rosterLineRe = /^(\s*STRUCT\(.*?AS kam_name.*?)\)(,?)(\s*)$/gm;
  const rosterMatches = [];
  let m;
  while ((m = rosterLineRe.exec(src))) rosterMatches.push(m);
  if (!rosterMatches.length) { console.log(`WARN  ${path}: no roster STRUCT rows — skipping`); return; }
  src = src.replace(rosterLineRe, `$1, 'KAM' AS expected_owner)$2$3`);

  // 3. Append the 4 new PM rows after the last existing roster row.
  //    Re-find rows post-edit to locate the (now-updated) last one.
  const rosterLineRe2 = /^(\s*STRUCT\(.*?AS kam_name.*?expected_owner\))(,?)(\s*)$/gm;
  const rows2 = [];
  while ((m = rosterLineRe2.exec(src))) rows2.push(m);
  const last = rows2[rows2.length - 1];
  const lastEnd = last.index + last[0].length;
  const hadComma = last[2] === ',';
  const insertion = (hadComma ? '' : ',') + '\n' +
    NEW_PEOPLE.map((p, i) => newStructLine(p, threeCol, i === NEW_PEOPLE.length - 1)).join('\n');
  // Insert right after the last row's content but before its trailing newline.
  const lastContentEnd = last.index + last[1].length + last[2].length;
  src = src.slice(0, lastContentEnd) + insertion + src.slice(lastContentEnd);

  // 4. Rebind the ownership filter to the roster's expected_owner.
  const whereCount = (src.match(/WHERE um\.commercial_owner = 'KAM'/g) || []).length;
  if (whereCount !== 1) { console.log(`WARN  ${path}: expected exactly 1 WHERE um.commercial_owner='KAM', found ${whereCount} — skipping`); return; }
  src = src.replace(/WHERE um\.commercial_owner = 'KAM'/, `WHERE um.commercial_owner = k.expected_owner`);

  console.log(`${apply ? 'WRITE' : 'DRY'}  ${path}  (${threeCol ? '3-col' : '2-col'}, +4 rows, filter rebound)`);
  if (apply) fs.writeFileSync(path, src);
}

function main() {
  const apply = process.argv.includes('--apply');
  for (const f of FILES) {
    if (!fs.existsSync(f)) { console.log(`MISSING ${f}`); continue; }
    processFile(f, apply);
  }
  if (!apply) console.log('\n(dry run — pass --apply to write)');
}

main();
