-- v_listen (2026-08-16) — APPLIED แล้วผ่าน Supabase MCP
-- สลับหูเป็น Gemini: คลิปยาวต้องถอดทีละช่วงหลายรอบ (เพดาน ~128 วิต่อคำขอ)
-- จึงต้องจำได้ว่าทำถึงไหน เพื่อให้งานเดินข้าม cron tick โดยไม่เริ่มใหม่จากการอัปไฟล์
alter table ci_sessions add column if not exists listen_state jsonb;

comment on column ci_sessions.listen_state is
  'สถานะการถอดเสียงด้วย Gemini ระหว่างทาง: file_uri, ช่วงเวลาที่ต้องถอด, ช่วงที่ทำถึงแล้ว, จำนวนครั้งที่ลอง — เคลียร์เป็น null เมื่อถอดจบ';
