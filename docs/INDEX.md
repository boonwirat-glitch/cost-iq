# Freshket Commercial OS — Docs Index
`docs/INDEX.md` · อัปเดต 2026-06-14

> **สำหรับ AI session ใหม่:** อ่านไฟล์นี้ก่อนทุกครั้ง แล้วเปิดเฉพาะไฟล์ที่เกี่ยวข้องกับงาน

---

## 🔴 START HERE — Current State

| ไฟล์ | เนื้อหา |
|------|---------|
| `docs/handoff-2026-06-14-v708.md` | **Latest Sense handoff** — v708 |
| `docs/handoff-2026-06-14-v701.md` | Sense v701 — teamview card fix, full architecture notes |
| `docs/handoff/HANDOFF_v606_20260613.md` | Dashboard Phase 1–8 architecture |

---

## 📱 Sense Mobile (index.html)

### Architecture & Specs
| ไฟล์ | เนื้อหา | Sense version |
|------|---------|--------------|
| `docs/FEATURE_GUIDE.md` | How to add new features — step-by-step guide | v597+ |
| `docs/phase0-scale-spec.md` | UX/UI ready-to-scale spec | v597+ |
| `docs/echo-state-spec.md` | Echo state — single source of truth | v552+ |
| `docs/CI_ENTRY_HANDOFF.md` | Conv. Intelligence module architecture | v334+ |
| `docs/CI_HANDOFF.md` | CI module detailed handoff | v560+ |

### Session Handoffs (Sense) — ล่าสุดก่อน
| ไฟล์ | Version | วันที่ |
|------|---------|-------|
| `docs/handoff-2026-06-14-v708.md` | v708 | 2026-06-14 |
| `docs/handoff-2026-06-14-v701.md` | v701 | 2026-06-14 |
| `docs/handoff-2026-06-14-v697.md` | v697 | 2026-06-14 |
| `docs/handoff-2026-06-14-v683.md` | v683 | 2026-06-14 |
| `docs/handoff-2026-06-14-v674.md` | v674 | 2026-06-14 |
| `docs/handoff-2026-06-14-v672.md` | v672 | 2026-06-14 |
| `docs/handoff-2026-06-14-v666.md` | v666 | 2026-06-13 |
| `docs/session-handoff-v644.md` | v644 | 2026-06-13 |
| `docs/session-handoff-v643.md` | v643 | 2026-06-13 |
| `docs/handoff/HANDOFF_v606_20260613.md` | v606 | 2026-06-13 |
| `docs/handoff/HANDOFF_v590_20260613.md` | v590 | 2026-06-13 |
| `docs/handoff/HANDOFF_v589_20260612.md` | v589 | 2026-06-12 |
| `docs/handoff/HANDOFF_v570_20260612.md` | v570 | 2026-06-12 |
| `docs/handoff/session-6-handoff.md` | v552 | earlier |
| `docs/handoff/session-5-handoff.md` | v540 | earlier |
| `docs/handoff/session-4-handoff.md` | v531 | earlier |
| `docs/handoff/session-3-handoff.md` | v522 | earlier |
| `docs/handoff/session-2-handoff.md` | v517 | earlier |
| `docs/handoff/session-1-handoff.md` | v517 | earlier |

### Feature-specific (Sense)
| ไฟล์ | เนื้อหา |
|------|---------|
| `docs/HANDOFF_v404_SKILLS_SALES.md` | Skills + Sales module handoff (v404) |
| `docs/HANDOFF_SALES_v391.md` | Sales view handoff (v391) |
| `docs/SALES_UI_HANDOFF_v358.md` | Sales UI detailed spec (v358) |
| `docs/SALES_UX_HANDOFF_v360.md` | Sales UX patterns (v360) |
| `docs/SALES_HANDOFF_v351.md` | Sales view architecture (v351) |
| `docs/SALES_DATA_HANDOFF_v359.md` | Sales data pipeline (v359) |
| `docs/HANDOFF_v347_ECHO.md` | Echo early handoff (v347) |

---

## 🖥 TL Dashboard (dashboard.html)

### Session Handoffs (Dashboard)
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
| `docs/sales_uxui_v7.html` | Sales UI mockup reference (v7) |
| `docs/sales_ui_v6.html` | Sales UI mockup reference (v6) |
| `docs/skills_mockup_v3_tl.html` | TL Skills mockup reference |

---

## 🗄 SQL & Database

| ไฟล์ | เนื้อหา |
|------|---------|
| `docs/skills_p0_supabase.sql` | Skills tables — full schema + RLS |
| `docs/echo_skills_p0.sql` | Echo×Skills bridge table |
| `docs/ci_sessions_s2_migration.sql` | ci_sessions schema migration |

---

## 🗺 Pending

### Dashboard
- **Phase 0:** BigQuery query result → replace `MOCK_DISTRICT` ใน `dash_map.js`
  ```sql
  SELECT DISTINCT hub_zone_name, sub_district_th,
    COUNT(DISTINCT res_id) AS account_count
  FROM dwh.order
  WHERE order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)
    AND hub_zone_name IS NOT NULL AND sub_district_th IS NOT NULL
  GROUP BY 1, 2 ORDER BY 1, 2
  ```

---

## 📐 Ground Truth GMV (locked)
Oct25=188.2M · Nov25=204.4M · Dec25=235.7M · Jan26=214.9M · Feb26=195.1M · Mar26=204.2M · Apr26=192.6M

## 🔧 Debug Commands (Dashboard console)
```js
DashLog.print()   // error log
DashLog.dump()    // full array
DashLog.clear()   // clear
localStorage.setItem('dash_debug','1')  // verbose
```
