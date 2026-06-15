-- ============================================================
-- Q10 final — Commission Handover: Sales→KAM
-- ============================================================
-- Purpose : portview_handover.csv สำหรับ commission เท่านั้น
-- Meaning  : Apr Sales→KAM handover → วัด May KAM retention
-- Grain    : 1 row per outlet (res_id)
--
-- Logic: ลอกจาก my_sql ที่ validate แล้ว (44 rows KEEP)
-- PATH A: new_user_exp_date อยู่ใน Apr
-- PATH B: new_user_exp_date = NULL
--         AND last_sale_order_date (MAX SALE จากทุก 6 เดือน) อยู่ใน Apr
-- Exclude: fallback ที่ effective_sales_owner = Admin Freshket
-- ============================================================

WITH

params AS (
  SELECT
    -- lag_date: day-1 anchor (data pipeline lag = 1 day always)
    -- ensures month boundary (e.g. Jun 1) sees May as perf_month, not empty June
    DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)                                AS lag_date,
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH)             AS perf_month_start,
    DATE_SUB(DATE_TRUNC(DATE_ADD(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH), MONTH), INTERVAL 1 DAY)
                                                                             AS perf_month_end,
    FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))          AS perf_month_label,
    DATE_DIFF(
      DATE_TRUNC(DATE_ADD(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH), MONTH),
      DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH), DAY
    )                                                                        AS perf_days_in_month,

    DATE_TRUNC(DATE_SUB(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH), MONTH)
                                                                             AS prev_month_start,
    DATE_SUB(DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH), INTERVAL 1 DAY)
                                                                             AS prev_month_end,
    FORMAT_DATE('%Y-%m', DATE_SUB(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH))
                                                                             AS prev_month_label,
    DATE_DIFF(
      DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), MONTH),
      DATE_TRUNC(DATE_SUB(DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), INTERVAL 1 MONTH), MONTH), DAY
    )                                                                        AS prev_days_in_month
),

kam_name_list AS (
  SELECT kam_name FROM UNNEST([
    'Anusorn (Bookbig) Khamphasuk',
    'Chaklid (Dent) Nimraor',
    'Duangruedee (Ning) Bulalom',
    'Guntinun (Monet) Thanoochan',
    'Intuon (Jane) Yanakit',
    'Napat (To) Kaikaew',
    'Natchita (Foam) Bunkong',
    'Niracha (Cream) Sangka',
    'Nuttawan (Kwang) Mahaporn',
    'Ploynitcha (Nitcha) Rujipiromthagoon',
    'Puttipong (Tape) Wanithaweewat',
    'Rinlaphat (Mild) Setthasiriwuti',
    'Siriprapa (Pop) Piapeng',
    'Warissara (Ply) Chanaboon',
    'Treerak (May) Sangjua'
  ]) AS kam_name
),

-- QUALIFY ก่อน filter commercial_owner (ตรงกับ my_sql)
user_master_latest AS (
  SELECT
    CAST(um.res_id AS STRING)        AS user_id,
    CAST(um.account_guid AS STRING)  AS account_id,
    um.account_name,
    um.account_type,
    UPPER(TRIM(COALESCE(um.commercial_owner, ''))) AS commercial_owner,
    TRIM(COALESCE(um.sales_owner, ''))             AS sales_owner,
    TRIM(COALESCE(
      NULLIF(um.staff_owner, ''),
      NULLIF(um.kam_owner,   ''),
      NULLIF(um.ka_owner,    ''),
      ''
    ))                                             AS new_kam_name,
    DATE(um.first_dollar_date)       AS first_dollar_date,
    DATE(um.new_user_exp_date)       AS new_user_exp_date,
    DATE(um.lasted_order_date)       AS lasted_order_date,
    FORMAT_DATE('%Y-%m', DATE(um.new_user_exp_date)) AS exp_month,
    um.sales_owner                   AS raw_sales_owner,
    um.staff_owner                   AS raw_staff_owner,
    um.kam_owner                     AS raw_kam_owner,
    um.ka_owner                      AS raw_ka_owner
  FROM `freshket-rn.dim.user_master` um
  WHERE um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
    AND um.account_type IN ('SA', 'MC', 'Chain', 'Unknown')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY DATE(um.lasted_order_date) DESC NULLS LAST
  ) = 1
),

