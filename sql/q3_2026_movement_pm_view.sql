-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ CORRECTION (2026-07-09): the line below ("NOT consumed by the app") is
-- WRONG for /nrr — src/nrr/nrr_data.js's nrrFetchPmCsv() fetches pm_view.csv
-- (this query's output) DIRECTLY and drives /nrr's PM Portfolio section +
-- the org pulse's "PM" satellite %. Re-run this query and re-upload
-- pm_view.csv to R2 every quarter, same cadence as admin_view.csv/
-- vp_view.csv — a skipped re-run here silently shows last quarter's
-- movement as current (this is exactly what happened to admin_view.csv,
-- caught 2026-07-09: it held Apr/May/Jun data three months into Q3,
-- because this same comment read as "safe to skip"). /nrr now shows a
-- banner if the uploaded file's period_month doesn't match the live
-- quarter (nrrStaleCsvBannerHtml, src/nrr/nrr_view.js) — but the fix is
-- uploading fresh data, not the banner.
--
-- STATUS (L-4, decided 2026-07-06 by Bucci): KEEP as maintained reporting variant.
-- Sense's main app (rep-facing) reads sql/q3_2026_movement_rep_view.sql only —
-- see docs/Q3_NRR_COMMISSION_SPEC.md section 2. This file is scoped reporting
-- for portfolio-level analysis and must be kept in sync with rep_view bugfixes
-- going forward — now in test rotation, see docs/Q3_NRR_TEST_SPEC.md test D8.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- Q2 2026 Movement — PM Portfolio View  (v1)
-- sql/q2_2026_movement_pm_view.sql
--
-- Scope: PM portfolio เท่านั้น (commercial_owner = 'PM')
--
-- ต่างจาก VP view:
--   [1] mar_cohort  : last Mar order = 'KAM' เท่านั้น
--   [2] curr_gmv    : filter commercial_owner = 'PM' เท่านั้น
--   [3] LEG A       : WHERE commercial_owner = 'PM'
--   [4] LEG B       : mar_cohort ที่ไม่มี order 'KAM' เดือนนั้น
--                     → ถ้า last order = PM/ADMIN → transfer_out (inter)
--                     → ถ้า last order = SALE/ไม่มี → transfer_out (external) หรือ core_nrr
--
-- Classification priority:
--   [1] core_nrr    : อยู่ใน KAM mar_cohort
--   [2] expansion   : first_portfolio_date >= Apr + first KAM order >= Apr
--   [3] handover    : exp_date = March AND prev_owner = SALE
--   [4] new_sales   : exp_date ใน Q AND prev_owner = SALE
--                     หรือ first_pm_date ใน Q (fallback)
--   [5] comeback    : first_dollar < Apr + ไม่มี Mar GMV global + ไม่มี exp_date ใน Q
--   [6] transfer_in : last order = KAM แต่ Mar cohort อยู่ portfolio อื่น (PM/ADMIN)
--   [7] unclassified: ELSE
--
-- Transfer scope:
--   inter    = ย้ายข้าม portfolio (KAM↔PM↔ADMIN)
--   external = ออกไป SALE
--
-- curr_gmv = order ที่ commercial_owner = 'PM' เท่านั้น
-- base_gmv = GMV ทุก order ใน March ไม่ filter owner
-- ════════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- v828-auto: quarter anchors AUTO-DERIVE from CURRENT_DATE — no manual edit
-- needed each new quarter. Run as a BigQuery SCRIPT (DECLARE/SET then SELECT),
-- not pasted as a plain view body. m1/m2/m3 = the 3 months of whichever
-- quarter we're currently in (Jul/Aug/Sep for Q3, Oct/Nov/Dec for Q4, etc.);
-- base = 1 month before the quarter starts (Jun for Q3, Sep for Q4, etc.).
-- Day-1 lag applied before quarter-truncation so day 1 of a new quarter still
-- reports the just-closed quarter until its own data is confirmed complete.
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
-- v830: days-elapsed clamped per-month so the export is correct whenever it's run during
-- the quarter (start/mid/end) -- was previously hardcoded to always treat m3 as the only
-- MTD month, which broke completely (inverted date range, zero rows) when run early in
-- the quarter instead of at quarter-end.
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
params AS (
  SELECT
    v_base_start AS base_start, v_base_end AS base_end, v_base_days AS base_days,
    v_m1_start   AS jul_start,  v_m1_end   AS jul_end,  v_m1_days   AS jul_days,
    v_m2_start   AS aug_start,  v_m2_end   AS aug_end,  v_m2_days   AS aug_days,
    v_m3_start   AS sep_start,  v_m3_end   AS sep_end,  v_m3_days   AS sep_days
),

-- current account_type จาก dim.user_master (สถานะล่าสุด ณ วันที่ query)
-- ใช้แทน r.account_type ที่มาจาก per-period order snapshot ซึ่งไม่ consistent
user_account_type AS (
  SELECT
    CAST(res_id AS STRING) AS outlet_id,
    account_type
  FROM `freshket-rn.dim.user_master`
),

-- first_dollar_date  = first order global (ทุก owner)
-- first_pm_date     = first order ที่ commercial_owner = 'PM'
-- first_dollar_date  = first order global (ทุก owner)
-- first_pm_date      = first order ที่ commercial_owner = 'PM'
-- first_dollar_owner  = owner ของ first order จริงๆ (ทุก owner รวม SALE)
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

outlet_exp_date AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    DATE(MAX(o.new_user_exp_date)) AS new_user_exp_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.new_user_exp_date IS NOT NULL
    AND o.user_id IS NOT NULL
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND DATE(o.new_user_exp_date) <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
  GROUP BY 1
),

