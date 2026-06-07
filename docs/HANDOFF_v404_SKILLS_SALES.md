# Handoff — Skills & Sales Features
## App version: v404 | Date: 2026-06-07

---

## 1. Current state — what's done

### Skills feature (11_skills.js + styles_skills.css)

**DB — Supabase (menslbnyyvpxiyvjywcm.supabase.co)**

3 tables ครบ + RLS + seed data:
- `skill_definitions` — 14 rows (A01–D02), seed ด้วย `docs/skills_p0_supabase.sql`
- `user_skill_progress` — per (user × skill), มี `user_name` TEXT column (เพิ่ม session นี้)
- `skill_eval_log` — audit trail ทุก state change

`user_skill_progress` backfill แล้ว: ทั้ง 2 rows แสดง "Phongsakorn (Job) Jamputsa"

**Architecture — name lookup (แก้ปัญหา UUID แสดงแทนชื่อ)**

สาเหตุเดิม: `_loadSkillUsers` query `profiles` table แต่ RLS block TL อ่าน rows ของ team
วิธีแก้: denormalize — เก็บ `user_name` ใน `user_skill_progress` โดยตรง
- `skillsStartTraining()` บันทึก `user_name` จาก `currentUserProfile.kam_name` ด้วยทุกครั้ง
- `skillsTLSave()` เก็บ `user_name` ด้วยตอน TL mark pass
- `_skUserName(userId)` อ่านจาก `_skillProg[key].user_name` ก่อน → fallback `_skillUsers` → UUID slice

**State machine**
```
Locked → Training    (Rep self-mark, กด "เริ่มฝึก")
Training → Unlocked  (TL only)
Unlocked → Mastered  (TL only)
Downgrade → Training (TL only, note optional)
ไม่มีใครกลับไป Locked
```

**Guards ที่มีแล้ว**
- `skillsStartTraining`: skip ถ้า state !== 'locked' (ป้องกัน double-write)
- `skillsTLSave`: skip ถ้า state เหมือนเดิม AND ไม่มี note

**Image system**
- `skill_definitions.card_image_url` — ยัง NULL ทุกอัน, แสดง gradient placeholder
- เมื่อรูปพร้อม: อัพ PNG/WebP ขึ้น R2 `/skills/` folder แล้วรัน:
```sql
UPDATE public.skill_definitions SET card_image_url =
  'https://pub-12078d17646340808024e8cc95504995.r2.dev/skills/' || skill_code || '.png';
```
- ชื่อไฟล์ต้องตรงกับ skill_code: `A01_PIPC.png`, `A05_VALUE.png`, ... `D02_FOLLOWUP.png` (15 ไฟล์)
- ไม่ต้อง redeploy code ใดๆ หลัง UPDATE DB

**UX screens ที่ทำงานได้**
- Rep: Skills Home → Module Grid → Skill Detail (locked/training/unlocked/mastered)
- TL: Pending list → Eval sheet → Team Overview (By Rep / By Skill) → Rep Detail
- Nav dot badge แดง: ขึ้น/ลงตาม pending count realtime

---

### Sales feature (10_sales_view.js)

**Teamview runrate — แก้ session นี้**

เดิม: `teamRunrate = Σ(r.runrate ทุกร้าน)` — รวม handover
ใหม่: `teamRunrate = Σ(getSalesRunrate per rep)` — สุทธิเหมือน portview

Hero card แสดง:
- Label "Runrate ทีม (สุทธิ)"
- ถ้ามี handover ออกเดือนนี้: strip แดง "Handover ออกเดือนนี้ — −฿X"
- Rep rows: badge `−฿X HO` ถ้า rep มี handover

---

## 2. สิ่งที่ยังต้องทำ session หน้า

### Skills — Priority 1 (functional, รอแก้)

**State button icons** (ออกแบบแล้ว session นี้ แต่ยังไม่ implement)

4 icons ที่ตกลงกันไว้:
```
locked    → แม่กุญแจปิด (สีเทา)
training  → เปลวไฟ (สีน้ำเงิน #3B82F6)
unlocked  → โล่ + checkmark (สีเขียว #34C759)
mastered  → มงกุฎ (สีส้มทอง #FF9500)
```

ตอนนี้ปุ่มแสดงแค่ dot + ข้อความ ต้องแทน dot ด้วย SVG icon ใน `_renderTLEvalButtons()` หรือ `_skTLSelectState()`

ตำแหน่งใน code: `src/11_skills.js` → หา `sk-tl-btn` หรือ `stateButtons`

**RLS profiles — ไม่ต้องแก้แล้ว**

ปัญหาเดิมแก้ด้วย denormalization แล้ว อย่า add policy `profiles_tl_read_team` อีก (เคยทำแล้ว infinite recursion)

---

### Skills — Priority 2 (UX polish)

- **Module ring: training arc** — ตอนนี้แสดง dashed blue arc แต่ยังไม่ได้ test ว่า render ถูกต้องบน mobile จริง
- **"แจ้ง TL ขอรับการประเมิน" button** — ปัจจุบันแสดง toast เท่านั้น ไม่มี notification จริงไปหา TL (acceptable สำหรับ phase นี้)
- **Module character name ใน home screen** — แสดงเป็น "The Navigator / The Scout / The Consultant / The Growth Partner" ถูกต้องแล้ว

---

### Skills — รอ external input

- รูป 15 ใบ (PNG) — user จะส่งมาให้แปลง WebP + อัพ R2
- แนะนำใช้ squoosh.app แปลง PNG → WebP ก่อนอัพ ลด filesize 3-4x
- หลังอัพ: รัน SQL UPDATE card_image_url (ด้านบน) — ไม่ต้อง redeploy

---

## 3. Key files

| File | หน้าที่ |
|---|---|
| `src/11_skills.js` | Skills logic ทั้งหมด |
| `src/styles_skills.css` | Skills CSS |
| `src/10_sales_view.js` | Sales views รวม teamview |
| `src/05_kam_view.js` | showScreen() — มี 'skills' ใน mainEl hide list แล้ว |
| `docs/skills_p0_supabase.sql` | SQL สร้าง 3 tables + seed 14 skills |
| `sw.js` | Cache version v404 |

---

## 4. Deploy checklist (ทุก session)

```
1. แก้ src/ files
2. node --check src/ที่แก้.js
3. python3 build.py vXXX  (ใช้ version ถัดไปจาก v404)
4. ตรวจ "No unresolved placeholders"
5. push: src files + sw.js (bump version) + index.html
6. ใช้ Git Tree API สำหรับ index.html (ไฟล์ใหญ่ ~2.4MB)
```

---

## 5. Known issues (minor, ไม่ block launch)

- **ชื่อ rep ใน history log** — `skill_eval_log` ไม่มี `user_name` column, แสดง UUID ใน history ได้ (แต่ใน pending list และ eval sheet แสดงถูกแล้ว)
- **KAM role** — ยังไม่ได้ gate skills tab สำหรับ KAM (ตอนนี้ sales-only)
- **Sales TL skills tab** — ทำงานได้แต่ยังไม่ได้ test กับ TL account จริงในทีม (ทดสอบแค่ account Job ซึ่งเป็น rep)

---

## 6. Supabase quick reference

```
URL: https://menslbnyyvpxiyvjywcm.supabase.co
Tables: profiles, skill_definitions, user_skill_progress, skill_eval_log
R2 bucket: pub-12078d17646340808024e8cc95504995.r2.dev
R2 skills folder: /skills/
```
