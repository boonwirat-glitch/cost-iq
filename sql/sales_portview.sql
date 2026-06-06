-- ════════════════════════════════════════════════════════════
-- SALES_PORTVIEW v1
-- Output: ส่วน Sales ของ portview.csv
-- Schema: 24 columns ตรง parsePortviewBulk (col 0-23)
--   col 0-19: เหมือน KAM (account_id, name, gmv, runrate, ฯลฯ)
--   col 20-23: Sales-specific (first_dollar_date, new_user_exp_date,
--              days_held, sales_team_name)
--
-- Ownership: dim.user_master WHERE commercial_owner='SALE'
--   → res_id (stable) + account_guid
--   JOIN dwh.order ผ่าน res_id (เหมือน KAM)
--   → GMV นับตาม order จริง ไม่ filter commercial_owner ใน order
--     (เพราะ KAM portview ก็ไม่ filter — ใช้ dim.user_master เป็น source of truth)
--
-- Grain: outlet level (res_id) — Sales ดูรายร้าน ไม่ roll-up เป็น account
--   เพราะ new_user_exp_date อยู่ที่ outlet level
-- ════════════════════════════════════════════════════════════

WITH params AS (
  SELECT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY) AS lag_date
),
params_derived AS (
  SELECT
    lag_date,
    DATE_TRUNC(lag_date, MONTH)                                      AS cur_month_start,
    DATE_TRUNC(DATE_SUB(lag_date, INTERVAL 1 MONTH), MONTH)          AS last_month_start,
    DATE_TRUNC(lag_date, YEAR)                                       AS ytd_start,
    lag_date                                                          AS max_date,
    DATE_DIFF(lag_date, DATE_TRUNC(lag_date, MONTH), DAY) + 1        AS days_elapsed,
    EXTRACT(DAY FROM LAST_DAY(lag_date))                             AS days_in_month
  FROM params
),

sales_list AS (
  SELECT staff_owner_email FROM UNNEST([
    'malisa.c@freshket.co','nichapa.s@freshket.co','nichita.n@freshket.co',
    'phongsakorn.j@freshket.co','sirinrat.s@freshket.co','wilailak.w@freshket.co',
    'benjawan.a@freshket.co','kanokwan.w@freshket.co','kanthicha.s@freshket.co',
    'nannapas.c@freshket.co','pattama.t@freshket.co','rujira.p@freshket.co',
    'sasaluk.t@freshket.co','supanida.r@freshket.co','thida.p@freshket.co'
  ]) AS staff_owner_email
),

-- Ownership จาก dim.user_master — outlet ที่ยังอยู่ใน tenure Sales
sale_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)       AS res_id,
    CAST(um.account_guid AS STRING) AS account_id,
    um.account_name,
    um.res_name,
    um.account_type,
    um.account_class,
    um.staff_owner                  AS sales_name,
    um.staff_owner_email            AS sales_email,
    um.sales_team_name,
    um.first_dollar_date,
    um.new_user_exp_date,
    DATE_DIFF(
      (SELECT lag_date FROM params),
      um.first_dollar_date, DAY)    AS days_held,
    DATE(um.lasted_order_date)      AS lasted_order_date
  FROM `freshket-rn.dim.user_master` um
  JOIN sales_list sl
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(sl.staff_owner_email))
  WHERE um.commercial_owner = 'SALE'
    AND um.first_dollar_date IS NOT NULL
    AND um.new_user_exp_date >= (SELECT lag_date FROM params)
    AND um.user_status NOT IN ('suspended','deleted')
    AND um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

-- TL email mapping
sales_tl_map AS (
  SELECT team, tl_email FROM UNNEST([
    STRUCT('Sales Team A' AS team, 'tao@freshket.co'    AS tl_email),
    STRUCT('Sales Team B' AS team, 'yunyun@freshket.co' AS tl_email),
    STRUCT('Sales Team C' AS team, 'Salmon@freshket.co' AS tl_email)
  ])
),

-- GMV last month per outlet (ผ่าน res_id)
gmv_last_outlet AS (
  SELECT
    CAST(o.user_id AS STRING)        AS res_id,
    ROUND(SUM(i.gmv_ex_vat), 0)     AS last_gmv
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i, params_derived p
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.last_month_start
    AND i.gmv_ex_vat > 0
  GROUP BY 1
),

-- GMV current month MTD per outlet
gmv_cur_outlet AS (
  SELECT
    CAST(o.user_id AS STRING)        AS res_id,
    ROUND(SUM(i.gmv_ex_vat), 0)     AS cur_gmv,
    COUNT(DISTINCT o.order_id)       AS orders_to_date
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i, params_derived p
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.cur_month_start
    AND o.delivery_date <= p.max_date
    AND i.gmv_ex_vat > 0
  GROUP BY 1
),

-- YTD filter: ตัดร้านตาย
ytd_active_outlet AS (
  SELECT DISTINCT CAST(o.user_id AS STRING) AS res_id
  FROM `freshket-rn.dwh.order` o, params_derived p
  WHERE o.delivery_date >= p.ytd_start
    AND o.delivery_date <= p.max_date
)

-- FINAL: 24 columns ตรง parsePortviewBulk col 0-23
SELECT
  so.account_id,                                                              -- [0]
  so.res_name,                                                                -- [1]
  COALESCE(gl.last_gmv, 0)                              AS last_month_gmv,   -- [2]
  COALESCE(gc.cur_gmv, 0)                               AS gmv_to_date,      -- [3]
  p.days_elapsed,                                                             -- [4]
  p.days_in_month,                                                            -- [5]
  ROUND(
    COALESCE(gc.cur_gmv, 0) / NULLIF(p.days_elapsed, 0) * p.days_in_month
  , 0)                                                  AS runrate_gmv,      -- [6]
  so.account_type,                                                            -- [7]
  0                                                     AS churned_sku_count, -- [8]
  0                                                     AS churned_gmv,       -- [9]
  ''                                                    AS top_churned_names, -- [10]
  0                                                     AS missing_cat_count, -- [11]
  ''                                                    AS missing_cats,      -- [12]
  0                                                     AS last_month_sku_count, -- [13]
  0                                                     AS cur_sku_count,     -- [14]
  COALESCE(gc.orders_to_date, 0)                        AS orders_to_date,   -- [15]
  so.sales_name                                         AS kam_name,          -- [16]
  so.sales_email                                        AS kam_email,         -- [17]
  tm.tl_email,                                                                -- [18]
  so.days_held                                          AS days_with_current_kam, -- [19]
  so.first_dollar_date,                                                       -- [20]
  so.new_user_exp_date,                                                       -- [21]
  so.days_held,                                                               -- [22]
  so.sales_team_name                                    AS sales_team_name    -- [23]

FROM sale_outlets so
JOIN ytd_active_outlet ya  ON ya.res_id = so.res_id
LEFT JOIN gmv_last_outlet gl ON gl.res_id = so.res_id
LEFT JOIN gmv_cur_outlet  gc ON gc.res_id = so.res_id
LEFT JOIN sales_tl_map    tm ON tm.team = so.sales_team_name
CROSS JOIN params_derived p

ORDER BY so.sales_email, so.new_user_exp_date ASC;
