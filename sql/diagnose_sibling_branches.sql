-- ════════════════════════════════════════════════════════════════════════════
-- Diagnostic: are this business's "other branches" actually registered as
-- SEPARATE account_guid values in dim.user_master, rather than as
-- additional outlets/res_id under the SAME account_guid we already checked?
-- If so, the "1 สาขา" figure is technically correct per account_guid, but
-- the app has no way to group sibling accounts together as one chain.
-- ════════════════════════════════════════════════════════════════════════════

DECLARE v_name_pattern STRING DEFAULT '%Nam Nam%';  -- adjust to match the chain's name

SELECT
  CAST(um.account_guid AS STRING) AS account_id,
  CAST(um.res_id AS STRING)       AS res_id,
  um.res_name,
  um.account_name,
  um.commercial_owner,
  um.staff_owner_email,
  um.account_type,
  um.lasted_order_date
FROM `freshket-rn.dim.user_master` um
WHERE um.res_name LIKE v_name_pattern OR um.account_name LIKE v_name_pattern
ORDER BY um.account_guid, um.lasted_order_date DESC;

-- Read this as: if multiple DIFFERENT account_guid values show up, each with
-- its own 1 res_id, that confirms the hypothesis — this chain's branches are
-- registered as independent accounts, not grouped under one parent account
-- with multiple outlets. That's a data-model/onboarding characteristic, not
-- a bug in Q5B_bulk_outlets.sql or the app's outlet-count logic — the fix
-- (if wanted) would be a much bigger feature: teaching the app to group
-- multiple account_guids together as one "chain" by name/brand, which
-- doesn't exist anywhere in the current schema. Worth a product discussion,
-- not a quick SQL patch.
--
-- If instead this comes back with only the 1 account_guid/res_id we already
-- found: the other physical branches you know about may not be Freshket
-- customers at all yet (not onboarded), or go by a different registered
-- name than expected — try a looser LIKE pattern, or search by a known
-- phone number/address fragment instead if the business name varies a lot
-- branch to branch.
