# /nrr Portfolio Notebook — Operations Runbook
`docs/NRR_RUNBOOK.md` · created 2026-07-08 (go-live)

ใครควรอ่าน: คนที่ดูแลข้อมูล (SQL/R2/Cockpit) และคนที่ deploy โค้ด
คู่กันกับ: `docs/NRR_ARCHITECTURE.md` (โครงสร้างโค้ด + วิธี build ฟีเจอร์เพิ่ม)

---

## ⚠️ 0. `_redirects` ต้องว่างเปล่า — ห้ามเพิ่ม rule กลับเข้าไป

**พบ 2026-07-08:** `/dashboard` และ `/nrr` เคยเข้าไม่ได้เลยบน production (`freshket-sense.pages.dev`)
— ทุก request ขึ้น `HTTP 308` redirect กลับไปที่ path เดิมของตัวเอง (วนลูป) ทั้งที่ deploy
สำเร็จปกติทุกอย่าง สืบจนหมดแล้ว (Zero Trust — ไม่เคยตั้งค่า, Zone Redirect Rules — ไม่มี
custom domain เลยใช้ไม่ได้ตั้งแต่ต้น, Bulk Redirects — 0 lists, Pages Functions/`_worker.js` —
ไม่มีในโค้ด) สาเหตุจริงคือ **rule ที่เขียนเองใน `_redirects`**
(`/dashboard → /dashboard.html status 200` และ `/nrr → /nrr.html status 200`)
**ชนกับกลไก "clean URL" อัตโนมัติของ Cloudflare Pages เอง** (ที่เสิร์ฟ `name.html` ให้ `/name`
โดยอัตโนมัติอยู่แล้วโดยไม่ต้องมี rule เลย) จนเกิด loop

**แก้แล้วโดยลบเนื้อหา `_redirects` ทิ้งทั้งหมด** (ปล่อยให้ Cloudflare จัดการ clean-URL เอง) —
ยืนยันแล้วว่า `/dashboard` และ `/nrr` ใช้ content ถูกต้อง (ไม่ fallback ไปหน้า Sense ผิดๆ)

**ถ้าจะเพิ่มหน้าใหม่ในอนาคต (`/xyz`) ไม่ต้องเขียน `_redirects` rule เลย** — แค่ตั้งชื่อไฟล์
`xyz.html` ที่ repo root แล้ว Cloudflare จะเสิร์ฟให้ตอนเข้า `/xyz` เองอัตโนมัติ — **ห้ามเขียน
`_redirects` rule แบบ `/xyz → /xyz.html status 200` อีก จะกลับไป loop เหมือนเดิม**

---

## 1. Daily — ไม่มีงานใหม่

CSV ทุกไฟล์รีเฟรชผ่านกระบวนการอัปโหลด R2 เดิมที่ Sense ใช้อยู่ (external/manual,
day-1 lag) — `/nrr` fetch สดทุกครั้งที่เปิดหน้า (`?cb=` cache-bust, ไม่มี IndexedDB)
จึงเห็นข้อมูลใหม่ทันทีที่ไฟล์บน R2 เปลี่ยน ไม่ต้อง deploy อะไร

## 2. Monthly — Commission Compute → Lock (งานเดิมใน Sense Cockpit)

1. Admin เปิด Sense → Commission Cockpit → Step 5 "Preview & Lock"
2. กด **↻ Compute** (สร้าง draft) → ตรวจตัวเลข → กด **Lock Final**
3. `/nrr` สะท้อนผลอัตโนมัติทันที (ตรา DRAFT → FINAL, hero/ตารางเต็มอัปเดต) — **ไม่ต้อง deploy**

ข้อเสนอ convention: lock ภายใน 5 วันทำการแรกของเดือนถัดไป เพื่อให้ TL เห็น FINAL เร็ว

⚠️ ก่อน Compute เดือนใหม่ทุกครั้ง: เช็คว่า `sense_upsell_team.csv` บน R2 ถูกสร้างด้วย
threshold ที่ตรงกับ Cockpit ปัจจุบัน (ดูข้อ 4 — Gap A)

## 3. Quarterly rollover (Q3→Q4: ทำต้นเดือน ต.ค.) — checklist

