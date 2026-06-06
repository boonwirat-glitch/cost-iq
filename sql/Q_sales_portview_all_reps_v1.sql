-- ════════════════════════════════════════════════════════════════════════════
-- Q_SALES_PORTVIEW_ALL_REPS v1
-- รันครั้งเดียวได้ทุก rep — export เป็น download_sales_portview.csv
-- แล้วใช้ splitter.py แยกเป็น sales_portview_{safeKey}.csv ต่อ rep → upload R2
--
-- NOTE: col[0] = sales_email (splitter ใช้ แล้วตัดออกก่อน upload)
--       col[1..23] = เหมือน Q_sales_portview_v1.sql ทุกอย่าง
-- ════════════════════════════════════════════════════════════════════════════

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

-- ── Sales rep list — ทุก 15 คน ──────────────────────────────────────
sales_list AS (
  SELECT sales_name, sales_email FROM UNNEST([
    STRUCT('Guitar'    AS sales_name, 'malisa.c@freshket.co'      AS sales_email),
    STRUCT('Ubib'      AS sales_name, 'nichapa.s@freshket.co'      AS sales_email),
    STRUCT('Puifaii'   AS sales_name, 'nichita.n@freshket.co'      AS sales_email),
    STRUCT('Job'       AS sales_name, 'phongsakorn.j@freshket.co'  AS sales_email),
    STRUCT('Eyes'      AS sales_name, 'sirinrat.s@freshket.co'     AS sales_email),
    STRUCT('Vicky'     AS sales_name, 'wilailak.w@freshket.co'     AS sales_email),
    STRUCT('Faii'      AS sales_name, 'benjawan.a@freshket.co'     AS sales_email),
    STRUCT('Namtan'    AS sales_name, 'kanokwan.w@freshket.co'     AS sales_email),
    STRUCT('Kan'       AS sales_name, 'kanthicha.s@freshket.co'    AS sales_email),
    STRUCT('Gift'      AS sales_name, 'nannapas.c@freshket.co'     AS sales_email),
    STRUCT('Fon'       AS sales_name, 'pattama.t@freshket.co'      AS sales_email),
    STRUCT('Tonaor'    AS sales_name, 'rujira.p@freshket.co'       AS sales_email),
    STRUCT('Dutchmill' AS sales_name, 'sasaluk.t@freshket.co'      AS sales_email),
    STRUCT('Mook'      AS sales_name, 'supanida.r@freshket.co'     AS sales_email),
    STRUCT('Ying'      AS sales_name, 'thida.p@freshket.co'        AS sales_email)
  ])
),

