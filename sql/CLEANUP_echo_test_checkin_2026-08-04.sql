-- ============================================================
-- ลบข้อมูลทดสอบเช็คอิน Echo (ตอน verify ฟีเจอร์ ECHO-G1, 4 ส.ค. 2026)
-- รันบน Supabase (Postgres) — ไม่ใช่ BigQuery
--
-- แถวเดียวที่ตรง: ci_sessions ร้าน "เครือ Mickey Diner" เช็คอิน 4 ส.ค. 08:29
-- (owner_email = duangruedee.bu@freshket.co เพราะทดสอบผ่าน session ของ Ning)
-- + แถว kam_visits ที่ผูกกับ ci_session_id เดียวกัน (upsert ตอนเช็คอิน)
--
-- Block 1 = ตรวจก่อน (อ่านอย่างเดียว) — ต้องเห็น 1 แถวต่อตาราง
-- Block 2 = ลบจริง — รันเฉพาะถ้า Block 1 ตรงกับที่คาดไว้
-- ============================================================


-- ── Block 1: ตรวจก่อนลบ ─────────────────────────────────────
SELECT id, owner_email, account_name, visited_at, checked_in_at, pipeline_stage, status
FROM ci_sessions
WHERE id = '1777e010-76a9-431b-96ff-ec9dab67ee23';

SELECT kam_email, account_id, ci_session_id, ci_created_at, modes
FROM kam_visits
WHERE ci_session_id = '1777e010-76a9-431b-96ff-ec9dab67ee23';


-- ── Block 2: ลบจริง ─────────────────────────────────────────
DELETE FROM kam_visits
WHERE ci_session_id = '1777e010-76a9-431b-96ff-ec9dab67ee23';

DELETE FROM ci_sessions
WHERE id = '1777e010-76a9-431b-96ff-ec9dab67ee23';
