# Freshket Sense — Handover & Movement Data Pipeline
## Session Summary & Next Steps

**สถานะ:** Q10 + Q11 validated และ push ขึ้น GitHub แล้ว  
**วันที่:** May 2026

---

## สิ่งที่ทำเสร็จแล้ว ✅

### Q10 — Commission Handover (Apr→May)
**File:** `sql/Q10_commission_handover_final.sql`  
**Output:** `portview_handover.csv` (R2)  
**Validated:** 44 rows ตรงกับ manual sheet

**Logic:**
- Grain: outlet level
- PATH A: `new_user_exp_date` ใน Apr + `sales_owner` มีค่า
- PATH B: last SALE order ใน Apr (6-month window) → KAM รับ
- Exclude: effective_sales_owner = Admin Freshket
- QUALIFY: dedup user_master ก่อน filter commercial_owner=KAM

**Known issue:** 243573 อยู่ใน Q10 Apr แต่จริงๆ KAM รับใน May — SALE Apr 21-30, KAM May 17

---

### Q11 — Current Month Movements (May Portview)
**File:** `sql/Q11_current_movements_v2.sql`  
**Output:** `portview_current_movements.csv` (R2, ยัง pending upload)  
**Validated:** new_sales 18/18 ✅

**Logic:**
- **new_sales** (outlet level): Sales→KAM handover May
  - PATH A: `new_user_exp_date` ใน May + `sales_owner`
  - PATH B: SALE order ใน May มาก่อน KAM order ใน May
  - PATH C: `first_kam_date` ใน May + `first_any_order_date` ก่อน May + `sales_owner` (จับ case ที่ order เดือนละครั้ง)
- **transfer_in** (account level): Apr commercial_owner = KAM/PM/ADMIN แล้ว May KAM เปลี่ยน
- **transfer_out** (outlet level): Apr KAM order แต่ปัจจุบัน owner เปลี่ยน

---

### Code (v251) — push แล้ว ✅
- `08_patches.js`: ลบ `lookupHandover(g.acctId)` ออกจาก Portview Transfer In (contamination fix)
- `02_data_pipeline.js`: เพิ่ม Q11 parser → `window.bulkCurrentMovementData`
- `sw.js`: bump v248 → v251

---

## สิ่งที่ต้องทำ Session หน้า ❌

### 1. Upload CSV ขึ้น R2
- [ ] Export Q10 final → `portview_handover.csv` → upload R2
- [ ] Export Q11 v2 → `portview_current_movements.csv` → upload R2
- [ ] Export Q3c upsell team → `sense_upsell_team.csv` → upload R2 (pending มาก่อน)

### 2. แก้ code: ใช้ Q11 ใน Portview (07b_commission_ui.js)
ปัจจุบัน Portview ยังใช้ `bulkHandoverData` (Q10) classify transfer_in vs new_sales  
ต้องแก้ให้ใช้ `bulkCurrentMovementData` (Q11) แทน

**จุดที่ต้องแก้:**
```javascript
// 07b_commission_ui.js ~line 1580
// ปัจจุบัน: lookup Q10 byAccountId → แยก new_sales vs transfer_in
const hoRow = hd.byAccountId && hd.byAccountId[a.id];

// ต้องเปลี่ยนเป็น: lookup Q11 byAccountId
const cm = bulkCurrentMovementData?.byAccountId?.[a.id];
```

**transfer_out** ปัจจุบันใช้ Q10 `byKamName` (Apr data) → ต้องเปลี่ยนเป็น Q11

### 3. Handle 243573
- อยู่ทั้ง Q10 Apr commission และ Q11 May Portview
- ถ้าต้องการให้อยู่แค่ May: ต้อง manual exclude จาก Q10

### 4. Validate หลัง upload R2
- เปิด app ตรวจ Portview: Transfer In / New Sales / Transfer Out แสดงถูกมั้ย
- ตรวจ commission ของ KAM ที่มี handover: Ning, Foam, Tape, Dent, Pop

---

## Key Decisions ที่ lock แล้ว

| เรื่อง | Decision |
|---|---|
| transfer_in grain | account level (ถ้า account มี Apr KAM → ทุก outlet = transfer_in) |
| new_sales grain | outlet level |
| transfer_out grain | outlet level |
| PM owner (Ploiiy) | ไม่นับใน KAM movement — commercial_owner=PM ถูกต้องแล้ว |
| 243573 | อยู่ใน Q11 May, ยอมรับว่าอยู่ใน Q10 Apr ด้วย |
| expansion | คำนวณใน app `_groupNRR()` ไม่อยู่ใน Q11 |
| PATH C condition | first_kam ใน May + first_any_order ก่อน May + sales_owner มีค่า |

---

## File Locations

| File | Location |
|---|---|
| Q10 SQL | `sql/Q10_commission_handover_final.sql` |
| Q11 SQL | `sql/Q11_current_movements_v2.sql` |
| App code | `src/02_data_pipeline.js`, `src/07b_commission_ui.js`, `src/08_patches.js` |
| R2 files | `portview_handover.csv`, `portview_current_movements.csv` |
