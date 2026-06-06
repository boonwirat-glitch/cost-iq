# Sales Module Handoff — v351
**สร้างเมื่อ:** June 2026 · **Session:** Sales Build Phase 1  
**SW ปัจจุบัน:** v351 · **Branch:** main

---

## สิ่งที่ build เสร็จแล้ว (v348–v351)

### Auth / Role
- `normalizeRole` รองรับ `sales_tl`
- `isSalesTLRole()`, `isSalesAny()` พร้อมใช้
- `roleLabel` → "Sales" / "Sales TL"
- Post-login routing: Sales → `setMode('kam')` + `showScreen('sales-portview')`
- `body.sales-mode` set ก่อน render ใน `_splashPreFade`
- `levelBadge` แสดง "Sales" ถูกต้อง

### Data Layer
- `parsePortviewBulk` extend col 20–23: `firstDollarDate`, `newUserExpDate`, `daysHeld`, `salesTeamName`
- `getFiles()` ใน orchestrator (`04_sku_matcher.js`) inject Sales CSV URL at fetch time — KAM ไม่กระทบ
- `_patchR2FilesForSales()` ใน `02_data_pipeline.js` — fallback
- SQL: `sql/Q_sales_portview_v1.sql` — รัน BQ แล้ว export `sales_portview_{safeKey}.csv` → R2

### Supabase
- `sales_pipeline` table สร้างแล้ว (RLS on)
- `profiles` table: เพิ่ม `sale_team` column + constraint รองรับ `sales`/`sales_tl`
- 18 Sales users สร้างแล้ว: Team A (6 rep + Tao TL), Team B (6 rep + Yun TL), Team C (3 rep + Salmon TL)

### App Module
- `src/10_sales_view.js` — Sales module ครบ sections
- `src/styles_sales.css` — Sales-specific styles
- CSS gating: `body.sales-mode` hide KAM tabs, show Sales tabs
- Nav tabs: พอร์ต / Save / พอร์ต / Pipeline / Commission

### R2 CSVs (ทดสอบแล้ว)
- `sales_portview_malisa_c_freshket_co.csv` — Guitar (58 rows) ✅
- ไม่มี overlap กับ KAM portview.csv ✅

---

## สิ่งที่ยังไม่ได้ทำ (งาน session หน้า)

### Priority 1 — UI/UX (ตาม mockup)
ดู `docs/sales_ux_mockup.html` สำหรับ visual reference

**Screen 1: พอร์ต (Sales Home)**
- [ ] **Hero card:** Runrate ในมือ vs Target + % bar — แทน KAM pace card ทั้งหมด
- [ ] **3-month projection strip:** M+0/M+1/M+2 + gap (hit/miss/gap) computed จาก `getSalesProjection()`
- [ ] **Handover warning card:** ร้านที่ expire เดือนนี้ + GMV ที่จะหาย — แสดงเฉพาะถ้ามี
- [ ] **Outlet list:** days held bar แทน pace signal, sort by `new_user_exp_date` ASC, สี critical(<7d)/expiring(<14d)/ok

**Screen 2: Pipeline**
- [ ] Summary KPI strip (leads count / ยอดรวม / gap to target)
- [ ] Gap bar chart รายเดือน (M+0/M+1/M+2)
- [ ] Leads grouped by month
- [ ] Add/Edit/Delete lead sheet (3 fields)
- [ ] Supabase CRUD ทำงานครบ

**Account View (Sales mode)**
- [ ] ซ่อน: NRR bar, upsell opportunity, pace % signal
- [ ] แสดง: days_held progress bar + handover deadline badge
- [ ] Profile / SKU / Echo / Save ยังใช้ได้เหมือน KAM ✅

### Priority 2 — SQL / Data
- [ ] Generate `sales_portview_{safeKey}.csv` สำหรับ Sales rep ที่เหลือ 14 คน แล้ว upload R2
- [ ] เพิ่ม `sales_handover_{safeKey}.csv` (ร้านที่ expire แล้ว — history)

### Priority 3 — Sales TL View
- [ ] TL เห็น team aggregate: runrate ทีม vs target ทีม
- [ ] Drill down รายคน เหมือน KAM TL

---

## Goal ของ Sales User

**Sales = Hunter, KAM = Farmer**

Sales ถือร้านชั่วคราว:
- **SA:** 45 วันนับจาก `first_dollar_date`
- **MC / Chain:** 90 วันนับจาก `first_dollar_date`
- พอถึง `new_user_exp_date` → outlet ออกจากพอร์ต Sales อัตโนมัติ (handover ไป KAM/PM)

Formula หลักที่ Sales ใช้ตัดสินใจ:
```
Runrate ในมือ (active outlets × pace เดือนนี้)
- Handover out (outlets ที่ expire เดือนนี้)
+ Pipeline (manual estimate)
= Projected GMV

Projected vs Target → รู้ว่าต้องปิดร้านเพิ่มอีกเท่าไร
```

**3-month forward view** — Sales วางแผนล่วงหน้าได้เพราะรู้วันหมด tenure ทุกร้าน

