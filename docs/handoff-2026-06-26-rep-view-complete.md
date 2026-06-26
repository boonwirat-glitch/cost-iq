# Handoff — 2026-06-26 — Rep View Complete

## สถานะปัจจุบัน (ณ สิ้น session)

| ไฟล์ | commit | สถานะ |
|---|---|---|
| `sql/q2_2026_movement_rep_view.sql` | `0ff7a3daa838` | ✅ validated — clean |
| `sql/q2_2026_movement_tl_view.sql` | `078bc8a531` | ✅ validated — clean |
| `sql/q2_2026_movement_kam_view.sql` | `3d33046ed3` | ✅ validated |
| `sql/q2_2026_movement_pm_view.sql` | `5910dfb5ce` | ✅ validated |
| `sql/q2_2026_movement_admin_view.sql` | `23f1b1cc2c` | ✅ validated |
| `sql/q2_2026_movement_vp_view.sql` | `88bd9ce170` | ✅ validated |

---

## Rep View — Design (FINAL)

### Goal
ดู performance ของ KAM แต่ละคน วัดจาก outlet ที่ถืออยู่ล่าสุด (ณ วันที่ดึง data)

### Grain
`outlet × period_month × latest_staff_owner`

### Key columns

| column | ความหมาย |
|---|---|
| `latest_staff_owner` | KAM ที่ถือ outlet ล่าสุด ณ วันที่ดึง — **grain หลัก** |
| `base_staff_owner` | KAM ที่ถือ outlet ใน Mar (base month) |
| `period_staff_owner` | KAM ที่ถือ outlet ใน period นั้น |
| `latest_commercial_owner` | portfolio ล่าสุด (KAM/PM/ADMIN) |
| `base_portfolio` | portfolio ใน Mar — PM/ADMIN สำหรับ transfer_in, KAM สำหรับ core_nrr |
| `base_tl` / `latest_tl` | TL ของ base_staff / latest_staff |

### Filter ใช้งาน
- ดู KAM คนหนึ่ง → `latest_staff_owner = 'Chaklid (Dent) Nimraor'`
- ดู TL → `latest_tl = 'Name'`
- ดูรวม KAM portfolio → ไม่ filter ใคร

### NRR Formula (rep level)
```
denom = SUM(base_gmv) WHERE movement_type IN ('core_nrr','transfer_in','transfer_out')
numer = SUM(curr_gmv) WHERE movement_type IN ('core_nrr','transfer_in')
```

---

## Rep View vs TL View — ต่างกันอย่างไร

| จุด | TL view | Rep view |
|---|---|---|
| grain | outlet × month × base_staff (Mar) | outlet × month × latest_staff |
| internal transfer | ไม่แยก — core_nrr ตลอด | แยก transfer_in/out |
| Fang/May outlet | base_staff = Fang → core_nrr | ย้ายไป Nitcha → ขึ้นเป็น transfer_in ของ Nitcha |
| base_gmv ซ้ำ | ไม่มี | ไม่มี (latest_staff คนเดียว) |
| curr_gmv รวม | ตรงกัน ✅ | ตรงกัน ✅ |

---

## Movement Types ใน Rep View

| movement | ความหมาย | นับใน NRR |
|---|---|---|
| `core_nrr` | Mar cohort ที่ยังอยู่กับ KAM เดิม + ซื้ออยู่ | numer + denom |
| `transfer_in` | รับ outlet มาจาก PM/ADMIN portfolio | numer + denom |
| `transfer_out` | outlet ออกไปจาก KAM portfolio (ไป PM/ADMIN/SALE) | denom เท่านั้น |
| `handover` | SALE handover เข้า KAM ใน Q | ไม่นับ NRR |
| `new_sales` | outlet ใหม่จาก SALE ใน Q | ไม่นับ NRR |
| `expansion` | outlet ใหม่แท้ (ไม่เคย SALE มาก่อน) | ไม่นับ NRR |
| `comeback` | เคยซื้อ แต่หยุดแล้วกลับมา | ไม่นับ NรR |

