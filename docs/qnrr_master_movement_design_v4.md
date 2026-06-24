> ⚠️ **DEPRECATED** — ใช้ `docs/qnrr_master_movement_design_v7.md` แทน
> ไฟล์นี้ล้าสมัย — สถานะ PM/ADMIN/VP ไม่ตรงกับความเป็นจริงแล้ว

---

# Master Movement Table — Design Spec v4
**วันที่:** 2026-06-22 (อัปเดตรอบสาม — session VP view v13)
**สถานะ:** Ground truth สมบูรณ์ — ใช้ไฟล์นี้เป็นอ้างอิงเดียว

---

## หลักการตั้งต้น

Master movement table คือ single source of truth ของบริษัท
ถ้า master ถูก ทุกระดับ (VP, Portfolio, Rep) จะถูกตาม — ย่อยลงมาจาก master ไม่ใช่ build แยกกัน

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

## เดือนฐาน (Mar Cohort) — updated v4

**Ownership:** outlet อยู่ใน mar_cohort ถ้า:
- Mar last order = KAM/PM/ADMIN **หรือ**
- Mar last order = SALE แต่ `first_portfolio_date < Apr` (อยู่พอร์ตมาก่อนแล้ว SALE แค่ spot)

**ยกเว้น:** outlet ที่มี `new_user_exp_date ใน Q (Mar/Apr/May/Jun)` + `prev_owner = SALE`
→ exclude ออกจาก mar_cohort → classify เป็น handover/new_sales แทน

**Base GMV:** `SUM(gmv_ex_vat)` ทุก order ใน March — ไม่ filter commercial_owner

---

## prev_owner — นิยาม

```
prev_owner = commercial_owner ของ order สุดท้าย ก่อน first_portfolio_date
(ข้ามเดือนได้ ไม่จำกัดแค่ March)
```

SQL pattern:
```sql
outlet_prev_owner AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS prev_owner
  FROM dwh.order o
  JOIN outlet_first_dollar ofd
    ON CAST(o.user_id AS STRING) = ofd.outlet_id
   AND DATE(o.delivery_date) < ofd.first_portfolio_date
  WHERE ...
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
)
```

---

## curr_gmv — หลักการ

- **curr_gmv** = SUM(gmv_ex_vat) WHERE commercial_owner IN ('KAM','PM','ADMIN') เท่านั้น
- **base_gmv** = SUM(gmv_ex_vat) ทุก order ใน March ไม่ filter commercial_owner
- **transfer_out curr_gmv** = 0 เสมอ

---

## Movement Types — นิยามที่ถูกต้อง (v4)

### Classification Priority

```
[1] core_nrr    : อยู่ใน mar_cohort
[2] expansion   : first_dollar_date >= Apr
                  AND first_portfolio_date >= Apr
                  AND first_dollar_owner != SALE
                  AND ไม่มี exp_date ใน Q
[3] handover    : exp_date = March AND prev_owner = SALE
[4] new_sales   : exp_date ใน Q AND prev_owner = SALE
                  หรือ first_portfolio_date >= Apr AND prev=SALE (fallback)
                  หรือ Scenario D (Mar GMV มี + first_portfolio ใน Q + prev=SALE + exp_date ก่อน Q)
[5] comeback    : first_dollar_date < Apr AND Mar GMV = 0 AND ไม่ผ่าน [1]-[4]
[6] transfer_out: mar_cohort ที่ย้ายออกไป SALE ใน Q
[7] unclassified: ELSE
```

### 4 Rules handover/new_sales (LOCKED)

| เงื่อนไข | movement |
|---|---|
| exp_date = March + prev = SALE | handover |
| exp_date = March + prev ≠ SALE | core_nrr |
| exp_date ใน Q + prev = SALE | new_sales |
| exp_date ใน Q + prev ≠ SALE | transfer_in |

**กฎสำคัญ:**
- exp_date เป็น priority เสมอ — check ก่อน prev_owner
- prev_owner ใช้แค่ verify ว่ามาจาก SALE จริง
- KAM→KAM ต่อให้ exp_date = March ก็ไม่ใช่ handover

### Scenario D — new_sales edge case
outlet ที่:
- Mar last owner = SALE (มี Mar GMV)
- exp_date ก่อน Q หรือไม่มี
- first_portfolio_date ใน Q
- prev_owner = SALE

→ **new_sales** (รอยต่อ SALE→KAM ที่ไม่มี formal exp_date ใน Q)

### expansion — conditions ครบ
```sql
first_dollar_date >= '2026-04-01'
AND first_portfolio_date >= '2026-04-01'
AND COALESCE(first_dollar_owner,'') != 'SALE'
AND (new_user_exp_date IS NULL
     OR FORMAT_DATE('%Y-%m', new_user_exp_date)
        NOT IN ('2026-03','2026-04','2026-05','2026-06'))
```

### comeback — conditions
```sql
first_dollar_date < '2026-04-01'
AND bg.gmv IS NULL  -- ← สำคัญ: ไม่มี Mar GMV จากทุก owner
AND (no exp_date ใน Q หรือ prev != SALE)
```

---

## LEG Structure (VP View)

### LEG A — outlet มี KAM/PM/ADMIN order เดือนนั้น
- `WHERE commercial_owner IN ('KAM','PM','ADMIN')`
- ดู classification จาก mar_cohort + CASE priority

### LEG B — mar_cohort ที่ไม่มี KAM/PM/ADMIN order เดือนนั้น
- transfer_out: ย้ายไป SALE หรือ PM/ADMIN (ขึ้นกับ level)
- core_nrr (curr_gmv=0): ยังอยู่พอร์ตแต่ไม่สั่ง
- **current_portfolio** ดูจาก last Q order จริง ไม่ใช่ mc.base_portfolio

---

## Portfolio Level — Architecture

### Mar cohort แยกตาม portfolio
- KAM mar_cohort = Mar last = 'KAM' (หรือ SALE spot + first_kam_date < Apr)
- PM mar_cohort = Mar last = 'PM' (หรือ SALE spot + first_pm_date < Apr)
- ADMIN mar_cohort = Mar last = 'ADMIN' (หรือ SALE spot + first_admin_date < Apr)

### Transfer types
- **inter** = ย้ายข้ามพอร์ต KAM↔PM↔ADMIN
- **external** = ออกไป SALE

### Reconcile checks
- C7: KAM+PM+ADMIN base_gmv = VP mar_cohort base (187.31M)
- C8: SUM(transfer_in) = SUM(transfer_out) across 3 portfolios = net 0

---

## Known Accepted Issues

| outlet | ปัญหา | impact | decision |
|---|---|---|---|
| 246875 | unclassified May/Jun (LEG C regression revert) | curr_gmv=0 | ยอมรับ |

---

## SQL Files

| ไฟล์ | version | สถานะ |
|---|---|---|
| `sql/q2_2026_movement_vp_view.sql` | v13 | ✅ validated C1–C5 |
| `sql/q2_2026_movement_kam_view.sql` | v1b | ⚠️ ต้อง sync fixes จาก VP v9–v13 |
| `sql/q2_2026_movement_pm_view.sql` | — | ❌ ยังไม่ได้เขียน |
| `sql/q2_2026_movement_admin_view.sql` | — | ❌ ยังไม่ได้เขียน |
| `sql/quarterly_nrr_2026_Q2_v5.sql` | v5 | ⚠️ stable แต่ยังไม่ reconcile กับ VP view |
