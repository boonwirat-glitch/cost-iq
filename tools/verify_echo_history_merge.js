#!/usr/bin/env node
// tools/verify_echo_history_merge.js — v_echor2 (2026-08-08)
//
// ล็อกผลของการรวมหน้าจอ "ผลการ visit" เข้ากับแท็บ "ประวัติ"
//
// ทำไมต้องมี: บุชเจอว่า warissara ขึ้น 16 เช็คอินในหน้าหนึ่งแต่ไม่ตรงกับอีกหน้า
// ต้นเหตุคือมีสอง query + dedupe คนละชุด (ประวัติ dedupe ฝั่ง client, dashboard
// ไม่ dedupe) · หลังรวมแล้วบล็อกสรุปต้องคิดจาก "data" (หลัง dedupe) ชุดเดียวกับ
// รายการที่แสดงข้างล่างเสมอ — ถ้าใครเผลอเปลี่ยนไปคิดจาก _rawData เมื่อไหร่ แดงทันที
//
// Usage: node tools/verify_echo_history_merge.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', '09_conv_intel.js');
const src = fs.readFileSync(SRC, 'utf8');

let fail = 0, pass = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}

console.log('── echo: รวม "ผลการ visit" เข้าแท็บประวัติ ──');

// ── 1. หน้าจอเก่าต้องไม่เหลือซาก ────────────────────────────────────────────
check('ลบ sheet "ผลการ visit" แล้ว', !/function _openVisitDashboard/.test(src));
check('ลบ sheet ประวัติเก่า (kam_skill_log) แล้ว', !/function _openHistory/.test(src));
check('ไม่มี export ที่ชี้ไปหน้าที่ลบแล้ว',
  !/_openVisitDashboard|_closeVisitDashboard|_vdSetPeriod|_openHistory|_closeHistory/.test(src));
check('ไม่เหลือ onclick ที่เรียกฟังก์ชันที่ลบแล้ว',
  !/CI\._openVisitDashboard|CI\._openHistory|CI\._closeHistory|CI\._vdSetPeriod/.test(src));

// ── 2. chips ช่วงเวลาต้องขึ้นทุก role ────────────────────────────────────────
const barBlock = (src.match(/ci-hist-filter-bar[\s\S]{0,900}/) || [''])[0];
check('แถบ chips ไม่ถูกกันด้วย !isTL อีกแล้ว', !/!isTL/.test(barBlock),
  'TL เคยไม่มีตัวกรองช่วงเวลาเลย จึงต้องมีหน้าแยก');
check('chips สร้างจาก HIST_PERIODS ชุดเดียว', /HIST_PERIODS\.map/.test(barBlock));

