# QNRR Q2 2026 — Master Movement SQL Design Spec v3
**วันที่:** 2026-06-20
**สถานะ:** Final — validated จาก SQL จริง 2 ตัว ไม่มี unresolved แล้ว
**SQL ที่จะสร้าง:** `sql/q2_2026_master_movements_v3.sql`

---

## ที่มาของ spec นี้

trace logic จาก SQL ที่รันผ่านและ validated จริง 2 ตัว:

| SQL | validated ด้วยอะไร | scope |
|---|---|---|
| `May2026_KAM_portfolio_reconcile.sql` (v8) | รัน BQ + จ่าย commission May จริง | KAM-only, MoM (Apr→May) |
| `quarterly_nrr_2026_Q2_reconcile.sql` | รัน BQ + เทียบ CSV `bquxjob_1e2a7bf` | KAM-only, Q scope counts |

spec v1 และ v2 คิดเอง — มี 3 จุดที่ผิด ได้แก้ทั้งหมดใน v3 นี้

---

## 3 จุดที่ spec เดิมผิด (แก้แล้ว)

### ผิดจุดที่ 1: comeback definition

**spec เดิม:** `pre_mar.commercial_owner = current_portfolio` (dynamic string)
**ที่ถูก (trace จาก reconcile.sql):**
```
comeback = ไม่อยู่ mar_cohort
           + pmo_mar.commercial_owner = ao.commercial_owner  ← เทียบกับ period portfolio
           + new_user_exp_date ไม่อยู่ใน Q
           + curr_gmv > 0
```
extend multi-portfolio: เปลี่ยน `'KAM'` hardcode → `ao.commercial_owner`

### ผิดจุดที่ 2: LEG D ไม่จำเป็น

**spec เดิม:** ต้องมี LEG D แยกสำหรับ handover ที่ churn (ไม่มี order ใน period)
**ที่ถูก:** reconcile.sql ไม่มี LEG D แต่ count handover = 34 ตรง ground truth ทุกกรณี

trace พิสูจน์ว่า:
- handover outlet ที่ไม่มี Apr order → ไม่มีแถวใน Apr output → ถูกต้อง (curr_gmv=0 ไม่กระทบ reconcile)
- handover outlet ที่ไม่มี Apr แต่มี May order → May LEG A fallback จับเป็น handover ✓
- handover outlet ที่ไม่มี Apr/May แต่มี Jun order → Jun new-only block จับเป็น handover ✓

LEG D ใน MoM SQL มีเพื่อ commission calculation (retention=0%) เท่านั้น ไม่ใช่ Q master

### ผิดจุดที่ 3: ห้ามใช้ user_master ทุก LEG

**spec เดิม:** ระบุว่าห้ามใช้ แต่ไม่ได้อธิบาย root cause
**ที่ถูก (trace จาก MoM SQL comment):**
MoM SQL ใช้ `current_kam_snapshot` จาก `dim.user_master` เพื่อแยก churn vs transfer_out สำหรับ silent outlet มี known limitation ที่ comment ไว้ชัดเจน: outlet ที่โอนออก Jun ขณะรัน May backfill จะถูก flag เป็น transfer_out ผิด

Q master ต้องใช้ `period_own` (order-based) แทนทุกกรณี ไม่มียกเว้น

---

## Scope

| portfolio | filter | นับ NRR |
|---|---|---|
| KAM | `commercial_owner = 'KAM'` | ✅ |
| PM | `commercial_owner = 'PM'` | ✅ |
| ADMIN | `commercial_owner = 'ADMIN'` | ✅ |
| SALE | acquisition channel | ❌ |
| B2C/Enduser | ไม่ใช่ B2B | ❌ |

filter ทุก CTE: `account_type NOT IN ('Consumer','Enduser','Exclude','TEST')`

---

## Mar Cohort — Fixed Denominator

```
เงื่อนไข (ทุกข้อต้องครบ):
  commercial_owner IN ('KAM','PM','ADMIN')
  gmv_ex_vat > 0 ใน Mar 2026
  new_user_exp_date IS NULL
    OR FORMAT_DATE('%Y-%m', new_user_exp_date) != '2026-03'
  ไม่ filter staff_owner เลย → รวม departed KAM, blank ทุกคน

columns ที่ต้องการ:
  outlet_id, account_id, account_name, account_type,
  base_portfolio (= commercial_owner ใน Mar),
  base_staff_owner (= staff_owner ใน Mar),
  base_gmv (= Mar GMV),
  first_dollar_date, new_user_exp_date
```

**ทำไม** `new_user_exp_date = Mar` excluded: outlet พวกนี้ GMV ใน Mar ส่วนใหญ่ยังเป็นของ SALE ก่อนโอน → ไม่ใช่ existing customer ที่ KAM/PM/ADMIN ดูแลจริง

