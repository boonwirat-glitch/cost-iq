# Handoff — 2026-06-24 — QNRR Movement Views (All 4 Views Complete)

## สถานะปัจจุบัน (ณ สิ้น session)

### ทุก view ✅ validated และ reconcile ผ่านแล้ว

| ไฟล์ | commit | สถานะ |
|---|---|---|
| `sql/q2_2026_movement_kam_view.sql` | `480888bde4`+ | ✅ ground truth — fixes ครบ — validated C1–C6 |
| `sql/q2_2026_movement_pm_view.sql` | `3b9cd9600e` | ✅ cloned จาก KAM — validated C1–C6 |
| `sql/q2_2026_movement_admin_view.sql` | `ab0ec05053` | ✅ cloned จาก KAM — validated C1–C6 |
| `sql/q2_2026_movement_vp_view.sql` | `480888bde4` | ✅ validated C1–C6 + C7/C8 reconcile |
| `sql/quarterly_nrr_2026_Q2_v5.sql` | — | ⚠️ ยังไม่ reconcile กับ portfolio views |

---

## Fixes ที่ทำใน session นี้

### KAM view (ground truth)
1. **base_portfolio NULL May/Jun** — `ELSE mc.base_portfolio` → `ELSE COALESCE(mc.base_portfolio, mo/jo.commercial_owner)`
2. **cohort_month May/Jun** — `WHEN exp_date IS NOT NULL` → `WHEN FORMAT_DATE IN Q months`
3. **base_portfolio handover/new_sales** — เปลี่ยนเงื่อนไขให้ mirror movement_type (`exp_date IN Q + effective_prev = SALE`) ครบทั้ง Apr/May/Jun

### PM / ADMIN view
- **Clone จาก KAM** — ทุก fix sync มาพร้อมกัน
- **LEG B revert** — `NOT EXISTS` → `LEFT JOIN IS NULL` pattern (เหมาะกับ PM/ADMIN ที่ไม่มี handover flow ซับซ้อน)
- KAM keywords แทนที่ถูกต้องทุกจุด — verified ไม่มี `'KAM'` หลงเหลือนอก transfer list

### VP view
- **effective_prev_owner** — เพิ่ม `first_dollar_owner` tiebreaker (6 occurrences ทุกเดือน)
- **base_portfolio SALE branch** — `exp_date IN ('2026-03'..'2026-06') + effective_prev = SALE` ทั้ง 3 เดือน
- **cohort_month May/Jun** — `IS NOT NULL` → `IN Q months`
- **[6b] new_sales Foodium case** — เพิ่มใน 3 เดือน → unclassified จาก 13 → 0

---

## Logic ที่ LOCK (final — ใช้เป็น reference)

### Classification Priority (ทุก level)
```
[1] core_nrr    : อยู่ใน mar_cohort
[2] expansion   : first_dollar_date >= Apr AND first_portfolio_date >= Apr
                  AND first_dollar_owner IN (KAM/PM/ADMIN)
                  AND ไม่มี exp_date ใน Q
[3] handover    : exp_date = March AND effective_prev = SALE
[4] new_sales   : exp_date ใน Q (Apr/May/Jun) AND effective_prev = SALE
[5] new_sales   : first_portfolio >= Apr + exp_date ใน Q + effective_prev = SALE (fallback A)
[6] new_sales   : first_dollar >= Apr + effective_prev = SALE + no exp_date (Foodium [6b])
[7] transfer_in : (portfolio level) มาจาก portfolio อื่นใน Q
[8] transfer_out: (portfolio level) ออกไป portfolio อื่นหรือ SALE
[9] comeback    : first_dollar < Apr AND Mar GMV = 0 (ทุก owner) AND ไม่ผ่าน [1]-[8]
[10] unclassified: ELSE (ต้อง = 0)
```

### effective_prev_owner (LOCKED)
```sql
COALESCE(
  CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
       ELSE po.prev_owner END,
  'SALE'
) = 'SALE'
```

### base_portfolio / base_staff_owner (LOCKED)
```sql
CASE
  WHEN exp_date IN ('2026-03','2026-04','2026-05','2026-06')
       AND effective_prev = 'SALE' THEN 'SALE'  -- handover + new_sales
  ELSE COALESCE(mc.base_portfolio, ao/mo/jo.commercial_owner)  -- Apr
  -- May: COALESCE(mc.base_portfolio, mo.commercial_owner)
  -- Jun: COALESCE(mc.base_portfolio, jo.commercial_owner)
END
```

### cohort_month (LOCKED)
```sql
CASE
  WHEN mc.outlet_id IS NOT NULL THEN '2026-03'
  WHEN FORMAT_DATE('%Y-%m', exp_date) IN ('2026-03','2026-04','2026-05','2026-06')
       THEN FORMAT_DATE('%Y-%m', exp_date)
  WHEN first_portfolio_date IS NOT NULL
       THEN FORMAT_DATE('%Y-%m', first_portfolio_date)
  ELSE NULL
END
```

### LEG B (LOCKED)
- **KAM**: `WHERE NOT EXISTS (SELECT 1 FROM dwh.order WHERE commercial_owner = 'KAM')` — handover flow ซับซ้อน ต้องการ strict check
- **PM/ADMIN**: `LEFT JOIN ao_pm/ao_admin IS NULL` — last-order based detection เหมาะกว่า

### VP vs Portfolio — ต่างกันโดย design
- `mar_handover_outlets`: VP exclude `exp_date IN Q ทั้งหมด (Mar-Jun)`, Portfolio exclude แค่ `= March`
- `mar_cohort`: VP fallback = `first_dollar_owner`, Portfolio fallback = hardcoded portfolio string
- transfer inter: VP ไม่แสดง (core_nrr แทน), Portfolio แสดง transfer_in/out
- LEG B: VP ใช้ `WHERE ao_port.outlet_id IS NULL`

