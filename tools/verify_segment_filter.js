// tools/verify_segment_filter.js — standing assertions on the v_segfilter
// customer-segment (SA/MC/Chain) filter added to _qnrrCompute's `opts.segments`
// (src/nrr/nrr_logic.js, mirrored inert into src/07c_qnrr_view.js).
//
// Guards five invariants against silent drift:
//
//   1. NO-REGRESSION — omitting `opts`, or passing `{segments:[]}`, must
//      produce a result identical to the pre-feature engine for every scope.
//      This is what lets ~12 out-of-scope callers (commission, portfolio,
//      masthead, team cards) keep calling the same wrappers safely.
//
//   2. PARTITION — selecting all four keys (sa+mc+chain+other) must equal
//      unfiltered exactly. This is why nrrSegmentKey has an 'other' key
//      instead of dropping the Unknown tail: it makes "all tiles on ==
//      unfiltered" provable rather than approximate.
//
//   3. ADDITIVITY — Σ per-segment base_norm_original over the four disjoint
//      keys must equal the unfiltered base_norm_original.
//
//   4. SCOPE LOCK (the important one) — a filter that empties a team must
//      return null, NOT an org-wide number. Pre-filtering bulkQnrrData
//      instead of filtering inside _rowInScope empties qd.byTlEmail[tl],
//      which makes myTlEmail resolve to '' and trips _qnrrCompute's
//      "Admin viewing team scope with no personal TL" org-wide fallback —
//      silently returning the whole org's figure under a team heading, with
//      no error. This assertion is the regression lock for that design bug.
//
//   5. TRANSFER SYMMETRY — transfer_in/transfer_out base adjustments must
//      partition cleanly across segments. Holds because account_type is 1:1
//      with outlet_id, so a transfer_in row and its transfer_out counterpart
//      always share a segment (both pass the filter or both fail), keeping
//      the symmetric base adjustment balanced.
//
// Also runs every invariant against a SYNTHESIZED 3-month row set, because
// the committed local CSV holds only 2026-07 — the multi-month sparsity paths
// (a segment present in some months but not others) are otherwise unreachable
// until real ส.ค./ก.ย. data lands.
//
// Usage: node tools/verify_segment_filter.js [path/to/kam_rep_view.csv]
//        (defaults to dist/localtest/kam_rep_view.csv)

const fs = require('fs');
const path = require('path');

const csvPath = process.argv[2] || path.join(__dirname, '..', 'dist', 'localtest', 'kam_rep_view.csv');

global.window = {};
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'nrr', 'nrr_logic.js'), 'utf8'));

// nrr_aggregate.js too, so invariant [6] can check the mix-bar helper against
// nrrMonthTriple. It declares functions only at load time (no side effects),
// but a few of its bodies reach into nrr_data.js/nrr_exclusions.js helpers —
// stub the ones our assertions actually traverse.
global.nrrListKamsForTeam = () => [];
global.nrrListAdsForTeam = () => [];
global.nrrListTeams = () => [];
global.nrrClassifyRow = () => null;
global.nrrWaivedAccountCountForRows = () => 0;
['nrrListKamsForTeam', 'nrrListAdsForTeam', 'nrrListTeams', 'nrrClassifyRow',
 'nrrWaivedAccountCountForRows'].forEach(k => { window[k] = global[k]; });
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'nrr', 'nrr_aggregate.js'), 'utf8'));

// nrr_logic.js calls nrrAccountWaivedForPeriod (nrr_exclusions.js) — stub it to
// "nothing is waived" so these assertions isolate the segment filter. Waiver
// interaction is verified separately; it composes correctly because the
// denominator adjustment iterates baseMap, which is itself scopedRows-derived.
global.nrrAccountWaivedForPeriod = () => false;
window.nrrAccountWaivedForPeriod = global.nrrAccountWaivedForPeriod;

// ── CSV parsing (quote-aware — account_name contains commas, e.g. `"… Co., Ltd."`) ──
function parseRow(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}

const raw = fs.readFileSync(csvPath, 'utf8').split('\n').filter(l => l.trim());
const header = parseRow(raw[0].replace(/^﻿/, ''));
const NUMERIC = ['curr_gmv', 'base_gmv', 'base_days', 'curr_days'];
const baseRows = raw.slice(1).map(l => {
  const c = parseRow(l), o = {};
  header.forEach((h, i) => { o[h] = (c[i] || '').trim(); });
  NUMERIC.forEach(k => { o[k] = parseFloat(o[k]) || 0; });
  return o;
});

