# Sales UI Handoff — v358
**Created:** June 2026 · **Session:** Sales UI Build (CSS Architecture)
**SW:** freshket-sense-v358 · **Branch:** main
**Snapshot:** `snapshot/pre-sales-ui-v6` (taken before this session)

---

## สถานะ ณ สิ้น session นี้

### ทำงานแล้ว ✅
- Sales login → route ไป `scr-sales-portview` ถูกต้อง
- Hero card (Runrate ในมือ, target bar, gap badge)
- 3-month projection strip (inline columns, no boxes)
- Handover warning section (dot rows)
- Outlet list (Revolut transaction row style, colored indicator bar, days bar)
- Pipeline screen (KPI inline, gap chart, FAB เพิ่ม Lead, lead list by month)
- Pill nav: white + strong shadow, 4 tabs (พอร์ต/Save/Pipeline/Commission)
- Nav active state: rausch #FF385C glow
- Commission screen: Coming Soon (SVG icon, no emoji)

### ยังมีปัญหาเล็กๆ ที่รู้แล้ว ⚠️
| ปัญหา | สาเหตุ | วิธีแก้ |
|---|---|---|
| `sales_handover_malisa_c.csv` → 404 | ไม่ได้ generate + upload R2 | Run SQL + upload R2 |
| `sense_skus_malisa_c.csv` → 404 | ไม่ได้ upload R2 | Upload R2 |
| `sense_alts_malisa_c.csv` → 404 | ไม่ได้ upload R2 | Upload R2 |
| Handover section แสดง dot แต่ชื่อร้านว่าง | handover CSV 404 | แก้ด้วย upload R2 |
| Target แสดง "ยังไม่มี target" | ยังไม่ได้ตั้งใน Supabase | ตั้ง target ใน target_settings |
| CSV 14 Sales rep ที่เหลือ | ยังไม่ได้ generate | Run Q_sales_portview_v1.sql per rep |

---

## Design Direction ที่ approved แล้ว

**Art direction:** Airbnb DLS × Revolut list pattern
**Reference mockup:** `docs/sales_ui_v6.html` (อยู่ใน repo แล้ว)

### Token system (locked)
```css
canvas:   #FFFFFF   /* pure white, no tint */
surface:  #F7F7F7   /* band separators */
ink:      #222222   /* primary text */
body:     #3F3F3F   /* secondary */
muted:    #6A6A6A   /* tertiary/labels */
hairline: #EBEBEB   /* dividers */
ac:       #FF385C   /* rausch — active, CTA, urgency */
ok:       #34C759   /* positive only */
warn:     #FF9500   /* caution */
font:     Noto Sans Thai (400/500/600/700)
mono:     IBM Plex Mono (labels, numbers)
```

### Design rules (locked)
- **ไม่มี green** — green ออกไปทั้งหมดใน Sales theme
- **Rausch `#FF385C`** เป็น accent หลัก — CTA, active nav, urgency, deadline
- **กล่องเดียวคือ Hero card** — ที่เหลือเป็น list rows + hairline dividers
- **Cards float ด้วย shadow** ไม่ใช่ border
- **Typography:** weight 700 ทุก title/label — ไม่มี weight 200/300
- **ห้ามใช้ emoji** เป็น icon — SVG stroke เท่านั้น

### Component pattern
```
page header:    .sv-page-hd / .sv-page-eye / .sv-page-title
hero:           .sv-hero (single box, rausch top border 3px)
proj strip:     .sv-proj-row / .sv-proj-cell (inline columns, no boxes)
section label:  .sv-sec / .sv-sec-t / .sv-sec-c
handover rows:  .sv-hov-section / .sv-hov-row / .sv-hov-dot
outlet list:    .sv-outlet-list / .sv-ol-row / .sv-ol-ind (colored 3px bar)
days bar:       .sv-days-track / .sv-days-fill (.ok/.mid/.late)
KPI inline:     .sv-kpi-inline / .sv-ki (no boxes, divider lines)
gap chart:      .sv-gap-section / .sv-gap-row / .sv-gap-fill
lead list:      .sv-lead-list / .sv-lead-row (Revolut rows)
FAB:            .sv-fab (rausch pill button)
```

---

## Architecture fixes ที่ทำใน session นี้

### CSS Architecture issues แก้แล้ว
1. **`style="background:#0d1f3c"` inline** บน `scr-sales-*` elements ใน `shell.html`
   - Inline style ชนะ CSS rules ทุกกรณี → bg ดำตลอดแม้จะมี CSS ขาว
   - **Fix:** ลบ inline style ออก, ให้ CSS จัดการ

2. **`body.kam-mode` + `body.sales-mode` พร้อมกัน**
   - Sales login เรียก `setMode('kam')` → body ได้ทั้งสอง class
   - Dark glass nav pill ของ KAM override nav ของ Sales
   - **Fix:** `body.sales-mode.kam-mode .bnav { background: #FFFFFF !important }`

