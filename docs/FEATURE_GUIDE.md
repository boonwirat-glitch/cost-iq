# Freshket Sense — Feature Development Guide
**Version:** Phase 0G  
**อัปเดตล่าสุด:** 2026-06-13

---

## ก่อนเริ่มเขียน feature ใหม่ — อ่านหน้านี้ก่อน

ทุก feature ใหม่ต้องทำ **3 สิ่ง** เท่านั้น จากนั้น RenderBus + DataRegistry จัดการทุกอย่างให้

---

## 1. ประกาศ Tier ที่ต้องการ

```javascript
// ใน src/XX_my_feature.js
// บรรทัดแรกของ init function หรือ DOMContentLoaded

// Option A — register กับ RenderBus (แนะนำ)
// RenderBus จะ call renderMyFeature() เมื่อ: screen active + tier ready + data version เปลี่ยน
RenderBus.register('scr-my-feature', 1, renderMyFeature);

// Option B — async/await สำหรับ one-time init
await DataRegistry.waitFor(2);
loadMyDetailData();

// Option C — callback
DataRegistry.onReady(1, function() {
  renderMyFeature();
});
```

### Tier ที่มี

| Tier | ข้อมูลที่พร้อม | ใช้เมื่อ |
|------|----------------|----------|
| `1` | portview + history + handover | แสดง list view, summary cards, pace bar |
| `2` | + categories + sku_current + outlets | แสดง account detail, category breakdown |
| `3` | + skus + alternatives | แสดง Sense analysis, opportunities |

---

## 2. แสดง Skeleton ขณะรอ Tier สูงกว่า

```javascript
function renderMyFeature() {
  const container = document.getElementById('my-feature-body');
  
  if (!DataRegistry.isReady(2)) {
    // แสดง skeleton แทนที่ว่าง — user ไม่งงว่าข้อมูลหาย
    shimmer(container, 4);  // 4 rows
    
    // รอ Tier 2 แล้ว render จริง
    DataRegistry.onReady(2, renderMyFeature);
    return;
  }
  
  // Tier 2 พร้อม — render จริง
  updateDOM(container, buildMyHTML());
}
```

### shimmer() options

```javascript
shimmer(el, rows)           // default shimmer
shimmer(el, 3, {height:'16px', gap:'12px'})  // custom height
shimmerHTML(3)              // ได้ HTML string สำหรับ embed ใน template literal
```

---

## 3. ใช้ updateDOM() แทน innerHTML

```javascript
// ❌ ห้ามทำ — memory leak เมื่อสลับ tab หลายรอบ
element.innerHTML = buildHTML();

// ✅ ถูกต้อง — cleanup listeners อัตโนมัติก่อน inject
updateDOM(element, buildHTML());
```

---

## CSS — กฎสำหรับ feature ใหม่

```
1. สร้างไฟล์ใหม่: src/styles_{feature_name}.css
2. Scope ทุก rule ด้วย screen ID: #scr-my-feature .my-class { ... }
3. ใช้ token จาก styles_tokens.css เท่านั้น — ห้าม hardcode hex
4. ห้าม !important
5. เพิ่มไฟล์ใหม่ใน build.py (ดู pattern ไฟล์อื่น)
```

---

## Build Pipeline

```bash
# แก้ src/ → rebuild → bump SW → push index.html
python3 build.py v{N}      # → dist/sense_v{N}.html
# แก้ sw.js: CACHE_NAME = 'sense-v{N}'  (ทั้ง comment + const)
# push src files → push sw.js → push index.html (Git Tree API สำหรับ large file)
```

---

## DataRegistry API Reference

```javascript
DataRegistry.isReady(tier)       // → boolean
DataRegistry.waitFor(tier)       // → Promise (resolves เมื่อ tier พร้อม)
DataRegistry.onReady(tier, fn)   // register callback
DataRegistry.markLoaded(tab)     // data loader เรียก (ปกติไม่ต้องเรียกเอง)
DataRegistry.reset()             // เรียกตอน logout (01_core.js จัดการให้แล้ว)
DataRegistry.version             // read-only int — เพิ่มทุก markLoaded()
DataRegistry.hasTab(tab)         // → boolean ว่า tab นั้น loaded แล้วหรือเปล่า
```

## RenderBus API Reference

```javascript
RenderBus.register(screenId, tier, fn)  // ← ใหม่ Phase 0G — feature declare ตัวเอง
RenderBus.signal(source)                // ← เดิม — data loader เรียกเมื่อ data พร้อม
RenderBus.flushNow()                    // immediate render (ปกติไม่ต้องใช้)
RenderBus.reset()                       // เรียกตอน reload (จัดการให้แล้ว)
```

---

## DOM Utilities Reference

```javascript
updateDOM(el, htmlString)   // inject HTML พร้อม listener cleanup
shimmer(el, rows, opts)     // inject skeleton loading placeholder
shimmerHTML(rows, opts)     // → HTML string (สำหรับใช้ใน template literal)
```

---

## ตัวอย่าง: Pipeline Kanban (feature ถัดไป)

```javascript
// src/13_pipeline.js

// 1. ประกาศ tier
RenderBus.register('scr-pipeline', 1, renderPipeline);

function renderPipeline() {
  const container = document.getElementById('pipeline-board');
  if (!container) return;
  
  // 2. Skeleton ขณะรอ Tier 2 (account detail ที่ต้องใช้ใน kanban cards)
  if (!DataRegistry.isReady(2)) {
    shimmer(container, 6, { height: '80px', gap: '12px' });
    DataRegistry.onReady(2, renderPipeline);
    return;
  }
  
  // 3. updateDOM (ไม่ใช่ innerHTML)
  updateDOM(container, buildKanbanHTML(portviewBulkData));
}
```

```css
/* src/styles_pipeline.css */
/* ทุก rule scoped ด้วย screen ID */
#scr-pipeline .kanban-col { ... }
#scr-pipeline .kanban-card { ... }
```

---

## Architecture Overview

```
Login → loadUserProfile() → _patchR2FilesForSales() → loadFromCloudflareR2()
         ↓                                               ↓
    hideLoginOverlay()                         _fetchCloudflareFile(tab)
         ↓                                               ↓
    showSenseSplash()                     DataRegistry.markLoaded(tab)  ← Phase 0G
         ↓                                               ↓
    onDone() @ t=900ms                    RenderBus.signal(tab)
         ↓                                               ↓
    _autoRouteAfterLogin()           [settle 800ms] → _flush()
                                              ↓
                                     version guard check  ← Phase 0G
                                              ↓
                                     refreshAll() + registered features
```

**Key rule:** Interactive actions (tap account, switch tab) → call `renderXxx()` directly, bypass RenderBus. Data-driven updates (background load, ETag) → always go through `RenderBus.signal()`.

