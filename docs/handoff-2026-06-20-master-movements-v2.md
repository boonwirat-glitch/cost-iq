# Handoff — Master Movement Table v2 (Q2 2026)
Date: 2026-06-20

---

## Goal

`sql/q2_2026_master_movements_v2.sql` คือ single source of truth สำหรับ QNRR Q2 2026  
ใช้ track outlet movement (core_nrr, comeback, expansion, new_sales, handover_perf, transfer_in, transfer_out, core_nrr_churn) ต่อ portfolio ต่อเดือน  

**Scope portfolio:** KAM / PM / ADMIN (+ AD เมื่อ field พร้อม)  
**SALE ไม่อยู่ใน scope** — SALE เป็น acquisition channel ไม่ใช่ retention portfolio

---

## Reconcile Status

### ✅ ผ่าน
- Total GMV Apr/May/Jun = ตรง 0.000M diff กับ `dwh.order` ทุกบาท
- KAM core_nrr Apr: 2,454 outlets / 126.685M (GT = 2,455 / 126.688M) — off 1 outlet negligible
- KAM Mar cohort Apr: 2,695 outlets / 136.928M (GT = 2,696 / 136.937M) — negligible
- KAM comeback/expansion/transfer_out Apr: ตรง
- Cross-portfolio: ไม่มี outlet ซ้ำข้าม portfolio ในเดือนเดียวกัน

### ⚠️ ยังไม่ตรง — KAM movement counts May/Jun

| movement | Apr SQL→GT | May SQL→GT | Jun SQL→GT |
|---|---|---|---|
| comeback | 75→75 ✅ | 64→103 ⚠️ | 68→92 ⚠️ |
| new_sales | 4→6 ⚠️ | 30→65 ⚠️ | 28→67 ⚠️ |
| transfer_in | 45→43 ⚠️ | 47→64 ⚠️ | 43→77 ⚠️ |
| expansion | 35→35 ✅ | 99→92 ⚠️ | 121→111 ⚠️ |

**Root cause:** `may_rows`/`jun_rows` LEG A ใช้ CASE inline classify ใหม่แทน inherit จาก `apr_labels`  
→ outlets ที่ไม่มี Apr order ถูก re-classify ผิด comeback/new_sales กลายเป็น transfer_in  
→ expansion นับเกินเพราะ `first_dollar >= Apr + pmo IS NULL` จับบางกลุ่มซ้ำ

### ⚠️ SALE total GMV ยังไม่ตรง (แต่ไม่ใช่ scope)

| month | BQ GT | SQL | diff |
|---|---|---|---|
| Apr | 10.335M | 9.903M | -0.432M |
| May | 9.164M | 7.527M | -1.637M |
| Jun | 4.942M | 4.539M | -0.403M |

สาเหตุ: outlet ที่ `commercial_owner = SALE` บางส่วนมีออเดอร์สุดท้ายเดือนนั้นเป็น ADMIN/KAM/PM  
→ last-order-wins classify ผิด portfolio  
→ **ไม่ต้องแก้** เพราะ SALE ไม่ใช่ scope

---

## งานที่ต้องทำ session ต่อไป

### 1. ตัด SALE ออกจาก master table
ใน `apr_own`, `may_own`, `jun_own` — เพิ่ม `AND o.commercial_owner != 'SALE'`  
หรือ filter ใน final SELECT `WHERE current_portfolio != 'SALE'`

### 2. แก้ May/Jun carry-forward logic
ปัญหาอยู่ใน `may_rows` LEG A และ `jun_rows` LEG A  
CASE inline ต้องแก้ให้ priority ถูกต้อง:

```sql
-- May/Jun outlets ที่ไม่อยู่ใน apr_labels (ไม่มี Apr order)
-- ต้องใช้ logic เดียวกับ reconcile.sql:
-- new_sales: new_user_exp_date ใน Q + pre_mar = SALE OR pre_mar IS NULL
-- comeback: pre_mar = same portfolio (ไม่ใช่แค่ pre_period)
-- expansion: first_dollar >= Apr + ไม่เคยมี order ก่อน Apr เลย
```

