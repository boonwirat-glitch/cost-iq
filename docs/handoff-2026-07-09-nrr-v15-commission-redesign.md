# Handoff — /nrr v15: Commission UX Redesign — "ใบเสร็จค่าคอมฯ" · 2026-07-09

หลัง v14 ตัวเลขถูกแล้ว แต่ผู้ใช้บอก commission "ยังผิดซ้ำวนๆ" — สาเหตุจริงไม่ใช่เลขผิด แต่โครง UX ผิด:
drawer โยนรายชื่อร้าน 154 ร้านให้ดูตรงๆ ไม่มีลำดับ/aggregate ให้เห็นภาพก่อน แถมมีบั๊กจริงซ่อนอยู่
สั่งให้หยุด patch แล้วไปวิจัย journey ของ Sense (rep-facing commission) มาออกแบบใหม่ — ทำเสร็จแล้วใน v15

## งานวิจัย (สรุป — เต็มอยู่ใน conversation)

Sense มี journey 3 ชั้นชัดเจน: **strip** (เห็นตลอด: eyebrow+chip สถานะ+NRR%/tier+action text+ยอดเงิน+
progress bar) → **sheet "วิธีคิดค่าคอมฯ"** (KPI คู่+ตาราง tier เต็ม, แถวปัจจุบัน/ถัดไปไฮไลต์) →
**history 6 เดือน** (breakdown เป็น component: NRR/P1/P3/Expansion/Handover — **aggregate เท่านั้น
ไม่มีชื่อร้าน**) **Sense ไม่มี account-level drill-down เลย** — /nrr (จาก V2) เก่งกว่าตรงนี้อยู่แล้ว
งานนี้คือเอาโครง 3 ชั้นของ Sense มาครอบ แล้วเปิดชั้นที่ 4 (drill รายร้าน) ให้กดดูเอง

## สิ่งที่ ship

### 1. บั๊กจริงที่แก้ (ต้นเหตุที่ทำให้ "ดูผิด")
`nrrOutlets` filter ใน drawer เดิมใช้ `r.movement_type` ดิบจาก CSV — ร้าน core_nrr ที่ curr_gmv=0
(ควรนับเป็น churn) หลุดเข้ามาโชว์ ฿0 ปนอยู่ในลิสต์ NRR แก้เป็นใช้ `nrrOutletsForKam()` ที่มีอยู่แล้ว
(effective classification เดียวกับที่ %NRR ใช้จริงทั้งแอป) — **ผลตรวจจริง: Dent (112%) รายชื่อ NRR
ลดจาก 154 → 137 ร้าน, ฿0 หายไปหมด (0 rows)**

### 2. "ใบเสร็จ" (receipt) แทนตารางแบน — ตัวชูของงานนี้
เพราะสูตรจริงเป็นลำดับคำนวณตายตัว `(NRR tier + Upsell) × Gate + Handover = Total` — แสดงเป็น
ใบเสร็จเดินบัญชีทีละบรรทัด บวก/คูณไปเรื่อยจนถึงยอดสุทธิ แทนก้อนลอยๆ แบบ Sense ทุกบรรทัดกดขยาย
เป็น account list ได้ (ปิดไว้เป็น default) — ตรวจจริง (Bookbig, 101%):
```
+ NRR (101%)                    ฿5,000   [กดขยาย → 6 ร้าน Chain, GMV เรียงมาก→น้อย]
+ Upsell P1 + P3 + Outlet          ฿196   [กดขยาย → breakdown P1/P3]
──────────────────────────────────────
รวมก่อน Gate                     ฿5,196
× NRR Gate                        ×1.00
══════════════════════════════════════
รวมค่าคอมฯ                       ฿5,196
```
Renderer เดียว (`nrrCommReceiptHtml`) ใช้ได้ทั้ง snapshot ที่ล็อกแล้ว
(`nrrCommSnapshotReceiptSteps(bd)`) และ estimate ที่ยังไม่ล็อก (`nrrCommEstimateReceiptSteps(est)`)
— หน้าตาเหมือนกันเป๊ะไม่ว่าจะล็อกหรือไม่

### 3. แยกความหมาย "GMV" vs "commission จริง" ต่อร้าน
- **NRR list**: ไม่ใช่ผลรวมร้าน (เป็น flat tier payout ตาม %NRR รวม) → แสดง GMV + จุดสีบอกประเภท
  movement เท่านั้น **ไม่มีคอลัมน์เงินหลอกๆ ต่อร้าน**
- **Expansion list**: ร้านนี้ได้เงินจริง (GMV×0.5%) → แสดงคอลัมน์ commission ต่อร้านจริง
(`nrrCommOutletListHtml(outlets, emptyText, commissionRate)` — param ที่ 3 คุมพฤติกรรมนี้)

