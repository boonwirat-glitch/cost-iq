# Handoff — 2026-06-23 — Portfolio Views (Final State)

## สถานะปัจจุบัน (ณ สิ้น session)

### VP view ✅ stable
- file: `sql/q2_2026_movement_vp_view.sql`
- validated C1–C6 ✅
- logic: v9–v13 + cohort_month fix + new_sales fallback exp_date ใน Q
- ไม่ได้แตะใน session นี้ — ยังขาด sync บาง fixes จาก KAM (effective_prev, [6b])

### KAM view ✅ validated (ground truth)
- file: `sql/q2_2026_movement_kam_view.sql`
- C1–C6 ✅ validated หลาย rounds
- มี fixes ครบที่สุด: effective_prev_owner, [6b], cohort_month, mar_sale_owner, LEG B EXISTS
- ใช้เป็น reference สำหรับ PM/ADMIN session หน้า

### PM view ⚠️ reverted
- file: `sql/q2_2026_movement_pm_view.sql`
- reverted กลับไป commit `d2589aac9ffd`
- สถานะ: before full rebuild — movement ถูกต้อง แต่ยังขาด KAM fixes ใหม่
- ต้อง: re-run validate + sync KAM fixes session หน้า

### ADMIN view ⚠️ reverted
- file: `sql/q2_2026_movement_admin_view.sql`
- reverted กลับไป commit `be45d29bbb65`
- สถานะ: before full rebuild — movement ถูกต้อง แต่ยังขาด KAM fixes ใหม่
- ต้อง: re-run validate + sync KAM fixes session หน้า

---

## Logic ที่ lock ใน session นี้ (KAM view มีครบ)

### 1. effective_prev_owner
```sql
COALESCE(
  CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
       ELSE po.prev_owner END,
  'SALE'
)
```
- SALE→ADMIN→KAM chain → origin = SALE → new_sales ✅
- outlet ไม่มี prev order → default = SALE ✅

### 2. new_sales [6b] — Foodium case
```sql
WHEN ofd.first_dollar_date >= '2026-04-01'
  AND COALESCE(effective_prev, 'SALE') = 'SALE'
  AND oed.new_user_exp_date IS NULL
THEN 'new_sales'
```
outlet ใหม่ SALE สร้างใน Q ไม่มี exp_date formal

### 3. expansion = fd_owner เป็น portfolio เท่านั้น
- fd_owner = SALE → ไม่ใช่ expansion → new_sales

### 4. cohort_month
```sql
CASE
  WHEN mc.outlet_id IS NOT NULL THEN '2026-03'
  WHEN FORMAT_DATE exp_date IN Q THEN FORMAT_DATE exp_date
  WHEN first_portfolio IS NOT NULL THEN FORMAT_DATE first_portfolio
  ELSE NULL
END
```

### 5. base_portfolio/base_staff_owner สำหรับ new_sales fallback
- base_portfolio = 'SALE'
- base_staff_owner = SALE staff จาก `mar_sale_owner` CTE

### 6. LEG B — EXISTS check (KAM only ตอนนี้)
```sql
WHERE NOT EXISTS (
  SELECT 1 FROM dwh.order WHERE ... commercial_owner = '[PORTFOLIO]'
)
```
ป้องกัน duplicate เมื่อ outlet มี order จากหลาย portfolio ใน Q

---

## งานที่ต้องทำ Session หน้า (ลำดับสำคัญ)

### 1. Sync PM/ADMIN จาก KAM (clean clone)
Clone KAM view ที่ validated แล้ว → เปลี่ยน keyword → validate C1–C6
**อย่า patch ทีละจุด — ต้อง clone เท่านั้น**

fixes ที่ต้อง sync:
- effective_prev_owner (ทุก handover/new_sales/comeback CASE)
- new_sales [6b] (first_dollar >= Apr + no exp_date)
- cohort_month ใช้ first_portfolio_date
- base_portfolio = 'SALE' + mar_sale_owner CTE
- LEG B EXISTS check

### 2. Sync VP view
VP มี structure ต่างจาก portfolio views — patch แยก ไม่ clone
fixes ที่ต้อง sync:
- effective_prev_owner
- new_sales [6b]
- cohort_month
- base_portfolio = 'SALE' + mar_sale_owner CTE

### 3. Validate PM/ADMIN หลัง sync
C1–C6 ทุก view + spot check movements

### 4. C7/C8 cross-portfolio verify
ต้องการ CSV ทั้ง 4 view run วันเดียวกัน
- C7: KAM+PM+ADMIN base_gmv = VP mar_cohort (187.3M)
- C8: transfer_in inter = transfer_out inter net = 0

### 5. Rep-level view
`sql/q2_2026_movement_rep_view.sql`

### 6. Reconcile กับ v5

---

## Known Issues (ยอมรับ)

| outlet | ปัญหา | impact |
|---|---|---|
| 246875 (Mellow Steak) | unclassified May/Jun | curr=0 |
| ครัวลิน (84390) | transfer_out 2 rows | เล็กน้อย |

---

## SQL Files (current state)

| ไฟล์ | commit | สถานะ |
|---|---|---|
| `sql/q2_2026_movement_vp_view.sql` | `fecb6343af85`+ | ✅ validated — ขาด effective_prev/[6b] |
| `sql/q2_2026_movement_kam_view.sql` | `3b6f83d159d2`+ | ✅ ground truth — fixes ครบ |
| `sql/q2_2026_movement_pm_view.sql` | `d2589aac9ffd` (reverted) | ⚠️ stable แต่ขาด KAM fixes |
| `sql/q2_2026_movement_admin_view.sql` | `be45d29bbb65` (reverted) | ⚠️ stable แต่ขาด KAM fixes |
| `sql/quarterly_nrr_2026_Q2_v5.sql` | — | ⚠️ ยังไม่ reconcile |

---

## Data Reference

**Portfolio GMV Apr:**
- KAM: 131,727,467 | PM: 21,225,836 | ADMIN: 24,361,976 | Total: 177,315,279

**Mar cohort base:**
- KAM: 136.89M (2,697) | PM: 22.84M (734) | ADMIN: 25.81M (2,120) | VP: 187.3M (5,575)

**Jun data:** ถึง Jun 22 (run Jun 23) = 22 วัน
