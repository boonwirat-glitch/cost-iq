# Handoff — /nrr v16: Commission visual-hierarchy polish — "พูดครั้งเดียวในที่ที่ถูก" · 2026-07-09

Feedback หลัง v15: journey ถูกทางแล้ว แต่ visual hierarchy พัง — pill ESTIMATE ติดทุกชื่อ (8/จอ),
chip tier + progress อีกแถวละชุด ทุกอย่างตะโกนพร้อมกัน + Expansion ลอยแยกนอกใบเสร็จแบบไม่มีคำอธิบาย
เงื่อนไข: **ห้ามแก้ด้วย font เล็ก/จาง** — แก้ด้วยการจัดว่าข้อมูลไหนพูดที่ระดับไหน

## หลัก design ที่ใช้ (บันทึกไว้เพื่องานต่อๆ ไป)

1. **Exception-based status ทั่วระบบ** — สถานะเหมือนกันทั้งชุด = stamp เดียวที่หัว section,
   รายแถวติดเฉพาะแถวที่ต่าง (`nrrCommStatusPlan()` — twin กับกติกาที่ตารางเต็มใช้อยู่แล้ว)
2. **หนึ่งแถว = หนึ่งเส้นสายตา (ชื่อ → เงิน)** — chip tier ตัดออกจากแถว (อยู่เฉพาะ drawer),
   %NRR ใช้สี `nrrThresholdColorVar` convention เดิมทั้งหน้า + progress bar เงียบๆ
3. **โครงสร้างเล่าเรื่องแทนคำอธิบาย** — ใบเสร็จครบทุก component ไม่มีท่อนหาย
4. **Alignment เป็นคอลัมน์** — [chevron 16px][operator 20px][label ซ้าย][เงิน ขวา] ทุกบรรทัดตรงกัน

## สิ่งที่เปลี่ยน

### ใบเสร็จ KAM — ครบ 8 บรรทัดของสูตรจริง `(NRR + P1 + P3 + Expansion) × Gate + Handover`
```
  NRR (101%)                     ฿5,000  › ร้าน NRR (GMV + จุด movement)
+ Upsell P1 · สินค้าใหม่            ฿110  › กลุ่มสินค้า P1 + note กติกา
+ Upsell P3 · สินค้าโต               ฿74  › กลุ่มสินค้า P3
+ Expansion · ร้านขยาย 0.5%          ฿12  › ร้านขยาย + เงินจริงต่อร้าน
────────────────────────────
  รวมก่อน Gate                   ฿5,196
× NRR Gate (101% ≥ 98%)           ×1.00
+ Handover · retention (1 ร้าน · 36%) ฿0  › ร้านโอน + baseline→MTD
════════════════════════════
  รวมค่าคอมฯ                     ฿5,196
```
- Expansion ไม่ลอยแยกแล้ว — เป็นเพื่อนร่วมชั้นกับ P1/P3 (คำถาม "ทำไมแยก" หายเอง)
- Handover แสดงเสมอแม้ ฿0 พร้อม meta ("1 ร้าน · retention 36%" / "ไม่มีเดือนนี้")
- Gate label โชว์การเทียบเกณฑ์ในตัว
- **ใบเสร็จบวกลงตัวเป๊ะทุกกรณี**: บรรทัด Expansion ดูดเศษปัดของ P1/P3 (remainder-adjustment)
  — เดิม 5,000+110+74+11 = 5,195 ≠ subtotal 5,196; ตอนนี้ 110+74+12 ✓
- P1/P3 drill เปิดมามี note กติกา: "นับเฉพาะร้านนอกกลุ่ม Expansion..."

### ใบเสร็จ TL — แทน note ยาวใน row detail
`NRR ทีม (107%) ฿50,000 × ตัวคูณ upsell ทีม (0.4% ของฐาน) ×1.00 = ฿50,000` —
บรรทัดตัวคูณ**กดขยายได้** เห็นรายชื่อ KAM + tl_upsell_base ต่อคน (ใครดันตัวคูณทีม)
— multiply line expandable เป็นความสามารถใหม่ของ renderer

### Stamp discipline (ผลตรวจจริง)
- เดิม: 16 stamps + 16 chips ต่อจอ → ใหม่: **header 3 จุด (รายทีม + KAM ในทีม ×2), รายแถว 0**
- Mixed-status ทดสอบแล้ว: mock ให้ Dent เป็น FINAL คนเดียว → ทีม Name หัวไม่มี stamp,
  รายแถวโชว์ FINAL@Dent + ESTIMATE@คนอื่น; ทีม Ploy (uniform) → หัว ESTIMATE เดียว รายแถว 0 ✓
- เงิน estimate ยังคง sun-deep (สีทำหน้าที่แทน pill), snapshot เป็น ink/green-deep

### Alignment
Label ทุกบรรทัดเริ่ม x เดียวกัน (ตรวจ: 233px ×4) — แก้บั๊ก v15 ที่ label ลอยกลางเพราะ
flex space-between + ::before chevron; ตอนนี้เป็น grid 4 คอลัมน์

## Verify (build v16 + ข้อมูลจริง R2/DB)
- Bookbig ฿5,196 = 5,000+110+74+12 เป๊ะ · hero เท่า v15 · WHITE SHRIMP โผล่ใน P1 drill พร้อม GMV+คอม
- Handover Bookbig: ข้อมูลจริง 1 ร้าน retention 36% → ฿0 (ต่ำกว่า tier 100%) — ถูกต้อง
- pill census: 3 header / 0 row · tier chips ในแถว 0 · progress bars คงอยู่ 16 (เงียบ)
- `verify_nrr_formula.js` PASS 14 scopes · console 0 errors

## หมายเหตุ
mock snapshot ที่ตั้งใจให้ final_payout ≠ ผลบวก (9,999 vs 10,900) แสดงตามที่เก็บจริง —
ข้อมูล lock จริงจาก engine สอดคล้องกันเสมอ ใบเสร็จจึงตรงเสมอกับของจริง

## Rollback
`git revert <commit>` → push (v16 → v15)
