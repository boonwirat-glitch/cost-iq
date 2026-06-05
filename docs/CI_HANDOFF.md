# CI Module — Session Handoff
**สร้างเมื่อ:** June 2026 · **Session ก่อนหน้า:** Design & Architecture  
**สถานะ:** พร้อม build — ยังไม่ได้แตะ code เลย

---

## STARTER PROMPT สำหรับ session ใหม่

paste ทั้งหมดนี้เป็น message แรกใน session ใหม่:

```
อ่านและทำตามนี้ทุกอย่างก่อนเริ่มทำงาน:

CONTEXT: เรากำลัง build "Conversation Intelligence (CI)" feature ใหม่
สำหรับ Freshket Sense — PWA สำหรับ KAM/TL ที่ host บน Cloudflare Pages

REPO: github.com/boonwirat-glitch/cost-iq (branch: main)
GITHUB TOKEN: ghp_***REDACTED_SEE_BUCCI***

อ่านไฟล์เหล่านี้จาก repo ผ่าน GitHub blob API ก่อนทำอะไรทั้งหมด
(ใช้ blob API เท่านั้น — ห้ามใช้ raw.githubusercontent เด็ดขาด):
1. docs/SESSION_HANDOFF.md
2. docs/STEP3_HANDOFF.md  
3. docs/CI_HANDOFF.md  ← handoff ไฟล์นี้ที่ push เข้า repo แล้ว
4. src/06_portview_teamview.js (เฉพาะ SECTION:VISIT_TRACKING และ account view HTML)
5. build.py (ทั้งไฟล์)
6. sw.js (บรรทัดแรกเพื่อดู SW version ปัจจุบัน)

หลังอ่านครบแล้ว สรุปให้ฟังว่าเข้าใจอะไรบ้าง แล้วเริ่ม build ตาม
BUILD ORDER ใน handoff โดยไม่ต้องถามทีละ step
pre-authorized ให้ทำต่อเนื่องได้เลย
```

---

## สิ่งที่ตัดสินใจไปแล้ว (ห้ามเปลี่ยนโดยไม่ถาม)

| เรื่อง | ตัดสินใจ | เหตุผล |
|---|---|---|
| Audio storage | ไม่เก็บ audio เลย | privacy |
| Transcript storage | ไม่เก็บ raw transcript | privacy — เก็บแค่ structured output |
| Transcription model | Whisper (OpenAI) | แม่นที่สุดสำหรับ Thai + noisy field |
| Analysis model | Claude Haiku (skills) + Claude Sonnet (customer intel) | quality > speed |
| UI theme | Light — Apple Music / Spotify feel | ไม่ใช้ dark, ไม่ใช้ green background |
| Entry point | ปุ่มใน account view + FAB | ไม่เพิ่ม tab ใหม่ |
| Rollout | Phase 1: voice note → Phase 2: full record → Phase 3: TL shadow | de-risk |
| Build approach | ทีละ section ไม่ใช่ทีเดียว | ป้องกัน context drift |

---

## Architecture สรุป

### Files ที่ต้องสร้าง/แก้

```
สร้างใหม่:
  src/09_conv_intel.js          ← CI module หลัก (~1,200 lines)
  docs/CI_HANDOFF.md            ← ไฟล์นี้ (push เข้า repo)

แก้:
  build.py                      ← เพิ่ม 09_conv_intel.js ใน build order
  src/06_portview_teamview.js   ← เพิ่มปุ่ม 🎙 ใน account view (surgical)
  sw.js                         ← bump CACHE_NAME

ไม่แตะ:
  commission modules (07a, 07b_*)
  NRR engine
  SQL templates
  portview/teamview logic
```

### Build order ใน build.py (ปัจจุบัน → ใหม่)

```python
# เดิม (อ่านจาก build.py จริงก่อน verify)
# ...07a_commission_engine + 07b_* + 08_patches

# เพิ่มท้ายสุด:
conv_intel_js = read('src/09_conv_intel.js')
# รวมเข้า main_js ท้ายสุด หลัง 08_patches
```

### 09_conv_intel.js — 8 sections

```javascript
// SECTION:CI_RECORDER        — MediaRecorder, iOS compat, consent
// SECTION:CI_TRANSCRIBE      — Whisper API, Thai prompt priming
// SECTION:CI_SKILL_ANALYSIS  — Claude Haiku, 14 skills JSON
// SECTION:CI_CUSTOMER_INTEL  — Claude Sonnet, restaurant context inject
// SECTION:CI_STORAGE         — Supabase save, RLS-aware
// SECTION:CI_UI_SHEET        — HTML/CSS recording + result screens
// SECTION:CI_TL_DEBRIEF      — TL shadow mode, override UI
// SECTION:CI_HISTORY         — past sessions per account
```

