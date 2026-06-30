# Handoff: Q3 2026 Commission Migration Spec
**Date:** 2026-06-30  
**Author:** Session analysis — ready for build session  
**Status:** SPEC ONLY — ยังไม่มีการแก้ code ใดๆ ใน session นี้

---

## 1. Context & Goal

### สิ่งที่เปลี่ยนใน Q3

| เรื่อง | Q2 (เดิม) | Q3 (ใหม่) |
|---|---|---|
| NRR commission | Rolling MoM (ฐาน = เดือนก่อน) | Fixed base = มิ.ย. 2026 ตลอดไตรมาส |
| Expansion commission | Rolling MoM | Fixed base = มิ.ย. 2026 |
| Upsell P1/P3 | 3M lookback จาก current month | 3M lookback จาก มิ.ย. 2026 (pin ตลอด Q3) |
| Handover retention | MoM | **ไม่เปลี่ยน — MoM ตลอด** |
| QNRR sheet | Q2 (เม.ย.–มิ.ย., base=มี.ค.) | Q3 (ก.ค.–ก.ย., base=มิ.ย.) |

### หลักการสำคัญ
1. **MoM engine เดิมต้องทำงานได้ครบ** — ไม่แตะ `_tgtComputeKamNRR()`, `_commComputeHandoverRetention()`, และ engine เดิมทั้งหมด
2. **Quarterly mode = layer ใหม่** ที่ถูก activate ผ่าน `nrr_policies` config — ไม่ใช่ replace
3. **Source of truth เดียว** — commission Q3 อ่านจาก `bulkQnrrData` (QNRR CSV) ไม่ใช่ `bulkHistoryData` เพื่อให้ตัวเลขตรงกับ QNRR sheet 100%
4. **Config ผ่าน Commission Cockpit** — Admin set ใน UI ไม่ hardcode ใน JS

---

## 2. Architecture Overview

```
Admin ตั้ง nrr_policies (commission_mode='quarterly', base_month='2026-06')
          │
          ▼
_commBuildKamPayout() / _commBuildTlPayout()
  ├─ [quarterly mode] → _qnrrComputeForCommission()  ← ใหม่
  │     └─ อ่านจาก bulkQnrrData (sense_qnrr_2026q3.csv)
  │           └─ ใช้ _qnrrCompute() ที่มีอยู่แล้ว
  │
  ├─ [monthly mode]   → _tgtComputeKamNRR()          ← เดิม ไม่แตะ
  │
  ├─ _commComputeUpsellSku(email, ids, baseMonthOverride)  ← เพิ่ม param
  │     └─ [quarterly] baseMonthOverride='2026-06' → 3M lookback = มิ.ย./พ.ค./เม.ย.
  │     └─ [monthly]   baseMonthOverride=null → rolling เหมือนเดิม
  │
  └─ _commComputeHandoverRetention()                  ← ไม่แตะ (MoM เสมอ)
```

### Data Flow Q3
```
BigQuery Q3 SQL views (ก.ค.–ก.ย., base=มิ.ย.)
  → export CSV → R2: sense_qnrr_2026q3.csv
  → _fetchQnrrBundle() → bulkQnrrData {byKamEmail, byTlEmail, allRows}
  → _qnrrCompute(email, scope)        ← QNRR sheet (ไม่เปลี่ยน)
  → _qnrrComputeForCommission(email)  ← Commission (ใหม่, wrap เดียวกัน)
```

---

## 3. Data Structure Changes

### 3.1 `nrr_policies` table — เพิ่ม 2 columns

```sql
ALTER TABLE nrr_policies
  ADD COLUMN commission_mode text NOT NULL DEFAULT 'monthly',
  -- 'monthly' = rolling MoM เดิม
  -- 'quarterly' = fixed base ตลอด Q

  ADD COLUMN quarter_id text;
  -- '2026-Q3' เมื่อ commission_mode = 'quarterly'
```

**ต้องรัน Supabase migration ก่อน build**

### 3.2 `commission_snapshots` — ไม่แก้ schema, เพิ่มใน `breakdown` JSON

