-- ══════════════════════════════════════════════
-- SKILLS FEATURE — Supabase Schema
-- Run in Supabase SQL Editor (freshket-sense)
-- ══════════════════════════════════════════════

-- 1. skill_definitions (static master, 14 rows seeded separately)
CREATE TABLE IF NOT EXISTS skill_definitions (
  id           SERIAL PRIMARY KEY,
  module       CHAR(1) NOT NULL CHECK (module IN ('A','B','C','D')),
  skill_code   TEXT NOT NULL UNIQUE,        -- e.g. 'A01_PIPC'
  skill_name_th TEXT NOT NULL,
  skill_name_en TEXT NOT NULL,
  principle_th  TEXT,
  practice_th   TEXT,
  pass_test_th  TEXT,
  card_image_url TEXT,                      -- R2 path: /skills/A01_navigator_pipc.webp
  sort_order    SMALLINT NOT NULL DEFAULT 0
);

-- 2. user_skill_progress (1 row per user × skill)
CREATE TABLE IF NOT EXISTS user_skill_progress (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_id      INT  NOT NULL REFERENCES skill_definitions(id) ON DELETE CASCADE,
  state         TEXT NOT NULL DEFAULT 'locked'
                  CHECK (state IN ('locked','training','unlocked','mastered')),
  evaluated_by  UUID REFERENCES auth.users(id),   -- TL who last changed state
  evaluated_at  TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, skill_id)
);

-- 3. skill_eval_log (audit trail — every state change)
CREATE TABLE IF NOT EXISTS skill_eval_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  progress_id   UUID NOT NULL REFERENCES user_skill_progress(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,              -- rep
  skill_id      INT  NOT NULL,
  old_state     TEXT NOT NULL,
  new_state     TEXT NOT NULL,
  changed_by    UUID NOT NULL,             -- who made the change (rep or TL)
  changed_at    TIMESTAMPTZ DEFAULT NOW(),
  comment       TEXT
);

-- ── INDEXES ──
CREATE INDEX IF NOT EXISTS idx_usp_user    ON user_skill_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_usp_skill   ON user_skill_progress(skill_id);
CREATE INDEX IF NOT EXISTS idx_usp_state   ON user_skill_progress(state);
CREATE INDEX IF NOT EXISTS idx_sel_prog    ON skill_eval_log(progress_id);
CREATE INDEX IF NOT EXISTS idx_sel_user    ON skill_eval_log(user_id);

-- ── ROW LEVEL SECURITY ──
ALTER TABLE skill_definitions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_skill_progress    ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_eval_log         ENABLE ROW LEVEL SECURITY;

-- skill_definitions: everyone can read, nobody can write (seed via service role)
CREATE POLICY "skill_def_read_all"
  ON skill_definitions FOR SELECT USING (true);

-- user_skill_progress: rep sees own rows, TL sees team rows
CREATE POLICY "usp_rep_own"
  ON user_skill_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "usp_tl_team"
  ON user_skill_progress FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('sales_tl','tl','admin')
    )
  );

-- rep can insert/update only own row, only locked→training
CREATE POLICY "usp_rep_self_training"
  ON user_skill_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id AND state = 'training');

-- TL can update any row (training→unlocked, unlocked→mastered, downgrade)
CREATE POLICY "usp_tl_update"
  ON user_skill_progress FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('sales_tl','tl','admin')
    )
  );

-- skill_eval_log: rep sees own, TL sees team
CREATE POLICY "sel_rep_own"
  ON skill_eval_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "sel_tl_team"
  ON skill_eval_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('sales_tl','tl','admin')
    )
  );

-- anyone authenticated can insert log (rep self-mark + TL eval both write here)
CREATE POLICY "sel_insert_auth"
  ON skill_eval_log FOR INSERT
  WITH CHECK (auth.uid() = changed_by);

-- ── updated_at trigger ──
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER usp_updated_at
  BEFORE UPDATE ON user_skill_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
