# Handoff 2026-07-08 — /nrr Portfolio Notebook Go-Live (nrr_v9)

## สรุปสำหรับ session ใหม่

หน้า `/nrr` (NRR ไตรมาส + Commission) feature-complete และพร้อม soft launch
บน branch `feature/nrr-quarterly-dashboard` — **ยังไม่ merge เข้า main**
(รอ gate: real-login verification โดย Boonwirat ก่อน ดูข้อ "ก่อน merge" ล่างสุด)

อ่านคู่กัน: `docs/NRR_ARCHITECTURE.md` (โครงสร้าง+วิธี dev) · `docs/NRR_RUNBOOK.md` (ops)

## สิ่งที่อยู่ในรีลีสนี้

**หน้า /nrr ทั้งหมด** (build ใหม่จาก `src/nrr/` ผ่าน `build_nrr.py`, output `nrr.html` + `dist/nrr_v9.html`):
- NRR ไตรมาส Q3: Pulse hero, Team Scoreboard, Movement, KAM Leaderboard, PM/Admin, slide-over drill-down
- **Commission section** (สร้างใน session 2026-07-08 ทั้งสาม phase):
  - V1: hero + trend 3 เดือน + แถวรายทีม/รายคน (อ่านจาก `commission_payout_snapshots` เท่านั้น ไม่ recompute) + pace ESTIMATE สำหรับเดือนที่ยังไม่ lock + footnote อัตราจาก live `target_settings`
  - V2: drill-down drawer ระดับร้านค้า (NRR/Expansion/Handover/Upsell P1-P3) — upsell ใช้ lazy-fetch `sense_upsell_{kam}.csv` + สูตร `_commComputeUpsellSku` ported ตรงตัว + reconciliation note เมื่อผลรวมสดไม่ตรง snapshot
  - V2.1: reskin เป็น Fresh Canvas ของหน้า (หลังพบว่า Commercial OS เป็นคนละ design system) + "ลายเซ็นเงิน": ตรา ESTIMATE/DRAFT/FINAL, ตารางเต็มแบบ statement (เลือกเดือนย้อนหลังได้ พ.ค./มิ.ย.), เงินเขียวเข้ม/ศูนย์จาง
- **ตารางเต็ม (audit view)**: TL 6 คอลัมน์ + KAM 10 คอลัมน์ (ยุบ GMV+Comm เป็นเซลล์ 2 บรรทัด) + GRAND TOTAL + Gate× chips + ⓘ note/multiplier — ตรวจเทียบข้อมูลจริง มิ.ย. ตรง Excel 100%

**Infra changes:**
- `sw.js` → v851: **whitelist intercept เฉพาะ `/` + `/index.html`** — แก้บั๊กที่ SW เสิร์ฟ
  Sense shell ทับทุก navigation (เดิม `/nrr`,`/dashboard` โดน hijack บนเครื่องที่เคยเปิด Sense)
  — regression-test แล้ว: SW active + controlling → เข้า /nrr ได้หน้า NRR จริง
- `_redirects`: เพิ่ม `/nrr` + `/nrr/*` → `nrr.html`
- `.gitignore` ใหม่ (`_preview_server.cjs`, `.DS_Store`)
- `tools/nrr_mock_harness.js`: mock harness ข้อมูล มิ.ย. จริง ใช้ทดสอบโดยไม่ต้อง login

## การตรวจสอบที่ทำแล้ว

- ตัวเลข Commission มิ.ย. เทียบ Supabase จริง (ผ่าน connector) + Excel อ้างอิง: ตรงทุกช่อง
  (รวม case Mild ฿6,556 note, Ploiiy upsell_mult "2x" ที่จริงคือ tier — มี ⓘ กำกับ)
- Design: ไม่มี #FF385C/IBM Plex Mono เหลือ, ฟอนต์ Space Grotesk/Anuphan computed ถูก,
  ตารางเต็มพอดี 1440px ไม่มี horizontal scroll, ส่วนอื่นของหน้า + slide-over เดิมไม่กระทบ
- SW: ทดสอบสองทาง (Sense เสิร์ฟจาก cache ปกติ / nrr หลุด intercept)

## ⚠️ ก่อน merge เข้า main (soft-launch gate — ยังไม่ทำ)

1. **Real-login verification** (ทุกการทดสอบที่ผ่านมาใช้ mock): เสิร์ฟ build local →
   login จริงเป็น TL และ admin → ไล่เช็ค Commission ตารางเต็ม พ.ค./มิ.ย. กับ Excel,
   ก.ค. ต้องขึ้น ESTIMATE, drill-down drawer เปิดได้, drawer upsell โหลด per-KAM CSV จริง
2. Merge แบบ surgical เข้า `main` (ตาม convention v847) → push → CF Pages ขึ้นเอง
3. Post-deploy: เครื่องที่ลง Sense PWA → เข้า `/nrr` hard-refresh + airplane-mode test,
   เช็ค `/` และ `/dashboard` ปกติ
4. Soft launch 1 สัปดาห์ (Boonwirat + admin) → ประกาศ 2 TL

## Rollback

`git revert <merge-commit>` → push (หน้าเป็น read-only ไม่มี data migration ให้ย้อน)