-- prev_owner = last order ก่อน first KAM order
outlet_prev_owner AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
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

-- base_gmv = Mar GMV ทุก order ไม่ filter owner
base_gmv AS (
  SELECT CAST(o.user_id AS STRING) AS outlet_id, ROUND(SUM(o.gmv_ex_vat),0) AS gmv
  FROM `freshket-rn.dwh.order` o CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND o.gmv_ex_vat > 0
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
  GROUP BY 1
),

-- curr_gmv = KAM order เท่านั้น
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

-- ownership snapshot per month (last order wins, ทุก owner)
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

-- mar_handover_outlets: exp_date = March AND prev_owner = SALE (หรือไม่มี prev)
-- exclude ออกจาก KAM mar_cohort
mar_handover_outlets AS (
  SELECT DISTINCT ofd.outlet_id
  FROM outlet_first_dollar ofd
  JOIN outlet_exp_date oed  ON ofd.outlet_id = oed.outlet_id
  JOIN outlet_prev_owner po ON ofd.outlet_id = po.outlet_id
  WHERE FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
        IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
    AND po.prev_owner = 'SALE'
  UNION DISTINCT
  SELECT DISTINCT ofd.outlet_id
  FROM outlet_first_dollar ofd
  JOIN outlet_exp_date oed ON ofd.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po ON ofd.outlet_id = po.outlet_id
  WHERE FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
        IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
    AND po.outlet_id IS NULL
),

-- KAM mar_cohort: last Mar order = 'KAM' + base_gmv > 0 + ไม่ใช่ handover
-- KAM mar_cohort: Mar last = 'KAM' หรือ SALE spot + first_pm_date < Apr
mar_cohort AS (
  SELECT mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    CASE
      WHEN UPPER(TRIM(mo.commercial_owner)) = 'PM' THEN mo.commercial_owner
      ELSE 'PM'
    END AS base_portfolio,
    mo.staff_owner AS base_staff_owner,
    ofd.first_dollar_date, ofd.first_pm_date, ofd.first_dollar_owner,
    COALESCE(bg.gmv, 0) AS base_gmv
  FROM (
    SELECT CAST(o.user_id AS STRING) AS outlet_id, CAST(o.account_id AS STRING) AS account_id,
      o.cdp_account_name AS account_name, o.cdp_res_name AS res_name, o.account_type,
      UPPER(TRIM(o.commercial_owner)) AS commercial_owner, TRIM(o.staff_owner) AS staff_owner
    FROM `freshket-rn.dwh.order` o CROSS JOIN params p
    WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
      AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST') AND o.user_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
  ) mo
  LEFT JOIN base_gmv bg             ON mo.outlet_id = bg.outlet_id
  LEFT JOIN outlet_first_dollar ofd ON mo.outlet_id = ofd.outlet_id
  WHERE (
    UPPER(TRIM(mo.commercial_owner)) = 'PM'
    OR (
      UPPER(TRIM(mo.commercial_owner)) = 'SALE'
      AND ofd.first_pm_date IS NOT NULL
      AND ofd.first_pm_date < v_m1_start
    )
  )
    AND COALESCE(bg.gmv, 0) > 0
    AND mo.outlet_id NOT IN (SELECT outlet_id FROM mar_handover_outlets)
),

