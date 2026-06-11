# Session 4 Handoff — Bugs × Echo UX × Silent Recording
**Last deployed:** v540 | **Snapshot (rollback point):** `snapshot/pre-bugfix-s4-v531`
**Session date:** 2026-06-11

---

## ⚠️ Session 5 goal ยังเดิม: Co-visit GPS verify

งาน session 4 ขยายออกไปมากกว่าที่วางไว้ แต่ **goal หลักของ session 5 ยังคือ Co-visit GPS verify** ตาม session-3-handoff.md — ยังไม่ได้ทำเลย

---

## Version timeline this session (v532 → v540)

| Version | What |
|---|---|
| v532 | Bug fixes: visit badge count, skillsInit double-fetch guard, orphaned CSS |
| v533 | Echo UX redesign: dark mode transition, visit hero card, AudioContext keep-alive, 24kbps/90min, ambient wave, float pill restyle |
| v534 | Fix: _loadVisitHero not called after session save |
| v535 | Fix: blank screen KAM/AD, dark mode blocked by !important, wave speed, topbar dim |
| v536 | Fix: wave 2π/N smooth ripple, session guard (echoOpen kills recording), timer color, visit hero hide during rec, จบ & วิเคราะห์ btn, visibilitychange guard |
| v537 | Fix: visit hero always visible + above orb, wave (1+sin)/2 formula, stop btn ghost, white restore on stop |
| v538 | Fix: no_speech bug — remove AudioContext.createMediaStreamSource (corrupts stream), 24kbps bitrate |
| v539 | Retry logic: 3 attempts, 3s+7s backoff on Gemini 503/429 |
| v540 | Fix: Debrief hidden when TL/Admin records own session (_isOwnRecording flag), visit hero hidden for TL/Admin |

---

## Echo UX — final state (v540)

### State machine
| State | UI |
|---|---|
| Picker | ขาว · visit hero card (rep only) · search · account list |
| Idle | ขาว · visit hero (above orb) · orb mic · "กดเพื่อเริ่มบันทึก" |
| Recording | Dark `#111111` · ambient wave 13 bars · timer white · "echo กำลังรับฟัง" · จบ & วิเคราะห์ (ghost) + X cancel |
| Minimized | Float pill ดำ · wave bars · timer เท่านั้น |
| Processing | dots breathing + progress bar · white bg |
| Result | white bg · Skills/ลูกค้า/Next Steps/Transcript · Debrief (TL เปิด session น้อง only) |

### Key architecture decisions
- `audioBitsPerSecond: 24000` — 90min opus = ~22MB base64 (borderline แต่ OK สำหรับ conversation จริง 20-30min)
- `MAX_SECS = 5400` (90min hard cap)
- AudioContext: สร้างเพื่อ iOS keep-alive แต่ **ไม่** connect stream (createMediaStreamSource corrupts MediaRecorder signal → no_speech)
- Timer: `Date.now() - _startTime` ไม่ drift บน screen lock
- `_isOwnRecording = true` เมื่อกด startRecording → ซ่อน Debrief ใน result
- `echoOpen()` ตรวจ `CI._phase() === 'recording'` → redirect echoExpand() แทน kill session
- Gemini 503/429 retry: 3 attempts, delays 3s + 7s

### Visit hero card (rep only, TL/Admin ซ่อน)
- Position: เหนือ orb, ใต้ chip
- Weekly: `ci_sessions` COUNT, weekStart = Monday, dots 1-5 แดง, 6+ ทอง
- Quarterly: `ci_sessions` COUNT, qStart = Jan/Apr/Jul/Oct
- Hidden during recording (ซ่อนเพื่อโฟกัส wave+timer)
- Refresh: 250ms after mount + 800ms after save

### Role behavior differences
| Feature | Sales/KAM/AD | TL/AD_TL | Admin |
|---|---|---|---|
| Visit hero | ✓ แสดง | ✗ ซ่อน | ✗ ซ่อน |
| Debrief (อัดเอง) | ✗ | ✗ | ✗ |
| Debrief (เปิด session น้อง) | ✗ | ✓ | ✓ (future) |
| History tab | ของตัวเอง | Team feed | Team feed |

---

## Bugs fixed this session (full list)

**v532:**
- Visit badge count = 0 เสมอ → destructure `{count}` จาก Supabase HEAD request แทน `data?.length`
- skillsInit double-fetch → idempotency guard `_skillsInitRole`
- Orphaned CSS selectors ลบออก

**v535:**
- Blank screen หลังเลือกร้าน (KAM/AD) → `_hidePicker()` reference `.rec-bottom` class ที่ถูกลบไปแล้ว
- Dark mode ไม่ทำงาน → `background:#FFFFFF!important` ชนะ JS, ลบ !important
- Topbar สีขาวค้าง → เปลี่ยนเป็น `transparent` + transition

**v536:**
- Wave blocky → เปลี่ยนจาก Math.random phases เป็น 2π/N evenly spaced
- กด nav-echo ระหว่าง recording → session ตาย → echoOpen() guard ด้วย CI._phase()
- Timer จาง บน dark mode → set `rgba(255,255,255,.82)`

**v537:**
- Visit hero อยู่ใต้ orb → ย้ายขึ้นมาเหนือ
- Wave ยังกระตุก → เปลี่ยน `Math.abs(sin)` เป็น `(1+sin)/2`
- Processing screen ยัง dark → `stopRecording()` เรียก `_applyRecordingTheme(false)` ก่อน

**v538:**
- no_speech ทุก recording → `AudioContext.createMediaStreamSource(stream)` corrupt MediaRecorder signal

**v539:**
- Gemini 503 → user เห็น error ทันที → retry 3 ครั้ง + backoff

**v540:**
- Debrief โผล่ตอน TL/Admin อัดเอง → `_isOwnRecording` flag
- Visit hero แสดง `—` สำหรับ TL/Admin → ซ่อนทั้งใบตั้งแต่ mount

---

## Known issues / not done

### visibilitychange handler (partial)
- เพิ่ม basic guard แล้ว (timer sync + recorder state check)
- ยังไม่มี recovery flow ถ้า MediaRecorder.state = 'inactive' จริงๆ

### ci-rdot dead element
- `id="ci-rdot"` ใน HTML ไม่ถูก toggle — invisible, ไม่กระทบ

### Chrome desktop no_speech
- ตอน session นี้ Gemini API มีปัญหา (503 + no_speech) บน Chrome desktop
- Mobile ใช้ได้ปกติ
- ไม่ใช่ bug ของ code — Gemini model behavior / API instability

---

## Session 5 — next steps

### Primary goal: Co-visit GPS verify (ยังไม่ได้ทำ)

Architecture จาก session-3-handoff.md:

```
Supabase table: covisit_events
id UUID PK | session_id FK→ci_sessions | tl_email | rep_email
tl_lat | tl_lng | rep_lat | rep_lng | proximity_m | verified | checked_at
```

TL flow:
1. TL เปิด session detail ของน้อง (history tab → tap session card)
2. "ยืนยัน Co-visit" button ใน footer ของ `_renderSessionDetailContent()`
3. GPS snap → Haversine < 100m → `verified: true` → badge `✓ Co-visit` บน session card

Entry point: `_renderSessionDetailContent()` ใน `src/09_conv_intel.js`

### Secondary (ถ้ามีเวลา)
- ทดสอบ 90min recording จริงบน iOS PWA
- Cleanup `ci-rdot` dead element

---

## Build reference

```bash
cd /home/claude/sense_build/repo
git pull origin main
python3 build.py v541   # next version
```

Latest deployed: **v540** | SW cache: `sense-v540`
