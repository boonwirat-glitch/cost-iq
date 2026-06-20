# QNRR Q2 2026 — Master Movement SQL Test Spec
**วันที่:** 2026-06-20
**อ้างอิง:** `docs/qnrr_master_movement_design_v3.md`
**SQL ที่จะ test:** `sql/q2_2026_master_movements_v3.sql`

---

## วิธีใช้ test spec นี้

1. รัน SQL v3 บน synthetic data table ด้านล่าง
2. เทียบ output ทีละ row กับ Expected Output Table
3. ถ้า output ตรงทุก row → SQL ถูกต้อง พร้อม run บน BQ จริง

Synthetic data ออกแบบให้ครอบ:
- ทุก movement type (core, churn, handover, new_sales, expansion, comeback, transfer)
- Transfer 3 layers (intra-portfolio, inter-portfolio, aggregate)
- Edge cases ที่เคยพัง

---

## Synthetic Input Tables

### outlet_master (static attributes)

| outlet_id | first_dollar_date | new_user_exp_date | pre_mar_portfolio | note |
|---|---|---|---|---|
| O001 | 2025-06-01 | NULL | KAM | core ปกติ |
| O002 | 2025-03-01 | NULL | KAM | churn บางเดือน |
| O003 | 2024-11-01 | NULL | KAM | churn ทั้ง Q |
| O004 | 2026-02-01 | 2026-03-15 | SALE | handover Mar มี Apr order |
| O005 | 2026-01-15 | 2026-03-20 | SALE | handover Mar ไม่มี Apr order |
| O006 | 2026-01-10 | 2026-04-10 | SALE | new_sales Apr |
| O007 | 2025-12-01 | 2026-05-05 | SALE | new_sales May |
| O008 | 2026-04-05 | NULL | NULL | expansion Apr |
| O009 | 2026-05-12 | NULL | NULL | expansion May |
| O010 | 2026-04-03 | 2026-04-03 | NULL | expansion กับดัก (new_user_exp_date ใน Q) |
| O011 | 2025-04-01 | NULL | KAM | comeback |
| O012 | 2025-06-01 | NULL | PM | comeback-ที่ผิด → transfer_in |
| O013 | 2025-02-01 | NULL | KAM | KAM→PM Apr |
| O014 | 2025-01-01 | NULL | KAM | KAM→SALE Apr (external) |
| O015 | 2025-08-01 | NULL | PM | PM→KAM May |
| O016 | 2025-05-01 | NULL | KAM | KAM(Dent)→KAM(Pop) intra |
| O017 | 2024-12-01 | NULL | KAM | KAM→PM→KAM multi-hop |
| O018 | 2025-03-01 | NULL | PM | PM core ปกติ |
| O019 | 2024-06-01 | NULL | ADMIN | ADMIN core ปกติ |
| O020 | 2026-02-01 | 2026-03-10 | SALE | mixed SALE+KAM ใน Mar |
| O021 | 2025-01-01 | NULL | SALE | SALE-only ไม่อยู่ master |

---

### orders_by_month (GMV และ commercial_owner ต่อ outlet ต่อเดือน)

*last order ของเดือน = ownership snapshot ของเดือนนั้น*

| outlet_id | Mar_portfolio | Mar_gmv | Apr_portfolio | Apr_gmv | May_portfolio | May_gmv | Jun_portfolio | Jun_gmv |
|---|---|---|---|---|---|---|---|---|
| O001 | KAM | 100k | KAM | 110k | KAM | 105k | KAM | 98k |
| O002 | KAM | 80k | — | 0 | KAM | 70k | — | 0 |
| O003 | KAM | 60k | — | 0 | — | 0 | — | 0 |
| O004 | SALE | 50k | KAM | 60k | KAM | 55k | KAM | 58k |
| O005 | SALE | 40k | — | 0 | KAM | 35k | KAM | 42k |
| O006 | SALE | 30k | KAM | 45k | KAM | 48k | KAM | 50k |
| O007 | SALE | 25k | SALE | 28k | KAM | 32k | KAM | 35k |
| O008 | — | 0 | KAM | 20k | KAM | 25k | KAM | 22k |
| O009 | — | 0 | — | 0 | KAM | 15k | KAM | 18k |
| O010 | — | 0 | KAM | 18k | KAM | 20k | KAM | 19k |
| O011 | — | 0 | KAM | 30k | KAM | 28k | — | 0 |
| O012 | — | 0 | KAM | 25k | KAM | 22k | KAM | 24k |
| O013 | KAM | 90k | PM | 95k | PM | 88k | PM | 92k |
| O014 | KAM | 70k | SALE | 75k | SALE | 65k | SALE | 60k |
| O015 | PM | 55k | PM | 50k | KAM | 58k | KAM | 60k |
| O016 | KAM/Dent | 85k | KAM/Pop | 80k | KAM/Pop | 82k | KAM/Pop | 79k |
| O017 | KAM | 100k | PM | 95k | KAM | 90k | KAM | 92k |
| O018 | PM | 120k | PM | 115k | PM | 118k | PM | 110k |
| O019 | ADMIN | 200k | ADMIN | 195k | ADMIN | 210k | ADMIN | 185k |
| O020 | SALE+KAM | 100k* | KAM | 90k | KAM | 85k | KAM | 88k |
| O021 | SALE | 500k | SALE | 480k | SALE | 450k | SALE | 400k |

