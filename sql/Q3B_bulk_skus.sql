-- ════════════════════════════════════════════════════════════════════════════
-- Q3B v3 — Bulk SKU Monthly (KAM Cost IQ · pack_size + outlet_count_sku + bi_source unit)
-- Columns (18): account_id, month_label, item_id, item_name_th, dept,
--               subclass, temperature, pack_size,
--               gmv_ex_vat, pct, qty_kg, unit_price, order_count, avg_piece_price,
--               outlet_count_sku, default_unit_group, ea_unit_name, universal_ea_value
-- Window: last 2 complete months + current month MTD (Mar/Apr/May at time of export)
-- Locked rules: gmv_ex_vat, no order status filter, account_id from dwh.order
-- pack_size: from item.pack_size in dwh.order → drives unit label detection (ขวด/ถัง/กก.)
-- bi_source join: adds default_unit_group/ea_unit_name/universal_ea_value for bundle pricing
-- ════════════════════════════════════════════════════════════════════════════

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
-- v4: join via res_id (เหมือน Q8E) รองรับ account rename
kam_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)       AS res_id,
    CAST(um.account_guid AS STRING) AS account_id,
    um.account_name,
    k.kam_name,
    k.kam_email,
    k.tl_email
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),

raw AS (
  SELECT
    ko.account_id,
    DATE_TRUNC(o.delivery_date, MONTH)   AS month_date,
    CAST(i.item_id AS STRING)            AS item_id,
    i.item_name_th,
    COALESCE(i.category_high_level_v2, i.category_high_level, '')  AS dept,
    COALESCE(i.subclass_name, '')        AS subclass,
    COALESCE(i.temperature, '')          AS temperature,
    COALESCE(i.pack_size, '')            AS pack_size,
    i.gmv_ex_vat,
    i.qty,
    i.price_ex_vat,                      -- price per ordering unit (ขวด, ถัง, kg, etc.)
    o.order_id,
    ko.account_id,
    CAST(o.user_id AS STRING)             AS res_id  -- outlet identifier for outlet_count_sku
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ko ON CAST(o.user_id AS STRING) = ko.res_id
  WHERE TRUE
    AND o.delivery_date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH), INTERVAL 2 MONTH)
    AND o.delivery_date <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)  -- day-1 lag guard
    AND i.item_id IS NOT NULL
),

monthly_total AS (
  SELECT account_id, month_date, SUM(gmv_ex_vat) AS total_gmv
  FROM raw
  GROUP BY account_id, month_date
),

agg AS (
  SELECT
    r.account_id,
    r.month_date,
    r.item_id,
    ANY_VALUE(r.item_name_th)                                          AS item_name_th,
    ANY_VALUE(r.dept)                                                  AS dept,
    ANY_VALUE(r.subclass)                                              AS subclass,
    ANY_VALUE(r.temperature)                                           AS temperature,
    ANY_VALUE(r.pack_size)                                             AS pack_size,
    ROUND(SUM(r.gmv_ex_vat), 2)                                        AS gmv_ex_vat,
    ROUND(SUM(r.qty), 3)                                               AS qty_kg,
    -- unit_price = per-kg price (used when item is sold by weight)
    ROUND(SAFE_DIVIDE(SUM(r.gmv_ex_vat), NULLIF(SUM(r.qty), 0)), 2)   AS unit_price,
    COUNT(DISTINCT r.order_id)                                         AS order_count,
    -- avg_piece_price = avg price per ordering unit (ขวด/ถัง/pack)
    -- when this differs from unit_price, the app detects per-unit pricing
    ROUND(AVG(r.price_ex_vat), 2)                                      AS avg_piece_price,
    -- outlet_count_sku = outlets that actually ordered this SKU (≠ total outlet count)
    -- used for per-outlet frequency → churn interval logic in app
    COUNT(DISTINCT r.user_id)                                          AS outlet_count_sku
  FROM raw r
  GROUP BY r.account_id, r.month_date, r.item_id
)

SELECT
  a.account_id,
  CONCAT(
    CASE EXTRACT(MONTH FROM month_date)
      WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
      WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
      WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
      WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
    END,
    ' ',
    CAST(EXTRACT(YEAR FROM a.month_date) + 543 AS STRING)
  ) AS month_label,
  a.item_id,
  a.item_name_th,
  a.dept,
  a.subclass,
  a.temperature,
  a.pack_size,                           -- ← drives ขวด/ถัง/กก. detection in app
  a.gmv_ex_vat,
  ROUND(SAFE_DIVIDE(a.gmv_ex_vat, t.total_gmv) * 100, 1) AS pct,
  a.qty_kg,
  a.unit_price,
  a.order_count,
  a.avg_piece_price,
  a.outlet_count_sku,
  COALESCE(m.default_unit_group, '')  AS default_unit_group,   -- 'EACH' | 'WEIGHT' | ''
  COALESCE(m.ea_unit_name, '')        AS ea_unit_name,          -- กระป๋อง/ขวด/ถุง/แพ็ค etc.
  COALESCE(m.universal_ea_value, 0)   AS universal_ea_value     -- N per pack (24, 12, 20 ...)
FROM agg a
JOIN monthly_total t USING (account_id, month_date)
LEFT JOIN `freshket-rn.bi_source.item_master_merchandise` m ON CAST(m.item_id AS STRING) = a.item_id
ORDER BY a.account_id, a.month_date DESC, a.gmv_ex_vat DESC;