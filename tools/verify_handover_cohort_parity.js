#!/usr/bin/env node
// tools/verify_handover_cohort_parity.js — v_hoparity (2026-08-07)
//                                          v_hoquarter (2026-08-28)
//
// เช็คว่าไฟล์สองอันที่พูดเรื่อง "รับโอนร้านจากทีมขาย" สอดคล้องกันไหม:
//   kam_rep_view.csv      (ขึ้นหน้า NRR)   — movement_type + cohort_month
//   portview_handover.csv (ใช้คิดค่าคอมฯ)  — transfer_month / period_month
//
// ── ทำไมต้องมี (2026-08-07) ────────────────────────────────────────────────
// บุชจับได้เองว่า Lake Park Cafe มี new_user_exp_date = 30 มิ.ย. ใน raw
// (หน้า NRR จัดเป็น cohort มิ.ย. ถูก) แต่ไฟล์ handover จัดไปประเมินงวด มิ.ย.
// (transfer พ.ค.) → ค่าคอมฯ ก.ค. ของ Cream คลาดเคลื่อน · ต้นเหตุ: Q10 อ่าน exp
// date จาก dim.user_master (ค่าเก่า/NULL) ส่วน rep_view อ่าน MAX จาก dwh.order
// แก้ที่ sql/Q10_commission_handover_final.sql แล้ว (CTE outlet_exp_date_from_orders)
//
// ══ สิ่งที่สคริปต์นี้เคยเข้าใจผิด และเพิ่งแก้ 2026-08-28 ══════════════════
//
// ของเดิมเทียบ "handover ในไฟล์ NRR" กับ "handover ในไฟล์คิดเงิน" ตรงๆ โดย
// สมมติว่าสองคำนี้หมายถึงคนกลุ่มเดียวกัน — **สมมติฐานนี้จริงแค่เดือนแรกของ
// ไตรมาสเท่านั้น** เพราะสอง SQL จงใจนับคนละแบบ:
//
//   rep_view (q3_2026_movement_rep_view.sql:421-427)
//     exp_month = v_base_str (เดือนฐาน) ............ 'handover'
//     exp_month ∈ (v_m1, v_m2, v_m3) ............... 'new_sales'
//     ⇒ เดือนฐาน **แช่ทั้งไตรมาส** · คำว่า handover = "โอนเดือนฐาน" เท่านั้น
//        คนที่โอนเข้ามากลางไตรมาสไม่ได้อยู่ในฐาน NRR จึงเป็นรายได้ใหม่ = new_sales
//
//   Q10 (Q10_commission_handover_final.sql:267)
//     transfer_month = FORMAT_DATE(prev_month_start) .. **เลื่อนตามงวดทุกเดือน**
//     ⇒ งวด ก.ค. ดูคนที่โอน มิ.ย. · งวด ส.ค. ดูคนที่โอน ก.ค.
//        เพราะกติกาค่าคอมฯ คือ "รับร้านมาเดือนนี้ เดือนหน้าต้องรักษาไว้ให้ได้"
//        ซึ่งเป็นรอบรายเดือนโดยธรรมชาติ
//
// ทั้งสองอันถูกตามหน้าที่ของมัน · มันบังเอิญตรงกันเฉพาะเดือนแรกของไตรมาส
// (เพราะ "เดือนก่อนงวดแรก" = "เดือนฐาน" พอดี) พอถึงเดือนที่ 2 ก็แยกกันทันที
//
// ผลของบั๊กนี้: งวด ส.ค. 2026 สคริปต์แดง 9 จาก 9 จุด ทั้งที่ไม่มีอะไรพัง และ
// ทำให้รายงานผิดไปหนึ่งรอบว่า "สองไฟล์ขัดกัน ต้องให้ทีม data ดู" — เทสต์ที่แดง
// ตลอดเชื่อไม่ได้ ซึ่งแย่กว่าไม่มีเทสต์
//
// ตอนนี้แยกเป็นสองโหมดตามตำแหน่งของงวดในไตรมาส:
//   เดือนแรกของไตรมาส → เทียบชุดรายชื่อตรงๆ ได้ (โหมดเดิม ยังมีค่า)
//   เดือนที่ 2-3       → เทียบแบบนั้นไม่มีความหมาย เปลี่ยนไปเช็คสิ่งที่เช็คได้จริง:
//                        (ก) ไม่มี outlet ไหนถูกจ่ายเกินหนึ่งงวด
//                        (ข) outlet ที่ไฟล์เงินอ้างว่าโอนเดือนนั้น ไฟล์ NRR ต้อง
//                            จัดเป็น new_sales ของเดือนนั้น (คู่ที่ถูกต้อง)
//
// Usage:
//   node tools/verify_handover_cohort_parity.js <kam_rep_view.csv> <portview_handover.csv> [period]
//   (period ไม่ใส่ = เช็คทุกงวดที่มีในไฟล์ handover)

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
// เดือนแรกของไตรมาส = ม.ค./เม.ย./ก.ค./ต.ค. — เฉพาะงวดนี้ที่ "เดือนก่อนงวด"
// เท่ากับ "เดือนฐานของไตรมาส" ทั้งสองไฟล์จึงพูดถึงคนกลุ่มเดียวกัน
function isQuarterFirstMonth(period) {
  const m = Number(period.split('-')[1]);
  return m === 1 || m === 4 || m === 7 || m === 10;
}

