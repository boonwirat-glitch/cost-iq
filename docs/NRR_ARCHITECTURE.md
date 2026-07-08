# /nrr Portfolio Notebook — Architecture & Dev Guide
`docs/NRR_ARCHITECTURE.md` · created 2026-07-08 (go-live)

หลักการใหญ่: **"หน้าต่างคนละบาน บ้านเดียวกัน"** — /nrr เป็นแอปพี่น้องของ Sense ที่แชร์
ทุกอย่างใต้ผิว UI: repo เดียว, โดเมนเดียว (path `/nrr`), Supabase auth+tables เดียว,
R2 bucket เดียว, deploy pipeline เดียว, docs convention เดียว — ต่างกันแค่เปลือก
(page shell + design tokens) การรวมร่างกับ Sense ในอนาคตจึงเป็นงาน UI ล้วน
ไม่มีงาน data/auth/infra migration เลย

## 1. Module map (inject order = dependency order, ดู build_nrr.py)

| Module | หน้าที่ | กติกาเฉพาะ |
|---|---|---|
| `nrr_tokens.css` | design tokens "Fresh Canvas" ของหน้านี้ | **แหล่งสี/ฟอนต์เดียวที่อนุญาต** — ห้ามใช้ `design/tokens.css` (นั่นของ Sense//dashboard คนละระบบ ชนตัวแปรกัน) |
| `nrr_base.css` / `nrr_components.css` | typography scale + component styles | Commission ใช้ scope `.nrr-comm-ds` + ตราสถานะ `.nrr-comm-stamp` |
| `nrr_logic.js` | `_qnrrCompute` — **ported verbatim จาก `src/07c_qnrr_view.js`** | ห้ามแก้เองเด็ดขาด — ถ้าตัวเลขไม่ตรง Sense ให้ diff กับ 07c ก่อนเสมอ; ค่าคงที่ไตรมาสทั้งหมดอยู่ที่ `QNRR_CFG` ที่เดียว |
| `nrr_data.js` | R2 CSV fetch/parse (`parseCSVRow` shared idiom), upsell bundle lazy-fetch | fetch สดเสมอ (`?cb=`), 404-graceful ทุกไฟล์ |
| `nrr_core.js` | Supabase auth + role gate (`tl`/`admin` เท่านั้น), format helpers | |
| `nrr_aggregate.js` | rollups org/team/KAM/outlet บน `_qnrrCompute` | ห้าม re-filter row เอง — เรียก compute ที่ scope ที่ถูก |
| `nrr_commission.js` | อ่าน `commission_payout_snapshots` + rates + P1/P3 classification (ported) | **read-only เสมอ** — ตัวเลขเงินมาจาก snapshot หรือ pace-estimate (มีป้าย ESTIMATE) เท่านั้น ห้าม recompute payout |
| `nrr_notes.js` | outlet notes | feature-flag `NRR_NOTES_ENABLED=false` — precedent ของการปล่อยฟีเจอร์เสี่ยงแบบปิดไว้ก่อน |
| `nrr_components.js` | render helpers (triples, charts, tags) | |
| `nrr_view.js` | page controller — presentation + interaction state เท่านั้น | ตัวเลขทุกตัวต้องมาจาก pure functions ใน logic/aggregate/commission |

## 2. วิธี build ฟีเจอร์เพิ่ม (the upgrade loop)

1. แก้เฉพาะไฟล์ใน `src/nrr/` (ห้ามแก้ `nrr.html` ตรงๆ — เป็น build output)
2. `node --check src/nrr/<ไฟล์ที่แตะ>.js`
3. `python3 build_nrr.py vN+1` (เลข N monotonic ห้าม reuse — ดู header ของ build script)
4. เสิร์ฟ local + ทดสอบด้วย `tools/nrr_mock_harness.js` (ข้อมูล มิ.ย. จริงฝังอยู่แล้ว)
5. ทดสอบ login จริง (TL + admin) ก่อน merge ถ้าแตะเรื่องเงิน
6. commit `src/ + dist/ + nrr.html` + เขียน handoff doc → merge `main` → push
7. ฟีเจอร์เสี่ยง → ปล่อยแบบ feature flag ปิดไว้ก่อน (ตาม precedent `NRR_NOTES_ENABLED`)

## 3. Hard rules (สรุปจากบทเรียนจริง)

1. **สองระบบ design system ห้ามปน**: /nrr = `nrr_tokens.css` (เขียว Cabbage/Raw Papaya,
   Anuphan + Space Grotesk) · Sense//dashboard = `design/tokens.css` (แดง Rausch, IBM Plex
   Mono) — ทั้งคู่ประกาศ `--r-sm/md/lg`, `--bg` ค่าคนละตัว โหลดปนกันที่ `:root` = พังทั้งหน้า
2. **ค่าคงที่ไตรมาสอยู่ที่ `QNRR_CFG` ที่เดียว** (nrr_logic.js) — โมดูลอื่นอ่านผ่าน config เสมอ
3. **เงิน = snapshot เท่านั้น**: `payout_amount`/`breakdown` จาก `commission_payout_snapshots`
   หรือ pace-estimate ที่ติดตรา ESTIMATE — /nrr ไม่มีสิทธิ์คำนวณเงินจริงเอง (เหตุผลอยู่ใน
   header ของ `nrr_commission.js`)
4. **สถานะเงินต้องมีตราเสมอ**: ESTIMATE (ขอบเหลือง) / DRAFT (พื้นเหลือง) / FINAL (พื้นเขียว)
   — ผ่าน `nrrCommStampHtml()` เท่านั้น อย่าเขียน status เป็น text เปล่า
5. **`sw.js` intercept เฉพาะ Sense shell** (`/`, `/index.html`) — อย่าเพิ่ม path อื่นเข้า
   whitelist โดยไม่คิดเรื่อง release cadence

## 4. อนาคตที่ออกแบบเผื่อไว้แล้ว (อย่าทำลายคุณสมบัติเหล่านี้)

- **รวมกับ Sense**: เพราะ infra แชร์หมดแล้ว การรวม = งาน UI อย่างเดียว มี 2 ทาง —
  (ก) cross-link nav ระหว่างแอป (ทำได้วันนี้ ต้นทุนแทบศูนย์) (ข) full merge = migrate
  /nrr ไปใช้ `design/tokens.css` แล้ว mount เป็น view ใน Sense — V2.1 ทำให้ตัวเลือกนี้ถูก:
  styling เป็น CSS variables + class ล้วน (ไม่มี inline hardcode) แค่ swap token layer
- **Dark theme**: ทุกสีของ /nrr ไหลผ่านตัวแปรใน `nrr_tokens.css` อยู่แล้ว — เพิ่ม semantic
  layer + `[data-theme="dark"]` override (กลไกเดียวกับ Commercial OS) ได้โดยไม่ redesign
- **Mobile**: เครื่องมือ desk-based สำหรับ TL/Admin — ทำ responsive audit ที่ 375px พอ
  (แท็บ "สรุป" คือ surface หลักบนมือถือ, ตารางเต็มมี horizontal-scroll wrapper อยู่แล้ว)
  ไม่ทำ mobile-first rework
- **Automated CSV pipeline** (BigQuery→R2 scheduled): โปรเจกต์ infra แยกในอนาคต
  (Cloudflare Worker cron / GitHub Actions) — ระหว่างนี้ manual ตาม runbook
