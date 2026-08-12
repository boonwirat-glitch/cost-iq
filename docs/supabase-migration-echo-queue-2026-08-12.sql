-- docs/supabase-migration-echo-queue-2026-08-12.sql
--
-- v_queue: ทำ ci_sessions ให้เป็น "คิวงาน" จริง
--
-- ทำไม: ก่อนหน้านี้ pipeline ของ Echo ไม่มีชิ้นส่วนที่คิวงานทุกตัวต้องมีเลยสักอย่าง
--   1. ไม่มีสถานะจบแบบล้มเหลว  → ไฟล์เสียงพังถาวรวนลองใหม่ตลอดกาล
--   2. ไม่มีตัวนับความพยายาม   → ไม่มีเพดานว่าเมื่อไหร่ควรยอมแพ้
--   3. ไม่มีเวลานัดลองใหม่     → error handler เคลียร์ claim ทันที แถวกลับเข้าคิว
--                                ใน tick ถัดไป (2 นาที) เผาโควตา Groq จนไฟล์ดี
--                                ก็ถอดไม่ผ่าน — นี่คือต้นเหตุจริงของ 12 ส.ค. 2026
--
-- ⚠ สถานะนี้ APPLIED ไปแล้วบน project menslbnyyvpxiyvjywcm (freshket-costiq)
--   ไฟล์นี้เก็บไว้เป็นบันทึกและให้รันซ้ำได้ปลอดภัย (idempotent)

-- ── 1. สองคอลัมน์ที่ทำให้คิวหมุนเองได้ ──────────────────────────────────────
alter table public.ci_sessions
  add column if not exists attempts        integer default 0,
  add column if not exists next_attempt_at timestamptz;

comment on column public.ci_sessions.attempts is
  'จำนวนครั้งที่ลองแล้วล้มเหลวแบบชั่วคราว · ครบ MAX_ATTEMPTS (4) = จบที่ failed_system · '
  'การโดนจำกัดอัตรา (429) ไม่นับ เพราะไม่ใช่ความผิดของ session นี้';
comment on column public.ci_sessions.next_attempt_at is
  'เวลานัดลองใหม่ · sweepPending หยิบเฉพาะแถวที่ถึงเวลาแล้ว และเรียงตามคอลัมน์นี้ '
  '(nullsfirst) — งานใหม่มาก่อน งานที่เพิ่งล้มไปต่อท้าย จึงไม่มีแถวไหนผูกขาดคิวได้';

-- ── 2. ดัชนีให้ sweep หยิบงานถูกแถวโดยไม่ต้องอ่านทั้งตาราง ─────────────────
-- sweep ถามแค่ 2 stage นี้เท่านั้น แถว pending/analyzed/failed_* ไม่ต้องอยู่ในดัชนี
create index if not exists ci_sessions_queue_idx
  on public.ci_sessions (next_attempt_at nulls first, visited_at)
  where pipeline_stage in ('uploaded', 'transcribed');

-- ── 3. สถานะจบใหม่: ไม่ต้องทำอะไร แต่บันทึกไว้ว่ามีอะไรบ้าง ────────────────
-- pipeline_stage เป็น text ไม่มี CHECK constraint (ตรวจแล้ว 12 ส.ค. 2026 — มีแค่
-- ci_sessions_owner_type_check กับ ci_sessions_status_check) จึงเพิ่มค่าใหม่ได้เลย
-- ค่าที่ใช้ทั้งหมด:
--   checked_in  → เช็คอินแล้ว ยังไม่อัด            (ทางจบปกติของ visit ที่ไม่อัดเสียง)
--   pending     → แถวเก่าก่อนมี pipeline           (sweep ไม่แตะ)
--   uploaded    → มีไฟล์เสียงรอถอด                 (คิว: stage ถอดเสียง)
--   transcribed → ถอดแล้วรอวิเคราะห์               (คิว: stage วิเคราะห์)
--   analyzed    → เสร็จสมบูรณ์                     ★ ทางจบ
--   no_speech   → ถอดแล้วไม่มีเสียงพูด             ★ ทางจบ
--   failed_audio  → ไฟล์เสียงใช้ไม่ได้ถาวร          ★ ทางจบใหม่ (v_queue)
--   failed_system → ระบบยอมแพ้หลังลองครบงบ         ★ ทางจบใหม่ (v_queue)

-- ── 4. ตรวจว่าลงครบ ────────────────────────────────────────────────────────
-- select column_name, data_type, column_default
--   from information_schema.columns
--  where table_schema='public' and table_name='ci_sessions'
--    and column_name in ('attempts','next_attempt_at');
