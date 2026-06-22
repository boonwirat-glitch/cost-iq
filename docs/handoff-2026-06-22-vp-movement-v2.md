# Handoff — 2026-06-22 — VP Movement View (Session 2)

## สรุปงานที่ทำใน session นี้

ต่อจาก session แรก (handoff-2026-06-22-vp-movement.md) ที่ VP view ผ่าน C1–C6 แล้ว
session นี้ทำ 2 งานหลัก:

1. **ตรวจสอบ handover/new_sales logic** — พบ bug หลายจุด แก้ไขจน clean
2. **เริ่ม KAM portfolio view** — `sql/q2_2026_movement_kam_view.sql` v1b

ไฟล์หลักที่ใช้งานได้ตอนนี้:
- VP view: `sql/q2_2026_movement_vp_view.sql` — v13 (commit 4e3a61e30376 / revert ca6f8ff62e9e)
- KAM view: `sql/q2_2026_movement_kam_view.sql` — v1b (commit c435536cc88a) ← ยังไม่ sync fixes จาก VP v9+

---

## VP View — Version History (session นี้)

| version | commit | สิ่งที่แก้ |
|---|---|---|
| v7 | da74df9a | handover/new_sales require prev_owner=SALE (outlet_prev_owner CTE) |
| v8b | 1009b228 | fix expansion + first_dollar_owner (ANZALONEPIZZA) + restore LEFT JOIN |
| v9 | 206ac86c | mar_handover_outlets ครอบ Q ทั้งหมด (Mar/Apr/May/Jun) ไม่ใช่แค่ March |
| v10 | 63665729 | 3 edge cases: new_sales fallback + comeback + transfer_out current_portfolio |
| v11 | 40ae25ac | unclassified=0 + fallback COALESCE fix + Scenario D |
| v12 | 31e10f77 | Scenario D prev=SALE + pre-Q exp_date |
| v13 | 4e3a61e3 | mar_cohort รวม SALE spot order outlets (first_portfolio < Apr) |
| v14 | ec91acf3 | LEG C — **REGRESSION** → revert กลับ v13 |

**current = v13 (revert)** C1–C5 ✅ C6 ❌ 1 outlet (246875, impact=0 บาท ยอมรับได้)

---

## Business Logic ที่ LOCKED (updated)

### 1. prev_owner definition
- `outlet_prev_owner` CTE = last `commercial_owner` ก่อน `first_portfolio_date`
- ข้ามเดือนได้ — ไม่จำกัดแค่ March
- ใช้ QUALIFY ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY delivery_date DESC) = 1

### 2. handover / new_sales — 4 rules (LOCKED)

| เงื่อนไข | movement |
|---|---|
| exp_date = March + prev = SALE | handover |
| exp_date = March + prev ≠ SALE | core_nrr |
| exp_date ใน Q + prev = SALE | new_sales |
| exp_date ใน Q + prev ≠ SALE | transfer_in |

- exp_date เป็น priority เสมอ — ดูก่อน prev_owner
- prev_owner ใช้แค่ verify ว่ามาจาก SALE จริง
- KAM→KAM ต่อให้ exp_date = March ก็ไม่ใช่ handover

### 3. mar_handover_outlets
- exclude outlet ที่ exp_date ใน **Q ทั้งหมด** (Mar/Apr/May/Jun) + prev=SALE
- ออกจาก mar_cohort เพื่อ classify เป็น handover/new_sales แทน core_nrr
- outlet ที่ไม่มี prev order เลย (first order อยู่ใน portfolio แล้ว) ก็ exclude ด้วย

### 4. mar_cohort (updated v13)
- เดิม: Mar last order = KAM/PM/ADMIN เท่านั้น
- ใหม่: Mar last order = KAM/PM/ADMIN **หรือ** (Mar last = SALE + first_portfolio_date < Apr)
- เหตุผล: outlet ที่อยู่พอร์ตมาก่อนแล้ว แต่ Mar มี SALE spot order แทรก → ยังถือเป็น core cohort

### 5. expansion (updated v8b)
```sql
WHEN ofd.first_dollar_date >= '2026-04-01'
  AND ofd.first_portfolio_date >= '2026-04-01'
  AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
  AND (oed.new_user_exp_date IS NULL
       OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
          NOT IN ('2026-03','2026-04','2026-05','2026-06'))
THEN 'expansion'
```
- first_dollar_owner ต้องไม่ใช่ SALE
- ต้องไม่มี exp_date ใน Q

