# QNRR Q2 2026 — Master Movement SQL Design Spec v3
**วันที่:** 2026-06-20
**สถานะ:** Final — validated จาก SQL จริง 2 ตัว + transfer layer analysis ครบ
**SQL ที่จะสร้าง:** `sql/q2_2026_master_movements_v3.sql`

---

## ที่มาของ spec นี้

trace logic จาก SQL ที่รันผ่านและ validated จริง 2 ตัว:

| SQL | validated ด้วยอะไร | scope |
|---|---|---|
| `May2026_KAM_portfolio_reconcile.sql` (v8) | รัน BQ + จ่าย commission May จริง | KAM-only, MoM (Apr→May) |
| `quarterly_nrr_2026_Q2_reconcile.sql` | รัน BQ + เทียบ CSV `bquxjob_1e2a7bf` | KAM-only, Q scope counts |

---

## 3 จุดที่ spec เดิมผิด (แก้แล้ว)

### 1. comeback definition
**ที่ถูก:** `pmo_mar.commercial_owner = ao.commercial_owner` — เทียบ portfolio ไม่ใช่ staff_owner
extend multi-portfolio: เปลี่ยน `'KAM'` hardcode → `ao.commercial_owner`

### 2. LEG D ไม่จำเป็น
reconcile.sql ไม่มี LEG D แต่ count handover = 34 ตรง ground truth
handover outlet ที่ไม่มี order ใน period = ไม่มีแถว ถูกต้อง
May/Jun fallback จับได้เองอยู่แล้ว

### 3. ห้ามใช้ user_master ทุก LEG
`dim.user_master` = current snapshot ณ วันรัน → outlet โอนออก Jun ขณะรัน May = flag ผิด
ใช้ `period_own` (order-based) แทนเท่านั้น

---

## Scope

| portfolio | filter | นับ NRR |
|---|---|---|
| KAM | `commercial_owner = 'KAM'` | ✅ |
| PM | `commercial_owner = 'PM'` | ✅ |
| ADMIN | `commercial_owner = 'ADMIN'` | ✅ |
| SALE | acquisition channel | ❌ นับแยกเพื่อ reconcile เท่านั้น |
| B2C/Enduser | ไม่ใช่ B2B | ❌ นับแยกตรงๆ |

filter ทุก CTE: `account_type NOT IN ('Consumer','Enduser','Exclude','TEST')`

---

## Revenue Reconcile — ภาพรวมทั้งบริษัท

```
Total Revenue
= B2B + B2C

B2B
= KAM + PM + ADMIN + SALE

KAM + PM + ADMIN
= SUM(curr_gmv จาก master table WHERE movement_type != 'transfer_out')

SALE
= SUM(gmv_ex_vat FROM dwh.order
      WHERE commercial_owner = 'SALE'
      AND delivery_date IN period
      AND account_type NOT IN (...))
  → นับตรงจาก dwh.order ไม่ผ่าน master table

B2C
= SUM(gmv_ex_vat FROM dwh.order
      WHERE account_type IN ('Consumer','Enduser'))
  → นับตรงจาก dwh.order
```

---

## Mar Cohort — Fixed Denominator

```
เงื่อนไข:
  commercial_owner IN ('KAM','PM','ADMIN')
  gmv_ex_vat > 0 ใน Mar 2026              ← filter เฉพาะ portfolio scope
  new_user_exp_date IS NULL
    OR FORMAT_DATE('%Y-%m', new_user_exp_date) != '2026-03'
  ไม่ filter staff_owner → รวม departed KAM, blank ทุกคน

base_gmv = SUM(gmv_ex_vat WHERE commercial_owner IN ('KAM','PM','ADMIN'))
         ← ignore SALE orders ใน Mar แม้ outlet นั้นจะมีทั้ง SALE และ KAM orders
```

**ทำไม ignore SALE orders:** base_gmv ใช้เป็น NRR denominator — ควรสะท้อนเฉพาะ GMV ที่ portfolio นั้นดูแลจริง ไม่รวม SALE portion

---

## Transfer In/Out — 3 Layers

### Layer 1: Intra-portfolio (เช่น KAM→KAM)
**ไม่นับเป็น transfer** — outlet โอนระหว่าง KAM rep = ยังอยู่ใน KAM pool = `core_nrr`

```
base_portfolio = 'KAM', current_portfolio = 'KAM' → core_nrr เสมอ
ไม่ว่า staff_owner จะเปลี่ยนจาก Dent→Pop หรือใดก็ตาม
```

✅ spec v3 ครอบแล้วโดย classification [4]: `mc.base_portfolio = ao.commercial_owner`

