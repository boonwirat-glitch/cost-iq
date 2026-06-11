# Session 1 Handoff — Echo × Skills Upgrade
**Last deployed:** v517 | **Snapshot (rollback point):** `snapshot/pre-echo-skills-upgrade-v224d`
**Session date:** 2025-06-11

---

## What was built this session (v514 → v517)

### v514 — Foundation
- **Safe-area fix** — `env(safe-area-inset-top, 44px)` added to all 5 Echo sheets: `#ci-fullsheet`, `#ci-debrief-sheet`, `#ci-history-sheet`, `#ci-trend-sheet`, `#ci-sess-detail` → Echo topbar buttons now tappable on iPhone PWA (Dynamic Island / notch safe)
- **KAM TL Skills nav** — `body.kam-mode .bnav .ni.sales-any-btn { display: flex !important }` in `styles_main.css` → KAM TL (role=`tl`) now sees Skills tab in bottom nav
- **TL Skills 4-tab shell** — `_renderTLShell` now has 4 tabs: รอประเมิน · ภาพรวมทีม · Visits · อ่าน Skills
- **`_renderTLVisitContent()`** — async function in `11_skills.js` that queries `ci_sessions` via `_skFetch`, aggregates weekly + quarterly visits per rep from `_tlSquadEmails`, renders squad summary cards + rep rows with progress bar + last visit date
- **TL browse mode** — `_tlBrowseMode` flag (line ~80 in 11_skills.js); "อ่าน Skills" tab sets it true → opens `_renderRepHome()` (existing S1→S2→S3 unchanged); flag resets on `_renderSkillsScreen()`
- **CTA guard** — TL in browse mode sees READ ONLY badge instead of เริ่มฝึก / แจ้ง TL buttons
- **`_skNickname()` helper** — extracts `(Pop)` from `"Guntinun (Pop)"` via regex `\(([^)]+)\)`; fallback to first word if no parens

### v515 — Name + Target fixes
- **Skills white bg** — `body.kam-mode #scr-skills, body.kad-mode #scr-skills { background: #fff !important }`
- **Quarterly visit target** — bar now uses `acctPerRep[email]` (account count from `portviewBulkData`) as 100% target, not relative `maxW`; shows `X/Y` beside name; summary card shows "ไม่ครบ Q2 2026" instead of "ต่ำกว่า 3"
- **Name lookup priority fixed** — `portviewBulkData.kamName` (e.g. `"Guntinun (Pop)"`) → `_skillUsers` → email prefix

### v516 — KAM mode visual fixes
- **`:has()` CSS** — `body.kam-mode:has(#scr-skills.on)` overrides topbar + nav pill to white/light Airbnb theme when Skills screen is active; reverses automatically when user navigates away (zero JS)
- **Nav pill active state** — accent color `#FF385C` when Skills active, matching sk-* token system

### v517 — Dark bleed fix
- **`min-height: 100dvh`** on `#scr-skills.on` in `kam-mode`/`kad-mode` — prevents dark navy body background bleeding through when Skills content is shorter than viewport

---

## Current state — what works, what's known

### ✅ Working
| Feature | Roles | Notes |
|---|---|---|
| Echo safe-area | All | All 5 sheets fixed |
| Skills nav visible | Sales, Sales TL, AD, AD TL, KAM TL | KAM TL newly unblocked |
| TL Skills 4 tabs | Sales TL, AD TL, KAM TL, Admin | |
| Visits tab | TL roles | Queries ci_sessions, quarterly target from portviewBulkData |
| อ่าน Skills tab | TL roles | Opens existing S1→S2→S3, CTA suppressed |
| Skills white bg + full height | kam-mode, kad-mode | :has() + min-height |
| Nickname display | Visit tab | Extracts (Pop) from full name |

### ⚠️ Known issues / not yet fixed
- **Portview header safe-area** — pre-existing bug, not caused by this session; `.portview-header` has no `env(safe-area-inset-top)` padding → content behind Dynamic Island. Tracked, deferred.
- **KAM TL Visits tab — empty if squad not set** — `_tlSquadEmails` loads from `profiles.squad` field; if KAM TL's squad not set in DB, tab shows "ไม่พบข้อมูลทีม". Data issue, not code issue.
- **Visits quarterly bar empty if portviewBulkData not loaded** — KAM TL entering Skills directly (not via portview) may not have portviewBulkData populated yet → `acctPerRep` = 0, bars empty but graceful.
- **KAM (rep, role=rep) still cannot see Skills** — intentional, no change needed

---

## Files changed this session
| File | What changed |
|---|---|
| `src/09_conv_intel.js` | safe-area padding on 5 sheets |
| `src/11_skills.js` | `_tlBrowseMode`, 4-tab shell, `_renderTLVisitContent`, `_skNickname`, CTA guard, browse reset, name lookup fix |
| `src/styles_main.css` | KAM TL nav, Skills white bg, min-height, :has() topbar+nav overrides |

---

## Session 2 — what to build next

### Goal: TL Session Annotation
TL can read an Echo session recorded by their rep and leave a coaching note + skill override directly on that session.

### Entry point
`src/09_conv_intel.js` only — no other files needed.

