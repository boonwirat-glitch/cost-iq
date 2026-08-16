-- docs/supabase-migration-key-skus-outlet-uidx-2026-08-16.sql
--
-- Widen the key_skus active-row unique index from (account_id, sku_id) to
-- (account_id, outlet_id, sku_id). Bush: supply planning needs Key SKU rows
-- broken out by outlet (res_name/res_id = outlet_name/outlet_id), not just by
-- billing account — a "Key SKU" marked for an account must apply to every
-- outlet under it, so the client now inserts one row per outlet instead of
-- one row per account. The old 2-column unique index would reject that
-- (same account_id+sku_id, different outlet_id) as a duplicate.
--
-- Safe to run any time: key_skus has 0 rows in production as of 2026-08-16
-- (feature just shipped, no real writes yet) — zero data-loss risk.

DROP INDEX IF EXISTS key_skus_active_uidx;

CREATE UNIQUE INDEX key_skus_active_uidx
  ON key_skus (account_id, outlet_id, sku_id)
  WHERE status = 'active';
