# SESSION HANDOFF — 2026-06-06

## Current version: v347 · SW: freshket-sense-v347

---

## File SHAs (latest)

| File | SHA |
|---|---|
| src/09_conv_intel.js | 6156d5732562ed36 |
| src/06_portview_teamview.js | 324ab2340c1eeac0 |
| src/styles_main.css | 80604ee081afa850 |
| src/shell.html | 3c59253d23fd2d1e |

---

## What was done this session (v337 → v347)

### Echo Feature — core build (v337–v340)

**Architecture:**
- `ciq_echo_visits` localStorage — fast source for portview dot (write after every Echo save)
- `ci_sessions` Supabase table — source for history sheet (query async on open)
- 2 entry points: กด dot บน portview card → history ของร้านนั้น / Echo nav → tab "ประวัติ"

**Portview dot states (5 levels, priority order):**
- `echo-recent` ≤7 วัน — เขียวสด + glow
- `echo-old` 8–30 วัน — เขียวจาง
- `full` — เคยเปิด restaurant overlay (เดิม)
- `account` — เคยเปิด account view (เดิม)
- `unseen` — display:none (เดิม)

**06_portview_teamview.js:**
- `getEchoMap(email)` — อ่าน `ciq_echo_visits` localStorage
- `getVisitDot(visitMap, accountId, echoMap)` — priority logic 5 states
- `_pvEchoMap` ใน renderPortviewList
- dot onclick → `echoHistory(accountId)` พร้อม `event.stopPropagation()`
- Profile label fixed ทั้ง 3 จุด (L430 close sheet, L2926 relabel(), L2927 aria-label)

**09_conv_intel.js:**
- `_saveToSupabase()` เขียน `ciq_echo_visits` หลัง ci_sessions INSERT
- Tab bar "บันทึก / ประวัติ" ใน record screen — `_switchMainTab()`
- `_loadInlineHistory()` — query ci_sessions, fallback kam_skill_log
- `echoHistory(accountId)` global
- `_topbarLeft()` — แก้ `_phase is not defined` bug
- Inline picker (ไม่มี sheet แยก) — `_showPicker` flag, `_buildKamPickerInline()`, `_buildSalesPickerInline()`
- Picker routing: ตรวจ `document.body.classList.contains('restaurant-sheet')` ก่อน skip picker

**styles_main.css:**
- `.pv-dot.echo-recent` / `.pv-dot.echo-old` / `.pv-chip-dot.echo-recent` / `.pv-chip-dot.echo-old`
- Echo icon Pattern B: 5 bars 4px wide · 5·11·6·14·17px · bottom-aligned · `steps(2,end)` animation
- topbar `z-index:200` (สูงกว่า rest-sheet-body 163 — แก้ scroll bleed ผ่าน freshket topbar)
- `--n-200` (= `--tx3`) raise จาก `#AEAEB2` → `#6C6C70` (iOS UIColor.secondaryLabel, contrast 5.91:1)

**shell.html:**
- "รายร้าน" → "Profile" ทุกจุด

---

### Database migration (Supabase)

รันแล้ว `sql/echo_migration.sql`:
- `ci_sessions` table สร้างแล้ว (12 cols)
- `kam_skill_log` ci_session_id column + FK เพิ่มแล้ว
- `kam_visits` +5 cols เพิ่มแล้ว
- RLS ทุก table เปิดแล้ว

Verified:
```
acct_alternatives: 3 cols
ci_sessions:       12 cols ✓
kam_skill_log:     11 cols ✓
kam_visits:        11 cols ✓
profiles:          6 cols
```

---

### AI Pipeline improvements (v344)

**09_conv_intel.js:**

1. `_ctx()` enriched — expose GMV, baseline, pace%, churn_count, missing_cats, account_class, is_new จาก portviewBulkData

2. Transcript word gate — 80 words threshold (`_lastTranscriptWordCount`), แทน `< 5 chars` เดิม

3. 2-pass skill analysis:
   - Pass 1 (Haiku): 10 observable skills (APIPC, A5, B2, B3, C0, C1, C3, C4, C5, D2) — parallel
   - Pass 2 (Haiku): 4 inference skills (A9, A10, B4, D1) — parallel (`Promise.all`)
   - Short transcript (<80w): single pass + inference marked `not_applicable`
   - Account context injected into both passes

4. `_analyzeIntel()` enriched — inject GMV/pace/churn/class เข้า Sonnet context

5. Short transcript warning banner — สีส้ม แสดง word count + คำแนะนำ

---

### Search improvements (v345–v347)

**Outlet-aware search (ทั้ง picker + portview):**

`_buildOutletIndex()` — build Map<outlet_name_lower → account_id> จาก `bulkOutletsData`

**Echo picker (09_conv_intel.js):**
- Search match account_name OR outlet_name
- Outlet match แสดง hint `outlet: ชื่อสาขา` ใต้ account name (truncate 220px, font 11px, color #6C6C70)
- Default list (q ว่าง): top 8 by GMV

**Portview search (06_portview_teamview.js):**
- Filter match account_name OR outlet_name → แสดง account card เหมือนเดิม ไม่มี hint
- Graceful fallback ถ้า bulkOutletsData ยังไม่โหลด

---

## Known issues / pending

- [ ] Portview scroll ทะลุ topbar: แก้ด้วย topbar z-index:200 แล้ว แต่รอ confirm บน device
- [ ] Echo icon: Pattern B deploy แล้ว รอ confirm user พอใจ
- [ ] Profile label บน nav: แก้ทั้ง 3 จุดแล้ว (HTML + JS relabel() + aria-label)
- [ ] ci_sessions table: พร้อมแล้ว แต่ยังไม่มีข้อมูล Echo จริงในระบบ — รอ KAM ใช้งาน

## Pending features (backlog)

- TL view ci_sessions ของทีม
- Sales history tab (ไม่มี account_id — group by account_name แทน)
- Commission lock workflow (ไม่เกี่ยวกับ Echo)
- Handover min GMV threshold ใน cockpit

---

## Build commands

```bash
# Build
cd /tmp/build347
python3 build.py v{N}

# Deploy pattern (Git Tree API — ไม่ใช่ Contents API สำหรับ index.html >1MB)
# 1. blob create → 2. tree create → 3. commit create → 4. ref patch
```

## Key architecture reminders

- `ciq_echo_visits` localStorage: `{ "email::account_id": {ts, count} }` TTL 30 วัน
- `bulkOutletsData`: `{ account_id → { month_label → [{outlet_id, outlet_name, gmv, ...}] } }`
- portviewBulkData fields: `id`, `name`, `accountType`, `gmvToDate`, `paceSignal`, `churnedSkuCount`, `missingCatCount`, `daysWithCurrentKam`
- REPLACE overrides (ต้องแก้ที่ override file ไม่ใช่ origin): `renderTeamviewKamList`, `_commBuildPayoutSummary`, `exportCommissionSnapshotCsv`, `lockCommissionSnapshot`
- CSS file load order: styles_main.css → styles_commission.css (ต้อง copy ทั้งคู่ก่อน build)
