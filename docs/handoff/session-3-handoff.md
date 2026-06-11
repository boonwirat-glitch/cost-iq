# Session 3 Handoff (ฉบับ complete) — Skills × Echo × UX Fixes
**Last deployed:** v531 | **Snapshot (rollback point):** `snapshot/pre-echo-skills-s3-v518`
**Session date:** 2025-06-11

---

## Version timeline this session (v519 → v531)

| Version | What |
|---|---|
| v519 | Session 3 features: visit badge, history filter chips, rep sees TL note |
| v520 | Passive cold retry — R2 re-fetch if portview empty after splash timeout |
| v521 | Fix _supaReq 204 No Content — PATCH/POST return=minimal no longer throws |
| v522 | Fix _supaReq auth — use SUPA_KEY/SUPA_URL globals (supa.supabaseKey undefined in JS v2) |
| v523 | principle pre-wrap + pass_test newline delimiter (/ still works as fallback) |
| v524 | sk-rubric-eye: font 11px + sk-ac red color |
| v525 | s3-hero 55% height + teaser line-clamp 2 (later revised) |
| v526 | Practice field in skill settings modal + modal 440px + rows 3 |
| v527 | Peek redesign: title+principle in peek, practice/passtest/cta on expand; sheet float shadow |
| v528 | Revert bg 0.65 + peek height 45% |
| v529 | Peek height 48% |
| v530 | practice_th newline delimiter (\n first, \| fallback) |
| v531 | practice_th markdown-lite # header support |

---

## Features built & fixed this session

### Echo × Skills (Session 3 goals — all done)
- **Visit badge** on Echo screen — rep เห็น `N visits this week` ข้าง account chip
- **History filter chips** — สัปดาห์นี้ · เดือนนี้ · ทั้งหมด บน inline history tab
- **Rep sees TL coaching note** — purple dot + note block บน session card

### Data / Auth fixes
- **Cold retry** — portview empty after splash timeout → auto re-fetch R2 (2.5s delay, once per session)
- **_supaReq auth** — ใช้ global SUPA_KEY/SUPA_URL แทน supa.supabaseKey (undefined ใน Supabase JS v2)
- **_supaReq 204** — PATCH/POST with return=minimal ไม่ throw JSON parse error อีก
- **Supabase RLS** — เพิ่ม UPDATE/INSERT/DELETE policy บน skill_definitions สำหรับ admin

### Skills content / UX
- **principle_th** — `white-space: pre-wrap` → Enter แสดงเป็นบรรทัดใหม่
- **pass_test_th** — support \n delimiter (/ fallback ยังใช้ได้)
- **practice_th** — support \n delimiter + `#` markdown-lite header
- **sk-rubric-eye** — font 11px + color `var(--sk-ac)` (#FF385C)
- **Skill settings modal** — เพิ่ม Practice field, rows 3, max-width 440px

### s3 skill card redesign
- **Peek state** — แสดง Title + Principle เต็ม (ไม่ truncate), Practice/PassTest/CTA ซ่อนจนกว่าจะ expand
- **Sheet floating** — `overflow: visible` บน s3-detail/s3-hero → artwork ไม่โดน crop, sheet float เหนือ artwork
- **Sheet shadow** — `box-shadow: 0 -8px 40px rgba(0,0,0,.18)` → รู้สึก layer ที่ลอยอยู่สูงกว่า
- **Peek height** — 48% (artwork ยังเห็นอยู่ ~52%)

---

## Supabase migrations run this session

### 1. ci_sessions — tl_note column (Session 2 migration, confirmed done)
```sql
ALTER TABLE public.ci_sessions ADD COLUMN IF NOT EXISTS tl_note TEXT;
```

### 2. skill_definitions — RLS policies
```sql
CREATE POLICY skill_defs_update ON public.skill_definitions
FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE POLICY skill_defs_insert ON public.skill_definitions
FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE POLICY skill_defs_delete ON public.skill_definitions
FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
```

### 3. skill_definitions — practice_th column (run this if not yet done)
```sql
ALTER TABLE public.skill_definitions ADD COLUMN IF NOT EXISTS practice_th TEXT;
```

---

## Current state — what works (v531)

| Feature | Roles | Notes |
|---|---|---|
| Visit badge on Echo | Sales, KAM, AD rep | Hidden for TL/Admin |
| History filter chips | All reps | TL sees all (no filter) |
| Rep sees TL coaching note | All reps | Purple dot + note block |
| TL writes coaching note | TL, Admin | Session 2 feature |
| Cold retry on empty portview | All | Once per session, 2.5s delay |
| Skill content edit (admin) | Admin | Principle/Practice/PassTest/Hint |
| Principle word-wrap | All | pre-wrap |
| Practice # header | All | # = bold header, else bullet |
| Pass test newline | All | \n or / |
| sk-rubric-eye red | All | var(--sk-ac) |
| s3 peek: title+principle | All | Artwork still visible |
| s3 sheet shadow | All | Float layer feel |

---

## Known pending
- **practice_th column** — run migration (item 3 above) if not done yet
- **Portview header safe-area** — pre-existing, deferred
- **Sales portview empty for some Sales reps** — BigQuery kamEmail column missing (data, not code)

---

## Session 4 — what to build next

### Goal: Co-visit + GPS verify
**New Supabase table:** `covisit_events`

| Column | Type | Purpose |
|---|---|---|
| id | UUID PK | |
| session_id | UUID FK → ci_sessions | |
| tl_email | TEXT | |
| rep_email | TEXT | |
| tl_lat, tl_lng | FLOAT | TL GPS |
| rep_lat, rep_lng | FLOAT | Rep GPS (from session location if available) |
| proximity_m | INT | Haversine distance |
| verified | BOOL | < 100m = auto-verify |
| checked_at | TIMESTAMPTZ | |

**TL flow:**
1. TL opens Echo session detail → "ยืนยัน Co-visit" button
2. GPS snap → Haversine check
3. < 100m → `verified: true` → badge `✓ Co-visit` บน session card

**Entry point:** `src/09_conv_intel.js` — เพิ่มใน `_renderSessionDetailContent()` footer area (ต่อจาก TL coaching note)

---

## Architecture reference
- `src/09_conv_intel.js` — Echo: recording, history, TL session detail, visit badge, filter chips
- `src/11_skills.js` — Skills: all S1/S2/S3 views, TL shell, visit tracker, skill card (s3)
- `src/styles_skills.css` — Skills CSS: tokens, s3 card, rubric blocks

### Build command
```bash
cd /home/claude/sense_build/repo
python3 build.py v532
```
**Latest dist:** v531
