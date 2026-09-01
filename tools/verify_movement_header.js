#!/usr/bin/env node
// ── แถบเลือกมุมมองของ Outlet Movement ต้องอยู่ที่เดิมเสมอ ──────────────────
// บุชเจอ 31 ส.ค.: พอเลือกแท็บ KAM แถบแท็บตกลงไปอีกบรรทัดทุกครั้ง เพราะตัวเลือก
// ย่อยของ KAM (select ยาว) อยู่แถวเดียวกับแท็บ · แท็บอื่นตัวเลือกย่อยสั้นเลยไม่ตก
// ⇒ ล็อกไว้ว่าแท็บกับตัวเลือกย่อยต้องอยู่คนละแถวถาวร
const fs = require('fs');
const path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const VIEW = R('src/nrr/nrr_view.js');
const CSS  = R('src/nrr/nrr_components.css');
const AGG  = R('src/nrr/nrr_aggregate.js');

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
};

console.log('\n── แถวแท็บอยู่ที่เดิมเสมอ ──');
check('ตัวเลือกย่อยออกมาอยู่นอกกล่องแท็บแล้ว',
  /<div class="nrr-mv-sub" id="nrr-mv-secondary">/.test(VIEW));
check('กล่องแท็บไม่มีตัวเลือกย่อยปนอยู่ข้างในอีก',
  !/nrr-mv-switch[\s\S]{0,200}id="nrr-mv-secondary"/.test(VIEW));
check('แถวหัวห้ามตกบรรทัด', /\.nrr-mv-head \{ flex-wrap: nowrap;/.test(CSS));
check('ชื่อยาวหดได้ ไม่ดันแท็บลงไป', /\.nrr-mv-head \.h2 \{ flex: 1 1 auto; min-width: 0; \}/.test(CSS));
check('กล่องแท็บไม่ยืดไม่หด', /\.nrr-mv-switch \{[^}]*flex: 0 0 auto/.test(CSS));
check('แถวย่อยว่างแล้วยุบ ไม่กินที่', /\.nrr-mv-sub:empty \{ display: none; \}/.test(CSS));
check('ตัวเลือกทุกแบบสูงเท่ากัน (ป้ายไทยกับอังกฤษไม่ทำให้แถวขยับ)',
  /\.nrr-mv-sub \.seg \{ height: 40px/.test(CSS) && /\.nrr-pick select \{[\s\S]{0,220}height: 40px/.test(CSS));
check('จอแคบยอมให้ตกบรรทัดได้', /@media \(max-width: 720px\)[\s\S]{0,160}\.nrr-mv-head \{ flex-wrap: wrap; \}/.test(CSS));

console.log('\n── ตัวเลือกของ KAM ใช้ดีไซน์ชุดเดียวกับที่อื่น ──');
check('ห่อด้วย .nrr-pick ไม่ใช่ .nrr-search แบบเดิม',
  /class="nrr-pick"><select id="nrr-mv-kam-select"/.test(VIEW) &&
  !/select class="nrr-search" id="nrr-mv-kam-select"/.test(VIEW));
check('มุมกลมแบบเดียวกับ .seg', /\.nrr-pick select \{[\s\S]{0,200}border-radius: 999px/.test(CSS));
check('ขอบและตัวอักษรชุดเดียวกับ .seg',
  /\.nrr-pick select \{[\s\S]{0,260}border: 1px solid var\(--line\)/.test(CSS) &&
  /\.nrr-pick select \{[\s\S]{0,300}font-family: var\(--font-ui\)/.test(CSS));
check('ถอดลูกศรของเบราว์เซอร์แล้ววาดเอง',
  /appearance: none/.test(CSS) && /\.nrr-pick::after/.test(CSS));
check('โฟกัสด้วยคีย์บอร์ดยังเห็น', /\.nrr-pick select:focus-visible/.test(CSS));

console.log('\n── ภาพรวมเลือก Chain / SA/MC ได้ ──');
check('มีปุ่มสามตัว รวม "ทั้งหมด"',
  /data-vpbucket="all"/.test(VIEW) && /data-vpbucket="chain"/.test(VIEW) && /data-vpbucket="sa_mc"/.test(VIEW));
check('ค่าตั้งต้นเป็น "ทั้งหมด" — ไม่งั้นร้านที่ไม่ใช่ทั้งสองกลุ่มจะหายเงียบ',
  /vpBucket: 'all'/.test(VIEW) && /mv\.vpBucket \|\| 'all'/.test(VIEW));
check('ส่งกลุ่มที่เลือกเข้าไปคิดจริง', /nrrVpResult\(vb\)/.test(VIEW));
check('หัวเรื่องบอกกลุ่มที่เลือก', /vb === 'all' \? '' : ' · '/.test(VIEW));
check('ตัวคิดผลรับพารามิเตอร์กลุ่ม', /function nrrVpResult\(bucket\)/.test(AGG));
check('ไม่ส่งกลุ่ม = ผลเหมือนเดิมทุกประการ',
  /if \(!bucket \|\| bucket === 'all'\) return _nrrActualizeResult\(nrrComputeRowsPool\(vd\.allRows, 'vp'\)\);/.test(AGG));
check('ใช้ตัวแบ่งกลุ่มตัวเดียวกับ PM/Admin ไม่เขียนใหม่',
  /return _nrrActualizeResult\(nrrComputeBucket\(vd\.allRows, bucket\)\);/.test(AGG));
check('ที่เรียกแบบไม่ส่งพารามิเตอร์ยังมีอยู่และยังถูก',
  /heroResult = nrrVpResult\(\);/.test(VIEW));

console.log('\n' + (fail === 0 ? `✅ ผ่านทั้งหมด ${pass} ข้อ` : `❌ ตก ${fail} ข้อ (ผ่าน ${pass})`));
process.exit(fail === 0 ? 0 : 1);
