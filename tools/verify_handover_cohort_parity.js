#!/usr/bin/env node
// tools/verify_handover_cohort_parity.js — v_hoparity (2026-08-07)
//
// เช็คว่า "เดือนที่รับโอน" ของสองไฟล์ที่ต้องพูดตรงกัน พูดตรงกันจริงไหม:
//   kam_rep_view.csv     (ขึ้นหน้า NRR)  — movement_type='handover' + cohort_month
//   portview_handover.csv (ใช้คิดค่าคอมฯ) — transfer_month / period_month
//
// ทำไมต้องมี: บุชจับได้เอง (2026-08-07) ว่า Lake Park Cafe มี new_user_exp_date
// = 30 มิ.ย. ใน raw (หน้า NRR จัดเป็น cohort มิ.ย. ถูก) แต่ไฟล์ handover จัดไป
// ประเมินงวด มิ.ย. (transfer พ.ค.) → ค่าคอมฯ ก.ค. ของ Cream คลาดเคลื่อน
// ต้นเหตุ: Q10 อ่าน exp date จาก dim.user_master (ค่าเก่า/NULL) ส่วน rep_view
// อ่าน MAX จาก dwh.order · แก้ที่ sql/Q10_commission_handover_final.sql แล้ว
// (CTE outlet_exp_date_from_orders) — สคริปต์นี้คือตัวพิสูจน์ว่าการรันใหม่ได้ผล
//
// Usage:
//   node tools/verify_handover_cohort_parity.js <kam_rep_view.csv> <portview_handover.csv> [period]
//   (period ไม่ใส่ = เช็คทุกงวดที่มีในไฟล์ handover)
//
// ก่อน data team รัน Q10 ตัวใหม่ สคริปต์นี้ "ต้องแดง" — นั่นคือหลักฐานของบั๊ก
// หลังรันใหม่ต้องเขียว ถ้ายังแดงแปลว่าการแก้ยังไม่ครบ

const fs = require('fs');

const [repPath, hoPath, onlyPeriod] = process.argv.slice(2);
if (!repPath || !hoPath) {
  console.error('usage: node tools/verify_handover_cohort_parity.js <kam_rep_view.csv> <portview_handover.csv> [period]');
  process.exit(2);
}

function parseRow(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function loadCsv(p) {
  const raw = fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim());
  const header = parseRow(raw[0].replace(/^﻿/, ''));
  return raw.slice(1).map(l => {
    const c = parseRow(l), o = {};
    header.forEach((h, i) => o[h] = c[i]);
    return o;
  });
}
function prevMonthOf(period) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

const rep = loadCsv(repPath);
const ho = loadCsv(hoPath);

const periods = onlyPeriod ? [onlyPeriod]
  : [...new Set(ho.map(r => r.period_month).filter(Boolean))].sort();

let fail = 0, checked = 0;
console.log('── handover cohort parity: หน้า NRR vs ไฟล์คิดค่าคอมฯ ──');

