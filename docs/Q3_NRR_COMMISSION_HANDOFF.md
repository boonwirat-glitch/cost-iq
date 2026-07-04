# Q3 2026 Quarterly Commission — HANDOFF

**Session date:** 2026-07-04 (session ยาวมาก — ต่อจาก session 2026-06-30 ที่สร้าง branch)
**Branch:** `preview/q3-commission-build` (จาก `main` @ `c4b1c4261f`)
**สถานะ:** Logic ยืนยันถูกต้องด้วยการรันจริง (ไม่ใช่แค่อ่านโค้ด) — **ยังไม่เคยรันในเบราว์เซอร์จริงสักครั้ง**

> อ่านคู่กับ `docs/Q3_NRR_COMMISSION_SPEC.md` (ตรรกะ/สูตร/schema) — เอกสารนี้คือ "เกิดอะไรขึ้นบ้าง + เหลืออะไร"

---

## 1. สรุป — งานที่ทำเสร็จ session นี้ (เรียงตามลำดับที่ทำ)

### A. Reconcile main → preview
Main มีงานใหม่ (retroactive lock, frozen-NRR asOfPeriod, cds.js override removal) ที่ preview branch ไม่มี — merge เข้าด้วยกันแบบ manual (conflict ที่ `07a_commission_engine.js`, `07b_commission_cockpit.js`)

### B. SQL Auto-derive (ห้าม hardcode วันที่ไตรมาส)
- `q3c_upsell_bulk_all_kams_v4.sql` + `q3c_upsell_team_summary_v4.sql` — เปลี่ยนจาก literal date เป็น `DATE_TRUNC(current_mo, QUARTER)` คำนวณเอง
- `q3_2026_movement_{kam,pm,admin,tl,rep}_view.sql` ×5 — เปลี่ยนเป็น BigQuery **DECLARE/SET script** (ต้องรันแบบ script ไม่ใช่ query ธรรมดา) auto-derive quarter anchor จาก `CURRENT_DATE()`

### C. CSV Parser — บั๊กใหญ่ที่สุดที่เจอ
Parser เดิม (`02_data_pipeline.js` type `bulk-qnrr-single`) เขียนมาตรงกับ schema เก่า (`quarterly_nrr_2026_Q2_v8.sql` — ดู commit timeline ด้านล่าง) ที่มี column แค่ 16 ตัว แต่ SQL จริงปัจจุบัน (`rep_view`) มี **29 columns คนละโครงสร้าง** — parser อ่านตำแหน่งผิดหมด แก้ใหม่ทั้งหมดให้ตรง 29 columns จริง + เปลี่ยน grouping key เป็น `latest_kam_email`/`latest_tl_email`

**Commit timeline ที่ยืนยันว่า v5-v8 ถูกแทนที่แล้ว:**
```
quarterly_nrr_2026_Q2_v5.sql → 19 มิ.ย.
v6/v7/v8                      → 20-25 มิ.ย. (v8 commit สุดท้าย 25 มิ.ย. 10:04)
q2_2026_movement_rep_view.sql → เริ่ม 25 มิ.ย. 23:43 (ต่อจาก v8 คืนเดียวกัน) → 29 มิ.ย.
```

### D. Commission Calculation — 18 จุดที่เรียก `_tgtComputeKamNRR()` (MoM) ตรงๆ โดยไม่เช็ค quarterly mode
แก้ครบทั้งหมด รวมถึงจุดอันตรายสุด (audit trail ที่บันทึกลง Supabase, outlet exclusion สำหรับ P1/P3) — สร้าง helper กลาง `_commQnrrDrillResult()` ให้ drill-down 4 จุดใช้ร่วมกัน

### E. Retroactive Lock + Auto-compute
`_commBuildKamPayout`/`_commBuildTlPayout` เดิม resolve policy จาก "วันนี้" เสมอ ไม่สนใจ `periodOverride` — แก้ให้ resolve จาก period ที่กำลังคำนวณจริง (สำคัญเวลาล็อคย้อนหลังข้ามไตรมาส) และ `_qnrrComputeForCommission` เพิ่ม `asOfPeriod` param

### F. UI Alignment (portview/teamview/account view/restaurant mode)
ไล่ตรวจครบทุก view ด้วย test-spec ที่ชัดเจน (ไม่ใช่ grep สุ่มหา) — เจอ+แก้ cache key ไม่รวม `commission_mode`/QNRR-loaded state, และ baseline formula UI hardcode 3-เดือน-avg ทั้งที่ quarterly ควรโชว์เดือนฐานเดียว

