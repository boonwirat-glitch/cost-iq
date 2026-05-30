-- ════════════════════════════════════════════════════════════
-- Q9 v2: Bulk History — KAM accounts × 6 months
-- ════════════════════════════════════════════════════════════
-- Output: bulk_history.csv
-- Refresh: Weekly (จันทร์ 6:00 AM)

WITH kam_list AS (
  SELECT kam_name, kam_email, tl_email FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'nitipat.s@freshket.co'   AS tl_email),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'pavarisa.mu@freshket.co' AS tl_email)
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
  SELECT um.account_guid AS account_id, k.kam_name, k.kam_email, k.tl_email, 1 AS _pri
  FROM user_master_current um
  JOIN kam_list k ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = 'KAM'
    AND um.account_type IN ('SA','MC','Chain','Unknown')
),
kam_map AS (
  SELECT account_id, kam_name, kam_email, tl_email
  FROM master_kam_accounts
),

-- res_primary: for each (KAM, res_name), find the primary account_id
-- Primary = account with most recent order → ensures migrated accounts collapse to new ID
res_last_order AS (
  SELECT
    km.kam_name,
    o.res_name,
    o.account_id,
    MAX(o.delivery_date) AS last_order_date
  FROM `freshket-rn.dwh.order` o
  INNER JOIN kam_map km ON o.account_id = km.account_id
  WHERE o.res_name IS NOT NULL
    AND o.delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH), MONTH)
  GROUP BY 1, 2, 3
),
res_primary AS (
  SELECT kam_name, res_name, account_id AS primary_account_id
  FROM res_last_order
  QUALIFY ROW_NUMBER() OVER (PARTITION BY kam_name, res_name ORDER BY last_order_date DESC) = 1
)

SELECT
  COALESCE(rp.primary_account_id, o.account_id) AS account_id,
  MAX(o.account_name) AS account_name,
  CASE EXTRACT(MONTH FROM DATE_TRUNC(o.delivery_date, MONTH))
    WHEN 1  THEN 'ม.ค.'  WHEN 2  THEN 'ก.พ.'  WHEN 3  THEN 'มี.ค.'
    WHEN 4  THEN 'เม.ย.' WHEN 5  THEN 'พ.ค.'  WHEN 6  THEN 'มิ.ย.'
    WHEN 7  THEN 'ก.ค.'  WHEN 8  THEN 'ส.ค.'  WHEN 9  THEN 'ก.ย.'
    WHEN 10 THEN 'ต.ค.'  WHEN 11 THEN 'พ.ย.'  WHEN 12 THEN 'ธ.ค.'
  END || ' ' || CAST(EXTRACT(YEAR FROM DATE_TRUNC(o.delivery_date, MONTH)) + 543 AS STRING) AS month_label,
  ROUND(SUM(i.gmv_ex_vat), 0) AS gmv,
  COUNT(DISTINCT o.order_id)  AS orders

FROM `dwh.order` o, UNNEST(o.item) AS i
INNER JOIN kam_map km ON o.account_id = km.account_id
LEFT JOIN res_primary rp ON km.kam_name = rp.kam_name AND o.res_name = rp.res_name

WHERE o.delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH), MONTH)
  AND o.delivery_date <  DATE_TRUNC(CURRENT_DATE(), MONTH)
  AND i.gmv_ex_vat > 0

GROUP BY 1, 3
ORDER BY 1, 3;