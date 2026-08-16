#!/usr/bin/env node
// tools/verify_key_sku.js — v_key (2026-08-16)
//
// Test spec สำหรับฟีเจอร์ Key SKU — เขียนก่อนแตะโค้ด (แดงตอนแรกตามคาด)
// อ้างอิงแผน: ~/.claude/plans/feature-price-trend-splendid-sunbeam.md
//
// จุดที่ harness นี้กันไว้เป็นพิเศษ (ตรวจพบระหว่างอ่านโค้ดจริงก่อนเขียน):
//   1. SQL1_sense_skus.sql (21 คอลัมน์) กับ Q3B_bulk_skus.sql (19 คอลัมน์) มีความยาว
//      ไม่เท่ากันอยู่แล้ว ก่อนแตะเลย — ถ้าเติม first_order_date "ต่อท้ายเสมอ" แบบไม่คิด
//      จะได้คนละตำแหน่ง array index กัน (SQL1→21, Q3B→19) ต้อง dispatch ด้วยความยาวแถว
//      ไม่ใช่ offset ตายตัว ไม่งั้น Q3B แถวใหม่จะไปชนตำแหน่งที่ parser เดิมอ่านเป็น margin
//   2. 12_nav_config.js ต้องไม่ถูกแตะเลย — จุดแข็งของดีไซน์นี้คือไม่เพิ่มปุ่มที่ 6
//   3. ห้าม hard-delete Key SKU — ต้อง flip status='removed' เก็บประวัติไว้
//
// Usage: node tools/verify_key_sku.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
function readIfExists(p) {
  try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
  catch (e) { return null; }
}

const SQL1 = readIfExists('sql/SQL1_sense_skus.sql');
const Q3B  = readIfExists('sql/Q3B_bulk_skus.sql');
const REACH_SQL = readIfExists('sql/company_sku_reach.sql');
const DP   = readIfExists('src/02_data_pipeline.js');
const CORE = readIfExists('src/01_core.js');
const KAM  = readIfExists('src/05_kam_view.js');
const NAV  = readIfExists('src/12_nav_config.js');
const SHELL = readIfExists('src/shell.html');
const KEYSKU = readIfExists('src/13_key_sku.js');
const MIGRATION = readIfExists('docs/supabase-migration-key-skus-2026-08-16.sql');
const OUTLET_MIGRATION = readIfExists('docs/supabase-migration-key-skus-outlet-uidx-2026-08-16.sql');
const WORKER = readIfExists('worker/freshket-sense-ai-proxy-v2.js');
const BUILD = readIfExists('build.py');
const PORTVIEW_JS = readIfExists('src/06_portview_teamview.js');
const STYLES_KEY = readIfExists('src/styles_key.css');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

console.log('\n── 1. SQL: first_order_date ต่อท้าย ไม่ชนคอลัมน์เดิม ──');
check('SQL1_sense_skus.sql มีไฟล์', !!SQL1);
check('Q3B_bulk_skus.sql มีไฟล์', !!Q3B);
if (SQL1) {
  check('SQL1: first_order_date เป็นคอลัมน์ SELECT สุดท้าย (หลัง gmv_with_margin, ก่อน FROM agg a)',
    /a\.gmv_with_margin,[\s\S]{0,400}?a\.first_order_date[^\n]*\nFROM agg a/.test(SQL1),
    'ต้องต่อท้าย ไม่ใช่แทรกกลาง ไม่งั้น margin_ex_vat/gmv_with_margin เลื่อนตำแหน่ง');
  check('SQL1: margin_ex_vat, gmv_with_margin ยังอยู่ตำแหน่งเดิม (ก่อน first_order_date)',
    /a\.margin_ex_vat,\s*\n\s*a\.gmv_with_margin/.test(SQL1));
  check('SQL1: last_order_date เดิมยังอยู่ครบ ไม่ถูกลบ', /a\.last_order_date/.test(SQL1));
}
if (Q3B) {
  check('Q3B: first_order_date เป็นคอลัมน์ SELECT สุดท้าย (หลัง last_order_date, ก่อน FROM agg a)',
    /a\.last_order_date,[\s\S]{0,400}?a\.first_order_date[^\n]*\nFROM agg a/.test(Q3B),
    'Q3B ไม่มี margin คอลัมน์ ต้องต่อท้าย last_order_date ตรงๆ');
  check('Q3B: ไม่มีการเพิ่มคอลัมน์ margin_ex_vat/gmv_with_margin (คนละ scope กับ SQL1)',
    !/margin_ex_vat|gmv_with_margin/.test(Q3B));
}