*O020 Mar: มี 2 orders — SALE 30k + KAM 70k, last order = KAM
*O020 base_gmv = 70k (filter commercial_owner=KAM เท่านั้น)

---

### mar_cohort expected (verify ก่อน run ทุก LEG)

| outlet_id | base_portfolio | base_gmv | reason |
|---|---|---|---|
| O001 | KAM | 100k | Mar KAM + gmv>0 + no exp_date |
| O002 | KAM | 80k | same |
| O003 | KAM | 60k | same |
| O013 | KAM | 90k | same |
| O014 | KAM | 70k | same |
| O016 | KAM | 85k | same |
| O017 | KAM | 100k | same |
| O015 | PM | 55k | Mar PM + gmv>0 |
| O018 | PM | 120k | same |
| O019 | ADMIN | 200k | Mar ADMIN + gmv>0 |
| ~~O004~~ | — | — | excluded: new_user_exp_date=Mar |
| ~~O005~~ | — | — | excluded: new_user_exp_date=Mar |
| ~~O020~~ | — | — | excluded: new_user_exp_date=Mar |
| ~~O021~~ | — | — | SALE ไม่อยู่ scope |
| ~~O006~~ | — | — | Mar=SALE ไม่อยู่ scope |
| ~~O007~~ | — | — | Mar=SALE ไม่อยู่ scope |
| ~~O008-O012~~ | — | — | Mar gmv=0 |

---

## Expected Output Table

*1 row ต่อ outlet_id ต่อ period_month ต่อ view_portfolio*
*transfer_out = additional row, curr_gmv=0 เสมอ*

### APRIL

| outlet_id | view_portfolio | movement_type | base_gmv | curr_gmv | from_portfolio | to_portfolio | transfer_scope |
|---|---|---|---|---|---|---|---|
| O001 | KAM | core_nrr | 100k | 110k | — | — | — |
| O002 | KAM | core_nrr_churn | 80k | 0 | — | — | — |
| O003 | KAM | core_nrr_churn | 60k | 0 | — | — | — |
| O004 | KAM | handover | 0 | 60k | — | — | — |
| O005 | — | *(no row)* | — | — | — | — | — |
| O006 | KAM | new_sales | 0 | 45k | — | — | — |
| O007 | — | *(no row in KAM)* | — | — | — | — | — |
| O008 | KAM | expansion | 0 | 20k | — | — | — |
| O009 | — | *(no row)* | — | — | — | — | — |
| O010 | KAM | expansion | 0 | 18k | — | — | — |
| O011 | KAM | comeback | 0 | 30k | — | — | — |
| O012 | KAM | transfer_in | 0 | 25k | PM | KAM | external* |
| O013 | PM | transfer_in | 90k | 95k | KAM | PM | internal |
| O013 | KAM | transfer_out | 90k | 0 | KAM | PM | internal |
| O014 | KAM | transfer_out | 70k | 0 | KAM | SALE | external |
| O015 | PM | core_nrr | 55k | 50k | — | — | — |
| O016 | KAM | core_nrr | 85k | 80k | — | — | — |
| O017 | PM | transfer_in | 100k | 95k | KAM | PM | internal |
| O017 | KAM | transfer_out | 100k | 0 | KAM | PM | internal |
| O018 | PM | core_nrr | 120k | 115k | — | — | — |
| O019 | ADMIN | core_nrr | 200k | 195k | — | — | — |
| O020 | KAM | handover | 0 | 90k | — | — | — |
| O021 | — | *(no row)* | — | — | — | — | — |

*O012 pre_mar=PM → transfer_in จาก PM มา KAM: scope=internal (PM อยู่ใน scope)

**April Layer 1 reconcile:**
```
KAM curr_gmv (excl. transfer_out) = 110+0+0+60+0+45+0+20+0+18+30+25+0+0+80+0+90 = 478k
PM  curr_gmv (excl. transfer_out) = 95+50+0+115 = 260k
ADMIN curr_gmv = 195k
Total KAM+PM+ADMIN = 933k
SALE Apr = O007(28)+O014(75)+O021(480) = 583k
Total B2B Apr = 1,516k
```