### 6. first_dollar_owner (updated v8b)
```sql
ARRAY_AGG(UPPER(TRIM(o.commercial_owner))
  ORDER BY o.delivery_date ASC LIMIT 1)[SAFE_OFFSET(0)]
```
- ดู first order ทุก owner (รวม SALE) ไม่ใช่แค่ KAM/PM/ADMIN
- ถ้า first order = SALE → expansion check ไม่ผ่าน

### 7. comeback (updated v10)
```sql
WHEN ofd.first_dollar_date < '2026-04-01'
  AND bg.gmv IS NULL  -- ไม่มี Mar GMV จากทุก owner
  AND (...)
THEN 'comeback'
```
- ต้อง bg.gmv IS NULL — outlet ที่มี Mar GMV (แม้ SALE) ไม่ใช่ comeback

### 8. new_sales fallback (updated v10+v12)
```sql
-- fallback 1: first_portfolio ใน Q + prev=SALE
WHEN ofd.first_portfolio_date >= '2026-04-01'
  AND COALESCE(po.prev_owner, '') = 'SALE'
THEN 'new_sales'

-- Scenario D: Mar GMV มี (SALE spot) + first_portfolio ใน Q + prev=SALE + exp_date ก่อน/ไม่มี Q
WHEN ofd.first_portfolio_date >= '2026-04-01'
  AND bg.gmv IS NOT NULL
  AND COALESCE(po.prev_owner, '') = 'SALE'
  AND (oed.new_user_exp_date IS NULL
       OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
          NOT IN ('2026-03','2026-04','2026-05','2026-06'))
THEN 'new_sales'
```

### 9. LEG B — current_portfolio (updated v10)
- transfer_out ดู current_portfolio จาก last Q order จริง (`ao_sale.commercial_owner`)
- ไม่ใช่ mc.base_portfolio เสมอ

---

## Ground Truth (VP view v13)

| เดือน | GMV (excl transfer_out) | diff vs dwh.order |
|---|---|---|
| Apr 2026 | 177,315,298 | +19 THB ✅ |
| May 2026 | 183,261,449 | +163 THB ✅ |
| Jun 2026 | 127,845,517 | (data ถึง Jun 22) |

Mar cohort base: **187.31M** (5,575 outlets)

| movement | Apr ร้าน | Apr GMV | May ร้าน | May GMV | Jun ร้าน | Jun GMV |
|---|---|---|---|---|---|---|
| core_nrr | 5,575 | 171.0M | 5,580 | 172.3M | 5,578 | 116.8M |
| handover | 116 | 3.0M | 115 | 3.1M | 102 | 1.9M |
| new_sales | 77 | 0.6M | 78 | 1.7M | 80 | 1.5M |
| expansion | 53 | 0.7M | 126 | 2.1M | 146 | 2.6M |
| comeback | 309 | 2.0M | 269 | 2.0M | 243 | 1.6M |
| transfer_out | 19 | 0 | 4 | 0 | 6 | 0 |

---

## Known Issues

| outlet | ปัญหา | impact | decision |
|---|---|---|---|
| 246875 (Mellow Steak) | C6 unclassified May/Jun (LEG C regression revert) | curr_gmv=0 ทั้งสองเดือน | ยอมรับ — ไม่ fix |

---

## งานที่ยังต้องทำ

1. **sync VP fixes → KAM view** — KAM view v1b ยังขาด fixes ตั้งแต่ v9 ขึ้นไป
2. **เขียน PM view** — `sql/q2_2026_movement_pm_view.sql`
3. **เขียน ADMIN view** — `sql/q2_2026_movement_admin_view.sql`
4. **reconcile C7/C8** — KAM+PM+ADMIN รวมกัน = VP view
5. **rep-level view** — derive จาก portfolio view
6. **reconcile กับ quarterly_nrr_2026_Q2_v5.sql**

---

## KAM Portfolio View — สถานะ

ไฟล์: `sql/q2_2026_movement_kam_view.sql` (v1b, commit c435536cc88a)

**ต้องทำก่อน run:**
- sync fixes จาก VP v9–v13 ทั้งหมด (mar_cohort, comeback, fallback, Scenario D, LEG B)
- KAM view v1b ยัง base อยู่ที่ logic เก่า

**test spec portfolio level:**
- C1: KAM curr_gmv = dwh.order WHERE commercial_owner='KAM' per month
- C2: inter transfer symmetry (รอ PM/ADMIN view)
- C3: transfer_out curr_gmv = 0
- C4: no duplicate
- C5: label lock
- C6: unclassified = 0
- C7: KAM+PM+ADMIN base_gmv = VP view mar_cohort base (187.31M)
- C8: SUM(transfer_in) = SUM(transfer_out) across 3 portfolios = net 0