---

## Classification Priority — lock แล้ว ลำดับนี้เท่านั้น

ใช้ทุก LEG A ทุกเดือน เรียงลำดับตามนี้เสมอ:

```
[1] expansion
    first_dollar_date >= '2026-04-01'
    AND pmo_period.outlet_id IS NULL
    (pmo_period = last B2B order ก่อน period month นั้น)

    หมายความว่า: outlet ใหม่แท้ที่ไม่เคยมี B2B order ก่อน Q เลย
    ตรวจก่อนเสมอ → ป้องกัน outlet ใหม่ถูก misclassify เป็น handover/new_sales

[2] handover
    FORMAT_DATE('%Y-%m', new_user_exp_date) = '2026-03'
    (ไม่เช็ค pre_mar = SALE — field นี้ set โดย Sales process โดยตรง)
    (ไม่ต้องมี PATH B fallback — reconcile.sql ได้ 34 ด้วย new_user_exp_date เพียงอย่างเดียว)

[3] new_sales
    FORMAT_DATE('%Y-%m', new_user_exp_date) IN ('2026-04','2026-05','2026-06')
    AND (pmo_mar.commercial_owner = 'SALE' OR pmo_mar.outlet_id IS NULL)

    pmo_mar = last B2B order ก่อน Mar (ต่างจาก pmo_period)
    OR IS NULL = ไม่เคยมี B2B order ก่อน Mar เลย (outlet ใหม่ที่ Sales เปิด)

[4] core_nrr / core_nrr_churn
    mc.outlet_id IS NOT NULL
    AND mc.base_portfolio = ao.commercial_owner
    curr_gmv > 0 → core_nrr
    curr_gmv = 0 → core_nrr_churn

[5] transfer_in (from cohort)
    mc.outlet_id IS NOT NULL
    AND mc.base_portfolio != ao.commercial_owner
    (Mar cohort ของ portfolio อื่น โอนเข้ามา)

[6] comeback
    mc.outlet_id IS NULL
    AND pmo_mar.commercial_owner = ao.commercial_owner
    AND (new_user_exp_date IS NULL
         OR FORMAT_DATE('%Y-%m', new_user_exp_date)
            NOT IN ('2026-03','2026-04','2026-05','2026-06'))
    AND curr_gmv > 0

    comeback = เคยอยู่ portfolio เดิมก่อน Q แต่ไม่มี Mar GMV (ไม่อยู่ cohort)
    pmo_mar เช็ค portfolio ไม่ใช่ staff_owner → สำหรับ TL/Admin view

[7] transfer_in (ELSE)
    ทุกอย่างที่เหลือ
```

---

## LEG Structure ทุกเดือน

### LEG A — outlets ที่มี order ใน period month

```sql
FROM [period]_own ao
LEFT JOIN mar_cohort mc   ON ao.outlet_id = mc.outlet_id
LEFT JOIN outlet_first_dollar ofd ON ao.outlet_id = ofd.outlet_id
LEFT JOIN pre_mar_own pmo_mar     ON ao.outlet_id = pmo_mar.outlet_id
LEFT JOIN pre_[period]_own pmo_p  ON ao.outlet_id = pmo_p.outlet_id
LEFT JOIN [period]_gmv pg         ON ao.outlet_id = pg.outlet_id
WHERE ao.commercial_owner IN ('KAM','PM','ADMIN')
```

CASE ใช้ priority [1]→[7] ตามด้านบน

### LEG B — Mar cohort ที่ไม่มี order ใน portfolio เดิม

```sql
FROM mar_cohort mc
LEFT JOIN [period]_own ao_same
  ON mc.outlet_id = ao_same.outlet_id
  AND ao_same.commercial_owner = mc.base_portfolio   ← filter portfolio เดิม
LEFT JOIN [period]_own ao_any
  ON mc.outlet_id = ao_any.outlet_id                 ← ไม่ filter portfolio
WHERE ao_same.outlet_id IS NULL                      ← ไม่มี order ใน portfolio เดิม

CASE movement_type:
  WHEN ao_any.outlet_id IS NULL
    → core_nrr_churn   (ไม่มี order เลยทุก portfolio = เงียบ ยังอยู่พอร์ต)
  WHEN ao_any.commercial_owner NOT IN ('KAM','PM','ADMIN')
    → transfer_out     (โอนออกไป SALE หรืออื่น นอก scope)
  ELSE
    → transfer_out     (โอนไป portfolio อื่นใน scope)

curr_gmv = 0 เสมอ
base_gmv = mc.base_gmv
```