user_master_kam AS (
  SELECT uml.*
  FROM user_master_latest uml
  JOIN kam_name_list k ON TRIM(uml.new_kam_name) = TRIM(k.kam_name)
  WHERE uml.commercial_owner = 'KAM'
    AND uml.sales_owner IS NOT NULL
    AND uml.sales_owner != ''
    AND uml.new_kam_name IS NOT NULL
    AND uml.new_kam_name != ''
),

order_base AS (
  SELECT
    CAST(user_id AS STRING)          AS user_id,
    CAST(account_id AS STRING)       AS account_id,
    account_name,
    account_type,
    CAST(delivery_date AS DATE)      AS delivery_date,
    FORMAT_DATE('%Y-%m', CAST(delivery_date AS DATE)) AS month_label,
    UPPER(TRIM(COALESCE(commercial_owner, ''))) AS commercial_owner,
    TRIM(COALESCE(staff_owner, ''))  AS staff_owner,
    SAFE_CAST(gmv_ex_vat AS FLOAT64) AS gmv_ex_vat
  FROM `freshket-rn.dwh.order`
  WHERE account_type IN ('SA', 'MC', 'Chain', 'Unknown')
    AND user_id    IS NOT NULL
    AND account_id IS NOT NULL
    AND delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH), MONTH)
),

sale_evidence AS (
  SELECT
    ob.user_id,
    COUNTIF(ob.commercial_owner = 'SALE')                                   AS sale_order_count_all,
    COUNTIF(
      ob.commercial_owner = 'SALE'
      AND ob.delivery_date BETWEEN p.prev_month_start AND p.prev_month_end
    )                                                                        AS sale_order_count_prev_month,
    -- MAX SALE order จากทุก 6 เดือน (ไม่จำกัดเฉพาะ Apr)
    MAX(IF(ob.commercial_owner = 'SALE', ob.delivery_date, NULL))           AS last_sale_order_date,
    ARRAY_AGG(
      IF(ob.commercial_owner = 'SALE', ob.staff_owner, NULL)
      IGNORE NULLS ORDER BY ob.delivery_date DESC LIMIT 1
    )[SAFE_OFFSET(0)]                                                        AS order_sales_owner,
    ARRAY_AGG(
      IF(
        ob.commercial_owner = 'SALE'
        AND ob.delivery_date BETWEEN p.prev_month_start AND p.prev_month_end,
        ob.staff_owner, NULL
      )
      IGNORE NULLS ORDER BY ob.delivery_date DESC LIMIT 1
    )[SAFE_OFFSET(0)]                                                        AS prev_month_order_sales_owner

  FROM order_base ob
  CROSS JOIN params p
  GROUP BY 1
),

gmv_by_user_month AS (
  SELECT
    user_id,
    month_label,
    SUM(gmv_ex_vat)      AS gmv,
    MAX(delivery_date)   AS last_order_date
  FROM order_base
  GROUP BY 1, 2
),

candidate AS (
  SELECT
    umk.*,
    se.sale_order_count_all,
    se.sale_order_count_prev_month,
    se.last_sale_order_date,
    se.order_sales_owner,
    se.prev_month_order_sales_owner,
    COALESCE(se.prev_month_order_sales_owner, se.order_sales_owner, umk.sales_owner)
                                                                             AS effective_sales_owner,
    CASE
      WHEN umk.new_user_exp_date IS NOT NULL
        AND umk.exp_month = p.prev_month_label
        THEN 'explicit_exp_date'
      WHEN umk.new_user_exp_date IS NULL
        AND se.last_sale_order_date BETWEEN p.prev_month_start AND p.prev_month_end
        THEN 'fallback_last_sale_in_prev_month'
      ELSE 'not_eligible'
    END                                                                      AS movement_source,
    CASE
      WHEN LOWER(TRIM(COALESCE(
        se.prev_month_order_sales_owner, se.order_sales_owner, umk.sales_owner, ''
      ))) = 'admin freshket'
        THEN TRUE
      ELSE FALSE
    END                                                                      AS is_admin_freshket_owner,
    FORMAT_DATE('%Y-%m', p.prev_month_start)                                 AS transfer_month,
    CASE
      WHEN umk.new_user_exp_date IS NOT NULL THEN umk.new_user_exp_date
      ELSE se.last_sale_order_date
    END                                                                      AS transfer_date
  FROM user_master_kam umk
  CROSS JOIN params p
  LEFT JOIN sale_evidence se ON se.user_id = umk.user_id
  WHERE
    (
      umk.new_user_exp_date IS NOT NULL
      AND umk.exp_month = p.prev_month_label
    )
    OR
    (
      umk.new_user_exp_date IS NULL
      AND se.last_sale_order_date BETWEEN p.prev_month_start AND p.prev_month_end
    )
),

