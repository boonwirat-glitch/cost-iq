# Freshket Sense — Override Map & Step 2 Handoff
**สร้างเมื่อ:** session หลัง v257 · **main HEAD:** 628ab15b165a
**Backup ล่าสุด:** `snapshot/pre-portview-merge-v257`

---

## ปัญหาที่เอกสารนี้แก้

ตอบคำถาม **"ทำไมแก้ portview/commission แล้วไม่มีผล / vibe coding หาสาเหตุไม่เจอ"**

**สาเหตุ:** มี ~39 functions ถูก define จริงใน >1 ไฟล์ (override ข้ามไฟล์) — แก้ origin แต่ app ใช้ version ที่ override ทีหลัง

**Execution order (build.py):**
```
01_core → 02_data → 03_rendering → 04_sku → 05_kam →
06_portview → 07a_comm → 07b_comm_ui → 08_patches
```
ไฟล์ load ทีหลัง = ชนะ

## วิธีอ่าน
- **WRAPPER** = save old + `.apply()` → ทุกชั้นรันร่วมกัน แก้ origin **มีผล** (logic เดิมยังทำงาน)
- **REPLACE** = เขียนทับทิ้ง → แก้ origin **ไม่มีผล** ⚠️ ต้องแก้ที่ override file

> ⚠️ Classification นี้มาจาก static regex scan — ก่อนแก้จริง **ควรเปิดไฟล์ยืนยันด้วยตา** โดยเฉพาะตัวที่ origin คือ 01/02 แล้ว override ใน 04_sku_matcher (อาจเป็น module re-export pattern ผ่าน FreshketSenseRuntime ไม่ใช่ override จริง)

---

## 🔴 REPLACE — แก้ origin ไม่มีผล (แก้ที่คอลัมน์ขวา)

| Function | Origin (อย่าแก้) | แก้ที่นี่ |
|---|---|---|
| `_commBuildKamSelfState` | 07a_commission_engine:1959 | **07b_commission_ui:4884** |
| `_commBuildPayoutSummary` | 07a_commission_engine:1920 | **07b_commission_ui:4749** |
| `_fetchKamBundle` | 02_data_pipeline:1386 | **08_patches:1030** |
| `_ncsChipToggle` | 07b_commission_ui:1971 | **08_patches:1449** |
| `_ncsClose` | 07b_commission_ui:2041 | **08_patches:1448** |
| `_ncsCopyTSV` | 07b_commission_ui:2028 | **08_patches:1453** |
| `_ncsExportCSV` | 07b_commission_ui:2015 | **08_patches:1452** |
| `_ncsSetTab` | 07b_commission_ui:1991 | **08_patches:1451** |
| `_ncsToggleAll` | 07b_commission_ui:1978 | **08_patches:1450** |
| `_tgtFmtInput` | 07a_commission_engine:1272 | **08_patches:2008** |
| `_tgtShowCohortSheet` | 07b_commission_ui:1838 | **08_patches:1447** |
| `disableRuntime` | 01_core:1158 | **04_sku_matcher:1562** |
| `enableRuntimeNextReload` | 01_core:1166 | **04_sku_matcher:1568** |
| `ensureAccountDetailData` | 02_data_pipeline:1689 | **08_patches:1008** |
| `ensureCloudflareFiles` | 02_data_pipeline:1313 | **04_sku_matcher:691** |
| `ensureSenseData` | 02_data_pipeline:1706 | **08_patches:223** |
| `exportCommissionSnapshotCsv` | 07a_commission_engine:2263 | **07b_commission_ui:4840** |
| `loadAltsFromSupabase` | 01_core:929 | **08_patches:564** |
| `loadFromCloudflareR2` | 02_data_pipeline:1578 | **04_sku_matcher:833** |
| `lockCommissionSnapshot` | 07a_commission_engine:2280 | **07b_commission_ui:4852** |
| `printDiagnostics` | 01_core:1203 | **04_sku_matcher:1557** |
| `reloadFromCloudflareR2` | 02_data_pipeline:1666 | **04_sku_matcher:892** |
| `renderTeamviewKamList` | 06_portview_teamview:1883 | **07b_commission_ui:2529** |
| `triggerSkuVerifyFromThisMonth` | 05_kam_view:816 | **08_patches:827** |
| `triggerSkuVerifyLastMonth` | 05_kam_view:925 | **08_patches:867** |

