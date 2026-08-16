# Freshket Commercial OS — Docs Index
`docs/INDEX.md` · อัปเดต 2026-08-16

> **สำหรับ AI session ใหม่:** อ่านไฟล์นี้ก่อนทุกครั้ง แล้วเปิดเฉพาะไฟล์ที่เกี่ยวข้องกับงาน

**2026-08-16 cleanup:** ลบ session handoff/spec เก่าที่ SUPERSEDED/DEPRECATED ออกไป 99 ไฟล์
(ครอบทั้งหมดที่เคยอยู่ในหัวข้อ "Superseded"/"~~ทั้งหมด SUPERSEDED~~" ของ index รุ่นก่อน) +
`sql/NOT_USE_*` อีก 17 ไฟล์ — ยืนยันแล้วว่าไม่มีไฟล์ไหนเป็นฐานความเข้าใจปัจจุบันของ
UX/UI หรือ commission logic เลย (โค้ดจริงคือ source of truth เสมอ, ดูรายละเอียดใน
`git log` commit `8075d45` ถ้าต้องสืบประวัติ) index ด้านล่างนี้เหลือแต่ไฟล์ที่ยังมีอยู่จริง

---

## 🔴 START HERE — Current State

**Sense main app (index.html):** build v262 (2026-08-16) — Key SKU feature
(reps mark must-never-run-out SKUs per outlet, Products nav popover, flat
portfolio Home feed, Google Sheets export 4x/day to supply planning) ล่าสุด
บน production. ก่อนหน้านั้น Commission Scheme Engine (per-role commission
schemes สำหรับ kam/tl/pm/admin/sales/sales_tl/ad/ad_tl) + Commission Cockpit
"Setup" tab redesign + `pm` login role — ไม่มี handoff `.md` เฉพาะสำหรับงานพวกนี้
เช็ค `git log` ถ้าต้องสืบรายละเอียด

| ไฟล์ | เนื้อหา |
|------|---------|
| `docs/NRR_ARCHITECTURE.md` | /nrr โครงสร้างโค้ด + hard rules + วิธี build ฟีเจอร์เพิ่ม |
| `docs/NRR_RUNBOOK.md` | /nrr ops: daily/monthly/quarterly rollover + deploy/rollback |
| `docs/qnrr_master_movement_design_v8.md` | Movement-classification logic ที่ SQL ปัจจุบันอิงตาม |
| `docs/echo-state-spec.md` | Echo state — single source of truth, แก้ Echo ต้องแก้ spec นี้ก่อน |
| `docs/FEATURE_GUIDE.md` | How to add new features — step-by-step guide |
| `docs/supabase-migration-key-skus-2026-08-16.sql` + `-outlet-uidx-2026-08-16.sql` | Key SKU feature schema |

---

## 🎨 Design System

| ไฟล์ | เนื้อหา |
|------|---------|
| `design/DESIGN_SYSTEM.md` | **Rules for AI** — read before writing any CSS/HTML |
| `design/tokens.css` | Single source of truth — 284 tokens, light + dark |
| `design/components.html` | Living reference — all components rendered |
| `design/RESPONSIVE.md` | Breakpoint rules per component |
| `design/CHANGELOG.md` | Design system version history |

---

## 📊 QNRR Movement Views (SQL) — active

| ไฟล์ | สถานะ |
|---|---|
| `sql/q3_2026_movement_rep_view.sql` | ✅ **ACTIVE** — Sense main app (rep-facing) อ่านไฟล์นี้ ผลิต `kam_rep_view.csv` |
| `sql/q3_2026_movement_pm_view.sql` | ✅ **ACTIVE** — ผลิต `pm_view.csv` |
| `sql/q3_2026_movement_admin_view.sql` | ✅ **ACTIVE** — ผลิต `admin_view.csv` |
| `sql/q3_2026_movement_vp_view.sql` | ✅ **ACTIVE** — ผลิต `vp_view.csv` (unified all-portfolio pool) |

## 🗄 SQL & Database

| ไฟล์ | เนื้อหา |
|------|---------|
| `docs/skills_p0_supabase.sql` | Skills tables — full schema + RLS (✅ ไฟล์ที่ใช้ seed จริง) |
| `docs/echo_skills_p0.sql` | Echo×Skills bridge table |
| `docs/ci_sessions_s2_migration.sql` | ci_sessions schema migration |
| `docs/supabase-migration-q3-commission-mode.sql` | เพิ่ม `commission_mode`/`quarter_id` ให้ `nrr_policies` |
| `docs/supabase-migration-nrr-exclusions-v2.sql` + `-v3.sql` | `nrr_exclusions` schema/RLS |
| `docs/supabase-migration-add-pm-role-2026-07-17.sql` | เพิ่ม `role='pm'` — รันแล้ว ✅ |
| `docs/supabase-migration-echo-queue-2026-08-12.sql` | Echo queue schema |
| `docs/supabase-migration-ears-ab-2026-08-14.sql` + `-glossary-2026-08-14.sql` | Echo transcription A/B + glossary |
| `docs/supabase-migration-listen-state-2026-08-16.sql` | Echo listen-state |
| `docs/supabase-migration-key-skus-2026-08-16.sql` + `-outlet-uidx-2026-08-16.sql` | Key SKU feature |

### PM/AD roster rollout + 2026-07-19 commission-logic fixes (active, ยังไม่ปิดงาน)
| ไฟล์ | สถานะ |
|---|---|
| `handoff_sql_2026-07-19/README.md` | **ACTIVE / IN PROGRESS** — runbook ที่ต้องให้ data team รัน — ยังไม่ยืนยันว่ารันครบหรือยัง |
| `sql/pm_rep_view.sql` | **ACTIVE, pending deploy** — query สำหรับ `/nrr`, `src/nrr/nrr_data.js` fetch ไว้รอแล้ว |

### Quarterly reconcile (active)
| ไฟล์ | สถานะ |
|---|---|
| `sql/Quarterly_KAM_portfolio_reconcile.sql` | **ACTIVE** — เดือนฐาน = เดือนก่อนหน้าไตรมาสเสมอ, auto-derive จาก `CURRENT_DATE`, มี PM/AD roster + whole-outlet-handoff model |
| `sql/Quarterly_upsell_reconcile.sql` | **ACTIVE** — เช่นเดียวกัน |

### Kept active for future work (ไม่มี CSV consumer วันนี้ แต่ตัดสินใจเก็บไว้แล้ว)
| ไฟล์ | หมายเหตุ |
|---|---|
| `sql/May2026_KAM_portfolio_reconcile.sql` | Backfill พฤษภาคม 2026 เดิม (ปิดงานแล้ว) — เก็บไว้เป็นประวัติ |
| `sql/upsell_May2026_v1.sql` | เช่นเดียวกัน |

---

## 📐 Ground Truth GMV (locked)
Oct25=188.2M · Nov25=204.4M · Dec25=235.7M · Jan26=214.9M · Feb26=195.1M · Mar26=204.2M · Apr26=192.6M
