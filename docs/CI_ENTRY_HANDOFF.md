# CI Entry Point & Architecture Handoff
**สร้างเมื่อ:** session 2026-06-06  
**version ปัจจุบัน:** v334  
**repo:** github.com/boonwirat-glitch/cost-iq branch main

---

## งานที่ต้องทำในเรื่องนี้

### 1. Entry point ใหม่ — ปุ่มบันทึกใน nav bar

**ข้อกำหนดจาก Product Owner:**
- เพิ่มปุ่ม "บันทึก" เข้าไปใน `<nav class="bnav">` โดย **ไม่แตะ icon/label/behavior ของ tab เดิมแม้แต่อันเดียว**
- ห้ามใช้ icon mic default (ดู cheap)
- design style ต้องอยู่ในแนว Apple Music / Spotify — ตัวเลือกที่ยังไม่ได้ approve:
  - **A: Pill waveform** — container pill พร้อม waveform bars ข้างใน ไม่มี mic icon
  - **B: Elevated center** — ปุ่มวงกลม float ขึ้นเหนือ nav bar เหมือน Spotify
  - **C: Flat minimal** — pill เล็กๆ waveform bars เล็ก ไม่ elevate

**ปัญหาใน session เดิม:** Claude ทำ mockup ที่ redesign ทั้ง nav bar ซึ่งผิด ต้อง mock เฉพาะปุ่มใหม่โดยใช้ nav bar จริงจาก screenshot เป็น base

---

### 2. Nav bar structure จริง (shell.html L2894–2942)

```html
<nav class="bnav">
  <!-- KAM mode: พอร์ต (L2928), ร้าน (L2904), [ปุ่มใหม่], Sense (L2919), Team (L2936) -->
  <!-- REST mode: ภาพรวม (L2896), พอร์ต (L2913), [ปุ่มใหม่], Sense (L2919), รายงาน (L2923) -->
</nav>
```

**CSS class pattern ที่ใช้อยู่:**
- `kam-only` = แสดงเฉพาะ KAM mode
- `rest-only` = แสดงเฉพาะ restaurant/overview mode  
- `tl-only` = แสดงเฉพาะ TL/Admin role
- `ni` = nav item base class
- `ni.on` = active state → `color: var(--g700)` (teal)
- `lb` = label text 10px

**Colors ที่ใช้ใน app:**
- teal active: `var(--g700)` / `rgba(0,204,106,.9)`
- inactive icon: `var(--n400)` / `rgba(255,255,255,.35)` ใน dark mode
- background nav: `var(--n0)` (dark mode = `#111820`)
- border top: `rgba(255,255,255,.08)`

**Screenshot nav จริง (จาก image ที่ส่งมา):**
- KAM mode แสดง: พอร์ต | รายร้าน | Sense
- 3 tabs เท่านั้นที่เห็น (บาง tab ซ่อนตาม mode)
- font: IBM Plex Sans Thai

---

### 3. Architecture ที่ตกลงแล้ว — 2 Use Cases

**UC1: รีบมาก → กดได้ทันทีจาก nav bar → match account ทีหลัง**

**UC2: Sales ใช้ — ไม่มี account ใน portfolio → log ร้านเองหลัง analyze**

**Core insight:** แยก "บันทึกเสียง" ออกจาก "ผูก account" — ทำได้ก่อน analyze เสร็จ

**Flow 3 phase:**
```
Phase 1: Record  (ไม่ต้องรู้ account)
    ↓
Phase 2: Analyze (AI วิเคราะห์ transcript)  
    ↓
Phase 3: Link    (เลือก account หรือพิมพ์ชื่อร้านใหม่ → save)
```

---

### 4. Data model ที่ต้องสร้าง

**4 dimensions ที่ต้องคิดเผื่อ:**

| Dimension | Values | Impact |
|---|---|---|
| User type | `kam` / `sales` | KAM มี portviewBulkData, Sales ไม่มี |
| Customer type | `existing` (มีใน system) / `lead` (ยังไม่มี) | existing มี account_id จริง, lead ใช้ชื่อชั่วคราว |
| Session status | `draft` / `linked` / `locked` | draft = ยังไม่ผูก account |
| Visit type | ยังไม่ได้ define ครบ | ดูหัวข้อถัดไป |

