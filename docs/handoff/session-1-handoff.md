# Session 1 Handoff — Echo × Skills Upgrade
**Built:** v225 | **Snapshot:** snapshot/pre-echo-skills-upgrade-v224d

---

## Done this session

- [x] **Safe-area fix** — `env(safe-area-inset-top,44px)` added to all 5 Echo sheets: `#ci-fullsheet`, `#ci-debrief-sheet`, `#ci-history-sheet`, `#ci-trend-sheet`, `#ci-sess-detail`
- [x] **KAM TL Skills nav** — `body.kam-mode .bnav .ni.sales-any-btn { display: flex !important }` in `styles_main.css`
- [x] **TL Skills 4-tab shell** — รอประเมิน · ภาพรวมทีม · Visits · อ่าน Skills
- [x] **`_renderTLVisitContent()`** — query `ci_sessions` via `_skFetch`, aggregate thisWeek/lastWeek/thisMonth per rep from `_tlSquadEmails`, render squad summary (total/avg/low count) + rep rows with progress bar + last visit date
- [x] **TL browse mode** — `_tlBrowseMode` flag, "อ่าน Skills" tab opens `_renderRepHome()` (S1→S2→S3 unchanged)
- [x] **CTA guard** — TL in browse mode sees READ ONLY badge instead of เริ่มฝึก/แจ้ง TL buttons
- [x] **Browse reset** — `_tlBrowseMode = false` on `_renderSkillsScreen()` TL path

---

## Known state after session 1

**Roles × access (post-deploy):**
| Role | Echo | Skills nav | Skills TL shell | Skills cards | Visit tab |
|---|---|---|---|---|---|
| Sales / Sales TL | ✓ | ✓ | ✓ | ✓ browse | ✓ |
| AD / AD TL | ✓ | ✓ | ✓ | ✓ browse | ✓ |
| KAM TL (`tl`) | ✓ | ✓ NEW | ✓ | ✓ browse | ✓ |
| KAM (`rep`) | ✓ | ✗ intentional | — | — | — |

**Visit tab data source:** `ci_sessions` table, filtered by `_tlSquadEmails` (loaded at skillsInit from `profiles` table). Requires `_tlSquadEmails` populated — if squad not set in profiles, tab shows "ไม่พบข้อมูลทีม".

**Not yet tested on device** — needs PWA install + iPhone Safari to verify safe-area fix.

---

## Session 2 starts here

**Goal:** TL Session Annotation — TL give feedback per Echo session

**Files to touch:**
- `src/09_conv_intel.js` only

**Entry point:** `_renderTLTeamFeed()` function (~line 1831) — this renders each session card in TL's Echo "ประวัติ" tab. Need to add:
1. Expand/tap on session card → open annotation drawer
2. Drawer: textarea for TL note + save button
3. `_saveTLSessionNote(sessionId, note)` → `supa.from('ci_sessions').update({ tl_note: note, tl_reviewed_at: now }).eq('id', sessionId)`
4. Confirm `ci_sessions` has `tl_note` + `tl_reviewed_at` columns (graceful fail if not)

**Supabase check first:** run `SELECT column_name FROM information_schema.columns WHERE table_name = 'ci_sessions'` to verify columns exist before coding the save.

