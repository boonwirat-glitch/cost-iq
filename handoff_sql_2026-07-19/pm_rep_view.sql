-- ════════════════════════════════════════════════════════════════════════════
-- Q3 2026 Movement — PM Rep View (v1, 2026-07-18)
-- sql/pm_rep_view.sql
--
-- NEW FILE — mirrors sql/q3_2026_movement_rep_view.sql exactly, with "self"
-- swapped from KAM to PM. Built so PM/AD staff can use /nrr (Sense Dashboard)
-- the same way a KAM does — /nrr's whole Portfolio page is driven by ONE
-- CSV (kam_rep_view.csv) parsed by fixed COLUMN POSITION (src/nrr/nrr_data.js),
-- so this query's output uses the EXACT SAME 29-column shape/order as the
-- original — its rows just get appended into the SAME kam_rep_view.csv,
-- zero app-code changes needed.
--
-- Does NOT touch q3_2026_movement_rep_view.sql or any existing KAM data —
-- this is a separate, additive query. KAM commission math is untouched.
--
-- Why a separate file instead of editing rep_view.sql in place: that file's
-- classification logic (core_nrr/expansion/handover/new_sales/comeback/
-- transfer_in/transfer_out) hardcodes KAM as "self" and treats PM/ADMIN as
-- "the other portfolio" for cross-transfer bookkeeping (mar_pm_admin_staff /
-- pm_admin_mar_cohort). Making PM a second "self" in the same query would
-- collapse that bookkeeping (an outlet could look like both "mine" and
-- "transferred from the other side" simultaneously) and would also pull in
-- every OTHER PM-tagged outlet company-wide, not just these 4 people's.
-- Mirroring into a separate file with KAM/ADMIN as the new "other side"
-- avoids both problems entirely.
--
-- Goal: ดู performance ของ PM แต่ละคน วัดจาก outlet ที่ถืออยู่ล่าสุด (เหมือน KAM rep view)
--
-- Design (เหมือน rep_view ทุกอย่าง สลับ self=KAM → self=PM):
--   grain     = outlet × period_month × latest_staff_owner
--   base_gmv  = Mar GMV ของ outlet — ติดกับ latest_staff_owner
--   curr_gmv  = GMV จริงรายเดือน
--   "other side" สำหรับ transfer_in/out tracking = KAM/ADMIN (สลับจาก PM/ADMIN เดิม)
-- ════════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- v828-auto: quarter anchors AUTO-DERIVE from CURRENT_DATE — no manual edit
-- needed each new quarter. Run as a BigQuery SCRIPT (DECLARE/SET then SELECT),
-- not pasted as a plain view body. Identical to rep_view.sql's date logic.
-- ══════════════════════════════════════════════════════════════════════════
DECLARE v_base_start DATE;
DECLARE v_base_end   DATE;
DECLARE v_base_days  INT64;
DECLARE v_m1_start DATE;
DECLARE v_m1_end   DATE;
DECLARE v_m1_days  INT64;
DECLARE v_m2_start DATE;
DECLARE v_m2_end   DATE;
DECLARE v_m2_days  INT64;
DECLARE v_m3_start DATE;
DECLARE v_m3_end   DATE;
DECLARE v_m3_days  INT64;
DECLARE v_base_str STRING;
DECLARE v_m1_str   STRING;
DECLARE v_m2_str   STRING;
DECLARE v_m3_str   STRING;

SET v_m1_start  = DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), QUARTER);
SET v_base_start = DATE_SUB(v_m1_start, INTERVAL 1 MONTH);
SET v_base_end   = DATE_SUB(v_m1_start, INTERVAL 1 DAY);
SET v_base_days  = DATE_DIFF(v_base_end, v_base_start, DAY) + 1;
SET v_m2_start   = DATE_ADD(v_m1_start, INTERVAL 1 MONTH);
SET v_m1_end     = DATE_SUB(v_m2_start, INTERVAL 1 DAY);
SET v_m3_start   = DATE_ADD(v_m1_start, INTERVAL 2 MONTH);
SET v_m2_end     = DATE_SUB(v_m3_start, INTERVAL 1 DAY);
SET v_m3_end     = DATE_SUB(DATE_ADD(v_m3_start, INTERVAL 1 MONTH), INTERVAL 1 DAY);
SET v_m1_days = LEAST(DATE_DIFF(v_m1_end, v_m1_start, DAY) + 1,
                 GREATEST(DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), v_m1_start, DAY) + 1, 0));
