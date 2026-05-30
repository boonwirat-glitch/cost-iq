-- ════════════════════════════════════════════════════════════════════════════
-- Q7B — Bulk SKU Current Month-to-Date (KAM Cost IQ)
-- Output: account_id, item_id, item_name_th, order_count_mtd, gmv_mtd, last_order_date
-- Window: current month start → today (Asia/Bangkok)
-- Filter: 653 piloted accounts (from kam_account_mapping_v2.csv)
-- Locked rules: gmv_ex_vat, no order status filter, account_id from dwh.order
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
mtd_items AS (
  SELECT
    o.account_id,
    o.order_id,
    o.delivery_date,
    i.item_id,
    i.item_name_th,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_map ON o.account_id = kam_map.account_id
  WHERE TRUE
    AND o.delivery_date >= DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH)
    AND o.delivery_date <= CURRENT_DATE('Asia/Bangkok')
)
SELECT
  account_id,
  CAST(item_id AS STRING) AS item_id,
  ANY_VALUE(item_name_th) AS item_name_th,
  COUNT(DISTINCT order_id) AS order_count_mtd,
  ROUND(SUM(gmv_ex_vat), 2) AS gmv_mtd,
  MAX(delivery_date) AS last_order_date
FROM mtd_items
WHERE item_id IS NOT NULL
GROUP BY account_id, item_id
ORDER BY account_id, gmv_mtd DESC;