final AS (
  SELECT
    c.user_id,
    c.account_id,
    c.account_name,
    c.account_type,
    c.effective_sales_owner          AS prev_owner_name,
    c.sales_owner,
    c.new_kam_name,
    c.transfer_month,
    c.transfer_date,
    COALESCE(base.gmv, 0)            AS baseline_gmv,
    COALESCE(perf.gmv, 0)            AS perf_gmv,
    c.movement_source,
    c.is_admin_freshket_owner,
    CASE
      WHEN c.movement_source = 'fallback_last_sale_in_prev_month'
        AND c.is_admin_freshket_owner = TRUE
        THEN 'EXCLUDE_ADMIN_FALLBACK'
      ELSE 'KEEP'
    END                              AS admin_filter_decision,
    c.sale_order_count_all,
    c.sale_order_count_prev_month,
    c.last_sale_order_date,
    c.first_dollar_date,
    c.new_user_exp_date,
    c.lasted_order_date,
    c.raw_sales_owner,
    c.raw_staff_owner,
    c.raw_kam_owner,
    c.raw_ka_owner,
    p.perf_days_in_month,
    p.prev_days_in_month
  FROM candidate c
  CROSS JOIN params p
  LEFT JOIN gmv_by_user_month base
    ON base.user_id = c.user_id AND base.month_label = c.transfer_month
  LEFT JOIN gmv_by_user_month perf
    ON perf.user_id = c.user_id AND perf.month_label = p.perf_month_label
  WHERE c.movement_source IN ('explicit_exp_date', 'fallback_last_sale_in_prev_month')
    AND NOT (
      c.movement_source = 'fallback_last_sale_in_prev_month'
      AND c.is_admin_freshket_owner = TRUE
    )
)

-- 16 backward-compatible cols + debug
SELECT
  -- [0]  kam_name = Sales owner ก่อนโอน
  f.prev_owner_name                                     AS kam_name,
  -- [1]  account_id
  f.account_id,
  -- [2]  account_name
  f.account_name,
  -- [3]  account_type
  f.account_type,
  -- [4]  last_month_gmv
  CAST(ROUND(f.baseline_gmv) AS INT64)                  AS last_month_gmv,
  -- [5]  cur_month_gmv
  CAST(ROUND(f.perf_gmv) AS INT64)                      AS cur_month_gmv,
  -- [6]  new_owner_type
  'KAM'                                                 AS new_owner_type,
  -- [7]  new_kam_name
  f.new_kam_name,
  -- [8]  transfer_basis
  'sales_to_kam'                                        AS transfer_basis,
  -- [9]  last_order_date
  CAST(f.last_sale_order_date AS STRING)                AS last_order_date,
  -- [10] prev_owner
  'SALE'                                                AS prev_owner,
  -- [11] transfer_month = "2026-04"
  f.transfer_month,
  -- [12] baseline_gmv
  CAST(ROUND(f.baseline_gmv) AS INT64)                  AS baseline_gmv,
  -- [13] perf_gmv
  CAST(ROUND(f.perf_gmv) AS INT64)                      AS perf_gmv,
  -- [14] perf_days_in_month
  f.perf_days_in_month,
  -- [15] baseline_days_in_month
  f.prev_days_in_month                                  AS baseline_days_in_month,

  -- debug cols
  f.user_id,
  f.movement_source                                     AS confidence,
  f.movement_source                                     AS handover_path,
  CAST(f.new_user_exp_date AS STRING)                   AS new_user_exp_date,
  CAST(f.last_sale_order_date AS STRING)                AS last_sale_order_date,
  f.sales_owner,
  'KAM'                                                 AS commercial_owner,
  f.raw_staff_owner                                     AS staff_owner,
  f.raw_kam_owner                                       AS kam_owner,
  f.raw_ka_owner                                        AS ka_owner,
  f.is_admin_freshket_owner,
  'KEEP'                                                AS exclude_reason

FROM final f

ORDER BY
  f.new_kam_name,
  f.baseline_gmv DESC,
  f.account_name;
