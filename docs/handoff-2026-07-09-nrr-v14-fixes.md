# Handoff — /nrr v14: เลขเต็ม, breakdown เต็มความกว้าง, drill-down ครบ NRR/expansion/handover/P1/P3/gate, stale-CSV banner · 2026-07-09

แก้ 4 เรื่องจาก feedback รอบสอง + 1 เรื่องข้อมูลที่ผู้ใช้สงสัยเรื่อง SQL

## 1. Commission แสดงเลขเต็มแล้ว

เพิ่ม `nrrFmtGMVExact()` (nrr_core.js) — "฿50,123" ไม่ใช่ "฿50K" — ใช้แทน `nrrFmtGMV` ใน
**ทุกจุดที่เกี่ยวกับคอมมิชชั่น**: hero, trend, rows, KAM ในทีม, full table, drawer ทั้งหมด
(หน้า dashboard/movement อื่นยังใช้ K/M แบบเดิม — เป็นตัวเลข GMV ระดับล้าน ย่อแล้วอ่านง่ายกว่า)

## 2. Breakdown รายคนกางเต็มความกว้างแล้ว

ต้นเหตุ: ตอนเพิ่ม "KAM ในทีม" ใช้ class `.ds-stat-row` ซ้ำ ซึ่งมี `max-width: 420px` ที่ตั้งใจไว้
สำหรับ label:value เดี่ยวๆ — ทำให้ list ที่มีปุ่มด้วยดูอัดแน่น สร้าง class ใหม่
`.nrr-comm-kam-row` ไม่มี max-width แทน (ตรวจแล้ว: กว้างเต็ม container จริง ไม่ใช่ 420px)

## 3+4. Drill-down เต็มรูปแบบ: NRR / Expansion / Handover / Upsell P1&P3 / Gate

**พบว่าโครงมีอยู่แล้ว** (สร้างไว้ตั้งแต่ V2 — `nrrOpenCommissionDrawer` + section renderers)
แต่ใช้ได้แค่กับ snapshot ที่ล็อกแล้ว ช่องโหว่ที่แก้:

- **Hero เดือนที่ยังไม่ล็อกโชว์ ฿0** เสมอ (hardcode) — ตอนนี้ใช้ `nrrEstimateKamCommission` จริง
  (ตัวเดียวกับที่ hero/row ข้างนอกใช้ → ตัวเลขตรงกันเป๊ะ) พร้อม sub-line อธิบายสูตร
- **เพิ่มบรรทัด "NRR Gate"** แยกออกมาให้เห็นชัด (เดิมซ่อนอยู่ในข้อความ note)
- **Handover section เดิมใช้ได้แค่จาก snapshot** (`bd.handover.detail`) ซึ่งไม่มีทางมีข้อมูลถ้ายังไม่ล็อก
  → เพิ่ม `nrrFetchHandoverCsv()` (ใหม่ — org-wide `portview_handover.csv`, ~32 แถว) +
  `nrrComputeHandoverForKam()` คำนวณสด (match ด้วยชื่อ KAM + prev_owner='SALE' +
  transfer_month = เดือนก่อนงวดที่ดู) — ตรง logic เดียวกับ `_commComputeHandoverRetention`
  ใน engine จริง (07a_commission_engine.js:440) รวม tier2/tier3 bonus ด้วย
- **NRR/Expansion/Upsell P1&P3 ทำงานอยู่แล้ว** (อ่านจากข้อมูลที่โหลดในหน้าอยู่แล้ว + fetch
  per-KAM upsell CSV) — แค่ไม่เคยมีการ verify กับ estimate case มาก่อน

**ตรวจกับข้อมูลจริง (Dent, ก.ค., 112%, ยังไม่ล็อก):** hero ฿11,048 ตรงกับแถวข้างนอกเป๊ะ ·
Gate ×1 (112%>98% ไม่ถูกหัก) · section NRR 154 ร้าน · Expansion 5 ร้าน ·
**Handover 2 ร้าน** (ใหม่ — ไม่เคยแสดงมาก่อนตอนไม่มี snapshot) · Upsell P1+P3 2 กลุ่ม