### G. 🔴 Syntax Error จริง (เจอตอนรัน `node --check` เป็นครั้งแรกในเซสชันนี้)
`07b_commission_cockpit.js` — ขาด `}).join('')}` ปิด `.map()` ทำให้การ์ด "Commission Mode — Q3" เป็น raw HTML ลอยนอก template literal → **SyntaxError ที่จะพังทั้ง bundle** ถ้าไม่เจอ บั๊กนี้อยู่มาตั้งแต่ preview branch สร้างครั้งแรก (ไม่เคยถูกรันจริงเลย)

### H. Integration Test (รันจริงใน Node.js ไม่ใช่แค่อ่านโค้ด)
สร้างข้อมูลจำลอง 4 outlet (core_nrr×2, expansion, handover) โหลด `07c_qnrr_view.js` เข้า Node VM จริง เรียก `_qnrrCompute`/`_qnrrComputeForCommission` จริง — ผลตรงกับคำนวณมือ 100% (NRR%, expansion GMV, handover ไม่ปนกับ NRR)

### I. Supabase Migration + Backfill (รันจริงแล้วโดยผู้ใช้)
```sql
ALTER TABLE nrr_policies ADD COLUMN commission_mode..., quarter_id...;
UPDATE ... SET commission_mode='quarterly' WHERE period_month='2026-07' ...;
INSERT INTO nrr_policies (2026-08, 2026-09 quarterly rows);
```
ยืนยันผลลัพธ์ตรงกับที่ต้องการแล้ว (ดู section 5 ใน SPEC.md)

### J. Config Verification (Supabase จริง vs โค้ด)
เจอว่าโค้ดมี **fallback default ผิดจากค่าจริง** หลายจุด (Gate: code default 95/90/70%/35% vs จริง 98/95/70%/0%; P3 floor: code default 5000 vs จริง 8000) — **ไม่ใช่บั๊ก โค้ดอ่านจาก DB ถูกแล้ว** แค่ fallback default ในโค้ดไม่ตรงกับค่าที่ Admin ตั้งจริง (ไม่กระทบการทำงานเพราะมีค่าใน DB เสมอ)

### K. Excel Validation กับข้อมูลจริง (`rep_kam_as_of_29_jun.xlsx`)
คำนวณ Churn/Up/Down breakdown มือใน Excel เทียบกับภาพ Portfolio Health จริง — Total ตรง 100% ทุกบาท, %NRR ใกล้เคียงมาก (ต่าง 0.02%, น่าจะจาก snapshot timing)

### L. 🔴 พบว่าฟีเจอร์ Churn/Up-Down ในแอปจริงไม่เคยทำงาน
`_effectiveMovement()` ใน `07c_qnrr_view.js` ไม่เคยแปลง `core_nrr`(curr_gmv=0) → `core_nrr_churn` — UI มีโครงพร้อมแต่ไม่มีอะไรป้อนข้อมูลเข้า ทำให้แถว "Churn" โชว์ "—" ตลอด (Up/Down net ก็เพี้ยนไปด้วยเพราะฐานปนร้าน churn) **แก้แล้ว**

---

## 2. ไฟล์ที่แก้ทั้งหมด session นี้

| ไฟล์ | สิ่งที่แก้ |
|---|---|
| `src/02_data_pipeline.js` | CSV parser 29 คอลัมน์ใหม่ทั้งหมด |
| `src/07c_qnrr_view.js` | field refs (latest_kam/tl_email), `_qnrrComputeForCommission` asOfPeriod, **`_effectiveMovement` churn classification** |
| `src/07a_commission_engine.js` | periodOverride/policy resolution, 8+ จุด quarterly branch, `_commQnrrDrillResult` helper |
| `src/07b_commission_cockpit.js` | **syntax error fix**, Team Preview NRR quarterly |
| `src/07b_nrr_target.js` | NRR bar, baseline formula UI |
| `src/07b_cds.js` | 4 จุด drill-down wire เข้า helper |
| `src/06_portview_teamview.js` | 3 การ์ด KAM + cache key fix |
| `sql/q3c_upsell_bulk_all_kams_v4.sql`, `q3c_upsell_team_summary_v4.sql` | auto-derive dates |
| `sql/q3_2026_movement_{kam,pm,admin,tl,rep}_view.sql` | auto-derive via DECLARE/SET script |
| `docs/*.md` | rename 8 ไฟล์ล้าสมัยเป็น `NOT_USE_` prefix, สร้าง SPEC.md + HANDOFF.md นี้ |

