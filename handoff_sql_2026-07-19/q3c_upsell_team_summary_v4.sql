-- ══════════════════════════════════════════════════════════════
-- Q3C Team Summary v8: sense_upsell_team.csv
--
-- v8: fixed a day-1-of-quarter miscalculation in v_m1_start (see the
-- SET statement below for the full explanation) — found during a repo-wide
-- commission-quarterly-alignment audit, 2026-07-13. Not an active bug on
-- any day except a literal quarter boundary; fixed before this file's
-- first real run rather than waiting to hit it.
--
-- 🔴 v7 BUG FIX (do not skip — this changes real payout numbers):
-- The v827-auto quarter-anchor change (commit 3213afa, 2026-07-06) correctly
-- redefined baseline_mo/lookback_start to FREEZE at the quarter's own base
-- month (Jun/May/Apr for all of Q3), but the CTEs that actually build the
-- "have they ever bought this before" baseline set were never updated to
-- match — they still bounded their window with `< current_mo` (correct
-- under the OLD rolling-MoM design, where lookback_start was ALWAYS exactly
-- 3 months before current_mo, but wrong now that current_mo drifts forward
-- every month within the quarter while baseline_mo doesn't). Consequence:
-- baseline silently grew to include July when evaluating August, July+Aug
-- when evaluating September — so an item bought new in July that simply
-- MAINTAINED the same level in August (no further growth) looked like it
-- was "already known" (fails P1) and its own July GMV inflated the max
-- baseline it was being compared against (fails P3 too) — net effect: an
-- account whose new-item spend held perfectly flat for 3 months earned
-- commission ONLY in month 1, silently dropping to ฿0 in months 2-3.
-- Same class of bug hit Expansion's outlet_status CASE (`first_seen >=
-- current_mo` → 'expansion', else → 'comeback', which is EXCLUDED from all
-- commission) — an outlet first seen in July silently became 'comeback' by
-- August. Confirmed NOT systemic: sql/q3_2026_movement_rep_view.sql (NRR,
-- independently spec-tested) uses explicit per-month DECLARE/SET variables
-- instead of one shared drifting cutoff — that safer pattern is followed
-- here too, both to fix the bug and avoid reintroducing this bug class
-- while adding the rolling logic below.
--
-- v7 (SUPERSEDED by v880-fix below, kept for history) — rolling cumulative
-- commission (per KAM/TL/rep agreement, 2026-07-10): once a (kam, account,
-- outlet, group_key) first qualified as P1 or P3, each subsequent month's
-- qualifying GMV was ADDED to a running cumulative total. Same treatment
-- applied to Expansion.
--
-- 🔴 v880-fix (2026-07-19) — the v7 cumulative design above is WRONG,
-- confirmed via Bush's own worked examples (Ning/iBerry for Expansion,
-- Ning/Avo-Mango-Apple for P1, Ning/Coke for P3): a store/item stays
-- ELIGIBLE for the rest of the quarter once it first qualifies (that part
-- of v7 was right), but each month's commission must be that month's OWN
-- current GMV alone — never summed with prior months. Proven decisively
-- for Expansion since a real month's GMV can DECREASE (a true cumulative
-- running total never can). `p1p3_cumulative`/`expansion_cumulative` below
-- now just test+use the current report_month row directly — no more
-- streak/gap tracking, no more grid generation.
--
-- ⚠️ NOT YET RUN AGAINST REAL DATA — written by Claude Code without BigQuery
-- execution access. Before trusting this for real payroll: run it, then
-- follow the plan doc's verification steps.
--
-- v6 (kept): P3 min incremental config-driven (target_settings, not
--   hardcoded), threshold 2.00x.
-- v4/v5 (kept): expansion outlets → outlet_gmv only (not P1), comeback
--   excluded entirely, P1 threshold ≥5000.
-- Output columns (unchanged): kam_email, p1_gmv, p3_incremental, outlet_gmv, tl_upsell_base
-- ══════════════════════════════════════════════════════════════
DECLARE v_p3_min_incremental FLOAT64 DEFAULT 8000;

-- Explicit per-month date variables (mirrors q3_2026_movement_rep_view.sql's
-- v_base/v_m1/v_m2/v_m3 pattern) — every "baseline" query below is bound by
-- v_base_start/v_base_end/v_lookback_start ONLY, never by whichever month is
-- currently being reported, so it genuinely cannot drift mid-quarter.
DECLARE v_base_start DATE;
DECLARE v_base_end   DATE;
DECLARE v_lookback_start DATE;
DECLARE v_m1_start DATE; DECLARE v_m1_end DATE;
DECLARE v_m2_start DATE; DECLARE v_m2_end DATE;
DECLARE v_m3_start DATE; DECLARE v_m3_end DATE;
DECLARE v_current_mo_start DATE;

-- v8 FIX (do not skip): was DATE_TRUNC(lag-1 date, QUARTER) — on the literal
-- first calendar day of a new quarter (e.g. 2026-07-01), lag-1 is still
-- 2026-06-30 (OLD quarter), so DATE_TRUNC(...,QUARTER) resolved to April 1
-- (Q2's start) instead of July 1 — the whole quarter_months/elapsed_months
-- grid silently built for the wrong quarter that one day. Same bug class
-- v854 fixed on the JS side (_commElapsedQuarterLabels comparing real
-- dates, not string labels) — never ported here. Which QUARTER we're in is
-- never a lag/data-availability question (a quarter boundary is a hardcoded
-- calendar fact), so it must NOT use the lag-1 date — only v_current_mo_start
-- below (which decides which MONTH within the quarter is reportable yet)
-- legitimately needs the lag-1 adjustment, and it already has it.
SET v_m1_start   = DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), QUARTER);
SET v_base_start = DATE_SUB(v_m1_start, INTERVAL 1 MONTH);
SET v_base_end   = DATE_SUB(v_m1_start, INTERVAL 1 DAY);
SET v_lookback_start = DATE_SUB(v_base_start, INTERVAL 2 MONTH);  -- Apr 1 (frozen Apr/May/Jun pool)
SET v_m2_start   = DATE_ADD(v_m1_start, INTERVAL 1 MONTH);
SET v_m1_end     = DATE_SUB(v_m2_start, INTERVAL 1 DAY);
SET v_m3_start   = DATE_ADD(v_m1_start, INTERVAL 2 MONTH);
SET v_m2_end     = DATE_SUB(v_m3_start, INTERVAL 1 DAY);
SET v_m3_end     = DATE_SUB(DATE_ADD(v_m3_start, INTERVAL 1 MONTH), INTERVAL 1 DAY);
-- current_mo_start = whichever of m1/m2/m3 is actually being reported (day-1
-- lag, e.g. run Aug-1 → reports Jul → equals v_m1_start).
SET v_current_mo_start = DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), MONTH);

WITH
-- The 3 months of this quarter, tagged 1/2/3, bounded to only those that
-- have actually elapsed by v_current_mo_start (running in July only
-- evaluates July; running in September evaluates all 3).
quarter_months AS (
  SELECT 1 AS month_no, v_m1_start AS month_start, v_m1_end AS month_end
  UNION ALL SELECT 2, v_m2_start, v_m2_end
  UNION ALL SELECT 3, v_m3_start, v_m3_end
),
elapsed_months AS (
  SELECT * FROM quarter_months WHERE month_start <= v_current_mo_start
),
report_month AS (
  SELECT MAX(month_no) AS n FROM elapsed_months
),

-- Active KAM whitelist (อัปเดตเมื่อมีการเปลี่ยนทีม)
kam_list AS (
  SELECT kam_name, kam_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'         AS kam_name, 'anusorn.k@freshket.co'      AS kam_email),
    STRUCT('Chaklid (Dent) Nimraor'               AS kam_name, 'chaklid.n@freshket.co'      AS kam_email),
    STRUCT('Duangruedee (Ning) Bulalom'           AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email),
    STRUCT('Guntinun (Monet) Thanoochan'          AS kam_name, 'guntinun.t@freshket.co'     AS kam_email),
    STRUCT('Intuon (Jane) Yanakit'                AS kam_name, 'intuon.y@freshket.co'       AS kam_email),
    STRUCT('Napat (To) Kaikaew'                   AS kam_name, 'napat.k@freshket.co'        AS kam_email),
    STRUCT('Natchita (Foam) Bunkong'              AS kam_name, 'natchita.b@freshket.co'     AS kam_email),
    STRUCT('Niracha (Cream) Sangka'               AS kam_name, 'niracha.s@freshket.co'      AS kam_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'            AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email),
    STRUCT('Treerak (May) Sangjua'             AS kam_name, 'treerak.s@freshket.co'      AS kam_email)
  ])
),

-- KAM→account mapping (Q8E logic) — unchanged
kam_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)       AS res_id,
    CAST(um.account_guid AS STRING) AS account_id,
    k.kam_email
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

-- ── NRR core ownership: same KAM in baseline month vs each elapsed month ──
-- v7: per-elapsed-month (was: single "current_mo" ownership check) so a
-- KAM reassignment mid-quarter is still tracked correctly month by month.
apr_outlet_ownership AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    TRIM(o.staff_owner)             AS staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner,
    DATE(o.new_user_exp_date)       AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.delivery_date >= v_base_start AND o.delivery_date <= v_base_end
    AND o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
month_outlet_ownership AS (
  SELECT
    em.month_no,
    CAST(o.user_id AS STRING)       AS outlet_id,
    TRIM(o.staff_owner)             AS staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner
  FROM `freshket-rn.dwh.order` o
  JOIN elapsed_months em ON o.delivery_date >= em.month_start AND o.delivery_date <= em.month_end
  WHERE o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY em.month_no, o.user_id ORDER BY o.delivery_date DESC) = 1
),
nrr_core_outlets AS (
  SELECT m.month_no, m.outlet_id
  FROM month_outlet_ownership m
  JOIN apr_outlet_ownership a ON m.outlet_id = a.outlet_id
  JOIN kam_list k_m ON m.commercial_owner = 'KAM' AND TRIM(m.staff_owner) = TRIM(k_m.kam_name)
  JOIN kam_list k_a ON a.commercial_owner = 'KAM' AND TRIM(a.staff_owner) = TRIM(k_a.kam_name)
    AND k_a.kam_email = k_m.kam_email
  WHERE (a.new_user_exp_date IS NULL OR a.new_user_exp_date < v_base_start)
),

-- ── Outlet status per elapsed month: existing / expansion / comeback ──
-- v7 fix: expansion window widened from "first_seen in THIS month only" to
-- "first_seen anywhere in the quarter up to and including this month" — an
-- outlet first seen in July is still 'expansion' when August/September are
-- evaluated, not silently 'comeback' (which is excluded from all commission).
-- in_baseline/first_seen are now properties of the FROZEN baseline window
-- only (never depend on which month is being evaluated).
outlet_history AS (
  SELECT
    ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(o.delivery_date) AS first_seen,
    MAX(CASE WHEN o.delivery_date >= v_base_start AND o.delivery_date <= v_base_end THEN 1 ELSE 0 END) AS in_baseline,
    MAX(CASE WHEN o.delivery_date >= v_m1_start AND o.delivery_date <= v_m1_end THEN 1 ELSE 0 END) AS in_m1,
    MAX(CASE WHEN o.delivery_date >= v_m2_start AND o.delivery_date <= v_m2_end THEN 1 ELSE 0 END) AS in_m2,
    MAX(CASE WHEN o.delivery_date >= v_m3_start AND o.delivery_date <= v_m3_end THEN 1 ELSE 0 END) AS in_m3
  FROM `freshket-rn.dwh.order` o
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= DATE_SUB(v_base_start, INTERVAL 5 MONTH)
    AND o.delivery_date <= v_m3_end
  GROUP BY 1, 2
),
outlet_status AS (
  SELECT
    em.month_no, oh.account_id, oh.outlet_id,
    CASE
      WHEN oh.in_baseline = 1 AND nc.outlet_id IS NOT NULL THEN 'existing'
      WHEN oh.first_seen >= v_m1_start AND oh.first_seen <= em.month_end THEN 'expansion'
      ELSE 'comeback'
    END AS outlet_type
  FROM elapsed_months em
  CROSS JOIN outlet_history oh
  LEFT JOIN nrr_core_outlets nc ON oh.outlet_id = nc.outlet_id AND nc.month_no = em.month_no
  WHERE (em.month_no = 1 AND oh.in_m1 = 1)
     OR (em.month_no = 2 AND oh.in_m2 = 1)
     OR (em.month_no = 3 AND oh.in_m3 = 1)
),

-- GMV at outlet × group_key, PER elapsed month, split by outlet type
group_key_def AS (
  SELECT
    em.month_no, ka.kam_email, ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN elapsed_months em ON o.delivery_date >= em.month_start AND o.delivery_date <= em.month_end
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE i.gmv_ex_vat > 0
),
current_agg AS (
  SELECT
    gk.month_no, gk.kam_email, gk.account_id, gk.outlet_id, gk.group_key,
    os.outlet_type,
    SUM(gk.gmv_ex_vat) AS total_gmv,
    SUM(CASE WHEN os.outlet_type = 'existing'  THEN gk.gmv_ex_vat ELSE 0 END) AS existing_gmv,
    SUM(CASE WHEN os.outlet_type = 'expansion' THEN gk.gmv_ex_vat ELSE 0 END) AS expansion_gmv
    -- comeback excluded from all commission (no column needed)
  FROM group_key_def gk
  LEFT JOIN outlet_status os
    ON gk.month_no = os.month_no AND gk.account_id = os.account_id AND gk.outlet_id = os.outlet_id
  GROUP BY 1, 2, 3, 4, 5, 6
),

-- ── FROZEN baseline (Apr/May/Jun only, computed ONCE — not per elapsed
-- month, and never bounded by current_mo). This is the v7 bug fix: these
-- two CTEs used to be bounded `< current_mo` (drifting); now bounded
-- `<= v_base_end` (fixed) so July/August's own purchases can never leak
-- into "have they ever bought this before" or "max baseline" ──
baseline_groups AS (
  SELECT DISTINCT
    ka.kam_email, ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= v_lookback_start AND o.delivery_date <= v_base_end
    AND i.gmv_ex_vat > 0
),
lookback_monthly AS (
  SELECT
    ka.kam_email,
    ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    DATE_TRUNC(o.delivery_date, MONTH) AS month_start,
    SUM(i.gmv_ex_vat) AS monthly_gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ka ON CAST(o.user_id AS STRING) = ka.res_id
  WHERE o.delivery_date >= v_lookback_start AND o.delivery_date <= v_base_end
    AND i.gmv_ex_vat > 0
  GROUP BY
    ka.kam_email,
    ka.account_id,
    CAST(o.user_id AS STRING),
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END,
    DATE_TRUNC(o.delivery_date, MONTH)
),
max_baseline AS (
  SELECT
    kam_email, account_id, outlet_id, group_key,
    MAX(
      monthly_gmv / DATE_DIFF(DATE_ADD(month_start, INTERVAL 1 MONTH), month_start, DAY) * 30
    ) AS max_bl
  FROM lookback_monthly
  GROUP BY 1, 2, 3, 4
),

-- Classify P1 / P3 PER elapsed month — same test as before, but now against
-- the genuinely-frozen baseline, so an item that just MAINTAINS (doesn't
-- need to grow further) its qualifying level keeps re-passing every month.
commission_items AS (
  SELECT
    c.month_no, c.kam_email, c.account_id, c.outlet_id, c.group_key,
    c.outlet_type, c.existing_gmv, c.expansion_gmv, c.total_gmv,
    COALESCE(mb.max_bl, 0) AS max_bl,
    CASE WHEN c.outlet_type = 'existing' AND bg.group_key IS NULL THEN 1 ELSE 0 END AS is_p1,
    CASE
      WHEN c.outlet_type = 'existing'
        AND bg.group_key IS NOT NULL
        AND c.existing_gmv > COALESCE(mb.max_bl, 0) * 2.00
        AND c.existing_gmv - COALESCE(mb.max_bl, 0) >= v_p3_min_incremental
      THEN 1 ELSE 0
    END AS is_p3
  FROM current_agg c
  LEFT JOIN baseline_groups bg
    ON c.kam_email = bg.kam_email AND c.account_id = bg.account_id
   AND c.outlet_id = bg.outlet_id AND c.group_key = bg.group_key
  LEFT JOIN max_baseline mb
    ON c.kam_email = mb.kam_email AND c.account_id = mb.account_id
   AND c.outlet_id = mb.outlet_id AND c.group_key = mb.group_key
),

-- ── v880-fix: single-month only (was v7's rolling-cumulative streak-sum) ──
-- Confirmed wrong 2026-07-19 via Bush's own worked example: an item/outlet
-- stays ELIGIBLE for the rest of the quarter once it first qualifies (that
-- part of "stays in scope" was correct), but each month's commission is
-- that month's OWN current GMV alone — never summed with prior qualifying
-- months (e.g. an item dropping to 0 doesn't "keep" a prior month's
-- contribution; the next qualifying month starts fresh from its own GMV).
-- This also removes the need for the grid/gap streak-tracking machinery —
-- just test+use the current report_month row directly.
p1p3_cumulative AS (
  SELECT
    kam_email, account_id, outlet_id, group_key,
    CASE
      WHEN is_p1 = 1 AND total_gmv >= 5000 THEN existing_gmv    -- P1: this month's own qualifying GMV
      WHEN is_p3 = 1 THEN existing_gmv - max_bl                 -- P3: this month's own incremental over frozen baseline
      ELSE 0
    END AS cum_amount,
    is_p1 = 1 AS is_p1_type
  FROM commission_items
  WHERE month_no = (SELECT n FROM report_month)
    AND ((is_p1 = 1 AND total_gmv >= 5000) OR is_p3 = 1)
),

-- ── v880-fix: same single-month treatment for Expansion ───────────────
-- current_agg is grain (month, kam, account, outlet, group_key) — Expansion
-- doesn't care about group_key, roll up to outlet grain for the current
-- report_month only.
expansion_cumulative AS (
  SELECT kam_email, account_id, outlet_id,
    SUM(CASE WHEN outlet_type = 'expansion' THEN expansion_gmv ELSE 0 END) AS cum_amount
  FROM current_agg
  WHERE month_no = (SELECT n FROM report_month)
  GROUP BY 1, 2, 3
),

-- Per-KAM rollups, computed separately so a KAM with Expansion but zero
-- P1/P3 (or vice versa) still shows up correctly via the FULL OUTER JOIN
-- below, rather than silently missing from the output.
p1p3_by_kam AS (
  SELECT kam_email,
    SUM(CASE WHEN is_p1_type THEN cum_amount ELSE 0 END) AS p1_gmv,
    SUM(CASE WHEN NOT is_p1_type THEN cum_amount ELSE 0 END) AS p3_incremental
  FROM p1p3_cumulative
  GROUP BY kam_email
),
expansion_by_kam AS (
  SELECT kam_email, SUM(cum_amount) AS outlet_gmv
  FROM expansion_cumulative
  GROUP BY kam_email
)

-- Output per KAM — same 4 columns as before, values are the current
-- report_month's own GMV only (see v880-fix above).
SELECT
  COALESCE(p.kam_email, e.kam_email) AS kam_email,
  ROUND(COALESCE(p.p1_gmv, 0), 2) AS p1_gmv,
  ROUND(COALESCE(p.p3_incremental, 0), 2) AS p3_incremental,
  ROUND(COALESCE(e.outlet_gmv, 0), 2) AS outlet_gmv,
  -- tl_upsell_base = p1_gmv + p3_incremental ONLY — matches the ORIGINAL
  -- formula (see header) and the app's own JS (`tl_upsell_base: p1Gmv +
  -- p3Incr`, 07a_commission_engine.js) — outlet_gmv/Expansion is
  -- deliberately NOT included in the TL multiplier's numerator.
  ROUND(COALESCE(p.p1_gmv, 0) + COALESCE(p.p3_incremental, 0), 2) AS tl_upsell_base
FROM p1p3_by_kam p
FULL OUTER JOIN expansion_by_kam e ON p.kam_email = e.kam_email
ORDER BY tl_upsell_base DESC