---

### Layer 2: Inter-portfolio (เช่น KAM→PM)
**นับเป็น transfer** — outlet ข้ามระหว่าง KAM/PM/ADMIN

```
LEG A (PM): transfer_in, curr_gmv = Apr GMV ของ outlet ✓
LEG B (KAM): transfer_out, curr_gmv = 0 ✓
reconcile per portfolio: ผ่าน ✓
```

ต้องเก็บ `from_portfolio` และ `to_portfolio` เพื่อ verify:
```
SUM(base_gmv WHERE transfer_out AND to_portfolio='PM')
≈ SUM(curr_gmv WHERE transfer_in AND from_portfolio='KAM')
```

✅ spec v3 ครอบแล้วด้วย LEG B structure

---

### Layer 3: Aggregate KAM+PM+ADMIN
transfer_in/out ระหว่าง KAM↔PM↔ADMIN กันเอง = **net zero** ในระดับ B2B portfolio
transfer_out ที่นับจริงในภาพรวม = ออกไป SALE หรือ inactive เท่านั้น

```
aggregate view:
  SUM(curr_gmv ยกเว้น transfer_out ทั้งหมด)
  = KAM GMV + PM GMV + ADMIN GMV รวมกัน ✓

net outflow จริง:
  WHERE transfer_out AND transfer_scope = 'external'
  = outlet Mar cohort → ออกไป SALE ใน period
```

❌ spec v3 เดิมขาด — ต้องเพิ่ม columns `from_portfolio`, `to_portfolio`, `transfer_scope`

---

## Columns เพิ่มใหม่: transfer metadata

ทุก row ใน master table ต้องมี:

```sql
from_portfolio  STRING   -- portfolio ต้นทาง
to_portfolio    STRING   -- portfolio ปลายทาง
transfer_scope  STRING   -- 'internal' | 'external' | NULL

-- rules:
-- transfer_in row:
--   from_portfolio = mc.base_portfolio
--   to_portfolio   = ao.commercial_owner
--   transfer_scope:
--     'internal' ถ้า from และ to ทั้งคู่อยู่ใน ('KAM','PM','ADMIN')
--     'external' ถ้า from หรือ to อยู่นอก scope

-- transfer_out row:
--   from_portfolio = mc.base_portfolio
--   to_portfolio   = ao_any.commercial_owner (ปลายทางจริง)
--   transfer_scope:
--     'internal' ถ้า to อยู่ใน ('KAM','PM','ADMIN')
--     'external' ถ้า to = 'SALE' หรืออื่น

-- non-transfer rows (core_nrr, comeback, expansion ฯลฯ):
--   from_portfolio = NULL
--   to_portfolio   = NULL
--   transfer_scope = NULL
```

---

## Classification Priority — lock แล้ว

ใช้ทุก LEG A ทุกเดือน เรียงลำดับตามนี้เสมอ:

```
[1] expansion
    first_dollar_date >= '2026-04-01'
    AND pmo_period.outlet_id IS NULL
    ตรวจก่อนเสมอ — outlet ใหม่แท้ไม่มีทางเป็นอย่างอื่น

[2] handover
    FORMAT_DATE('%Y-%m', new_user_exp_date) = '2026-03'
    ไม่เช็ค pre_mar = SALE (field นี้ set โดย Sales process โดยตรง)
    ไม่ต้องมี PATH B fallback

[3] new_sales
    FORMAT_DATE('%Y-%m', new_user_exp_date) IN ('2026-04','2026-05','2026-06')
    AND (pmo_mar.commercial_owner = 'SALE' OR pmo_mar.outlet_id IS NULL)

[4] core_nrr / core_nrr_churn
    mc.outlet_id IS NOT NULL
    AND mc.base_portfolio = ao.commercial_owner   ← same portfolio
    curr_gmv > 0 → core_nrr
    curr_gmv = 0 → core_nrr_churn

[5] transfer_in (from cohort)
    mc.outlet_id IS NOT NULL
    AND mc.base_portfolio != ao.commercial_owner
    from_portfolio = mc.base_portfolio
    to_portfolio   = ao.commercial_owner
    transfer_scope = 'internal' (ทั้งคู่อยู่ใน scope)

[6] comeback
    mc.outlet_id IS NULL
    AND pmo_mar.commercial_owner = ao.commercial_owner
    AND (new_user_exp_date IS NULL
         OR FORMAT_DATE('%Y-%m', new_user_exp_date)
            NOT IN ('2026-03','2026-04','2026-05','2026-06'))
    AND curr_gmv > 0

[7] transfer_in (ELSE)
    ทุกอย่างที่เหลือ
    from_portfolio = pmo_mar.commercial_owner (หรือ NULL ถ้าไม่รู้)
    to_portfolio   = ao.commercial_owner
    transfer_scope = CASE WHEN pmo_mar IN scope THEN 'internal' ELSE 'external' END
```

