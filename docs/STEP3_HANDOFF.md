# Step 3 Handoff — Split 07b_commission_ui.js
**ทำหลัง Step 2 เสร็จเท่านั้น** — เพราะ 08_patches ยังมี function ที่ควรอยู่ใน 07b อยู่

---

## ทำไมต้องทำ
`07b_commission_ui.js` = 5,277 บรรทัด, 225 functions, 311 KB
ทุกครั้งที่แก้ commission AI ต้องโหลด context ทั้งก้อน ทำให้ context ตก

---

## แผนแตกไฟล์ (ตาม SECTION: markers ที่มีอยู่แล้ว)

### ไฟล์ที่จะได้ — 4 ไฟล์

**`07b_commission_cockpit.js`** (lines 1–1374)
- `SECTION:COMMISSION_COCKPIT`
- functions: `ensureCommissionCockpitOverlay`, `openCommissionCockpit`, `closeCommissionCockpit`, `renderCommissionCockpit`, `saveCommissionCockpit` + helpers
- commission rule editor, component rates, TL/KAM plan assignment UI

**`07b_nrr_target.js`** (lines 1375–2701)
- `SECTION:NRR_COMPUTE` + `SECTION:NRR_WIDGET`
- NRR calculation engine, NCS (cohort drill sheet), target input/save, portview NRR bar
- functions: `onTgtInput`, `saveTargets`, `_tgtComputeKamNRR`, `_tgtShowCohortSheet`, `_ncs*`, `renderPortviewNRRBar`

**`07b_cds.js`** (lines 2702–5044)
- `// COMMISSION PATCHES — inlined`, `// Commission Detail Sheet (cds)`
- CDS Level 1 summary → Level 2 tabs (P1/P3/NRR/Expansion/Handover)
- functions: `_commBuildPayoutSummary`, `_commBuildKamSelfState`, CDS open/close/tab renderers, snapshot + admin guards

**`07b_commission_history.js`** (lines 5045–5277)
- `// v247e: Commission History Sheet`
- Commission rulebook + history sheet (v247d/e)

---

## Overrides ที่อยู่ใน 07b (ต้องระวัง)

ดูรายละเอียดใน `docs/OVERRIDE_MAP.md` — สรุป:

| Function | Override type | หมายเหตุ |
|---|---|---|
| `renderPortviewList` | WRAPPER | เรียก original จาก 06 ต่อ |
| `renderPortviewSummary` | WRAPPER | เรียก original จาก 06 ต่อ |
| `renderTeamview` | WRAPPER | เรียก original จาก 06 ต่อ |
| `renderTeamviewKamList` | REPLACE | ทับ 06 ทิ้ง |
| `_commBuildPayoutSummary` | REPLACE | ทับ 07a ทิ้ง |
| `_commBuildKamSelfState` | REPLACE | ทับ 07a ทิ้ง |
| `exportCommissionSnapshotCsv` | REPLACE | ทับ 07a ทิ้ง |
| `lockCommissionSnapshot` | REPLACE | ทับ 07a ทิ้ง |

---

## วิธีทำ (step by step)

### ขั้นตอน
1. **Backup ก่อนเสมอ** — `snapshot/pre-07b-split-vXXX`
2. **แตกตาม boundary** — ใช้ line ranges จากด้านบน (verify ก่อนด้วยตา เพราะ section อาจขยับหลัง Step 2)
3. **แก้ build.py** — เปลี่ยน `commission_js = read('07a') + read('07b')` เป็น 5 ไฟล์
4. **ทดสอบ build local** ก่อน push
5. **node --check** ทุกไฟล์ใหม่
6. **push src + rebuild index + bump SW**
7. **ทดสอบ commission UI ทุก tab** (cockpit, CDS P1/P3/NRR/Expansion/Handover)

### build.py ที่ต้องแก้
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

## ⚠️ Dependency ที่ต้องระวัง

07b ทั้งก้อนเรียก function จาก module อื่นเยอะ:
- `_groupNRR()` มาจาก 07a
- `renderPortview()` / `renderPortviewList()` มาจาก 06 (แต่ถูก 07b wrap)
- `bulkPortviewData`, `bulkCurrentMovementData` มาจาก 02

**ข้อดี:** เพราะ build.py รวมทุกไฟล์เป็น single script ใน index.html การแตกไฟล์จึงไม่กระทบ runtime dependency — function ยังอยู่ใน global scope เหมือนเดิม แค่ "ย้ายบ้าน" เท่านั้น

---

## Starter Prompt สำหรับ Session นี้

```
Repo: github.com/boonwirat-glitch/cost-iq, branch main
Token: [token]

อ่านก่อนเริ่ม:
1. docs/OVERRIDE_MAP.md
2. src/07b_commission_ui.js (ผ่าน blob API)
3. build.py

งาน: Step 3 — แตก 07b_commission_ui.js (5,277L) เป็น 4 ไฟล์
ตาม STEP3_HANDOFF.md ที่อยู่ใน docs/ หรือ outputs

ยืนยันว่า Step 2 (08_patches.js dissolved) เสร็จสมบูรณ์แล้วก่อน — ถ้ายังมี
function ใน 08 ที่ควรอยู่ใน 07b ต้องทำ Step 2 ให้จบก่อน

กฎ:
1. backup ก่อน (snapshot branch)
2. อ่านผ่าน blob API เท่านั้น
3. node --check ทุกไฟล์ก่อน push
4. build test local ก่อน push
5. push src + rebuild + bump SW
6. ทดสอบ commission UI ทุก tab หลัง deploy
```
