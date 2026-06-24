# Master Movement Table — Design Spec v7
**วันที่:** 2026-06-24 (อัปเดตรอบหก — session all 4 views complete)
**สถานะ:** KAM ✅ PM ✅ ADMIN ✅ VP ✅ — C1–C8 validated ทั้งหมด

---

## หลักการตั้งต้น

- Single source of truth จาก `dwh.order`
- `commercial_owner` ผูกกับ order — ต้องดูจาก order เสมอ
- `dim.user_master` ห้ามใช้ — current snapshot เท่านั้น
- ชื่อร้านใช้ `cdp_res_name` / `cdp_account_name` เท่านั้น

---

## Scope

| Portfolio | นับ | หมายเหตุ |
|---|---|---|
| KAM | ✅ | |
| PM | ✅ | |
| ADMIN | ✅ | |
| SALE | ❌ | acquisition channel — นับแยก |
| B2C/Enduser | ❌ | |

filter ทุก CTE: `account_type NOT IN ('Consumer','Enduser','Exclude','TEST')`

---

## Classification Priority (ทุก level — FINAL v7)

```
[1] core_nrr      : อยู่ใน mar_cohort
[2] expansion     : first_dollar_date >= Apr
                    AND first_portfolio_date >= Apr
                    AND first_dollar_owner IN (KAM/PM/ADMIN) — ห้ามเป็น SALE
                    AND ไม่มี exp_date ใน Q
[3] handover      : exp_date = March AND effective_prev = SALE
[4] new_sales     : exp_date ใน Q (Apr/May/Jun) AND effective_prev = SALE
[5] new_sales     : first_portfolio >= Apr + exp_date ใน Q + effective_prev = SALE (fallback A)
[6] new_sales     : first_dollar >= Apr + effective_prev = SALE + no exp_date (Foodium [6b])
[7] Scenario D    : Mar GMV มี + first_portfolio ใน Q + effective_prev = SALE + exp_date ก่อน/ไม่มี Q
[8] transfer_in   : (portfolio level เท่านั้น) มาจาก portfolio อื่นใน Q
[9] comeback      : first_dollar < Apr AND Mar GMV = 0 (ทุก owner) AND ไม่ผ่าน [1]-[7]
[10] transfer_out : (portfolio level) ออกไป portfolio อื่นหรือ SALE
[11] unclassified : ELSE — ต้อง = 0
```

---

## effective_prev_owner (LOCKED)

```sql
COALESCE(
  CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
       ELSE po.prev_owner END,
  'SALE'
) = 'SALE'
```

เหตุผล: outlet chain SALE→ADMIN→KAM ใน Q เดียวกัน
- `po.prev_owner` = ADMIN (last owner ก่อน KAM)
- แต่ `first_dollar_owner = SALE` → origin คือ SALE → new_sales ✅

---

## Mar Cohort (LOCKED v5)

outlet อยู่ใน mar_cohort ถ้า:
1. Mar last order = portfolio (KAM/PM/ADMIN ตาม view) **หรือ**
2. Mar last order = SALE แต่ `first_portfolio_date < Apr` (SALE spot)

exclude: outlet ที่มี `exp_date ใน Q + effective_prev = SALE` → เป็น handover/new_sales แทน

---

## mar_handover_outlets

**Portfolio view:** exclude `exp_date = March` + `prev = SALE`
**VP view:** exclude `exp_date IN Q ทั้งหมด (Mar/Apr/May/Jun)` + `prev = SALE`
(VP กว้างกว่าเพราะมองทุก portfolio รวมกัน)

---

## curr_gmv vs base_gmv

- **curr_gmv (portfolio)** = SUM(gmv_ex_vat) WHERE `commercial_owner = '[PORTFOLIO]'`
- **curr_gmv (VP)** = SUM(gmv_ex_vat) WHERE `commercial_owner IN ('KAM','PM','ADMIN')`
- **base_gmv** = SUM(gmv_ex_vat) ทุก order ใน March — ไม่ filter commercial_owner
- **transfer_out curr_gmv** = 0 เสมอ

---

## base_portfolio / base_staff_owner (LOCKED v7)

```sql
CASE
  WHEN FORMAT_DATE('%Y-%m', exp_date) IN ('2026-03','2026-04','2026-05','2026-06')
       AND effective_prev = 'SALE'
       THEN 'SALE'  -- handover + new_sales
  ELSE COALESCE(mc.base_portfolio, [month_alias].commercial_owner)
END
```