3. **`body.sales-mode` ถูก override โดย `body.kam-mode {background:#0d1f3c}`**
   - ทั้งคู่ single-class selector → order ใน CSS กำหนด winner
   - **Fix:** เพิ่ม `body.sales-mode { background: #FFFFFF }` หลัง kam-mode rule

4. **KAM screens ไม่ถูกซ่อนใน sales-mode**
   - `#scr-portview` ไม่มี class gate → Sales เห็น KAM screen ซ้อน
   - **Fix:** `body.sales-mode #scr-portview { display: none !important }`

5. **`nav-overview` ไม่มี class gate → โผล่ใน sales-mode**
   - **Fix:** `body.sales-mode .bnav #nav-overview { display: none !important }`

6. **IDB preload โหลด KAM portview data ให้ Sales**
   - IDB key `'portview'` เก็บ KAM data 640 accounts
   - **Fix:** Sales skip portview/handover ใน `_preloadFromIndexedDB()`
   - **Fix:** `allCriticalReady()` ใช้แค่ portview+history สำหรับ Sales (handover 404 ไม่ block)
   - **Fix:** `RenderBus._flush()` เรียก `renderSalesPortview()` เมื่อ sales-mode active

7. **`.main` element ไม่ถูก hide สำหรับ Sales screens**
   - **Fix:** เพิ่ม sales screen names ใน `showScreen()` mainEl logic

---

## งานที่เหลือ — UX/UI Focus (session หน้า)

### Priority 1: UX polish ที่ยังไม่เสร็จ
- [ ] **Account view (Sales mode):** tenure bar, stats, tabs ยัง render ไม่เต็ม — `_renderSalesAccountSummary()` ต้องทดสอบ
- [ ] **Nav pill active indicator:** ตรวจว่า `_salesUpdateNavActive()` ทำงานถูกต้องทุก tab
- [ ] **Handover section empty state:** ถ้า handover CSV ไม่มี → ซ่อน section ทั้งหมด (ไม่แสดง dot ว่าง)
- [ ] **Hero "ยังไม่มี target":** ถ้า target = 0 → UI ควรแนะนำ TL ให้ตั้ง target แทนที่จะแสดง warning
- [ ] **Outlet type pill color:** `warn` state ยัง apply สี rausch ถูกต้องไหม — ตรวจ

### Priority 2: Data ที่ต้องทำก่อน full rollout
- [ ] Upload `sales_handover_malisa_c.csv` → R2
- [ ] Upload `sense_skus_malisa_c.csv` + `sense_alts_malisa_c.csv` → R2
- [ ] ตั้ง target ใน Supabase `target_settings` สำหรับ Guitar
- [ ] Generate + upload CSV สำหรับ Sales rep ที่เหลือ 14 คน

### Priority 3: Sales TL View
- [ ] TL login → team aggregate (runrate ทีม vs target ทีม)
- [ ] Drill down รายคน

---

## Files ที่แก้ใน session นี้

| File | Version | สิ่งที่เปลี่ยน |
|---|---|---|
| `src/styles_sales.css` | v352+ | Replace ทั้งไฟล์ — Airbnb/Revolut token system |
| `src/10_sales_view.js` | v352+ | HTML templates ทั้งหมด — v6 design |
| `src/styles_main.css` | v358 | Sales bg white, hide KAM screens, white pill nav, hide nav-overview |
| `src/shell.html` | v358 | ลบ inline bg บน scr-sales-*, ลบ kambar banner |
| `src/02_data_pipeline.js` | v356 | IDB skip for Sales, allCriticalReady, RenderBus flush |
| `src/05_kam_view.js` | v356 | .main hide for Sales screens, clean kambar refs |
| `src/01_core.js` | v357 | ลบ cycleKamModel |
| `sw.js` | v358 | freshket-sense-v358 |
| `index.html` | v358 | Built |

---

## Key learnings — CSS Architecture

**Rule 1: Inline style ชนะ CSS ทุกกรณี**
ตรวจ compiled HTML ก่อนเขียน CSS ใหม่เสมอ

**Rule 2: Specificity + order = final winner**
body.sales-mode vs body.kam-mode → same specificity → order wins
ต้องวาง sales-mode rules หลัง kam-mode เสมอ

**Rule 3: อ่าน compiled HTML ก่อน diagnose**
ปัญหา CSS ส่วนใหญ่เห็นได้จาก `grep` บน `index.html` ใน 2 นาที
ไม่จำเป็นต้อง guess จาก screenshot

**Rule 4: IDB และ CSS architecture ต่างกัน**
CSS ใช้ class selectors + order
IDB ใช้ tab key strings → ต้องรู้ว่า key ไหนเก็บ data อะไร

---

## Session หน้า: เริ่มที่ไหน

1. Login Guitar → ทดสอบ portview + account view + pipeline
2. Fix handover empty state (CSS: ซ่อน section ถ้าไม่มี data)
3. Fix account view tenure render
4. Upload missing R2 CSVs
5. UX polish รายจุด

อ่าน `docs/sales_ui_v6.html` เพื่อดู design reference ก่อน build ทุกครั้ง
