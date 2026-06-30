# Handoff: Q3 Commission Build — Preview Branch
**Date:** 2026-06-30
**Branch:** preview/q3-commission-build
**Status:** All phases complete — awaiting Supabase migration + R2 CSV upload before final test

---

## สรุปสิ่งที่ทำใน session นี้

### Branch สร้างจาก main @ c4b1c4261f2e

### Phase 1 — Config & SQL (✅ Done)
- `sql/q3_2026_movement_{kam,pm,admin,tl,rep}_view.sql` — 5 Q3 views (clone Q2, date range updated)
- `src/07c_qnrr_view.js` — QNRR_CFG ×2 updated → '2026q3', base_month='2026-06', q_months=Jul/Aug/Sep
- `src/02_data_pipeline.js` — _QNRR_QUARTER default → '2026q3'
- `src/shell.html` — Q2→Q3 labels (3 จุด: title, aria-label, eyebrow div)

### Phase 2 — Data Layer (✅ Done)
- `src/07c_qnrr_view.js` — `_qnrrComputeForCommission(kamEmail, scope)` — new function
  - Wraps `_qnrrCompute()` ที่มีอยู่แล้ว
  - Exposes `window._qnrrComputeForCommission`
  - Returns shape ที่ `_commBuildKamPayout` ต้องการ
- `src/07a_commission_engine.js` — `_commBaseMonthLabels(baseMonthOverride, count)` helper
- `src/07a_commission_engine.js` — `_commComputeUpsellSku(kamEmail, expansionIds, baseMonthOverride)` — 3rd param added

### Phase 3 — Wire Policy (✅ Done)
- `src/07a_commission_engine.js` — `_commBuildKamPayout()` wired:
  - reads `policy.commission_mode` from `_nrrGovResolveForVisibleScope()`
  - `[quarterly]` → `_qnrrComputeForCommission()` as NRR source
  - `[monthly]` → `_tgtComputeKamNRR()` unchanged
  - passes `baseMo` to `_commComputeUpsellSku()` for P1/P3 pin
  - adds `commission_mode`, `base_month`, `quarter_id`, `nrr_base_gmv` to return object
- `src/07a_commission_engine.js` — `_commBuildTlPayout()` wired (same pattern, 'tl' scope)
- `src/07a_commission_engine.js` — `saveCommissionPoliciesFromCockpit()` — sends `commission_mode` + `quarter_id` to Supabase
- Supabase select updated to include `commission_mode, quarter_id`

### Phase 4 — UI (✅ Done)
- `src/07b_commission_cockpit.js`:
  - Quarterly Mode card added to Policy step UI (radio buttons Monthly/Quarterly)
  - `_nrrGovGetQuarterlyMode()` helper — reads from policies/pending
  - `onNrrPolicyChangeMode(mode)` — updates all period policies at once
- `src/07b_commission_history.js`:
  - NRR hero card: shows "NRR xx% · vs มิ.ย. (Q3 fixed)" or "vs zzz (rolling)"
  - NRR row: nrrSub appends mode label

---

## ยังต้องทำ (ฝั่งคุณ)

### 1. Supabase Migration (ต้องทำก่อน)
รัน SQL ใน `docs/supabase-migration-q3-commission-mode.sql` ใน Supabase SQL Editor

### 2. BigQuery Export + R2 Upload
```
1. รัน sql/q3_2026_movement_kam_view.sql ใน BigQuery
   (ต้องรอ ก.ค. 2026 มีข้อมูลก่อน — ถ้ายังไม่มี data ก็ยังทดสอบ logic อื่นได้ก่อน)
2. Export เป็น CSV → upload ขึ้น R2 ชื่อ sense_qnrr_2026q3.csv
   ลำดับ: R2 upload FIRST → push index.html AFTER
```

### 3. Build index.html + bump SW (Claude ทำให้ใน session ถัดไปหรือ run build.py เอง)
```bash
python3 build.py v821    # หรือ version ถัดไป
# จะ output dist/sense_v821.html → copy เป็น index.html → push ลง preview branch
```

### 4. Test บน preview URL ตาม Test Spec T1–T14

### 5. เมื่อผ่านครบ → merge preview/q3-commission-build → main

---

## Files Changed on Preview Branch

| File | Change |
|---|---|
| `sql/q3_2026_movement_{kam,pm,admin,tl,rep}_view.sql` | NEW — Q3 views |
| `src/07c_qnrr_view.js` | QNRR_CFG Q3 + `_qnrrComputeForCommission()` |
| `src/07a_commission_engine.js` | helper + param + KAM/TL payout wire + save payload |
| `src/07b_commission_cockpit.js` | Quarterly Mode UI card + handlers |
| `src/07b_commission_history.js` | base_month label in history detail |
| `src/02_data_pipeline.js` | _QNRR_QUARTER Q3 |
| `src/shell.html` | Q2→Q3 labels ×3 |
| `docs/supabase-migration-q3-commission-mode.sql` | NEW — migration SQL |

---

## CRITICAL: main branch ไม่ถูกแตะเลย
ทุก push เข้า `preview/q3-commission-build` เท่านั้น
Users บน production เห็น v820 ตลอด ไม่มี broken state ใดๆ

---

## Test Spec (14 cases)
ดู `docs/handoff-2026-06-30-q3-commission-spec.md` Section 10

## Ground Truth GMV (locked)
Oct25=188.2M · Nov25=204.4M · Dec25=235.7M · Jan26=214.9M · Feb26=195.1M · Mar26=204.2M · Apr26=192.6M
