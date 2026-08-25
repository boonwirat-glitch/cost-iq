// verify_slideover_export — ปุ่ม Export ในแผงรายละเอียด (v_slideexport 2026-08-25)
//
// บุชขอปุ่มไว้ "ในแผง" ไม่ใช่หัวเพจ เหตุผลคือให้ผู้ใช้เห็นขอบเขตของไฟล์ที่จะได้
// กติกาที่ต้องไม่พังคือ: **สิ่งที่ export = สิ่งที่ตาเห็นในแผงตอนนั้น**
// ถ้าวันหนึ่งมีคนเขียนตัวกรองซ้ำแยกกัน 2 ที่ ไฟล์จะเริ่มไม่ตรงกับจอแบบเงียบๆ
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fail = 0, pass = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}

const view = read('src/nrr/nrr_view.js');
const css  = read('src/nrr/nrr_components.css');
const built = read('nrr.html');

console.log('── ปุ่ม Export ในแผงรายละเอียด ──\n');

check('ปุ่มอยู่ในหัวแผง คู่กับปุ่มปิด (ไม่ใช่หัวเพจ)',
  /id="nrr-slideover-export"/.test(view) &&
  (() => {
    const h = view.indexOf('nrr-slideover-head');
    const e = view.indexOf('nrr-slideover-export', h);
    const c = view.indexOf('nrr-slideover-close', e);
    return h > -1 && e > h && c > e;
  })());

check('จอกับไฟล์ใช้ตัวกรองตัวเดียวกัน (nrrSlideoverVisibleOutlets)',
  /function nrrSlideoverVisibleOutlets\(\)/.test(view) &&
  /var visible = nrrSlideoverVisibleOutlets\(\);/.test(view));

check('ตัวกรองครบทั้ง 4 แบบที่แผงมี (movement · โมเมนตัม · KAM · คำค้น)',
  (() => {
    const i = view.indexOf('function nrrSlideoverVisibleOutlets()');
    const seg = view.slice(i, i + 900);
    return /movementFilter/.test(seg) && /momentumFilter/.test(seg) &&
           /kamFilter/.test(seg) && /st\.search/.test(seg);
  })());

check('มีคอลัมน์ที่บุชระบุครบ: account · outlet · ยอดรายเดือน · สั่งล่าสุด',
  (() => {
    const i = view.indexOf('async function nrrExportSlideover()');
    const seg = view.slice(i, i + 3600);
    return /'account_id', 'ชื่อบัญชี', 'outlet_id', 'ชื่อร้าน'/.test(seg) &&
           /mi\.months\.forEach/.test(seg) &&
           /'สั่งล่าสุด'/.test(seg);
  })());

check('ยอดรายเดือนประกอบจากทุก pool ที่โหลดไว้ (แผงเปิดได้จากหลายทาง คนละ pool)',
  /function _nrrMonthIndexForExport\(\)/.test(view) &&
  /bulkVpData', 'bulkAdminData', 'bulkPmData'/.test(view) &&
  /bulkQnrrData && window\.bulkQnrrData\.allRows/.test(view));

check('รอโหลด bulk_outlets ก่อน ไม่งั้นคอลัมน์ "สั่งล่าสุด" ว่างทั้งไฟล์แบบเงียบๆ',
  (() => {
    const i = view.indexOf('async function nrrExportSlideover()');
    const seg = view.slice(i, i + 2000);
    return /await nrrFetchBulkOutletsCsv\(\)/.test(seg);
  })());

check('ชื่อร้าน/บัญชีในไฟล์ผ่าน nrrDisplayName (ห้ามหลุด UUID หรือช่องว่างลงไฟล์)',
  (() => {
    const i = view.indexOf('async function nrrExportSlideover()');
    const seg = view.slice(i, i + 3600);
    return /nrrDisplayName\(r\.account_name\)/.test(seg) &&
           /nrrDisplayName\(r\.res_name, r\.account_name\)/.test(seg);
  })());

check('ชื่อไฟล์บอกขอบเขต (หัวข้อแผง + ตัวกรองที่เปิดอยู่)',
  (() => {
    const i = view.indexOf('async function nrrExportSlideover()');
    const seg = view.slice(i, i + 4200);
    return /nrr-slideover-title/.test(seg) && /st\.movementFilter/.test(seg) && /st\.search/.test(seg);
  })());

check('แผงว่างต้องบอกผู้ใช้ ไม่ดาวน์โหลดไฟล์เปล่า',
  /if \(!visible\.length\)/.test(view) && /ไม่มีรายการให้ export/.test(view));

check('มีสไตล์ปุ่ม .nrr-sh-export', /\.nrr-sh-export\s*\{/.test(css));

// คอมเมนต์ JS ที่แทรกกลางนิพจน์ต่อสตริง ต้องไม่หลุดเป็นข้อความบนจอ
check('คอมเมนต์ไม่หลุดเข้า markup ที่ build ออกมา',
  (() => {
    // ยึดที่ markup ฝั่ง JS ไม่ใช่กฎ CSS ที่ชื่อคลาสเดียวกัน (เจอก่อนในไฟล์)
    const i = built.indexOf('nrr-sh-title" id="nrr-slideover-title"');
    if (i < 0) return false;
    const seg = built.slice(i, i + 900);
    // คอมเมนต์ต้องขึ้นต้นบรรทัดจริงๆ = อยู่นอกสตริง = ไม่ถูก render
    const comment = /^\s*\/\/ v_slideexport/m.test(seg);
    // และคอมเมนต์ต้องไม่หลุดเข้าไปอยู่ "ในสตริง" ของ markup ปุ่ม
    // (สแกนเฉพาะบรรทัดที่เป็นสตริง markup จริง — ไฟล์นี้เป็น JS ไม่ใช่ HTML
    //  ถ้าใช้ regex แบบ HTML มันจะจับคอมเมนต์ JS ที่คั่นอยู่ว่าหลุด ซึ่งผิด)
    const markupLine = (seg.match(/^\s*'\s*<div[^\n]*nrr-slideover-export[^\n]*$/m) || [''])[0];
    return comment && markupLine.length > 0 && markupLine.indexOf('v_slideexport') === -1;
  })());

check('ปุ่มถูกผูก event แล้ว',
  /getElementById\('nrr-slideover-export'\)/.test(view) &&
  /nrrExportSlideover\(\)/.test(view));

console.log('\n' + (fail ? `❌ verify_slideover_export: ผ่าน ${pass} · ไม่ผ่าน ${fail}`
                         : `✅ verify_slideover_export: ผ่าน ${pass} · ไม่ผ่าน 0`));
process.exit(fail ? 1 : 0);