**ไม่มี** `core_nrr_transfer_in/out` — ใช้ `transfer_in/out` ตรงๆ เหมือน TL view

---

## base_portfolio / base_staff_owner ใน Rep View

```
transfer_in จาก PM/ADMIN:
  base_portfolio = 'PM' หรือ 'ADMIN' (จาก mar_own จริง)
  base_staff_owner = PM/ADMIN staff ใน Mar (จาก mar_pm_admin_staff CTE)

core_nrr / transfer_out:
  base_portfolio = 'KAM'
  base_staff_owner = mar_staff_owner (KAM ใน Mar)

handover / new_sales:
  base_portfolio = 'SALE'
  base_staff_owner = SALE staff ใน Mar (จาก mar_sale_owner CTE)
```

---

## mar_handover_outlets (อัปเดต session นี้)

ทุก view (PM, ADMIN, REP) ใช้ `IN ('2026-03','2026-04','2026-05','2026-06')` แล้ว
ไม่ใช่ `= '2026-03'` อีกต่อไป

---

## Reconcile Results (latest run)

| เดือน | rep NRR | tl NRR | curr_gmv diff | denom diff |
|---|---|---|---|---|
| Apr | 92.2% | 92.4% | 0.000M | +1.78M |
| May | 92.2% | 92.4% | -0.061M | +2.59M |
| Jun | 74.1% | 73.7% | 0.000M | +2.90M |

**denom diff by design** = transfer_in จาก PM/ADMIN มี base_gmv ติดมาด้วย TL view ไม่นับ

**curr_gmv May -0.061M** = outlet ไฟร์ฟู้ดส์ latest_commercial_owner ≠ KAM → filter ออก by design

---

## CTEs สำคัญใน Rep View

| CTE | หน้าที่ |
|---|---|
| `latest_own` | staff_owner + commercial_owner ล่าสุดของแต่ละ outlet |
| `mar_cohort` | outlet ที่ Mar last = KAM + base_gmv > 0 + ไม่ใช่ handover |
| `pm_admin_mar_cohort` | outlet ที่ Mar อยู่กับ PM/ADMIN → detect transfer_in |
| `mar_sale_owner` | SALE staff ใน Mar → base_staff ของ handover/new_sales |
| `mar_pm_admin_staff` | PM/ADMIN staff ใน Mar → base_staff ของ transfer_in |
| `transfer_out_rows` | outlet ที่ Mar = KAM แต่ latest = non-KAM → transfer_out |
| `staff_email_map` | roster 15 KAM + Fang + Sojirat → email + TL mapping |

---

## UPPER/TRIM Standardization (session นี้)

ทุก view อัปเดตแล้ว — `commercial_owner` comparisons ใช้ `UPPER(TRIM())` ทั้งหมด
ไม่มี plain `= 'KAM'` ใน WHERE clauses อีกต่อไป

---

## Known Accepted Differences

| รายการ | สาเหตุ | decision |
|---|---|---|
| denom rep > tl by 1.78-2.9M | transfer_in จาก PM/ADMIN มี base_gmv | by design |
| curr_gmv May -0.061M (ไฟร์ฟู้ดส์) | latest ≠ KAM → filter ออก | by design |
| transfer_out 6 rows | outlet ออกไป non-KAM portfolio จริงๆ | ถูกต้อง |
| Fang/May ไม่ขึ้นใน output | outlet ย้ายไป Nitcha/คนอื่นแล้ว | by design |

---

## งานที่ยังต้องทำ

1. **UI integration** — นำ rep_view data เข้า Freshket Sense QNRR tab
2. **dim.kam_roster migration** — replace hardcoded UNNEST ใน ~14 SQL files
3. **Jun normalization** ÷days×30 — ทำใน UI layer ไม่ใช่ SQL
4. **Vertex AI migration** — post-launch หลัง monitor ci_analyze_fail logs

---

## Ground Truth GMV (locked)
Oct25=188.2M · Nov25=204.4M · Dec25=235.7M · Jan26=214.9M · Feb26=195.1M · Mar26=204.2M · Apr26=192.6M

