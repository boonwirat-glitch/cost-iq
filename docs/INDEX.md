# Freshket Commercial OS — Docs Index
`docs/INDEX.md` · อัปเดต 2026-07-19

> **สำหรับ AI session ใหม่:** อ่านไฟล์นี้ก่อนทุกครั้ง แล้วเปิดเฉพาะไฟล์ที่เกี่ยวข้องกับงาน

---

## 🔴 START HERE — Current State

**Sense main app (index.html):** commit `d2ca917` (2026-07-19, build v897) —
Commission Scheme Engine (per-role commission schemes for
kam/tl/pm/admin/sales/sales_tl/ad/ad_tl) + Commission Cockpit "Setup" tab
redesign (role-first UI, replaces the old entity-first flow) + new `pm`
login role, all live in production. No dedicated handoff `.md` was written
for this work — check `git log -- src/07a_commission_engine.js
src/07b_commission_cockpit.js` for detail if needed.

| ไฟล์ | เนื้อหา |
|------|---------|
| `docs/handoff-2026-07-09-nrr-v22-account-view-and-commission-audit.md` | **Latest /nrr — nrr_v22 (Phase C)** — Account view ใหม่ + แก้บั๊ก gate/handover calc + ปิด 2 คำถาม "นี่บั๊กมั้ย" (สรุปว่าไม่ใช่ ถูกต้องแล้ว) + file map สำหรับ session ถัดไป |
| `docs/NRR_ARCHITECTURE.md` | /nrr โครงสร้างโค้ด + hard rules + วิธี build ฟีเจอร์เพิ่ม |
| `docs/NRR_RUNBOOK.md` | /nrr ops: daily/monthly/quarterly rollover + deploy/rollback — อัปเดตต่อเนื่อง (ล่าสุด 2026-07-19) |
| `docs/qnrr_master_movement_design_v8.md` | Movement-classification logic ที่ SQL ปัจจุบันอิงตาม (KAM/PM/ADMIN/VP/TL/REP ครบ, เพิ่ม TL/Rep view + แก้ 2 บั๊กจาก v7) |

### Superseded /nrr session handoffs (log ประวัติ ไม่ใช่สถานะปัจจุบัน — เปิดเฉพาะถ้าสืบบั๊ก/ดีไซน์เก่า)
สาย: v9(golive) → v10(transfer-in-fix, **ยังใช้งานจริง ดูแถวถัดไป**) → v12(phase-a) → v13 → v14 → v15 → v16 → v17(phase-b) → **v22(ปัจจุบัน)**. อ่าน v22 พอ ไม่ต้องไล่ทั้งสาย

| ไฟล์ | สถานะ |
|---|---|
| `docs/handoff-2026-07-08-nrr-transfer-in-fix.md` | **ยังใช้งานอยู่** — `NRR_RUNBOOK.md` §4 อ้างอิงไฟล์นี้เป็นตารางเทียบก่อน/หลังของบั๊กที่ fix ยัง live อยู่ในโค้ดปัจจุบัน |
| `docs/handoff-2026-07-08-nrr-golive.md` | ~~SUPERSEDED~~ by v22 |
| `docs/handoff-2026-07-09-nrr-phase-a.md` | ~~SUPERSEDED~~ by v22 |
| `docs/handoff-2026-07-09-nrr-v13-fixes.md` | ~~SUPERSEDED~~ by v22 |
| `docs/handoff-2026-07-09-nrr-v14-fixes.md` | ~~SUPERSEDED~~ by v22 |
| `docs/handoff-2026-07-09-nrr-v15-commission-redesign.md` | ~~SUPERSEDED~~ by v22 |
| `docs/handoff-2026-07-09-nrr-v16-polish.md` | ~~SUPERSEDED~~ by v22 |
| `docs/handoff-2026-07-09-nrr-v17-phase-b-portfolio.md` | ~~SUPERSEDED~~ by v22 |

