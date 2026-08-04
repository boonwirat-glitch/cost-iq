-- ============================================================
-- ลบข้อมูลทดสอบ Echo รอบบ่าย 4 ส.ค. 2026 (ทดสอบผ่าน account guntinun.t)
-- รันบน Supabase (Postgres) — ไม่ใช่ BigQuery
--
-- 3 แถว (เวลาไทย):
--   11:05 โยโยเล        — transcribed ค้าง (analysis หลุดไปแถวกำพร้า)
--   11:07 (ไม่มีชื่อร้าน) — แถวกำพร้าจากบั๊ก v950 (analysis ของโยโยเลนั่นเอง)
--   11:07 เกียวโต ฟุคุนากะ — เช็คอินเปล่า
--
-- Block 1 = ตรวจก่อน (อ่านอย่างเดียว) — ต้องเห็น 3 แถว owner=guntinun.t ทั้งหมด
-- Block 2 = ลบจริง
-- ============================================================


-- ── Block 1: ตรวจก่อนลบ ─────────────────────────────────────
SELECT id, owner_email, account_name, visited_at, pipeline_stage, status
FROM ci_sessions
WHERE id IN ('a747cc33-5417-484b-afda-2f236280571d',
             'da62871a-ef0f-4e95-80b4-ff3704f08095',
             '736ca8f9-d8e2-4075-8d8a-3326f466c6de');

SELECT kam_email, account_id, ci_session_id
FROM kam_visits
WHERE ci_session_id IN ('a747cc33-5417-484b-afda-2f236280571d',
                        'da62871a-ef0f-4e95-80b4-ff3704f08095',
                        '736ca8f9-d8e2-4075-8d8a-3326f466c6de');

SELECT id, session_id, skill_code FROM echo_skill_observations
WHERE session_id IN ('a747cc33-5417-484b-afda-2f236280571d',
                     'da62871a-ef0f-4e95-80b4-ff3704f08095');

SELECT id, ci_session_id, skill_code FROM kam_skill_log
WHERE ci_session_id IN ('a747cc33-5417-484b-afda-2f236280571d',
                        'da62871a-ef0f-4e95-80b4-ff3704f08095');


-- ── Block 2: ลบจริง (ลูกก่อนแม่) ────────────────────────────
DELETE FROM echo_skill_observations
WHERE session_id IN ('a747cc33-5417-484b-afda-2f236280571d',
                     'da62871a-ef0f-4e95-80b4-ff3704f08095',
                     '736ca8f9-d8e2-4075-8d8a-3326f466c6de');

DELETE FROM kam_skill_log
WHERE ci_session_id IN ('a747cc33-5417-484b-afda-2f236280571d',
                        'da62871a-ef0f-4e95-80b4-ff3704f08095',
                        '736ca8f9-d8e2-4075-8d8a-3326f466c6de');

DELETE FROM kam_visits
WHERE ci_session_id IN ('a747cc33-5417-484b-afda-2f236280571d',
                        'da62871a-ef0f-4e95-80b4-ff3704f08095',
                        '736ca8f9-d8e2-4075-8d8a-3326f466c6de');

DELETE FROM ci_sessions
WHERE id IN ('a747cc33-5417-484b-afda-2f236280571d',
             'da62871a-ef0f-4e95-80b4-ff3704f08095',
             '736ca8f9-d8e2-4075-8d8a-3326f466c6de');
