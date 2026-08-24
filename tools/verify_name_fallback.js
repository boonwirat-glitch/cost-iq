// verify_name_fallback — ชื่อร้านบนแดชบอร์ดต้องไม่ว่าง และต้องไม่เป็น UUID
//
// ที่มา (2026-08-24): บุชเจอแถวเดือน ส.ค. โชว์ชื่อร้านเป็นช่องว่างบ้าง เป็น UUID บ้าง
// ต้นเหตุจริงอยู่ที่ข้อมูล — SQL ดึงชื่อจาก order.cdp_account_name ของออเดอร์ล่าสุด
// ในเดือนนั้น ถ้า CDP ยังเติมไม่ทันก็ว่างทั้งแถว (วัดจาก R2: vp_view 2,288/12,961
// = 17.7% ทุกแถวเป็นเดือนปัจจุบัน) · แต่โค้ดทำให้แย่ลง 2 แบบต่างกัน คือบางทาง
// fallback ไปเป็น id (โชว์ UUID) บางทางไม่มี fallback เลย (โชว์ว่าง)
//
// ไฟล์นี้ตรึงทั้ง 3 ชั้น: SQL แก้ที่ต้นเหตุ · แอปเติมชื่อย้อนจากเดือนอื่น · ชั้นแสดงผล
// ไม่ยอมโชว์ id เป็นชื่อเด็ดขาด
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fail = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ' — ' + detail}`);
  if (!ok) fail++;
}

console.log('\n── 1. SQL: ให้ user_master เป็นแหล่งชื่อหลัก ──');
for (const v of ['vp', 'admin', 'pm', 'rep']) {
  const f = read(`sql/q3_2026_movement_${v}_view.sql`);
  check(`${v}_view: CTE ดึงชื่อจาก user_master มาด้วย`,
    /account_name AS um_account_name/.test(f) && /res_name\s+AS um_res_name/.test(f));
  check(`${v}_view: SELECT ใช้ user_master ก่อน cdp (ลำดับสำคัญ — กลับด้านคือไม่ได้แก้อะไร)`,
    (() => {
      const m = f.match(/COALESCE\(NULLIF\(TRIM\(um\.um_account_name\), ''\), NULLIF\(TRIM\(r\.account_name\), ''\)\) AS account_name/);
      return !!m;
    })());
  check(`${v}_view: กัน '' ที่ cdp เขียนมาเป็นสตริงว่าง ไม่ใช่ NULL`,
    /NULLIF\(TRIM\(um\.um_res_name\),\s*''\)/.test(f));
}

console.log('\n── 2. แอป: เติมชื่อที่หายจากเดือนอื่นในไฟล์เดียวกัน ──');
const data = read('src/nrr/nrr_data.js');
check('มีตัวเติมชื่อ nrrBackfillMissingNames', /function nrrBackfillMissingNames\(rows\)/.test(data));
check('เรียกใช้ในตัว parse ของ portfolio view (admin/vp/pm)',
  /return nrrBackfillMissingNames\(allRows\);/.test(data));
check('เรียกใช้ในตัว parse ของ kam_rep_view ด้วย (ไม่ใช่แค่ไฟล์เดียว)',
  (() => {
    const i = data.indexOf('function _nrrParseQnrrCsv');
    const j = data.indexOf('function _nrrParsePortfolioCsv');
    const seg = data.slice(i, j > i ? j : data.length);
    return /nrrBackfillMissingNames\(allRows\);/.test(seg);
  })());
check('เติมเฉพาะช่องที่ว่าง ไม่ทับชื่อที่มีอยู่แล้ว',
  /if \(!r\.account_name\)/.test(data) && /if \(!r\.res_name &&/.test(data));
check('ยืมตาม outlet_id ก่อน แล้วค่อย account_id (ตรงตัวกว่า)',
  (() => {
    const i = data.indexOf('var a = outletAcct[r.outlet_id] || acctName[r.account_id];');
    return i > -1;
  })());
check('ติดธง name_backfilled ไว้ ตรวจย้อนได้ว่าแถวไหนถูกเติม',
  /r\.name_backfilled = true/.test(data));

console.log('\n── 3. ชั้นแสดงผล: ห้ามโชว์ id เป็นชื่อ ห้ามปล่อยว่าง ──');
const logic = read('src/nrr/nrr_logic.js');
check('มี nrrDisplayName', /function nrrDisplayName\(\)/.test(logic));
check('กรอง UUID ทิ้ง ไม่เอามาเป็นชื่อ',
  /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/i.test(logic));
check('ไม่มีชื่อ = บอกตรงๆ ไม่ใช่ปล่อยว่าง', /NRR_NO_NAME = '\(ไม่มีชื่อในข้อมูล\)'/.test(logic));

// รันจริง — ตรรกะ ไม่ใช่แค่ regex
(() => {
  const src = logic.slice(logic.indexOf("var NRR_NO_NAME"));
  const vm = require('vm');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.dn = nrrDisplayName;', ctx);
  const U = 'a10e0c89-b322-4d56-b96f-eaddb9226440';
  check('รันจริง: ชื่อจริงชนะ', ctx.dn('', 'ร้านลุงหนวด') === 'ร้านลุงหนวด');
  check('รันจริง: res_name มาก่อน account_name', ctx.dn('สาขาสีลม', 'บริษัทแม่') === 'สาขาสีลม');
  check('รันจริง: UUID ไม่ถูกใช้เป็นชื่อ', ctx.dn(U) === '(ไม่มีชื่อในข้อมูล)');
  check('รันจริง: UUID ถูกข้าม ไปใช้ชื่อถัดไปแทน', ctx.dn(U, 'ร้านจริง') === 'ร้านจริง');
  check('รันจริง: ช่องว่างล้วนนับว่าไม่มีชื่อ', ctx.dn('   ', '') === '(ไม่มีชื่อในข้อมูล)');
})();

console.log('\n── 4. ไม่เหลือทางที่เอา id มาโชว์แทนชื่อ ──');
const agg = read('src/nrr/nrr_aggregate.js');
check('หัวกลุ่ม account ไม่ fallback เป็น key (=account_id) อีก',
  !/account_name: o\.row\.account_name \|\| key/.test(agg));
const comp = read('src/nrr/nrr_components.js');
check('แถวร้าน/สาขา ใช้ nrrDisplayName ไม่ใช่ res_name || account_name เปล่าๆ',
  /nrrDisplayName\(r\.res_name, r\.account_name\)/.test(comp) &&
  !/nrrEsc\(r\.res_name \|\| r\.account_name\)/.test(comp));
// กวาดทุกไฟล์: ห้ามมี pattern "ชื่อ || id" หลงเหลือในทางแสดงผล
(() => {
  const files = fs.readdirSync(path.join(ROOT, 'src/nrr')).filter(f => f.endsWith('.js'));
  const bad = [];
  const pat = /(?:account_name|res_name)\s*\|\|\s*[a-z]+\.(?:account_id|outlet_id)/g;
  files.forEach(f => {
    read('src/nrr/' + f).split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      // nrr_commission.js:nrrAccs = ป้ายไว้เทียบยอดสองฝั่ง ไม่ใช่ชื่อที่โชว์บนแดชบอร์ด
      if (f === 'nrr_commission.js' && line.includes('nrrAccs[r.account_id]')) return;
      if (pat.test(line)) bad.push(`${f}:${i + 1}`);
      pat.lastIndex = 0;
    });
  });
  check('ไม่เหลือ "ชื่อ || id" ในทางแสดงผล', bad.length === 0, bad.join(', '));
})();

console.log(`\n${fail ? '❌' : '✅'} verify_name_fallback: ผ่าน ${fail === 0 ? 'ครบ' : ''} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);
