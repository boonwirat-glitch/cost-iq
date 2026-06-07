-- ══════════════════════════════════════════════════════════════
-- echo_skill_observations — Phase 0
-- Bridge table: Echo AI assessment → Skills feature
-- Run in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.echo_skill_observations (
  id            SERIAL PRIMARY KEY,
  session_id    UUID         REFERENCES public.ci_sessions(id) ON DELETE SET NULL,
  user_id       UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_code    TEXT         NOT NULL,   -- matches skill_definitions.skill_code e.g. 'B04_PREVISIT'
  echo_code     TEXT         NOT NULL,   -- echo internal code e.g. 'B4'
  ai_score      TEXT         NOT NULL CHECK (ai_score IN ('pass','developing','not_observed','not_applicable')),
  evidence      TEXT,                    -- AI evidence summary
  coaching_note TEXT,                    -- AI coaching note for TL
  gap           TEXT,                    -- AI gap analysis
  observed_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS echo_obs_user_idx  ON public.echo_skill_observations (user_id);
CREATE INDEX IF NOT EXISTS echo_obs_skill_idx ON public.echo_skill_observations (skill_code);
CREATE INDEX IF NOT EXISTS echo_obs_date_idx  ON public.echo_skill_observations (observed_at DESC);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.echo_skill_observations ENABLE ROW LEVEL SECURITY;

-- Rep: อ่านของตัวเองเท่านั้น
DROP POLICY IF EXISTS "echo_obs_rep_read"  ON public.echo_skill_observations;
CREATE POLICY "echo_obs_rep_read"  ON public.echo_skill_observations
  FOR SELECT USING (auth.uid() = user_id);

-- Rep: เขียนของตัวเอง (auto-send from Echo)
DROP POLICY IF EXISTS "echo_obs_rep_write" ON public.echo_skill_observations;
CREATE POLICY "echo_obs_rep_write" ON public.echo_skill_observations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- TL/admin: อ่านทุก row ของ team
DROP POLICY IF EXISTS "echo_obs_tl_read"  ON public.echo_skill_observations;
CREATE POLICY "echo_obs_tl_read"  ON public.echo_skill_observations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('sales_tl','tl','admin')
    )
  );

-- ── Verify ───────────────────────────────────────────────────
SELECT 'echo_skill_observations created' AS status,
       count(*) AS rows
FROM public.echo_skill_observations;
