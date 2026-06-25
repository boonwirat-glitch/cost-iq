# Handoff — 2026-06-25 — QNRR Rep-level v8

## สถานะปัจจุบัน

| ไฟล์ | commit | สถานะ |
|---|---|---|
| `sql/quarterly_nrr_2026_Q2_v8.sql` | `909bb4f4455c` | ✅ pushed — ยังไม่ได้รัน BigQuery |
| `sql/q2_2026_movement_kam_view.sql` | `044b31ee93` | ✅ validated ground truth (portfolio) |

---

## Root causes ที่แก้ใน v8 (จาก v5–v7)

### Bug 1: Roster design ผิด (v5–v7)
- v5–v7 join kam_list ด้วย email → Fang/May (email=null) ไม่ match → outlet ของพวกเขาถูก classify ผิด
- **v8 fix**: mar_cohort ไม่ join kam_list — capture ทุก outlet ที่ `commercial_owner = 'KAM'` ใน Mar (รวม resigned)
- kam_list ใน v8 = active 15 + Fang + May (email null) — ใช้แค่ TL mapping เท่านั้น

### Bug 2: Transfer_out detection พัง (v7)
- v7 ใช้ `base_kam_email != current_email` → NULL != x = NULL → resign outlet ไม่ generate transfer_out
- **v8 fix**: LEG B ใช้ `TRIM(ao.staff_owner) != TRIM(mc.base_kam_name)` ทุกที่ (staff_owner เป็น key)
- ครอบคลุม: Fang/May outlet → transfer_out row + transfer_in ของ KAM ใหม่

### Bug 3: May/Jun label propagation ผิด (v5–v7)
- v5–v6 join `apr_labels` ด้วย email → miss outlet ที่ KAM เปลี่ยนระหว่าง Apr→May
- v7 แก้เป็น join ด้วย `period_kam_name` แต่ยัง depend `apr_labels` → ถ้า outlet ไม่มีใน Apr มันได้ `al.outlet_id IS NULL` → new_sales ผิด
- **v8 fix**: May/Jun re-classify จาก mar_cohort โดยตรง ไม่ depend apr_labels เลย

### Bug 4: Expansion logic (v5–v7)
- ใช้ `COALESCE(ep.eff_prev, 'SALE') != 'SALE'` → outlet ใหม่แท้ที่ไม่มี pre_kam_owner จะ COALESCE เป็น SALE → ไม่ได้ expansion
- **v8 fix**: ใช้ `ofd.first_dollar_owner != 'SALE'` แทน — capture first_dollar_owner ของ order แรกสุด

---

## Design decisions ที่ lock ใน v8

### mar_cohort criteria
```sql
WHERE (
  mo.commercial_owner = 'KAM'
  OR (
    mo.commercial_owner = 'SALE'  -- SALE spot แต่เคยมี KAM owner ก่อน Mar
    AND ofd.first_kam_date IS NOT NULL
    AND ofd.first_kam_date < '2026-04-01'
  )
)
  AND COALESCE(bg.gmv, 0) > 0
  -- Exclude handover: exp_date = Mar + pre_kam = SALE
  AND NOT (
    FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = '2026-03'
    AND COALESCE(pko.pre_kam_commercial_owner, 'SALE') = 'SALE'
  )
```

### Classification priority (per LEG A)
```
[1] core        — อยู่ใน mar_cohort ของ KAM คนนี้ (staff_owner match)
[2] expansion   — first_dollar >= Apr + first_kam >= Apr + first_dollar_owner != SALE + ไม่มี exp_date Q
[3] handover    — exp_date = Mar + eff_prev = SALE
[4] new_sales   — exp_date ใน Q + eff_prev = SALE
[5] new_sales   — first_kam >= Apr + eff_prev = SALE (fallback)
[6] new_sales   — first_dollar >= Apr + eff_prev = SALE + ไม่มี exp_date (Foodium)
[7] transfer_in — อยู่ mar_cohort แต่ base_kam_name != period_kam_name
[8] comeback    — first_dollar < Apr + ไม่อยู่ mar_cohort
[9] transfer_in — ELSE
```