---

## LEG Structure ทุกเดือน

### LEG A — outlets ที่มี order ใน period month

```sql
FROM [period]_own ao
LEFT JOIN mar_cohort mc       ON ao.outlet_id = mc.outlet_id
LEFT JOIN outlet_first_dollar ofd ON ao.outlet_id = ofd.outlet_id
LEFT JOIN pre_mar_own pmo_mar ON ao.outlet_id = pmo_mar.outlet_id
LEFT JOIN pre_[period]_own pmo_p ON ao.outlet_id = pmo_p.outlet_id
LEFT JOIN [period]_gmv pg     ON ao.outlet_id = pg.outlet_id
WHERE ao.commercial_owner IN ('KAM','PM','ADMIN')
```

### LEG B — Mar cohort ที่ไม่มี order ใน portfolio เดิม

```sql
FROM mar_cohort mc
LEFT JOIN [period]_own ao_same
  ON mc.outlet_id = ao_same.outlet_id
  AND ao_same.commercial_owner = mc.base_portfolio
LEFT JOIN [period]_own ao_any
  ON mc.outlet_id = ao_any.outlet_id
WHERE ao_same.outlet_id IS NULL

movement_type:
  ao_any IS NULL                                    → core_nrr_churn
  ao_any.commercial_owner NOT IN ('KAM','PM','ADMIN') → transfer_out, scope='external'
  ELSE                                              → transfer_out, scope='internal'

from_portfolio = mc.base_portfolio
to_portfolio   = ao_any.commercial_owner (NULL ถ้า ao_any IS NULL)
curr_gmv       = 0 เสมอ
```

### Carry Forward (May/Jun LEG A)

```
May LEG A:
  อยู่ใน apr_labels → inherit fixed_label (ปรับ core↔churn ตาม may_gmv)
  ไม่อยู่ใน apr_labels → รัน [1]→[7] ใหม่
    pmo_period = pre_may_own
    pmo_mar    = pre_mar_own (ใช้เสมอสำหรับ [3][6])

Jun LEG A:
  อยู่ใน apr_labels → inherit
  อยู่ใน may_labels → inherit
  ไม่อยู่ทั้งคู่ → รัน [1]→[7] ใหม่
    pmo_period = pre_jun_own
```

`pmo_period` = expansion check (IS NULL)
`pmo_mar` = new_sales / comeback (ใช้ทุกเดือน ไม่เปลี่ยน)

---

## CTE Architecture

```
params
outlet_first_dollar      ← global B2B, MIN(first_dollar_date)
base_gmv                 ← Mar GMV, filter commercial_owner IN ('KAM','PM','ADMIN')
apr_gmv / may_gmv / jun_gmv  ← ทุก B2B (ไม่ filter portfolio — นับ GMV จริงของ period)
mar_own / apr_own / may_own / jun_own  ← last order per outlet, ไม่ filter portfolio
pre_mar_own              ← last B2B order ก่อน 2026-03-01
mar_cohort               ← KAM+PM+ADMIN, gmv>0, exclude handover_in_mar
apr_labels               ← lock classification Apr + from/to/scope columns
may_labels               ← lock classification May
apr_rows / may_rows / jun_rows  ← LEG A + LEG B
all_rows → FINAL
```

**หมายเหตุ `base_gmv`:** filter `commercial_owner IN ('KAM','PM','ADMIN')` — ignore SALE orders
**หมายเหตุ `apr/may/jun_gmv`:** ไม่ filter portfolio เพื่อให้ curr_gmv reconcile กับ dwh.order ได้ถูก

---

## Reconcile Constraints ทุก Layer

### Layer 1 — per portfolio per month
```
SUM(curr_gmv WHERE movement_type != 'transfer_out')
= SUM(gmv_ex_vat FROM dwh.order
      WHERE commercial_owner = portfolio AND delivery_date IN period)
```

### Layer 2 — cross-portfolio symmetry
```
COUNT(transfer_out WHERE from='KAM' AND to='PM' AND period='Apr')
= COUNT(transfer_in WHERE from='KAM' AND to='PM' AND period='Apr')

ถ้าไม่ตรง = outlet หายหรือ double count
```

