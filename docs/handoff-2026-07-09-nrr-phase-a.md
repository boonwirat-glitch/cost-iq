# Handoff — /nrr Phase A: commission เดือนปัจจุบัน + hash router (nrr_v12) · 2026-07-09

บริบท: phase แรกของ roadmap "สมุดสองชั้น" (Dashboard ชั้น aggregate เดิม + Portfolio ชั้น
operational ใหม่สำหรับ rep/TL) — แผนเต็ม 4 phases (A: รากฐาน · B: Portfolio+เปิด rep ·
C: Account view/SKU movement · D: Restaurant deep-dive) อยู่ในแผนที่อนุมัติ 2026-07-09

## ที่ ship ใน nrr_v12

### 1. Commission เดือนปัจจุบันแสดงผลแล้ว (แก้บั๊ก hero ฿0)
- root cause: hero ฝั่ง admin ใช้ `nrrSumLatestPayouts()` (snapshot ที่ lock แล้วเท่านั้น)
  ขณะที่ row ข้างล่างมี pace-based estimate fallback อยู่แล้ว → ก.ค. ยังไม่ lock = hero ฿0
- แก้: helper ใหม่ `nrrCommEstimateFor(email, kind, month)` ใน `nrr_view.js` — คณิตเดียว
  กับ row fallback เป๊ะ (hero = Σ rows เสมอ) ใช้ทั้ง hero admin + trend bars
- hero: ทีมที่ไม่มี snapshot ใช้ estimate + stamp ESTIMATE ที่ eyebrow + subtitle
  "snapshot X/N ทีม · รวมค่าประมาณ pace-based Y ทีม"; ครบทุกทีม → stamp FINAL/DRAFT ตามจริง
- trend bars: เดือนที่ไม่มี snapshot แต่มีข้อมูล GMV → แท่งประมาณการ (hatch สี sun +
  border `--sun-deep` + title "~฿X (ประมาณการ)") · เดือนอนาคต → pending เทาเหมือนเดิม
- CSS ใหม่: `.nrr-comm-ds .ds-spark-bar.est`

### 2. Hash router — โครงกระดูกของชั้น Portfolio (`src/nrr/nrr_router.js` ใหม่)
- routes: `#/` dashboard · `#/portfolio[/:kamEmail]` · `#/account/:accountId`
- views เป็น sibling containers (`.nrr-view`, toggle ด้วย `[hidden]`) — DOM ของ dashboard
  ไม่ถูกรื้อ ทำให้ `nrrRenderAll()` เดิมทำงานเหมือนเดิมทุกอย่าง
- role guard พร้อมแล้ว: `rep` → บังคับ `#/portfolio` ของตัวเอง (ยังเข้าไม่ได้จริงจนกว่า
  Phase B จะเปิด `NRR_ALLOWED_ROLES`)
- masthead เพิ่ม `.nrr-appnav` (Dashboard · Portfolio ใช้ `.seg` เดิม); subnav scrollspy
  แสดงเฉพาะใน dashboard view
- Portfolio/Account เป็น placeholder "เร็วๆ นี้" ใน phase นี้
- `build_nrr.py` + `shell_nrr.html`: slot `INJECT_ROUTER` ใหม่ (หลัง CORE ก่อน AGGREGATE)

### 3. Responsive pass แรก (`@media ≤640px`)
masthead/page padding — เตรียมพื้นสำหรับหน้า rep (มือถือ) ใน Phase B; dashboard เดิมคง desktop-first

### 4. Assertion สูตร %NRR ถาวร — `tools/verify_nrr_formula.js` (ใหม่)
จาก validation ที่ผู้ใช้ขอ (2026-07-09): (1) day-rate ≡ normalize×30 ทั้งสองฝั่ง
(2) comeback อยู่ในตัวเศษ (v848 Bucci decision) — รันกับ CSV สดจาก R2 ได้ทุก vintage
(ต่างจาก `verify_transfer_in_fix.js` ที่ pin ค่ากับ export 2026-07-08)
ผลรันล่าสุด: PASS ทุก KAM scope (14 scopes, 10 scopes มี comeback)

## Verification ที่ทำ (mock harness + preview บน v12 build จริง)
- hero admin ก.ค.: ฿219K = Σ estimate 2 ทีมเป๊ะ (110K×2 ใน mock) + stamp ESTIMATE ✓
- trend: ก.ค. แท่ง hatch "~฿219K (ประมาณการ)" · ส.ค./ก.ย. pending ✓
- มิ.ย. (locked) full table: FINAL stamp เดี่ยว + GRAND TOTAL ฿18K — ไม่เปลี่ยนจาก v11 ✓
- router: toggle views, appnav active state, subnav ซ่อนนอก dashboard, rep guard
  redirect ทั้ง `#/` และ portfolio คนอื่น → `#/portfolio` ตัวเอง ✓
- mobile 375px: ไม่มี horizontal overflow ✓ · console: 0 errors ✓
- `verify_nrr_formula.js` + `verify_transfer_in_fix.js`: PASS ทั้งหมด ✓

⚠️ หมายเหตุ: ตัวเลข ฿219K ในการทดสอบมาจาก mock triple (ฐาน 14M) — บน production
กับข้อมูลจริงคาดว่า ~฿1.47M (846K+626K ตาม estimate rows ที่โชว์อยู่แล้ว)
**รอผู้ใช้ยืนยันด้วย real login (admin) เป็น gate สุดท้ายของ Phase A**

## ถัดไป — Phase B (Portfolio, เปิด rep)
เปิด role `rep` ใน `NRR_ALLOWED_ROLES` + landing `#/portfolio` + fetch
`portview.csv`/`bulk_history.csv` + port `computePaceSignal`/`computeChurnCountsForAccount`
+ การ์ดร้าน + commission การ์ด rep — ตามแผนที่อนุมัติ

## Rollback
`git revert <commit นี้>` → push (อาจ revert เฉพาะ commission fix ไม่ได้เพราะ commit เดียว —
revert ทั้ง v12 กลับ v11 ปลอดภัย, read-only ทั้งหน้า)
