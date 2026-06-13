# Freshket Sense — Session Handoff
**Date:** 2026-06-13  
**Version deployed:** v644  
**Repo:** `github.com/boonwirat-glitch/cost-iq` · branch `main`

---

## Phase 0G — Data & Render Contract (เสร็จสมบูรณ์)

### สิ่งที่ทำ

#### 1. `window.DataRegistry` (ใหม่ — `src/02_data_pipeline.js`)
Single source of truth สำหรับ data readiness แทน `allCriticalReady()` boolean เดิม

**Tier system:**
- Tier 1 (SHELL): portview + history + handover → list views
- Tier 2 (DETAIL): + categories + sku_current + outlets → account detail  
- Tier 3 (ENHANCEMENT): + skus + alternatives → Sense/opportunities

**API:**
```javascript
DataRegistry.isReady(tier)     // boolean
DataRegistry.waitFor(tier)     // Promise
DataRegistry.onReady(tier, fn) // callback
DataRegistry.markLoaded(tab)   // data loaders call this (ทำอยู่แล้วใน _fetchCloudflareFile)
DataRegistry.version           // monotonic int — เพิ่มทุก markLoaded()
DataRegistry.reset()           // logout/reload
```

**Backward compatible:** `allCriticalReady()` ยังทำงาน → เรียก `DataRegistry.isReady(1)`

#### 2. `RenderBus V2` (`src/02_data_pipeline.js`)
เพิ่ม version guard — ป้องกัน double-render จาก ETag 304

**ใหม่:**
- `_lastRenderedVersion` — ถ้า `DataRegistry.version` ไม่เปลี่ยน → skip flush
- `register(screenId, tier, fn)` — feature declare ตัวเองกับ RenderBus
- Backward compatible: `signal(source)` ยังทำงานเหมือนเดิม 100%

**Root cause ที่แก้:** เลขกระพริบ 4-5 รอบ — IDB + R2 ETag + bundle signals มาพร้อมกัน แต่ data ไม่เปลี่ยน → version guard ตัดทิ้ง

#### 3. `updateDOM()` + `shimmer()` (`src/03_rendering.js`)
DOM utilities สำหรับทุก feature

```javascript
updateDOM(el, html)        // inject + listener cleanup → ตัด Admin memory leak
shimmer(el, rows, opts)    // skeleton placeholder → ตัด "SKU ว่าง 5-6 วิ"
shimmerHTML(rows, opts)    // → HTML string
```

**CSS:** `.sense-shimmer` + `.sense-shimmer-inner` ใน `styles_base.css`

#### 4. Scroll Guard (`src/06_portview_teamview.js`)
`_pvInitCollapseObserver._check()` ตอนนี้ detach listeners เมื่อ content ไม่มีอะไรให้ scroll

**Root cause ที่แก้:** scroll loop crash เมื่อ account card น้อย — เดิม `return` แต่ listeners ยังผูกอยู่ ตอนนี้ detach ทั้งหมดเมื่อ `_scrollable()` = false

#### 5. `docs/FEATURE_GUIDE.md` (ใหม่)
Developer contract — อ่านแล้วรู้ทันทีว่าต้องทำอะไร ไม่ต้องถาม

---

## Files Changed

```
src/01_core.js             ← DataRegistry.reset() ใน resetRuntimeSessionState
src/02_data_pipeline.js    ← DataRegistry + RenderBus V2 (version guard + register)
src/03_rendering.js        ← updateDOM() + shimmer() + shimmerHTML()
src/06_portview_teamview.js ← scroll guard with listener detach
src/styles_base.css        ← .sense-shimmer CSS class
docs/FEATURE_GUIDE.md      ← NEW: developer contract
sw.js                      ← CACHE_NAME = sense-v644
index.html                 ← rebuilt v644
```

---

## Root Causes แก้แล้ว

| ปัญหา | สาเหตุ | วิธีแก้ |
|-------|---------|---------|
| เลขกระพริบ 4-5 รอบ | IDB+ETag+bundle signals ยิง render ซ้ำ แม้ data ไม่เปลี่ยน | RenderBus V2 version guard |
| SKU ว่าง 5-6 วิ | ไม่มี tier gate สำหรับ detail data | shimmer() + DataRegistry.waitFor(2) pattern |
| Scroll loop crash | `_check()` return แต่ listeners ยังผูก | detach listeners เมื่อ not scrollable |
| Admin crash สลับ tab | innerHTML rebuild ไม่ cleanup listeners | updateDOM() helper |

---

## งานที่ค้างและยังต้องทำ

### ✅ Phase 0E — CSS Scoping (เสร็จแล้ว)
### ✅ Phase 0G — Data & Render Contract (เสร็จแล้ว)

### 🔲 Phase 0F — Responsive Foundation
- `clamp()` body max-width
- Breakpoint tokens: `--bp-mobile`, `--bp-tablet`, `--bp-desktop`
- Base responsive rules

### 🔲 Migrate feature เก่า → ใช้ DataRegistry + updateDOM
- portview/teamview render functions → updateDOM pattern
- SKU section → shimmer while waiting Tier 2/3

### 🔲 Phase 1 — TL Web Dashboard
- Blocked on Phase 0F (responsive grid)
- ใช้ `RenderBus.register('scr-dashboard', 1, renderDashboard)` pattern

### 🔲 SQL2 Fix + SmartSelect regression

---

## How to Add a New Feature (สรุปเร็ว)

```javascript
// 1. Declare tier (2 lines)
RenderBus.register('scr-my-feature', 1, renderMyFeature);

// 2. Show skeleton while waiting higher tier
function renderMyFeature() {
  if (!DataRegistry.isReady(2)) {
    shimmer(el, 4);
    DataRegistry.onReady(2, renderMyFeature);
    return;
  }
  updateDOM(el, buildHTML());  // 3. Use updateDOM not innerHTML
}
```

อ่านรายละเอียดเพิ่มใน `docs/FEATURE_GUIDE.md`