```js
// เพิ่มใน breakdown ตอน compute snapshot
breakdown: {
  // ...existing fields ทั้งหมดคงไว้...
  commission_mode: 'quarterly',     // ← เพิ่ม
  base_month:      '2026-06',       // ← เพิ่ม
  quarter_id:      '2026-Q3',       // ← เพิ่ม
  nrr_base_gmv:    1234567          // ← เพิ่ม (base_norm × 30 จาก QNRR)
}
```

### 3.3 CSV files ที่ต้องสร้างใหม่

| File | Action |
|---|---|
| `sense_qnrr_2026q3.csv` | Export จาก Q3 SQL views (สร้างใหม่) |
| `portview_handover.csv` | ไม่เปลี่ยน — MoM ปกติ |
| Q9 history CSV | ต้องมีข้อมูล มิ.ย. ครบก่อน Q3 start |
| Q3C upsell CSV | ต้องมี มิ.ย./พ.ค./เม.ย. ใน data |

### 3.4 QNRR SQL Views — สร้าง Q3 set

Clone จาก Q2 views (`sql/q2_2026_movement_*_view.sql`) → `sql/q3_2026_movement_*_view.sql`  
เปลี่ยนเฉพาะ date range:

```sql
-- params CTE ใน Q3 views
SELECT
  DATE('2026-06-01') AS base_start, DATE('2026-06-30') AS base_end, 30 AS base_days,
  DATE('2026-07-01') AS jul_start,  DATE('2026-07-31') AS jul_end,  31 AS jul_days,
  DATE('2026-08-01') AS aug_start,  DATE('2026-08-31') AS aug_end,  31 AS aug_days,
  DATE('2026-09-01') AS sep_start,
  DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY) AS sep_end,
  DATE_DIFF(...) AS sep_days
```

**ไม่แก้ movement classification logic** — expansion definition จะ self-adjust ตาม `first_dollar_date >= ก.ค.` โดยอัตโนมัติจาก SQL ที่มีอยู่

### 3.5 `QNRR_CFG` — แก้ทั้ง 2 copies ใน `07c_qnrr_view.js`

```js
// QNRR_CFG global (บนสุดไฟล์) + ใน IIFE (ล่าง) — ต้องแก้ทั้งสอง
var QNRR_CFG = {
  quarter:    '2026q3',
  base_month: '2026-06',
  q_months:   ['2026-07','2026-08','2026-09'],
  months_th:  {
    '2026-06':'มิ.ย.','2026-07':'ก.ค.',
    '2026-08':'ส.ค.', '2026-09':'ก.ย.'
  },
  csv_file:   'sense_qnrr_2026q3.csv'
};
```

### 3.6 `_QNRR_QUARTER` default — `02_data_pipeline.js` L1771

```js
// เปลี่ยน
const _QNRR_QUARTER = (FRESHKET_APP_CONFIG.data && FRESHKET_APP_CONFIG.data.qnrrQuarter) || '2026q3';
```

### 3.7 `shell.html` — hardcode labels 3 จุด

```html
<!-- L3426 -->
title="ดูสุขภาพพอร์ต Q3"

<!-- L3792 -->
aria-label="สุขภาพพอร์ต Q3"

<!-- L3797 -->
<div class="qnrr-eyebrow">Portfolio Health · Q3 2026</div>
```

---

## 4. Calculation Logic

### 4.1 NRR Quarterly — `_qnrrComputeForCommission()` (สร้างใหม่)

**ไฟล์:** `07c_qnrr_view.js` (expose เป็น `window._qnrrComputeForCommission`)

