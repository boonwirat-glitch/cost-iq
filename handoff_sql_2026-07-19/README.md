# SQL สำหรับ Data Team — รวมทุกไฟล์ที่ต้องรันใหม่ (2026-07-19)

แพ็กนี้รวม 2 รอบงานเข้าด้วยกัน: (1) เพิ่ม PM/AD 4 คนเข้า roster (17-19 ก.ค.) และ
(2) แก้บั๊กคำนวณคอมมิชชั่น 3 จุด (19 ก.ค.) — **ไฟล์ไหนไม่อยู่ในนี้ = ไม่ต้องแตะ**

---

## กลุ่ม A — ไฟล์เดิม แก้เพิ่ม PM/AD 4 คน (11 ไฟล์) → ใช้กับ Sense
รันแต่ละไฟล์ → Save Results as CSV → ตั้งชื่อตามตารางด้านล่างเป๊ะๆ

| ไฟล์ | Output CSV | หมายเหตุ |
|---|---|---|
| `Q8E_portview_v3.sql` | `portview.csv` | |
| `Q2B_bulk_categories.sql` | `bulk_categories.csv` | |
| `Q3B_bulk_skus.sql` | `bulk_skus.csv` | |
| `Q4B_bulk_alternatives.sql` | `bulk_alternatives.csv` | |
| `Q5B_bulk_outlets.sql` | `bulk_outlets.csv` | |
| `Q6B_bulk_price.sql` | `bulk_price.csv` | |
| `Q7B_bulk_sku_current.sql` | `bulk_sku_current.csv` | |
| `Q9B_bulk_history.sql` | `bulk_history.csv` | |
| `Q12B_bulk_sku_outlet.sql` | `download_sku_outlet.csv` | ต้องผ่าน splitter.py ต่อ (ดูข้อ 2) |
| `SQL1_sense_skus.sql` | `download_skus.csv` | ต้องผ่าน splitter.py ต่อ |
| `SQL2_sense_alts.sql` | `download_alts.csv` | ต้องผ่าน splitter.py ต่อ |

**หลังรันครบ 3 ไฟล์สุดท้าย** (Q12B, SQL1, SQL2) ให้รัน `splitter.py` (root ของ repo) —
จะ split เป็นไฟล์ต่อคน (`sense_skus_{email}.csv` ฯลฯ) อัตโนมัติ ครบทั้ง 4 คนใหม่
โดยไม่ต้อง config เพิ่ม (splitter อ่านจาก column แรกของ CSV เอง ไม่ hardcode รายชื่อ)

## กลุ่ม B — ไฟล์ใหม่สำหรับ `/nrr` (1 ไฟล์)
| ไฟล์ | Output CSV | หมายเหตุ |
|---|---|---|
| `pm_rep_view.sql` | `pm_rep_view.csv` | ไฟล์ใหม่แยกต่างหาก ไม่ต้องรวม/merge กับ `kam_rep_view.csv` — อัปโหลดชื่อนี้ตรงๆ แอปดึงมารวมเอง |

---

## กลุ่ม C — แก้บั๊กวันนี้ (2026-07-19): 3 ไฟล์ต้องรันใหม่

⚠️ **สำคัญ**: ทั้ง 3 ไฟล์นี้แก้ logic คำนวณจริง ไม่ใช่แค่เพิ่ม roster — CSV เดิม (ถ้าเคยรันแล้ว)
ต้องรันทับด้วยไฟล์เวอร์ชันในแพ็กนี้ ไม่ใช่แค่รันซ้ำไฟล์เดิม