**Function to find:** `_renderTLTeamFeed()` (~line 1831 in current repo)
This renders each session card in TL's Echo "ประวัติ" tab (TL opens Echo → กด "ประวัติ" tab → sees all squad sessions).

### What to add
1. **Tap session card → open annotation drawer**
   - Drawer slides up from bottom (same pattern as `#ci-debrief-sheet`)
   - Safe-area padding required (use `env(safe-area-inset-top, 44px)` — established pattern from v514)

2. **Drawer content**
   - Rep name + account name + session date at top (read-only)
   - AI skill scores summary (from `skill_scores` JSON in `ci_sessions`)
   - `<textarea>` for TL coaching note
   - Save button → `_saveTLSessionNote(sessionId, note)`

3. **`_saveTLSessionNote(sessionId, note)`**
   ```js
   await supa.from('ci_sessions')
     .update({ tl_note: note, tl_reviewed_at: new Date().toISOString(), tl_reviewed_by: email })
     .eq('id', sessionId)
   ```
   Graceful fail if columns don't exist yet.

4. **Check Supabase schema first** — run this before coding the save:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'ci_sessions' AND table_schema = 'public'
   ORDER BY ordinal_position;
   ```
   Confirm `tl_note`, `tl_reviewed_at`, `tl_reviewed_by` exist. If not → add via Supabase dashboard before session or use graceful fail.

5. **Visual indicator on reviewed sessions** — after save, session card shows purple dot or "TL ✓" badge so TL can track what they've reviewed

### Design spec for drawer
- Same `--sk-*` token system (white canvas, `--sk-tl: #534AB7` for TL-specific elements)
- TL zone: `background: rgba(83,74,183,.08); border: 1px solid rgba(83,74,183,.16)`
- Save button: `background: #534AB7; color: #fff`
- Pattern already mocked in UX designs from pre-session planning

---

## Full feature roadmap (all 4 sessions)

| Session | Status | What |
|---|---|---|
| **Session 1** | ✅ Done (v514–v517) | Safe-area, KAM TL Skills nav, TL 4-tab shell, Visit tracker, Browse mode |
| **Session 2** | 🔜 Next | TL Session Annotation (note per Echo session) |
| **Session 3** | Planned | Visit badge on Echo screen (rep sees own count), History tab upgrade (mini bar chart, filter chips) |
| **Session 4** | Planned | Co-visit + GPS (covisit_events table, Haversine proximity check, TL GPS verify flow) |

---

## Architecture reference

### Key tables (Supabase)
| Table | Purpose | Key columns |
|---|---|---|
| `ci_sessions` | Every Echo recording | `owner_email`, `owner_type`, `account_id`, `visited_at`, `skill_scores` (JSON), `tl_note` (add if missing), `tl_reviewed_at` |
| `echo_skill_observations` | Per-skill rows from each session | `session_id`, `user_id`, `skill_code`, `ai_score`, `evidence` |
| `kam_skill_log` | Skills progress events | `kam_email`, `skill_code`, `score`, `tl_override` |
| `profiles` | User roster | `email`, `squad`, `role`, `full_name`, `kam_name` |

### Key JS functions to know
| Function | File | What it does |
|---|---|---|
| `_renderTLTeamFeed(sessions)` | 09_conv_intel.js | Renders TL's team Echo feed — session cards |
| `_renderTLVisitContent(container)` | 11_skills.js | Visit tracker in Skills Visits tab |
| `_skNickname(fullName)` | 11_skills.js | Extracts `(Pop)` from `"Name (Pop)"` |
| `_tlBrowseMode` | 11_skills.js | Flag: TL is in skill-card read-only browse |
| `_canDebrief()` | 09_conv_intel.js | Returns true for tl/admin/ad_tl roles |
| `_getTeamEmails()` | 09_conv_intel.js | Returns squad emails from portviewBulkData + salesBulkData |
| `skillsInit()` | 11_skills.js | Entry point when Skills tab is tapped |

### Role → body class mapping
| Role | body class | Skills tab | Echo tab |
|---|---|---|---|
| `sales` | `sales-mode` | ✓ | ✓ |
| `sales_tl` | `sales-mode sales-tl-mode` | ✓ | ✓ |
| `ad` | `kad-mode` | ✓ | ✓ |
| `ad_tl` | `kad-mode ad-tl-mode` | ✓ | ✓ |
| `tl` (KAM TL) | `kam-mode` | ✓ (v514) | ✓ |
| `rep` (KAM) | `kam-mode` | ✗ intentional | ✓ |

### Build command
```bash
cd /home/claude/sense_build
python3 build.py v5XX   # check latest in dist/ folder first
```
Latest dist version before starting: **v517**
Always check: `curl dist/ folder via GitHub API` to get true latest before naming new version.

### Critical rules (learned this session)
1. **Always check `dist/` folder for latest version** — not shell.html header (shell.html may lag behind)
2. **Fetch all source files fresh via blob API** before patching — never trust local state across sessions
3. **Thai text in str_replace** — use Python's `replace()` not bash `sed` for any string containing Thai characters
4. **node --check before every push** — no exceptions
5. **`:has()` CSS** — works on all modern iOS Safari (15.4+, Sep 2022) — safe to use for scoping styles to active screen state without JS