-- kam_admin_mar_cohort: outlets ที่ Mar last owner = PM หรือ ADMIN
-- ใช้ detect transfer_in ใน KAM view (outlet ย้ายมาจาก PM/ADMIN ใน Q)
kam_admin_mar_cohort AS (
  SELECT mo.outlet_id, mo.commercial_owner AS mar_portfolio
  FROM (
    SELECT CAST(o.user_id AS STRING) AS outlet_id,
      UPPER(TRIM(o.commercial_owner)) AS commercial_owner
    FROM `freshket-rn.dwh.order` o CROSS JOIN params p
    WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
      AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
      AND o.user_id IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.delivery_date DESC) = 1
  ) mo
  LEFT JOIN outlet_first_dollar ofd ON CAST(mo.outlet_id AS STRING) = ofd.outlet_id
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

-- mar_sale_owner: SALE staff ที่ดูแล outlet ใน March
-- ใช้สำหรับ base_staff_owner ของ new_sales fallback
mar_sale_owner AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    TRIM(o.staff_owner) AS sale_staff_owner,
    UPPER(TRIM(o.commercial_owner)) AS sale_owner
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN params p
  WHERE o.delivery_date BETWEEN p.base_start AND p.base_end
    AND UPPER(TRIM(o.commercial_owner)) = 'SALE'
    AND o.account_type NOT IN ('Consumer','Enduser','Exclude','TEST')
    AND o.user_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY o.user_id ORDER BY o.delivery_date DESC
  ) = 1
),