```js
function _qnrrComputeForCommission(kamEmail, scope) {
  // scope: 'kam' | 'tl' | 'admin'
  // 1. เรียก _qnrrCompute(kamEmail, scope) ที่มีอยู่แล้ว
  // 2. ดึง base_norm, base_gmv, by_month จาก result
  // 3. return structure ที่ _commBuildKamPayout() ต้องการ:
  return {
    nrr:              by_month[currentPeriod].nrr_pct / 100,  // float 0-1
    baselinePrevGmv:  Math.round(base_norm * 30),             // normalized base
    cohortGmv:        by_month[currentPeriod].segments.core_nrr,
    expansionGmv:     by_month[currentPeriod].segments.expansion,
    comebackGmv:      by_month[currentPeriod].segments.comeback,
    cohortCount:      by_month[currentPeriod].outlets.core_nrr,
    // fields ที่ _commBuildKamPayout ใช้ต่อ:
    prevMonth:        'มิ.ย. 2569',   // fixed label
    base_month:       '2026-06',
    commission_mode:  'quarterly'
  };
}
window._qnrrComputeForCommission = _qnrrComputeForCommission;
```

**หมายเหตุ:** `_qnrrCompute()` มี scope handling (kam/tl/admin) อยู่แล้ว — แค่ wrap และ reshape output

### 4.2 Expansion Quarterly

**ไม่ต้องสร้าง logic ใหม่** — expansion rows มาจาก `bulkQnrrData` ซึ่ง SQL view classify ไว้แล้ว

```js
// ใน _qnrrComputeForCommission():
expansionGmv = sum(curr_gmv ÷ curr_days × 30)
               ของ rows ที่ movement_type = 'expansion'
               ใน period_month = currentPeriod
```

### 4.3 Upsell P1/P3 — เพิ่ม `baseMonthOverride` param

**ไฟล์:** `07a_commission_engine.js` — ฟังก์ชัน `_commComputeUpsellSku()`

```js
// เพิ่ม param ที่ 3 — backward compatible (default null)
function _commComputeUpsellSku(kamEmail, expansionIds, baseMonthOverride) {

  // ถ้า baseMonthOverride มี → anchor 3M lookback จากนั้น
  // ถ้าไม่มี → ใช้ _commBaselineMonthLabel() เหมือนเดิม (rolling)

  // baseMonthOverride = '2026-06' → labels = ['มิ.ย. 2569','พ.ค. 2569','เม.ย. 2569']
  // baseMonthOverride = null      → labels = _commMonthLabelOffset(1,2,3) เหมือนเดิม

  // P1: 3M window ไม่เลื่อนตลอด Q3 Jul/Aug/Sep → window เดิม = มิ.ย./พ.ค./เม.ย.
  // P3: maxBaseline = max(มิ.ย./พ.ค./เม.ย.) pin ตลอด — ไม่เลื่อนเป็น ก.ค./มิ.ย./พ.ค. ใน Aug
}
```

**helper ที่ต้องเพิ่ม:**
```js
function _commBaseMonthLabels(baseMonthOverride, count) {
  // returns array ของ Thai month labels ย้อนหลัง count เดือนจาก baseMonthOverride
  // ถ้า baseMonthOverride = null → ใช้ current lag-1 anchor (เดิม)
  if (!baseMonthOverride) {
    return Array.from({length: count}, (_, i) => _commMonthLabelOffset(i + 1));
  }
  // parse '2026-06' → สร้าง array ย้อนหลัง count เดือน
  const [yr, mo] = baseMonthOverride.split('-').map(Number);
  return Array.from({length: count}, (_, i) => {
    const d = new Date(yr, mo - 1 - i, 1);
    return _TH_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  });
}
```

### 4.4 Wire Policy เข้า `_commBuildKamPayout()` และ `_commBuildTlPayout()`