const rep = loadCsv(repPath);
const ho = loadCsv(hoPath);
const hoSale = ho.filter(r => (r.prev_owner || '').toUpperCase() === 'SALE');

const periods = onlyPeriod ? [onlyPeriod]
  : [...new Set(ho.map(r => r.period_month).filter(Boolean))].sort();

let fail = 0, checked = 0;
console.log('── handover: หน้า NRR vs ไฟล์คิดค่าคอมฯ ──');

periods.forEach(period => {
  const prev = prevMonthOf(period);
  const firstOfQuarter = isQuarterFirstMonth(period);

  // ── ฝั่งไฟล์คิดเงิน: แถวที่ engine หยิบจริงสำหรับงวดนี้ ──
  const hoRows = hoSale.filter(r => r.period_month === period && r.transfer_month === prev);
  if (!hoRows.length) return;

  if (firstOfQuarter) {
    // ══ โหมด A: เดือนแรกของไตรมาส — เทียบชุดรายชื่อตรงๆ ══
    // เดือนก่อนงวด = เดือนฐาน ⇒ rep_view เรียกคนกลุ่มนี้ว่า handover เหมือนกัน
    const nrrByKam = {};
    rep.forEach(r => {
      if (r.period_month !== period || r.movement_type !== 'handover') return;
      if (r.cohort_month !== prev) return;
      const k = r.latest_kam_email || '(ไม่มีอีเมล)';
      (nrrByKam[k] = nrrByKam[k] || {});
      const a = (nrrByKam[k][r.account_id] = nrrByKam[k][r.account_id] || { name: r.account_name, outlets: new Set() });
      a.outlets.add(r.outlet_id);
    });
    const hoByKam = {};
    hoRows.forEach(r => {
      const k = (r.new_kam_name || '').trim() || '(ไม่มีชื่อ)';
      (hoByKam[k] = hoByKam[k] || {});
      const a = (hoByKam[k][r.account_id] = hoByKam[k][r.account_id] || { name: r.account_name, outlets: new Set() });
      a.outlets.add(r.user_id);
    });
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
      const outletDiff = Object.keys(nrrAccs).filter(a => {
        if (!hoAccs[a]) return false;
        const A = [...nrrAccs[a].outlets].sort().join(','), B = [...hoAccs[a].outlets].sort().join(',');
        return A !== B;
      });
      if (!missing.length && !extra.length && !outletDiff.length) return;
      periodBad++; fail++;
      console.log('  FAIL  [' + period + ' · เดือนแรกของไตรมาส] ' + kamName);
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
    if (!periodBad) console.log('  PASS  [' + period + ' · เดือนแรกของไตรมาส] ชุดรายชื่อตรงกันทุกคน (' + hoRows.length + ' สาขา)');
    return;
  }

  // ══ โหมด B: เดือนที่ 2-3 ของไตรมาส ══
  // rep_view ยังแช่ handover ไว้ที่เดือนฐาน ⇒ เทียบชุดรายชื่อไม่ได้ตามนิยาม
  // เช็คสิ่งที่ยังเช็คได้จริงแทน
  checked++;
  const repByOutlet = {};
  rep.forEach(r => { if (r.period_month === period) repByOutlet[r.outlet_id] = r; });

  // (ข) outlet ที่ไฟล์เงินอ้างว่าโอนเดือน prev — ไฟล์ NRR ต้องเรียกมันว่า
  //     new_sales ของ cohort เดือนนั้น (คู่ที่ถูกต้องตามนิยามทั้งสองฝั่ง)
  const wrongClass = [];
  let notInRep = 0;
  hoRows.forEach(r => {
    const rr = repByOutlet[r.user_id];
    if (!rr) { notInRep++; return; }   // ไม่อยู่ในไฟล์ NRR = คนละขอบเขต ไม่ใช่ความไม่ตรง
    if (rr.movement_type !== 'new_sales' || rr.cohort_month !== prev) {
      wrongClass.push({ outlet: r.user_id, name: r.account_name, got: rr.movement_type + '/' + rr.cohort_month });
    }
  });
  if (wrongClass.length) {
    fail++;
    console.log('  FAIL  [' + period + '] สาขาที่ไฟล์เงินบอกว่าโอนเดือน ' + prev +
                ' แต่ไฟล์ NRR ไม่ได้จัดเป็น new_sales/' + prev + ' — ' + wrongClass.length + ' สาขา');
    wrongClass.slice(0, 6).forEach(w =>
      console.log('          outlet ' + w.outlet + ' · ' + (w.name || '').slice(0, 38) + ' → NRR บอก ' + w.got));
  } else {
    console.log('  PASS  [' + period + ' · เดือนที่ ' + ((Number(period.split('-')[1]) - 1) % 3 + 1) + ' ของไตรมาส] ' +
                hoRows.length + ' สาขาที่จะจ่าย ตรงกับ new_sales/' + prev + ' ในไฟล์ NRR' +
                (notInRep ? ' (อีก ' + notInRep + ' สาขาไม่อยู่ในไฟล์ NRR — คนละขอบเขต)' : ''));
  }
});

