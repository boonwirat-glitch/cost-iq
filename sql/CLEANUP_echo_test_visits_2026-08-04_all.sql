-- ============================================================
-- ลบข้อมูลทดสอบ Echo ทั้งหมดของวันนี้ (4 ส.ค. 2026)
-- รันบน Supabase (Postgres) — ไม่ใช่ BigQuery
--
-- ครอบคลุม 4 แถวที่เกิดจากการทดสอบฟีเจอร์ Echo วันนี้ (owner = guntinun.t@freshket.co):
--   11:05 บริษัท โยโยเล จำกัด        — transcribed ค้าง (analysis หลุดไปแถวกำพร้า)
--   11:07 (ไม่มีชื่อร้าน)             — แถวกำพร้าจากบั๊ก v950 (analysis ของโยโยเลนั่นเอง)
--   11:07 บริษัท เกียวโต ฟุคุนากะ จำกัด — เช็คอินเปล่า
--   11:38 บริษัท เกียวโต ฟุคุนากะ จำกัด — เช็คอินเปล่า (เทส check-in-reliability)
--
-- ไม่รวม: niracha.s@freshket.co เช็คอิน 11:36 (โคชิดากะ) — เป็นการใช้งานจริงของ
-- น้อง rep ไม่ใช่ข้อมูลทดสอบ ห้ามลบ
--
-- Block 1 = ตรวจก่อน (อ่านอย่างเดียว) — ต้องเห็น owner_email เป็น guntinun.t
--           ทั้ง 4 แถวใน ci_sessions เท่านั้น (niracha.s ต้องไม่โผล่)
-- Block 2 = ลบจริง (ลูกก่อนแม่)
-- ============================================================


-- Block 1: ตรวจก่อนลบ
SELECT id, owner_email, account_name, visited_at, pipeline_stage, status
FROM ci_sessions
WHERE id IN ('a747cc33-5417-484b-afda-2f236280571d',
             'da62871a-ef0f-4e95-80b4-ff3704f08095',
             '736ca8f9-d8e2-4075-8d8a-3326f466c6de',
             '7bdb2c32-a161-4e43-a449-7b1457c9b338')
ORDER BY visited_at;

SELECT kam_email, account_id, ci_session_id
FROM kam_visits
WHERE ci_session_id IN ('a747cc33-5417-484b-afda-2f236280571d',
                        'da62871a-ef0f-4e95-80b4-ff3704f08095',
                        '736ca8f9-d8e2-4075-8d8a-3326f466c6de',
                        '7bdb2c32-a161-4e43-a449-7b1457c9b338');

SELECT id, session_id, skill_code FROM echo_skill_observations
WHERE session_id IN ('a747cc33-5417-484b-afda-2f236280571d',
                     'da62871a-ef0f-4e95-80b4-ff3704f08095',
                     '736ca8f9-d8e2-4075-8d8a-3326f466c6de',
                     '7bdb2c32-a161-4e43-a449-7b1457c9b338');

SELECT id, ci_session_id, skill_code FROM kam_skill_log
WHERE ci_session_id IN ('a747cc33-5417-484b-afda-2f236280571d',
                        'da62871a-ef0f-4e95-80b4-ff3704f08095',
                        '736ca8f9-d8e2-4075-8d8a-3326f466c6de',
                        '7bdb2c32-a161-4e43-a449-7b1457c9b338');


-- Block 2: ลบจริง (ลูกก่อนแม่)
DELETE FROM echo_skill_observations
WHERE session_id IN ('a747cc33-5417-484b-afda-2f236280571d',
                     'da62871a-ef0f-4e95-80b4-ff3704f08095',
                     '736ca8f9-d8e2-4075-8d8a-3326f466c6de',
                     '7bdb2c32-a161-4e43-a449-7b1457c9b338');

DELETE FROM kam_skill_log
WHERE ci_session_id IN ('a747cc33-5417-484b-afda-2f236280571d',
                        'da62871a-ef0f-4e95-80b4-ff3704f08095',
                        '736ca8f9-d8e2-4075-8d8a-3326f466c6de',
                        '7bdb2c32-a161-4e43-a449-7b1457c9b338');

DELETE FROM kam_visits
WHERE ci_session_id IN ('a747cc33-5417-484b-afda-2f236280571d',
                        'da62871a-ef0f-4e95-80b4-ff3704f08095',
                        '736ca8f9-d8e2-4075-8d8a-3326f466c6de',
                        '7bdb2c32-a161-4e43-a449-7b1457c9b338');

DELETE FROM ci_sessions
WHERE id IN ('a747cc33-5417-484b-afda-2f236280571d',
             'da62871a-ef0f-4e95-80b4-ff3704f08095',
             '736ca8f9-d8e2-4075-8d8a-3326f466c6de',
             '7bdb2c32-a161-4e43-a449-7b1457c9b338');
