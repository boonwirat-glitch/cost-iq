#!/usr/bin/env node
// tools/tokenize_codemod.js — mechanical hardcode→token migration for the
// whole-app readability overhaul (Phase 1). Replaces exact hardcoded values
// with var(--token) references whose current values are IDENTICAL, so the
// rendered app is byte-for-byte unchanged (verified by
// tools/verify_tokenization.js, which imports the same tables below and
// substitutes them back).
//
// Policy (from the approved plan):
//   - EXACT-value mapping only — never nearest-neighbor. Off-scale values
//     (sub-px, 21px, 24px, SVG axis labels, print) stay hardcoded, on
//     purpose: they're deliberate density/decoration choices that the
//     Phase 2 retune must NOT scale.
//   - @media print blocks are skipped entirely (styles_report.css's
//     9px!important print sizing is intentional).
//   - styles_tokens.css itself is never touched.
//   - Idempotent: every replacement's output contains "var(--", which no
//     input pattern matches, so re-running is a no-op.
//
// Usage:
//   node tools/tokenize_codemod.js --pass=font   [--dry-run] <files...>
//   node tools/tokenize_codemod.js --pass=weight [--dry-run] <files...>
//   node tools/tokenize_codemod.js --pass=color  [--dry-run] <files...>
//   node tools/tokenize_codemod.js --pass=radius [--dry-run] <files...>
//   node tools/tokenize_codemod.js --check <files...>   # lint: fail if any
//                                  migratable hardcoded value exists (CI/dev
//                                  guard so new code uses tokens directly)

const fs = require('fs');

// ── Mapping tables — single source of truth, imported by the verifier ──────
const FONT_SIZE_MAP = {
  '8px':  '--text-3xs',
  '9px':  '--text-2xs',
  '10px': '--text-xs',
  '11px': '--text-sm',
  '12px': '--text-md',
  '13px': '--text-base',
  '14px': '--text-lg',
  '15px': '--text-lg2',
  '16px': '--text-xl',
  '17px': '--text-xl2',
  '18px': '--text-xl3',
  '20px': '--text-2xl',
  '22px': '--text-3xl',
  '28px': '--text-kpi',
  '48px': '--text-hero',
};
const FONT_WEIGHT_MAP = {
  '400': '--fw-normal',
  '500': '--fw-medium',
  '600': '--fw-semi',
  '700': '--fw-bold',
};
const RADIUS_MAP = {
  '2px':   '--r-xxs',
  '4px':   '--r-xs',
  '5px':   '--r-5',
  '6px':   '--r-sm',
  '7px':   '--r-7',
  '8px':   '--r-8',
  '9px':   '--r-9',
  '10px':  '--r-md',
  '12px':  '--r-card',
  '14px':  '--r-lg',
  '20px':  '--r-xl',
  '999px': '--r-pill',
};
// Blue-ink channel triplets: plain string replace, byte-exact at any alpha,
// safe in any property context (these channel literals are unique to the ramp).
const COLOR_TRIPLET_MAP = {
  'rgba(188,215,255,': 'rgba(var(--ink-blue),',
  'rgba(225,238,255,': 'rgba(var(--ink-blue-hi),',
};
// White text ramp: property-aware (color: only) exact-value matches.
const COLOR_TEXT_MAP = {
  '#fff':                    'var(--tk-text-primary)',
  '#ffffff':                 'var(--tk-text-primary)',
  '#FFFFFF':                 'var(--tk-text-primary)',
  '#FFF':                    'var(--tk-text-primary)',
  'rgba(255,255,255,.70)':   'var(--tk-text-secondary)',
  'rgba(255,255,255,0.70)':  'var(--tk-text-secondary)',
  'rgba(255,255,255,.7)':    'var(--tk-text-secondary)',
  'rgba(255,255,255,0.7)':   'var(--tk-text-secondary)',
  'rgba(255,255,255,.45)':   'var(--tk-text-muted)',
  'rgba(255,255,255,0.45)':  'var(--tk-text-muted)',
  'rgba(255,255,255,.25)':   'var(--tk-text-faint)',
  'rgba(255,255,255,0.25)':  'var(--tk-text-faint)',
};