### Supabase Schema (รัน migration ก่อน build)

```sql
-- ใน Supabase dashboard → SQL Editor

ALTER TABLE kam_visits
  ADD COLUMN IF NOT EXISTS ci_session_id TEXT,
  ADD COLUMN IF NOT EXISTS ci_skill_scores JSONB,
  ADD COLUMN IF NOT EXISTS ci_customer_signals JSONB,
  ADD COLUMN IF NOT EXISTS ci_next_actions JSONB,
  ADD COLUMN IF NOT EXISTS ci_mode TEXT,
  ADD COLUMN IF NOT EXISTS ci_created_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS kam_skill_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kam_email TEXT NOT NULL,
  account_id TEXT,
  session_date DATE NOT NULL,
  skill_code TEXT NOT NULL,
  score TEXT NOT NULL,
  evidence_summary TEXT,
  tl_override TEXT,
  tl_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE kam_skill_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "KAM sees own" ON kam_skill_log
  FOR SELECT USING (kam_email = auth.jwt()->>'email');
CREATE POLICY "TL sees team" ON kam_skill_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE email = auth.jwt()->>'email'
      AND role IN ('tl','admin')
    )
  );
```

---

## AI Pipeline

```
Audio (WebM/MP4) → Whisper API → Thai transcript (in-memory, ไม่ save)
                                        ↓
                              Claude Haiku → skill_scores JSON
                                        ↓
                              Claude Sonnet → customer_intel JSON
                                        ↓
                              Supabase save (structured only)
                              transcript ทิ้ง
```

### Whisper API Call Pattern

```javascript
// OPENAI_API_KEY เก็บใน Cloudflare Pages env var ชื่อ OPENAI_API_KEY
// เรียกผ่าน Cloudflare Worker (ไม่ expose key ใน client)
// หรือถ้า proxy เดิมรองรับ — เรียกผ่าน callAI() proxy

async function ciTranscribe(audioBlob) {
  const form = new FormData();
  form.append('file', audioBlob, 'recording.webm');
  form.append('model', 'whisper-1');
  form.append('language', 'th');
  form.append('prompt', 'การสนทนาเรื่องวัตถุดิบอาหาร supplier ร้านอาหาร freshket');
  
  // ผ่าน proxy เดิมของ Sense หรือ Cloudflare Worker
  const res = await fetch('/api/whisper', { method: 'POST', body: form });
  const data = await res.json();
  return data.text; // Thai transcript string
}
```

### Skill Analysis Prompt (Claude Haiku)

```javascript
const SKILL_SYSTEM = `คุณคือ AI coach สำหรับ Freshket sales team
วิเคราะห์ transcript การสนทนาระหว่าง sales rep กับลูกค้าร้านอาหาร
แล้ว match กับ 14 skill cards ต่อไปนี้:

APIPC: PIPC Framework — ดูว่า rep ทำครบ Prepare→Investigate→Propose→Close
A5: Freshket Value — นำเสนอ value ไม่ lead ด้วยราคา
A9: Planning — กล่าวถึง plan/target/priority
A10: Pipeline — กล่าวถึง next step/stage/follow-up date
B2: Decision Maker — confirm authority ก่อน pitch
B3: Appointment — จบด้วย specific date
B4: Pre-Visit Prep — rep รู้ menu/context ก่อนถาม
C0: Rapport — ลูกค้าเปิดเผย pain เอง, rep ไม่ interrupt
C1: Discovery — cover ≥3/7 dimensions (Product/Price/Quality/Delivery/Completeness/Expansion/Credit)
C3: Connect Pain — link ลูกค้า pain → Freshket value ด้วยคำของลูกค้าเอง
C4: Objection — Acknowledge→Clarify→Reframe→Confirm sequence
C5: Close — restate pain + specific date + customer action
D1: Wallet Size — classify Hot/Warm/Cold with evidence
D2: Follow-Up — different strategy per account status

ตอบเป็น JSON เท่านั้น ไม่มี markdown ไม่มี preamble:
{
  "skills": [
    {
      "code": "C0",
      "score": "pass|developing|not_observed|not_applicable",
      "evidence_summary": "สิ่งที่ observe ได้ (ไม่ใช่ quote ตรงๆ)"
    }
  ],
  "pipc_stage": "P1|I|P2|C",
  "overall": "strong|developing|needs_work"
}`;
```

### Customer Intel Prompt (Claude Sonnet)

