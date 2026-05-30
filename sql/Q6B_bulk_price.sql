-- ════════════════════════════════════════════════════════════
-- Q6B v2: Bulk Price History — KAM accounts × 6 months
-- ════════════════════════════════════════════════════════════
-- Output: bulk_price.csv
-- Refresh: Monthly (1st of month, after Q3B)
-- Purpose: historical price range for sparkline Y-axis normalization
-- Columns (5): account_id, month_label, item_id, unit_price, avg_piece_price
-- Window: last 6 complete months (excludes current month-to-date)
-- Filter: GMV ≥ 100/month per SKU (cuts long-tail, ~40-50% row reduction)
-- Size: ~35-40MB (vs 68MB at 9mo / no filter)
-- ════════════════════════════════════════════════════════════

WITH kam_list AS (
  SELECT kam_name, kam_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email)
  ])
),
-- v201f: dynamic KAM mapping (replaces hardcoded 623-row list) | 90d churn window
-- v207g: current portfolio owner source-of-truth = user_master.staff_owner_email.
-- Fallback to latest order owner only when the master record has no owner email.
user_master_current AS (
  SELECT *
  FROM `freshket-rn.dim.user_master`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at DESC NULLS LAST
  ) = 1
),
master_kam_accounts AS (
  SELECT um.account_guid AS account_id, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_map AS (
  SELECT account_id FROM kam_map_src
  QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY _pri ASC) = 1
),


raw AS (
  SELECT
    o.account_id,
    DATE_TRUNC(o.delivery_date, MONTH)   AS month_date,
    CAST(i.item_id AS STRING)            AS item_id,
    i.gmv_ex_vat,
    i.qty,
    i.price_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_map ON o.account_id = kam_map.account_id
  WHERE TRUE
    AND o.delivery_date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH), INTERVAL 6 MONTH)
    AND o.delivery_date <  DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH)
    AND i.item_id IS NOT NULL
    AND i.gmv_ex_vat >= 100
)

SELECT
  account_id,
  CONCAT(
    CASE EXTRACT(MONTH FROM month_date)
      WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
      WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
      WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
      WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
    END, ' ',
    CAST(EXTRACT(YEAR FROM month_date) + 543 AS STRING)
  ) AS month_label,
  item_id,
  ROUND(SAFE_DIVIDE(SUM(gmv_ex_vat), NULLIF(SUM(qty), 0)), 2) AS unit_price,
  ROUND(AVG(price_ex_vat), 2)                                   AS avg_piece_price
FROM raw
GROUP BY account_id, month_date, item_id
ORDER BY account_id, month_date, item_id;