| movement | base_portfolio | base_staff_owner |
|---|---|---|
| core_nrr | mc.base_portfolio | mc.base_staff_owner |
| handover/new_sales | 'SALE' | SALE staff จาก mar_sale_owner CTE |
| expansion/comeback | COALESCE(mc.base_portfolio, ao.commercial_owner) | COALESCE(mc.base_staff_owner, ao.staff_owner) |
| transfer_in | pamc.mar_portfolio | pamc staff |
| transfer_out | mc.base_portfolio | mc.base_staff_owner |

---

## cohort_month (LOCKED v7)

```sql
CASE
  WHEN mc.outlet_id IS NOT NULL THEN '2026-03'
  WHEN FORMAT_DATE('%Y-%m', exp_date) IN ('2026-03','2026-04','2026-05','2026-06')
       THEN FORMAT_DATE('%Y-%m', exp_date)
  WHEN first_portfolio_date IS NOT NULL
       THEN FORMAT_DATE('%Y-%m', first_portfolio_date)
  ELSE NULL
END
```

ข้อผิดพลาดที่พบและแก้ใน session นี้:
- May/Jun เดิมใช้ `WHEN exp_date IS NOT NULL` → ดึง pre-Q exp_date มาด้วย → cohort ผิด
- fix: เพิ่ม `IN Q months` check ก่อน

---

## LEG Structure

### LEG A — outlet มี portfolio order เดือนนั้น
- `WHERE commercial_owner = '[PORTFOLIO]'` (portfolio) หรือ `IN ('KAM','PM','ADMIN')` (VP)

### LEG B — mar_cohort ที่ไม่มี portfolio order เดือนนั้น
- **KAM**: `WHERE NOT EXISTS (ORDER WHERE commercial_owner = 'KAM')` — strict check
- **PM/ADMIN**: `LEFT JOIN ao_pm/ao_admin WHERE IS NULL` — last-order based
- **VP**: `WHERE ao_port.outlet_id IS NULL` — มี portfolio order แต่ออกไป SALE

---

## VP vs Portfolio — ต่างกันโดย design (ไม่ใช่ bug)

| จุด | Portfolio | VP | เหตุผล |
|---|---|---|---|
| transfer inter | transfer_in / transfer_out | core_nrr | VP ไม่สนใจ portfolio boundary |
| mar_handover_outlets scope | = March เท่านั้น | IN Q ทั้งหมด | VP มองทุก portfolio รวมกัน |
| mar_cohort fallback | hardcoded portfolio string | first_dollar_owner | VP ไม่รู้ portfolio ต้องดูจาก data |
| LEG B | NOT EXISTS / LEFT JOIN IS NULL | ao_port IS NULL | design ต่างกัน |

---

## C7/C8 Expected Differences (by design)

**C7 base_gmv:** PORT SUM > VP ประมาณ 2-4M ต่อเดือน
→ transfer_in base_gmv นับใน portfolio แต่ไม่นับใน VP — ถูกต้อง

**C8 curr_gmv:** VP > PORT SUM ประมาณ 0.4-0.6M ต่อเดือน
→ inter-transfer outlets = core_nrr ใน VP แต่ split เป็น transfer_in/out ใน portfolio — ถูกต้อง

---

## Known Accepted Issues

| outlet | ปัญหา | impact | decision |
|---|---|---|---|
| Mala Social สาขาบางรัก | transfer_in Apr ADMIN ก่อน KAM transfer_out May | timing data จริง | ยอมรับ |
| Amatissimo Caffe | ADMIN new_sales vs VP core_nrr | by VP design | ยอมรับ |
| Gojiro ramen | ADMIN new_sales vs VP core_nrr | by VP design | ยอมรับ |
| ครัวนลิน | ติด 3 portfolio พร้อมกัน | data quality issue | flag ให้ ops ตรวจ dwh.order |

---

## SQL Files (current state)

| ไฟล์ | สถานะ | หมายเหตุ |
|---|---|---|
| `sql/q2_2026_movement_kam_view.sql` | ✅ validated C1–C6 | ground truth |
| `sql/q2_2026_movement_pm_view.sql` | ✅ validated C1–C6 | cloned จาก KAM |
| `sql/q2_2026_movement_admin_view.sql` | ✅ validated C1–C6 | cloned จาก KAM |
| `sql/q2_2026_movement_vp_view.sql` | ✅ validated C1–C8 | ต่างจาก portfolio โดย design |
| `sql/quarterly_nrr_2026_Q2_v5.sql` | ⚠️ ยังไม่ reconcile | งาน session หน้า |

---

## งานที่ยังต้องทำ

1. Reconcile กับ `quarterly_nrr_2026_Q2_v5.sql`
2. Rep-level view (`q2_2026_movement_rep_view.sql`)
3. `dim.kam_roster` migration — replace hardcoded UNNEST ใน ~14 SQL files
4. UI integration ใน Freshket Sense QNRR tab
5. NRR% normalization — Jun ÷23×30