function indexRows(rows) {
  const byKam = {}, byTl = {};
  rows.forEach(r => {
    if (r.latest_kam_email) (byKam[r.latest_kam_email] = byKam[r.latest_kam_email] || []).push(r);
    if (r.latest_tl_email) (byTl[r.latest_tl_email] = byTl[r.latest_tl_email] || []).push(r);
  });
  return { byKamEmail: byKam, byTlEmail: byTl, allRows: rows, loaded: true };
}

// ── Assertion plumbing ────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return true; }
  fail++; failures.push(detail ? `${label}\n      ${detail}` : label);
  return false;
}
const EPS = 1e-6;
function near(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));
}
const f = n => (n == null ? 'null' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));

const SEG_KEYS = ['sa', 'mc', 'chain', 'other'];

// by_month carries no cohort_outlets field — the cohort count is derived in the
// aggregate layer from by_month[m].outlets. Mirror nrrTeamComparison's exact
// derivation (nrr_aggregate.js:117-119) so this harness asserts the number the
// UI actually shows, not a field that doesn't exist (which would compare
// undefined to undefined and pass vacuously).
const COHORT_MOVEMENTS = ['core_nrr', 'core_nrr_churn', 'comeback', 'transfer_in'];
function cohortCount(bm) {
  if (!bm || !bm.outlets) return 0;
  return COHORT_MOVEMENTS.reduce((s, m) => s + (bm.outlets[m] || 0), 0);
}

// Compare the fields that drive every displayed number. Deliberately not a
// deep-equal on the whole object: `rows` arrays hold shared row references and
// by_month carries derived scratch fields, so a structural diff would be noisy
// without testing anything the UI actually shows.
function summarize(result) {
  if (!result) return null;
  const out = {
    months: (result.months || []).join('|'),
    base_norm: result.base_norm,
    base_norm_original: result.base_norm_original,
    transfer_in_base_norm: result.transfer_in_base_norm,
    transfer_out_base_norm: result.transfer_out_base_norm,
    handover_base_norm: result.handover_base_norm,
    by_month: {}
  };
  Object.keys(result.by_month || {}).forEach(m => {
    const bm = result.by_month[m];
    out.by_month[m] = {
      nrr_pct: bm.nrr_pct,
      cohort_outlets: cohortCount(bm),
      effective_base_norm: bm.effective_base_norm,
      total_gmv: bm.total_gmv,
      segments: Object.assign({}, bm.segments),
      outlets: Object.assign({}, bm.outlets)
    };
  });
  return out;
}
function sameSummary(a, b) {
  if (a === null || b === null) return a === b;
  if (a.months !== b.months) return false;
  for (const k of ['base_norm', 'base_norm_original', 'transfer_in_base_norm',
                   'transfer_out_base_norm', 'handover_base_norm']) {
    if (!near(a[k], b[k])) return false;
  }
  const ma = Object.keys(a.by_month).sort(), mb = Object.keys(b.by_month).sort();
  if (ma.join('|') !== mb.join('|')) return false;
  for (const m of ma) {
    const x = a.by_month[m], y = b.by_month[m];
    if (!near(x.nrr_pct, y.nrr_pct)) return false;
    if (x.cohort_outlets !== y.cohort_outlets) return false;
    if (!near(x.effective_base_norm, y.effective_base_norm)) return false;
    if (!near(x.total_gmv, y.total_gmv)) return false;
    for (const s of new Set([...Object.keys(x.segments), ...Object.keys(y.segments)])) {
      if (!near(x.segments[s] || 0, y.segments[s] || 0)) return false;
    }
    for (const s of new Set([...Object.keys(x.outlets), ...Object.keys(y.outlets)])) {
      if ((x.outlets[s] || 0) !== (y.outlets[s] || 0)) return false;
    }
  }
  return true;
}