```javascript
function buildCustomerIntelPrompt(transcript, accountCtx) {
  return `วิเคราะห์ insight จากการสนทนานี้ โดยใช้ข้อมูลร้านอาหารต่อไปนี้ประกอบ:

ข้อมูลร้าน:
- ชื่อ: ${accountCtx.name}
- Segment: ${accountCtx.segment}
- GMV trend: ${accountCtx.gmv_trend}
- Category ที่ซื้ออยู่แล้ว: ${accountCtx.categories_bought.join(', ')}
- Category gap (ยังไม่ได้ซื้อ): ${accountCtx.category_gaps.join(', ')}
- อยู่กับ KAM นี้: ${accountCtx.days_with_current_kam} วัน

Transcript:
${transcript}

ตอบเป็น JSON เท่านั้น:
{
  "buyer_type": "price|relationship|value|convenience",
  "buyer_evidence": "เหตุผลสั้นๆ",
  "pain_points": [
    {"dimension": "Quality|Price|Delivery|...", "summary": "...", "severity": "high|medium|opportunity"}
  ],
  "dimensions_covered": ["Product","Price"],
  "upsell_signals": [{"item": "smoked salmon", "evidence": "..."}],
  "next_actions": [
    {"action": "...", "owner": "KAM|TL", "urgency": "3_days|this_week|next_visit"}
  ]
}`;
}
```

---

## UI Design Reference

### Token summary (อย่า guess — ใช้ตามนี้เท่านั้น)

```css
/* Surfaces */
--bg: #F2F2F7          /* page — warm gray */
--surface: rgba(255,255,255,0.72) + blur(24px)  /* glass card */
--surface-high: rgba(255,255,255,0.88) + blur(40px)  /* sheet */

/* Text — 3 ชั้นเท่านั้น */
--tx:  #1C1C1E   /* primary */
--tx2: #636366   /* secondary */  
--tx3: #AEAEB2   /* tertiary */

/* Accent — ≤5% visual area */
--ac: #008065    /* teal — text/icon/dot/line เท่านั้น ห้ามเป็น background */

/* Semantic */
--success: #34C759
--warning: #FF9500
--danger:  #FF3B30

/* Type scale — 2 worlds ไม่มีขนาดกลาง */
hero:  52px weight 200  tracking -0.04em
title: 16px weight 500  tracking -0.02em
body:  13px weight 400  tracking -0.01em
label: 10px weight 500  tracking 0.14em UPPERCASE mono

/* Motion */
user-initiated: ≤120ms cubic-bezier(0.16,1,0.3,1)
ambient/state:  ≥350ms cubic-bezier(0.16,1,0.3,1)
```

### Anti-patterns (check ก่อน push ทุกครั้ง)

```
✕ card border ที่เห็นชัด → glass border 0.5px + shadow inset เท่านั้น
✕ teal background ใดๆ → teal เป็นแค่ text/icon/dot/line
✕ button border → ghost btn ใช้ rgba background ไม่มี border
✕ tab fill เต็ม cell → sliding pill indicator เท่านั้น
✕ spinner วงกลม → 3-dot stagger เท่านั้น
✕ font-weight 600/700 → max 500 (timer ใช้ 200)
✕ icon ใน colored box → icon ลอยกับ text โดยตรง
```

### Mockup reference

`ci_mockup_v2.html` — interactive prototype ครบ 3 screens
อ่านเพื่อ extract HTML/CSS structure เข้า CI_UI_SHEET section

---

## Credentials & APIs

### GitHub
```
Repo:   github.com/boonwirat-glitch/cost-iq
Branch: main
Token:  ghp_***REDACTED_SEE_BUCCI***

Read file:  GET https://api.github.com/repos/boonwirat-glitch/cost-iq/contents/{path}?ref=main
Write file: PUT https://api.github.com/repos/boonwirat-glitch/cost-iq/contents/{path}
            body: { message, content (base64), sha (fetch fresh ก่อนทุก PUT) }
```

### Supabase
```
URL:  https://menslbnyyvpxiyvjywcm.supabase.co
Key:  sb_publishable_DRCzHd782Gry8Edu4ZIiHA_KuOgBIIG
Tables: kam_visits, kam_skill_log, user_profiles
```

### Cloudflare Pages
```
Hosting: Freshket Sense PWA
Build:   python3 build.py → dist/sense_v{N}.html
Deploy:  push index.html + sw.js (Cloudflare auto-deploy จาก GitHub main)
R2:      freshket-sense bucket — CSV data files
```

