-- ══════════════════════════════════════════════════════════════
-- Q3C Upsell Bulk ALL KAMs — v4
-- v4: Remove new_gmv and comeback_gmv columns (dead fields not used by app)
--   → reduces CSV file size ~22% (7 cols instead of 9)
--   → app parser updated to match (02_data_pipeline.js v4)
-- v3 fix retained: KAM→account mapping ใช้ logic เดียวกับ Q8E
--
-- Columns (7): kam_email, account_id, outlet_id, month_label, group_key,
--              existing_gmv, total_gmv
-- ══════════════════════════════════════════════════════════════

WITH
dates AS (
  SELECT
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH) AS baseline_mo,
    DATE_TRUNC(CURRENT_DATE(), MONTH)                              AS current_mo,
    DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH), MONTH) AS lookback_start
),

-- Active KAM whitelist
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
    STRUCT('Puttipong (Tape) Wanithaweewat'       AS kam_name, 'puttipong.w@freshket.co'    AS kam_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'      AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email),
    STRUCT('Siriprapa (Pop) Piapeng'              AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email),
    STRUCT('Warissara (Ply) Chanaboon'            AS kam_name, 'warissara.c@freshket.co'    AS kam_email)
  ])
),

-- KAM→account mapping (Q8E logic)
user_master_current AS (
  SELECT *
  FROM `freshket-rn.dim.user_master`
  WHERE account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY account_guid
    ORDER BY
      CASE WHEN staff_owner_email IS NOT NULL AND TRIM(staff_owner_email) != '' THEN 0 ELSE 1 END,
      lasted_order_date DESC NULLS LAST,
      lead_created_at   DESC NULLS LAST
  ) = 1
),
master_kam_accounts AS (
  SELECT um.account_guid AS account_id, k.kam_email, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain')
),
order_fallback_accounts AS (
  SELECT o.account_id, k.kam_email, 2 AS _pri
  FROM `freshket-rn.dwh.order` o
  JOIN kam_list k ON o.ka_owner = k.kam_name
  LEFT JOIN user_master_current um ON um.account_guid = o.account_id
  WHERE o.account_type IN ('SA','MC','Chain')
    AND o.commercial_owner = 'KAM'
    AND o.delivery_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND (um.account_guid IS NULL
         OR um.staff_owner_email IS NULL
         OR TRIM(um.staff_owner_email) = '')
  QUALIFY ROW_NUMBER() OVER (PARTITION BY o.account_id ORDER BY o.delivery_date DESC) = 1
),
kam_accounts AS (
  SELECT account_id, kam_email
  FROM (
    SELECT * FROM master_kam_accounts
    UNION ALL
    SELECT * FROM order_fallback_accounts
  )
  QUALIFY ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY _pri ASC) = 1
),

-- Outlet status (existing / expansion / comeback)
outlet_history AS (
  SELECT
    o.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    MIN(o.delivery_date)      AS first_seen,
    MAX(CASE WHEN o.delivery_date >= d.baseline_mo
              AND o.delivery_date <  DATE_ADD(d.baseline_mo, INTERVAL 1 MONTH)
             THEN 1 ELSE 0 END) AS in_baseline,
    MAX(CASE WHEN o.delivery_date >= d.current_mo THEN 1 ELSE 0 END) AS in_current
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN dates d
  JOIN kam_accounts ka ON o.account_id = ka.account_id
  WHERE o.delivery_date >= DATE_SUB((SELECT baseline_mo FROM dates), INTERVAL 5 MONTH)
    AND o.delivery_date <  DATE_ADD((SELECT current_mo FROM dates), INTERVAL 1 MONTH)
  GROUP BY 1, 2
),
outlet_status AS (
  SELECT account_id, outlet_id,
    CASE
      WHEN in_baseline = 1                                                   THEN 'existing'
      WHEN in_current  = 1 AND first_seen >= (SELECT current_mo FROM dates)  THEN 'expansion'
      WHEN in_current  = 1 AND first_seen <  (SELECT current_mo FROM dates)  THEN 'comeback'
    END AS outlet_type
  FROM outlet_history WHERE in_current = 1
),

-- Current month: outlet × group_key
-- existing_gmv: GMV from existing outlets (used for P3)
-- total_gmv: all GMV for this outlet × group_key (used for P1)
current_items AS (
  SELECT
    ka.kam_email,
    o.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    CONCAT(
      CASE EXTRACT(MONTH FROM o.delivery_date)
        WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
        WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
        WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
        WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
      END, ' ', CAST(EXTRACT(YEAR FROM o.delivery_date)+543 AS STRING)
    ) AS month_label,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN dates d
  JOIN kam_accounts ka ON o.account_id = ka.account_id
  WHERE o.delivery_date >= d.current_mo
    AND o.delivery_date <  DATE_ADD(d.current_mo, INTERVAL 1 MONTH)
    AND i.gmv_ex_vat > 0
),
current_split AS (
  SELECT
    ci.kam_email, ci.account_id, ci.outlet_id, ci.month_label, ci.group_key,
    SUM(CASE WHEN os.outlet_type = 'existing' THEN ci.gmv_ex_vat ELSE 0 END) AS existing_gmv,
    SUM(ci.gmv_ex_vat) AS total_gmv
  FROM current_items ci
  LEFT JOIN outlet_status os ON ci.account_id = os.account_id AND ci.outlet_id = os.outlet_id
  GROUP BY 1,2,3,4,5
),

-- Lookback 3 months: total_gmv for max_baseline calculation (P3)
lookback AS (
  SELECT
    ka.kam_email,
    o.account_id,
    CAST(o.user_id AS STRING) AS outlet_id,
    CASE
      WHEN i.category_high_level IN ('Meat','Vegetable','Fruit')
           AND TRIM(COALESCE(i.item_family,'')) != ''
      THEN i.item_family ELSE i.subclass_name
    END AS group_key,
    CONCAT(
      CASE EXTRACT(MONTH FROM o.delivery_date)
        WHEN 1 THEN 'ม.ค.' WHEN 2 THEN 'ก.พ.' WHEN 3 THEN 'มี.ค.'
        WHEN 4 THEN 'เม.ย.' WHEN 5 THEN 'พ.ค.' WHEN 6 THEN 'มิ.ย.'
        WHEN 7 THEN 'ก.ค.' WHEN 8 THEN 'ส.ค.' WHEN 9 THEN 'ก.ย.'
        WHEN 10 THEN 'ต.ค.' WHEN 11 THEN 'พ.ย.' WHEN 12 THEN 'ธ.ค.'
      END, ' ', CAST(EXTRACT(YEAR FROM o.delivery_date)+543 AS STRING)
    ) AS month_label,
    0.0 AS existing_gmv,
    SUM(i.gmv_ex_vat) AS total_gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  CROSS JOIN dates d
  JOIN kam_accounts ka ON o.account_id = ka.account_id
  WHERE o.delivery_date >= d.lookback_start
    AND o.delivery_date <  d.current_mo
    AND i.gmv_ex_vat > 0
  GROUP BY 1,2,3,4,5
)

-- 7 columns only (new_gmv and comeback_gmv removed — not used by app)
SELECT
  kam_email, account_id, outlet_id, month_label, group_key,
  ROUND(existing_gmv, 2) AS existing_gmv,
  ROUND(total_gmv,    2) AS total_gmv
FROM current_split

UNION ALL

SELECT
  kam_email, account_id, outlet_id, month_label, group_key,
  existing_gmv,
  ROUND(total_gmv, 2) AS total_gmv
FROM lookback

ORDER BY kam_email, account_id, outlet_id, month_label, total_gmv DESC
