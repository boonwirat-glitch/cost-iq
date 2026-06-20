# Handoff — QNRR SQL Debug Session
**Date:** 2026-06-20
**Session focus:** quarterly_nrr_2026_Q2_reconcile.sql + quarterly_nrr_2026_Q2_new.sql

---

## สิ่งที่ทำสำเร็จในSession นี้

### 1. quarterly_nrr_2026_Q2_reconcile.sql — STABLE ✅
Reconcile SQL ใช้ได้แล้ว verified ครบทุก movement ยกเว้น core/core_churn
Ground truth CSV: `bquxjob_1e2a7bf_19ee3884628.csv`

**Movement counts (verified):**
| movement | Apr | May | Jun |
|---|---|---|---|
| comeback | 75 | 103 | 92 |
| expansion | 35 | 92 | 111 |
| handover | 34 | 34 | 31 |
| new_sales | 6 | 65 | 67 |
| transfer_in | 43 | 64 | 77 |
| transfer_out | 1 | 2 | 2 |

**Columns:** period_month, movement_type, outlet_id, outlet_name, account_id, account_name, account_type, curr_gmv, base_gmv, first_dollar_date, new_user_exp_date, prev_commercial_owner, prev_staff_owner, current_commercial_owner, current_staff_owner, period_tl_email

**Key logic fixes ที่แก้ระหว่าง session:**
- `outlet_first_dollar`, `pre_period_own`, `gmv` CTEs ไม่ filter `commercial_owner` → ข้อมูลครบ
- `pre_mar_own` ใช้สำหรับ handover/new_sales/comeback classification เท่านั้น
- `pre_apr/may/jun_own` ใช้สำหรับ `prev_commercial_owner` display
- `new_user_exp_date = Mar` → handover เสมอ ไม่ว่า pre-Mar owner จะเป็นใคร
- comeback ต้องไม่มี `new_user_exp_date` ใน Q
- expansion ต้องเช็ค `pmo.outlet_id IS NULL` (ไม่เคยมี order ก่อน Apr)
- `may_labels` CTE สำหรับ Jun inherit classification จาก May
- May/Jun fallback ใช้ `pre_mar_own` สำหรับ comeback classify

---

### 2. quarterly_nrr_2026_Q2_new.sql — ยังไม่ตรง ❌
**สถานะ:** Rewrite ใหม่ทั้งไฟล์แล้ว (commit ล่าสุด) แต่ยังมี diff vs reconcile ground truth:

| month | movement | reconcile | new_sql | diff |
|---|---|---|---|---|
| 2026-05 | expansion | 92 | 99 | +7 |
| 2026-05 | new_sales | 65 | 45 | -20 |
| 2026-05 | transfer_in | 64 | 78 | +14 |
| 2026-06 | comeback | 92 | 53 | -39 |
| 2026-06 | expansion | 111 | 79 | -32 |
| 2026-06 | new_sales | 67 | 44 | -23 |
| 2026-06 | transfer_in | 77 | 171 | +94 |

**Root cause ที่รู้แล้ว:**
- Jun LEG A มี `may_labels` JOIN แล้ว แต่ outlet ที่ไม่มี May order (May=NONE) ไม่อยู่ใน `may_labels` → ตก `ELSE 'transfer_in'` ผิด
- Jun-only fallback ยังขาด — ต้องเพิ่ม logic เดียวกับ reconcile SQL สำหรับ outlet ที่เข้ามาใน Jun โดยไม่ผ่าน Apr/May

**สิ่งที่ต้องทำต่อ:**
1. เพิ่ม Jun-only fallback ใน Jun LEG A — outlet ที่ไม่อยู่ใน `apr_labels` และไม่อยู่ใน `may_labels` ต้องดู `pre_jun_own`/`pre_mar_own` เหมือน reconcile SQL
2. Test CSV ใหม่เทียบกับ reconcile ground truth (`bquxjob_1e2a7bf`)
3. เมื่อตรงแล้ว → export CSV → upload R2 แทน `sense_qnrr_2026q2.csv`

---

## Key Logic ที่ verified แล้ว (จาก reconcile SQL)

```
Priority ใน classification:
1. expansion   — first_dollar >= Apr AND pmo IS NULL (ไม่เคยมี order ก่อน Apr)
2. handover    — new_user_exp_date = Mar (เสมอ ไม่ว่า pre-Mar owner จะเป็นใคร)
3. new_sales   — new_user_exp_date ใน Q AND (pmo = SALE OR pmo IS NULL)
4. core        — อยู่ใน mar_cohort
5. comeback    — pmo = KAM AND new_user_exp_date ไม่อยู่ใน Q
6. transfer_in — ELSE

Carry forward:
- apr_labels lock classification ตั้งแต่ Apr → May/Jun inherit
- may_labels lock classification ตั้งแต่ May → Jun inherit
- outlet ที่เพิ่งเข้า Jun ต้องดู pre_jun_own + pre_mar_own
```

---

## Files on GitHub

| file | status |
|---|---|
| `sql/quarterly_nrr_2026_Q2_reconcile.sql` | ✅ STABLE — verified |
| `sql/quarterly_nrr_2026_Q2_new.sql` | ❌ ยังต้องแก้ Jun fallback |
| `sql/quarterly_nrr_2026_Q2_v5.sql` | ✅ ใช้งานจริงบน R2 (rep scope) |

