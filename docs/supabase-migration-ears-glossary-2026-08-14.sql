-- docs/supabase-migration-ears-glossary-2026-08-14.sql
--
-- v_ears: ส่งชื่อสินค้าที่ร้านนี้ซื้อประจำเข้า Whisper เพื่อให้สะกดคำเฉพาะถูก
--
-- ทำไม: Whisper รับพารามิเตอร์ `prompt` ไว้ "ใบ้" การสะกดคำเฉพาะ แต่ของเดิม
-- ใส่แค่ 6 คำคงที่ ทั้งที่เรามีรายชื่อสินค้าของร้านนั้นอยู่ในมือแล้ว
-- (bulkSkusData ฝั่ง client) ผลคือคำอย่าง "เพคโคริโน" / "พิคานย่า" เพี้ยนทุกครั้ง
--
-- ⚠ APPLIED แล้วบน menslbnyyvpxiyvjywcm (freshket-costiq) — เก็บไว้เป็นบันทึก
-- และให้รันซ้ำได้ปลอดภัย

alter table public.ci_sessions
  add column if not exists sku_glossary text;

comment on column public.ci_sessions.sku_glossary is
  'v_ears: ชื่อสินค้าที่ร้านนี้ซื้อประจำ เรียงตาม GMV คั่นด้วยเว้นวรรค — client เขียนตอนอัปเสียง, worker ส่งต่อเข้า Whisper prompt (เพดาน prompt 224 token จึงคุมความยาวที่ ~260 อักษรตั้งแต่ฝั่ง client)';

-- ตรวจ:
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='ci_sessions' and column_name='sku_glossary';