| ไฟล์ | Output CSV | แก้อะไร |
|---|---|---|
| `q3_2026_movement_rep_view.sql` | `kam_rep_view.csv` (**ทับไฟล์เดิม**) | เติมตราที่หายไป (`transfer_scope`) ในแถว transfer_out — ป้องกัน NRR% บริษัทเพี้ยนตอนมีร้านย้ายออกจาก KAM ไป PM/Admin |
| `q3c_upsell_team_summary_v4.sql` | `sense_upsell_team.csv` (**ทับไฟล์เดิม**) | Expansion/P1/P3 กลับมาคิดจากยอดเดือนนั้นเดี่ยวๆ ไม่บวกสะสมข้ามเดือนแบบเดิม (ของเดิมทำให้ยอด ส.ค./ก.ย. เป็นต้นไปจะพองขึ้นเรื่อยๆ ผิดจากที่ควรจะเป็น) |
| `Quarterly_KAM_portfolio_reconcile.sql` | (ไฟล์ที่ Bush รันเองใน BigQuery ไป Google Sheet — ไม่ใช่ pipeline อัตโนมัติของแอป) | เปลี่ยนมาใช้โมเดล "ยกร้านทั้งก้อนให้เจ้าของล่าสุด" แบบเดียวกับที่แอปจริงทำ (แทนการแยก 2 แถว transfer_in/transfer_out แบบเดิม) — คอลัมน์ยังครบ 22+3 เหมือนเดิม ไม่กระทบสูตร Google Sheet |
| `Quarterly_upsell_reconcile.sql` | (เหมือนกัน — Bush รันเอง) | ปรับให้สอดคล้องกับไฟล์ portfolio ด้านบน |

**2 ไฟล์สุดท้าย (`Quarterly_*_reconcile.sql`) มี roster PM/AD 4 คนอยู่แล้วในตัว** (เพิ่มไปพร้อมกับ
การแก้ logic วันนี้) — ไม่ต้องแก้เพิ่ม

---

## ไม่ต้องทำอะไรกับไฟล์เหล่านี้ (เช็คแล้ว ไม่กระทบ/ไม่เปลี่ยน)
- `company_gmv.sql` — จัดกลุ่มด้วย `commercial_owner` โดยตรง ไม่ใช้ roster รายชื่อ
- `May2026_KAM_portfolio_reconcile.sql` / `upsell_May2026_v1.sql` — ปิดงานแล้ว (พ.ค. 2026 ครั้งเดียว)
- `q3c_upsell_bulk_all_kams_v4.sql` — ตรวจสอบวันนี้แล้ว ไม่มีบั๊กสะสมข้ามเดือน (ข้อมูลดิบรายเดือนอยู่แล้ว ตัวที่คำนวณสะสมคือไฟล์อื่น) ไม่ต้องแก้

## ยังไม่ทำรอบนี้ (deferred — ยังไม่ใช่ scope วันนี้)
ค่าคอมฯ Upsell (P1/P3) ของ Ice (AD คนเดียวในกลุ่ม 4 คนที่ยังไม่มีค่าคอมฯ Upsell จริง) —
ไฟล์ต่อไปนี้ **ยังไม่มี roster ของ Ice**:
- `q3c_upsell_bulk_all_kams_v4.sql`
- `q3c_upsell_team_summary_v4.sql` (แก้บั๊กสะสมข้ามเดือนแล้ว แต่ยังไม่เพิ่ม roster)

จะทำแยกอีกรอบเมื่อ Bush เปิด scope นี้ (ไม่ใช่ตอนนี้)

## คนที่เพิ่ม (roster)
| ชื่อ | Email | TL |
|---|---|---|
| Panitan (Aom) Promta | panitan.p@freshket.co | — |
| Sarawoot (Oh) Kaewkhao | sarawoot.k@freshket.co | — |
| Nichamon (Ninew) Kanghae | nichamon.k@freshket.co | — |
| Ornpreya (Ice) Sukthai | ornpreya.s@freshket.co | pavarisa.mu@freshket.co (Ploy) |

ทุกคนถูก tag `commercial_owner = 'PM'` ใน `dim.user_master`/`dwh.order` (คนละความหมายกับ role `pm` ที่ล็อกอินแอป — เป็นแค่ชื่อพ้องกัน)
