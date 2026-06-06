-- ════════════════════════════════════════════════════════════════════════════
-- Q_SALES_SKUS v1: Per-Sales Rep SKU Bundle
-- Output: sense_skus_{safeKey}.csv  (upload to R2)
-- Mirrors SQL1_sense_skus.sql but ownership = sales_owner_email
--
-- วิธีใช้: แทน '{SALES_EMAIL}' ด้วย email จริง เช่น malisa.c@freshket.co
--          export → ตั้งชื่อ sense_skus_{safeKey}.csv
--          safeKey = email.toLowerCase().replace(/[^a-z0-9]/g,'_')
--          เช่น malisa.c@freshket.co → malisa_c_freshket_co
--
-- NOTE: ใช้ active outlets เท่านั้น (new_user_exp_date >= today)
--       เพราะ Sales ดู SKU เฉพาะร้านที่ยังอยู่ในพอร์ต
-- ════════════════════════════════════════════════════════════════════════════

WITH params AS (
  SELECT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY) AS lag_date
),

-- Active Sales outlets for this rep (same filter as Q_sales_portview_v1)
sales_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)       AS res_id,
    CAST(um.account_guid AS STRING) AS account_id,
    um.res_name,
    um.account_name
  FROM `freshket-rn.dim.user_master` um, params p
  WHERE LOWER(TRIM(um.sales_owner_email)) = LOWER(TRIM('{SALES_EMAIL}'))
    AND um.first_dollar_date IS NOT NULL
    AND um.new_user_exp_date >= p.lag_date
    AND um.user_status NOT IN ('suspended', 'deleted')
    AND um.res_id IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

-- SKU-level order data (last 3 months rolling)
raw AS (
  SELECT
    so.account_id,
    DATE_TRUNC(o.delivery_date, MONTH)             AS month_date,
    CAST(i.item_id AS STRING)                      AS item_id,
    i.item_name_th,
    COALESCE(i.category_high_level_v2, i.category_high_level, '') AS dept,
    COALESCE(i.subclass_name, '')                  AS subclass,
    COALESCE(i.temperature, '')                    AS temperature,
    COALESCE(i.pack_size, '')                      AS pack_size,
    i.gmv_ex_vat,
    i.qty,
    i.price_ex_vat,
    o.order_id,
    CAST(o.user_id AS STRING)                      AS res_id
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS i, params p
  JOIN sales_outlets so ON CAST(o.user_id AS STRING) = so.res_id
  WHERE o.delivery_date >= DATE_SUB(DATE_TRUNC(p.lag_date, MONTH), INTERVAL 2 MONTH)
    AND o.delivery_date <= p.lag_date
    AND i.gmv_ex_vat > 0
),

-- Aggregate per account × month × item
agg AS (
  SELECT
    account_id,
    FORMAT_DATE('%Y-%m', month_date)               AS month_str,
    item_id,
    MAX(item_name_th)                              AS item_name,
    MAX(dept)                                      AS dept,
    MAX(subclass)                                  AS subclass,
    MAX(temperature)                               AS temperature,
    MAX(pack_size)                                 AS pack_size,
    ROUND(SUM(gmv_ex_vat), 0)                      AS gmv,
    SUM(qty)                                       AS qty,
    ROUND(AVG(price_ex_vat), 2)                    AS avg_price,
    COUNT(DISTINCT order_id)                       AS order_count
  FROM raw
  GROUP BY 1, 2, 3
)

SELECT
  account_id,
  month_str,
  item_id,
  item_name,
  dept,
  subclass,
  temperature,
  pack_size,
  gmv,
  qty,
  avg_price,
  order_count
FROM agg
ORDER BY account_id, month_str DESC, gmv DESC
;