### 4. Tier chip + progress bar + next-step (ยืม pattern Sense, ใช้ token Fresh Canvas เดิม)
สถานะ "ถึงเกณฑ์ไหม" เป็นแกนที่สองแยกจาก stamp ESTIMATE/DRAFT/FINAL (แกนนั้นบอก "ล็อกหรือยัง"):
- `.nrr-comm-tier-chip.hit` (green-soft) / `.bonus` (sun-soft, ถึง tier สูงสุด) / `.miss` (coral-soft)
- Progress bar (`--fill-deep` track, `--green` fill) ไปยัง tier ถัดไป
- Next-step 1 บรรทัด: "อีก +2pp ถึง ฿10,000" — ตรวจจริง Bookbig 101%→103%: gap=2pp คำนวณถูก
- โชว์ทั้งใน **drawer** (เต็ม, มี next-step) และ**แถวสรุปหน้าหลัก** (mini, ไม่มี next-step — ดูสถานะ
  ได้โดยไม่ต้องกดเข้า drawer) — ทั้งแถว KAM/TL บนสุดและแถว "KAM ในทีม" ที่ซ้อนอยู่

### ไฟล์ใหม่ในระบบเดิม (ไม่มีไฟล์ใหม่ทั้งไฟล์ — ต่อยอด nrr_commission.js/nrr_view.js/nrr_components.css)
- `nrr_commission.js`: `nrrCommTierTable`, `nrrCommEstimateReceiptSteps`, `nrrCommSnapshotReceiptSteps`
- `nrr_view.js`: `nrrCommTierChipHtml`, `nrrCommProgressHtml`, `nrrCommNextStepHtml`, `nrrCommTierMiniHtml`,
  `nrrCommReceiptHtml`, `nrrCommOutletListHtml` (เดิม `nrrCommDrawerOutletSectionHtml`, ปรับ signature),
  `nrrCommHandoverListHtml`, `nrrCommUpsellListHtml` (ทั้งสามตัวสุดท้ายถอด wrapper section ออกแล้ว
  เพราะย้ายไปอยู่ใต้ receipt line แทน)
- `nrr_components.css`: `.nrr-comm-tier-chip/-block/-row/-mini`, `.nrr-comm-progress(-fill)`,
  `.nrr-comm-next-step`, `.nrr-comm-receipt(-line/-rule/-detail)` — compose จาก token เดิมทั้งหมด
  ไม่มี hex ใหม่ (ตาม memory `nrr-design-system-split`)

### Reuse-ready สำหรับ Phase B (ยังไม่ build)
ทุกฟังก์ชันข้างบนรับ `email`/`role`/`period` เป็น parameter อยู่แล้ว ไม่ผูกกับ `nrrProfile` ของ admin —
ตอน Phase B เปิด rep หน้า portfolio ของ rep เรียกชุดฟังก์ชันนี้ตรงๆ ได้ทันที ไม่ต้องเขียนใหม่

## Verify ที่ทำ (build v15 จริง + ข้อมูลจริงจาก R2 + DB)
- Dent (112%): hero ฿11,048 **เท่าเดิมเป๊ะ** จาก v14 · ใบเสร็จบวกกันตรง (10,000+1,048=11,048, ×1=11,048) ✓
- NRR list: 154→137 ร้าน, ฿0 rows = 0 (เดิมมีปนอยู่) ✓
- Bookbig (101%): tier chip "ถึงเกณฑ์แล้ว" (hit), progress 33% (=(101-100)/(103-100)), next-step
  "อีก +2pp ถึง ฿10,000" — ตรวจมือแล้วถูกทั้งหมด ✓
- Dent (112%, tier สูงสุด): chip "โบนัสสูงสุด" (bonus), progress 100%, next-step "รักษา NRR..." ✓
- Expansion row: มีคอลัมน์ commission ต่อร้านจริง (GMV×0.5%); NRR row: มีแค่ GMV+จุดสี ไม่มีคอลัมน์เงินหลอก ✓
- `verify_nrr_formula.js`: PASS 14 scopes (ไม่แตะ compute engine) ✓ · console: 0 errors ✓
- Mobile 375px: ไม่มี horizontal overflow จริง (bodyScrollW===clientW เป๊ะ) — เดิมทีก็แน่นเพราะ drawer
  92vw บนจอ 375px เป็น constraint เดิมของ TL/Admin dashboard (desktop-first ตามสถาปัตยกรรม)

## Rollback
`git revert <commit>` → push (v15 → v14)
