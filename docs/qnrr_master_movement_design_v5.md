# Master Movement Table — Design Spec v5
**วันที่:** 2026-06-23 (อัปเดตรอบสี่ — session portfolio views)
**สถานะ:** VP view validated ✅ | KAM/PM/ADMIN view built ✅ | C7/C8 pending

---

## หลักการตั้งต้น

- Single source of truth จาก `dwh.order`
- `commercial_owner` ผูกกับ order ไม่ใช่ outlet — ต้องดูจาก order เสมอ
- `dim.user_master` ห้ามใช้ — เป็น current snapshot เท่านั้น
- ชื่อร้านใช้ `cdp_res_name` / `cdp_account_name` เท่านั้น (ไม่ใช่ `res_name` / `account_name` จาก order stamp)

---

## Scope

| Portfolio | นับ | หมายเหตุ |
|---|---|---|
| KAM | ✅ | |
| PM | ✅ | |
| ADMIN | ✅ | |
| SALE | ❌ | acquisition channel — นับแยก |
| B2C/Enduser | ❌ | ออกทั้งหมด |

filter ทุก CTE: `account_type NOT IN ('Consumer','Enduser','Exclude','TEST')`

---

## Classification Priority (ทุก level)

```
[1] core_nrr    : อยู่ใน mar_cohort
[2] expansion   : first_dollar_date >= Apr
                  AND first_portfolio_date >= Apr
                  AND first_dollar_owner != SALE
                  AND ไม่มี exp_date ใน Q
[3] handover    : exp_date = March AND prev_owner = SALE
[4] new_sales   : exp_date ใน Q (Apr/May/Jun) AND prev_owner = SALE
                  หรือ first_portfolio_date >= Apr AND prev=SALE AND exp_date ใน Q (fallback)
[5] comeback    : first_dollar_date < Apr AND Mar GMV = 0 (ทุก owner) AND ไม่ผ่าน [1]-[4]
[6] transfer_in : (portfolio level) มาจาก portfolio อื่นใน Q
[7] transfer_out: (portfolio level) ออกไป portfolio อื่นหรือ SALE
[8] unclassified: ELSE
```

---

## 4 Rules Handover/New_Sales (LOCKED)

| เงื่อนไข | movement |
|---|---|
| exp_date = March + prev = SALE | handover |
| exp_date = March + prev ≠ SALE | core_nrr |
| exp_date ใน Q + prev = SALE | new_sales |
| exp_date ใน Q + prev ≠ SALE | transfer_in |

**กฎสำคัญ:**
- `new_user_exp_date` เป็น priority เสมอ — check ก่อน prev_owner
- prev_owner ใช้แค่ verify ว่ามาจาก SALE จริง
- KAM→KAM ต่อให้ exp_date = March ก็ไม่ใช่ handover

---

## prev_owner — นิยาม (LOCKED)

```
prev_owner = commercial_owner ของ order สุดท้าย ก่อน first_portfolio_date
(ข้ามเดือนได้ ไม่จำกัดแค่ March)
```

```sql
outlet_prev_owner AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS prev_owner
  FROM dwh.order o
  JOIN outlet_first_dollar ofd
    ON CAST(o.user_id AS STRING) = ofd.outlet_id
   AND DATE(o.delivery_date) < ofd.first_portfolio_date
  WHERE account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
)
```

---

## Mar Cohort Definition (LOCKED v5)

outlet อยู่ใน mar_cohort ถ้า:
1. **Mar last order = portfolio** (KAM/PM/ADMIN แล้วแต่ view) **หรือ**
2. **Mar last order = SALE แต่ `first_portfolio_date < Apr`** (อยู่พอร์ตมาก่อนแล้ว SALE แค่ spot)

ยกเว้น: outlet ที่มี `exp_date ใน Q + prev = SALE` → exclude ออก → เป็น handover/new_sales แทน

```sql
WHERE (
  mo.commercial_owner = '[PORTFOLIO]'
  OR (
    mo.commercial_owner = 'SALE'
    AND ofd.first_[portfolio]_date IS NOT NULL
    AND ofd.first_[portfolio]_date < '2026-04-01'
  )
)
  AND COALESCE(bg.gmv, 0) > 0
  AND mo.outlet_id NOT IN (SELECT outlet_id FROM mar_handover_outlets)
```

