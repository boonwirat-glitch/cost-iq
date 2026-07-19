-- ════════════════════════════════════════════════════════════════════════════
-- Q7B — Bulk SKU Current Month-to-Date (KAM Cost IQ)
-- Output: account_id, item_id, item_name_th, order_count_mtd, gmv_mtd, last_order_date
-- Window: current month start → today (Asia/Bangkok)
-- Filter: 653 piloted accounts (from kam_account_mapping_v2.csv)
-- Locked rules: gmv_ex_vat, no order status filter, account_id from dwh.order
-- ════════════════════════════════════════════════════════════════════════════

WITH kam_list AS (
  SELECT kam_name, kam_email, expected_owner FROM UNNEST([
    STRUCT('Anusorn (Bookbig) Khamphasuk'           AS kam_name, 'anusorn.k@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Chaklid (Dent) Nimraor'                 AS kam_name, 'chaklid.n@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Duangruedee (Ning) Bulalom'             AS kam_name, 'duangruedee.bu@freshket.co' AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Guntinun (Monet) Thanoochan'            AS kam_name, 'guntinun.t@freshket.co'     AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Intuon (Jane) Yanakit'                  AS kam_name, 'intuon.y@freshket.co'       AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Napat (To) Kaikaew'                     AS kam_name, 'napat.k@freshket.co'        AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Natchita (Foam) Bunkong'                AS kam_name, 'natchita.b@freshket.co'     AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Niracha (Cream) Sangka'                 AS kam_name, 'niracha.s@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Nuttawan (Kwang) Mahaporn'              AS kam_name, 'nuttawan.ma@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Ploynitcha (Nitcha) Rujipiromthagoon'   AS kam_name, 'ploynitcha.r@freshket.co'   AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Puttipong (Tape) Wanithaweewat'         AS kam_name, 'puttipong.w@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Rinlaphat (Mild) Setthasiriwuti'        AS kam_name, 'rinlaphat.s@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Siriprapa (Pop) Piapeng'                AS kam_name, 'siriprapa.p@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Warissara (Ply) Chanaboon'              AS kam_name, 'warissara.c@freshket.co'    AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Treerak (May) Sangjua'               AS kam_name, 'treerak.s@freshket.co'      AS kam_email, 'KAM' AS expected_owner),
    STRUCT('Panitan (Aom) Promta' AS kam_name, 'panitan.p@freshket.co' AS kam_email, 'PM' AS expected_owner),
    STRUCT('Sarawoot (Oh) Kaewkhao' AS kam_name, 'sarawoot.k@freshket.co' AS kam_email, 'PM' AS expected_owner),
    STRUCT('Nichamon (Ninew) Kanghae' AS kam_name, 'nichamon.k@freshket.co' AS kam_email, 'PM' AS expected_owner),
    STRUCT('Ornpreya (Ice) Sukthai' AS kam_name, 'ornpreya.s@freshket.co' AS kam_email, 'PM' AS expected_owner)
  ])
),
-- v4: join via res_id (เหมือน Q8E) รองรับ account rename
kam_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)       AS res_id,
    CAST(um.account_guid AS STRING) AS account_id,
    um.account_name,
    k.kam_name,
    k.kam_email
  FROM `freshket-rn.dim.user_master` um
  JOIN kam_list k
    ON LOWER(TRIM(um.staff_owner_email)) = LOWER(TRIM(k.kam_email))
  WHERE um.commercial_owner = k.expected_owner
    AND um.account_type IN ('SA','MC','Chain','Unknown')
    AND um.res_id IS NOT NULL
    AND um.account_guid IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(um.res_id AS STRING)
    ORDER BY um.lasted_order_date DESC NULLS LAST
  ) = 1
),
mtd_items AS (
  SELECT
    ko.account_id,
    o.order_id,
    o.delivery_date,
    i.item_id,
    i.item_name_th,
    i.gmv_ex_vat
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ko ON CAST(o.user_id AS STRING) = ko.res_id
  WHERE TRUE
    AND o.delivery_date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY), MONTH)
    AND o.delivery_date <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)  -- day-1 lag: both bounds use lag_date so range is never impossible
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