SET v_m2_days = LEAST(DATE_DIFF(v_m2_end, v_m2_start, DAY) + 1,
                 GREATEST(DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), v_m2_start, DAY) + 1, 0));
SET v_m3_days = LEAST(DATE_DIFF(v_m3_end, v_m3_start, DAY) + 1,
                 GREATEST(DATE_DIFF(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), v_m3_start, DAY) + 1, 0));
SET v_base_str   = FORMAT_DATE('%Y-%m', v_base_start);
SET v_m1_str     = FORMAT_DATE('%Y-%m', v_m1_start);
SET v_m2_str     = FORMAT_DATE('%Y-%m', v_m2_start);
SET v_m3_str     = FORMAT_DATE('%Y-%m', v_m3_start);

WITH

-- ── 1. Email/TL map — ONLY the 4 PM/AD people (this file's whole job is to
--      produce THEIR rows; unlike rep_view.sql's full 19-KAM roster) ───────
staff_email_map AS (
  SELECT kam_name, kam_email, tl_email, tl_name FROM UNNEST([
    STRUCT('Panitan (Aom) Promta'     AS kam_name, 'panitan.p@freshket.co'  AS kam_email, CAST(NULL AS STRING)      AS tl_email, CAST(NULL AS STRING) AS tl_name),
    STRUCT('Sarawoot (Oh) Kaewkhao'   AS kam_name, 'sarawoot.k@freshket.co' AS kam_email, CAST(NULL AS STRING)      AS tl_email, CAST(NULL AS STRING) AS tl_name),
    STRUCT('Nichamon (Ninew) Kanghae' AS kam_name, 'nichamon.k@freshket.co' AS kam_email, CAST(NULL AS STRING)      AS tl_email, CAST(NULL AS STRING) AS tl_name),
    STRUCT('Ornpreya (Ice) Sukthai'   AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email, 'Ploy' AS tl_name)
  ])
),

-- ── 2. Date anchors ──────────────────────────────────────────────────────────
params AS (
  SELECT
    v_base_start AS base_start, v_base_end AS base_end, v_base_days AS base_days,
    v_m1_start   AS jul_start,  v_m1_end   AS jul_end,  v_m1_days   AS jul_days,
    v_m2_start   AS aug_start,  v_m2_end   AS aug_end,  v_m2_days   AS aug_days,
    v_m3_start   AS sep_start,  v_m3_end   AS sep_end,  v_m3_days   AS sep_days
),

-- current account_type จาก dim.user_master (สถานะล่าสุด ณ วันที่ query)
user_account_type AS (
  SELECT
    CAST(res_id AS STRING) AS outlet_id,
    account_type
  FROM `freshket-rn.dim.user_master`
),

-- ── 3. Latest staff owner (ณ วันที่ดึงข้อมูล) ───────────────────────────────
latest_own AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    TRIM(o.staff_owner)             AS latest_staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS latest_commercial_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 4. First order info per outlet ───────────────────────────────────────────
-- first_pm_date (was first_kam_date in rep_view.sql) — first order date under
-- commercial_owner='PM' specifically (self = PM in this file).
outlet_first_dollar AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(DATE(o.delivery_date)) AS first_dollar_date,
    MIN(CASE WHEN UPPER(TRIM(o.commercial_owner)) = 'PM'
             THEN DATE(o.delivery_date) END) AS first_pm_date,
    ARRAY_AGG(
      UPPER(TRIM(o.commercial_owner))
      ORDER BY o.delivery_date ASC LIMIT 1
    )[SAFE_OFFSET(0)] AS first_dollar_owner
  FROM `freshket-rn.dwh.order` o
  WHERE o.user_id IS NOT NULL
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),

-- ── 5. Last owner ก่อน first PM order ──────────────────────────────────────
outlet_prev_owner AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS prev_owner
  FROM `freshket-rn.dwh.order` o
  JOIN outlet_first_dollar ofd
    ON CAST(o.user_id AS STRING) = ofd.outlet_id
   AND DATE(o.delivery_date) < ofd.first_pm_date
  WHERE o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 6. Exp date ──────────────────────────────────────────────────────────────