---

## 3. Testing ที่ทำแล้ว (และวิธีทำ — ทำซ้ำได้)

1. **`node --check`** ทุกไฟล์ .js ที่แก้ (17 ไฟล์) + bundle ที่ต่อกันจริงตาม `build.py` — เจอ syntax error 1 จุด แก้แล้ว ผ่านหมด
2. **Node VM integration test** — โหลด `07c_qnrr_view.js` จริงเข้า `vm.createContext`, ป้อนข้อมูลจำลอง 4 outlets, เรียกฟังก์ชันจริง เทียบผลกับคำนวณมือ
3. **Excel cross-check** — คำนวณ Churn/Up/Down จากไฟล์ export จริง (`rep_kam_as_of_29_jun.xlsx`) เทียบกับภาพ Portfolio Health จริงที่มีอยู่ — Total ตรง 100%

**ยังไม่ได้ทำ:**
- ❌ รันแอปจริงในเบราว์เซอร์ (ไม่มี browser automation tool ในเซสชันนี้)
- ❌ End-to-end test `_commBuildKamPayout` เต็มสาย (Gate+tier+Upsell รวมกันได้ ฿ สุดท้าย) — ทดสอบแค่ core QNRR ส่วนเดียว
- ❌ ยืนยันว่า CSV อัปโหลดขึ้น R2 จริงหรือยัง (เช็คไม่ได้ — network block โดเมน `r2.dev`)

---

## 4. สิ่งที่เหลือต้องทำ (ลำดับความสำคัญ)

1. **[Blocker] อัปโหลด CSV จริงขึ้น R2:**
   - `q3_2026_movement_rep_view.sql` → export → ตั้งชื่อ `sense_qnrr_2026q3.csv`
   - `q3c_upsell_team_summary_v4.sql` → export → ตั้งชื่อ `sense_upsell_team.csv`
   - (ไม่ต้อง export ไฟล์อื่นตามที่ระบุใน SPEC.md section 2)
2. **[สำคัญ] เปิดแอปจริงทดสอบ** — โดยเฉพาะ Commission Cockpit (เพิ่งรอดจาก syntax error หวุดหวิด) และ Portfolio Health sheet (เพิ่งแก้ churn classification)
3. **[ควรทำ] End-to-end test `_commBuildKamPayout`** เต็มสาย ให้ได้ยอด ฿ สุดท้ายเทียบคำนวณมือ (ทำ core QNRR ไปแล้ว เหลือต่อ Gate+Upsell)
4. **[รอ confirm]** ผู้ใช้ยังไม่ได้ยืนยันว่า Excel breakdown (Churn/Up/Down) ที่ทำใน chat ตรงกับที่ต้องการ 100% หรือมีจุดปรับเพิ่ม
5. **[Merge]** เมื่อ test ผ่านหมด → merge `preview/q3-commission-build` → `main`

---

## 5. กับดักที่ต้องระวังถ้าทำต่อ

- **อย่าเชื่อ default value ในโค้ด** (`_commGetConfig(cat,key,DEFAULT)`) ว่าตรงกับค่าจริง — ต้อง query `target_settings` table เสมอ (เจอ mismatch 2 จุดแล้ว)
- **อย่า assume ว่า static code reading = ใช้งานได้จริง** — เจอ syntax error ที่ไม่เคยถูกจับมาก่อนเพราะไม่มีใครรัน `node --check`
- **`commission_rules`/`commission_rule_tiers` ≠ `target_settings`** — คนละกลไก คนละ config เก็บกันคนละที่
- **SQL 5 ไฟล์ movement view ต้องรันแบบ BigQuery Script** (มี DECLARE/SET) ไม่ใช่ paste เป็น query ธรรมดา
- **ทุกครั้งที่แก้ SQL/JS ใหม่ ให้รัน `node --check` ก่อน push เสมอ** — ไม่มีข้อยกเว้น (memory ของผู้ใช้ระบุไว้แล้ว แต่เซสชันนี้เพิ่งมาจับได้ตอนท้ายๆ)