**April Layer 2 reconcile:**
```
KAM→PM transfer: O013, O017 (2 outlets)
  KAM transfer_out to PM = 2 ✓  PM transfer_in from KAM = 2 ✓
KAM→SALE external: O014 (1 outlet) — ไม่มี pair ใน master (SALE ไม่อยู่ scope) ✓
```

---

### MAY

| outlet_id | view_portfolio | movement_type | base_gmv | curr_gmv | from_portfolio | to_portfolio | transfer_scope |
|---|---|---|---|---|---|---|---|
| O001 | KAM | core_nrr | 100k | 105k | — | — | — |
| O002 | KAM | core_nrr | 80k | 70k | — | — | — |
| O003 | KAM | core_nrr_churn | 60k | 0 | — | — | — |
| O004 | KAM | handover | 0 | 55k | — | — | — |
| O005 | KAM | handover | 0 | 35k | — | — | — |
| O006 | KAM | new_sales | 0 | 48k | — | — | — |
| O007 | KAM | new_sales | 0 | 32k | — | — | — |
| O008 | KAM | expansion | 0 | 25k | — | — | — |
| O009 | KAM | expansion | 0 | 15k | — | — | — |
| O010 | KAM | expansion | 0 | 20k | — | — | — |
| O011 | KAM | comeback | 0 | 28k | — | — | — |
| O012 | KAM | transfer_in | 0 | 22k | PM | KAM | internal |
| O013 | PM | transfer_in | 90k | 88k | KAM | PM | internal |
| O013 | KAM | transfer_out | 90k | 0 | KAM | PM | internal |
| O014 | KAM | transfer_out | 70k | 0 | KAM | SALE | external |
| O015 | PM | transfer_out | 55k | 0 | PM | KAM | internal |
| O015 | KAM | transfer_in | 55k | 58k | PM | KAM | internal |
| O016 | KAM | core_nrr | 85k | 82k | — | — | — |
| O017 | PM | transfer_out | 100k | 0 | PM | KAM | internal |
| O017 | KAM | transfer_in | 100k | 90k | PM | KAM | internal |
| O018 | PM | core_nrr | 120k | 118k | — | — | — |
| O019 | ADMIN | core_nrr | 200k | 210k | — | — | — |
| O020 | KAM | handover | 0 | 85k | — | — | — |

**May Layer 1 reconcile:**
```
KAM = 105+70+0+55+35+48+32+25+15+20+28+22+0+0+0+58+0+90+0+85 = 688k
PM  = 0+0+88+118 = 206k (transfer_out O013,O015,O017 curr=0)
ADMIN = 210k
Total KAM+PM+ADMIN = 1,104k
```

**May Layer 2 reconcile:**
```
KAM→PM: O013 (ongoing) — KAM out=1, PM in=1 ✓
PM→KAM: O015, O017 — PM out=2, KAM in=2 ✓
KAM→SALE: O014 (external ongoing) ✓
```

---

### JUNE

| outlet_id | view_portfolio | movement_type | base_gmv | curr_gmv | from_portfolio | to_portfolio | transfer_scope |
|---|---|---|---|---|---|---|---|
| O001 | KAM | core_nrr | 100k | 98k | — | — | — |
| O002 | KAM | core_nrr_churn | 80k | 0 | — | — | — |
| O003 | KAM | core_nrr_churn | 60k | 0 | — | — | — |
| O004 | KAM | handover | 0 | 58k | — | — | — |
| O005 | KAM | handover | 0 | 42k | — | — | — |
| O006 | KAM | new_sales | 0 | 50k | — | — | — |
| O007 | KAM | new_sales | 0 | 35k | — | — | — |
| O008 | KAM | expansion | 0 | 22k | — | — | — |
| O009 | KAM | expansion | 0 | 18k | — | — | — |
| O010 | KAM | expansion | 0 | 19k | — | — | — |
| O011 | — | *(no row)* | — | — | — | — | — |
| O012 | KAM | transfer_in | 0 | 24k | PM | KAM | internal |
| O013 | PM | transfer_in | 90k | 92k | KAM | PM | internal |
| O013 | KAM | transfer_out | 90k | 0 | KAM | PM | internal |
| O014 | KAM | transfer_out | 70k | 0 | KAM | SALE | external |
| O015 | PM | transfer_out | 55k | 0 | PM | KAM | internal |
| O015 | KAM | transfer_in | 55k | 60k | PM | KAM | internal |
| O016 | KAM | core_nrr | 85k | 79k | — | — | — |
| O017 | PM | transfer_out | 100k | 0 | PM | KAM | internal |
| O017 | KAM | transfer_in | 100k | 92k | PM | KAM | internal |
| O018 | PM | core_nrr | 120k | 110k | — | — | — |
| O019 | ADMIN | core_nrr | 200k | 185k | — | — | — |
| O020 | KAM | handover | 0 | 88k | — | — | — |

