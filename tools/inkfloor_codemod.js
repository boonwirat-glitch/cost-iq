#!/usr/bin/env node
// tools/inkfloor_codemod.js — Phase 2c ink-floor pass.
//
// Unlike tokenize_codemod.js (exact-value → token, zero visual change), this
// is a real value change: any text-color alpha below 0.45 (blue-ink ramp
// `rgba(var(--ink-blue[-hi]),α)` or the plain white ramp
// `rgba(255,255,255,α)`) is raised to 0.52 — the floor value the user
// approved from the ink_floor_mockup.html before/after (2026-07-17: "โอเคครับ
// เอา 0.52 ดีกว่า"). Below .45 was flagged in the readability audit as
// borderline-illegible on the dark KAM surfaces; .52 was the recommended,
// approved floor.
//
// Property-aware: only rewrites `color:` / `-webkit-text-fill-color:`
// declarations, so background/border/shadow alphas are never touched.
// @media print blocks are skipped (reuses tokenize_codemod's printRanges).
// Idempotent: after one run, no matched alpha is left below 0.45.
//
// Usage:
//   node tools/inkfloor_codemod.js [--dry-run] <files...>
//   node tools/inkfloor_codemod.js --check <files...>   # lint: any alpha <.45 left?

const fs = require('fs');
const { printRanges, inRanges } = require('./tokenize_codemod.js');

const FLOOR = 0.45;   // threshold: strictly below this gets raised
const RAISED_TO = '.52';

// Matches: color: / -webkit-text-fill-color: rgba(<blue-ink-or-white>, <alpha>)
// bound so border-color/background-color etc. can never match.
const RE = /(^|[{;"'`\s])((?:-webkit-text-fill-)?color\s*:\s*)rgba\(\s*(var\(--ink-blue(?:-hi)?\)|255\s*,\s*255\s*,\s*255)\s*,\s*(\.\d+|\d+\.\d+|\d+)\s*\)/gm;

function floorPass(src, ranges) {
  const counts = {};
  const out = src.replace(RE, (whole, bound, prefix, channel, alphaStr, idx) => {
    if (inRanges(idx, ranges)) return whole;
    const alpha = parseFloat(alphaStr);
    if (!(alpha < FLOOR)) return whole; // already >= floor, leave as-is
    const key = `${channel.replace(/\s+/g, '')} ${alphaStr}→${RAISED_TO}`;
    counts[key] = (counts[key] || 0) + 1;
    return `${bound}${prefix}rgba(${channel},${RAISED_TO})`;
  });
  return { out, counts };
}

function checkFile(src, ranges) {
  const found = [];
  let m;
  const re = new RegExp(RE.source, 'gm');
  while ((m = re.exec(src))) {
    if (inRanges(m.index, ranges)) continue;
    const alpha = parseFloat(m[4]);
    if (alpha < FLOOR) found.push(`${m[3].replace(/\s+/g, '')} ${m[4]}`);
  }
  return found;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const check = args.includes('--check');
  const files = args.filter(a => !a.startsWith('--'));

  if (!files.length) {
    console.error('usage: inkfloor_codemod.js [--dry-run] <files...>  |  --check <files...>');
    process.exit(2);
  }
  if (files.some(f => f.endsWith('styles_tokens.css'))) {
    console.error('refusing to touch styles_tokens.css (token definitions edited by hand)');
    process.exit(2);
  }

  if (check) {
    let bad = 0;
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const found = checkFile(src, printRanges(src));
      if (found.length) {
        bad += found.length;
        const summary = {};
        found.forEach(x => { summary[x] = (summary[x] || 0) + 1; });
        console.log(`✗ ${f}: ${found.length} sub-floor color(s)`);
        Object.entries(summary).sort((a, b) => b[1] - a[1]).slice(0, 8)
          .forEach(([k, n]) => console.log(`    ${n}× ${k}`));
      }
    }
    if (!bad) console.log('✓ clean — no text color alpha below 0.45');
    process.exit(bad ? 1 : 0);
  }

  let grandTotal = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const { out, counts } = floorPass(src, printRanges(src));
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    grandTotal += total;
    const detail = Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}×${n}`).join(' ');
    console.log(`${dryRun ? '[dry] ' : ''}${f}: ${total} replacement(s)${detail ? '  (' + detail + ')' : ''}`);
    if (!dryRun && total > 0) fs.writeFileSync(f, out);
  }
  console.log(`${dryRun ? '[dry] ' : ''}TOTAL: ${grandTotal}`);
}

if (require.main === module) main();
module.exports = { floorPass, checkFile, FLOOR, RAISED_TO };