ปุ่ม "ดูร้าน →" (เปลี่ยนชื่อเป็น "ดูรายละเอียด →" ให้ตรงกับเนื้อหาที่ขยายกว่าเดิม) ใช้ได้ทั้งจาก
แถว KAM บนสุด และแถว "KAM ในทีม" ที่ซ้อนอยู่ใน team row (admin view)

## 5. พบจริง: `admin_view.csv` ข้อมูลค้าง Q2 อยู่ 3 เดือน (ไม่ใช่บั๊กโค้ด — ข้อมูลไม่ได้ re-run)

ตรวจ `admin_view.csv`/`pm_view.csv`/`vp_view.csv` บน R2 ตรงๆ:

| ไฟล์ | period_month ที่พบ | สถานะ |
|---|---|---|
| `admin_view.csv` | **2026-04, 2026-05, 2026-06** | ❌ ค้าง Q2 (3 เดือนก่อนไตรมาสปัจจุบัน) |
| `pm_view.csv` | 2026-07 | ✅ ปกติ |
| `vp_view.csv` | 2026-07 | ✅ ปกติ |

**สาเหตุที่พบ:** header comment ในทั้ง `sql/q3_2026_movement_admin_view.sql` และ
`sql/q3_2026_movement_pm_view.sql` เขียนไว้ผิดว่า **"NOT consumed by the app"** — น่าจะทำให้
คนที่ re-run ข้อมูลไตรมาสใหม่อ่านแล้วข้ามไฟล์นี้ไป (แก้ comment แล้วทั้งสองไฟล์ ระบุชัดว่า
`/nrr` ดึงตรง ต้อง re-run ทุกไตรมาส) ตัว SQL logic เองไม่มีบั๊ก (auto-derive ไตรมาสจาก
`CURRENT_DATE` ถูกต้องอยู่แล้ว — แค่ไม่มีใคร run ตั้งแต่ Q3 เริ่ม)

**แก้ที่ทำได้จากโค้ด (เสร็จแล้ว):** เพิ่ม staleness guard — ถ้าไฟล์ที่ดึงมามี `period_month`
ไม่ตรงไตรมาสปัจจุบัน จะโชว์ **banner สีส้ม** ทั้งที่ pulse hero (satellite % ที่มาจากไฟล์นั้น)
และหน้า PM/Admin Portfolio section ตรวจแล้ว: banner โผล่เฉพาะ admin_view (ตรงจริง), ไม่โผล่ที่
pm/vp (ถูกต้อง)

**⚠️ สิ่งที่โค้ดแก้ไม่ได้ — ต้องทำเอง:** re-run `sql/q3_2026_movement_admin_view.sql` บน
BigQuery (จะได้ ก.ค./ส.ค./ก.ย. อัตโนมัติจาก auto-derive) แล้ว upload ผลลัพธ์ทับ
`admin_view.csv` บน R2 — ผมไม่มีเครื่องมือรัน BigQuery ให้จากที่นี่ หลัง upload แล้ว banner
จะหายไปเอง (ไม่ต้อง deploy /nrr ใหม่)

## Verify ที่ทำ (build v14 จริง + ข้อมูลจริงจาก R2 + DB)
- เลขเต็มทุกจุดคอมมิชชั่น (hero/rows/KAM ในทีม/drawer) ✓
- KAM row เต็มความกว้าง container จริง (ไม่ใช่ 420px) ✓
- Drawer hero ตรงกับ row ภายนอกเป๊ะ (฿11,048=฿11,048) ✓ · Gate/Handover/NRR/Expansion/Upsell ครบ 4 section ✓
- Staleness: admin_view flagged, pm/vp ไม่ flagged (ตรงความเป็นจริง) ✓
- `verify_nrr_formula.js` PASS 14 scopes (ไม่กระทบ) ✓ · console 0 errors ✓

## Rollback
`git revert <commit>` → push (v14 → v13)