-- ── Active outlets per rep ───────────────────────────────────────────
sales_outlets AS (
  SELECT
    LOWER(TRIM(sl.sales_email))         AS sales_email,
    CAST(um.res_id AS STRING)           AS res_id,
    CAST(um.account_guid AS STRING)     AS account_id,
    um.account_name,
    um.res_name,
    um.account_type,
    um.account_class,
    sl.sales_name,
    um.sales_team_name,
    um.first_dollar_date,
    um.new_user_exp_date,
    DATE_DIFF(
      (SELECT lag_date FROM params),
      um.first_dollar_date, DAY)        AS days_held,
    DATE(um.lasted_order_date)          AS lasted_order_date
  FROM `freshket-rn.dim.user_master` um
  JOIN sales_list sl
    ON LOWER(TRIM(um.sales_owner_email)) = LOWER(TRIM(sl.sales_email))
  WHERE um.first_dollar_date IS NOT NULL
    AND um.new_user_exp_date >= (SELECT lag_date FROM params)
    AND um.user_status NOT IN ('suspended', 'deleted')
    AND um.res_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

-- ── GMV last month per outlet ────────────────────────────────────────
gmv_last_outlet AS (
  SELECT
    CAST(o.user_id AS STRING)            AS res_id,
    ROUND(SUM(i.gmv_ex_vat), 0)         AS last_gmv
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i, params_derived p
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.last_month_start
    AND i.gmv_ex_vat > 0
  GROUP BY 1
),

-- ── GMV current month MTD per outlet ────────────────────────────────
gmv_cur_outlet AS (
  SELECT
    CAST(o.user_id AS STRING)            AS res_id,
    ROUND(SUM(i.gmv_ex_vat), 0)         AS cur_gmv,
    COUNT(DISTINCT o.order_id)           AS orders_to_date
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i, params_derived p
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = p.cur_month_start
    AND o.delivery_date <= p.max_date
    AND i.gmv_ex_vat > 0
  GROUP BY 1
),

-- ── YTD active filter ────────────────────────────────────────────────
ytd_active_outlet AS (
  SELECT DISTINCT CAST(o.user_id AS STRING) AS res_id
  FROM `freshket-rn.dwh.order` o, params_derived p
  WHERE o.delivery_date >= p.ytd_start
    AND o.delivery_date <= p.max_date
),

-- ── TL email mapping ─────────────────────────────────────────────────
sales_tl_map AS (
  SELECT team, tl_email FROM UNNEST([
    STRUCT('Sales Team A' AS team, 'tao@freshket.co'      AS tl_email),
    STRUCT('Sales Team B' AS team, 'yunyun@freshket.co'   AS tl_email),
    STRUCT('Sales Team C' AS team, 'Salmon@freshket.co'   AS tl_email)
  ])
)

-- ── FINAL OUTPUT ─────────────────────────────────────────────────────
-- col[0]  = sales_email  ← splitter key (removed before upload)
-- col[1..23] = พอดีกับ parsePortviewBulk cols 0-22
SELECT
  so.sales_email,                                                             -- [0]  splitter key
  so.account_id,                                                              -- [1]  → col[0]
  so.res_name,                                                                -- [2]  → col[1]
  COALESCE(gl.last_gmv, 0)                              AS last_month_gmv,   -- [3]  → col[2]
  COALESCE(gc.cur_gmv, 0)                               AS gmv_to_date,      -- [4]  → col[3]
  p.days_elapsed,                                                             -- [5]  → col[4]
  p.days_in_month,                                                            -- [6]  → col[5]
  ROUND(
    COALESCE(gc.cur_gmv, 0) / NULLIF(p.days_elapsed, 0) * p.days_in_month
  , 0)                                                  AS runrate_gmv,      -- [7]  → col[6]
  so.account_type,                                                            -- [8]  → col[7]
  0                                                     AS churned_sku_count, -- [9]  → col[8]
  0                                                     AS churned_gmv,      -- [10] → col[9]
  ''                                                    AS top_churned_names, -- [11] → col[10]
  0                                                     AS missing_cat_count, -- [12] → col[11]
  ''                                                    AS missing_cats,     -- [13] → col[12]
  0                                                     AS last_month_sku_count, -- [14] → col[13]
  0                                                     AS cur_sku_count,    -- [15] → col[14]
  COALESCE(gc.orders_to_date, 0)                        AS orders_to_date,   -- [16] → col[15]
  so.sales_name                                         AS kam_name,         -- [17] → col[16]
  so.sales_email                                        AS kam_email,        -- [18] → col[17]
  tm.tl_email,                                                                -- [19] → col[18]
  so.days_held                                          AS days_with_current_kam, -- [20] → col[19]
  so.first_dollar_date,                                                       -- [21] → col[20]
  so.new_user_exp_date,                                                       -- [22] → col[21]
  so.days_held,                                                               -- [23] → col[22]
  so.sales_team_name                                                          -- [24] → col[23]

FROM sales_outlets so
JOIN ytd_active_outlet ya  ON ya.res_id = so.res_id
LEFT JOIN gmv_last_outlet gl ON gl.res_id = so.res_id
LEFT JOIN gmv_cur_outlet  gc ON gc.res_id = so.res_id
LEFT JOIN sales_tl_map    tm ON tm.team = so.sales_team_name
CROSS JOIN params_derived p

ORDER BY so.sales_email, so.new_user_exp_date ASC
;
