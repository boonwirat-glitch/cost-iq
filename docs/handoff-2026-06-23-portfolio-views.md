# Handoff — 2026-06-23 — Portfolio Views Session (v2 final)

## สถานะปัจจุบัน

### VP view ✅
- file: `sql/q2_2026_movement_vp_view.sql`
- validated C1–C6 ✅
- logic sync กับ portfolio views แล้วบางส่วน — ยังต้อง sync effective_prev_owner, [6b], cohort_month

### KAM view ✅ validated (latest)
- file: `sql/q2_2026_movement_kam_view.sql`
- C1–C6 ✅ (validated หลาย rounds)
- เป็น ground truth สำหรับ clone PM/ADMIN

### PM view ⚠️ รอ re-run
- file: `sql/q2_2026_movement_pm_view.sql`
- cloned จาก KAM view ล่าสุด + fixes
- ยังไม่ได้ validate หลัง clone ใหม่

### ADMIN view ⚠️ รอ re-run
- file: `sql/q2_2026_movement_admin_view.sql`
- พบ C4 duplicate 5,141 rows → แก้แล้ว (EXISTS check)
- ยังต้อง re-run validate

---

## Logic ที่ Lock ใหม่ใน Session นี้ (เพิ่มจาก v2)

### 1. effective_prev_owner — ดู origin ของ outlet
```sql
COALESCE(
  CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
       ELSE po.prev_owner END,
  'SALE'
) = 'SALE'
```
- SALE→ADMIN→KAM chain: `first_dollar_owner = 'SALE'` → ถือว่า origin = SALE → new_sales ✅
- ป้องกัน SALE→ADMIN→KAM classify ผิดเป็น transfer_in

### 2. new_sales [6b] — outlet ใหม่ใน Q (Foodium case)
```sql
WHEN ofd.first_dollar_date >= '2026-04-01'
  AND COALESCE(effective_prev, 'SALE') = 'SALE'
  AND oed.new_user_exp_date IS NULL
THEN 'new_sales'
```
- outlet ที่ SALE สร้างใน Q โดยไม่มี exp_date formal
- ต้องอยู่ก่อน comeback ใน priority

### 3. new_sales fallback [5] COALESCE default = 'SALE'
```sql
AND COALESCE(effective_prev, 'SALE') = 'SALE'
AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
    IN ('2026-04','2026-05','2026-06')
```
- outlet ไม่มี prev order → ถือว่ามาจาก SALE
- ต้องมี exp_date ใน Q (Apr/May/Jun ไม่มี Mar)

### 4. base_portfolio สำหรับ new_sales fallback = 'SALE'
- outlet ที่ SALE ส่งมาในไตรมาส → base_portfolio = 'SALE'
- base_staff_owner = SALE staff จาก `mar_sale_owner` CTE

### 5. cohort_month logic (updated)
```sql
CASE
  WHEN mc.outlet_id IS NOT NULL THEN '2026-03'
  WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
       IN ('2026-03','2026-04','2026-05','2026-06')
       THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
  WHEN ofd.first_portfolio_date IS NOT NULL
       THEN FORMAT_DATE('%Y-%m', ofd.first_portfolio_date)
  ELSE NULL
END
```
- exp_date ก่อน Q → ใช้ first_portfolio_date เป็น cohort

### 6. LEG B duplicate fix — EXISTS check
```sql
WHERE NOT EXISTS (
  SELECT 1 FROM dwh.order o CROSS JOIN params p
  WHERE CAST(o.user_id AS STRING) = mc.outlet_id
    AND DATE(o.delivery_date) BETWEEN p.[period]_start AND p.[period]_end
    AND UPPER(TRIM(o.commercial_owner)) = '[PORTFOLIO]'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
)
```
- ป้องกัน duplicate เมื่อ outlet มี order จากหลาย portfolio ใน Q เดียวกัน
- แทน JOIN + WHERE IS NULL ที่ขึ้นกับ QUALIFY last order

### 7. expansion = fd_owner เป็น portfolio เท่านั้น (LOCKED)
- expansion: fd_owner IN (KAM, PM, ADMIN)
- new_sales: fd_owner = SALE

---

## CTEs ที่เพิ่มใหม่

### mar_sale_owner
```sql
mar_sale_owner AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
    TRIM(o.staff_owner) AS sale_staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS sale_owner
  FROM dwh.order o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND UPPER(TRIM(o.commercial_owner)) = 'SALE'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
)
```
ใช้สำหรับ base_staff_owner ของ new_sales fallback

---

## งานที่ต้องทำใน Session หน้า

### Priority 1 — Re-run & validate PM/ADMIN
```
1. Run sql/q2_2026_movement_pm_view.sql → upload CSV → verify C1–C6
2. Run sql/q2_2026_movement_admin_view.sql → upload CSV → verify C1–C6
```

### Priority 2 — Sync VP view
VP view ยังขาด fixes ต่อไปนี้จาก KAM view:
- effective_prev_owner (`first_dollar_owner` logic)
- new_sales [6b] (Foodium case)
- cohort_month ใช้ first_portfolio_date
- base_portfolio = 'SALE' สำหรับ fallback
- base_staff_owner จาก mar_sale_owner CTE
- LEG B EXISTS check (VP ใช้ structure ต่างกัน — ต้องดูแยก)

### Priority 3 — C7/C8 cross-portfolio verify
```
C7: KAM base + PM base + ADMIN base = VP mar_cohort (187.3M)
C8: SUM(transfer_in inter) = SUM(transfer_out inter) across 3 portfolios
```
ต้องการ CSV ทั้ง 4 view run วันเดียวกัน

### Priority 4 — Rep-level view
`sql/q2_2026_movement_rep_view.sql` — derive จาก portfolio + staff_owner dimension

### Priority 5 — Reconcile กับ v5

---

## Known Issues (ยังเหลือ)

| ปัญหา | view | impact | status |
|---|---|---|---|
| outlet 246875 (Mellow Steak) unclassified | ทุก view | curr=0 | ยอมรับ |
| ครัวลิน transfer_out 2 rows | KAM | เล็กน้อย | ยอมรับ |
| Suspicious new_sales (exp ก่อน Q) | ADMIN | ต้องตรวจ | pending |
| base_portfolio blank บาง rows | ADMIN | ต้องตรวจ | pending |

---

## SQL Files (current state)

| ไฟล์ | สถานะ |
|---|---|
| `sql/q2_2026_movement_vp_view.sql` | ✅ C1–C6 แต่ยังขาด sync บาง fixes |
| `sql/q2_2026_movement_kam_view.sql` | ✅ validated — ground truth |
| `sql/q2_2026_movement_pm_view.sql` | ⚠️ rebuilt จาก KAM รอ validate |
| `sql/q2_2026_movement_admin_view.sql` | ⚠️ rebuilt + LEG B fix รอ validate |
| `sql/quarterly_nrr_2026_Q2_v5.sql` | ⚠️ ยังไม่ reconcile |

---

## Data Reference

**Portfolio GMV Apr (from dwh.order):**
- KAM: 131,727,467
- PM: 21,225,836
- ADMIN: 24,361,976
- Total: 177,315,279 ✅

**KAM Mar cohort base:** 136.89M (2,697 outlets)
**PM Mar cohort base:** 22.84M (734 outlets)
**ADMIN Mar cohort base:** 25.81M (2,120 outlets)
**VP Mar cohort base:** 187.3M (5,575 outlets)

**Jun data:** ถึง Jun 22 (run Jun 23) = 22 วัน