```js
// ใน _commBuildKamPayout(kamEmail):
const policy = _nrrGovResolveForVisibleScope();
const isQ = policy.commission_mode === 'quarterly';

// NRR + Expansion
const nrrResult = isQ
  ? _qnrrComputeForCommission(kamEmail, 'kam')
  : _tgtComputeKamNRR(kamEmail, null);         // เดิม — ไม่แตะ

// Expansion GMV (quarterly อ่านจาก nrrResult เลย, monthly ผ่าน _commComputeUpsellOutlet เดิม)
const upsellOutlet = isQ
  ? { commission: (nrrResult.expansionGmv || 0) * rate, ... }
  : _commComputeUpsellOutlet(kamEmail);         // เดิม — ไม่แตะ

// Upsell SKU — เพิ่ม baseMonthOverride
const upsellSku = _commComputeUpsellSku(
  kamEmail,
  expansionIds,
  isQ ? policy.base_month : null               // ← null = rolling เดิม
);

// Handover — ไม่เปลี่ยน
const handover = _commComputeHandoverRetention(kamEmail);  // MoM เสมอ

// เพิ่มใน breakdown
breakdown.commission_mode = isQ ? 'quarterly' : 'monthly';
breakdown.base_month       = isQ ? policy.base_month : null;
breakdown.quarter_id       = isQ ? policy.quarter_id : null;
breakdown.nrr_base_gmv     = isQ ? Math.round((nrrResult.baselinePrevGmv || 0)) : null;
```

---

## 5. Commission Cockpit — UI Changes

### 5.1 Policy Step (`renderCommPolicyStep`) — เพิ่ม Quarterly section

เพิ่ม section ใหม่ใต้ existing NRR base policy card:

```
┌─ Commission Mode ──────────────────────────────────────────┐
│  ไตรมาส Q3 2026 (ก.ค.–ก.ย.)                               │
│                                                             │
│  Mode:  ○ Monthly (Rolling MoM)   ● Quarterly (Fixed Base) │
│  Base:  มิ.ย. 2569  (auto จาก base_month ข้างบน)           │
│                                                             │
│  NRR           ✓ quarterly fixed                           │
│  Expansion     ✓ quarterly fixed                           │
│  Upsell P1/P3  ✓ quarterly (3M lookback จาก มิ.ย.)         │
│  Handover      🔒 monthly เสมอ (ไม่เปลี่ยน by design)      │
└─────────────────────────────────────────────────────────────┘
```

**onChange:** เขียนลง `_nrrGovPending` ด้วย key เดิม — save ผ่าน `saveCommissionPoliciesFromCockpit()` เดิม (แค่ต้องส่ง `commission_mode` และ `quarter_id` เพิ่มใน payload)

### 5.2 Lock Step — แสดง base month ใน preview table

เพิ่ม column "Base" ใน preview table:
```
Role | Beneficiary | TL | NRR% | Base | Payout | Status
KAM  | ning@...    | ...| 94%  | มิ.ย.| ฿12,000| Draft
```

### 5.3 ไม่ต้องแก้ Step 2 (Assignment), 3 (Rules), 4 (Exceptions)

---

## 6. Commission History — UI Changes

**ไฟล์:** `07b_commission_history.js` — ฟังก์ชัน `_commOpenHistoryDetail()`

เพิ่ม label แสดง base month จาก `breakdown.commission_mode`:

```js
// ใน hero card
var baseLabel = bd.commission_mode === 'quarterly'
  ? 'vs มิ.ย. (Q3 fixed)'
  : 'vs ' + fmtPeriod(prevMonth) + ' (rolling)';

// แสดงใต้ NRR%
'<div style="font-size:10px;color:rgba(188,215,255,.55)">NRR ' + nrr + ' · ' + baseLabel + '</div>'
```

---

## 7. Blast Radius Summary

### สร้างใหม่ — ไม่กระทบของเดิม
| ไฟล์ | สิ่งที่เพิ่ม |
|---|---|
| `07c_qnrr_view.js` | `_qnrrComputeForCommission()` — function ใหม่ |
| `07b_commission_cockpit.js` | Quarterly Mode section ใน Policy step |
| `sql/q3_2026_movement_*_view.sql` | 5 files clone จาก Q2 (kam/pm/admin/tl/rep) |

### แก้แบบ backward-compatible — เพิ่ม optional param
| ไฟล์ | สิ่งที่แก้ |
|---|---|
| `07a_commission_engine.js` | `_commComputeUpsellSku()` + param `baseMonthOverride` |
| `07a_commission_engine.js` | `_commBuildKamPayout()` + policy check |
| `07a_commission_engine.js` | `_commBuildTlPayout()` + policy check |
| `07b_commission_history.js` | แสดง base_month label จาก breakdown |

