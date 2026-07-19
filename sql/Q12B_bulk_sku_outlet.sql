-- ════════════════════════════════════════════════════════════════════════════
-- Q12B — Bulk SKU × Outlet Breakdown (KAM Cost IQ)
-- Columns (8): account_id, item_id, outlet_id, outlet_name,
--              last_month_orders, last_month_gmv,
--              this_month_orders, this_month_gmv
-- Window: เดือนที่แล้ว (closed) + เดือนนี้ MTD
-- Purpose: tooltip บน SKU signal — บอก KAM ว่าสาขาไหนสั่ง/ไม่สั่ง SKU นั้น
-- grain: account_id × item_id × outlet_id (pivot 2 เดือนเป็น wide format)
-- Locked rules: gmv_ex_vat, no order status filter, res_id join
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
kam_outlets AS (
  SELECT
    CAST(um.res_id AS STRING)       AS res_id,
    CAST(um.account_guid AS STRING) AS account_id,
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

-- raw: 2 เดือนเท่านั้น — เดือนที่แล้ว + MTD เดือนนี้
raw AS (
  SELECT
    ko.kam_email,
    ko.account_id,
    CAST(i.item_id AS STRING)          AS item_id,
    CAST(o.user_id AS STRING)          AS outlet_id,
    ANY_VALUE(o.res_name)              AS outlet_name,
    DATE_TRUNC(o.delivery_date, MONTH) AS month_date,
    COUNT(DISTINCT o.order_id)         AS order_count,
    ROUND(SUM(i.gmv_ex_vat), 2)        AS gmv
  FROM `freshket-rn.dwh.order` o
  CROSS JOIN UNNEST(o.item) AS i
  JOIN kam_outlets ko ON CAST(o.user_id AS STRING) = ko.res_id
  WHERE o.delivery_date >= DATE_SUB(DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH), INTERVAL 1 MONTH)
    AND o.delivery_date <= DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 DAY)
    AND i.item_id IS NOT NULL
  GROUP BY 1, 2, 3, 4, 6
),

-- outlet ที่สั่ง SKU นั้นในเดือนที่แล้ว — ใช้ INNER JOIN แทน correlated subquery
last_month_outlets AS (
  SELECT DISTINCT account_id, item_id, outlet_id
  FROM raw
  WHERE month_date = DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Bangkok'), INTERVAL 1 MONTH), MONTH)
)

SELECT
  r.kam_email,   -- ← splitter ใช้ column นี้, ไม่อยู่ใน output file
  r.account_id,
  r.item_id,
  r.outlet_id,
  ANY_VALUE(r.outlet_name)                                                              AS outlet_name,
  COALESCE(SUM(CASE WHEN r.month_date < DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH)
                    THEN r.order_count END), 0)                                         AS last_month_orders,
  COALESCE(ROUND(SUM(CASE WHEN r.month_date < DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH)
                          THEN r.gmv END), 2), 0)                                       AS last_month_gmv,
  COALESCE(SUM(CASE WHEN r.month_date = DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH)
                    THEN r.order_count END), 0)                                         AS this_month_orders,
  COALESCE(ROUND(SUM(CASE WHEN r.month_date = DATE_TRUNC(CURRENT_DATE('Asia/Bangkok'), MONTH)
                          THEN r.gmv END), 2), 0)                                       AS this_month_gmv
FROM raw r
-- INNER JOIN กรองเฉพาะ outlet ที่เคยสั่ง SKU นั้นในเดือนที่แล้ว
INNER JOIN last_month_outlets lmo
  ON  r.account_id = lmo.account_id
  AND r.item_id    = lmo.item_id
  AND r.outlet_id  = lmo.outlet_id
GROUP BY 1, 2, 3, 4
ORDER BY r.kam_email, account_id, item_id, last_month_gmv DESC;
