-- Q10_V7: portview_handover.csv
-- ใช้ export เป็นไฟล์ portview_handover.csv แล้วอัปขึ้น R2
--
-- Logic:
--   Sales→KAM = outlet ที่มี commercial_owner=SALE ใน 3 เดือนย้อนหลัง
--               แล้ว commercial_owner=KAM ในเดือนนี้
--   ทุก row ใน Q10 นี้คือ Sales→KAM → prev_owner = 'SALE' ทุก row
--
-- Output schema (16 columns) — backward compatible กับ parser:
--   [0]  kam_name           = sales_owner (old KAM / Sales ที่ส่งออก)
--   [1]  account_id         = UUID ของ account
--   [2]  account_name
--   [3]  account_type
--   [4]  last_month_gmv     = gmv_apr (backward compat)
--   [5]  cur_month_gmv      = gmv เดือนนี้ MTD
--   [6]  new_owner_type     = 'KAM'
--   [7]  new_kam_name       = KAM ที่รับ
--   [8]  transfer_basis     = 'sales_to_kam'
--   [9]  last_order_date    = วันที่ล่าสุด
--   [10] prev_owner         = 'SALE' (ทุก row)
--   [11] transfer_month     = YYYY-MM เดือนที่โอน (M-1)
--   [12] baseline_gmv       = GMV เดือน M-1 ทั้งเดือน (normalize base)
--   [13] perf_gmv           = GMV เดือน M MTD (วัด performance)
--   [14] perf_days_in_month = จำนวนวันในเดือน M
--   [15] baseline_days_in_month = จำนวนวันในเดือน M-1

WITH params AS (
  SELECT
    -- เดือนนี้ (M)
    DATE_TRUNC(CURRENT_DATE(), MONTH)                                              AS cm_start,
    (SELECT MAX(delivery_date) FROM `freshket-rn.dwh.order`
     WHERE delivery_date >= DATE_TRUNC(CURRENT_DATE(), MONTH))                    AS cm_max_date,
    DATE_DIFF(DATE_ADD(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 MONTH),
              DATE_TRUNC(CURRENT_DATE(), MONTH), DAY)                              AS cm_days,
    FORMAT_DATE('%Y-%m', CURRENT_DATE())                                           AS cm_label,
    -- เดือนก่อน (M-1) = transfer month / baseline
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)                 AS lm_start,
    DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 DAY)                   AS lm_end,
    DATE_DIFF(DATE_TRUNC(CURRENT_DATE(), MONTH),
              DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH), DAY) AS lm_days,
    FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH))              AS lm_label
),

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
    STRUCT('Pavarisa (Ploiiy) Muangtaeng'         AS kam_name, 'pavarisa.mu@freshket.co'    AS kam_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon' AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email)
  ])
),

-- SALE orders เฉพาะ 3 เดือนย้อนหลัง
last_sale_order AS (
  SELECT
    CAST(user_id AS STRING)    AS user_id,
    CAST(account_id AS STRING) AS account_id,
    MAX(account_name)          AS account_name,
    MAX(account_type)          AS account_type,
    ARRAY_AGG(staff_owner ORDER BY delivery_date DESC LIMIT 1)[OFFSET(0)] AS sales_owner,
    MAX(delivery_date)         AS last_sale_date
  FROM `freshket-rn.dwh.order`
  WHERE account_type IN ('SA', 'MC', 'Chain')
    AND commercial_owner = 'SALE'
    AND delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH), MONTH)
    AND delivery_date < DATE_TRUNC(CURRENT_DATE(), MONTH)
  GROUP BY 1, 2
),

-- Source 1: outlet ที่มี SALE order ใน M-2 หรือ M-1
apr_from_orders AS (
  SELECT
    CAST(user_id AS STRING)    AS user_id,
    CAST(account_id AS STRING) AS account_id,
    MAX(account_name)          AS account_name,
    MAX(account_type)          AS account_type,
    ARRAY_AGG(staff_owner ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)] AS sales_owner,
    MAX(delivery_date)         AS last_order_date,
    SUM(gmv_ex_vat)            AS baseline_gmv  -- GMV M-1 ทั้งเดือน
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN lm_start AND lm_end
    AND commercial_owner = 'SALE'
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1, 2
),

