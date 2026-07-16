// tools/verify_save_sku_scorer.js — verifies the Phase 2 SAVE deterministic
// scorer/veto/fallback layer added to src/04_sku_matcher.js.
//
// Extracts the EXACT pure-function block (const _SAVE_SKU_TH_DIGITS=... down
// through _saveSkuApplyFallback) straight out of the real committed source
// file via marker-delimited slicing — not a hand-copied duplicate — so this
// harness always tests the actual shipped code, into an isolated vm context
// with no DOM/AI-call dependency (matches tools/verify_nrr_precision_tiers.js's
// established pattern).
//
// IMPORTANT — a real gap found and fixed while building this harness:
// _saveSkuJaccard/_saveSkuFamilyKey/_saveSkuEggKey were ported from
// src/05_kam_view.js's SKU Verify scorer but had ZERO callers in the first
// draft of _saveSkuVetoReason — meaning the exact 3 production false
// positives that motivated QUALIFIER_STOPWORDS/BRAND_PREFIX_RE in the first
// place (wing-vs-leg, quinoa-vs-chia, bare-flavor pairs) were NOT actually
// caught by SAVE's veto. Added _saveSkuSimilarityConflict(), mirroring
// 05_kam_view.js's pairScore() thresholds exactly (0.20 floor for
// same-subclass pairs, 0.55 bare floor otherwise), wired in as the veto's
// final check. See the "residual gap" section below for what this still
// does NOT close (an accepted, plan-documented limitation, not a bug).
//
// Usage: node tools/verify_save_sku_scorer.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeCtx() {
  const ctx = { console, window: {} };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '../src/04_sku_matcher.js'), 'utf8');
  const startMarker = 'const _SAVE_SKU_TH_DIGITS=';
  const endMarker = '// ════════════════════════════════════════\n// MATCHER CORE';
  const st = src.indexOf(startMarker);
  const en = src.indexOf(endMarker);
  if (st === -1 || en === -1) throw new Error('scorer block markers not found — src/04_sku_matcher.js structure changed');
  const block = src.slice(st, en);
  vm.runInContext(block, ctx);
  return ctx;
}

let pass = 0, fail = 0;
function check(desc, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✓ ' + desc); }
  else { fail++; console.log('  ✗ ' + desc + '\n      expected: ' + JSON.stringify(expected) + '\n      actual:   ' + JSON.stringify(actual)); }
}
function checkTrue(desc, cond) { check(desc, !!cond, true); }

const ctx = makeCtx();
function call(expr) { return vm.runInContext(expr, ctx); }
function setG(name, value) { ctx.__inject = value; vm.runInContext(name + ' = __inject;', ctx); delete ctx.__inject; }

console.log('── SAVE deterministic scorer/veto/fallback (Phase 2) ──\n');

// ── 1. Ported utility regressions — jaccard/tokens must preserve the exact
// documented production fixes from src/05_kam_view.js / nrr_account.js.
// These 2 functions have no direct caller of their own besides the new
// _saveSkuSimilarityConflict (see below) — testing them in isolation first
// isolates a break in the port itself from a break in how it's wired in.
console.log('_saveSkuTokens / _saveSkuJaccard — ported utility regressions');
setG('_wing', 'ปีกไก่กลาง (แช่แข็ง) ตราเบทาโกร');
setG('_leg', 'ขาไก่ (ตัดเล็บ) (แช่แข็ง)');
check('  wing tokens exclude "แช่แข็ง" + brand token', call('_saveSkuTokens(_wing)'), ['ปีกไก่กลาง']);
check('  leg tokens exclude "แช่แข็ง"', call('_saveSkuTokens(_leg)'), ['ขาไก่', 'ตัดเล็บ']);
check('  jaccard(wing, leg) = 0 (round-1 fix intact)', call('_saveSkuJaccard(_wing,_leg)'), 0);

setG('_quinoa', 'ควินัวขาว ออแกนิค ตรากรีนไลฟ์');
setG('_chia', 'เมล็ดเจีย ออแกนิค ตรากรีนไลฟ์');
check('  jaccard(quinoa, chia) = 0 (round-2 fix intact — brand-prefix + ออแกนิค spelling)', call('_saveSkuJaccard(_quinoa,_chia)'), 0);