### เปลี่ยน config — ไม่กระทบ logic
| ไฟล์ | สิ่งที่แก้ |
|---|---|
| `07c_qnrr_view.js` | `QNRR_CFG` ×2 (global + IIFE) |
| `02_data_pipeline.js` | `_QNRR_QUARTER` default → '2026q3' |
| `shell.html` | Q2→Q3 label 3 จุด (L3426, L3792, L3797) |

### ไม่แตะเลย
- `_tgtComputeKamNRR()` — MoM engine ยังทำงานครบ
- `_commComputeHandoverRetention()` — MoM by design
- `_commComputeGmvGate()` — รับ nrrPct ที่ compute แล้ว
- `_nrrGovernedPct()` — apply หลัง compute
- NRR Exclusions flow ทั้งหมด
- `commission_snapshots` table schema
- `commission_plans`, `commission_plan_assignments` tables

### Supabase migration ที่ต้องรันก่อน build
```sql
ALTER TABLE nrr_policies
  ADD COLUMN IF NOT EXISTS commission_mode text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS quarter_id text;
```

---


## 8. Safe Build Strategy — Preview Branch

### ปัญหา: การ push ตรงบน main ทำให้ users เห็น broken state ระหว่าง build

เช่น push JS เสร็จแล้วแต่ยังไม่มี `sense_qnrr_2026q3.csv` ใน R2 → QNRR sheet ขึ้น error ทันที

### วิธีที่ถูกต้อง: Preview Branch + Cloudflare Pages

Cloudflare Pages auto-deploy ทุก branch แยกกัน — production URL ไม่กระทบ

```
main branch           → freshket-sense.pages.dev          (production — users ใช้)
preview/q3-build      → abc123.freshket-sense.pages.dev   (preview — ทดสอบคนเดียว)
```

**ขั้นตอน:**
```
1. สร้าง branch: preview/q3-commission-build จาก main
2. build และ push ทุก step ลง branch นั้น (ไม่แตะ main)
3. Cloudflare Pages auto-deploy → ได้ preview URL
4. ทดสอบตาม Test Spec บน preview URL ด้วย real Supabase + R2 data
5. ผ่านครบ → merge preview/q3-commission-build → main
6. Production deploy อัตโนมัติ
```

**ข้อดีของ preview branch:**
- Auth, R2 CSV, Supabase ทำงานครบเหมือน production (ใช้ resource เดียวกัน)
- Users บน main ไม่เห็นอะไรตลอดกระบวนการ
- ถ้า build พังสามารถ abandon branch ได้เลยโดยไม่กระทบอะไร

### ลำดับ R2 Upload — สำคัญมาก

ต้องอัปโหลด `sense_qnrr_2026q3.csv` ขึ้น R2 **ก่อน** push index.html เสมอ
เพราะ R2 และ JS deploy เป็น independent steps — ถ้า JS ขึ้นก่อน CSV พร้อม จะ error ช่วงสั้นๆ

```
✅ ลำดับที่ถูก:
   BigQuery export → upload R2 → push JS + index.html → merge main

❌ ลำดับที่ผิด:
   push JS + index.html → upload R2  (users เห็น error ระหว่างนั้น)
```

### ทดสอบ Local (optional)

ถ้าต้องการดู UI เบื้องต้นก่อน push:
```bash
python3 build.py v850          # สร้าง dist/sense_v850.html
open dist/sense_v850.html      # เปิดใน browser
```
ข้อจำกัด: Supabase auth และ R2 data ไม่ทำงานใน local — ใช้ดูแค่ layout/UI เท่านั้น ตัวเลขจริงต้องทดสอบผ่าน preview URL

---

## 9. Build Order (session ถัดไป)

