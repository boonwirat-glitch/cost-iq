-- ════════════════════════════════════════════════════════════════════════════
-- Diagnostic: why does an account show only 1 "สาขา" in /nrr when it should
-- have more? Checks dim.user_master directly (bypasses the KAM-roster/
-- commercial_owner filters that sql/Q5B_bulk_outlets.sql applies) so we can
-- see EVERY outlet actually registered under this account_guid, and exactly
-- which filter condition drops the missing ones.
-- ════════════════════════════════════════════════════════════════════════════

DECLARE v_account_id STRING DEFAULT 'd1112463-a897-4944-8fed-9df7591c20b5';  -- Nam Nam Pasta & Tapas — confirmed real multi-branch chain

SELECT
  CAST(um.res_id AS STRING) AS res_id,
  um.res_name,
  um.commercial_owner,
  um.staff_owner_email,
  um.account_type,
  um.lasted_order_date,
  -- flags showing exactly which Q5B/Q8E filter would exclude this row
  IF(um.commercial_owner != 'KAM', 'EXCLUDED: commercial_owner != KAM', 'ok') AS check_commercial_owner,
  IF(um.account_type NOT IN ('SA','MC','Chain','Unknown'), 'EXCLUDED: account_type not in allowed list', 'ok') AS check_account_type,
  IF(um.staff_owner_email IS NULL, 'EXCLUDED: staff_owner_email is NULL', 'ok') AS check_email_present
FROM `freshket-rn.dim.user_master` um
WHERE CAST(um.account_guid AS STRING) = v_account_id
ORDER BY um.lasted_order_date DESC;

-- Read this as: every row here is a real outlet Freshket's own dimension
-- table thinks belongs to this account. If more than 1 row comes back but
-- /nrr only shows 1, whichever rows have a non-'ok' check_* value are the
-- ones silently dropped by Q5B_bulk_outlets.sql's kam_outlets CTE — that
-- tells us exactly which condition to fix (or whether it's a real KAM-roster
-- gap — e.g. a branch whose staff_owner_email belongs to a KAM not in the
-- hardcoded 15-person list in Q5B/Q8E/Q9B/Q12B, which would need adding that
-- KAM to the list, not a logic fix).
--
-- If only 1 row comes back here too: this account genuinely has only 1
-- outlet registered in dim.user_master, and "CHAIN" is describing the
-- account's business classification (e.g. a franchise brand), not a literal
-- promise of multiple physical branches on Freshket's own outlet roster —
-- not a bug, just a naming expectation mismatch. Worth cross-checking
-- against whatever system/spreadsheet told you this account has more
-- branches, since that system's outlet count may not be 1:1 with
-- dim.user_master's res_id grain either.
