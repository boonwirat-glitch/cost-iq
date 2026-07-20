-- ══════════════════════════════════════════════════════════════
-- Q3C Team Summary — GROUP-KEY GRAIN (v1): sense_upsell_team_groups.csv
--
-- NEW fast-path file supporting per-category / per-group_key Upsell bonus
-- rates (2026-07-19). The existing sense_upsell_team.csv
-- (q3c_upsell_team_summary_v4.sql) collapses P1/P3 all the way to a single
-- number per KAM, which destroys the category dimension a per-category
-- bonus rate needs. This file keeps the same classification logic but stops
-- the rollup at (kam_email, category, group_key) instead of (kam_email), so
-- the app can apply a different rate per category/group and still have a
-- fast (no per-KAM-bundle-fetch) path for TL/Admin views.
--
-- Output: kam_email, category, group_key, p1_gmv, p3_incremental
--   (Expansion / tl_upsell_base stay in sense_upsell_team.csv — they have no
--    group_key dimension and are unaffected by this feature.)
--
-- Logic is byte-identical to q3c_upsell_team_summary_v4.sql (same quarter
-- anchors, same frozen baseline, same v880-fix single-month rule) EXCEPT:
--   1. category_high_level selected as its own column (was discarded).
--   2. rollup grain = (kam_email, category, group_key), not (kam_email).
--   3. roster includes the 4 PM/AD via expected_owner (KAM→'KAM', PM/AD→'PM'),
--      same mechanism as the other roster'd files — so Ice/PMs' qualifying
--      groups appear too. (q3c_upsell_team_summary_v4.sql itself still needs
--      this roster update in a later pass; kept in sync here from the start.)
--
-- Refresh: same cadence as sense_upsell_team.csv (monthly, or on demand).
-- ══════════════════════════════════════════════════════════════
DECLARE v_p3_min_incremental FLOAT64 DEFAULT 8000;

DECLARE v_base_start DATE;
DECLARE v_base_end   DATE;
DECLARE v_lookback_start DATE;
DECLARE v_m1_start DATE; DECLARE v_m1_end DATE;
DECLARE v_m2_start DATE; DECLARE v_m2_end DATE;
DECLARE v_m3_start DATE; DECLARE v_m3_end DATE;
DECLARE v_current_mo_start DATE;

SET v_m1_start   = DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), QUARTER);
SET v_base_start = DATE_SUB(v_m1_start, INTERVAL 1 MONTH);
SET v_base_end   = DATE_SUB(v_m1_start, INTERVAL 1 DAY);
SET v_lookback_start = DATE_SUB(v_base_start, INTERVAL 2 MONTH);
SET v_m2_start   = DATE_ADD(v_m1_start, INTERVAL 1 MONTH);
SET v_m1_end     = DATE_SUB(v_m2_start, INTERVAL 1 DAY);
SET v_m3_start   = DATE_ADD(v_m1_start, INTERVAL 2 MONTH);
SET v_m2_end     = DATE_SUB(v_m3_start, INTERVAL 1 DAY);
SET v_m3_end     = DATE_SUB(DATE_ADD(v_m3_start, INTERVAL 1 MONTH), INTERVAL 1 DAY);
SET v_current_mo_start = DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), MONTH);

WITH
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