-- ── Apr rows ─────────────────────────────────────────────────────────────────
jul_rows AS (

  -- LEG A: outlet มี order KAM ใน Apr
  SELECT
    v_m1_str AS period_month,
    ao.outlet_id, ao.account_id, ao.account_name, ao.res_name, ao.account_type,
    ao.commercial_owner AS current_portfolio, ao.staff_owner AS current_staff_owner,
    CASE WHEN pamc.outlet_id IS NOT NULL THEN pamc.mar_portfolio
         WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
             AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
             THEN 'SALE'
         ELSE COALESCE(mc.base_portfolio, ao.commercial_owner)
    END AS base_portfolio,
    CASE
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
          IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
          AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
          THEN mso.sale_staff_owner
      ELSE COALESCE(mc.base_staff_owner, ao.staff_owner)
    END AS base_staff_owner,
    ofd.first_dollar_date, ofd.first_pm_date, ofd.first_dollar_owner,
    oed.new_user_exp_date,
    COALESCE(mc.base_gmv, bg.gmv, 0) AS base_gmv,
    COALESCE(ag.gmv, 0) AS curr_gmv,
    CASE
      WHEN mc.outlet_id IS NOT NULL                                     THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= v_m1_start
        AND ofd.first_pm_date   >= v_m1_start
        AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str))        THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = v_base_str
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'                   THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) IN (v_m1_str,v_m2_str,v_m3_str)
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'                   THEN 'new_sales'
      WHEN ofd.first_pm_date IS NOT NULL
        AND ofd.first_pm_date >= v_m1_start
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
        AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
            IN (v_m1_str,v_m2_str,v_m3_str)               THEN 'new_sales'
      -- Scenario D: Mar GMV มี (SALE spot) + first_kam ใน Q + prev=SALE + exp_date ก่อน Q
      WHEN ofd.first_pm_date IS NOT NULL
        AND ofd.first_pm_date >= v_m1_start
        AND bg.gmv IS NOT NULL
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str))        THEN 'new_sales'
      -- transfer_in: outlet อยู่ใน PM/ADMIN mar_cohort แต่ KAM รับใน Q
      WHEN pamc.outlet_id IS NOT NULL                                   THEN 'transfer_in'
      -- [6b] new_sales: first order ใน Q + fd_owner=SALE + ไม่มี exp_date
      -- outlet ใหม่ที่ SALE สร้างใน Q และโอนให้ portfolio (Foodium case)
      WHEN ofd.first_dollar_date >= v_m1_start
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
        AND oed.new_user_exp_date IS NULL                                THEN 'new_sales'
      WHEN ofd.first_dollar_date < v_m1_start
        AND bg.gmv IS NULL
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
             OR COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, '') != 'SALE')                   THEN 'comeback'
      ELSE 'unclassified'
    END AS movement_type,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN v_base_str
      -- handover/new_sales ปกติ: exp_date อยู่ใน Q
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
           THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      -- new_sales fallback: exp_date ก่อน Q หรือไม่มี → ใช้ first_portfolio_date
      WHEN ofd.first_pm_date IS NOT NULL
           THEN FORMAT_DATE('%Y-%m', ofd.first_pm_date)
      ELSE NULL
    END AS cohort_month,
    -- transfer_in จาก portfolio อื่น
    CASE
      WHEN pamc.outlet_id IS NOT NULL THEN 'inter'
      ELSE NULL
    END AS transfer_scope
  FROM jul_own ao
  LEFT JOIN mar_cohort mc            ON ao.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON ao.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON ao.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON ao.outlet_id = po.outlet_id
  LEFT JOIN jul_gmv ag               ON ao.outlet_id = ag.outlet_id
  LEFT JOIN mar_sale_owner mso        ON ao.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg              ON ao.outlet_id = bg.outlet_id
  LEFT JOIN kam_admin_mar_cohort pamc ON ao.outlet_id = pamc.outlet_id
  WHERE UPPER(TRIM(ao.commercial_owner)) = 'PM'

  UNION ALL

  -- LEG B: PM mar_cohort ที่ไม่มี PM order ใน Apr
  SELECT
    v_m1_str,
    mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    COALESCE(ao_port.commercial_owner, ao_sale.commercial_owner, 'PM') AS current_portfolio,
    COALESCE(ao_port.staff_owner, ao_sale.staff_owner, mc.base_staff_owner) AS current_staff_owner,
    'PM', mc.base_staff_owner,
    mc.first_dollar_date, mc.first_pm_date, mc.first_dollar_owner,
    oed.new_user_exp_date,
    mc.base_gmv, 0.0,
    CASE
      WHEN ao_port.commercial_owner IN ('KAM','ADMIN') THEN 'transfer_out'
      WHEN ao_sale.outlet_id IS NOT NULL              THEN 'transfer_out'
      ELSE 'core_nrr'
    END,
    v_base_str,
    CASE
      WHEN ao_port.commercial_owner IN ('KAM','ADMIN') THEN 'inter'
      WHEN ao_sale.outlet_id IS NOT NULL              THEN 'external'
      ELSE NULL
    END
  FROM mar_cohort mc
  LEFT JOIN outlet_exp_date oed  ON mc.outlet_id = oed.outlet_id
  LEFT JOIN jul_own ao_pm  ON mc.outlet_id = ao_pm.outlet_id
    AND ao_pm.commercial_owner = 'PM'
  LEFT JOIN jul_own ao_port ON mc.outlet_id = ao_port.outlet_id
    AND ao_port.commercial_owner IN ('KAM','ADMIN')
  LEFT JOIN jul_own ao_sale ON mc.outlet_id = ao_sale.outlet_id
    AND ao_sale.commercial_owner = 'SALE'
  WHERE ao_pm.outlet_id IS NULL
    AND v_m1_days > 0  -- v6-fix: skip silent-outlet fallback if month 1 hasn't started yet
),