**SQL table ที่ต้องสร้างใหม่:**
```sql
CREATE TABLE ci_sessions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_email     text NOT NULL,
  owner_type      text NOT NULL,          -- 'kam' | 'sales'
  account_id      text,                   -- NULL = ยังไม่ผูก
  account_name    text,                   -- ชื่อร้าน (กรณี lead)
  customer_type   text,                   -- 'existing' | 'lead'
  session_date    date DEFAULT CURRENT_DATE,
  duration_secs   int,
  skill_scores    jsonb,
  customer_intel  jsonb,
  next_actions    jsonb,
  tl_overrides    jsonb,
  status          text DEFAULT 'draft',   -- 'draft' | 'linked' | 'locked'
  created_at      timestamptz DEFAULT now()
);
```

**Sales "ถัง" ที่แยกต่างหาก:**
- filter by `owner_email` + `owner_type = 'sales'`
- ถ้า `account_id IS NULL` = draft ใน Sales bucket
- ถ้า Sales กลับมาคุยร้านเดิม → search by `account_name` ILIKE แล้ว pull sessions เดิมมาเป็น storyline

---

### 5. Phase 3 — Link Account UI

**สำหรับ KAM (existing customer):**
- Search bar fuzzy search จาก `portviewBulkData` ที่โหลดอยู่แล้ว
- Select → save to `ci_sessions.account_id` + trigger save `kam_skill_log`

**สำหรับ Sales (lead / ไม่มี account):**
- พิมพ์ชื่อร้านสั้นๆ (ไม่มี type dropdown ไม่มี swipe)
- กด confirm → save เป็น draft ใน `ci_sessions` โดย `account_id = NULL`, `account_name = ที่พิมพ์`
- ถ้ากด "ผูกทีหลัง" → save draft ทิ้งไว้

**Sales bucket (ดูประวัติ):**
- เรียก sessions ที่มี `account_name ILIKE '%ชื่อ%'` มา group เป็น storyline
- แสดงก่อน analyze เสร็จ (ถ้าพิมพ์ชื่อก่อน record ได้)

---

### 6. Storyline / Context Injection (Phase 2 เพิ่ม)

หลัง link account แล้ว → inject context เพิ่มเข้าไปใน AI:
- ข้อมูลจาก `portviewBulkData`: GMV, top SKU, categories, pace
- ข้อมูลจาก `ci_sessions` เดิมของร้านนั้น: pain points สะสม, wallet estimate ก่อนหน้า
- inject เป็น system prompt ใน `_INTEL_SYS` ก่อน re-analyze หรือ enrich

---

### 7. สิ่งที่ยังไม่ได้ตัดสินใจ (ต้องถาม Product Owner)

1. **Option A / B / C** ของ nav button design — ยังไม่ได้เลือก
2. **Nav button visible ใน mode ไหน** — ทุก mode หรือเฉพาะ KAM+Sales? ไม่ใช่ TL?
3. **Visit type** — ค้างว่าจะมี dimension อะไรอีก (product owner บอกว่ายังไม่จบ)
4. **Sales bucket view** — TL เห็น draft sessions ของ Sales ทั้งหมดหรือเปล่า?
5. **Re-analyze** หลัง link account — ทำ automatic หรือให้ user กด?

---

### 8. สถานะ code ปัจจุบัน

- `09_conv_intel.js` version ล่าสุด: L1568 — CI feature สมบูรณ์แต่ยังผูก account ตั้งแต่ก่อน record
- entry point ปัจจุบัน: ปุ่ม "บันทึกการสนทนา" ใน account view (shell.html L2624)
- `ci_sessions` table: **ยังไม่ได้สร้าง** — ต้องรัน SQL ก่อน
- Supabase: `kam_visits` + `kam_skill_log` ใช้งานได้ปกติ (v334)

---

### 9. Task list สำหรับ session ถัดไป

**P0 — ต้องถามก่อนทำ:**
- [ ] Confirm design option A/B/C กับ Product Owner
- [ ] Confirm mode visibility ของปุ่มใหม่

**P1 — หลัง confirm:**
- [ ] Mockup ที่ถูก: ใช้ nav bar จริงจาก screenshot เป็น base, เพิ่มปุ่มเข้าไปตรงกลาง
- [ ] แก้ `_ciOpen()` ให้รับ optional `accountGuid` — ถ้าไม่มีก็เปิดได้
- [ ] เพิ่ม Phase 3 UI (link account panel) ใน `09_conv_intel.js`
- [ ] สร้าง `ci_sessions` table ใน Supabase
- [ ] เพิ่ม nav button ใน `shell.html` (ไม่แตะ tab เดิม)

**P2:**
- [ ] Storyline injection
- [ ] Sales bucket view
- [ ] TL review draft sessions