// ── 3. สรุปต้องคิดจากชุดเดียวกับรายการ (หัวใจของบั๊กเดิม) ────────────────────
check('บล็อกสรุปรับ data หลัง dedupe ไม่ใช่ _rawData',
  /_histSummaryHtml\(data,/.test(src) && !/_histSummaryHtml\(_rawData/.test(src));
// ทั้งแท็บต้องยิง ci_sessions ครั้งเดียว (เดิมหน้า dashboard ยิงอีกรอบด้วย query
// คนละแบบ) — นับเฉพาะในตัว _loadInlineHistory ไม่รวมฟีเจอร์อื่นที่ใช้ตารางเดียวกัน
const loaderSrc = (src.match(/async function _loadInlineHistory\(\) \{[\s\S]*?\n  \}\n/) || [''])[0];
const loaderFetches = (loaderSrc.match(/from\('ci_sessions'\)/g) || []).length;
check('แท็บประวัติยิง ci_sessions ครั้งเดียว', loaderFetches === 1, 'เจอ ' + loaderFetches + ' จุด');
check('ตัวกรองช่วงเวลาใช้ _histSince ไม่ใช่โค้ดคำนวณวันที่ซ้ำ',
  /_histSince\(_histFilterMode\)/.test(loaderSrc) && !/getDay\(\) === 0 \? 6/.test(loaderSrc));

// ── 4. ตรวจเลขจริงของ _histSummaryHtml ด้วยการรันโค้ดจากไฟล์ ────────────────
const fnSrc = (src.match(/function _histSummaryHtml\(sessions, cvSet\) \{[\s\S]*?\n  \}\n/) || [])[0];
check('ดึงตัว _histSummaryHtml ออกมารันได้', !!fnSrc);

if (fnSrc) {
  const ctx = { _echoRep: e => ({ 'a@x.co': 'Pop', 'b@x.co': 'May' }[e] || e), console };
  vm.createContext(ctx);
  vm.runInContext(fnSrc + '\nthis.__fn = _histSummaryHtml;', ctx);

  // 5 session: 3 ของ Pop (1 เช็คอินเปล่า, 2 มีเสียง ซึ่ง 1 ยืนยัน co-visit ผ่าน
  // flag และอีก 1 ยืนยันผ่าน covisit_events) · 2 ของ May (เปล่าทั้งคู่)
  const sessions = [
    { id: 's1', owner_email: 'a@x.co', pipeline_stage: 'checked_in', covisit_verified: false },
    { id: 's2', owner_email: 'a@x.co', pipeline_stage: 'analyzed',   covisit_verified: true  },
    { id: 's3', owner_email: 'a@x.co', pipeline_stage: 'analyzed',   covisit_verified: false },
    { id: 's4', owner_email: 'b@x.co', pipeline_stage: 'checked_in', covisit_verified: false },
    { id: 's5', owner_email: 'b@x.co', pipeline_stage: 'checked_in', covisit_verified: false },
  ];
  const html = ctx.__fn(sessions, new Set(['s3']));
  const nums = (html.match(/class="vd-card-num">(\d+)</g) || []).map(m => +m.match(/>(\d+)</)[1]);

  check('การ์ดบน: เช็คอินทั้งหมด = 5', nums[0] === 5, 'ได้ ' + nums[0]);
  check('การ์ดบน: มีเสียง = 2 (นับด้วย pipeline_stage)', nums[1] === 2, 'ได้ ' + nums[1]);
  check('การ์ดบน: co-visit = 2 (flag + covisit_events)', nums[2] === 2, 'ได้ ' + nums[2]);

  const popRow = (html.match(/Pop<\/span>\s*<span class="vd-rep-num">(\d+)<\/span>\s*<span class="vd-rep-num">(\d+)<\/span>\s*<span class="vd-rep-num">(\d+)</) || []);
  check('แถวรายคน Pop = 3 / 2 / 2', popRow[1] === '3' && popRow[2] === '2' && popRow[3] === '2',
    'ได้ ' + popRow.slice(1, 4).join(' / '));
  check('เรียงรายคนจากมากไปน้อย (Pop ก่อน May)', html.indexOf('Pop') < html.indexOf('May'));
  check('ใช้ชื่อเล่นไม่ใช่อีเมล', !/a@x\.co/.test(html));

  // ผลรวมรายคนต้องเท่ากับการ์ดบนเสมอ — นี่คือเงื่อนไขที่สองหน้าจอเดิมทำไม่ได้
  const repTotals = [...html.matchAll(/<span class="vd-rep-name">[^<]+<\/span>\s*<span class="vd-rep-num">(\d+)</g)]
    .map(m => +m[1]).reduce((a, b) => a + b, 0);
  check('ผลรวมรายคน = ตัวเลขการ์ดบน', repTotals === nums[0], repTotals + ' vs ' + nums[0]);
}

// ── 5. ช่วงเวลา ─────────────────────────────────────────────────────────────
const sinceSrc = (src.match(/function _histSince\(period\) \{[\s\S]*?\n  \}\n/) || [])[0];
check('ดึงตัว _histSince ออกมารันได้', !!sinceSrc);
if (sinceSrc) {
  const ctx2 = {}; vm.createContext(ctx2);
  vm.runInContext(sinceSrc + '\nthis.__s = _histSince;', ctx2);
  const s = ctx2.__s;
  check('"ทั้งหมด" = ไม่กรองวันที่ (คืน null)', s('all') === null);
  check('"วันนี้" = เที่ยงคืนวันนี้', s('today').getHours() === 0 && s('today').toDateString() === new Date().toDateString());
  check('"เดือนนี้" = วันที่ 1', s('month').getDate() === 1);
  check('"ไตรมาสนี้" = เดือนแรกของไตรมาส (รอบเดียวกับค่าคอมฯ)',
    s('quarter').getMonth() % 3 === 0 && s('quarter').getDate() === 1);
  check('"สัปดาห์นี้" เริ่มวันจันทร์', s('week').getDay() === 1 || s('week').toDateString() === s('today').toDateString());
}

console.log('\n' + (fail ? '❌' : '✅') + ' verify_echo_history_merge: ผ่าน ' + pass + ' · ไม่ผ่าน ' + fail);
process.exit(fail ? 1 : 0);