-- ── May rows ─────────────────────────────────────────────────────────────────
aug_rows AS (

  -- LEG A
  SELECT
    v_m2_str,
    mo.outlet_id, mo.account_id, mo.account_name, mo.res_name, mo.account_type,
    mo.commercial_owner, mo.staff_owner,
    CASE WHEN pamc.outlet_id IS NOT NULL THEN pamc.mar_portfolio
         WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
             AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
             THEN 'SALE'
         ELSE COALESCE(mc.base_portfolio, mo.commercial_owner)
    END,
    CASE
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
          IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
          AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
          THEN mso.sale_staff_owner
      ELSE COALESCE(mc.base_staff_owner, mo.staff_owner)
    END,
    ofd.first_dollar_date, ofd.first_pm_date, ofd.first_dollar_owner,
    oed.new_user_exp_date,
    COALESCE(mc.base_gmv, bg.gmv, 0), COALESCE(mg.gmv, 0),
    CASE
      WHEN mc.outlet_id IS NOT NULL                                     THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= v_m1_start
        AND ofd.first_pm_date   >= v_m1_start
        AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str))        THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = v_base_str
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'                   THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) IN (v_m1_str,v_m2_str,v_m3_str)
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'                   THEN 'new_sales'
      WHEN ofd.first_pm_date IS NOT NULL
        AND ofd.first_pm_date >= v_m1_start
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
        AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
            IN (v_m1_str,v_m2_str,v_m3_str)               THEN 'new_sales'
      -- Scenario D: Mar GMV มี (SALE spot) + first_kam ใน Q + prev=SALE + exp_date ก่อน Q
      WHEN ofd.first_pm_date IS NOT NULL
        AND ofd.first_pm_date >= v_m1_start
        AND bg.gmv IS NOT NULL
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str))        THEN 'new_sales'
      -- transfer_in: outlet อยู่ใน PM/ADMIN mar_cohort แต่ KAM รับใน Q
      WHEN pamc.outlet_id IS NOT NULL                                   THEN 'transfer_in'
      -- [6b] new_sales: first order ใน Q + fd_owner=SALE + ไม่มี exp_date
      -- outlet ใหม่ที่ SALE สร้างใน Q และโอนให้ portfolio (Foodium case)
      WHEN ofd.first_dollar_date >= v_m1_start
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
        AND oed.new_user_exp_date IS NULL                                THEN 'new_sales'
      WHEN ofd.first_dollar_date < v_m1_start
        AND bg.gmv IS NULL
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
             OR COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, '') != 'SALE')                   THEN 'comeback'
      ELSE 'unclassified'
    END,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN v_base_str
      -- handover/new_sales ปกติ: exp_date อยู่ใน Q
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
           THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      -- new_sales fallback: exp_date ก่อน Q หรือไม่มี → ใช้ first_portfolio_date
      WHEN ofd.first_pm_date IS NOT NULL
           THEN FORMAT_DATE('%Y-%m', ofd.first_pm_date)
      ELSE NULL
    END,
    CASE
      WHEN pamc.outlet_id IS NOT NULL THEN 'inter'
      ELSE NULL
    END
  FROM aug_own mo
  LEFT JOIN mar_cohort mc            ON mo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON mo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON mo.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON mo.outlet_id = po.outlet_id
  LEFT JOIN aug_gmv mg               ON mo.outlet_id = mg.outlet_id
  LEFT JOIN mar_sale_owner mso        ON mo.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg              ON mo.outlet_id = bg.outlet_id
  LEFT JOIN kam_admin_mar_cohort pamc ON mo.outlet_id = pamc.outlet_id
  WHERE UPPER(TRIM(mo.commercial_owner)) = 'PM'

  UNION ALL

  -- LEG B
  SELECT
    v_m2_str,
    mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    COALESCE(mo_port.commercial_owner, mo_sale.commercial_owner, 'PM') AS current_portfolio,
    COALESCE(mo_port.staff_owner, mo_sale.staff_owner, mc.base_staff_owner) AS current_staff_owner,
    'PM', mc.base_staff_owner,
    mc.first_dollar_date, mc.first_pm_date, mc.first_dollar_owner,
    oed.new_user_exp_date,
    mc.base_gmv, 0.0,
    CASE
      WHEN mo_port.commercial_owner IN ('KAM','ADMIN') THEN 'transfer_out'
      WHEN mo_sale.outlet_id IS NOT NULL              THEN 'transfer_out'
      ELSE 'core_nrr'
    END,
    v_base_str,
    CASE
      WHEN mo_port.commercial_owner IN ('KAM','ADMIN') THEN 'inter'
      WHEN mo_sale.outlet_id IS NOT NULL              THEN 'external'
      ELSE NULL
    END
  FROM mar_cohort mc
  LEFT JOIN outlet_exp_date oed  ON mc.outlet_id = oed.outlet_id
  LEFT JOIN aug_own mo_pm  ON mc.outlet_id = mo_pm.outlet_id
    AND mo_pm.commercial_owner = 'PM'
  LEFT JOIN aug_own mo_port ON mc.outlet_id = mo_port.outlet_id
    AND mo_port.commercial_owner IN ('KAM','ADMIN')
  LEFT JOIN aug_own mo_sale ON mc.outlet_id = mo_sale.outlet_id
    AND mo_sale.commercial_owner = 'SALE'
  WHERE mo_pm.outlet_id IS NULL
    AND v_m2_days > 0  -- v6-fix: skip silent-outlet fallback if month 2 hasn't started yet
),