Reference SQL ที่ถูกต้อง: `sql/quarterly_nrr_2026_Q2_reconcile.sql`  
Ground truth movement counts มาจาก reconcile.sql นี้

### 3. เพิ่ม AD portfolio
เมื่อ `commercial_owner = 'AD'` พร้อม — เพิ่มใน scope ได้เลย ไม่ต้องแก้ logic

---

## Architecture SQL (v2)

```
params
outlet_first_dollar
base_gmv / apr_gmv / may_gmv / jun_gmv
mar_own / apr_own / may_own / jun_own         ← last order per outlet per month
pre_mar_own / pre_apr_own / pre_may_own / pre_jun_own  ← last order ก่อน period
mar_cohort                                    ← fixed denominator ทั้ง Q
apr_labels                                    ← classification locked in Apr, carry forward May/Jun
apr_rows / may_rows / jun_rows               ← LEG A (has order) + LEG B (silent = churn)
transfer_out_apr/may/jun                     ← sender view
all_rows → FINAL
```

## Classification Logic (locked)

```
Mar cohort: commercial_owner = X + gmv > 0 + new_user_exp_date != Mar
ไม่ filter staff_owner — รวม departed KAM, blank ทุกคน

Priority:
[1] expansion    — first_dollar >= Apr + ไม่เคยมี order ก่อน Apr
[2] handover_perf — new_user_exp_date = Mar + pre_mar = SALE
[3] new_sales    — new_user_exp_date ใน Q + pre_mar = SALE
[4] core_nrr     — อยู่ mar_cohort + same portfolio + GMV > 0
[5] core_nrr_churn — อยู่ mar_cohort + same portfolio + GMV = 0
[6] transfer_out — อยู่ mar_cohort + เปลี่ยน portfolio (sender view)
[7] comeback     — ไม่อยู่ mar_cohort + pre_mar = same portfolio + GMV > 0
[8] transfer_in  — อื่นๆ
```

## Ground Truth Numbers

**Total GMV (no filter):** Oct25=188.2M Nov25=204.4M Dec25=235.7M Jan26=214.9M Feb26=195.1M Mar26=204.2M Apr26=192.6M

**SALE GMV (commercial_owner=SALE):**
Jan=10.184M Feb=8.656M Mar=10.273M Apr=10.335M May=9.164M Jun=4.942M (1-19 Jun)

**KAM:**
- Mar cohort: 2,696 outlets / 136.937M base_gmv
- core_nrr Apr: 2,455 outlets / 126.688M
- core_nrr_churn Apr: 241 outlets

**KAM movement counts (from reconcile.sql):**
| movement | Apr | May | Jun |
|---|---|---|---|
| comeback | 75 | 103 | 92 |
| expansion | 35 | 92 | 111 |
| handover | 34 | 34 | 31 |
| new_sales | 6 | 65 | 67 |
| transfer_in | 43 | 64 | 77 |
| transfer_out | 1 | 2 | 2 |

---

## Key Files

| file | description |
|---|---|
| `sql/q2_2026_master_movements_v2.sql` | master SQL ปัจจุบัน (ยังต้องแก้ May/Jun) |
| `sql/quarterly_nrr_2026_Q2_reconcile.sql` | KAM-only reference SQL ที่ verified |
| `sql/quarterly_nrr_2026_Q2.sql` | original QNRR SQL |

## Repo & Deploy
- Repo: `github.com/boonwirat-glitch/cost-iq` branch `main`
- Hosting: Cloudflare Pages (auto-deploy on push)
- App version: v820

## Key SQL Principles
- Join key `dwh.order` → `dim.user_master`: `CAST(o.user_id AS STRING) = u.res_id`
- `commercial_owner` มาจาก `dwh.order` ไม่ใช่ `dim.user_master`
- Day-1 lag: `DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)`
- No temp tables — ใช้ inline UNNEST CTEs
- `QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1` สำหรับ snapshot
