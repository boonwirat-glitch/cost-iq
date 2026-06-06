-- ════════════════════════════════════════════════════════════════════════════
-- Q_SALES_ALTS_ALL_REPS v1
-- รันครั้งเดียว → export เป็น download_sales_alts.csv
-- ใช้ splitter.py แยกเป็น sense_alts_{safeKey}.csv ต่อ rep → upload R2
-- col[0] = sales_email (splitter key, removed before upload)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TEMP FUNCTION extract_pack_liters(ps STRING) AS ((
  CASE
    WHEN REGEXP_CONTAINS(ps, r'(?i)\d+\.?\d*\s*[xX]\s*\d+\.?\d*\s*ml\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(?i)(\d+\.?\d*)\s*[xX]') AS FLOAT64)
           * CAST(REGEXP_EXTRACT(ps, r'(?i)[xX]\s*(\d+\.?\d*)\s*ml') AS FLOAT64)
           / 1000
    WHEN REGEXP_CONTAINS(ps, r'(?i)\d+\.?\d*\s*ml\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(?i)(\d+\.?\d*)\s*ml') AS FLOAT64) / 1000
    WHEN REGEXP_CONTAINS(ps, r'(?i)\d+\.?\d*\s*[xX]\s*\d+\.?\d*\s*(?:liter|litre|lt|L)\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(?i)(\d+\.?\d*)\s*[xX]') AS FLOAT64)
           * CAST(REGEXP_EXTRACT(ps, r'(?i)[xX]\s*(\d+\.?\d*)\s*(?:liter|litre|lt|L)') AS FLOAT64)
    WHEN REGEXP_CONTAINS(ps, r'(?i)\d+\.?\d*\s*(?:liter|litre|lt)\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(?i)(\d+\.?\d*)\s*(?:liter|litre|lt)') AS FLOAT64)
    WHEN REGEXP_CONTAINS(ps, r'\d+\.?\d*\s*L\b')
      THEN CAST(REGEXP_EXTRACT(ps, r'(\d+\.?\d*)\s*L\b') AS FLOAT64)
    ELSE NULL
  END
));

WITH params AS (
  SELECT DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY) AS lag_date
),

sales_list AS (
  SELECT sales_email FROM UNNEST([
    'malisa.c@freshket.co',
    'nichapa.s@freshket.co',
    'nichita.n@freshket.co',
    'phongsakorn.j@freshket.co',
    'sirinrat.s@freshket.co',
    'wilailak.w@freshket.co',
    'benjawan.a@freshket.co',
    'kanokwan.w@freshket.co',
    'kanthicha.s@freshket.co',
    'nannapas.c@freshket.co',
    'pattama.t@freshket.co',
    'rujira.p@freshket.co',
    'sasaluk.t@freshket.co',
    'supanida.r@freshket.co',
    'thida.p@freshket.co'
  ]) AS sales_email
),

sales_outlets AS (
  SELECT
    LOWER(TRIM(sl.sales_email))         AS sales_email,
    CAST(um.res_id AS STRING)           AS res_id,
    CAST(um.account_guid AS STRING)     AS account_id
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

account_items AS (
  SELECT
    so.sales_email,
    so.account_id,
    item.item_id,
    item.item_name_th,
    item.subclass_name,
    item.temperature,
    item.pack_size                                                  AS account_pack_size,
    TRIM(SPLIT(item.item_name_th, ' ตรา')[OFFSET(0)])              AS core_name,
    ROUND(SUM(item.gmv_ex_vat) / NULLIF(SUM(item.weight_kg), 0), 2) AS avg_price_per_kg,
    ROUND(
      SAFE_DIVIDE(SUM(item.gmv_ex_vat), NULLIF(SUM(item.qty), 0))
      / NULLIF(extract_pack_liters(item.pack_size), 0)
    , 2)                                                            AS avg_price_per_liter,
    ROUND(SUM(item.gmv_ex_vat) / NULLIF(SUM(item.qty), 0), 2)     AS avg_unit_price,
    CASE
      WHEN SUM(item.weight_kg) > 0 THEN 'per_kg'
      WHEN extract_pack_liters(item.pack_size) IS NOT NULL THEN 'per_liter'
      ELSE NULL
    END                                                             AS price_basis,
    SUM(item.qty)                                                   AS monthly_qty,
    ROUND(SUM(item.gmv_ex_vat), 0)                                 AS monthly_gmv
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS item, params p
  JOIN sales_outlets so ON CAST(o.user_id AS STRING) = so.res_id
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = DATE_TRUNC(DATE_SUB(p.lag_date, INTERVAL 1 MONTH), MONTH)
    AND item.gmv_ex_vat > 0
    AND item.category_high_level != 'DG Non-food'
    AND (item.weight_kg > 0 OR extract_pack_liters(item.pack_size) IS NOT NULL)
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY so.account_id, item.item_id
    ORDER BY o.delivery_date DESC
  ) = 1
),

