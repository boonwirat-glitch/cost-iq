# SQL สำหรับ Data Team — เช็คลิสต์ไฟล์ที่ต้องรัน (เอกสารนี้ maintain ต่อเนื่อง)

**เอกสารนี้ไม่ใช่ snapshot ครั้งเดียวแล้วทิ้ง** — เวลามีการเพิ่มคน/แก้ SQL รอบใหม่
ให้แก้ไฟล์นี้ (และไฟล์ .sql ในโฟลเดอร์นี้) **ในที่เดิม** แทนการสร้างโฟลเดอร์วันที่ใหม่
แล้วเพิ่มบันทึกไว้ใน "ประวัติการแก้ไข" ด้านล่าง — ทีมข้อมูลจะได้มีจุดอ้างอิงเดียว
ไม่ต้องไล่หาว่าโฟลเดอร์ไหนล่าสุด

**ไฟล์ไหนไม่อยู่ในโฟลเดอร์นี้ = ไม่ต้องแตะ ไม่เกี่ยวกับ 13 ไฟล์นี้**

---

## ประวัติการแก้ไข

- **2026-08-18**: เพิ่ม AD ใหม่ 2 คน (Koi, Wanmai) เข้า roster ทุกไฟล์ + แก้บั๊กเก่า
  2 จุด (ดูหัวข้อ "รอบนี้แก้อะไรบ้าง")

---

## รอบนี้ (2026-08-18) แก้อะไรบ้าง

1. **เพิ่มคนใหม่เข้า roster**: Chanitsara (Koi) — `chanitsara.d@freshket.co` และ
   Kritkanok (Wanmai) — `kritkanok.k@freshket.co` ถูกเพิ่มเข้าไปในทุกไฟล์ที่มีรายชื่อ
   KAM/PM/AD (นับเป็น `expected_owner = 'PM'` เหมือน Ornpreya ที่จริงๆ เป็น AD —
   ฐานข้อมูลฝั่งคลังข้อมูลมีแค่ 2 ประเภทคือ `KAM`/`PM` ไม่มีหมวด `AD` แยก)

2. **แก้บั๊กเก่าที่ค้างมาตั้งแต่กรกฎาคม** (ไม่เกี่ยวกับคนใหม่ แต่แก้พร้อมกันในรอบนี้):
   `q3c_upsell_bulk_all_kams_v4.sql` และ `q3c_upsell_team_summary_v4.sql` เดิมยังใช้
   โครงสร้างเก่า (`WHERE commercial_owner = 'KAM'` แบบ hardcode) ทำให้ PM/AD ทั้ง 4
   คนที่เพิ่มไปตั้งแต่กรกฎาคม (Panitan, Oh, Ninew, Ornpreya) **ไม่เคยมีข้อมูลใน 2 ไฟล์
   นี้เลยจนถึงวันนี้** — แก้ให้ใช้ pattern เดียวกับไฟล์อื่นๆ แล้ว (`= expected_owner`)

3. **`Quarterly_KAM_portfolio_reconcile.sql`/`Quarterly_upsell_reconcile.sql`** (ไม่ได้
   อยู่ในโฟลเดอร์นี้ เพราะเป็นไฟล์ที่พี่รันเองแล้ว paste Google Sheet ไม่ใช่ CSV upload)
   ก็เพิ่ม Koi/Wanmai + เพิ่ม KAM ที่เคยตกหล่นชื่อ "May" (Treerak Sangjua) ด้วย

---

## Quick reference — ไฟล์ไหนต้องแตกด้วย `splitter.py`, ไฟล์ไหนอัปโหลดตรง 1:1

### ① ต้องรัน `splitter.py` ต่อ (แตกเป็นไฟล์ต่อคนก่อนอัปโหลด) — 4 ไฟล์