---

## mar_handover_outlets

Exclude outlet ที่มี `exp_date ใน Q ทั้งหมด (Mar/Apr/May/Jun) + prev = SALE` ออกจาก mar_cohort

```sql
-- exp_date ใน Q + prev = SALE
WHERE FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      IN ('2026-03','2026-04','2026-05','2026-06')
  AND po.prev_owner = 'SALE'
UNION DISTINCT
-- ไม่มี prev order (outlet ใหม่)
WHERE FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      IN ('2026-03','2026-04','2026-05','2026-06')
  AND po.outlet_id IS NULL
```

---

## curr_gmv vs base_gmv

- **curr_gmv** = SUM(gmv_ex_vat) WHERE `commercial_owner = '[PORTFOLIO]'` เท่านั้น
- **base_gmv** = SUM(gmv_ex_vat) ทุก order ใน March ไม่ filter commercial_owner
- **transfer_out curr_gmv** = 0 เสมอ

---

## Expansion Conditions (LOCKED v4)

```sql
WHEN ofd.first_dollar_date >= '2026-04-01'
  AND ofd.first_portfolio_date >= '2026-04-01'
  AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
  AND (oed.new_user_exp_date IS NULL
       OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
          NOT IN ('2026-03','2026-04','2026-05','2026-06'))
THEN 'expansion'
```

---

## Comeback Conditions (LOCKED v5)

```sql
WHEN ofd.first_dollar_date < '2026-04-01'
  AND bg.gmv IS NULL  -- ไม่มี Mar GMV จากทุก owner
  AND (oed.new_user_exp_date IS NULL
       OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
          NOT IN ('2026-03','2026-04','2026-05','2026-06')
       OR COALESCE(po.prev_owner,'') != 'SALE')
THEN 'comeback'
```

**สำคัญ:** outlet ที่ exp_date ก่อน Q + ไม่มี Mar GMV + PM/KAM/ADMIN รับใน Q → **comeback** ไม่ใช่ new_sales

---

## New_Sales Fallback (LOCKED v5)

```sql
-- fallback: first_portfolio ใน Q + prev=SALE + exp_date ใน Q เท่านั้น
WHEN ofd.first_portfolio_date >= '2026-04-01'
  AND COALESCE(po.prev_owner, '') = 'SALE'
  AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      IN ('2026-04','2026-05','2026-06')
THEN 'new_sales'
```

**ไม่รวม March** เพราะ handover CASE จับก่อนแล้ว
**ต้องมี exp_date ใน Q** — ถ้า exp_date ก่อน Q หรือไม่มี → ตกไป comeback

---

## ~~Scenario D~~ (OBSOLETE — ลบออกแล้ว)

เดิม: Mar GMV มี (SALE spot) + first_portfolio ใน Q + prev=SALE → new_sales
**ยกเลิก** เพราะ fallback new_sales เพิ่ม exp_date ใน Q check ครอบแล้ว และ outlet ที่ exp_date ก่อน Q ควรเป็น comeback

---

## LEG Structure

### LEG A — outlet มี portfolio order เดือนนั้น
- filter `WHERE ao.commercial_owner = '[PORTFOLIO]'`
- `current_portfolio = ao.commercial_owner` (ไม่ hardcode)
- ดู classification จาก mar_cohort + CASE priority

### LEG B — mar_cohort ที่ไม่มี portfolio order เดือนนั้น
- `base_portfolio = mc.base_portfolio` (ไม่ hardcode)
- `current_portfolio = COALESCE(ao_port.commercial_owner, ao_sale.commercial_owner, mc.base_portfolio)`
- transfer_out: ย้ายไป portfolio อื่น (inter) หรือ SALE (external)
- core_nrr (curr_gmv=0): ยังอยู่พอร์ตแต่ไม่สั่ง

---

## Portfolio Level — Architecture

### Mar cohort แยกตาม portfolio
- KAM mar_cohort = last Mar = 'KAM' หรือ SALE spot + first_kam_date < Apr
- PM mar_cohort = last Mar = 'PM' หรือ SALE spot + first_pm_date < Apr
- ADMIN mar_cohort = last Mar = 'ADMIN' หรือ SALE spot + first_admin_date < Apr

