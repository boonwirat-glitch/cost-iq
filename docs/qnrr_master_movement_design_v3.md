# Master Movement Table — Design Spec
**วันที่:** 2026-06-21
**สถานะ:** Ground truth — ใช้แทน qnrr_master_movement_design_v3.md และ handoff ทุกฉบับก่อนหน้า
**SQL ที่จะสร้าง:** ไฟล์ใหม่ (ไม่ fix v3 เดิม)

---

## หลักการตั้งต้น

Master movement table คือ single source of truth ของบริษัท
ถ้า master ถูก ทุกระดับ (VP, TL, Rep) จะถูกตาม — ย่อยลงมาจาก master ไม่ใช่ build แยกกัน

---

## Scope

| Portfolio | นับใน master | หมายเหตุ |
|---|---|---|
| KAM | ✅ | |
| PM | ✅ | |
| ADMIN | ✅ | |
| SALE | ❌ | acquisition channel — นับแยกจาก dwh.order โดยตรง |
| B2C / Enduser | ❌ | ออกทั้งหมด |

filter ทุก CTE: `account_type NOT IN ('Consumer','Enduser','Exclude','TEST')`

---

## เดือนฐาน (Mar Cohort)

**Ownership:** ดูจาก last order ของ March ต่อ outlet
- `commercial_owner IN ('KAM','PM','ADMIN')` → อยู่ใน cohort
- `commercial_owner = 'SALE'` → ไม่อยู่ใน cohort
- มี `new_user_exp_date = March` → ไม่อยู่ใน cohort (นับเป็น handover แยก)

**Base GMV:** `SUM(gmv_ex_vat)` ทุก order ใน March ของ outlet นั้น — ไม่ filter commercial_owner
เหตุผล: outlet อาจเปลี่ยนมือระหว่างเดือน แต่ GMV ทั้งเดือนคือฐานที่แท้จริง

**ตรวจ cohort ด้วย:**
```sql
SELECT CAST(user_id AS STRING) AS outlet_id,
       UPPER(TRIM(commercial_owner)) AS portfolio,
       ROUND(SUM(gmv_ex_vat),0) AS base_gmv
FROM `freshket-rn.dwh.order`
WHERE delivery_date BETWEEN '2026-03-01' AND '2026-03-31'
  AND account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
QUALIFY ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY delivery_date DESC) = 1
HAVING commercial_owner IN ('KAM','PM','ADMIN')
   AND (new_user_exp_date IS NULL
        OR FORMAT_DATE('%Y-%m', DATE(new_user_exp_date)) != '2026-03')
```
ผล = mar_cohort ที่ต้องตรงกับ SQL ทุก outlet ทุกบาท

---

## Movement Types — นิยามที่ถูกต้อง

### Label Lock
ทุก movement ยกเว้น transfer_in/out → **lock label ตั้งแต่เดือนแรกที่รู้ ไม่เปลี่ยนตลอดไตรมาส**
GMV อาจเป็น 0 บางเดือนได้ แต่ label ไม่เปลี่ยน

| Movement | นิยาม | cohort_month | Lock? |
|---|---|---|---|
| core_nrr | Mar cohort + same portfolio + GMV > 0 เดือนนั้น | March | Label lock, GMV update รายเดือน |
| core_nrr_churn | Mar cohort + same portfolio + GMV = 0 เดือนนั้น | March | Label lock |
| handover | new_user_exp_date = March (โอนจาก Sales เดือนฐาน) | March | Lock ตลอด Q |
| new_sales | โอนจาก Sales ระหว่าง Q (new_user_exp_date = Apr/May/Jun) | เดือนที่โอน | Lock ตลอด Q |
| expansion | first order ใน Q (first_dollar_date >= Apr 1) | เดือน first order | Lock ตลอด Q |
| comeback | ไม่มี Mar GMV + first_dollar < Apr + กลับมาซื้อใน Q | เดือน first order ใน Q | Lock ตลอด Q |
| transfer_in | รับโอนเข้า portfolio ระหว่าง Q | - | Update รายวัน |
| transfer_out | โอนออกจาก portfolio ระหว่าง Q, curr_gmv = 0 เสมอ | - | Update รายวัน |

**หมายเหตุ core_nrr:** เป็น movement เดียวที่ GMV fluctuate ได้ตาม actual order
core_nrr ↔ core_nrr_churn สลับได้ตาม GMV เดือนนั้น แต่ label ยัง lock ว่าเป็น core cohort

---

## Handover vs New Sales

ต่างกันแค่เดือนที่โอน:
- handover = โอนมาใน **March** (เดือนฐาน)
- new_sales = โอนมาใน **April, May, หรือ June**

### Fallback กรณีไม่มี new_user_exp_date
ดู first order date ที่ `commercial_owner IN ('KAM','PM','ADMIN')` ของ outlet นั้น:
- First portfolio order ตกใน March หรือก่อนหน้า → handover
- First portfolio order ตกใน April → new_sales cohort April
- First portfolio order ตกใน May → new_sales cohort May
- First portfolio order ตกใน June → new_sales cohort June
- ไม่มี order เลยในมือ KAM/PM/ADMIN → default handover

CTE ที่ต้องเพิ่ม: `outlet_first_portfolio_order`
```sql
outlet_first_portfolio_order AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         MIN(DATE(o.delivery_date)) AS first_portfolio_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.commercial_owner IN ('KAM','PM','ADMIN')
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  GROUP BY 1
)
```

---

## Comeback — นิยามระดับ Master (Freshket-wide)

