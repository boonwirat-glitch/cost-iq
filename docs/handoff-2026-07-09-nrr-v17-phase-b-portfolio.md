# Handoff — /nrr v17: Phase B — เปิด rep + หน้า Portfolio · 2026-07-09

เปิดสิทธิ์ role `rep` (16 คน) เข้า `/nrr` ได้จริงเป็นครั้งแรก และสร้างหน้า Portfolio (route/placeholder
มาจาก Phase A) ให้ rep เห็นร้านในมือตัวเองพร้อม NRR/commission — TL/Admin เข้าหน้าเดียวกันได้พร้อม
KAM switcher. Build ผ่าน 3 รอบ feedback หลังเปิดดูจริง (บันทึกรวมเป็น v17 เดียว):

## Round 1 — โครง Portfolio + role gate

- `nrr_core.js`: เพิ่ม `'rep'` เข้า `NRR_ALLOWED_ROLES` + ตัดข้อความ error/subtitle เดิม
  "สำหรับ Team Lead และ Admin เท่านั้น" ที่ไม่จริงอีกต่อไป (`shell_nrr.html` ด้วย)
- `nrr_router.js`: เพิ่ม guard กัน TL เปิด `#/portfolio/<kamEmail>` ของ KAM นอกทีมผ่าน URL ตรงๆ
  (เดิมกันแค่ rep, TL ไม่ถูกกันมาก่อน — comment ในโค้ดบอกตรงๆว่า "tl/admin: everything")
- `nrr_data.js`: `nrrFetchPortviewCsv()` ดึง `portview.csv` (20 คอลัมน์, precomputed pace/churn)
- `nrr_portfolio.js` (ไฟล์ใหม่): `nrrPaceSignal`/`nrrPortfolioRowsFor`
- `nrr_view.js`: `nrrRenderPortfolioLayerView` จริง — แถบสรุปตัวเอง (reuse `nrrCommReceiptBundle`
  ที่ refactor ออกจาก drawer เดิม ให้ drawer กับ Portfolio ใช้ตัวเดียวกัน 100%) + รายการร้าน + switcher

## Round 2 — UX ของรายการร้าน (feedback หลังเปิดดูจริงครั้งที่ 1)

ปัญหา: ป้าย "SKU หลุด N" (นับดิบ) ดูน่ากลัวเกินจริงทุกร้าน (สาเหตุจริง: `churned_sku_count`
เทียบ "เดือนที่แล้ว vs MTD เดือนนี้" — early-month bias ของ SQL เอง ไม่ใช่บั๊ก) + layout grid
หลายคอลัมน์ไม่มี scan order

- เปลี่ยน grid → **list แนวตั้ง** (ชื่อ+meta ซ้าย, pace%+status word ขวา, sort worst-first)
- ป้าย SKU → เศษส่วน "N/M" ไล่สีตามสัดส่วนจริง (ไม่ใช่สีแดงทันทีที่ N>0)
- เพิ่ม status word ข้าง pace% ("ตามเป้า"/"เฝ้าดู"/"น่าเป็นห่วง") ไม่พึ่งสีอย่างเดียว

## Round 3 — ดึง Sense parity มา + แก้ baseline ให้ถูก (feedback ครั้งที่ 2)

**เรื่อง baseline — ประเด็นสำคัญที่สุดของรอบนี้**: ตรวจโค้ด Sense จริง (`06_portview_teamview.js`)
พบว่า Sense ใช้ rolling เฉลี่ย 1-3 เดือนล่าสุดเป็น baseline — /nrr **ตั้งใจไม่ทำตาม** เพราะทุกอย่างใน
หน้านี้ (%NRR/ค่าคอมฯ) ยืนอยู่กับ `QNRR_CFG.base_month` (เดือนฐานไตรมาส fixed) อยู่แล้ว จึงให้ pace
ระดับร้าน**ยืนกับเดือนฐานเดียวกัน** ไม่ rolling — กันปัญหาสองเลขขัดกันตอนไตรมาสเดินผ่านเดือนแรก

- `nrr_data.js`: `nrrFetchBulkHistoryCsv()` ดึง `bulk_history.csv` (account×month GMV 6 เดือน)
- `nrr_portfolio.js`: เขียน `nrrPaceSignal` ใหม่ — `baseline_gmv` = lookup แถวที่ month_label
  ตรงกับ Thai label ของ `QNRR_CFG.base_month` (ไม่ใช่ last_month_gmv จาก portview.csv ที่เลื่อนได้)
  + `nrrPortfolioRiskSummary()` (กลุ่ม ok/warn/danger + มูลค่า, สูตรจาก Sense's ON TRACK/MONITOR/
  AT RISK) + `nrrAcctSparklineHtml()` (6 เดือน + เดือนปัจจุบัน hatch, ported จาก Sense's
  `_buildSparkline`)