// ── @media print exclusion ──────────────────────────────────────────────────
// Returns an array of [start, end) index ranges covering @media print blocks.
function printRanges(src) {
  const ranges = [];
  const re = /@media[^{]*\bprint\b[^{]*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}
function inRanges(idx, ranges) {
  return ranges.some(([s, e]) => idx >= s && idx < e);
}

// ── Replacement passes ──────────────────────────────────────────────────────
// Each returns {out, counts:{mappingKey:n}}. All use regex with an index
// check against print ranges.
function passFont(src, ranges) {
  const counts = {};
  // font-size: <px> — in CSS rules and inline style="" strings alike.
  // NOT matched: SVG attribute form font-size="8" (no colon+px).
  const re = /(font-size\s*:\s*)(\d+px)/g;
  const out = src.replace(re, (whole, prefix, px, idx) => {
    if (inRanges(idx, ranges)) return whole;
    const tok = FONT_SIZE_MAP[px];
    if (!tok) return whole;
    counts[px] = (counts[px] || 0) + 1;
    return prefix + 'var(' + tok + ')';
  });
  return { out, counts };
}
function passWeight(src, ranges) {
  const counts = {};
  const re = /(font-weight\s*:\s*)(400|500|600|700)(?=[;"'}\s!)]|$)/g;
  const out = src.replace(re, (whole, prefix, w, idx) => {
    if (inRanges(idx, ranges)) return whole;
    const tok = FONT_WEIGHT_MAP[w];
    counts[w] = (counts[w] || 0) + 1;
    return prefix + 'var(' + tok + ')';
  });
  return { out, counts };
}
function passRadius(src, ranges) {
  const counts = {};
  // Single-value border-radius only. Multi-value shorthand (e.g.
  // "border-radius:12px 12px 0 0") is left alone in Phase 1 — the
  // lookahead requires a terminator right after the px value.
  const re = /(border-radius\s*:\s*)(\d+px)(?=\s*[;"'}!]|$)/g;
  const out = src.replace(re, (whole, prefix, px, idx) => {
    if (inRanges(idx, ranges)) return whole;
    const tok = RADIUS_MAP[px];
    if (!tok) return whole;
    counts[px] = (counts[px] || 0) + 1;
    return prefix + 'var(' + tok + ')';
  });
  return { out, counts };
}
function passColor(src, ranges) {
  const counts = {};
  let out = src;
  // 1. Blue triplets: plain string replace (context-free by design).
  //    Handle optional space after commas in the literal.
  for (const [lit, rep] of Object.entries(COLOR_TRIPLET_MAP)) {
    const litRe = new RegExp(lit.replace(/[().]/g, '\\$&').replace(/,/g, ',\\s*'), 'g');
    out = out.replace(litRe, (whole, idx) => {
      if (inRanges(idx, ranges)) return whole;
      counts[lit] = (counts[lit] || 0) + 1;
      return rep;
    });
  }
  // 2. White text ramp: property must be exactly color: (or
  //    -webkit-text-fill-color:), preceded by a boundary so border-color etc.
  //    can never match.
  for (const [lit, rep] of Object.entries(COLOR_TEXT_MAP)) {
    const litEsc = lit.replace(/[().#]/g, '\\$&').replace(/,/g, ',\\s*');
    const re = new RegExp(
      '(^|[{;"\'`\\s])((?:-webkit-text-fill-)?color\\s*:\\s*)' + litEsc + '(?=[;"\'`}\\s!]|$)',
      'gm'
    );
    out = out.replace(re, (whole, bound, prefix, idx) => {
      if (inRanges(idx, ranges)) return whole;
      counts[lit] = (counts[lit] || 0) + 1;
      return bound + prefix + rep;
    });
  }
  return { out, counts };
}

const PASSES = { font: passFont, weight: passWeight, radius: passRadius, color: passColor };

// ── --check lint mode: report any migratable value still hardcoded ─────────
function checkFile(src, ranges) {
  const found = [];
  const probes = [
    [/(font-size\s*:\s*)(\d+px)/g, (m) => FONT_SIZE_MAP[m[2]] && `font-size:${m[2]}`],
    [/(font-weight\s*:\s*)(400|500|600|700)(?=[;"'}\s!)]|$)/g, (m) => `font-weight:${m[2]}`],
    [/(border-radius\s*:\s*)(\d+px)(?=\s*[;"'}!]|$)/g, (m) => RADIUS_MAP[m[2]] && `border-radius:${m[2]}`],
    [/rgba\(188,\s*215,\s*255,/g, () => 'rgba(188,215,255,…)'],
    [/rgba\(225,\s*238,\s*255,/g, () => 'rgba(225,238,255,…)'],
  ];
  for (const [re, describe] of probes) {
    let m;
    while ((m = re.exec(src))) {
      if (inRanges(m.index, ranges)) continue;
      const d = describe(m);
      if (d) found.push(d);
    }
  }
  return found;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const check = args.includes('--check');
  const passArg = (args.find(a => a.startsWith('--pass=')) || '').slice(7);
  const files = args.filter(a => !a.startsWith('--'));

  if (!files.length) {
    console.error('usage: tokenize_codemod.js (--pass=font|weight|radius|color [--dry-run] | --check) <files...>');
    process.exit(2);
  }
  if (files.some(f => f.endsWith('styles_tokens.css'))) {
    console.error('refusing to touch styles_tokens.css');
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
        console.log(`✗ ${f}: ${found.length} migratable hardcoded value(s)`);
        Object.entries(summary).sort((a, b) => b[1] - a[1]).slice(0, 8)
          .forEach(([k, n]) => console.log(`    ${n}× ${k}`));
      }
    }
    if (!bad) console.log('✓ clean — no migratable hardcoded values');
    process.exit(bad ? 1 : 0);
  }

  const fn = PASSES[passArg];
  if (!fn) {
    console.error(`unknown --pass=${passArg} (font|weight|radius|color)`);
    process.exit(2);
  }

  let grandTotal = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const { out, counts } = fn(src, printRanges(src));
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
module.exports = { FONT_SIZE_MAP, FONT_WEIGHT_MAP, RADIUS_MAP, COLOR_TRIPLET_MAP, COLOR_TEXT_MAP, printRanges, inRanges };