comeback = ลูกค้า Freshket เก่าที่หายไปแล้วกลับมา ไม่สนว่า KAM คนไหนดูแล
เงื่อนไข:
- ไม่มี GMV ใน March (ไม่อยู่ใน mar_cohort)
- first_dollar_date < April 1 (เคยซื้อกับ Freshket มาก่อน)
- กลับมามี order ใน Q นี้
- ไม่มี new_user_exp_date ใน Q (ถ้ามีจะเป็น new_sales แทน)

---

## Transfer Scope

| Scope | นิยาม | เห็นที่ระดับไหน |
|---|---|---|
| intra | staff เปลี่ยนมือในพอร์ตเดิม (KAM A → KAM B) | Rep เท่านั้น |
| inter | ข้ามพอร์ต (KAM → PM, PM → ADMIN ฯลฯ) | TL ขึ้นไป |
| external | ออกนอก KAM/PM/ADMIN (→ SALE) | ทุกระดับ |

**VP / Admin view:**
- transfer_in = 0 เสมอ (inter หักล้างกันหมด)
- transfer_out = เฉพาะ external (ออกไป SALE)

**TL view:** เห็น inter + external, ไม่เห็น intra

**Rep view:** เห็นทั้ง intra + inter + external

---

## Base GMV — หลักการสำคัญ

```sql
-- ถูกต้อง: ไม่ filter commercial_owner
base_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
         ROUND(SUM(o.gmv_ex_vat), 0) AS gmv
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date BETWEEN '2026-03-01' AND '2026-03-31'
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
)
-- ผิด: filter commercial_owner IN ('KAM','PM','ADMIN') ทำให้ base_gmv ต่ำกว่าความจริง
```

---

## Reconcile Checks (Ground Truth)

**Check 1 — GMV ตรง dwh.order ทุกบาท**
```sql
-- master SQL
SUM(curr_gmv) WHERE movement_type != 'transfer_out'  per portfolio per month
-- ต้องเท่ากับ
SUM(gmv_ex_vat FROM dwh.order WHERE commercial_owner = portfolio AND delivery_date IN period)
```

**Check 2 — Transfer inter symmetry**
```sql
COUNT(transfer_out WHERE from=A AND to=B AND period)
= COUNT(transfer_in  WHERE from=A AND to=B AND period)
-- ต้องเท่ากันทุก pair
```

**Check 3 — Transfer intra symmetry**
transfer_out intra = transfer_in intra ต่อ staff pair ต่อเดือน

**Check 4 — ไม่มี duplicate outlet**
```sql
SELECT period_month, outlet_id, COUNT(*)
FROM final
WHERE movement_type NOT IN ('transfer_in','transfer_out')
GROUP BY 1,2
HAVING COUNT(*) > 1
-- ต้องได้ 0 rows
```

**Check 5 — Label lock**
```sql
SELECT outlet_id, COUNT(DISTINCT movement_type)
FROM final
WHERE movement_type NOT IN ('transfer_in','transfer_out','core_nrr','core_nrr_churn')
GROUP BY outlet_id
HAVING COUNT(DISTINCT movement_type) > 1
-- ต้องได้ 0 rows
```

**Check 6 — Core cohort ตรง dwh.order**
mar_cohort ใน SQL ต้องตรงกับ query ตรงจาก dwh.order ทั้ง outlet count และ base_gmv ทุกบาท

---

## สิ่งที่ผิดใน MD และ SQL เก่า (ห้ามนำกลับมาใช้)

| จุดที่ผิด | เดิมบอกว่า | ที่ถูกต้อง |
|---|---|---|
| base_gmv | filter commercial_owner IN (KAM,PM,ADMIN) | ไม่ filter — นับทุก order ใน March |
| handover fallback | default handover ถ้าไม่มี exp_date | ดู first_portfolio_order date |
| expansion GMV=0 | flip เป็น transfer_in | ยังเป็น expansion GMV=0 label lock |
| label ระหว่างเดือน | re-classify ใหม่ทุกเดือน | lock ตั้งแต่ครั้งแรก ไม่ re-classify |
| comeback | check pre-Mar owner เป็น KAM คนนี้ | Freshket-wide ไม่สนว่า KAM คนไหน |

---

## CTE Architecture

```
params
outlet_first_dollar           — global B2B, MIN(first_dollar_date)
outlet_first_portfolio_order  — MIN order date ที่ owner = KAM/PM/ADMIN (ใหม่)
base_gmv                      — Mar GMV ทุก order ไม่ filter portfolio
apr_gmv / may_gmv / jun_gmv   — period GMV ทุก B2B
mar_own / apr_own / may_own / jun_own  — last order per outlet per month
pre_mar_own                   — last order ก่อน Mar
mar_handover_outlets          — any Mar order ที่ new_user_exp_date = Mar
mar_cohort                    — fixed denominator ทั้ง Q
apr_labels                    — lock classification Apr
may_labels                    — lock classification May (inherit จาก Apr)
apr_rows / may_rows / jun_rows — LEG A + LEG B
all_rows → FINAL SELECT
```

---

## Key SQL Principles

```sql
-- ownership snapshot per outlet per month
QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1

-- day-1 lag สำหรับ Jun
DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)

-- ห้ามใช้ dim.user_master — current snapshot ทำให้ historical ผิด
-- commercial_owner มาจาก dwh.order เท่านั้น

-- join key dwh.order → dim.user_master (ถ้าต้องการ outlet name)
CAST(o.user_id AS STRING) = um.res_id

-- no temp tables — ใช้ inline UNNEST CTEs
```
