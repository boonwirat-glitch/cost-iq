-- ════════════════════════════════════════════════════════════════════════════
-- SUPABASE SEED — squad_params (run ONCE in Supabase SQL editor, NOT BigQuery)
-- Purpose: TL → squad (chain | sa_mc) mapping for the /nrr company overview
--          section. Read by the /nrr app via nrrFetchCommissionRates()'s
--          existing target_settings fetch (any '*_params' key is auto-parsed).
-- Safety:  INSERT ... ON CONFLICT DO NOTHING — never updates an existing key,
--          re-running is a no-op. Edit later via Supabase directly or (future)
--          the Sense Commission Cockpit.
-- Shape:   head_email is present but unused this round — reserved for the
--          head-of-squad commission build. tl_emails drive KAM→squad
--          classification (a KAM inherits their TL's squad).
-- Fallback: if this key is missing/unreadable, /nrr falls back to the
--          hardcoded TL_BUCKET_MAP in nrr_aggregate.js (same values as below).
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO target_settings (key, value, updated_by)
VALUES (
  'squad_params',
  '{"version":1,"squads":{"chain":{"label":"Chain","head_email":"","tl_emails":["nitipat.s@freshket.co"]},"sa_mc":{"label":"SA/MC","head_email":"","tl_emails":["pavarisa.mu@freshket.co"]}}}',
  'boonwirat.t@freshket.co'
)
ON CONFLICT (key) DO NOTHING;