- `nrr_view.js`:
  - Hero ใหม่ %NRR + ฐาน/MTD/run-rate (`nrrMonthTriple`+`nrrTripleHtml('lg',...)` ของเดิม) ขึ้นก่อน
    ค่าคอมฯ (ค่าคอมฯ ย้ายลงเป็น section รอง)
  - แถบสรุปพอร์ต (risk summary) — **การ์ดเขียว/เหลือง/แดงเป็น filter แบบ multi-select ได้**
    (คลิกได้หลายอัน OR กัน, ไม่เลือก = เห็นทั้งหมด) แทน chip "ทั้งหมด"/"ต่ำกว่า pace" เดิมที่ตัดออก
  - ป้าย SKU กลับเป็นแง่บวก "สั่งแล้ว N/M SKU" (นับที่กลับมาสั่ง ไม่ใช่นับที่หาย) สีไล่ตามอัตราสั่งซ้ำ
  - Sparkline ย้ายไปอยู่ใต้ pace%/status ทางขวา (ประหยัดพื้นที่คอลัมน์ซ้าย)
- `nrr_components.css`: `.nrr-port-pulse`, `.nrr-risk-strip`/`.nrr-risk-tile` (clickable + selected
  state), `.nrr-spark*` (ใช้ hatch pattern เดียวกับ `.nrr-qcol-hatch` เดิม ไม่มี pattern ใหม่)

### บั๊กที่เจอกลางทางและแก้แล้ว
`.nrr-spark` ใช้ `max-width` แทน `width` จริง — flex children (`flex:1`) เลยไม่มีที่ยืน collapse
เหลือ 10px มองไม่เห็น แก้เป็น `width:100px` ตรงๆ

## Verify (ข้อมูลจริง R2/Supabase ทุกจุด ไม่ใช่ mock)

- **Role matrix**: rep login จริง → เห็น `#/portfolio` ตรงเข้า, เข้า dashboard ไม่ได้ · TL → switcher
  เห็นเฉพาะทีมตัวเอง, พิมพ์ URL ข้ามทีมตรงๆ ถูก redirect กลับ (guard ใหม่ทำงาน) · admin → ทุกคน
- **Baseline correctness**: สุ่ม 1 account เทียบมือ — `baseline_gmv` เท่ากับ GMV เดือนมิถุนาฯ จริง
  จาก `bulk_history.csv` เป๊ะ (ไม่ใช่เดือนก่อนหน้าปัจจุบัน)
- **Regression**: เปิด commission drawer จาก dashboard กับ Portfolio self-summary ของ KAM เดียวกัน
  → ตัวเลข ฿10,383 ตรงกันเป๊ะทั้งสองที่ (คนละ code path เดิม ตอนนี้ path เดียว)
  · `verify_nrr_formula.js` PASS ทั้ง 2 invariant (compute engine ไม่ถูกแตะ)
- **SKU severity**: ตรวจ ratio ทั่วพอร์ต ครอบคลุมทั้ง 3 ระดับสี (quiet/warn/danger) จริง ไม่ใช่แค่เคส
  เดียว · risk-tile multi-select OR ถูก (9+3=12 ตอนเลือก 2 การ์ด, deselect กลับมา 34 ครบ)
- Mobile 375px: ไม่มี horizontal overflow, sparkline/status wrap ได้แต่ไม่ล้น
- Console: 0 errors ทุก role ทุก interaction ที่ทดสอบ

## ไม่แตะ
Compute engine (`nrr_logic.js`) · dashboard เดิม (TL/admin) · SQL `churned_sku_count` definition
เอง (early-month bias เป็นงาน data pipeline คนละ scope — ยังไม่แก้ต้นทาง)

## Fast-follow ที่บันทึกไว้
- Account view (`#/account/:id`) — Phase C เดิม ยังไม่ทำ (ปุ่มเข้า account ซ่อนไว้ก่อน)
- `churned_sku_count` ที่ต้นทาง SQL ยัง MTD-biased — ถ้าอยาก interval-aware แบบ Sense จริง ต้องแก้
  `sql/Q8E_portview_v3.sql`

## Rollback
`git revert <commit>` → push (v17 → v16)