// ── The suite, run once per dataset vintage ───────────────────────────────
function runSuite(label, rows) {
  console.log(`\n${'═'.repeat(74)}\n  ${label}  (${rows.length.toLocaleString()} rows)\n${'═'.repeat(74)}`);
  window.bulkQnrrData = indexRows(rows);

  // Segment census, so the report shows what was actually exercised.
  const census = {};
  rows.forEach(r => { const k = nrrSegmentKey(r); census[k] = (census[k] || 0) + 1; });
  console.log('  segment census: ' + SEG_KEYS.map(k => `${k}=${census[k] || 0}`).join('  '));

  const tls = Object.keys(window.bulkQnrrData.byTlEmail).sort();
  const kams = Object.keys(window.bulkQnrrData.byKamEmail).sort();
  const scopes = [['admin', null], ...tls.map(t => ['tl', t]), ...kams.map(k => ['kam', k])];
  console.log(`  scopes under test: 1 admin + ${tls.length} tl + ${kams.length} kam\n`);

  // ── Invariant 1: no-regression ──────────────────────────────────────────
  // Baseline is captured with NO third argument at all — the literal old
  // call shape — then compared against every "should be inert" spelling.
  const baselines = new Map();
  scopes.forEach(([scope, email]) => {
    const key = `${scope}:${email || ''}`;
    baselines.set(key, summarize(_qnrrCompute(email, scope)));
  });

  const INERT_FORMS = [
    ['undefined opts', undefined],
    ['empty object', {}],
    ['segments: []', { segments: [] }],
    ['segments: null', { segments: null }]
  ];
  let inertBad = 0;
  scopes.forEach(([scope, email]) => {
    const key = `${scope}:${email || ''}`;
    const want = baselines.get(key);
    INERT_FORMS.forEach(([formName, opts]) => {
      const got = summarize(_qnrrCompute(email, scope, opts));
      if (!sameSummary(want, got)) {
        inertBad++;
        if (inertBad <= 3) {
          failures.push(`[1] inert form changed a result: ${key} via ${formName}\n` +
            `      want nrr=${want && JSON.stringify(Object.keys(want.by_month).map(m => want.by_month[m].nrr_pct))}\n` +
            `      got  nrr=${got && JSON.stringify(Object.keys(got.by_month).map(m => got.by_month[m].nrr_pct))}`);
        }
      }
    });
  });
  if (inertBad === 0) { pass++; console.log(`  [1] no-regression ...... PASS  (${scopes.length} scopes × ${INERT_FORMS.length} inert spellings all identical)`); }
  else { fail++; console.log(`  [1] no-regression ...... FAIL  (${inertBad} mismatches)`); }

  // ── Invariant 2: all four keys == unfiltered ─────────────────────────────
  let partBad = 0;
  scopes.forEach(([scope, email]) => {
    const key = `${scope}:${email || ''}`;
    const want = baselines.get(key);
    const got = summarize(_qnrrCompute(email, scope, { segments: SEG_KEYS.slice() }));
    if (!sameSummary(want, got)) {
      partBad++;
      if (partBad <= 3) {
        const wm = want && Object.keys(want.by_month)[0];
        failures.push(`[2] all-four-keys != unfiltered: ${key}\n` +
          `      base_norm want=${f(want && want.base_norm)} got=${f(got && got.base_norm)}\n` +
          `      nrr_pct   want=${f(want && wm && want.by_month[wm].nrr_pct)} got=${f(got && wm && got.by_month[wm] && got.by_month[wm].nrr_pct)}`);
      }
    }
  });
  if (partBad === 0) { pass++; console.log(`  [2] full partition ..... PASS  (all 4 keys == unfiltered for ${scopes.length} scopes)`); }
  else { fail++; console.log(`  [2] full partition ..... FAIL  (${partBad} mismatches)`); }

  // ── Invariant 3: Σ per-segment base_norm_original == unfiltered ──────────
  let addBad = 0;
  scopes.forEach(([scope, email]) => {
    const key = `${scope}:${email || ''}`;
    const want = baselines.get(key);
    if (!want) return; // nothing to be additive about
    let sum = 0;
    SEG_KEYS.forEach(k => {
      const r = _qnrrCompute(email, scope, { segments: [k] });
      if (r) sum += (r.base_norm_original || 0);
    });
    if (!near(sum, want.base_norm_original)) {
      addBad++;
      if (addBad <= 3) {
        failures.push(`[3] Σ per-segment base_norm_original != unfiltered: ${key}\n` +
          `      Σparts=${f(sum)}  whole=${f(want.base_norm_original)}  Δ=${f(sum - want.base_norm_original)}`);
      }
    }
    // Cohort counts must partition too — outlets are disjoint across segments
    // (account_type is 1:1 with outlet_id), so the counts add exactly.
    Object.keys(want.by_month).forEach(m => {
      let cSum = 0;
      SEG_KEYS.forEach(k => {
        const r = _qnrrCompute(email, scope, { segments: [k] });
        if (r && r.by_month[m]) cSum += cohortCount(r.by_month[m]);
      });
      if (cSum !== want.by_month[m].cohort_outlets) {
        addBad++;
        if (addBad <= 6) {
          failures.push(`[3] Σ per-segment cohort count != unfiltered: ${key} @ ${m}\n` +
            `      Σparts=${cSum}  whole=${want.by_month[m].cohort_outlets}`);
        }
      }
    });
  });
  if (addBad === 0) { pass++; console.log(`  [3] additivity ......... PASS  (Σ per-segment base AND cohort count == whole)`); }
  else { fail++; console.log(`  [3] additivity ......... FAIL  (${addBad} mismatches)`); }

  // ── Invariant 4: SCOPE LOCK — empty segment must be null, never org-wide ──
  // Find every (tl, segment) pair where the TEAM genuinely owns zero rows of
  // that segment. Each must yield null. If the engine ever regresses to a
  // pre-filter design, these return the org's figure instead and this fails.
  const orgBySeg = {};
  SEG_KEYS.forEach(k => { orgBySeg[k] = summarize(_qnrrCompute(null, 'admin', { segments: [k] })); });

  let lockChecked = 0, lockBad = 0;
  tls.forEach(tl => {
    const teamRows = window.bulkQnrrData.byTlEmail[tl] || [];
    SEG_KEYS.forEach(k => {
      const owned = teamRows.filter(r => nrrSegmentKey(r) === k).length;
      if (owned !== 0) return;
      lockChecked++;
      const got = _qnrrCompute(tl, 'tl', { segments: [k] });
      if (got !== null) {
        lockBad++;
        const gs = summarize(got);
        const org = orgBySeg[k];
        const matchesOrg = org && sameSummary(org, gs);
        failures.push(`[4] SCOPE LOCK BROKEN: team ${tl} owns 0 '${k}' rows but got a result` +
          (matchesOrg ? ' — and it EQUALS the org-wide figure (the pre-filter bug)' : '') +
          `\n      base_norm=${f(gs.base_norm)}  months=${gs.months}`);
      }
    });
  });
  if (lockChecked === 0) {
    console.log(`  [4] scope lock ......... SKIP  (no team×segment pair is empty in this dataset)`);
  } else if (lockBad === 0) {
    pass++; console.log(`  [4] scope lock ......... PASS  (${lockChecked} empty team×segment pairs all returned null)`);
  } else {
    fail++; console.log(`  [4] scope lock ......... FAIL  (${lockBad}/${lockChecked} leaked a non-null result)`);
  }

  // ── Invariant 5: transfer_in/out partition cleanly ───────────────────────
  let tfBad = 0, tfChecked = 0;
  scopes.forEach(([scope, email]) => {
    const key = `${scope}:${email || ''}`;
    const want = baselines.get(key);
    if (!want) return;
    let sumIn = 0, sumOut = 0;
    SEG_KEYS.forEach(k => {
      const r = _qnrrCompute(email, scope, { segments: [k] });
      if (r) { sumIn += (r.transfer_in_base_norm || 0); sumOut += (r.transfer_out_base_norm || 0); }
    });
    tfChecked++;
    if (!near(sumIn, want.transfer_in_base_norm) || !near(sumOut, want.transfer_out_base_norm)) {
      tfBad++;
      if (tfBad <= 3) {
        failures.push(`[5] transfer adjustment did not partition: ${key}\n` +
          `      in : Σparts=${f(sumIn)}  whole=${f(want.transfer_in_base_norm)}\n` +
          `      out: Σparts=${f(sumOut)}  whole=${f(want.transfer_out_base_norm)}`);
      }
    }
  });
  if (tfBad === 0) { pass++; console.log(`  [5] transfer symmetry .. PASS  (in/out partition across segments, ${tfChecked} scopes)`); }
  else { fail++; console.log(`  [5] transfer symmetry .. FAIL  (${tfBad} mismatches)`); }

  // ── Invariant 6: mix bar decomposes nrrMonthTriple's MTD exactly ─────────
  // The whole justification for nrrKamSegMix doing a raw row aggregation
  // instead of an engine call is that it reproduces, part-for-part, the MTD
  // number already printed on that leaderboard row. If that ever drifts, the
  // bar and the figure beside it disagree — assert it, don't trust it.
  let mixBad = 0, mixChecked = 0;
  const mixPeriod = (QNRR_CFG.q_months || []).find(m => rows.some(r => r.period_month === m))
    || rows[0].period_month;
  kams.forEach(email => {
    const res = _qnrrCompute(email, 'kam');
    const triple = nrrMonthTriple(res, mixPeriod);
    if (!triple) return;
    const mix = nrrKamSegMix(email, mixPeriod);
    mixChecked++;
    // nrrMonthTriple rounds its mtd; compare on the same rounding.
    if (Math.round(mix.total) !== triple.mtd) {
      mixBad++;
      if (mixBad <= 3) {
        failures.push(`[6] mix total != displayed MTD: kam ${email} @ ${mixPeriod}\n` +
          `      mix.total=${f(Math.round(mix.total))}  triple.mtd=${f(triple.mtd)}`);
      }
    }
    const partsSum = SEG_KEYS.reduce((s, k) => s + mix.by[k], 0);
    if (!near(partsSum, mix.total)) {
      mixBad++;
      if (mixBad <= 6) {
        failures.push(`[6] mix parts do not sum to mix total: kam ${email}\n` +
          `      Σparts=${f(partsSum)}  total=${f(mix.total)}`);
      }
    }
  });
  if (mixBad === 0) { pass++; console.log(`  [6] mix bar == MTD ..... PASS  (${mixChecked} KAMs: Σsegments == displayed MTD)`); }
  else { fail++; console.log(`  [6] mix bar == MTD ..... FAIL  (${mixBad} mismatches)`); }

  // ── Observability: per-team segment breakdown, printed not asserted ──────
  console.log('\n  per-team %NRR by segment (— = team owns no rows of that segment):');
  const period = (QNRR_CFG.q_months || []).find(m => rows.some(r => r.period_month === m))
    || rows[0].period_month;
  tls.forEach(tl => {
    const whole = _qnrrCompute(tl, 'tl');
    const wbm = whole && whole.by_month[period];
    const cells = SEG_KEYS.map(k => {
      const r = _qnrrCompute(tl, 'tl', { segments: [k] });
      const bm = r && r.by_month[period];
      const n = bm && bm.nrr_pct != null ? bm.nrr_pct.toFixed(1) : '—';
      return `${k}=${String(n).padStart(6)}(${String(cohortCount(bm)).padStart(4)})`;
    });
    const all = wbm && wbm.nrr_pct != null ? wbm.nrr_pct.toFixed(1) : '—';
    console.log(`    ${tl.replace('@freshket.co', '').padEnd(16)} all=${String(all).padStart(6)}(${String(cohortCount(wbm)).padStart(4)})  ${cells.join('  ')}`);
  });
}

