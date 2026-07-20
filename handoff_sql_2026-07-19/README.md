# SQL สำหรับ Data Team — รวมทุกไฟล์ที่ต้องรันใหม่ (2026-07-19)

แพ็กนี้รวม 3 รอบงาน: (1) เพิ่ม PM/AD 4 คนเข้า roster (17-19 ก.ค.), (2) แก้บั๊กคำนวณ
คอมมิชชั่น 3 จุด (19 ก.ค.), และ (3) ฟีเจอร์ใหม่ โบนัส Upsell ตามกลุ่มสินค้า (กลุ่ม D
ด้านล่าง) — **ไฟล์ไหนไม่อยู่ในนี้ = ไม่ต้องแตะ**

---

## Quick reference — 16 ไฟล์ทั้งหมด แบ่งตาม "วิธีรัน"

รายละเอียดเต็มของแต่ละไฟล์อยู่ในกลุ่ม A-D ด้านล่าง อันนี้คือสรุปเร็วๆ ว่าไฟล์ไหนต้องทำ
อะไรต่อหลังรันใน BigQuery

### ① ต้องแตก by rep เอง (รันแล้ว **ต้องรัน `splitter.py` ต่อ**) — 4 ไฟล์
| ไฟล์ | Output ก่อนแตก | หลังแตกได้ |
|---|---|---|
| `Q12B_bulk_sku_outlet.sql` | `download_sku_outlet.csv` | ต่อคน |
| `SQL1_sense_skus.sql` | `download_skus.csv` | `sense_skus_{email}.csv` |
| `SQL2_sense_alts.sql` | `download_alts.csv` | `sense_alts_{email}.csv` |
| `q3c_upsell_bulk_all_kams_v4.sql` | `download_upsell_bulk.csv` | `sense_upsell_{email}.csv` |

### ② รันแบบ 1:1 ได้เลย (Save as CSV → upload ตรงชื่อ ไม่ต้องแตก) — 10 ไฟล์
`Q8E_portview_v3.sql`, `Q2B_bulk_categories.sql`, `Q5B_bulk_outlets.sql`,
`Q6B_bulk_price.sql`, `Q7B_bulk_sku_current.sql`, `Q9B_bulk_history.sql`,
`pm_rep_view.sql`, `q3_2026_movement_rep_view.sql` (ทับไฟล์เดิม),
`q3c_upsell_team_summary_v4.sql` (ทับไฟล์เดิม), `q3c_upsell_team_groups_v1.sql`
(ไฟล์ใหม่ — รวมทุก KAM ในไฟล์เดียว ไม่ต้องแตก เพราะ `kam_email` เป็นแค่คอลัมน์หนึ่ง)

### ③ ไม่เกี่ยวกับ pipeline อัตโนมัติของแอปเลย (Bush รันเอง → paste Google Sheet มือ) — 2 ไฟล์
`Quarterly_KAM_portfolio_reconcile.sql`, `Quarterly_upsell_reconcile.sql` — ไม่ต้อง
อัปโหลดขึ้น R2, แอปไม่ได้อ่านไฟล์นี้เลย

**รวม ① 4 + ② 10 + ③ 2 = 16 ไฟล์**

---

## กลุ่ม A — ไฟล์เดิม แก้เพิ่ม PM/AD 4 คน (9 ไฟล์) → ใช้กับ Sense
รันแต่ละไฟล์ → Save Results as CSV → ตั้งชื่อตามตารางด้านล่างเป๊ะๆ

| ไฟล์ | Output CSV | หมายเหตุ |
|---|---|---|
| `Q8E_portview_v3.sql` | `portview.csv` | |
| `Q2B_bulk_categories.sql` | `bulk_categories.csv` | |
| `Q5B_bulk_outlets.sql` | `bulk_outlets.csv` | |
| `Q6B_bulk_price.sql` | `bulk_price.csv` | |
| `Q7B_bulk_sku_current.sql` | `bulk_sku_current.csv` | |
| `Q9B_bulk_history.sql` | `bulk_history.csv` | |
| `Q12B_bulk_sku_outlet.sql` | `download_sku_outlet.csv` | ต้องผ่าน splitter.py ต่อ (ดูข้อ 2) |
| `SQL1_sense_skus.sql` | `download_skus.csv` | ต้องผ่าน splitter.py ต่อ |
| `SQL2_sense_alts.sql` | `download_alts.csv` | ต้องผ่าน splitter.py ต่อ |

