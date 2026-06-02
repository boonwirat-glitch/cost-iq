# Step 3 Handoff — Split 07b_commission_ui.js
**ทำหลัง Step 2 เสร็จแล้ว** ✓ Step 2 เสร็จสมบูรณ์แล้ว (session 2025-06-02)

---

## สถานะปัจจุบัน (อัพเดทจาก code จริง)
- **HEAD:** cee2d1d55945
- **SW:** v281
- **07b_commission_ui.js:** 5,420 บรรทัด (ไม่ใช่ 5,277 — เพราะ Step 2 fold v211c เพิ่ม)
- **Backup:** snapshot/pre-step2-dissolve-v257 (ยังใช้ได้)

---

## ทำไมต้องทำ
`07b_commission_ui.js` = 5,420 บรรทัด — ใหญ่เกินกว่า Claude จะอ่านครบใน session เดียวได้
ทุกครั้งที่แก้ commission มี blind spot อยู่เสมอ → แตกแล้วอ่านได้ครบทุกไฟล์ที่เกี่ยวข้อง

---

## SECTION boundaries จริง (verify จาก code แล้ว)

| Section | บรรทัดจริง | หมายเหตุ |
|---|---|---|
| `SECTION:COMMISSION_COCKPIT` | 1 | |
| `SECTION:NRR_COMPUTE` | 1,520 | doc เก่าบอก ~1,375 — ผิด |
| `SECTION:NRR_WIDGET` | 2,069 | |
| `COMMISSION PATCHES` | 2,703 | |
| `v247d Rulebook` | 4,908 | |
| `v247e History Sheet` | 5,045 | |
| `Step 2 dissolve fold (v211c)` | 5,280 | เพิ่มมาจาก Step 2 |

---

## แผนแตกไฟล์ (ตาม boundary จริง)

**`07b_commission_cockpit.js`** (lines 1–1,519)
- SECTION:COMMISSION_COCKPIT
- Commission rule editor, cockpit overlay, TL/KAM plan assignment UI

**`07b_nrr_target.js`** (lines 1,520–2,702)
- SECTION:NRR_COMPUTE + SECTION:NRR_WIDGET
- NRR calculation engine, cohort drill sheet (_ncs*), target input/save, portview NRR bar

**`07b_cds.js`** (lines 2,703–5,044)
- COMMISSION PATCHES + Commission Detail Sheet
- CDS L1/L2 tabs (P1/P3/NRR/Expansion/Handover), snapshot, admin guards
- _commBuildPayoutSummary, _commBuildKamSelfState (WRAPPER ทั้งคู่ — ไม่ใช่ REPLACE)

**`07b_commission_history.js`** (lines 5,045–5,420)
- v247d Rulebook + v247e History Sheet + v211c fold (Step 2)

---

## Override classification จริง (ต่างจาก doc เก่า — verify แล้ว)

| Function | Classification จริง | หมายเหตุ |
|---|---|---|
| `renderPortviewList` | WRAPPER | .apply() อยู่ที่ line 2,628 |
| `renderPortviewSummary` | WRAPPER | .apply() อยู่ที่ line 2,797 |
| `renderTeamview` | **REPLACE** | doc เก่าบอก WRAPPER — ผิด ไม่มี .apply() |
| `renderTeamviewKamList` | WRAPPER | _origRenderTeamviewKamList.apply() |
| `_commBuildPayoutSummary` | **WRAPPER** | doc เก่าบอก REPLACE — ผิด มี oldSummary.apply() |
| `_commBuildKamSelfState` | **WRAPPER** | doc เก่าบอก REPLACE — ผิด มี oldKamState.apply() |
| `exportCommissionSnapshotCsv` | REPLACE | ทับ 07a |
| `lockCommissionSnapshot` | REPLACE | ทับ 07a |

---

## build.py ที่ต้องแก้

```python
# เดิม
commission_js = read('src/07a_commission_engine.js') + read('src/07b_commission_ui.js')

# ใหม่
commission_js = (
    read('src/07a_commission_engine.js') +
    read('src/07b_commission_cockpit.js') +
    read('src/07b_nrr_target.js') +
    read('src/07b_cds.js') +
    read('src/07b_commission_history.js')
)
```

---

## วิธีทำ

1. **Backup** — `snapshot/pre-07b-split-vXXX`
2. **อ่าน 07b จริงผ่าน blob API** — verify line ranges ก่อนแตก (อาจขยับได้)
3. **แตกไฟล์** — split ตาม boundary ด้านบน
4. **แก้ build.py**
5. **node --check** ทุกไฟล์ใหม่
6. **build local** ก่อน push
7. **push src + build + bump SW**
8. **ทดสอบ commission UI** ทุก tab (cockpit, CDS P1/P3/NRR/Expansion/Handover, History)

---

## Dependency หลัก (ไม่กระทบ runtime)

เพราะ build.py รวมทุกไฟล์เป็น single script — function ยังอยู่ใน global scope เหมือนเดิม
แค่ "ย้ายบ้าน" ใน source file ไม่มี import/export

- `_groupNRR()` มาจาก 07a
- `renderPortview/List()` มาจาก 06 (07b wrap)
- `bulkPortviewData`, `bulkCurrentMovementData` มาจาก 02

---

## Starter Prompt

```
Repo: github.com/boonwirat-glitch/cost-iq, branch main
Token: [token]

อ่านก่อนเริ่ม:
1. docs/STEP3_HANDOFF.md (อยู่ใน repo แล้ว)
2. src/07b_commission_ui.js ผ่าน blob API
3. build.py

งาน: Step 3 — แตก 07b_commission_ui.js (5,420L) เป็น 4 ไฟล์
ตาม boundary ใน STEP3_HANDOFF.md (verify line numbers ก่อนเสมอ)

สถานะ: Step 2 เสร็จแล้ว — 08_patches.js ว่างเปล่า SW v281 HEAD cee2d1d55945

กฎ:
1. backup ก่อน (snapshot branch)
2. อ่านผ่าน blob API เท่านั้น — ไม่ใช่ raw.githubusercontent
3. node --check ทุกไฟล์ก่อน push
4. build test local ก่อน push index.html
5. push src + rebuild + bump SW
6. ทดสอบ commission UI ทุก tab หลัง deploy
```
