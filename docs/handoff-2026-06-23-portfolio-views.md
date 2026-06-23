# Handoff — 2026-06-23 — Portfolio Views Session

## สรุปงานที่ทำใน session นี้

ต่อจาก session VP view (handoff-2026-06-22-vp-movement-v2.md)
session นี้ build + validate portfolio views ทั้ง 3 ไฟล์

---

## Logic ที่ lock ใหม่ใน session นี้

### 1. handover/new_sales ต้อง prev = SALE เสมอ (ไม่มีข้อยกเว้น)
- VP view v7 เดิมไม่เช็ค prev — แก้แล้ว
- 3 outlets (244245, 242788, 241888) เปลี่ยนจาก handover → core_nrr

### 2. mar_cohort เพิ่ม SALE spot condition
- outlet ที่ Mar last = SALE แต่ first_portfolio < Apr → ยังอยู่ใน cohort
- ป้องกัน outlet ที่อยู่พอร์ตมานานแต่ SALE แวะมาสั่ง Mar → หลุดออก

### 3. mar_handover_outlets ครอบ Q ทั้งหมด
- เดิม: exclude เฉพาะ exp_date = March
- ใหม่: exclude exp_date ใน Q ทั้งหมด (Mar/Apr/May/Jun) + prev=SALE

### 4. expansion ต้องไม่มี exp_date ใน Q + fd_owner ≠ SALE
- ป้องกัน outlet เช่น ANZALONEPIZZA ถูก classify เป็น expansion ผิด

### 5. comeback ต้อง Mar GMV = 0 (ทุก owner)
- `bg.gmv IS NULL` — outlet ที่มี Mar GMV (แม้ SALE) ไม่ใช่ comeback

### 6. new_sales fallback ต้องมี exp_date ใน Q
- เดิม: first_portfolio >= Apr + prev=SALE → new_sales (กว้างเกิน)
- ใหม่: ต้องมี exp_date ใน Apr/May/Jun ด้วย
- outlet exp_date ก่อน Q + กลับมาสั่งใน Q → **comeback** ไม่ใช่ new_sales

### 7. Scenario D — ยกเลิก (obsolete)
- เคยเพิ่มสำหรับ outlet Mar GMV มี (SALE) + first_portfolio ใน Q
- ถูก cover โดย new_sales fallback + comeback แล้ว
- ลบออกจากทุก view

### 8. LEG B current_portfolio/base_portfolio ไม่ hardcode
- ดูจาก last Q order จริง
- `base_portfolio = mc.base_portfolio` (dynamic)
- `current_portfolio = COALESCE(ao_port.commercial_owner, ao_sale.commercial_owner, mc.base_portfolio)`

### 9. cdp_res_name / cdp_account_name
- ทุก view เปลี่ยนจาก `res_name` / `account_name` (order-stamped)
- เป็น `cdp_res_name` / `cdp_account_name` (latest master data)

---

## VP View — Final State (v13+)

**file:** `sql/q2_2026_movement_vp_view.sql`
**checks:** C1–C6 ✅

| movement | Apr ร้าน | Apr GMV | May ร้าน | May GMV | Jun ร้าน | Jun GMV |
|---|---|---|---|---|---|---|
| core_nrr | 5,575 | 171.0M | 5,580 | 172.3M | 5,578 | 116.8M |
| handover | 116 | 3.0M | 115 | 3.1M | 102 | 1.9M |
| new_sales | 82 | 0.6M | 235 | 2.4M | 260+ | — |
| expansion | 53 | 0.7M | 126 | 2.1M | — | — |
| comeback | 309 | 2.0M | 269+ | — | — | — |
| transfer_out | ~19 | 0 | — | — | — | — |

Mar cohort base: **187.3M** (5,575 outlets)

---

## Portfolio Views — สถานะ

### KAM view ✅ validated
**file:** `sql/q2_2026_movement_kam_view.sql`
- C1–C6 ✅
- C1 diff < 7K from 131M — rounding ✅
- Mar cohort base: 136.89M (2,697 outlets)
- transfer_in scope = inter ✅
- base_portfolio = dynamic ✅

