# Sales UX/UI Handoff — v360
**สร้าง:** June 2026 · Session: Sales UX Full Architect Build  
**SW:** freshket-sense-v360 · **Branch:** main  
**Snapshot:** `snapshot/pre-sales-ux-full-v359`

---

## ทำเสร็จใน session นี้ ✅

### W1 — Pipeline: account_type + tenure window
- **Lead sheet:** เพิ่ม type selector (SA/MC/Chain) พร้อม tenure badge (45d/90d)
  - `_salesSelectType()` helper — toggle active state บน buttons
  - `<input id="sv-lead-type">` เก็บ selected value
- **_salesSaveLead():** INSERT/UPDATE รวม `account_type` column ใน Supabase
- **Lead row:** แสดง `sv-lead-type-pill` badge ต่อท้ายชื่อร้าน (e.g. "SA · 45d")
- **Supabase migration:** `sql/sales_migration_v360.sql` — ADD COLUMN `account_type` ใน `sales_pipeline`
  - ⚠️ **ต้องรัน migration ใน Supabase SQL Editor ก่อน lead form จะทำงานได้**

### W2 — Runrate + Handover logic fix
- **heroRunrate:** Hero card ใช้ `getSalesRunrate(outlets)` (exclude expiring M0) แทน `totalRunrate`
- **vs target badge:** เปรียบเทียบ `heroRunrate` vs target (ไม่ใช่ outlets ที่กำลังจะหลุด)
- **Pipeline target:** `tgt` ใน `_renderPipelineList()` connect ไป `getSalesTarget()` จริงแล้ว (ไม่ hardcode 1.6M)
- **Target = 0 state:** แสดง "ยังไม่มี target (TL กรุณาตั้ง)" แทน blank

### W4 — Sales TL View (สร้างใหม่ทั้งหมด)
- **renderSalesTeamview():** แทน KAM delegate ด้วย Sales-specific render
  - Filter `portviewBulkData` ด้วย `tlEmail === email` (TL เห็นทีมตัวเอง, admin เห็นทั้งหมด)
  - Group ออกเป็น repMap → sort by runrate
  - Team hero: runrate ทีม + gap vs team target + progress bar
  - Rep list: Revolut rows แต่ละ rep พร้อม % target indicator สี ok/mid/late
  - Target button: เฉพาะ `sales_tl` / `admin` — trigger `openTargetSetup()` ที่มีอยู่แล้ว
- **Target levels:**
  - `level='sales_team'`, `for_email=tl_email` → team target (Admin ตั้ง)
  - `level='sales'`, `for_email=rep_email` → rep target (TL ตั้ง)
- **`_salesOpenTargetSetup()`:** wrapper เรียก `openTargetSetup('tl'|'admin')` ตาม role

### W5 — UX cleanup
- Save tab: ใช้ class `rest-only` → ซ่อนใน sales-mode อยู่แล้ว ✅ ไม่ต้องแก้
- Nav active: `_salesUpdateNavActive()` อยู่ใน router IIFE แล้ว ✅

---

## งานที่เหลือ — ต้องทำก่อน rollout จริง

### Priority 1: Supabase migration (BLOCKER)
```sql
-- รันใน Supabase SQL Editor:
ALTER TABLE sales_pipeline
  ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'SA'
    CHECK (account_type IN ('SA','MC','Chain'));
```
ไฟล์ครบ: `sql/sales_migration_v360.sql`

### Priority 2: ตั้ง target ใน Supabase
```sql
-- Team target (Admin ตั้ง):
INSERT INTO targets (period, level, for_email, gmv_target)
VALUES ('2026-06', 'sales_team', 'tao@freshket.co', 3000000)
ON CONFLICT (period, level, for_email) DO UPDATE SET gmv_target = EXCLUDED.gmv_target;

-- Rep target (TL ตั้งผ่าน app หรือ direct INSERT):
INSERT INTO targets (period, level, for_email, gmv_target)
VALUES ('2026-06', 'sales', 'malisa.c@freshket.co', 600000)
ON CONFLICT (period, level, for_email) DO UPDATE SET gmv_target = EXCLUDED.gmv_target;
```

### Priority 3: ทดสอบ (login Guitar = malisa.c@freshket.co)
| จุด | ตรวจอะไร |
|-----|---------|
| พอร์ต screen | Hero แสดง heroRunrate (exclude expiring M0), progress bar vs target |
| Handover section | ซ่อนถ้าไม่มีร้าน ≤14d |
| Pipeline screen | Gap bar ใช้ target จริง (ไม่ใช่ 1.6M hardcode) |
| เพิ่ม Lead | type selector 3 ปุ่ม toggle ถูกต้อง, บันทึกแล้ว pill โผล่ |
| TL login | Hero ทีม + rep list + target btn |

### Priority 4: W3 Target assignment UI ใน app
- `openTargetSetup('tl')` เมื่อ Sales TL กด "ตั้ง Target" — ต้องตรวจว่า sheet body render รายการ Sales rep (ไม่ใช่ KAM)
- อาจต้องแก้ `renderTargetSheetBody()` ใน `07a_commission_engine.js` ให้รองรับ role='sales_tl'

### Priority 5: _salesTLDrillRep() — drill into individual rep
- ตอนนี้เป็น no-op placeholder
- Full impl: filter portview + navigate + render single-rep portview

---

## CSS tokens (unchanged — ยังใช้ของเดิม)
```css
--ac: #FF385C   /* rausch — CTA, active, urgency */
--ok: #34C759   /* positive */
--warn: #FF9500 /* caution */
canvas: #FFFFFF  /* white bg */
```

## Files changed v360
| File | สิ่งที่เปลี่ยน |
|------|--------------|
| `src/10_sales_view.js` | W1+W2+W4+W5 — pipeline type, heroRunrate, TL view |
| `src/styles_sales.css` | type selector CSS, TL target btn, lead type pill |
| `sw.js` | v360 cache bump |
| `index.html` | rebuilt v360 |
| `sql/sales_migration_v360.sql` | Supabase ALTER TABLE migration |

## Session หน้า: เริ่มที่ไหน
1. รัน `sql/sales_migration_v360.sql` ใน Supabase
2. Login Guitar → ทดสอบทุก touch point ตาม Priority 3
3. ถ้า openTargetSetup('tl') แสดง KAM list → แก้ renderTargetSheetBody() ใน W3
4. impl _salesTLDrillRep() ถ้าต้องการ drill per rep