outlet_exp_date AS (
  SELECT
    CAST(o.user_id AS STRING)      AS outlet_id,
    DATE(MAX(o.new_user_exp_date)) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.new_user_exp_date IS NOT NULL
    AND o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND DATE(o.new_user_exp_date) <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
  GROUP BY 1
),

-- ── 7. GMV per outlet per month (curr months scoped to commercial_owner='PM') ─
base_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),
jul_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jul_start AND p.jul_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND UPPER(TRIM(o.commercial_owner)) = 'PM'
  GROUP BY 1
),
aug_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.aug_start AND p.aug_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND UPPER(TRIM(o.commercial_owner)) = 'PM'
  GROUP BY 1
),
sep_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.sep_start AND p.sep_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND UPPER(TRIM(o.commercial_owner)) = 'PM'
  GROUP BY 1
),

-- ── 8. Ownership snapshots per month ─────────────────────────────────────────
mar_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
jul_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.jul_start AND p.jul_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
aug_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.aug_start AND p.aug_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),
sep_own AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
    o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
    UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.sep_start AND p.sep_end
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 9. Handover outlets — exclude จาก mar_cohort ─────────────────────────────
mar_handover_outlets AS (
  SELECT DISTINCT ofd.outlet_id
  FROM outlet_first_dollar ofd
  JOIN outlet_exp_date oed  ON ofd.outlet_id = oed.outlet_id
  JOIN outlet_prev_owner po ON ofd.outlet_id = po.outlet_id
  WHERE FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = v_base_str
    AND po.prev_owner = 'SALE'
  UNION DISTINCT
  SELECT DISTINCT ofd.outlet_id
  FROM outlet_first_dollar ofd
  JOIN outlet_exp_date oed ON ofd.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po ON ofd.outlet_id = po.outlet_id
  WHERE FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = v_base_str
    AND po.outlet_id IS NULL
),

-- ── 10. mar_cohort — self = PM (was KAM in rep_view.sql) ─────────────────────
mar_cohort AS (
  SELECT mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    mo.staff_owner AS mar_staff_owner,
    ofd.first_dollar_date, ofd.first_pm_date, ofd.first_dollar_owner,
    COALESCE(bg.gmv, 0) AS base_gmv
  FROM mar_own mo
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE UPPER(TRIM(mo.commercial_owner)) = 'PM'
    AND COALESCE(bg.gmv, 0) > 0
    AND mo.outlet_id NOT IN (SELECT outlet_id FROM mar_handover_outlets)
),

-- ── 11. SALE staff ใน Mar ─────────────────────────────────────────────────────
mar_sale_owner AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, TRIM(o.staff_owner) AS sale_staff_owner
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND UPPER(TRIM(o.commercial_owner)) = 'SALE'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
),

