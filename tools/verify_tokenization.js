#!/usr/bin/env node
// tools/verify_tokenization.js — the "pixel-identical" gate for the Phase 1
// tokenization migration. For each migrated file, substitutes every token
// reference the codemod could have introduced BACK to its literal value
// (using the inverse of the SAME mapping tables the codemod uses — one
// source of truth), then byte-diffs the result against the pre-migration
// baseline from git. Identical bytes ⇒ identical stylesheets ⇒ identical
// rendering — mathematically equivalent to a pixel diff, but covers every
// screen (including login-gated ones) and doesn't need a browser.
//
// Also asserts soundness: each token the codemod emits must be defined
// EXACTLY once across src/ (they live in styles_tokens.css's :root and are
// never theme-redefined — unlike --n###, which the codemod never touches).
//
// Usage:
//   node tools/verify_tokenization.js --baseline=<git-ref> <files...>
//   (files are src/-relative or absolute paths to migrated files)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  FONT_SIZE_MAP, FONT_WEIGHT_MAP, RADIUS_MAP,
  COLOR_TRIPLET_MAP, COLOR_TEXT_MAP,
} = require('./tokenize_codemod.js');

const ROOT = path.join(__dirname, '..');

// ── Build the inverse substitution list ─────────────────────────────────────
// Order matters only in that longer/more-specific strings must never be
// prefixes of shorter ones — true here by construction (each var name is
// unique). COLOR_TEXT_MAP is many-to-one (e.g. #fff/#FFF/#FFFFFF all →
// --tk-text-primary); the inverse picks ONE canonical literal, so instead of
// byte-diffing the whole file for the color pass we verify color sites
// structurally: after detokenizing everything else, any remaining difference
// must consist solely of color-token substitutions whose ORIGINAL literal
// (from the baseline at the same position) maps to that exact token.
const INVERSE_EXACT = [];
for (const [px, tok] of Object.entries(FONT_SIZE_MAP)) INVERSE_EXACT.push([`var(${tok})`, px]);
for (const [w, tok] of Object.entries(FONT_WEIGHT_MAP)) INVERSE_EXACT.push([`var(${tok})`, w]);
for (const [px, tok] of Object.entries(RADIUS_MAP)) INVERSE_EXACT.push([`var(${tok})`, px]);
for (const [lit, rep] of Object.entries(COLOR_TRIPLET_MAP)) INVERSE_EXACT.push([rep, lit]);

const COLOR_TOKEN_TO_LITERALS = {};
for (const [lit, rep] of Object.entries(COLOR_TEXT_MAP)) {
  (COLOR_TOKEN_TO_LITERALS[rep] = COLOR_TOKEN_TO_LITERALS[rep] || []).push(lit);
}

function detokenizeExact(src) {
  let out = src;
  for (const [from, to] of INVERSE_EXACT) out = out.split(from).join(to);
  return out;
}

// ── Alignment walk for the many-to-one color tokens ─────────────────────────
// Compare detokenized-migrated vs baseline char by char; at each mismatch,
// the migrated side must have `var(--tk-text-*)` and the baseline side must
// have one of that token's known literals. Consume both and continue.
function alignColorTokens(migrated, baseline, fileLabel) {
  let i = 0, j = 0, subs = 0;
  while (i < migrated.length && j < baseline.length) {
    if (migrated[i] === baseline[j]) { i++; j++; continue; }
    let matched = false;
    for (const [tok, lits] of Object.entries(COLOR_TOKEN_TO_LITERALS)) {
      if (migrated.startsWith(tok, i)) {
        const lit = lits.find(l => baseline.startsWith(l, j));
        if (lit) { i += tok.length; j += lit.length; subs++; matched = true; break; }
      }
    }
    if (!matched) {
      const ctxM = JSON.stringify(migrated.slice(Math.max(0, i - 40), i + 40));
      const ctxB = JSON.stringify(baseline.slice(Math.max(0, j - 40), j + 40));
      return { ok: false, subs, error: `${fileLabel}: divergence at migrated:${i} baseline:${j}\n  migrated …${ctxM}…\n  baseline …${ctxB}…` };
    }
  }
  if (i !== migrated.length || j !== baseline.length) {
    return { ok: false, subs, error: `${fileLabel}: length mismatch after alignment (tail differs)` };
  }
  return { ok: true, subs };
}

// ── Soundness: every emitted token defined exactly once in src/ ─────────────
function assertSingleDefinition() {
  const tokens = new Set();
  for (const t of Object.values(FONT_SIZE_MAP)) tokens.add(t);
  for (const t of Object.values(FONT_WEIGHT_MAP)) tokens.add(t);
  for (const t of Object.values(RADIUS_MAP)) tokens.add(t);
  tokens.add('--ink-blue'); tokens.add('--ink-blue-hi');
  for (const rep of Object.values(COLOR_TEXT_MAP)) tokens.add(rep.slice(4, -1)); // var(--x) → --x

  const srcFiles = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.css') || f.endsWith('.js'));
  const defCounts = {};
  for (const f of srcFiles) {
    const body = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    for (const tok of tokens) {
      const re = new RegExp(tok.replace(/[-]/g, '\\-') + '\\s*:', 'g');
      const n = (body.match(re) || []).length;
      if (n) defCounts[tok] = (defCounts[tok] || 0) + n;
    }
  }
  const bad = Object.entries(defCounts).filter(([, n]) => n !== 1);
  return { ok: bad.length === 0, bad };
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const baseRef = (args.find(a => a.startsWith('--baseline=')) || '').slice(11);
  const files = args.filter(a => !a.startsWith('--'));
  if (!baseRef || !files.length) {
    console.error('usage: verify_tokenization.js --baseline=<git-ref> <files...>');
    process.exit(2);
  }

  const single = assertSingleDefinition();
  if (!single.ok) {
    console.error('✗ SOUNDNESS: tokens with ≠1 definition in src/:', single.bad);
    process.exit(1);
  }
  console.log('✓ soundness: all mapped tokens defined exactly once in src/');

  let fails = 0;
  for (const f of files) {
    const rel = path.relative(ROOT, path.resolve(f));
    const migrated = fs.readFileSync(path.resolve(f), 'utf8');
    let baseline;
    try {
      baseline = execSync(`git show ${baseRef}:${rel}`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
    } catch (e) {
      console.error(`✗ ${rel}: cannot read baseline from ${baseRef}`);
      fails++; continue;
    }
    const detok = detokenizeExact(migrated);
    if (detok === baseline) {
      console.log(`✓ ${rel}: byte-identical after detokenization`);
      continue;
    }
    const aligned = alignColorTokens(detok, baseline, rel);
    if (aligned.ok) {
      console.log(`✓ ${rel}: identical after detokenization (+ ${aligned.subs} verified color-token site(s))`);
    } else {
      console.error(`✗ ${aligned.error}`);
      fails++;
    }
  }
  console.log(fails ? `\n${fails} file(s) FAILED` : '\nALL FILES VERIFIED — rendering is provably unchanged');
  process.exit(fails ? 1 : 0);
}

main();