**ทำไม** ต้อง `ao_same` + `ao_any` สองตัว:
- `ao_same`: กรอง "ไม่มีใน portfolio เดิม" → outlet เข้า LEG B
- `ao_any`: ดูว่ายังมี order ไหม (ทุก portfolio) → แยก churn vs transfer_out
- ถ้าใช้ `ao_any` อย่างเดียว: outlet ที่โอน KAM→PM จะไม่เข้า LEG B (มีใน PM)

**ทำไม** ไม่ใช้ `user_master`:
- `dim.user_master` = current snapshot ณ วันรัน SQL
- outlet ที่โอนออก Jun ขณะรัน May → flag ผิดเป็น transfer_out
- `period_own` = order-based snapshot ณ period นั้น → stable ✓

### Carry Forward (May/Jun LEG A fallback)

outlet ที่ไม่อยู่ใน apr_labels ต้องรัน priority [1]→[7] เต็มอีกครั้ง:

```
May LEG A:
  CASE 1: อยู่ใน apr_labels → inherit fixed_label
           (ปรับ core↔churn ตาม may_gmv)
  CASE 2: ไม่อยู่ใน apr_labels → รัน [1]→[7]
           ใช้ pmo_period = pre_may_own (last order ก่อน May)
           ใช้ pmo_mar = pre_mar_own (ใช้กับ handover/new_sales/comeback เสมอ)

Jun LEG A:
  CASE 1: อยู่ใน apr_labels → inherit
  CASE 2: ไม่อยู่ apr แต่อยู่ may_labels → inherit
  CASE 3: ไม่อยู่ทั้งคู่ → รัน [1]→[7]
           ใช้ pmo_period = pre_jun_own
```

**หมายเหตุ:** `pmo_period` และ `pmo_mar` ต่างกัน:
- `pmo_period` = last order ก่อน period month → ใช้สำหรับ expansion check (`IS NULL`)
- `pmo_mar` = last order ก่อน Mar → ใช้สำหรับ new_sales และ comeback เสมอ ทุกเดือน

---

## CTE Architecture

```
params
│
outlet_first_dollar      ← global B2B, MIN(first_dollar_date), ไม่ filter portfolio
│
├── base_gmv             ← Mar GMV, ทุก B2B
├── apr_gmv              ← Apr GMV, ทุก B2B
├── may_gmv              ← May GMV, ทุก B2B
└── jun_gmv              ← Jun GMV, ทุก B2B
│
├── mar_own              ← last order per outlet ใน Mar, ไม่ filter portfolio
├── apr_own              ← last order per outlet ใน Apr, ไม่ filter portfolio
├── may_own              ← last order per outlet ใน May, ไม่ filter portfolio
└── jun_own              ← last order per outlet ใน Jun, ไม่ filter portfolio
│
├── pre_mar_own          ← last order ก่อน 2026-03-01, ทุก B2B
│                          ใช้: new_sales และ comeback ทุกเดือน
│
mar_cohort               ← filter KAM+PM+ADMIN ตรงนี้, fixed ทั้ง Q
│
apr_labels               ← lock classification Apr (KAM+PM+ADMIN outlets ทั้งหมด)
│                          ใช้ pre_mar_own + outlet_first_dollar
│
may_labels               ← lock classification May (สำหรับ Jun inherit)
│                          inherit จาก apr_labels หรือรัน classify ใหม่
│
├── apr_rows             LEG A + LEG B
├── may_rows             LEG A + LEG B
└── jun_rows             LEG A + LEG B
│
all_rows → FINAL SELECT
```

**ไม่มี** `pre_apr_own`, `pre_may_own`, `pre_jun_own` แยก
เพราะ LEG B ใช้ `period_own` (LEFT JOIN สองตัว) แทน ไม่ต้องการ pre_period_own

---

## Reconcile Constraints

```
ต่อ period_month ต่อ portfolio:

[1] GMV reconcile:
    SUM(curr_gmv WHERE movement_type != 'transfer_out')
    = SUM(gmv_ex_vat FROM dwh.order
          WHERE delivery_date IN period
          AND commercial_owner = portfolio
          AND account_type NOT IN 'Consumer','Enduser','Exclude','TEST')

[2] No duplicate outlet per period (ยกเว้น transfer_out):
    SELECT period_month, outlet_id, COUNT(*)
    FROM final WHERE movement_type != 'transfer_out'
    GROUP BY 1,2 HAVING COUNT(*) > 1
    → ต้องได้ 0 rows

[3] KAM cohort ตรง ground truth:
    SELECT period_month, COUNT(*) FROM final
    WHERE base_portfolio = 'KAM'
    AND movement_type IN ('core_nrr','core_nrr_churn')
    GROUP BY 1
    → Apr: ~2,696 outlets (core_nrr + churn รวมกัน)

[4] KAM movement counts ตรง reconcile.sql ground truth:
    | movement    | Apr | May | Jun |
    | comeback    |  75 | 103 |  92 |
    | expansion   |  35 |  92 | 111 |
    | handover    |  34 |  34 |  31 |
    | new_sales   |   6 |  65 |  67 |
    | transfer_in |  43 |  64 |  77 |
    | transfer_out|   1 |   2 |   2 |
```