## 🟢 WRAPPER — แก้ origin มีผล (logic เดิมถูก wrap)

| Function | Origin | Wrapped by |
|---|---|---|
| `_commRenderKamSelfStrip` | 07a_commission_engine:2016 | 07b_commission_ui:4899 |
| `_startCloudBackgroundLoad` | 02_data_pipeline:1462 | 08_patches:984 |
| `_startDeferredPriceLoad` | 02_data_pipeline:1557 | 08_patches:996 |
| `handleFileUpload` | 02_data_pipeline:354 | 08_patches:1520 |
| `portviewSelectAccount` | 06_portview_teamview:1422 | 08_patches:246 |
| `renderKamLastMonth` | 05_kam_view:697 | 08_patches:268 |
| `renderKamOverview` | 05_kam_view:780 | 08_patches:277 |
| `renderKamThisMonth` | 05_kam_view:442 | 08_patches:259 |
| `renderPortview` | 06_portview_teamview:1459 | 08_patches:1305 |
| `renderPortviewList` | 06_portview_teamview:813 | 08_patches:1310 |
| `renderPortviewSummary` | 06_portview_teamview:1256 | 07b_commission_ui:2798 |
| `renderTeamview` | 06_portview_teamview:1663 | 07b_commission_ui:2818 |
| `sgOrbTap` | 04_sku_matcher:2717 | 08_patches:1073 |
| `showMatcherResults` | 04_sku_matcher:2591 | 08_patches:1101 |
---

## 📋 Step 2 Handoff — งานที่เหลือ

`08_patches.js` = 2,677 บรรทัด · เหลือ ~14 patches

### เสร็จแล้ว ✓
- v213c–f teamview → ย้ายเข้า `06`
- v213c dead JS → ลบ (fab-hide ทำโดย CSS แล้ว, version-override พิษกำจัดแล้ว)

### ลำดับแนะนำ (ตามความเสี่ยง)

**กลุ่ม A — 05_kam_view REPLACE (เสี่ยงต่ำ — ทำก่อน)**
หมายเหตุ: `renderKamThisMonth/LastMonth/Overview` จริงๆ เป็น **WRAPPER** ใน v206e (paint หลัง render) → ไม่ใช่ replace ง่ายๆ ตรวจก่อน
patches: v207a (opportunity 25L), v212b (panel-target 162L), v213-guided (259L)

**กลุ่ม B — _ncs* cluster = v211b → fold เข้า 07b (ไม่ใช่ 06)**
`_ncsClose/CopyTSV/ToggleAll/ChipToggle/SetTab/ExportCSV` + `_tgtShowCohortSheet`
ทั้งหมด origin = 07b (movement sheet เป็น commission UI) → v211b ควรกลับเข้า 07b

**กลุ่ม C — portview WRAPPER chain (เสี่ยงสูง — session เจาะ)**
`renderPortview/List/Summary` + `renderTeamview` = wrapper chain:
```
06 (original) → 07b (+normalizeProfile +_commGatedRender) → 08/v210l (+insight)
```
⚠️ ห้าม fold เข้า 06 ตรงๆ — execution order จะพัง เพราะ 07b wrapper ผูก commission internals
ต้อง redesign dependency 06↔07b ก่อน = งาน architecture

**กลุ่ม D — 01_core/02_data (เสี่ยงกลาง-สูง)**
v206e, v206f, v207, v207b, v212, v212a, v212c, v225
high risk: v212a (PWA freshness), v225 (resume coordinator) — override data load chain

---

## ⚙️ บทเรียน (ต้องจำ)
1. **อ่านไฟล์ผ่าน GitHub blob API เสมอ** — raw.githubusercontent ติด CDN cache → ได้ไฟล์เก่า → replace ผิด (เคยพลาด sw.js ค้าง v270)
2. **ทุก commit: push src + rebuild index.html + bump SW** (Cloudflare serve index.html)
3. **node --check ทุก JS ก่อน push**
4. **ทดสอบ mobile หลัง deploy ทุกครั้ง**
5. **Classification ใน map นี้ต้อง verify ด้วยตาก่อนแก้** — static scan มีขีดจำกัด

## Backups
- `snapshot/pre-refactor-v254` — ก่อน CSS extraction
- `snapshot/pre-patch-dissolve-v255` — ก่อน dissolve patches
- `snapshot/pre-portview-merge-v257` — ล่าสุด