-- ── Jun rows ─────────────────────────────────────────────────────────────────
sep_rows AS (

  -- LEG A
  -- v6-fix: was v_base_str (mislabels Sep data as base month, same bug class as
  -- rep_view.sql's original jun_classified bug). This CTE sources FROM sep_own/sep_gmv
  -- (the 3rd quarter month), so it must use v_m3_str to match.
  SELECT
    v_m3_str,
    jo.outlet_id, jo.account_id, jo.account_name, jo.res_name, jo.account_type,
    jo.commercial_owner, jo.staff_owner,
    CASE WHEN pamc.outlet_id IS NOT NULL THEN pamc.mar_portfolio
         WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
             IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
             AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
             THEN 'SALE'
         ELSE COALESCE(mc.base_portfolio, jo.commercial_owner)
    END,
    CASE
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
          IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
          AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
          THEN mso.sale_staff_owner
      ELSE COALESCE(mc.base_staff_owner, jo.staff_owner)
    END,
    ofd.first_dollar_date, ofd.first_pm_date, ofd.first_dollar_owner,
    oed.new_user_exp_date,
    COALESCE(mc.base_gmv, bg.gmv, 0), COALESCE(jg.gmv, 0),
    CASE
      WHEN mc.outlet_id IS NOT NULL                                     THEN 'core_nrr'
      WHEN ofd.first_dollar_date >= v_m1_start
        AND ofd.first_pm_date   >= v_m1_start
        AND COALESCE(ofd.first_dollar_owner,'') != 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str))        THEN 'expansion'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) = v_base_str
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'                   THEN 'handover'
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date) IN (v_m1_str,v_m2_str,v_m3_str)
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'                   THEN 'new_sales'
      WHEN ofd.first_pm_date IS NOT NULL
        AND ofd.first_pm_date >= v_m1_start
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
        AND FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
            IN (v_m1_str,v_m2_str,v_m3_str)               THEN 'new_sales'
      -- Scenario D: Mar GMV มี (SALE spot) + first_kam ใน Q + prev=SALE + exp_date ก่อน Q
      WHEN ofd.first_pm_date IS NOT NULL
        AND ofd.first_pm_date >= v_m1_start
        AND bg.gmv IS NOT NULL
        AND COALESCE(po.prev_owner, '') = 'SALE'
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str))        THEN 'new_sales'
      -- transfer_in: outlet อยู่ใน PM/ADMIN mar_cohort แต่ KAM รับใน Q
      WHEN pamc.outlet_id IS NOT NULL                                   THEN 'transfer_in'
      -- [6b] new_sales: first order ใน Q + fd_owner=SALE + ไม่มี exp_date
      -- outlet ใหม่ที่ SALE สร้างใน Q และโอนให้ portfolio (Foodium case)
      WHEN ofd.first_dollar_date >= v_m1_start
        AND COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, 'SALE') = 'SALE'
        AND oed.new_user_exp_date IS NULL                                THEN 'new_sales'
      WHEN ofd.first_dollar_date < v_m1_start
        AND bg.gmv IS NULL
        AND (oed.new_user_exp_date IS NULL
             OR FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
                NOT IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
             OR COALESCE(CASE WHEN ofd.first_dollar_owner = 'SALE' THEN 'SALE' ELSE po.prev_owner END, '') != 'SALE')                   THEN 'comeback'
      ELSE 'unclassified'
    END,
    CASE
      WHEN mc.outlet_id IS NOT NULL THEN v_base_str
      -- handover/new_sales ปกติ: exp_date อยู่ใน Q
      WHEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
           IN (v_base_str,v_m1_str,v_m2_str,v_m3_str)
           THEN FORMAT_DATE('%Y-%m', oed.new_user_exp_date)
      -- new_sales fallback: exp_date ก่อน Q หรือไม่มี → ใช้ first_portfolio_date
      WHEN ofd.first_pm_date IS NOT NULL
           THEN FORMAT_DATE('%Y-%m', ofd.first_pm_date)
      ELSE NULL
    END,
    CASE
      WHEN pamc.outlet_id IS NOT NULL THEN 'inter'
      ELSE NULL
    END
  FROM sep_own jo
  LEFT JOIN mar_cohort mc            ON jo.outlet_id = mc.outlet_id
  LEFT JOIN outlet_first_dollar ofd  ON jo.outlet_id = ofd.outlet_id
  LEFT JOIN outlet_exp_date oed      ON jo.outlet_id = oed.outlet_id
  LEFT JOIN outlet_prev_owner po     ON jo.outlet_id = po.outlet_id
  LEFT JOIN sep_gmv jg               ON jo.outlet_id = jg.outlet_id
  LEFT JOIN mar_sale_owner mso        ON jo.outlet_id = mso.outlet_id
  LEFT JOIN base_gmv bg              ON jo.outlet_id = bg.outlet_id
  LEFT JOIN kam_admin_mar_cohort pamc ON jo.outlet_id = pamc.outlet_id
  WHERE UPPER(TRIM(jo.commercial_owner)) = 'PM'

  UNION ALL

  -- LEG B
  -- v6-fix: was v_base_str, same bug class as LEG A -- this block is Sep data, must use v_m3_str.
  SELECT
    v_m3_str,
    mc.outlet_id, mc.account_id, mc.account_name, mc.res_name, mc.account_type,
    COALESCE(jo_port.commercial_owner, jo_sale.commercial_owner, 'PM') AS current_portfolio,
    COALESCE(jo_port.staff_owner, jo_sale.staff_owner, mc.base_staff_owner) AS current_staff_owner,
    'PM', mc.base_staff_owner,
    mc.first_dollar_date, mc.first_pm_date, mc.first_dollar_owner,
    oed.new_user_exp_date,
    mc.base_gmv, 0.0,
    CASE
      WHEN jo_port.commercial_owner IN ('KAM','ADMIN') THEN 'transfer_out'
      WHEN jo_sale.outlet_id IS NOT NULL              THEN 'transfer_out'
      ELSE 'core_nrr'
    END,
    v_base_str,
    CASE
      WHEN jo_port.commercial_owner IN ('KAM','ADMIN') THEN 'inter'
      WHEN jo_sale.outlet_id IS NOT NULL              THEN 'external'
      ELSE NULL
    END
  FROM mar_cohort mc
  LEFT JOIN outlet_exp_date oed  ON mc.outlet_id = oed.outlet_id
  LEFT JOIN sep_own jo_pm  ON mc.outlet_id = jo_pm.outlet_id
    AND jo_pm.commercial_owner = 'PM'
  LEFT JOIN sep_own jo_port ON mc.outlet_id = jo_port.outlet_id
    AND jo_port.commercial_owner IN ('KAM','ADMIN')
  LEFT JOIN sep_own jo_sale ON mc.outlet_id = jo_sale.outlet_id
    AND jo_sale.commercial_owner = 'SALE'
  WHERE jo_pm.outlet_id IS NULL
    AND v_m3_days > 0  -- v6-fix: skip silent-outlet fallback if month 3 hasn't started yet
),

all_rows AS (
  SELECT * FROM jul_rows
  UNION ALL SELECT * FROM aug_rows
  UNION ALL SELECT * FROM sep_rows
)

SELECT
  r.period_month, r.movement_type, r.transfer_scope,
  r.current_portfolio, r.current_staff_owner,
  r.base_portfolio, r.base_staff_owner,
  r.outlet_id, r.account_id, r.account_name, r.res_name, COALESCE(um.account_type, r.account_type) AS account_type,
  r.cohort_month,
  ROUND(r.curr_gmv, 0) AS curr_gmv,
  ROUND(r.base_gmv, 0) AS base_gmv,
  p.base_days,
  CASE r.period_month
    WHEN v_m1_str THEN p.jul_days
    WHEN v_m2_str THEN p.aug_days
    WHEN v_m3_str THEN p.sep_days
  END AS curr_days,
  r.first_dollar_date,
  r.first_pm_date AS first_portfolio_date,
  r.first_dollar_owner,
  r.new_user_exp_date
FROM all_rows r
CROSS JOIN params p
LEFT JOIN user_account_type um ON r.outlet_id = um.outlet_id
ORDER BY r.period_month, r.current_portfolio, r.movement_type, r.curr_gmv DESC