### Q3 2026 Quarterly Commission (~~SUPERSEDED~~ — เก็บไว้อ่านประกอบประวัติเท่านั้น)
| ไฟล์ | หมายเหตุ |
|---|---|
| `docs/handoff-2026-07-06-v847-q3-merge-complete.md` | Merge สำเร็จตอนนั้นจริง แต่ commission engine ถูก redesign ต่ออีกหลายรอบหลังจากนี้ (v13-v16 ด้านบน + Commission Scheme Engine 2026-07-19) |
| `docs/Q3_NRR_COMMISSION_HANDOFF.md` | Session 1-3 บน preview branch — ประวัติ ไม่ใช่สถานะปัจจุบัน (ไฟล์เองระบุ `⚠️ SUPERSEDED`) |
| `docs/Q3_NRR_TEST_SPEC.md` | Test spec ตอน merge (ไฟล์เองระบุ `⚠️ SUPERSEDED`) |
| `docs/MAIN_VS_PREVIEW_MERGE_ANALYSIS.md` | Gap analysis ที่ใช้วางแผน merge — งานเสร็จแล้ว (ไฟล์เองระบุ `⚠️ SUPERSEDED`) |
| `docs/Q3_NRR_COMMISSION_SPEC.md` | Product spec ต้นฉบับ — ค่า config 3/4 ตัวที่อ้างในนี้พิสูจน์แล้วว่าผิดตั้งแต่เขียน (ดู `Q3_NRR_COMMISSION_HANDOFF.md` §6.4) |
| `docs/handoff-2026-06-30-q3-commission-spec.md` | Pre-build spec ("SPEC ONLY") — ถูกแทนที่ด้วยงานที่ build จริงแล้ว |

---

## 📱 Sense Mobile (index.html)

### Architecture & Specs
| ไฟล์ | เนื้อหา | สถานะ |
|------|---------|--------|
| `docs/FEATURE_GUIDE.md` | How to add new features — step-by-step guide | ปัจจุบัน (`RenderBus`/`DataRegistry` ยัง match โค้ดจริง) |
| `docs/echo-state-spec.md` | Echo state — single source of truth | ปัจจุบัน — แก้ Echo ต้องแก้ spec นี้ก่อน |
| `docs/phase0-scale-spec.md` | ~~DEPRECATED~~ | CSS-scoping plan เก่า — ส่วน 0D ทำเสร็จไปแล้วจริง (ผ่านกลไก `--chrome-bottom` อื่น), ส่วน 0F ถูกแทนที่ด้วย `design/tokens.css` ไปแล้ว ไม่มีอะไรตรงกับแผนเดิมเหลือให้ทำต่อ |
| `docs/CI_ENTRY_HANDOFF.md` | ~~DEPRECATED~~ | Pre-build spec สำหรับปุ่มบันทึกเสียง (ตัวเลือก A/B/C ที่ตอนนั้นยังไม่ตัดสินใจ) — ถูกแทนที่ด้วย Echo ที่ build จริงแล้ว ดู `echo-state-spec.md` แทน |
| `docs/CI_HANDOFF.md` | ~~DEPRECATED~~ | Pre-build spec — สถาปัตยกรรม Whisper+Haiku+Sonnet ที่เขียนไว้ถูกแทนที่ด้วย pipeline จริงไปแล้ว 2 รอบ (ดู handoff v713/v717/v727 ด้านล่าง) |

### Session Handoffs (Sense) — ~~ทั้งหมด SUPERSEDED~~
Log ประวัติแบบ session-ต่อ-session แต่ละไฟล์ถูกแทนที่ด้วยไฟล์เวอร์ชันถัดไปในสายเดียวกันหมดแล้ว — **ไม่ต้องเปิดเพื่อเข้าใจสถานะปัจจุบัน**, เปิดเฉพาะถ้าต้องการสืบประวัติบั๊ก/การตัดสินใจดีไซน์เก่า

| ไฟล์ | Version | วันที่ |
|------|---------|-------|
| `docs/handoff-2026-06-14-v708.md` | v708 | 2026-06-14 (TL Dashboard Phase 7+8 — product ถูกลบแล้ว ดูหัวข้อ TL Dashboard) |
| `docs/handoff-2026-06-14-v701.md` | v701 | 2026-06-14 |
| `docs/handoff-2026-06-14-v697.md` | v697 | 2026-06-14 |
| `docs/handoff-2026-06-14-v683.md` | v683 | 2026-06-14 |
| `docs/handoff-2026-06-14-v674.md` | v674 | 2026-06-14 |
| `docs/handoff-2026-06-14-v672.md` | v672 | 2026-06-14 |
| `docs/handoff-2026-06-14-v666.md` | v666 | 2026-06-13 |
| `docs/session-handoff-v644.md` | v644 | 2026-06-13 |
| `docs/session-handoff-v643.md` | v643 | 2026-06-13 |
| `docs/handoff/HANDOFF_v606_20260613.md` | v606 | 2026-06-13 (CSS-scoping root cause + Echo 3-tab restructure — **ไม่ใช่ Dashboard**, เดิม index นี้ label ผิด) |
| `docs/handoff/HANDOFF_v590_20260613.md` | v590 | 2026-06-13 |
| `docs/handoff/HANDOFF_v589_20260612.md` | v589 | 2026-06-12 |
| `docs/handoff/HANDOFF_v570_20260612.md` | v570 | 2026-06-12 |
| `docs/handoff/session-6-handoff.md` | v552 | earlier |
| `docs/handoff/session-5-handoff.md` | v540 | earlier |
| `docs/handoff/session-4-handoff.md` | v531 | earlier |
| `docs/handoff/session-3-handoff.md` | v522 | earlier |
| `docs/handoff/session-2-handoff.md` | v517 | earlier |
| `docs/handoff/session-1-handoff.md` | v517 | earlier |

