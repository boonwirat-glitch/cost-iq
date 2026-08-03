#!/usr/bin/env node
/**
 * verify_gp_helper.js — v_gp (2026-07-31)
 *
 * ตรวจสัญญาของตัวคำนวณ GP ทั้งสองฝั่ง (Sense: senseGpFor / senseGpFromSkuRows,
 * /nrr: nrrGpFor / nrrGpFromCells / nrrGpCellsForMonth) โดยดึงโค้ดจริงออกมา
 * จากไฟล์ต้นฉบับ ไม่ได้เขียนสูตรซ้ำในเทสต์ — ถ้าใครแก้สูตรแล้วสัญญาพัง
 * เทสต์ต้องแดง
 *
 * สัญญาที่ล็อกไว้ (เรียงตามความสำคัญ):
 *   [A] ไม่มีข้อมูล → null เท่านั้น ห้ามคืน {gp:0}
 *       เพราะ "เงินที่ขึ้น ฿0 แล้วเปลี่ยนเป็นเลขจริงทีหลัง" เป็นบั๊กความเชื่อใจ
 *       ที่รีโปนี้เคยเจอมาแล้ว และ GP กำลังถูกใช้สอนทีมให้เชื่อตัวเลขนี้
 *   [B] margin ติดลบต้องรอด ห้าม clamp/กรองทิ้ง (สินค้าล่อลูกค้ามีจริง)
 *   [C] coverage < เกณฑ์ → ready:false แต่ hasData:true (ต่างกับ [A])
 *   [D] %GP ต้องหารด้วย GMV ฐานเดียวกับ GP ที่หยิบมา — ไม่ใช่ total เสมอ
 *   [E] เกณฑ์ coverage สองฝั่งต้องเท่ากัน ไม่งั้น Sense กับ /nrr ซ่อน GP
 *       ไม่พร้อมกัน แล้วเลขจะดู "หายไป" เฉพาะบางจอ
 *
 * รัน: node tools/verify_gp_helper.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];

function t(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else {
    fail++; failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? ' — ' + detail : ''));
  }
}
function section(s) { console.log('\n' + s); }

// ── โหลดโค้ดจริง: Sense ────────────────────────────────────────────────────
// ตัดเอาแค่บล็อก GROSS PROFIT จาก 01_core.js แล้ว eval — ไม่ต้องยกทั้งไฟล์
// (ทั้งไฟล์อ้าง DOM/localStorage) แต่ก็ไม่ได้ก็อปสูตรมาเขียนใหม่
const coreSrc = fs.readFileSync(path.join(ROOT, 'src/01_core.js'), 'utf8');
const gpStart = coreSrc.indexOf('const SENSE_GP_MIN_COVERAGE');
const kamSigMark = coreSrc.indexOf('// KAM SIGNALS (rule-based, no AI)');
if (gpStart < 0 || kamSigMark < 0) {
  console.error('ERROR: หาบล็อก GROSS PROFIT ใน src/01_core.js ไม่เจอ — โครงไฟล์เปลี่ยน?');
  process.exit(2);
}
const gpEnd = coreSrc.lastIndexOf('// ════════════════════════════════════════', kamSigMark);
const senseGpBlock = coreSrc.slice(gpStart, gpEnd);
// โหลดผ่าน new Function แล้ว return symbol ออกมา ไม่ใช้ eval ตรงๆ เพราะ
// const/let ที่ประกาศใน eval จะอยู่แต่ใน scope ของ eval เอง มองจากข้างนอกไม่เห็น
const D = { skus_monthly: {} };
const senseApi = new Function('D', senseGpBlock +
  '\nreturn { SENSE_GP_MIN_COVERAGE, senseGpFromSkuRows, senseGpFor };')(D);
const SENSE_GP_MIN_COVERAGE = senseApi.SENSE_GP_MIN_COVERAGE;
const senseGpFromSkuRows = senseApi.senseGpFromSkuRows;
const senseGpFor = senseApi.senseGpFor;

// ── โหลดโค้ดจริง: /nrr ─────────────────────────────────────────────────────
const dataSrc = fs.readFileSync(path.join(ROOT, 'src/nrr/nrr_data.js'), 'utf8');
const nStart = dataSrc.indexOf('var NRR_GP_MIN_COVERAGE');
const nEndMark = 'window.nrrGpForAll = nrrGpForAll;';
const nEnd = dataSrc.indexOf(nEndMark);
if (nStart < 0 || nEnd < 0) {
  console.error('ERROR: หาบล็อก GP ใน src/nrr/nrr_data.js ไม่เจอ — โครงไฟล์เปลี่ยน?');
  process.exit(2);
}
const nrrApi = new Function('window', dataSrc.slice(nStart, nEnd + nEndMark.length) +
  '\nreturn { NRR_GP_MIN_COVERAGE, nrrGpFromCells, nrrGpCellsForMonth, nrrGpFor, nrrGpForAll };')({});
const NRR_GP_MIN_COVERAGE = nrrApi.NRR_GP_MIN_COVERAGE;
const nrrGpFromCells = nrrApi.nrrGpFromCells;
const nrrGpCellsForMonth = nrrApi.nrrGpCellsForMonth;
const nrrGpFor = nrrApi.nrrGpFor;
const nrrGpForAll = nrrApi.nrrGpForAll;

// helpers สร้างข้อมูลทดสอบ
const skuRow = (gmv, margin, gmvWithMargin) => ({ gmv, margin, gmv_with_margin: gmvWithMargin });
const cell = (existingGmv, totalGmv, existingMargin, totalMargin, gmvWithMargin) =>
  ({ existingGmv, totalGmv, existingMargin, totalMargin, gmvWithMargin });

// ═══════════════════════════════════════════════════════════════════════════
section('[E] เกณฑ์ coverage สองฝั่งต้องเท่ากัน');
t('SENSE_GP_MIN_COVERAGE === NRR_GP_MIN_COVERAGE',
  SENSE_GP_MIN_COVERAGE === NRR_GP_MIN_COVERAGE,
  'sense=' + SENSE_GP_MIN_COVERAGE + ' nrr=' + NRR_GP_MIN_COVERAGE);
t('เกณฑ์อยู่ในช่วงที่สมเหตุสมผล (0-1)',
  SENSE_GP_MIN_COVERAGE > 0 && SENSE_GP_MIN_COVERAGE <= 1);

// ═══════════════════════════════════════════════════════════════════════════
section('[A] ไม่มีข้อมูล → null (ห้าม ฿0) — Sense');
// CSV รุ่นก่อนมี GP: parser ให้ margin=0 / gmv_with_margin=0 ทุกแถว
const preGp = [skuRow(1000, 0, 0), skuRow(500, 0, 0)];
const preGpRes = senseGpFromSkuRows(preGp);
t('CSV ก่อนมี GP → hasData:false', preGpRes && preGpRes.hasData === false);
D.skus_monthly = { 'ก.ค. 2569': preGp };
t('senseGpFor คืน null ไม่ใช่ object ที่มี gp:0', senseGpFor('ก.ค. 2569') === null);
t('senseGpFor เดือนที่ไม่มี → null', senseGpFor('ธ.ค. 2599') === null);
t('senseGpFor undefined → null', senseGpFor(undefined) === null);
t('senseGpFor null → null', senseGpFor(null) === null);
t('senseGpFromSkuRows([]) → null', senseGpFromSkuRows([]) === null);
t('senseGpFromSkuRows(null) → null', senseGpFromSkuRows(null) === null);
t('GMV เป็น 0 → null (ไม่หารด้วยศูนย์)', senseGpFromSkuRows([skuRow(0, 0, 0)]) === null);

section('[A] ไม่มีข้อมูล → null (ห้าม ฿0) — /nrr');
t('cell ก่อนมี GP → hasData:false',
  nrrGpFromCells([cell(100, 500, 0, 0, 0)]).hasData === false);
t('nrrGpFromCells([]) → null', nrrGpFromCells([]) === null);
t('nrrGpFromCells(null) → null', nrrGpFromCells(null) === null);
t('nrrGpFor(null bundle) → null', nrrGpFor(null, 'ก.ค. 2569') === null);
t('nrrGpForAll([]) → null', nrrGpForAll([], 'ก.ค. 2569') === null);
const preBundle = { data: { A: { o1: { Beef: { 'ก.ค. 2569': cell(0, 1000, 0, 0, 0) } } } }, groupCategory: { Beef: 'Meat' } };
t('nrrGpFor บน bundle ที่ยังไม่มี GP → null', nrrGpFor(preBundle, 'ก.ค. 2569') === null);

// ═══════════════════════════════════════════════════════════════════════════
section('[B] margin ติดลบต้องรอด ห้ามถูกกรอง/clamp');
const lossSense = senseGpFromSkuRows([skuRow(1000, -300, 1000), skuRow(1000, 100, 1000)]);
t('Sense: GP รวม = -200 (ไม่ใช่ 100 หรือ 0)', lossSense.gp === -200, 'ได้ ' + lossSense.gp);
t('Sense: %GP ติดลบได้', lossSense.gpPct === -10, 'ได้ ' + lossSense.gpPct);
const lossNrr = nrrGpFromCells([cell(0, 1000, 0, -250, 1000)]);
t('/nrr: GP = -250', lossNrr.gp === -250, 'ได้ ' + lossNrr.gp);
t('/nrr: แถวขาดทุนล้วนยังคืน object ไม่ใช่ null', lossNrr !== null);
// SKU เดียวที่ขาดทุนทั้งตัว (เคสสินค้าล่อลูกค้าจริง)
const oneLoss = senseGpFromSkuRows([skuRow(500, -50, 500)]);
t('Sense: SKU เดียวขาดทุน → %GP = -10', oneLoss.gpPct === -10);

// ═══════════════════════════════════════════════════════════════════════════
section('[C] coverage ต่ำกว่าเกณฑ์ → ready:false แต่ hasData:true');
const halfSense = senseGpFromSkuRows([skuRow(1000, 100, 1000), skuRow(1000, 0, 0)]);
t('Sense: coverage = 0.5', halfSense.coverage === 0.5);
t('Sense: ready = false', halfSense.ready === false);
t('Sense: hasData = true (ต่างจากเคส [A])', halfSense.hasData === true);
const halfNrr = nrrGpFromCells([cell(0, 1000, 0, 100, 1000), cell(0, 1000, 0, 0, 0)]);
t('/nrr: coverage = 0.5', halfNrr.coverage === 0.5);
t('/nrr: ready = false, hasData = true', halfNrr.ready === false && halfNrr.hasData === true);

// ขอบเกณฑ์: ต้องเป็น >= ไม่ใช่ > (พอดีเกณฑ์ต้องผ่าน)
const edgeGmv = 1000, edgeWith = edgeGmv * SENSE_GP_MIN_COVERAGE;
const edgeSense = senseGpFromSkuRows([
  skuRow(edgeWith, 100, edgeWith), skuRow(edgeGmv - edgeWith, 0, 0)
]);
t('Sense: coverage พอดีเกณฑ์ → ready:true (>= ไม่ใช่ >)', edgeSense.ready === true,
  'coverage=' + edgeSense.coverage);
const edgeNrr = nrrGpFromCells([
  cell(0, edgeWith, 0, 100, edgeWith), cell(0, edgeGmv - edgeWith, 0, 0, 0)
]);
t('/nrr: coverage พอดีเกณฑ์ → ready:true', edgeNrr.ready === true);
// ต่ำกว่าเกณฑ์แค่นิดเดียวต้องไม่ผ่าน
const justUnder = nrrGpFromCells([cell(0, 699, 0, 90, 699), cell(0, 301, 0, 0, 0)]);
t('/nrr: coverage ต่ำกว่าเกณฑ์เล็กน้อย → ready:false', justUnder.ready === false,
  'coverage=' + justUnder.coverage);

// coverage วัดด้วย "เงิน" ไม่ใช่ "จำนวนแถว"
const manySmallNoMargin = [skuRow(10000, 2000, 10000)].concat(
  Array.from({ length: 50 }, () => skuRow(10, 0, 0))
);
const covByMoney = senseGpFromSkuRows(manySmallNoMargin);
t('Sense: coverage วัดด้วยเงิน ไม่ใช่จำนวนแถว (50 แถวเล็กไม่ทำให้ตก)',
  covByMoney.ready === true, 'coverage=' + covByMoney.coverage.toFixed(4));

// ═══════════════════════════════════════════════════════════════════════════
section('[D] %GP ต้องหารด้วย GMV ฐานเดียวกับ GP');
const both = nrrGpFromCells([cell(400, 1000, 80, 200, 1000)]);
t('/nrr total: gp=200 gmv=1000 → 20%', both.gp === 200 && both.gmv === 1000 && both.gpPct === 20);
const exOnly = nrrGpFromCells([cell(400, 1000, 80, 200, 1000)], 'existing');
t('/nrr existing: gp=80 (ไม่ใช่ 200)', exOnly.gp === 80);
t('/nrr existing: gmv=400 (ไม่ใช่ 1000)', exOnly.gmv === 400,
  'ถ้าเป็น 1000 = ตัวส่วนผิดฐาน %GP จะต่ำกว่าจริง');
t('/nrr existing: %GP = 20 (ไม่ใช่ 8)', exOnly.gpPct === 20,
  '8% คือค่าที่จะได้ถ้าหารด้วย totalGmv ผิดฐาน');
t('/nrr existing basis ที่ existingGmv=0 → null (ไม่หารศูนย์)',
  nrrGpFromCells([cell(0, 1000, 0, 200, 1000)], 'existing') === null);
// Sense: ตัวส่วนคือ GMV ของไฟล์เดียวกับ GP เสมอ
const senseRatio = senseGpFromSkuRows([skuRow(800, 120, 800)]);
t('Sense: %GP = margin/gmv จากไฟล์เดียวกัน = 15', senseRatio.gpPct === 15);
t('Sense: คืน gmv ที่ใช้เป็นตัวส่วนมาด้วย (ให้ UI อ้างอิงได้)', senseRatio.gmv === 800);

// ═══════════════════════════════════════════════════════════════════════════
section('ผลรวมต้องบวกกันได้ (additivity) — ไม่มีการ dedup ซ่อนอยู่');
const partsA = senseGpFromSkuRows([skuRow(1000, 150, 1000)]);
const partsB = senseGpFromSkuRows([skuRow(3000, 300, 3000)]);
const whole = senseGpFromSkuRows([skuRow(1000, 150, 1000), skuRow(3000, 300, 3000)]);
t('Sense: GP ของส่วนย่อยรวมกัน = GP ของทั้งก้อน',
  Math.abs((partsA.gp + partsB.gp) - whole.gp) < 1e-9);
t('Sense: GMV ของส่วนย่อยรวมกัน = GMV ของทั้งก้อน',
  Math.abs((partsA.gmv + partsB.gmv) - whole.gmv) < 1e-9);
t('Sense: %GP ของทั้งก้อนเป็นค่าถ่วงน้ำหนัก ไม่ใช่ค่าเฉลี่ยธรรมดา',
  Math.abs(whole.gpPct - (450 / 4000 * 100)) < 1e-9 &&
  Math.abs(whole.gpPct - (partsA.gpPct + partsB.gpPct) / 2) > 1e-6);

// ═══════════════════════════════════════════════════════════════════════════
section('/nrr: ตัวเดินเก็บ cell (nrrGpCellsForMonth)');
const bundle = {
  data: {
    A: {
      o1: {
        Beef: { 'ก.ค. 2569': cell(0, 1000, 0, 200, 1000), 'มิ.ย. 2569': cell(0, 800, 0, 160, 800) },
        Pork: { 'ก.ค. 2569': cell(0, 500, 0, 50, 500) }
      },
      o2: { Beef: { 'ก.ค. 2569': cell(0, 300, 0, 60, 300) } }
    }
  },
  groupCategory: { Beef: 'Meat', Pork: 'Meat' }
};
t('เก็บครบทุก outlet/group ของเดือนนั้น (3 cell)',
  nrrGpCellsForMonth(bundle, 'ก.ค. 2569').length === 3);
t('เดือนอื่นได้แค่ cell ของเดือนนั้น (1 cell)',
  nrrGpCellsForMonth(bundle, 'มิ.ย. 2569').length === 1);
t('เดือนที่ไม่มีเลย → 0 cell', nrrGpCellsForMonth(bundle, 'ธ.ค. 2599').length === 0);
t('กรองด้วย groupKey', nrrGpCellsForMonth(bundle, 'ก.ค. 2569', { groupKey: 'Beef' }).length === 2);
t('กรองด้วย category', nrrGpCellsForMonth(bundle, 'ก.ค. 2569', { category: 'Meat' }).length === 3);
t('กรอง category ที่ไม่มี → 0', nrrGpCellsForMonth(bundle, 'ก.ค. 2569', { category: 'Fruit' }).length === 0);
t('bundle ว่าง → []', nrrGpCellsForMonth({}, 'ก.ค. 2569').length === 0);
t('bundle null → []', nrrGpCellsForMonth(null, 'ก.ค. 2569').length === 0);
t('ไม่ส่ง monthLabel → []', nrrGpCellsForMonth(bundle, null).length === 0);

const j = nrrGpFor(bundle, 'ก.ค. 2569');
t('nrrGpFor รวม 3 cell: gp=310 gmv=1800',
  j.gp === 310 && j.gmv === 1800, 'gp=' + j.gp + ' gmv=' + j.gmv);
const allPairs = nrrGpForAll([{ bundle: bundle }, { bundle: bundle }], 'ก.ค. 2569');
t('nrrGpForAll ข้าม 2 บันเดิล → gp เป็น 2 เท่า', allPairs.gp === 620);
t('nrrGpForAll ข้าม bundle ที่เป็น null ได้โดยไม่ล้ม',
  nrrGpForAll([{ bundle: null }, { bundle: bundle }], 'ก.ค. 2569').gp === 310);
t('nrrGpForAll กรอง category ได้',
  nrrGpForAll([{ bundle: bundle }], 'ก.ค. 2569', { category: 'Meat' }).gp === 310);

// ═══════════════════════════════════════════════════════════════════════════
section('ไม่มี NaN / Infinity รอดออกไปถึงจอ');
const weird = [
  senseGpFromSkuRows([skuRow(100, undefined, 100)]),
  senseGpFromSkuRows([skuRow(100, null, 100)]),
  senseGpFromSkuRows([{ gmv: 100, gmv_with_margin: 100 }]),   // ไม่มี key margin เลย
  nrrGpFromCells([{ totalGmv: 100, gmvWithMargin: 100 }]),      // ไม่มี key margin เลย
  nrrGpFromCells([cell(0, 100, 0, undefined, 100)])
];
weird.forEach(function (r, i) {
  if (r === null) { t('เคสข้อมูลเพี้ยน #' + (i + 1) + ' → null (ปลอดภัย)', true); return; }
  const finite = ['gp', 'gmv', 'gpPct', 'coverage'].every(function (k) {
    return r[k] == null || Number.isFinite(r[k]);
  });
  t('เคสข้อมูลเพี้ยน #' + (i + 1) + ' → ทุกตัวเลข finite ไม่มี NaN', finite, JSON.stringify(r));
});

// ═══════════════════════════════════════════════════════════════════════════
section('GP ห้ามแตะตัวเลขคอมมิชชั่น (แค่ยืนยันว่าไม่มีคำว่า margin ในสูตรจ่ายเงิน)');
// GP เป็นเลนส์แสดงผล ไม่ใช่ input ของสูตร — ถ้าวันหนึ่งมีคนเอา margin ไปคูณ
// rate ตรงๆ เทสต์นี้จะจับได้ก่อนที่เงินจริงจะเพี้ยน
const commSrc = fs.readFileSync(path.join(ROOT, 'src/nrr/nrr_commission.js'), 'utf8');
const payoutLines = commSrc.split('\n').filter(function (l) {
  return /\*\s*rate|rate\s*\*|applied_rate\s*\*|\*\s*applied_rate/.test(l) &&
         /margin|\.gp\b/i.test(l);
});
t('ไม่มีบรรทัดไหนเอา margin/gp ไปคูณกับ rate', payoutLines.length === 0,
  payoutLines.join(' | '));

const engineSrc = fs.readFileSync(path.join(ROOT, 'src/07a_commission_engine.js'), 'utf8');
t('เอนจินคอมมิชชั่นฝั่ง Sense ไม่รู้จัก margin เลย',
  !/margin_ex_vat|\.margin\b/.test(engineSrc));

// ═══════════════════════════════════════════════════════════════════════════
section('SQL: คอลัมน์ GP ต้องต่อท้าย และห้ามมีตัวกรอง margin > 0');
const sql1 = fs.readFileSync(path.join(ROOT, 'sql/SQL1_sense_skus.sql'), 'utf8');
const q3c = fs.readFileSync(path.join(ROOT, 'sql/q3c_upsell_bulk_all_kams_v4.sql'), 'utf8');
// ต้องตัดคอมเมนต์ออกก่อนตรวจ — ทั้งสองไฟล์มีคอมเมนต์เตือนว่า "ห้ามใส่
// margin_ex_vat > 0" ซึ่งถ้าไม่ตัดออก จะถูกจับว่าเป็นตัวกรองจริง (เคยพลาดจริง)
const stripSqlComments = (s) => s.split('\n')
  .map(function (l) { const i = l.indexOf('--'); return i < 0 ? l : l.slice(0, i); })
  .join('\n');
const sql1Code = stripSqlComments(sql1);
const q3cCode = stripSqlComments(q3c);
t('SQL1 มี margin_ex_vat (ในโค้ด ไม่ใช่แค่คอมเมนต์)', /margin_ex_vat/.test(sql1Code));
t('SQL1 มี gmv_with_margin (ตัววัด coverage)', /gmv_with_margin/.test(sql1Code));
t('SQL1 ไม่มีตัวกรอง margin > 0 (margin ติดลบต้องรอด)',
  !/margin_ex_vat\s*>\s*0/.test(sql1Code));
t('q3c มี existing_margin + total_margin (แยกฐานเหมือน GMV)',
  /existing_margin/.test(q3cCode) && /total_margin/.test(q3cCode));
t('q3c ไม่มีตัวกรอง margin > 0', !/margin_ex_vat\s*>\s*0/.test(q3cCode));
// ตัวกรอง gmv_ex_vat > 0 ใน q3c เป็นของเดิม ต้องอยู่ครบ 2 จุด — ถ้าใครลบออก
// total_gmv จะเปลี่ยน แล้วคอมมิชชั่นจริงจะขยับ
t('q3c ยังมีตัวกรอง gmv_ex_vat > 0 เดิมครบ 2 จุด (ห้ามลบ ไม่งั้นคอมมิชชั่นขยับ)',
  (q3cCode.match(/i\.gmv_ex_vat\s*>\s*0/g) || []).length === 2);
// ตำแหน่งคอลัมน์: margin ต้องอยู่ท้ายสุด ไม่แทรกกลาง (parser เป็น positional)
const sql1Tail = sql1.slice(sql1.lastIndexOf('FROM agg a') - 400, sql1.lastIndexOf('FROM agg a'));
t('SQL1: margin_ex_vat อยู่หลัง last_order_date (ต่อท้าย ไม่แทรกกลาง)',
  sql1Tail.indexOf('last_order_date') < sql1Tail.lastIndexOf('margin_ex_vat'));
t('q3c: คอลัมน์ margin อยู่หลัง category (ต่อท้าย)',
  q3c.lastIndexOf('category,') < q3c.lastIndexOf('existing_margin'));

// ═══════════════════════════════════════════════════════════════════════════
section('parser: ตำแหน่งคอลัมน์ตรงกับที่ SQL ส่งมา');
const pipeSrc = fs.readFileSync(path.join(ROOT, 'src/02_data_pipeline.js'), 'utf8');
t('Sense parser อ่าน margin ที่ p[18+off] (คอลัมน์ที่ 20 = ต่อท้าย last_order_date ที่ 17+off)',
  /parseFloat\(p\[18\+off\]\)/.test(pipeSrc));
t('Sense parser อ่าน gmv_with_margin ที่ p[19+off]',
  /parseFloat\(p\[19\+off\]\)/.test(pipeSrc));
const nrrDataSrc = dataSrc;
t('/nrr parser อ่าน existing_margin ที่ p[7] (ต่อจาก category ที่ p[6])',
  /existingMargin\s*=\s*parseFloat\(p\[7\]\)/.test(nrrDataSrc));
t('/nrr parser อ่าน total_margin ที่ p[8]',
  /totalMargin\s*=\s*parseFloat\(p\[8\]\)/.test(nrrDataSrc));
t('/nrr parser อ่าน gmv_with_margin ที่ p[9]',
  /gmvWithMargin\s*=\s*parseFloat\(p\[9\]\)/.test(nrrDataSrc));

// ═══════════════════════════════════════════════════════════════════════════
section('GP ห้ามหลุดหน้ารายงานที่แชร์ให้ลูกค้า');
const kamSrc = fs.readFileSync(path.join(ROOT, 'src/05_kam_view.js'), 'utf8');
const rndSrc = fs.readFileSync(path.join(ROOT, 'src/03_rendering.js'), 'utf8');
t('ทุกจุดที่แสดง GP ใน Sense ติด data-gp',
  (kamSrc.match(/data-gp="1"/g) || []).length >= 2);
t('_doShareReport ตัด [data-gp] ออกจาก clone ก่อนแคปภาพ',
  /querySelectorAll\('\[data-gp\]'\)/.test(kamSrc));
t('renderReport มีตัวตรวจจับ GP หลุด (_reportAssertNoGp)',
  /_reportAssertNoGp/.test(rndSrc) &&
  (rndSrc.match(/_reportAssertNoGp\(\)/g) || []).length >= 2);
t('ตัวตรวจจับลบ element ที่หลุด ไม่ใช่แค่ console.warn',
  /_reportAssertNoGp[\s\S]{0,900}removeChild/.test(rndSrc));

// ═══════════════════════════════════════════════════════════════════════════
section('%GP ห้ามใช้สี ramp สถานะ (ผ่าน/ไม่ผ่านเกณฑ์)');
const viewSrc = fs.readFileSync(path.join(ROOT, 'src/nrr/nrr_view.js'), 'utf8');
// ดึงเฉพาะฟังก์ชันที่วาด GP ออกมาตรวจ ไม่ใช่ทั้งไฟล์
const gpFns = ['_nrrCommLensMoneyCell', '_nrrMarginQuadrantHtml', '_nrrRenderMarginBody'];
gpFns.forEach(function (fn) {
  const i = viewSrc.indexOf('function ' + fn);
  if (i < 0) { t(fn + ' มีอยู่จริง', false); return; }
  // หาขอบเขตหยาบๆ ถึง function ถัดไป
  const next = viewSrc.indexOf('\nfunction ', i + 10);
  const bodyTxt = viewSrc.slice(i, next < 0 ? viewSrc.length : next);
  t(fn + ' ไม่ใช้ nrrThresholdColorVar (สี "ผ่านเกณฑ์")',
    !/nrrThresholdColorVar/.test(bodyTxt));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(64));
console.log(pass + ' pass · ' + fail + ' fail');
if (fail) {
  console.log('\nที่พัง:');
  failures.forEach(function (f) { console.log('  · ' + f); });
  process.exit(1);
}
console.log('ผ่านทั้งหมด');