---

## C7/C8 Reconcile Results (validated 2026-06-24)

### C7: base_gmv
| เดือน | KAM+PM+ADMIN | VP | diff | สาเหตุ |
|---|---|---|---|---|
| Apr | 193.71M | 191.64M | +2.07M | transfer_in base (1.95M) — by design |
| May | 197.55M | 194.63M | +2.92M | transfer_in base (2.79M) — by design |
| Jun | 200.30M | 195.92M | +4.37M | transfer_in base (4.24M) — by design |

### C8: curr_gmv
| เดือน | KAM+PM+ADMIN | VP | diff | สาเหตุ |
|---|---|---|---|---|
| Apr | 176.93M | 177.32M | -0.39M | inter-transfer outlets = core_nrr ใน VP — by design |
| May | 182.87M | 183.26M | -0.39M | same |
| Jun | 140.06M | 140.65M | -0.59M | same |

### Transfer inter symmetry
- Apr: 31 out / 32 in — Mala Social timing mismatch (data จริง ไม่ใช่ bug)
- May: 52 out / 51 in — Amatissimo Caffe timing mismatch
- Jun: 98 out / 95 in — 3 outlets timing mismatch

### Non-transfer movements
- expansion ✅, comeback ✅, handover ✅, new_sales (Apr) ✅ — ตรงกัน 100%
- new_sales May/Jun: Amatissimo + Gojiro = ADMIN จับเป็น new_sales, VP จับเป็น core_nrr — by design ของ VP ที่ใช้ first_portfolio_date global

---

## Known Accepted Issues

| outlet | ปัญหา | impact | decision |
|---|---|---|---|
| Mala Social สาขาบางรัก | transfer_in Apr ADMIN ก่อน KAM transfer_out (May) | timing จริง | ยอมรับ |
| Amatissimo Caffe | ADMIN new_sales vs VP core_nrr | by VP design | ยอมรับ |
| Gojiro ramen | ADMIN new_sales vs VP core_nrr | by VP design | ยอมรับ |
| ครัวนลิน | ติด 3 portfolio พร้อมกัน | data quality issue ใน source | flag ให้ ops ตรวจ dwh.order |

---

## Ground Truth GMV (locked)
Oct25=188.2M · Nov25=204.4M · Dec25=235.7M · Jan26=214.9M · Feb26=195.1M · Mar26=204.2M · Apr26=192.6M

**Jun normalization:** data ถึง Jun 23 (run Jun 24) → ÷23×30

---

## งานที่ยังต้องทำ

1. **Reconcile กับ quarterly_nrr_2026_Q2_v5.sql** — ยังไม่ได้ทำ
2. **Rep-level view** — `sql/q2_2026_movement_rep_view.sql` (derive จาก portfolio + staff_owner)
3. **dim.kam_roster migration** — replace hardcoded UNNEST arrays ใน ~14 SQL files
4. **UI integration** — นำ portfolio view ไปใช้ใน Freshket Sense QNRR tab
5. **NRR% normalization** — Jun ÷23×30

---

## Snapshot branch
`snapshot/pre-pm-admin-clone-sql` — state ก่อน session นี้เริ่ม


---

## Session 2026-06-25 — Squad (TL) View

### สิ่งที่ทำเสร็จ

**KAM view — เพิ่ม staff_email_map (commit 044b31ee93)**

Columns ที่เพิ่มต่อท้าย FINAL SELECT:
- base_tl, current_tl (Name / Ploy / unknown)
- tl_pivot: handover/new_sales ใช้ current_tl, movement อื่นใช้ base_tl, fallback current_tl
- base_kam_email, base_tl_email, current_kam_email, current_tl_email

Roster: 15 active KAM (มี email), Fang = Name (email null), May/Sojirat = Ploy (email null)

**Reconcile ผ่าน:**
- KAM view ก่อน/หลังเพิ่ม squad columns: GMV diff = 0 ทุก row
- TL view vs KAM grouped by tl_pivot: ตรงทุก row

---

### Logic Squad filter

- GMV ในมือ squad ตอนนี้: filter current_tl
- NRR ของ squad: filter tl_pivot
- Rep รายคน: filter base_kam_email หรือ current_kam_email

---

### Known Issues (Squad level)

- outlet ที่ base_tl และ current_tl blank (~700k): Sales/Admin ไม่อยู่ใน roster — ยอมรับ
- transfer_out base_tl = unknown (~120k): base_staff_owner เป็น Sales — by design

---

### Rep level — ยังไม่เสร็จ

sql/quarterly_nrr_2026_Q2_v7.sql สร้างแล้ว แต่ยังไม่ validate ครบ

ปัญหาที่เหลือ: outlet ของ Fang/May/Name ที่มี GMV ใน Q ถูก classify เป็น core_nrr_churn เพราะ current owner ไม่อยู่ใน roster ต้อง decide ก่อนทำต่อ

Bug ที่แก้แล้วใน v7:
- mar_cohort: LEFT JOIN แทน strict JOIN (KAM ลาออกไม่หลุด)
- LEG C: ลบ dim.user_master, ใช้ core_nrr_churn ทั้งหมด
- core/transfer detection: ใช้ base_kam_name แทน base_kam_email
- kam_list: เพิ่ม Name(TL)/Max/Snow เป็น No Owner

Snapshot: snapshot-2026-06-25-before-kam-email-merge