-- ── 11b. KAM/ADMIN staff ใน Mar (was PM/ADMIN in rep_view.sql — "the other
--         portfolio" flips since self=PM here) ─────────────────────────────
-- ใช้แสดง base_staff_owner ของ transfer_in จาก KAM/ADMIN
mar_kam_admin_staff AS (
  SELECT
    CAST(o.user_id AS STRING)       AS outlet_id,
    UPPER(TRIM(o.commercial_owner)) AS mar_portfolio,
    TRIM(o.staff_owner)             AS mar_staff
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND UPPER(TRIM(o.commercial_owner)) IN ('KAM','ADMIN')
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── 12. KAM/ADMIN mar cohort (was "PM/ADMIN mar cohort" in rep_view.sql) ────
kam_admin_mar_cohort AS (
  SELECT mo.outlet_id, mo.commercial_owner AS mar_portfolio
  FROM mar_own mo
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE (
    mo.commercial_owner IN ('KAM','ADMIN')
    OR (
      UPPER(TRIM(mo.commercial_owner)) = 'SALE'
      AND ofd.first_pm_date IS NOT NULL
      AND ofd.first_pm_date < v_m1_start
      AND UPPER(TRIM(ofd.first_dollar_owner)) IN ('KAM','ADMIN')
    )
  )
    AND mo.outlet_id NOT IN (SELECT outlet_id FROM mar_cohort)
),

-- ── 13. Classification per outlet per month ───────────────────────────────────
-- เหมือน rep_view.sql ทุกอย่าง สลับ self=KAM → self=PM
apr_classified AS (
  SELECT
    v_m1_str AS period_month,
    ao.outlet_id,
    COALESCE(mc.account_id, ao.account_id)     AS account_id,
    COALESCE(mc.account_name, ao.account_name) AS account_name,
    COALESCE(mc.res_name, ao.res_name)         AS res_name,
    COALESCE(mc.account_type, ao.account_type) AS account_type,
    ao.staff_owner AS period_staff_owner,
    CASE
      WHEN pamc.outlet_id IS NOT NULL
        THEN mpas.mar_staff
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                             ELSE po.prev_owner END, 'SALE') = 'SALE'
        THEN mso.sale_staff_owner
      ELSE COALESCE(mc.mar_staff_owner, ao.staff_owner)
    END AS base_staff_owner,
    COALESCE(mc.base_gmv, bg.gmv, 0) AS base_gmv,
    COALESCE(ag.gmv, 0)              AS curr_gmv,
    ofd.first_dollar_date,
    ofd.first_pm_date,
    oed.new_user_exp_date,
    ofd.first_dollar_owner,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN v_base_str
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
           THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      WHEN ofd.first_pm_date IS NOT NULL
           THEN FORMAT_DATE('%Y-%m', ofd.first_pm_date)
      ELSE NULL
    END AS cohort_month,
    CASE WHEN pamc.outlet_id IS NOT NULL THEN 'inter' ELSE NULL END AS transfer_scope,
    pamc.mar_portfolio AS mar_portfolio,
    CASE
      WHEN mc.outlet_id IS NOT NULL                                         THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= v_m1_start
       AND ofd.first_pm_date     >= v_m1_start
       AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str))            THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = v_base_str
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN (v_m1_str,v_m2_str,v_m3_str)
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'new_sales'
      WHEN ofd.first_pm_date >= v_m1_start
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN (v_m1_str,v_m2_str,v_m3_str)                             THEN 'new_sales'
      WHEN ofd.first_pm_date >= v_m1_start
       AND bg.gmv IS NOT NULL
       AND COALESCE(po.prev_owner,'') = 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str))            THEN 'new_sales'
      WHEN ofd.first_dollar_date >= v_m1_start
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND oed.new_user_exp_date IS NULL                                    THEN 'new_sales'
      WHEN pamc.outlet_id IS NOT NULL                                       THEN 'transfer_in'
      WHEN ofd.first_dollar_date < v_m1_start
       AND bg.gmv IS NULL                                                   THEN 'comeback'
      ELSE 'transfer_in'
    END AS movement_type
  FROM jul_own ao
  LEFT JOIN mar_cohort mc            ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON ao.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON ao.outlet_id = po.outlet_id
  LEFT JOIN jul_gmv ag               ON ao.outlet_id = ag.outlet_id
  LEFT JOIN mar_sale_owner mso       ON ao.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg              ON ao.outlet_id = bg.outlet_id
  LEFT JOIN kam_admin_mar_cohort pamc ON ao.outlet_id = pamc.outlet_id
  LEFT JOIN mar_kam_admin_staff mpas  ON ao.outlet_id = mpas.outlet_id
  WHERE UPPER(TRIM(ao.commercial_owner)) = 'PM'

  UNION ALL

  -- Silent outlets (ไม่มี order ใน Apr)
  SELECT
    v_m1_str, mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.mar_staff_owner AS period_staff_owner,
    mc.mar_staff_owner AS base_staff_owner,
    mc.base_gmv, 0.0,
    mc.first_dollar_date, mc.first_pm_date, CAST(NULL AS DATE) AS new_user_exp_date,
    CAST(NULL AS STRING) AS first_dollar_owner, v_base_str AS cohort_month, CAST(NULL AS STRING) AS transfer_scope,
    CAST(NULL AS STRING) AS mar_portfolio,
    'core_nrr'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM jul_own)
    AND v_m1_days > 0
),