### effective_prev (eff_prev)
```sql
COALESCE(
  CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE pko.pre_kam_commercial_owner END,
  'SALE'
)
```

### LEG B transfer_out (ทุกเดือน)
- Detect ด้วย `TRIM(period_staff_owner) != TRIM(mc.base_kam_name)`
- NOT EXISTS ตรวจ KAM เดิมไม่มี order ใน period นั้น
- ครอบคลุม: outlet เปลี่ยนไป KAM อื่น หรือ PM/ADMIN/SALE

### LEG C silent outlets
- ทุก outlet ที่ไม่มี order ใน period = `core_nrr_churn` (ไม่มี dim.user_master)

### Resigned KAM (Fang/May) behavior
- Fang/May อยู่ใน kam_list แต่ email = NULL
- outlet ของพวกเขาใน mar_cohort: base_kam_email = NULL, base_kam_name = staff_owner จริง
- Apr/May/Jun: ถ้า outlet ย้ายไป active KAM คนใหม่:
  - transfer_out row: period_kam_name = Fang/May (base), curr_gmv = 0
  - transfer_in row: period_kam_name = KAM ใหม่

---

## Reconcile checklist (ทำใน BigQuery ก่อน validate)

### C1: mar_cohort outlet count
```sql
-- v8 ควรมี outlet ≥ v7 (เพราะ LEFT JOIN แทน INNER JOIN)
SELECT COUNT(*) FROM mar_cohort_v8
-- เทียบกับ v7: อาจต่างกันถ้า Fang/May outlet ถูกจับเพิ่ม
```

### C2: base_gmv sum ต้องใกล้เคียง KAM portfolio view
```sql
SELECT SUM(base_gmv) FROM v8 WHERE period_month = '2026-04' AND movement_type IN ('core_nrr','core_nrr_churn','transfer_out')
-- ควรใกล้เคียงกับ KAM portfolio view base_gmv (Apr)
```

### C3: transfer symmetry
- transfer_out ของ KAM A ควร match transfer_in ของ KAM B
- outlet_id ของ transfer_out ควรปรากฏเป็น transfer_in ในชื่ออื่น

### C4: unclassified = 0
```sql
SELECT COUNT(*) FROM v8 WHERE movement_type = 'unclassified'
-- ต้องเป็น 0
```

### C5: Fang/May outlets
```sql
SELECT * FROM v8 WHERE base_kam_name LIKE '%Fang%' OR base_kam_name LIKE '%Sojirat%'
-- ควรมี transfer_out rows ใน Apr/May/Jun
```

### C6: ทุก core outlet ในเดือน Apr มี base_gmv > 0
```sql
SELECT COUNT(*) FROM v8 WHERE period_month = '2026-04' AND movement_type IN ('core_nrr','core_nrr_churn') AND base_gmv = 0
-- ต้องเป็น 0
```

---

## Known differences vs KAM portfolio view (expected)

| รายการ | v8 rep-level | KAM portfolio view | เหตุผล |
|---|---|---|---|
| transfer_out จาก resigned KAM | มี Fang/May transfer_out rows | ไม่แยกรายคน | v8 drill down ถึง staff_owner |
| base_gmv aggregate | sum ทุก KAM ควรตรง | aggregate โดยตรง | ต้อง verify |
| curr_gmv | filter `commercial_owner = 'KAM'` เหมือนกัน | เหมือนกัน | ควรตรง |

---

## Snapshot branch
`snapshot-2026-06-25-before-nrr-v8` — state ก่อน v8

---

## งานที่ยังต้องทำ

1. **รัน v8 ใน BigQuery** — ดู unclassified count และ movement breakdown
2. **Reconcile กับ KAM portfolio view** — C2/C3/C5 checklist ด้านบน
3. **Fix ถ้ามี** — สร้าง v8.1 หรือแก้ตรง
4. **UI integration** — นำ data เข้า Freshket Sense QNRR tab