-- Source 2: outlet ที่ user_master=KAM + มี SALE order ใน 3 เดือน + ไม่มีใน M-1
apr_from_master AS (
  SELECT
    CAST(um.res_id AS STRING)       AS user_id,
    CAST(um.account_guid AS STRING) AS account_id,
    um.account_name,
    um.account_type,
    ls.sales_owner,
    ls.last_sale_date               AS last_order_date,
    0                               AS baseline_gmv
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  JOIN last_sale_order ls ON CAST(um.res_id AS STRING) = ls.user_id
  WHERE um.account_type IN ('SA', 'MC', 'Chain')
    AND um.commercial_owner = 'KAM'
    AND um.res_id IS NOT NULL
    AND CAST(um.res_id AS STRING) NOT IN (SELECT user_id FROM apr_from_orders)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

-- รวม sources
apr AS (
  SELECT * FROM apr_from_orders
  UNION ALL
  SELECT * FROM apr_from_master
),

-- GMV เดือนนี้ MTD (perf_gmv)
gmv_cm AS (
  SELECT
    CAST(user_id AS STRING) AS user_id,
    SUM(gmv_ex_vat)         AS perf_gmv
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN cm_start AND cm_max_date
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

-- KAM ที่รับจาก order เดือนนี้
may_orders AS (
  SELECT
    CAST(user_id AS STRING) AS user_id,
    ARRAY_AGG(staff_owner ORDER BY gmv_ex_vat DESC LIMIT 1)[OFFSET(0)] AS new_kam_name
  FROM `freshket-rn.dwh.order`, params
  WHERE delivery_date BETWEEN cm_start AND cm_max_date
    AND commercial_owner = 'KAM'
    AND account_type IN ('SA', 'MC', 'Chain')
  GROUP BY 1
),

-- KAM จาก user_master สำหรับ outlet ที่ยังไม่มี order เดือนนี้
user_master_kam AS (
  SELECT
    CAST(um.res_id AS STRING) AS user_id,
    k.kam_name                AS new_kam_name
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.account_type IN ('SA', 'MC', 'Chain')
    AND um.commercial_owner = 'KAM'
    AND um.res_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
)

SELECT
  -- [0] kam_name = sales_owner (backward compat: ใครส่งออก)
  a.sales_owner                                         AS kam_name,
  -- [1] account_id
  a.account_id,
  -- [2] account_name
  a.account_name,
  -- [3] account_type
  a.account_type,
  -- [4] last_month_gmv = baseline GMV (backward compat)
  CAST(ROUND(a.baseline_gmv) AS INT64)                  AS last_month_gmv,
  -- [5] cur_month_gmv = perf GMV MTD
  CAST(ROUND(COALESCE(cm.perf_gmv, 0)) AS INT64)        AS cur_month_gmv,
  -- [6] new_owner_type
  'KAM'                                                 AS new_owner_type,
  -- [7] new_kam_name
  COALESCE(mo.new_kam_name, um.new_kam_name)            AS new_kam_name,
  -- [8] transfer_basis
  'sales_to_kam'                                        AS transfer_basis,
  -- [9] last_order_date
  CAST(a.last_order_date AS STRING)                     AS last_order_date,
  -- [10] prev_owner = SALE ทุก row (เพราะ Q10 นี้คือ Sales→KAM ทั้งหมด)
  'SALE'                                                AS prev_owner,
  -- [11] transfer_month = M-1
  p.lm_label                                            AS transfer_month,
  -- [12] baseline_gmv = GMV M-1 ทั้งเดือน
  CAST(ROUND(a.baseline_gmv) AS INT64)                  AS baseline_gmv,
  -- [13] perf_gmv = GMV M MTD
  CAST(ROUND(COALESCE(cm.perf_gmv, 0)) AS INT64)        AS perf_gmv,
  -- [14] perf_days_in_month
  p.cm_days                                             AS perf_days_in_month,
  -- [15] baseline_days_in_month
  p.lm_days                                             AS baseline_days_in_month
FROM apr a
CROSS JOIN params p
LEFT JOIN gmv_cm cm         ON a.user_id = cm.user_id
LEFT JOIN may_orders mo     ON a.user_id = mo.user_id
LEFT JOIN user_master_kam um ON a.user_id = um.user_id
WHERE COALESCE(mo.new_kam_name, um.new_kam_name) IS NOT NULL
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY a.account_id
  ORDER BY a.baseline_gmv DESC
) = 1
ORDER BY COALESCE(mo.new_kam_name, um.new_kam_name), a.baseline_gmv DESC