setG('_moninMango', 'ไซรัปโมนิน มะม่วง เพียวเร่ ตราโมนิน');
setG('_moninStraw', 'ไซรัปโมนิน สตรอเบอร์รี่ เพียวเร่ ตราโมนิน');
const moninSim = call('_saveSkuJaccard(_moninMango,_moninStraw)');
check('  jaccard(Monin mango, Monin strawberry) ≈ 0.333 (documented, see residual-gap note below)', Math.round(moninSim * 1000) / 1000, 0.333);

setG('_pumpkinRaw', 'เมล็ดฟักทองดิบ');
setG('_pumpkinRoast', 'เมล็ดฟักทองอบ');
check('  jaccard(raw pumpkin seed, roasted) = 0 (deliberate accepted false-negative, unchanged)', call('_saveSkuJaccard(_pumpkinRaw,_pumpkinRoast)'), 0);

// ── 2. _saveSkuVetoReason — the actually-wired decision function.
console.log('\n_saveSkuVetoReason — general similarity floor (new fix)');
function veto(gName, gSub, gPrice, altName, altPrice, altBrand) {
  setG('_g', { name: gName, subclass: gSub, price: gPrice });
  setG('_alt', { catalog_item_name: altName, catalog_price: altPrice, catalog_brand: altBrand || '' });
  return call('_saveSkuVetoReason(_g,_alt)');
}
check('  wing vs leg, same subclass → low_similarity (was null before this fix)',
  veto('ปีกไก่กลาง (แช่แข็ง) ตราเบทาโกร', 'ไก่สด', 80, 'ขาไก่ (ตัดเล็บ) (แช่แข็ง)', 75), 'low_similarity');
check('  quinoa vs chia, same subclass → low_similarity',
  veto('ควินัวขาว ออแกนิค ตรากรีนไลฟ์', 'เมล็ดธัญพืช', 120, 'เมล็ดเจีย ออแกนิค ตรากรีนไลฟ์', 150), 'low_similarity');
check('  raw vs roasted pumpkin seed, same subclass → low_similarity (still correctly non-substitutable)',
  veto('เมล็ดฟักทองดิบ', 'เมล็ดพืช', 90, 'เมล็ดฟักทองอบ', 95), 'low_similarity');

console.log('\nResidual gap — accepted, plan-documented, NOT closed by Phase 2 (see plan section 2.3)');
check('  Monin mango vs strawberry, same subclass → null (0.333 ≥ 0.20 floor; needs a flavor-name list Phase 2 deliberately did not scope — bare fruit/flavor names are open-ended, unlike the 5 curated categories)',
  veto('ไซรัปโมนิน มะม่วง เพียวเร่ ตราโมนิน', 'ไซรัป', 60, 'ไซรัปโมนิน สตรอเบอร์รี่ เพียวเร่ ตราโมนิน', 60), null);

console.log('\n_saveSkuVetoReason — 5 new SAVE categories (reject + true-positive control each)');
check('  Kurobuta vs generic pork → premium_breed',
  veto('สันคอหมูคุโรบูตะ ตราซีพี', 'หมู', 220, 'สันคอหมูธรรมดา ตราซีพี', 180), 'premium_breed');
check('  Kurobuta vs Kurobuta (different brand) → null (true-positive control)',
  veto('สันคอหมูคุโรบูตะ ตราซีพี', 'หมู', 220, 'สันคอหมูคุโรบูตะ ตราเบทาโกร', 210), null);

check('  Baby Cos vs Cos → size_variant',
  veto('กรีนคอส เบบี้ ตรามาลี', 'ผักสลัด', 45, 'กรีนคอส ตรามาลี', 40), 'size_variant');
check('  Baby Cos vs Baby Cos (different brand) → null (true-positive control)',
  veto('กรีนคอส เบบี้ ตรามาลี', 'ผักสลัด', 45, 'กรีนคอส เบบี้ ตราสวนผัก', 42), null);

check('  recipe variant present vs absent → flavor_variant',
  veto('ผัดไทยกุ้ง สูตรกวางตุ้ง ตราซีพี', 'อาหารสำเร็จรูป', 65, 'ผัดไทยกุ้ง ตราซีพี', 60), 'flavor_variant');
check('  recipe variant present on both sides (same one) → null (true-positive control)',
  veto('ผัดไทยกุ้ง สูตรกวางตุ้ง ตราซีพี', 'อาหารสำเร็จรูป', 65, 'ผัดไทยกุ้ง สูตรกวางตุ้ง ตราแม่ครัว', 62), null);

check('  red-wine vinegar vs white-wine vinegar → acid_type',
  veto('น้ำส้มสายชู ไวน์แดง ตราไฮนซ์', 'น้ำส้มสายชู', 90, 'น้ำส้มสายชู ไวน์ขาว ตราไฮนซ์', 88), 'acid_type');