| # | งาน | ที่ไหน |
|---|-----|--------|
| 1 | รัน SQL ชุด movement + upsell (ทุกไฟล์ **auto-derive วันที่เอง** — ไม่ต้องแก้ SQL) | BigQuery, `sql/q3_2026_movement_*.sql`, `sql/q3c_upsell_*.sql` |
| 2 | ⚠️ pre-run check Gap A: เทียบ 3 ค่า hardcode ใน `sql/q3c_upsell_team_summary_v4.sql` (`v_p3_min_incremental=8000` มี 🔴 comment, `*2.00` ~line 276 และ `>=5000` ~line 300/304 **ไม่มี comment เตือน**) กับค่าจริงใน Cockpit ก่อนรัน | ไฟล์ SQL + Sense Cockpit Step 3 |
| 3 | อัปโหลด CSV ไตรมาสใหม่ขึ้น R2: `sense_qnrr_2026q4.csv`, `pm_view.csv`, `admin_view.csv`, `vp_view.csv` (+ per-KAM upsell + team summary ตามรอบปกติ) | R2 bucket เดิม |
| 4 | แก้ค่าคงที่ไตรมาสใน JS **3 จุด**: `src/nrr/nrr_logic.js:20-29` (`QNRR_CFG`: quarter/base_month/q_months/months_th/csv_file), บล็อกแฝดใน `src/07c_qnrr_view.js:5-12`, `_QNRR_QUARTER` ใน `src/02_data_pipeline.js:1800` | repo |
| 5 | `python3 build_nrr.py vN+1` + build Sense (เพราะแตะ 07c/02) → commit → merge main → push | repo → Cloudflare Pages |
| 6 | Sanity: เปิด `/nrr` เห็นไตรมาสใหม่, chips เดือน ต.ค./พ.ย./ธ.ค., Commission dropdown ยังเลือกเดือนเก่าได้ | prod |

**Fast-follow ที่วางแผนไว้ (ยังไม่ทำ):** ให้ JS auto-derive ไตรมาสจากวันที่ (แบบเดียวกับ
SQL v827-auto) + fallback 404 ไปไตรมาสก่อน + banner "รอข้อมูลไตรมาสใหม่" → ตัดข้อ 4 ทิ้งถาวร

## 4. ความเสี่ยงข้อมูลที่รู้อยู่แล้ว (documented risks)

- **Gap A — SQL/Cockpit threshold drift**: `q3c_upsell_team_summary_v4.sql` bake ค่า
  threshold 3 ตัวไว้ในไฟล์ ต้อง sync มือกับ Cockpit ทุกครั้งที่มีการแก้อัตรา (เคยหลุดแล้ว
  ครั้งหนึ่ง 5000→8000, แก้เมื่อ 2026-07-05) — เจ้าของ SQL ควรย้ายเข้า pre-run check ข้อ 3.2
- **ข้อมูล backfill พ.ค./มิ.ย.**: มาจาก Excel (`source: excel_june2026`) ช่อง
  `breakdown.upsell_mult` เก็บ **เลข tier** ("1x"/"2x") ไม่ใช่ตัวคูณจริง (ตัวคูณจริงของ
  Ploiiy มิ.ย. = 1.5×) — `/nrr` แสดง ⓘ กำกับอยู่แล้ว แต่ควรแก้ที่ต้นทางเมื่อสะดวก
- **เดือนที่ยังไม่ Compute**: `/nrr` แสดง ESTIMATE (pace-based) ชัดเจน — เป็น by design
  ไม่ใช่บั๊ก; ตัวเลขจริงโผล่เมื่อ admin กด Compute/Lock เท่านั้น
- **⚠️ Sense ยังนับฐาน transfer_in ซ้ำ (แก้ฝั่ง /nrr แล้ว nrr_v10, 2026-07-08)**:
  ร้านที่ transfer_in ใน**เดือนแรกของไตรมาส**ถูกนับฐานซ้ำ 2 ครั้งใน `_qnrrCompute`
  (เข้า baseMap + symmetric adjustment) — /nrr แก้แล้ว แต่ `src/07c_qnrr_view.js`
  (Sense) ยังมีบั๊กอยู่ → Sense จะโชว์ NRR ต่ำกว่าจริงสำหรับ scope ที่มี month-1
  transfer_in (เช่น Tape ก.ค. 2026: Sense 92% vs /nrr 99% — **/nrr คือเลขที่ถูก**)
  จนกว่าจะแก้ 07c + rebuild Sense แล้วลบ divergence note ใน `nrr_logic.js` header
  — รายละเอียด+ตารางเทียบทุกระดับ: `docs/handoff-2026-07-08-nrr-transfer-in-fix.md`

## 5. Deploy / Rollback

**Deploy**: แก้โค้ดใน `src/nrr/` → `node --check` ทุกไฟล์ที่แตะ → `python3 build_nrr.py vN+1`
(เช็คไม่มี unresolved placeholder) → ทดสอบด้วย `tools/nrr_mock_harness.js` → commit
`src/ + dist/nrr_vN.html + nrr.html` → merge เข้า `main` → push → Cloudflare Pages ขึ้นเอง
→ เขียน `docs/handoff-YYYY-MM-DD-...md` + ลิงก์ใน `docs/INDEX.md`

**Rollback**: `git revert <merge-commit>` → push — CF Pages กลับ state เดิมอัตโนมัติ
(ข้อมูลไม่กระทบ เพราะ `/nrr` เป็น read-only ทั้งหน้า ไม่เขียนอะไรลง Supabase/R2 เลย
ยกเว้น notes ซึ่ง feature-flag ปิดอยู่)

**Service worker**: `sw.js` intercept เฉพาะ `/` + `/index.html` (Sense shell) ตั้งแต่ v851 —
`/nrr` และ `/dashboard` โหลดจาก network เสมอ ปล่อย release แยกจังหวะกับ Sense ได้อิสระ