| ไฟล์ | Output ก่อนแตก (Save Results As) | หลังแตกได้ |
|---|---|---|
| `SQL1_sense_skus.sql` | `download_skus.csv` | `sense_skus_{email}.csv` |
| `SQL2_sense_alts.sql` | `download_alts.csv` | `sense_alts_{email}.csv` |
| `Q12B_bulk_sku_outlet.sql` | `download_sku_outlet.csv` | ต่อคน |
| `q3c_upsell_bulk_all_kams_v4.sql` | `download_upsell_bulk.csv` | `sense_upsell_{email}.csv` |

หลังรันครบ 4 ไฟล์นี้ → รัน `splitter.py` (root ของ repo, ต้องมี `R2_ENDPOINT`/
`R2_ACCESS_KEY`/`R2_SECRET_KEY`/`R2_BUCKET` ตั้งไว้) — splitter อ่าน column แรก
(`kam_email`) ของ CSV เองแล้วแยกไฟล์ต่อคนอัตโนมัติ **ไม่ต้อง config ชื่อคนเพิ่ม**
ไม่ว่าจะมีคนใหม่กี่คนก็ตาม

### ② อัปโหลดตรง 1:1 ได้เลย (Save as CSV → upload ชื่อเดิม ไม่ต้องแตก) — 9 ไฟล์

| ไฟล์ | Output CSV |
|---|---|
| `Q8E_portview_v3.sql` | `portview.csv` |
| `Q2B_bulk_categories.sql` | `bulk_categories.csv` |
| `Q5B_bulk_outlets.sql` | `bulk_outlets.csv` |
| `Q6B_bulk_price.sql` | `bulk_price.csv` |
| `Q7B_bulk_sku_current.sql` | `bulk_sku_current.csv` |
| `Q9B_bulk_history.sql` | `bulk_history.csv` |
| `pm_rep_view.sql` | `pm_rep_view.csv` |
| `q3c_upsell_team_summary_v4.sql` | `sense_upsell_team.csv` (ทับไฟล์เดิม) |
| `q3c_upsell_team_groups_v1.sql` | `sense_upsell_team_groups.csv` (ทับไฟล์เดิม) |

**รวม ① 4 + ② 9 = 13 ไฟล์**

---

## เช็คก่อนอัปโหลด — มั่นใจว่ารันไฟล์เวอร์ชันถูกต้อง

วิธีเช็คเร็วที่สุด: เปิด CSV ที่ export ออกมา (ก่อนผ่าน splitter) นับหัวคอลัมน์
แถวแรก หรือค้นหาอีเมล `chanitsara.d@freshket.co`/`kritkanok.k@freshket.co` ในไฟล์
ผลลัพธ์ — ถ้าไม่เจอเลยทั้งไฟล์ = รันไฟล์เก่าอยู่ ไม่ใช่เวอร์ชันในโฟลเดอร์นี้

สำหรับ `SQL1_sense_skus.sql` โดยเฉพาะ — เคยพบว่า query ที่รันประจำวันเป็นเวอร์ชัน
เก่าก่อนใส่คอลัมน์กำไร (`margin_ex_vat`) มาหลายสัปดาห์แล้ว ทั้งที่ไฟล์ในนี้แก้ไว้แล้ว —
**ต้องหยิบเนื้อไฟล์จากในนี้ไปวางแทน query ที่เซฟไว้ใน BigQuery ทุกครั้งที่รัน**
ไม่ใช่กด "run" ซ้ำ query เดิมที่เคยเซฟไว้ — `download_skus.csv` ที่ได้ต้องมี
**22 คอลัมน์** (มี `margin_ex_vat`/`gmv_with_margin` ต่อท้าย) ถ้าน้อยกว่านี้แปลว่ายังรัน
ของเก่าอยู่

---

## หลังรันเสร็จ ยืนยันยังไงว่าใช้ได้จริง

- เข้า `/nrr` ล็อกอินด้วยอีเมล Koi หรือ Wanmai → ควรเห็นหน้า Today/Portfolio/Commission
  มีข้อมูลร้านของตัวเอง (ไม่ใช่ "ยังไม่มีข้อมูล")
- เข้า Commission tab (ล็อกอินแบบ admin) → ตารางเต็ม → ควรเห็นแถวของ Koi/Wanmai
  ปรากฏพร้อมกับคนอื่นๆ
