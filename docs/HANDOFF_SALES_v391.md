# Sales UI Handoff — Freshket Sense v391
**Date:** 2026-06-07  
**SW Version:** `freshket-sense-v391`  
**Branch:** `main`

---

## สถานะปัจจุบัน — Build เสร็จแล้ว

### หน้าที่ทำงานครบ
| หน้า | สถานะ | หมายเหตุ |
|---|---|---|
| Portview (พอร์ต) | ✅ | Hero, projection strip, handover summary, outlet list |
| Account view | ✅ | GMV chart, SKU list, Category breakdown |
| Pipeline | ✅ | Gap chart, lead list, add/edit lead sheet |
| Commission | ✅ | Coming soon placeholder |
| Handover sheet | ✅ | Bottom sheet, sorted by runrate |

### สิ่งที่ยังรอ BigQuery
- **`sales_portview.csv`** ต้อง re-run SQL ใหม่ (เพิ่ม `account_name` col[24]) แล้ว upload ขึ้น R2 ก่อน account group name จะแสดงถูก — ตอนนี้ยังแสดงเป็น outlet name แทน

---

## Architecture

### Data Flow
```
Supabase Auth
  → login (doLogin / checkSession / INITIAL_SESSION)
  → getFiles() ← ดึง CSV ถูกชุด (Sales CSVs ไม่ใช่ KAM)
  → R2 CSV fetch
  → parsePortviewBulk() → portviewBulkData[]
  → getSalesPortviewData() → filter by kamEmail
  → render
```

### Critical Fix — Object.freeze
`shell.html` มี `Object.freeze(FreshketSenseConfig.data.r2Files)` ทำให้ mutation ไม่ work
**Fix:** `getFiles()` ใน `src/04_sku_matcher.js` return object ใหม่ตาม role แทน mutate:
```js
function getFiles() {
  const base = window.R2_FILES || {};
  const role = getCurrentRole();
  if (role === 'sales' || role === 'sales_tl') {
    return Object.assign({}, base, {
      portview: 'sales_portview.csv',
      history: 'sales_history.csv',
      categories: 'sales_categories.csv',
      sku_current: 'sales_sku_current.csv',
      outlets: 'sales_outlets.csv',
      handover: ''
    });
  }
  return base;
}
```

### Login Paths — ทุก path ต้อง patch ก่อน fetch
| Path | หมายเหตุ |
|---|---|
| `doLogin()` | await profile → getFiles() ready |
| `checkSession()` cache hit | set profile → getFiles() ready |
| `checkSession()` cache miss | await profile → getFiles() ready |
| `INITIAL_SESSION` warm boot | poll profile max 2s → getFiles() ready |

### R2 Files (Sales)
Bucket: `pub-12078d17646340808024e8cc95504995.r2.dev`

| key | file |
|---|---|
| portview | `sales_portview.csv` |
| history | `sales_history.csv` |
| categories | `sales_categories.csv` |
| sku_current | `sales_sku_current.csv` |
| outlets | `sales_outlets.csv` |
| handover | `''` (ไม่มี — ใช้ portview data แทน) |

---

## SQL — `sql/sales_portview.sql`

25 columns (col 0–24):

| col | field | หมายเหตุ |
|---|---|---|
| 0 | account_id | UUID — key สำหรับ group branches |
| 1 | res_name | outlet name (branch level) |
| 2 | last_month_gmv | |
| 3 | gmv_to_date | MTD |
| 4 | days_elapsed | |
| 5 | days_in_month | |
| 6 | runrate_gmv | |
| 7 | account_type | SA / MC / Chain |
| 8–13 | churned/missing | placeholder 0/'') |
| 14 | cur_sku_count | |
| 15 | orders_to_date | |
| 16 | kam_name | = sales_name |
| 17 | kam_email | = sales_email |
| 18 | tl_email | |
| 19 | days_with_current_kam | = days_held |
| 20 | first_dollar_date | |
| 21 | new_user_exp_date | วันหมด tenure |
| 22 | days_held | |
| 23 | sales_team_name | |
| **24** | **account_name** | **ชื่อ account ระดับ parent — ต้อง re-run แล้ว upload** |

**Parser:** `parsePortviewBulk()` ใน `src/02_data_pipeline.js` — อ่าน col 0–24

---

## Parser — `src/02_data_pipeline.js`