### PM view ⚠️ รอ re-run
**file:** `sql/q2_2026_movement_pm_view.sql`
- fixes หลายรอบหลัง last run
- Mar cohort base: 22.84M (734 outlets)
- ต้อง re-run + verify C1–C6

### ADMIN view ⚠️ รอ re-run
**file:** `sql/q2_2026_movement_admin_view.sql`
- fixes หลายรอบหลัง last run
- Mar cohort base: 25.81M (2,120 outlets)
- ต้อง re-run + verify C1–C6

---

## Key Fixes Timeline (session นี้)

| commit | fix |
|---|---|
| da74df9 | VP v7: handover/new_sales require prev=SALE |
| 904cf72 | VP v8: expansion + first_dollar_owner fix |
| 206ac86 | VP v9: mar_handover_outlets ครอบ Q ทั้งหมด |
| 63665729 | VP v10: 3 edge cases (new_sales fallback, comeback, LEG B) |
| 4e3a61e | VP v13: mar_cohort รวม SALE spot outlets |
| b811d54 | PM view v1 created |
| edbb7f9 | ADMIN view v1 created |
| 95d803a | VP: new_sales fallback ต้องมี exp_date ใน Q |
| c076f57 | KAM: sync fix |
| d29f40e | PM: sync fix |
| cfd1c2c | ADMIN: sync fix |
| 6843acc | PM: remove hardcoded KAM |
| be45d29 | ADMIN: remove hardcoded KAM |

---

## งานที่ต้องทำใน session หน้า

### Priority 1 — Re-run และ validate PM/ADMIN
```
1. Run sql/q2_2026_movement_pm_view.sql → upload CSV → verify C1–C6
2. Run sql/q2_2026_movement_admin_view.sql → upload CSV → verify C1–C6
```

### Priority 2 — C7/C8 cross-portfolio verify
```
C7: KAM base_gmv + PM base_gmv + ADMIN base_gmv = VP mar_cohort base (187.3M)
C8: SUM(transfer_in inter) = SUM(transfer_out inter) across KAM+PM+ADMIN per month
```
ต้องการ CSV ทั้ง 4 ไฟล์ run พร้อมกันวันเดียวกัน

### Priority 3 — Rep-level view
derive จาก portfolio view + เพิ่ม `staff_owner` dimension
```
q2_2026_movement_rep_view.sql
```

### Priority 4 — Reconcile กับ v5
6 divergence points ที่รู้อยู่แล้ว:
1. account_type filter ต่างกัน
2. curr_gmv scope ต่างกัน (v5 ไม่ filter commercial_owner)
3. comeback definition ต่างกัน
4. handover classification ต่างกัน
5. expansion GMV=0 label lock
6. silent outlet handling (v5 ใช้ dim.user_master)

---

## Files ที่แก้ใน session นี้

```
sql/q2_2026_movement_vp_view.sql    ← หลายรอบ (v7→v13+)
sql/q2_2026_movement_kam_view.sql   ← built + validated
sql/q2_2026_movement_pm_view.sql    ← built + fixes (รอ re-run)
sql/q2_2026_movement_admin_view.sql ← built + fixes (รอ re-run)
docs/qnrr_master_movement_design_v5.md  ← this session
docs/handoff-2026-06-23-portfolio-views.md ← this file
```

---

## Data Reference

**Ground Truth GMV (dwh.order, no filter):**
Oct25=188.2M, Nov25=204.4M, Dec25=235.7M, Jan26=214.9M, Feb26=195.1M, Mar26=204.2M, Apr26=192.6M

**Portfolio GMV Apr (commercial_owner filter):**
- KAM: 131,727,467
- PM: 21,225,836
- ADMIN: 24,361,976
- Total: 177,315,279 ✅ ตรงกับ VP C1

**Jun data:** ถึง Jun 22 (run Jun 23) = 22 วัน
