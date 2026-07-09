# Handoff — /nrr v13: estimator ใหม่ (tier จริง) + เงินแสดงตามจริงของเดือน + appnav · 2026-07-09

แก้ 4 ประเด็นจาก feedback หลัง Phase A (ก่อนเริ่ม Phase B):

## 1. Commission estimator ใหม่ทั้งตัว — เลิกใช้สูตร %-of-GMV เก่า

**ปัญหา:** ค่าประมาณโชว์ ฿1.5M/องค์กร (฿834K/ทีม) — เพี้ยนสิ้นเชิง เพราะ estimator v1
port มาจาก dashboard เก่า (แผน Sales-TL แบบ % ของ GMV ทีม) ขณะที่แผนจริงปัจจุบันเป็น
**tier เงินก้อนคงที่** (commission_rule_tiers)

**ที่ถูก (จำลองสิ่งที่ Cockpit Compute ทำจริง):**
- TL = NRR tier (<98.5%→0 · 99-100→8K · 100-102→12K · 102-104→30K · ≥104→50K)
  × ตัวคูณ upsell ทีม (tl_upsell_mult_params: <2%→1x … ≥5%→1.8x จาก
  Σ tl_upsell_base ของ KAM ในทีม ÷ Σ ฐาน KAM)
- KAM = NRR tier (<100→0 · 100-103→5K · ≥103→10K) + upsell comm
  (p1_gmv×1% + p3_incremental×1% + outlet_gmv×0.5% จาก `sense_upsell_team.csv`)
  × NRR gate (<95%→×0 · 95-98%→×0.3 · ≥98%→×1) — **ยังไม่รวม handover** (ระบุใน note)

**Data ใหม่ที่ fetch (ตอน refresh):** `commission_plans/rules/rule_tiers/assignments`
(4 ตารางเล็ก, มี STD fallback hardcode ตรงกับ engine) + `sense_upsell_team.csv` (~100KB)

ฟังก์ชัน: `nrrEstimateTlCommission` / `nrrEstimateKamCommission` / `nrrCommTierPayout`
ใน `nrr_commission.js` — hero/trend/rows ใช้ผ่าน `nrrCommEstimateFor` ตัวเดียว (hero = Σ rows เสมอ)

**Verified กับข้อมูลจริง (CSV R2 + tier จริงจาก DB):** ทีม Name 107% → ฿50K×1x ·
Ploy 104% → ฿50K×1x · org ฿100K ESTIMATE (สมจริง เทียบ มิ.ย. จริง TL ได้ 0-18K ที่ 98-101%) ·
KAM ซ้อนราย: Dent 112% → 10K + upsell 988 ≈ ฿11K ตรงสูตรมือเป๊ะ

## 2. Admin เห็นค่าคอมฯ KAM รายคนในทีมได้แล้ว

กดขยายแถวทีม → block "KAM ในทีม": ชื่อ · %NRR · stamp · จำนวนเงิน (snapshot ก่อน,
ไม่มีก็ estimate) + ปุ่ม "ดูร้าน →" เข้า drill-down drawer เดิมได้เลย
(`nrrCommissionTeamKamsHtml`) — ฝั่ง TL login เห็นแถว KAM ของทีมตัวเองอยู่แล้วตามเดิม

## 3. ตัวเลขเงินทุกจุด = ยอดจริงตามจำนวนวันของเดือน (⚠️ ข้อตกลงใหม่ทั้งแอป)

**เดิม:** ทุกตัวเลข normalize เป็น 30 วัน (คาดการณ์ ก.ค. = ฿197.5M ทั้งที่ ก.ค. มี 31 วัน)
**ใหม่ (คำสั่งผู้ใช้ 2026-07-09):** เงินแสดง = day-rate × จำนวนวันจริงของเดือนนั้น
(เดือนจบแล้ว = ยอดจริง, เดือนเปิด = คาดการณ์เต็มเดือน) — **%NRR เท่านั้นที่ยัง normalize 30 วัน**
(ยุติธรรมข้ามเดือน, สูตรใน nrr_logic.js ไม่ถูกแตะ, assertions ใน tools/ ยัง PASS)

Implementation: `_nrrActualizeResult()` wrapper ใน `nrr_aggregate.js` — scale
segments/total_gmv ต่อเดือน ณ จุดสร้าง result ทั้ง 6 ทาง (org/team/kam/pm/admin/vp)
โดย **churn/transfer_out scale ด้วยวันของเดือนฐาน** (เป็น "ฐานที่หาย" ไม่ใช่ค่าเดือนปัจจุบัน)
+ ไล่แก้จุด ×30 ฝั่งฐาน/รายร้านทั้งหมด (`nrrBaseDays()`/`nrrDaysIn(month)`)
+ footnote ใหม่อธิบาย convention

ผลบนข้อมูลจริง: คาดการณ์ ก.ค. 197.5M → **204.1M** (×31/30) · ฐาน มิ.ย. 181.1M เท่าเดิม
(มิ.ย. มี 30 วัน) · Churn −7.5M เท่าเดิม · %NRR ~107% ไม่ขยับ

⚠️ ผลพวง: เลขเงินจะ**ไม่ตรงกับ Sense** (ที่ยัง normalize 30 วัน) จนกว่าจะตัดสินใจว่า
จะปรับ Sense ตามหรือไม่ — %NRR ตรงกันเสมอ

## 4. Appnav ≠ pills — ภาษา design แยกชัด

Dashboard·Portfolio เปลี่ยนจาก `.seg` pill เป็น**แท็บขีดเส้นใต้** (text 15px/700,
active = ink + เส้นใต้ 3px Cabbage, inactive = ink3) + เส้นแบ่ง hairline ก่อน subnav
กติกาที่บันทึกใน CSS: appnav = "คุณอยู่หน้าไหน" (ที่), pills = "มองผ่านเลนส์ไหน" (ตัวกรอง)
— ห้ามใช้สลับกัน

## Verify ที่ทำ (บน build v13 จริง + ข้อมูลจริง)
- estimator: ค่า TL/KAM ตรงสูตรมือทุกราย · hero=Σrows · stamps ครบ
- actual-month: ~204.1M = 197.5×31/30 เป๊ะ · ฐาน/churn/%NRR ไม่ขยับ · `verify_nrr_formula.js` PASS 14 scopes
- appnav: computed style ยืนยัน underline ไม่มี pill bg · subnav ยัง pill เดิม
- ไม่มี reference ค้างถึง `nrrEstimateCommission`/`nrrTLBrackets` ที่ถอดออก

## Rollback
`git revert <commit>` → push (v13 → v12)