Additionally superseded (dated 2026-06-15 ถึง 2026-07-09, ไม่อยู่ใน table ด้านบนเพราะเพิ่งถูกจัดรอบนี้ — ทั้งหมด ~~SUPERSEDED~~ โดยไฟล์ session ถัดไปในสายเดียวกัน): `docs/handoff-2026-06-15-v713.md`, `v716.md`, `v717.md`, `v727.md`, `v728.md`, `v736.md`, `v737.md`, `v746.md`, `v751.md`, `v752.md`, `docs/handoff-2026-06-16-v753.md`, `v753p.md`, `v754.md`, `v754f.md`, `docs/handoff-2026-06-17-v755g.md`, `v755h.md`, `v755l.md`, `v756.md`, `v760.md`, `v761.md`, `v767.md`, `v774.md`, `v775.md`, `docs/handoff-2026-06-18-v776.md`, `v784.md`, `v790.md`, `v791.md`, `v792.md`, `v793.md`, `v797.md`, `v800.md`, `v802.md`, `docs/handoff-2026-06-19-v812.md`, `docs/handoff-2026-06-20-master-movements-v2.md`, `qnrr-sql.md`, `v820.md`, `docs/handoff-2026-06-24-all-views-complete.md`, `docs/handoff-2026-06-25-nrr-v8.md`, `docs/handoff-2026-06-26-rep-view-complete.md`, `docs/handoff-2026-06-21-v3.md`, `docs/handoff-2026-06-22-vp-movement.md`, `v2.md`, `docs/handoff-2026-06-23-portfolio-views.md`, `docs/qnrr_master_movement_test_spec.md`, `sql/HANDOVER_MOVEMENT_SESSION.md` (ไฟล์เก่าสุดใน repo — ทั้ง workflow ที่อธิบายและ edge case ที่ยกตัวอย่างล้าสมัยหมดแล้ว).

### Feature-specific (Sense) — ~~ทั้งหมด SUPERSEDED~~
Build log ของ Sales/Skills/Echo แต่ละเวอร์ชันถูกแทนที่ด้วยรอบถัดไปในสายเดียวกันหมดแล้ว

| ไฟล์ | เนื้อหา |
|------|---------|
| `docs/HANDOFF_v404_SKILLS_SALES.md` | Skills + Sales module handoff (v404) |
| `docs/HANDOFF_SALES_v391.md` | Sales view handoff (v391) |
| `docs/SALES_UI_HANDOFF_v358.md` | Sales UI detailed spec (v358) |
| `docs/SALES_UX_HANDOFF_v360.md` | Sales UX patterns (v360) |
| `docs/SALES_HANDOFF_v351.md` | Sales view architecture (v351) |
| `docs/SALES_DATA_HANDOFF_v359.md` | Sales data pipeline (v359) |
| `docs/HANDOFF_v347_ECHO.md` | Echo early handoff (v347) |

### Abandoned plans (ไม่เคย build ตามแผนนี้)
| ไฟล์ | หมายเหตุ |
|---|---|
| `docs/kam_pipeline_architecture.md` | "KAM & AD Opportunity Pipeline" — แผนดีไซน์ hot/warm/cold lead tracking, ไม่มี code ใดอ้างอิงคำว่า `opty`/`kam_pipeline`/`blind_spot` เลย — ไม่เคยถูก build ฟีเจอร์ "Sales pipeline" ที่มีอยู่จริงตอนนี้เป็นคนละอันที่ scope ต่างออกไป |

---

## 🖥 TL Dashboard (dashboard.html) — ⚠️ DELETED FROM REPO 2026-07-08

`dashboard.html`, `src/dashboard/*`, `build_dashboard.py` ถูกลบออกจาก repo ทั้งหมดแล้ว
("Deprecated product, no longer used — superseded by /nrr"). Section นี้เก็บไว้เป็น
ประวัติเท่านั้น — **ไฟล์เหล่านี้ไม่มีอยู่จริงในโค้ดปัจจุบัน**