NRR denominator ต้องมาจาก `mar_cohort` โดยตรงเสมอ ไม่ใช่ `SUM(base_gmv)` จาก master rows (เพราะ outlet inactive 3 เดือนมี base_gmv ซ้ำ 3 rows)

---

## Edge Cases ที่ verified แล้ว

| กรณี | ผลลัพธ์ที่ถูก |
|---|---|
| outlet โอน KAM→PM ใน Apr | LEG A Apr (PM, transfer_in, curr>0) + LEG B KAM (transfer_out, curr=0) |
| outlet โอน KAM→SALE ใน Apr | LEG B KAM (transfer_out, curr=0) เท่านั้น (SALE ไม่อยู่ scope) |
| outlet ไม่มี order Apr เลย | LEG B churn (curr=0) |
| outlet โอน KAM→PM→KAM ใน Q | Apr: transfer_in(PM)+transfer_out(KAM), May: transfer_in(KAM)+transfer_out(PM) |
| outlet inactive ทั้ง Q | 3 rows LEG B churn, curr=0 ทุก row (reconcile ผ่านเพราะ curr=0) |
| outlet ใหม่ expansion + new_user_exp_date ใน Q | [1] expansion ก่อน [2][3] ป้องกัน misclassify |
| handover outlet ไม่มี Apr order แต่มี May order | May LEG A fallback: new_user_exp_date=Mar → handover ✓ |
| handover outlet ไม่มี Apr/May แต่มี Jun order | Jun new-only block: new_user_exp_date=Mar → handover ✓ |
| SALE GMV | ไม่อยู่ใน master — by design |

---

## ความแตกต่าง: portfolio-level vs rep-level

| มิติ | Rep (v5) | Portfolio (master v3) |
|---|---|---|
| transfer_in/out | ข้ามระหว่าง KAM คนนี้ กับ KAM อื่น | ข้ามระหว่าง portfolio type (KAM↔PM, KAM↔ADMIN) |
| การโอนภายใน squad | = transfer (KAM คนเดิม→คนใหม่) | = core_nrr ยังคงอยู่ (ยัง KAM pool) |
| comeback | เคยอยู่กับ KAM คนนี้ pre-Mar | เคยอยู่ใน KAM pool pre-Mar |
| core_nrr | Mar cohort + KAM คนเดิม | Mar cohort + portfolio เดิม ไม่สนว่า staff_owner ใคร |
| staff_owner | สำคัญ (เช็ค kam_name ทุก step) | ไม่สำคัญสำหรับ classification |

---

## Step-by-Step Build Plan

verify หลังทุก step ก่อนเดินหน้า:

```
Step 1: CTEs พื้นฐาน
  params, outlet_first_dollar, [period]_gmv (4 เดือน), [period]_own (4 เดือน), pre_mar_own
  verify: row counts สมเหตุสมผล ไม่มี NULL outlet_id

Step 2: mar_cohort
  verify: KAM ~2,696 outlets / ~136.937M
          PM และ ADMIN = รัน COUNT เทียบ dwh.order โดยตรง

Step 3: apr_labels (KAM+PM+ADMIN)
  verify: KAM movement counts ตรง ground truth ทุก type

Step 4: may_labels
  verify: inherit correct + fallback classify ถูก

Step 5: apr_rows (LEG A + LEG B)
  verify: SUM(curr_gmv ยกเว้น transfer_out) = dwh Apr GMV per portfolio

Step 6: may_rows (LEG A + LEG B)
  verify: SUM(curr_gmv ยกเว้น transfer_out) = dwh May GMV per portfolio

Step 7: jun_rows (LEG A + LEG B)
  verify: SUM(curr_gmv ยกเว้น transfer_out) = dwh Jun GMV per portfolio

Step 8: FINAL SELECT + reconcile check queries
```

---

## Key SQL Principles (จาก codebase)

```sql
-- Join key: dwh.order → dim.user_master (ถ้าจำเป็น)
CAST(o.user_id AS STRING) = um.res_id

-- commercial_owner มาจาก dwh.order ไม่ใช่ dim.user_master

-- Ownership snapshot per outlet per month
QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1

-- Day-1 lag
DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)

-- No temp tables — ใช้ inline UNNEST CTEs

-- ห้ามใช้ dim.user_master ใน LEG ใดเลย
```

---

*spec นี้ validated logic จาก SQL จริง 2 ตัว — พร้อมเขียน SQL v3 ได้ทันที*
*ไฟล์ที่จะสร้าง: `sql/q2_2026_master_movements_v3.sql`*
