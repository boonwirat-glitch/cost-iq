# Master Movement Table — Design Spec
**วันที่:** 2026-06-21 (อัปเดตรอบสอง)
**สถานะ:** Ground truth สมบูรณ์ — ใช้ไฟล์นี้เป็นอ้างอิงเดียว

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

**Base GMV:** `SUM(gmv_ex_vat)` ทุก order ใน March ของ outlet — ไม่ filter commercial_owner
เหตุผล: outlet อาจเปลี่ยนมือระหว่างเดือน GMV ทั้งเดือนคือฐานที่แท้จริง

---

## curr_gmv — หลักการ

**ทุก movement ยกเว้น transfer_out:**
curr_gmv = SUM(gmv_ex_vat) ทุก order ของร้านนั้นในเดือนนั้น ไม่ filter commercial_owner
เหมือนกับ base_gmv — นับ GMV ของร้านทั้งหมด ไม่สนว่าวันนั้น owner เป็นใคร

**transfer_out:**
curr_gmv = 0 เสมอ
transfer_out ไม่ใช่ GMV จริง เป็นแค่ตัว adjust บอกว่า core cohort หายไป base_gmv เท่าไหร่
ข้อมูลที่มีความหมายคือ base_gmv ของ outlet นั้น ไม่ใช่ curr_gmv

---

## Movement Types — นิยามที่ถูกต้อง

### Label Lock
ทุก movement ยกเว้น transfer_in/out → lock label ตั้งแต่เดือนแรกที่รู้ ไม่เปลี่ยนตลอดไตรมาส
GMV อาจเป็น 0 บางเดือนได้ แต่ label ไม่เปลี่ยน

| Movement | นิยาม | cohort_month | Lock? | curr_gmv |
|---|---|---|---|---|
| core_nrr | Mar cohort + same portfolio + GMV > 0 เดือนนั้น | March | Label lock | GMV ทั้งหมดของร้าน |
| core_nrr_churn | Mar cohort + same portfolio + GMV = 0 เดือนนั้น | March | Label lock | 0 |
| handover | new_user_exp_date = March | March | Lock ตลอด Q | GMV ทั้งหมดของร้าน |
| new_sales | new_user_exp_date = Apr/May/Jun | เดือนที่โอน | Lock ตลอด Q | GMV ทั้งหมดของร้าน |
| expansion | first_dollar_date >= Apr 1 | เดือน first order | Lock ตลอด Q | GMV ทั้งหมดของร้าน |
| comeback | ไม่มี Mar GMV + first_dollar < Apr + กลับมาซื้อใน Q | เดือน first order ใน Q | Lock ตลอด Q | GMV ทั้งหมดของร้าน |
| transfer_in | รับโอนเข้า portfolio ระหว่าง Q | - | รายเดือนตาม last order | GMV ทั้งหมดของร้าน |
| transfer_out | Mar cohort ที่ออกไปนอก portfolio เดือนนั้น | - | รายเดือนตาม last order | **0 เสมอ** |

**หมายเหตุ core_nrr/churn:** core_nrr ↔ core_nrr_churn สลับได้ตาม GMV เดือนนั้น
label ยัง lock ว่าเป็น core cohort แต่ active/churn ดูจาก GMV จริง

**หมายเหตุ transfer:** ownership ดูจาก last order ของแต่ละเดือน
ถ้าออกไป April แล้วกลับมา June → June เป็น core_nrr ปกติ April เป็น transfer_out

---

## Handover vs New Sales

ต่างกันแค่เดือนที่โอน:
- handover = โอนมาใน March (เดือนฐาน)
- new_sales = โอนมาใน April, May, หรือ June

### Fallback กรณีไม่มี new_user_exp_date
ดู first order date ที่ `commercial_owner IN ('KAM','PM','ADMIN')` ของ outlet นั้น:
- First portfolio order ตกใน March หรือก่อนหน้า → handover
- First portfolio order ตกใน April → new_sales cohort April
- First portfolio order ตกใน May → new_sales cohort May
- First portfolio order ตกใน June → new_sales cohort June
- ไม่มี order เลยในมือ KAM/PM/ADMIN → default handover

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

VP/Admin view: transfer_in = 0 (inter หักล้างกัน), transfer_out = external เท่านั้น
TL view: เห็น inter + external
Rep view: เห็นทั้ง intra + inter + external

---

## Reconcile Checks (Ground Truth)

**Check 1 — GMV ตรง dwh.order ทุกบาท**
```
SUM(curr_gmv WHERE movement_type != 'transfer_out') per portfolio per month
= SUM(gmv_ex_vat FROM dwh.order WHERE commercial_owner = portfolio AND period)
```

**Check 2 — Transfer inter symmetry**
```
COUNT(transfer_out WHERE from=A to=B period)
= COUNT(transfer_in  WHERE from=A to=B period)
```

**Check 3 — Transfer intra symmetry**
transfer_out intra = transfer_in intra ต่อ staff pair ต่อเดือน

**Check 4 — ไม่มี duplicate outlet**
```sql
SELECT period_month, outlet_id, COUNT(*)
FROM final
WHERE movement_type NOT IN ('transfer_in','transfer_out')
GROUP BY 1,2 HAVING COUNT(*) > 1
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

| จุดที่ผิด | เดิม | ที่ถูกต้อง |
|---|---|---|
| base_gmv | filter commercial_owner IN (KAM,PM,ADMIN) | ไม่ filter |
| curr_gmv | filter commercial_owner = portfolio | ไม่ filter — GMV ทั้งหมดของร้าน |
| transfer_out curr_gmv | GMV จริงของเดือนนั้น | 0 เสมอ |
| handover fallback | default handover | ดู first_portfolio_order date |
| expansion GMV=0 | flip เป็น transfer_in | expansion GMV=0 label lock |
| label ระหว่างเดือน | re-classify ใหม่ทุกเดือน | lock ตั้งแต่ครั้งแรก |
| comeback | check pre-Mar KAM คนนี้ | Freshket-wide ไม่สนว่า KAM คนไหน |

---

## CTE Architecture

```
params
outlet_first_dollar           — global B2B, MIN(first_dollar_date)
outlet_first_portfolio_order  — MIN order date ที่ owner = KAM/PM/ADMIN
base_gmv                      — Mar GMV ทุก order ไม่ filter portfolio
apr_gmv / may_gmv / jun_gmv   — period GMV ทุก order ไม่ filter portfolio
mar_own / apr_own / may_own / jun_own  — last order per outlet per month (ownership)
pre_mar_own                   — last order ก่อน Mar
mar_handover_outlets          — any Mar order ที่ new_user_exp_date = Mar
mar_cohort                    — fixed denominator ทั้ง Q
apr_labels                    — lock classification Apr
may_labels                    — lock classification May (inherit จาก Apr)
apr_rows / may_rows / jun_rows — LEG A (has order) + LEG B (cohort ที่ออกไป)
all_rows → FINAL SELECT
```

---

## Key SQL Principles

```sql
-- ownership snapshot per outlet per month (last order wins)
QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1

-- day-1 lag สำหรับ Jun
DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)

-- ห้ามใช้ dim.user_master — current snapshot ทำให้ historical ผิด
-- commercial_owner และ GMV มาจาก dwh.order เท่านั้น

-- no temp tables — ใช้ inline UNNEST CTEs
```