### Session Handoffs (Dashboard) — ประวัติของ product ที่ถูกลบแล้ว
| ไฟล์ | Version | เนื้อหา |
|------|---------|---------|
| `docs/handoff-2026-06-14-v708.md` | v708 | Phase 7+8 — polish, arch fixes, DASH_CONFIG |
| `docs/handoff-2026-06-14-v706.md` | v706 | Phase 6 — Echo integration |
| `docs/handoff-2026-06-14-v705.md` | v705 | Phase 5 — Skills dashboard |
| `docs/handoff-2026-06-14-v704.md` | v704 | Phase 4 — Commission engine |
| `docs/handoff-2026-06-14-v703.md` | v703 | Phase 3 — Map×List sync |
| `docs/handoff-2026-06-14-v702.md` | v702 | Phase 1 — Shell + Auth |

---

## 🎨 Design System

| ไฟล์ | เนื้อหา |
|------|---------|
| `design/DESIGN_SYSTEM.md` | **Rules for AI** — read before writing any CSS/HTML |
| `design/tokens.css` | Single source of truth — 284 tokens, light + dark |
| `design/components.html` | Living reference — all components rendered |
| `design/RESPONSIVE.md` | Breakpoint rules per component |
| `design/CHANGELOG.md` | Design system version history |
| `docs/sales_uxui_v7.html` | Sales UI mockup reference (v7) — ยังไม่ตรวจสอบรอบนี้ ไม่รวมอยู่ใน SQL/MD audit |
| `docs/sales_ui_v6.html` | Sales UI mockup reference (v6) — เช่นเดียวกัน |
| `docs/skills_mockup_v3_tl.html` | TL Skills mockup reference — เช่นเดียวกัน |

---

## 📊 QNRR Movement Views (SQL)

### Master Spec
| ไฟล์ | สถานะ | หมายเหตุ |
|---|---|---|
| `docs/qnrr_master_movement_design_v8.md` | ✅ **CURRENT** | Final locked logic — เพิ่ม TL/Rep view + แก้ 2 บั๊กจาก v7 — ใช้ไฟล์นี้เท่านั้น |
| `docs/qnrr_master_movement_design_v7.md` | ~~SUPERSEDED~~ | ใช้ v8 แทน (v8 เป็น superset ของ v7) |
| `docs/qnrr_master_movement_design_v3.md` | ~~DEPRECATED~~ | |
| `docs/qnrr_master_movement_design_v4.md` | ~~DEPRECATED~~ | |
| `docs/qnrr_master_movement_design_v5.md` | ~~DEPRECATED~~ | |
| `docs/qnrr_master_movement_design_v6.md` | ~~DEPRECATED~~ | |

### Latest Handoff
| ไฟล์ | วันที่ | สถานะ |
|---|---|---|
| `docs/handoff-2026-06-26-rep-view-complete.md` | 2026-06-26 | ~~SUPERSEDED~~ by `qnrr_master_movement_design_v8.md` (เขียนต่อจากไฟล์นี้โดยตรง) |
| `docs/handoff-2026-06-25-nrr-v8.md` | 2026-06-25 | ~~SUPERSEDED~~ |
| `docs/handoff-2026-06-24-all-views-complete.md` | 2026-06-24 | ~~SUPERSEDED~~ |
| `docs/handoff-2026-06-23-portfolio-views.md` | 2026-06-23 | ~~SUPERSEDED~~ |
| `docs/handoff-2026-06-22-vp-movement-v2.md` | 2026-06-22 | ~~SUPERSEDED~~ |

### SQL Files (current state)
| ไฟล์ | สถานะ |
|---|---|
| `sql/NOT_USE_q2_2026_movement_kam_view.sql` | 🗄 Archived 2026-07-11 — แทนที่ด้วย `sql/q3_2026_movement_rep_view.sql` |
| `sql/NOT_USE_q2_2026_movement_pm_view.sql` | 🗄 Archived 2026-07-11 — แทนที่ด้วย `sql/q3_2026_movement_pm_view.sql` |
| `sql/NOT_USE_q2_2026_movement_admin_view.sql` | 🗄 Archived 2026-07-11 — แทนที่ด้วย `sql/q3_2026_movement_admin_view.sql` |
| `sql/NOT_USE_q2_2026_movement_vp_view.sql` | 🗄 Archived 2026-07-11 — แทนที่ด้วย `sql/q3_2026_movement_vp_view.sql` |
| `sql/NOT_USE_quarterly_nrr_2026_Q2_v5.sql` (+v6/v7/v8) | 🗄 Archived 2026-07-11 — ออกแบบเลิกใช้ก่อนเคย run จริง |
| `sql/q3_2026_movement_rep_view.sql` | ✅ **ACTIVE** — Sense main app (rep-facing) อ่านไฟล์นี้ ผลิต `kam_rep_view.csv` |
| `sql/q3_2026_movement_pm_view.sql` | ✅ **ACTIVE** — ผลิต `pm_view.csv` |
| `sql/q3_2026_movement_admin_view.sql` | ✅ **ACTIVE** — ผลิต `admin_view.csv` |
| `sql/q3_2026_movement_vp_view.sql` | ✅ **ACTIVE** — ผลิต `vp_view.csv` (unified all-portfolio pool) |

