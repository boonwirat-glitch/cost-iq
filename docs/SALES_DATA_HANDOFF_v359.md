# Sales Data Phase 1 Handoff — v359
**สร้าง:** June 2026 · Session: Sales UX Architecture & Phase 1 Data
**SW:** freshket-sense-v359 · **Branch:** main
**Snapshot:** `snapshot/pre-phase1-data-v358`

---

## ทำเสร็จใน session นี้ ✅

### Code patch (deployed)
- **`src/02_data_pipeline.js`** — Sales users skip `handover` from FOREGROUND fetch
  - ก่อน: 404 console error ทุก Sales login (no `sales_handover_{key}.csv`)
  - หลัง: `handover` filtered out for `sales` / `sales_tl` roles → no noise
  - KAM ไม่กระทบ (FOREGROUND ยังครบ 8 files)

### SQL files (pushed to `sql/`)
| File | Purpose | Replaces `{SALES_EMAIL}` with |
|------|---------|-------------------------------|
| `Q_sales_portview_v1.sql` | Portview per rep | rep email |
| `Q_sales_skus_v1.sql` | SKU bundle per rep | rep email |
| `Q_sales_alts_v1.sql` | Alts bundle per rep | rep email |
| `sales_targets_insert.sql` | Supabase target INSERT template | rep email + amount |

### Architecture decisions documented
- `handover CSV` ที่ SALES_UI_HANDOFF_v358 พูดถึง = KAM Q10 format ≠ Sales handover warning
- Sales handover warning section ใช้ portview data (col[21] `newUserExpDate`) — ไม่ต้องการ CSV แยก
- safeKey formula: `email.toLowerCase().replace(/[^a-z0-9]/g,'_')` — consistent กับ _kamSafeKey()

---

## งานที่เหลือ — ต้องการ Bucci ก่อน

### Priority 1: Email list + Target ต่อ rep
ต้องการจาก Bucci:
1. Email ของ Sales rep 15 คน (Team A: 6, Team B: 6, Team C: 3)
2. Monthly GMV target ต่อ rep (บาท)

เมื่อได้แล้ว → Claude สร้าง:
- safeKey mapping table
- BigQuery run checklist ต่อ rep (copy-paste ready)
- Supabase bulk INSERT script

### Priority 2: BigQuery runs (ทำหลังได้ email list)
ต่อ rep 1 คน ต้องรัน 3 queries:
```
1. Q_sales_portview_v1.sql → sales_portview_{safeKey}.csv → R2
2. Q_sales_skus_v1.sql     → sense_skus_{safeKey}.csv    → R2
3. Q_sales_alts_v1.sql     → sense_alts_{safeKey}.csv    → R2
```
Guitar (malisa_c_freshket_co): portview ✅ · skus ❌ · alts ❌

### Priority 3: Supabase target INSERT
```sql
INSERT INTO targets (period, level, for_email, gmv_target)
VALUES ('2026-06', 'sales', '{EMAIL}', {AMOUNT})
ON CONFLICT (period, level, for_email) DO UPDATE SET gmv_target = EXCLUDED.gmv_target;
```
level = 'sales' เสมอ (ต่างจาก KAM ที่ใช้ 'kam')

---

## Phase 2 — UX Polish (รอ data ก่อน)

หลังจาก upload R2 + insert target แล้ว:

| จุด | Fix | File |
|-----|-----|------|
| Handover empty state | ถ้าไม่มีร้าน expire ≤14d → ซ่อน section ทั้งหมด | `10_sales_view.js` |
| Target = 0 UX | แทน warning → แนะนำ TL ตั้ง target | `10_sales_view.js` |
| Pipeline target | ต่อ `getSalesTarget()` แทน hardcode 1.6M | `10_sales_view.js` |
| Tenure render | test `_renderSalesAccountSummary()` | `10_sales_view.js` |
| Nav active | verify `_salesUpdateNavActive()` ทุก tab | `10_sales_view.js` |

---

## Deploy info

- SW: `freshket-sense-v359`
- Files changed: `src/02_data_pipeline.js`, `sw.js`, `index.html`
- New files: `sql/Q_sales_skus_v1.sql`, `sql/Q_sales_alts_v1.sql`, `sql/sales_targets_insert.sql`

## Session หน้า: เริ่มที่ไหน

1. รับ email list + target จาก Bucci
2. สร้าง safeKey table + BigQuery run guide ต่อ rep
3. หลัง upload → Phase 2 UX polish
