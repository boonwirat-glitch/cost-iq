# Master Movement Table — Design Spec v6
**วันที่:** 2026-06-23 (อัปเดตรอบห้า — session portfolio views ตอนปลาย)
**สถานะ:** KAM validated ✅ | PM/ADMIN rebuilt ⚠️ รอ validate | VP partial sync

---

## หลักการตั้งต้น

- Single source of truth จาก `dwh.order`
- `commercial_owner` ผูกกับ order — ต้องดูจาก order เสมอ
- `dim.user_master` ห้ามใช้ — current snapshot เท่านั้น
- ชื่อร้านใช้ `cdp_res_name` / `cdp_account_name` เท่านั้น
- expansion = fd_owner เป็น portfolio (KAM/PM/ADMIN) เท่านั้น
- new_sales = origin มาจาก SALE

---

## Scope

| Portfolio | นับ |
|---|---|
| KAM | ✅ |
| PM | ✅ |
| ADMIN | ✅ |
| SALE | ❌ acquisition channel |
| B2C/Enduser | ❌ |

filter: `account_type NOT IN ('Consumer','Enduser','Exclude','TEST')`

---

## effective_prev_owner — concept สำคัญ (NEW v6)

ไม่ใช้แค่ `po.prev_owner` แต่ดู **origin** ของ outlet:

```sql
COALESCE(
  CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
       ELSE po.prev_owner END,
  'SALE'
) = 'SALE'
```

เหตุผล: outlet ที่ chain SALE→ADMIN→KAM ใน Q เดียวกัน
- `po.prev_owner` จะได้ ADMIN (last owner ก่อน KAM)
- แต่ `first_dollar_owner = SALE` → origin คือ SALE → new_sales ✅

---

## Classification Priority (ทุก level — FINAL v6)

```
[1] core_nrr      : อยู่ใน mar_cohort
[2] expansion     : first_dollar >= Apr AND first_portfolio >= Apr
                    AND first_dollar_owner IN (KAM/PM/ADMIN)
                    AND ไม่มี exp_date ใน Q
[3] handover      : exp_date = March AND effective_prev = SALE
[4] new_sales     : exp_date ใน Q (Apr/May/Jun) AND effective_prev = SALE
[5] new_sales     : first_portfolio >= Apr AND effective_prev = SALE
    fallback A      AND exp_date ใน Q (Apr/May/Jun)
[6] new_sales     : first_dollar >= Apr AND effective_prev = SALE
    fallback B      AND new_user_exp_date IS NULL  ← Foodium case
    (NEW v6)
[7] transfer_in   : outlet อยู่ใน portfolio อื่น Mar_cohort แต่ portfolio นี้รับใน Q
[8] comeback      : first_dollar < Apr AND Mar GMV = 0 (ทุก owner)
[9] unclassified  : ELSE
```

**กฎ expansion:** `first_dollar_owner` ต้องเป็น KAM/PM/ADMIN — ถ้าเป็น SALE → ตกไป new_sales

---

## Mar Cohort (LOCKED v5 — ไม่เปลี่ยน)

outlet อยู่ใน mar_cohort ถ้า:
1. Mar last order = portfolio หรือ
2. Mar last order = SALE แต่ first_portfolio < Apr (SALE spot)

exclude: exp_date ใน Q + effective_prev = SALE

---

## mar_handover_outlets (LOCKED)

exclude outlet ที่ exp_date ใน Q ทั้งหมด (Mar/Apr/May/Jun) + effective_prev = SALE

---

## New_Sales Fallback Rules (v6 — FINAL)

| Case | เงื่อนไข | movement |
|---|---|---|
| Normal [4] | exp_date ใน Q + effective_prev = SALE | new_sales |
| Fallback A [5] | first_portfolio >= Apr + exp_date ใน Q + effective_prev = SALE | new_sales |
| Fallback B [6] | first_dollar >= Apr + effective_prev = SALE + no exp_date | new_sales |
| Pre-Q exp | exp_date ก่อน Q + first_portfolio >= Apr + effective_prev = SALE | new_sales (cohort = first_portfolio_date) |

**ห้ามใช้:** `COALESCE(po.prev_owner, '')` = 'SALE' ใน fallback — ต้องใช้ effective_prev

---

## Comeback (LOCKED v5)

```sql
WHEN ofd.first_dollar_date < '2026-04-01'
  AND bg.gmv IS NULL  -- ไม่มี Mar GMV ทุก owner
  AND (no exp_date ใน Q OR effective_prev != SALE)
THEN 'comeback'
```

---

## base_portfolio / base_staff_owner Rules (v6)

