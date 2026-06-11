-- ═══════════════════════════════════════════════════════════════════
-- echo_skill_observations — Echo × Skills bridge (v555 / session 6)
-- Echo เขียน observation ทุก skill หลังวิเคราะห์เสร็จ (09_conv_intel.js)
-- Skills อ่านไปแสดง: rep เห็นของตัวเอง, TL เห็น sparkline ใน rep detail (11_skills.js)
-- รันใน Supabase SQL Editor ครั้งเดียว
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS echo_skill_observations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid,                  -- ci_sessions.id (ไม่ใส่ FK — loose coupling, session อาจถูกลบ)
  user_id       uuid NOT NULL,         -- auth.users.id ของ rep เจ้าของเสียง
  skill_code    text NOT NULL,         -- mapped code เช่น A01_PIPC (ตรงกับ skill_definitions)
  echo_code     text,                  -- raw code จาก AI ก่อน map
  ai_score      text NOT NULL,         -- pass | developing | not_observed | not_applicable
  evidence      text,
  coaching_note text,
  gap           text,
  observed_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eso_user_time_idx  ON echo_skill_observations (user_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS eso_session_idx    ON echo_skill_observations (session_id);
CREATE INDEX IF NOT EXISTS eso_skill_idx      ON echo_skill_observations (skill_code);

ALTER TABLE echo_skill_observations ENABLE ROW LEVEL SECURITY;

-- rep เห็นของตัวเอง
CREATE POLICY "eso_rep_own"
  ON echo_skill_observations FOR SELECT
  USING (auth.uid() = user_id);

-- TL/Admin เห็นทั้งทีม (รวม ad_tl — สอดคล้อง _canDebrief ใน app)
CREATE POLICY "eso_tl_team"
  ON echo_skill_observations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('sales_tl','tl','ad_tl','admin')
    )
  );

-- rep insert ได้เฉพาะ row ของตัวเอง (Echo auto-save หลังวิเคราะห์)
CREATE POLICY "eso_insert_own"
  ON echo_skill_observations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ไม่มี UPDATE/DELETE policy โดยเจตนา — observation เป็น immutable evidence