// ── (ก) กันจ่ายซ้ำ: outlet เดียวต้องถูกจ่าย handover ได้งวดเดียวตลอดกาล ──
// เดิมเช็คที่ระดับ "บัญชี" ซึ่งเชนที่ทยอยโอนสาขาจะติดทุกเชน แล้วกลายเป็นเสียงรบกวน
// ที่ไม่มีใครดู · ระดับ outlet คือระดับที่จ่ายเงินจริง และซ้ำเมื่อไหร่คือผิดแน่นอน
const byOutlet = {};
hoSale.forEach(r => {
  (byOutlet[r.user_id] = byOutlet[r.user_id] || []).push({ period: r.period_month, transfer: r.transfer_month });
});
const paidTwice = Object.keys(byOutlet).filter(o => byOutlet[o].length > 1);
if (paidTwice.length) {
  fail++;
  console.log('\n  FAIL  outlet ที่ถูกนับ handover เกินหนึ่งงวด (จ่ายซ้ำ) — ' + paidTwice.length + ' สาขา');
  paidTwice.slice(0, 8).forEach(o => {
    const nm = (hoSale.find(r => r.user_id === o) || {}).account_name || o;
    console.log('          outlet ' + o + ' · ' + nm.slice(0, 36) + ' : ' +
      byOutlet[o].map(x => 'งวด ' + x.period + '(โอน ' + x.transfer + ')').join(' · '));
  });
} else {
  console.log('\n  PASS  ไม่มีสาขาไหนถูกนับ handover ซ้ำงวด (' + Object.keys(byOutlet).length + ' สาขา)');
}

// ── (ค) transfer_month ต้องเป็นเดือนก่อนงวดเสมอ — ถ้าหลุดแปลว่า Q10 เพี้ยน ──
const offCycle = hoSale.filter(r => r.transfer_month !== prevMonthOf(r.period_month));
if (offCycle.length) {
  fail++;
  console.log('  FAIL  แถวที่ transfer_month ไม่ใช่เดือนก่อนงวด — ' + offCycle.length + ' แถว');
  offCycle.slice(0, 5).forEach(r =>
    console.log('          งวด ' + r.period_month + ' แต่ transfer_month = ' + r.transfer_month + ' · ' + (r.account_name || '').slice(0, 34)));
} else {
  console.log('  PASS  ทุกแถว transfer_month = เดือนก่อนงวด ตรงตามที่ Q10 ตั้งใจ');
}

console.log('\n' + (fail ? '❌' : '✅') + ' verify_handover_cohort_parity: ตรวจ ' + checked + ' จุด · ไม่ผ่าน ' + fail);
process.exit(fail ? 1 : 0);