**⚠️ ตัดออก 2 ไฟล์ (2026-07-19, หลังตรวจโค้ดจริงอีกรอบ)**: `Q3B_bulk_skus.sql`
(→`bulk_skus.csv`) และ `Q4B_bulk_alternatives.sql` (→`bulk_alternatives.csv`) เคยอยู่ใน
รายการนี้ แต่ **ไม่ใช่ตัวจริงที่ SAVE/ประวัติ SKU ใช้งานอีกต่อไป** ตั้งแต่ระบบเปลี่ยนมาใช้ไฟล์
ต่อคน (`sense_skus_{email}.csv`/`sense_alts_{email}.csv` จาก SQL1/SQL2 ด้านบน) —
โค้ด `02_data_pipeline.js` มี comment ยืนยันตรงๆ ว่า `BACKGROUND=[]; // v207b: disable
global bulk SKU background load; use per-KAM bundle on demand` ตัว bulk เหลือแค่เป็น
fallback ฉุกเฉิน (โหลดเฉพาะตอนไฟล์ต่อคนของคนนั้น 404/timeout) — ไม่รันก็ไม่กระทบ 4 คนใหม่เลย
เพราะ Q8E (มี roster แล้ว) ทำให้ระบบรู้ email ถูกต้อง จะลองโหลดไฟล์ต่อคนได้ปกติ

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

## กลุ่ม D — ฟีเจอร์ใหม่: โบนัสค่าคอมฯ Upsell ตามกลุ่มสินค้า (category/group_key)

⭐ ฟีเจอร์ใหม่ ให้ตั้งเรต P1/P3 พิเศษต่อหมวดสินค้า/กลุ่มย่อยได้ (เช่น ดันผัก-ผลไม้)
เพิ่มคอลัมน์ `category` เข้าไฟล์เดิม + ไฟล์ใหม่ 1 ตัว

| ไฟล์ | Output CSV | ทำอะไร |
|---|---|---|
| `q3c_upsell_team_groups_v1.sql` | `sense_upsell_team_groups.csv` (**ไฟล์ใหม่**) | fast-path ระดับ group_key (kam_email, category, group_key, p1_gmv, p3_incremental) — เล็กมาก ~150-300 แถว มี roster PM/AD ครบ |
| `q3c_upsell_bulk_all_kams_v4.sql` | `download_upsell_bulk.csv` → `sense_upsell_{email}.csv` (ผ่าน splitter.py) (**ทับไฟล์เดิม**) | เพิ่มคอลัมน์ `category` ต่อท้าย (คอลัมน์ 8) — ตำแหน่ง 1-7 เดิมไม่ขยับ |
| `Quarterly_upsell_reconcile.sql` | (Bush รันเอง ไป Google Sheet) | เพิ่มคอลัมน์ `category` ต่อท้าย ให้ Sheet ทำเรตราย category ได้ |

**⚠️ `q3c_upsell_bulk_all_kams_v4.sql` ต้องรันทับด้วยเวอร์ชันในแพ็กนี้** (มีคอลัมน์ category เพิ่ม) —
ไม่งั้นฟีเจอร์โบนัสจะไม่รู้ว่า group_key ไหนอยู่หมวดไหน

หลังรัน `q3c_upsell_team_groups_v1.sql` → Save Results as CSV ชื่อ `sense_upsell_team_groups.csv`
→ อัปโหลดขึ้น R2 (แอปโหลดเป็น foreground file แล้ว)

---

## ไม่ต้องทำอะไรกับไฟล์เหล่านี้ (เช็คแล้ว ไม่กระทบ/ไม่เปลี่ยน)
- `company_gmv.sql` — จัดกลุ่มด้วย `commercial_owner` โดยตรง ไม่ใช้ roster รายชื่อ
- `May2026_KAM_portfolio_reconcile.sql` / `upsell_May2026_v1.sql` — ปิดงานแล้ว (พ.ค. 2026 ครั้งเดียว)

## ยังไม่ทำรอบนี้ (deferred — ยังไม่ใช่ scope วันนี้)
ค่าคอมฯ Upsell (P1/P3) ของ Ice ในไฟล์ `q3c_upsell_team_summary_v4.sql` — ไฟล์นั้น**ยังไม่มี roster
ของ Ice** (แก้บั๊กสะสมข้ามเดือนแล้ว แต่ยังไม่เพิ่ม roster PM/AD). หมายเหตุ: `q3c_upsell_team_groups_v1.sql`
และ `q3c_upsell_bulk_all_kams_v4.sql` **มี roster PM/AD ครบแล้ว** ในกลุ่ม D — เหลือแค่ team_summary ตัวเดียว
จะทำแยกอีกรอบเมื่อ Bush เปิด scope นี้

## คนที่เพิ่ม (roster)
| ชื่อ | Email | TL |
|---|---|---|
| Panitan (Aom) Promta | panitan.p@freshket.co | — |
| Sarawoot (Oh) Kaewkhao | sarawoot.k@freshket.co | — |
| Nichamon (Ninew) Kanghae | nichamon.k@freshket.co | — |
| Ornpreya (Ice) Sukthai | ornpreya.s@freshket.co | pavarisa.mu@freshket.co (Ploy) |

ทุกคนถูก tag `commercial_owner = 'PM'` ใน `dim.user_master`/`dwh.order` (คนละความหมายกับ role `pm` ที่ล็อกอินแอป — เป็นแค่ชื่อพ้องกัน)
