#!/usr/bin/env node
// tools/verify_day_basis_label.js — v_daybasis (2026-08-31)
//
// บุชถามว่า "฿215.1M ของ ส.ค. คือเลข 30 วันหรือ 31 วัน" แล้วจอตอบไม่ได้
//
// ความจริงคือ **ทุกคอลัมน์ถูกปรับเป็นเต็มเดือนเสมอ**: เครื่องคำนวณเก็บทุกอย่างเป็น
// ยอดต่อวัน×30 (nrr_logic.js) แล้ว _nrrActualizeResult (nrr_aggregate.js) คูณกลับ
// ด้วย days_in_month/30 ⇒ เดือนที่ข้อมูลครบก็ได้ยอดจริง เดือนที่ยังไม่ครบจะถูกคูณขึ้น
//
// ส.ค. 2026 ของจริง: ข้อมูล 30 วัน เดือนมี 31 วัน ⇒ เลขบนจอสูงกว่ายอดที่เกิดขึ้นจริง
// 3.3% และเดิม **ไม่มีอะไรบนจอบอกเลย** เพราะเกณฑ์ลายเฉียงผ่อนให้ 2 วัน (30 < 31−2
// เป็นเท็จ) เดือนที่ขาดไป 1-2 วันจึงถูกนับว่าจบเดือนแล้ว
//
// ล็อกไว้ 2 อย่าง: เกณฑ์ต้องไม่ผ่อน · ทุกคอลัมน์เดือนต้องมีป้ายบอกว่าอิงกี่วัน

const fs = require('fs');
const path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + (d || ''))); };

console.log('\n── เกณฑ์ "เดือนนี้จบหรือยัง" ต้องไม่ผ่อนวัน ──');
['src/nrr/nrr_logic.js', 'src/07c_qnrr_view.js'].forEach(f => {
  const t = R(f);
  check(f + ' — ไม่เหลือเกณฑ์ผ่อน 2 วัน',
    !/curr_days\s*<\s*daysInMonth\s*-\s*2/.test(t),
    'ขาดวันไหนก็คือยังไม่จบเดือน · เลขบนจอถูกคูณเป็นเต็มเดือนไปแล้ว');
  check(f + ' — ใช้เกณฑ์ ข้อมูลน้อยกว่าจำนวนวันของเดือน',
    /curr_days\s*>\s*0\s*&&\s*curr_days\s*<\s*daysInMonth;/.test(t));
});

console.log('\n── ป้ายใต้ชื่อเดือนในตาราง ──');
const COMP = R('src/nrr/nrr_components.js');
const head = (COMP.match(/var theadHtml = '<tr><th>Movement<\/th>'[\s\S]*?\.join\(''\) \+ '<\/tr>';/) || [''])[0];
check('หัวตารางสร้างป้ายบอกจำนวนวัน', /nrr-daybasis/.test(head));
check('เดือนที่ข้อมูลครบ บอกว่าเป็นยอดจริง', /ยอดจริงครบ/.test(head));
check('เดือนที่ยังไม่ครบ บอกทั้งจำนวนวันและว่าเลขถูกปรับ',
  /ข้อมูล/.test(head) && /จาก/.test(head) && /เลขปรับเป็นเต็มเดือน/.test(head),
  'ต้องบอกทั้งสองอย่าง — รู้แค่ว่า "ยังไม่ครบ" ไม่พอ ต้องรู้ว่าเลขถูกบวกขึ้นแล้ว');
check('คอลัมน์ฐานก็บอกจำนวนวันของเดือนฐาน', /c\.isBase && result\.base_month/.test(head));
check('ป้ายเดือนที่ยังไม่ครบใช้สีต่างจากเดือนปกติ', /nrr-daybasis part/.test(head));
check('มีสไตล์รองรับใน CSS', /\.nrr-daybasis\b/.test(R('src/nrr/nrr_components.css')));

// รันตัวสร้างหัวตารางจริงกับตัวเลขจริงของ ก.ค./ส.ค. 2026
console.log('\n── รันจริงกับตัวเลขเดือน ก.ค./ส.ค. 2026 ──');
{
  const nrrEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nrrDaysIn = mo => { const p = (mo || '').split('-'); return p.length === 2 ? new Date(+p[0], +p[1], 0).getDate() : 30; };
  const result = {
    base_month: '2026-06',
    by_month: {
      '2026-07': { curr_days: 31, days_in_month: 31, is_partial: false },
      '2026-08': { curr_days: 30, days_in_month: 31, is_partial: true },
    }
  };
  const columns = [{ label: 'ฐาน', isBase: true }, { label: 'ก.ค.', month: '2026-07' }, { label: 'ส.ค.', month: '2026-08' }];
  let theadHtml;
  eval(head.replace('var theadHtml', 'theadHtml'));
  check('ก.ค. (ครบ 31 วัน) → "ยอดจริงครบ 31 วัน"', /ยอดจริงครบ 31 วัน/.test(theadHtml));
  check('ส.ค. (ได้ 30 จาก 31) → เตือนว่าเลขถูกปรับ', /ข้อมูล 30 จาก 31 วัน · เลขปรับเป็นเต็มเดือน/.test(theadHtml));
  check('ก.ค. ต้องไม่ติดสีเตือน', !/ก\.ค\.<span class="nrr-daybasis part"/.test(theadHtml));
}

console.log('\n' + (fail ? '❌' : '✅') + ' verify_day_basis_label: ผ่าน ' + pass + ' · ไม่ผ่าน ' + fail);
process.exit(fail ? 1 : 0);