console.log('\n── 2. SQL: company_sku_reach.sql (criterion ข sole-source) ──');
check('company_sku_reach.sql มีไฟล์', !!REACH_SQL);
if (REACH_SQL) {
  check('GROUP BY item_id ทั้งบริษัท (ไม่ join kam_list — ไม่ผ่าน splitter)',
    /GROUP BY[^;]*item_id/i.test(REACH_SQL) && !/kam_list/.test(REACH_SQL));
  check('มีคอลัมน์ distinct_account_count', /distinct_account_count/.test(REACH_SQL));
  check('มีคอลัมน์ total_gmv', /total_gmv/.test(REACH_SQL));
  check('มีคอลัมน์ total_order_count', /total_order_count/.test(REACH_SQL));
  check('ใช้ COUNT(DISTINCT ...) สำหรับนับร้าน ไม่ใช่ COUNT เฉยๆ (นับซ้ำ)',
    /COUNT\s*\(\s*DISTINCT/i.test(REACH_SQL));
}

console.log('\n── 3. Parser: first_order_date dispatch ด้วยความยาวแถว ไม่ใช่ offset ตายตัว ──');
if (DP) {
  const parseSrc = DP.slice(DP.indexOf('function _parseSKULine'), DP.indexOf('// ── Pass 1: parse current account first'));
  check('มี field firstOrderDate ใหม่ใน _parseSKULine', /firstOrderDate/.test(parseSrc));
  check('dispatch ด้วย p.length ไม่ใช่ offset คงที่ตัวเดียว (กันชน margin slot ของ Q3B)',
    /p\.length\s*>=\s*22/.test(parseSrc) && /p\.length\s*===\s*20/.test(parseSrc),
    'SQL1 ใหม่=22 คอลัมน์, Q3B ใหม่=20 คอลัมน์ — ต้องเช็คคนละเงื่อนไข ไม่งั้น Q3B แถวใหม่จะถูกอ่านเป็น margin (p[19])');
  check('margin/gmvWithMargin เส้นเดิมไม่ถูกแตะ (ยังอ่านแบบ unconditional p[18+off]/p[19+off])',
    /const margin=parseFloat\(p\[18\+off\]\)\|\|0/.test(parseSrc) &&
    /const gmvWithMargin=parseFloat\(p\[19\+off\]\)\|\|0/.test(parseSrc),
    'ถ้าแก้เส้นนี้โดยไม่จำเป็น เสี่ยงพัง GP feature ที่ทำงานอยู่แล้ว');

  // ── vm-eval the dispatch logic against synthetic rows of exact real lengths ──
  try {
    const helper = `
      function dispatchFirstOrderDate(p, off){
        ${(parseSrc.match(/let firstOrderDate[\s\S]*?;\s*\n(?:[^\n]*firstOrderDate[^\n]*\n){0,3}/) || [''])[0]}
        return typeof firstOrderDate !== 'undefined' ? firstOrderDate : null;
      }
      this.API = { dispatchFirstOrderDate };
    `;
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(helper, ctx);
    const { dispatchFirstOrderDate } = ctx.API;

    const oldQ3B = Array(19).fill('x');                          // pre-change Q3B shape
    const newQ3B = Array(19).fill('x').concat(['2026-08-01']);    // +first_order_date → 20 cols
    const oldSQL1 = Array(21).fill('x');                          // pre-change SQL1 shape (has margin cols)
    const newSQL1 = Array(21).fill('x').concat(['2026-08-10']);   // +first_order_date → 22 cols

    check('แถว Q3B เก่า (19 คอลัมน์) → firstOrderDate เป็น null (ยังไม่มีคอลัมน์นี้)',
      dispatchFirstOrderDate(oldQ3B, 1) === null);
    check('แถว Q3B ใหม่ (20 คอลัมน์) → firstOrderDate อ่านค่าถูกตำแหน่ง',
      dispatchFirstOrderDate(newQ3B, 1) === '2026-08-01');
    check('แถว SQL1 เก่า (21 คอลัมน์, มี margin) → firstOrderDate เป็น null',
      dispatchFirstOrderDate(oldSQL1, 1) === null);
    check('แถว SQL1 ใหม่ (22 คอลัมน์) → firstOrderDate อ่านค่าถูกตำแหน่ง (ไม่ชน margin/gmvWithMargin)',
      dispatchFirstOrderDate(newSQL1, 1) === '2026-08-10');
  } catch (e) {
    check('vm-eval dispatch logic รันได้ (ยังไม่ได้ implement)', false, e.message);
  }

  check('มี R2_FILES/R2_SPECS entry ใหม่สำหรับ company_sku_reach', /sku_reach|sku-reach/.test(DP));
} else {
  check('02_data_pipeline.js อ่านได้', false);
}

console.log('\n── 4. Scoring engine (src/13_key_sku.js) — pure functions ──');
if (KEYSKU) {
  try {
    const ctx = { console };
    vm.createContext(ctx);
    vm.runInContext(KEYSKU + `
      this.API = {
        _keySkuNoiseFloorPass: typeof _keySkuNoiseFloorPass!=='undefined'?_keySkuNoiseFloorPass:null,
        _keySkuConcentrationScore: typeof _keySkuConcentrationScore!=='undefined'?_keySkuConcentrationScore:null,
        _keySkuSoleSourceScore: typeof _keySkuSoleSourceScore!=='undefined'?_keySkuSoleSourceScore:null,
        _keySkuNewnessScore: typeof _keySkuNewnessScore!=='undefined'?_keySkuNewnessScore:null,
        _keySkuBadges: typeof _keySkuBadges!=='undefined'?_keySkuBadges:null,
        computeKeySkuCandidates: typeof computeKeySkuCandidates!=='undefined'?computeKeySkuCandidates:null
      };
    `, ctx);
    const API = ctx.API;

    check('_keySkuNoiseFloorPass export อยู่', !!API._keySkuNoiseFloorPass);
    if (API._keySkuNoiseFloorPass) {
      check('noise floor: gmv ต่ำกว่า 3000 บาท (พื้นขั้นต่ำ) → false',
        API._keySkuNoiseFloorPass(2000, 1000000) === false);
      check('noise floor: gmv สูงกว่า 3000 แต่ต่ำกว่า 0.5% ของยอดร้าน → false',
        API._keySkuNoiseFloorPass(4000, 10000000) === false);
      check('noise floor: gmv ผ่านทั้งพื้นขั้นต่ำและสัดส่วน → true',
        API._keySkuNoiseFloorPass(10000, 1000000) === true);
    }

    check('_keySkuConcentrationScore export อยู่', !!API._keySkuConcentrationScore);
    if (API._keySkuConcentrationScore) {
      check('concentration: pct>=15 → 40 (strong)', API._keySkuConcentrationScore(20, false) === 40);
      check('concentration: pct>=8 <15 → 24 (moderate)', API._keySkuConcentrationScore(10, false) === 24);
      check('concentration: pct<8 แต่เป็น Top-1 ของร้าน → 12 (floor-rank กันร้านไม่มี candidate)',
        API._keySkuConcentrationScore(3, true) === 12);
      check('concentration: pct<8 ไม่ใช่ Top-1 → 0', API._keySkuConcentrationScore(3, false) === 0);
    }

    check('_keySkuSoleSourceScore export อยู่', !!API._keySkuSoleSourceScore);
    if (API._keySkuSoleSourceScore) {
      check('sole-source: <=3 ร้านทั้งบริษัท + order_count>=2 → 35 (strong)',
        API._keySkuSoleSourceScore({distinct_account_count:2, total_order_count:5}) === 35);
      check('sole-source: <=3 ร้านแต่ order_count=1 (noise) → ไม่ถึง strong',
        API._keySkuSoleSourceScore({distinct_account_count:2, total_order_count:1}) !== 35);
      check('sole-source: 4-7 ร้าน → 21 (moderate)',
        API._keySkuSoleSourceScore({distinct_account_count:5, total_order_count:10}) === 21);
      check('sole-source: >7 ร้าน → 0', API._keySkuSoleSourceScore({distinct_account_count:20, total_order_count:10}) === 0);
      check('sole-source: ไม่มีข้อมูล reach เลย → 0 (ไม่ throw)', API._keySkuSoleSourceScore(null) === 0);
    }

    check('_keySkuNewnessScore export อยู่', !!API._keySkuNewnessScore);
    if (API._keySkuNewnessScore) {
      const now = new Date('2026-08-16T12:00:00Z').getTime();
      check('newness: order_count=1 + สั่งภายใน 14 วัน → 25',
        API._keySkuNewnessScore(1, '2026-08-10', now) === 25);
      check('newness: order_count=1 แต่เกิน 14 วัน → 0',
        API._keySkuNewnessScore(1, '2026-07-01', now) === 0);
      check('newness: order_count>1 (สั่งซ้ำแล้ว ไม่ใช่ของใหม่) → 0',
        API._keySkuNewnessScore(3, '2026-08-15', now) === 0);
      check('newness: ไม่มี last_order_date → 0 (ไม่ throw)',
        API._keySkuNewnessScore(1, null, now) === 0);
    }

    check('_keySkuBadges export อยู่', !!API._keySkuBadges);
    if (API._keySkuBadges) {
      const badges3 = API._keySkuBadges({soleSource:35, newness:25, concentration:40, pct:42, daysSince:5});
      check('badge priority: sole-source มาก่อนเสมอเมื่อเข้าเกณฑ์', badges3[0] && badges3[0].key === 'sole_source');
      check('badge priority: newness มาก่อน concentration', badges3[1] && badges3[1].key === 'newness');
      check('badge cap: แสดงสูงสุด 2 badge แม้เข้าเกณฑ์ครบ 3', badges3.length === 2);
      const badgeConcOnly = API._keySkuBadges({soleSource:0, newness:0, concentration:24, pct:10, daysSince:0});
      check('badge: เข้าเกณฑ์เดียวก็แสดงแค่ 1 badge (ไม่ยัด badge เปล่า)', badgeConcOnly.length === 1);
    }

    check('computeKeySkuCandidates export อยู่', !!API.computeKeySkuCandidates);
    if (API.computeKeySkuCandidates) {
      const now = new Date('2026-08-16T12:00:00Z').getTime();
      const rows = [
        { id:'sku_soleSource', name:'กุ้งขาว', pct:5, isTop1:false, gmvRecentMonth:20000, accountMonthTotalGmv:1000000, orderCount:5, lastOrderDate:'2026-07-01', reach:{distinct_account_count:2,total_order_count:8} },
        { id:'sku_noise', name:'ถุงมือยาง', pct:0.1, isTop1:false, gmvRecentMonth:500, accountMonthTotalGmv:1000000, orderCount:3, lastOrderDate:'2026-08-01', reach:null },
        { id:'sku_nothing', name:'น้ำแข็ง', pct:1, isTop1:false, gmvRecentMonth:8000, accountMonthTotalGmv:1000000, orderCount:4, lastOrderDate:'2026-06-01', reach:{distinct_account_count:50,total_order_count:200} }
      ];
      const result = API.computeKeySkuCandidates(rows, { now });
      check('candidate pool ไม่รวม SKU ที่ตกพื้น noise floor', !result.some(c => c.id === 'sku_noise'));
      check('candidate pool ไม่รวม SKU ที่ไม่เข้าเกณฑ์ไหนเลย', !result.some(c => c.id === 'sku_nothing'));
      check('candidate pool รวม SKU ที่เข้าเกณฑ์ sole-source', result.some(c => c.id === 'sku_soleSource'));

      const emptyResult = API.computeKeySkuCandidates([
        { id:'x', name:'y', pct:1, isTop1:false, gmvRecentMonth:100, accountMonthTotalGmv:1000000, orderCount:9, lastOrderDate:'2026-01-01', reach:{distinct_account_count:99,total_order_count:500} }
      ], { now });
      check('edge case: ร้านไม่มี candidate เลย → array ว่าง ไม่ throw', Array.isArray(emptyResult) && emptyResult.length === 0);
    }

    const buildRowsSrc = KEYSKU.slice(KEYSKU.indexOf('function _keySkuBuildRows'), KEYSKU.indexOf('function computeKeySkuCandidatesForAccount'));
    check('edge case: บัญชีใหม่ไม่มีเดือนปิดเลย (มีแค่ MTD) ต้องไม่ return [] ทันที',
      !/if \(!latestClosed\) return \[\];/.test(buildRowsSrc),
      'แก้แล้ว 2026-08-16 self-review — เดิม return [] ทันทีที่ไม่มีเดือนปิด ทำให้บัญชีใหม่ (ที่ criterion ค ควรเด่นที่สุด) ไม่มี candidate เลยสักตัว');
    check('edge case: บัญชีใหม่ fallback ไปใช้ MTD เป็น baseline เอง (mtdTotal/mtdTop1)',
      /var mtdRows/.test(buildRowsSrc) && /var mtdTotal/.test(buildRowsSrc) && /mtdTop1Id/.test(buildRowsSrc));
  } catch (e) {
    check('vm-eval 13_key_sku.js สำเร็จ (ยังไม่ได้เขียนไฟล์)', false, e.message);
  }
} else {
  check('src/13_key_sku.js มีไฟล์ (ยังไม่ได้สร้าง)', false);
}

console.log('\n── 5. UI wiring: showScreen + ห้ามแตะ nav config ──');
if (KAM) {
  const mainHideLine = (KAM.match(/mainEl\.style\.display=\([^;]*\)\?'none':''/) || [''])[0];
  check("showScreen ternary ซ่อน .main สำหรับ 'key'/'key-queue' เหมือน portview/teamview",
    /name===['"]key['"]/.test(mainHideLine) && /name===['"]key-queue['"]/.test(mainHideLine));
} else {
  check('05_kam_view.js อ่านได้', false);
}
if (NAV) {
  check("12_nav_config.js ไม่ถูกแตะ — ไม่มีคำว่า 'key' โผล่ใน TABS/NAV_CONFIG",
    !/['"]key['"]|['"]key-queue['"]/.test(NAV),
    'จุดแข็งของดีไซน์นี้คือไม่เพิ่มปุ่มที่ 6 บน bottom nav — ถ้าเจอคำว่า key ในไฟล์นี้ = หลุดสเปก');
}
if (SHELL) {
  check('shell.html มี #scr-key', /id="scr-key"/.test(SHELL));
  check('shell.html มี #scr-key-queue', /id="scr-key-queue"/.test(SHELL));
  check('kam-overview ไม่มี #kam-key-sku-card แล้ว (ตัดออกตาม self-review — แทนที่ด้วยปุ่มแบ่งครึ่ง)',
    !/kam-key-sku-card/.test(SHELL));
  check('.kav-brief-row แบ่งครึ่ง Account Insight กับ #key-sku-split-btn ในแถวเดียวกัน (ไม่เพิ่ม row)',
    /class="kav-brief-row"[\s\S]{0,500}id="kam-insight-btn"[\s\S]{0,500}id="key-sku-split-btn"/.test(SHELL));
  check('nav-opportunities: label เปลี่ยนเป็น Products (ไม่ใช่ Save)',
    /id="nav-opportunities"[\s\S]{0,300}<span class="lb">Products<\/span>/.test(SHELL));
  check('nav-opportunities: onclick เปิด popover (toggleProductsPopover) ไม่ navigate ตรง',
    /id="nav-opportunities" onclick="toggleProductsPopover\(this\)"/.test(SHELL),
    'ต้องไม่เปลี่ยนหน้าไปเลย — ให้ popover เป็นคนตัดสินใจว่าจะไป Save หรือ Key SKU');
  check('badge เดิม opp-nav-badge เปลี่ยนชื่อเป็น key-nav-badge (คนละความหมายจาก OPPS.length แล้ว)',
    /id="key-nav-badge"/.test(SHELL) && !/id="opp-nav-badge"/.test(SHELL));
  check('มี symbol #ico-products ใหม่ (ไม่ใช้ #ico-sense เดิมซึ่งสื่อ Save/AI อย่างเดียว)',
    /<symbol[^>]*id="ico-products"/.test(SHELL));
  check('มี container #products-popover + #products-popover-backdrop',
    /id="products-popover"/.test(SHELL) && /id="products-popover-backdrop"/.test(SHELL));
}

console.log('\n── 6. Storage: audit trail + ห้าม hard delete ──');
if (MIGRATION) {
  check('ตาราง key_skus มี set_by/set_at', /set_by/.test(MIGRATION) && /set_at/.test(MIGRATION));
  check('ตาราง key_skus มี removed_by/removed_at', /removed_by/.test(MIGRATION) && /removed_at/.test(MIGRATION));
  check('unique index กัน active ซ้ำ (account_id, outlet_id, sku_id) where status=active',
    /unique[\s\S]{0,200}status\s*=\s*'active'/i.test(MIGRATION));
  check('มีตาราง key_skus_export_state (dirty flag เตรียมไว้สำหรับเฟส Sheets export)',
    /key_skus_export_state/.test(MIGRATION));
} else {
  check('docs/supabase-migration-key-skus-2026-08-16.sql มีไฟล์', false);
}
if (KEYSKU) {
  check("persist ใช้ status='removed' ไม่ hard-delete", /status:\s*['"]removed['"]/.test(KEYSKU) && !/\.delete\(\)/.test(KEYSKU));
}
if (MIGRATION) {
  check("RLS ทุก policy case-fold email ด้วย lower() (กัน 'Salmon@' vs 'salmon@' จริงที่พบใน DB)",
    (MIGRATION.match(/lower\(/g) || []).length >= 6,
    'auth.jwt()->>email เทียบตรงๆ กับ profiles.email/set_by แบบ case-sensitive จะทำให้ RLS คืนแถวว่างเงียบๆ สำหรับ user ที่ email เคสไม่ตรงกัน');
}
console.log('\n── 7. Self-review fixes (2026-08-16): confirmed-broken ON CONFLICT + XSS ──');
if (KEYSKU) {
  check('confirm ใช้ .insert() ไม่ใช่ .upsert({onConflict}) — พิสูจน์แล้วว่า upsert พังจริงกับ partial unique index (error 42P10)',
    /\.from\('key_skus'\)\.insert\(rows\)/.test(KEYSKU) && !/\.upsert\(rows,\s*\{\s*onConflict/.test(KEYSKU),
    'ทดสอบตรงกับ DB จริงแล้ว: ON CONFLICT (account_id, sku_id) ที่ไม่มี WHERE status=\'active\' ชนกับ partial unique index ล้มทุกครั้งด้วย 42P10');
  check('มี _keySkuAttrEsc แยกจาก _keySkuEsc (กัน apostrophe ในชื่อ SKU/ร้านหลุดออกจาก single-quoted JS string ใน onclick)',
    /function _keySkuAttrEsc/.test(KEYSKU));
  const attrEscSites = (KEYSKU.match(/_keySkuAttrEsc\(/g) || []).length;
  check('onclick 4 จุดที่ฝัง id/ชื่อเข้า JS string argument ใช้ _keySkuAttrEsc ครบ (ไม่ใช่ _keySkuEsc เฉยๆ)',
    attrEscSites >= 4,
    'พบ ' + attrEscSites + ' จุด — keyPortfolioQuickConfirm x3, keyRemoveExisting, keyAddSku x2 ต้องผ่าน attr-esc ไม่ใช่ html-esc เฉยๆ');
}
if (DP) {
  check('data pipeline: re-render split button/scr-key เมื่อ SKU ของ account ปัจจุบันมาถึงช้ากว่าจอที่เปิดอยู่',
    /if\(bulkSkusData\[pri\]\)\{[\s\S]{0,1000}?renderKeySkuSplitButton[\s\S]{0,200}?renderKeyScreen/.test(DP),
    'ไม่งั้นปุ่ม/หน้า Key SKU จะค้างว่างเปล่าถ้า R2 fetch ช้ากว่าที่ผู้ใช้เปิดจอ ต้องรอสลับจอไปมาถึงจะเห็นข้อมูล');
  check('data pipeline: re-render scr-key-queue เมื่อ bulk-skus ทั้งพอร์ตพาร์สเสร็จช้ากว่าที่จอเปิดอยู่',
    /renderKeyQueueScreen/.test(DP));
  check('data pipeline: opp-nav-badge (OPPS.length) เส้นเดิมถูกถอดออกแล้ว (ย้ายไปอยู่ใน SAVE subline ของ popover แทน)',
    !/getElementById\('opp-nav-badge'\)/.test(DP));
  check('data pipeline: เรียก renderKeySkuNavBadge ตอน refresh ข้อมูลบัญชีปัจจุบัน',
    /renderKeySkuNavBadge/.test(DP));
}

console.log('\n── 8. build.py wiring ──');
if (BUILD) {
  check("MAIN_MODULES มี '13_key_sku'", /'13_key_sku'/.test(BUILD));
  check('มี read styles_key.css', /styles_key/.test(BUILD));
}

console.log('\n── 9. Pivot (2026-08-16, second self-review round): Products popover + split button ──');
if (KEYSKU) {
  check('เอา renderKeySkuCoverageCard/renderKeyPortviewCard/renderKeyTeamRollup ออกหมด (ของเดิมที่เบียด layout)',
    !/function renderKeySkuCoverageCard/.test(KEYSKU) && !/function renderKeyPortviewCard/.test(KEYSKU) && !/function renderKeyTeamRollup/.test(KEYSKU));
  check('มี _keySkuSaveSubline ที่เช็ค currentAccountId → senseActivated → OPPS.length ตามลำดับจริงของฟีเจอร์ Save',
    /function _keySkuSaveSubline/.test(KEYSKU) &&
    /currentAccountId[\s\S]{0,80}===\s*'default'/.test(KEYSKU) &&
    /senseActivated/.test(KEYSKU) &&
    /OPPS\.length/.test(KEYSKU),
    'ต้องอิงตัวแปรจริงของฟีเจอร์ Save (senseActivated/OPPS) ไม่ใช่เลขที่คิดเอาเอง — ตรงกับที่ opp-nav-badge เดิมเคยเช็ค');
  check('มี renderProductsPopover / toggleProductsPopover / productsGoSave / productsGoKeySku / renderKeySkuNavBadge / renderKeySkuSplitButton ครบ',
    ['renderProductsPopover', 'toggleProductsPopover', 'productsGoSave', 'productsGoKeySku', 'renderKeySkuNavBadge', 'renderKeySkuSplitButton']
      .every(fn => new RegExp('function ' + fn).test(KEYSKU)));
  check('productsGoSave ทำเหมือน onclick เดิมของ nav-opportunities เป๊ะ (isKAM+restaurant-sheet → _overlayNav, ไม่งั้น showScreen(\'opportunities\'))',
    /function productsGoSave[\s\S]{0,400}restaurant-sheet[\s\S]{0,100}_overlayNav\('opportunities'\)[\s\S]{0,200}showScreen\('opportunities'\)/.test(KEYSKU));
}
if (PORTVIEW_JS) {
  check('portview render ไม่มี renderKeyPortviewCard/key-portview-card-slot เหลืออยู่แล้ว (คืน layout เดิม)',
    !/renderKeyPortviewCard/.test(PORTVIEW_JS) && !/key-portview-card-slot/.test(PORTVIEW_JS));
  check('portview render เรียก renderKeySkuNavBadge (hook ที่เชื่อถือได้แทนการ์งเดิม)',
    /renderKeySkuNavBadge/.test(PORTVIEW_JS));
}
if (KAM) {
  check('teamview ไม่มี renderKeyTeamRollup/key-tl-rollup-slot เหลืออยู่แล้ว (คืน layout เดิมของ TL view)',
    !/renderKeyTeamRollup/.test(KAM) && !/key-tl-rollup-slot/.test(KAM));
}
if (STYLES_KEY) {
  check('styles_key.css ไม่มี --fk-red เหลืออยู่เลย (ย้ายไป --fk-orange ครบ 100%)',
    !/--fk-red/.test(STYLES_KEY));
  check('styles_key.css มี .products-popover/.pv-row (popover) และ .kav-brief-row/.key-sku-btn (split button)',
    /\.products-popover/.test(STYLES_KEY) && /\.pv-row/.test(STYLES_KEY) &&
    /\.kav-brief-row/.test(STYLES_KEY) && /\.key-sku-btn/.test(STYLES_KEY));
}

console.log('\n── 10. ROUND 3 (2026-08-16): บั๊กจาก browser-test จริงของบุช — nav gating / icon / viewport / back-button ──');
if (NAV) {
  check('บั๊ก A: 12_nav_config.js เลิก disable nav-opportunities เอง (saveDisabledOn ถูกถอดออกจาก NAV_CONFIG ทุก role)',
    !/saveDisabledOn/.test(NAV),
    'ปุ่ม Products ต้องกดได้เสมอไม่ว่าจะอยู่หน้าไหน — popover เองจัดการ per-row ถูกอยู่แล้ว');
  check('บั๊ก A: updateSaveState เหลือแค่ remove(\'nav-disabled\') ไม่ toggle ตาม screen แล้ว',
    /function updateSaveState[\s\S]{0,150}classList\.remove\('nav-disabled'\)/.test(NAV));
}
if (KAM) {
  check('บั๊ก A: showScreen ไม่มี code เดิมที่ add(\'nav-disabled\') ให้ nav-opportunities บน portview/teamview/skills แล้ว',
    !/_sb\.classList\.add\('nav-disabled'\)/.test(KAM),
    'ตัวแปร _sb (nav-opportunities) เคยโดน force-disable ใน 3 จุดของ showScreen — ต้องไม่เหลือแม้แต่จุดเดียว');
}
if (PORTVIEW_JS) {
  check('บั๊ก A: _updateKamNavDisabled ไม่ toggle nav-disabled ให้ nav-opportunities ตาม hasAcct แล้ว (แค่ remove เสมอ)',
    /function _updateKamNavDisabled/.test(PORTVIEW_JS) &&
    /senseBtn\.classList\.remove\('nav-disabled'\)/.test(PORTVIEW_JS) &&
    !/senseBtn\.classList\.toggle\('nav-disabled'/.test(PORTVIEW_JS));
}
if (KEYSKU) {
  check('บั๊ก B: แถว SAVE ใน popover ใช้ path ประกาย 4 แฉกของ #ico-sense จริง ไม่ใช่ bookmark path ที่คิดเอง',
    /viewBox="0 0 10 10"[\s\S]{0,20}fill="currentColor"[\s\S]{0,20}<path d="M5,0 L6\.3,3\.7/.test(KEYSKU) &&
    !/M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z/.test(KEYSKU));
  check('บั๊ก C: toggleProductsPopover clamp ด้วย .bnav rect + visualViewport ไม่ใช่ window.innerWidth ตรงๆ',
    /getBoundingClientRect\(\)[\s\S]{0,300}shellLeft[\s\S]{0,300}shellRight/.test(KEYSKU) &&
    /window\.visualViewport/.test(KEYSKU));
  check('บั๊ก C: มี vertical clamp กันกล่องเด้งพ้นด้านบนจอ (ไม่ใช่แค่ bottom ตรงๆ แบบเดิม)',
    /vh \+ voffTop - 80/.test(KEYSKU));
  check('บั๊ก D: มี _keyScreenEntryFrom + _keySkuCurrentScreenName ครบ (จำที่มาก่อนเข้า scr-key)',
    /var _keyScreenEntryFrom/.test(KEYSKU) && /function _keySkuCurrentScreenName/.test(KEYSKU));
  check('บั๊ก D: productsGoKeySku ตั้ง _keyScreenEntryFrom ก่อน showScreen(\'key\')',
    /_keyScreenEntryFrom\s*=\s*_keySkuCurrentScreenName\(\)[\s\S]{0,60}showScreen\('key'\)/.test(KEYSKU));
  check('บั๊ก D: renderKeyScreen ปุ่ม back ใช้ _keyScreenEntryFrom แทนค่าฮาร์ดโค้ด \'key-queue\'',
    /var backTarget = _keyScreenEntryFrom \|\| 'key-queue'/.test(KEYSKU) &&
    /key-back-btn[\s\S]{0,40}\+ backTarget \+/.test(KEYSKU));
}
if (STYLES_KEY) {
  check('บั๊ก C: .products-popover มี transform:translateX(-50%) เพื่อ center จริงกับปุ่ม',
    /\.products-popover\{[^}]*transform:translateX\(-50%\)/.test(STYLES_KEY));
}
if (SHELL) {
  check('บั๊ก D: ปุ่มแบ่งครึ่ง #key-sku-split-btn ตั้ง _keyScreenEntryFrom=\'overview\' ก่อน showScreen(\'key\') เช่นกัน',
    /id="key-sku-split-btn"[^>]*onclick="_keyScreenEntryFrom='overview';showScreen\('key'\)"/.test(SHELL));
}

console.log('\n── 11. ROUND 3-F (2026-08-16): Key SKU Home รีดีไซน์ — flat SKU-item-centric feed ──');
if (KEYSKU) {
  check('มี getPortfolioProtectedItems / getPortfolioKeySkuCandidates / _keySkuPortfolioSearch / keyPortfolioQuickConfirm ครบ',
    ['getPortfolioProtectedItems', 'getPortfolioKeySkuCandidates', '_keySkuPortfolioSearch', 'keyPortfolioQuickConfirm']
      .every(fn => new RegExp('function ' + fn).test(KEYSKU)));
  check('_keySkuEnsurePortfolioLoaded ขยาย select ครอบ sku_id,sku_name,set_at (ไม่ใช่แค่ account_id) — query เดิม ไม่เพิ่ม fetch',
    /select\('account_id,sku_id,sku_name,set_at'\)/.test(KEYSKU));
  check('_keySkuConfirm และ _keySkuRemoveOne ล้าง _keySkuPortfolioRows ด้วย (ไม่ใช่แค่ _keySkuPortfolioIds) กันข้อมูลค้าง',
    (KEYSKU.match(/_keySkuPortfolioIds = null; _keySkuPortfolioRows = null;/g) || []).length >= 2);
  check('getPortfolioKeySkuCandidates กรอง SKU ที่ confirm ไปแล้วออก (เทียบกับ _keySkuPortfolioRows ไม่ยิง query ซ้ำ)',
    /function getPortfolioKeySkuCandidates[\s\S]{0,400}confirmedKeys/.test(KEYSKU));
  check('เอาโค้ดเก่า renderKeyQueueScreen แบบ list-ร้าน+นับจำนวน ออกหมด (isDone/hasSoleSource/key-queue-row ของ round ก่อน)',
    !/var isDone/.test(KEYSKU) && !/key-queue-row/.test(KEYSKU) && !/keyQueueSelectAccount/.test(KEYSKU));
  check('hero label ใช้ข้อความที่บุชสั่งเป๊ะ: "Marked as Key SKU"',
    /Marked as Key SKU/.test(KEYSKU));
  check('ช่องค้นหาปักหมุด #key-home-q เรียก _keyHomeFilter ทุกครั้งที่พิมพ์ (ค้นข้ามร้านได้ทันที ไม่ต้องกด submit)',
    /id="key-home-q"[\s\S]{0,200}oninput="_keyHomeFilter/.test(KEYSKU));
  check('แถวแนะนำเพิ่มมีปุ่ม + เรียก keyPortfolioQuickConfirm ตรง (ยืนยันในแตะเดียว ไม่ต้องเข้าร้านก่อน)',
    /class="addbtn" onclick="keyPortfolioQuickConfirm/.test(KEYSKU));
  check('แถวปกป้องแล้วโชว์วันที่จริงแบบสั้น (_keySkuShortDate) ไม่ใช่ข้อความสัมพัทธ์',
    /เพิ่มเมื่อ ' \+ _keySkuShortDate/.test(KEYSKU) && /function _keySkuShortDate/.test(KEYSKU));
  check('.ptag/.rtag (ชื่อร้าน) เป็นแถวเดียวเสมอ ไม่ตกบรรทัดที่ 3 แม้ชื่อยาว — คุมด้วย _keySkuEsc ปกติ ไม่ต้องมี logic ตัดคำเพิ่มใน JS (ให้ CSS ทำ ellipsis)',
    /class="ptag-row"[\s\S]{0,30}<span class="ptag">/.test(KEYSKU) && /class="rtag-row"[\s\S]{0,30}<span class="rtag">/.test(KEYSKU));
}
if (STYLES_KEY) {
  check('styles_key.css มี .key-hero/.key-home-search/.prow/.rrow/.addbtn ครบ (ของเดิม .key-queue-row/.key-queue-summary ถูกถอดออก)',
    /\.key-hero\{/.test(STYLES_KEY) && /\.key-home-search/.test(STYLES_KEY) &&
    /\.prow\{/.test(STYLES_KEY) && /\.rrow\{/.test(STYLES_KEY) && /\.addbtn\{/.test(STYLES_KEY) &&
    !/\.key-queue-row\{/.test(STYLES_KEY) && !/\.key-queue-summary\{/.test(STYLES_KEY));
  check('.ptag/.rtag ตัดจบด้วย ellipsis ไม่ wrap ตกบรรทัด (กันปัญหาที่บุชเจอ: ชื่อร้านยาวดันเป็น 3 บรรทัด)',
    /\.ptag\{[^}]*text-overflow:ellipsis/.test(STYLES_KEY) && /\.rtag\{[^}]*text-overflow:ellipsis/.test(STYLES_KEY) &&
    /\.ptag-row\{[^}]*flex-wrap:nowrap/.test(STYLES_KEY) && /\.rtag-row\{[^}]*flex-wrap:nowrap/.test(STYLES_KEY));
}

// ── 12. v_keyoutlet (2026-08-16): fan out Key SKU per outlet, not per account ──
// บุช: ทีม supply ต้องใช้ res_name/res_id (outlet grain) ไม่ใช่ account grain —
// mark Key SKU ที่ account ต้อง apply กับทุก outlet ใต้ account นั้น (UI ยังคง
// account-based เหมือนเดิม แค่การเขียน DB fan out เป็นราย outlet)
console.log('\n── 12. Outlet fan-out (Key SKU applies to every outlet under the account) ──');
if (OUTLET_MIGRATION) {
  check('migration widen unique index ให้รวม outlet_id (account_id, outlet_id, sku_id)',
    /CREATE UNIQUE INDEX key_skus_active_uidx[\s\S]{0,80}\(account_id, outlet_id, sku_id\)/.test(OUTLET_MIGRATION));
  check('migration DROP INDEX ตัวเก่าก่อนสร้างใหม่ (กัน "index already exists")',
    /DROP INDEX IF EXISTS key_skus_active_uidx/.test(OUTLET_MIGRATION));
} else check('มีไฟล์ migration ขยาย unique index เป็น outlet-aware', false);

if (KEYSKU) {
  check('_keySkuOutletsFor อ่าน bulkOutletsData (ข้อมูล outlet ที่โหลดอยู่แล้ว ไม่ยิง fetch ใหม่)',
    /function _keySkuOutletsFor[\s\S]{0,300}bulkOutletsData/.test(KEYSKU));
  check('_keySkuOutletsFor dedupe ตาม outlet_id (กันร้านเดียวถูกนับซ้ำข้ามเดือน)',
    /function _keySkuOutletsFor[\s\S]{0,500}seen\[o\.outlet_id\]/.test(KEYSKU));
  check('_keySkuConfirm เรียก _keySkuOutletsFor แล้ว fan out 1 แถวต่อ 1 outlet ต่อ 1 sku',
    /var outlets = _keySkuOutletsFor\(accountId\)/.test(KEYSKU) &&
    /outlets\.forEach\(function \(o\) \{/.test(KEYSKU));
  check('_keySkuConfirm มี fallback เขียนแถวเดียว (outlet_id:null) ถ้ายังไม่มีข้อมูล outlet — ไม่ปล่อยให้ confirm เงียบ',
    /\} else \{[\s\S]{0,300}outlet_id: null, outlet_name: null,/.test(KEYSKU));
  check('localStorage fallback ใช้ items (ราย SKU) ไม่ใช่ rows ที่ fan out แล้ว — กัน local cache โชว์ซ้ำ',
    /\.concat\(items\.map\(function \(it\) \{ return \{ sku_id: String\(it\.id\)/.test(KEYSKU));
  check('applyRows (per-account existing list) dedupe ตาม sku_id ก่อนเก็บเป็น existingIds/rows',
    /function applyRows\(rows\) \{[\s\S]{0,600}seenSku\[r\.sku_id\]/.test(KEYSKU));
  check('getPortfolioProtectedItems dedupe ตาม account_id+sku_id ก่อนแสดงในฟีดหน้า Home',
    /function getPortfolioProtectedItems\(\)[\s\S]{0,400}seen\[key\]/.test(KEYSKU));
} else check('อ่าน src/13_key_sku.js ได้', false);

if (WORKER) {
  check('worker export ดึง outlet_id เพิ่มจาก key_skus (ไม่ใช่แค่ outlet_name)',
    /key_skus\?status=eq\.active&select=account_name,outlet_id,outlet_name,sku_id/.test(WORKER));
  check('Sheet header ใช้ศัพท์ res_name/res_id ตามที่ทีม supply ใช้จริง',
    /'res_name'/.test(WORKER) && /'res_id \(user_id\)'/.test(WORKER));
} else check('อ่าน worker/freshket-sense-ai-proxy-v2.js ได้', false);

// ── 13. Pre-push review finding (2026-08-16): stale badge-ID reset ──────────
// 01_core.js's cross-session reset (logout/role-switch) still cleared the OLD
// #opp-nav-badge element — dead since the pivot renamed it to #key-nav-badge,
// meaning the Key SKU pending count could visibly bleed from one login into
// the next until the first refreshAll() tick corrected it. Section 10/11's
// checks covered 02_data_pipeline.js and shell.html but never 01_core.js —
// this file wasn't in this harness's original scope, which is exactly how it
// slipped through. Locking it in now so it can't regress.
console.log('\n── 13. Cross-session reset targets the renamed badge (no stale bleed on login switch) ──');
if (CORE) {
  check('01_core.js reset clears #key-nav-badge (not the old #opp-nav-badge)',
    /getElementById\('key-nav-badge'\)/.test(CORE) && !/getElementById\('opp-nav-badge'\)/.test(CORE));
} else check('อ่าน src/01_core.js ได้', false);

console.log('\n' + (fail ? `❌ verify_key_sku: ผ่าน ${pass} · ไม่ผ่าน ${fail}` : `✅ verify_key_sku: ผ่าน ${pass} · ไม่ผ่าน 0`));
process.exit(fail ? 1 : 0);