check('  same vinegar type, different brand → null (true-positive control)',
  veto('น้ำส้มสายชู ไวน์แดง ตราไฮนซ์', 'น้ำส้มสายชู', 90, 'น้ำส้มสายชู ไวน์แดง ตราคนอร์', 85), null);

check('  beer, different brand → beverage_brand',
  veto('เบียร์สิงห์ ตราสิงห์ กระป๋อง', 'เบียร์', 45, 'เบียร์ช้าง ตราช้าง กระป๋อง', 42), 'beverage_brand');
check('  beer, same brand different pack → null (true-positive control)',
  veto('เบียร์สิงห์ ตราสิงห์ กระป๋อง', 'เบียร์', 45, 'เบียร์สิงห์ ตราสิงห์ ขวด', 48), null);

// ── 3. Price-ratio determinism (2.4) — pure arithmetic, boundary values.
console.log('\n_saveSkuPriceRatioIssue — 5x boundary determinism');
check('  ratio 4.9x (just under) → false', call('_saveSkuPriceRatioIssue(100, 100/4.9)'), false);
check('  ratio 5.1x (just over) → true', call('_saveSkuPriceRatioIssue(100, 100/5.1)'), true);
check('  ratio exactly 5.0x (boundary, inclusive-of-5 is NOT an issue) → false', call('_saveSkuPriceRatioIssue(100, 20)'), false);
check('  reversed direction (alt cheaper) still symmetric: ratio 5.1x → true', call('_saveSkuPriceRatioIssue(100/5.1, 100)'), true);
check('  missing price → false (cannot evaluate, does not block)', call('_saveSkuPriceRatioIssue(0, 50)'), false);

// ── 4. Fallback path (2.2c) — non-empty, correctly-tagged result instead of a throw.
console.log('\n_saveSkuFallbackResult / _saveSkuApplyFallback — AI-failure fallback');
setG('_fbGroup', { name: 'สันคอหมูคุโรบูตะ ตราซีพี', subclass: 'หมู', price: 220 });
setG('_fbAlts', [
  { catalog_item_id: '1', catalog_item_name: 'สันคอหมูคุโรบูตะ ตราเบทาโกร', catalog_price: 210, catalog_brand: 'เบทาโกร', pack_size: '1 kg.', price_diff: -10 },
  { catalog_item_id: '2', catalog_item_name: 'สันคอหมูธรรมดา ตราซีพี', catalog_price: 180, catalog_brand: 'ซีพี', pack_size: '1 kg.', price_diff: -40 }
]);
const fb = call('_saveSkuFallbackResult(_fbGroup,_fbAlts)');
check('  1 verified (passes all checks), confidence medium', fb.verified, [{ catalog_item_id: '1', catalog_item_name: 'สันคอหมูคุโรบูตะ ตราเบทาโกร', catalog_price: 210, pack_size: '1 kg.', price_diff: -10, is_substitutable: true, confidence: 'medium' }]);
check('  1 excluded (generic pork, premium_breed)', fb.excluded, [{ catalog_item_id: '2', catalog_item_name: 'สันคอหมูธรรมดา ตราซีพี', reason_code: 'premium_breed' }]);
checkTrue('  summary_th is a non-empty fallback-mode Thai message', fb.summary_th && fb.summary_th.length > 0);

setG('_fbGroup2', { name: 'สันคอหมูคุโรบูตะ ตราซีพี', subclass: 'หมู', price: 220 });
setG('_fbAlts2', [{ catalog_item_id: '1', catalog_item_name: 'สันคอหมูคุโรบูตะ ตราเบทาโกร', catalog_price: 210, catalog_brand: 'เบทาโกร', pack_size: '1 kg.', price_diff: -10 }]);
let fallbackThrew = false;
try { vm.runInContext('_saveSkuApplyFallback(_fbGroup2,_fbAlts2,"simulated AI timeout")', ctx); } catch (e) { fallbackThrew = true; }
checkTrue('  _saveSkuApplyFallback does not throw on simulated AI failure', !fallbackThrew);
check('  status tagged done_fallback (not silently dropped to zero alts)', call('_fbGroup2.status'), 'done_fallback');
check('  g.result.status also done_fallback', call('_fbGroup2.result.status'), 'done_fallback');
checkTrue('  g.result.verified is non-empty (fallback produced a real recommendation)', call('_fbGroup2.result.verified.length') > 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
