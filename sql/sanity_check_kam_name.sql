-- ════════════════════════════════════════════════════════════════════════════
-- Sanity check B: does this kam_name actually match dwh.order.ka_owner?
-- Run this FIRST if diagnose_expansion_cumulative.sql came back with 0 rows.
-- ════════════════════════════════════════════════════════════════════════════

DECLARE v_kam_name STRING DEFAULT 'REPLACE_ME';  -- e.g. 'Puttipong (Tape) Wanithaweewat'

SELECT
  o.ka_owner,
  COUNT(DISTINCT CAST(o.user_id AS STRING)) AS distinct_outlets,
  MIN(o.delivery_date) AS earliest_order,
  MAX(o.delivery_date) AS latest_order,
  COUNTIF(o.delivery_date >= '2026-07-01') AS orders_since_q3_start
FROM `freshket-rn.dwh.order` o
WHERE o.ka_owner = v_kam_name
GROUP BY 1;

-- If this returns 0 rows: v_kam_name doesn't match ANY value in ka_owner —
-- likely a formatting mismatch. Try copy-pasting the exact string from
-- portview.csv's kam_name column or Sense's own KAM picker, rather than
-- retyping it by hand (the "FirstName (Nickname) LastName" format has to
-- match exactly, including spacing).
-- If it returns a row but orders_since_q3_start is 0 or low: this KAM may
-- genuinely have little Q3 activity, or may have zero outlets whose VERY
-- FIRST-EVER order (across all history, any owner) landed in Q3 specifically
-- — that's the real definition of "Expansion," stricter than "new to this
-- KAM." A KAM whose "new" accounts this quarter are all handovers/transfers
-- from someone else would correctly show 0 Expansion GMV — that's not a bug,
-- try a KAM you know personally onboarded a genuinely brand-new outlet this
-- quarter if you want to see a non-zero result.