// ── Vintage A: the committed CSV as-is ────────────────────────────────────
runSuite('VINTAGE A — real CSV as committed', baseRows);

// ── Vintage B: synthesized 3-month set with deliberate sparsity ───────────
// The committed CSV holds a single period_month, so multi-month behavior
// (months[] shortening, a segment absent from one month) is unreachable
// above. Build ก.ค./ส.ค./ก.ย. by cloning, then DELETE all SA rows from the
// final month so at least one segment is genuinely sparse across months.
const Q = QNRR_CFG.q_months;
const srcMonth = baseRows[0].period_month;
const multi = [];
Q.forEach((m, i) => {
  baseRows.forEach(r => {
    if (r.period_month !== srcMonth) return;
    if (i === Q.length - 1 && nrrSegmentKey(r) === 'sa') return; // sparsity: no SA in the last month
    const c = Object.assign({}, r);
    c.period_month = m;
    // Vary GMV per month so month-over-month figures aren't degenerate.
    c.curr_gmv = r.curr_gmv * (1 + i * 0.05);
    multi.push(c);
  });
});
runSuite('VINTAGE B — synthesized 3-month set, SA absent from final month', multi);

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(74)}`);
if (fail) {
  console.log(`  FAILED — ${pass} passed, ${fail} failed\n`);
  failures.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
  console.log('');
  process.exit(1);
}
console.log(`  ALL PASS — ${pass} invariant groups green across 2 dataset vintages\n`);
