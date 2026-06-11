# Session 4 Handoff — Bugs × Echo UX × Silent Recording
**Last deployed:** v534 | **Snapshot (rollback point):** `snapshot/pre-bugfix-s4-v531`
**Session date:** 2026-06-11

---

## Version timeline this session (v532 → v534)

| Version | What |
|---|---|
| v532 | Bug fixes: visit badge count, skillsInit double-fetch guard, orphaned CSS |
| v533 | Echo UX redesign: dark mode transition, visit hero card, AudioContext keep-alive, 16kbps/90min, ambient wave, float pill restyle |
| v534 | Fix: _loadVisitHero not called after session save → dots now refresh post-recording |

---

## Bugs fixed this session

### v532 — 3 bugs

**Bug 1 — Visit badge always 0** (`09_conv_intel.js`)
- Root cause: `{ count: 'exact', head: true }` returns `data: null` in Supabase JS v2 — HEAD request has no body
- Fix: destructure `{ count: _visitCount }` directly instead of `data?.length`

**Bug 2 — skillsInit double-fetch on nav tap** (`11_skills.js`)
- Root cause: no idempotency guard — every tap on Skills nav refetched all Supabase data
- Fix: `if (role === _skillsInitRole && _skillDefs.length > 0) { re-render only; return; }`

**Bug 3 — Orphaned CSS selectors** (`styles_skills.css`)
- 4 dangling selectors with no `{}` block — dead code from prior edits
- Fix: removed

---

## Echo UX redesign (v533–534)

### Silent recording — design intent
Recording ≠ surveillance feel. ระบบทำงานอยู่เบื้องหลัง เงียบ ไม่เรียกร้องความสนใจ

### State transitions
| State | UI |
|---|---|
| Picker | ขาว · visit hero card · search · account list |
| Idle (account selected) | ขาว · orb mic · visit hero · ปุ่มกดที่ orb |
| Recording | Dark `#111111` · ambient wave 11 bars · timer · "echo กำลังรับฟัง" · stop btn เทา |
| Minimized | Float pill ดำ · wave bars · timer เท่านั้น (label "Echo" ซ่อนแล้ว) |
| Processing | dots breathing + progress bar |

### Dark mode transition
- กด orb → `_applyRecordingTheme(true)` → CSS transition `.7s ease` บนทุก element พร้อมกัน
- White `#ffffff` → Dark `#111111`, ทุก text/border/card ปรับ opacity ลง
- กด "หยุด" หรือ cancel → `_applyRecordingTheme(false)` → restore ทุก element

### Visit hero card
- แสดงทั้ง idle + recording state (ซ่อนตอน picker เท่านั้น)
- **สัปดาห์นี้:** COUNT จาก `ci_sessions` where `visited_at >= weekStart (Mon)`
  - Dots 1–5: แดง `#FF385C`
  - Dots 6+: ทอง `#FFB300`
  - Empty: `rgba(255,56,92,.15)`
- **ไตรมาสนี้:** COUNT จาก `ci_sessions` where `visited_at >= qStart`
  - qStart = `new Date(year, Math.floor(month/3)*3, 1)` → Jan/Apr/Jul/Oct
- Query: `Promise.all([weekQuery, quarterQuery])` — 2 Supabase calls ใน parallel
- Refresh: หลัง mount (250ms delay) + หลัง session saved (800ms delay)
- Hidden for TL/Admin (`_canDebrief() = true`)

### Audio architecture (90min support)
| Change | Why |
|---|---|
| `audioBitsPerSecond: 16000` | 90min opus = 14.8MB base64 → ใต้ Gemini 20MB inline limit |
| `AudioContext.createMediaStreamSource(stream)` | iOS keep-alive — ป้องกัน audio session suspend เมื่อ screen lock |
| `MAX_SECS = 5400` | 90min cap แทน 7200 (2hr ที่ Worker ไม่รองรับจริง) |
| Timer ใช้ `Date.now() - _startTime` | ไม่ drift เมื่อ JS throttle บน screen lock |

### Float pill
- Wave bar color: `rgba(255,56,92,.45)` — sync กับ main screen
- Label "Echo" ซ่อน (`display:none`) — เหลือแค่ wave + timer
- Animation: `transform-origin: bottom` บน bars

---

## Known pending / not done

### Co-visit GPS verify (Session 4 original plan — ยังไม่ได้ทำ)

**Architecture ออกแบบไว้แล้ว (session-3-handoff.md):**

Supabase table `covisit_events`:
```
id UUID PK | session_id FK→ci_sessions | tl_email TEXT | rep_email TEXT
tl_lat FLOAT | tl_lng FLOAT | rep_lat FLOAT | rep_lng FLOAT
proximity_m INT | verified BOOL | checked_at TIMESTAMPTZ
```

TL flow:
1. TL เปิด session detail → "ยืนยัน Co-visit" button (ต่อจาก coaching note)
2. GPS snap → Haversine distance
3. < 100m → `verified: true` → badge `✓ Co-visit` บน session card

Entry point: `_renderSessionDetailContent()` footer area ใน `src/09_conv_intel.js`

### visibilitychange handler (not implemented)
- iOS explicit resume guard ยังไม่มี
- AudioContext keep-alive บรรเทาได้ส่วนใหญ่
- ถ้าพบ recording หยุดบน iOS หลัง screen lock นาน → ต้อง add

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _phase === 'recording') {
    if (_recorder?.state !== 'recording') {
      // recording dropped — show error + fallback
    }
    // Update timer from Date.now() (already does this via setInterval)
  }
});
```

### ci-rdot dead element
- `id="ci-rdot"` อยู่ใน HTML แต่ไม่ถูก toggle เลย — invisible, ไม่กระทบ UX
- Can clean up later

---

## Architecture reference (updated)

| File | Responsibility |
|---|---|
| `src/09_conv_intel.js` | Echo: recording, history, TL session detail, visit hero, dark transition, AudioContext |
| `src/11_skills.js` | Skills: all views, TL shell, visit tracker, skill card |
| `src/styles_skills.css` | Skills CSS: tokens, s3 card, rubric blocks |
| `src/styles_main.css` | App-wide CSS including float pill |

### Key functions added this session
- `_applyRecordingTheme(isRec)` — dark/light transition on all Echo elements
- `_loadVisitHero()` — fetch weekly + quarterly counts, build dot tracker
- `_themeEl(id, prop, val)` — helper for getElementById + style assignment

### Build command
```bash
cd /home/claude/sense_build/repo
python3 build.py v535
```
**Latest dist:** v534

---

## Session 5 — recommended next

1. **Test v534 on device** — verify dark mode transition, visit hero counts, 90min recording on iOS PWA
2. **Co-visit GPS verify** — build covisit_events table + TL flow (architecture ready)
3. **visibilitychange handler** — if iOS recording issues found during testing