*O011 Jun: ไม่มี Jun order + ไม่อยู่ mar_cohort → ไม่มีแถว ✓

---

## Reconcile Summary Table

| period | portfolio | SUM curr_gmv (excl. transfer_out) | expected dwh GMV |
|---|---|---|---|
| Apr | KAM | 478k | 478k |
| Apr | PM | 260k | 260k |
| Apr | ADMIN | 195k | 195k |
| May | KAM | 688k | 688k |
| May | PM | 206k | 206k |
| May | ADMIN | 210k | 210k |
| Jun | KAM | ~687k* | ~687k |
| Jun | PM | ~202k* | ~202k |
| Jun | ADMIN | 185k | 185k |

*Jun KAM = 98+0+0+58+42+50+35+22+18+19+0+24+0+0+60+79+0+92+0+88 = 685k
*Jun PM = 0+92+0+110 = 202k

---

## Layer 2 Symmetry Check (cross-portfolio)

| period | direction | outlet | KAM side | PM side | scope |
|---|---|---|---|---|---|
| Apr | KAM→PM | O013 | transfer_out | transfer_in | internal |
| Apr | KAM→PM | O017 | transfer_out | transfer_in | internal |
| Apr | KAM→SALE | O014 | transfer_out | *(no pair)* | external |
| May | KAM→PM | O013 | transfer_out | transfer_in | internal |
| May | PM→KAM | O015 | transfer_in | transfer_out | internal |
| May | PM→KAM | O017 | transfer_in | transfer_out | internal |
| May | KAM→SALE | O014 | transfer_out | *(no pair)* | external |
| Jun | same as May | all | same pattern | same pattern | — |

**Layer 3 aggregate check Apr:**
```
internal transfer net = 0 (KAM out = PM in สำหรับทุก outlet)
external transfer_out = O014 base_gmv=70k (ออกไป SALE)
Total B2B Apr = 933k + SALE 583k = 1,516k
```

---

## Key Assertions (SQL ต้องผ่านทุกข้อ)

```
[A1] O010 Apr → expansion (ไม่ใช่ new_sales) — [1] ก่อน [3]
[A2] O012 Apr → transfer_in (ไม่ใช่ comeback) — pre_mar=PM ≠ KAM
[A3] O011 Jun → ไม่มีแถว — comeback ไม่อยู่ cohort + ไม่มี Jun order
[A4] O016 Apr → core_nrr (ไม่ใช่ transfer) — intra-portfolio
[A5] O017 May KAM → transfer_in จาก PM (ไม่ใช่ core_nrr) — เคยโอนออก Apr
[A6] O020 base_gmv = 70k (ไม่ใช่ 100k) — ignore SALE orders ใน Mar
[A7] O021 → ไม่มีแถวใน master เลย
[A8] O005 Apr → ไม่มีแถว — handover ที่ไม่มี Apr order
[A9] transfer_out ทุกแถว curr_gmv = 0 เสมอ
[A10] Layer 2: COUNT(transfer_out KAM→PM) = COUNT(transfer_in PM←KAM) ต่อเดือน
[A11] Layer 1: SUM(curr_gmv excl. transfer_out) per portfolio = dwh GMV
[A12] Layer 3: internal transfer_out rows ≠ net outflow, external เท่านั้น = net outflow
```

---

## คำถามที่ยังต้อง confirm จาก business

**Q1: O017 May/Jun** — outlet กลับมา KAM หลังโอนออกไป PM → classify เป็น `transfer_in` (ไม่ใช่ core_nrr) ตลอดที่เหลือของ Q ถูกต้องตาม business intent ไหม?

**Q2: O012** — outlet ที่ pre_mar=PM มา KAM ใน Apr → `transfer_in` ไม่ใช่ `comeback` แม้จะเคยซื้อมาก่อน ถูกต้องไหม? (spec v3 ตีว่า comeback = เคยอยู่ portfolio เดิม ไม่ใช่แค่เคยซื้อ)

**Q3: O014 May/Jun** — KAM transfer_out ปรากฏซ้ำทุกเดือนตลอด Q (เพราะอยู่ mar_cohort แต่ออกไป SALE) — ต้องการเห็นแบบนี้ไหม หรือให้แสดงแค่เดือนที่โอนออกจริง (Apr)?