## 🗄 SQL & Database

| ไฟล์ | เนื้อหา |
|------|---------|
| `docs/skills_p0_supabase.sql` | Skills tables — full schema + RLS (✅ นี่คือไฟล์ที่ใช้ seed จริง) |
| `docs/echo_skills_p0.sql` | Echo×Skills bridge table |
| `docs/ci_sessions_s2_migration.sql` | ci_sessions schema migration |
| `docs/supabase-migration-q3-commission-mode.sql` | เพิ่ม `commission_mode`/`quarter_id` ให้ `nrr_policies` |
| `docs/supabase-migration-nrr-exclusions-v2.sql` + `-v3.sql` | `nrr_exclusions` schema/RLS (v3 เพิ่ม outlet-level scoping + revoke บน v2) |
| `docs/supabase-migration-add-pm-role-2026-07-17.sql` | เพิ่ม `role='pm'` — รันผ่าน Supabase MCP แล้ว ✅ (2026-07-17) |
| `sql/NOT_USE_skills_schema.sql`, `NOT_USE_skills_seed.sql` | 🗄 Archived 2026-07-19 — draft ก่อนหน้าที่ถูกแทนที่ด้วย `skills_p0_supabase.sql` ตั้งแต่ยังไม่ทันรัน |
| `sql/NOT_USE_verify_pulse_new_from_sales.sql` | 🗄 Archived 2026-07-19 — one-off diagnostic query เดิม ไม่เคยอยู่ใน pipeline ไหน |

### PM/AD roster rollout (active, ยังไม่ปิดงาน)
| ไฟล์ | สถานะ |
|---|---|
| `handoff_sql_pm_role/README.md` | **ACTIVE / IN PROGRESS** — runbook ให้ data team รัน 12 query เพิ่ม 4 คนใหม่ (Panitan/Sarawoot/Nichamon/Ornpreya) เข้า CSV ที่มีอยู่แล้ว — ยังไม่ยืนยันว่า data team รันครบหรือยัง |
| `sql/pm_rep_view.sql` | **ACTIVE, pending deploy** — query ใหม่สำหรับ `/nrr`, `src/nrr/nrr_data.js` fetch ไว้รอแล้ว |

### Kept active for future work (ไม่มี CSV consumer วันนี้ แต่ตัดสินใจเก็บไว้แล้ว — 2026-07-19)
| ไฟล์ | หมายเหตุ |
|---|---|
| `sql/May2026_KAM_portfolio_reconcile.sql` | Foundation สำหรับงาน reconcile ระดับไตรมาสของ /nrr ที่จะตามมา (ใช้เดือนปัจจุบันเป็นเดือนฐานเดือนแรก) |
| `sql/upsell_May2026_v1.sql` | เช่นเดียวกัน — ส่วน Upsell ของงาน reconcile เดียวกัน |

---

## 🗺 Pending

~~### Dashboard — Phase 0: BigQuery query result → replace `MOCK_DISTRICT`~~
(ยกเลิก — Dashboard product ถูกลบออกจาก repo แล้ว 2026-07-08 ไม่มีความเกี่ยวข้องอีกต่อไป)

---

## 📐 Ground Truth GMV (locked)
Oct25=188.2M · Nov25=204.4M · Dec25=235.7M · Jan26=214.9M · Feb26=195.1M · Mar26=204.2M · Apr26=192.6M

## 🔧 Debug Commands (Dashboard console) — ⚠️ ใช้ไม่ได้แล้ว
Dashboard product ถูกลบแล้ว คำสั่งด้านล่างอ้างอิง `DashLog` ที่ไม่มีอยู่ในโค้ดปัจจุบัน เก็บไว้เป็นประวัติเท่านั้น
```js
DashLog.print()   // error log
DashLog.dump()    // full array
DashLog.clear()   // clear
localStorage.setItem('dash_debug','1')  // verbose
```
