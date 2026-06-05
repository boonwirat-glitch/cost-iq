-- ════════════════════════════════════════════════════════════════════════════
-- Q5B — Bulk Outlets Monthly (KAM Cost IQ)
-- Columns (10): account_id, month_label, outlet_id, outlet_name,
--               gmv_ex_vat, orders, shipping_incvat, mode_timeslot, last_order_date,
--               first_dollar_date (all-time MIN delivery_date for this outlet)
-- Window: last 6 complete months + current month MTD (for outlet cycle signals)
-- Note: outlet card renders only for accounts with 2+ outlets (Chain)
--       Single-outlet SA/MC accounts will be skipped by the app automatically
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
    DATE_TRUNC(o.delivery_date, MONTH)  AS month_date,
    o.delivery_date,
    CAST(o.user_id AS STRING)           AS outlet_id,
    o.res_name                          AS outlet_name,
    o.gmv_ex_vat,
    o.order_id,
    o.po_time_slot,
    o.shipping_cost
  FROM `freshket-rn.dwh.order` o
  JOIN kam_outlets ko ON CAST(o.user_id AS STRING) = ko.res_id
  WHERE TRUE
    AND o.delivery_date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH), INTERVAL 6 MONTH)
    AND o.delivery_date <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)  -- day-1 lag guard
),

agg AS (
  SELECT
    account_id,
    month_date,
    outlet_id,
    ANY_VALUE(outlet_name)                                        AS outlet_name,
    ROUND(SUM(gmv_ex_vat), 2)                                    AS gmv_ex_vat,
    COUNT(DISTINCT order_id)                                     AS orders,
    ROUND(SUM(shipping_cost), 2)                                 AS shipping_incvat,
    -- mode delivery timeslot (most common slot for this outlet this month)
    CAST(
      COALESCE(
        APPROX_TOP_COUNT(po_time_slot, 1)[SAFE_OFFSET(0)].value,
        0
      ) AS FLOAT64
    )                                                            AS mode_timeslot,
    MAX(delivery_date)                                           AS last_order_date
  FROM raw
  GROUP BY account_id, month_date, outlet_id
),

-- v_fdd: all-time first order date per outlet — for comeback vs expansion classification
-- Intentionally NOT filtered by 6-month window or kam_map: we want all-time history
first_order_per_outlet AS (
  SELECT
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(o.delivery_date)      AS first_dollar_date
  FROM `freshket-rn.dwh.order` o
  WHERE o.account_type IN ('SA','MC','Chain','Unknown')
    AND o.user_id IS NOT NULL
    AND o.gmv_ex_vat > 0
  GROUP BY 1
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
  a.outlet_id,
  a.outlet_name,
  a.gmv_ex_vat,
  a.orders,
  a.shipping_incvat,
  a.mode_timeslot,
  FORMAT_DATE('%Y-%m-%d', a.last_order_date)       AS last_order_date,
  FORMAT_DATE('%Y-%m-%d', fdo.first_dollar_date)   AS first_dollar_date
FROM agg a
LEFT JOIN first_order_per_outlet fdo ON a.outlet_id = fdo.outlet_id
ORDER BY a.account_id, a.month_date DESC, a.gmv_ex_vat DESC;