may_classified AS (
  SELECT
    v_m2_str,
    mo.outlet_id,
    COALESCE(mc.account_id, mo.account_id)     AS account_id,
    COALESCE(mc.account_name, mo.account_name) AS account_name,
    COALESCE(mc.res_name, mo.res_name)         AS res_name,
    COALESCE(mc.account_type, mo.account_type) AS account_type,
    mo.staff_owner AS period_staff_owner,
    CASE
      WHEN pamc.outlet_id IS NOT NULL
        THEN mpas.mar_staff
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                             ELSE po.prev_owner END, 'SALE') = 'SALE'
        THEN mso.sale_staff_owner
      ELSE COALESCE(mc.mar_staff_owner, mo.staff_owner)
    END AS base_staff_owner,
    COALESCE(mc.base_gmv, bg.gmv, 0) AS base_gmv,
    COALESCE(mg.gmv, 0)              AS curr_gmv,
    ofd.first_dollar_date, ofd.first_pm_date, oed.new_user_exp_date,
    ofd.first_dollar_owner,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN v_base_str
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
           THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      WHEN ofd.first_pm_date IS NOT NULL
           THEN FORMAT_DATE('%Y-%m', ofd.first_pm_date)
      ELSE NULL
    END AS cohort_month,
    CASE WHEN pamc.outlet_id IS NOT NULL THEN 'inter' ELSE NULL END AS transfer_scope,
    pamc.mar_portfolio AS mar_portfolio,
    CASE
      WHEN mc.outlet_id IS NOT NULL                                         THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= v_m1_start
       AND ofd.first_pm_date     >= v_m1_start
       AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str))            THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = v_base_str
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN (v_m1_str,v_m2_str,v_m3_str)
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'new_sales'
      WHEN ofd.first_pm_date >= v_m1_start
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN (v_m1_str,v_m2_str,v_m3_str)                             THEN 'new_sales'
      WHEN ofd.first_pm_date >= v_m1_start
       AND bg.gmv IS NOT NULL
       AND COALESCE(po.prev_owner,'') = 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str))            THEN 'new_sales'
      WHEN ofd.first_dollar_date >= v_m1_start
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND oed.new_user_exp_date IS NULL                                    THEN 'new_sales'
      WHEN pamc.outlet_id IS NOT NULL                                       THEN 'transfer_in'
      WHEN ofd.first_dollar_date < v_m1_start
       AND bg.gmv IS NULL                                                   THEN 'comeback'
      ELSE 'transfer_in'
    END AS movement_type
  FROM aug_own mo
  LEFT JOIN mar_cohort mc            ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON mo.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON mo.outlet_id = po.outlet_id
  LEFT JOIN aug_gmv mg               ON mo.outlet_id = mg.outlet_id
  LEFT JOIN mar_sale_owner mso       ON mo.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg              ON mo.outlet_id = bg.outlet_id
  LEFT JOIN kam_admin_mar_cohort pamc ON mo.outlet_id = pamc.outlet_id
  LEFT JOIN mar_kam_admin_staff mpas  ON mo.outlet_id = mpas.outlet_id
  WHERE UPPER(TRIM(mo.commercial_owner)) = 'PM'

  UNION ALL

  SELECT
    v_m2_str, mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.mar_staff_owner, mc.mar_staff_owner,
    mc.base_gmv, 0.0, mc.first_dollar_date, mc.first_pm_date, CAST(NULL AS DATE),
    CAST(NULL AS STRING), v_base_str, CAST(NULL AS STRING), CAST(NULL AS STRING), 'core_nrr'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM aug_own)
    AND v_m2_days > 0
),