```
Step 1: Supabase migration (ALTER TABLE nrr_policies)
Step 2: สร้าง Q3 SQL views ×5 (clone Q2, เปลี่ยน date range)
Step 3: Export sense_qnrr_2026q3.csv จาก BigQuery → upload R2
Step 4: แก้ QNRR_CFG + _QNRR_QUARTER + shell.html labels
Step 5: สร้าง _qnrrComputeForCommission() ใน 07c
Step 6: เพิ่ม baseMonthOverride ใน _commComputeUpsellSku()
Step 7: Wire policy ใน _commBuildKamPayout() + _commBuildTlPayout()
Step 8: เพิ่ม Quarterly Mode UI ใน Cockpit Policy step
Step 9: เพิ่ม base_month label ใน Commission History detail
Step 10: build.py + bump SW cache + push index.html
Step 11: ทดสอบตาม Test Spec
```

---

## 10. Test Spec

| ID | สิ่งที่ทดสอบ | Input | Expected |
|---|---|---|---|
| T1 | NRR base lock | policy=quarterly, base=มิ.ย., query ก.ค. | `prevMonth` = มิ.ย. 2569 ไม่ใช่ พ.ค. |
| T2 | NRR ส.ค. | base=มิ.ย., ส.ค. lock | `baselinePrevGmv` = Jun ไม่ใช่ ก.ค. |
| T3 | NRR reconcile | KAM X, ก.ค. | NRR% commission = NRR% QNRR sheet ±0% (same source) |
| T4 | Expansion definition | outlet firstDollarDate=2026-07-15 | movement_type=expansion ใน ก.ค. row |
| T5 | Expansion carry-over | outlet firstDollarDate=2026-07-15, query ส.ค. | ส.ค. = expansion อีกครั้ง (double-count by design) |
| T6 | P3 base pin ส.ค. | maxBaseline ส.ค. | = max(มิ.ย./พ.ค./เม.ย.) ไม่เลื่อนเป็น max(ก.ค./มิ.ย./พ.ค.) |
| T7 | P1 window pin | 3M window ส.ค. | = มิ.ย./พ.ค./เม.ย. ไม่ใช่ ก.ค./มิ.ย./พ.ค. |
| T8 | Handover MoM | ก.ค. lock | window = มิ.ย. transfer (MoM ปกติ ไม่แตะ) |
| T9 | MoM fallback | policy=monthly | `_tgtComputeKamNRR()` ทำงานปกติ ตัวเลขไม่เปลี่ยน |
| T10 | History label | ก.ค. snapshot, quarterly | `bd.commission_mode='quarterly'`, แสดง "vs มิ.ย. (Q3 fixed)" |
| T11 | Policy publish | Admin set quarterly → save | KAM refresh → NRR% เปลี่ยน source ทันที |
| T12 | Cockpit preview | quarterly mode active | Preview table แสดง base month column |
| T13 | QNRR sheet | CSV Q3 โหลด | bar chart แสดง ก.ค./ส.ค./ก.ย., base bar = มิ.ย. |
| T14 | Row count | Q3 SQL views รัน | rows ไม่เพิ่ม vs Q2 (outlet count ต่างได้, structure เหมือน) |

---

## 11. Known Constraints & Decisions

| ประเด็น | Decision |
|---|---|
| Double-count expansion | ยอมรับ — outlet เปิด ก.ค. นับ expansion ใน ส.ค./ก.ย. ด้วย Admin tune rate แทน |
| P1/P3 window | 3M lookback นับจาก base_month (มิ.ย.) ไม่เลื่อนตลอด Q3 |
| Handover | MoM ตลอด — window = transfer เดือนก่อน ไม่ขึ้นกับ quarterly mode |
| Source of truth | `bulkQnrrData` (QNRR CSV) เป็น single source สำหรับ commission Q3 — ไม่ใช้ `bulkHistoryData` |
| `account_type` filter | pm_view / admin_view / rep_view มี `COALESCE(um.account_type, r.account_type)` จาก `dim.user_master` แล้ว (แก้ในสession 2026-06-29) |

---

*Build session ถัดไปเริ่มจาก Step 1 (Supabase migration) ก่อนเสมอ*
