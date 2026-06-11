# Session 5 Handoff — Co-visit GPS × Echo UX Stability
**Last deployed:** v551 | **Snapshot (rollback point):** `snapshot/pre-covisit-s5-v540`, `snapshot/pre-covisit-rework-v541`
**Session date:** 2026-06-11

---

## Version timeline this session (v541 → v551)

| Version | What |
|---|---|
| v541 | Co-visit GPS verify (v1) + no_speech guard on echo_skill_observations |
| v542 | Co-visit rework — check-in orb (map-pin→mic), TL covisit panel, Haversine verify |
| v543 | Fix checkin UX — pill ใน chip row, ซ่อนระหว่าง recording |
| v544 | Fix Sales dim mode (attempt 1 — inherit) |
| v545 | Fix Sales dim mode (attempt 2 — .is-rec class toggle) |
| v546 | Fix Sales dim mode root cause — .scr inside fullsheet โดน sales-mode override |
| v547 | Fix Echo layout — visit hero ก่อน picker-sec, hide during picker state |
| v548 | CSS scope prefix (REVERTED — blank screen Sales) |
| v549 | Revert v548 + correct approach: :not(#ci-fullsheet *) |
| v550 | Fix Sales topbar white during Echo recording |
| v551 | Co-visit architecture fix — role, tab, state, UI |

---

## Features built this session

### Co-visit GPS verify (complete architecture)

**Rep flow:**
- Picker confirm → orb เปลี่ยนเป็น map-pin "กดเพื่อเช็คอิน"
- กด orb → GPS snap → `_checkinCache` → pill เขียว "เช็คอิน HH:MM" ใน chip row → orb เปลี่ยนเป็น mic
- localStorage persist → เปิดแอพใหม่ภายใน 90 นาที restore state อัตโนมัติ
- `_saveToSupabase`: merge `rep_lat`, `rep_lng`, `checked_in_at` เข้า `ci_sessions` INSERT

**TL flow (KAM TL / Sales TL / AD TL / Admin):**
- เปิด Echo → เห็น co-visit hero (นับจาก `covisit_events.verified=true`) + list น้องที่เช็คอินวันนี้
- State: พร้อม (< 90 นาที) / หมดเวลา / Verified
- Tap row → ปุ่ม "ยืนยัน Co-visit กับ [ชื่อ]" ขึ้น (SVG pin icon, ไม่มี emoji)
- กด → GPS snap → Haversine 150m + time window 90 นาที → upsert `covisit_events` → optimistic UI lock row ทันที
- Co-visit badge บน session card ใน history feed

**Supabase tables:**
```sql
-- ci_sessions: เพิ่ม 3 columns (migration รันแล้ว)
rep_lat FLOAT, rep_lng FLOAT, checked_in_at TIMESTAMPTZ

-- covisit_events (สร้างใหม่, migration รันแล้ว)
id UUID PK, session_id FK→ci_sessions, tl_email, rep_email
tl_lat, tl_lng, rep_lat, rep_lng, proximity_m INT
verified BOOL, checked_at TIMESTAMPTZ
UNIQUE(session_id)

-- ci_sessions: เพิ่ม (migration รันแล้ว)  
covisit_verified BOOLEAN DEFAULT FALSE
```

### Echo UX stability fixes

**CSS isolation:**
- `body.sales-mode .scr:not(#ci-fullsheet *)` — ป้องกัน Sales CSS เข้า Echo fullsheet
- `body.sales-mode #ci-fullsheet.is-rec .scr` — dim mode ทำงานบน Sales
- `body.sales-mode .topbar:not(#ci-fullsheet *)` — topbar ขาวไม่เข้า Echo
- `body.sales-mode #ci-fullsheet.is-rec .topbar` — topbar dim ระหว่าง recording

**Layout:**
- DOM order: chip-wrap → visit-hero → picker-sec → orb (แก้ visit hero หล่น)
- visit-hero hidden ตอน `_showPicker=true`

**Tab switching:**
- `_switchMainTab` role-aware — TL restore covisit panel, Rep restore orb
- TL tab history: hide covisit panel + visit hero, ไม่ inject filter chips (TL ไม่ filter)

**Role:**
- `_canDebrief()` เพิ่ม `isSalesTLRole` — Sales TL เห็น covisit panel + team history + session detail

---

## Known issues / not done

### Co-visit UX ยังมีปัญหา (จาก session-end observation)

1. **TL verify แล้ว ปุ่มขึ้นซ้ำได้** — optimistic lock ทำงานแล้ว แต่ถ้า re-open Echo ใหม่ `_cvSelected=null` → `_loadCovisitList` fetch ใหม่ — ถ้า DB `covisit_verified` update สำเร็จแล้ว row จะเป็น Verified ✓ แต่ถ้า DB lag → row กลับมาเป็นพร้อม

2. **History content ปนกัน** — v551 fix แล้ว (hide covisit panel ตอน switch tab) แต่ยังไม่ได้ test confirm

3. **"already verified today" guard** — ถ้า TL verify session เดียวกันซ้ำ (เช่น เปิด app ใหม่ก่อน DB update) — `UNIQUE(session_id)` บน covisit_events จะ upsert ทับ ไม่นับซ้ำ แต่ UX ยังสับสน

4. **Session detail Co-visit button** (จาก v541) — ยังอยู่ใน footer ของ session detail sheet สำหรับ TL แต่ flow ที่ถูกคือ verify ก่อน (จาก covisit panel) ไม่ใช่หลัง — ควร remove หรือ hide ถ้า verified แล้ว

### CSS isolation (partial)

ใช้ `:not(#ci-fullsheet *)` selector แก้ปัญหา Sales CSS override แล้ว แต่ยังไม่ได้ทำ proper CSS scoping (Shadow DOM หรือ prefix ทุก rule) เพราะ v548 prefix ทำให้ blank screen — ต้องทำ properly ใน session ถัดไป

### Echo × Sales dim mode

v546-v550 fix ทีละ rule ที่ conflict — pattern ที่ต้องระวัง:
- `styles_main.css` มี Sales-specific rules บริเวณ L5100+ ที่ใช้ global selectors (`.topbar`, `.scr`) ครอบ element ใน Echo
- ทุกครั้งที่แก้ Echo ใหม่ต้องตรวจว่า Sales CSS override ไหมที่จุดนั้น

---

## Session 6 — next steps (priority order)

### Primary: Co-visit UX polish
- ลบ Co-visit button ออกจาก session detail footer (เหลือแค่ใน covisit panel)
- "already verified" state — disable row + ไม่ให้ verify ซ้ำ ถ้า session นั้น verified แล้ว
- Test full flow บน iOS PWA (rep check-in + TL verify)

### Secondary: Echo stability  
- `visibilitychange` recovery — ถ้า MediaRecorder.state = 'inactive' ระหว่าง processing → recovery flow
- IndexedDB buffer สำหรับ processing interrupt (ออกแบบแล้ว session 4 — ยังไม่ implement)

### Tertiary: Skills × Echo bridge
- `echo_skill_observations` table มีอยู่แล้ว + auto-save ใน `_saveToSupabase`
- `_buildEchoSparkSection` ใน `11_skills.js` — skeleton มีแล้ว ยังไม่ implement

---

## Architecture notes

### Echo CSS isolation pattern (current)
```css
/* styles_sales.css */
body.sales-mode .scr:not(#ci-fullsheet *) { background: #FFFFFF !important; }
body.sales-mode #ci-fullsheet.is-rec,
body.sales-mode #ci-fullsheet.is-rec .scr { background: #111111 !important; }

/* styles_main.css */  
body.sales-mode .topbar:not(#ci-fullsheet *) { background: #FFFFFF !important; ... }
body.sales-mode #ci-fullsheet.is-rec .topbar { background: rgba(255,255,255,.04) !important; ... }
```

Pattern: `.is-rec` class toggle บน `#ci-fullsheet` โดย `_applyRecordingTheme(isRec)`

### Co-visit data flow
```
Rep: check-in → _checkinCache (localStorage) → merge ใน _saveToSupabase → ci_sessions.rep_lat/lng/checked_in_at
TL: verify → GPS snap → Haversine(tl, rep) < 150m + |now - rep.checked_in_at| < 90min
    → covisit_events INSERT + ci_sessions.covisit_verified = true
```

### Role → Echo screen mapping
| Role | Echo screen | Visit hero |
|---|---|---|
| KAM / Sales / AD | orb (map-pin → mic → record) | ✓ นับจาก ci_sessions |
| TL / AD_TL / Sales_TL / Admin | covisit panel | ✓ นับจาก covisit_events.verified |

---

## Build reference
```bash
cd /home/claude/sense_build/repo
git pull origin main
python3 build.py v552   # next version
```

**Latest deployed:** v551 | SW cache: `sense-v551`