### Layer 3 — aggregate B2B
```
SUM(curr_gmv ยกเว้น transfer_out ทั้งหมด, ทุก portfolio)
= KAM GMV + PM GMV + ADMIN GMV รวม ✓

net external outflow:
= SUM(base_gmv WHERE transfer_out AND transfer_scope='external')
= outlet Mar cohort ที่ออกไป SALE จริงๆ

Total B2B = KAM+PM+ADMIN curr_gmv + SALE GMV (นับแยกจาก dwh.order)
Total Revenue = Total B2B + B2C
```

### Layer 4 — no duplicate outlet
```
SELECT period_month, outlet_id, COUNT(*)
FROM final WHERE movement_type != 'transfer_out'
GROUP BY 1,2 HAVING COUNT(*) > 1
→ ต้องได้ 0 rows
```

### Layer 5 — KAM ground truth (ballpark หลัง base_gmv filter เปลี่ยน)
```
KAM Mar cohort: ~2,696 outlets (อาจเปลี่ยนเล็กน้อย)
KAM Apr movements (จาก reconcile.sql — ใช้เป็น ballpark):
  comeback=75, expansion=35, handover=34
  new_sales=6, transfer_in=43, transfer_out=1
```
ตัวเลขเหล่านี้อาจเปลี่ยนเล็กน้อยเพราะ base_gmv filter เปลี่ยน — verify กับ dwh.order โดยตรงแทน

---

## Edge Cases ทั้งหมด

| กรณี | ผลลัพธ์ที่ถูก |
|---|---|
| KAM(Dent)→KAM(Pop) ใน Apr | core_nrr (intra-portfolio ไม่เป็น transfer) |
| KAM→PM ใน Apr | LEG A (PM, transfer_in, scope=internal) + LEG B KAM (transfer_out, scope=internal, curr=0) |
| KAM→SALE ใน Apr | LEG B KAM (transfer_out, scope=external, curr=0) เท่านั้น |
| outlet ไม่มี order Apr เลย | LEG B churn, curr=0 |
| KAM→PM→KAM ใน Q | Apr: transfer_in(PM,internal)+transfer_out(KAM,internal), May: reverse |
| outlet inactive ทั้ง Q | 3 rows LEG B churn, curr=0 ทุก row |
| expansion + new_user_exp_date ใน Q | [1] ก่อน [2][3] ป้องกัน misclassify |
| handover ไม่มี Apr order + มี May order | May LEG A fallback: new_user_exp_date=Mar → handover |
| SALE GMV | ไม่อยู่ใน master — นับแยกจาก dwh.order เพื่อ reconcile |

---

## ความแตกต่าง: portfolio-level vs rep-level

| มิติ | Rep (v5) | Portfolio (master v3) |
|---|---|---|
| intra-portfolio transfer | = transfer (KAM คนเดิม→คนใหม่) | = core_nrr ยังอยู่ pool |
| inter-portfolio transfer | KAM→KAM อื่น = transfer_in/out | KAM→PM = transfer_in/out |
| comeback | เคยอยู่ KAM คนนี้ pre-Mar | เคยอยู่ KAM pool pre-Mar |
| core_nrr | Mar cohort + KAM คนเดิม | Mar cohort + portfolio เดิม |
| staff_owner | เช็คทุก step | ไม่สำคัญสำหรับ classification |

---

## Step-by-Step Build Plan

```
Step 1: CTEs พื้นฐาน
  params, outlet_first_dollar
  base_gmv (filter KAM+PM+ADMIN)
  apr/may/jun_gmv (ทุก B2B)
  mar/apr/may/jun_own (ไม่ filter portfolio)
  pre_mar_own
  verify: row counts, ไม่มี NULL outlet_id

Step 2: mar_cohort
  verify: KAM ~2,696 outlets
          PM, ADMIN: COUNT เทียบ dwh.order โดยตรง

Step 3: apr_labels + from/to/scope columns
  verify: KAM movement counts ใกล้เคียง ground truth

Step 4: may_labels

Step 5–7: apr/may/jun_rows (LEG A + LEG B)
  verify แต่ละเดือน:
    Layer 1: SUM(curr_gmv excl. transfer_out) per portfolio = dwh GMV
    Layer 2: transfer_out count = transfer_in count per portfolio pair
    Layer 3: SUM all portfolios = total B2B excl. SALE

Step 8: FINAL SELECT + reconcile check queries
```

---

## Key SQL Principles

```sql
-- Ownership snapshot
QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1

-- Day-1 lag
DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)

-- ห้ามใช้ dim.user_master ในทุก LEG
-- commercial_owner มาจาก dwh.order เท่านั้น
-- No temp tables — inline UNNEST CTEs
```

---

*พร้อมเขียน `sql/q2_2026_master_movements_v3.sql` ได้ทันที*