jun_classified AS (
  SELECT
    v_m3_str,
    jo.outlet_id,
    COALESCE(mc.account_id, jo.account_id)     AS account_id,
    COALESCE(mc.account_name, jo.account_name) AS account_name,
    COALESCE(mc.res_name, jo.res_name)         AS res_name,
    COALESCE(mc.account_type, jo.account_type) AS account_type,
    jo.staff_owner AS period_staff_owner,
    CASE
      WHEN pamc.outlet_id IS NOT NULL
        THEN mpas.mar_staff
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
           AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                             ELSE po.prev_owner END, 'SALE') = 'SALE'
        THEN mso.sale_staff_owner
      ELSE COALESCE(mc.mar_staff_owner, jo.staff_owner)
    END AS base_staff_owner,
    COALESCE(mc.base_gmv, bg.gmv, 0) AS base_gmv,
    COALESCE(jg.gmv, 0)              AS curr_gmv,
    ofd.first_dollar_date, ofd.first_pm_date, oed.new_user_exp_date,
    ofd.first_dollar_owner,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN v_base_str
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
           THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      WHEN ofd.first_pm_date IS NOT NULL
           THEN FORMAT_DATE('%Y-%m', ofd.first_pm_date)
      ELSE NULL
    END AS cohort_month,
    CASE WHEN pamc.outlet_id IS NOT NULL THEN 'inter' ELSE NULL END AS transfer_scope,
    pamc.mar_portfolio AS mar_portfolio,
    CASE
      WHEN mc.outlet_id IS NOT NULL                                         THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= v_m1_start
       AND ofd.first_pm_date     >= v_m1_start
       AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str))            THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = v_base_str
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN (v_m1_str,v_m2_str,v_m3_str)
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'          THEN 'new_sales'
      WHEN ofd.first_pm_date >= v_m1_start
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN (v_m1_str,v_m2_str,v_m3_str)                             THEN 'new_sales'
      WHEN ofd.first_pm_date >= v_m1_start
       AND bg.gmv IS NOT NULL
       AND COALESCE(po.prev_owner,'') = 'SALE'
       AND (oed.new_user_exp_date IS NULL
            OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
               NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str))            THEN 'new_sales'
      WHEN ofd.first_dollar_date >= v_m1_start
       AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE'
                         ELSE po.prev_owner END, 'SALE') = 'SALE'
       AND oed.new_user_exp_date IS NULL                                    THEN 'new_sales'
      WHEN pamc.outlet_id IS NOT NULL                                       THEN 'transfer_in'
      WHEN ofd.first_dollar_date < v_m1_start
       AND bg.gmv IS NULL                                                   THEN 'comeback'
      ELSE 'transfer_in'
    END AS movement_type
  FROM sep_own jo
  LEFT JOIN mar_cohort mc            ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON jo.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON jo.outlet_id = po.outlet_id
  LEFT JOIN sep_gmv jg               ON jo.outlet_id = jg.outlet_id
  LEFT JOIN mar_sale_owner mso       ON jo.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg              ON jo.outlet_id = bg.outlet_id
  LEFT JOIN kam_admin_mar_cohort pamc ON jo.outlet_id = pamc.outlet_id
  LEFT JOIN mar_kam_admin_staff mpas  ON jo.outlet_id = mpas.outlet_id
  WHERE UPPER(TRIM(jo.commercial_owner)) = 'PM'

  UNION ALL

  SELECT
    v_m3_str, mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    mc.mar_staff_owner, mc.mar_staff_owner,
    mc.base_gmv, 0.0, mc.first_dollar_date, mc.first_pm_date, CAST(NULL AS DATE),
    CAST(NULL AS STRING), v_base_str, CAST(NULL AS STRING), CAST(NULL AS STRING), 'core_nrr'
  FROM mar_cohort mc
  WHERE mc.outlet_id NOT IN (SELECT outlet_id FROM sep_own)
    AND v_m3_days > 0
),


-- ── transfer_out_rows ─────────────────────────────────────────────────────────
-- outlet ที่ Mar staff = PM X แต่ latest_staff ≠ PM X
-- ขึ้นใน output ของ PM เดิม (Mar staff) เป็น transfer_out
transfer_out_rows AS (
  SELECT
    period_month,
    mc.outlet_id,
    mc.account_id,
    mc.account_name,
    mc.res_name,
    mc.account_type,
    mc.mar_staff_owner              AS period_staff_owner,
    mc.mar_staff_owner              AS base_staff_owner,
    mc.base_gmv,
    0.0                             AS curr_gmv,
    mc.first_dollar_date,
    mc.first_pm_date,
    CAST(NULL AS DATE)              AS new_user_exp_date,
    CAST(NULL AS STRING)            AS first_dollar_owner,
    v_base_str                      AS cohort_month,
    CAST(NULL AS STRING)            AS transfer_scope,
    CAST(NULL AS STRING)            AS mar_portfolio,
    'transfer_out'         AS movement_type
  FROM mar_cohort mc
  JOIN latest_own lo ON mc.outlet_id = lo.outlet_id
  CROSS JOIN UNNEST([v_m1_str, v_m2_str, v_m3_str]) AS period_month
  -- เฉพาะ outlet ที่ latest_staff ≠ Mar staff
  WHERE lo.latest_commercial_owner != 'PM'
),