**Lead tracking:**
- Lead = ร้านที่คุยอยู่แต่ยังไม่ได้สั่ง → ไม่มีใน `dim.user_master`
- Sales กรอก manual 3 fields: ชื่อร้าน / ยอดคาดต่อเดือน / วันที่ยอดน่าจะเริ่มเข้า
- เก็บใน `sales_pipeline` Supabase table
- พอปิดได้ → `first_dollar_date` จะโผล่ใน user_master เอง (ออกจาก pipeline อัตโนมัติ)

**Account view:** Sales เห็นได้ครบเหมือน KAM — profile, SKU, Echo, Save

**Handover:** Sales แค่ดูว่าร้านไหนใกล้หมด (countdown) ไม่ต้อง "กด confirm"

---

## Design Direction

### Token system (ใช้ของเดิม 100%)
```css
--bg: #0d1f3c       /* dark navy — Sales ใช้ theme เดียวกับ KAM */
--ac: #008065       /* teal — text/icon/dot เท่านั้น ห้ามเป็น background */
--tx: #1C1C1E
--tx2: #636366
--tx3: #6C6C70
--success: #34C759
--warning: #FF9500
--danger: #FF3B30
```

### Design rules (critical)
- **ไม่มี pace signal สำหรับ Sales** — ไม่มี "ดีเยี่ยม / MONITOR / AT RISK" เพราะไม่มี baseline
- **Days held bar** แทน pace bar — progress สีเขียว→เหลือง→แดงตาม % tenure ที่ใช้ไปแล้ว
- **ไม่ใช้ default emoji เป็น icon** — ใช้ SVG icons เหมือน KAM nav bar ทุก tab
- **ไม่มี border ที่เห็นชัด** — ใช้ glass border 0.5px + shadow inset
- **Tab indicator** เป็น sliding pill เท่านั้น ไม่ใช้ fill เต็ม cell
- **Spinner** ใช้ 3-dot stagger ไม่ใช้วงกลม
- **Font weight สูงสุด 500** (timer/hero ใช้ 200)
- **Teal ห้ามเป็น background** — เป็นแค่ text/icon/dot/line
- **Micro interaction:** user-initiated ≤120ms, ambient ≥350ms — cubic-bezier(0.16,1,0.3,1)

### Anti-patterns ที่ mockup ยังมีอยู่ (session หน้าต้องแก้)
- Nav icons ใช้ emoji (⊞ ↗ $) → ต้องเปลี่ยนเป็น SVG เหมือน KAM
- Days bar border radius ยังหนาเกิน
- Projection card ยังไม่มี micro interaction เมื่อ swipe

---

## Architecture ที่สำคัญ

### CSS gating
```css
body.sales-mode .kam-content-only { display: none !important; }
body.sales-mode .sales-only { display: block !important; }
body.sales-mode .bnav .ni.kam-only { display: none !important; }
body.sales-mode .bnav .ni.sales-only { display: flex !important; }
```

### Key functions ใน 10_sales_view.js
```javascript
getSalesPortviewData()      // filter portviewBulkData สำหรับ Sales user
getSalesRunrate(outlets)    // Σ runrate ของ outlets ที่ยังไม่ expire
getSalesHandoverOut(outlets) // GMV ที่จะออกรายเดือน (M+0, M+1, M+2)
getSalesProjection(outlets, pipeline, target) // 3-month forward
renderSalesPortview()       // entry point สำหรับ sales-portview screen
renderSalesPipeline()       // entry point สำหรับ sales-pipeline screen
_loadSalesPipeline()        // fetch จาก Supabase sales_pipeline
```

### Override pattern (WRAPPER)
```javascript
// renderPortviewSummary ถูก WRAP ใน 10_sales_view.js
// ถ้า role=sales → _renderSalesAccountSummary()
// ถ้า role=rep   → original KAM render
```

### R2 routing
```javascript
// ใน 04_sku_matcher.js getFiles() — inject at call time
// role=sales → portview: 'sales_portview_{safeKey}.csv'
// role=rep   → portview: 'portview.csv' (unchanged)
```

---

## TL Mapping
```
Sales Team A → tao@freshket.co
Sales Team B → yunyun@freshket.co  
Sales Team C → Salmon@freshket.co
```

## Supabase Tables
- `profiles` — role: sales/sales_tl, sale_team field
- `sales_pipeline` — id, sales_email, shop_name, expected_gmv, expected_start_date, status
- `kam_skill_log` — account_name fallback สำหรับ Sales orphan sessions (P5-1 fix)
- `ci_sessions` — owner_email filter (ไม่ filter by account_id สำหรับ Sales)

---

## Deploy rules (อย่าลืม)
1. `snapshot/pre-{feature}-v{SW}` ก่อนเสมอ
2. อ่านไฟล์จริงผ่าน blob API เท่านั้น
3. `node --check` ทุก JS ก่อน push
4. push src → build.py → push index.html (Git Tree API) → push sw.js
5. ทดสอบ KAM login ก่อนทดสอบ Sales — KAM ต้องไม่กระทบ