| movement | base_portfolio | base_staff_owner |
|---|---|---|
| core_nrr | mc.base_portfolio | mc.base_staff_owner |
| handover/new_sales (exp_date ใน Q) | 'SALE' | SALE staff จาก mar_sale_owner |
| new_sales fallback | 'SALE' | SALE staff จาก mar_sale_owner |
| expansion | portfolio ปัจจุบัน | portfolio staff |
| comeback | portfolio ปัจจุบัน | portfolio staff |
| transfer_in | pamc.mar_portfolio | pamc staff |
| transfer_out | mc.base_portfolio | mc.base_staff_owner |

---

## cohort_month Rules (v6)

```sql
CASE
  WHEN mc.outlet_id IS NOT NULL THEN '2026-03'
  WHEN FORMAT_DATE('%Y-%m', exp_date) IN Q_MONTHS THEN FORMAT_DATE('%Y-%m', exp_date)
  WHEN first_portfolio IS NOT NULL THEN FORMAT_DATE('%Y-%m', first_portfolio)
  ELSE NULL
END
```

ใช้กับ handover และ new_sales เท่านั้น

---

## LEG Structure (v6 update)

### LEG B — ใช้ EXISTS แทน JOIN
```sql
WHERE NOT EXISTS (
  SELECT 1 FROM dwh.order o CROSS JOIN params p
  WHERE CAST(o.user_id AS STRING) = mc.outlet_id
    AND DATE(o.delivery_date) BETWEEN p.[period]_start AND p.[period]_end
    AND UPPER(TRIM(o.commercial_owner)) = '[PORTFOLIO]'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
)
```

เหตุผล: QUALIFY last order อาจไม่ใช่ portfolio → JOIN miss → duplicate rows

---

## Transfer Detection

### transfer_in (portfolio level)
- KAM view: `pm_admin_mar_cohort` — detect outlet มาจาก PM/ADMIN
- PM view: `kam_admin_mar_cohort` — detect outlet มาจาก KAM/ADMIN
- ADMIN view: `kam_pm_mar_cohort` — detect outlet มาจาก KAM/PM

### transfer scope
- `inter` = ย้ายข้ามพอร์ต
- `external` = ออกไป SALE

---

## Output Columns (ทุก view เหมือนกัน)

```
period_month, movement_type, transfer_scope,
current_portfolio, current_staff_owner,
base_portfolio, base_staff_owner,
outlet_id, account_id, account_name (cdp), res_name (cdp), account_type,
cohort_month, curr_gmv, base_gmv, base_days, curr_days,
first_dollar_date, first_portfolio_date, first_dollar_owner, new_user_exp_date
```

---

## Reconcile Checks

### VP level C1–C6 ✅ validated
### Portfolio level C1–C6

KAM ✅ validated
PM/ADMIN ⚠️ รอ re-run หลัง latest fixes

### C7/C8 — pending
- C7: KAM+PM+ADMIN base_gmv = VP mar_cohort (187.3M)
- C8: transfer_in inter = transfer_out inter across 3 portfolios = 0

---

## Known Accepted Issues

| outlet | ปัญหา | impact | decision |
|---|---|---|---|
| 246875 | unclassified May/Jun | curr=0 | ยอมรับ |
| ครัวลิน | transfer_out 2 rows | เล็กน้อย | ยอมรับ |

---

## SQL Files

| ไฟล์ | สถานะ |
|---|---|
| `sql/q2_2026_movement_vp_view.sql` | ✅ validated แต่ขาด sync v6 fixes |
| `sql/q2_2026_movement_kam_view.sql` | ✅ ground truth validated |
| `sql/q2_2026_movement_pm_view.sql` | ⚠️ reverted to `d2589aac9ffd` — stable แต่ขาด KAM v6 fixes |
| `sql/q2_2026_movement_admin_view.sql` | ⚠️ reverted to `be45d29bbb65` — stable แต่ขาด KAM v6 fixes |
| `sql/quarterly_nrr_2026_Q2_v5.sql` | ⚠️ ยังไม่ reconcile |

---

## งานที่ต้องทำ Session หน้า

1. Re-run PM/ADMIN → validate C1–C6
2. Sync VP view กับ KAM logic v6
3. C7/C8 cross-portfolio verify
4. Rep-level view
5. Reconcile กับ v5

---

## ⚠️ คำเตือนสำหรับ Session หน้า — PM/ADMIN Rebuild

**ต้อง clone จาก KAM view เท่านั้น** — ห้าม patch ทีละจุด
การ patch ทีละจุดทำให้ keyword เปลี่ยนไม่ครบ เช่น `'KAM'` หลงเหลืออยู่ใน PM/ADMIN view

ขั้นตอน:
1. Fetch KAM view ล่าสุด
2. Replace KAM → PM/ADMIN, first_kam_date → first_pm/admin_date
3. Replace pm_admin_mar_cohort → kam_admin/pm_mar_cohort
4. Replace inter portfolio list
5. Verify ไม่มี 'KAM' หลงเหลือใน non-filter lines
6. Run → validate C1–C6 ก่อน merge
