# Handoff — 2026-06-22 — VP Movement View Session

## สรุปงานที่ทำในวันนี้

session นี้เริ่มจาก `q2_2026_master_movements_v4.sql` ที่มีปัญหา double count และ architecture ผิด
แล้วสรุปว่าทำ `q2_2026_movement_vp_view.sql` แยกออกมาใหม่แทน

ไฟล์หลักที่ใช้งานได้ตอนนี้: `sql/q2_2026_movement_vp_view.sql` (commit dbd3454)
Snapshot ก่อน first_portfolio_date change: `sql/q2_2026_movement_vp_view_v5_snapshot.sql`

---

## VP View SQL — ผ่าน Check ทุกข้อแล้ว

### Ground truth (dwh.order WHERE commercial_owner IN KAM/PM/ADMIN)
- Apr 2026: 177,315,279 THB
- May 2026: 183,261,286 THB
- Jun 2026: 127,847,007 THB (data ถึง Jun 21)

### Check results (CSV: bquxjob_241aa8c0_19eed1861a2.csv)
- C1 ✅ GMV ตรง dwh.order ทุกบาท (Jun diff -1 บาท = rounding ยอมรับได้)
- C2 ✅ ไม่มี transfer_in เลย
- C3 ✅ transfer_out scope = external เท่านั้น
- C4 ✅ ไม่มี duplicate outlet per month
- C5 ✅ label lock สมบูรณ์
- C6 ✅ unclassified = 0

---

## Business Logic ที่ LOCKED

### Classification Priority (เหมือนกันทุกเดือน ไม่ต้องมี label CTE)
1. **core_nrr** — อยู่ใน mar_cohort (curr_gmv=0 ก็ยังเป็น core_nrr ไม่ใช่ churn แยก)
2. **expansion** — `first_dollar_date >= Apr` AND `first_portfolio_date >= Apr`
   - first_dollar ต้องตกในมือ KAM/PM/ADMIN ด้วย ไม่ใช่ SALE
3. **handover** — `new_user_exp_date = March` เท่านั้น (ไม่มี fallback อื่น)
4. **new_sales** — `new_user_exp_date IN (Apr/May/Jun)` หรือ `first_portfolio_date >= Apr` (fallback เมื่อ fd_global < Apr)
5. **comeback** — `first_dollar_date < Apr` + ไม่มี exp_date ใน Q (รวม exp_date ก่อน Mar)
6. **unclassified** — ELSE (ใช้ตรวจสอบ ไม่ควรมี)

### GMV Definition
- **curr_gmv** = SUM(gmv_ex_vat) WHERE commercial_owner IN (KAM,PM,ADMIN) เท่านั้น
  → ทำให้ equation ถูก: KAM/PM/ADMIN + SALE + B2C = Total Freshket GMV
- **base_gmv** = SUM(gmv_ex_vat) ทุก order ใน March ไม่ filter commercial_owner
  → handover/new_sales มี base_gmv จาก Mar GMV จริง (ไม่ใช่ 0)

### cohort_month
- มี `new_user_exp_date` → ใช้เดือนของ exp_date เสมอ
- ไม่มี exp_date → ใช้เดือนของ `first_portfolio_date` (วันแรกที่เข้ามาอยู่ในพอร์ต KAM/PM/ADMIN)

### outlet_first_dollar CTE (สำคัญมาก)
```sql
SELECT
  CAST(o.user_id AS STRING) AS outlet_id,
  MIN(DATE(o.delivery_date)) AS first_dollar_date,
  MIN(CASE WHEN commercial_owner IN ('KAM','PM','ADMIN')
           THEN DATE(o.delivery_date) END) AS first_portfolio_date,
  ARRAY_AGG(CASE WHEN commercial_owner IN ('KAM','PM','ADMIN')
                 THEN commercial_owner END
            IGNORE NULLS ORDER BY delivery_date ASC LIMIT 1)[SAFE_OFFSET(0)]
    AS first_dollar_owner
```
- `first_dollar_date` = global first order (ทุก owner)
- `first_portfolio_date` = first order ในมือ KAM/PM/ADMIN เท่านั้น
- `first_dollar_owner` = owner ของ first KAM/PM/ADMIN order

### outlet_exp_date CTE
```sql
SELECT CAST(o.user_id AS STRING) AS outlet_id,
       DATE(MAX(o.new_user_exp_date)) AS new_user_exp_date
WHERE new_user_exp_date IS NOT NULL
  AND DATE(new_user_exp_date) <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
```
- ดึงครั้งเดียวใช้ทั้งไตรมาส (exp_date เป็น property ของ outlet ไม่เปลี่ยนตามเดือน)
- cap ที่ yesterday ป้องกัน future exp_date ปน

### mar_cohort
- last order Mar = KAM/PM/ADMIN + base_gmv > 0 + ไม่อยู่ใน mar_handover_outlets
- mar_handover_outlets = outlet ที่มี new_user_exp_date = March ใน Mar orders

### LEG B (ทุกเดือน)
- Mar cohort ที่ไม่มี order ใน KAM/PM/ADMIN เดือนนั้นเลย
- ถ้ามี order ใน SALE → `transfer_out` (external, curr_gmv=0)
- ถ้าไม่มี order เลย → `core_nrr` (curr_gmv=0, churn signal)

---

## สิ่งที่ยังไม่ได้ทำ

- `movement_squad_view` (TL level — inter-portfolio transfer visible)
- `movement_rep_view` (Rep level — intra staff transfer visible)
- `q2_2026_master_movements_v4.sql` มีปัญหาหลายจุด (double count) ยังไม่ได้ fix
  → ไม่ควรใช้ไฟล์นี้ ใช้ `q2_2026_movement_vp_view.sql` แทน
- NRR % formula application (÷days normalization) ยังไม่ได้ทำ
- UI integration ใน Freshket Sense app

---

## Key Learnings จาก Session นี้

1. **VP view ไม่สนใจ inter-portfolio transfer** — outlet ที่โอนจาก PM→KAM ใน Q ยังเป็น core_nrr ใน current_portfolio เสมอ
2. **curr_gmv ต้อง filter commercial_owner** เพื่อให้ equation บริษัทถูก
3. **exp_date เป็น property ของ outlet** ไม่ต้องดึงจาก last order รายเดือน ดึงครั้งเดียวใช้ทั้งไตรมาส
4. **ไม่ต้องมี label CTE** — ถ้า priority ถูกต้องและครบ classify เดือนไหนก็ได้ label เดิมทุกครั้ง
5. **core_nrr_churn ไม่ใช่ movement type** — เป็นแค่ metric ที่คำนวณจาก curr_gmv=0 ของ core_nrr rows
6. **handover fallback ห้ามใช้ first_portfolio_date** — ถ้า new_user_exp_date ก่อน Mar แสดงว่าโอนมาก่อน Q ไม่ใช่ handover
