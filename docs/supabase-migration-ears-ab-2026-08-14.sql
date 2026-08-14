-- docs/supabase-migration-ears-ab-2026-08-14.sql
--
-- v_ears P0: คอลัมน์ชั่วคราวสำหรับเทียบโมเดลถอดเสียง (Gemini vs Whisper)
--
-- ⚠ ตั้งใจให้เป็นของชั่วคราว — **ลบทิ้งเมื่อเคาะโมเดลแล้ว** พร้อมกับ
--   sweepAbGemini() ใน worker และ endpoint /ab-gemini
--
-- ทำไมต้องมีคอลัมน์แทนที่จะยิง HTTP ตรงๆ: แค่ขั้นโหลดไฟล์เสียง 9MB จาก
-- storage แล้วอัปเข้า Gemini Files API ก็เกิน 100 วินาที ซึ่งเป็นเพดานของ
-- คำขอผ่านเว็บของ Cloudflare (โดน 524 สามรอบ) · cron ได้เวลาเป็นนาทีจึงทำได้
-- → สั่งงานผ่าน DB แล้วให้ cron หยิบไปทำ
--
-- ⚠ APPLIED แล้วบน menslbnyyvpxiyvjywcm (freshket-costiq)

alter table public.ci_sessions
  add column if not exists ab_gemini jsonb;

comment on column public.ci_sessions.ab_gemini is
  'v_ears P0 ชั่วคราว: ผลถอดเสียงจาก Gemini แบบ single-pass เก็บไว้เทียบกับ transcript ของ Whisper · ตั้งเป็น {"requested":true} เพื่อสั่งให้ cron ทำ · ลบคอลัมน์นี้ทิ้งเมื่อเคาะโมเดลแล้ว';

-- สั่งรันเทียบ 1 คลิป:
--   update ci_sessions set ab_gemini='{"requested":true}'::jsonb where id='<uuid>';
-- ดูผล:
--   select ab_gemini->>'status', jsonb_array_length(ab_gemini->'segments') from ci_sessions where id='<uuid>';
--
-- ลบทิ้งเมื่อจบ P0:
--   alter table public.ci_sessions drop column if exists ab_gemini;