### OpenAI (Whisper)
```
Key:   เก็บใน Cloudflare Pages env var: OPENAI_API_KEY
       (Claude ไม่เห็น key นี้ — ต้อง route ผ่าน Worker)
Model: whisper-1
```

---

## กฎการทำงาน (mandatory)

```
1. สร้าง snapshot branch ก่อนเสมอ:
   snapshot/pre-ci-module-v{SW_VERSION}

2. อ่านไฟล์ผ่าน blob API เท่านั้น:
   https://api.github.com/repos/{REPO}/contents/{path}?ref=main
   content มา base64-encoded — decode ก่อนอ่าน

3. fetch SHA ก่อนทุก PUT:
   SHA เปลี่ยนทุก commit — ถ้าใช้ SHA เก่าจะได้ 409 conflict

4. node --check ทุก JS ก่อน push

5. ทุก commit: push src + rebuild index.html ด้วย build.py + bump SW version

6. build ทีละ SECTION ไม่ใช่ทีเดียว:
   เขียน section → verify logic → push → ทำ section ถัดไป

7. ไม่ต้องถามทีละ step — pre-authorized ให้ทำต่อเนื่อง
   หยุดถามเฉพาะถ้าพบ ambiguity ที่ไม่มีใน handoff นี้
```

---

## Build Order (6 steps)

```
Step 0: Supabase migration
        → รัน SQL ด้านบนใน Supabase dashboard
        → verify table ด้วย SELECT * FROM kam_skill_log LIMIT 1

Step 1: Snapshot branch
        → snapshot/pre-ci-module-v{current_SW}

Step 2: สร้าง 09_conv_intel.js ทีละ section
        → CI_RECORDER → CI_TRANSCRIBE → CI_SKILL_ANALYSIS
        → CI_CUSTOMER_INTEL → CI_STORAGE → CI_UI_SHEET
        → CI_TL_DEBRIEF → CI_HISTORY

Step 3: แก้ build.py
        → เพิ่ม 09_conv_intel.js ท้าย build order

Step 4: แก้ 06_portview_teamview.js (surgical)
        → เพิ่มปุ่ม CI ใน account view HTML
        → ไม่แตะ logic อื่น

Step 5: bump SW + push ทุก file + build index.html

Step 6: deploy → test on device (iOS Safari)
        → verify: recording starts, processing shows, result renders
        → verify: Supabase rows เพิ่มหลัง save
```

---

## Integration กับ Sense ที่มีอยู่

```javascript
// ใช้ของที่มีอยู่แล้ว — ไม่สร้างใหม่

callAI(model, system, messages, maxTokens)  // ใน 04_sku_matcher.js
currentUserProfile                           // email, role
getCurrentRole()                             // 'rep'|'tl'|'admin'
portviewBulkData                             // account context
trackVisit(accountId, mode)                  // VISIT_TRACKING section
supa                                         // Supabase client

// Entry point: เพิ่มใน renderPortviewSummary หรือ account header
// ปุ่ม: <button onclick="ciOpen(accountGuid)">🎙 บันทึกการสนทนา</button>
```

---

## Rollout Plan

```
Phase 1 (สัปดาห์ 1-2): Voice Note 60s เท่านั้น
  → transcribe → next actions only (ไม่มี skill scoring)
  → วัด: KAM ใช้จริง? transcript quality?

Phase 2 (สัปดาห์ 3-4): Full Record + Skill AI
  → skill scores เป็น "AI suggestion" ไม่ใช่ official
  → TL ต้อง confirm ก่อน save

Phase 3 (สัปดาห์ 5-6): TL Shadow Mode
  → TL debrief sheet
  → skill history dashboard
```

---

## Skill Definitions (14 skills — อ่านจาก playbook)

```
APIPC  PIPC Framework         P→I→P→C sequence
A5     Freshket Value         value presentation, not price-led
A9     Planning               target/plan/priority mentions
A10    Pipeline               next step/stage/date mentions
B2     Decision Maker         authority confirm before pitch
B3     Appointment            end with specific date
B4     Pre-Visit Prep         rep knows menu/context pre-questions
C0     Rapport                customer self-discloses pain
C1     Discovery              ≥3/7 dimensions covered
C3     Connect Pain           customer words → Freshket value
C4     Objection              A→C→R→C sequence
C5     Close                  pain restate + date + customer action
D1     Wallet Size            Hot/Warm/Cold with evidence
D2     Follow-Up              different strategy per status
```

Score: pass | developing | not_observed | not_applicable

---

*handoff สร้างเมื่อ June 2026 — push ไฟล์นี้เข้า docs/CI_HANDOFF.md ใน repo ด้วย*