all_classified AS (
  SELECT * FROM apr_classified
  UNION ALL SELECT * FROM may_classified
  UNION ALL SELECT * FROM jun_classified
  UNION ALL SELECT * FROM transfer_out_rows
)

-- ── FINAL SELECT ──────────────────────────────────────────────────────────────
-- SAME 29-column shape/order as q3_2026_movement_rep_view.sql — output rows
-- get appended into the same kam_rep_view.csv, zero app-code changes needed.
SELECT
  r.period_month,
  r.movement_type,
  r.transfer_scope,
  lo.latest_commercial_owner        AS current_portfolio,
  r.period_staff_owner               AS current_staff_owner,
  COALESCE(r.mar_portfolio, 'PM')   AS base_portfolio,
  r.base_staff_owner,
  r.outlet_id,
  r.account_id,
  r.account_name,
  r.res_name,
  COALESCE(um.account_type, r.account_type) AS account_type,
  r.cohort_month,
  ROUND(r.curr_gmv, 0)              AS curr_gmv,
  ROUND(r.base_gmv, 0)              AS base_gmv,
  p.base_days,
  CASE r.period_month
    WHEN v_m1_str THEN p.jul_days
    WHEN v_m2_str THEN p.aug_days
    WHEN v_m3_str THEN p.sep_days
  END                               AS curr_days,
  ofd2.first_dollar_date,
  ofd2.first_pm_date                AS first_portfolio_date,
  ofd2.first_dollar_owner,
  oed2.new_user_exp_date,
  -- rep-specific columns ต่อท้าย
  em_latest.tl_name                 AS latest_tl,
  em_base.tl_name                   AS base_tl,
  lo.latest_staff_owner,
  lo.latest_commercial_owner,
  em_latest.kam_email               AS latest_kam_email,
  em_latest.tl_email                AS latest_tl_email,
  em_base.kam_email                 AS base_kam_email,
  em_base.tl_email                  AS base_tl_email

FROM all_classified r
CROSS JOIN params p
JOIN latest_own lo                  ON r.outlet_id            = lo.outlet_id
LEFT JOIN staff_email_map em_latest ON LOWER(TRIM(lo.latest_staff_owner)) = LOWER(TRIM(em_latest.kam_name))
LEFT JOIN staff_email_map em_base   ON LOWER(TRIM(r.base_staff_owner))    = LOWER(TRIM(em_base.kam_name))
LEFT JOIN outlet_first_dollar ofd2  ON r.outlet_id            = ofd2.outlet_id
LEFT JOIN outlet_exp_date oed2      ON r.outlet_id            = oed2.outlet_id
LEFT JOIN user_account_type um       ON r.outlet_id            = um.outlet_id
-- v878 fix: unlike the original file (WHERE = 'KAM' — the KAM tag and the
-- KAM roster are effectively the same population, no meaningful orphans),
-- commercial_owner='PM' company-wide covers MORE real people than just these
-- 4 (confirmed in real BigQuery output — e.g. "Niwara (Nut) Buaon" also
-- carries the PM tag). Without an explicit roster-membership check here,
-- those orphan PM-tagged outlets would flow into src/nrr/nrr_pulse.js's
-- admin-only Pulse feed (it iterates qd.allRows directly, not scoped by
-- email) as unowned "new arrivals" that never appeared before this file
-- existed. Scope strictly to the 4 named people: current-portfolio rows by
-- em_latest (today's owner), transfer_out rows by em_base (the PM who HELD
-- it before it left — that's whose report the row belongs to).
WHERE (lo.latest_commercial_owner = 'PM' AND em_latest.kam_email IS NOT NULL)
   OR (r.movement_type = 'transfer_out'  AND em_base.kam_email   IS NOT NULL)

ORDER BY
  r.period_month,
  em_latest.tl_name,
  lo.latest_staff_owner,
  r.movement_type,
  r.curr_gmv DESC