### Transfer scope
- `inter` = ย้ายข้ามพอร์ต KAM↔PM↔ADMIN
- `external` = ออกไป SALE

### Detect transfer_in
แต่ละ portfolio view มี CTE เพิ่มเติม:
- KAM view: `pm_admin_mar_cohort` — detect outlet มาจาก PM/ADMIN
- PM view: `kam_admin_mar_cohort` — detect outlet มาจาก KAM/ADMIN
- ADMIN view: `kam_pm_mar_cohort` — detect outlet มาจาก KAM/PM

---

## Output Columns (ทุก view เหมือนกัน)

```
period_month, movement_type, transfer_scope,
current_portfolio, current_staff_owner,
base_portfolio, base_staff_owner,
outlet_id, account_id, account_name, res_name, account_type,
cohort_month, curr_gmv, base_gmv, base_days, curr_days,
first_dollar_date, first_portfolio_date, first_dollar_owner, new_user_exp_date
```

**หมายเหตุ:** `account_name` และ `res_name` ใช้ `cdp_account_name` / `cdp_res_name` จาก dwh.order

---

## Reconcile Checks

### VP level (C1-C6) — ✅ validated
- C1: GMV ตรง dwh.order (diff < 1K = rounding)
- C2: transfer_in = 0 (inter หักล้างกัน)
- C3: transfer_out scope = external only
- C4: no duplicate outlet per month
- C5: label lock
- C6: unclassified = 0 (ยกเว้น outlet 246875 ยอมรับ)

### Portfolio level (C1-C8) — KAM ✅ validated
- C1: curr_gmv ตรง dwh.order WHERE commercial_owner = '[PORTFOLIO]'
  - diff ที่เป็นลบ by design = GMV ของ transfer_out outlets
- C2: transfer_in scope = inter ทุก row
- C3: transfer_out curr_gmv = 0
- C4: no duplicate
- C5: label lock
- C6: unclassified = 0
- **C7**: KAM+PM+ADMIN base_gmv = VP mar_cohort base — **pending**
- **C8**: SUM(transfer_in) = SUM(transfer_out inter) across 3 portfolios — **pending**

---

## Known Accepted Issues

| outlet | ปัญหา | impact | decision |
|---|---|---|---|
| 246875 (Mellow Steak) | unclassified May/Jun — LEG C regression revert | curr_gmv=0 | ยอมรับ |
| ครัวลิน (84390) | transfer_out 2 rows (ADMIN+SALE) | กระทบน้อย | ยอมรับ |

---

## SQL Files (current state)

| ไฟล์ | version | สถานะ |
|---|---|---|
| `sql/q2_2026_movement_vp_view.sql` | v13+ | ✅ validated C1–C6 |
| `sql/q2_2026_movement_kam_view.sql` | v5+ | ✅ validated C1–C6 |
| `sql/q2_2026_movement_pm_view.sql` | latest | ⚠️ run แล้ว C1 ผ่าน รอ re-run หลัง fixes |
| `sql/q2_2026_movement_admin_view.sql` | latest | ⚠️ run แล้ว C1 ผ่าน รอ re-run หลัง fixes |
| `sql/quarterly_nrr_2026_Q2_v5.sql` | v5 | ⚠️ stable แต่ยังไม่ reconcile |

---

## งานที่ยังต้องทำ (session หน้า)

1. **Re-run PM/ADMIN view** หลัง fixes ล่าสุด verify C1–C6
2. **C7/C8 verify** — KAM+PM+ADMIN รวม = VP view
3. **Rep-level view** — `q2_2026_movement_rep_view.sql` (derive จาก portfolio + staff_owner)
4. **Reconcile กับ v5** — `quarterly_nrr_2026_Q2_v5.sql`
5. **dim.kam_roster migration** — replace hardcoded UNNEST arrays ใน 14 SQL files
6. **UI integration** — นำ portfolio view ไปใช้ใน Freshket Sense

---

## Data Notes

- Jun normalization: data ถึง Jun 22 (run Jun 23) — ÷21 วัน ไม่ใช่ ÷20
- outlet ที่มีหลาย user_id = เปลี่ยนชื่อร้าน — ใช้ MIN(first_dollar_date) เสมอ
- SALE spot order ใน Mar ไม่ทำให้ outlet ออกจาก portfolio cohort ถ้า first_portfolio_date < Apr