-- Roster — 15 KAM + 4 PM/AD. expected_owner binds each person to their
-- commercial_owner tag ('KAM' vs 'PM') so a blanket IN ('KAM','PM') can't
-- leak an existing KAM's incidental PM-tagged outlets into their figures.
kam_list AS (
  SELECT kam_name, kam_email, expected_owner FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'         AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Chaklid (Dent) Nimraor'               AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Duangruedee (Ning) Bulalom'           AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Guntinun (Monet) Thanoochan'          AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Intuon (Jane) Yanakit'                AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Napat (To) Kaikaew'                   AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Natchita (Foam) Bunkong'              AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Niracha (Cream) Sangka'               AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Nuttawan (Kwang) Mahaporn'            AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Treerak (May) Sangjua'                AS kam_name, 'treerak.s@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Panitan (Aom) Promta'                 AS kam_name, 'panitan.p@freshket.co'      AS kam_email, 'PM'  AS expected_owner),
    STRUCT('Sarawoot (Oh) Kaewkhao'               AS kam_name, 'sarawoot.k@freshket.co'     AS kam_email, 'PM'  AS expected_owner),
    STRUCT('Nichamon (Ninew) Kanghae'             AS kam_name, 'nichamon.k@freshket.co'     AS kam_email, 'PM'  AS expected_owner),
    STRUCT('Ornpreya (Ice) Sukthai'               AS kam_name, 'ornpreya.s@freshket.co'     AS kam_email, 'PM'  AS expected_owner)
  ])
),

kam_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)       AS res_id,
    CAST(um.account_guid AS STRING) AS account_id,
    k.kam_email
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
   AND um.commercial_owner = k.expected_owner
  WHERE um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

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
-- core NRR outlet = same roster member (KAM or PM/AD) owned it at base AND
-- in this elapsed month (matched via expected_owner, not a bare 'KAM').
nrr_core_outlets AS (
  SELECT m.month_no, m.outlet_id
  FROM month_outlet_ownership m
  JOIN apr_outlet_ownership a ON m.outlet_id = a.outlet_id
  JOIN kam_list k_m ON m.commercial_owner = k_m.expected_owner AND TRIM(m.staff_owner) = TRIM(k_m.kam_name)
  JOIN kam_list k_a ON a.commercial_owner = k_a.expected_owner AND TRIM(a.staff_owner) = TRIM(k_a.kam_name)
    AND k_a.kam_email = k_m.kam_email
  WHERE (a.new_user_exp_date IS NULL OR a.new_user_exp_date < v_base_start)
),

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

-- category_high_level kept as its own column (⭐ the change this file exists for)
group_key_def AS (
  SELECT
    em.month_no, ka.kam_email, ka.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    i.category_high_level AS category,
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
    gk.month_no, gk.kam_email, gk.account_id, gk.outlet_id, gk.category, gk.group_key,
    os.outlet_type,
    SUM(gk.gmv_ex_vat) AS total_gmv,
    SUM(CASE WHEN os.outlet_type = 'existing' THEN gk.gmv_ex_vat ELSE 0 END) AS existing_gmv
  FROM group_key_def gk
  LEFT JOIN outlet_status os
    ON gk.month_no = os.month_no AND gk.account_id = os.account_id AND gk.outlet_id = os.outlet_id
  GROUP BY 1, 2, 3, 4, 5, 6, 7
),

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

commission_items AS (
  SELECT
    c.month_no, c.kam_email, c.account_id, c.outlet_id, c.category, c.group_key,
    c.outlet_type, c.existing_gmv, c.total_gmv,
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

-- v880-fix single-month rule (current report_month only, no cumulative sum)
p1p3_single AS (
  SELECT
    kam_email, account_id, outlet_id, category, group_key,
    CASE
      WHEN is_p1 = 1 AND total_gmv >= 5000 THEN existing_gmv
      WHEN is_p3 = 1 THEN existing_gmv - max_bl
      ELSE 0
    END AS amount,
    is_p1 = 1 AS is_p1_type
  FROM commission_items
  WHERE month_no = (SELECT n FROM report_month)
    AND ((is_p1 = 1 AND total_gmv >= 5000) OR is_p3 = 1)
)

SELECT
  kam_email,
  category,
  group_key,
  ROUND(SUM(CASE WHEN is_p1_type THEN amount ELSE 0 END), 2) AS p1_gmv,
  ROUND(SUM(CASE WHEN NOT is_p1_type THEN amount ELSE 0 END), 2) AS p3_incremental
FROM p1p3_single
GROUP BY 1, 2, 3
HAVING p1_gmv > 0 OR p3_incremental > 0
ORDER BY kam_email, category, group_key;