`parsePortviewBulk()` parse ทั้ง KAM และ Sales CSV (format เดียวกัน):
- `p[24]` → `accountGroupName` — ใช้เป็นชื่อ group header ใน portview
- `account_id` (p[0]) = UUID เดียวกันสำหรับทุก branch ของ account เดียว → ใช้เป็น group key

---

## UI — `src/10_sales_view.js`

### Portview Outlet List
- **Grouping:** `_olGroupByAccount()` group by `o.id` (account_id), display name จาก `o.accountGroupName`
- **Group design:** 8px surface band (`#F7F7F7`) ก่อน/หลัง group + uppercase muted label (Airbnb pattern)
- **Branch rows:** indent 28px ใต้ group header
- **Single outlet:** row ปกติ ไม่มี band
- **Sort:** default MTD (`_olSort='mtd'`), cycle → Expiry date

### Projection Strip (3 months)
Formula:
```
M0 = totalRunrate − expiringM0 + pipeline_M0
M1 = (active + expiringM1 + expiringM2) − expiringM1 + pipeline_M1  
M2 = (active + expiringM2) − expiringM2 + pipeline_M2
```
Breakdown display (Revolut style): ยอดรวมก่อน → 3 rows: runrate (gray dot) / pipeline (green dot) / handover (red dot)

### Pipeline Spread
`_pipelineByMonth()` — SA=1 month, MC/Chain=3 months spread  
`expected_gmv` = monthly runrate ต่อเดือน (ไม่ใช่ total)

### Active Count
`outlets.filter(o => o.gmvToDate > 0).length` / `outlets.length`  
= มีออเดอร์เดือนนี้ / ทั้งหมดในพอร์ต

### Number Format — `_sv_fmt(n)`
- ≥1M → "1.3M"
- ≥1000 → "1K" / "1.5K" (1 decimal, ตัด .0)
- ≥500 → "0.7K"
- <500 → exact

---

## Design System — Sales CI

**ไฟล์ reference:** `docs/sales_ui_v7.html` (Bucci โยนขึ้น git ไว้เป็น design token)

| Token | Value |
|---|---|
| canvas | `#FFFFFF` |
| surface | `#F7F7F7` |
| ink | `#222222` |
| body | `#3F3F3F` |
| muted | `#6A6A6A` |
| hairline | `#EBEBEB` |
| ac (accent) | `#FF385C` |
| ok | `#34C759` |
| warn | `#FF9500` |

**Font:** Noto Sans Thai (400/500/600/700) + IBM Plex Mono (numbers/labels)  
**NO:** green ใน Sales theme, emoji icons, Claude default styling  
**Pattern:** Hero card only box — everything else = list rows + hairline dividers

### Nav Bar (Sales)
- 3 columns: พอร์ต / Pipeline / Commission
- `#nav-opportunities` (Save) ซ่อนใน sales-mode
- Glass pill: `rgba(255,255,255,.72)` + `blur(20px)`
- Sense chip pulse: `@keyframes iq-pulse-sales` → สีแดง ไม่ใช่เขียว

---

## CSS Files

| File | หน้าที่ |
|---|---|
| `src/styles_sales.css` | Sales-specific styles ทั้งหมด |
| `src/styles_main.css` | Global + Sales nav/chip overrides |

Key classes ใน `styles_sales.css`:
- `.sv-proj-cell` / `.sv-pb-row` / `.sv-pb-dot` — projection breakdown
- `.sv-ol-band` — 8px surface break ระหว่าง groups
- `.sv-ol-grp-hd` / `.sv-ol-grp-name` — group header typography
- `.sv-cat-row` — flex layout (align กับ SKU row)
- `.sv-hero` / `.sv-hero-num` — hero card

---

## Pending / Next Session

| งาน | รายละเอียด |
|---|---|
| Re-run BigQuery + upload CSV | `sql/sales_portview.sql` มี col[24] account_name แล้ว รอ run + upload `sales_portview.csv` ใหม่ |
| Bar chart label overlap | เมื่อ bar สั้น label ซ้อนกัน — ต้องใส่ min-height guard + hide label |
| Sort button mobile test | ยืนยันว่า sort MTD / Expiry work บน mobile จริง |
| Sales TL view | ยังไม่ได้ build (commission + team view) |
| transfer_out validation | Flagged ว่า "feeling strange" — ยังไม่ได้ investigate |