periods.forEach(period => {
  const prev = prevMonthOf(period);
  // ฝั่งหน้า NRR: บัญชี handover ที่ cohort = เดือนก่อนงวด
  const nrrByKam = {};   // kamEmail -> { accId: {name, outlets:Set} }
  rep.forEach(r => {
    if (r.period_month !== period || r.movement_type !== 'handover') return;
    if (r.cohort_month !== prev) return;
    const k = r.latest_kam_email || '(ไม่มีอีเมล)';
    (nrrByKam[k] = nrrByKam[k] || {});
    const a = (nrrByKam[k][r.account_id] = nrrByKam[k][r.account_id] || { name: r.account_name, outlets: new Set() });
    a.outlets.add(r.outlet_id);
  });
  // ฝั่งไฟล์คิดเงิน: เฉพาะแถวที่ engine หยิบจริง (prev_owner=SALE + transfer_month = prev)
  const hoByKam = {};    // kamName -> { accId: {name, outlets:Set} }
  ho.forEach(r => {
    if (r.period_month !== period) return;
    if ((r.prev_owner || '').toUpperCase() !== 'SALE') return;
    if (r.transfer_month !== prev) return;
    const k = (r.new_kam_name || '').trim() || '(ไม่มีชื่อ)';
    (hoByKam[k] = hoByKam[k] || {});
    const a = (hoByKam[k][r.account_id] = hoByKam[k][r.account_id] || { name: r.account_name, outlets: new Set() });
    a.outlets.add(r.user_id);
  });
  // map อีเมล→ชื่อ (ไฟล์ handover คีย์ด้วยชื่อ ไม่ใช่อีเมล — เหมือน engine จริง)
  const nameOf = {};
  rep.forEach(r => { if (r.latest_kam_email && r.latest_staff_owner) nameOf[r.latest_kam_email] = r.latest_staff_owner; });

  const kams = [...new Set([...Object.keys(nrrByKam), ...Object.keys(hoByKam).map(n =>
    Object.keys(nameOf).find(e => nameOf[e] === n) || '(ไม่รู้จัก:' + n + ')')])];

  let periodBad = 0;
  kams.forEach(email => {
    const kamName = nameOf[email] || email.replace(/^\(ไม่รู้จัก:|\)$/g, '');
    const nrrAccs = nrrByKam[email] || {};
    const hoAccs = hoByKam[kamName] || {};
    checked++;
    const missing = Object.keys(nrrAccs).filter(a => !hoAccs[a]);
    const extra = Object.keys(hoAccs).filter(a => !nrrAccs[a]);
    // บัญชีตรงกันแต่คนละชุดสาขา
    const outletDiff = Object.keys(nrrAccs).filter(a => {
      if (!hoAccs[a]) return false;
      const A = [...nrrAccs[a].outlets].sort().join(','), B = [...hoAccs[a].outlets].sort().join(',');
      return A !== B;
    });
    if (!missing.length && !extra.length && !outletDiff.length) return;
    periodBad++; fail++;
    console.log('  FAIL  [' + period + '] ' + kamName);
    missing.forEach(a => console.log('          ขาดจากไฟล์คิดเงิน: ' + (nrrAccs[a].name || a) + ' (' + nrrAccs[a].outlets.size + ' สาขา)'));
    extra.forEach(a => console.log('          เกินมาในไฟล์คิดเงิน: ' + (hoAccs[a].name || a) + ' (' + hoAccs[a].outlets.size + ' สาขา)'));
    outletDiff.forEach(a => {
      const A = [...nrrAccs[a].outlets], B = [...hoAccs[a].outlets];
      const onlyA = A.filter(o => !hoAccs[a].outlets.has(o)), onlyB = B.filter(o => !nrrAccs[a].outlets.has(o));
      console.log('          บัญชีเดียวกันแต่คนละสาขา: ' + (nrrAccs[a].name || a) +
        ' — NRR ' + A.length + ' สาขา / ไฟล์คิดเงิน ' + B.length + ' สาขา' +
        ' · สาขาที่ไม่ตรง: มีแต่ใน NRR ' + onlyA.length + ' (' + onlyA.slice(0, 3).join(',') + ')' +
        ' มีแต่ในไฟล์คิดเงิน ' + onlyB.length + ' (' + onlyB.slice(0, 3).join(',') + ')');
    });
  });
  if (!periodBad) console.log('  PASS  [' + period + '] ตรงกันทุกคน');
});

// เช็คเพิ่ม: บัญชีเดียวถูกนับเป็น handover ซ้ำหลายงวดไหม (อาการของ PATH B เดา
// เดือนจาก last_sale_order_date รายสาขา — ปิโตรเลียมไทยโดน 4 เดือนติด)
const seen = {};
ho.forEach(r => {
  if ((r.prev_owner || '').toUpperCase() !== 'SALE') return;
  const k = r.account_id + '|' + (r.new_kam_name || '').trim();
  (seen[k] = seen[k] || new Set()).add(r.period_month);
});
const repeated = Object.keys(seen).filter(k => seen[k].size > 1);
if (repeated.length) {
  // ไม่นับเป็น FAIL: เชนที่ทยอยโอนสาขาจริงๆ ก็ขึ้นหลายงวดได้ตามกติกา — แต่ถ้าเป็น
  // อาการของ PATH B (เดาเดือนจาก last_sale_order_date รายสาขา ทั้งที่ raw มี exp
  // date เดียวทั้งบัญชี) จะจ่ายโบนัสซ้ำ · ต้องเปิดดูทีละเคสว่าโอนจริงกี่ครั้ง
  console.log('\n  ⚠ ตรวจ  บัญชีที่ขึ้นเป็น handover หลายงวด (' + repeated.length + ' บัญชี) — เชนทยอยโอนก็เป็นแบบนี้ได้ ให้ไล่ดูว่าเป็นการโอนจริงหลายรอบหรือไฟล์เดาเดือนผิด:');
  repeated.slice(0, 8).forEach(k => {
    const [acc, kam] = k.split('|');
    const nm = (ho.find(r => r.account_id === acc) || {}).account_name || acc;
    console.log('          ' + nm.slice(0, 40) + ' → ' + kam + ' : งวด ' + [...seen[k]].sort().join(', '));
  });
  if (repeated.length > 8) console.log('          ... อีก ' + (repeated.length - 8) + ' บัญชี');
} else {
  console.log('\n  PASS  ไม่มีบัญชีถูกนับ handover ซ้ำงวด');
}

console.log('\n' + (fail ? '❌' : '✅') + ' verify_handover_cohort_parity: ตรวจ ' + checked + ' (คน×งวด) · ไม่ตรง ' + fail + ' จุด');
process.exit(fail ? 1 : 0);