catalog AS (
  SELECT
    item.item_id,
    item.item_name_th,
    item.brand_name_th,
    item.grading,
    item.pack_size                                                  AS catalog_pack_size,
    item.subclass_name,
    item.temperature,
    TRIM(SPLIT(item.item_name_th, ' ตรา')[OFFSET(0)])              AS core_name,
    ROUND(SUM(item.gmv_ex_vat) OVER (PARTITION BY item.item_id)
          / NULLIF(SUM(item.weight_kg) OVER (PARTITION BY item.item_id), 0), 2)
          AS catalog_price_per_kg,
    ROUND(
      SAFE_DIVIDE(SUM(item.gmv_ex_vat) OVER (PARTITION BY item.item_id),
                  NULLIF(SUM(item.qty) OVER (PARTITION BY item.item_id), 0))
      / NULLIF(extract_pack_liters(item.pack_size), 0)
    , 2)                                                            AS catalog_price_per_liter,
    CASE
      WHEN SUM(item.weight_kg) OVER (PARTITION BY item.item_id) > 0 THEN 'per_kg'
      WHEN extract_pack_liters(item.pack_size) IS NOT NULL THEN 'per_liter'
      ELSE NULL
    END                                                             AS price_basis,
    ROUND(SUM(item.gmv_ex_vat) OVER (PARTITION BY item.item_id)
          / NULLIF(SUM(item.qty) OVER (PARTITION BY item.item_id), 0), 2)
          AS catalog_unit_price
  FROM `freshket-rn.dwh.order` o, UNNEST(o.item) AS item
  WHERE DATE_TRUNC(o.delivery_date, MONTH) = DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)
    AND o.account_type != 'enduser'
    AND item.gmv_ex_vat > 0
    AND item.category_high_level != 'DG Non-food'
    AND (item.weight_kg > 0 OR extract_pack_liters(item.pack_size) IS NOT NULL)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY item.item_id ORDER BY o.delivery_date DESC) = 1
)

SELECT
  a.sales_email,        -- col[0] splitter key
  a.account_id,
  a.item_id                                                         AS account_item_id,
  a.item_name_th                                                    AS account_item_name,
  a.core_name                                                       AS account_core_name,
  COALESCE(a.avg_price_per_kg, a.avg_price_per_liter)              AS account_price,
  a.subclass_name,
  c.item_id                                                         AS catalog_item_id,
  c.item_name_th                                                    AS catalog_item_name,
  c.brand_name_th                                                   AS catalog_brand,
  c.grading,
  c.catalog_pack_size                                               AS pack_size,
  COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter)      AS catalog_price,
  ROUND(COALESCE(a.avg_price_per_kg, a.avg_price_per_liter)
      - COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter), 2) AS price_diff,
  a.avg_unit_price                                                  AS account_unit_price,
  a.account_pack_size,
  c.catalog_unit_price,
  a.monthly_qty,
  a.monthly_gmv,
  a.price_basis

FROM account_items a
JOIN catalog c
  ON  a.subclass_name  = c.subclass_name
  AND a.temperature    = c.temperature
  AND a.item_id       != c.item_id
  AND a.price_basis    = c.price_basis
  AND (c.core_name LIKE CONCAT('%', a.core_name, '%') OR a.core_name LIKE CONCAT('%', c.core_name, '%'))
  AND COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter)
      < COALESCE(a.avg_price_per_kg, a.avg_price_per_liter) * 0.97
  AND COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter) > 0
  AND COALESCE(a.avg_price_per_kg, a.avg_price_per_liter)
      / NULLIF(COALESCE(c.catalog_price_per_kg, c.catalog_price_per_liter), 0) <= 10

QUALIFY ROW_NUMBER() OVER (
  PARTITION BY a.account_id, a.item_id
  ORDER BY price_diff DESC
) <= 5
ORDER BY a.sales_email, a.account_id, a.monthly_gmv DESC, price_diff DESC
;
